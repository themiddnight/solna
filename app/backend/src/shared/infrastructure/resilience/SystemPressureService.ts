/**
 * System Pressure Service
 * 
 * Centralized management of system load and graceful degradation.
 * Monitors memory usage and automatically disables non-essential features
 * when the system is under pressure to prevent crashes.
 * 
 * Thresholds are dynamically calculated based on available system RAM.
 */
import os from 'os';
import { loggingService } from '../../infrastructure/logging/LoggingService';
import { CacheService } from '../caching/CacheService';
import { config } from "../../../config/environment";

// Pressure levels from normal to critical
export type PressureLevel = 'normal' | 'elevated' | 'high' | 'critical';

// Features that can be degraded under pressure
export interface DegradedFeatures {
  aiGenerationEnabled: boolean;
  detailedLoggingEnabled: boolean;
  fullCachingEnabled: boolean;
  newRoomCreationEnabled: boolean;
}

// Memory thresholds configuration (MB)
interface PressureThresholds {
  elevated: number;
  high: number;
  critical: number;
}

// System metrics snapshot
interface SystemMetricsSnapshot {
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  totalSystemMB: number;
  freeSystemMB: number;
  timestamp: Date;
}

/**
 * Calculate dynamic thresholds based on available system memory.
 * Uses percentages of total RAM with safety limits.
 */
function calculateDynamicThresholds(): PressureThresholds {
  const totalMemoryMB = Math.round(os.totalmem() / 1024 / 1024);

  // Default percentages from config
  const elevatedPercent = config.resilience.memory.elevatedPercent;
  const highPercent = config.resilience.memory.highPercent;
  const criticalPercent = config.resilience.memory.criticalPercent;

  // Calculate thresholds based on percentages
  let elevated = Math.round(totalMemoryMB * (elevatedPercent / 100));
  let high = Math.round(totalMemoryMB * (highPercent / 100));
  let critical = Math.round(totalMemoryMB * (criticalPercent / 100));

  // Allow override with absolute values from config (takes precedence)
  if (config.resilience.memory.elevated != null) {
    elevated = config.resilience.memory.elevated;
  }
  if (config.resilience.memory.high != null) {
    high = config.resilience.memory.high;
  }
  if (config.resilience.memory.critical != null) {
    critical = config.resilience.memory.critical;
  }

  // Safety limits: minimum thresholds for small containers
  const MIN_ELEVATED = 400;
  const MIN_HIGH = 600;
  const MIN_CRITICAL = 800;

  // Safety limits: maximum reasonable for Node.js (leave room for OS)
  const MAX_ELEVATED = 6000;
  const MAX_HIGH = 7000;
  const MAX_CRITICAL = 8000;

  return {
    elevated: Math.max(MIN_ELEVATED, Math.min(MAX_ELEVATED, elevated)),
    high: Math.max(MIN_HIGH, Math.min(MAX_HIGH, high)),
    critical: Math.max(MIN_CRITICAL, Math.min(MAX_CRITICAL, critical)),
  };
}

/**
 * SystemPressureService - Manages system load and graceful degradation
 */
/* eslint-disable @typescript-eslint/member-ordering */
export class SystemPressureService {
  private static instance: SystemPressureService | undefined;

  private currentPressure: PressureLevel = 'normal';
  private lastMetrics: SystemMetricsSnapshot | null = null;
  private readonly pressureChangeCallbacks: Array<(level: PressureLevel) => void> = [];

  // Memory thresholds (MB) - dynamically calculated
  private readonly thresholds: PressureThresholds;
  private readonly totalSystemMemoryMB: number;

  // Hysteresis buffer to prevent rapid oscillation (MB)
  private readonly HYSTERESIS_BUFFER = 50;

  // Monitoring interval
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITORING_INTERVAL_MS = 5000; // 5 seconds

  private constructor() {
    this.totalSystemMemoryMB = Math.round(os.totalmem() / 1024 / 1024);
    this.thresholds = calculateDynamicThresholds();

    this.startMonitoring();
    loggingService.logInfo('SystemPressureService initialized with dynamic thresholds', {
      totalSystemMemoryMB: this.totalSystemMemoryMB,
      thresholds: this.thresholds,
      percentages: {
        elevated: `${Math.round((this.thresholds.elevated / this.totalSystemMemoryMB) * 100)}%`,
        high: `${Math.round((this.thresholds.high / this.totalSystemMemoryMB) * 100)}%`,
        critical: `${Math.round((this.thresholds.critical / this.totalSystemMemoryMB) * 100)}%`,
      },
    });
  }

  static getInstance(): SystemPressureService {
    if (!SystemPressureService.instance) {
      SystemPressureService.instance = new SystemPressureService();
    }
    return SystemPressureService.instance;
  }

  /**
   * Start monitoring memory usage
   */
  private startMonitoring(): void {
    // Skip in test environment to prevent open handles (pattern from NamespaceGracePeriodManager)
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    this.monitoringInterval = setInterval(() => {
      this.checkPressure();
    }, this.MONITORING_INTERVAL_MS);

    // Initial check
    this.checkPressure();
  }

  /**
   * Check current memory pressure and update state
   */
  private checkPressure(): void {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const externalMB = Math.round(memUsage.external / 1024 / 1024);
    const totalSystemMB = Math.round(os.totalmem() / 1024 / 1024);
    const freeSystemMB = Math.round(os.freemem() / 1024 / 1024);

    this.lastMetrics = {
      heapUsedMB,
      heapTotalMB,
      externalMB,
      totalSystemMB,
      freeSystemMB,
      timestamp: new Date(),
    };

    const newPressure = this.calculatePressureLevel(heapUsedMB);

    // Only trigger actions if pressure actually changed
    if (newPressure !== this.currentPressure) {
      const oldPressure = this.currentPressure;
      this.currentPressure = newPressure;

      loggingService.logInfo('System pressure level changed', {
        from: oldPressure,
        to: newPressure,
        heapUsedMB,
        heapTotalMB,
      });

      // Take action based on new pressure level
      this.handlePressureChange(oldPressure, newPressure);

      // Notify callbacks
      this.pressureChangeCallbacks.forEach(cb => cb(newPressure));
    }
  }

  /**
   * Calculate pressure level with hysteresis to prevent oscillation
   */
  private calculatePressureLevel(heapUsedMB: number): PressureLevel {
    // When going UP, use exact thresholds
    // When going DOWN, require falling below threshold - buffer

    const isGoingDown = (threshold: number) =>
      heapUsedMB < threshold - this.HYSTERESIS_BUFFER;

    if (this.currentPressure === 'critical') {
      // Need to drop significantly to go back to high
      if (isGoingDown(this.thresholds.critical)) {
        return heapUsedMB >= this.thresholds.high ? 'high' :
          heapUsedMB >= this.thresholds.elevated ? 'elevated' : 'normal';
      }
      return 'critical';
    }

    if (this.currentPressure === 'high') {
      if (heapUsedMB >= this.thresholds.critical) return 'critical';
      if (isGoingDown(this.thresholds.high)) {
        return heapUsedMB >= this.thresholds.elevated ? 'elevated' : 'normal';
      }
      return 'high';
    }

    if (this.currentPressure === 'elevated') {
      if (heapUsedMB >= this.thresholds.critical) return 'critical';
      if (heapUsedMB >= this.thresholds.high) return 'high';
      if (isGoingDown(this.thresholds.elevated)) return 'normal';
      return 'elevated';
    }

    // Normal state - check if we need to escalate
    if (heapUsedMB >= this.thresholds.critical) return 'critical';
    if (heapUsedMB >= this.thresholds.high) return 'high';
    if (heapUsedMB >= this.thresholds.elevated) return 'elevated';
    return 'normal';
  }

  /**
   * Handle pressure level changes
   */
  private handlePressureChange(oldPressure: PressureLevel, newPressure: PressureLevel): void {
    // Log pressure change
    if (this.isPressureHigher(newPressure, oldPressure)) {
      loggingService.logSystemHealth('system_pressure', 'warning', {
        message: `System pressure increased to ${newPressure}`,
        oldLevel: oldPressure,
        newLevel: newPressure,
        metrics: this.lastMetrics,
      });
    } else {
      loggingService.logInfo('System pressure decreased', {
        from: oldPressure,
        to: newPressure,
      });
    }

    // Take emergency actions for critical pressure
    if (newPressure === 'critical') {
      this.triggerEmergencyCleanup();
    }
  }

  /**
   * Compare pressure levels
   */
  private isPressureHigher(a: PressureLevel, b: PressureLevel): boolean {
    const order: Record<PressureLevel, number> = {
      normal: 0,
      elevated: 1,
      high: 2,
      critical: 3,
    };
    return order[a] > order[b];
  }

  /**
   * Trigger emergency cleanup when critical pressure detected
   */
  triggerEmergencyCleanup(): void {
    loggingService.logSystemHealth('system_pressure', 'error', {
      message: 'Triggering emergency cleanup due to critical memory pressure',
      metrics: this.lastMetrics,
    });

    // 1. Clear caches
    try {
      const cacheService = CacheService.getInstance();
      cacheService.flush();
      loggingService.logInfo('Emergency cleanup: Cleared all caches');
    } catch {
      // Cache service might not be available
    }

    // 2. Force garbage collection if available
    if (global.gc) {
      global.gc();
      loggingService.logInfo('Emergency cleanup: Forced garbage collection');
    }

    // 3. Log memory after cleanup
    setTimeout(() => {
      const memAfter = process.memoryUsage();
      loggingService.logInfo('Memory after emergency cleanup', {
        heapUsedMB: Math.round(memAfter.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memAfter.heapTotal / 1024 / 1024),
      });
    }, 1000);
  }

  /** Test/diagnostic seam: runs one pressure check without the interval. */
  checkPressureNow(): void {
    this.checkPressure();
  }

  /**
   * Get current pressure level
   */
  getCurrentPressure(): PressureLevel {
    return this.currentPressure;
  }

  /**
   * Get degraded features based on current pressure
   */
  getDegradedFeatures(): DegradedFeatures {
    return {
      aiGenerationEnabled: this.currentPressure !== 'critical' && this.currentPressure !== 'high',
      detailedLoggingEnabled: this.currentPressure === 'normal',
      fullCachingEnabled: this.currentPressure !== 'critical',
      newRoomCreationEnabled: this.currentPressure !== 'critical',
    };
  }

  /**
   * Check if a specific feature is enabled
   */
  isFeatureEnabled(feature: keyof DegradedFeatures): boolean {
    return this.getDegradedFeatures()[feature];
  }

  /**
   * Get current metrics
   */
  getMetrics(): SystemMetricsSnapshot | null {
    return this.lastMetrics;
  }

  /**
   * Register callback for pressure changes
   */
  onPressureChange(callback: (level: PressureLevel) => void): void {
    this.pressureChangeCallbacks.push(callback);
  }

  /**
   * Get status summary for monitoring
   */
  getStatus(): {
    pressure: PressureLevel;
    features: DegradedFeatures;
    metrics: SystemMetricsSnapshot | null;
    thresholds: PressureThresholds;
  } {
    return {
      pressure: this.currentPressure,
      features: this.getDegradedFeatures(),
      metrics: this.lastMetrics,
      thresholds: this.thresholds,
    };
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    loggingService.logInfo('SystemPressureService shutdown completed');
  }
}

// Singleton export for easy access
export const systemPressureService = SystemPressureService.getInstance();

import type { NamespaceManager } from './NamespaceManager';
import type { RoomSessionManager } from '../../../domains/room-management/infrastructure/services/RoomSessionManager';
import type { PerformanceMonitoringService } from '../performance/PerformanceMonitoringService';
import { loggingService } from "../logging/LoggingService";
import { getCoreNamespaces, isApprovalNamespace, extractRoomIdFromNamespace as extractRoomId, extractRoomIdFromApprovalNamespace } from '@jam-band/shared';

export interface CleanupMetrics {
  namespacesChecked: number;
  namespacesCleanedUp: number;
  sessionsCleanedUp: number;
  memoryFreed: number;
  cleanupDuration: number;
  lastCleanup: Date;
}

export interface CleanupRule {
  name: string;
  condition: (namespacePath: string, info: unknown) => boolean;
  action: (namespacePath: string) => Promise<void>;
  priority: number;
}

/**
 * Namespace Cleanup Service for automated memory management
 * Requirements: 11.3 - Add namespace cleanup automation to prevent memory leaks
 */
/* eslint-disable @typescript-eslint/member-ordering */
export class NamespaceCleanupService {
  private static instance: NamespaceCleanupService | undefined;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private aggressiveCleanupInterval: NodeJS.Timeout | null = null;
  private readonly cleanupMetrics: CleanupMetrics;
  private cleanupRules: CleanupRule[] = [];
  
  // Configuration
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly AGGRESSIVE_CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly INACTIVE_NAMESPACE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
  private readonly EMPTY_NAMESPACE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MEMORY_PRESSURE_THRESHOLD_MB = 600; // 600MB
  private readonly STALE_SESSION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

  private constructor(
    private readonly namespaceManager: NamespaceManager,
    private readonly roomSessionManager: RoomSessionManager,
    private readonly performanceMonitoring: PerformanceMonitoringService
  ) {
    this.cleanupMetrics = this.initializeMetrics();
    this.initializeCleanupRules();
    this.startCleanupScheduler();
    loggingService.logInfo('NamespaceCleanupService initialized');
  }

  static getInstance(
    namespaceManager: NamespaceManager,
    roomSessionManager: RoomSessionManager,
    performanceMonitoring: PerformanceMonitoringService
  ): NamespaceCleanupService {
    if (!NamespaceCleanupService.instance) {
      NamespaceCleanupService.instance = new NamespaceCleanupService(
        namespaceManager,
        roomSessionManager,
        performanceMonitoring
      );
    }
    return NamespaceCleanupService.instance;
  }

  /**
   * Initialize cleanup metrics
   */
  private initializeMetrics(): CleanupMetrics {
    return {
      namespacesChecked: 0,
      namespacesCleanedUp: 0,
      sessionsCleanedUp: 0,
      memoryFreed: 0,
      cleanupDuration: 0,
      lastCleanup: new Date()
    };
  }

  /**
   * Initialize cleanup rules
   */
  private initializeCleanupRules(): void {
    // Rule 1: Clean up empty namespaces
    this.cleanupRules.push({
      name: 'empty_namespaces',
      priority: 1,
      condition: (namespacePath: string, info: unknown) => {
        // Never cleanup core namespaces (lobby, lobby-monitor)
        if (getCoreNamespaces().includes(namespacePath)) {
          return false;
        }
        const nsInfo = info as Record<string, unknown>;
        const connectionCount = nsInfo.connectionCount as number;
        const lastActivity = nsInfo.lastActivity as Date;
        return connectionCount === 0 &&
               (Date.now() - lastActivity.getTime()) > this.EMPTY_NAMESPACE_THRESHOLD_MS;
      },
      action: async (namespacePath: string) => {
        await this.cleanupEmptyNamespace(namespacePath);
      }
    });

    // Rule 2: Clean up inactive namespaces
    this.cleanupRules.push({
      name: 'inactive_namespaces',
      priority: 2,
      condition: (namespacePath: string, info: unknown) => {
        // Never cleanup core namespaces (lobby, lobby-monitor)
        if (getCoreNamespaces().includes(namespacePath)) {
          return false;
        }
        const nsInfo = info as Record<string, unknown>;
        const connectionCount = nsInfo.connectionCount as number;
        const lastActivity = nsInfo.lastActivity as Date;
        return connectionCount === 0 &&
               (Date.now() - lastActivity.getTime()) > this.INACTIVE_NAMESPACE_THRESHOLD_MS;
      },
      action: async (namespacePath: string) => {
        await this.cleanupInactiveNamespace(namespacePath);
      }
    });

    // Rule 3: Clean up approval namespaces that are stale
    this.cleanupRules.push({
      name: 'stale_approval_namespaces',
      priority: 3,
      condition: (namespacePath: string, info: unknown) => {
        const nsInfo = info as Record<string, unknown>;
        const createdAt = nsInfo.createdAt as Date;
        return isApprovalNamespace(namespacePath) &&
               (Date.now() - createdAt.getTime()) > 10 * 60 * 1000; // 10 minutes
      },
      action: async (namespacePath: string) => {
        await this.cleanupStaleApprovalNamespace(namespacePath);
      }
    });

    // Rule 4: Memory pressure cleanup
    this.cleanupRules.push({
      name: 'memory_pressure_cleanup',
      priority: 4,
      condition: (namespacePath: string, info: unknown) => {
        // Never cleanup core namespaces (lobby, lobby-monitor)
        if (getCoreNamespaces().includes(namespacePath)) {
          return false;
        }
        const systemMetrics = this.performanceMonitoring.getSystemMetrics();
        const nsInfo = info as Record<string, unknown>;
        const connectionCount = nsInfo.connectionCount as number;
        return systemMetrics.totalMemoryUsage > this.MEMORY_PRESSURE_THRESHOLD_MB &&
               connectionCount === 0; // Only clean up empty namespaces even under memory pressure
      },
      action: async (namespacePath: string) => {
        await this.cleanupForMemoryPressure(namespacePath);
      }
    });

    loggingService.logInfo('Cleanup rules initialized', {
      ruleCount: this.cleanupRules.length,
      rules: this.cleanupRules.map(r => ({ name: r.name, priority: r.priority }))
    });
  }

  /**
   * Start the cleanup scheduler
   */
  private startCleanupScheduler(): void {
    // NODE_ENV=test: never register the background sweep intervals — unit tests
    // drive the sweep on demand via forceCleanup() instead (Task 20 guard).
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // Regular cleanup interval
    this.cleanupInterval = setInterval(() => {
      void this.performRegularCleanup();
    }, this.CLEANUP_INTERVAL_MS);

    // Aggressive cleanup interval (when under memory pressure)
    this.aggressiveCleanupInterval = setInterval(() => {
      void this.performAggressiveCleanup();
    }, this.AGGRESSIVE_CLEANUP_INTERVAL_MS);

    loggingService.logInfo('Cleanup scheduler started', {
      regularInterval: this.CLEANUP_INTERVAL_MS,
      aggressiveInterval: this.AGGRESSIVE_CLEANUP_INTERVAL_MS
    });
  }

  /**
   * Perform regular cleanup
   */
  private async performRegularCleanup(): Promise<void> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      loggingService.logInfo('Starting regular cleanup cycle');
      
      const namespaceStats = this.namespaceManager.getNamespaceStats();
      let cleanedNamespaces = 0;
      let cleanedSessions = 0;

      // Apply cleanup rules in priority order
      const sortedRules = this.cleanupRules.sort((a, b) => a.priority - b.priority);

      for (const namespaceDetail of namespaceStats.namespaceDetails) {
        this.cleanupMetrics.namespacesChecked++;

        for (const rule of sortedRules) {
          if (rule.condition(namespaceDetail.path, namespaceDetail)) {
            try {
              await rule.action(namespaceDetail.path);
              cleanedNamespaces++;
              
              loggingService.logInfo('Namespace cleaned by rule', {
                namespacePath: namespaceDetail.path,
                rule: rule.name,
                connectionCount: namespaceDetail.connectionCount,
                age: namespaceDetail.age
              });
              
              break; // Only apply first matching rule
            } catch (error) {
              loggingService.logError(error as Error, {
                context: 'namespace_cleanup',
                rule: rule.name,
                namespacePath: namespaceDetail.path
              });
            }
          }
        }
      }

      // Clean up expired sessions
      cleanedSessions = await this.cleanupExpiredSessions();

      // Update metrics
      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;
      
      this.cleanupMetrics.namespacesCleanedUp += cleanedNamespaces;
      this.cleanupMetrics.sessionsCleanedUp += cleanedSessions;
      this.cleanupMetrics.memoryFreed += Math.max(0, startMemory - endMemory);
      this.cleanupMetrics.cleanupDuration = endTime - startTime;
      this.cleanupMetrics.lastCleanup = new Date();

      // Log cleanup results
      loggingService.logPerformanceMetric('namespace_cleanup', cleanedNamespaces, {
        cleanedNamespaces,
        cleanedSessions,
        memoryFreed: Math.round((startMemory - endMemory) / 1024 / 1024), // MB
        duration: this.cleanupMetrics.cleanupDuration,
        namespacesChecked: namespaceStats.namespaceDetails.length
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'regular_cleanup_cycle'
      });
    }
  }

  /**
   * Perform aggressive cleanup under memory pressure
   */
  private async performAggressiveCleanup(): Promise<void> {
    const systemMetrics = this.performanceMonitoring.getSystemMetrics();
    
    // Only perform aggressive cleanup if under memory pressure
    if (systemMetrics.totalMemoryUsage < this.MEMORY_PRESSURE_THRESHOLD_MB) {
      return;
    }

    loggingService.logSystemHealth('memory_pressure', 'warning', {
      message: 'Performing aggressive cleanup due to memory pressure',
      memoryUsage: systemMetrics.totalMemoryUsage,
      threshold: this.MEMORY_PRESSURE_THRESHOLD_MB
    });

    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      // Force cleanup of all inactive namespaces
      const namespaceStats = this.namespaceManager.getNamespaceStats();
      let aggressiveCleanups = 0;

      for (const namespaceDetail of namespaceStats.namespaceDetails) {
        // Never cleanup core namespaces (lobby, lobby-monitor)
        if (getCoreNamespaces().includes(namespaceDetail.path)) {
          continue;
        }

        // Clean up namespaces with low activity or old age
        const timeSinceActivity = Date.now() - namespaceDetail.lastActivity.getTime();
        const shouldCleanup =
          namespaceDetail.connectionCount === 0 &&
          timeSinceActivity > this.INACTIVE_NAMESPACE_THRESHOLD_MS;

        if (shouldCleanup) {
          try {
            await this.forceCleanupNamespace(namespaceDetail.path);
            aggressiveCleanups++;
          } catch (error) {
            loggingService.logError(error as Error, {
              context: 'aggressive_cleanup',
              namespacePath: namespaceDetail.path
            });
          }
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        loggingService.logInfo('Forced garbage collection during aggressive cleanup');
      }

      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;
      const memoryFreed = Math.max(0, startMemory - endMemory);

      loggingService.logInfo('Aggressive cleanup completed', {
        cleanedNamespaces: aggressiveCleanups,
        memoryFreed: Math.round(memoryFreed / 1024 / 1024), // MB
        duration: endTime - startTime,
        finalMemoryUsage: Math.round(endMemory / 1024 / 1024) // MB
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'aggressive_cleanup_cycle'
      });
    }
  }

  /**
   * Clean up empty namespace
   */
  private async cleanupEmptyNamespace(namespacePath: string): Promise<void> {
    const isSuccess = this.namespaceManager.cleanupNamespace(namespacePath);
    if (isSuccess) {
      // Extract room ID from namespace path
      const roomId = this.extractRoomIdFromNamespace(namespacePath);
      if (roomId) {
        this.roomSessionManager.cleanupRoomSessions(roomId);
      }
    }
  }

  /**
   * Clean up inactive namespace
   */
  private async cleanupInactiveNamespace(namespacePath: string): Promise<void> {
    const isSuccess = this.namespaceManager.cleanupNamespace(namespacePath);
    if (isSuccess) {
      const roomId = this.extractRoomIdFromNamespace(namespacePath);
      if (roomId) {
        this.roomSessionManager.cleanupRoomSessions(roomId);
      }
    }
  }

  /**
   * Clean up stale approval namespace
   */
  private async cleanupStaleApprovalNamespace(namespacePath: string): Promise<void> {
    const isSuccess = this.namespaceManager.cleanupNamespace(namespacePath);
    if (isSuccess) {
      const roomId = this.extractRoomIdFromNamespace(namespacePath);
      if (roomId) {
        // Clean up approval sessions specifically
        const approvalSessions = this.roomSessionManager.getApprovalSessions(roomId);
        for (const [socketId] of approvalSessions) {
          await this.roomSessionManager.removeSession(socketId);
        }
      }
    }
  }

  /**
   * Clean up namespace due to memory pressure
   */
  private async cleanupForMemoryPressure(namespacePath: string): Promise<void> {
    loggingService.logSystemHealth('memory_pressure_cleanup', 'warning', {
      message: 'Cleaning up namespace due to memory pressure',
      namespacePath
    });

    await this.forceCleanupNamespace(namespacePath);
  }

  /**
   * Force cleanup of a namespace
   */
  private async forceCleanupNamespace(namespacePath: string): Promise<void> {
    const isSuccess = this.namespaceManager.cleanupNamespace(namespacePath);
    if (isSuccess) {
      const roomId = this.extractRoomIdFromNamespace(namespacePath);
      if (roomId) {
        this.roomSessionManager.cleanupRoomSessions(roomId);
      }
    }
  }

  /**
   * Clean up expired sessions
   */
  private async cleanupExpiredSessions(): Promise<number> {
    const beforeCount = this.roomSessionManager.getSessionStats().totalSessions;
    await this.roomSessionManager.cleanupExpiredSessions(this.STALE_SESSION_THRESHOLD_MS);
    const afterCount = this.roomSessionManager.getSessionStats().totalSessions;
    
    return Math.max(0, beforeCount - afterCount);
  }

  /**
   * Extract room ID from namespace path
   */
  private extractRoomIdFromNamespace(namespacePath: string): string | null {
    return extractRoomId(namespacePath) || extractRoomIdFromApprovalNamespace(namespacePath);
  }

  /**
   * Add custom cleanup rule
   */
  addCleanupRule(rule: CleanupRule): void {
    this.cleanupRules.push(rule);
    this.cleanupRules.sort((a, b) => a.priority - b.priority);
    
    loggingService.logInfo('Custom cleanup rule added', {
      ruleName: rule.name,
      priority: rule.priority,
      totalRules: this.cleanupRules.length
    });
  }

  /**
   * Remove cleanup rule
   */
  removeCleanupRule(ruleName: string): boolean {
    const initialLength = this.cleanupRules.length;
    this.cleanupRules = this.cleanupRules.filter(rule => rule.name !== ruleName);
    
    const isRemoved = this.cleanupRules.length < initialLength;
    if (isRemoved) {
      loggingService.logInfo('Cleanup rule removed', {
        ruleName,
        remainingRules: this.cleanupRules.length
      });
    }
    
    return isRemoved;
  }

  /**
   * Force immediate cleanup
   */
  async forceCleanup(): Promise<CleanupMetrics> {
    loggingService.logInfo('Forcing immediate cleanup');
    await this.performRegularCleanup();
    return { ...this.cleanupMetrics };
  }

  /**
   * Get cleanup metrics
   */
  getCleanupMetrics(): CleanupMetrics {
    return { ...this.cleanupMetrics };
  }

  /**
   * Get cleanup rules
   */
  getCleanupRules(): CleanupRule[] {
    return [...this.cleanupRules];
  }

  /**
   * Get cleanup status
   */
  getCleanupStatus(): {
    isRunning: boolean;
    nextRegularCleanup: Date;
    nextAggressiveCleanup: Date;
    metrics: CleanupMetrics;
    systemMemoryUsage: number;
    memoryPressure: boolean;
  } {
    const systemMetrics = this.performanceMonitoring.getSystemMetrics();
    const now = new Date();
    
    return {
      isRunning: this.cleanupInterval !== null,
      nextRegularCleanup: new Date(now.getTime() + this.CLEANUP_INTERVAL_MS),
      nextAggressiveCleanup: new Date(now.getTime() + this.AGGRESSIVE_CLEANUP_INTERVAL_MS),
      metrics: this.getCleanupMetrics(),
      systemMemoryUsage: systemMetrics.totalMemoryUsage,
      memoryPressure: systemMetrics.totalMemoryUsage > this.MEMORY_PRESSURE_THRESHOLD_MB
    };
  }

  /**
   * Update cleanup configuration
   */
  updateConfiguration(config: {
    cleanupInterval?: number;
    aggressiveCleanupInterval?: number;
    inactiveThreshold?: number;
    emptyThreshold?: number;
    memoryPressureThreshold?: number;
  }): void {
    if (config.cleanupInterval !== undefined) {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = setInterval(() => {
          void this.performRegularCleanup();
        }, config.cleanupInterval);
      }
    }

    if (config.aggressiveCleanupInterval !== undefined) {
      if (this.aggressiveCleanupInterval) {
        clearInterval(this.aggressiveCleanupInterval);
        this.aggressiveCleanupInterval = setInterval(() => {
          void this.performAggressiveCleanup();
        }, config.aggressiveCleanupInterval);
      }
    }

    loggingService.logInfo('Cleanup configuration updated', config);
  }

  /**
   * Shutdown the cleanup service
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.aggressiveCleanupInterval) {
      clearInterval(this.aggressiveCleanupInterval);
      this.aggressiveCleanupInterval = null;
    }

    loggingService.logInfo('NamespaceCleanupService shutdown completed', {
      finalMetrics: this.cleanupMetrics
    });
  }
}
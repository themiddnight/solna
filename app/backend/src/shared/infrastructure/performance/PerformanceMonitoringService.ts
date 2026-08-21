import { loggingService } from "../logging/LoggingService";
import type { NamespaceManager } from '../namespace/NamespaceManager';
import type { RoomSessionManager } from '../../../domains/room-management/infrastructure/services/RoomSessionManager';

export interface RoomPerformanceMetrics {
  roomId: string;
  connectionCount: number;
  messageCount: number;
  averageLatency: number;
  errorCount: number;
  lastActivity: Date;
  createdAt: Date;
  memoryUsage: number;
  cpuUsage: number;
  eventCounts: Map<string, number>;
  slowEvents: Array<{ event: string; duration: number; timestamp: Date }>;
}

export interface SystemPerformanceMetrics {
  totalRooms: number;
  totalConnections: number;
  totalMemoryUsage: number;
  averageRoomLatency: number;
  systemHealth: 'healthy' | 'warning' | 'critical';
  uptime: number;
  eventLoopLag: number;
  gcMetrics: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  sessionSummary: {
    totalSessions: number;
    roomSessions: number;
    approvalSessions: number;
    lobbySessions: number;
  };
}

export interface ConnectionHealthMetrics {
  socketId: string;
  userId: string;
  roomId: string;
  namespacePath: string;
  connectionState: 'connected' | 'disconnected' | 'reconnecting' | 'error';
  latency: number;
  lastPing: Date;
  errorCount: number;
  reconnectAttempts: number;
  connectionDuration: number;
}

/**
 * Performance Monitoring Service for room isolation architecture
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
export class PerformanceMonitoringService {
  private static instance: PerformanceMonitoringService | undefined;
  private readonly roomMetrics = new Map<string, RoomPerformanceMetrics>();
  private readonly connectionHealth = new Map<string, ConnectionHealthMetrics>();
  private systemMetrics: SystemPerformanceMetrics;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  
  // Configuration
  private readonly MONITORING_INTERVAL_MS = 30 * 1000; // 30 seconds
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly HEALTH_CHECK_INTERVAL_MS = 10 * 1000; // 10 seconds
  private readonly SLOW_EVENT_THRESHOLD_MS = 1000; // 1 second
  private readonly HIGH_LATENCY_THRESHOLD_MS = 500; // 500ms
  private readonly MEMORY_WARNING_THRESHOLD_MB = 500; // 500MB
  private readonly MEMORY_CRITICAL_THRESHOLD_MB = 800; // 800MB
  private readonly MAX_SLOW_EVENTS_PER_ROOM = 100;

  private constructor(
    private readonly namespaceManager: NamespaceManager,
    private readonly roomSessionManager: RoomSessionManager
  ) {
    this.systemMetrics = this.initializeSystemMetrics();
    this.startMonitoring();
    loggingService.logInfo('PerformanceMonitoringService initialized');
  }

  static getInstance(
    namespaceManager: NamespaceManager,
    roomSessionManager: RoomSessionManager
  ): PerformanceMonitoringService {
    if (!PerformanceMonitoringService.instance) {
      PerformanceMonitoringService.instance = new PerformanceMonitoringService(
        namespaceManager,
        roomSessionManager
      );
    }
    return PerformanceMonitoringService.instance;
  }

  /**
   * Record room event for performance tracking
   * Requirements: 11.1, 11.4
   */
  recordRoomEvent(roomId: string, eventName: string, duration?: number): void {
    let roomMetrics = this.roomMetrics.get(roomId);
    
    if (!roomMetrics) {
      roomMetrics = {
        roomId,
        connectionCount: 0,
        messageCount: 0,
        averageLatency: 0,
        errorCount: 0,
        lastActivity: new Date(),
        createdAt: new Date(),
        memoryUsage: 0,
        cpuUsage: 0,
        eventCounts: new Map(),
        slowEvents: []
      };
      this.roomMetrics.set(roomId, roomMetrics);
    }

    // Update metrics
    roomMetrics.messageCount++;
    roomMetrics.lastActivity = new Date();
    
    // Track event counts
    const currentCount = roomMetrics.eventCounts.get(eventName) ?? 0;
    roomMetrics.eventCounts.set(eventName, currentCount + 1);

    // Track slow events
    if (duration != null && duration > this.SLOW_EVENT_THRESHOLD_MS) {
      roomMetrics.slowEvents.push({
        event: eventName,
        duration,
        timestamp: new Date()
      });

      // Limit slow events array size
      if (roomMetrics.slowEvents.length > this.MAX_SLOW_EVENTS_PER_ROOM) {
        roomMetrics.slowEvents = roomMetrics.slowEvents.slice(-this.MAX_SLOW_EVENTS_PER_ROOM);
      }

      loggingService.logPerformanceMetric('slow_room_event', duration, {
        roomId,
        eventName,
        threshold: this.SLOW_EVENT_THRESHOLD_MS
      });
    }
  }

  /**
   * Record room error for performance tracking
   * Requirements: 11.1, 11.5
   */
  recordRoomError(roomId: string, error: Error, context: Record<string, unknown> = {}): void {
    const roomMetrics = this.roomMetrics.get(roomId);
    if (roomMetrics) {
      roomMetrics.errorCount++;
      roomMetrics.lastActivity = new Date();
    }

    loggingService.logError(error, {
      roomId,
      context,
      performanceImpact: true
    });
  }

  /**
   * Update connection health metrics
   * Requirements: 11.4, 11.5
   */
  updateConnectionHealth(
    socketId: string,
    userId: string,
    roomId: string,
    namespacePath: string,
    metrics: Partial<ConnectionHealthMetrics>
  ): void {
    let healthMetrics = this.connectionHealth.get(socketId);
    
    if (!healthMetrics) {
      healthMetrics = {
        socketId,
        userId,
        roomId,
        namespacePath,
        connectionState: 'connected',
        latency: 0,
        lastPing: new Date(),
        errorCount: 0,
        reconnectAttempts: 0,
        connectionDuration: 0
      };
      this.connectionHealth.set(socketId, healthMetrics);
    }

    // Update metrics
    Object.assign(healthMetrics, metrics);
    healthMetrics.lastPing = new Date();

    // Check for high latency
    if (healthMetrics.latency > this.HIGH_LATENCY_THRESHOLD_MS) {
      loggingService.logPerformanceMetric('high_connection_latency', healthMetrics.latency, {
        socketId,
        userId,
        roomId,
        threshold: this.HIGH_LATENCY_THRESHOLD_MS
      });
    }
  }

  /**
   * Remove connection health tracking
   */
  removeConnectionHealth(socketId: string): void {
    this.connectionHealth.delete(socketId);
  }

  /**
   * Get current system performance metrics
   * Requirements: 11.4
   */
  getSystemMetrics(): SystemPerformanceMetrics {
    return { ...this.systemMetrics };
  }

  /**
   * Get performance metrics for a specific room
   * Requirements: 11.1, 11.4
   */
  getRoomMetrics(roomId: string): RoomPerformanceMetrics | undefined {
    const metrics = this.roomMetrics.get(roomId);
    return metrics ? { ...metrics } : undefined;
  }

  /**
   * Get all room performance metrics
   * Requirements: 11.4
   */
  getAllRoomMetrics(): Map<string, RoomPerformanceMetrics> {
    return new Map(this.roomMetrics);
  }

  /**
   * Get connection health metrics
   * Requirements: 11.4, 11.5
   */
  getConnectionHealth(): Map<string, ConnectionHealthMetrics> {
    return new Map(this.connectionHealth);
  }

  /**
   * Get performance summary
   * Requirements: 11.4
   */
  getPerformanceSummary(): {
    system: SystemPerformanceMetrics;
    roomCount: number;
    connectionCount: number;
    healthyConnections: number;
    unhealthyConnections: number;
    topPerformingRooms: Array<{ roomId: string; messageCount: number }>;
    slowestRooms: Array<{ roomId: string; slowEventsCount: number }>;
  } {
    const healthyConnections = Array.from(this.connectionHealth.values())
      .filter(h => h.connectionState === 'connected' && h.errorCount < 3).length;
    
    const unhealthyConnections = this.connectionHealth.size - healthyConnections;
    
    const roomMetricsArray = Array.from(this.roomMetrics.values());
    
    const topPerformingRooms = roomMetricsArray
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 5)
      .map(r => ({ roomId: r.roomId, messageCount: r.messageCount }));
    
    const slowestRooms = roomMetricsArray
      .sort((a, b) => b.slowEvents.length - a.slowEvents.length)
      .slice(0, 5)
      .map(r => ({ roomId: r.roomId, slowEventsCount: r.slowEvents.length }));

    return {
      system: this.getSystemMetrics(),
      roomCount: this.roomMetrics.size,
      connectionCount: this.connectionHealth.size,
      healthyConnections,
      unhealthyConnections,
      topPerformingRooms,
      slowestRooms
    };
  }

  /**
   * Shutdown the performance monitoring service
   */
  shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    loggingService.logInfo('PerformanceMonitoringService shutdown completed');
  }

  /**
   * Initialize system metrics
   */
  private initializeSystemMetrics(): SystemPerformanceMetrics {
    return {
      totalRooms: 0,
      totalConnections: 0,
      totalMemoryUsage: 0,
      averageRoomLatency: 0,
      systemHealth: 'healthy',
      uptime: 0,
      eventLoopLag: 0,
      gcMetrics: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0
      },
      sessionSummary: {
        totalSessions: 0,
        roomSessions: 0,
        approvalSessions: 0,
        lobbySessions: 0
      }
    };
  }

  /**
   * Start performance monitoring
   * Requirements: 11.4
   */
  private startMonitoring(): void {
    // Main monitoring loop
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.collectRoomMetrics();
      this.analyzePerformance();
    }, this.MONITORING_INTERVAL_MS);

    // Cleanup loop for memory management
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, this.CLEANUP_INTERVAL_MS);

    // Health check loop for connection monitoring
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL_MS);

    loggingService.logInfo('Performance monitoring started', {
      monitoringInterval: this.MONITORING_INTERVAL_MS,
      cleanupInterval: this.CLEANUP_INTERVAL_MS,
      healthCheckInterval: this.HEALTH_CHECK_INTERVAL_MS
    });
  }

  /**
   * Collect system-wide performance metrics
   * Requirements: 11.3, 11.4
   */
  private collectSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    const namespaceStats = this.namespaceManager.getNamespaceStats();
    const sessionStats = this.roomSessionManager.getSessionStats();

    // Update system metrics
    this.systemMetrics = {
      totalRooms: namespaceStats.totalNamespaces,
      totalConnections: namespaceStats.totalConnections,
      totalMemoryUsage: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      averageRoomLatency: this.calculateAverageRoomLatency(),
      systemHealth: this.determineSystemHealth(memUsage),
      uptime: process.uptime(),
      eventLoopLag: this.measureEventLoopLag(),
      gcMetrics: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024)
      },
      sessionSummary: {
        totalSessions: sessionStats.totalSessions,
        roomSessions: sessionStats.roomSessions,
        approvalSessions: sessionStats.approvalSessions,
        lobbySessions: sessionStats.lobbySessions
      }
    };

    // Log system metrics
    loggingService.logPerformanceMetric('system_memory_usage', this.systemMetrics.totalMemoryUsage, {
      gcMetrics: this.systemMetrics.gcMetrics,
      totalRooms: this.systemMetrics.totalRooms,
      totalConnections: this.systemMetrics.totalConnections,
      sessionSummary: this.systemMetrics.sessionSummary
    });
  }

  /**
   * Collect per-room performance metrics
   * Requirements: 11.1, 11.4
   */
  private collectRoomMetrics(): void {
    for (const [roomId, metrics] of this.roomMetrics.entries()) {
      // Update connection count from session manager
      const roomSessions = this.roomSessionManager.getRoomSessions(roomId);
      metrics.connectionCount = roomSessions.size;

      // Calculate memory usage estimate for this room
      metrics.memoryUsage = this.estimateRoomMemoryUsage(roomId, metrics.connectionCount);

      // Log room metrics
      loggingService.logPerformanceMetric('room_performance', metrics.messageCount, {
        roomId,
        connectionCount: metrics.connectionCount,
        errorCount: metrics.errorCount,
        memoryUsage: metrics.memoryUsage,
        eventCounts: Object.fromEntries(metrics.eventCounts),
        slowEventsCount: metrics.slowEvents.length
      });
    }
  }

  /**
   * Analyze performance and trigger alerts
   * Requirements: 11.2, 11.5
   */
  private analyzePerformance(): void {
    // Check system health
    if (this.systemMetrics.systemHealth === 'critical') {
      loggingService.logSystemHealth('performance', 'error', {
        message: 'System performance is critical',
        metrics: this.systemMetrics
      });
    } else if (this.systemMetrics.systemHealth === 'warning') {
      loggingService.logSystemHealth('performance', 'warning', {
        message: 'System performance degraded',
        metrics: this.systemMetrics
      });
    }

    // Check individual room performance
    for (const [roomId, metrics] of this.roomMetrics.entries()) {
      if (metrics.errorCount > 10) { // More than 10 errors
        loggingService.logSystemHealth('room_performance', 'warning', {
          message: 'High error count in room',
          roomId,
          errorCount: metrics.errorCount
        });
      }

      if (metrics.slowEvents.length > 50) { // More than 50 slow events
        loggingService.logSystemHealth('room_performance', 'warning', {
          message: 'High number of slow events in room',
          roomId,
          slowEventsCount: metrics.slowEvents.length
        });
      }
    }

    // Check connection health
    let unhealthyConnections = 0;
    for (const [ _socketId, health] of this.connectionHealth.entries()) {
      if (health.connectionState === 'error' || health.errorCount > 5) {
        unhealthyConnections++;
      }
    }

    if (unhealthyConnections > this.systemMetrics.totalConnections * 0.1) { // More than 10% unhealthy
      loggingService.logSystemHealth('connection_health', 'warning', {
        message: 'High number of unhealthy connections',
        unhealthyConnections,
        totalConnections: this.systemMetrics.totalConnections,
        percentage: Math.round((unhealthyConnections / this.systemMetrics.totalConnections) * 100)
      });
    }
  }

  /**
   * Perform cleanup to prevent memory leaks
   * Requirements: 11.3
   */
  private performCleanup(): void {
    const now = Date.now();
    const cleanupThreshold = 30 * 60 * 1000; // 30 minutes
    let cleanedRooms = 0;
    let cleanedConnections = 0;

    // Clean up old room metrics
    for (const [roomId, metrics] of this.roomMetrics.entries()) {
      const timeSinceLastActivity = now - metrics.lastActivity.getTime();
      
      if (timeSinceLastActivity > cleanupThreshold && metrics.connectionCount === 0) {
        this.roomMetrics.delete(roomId);
        cleanedRooms++;
      }
    }

    // Clean up old connection health metrics
    for (const [socketId, health] of this.connectionHealth.entries()) {
      const timeSinceLastPing = now - health.lastPing.getTime();
      
      if (timeSinceLastPing > cleanupThreshold) {
        this.connectionHealth.delete(socketId);
        cleanedConnections++;
      }
    }

    if (cleanedRooms > 0 || cleanedConnections > 0) {
      loggingService.logInfo('Performance monitoring cleanup completed', {
        cleanedRooms,
        cleanedConnections,
        remainingRooms: this.roomMetrics.size,
        remainingConnections: this.connectionHealth.size
      });
    }
  }

  /**
   * Perform health checks and automatic recovery
   * Requirements: 11.5
   */
  private performHealthChecks(): void {
    // Check for stale connections
    const now = Date.now();
    const staleThreshold = 60 * 1000; // 1 minute
    const staleConnections: string[] = [];

    for (const [socketId, health] of this.connectionHealth.entries()) {
      const timeSinceLastPing = now - health.lastPing.getTime();
      
      if (timeSinceLastPing > staleThreshold && health.connectionState === 'connected') {
        staleConnections.push(socketId);
        health.connectionState = 'error';
        health.errorCount++;
      }
    }

    if (staleConnections.length > 0) {
      loggingService.logSystemHealth('connection_health', 'warning', {
        message: 'Detected stale connections',
        staleConnections: staleConnections.length,
        socketIds: staleConnections
      });
    }

    // Trigger garbage collection if memory usage is high
    if (this.systemMetrics.totalMemoryUsage > this.MEMORY_CRITICAL_THRESHOLD_MB) {
      if (global.gc) {
        global.gc();
        loggingService.logInfo('Triggered garbage collection due to high memory usage', {
          memoryUsage: this.systemMetrics.totalMemoryUsage,
          threshold: this.MEMORY_CRITICAL_THRESHOLD_MB
        });
      }
    }
  }

  /**
   * Calculate average room latency
   */
  private calculateAverageRoomLatency(): number {
    if (this.connectionHealth.size === 0) return 0;
    
    let totalLatency = 0;
    for (const health of this.connectionHealth.values()) {
      totalLatency += health.latency;
    }
    
    return Math.round(totalLatency / this.connectionHealth.size);
  }

  /**
   * Determine system health based on metrics
   */
  private determineSystemHealth(memUsage: NodeJS.MemoryUsage): 'healthy' | 'warning' | 'critical' {
    const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    if (memUsageMB > this.MEMORY_CRITICAL_THRESHOLD_MB) {
      return 'critical';
    } else if (memUsageMB > this.MEMORY_WARNING_THRESHOLD_MB) {
      return 'warning';
    }
    
    return 'healthy';
  }

  /**
   * Measure event loop lag
   */
  private measureEventLoopLag(): number {
    const start = process.hrtime.bigint();
    return Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
  }

  /**
   * Estimate memory usage for a room
   */
  private estimateRoomMemoryUsage(roomId: string, connectionCount: number): number {
    // Rough estimate: base room overhead + per-connection overhead
    const baseRoomOverhead = 1; // 1MB base
    const perConnectionOverhead = 0.1; // 100KB per connection
    
    return Math.round(baseRoomOverhead + (connectionCount * perConnectionOverhead));
  }
}

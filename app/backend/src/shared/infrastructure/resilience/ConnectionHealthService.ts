import type { Socket } from 'socket.io';
import { loggingService } from "../logging/LoggingService";
import type { PerformanceMonitoringService } from '../performance/PerformanceMonitoringService';

export interface ConnectionRecoveryOptions {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
  maxRetryDelay: number;
}

export interface ConnectionHealthCheck {
  socketId: string;
  userId: string;
  roomId: string;
  namespacePath: string;
  isHealthy: boolean;
  lastPingTime: number;
  responseTime: number;
  consecutiveFailures: number;
  recoveryAttempts: number;
  lastRecoveryAttempt: Date | null;
}

/**
 * Connection Health Service for monitoring and recovering connections
 * Requirements: 11.4, 11.5
 */
/* eslint-disable @typescript-eslint/member-ordering */
export class ConnectionHealthService {
  private static instance: ConnectionHealthService | undefined;
  private readonly healthChecks = new Map<string, ConnectionHealthCheck>();
  private pingInterval: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;
  
  // Configuration
  private readonly PING_INTERVAL_MS = 30 * 1000; // 30 seconds
  private readonly RECOVERY_INTERVAL_MS = 60 * 1000; // 1 minute
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly DEFAULT_RECOVERY_OPTIONS: ConnectionRecoveryOptions = {
    maxRetries: 5,
    retryDelay: 1000, // 1 second
    backoffMultiplier: 2,
    maxRetryDelay: 30000 // 30 seconds
  };

  private constructor(
    private readonly performanceMonitoring: PerformanceMonitoringService,
    private readonly getNamespace?: (
      namespacePath: string
    ) => { sockets: Map<string, { emit: (event: string, data: unknown) => void }> } | null
  ) {
    // Skip intervals in tests to prevent open handles (pattern from NamespaceGracePeriodManager)
    if (process.env.NODE_ENV !== 'test') {
      this.startHealthMonitoring();
    }
    loggingService.logInfo('ConnectionHealthService initialized');
  }

  static getInstance(
    performanceMonitoring: PerformanceMonitoringService,
    getNamespace?: (namespacePath: string) => { sockets: Map<string, { emit: (event: string, data: unknown) => void }> } | null
  ): ConnectionHealthService {
    if (!ConnectionHealthService.instance) {
      ConnectionHealthService.instance = new ConnectionHealthService(performanceMonitoring, getNamespace);
    }
    return ConnectionHealthService.instance;
  }

  /**
   * Register a connection for health monitoring
   * Requirements: 11.4
   */
  registerConnection(
    socket: Socket,
    userId: string,
    roomId: string,
    namespacePath: string
  ): void {
    const healthCheck: ConnectionHealthCheck = {
      socketId: socket.id,
      userId,
      roomId,
      namespacePath,
      isHealthy: true,
      lastPingTime: Date.now(),
      responseTime: 0,
      consecutiveFailures: 0,
      recoveryAttempts: 0,
      lastRecoveryAttempt: null
    };

    this.healthChecks.set(socket.id, healthCheck);

    // Set up ping/pong handlers for this socket
    this.setupPingHandlers(socket);

    // Update performance monitoring
    this.performanceMonitoring.updateConnectionHealth(
      socket.id,
      userId,
      roomId,
      namespacePath,
      {
        connectionState: 'connected',
        latency: 0,
        lastPing: new Date(),
        errorCount: 0,
        reconnectAttempts: 0,
        connectionDuration: 0
      }
    );

    loggingService.logInfo('Connection registered for health monitoring', {
      socketId: socket.id,
      userId,
      roomId,
      namespacePath
    });
  }

  /**
   * Unregister a connection from health monitoring
   */
  unregisterConnection(socketId: string): void {
    const healthCheck = this.healthChecks.get(socketId);
    if (healthCheck) {
      this.healthChecks.delete(socketId);
      this.performanceMonitoring.removeConnectionHealth(socketId);
      
      loggingService.logInfo('Connection unregistered from health monitoring', {
        socketId,
        userId: healthCheck.userId,
        roomId: healthCheck.roomId
      });
    }
  }

  /**
   * Set up ping/pong handlers for a socket
   */
  private setupPingHandlers(socket: Socket): void {
    // Handle ping responses
    socket.on('pong', (data: { timestamp: number }) => {
      const healthCheck = this.healthChecks.get(socket.id);
      if (healthCheck && data.timestamp > 0) {
        const responseTime = Date.now() - data.timestamp;
        this.updateConnectionHealth(socket.id, responseTime, true);
      }
    });

    // Handle connection errors
    socket.on('error', (error: Error) => {
      const healthCheck = this.healthChecks.get(socket.id);
      if (healthCheck) {
        this.updateConnectionHealth(socket.id, 0, false);
        loggingService.logError(error, {
          socketId: socket.id,
          userId: healthCheck.userId,
          roomId: healthCheck.roomId,
          context: 'connection_error'
        });
      }
    });

    // Handle disconnections
    socket.on('disconnect', (reason: string) => {
      const healthCheck = this.healthChecks.get(socket.id);
      if (healthCheck) {
        this.performanceMonitoring.updateConnectionHealth(
          socket.id,
          healthCheck.userId,
          healthCheck.roomId,
          healthCheck.namespacePath,
          {
            connectionState: 'disconnected'
          }
        );

        loggingService.logInfo('Connection disconnected', {
          socketId: socket.id,
          userId: healthCheck.userId,
          roomId: healthCheck.roomId,
          reason
        });
      }
    });
  }

  /**
   * Update connection health status
   */
  private updateConnectionHealth(socketId: string, responseTime: number, isHealthy: boolean): void {
    const healthCheck = this.healthChecks.get(socketId);
    if (!healthCheck) return;

    healthCheck.lastPingTime = Date.now();
    healthCheck.responseTime = responseTime;
    healthCheck.isHealthy = isHealthy;

    if (isHealthy) {
      healthCheck.consecutiveFailures = 0;
    } else {
      healthCheck.consecutiveFailures++;
    }

    // Update performance monitoring
    this.performanceMonitoring.updateConnectionHealth(
      socketId,
      healthCheck.userId,
      healthCheck.roomId,
      healthCheck.namespacePath,
      {
        connectionState: isHealthy ? 'connected' : 'error',
        latency: responseTime,
        lastPing: new Date(),
        errorCount: healthCheck.consecutiveFailures
      }
    );

    // Log performance metrics
    loggingService.logPerformanceMetric('connection_ping', responseTime, {
      socketId,
      userId: healthCheck.userId,
      roomId: healthCheck.roomId,
      isHealthy,
      consecutiveFailures: healthCheck.consecutiveFailures
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Ping interval for health checks
    this.pingInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.PING_INTERVAL_MS);

    // Recovery interval for unhealthy connections
    this.recoveryInterval = setInterval(() => {
      this.performRecoveryAttempts();
    }, this.RECOVERY_INTERVAL_MS);

    loggingService.logInfo('Connection health monitoring started', {
      pingInterval: this.PING_INTERVAL_MS,
      recoveryInterval: this.RECOVERY_INTERVAL_MS
    });
  }

  /**
   * Perform health checks on all registered connections
   * Requirements: 11.4, 11.5
   */
  private performHealthChecks(): void {
    const now = Date.now();
    let healthyConnections = 0;
    let unhealthyConnections = 0;

    for (const [socketId, healthCheck] of this.healthChecks.entries()) {
      // B1: cannot measure a connection we cannot reach — never mark it stale
      if (!this.getNamespaceForConnection(healthCheck.namespacePath)) {
        continue;
      }

      // Check if connection is stale. lastPingTime is refreshed on every
      // ping SEND (sendPing), so a connection is stale only when no ping has
      // been sent for 2 full ping cycles (60s = 2 × 30s cadence). There is no
      // separate response-timeout window: staleness is purely "no ping went
      // out in 2 cycles", which is why the threshold compares against
      // PING_INTERVAL_MS * 2 rather than any latency expectation.
      const timeSinceLastPing = now - healthCheck.lastPingTime;

      if (timeSinceLastPing > this.PING_INTERVAL_MS * 2) {
        // Connection is stale
        healthCheck.isHealthy = false;
        healthCheck.consecutiveFailures++;
        unhealthyConnections++;

        this.performanceMonitoring.updateConnectionHealth(
          socketId,
          healthCheck.userId,
          healthCheck.roomId,
          healthCheck.namespacePath,
          {
            connectionState: 'error',
            errorCount: healthCheck.consecutiveFailures
          }
        );
      } else if (healthCheck.isHealthy) {
        healthyConnections++;
      } else {
        unhealthyConnections++;
      }

      // Send ping to check connection
      this.sendPing(socketId);
    }

    // Log health check summary
    if (this.healthChecks.size > 0) {
      loggingService.logPerformanceMetric('connection_health_check', healthyConnections, {
        totalConnections: this.healthChecks.size,
        healthyConnections,
        unhealthyConnections,
        healthPercentage: Math.round((healthyConnections / this.healthChecks.size) * 100)
      });
    }
  }

  /**
   * Send ping to a specific connection
   */
  private sendPing(socketId: string): void {
    const healthCheck = this.healthChecks.get(socketId);
    if (!healthCheck) return;

    // Find the socket in the namespace
    const namespace = this.getNamespaceForConnection(healthCheck.namespacePath);
    if (namespace) {
      const socket = namespace.sockets.get(socketId);
      if (socket) {
        const timestamp = Date.now();
        socket.emit('ping', { timestamp });
        healthCheck.lastPingTime = timestamp;
      } else {
        // Socket not found in namespace, mark as unhealthy
        this.updateConnectionHealth(socketId, 0, false);
      }
    }
  }

  /**
   * Get namespace for a connection
   */
  private getNamespaceForConnection(namespacePath: string): { sockets: Map<string, { emit: (event: string, data: unknown) => void }> } | null {
    // B1: the ping path was never wired — no namespace injection and no FE pong
    // handler existed, so healthy connections were marked stale and then
    // unregistered. The getter is now injectable; until a caller provides one,
    // health checks and recovery below skip unreachable connections instead of
    // punishing them.
    return this.getNamespace?.(namespacePath) ?? null;
  }

  /**
   * Perform recovery attempts for unhealthy connections
   * Requirements: 11.5
   */
  private performRecoveryAttempts(): void {
    const now = new Date();
    let recoveryAttempts = 0;

    for (const [socketId, healthCheck] of this.healthChecks.entries()) {
      // Skip healthy connections
      if (healthCheck.isHealthy) continue;

      // B1: cannot recover a connection we cannot reach — never unregister it
      if (!this.getNamespaceForConnection(healthCheck.namespacePath)) {
        continue;
      }

      // Skip if max consecutive failures not reached
      if (healthCheck.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES) continue;

      // Skip if max recovery attempts reached
      if (healthCheck.recoveryAttempts >= this.DEFAULT_RECOVERY_OPTIONS.maxRetries) {
        // Connection is beyond recovery, remove it
        this.unregisterConnection(socketId);
        loggingService.logSystemHealth('connection_recovery', 'error', {
          message: 'Connection beyond recovery, removing',
          socketId,
          userId: healthCheck.userId,
          roomId: healthCheck.roomId,
          recoveryAttempts: healthCheck.recoveryAttempts
        });
        continue;
      }

      // Check if enough time has passed since last recovery attempt
      const timeSinceLastAttempt = healthCheck.lastRecoveryAttempt 
        ? now.getTime() - healthCheck.lastRecoveryAttempt.getTime()
        : Infinity;

      const requiredDelay = Math.min(
        this.DEFAULT_RECOVERY_OPTIONS.retryDelay * 
        Math.pow(this.DEFAULT_RECOVERY_OPTIONS.backoffMultiplier, healthCheck.recoveryAttempts),
        this.DEFAULT_RECOVERY_OPTIONS.maxRetryDelay
      );

      if (timeSinceLastAttempt >= requiredDelay) {
        this.attemptConnectionRecovery(socketId, healthCheck);
        recoveryAttempts++;
      }
    }

    if (recoveryAttempts > 0) {
      loggingService.logInfo('Connection recovery attempts performed', {
        recoveryAttempts,
        totalUnhealthyConnections: Array.from(this.healthChecks.values())
          .filter(h => !h.isHealthy).length
      });
    }
  }

  /**
   * Attempt to recover a specific connection
   */
  private attemptConnectionRecovery(socketId: string, healthCheck: ConnectionHealthCheck): void {
    healthCheck.recoveryAttempts++;
    healthCheck.lastRecoveryAttempt = new Date();

    // Update performance monitoring
    this.performanceMonitoring.updateConnectionHealth(
      socketId,
      healthCheck.userId,
      healthCheck.roomId,
      healthCheck.namespacePath,
      {
        connectionState: 'reconnecting',
        reconnectAttempts: healthCheck.recoveryAttempts
      }
    );

    // Send recovery ping
    this.sendPing(socketId);

    loggingService.logInfo('Connection recovery attempt', {
      socketId,
      userId: healthCheck.userId,
      roomId: healthCheck.roomId,
      recoveryAttempt: healthCheck.recoveryAttempts,
      consecutiveFailures: healthCheck.consecutiveFailures
    });
  }

  /**
   * Get health status for all connections
   */
  getHealthStatus(): {
    totalConnections: number;
    healthyConnections: number;
    unhealthyConnections: number;
    connectionsInRecovery: number;
    averageResponseTime: number;
    connectionsByRoom: Map<string, { healthy: number; unhealthy: number }>;
  } {
    let healthyCount = 0;
    let unhealthyCount = 0;
    let recoveryCount = 0;
    let totalResponseTime = 0;
    const connectionsByRoom = new Map<string, { healthy: number; unhealthy: number }>();

    for (const healthCheck of this.healthChecks.values()) {
      if (healthCheck.isHealthy) {
        healthyCount++;
        totalResponseTime += healthCheck.responseTime;
      } else {
        unhealthyCount++;
        if (healthCheck.recoveryAttempts > 0) {
          recoveryCount++;
        }
      }

      // Track by room
      const roomStats = connectionsByRoom.get(healthCheck.roomId) || { healthy: 0, unhealthy: 0 };
      if (healthCheck.isHealthy) {
        roomStats.healthy++;
      } else {
        roomStats.unhealthy++;
      }
      connectionsByRoom.set(healthCheck.roomId, roomStats);
    }

    return {
      totalConnections: this.healthChecks.size,
      healthyConnections: healthyCount,
      unhealthyConnections: unhealthyCount,
      connectionsInRecovery: recoveryCount,
      averageResponseTime: healthyCount > 0 ? Math.round(totalResponseTime / healthyCount) : 0,
      connectionsByRoom
    };
  }

  /**
   * Get health check details for a specific connection
   */
  getConnectionHealth(socketId: string): ConnectionHealthCheck | undefined {
    return this.healthChecks.get(socketId);
  }

  /**
   * Get all health checks
   */
  getAllHealthChecks(): Map<string, ConnectionHealthCheck> {
    return new Map(this.healthChecks);
  }

  /**
   * Force health check for a specific connection
   */
  forceHealthCheck(socketId: string): void {
    const healthCheck = this.healthChecks.get(socketId);
    if (healthCheck) {
      this.sendPing(socketId);
      loggingService.logInfo('Forced health check for connection', {
        socketId,
        userId: healthCheck.userId,
        roomId: healthCheck.roomId
      });
    }
  }

  /**
   * Reset recovery attempts for a connection
   */
  resetRecoveryAttempts(socketId: string): void {
    const healthCheck = this.healthChecks.get(socketId);
    if (healthCheck) {
      healthCheck.recoveryAttempts = 0;
      healthCheck.lastRecoveryAttempt = null;
      healthCheck.consecutiveFailures = 0;
      
      loggingService.logInfo('Reset recovery attempts for connection', {
        socketId,
        userId: healthCheck.userId,
        roomId: healthCheck.roomId
      });
    }
  }

  /**
   * Shutdown the connection health service
   */
  /** Test/diagnostic seam: runs one ping cycle without the interval. */
  runHealthCheckCycle(): void {
    this.performHealthChecks();
  }

  /** Test/diagnostic seam: runs one recovery cycle without the interval. */
  runRecoveryCycle(): void {
    this.performRecoveryAttempts();
  }

  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }

    this.healthChecks.clear();
    loggingService.logInfo('ConnectionHealthService shutdown completed');
  }
}
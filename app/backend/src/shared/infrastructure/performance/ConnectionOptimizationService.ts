import type { Server, Socket } from 'socket.io';
import { loggingService } from "../logging/LoggingService";
import type { PerformanceMonitoringService } from './PerformanceMonitoringService';
import { ROOM_LIFECYCLE_EVENTS } from '@jam-band/shared';
import { CONNECTION_TIMEOUT_MS } from '@jam-band/shared';

export interface ConnectionPoolConfig {
  maxConnectionsPerRoom: number;
  maxConnectionsGlobal: number;
  connectionQueueSize: number;
  connectionTimeout: number;
  heartbeatInterval: number;
  compressionEnabled: boolean;
  batchingEnabled: boolean;
  batchSize: number;
  batchDelay: number;
}

export interface ConnectionOptimizationMetrics {
  totalConnections: number;
  queuedConnections: number;
  rejectedConnections: number;
  averageConnectionTime: number;
  messagesBatched: number;
  compressionRatio: number;
  optimizationsSaved: number;
}

export interface BatchedMessage {
  event: string;
  data: unknown;
  timestamp: number;
  roomId: string;
}

/**
 * Mutable heartbeat tuning knobs exposed by some engine.io connection
 * implementations. Not part of the public engine.io Socket type, so presence
 * is feature-detected at runtime before assignment.
 */
interface HeartbeatTunableConnection {
  pingInterval: number;
  pingTimeout: number;
}

/**
 * Mutable buffer/upgrade tuning knobs exposed by some engine.io connection
 * implementations. Feature-detected at runtime before assignment.
 */
interface BufferTunableConnection {
  upgradeTimeout: number;
  maxHttpBufferSize: number;
}

const supportsHeartbeatTuning = (conn: object): conn is HeartbeatTunableConnection =>
  'pingInterval' in conn;

const supportsBufferTuning = (conn: object): conn is BufferTunableConnection =>
  'upgradeTimeout' in conn;

/**
 * Connection Optimization Service for high user count scenarios
 * Requirements: 11.2, 11.3 - Optimize connection handling for high user count scenarios
 */
/* eslint-disable @typescript-eslint/member-ordering */
export class ConnectionOptimizationService {
  private static instance: ConnectionOptimizationService | undefined;
  private config: ConnectionPoolConfig;
  private readonly metrics: ConnectionOptimizationMetrics;
  private readonly connectionQueue = new Map<string, Socket[]>(); // roomId -> queued sockets
  private readonly messageBatches = new Map<string, BatchedMessage[]>(); // roomId -> batched messages
  private readonly batchTimers = new Map<string, NodeJS.Timeout>(); // roomId -> batch timer
  private readonly connectionCounts = new Map<string, number>(); // roomId -> connection count
  private optimizationInterval: NodeJS.Timeout | null = null;
  
  // Rate limiting for connections
  private readonly connectionAttempts = new Map<string, { count: number; lastAttempt: number }>(); // IP -> attempts
  private readonly CONNECTION_RATE_LIMIT = 10; // connections per minute per IP
  private readonly CONNECTION_RATE_WINDOW = 60 * 1000; // 1 minute

  private constructor(
    private readonly io: Server,
    private readonly performanceMonitoring: PerformanceMonitoringService
  ) {
    this.config = this.getDefaultConfig();
    this.metrics = this.initializeMetrics();
    this.startOptimizationLoop();
    loggingService.logInfo('ConnectionOptimizationService initialized');
  }

  static getInstance(
    io: Server,
    performanceMonitoring: PerformanceMonitoringService
  ): ConnectionOptimizationService {
    if (!ConnectionOptimizationService.instance) {
      ConnectionOptimizationService.instance = new ConnectionOptimizationService(
        io,
        performanceMonitoring
      );
    }
    return ConnectionOptimizationService.instance;
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): ConnectionPoolConfig {
    return {
      maxConnectionsPerRoom: 50, // Maximum connections per room
      maxConnectionsGlobal: 1000, // Maximum global connections
      connectionQueueSize: 100, // Maximum queued connections per room
      connectionTimeout: 30000, // 30 seconds
      heartbeatInterval: 25000, // 25 seconds
      compressionEnabled: true,
      batchingEnabled: true,
      batchSize: 10, // Messages per batch
      batchDelay: 100 // 100ms batch delay
    };
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): ConnectionOptimizationMetrics {
    return {
      totalConnections: 0,
      queuedConnections: 0,
      rejectedConnections: 0,
      averageConnectionTime: 0,
      messagesBatched: 0,
      compressionRatio: 0,
      optimizationsSaved: 0
    };
  }

  /**
   * Start optimization loop
   */
  private startOptimizationLoop(): void {
    this.optimizationInterval = setInterval(() => {
      this.performOptimizations();
      this.processConnectionQueues();
      this.updateMetrics();
    }, 5000); // Run every 5 seconds

    loggingService.logInfo('Connection optimization loop started');
  }

  /**
   * Check if connection should be allowed
   * Requirements: 11.2
   */
  shouldAllowConnection(socket: Socket, roomId: string): {
    allowed: boolean;
    reason?: string;
    queuePosition?: number;
  } {
    const clientIP = socket.handshake.address;
    
    // Check rate limiting
    if (!this.checkConnectionRateLimit(clientIP)) {
      this.metrics.rejectedConnections++;
      return {
        allowed: false,
        reason: 'Rate limit exceeded'
      };
    }

    // Check global connection limit
    if (this.metrics.totalConnections >= this.config.maxConnectionsGlobal) {
      this.metrics.rejectedConnections++;
      return {
        allowed: false,
        reason: 'Global connection limit reached'
      };
    }

    // Check room connection limit
    const roomConnections = this.connectionCounts.get(roomId) ?? 0;
    if (roomConnections >= this.config.maxConnectionsPerRoom) {
      // Try to queue the connection
      const queuePosition = this.queueConnection(socket, roomId);
      if (queuePosition !== -1) {
        return {
          allowed: false,
          reason: 'Room full, queued for connection',
          queuePosition
        };
      } else {
        this.metrics.rejectedConnections++;
        return {
          allowed: false,
          reason: 'Room full and queue full'
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check connection rate limit for IP
   */
  private checkConnectionRateLimit(clientIP: string): boolean {
    const now = Date.now();
    const attempts = this.connectionAttempts.get(clientIP);

    if (!attempts) {
      this.connectionAttempts.set(clientIP, { count: 1, lastAttempt: now });
      return true;
    }

    // Reset if window has passed
    if (now - attempts.lastAttempt > this.CONNECTION_RATE_WINDOW) {
      this.connectionAttempts.set(clientIP, { count: 1, lastAttempt: now });
      return true;
    }

    // Check if under limit
    if (attempts.count < this.CONNECTION_RATE_LIMIT) {
      attempts.count++;
      attempts.lastAttempt = now;
      return true;
    }

    return false;
  }

  /**
   * Queue a connection when room is full
   */
  private queueConnection(socket: Socket, roomId: string): number {
    let queue = this.connectionQueue.get(roomId);
    if (!queue) {
      queue = [];
      this.connectionQueue.set(roomId, queue);
    }

    if (queue.length >= this.config.connectionQueueSize) {
      return -1; // Queue is full
    }

    queue.push(socket);
    this.metrics.queuedConnections++;

    // Set timeout for queued connection
    setTimeout(() => {
      this.removeFromQueue(socket, roomId);
      socket.emit(ROOM_LIFECYCLE_EVENTS.CONNECTION_TIMEOUT, {
        message: 'Connection request timed out'
      });
      socket.disconnect();
    }, this.config.connectionTimeout);

    loggingService.logInfo('Connection queued', {
      socketId: socket.id,
      roomId,
      queuePosition: queue.length,
      queueSize: queue.length
    });

    return queue.length;
  }

  /**
   * Remove socket from queue
   */
  private removeFromQueue(socket: Socket, roomId: string): void {
    const queue = this.connectionQueue.get(roomId);
    if (queue) {
      const index = queue.findIndex(s => s.id === socket.id);
      if (index !== -1) {
        queue.splice(index, 1);
        this.metrics.queuedConnections--;
        
        if (queue.length === 0) {
          this.connectionQueue.delete(roomId);
        }
      }
    }
  }

  /**
   * Process connection queues
   */
  private processConnectionQueues(): void {
    for (const [roomId, queue] of this.connectionQueue.entries()) {
      const roomConnections = this.connectionCounts.get(roomId) ?? 0;
      const availableSlots = this.config.maxConnectionsPerRoom - roomConnections;

      if (availableSlots > 0 && queue.length > 0) {
        const socketsToProcess = queue.splice(0, Math.min(availableSlots, queue.length));
        
        for (const socket of socketsToProcess) {
          this.metrics.queuedConnections--;
          
          // Emit connection approved
          socket.emit(ROOM_LIFECYCLE_EVENTS.CONNECTION_APPROVED, {
            roomId,
            message: 'Connection approved from queue'
          });

          loggingService.logInfo('Connection approved from queue', {
            socketId: socket.id,
            roomId,
            remainingQueue: queue.length
          });
        }

        if (queue.length === 0) {
          this.connectionQueue.delete(roomId);
        }
      }
    }
  }

  /**
   * Register successful connection
   */
  registerConnection(socket: Socket, roomId: string): void {
    const currentCount = this.connectionCounts.get(roomId) ?? 0;
    this.connectionCounts.set(roomId, currentCount + 1);
    this.metrics.totalConnections++;

    // Set up optimized socket configuration
    this.optimizeSocket(socket);

    // Remove from queue if it was queued
    this.removeFromQueue(socket, roomId);

    loggingService.logPerformanceMetric('connection_registered', 1, {
      socketId: socket.id,
      roomId,
      roomConnections: currentCount + 1,
      totalConnections: this.metrics.totalConnections
    });
  }

  /**
   * Unregister connection
   */
  unregisterConnection(socket: Socket, roomId: string): void {
    const currentCount = this.connectionCounts.get(roomId) ?? 0;
    if (currentCount > 0) {
      this.connectionCounts.set(roomId, currentCount - 1);
      this.metrics.totalConnections--;

      if (currentCount - 1 === 0) {
        this.connectionCounts.delete(roomId);
        // Clean up any remaining batches for this room
        this.flushMessageBatch(roomId);
      }
    }

    loggingService.logPerformanceMetric('connection_unregistered', 1, {
      socketId: socket.id,
      roomId,
      roomConnections: Math.max(0, currentCount - 1),
      totalConnections: this.metrics.totalConnections
    });
  }

  /**
   * Optimize socket configuration
   */
  private optimizeSocket(socket: Socket): void {
    // Enable compression if configured
    if (this.config.compressionEnabled) {
      socket.compress(true);
    }

    // Set heartbeat interval (if isAvailable)
    try {
      if (supportsHeartbeatTuning(socket.conn)) {
        socket.conn.pingInterval = this.config.heartbeatInterval;
        socket.conn.pingTimeout = this.config.heartbeatInterval + 5000;
      }

      // Optimize buffer sizes (if isAvailable)
      if (supportsBufferTuning(socket.conn)) {
        socket.conn.upgradeTimeout = CONNECTION_TIMEOUT_MS;
        socket.conn.maxHttpBufferSize = 1e6; // 1MB
      }
    } catch (error) {
      loggingService.logInfo('Socket optimization skipped', {
        reason: (error as Error).message,
        socketId: socket.id
      });
    }

    this.metrics.optimizationsSaved++;
  }

  /**
   * Optimize message sending with batching
   * Requirements: 11.2
   */
  optimizedEmit(roomId: string, event: string, data: unknown, immediate: boolean = false): void {
    if (!this.config.batchingEnabled || immediate) {
      // Send immediately
      this.io.to(roomId).emit(event, data);
      return;
    }

    // Add to batch
    let batch = this.messageBatches.get(roomId);
    if (!batch) {
      batch = [];
      this.messageBatches.set(roomId, batch);
    }

    batch.push({
      event,
      data,
      timestamp: Date.now(),
      roomId
    });

    this.metrics.messagesBatched++;

    // Check if batch is full or should be sent
    if (batch.length >= this.config.batchSize) {
      this.flushMessageBatch(roomId);
    } else {
      // Set timer if not already set
      if (!this.batchTimers.has(roomId)) {
        const timer = setTimeout(() => {
          this.flushMessageBatch(roomId);
        }, this.config.batchDelay);
        this.batchTimers.set(roomId, timer);
      }
    }
  }

  /**
   * Flush message batch for a room
   */
  private flushMessageBatch(roomId: string): void {
    const batch = this.messageBatches.get(roomId);
    if (!batch || batch.length === 0) {
      return;
    }

    // Clear timer
    const timer = this.batchTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(roomId);
    }

    // Group messages by event type for efficiency
    const eventGroups = new Map<string, unknown[]>();
    for (const message of batch) {
      let group = eventGroups.get(message.event);
      if (!group) {
        group = [];
        eventGroups.set(message.event, group);
      }
      group.push(message.data);
    }

    // Send batched messages
    for (const [event, dataArray] of eventGroups.entries()) {
      if (dataArray.length === 1) {
        this.io.to(roomId).emit(event, dataArray[0]);
      } else {
        this.io.to(roomId).emit(`${event}_batch`, dataArray);
      }
    }

    // Clear batch
    this.messageBatches.delete(roomId);

    loggingService.logPerformanceMetric('message_batch_flushed', batch.length, {
      roomId,
      batchSize: batch.length,
      eventTypes: eventGroups.size
    });
  }

  /**
   * Perform periodic optimizations
   */
  private performOptimizations(): void {
    // Clean up stale connection attempts
    const now = Date.now();
    for (const [ip, attempts] of this.connectionAttempts.entries()) {
      if (now - attempts.lastAttempt > this.CONNECTION_RATE_WINDOW * 2) {
        this.connectionAttempts.delete(ip);
      }
    }

    // Flush old message batches
    for (const [roomId, batch] of this.messageBatches.entries()) {
      if (batch.length > 0) {
        const oldestMessage = Math.min(...batch.map(m => m.timestamp));
        if (now - oldestMessage > this.config.batchDelay * 2) {
          this.flushMessageBatch(roomId);
        }
      }
    }

    // Check for memory pressure and adjust configuration
    const systemMetrics = this.performanceMonitoring.getSystemMetrics();
    if (systemMetrics.systemHealth === 'critical') {
      this.adjustConfigurationForMemoryPressure();
    }
  }

  /**
   * Adjust configuration under memory pressure
   */
  private adjustConfigurationForMemoryPressure(): void {
    const originalConfig = { ...this.config };

    // Reduce limits under memory pressure
    this.config.maxConnectionsPerRoom = Math.max(10, Math.floor(this.config.maxConnectionsPerRoom * 0.8));
    this.config.maxConnectionsGlobal = Math.max(100, Math.floor(this.config.maxConnectionsGlobal * 0.8));
    this.config.connectionQueueSize = Math.max(10, Math.floor(this.config.connectionQueueSize * 0.5));
    this.config.batchSize = Math.max(5, Math.floor(this.config.batchSize * 0.7));

    loggingService.logSystemHealth('connection_optimization', 'warning', {
      message: 'Adjusted connection limits due to memory pressure',
      originalConfig: {
        maxConnectionsPerRoom: originalConfig.maxConnectionsPerRoom,
        maxConnectionsGlobal: originalConfig.maxConnectionsGlobal,
        connectionQueueSize: originalConfig.connectionQueueSize,
        batchSize: originalConfig.batchSize
      },
      newConfig: {
        maxConnectionsPerRoom: this.config.maxConnectionsPerRoom,
        maxConnectionsGlobal: this.config.maxConnectionsGlobal,
        connectionQueueSize: this.config.connectionQueueSize,
        batchSize: this.config.batchSize
      }
    });
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    // Calculate compression ratio (simplified)
    this.metrics.compressionRatio = this.config.compressionEnabled ? 0.3 : 0; // Assume 30% compression

    // Log optimization metrics
    loggingService.logPerformanceMetric('connection_optimization', this.metrics.totalConnections, {
      totalConnections: this.metrics.totalConnections,
      queuedConnections: this.metrics.queuedConnections,
      rejectedConnections: this.metrics.rejectedConnections,
      messagesBatched: this.metrics.messagesBatched,
      optimizationsSaved: this.metrics.optimizationsSaved
    });
  }

  /**
   * Get optimization metrics
   */
  getOptimizationMetrics(): ConnectionOptimizationMetrics {
    return { ...this.metrics };
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    totalConnections: number;
    connectionsByRoom: Map<string, number>;
    queuedByRoom: Map<string, number>;
    averageConnectionsPerRoom: number;
    peakConnections: number;
  } {
    const queuedByRoom = new Map<string, number>();
    for (const [roomId, queue] of this.connectionQueue.entries()) {
      queuedByRoom.set(roomId, queue.length);
    }

    const totalRooms = this.connectionCounts.size;
    const averageConnectionsPerRoom = totalRooms > 0 
      ? Array.from(this.connectionCounts.values()).reduce((sum, count) => sum + count, 0) / totalRooms
      : 0;

    const peakConnections = Math.max(...Array.from(this.connectionCounts.values()), 0);

    return {
      totalConnections: this.metrics.totalConnections,
      connectionsByRoom: new Map(this.connectionCounts),
      queuedByRoom,
      averageConnectionsPerRoom: Math.round(averageConnectionsPerRoom * 100) / 100,
      peakConnections
    };
  }

  /**
   * Update configuration
   */
  updateConfiguration(newConfig: { [K in keyof ConnectionPoolConfig]?: ConnectionPoolConfig[K] | undefined }): void {
    const oldConfig = { ...this.config };
    const filteredConfig = Object.fromEntries(
      Object.entries(newConfig).filter(([, v]) => v !== undefined)
    ) as Partial<ConnectionPoolConfig>;
    this.config = { ...this.config, ...filteredConfig };

    loggingService.logInfo('Connection optimization configuration updated', {
      oldConfig,
      newConfig: this.config
    });
  }

  /**
   * Get current configuration
   */
  getConfiguration(): ConnectionPoolConfig {
    return { ...this.config };
  }

  /**
   * Force flush all message batches
   */
  flushAllBatches(): void {
    const roomIds = Array.from(this.messageBatches.keys());
    for (const roomId of roomIds) {
      this.flushMessageBatch(roomId);
    }

    loggingService.logInfo('All message batches flushed', {
      roomCount: roomIds.length
    });
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    totalQueued: number;
    queuesByRoom: Array<{ roomId: string; queueSize: number; maxSize: number }>;
    longestWaitTime: number;
  } {
    let totalQueued = 0;
    let longestWaitTime = 0;
    const queuesByRoom: Array<{ roomId: string; queueSize: number; maxSize: number }> = [];

    for (const [roomId, queue] of this.connectionQueue.entries()) {
      totalQueued += queue.length;
      queuesByRoom.push({
        roomId,
        queueSize: queue.length,
        maxSize: this.config.connectionQueueSize
      });

      // Calculate longest wait time (simplified)
      if (queue.length > 0) {
        longestWaitTime = Math.max(longestWaitTime, this.config.connectionTimeout);
      }
    }

    return {
      totalQueued,
      queuesByRoom,
      longestWaitTime
    };
  }

  /**
   * Shutdown the optimization service
   */
  shutdown(): void {
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = null;
    }

    // Clear all batch timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    // Flush all remaining batches
    this.flushAllBatches();

    loggingService.logInfo('ConnectionOptimizationService shutdown completed', {
      finalMetrics: this.metrics
    });
  }
}
import type { Socket, Namespace } from 'socket.io';
import type { PerformanceMonitoringService } from '../performance/PerformanceMonitoringService';
import { BackendErrorRecoveryService, BackendErrorType } from '../resilience/BackendErrorRecoveryService';
import type { ConnectionHealthService } from '../resilience/ConnectionHealthService';
import { sanitizeEventData as sanitizeEventDataShared } from './sanitizeEventData';

export abstract class BaseSocketHandler {
  protected performanceMonitoring: PerformanceMonitoringService | null = null;
  protected connectionHealth: ConnectionHealthService | null = null;
  protected errorRecoveryService: BackendErrorRecoveryService;

  constructor() {
    this.errorRecoveryService = new BackendErrorRecoveryService();
  }

  /**
   * Set performance monitoring services
   */
  public setPerformanceServices(
    performanceMonitoring: PerformanceMonitoringService,
    connectionHealth: ConnectionHealthService
  ): void {
    this.performanceMonitoring = performanceMonitoring;
    this.connectionHealth = connectionHealth;
  }

  /**
   * Wrapper to track performance and handle errors for room events
   */
  protected trackRoomEvent<T>(
    roomId: string,
    eventName: string,
    handler: (socket: Socket, data: T, namespace?: Namespace) => Promise<void> | void
  ): (socket: Socket, data: T) => void {
    return async (socket: Socket, data: T) => {
      const startTime = Date.now();

      try {
        await handler(socket, data, socket.nsp);

        const duration = Date.now() - startTime;
        if (this.performanceMonitoring != null) {
          this.performanceMonitoring.recordRoomEvent(roomId, eventName, duration);
        }
      } catch (error) {
        const duration = Date.now() - startTime;

        // Record performance error
        if (this.performanceMonitoring != null) {
          this.performanceMonitoring.recordRoomError(roomId, error as Error, {
            eventName,
            socketId: socket.id,
            duration
          });
        }

        // Handle error through recovery service
        await this.errorRecoveryService.handleError({
          errorType: this.classifyError(error as Error, eventName),
          message: `Error in ${eventName}: ${(error as Error).message}`,
          originalError: error as Error,
          socketId: socket.id,
          roomId,
          namespace: `/room/${roomId}`,
          timestamp: Date.now(),
          additionalData: {
            eventName,
            duration,
            data: this.sanitizeEventData(data)
          }
        }, socket);

        // Don't re-throw to prevent client disconnection unless critical
        if (this.isCriticalError(error as Error)) {
          throw error;
        }
      }
    };
  }

  /**
   * Classify error type based on error and event context
   */
  protected classifyError(error: Error, eventName: string): BackendErrorType {
    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      return BackendErrorType.ValidationError;
    }

    if (errorMessage.includes('rate limit') || errorMessage.includes('too many')) {
      return BackendErrorType.RateLimitError;
    }

    if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
      return BackendErrorType.PermissionError;
    }

    if (errorMessage.includes('session') || eventName.includes('join') || eventName.includes('leave')) {
      return BackendErrorType.SessionManagementError;
    }

    if (errorMessage.includes('room') || errorMessage.includes('state')) {
      return BackendErrorType.RoomStateError;
    }

    if (errorMessage.includes('network') || errorMessage.includes('connection')) {
      return BackendErrorType.NetworkError;
    }

    return BackendErrorType.UnknownError;
  }

  /**
   * Check if error is critical and should cause disconnection
   */
  protected isCriticalError(error: Error): boolean {
    const criticalPatterns = [
      'out of memory',
      'stack overflow',
      'database connection lost',
      'server shutting down'
    ];

    const errorMessage = error.message.toLowerCase();
    return criticalPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Sanitize event data for logging (remove sensitive information).
   * Shared implementation in sanitizeEventData.ts (single source of truth —
   * previously duplicated in NamespaceEventHandlers.ts, which now imports it).
   */
  protected sanitizeEventData(data: unknown): unknown {
    return sanitizeEventDataShared(data);
  }
}

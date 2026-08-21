import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import type { PerformanceMonitoringService } from '../shared/infrastructure/performance/PerformanceMonitoringService';
import type { ConnectionHealthService } from '../shared/infrastructure/resilience/ConnectionHealthService';
import type { NamespaceCleanupService } from '../shared/infrastructure/namespace/NamespaceCleanupService';
import type { ConnectionOptimizationService } from '../shared/infrastructure/performance/ConnectionOptimizationService';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { config } from '../config/environment';

const connectionOptimizationConfigSchema = z.object({
  maxConnectionsPerRoom: z.number().int().positive().optional(),
  maxConnectionsGlobal: z.number().int().positive().optional(),
  connectionQueueSize: z.number().int().positive().optional(),
  connectionTimeout: z.number().int().positive().optional(),
  heartbeatInterval: z.number().int().positive().optional(),
  compressionEnabled: z.boolean().optional(),
  batchingEnabled: z.boolean().optional(),
  batchSize: z.number().int().positive().optional(),
  batchDelay: z.number().int().nonnegative().optional(),
});

// Required in production (environment.ts fails fast if unset). In development the key is
// optional: if unset, every request is rejected (endpoints locked) rather than falling back
// to a publicly-known constant.
const PERFORMANCE_API_KEY = config.performance.apiKey;

const requirePerformanceAuth = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!PERFORMANCE_API_KEY || !apiKey || apiKey !== PERFORMANCE_API_KEY) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }
  next();
};

export function createPerformanceRoutes(
  performanceMonitoring: PerformanceMonitoringService,
  connectionHealth: ConnectionHealthService,
  namespaceCleanup: NamespaceCleanupService,
  connectionOptimization: ConnectionOptimizationService
): Router {
  const router = Router();
  router.use(requirePerformanceAuth);

  /**
   * Get system performance metrics
   * Requirements: 11.4
   */
  router.get('/system', (req: Request, res: Response) => {
    try {
      const systemMetrics = performanceMonitoring.getSystemMetrics();
      const performanceSummary = performanceMonitoring.getPerformanceSummary();
      
      res.json({
        success: true,
        data: {
          system: systemMetrics,
          summary: performanceSummary,
          timestamp: new Date().toISOString()
        }
      });

      loggingService.logInfo('System performance metrics requested', {
        systemHealth: systemMetrics.systemHealth,
        totalRooms: systemMetrics.totalRooms,
        totalConnections: systemMetrics.totalConnections
      });

    } catch (error) {
      loggingService.logError(error as Error, { context: 'system_performance_endpoint' });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve system performance metrics'
      });
    }
  });

  /**
   * Get room-specific performance metrics
   * Requirements: 11.1, 11.4
   */
  router.get('/rooms', (req: Request, res: Response) => {
    try {
      const allRoomMetrics = performanceMonitoring.getAllRoomMetrics();
      const roomMetricsArray = Array.from(allRoomMetrics.entries()).map(([roomId, metrics]) => ({
        ...metrics,
        roomId,
        eventCounts: Object.fromEntries(metrics.eventCounts),
        slowEventsCount: metrics.slowEvents.length
      }));

      res.json({
        success: true,
        data: {
          rooms: roomMetricsArray,
          totalRooms: roomMetricsArray.length,
          timestamp: new Date().toISOString()
        }
      });

      loggingService.logInfo('Room performance metrics requested', {
        roomCount: roomMetricsArray.length
      });

    } catch (error) {
      loggingService.logError(error as Error, { context: 'room_performance_endpoint' });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve room performance metrics'
      });
    }
  });

  /**
   * Get performance metrics for a specific room
   * Requirements: 11.1, 11.4
   */
  router.get('/rooms/:roomId', (req: Request, res: Response) => {
    try {
      const { roomId } = req.params;
      
      if (!roomId) {
        return res.status(400).json({
          success: false,
          error: 'Room ID is required'
        });
      }
      
      const roomMetrics = performanceMonitoring.getRoomMetrics(roomId);

      if (!roomMetrics) {
        return res.status(404).json({
          success: false,
          error: 'Room metrics not found'
        });
      }

      res.json({
        success: true,
        data: {
          ...roomMetrics,
          roomId,
          eventCounts: Object.fromEntries(roomMetrics.eventCounts),
          slowEvents: roomMetrics.slowEvents.slice(-10), // Last 10 slow events
          timestamp: new Date().toISOString()
        }
      });

      loggingService.logInfo('Room-specific performance metrics requested', {
        roomId,
        connectionCount: roomMetrics.connectionCount,
        messageCount: roomMetrics.messageCount
      });

      return;

    } catch (error) {
      loggingService.logError(error as Error, { 
        context: 'room_specific_performance_endpoint',
        roomId: req.params.roomId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve room performance metrics'
      });
      return;
    }
  });

  /**
   * Get connection health metrics
   * Requirements: 11.4, 11.5
   */
  router.get('/connections/health', (req: Request, res: Response) => {
    try {
      const healthStatus = connectionHealth.getHealthStatus();
      const allHealthChecks = connectionHealth.getAllHealthChecks();
      
      // Convert health checks to array format
      const healthChecksArray = Array.from(allHealthChecks.entries()).map(([socketId, health]) => ({
        ...health,
        socketId
      }));

      res.json({
        success: true,
        data: {
          status: healthStatus,
          healthChecks: healthChecksArray,
          timestamp: new Date().toISOString()
        }
      });

      loggingService.logInfo('Connection health metrics requested', {
        totalConnections: healthStatus.totalConnections,
        healthyConnections: healthStatus.healthyConnections,
        unhealthyConnections: healthStatus.unhealthyConnections
      });

    } catch (error) {
      loggingService.logError(error as Error, { context: 'connection_health_endpoint' });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve connection health metrics'
      });
    }
  });

  /**
   * Get connection optimization metrics
   * Requirements: 11.2
   */
  router.get('/connections/optimization', (req: Request, res: Response) => {
    try {
      const optimizationMetrics = connectionOptimization.getOptimizationMetrics();
      const connectionStats = connectionOptimization.getConnectionStats();
      const queueStatus = connectionOptimization.getQueueStatus();
      const configuration = connectionOptimization.getConfiguration();

      res.json({
        success: true,
        data: {
          metrics: optimizationMetrics,
          stats: {
            ...connectionStats,
            connectionsByRoom: Object.fromEntries(connectionStats.connectionsByRoom),
            queuedByRoom: Object.fromEntries(connectionStats.queuedByRoom)
          },
          queue: queueStatus,
          configuration,
          timestamp: new Date().toISOString()
        }
      });

      loggingService.logInfo('Connection optimization metrics requested', {
        totalConnections: optimizationMetrics.totalConnections,
        queuedConnections: optimizationMetrics.queuedConnections,
        rejectedConnections: optimizationMetrics.rejectedConnections
      });

    } catch (error) {
      loggingService.logError(error as Error, { context: 'connection_optimization_endpoint' });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve connection optimization metrics'
      });
    }
  });

  /**
   * Get namespace cleanup metrics
   * Requirements: 11.3
   */
  router.get('/cleanup', (req: Request, res: Response) => {
    try {
      const cleanupMetrics = namespaceCleanup.getCleanupMetrics();
      const cleanupStatus = namespaceCleanup.getCleanupStatus();
      const cleanupRules = namespaceCleanup.getCleanupRules();

      res.json({
        success: true,
        data: {
          metrics: cleanupMetrics,
          status: cleanupStatus,
          rules: cleanupRules.map(rule => ({
            name: rule.name,
            priority: rule.priority
          })),
          timestamp: new Date().toISOString()
        }
      });

      loggingService.logInfo('Namespace cleanup metrics requested', {
        namespacesCleanedUp: cleanupMetrics.namespacesCleanedUp,
        sessionsCleanedUp: cleanupMetrics.sessionsCleanedUp,
        memoryFreed: cleanupMetrics.memoryFreed
      });

    } catch (error) {
      loggingService.logError(error as Error, { context: 'cleanup_metrics_endpoint' });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve cleanup metrics'
      });
    }
  });

  /**
   * Force immediate cleanup
   * Requirements: 11.3
   */
  router.post('/cleanup/force', async (req: Request, res: Response) => {
    try {
      const cleanupMetrics = await namespaceCleanup.forceCleanup();

      res.json({
        success: true,
        data: {
          message: 'Cleanup completed successfully',
          metrics: cleanupMetrics,
          timestamp: new Date().toISOString()
        }
      });

      loggingService.logInfo('Forced cleanup completed via API', {
        namespacesCleanedUp: cleanupMetrics.namespacesCleanedUp,
        sessionsCleanedUp: cleanupMetrics.sessionsCleanedUp
      });

    } catch (error) {
      loggingService.logError(error as Error, { context: 'force_cleanup_endpoint' });
      res.status(500).json({
        success: false,
        error: 'Failed to perform cleanup'
      });
    }
  });

  /**
   * Update connection optimization configuration
   * Requirements: 11.2
   */
  router.put('/connections/optimization/config', (req: Request, res: Response) => {
    try {
      const bodyParse = connectionOptimizationConfigSchema.safeParse(req.body);
      if (!bodyParse.success) {
        res.status(400).json({ success: false, error: bodyParse.error.issues[0]?.message ?? 'Invalid configuration' });
        return;
      }

      connectionOptimization.updateConfiguration(bodyParse.data);
      const updatedConfig = connectionOptimization.getConfiguration();

      res.json({
        success: true,
        data: {
          message: 'Configuration updated successfully',
          configuration: updatedConfig,
          timestamp: new Date().toISOString()
        }
      });

      loggingService.logInfo('Connection optimization configuration updated via API', {
        updatedFields: Object.keys(bodyParse.data),
        newConfig: bodyParse.data
      });

    } catch (error) {
      loggingService.logError(error as Error, { context: 'update_optimization_config_endpoint' });
      res.status(500).json({
        success: false,
        error: 'Failed to update configuration'
      });
    }
  });

  /**
   * Get comprehensive performance dashboard data
   * Requirements: 11.4
   */
  router.get('/dashboard', (req: Request, res: Response) => {
    try {
      const systemMetrics = performanceMonitoring.getSystemMetrics();
      const performanceSummary = performanceMonitoring.getPerformanceSummary();
      const healthStatus = connectionHealth.getHealthStatus();
      const optimizationMetrics = connectionOptimization.getOptimizationMetrics();
      const connectionStats = connectionOptimization.getConnectionStats();
      const cleanupStatus = namespaceCleanup.getCleanupStatus();

      res.json({
        success: true,
        data: {
          system: {
            health: systemMetrics.systemHealth,
            uptime: systemMetrics.uptime,
            memory: systemMetrics.gcMetrics,
            totalRooms: systemMetrics.totalRooms,
            totalConnections: systemMetrics.totalConnections,
            averageLatency: systemMetrics.averageRoomLatency
          },
          connections: {
            total: optimizationMetrics.totalConnections,
            healthy: healthStatus.healthyConnections,
            unhealthy: healthStatus.unhealthyConnections,
            queued: optimizationMetrics.queuedConnections,
            rejected: optimizationMetrics.rejectedConnections,
            averagePerRoom: connectionStats.averageConnectionsPerRoom
          },
          performance: {
            topRooms: performanceSummary.topPerformingRooms,
            slowestRooms: performanceSummary.slowestRooms,
            messagesBatched: optimizationMetrics.messagesBatched,
            optimizationsSaved: optimizationMetrics.optimizationsSaved
          },
          cleanup: {
            isRunning: cleanupStatus.isRunning,
            memoryPressure: cleanupStatus.memoryPressure,
            namespacesCleanedUp: cleanupStatus.metrics.namespacesCleanedUp,
            memoryFreed: cleanupStatus.metrics.memoryFreed
          },
          timestamp: new Date().toISOString()
        }
      });

      loggingService.logInfo('Performance dashboard data requested', {
        systemHealth: systemMetrics.systemHealth,
        totalConnections: optimizationMetrics.totalConnections,
        totalRooms: systemMetrics.totalRooms
      });

    } catch (error) {
      loggingService.logError(error as Error, { context: 'performance_dashboard_endpoint' });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve dashboard data'
      });
    }
  });

  /**
   * Health check endpoint for monitoring systems
   */
  router.get('/health', (req: Request, res: Response) => {
    try {
      const systemMetrics = performanceMonitoring.getSystemMetrics();
      const healthStatus = connectionHealth.getHealthStatus();
      
      const isHealthy = systemMetrics.systemHealth !== 'critical' && 
                       healthStatus.unhealthyConnections < healthStatus.totalConnections * 0.2;

      res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        data: {
          status: isHealthy ? 'healthy' : 'unhealthy',
          systemHealth: systemMetrics.systemHealth,
          uptime: systemMetrics.uptime,
          memoryUsage: systemMetrics.totalMemoryUsage,
          totalConnections: healthStatus.totalConnections,
          healthyConnections: healthStatus.healthyConnections,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      loggingService.logError(error as Error, { context: 'health_check_endpoint' });
      res.status(500).json({
        success: false,
        error: 'Health check failed'
      });
    }
  });

  return router;
}
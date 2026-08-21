import type { Request, Response, NextFunction } from 'express';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { generateId } from '../shared/utils/id';

// Performance monitoring interface
interface PerformanceMetrics {
  requestCount: number;
  totalResponseTime: number;
  averageResponseTime: number;
  errorCount: number;
  successCount: number;
  lastRequestTime: Date;
}

// System monitoring class
class SystemMonitor {
  private static instance: SystemMonitor | undefined;
  private readonly metrics: Map<string, PerformanceMetrics> = new Map();
  private readonly startTime: Date = new Date();
  private readonly healthChecks: Map<string, () => boolean> = new Map();

  private constructor() {
    this.initializeHealthChecks();
  }

  static getInstance(): SystemMonitor {
    if (!SystemMonitor.instance) {
      SystemMonitor.instance = new SystemMonitor();
    }
    return SystemMonitor.instance;
  }

  // Record request metrics
  recordRequest(endpoint: string, duration: number, statusCode: number): void {
    if (!this.metrics.has(endpoint)) {
      this.metrics.set(endpoint, {
        requestCount: 0,
        totalResponseTime: 0,
        averageResponseTime: 0,
        errorCount: 0,
        successCount: 0,
        lastRequestTime: new Date(),
      });
    }

    const metric = this.metrics.get(endpoint)!;
    metric.requestCount++;
    metric.totalResponseTime += duration;
    metric.averageResponseTime = metric.totalResponseTime / metric.requestCount;
    metric.lastRequestTime = new Date();

    if (statusCode >= 400) {
      metric.errorCount++;
    } else {
      metric.successCount++;
    }

    // Log performance metrics
    loggingService.logPerformanceMetric('request_duration', duration, {
      endpoint,
      statusCode,
      averageResponseTime: metric.averageResponseTime,
    });
  }

  // Get system health status
  getSystemHealth(): { status: 'healthy' | 'warning' | 'error'; details: Record<string, unknown> } {
    const healthResults = new Map<string, boolean>();
    let hasWarnings = false;
    let hasErrors = false;

    // Run all health checks
    for (const [name, check] of this.healthChecks) {
      try {
        const isHealthy = check();
        healthResults.set(name, isHealthy);
        if (!isHealthy) hasWarnings = true;
      } catch (error) {
        healthResults.set(name, false);
        hasErrors = true;
        loggingService.logError(error as Error, { healthCheck: name });
      }
    }

    // Determine overall status
    let status: 'healthy' | 'warning' | 'error' = 'healthy';
    if (hasErrors) {
      status = 'error';
    } else if (hasWarnings) {
      status = 'warning';
    }

    const details = {
      healthChecks: Object.fromEntries(healthResults),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };

    loggingService.logSystemHealth('system', status, details);
    return { status, details };
  }

  // Get performance metrics
  getPerformanceMetrics(): Map<string, PerformanceMetrics> {
    return new Map(this.metrics);
  }

  // Reset metrics (useful for testing)
  resetMetrics(): void {
    this.metrics.clear();
    loggingService.logUserActivity('Performance metrics reset', 'system');
  }

  private initializeHealthChecks(): void {
    // Memory usage health check
    this.healthChecks.set('memory', () => {
      const memUsage = process.memoryUsage();
      const memUsageMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024),
      };
      
      // Log memory usage
      loggingService.logPerformanceMetric('memory_usage', memUsageMB.heapUsed, {
        rss: memUsageMB.rss,
        heapTotal: memUsageMB.heapTotal,
        external: memUsageMB.external,
        arrayBuffers: memUsageMB.arrayBuffers,
        heapUtilization: Math.round((memUsageMB.heapUsed / memUsageMB.heapTotal) * 100),
      });

      // Warning if memory usage is high
      if (memUsageMB.heapUsed > 500) { // 500MB threshold
        loggingService.logSystemHealth('memory', 'warning', {
          usage: memUsageMB,
          threshold: '500MB',
        });
        return false;
      }
      
      // Critical if memory usage is very high
      if (memUsageMB.heapUsed > 800) { // 800MB threshold
        loggingService.logSystemHealth('memory', 'error', {
          usage: memUsageMB,
          threshold: '800MB',
        });
        return false;
      }
      
      return true;
    });

    // Uptime health check
    this.healthChecks.set('uptime', () => {
      const uptime = process.uptime();
      const uptimeHours = Math.round(uptime / 3600);
      
      loggingService.logPerformanceMetric('uptime', uptime, {
        hours: uptimeHours,
        startTime: this.startTime.toISOString(),
      });

      return true;
    });

    // Event loop lag health check
    this.healthChecks.set('eventLoop', () => {
      const start = Date.now();
      setImmediate(() => {
        const lag = Date.now() - start;
        loggingService.logPerformanceMetric('event_loop_lag', lag);
        
        if (lag > 100) { // 100ms threshold
          loggingService.logSystemHealth('eventLoop', 'warning', {
            lag: `${lag}ms`,
            threshold: '100ms',
          });
        }
      });
      
      return true;
    });
  }
}

// Export singleton instance
export const systemMonitor = SystemMonitor.getInstance();

// Request monitoring middleware
export const requestMonitor = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const endpoint = `${req.method} ${req.path}`;

  // Add request ID for tracking
  req.requestId = generateId('req');

  // Log request start
  loggingService.logHttpRequest(req, res, 0, 0);

  // Override res.end to capture response metrics
  const originalEnd = res.end;
  res.end = function(chunk?: unknown, encoding?: unknown): Response {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Record metrics
    systemMonitor.recordRequest(endpoint, duration, statusCode);

    // Log response
    loggingService.logHttpRequest(req, res, duration, statusCode);

    // Call original end method and return response
    return originalEnd.call(this, chunk, encoding as BufferEncoding);
  };

  next();
};

// Performance monitoring middleware
export const performanceMonitor = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Monitor slow requests
  const timeout = setTimeout(() => {
    loggingService.logSecurityEvent('Slow Request Warning', {
      method: req.method,
      url: req.url,
      duration: `${Date.now() - startTime}ms`,
      threshold: '5000ms',
    }, 'warn');
  }, 5000);

  // Clean up timeout when response is sent
  res.on('finish', () => {
    clearTimeout(timeout);
    const duration = Date.now() - startTime;
    
    if (duration > 1000) {
      loggingService.logSecurityEvent('Slow Request', {
        method: req.method,
        url: req.url,
        duration: `${duration}ms`,
        statusCode: res.statusCode,
      }, 'warn');
    }
  });

  next();
};

// Error monitoring middleware
export const errorMonitor = (error: Error, req: Request, res: Response, next: NextFunction): void => {
  // Log error with context
  loggingService.logError(error, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.requestId,
  });

  // Update error metrics
  const endpoint = `${req.method} ${req.path}`;
  const metric = systemMonitor.getPerformanceMetrics().get(endpoint);
  if (metric) {
    metric.errorCount++;
  }

  next(error);
};

// Health check endpoint data
export const getHealthCheckData = () => {
  const health = systemMonitor.getSystemHealth();
  const metrics = systemMonitor.getPerformanceMetrics();
  
  return {
    status: health.status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    health: health.details,
    performance: Object.fromEntries(metrics),
  };
}; 

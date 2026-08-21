import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { config } from '../../../config/environment';

// Log levels configuration
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Log colors for console output
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to Winston
winston.addColors(logColors);

// Create logs directory if it doesn't exist (only in development)
const logsDir = path.join(process.cwd(), 'logs');

// Custom format for logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf((info: winston.Logform.TransformableInfo) => {
    const { timestamp, level, message, ...meta } = info;
    let log = `${String(timestamp)} [${String(level)}]: ${String(message)}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return log;
  })
);

// Create Winston logger
export const logger = winston.createLogger({
  levels: logLevels,
  level: config.logging.level,
  format: logFormat,
  transports: [
    // Console transport (always isEnabled)
    new winston.transports.Console({
      format: consoleFormat,
      level: config.logging.level,
    }),
    
    // File transports only in development
    ...(config.nodeEnv === 'development' ? [
      // Error log file (daily rotation)
      new DailyRotateFile({
        filename: path.join(logsDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '30d',
        zippedArchive: true,
      }),
      
      // Combined log file (daily rotation)
      new DailyRotateFile({
        filename: path.join(logsDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        zippedArchive: true,
      }),
      
      // HTTP requests log file (daily rotation)
      new DailyRotateFile({
        filename: path.join(logsDir, 'http-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'http',
        maxSize: '20m',
        maxFiles: '7d',
        zippedArchive: true,
      }),
      
      // Security events log file (daily rotation)
      new DailyRotateFile({
        filename: path.join(logsDir, 'security-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d',
        zippedArchive: true,
      }),
    ] : []),
  ],
});

// Handle uncaught exceptions and unhandled rejections via Winston
// (complements the manual process.on handlers in src/index.ts)
logger.exceptions.handle(
  new winston.transports.File({ filename: path.join(logsDir, 'exceptions.log') })
);

// Logging service class for structured logging
export class LoggingService {
  private static instance: LoggingService | undefined;
  
  private constructor() {}
  
  static getInstance(): LoggingService {
    if (!LoggingService.instance) {
      LoggingService.instance = new LoggingService();
    }
    return LoggingService.instance;
  }

  // HTTP request logging
  logHttpRequest(req: unknown, res: unknown, duration: number, statusCode: number): void {
    const reqObj = req as Record<string, unknown>;
    const reqWithGet = reqObj as { get?(name: string): string | undefined };
    const logData: Record<string, unknown> = {
      method: reqObj.method,
      url: reqObj.url,
      statusCode,
      duration: `${duration}ms`,
      ip: (reqObj.ip !== undefined ? String(reqObj.ip) : undefined) ?? ((reqObj.connection as Record<string, unknown>).remoteAddress as string),
      userAgent: reqWithGet.get?.('User-Agent'),
      referer: reqWithGet.get?.('Referer'),
      timestamp: new Date().toISOString(),
      userId: reqObj.userId !== undefined ? String(reqObj.userId) : 'anonymous',
      sessionId: reqObj.sessionId !== undefined ? String(reqObj.sessionId) : 'none',
    };

    if (statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  }

  // Socket event logging
  logSocketEvent(eventName: string, socket: unknown, data: unknown, duration?: number, error?: unknown): void {
    const socketObj = socket as Record<string, unknown>;
    const logData: Record<string, unknown> = {
      event: eventName,
      socketId: socketObj.id,
      userId: socketObj.data !== undefined ? String((socketObj.data as Record<string, unknown>).userId) : 'anonymous',
      roomId: socketObj.data !== undefined ? String((socketObj.data as Record<string, unknown>).roomId) : 'none',
      ip: (socketObj.handshake as Record<string, unknown>).address,
      userAgent: ((socketObj.handshake as Record<string, unknown>).headers as Record<string, unknown>)['user-agent'] as string | undefined,
      data: data != null ? JSON.stringify(data).substring(0, 500) : undefined,
      duration: duration != null ? `${duration}ms` : undefined,
      error: error != null ? (error instanceof Error ? error.message : String(error)) : undefined,
      timestamp: new Date().toISOString(),
    };

    if (error != null) {
      logger.error('Socket Event Error', logData);
    } else if (duration != null && duration > 1000) {
      logger.warn('Slow Socket Event', logData);
    } else {
      logger.info('Socket Event', logData);
    }
  }

  // Security event logging
  logSecurityEvent(event: string, details: unknown, level: 'info' | 'warn' | 'error' = 'info'): void {
    const logData = {
      securityEvent: event,
      ...(details as Record<string, unknown>),
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
    };

    switch (level) {
      case 'error':
        logger.error('Security Event', logData);
        break;
      case 'warn':
        logger.warn('Security Event', logData);
        break;
      case 'info':
        logger.info('Security Event', logData);
        break;
    }
  }

  // Rate limit violation logging
  logRateLimitViolation(identifier: string, eventType: string, limit: number, window: number): void {
    this.logSecurityEvent('Rate Limit Violation', {
      identifier,
      eventType,
      limit,
      window: `${window}ms`,
      ip: identifier.includes('.') ? identifier : undefined,
      userId: identifier.includes('.') ? undefined : identifier,
    }, 'warn');
  }

  // Validation failure logging
  logValidationFailure(event: string, data: unknown, errors: string[]): void {
    this.logSecurityEvent('Validation Failure', {
      event,
      data: JSON.stringify(data).substring(0, 200),
      errors,
    }, 'warn');
  }

  // Performance monitoring
  logPerformanceMetric(metric: string, value: number, context: unknown = {}): void {
    logger.info('Performance Metric', {
      metric,
      value,
      unit: 'ms',
      context,
      timestamp: new Date().toISOString(),
    });
  }

  // Error logging with context
  logError(error: Error, context: unknown = {}): void {
    logger.error('Application Error', {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  // Info logging
  logInfo(message: string, context: unknown = {}): void {
    logger.info('Info', {
      message,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  // Warning logging
  logWarn(message: string, context: unknown = {}): void {
    logger.warn('Warning', {
      message,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  // Room activity logging
  logRoomActivity(activity: string, roomId: string, userId: string, details: unknown = {}): void {
    logger.info('Room Activity', {
      activity,
      roomId,
      userId,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  // User activity logging
  logUserActivity(activity: string, userId: string, details: unknown = {}): void {
    logger.info('User Activity', {
      activity,
      userId,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  // System health logging
  logSystemHealth(component: string, status: 'healthy' | 'warning' | 'error', details: unknown = {}): void {
    const level = status === 'error' ? 'error' : status === 'warning' ? 'warn' : 'info';
    
    logger[level]('System Health', {
      component,
      status,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  // Cleanup old log files
  async cleanupOldLogs(): Promise<void> {
    try {
      // Winston handles rotation automatically, but we can add custom cleanup logic here
      logger.info('Log cleanup completed', { timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('Log cleanup failed', { 
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString() 
      });
    }
  }

  // Shutdown the logger
  shutdown(): void {
    logger.end();
  }
}

// Export singleton instance
export const loggingService = LoggingService.getInstance();

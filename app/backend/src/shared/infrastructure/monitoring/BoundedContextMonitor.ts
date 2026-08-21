/**
 * Performance monitoring for bounded contexts
 * Requirements: 8.1, 8.2
 */

import type { PerformanceMetrics } from './PerformanceMetrics';
import { performanceMetrics } from './PerformanceMetrics';
import { getHighResolutionTime, calculateProcessingTime } from '@jam-band/shared';

export interface BoundedContextMetrics {
  contextName: string;
  operationCount: number;
  averageResponseTime: number;
  errorCount: number;
  slowOperations: number;
  memoryUsage: number;
  lastActivity: Date;
  healthStatus: 'healthy' | 'warning' | 'critical';
}

export interface OperationMetrics {
  operationName: string;
  duration: number;
  timestamp: number;
  success: boolean;
  error?: string;
  contextName: string;
}

export class BoundedContextMonitor {
  private readonly contextMetrics = new Map<string, BoundedContextMetrics>();
  private operationHistory: OperationMetrics[] = [];
  private readonly maxOperationHistory = 10000;
  private readonly slowOperationThreshold = 100; // 100ms
  private readonly errorRateThreshold = 0.05; // 5%

  constructor(private readonly metrics: PerformanceMetrics = performanceMetrics) {}

  /**
   * Monitor an operation within a bounded context
   */
  async monitorOperation<T>(
    contextName: string,
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = getHighResolutionTime();

    try {
      const result = await operation();
      const duration = calculateProcessingTime(startTime);

      this.recordOperation({
        operationName,
        duration,
        timestamp: Date.now(),
        success: true,
        contextName
      });

      this.updateContextMetrics(contextName, duration, true);

      // Record to global metrics
      this.metrics.recordDuration(
        `${contextName}.${operationName}`,
        duration,
        contextName,
        { status: 'success' }
      );

      return result;
    } catch (error) {
      const duration = calculateProcessingTime(startTime);

      this.recordOperation({
        operationName,
        duration,
        timestamp: Date.now(),
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        contextName
      });

      this.updateContextMetrics(contextName, duration, false);

      // Record to global metrics
      this.metrics.recordDuration(
        `${contextName}.${operationName}`,
        duration,
        contextName,
        { status: 'error' }
      );

      this.metrics.recordCounter(
        `${contextName}.errors`,
        1,
        contextName,
        { operation: operationName }
      );

      throw error;
    }
  }

  /**
   * Record memory usage for a context
   */
  recordMemoryUsage(contextName: string, memoryUsage: number): void {
    const context = this.getOrCreateContextMetrics(contextName);
    context.memoryUsage = memoryUsage;
    context.lastActivity = new Date();

    this.metrics.recordGauge(
      `${contextName}.memory`,
      memoryUsage,
      contextName
    );
  }

  /**
   * Get metrics for a specific context
   */
  getContextMetrics(contextName: string): BoundedContextMetrics | undefined {
    return this.contextMetrics.get(contextName);
  }

  /**
   * Get all context metrics
   */
  getAllContextMetrics(): Map<string, BoundedContextMetrics> {
    return new Map(this.contextMetrics);
  }

  /**
   * Get operation history for a context
   */
  getOperationHistory(contextName?: string): OperationMetrics[] {
    if (contextName) {
      return this.operationHistory.filter(op => op.contextName === contextName);
    }
    return [...this.operationHistory];
  }

  /**
   * Analyze performance across all contexts
   */
  analyzePerformance(): {
    totalContexts: number;
    healthyContexts: number;
    warningContexts: number;
    criticalContexts: number;
    slowestContext: string | null;
    mostErrorProneContext: string | null;
    recommendations: string[];
  } {
    const contexts = Array.from(this.contextMetrics.values());
    const recommendations: string[] = [];

    const healthyContexts = contexts.filter(c => c.healthStatus === 'healthy').length;
    const warningContexts = contexts.filter(c => c.healthStatus === 'warning').length;
    const criticalContexts = contexts.filter(c => c.healthStatus === 'critical').length;

    // Find slowest context
    const slowestContext = contexts.reduce((slowest: BoundedContextMetrics | null, current) => {
      return current.averageResponseTime > (slowest?.averageResponseTime ?? 0) ? current : slowest;
    }, null as BoundedContextMetrics | null);

    // Find most error-prone context
    const mostErrorProneContext = contexts.reduce((mostErrors, current) => {
      const currentErrorRate = current.errorCount / Math.max(current.operationCount, 1);
      const mostErrorsRate = mostErrors != null ? mostErrors.errorCount / Math.max(mostErrors.operationCount, 1) : 0;
      return currentErrorRate > mostErrorsRate ? current : mostErrors;
    }, null as BoundedContextMetrics | null);

    // Generate recommendations
    if (criticalContexts > 0) {
      recommendations.push(`${criticalContexts} contexts in critical state - immediate attention required`);
    }

    if (warningContexts > 0) {
      recommendations.push(`${warningContexts} contexts showing performance degradation`);
    }

    if (slowestContext && slowestContext.averageResponseTime > this.slowOperationThreshold) {
      recommendations.push(`Context "${slowestContext.contextName}" has high average response time (${slowestContext.averageResponseTime.toFixed(2)}ms)`);
    }

    if (mostErrorProneContext) {
      const errorRate = mostErrorProneContext.errorCount / Math.max(mostErrorProneContext.operationCount, 1);
      if (errorRate > this.errorRateThreshold) {
        recommendations.push(`Context "${mostErrorProneContext.contextName}" has high error rate (${(errorRate * 100).toFixed(1)}%)`);
      }
    }

    return {
      totalContexts: contexts.length,
      healthyContexts,
      warningContexts,
      criticalContexts,
      slowestContext: slowestContext?.contextName || null,
      mostErrorProneContext: mostErrorProneContext?.contextName || null,
      recommendations
    };
  }

  /**
   * Get performance summary for monitoring dashboard
   */
  getPerformanceSummary(): {
    contexts: BoundedContextMetrics[];
    recentOperations: OperationMetrics[];
    systemHealth: 'healthy' | 'warning' | 'critical';
    alerts: string[];
  } {
    const contexts = Array.from(this.contextMetrics.values());
    const recentOperations = this.operationHistory
      .filter(op => Date.now() - op.timestamp < 60000) // Last minute
      .slice(-50); // Last 50 operations

    // Determine overall system health
    const criticalContexts = contexts.filter(c => c.healthStatus === 'critical').length;
    const warningContexts = contexts.filter(c => c.healthStatus === 'warning').length;

    let systemHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (criticalContexts > 0) {
      systemHealth = 'critical';
    } else if (warningContexts > 0) {
      systemHealth = 'warning';
    }

    // Generate alerts
    const alerts: string[] = [];
    contexts.forEach(context => {
      if (context.healthStatus === 'critical') {
        alerts.push(`CRITICAL: ${context.contextName} - ${context.errorCount} errors, ${context.averageResponseTime.toFixed(2)}ms avg response`);
      } else if (context.healthStatus === 'warning') {
        alerts.push(`WARNING: ${context.contextName} - Performance degradation detected`);
      }
    });

    return {
      contexts,
      recentOperations,
      systemHealth,
      alerts
    };
  }

  /**
   * Clear metrics for a context (useful for testing)
   */
  clearContextMetrics(contextName?: string): void {
    if (contextName) {
      this.contextMetrics.delete(contextName);
      this.operationHistory = this.operationHistory.filter(op => op.contextName !== contextName);
    } else {
      this.contextMetrics.clear();
      this.operationHistory = [];
    }
  }

  private recordOperation(operation: OperationMetrics): void {
    this.operationHistory.push(operation);

    // Prevent memory leaks
    if (this.operationHistory.length > this.maxOperationHistory) {
      this.operationHistory = this.operationHistory.slice(-this.maxOperationHistory);
    }
  }

  private updateContextMetrics(contextName: string, duration: number, success: boolean): void {
    const context = this.getOrCreateContextMetrics(contextName);

    context.operationCount++;
    context.lastActivity = new Date();

    if (!success) {
      context.errorCount++;
    }

    if (duration > this.slowOperationThreshold) {
      context.slowOperations++;
    }

    // Update average response time (exponential moving average)
    const alpha = 0.1; // Smoothing factor
    context.averageResponseTime = context.averageResponseTime === 0
      ? duration
      : (alpha * duration) + ((1 - alpha) * context.averageResponseTime);

    // Update health status
    context.healthStatus = this.calculateHealthStatus(context);
  }

  private getOrCreateContextMetrics(contextName: string): BoundedContextMetrics {
    let context = this.contextMetrics.get(contextName);
    
    if (!context) {
      context = {
        contextName,
        operationCount: 0,
        averageResponseTime: 0,
        errorCount: 0,
        slowOperations: 0,
        memoryUsage: 0,
        lastActivity: new Date(),
        healthStatus: 'healthy'
      };
      this.contextMetrics.set(contextName, context);
    }

    return context;
  }

  private calculateHealthStatus(context: BoundedContextMetrics): 'healthy' | 'warning' | 'critical' {
    const errorRate = context.errorCount / Math.max(context.operationCount, 1);
    const slowOperationRate = context.slowOperations / Math.max(context.operationCount, 1);

    // Critical conditions
    if (errorRate > 0.2 || context.averageResponseTime > 1000 || slowOperationRate > 0.5) {
      return 'critical';
    }

    // Warning conditions
    if (errorRate > this.errorRateThreshold || context.averageResponseTime > this.slowOperationThreshold || slowOperationRate > 0.2) {
      return 'warning';
    }

    return 'healthy';
  }
}

// Singleton instance for application-wide context monitoring
export const boundedContextMonitor = new BoundedContextMonitor();
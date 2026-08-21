/**
 * Specialized monitoring for event processing performance
 */

import { performanceMetrics } from './PerformanceMetrics';
import { getHighResolutionTime, calculateProcessingTime } from '@jam-band/shared';

export interface EventMetrics {
  eventType: string;
  processingTime: number;
  handlerCount: number;
  timestamp: number;
  success: boolean;
  error?: string;
}

export class EventProcessingMonitor {
  private eventMetrics: EventMetrics[] = [];
  private readonly maxEvents = 5000;

  /**
   * Monitor event processing performance
   */
  async monitorEventProcessing<T>(
    eventType: string,
    handlerCount: number,
    processingFn: () => Promise<T>
  ): Promise<T> {
    const startTime = getHighResolutionTime();

    try {
      const result = await processingFn();
      const processingTime = calculateProcessingTime(startTime);

      this.recordEventMetrics({
        eventType,
        processingTime,
        handlerCount,
        timestamp: Date.now(),
        success: true
      });

      // Record to global metrics
      performanceMetrics.recordDuration(
        'event.processing',
        processingTime,
        'event-system',
        { eventType, handlerCount: handlerCount.toString(), status: 'success' }
      );

      performanceMetrics.recordCounter(
        'event.processed',
        1,
        'event-system',
        { eventType, status: 'success' }
      );

      return result;
    } catch (error) {
      const processingTime = calculateProcessingTime(startTime);

      this.recordEventMetrics({
        eventType,
        processingTime,
        handlerCount,
        timestamp: Date.now(),
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Record to global metrics
      performanceMetrics.recordDuration(
        'event.processing',
        processingTime,
        'event-system',
        { eventType, handlerCount: handlerCount.toString(), status: 'error' }
      );

      performanceMetrics.recordCounter(
        'event.errors',
        1,
        'event-system',
        { eventType, error: error instanceof Error ? error.constructor.name : 'UnknownError' }
      );

      throw error;
    }
  }

  /**
   * Get event processing statistics
   */
  getEventStats(eventType?: string): {
    totalEvents: number;
    averageProcessingTime: number;
    successRate: number;
    slowestEvent: number;
    fastestEvent: number;
  } {
    const events = eventType
      ? this.eventMetrics.filter(e => e.eventType === eventType)
      : this.eventMetrics;

    if (events.length === 0) {
      return {
        totalEvents: 0,
        averageProcessingTime: 0,
        successRate: 0,
        slowestEvent: 0,
        fastestEvent: 0
      };
    }

    const processingTimes = events.map(e => e.processingTime);
    const successfulEvents = events.filter(e => e.success).length;

    return {
      totalEvents: events.length,
      averageProcessingTime: processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length,
      successRate: successfulEvents / events.length,
      slowestEvent: Math.max(...processingTimes),
      fastestEvent: Math.min(...processingTimes)
    };
  }

  /**
   * Detect performance bottlenecks in event processing
   */
  detectBottlenecks(): {
    slowEvents: EventMetrics[];
    highErrorRateEvents: string[];
    recommendations: string[];
  } {
    const slowThreshold = 100; // 100ms
    const errorRateThreshold = 0.1; // 10%

    const slowEvents = this.eventMetrics.filter(e => e.processingTime > slowThreshold);

    const eventTypes = [...new Set(this.eventMetrics.map(e => e.eventType))];
    const highErrorRateEvents = eventTypes.filter(eventType => {
      const stats = this.getEventStats(eventType);
      return stats.successRate < (1 - errorRateThreshold);
    });

    const recommendations: string[] = [];

    if (slowEvents.length > 0) {
      recommendations.push(`${slowEvents.length} events exceeded ${slowThreshold}ms processing time`);
    }

    if (highErrorRateEvents.length > 0) {
      recommendations.push(`Events with high error rates: ${highErrorRateEvents.join(', ')}`);
    }

    const avgHandlerCount = this.eventMetrics.reduce((sum, e) => sum + e.handlerCount, 0) / this.eventMetrics.length;
    if (avgHandlerCount > 5) {
      recommendations.push('Consider reducing number of event handlers per event');
    }

    return {
      slowEvents,
      highErrorRateEvents,
      recommendations
    };
  }

  private recordEventMetrics(metrics: EventMetrics): void {
    this.eventMetrics.push(metrics);

    // Prevent memory leaks
    if (this.eventMetrics.length > this.maxEvents) {
      this.eventMetrics = this.eventMetrics.slice(-this.maxEvents);
    }
  }


}

// Singleton instance
export const eventProcessingMonitor = new EventProcessingMonitor();
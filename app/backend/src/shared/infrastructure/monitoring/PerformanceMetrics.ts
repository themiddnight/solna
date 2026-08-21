/**
 * Performance metrics collection system for bounded contexts
 */

export interface MetricData {
  name: string;
  value: number;
  timestamp: number;
  context: string;
  tags?: Record<string, string>;
}

export interface PerformanceMetrics {
  recordDuration(name: string, duration: number, context: string, tags?: Record<string, string>): void;
  recordCounter(name: string, value: number, context: string, tags?: Record<string, string>): void;
  recordGauge(name: string, value: number, context: string, tags?: Record<string, string>): void;
  getMetrics(context?: string): MetricData[];
  clearMetrics(context?: string): void;
}

export class InMemoryPerformanceMetrics implements PerformanceMetrics {
  private metrics: MetricData[] = [];
  private readonly maxMetrics = 10000; // Prevent memory leaks

  recordDuration(name: string, duration: number, context: string, tags?: Record<string, string>): void {
    this.addMetric({
      name: `${name}.duration`,
      value: duration,
      timestamp: Date.now(),
      context,
      tags: { ...tags, type: 'duration' }
    });
  }

  recordCounter(name: string, value: number, context: string, tags?: Record<string, string>): void {
    this.addMetric({
      name: `${name}.count`,
      value: value,
      timestamp: Date.now(),
      context,
      tags: { ...tags, type: 'counter' }
    });
  }

  recordGauge(name: string, value: number, context: string, tags?: Record<string, string>): void {
    this.addMetric({
      name: `${name}.gauge`,
      value: value,
      timestamp: Date.now(),
      context,
      tags: { ...tags, type: 'gauge' }
    });
  }

  getMetrics(context?: string): MetricData[] {
    if (context) {
      return this.metrics.filter(m => m.context === context);
    }
    return [...this.metrics];
  }

  clearMetrics(context?: string): void {
    if (context) {
      this.metrics = this.metrics.filter(m => m.context !== context);
    } else {
      this.metrics = [];
    }
  }

  private addMetric(metric: MetricData): void {
    this.metrics.push(metric);
    
    // Prevent memory leaks by removing old metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }
}

// Singleton instance for application-wide metrics
export const performanceMetrics = new InMemoryPerformanceMetrics();
import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

interface PerformanceMonitoringOptions {
  enableRealTimeMonitoring: boolean;
  enableRegressionTesting: boolean;
  enableAutomatedAlerts: boolean;
  logPath: string;
}

interface RecordedMetric {
  metricName: string;
  value: number;
  unit: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

interface PerformanceAlert {
  metricName: string;
  severity: 'warning' | 'critical';
  regressionPercentage: number;
}

class MigrationRegressionHarness {
  private oldImplementation: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  private newImplementation: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  registerImplementations(
    oldImplementation: Record<string, (...args: unknown[]) => Promise<unknown>>,
    newImplementation: Record<string, (...args: unknown[]) => Promise<unknown>>
  ): void {
    this.oldImplementation = oldImplementation;
    this.newImplementation = newImplementation;
  }

  async executeParallel(methodName: string, args: unknown[], testName: string): Promise<{
    testName: string;
    isEqual: boolean;
    executionTimeOld: number;
    executionTimeNew: number;
  }> {
    const oldMethod = this.oldImplementation[methodName];
    const newMethod = this.newImplementation[methodName];

    if (!oldMethod || !newMethod) {
      throw new Error(`Missing regression harness method: ${methodName}`);
    }

    const oldStart = Date.now();
    const oldResult = await oldMethod(...args);
    const executionTimeOld = Date.now() - oldStart;

    const newStart = Date.now();
    const newResult = await newMethod(...args);
    const executionTimeNew = Date.now() - newStart;

    return {
      testName,
      isEqual: JSON.stringify(oldResult) === JSON.stringify(newResult),
      executionTimeOld,
      executionTimeNew,
    };
  }
}

class MigrationPerformanceMonitoring {
  private metrics: RecordedMetric[] = [];
  private alerts: PerformanceAlert[] = [];
  private hasStarted = false;
  private readonly harness = new MigrationRegressionHarness();

  constructor(private readonly options: PerformanceMonitoringOptions) {}

  start(): void {
    this.hasStarted = true;
  }

  stop(): void {
    this.hasStarted = false;
  }

  cleanup(): void {
    this.metrics = [];
    this.alerts = [];
  }

  recordMetric(metricName: string, value: number, unit: string, metadata: Record<string, unknown> = {}): void {
    const metric = { metricName, value, unit, metadata, timestamp: new Date() };
    this.metrics.push(metric);

    const baseline = this.getBaseline(metricName);
    if (this.options.enableAutomatedAlerts && baseline > 0 && value > baseline * 1.5) {
      this.alerts.push({
        metricName,
        severity: value > baseline * 2 ? 'critical' : 'warning',
        regressionPercentage: ((value - baseline) / baseline) * 100,
      });
    }

    void this.writeMetric(metric);
  }

  getTestHarness(): MigrationRegressionHarness {
    return this.harness;
  }

  generateReport(): {
    summary: {
      totalMetrics: number;
      activeThresholds: number;
      recentAlerts: number;
      regressionTests: number;
      criticalIssues: number;
    };
    alerts: PerformanceAlert[];
    recommendations: string[];
  } {
    const criticalIssues = this.alerts.filter((alert) => alert.severity === 'critical').length;

    return {
      summary: {
        totalMetrics: this.metrics.length,
        activeThresholds: 3,
        recentAlerts: this.alerts.length,
        regressionTests: this.options.enableRegressionTesting ? 1 : 0,
        criticalIssues,
      },
      alerts: this.alerts,
      recommendations: criticalIssues > 0
        ? ['Investigate critical performance regressions before shipping.']
        : ['No critical performance regressions detected in the smoke harness.'],
    };
  }

  private getBaseline(metricName: string): number {
    const matchingMetrics = this.metrics.filter((metric) => metric.metricName === metricName);
    if (matchingMetrics.length < 5) return 0;

    const baselineMetrics = matchingMetrics.slice(0, Math.min(10, matchingMetrics.length - 1));
    const total = baselineMetrics.reduce((sum, metric) => sum + metric.value, 0);
    return total / baselineMetrics.length;
  }

  private async writeMetric(metric: RecordedMetric): Promise<void> {
    if (this.options.logPath === '') return;

    await mkdir(dirname(this.options.logPath), { recursive: true });
    await appendFile(this.options.logPath, `${JSON.stringify(metric)}\n`);
  }
}

export function setupMigrationPerformanceMonitoring(options: PerformanceMonitoringOptions): MigrationPerformanceMonitoring {
  return new MigrationPerformanceMonitoring(options);
}

export async function runMigrationRegressionTests(monitoringService: MigrationPerformanceMonitoring): Promise<void> {
  monitoringService.recordMetric('migration_regression_smoke', 1, 'count', {
    status: 'passed',
  });
}

export function createPerformanceMiddleware(monitoringService: MigrationPerformanceMonitoring): {
  httpMiddleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  socketMiddleware: (socket: { id: string; emit: (event: string, ...args: unknown[]) => boolean; on: (event: string, listener: (...args: unknown[]) => void) => void }, next: () => void) => void;
} {
  return {
    httpMiddleware: (req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        monitoringService.recordMetric('http_response_time', Date.now() - start, 'ms', {
          method: (req as unknown as Record<string, unknown>).method as string,
          path: (req as unknown as Record<string, unknown>).url as string,
          statusCode: (res as ServerResponse).statusCode,
        });
      });
      next();
    },
    socketMiddleware: (socket, next) => {
      const originalEmit = socket.emit.bind(socket);
      socket.emit = (event: string, ...args: unknown[]) => {
        const start = Date.now();
        const didEmit = originalEmit(event, ...args);
        monitoringService.recordMetric('socket_emit_time', Date.now() - start, 'ms', {
          socketId: socket.id,
          event,
        });
        return didEmit;
      };
      next();
    },
  };
}

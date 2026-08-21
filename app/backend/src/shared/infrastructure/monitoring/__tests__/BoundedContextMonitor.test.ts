/**
 * BoundedContextMonitor.test.ts — health-status state machine + EMA average.
 *
 * Documents the real behavior of the class (tests are GREEN against current code):
 *  - `calculateHealthStatus` (private, exercised through the real `monitorOperation` →
 *    `updateContextMetrics` path): critical when errorRate > 20% OR averageResponseTime
 *    > 1000ms OR slowOperationRate > 50%; warning when any of them exceeds the lower
 *    bounds (5% / 100ms / 20%); otherwise healthy.
 *  - Average response time is an exponential moving average with alpha = 0.1 over the
 *    recorded durations (first duration seeds the average).
 *
 * Time/duration control: `monitorOperation` measures durations via the shared
 * `calculateProcessingTime` (which uses Bun.nanoseconds — real time, uncontrollable by
 * fake timers or a Date.now spy under bun's jest runtime, per the T3 ruling). The shared
 * module is therefore mocked so `calculateProcessingTime` returns scripted durations;
 * every other piece of the real class (EMA, counters, thresholds, health transitions)
 * runs untouched. Metrics sink: a fresh `InMemoryPerformanceMetrics` per test.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { calculateProcessingTime } from '@jam-band/shared';
import type * as SharedModule from '@jam-band/shared';
import { BoundedContextMonitor } from '../BoundedContextMonitor';
import { InMemoryPerformanceMetrics } from '../PerformanceMetrics';

jest.mock('@jam-band/shared', () => ({
  ...jest.requireActual<typeof SharedModule>('@jam-band/shared'),
  calculateProcessingTime: jest.fn(),
}));

const mockedCalculateProcessingTime = jest.mocked(calculateProcessingTime);

describe('BoundedContextMonitor — health status state machine', () => {
  let monitor: BoundedContextMonitor;
  let metrics: InMemoryPerformanceMetrics;

  beforeEach(() => {
    metrics = new InMemoryPerformanceMetrics();
    monitor = new BoundedContextMonitor(metrics);
  });

  const record = async (duration: number): Promise<void> => {
    mockedCalculateProcessingTime.mockReturnValueOnce(duration);
    await monitor.monitorOperation('room-ops', 'op', async () => 'ok');
  };

  const recordFailure = async (duration: number): Promise<void> => {
    mockedCalculateProcessingTime.mockReturnValueOnce(duration);
    await expect(
      monitor.monitorOperation('room-ops', 'op', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  };

  it('stays healthy when error rate, average and slow rate are all low', async () => {
    await record(1);
    await record(1);
    await record(1);

    const context = monitor.getContextMetrics('room-ops')!;
    expect(context.healthStatus).toBe('healthy');
    expect(context.operationCount).toBe(3);
    expect(context.errorCount).toBe(0);
    expect(context.slowOperations).toBe(0);
    // Durations also flow to the injected metrics sink.
    expect(metrics.getMetrics('room-ops')).toHaveLength(3);
  });

  it('turns critical when the error rate exceeds 20%', async () => {
    await record(1);
    await record(1);
    await record(1);
    await record(1);
    await recordFailure(1);
    await recordFailure(1); // 2/6 = 33% error rate

    const context = monitor.getContextMetrics('room-ops')!;
    expect(context.errorCount).toBe(2);
    expect(context.operationCount).toBe(6);
    expect(context.slowOperations).toBe(0);
    expect(context.healthStatus).toBe('critical');
  });

  it('an error rate of exactly 20% is warning, not critical (strict > 0.2)', async () => {
    await record(1);
    await record(1);
    await record(1);
    await record(1);
    await recordFailure(1); // 1/5 = 20%

    const context = monitor.getContextMetrics('room-ops')!;
    expect(context.healthStatus).toBe('warning');
  });

  it('turns critical when the EMA average response time exceeds 1000ms (slow rate not the trigger)', async () => {
    await record(1500);
    await record(10);
    await record(10);
    await record(10); // avg: 1500 -> 1351 -> 1216.9 -> 1096.21 (> 1000)

    const context = monitor.getContextMetrics('room-ops')!;
    expect(context.averageResponseTime).toBeGreaterThan(1000);
    expect(context.slowOperations).toBe(1); // slow rate 25% — below the 50% critical bound
    expect(context.errorCount).toBe(0);
    expect(context.healthStatus).toBe('critical');
  });

  it('an average response time of exactly 1000ms is warning, not critical (strict > 1000)', async () => {
    await record(1000);
    await record(10); // avg: 1000 -> 901; slow rate 1/2 = 50%, not > 50%

    const context = monitor.getContextMetrics('room-ops')!;
    expect(context.healthStatus).toBe('warning');
  });

  it('turns critical when the slow operation rate exceeds 50%', async () => {
    await record(200);
    await record(200);
    await record(200);
    await record(10); // 3/4 = 75% slow; EMA avg 200 -> 181 (not the trigger)

    const context = monitor.getContextMetrics('room-ops')!;
    expect(context.slowOperations).toBe(3);
    expect(context.operationCount).toBe(4);
    expect(context.errorCount).toBe(0);
    expect(context.averageResponseTime).toBeLessThan(1000);
    expect(context.healthStatus).toBe('critical');
  });

  it('computes the EMA average over a known duration series (alpha = 0.1)', async () => {
    await record(10);
    await record(20);
    await record(30);
    // EMA: 10 -> 0.1*20 + 0.9*10 = 11 -> 0.1*30 + 0.9*11 = 12.9

    const context = monitor.getContextMetrics('room-ops')!;
    expect(context.averageResponseTime).toBeCloseTo(12.9, 5);
    expect(context.operationCount).toBe(3);
    expect(context.healthStatus).toBe('healthy');
  });
});

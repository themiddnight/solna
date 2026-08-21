import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { setImmediate, clearImmediate, setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';

async function freshService() {
  jest.resetModules();
  const mod = await import('../SystemPressureService');
  return mod.systemPressureService;
}

/** Fully-typed literal — TR-27: no `as unknown as` casts (the five fields ARE the MemoryUsage shape). */
function freshMemory(): NodeJS.MemoryUsage {
  return { heapUsed: 0, heapTotal: 0, external: 0, rss: 0, arrayBuffers: 0 };
}

describe('SystemPressureService — B3 regression (no interval in test env, testable pressure logic)', () => {
  let timeoutSpy: jest.SpiedFunction<typeof globalThis.setTimeout>;

  beforeEach(() => {
    timeoutSpy = jest.spyOn(globalThis, 'setTimeout');
  });

  afterEach(() => {
    // triggerEmergencyCleanup schedules a REAL 1000ms setTimeout whenever
    // pressure enters critical — and fake timers are forbidden here (T3 ruling,
    // see below). Clear any pending ones so they cannot fire mid-suite (log
    // noise) or delay the jest worker's exit. CacheService.flush() schedules
    // no timers, so every recorded timeout is an emergency-cleanup callback.
    for (const result of timeoutSpy.mock.results) {
      if (result.type === 'return') {
        clearTimeout(result.value);
      }
    }
    jest.restoreAllMocks();
    // Bun's Jest runtime can permanently break the global timer functions after
    // useFakeTimers — useRealTimers() alone may not fix them (T3 ruling,
    // MetronomeService.test.ts). This suite avoids fake timers entirely, but the
    // restore keeps the file safe if that ever changes.
    Object.assign(globalThis, {
      setImmediate,
      clearImmediate,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    });
  });

  it('does not start a monitoring interval under NODE_ENV=test', async () => {
    const intervalSpy = jest.spyOn(globalThis, 'setInterval');
    const service = await freshService();

    // The B3 guard must prevent the 5s monitoring interval from being created.
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(service.getCurrentPressure()).toBe('normal');

    // The only timer the service may schedule in test env is the emergency-cleanup
    // callback (1000 ms) when pressure enters critical — pin that scheduling.
    // (No fake timers here: see T3 ruling above.)
    const thresholds = service.getStatus().thresholds;
    const mem = freshMemory();
    jest.spyOn(process, 'memoryUsage').mockReturnValue(mem);

    mem.heapUsed = (thresholds.critical + 1) * 1024 * 1024;
    service.checkPressureNow();

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('transitions normal → critical → high → elevated with hysteresis', async () => {
    const service = await freshService();
    const thresholds = service.getStatus().thresholds;

    const mem = freshMemory();
    jest.spyOn(process, 'memoryUsage').mockReturnValue(mem);

    mem.heapUsed = (thresholds.critical + 1) * 1024 * 1024;
    service.checkPressureNow();
    expect(service.getCurrentPressure()).toBe('critical');

    // Hysteresis going down: must fall below threshold − 50MB to step down
    mem.heapUsed = (thresholds.high + 10) * 1024 * 1024;
    service.checkPressureNow();
    expect(service.getCurrentPressure()).toBe('high');

    mem.heapUsed = (thresholds.elevated + 10) * 1024 * 1024;
    service.checkPressureNow();
    expect(service.getCurrentPressure()).toBe('elevated');

    mem.heapUsed = 0;
    service.checkPressureNow();
    expect(service.getCurrentPressure()).toBe('normal');
  });

  it('degrades the feature matrix at each pressure level', async () => {
    const service = await freshService();
    const thresholds = service.getStatus().thresholds;
    const mem = freshMemory();
    jest.spyOn(process, 'memoryUsage').mockReturnValue(mem);

    mem.heapUsed = (thresholds.critical + 1) * 1024 * 1024;
    service.checkPressureNow();

    const features = service.getDegradedFeatures();
    expect(features.aiGenerationEnabled).toBe(false);
    expect(features.newRoomCreationEnabled).toBe(false);
    expect(features.fullCachingEnabled).toBe(false);
    expect(features.detailedLoggingEnabled).toBe(false);
  });

  it('notifies pressure-change callbacks on transition only', async () => {
    const service = await freshService();
    const thresholds = service.getStatus().thresholds;
    const mem = freshMemory();
    jest.spyOn(process, 'memoryUsage').mockReturnValue(mem);

    const callback = jest.fn();
    service.onPressureChange(callback);

    mem.heapUsed = (thresholds.high + 10) * 1024 * 1024;
    service.checkPressureNow();
    service.checkPressureNow(); // no change — no second call
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('high');
  });
});

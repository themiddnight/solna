import { describe, expect, test } from 'bun:test';
import type { AudioRuntimePolicy } from './policy';
import { AudioHealthMonitor, type HealthMonitorScheduler } from './healthMonitor';

const POLICY: AudioRuntimePolicy = {
  id: 'default',
  sampleIntervalMs: 1000,
  minClockRatio: 0.75,
  maxClockRatio: 1.25,
  suspiciousSamplesToFail: 3,
  maxWallGapMs: 2500,
  quirks: [],
};

class FakeScheduler implements HealthMonitorScheduler {
  private callback: (() => void) | null = null;
  readonly intervals: number[] = [];
  clearCount = 0;

  constructor(private readonly handle: unknown = 1) {}

  setInterval(callback: () => void, intervalMs: number): unknown {
    this.callback = callback;
    this.intervals.push(intervalMs);
    return this.handle;
  }

  clearInterval(handle: unknown): void {
    void handle;
    this.clearCount += 1;
    this.callback = null;
  }

  tick(): void {
    this.callback?.();
  }

  get activeTimers(): number {
    return this.callback === null ? 0 : 1;
  }
}

function fixture() {
  const scheduler = new FakeScheduler();
  let wallTimeMs = 0;
  let audioTimeSec = 0;
  let context: Pick<AudioContext, 'currentTime' | 'state'> | null = {
    currentTime: audioTimeSec,
    state: 'running',
  };
  let visible = true;
  const monitor = new AudioHealthMonitor({
    policy: POLICY,
    getContext: () => context,
    now: () => wallTimeMs,
    isVisible: () => visible,
    scheduler,
  });

  return {
    monitor,
    scheduler,
    tick(wallDeltaMs = 1000, audioDeltaSec = 1) {
      wallTimeMs += wallDeltaMs;
      audioTimeSec += audioDeltaSec;
      if (context) context = { ...context, currentTime: audioTimeSec };
      scheduler.tick();
    },
    setActive(active: boolean) {
      context = active ? { currentTime: audioTimeSec, state: 'running' } : null;
    },
    setVisible(nextVisible: boolean) {
      visible = nextVisible;
    },
  };
}

describe('AudioHealthMonitor lifecycle', () => {
  test('reads clock inputs only from the scheduled callback', () => {
    const scheduler = new FakeScheduler();
    let contextReads = 0;
    let timeReads = 0;
    let visibilityReads = 0;
    const monitor = new AudioHealthMonitor({
      policy: POLICY,
      getContext: () => {
        contextReads += 1;
        return { currentTime: 1, state: 'running' };
      },
      now: () => {
        timeReads += 1;
        return 1000;
      },
      isVisible: () => {
        visibilityReads += 1;
        return true;
      },
      scheduler,
    });

    monitor.snapshot();
    monitor.start();
    expect([contextReads, timeReads, visibilityReads]).toEqual([0, 0, 0]);

    scheduler.tick();
    expect([contextReads, timeReads, visibilityReads]).toEqual([1, 1, 1]);
  });

  test('owns no timer before start and exactly one after repeated start', () => {
    const { monitor, scheduler } = fixture();

    expect(scheduler.activeTimers).toBe(0);
    monitor.start();
    monitor.start();

    expect(scheduler.activeTimers).toBe(1);
    expect(scheduler.intervals).toEqual([1000]);
  });

  test('tracks ownership independently from a null-like scheduler handle', () => {
    const scheduler = new FakeScheduler(null);
    const monitor = new AudioHealthMonitor({
      policy: POLICY,
      getContext: () => ({ currentTime: 0, state: 'running' }),
      scheduler,
    });

    monitor.start();
    monitor.start();
    expect(scheduler.intervals).toEqual([1000]);

    monitor.stop();
    monitor.stop();
    expect(scheduler.clearCount).toBe(1);
  });

  test('stop clears its timer and retains collected evidence', () => {
    const { monitor, scheduler, tick } = fixture();
    monitor.start();
    tick();

    monitor.stop();

    expect(scheduler.activeTimers).toBe(0);
    expect(scheduler.clearCount).toBe(1);
    expect(monitor.recentSamples()).toHaveLength(1);
  });
});

describe('AudioHealthMonitor transitions', () => {
  test('inactive ticks store no samples', () => {
    const { monitor, setActive, tick } = fixture();
    monitor.start();
    setActive(false);

    tick();

    expect(monitor.recentSamples()).toEqual([]);
    expect(monitor.snapshot().phase).toBe('idle');
  });

  test('inactive sampling resets a suspected baseline before playback resumes', () => {
    const { monitor, setActive, tick } = fixture();
    const phases: string[] = [];
    monitor.subscribe((snapshot) => phases.push(snapshot.phase));
    monitor.start();
    tick(1000, 1);
    tick(1000, 0.4);

    setActive(false);
    tick(1000, 0);
    setActive(true);
    tick(1000, 0.4);

    expect(phases).toEqual(['healthy', 'suspected', 'idle', 'healthy']);
    expect(monitor.recentSamples()).toHaveLength(3);
    expect(monitor.recentSamples().at(-1)?.ratio).toBeNull();
  });

  test('notifies only for healthy, suspected, and unhealthy phase transitions', () => {
    const { monitor, tick } = fixture();
    const phases: string[] = [];
    monitor.subscribe((snapshot) => phases.push(snapshot.phase));
    monitor.start();

    tick(1000, 1);
    tick(1000, 0.4);
    tick(1000, 0.4);
    tick(1000, 0.4);

    expect(phases).toEqual(['healthy', 'suspected', 'unhealthy']);
    expect({ ...monitor.snapshot(), lastRatio: null }).toEqual({
      phase: 'unhealthy',
      lastRatio: null,
      suspiciousCount: 3,
      generation: 0,
      runtimePolicyId: 'default',
    });
    expect(monitor.snapshot().lastRatio).toBeCloseTo(0.4);
  });

  test('unsubscribe is idempotent and prevents later transition delivery', () => {
    const { monitor, tick } = fixture();
    const phases: string[] = [];
    const unsubscribe = monitor.subscribe((snapshot) => phases.push(snapshot.phase));
    monitor.start();
    tick();

    unsubscribe();
    unsubscribe();
    tick(1000, 0.4);

    expect(phases).toEqual(['healthy']);
  });
});

describe('AudioHealthMonitor evidence', () => {
  test('records current interval evidence after unhealthy state latches', () => {
    const { monitor, tick } = fixture();
    monitor.start();
    tick(1000, 1);
    tick(1000, 0.4);
    tick(1000, 0.4);
    tick(1000, 0.4);
    tick(1000, 1);

    expect(monitor.snapshot().phase).toBe('unhealthy');
    expect(monitor.recentSamples().at(-1)?.elapsedMs).toBe(1000);
    expect(monitor.recentSamples().at(-1)?.ratio).toBeCloseTo(1);
  });

  test('suspended and long-gap evidence reset the evidence baseline', () => {
    const scheduler = new FakeScheduler();
    let wallTimeMs = 0;
    let audioTimeSec = 0;
    let state: AudioContextState = 'running';
    const monitor = new AudioHealthMonitor({
      policy: POLICY,
      getContext: () => ({ currentTime: audioTimeSec, state }),
      now: () => wallTimeMs,
      isVisible: () => true,
      scheduler,
    });
    const tick = (wallDeltaMs: number, audioDeltaSec: number) => {
      wallTimeMs += wallDeltaMs;
      audioTimeSec += audioDeltaSec;
      scheduler.tick();
    };
    monitor.start();

    tick(1000, 1);
    state = 'suspended';
    tick(1000, 0);
    state = 'running';
    tick(1000, 1);
    tick(3000, 3);
    tick(1000, 1);

    expect(monitor.recentSamples().map(({ elapsedMs, ratio }) => ({ elapsedMs, ratio }))).toEqual([
      { elapsedMs: 0, ratio: null },
      { elapsedMs: 1000, ratio: null },
      { elapsedMs: 0, ratio: null },
      { elapsedMs: 3000, ratio: null },
      { elapsedMs: 0, ratio: null },
    ]);
  });

  test('retains only the most recent 300 samples', () => {
    const { monitor, tick } = fixture();
    monitor.start();

    for (let index = 0; index < 301; index += 1) tick();

    const evidence = monitor.recentSamples();
    expect(evidence).toHaveLength(300);
    expect(evidence[0]?.audioTimeSec).toBe(2);
    expect(evidence.at(-1)?.audioTimeSec).toBe(301);
  });

  test('generation reset clears the latch and evidence baseline', () => {
    const { monitor, tick } = fixture();
    monitor.start();
    tick(1000, 1);
    tick(1000, 0.4);
    tick(1000, 0.4);
    tick(1000, 0.4);
    expect(monitor.snapshot().phase).toBe('unhealthy');

    monitor.resetGeneration(4);

    expect(monitor.snapshot()).toEqual({
      phase: 'idle',
      lastRatio: null,
      suspiciousCount: 0,
      generation: 4,
      runtimePolicyId: 'default',
    });
    expect(monitor.recentSamples()).toEqual([]);
    tick(1000, 1);
    expect(monitor.recentSamples()[0]?.elapsedMs).toBe(0);
    expect(monitor.recentSamples()[0]?.ratio).toBeNull();
  });

  test('records visibility and resets the reducer baseline while hidden', () => {
    const { monitor, setVisible, tick } = fixture();
    monitor.start();
    tick();
    setVisible(false);
    tick();

    expect(monitor.recentSamples().at(-1)?.visible).toBe(false);
    expect(monitor.recentSamples().at(-1)?.ratio).toBeNull();
    expect(monitor.snapshot().phase).toBe('idle');
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { freshEngine } from '@/audio/testFakes';
import { attachMeter, attachTickMeter, nextMeterId } from './meterAttach';
import type { MeterLevel } from './meterLevel';
import {
  __observedElementCountForTests,
  __registrySizeForTests,
  __resetSchedulerForTests,
  __tickForTests,
} from './meterScheduler';

/** One full sine cycle; the crest lands exactly on a sample at a power-of-two length. */
function sineBuffer(amplitude: number, length = 1024): Float32Array {
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * i) / length);
  }
  return buffer;
}

function fakeAnalyser(samples: Float32Array): AnalyserNode {
  return {
    fftSize: samples.length,
    frequencyBinCount: samples.length / 2,
    getFloatTimeDomainData: (out: Float32Array) => { out.set(samples.subarray(0, out.length)); },
    getFloatFrequencyData: (out: Float32Array) => { out.fill(-100); },
  } as unknown as AnalyserNode;
}

// A registration starts at `lastTickAt = 0`, so a tick at `now = 0` is zero milliseconds after
// it and is correctly skipped. Every test below therefore starts the clock one frame in.
const FRAME_MS = 1000 / 60;
/** One frame of the `track` tier, which is what a per-source meter registers at. */
const TRACK_FRAME_MS = 1000 / 30;

beforeEach(() => {
  __resetSchedulerForTests();
});

describe('nextMeterId', () => {
  test('never repeats, so two meters on one source cannot collide in the registry', () => {
    expect(nextMeterId('master')).not.toBe(nextMeterId('master'));
  });

  test('keeps the prefix so a registry dump is readable', () => {
    expect(nextMeterId('synth').startsWith('synth-')).toBe(true);
  });
});

describe('attachMeter', () => {
  test('a full-scale sine reads 0 dBFS peak and about -3 dBFS RMS', () => {
    const levels: MeterLevel[] = [];
    const clock = FRAME_MS;
    attachMeter(fakeAnalyser(sineBuffer(1)), {
      id: 'a',
      tier: 'master',
      now: () => clock,
      onLevel: (level) => levels.push(level),
    });

    __tickForTests(clock);

    expect(levels).toHaveLength(1);
    expect(levels[0]!.peakDbfs).toBeCloseTo(0, 3);
    expect(levels[0]!.rmsDbfs).toBeCloseTo(-3.0103, 3);
  });

  test('half amplitude reads about -6 dBFS peak', () => {
    const levels: MeterLevel[] = [];
    attachMeter(fakeAnalyser(sineBuffer(0.5)), {
      id: 'a',
      tier: 'master',
      now: () => FRAME_MS,
      onLevel: (level) => levels.push(level),
    });

    __tickForTests(FRAME_MS);

    expect(levels[0]!.peakDbfs).toBeCloseTo(-6.0206, 3);
  });

  test('a clipping signal reaches the over zone, which a post-limiter tap could not', () => {
    const levels: MeterLevel[] = [];
    attachMeter(fakeAnalyser(sineBuffer(1.5)), {
      id: 'a',
      tier: 'master',
      now: () => FRAME_MS,
      onLevel: (level) => levels.push(level),
    });

    __tickForTests(FRAME_MS);

    expect(levels[0]!.peakDbfs).toBeGreaterThan(-1);
  });

  test('a steady signal stops emitting once the dead zone is reached', () => {
    let emissions = 0;
    let clock = FRAME_MS;
    attachMeter(fakeAnalyser(sineBuffer(0.25)), {
      id: 'a',
      tier: 'master',
      now: () => clock,
      onLevel: () => { emissions += 1; },
    });

    // Warm-up: the first tick has nothing to compare against, so it always emits.
    __tickForTests(clock);
    expect(emissions).toBe(1);

    // Drive well past the RMS window (300ms / this tier's ~16.67ms cadence = 18 ticks) with the
    // SAME fixed-amplitude buffer on every tick. Measured directly: peak, RMS and held-peak are
    // then numerically unchanged from the first emission on every remaining tick, so the
    // dead-zone guard in `createLevelTracker.push` must suppress ALL of them. This is the
    // property behind the repo's core per-frame constraint (a store write per tick re-renders
    // every mounted tab view, not just the visible one), so the assertion has to be exact:
    // `emissions < 20` still passes even with that guard broken for 19 of these 39 extra ticks,
    // which is why this used to be `toBeLessThan(20)` rather than `toBe(0)`.
    for (let frame = 2; frame <= 40; frame++) {
      clock = frame * FRAME_MS;
      __tickForTests(clock);
    }
    expect(emissions).toBe(1);
  });

  test('the detach function removes the registration', () => {
    const detach = attachMeter(fakeAnalyser(sineBuffer(1)), {
      id: 'a',
      tier: 'master',
      now: () => FRAME_MS,
      onLevel: () => {},
    });

    expect(__registrySizeForTests()).toBe(1);
    detach();
    expect(__registrySizeForTests()).toBe(0);
  });

  test('an offscreen tier attaches but never emits, which is how a hidden tab stops', () => {
    let emissions = 0;
    attachMeter(fakeAnalyser(sineBuffer(1)), {
      id: 'a',
      tier: 'offscreen',
      now: () => FRAME_MS,
      onLevel: () => { emissions += 1; },
    });

    for (let frame = 1; frame <= 60; frame++) __tickForTests(frame * FRAME_MS);

    expect(__registrySizeForTests()).toBe(1);
    expect(emissions).toBe(0);
  });
});

describe('a per-source analyser reads through exactly the same path', () => {
  const SOURCES = ['synth', 'chord', 'bass', 'pad', 'sequencer'] as const;

  test('every source bus hands back its own analyser, and the same one on a second call', () => {
    const { engine } = freshEngine();
    const analysers = SOURCES.map((source) => engine.getSourceAnalyser(source));

    for (const analyser of analysers) expect(analyser).not.toBeNull();
    // Five distinct nodes: a shared one would make every layer read the same mix.
    expect(new Set(analysers).size).toBe(SOURCES.length);
    expect(engine.getSourceAnalyser('synth')).toBe(analysers[0]!);
  });

  test('a source analyser yields a dBFS reading at the track tier', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceAnalyser('bass')!;
    // The fake context's analyser records wiring but produces no samples, so feed it the
    // half-amplitude sine the acceptance criteria name.
    const samples = sineBuffer(0.5, analyser.fftSize);
    (
      analyser as unknown as { getFloatTimeDomainData: (out: Float32Array) => void }
    ).getFloatTimeDomainData = (out) => {
      out.set(samples.subarray(0, out.length));
    };

    const levels: MeterLevel[] = [];
    attachMeter(analyser, {
      id: nextMeterId('bass'),
      tier: 'track',
      now: () => TRACK_FRAME_MS,
      onLevel: (level) => levels.push(level),
    });

    __tickForTests(TRACK_FRAME_MS);

    expect(levels).toHaveLength(1);
    expect(levels[0]!.peakDbfs).toBeCloseTo(-6.0206, 3);
  });
});

/**
 * Stand-in for the DOM's IntersectionObserver (this repo has no jsdom/happy-dom), so a test can
 * drive the visibility gate by hand. Mirrors the one in `meterScheduler.test.ts`.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  disconnected = false;
  observedElement: Element | null = null;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observedElement = element;
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  fire(isIntersecting: boolean): void {
    this.callback(
      [{ target: this.observedElement, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

/**
 * `attachTickMeter` is the analyser-less path into the scheduler — what the gain-reduction
 * readout uses. It exists so that path cannot skip the visibility gate: `registerMeter` alone
 * creates an entry with `visible: true` that nothing ever clears, and all four tab views stay
 * mounted, so an ungated readout reads the engine forever on a tab nobody is looking at.
 */
describe('attachTickMeter', () => {
  let originalIntersectionObserver: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    originalIntersectionObserver = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    if (originalIntersectionObserver === undefined) {
      Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    } else {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  test('ticks at its tier cadence with no analyser at all', () => {
    let ticks = 0;
    // `null` is the deliberate opt-out the required field forces a caller to spell out.
    attachTickMeter({
      id: 'gr',
      tier: 'master',
      visibilityElement: null,
      onTick: () => { ticks += 1; },
    });

    __tickForTests(FRAME_MS);
    expect(ticks).toBe(1);
  });

  test('an element that stops intersecting stops the ticking', () => {
    const element = {} as Element;
    let ticks = 0;
    attachTickMeter({
      id: 'gr',
      tier: 'master',
      visibilityElement: element,
      onTick: () => { ticks += 1; },
    });
    const observer = FakeIntersectionObserver.instances[0]!;

    __tickForTests(FRAME_MS);
    expect(ticks).toBe(1);

    // What App.tsx's `hidden` on a non-active tab reports: display:none never intersects.
    observer.fire(false);
    __tickForTests(FRAME_MS * 2);
    expect(ticks).toBe(1);

    observer.fire(true);
    __tickForTests(FRAME_MS * 3);
    expect(ticks).toBe(2);
  });

  test('teardown drops the registration AND the observer, not just the registration', () => {
    const element = {} as Element;
    const detach = attachTickMeter({
      id: 'gr',
      tier: 'master',
      visibilityElement: element,
      onTick: () => {},
    });

    expect(__registrySizeForTests()).toBe(1);
    expect(__observedElementCountForTests()).toBe(1);

    detach();

    expect(__registrySizeForTests()).toBe(0);
    expect(__observedElementCountForTests()).toBe(0);
  });
});

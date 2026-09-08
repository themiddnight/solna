import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  __observedElementCountForTests,
  __registrySizeForTests,
  __resetSchedulerForTests,
  __tickForTests,
  observeVisibility,
  registerMeter,
  TIER_INTERVAL_MS,
} from './meterScheduler';

/**
 * Stand-in for the DOM's IntersectionObserver (this repo has no jsdom/happy-dom). Captures its
 * callback and the element it observes so a test can drive visibility changes by hand, and
 * records whether `disconnect` ran so teardown can be asserted.
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

  /** Fires the captured callback as the real observer would on an intersection change. */
  fire(isIntersecting: boolean): void {
    this.callback(
      [{ target: this.observedElement, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

/**
 * A stand-in AnalyserNode that fills every time-domain read with `value`. It stubs
 * `getFloatTimeDomainData` and nothing else on purpose: the scheduler reads samples and only
 * samples, so a frequency read reintroduced here would throw instead of quietly passing.
 */
function fakeAnalyser(value: number, fftSize = 8): AnalyserNode {
  return {
    fftSize,
    getFloatTimeDomainData: (out: Float32Array) => out.fill(value),
  } as unknown as AnalyserNode;
}

beforeEach(() => {
  __resetSchedulerForTests();
});

describe('tier intervals', () => {
  test('are the contract values, and offscreen never ticks', () => {
    expect(TIER_INTERVAL_MS.master).toBeCloseTo(1000 / 60, 10);
    expect(TIER_INTERVAL_MS.track).toBeCloseTo(1000 / 30, 10);
    expect(TIER_INTERVAL_MS.offscreen).toBe(Infinity);
  });

  test('murva’s glow tier is not ported', () => {
    expect(Object.keys(TIER_INTERVAL_MS).sort()).toEqual(['master', 'offscreen', 'track']);
  });
});

describe('registerMeter', () => {
  test('adds and removes exactly one registration', () => {
    const unregister = registerMeter({ id: 'a', tier: 'master', onTick: () => {} });
    expect(__registrySizeForTests()).toBe(1);
    unregister();
    expect(__registrySizeForTests()).toBe(0);
  });

  // Every loop below starts at frame 1, not frame 0. A registration is created with
  // `lastTickAt = 0`, so a tick at `now = 0` is zero milliseconds after it and is correctly
  // skipped — the first tick a meter ever gets is one interval in.
  const FRAME_MS = 1000 / 60;

  test('ticks at the master cadence', () => {
    let ticks = 0;
    registerMeter({ id: 'a', tier: 'master', onTick: () => { ticks += 1; } });

    for (let frame = 1; frame <= 6; frame++) __tickForTests(frame * FRAME_MS);
    expect(ticks).toBe(6);
  });

  test('a track-tier meter ticks half as often as a master-tier one', () => {
    let masterTicks = 0;
    let trackTicks = 0;
    registerMeter({ id: 'm', tier: 'master', onTick: () => { masterTicks += 1; } });
    registerMeter({ id: 't', tier: 'track', onTick: () => { trackTicks += 1; } });

    for (let frame = 1; frame <= 12; frame++) __tickForTests(frame * FRAME_MS);

    expect(masterTicks).toBe(12);
    expect(trackTicks).toBe(6);
  });

  test('an offscreen-tier meter never ticks at all', () => {
    let ticks = 0;
    registerMeter({ id: 'o', tier: 'offscreen', onTick: () => { ticks += 1; } });

    for (let frame = 1; frame <= 120; frame++) __tickForTests(frame * FRAME_MS);
    expect(ticks).toBe(0);
  });

  test('the epsilon absorbs sub-millisecond drift instead of dropping an on-time frame', () => {
    let ticks = 0;
    registerMeter({ id: 'a', tier: 'master', onTick: () => { ticks += 1; } });

    // The second frame arrives half a millisecond early. Without TICK_EPSILON_MS the strict
    // comparison would treat it as not yet due and this would be 1.
    __tickForTests(FRAME_MS);
    __tickForTests(2 * FRAME_MS - 0.5);
    expect(ticks).toBe(2);
  });

  test('reads the analyser into a reused buffer sized from fftSize', () => {
    const seen: number[][] = [];
    registerMeter({
      id: 'a',
      tier: 'master',
      analyser: fakeAnalyser(0.5, 8),
      onTick: (buffer) => { seen.push([...buffer]); },
    });

    __tickForTests(FRAME_MS);
    expect(seen).toEqual([[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]]);
  });

  test('a registration with no analyser still ticks, with an empty buffer', () => {
    let length = -1;
    registerMeter({ id: 'a', tier: 'master', onTick: (buffer) => { length = buffer.length; } });

    __tickForTests(FRAME_MS);
    expect(length).toBe(0);
  });

  test('one throwing onTick does not stop the others', () => {
    let good = 0;
    registerMeter({ id: 'bad', tier: 'master', onTick: () => { throw new Error('boom'); } });
    registerMeter({ id: 'good', tier: 'master', onTick: () => { good += 1; } });

    __tickForTests(FRAME_MS);
    __tickForTests(2 * FRAME_MS);
    expect(good).toBe(2);
  });

  test('an unregistered meter stops ticking immediately', () => {
    let ticks = 0;
    const unregister = registerMeter({ id: 'a', tier: 'master', onTick: () => { ticks += 1; } });

    __tickForTests(FRAME_MS);
    unregister();
    __tickForTests(2 * FRAME_MS);
    expect(ticks).toBe(1);
  });
});

describe('observeVisibility', () => {
  const FRAME_MS = 1000 / 60;
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

  test('two meters on one element share a single IntersectionObserver', () => {
    const element = {} as Element;
    registerMeter({ id: 'a', tier: 'master', onTick: () => {} });
    registerMeter({ id: 'b', tier: 'master', onTick: () => {} });

    observeVisibility('a', element);
    observeVisibility('b', element);

    expect(__observedElementCountForTests()).toBe(1);
    expect(FakeIntersectionObserver.instances.length).toBe(1);
  });

  test('the last disconnect tears the observer down and drops the observed-element count', () => {
    const element = {} as Element;
    registerMeter({ id: 'a', tier: 'master', onTick: () => {} });
    registerMeter({ id: 'b', tier: 'master', onTick: () => {} });

    const disconnectA = observeVisibility('a', element);
    const disconnectB = observeVisibility('b', element);
    const observer = FakeIntersectionObserver.instances[0];

    disconnectA();
    expect(observer.disconnected).toBe(false);
    expect(__observedElementCountForTests()).toBe(1);

    disconnectB();
    expect(observer.disconnected).toBe(true);
    expect(__observedElementCountForTests()).toBe(0);
  });

  test('visibility false pauses ticking, and true resumes it', () => {
    const element = {} as Element;
    let ticks = 0;
    registerMeter({ id: 'a', tier: 'master', onTick: () => { ticks += 1; } });
    observeVisibility('a', element);
    const observer = FakeIntersectionObserver.instances[0];

    observer.fire(false);
    for (let frame = 1; frame <= 3; frame++) __tickForTests(frame * FRAME_MS);
    expect(ticks).toBe(0);

    observer.fire(true);
    __tickForTests(4 * FRAME_MS);
    expect(ticks).toBe(1);
  });

  test('with no IntersectionObserver in the environment, the meter stays always-visible', () => {
    Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    const element = {} as Element;
    let ticks = 0;
    registerMeter({ id: 'a', tier: 'master', onTick: () => { ticks += 1; } });

    const disconnect = observeVisibility('a', element);
    expect(typeof disconnect).toBe('function');
    expect(() => disconnect()).not.toThrow();

    __tickForTests(FRAME_MS);
    expect(ticks).toBe(1);
  });
});

describe('the rAF loop parks when nothing can tick', () => {
  const FRAME_MS = 1000 / 60;
  const originalRaf = globalThis.requestAnimationFrame;
  let scheduled = 0;

  beforeEach(() => {
    __resetSchedulerForTests();
    scheduled = 0;
    globalThis.requestAnimationFrame = ((): number => {
      scheduled += 1;
      return scheduled;
    }) as typeof requestAnimationFrame;
  });

  afterEach(() => {
    __resetSchedulerForTests();
    if (originalRaf) globalThis.requestAnimationFrame = originalRaf;
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  });

  test('an offscreen-tier registration alone never arms the loop', () => {
    // A meter is not unregistered when playback stops — it drops to `offscreen` and stays in
    // the registry (VuMeter does exactly that). Arming for it would wake a callback 60 times a
    // second in a stopped, silent app forever.
    registerMeter({ id: 'parked', tier: 'offscreen', onTick: () => {} });
    expect(scheduled).toBe(0);

    registerMeter({ id: 'live', tier: 'master', onTick: () => {} });
    expect(scheduled).toBe(1);
  });

  test('an invisible registration does not keep the loop armed across a frame', () => {
    const unregister = registerMeter({ id: 'a', tier: 'master', onTick: () => {} });
    expect(scheduled).toBe(1);
    // The frame re-arms while the entry is still tickable...
    __tickForTests(FRAME_MS);
    expect(scheduled).toBe(2);
    // ...and stops re-arming once nothing is left that could be due.
    unregister();
    __tickForTests(2 * FRAME_MS);
    expect(scheduled).toBe(2);
  });
});

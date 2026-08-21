import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerMeter,
  observeVisibility,
  __resetSchedulerForTests,
  __tickForTests,
  __registrySizeForTests,
  __observedElementCountForTests,
} from '../meterScheduler';

// fftSize (2048) deliberately differs from frequencyBinCount (1024): the
// module sizes time-domain buffers by fftSize and frequency-domain buffers by
// frequencyBinCount, so each domain's buffer-length assertions below only pass
// if the scheduler reads the right property — the two domains can't pass on
// the same value by accident (DEV-347 T2).
function fakeAnalyser(fillValue = 0.5): AnalyserNode {
  return {
    fftSize: 2048,
    frequencyBinCount: 1024,
    getFloatFrequencyData: vi.fn(),
    getFloatTimeDomainData: vi.fn((buf: Float32Array) => buf.fill(fillValue)),
  } as unknown as AnalyserNode;
}

// The module only reads `.isIntersecting` off each entry — a minimal fake
// entry is cast to the real lib type rather than reimplementing the full
// IntersectionObserverEntry shape (boundingClientRect, target, time, ...).
// `target` is REQUIRED by the scheduler's shared-observer routing (one
// IntersectionObserver per element, so the callback resolves which
// registrations an entry belongs to via `entry.target`); the real API always
// populates it.
function fakeIntersectionEntries(isIntersecting: boolean, target: Element): IntersectionObserverEntry[] {
  return [{ isIntersecting, target } as unknown as IntersectionObserverEntry];
}

describe('meterScheduler', () => {
  beforeEach(() => __resetSchedulerForTests());
  // jsdom (pretendToBeVisual: true) provides a real requestAnimationFrame, so every
  // registerMeter() call in this file also kicks off the module's real self-rescheduling
  // rAF loop alongside the manual __tickForTests clock. beforeEach's reset sweeps stray
  // frames between tests, but nothing guarantees cleanup after the *last* test in the file
  // without this — close that isolation gap explicitly rather than relying on environment
  // teardown.
  afterEach(() => __resetSchedulerForTests());

  it('registers a meter and invokes onTick with a reused buffer (no per-call allocation)', () => {
    const seenBuffers: Float32Array[] = [];
    const unregister = registerMeter({
      id: 'test-1',
      tier: 'master',
      analyser: fakeAnalyser(0.5),
      onTick: (buf) => seenBuffers.push(buf),
    });

    __tickForTests(0);
    __tickForTests(16.7); // ~60Hz frame

    expect(seenBuffers.length).toBeGreaterThan(0);
    // same buffer instance reused across ticks for this registration:
    expect(seenBuffers[0]).toBe(seenBuffers[seenBuffers.length - 1]);

    unregister();
  });

  it("drives 'master' tier at ~60Hz and 'track' tier at ~30Hz", () => {
    let masterTicks = 0;
    let trackTicks = 0;
    registerMeter({ id: 'm', tier: 'master', analyser: fakeAnalyser(), onTick: () => masterTicks++ });
    registerMeter({ id: 't', tier: 'track', analyser: fakeAnalyser(), onTick: () => trackTicks++ });

    for (let frame = 0; frame < 60; frame++) {
      __tickForTests(frame * (1000 / 60)); // simulate 1 second of 60Hz frames
    }

    expect(masterTicks).toBeGreaterThanOrEqual(55); // ~60
    expect(trackTicks).toBeGreaterThanOrEqual(25); // ~30, allow tolerance
    expect(trackTicks).toBeLessThan(masterTicks);
  });

  it('does not tick an unregistered meter', () => {
    let ticks = 0;
    const unregister = registerMeter({ id: 'x', tier: 'master', analyser: fakeAnalyser(), onTick: () => ticks++ });
    unregister();
    __tickForTests(0);
    __tickForTests(16.7);
    expect(ticks).toBe(0);
  });

  it('adds an entry to the registry when a meter registers', () => {
    expect(__registrySizeForTests()).toBe(0);
    registerMeter({ id: 'y', tier: 'master', analyser: fakeAnalyser(), onTick: () => {} });
    expect(__registrySizeForTests()).toBe(1);
  });

  it('evicts the registry entry (and its AnalyserNode reference) on unregister (no leak)', () => {
    const unregister = registerMeter({ id: 'y', tier: 'master', analyser: fakeAnalyser(), onTick: () => {} });
    expect(__registrySizeForTests()).toBe(1);

    unregister();
    expect(__registrySizeForTests()).toBe(0);
  });

  it('observeVisibility pauses ticking when the element leaves the viewport', () => {
    let ticks = 0;
    registerMeter({ id: 'v', tier: 'master', analyser: fakeAnalyser(), onTick: () => ticks++ });

    const fakeElement = document.createElement('div');
    // Captures the constructor callback the module registers. The module's
    // own callback (`([entry]) => {...}`) ignores the `observer` argument,
    // but the captured value's static type is the full 2-param
    // IntersectionObserverCallback, so calls below pass a fake observer too.
    let capturedCallback: IntersectionObserverCallback = () => {};
    const fakeObserverInstance = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() } as unknown as IntersectionObserver;

    // src/test/setup.ts globally mocks IntersectionObserver; override its
    // implementation just for this test so we can capture the constructor
    // callback the module registers, then restore the original mock so
    // other tests in this file keep the default no-op behavior.
    const mockedIntersectionObserver = vi.mocked(globalThis.IntersectionObserver);
    const originalImplementation = mockedIntersectionObserver.getMockImplementation();
    mockedIntersectionObserver.mockImplementation((cb) => {
      capturedCallback = cb;
      return fakeObserverInstance;
    });

    try {
      const stopObserving = observeVisibility('v', fakeElement);
      capturedCallback(fakeIntersectionEntries(false, fakeElement), fakeObserverInstance);

      __tickForTests(0);
      __tickForTests(16.7);
      expect(ticks).toBe(0); // paused while off-screen

      capturedCallback(fakeIntersectionEntries(true, fakeElement), fakeObserverInstance);
      __tickForTests(33.4);
      expect(ticks).toBeGreaterThan(0); // resumes once visible again

      stopObserving();
      expect(fakeObserverInstance.disconnect).toHaveBeenCalled();
    } finally {
      if (originalImplementation) {
        mockedIntersectionObserver.mockImplementation(originalImplementation);
      }
    }
  });

  it('observeVisibility supports multiple observe/unregister cycles for the same meter id', () => {
    let ticks = 0;
    registerMeter({ id: 'cycle', tier: 'master', analyser: fakeAnalyser(), onTick: () => ticks++ });

    const fakeElement = document.createElement('div');
    const callbacks: IntersectionObserverCallback[] = [];
    const observerInstances: IntersectionObserver[] = [];

    const mockedIntersectionObserver = vi.mocked(globalThis.IntersectionObserver);
    const originalImplementation = mockedIntersectionObserver.getMockImplementation();
    mockedIntersectionObserver.mockImplementation((cb) => {
      callbacks.push(cb);
      const instance = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() } as unknown as IntersectionObserver;
      observerInstances.push(instance);
      return instance;
    });

    try {
      // First observe cycle: go offscreen, then unregister (e.g. component unmount).
      const stopFirst = observeVisibility('cycle', fakeElement);
      const firstCallback = callbacks[0];
      const firstObserverInstance = observerInstances[0];
      if (!firstCallback || !firstObserverInstance) throw new Error('expected first observer to be registered');
      firstCallback(fakeIntersectionEntries(false, fakeElement), firstObserverInstance);
      __tickForTests(0);
      __tickForTests(16.7);
      expect(ticks).toBe(0);
      stopFirst();
      expect(firstObserverInstance.disconnect).toHaveBeenCalled();

      // Second observe cycle for the same id (e.g. remount): a fresh
      // IntersectionObserver is created and wired independently of the first.
      const stopSecond = observeVisibility('cycle', fakeElement);
      expect(observerInstances.length).toBe(2);
      const secondCallback = callbacks[1];
      const secondObserverInstance = observerInstances[1];
      if (!secondCallback || !secondObserverInstance) throw new Error('expected second observer to be registered');
      secondCallback(fakeIntersectionEntries(true, fakeElement), secondObserverInstance);
      __tickForTests(33.4);
      expect(ticks).toBeGreaterThan(0);

      stopSecond();
      expect(secondObserverInstance.disconnect).toHaveBeenCalled();
    } finally {
      if (originalImplementation) {
        mockedIntersectionObserver.mockImplementation(originalImplementation);
      }
    }
  });

  it('reset clears element observers (no cross-test leak)', () => {
    const el = document.createElement('div');
    const observerInstances: IntersectionObserver[] = [];

    const mockedIntersectionObserver = vi.mocked(globalThis.IntersectionObserver);
    const originalImplementation = mockedIntersectionObserver.getMockImplementation();
    mockedIntersectionObserver.mockImplementation(() => {
      const instance = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() } as unknown as IntersectionObserver;
      observerInstances.push(instance);
      return instance;
    });

    try {
      const stop = observeVisibility('meter-1', el);
      expect(__observedElementCountForTests()).toBe(1);
      __resetSchedulerForTests();
      expect(__observedElementCountForTests()).toBe(0);
      // The reset must disconnect the live observer, not just clear the
      // activeObservations mirror: a skipped disconnect leaves the element
      // observed (and the observer reachable only through the leak).
      const firstObserverInstance = observerInstances[0];
      if (!firstObserverInstance) throw new Error('expected first observer to be registered');
      expect(firstObserverInstance.disconnect).toHaveBeenCalled();
      // Old observers must be inert: re-register and reset again stays clean
      const stop2 = observeVisibility('meter-2', el);
      expect(__observedElementCountForTests()).toBe(1);
      stop2();
      stop();
    } finally {
      if (originalImplementation) {
        mockedIntersectionObserver.mockImplementation(originalImplementation);
      }
    }
  });

  it('fires onTick at tier cadence for an analyser-less registration, passing a 0-length buffer', () => {
    let ticks = 0;
    const seenLengths: number[] = [];
    registerMeter({
      id: 'no-analyser',
      tier: 'track',
      onTick: (buf) => {
        ticks++;
        seenLengths.push(buf.length);
      },
    });

    __tickForTests(0);
    __tickForTests(1000 / 30 + 1); // first due frame for the track tier

    expect(ticks).toBeGreaterThan(0);
    expect(seenLengths.every((len) => len === 0)).toBe(true);
  });

  it("reads 'frequency'-domain registrations via getFloatFrequencyData into a frequencyBinCount-sized buffer", () => {
    const analyser = fakeAnalyser();
    const seenLengths: number[] = [];
    registerMeter({
      id: 'freq',
      tier: 'track',
      analyser,
      domain: 'frequency',
      onTick: (buf) => seenLengths.push(buf.length),
    });

    __tickForTests(0);
    __tickForTests(1000 / 30 + 1);

    expect(seenLengths.length).toBeGreaterThan(0);
    expect(analyser.getFloatFrequencyData).toHaveBeenCalled();
    expect(analyser.getFloatTimeDomainData).not.toHaveBeenCalled();
    expect(seenLengths.every((len) => len === 1024)).toBe(true);
  });

  it("reads analyser-backed registrations in the 'time' domain by default (getFloatTimeDomainData, fftSize-sized)", () => {
    const analyser = fakeAnalyser();
    const seenLengths: number[] = [];
    registerMeter({
      id: 'default-domain',
      tier: 'track',
      analyser,
      onTick: (buf) => seenLengths.push(buf.length),
    });

    __tickForTests(0);
    __tickForTests(1000 / 30 + 1);

    expect(seenLengths.length).toBeGreaterThan(0);
    expect(seenLengths.every((len) => len === 2048)).toBe(true);
  });

  it('observeVisibility returns a no-op unregister and does not throw when IntersectionObserver is unsupported', () => {
    // Simulate an environment without IntersectionObserver support (e.g. older
    // Safari) — meterScheduler.ts's `typeof IntersectionObserver === 'undefined'`
    // guard should take the no-op branch instead of throwing on `new IntersectionObserver(...)`.
    // vi.stubGlobal saves the current value internally and vi.unstubAllGlobals()
    // restores it, so the global mock from src/test/setup.ts is intact for later tests.
    vi.stubGlobal('IntersectionObserver', undefined);

    try {
      const fakeElement = document.createElement('div');
      const stopObserving = observeVisibility('no-io-support', fakeElement);

      expect(typeof stopObserving).toBe('function');
      expect(() => stopObserving()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

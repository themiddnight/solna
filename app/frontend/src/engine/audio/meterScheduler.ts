export type MeterTier = 'master' | 'track' | 'glow' | 'offscreen';

export type MeterDomain = 'time' | 'frequency';

export interface MeterRegistration {
  id: string;
  tier: MeterTier;
  /**
   * Analyser to read per tick. Optional: a registration without one still
   * fires `onTick` at its tier's cadence, but the scheduler skips the read and
   * passes a 0-length `Float32Array` (used by visualizers that draw from the
   * effect's getter methods rather than an analyser buffer).
   */
  analyser?: AnalyserNode;
  /** Which analyser read to perform. Defaults to `'time'` (`getFloatTimeDomainData`, buffer sized `fftSize`). `'frequency'` uses `getFloatFrequencyData`, buffer sized `frequencyBinCount`. */
  domain?: MeterDomain;
  onTick: (buffer: Float32Array) => void;
}

export const TIER_INTERVAL_MS: Record<MeterTier, number> = {
  master: 1000 / 60,
  track: 1000 / 30,
  glow: 1000 / 30,
  offscreen: Infinity, // never ticks
};

// Tolerance subtracted from the tier interval before the "is it due" check.
// `now` values (real rAF timestamps or frame*interval in tests) accumulate
// sub-millisecond floating-point drift across successive frames, so a strict
// `now - lastTickAt < interval` comparison can spuriously treat an
// on-schedule frame as "not due yet" (observed: 16.666666666666664 <
// 16.666666666666668). A 1ms tolerance absorbs that drift — and typical
// real-world rAF jitter — without materially changing the tiered cadence.
const TICK_EPSILON_MS = 1;

interface InternalEntry {
  reg: MeterRegistration;
  buffer: Float32Array;
  lastTickAt: number;
  visible: boolean;
}

const registry = new Map<string, InternalEntry>();
let rafHandle: number | null = null;
let isAppVisible = true;

function ensureLoopRunning(): void {
  if (rafHandle !== null || typeof requestAnimationFrame !== 'function') return;
  rafHandle = requestAnimationFrame(loop);
}

function loop(now: number): void {
  rafHandle = null;
  if (registry.size === 0) return;
  if (isAppVisible) {
    for (const entry of registry.values()) {
      if (!entry.visible) continue;
      const interval = TIER_INTERVAL_MS[entry.reg.tier];
      if (now - entry.lastTickAt < interval - TICK_EPSILON_MS) continue;
      // Stamp the tick time BEFORE the callback: if onTick throws, the entry
      // is not retried at rAF rate — it falls back to its tier cadence.
      entry.lastTickAt = now;
      try {
        const analyser = entry.reg.analyser;
        if (analyser) {
          if (entry.reg.domain === 'frequency') analyser.getFloatFrequencyData(entry.buffer);
          else analyser.getFloatTimeDomainData(entry.buffer);
        }
        entry.reg.onTick(entry.buffer);
      } catch (error) {
        // One bad visualizer must not kill the whole meter loop (that would
        // freeze every other meter until the next registerMeter, because
        // ensureLoopRunning below never runs).
        console.warn('[meterScheduler] onTick failed for', entry.reg.id, error);
      }
    }
  }
  ensureLoopRunning();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    isAppVisible = document.visibilityState === 'visible';
  });
}

export function registerMeter(reg: MeterRegistration): () => void {
  const analyser = reg.analyser;
  const bufferSize = analyser
    ? reg.domain === 'frequency'
      ? analyser.frequencyBinCount
      : analyser.fftSize
    : 0;
  const entry: InternalEntry = {
    reg,
    buffer: new Float32Array(bufferSize),
    lastTickAt: 0,
    visible: true,
  };
  registry.set(reg.id, entry);
  ensureLoopRunning();
  return () => {
    registry.delete(reg.id);
  };
}

/** Wired to each registration's own IntersectionObserver callback. */
function setTierVisible(id: string, visible: boolean): void {
  const entry = registry.get(id);
  if (entry) entry.visible = visible;
}

interface ElementObservation {
  observer: IntersectionObserver;
  ids: Set<string>;
}

/** One IntersectionObserver per element, shared by every meter on it. */
let elementObservers = new WeakMap<Element, ElementObservation>();

/** Mirrors the WeakMap's values so observers can be enumerated (WeakMap is not iterable). */
const activeObservations = new Set<ElementObservation>();

/**
 * Observes `element`'s viewport visibility and pauses/resumes the given
 * registration's ticking accordingly (offscreen meters do no work). Returns
 * a disconnect function to call on unmount/unregister.
 *
 * Each element gets a single shared IntersectionObserver regardless of how
 * many meters sit on it (e.g. the GraphicEQ visualizer registers separate
 * input/output meters on the same container); observers created per call
 * would leak one IO per registration. When the last registration on an
 * element disconnects, its observer is torn down too. The returned disconnect
 * function is load-bearing for garbage collection: the `activeObservations`
 * mirror holds strong references, so skipping it retains the element and its
 * observer.
 */
export function observeVisibility(id: string, element: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    return () => {}; // environment without IO support — meter stays always-visible
  }
  let observation = elementObservers.get(element);
  if (!observation) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const registered = elementObservers.get(entry.target);
          if (!registered) continue;
          for (const registeredId of registered.ids) {
            setTierVisible(registeredId, entry.isIntersecting);
          }
        }
      },
      { threshold: 0 },
    );
    observer.observe(element);
    observation = { observer, ids: new Set([id]) };
    elementObservers.set(element, observation);
    activeObservations.add(observation);
  } else {
    observation.ids.add(id);
  }
  return () => {
    const current = elementObservers.get(element);
    if (!current) return;
    current.ids.delete(id);
    if (current.ids.size === 0) {
      current.observer.disconnect();
      elementObservers.delete(element);
      activeObservations.delete(current);
    }
  };
}

// Test-only escape hatches (not part of the public surface used by production code):
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __resetSchedulerForTests = (): void => {
  registry.clear();
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  isAppVisible = true;
  // Disconnect every live IntersectionObserver so orphaned callbacks stop
  // firing, then drop both structures so stale disconnect closures (captured
  // from the previous WeakMap instance) become inert.
  for (const observation of activeObservations) {
    observation.observer.disconnect();
  }
  activeObservations.clear();
  elementObservers = new WeakMap();
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const __tickForTests = (now: number): void => {
  loop(now);
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const __registrySizeForTests = (): number => registry.size;

// eslint-disable-next-line @typescript-eslint/naming-convention
export const __observedElementCountForTests = (): number => activeObservations.size;

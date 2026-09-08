/**
 * One rAF loop for every meter in the app, ticking each registration at its tier's cadence and
 * skipping any whose observed element is not intersecting.
 *
 * This matters more in solna than in the murva original it is ported from: all four tab views
 * stay mounted (`App.tsx` toggles `block`/`hidden`), so without the tiering and the
 * visibility gate every hidden tab's meters would read their analysers forever.
 *
 * murva's `glow` tier is deliberately not ported — solna has three tiers: `master`, `track`,
 * `offscreen`.
 */

export type MeterTier = 'master' | 'track' | 'offscreen';

export interface MeterRegistration {
  id: string;
  tier: MeterTier;
  /**
   * Analyser to read per tick. Optional: a registration without one still fires `onTick` at its
   * tier's cadence and is handed a zero-length buffer, for consumers that draw from something
   * other than an analyser.
   */
  analyser?: AnalyserNode;
  onTick: (buffer: Float32Array) => void;
}

export const TIER_INTERVAL_MS: Record<MeterTier, number> = {
  master: 1000 / 60,
  track: 1000 / 30,
  offscreen: Infinity, // never ticks
};

/**
 * Tolerance subtracted from the tier interval before the "is it due" check. `now` values
 * accumulate sub-millisecond floating-point drift across successive frames, so a strict
 * `now - lastTickAt < interval` comparison can treat an on-schedule frame as not-yet-due
 * (observed: 16.666666666666664 < 16.666666666666668). 1ms absorbs that and typical rAF jitter
 * without materially changing the cadence.
 */
const TICK_EPSILON_MS = 1;

interface InternalEntry {
  reg: MeterRegistration;
  buffer: Float32Array<ArrayBuffer>;
  lastTickAt: number;
  visible: boolean;
}

const registry = new Map<string, InternalEntry>();
let rafHandle: number | null = null;
let isAppVisible = true;

/**
 * Whether any registration could actually tick right now: visible, and on a tier whose interval
 * is finite (`offscreen` is `Infinity` — it never ticks).
 */
function hasTickableEntry(): boolean {
  for (const entry of registry.values()) {
    if (entry.visible && TIER_INTERVAL_MS[entry.reg.tier] !== Infinity) return true;
  }
  return false;
}

/**
 * The rAF loop stays armed ONLY while something could tick. Without that test a stopped, silent
 * app would still wake a callback 60 times a second forever: a meter is not unregistered when
 * playback stops, it drops to the `offscreen` tier and stays in the registry (VuMeter does
 * exactly this, deliberately — see its docblock). Rescheduling unconditionally would iterate
 * entries that can never be due and work against the engine's own idle suspend.
 *
 * Every transition that can make an entry tickable again re-arms: `registerMeter` (which is
 * also how a tier CHANGE arrives — `useMeterLevel` re-registers when `tier` changes),
 * `setTierVisible`, and the `visibilitychange` handler.
 */
function ensureLoopRunning(): void {
  if (rafHandle !== null || typeof requestAnimationFrame !== 'function') return;
  if (!isAppVisible || !hasTickableEntry()) return;
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
      // Stamp BEFORE the callback: if onTick throws, the entry falls back to its tier cadence
      // rather than being retried at full rAF rate.
      entry.lastTickAt = now;
      try {
        // Time domain only, always. A meter reads SAMPLES, not a spectrum (CLAUDE.md):
        // averaging frequency bins measures brightness, not loudness, and yields a number
        // with no dB meaning. There is deliberately no per-registration domain option —
        // the one that existed was never set by any caller and neither `attachMeter` nor
        // `attachTickMeter` exposed it, so it was an unreachable branch inviting exactly
        // the reading the DEV-383 contract exists to prevent.
        entry.reg.analyser?.getFloatTimeDomainData(entry.buffer);
        entry.reg.onTick(entry.buffer);
      } catch (error) {
        // One bad consumer must not kill the loop — that would freeze every other meter until
        // the next registerMeter, because ensureLoopRunning below would never run.
        console.warn('[meterScheduler] onTick failed for', entry.reg.id, error);
      }
    }
  }
  ensureLoopRunning();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    isAppVisible = document.visibilityState === 'visible';
    // Re-arm: ensureLoopRunning refuses to schedule while the browser tab is hidden, so
    // becoming visible again is one of the transitions that has to restart the loop.
    if (isAppVisible) ensureLoopRunning();
  });
}

export function registerMeter(reg: MeterRegistration): () => void {
  // `fftSize` samples, because the read is always `getFloatTimeDomainData`. A registration
  // with no analyser gets a zero-length buffer and still ticks.
  const bufferSize = reg.analyser?.fftSize ?? 0;
  registry.set(reg.id, {
    reg,
    buffer: new Float32Array(bufferSize),
    lastTickAt: 0,
    visible: true,
  });
  ensureLoopRunning();
  return () => {
    registry.delete(reg.id);
  };
}

function setTierVisible(id: string, visible: boolean): void {
  const entry = registry.get(id);
  if (!entry) return;
  entry.visible = visible;
  // An entry scrolling back into view is the other way a parked loop becomes due again.
  if (visible) ensureLoopRunning();
}

interface ElementObservation {
  observer: IntersectionObserver;
  ids: Set<string>;
}

/** One IntersectionObserver per element, shared by every meter registered against it. */
let elementObservers = new WeakMap<Element, ElementObservation>();

/**
 * How many elements currently hold a live shared observer. A COUNT, not a mirror of the
 * WeakMap's values: a `Set<ElementObservation>` was a strong reference to every observer,
 * and an observer strongly retains the elements it observes — so production held every
 * meter's element alive for the process lifetime to serve two test helpers. The WeakMap is
 * now the only reference to an observation, which is the whole point of it being weak.
 */
let observedElementCount = 0;

/**
 * Observes `element`'s visibility and pauses/resumes that registration's ticking accordingly.
 * A tab view hidden by `App.tsx` is `display: none`, which reports as not intersecting — that
 * is what makes hidden tabs stop reading analysers.
 *
 * Observers are shared per element so N meters on one container do not create N observers.
 * Calling the returned disconnect function is still what stops the observer: nothing else
 * disconnects it, and an element that is still observed is still retained by its own
 * observer registration, whatever this module holds.
 */
export function observeVisibility(id: string, element: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    return () => {}; // environment without IO support — the meter stays always-visible
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
    observedElementCount += 1;
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
      observedElementCount -= 1;
    }
  };
}

// Test-only escape hatches. Not part of the surface production code uses; the `__` prefix is
// what marks them as such, matching the DEV-383 contract's module surface.
export const __resetSchedulerForTests = (): void => {
  registry.clear();
  if (rafHandle !== null) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  isAppVisible = true;
  // Drop the WeakMap so stale disconnect closures (captured from the previous one) become
  // inert. An observer left connected by a previous test is inert too, without being
  // disconnected here: its callback looks its target up in `elementObservers`, which is now
  // the fresh map, so it finds nothing and flips no registration's visibility.
  elementObservers = new WeakMap();
  observedElementCount = 0;
};

export const __tickForTests = (now: number): void => {
  loop(now);
};

export const __registrySizeForTests = (): number => registry.size;

/** Number of distinct elements currently holding a live shared IntersectionObserver. */
export const __observedElementCountForTests = (): number => observedElementCount;

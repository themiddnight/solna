import { createLevelTracker, type MeterLevel } from './meterLevel';
import {
  observeVisibility,
  registerMeter,
  TIER_INTERVAL_MS,
  type MeterRegistration,
  type MeterTier,
} from './meterScheduler';

/**
 * Joins a level tracker to an analyser and the shared scheduler. This is the whole body of what
 * `components/ui/useMeterLevel.ts` does, extracted so it can be tested: the repo has no DOM and
 * no testing-library, so a hook's effect never runs under `bun test` — but this does.
 */

export interface AttachMeterOptions {
  /** Registry key. Use `nextMeterId` unless a caller genuinely owns a stable id. */
  id: string;
  tier: MeterTier;
  rmsWindowMs?: number;
  /** When given, ticking pauses while this element is not intersecting. */
  visibilityElement?: Element | null;
  /** Injectable clock, for tests. Defaults to `performance.now`. */
  now?: () => number;
  /** Called only when the level actually changed enough to be worth a redraw. */
  onLevel: (level: MeterLevel) => void;
}

let meterIdCounter = 0;

/** A unique, readable registry key. Two meters on one source must not share an id. */
export function nextMeterId(prefix: string): string {
  meterIdCounter += 1;
  return `${prefix}-${meterIdCounter}`;
}

/**
 * Registers `reg` and, when an element is given, gates it on that element's visibility. Every
 * registration made THROUGH THIS MODULE is gated: `registerMeter` creates an entry with
 * `visible: true` and nothing else ever clears it, so a registration made without this pairing
 * ticks forever — and all four tab views stay mounted, so "forever" includes every tab the user
 * is not looking at.
 *
 * A caller with genuinely nothing to gate on — `components/ui/AmbientBackdrop.tsx`, mounted
 * once outside the tab views — still comes through here and simply omits the element, which is
 * what keeps the tier written once rather than once as `tier` and again as a `TIER_INTERVAL_MS`
 * lookup. What is enforced is narrower and worth more: `attachTickMeter` makes
 * `visibilityElement` REQUIRED, so a caller that has an element and forgets it is a compile
 * error, and a caller with genuinely nothing to observe has to write `null` on purpose.
 */
function joinScheduler(reg: MeterRegistration, visibilityElement?: Element | null): () => void {
  const unregister = registerMeter(reg);
  const unobserve = visibilityElement ? observeVisibility(reg.id, visibilityElement) : null;

  return () => {
    unregister();
    unobserve?.();
  };
}

export interface AttachTickMeterOptions {
  /** Registry key. Use `nextMeterId` unless a caller genuinely owns a stable id. */
  id: string;
  tier: MeterTier;
  /**
   * Ticking pauses while this element is not intersecting. REQUIRED, unlike
   * `AttachMeterOptions`' optional one: this path's only consumer renders its own elements, so
   * an omission here is a leak rather than a choice. `null` is the deliberate opt-out, for a
   * caller mounted outside the tab views with nothing to gate on.
   */
  visibilityElement: Element | null;
  onTick: () => void;
}

/**
 * The analyser-less half of the same join: a consumer that reads its value from somewhere other
 * than an `AnalyserNode` (the engine's `.reduction` params) still needs the tier cadence and the
 * visibility gate, and gets both here rather than calling `registerMeter` bare.
 *
 * The one step no test in this repo can reach is the caller handing over its element — that
 * needs a DOM, and there is none — so the type is what covers it instead.
 */
export function attachTickMeter(options: AttachTickMeterOptions): () => void {
  return joinScheduler(
    { id: options.id, tier: options.tier, onTick: () => options.onTick() },
    options.visibilityElement,
  );
}

export function attachMeter(analyser: AnalyserNode, options: AttachMeterOptions): () => void {
  const now = options.now ?? (() => performance.now());
  // The offscreen tier's interval is Infinity, which would size the ring buffer at 0 slots; the
  // tracker clamps to 1, and an offscreen meter never ticks anyway.
  const tickIntervalMs = Number.isFinite(TIER_INTERVAL_MS[options.tier])
    ? TIER_INTERVAL_MS[options.tier]
    : TIER_INTERVAL_MS.track;
  const tracker = createLevelTracker({ tickIntervalMs, rmsWindowMs: options.rmsWindowMs });

  return joinScheduler(
    {
      id: options.id,
      tier: options.tier,
      analyser,
      onTick: (buffer) => {
        const level = tracker.push(buffer, now());
        if (level) options.onLevel(level);
      },
    },
    options.visibilityElement,
  );
}

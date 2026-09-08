import { useEffect, useState, type RefObject } from "react";
import { attachMeter, nextMeterId } from "@/utils/meterAttach";
import { SILENT_LEVEL, type MeterLevel } from "@/utils/meterLevel";
import type { MeterTier } from "@/utils/meterScheduler";

export type { MeterLevel };

/**
 * Reads an `AnalyserNode` on the shared meter scheduler and returns dBFS peak/RMS plus a
 * decaying peak-hold.
 *
 * The analyser is a PARAMETER, not something this hook fetches: that keeps the hook out of the
 * layering-rule-3 exemption list in `eslint.config.js` — only the component that calls
 * `audioEngine.getMasterLevelAnalyser()` / `getSourceAnalyser()` needs the exemption.
 *
 * - `options.tier` selects the scheduler's cadence. Passing `'offscreen'` is how a caller
 *   parks a meter that is mounted but should not be reading anything.
 * - `options.visibilityRef` observes that element so the meter pauses when its tab is hidden.
 * - `peakDbfs` has no smoothing in either direction; `rmsDbfs` is averaged over
 *   `options.rmsWindowMs` (default 300ms) in the power domain.
 *
 * No value here goes anywhere near a zustand slice: a store write per tick would re-render every
 * mounted view, and all four tab views stay mounted.
 */
export function useMeterLevel(
  analyser: AnalyserNode | null,
  options: {
    tier: MeterTier;
    visibilityRef?: RefObject<Element | null>;
    rmsWindowMs?: number;
  },
): MeterLevel {
  const [level, setLevel] = useState<MeterLevel>(SILENT_LEVEL);
  const { tier, rmsWindowMs, visibilityRef } = options;

  useEffect(() => {
    setLevel(SILENT_LEVEL);
    if (!analyser) return;

    return attachMeter(analyser, {
      id: nextMeterId(tier),
      tier,
      rmsWindowMs,
      visibilityElement: visibilityRef?.current ?? null,
      onLevel: setLevel,
    });
  }, [analyser, tier, rmsWindowMs, visibilityRef]);

  return level;
}

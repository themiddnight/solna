import { useCallback } from "react";

interface UseInputLevelMonitoringProps {
  analyser: AnalyserNode | null;
  isConnected: boolean;
  isMuted: boolean;
}

interface UseInputLevelMonitoringReturn {
  startInputLevelMonitoring: () => void;
  stopInputLevelMonitoring: () => void;
}

/**
 * Imperative start/stop API for voice-input level monitoring, preserved for
 * `VoiceRuntimeProvider.tsx` / `useVoiceControls.ts` / `useVoiceInputHandlers.ts`, which call
 * `startInputLevelMonitoring`/`stopInputLevelMonitoring` on mute/unmute/connect/disconnect but
 * never read a level value from this hook.
 *
 * This hook used to run its own hand-rolled `requestAnimationFrame` loop reading
 * `getFloatTimeDomainData` + computing an RMS level with an ad-hoc `x1.5` gain
 * (`Math.min(1, rms * 1.5)`, one of the epic's Decision-1-condemned normalization gains) and
 * exposing it as `inputLevel`. Task 8 migrated `InputLevelMeter.tsx`'s presentation to the
 * shared `useMeterLevel`/`<Meter>` pipeline, which reads the SAME analyser directly — leaving
 * this hook's own `inputLevel` state with zero remaining consumers (confirmed via a repo-wide
 * grep for callers of this hook: only the two imperative functions below are ever destructured).
 * The RAF loop, RMS computation, ad-hoc gain, and dead-zone threshold have all been removed as
 * dead code; the two functions are kept as a stable no-op shell purely so call sites don't need
 * to change.
 */
export const useInputLevelMonitoring = (
  _props: UseInputLevelMonitoringProps,
): UseInputLevelMonitoringReturn => {
  const startInputLevelMonitoring = useCallback(() => {
    // No-op: level monitoring now lives entirely in useMeterLevel (see InputLevelMeter.tsx).
  }, []);

  const stopInputLevelMonitoring = useCallback(() => {
    // No-op: see startInputLevelMonitoring above.
  }, []);

  return {
    startInputLevelMonitoring,
    stopInputLevelMonitoring,
  };
};

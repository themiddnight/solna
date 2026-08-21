import React, { memo, useEffect } from "react";
import { useMeterLevel, type MeterLevel } from "@/features/audio/hooks/useMeterLevel";
import { Meter } from "@/features/audio/components/Meter/Meter";
import { t } from "@lingui/core/macro";

interface InputLevelMeterProps {
  analyser: AnalyserNode | null;
  isConnected: boolean;
  isMuted: boolean;
  onLevelChange?: (level: number) => void;
}

const SILENT: MeterLevel = {
  peakDbfs: -Infinity,
  rmsDbfs: -Infinity,
  heldPeakDbfs: -Infinity,
};

// isMuted MUST keep overriding the analyser's reading -- muting sets `audioTrack.enabled = false`
// on the downstream MediaStreamAudioDestinationNode's stream (useVoiceControls.ts), a completely
// different object from `analyser`, which taps the effects chain upstream of that destination
// (useAudioStream.ts: effectsOutputNode -> analyser -> destination). Disabling a MediaStreamTrack
// only silences consumers reading that specific track; it does NOT propagate upstream through the
// Web Audio node graph to silence a node that feeds INTO the destination. So the analyser keeps
// reading live mic signal for the entire duration of a mute -- this is not a transition-frame
// edge case, it is the steady-state behavior while muted. classifyZone(-Infinity) -> "tooQuiet",
// which the shared Meter/meterColorForZone renders gray, matching the old bg-gray-400 intent.
const InputLevelMeterComponent: React.FC<InputLevelMeterProps> = ({ analyser, isMuted, onLevelChange }) => {
  const rawLevel = useMeterLevel(analyser, { tier: "track" });
  const level: MeterLevel = isMuted ? SILENT : rawLevel;

  // Call onLevelChange when the level changes (optional, for parent/store updates), preserving
  // this callback's historical 0..1 linear-amplitude contract by converting back from peakDbfs.
  // Math.pow(10, -Infinity / 20) === 0, so silence needs no special-casing. Uses the post-mute-
  // override `level` (not `rawLevel`) so the callback also zeroes out while muted, matching the
  // old hook's `isMuted ? 0 : level` behavior.
  useEffect(() => {
    onLevelChange?.(Math.pow(10, level.peakDbfs / 20));
  }, [level.peakDbfs, onLevelChange]);

  return (
    <div className="flex items-center max-w-36 grow">
      {/* Input Level Indicator */}
      <div className="flex-1">
        <div className="text-xs mb-1">{t`Input Lv`}</div>
        <Meter levels={[level]} scaleDetail="medium" thickness="md" />
      </div>
    </div>
  );
};

export const InputLevelMeter = memo(InputLevelMeterComponent);

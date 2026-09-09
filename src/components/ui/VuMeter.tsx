import React from "react";
import { audioEngine } from "@/audio/engine";
import { formatDb } from "@/utils/gainUnits";
import { MeterBar } from "./MeterBar";
import { useMeterLevel } from "./useMeterLevel";

export interface VuMeterProps {
  /** Whether anything is sounding; the meter parks on the offscreen tier when false. */
  isPlaying: boolean;
}

/**
 * Master output level meter: true dBFS peak with a decaying peak-hold, read from the engine's
 * dedicated level analyser (post-fader, pre-dynamics) on the shared meter scheduler.
 *
 * It reads `audioEngine` directly — the layering rule 3 exemption it has always held, alongside
 * AudioVisualizer and AmbientBackdrop. `useMeterLevel` itself takes the analyser as a parameter
 * and imports nothing from `audio/`, so the exemption stops here and the list does not grow.
 *
 * `isPlaying` selects the tier rather than tearing the registration down: `offscreen` never
 * ticks, so a stopped transport does no analyser reads at all. `useMeterLevel`'s effect resets
 * to `SILENT_LEVEL` synchronously whenever `tier` changes, so the bar clears the instant
 * playback stops rather than freezing at its last reading — a frozen level would claim sound is
 * still happening when it is not, which is worse than a bar that goes empty.
 *
 * Nothing here touches a zustand slice. A store write per tick would re-render all four mounted
 * tab views.
 */
export const VuMeter = React.memo(function VuMeter({ isPlaying }: VuMeterProps) {
  // Resolved on each render rather than in a ref: before the first user click there is no
  // AudioContext and this is null, and the hook re-registers when the node finally appears.
  const analyser = audioEngine.getMasterLevelAnalyser();
  // A fresh object literal each render is fine: useMeterLevel destructures it and keys its
  // effect on the individual fields, so the object's identity is never read.
  const level = useMeterLevel(analyser, { tier: isPlaying ? "master" : "offscreen" });

  return (
    <div className="hidden sm:flex items-center gap-1 bg-base-200 border border-base-300 p-1.5 rounded-box">
      <MeterBar
        peakDbfs={level.peakDbfs}
        rmsDbfs={level.rmsDbfs}
        heldPeakDbfs={level.heldPeakDbfs}
        className="w-14"
        title={`Master peak: ${formatDb(level.peakDbfs)}`}
      />
    </div>
  );
});

import React, { useEffect, useRef, useState } from "react";
import { audioEngine } from "@/audio/engine";
import type { SourceBusId } from "@/store/engineSync";
import { formatDb } from "@/utils/gainUnits";
import { MeterBar } from "./MeterBar";
import { useMeterLevel } from "./useMeterLevel";

export interface SourceMeterProps {
  /** The ENGINE's bus name, which is not the store's: the drum bus is 'sequencer'. */
  source: SourceBusId;
  /** Screen name of the layer, for the title — 'Beat', not 'sequencer'. */
  label: string;
  /** Whether anything is sounding; the meter parks on the offscreen tier when false. */
  isPlaying: boolean;
  className?: string;
}

/**
 * One mix layer's output level: true dBFS peak with a decaying peak-hold, read
 * from that layer's POST-fader bus analyser on the shared meter scheduler.
 *
 * It is the per-channel sibling of `VuMeter` and differs from it in three ways,
 * each of which is a consequence of there being five of these on one surface
 * rather than one in the transport bar:
 *
 * 1. **`track` tier, not `master`** — 30 ticks a second instead of 60. Five
 *    analyser reads at master cadence buy nothing a channel meter needs.
 * 2. **It observes its own element.** `VuMeter` lives in the always-visible
 *    transport bar and needs no visibility gate; these live inside a tab view,
 *    and every tab view stays mounted (`block`/`hidden`), so without the gate
 *    five meters would read forever on a surface nobody is looking at.
 * 3. **It fills whatever box the caller gives it, and centres in it.** The
 *    mixer sits it beside the fader on a wide screen and under the fader on a
 *    narrow one; a width or a height decided in here could not do both, so the
 *    layout stays with the layout (loop/SoundMixer.tsx) and this owns only the
 *    reading.
 *
 * The analyser is post-fader by design — see `getSourceLevelAnalyser` — so the
 * fader, the mute and the solo are all already in the reading. That matters
 * here beyond taste: `src/components/` may not import `audio/engine` to compute
 * audibility, so a meter that had to subtract mute or solo itself could not be
 * written on this side of the layering rule at all.
 *
 * It reads `audioEngine` directly and is therefore the fourth entry on the
 * layering-rule-3 exemption list in `eslint.config.js`. That is why this is a
 * component rather than markup inside `SoundMixer`: the exemption stops at this
 * file, and the mixer stays a dumb view.
 *
 * Nothing here touches a zustand slice. A store write per tick would re-render
 * every mounted view, and all of them stay mounted.
 */
export const SourceMeter = React.memo(function SourceMeter({
  source,
  label,
  isPlaying,
  className = "",
}: SourceMeterProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Resolved in an EFFECT, not in the render body. Before the first user click
  // there is no AudioContext and this is null; the node appears later, and the
  // `isPlaying` flip is enough to go and fetch it, since the first click that
  // makes a context is the one that starts the transport.
  //
  // The effect matters because this is not a pure read: on its first call
  // `getSourceLevelAnalyser` CREATES an AnalyserNode and connects it to the
  // layer's bus, and `getSourceBus` can build that bus too. `useMeterLevel`
  // re-renders this component at its tick rate, so in the render body that was
  // a graph-mutating call running ~30 times a second per meter, on a path React
  // is free to discard or replay. It is idempotent only because the engine
  // memoises both nodes in Maps — a guarantee a component should not be leaning
  // on, in a repo whose layering rule exists to keep components off the engine.
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  useEffect(() => {
    setAnalyser(audioEngine.getSourceLevelAnalyser(source));
  }, [source, isPlaying]);
  const level = useMeterLevel(analyser, {
    tier: isPlaying ? "track" : "offscreen",
    visibilityRef: boxRef,
  });

  return (
    // The wrapper is what the IntersectionObserver watches, so it must be a
    // real box in the layout — `flex items-center` gives the bar a vertical
    // centre to sit in when the caller makes that box taller than 6px, which is
    // how it lines up with the h-8 fader beside it.
    <div ref={boxRef} className={`flex items-center ${className}`}>
      <MeterBar
        peakDbfs={level.peakDbfs}
        rmsDbfs={level.rmsDbfs}
        heldPeakDbfs={level.heldPeakDbfs}
        className="w-full"
        title={`${label} peak: ${formatDb(level.peakDbfs)}`}
      />
    </div>
  );
});

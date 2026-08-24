import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/store";
import { triggerPad } from "../audio/playback/drumPlayback";
import { sixteenthNoteMs } from "../utils/musicTheory";
import {
  STEPS_PER_BAR,
  playbackNoteOff,
  playbackNoteOn,
  subscribePlaybackClock,
} from "../audio/playback/playbackEngine";

// Real-time sequencer stepper hook. Moved here from
// audio/playback/sequencerPlayback.ts (layering rule 1: audio/ must not import
// store/) — the hook reads store state, so it is a component-layer concern;
// the engine is reached only through the audio-layer bridge in
// playbackEngine.ts (layering rule 3).
export function useSequencerPlayback(): {
  currentStep: number;
  setCurrentStep: (step: number) => void;
} {
  const tracks = useAppStore((s) => s.sequencerTracks);
  const synthParams = useAppStore((s) => s.synthParams);
  const masterSequencerVolume = useAppStore((s) => s.masterSequencerVolume);
  const bpm = useAppStore((s) => s.bpm);
  const isPlaying = useAppStore((s) => s.isSequencerPlaying);

  const [currentStep, setCurrentStep] = useState<number>(0);

  // Real-time playback stepper — driven by the shared audio-clock scheduler
  const armedRef = useRef(false);
  const stepDurationMs = sixteenthNoteMs(bpm);

  const playStepSounds = useCallback(
    (stepIndex: number, time: number) => {
      tracks.forEach((track) => {
        if (track.muted) return;
        if (track.steps[stepIndex]) {
          if (track.instrument === "synth" || track.instrument === "bass") {
            const note = track.instrument === "bass" ? "C2" : "C4";
            playbackNoteOn(
              note,
              synthParams,
              masterSequencerVolume,
              time,
            );
            playbackNoteOff(
              note,
              synthParams.release,
              time + (stepDurationMs / 1000) * 0.8,
            );
          } else {
            triggerPad(track.instrument, masterSequencerVolume, time);
          }
        }
      });
    },
    [tracks, synthParams, masterSequencerVolume, stepDurationMs],
  );

  useEffect(() => {
    if (!isPlaying) {
      armedRef.current = false;
      setCurrentStep(0);
      return;
    }

    return subscribePlaybackClock((step, _beat, time) => {
      // Start aligned to the next bar boundary so the 16-step loop lands on beat 1
      if (!armedRef.current) {
        if (step % STEPS_PER_BAR !== 0) return;
        armedRef.current = true;
      }
      const stepInLoop = step % STEPS_PER_BAR;
      setCurrentStep(stepInLoop);
      playStepSounds(stepInLoop, time);
    });
  }, [isPlaying, playStepSounds]);

  return { currentStep, setCurrentStep };
}

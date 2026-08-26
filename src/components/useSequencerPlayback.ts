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
import { isSoftStopBoundary } from "./playerStop";
import type { PlayerState } from "../store/types";

/** Whether the stepper has caught a bar line and started running. */
export interface SequencerArming {
  armed: boolean;
}

export type SequencerStepAction = "idle" | "soft-stop" | "play";

/**
 * What the clock callback should do for `step`. Arms (mutating `arming`) on
 * the first bar line it sees, so the 16-step loop lands on beat 1.
 *
 * `state` must be read LIVE from the store, never from a React ref: the stop
 * is fired from inside this callback and the clock subscription stays live
 * until React commits, while one `clockTick` dispatches several steps
 * synchronously — a stale 'stopping' lets an extra drum step through after
 * the cut.
 */
export function sequencerStepAction(
  state: PlayerState,
  step: number,
  arming: SequencerArming,
  stepsPerBar: number = STEPS_PER_BAR,
): SequencerStepAction {
  if (state === "stopped") return "idle";
  if (isSoftStopBoundary(state, step, stepsPerBar)) return "soft-stop";
  if (!arming.armed) {
    if (step % stepsPerBar !== 0) return "idle";
    arming.armed = true;
  }
  return "play";
}

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
  const playerState = useAppStore((s) => s.sequencerPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';

  const [currentStep, setCurrentStep] = useState<number>(0);

  // Real-time playback stepper — driven by the shared audio-clock scheduler
  const armingRef = useRef<SequencerArming>({ armed: false });

  // Disarm on every transition to 'stopped', straight off the store: React
  // does not necessarily render the stop (the Instant Vibe swap hard-stops
  // and restarts inside one batched click), and zustand notifies
  // synchronously, so this sees the transitions the render never shows.
  useEffect(
    () =>
      useAppStore.subscribe(
        (s) => s.sequencerPlayer,
        (next) => {
          if (next === "stopped") armingRef.current.armed = false;
        },
      ),
    [],
  );
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
      armingRef.current.armed = false;
      setCurrentStep(0);
      return;
    }

    return subscribePlaybackClock((step, _beat, time) => {
      const action = sequencerStepAction(
        useAppStore.getState().sequencerPlayer,
        step,
        armingRef.current,
      );
      if (action === "idle") return;
      // Soft stop: the Beat player owns no sustained voices — drums are
      // fire-and-forget one-shots — so stopping means stopping the schedule.
      // At most one already-scheduled hit can still sound, no later than
      // CLOCK_LOOKAHEAD (0.1s) after the press. Accepted; see the spec.
      if (action === "soft-stop") {
        hardStop('sequencer');
        return;
      }

      const stepInLoop = step % STEPS_PER_BAR;
      setCurrentStep(stepInLoop);
      playStepSounds(stepInLoop, time);
    });
  }, [isPlaying, playStepSounds]);

  return { currentStep, setCurrentStep };
}

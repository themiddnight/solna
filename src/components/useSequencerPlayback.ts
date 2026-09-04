import { useEffect, useRef } from "react";
import { useAppStore } from "../store/store";
import { publishStepAt, resetStep } from "./playbackStep";
import { ensureDrumEngine, triggerPad } from "../audio/playback/drumPlayback";
import { STEPS_PER_BAR, stepDurationSec } from "../utils/musicTheory";
import {
  playbackNoteOff,
  playbackNoteOn,
  subscribePlaybackClock,
} from "../audio/playback/playbackEngine";
import { getMeter } from "../utils/meter";
import { armOnBarLine, isSoftStopBoundary } from "./playerStop";
import type { PlayerState } from "../store/types";
import type { SequencerTrack, SynthParams } from "../types";

/** Whether the stepper has caught a bar line and started running. */
export interface SequencerArming {
  armed: boolean;
}

export type SequencerStepAction = "idle" | "soft-stop" | "play";

/**
 * What the clock callback should do for `step`. Arms (mutating `arming`) on
 * the first bar line it sees, so the active bar length lands on beat 1.
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
  if (!armOnBarLine(arming, step, stepsPerBar)) return "idle";
  return "play";
}

/** What one sequencer step must trigger. Pure so the per-step decision is
 *  testable without a clock, an AudioContext or a React render. */
export type SequencerStepEvent =
  | { kind: 'note'; note: string; release: number; offsetSec: number }
  | { kind: 'pad'; instrument: string };

export function sequencerStepEvents(
  tracks: readonly SequencerTrack[],
  stepIndex: number,
  synthParams: SynthParams,
  bpm: number,
): SequencerStepEvent[] {
  const events: SequencerStepEvent[] = [];
  const offsetSec = stepDurationSec(bpm) * 0.8;
  for (const track of tracks) {
    if (track.muted) continue;
    if (!track.steps[stepIndex]) continue;
    if (track.instrument === 'synth' || track.instrument === 'bass') {
      events.push({
        kind: 'note',
        note: track.instrument === 'bass' ? 'C2' : 'C4',
        release: synthParams.release,
        offsetSec,
      });
    } else {
      events.push({ kind: 'pad', instrument: track.instrument });
    }
  }
  return events;
}

// Real-time sequencer stepper hook. Moved here from
// audio/playback/sequencerPlayback.ts (layering rule 1: audio/ must not import
// store/) — the hook reads store state, so it is a component-layer concern;
// the engine is reached only through the audio-layer bridge in
// playbackEngine.ts (layering rule 3).
export function useSequencerPlayback(): void {
  // tracks / synthParams / masterSequencerVolume / bpm are deliberately NOT
  // selected here: they are read LIVE inside the clock callback below. As
  // render-scope values they landed in playStepSounds' useCallback deps and
  // then in the clock effect's deps, so every knob pointermove tore down and
  // re-subscribed the clock (~120x/sec) and re-ran ensureDrumEngine(). The
  // live read is also strictly fresher — see the meter comment in the callback.
  const playerState = useAppStore((s) => s.sequencerPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';

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
  useEffect(() => {
    if (!isPlaying) {
      armingRef.current.armed = false;
      resetStep('sequencer');
      return;
    }

    // A play transition is the user gesture that starts this effect; init()
    // belongs here, not per-step (triggerPad no longer calls it — it was
    // running ~8x/second during playback).
    ensureDrumEngine();

    return subscribePlaybackClock((step, _beat, time) => {
      // Read the meter LIVE, for the same reason the player state is read live
      // below: one clockTick dispatches several steps synchronously and the
      // subscription outlives a React commit, so a captured bar length can be
      // one meter behind.
      const stepsPerBar = getMeter(useAppStore.getState().meterId).stepsPerBar;
      const action = sequencerStepAction(
        useAppStore.getState().sequencerPlayer,
        step,
        armingRef.current,
        stepsPerBar,
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

      const stepInLoop = step % stepsPerBar;
      publishStepAt('sequencer', stepInLoop, time);

      // Everything the step needs, read LIVE off the store — same rationale as
      // the meter read above, and the pattern useLeadPlayback.ts:90 and
      // useChordPlayback.ts:632 already use.
      const live = useAppStore.getState();
      const volume = live.masterSequencerVolume;
      for (const event of sequencerStepEvents(
        live.sequencerTracks,
        stepInLoop,
        live.synthParams,
        live.bpm,
      )) {
        if (event.kind === 'note') {
          playbackNoteOn(event.note, live.synthParams, volume, time);
          playbackNoteOff(event.note, event.release, time + event.offsetSec);
        } else {
          triggerPad(event.instrument, volume, time);
        }
      }
    });
  }, [isPlaying, hardStop]);
}

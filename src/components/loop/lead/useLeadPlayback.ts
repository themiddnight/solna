import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/store';
import { leadStepNotes, resolveLeadStepTriggers } from '../../../audio/leadMelody';
import {
  initPlaybackEngine,
  playbackNoteOff,
  playbackNoteOn,
  playbackStopSource,
  subscribePlaybackClock,
} from '../../../audio/playback/playbackEngine';
import { DEFAULT_VELOCITY } from '../../../audio/constants';
import { stepDurationSec } from '../../../utils/musicTheory';
import { arpStepFor, getMeter } from '../../../utils/meter';
import { armOnBarLine, isSoftStopBoundary, shouldHardStopNow } from '../../playerStop';
import type { PlayerState } from '../../../store/types';

/** Short enough to read as an instant cut, long enough not to click. */
const HARD_STOP_RELEASE = 0.02;

export interface LeadArming {
  armed: boolean;
}

export type LeadStepAction = 'idle' | 'soft-stop' | 'play';

/**
 * The lead scheduler's step decision — identical in shape to the sequencer's:
 * arm on the first bar line, soft-stop on the next bar line, else play while
 * armed. `stepsPerBar` is the ACTIVE bar length.
 */
export function leadStepAction(
  state: PlayerState,
  step: number,
  arming: LeadArming,
  stepsPerBar: number,
): LeadStepAction {
  if (state === 'stopped') return 'idle';
  if (isSoftStopBoundary(state, step, stepsPerBar)) return 'soft-stop';
  if (state === 'stopping') return 'idle';
  if (!armOnBarLine(arming, step, stepsPerBar)) return 'idle';
  return 'play';
}

/**
 * Drives the melody grid's notes into the synth voice on the shared clock.
 * The arp is a synth feature, not a note mode: `synthParams.arpActive` gates
 * arpeggiation (on = arp, off = block), never whether the melody runs. Notes
 * and params are read LIVE from the store inside the clock callback, so a
 * knob tweak reaches the next hit without re-subscribing.
 */
export function useLeadPlayback(): { currentStep: number; isPlaying: boolean } {
  const playerState = useAppStore((s) => s.leadPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';

  const [currentStep, setCurrentStep] = useState<number>(0);
  const armingRef = useRef<LeadArming>({ armed: false });
  const softStopPendingRef = useRef(false);

  // Rewind on every transition to 'stopped' (React may never render it: the
  // Instant Vibe swap hard-stops and restarts inside one batched click).
  useEffect(
    () =>
      useAppStore.subscribe(
        (s) => s.leadPlayer,
        (next, prev) => {
          if (next === 'stopped') {
            armingRef.current.armed = false;
            setCurrentStep(0);
          }
          if (!shouldHardStopNow(prev, next, softStopPendingRef.current)) {
            if (next !== 'stopping') softStopPendingRef.current = false;
            return;
          }
          playbackStopSource('synth', HARD_STOP_RELEASE);
        },
      ),
    [],
  );

  useEffect(() => {
    if (!isPlaying) {
      armingRef.current.armed = false;
      setCurrentStep(0);
      return;
    }

    initPlaybackEngine();

    return subscribePlaybackClock((step, _beat, time) => {
      const s = useAppStore.getState();
      const playerState = s.leadPlayer;
      const stepsPerBar = getMeter(s.meterId).stepsPerBar;
      const melodyLength = s.leadLoopLength * stepsPerBar;
      setCurrentStep(step % melodyLength);
      const action = leadStepAction(playerState, step, armingRef.current, stepsPerBar);

      if (action === 'soft-stop') {
        playbackStopSource('synth', s.synthParams.release, time);
        softStopPendingRef.current = true;
        hardStop('lead');
        return;
      }
      if (action !== 'play') return;

      const stepInLoop = step % melodyLength;
      const notes = leadStepNotes(s.leadMelodySteps, stepInLoop, stepsPerBar);
      const stepDur = stepDurationSec(s.bpm);
      const arpStep = arpStepFor(step, stepsPerBar);
      const triggers = resolveLeadStepTriggers(
        notes,
        s.synthParams.arpActive,
        arpStep,
        s.synthParams,
        stepDur,
      );
      for (const t of triggers) {
        playbackNoteOn(t.note, s.synthParams, DEFAULT_VELOCITY, time + t.timeOffsetSec, 'synth');
        playbackNoteOff(t.note, s.synthParams.release, time + t.timeOffsetSec + t.holdSec, 'synth');
      }
    });
  }, [isPlaying, hardStop]);

  return { currentStep, isPlaying };
}

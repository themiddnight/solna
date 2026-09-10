import { useEffect } from 'react';
import { audioEngine } from '../engine';
import { buildArpSequence } from '../arpeggiator';
import { arpFiresOnStep, computeArpTriggers } from '../arpSchedule';
import { heldCountFor, heldNotesFor, type HeldNoteTargets } from './heldNotes';
import { stepDurationSec } from '@/utils/musicTheory';
import { arpStepFor } from '@/utils/meter';
import type { SynthParams } from '@/types';
import type { SynthControlTarget } from '@/utils/synthControl';

// The rate table and trigger math live in audio/arpSchedule.ts so the chord
// scheduler can share them without pulling this React hook into its module.
export { computeArpTriggers };
export type { ArpRate, ArpTrigger } from '../arpSchedule';

export interface ArpStateRef {
  current: {
    /** Every held note and the bus it is sounding on — see ./heldNotes.ts. */
    heldTargets: HeldNoteTargets;
    params: SynthParams;
    /**
     * The bus the NEXT tick plays on: the focused melodic track, or `null`
     * when focus is on the drum track and there is nothing melodic to play.
     * Read fresh on every tick, never captured at effect setup.
     */
    target: SynthControlTarget | null;
    /**
     * Every bus this hook has actually TRIGGERED a voice on, written in the
     * clock callback at trigger time and emptied when they are released.
     */
    triggeredTargets: Set<SynthControlTarget>;
    bpm: number;
  };
}

/**
 * Releases every bus the arp has triggered on and then forgets them, so a
 * later hold starts from an empty record rather than releasing buses it never
 * touched.
 *
 * Takes the release call as a parameter because its two callers sit on
 * opposite sides of a layering rule: the cleanup below passes
 * `audioEngine.releaseSoundingVoices`, and `components/useInputDeck.ts` — which
 * may not import `audio/engine` — passes `releaseSynthPlaybackVoices`.
 */
export function releaseTriggeredTargets(
  triggered: Set<SynthControlTarget>,
  releaseTime: number,
  release: (target: SynthControlTarget, releaseTime: number) => void,
): void {
  for (const target of triggered) {
    release(target, releaseTime);
  }
  triggered.clear();
}

/**
 * The "does this tick fire, and if so what" step, extracted out of the clock
 * callback below so it is reachable from a test. `useEffect` does not run
 * under `renderToString` and this repo bans DOM/testing-library, so nothing
 * inside `subscribeClock`'s callback was exercisable before this existed —
 * deleting `triggeredTargets.add(target)` (or any of the early-exit gates)
 * left the whole suite green.
 *
 * Recorded at TRIGGER time, into `triggeredTargets` — not at render time, not
 * when focus changes. This is the only moment that means "a voice now exists
 * on this bus", and `releaseTriggeredTargets` above releases exactly this
 * set. Returns the sequence and the triggers so the caller can play them; an
 * empty `triggers` array means nothing fires this tick and nothing is
 * recorded.
 */
export function computeArpTick(
  triggeredTargets: Set<SynthControlTarget>,
  target: SynthControlTarget,
  heldTargets: HeldNoteTargets,
  params: SynthParams,
  bpm: number,
  step: number,
  stepsPerBar: number,
): { sequence: string[]; triggers: ReturnType<typeof computeArpTriggers> } {
  const empty = { sequence: [] as string[], triggers: [] as ReturnType<typeof computeArpTriggers> };
  if (!params.arpActive) return empty;
  // The cheap question first — heldCountFor allocates nothing, while
  // heldNotesFor builds an array, and this runs inside the lookahead
  // callback where steady-state garbage becomes a scheduling stall.
  if (heldCountFor(heldTargets, target) === 0) return empty;

  // Gate BEFORE the build: at rate 4n this skips four of every five
  // buildArpSequence calls, each of which is a tonal sort plus one transpose
  // per note per octave, inside the lookahead callback.
  const stepDur16 = stepDurationSec(bpm);
  const arpStep = arpStepFor(step, stepsPerBar);
  if (!arpFiresOnStep(arpStep, params.arpRate)) return empty;

  const sequence = buildArpSequence(
    heldNotesFor(heldTargets, target),
    params.arpMode,
    params.arpOctaves,
  );
  if (sequence.length === 0) return empty;

  const triggers = computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDur16);
  if (triggers.length > 0) {
    triggeredTargets.add(target);
  }
  return { sequence, triggers };
}

/**
 * Arpeggiator clock subscriber, moved from SoundView 281-405 with the 4 rate
 * branches collapsed into computeArpTriggers. `stateRef` mirrors the deck's
 * live arp state: which notes are held and on which bus, the params, the bus
 * the next tick plays on, the buses already triggered on, and the bpm.
 *
 * `release` and the targets are read from `stateRef.current`, NOT taken as
 * parameters: having them in the effect's dependency array made every
 * Release-knob pointer move tear the subscription down and run the cleanup,
 * cutting every held arp note mid-drag.
 *
 * THE TARGET VARIES. It follows `focusTrack`, so one hold can put voices on
 * more than one bus — Lead's from the ticks before a focus change, FX's from
 * the ticks after. The ref therefore records every bus it has TRIGGERED on
 * (`triggeredTargets`, written in the callback below at trigger time) and the
 * cleanup releases all of them. A single captured target would release exactly
 * one and the rest would drone. Trigger time is the only moment that means "a
 * voice now exists on this bus": a bus that was merely focused, or focused one
 * tick after the last trigger, must not be released, and a bus that was
 * triggered on must be released even if focus left it a tick later.
 */
export function useArpPlayback(stateRef: ArpStateRef, active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const unsubscribe = audioEngine.subscribeClock((step, _beat, time) => {
      const { heldTargets, params, target, bpm } = stateRef.current;

      if (!params.arpActive) return;
      // Focus is on the drum track: the melodic keyboard has nothing to play,
      // so the arp has nothing to arpeggiate.
      if (target === null) return;

      const { sequence, triggers } = computeArpTick(
        stateRef.current.triggeredTargets,
        target,
        heldTargets,
        params,
        bpm,
        step,
        audioEngine.getMeter().stepsPerBar,
      );

      for (const t of triggers) {
        const note = sequence[t.noteIndex];
        audioEngine.triggerSynthNoteOn(note, params, 0.9, time + t.timeOffsetSec, target);
        audioEngine.triggerSynthNoteOff(note, params.release, time + t.timeOffsetSec + t.holdSec, target);
      }
    });

    return () => {
      unsubscribe();
      // Read release/targets off the ref, NOT from props: having them in the
      // dependency array made every Release-knob pointer move tear the
      // subscription down and run this cleanup, cutting every held arp note
      // mid-drag.
      //
      // Release EVERY bus this hook has triggered on, not whichever one is
      // current at cleanup time. A focus change mid-hold leaves sounding
      // voices on more than one bus, and one captured target releases only
      // one of them — the same stranded-voice failure reached by a different
      // route. `triggeredTargets` is written at trigger time, so a bus that
      // was never actually played is never released.
      if (audioEngine.getAudioContext()) {
        // Reading the LATEST ref at cleanup time is the whole point;
        // copying it into the effect body would restore the stale-target bug.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
        const { triggeredTargets, params } = stateRef.current;
        releaseTriggeredTargets(triggeredTargets, params.release, (target, releaseTime) => {
          audioEngine.releaseSoundingVoices(target, releaseTime);
        });
      }
    };
  }, [active, stateRef]);
}

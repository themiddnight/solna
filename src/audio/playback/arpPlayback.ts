import { useEffect } from 'react';
import { audioEngine } from '../engine';
import { buildArpSequence } from '../arpeggiator';
import { computeArpTriggers } from '../arpSchedule';
import { stepDurationSec } from '../../utils/musicTheory';
import { arpStepFor } from '../../utils/meter';
import type { SynthParams } from '../../types';
import type { SynthControlTarget } from '../../utils/synthControl';

// The rate table and trigger math live in audio/arpSchedule.ts so the chord
// scheduler can share them without pulling this React hook into its module.
export { computeArpTriggers };
export type { ArpRate, ArpTrigger } from '../arpSchedule';

export interface ArpStateRef {
  current: { activeNotes: Set<string>; params: SynthParams; controlTarget: SynthControlTarget; bpm: number };
}

/**
 * Arpeggiator clock subscriber, moved from SynthView 281-405 with the 4 rate
 * branches collapsed into computeArpTriggers. `stateRef` mirrors the view's
 * live arp state (held notes, params, control target, bpm) exactly like the
 * original arpStateRef. Teardown releases sounding voices, as before.
 *
 * `release` and `controlTarget` are read from `stateRef.current`, NOT taken as
 * parameters: having them in the effect's dependency array made every
 * Release-knob pointer move tear the subscription down and run the cleanup,
 * cutting every held arp note mid-drag.
 */
export function useArpPlayback(stateRef: ArpStateRef, active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const unsubscribe = audioEngine.subscribeClock((step, _beat, time) => {
      const { activeNotes, params, controlTarget: target, bpm } = stateRef.current;

      if (!params.arpActive) return;
      if (activeNotes.size === 0) return;

      const sequence = buildArpSequence(
        activeNotes,
        params.arpMode,
        params.arpOctaves,
      );
      if (sequence.length === 0) return;

      const stepDur16 = stepDurationSec(bpm);
      const arpStep = arpStepFor(step, audioEngine.getMeter().stepsPerBar);
      for (const t of computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDur16)) {
        const note = sequence[t.noteIndex];
        audioEngine.triggerSynthNoteOn(note, params, 0.9, time + t.timeOffsetSec, target);
        audioEngine.triggerSynthNoteOff(note, params.release, time + t.timeOffsetSec + t.holdSec, target);
      }
    });

    return () => {
      unsubscribe();
      // Read release/controlTarget off the ref, NOT from props: having them in
      // the dependency array made every Release-knob pointer move tear the
      // subscription down and run this cleanup, cutting every held arp note
      // mid-drag. Reading here at cleanup time (rather than capturing them at
      // effect-setup time) matches the clock callback above, which also
      // re-reads controlTarget fresh from the ref on every tick — so both
      // agree on "whichever target is current as of the last tick that ran".
      //
      // Known limitation: if controlTarget changes AFTER the last tick but
      // BEFORE this cleanup runs (no clock tick in between), the voices still
      // sounding were triggered under the PRE-switch target, but this reads
      // the POST-switch one and releases the wrong bus — the old target's
      // voices are never released here. Unreachable today because the only
      // caller (SynthView) pins controlTarget to a constant
      // (KEYBOARD_AUDITION_TARGET) for the lifetime of the hook; a future
      // caller that varies controlTarget mid-hold would need to close this gap.
      if (audioEngine.getAudioContext()) {
        const { controlTarget, params } = stateRef.current;
        audioEngine.releaseSoundingVoices(controlTarget, params.release);
      }
    };
  }, [active, stateRef]);
}

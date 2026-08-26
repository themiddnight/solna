import { useEffect } from 'react';
import { audioEngine } from '../engine';
import { buildArpSequence } from '../arpeggiator';
import { computeArpTriggers } from '../arpSchedule';
import { sixteenthNoteMs } from '../../utils/musicTheory';
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
 */
export function useArpPlayback(stateRef: ArpStateRef, active: boolean, release: number, controlTarget: SynthControlTarget): void {
  useEffect(() => {
    if (!active) return;

    const unsubscribe = audioEngine.subscribeClock((step, _beat, time) => {
      const { activeNotes, params, controlTarget: target, bpm } = stateRef.current;

      if (!params.arpActive) return;
      if (activeNotes.size === 0) return;

      const sequence = buildArpSequence(
        activeNotes,
        params.arpMode ?? 'up',
        params.arpOctaves ?? 1,
      );
      if (sequence.length === 0) return;

      const stepDur16 = sixteenthNoteMs(bpm) / 1000;
      for (const t of computeArpTriggers(step, sequence.length, params.arpRate ?? '16n', stepDur16)) {
        const note = sequence[t.noteIndex];
        audioEngine.triggerSynthNoteOn(note, params, 0.9, time + t.timeOffsetSec, target);
        audioEngine.triggerSynthNoteOff(note, params.release, time + t.timeOffsetSec + t.holdSec, target);
      }
    });

    return () => {
      unsubscribe();
      if (audioEngine.getAudioContext()) {
        audioEngine.releaseSoundingVoices(controlTarget, release);
      }
    };
  }, [active, controlTarget, release]);
}

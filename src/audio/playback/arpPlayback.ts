import { useEffect } from 'react';
import { audioEngine } from '../engine';
import { buildArpSequence } from '../arpeggiator';
import { sixteenthNoteMs } from '../../utils/musicTheory';
import type { SynthParams } from '../../types';
import type { SynthControlTarget } from '../../utils/synthControl';

export type ArpRate = '4n' | '8n' | '16n' | '32n';

export interface ArpTrigger {
  noteIndex: number;
  timeOffsetSec: number;
  holdSec: number;
}

export interface ArpStateRef {
  current: { activeNotes: Set<string>; params: SynthParams; controlTarget: SynthControlTarget; bpm: number };
}

// One row per arpRate. stepMod: fire every N sixteenth steps (1 = every step,
// so the modulo always passes). notes: note count per trigger. holdFloor/holdFactor
// reproduce each original branch's hold math exactly (32n uses the half-step
// duration and a 0.03 floor; the others use the full step and 0.04).
const ARP_RATE_CFG: Record<ArpRate, { stepMod: number; notes: number; holdFloor: number; holdFactor: number }> = {
  '4n': { stepMod: 4, notes: 1, holdFloor: 0.04, holdFactor: 4 * 0.85 },
  '8n': { stepMod: 2, notes: 1, holdFloor: 0.04, holdFactor: 2 * 0.85 },
  '16n': { stepMod: 1, notes: 1, holdFloor: 0.04, holdFactor: 1 * 0.85 },
  '32n': { stepMod: 0.5, notes: 2, holdFloor: 0.03, holdFactor: 0.5 * 0.85 },
};

export function computeArpTriggers(step: number, seqLen: number, rate: ArpRate, stepDur16: number): ArpTrigger[] {
  const cfg = ARP_RATE_CFG[rate];
  if (step % cfg.stepMod !== 0) return [];
  const subDur = cfg.notes === 2 ? stepDur16 / 2 : stepDur16;
  const triggers: ArpTrigger[] = [];
  for (let i = 0; i < cfg.notes; i++) {
    const noteIndex = cfg.notes === 2 ? (step * 2 + i) % seqLen : Math.floor(step / cfg.stepMod) % seqLen;
    triggers.push({
      noteIndex,
      timeOffsetSec: cfg.notes === 2 ? i * subDur : 0,
      holdSec: Math.max(cfg.holdFloor, cfg.holdFactor * stepDur16),
    });
  }
  return triggers;
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

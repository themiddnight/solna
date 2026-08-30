import type { ArpMode, ArpRate } from '../types';
import { buildArpSequence } from './arpeggiator';
import { computeArpTriggers } from './arpSchedule';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

/**
 * Fixed note-gate fraction for block-mode lead notes (arp off). One step at
 * 120 BPM is 0.125 s, so a 0.85 gate holds 0.106 s — the same ratio the
 * arpeggiator's holdFactor uses. Per-note gate (DEV-369) replaces this.
 */
export const LEAD_GATE = 0.85;

export interface LeadTrigger {
  note: string;
  timeOffsetSec: number;
  holdSec: number;
}

/**
 * The melody is stored at a fixed MAX_STEPS_PER_BAR width per bar and windowed
 * to the ACTIVE stepsPerBar at playback/UI time (the same non-destructive
 * scheme as SP1's drum rows). `stepInLoop` is already reduced to the melody
 * loop (`step % melodyLength`); this maps it through the per-bar window.
 */
export function leadStepNotes(
  steps: readonly string[][],
  stepInLoop: number,
  stepsPerBar: number,
): string[] {
  const barIndex = Math.floor(stepInLoop / stepsPerBar);
  const stepInBar = stepInLoop - barIndex * stepsPerBar;
  const idx = barIndex * MAX_STEPS_PER_BAR + stepInBar;
  return steps[idx] ?? [];
}

/** The melody-loop position for an absolute clock step. */
export function stepInLoopFor(step: number, melodyLength: number): number {
  return step % melodyLength;
}

/** Positive divisors of totalBars, ascending (e.g. 4 → [1, 2, 4]). */
export function loopLengthDivisors(totalBars: number): number[] {
  const divisors: number[] = [];
  for (let n = 1; n <= totalBars; n++) {
    if (totalBars % n === 0) divisors.push(n);
  }
  return divisors;
}

/**
 * Clamp down to the largest divisor of totalBars that is <= current. Falls
 * back to 1 for a zero/invalid totalBars. Always returns a divisor, so a
 * stored loopLength never runs past the progression.
 */
export function clampLeadLoopLength(current: number, totalBars: number): number {
  const divisors = loopLengthDivisors(totalBars);
  let best = 1;
  for (const d of divisors) {
    if (d <= current) best = d;
  }
  return best;
}

/**
 * Resize the melody by whole bars: trim trailing bars, pad empty bars. Each
 * "bar" is MAX_STEPS_PER_BAR slots, so a loopLength change never drops steps
 * drawn in the bars that survive.
 */
export function resizeLeadMelody(
  steps: readonly string[][],
  newLoopLength: number,
): string[][] {
  const targetLen = newLoopLength * MAX_STEPS_PER_BAR;
  const out = steps.slice(0, targetLen);
  while (out.length < targetLen) out.push([]);
  return out;
}

/**
 * Resolve a step's note set into note-on/off triggers.
 *
 * arp OFF → every note fires together (block) at the step start, held
 * LEAD_GATE × stepDurSec.
 * arp ON  → the notes feed buildArpSequence + computeArpTriggers exactly as
 * the keyboard arp does (reused unchanged); `arpStep` must already be
 * bar-phased by arpStepFor(step, stepsPerBar).
 */
export function resolveLeadStepTriggers(
  notes: readonly string[],
  arpActive: boolean,
  arpStep: number,
  params: { arpMode: ArpMode; arpRate: ArpRate; arpOctaves: number },
  stepDurSec: number,
): LeadTrigger[] {
  if (notes.length === 0) return [];
  if (!arpActive) {
    return notes.map((note) => ({
      note,
      timeOffsetSec: 0,
      holdSec: LEAD_GATE * stepDurSec,
    }));
  }
  const sequence = buildArpSequence(notes, params.arpMode, params.arpOctaves);
  if (sequence.length === 0) return [];
  return computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDurSec).map(
    (t) => ({
      note: sequence[t.noteIndex],
      timeOffsetSec: t.timeOffsetSec,
      holdSec: t.holdSec,
    }),
  );
}

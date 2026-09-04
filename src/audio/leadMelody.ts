import type { ArpMode, ArpRate } from '../types';
import { buildArpSequence } from './arpeggiator';
import { arpFiresOnStep, computeArpTriggers } from './arpSchedule';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { remapNoteByScaleDegree, rootSemitone, transposeNoteBySemitones } from '../utils/musicTheory';

/**
 * The default per-loop gate: what fraction of a note's FINAL step sounds
 * before note-off. 0.85 is exactly the fixed gate this replaces, so a
 * project that never touches the slider sounds identical to before. Used as
 * the slice default and as the seed in both migration chains — the two
 * places that must agree on "what old music sounded like".
 */
export const DEFAULT_LEAD_GATE = 0.85;

export interface LeadTrigger {
  note: string;
  timeOffsetSec: number;
  holdSec: number;
}

/**
 * One drawn lead note. The matrix index is the step the note STARTS on;
 * `len` is how many steps it occupies, counted in ACTIVE steps (the current
 * meter's stepsPerBar), an integer >= 1. Defined here, next to the functions
 * that consume it, so store/ and components/ import it downward and audio/
 * never has to import either (CLAUDE.md, three-layer rule).
 */
export interface LeadNote {
  note: string;
  len: number;
}

/** True for the pre-DEV-369 `string[][]` melody shape. */
export function isLegacyLeadMelody(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every((n) => typeof n === 'string'))
  );
}

/**
 * The one transform both migration chains share: every old note becomes a
 * one-step note. The persist chain and the .solna chain call this from two
 * separate functions and must NOT be refactored into one — the persist
 * payload is private localStorage shape, a project body is an external
 * contract, and the two version numbers move for different reasons.
 */
export function upgradeLeadMelodyV1(steps: string[][]): LeadNote[][] {
  return steps.map((row) => row.map((note) => ({ note, len: 1 })));
}

/** A note audible at a step. `age` is how many steps ago it started; 0 = starts here. */
export interface LeadSounding {
  note: string;
  len: number;
  age: number;
}

/**
 * The stored slot for a loop step. The melody is stored at a fixed
 * MAX_STEPS_PER_BAR width per bar and windowed to the ACTIVE stepsPerBar, so
 * this is the one place that conversion lives.
 */
export function leadStoredIndexAt(stepInLoop: number, stepsPerBar: number): number {
  const barIndex = Math.floor(stepInLoop / stepsPerBar);
  return barIndex * MAX_STEPS_PER_BAR + (stepInLoop - barIndex * stepsPerBar);
}

/**
 * The inverse: the ACTIVE-window position of a stored slot, or -1 when the
 * slot is DORMANT — an offset the current meter cannot reach (12/8 draws 24
 * steps to the bar, 4/4 only 16). Computing a position for a dormant slot
 * anyway yields a fictitious one that runs past the loop end, which is the
 * defect resizeLeadMelody was already fixed for; callers must decide what a
 * dormant slot means to them rather than acting on a made-up number.
 */
export function leadActivePosAt(storedIndex: number, stepsPerBar: number): number {
  const barIndex = Math.floor(storedIndex / MAX_STEPS_PER_BAR);
  const offset = storedIndex - barIndex * MAX_STEPS_PER_BAR;
  return offset >= stepsPerBar ? -1 : barIndex * stepsPerBar + offset;
}

/**
 * Every note sounding at `stepInLoop`, whether it started there or earlier.
 * The melody is stored at a fixed MAX_STEPS_PER_BAR width per bar and
 * windowed to the ACTIVE stepsPerBar (the same non-destructive scheme as
 * SP1's drum rows); `stepInLoop` is already reduced to the melody loop.
 *
 * Stateless by design: it scans backward from stepInLoop to step 0 rather
 * than maintaining a sounding-note map across ticks, which would have to be
 * rebuilt correctly on every seek, loop switch and stop. The scan stops at
 * step 0 because invariant 2 guarantees no note wraps the loop boundary.
 * Worst case is loop-length iterations of array indexing per clock tick.
 */
export function leadSoundingNotes(
  steps: readonly LeadNote[][],
  stepInLoop: number,
  stepsPerBar: number,
): LeadSounding[] {
  const out: LeadSounding[] = [];
  for (let age = 0; age <= stepInLoop; age++) {
    const row = steps[leadStoredIndexAt(stepInLoop - age, stepsPerBar)];
    if (!row) continue;
    for (const n of row) {
      if (n.len > age) out.push({ note: n.note, len: n.len, age });
    }
  }
  return out;
}

/**
 * The STORED index of the note of pitch `note` sounding at `stepInLoop`, or
 * -1 when that pitch is not sounding there. Deliberately implemented THROUGH
 * leadSoundingNotes rather than as a second backward scan: "covered" must
 * mean exactly the same thing to the scheduler and to a mouse click, and two
 * copies of the scan would eventually disagree.
 */
export function leadCoveringNoteIndex(
  steps: readonly LeadNote[][],
  stepInLoop: number,
  stepsPerBar: number,
  note: string,
): number {
  const covering = leadSoundingNotes(steps, stepInLoop, stepsPerBar).find((s) => s.note === note);
  if (!covering) return -1;
  return leadStoredIndexAt(stepInLoop - covering.age, stepsPerBar);
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
 *
 * Also clamps notes that now overhang the new loop end, so invariant 2
 * ("start + len never crosses the loop end") survives a loop-length change
 * as well as a write. `len` counts ACTIVE steps, which is why stepsPerBar is
 * needed here and the stored width alone is not enough.
 */
export function resizeLeadMelody(
  steps: readonly LeadNote[][],
  newLoopLength: number,
  stepsPerBar: number,
): LeadNote[][] {
  const targetLen = newLoopLength * MAX_STEPS_PER_BAR;
  const loopEnd = newLoopLength * stepsPerBar;
  const out: LeadNote[][] = [];
  for (let i = 0; i < targetLen; i++) {
    const row = steps[i];
    if (!row) {
      out.push([]);
      continue;
    }
    const barIndex = Math.floor(i / MAX_STEPS_PER_BAR);
    const offset = i - barIndex * MAX_STEPS_PER_BAR;
    // A slot the active meter cannot reach (offset >= stepsPerBar) is
    // dormant, not overhanging — leave it untouched, or a meter change would
    // silently rewrite length data a wider meter still needs (leadSlice.test.ts's
    // "a meter change never touches the stored melody" invariant).
    if (offset >= stepsPerBar) {
      out.push(row.map((n) => ({ ...n })));
      continue;
    }
    const activePos = barIndex * stepsPerBar + offset;
    const maxLen = Math.max(1, loopEnd - activePos);
    out.push(row.map((n) => ({ note: n.note, len: Math.min(n.len, maxLen) })));
  }
  return out;
}

/**
 * Transpose the whole melody by the root-change interval (uniform chromatic
 * transpose — preserves every interval and moves out-of-scale notes too).
 */
export function transposeLeadMelodyByRoot(
  steps: readonly LeadNote[][],
  fromRoot: string,
  toRoot: string,
): LeadNote[][] {
  const delta = rootSemitone(toRoot) - rootSemitone(fromRoot);
  return steps.map((row) =>
    row.map((n) => ({ note: transposeNoteBySemitones(n.note, delta), len: n.len })),
  );
}

/**
 * Re-map the melody to a new scale by degree (same root). In-scale notes move to
 * the same degree of the new scale; out-of-scale notes stay put.
 */
export function remapLeadMelodyByScale(
  steps: readonly LeadNote[][],
  root: string,
  fromType: string,
  toType: string,
): LeadNote[][] {
  return steps.map((row) =>
    row.map((n) => ({
      note: remapNoteByScaleDegree(n.note, root, fromType, root, toType),
      len: n.len,
    })),
  );
}

/**
 * A sounding note's length capped to the ACTIVE loop, in steps.
 *
 * Invariant 2 ("start + len never crosses the loop end") is enforced on write
 * (setLeadNoteLength) and on a loop-length change (resizeLeadMelody), and
 * `len` counts ACTIVE steps — so a METER change can leave a legally drawn
 * note overhanging: a len-20 note at column 0 is legal in 12/8 (24 steps to
 * the bar) and two steps too long in 4/4. setMeter deliberately does not
 * touch the stored melody (leadSlice.test.ts pins that), so the cap belongs
 * here, at read time, where it is non-destructive and where it agrees with
 * leadCellKinds, which already truncates the drawn span to the active
 * columns. Without it the audio rings past the loop seam that re-triggers
 * the same pitch, and the backward scan's justification for stopping at step
 * 0 stops holding.
 */
function leadAudibleLen(
  s: LeadSounding,
  loop: { stepInLoop: number; melodyLength: number },
): number {
  const startPos = loop.stepInLoop - s.age;
  return Math.max(1, Math.min(s.len, loop.melodyLength - startPos));
}

/**
 * Resolve a step's SOUNDING notes into note-on/off triggers.
 *
 * arp OFF (block) → only notes starting here (age 0) fire, together, held
 * (len - 1 + gate) * stepDurSec: the gate trims the tail of the FINAL step
 * only, so length is duration and gate is articulation. Notes with age > 0
 * emit nothing — their note-off was scheduled at an absolute time when they
 * started, so Web Audio needs no cross-tick bookkeeping.
 *
 * arp ON → ALL sounding notes feed buildArpSequence + computeArpTriggers
 * (reused unchanged), including age > 0: a note's length means the same
 * thing in both modes, and a long note under an arp visibly asks to keep
 * feeding the arpeggio. `arpStep` must already be bar-phased by
 * arpStepFor(step, stepsPerBar).
 *
 * `loop` is the ACTIVE window the step was resolved in, and it is what caps
 * invariant 2 at READ time (leadAudibleLen). Do not be tempted to clamp in
 * setMeter instead: a meter change is deliberately non-destructive.
 *
 * Known and accepted: the gate has no effect while the arp is on.
 * computeArpTriggers derives its own holdSec from arpRate, and multiplying
 * it by the gate would change the sound of every existing arp pattern the
 * moment this lands. The slider's tooltip says so.
 */
export function resolveLeadStepTriggers(
  sounding: readonly LeadSounding[],
  arpActive: boolean,
  arpStep: number,
  params: { arpMode: ArpMode; arpRate: ArpRate; arpOctaves: number },
  stepDurSec: number,
  gate: number,
  loop: { stepInLoop: number; melodyLength: number },
): LeadTrigger[] {
  if (sounding.length === 0) return [];
  if (!arpActive) {
    return sounding
      .filter((s) => s.age === 0)
      .map((s) => ({
        note: s.note,
        timeOffsetSec: 0,
        holdSec: (leadAudibleLen(s, loop) - 1 + gate) * stepDurSec,
      }));
  }
  if (!arpFiresOnStep(arpStep, params.arpRate)) return [];
  const sequence = buildArpSequence(
    sounding.map((s) => s.note),
    params.arpMode,
    params.arpOctaves,
  );
  if (sequence.length === 0) return [];
  return computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDurSec).map(
    (t) => ({
      note: sequence[t.noteIndex],
      timeOffsetSec: t.timeOffsetSec,
      holdSec: t.holdSec,
    }),
  );
}

import type { ArpMode, ArpRate } from '../types';
import { buildArpSequence } from './arpeggiator';
import { arpFiresOnStep, computeArpTriggers } from './arpSchedule';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import {
  LEAD_TICKS_PER_BAR,
  TICKS_PER_SIXTEENTH,
  clampColumn,
  columnsPerBar,
  leadNoteCells,
} from '../utils/stepResolution';
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
 * One drawn lead note. The matrix index is the STORED tick the note starts
 * on; `len` is how many TICKS it occupies, an integer >= 1. Ticks, not
 * cells: a resolution change alters how long a cell is, so a length counted
 * in cells would make every note four times shorter the moment you switched
 * from 1/8 to 1/32. A quarter note is 8 ticks at every resolution.
 *
 * Defined here, next to the functions that consume it, so store/ and
 * components/ import it downward and audio/ never has to import either
 * (CLAUDE.md, three-layer rule).
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

/**
 * The second transform both migration chains share: the melody widens from
 * MAX_STEPS_PER_BAR slots a bar to LEAD_TICKS_PER_BAR, stored slot `i`
 * becomes tick `i * TICKS_PER_SIXTEENTH`, the ticks between stay empty, and
 * every `len` is multiplied by TICKS_PER_SIXTEENTH because it now counts
 * ticks instead of 16ths.
 *
 * `bars` is the loop's own bar count and it is a FLOOR, never a truth: the
 * array's own bar span (ceil(length / MAX_STEPS_PER_BAR)) wins whenever it
 * is wider. `bars` is still an argument rather than the whole derivation
 * because LEAD_TICKS_PER_BAR is itself a multiple of MAX_STEPS_PER_BAR, so
 * a short array's length alone cannot say how many bars the loop wants —
 * it just stops being trusted OVER the data.
 *
 * That rule is not defensive. setLeadLoopLengthPreserve lowers
 * leadLoopLength WITHOUT resizing the melody on purpose (the extra bars go
 * dormant and play again when the length is raised back), so a stored
 * melody wider than `bars` is an ordinary persisted state. Taking `bars`
 * at its word read old bar 1 at half its beat when the surplus was exactly
 * 2x — LEAD_TICKS_PER_BAR being 2 * MAX_STEPS_PER_BAR made the old array
 * the exact width of the new one — and deleted the surplus bars outright
 * above that. Both results pass asLeadNoteMatrix, so nothing threw.
 *
 * There is deliberately NO width-equality idempotence guard: each chain's
 * version gate already guarantees this runs exactly once, and the guard was
 * the very thing that mistook two old bars for one new one.
 *
 * The persist chain and the .solna chain call this from two separate
 * functions and must NOT be refactored into one: the persist payload is
 * private localStorage shape, a project body is an external contract, and
 * the two version numbers move for different reasons.
 */
export function upgradeLeadMelodyToTicks(
  steps: readonly LeadNote[][],
  bars: number,
): LeadNote[][] {
  const barCount = Math.max(
    Math.max(1, Math.round(bars) || 1),
    Math.ceil(steps.length / MAX_STEPS_PER_BAR),
  );
  const out: LeadNote[][] = Array.from(
    { length: barCount * LEAD_TICKS_PER_BAR },
    () => [] as LeadNote[],
  );
  for (let bar = 0; bar < barCount; bar++) {
    for (let slot = 0; slot < MAX_STEPS_PER_BAR; slot++) {
      const row = steps[bar * MAX_STEPS_PER_BAR + slot];
      if (!row) continue;
      out[bar * LEAD_TICKS_PER_BAR + slot * TICKS_PER_SIXTEENTH] = row.map((n) => ({
        note: n.note,
        len: Math.max(1, Math.round(n.len)) * TICKS_PER_SIXTEENTH,
      }));
    }
  }
  return out;
}

/** A note audible at a column. `age` is how many TICKS ago it started; 0 = starts here. */
export interface LeadSounding {
  note: string;
  len: number;
  age: number;
}

/**
 * The stored slot for a loop TICK. Bar-major at LEAD_TICKS_PER_BAR — the
 * one coordinate space that depends on neither meter nor resolution, which
 * is what makes a .solna body portable between both.
 *
 * Exported because every "walk the ticks a note covers" loop needs it —
 * pasteLeadBar's here, setLeadNoteLength's swallow loop in the store. That
 * one used to reach it as leadStoredIndexAt(tick, stepsPerBar, 1), a magic
 * stride that only meant "please do not scale my argument".
 */
export function leadStoredIndexAtTick(tickInLoop: number, stepsPerBar: number): number {
  const ticksPerBar = stepsPerBar * TICKS_PER_SIXTEENTH;
  const barIndex = Math.floor(tickInLoop / ticksPerBar);
  return barIndex * LEAD_TICKS_PER_BAR + (tickInLoop - barIndex * ticksPerBar);
}

/**
 * The stored slot for a loop COLUMN. A column is `stride` ticks wide, and
 * the melody is stored at the finest resolution and windowed to the active
 * one — the same non-destructive scheme meter already runs, one dimension
 * over. This is the ONE column -> stored conversion in the codebase; the
 * duplicate in components/loop/lead/melodyGrid.ts was deleted for this.
 */
export function leadStoredIndexAt(column: number, stepsPerBar: number, stride: number): number {
  return leadStoredIndexAtTick(column * stride, stepsPerBar);
}

/**
 * The inverse of leadStoredIndexAtTick: the loop TICK a stored slot sits on, or
 * -1 when the active METER cannot reach it. Deliberately blind to the
 * stride — a slot the current resolution cannot draw still occupies a real
 * tick, and the two length invariants are rules about STORAGE. Meter
 * dormancy is the one case with no answer to give: a slot past the bar's
 * width has no position in the loop at all, which is why it stays -1 here
 * as it does in leadActivePosAt.
 */
function loopTickAtStoredIndex(storedIndex: number, stepsPerBar: number): number {
  const ticksPerBar = stepsPerBar * TICKS_PER_SIXTEENTH;
  const barIndex = Math.floor(storedIndex / LEAD_TICKS_PER_BAR);
  const tickInBar = storedIndex - barIndex * LEAD_TICKS_PER_BAR;
  if (tickInBar >= ticksPerBar) return -1;
  return barIndex * ticksPerBar + tickInBar;
}

/**
 * The inverse: the ACTIVE-window column of a stored slot, or -1 when the
 * slot is DORMANT. There are now TWO ways to be dormant and both live
 * here and nowhere else:
 *
 *   tickInBar >= stepsPerBar * TICKS_PER_SIXTEENTH  -> outside the bar (meter)
 *   tickInBar % stride !== 0                        -> off the grid (resolution)
 *
 * Every existing caller already handles -1: paintLeadNote falls back to the
 * slot's own contents, setLeadNoteLength refuses, pasteLeadBar skips. The
 * scheduler reads through columns only, so an off-grid note is silent with
 * no branch added anywhere else — it is simply never visited.
 *
 * Silent-and-preserved, not muted-and-lost: the melody grid is the ONLY
 * editor there is, so a note that sounds but cannot be seen or deleted
 * would be a trap. Computing a position for a dormant slot anyway yields a
 * fictitious one that runs past the loop end, which is the defect
 * resizeLeadMelody was already fixed for.
 */
export function leadActivePosAt(storedIndex: number, stepsPerBar: number, stride: number): number {
  const barIndex = Math.floor(storedIndex / LEAD_TICKS_PER_BAR);
  const tickInBar = storedIndex - barIndex * LEAD_TICKS_PER_BAR;
  if (tickInBar >= stepsPerBar * TICKS_PER_SIXTEENTH) return -1;
  if (tickInBar % stride !== 0) return -1;
  return barIndex * columnsPerBar(stepsPerBar, stride) + tickInBar / stride;
}

/**
 * Every note sounding at `columnInLoop`, whether it started there or
 * earlier. The melody is stored at a fixed LEAD_TICKS_PER_BAR width per bar
 * and windowed to the ACTIVE stepsPerBar and stride (the same
 * non-destructive scheme as SP1's drum rows); `columnInLoop` is already
 * reduced to the melody loop.
 *
 * Stateless by design: it scans backward from columnInLoop to column 0
 * rather than maintaining a sounding-note map across ticks, which would have
 * to be rebuilt correctly on every seek, loop switch and stop. The scan stops
 * at column 0 because invariant 2 guarantees no note wraps the loop boundary.
 * Worst case is loop-length iterations of array indexing per clock tick.
 * The scan is by COLUMN and the age it reports is in ticks. At 1/32 with a
 * 4-bar 4/4 loop that is 128 iterations per dispatch instead of 64, and
 * there can be two dispatched columns per clock tick. Accepted, not
 * overlooked: it is array indexing over a short array, and the stateless
 * design is what stops a seek, a loop switch or a stop desynchronising a
 * sounding-note map. If it ever shows up in a profile, the fix is a cache
 * keyed on the melody, not a stateful map.
 */
export function leadSoundingNotes(
  steps: readonly LeadNote[][],
  columnInLoop: number,
  stepsPerBar: number,
  stride: number,
): LeadSounding[] {
  const out: LeadSounding[] = [];
  for (let columnsBack = 0; columnsBack <= columnInLoop; columnsBack++) {
    const row = steps[leadStoredIndexAt(columnInLoop - columnsBack, stepsPerBar, stride)];
    if (!row) continue;
    // age is in TICKS, so the `n.len > age` test and leadAudibleLen's clamp
    // keep working verbatim against tick-counted lengths.
    const age = columnsBack * stride;
    for (const n of row) {
      if (n.len > age) out.push({ note: n.note, len: n.len, age });
    }
  }
  return out;
}

/**
 * The STORED index of the note of pitch `note` sounding at `columnInLoop`,
 * or -1 when that pitch is not sounding there. Deliberately implemented THROUGH
 * leadSoundingNotes rather than as a second backward scan: "covered" must
 * mean exactly the same thing to the scheduler and to a mouse click, and two
 * copies of the scan would eventually disagree.
 */
export function leadCoveringNoteIndex(
  steps: readonly LeadNote[][],
  columnInLoop: number,
  stepsPerBar: number,
  stride: number,
  note: string,
): number {
  const covering = leadSoundingNotes(steps, columnInLoop, stepsPerBar, stride).find(
    (s) => s.note === note,
  );
  if (!covering) return -1;
  // age is ticks; the scan walked whole columns, so this division is exact.
  return leadStoredIndexAt(columnInLoop - covering.age / stride, stepsPerBar, stride);
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
 * "bar" is LEAD_TICKS_PER_BAR slots, so a loopLength change never drops
 * ticks drawn in the bars that survive.
 *
 * Also clamps notes that now overhang the new loop end, so invariant 2
 * ("start + len never crosses the loop end") survives a loop-length change
 * as well as a write. `len` counts TICKS, which is why stepsPerBar is
 * needed here and the stored width alone is not enough.
 */
export function resizeLeadMelody(
  steps: readonly LeadNote[][],
  newLoopLength: number,
  stepsPerBar: number,
  stride: number,
): LeadNote[][] {
  const targetLen = newLoopLength * LEAD_TICKS_PER_BAR;
  const loopEndTicks = newLoopLength * stepsPerBar * TICKS_PER_SIXTEENTH;
  const out: LeadNote[][] = [];
  for (let i = 0; i < targetLen; i++) {
    const row = steps[i];
    if (!row) {
      out.push([]);
      continue;
    }
    // The ONE dormancy test (leadActivePosAt), not a second copy: a slot
    // the active window cannot reach is dormant, not overhanging — leave it
    // untouched, or a meter change would silently rewrite length data a
    // wider window still needs (leadSlice.test.ts's "a meter change never
    // touches the stored melody" invariant). When resolution adds its own
    // kind of dormancy, this call site gets it for free.
    const activePos = leadActivePosAt(i, stepsPerBar, stride);
    if (activePos < 0) {
      out.push(row.map((n) => ({ ...n })));
      continue;
    }
    // activePos is a column and a column starts on activePos * stride ticks
    // exactly, because columnsPerBar * stride == the bar's ticks for every
    // meter (pinned by stepResolution.test.ts).
    const maxLen = Math.max(1, loopEndTicks - activePos * stride);
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
 * A sounding note's length capped to the ACTIVE loop, in ticks.
 *
 * Invariant 2 ("start + len never crosses the loop end") is enforced on write
 * (setLeadNoteLength) and on a loop-length change (resizeLeadMelody) — so a
 * METER change can leave a legally drawn note overhanging: a 40-tick note at
 * column 0 is legal in 12/8 (48 ticks to the bar) and eight ticks too long
 * in 4/4. setMeter deliberately does not
 * touch the stored melody (leadSlice.test.ts pins that), so the cap belongs
 * here, at read time, where it is non-destructive and where it agrees with
 * leadCellKinds, which already truncates the drawn span to the active
 * columns. Without it the audio rings past the loop seam that re-triggers
 * the same pitch, and the backward scan's justification for stopping at
 * column 0 stops holding.
 */
function leadAudibleLen(
  s: LeadSounding,
  loop: { tickInLoop: number; melodyTicks: number },
): number {
  const startTick = loop.tickInLoop - s.age;
  return Math.max(1, Math.min(s.len, loop.melodyTicks - startTick));
}

/**
 * Resolve a step's SOUNDING notes into note-on/off triggers.
 *
 * arp OFF (block) → only notes starting here (age 0) fire, together, held
 * (cells - 1 + gate) * stride * tickDurSec: the gate trims the tail of the
 * FINAL CELL only, so length is duration and gate is articulation. Notes
 * with age > 0
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
  tickDurSec: number,
  gate: number,
  stride: number,
  loop: { tickInLoop: number; melodyTicks: number },
): LeadTrigger[] {
  if (sounding.length === 0) return [];
  if (!arpActive) {
    return sounding
      .filter((s) => s.age === 0)
      .map((s) => {
        // What SOUNDS is what is DRAWN — the ONE copy of that rounding,
        // which the grid renderer calls too.
        //
        // The ceil cannot overrun the loop end: startTick is on-grid and
        // the bar's ticks divide by the stride for every meter, so
        // melodyTicks - startTick is a whole number of cells.
        const cells = leadNoteCells(leadAudibleLen(s, loop), stride);
        return {
          note: s.note,
          timeOffsetSec: 0,
          holdSec: (cells - 1 + gate) * stride * tickDurSec,
        };
      });
  }
  if (!arpFiresOnStep(arpStep, params.arpRate)) return [];
  const sequence = buildArpSequence(
    sounding.map((s) => s.note),
    params.arpMode,
    params.arpOctaves,
  );
  if (sequence.length === 0) return [];
  // The arp runs on the clock's 16ths, not on the grid's resolution: this
  // branch reads presence only and never asks a note how long it is, which
  // is why `cells`/`gate` are confined to the block branch above and why
  // computeArpTriggers keeps deriving its own holdSec.
  return computeArpTriggers(
    arpStep,
    sequence.length,
    params.arpRate,
    tickDurSec * TICKS_PER_SIXTEENTH,
  ).map((t) => ({
    note: sequence[t.noteIndex],
    timeOffsetSec: t.timeOffsetSec,
    holdSec: t.holdSec,
  }));
}

/**
 * The grid's selection is ONE number: the column the cursor sits on. The
 * selected bar is derived from it (leadCursorBar) rather than stored beside
 * it, so a bar highlight and a record head cannot drift apart.
 *
 * Clamped on read, not migrated on write: a meter change narrows the active
 * window, and a cursor left outside it is pulled back rather than being
 * silently rewritten in a slice that a project reload would restore anyway.
 */
export function clampLeadCursor(
  cursor: number,
  loopLength: number,
  stepsPerBar: number,
  stride: number,
): number {
  return clampColumn(cursor, loopLength * columnsPerBar(stepsPerBar, stride));
}

/** The bar a cursor COLUMN falls in. */
export function leadCursorBar(cursor: number, stepsPerBar: number, stride: number): number {
  return Math.floor(cursor / columnsPerBar(stepsPerBar, stride));
}

/**
 * One bar's notes, at the FULL stored width rather than the visible columns.
 * Copying only what the meter can currently reach would make copy→paste lose
 * the dormant slots, and would leave "what if the meter changes between the
 * two" as a question with no good answer.
 */
export function copyLeadBar(steps: readonly LeadNote[][], bar: number): LeadNote[][] {
  const base = bar * LEAD_TICKS_PER_BAR;
  return Array.from({ length: LEAD_TICKS_PER_BAR }, (_, i) =>
    (steps[base + i] ?? []).map((n) => ({ note: n.note, len: n.len })),
  );
}

/**
 * Replace one bar with a copied one, keeping the two length invariants the
 * store enforces everywhere else:
 *
 *   - A note that STARTS in an earlier bar can reach across the bar line into
 *     the target. Overwriting the target's slots alone would leave that note
 *     and a pasted one sounding the same pitch at the same step, so it is
 *     truncated at the line.
 *   - A pasted note can be longer than the room left in the loop, and can
 *     reach over notes in later bars. It is clamped to the loop end and
 *     swallows the same pitch underneath it — the same rule dragging a note's
 *     end already follows.
 *
 * Both rules are enforced in TICKS, which is why this takes no stride: a
 * paste is an explicit EDIT and both invariants are rules about STORAGE, so
 * the result must not depend on the resolution the grid happens to be
 * showing. Taking one invited gating the truncation on leadActivePosAt,
 * which let an off-grid note overhang the bar line.
 */
export function pasteLeadBar(
  steps: readonly LeadNote[][],
  bar: number,
  clip: readonly LeadNote[][],
  stepsPerBar: number,
  loopLength: number,
): LeadNote[][] {
  const base = bar * LEAD_TICKS_PER_BAR;
  // Rebuilt to at least the target bar's end, not `steps.map`: the target bar
  // can sit past the stored width whenever leadLoopLength and the melody
  // disagree (sanitizeLoops falls a rejected melody back to ONE default bar
  // without touching leadLoopLength, and accepts a literal []). Writing
  // next[base + i] onto a short array leaves HOLES — Array#map skips them, so
  // a later paintLeadNote at one of those indices silently does nothing, and
  // JSON.stringify turns them into `null`, which asLeadNoteMatrix refuses
  // WHOLE: the melody comes back blank on the next reload. Padding here keeps
  // every write landing on a real row.
  const next: LeadNote[][] = Array.from(
    { length: Math.max(steps.length, base + LEAD_TICKS_PER_BAR) },
    (_, i) => (steps[i] ?? []).map((n) => ({ note: n.note, len: n.len })),
  );
  const ticksPerBar = stepsPerBar * TICKS_PER_SIXTEENTH;
  const barStartTick = bar * ticksPerBar;
  const loopEndTicks = loopLength * ticksPerBar;

  // Walk TICKS, not columns. Invariant 1 is a rule about STORAGE and a paste
  // is an explicit EDIT: "quiet, not gone" protects a change of VIEW only,
  // so a note stored off the current grid is truncated at the bar line like
  // any other. Skipping it left two note-ons of one pitch on the same
  // instant, readable the moment the loop was opened at a finer resolution.
  // Same rule as setLeadNoteLength's swallow loop.
  for (let idx = 0; idx < base && idx < next.length; idx++) {
    const startTick = loopTickAtStoredIndex(idx, stepsPerBar);
    if (startTick < 0) continue;
    next[idx] = next[idx].map((n) =>
      startTick + n.len > barStartTick ? { note: n.note, len: barStartTick - startTick } : n,
    );
  }

  for (let i = 0; i < LEAD_TICKS_PER_BAR; i++) {
    next[base + i] = (clip[i] ?? []).map((n) => ({ note: n.note, len: n.len }));
  }

  for (let i = 0; i < LEAD_TICKS_PER_BAR; i++) {
    const startTick = loopTickAtStoredIndex(base + i, stepsPerBar);
    if (startTick < 0) continue;
    next[base + i] = next[base + i].map((n) => ({
      note: n.note,
      len: Math.max(1, Math.min(n.len, loopEndTicks - startTick)),
    }));
    for (const n of next[base + i]) {
      // Walk TICKS, not columns: a pasted note swallows the same pitch
      // underneath it wherever it is stored, including slots the current
      // resolution cannot reach.
      for (let k = 1; k < n.len; k++) {
        const covered = leadStoredIndexAtTick(startTick + k, stepsPerBar);
        if (covered === base + i || !next[covered]) continue;
        next[covered] = next[covered].filter((x) => x.note !== n.note);
      }
    }
  }

  return next;
}

// Grouping and hold maths over CHORD_RHYTHMS. Everything here computes; the
// table itself is in data/chordRhythms.ts, and the two used to share a file —
// which meant a review of "I retuned a pattern" and a review of "I changed the
// hold maths" looked identical in a diff list.

import { groupByStyle } from './groupByStyle';
import { CHORD_RHYTHMS, type RhythmHit, type RhythmPattern } from '@/data/chordRhythms';
import { BASS_PATTERNS, type BassPattern, type BassStepChoice } from '@/data/bassPatterns';
import { customBassPatternFromSpans } from './bassPatterns';
import { adaptStepEvents } from '../utils/eventAdapt';
import { getMeter, type MeterId } from '../utils/meter';
import { normalizePatternSpans } from '../utils/customPattern';
import { foldPatternBoundaries, patternStoredIndexAt } from '../utils/patternTimeline';

// Rhythms grouped by style, computed once at module load for the style-grouped
// select UI.
export const CHORD_RHYTHM_STYLE_GROUPS = groupByStyle(CHORD_RHYTHMS);

/**
 * Maps the 0–1 "feel" slider to a hold-duration multiplier.
 * 0.5 (center) = x1 neutral; 0 = x0.5 tight; 1 = x2 loose.
 * Exponential so each slider half feels symmetric to the ear.
 */
export function feelToHoldScale(feel: number): number {
  return 2 ** (2 * (feel - 0.5));
}

/** Equal-power per-voice gain scale: keeps dense chords at roughly constant loudness. */
export function equalPowerVelocityScale(noteCount: number): number {
  return 1 / Math.sqrt(Math.max(1, noteCount));
}

/** Full-bar hold duration, capped so a held chord never spills past its own length. */
export function fullHoldDuration(totalBars: number, barDur: number, holdScale: number): number {
  return Math.min(totalBars * barDur * holdScale, totalBars * barDur);
}

/**
 * Synthesize a RhythmPattern from a STORED span row at the active meter.
 *
 * Same walk and the same defensive `normalizePatternSpans` as
 * `customBassPatternFromSpans`: columns, not stored slots, and against the
 * ACTIVE boundaries, so a slot a meter change just made visible is clamped
 * here rather than during the view change that would have to write.
 *
 * A hit's `step` is its CYCLE column, not its step inside a bar: the pattern
 * this returns is drawn across the whole cycle and is paired with the
 * `cycleSteps` that says how wide that is (see `PlaybackPatternCycle`). Nothing
 * downstream may re-adapt it — it is authored at the active meter already.
 */
function customRhythmPatternFromSpans(
  values: readonly boolean[],
  holds: readonly number[],
  stepsPerBar: number,
  cycleSteps: number,
  boundaries: readonly number[],
  meter: MeterId,
): RhythmPattern {
  const normalized = normalizePatternSpans({
    values,
    holds,
    stepsPerBar,
    cycleSteps,
    boundaries,
    empty: false,
  });

  const hits: RhythmHit[] = [];
  for (let column = 0; column < cycleSteps; column += 1) {
    const index = patternStoredIndexAt(column, stepsPerBar);
    if (normalized.values[index] !== true) continue;
    hits.push({ step: column, type: 'block', velocity: 1, holdSteps: normalized.holds[index] });
  }
  return { id: 'custom', name: 'Custom', style: 'Custom', meter, hits };
}

/**
 * Patterns that hold one voice across the whole chord instead of re-striking.
 *
 * `stepsPerBar` is the ACTIVE bar length, not the constant 16: in 12/8 a bar is
 * 24 steps, and a 16-step hold there covers two thirds of a bar, not all of it.
 * Exported so the pure-logic tests can reach them without React.
 */
export function isFullHoldRhythm(pattern: RhythmPattern, stepsPerBar: number): boolean {
  return (
    pattern.id === "sustained" ||
    (pattern.hits.length === 1 &&
      pattern.hits[0].step === 0 &&
      (pattern.hits[0].holdSteps ?? 1) >= stepsPerBar)
  );
}

export function isFullHoldBass(pattern: BassPattern, stepsPerBar: number): boolean {
  return (
    pattern.id === "whole-note-root" ||
    (pattern.steps.length === 1 &&
      pattern.steps[0].step === 0 &&
      (pattern.steps[0].holdSteps ?? 1) >= stepsPerBar)
  );
}

function resolveRhythmPattern(id: string): RhythmPattern {
  return CHORD_RHYTHMS.find((p) => p.id === id) ?? CHORD_RHYTHMS[0];
}

function resolveBassPattern(id: string): BassPattern {
  return BASS_PATTERNS.find((p) => p.id === id) ?? BASS_PATTERNS[0];
}

/**
 * A pattern resolved for playback together with its cycle: how many columns one
 * pass of it spans, and whether it is the user's own row. `custom` is carried
 * rather than re-derived from an id or a hold length because two decisions turn
 * on it and would answer wrongly from the pattern alone — the whole-chord
 * full-hold fast path is preset-only (`isFullHoldRhythmCycle`), and Feel may
 * only tighten a length the user drew (`cycleHoldScale`).
 */
export interface PlaybackPatternCycle<T> {
  pattern: T;
  cycleSteps: number;
  custom: boolean;
}

/**
 * Where an absolute step falls inside a cycle of `cycleSteps`. The one seam
 * rule live scheduling, preview and offline rendering share: writing the `%`
 * per consumer is how a preview and the transport come to disagree about where
 * a cycle starts. A negative remainder is raised by the cycle, so an unsigned
 * step yields a column an event can actually match.
 */
export function cycleStepAt(absoluteStep: number, cycleSteps: number): number {
  return ((absoluteStep % cycleSteps) + cycleSteps) % cycleSteps;
}

/**
 * The Feel multiplier a resolved cycle's holds are scaled by. A custom span is
 * a length the user DREW, so Feel may only tighten it — without the cap, a
 * preset's loose x2 would silently overrule an explicit resize. Presets keep
 * the whole x0.5..x2 range, unchanged.
 */
export function cycleHoldScale(custom: boolean, feel: number): number {
  const scale = feelToHoldScale(feel);
  return custom ? Math.min(1, scale) : scale;
}

/** The cycle a custom lane resolves against: its width and its folded boundaries. */
function customCycle(
  chordDurations: readonly number[],
  loopLength: number,
  stepsPerBar: number,
): { cycleSteps: number; boundaries: number[] } {
  const cycleSteps = loopLength * stepsPerBar;
  return { cycleSteps, boundaries: foldPatternBoundaries(chordDurations, cycleSteps) };
}

/**
 * Mode-aware chord-cycle resolution for playback — the shape live scheduling,
 * previews and the offline renderer all consume.
 *
 * A preset resolves to ONE ACTIVE BAR: the library pattern adapted to
 * `stepsPerBar`, so it must not be adapted again downstream. A custom lane
 * walks its stored row across its own independent cycle and reports that
 * cycle's width; the row is normalized at read time against the boundaries the
 * CURRENT progression folds onto the cycle, which is what makes a slot a meter
 * or progression change brought back into view legal without either change
 * having written anything.
 *
 * `chordDurations` are the progression's chord lengths in COLUMNS of the active
 * meter — never `ChordItem.bars` directly — so a later fractional-length chord
 * supplies its own column count without changing this contract.
 */
export function resolvePlaybackRhythmCycle(
  mode: 'preset' | 'custom',
  rhythmId: string,
  values: readonly boolean[],
  holds: readonly number[],
  loopLength: number,
  stepsPerBar: number,
  meterId: MeterId,
  chordDurations: readonly number[],
): PlaybackPatternCycle<RhythmPattern> {
  if (mode !== 'custom') {
    return {
      pattern: adaptRhythmPattern(resolveRhythmPattern(rhythmId), stepsPerBar),
      cycleSteps: stepsPerBar,
      custom: false,
    };
  }
  const { cycleSteps, boundaries } = customCycle(chordDurations, loopLength, stepsPerBar);
  return {
    pattern: customRhythmPatternFromSpans(values, holds, stepsPerBar, cycleSteps, boundaries, meterId),
    cycleSteps,
    custom: true,
  };
}

/** The bass half of `resolvePlaybackRhythmCycle`, same contract and same split. */
export function resolvePlaybackBassCycle(
  mode: 'preset' | 'custom',
  patternId: string,
  values: readonly BassStepChoice[],
  holds: readonly number[],
  loopLength: number,
  stepsPerBar: number,
  meterId: MeterId,
  chordDurations: readonly number[],
): PlaybackPatternCycle<BassPattern> {
  if (mode !== 'custom') {
    return {
      pattern: adaptBassPattern(resolveBassPattern(patternId), stepsPerBar),
      cycleSteps: stepsPerBar,
      custom: false,
    };
  }
  const { cycleSteps, boundaries } = customCycle(chordDurations, loopLength, stepsPerBar);
  return {
    pattern: customBassPatternFromSpans(values, holds, stepsPerBar, cycleSteps, boundaries, meterId),
    cycleSteps,
    custom: true,
  };
}

/**
 * The whole-chord full-hold fast path as a property of a resolved CYCLE, and
 * preset-only: a custom span covering the whole cycle is a length the user
 * drew, so it must release and retrigger at the seam rather than become one
 * held voice. These wrappers exist so no call site can ask the raw predicates
 * (`isFullHoldRhythm`/`isFullHoldBass`) about a custom pattern and get the
 * wrong answer — which it would, since the custom row copies its holds verbatim
 * and a full-cycle hold therefore looks exactly like a full hold.
 */
export function isFullHoldRhythmCycle(cycle: PlaybackPatternCycle<RhythmPattern>): boolean {
  return !cycle.custom && isFullHoldRhythm(cycle.pattern, cycle.cycleSteps);
}

export function isFullHoldBassCycle(cycle: PlaybackPatternCycle<BassPattern>): boolean {
  return !cycle.custom && isFullHoldBass(cycle.pattern, cycle.cycleSteps);
}

/**
 * Playback-time adaptation. Chord and bass rhythms are picked by id and never
 * edited by the user, so the library stays byte-identical on disk and a meter
 * change re-adapts on the next chord — no migration, no lossy write-back.
 * (The drum grid is the opposite case: it is user-editable, so preset
 * adaptation there is materialised at APPLY time in the sequencer slice.)
 *
 * Returns the SAME object when no adaptation is needed, so the identity checks
 * and id comparisons downstream (isFullHoldRhythm/isFullHoldBass) are unaffected
 * in 4/4.
 */
export function adaptRhythmPattern(pattern: RhythmPattern, stepsPerBar: number): RhythmPattern {
  const sourceSteps = getMeter(pattern.meter).stepsPerBar;
  if (sourceSteps === stepsPerBar) return pattern;
  return { ...pattern, hits: adaptStepEvents(pattern.hits, sourceSteps, stepsPerBar) };
}

export function adaptBassPattern(pattern: BassPattern, stepsPerBar: number): BassPattern {
  const sourceSteps = getMeter(pattern.meter).stepsPerBar;
  if (sourceSteps === stepsPerBar) return pattern;
  return { ...pattern, steps: adaptStepEvents(pattern.steps, sourceSteps, stepsPerBar) };
}

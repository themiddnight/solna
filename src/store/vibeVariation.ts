/**
 * Rerolling a vibe: an id drawn from each of the vibe's own pools, plus a BPM.
 *
 * There is no generation here and there never was — every axis picks an id out
 * of a list a human wrote. The drum axis was the exception until it became a
 * pool like the other four: it used to hold a catalogue of named density rows
 * and a kick-collision filter, both of which existed to make GENERATED rows
 * musical. Authored grids are curated, so both are deleted; a crash on beat 1
 * over a kick on beat 1 is standard, and filtering it out would reject a grid
 * for being correct.
 *
 * Nothing here turns an id into a value: a reroll produces a VibeSpec, and
 * `resolveVibe` stays the one place a vibe's library ids become chords, rows
 * and effects. The two library lookups below read a NAME for the toast and
 * nothing else.
 */
import type { VibeSpec } from '../data/vibes';
import { progressionById } from '@/audio/chordProgressions';
import { BASS_PATTERNS } from '@/data/bassPatterns';
import { CHORD_RHYTHMS } from '@/data/chordRhythms';
import { DRUM_GRIDS } from '@/data/drumGrids';

/**
 * The randomness boundary. Every function that varies a vibe takes one of
 * these; none of them calls Math.random. That is what makes the draw policy
 * testable by enumeration instead of by chance.
 */
export interface VibeDraw {
  /** Uniform choice. Throws on an empty list — an empty pool is an authoring bug. */
  pick<T>(items: T[]): T;
  /**
   * Uniform choice excluding `current`. Falls back to `current` only when it is
   * the sole member of `items`.
   */
  pickDistinct<T>(items: T[], current: T): T;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
}

/** What the reroll changed, in the form the toast prints it. */
export interface VariationSummary {
  vibeName: string;
  scaleRoot: string;
  scaleType: string;
  bpm: number;
  /** The id that was drawn. Unambiguous where two entries share a shape. */
  progressionId: string;
  progressionName: string;
  progressionRoman: string;
  rhythmName: string;
  bassPatternName: string;
  /** The grid the dice landed on. Unambiguous where two grids share a name. */
  drumGridId: string;
  /** Its display name — what to look for in the sequencer's grid menu. */
  drumGridName: string;
}

/**
 * `items` minus `current` — the candidate pool every `VibeDraw.pickDistinct`
 * implementation chooses from once it has excluded the current value.
 */
export function eligibleFor<T>(items: T[], current: T): T[] {
  return items.filter((item) => item !== current);
}

/**
 * Rerolls a vibe into a different piece of music from its own pools.
 *
 * Takes a VibeSpec and returns a VibeSpec: a reroll is an ID-LEVEL operation,
 * so the caller resolves the result through `resolveVibe` exactly as a chip
 * click does, and applies it through the same `applyVibeToStore`. There is
 * deliberately no second resolve path and no second apply path — the first
 * kept a drawn `progressionId` able to disagree with the `chords` beside it,
 * the second is what keeps the hard-stop-on-swap fix from regressing.
 *
 * Starts from the AUTHORED spec every time — never from the current store — so
 * rerolls never compound, and overwrites exactly six fields: scaleRoot, bpm,
 * chordRhythmId, bassPatternId, progressionId and drumGridId. `scaleType` is
 * copied, never drawn: it is the genre anchor. The drawn key is written to the
 * spec, which is what makes `resolveVibe` resolve the progression into it.
 *
 * Draw order is part of the contract, because a scripted draw depends on it:
 * scaleRoot, bpm, chordRhythmId, bassPatternId, progression, drumGrid.
 */
export function resolveVibeVariation(
  vibe: VibeSpec,
  current: { scaleRoot: string; chordRhythmId: string; bassPatternId: string },
  draw: VibeDraw,
): { spec: VibeSpec; summary: VariationSummary } {
  const rule = vibe.random;
  if (!rule) {
    throw new Error(`Vibe "${vibe.id}" has no random rule and cannot be rerolled`);
  }

  const scaleRoot = draw.pickDistinct(rule.keys, current.scaleRoot);
  const bpm = draw.int(rule.bpm[0], rule.bpm[1]);
  const chordRhythmId = draw.pickDistinct(rule.chordRhythms, current.chordRhythmId);
  const bassPatternId = draw.pickDistinct(rule.bassPatterns, current.bassPatternId);

  const progressionId = draw.pick(rule.progressions);

  // PLAIN pick, following progressions one line above — not pickDistinct like
  // keys/chordRhythms/bassPatterns. Those three have a `current` to exclude;
  // the playing grid id is not in the store at all (SequencerView holds it in a
  // useState and applyVibeToStore never writes it). Manufacturing one would
  // mean a second source of truth that two callers must remember to write, and
  // the failure is SILENT: miss a writer and pickDistinct excludes the wrong
  // id, leaving "the dice can land back on the vibe as authored" true in the
  // test and false in the app. The cost is that two rolls in a row can repeat a
  // grid, at the same odds the progression axis already accepts.
  const drumGridId = draw.pick(rule.drumGrids);

  // Display lookups only — an id that resolves to nothing falls back to the id
  // itself, the way the rhythm and bass names below already do, because the
  // caller's `resolveVibe` is the one place an unknown id is an error. A second
  // throw site here would report the same fault in a second message format.
  const progression = progressionById(progressionId);

  return {
    spec: {
      ...vibe,
      scaleRoot,
      bpm,
      chordRhythmId,
      bassPatternId,
      progressionId,
      drumGridId,
    },
    summary: {
      vibeName: vibe.name,
      scaleRoot,
      scaleType: vibe.scaleType,
      bpm,
      progressionId,
      progressionName: progression?.name ?? progressionId,
      progressionRoman: progression?.roman ?? progressionId,
      rhythmName: CHORD_RHYTHMS.find((p) => p.id === chordRhythmId)?.name ?? chordRhythmId,
      bassPatternName: BASS_PATTERNS.find((p) => p.id === bassPatternId)?.name ?? bassPatternId,
      drumGridId,
      // The table directly, not drumGridById: that helper deep-copies every row
      // on the way out, and the toast wants one string.
      drumGridName: DRUM_GRIDS[drumGridId]?.name ?? drumGridId,
    },
  };
}

/** The two lines of the reroll toast, kept apart so the UI can hide one. */
export interface RerollToast {
  headline: string;
  detail: string;
}

/**
 * Pure, so the exact strings are testable without a DOM — the repo has no
 * testing-library setup and this is the convention every other component
 * helper follows.
 */
export function formatVariationSummary(summary: VariationSummary): RerollToast {
  return {
    headline: `🎲 ${summary.vibeName} — ${summary.scaleRoot} ${summary.scaleType} · ${summary.bpm} BPM`,
    detail: [
      summary.progressionRoman,
      summary.rhythmName,
      summary.bassPatternName,
      // The grid's display name, not a layer/density list. Shorter AND more
      // useful: a listener who hears the drums change can now be told what to
      // look for in the sequencer's grid menu. There is no `drums: bare` case
      // any more — a reroll always lands on a grid.
      `drums: ${summary.drumGridName}`,
    ].join(' · '),
  };
}

export function createDraw(random: () => number): VibeDraw {
  const pick = <T,>(items: T[]): T => {
    if (items.length === 0) {
      throw new Error('VibeDraw.pick: empty pool');
    }
    // Math.min guards the random() === 1 edge some RNGs allow.
    const index = Math.min(items.length - 1, Math.floor(random() * items.length));
    return items[index];
  };

  return {
    pick,
    pickDistinct: <T,>(items: T[], current: T): T => {
      const eligible = eligibleFor(items, current);
      return eligible.length === 0 ? current : pick(eligible);
    },
    int: (min: number, max: number): number =>
      min + Math.min(max - min, Math.floor(random() * (max - min + 1))),
  };
}

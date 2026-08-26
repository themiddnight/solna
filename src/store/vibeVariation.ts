import type { DecorationLayer, DensityName, DrumDecorationRule, InstantVibe } from '../types';
import { progressionById, resolveProgression } from '../audio/data/chordProgressions';
import { BASS_PATTERNS } from '../audio/bassPatterns';
import { RHYTHM_PATTERNS } from '../audio/rhythmPatterns';

/**
 * One bar of sixteenths, step 0 = beat 1. Every row is either a regular
 * subdivision of the bar or a fixed one-bar figure in a genre's idiom. None is
 * generated: a per-step coin flip produces rows with no relationship to the
 * pulse, which is exactly what this catalogue exists to prevent.
 */
export const DRUM_DENSITIES: Record<DensityName, number[]> = {
  off:          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  downbeat:     [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  halves:       [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  backbeat:     [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  quarters:     [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  offbeat8ths:  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  and2and4:     [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  eighths:      [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  // Verified byte-for-byte against hiphop-groove's authored hihat row.
  swung16ths:   [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
  // Verified byte-for-byte against lofi-chill's authored hihat row.
  lofi16ths:    [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
  sixteenths:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  pickup:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  midBar:       [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  lateFill:     [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
  fillTail:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
};

/**
 * The order layers are drawn in and printed in. Fixed so a scripted draw can
 * name an exact combination and the toast reads the same way every time.
 */
export const DECORATION_ORDER: DecorationLayer[] = ['hihat', 'openhat', 'tom', 'crash'];

/** Short names for the toast's drum segment. */
export const LAYER_LABELS: Record<DecorationLayer, string> = {
  hihat: 'hats',
  openhat: 'open',
  tom: 'tom',
  crash: 'crash',
};

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
  drums: Array<{ layer: DecorationLayer; density: DensityName }>;
}

/**
 * Layers whose candidates are filtered against the authored kick. An open
 * hi-hat's decay smears the kick's attack and a tom occupies the kick's
 * register, so neither may double it. `hihat` and `crash` are deliberately
 * exempt: closed hats are short and quiet and routinely double the kick, and a
 * crash on a kick downbeat is the standard accent, not a clash.
 */
const COLLISION_FILTERED: DecorationLayer[] = ['openhat', 'tom'];

function collidesWithKick(row: number[], kick: number[]): boolean {
  return row.some((hit, i) => hit === 1 && kick[i] === 1);
}

/**
 * The candidates a layer may actually be drawn from. Can never return an empty
 * list for a well-authored vibe: `off` is a member of every filtered pool and
 * collides with nothing. An invariant test pins that for all six vibes.
 */
export function eligibleDensities(
  layer: DecorationLayer,
  candidates: DensityName[],
  kick: number[],
): DensityName[] {
  if (!COLLISION_FILTERED.includes(layer)) return candidates;
  return candidates.filter((name) => !collidesWithKick(DRUM_DENSITIES[name], kick));
}

function rollDecoration(
  authored: Record<string, number[]>,
  rule: DrumDecorationRule,
  draw: VibeDraw,
): { drumPattern: Record<string, number[]>; drums: VariationSummary['drums'] } {
  const drumPattern: Record<string, number[]> = { ...authored };
  const drums: VariationSummary['drums'] = [];
  const kick = authored.kick ?? [];

  for (const layer of DECORATION_ORDER) {
    if (!rule.layers.includes(layer)) continue;
    const candidates = rule.densities[layer];
    if (!candidates || candidates.length === 0) {
      throw new Error(`DrumDecorationRule: layer "${layer}" is listed with no densities`);
    }
    const eligible = eligibleDensities(layer, candidates, kick);
    if (eligible.length === 0) {
      throw new Error(`DrumDecorationRule: every "${layer}" candidate collides with the kick`);
    }
    const density = draw.pick(eligible);
    // Copy: the catalogue row is shared module state and must not be aliased
    // into a vibe that later flows into the store.
    drumPattern[layer] = [...DRUM_DENSITIES[density]];
    drums.push({ layer, density });
  }

  return { drumPattern, drums };
}

/**
 * Rerolls a vibe into a different piece of music in the same genre.
 *
 * Starts from the AUTHORED vibe every time — never from the current store — so
 * rerolls never compound, and overwrites exactly six fields: scaleRoot, bpm,
 * chordRhythmId, bassPatternId, chords and the decoration rows of drumPattern.
 * `scaleType` is copied, never drawn: it is the genre anchor.
 *
 * Draw order is part of the contract, because a scripted draw depends on it:
 * scaleRoot, bpm, chordRhythmId, bassPatternId, progression, then the layers
 * of DECORATION_ORDER that the rule lists.
 *
 * The returned value is a whole InstantVibe, so the caller applies it through
 * the existing applyInstantVibeToStore. There is deliberately no second apply
 * path: that is what keeps the hard-stop-on-swap fix from regressing.
 */
export function resolveVibeVariation(
  vibe: InstantVibe,
  current: { scaleRoot: string; chordRhythmId: string; bassPatternId: string },
  draw: VibeDraw,
): { vibe: InstantVibe; summary: VariationSummary } {
  const rule = vibe.variation;
  if (!rule) {
    throw new Error(`Vibe "${vibe.id}" has no variation rule and cannot be rerolled`);
  }

  const scaleRoot = draw.pickDistinct(rule.keyPool, current.scaleRoot);
  const bpm = draw.int(rule.bpmRange[0], rule.bpmRange[1]);
  const chordRhythmId = draw.pickDistinct(rule.rhythmIds, current.chordRhythmId);
  const bassPatternId = draw.pickDistinct(rule.bassPatternIds, current.bassPatternId);

  const progressionId = draw.pick(rule.progressionIds);
  const progression = progressionById(progressionId);
  if (!progression) {
    throw new Error(`Vibe "${vibe.id}" lists unknown progression "${progressionId}"`);
  }
  // Resolved from degrees straight into the drawn key. B2 never transposes, so
  // it cannot hit the auto-harmonize collapse bug at all.
  const chords = resolveProgression(progression, scaleRoot, vibe.scaleType, vibe.chordOctave);

  const { drumPattern, drums } = rollDecoration(vibe.drumPattern, rule.drumDecoration, draw);

  return {
    vibe: { ...vibe, scaleRoot, bpm, chordRhythmId, bassPatternId, chords, drumPattern },
    summary: {
      vibeName: vibe.name,
      scaleRoot,
      scaleType: vibe.scaleType,
      bpm,
      progressionId: progression.id,
      progressionName: progression.name,
      progressionRoman: progression.roman,
      rhythmName: RHYTHM_PATTERNS.find((p) => p.id === chordRhythmId)?.name ?? chordRhythmId,
      bassPatternName: BASS_PATTERNS.find((p) => p.id === bassPatternId)?.name ?? bassPatternId,
      drums,
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
  const active = summary.drums.filter((d) => d.density !== 'off');
  const drumSegment =
    active.length === 0
      ? 'drums: bare'
      : `drums: ${active.map((d) => `${LAYER_LABELS[d.layer]} ${d.density}`).join(', ')}`;

  return {
    headline: `🎲 ${summary.vibeName} — ${summary.scaleRoot} ${summary.scaleType} · ${summary.bpm} BPM`,
    detail: [
      summary.progressionRoman,
      summary.rhythmName,
      summary.bassPatternName,
      drumSegment,
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
      const eligible = items.filter((item) => item !== current);
      return eligible.length === 0 ? current : pick(eligible);
    },
    int: (min: number, max: number): number =>
      min + Math.min(max - min, Math.floor(random() * (max - min + 1))),
  };
}

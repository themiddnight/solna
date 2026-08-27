import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES } from './instantVibes';
import {
  createDraw,
  DECORATION_ORDER,
  DRUM_DENSITIES,
  DRUM_DENSITY_METER,
  densityRowFor,
  LAYER_LABELS,
} from './vibeVariation';
import { getMeter } from '../utils/meter';
import type { DensityName } from '../types';
import { firstDraw, lastDraw, scriptedDraw } from './vibeVariationFixtures';

function vibe(id: string) {
  const found = INSTANT_VIBES.find((v) => v.id === id);
  if (!found) throw new Error(`no vibe ${id}`);
  return found;
}

describe('DRUM_DENSITIES', () => {
  test('every row is one bar of sixteenths and holds only 0 or 1', () => {
    for (const [name, row] of Object.entries(DRUM_DENSITIES)) {
      expect(row.length).toBe(16);
      for (const step of row) {
        expect(step === 0 || step === 1).toBe(true);
      }
      // guards against a row authored as a nested array by mistake
      expect(Array.isArray(row[0])).toBe(false);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test('`off` is silent — it is the fallback that keeps a filtered pool non-empty', () => {
    expect(DRUM_DENSITIES.off.some((s) => s === 1)).toBe(false);
  });

  // Spec invariant 6b. Read from INSTANT_VIBES rather than a copied literal so
  // an edit to either side fails: if these two drift, the reroll toast names a
  // pattern the user is not hearing.
  test('the two genre-named rows equal the authored hats they are named after', () => {
    expect(DRUM_DENSITIES.lofi16ths).toEqual(vibe('lofi-chill').drumPattern.hihat);
    expect(DRUM_DENSITIES.swung16ths).toEqual(vibe('hiphop-groove').drumPattern.hihat);
  });
});

describe('decoration layer metadata', () => {
  test('the draw order is fixed and covers exactly the four decoration layers', () => {
    expect(DECORATION_ORDER).toEqual(['hihat', 'openhat', 'tom', 'crash']);
  });

  test('every layer has a toast label', () => {
    expect(DECORATION_ORDER.map((l) => LAYER_LABELS[l])).toEqual(['hats', 'open', 'tom', 'crash']);
  });
});

describe('createDraw', () => {
  // Three exact cases, not statistics: the bottom of the range, the middle,
  // and the value just under 1 that a naive `* length` would round past the end.
  const stub = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  test('pick maps [0, 1) onto the whole index range', () => {
    expect(createDraw(stub([0])).pick(['a', 'b', 'c'])).toBe('a');
    expect(createDraw(stub([0.5])).pick(['a', 'b', 'c'])).toBe('b');
    expect(createDraw(stub([0.999999])).pick(['a', 'b', 'c'])).toBe('c');
  });

  test('pick throws on an empty list — an empty pool is an authoring bug', () => {
    expect(() => createDraw(stub([0])).pick([])).toThrow();
  });

  test('int is inclusive at both ends', () => {
    expect(createDraw(stub([0])).int(126, 130)).toBe(126);
    expect(createDraw(stub([0.5])).int(126, 130)).toBe(128);
    expect(createDraw(stub([0.999999])).int(126, 130)).toBe(130);
  });

  test('int returns min when min equals max', () => {
    expect(createDraw(stub([0.999999])).int(84, 84)).toBe(84);
  });

  test('pickDistinct never returns current when the pool has two or more members', () => {
    for (const r of [0, 0.34, 0.5, 0.999999]) {
      expect(createDraw(stub([r])).pickDistinct(['a', 'b', 'c'], 'b')).not.toBe('b');
    }
  });

  test('pickDistinct falls back to current only when it is the sole member', () => {
    expect(createDraw(stub([0])).pickDistinct(['a'], 'a')).toBe('a');
  });

  test('pickDistinct with a current outside the pool is a plain pick', () => {
    expect(createDraw(stub([0])).pickDistinct(['a', 'b'], 'z')).toBe('a');
    expect(createDraw(stub([0.999999])).pickDistinct(['a', 'b'], 'z')).toBe('b');
  });
});

describe('draw fixtures', () => {
  test('firstDraw takes the first eligible item and the bottom of a range', () => {
    expect(firstDraw.pick(['a', 'b', 'c'])).toBe('a');
    expect(firstDraw.pickDistinct(['a', 'b', 'c'], 'a')).toBe('b');
    expect(firstDraw.int(70, 90)).toBe(70);
  });

  test('lastDraw takes the last eligible item and the top of a range', () => {
    expect(lastDraw.pick(['a', 'b', 'c'])).toBe('c');
    expect(lastDraw.pickDistinct(['a', 'b', 'c'], 'c')).toBe('b');
    expect(lastDraw.int(70, 90)).toBe(90);
  });

  test('scriptedDraw consumes one index per call, in call order', () => {
    const d = scriptedDraw([2, 0, 1]);
    expect(d.pick(['a', 'b', 'c'])).toBe('c');
    expect(d.pick(['a', 'b', 'c'])).toBe('a');
    expect(d.pick(['a', 'b', 'c'])).toBe('b');
  });

  test('scriptedDraw indexes the eligible list, so pickDistinct skips current', () => {
    // eligible for current 'b' is ['a', 'c']; index 1 is therefore 'c'
    expect(scriptedDraw([1]).pickDistinct(['a', 'b', 'c'], 'b')).toBe('c');
  });

  test('scriptedDraw int walks the range from min', () => {
    expect(scriptedDraw([3]).int(80, 90)).toBe(83);
  });

  test('scriptedDraw throws when the script runs out — a silent wrap would hide a draw-order change', () => {
    const d = scriptedDraw([0]);
    d.pick(['a']);
    expect(() => d.pick(['a'])).toThrow();
  });
});

import { BASS_PATTERNS } from '../audio/bassPatterns';
import { RHYTHM_PATTERNS } from '../audio/rhythmPatterns';
import { CHORD_PROGRESSIONS, VIBE_GENRE_SCALES } from '../audio/data/chordProgressions';
import { ROOTS, SCALES } from '../utils/musicTheory';
import type { DecorationLayer } from '../types';

const COLLISION_FILTERED: DecorationLayer[] = ['openhat', 'tom'];

function scaleLength(scaleType: string): number {
  return SCALES[scaleType]?.intervals.length ?? 7;
}

describe('authored variation data', () => {
  test('every vibe ships a variation rule', () => {
    for (const v of INSTANT_VIBES) {
      expect(v.variation).toBeDefined();
    }
  });

  test('the dice can always land back on the vibe as authored', () => {
    for (const v of INSTANT_VIBES) {
      const r = v.variation!;
      expect(r.keyPool).toContain(v.scaleRoot);
      expect(r.bpmRange[0]).toBeLessThanOrEqual(r.bpmRange[1]);
      expect(v.bpm).toBeGreaterThanOrEqual(r.bpmRange[0]);
      expect(v.bpm).toBeLessThanOrEqual(r.bpmRange[1]);
      expect(r.rhythmIds).toContain(v.chordRhythmId);
      expect(r.bassPatternIds).toContain(v.bassPatternId);
    }
  });

  test('every id in every pool resolves', () => {
    for (const v of INSTANT_VIBES) {
      const r = v.variation!;
      for (const root of r.keyPool) expect(ROOTS).toContain(root);
      for (const id of r.rhythmIds) {
        expect(RHYTHM_PATTERNS.some((p) => p.id === id)).toBe(true);
      }
      for (const id of r.bassPatternIds) {
        expect(BASS_PATTERNS.some((p) => p.id === id)).toBe(true);
      }
      for (const id of r.progressionIds) {
        const p = CHORD_PROGRESSIONS.find((c) => c.id === id);
        expect(p).toBeDefined();
        expect(p!.genres).toContain(r.genre);
        expect(p!.minScaleLength).toBeLessThanOrEqual(scaleLength(v.scaleType));
      }
    }
  });

  test('every pool is non-empty and free of duplicates', () => {
    for (const v of INSTANT_VIBES) {
      const r = v.variation!;
      const pools = [r.keyPool, r.rhythmIds, r.bassPatternIds, r.progressionIds];
      for (const pool of pools) {
        expect(pool.length).toBeGreaterThan(0);
        expect(new Set(pool).size).toBe(pool.length);
      }
    }
  });

  test('the vibe genre and its scale type agree with B1 VIBE_GENRE_SCALES', () => {
    for (const v of INSTANT_VIBES) {
      expect(v.scaleType).toBe(VIBE_GENRE_SCALES[v.variation!.genre]);
    }
  });

  // This is what catches drift when B1 adds or retags a progression: the field
  // is data, but its value is the output of a rule, so the rule is recomputed.
  test('progressionIds equals the full genre-and-scale-length filter', () => {
    for (const v of INSTANT_VIBES) {
      const r = v.variation!;
      const expected = CHORD_PROGRESSIONS.filter(
        (p) => p.genres.includes(r.genre) && p.minScaleLength <= scaleLength(v.scaleType),
      ).map((p) => p.id);
      expect([...r.progressionIds].sort()).toEqual([...expected].sort());
      expect(r.progressionIds.length).toBeGreaterThanOrEqual(4);
    }
  });

  test('densities has an entry for every layer in layers and no others', () => {
    for (const v of INSTANT_VIBES) {
      const { layers, densities } = v.variation!.drumDecoration;
      expect([...Object.keys(densities)].sort()).toEqual([...layers].sort());
      for (const layer of layers) {
        const pool = densities[layer]!;
        expect(pool.length).toBeGreaterThan(0);
        expect(new Set(pool).size).toBe(pool.length);
        for (const name of pool) expect(DRUM_DENSITIES[name]).toBeDefined();
      }
    }
  });

  // Pins the relationship applyInstantVibeToStore relies on implicitly:
  // re-clicking a chip restores the authored pattern only because every vibe
  // declares all seven drum rows, so a reroll's merge (which only overwrites
  // the decoration layers it draws) never leaves a stale row behind.
  test('every layer the variation can draw is a key of that vibe\'s authored drumPattern', () => {
    for (const v of INSTANT_VIBES) {
      const { layers } = v.variation!.drumDecoration;
      const patternKeys = Object.keys(v.drumPattern);
      for (const layer of layers) {
        expect(patternKeys).toContain(layer);
      }
    }
  });

  test('after the kick-collision filter, openhat and tom still have a candidate', () => {
    for (const v of INSTANT_VIBES) {
      const { layers, densities } = v.variation!.drumDecoration;
      const kick = v.drumPattern.kick;
      const stepsPerBar = getMeter(v.meter).stepsPerBar;
      for (const layer of layers) {
        if (!COLLISION_FILTERED.includes(layer)) continue;
        const survivors = eligibleDensities(layer, densities[layer]!, kick, stepsPerBar);
        expect(survivors.length, `${v.id}/${layer}`).toBeGreaterThan(0);
      }
    }
  });

  // Pins the one measured cost of the collision filter, so a later kick edit
  // that quietly empties more of the pool shows up as a failing count.
  test('the filter removes exactly one candidate across all authored data', () => {
    let removed = 0;
    for (const v of INSTANT_VIBES) {
      const { layers, densities } = v.variation!.drumDecoration;
      const kick = v.drumPattern.kick;
      const stepsPerBar = getMeter(v.meter).stepsPerBar;
      for (const layer of layers) {
        if (!COLLISION_FILTERED.includes(layer)) continue;
        removed +=
          densities[layer]!.length -
          eligibleDensities(layer, densities[layer]!, kick, stepsPerBar).length;
      }
    }
    // hiphop-groove's kick hits step 6, which is `and2and4`'s first hit.
    expect(removed).toBe(1);
  });

  test('no vibe lists a candidate that is silent in that vibe\'s own meter', () => {
    // `off` is the deliberate silent member of every pool. Any OTHER candidate
    // that adapts to an all-zero row is a duplicate of `off` — the pool looks
    // bigger than it is and the dice has fewer real outcomes than authored.
    for (const v of INSTANT_VIBES) {
      const stepsPerBar = getMeter(v.meter).stepsPerBar;
      for (const [layer, candidates] of Object.entries(v.variation!.drumDecoration.densities)) {
        for (const name of candidates as DensityName[]) {
          if (name === 'off') continue;
          const sounds = densityRowFor(name, stepsPerBar).some((s) => s === 1);
          expect(sounds, `${v.id}/${layer}/${name} is silent in ${v.meter}`).toBe(true);
        }
      }
    }
  });
});

import { eligibleDensities, resolveVibeVariation } from './vibeVariation';
import { getScaleNotes } from '../utils/musicTheory';
import { progressionById } from '../audio/data/chordProgressions';

function authoredCurrent(v: (typeof INSTANT_VIBES)[number]) {
  return {
    scaleRoot: v.scaleRoot,
    chordRhythmId: v.chordRhythmId,
    bassPatternId: v.bassPatternId,
  };
}

/**
 * Every combination the resolver can produce for one vibe, by exhaustive
 * enumeration — every pool is a small finite list, so no sampling is needed.
 * Memoised: seven tests iterate the same product and recomputing it each time
 * would run resolveProgression tens of thousands of times for no extra cover.
 */
const drawCache = new Map<string, ReturnType<typeof resolveVibeVariation>[]>();

function allDraws(v: (typeof INSTANT_VIBES)[number]) {
  const cached = drawCache.get(v.id);
  if (cached) return cached;
  const r = v.variation!;
  const cur = authoredCurrent(v);
  const keys = r.keyPool.filter((k) => k !== cur.scaleRoot);
  const rhythms = r.rhythmIds.filter((k) => k !== cur.chordRhythmId);
  const basses = r.bassPatternIds.filter((k) => k !== cur.bassPatternId);
  const out: ReturnType<typeof resolveVibeVariation>[] = [];
  for (let ki = 0; ki < keys.length; ki++) {
    for (let bi = 0; bi < r.bpmRange[1] - r.bpmRange[0] + 1; bi++) {
      for (let ri = 0; ri < rhythms.length; ri++) {
        for (let si = 0; si < basses.length; si++) {
          for (let pi = 0; pi < r.progressionIds.length; pi++) {
            const drumIdx = DECORATION_ORDER.filter((l) =>
              r.drumDecoration.layers.includes(l),
            ).map(() => 0);
            out.push(
              resolveVibeVariation(v, cur, scriptedDraw([ki, bi, ri, si, pi, ...drumIdx])),
            );
          }
        }
      }
    }
  }
  drawCache.set(v.id, out);
  return out;
}

describe('eligibleDensities', () => {
  test('openhat and tom drop every candidate that doubles a kick step', () => {
    const kick = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]; // hiphop-groove
    expect(eligibleDensities('openhat', ['off', 'pickup', 'and2and4'], kick, 16)).toEqual([
      'off',
      'pickup',
    ]);
    expect(eligibleDensities('tom', ['off', 'midBar'], kick, 16)).toEqual(['off']);
  });

  test('hihat and crash are exempt — closed hats double the kick by design', () => {
    const kick = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]; // lofi-chill
    expect(eligibleDensities('hihat', ['lofi16ths', 'eighths', 'swung16ths'], kick, 16)).toEqual([
      'lofi16ths',
      'eighths',
      'swung16ths',
    ]);
    expect(eligibleDensities('crash', ['off', 'downbeat'], kick, 16)).toEqual(['off', 'downbeat']);
  });
});

describe('resolveVibeVariation', () => {
  test('genre identity is copied verbatim under every draw', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out } of allDraws(v)) {
        expect(out.scaleType).toBe(v.scaleType);
        expect(out.id).toBe(v.id);
        expect(out.name).toBe(v.name);
        expect(out.emoji).toBe(v.emoji);
        expect(out.tagline).toBe(v.tagline);
        expect(out.chordOctave).toBe(v.chordOctave);
        expect(out.bassOctave).toBe(v.bassOctave);
        expect(out.chordFeel).toBe(v.chordFeel);
        expect(out.bassFeel).toBe(v.bassFeel);
        expect(out.soundKit).toBe(v.soundKit);
        expect(out.synthPresetId).toBe(v.synthPresetId);
        expect(out.chordPresetId).toBe(v.chordPresetId);
        expect(out.bassPresetId).toBe(v.bassPresetId);
        expect(out.effects).toEqual(v.effects);
      }
    }
  });

  test('the drum skeleton is never rerolled', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out } of allDraws(v)) {
        expect(out.drumPattern.kick).toEqual(v.drumPattern.kick);
        expect(out.drumPattern.snare).toEqual(v.drumPattern.snare);
        if (v.drumPattern.clap) expect(out.drumPattern.clap).toEqual(v.drumPattern.clap);
      }
    }
  });

  test('no drawn openhat or tom row shares a step with the authored kick', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out } of allDraws(v)) {
        for (const layer of ['openhat', 'tom'] as const) {
          if (!v.variation!.drumDecoration.layers.includes(layer)) continue;
          const row = out.drumPattern[layer];
          for (let i = 0; i < 16; i++) {
            expect(row[i] === 1 && v.drumPattern.kick[i] === 1).toBe(false);
          }
        }
      }
    }
  });

  // The test above ("no drawn openhat or tom row shares a step with the
  // authored kick") is a tautology against `allDraws`: every drum-layer index
  // in that fixture is scripted to 0, and every vibe's openhat/tom pool
  // begins with `off`, so it only ever inspects an all-zero row. This test
  // fails if `eligibleDensities`'s filtering is bypassed: hiphop-groove's
  // openhat pool is `['off', 'pickup', 'and2and4']` (3 candidates), but the
  // kick hits step 6 — exactly where `and2and4` hits — so the collision
  // filter narrows it to `['off', 'pickup']` (2 candidates) before the draw.
  // A script that requests index 2 is therefore out of range only because the
  // filter ran; with the filter bypassed, index 2 would resolve to
  // 'and2and4' and this would not throw.
  test('the collision filter actually narrows the pool — a script requesting the collision-only index throws', () => {
    const groove = vibe('hiphop-groove');
    expect(() =>
      resolveVibeVariation(
        groove,
        authoredCurrent(groove),
        // scaleRoot, bpm, chordRhythmId, bassPatternId, progressionId, hihat, openhat, tom, crash
        scriptedDraw([0, 0, 0, 0, 0, 0, 2, 0, 0]),
      ),
    ).toThrow('index 2 out of range for 2 candidates');
  });

  test('key, comp rhythm and bass pattern always move off the current value', () => {
    for (const v of INSTANT_VIBES) {
      const cur = authoredCurrent(v);
      for (const { vibe: out } of allDraws(v)) {
        expect(out.scaleRoot).not.toBe(cur.scaleRoot);
        expect(out.chordRhythmId).not.toBe(cur.chordRhythmId);
        expect(out.bassPatternId).not.toBe(cur.bassPatternId);
      }
    }
  });

  test('bpm stays inside the range', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out } of allDraws(v)) {
        expect(out.bpm).toBeGreaterThanOrEqual(v.variation!.bpmRange[0]);
        expect(out.bpm).toBeLessThanOrEqual(v.variation!.bpmRange[1]);
      }
    }
  });

  test('chords are resolved in the drawn key and never collapse', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out, summary } of allDraws(v)) {
        const scaleNotes = getScaleNotes(out.scaleRoot, v.scaleType);
        for (const chord of out.chords) {
          expect(scaleNotes).toContain(chord.root);
          expect(chord.notes.length).toBeGreaterThan(0);
        }
        const source = progressionById(summary.progressionId)!;
        expect(out.chords.length).toBe(source.steps.length);
        expect(new Set(out.chords.map((c) => c.id)).size).toBe(out.chords.length);
      }
    }
  });

  test('the summary reports what was actually written', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out, summary } of allDraws(v)) {
        expect(summary.vibeName).toBe(v.name);
        expect(summary.scaleRoot).toBe(out.scaleRoot);
        expect(summary.scaleType).toBe(out.scaleType);
        expect(summary.bpm).toBe(out.bpm);
        expect(summary.rhythmName).toBe(
          RHYTHM_PATTERNS.find((p) => p.id === out.chordRhythmId)!.name,
        );
        expect(summary.bassPatternName).toBe(
          BASS_PATTERNS.find((p) => p.id === out.bassPatternId)!.name,
        );
        const stepsPerBar = getMeter(v.meter).stepsPerBar;
        for (const { layer, density } of summary.drums) {
          // Independent of densityRowFor: restates the trim/loop rule inline
          // against the DRUM_DENSITIES catalogue constant, rather than calling
          // the production helper that produced `out.drumPattern[layer]` in
          // the first place — a self-referential comparison would pass no
          // matter what densityRowFor computed.
          const source = DRUM_DENSITIES[density];
          const expected = Array.from({ length: stepsPerBar }, (_, i) => source[i % source.length]);
          expect(out.drumPattern[layer]).toEqual(expected);
        }
        expect(summary.drums.map((d) => d.layer)).toEqual(
          DECORATION_ORDER.filter((l) => v.variation!.drumDecoration.layers.includes(l)),
        );
      }
    }
  });

  test('a scripted draw produces one exact, nameable vibe', () => {
    const lofi = INSTANT_VIBES.find((v) => v.id === 'lofi-chill')!;
    const r = lofi.variation!;
    // eligible keys exclude 'C': ['D','D#','F','G','A'] -> index 2 is 'F'
    // bpm offset 3 from 78 -> 81
    // eligible rhythms exclude 'lofiSwing': ['syncopatedPush','bassPlusStrum'] -> 0
    // eligible basses exclude 'dilla-sub': ['walking-groove','half-time-legato'] -> 0
    // progression index 0; then hihat/openhat/tom/crash all index 0
    const { vibe: out, summary } = resolveVibeVariation(
      lofi,
      authoredCurrent(lofi),
      scriptedDraw([2, 3, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(out.scaleRoot).toBe('F');
    expect(out.bpm).toBe(81);
    expect(out.chordRhythmId).toBe('syncopatedPush');
    expect(out.bassPatternId).toBe('walking-groove');
    expect(summary.progressionName).toBe(progressionById(r.progressionIds[0])!.name);
    expect(summary.progressionRoman).toBe(progressionById(r.progressionIds[0])!.roman);
    expect(out.drumPattern.hihat).toEqual(DRUM_DENSITIES.lofi16ths);
    expect(out.drumPattern.openhat).toEqual(DRUM_DENSITIES.off);
    expect(out.drumPattern.tom).toEqual(DRUM_DENSITIES.off);
    expect(out.drumPattern.crash).toEqual(DRUM_DENSITIES.off);
  });

  test('the catalogue rows are copied, not aliased into the vibe', () => {
    const lofi = INSTANT_VIBES.find((v) => v.id === 'lofi-chill')!;
    const { vibe: out } = resolveVibeVariation(
      lofi,
      authoredCurrent(lofi),
      scriptedDraw([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(out.drumPattern.hihat).not.toBe(DRUM_DENSITIES.lofi16ths);
  });

  test('the returned vibe\'s progressionId always names the progression its chords came from', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out, summary } of allDraws(v)) {
        expect(out.progressionId).toBe(summary.progressionId);
      }
    }
  });

  test('a vibe with no variation rule throws rather than silently doing nothing', () => {
    const bare = { ...INSTANT_VIBES[0], variation: undefined };
    expect(() => resolveVibeVariation(bare, authoredCurrent(bare), firstDraw)).toThrow();
  });
});

import { formatVariationSummary } from './vibeVariation';
import type { VariationSummary } from './vibeVariation';

const BASE: VariationSummary = {
  vibeName: 'Lo-Fi Chill',
  scaleRoot: 'F',
  scaleType: 'Major',
  bpm: 81,
  progressionId: 'lofi-rainy-window',
  progressionName: 'Rainy Window',
  progressionRoman: 'vim9 – IVmaj7 – ii9 – V7',
  rhythmName: 'Syncopated Soul Push',
  bassPatternName: 'Soulful Walking Bass',
  drums: [],
};

describe('formatVariationSummary', () => {
  test('the headline names the vibe, the key and the tempo', () => {
    const { headline } = formatVariationSummary({
      ...BASE,
      drums: [{ layer: 'hihat', density: 'eighths' }],
    });
    expect(headline).toBe('🎲 Lo-Fi Chill — F Major · 81 BPM');
  });

  test('the detail is four dot-joined segments in a fixed order', () => {
    const { detail } = formatVariationSummary({
      ...BASE,
      drums: [
        { layer: 'hihat', density: 'eighths' },
        { layer: 'crash', density: 'downbeat' },
      ],
    });
    expect(detail).toBe(
      'vim9 – IVmaj7 – ii9 – V7 · Syncopated Soul Push · Soulful Walking Bass · ' +
        'drums: hats eighths, crash downbeat',
    );
  });

  test('layers drawn as off are omitted, in DECORATION_ORDER', () => {
    const { detail } = formatVariationSummary({
      ...BASE,
      drums: [
        { layer: 'hihat', density: 'swung16ths' },
        { layer: 'openhat', density: 'off' },
        { layer: 'tom', density: 'fillTail' },
        { layer: 'crash', density: 'off' },
      ],
    });
    expect(detail.endsWith('drums: hats swung16ths, tom fillTail')).toBe(true);
  });

  test('an all-off draw reads `drums: bare` rather than an empty segment', () => {
    const { detail } = formatVariationSummary({
      ...BASE,
      drums: [
        { layer: 'hihat', density: 'off' },
        { layer: 'openhat', density: 'off' },
        { layer: 'tom', density: 'off' },
        { layer: 'crash', density: 'off' },
      ],
    });
    expect(detail).toBe(
      'vim9 – IVmaj7 – ii9 – V7 · Syncopated Soul Push · Soulful Walking Bass · drums: bare',
    );
  });

  test('the roman numeral is printed verbatim, not reformatted', () => {
    const { detail } = formatVariationSummary({ ...BASE, progressionRoman: 'i – VII – VI – VII' });
    expect(detail.startsWith('i – VII – VI – VII · ')).toBe(true);
  });
});

describe('DRUM_DENSITIES is a 4/4 catalogue, adapted to the vibe it decorates', () => {
  test('the catalogue declares the meter its rows were authored in', () => {
    expect(DRUM_DENSITY_METER).toBe('4/4');
    for (const row of Object.values(DRUM_DENSITIES)) {
      expect(row.length).toBe(getMeter(DRUM_DENSITY_METER).stepsPerBar);
    }
  });

  test('densityRowFor is the identity in 4/4 — the byte-identical path', () => {
    for (const name of Object.keys(DRUM_DENSITIES) as DensityName[]) {
      expect(densityRowFor(name, 16)).toEqual(DRUM_DENSITIES[name]);
      // A copy, never the module's own array: a drawn row flows into store state.
      expect(densityRowFor(name, 16)).not.toBe(DRUM_DENSITIES[name]);
    }
  });

  test('densityRowFor trims to a shorter bar and loops into a longer one', () => {
    expect(densityRowFor('quarters', 12)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(densityRowFor('eighths', 12)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
    // downbeat's only hit is step 0 of the 16-step source; adaptStepRow's loop
    // rule is out[i] = source[i % source.length] (pinned by
    // patternAdapt.test.ts's 'wraps once and a half' case), so the repeat lands
    // at step 16 — one full 16-step cycle — not at step 12.
    expect(densityRowFor('downbeat', 24)).toEqual([
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  test('THE TRAP: pickup and fillTail lose every hit in a 12-step bar', () => {
    // Both are authored as end-of-bar figures (steps 14, and 13+15). Trimmed to
    // 12 they are silent, i.e. a duplicate of `off`. A 3/4 or 6/8 vibe that
    // lists either as a candidate has a smaller real pool than it looks.
    expect(densityRowFor('pickup', 12).some((s) => s === 1)).toBe(false);
    expect(densityRowFor('fillTail', 12).some((s) => s === 1)).toBe(false);
    // ...but they are alive in the 16-step bar they were written for.
    expect(densityRowFor('pickup', 16).some((s) => s === 1)).toBe(true);
    expect(densityRowFor('fillTail', 16).some((s) => s === 1)).toBe(true);
  });

  test('eligibleDensities compares the ADAPTED row against the kick', () => {
    // A 3/4 kick on beat one only. `quarters` adapted to 12 hits step 0 too.
    const kick = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(eligibleDensities('tom', ['off', 'quarters', 'midBar'], kick, 12)).toEqual([
      'off',
      'midBar',
    ]);
    // hihat and crash are exempt from the filter and keep every candidate.
    expect(eligibleDensities('hihat', ['off', 'quarters', 'midBar'], kick, 12)).toEqual([
      'off',
      'quarters',
      'midBar',
    ]);
  });

  // The two `stepsPerBar = 12` (or 16) cases above cannot distinguish an
  // adapted comparison from a raw one: collidesWithKick only ever reads
  // indices 0..kick.length-1, so for a TRIM target the discarded tail sits
  // where the kick has nothing to compare against anyway. Only the LOOP
  // direction (stepsPerBar > 16) creates a collision opportunity — at an
  // index the raw 16-length row does not even have — that a bug ignoring
  // stepsPerBar would miss.
  test('eligibleDensities catches a collision that only exists in the LOOPED tail', () => {
    // Kick hits only step 16 — beyond the raw 16-step catalogue, inside the
    // wrapped portion of a 20-step bar.
    const kick = [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0,
    ];
    // quarters = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]; looped to 20, steps
    // 16-19 repeat steps 0-3, so step 16 is a hit -> collides with the kick.
    // midBar's only hit (step 6) loops to step 6 again, never touching 16-19.
    expect(eligibleDensities('tom', ['off', 'quarters', 'midBar'], kick, 20)).toEqual([
      'off',
      'midBar',
    ]);
  });

  test('in 4/4 eligibleDensities returns exactly what it returned before', () => {
    const kick = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]; // boombap-swung-break
    expect(eligibleDensities('openhat', ['off', 'pickup', 'and2and4'], kick, 16)).toEqual([
      'off',
      'pickup',
    ]);
  });
});

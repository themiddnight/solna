import { describe, expect, test } from 'bun:test';
import { VIBES } from '../data/vibes';
import { resolveVibe } from './vibes';
import { createDraw } from './vibeVariation';
import { firstDraw, lastDraw, scriptedDraw } from './vibeVariationFixtures';

/**
 * Every vibe, resolved once. The reroll itself takes and returns a plain
 * VibeSpec; these are the authored SOUND each reroll is compared against —
 * chords, drum rows and effects, none of which exist on a spec.
 */
const RESOLVED_VIBES = VIBES.map(resolveVibe);

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

import { BASS_PATTERNS } from '@/data/bassPatterns';
import { CHORD_RHYTHMS } from '@/data/chordRhythms';
import { CHORD_PROGRESSIONS } from '@/data/chordProgressions';
import { ROOTS } from '../utils/musicTheory';
import { SCALES } from '../data/scales';
import { DRUM_GRIDS } from '@/data/drumGrids';

describe('authored random data', () => {
  test('every vibe ships a random rule', () => {
    for (const v of RESOLVED_VIBES) {
      expect(v.random).toBeDefined();
    }
  });

  test('the dice can always land back on the vibe as authored', () => {
    for (const v of RESOLVED_VIBES) {
      const r = v.random!;
      expect(r.keys).toContain(v.scaleRoot);
      expect(r.bpm[0]).toBeLessThanOrEqual(r.bpm[1]);
      expect(v.bpm).toBeGreaterThanOrEqual(r.bpm[0]);
      expect(v.bpm).toBeLessThanOrEqual(r.bpm[1]);
      expect(r.chordRhythms).toContain(v.chordRhythmId);
      expect(r.bassPatterns).toContain(v.bassPatternId);
      // The axis the derived filter used to cover for free.
      expect(r.progressions).toContain(v.progressionId);
    }
  });

  test('every id in every pool resolves', () => {
    for (const v of RESOLVED_VIBES) {
      const r = v.random!;
      for (const root of r.keys) expect(ROOTS).toContain(root);
      for (const id of r.chordRhythms) {
        expect(CHORD_RHYTHMS.some((p) => p.id === id)).toBe(true);
      }
      for (const id of r.bassPatterns) {
        expect(BASS_PATTERNS.some((p) => p.id === id)).toBe(true);
      }
      for (const id of r.progressions) {
        expect(CHORD_PROGRESSIONS.some((p) => p.id === id), `${v.id}/${id}`).toBe(true);
      }
    }
  });

  // Guard 1, replacing half of the deleted genre filter. The filter dropped a
  // too-long progression SILENTLY; this fails the build. It matters most for
  // zen-garden (Hirajoshi, 5 degrees), where a 7-degree progression would
  // otherwise vanish from the pool with no signal at all.
  test('every pooled progression fits the vibe\'s scale', () => {
    for (const v of RESOLVED_VIBES) {
      const degrees = SCALES[v.scaleType].intervals.length;
      for (const id of v.random!.progressions) {
        const p = CHORD_PROGRESSIONS.find((c) => c.id === id)!;
        expect(p.minScaleLength, `${v.id}/${id}`).toBeLessThanOrEqual(degrees);
      }
    }
  });

  // Guard 2, replacing the other half. This is strictly more direct than
  // the deleted `referenceScale === VIBE_GENRE_SCALES[genre]`: it names the
  // property that actually matters — the progression was authored against
  // the scale the vibe plays — instead of routing it through a genre table.
  test('every pooled progression was authored against the vibe\'s own scale', () => {
    for (const v of RESOLVED_VIBES) {
      for (const id of v.random!.progressions) {
        const p = CHORD_PROGRESSIONS.find((c) => c.id === id)!;
        expect(p.referenceScale, `${v.id}/${id}`).toBe(v.scaleType);
      }
    }
  });

  test('every pool is non-empty and free of duplicates', () => {
    for (const v of RESOLVED_VIBES) {
      const r = v.random!;
      const pools = [r.keys, r.chordRhythms, r.bassPatterns, r.progressions];
      for (const pool of pools) {
        expect(pool.length).toBeGreaterThan(0);
        expect(new Set(pool).size).toBe(pool.length);
      }
    }
  });

  test('the dice can always land back on the vibe as authored — drums included', () => {
    // The sibling assertions for keys, chord rhythms, bass patterns and
    // progressions already exist in the test above. This is the fifth axis
    // joining them, which is the whole point of the change: the drum axis is
    // no longer special.
    for (const v of VIBES) {
      expect(v.random!.drumGrids, v.id).toContain(v.drumGridId);
    }
  });

  test('every id in every drum pool resolves', () => {
    for (const v of VIBES) {
      for (const id of v.random!.drumGrids) {
        expect(DRUM_GRIDS[id], `${v.id} -> ${id}`).toBeDefined();
      }
    }
  });

  test('a pool may cross meters, and four members do — deliberately', () => {
    // NOT an invariant, a record of a taste decision. Trim-or-loop is the
    // project's documented rule for a pattern whose meter differs from the
    // transport's, and the sequencer, chord and bass menus already surface it.
    // Forcing same-meter membership in the dice alone would make the dice
    // stricter than the menu three inches from it.
    //
    // Two of the four differ only in ACCENT GROUPING: 3/4 and 6/8 are both
    // twelve steps, so `waltz` in a 6/8 pool and `afro-6-8` in a 3/4 pool are
    // adapted by nothing at all. The other two are the real trim cases, and
    // both were measured rather than assumed: lofi-ghost-kick lands as
    // kick 0,8 / snare 4 / hihat 0,2,4,6,8,10, and reggae-rockers as
    // kick 0,4,8 / snare 8 / hihat 0,2,4,6,8,10 with its openhat 14 trimmed
    // away entirely. Both are real twelve-step rhythms.
    const crossMeter = VIBES.flatMap((v) =>
      v.random!.drumGrids
        .filter((id) => DRUM_GRIDS[id].meter !== v.meter)
        .map((id) => `${v.id}=${id}`),
    );
    expect(crossMeter.sort()).toEqual([
      'afro-six-eight=reggae-rockers',
      'afro-six-eight=waltz',
      'lofi-waltz=afro-6-8',
      'lofi-waltz=lofi-ghost-kick',
    ]);
  });
});

import { resolveVibeVariation, type VibeDraw } from './vibeVariation';
import type { VibeSpec } from '../data/vibes';
import { getScaleNotes } from '../utils/musicTheory';
import { progressionById } from '@/audio/chordProgressions';

function authoredCurrent(v: VibeSpec) {
  return {
    scaleRoot: v.scaleRoot,
    chordRhythmId: v.chordRhythmId,
    bassPatternId: v.bassPatternId,
  };
}

/**
 * One reroll, end to end — the two steps rerollVibe performs in that order.
 *
 * resolveVibeVariation draws IDS and returns a VibeSpec; resolveVibe is the one
 * place those ids become chords, rows and effects. Assertions about what a
 * reroll SOUNDS like therefore have to run the same pair the app runs, which is
 * the point of the split: there is no second resolver to test against.
 */
function variation(
  v: VibeSpec,
  current: { scaleRoot: string; chordRhythmId: string; bassPatternId: string },
  draw: VibeDraw,
) {
  const { spec, summary } = resolveVibeVariation(v, current, draw);
  return { spec, summary, vibe: resolveVibe(spec) };
}

/**
 * Every combination the resolver can produce for one vibe, by exhaustive
 * enumeration — every pool is a small finite list, so no sampling is needed.
 * Memoised: seven tests iterate the same product and recomputing it each time
 * would run resolveProgression tens of thousands of times for no extra cover.
 */
const drawCache = new Map<string, ReturnType<typeof variation>[]>();

function allDraws(v: (typeof RESOLVED_VIBES)[number]) {
  const cached = drawCache.get(v.id);
  if (cached) return cached;
  const r = v.random!;
  const cur = authoredCurrent(v);
  const keys = r.keys.filter((k) => k !== cur.scaleRoot);
  const rhythms = r.chordRhythms.filter((k) => k !== cur.chordRhythmId);
  const basses = r.bassPatterns.filter((k) => k !== cur.bassPatternId);
  const out: ReturnType<typeof variation>[] = [];
  for (let ki = 0; ki < keys.length; ki++) {
    for (let bi = 0; bi < r.bpm[1] - r.bpm[0] + 1; bi++) {
      for (let ri = 0; ri < rhythms.length; ri++) {
        for (let si = 0; si < basses.length; si++) {
          for (let pi = 0; pi < r.progressions.length; pi++) {
            for (let di = 0; di < r.drumGrids.length; di++) {
              out.push(variation(v, cur, scriptedDraw([ki, bi, ri, si, pi, di])));
            }
          }
        }
      }
    }
  }
  drawCache.set(v.id, out);
  return out;
}

describe('resolveVibeVariation: what a draw preserves', () => {
  test('genre identity is copied verbatim under every draw', () => {
    for (const v of RESOLVED_VIBES) {
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

  test('key, comp rhythm and bass pattern always move off the current value', () => {
    for (const v of RESOLVED_VIBES) {
      const cur = authoredCurrent(v);
      for (const { vibe: out } of allDraws(v)) {
        expect(out.scaleRoot).not.toBe(cur.scaleRoot);
        expect(out.chordRhythmId).not.toBe(cur.chordRhythmId);
        expect(out.bassPatternId).not.toBe(cur.bassPatternId);
      }
    }
  });

  test('bpm stays inside the range', () => {
    for (const v of RESOLVED_VIBES) {
      for (const { vibe: out } of allDraws(v)) {
        expect(out.bpm).toBeGreaterThanOrEqual(v.random!.bpm[0]);
        expect(out.bpm).toBeLessThanOrEqual(v.random!.bpm[1]);
      }
    }
  });

  test('chords are resolved in the drawn key and never collapse', () => {
    for (const v of RESOLVED_VIBES) {
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
    for (const v of RESOLVED_VIBES) {
      for (const { vibe: out, summary } of allDraws(v)) {
        expect(summary.vibeName).toBe(v.name);
        expect(summary.scaleRoot).toBe(out.scaleRoot);
        expect(summary.scaleType).toBe(out.scaleType);
        expect(summary.bpm).toBe(out.bpm);
        expect(summary.rhythmName).toBe(
          CHORD_RHYTHMS.find((p) => p.id === out.chordRhythmId)!.name,
        );
        expect(summary.bassPatternName).toBe(
          BASS_PATTERNS.find((p) => p.id === out.bassPatternId)!.name,
        );
        // Independent of the resolver: reads the library entry the summary
        // names and compares it against the rows that were actually written,
        // rather than comparing the resolver's output with itself.
        expect(summary.drumGridId).toBe(out.drumGridId);
        expect(summary.drumGridName).toBe(DRUM_GRIDS[summary.drumGridId].name);
        expect(out.drumPattern).toEqual(DRUM_GRIDS[summary.drumGridId].rows);
      }
    }
  });

});

describe('resolveVibeVariation: what a draw writes', () => {
  test('a scripted draw produces one exact, nameable vibe', () => {
    const lofi = RESOLVED_VIBES.find((v) => v.id === 'lofi-chill')!;
    const r = lofi.random!;
    // eligible keys exclude 'C': ['D','D#','F','G','A'] -> index 2 is 'F'
    // bpm offset 3 from 78 -> 81
    // eligible rhythms exclude 'lofiSwing': ['syncopatedPush','bassPlusStrum'] -> 0
    // eligible basses exclude 'dilla-sub': ['walking-groove','half-time-legato'] -> 0
    // progression index 0; then one drum-grid index, 0
    const { vibe: out, summary } = variation(
      lofi,
      authoredCurrent(lofi),
      scriptedDraw([2, 3, 0, 0, 0, 0]),
    );
    expect(out.scaleRoot).toBe('F');
    expect(out.bpm).toBe(81);
    expect(out.chordRhythmId).toBe('syncopatedPush');
    expect(out.bassPatternId).toBe('walking-groove');
    expect(summary.progressionName).toBe(progressionById(r.progressions[0])!.name);
    expect(summary.progressionRoman).toBe(progressionById(r.progressions[0])!.roman);
    expect(out.drumGridId).toBe(r.drumGrids[0]);
  });

  test('the drawn grid is what plays, and drumGridId names it', () => {
    const authored = resolveVibe(VIBES.find((v) => v.id === 'lofi-chill')!);
    const { vibe: out, summary } = variation(authored, authoredCurrent(authored), firstDraw);
    // The old contract let drumGridId and drumPattern legitimately disagree.
    // They cannot any more, and this is the test that says so.
    expect(out.drumPattern).toEqual(DRUM_GRIDS[out.drumGridId].rows);
    expect(summary.drumGridId).toBe(out.drumGridId);
    expect(summary.drumGridName).toBe(DRUM_GRIDS[out.drumGridId].name);
  });

  test('the library rows are copied, not aliased into the vibe', () => {
    const authored = resolveVibe(VIBES.find((v) => v.id === 'lofi-chill')!);
    const { vibe: out } = variation(authored, authoredCurrent(authored), firstDraw);
    expect(out.drumPattern.kick).not.toBe(DRUM_GRIDS[out.drumGridId].rows.kick);
  });

  test('the drum axis is a plain pick, so every pool member is reachable', () => {
    // pickDistinct would make this test impossible to write: the vibe's own
    // grid would be permanently excluded. Plain pick means every member is
    // reachable INCLUDING the authored one, which is what makes pool
    // invariant 1 true in the app and not only in the invariant test.
    // scriptedDraw indexes the raw pool, since there is no `current` to skip.
    for (const spec of VIBES) {
      const pool = spec.random!.drumGrids;
      const landed = pool.map((_, di) => {
        const { spec: next } = resolveVibeVariation(
          spec,
          authoredCurrent(spec),
          scriptedDraw([0, 0, 0, 0, 0, di]),
        );
        return next.drumGridId;
      });
      expect(landed, spec.id).toEqual(pool);
    }
  });

  test('the returned vibe\'s progressionId always names the progression its chords came from', () => {
    // Structural now rather than incidental: the reroll writes an id and
    // resolveVibe derives the chords from that same id, so the pair cannot
    // disagree without resolveVibe itself being wrong. It used to be a live
    // risk — the reroll resolved chords of its own and patched them over what
    // resolveVibe had produced.
    for (const v of RESOLVED_VIBES) {
      for (const { vibe: out, summary } of allDraws(v)) {
        expect(out.progressionId).toBe(summary.progressionId);
      }
    }
  });

  test('a reroll returns ids only, and touches exactly the six it draws', () => {
    // The contract that replaces the patched ResolvedVibe: everything outside
    // these six keys is the authored spec, by identity, and no resolved field
    // rides along to disagree with an id beside it.
    const DRAWN = [
      'scaleRoot',
      'bpm',
      'chordRhythmId',
      'bassPatternId',
      'progressionId',
      'drumGridId',
    ];
    for (const spec of VIBES) {
      const { spec: next } = resolveVibeVariation(spec, authoredCurrent(spec), lastDraw);
      expect(Object.keys(next).sort(), spec.id).toEqual(Object.keys(spec).sort());
      for (const key of Object.keys(spec) as (keyof VibeSpec)[]) {
        if (DRAWN.includes(key)) continue;
        expect(next[key], `${spec.id}/${key}`).toBe(spec[key]);
      }
    }
  });

  test('a vibe with no random rule throws rather than silently doing nothing', () => {
    const bare = { ...RESOLVED_VIBES[0], random: undefined };
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
  drumGridId: 'lofi-half-time-brush',
  drumGridName: 'Lo-Fi Half-Time Brush',
};

describe('formatVariationSummary', () => {
  test('the headline names the vibe, the key and the tempo', () => {
    const { headline } = formatVariationSummary(BASE);
    expect(headline).toBe('🎲 Lo-Fi Chill — F Major · 81 BPM');
  });

  // The headline is toast text and nothing else — never stored, never compared
  // — so it spells the key the way the chip beside it does. Left raw, a reroll
  // onto A# read `A# Major` in the toast while the chip under it read `Bb`.
  test('the headline spells the key, like every other rendered key name', () => {
    expect(formatVariationSummary({ ...BASE, scaleRoot: 'A#' }).headline).toContain('— Bb Major ');
    // The same pitch class, written the way each tonality writes it.
    expect(formatVariationSummary({ ...BASE, scaleRoot: 'G#' }).headline).toContain('— Ab Major ');
    expect(formatVariationSummary({ ...BASE, scaleRoot: 'G#', scaleType: 'Natural Minor' }).headline)
      .toContain('— G# Natural Minor ');
  });

  test('the detail is four dot-joined segments in a fixed order', () => {
    const { detail } = formatVariationSummary(BASE);
    expect(detail).toBe(
      'vim9 – IVmaj7 – ii9 – V7 · Syncopated Soul Push · Soulful Walking Bass · ' +
        'drums: Lo-Fi Half-Time Brush',
    );
  });

  test('the drum segment is the grid a listener can find in the menu', () => {
    // It used to read `drums: closed hat swung16ths, open hat pickup`, built
    // from layer labels and density names — accurate and unactionable. A grid
    // name is something you can go and select.
    expect(formatVariationSummary(BASE).detail.split(' · ')[3]).toBe(
      'drums: Lo-Fi Half-Time Brush',
    );
  });

  test('the roman numeral is printed verbatim, not reformatted', () => {
    const { detail } = formatVariationSummary({ ...BASE, progressionRoman: 'i – VII – VI – VII' });
    expect(detail.startsWith('i – VII – VI – VII · ')).toBe(true);
  });
});

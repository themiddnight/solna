import { describe, expect, test } from 'bun:test';
import { Chord } from 'tonal';
import { CHORD_PROGRESSIONS } from '@/data/chordProgressions';
import { progressionById, resolveProgression } from './chordProgressions';
import { SCALES } from '@/data/scales';
import { degreeToRoman, getDiatonicChordForDegree, TONAL_CHORD_ALIASES } from '../utils/musicTheory';
import { resolveScaleKey, scaleEntry, type ChordQuality } from '@/musicCore';

describe('CHORD_PROGRESSIONS structure', () => {
  test('ids are unique and non-empty, and every entry has steps', () => {
    const ids = CHORD_PROGRESSIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CHORD_PROGRESSIONS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.steps.length).toBeGreaterThan(0);
      expect(progressionById(p.id)).toBe(p);
    }
  });

  test('every bars value is an integer of at least 1', () => {
    for (const p of CHORD_PROGRESSIONS) {
      for (const step of p.steps) {
        expect(Number.isInteger(step.bars)).toBe(true);
        expect(step.bars).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('referenceScale is a real scale and minScaleLength matches its length', () => {
    for (const p of CHORD_PROGRESSIONS) {
      expect(SCALES[p.referenceScale]).toBeDefined();
      expect(p.minScaleLength).toBe(scaleEntry(p.referenceScale).intervals.length);
    }
  });

  test('no entry relies on degree wrapping', () => {
    for (const p of CHORD_PROGRESSIONS) {
      for (const step of p.steps) {
        expect(Number.isInteger(step.degree)).toBe(true);
        expect(step.degree).toBeGreaterThanOrEqual(0);
        expect(step.degree).toBeLessThan(p.minScaleLength);
      }
    }
  });

  test('every explicit quality is a chord type tonal actually knows', () => {
    // Since DEV-394, `generateBlockChordNotes` throws on an unregistered
    // quality token rather than silently falling back to `maj` — this test
    // catches an authored typo at data-layer scope, before it can reach that
    // throw at playback time.
    for (const p of CHORD_PROGRESSIONS) {
      for (const step of p.steps) {
        if (step.quality === undefined) continue;
        const token = step.quality.toLowerCase();
        expect(Chord.getChord(TONAL_CHORD_ALIASES[token] ?? token, 'C').empty).toBe(false);
      }
    }
  });
});

function expectedRomanNumeral(referenceScale: string, degree: number, quality: ChordQuality | undefined): string {
  const resolvedType = resolveScaleKey(referenceScale);
  const numDegrees = scaleEntry(resolvedType).intervals.length;
  const normDegree = ((degree % numDegrees) + numDegrees) % numDegrees;
  const resolvedQuality = quality ?? getDiatonicChordForDegree(degree, 'C', referenceScale, false).quality;
  return degreeToRoman(referenceScale, normDegree, resolvedQuality);
}

describe('CHORD_PROGRESSIONS roman summaries match their step data', () => {
  for (const progression of CHORD_PROGRESSIONS) {
    test(`${progression.id}: roman numerals match degree/quality/referenceScale`, () => {
      const tokens = progression.roman.split(' – ');
      expect(tokens.length).toBe(progression.steps.length);
      progression.steps.forEach((step, i) => {
        const expected = expectedRomanNumeral(progression.referenceScale, step.degree, step.quality);
        const match = tokens[i].match(/^[b#]?[IViv]+/);
        expect(match).not.toBeNull();
        expect(match![0]).toBe(expected);
      });
    });
  }
});

// The tagged sets as authored today, written out. They used to be computed
// from `genres`; that tag no longer constrains anything, so the conventions
// below name the entries they are about. Adding a progression does not oblige
// you to add it here — these pin conventions, not coverage.
const EDM_IDS = ['pop-club-house', 'edm-cyber-drop', 'edm-neon-rise', 'edm-arena-sweep', 'edm-cyber-vamp'];
const AMBIENT_IDS = ['ambient-still-water', 'ambient-lydian-drift', 'ambient-open-fourths', 'ambient-glass-horizon', 'ambient-lydian-halo'];
const EXTENSION_IDS = [
  'jazz-ii-v-i-vi', 'jazz-neosoul-butter', 'lofi-coffeehouse', 'lofi-bedroom-pop',
  'lofi-rainy-window', 'lofi-tape-loop', 'lofi-morning-turnaround',
  'cine-dorian-voyage', 'boombap-dusty-ii-v', 'boombap-crate-dig',
  'boombap-head-nod', 'boombap-soul-piano',
];
const ZEN_IDS = ['zen-bamboo-vamp', 'zen-moonlit-koto', 'zen-still-pond', 'zen-temple-bell'];

const byIds = (ids: string[]) => ids.map((id) => progressionById(id)!);

describe('authoring conventions from the research', () => {
  test('edm entries hold every chord for the same number of bars, and at least three of the five are 2-bar', () => {
    // Not "always 2": pop-club-house is cross-tagged from the migrated set and
    // its bars are fixed at 1 by the migration proof, and edm-cyber-vamp is
    // deliberately 1-bar too — it reproduces cyber-edm's original sound.
    const edm = byIds(EDM_IDS);
    const uniform = edm.map((p) => new Set(p.steps.map((s) => s.bars)));
    for (const bars of uniform) expect(bars.size).toBe(1);
    expect(edm.filter((p) => p.steps.every((s) => s.bars === 2)).length).toBeGreaterThanOrEqual(3);
  });

  test('ambient entries hold 4+ bars and avoid V-I, including across the loop point', () => {
    for (const p of byIds(AMBIENT_IDS)) {
      for (const step of p.steps) expect(step.bars).toBeGreaterThanOrEqual(4);
      p.steps.forEach((step, i) => {
        const next = p.steps[(i + 1) % p.steps.length];
        expect(step.degree === 4 && next.degree === 0).toBe(false);
      });
    }
  });

  test('lofi and boombap entries write an extension on every step', () => {
    for (const p of byIds(EXTENSION_IDS)) {
      for (const step of p.steps) {
        expect(step.quality).toBeDefined();
        expect(step.quality).toMatch(/7|9|11|13/);
      }
    }
  });

  test('zen entries are playable on a five-note scale', () => {
    for (const p of byIds(ZEN_IDS)) {
      expect(p.minScaleLength).toBe(5);
      expect(p.referenceScale).toBe('Hirajoshi');
    }
  });
});

describe('resolveProgression', () => {
  const popAnthem = progressionById('pop-i-v-vi-iv')!;

  test('resolves I - V - vi - IV in C Major to C - G - Am - F', () => {
    expect(resolveProgression(popAnthem, 'C', 'Major').map((c) => `${c.root}${c.quality}`)).toEqual(
      ['Cmaj', 'Gmaj', 'Amin', 'Fmaj'],
    );
  });

  test('an omitted quality yields the triad, never the seventh', () => {
    const chords = resolveProgression(popAnthem, 'C', 'Major');
    expect(chords.map((c) => c.quality)).toEqual(['maj', 'maj', 'min', 'maj']);
  });

  test('an explicit quality survives verbatim', () => {
    const lofi = progressionById('lofi-tape-loop')!;
    expect(resolveProgression(lofi, 'C', 'Major').map((c) => c.quality)).toEqual([
      'maj9',
      'min7',
      'min9',
      '9',
    ]);
  });

  test('bars carry through and ids are unique within the result', () => {
    const zen = progressionById('zen-still-pond')!;
    const chords = resolveProgression(zen, 'G', 'Hirajoshi');
    expect(chords.map((c) => c.bars)).toEqual([4, 4]);
    expect(chords.map((c) => c.id)).toEqual(['zen-still-pond-0', 'zen-still-pond-1']);
    expect(new Set(chords.map((c) => c.id)).size).toBe(chords.length);
  });

  test('returns exactly one chord per step, even in a five-note scale', () => {
    // B2 depends on this: a collapsed progression would silently shorten a loop.
    for (const p of CHORD_PROGRESSIONS.filter((x) => x.minScaleLength === 5)) {
      expect(resolveProgression(p, 'G', 'Hirajoshi')).toHaveLength(p.steps.length);
    }
  });

  test('the result carries no notes field', () => {
    const chords = resolveProgression(popAnthem, 'C', 'Major');
    for (const c of chords) {
      expect('notes' in c).toBe(false);
    }
  });
});

describe('the four Phase 1 vibe-chord progressions', () => {
  test('lofi-morning-turnaround resolves to Cmaj7 Amin7 Dmin7 G7 in C Major', () => {
    const p = progressionById('lofi-morning-turnaround')!;
    expect(p).toBeDefined();
    expect(resolveProgression(p, 'C', 'Major').map((c) => `${c.root}${c.quality}`)).toEqual([
      'Cmaj7', 'Amin7', 'Dmin7', 'G7',
    ]);
  });

  test('edm-cyber-vamp resolves to Fmin D#maj C#maj Cmin in F Natural Minor', () => {
    const p = progressionById('edm-cyber-vamp')!;
    expect(p).toBeDefined();
    expect(resolveProgression(p, 'F', 'Natural Minor').map((c) => `${c.root}${c.quality}`)).toEqual([
      'Fmin', 'D#maj', 'C#maj', 'Cmin',
    ]);
  });

  test('ambient-lydian-halo resolves to Dmaj7 Emaj F#min7 G#m7b5 in D Lydian, 4 bars each', () => {
    const p = progressionById('ambient-lydian-halo')!;
    expect(p).toBeDefined();
    const chords = resolveProgression(p, 'D', 'Lydian');
    expect(chords.map((c) => `${c.root}${c.quality}`)).toEqual([
      'Dmaj7', 'Emaj', 'F#min7', 'G#m7b5',
    ]);
    expect(chords.map((c) => c.bars)).toEqual([4, 4, 4, 4]);
  });

  test('boombap-soul-piano resolves to Emin7 A7 Dmaj7 Gmaj7 in E Dorian', () => {
    const p = progressionById('boombap-soul-piano')!;
    expect(p).toBeDefined();
    expect(resolveProgression(p, 'E', 'Dorian').map((c) => `${c.root}${c.quality}`)).toEqual([
      'Emin7', 'A7', 'Dmaj7', 'Gmaj7',
    ]);
  });
});

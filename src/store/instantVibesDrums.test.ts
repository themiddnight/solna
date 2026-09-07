import { describe, expect, test } from 'bun:test';
import { VIBES } from '../data/vibes';
import { resolveVibe, VIBE_IDS } from './vibes';
import { ORIGINAL_VIBE_DRUM_PATTERNS } from './instantVibesDrumsFixture';
import { drumGridById } from '../audio/drumGrids';
import { getMeter } from '../utils/meter';

// Row sets differ per vibe now that a grid may omit a voice (decision 10) and
// decision 21 has removed the clap rows genres do not play and the snare rows
// their clap replaces. Written out per vibe rather than derived, so a row
// appearing or disappearing is a diff a reviewer sees.
const FIXTURE_ROWS: Record<string, string[]> = {
  'lofi-chill': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'lowtom', 'crash'],
  'synthwave-80s': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'hitom', 'lowtom', 'crash'],
  'cyber-edm': ['kick', 'hihat', 'openhat', 'clap', 'hitom', 'lowtom', 'crash'], // house: clap-only
  'deep-ambient': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'lowtom', 'crash'],
  'boom-bap': ['kick', 'snare', 'hihat', 'openhat', 'lowtom', 'crash'], // no clap in boom bap
  'zen-garden': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'lowtom', 'crash'],
  'lofi-waltz': ['kick', 'snare', 'hihat', 'openhat', 'lowtom', 'crash'], // jazz waltz: no clap
  // the cross-stick and the bell are voices now, not a comment: snare and hihat
  // stay listed and are all-false, because the idiom plays nothing on them
  'afro-six-eight': ['kick', 'snare', 'rimshot', 'hihat', 'bell', 'openhat', 'lowtom', 'crash'],
};

describe('ORIGINAL_VIBE_DRUM_PATTERNS fixture', () => {
  test('captures exactly the eight vibes', () => {
    expect(Object.keys(ORIGINAL_VIBE_DRUM_PATTERNS).sort()).toEqual([...VIBE_IDS].sort());
  });

  test('matches the drum pattern every vibe resolves to', () => {
    for (const id of VIBE_IDS) {
      const spec = VIBES.find((v) => v.id === id)!;
      expect(spec).toBeDefined();
      expect(resolveVibe(spec).drumPattern).toEqual(ORIGINAL_VIBE_DRUM_PATTERNS[id]);
    }
  });

  test("every captured pattern is its vibe's own rows at its own bar length, in booleans", () => {
    for (const id of VIBE_IDS) {
      const vibe = VIBES.find((v) => v.id === id)!;
      const expected = getMeter(vibe.meter).stepsPerBar;
      const pattern = ORIGINAL_VIBE_DRUM_PATTERNS[id];
      expect(Object.keys(pattern).sort(), id).toEqual([...FIXTURE_ROWS[id]].sort());
      for (const row of FIXTURE_ROWS[id]) {
        expect(pattern[row].length, `${id}/${row}`).toBe(expected);
        for (const cell of pattern[row]) {
          expect(typeof cell).toBe('boolean');
        }
      }
    }
  });

  test("a vibe's meter and its drum pattern's meter agree", () => {
    // They are declared in two different files. If they drift, the vibe applies
    // a bar of one length into a transport set to another, and replaceDrumPattern
    // silently trims or loops the difference.
    for (const id of VIBE_IDS) {
      const vibe = VIBES.find((v) => v.id === id)!;
      expect(drumGridById(vibe.drumGridId)!.meter, id).toBe(vibe.meter);
    }
  });
});

describe('ResolvedVibe.drumGridId reproduces the fixture exactly', () => {
  test('every vibe has a drumGridId that resolves to a real library pattern', () => {
    for (const id of VIBE_IDS) {
      const vibe = VIBES.find((v) => v.id === id)!;
      expect(typeof vibe.drumGridId).toBe('string');
      expect(vibe.drumGridId.length).toBeGreaterThan(0);
      expect(drumGridById(vibe.drumGridId)).toBeDefined();
    }
  });

  test('resolving drumGridId reproduces the captured pattern byte-for-byte', () => {
    for (const id of VIBE_IDS) {
      const vibe = VIBES.find((v) => v.id === id)!;
      expect(drumGridById(vibe.drumGridId)!.rows).toEqual(ORIGINAL_VIBE_DRUM_PATTERNS[id]);
    }
  });

  test('the eight vibes map onto eight distinct library ids', () => {
    const referenced = VIBES.map((v) => v.drumGridId);
    expect(new Set(referenced).size).toBe(8);
    expect([...referenced].sort()).toEqual([
      'afro-six-eight-bell',
      'ambient-sparse-drift',
      'boombap-swung-break',
      'house',
      'lofi-half-time-brush',
      'synthwave-four-on-floor',
      'waltz-brush-three',
      'zen-bamboo-pulse',
    ]);
  });
});

describe('a vibe does not share array instances with the library', () => {
  test('mutating a resolved row cannot rewrite DRUM_GRIDS', () => {
    for (const id of VIBE_IDS) {
      const spec = VIBES.find((v) => v.id === id)!;
      const fresh = drumGridById(spec.drumGridId)!;
      expect(resolveVibe(spec).drumPattern.kick).not.toBe(fresh.rows.kick);
    }
  });
});

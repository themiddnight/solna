import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES, VIBE_IDS } from './instantVibes';
import { ORIGINAL_VIBE_DRUM_PATTERNS } from './instantVibesDrumsFixture';
import { drumPatternById, drumPatternMeterId } from '../audio/data/vibeDrumPatterns';
import { getMeter } from '../utils/meter';

const ROWS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];

describe('ORIGINAL_VIBE_DRUM_PATTERNS fixture', () => {
  test('captures exactly the six vibes', () => {
    expect(Object.keys(ORIGINAL_VIBE_DRUM_PATTERNS).sort()).toEqual([...VIBE_IDS].sort());
  });

  test('matches the drum pattern every vibe in INSTANT_VIBES ships', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe).toBeDefined();
      expect(vibe.drumPattern).toEqual(ORIGINAL_VIBE_DRUM_PATTERNS[id]);
    }
  });

  test("every captured pattern is seven rows of its vibe's own bar length, in 0/1", () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      const expected = getMeter(vibe.meter).stepsPerBar;
      const pattern = ORIGINAL_VIBE_DRUM_PATTERNS[id];
      expect(Object.keys(pattern).sort()).toEqual([...ROWS].sort());
      for (const row of ROWS) {
        expect(pattern[row].length, `${id}/${row}`).toBe(expected);
        for (const cell of pattern[row]) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
    }
  });

  test("a vibe's meter and its drum pattern's meter agree", () => {
    // They are declared in two different files. If they drift, the vibe applies
    // a bar of one length into a transport set to another, and applyDrumPattern
    // silently trims or loops the difference.
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(drumPatternMeterId(vibe.drumPatternId), id).toBe(vibe.meter);
    }
  });
});

describe('InstantVibe.drumPatternId reproduces the fixture exactly', () => {
  test('every vibe has a drumPatternId that resolves to a real library pattern', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(typeof vibe.drumPatternId).toBe('string');
      expect(vibe.drumPatternId.length).toBeGreaterThan(0);
      expect(drumPatternById(vibe.drumPatternId)).toBeDefined();
    }
  });

  test('resolving drumPatternId reproduces the captured pattern byte-for-byte', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(drumPatternById(vibe.drumPatternId)).toEqual(ORIGINAL_VIBE_DRUM_PATTERNS[id]);
    }
  });

  test('vibe.drumPattern is itself the resolved library pattern, not a separate literal', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe.drumPattern).toEqual(drumPatternById(vibe.drumPatternId)!);
    }
  });

  test('the eight vibes map onto eight distinct library ids', () => {
    const referenced = INSTANT_VIBES.map((v) => v.drumPatternId);
    expect(new Set(referenced).size).toBe(8);
    expect([...referenced].sort()).toEqual([
      'afro-six-eight-bell',
      'ambient-sparse-drift',
      'boombap-swung-break',
      'edm-offbeat-pump',
      'lofi-half-time-brush',
      'synthwave-four-on-floor',
      'waltz-brush-three',
      'zen-bamboo-pulse',
    ]);
  });
});

describe('a vibe does not share array instances with the library', () => {
  test('mutating a vibe row cannot rewrite VIBE_DRUM_PATTERNS', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      const fresh = drumPatternById(vibe.drumPatternId)!;
      expect(vibe.drumPattern.kick).not.toBe(fresh.kick);
    }
  });
});

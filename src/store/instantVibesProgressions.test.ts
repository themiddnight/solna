import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES } from './instantVibes';
import { ORIGINAL_VIBE_CHORDS } from './instantVibesChordsFixture';
import { progressionById, resolveProgression } from '../audio/data/chordProgressions';

const VIBE_IDS = INSTANT_VIBES.map((v) => v.id);

// Root/quality/bars/notes only — resolveProgression ids are
// `${progressionId}-${i}`, which never matches the fixture's hand-authored
// ids (`c1`, `sw1`, ...), and that difference is not part of what "the same
// chords" means here.
function withoutId(chords: { root: string; quality: string; bars: number; notes: string[] }[]) {
  return chords.map(({ root, quality, bars, notes }) => ({ root, quality, bars, notes }));
}

describe('ORIGINAL_VIBE_CHORDS fixture', () => {
  test('captures exactly the six vibes, matching what INSTANT_VIBES ships today', () => {
    expect(Object.keys(ORIGINAL_VIBE_CHORDS).sort()).toEqual([...VIBE_IDS].sort());
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe).toBeDefined();
      expect(withoutId(ORIGINAL_VIBE_CHORDS[id])).toEqual(withoutId(vibe.chords));
    }
  });
});

describe('InstantVibe.progressionId reproduces the fixture exactly', () => {
  test('every vibe has a progressionId that resolves to a real progression', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe.progressionId).toBeDefined();
      expect(progressionById(vibe.progressionId)).toBeDefined();
    }
  });

  test('resolving progressionId in the vibe\'s own key reproduces the captured chords byte-for-byte', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      const progression = progressionById(vibe.progressionId)!;
      const resolved = resolveProgression(progression, vibe.scaleRoot, vibe.scaleType, vibe.chordOctave);
      expect(withoutId(resolved)).toEqual(withoutId(ORIGINAL_VIBE_CHORDS[id]));
    }
  });

  test('vibe.chords is itself the resolved progression, not a separate literal', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      const progression = progressionById(vibe.progressionId)!;
      const resolved = resolveProgression(progression, vibe.scaleRoot, vibe.scaleType, vibe.chordOctave);
      expect(vibe.chords).toEqual(resolved);
    }
  });
});

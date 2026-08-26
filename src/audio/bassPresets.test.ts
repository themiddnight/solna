import { describe, expect, test } from 'bun:test';
import { FACTORY_BASS_PRESETS } from './bassPresets';
import { ALL_FACTORY_PRESETS } from './synthPresets';

describe('bass presets', () => {
  test('every bass preset is category Bass', () => {
    // InstantVibe.bassPresetId is documented (types.ts:195) as having to
    // resolve to category 'Bass'; a mis-categorised preset makes a vibe load a
    // lead patch onto the bass bus.
    for (const p of FACTORY_BASS_PRESETS) {
      expect(p.category, p.name).toBe('Bass');
    }
    expect(FACTORY_BASS_PRESETS.length).toBe(5);
  });

  test('ids are unique across the whole factory library', () => {
    const ids = ALL_FACTORY_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no preset pins its own name into params.preset', () => {
    // Every merge site overwrites it with the preset's name anyway; carrying a
    // copy in the data means two places to keep in sync for zero effect.
    for (const p of ALL_FACTORY_PRESETS) {
      expect(p.params.preset, p.name).toBeUndefined();
    }
  });
});

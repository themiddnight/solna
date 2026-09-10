import { describe, expect, test } from 'bun:test';
import { VIBES } from './vibes';
import { SYNTH_PRESETS } from './synthPresets';

describe('fxPresetId', () => {
  test('every vibe names one', () => {
    for (const vibe of VIBES) {
      expect({ id: vibe.id, fx: typeof vibe.fxPresetId }).toEqual({ id: vibe.id, fx: 'string' });
    }
  });

  test('every fxPresetId resolves to a real preset in the FX category', () => {
    for (const vibe of VIBES) {
      const preset = SYNTH_PRESETS.find((p) => p.id === vibe.fxPresetId);
      expect({ id: vibe.id, found: preset !== undefined, category: preset?.category }).toEqual({
        id: vibe.id,
        found: true,
        category: 'FX',
      });
    }
  });

  /**
   * The dice gains NO sixth axis. There is no FX pattern library to roll from,
   * and an axis over an empty pool fails silently — the same reasoning already
   * recorded for why `progressions` and `drumGrids` use plain `pick`.
   */
  test('no vibe declares an fx reroll pool', () => {
    for (const vibe of VIBES) {
      expect(Boolean(vibe.random && 'fxPresets' in vibe.random)).toBe(false);
    }
  });
});

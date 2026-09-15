import { describe, expect, test } from 'bun:test';
import { VIBES } from './vibes';
import { SYNTH_PRESETS } from './synthPresets';
import { BEAT_PRESETS } from './beatPresets';

describe('beatPresetId', () => {
  /**
   * STRICT, unlike the project-file reader: shipped factory data must name a
   * factory preset that exists. A user's stored `basePresetId` may go
   * unresolvable — their library is theirs to delete from, and the patch is
   * complete without it — but a VIBE resolves its id at apply time and would
   * otherwise install the default preset's sound under another vibe's name.
   */
  test('every vibe names a real factory Beat preset by stable id', () => {
    const presetIds = new Set(BEAT_PRESETS.map((p) => p.id));
    for (const vibe of VIBES) {
      expect(presetIds.has(vibe.beatPresetId), `${vibe.id} -> ${vibe.beatPresetId}`).toBe(true);
    }
  });
});

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

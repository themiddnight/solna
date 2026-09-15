import { describe, expect, spyOn, test } from 'bun:test';
import { BEAT_PRESETS } from '@/data/beatPresets';
import type { BeatParams } from '@/types';
import { applyBeatParams } from './beatAdapter';
import type { AudioEngine } from './engine';

/** A complete factory patch, with the provenance a loop's params carry. */
function beatParams(over: Partial<BeatParams> = {}): BeatParams {
  const preset = BEAT_PRESETS[0];
  return structuredClone({ basePresetId: preset.id, ...preset.patch, ...over });
}

/**
 * The two engine methods the adapter is allowed to touch, as a plain object.
 * Spying a bare recorder rather than a real engine keeps the assertions about
 * the CALL — the adapter's whole content — with no AudioContext in sight.
 */
function fakeEngine() {
  const noop = (): void => undefined;
  const recorder = {
    // Typed off the engine's own members, so a signature change here is a
    // compile error rather than a test that keeps asserting the old call.
    setDrumKit: noop as unknown as AudioEngine['setDrumKit'],
    setBeatFilter: noop as unknown as AudioEngine['setBeatFilter'],
  };
  return {
    engine: recorder as unknown as AudioEngine,
    setDrumKit: spyOn(recorder, 'setDrumKit'),
    setBeatFilter: spyOn(recorder, 'setBeatFilter'),
  };
}

describe('applyBeatParams', () => {
  test('installs the patch voices and its own trim, then the bus filter, at an explicit time', () => {
    const { engine, setDrumKit, setBeatFilter } = fakeEngine();
    const params = beatParams();

    applyBeatParams(engine, params, 4);

    expect(setDrumKit).toHaveBeenCalledWith(params.voices, params.outputTrimDb);
    expect(setBeatFilter).toHaveBeenCalledWith(
      params.filter.cutoff, params.filter.resonance, params.filter.type, 4,
    );
  });

  /**
   * The trim is a FIELD of the patch, never a lookup: two patches whose voices
   * are identical still install different trims, which is exactly what the
   * deleted name-keyed table could not express for an edited or user patch.
   */
  test('the trim comes from the patch, not from the voices', () => {
    const { engine, setDrumKit } = fakeEngine();
    const loud = beatParams({ outputTrimDb: 3.7 });
    const quiet = beatParams({ outputTrimDb: -2.4 });

    applyBeatParams(engine, loud);
    applyBeatParams(engine, quiet);

    expect(setDrumKit.mock.calls.map((call) => call[1])).toEqual([3.7, -2.4]);
    expect(setDrumKit.mock.calls[0][0]).toEqual(setDrumKit.mock.calls[1][0]);
  });

  /** No time means "now" — the engine's own default, not a computed one here. */
  test('an omitted time is passed through as undefined', () => {
    const { engine, setBeatFilter } = fakeEngine();
    const params = beatParams();

    applyBeatParams(engine, params);

    expect(setBeatFilter).toHaveBeenCalledWith(
      params.filter.cutoff, params.filter.resonance, params.filter.type, undefined,
    );
  });
});

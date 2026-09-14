import { afterEach, describe, expect, mock, test } from 'bun:test';
import { freshEngine } from './testFakes';
import { dbToGain, toDecibels } from '../utils/gainUnits';

/**
 * Drum-kit calibration trim, end to end through the engine (DEV-387).
 *
 * Split out of `synthEnvelope.test.ts` when that file was deleted with the
 * legacy synth voice path: these two assertions are about `triggerDrum` and
 * `DRUM_TRIMS`, both of which survive the subtractive cutover untouched —
 * `src/audio/trims.ts` keeps `drumTrimGainFor` even after Task 12 removes the
 * synth half of the table.
 *
 * They live in their own file rather than moving into `drumSynth.test.ts`
 * because that file is already past the size the suite splits at, and because
 * `mock.module('@/data/trimTable', …)` is file-scoped in Bun: folding it into
 * a larger suite would put a mocked trim table under every other drum
 * assertion in it.
 */

describe('calibration trim reaches the rendered peak (DEV-387)', () => {
  afterEach(() => {
    // mock.restore() does not undo mock.module() (Bun's own documented
    // caveat) — reapply the shipped, still-empty shape defensively. Bun
    // 1.3.14 scopes mock.module() to this file, verified empirically, but
    // that scoping is not a documented guarantee, so this reset stays in
    // case a later Bun version widens it back to the whole module registry.
    mock.module('@/data/trimTable', () => ({ DRUM_TRIMS: {}, PRESET_TRIMS: {} }));
  });

  test('a +6 dB kit trim scales EVERY voice in the kit, by exactly that many dB', () => {
    // DEV-387: DRUM_TRIMS is keyed by kit name, one entry per kit — see the
    // comment on it in src/data/trimTable.ts. A kit's voices are not
    // independent, so the trim is not "only its named voice" anymore; it is
    // the whole kit, uniformly, which is what this test now proves.
    mock.module('@/data/trimTable', () => ({
      DRUM_TRIMS: {
        'Retro Drive': { measuredDbfs: -24, trimDb: 6, configHash: 'x' },
      },
      PRESET_TRIMS: {},
    }));

    const { engine: trimmed, ctx: trimmedCtx } = freshEngine();
    trimmed.setDrumKit(undefined, 'Retro Drive');
    const { engine: plain, ctx: plainCtx } = freshEngine();
    plain.setDrumKit(undefined, 'No Such Kit');

    const kickBefore = { trimmed: trimmedCtx._gains.length, plain: plainCtx._gains.length };
    trimmed.triggerDrum('kick', 1.0);
    plain.triggerDrum('kick', 1.0);
    const trimmedKickPeak = trimmedCtx._gains[kickBefore.trimmed].gain.events[0].v;
    const plainKickPeak = plainCtx._gains[kickBefore.plain].gain.events[0].v;
    // This is the case the brief calls load-bearing: clampVelocity(1) is 1,
    // so a boost that lands INSIDE the clamp is discarded and this ratio
    // would silently read 1 instead of dbToGain(6).
    expect(trimmedKickPeak / plainKickPeak).toBeCloseTo(dbToGain(toDecibels(6)), 6);
    expect(trimmedKickPeak).toBeGreaterThan(plainKickPeak);

    // A DIFFERENT voice in the SAME kit gets the identical scale factor — the
    // kit's own internal kick/snare balance is preserved, not closed.
    const snareBefore = { trimmed: trimmedCtx._gains.length, plain: plainCtx._gains.length };
    trimmed.triggerDrum('snare', 1.0);
    plain.triggerDrum('snare', 1.0);
    const trimmedSnarePeak = trimmedCtx._gains[snareBefore.trimmed].gain.events[0].v;
    const plainSnarePeak = plainCtx._gains[snareBefore.plain].gain.events[0].v;
    expect(trimmedSnarePeak / plainSnarePeak).toBeCloseTo(dbToGain(toDecibels(6)), 6);
  });

  test('a -6 dB trim attenuates by the same law regardless of which voice fires, and a kit with no entry stays neutral', () => {
    mock.module('@/data/trimTable', () => ({
      DRUM_TRIMS: {
        'Retro Drive': { measuredDbfs: -12, trimDb: -6, configHash: 'x' },
      },
      PRESET_TRIMS: {},
    }));

    const { engine: trimmed, ctx: trimmedCtx } = freshEngine();
    trimmed.setDrumKit(undefined, 'Retro Drive');
    const { engine: plain, ctx: plainCtx } = freshEngine();
    // No kit name at all — the untrimmed default, same as freshEngine() ships.
    plain.setDrumKit();

    const before = { trimmed: trimmedCtx._gains.length, plain: plainCtx._gains.length };
    trimmed.triggerDrum('snare', 1.0);
    plain.triggerDrum('snare', 1.0);
    const trimmedPeak = trimmedCtx._gains[before.trimmed].gain.events[0].v;
    const plainPeak = plainCtx._gains[before.plain].gain.events[0].v;
    expect(trimmedPeak / plainPeak).toBeCloseTo(dbToGain(toDecibels(-6)), 6);
    expect(trimmedPeak).toBeLessThan(plainPeak);
  });
});

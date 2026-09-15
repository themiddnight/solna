import { describe, expect, test } from 'bun:test';
import { freshEngine } from './testFakes';
import { BEAT_PRESETS } from '@/data/beatPresets';
import { dbToGain, toDecibels } from '../utils/gainUnits';

/**
 * Beat calibration trim, end to end through the engine (DEV-387).
 *
 * The trim is an ARGUMENT now — `BeatParams.outputTrimDb`, handed to
 * `setDrumKit` beside the voices — so there is no table to mock and no name to
 * resolve: `src/data/trimTable.ts` is the calibration EVIDENCE the number was
 * measured from, and runtime audio never reads it. What these tests still
 * prove is the part that was always load-bearing: that the trim reaches the
 * rendered PEAK, uniformly across a patch's voices.
 *
 * They live in their own file rather than moving into `drumSynth.test.ts`
 * because that file is already past the size the suite splits at.
 */
const VOICES = BEAT_PRESETS[0].patch.voices;

/** The gain peak of the next voice this engine builds. */
function peakOf(engine: ReturnType<typeof freshEngine>, voice: string): number {
  const before = engine.ctx._gains.length;
  engine.engine.triggerDrum(voice, 1.0);
  return engine.ctx._gains[before].gain.events[0].v;
}

describe('calibration trim reaches the rendered peak (DEV-387)', () => {
  test('a +6 dB trim scales EVERY voice in the patch, by exactly that many dB', () => {
    const trimmed = freshEngine();
    trimmed.engine.setDrumKit(VOICES, 6);
    const plain = freshEngine();
    plain.engine.setDrumKit(VOICES, 0);

    // The case the brief calls load-bearing: clampVelocity(1) is 1, so a boost
    // folded into velocity would be discarded inside the clamp and this ratio
    // would silently read 1 instead of dbToGain(6).
    const kickRatio = peakOf(trimmed, 'kick') / peakOf(plain, 'kick');
    expect(kickRatio).toBeCloseTo(dbToGain(toDecibels(6)), 6);
    expect(kickRatio).toBeGreaterThan(1);

    // A DIFFERENT voice in the SAME patch gets the identical scale factor —
    // the patch's own internal kick/snare balance is preserved, not closed.
    const snareRatio = peakOf(trimmed, 'snare') / peakOf(plain, 'snare');
    expect(snareRatio).toBeCloseTo(dbToGain(toDecibels(6)), 6);
  });

  test('a -6 dB trim attenuates by the same law, and a 0 dB trim is exactly unity', () => {
    const trimmed = freshEngine();
    trimmed.engine.setDrumKit(VOICES, -6);
    const plain = freshEngine();
    plain.engine.setDrumKit(VOICES, 0);

    const ratio = peakOf(trimmed, 'snare') / peakOf(plain, 'snare');
    expect(ratio).toBeCloseTo(dbToGain(toDecibels(-6)), 6);
    expect(ratio).toBeLessThan(1);
  });
});

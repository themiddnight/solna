/* eslint-disable @typescript-eslint/no-explicit-any -- node-web-audio-api's
   context is cast at the seam, and the dry bus is a private rack field. */
import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { createRenderEngine } from './engine';
import { FACTORY_EFFECTS } from './export/mixdownFixture';
import type { MasterEffects } from '@/types';

const RATE = 44100;

/**
 * A sine driven `driveGain` times full scale, switched on hard at 50 ms (the
 * transient a 20:1 limiter with a 3 ms attack time constant only partly reduces), fed into the master's
 * dry bus so it crosses the EQ, the master trim and whatever dynamics stages
 * `fx` enables — the same master tail a live session and the mixdown build.
 * Returns the absolute peak and the peak of the last 100 ms (the settled
 * level, where only the limiter's static curve and its makeup gain act).
 */
async function renderHot(
  fx: Partial<MasterEffects>,
  driveGain: number,
  { withoutCeiling = false }: { withoutCeiling?: boolean } = {},
): Promise<{ peak: number; settledPeak: number; fullScaleCount: number; channels: Float32Array[] }> {
  const seconds = 0.6;
  const ctx: any = new OfflineAudioContext(2, Math.round(RATE * seconds), RATE);
  const engine = createRenderEngine(ctx);
  engine.setMasterVolume(1);
  engine.updateEffects({ ...FACTORY_EFFECTS, reverbWet: 0, delayWet: 0, distortionWet: 0, ...fx });
  // The reference render: the same graph with the ceiling taken out of the
  // signal. With both dynamics stages off, masterGain is what feeds it.
  // (node-web-audio-api does not support `curve = null`, the spec's bypass.)
  if (withoutCeiling) {
    if (fx.limiterEnabled || fx.compressorEnabled) throw new Error('withoutCeiling needs both stages off');
    const rack = (engine as any).masterRack;
    rack.masterGain.disconnect(rack.outputCeiling);
    rack.masterGain.connect(ctx.destination);
  }

  const osc = ctx.createOscillator();
  osc.frequency.value = 220;
  const drive = ctx.createGain();
  drive.gain.value = driveGain;
  osc.connect(drive);
  drive.connect((engine as any).masterRack.dryGain);
  osc.start(0.05);

  const buffer: any = await ctx.startRendering();
  let peak = 0;
  let settledPeak = 0;
  let fullScaleCount = 0;
  const channels: Float32Array[] = [];
  const settledFrom = buffer.length - Math.round(RATE * 0.1);
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data: Float32Array = buffer.getChannelData(ch);
    channels.push(data);
    for (let i = 0; i < data.length; i += 1) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
      if (i >= settledFrom && a > settledPeak) settledPeak = a;
      // The int16 conversion encodeWav performs: a sample that lands on
      // ±full scale there is a clipped sample in the exported file.
      const clamped = Math.max(-1, Math.min(1, data[i]));
      const int16 = Math.trunc(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      if (int16 === 0x7fff || int16 === -0x8000) fullScaleCount += 1;
    }
  }
  return { peak, settledPeak, fullScaleCount, channels };
}

describe('master output ceiling (UX F-08)', () => {
  test('the drive actually reaches the output: a hot signal is not silenced', async () => {
    const { peak } = await renderHot({ limiterEnabled: true }, 8);
    expect(peak).toBeGreaterThan(0.5);
  });

  test('with the factory limiter on, a +18 dB transient never exceeds full scale', async () => {
    const { peak } = await renderHot({ limiterEnabled: true }, 8);
    expect(peak).toBeLessThanOrEqual(1);
  });

  test('with the limiter threshold at its 0 dB maximum, the output never exceeds full scale', async () => {
    const { peak } = await renderHot({ limiterEnabled: true, limiterThreshold: 0 }, 8);
    expect(peak).toBeLessThanOrEqual(1);
  });

  test('with both dynamics stages off, the output never exceeds full scale', async () => {
    const { peak } = await renderHot({ limiterEnabled: false, compressorEnabled: false }, 8);
    expect(peak).toBeLessThanOrEqual(1);
  });

  test('with the compressor alone on, the output never exceeds full scale', async () => {
    const { peak } = await renderHot({ limiterEnabled: false, compressorEnabled: true }, 8);
    expect(peak).toBeLessThanOrEqual(1);
  });

  test('a signal under full scale passes the ceiling to within float32 rounding', async () => {
    const off = { limiterEnabled: false, compressorEnabled: false };
    // Proof the ceiling is in THIS render path: the same graph clamps a hot
    // signal that the ceiling-free reference lets through above full scale.
    // Without it, a missing ceiling would pass the comparison below trivially.
    expect((await renderHot(off, 1.5, { withoutCeiling: true })).peak).toBeGreaterThan(1);
    expect((await renderHot(off, 1.5)).peak).toBeLessThanOrEqual(1);

    // Inside full scale the ceiling computes `x + 1` in float32, so it is the
    // identity to ~6e-8 absolute (a 24-bit LSB is 1.2e-7), not bit-exact.
    const quiet = await renderHot(off, 0.5);
    const reference = await renderHot(off, 0.5, { withoutCeiling: true });
    expect(reference.peak).toBeGreaterThan(0.49);
    let maxDiff = 0;
    for (let ch = 0; ch < reference.channels.length; ch += 1) {
      const a = quiet.channels[ch];
      const b = reference.channels[ch];
      for (let i = 0; i < a.length; i += 1) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    }
    expect(maxDiff).toBeLessThanOrEqual(6e-8);
  });
});

describe('limiter makeup compensation', () => {
  // The Web Audio spec applies automatic makeup gain, (1/fullRangeGain)^0.6, to
  // EVERY sample the compressor passes — +1.71 dB at the −3 dB / 20:1 seed —
  // so without a compensating trim a signal far below threshold came out at
  // 0.365 for 0.3 in, and the settled output of a hot signal sat above full
  // scale. The trim after the limiter cancels it.
  test('a signal well below threshold passes the factory limiter at unity', async () => {
    const { settledPeak } = await renderHot({ limiterEnabled: true }, 0.3);
    expect(settledPeak).toBeGreaterThan(0.297);
    expect(settledPeak).toBeLessThan(0.303);
  });

  test('the compensation follows the limiter threshold and ratio', async () => {
    const { settledPeak } = await renderHot(
      { limiterEnabled: true, limiterThreshold: -12, limiterRatio: 8 },
      0.1,
    );
    expect(settledPeak).toBeGreaterThan(0.099);
    expect(settledPeak).toBeLessThan(0.101);
  });

  test('a +18 dB signal through the factory limiter clips only its onset transient', async () => {
    // 9392 full-scale int16 samples before the trim: the settled level sat at
    // +0.4 dBFS and every peak of every cycle hit the ceiling.
    const { fullScaleCount, settledPeak } = await renderHot({ limiterEnabled: true }, 8);
    expect(settledPeak).toBeLessThan(1);
    expect(fullScaleCount).toBeLessThan(500);
  });
});

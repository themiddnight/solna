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
 * transient a 3 ms-attack limiter cannot catch in time), fed into the master's
 * dry bus so it crosses the EQ, the master trim and whatever dynamics stages
 * `fx` enables — the same master tail a live session and the mixdown build.
 * Returns the absolute peak and the peak of the last 100 ms (the settled
 * level, where only the limiter's static curve and its makeup gain act).
 */
async function renderHot(
  fx: Partial<MasterEffects>,
  driveGain: number,
): Promise<{ peak: number; settledPeak: number }> {
  const seconds = 0.6;
  const ctx: any = new OfflineAudioContext(2, Math.round(RATE * seconds), RATE);
  const engine = createRenderEngine(ctx);
  engine.setMasterVolume(1);
  engine.updateEffects({ ...FACTORY_EFFECTS, reverbWet: 0, delayWet: 0, distortionWet: 0, ...fx });

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
  const settledFrom = buffer.length - Math.round(RATE * 0.1);
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data: Float32Array = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += 1) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
      if (i >= settledFrom && a > settledPeak) settledPeak = a;
    }
  }
  return { peak, settledPeak };
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

  test('a signal already under full scale passes the ceiling untouched', async () => {
    const quiet = await renderHot({ limiterEnabled: false, compressorEnabled: false }, 0.5);
    expect(quiet.peak).toBeGreaterThan(0.49);
    expect(quiet.peak).toBeLessThanOrEqual(0.5 + 1e-6);
  });
});

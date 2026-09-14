import { describe, expect, test } from 'bun:test';
import type { NoiseColor } from '@/types/synth';
import { createNoiseBuffer } from './noise';

/**
 * Fresh mulberry32 generator per call, so two independently-seeded sequences
 * with the same seed are guaranteed to walk in lockstep — the determinism
 * test needs two SEPARATE generator instances, not one shared closure two
 * tests would otherwise race to consume.
 */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Just enough of `BaseAudioContext` for `createNoiseBuffer`. */
function fakeNoiseCtx(sampleRate: number) {
  return {
    sampleRate,
    createBuffer(_channels: number, length: number, rate: number) {
      const data = new Float32Array(length);
      return {
        sampleRate: rate,
        length,
        numberOfChannels: 1,
        duration: length / rate,
        getChannelData: () => data,
      } as unknown as AudioBuffer;
    },
  };
}

/** Mean absolute value proxy for DC bias — near 0 for a zero-mean generator. */
function dc(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum / data.length;
}

/**
 * Ratio of the first-difference signal's energy to the raw signal's energy —
 * a cheap FFT-free proxy for "how much high-frequency content is here".
 * White noise's first difference roughly doubles the variance (ratio ~2);
 * pink's -3 dB/octave tilt and brown's steeper -6 dB/octave tilt both push
 * energy toward the low end, so the ratio drops for pink and drops further
 * for brown.
 */
function highBandEnergyRatio(data: Float32Array): number {
  let energy = 0;
  for (let i = 0; i < data.length; i++) energy += data[i] * data[i];
  let diffEnergy = 0;
  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    diffEnergy += diff * diff;
  }
  return diffEnergy / energy;
}

const SAMPLE_RATE = 8192;

function generate(type: NoiseColor, seed: number): Float32Array {
  const buffer = createNoiseBuffer(fakeNoiseCtx(SAMPLE_RATE), type, seededRandom(seed));
  return buffer.getChannelData(0);
}

describe('createNoiseBuffer', () => {
  test('every color is near-zero DC', () => {
    for (const type of ['white', 'pink', 'brown'] as const) {
      expect(Math.abs(dc(generate(type, 1)))).toBeLessThan(0.05);
    }
  });

  test('white noise is broadly flat (its first-difference energy is close to its own, doubled)', () => {
    const ratio = highBandEnergyRatio(generate('white', 1));
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });

  test('pink noise has lower high-band energy than white', () => {
    expect(highBandEnergyRatio(generate('pink', 1))).toBeLessThan(highBandEnergyRatio(generate('white', 1)));
  });

  test('brown noise has lower high-band energy than pink', () => {
    expect(highBandEnergyRatio(generate('brown', 1))).toBeLessThan(highBandEnergyRatio(generate('pink', 1)));
  });

  test('the same injected sequence produces byte-for-byte identical buffers', () => {
    for (const type of ['white', 'pink', 'brown'] as const) {
      const a = createNoiseBuffer(fakeNoiseCtx(SAMPLE_RATE), type, seededRandom(7));
      const b = createNoiseBuffer(fakeNoiseCtx(SAMPLE_RATE), type, seededRandom(7));
      expect(Array.from(a.getChannelData(0))).toEqual(Array.from(b.getChannelData(0)));
    }
  });
});

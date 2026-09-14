import type { NoiseColor } from '@/types/synth';

/**
 * Deterministic noise-buffer generation for the subtractive engine's utility
 * source (design: docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md).
 *
 * `random` is injected rather than read from `src/audio/rng.ts` — this
 * module is a pure generator with no opinion on which RNG seam production
 * code should use, and tests pass a seeded generator so a buffer's contents
 * are reproducible byte-for-byte. `createNoiseBuffer` builds a fresh buffer
 * on every call and caches nothing: caching one per `(context, type)` pair
 * belongs to the caller that owns a context — `subtractiveVoice.ts` keeps
 * that cache, because it is the thing with a lifetime to cache against; a
 * pure generator has none.
 */

/**
 * Matches the legacy engine's noise buffer length (`masterRack.ts`'s
 * `createNoiseNode`): 2 seconds, looped by whichever voice plays it, long
 * enough that a slow pad release never reaches the seam.
 */
const NOISE_BUFFER_SECONDS = 2;

function fillWhite(data: Float32Array, random: () => number): void {
  for (let i = 0; i < data.length; i++) {
    data[i] = random() * 2 - 1;
  }
}

/**
 * Paul Kellet's refined pink-noise filter: a 7-term IIR cascade over white
 * noise giving the standard ~3 dB/octave rolloff (widely used — e.g. the DSP
 * musepack/Csound "pink noise" recipes credit the same coefficients).
 */
function fillPink(data: Float32Array, random: () => number): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    data[i] = pink * 0.11;
  }
}

/**
 * Brown (red) noise: a leaky integrator of white noise. Its rolloff is
 * steeper than pink's (~6 dB/octave vs ~3), which is what
 * `noise.test.ts` asserts as "lower high-band energy than pink" — a simple
 * integrator, rather than pink's multi-pole filter, is enough to produce
 * that steeper tilt.
 */
function fillBrown(data: Float32Array, random: () => number): void {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1;
    const next = (last + white * 0.02) / 1.02;
    data[i] = next * 3.5;
    last = next;
  }
}

/**
 * Builds a mono `AudioBuffer` of `type` noise on `ctx`, filled with `random`
 * (injected so callers — and tests — control determinism). `ctx` only needs
 * `sampleRate` and `createBuffer`, so a real `AudioContext`, a real
 * `OfflineAudioContext` and a minimal test fake all work unchanged.
 */
export function createNoiseBuffer(
  ctx: Pick<BaseAudioContext, 'sampleRate' | 'createBuffer'>,
  type: NoiseColor,
  random: () => number,
): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * NOISE_BUFFER_SECONDS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  switch (type) {
    case 'white':
      fillWhite(data, random);
      break;
    case 'pink':
      fillPink(data, random);
      break;
    case 'brown':
      fillBrown(data, random);
      break;
  }
  return buffer;
}

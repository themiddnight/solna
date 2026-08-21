import { PITCH_DECIMATION_FACTOR } from "./pitchConstants";

const FIR_TAPS = 31;
/** Normalised cutoff = 6.4 kHz / 48 kHz, i.e. 0.4x the 16 kHz output rate. */
const FIR_CUTOFF = 6400 / 48000;

/**
 * Windowed-sinc lowpass, built once at module load. The decimator runs on the
 * audio-callback cadence, so it must allocate nothing per call.
 */
const KERNEL = ((): Float32Array => {
  const kernel = new Float32Array(FIR_TAPS);
  const mid = (FIR_TAPS - 1) / 2;
  let sum = 0;
  for (let i = 0; i < FIR_TAPS; i++) {
    const n = i - mid;
    const sinc = n === 0 ? 2 * FIR_CUTOFF : Math.sin(2 * Math.PI * FIR_CUTOFF * n) / (Math.PI * n);
    // Hamming window — cheap, and its ~53 dB stopband is far more than we need.
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FIR_TAPS - 1));
    const tap = sinc * window;
    kernel[i] = tap;
    sum += tap;
  }
  for (let i = 0; i < FIR_TAPS; i++) kernel[i]! /= sum; // unity DC gain
  return kernel;
})();

/**
 * Anti-alias lowpass then keep every third sample, writing into `output`.
 *
 * `output.length` must be `input.length / PITCH_DECIMATION_FACTOR`; the caller owns
 * the buffer so the hot path allocates nothing.
 */
export function decimateByThree(input: Float32Array, output: Float32Array): void {
  const mid = (FIR_TAPS - 1) / 2;
  for (let outIndex = 0; outIndex < output.length; outIndex++) {
    const center = outIndex * PITCH_DECIMATION_FACTOR;
    let acc = 0;
    for (let tap = 0; tap < FIR_TAPS; tap++) {
      const sampleIndex = center + tap - mid;
      if (sampleIndex >= 0 && sampleIndex < input.length) {
        acc += input[sampleIndex]! * KERNEL[tap]!;
      }
    }
    output[outIndex] = acc;
  }
}

/** Root-mean-square of a buffer. Used for the silence gate. */
export function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i]! * buffer[i]!;
  return Math.sqrt(sum / buffer.length);
}

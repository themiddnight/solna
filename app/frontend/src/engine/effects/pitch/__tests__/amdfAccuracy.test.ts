import { describe, it, expect } from "vitest";
import { AMDF } from "pitchfinder";
import { PITCH_DECIMATION_FACTOR, PITCH_DECIMATED_WINDOW, PITCH_MAX_FREQ_HZ } from "../pitchConstants";

/**
 * Characterization test for the decimation choice (DEV-343).
 *
 * The card prescribed decimating to ~6 kHz. Measurement showed that breaks above
 * ~300 Hz: at 6 kHz a 700 Hz period is only ~8.6 samples, and integer-lag AMDF
 * locks onto a multiple instead (1182 cents error). The failure is silent — a
 * confident wrong number, not a null — so this test exists to stop anyone
 * "optimising" the sample rate back down.
 */
const FUNDAMENTALS = [82.4, 110, 146.8, 196, 261.6, 329.6, 392, 493.9, 587.3, 698.5, 880, 987.8];

/** Reference source rate the decimation constants are expressed against (see pitchConstants.ts). */
const REFERENCE_SOURCE_RATE_HZ = 48000;
/** The rate production code actually runs the detector at, derived from the real constant. */
const DECIMATED_RATE_HZ = REFERENCE_SOURCE_RATE_HZ / PITCH_DECIMATION_FACTOR;

/**
 * Minimum samples-per-period needed for integer-lag AMDF to resolve a fundamental
 * instead of locking onto a lag multiple. Measured: at 6 kHz, a 700 Hz period is
 * ~8.6 samples and AMDF fails (see the fixed counter-example below); at 16 kHz, a
 * 1000 Hz period is 16 samples and AMDF holds to <25 cents. 12 sits between the
 * measured failure point and the measured pass point.
 */
const MIN_SAMPLES_PER_PERIOD = 12;

function harmonicTone(freq: number, sampleRate: number, length: number): Float32Array {
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    buffer[i] =
      0.5 * Math.sin(2 * Math.PI * freq * t) +
      0.25 * Math.sin(4 * Math.PI * freq * t) +
      0.12 * Math.sin(6 * Math.PI * freq * t);
  }
  return buffer;
}

function centsError(detected: number, expected: number): number {
  return Math.abs(1200 * Math.log2(detected / expected));
}

describe("AMDF accuracy at the decimated rate (DEV-343)", () => {
  it("resolves the top of the declared range at >= 12 samples per period", () => {
    // Encodes *why* the chosen rate works, not just that two numbers differ: if
    // PITCH_DECIMATION_FACTOR ever moves without re-deriving this, the physical
    // constraint that makes AMDF reliable is what actually gets checked here.
    const samplesPerPeriodAtMax = DECIMATED_RATE_HZ / PITCH_MAX_FREQ_HZ;
    expect(samplesPerPeriodAtMax).toBeGreaterThanOrEqual(MIN_SAMPLES_PER_PERIOD);
  });

  it("tracks the whole 65-1000 Hz range within 50 cents at the real decimated rate/window", () => {
    const detect = AMDF({ sampleRate: DECIMATED_RATE_HZ, minFrequency: 65, maxFrequency: 1000 });
    for (const freq of FUNDAMENTALS) {
      const detected = detect(harmonicTone(freq, DECIMATED_RATE_HZ, PITCH_DECIMATED_WINDOW));
      expect(detected, `no pitch detected for ${freq} Hz`).not.toBeNull();
      expect(centsError(detected as number, freq), `${freq} Hz`).toBeLessThan(50);
    }
  });

  // Fixed historical fact, not derived from any constant: this is *why* the card's
  // prescribed ~6 kHz was rejected, independent of whatever PITCH_DECIMATION_FACTOR
  // is today. Do NOT parameterise this on the production constants.
  it("fails above ~300 Hz at 6 kHz — the rate the card prescribed", () => {
    const detect = AMDF({ sampleRate: 6000, minFrequency: 65, maxFrequency: 1000 });
    const detected = detect(harmonicTone(698.5, 6000, 512));
    expect(detected).not.toBeNull();
    // Locks onto a multiple: ~1182 cents off, i.e. a whole octave.
    expect(centsError(detected as number, 698.5)).toBeGreaterThan(500);
  });
});

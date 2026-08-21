/** Shared constants for pitch-aware effects (Autotune, Vocoder). Engine layer — no feature imports. */

export const VOCODER_FREQ_LOW = 100;
export const VOCODER_FREQ_HIGH = 8000;

/** Chromatic scale (all 12 pitch classes) — default until real scale is injected. */
export const DEFAULT_SCALE_MASK = 0xfff;
/** Default tonic pitch class (C). */
export const DEFAULT_KEY_ROOT = 0;

/** FFT window for the main-thread pitch detector. */
export const PITCH_DETECT_FFT_SIZE = 2048;

/**
 * Fundamental-frequency search band for the pitch detector (Hz). Bounds the AMDF
 * lag search to the human vocal range so it locks onto the fundamental instead of
 * octave/garbage. Covers low bass (~65 Hz) up to high soprano (~1000 Hz).
 *
 * Why AMDF and not YIN: pitchfinder's YIN needs ~40× the period in the window to
 * lock on, so at a 2048-sample buffer it cannot detect below ~200 Hz — it returns
 * ~20 kHz garbage for normal voices (verified in the voice-dsp POC). AMDF bounded
 * to this band tracks the real 90–250 Hz vocal fundamental at every buffer size.
 */
export const PITCH_MIN_FREQ_HZ = 65;
export const PITCH_MAX_FREQ_HZ = 1000;

/**
 * Decimation for the pitch detector (DEV-343). 48 kHz / 3 = 16 kHz.
 *
 * Measured: AMDF at 48 kHz/2048 costs 14.4 ms per detection — one detector is ~86%
 * of a 60 Hz frame. At 16 kHz/512 it costs 0.93 ms with 21 cents worst-case error
 * across 65-1000 Hz. Decimating further (the 6 kHz the card asked for) is 2x cheaper
 * again but produces confident octave errors above ~300 Hz, because integer-lag AMDF
 * cannot resolve a period only ~8 samples long. See amdfAccuracy.test.ts.
 */
export const PITCH_DECIMATION_FACTOR = 3;
export const PITCH_DECIMATED_WINDOW = 512;
export const PITCH_SOURCE_WINDOW = PITCH_DECIMATED_WINDOW * PITCH_DECIMATION_FACTOR;

/** Detection cadence, deliberately fixed rather than tied to the display refresh. */
export const PITCH_DETECT_RATE_HZ = 25;

/** Below this input RMS the detector emits null without running AMDF at all. */
export const PITCH_SILENCE_RMS = 0.008;

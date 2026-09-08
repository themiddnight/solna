import { DISPLAY_FLOOR_DBFS, gainToDbfs, toLinearGain } from './gainUnits';

/**
 * The level arithmetic behind every meter, kept free of React, rAF and AnalyserNode so it can be
 * tested by feeding it a known-amplitude buffer — which is exactly what DEV-384's acceptance
 * criteria ask for. `meterAttach.ts` is what joins this to an analyser and a tick source.
 *
 * Ported from the body of murva's `useMeterLevel.ts`; the constants are the DEV-383 contract's.
 */

export interface MeterLevel {
  /** Instantaneous peak for this tick, dBFS. No smoothing at all — attack = release = 0. */
  peakDbfs: number;
  /** Rolling-window RMS, dBFS. Averaged in the power domain, converted to dB once at the end. */
  rmsDbfs: number;
  /** Peak-hold marker, decaying at PEAK_DECAY_DB_PER_SEC. */
  heldPeakDbfs: number;
}

export const SILENT_LEVEL: MeterLevel = {
  peakDbfs: -Infinity,
  rmsDbfs: -Infinity,
  heldPeakDbfs: -Infinity,
};

export const PEAK_DECAY_DB_PER_SEC = 14;

/** Near the classic VU integration time and in the neighbourhood of LUFS-momentary's 400ms. */
export const DEFAULT_RMS_WINDOW_MS = 300;

/**
 * Dead-zone epsilon. A change smaller than this is invisible on any meter, so suppressing the
 * emission avoids a React re-render on every scheduler tick forever — including in silence,
 * where the decay below would otherwise keep producing "new" but imperceptibly different values.
 */
export const LEVEL_EPSILON_DB = 0.1;

/** The two statistics one analyser read yields. `peakMagnitude` is LINEAR — dB comes later. */
interface BufferStats {
  /** Largest sample magnitude seen. `0` for a silent or empty buffer. */
  peakMagnitude: number;
  /** Mean of the squared samples — power, not amplitude. */
  meanSquare: number;
}

/**
 * Both statistics from ONE indexed walk, written into a caller-owned `out` so the hot path
 * allocates nothing. Peak and mean-square used to be two separate `for...of` passes: `fftSize`
 * is 2048, so every meter read 4096 samples per tick — and built two iterators doing it — where
 * one walk of 2048 answers both questions.
 *
 * `bufferPeakDbfs` and `bufferMeanSquare` below stay exported and are what the tests measure the
 * arithmetic through; they delegate here rather than keeping loops of their own, so there is one
 * definition of each statistic and a one-shot caller and the tracker can never drift apart.
 */
function readBufferStats(buffer: Float32Array, out: BufferStats): void {
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const sample = buffer[i]!;
    const magnitude = sample < 0 ? -sample : sample;
    if (magnitude > peak) peak = magnitude;
    sumSquares += sample * sample;
  }
  out.peakMagnitude = peak;
  out.meanSquare = buffer.length === 0 ? 0 : sumSquares / buffer.length;
}

/** Linear magnitude to dBFS, with silence as `-Infinity` rather than a very negative number. */
function peakMagnitudeToDbfs(peakMagnitude: number): number {
  return peakMagnitude > 0 ? gainToDbfs(toLinearGain(peakMagnitude)) : -Infinity;
}

/** Largest sample magnitude in the buffer, in dBFS. An all-zero buffer is `-Infinity`. */
export function bufferPeakDbfs(buffer: Float32Array): number {
  const stats: BufferStats = { peakMagnitude: 0, meanSquare: 0 };
  readBufferStats(buffer, stats);
  return peakMagnitudeToDbfs(stats.peakMagnitude);
}

/** Mean of the squared samples — power, not amplitude. `0` for an empty or silent buffer. */
export function bufferMeanSquare(buffer: Float32Array): number {
  const stats: BufferStats = { peakMagnitude: 0, meanSquare: 0 };
  readBufferStats(buffer, stats);
  return stats.meanSquare;
}

/** Converts averaged power to dBFS with a single log, at the end. */
export function meanSquareToDbfs(meanSquare: number): number {
  return meanSquare > 0 ? gainToDbfs(toLinearGain(Math.sqrt(meanSquare))) : -Infinity;
}

/**
 * Decays `prev` toward silence, snapping straight to `-Infinity` once the decayed value would
 * reach the display floor rather than subtracting forever. An unbounded decay (-140, -5000, …)
 * never converges, so the dead-zone guard below would never see two consecutive ticks close
 * enough to bail out — this floor is what makes convergence possible.
 */
export function decayToward(prev: number, dtSec: number): number {
  const decayed = prev - PEAK_DECAY_DB_PER_SEC * Math.max(0, dtSec);
  return decayed <= DISPLAY_FLOOR_DBFS ? -Infinity : decayed;
}

/**
 * True when `a` and `b` are close enough that the UI would not visibly change — EXCEPT a
 * finite/-Infinity mismatch, which is a silence-boundary crossing and is exactly the
 * semantically meaningful transition the UI must react to.
 */
export function closeEnough(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= LEVEL_EPSILON_DB;
}

/**
 * A fixed-size ring of per-tick mean-square values. `sum` is maintained incrementally (subtract
 * the slot being overwritten, add the new one) so a tick is O(1) rather than re-summing the
 * window. `filledCount` is capped at the ring length so the average is over ticks actually seen
 * rather than diluted by zero-initialised slots while the window warms up.
 */
interface RmsWindowState {
  squares: Float32Array;
  writeIndex: number;
  filledCount: number;
  sum: number;
}

function createRmsWindowState(size: number): RmsWindowState {
  return { squares: new Float32Array(size), writeIndex: 0, filledCount: 0, sum: 0 };
}

/**
 * Writes `meanSquare` into the ring (evicting the oldest slot) and returns the mean power across
 * every slot filled so far. Averaging happens in the POWER domain, never in dB — averaging
 * already-converted dB values reads too low, because dB is a log scale.
 */
function pushRmsWindowSample(win: RmsWindowState, meanSquare: number): number {
  win.sum -= win.squares[win.writeIndex]!;
  win.squares[win.writeIndex] = meanSquare;
  win.sum += meanSquare;
  win.writeIndex = (win.writeIndex + 1) % win.squares.length;
  win.filledCount = Math.min(win.filledCount + 1, win.squares.length);
  return win.sum / win.filledCount;
}

export interface LevelTracker {
  /**
   * Folds one analyser read into the running level. Returns the new level, or `null` when the
   * change sits inside the dead zone and the caller should skip its re-render.
   */
  push(buffer: Float32Array, nowMs: number): MeterLevel | null;
  /** The most recent level, whether or not the corresponding `push` was suppressed. */
  readonly last: MeterLevel;
}

export interface LevelTrackerOptions {
  /** Tick cadence, used to size the RMS ring buffer from `rmsWindowMs`. */
  tickIntervalMs: number;
  rmsWindowMs?: number;
}

export function createLevelTracker(options: LevelTrackerOptions): LevelTracker {
  const rmsWindowMs = options.rmsWindowMs ?? DEFAULT_RMS_WINDOW_MS;
  const windowSamples = Math.max(1, Math.round(rmsWindowMs / options.tickIntervalMs));
  const rmsWindow = createRmsWindowState(windowSamples);

  let heldPeak = -Infinity;
  let heldPeakTime = 0;
  // The current level is kept as three scalars, not as a `MeterLevel`, and the stats buffer is
  // owned by the tracker rather than returned fresh: a meter ticks 30-60 times a second forever,
  // including through silence, so anything allocated per tick is allocated for the whole session.
  // `last` builds its object on demand instead — it is read by a caller that wants a value now,
  // never on the tick path.
  let currentPeak = SILENT_LEVEL.peakDbfs;
  let currentRms = SILENT_LEVEL.rmsDbfs;
  let lastEmitted: MeterLevel = SILENT_LEVEL;
  const stats: BufferStats = { peakMagnitude: 0, meanSquare: 0 };

  return {
    get last(): MeterLevel {
      return { peakDbfs: currentPeak, rmsDbfs: currentRms, heldPeakDbfs: heldPeak };
    },
    push(buffer: Float32Array, nowMs: number): MeterLevel | null {
      readBufferStats(buffer, stats);
      const peakDbfs = peakMagnitudeToDbfs(stats.peakMagnitude);
      const rmsDbfs = meanSquareToDbfs(pushRmsWindowSample(rmsWindow, stats.meanSquare));

      const dtSec = (nowMs - heldPeakTime) / 1000;
      heldPeak = Math.max(decayToward(heldPeak, dtSec), peakDbfs);
      heldPeakTime = nowMs;
      currentPeak = peakDbfs;
      currentRms = rmsDbfs;

      // A clip always emits, even when every field is numerically identical to the last
      // emission: a sustained clip must stay visible rather than being swallowed by the very
      // guard that exists to stop idle re-renders.
      const isClip = peakDbfs > 0;
      const unchanged =
        !isClip &&
        closeEnough(peakDbfs, lastEmitted.peakDbfs) &&
        closeEnough(rmsDbfs, lastEmitted.rmsDbfs) &&
        closeEnough(heldPeak, lastEmitted.heldPeakDbfs);

      // The comparison is on the fields, before any object exists: the suppressed tick is the
      // common case (silence, a held note, anything not moving), and the object it would have
      // built is one nothing ever looks at.
      if (unchanged) return null;
      lastEmitted = { peakDbfs, rmsDbfs, heldPeakDbfs: heldPeak };
      return lastEmitted;
    },
  };
}

import { describe, expect, test } from 'bun:test';
import {
  bufferMeanSquare,
  bufferPeakDbfs,
  closeEnough,
  createLevelTracker,
  decayToward,
  DEFAULT_RMS_WINDOW_MS,
  LEVEL_EPSILON_DB,
  meanSquareToDbfs,
  PEAK_DECAY_DB_PER_SEC,
  SILENT_LEVEL,
} from './meterLevel';

/**
 * One full sine cycle across `length` samples. With `length` a power of two the crest lands
 * exactly on a sample (i = length / 4), so the peak is exactly `amplitude` and the mean square
 * is exactly `amplitude ** 2 / 2` — the two values the acceptance criteria name.
 */
function sineBuffer(amplitude: number, length = 1024): Float32Array {
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * i) / length);
  }
  return buffer;
}

describe('constants', () => {
  test('are the contract values', () => {
    expect(PEAK_DECAY_DB_PER_SEC).toBe(14);
    expect(DEFAULT_RMS_WINDOW_MS).toBe(300);
    expect(LEVEL_EPSILON_DB).toBe(0.1);
  });

  test('silence is -Infinity, which is legal because a reading is never serialised', () => {
    expect(SILENT_LEVEL).toEqual({
      peakDbfs: -Infinity,
      rmsDbfs: -Infinity,
      heldPeakDbfs: -Infinity,
    });
  });
});

describe('bufferPeakDbfs', () => {
  test('a full-scale sine peaks at 0 dBFS', () => {
    expect(bufferPeakDbfs(sineBuffer(1))).toBeCloseTo(0, 4);
  });

  test('half amplitude peaks at about -6 dBFS', () => {
    expect(bufferPeakDbfs(sineBuffer(0.5))).toBeCloseTo(-6.0206, 3);
  });

  test('a quarter amplitude peaks at about -12 dBFS', () => {
    expect(bufferPeakDbfs(sineBuffer(0.25))).toBeCloseTo(-12.0412, 3);
  });

  test('an all-zero buffer is -Infinity, not 0 dBFS', () => {
    expect(bufferPeakDbfs(new Float32Array(256))).toBe(-Infinity);
  });

  test('measures magnitude, so a negative trough counts', () => {
    const buffer = new Float32Array([0, -1, 0, 0.25]);
    expect(bufferPeakDbfs(buffer)).toBeCloseTo(0, 4);
  });
});

describe('bufferMeanSquare and meanSquareToDbfs', () => {
  test('a full-scale sine has an RMS of about -3 dBFS', () => {
    expect(meanSquareToDbfs(bufferMeanSquare(sineBuffer(1)))).toBeCloseTo(-3.0103, 3);
  });

  test('half amplitude drops the RMS by 6 dB, to about -9 dBFS', () => {
    expect(meanSquareToDbfs(bufferMeanSquare(sineBuffer(0.5)))).toBeCloseTo(-9.0309, 3);
  });

  test('a DC full-scale buffer has an RMS of 0 dBFS, unlike a sine', () => {
    const dc = new Float32Array(256).fill(1);
    expect(meanSquareToDbfs(bufferMeanSquare(dc))).toBeCloseTo(0, 6);
  });

  test('silence is -Infinity', () => {
    expect(meanSquareToDbfs(0)).toBe(-Infinity);
  });
});

describe('decayToward', () => {
  test('falls at 14 dB per second', () => {
    expect(decayToward(0, 0.5)).toBeCloseTo(-7, 10);
    expect(decayToward(-10, 1)).toBeCloseTo(-24, 10);
  });

  test('snaps to -Infinity at the display floor instead of decaying forever', () => {
    expect(decayToward(-59, 1)).toBe(-Infinity);
    expect(decayToward(-60, 0)).toBe(-Infinity);
  });

  test('a negative dt never lifts the value', () => {
    expect(decayToward(-10, -5)).toBeCloseTo(-10, 10);
  });
});

describe('closeEnough', () => {
  test('a sub-epsilon move is close', () => {
    expect(closeEnough(-12, -12.05)).toBe(true);
  });

  test('a supra-epsilon move is not', () => {
    expect(closeEnough(-12, -12.5)).toBe(false);
  });

  test('a silence-boundary crossing is never close, however small it looks', () => {
    expect(closeEnough(-Infinity, -60)).toBe(false);
    expect(closeEnough(-60, -Infinity)).toBe(false);
  });

  test('identical values, including -Infinity, are close', () => {
    expect(closeEnough(-Infinity, -Infinity)).toBe(true);
  });
});

describe('createLevelTracker', () => {
  test('a full-scale sine reads 0 dBFS peak and about -3 dBFS RMS on the first push', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const level = tracker.push(sineBuffer(1), 0);

    expect(level).not.toBeNull();
    expect(level!.peakDbfs).toBeCloseTo(0, 3);
    expect(level!.rmsDbfs).toBeCloseTo(-3.0103, 3);
    expect(level!.heldPeakDbfs).toBeCloseTo(0, 3);
  });

  test('half amplitude reads about -6 dBFS peak', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const level = tracker.push(sineBuffer(0.5), 0);

    expect(level).not.toBeNull();
    expect(level!.peakDbfs).toBeCloseTo(-6.0206, 3);
  });

  test('peak has no smoothing: it drops the instant the signal does', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    tracker.push(sineBuffer(1), 0);
    const quiet = tracker.push(sineBuffer(0.25), 16);

    expect(quiet).not.toBeNull();
    expect(quiet!.peakDbfs).toBeCloseTo(-12.0412, 3);
  });

  test('the held peak decays rather than following the drop', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    tracker.push(sineBuffer(1), 0);
    const later = tracker.push(sineBuffer(0.001), 500);

    expect(later).not.toBeNull();
    // 0 dBFS held, decayed 14 dB/s for 0.5s.
    expect(later!.heldPeakDbfs).toBeCloseTo(-7, 1);
  });

  test('RMS averages in the power domain, so it lags a drop instead of jumping', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 100, rmsWindowMs: 300 });
    tracker.push(sineBuffer(1), 0);
    const second = tracker.push(new Float32Array(1024), 100);

    expect(second).not.toBeNull();
    // Mean of {0.5, 0} = 0.25 mean-square -> -6.02 dBFS, NOT the -Infinity a
    // dB-domain average of {-3.01, -Infinity} would give.
    expect(second!.rmsDbfs).toBeCloseTo(-6.0206, 3);
  });

  test('an unchanged signal is suppressed so it does not force a re-render every tick', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const buffer = sineBuffer(0.25);
    expect(tracker.push(buffer, 0)).not.toBeNull();
    // Same buffer, one tick later: peak identical, RMS window already saturated
    // at the same value, held peak pinned at the live peak.
    expect(tracker.push(buffer, 16.67)).toBeNull();
  });

  test('a clip always emits, even when every field is numerically identical', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const buffer = sineBuffer(1.5);
    expect(tracker.push(buffer, 0)).not.toBeNull();
    expect(tracker.push(buffer, 16.67)).not.toBeNull();
  });

  test('`last` reports the most recent level even when the push was suppressed', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60 });
    const buffer = sineBuffer(0.25);
    tracker.push(buffer, 0);
    tracker.push(buffer, 16.67);

    expect(tracker.last.peakDbfs).toBeCloseTo(-12.0412, 3);
  });

  test('`last` reports THIS tick, not the last emitted one, when the two differ sub-epsilon', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000 / 60, rmsWindowMs: 1 });
    tracker.push(sineBuffer(0.25), 0);
    // 0.05 dB below the first push — inside LEVEL_EPSILON_DB, so the push is suppressed.
    const nudged = sineBuffer(0.25 * Math.pow(10, -0.05 / 20));
    expect(tracker.push(nudged, 16.67)).toBeNull();

    // The suppressed value is what `last` must report: the guard exists to skip a REDRAW, not
    // to make the tracker forget what it just measured.
    expect(tracker.last.peakDbfs).toBeCloseTo(-12.0912, 3);
  });

  test('the ring buffer is at least one slot even for an absurd window', () => {
    const tracker = createLevelTracker({ tickIntervalMs: 1000, rmsWindowMs: 1 });
    const level = tracker.push(sineBuffer(1), 0);

    expect(level).not.toBeNull();
    expect(level!.rmsDbfs).toBeCloseTo(-3.0103, 3);
  });
});

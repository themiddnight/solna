import { describe, expect, test } from 'bun:test';
import {
  DRAG_RANGE_PX,
  MIN_ANGLE_DEG,
  PROGRESS_ARC_UNITS,
  SIZE_PX,
  SWEEP_DEG,
  angleForT,
  clamp,
  detentAngle,
  dragDeltaT,
  progressDash,
  snapToStep,
  tToValue,
  valueToT,
} from './knob';

describe('clamp', () => {
  test('clamps below min', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
  });

  test('clamps above max', () => {
    expect(clamp(2, 0, 1)).toBe(1);
  });

  test('returns in-range values unchanged', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe('snapToStep', () => {
  test('rounds to the nearest multiple of step', () => {
    expect(snapToStep(17, 0, 10)).toBe(20);
    expect(snapToStep(13, 0, 10)).toBe(10);
  });

  test('measures from min, not from zero', () => {
    expect(snapToStep(12, 5, 2)).toBe(13);
  });

  test('is a no-op without a step (undefined or 0)', () => {
    expect(snapToStep(17, 0)).toBe(17);
    expect(snapToStep(17, 0, 0)).toBe(17);
  });
});

describe('linear valueToT / tToValue', () => {
  test('maps endpoints', () => {
    expect(valueToT(0, 0, 1, 'linear')).toBe(0);
    expect(valueToT(1, 0, 1, 'linear')).toBe(1);
    expect(tToValue(0, 0, 1, 'linear')).toBe(0);
    expect(tToValue(1, 0, 1, 'linear')).toBe(1);
  });

  test('roundtrips value → t → value', () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(tToValue(valueToT(v, 0, 1, 'linear'), 0, 1, 'linear')).toBeCloseTo(v, 10);
    }
  });

  test('clamps out-of-range values', () => {
    expect(valueToT(-100, 0, 1, 'linear')).toBe(0);
    expect(valueToT(100, 0, 1, 'linear')).toBe(1);
  });
});

describe('log valueToT / tToValue', () => {
  const min = 50;
  const max = 12000;

  test('maps endpoints logarithmically', () => {
    expect(valueToT(50, min, max, 'log')).toBe(0);
    expect(valueToT(12000, min, max, 'log')).toBe(1);
    expect(tToValue(0, min, max, 'log')).toBe(50);
    expect(tToValue(1, min, max, 'log')).toBe(12000);
  });

  test('t = 0.5 lands on the geometric mean', () => {
    expect(tToValue(0.5, min, max, 'log')).toBeCloseTo(Math.sqrt(min * max), 6);
  });

  test('roundtrips value → t → value', () => {
    for (const v of [50, 100, 1000, 5000, 12000]) {
      expect(tToValue(valueToT(v, min, max, 'log'), min, max, 'log')).toBeCloseTo(v, 6);
    }
  });

  test('equal frequency ratios span equal t distances (log spacing)', () => {
    const low = valueToT(200, min, max, 'log') - valueToT(100, min, max, 'log');
    const high = valueToT(12000, min, max, 'log') - valueToT(6000, min, max, 'log');
    expect(low).toBeCloseTo(high, 10);
  });
});

describe('log mapping falls back to linear when min <= 0', () => {
  test('min = 0 behaves linearly', () => {
    expect(valueToT(0.5, 0, 1, 'log')).toBe(0.5);
    expect(tToValue(0.25, 0, 1, 'log')).toBe(0.25);
  });

  test('negative min behaves linearly', () => {
    expect(valueToT(-5, -10, 10, 'log')).toBe(0.25);
    expect(tToValue(0.75, -10, 10, 'log')).toBe(5);
  });
});

describe('angleForT', () => {
  test('maps t to the 270° sweep (0 → 7:30, 0.5 → 12 o’clock, 1 → 4:30)', () => {
    expect(angleForT(0)).toBe(-135);
    expect(angleForT(0.5)).toBe(0);
    expect(angleForT(1)).toBe(135);
  });

  test('sweep span equals SWEEP_DEG', () => {
    expect(angleForT(1) - angleForT(0)).toBe(SWEEP_DEG);
  });
});

describe('progressDash', () => {
  test('maps t to arc units on a pathLength=100 circle', () => {
    expect(progressDash(0)).toBe(0);
    expect(progressDash(0.5)).toBe(37.5);
    expect(progressDash(1)).toBe(PROGRESS_ARC_UNITS);
  });

  test('needle angle and arc length derive from the same t (invariant)', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const arcTipAngle = MIN_ANGLE_DEG + (progressDash(t) / PROGRESS_ARC_UNITS) * SWEEP_DEG;
      expect(arcTipAngle).toBe(angleForT(t));
    }
  });
});

describe('detentAngle', () => {
  test('returns the needle angle for an in-range detent', () => {
    expect(detentAngle(0, 0, 1, 'linear')).toBe(angleForT(0));
    expect(detentAngle(0.5, 0, 1, 'linear')).toBe(angleForT(0.5));
    expect(detentAngle(1, 0, 1, 'linear')).toBe(angleForT(1));
  });

  test('returns null for detents below min or above max', () => {
    expect(detentAngle(-0.1, 0, 1, 'linear')).toBeNull();
    expect(detentAngle(1.1, 0, 1, 'linear')).toBeNull();
    expect(detentAngle(49, 50, 12000, 'log')).toBeNull();
    expect(detentAngle(12001, 50, 12000, 'log')).toBeNull();
  });

  test('maps log detents through the log curve (geometric mean → 12 o’clock)', () => {
    const mid = Math.sqrt(50 * 12000);
    expect(detentAngle(mid, 50, 12000, 'log')).toBeCloseTo(angleForT(0.5), 9);
  });

  test('boundary detents at exactly min/max are drawn (inclusive bounds)', () => {
    expect(detentAngle(50, 50, 12000, 'log')).toBe(-135);
    expect(detentAngle(12000, 50, 12000, 'log')).toBe(135);
  });
});

describe('dragDeltaT', () => {
  test('full range per DRAG_RANGE_PX', () => {
    expect(dragDeltaT(DRAG_RANGE_PX, false)).toBe(1);
    expect(dragDeltaT(100, false)).toBe(0.5);
  });

  test('shift divides sensitivity by FINE_DRAG_DIVISOR', () => {
    expect(dragDeltaT(100, true)).toBe(0.05);
  });
});

describe('SIZE_PX', () => {
  test('exposes the five Figma sizes', () => {
    expect(SIZE_PX).toEqual({ xs: 22, sm: 36, md: 48, lg: 60, xl: 72 });
  });
});

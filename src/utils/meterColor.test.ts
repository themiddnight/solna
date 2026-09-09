import { describe, expect, test } from 'bun:test';
import { zoneFillClass } from './meterColor';
import { classifyZone, ZONE_GOOD_MAX, ZONE_HOT_MAX, ZONE_TOO_QUIET_MAX } from './meterZones';

describe('zoneFillClass', () => {
  test('names a theme token per zone and never a raw colour', () => {
    expect(zoneFillClass('tooQuiet')).toBe('bg-base-content/30');
    expect(zoneFillClass('good')).toBe('bg-success');
    expect(zoneFillClass('hot')).toBe('bg-warning');
    expect(zoneFillClass('over')).toBe('bg-error');
  });

  // The distinction this file exists to make: a quiet reading is its own answer, not a shorter
  // version of a good one. The segment bar that preceded this could not say that — it shared the
  // success token for `tooQuiet` — and the mixer's meters are read to answer "loud enough?" as
  // much as "too hot?".
  test('a too-quiet reading is neutral, not the same green as a good one', () => {
    expect(zoneFillClass('tooQuiet')).not.toBe(zoneFillClass('good'));
  });

  test('every zone gets its own token, so no two readings look alike', () => {
    const zones = ['tooQuiet', 'good', 'hot', 'over'] as const;
    expect(new Set(zones.map(zoneFillClass)).size).toBe(zones.length);
  });

  // Composed with the classifier, because that pairing IS the meter's colour: the fill reads
  // `zoneFillClass(classifyZone(peakDbfs))` and nothing else derives a colour anywhere. The old
  // segment bar had a second derivation (`segmentTone`, by segment index) which disagreed with
  // this one just below 0 dBFS; there is no second derivation left to drift.
  test('the boundary readings colour the way classifyZone reads them', () => {
    expect(zoneFillClass(classifyZone(-Infinity))).toBe('bg-base-content/30');
    expect(zoneFillClass(classifyZone(ZONE_TOO_QUIET_MAX - 0.1))).toBe('bg-base-content/30');
    expect(zoneFillClass(classifyZone(ZONE_TOO_QUIET_MAX))).toBe('bg-success');
    expect(zoneFillClass(classifyZone(ZONE_GOOD_MAX))).toBe('bg-warning');
    expect(zoneFillClass(classifyZone(ZONE_HOT_MAX))).toBe('bg-error');
    expect(zoneFillClass(classifyZone(0))).toBe('bg-error');
  });
});

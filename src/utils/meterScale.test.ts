import { describe, expect, test } from 'bun:test';
import { dbfsToPercent, METER_SCALE_CEILING_DBFS, METER_TICK_DBFS } from './meterScale';

describe('scale constants', () => {
  test('the ceiling is +6 dBFS, so 0 dBFS is not on the bar edge', () => {
    expect(METER_SCALE_CEILING_DBFS).toBe(6);
  });

  test('the ticks are the two zone edges plus the digital ceiling', () => {
    expect([...METER_TICK_DBFS]).toEqual([-24, -6, 0]);
  });
});

describe('dbfsToPercent breakpoints', () => {
  test('the display floor and everything under it is 0%', () => {
    expect(dbfsToPercent(-60)).toBeCloseTo(0, 10);
    expect(dbfsToPercent(-120)).toBeCloseTo(0, 10);
    expect(dbfsToPercent(-Infinity)).toBeCloseTo(0, 10);
  });

  test('-48 dBFS is the first knee at 5%', () => {
    expect(dbfsToPercent(-48)).toBeCloseTo(5, 10);
  });

  test('-24 dBFS is the second knee at 30%', () => {
    expect(dbfsToPercent(-24)).toBeCloseTo(30, 10);
  });

  test('the ceiling is 100%', () => {
    expect(dbfsToPercent(6)).toBeCloseTo(100, 10);
    expect(dbfsToPercent(12)).toBeCloseTo(100, 10);
    expect(dbfsToPercent(Infinity)).toBeCloseTo(100, 10);
  });
});

describe('dbfsToPercent segment interiors', () => {
  test('the bottom segment is linear from -60..-48 onto 0..5', () => {
    expect(dbfsToPercent(-54)).toBeCloseTo(2.5, 10);
  });

  test('the middle segment is linear from -48..-24 onto 5..30', () => {
    expect(dbfsToPercent(-36)).toBeCloseTo(17.5, 10);
  });

  test('the top segment is linear from -24..+6 onto 30..100', () => {
    expect(dbfsToPercent(-6)).toBeCloseTo(72, 10);
    expect(dbfsToPercent(0)).toBeCloseTo(86, 10);
  });

  test('0 dBFS sits well inside the bar, not on its edge', () => {
    expect(dbfsToPercent(0)).toBeLessThan(100);
    expect(dbfsToPercent(0)).toBeGreaterThan(80);
  });
});

describe('dbfsToPercent shape', () => {
  test('is monotonically non-decreasing across the whole range', () => {
    let previous = -1;
    for (let db = -70; db <= 10; db += 0.25) {
      const percent = dbfsToPercent(db);
      expect(percent).toBeGreaterThanOrEqual(previous);
      previous = percent;
    }
  });

  test('never leaves 0..100', () => {
    for (let db = -200; db <= 60; db += 1) {
      const percent = dbfsToPercent(db);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });

  test('gives the good..over range more travel than the bottom 36 dB', () => {
    const bottom36 = dbfsToPercent(-24) - dbfsToPercent(-60);
    const top30 = dbfsToPercent(6) - dbfsToPercent(-24);
    expect(top30).toBeGreaterThan(bottom36);
  });
});

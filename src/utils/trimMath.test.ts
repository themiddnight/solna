import { describe, expect, test } from 'bun:test';
import { toDbfs, toDecibels } from '@/utils/gainUnits';
import { TARGET_DBFS, TOLERANCE_DB, computeTrimDb, isWithinTolerance } from '@/utils/trimMath';

describe('the contract constants', () => {
  test('TARGET_DBFS is -18, the value the shared contract states', () => {
    expect(TARGET_DBFS).toBe(-18);
  });

  test('TOLERANCE_DB is 3, the value the shared contract states', () => {
    expect(TOLERANCE_DB).toBe(3);
  });
});

describe('computeTrimDb', () => {
  test('a voice measured 6 dB under target needs +6 dB', () => {
    expect(computeTrimDb(toDbfs(-24))).toBe(6);
  });

  test('a voice measured 6 dB over target needs -6 dB', () => {
    expect(computeTrimDb(toDbfs(-12))).toBe(-6);
  });

  test('a voice already at target needs nothing', () => {
    expect(computeTrimDb(toDbfs(-18))).toBe(0);
  });

  test('an explicit target overrides TARGET_DBFS', () => {
    expect(computeTrimDb(toDbfs(-24), toDbfs(-20))).toBe(4);
  });
});

describe('isWithinTolerance', () => {
  test('measured plus its own computed trim always lands, by construction', () => {
    const measured = toDbfs(-31.4);
    expect(isWithinTolerance(measured, computeTrimDb(measured))).toBe(true);
  });

  test('exactly TOLERANCE_DB away is inside the band, not outside it', () => {
    expect(isWithinTolerance(toDbfs(-21), toDecibels(0))).toBe(true);
  });

  test('a hair past TOLERANCE_DB is outside the band', () => {
    expect(isWithinTolerance(toDbfs(-21.01), toDecibels(0))).toBe(false);
  });

  test('a trim that overshoots is caught, not just an undershoot', () => {
    expect(isWithinTolerance(toDbfs(-18), toDecibels(4))).toBe(false);
  });
});

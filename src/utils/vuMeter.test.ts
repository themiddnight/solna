import { describe, expect, test } from 'bun:test';
import { isSegmentActive, vuSegment, VU_SEGMENT_COUNT } from './vuMeter';

describe('vuSegment', () => {
  test('silence lights no segments', () => {
    expect(vuSegment(0)).toBe(0);
  });

  test('full scale lights every segment', () => {
    expect(vuSegment(1)).toBe(VU_SEGMENT_COUNT);
  });

  test('rounds to the nearest segment', () => {
    expect(vuSegment(0.5)).toBe(5);
    expect(vuSegment(0.44)).toBe(4);
    expect(vuSegment(0.46)).toBe(5);
  });

  test('clamps input below zero', () => {
    expect(vuSegment(-0.5)).toBe(0);
    expect(vuSegment(-100)).toBe(0);
  });

  test('clamps input above one', () => {
    expect(vuSegment(1.4)).toBe(VU_SEGMENT_COUNT);
    expect(vuSegment(100)).toBe(VU_SEGMENT_COUNT);
  });

  test('NaN reads as silence rather than propagating', () => {
    expect(vuSegment(Number.NaN)).toBe(0);
  });
});

describe('isSegmentActive', () => {
  test('lights exactly the first `segment` indices', () => {
    expect(isSegmentActive(3, 0)).toBe(true);
    expect(isSegmentActive(3, 2)).toBe(true);
    expect(isSegmentActive(3, 3)).toBe(false);
  });

  test('nothing is lit at zero', () => {
    expect(isSegmentActive(0, 0)).toBe(false);
  });

  test('everything is lit at full scale', () => {
    expect(isSegmentActive(VU_SEGMENT_COUNT, VU_SEGMENT_COUNT - 1)).toBe(true);
  });
});

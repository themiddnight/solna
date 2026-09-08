import { describe, expect, test } from 'bun:test';
import { classifyZone } from './meterZones';
import { isSegmentActive, segmentTone, VU_SEGMENT_COUNT, vuSegment, zoneFillClass } from './vuMeter';

describe('vuSegment', () => {
  test('silence lights no segments', () => {
    expect(vuSegment(-Infinity)).toBe(0);
    expect(vuSegment(-60)).toBe(0);
    expect(vuSegment(-120)).toBe(0);
  });

  test('the scale ceiling lights every segment', () => {
    expect(vuSegment(6)).toBe(VU_SEGMENT_COUNT);
    expect(vuSegment(12)).toBe(VU_SEGMENT_COUNT);
  });

  test('the piecewise knees land where the scale puts them, not on a linear ramp', () => {
    // -48 dBFS is 5% of the track, -24 is 30%, -6 is 72%, 0 is 86%.
    expect(vuSegment(-48)).toBe(1);
    expect(vuSegment(-24)).toBe(3);
    expect(vuSegment(-6)).toBe(7);
    expect(vuSegment(0)).toBe(9);
  });

  test('a linear -60..0 mapping would have put -30 halfway; the piecewise scale does not', () => {
    expect(vuSegment(-30)).toBeLessThan(3);
  });

  test('0 dBFS does not fill the bar, so a clip is still visibly different', () => {
    expect(vuSegment(0)).toBeLessThan(VU_SEGMENT_COUNT);
  });

  test('is monotonic across the range', () => {
    let previous = -1;
    for (let db = -70; db <= 10; db += 0.5) {
      const segment = vuSegment(db);
      expect(segment).toBeGreaterThanOrEqual(previous);
      previous = segment;
    }
  });

  test('NaN reads as silence rather than propagating', () => {
    expect(vuSegment(Number.NaN)).toBe(0);
  });
});

describe('segmentTone', () => {
  test('the low segments are good', () => {
    expect(segmentTone(0)).toBe('good');
    expect(segmentTone(6)).toBe('good');
  });

  test('the segment straddling -6 dBFS is hot', () => {
    expect(segmentTone(7)).toBe('hot');
  });

  test('the top two segments are over, because -1 dBFS sits at 83.7%', () => {
    expect(segmentTone(8)).toBe('over');
    expect(segmentTone(9)).toBe('over');
  });

  test('tones never go backwards as the index rises', () => {
    const rank = { good: 0, hot: 1, over: 2 } as const;
    let previous = -1;
    for (let i = 0; i < VU_SEGMENT_COUNT; i++) {
      const current = rank[segmentTone(i)];
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('vuSegment + segmentTone composed: the known hot/over disagreement', () => {
  // KNOWN ARTEFACT (see segmentTone's doc comment): Math.round quantisation and top-edge tone
  // assignment were written in separate tasks and disagree by half a segment near the knee.
  // This test PINS that disagreement as current behaviour; it does not endorse it, and it must
  // not be "fixed" by changing vuSegment's rounding (see the task's Finding 1 / DEV-389).

  test('-1 dBFS classifies as over, but rounds to a top segment that still paints hot', () => {
    expect(classifyZone(-1)).toBe('over');
    const segments = vuSegment(-1);
    expect(segments).toBe(8);
    expect(segmentTone(segments - 1)).toBe('hot');
  });

  test('-0.4 dBFS classifies as over, and here the rounding agrees: top segment paints over', () => {
    expect(classifyZone(-0.4)).toBe('over');
    const segments = vuSegment(-0.4);
    expect(segments).toBe(9);
    expect(segmentTone(segments - 1)).toBe('over');
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

describe('zoneFillClass', () => {
  test('names a theme token per zone and never a raw colour', () => {
    expect(zoneFillClass('tooQuiet')).toBe('bg-success');
    expect(zoneFillClass('good')).toBe('bg-success');
    expect(zoneFillClass('hot')).toBe('bg-warning');
    expect(zoneFillClass('over')).toBe('bg-error');
  });
});

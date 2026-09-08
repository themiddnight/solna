import { describe, expect, test } from 'bun:test';
import {
  classifyZone,
  ZONE_GOOD_MAX,
  ZONE_HOT_MAX,
  ZONE_TOO_QUIET_MAX,
} from './meterZones';

describe('zone constants', () => {
  test('are the contract values and nothing else', () => {
    expect(ZONE_TOO_QUIET_MAX).toBe(-24);
    expect(ZONE_GOOD_MAX).toBe(-6);
    expect(ZONE_HOT_MAX).toBe(-1);
  });
});

describe('classifyZone', () => {
  test('below -24 is tooQuiet', () => {
    expect(classifyZone(-60)).toBe('tooQuiet');
    expect(classifyZone(-24.0001)).toBe('tooQuiet');
    expect(classifyZone(-Infinity)).toBe('tooQuiet');
  });

  test('-24 itself is already good — the boundary is inclusive upward', () => {
    expect(classifyZone(-24)).toBe('good');
  });

  test('-24 up to -6 is good', () => {
    expect(classifyZone(-18)).toBe('good');
    expect(classifyZone(-6.0001)).toBe('good');
  });

  test('-6 itself is already hot', () => {
    expect(classifyZone(-6)).toBe('hot');
  });

  test('-6 up to -1 is hot', () => {
    expect(classifyZone(-3)).toBe('hot');
    expect(classifyZone(-1.0001)).toBe('hot');
  });

  test('-1 and above is over, which is only reachable with a pre-limiter tap', () => {
    expect(classifyZone(-1)).toBe('over');
    expect(classifyZone(0)).toBe('over');
    expect(classifyZone(3)).toBe('over');
  });
});

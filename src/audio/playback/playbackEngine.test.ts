import { describe, expect, test } from 'bun:test';
import { HARD_STOP_RELEASE, outputLatencySec } from './playbackEngine';

describe('HARD_STOP_RELEASE', () => {
  test('is 20 ms — instant to the ear, long enough not to click', () => {
    expect(HARD_STOP_RELEASE).toBe(0.02);
  });

  test('is shorter than playbackStopSource\'s soft-stop default of 0.1 s', () => {
    expect(HARD_STOP_RELEASE).toBeLessThan(0.1);
  });
});

describe('outputLatencySec', () => {
  test('prefers outputLatency when the browser reports one', () => {
    expect(outputLatencySec({ outputLatency: 0.03, baseLatency: 0.01 })).toBe(0.03);
  });

  test('falls back to baseLatency where outputLatency is unimplemented', () => {
    expect(outputLatencySec({ outputLatency: 0, baseLatency: 0.011 })).toBe(0.011);
    expect(outputLatencySec({ baseLatency: 0.011 })).toBe(0.011);
  });

  test('is 0, never NaN, with no numbers and with no context at all', () => {
    // 0 biases a recorded note by a few ms; NaN would send it to no column
    // at all, so the floor matters more than the precision.
    expect(outputLatencySec({})).toBe(0);
    expect(outputLatencySec(null)).toBe(0);
    expect(outputLatencySec(undefined)).toBe(0);
  });
});

import { describe, expect, test } from 'bun:test';
import { HARD_STOP_RELEASE } from './playbackEngine';

describe('HARD_STOP_RELEASE', () => {
  test('is 20 ms — instant to the ear, long enough not to click', () => {
    expect(HARD_STOP_RELEASE).toBe(0.02);
  });

  test('is shorter than playbackStopSource\'s soft-stop default of 0.1 s', () => {
    expect(HARD_STOP_RELEASE).toBeLessThan(0.1);
  });
});

import { describe, expect, test } from 'bun:test';
import { playTargetLabel } from './transportAction';

describe('playTargetLabel', () => {
  test('names the arrangement on the song layer', () => {
    expect(playTargetLabel('song', 'Loop 2')).toBe('Song');
  });

  test('names the loop being edited on the loop layer', () => {
    expect(playTargetLabel('loop', 'Loop 2')).toBe('Loop 2');
  });

  test('falls back to a generic word rather than rendering an empty label', () => {
    expect(playTargetLabel('loop', '')).toBe('Loop');
  });
});

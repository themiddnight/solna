import { describe, expect, test } from 'bun:test';
import { SCALES } from '@/data/scales';
import { resolveScaleKey, scaleEntry } from './scale';

describe('resolveScaleKey', () => {
  test('echoes a known scale type', () => {
    expect(resolveScaleKey('Minor Pentatonic')).toBe('Minor Pentatonic');
  });

  test('falls back to Major for an unrecognized scale type', () => {
    expect(resolveScaleKey('not-a-scale')).toBe('Major');
    expect(resolveScaleKey('')).toBe('Major');
  });
});

describe('scaleEntry', () => {
  test('returns the SCALES entry for a known scale type', () => {
    expect(scaleEntry('Minor Pentatonic')).toBe(SCALES['Minor Pentatonic']);
  });

  test('returns the Major entry for an unrecognized scale type', () => {
    expect(scaleEntry('not-a-scale')).toBe(SCALES['Major']);
  });
});

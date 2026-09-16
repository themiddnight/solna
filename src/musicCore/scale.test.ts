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

  test('falls back to Major for an inherited Object.prototype key rather than resolving it as a scale', () => {
    // A truthy `SCALES[scaleType]` check would pass for these — `SCALES['constructor']` is
    // the real `Object` constructor, which is truthy but not a ScaleDefinition.
    expect(resolveScaleKey('constructor')).toBe('Major');
    expect(resolveScaleKey('toString')).toBe('Major');
    expect(resolveScaleKey('__proto__')).toBe('Major');
    expect(resolveScaleKey('hasOwnProperty')).toBe('Major');
  });
});

describe('scaleEntry', () => {
  test('returns the SCALES entry for a known scale type', () => {
    expect(scaleEntry('Minor Pentatonic')).toBe(SCALES['Minor Pentatonic']);
  });

  test('returns the Major entry for an unrecognized scale type', () => {
    expect(scaleEntry('not-a-scale')).toBe(SCALES['Major']);
  });

  test('returns the Major entry, not the inherited property, for an Object.prototype key', () => {
    expect(scaleEntry('constructor')).toBe(SCALES['Major']);
    expect(scaleEntry('constructor').intervals).toEqual(SCALES['Major'].intervals);
    expect(scaleEntry('toString').intervals).toEqual(SCALES['Major'].intervals);
  });
});

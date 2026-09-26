import { describe, expect, test } from 'bun:test';
import { SCALES } from '@/data/scales';
import { SCALE_LIBRARY, harmonyKey, resolveScaleKey, scaleEntry } from './scale';
import { scaleSemitonesForTonal } from './tonalAdapter';

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

describe('SCALE_LIBRARY', () => {
  test('has exactly the SCALES keys, in the same order', () => {
    expect(Object.keys(SCALE_LIBRARY)).toEqual(Object.keys(SCALES));
  });

  test('each entry is its SCALES definition plus the intervals its tonal name derives', () => {
    for (const [key, definition] of Object.entries(SCALES)) {
      const { intervals, ...rest } = SCALE_LIBRARY[key];
      expect(rest, key).toEqual(definition);
      expect(intervals, key).toEqual(scaleSemitonesForTonal(definition.tonal));
    }
  });

  test('is frozen, entries and interval arrays included', () => {
    expect(Object.isFrozen(SCALE_LIBRARY)).toBe(true);
    expect(Object.isFrozen(SCALE_LIBRARY['Major'])).toBe(true);
    expect(Object.isFrozen(SCALE_LIBRARY['Major'].intervals)).toBe(true);
  });
});

describe('scaleEntry', () => {
  test('returns the resolved library entry for a known scale type', () => {
    expect(scaleEntry('Minor Pentatonic')).toBe(SCALE_LIBRARY['Minor Pentatonic']);
    expect(scaleEntry('Minor Pentatonic').intervals).toEqual([0, 3, 5, 7, 10]);
  });

  test('returns the Major entry for an unrecognized scale type', () => {
    expect(scaleEntry('not-a-scale')).toBe(SCALE_LIBRARY['Major']);
  });

  // A display name or a tonal scale name is not a key, even when it names a
  // real scale: it falls back like any unknown string, never half-resolves.
  test('returns the Major entry for a display name or a tonal name', () => {
    for (const notAKey of ['Minor Blues', 'Locrian ♯2', 'vietnamese 1', 'major pentatonic']) {
      expect(scaleEntry(notAKey), notAKey).toBe(SCALE_LIBRARY['Major']);
    }
  });

  test('returns the Major entry, not the inherited property, for an Object.prototype key', () => {
    expect(scaleEntry('constructor')).toBe(SCALE_LIBRARY['Major']);
    expect(scaleEntry('constructor').intervals).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleEntry('toString').intervals).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });
});

describe('harmonyKey', () => {
  test('a scale that names no harmony hosts its own chords', () => {
    expect(harmonyKey('Major')).toBe('Major');
    expect(harmonyKey('Dorian')).toBe('Dorian');
    expect(harmonyKey('Locrian #2')).toBe('Locrian #2');
  });

  // `parent` and `harmony` are different mechanisms: a pentatonic's own
  // degrees host chords, so its harmony key is itself, never its parent.
  test('a parent is not a harmony: a pentatonic keeps its own key', () => {
    expect(harmonyKey('Minor Pentatonic')).toBe('Minor Pentatonic');
    expect(harmonyKey('Hirajoshi')).toBe('Hirajoshi');
  });

  test('falls back to Major exactly like resolveScaleKey', () => {
    for (const notAKey of ['not-a-scale', '', 'constructor', '__proto__', 'Minor Blues']) {
      expect(harmonyKey(notAKey), notAKey).toBe('Major');
    }
  });
});

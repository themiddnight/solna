import { describe, expect, test } from 'bun:test';
import { VIBE_DRUM_PATTERNS, drumPatternById } from './vibeDrumPatterns';

const LIBRARY_IDS = [
  'lofi-half-time-brush',
  'synthwave-four-on-floor',
  'edm-offbeat-pump',
  'ambient-sparse-drift',
  'boombap-swung-break',
  'zen-bamboo-pulse',
];

const ROWS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];

describe('VIBE_DRUM_PATTERNS shape', () => {
  test('holds exactly the six vibe pattern ids', () => {
    expect(Object.keys(VIBE_DRUM_PATTERNS).sort()).toEqual([...LIBRARY_IDS].sort());
  });

  test('every pattern has exactly the seven drum rows, no more and no fewer', () => {
    for (const id of LIBRARY_IDS) {
      expect(Object.keys(VIBE_DRUM_PATTERNS[id]).sort()).toEqual([...ROWS].sort());
    }
  });

  test('every row is exactly 16 steps of literal 0 or 1', () => {
    for (const id of LIBRARY_IDS) {
      for (const row of ROWS) {
        const steps = VIBE_DRUM_PATTERNS[id][row];
        expect(steps.length).toBe(16);
        for (const cell of steps) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
    }
  });
});

describe('drumPatternById', () => {
  test('resolves every library id to a pattern equal to the table entry', () => {
    for (const id of LIBRARY_IDS) {
      expect(drumPatternById(id)).toEqual(VIBE_DRUM_PATTERNS[id]);
    }
  });

  test('returns undefined for an unknown id', () => {
    expect(drumPatternById('no-such-pattern')).toBeUndefined();
    expect(drumPatternById('')).toBeUndefined();
  });

  test('returns a fresh deep copy, so mutating the result cannot reach module state', () => {
    const first = drumPatternById('lofi-half-time-brush')!;
    first.kick[0] = 0;
    first.snare = [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9];

    const second = drumPatternById('lofi-half-time-brush')!;
    expect(second.kick[0]).toBe(1);
    expect(second.snare).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
    expect(VIBE_DRUM_PATTERNS['lofi-half-time-brush'].kick[0]).toBe(1);
  });

  test('never hands back the same array instance twice', () => {
    const first = drumPatternById('zen-bamboo-pulse')!;
    const second = drumPatternById('zen-bamboo-pulse')!;
    expect(first).not.toBe(second);
    expect(first.hihat).not.toBe(second.hihat);
    expect(first.hihat).not.toBe(VIBE_DRUM_PATTERNS['zen-bamboo-pulse'].hihat);
  });
});

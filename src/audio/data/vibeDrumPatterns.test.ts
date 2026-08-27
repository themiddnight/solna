import { describe, expect, test } from 'bun:test';
import { VIBE_DRUM_PATTERNS, VIBE_DRUM_PATTERN_METERS, drumPatternById, drumPatternMeterId } from './vibeDrumPatterns';
import { getMeter } from '../../utils/meter';

const LIBRARY_IDS = [
  'lofi-half-time-brush',
  'synthwave-four-on-floor',
  'edm-offbeat-pump',
  'ambient-sparse-drift',
  'boombap-swung-break',
  'zen-bamboo-pulse',
  'waltz-brush-three',
  'afro-six-eight-bell',
];

const LIBRARY_METERS: Record<string, string> = {
  'lofi-half-time-brush': '4/4',
  'synthwave-four-on-floor': '4/4',
  'edm-offbeat-pump': '4/4',
  'ambient-sparse-drift': '4/4',
  'boombap-swung-break': '4/4',
  'zen-bamboo-pulse': '4/4',
  'waltz-brush-three': '3/4',
  'afro-six-eight-bell': '6/8',
};

const ROWS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];

describe('VIBE_DRUM_PATTERNS shape', () => {
  test('holds exactly the eight vibe pattern ids', () => {
    expect(Object.keys(VIBE_DRUM_PATTERNS).sort()).toEqual([...LIBRARY_IDS].sort());
  });

  test('every pattern has exactly the seven drum rows, no more and no fewer', () => {
    for (const id of LIBRARY_IDS) {
      expect(Object.keys(VIBE_DRUM_PATTERNS[id]).sort()).toEqual([...ROWS].sort());
    }
  });

  test("every row is exactly its own meter's bar length, in literal 0 or 1", () => {
    for (const id of LIBRARY_IDS) {
      const expected = getMeter(drumPatternMeterId(id)).stepsPerBar;
      for (const row of ROWS) {
        const steps = VIBE_DRUM_PATTERNS[id][row];
        expect(steps.length, `${id}/${row}`).toBe(expected);
        for (const cell of steps) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
    }
  });

  test('every library id has the meter it was authored in', () => {
    expect(Object.keys(VIBE_DRUM_PATTERN_METERS).sort()).toEqual([...LIBRARY_IDS].sort());
    for (const id of LIBRARY_IDS) {
      expect(drumPatternMeterId(id), id).toBe(LIBRARY_METERS[id]);
    }
  });

  test('an unknown id reports the default meter rather than undefined', () => {
    expect(drumPatternMeterId('no-such-pattern')).toBe('4/4');
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

describe('the two twelve-step patterns are distinguishable meters, not one pattern twice', () => {
  const on = (id: string, row: string) =>
    VIBE_DRUM_PATTERNS[id][row].map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);

  test('waltz-brush-three is 3/4: one kick, weak beats at 4 and 8', () => {
    expect(on('waltz-brush-three', 'kick')).toEqual([0]);
    expect(on('waltz-brush-three', 'snare')).toEqual([4]);
    expect(on('waltz-brush-three', 'clap')).toEqual([8]);
  });

  test('afro-six-eight-bell is 6/8: kicks on both beats, snare on the pushes', () => {
    expect(on('afro-six-eight-bell', 'kick')).toEqual([0, 6]);
    expect(on('afro-six-eight-bell', 'snare')).toEqual([4, 10]);
  });

  test('their kicks differ, which is the only thing telling the two meters apart', () => {
    expect(on('waltz-brush-three', 'kick')).not.toEqual(on('afro-six-eight-bell', 'kick'));
  });
});

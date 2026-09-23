import { describe, expect, test } from 'bun:test';
import { createDefaultLoop } from './loopSlice';
import type { Loop } from './types';
import { changeKeyAcrossLoops, targetKeyFor, transposeRoot } from './loopKeyChange';

const loop = (id: string, scaleRoot: string, scaleType = 'Natural Minor'): Loop =>
  ({ ...createDefaultLoop(), id, scaleRoot, scaleType });

describe('transposeRoot', () => {
  test('shifts through ROOTS and wraps both ways', () => {
    expect(transposeRoot('A', 3)).toBe('C');
    expect(transposeRoot('C', -1)).toBe('B');
    expect(transposeRoot('G', 14)).toBe('A');
    expect(transposeRoot('E', 1)).toBe('F');
    expect(transposeRoot('A', 1)).toBe('A#'); // ROOTS spelling, never Bb
  });
  test('an unknown root is null, not a guess', () => {
    expect(transposeRoot('Bb', 1)).toBeNull();
  });
});

describe('targetKeyFor', () => {
  test('set gives every loop the same key', () => {
    expect(targetKeyFor(loop('a', 'E', 'Dorian'), { mode: 'set', root: 'C', scaleType: 'Major' }))
      .toEqual({ root: 'C', scaleType: 'Major' });
  });
  test('transpose moves the root and keeps the loop’s own scale type', () => {
    expect(targetKeyFor(loop('a', 'E', 'Dorian'), { mode: 'transpose', semitones: 2 }))
      .toEqual({ root: 'F#', scaleType: 'Dorian' });
  });
  test('a loop already in its target key, or with an unreadable root, is null', () => {
    expect(targetKeyFor(loop('a', 'C', 'Major'), { mode: 'set', root: 'C', scaleType: 'Major' })).toBeNull();
    expect(targetKeyFor(loop('a', 'E'), { mode: 'transpose', semitones: 12 })).toBeNull();
    expect(targetKeyFor(loop('a', 'Bb'), { mode: 'transpose', semitones: 1 })).toBeNull();
  });
});

describe('changeKeyAcrossLoops', () => {
  const loops = [loop('a', 'A'), loop('b', 'C', 'Major'), loop('c', 'E')];

  test('changes only the selected loops and keeps the others by reference', () => {
    const { loops: next, changed } = changeKeyAcrossLoops(
      loops, ['a', 'c'], { mode: 'set', root: 'D', scaleType: 'Dorian' }, { harmonizeChords: true },
    );
    expect(next[0].scaleRoot).toBe('D');
    expect(next[0].scaleType).toBe('Dorian');
    expect(next[1]).toBe(loops[1]);
    expect(next[2].scaleRoot).toBe('D');
    expect(changed.map((s) => s.loopId)).toEqual(['a', 'c']);
  });

  test('snapshots the pre-change key fields only', () => {
    const { changed } = changeKeyAcrossLoops(loops, ['a'], { mode: 'transpose', semitones: 3 }, { harmonizeChords: true });
    expect(changed[0].content).toEqual({
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
      chords: loops[0].chords,
      leadMelodySteps: loops[0].leadMelodySteps,
      fxMelodySteps: loops[0].fxMelodySteps,
    });
  });

  test('unknown ids and loops already in the target key are skipped', () => {
    const { loops: next, changed } = changeKeyAcrossLoops(
      loops, ['b', 'ghost'], { mode: 'set', root: 'C', scaleType: 'Major' }, { harmonizeChords: true },
    );
    expect(next[1]).toBe(loops[1]);
    expect(changed).toEqual([]);
  });

  test('a transpose by a multiple of 12 changes nothing', () => {
    expect(changeKeyAcrossLoops(loops, ['a', 'b', 'c'], { mode: 'transpose', semitones: 12 }, { harmonizeChords: true }).changed)
      .toEqual([]);
  });

  test('harmonizeChords: false leaves every chord list by reference', () => {
    const { loops: next } = changeKeyAcrossLoops(loops, ['a'], { mode: 'transpose', semitones: 2 }, { harmonizeChords: false });
    expect(next[0].chords).toBe(loops[0].chords);
  });

  test('harmonizeChords: true moves the chords with the key', () => {
    const { loops: next } = changeKeyAcrossLoops(loops, ['a'], { mode: 'transpose', semitones: 2 }, { harmonizeChords: true });
    expect(next[0].chords[0].root).not.toBe(loops[0].chords[0].root);
  });
});

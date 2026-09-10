import { describe, expect, test } from 'bun:test';
import { heldCountFor, heldNotesFor, noteTargetFor } from './heldNotes';
import type { HeldNoteTargets } from './heldNotes';
import type { SynthControlTarget } from '@/utils/synthControl';

function held(...entries: [string, SynthControlTarget][]): HeldNoteTargets {
  return new Map<string, SynthControlTarget>(entries);
}

describe('noteTargetFor', () => {
  test('returns the bus the note was played on', () => {
    expect(noteTargetFor(held(['C4', 'synth'], ['G4', 'fx']), 'C4')).toBe('synth');
    expect(noteTargetFor(held(['C4', 'synth'], ['G4', 'fx']), 'G4')).toBe('fx');
  });

  test('returns undefined for a note that is not held', () => {
    expect(noteTargetFor(held(['C4', 'synth']), 'D4')).toBeUndefined();
  });

  test('a note captured on one bus keeps naming that bus after focus moves', () => {
    // The map IS the capture: nothing about a later focus change touches it,
    // which is the whole point — a release recomputed from the current focus
    // would land on a bus the voice was never on and the voice would drone.
    const map = held(['C4', 'synth']);
    // ...focus moves to FX; the next note-on would capture 'fx'...
    map.set('E4', 'fx');
    expect(noteTargetFor(map, 'C4')).toBe('synth');
    expect(noteTargetFor(map, 'E4')).toBe('fx');
  });
});

describe('heldCountFor', () => {
  test('counts one bus only, never the total', () => {
    // Two notes on Lead and two on FX are two buses running two voices each,
    // not one bus running four. A global count would apply a four-voice
    // attenuation to both and every note would quieten the moment a second
    // track was played.
    const map = held(['C4', 'synth'], ['E4', 'synth'], ['G4', 'fx'], ['B4', 'fx']);
    expect(heldCountFor(map, 'synth')).toBe(2);
    expect(heldCountFor(map, 'fx')).toBe(2);
  });

  test('a bus with nothing held counts zero', () => {
    expect(heldCountFor(held(['C4', 'synth']), 'bass')).toBe(0);
    expect(heldCountFor(held(), 'synth')).toBe(0);
  });
});

describe('heldNotesFor', () => {
  test('returns only that bus notes, in insertion order', () => {
    const map = held(['E4', 'synth'], ['G4', 'fx'], ['C4', 'synth']);
    expect(heldNotesFor(map, 'synth')).toEqual(['E4', 'C4']);
    expect(heldNotesFor(map, 'fx')).toEqual(['G4']);
  });

  test('returns an empty list for a bus with nothing held', () => {
    expect(heldNotesFor(held(['C4', 'synth']), 'pad')).toEqual([]);
    expect(heldNotesFor(held(), 'synth')).toEqual([]);
  });
});

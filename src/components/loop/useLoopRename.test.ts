import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loopStatePatch } from '@/store/loop';
import { createDefaultLoop } from '@/store/loopSlice';
import { useAppStore } from '@/store/store';
import type { Loop } from '@/store/types';
import { nameToWrite, renameLoop } from './useLoopRename';

const unnamed = { name: '', tempName: 'untitled-1' };
const named = { name: 'Drop', tempName: 'untitled-1' };

describe('nameToWrite', () => {
  // The picker prefills the LABEL, so an unnamed loop shows "untitled-1". A
  // Rename pressed without typing must not promote that app label into the
  // user's permanent name (R282).
  test('the untouched prefill writes nothing, named or not', () => {
    expect(nameToWrite('untitled-1', unnamed)).toBe(null);
    expect(nameToWrite('  untitled-1 ', unnamed)).toBe(null);
    expect(nameToWrite('Drop', named)).toBe(null);
  });

  test('a changed field writes the trimmed value', () => {
    expect(nameToWrite('  Verse ', unnamed)).toBe('Verse');
    expect(nameToWrite('Chorus', named)).toBe('Chorus');
  });

  test('clearing a name is a real value, clearing an unnamed loop is not', () => {
    expect(nameToWrite('', named)).toBe('');
    expect(nameToWrite('   ', named)).toBe('');
    expect(nameToWrite('', unnamed)).toBe(null);
  });

  test('typing the app label over a user name is an explicit choice', () => {
    expect(nameToWrite('untitled-1', named)).toBe('untitled-1');
  });
});

describe('renameLoop', () => {
  const loopA: Loop = { ...createDefaultLoop(), id: 'loop-a', name: '', tempName: 'untitled-1' };
  const loopB: Loop = { ...createDefaultLoop(), id: 'loop-b', name: 'Drop', tempName: 'untitled-2' };
  const loops = [loopA, loopB];

  test('writes the normalised name to the loop it was opened on', () => {
    const writes: Array<[string, string]> = [];
    renameLoop(loops, 'loop-b', '  Chorus ', (id, name) => writes.push([id, name]));
    expect(writes).toEqual([['loop-b', 'Chorus']]);
  });

  test('writes nothing for an unchanged draft', () => {
    const writes: Array<[string, string]> = [];
    renameLoop(loops, 'loop-a', 'untitled-1', (id, name) => writes.push([id, name]));
    renameLoop(loops, 'loop-b', 'Drop', (id, name) => writes.push([id, name]));
    expect(writes).toEqual([]);
  });

  test('writes nothing when the loop is gone', () => {
    const writes: Array<[string, string]> = [];
    renameLoop(loops, 'loop-zzz', 'Verse', (id, name) => writes.push([id, name]));
    expect(writes).toEqual([]);
  });
});

describe('renaming through the store', () => {
  const reset = () => {
    const loop = createDefaultLoop();
    useAppStore.setState({ loops: [loop], activeLoopId: loop.id, ...loopStatePatch(loop) });
  };
  beforeEach(reset);
  afterEach(reset);

  test('setLoopName gets the new name and the active loop does not change', () => {
    const other: Loop = { ...createDefaultLoop(), id: 'loop-b', name: 'Drop' };
    useAppStore.setState({ loops: [createDefaultLoop(), other] });
    const { loops, activeLoopId, setLoopName } = useAppStore.getState();

    renameLoop(loops, activeLoopId, 'Verse', setLoopName);

    const after = useAppStore.getState();
    expect(after.loops.map((l) => l.name)).toEqual(['Verse', 'Drop']);
    expect(after.activeLoopId).toBe('loop-default-1');
  });
});

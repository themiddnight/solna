import { describe, expect, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { createLoopSlice } from './loopSlice';
import type { AppStore } from './types';

function makeSlice(initial?: Partial<AppStore>) {
  let state = {} as AppStore;
  const set = ((partial: unknown) => {
    const patch =
      typeof partial === 'function' ? (partial as (s: AppStore) => object)(state) : partial;
    state = { ...state, ...(patch as object) } as AppStore;
  }) as StoreApi<AppStore>['setState'];
  const get = (() => state) as StoreApi<AppStore>['getState'];
  state = {
    ...createLoopSlice(set, get),
    // Match the real store's transport default so the song-cursor guard in
    // deleteLoop/reorderLoops behaves identically (null = loop mode).
    songLoopIndex: null,
    ...initial,
  } as AppStore;
  return {
    get state() {
      return state;
    },
  };
}

describe('loopSlice', () => {
  test('starts with one default loop that is active', () => {
    const s = makeSlice().state;
    expect(s.loops).toHaveLength(1);
    expect(s.loops[0].name).toBe('Loop 1');
    expect(s.activeLoopId).toBe(s.loops[0].id);
  });

  test('default loop reproduces the flat slices fixed-width custom pattern grids', () => {
    const loop = makeSlice().state.loops[0];
    expect(loop.customChordRhythm).toHaveLength(MAX_STEPS_PER_BAR);
    expect(loop.customChordRhythm).toEqual(
      new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    );
    expect(loop.customBassPattern).toHaveLength(MAX_STEPS_PER_BAR);
    expect(loop.customBassPattern).toEqual(
      new Array<'rest'>(MAX_STEPS_PER_BAR).fill('rest'),
    );
  });

  test('addLoop appends a deep copy of the active loop and auto-activates it', () => {
    const h = makeSlice();
    const first = h.state.loops[0];
    const id = h.state.addLoop();
    expect(h.state.loops).toHaveLength(2);
    expect(h.state.activeLoopId).toBe(id);
    const added = h.state.loops[1];
    expect(added.id).toBe(id);
    expect(added.name).toBe('Loop 2');
    expect(added.scaleRoot).toBe(first.scaleRoot);
    expect(added.synthParams).toEqual(first.synthParams);
    expect(added.synthParams).not.toBe(first.synthParams);
    expect(added.chords).not.toBe(first.chords);
  });

  test('duplicateLoop of the active loop inserts a deep clone after it and auto-activates it', () => {
    const h = makeSlice();
    const original = h.state.loops[0];
    const result = h.state.duplicateLoop(original.id);
    expect(result).toBe(null);
    expect(h.state.loops).toHaveLength(2);
    expect(h.state.loops[1].id).toBe(h.state.activeLoopId);
    expect(h.state.loops[1].name).toBe('Loop 2');
    expect(h.state.loops[1].scaleRoot).toBe(original.scaleRoot);
    expect(h.state.loops[1].chords).not.toBe(original.chords);
  });

  test('duplicateLoop of a non-active loop returns the clone id for the caller to load', () => {
    const h = makeSlice();
    h.state.addLoop(); // active is now loop 2
    const firstId = h.state.loops[0].id;
    const cloneId = h.state.duplicateLoop(firstId);
    expect(cloneId).not.toBe(null);
    expect(h.state.loops).toHaveLength(3);
    expect(h.state.loops[1].id).toBe(cloneId); // right after the original, not at the end
    expect(h.state.activeLoopId).not.toBe(cloneId);
  });

  test('deleteLoop of the active loop returns a fallback id and activates it', () => {
    const h = makeSlice();
    const first = h.state.loops[0];
    h.state.addLoop(); // loop 2 active
    const secondId = h.state.loops[1].id;
    const fallback = h.state.deleteLoop(secondId);
    expect(fallback).toBe(first.id);
    expect(h.state.loops).toHaveLength(1);
    expect(h.state.activeLoopId).toBe(first.id);
  });

  test('deleteLoop of a non-active loop leaves the active loop alone', () => {
    const h = makeSlice();
    h.state.addLoop();
    const firstId = h.state.loops[0].id;
    const activeId = h.state.activeLoopId;
    const result = h.state.deleteLoop(firstId);
    expect(result).toBe(null);
    expect(h.state.loops).toHaveLength(1);
    expect(h.state.activeLoopId).toBe(activeId);
  });

  test('the last loop cannot be deleted', () => {
    const h = makeSlice();
    const id = h.state.loops[0].id;
    expect(h.state.deleteLoop(id)).toBe(null);
    expect(h.state.loops).toHaveLength(1);
  });

  test('reorderLoops moves a loop up and down, and no-ops off the edge', () => {
    const h = makeSlice();
    h.state.addLoop();
    h.state.addLoop();
    const ids = h.state.loops.map((r) => r.id);
    h.state.reorderLoops(ids[0], 1);
    expect(h.state.loops.map((r) => r.id)).toEqual([ids[1], ids[0], ids[2]]);
    h.state.reorderLoops(ids[0], -1);
    expect(h.state.loops.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);
    h.state.reorderLoops(ids[0], -1); // off the top edge
    expect(h.state.loops.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);
  });

  test('deleteLoop of a non-active loop re-derives songLoopIndex onto the surviving active loop', () => {
    const h = makeSlice({ songLoopIndex: 1 });
    h.state.addLoop(); // 2 loops, second is active
    const firstId = h.state.loops[0].id;
    const secondId = h.state.loops[1].id;
    expect(h.state.activeLoopId).toBe(secondId);
    expect(h.state.songLoopIndex).toBe(1);

    const result = h.state.deleteLoop(firstId);
    expect(result).toBe(null);
    expect(h.state.loops).toHaveLength(1);
    expect(h.state.activeLoopId).toBe(secondId);
    expect(h.state.songLoopIndex).toBe(0);
  });

  test('deleteLoop of the active loop re-derives songLoopIndex onto the fallback', () => {
    const h = makeSlice({ songLoopIndex: 2 });
    h.state.addLoop();
    h.state.addLoop(); // 3 loops, active = loops[2]
    const ids = h.state.loops.map((r) => r.id);
    expect(h.state.activeLoopId).toBe(ids[2]);
    expect(h.state.songLoopIndex).toBe(2);

    const fallback = h.state.deleteLoop(ids[2]); // delete active (last)
    expect(fallback).toBe(ids[1]);
    expect(h.state.loops).toHaveLength(2);
    expect(h.state.activeLoopId).toBe(ids[1]);
    expect(h.state.songLoopIndex).toBe(1);
  });

  test('reorderLoops keeps songLoopIndex on the active loop after the move', () => {
    const h = makeSlice({ songLoopIndex: 2 });
    h.state.addLoop();
    h.state.addLoop(); // 3 loops, active = loops[2]
    const ids = h.state.loops.map((r) => r.id);
    expect(h.state.activeLoopId).toBe(ids[2]);
    expect(h.state.songLoopIndex).toBe(2);

    h.state.reorderLoops(ids[2], -1); // move the active loop up one slot

    expect(h.state.loops.map((r) => r.id)).toEqual([ids[0], ids[2], ids[1]]);
    expect(h.state.activeLoopId).toBe(ids[2]);
    expect(h.state.songLoopIndex).toBe(1);
  });

  test('deleteLoop and reorderLoops leave songLoopIndex null outside song mode', () => {
    const h = makeSlice();
    h.state.addLoop();
    h.state.addLoop();
    const firstId = h.state.loops[0].id;
    expect(h.state.songLoopIndex).toBe(null);

    h.state.deleteLoop(firstId);
    expect(h.state.songLoopIndex).toBe(null);

    h.state.reorderLoops(h.state.loops[0].id, 1);
    expect(h.state.songLoopIndex).toBe(null);
  });

  test('setActiveLoop updates the active id without touching the list', () => {
    const h = makeSlice();
    h.state.addLoop();
    const secondId = h.state.loops[1].id;
    h.state.setActiveLoop(secondId);
    expect(h.state.activeLoopId).toBe(secondId);
    expect(h.state.loops).toHaveLength(2);
  });

  test('setLoopMix on the active loop mirrors onto the flat slices', () => {
    const h = makeSlice();
    const id = h.state.activeLoopId;
    h.state.setLoopMix(id, { synthVolume: 0.25, chordMuted: true });
    expect(h.state.loops[0].synthVolume).toBe(0.25);
    expect(h.state.loops[0].chordMuted).toBe(true);
    // engineSync reads the flat fields, so the mirror keeps the edit audible live.
    expect(h.state.synthVolume).toBe(0.25);
    expect(h.state.chordMuted).toBe(true);
  });

  test('setLoopMix on a non-active loop edits loops only', () => {
    const h = makeSlice();
    h.state.addLoop(); // active is now loop 2
    const firstId = h.state.loops[0].id;
    h.state.setLoopMix(firstId, { bassVolume: 0.1, drumMuted: true });
    expect(h.state.loops[0].bassVolume).toBe(0.1);
    expect(h.state.loops[0].drumMuted).toBe(true);
    // The non-active edit must not touch the flat slices (the live sound)...
    expect(h.state.bassVolume).toBeUndefined();
    expect(h.state.drumMuted).toBeUndefined();
    // ...nor the active loop's copy.
    expect(h.state.loops[1].bassVolume).toBe(1.0);
    expect(h.state.loops[1].drumMuted).toBe(false);
  });

  test('setLoopName updates the name of the specified loop', () => {
    const h = makeSlice();
    const id = h.state.loops[0].id;
    h.state.setLoopName(id, 'Intro Verse');
    expect(h.state.loops[0].name).toBe('Intro Verse');
  });

  test('reorderLoopsArray replaces the loop array and maintains songLoopIndex', () => {
    const h = makeSlice({ songLoopIndex: 0 });
    h.state.addLoop(); // loop 1 (idx 0), loop 2 (idx 1, active)
    const [l1, l2] = h.state.loops;
    h.state.setActiveLoop(l1.id);
    h.state.reorderLoopsArray([l2, l1]);
    expect(h.state.loops.map((r) => r.id)).toEqual([l2.id, l1.id]);
    expect(h.state.songLoopIndex).toBe(1); // l1 is now at index 1
  });
});

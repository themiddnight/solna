import { describe, expect, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { createRegionSlice } from './regionSlice';
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
    ...createRegionSlice(set, get),
    // Match the real store's transport default so the song-cursor guard in
    // deleteRegion/reorderRegions behaves identically (null = loop mode).
    songRegionIndex: null,
    ...initial,
  } as AppStore;
  return {
    get state() {
      return state;
    },
  };
}

describe('regionSlice', () => {
  test('starts with one default region that is active', () => {
    const s = makeSlice().state;
    expect(s.regions).toHaveLength(1);
    expect(s.regions[0].name).toBe('Region 1');
    expect(s.activeRegionId).toBe(s.regions[0].id);
  });

  test('default region reproduces the flat slices fixed-width custom pattern grids', () => {
    const region = makeSlice().state.regions[0];
    expect(region.customChordRhythm).toHaveLength(MAX_STEPS_PER_BAR);
    expect(region.customChordRhythm).toEqual(
      new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    );
    expect(region.customBassPattern).toHaveLength(MAX_STEPS_PER_BAR);
    expect(region.customBassPattern).toEqual(
      new Array<'rest'>(MAX_STEPS_PER_BAR).fill('rest'),
    );
  });

  test('addRegion appends a deep copy of the active region and auto-activates it', () => {
    const h = makeSlice();
    const first = h.state.regions[0];
    const id = h.state.addRegion();
    expect(h.state.regions).toHaveLength(2);
    expect(h.state.activeRegionId).toBe(id);
    const added = h.state.regions[1];
    expect(added.id).toBe(id);
    expect(added.name).toBe('Region 2');
    expect(added.scaleRoot).toBe(first.scaleRoot);
    expect(added.synthParams).toEqual(first.synthParams);
    expect(added.synthParams).not.toBe(first.synthParams);
    expect(added.chords).not.toBe(first.chords);
  });

  test('duplicateRegion of the active region inserts a deep clone after it and auto-activates it', () => {
    const h = makeSlice();
    const original = h.state.regions[0];
    const result = h.state.duplicateRegion(original.id);
    expect(result).toBe(null);
    expect(h.state.regions).toHaveLength(2);
    expect(h.state.regions[1].id).toBe(h.state.activeRegionId);
    expect(h.state.regions[1].name).toBe('Region 2');
    expect(h.state.regions[1].scaleRoot).toBe(original.scaleRoot);
    expect(h.state.regions[1].chords).not.toBe(original.chords);
  });

  test('duplicateRegion of a non-active region returns the clone id for the caller to load', () => {
    const h = makeSlice();
    h.state.addRegion(); // active is now region 2
    const firstId = h.state.regions[0].id;
    const cloneId = h.state.duplicateRegion(firstId);
    expect(cloneId).not.toBe(null);
    expect(h.state.regions).toHaveLength(3);
    expect(h.state.regions[1].id).toBe(cloneId); // right after the original, not at the end
    expect(h.state.activeRegionId).not.toBe(cloneId);
  });

  test('deleteRegion of the active region returns a fallback id and activates it', () => {
    const h = makeSlice();
    const first = h.state.regions[0];
    h.state.addRegion(); // region 2 active
    const secondId = h.state.regions[1].id;
    const fallback = h.state.deleteRegion(secondId);
    expect(fallback).toBe(first.id);
    expect(h.state.regions).toHaveLength(1);
    expect(h.state.activeRegionId).toBe(first.id);
  });

  test('deleteRegion of a non-active region leaves the active region alone', () => {
    const h = makeSlice();
    h.state.addRegion();
    const firstId = h.state.regions[0].id;
    const activeId = h.state.activeRegionId;
    const result = h.state.deleteRegion(firstId);
    expect(result).toBe(null);
    expect(h.state.regions).toHaveLength(1);
    expect(h.state.activeRegionId).toBe(activeId);
  });

  test('the last region cannot be deleted', () => {
    const h = makeSlice();
    const id = h.state.regions[0].id;
    expect(h.state.deleteRegion(id)).toBe(null);
    expect(h.state.regions).toHaveLength(1);
  });

  test('reorderRegions moves a region up and down, and no-ops off the edge', () => {
    const h = makeSlice();
    h.state.addRegion();
    h.state.addRegion();
    const ids = h.state.regions.map((r) => r.id);
    h.state.reorderRegions(ids[0], 1);
    expect(h.state.regions.map((r) => r.id)).toEqual([ids[1], ids[0], ids[2]]);
    h.state.reorderRegions(ids[0], -1);
    expect(h.state.regions.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);
    h.state.reorderRegions(ids[0], -1); // off the top edge
    expect(h.state.regions.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);
  });

  test('deleteRegion of a non-active region re-derives songRegionIndex onto the surviving active region', () => {
    const h = makeSlice({ songRegionIndex: 1 });
    h.state.addRegion(); // 2 regions, second is active
    const firstId = h.state.regions[0].id;
    const secondId = h.state.regions[1].id;
    expect(h.state.activeRegionId).toBe(secondId);
    expect(h.state.songRegionIndex).toBe(1);

    const result = h.state.deleteRegion(firstId);
    expect(result).toBe(null);
    expect(h.state.regions).toHaveLength(1);
    expect(h.state.activeRegionId).toBe(secondId);
    expect(h.state.songRegionIndex).toBe(0);
  });

  test('deleteRegion of the active region re-derives songRegionIndex onto the fallback', () => {
    const h = makeSlice({ songRegionIndex: 2 });
    h.state.addRegion();
    h.state.addRegion(); // 3 regions, active = regions[2]
    const ids = h.state.regions.map((r) => r.id);
    expect(h.state.activeRegionId).toBe(ids[2]);
    expect(h.state.songRegionIndex).toBe(2);

    const fallback = h.state.deleteRegion(ids[2]); // delete active (last)
    expect(fallback).toBe(ids[1]);
    expect(h.state.regions).toHaveLength(2);
    expect(h.state.activeRegionId).toBe(ids[1]);
    expect(h.state.songRegionIndex).toBe(1);
  });

  test('reorderRegions keeps songRegionIndex on the active region after the move', () => {
    const h = makeSlice({ songRegionIndex: 2 });
    h.state.addRegion();
    h.state.addRegion(); // 3 regions, active = regions[2]
    const ids = h.state.regions.map((r) => r.id);
    expect(h.state.activeRegionId).toBe(ids[2]);
    expect(h.state.songRegionIndex).toBe(2);

    h.state.reorderRegions(ids[2], -1); // move the active region up one slot

    expect(h.state.regions.map((r) => r.id)).toEqual([ids[0], ids[2], ids[1]]);
    expect(h.state.activeRegionId).toBe(ids[2]);
    expect(h.state.songRegionIndex).toBe(1);
  });

  test('deleteRegion and reorderRegions leave songRegionIndex null outside song mode', () => {
    const h = makeSlice();
    h.state.addRegion();
    h.state.addRegion();
    const firstId = h.state.regions[0].id;
    expect(h.state.songRegionIndex).toBe(null);

    h.state.deleteRegion(firstId);
    expect(h.state.songRegionIndex).toBe(null);

    h.state.reorderRegions(h.state.regions[0].id, 1);
    expect(h.state.songRegionIndex).toBe(null);
  });

  test('setActiveRegion updates the active id without touching the list', () => {
    const h = makeSlice();
    h.state.addRegion();
    const secondId = h.state.regions[1].id;
    h.state.setActiveRegion(secondId);
    expect(h.state.activeRegionId).toBe(secondId);
    expect(h.state.regions).toHaveLength(2);
  });

  test('setRegionMix on the active region mirrors onto the flat slices', () => {
    const h = makeSlice();
    const id = h.state.activeRegionId;
    h.state.setRegionMix(id, { synthVolume: 0.25, chordMuted: true });
    expect(h.state.regions[0].synthVolume).toBe(0.25);
    expect(h.state.regions[0].chordMuted).toBe(true);
    // engineSync reads the flat fields, so the mirror keeps the edit audible live.
    expect(h.state.synthVolume).toBe(0.25);
    expect(h.state.chordMuted).toBe(true);
  });

  test('setRegionMix on a non-active region edits regions only', () => {
    const h = makeSlice();
    h.state.addRegion(); // active is now region 2
    const firstId = h.state.regions[0].id;
    h.state.setRegionMix(firstId, { bassVolume: 0.1, drumMuted: true });
    expect(h.state.regions[0].bassVolume).toBe(0.1);
    expect(h.state.regions[0].drumMuted).toBe(true);
    // The non-active edit must not touch the flat slices (the live sound)...
    expect(h.state.bassVolume).toBeUndefined();
    expect(h.state.drumMuted).toBeUndefined();
    // ...nor the active region's copy.
    expect(h.state.regions[1].bassVolume).toBe(1.0);
    expect(h.state.regions[1].drumMuted).toBe(false);
  });
});

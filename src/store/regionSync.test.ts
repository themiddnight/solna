import { afterEach, describe, expect, test } from 'bun:test';
import { regionStatePatch } from './region';
import { createDefaultRegion } from './regionSlice';
import { loadRegion } from './loadRegion';
import { startRegionSync } from './regionSync';
import { useAppStore } from './store';

// These tests mutate the shared singleton store (regions, the flat per-region
// slices, activeRegionId). bun runs every test file in one process without
// isolation, so a leftover scaleRoot/synthParams would bleed into
// loadRegion.test.ts (which asserts a pristine default store). Restore the
// default baseline after each test so the files stay order-independent.
afterEach(() => {
  const region = createDefaultRegion();
  useAppStore.setState({
    regions: [region],
    activeRegionId: region.id,
    ...regionStatePatch(region),
  });
});

describe('region live-write sync', () => {
  test('a flat per-region edit reaches regions[activeRegionId]', () => {
    const stop = startRegionSync();
    try {
      const id = useAppStore.getState().activeRegionId;
      useAppStore.getState().setScaleRoot('D');
      const region = useAppStore.getState().regions.find((r) => r.id === id)!;
      expect(region.scaleRoot).toBe('D');
    } finally {
      stop();
    }
  });

  test('syncs into the CURRENT active region after a loadRegion switch', () => {
    const stop = startRegionSync();
    try {
      const regionB = { ...createDefaultRegion(), id: 'region-b', name: 'Region B', scaleRoot: 'C' };
      useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
      loadRegion('region-b');
      useAppStore.getState().setScaleRoot('E');
      const region = useAppStore.getState().regions.find((r) => r.id === 'region-b')!;
      expect(region.scaleRoot).toBe('E');
      const regionA = useAppStore.getState().regions.find((r) => r.id === 'region-default-1')!;
      expect(regionA.scaleRoot).toBe('A');
    } finally {
      stop();
    }
  });

  test('an activeRegionId-only change does not rewrite the region', () => {
    const stop = startRegionSync();
    try {
      const regionB = { ...createDefaultRegion(), id: 'region-b', name: 'Region B', scaleRoot: 'C' };
      useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
      loadRegion('region-b');
      useAppStore.getState().setActiveRegion('region-default-1');
      const found = useAppStore.getState().regions.find((r) => r.id === 'region-b')!;
      expect(found.scaleRoot).toBe('C');
    } finally {
      stop();
    }
  });

  test('nested edits (synthParams) sync by reference change', () => {
    const stop = startRegionSync();
    try {
      const id = useAppStore.getState().activeRegionId;
      useAppStore.getState().setSynthParams({ ...useAppStore.getState().synthParams, detune: 42 });
      const region = useAppStore.getState().regions.find((r) => r.id === id)!;
      expect(region.synthParams.detune).toBe(42);
    } finally {
      stop();
    }
  });
});

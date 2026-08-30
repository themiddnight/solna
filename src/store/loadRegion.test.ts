import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { regionStatePatch } from './region';
import { createDefaultRegion } from './regionSlice';
import { loadRegion, LOAD_REGION_RELEASE } from './loadRegion';
import { useAppStore } from './store';
import type { Region } from './types';

// loadRegion mutates the shared singleton store (regions, the flat per-region
// slices, activeRegionId, the player states). bun runs every test file in one
// process without isolation, so a leftover scaleRoot/player state would bleed
// into sibling files that assert a pristine default store. Restore the
// baseline after each test so the suite stays order-independent.
afterEach(() => {
  const region = createDefaultRegion();
  useAppStore.setState({
    regions: [region],
    activeRegionId: region.id,
    ...regionStatePatch(region),
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    songRegionIndex: null,
  });
});

describe('loadRegion', () => {
  test('swaps the flat slices to the target region and updates activeRegionId', () => {
    const regionB: Region = {
      ...createDefaultRegion(),
      id: 'region-b',
      name: 'Region B',
      scaleRoot: 'C',
      chordFeel: 0.1,
      drumMuted: true,
    };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
    expect(useAppStore.getState().scaleRoot).toBe('A');

    loadRegion('region-b');

    const after = useAppStore.getState();
    expect(after.activeRegionId).toBe('region-b');
    expect(after.scaleRoot).toBe('C');
    expect(after.chordFeel).toBe(0.1);
    expect(after.drumMuted).toBe(true);
    expect(after.regions).toHaveLength(2);
    // The target region in regions[] is the source of truth and stays untouched.
    expect(after.regions.find((r) => r.id === 'region-b')?.scaleRoot).toBe('C');
  });

  test('restarts exactly the players that were active before the swap', () => {
    const regionB: Region = { ...createDefaultRegion(), id: 'region-b', name: 'Region B' };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
    useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped' });
    useAppStore.getState().play('sequencer');
    useAppStore.getState().play('chords');

    loadRegion('region-b');

    const after = useAppStore.getState();
    expect(after.sequencerPlayer).toBe('playing');
    expect(after.chordsPlayer).toBe('playing');
    expect(after.leadPlayer).toBe('stopped');
  });

  test('cuts the chord and bass sources during the swap', () => {
    const stopSource = spyOn(audioEngine, 'stopSource');
    try {
      useAppStore.setState({
        regions: [createDefaultRegion(), { ...createDefaultRegion(), id: 'region-b', name: 'B' }],
        activeRegionId: 'region-default-1',
      });
      loadRegion('region-b');
      expect(stopSource).toHaveBeenCalledWith('chord', LOAD_REGION_RELEASE);
      expect(stopSource).toHaveBeenCalledWith('bass', LOAD_REGION_RELEASE);
    } finally {
      stopSource.mockRestore();
    }
  });

  test('is a safe no-op for an unknown id', () => {
    useAppStore.setState({ regions: [createDefaultRegion()], activeRegionId: 'region-default-1', scaleRoot: 'A' });
    loadRegion('region-missing');
    expect(useAppStore.getState().scaleRoot).toBe('A');
    expect(useAppStore.getState().activeRegionId).toBe('region-default-1');
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { INITIAL_CHORDS } from './initialState';
import { createDefaultRegion } from './regionSlice';
import { useAppStore } from './store';
import {
  detachSongPosition,
  enterSongIndex,
  isSongTab,
  nextRegionIndex,
  regionLengthSteps,
  songAdvanceTarget,
  startSongModeSync,
} from './songMode';
import type { Region } from './types';

function shortRegion(id: string, bars: number): Region {
  return {
    ...createDefaultRegion(),
    id,
    name: `Region ${id}`,
    chords: [{ id: `c-${id}`, root: 'C', quality: 'maj', bars, notes: ['C4'] }],
  };
}

describe('song mode pure helpers', () => {
  test('isSongTab is true only for the arrange tab', () => {
    expect(isSongTab('arrange')).toBe(true);
    expect(isSongTab('synth')).toBe(false);
    expect(isSongTab('sequencer')).toBe(false);
    expect(isSongTab('chords')).toBe(false);
    expect(isSongTab('effects')).toBe(false);
  });

  test('detachSongPosition drops the cursor outside the arrange tab', () => {
    expect(detachSongPosition('arrange', 2)).toBe(2);
    expect(detachSongPosition('synth', 2)).toBe(null);
    expect(detachSongPosition('arrange', null)).toBe(null);
  });

  test('regionLengthSteps multiplies bars by stepsPerBar', () => {
    expect(regionLengthSteps([{ bars: 2 }, { bars: 1 }], 16)).toBe(48);
    expect(regionLengthSteps([{ bars: 0 }], 16)).toBe(16);
    expect(regionLengthSteps(INITIAL_CHORDS, 16)).toBe(64);
  });

  test('nextRegionIndex wraps to 0 after the last region', () => {
    expect(nextRegionIndex([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 0)).toBe(1);
    expect(nextRegionIndex([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2)).toBe(0);
  });

  test('enterSongIndex resolves the active region to its list index, defaulting to 0', () => {
    expect(enterSongIndex([{ id: 'a' }, { id: 'b' }], 'b')).toBe(1);
    expect(enterSongIndex([{ id: 'a' }], 'missing')).toBe(0);
  });

  test('songAdvanceTarget returns the next region id exactly on the boundary', () => {
    const regions = [shortRegion('a', 4), shortRegion('b', 2)];
    expect(songAdvanceTarget(regions, 0, 63, 16)).toBe(null);
    expect(songAdvanceTarget(regions, 0, 64, 16)).toBe('b');
    expect(songAdvanceTarget(regions, 1, 32, 16)).toBe('a'); // wraps
    expect(songAdvanceTarget(regions, 1, 31, 16)).toBe(null);
  });

  test('songAdvanceTarget ignores step 0, loop mode and an out-of-range cursor', () => {
    const regions = [shortRegion('a', 4)];
    expect(songAdvanceTarget(regions, null, 64, 16)).toBe(null);
    expect(songAdvanceTarget(regions, 0, 0, 16)).toBe(null);
    expect(songAdvanceTarget(regions, 99, 64, 16)).toBe(null);
  });

  test('songAdvanceTarget does not reload the sole region of a single-region arrangement', () => {
    const regions = [shortRegion('a', 4)];
    // Wrapping onto itself would hard-stop and reset the clock every loop; the
    // single-region song must just loop in place like loop mode.
    expect(songAdvanceTarget(regions, 0, 64, 16)).toBe(null);
  });

  test('songAdvanceTarget dwells an empty region one bar then advances', () => {
    const empty: Region = {
      ...createDefaultRegion(),
      id: 'empty',
      name: 'Empty',
      chords: [],
    };
    const regions = [empty, shortRegion('b', 1)];
    expect(songAdvanceTarget(regions, 0, 0, 16)).toBe(null); // step 0
    expect(songAdvanceTarget(regions, 0, 15, 16)).toBe(null); // mid-bar
    expect(songAdvanceTarget(regions, 0, 16, 16)).toBe('b'); // after one bar of silence
  });
});

function makeFakeClock() {
  const cbs: Array<(step: number, beat: number, time: number) => void> = [];
  return {
    get count() {
      return cbs.length;
    },
    subscribe: (cb: (step: number, beat: number, time: number) => void) => {
      cbs.push(cb);
      return () => {
        const i = cbs.indexOf(cb);
        if (i >= 0) cbs.splice(i, 1);
      };
    },
    tick: (step: number) => {
      for (const cb of [...cbs]) cb(step, step, 0);
    },
  };
}

afterEach(() => {
  useAppStore.setState({
    activeTab: 'synth',
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    songRegionIndex: null,
  });
});

describe('song mode coordinator', () => {
  test('entering song mode loads the first region and subscribes the clock', () => {
    const regionB = { ...createDefaultRegion(), id: 'region-b', name: 'Region B' };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-b' });
    useAppStore.setState({ activeTab: 'arrange', songRegionIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().play('sequencer');

    const s = useAppStore.getState();
    expect(s.songRegionIndex).toBe(0);
    expect(s.activeRegionId).toBe('region-default-1');
    expect(clock.count).toBe(1);
    stop();
  });

  test('advances to the next region at the boundary and wraps to the top', async () => {
    const regionB = {
      ...createDefaultRegion(),
      id: 'region-b',
      name: 'Region B',
      chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 2, notes: ['C4'] }],
    };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songRegionIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().playAll();
    expect(useAppStore.getState().songRegionIndex).toBe(0);

    // The advance is deferred one microtask out of the clock dispatch so the
    // in-flight boundary step never double-fires into the new region.
    // First region is 4 bars x 16 = 64 steps.
    clock.tick(64);
    await Promise.resolve();
    expect(useAppStore.getState().activeRegionId).toBe('region-b');
    expect(useAppStore.getState().songRegionIndex).toBe(1);

    // Second region is 2 bars x 16 = 32 steps; 64 + 32 = 96 wraps to region 0.
    clock.tick(96);
    await Promise.resolve();
    expect(useAppStore.getState().activeRegionId).toBe('region-default-1');
    expect(useAppStore.getState().songRegionIndex).toBe(0);
    stop();
  });

  test('detaches when the tab leaves arrange: cursor drops and the clock unsubscribes', () => {
    useAppStore.setState({ regions: [createDefaultRegion()], activeRegionId: 'region-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songRegionIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    expect(clock.count).toBe(1);

    useAppStore.getState().setActiveTab('synth');
    expect(useAppStore.getState().songRegionIndex).toBe(null);
    expect(clock.count).toBe(0);
    stop();
  });

  test('re-entering song mode restarts from the top of the list', async () => {
    const regionB = { ...createDefaultRegion(), id: 'region-b', name: 'Region B' };
    useAppStore.setState({ regions: [createDefaultRegion(), regionB], activeRegionId: 'region-b' });
    useAppStore.setState({ activeTab: 'arrange', songRegionIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    clock.tick(64);
    await Promise.resolve();
    expect(useAppStore.getState().activeRegionId).toBe('region-b');
    useAppStore.getState().setActiveTab('synth');
    expect(useAppStore.getState().songRegionIndex).toBe(null);

    useAppStore.getState().setActiveTab('arrange');
    useAppStore.getState().play('sequencer');
    expect(useAppStore.getState().songRegionIndex).toBe(0);
    expect(useAppStore.getState().activeRegionId).toBe('region-default-1');
    stop();
  });
});

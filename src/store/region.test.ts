import { describe, expect, test } from 'bun:test';
import { INITIAL_CHORDS, INITIAL_SEQUENCER_TRACKS, INITIAL_SYNTH_PARAMS } from './initialState';
import {
  cloneRegion,
  fallbackActiveId,
  newRegionId,
  nextRegionName,
  regionBars,
  regionStatePatch,
  REGION_FLAT_KEYS,
} from './region';
import type { Region } from './types';

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'region-x',
    name: 'Region X',
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: INITIAL_SYNTH_PARAMS,
    chords: INITIAL_CHORDS.map((c) => ({ ...c })),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: [],
    chordFeel: 0.5,
    chordOctave: 4,
    bassPatternId: 'bass-1',
    bassPatternMode: 'preset',
    customBassPattern: [],
    bassFeel: 0.5,
    bassOctave: 2,
    leadMelodySteps: [[]],
    leadLoopLength: 1,
    sequencerTracks: INITIAL_SEQUENCER_TRACKS.map((t) => ({ ...t, steps: [...t.steps] })),
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 0.7,
    drumFilterType: 'lowpass',
    synthVolume: 1.0,
    synthMuted: false,
    chordVolume: 1.0,
    chordMuted: false,
    bassVolume: 1.0,
    bassMuted: false,
    masterSequencerVolume: 0.8,
    drumMuted: false,
    ...overrides,
  };
}

describe('regionBars', () => {
  test('sums chord bars with a 1-bar default for bar-less chords', () => {
    expect(regionBars([])).toBe(0);
    expect(regionBars([{ bars: 2 }, { bars: 1 }, { bars: 4 }])).toBe(7);
    expect(regionBars([{ bars: 0 }])).toBe(1);
    expect(regionBars([{ bars: undefined }])).toBe(1);
    expect(regionBars(INITIAL_CHORDS)).toBe(4);
  });
});

describe('newRegionId', () => {
  test('produces unique ids with the region- prefix', () => {
    expect(newRegionId().startsWith('region-')).toBe(true);
    expect(newRegionId()).not.toBe(newRegionId());
  });
});

describe('nextRegionName', () => {
  test('picks the next number above the highest Region N', () => {
    expect(nextRegionName([])).toBe('Region 1');
    expect(nextRegionName([makeRegion({ id: 'r1', name: 'Region 1' })])).toBe('Region 2');
    expect(
      nextRegionName([
        makeRegion({ id: 'r1', name: 'Region 1' }),
        makeRegion({ id: 'r3', name: 'Region 3' }),
      ])
    ).toBe('Region 4');
  });
  test('ignores custom names that do not match Region N', () => {
    expect(nextRegionName([makeRegion({ id: 'intro', name: 'Intro' })])).toBe('Region 1');
  });
});

describe('fallbackActiveId', () => {
  test('falls back to the next neighbour, then the previous, then the first', () => {
    const regions = [makeRegion({ id: 'a' }), makeRegion({ id: 'b' }), makeRegion({ id: 'c' })];
    expect(fallbackActiveId(regions, 'a')).toBe('b');
    expect(fallbackActiveId(regions, 'b')).toBe('c');
    expect(fallbackActiveId(regions, 'c')).toBe('b');
    expect(fallbackActiveId([regions[0]], 'a')).toBe('a');
    expect(fallbackActiveId(regions, 'missing')).toBe(null);
  });
});

describe('cloneRegion', () => {
  test('deep-clones nested arrays and objects', () => {
    const region = makeRegion();
    const clone = cloneRegion(region);
    expect(clone).toEqual(region);
    expect(clone).not.toBe(region);
    expect(clone.synthParams).not.toBe(region.synthParams);
    expect(clone.chords).not.toBe(region.chords);
    expect(clone.sequencerTracks).not.toBe(region.sequencerTracks);
    expect(clone.sequencerTracks[0].steps).not.toBe(region.sequencerTracks[0].steps);
  });
});

describe('regionStatePatch', () => {
  test('picks exactly the 31 per-region keys, never id or name', () => {
    const region = makeRegion({ scaleRoot: 'D', drumMuted: true });
    const patch = regionStatePatch(region);
    expect(Object.keys(patch).sort()).toEqual([...REGION_FLAT_KEYS].sort());
    expect(patch.scaleRoot).toBe('D');
    expect(patch.drumMuted).toBe(true);
    expect('id' in patch).toBe(false);
    expect('name' in patch).toBe(false);
  });
  test('works on a flat AppStore-shaped object too', () => {
    const patch = regionStatePatch({ scaleRoot: 'C', chords: INITIAL_CHORDS, id: 'nope' });
    expect(patch.scaleRoot).toBe('C');
    expect('id' in patch).toBe(false);
  });
});

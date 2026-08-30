import { describe, expect, test } from 'bun:test';
import { INITIAL_CHORDS, INITIAL_SEQUENCER_TRACKS, INITIAL_SYNTH_PARAMS } from './initialState';
import {
  cloneLoop,
  fallbackActiveLoopId,
  newLoopId,
  nextLoopName,
  loopBars,
  loopStatePatch,
  LOOP_FLAT_KEYS,
} from './loop';
import type { Loop } from './types';

function makeLoop(overrides: Partial<Loop> = {}): Loop {
  return {
    id: 'loop-x',
    name: 'Loop X',
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

describe('loopBars', () => {
  test('sums chord bars with a 1-bar default for bar-less chords', () => {
    expect(loopBars([])).toBe(0);
    expect(loopBars([{ bars: 2 }, { bars: 1 }, { bars: 4 }])).toBe(7);
    expect(loopBars([{ bars: 0 }])).toBe(1);
    expect(loopBars([{ bars: undefined }])).toBe(1);
    expect(loopBars(INITIAL_CHORDS)).toBe(4);
  });
});

describe('newLoopId', () => {
  test('produces unique ids with the loop- prefix', () => {
    expect(newLoopId().startsWith('loop-')).toBe(true);
    expect(newLoopId()).not.toBe(newLoopId());
  });
});

describe('nextLoopName', () => {
  test('picks the next number above the highest Loop N', () => {
    expect(nextLoopName([])).toBe('Loop 1');
    expect(nextLoopName([makeLoop({ id: 'r1', name: 'Loop 1' })])).toBe('Loop 2');
    expect(
      nextLoopName([
        makeLoop({ id: 'r1', name: 'Loop 1' }),
        makeLoop({ id: 'r3', name: 'Loop 3' }),
      ])
    ).toBe('Loop 4');
  });
  test('ignores custom names that do not match Loop N', () => {
    expect(nextLoopName([makeLoop({ id: 'intro', name: 'Intro' })])).toBe('Loop 1');
  });
});

describe('fallbackActiveLoopId', () => {
  test('falls back to the next neighbour, then the previous, then the first', () => {
    const loops = [makeLoop({ id: 'a' }), makeLoop({ id: 'b' }), makeLoop({ id: 'c' })];
    expect(fallbackActiveLoopId(loops, 'a')).toBe('b');
    expect(fallbackActiveLoopId(loops, 'b')).toBe('c');
    expect(fallbackActiveLoopId(loops, 'c')).toBe('b');
    expect(fallbackActiveLoopId([loops[0]], 'a')).toBe('a');
    expect(fallbackActiveLoopId(loops, 'missing')).toBe(null);
  });
});

describe('cloneLoop', () => {
  test('deep-clones nested arrays and objects', () => {
    const loop = makeLoop();
    const clone = cloneLoop(loop);
    expect(clone).toEqual(loop);
    expect(clone).not.toBe(loop);
    expect(clone.synthParams).not.toBe(loop.synthParams);
    expect(clone.chords).not.toBe(loop.chords);
    expect(clone.sequencerTracks).not.toBe(loop.sequencerTracks);
    expect(clone.sequencerTracks[0].steps).not.toBe(loop.sequencerTracks[0].steps);
  });
});

describe('loopStatePatch', () => {
  test('picks exactly the 31 per-loop keys, never id or name', () => {
    const loop = makeLoop({ scaleRoot: 'D', drumMuted: true });
    const patch = loopStatePatch(loop);
    expect(Object.keys(patch).sort()).toEqual([...LOOP_FLAT_KEYS].sort());
    expect(patch.scaleRoot).toBe('D');
    expect(patch.drumMuted).toBe(true);
    expect('id' in patch).toBe(false);
    expect('name' in patch).toBe(false);
  });
  test('works on a flat AppStore-shaped object too', () => {
    const patch = loopStatePatch({ scaleRoot: 'C', chords: INITIAL_CHORDS, id: 'nope' });
    expect(patch.scaleRoot).toBe('C');
    expect('id' in patch).toBe(false);
  });
});

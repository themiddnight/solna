import { describe, expect, test } from 'bun:test';
import {
  BEATS_PER_BAR,
  beatsPerBarFor,
  getNextChordIndex,
  groupBeats,
  resolveBeatCounter,
  resolveNowNext,
} from './playhead';
import type { ChordItem } from '../types';

const chord = (id: string, root: string, quality: string, bars = 1): ChordItem => ({
  id,
  root,
  quality,
  bars,
  notes: [],
});

describe('getNextChordIndex', () => {
  test('returns the following index', () => {
    expect(getNextChordIndex(0, 4)).toBe(1);
    expect(getNextChordIndex(2, 4)).toBe(3);
  });

  test('wraps at the end of the progression', () => {
    expect(getNextChordIndex(3, 4)).toBe(0);
  });

  test('a single chord is its own next chord', () => {
    expect(getNextChordIndex(0, 1)).toBe(0);
  });

  test('an empty progression has no next chord', () => {
    expect(getNextChordIndex(0, 0)).toBeNull();
  });
});

describe('resolveNowNext', () => {
  const chords = [chord('a', 'C', 'maj7'), chord('b', 'A', 'min7'), chord('c', 'F', 'maj7')];

  test('while playing, now is the playing chord and next follows it', () => {
    expect(resolveNowNext(chords, 1)).toEqual({ now: chords[1], next: chords[2] });
  });

  test('the last chord loops back to the first', () => {
    expect(resolveNowNext(chords, 2)).toEqual({ now: chords[2], next: chords[0] });
  });

  test('while stopped, it previews the start of the progression', () => {
    expect(resolveNowNext(chords, null)).toEqual({ now: chords[0], next: chords[1] });
  });

  test('an out-of-range index is treated as stopped', () => {
    expect(resolveNowNext(chords, 9)).toEqual({ now: chords[0], next: chords[1] });
  });

  test('an empty progression has neither', () => {
    expect(resolveNowNext([], null)).toEqual({ now: null, next: null });
  });

  test('a one-chord progression has no distinct next chord', () => {
    const single = [chord('a', 'C', 'maj7')];
    expect(resolveNowNext(single, 0)).toEqual({ now: single[0], next: null });
  });
});

describe('resolveBeatCounter', () => {
  test('a one-bar chord counts four beats', () => {
    expect(resolveBeatCounter({ playheadBeat: 0, chordStartBeat: 0, bars: 1 })).toEqual({
      totalBeats: BEATS_PER_BAR,
      activeBeat: 0,
    });
  });

  test('counts on past the bar line for a multi-bar chord', () => {
    expect(resolveBeatCounter({ playheadBeat: 6, chordStartBeat: 0, bars: 2 })).toEqual({
      totalBeats: 8,
      activeBeat: 6,
    });
  });

  test('measures from the beat the chord started on, not from zero', () => {
    expect(resolveBeatCounter({ playheadBeat: 13, chordStartBeat: 12, bars: 2 })).toEqual({
      totalBeats: 8,
      activeBeat: 1,
    });
  });

  test('stopped playback lights no beat', () => {
    expect(resolveBeatCounter({ playheadBeat: null, chordStartBeat: 0, bars: 2 })).toEqual({
      totalBeats: 8,
      activeBeat: null,
    });
  });

  test('wraps rather than overflowing when the chord outlives its own length', () => {
    expect(resolveBeatCounter({ playheadBeat: 9, chordStartBeat: 0, bars: 2 })).toEqual({
      totalBeats: 8,
      activeBeat: 1,
    });
  });

  test('a playhead behind the chord start lights no beat', () => {
    expect(resolveBeatCounter({ playheadBeat: 2, chordStartBeat: 8, bars: 1 })).toEqual({
      totalBeats: BEATS_PER_BAR,
      activeBeat: null,
    });
  });

  test('a chord with no bar count still renders one bar', () => {
    expect(resolveBeatCounter({ playheadBeat: null, chordStartBeat: 0, bars: 0 })).toEqual({
      totalBeats: BEATS_PER_BAR,
      activeBeat: null,
    });
  });
});

describe('groupBeats', () => {
  test('groups a single bar', () => {
    expect(groupBeats(4)).toEqual([[0, 1, 2, 3]]);
  });

  test('splits multi-bar counters at the bar line', () => {
    expect(groupBeats(8)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  test('keeps a trailing partial bar', () => {
    expect(groupBeats(6)).toEqual([
      [0, 1, 2, 3],
      [4, 5],
    ]);
  });

  test('no beats means no groups', () => {
    expect(groupBeats(0)).toEqual([]);
  });

  test('a 6/8 bar (2 beats per bar) splits a two-bar counter into two groups of two', () => {
    expect(groupBeats(4, beatsPerBarFor('6/8'))).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  test('a 5/4 bar (5 beats per bar) keeps a whole bar in one group', () => {
    expect(groupBeats(5, beatsPerBarFor('5/4'))).toEqual([[0, 1, 2, 3, 4]]);
  });

  test('4/4 is unchanged: an explicit 4/4 barLength matches the default', () => {
    expect(groupBeats(8, beatsPerBarFor('4/4'))).toEqual(groupBeats(8));
  });
});

describe('beatsPerBarFor', () => {
  test('4/4 keeps the historical four beats per bar', () => {
    expect(beatsPerBarFor('4/4')).toBe(BEATS_PER_BAR);
    expect(beatsPerBarFor('4/4')).toBe(4);
  });

  test('counts accent groups, so 3/4 and 6/8 differ despite equal bar length', () => {
    expect(beatsPerBarFor('3/4')).toBe(3);
    expect(beatsPerBarFor('6/8')).toBe(2);
    expect(beatsPerBarFor('12/8')).toBe(4);
    expect(beatsPerBarFor('5/4')).toBe(5);
    expect(beatsPerBarFor('7/8')).toBe(3);
  });

  test('an unknown id falls back to four', () => {
    expect(beatsPerBarFor('9/8')).toBe(4);
  });
});

describe('resolveBeatCounter with an explicit beatsPerBar', () => {
  test('omitting it preserves the historical four-beat bar exactly', () => {
    expect(resolveBeatCounter({ playheadBeat: 6, chordStartBeat: 0, bars: 2 })).toEqual(
      resolveBeatCounter({ playheadBeat: 6, chordStartBeat: 0, bars: 2, beatsPerBar: 4 }),
    );
  });

  test('a 6/8 chord counts two beats per bar', () => {
    expect(
      resolveBeatCounter({ playheadBeat: 3, chordStartBeat: 0, bars: 2, beatsPerBar: 2 }),
    ).toEqual({ totalBeats: 4, activeBeat: 3 });
  });

  test('a 5/4 chord counts five beats per bar and still wraps', () => {
    expect(
      resolveBeatCounter({ playheadBeat: 7, chordStartBeat: 0, bars: 1, beatsPerBar: 5 }),
    ).toEqual({ totalBeats: 5, activeBeat: 2 });
  });
});

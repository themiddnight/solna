import { describe, expect, test } from 'bun:test';
import { padPlanSnapshot } from './playbackPlanSnapshots';
import type { AppStore } from './types';
import type { ChordItem } from '@/types';

const CHORDS: ChordItem[] = [{ id: 'c1', root: 'C', quality: 'maj', bars: 2 }];

/**
 * A partial store cast to AppStore: the builder reads a fixed, named set of
 * fields, and pinning that set is the whole point — a snapshot that quietly
 * grew a field would otherwise be invisible here.
 */
const STATE = {
  padMode: 'drone',
  chords: CHORDS,
  padDroneDegree: 2,
  padDroneIntervals: [1, 5, 8],
  padOctave: 4,
  padVoicing: 'open5',
  scaleRoot: 'D',
  scaleType: 'minor',
  bpm: 96,
  meterId: '12/8',
} as unknown as AppStore;

describe('padPlanSnapshot', () => {
  test('names every pad field the planner reads, and resolves the meter to stepsPerBar', () => {
    expect(padPlanSnapshot(STATE)).toEqual({
      mode: 'drone',
      chords: CHORDS,
      degree: 2,
      intervals: [1, 5, 8],
      padOctave: 4,
      voicing: 'open5',
      scaleRoot: 'D',
      scaleType: 'minor',
      bpm: 96,
      stepsPerBar: 24, // 12/8
    });
  });

  test('carries no synth patch: the patch is the controller\'s, read when it triggers', () => {
    expect(Object.keys(padPlanSnapshot(STATE))).not.toContain('padSynthParams');
  });
});

import { describe, expect, test } from 'bun:test';
import { planPadArm, type PadPlanSnapshot } from './padPlan';
import { generateBlockChordNotes } from '@/utils/musicTheory';
import type { ChordItem } from '@/types';

/** Two two-bar chords: four bars to the loop, so drone and pad holds differ. */
const CHORDS: ChordItem[] = [
  { id: 'c1', root: 'C', quality: 'maj', bars: 2 },
  { id: 'c2', root: 'F', quality: 'maj', bars: 2 },
];

/** 120 bpm at 16 steps/bar: one step is 0.125 s and one bar is 2 s. */
function snapshot(over: Partial<PadPlanSnapshot> = {}): PadPlanSnapshot {
  return {
    mode: 'pad',
    chords: CHORDS,
    degree: 0,
    intervals: [1, 5],
    padOctave: 3,
    voicing: 'triad',
    scaleRoot: 'C',
    scaleType: 'major',
    bpm: 120,
    stepsPerBar: 16,
    ...over,
  };
}

describe('planPadArm', () => {
  test('pad mode arms every chord and holds for that chord alone', () => {
    const arm = planPadArm(snapshot(), 1);
    expect(arm?.notes).toEqual(generateBlockChordNotes('maj', 'F', 3));
    expect(arm?.holdSec).toBe(4); // 2 bars x 2 s
  });

  test('drone mode arms only at the top of a loop pass, and holds the whole pass', () => {
    const drone = snapshot({ mode: 'drone' });
    expect(planPadArm(drone, 1)).toBeNull();
    const arm = planPadArm(drone, 0);
    // The drone's intervals are FIXED — degree 0 of C major is C, so 1P + 5P.
    expect(arm?.notes).toEqual(['C3', 'G3']);
    expect(arm?.holdSec).toBe(8); // 4 loop bars x 2 s, not the chord's 2
  });

  test('a drone with no intervals arms nothing', () => {
    expect(planPadArm(snapshot({ mode: 'drone', intervals: [] }), 0)).toBeNull();
  });

  test('a chord index outside the progression arms nothing', () => {
    expect(planPadArm(snapshot(), 9)).toBeNull();
  });

  test('is a plain function of its inputs: two calls with the same snapshot agree', () => {
    expect(planPadArm(snapshot(), 0)).toEqual(planPadArm(snapshot(), 0));
  });
});

import { describe, expect, test } from 'bun:test';
import { planChordLane, type ChordPlanSnapshot } from './chordPlan';
import { buildChordEvents } from '../chordPlayback';
import { resolvePlaybackRhythmCycle } from '@/audio/chordRhythms';
import { generateBlockChordNotes, stepDurationSec } from '@/utils/musicTheory';
import type { ChordItem } from '@/types';

const CHORDS: ChordItem[] = [
  { id: 'c1', root: 'C', quality: 'maj', bars: 2 },
  { id: 'c2', root: 'F', quality: 'maj', bars: 2 },
];
/** Two two-bar chords at 16 steps/bar. */
const DURATIONS = [32, 32];
const NOTES = generateBlockChordNotes('maj', 'C', 4);

function snapshot(over: Partial<ChordPlanSnapshot> = {}): ChordPlanSnapshot {
  return {
    chords: CHORDS,
    bpm: 120,
    meterId: '4/4',
    stepsPerBar: 16,
    chordOctave: 4,
    bassOctave: 2,
    scaleRoot: 'C',
    scaleType: 'major',
    chordRhythmMode: 'preset',
    chordRhythmId: 'fourOnFloor',
    customChordRhythm: [],
    customChordHoldSteps: [],
    customChordLoopLength: 1,
    chordFeel: 0.5,
    bassPatternMode: 'preset',
    bassPatternId: 'classic-walk',
    customBassPattern: [],
    customBassHoldSteps: [],
    customBassLoopLength: 1,
    bassFeel: 0.5,
    chordArpActive: false,
    bassArpActive: false,
    ...over,
  };
}

describe('planChordLane', () => {
  test('a per-step preset returns the events buildChordEvents builds, and no full hold', () => {
    const cycle = resolvePlaybackRhythmCycle('preset', 'fourOnFloor', [], [], 1, 16, '4/4', DURATIONS);
    const lane = planChordLane(snapshot(), NOTES, 2);
    expect(lane.fullHold).toBeNull();
    expect(lane.cycleSteps).toBe(cycle.cycleSteps);
    // chordFeel 0.5 -> feelToHoldScale(0.5) === 1, and a preset cycle is not custom.
    expect(lane.events).toEqual(buildChordEvents(cycle.pattern, NOTES, stepDurationSec(120), 1));
  });

  test('a full-hold PRESET returns a descriptor instead of scheduling anything', () => {
    const lane = planChordLane(snapshot({ chordRhythmId: 'sustained' }), NOTES, 2);
    expect(lane.events).toEqual([]);
    // 2 bars x 2 s at 120 bpm / 16 spb, hold scale 1.
    expect(lane.fullHold).toEqual({ notes: NOTES, holdSec: 4 });
  });

  test('an active arp replaces the lane: no cycle is resolved and no event is built', () => {
    const lane = planChordLane(snapshot({ chordArpActive: true, chordRhythmId: 'sustained' }), NOTES, 2);
    expect(lane).toEqual({ cycleSteps: 16, events: [], fullHold: null });
  });

  test('the lane is a plain function of its inputs: two calls agree', () => {
    expect(planChordLane(snapshot(), NOTES, 2)).toEqual(planChordLane(snapshot(), NOTES, 2));
  });
});

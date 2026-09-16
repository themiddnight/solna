import { describe, expect, test } from 'bun:test';
import { chordPlanSnapshot, melodyPlanSnapshot, padPlanSnapshot } from './playbackPlanSnapshots';
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

describe('chordPlanSnapshot', () => {
  const CHORD_STATE = {
    chords: CHORDS,
    bpm: 132,
    meterId: '3/4',
    chordOctave: 4,
    bassOctave: 2,
    scaleRoot: 'A',
    scaleType: 'minor',
    chordRhythmMode: 'custom',
    chordRhythmId: 'fourOnFloor',
    customChordRhythm: [true, false],
    customChordHoldSteps: [4, 0],
    customChordLoopLength: 2,
    chordFeel: 0.7,
    bassPatternMode: 'preset',
    bassPatternId: 'classic-walk',
    customBassPattern: [],
    customBassHoldSteps: [],
    customBassLoopLength: 1,
    bassFeel: 0.3,
    chordArpSettings: { active: true, mode: 'up', rate: '1/8', octaves: 2 },
    bassArpSettings: { active: false, mode: 'up', rate: '1/8', octaves: 1 },
  } as unknown as AppStore;

  test('captures the ARM-time half only, with the arp reduced to its active flag', () => {
    const snap = chordPlanSnapshot(CHORD_STATE);
    expect(snap.stepsPerBar).toBe(12); // 3/4
    expect(snap.chordArpActive).toBe(true);
    expect(snap.bassArpActive).toBe(false);
    expect(snap.chordFeel).toBe(0.7);
    expect(snap.bassFeel).toBe(0.3);
  });

  test('carries no synth patch and no arp SETTINGS object: those are read live per step', () => {
    const keys = Object.keys(chordPlanSnapshot(CHORD_STATE));
    expect(keys).not.toContain('chordSynthParams');
    expect(keys).not.toContain('bassSynthParams');
    expect(keys).not.toContain('chordArpSettings');
    expect(keys).not.toContain('bassArpSettings');
  });

  test('does not swap the chord and bass sides of any per-lane field', () => {
    const snap = chordPlanSnapshot(CHORD_STATE);
    expect(snap.chordOctave).toBe(4);
    expect(snap.bassOctave).toBe(2);
    expect(snap.chordFeel).toBe(0.7);
    expect(snap.bassFeel).toBe(0.3);
    expect(snap.chordRhythmMode).toBe('custom');
    expect(snap.bassPatternMode).toBe('preset');
    expect(snap.chordArpActive).toBe(true);
    expect(snap.bassArpActive).toBe(false);
  });
});

describe('melodyPlanSnapshot', () => {
  const LEAD_STEPS = [[{ note: 'C4', len: 8 }]];
  const FX_STEPS = [[{ note: 'G5', len: 4 }]];
  const STATE = {
    leadMelodySteps: LEAD_STEPS,
    leadLoopLength: 2,
    leadStepResolution: '1/8',
    leadGate: 0.5,
    synthArpSettings: { active: false, mode: 'up', rate: '1/8', octaves: 1 },
    fxMelodySteps: FX_STEPS,
    fxLoopLength: 4,
    fxStepResolution: '1/32',
    fxGate: 0.9,
    fxArpSettings: { active: true, mode: 'down', rate: '1/16', octaves: 2 },
  } as unknown as AppStore;

  test('reads the LEAD row of MELODY_TRACKS', () => {
    expect(melodyPlanSnapshot(STATE, 'lead')).toEqual({
      steps: LEAD_STEPS,
      loopLength: 2,
      stepResolution: '1/8',
      gate: 0.5,
      arp: { active: false, mode: 'up', rate: '1/8', octaves: 1 },
    });
  });

  test('reads the FX row — one builder, two tracks, no hardcoded `lead`', () => {
    expect(melodyPlanSnapshot(STATE, 'fx')).toEqual({
      steps: FX_STEPS,
      loopLength: 4,
      stepResolution: '1/32',
      gate: 0.9,
      arp: { active: true, mode: 'down', rate: '1/16', octaves: 2 },
    });
  });
});

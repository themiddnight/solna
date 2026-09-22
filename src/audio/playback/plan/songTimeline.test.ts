import { describe, expect, test } from 'bun:test';
import { mixdownLoop, mixdownSnapshot } from '@/audio/export/mixdownFixture';
import { planChordArm } from './chordPlan';
import { chordSnapshotForLoop } from './songSnapshot';
import { buildLoopVoices, planArrangement } from './songTimeline';

describe('planArrangement', () => {
  test('one loop, one bar, one repeat is stepsPerBar steps', () => {
    const plan = planArrangement(mixdownSnapshot());
    expect(plan.totalSteps).toBe(16);
    expect(plan.passes).toEqual([
      { loopIndex: 0, startStep: 0, passSteps: 16, dwellSteps: 16 },
    ]);
  });

  test('repeats multiply the dwell, not the pass', () => {
    const plan = planArrangement(
      mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: 3 })] }),
    );
    expect(plan.passes[0]).toEqual({
      loopIndex: 0,
      startStep: 0,
      passSteps: 16,
      dwellSteps: 48,
    });
    expect(plan.totalSteps).toBe(48);
  });

  test('a chordless loop still dwells a whole bar', () => {
    // The spec's edge case: loopDwellSteps floors a loop with no chords at
    // stepsPerBar, matching live playback. A silent BAR in the file, never a
    // skipped loop.
    const plan = planArrangement(
      mixdownSnapshot({ loops: [mixdownLoop({ chords: [] })] }),
    );
    expect(plan.passes[0]).toEqual({
      loopIndex: 0,
      startStep: 0,
      passSteps: 16,
      dwellSteps: 16,
    });
  });

  test('a second loop starts where the first stopped', () => {
    const plan = planArrangement(
      mixdownSnapshot({
        loops: [
          mixdownLoop({ id: 'a', repeatCount: 2 }),
          mixdownLoop({ id: 'b', chords: [{ id: 'c2', root: 'F', quality: 'maj', bars: 2 }] }),
        ],
      }),
    );
    expect(plan.passes[1]).toEqual({
      loopIndex: 1,
      startStep: 32,
      passSteps: 32,
      dwellSteps: 32,
    });
    expect(plan.totalSteps).toBe(64);
  });

  test('repeatCount 0 and absent both floor at one pass', () => {
    const zero = planArrangement(mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: 0 })] }));
    const absent = planArrangement(mixdownSnapshot({ loops: [mixdownLoop({ repeatCount: undefined })] }));
    expect(zero.totalSteps).toBe(16);
    expect(absent.totalSteps).toBe(16);
  });
});

describe('buildLoopVoices', () => {
  test('maps every bar of a pass to the chord that covers it', () => {
    const loop = mixdownLoop({
      chords: [
        { id: 'c1', root: 'C', quality: 'maj', bars: 2 },
        { id: 'c2', root: 'F', quality: 'maj', bars: 1 },
      ],
    });
    const voices = buildLoopVoices(loop, '4/4', 120, 16);
    expect(voices.chordsByBar).toEqual([0, 0, 1]);
    expect(voices.chordStartStep).toEqual([0, 32]);
    expect(voices.plans).toHaveLength(2);
    expect(voices.plans[1].startProgressionStep).toBe(32);
  });

  test('a full-hold rhythm produces no per-step events, only a hold', () => {
    // 'sustained' is the full-hold chord rhythm, 'whole-note-root' the
    // full-hold bass — both short-written in the fixture above.
    const voices = buildLoopVoices(mixdownLoop({ chordRhythmId: 'sustained' }), '4/4', 120, 16);
    expect(voices.plans[0].chordEvents).toEqual([]);
    expect(voices.plans[0].chordFullHold?.holdSec).toBeGreaterThan(0);
    expect(voices.plans[0].bassFullHold).not.toBeNull();
  });

  test('a one-hit rhythm produces per-step events and no hold', () => {
    // 'fourOnFloor' is a real, one-hit, non-full-hold chord rhythm id.
    const voices = buildLoopVoices(mixdownLoop({ chordRhythmId: 'fourOnFloor' }), '4/4', 120, 16);
    expect(voices.plans[0].chordEvents.length).toBeGreaterThan(0);
    expect(voices.plans[0].chordFullHold).toBeNull();
    expect(voices.plans[0].bassFullHold).not.toBeNull();
  });

  test('buildLoopVoices is chordSnapshotForLoop + planChordArm, chord by chord', () => {
    const loop = mixdownLoop({
      chords: [
        { id: 'a', root: 'C', quality: 'maj', bars: 1 },
        { id: 'b', root: 'F', quality: 'maj', bars: 2 },
      ],
    });
    const snapshot = chordSnapshotForLoop(loop, '4/4', 120, 16);
    const voices = buildLoopVoices(loop, '4/4', 120, 16);
    voices.plans.forEach((plan, i) => {
      expect(plan).toEqual(
        planChordArm(snapshot, { chordIndex: i, startProgressionStep: voices.chordStartStep[i] }),
      );
    });
  });
});

import { describe, expect, test } from 'bun:test';
import { withSeededRandom } from '@/audio/rng';
import { pitchClassOfNote, ROOTS } from '@/musicCore';
import { stepDurationSec } from '@/utils/tempo';
import {
  beatMixFixture, beatPatternFixture, mixdownLoop, mixdownMelodyBar, mixdownSnapshot,
} from '@/audio/export/mixdownFixture';
import { planChordArm } from './chordPlan';
import { planBeatStep } from './beatPlan';
import { fullHoldVelocity } from './chordEvents';
import { beatSnapshotForLoop, chordSnapshotForLoop } from './songSnapshot';
import {
  buildLoopVoices, buildSongTimeline, planArrangement, timelineEventTime, walkSongTimeline,
  type SongTimeline, type SongWalkItem, type TimelineEvent,
} from './songTimeline';

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

const STEP = stepDurationSec(120);

function walk(snapshot: ReturnType<typeof mixdownSnapshot>): SongWalkItem[] {
  return [...walkSongTimeline(snapshot, planArrangement(snapshot))];
}
function eventsOf(items: SongWalkItem[]): TimelineEvent[] {
  return items.filter((i): i is TimelineEvent => i.kind === 'note' || i.kind === 'drum');
}
function laneOf(e: TimelineEvent): string {
  return e.kind === 'drum' ? 'drum' : e.track;
}
function busySnapshot() {
  return mixdownSnapshot({
    loops: [
      mixdownLoop({ chordRhythmId: 'fourOnFloor', padMode: 'pad', leadMelodySteps: mixdownMelodyBar('E4') }),
      mixdownLoop({ id: 'loop-2', fxMelodySteps: mixdownMelodyBar('G4') }),
    ],
  });
}

describe('buildSongTimeline: order', () => {
  test('buildSongTimeline events are time-sorted and equal times keep emit order', () => {
    const snap = busySnapshot();
    const { events } = buildSongTimeline(snap);
    for (let i = 1; i < events.length; i += 1) {
      expect(timelineEventTime(events[i])).toBeGreaterThanOrEqual(timelineEventTime(events[i - 1]));
    }
    const atZero = (list: TimelineEvent[]) => list.filter((e) => timelineEventTime(e) === 0).map(laneOf);
    expect(atZero(events)).toEqual(atZero(eventsOf(walk(snap))));
    expect(atZero(events)[0]).toBe('drum');
  });

  test('buildSongTimeline equals the drained walk, stably sorted', () => {
    const snap = busySnapshot();
    const plan = planArrangement(snap);
    const expected = eventsOf(walk(snap))
      .map((e, i) => ({ e, i }))
      .sort((a, b) => timelineEventTime(a.e) - timelineEventTime(b.e) || a.i - b.i)
      .map(({ e }) => e);
    const built: SongTimeline = buildSongTimeline(snap);
    expect(built).toEqual({ totalSteps: plan.totalSteps, passes: plan.passes, events: expected });
  });

  test('the walk yields a pass marker before any event of that pass and a stepEnd after every step', () => {
    const snap = busySnapshot();
    const plan = planArrangement(snap);
    const items = walk(snap);
    expect(items[0]).toEqual({ kind: 'pass', passIndex: 0, pass: plan.passes[0] });
    let pass = -1;
    const stepEnds: number[] = [];
    for (const item of items) {
      if (item.kind === 'pass') pass = item.passIndex;
      else if (item.kind === 'stepEnd') stepEnds.push(item.step);
      else expect(item.loopIndex).toBe(plan.passes[pass].loopIndex);
    }
    expect(stepEnds).toEqual(Array.from({ length: plan.totalSteps }, (_, i) => i));
  });
});

describe('buildSongTimeline: holds and windows', () => {
  test('a full-hold chord is one note per tone spanning holdSec at fullHoldVelocity', () => {
    const loop = mixdownLoop({ chordRhythmId: 'sustained' });
    const hold = buildLoopVoices(loop, '4/4', 120, 16).plans[0].chordFullHold;
    if (!hold) throw new Error('fixture must full-hold');
    const chord = buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events.filter(
      (e) => e.kind === 'note' && e.track === 'chord',
    );
    expect(chord).toEqual(
      hold.notes.map((noteName) => ({
        kind: 'note', track: 'chord', loopIndex: 0, noteName,
        velocity: fullHoldVelocity(hold.notes.length), startSec: 0, endSec: 0 + hold.holdSec,
      })),
    );
  });

  test("a full-hold bass is one note carrying the plan's velocity", () => {
    const loop = mixdownLoop({ bassPatternId: 'whole-note-root' });
    const hold = buildLoopVoices(loop, '4/4', 120, 16).plans[0].bassFullHold;
    if (!hold) throw new Error('fixture must full-hold');
    const bass = buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events.filter(
      (e) => e.kind === 'note' && e.track === 'bass',
    );
    expect(bass).toEqual([{
      kind: 'note', track: 'bass', loopIndex: 0, noteName: hold.noteName,
      velocity: hold.velocity, startSec: 0, endSec: 0 + hold.holdSec,
    }]);
  });

  test('step notes end at min(start + hold, chordEnd), floored 10 ms past their start', () => {
    const snap = mixdownSnapshot({ bpm: 200, loops: [mixdownLoop({ chordRhythmId: 'fourOnFloor' })] });
    const chordEnd = 16 * stepDurationSec(200); // one one-bar chord, pass starts at 0
    const notes = buildSongTimeline(snap).events.filter((e) => e.kind === 'note' && e.track === 'chord');
    expect(notes.length).toBeGreaterThan(0);
    for (const e of notes) {
      if (e.kind !== 'note') continue;
      expect(e.endSec).toBeGreaterThanOrEqual(e.startSec + 0.01);
      expect(e.endSec <= chordEnd || e.endSec === e.startSec + 0.01).toBe(true);
    }
  });
});

describe('buildSongTimeline: lanes', () => {
  test('drum events are planBeatStep at each stepInBar; a muted voice never appears', () => {
    const pattern = structuredClone(beatPatternFixture());
    pattern.rows.snare[4] = true;
    pattern.rows.hihat[2] = true;
    const mix = structuredClone(beatMixFixture());
    mix.voices.snare = { ...mix.voices.snare, muted: true };
    const loop = mixdownLoop({ beatPattern: pattern, beatMix: mix });
    const drums = buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events.filter((e) => e.kind === 'drum');
    const expected = Array.from({ length: 16 }, (_, step) =>
      planBeatStep(beatSnapshotForLoop(loop), { stepInBar: step }).map((ev) => ({
        kind: 'drum', loopIndex: 0, voice: ev.voice, velocity: ev.velocity, timeSec: step * STEP,
      })),
    ).flat();
    expect(drums).toEqual(expected);
    expect(drums.some((e) => e.kind === 'drum' && e.voice === 'snare')).toBe(false);
  });

  test('a chordless loop yields drums and melody only', () => {
    const loop = mixdownLoop({ chords: [], leadMelodySteps: mixdownMelodyBar('C5') });
    const lanes = new Set(buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events.map(laneOf));
    expect([...lanes].sort()).toEqual(['drum', 'lead']);
  });

  test('every noteName is ROOTS-spelled', () => {
    const loop = mixdownLoop({
      scaleRoot: 'D#', scaleType: 'minor',
      chords: [{ id: 'c1', root: 'D#', quality: 'min', bars: 1 }],
      chordRhythmId: 'fourOnFloor', padMode: 'pad', leadMelodySteps: mixdownMelodyBar('A#4'),
    });
    const roots: readonly string[] = ROOTS;
    for (const e of buildSongTimeline(mixdownSnapshot({ loops: [loop] })).events) {
      if (e.kind === 'note') expect(roots).toContain(pitchClassOfNote(e.noteName));
    }
  });
});

describe('buildSongTimeline: repeats and determinism', () => {
  test('repeat 2 replays repeat 1 shifted by passSteps × stepDur', () => {
    const loop = mixdownLoop({ repeatCount: 2, chordRhythmId: 'fourOnFloor', leadMelodySteps: mixdownMelodyBar('E4') });
    const snap = mixdownSnapshot({ loops: [loop] });
    const { passSteps } = planArrangement(snap).passes[0];
    const shift = passSteps * STEP;
    const events = eventsOf(walk(snap));
    const first = events.filter((e) => timelineEventTime(e) < shift);
    const second = events.filter((e) => timelineEventTime(e) >= shift);
    expect(second.length).toBe(first.length);
    second.forEach((e, i) => {
      const a = first[i];
      expect(laneOf(e)).toBe(laneOf(a));
      expect(timelineEventTime(e)).toBeCloseTo(timelineEventTime(a) + shift, 9);
      if (e.kind === 'note' && a.kind === 'note') {
        expect([e.noteName, e.velocity]).toEqual([a.noteName, a.velocity]);
        expect(e.endSec).toBeCloseTo(a.endSec + shift, 9);
      }
    });
  });

  test('two builds under the same seed are deep-equal', async () => {
    const random = { active: true, mode: 'random', rate: '16n', octaves: 2 } as const;
    const snap = mixdownSnapshot({
      loops: [mixdownLoop({ chordRhythmId: 'fourOnFloor', chordArpSettings: { ...random } })],
    });
    const a = await withSeededRandom(7, () => buildSongTimeline(snap));
    const b = await withSeededRandom(7, () => buildSongTimeline(snap));
    expect(a).toEqual(b);
  });
});

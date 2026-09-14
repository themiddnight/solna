import { describe, expect, test, spyOn } from 'bun:test';
import { audioEngine } from '@/audio/engine';
import { freshEngine } from '@/audio/testFakes';
import type { ChordItem } from '@/types';
import type { ActiveSynth, ArpSettings } from '@/types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { TRACK_ARP_DEFAULTS } from '@/store/initialState';
import type { VoiceId } from '../synth/voiceId';
import { cycleStepAt, equalPowerVelocityScale } from '@/audio/chordRhythms';
import type { RhythmPattern } from '@/data/chordRhythms';
import { arpStepFor } from '@/utils/meter';
import {
  arpEventsForStep,
  buildChordEvents,
  chordPlanPosition,
  emitStepEvents,
  eventsForCycleStep,
  playChordLegato,
  playFullHoldChord,
  scheduleWholeChord,
  startPatternLoop,
  previewChordForScale,
  previewBarSeconds,
  previewCycleSeconds,
} from './chordPlayback';
import type { BarInvariantEvent } from './chordPlayback';

const SYNTH: ActiveSynth<'subtractive'> = SUBTRACTIVE_INIT;

/** The amp release every note-off in this file is expected to be handed. */
const RELEASE = SUBTRACTIVE_INIT.patch.synth.ampEnvelope.release;

/**
 * A voice id derived from the note name, so an assertion can name the voice a
 * note-off is expected to address without threading return values by hand.
 * One id per NOTE rather than per note-on: no test here plays the same note
 * twice inside one assertion, and `toHaveBeenCalledWith` only needs the pair
 * to agree.
 */
const voiceIdFor = (note: string) => `voice-${note}` as VoiceId;

/** The inverse of `voiceIdFor`, for a spy that logs by note name. */
const noteOfVoice = (voiceId: VoiceId) => voiceId.replace('voice-', '');

/**
 * The note-on spy every scheduling test needs. It must RETURN an id: the
 * bridges book a note-off only for a note-on that actually produced a voice,
 * so a bare `spyOn` (which returns undefined) would silently swallow every
 * release the test is about to assert on.
 */
function spyNoteOn() {
  return spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation((note: string) =>
    voiceIdFor(note),
  );
}

describe('legato chord preview', () => {
  test('triggers every chord note once immediately, silences prior voices, and schedules no note-offs', () => {
    const onSpy = spyNoteOn();
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');
    const stopSpy = spyOn(audioEngine, 'stopSource');

    playChordLegato(
      { root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] } as ChordItem,
      SYNTH,
      audioEngine,
    );

    expect(stopSpy).toHaveBeenCalledWith('chord', 0.05);
    expect(onSpy).toHaveBeenCalledTimes(3);
    // Dense chords get per-voice 1/√n compensation so the summed preview
    // no longer clips.
    const scaled = 0.8 * equalPowerVelocityScale(3);
    // `undefined`, not a literal 0: triggerSynthNoteOn only falls back to
    // ctx.currentTime for a nullish time, so passing 0 would pin the whole
    // envelope to the audio clock's origin instead of "now".
    expect(onSpy).toHaveBeenCalledWith('C4', SYNTH, scaled, undefined, 'chord', 1, 'preview');
    expect(onSpy).toHaveBeenCalledWith('E4', SYNTH, scaled, undefined, 'chord', 1, 'preview');
    expect(onSpy).toHaveBeenCalledWith('G4', SYNTH, scaled, undefined, 'chord', 1, 'preview');
    // Legato = the envelope sustains until the caller releases the preview.
    expect(offSpy).not.toHaveBeenCalled();

    onSpy.mockRestore();
    offSpy.mockRestore();
    stopSpy.mockRestore();
  });

  test('schedules the envelope at the CURRENT audio-clock time, not at t=0 — regression for "loud once, then quiet"', () => {
    // fakeCtx() starts currentTime at 10s, standing in for a preview pressed
    // well after the AudioContext was created (any press after the first).
    // A note-on scheduled at a literal 0 would put every envelope event in
    // the past relative to that clock, so the AudioParam timeline resolves
    // straight to its final value on arrival — skipping the attack ramp
    // entirely and landing directly on the sustain level.
    const { engine, ctx } = freshEngine();

    playChordLegato(
      { root: 'C', quality: 'maj', bars: 1, notes: ['C4'] } as ChordItem,
      SYNTH,
      engine,
    );

    // ctx._gains[0] is the C4 voice's main amp gain (createGain is called for
    // the main gain before the sub-osc gain inside triggerSynthNoteOn).
    const gain = ctx._gains[0].gain;
    for (const ev of gain.events) {
      expect(ev.t).toBeGreaterThanOrEqual(ctx.currentTime);
    }
  });
});

// Fake timer pair: the helper must read setTimeout/clearTimeout off
// globalThis at call time so these patches take effect. Shared by the
// looping-pattern-preview and grid-alignment describe blocks below.
function withFakeTimers() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let callback: (() => void) | undefined;
  let clearCalls = 0;
  const patch = {
    fire: () => callback?.(),
    clearCalls: () => clearCalls,
    armed: () => callback !== undefined,
  };
  globalThis.setTimeout = ((fn: () => void) => {
    callback = fn;
    return 1;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {
    clearCalls += 1;
    callback = undefined;
  }) as typeof clearTimeout;
  return {
    ...patch,
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

describe('looping pattern preview', () => {
  test('keeps rescheduling the pattern every bar until stop() is called', () => {
    const timers = withFakeTimers();
    try {
      let now = 10;
      const plays: number[] = [];
      const stop = startPatternLoop(
        (time) => plays.push(time),
        1.0,
        () => now,
      );

      // First bar plays immediately at the audio clock time, then each timer
      // callback advances the fake clock by one bar.
      now += 1;
      timers.fire();
      now += 1;
      timers.fire();

      expect(plays).toEqual([10, 11, 12]);

      stop();
      expect(timers.clearCalls()).toBe(1);
      expect(timers.armed()).toBe(false);
    } finally {
      timers.restore();
    }
  });

  test('stop() cancels an armed timer', () => {
    const timers = withFakeTimers();
    try {
      const stop = startPatternLoop(() => {}, 1.0, () => 10);
      stop();
      expect(timers.clearCalls()).toBe(1);
      expect(timers.armed()).toBe(false);
    } finally {
      timers.restore();
    }
  });
});

describe('startPatternLoop grid alignment', () => {
  test('a late timer does not shift the loop off the audio grid', () => {
    const timers = withFakeTimers();
    try {
      let now = 10;
      const plays: number[] = [];
      const stop = startPatternLoop((time) => plays.push(time), 1.0, () => now);

      // The timer fires 40 ms late twice. Re-arming from the wall clock would
      // accumulate that lag; the loop must stay on 10, 11, 12.
      now += 1.04;
      timers.fire();
      now += 1.04;
      timers.fire();

      expect(plays).toEqual([10, 11, 12]);
      stop();
    } finally {
      timers.restore();
    }
  });

  test('a stall past a whole bar re-anchors instead of scheduling in the past', () => {
    const timers = withFakeTimers();
    try {
      let now = 10;
      const plays: number[] = [];
      const stop = startPatternLoop((time) => plays.push(time), 1.0, () => now);

      now += 30; // tab backgrounded
      timers.fire();

      // Scheduling at 11 while the clock reads 40 would fire the whole bar at once.
      expect(plays.at(-1)!).toBeGreaterThanOrEqual(30);
      expect(plays.at(-1)!).toBe(40);

      // Re-firing the very next due timer (simulating the runtime catching up
      // on an overdue callback) must land on the NEXT bar, not replay the same
      // instant: a fix that re-anchors nextTime but keeps calling getNow() for
      // playback (rather than the corrected nextTime) would fire 40 twice.
      timers.fire();
      expect(plays.at(-1)!).toBe(41);
      stop();
    } finally {
      timers.restore();
    }
  });

  test('a timer late by most (but not all) of a bar still re-anchors, not just a whole-bar stall', () => {
    const timers = withFakeTimers();
    try {
      let now = 10;
      const plays: number[] = [];
      // 2 s bar: the first tick plays at 10 and arms nextTime at 12.
      const stop = startPatternLoop((time) => plays.push(time), 2.0, () => now);

      // The timer meant to fire at (about) 12 actually fires 1.9 s late, at
      // 13.9 — 0.95 of the bar, comfortably under a WHOLE bar of lateness. A
      // fix that only re-anchors past a full-bar threshold would leave
      // nextTime stuck at 12 here and play() would run with the clock already
      // reading 13.9: 15 of the bar's 16 steps replayed as one burst on the
      // NEXT tick. The correct fix re-anchors on a small fixed slop instead,
      // so this tick plays at (about) the real current time, not the stale
      // grid position.
      now += 3.9;
      timers.fire();

      expect(plays.at(-1)!).toBeCloseTo(13.9, 9);
      stop();
    } finally {
      timers.restore();
    }
  });
});

describe('pattern preview chord & timing', () => {
  test('uses the I triad of the active scale, independent of the 7th toggle', () => {
    const chord = previewChordForScale('C', 'Major');
    expect(chord.root).toBe('C');
    expect(chord.quality).toBe('maj');
    expect(chord.bars).toBe(1);

    // 7ths toggle never leaks into the preview chord.
    const seventh = previewChordForScale('D', 'Major');
    expect(seventh.quality).toBe('maj');
    expect(seventh.root).toBe('D');
  });

  test('one bar lasts 16 sixteenth steps at the given bpm', () => {
    // 120 bpm → sixteenth = 0.125 s → one 16-step bar = 2 s.
    expect(previewBarSeconds(120)).toBe(2);
  });

  test('default stepsPerBar still equals the 16-step value', () => {
    expect(previewBarSeconds(120, 16)).toBe(previewBarSeconds(120));
  });

  test('a 3/4 bar (12 steps) previews as three quarters of a 4/4 bar at the same bpm', () => {
    expect(previewBarSeconds(120, 12)).toBeCloseTo(previewBarSeconds(120) * 0.75, 12);
  });

  test('a 12/8 bar (24 steps) previews as 1.5x a 4/4 bar at the same bpm', () => {
    expect(previewBarSeconds(120, 24)).toBeCloseTo(previewBarSeconds(120) * 1.5, 12);
  });

  test('a cycle of N steps lasts N sixteenths at the given bpm', () => {
    // 32 sixteenths at 120 bpm = two 4/4 bars = 4 s. This is the exact value
    // both preview buttons hand their loop timer, so a custom two-bar preview
    // loops at the cycle seam rather than at a bar.
    expect(previewCycleSeconds(32, 120)).toBe(4);
    expect(previewCycleSeconds(32, 120)).toBe(2 * previewBarSeconds(120));
    expect(previewCycleSeconds(16, 120)).toBe(previewBarSeconds(120));
  });
});

describe('scheduleWholeChord walks exactly the cycle it is handed', () => {
  test('a two-bar custom cycle reaches its bar-two column before the seam', () => {
    const onSpy = spyNoteOn();
    // Column 20 of a 32-step cycle. A one-bar filter (stepInBar 20 % 16 = 4,
    // or a walk that stops at the first bar) can never reach it.
    scheduleWholeChord(
      [{ step: 20, noteName: 'E4', velocity: 1, timeOffset: 0, hold: 0.125 }],
      SYNTH,
      'chord',
      0,
      0.125,
      32,
      32,
    );
    expect(onSpy).toHaveBeenCalledWith('E4', SYNTH, 1, 2.5, 'chord', 1, 'sequencer');
    onSpy.mockRestore();
  });

  test('a one-bar preset cycle schedules its own column, unchanged', () => {
    const onSpy = spyNoteOn();
    scheduleWholeChord(
      [{ step: 4, noteName: 'E4', velocity: 1, timeOffset: 0, hold: 0.125 }],
      SYNTH,
      'chord',
      0,
      0.125,
      16,
      16,
    );
    expect(onSpy).toHaveBeenCalledWith('E4', SYNTH, 1, 0.5, 'chord', 1, 'sequencer');
    onSpy.mockRestore();
  });

  test('a full-cycle span strikes at the cycle start and releases at the seam', () => {
    const onSpy = spyNoteOn();
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');
    // A span covering the whole 32-step cycle: one strike at column 0 and a
    // release exactly at the seam (32 * 0.125 = 4 s) — the hold is the cycle,
    // not the chord it is previewed under.
    scheduleWholeChord(
      [{ step: 0, noteName: 'C4', velocity: 1, timeOffset: 0, hold: 4 }],
      SYNTH,
      'chord',
      0,
      0.125,
      32,
      32,
    );
    expect(onSpy).toHaveBeenCalledTimes(1);
    expect(onSpy).toHaveBeenCalledWith('C4', SYNTH, 1, 0, 'chord', 1, 'sequencer');
    expect(offSpy).toHaveBeenCalledWith(voiceIdFor('C4'), RELEASE, 4);
    onSpy.mockRestore();
    offSpy.mockRestore();
  });
});

describe('eventsForCycleStep folds a progression step onto the cycle it is given', () => {
  const EVENTS: BarInvariantEvent[] = [
    { step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 0.25 },
    { step: 20, noteName: 'E4', velocity: 0.7, timeOffset: 0.03, hold: 0.25 },
    { step: 12, noteName: 'G4', velocity: 0.6, timeOffset: 0, hold: 0.25, lastBarOnly: true },
  ];

  test('fires a bar-two event where a one-bar filter never would', () => {
    expect(eventsForCycleStep(EVENTS, 20, 32, false).map((e) => e.noteName)).toEqual(['E4']);
  });

  test('folds a step past the cycle seam back onto the same column', () => {
    expect(eventsForCycleStep(EVENTS, 52, 32, false).map((e) => e.noteName)).toEqual(['E4']);
  });

  test('repeats a one-bar preset cycle inside a longer progression step', () => {
    const preset: BarInvariantEvent[] = [
      { step: 4, noteName: 'E4', velocity: 0.7, timeOffset: 0, hold: 0.25 },
    ];
    expect(eventsForCycleStep(preset, 4, 16, false)).toHaveLength(1);
    expect(eventsForCycleStep(preset, 20, 16, false)).toHaveLength(1);
    expect(eventsForCycleStep(preset, 21, 16, false)).toEqual([]);
  });

  test('withholds a lastBarOnly approach until the active chord decides it', () => {
    expect(eventsForCycleStep(EVENTS, 12, 32, false)).toEqual([]);
    expect(eventsForCycleStep(EVENTS, 12, 32, true).map((e) => e.noteName)).toEqual(['G4']);
  });
});

describe('emitStepEvents note-off clamping', () => {
  // The step lands at t=11.5 and the hit holds 1.5 s, so it would ring to 13 —
  // past a chord that ends at 12. The note-off must be clamped to the end.
  test('clamps a note-off to the chord end', () => {
    const onSpy = spyNoteOn();
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    emitStepEvents(
      [{ noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 1.5 }],
      SYNTH,
      'chord',
      11.5,
      12,
    );

    expect(onSpy).toHaveBeenCalledWith('C4', SYNTH, 0.8, 11.5, 'chord', 1, 'sequencer');
    expect(offSpy).toHaveBeenCalledWith(voiceIdFor('C4'), RELEASE, 12);

    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  test('lets an in-bounds hold ring past the bar it started in', () => {
    const onSpy = spyNoteOn();
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    // Bar 0 of a two-bar chord: the hold drags over the bar line at 12 but
    // stays inside the chord, which ends at 14.
    emitStepEvents(
      [{ noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 1.5 }],
      SYNTH,
      'chord',
      11.5,
      14,
    );

    expect(offSpy).toHaveBeenCalledWith(voiceIdFor('C4'), RELEASE, 13);

    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  test('offsets a strum voice by its spread before clamping', () => {
    const onSpy = spyNoteOn();
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    emitStepEvents(
      [{ noteName: 'E4', velocity: 0.7, timeOffset: 0.03, hold: 0.25 }],
      SYNTH,
      'chord',
      11.5,
      14,
    );

    expect(onSpy).toHaveBeenCalledWith('E4', SYNTH, 0.7, 11.53, 'chord', 1, 'sequencer');
    expect(offSpy).toHaveBeenCalledWith(voiceIdFor('E4'), RELEASE, 11.78);

    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  test('a strummed note on a chord last step never gets an off before its on', () => {
    const calls: Array<{ kind: 'on' | 'off'; note: string; time: number }> = [];
    const spyOn_ = spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation(
      (note: string, _s, _v, time) => {
        calls.push({ kind: 'on', note, time: time ?? 0 });
        return voiceIdFor(note);
      },
    );
    const spyOff = spyOn(audioEngine, 'triggerSynthNoteOff').mockImplementation(
      (voiceId, _r, time) => { calls.push({ kind: 'off', note: noteOfVoice(voiceId), time: time ?? 0 }); },
    );
    try {
      // 200 BPM: one 16th is 0.075 s. A 4-note strum spreads 3 * 30 ms = 0.09 s,
      // so the last note's start is already past the chord's own end.
      const time = 10;
      const chordEnd = 10.075;
      emitStepEvents(
        [0, 1, 2, 3].map((i) => ({
          noteName: `N${i}`, velocity: 0.8, timeOffset: i * 0.03, hold: 0.2,
        })),
        SYNTH,
        'chord',
        time,
        chordEnd,
      );

      for (const note of ['N0', 'N1', 'N2', 'N3']) {
        const on = calls.find((c) => c.kind === 'on' && c.note === note)!;
        const off = calls.find((c) => c.kind === 'off' && c.note === note)!;
        expect(off.time).toBeGreaterThan(on.time);
      }
    } finally {
      spyOn_.mockRestore();
      spyOff.mockRestore();
    }
  });
});

describe('scheduleWholeChord', () => {
  // The pattern previews are driven by a bar timer, not the shared clock, so
  // they still lay the whole chord down in one burst. 16th = 0.125 s.
  test('lays every step of the requested span down from one call', () => {
    const onSpy = spyNoteOn();

    scheduleWholeChord(
      [{ step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 0.25 }],
      SYNTH,
      'chord',
      10,
      0.125,
      32,
      16,
    );

    expect(onSpy.mock.calls.map((c) => c[3])).toEqual([10, 12]);

    onSpy.mockRestore();
  });

  test('clamps the final hold to the chord end and holds back approach notes', () => {
    const onSpy = spyNoteOn();
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    scheduleWholeChord(
      [
        { step: 12, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 1.5 },
        { step: 14, noteName: 'B3', velocity: 0.8, timeOffset: 0, hold: 0.25, lastBarOnly: true },
      ],
      SYNTH,
      'chord',
      10,
      0.125,
      32,
      16,
    );

    // Bar 0's C4 may ring over the bar line at 12; bar 1's is cut at the chord
    // end (14). The approach note fires only on the last bar.
    expect(offSpy.mock.calls).toEqual([
      [voiceIdFor('C4'), RELEASE, 13],
      [voiceIdFor('C4'), RELEASE, 14],
      [voiceIdFor('B3'), RELEASE, 14],
    ]);

    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  test('schedules exactly the cycle it is given, not a bar-wrapped view of it', () => {
    const onSpy = spyNoteOn();

    // A bar-relative filter (step % stepsPerBar) could never reach column 20 of
    // a two-bar cycle; the cycle-aware one fires it once, in bar two.
    scheduleWholeChord(
      [{ step: 20, noteName: 'E4', velocity: 0.7, timeOffset: 0, hold: 0.25 }],
      SYNTH,
      'chord',
      10,
      0.125,
      32,
      32,
    );

    expect(onSpy.mock.calls.map((c) => c[3])).toEqual([12.5]);

    onSpy.mockRestore();
  });
});

describe('chordPlanPosition measures a step from the run origin', () => {
  // A two-bar chord that a run armed on its first bar line: progression step 0
  // through 31. The second chord of that run is armed on progression step 32.
  const PLAN = { startProgressionStep: 0, totalBars: 2 };

  test('maps a progression step to its place in the chord', () => {
    expect(chordPlanPosition(PLAN, 0)).toEqual({ isLastBar: false, stepsRemaining: 32 });
    expect(chordPlanPosition(PLAN, 4)).toEqual({ isLastBar: false, stepsRemaining: 28 });
  });

  test('flags the final bar so approach notes fire only there', () => {
    expect(chordPlanPosition(PLAN, 16)).toEqual({ isLastBar: true, stepsRemaining: 16 });
    expect(chordPlanPosition(PLAN, 31)).toEqual({ isLastBar: true, stepsRemaining: 1 });
  });

  test('returns null outside the chord span', () => {
    // 31 is the chord's last step; the next one belongs to the chord that
    // follows, which arms a plan of its own.
    expect(chordPlanPosition(PLAN, -1)).toBeNull();
    expect(chordPlanPosition(PLAN, 32)).toBeNull();
  });

  test('the second chord of a run is measured from the same origin, not from bar zero', () => {
    // Armed 32 progression steps into the run (two chords of two bars each).
    const second = { startProgressionStep: 32, totalBars: 2 };
    expect(chordPlanPosition(second, 32)).toEqual({ isLastBar: false, stepsRemaining: 32 });
    expect(chordPlanPosition(second, 48)).toEqual({ isLastBar: true, stepsRemaining: 16 });
    expect(chordPlanPosition(second, 31)).toBeNull();
  });
});

describe('a plan folds each chord and bass cycle by its own resolved width', () => {
  const BAR = 16;
  // A six-bar progression, a two-bar chord cycle (32 columns) over a
  // three-bar bass cycle (48), both resolved when the plan was armed. One
  // progression-relative step feeds both folds.
  const PLAN = {
    startProgressionStep: 0,
    totalBars: 6,
    chordCycleSteps: 2 * BAR,
    bassCycleSteps: 3 * BAR,
  };
  // The one subtraction the clock callback makes, before it publishes: the
  // clock step minus the step the run armed on. The arming state that supplies
  // the origin is pinned in useChordPlayback.test.ts; what is under test here
  // is what the two lanes do with the number it produces.
  const progressionStepAt = (step: number, origin = 0): number => step - origin;
  const inPlan = (step: number, origin = 0) =>
    chordPlanPosition(PLAN, progressionStepAt(step, origin));

  test('a two-bar chord custom event at column 20 fires in bar two', () => {
    const events: BarInvariantEvent[] = [
      { step: 20, noteName: 'E4', velocity: 0.7, timeOffset: 0, hold: 0.25 },
    ];
    const at = (step: number) =>
      eventsForCycleStep(events, progressionStepAt(step), PLAN.chordCycleSteps, false);

    expect(cycleStepAt(progressionStepAt(20), PLAN.chordCycleSteps)).toBe(20);
    expect(at(20).map((e) => e.noteName)).toEqual(['E4']);
    expect(at(19)).toEqual([]);
    // Column 20 is bar two of EVERY repetition, not a one-off.
    expect(at(20 + PLAN.chordCycleSteps).map((e) => e.noteName)).toEqual(['E4']);
  });

  test('a one-bar preset still repeats once per bar inside a multi-bar chord', () => {
    const preset: BarInvariantEvent[] = [
      { step: 4, noteName: 'E4', velocity: 0.7, timeOffset: 0, hold: 0.25 },
    ];
    const at = (step: number) =>
      eventsForCycleStep(preset, progressionStepAt(step), BAR, false);

    expect([4, 20, 36, 52].map((step) => at(step).length)).toEqual([1, 1, 1, 1]);
    expect(at(5)).toEqual([]);
  });

  test('independent chord and bass cycles phase from the same progression step', () => {
    const phases = [0, 16, 32, 48, 64, 80].map((step) => {
      const progressionStep = progressionStepAt(step);
      return [
        cycleStepAt(progressionStep, PLAN.chordCycleSteps),
        cycleStepAt(progressionStep, PLAN.bassCycleSteps),
      ];
    });

    expect(phases).toEqual([
      [0, 0],   // both cycles begin together
      [16, 16],
      [0, 32],  // the two-bar chord cycle wraps; the three-bar bass does not
      [16, 0],  // the bass wraps a bar later; the chord does not
      [0, 16],
      [16, 32],
    ]);
  });

  test('playback that began on a running clock starts both cycles at column zero', () => {
    // The shared clock has been counting since app start; the run armed on the
    // bar line at 112, so that tick is progression step 0 for both lanes —
    // never clock step 112, whose own bar column is 0 but whose cycle column
    // would be 112 % 32 = 16.
    const origin = 112;

    expect(inPlan(origin, origin)).not.toBeNull();
    expect(inPlan(origin + 1, origin)).not.toBeNull();
    expect([
      cycleStepAt(progressionStepAt(origin, origin), PLAN.chordCycleSteps),
      cycleStepAt(progressionStepAt(origin, origin), PLAN.bassCycleSteps),
    ]).toEqual([0, 0]);

    // One step in, both cycles are one column in.
    expect([
      cycleStepAt(progressionStepAt(origin + 1, origin), PLAN.chordCycleSteps),
      cycleStepAt(progressionStepAt(origin + 1, origin), PLAN.bassCycleSteps),
    ]).toEqual([1, 1]);
  });

  test('a custom span covering the whole cycle retriggers at column zero of the next', () => {
    const span: BarInvariantEvent[] = [
      { step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 2 },
    ];
    const at = (step: number) =>
      eventsForCycleStep(span, progressionStepAt(step), PLAN.chordCycleSteps, false);

    expect(at(0).map((e) => e.noteName)).toEqual(['C4']); // the cycle's strike
    expect(at(31)).toEqual([]);                          // sealed until the seam
    expect(at(32).map((e) => e.noteName)).toEqual(['C4']); // seam: release, restrike
    expect(at(64).map((e) => e.noteName)).toEqual(['C4']); // and on every repetition
  });
});

describe('arpEventsForStep', () => {
  const ARP: ArpSettings = { ...TRACK_ARP_DEFAULTS.chord, active: true, mode: 'up', octaves: 1, rate: '16n' };
  const NOTES = ['C4', 'E4', 'G4'];

  test('walks the chord tones in arp order, one per sixteenth step', () => {
    expect(arpEventsForStep(NOTES, ARP, 0, 0.125, 1).map((e) => e.noteName)).toEqual(['C4']);
    expect(arpEventsForStep(NOTES, ARP, 1, 0.125, 1).map((e) => e.noteName)).toEqual(['E4']);
    expect(arpEventsForStep(NOTES, ARP, 2, 0.125, 1).map((e) => e.noteName)).toEqual(['G4']);
    // The sequence wraps, so the arp keeps running across bars and chords.
    expect(arpEventsForStep(NOTES, ARP, 3, 0.125, 1).map((e) => e.noteName)).toEqual(['C4']);
  });

  test('honours arpRate by staying silent on steps the rate skips', () => {
    const eighths = { ...ARP, rate: '8n' as const };
    expect(arpEventsForStep(NOTES, eighths, 0, 0.125, 1).map((e) => e.noteName)).toEqual(['C4']);
    expect(arpEventsForStep(NOTES, eighths, 1, 0.125, 1)).toEqual([]);
    expect(arpEventsForStep(NOTES, eighths, 2, 0.125, 1).map((e) => e.noteName)).toEqual(['E4']);
  });

  test('stacks octaves and follows arpMode', () => {
    const down = { ...ARP, mode: 'down' as const, octaves: 2 };
    // up-order across 2 octaves is C4 E4 G4 C5 E5 G5, so down starts at G5.
    expect(arpEventsForStep(NOTES, down, 0, 0.125, 1).map((e) => e.noteName)).toEqual(['G5']);
  });

  test('feel tightens an arp note but never stretches it past its own step', () => {
    const [plain] = arpEventsForStep(NOTES, ARP, 0, 0.125, 1);
    const [tight] = arpEventsForStep(NOTES, ARP, 0, 0.125, 0.5);
    const [loose] = arpEventsForStep(NOTES, ARP, 0, 0.125, 2);

    expect(tight.hold).toBeCloseTo(plain.hold * 0.5, 9);
    // A gate longer than the interval between triggers just guarantees the
    // notes overlap. On the monophonic bass that means every note is
    // voice-stolen while still above its sustain level and chopped off.
    expect(loose.hold).toBe(plain.hold);
    expect(plain.hold).toBeLessThan(0.125);
  });

  test('returns nothing when there are no notes to arpeggiate', () => {
    expect(arpEventsForStep([], ARP, 0, 0.125, 1)).toEqual([]);
  });

  test('a non-default stepsPerBar bar-phases the step instead of taking it raw', () => {
    // 7/8 (stepsPerBar 14) is the one meter in the table that is NOT a
    // multiple of 4, so arpStepFor re-phases it: arpStepFor(14, 14) lands on
    // the next bar's phase-quantised start (16), not on 14 itself. If
    // arpEventsForStep ever stopped bar-phasing its `step` argument — e.g. by
    // reverting to a plain `computeArpTriggers(step, ...)` call — this test
    // would fail even though the whole rest of the suite (which only ever
    // passes the defaulted, byte-identical 4/4 stepsPerBar) would stay green.
    const rephasedStep = arpStepFor(14, 14);
    expect(rephasedStep).toBe(16);

    const [odd] = arpEventsForStep(NOTES, ARP, 14, 0.125, 1, 14);
    const [control] = arpEventsForStep(NOTES, ARP, 14, 0.125, 1);

    // The 4/4 control call (stepsPerBar defaults to 16, already a multiple of
    // 4) takes step 14 raw: arpStepFor(14, 16) === 14, noteIndex 14 % 3 = G4.
    expect(control.noteName).toEqual('G4');
    // The 7/8 call re-phases 14 to 16 before indexing: noteIndex 16 % 3 = E4 —
    // the same note `computeArpTriggers` would pick for step 16 directly.
    expect(odd.noteName).toEqual('E4');
    expect(odd.noteName).not.toEqual(control.noteName);
  });
});

describe('full-hold chord scheduling', () => {
  test('plays every note at 1/√n velocity and releases at the hold end', () => {
    const onSpy = spyNoteOn();
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    const notes = ['C4', 'E4', 'G4', 'B4', 'D5', 'F5', 'A5'];
    playFullHoldChord(notes, SYNTH, 10, 4, 'chord');

    const scaled = 0.8 * equalPowerVelocityScale(7);
    for (const n of notes) {
      expect(onSpy).toHaveBeenCalledWith(n, SYNTH, scaled, 10, 'chord', 1, 'sequencer');
      expect(offSpy).toHaveBeenCalledWith(voiceIdFor(n), RELEASE, 14);
    }
    expect(onSpy).toHaveBeenCalledTimes(7);

    onSpy.mockRestore();
    offSpy.mockRestore();
  });
});

describe('buildChordEvents', () => {
  const PATTERN: RhythmPattern = {
    id: 'test',
    name: 'Test',
    style: 'Test',
    hits: [{ step: 0, type: 'block', velocity: 0.8, holdSteps: 2 }],
  };

  test('scales block-hit velocity by 1/√n and keeps offset/hold math', () => {
    const notes = ['C4', 'E4', 'G4', 'B4'];
    const events = buildChordEvents(PATTERN, notes, 0.125, 1);

    expect(events).toHaveLength(4);
    const scaled = 0.8 * equalPowerVelocityScale(4);
    for (const ev of events) {
      expect(ev.velocity).toBe(scaled);
      // The hit's grid position is carried as a step, not baked into a time
      // offset: the scheduler emits each event on the clock tick that matches.
      expect(ev.step).toBe(0);
      expect(ev.timeOffset).toBe(0);
      expect(ev.hold).toBeCloseTo(0.25, 6);
    }
    expect(events.map((e) => e.noteName)).toEqual(notes);
  });

  test('keeps strum cascade ordering, spread timing, and scaled velocities', () => {
    const strumPattern: RhythmPattern = {
      id: 'test',
      name: 'Test',
      style: 'Test',
      hits: [
        { step: 4, type: 'strum', direction: 'up', velocity: 0.9, holdSteps: 2, spreadMs: 30 },
      ],
    };
    const notes = ['C4', 'E4', 'G4'];
    const events = buildChordEvents(strumPattern, notes, 0.125, 2);

    // Up-strum = high to low.
    expect(events.map((e) => e.noteName)).toEqual(['G4', 'E4', 'C4']);
    const base = 0.9 * equalPowerVelocityScale(3);
    // All three land on step 4; only the strum spread stays a time offset.
    expect(events.map((e) => e.step)).toEqual([4, 4, 4]);
    expect(events[0].timeOffset).toBeCloseTo(0, 9);
    expect(events[1].timeOffset).toBeCloseTo(0.03, 9);
    expect(events[2].timeOffset).toBeCloseTo(0.06, 9);
    expect(events[0].velocity).toBeCloseTo(Math.max(0.1, base * (1 - 0 * 0.08)), 12);
    expect(events[1].velocity).toBeCloseTo(Math.max(0.1, base * (1 - 1 * 0.08)), 12);
    expect(events[2].velocity).toBeCloseTo(Math.max(0.1, base * (1 - 2 * 0.08)), 12);
    expect(events[0].hold).toBeCloseTo(2 * 0.125 * 2, 6);
  });
});

describe('eventsForCycleStep output is unchanged by the single-pass rewrite', () => {
  const events: BarInvariantEvent[] = [
    { step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 0.5 },
    { step: 0, noteName: 'E4', velocity: 0.7, timeOffset: 0.01, hold: 0.5 },
    { step: 4, noteName: 'G4', velocity: 0.6, timeOffset: 0, hold: 0.25 },
    { step: 4, noteName: 'B3', velocity: 0.5, timeOffset: 0, hold: 0.25, lastBarOnly: true },
    { step: 15, noteName: 'D4', velocity: 0.4, timeOffset: 0, hold: 0.1, lastBarOnly: true },
  ];

  // The old .filter().map(), kept verbatim as the oracle.
  const reference = (stepInBar: number, isLastBar: boolean) =>
    events
      .filter((ev) => ev.step === stepInBar && (isLastBar || !ev.lastBarOnly))
      .map(({ noteName, velocity, timeOffset, hold }) => ({ noteName, velocity, timeOffset, hold }));

  test('matches the reference across every step and both bar positions', () => {
    for (let step = 0; step < 16; step++) {
      for (const isLastBar of [false, true]) {
        expect(eventsForCycleStep(events, step, 16, isLastBar)).toEqual(reference(step, isLastBar));
      }
    }
  });

  test('returns a fresh array of fresh objects with exactly the four StepEvent keys', () => {
    const a = eventsForCycleStep(events, 0, 16, true);
    expect(a).not.toBe(eventsForCycleStep(events, 0, 16, true));
    expect(a[0]).not.toBe(events[0]);
    expect(Object.keys(a[0]).sort()).toEqual(['hold', 'noteName', 'timeOffset', 'velocity']);
    expect(eventsForCycleStep([], 0, 16, true)).toEqual([]);
  });
});

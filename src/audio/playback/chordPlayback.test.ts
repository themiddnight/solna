import { describe, expect, test, spyOn } from 'bun:test';
import { audioEngine } from '@/audio/engine';
import { freshEngine } from '@/audio/testFakes';
import type { ActiveSynth } from '@/types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import type { VoiceId } from '../synth/voiceId';
import { equalPowerVelocityScale } from '@/audio/chordRhythms';
import { noteFrequency } from '@/utils/musicTheory';
import { barDurationSec } from '@/utils/tempo';
import {
  emitStepEvents,
  playChordLegato,
  playFullHoldChord,
  scheduleWholeChord,
  startPatternLoop,
  previewChordForScale,
  previewCycleSeconds,
} from './chordPlayback';

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
const voiceIdFor = (frequency: number) => `voice-${frequency}` as VoiceId;

/** The inverse of `voiceIdFor`, for a spy that logs by the frequency it played. */
const freqOfVoice = (voiceId: VoiceId) => Number(voiceId.replace('voice-', ''));

/**
 * The note-on spy every scheduling test needs. It must RETURN an id: the
 * bridges book a note-off only for a note-on that actually produced a voice,
 * so a bare `spyOn` (which returns undefined) would silently swallow every
 * release the test is about to assert on.
 */
function spyNoteOn() {
  return spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation((frequency: number) =>
    voiceIdFor(frequency),
  );
}

describe('legato chord preview', () => {
  test('triggers every chord note once immediately, silences prior voices, and schedules no note-offs', () => {
    const onSpy = spyNoteOn();
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');
    const stopSpy = spyOn(audioEngine, 'stopSource');

    playChordLegato(['C4', 'E4', 'G4'], SYNTH, audioEngine);

    expect(stopSpy).toHaveBeenCalledWith('chord', 0.05);
    expect(onSpy).toHaveBeenCalledTimes(3);
    // Dense chords get per-voice 1/√n compensation so the summed preview
    // no longer clips.
    const scaled = 0.8 * equalPowerVelocityScale(3);
    // `undefined`, not a literal 0: triggerSynthNoteOn only falls back to
    // ctx.currentTime for a nullish time, so passing 0 would pin the whole
    // envelope to the audio clock's origin instead of "now".
    expect(onSpy).toHaveBeenCalledWith(noteFrequency('C4'), SYNTH, scaled, undefined, 'chord', 1, 'preview');
    expect(onSpy).toHaveBeenCalledWith(noteFrequency('E4'), SYNTH, scaled, undefined, 'chord', 1, 'preview');
    expect(onSpy).toHaveBeenCalledWith(noteFrequency('G4'), SYNTH, scaled, undefined, 'chord', 1, 'preview');
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

    playChordLegato(['C4'], SYNTH, engine);

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

  test('has no notes field', () => {
    const preview = previewChordForScale('C', 'Major');
    expect('notes' in preview).toBe(false);
  });

  test('a cycle of N steps lasts N sixteenths at the given bpm', () => {
    // 32 sixteenths at 120 bpm = two 4/4 bars = 4 s. This is the exact value
    // both preview buttons hand their loop timer, so a custom two-bar preview
    // loops at the cycle seam rather than at a bar.
    expect(previewCycleSeconds(32, 120)).toBe(4);
    expect(previewCycleSeconds(32, 120)).toBe(2 * barDurationSec(120));
    expect(previewCycleSeconds(16, 120)).toBe(barDurationSec(120));
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
    expect(onSpy).toHaveBeenCalledWith(noteFrequency('E4'), SYNTH, 1, 2.5, 'chord', 1, 'sequencer');
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
    expect(onSpy).toHaveBeenCalledWith(noteFrequency('E4'), SYNTH, 1, 0.5, 'chord', 1, 'sequencer');
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
    expect(onSpy).toHaveBeenCalledWith(noteFrequency('C4'), SYNTH, 1, 0, 'chord', 1, 'sequencer');
    expect(offSpy).toHaveBeenCalledWith(voiceIdFor(noteFrequency('C4')), RELEASE, 4);
    onSpy.mockRestore();
    offSpy.mockRestore();
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

    expect(onSpy).toHaveBeenCalledWith(noteFrequency('C4'), SYNTH, 0.8, 11.5, 'chord', 1, 'sequencer');
    expect(offSpy).toHaveBeenCalledWith(voiceIdFor(noteFrequency('C4')), RELEASE, 12);

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

    expect(offSpy).toHaveBeenCalledWith(voiceIdFor(noteFrequency('C4')), RELEASE, 13);

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

    expect(onSpy).toHaveBeenCalledWith(noteFrequency('E4'), SYNTH, 0.7, 11.53, 'chord', 1, 'sequencer');
    expect(offSpy).toHaveBeenCalledWith(voiceIdFor(noteFrequency('E4')), RELEASE, 11.78);

    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  test('a strummed note on a chord last step never gets an off before its on', () => {
    const calls: Array<{ kind: 'on' | 'off'; freq: number; time: number }> = [];
    const spyOn_ = spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation(
      (frequency: number, _s, _v, time) => {
        calls.push({ kind: 'on', freq: frequency, time: time ?? 0 });
        return voiceIdFor(frequency);
      },
    );
    const spyOff = spyOn(audioEngine, 'triggerSynthNoteOff').mockImplementation(
      (voiceId, _r, time) => { calls.push({ kind: 'off', freq: freqOfVoice(voiceId), time: time ?? 0 }); },
    );
    try {
      // 200 BPM: one 16th is 0.075 s. A 4-note strum spreads 3 * 30 ms = 0.09 s,
      // so the last note's start is already past the chord's own end.
      const time = 10;
      const chordEnd = 10.075;
      // Four distinct real note names — distinct so each resolves to its own
      // Hz and the on/off pairing below can tell them apart by frequency.
      const notes = ['C4', 'D4', 'E4', 'F4'];
      emitStepEvents(
        notes.map((noteName, i) => ({
          noteName, velocity: 0.8, timeOffset: i * 0.03, hold: 0.2,
        })),
        SYNTH,
        'chord',
        time,
        chordEnd,
      );

      for (const note of notes) {
        const freq = noteFrequency(note);
        const on = calls.find((c) => c.kind === 'on' && c.freq === freq)!;
        const off = calls.find((c) => c.kind === 'off' && c.freq === freq)!;
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
      [voiceIdFor(noteFrequency('C4')), RELEASE, 13],
      [voiceIdFor(noteFrequency('C4')), RELEASE, 14],
      [voiceIdFor(noteFrequency('B3')), RELEASE, 14],
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

describe('full-hold chord scheduling', () => {
  test('plays every note at 1/√n velocity and releases at the hold end', () => {
    const onSpy = spyNoteOn();
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    const notes = ['C4', 'E4', 'G4', 'B4', 'D5', 'F5', 'A5'];
    playFullHoldChord(notes, SYNTH, 10, 4, 'chord');

    const scaled = 0.8 * equalPowerVelocityScale(7);
    for (const n of notes) {
      const freq = noteFrequency(n);
      expect(onSpy).toHaveBeenCalledWith(freq, SYNTH, scaled, 10, 'chord', 1, 'sequencer');
      expect(offSpy).toHaveBeenCalledWith(voiceIdFor(freq), RELEASE, 14);
    }
    expect(onSpy).toHaveBeenCalledTimes(7);

    onSpy.mockRestore();
    offSpy.mockRestore();
  });
});

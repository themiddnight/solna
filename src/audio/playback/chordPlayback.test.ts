import { describe, expect, test, spyOn } from 'bun:test';
import { audioEngine } from '../../audio/engine';
import type { ChordItem, SynthParams } from '../../types';
import { equalPowerVelocityScale } from '../../audio/rhythmPatterns';
import type { RhythmPattern } from '../../audio/rhythmPatterns';
import {
  arpEventsForStep,
  buildChordEvents,
  chordPlanPosition,
  emitStepEvents,
  eventsForStep,
  playChordLegato,
  playFullHoldChord,
  scheduleWholeChord,
  startPatternLoop,
  previewChordForScale,
  previewBarSeconds,
} from './chordPlayback';
import type { BarInvariantEvent } from './chordPlayback';

const SYNTH: SynthParams = {
  oscType: 'sawtooth',
  subOscVolume: 0.3,
  noiseVolume: 0,
  detune: 0,
  filterType: 'lowpass',
  filterCutoff: 2400,
  filterResonance: 3,
  filterEnvAmount: 1200,
  attack: 0.02,
  decay: 0.4,
  sustain: 0.6,
  release: 0.5,
  filterAttack: 0.02,
  filterDecay: 0.4,
  filterSustain: 0,
  filterRelease: 0.5,
  lfoRate: 3.5,
  lfoDepth: 0,
  lfoTarget: 'cutoff',
  octave: 0,
  preset: 'Test',
};

describe('legato chord preview', () => {
  test('triggers every chord note once immediately, silences prior voices, and schedules no note-offs', () => {
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
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
    expect(onSpy).toHaveBeenCalledWith('C4', SYNTH, scaled, 0, 'chord');
    expect(onSpy).toHaveBeenCalledWith('E4', SYNTH, scaled, 0, 'chord');
    expect(onSpy).toHaveBeenCalledWith('G4', SYNTH, scaled, 0, 'chord');
    // Legato = the envelope sustains until the caller releases the preview.
    expect(offSpy).not.toHaveBeenCalled();

    onSpy.mockRestore();
    offSpy.mockRestore();
    stopSpy.mockRestore();
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
});

describe('eventsForStep', () => {
  const EVENTS: BarInvariantEvent[] = [
    { step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 0.25 },
    { step: 4, noteName: 'E4', velocity: 0.7, timeOffset: 0.03, hold: 0.25 },
    { step: 12, noteName: 'G4', velocity: 0.6, timeOffset: 0, hold: 0.25, lastBarOnly: true },
  ];

  test('returns only the events landing on the given step', () => {
    expect(eventsForStep(EVENTS, 4, false).map((e) => e.noteName)).toEqual(['E4']);
    expect(eventsForStep(EVENTS, 1, false)).toEqual([]);
  });

  test('withholds a lastBarOnly event until the final bar', () => {
    expect(eventsForStep(EVENTS, 12, false)).toEqual([]);
    expect(eventsForStep(EVENTS, 12, true).map((e) => e.noteName)).toEqual(['G4']);
  });
});

describe('emitStepEvents note-off clamping', () => {
  // The step lands at t=11.5 and the hit holds 1.5 s, so it would ring to 13 —
  // past a chord that ends at 12. The note-off must be clamped to the end.
  test('clamps a note-off to the chord end', () => {
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    emitStepEvents(
      [{ noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 1.5 }],
      SYNTH,
      'chord',
      11.5,
      12,
    );

    expect(onSpy).toHaveBeenCalledWith('C4', SYNTH, 0.8, 11.5, 'chord');
    expect(offSpy).toHaveBeenCalledWith('C4', SYNTH.release, 12, 'chord');

    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  test('lets an in-bounds hold ring past the bar it started in', () => {
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

    expect(offSpy).toHaveBeenCalledWith('C4', SYNTH.release, 13, 'chord');

    offSpy.mockRestore();
  });

  test('offsets a strum voice by its spread before clamping', () => {
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    emitStepEvents(
      [{ noteName: 'E4', velocity: 0.7, timeOffset: 0.03, hold: 0.25 }],
      SYNTH,
      'chord',
      11.5,
      14,
    );

    expect(onSpy).toHaveBeenCalledWith('E4', SYNTH, 0.7, 11.53, 'chord');
    expect(offSpy).toHaveBeenCalledWith('E4', SYNTH.release, 11.78, 'chord');

    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  test('a strummed note on a chord last step never gets an off before its on', () => {
    const calls: Array<{ kind: 'on' | 'off'; note: string; time: number }> = [];
    const spyOn_ = spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation(
      (note, _p, _v, time) => { calls.push({ kind: 'on', note, time: time ?? 0 }); },
    );
    const spyOff = spyOn(audioEngine, 'triggerSynthNoteOff').mockImplementation(
      (note, _r, time) => { calls.push({ kind: 'off', note, time: time ?? 0 }); },
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
  test('lays every bar of the chord down from one call', () => {
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');

    scheduleWholeChord(
      [{ step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 0.25 }],
      SYNTH,
      'chord',
      10,
      0.125,
      2,
    );

    expect(onSpy.mock.calls.map((c) => c[3])).toEqual([10, 12]);

    onSpy.mockRestore();
  });

  test('clamps the final hold to the chord end and holds back approach notes', () => {
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
      2,
    );

    // Bar 0's C4 may ring over the bar line at 12; bar 1's is cut at the chord
    // end (14). The approach note fires only on the last bar.
    expect(offSpy.mock.calls).toEqual([
      ['C4', SYNTH.release, 13, 'chord'],
      ['C4', SYNTH.release, 14, 'chord'],
      ['B3', SYNTH.release, 14, 'chord'],
    ]);

    offSpy.mockRestore();
  });
});

describe('chordPlanPosition', () => {
  // A two-bar chord armed on absolute step 32 spans steps 32..63.
  const PLAN = { startStep: 32, totalBars: 2 };

  test('maps an absolute step to its bar-local step', () => {
    expect(chordPlanPosition(PLAN, 32)).toEqual({ stepInBar: 0, isLastBar: false, stepsRemaining: 32 });
    expect(chordPlanPosition(PLAN, 36)).toEqual({ stepInBar: 4, isLastBar: false, stepsRemaining: 28 });
  });

  test('flags the final bar so approach notes fire only there', () => {
    expect(chordPlanPosition(PLAN, 48)).toEqual({ stepInBar: 0, isLastBar: true, stepsRemaining: 16 });
    expect(chordPlanPosition(PLAN, 63)).toEqual({ stepInBar: 15, isLastBar: true, stepsRemaining: 1 });
  });

  test('returns null outside the chord span', () => {
    expect(chordPlanPosition(PLAN, 31)).toBeNull();
    expect(chordPlanPosition(PLAN, 64)).toBeNull();
  });
});

describe('arpEventsForStep', () => {
  const ARP: SynthParams = { ...SYNTH, arpActive: true, arpMode: 'up', arpOctaves: 1, arpRate: '16n' };
  const NOTES = ['C4', 'E4', 'G4'];

  test('walks the chord tones in arp order, one per sixteenth step', () => {
    expect(arpEventsForStep(NOTES, ARP, 0, 0.125, 1).map((e) => e.noteName)).toEqual(['C4']);
    expect(arpEventsForStep(NOTES, ARP, 1, 0.125, 1).map((e) => e.noteName)).toEqual(['E4']);
    expect(arpEventsForStep(NOTES, ARP, 2, 0.125, 1).map((e) => e.noteName)).toEqual(['G4']);
    // The sequence wraps, so the arp keeps running across bars and chords.
    expect(arpEventsForStep(NOTES, ARP, 3, 0.125, 1).map((e) => e.noteName)).toEqual(['C4']);
  });

  test('honours arpRate by staying silent on steps the rate skips', () => {
    const eighths = { ...ARP, arpRate: '8n' as const };
    expect(arpEventsForStep(NOTES, eighths, 0, 0.125, 1).map((e) => e.noteName)).toEqual(['C4']);
    expect(arpEventsForStep(NOTES, eighths, 1, 0.125, 1)).toEqual([]);
    expect(arpEventsForStep(NOTES, eighths, 2, 0.125, 1).map((e) => e.noteName)).toEqual(['E4']);
  });

  test('stacks octaves and follows arpMode', () => {
    const down = { ...ARP, arpMode: 'down' as const, arpOctaves: 2 };
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
});

describe('full-hold chord scheduling', () => {
  test('plays every note at 1/√n velocity and releases at the hold end', () => {
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    const notes = ['C4', 'E4', 'G4', 'B4', 'D5', 'F5', 'A5'];
    playFullHoldChord(notes, SYNTH, 10, 4);

    const scaled = 0.8 * equalPowerVelocityScale(7);
    for (const n of notes) {
      expect(onSpy).toHaveBeenCalledWith(n, SYNTH, scaled, 10, 'chord');
      expect(offSpy).toHaveBeenCalledWith(n, SYNTH.release, 14, 'chord');
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

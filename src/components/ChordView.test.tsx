import { describe, expect, test, spyOn } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { audioEngine } from '../audio/engine';
import type { ChordItem, SynthParams } from '../types';
import { equalPowerVelocityScale } from '../audio/rhythmPatterns';
import type { RhythmPattern } from '../audio/rhythmPatterns';
import {
  buildChordEvents,
  playChordLegato,
  playFullHoldChord,
  scheduleBarInvariantEvents,
  startPatternLoop,
  previewChordForScale,
  previewBarSeconds,
  ChordView,
} from './ChordView';

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

describe('looping pattern preview', () => {
  // Fake timer pair: the helper must read setTimeout/clearTimeout off
  // globalThis at call time so these patches take effect.
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
    globalThis.clearTimeout = ((_id: unknown) => {
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

describe('scheduleBarInvariantEvents note-off clamping', () => {
  // One bar = 2 s. A hit at 1.5 s holding 1.5 s would end at 3 s — past the
  // chord end at 2 s — so its note-off must be clamped to the chord boundary.
  test('clamps a last-bar note-off to the chord end', () => {
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    scheduleBarInvariantEvents(
      [{ noteName: 'C4', velocity: 0.8, timeOffset: 1.5, hold: 1.5 }],
      SYNTH,
      'chord',
      10,
      2,
      1,
    );

    expect(onSpy).toHaveBeenCalledWith('C4', SYNTH, 0.8, 11.5, 'chord');
    expect(offSpy).toHaveBeenCalledWith('C4', SYNTH.release, 12, 'chord');

    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  test('leaves an in-bounds hold untouched', () => {
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    scheduleBarInvariantEvents(
      [{ noteName: 'C4', velocity: 0.8, timeOffset: 0.5, hold: 0.5 }],
      SYNTH,
      'chord',
      10,
      2,
      1,
    );

    expect(offSpy).toHaveBeenCalledWith('C4', SYNTH.release, 11, 'chord');

    offSpy.mockRestore();
  });

  test('only clamps against the chord end, not the bar boundary', () => {
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    // Two bars: bar 0 spans [10, 12], bar 1 spans [12, 14]. The same hit on
    // bar 0 may drag across the bar boundary (same chord), but bar 1's copy
    // is clamped to the chord end at 14.
    scheduleBarInvariantEvents(
      [{ noteName: 'C4', velocity: 0.8, timeOffset: 1.5, hold: 1.5 }],
      SYNTH,
      'chord',
      10,
      2,
      2,
    );

    expect(offSpy.mock.calls).toEqual([
      ['C4', SYNTH.release, 13, 'chord'],
      ['C4', SYNTH.release, 14, 'chord'],
    ]);

    offSpy.mockRestore();
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
    expect(events[0].timeOffset).toBeCloseTo(4 * 0.125, 9);
    expect(events[1].timeOffset).toBeCloseTo(4 * 0.125 + 0.03, 9);
    expect(events[0].velocity).toBeCloseTo(Math.max(0.1, base * (1 - 0 * 0.08)), 12);
    expect(events[1].velocity).toBeCloseTo(Math.max(0.1, base * (1 - 1 * 0.08)), 12);
    expect(events[2].velocity).toBeCloseTo(Math.max(0.1, base * (1 - 2 * 0.08)), 12);
    expect(events[0].hold).toBeCloseTo(2 * 0.125 * 2, 6);
  });
});

describe('ChordView preview UI', () => {
  test('renders separate chord and bass pattern preview buttons', () => {
    const html = renderToString(<ChordView />);

    expect(html).toContain('btn-preview-chord-pattern');
    expect(html).toContain('btn-preview-bass-pattern');
    expect(html).toContain('Hold to Preview Chord Pattern Loop');
    expect(html).toContain('Hold to Preview Bass Pattern Loop');
    // The two modules no longer share one combined preview.
    expect(html).not.toContain('Chord &amp; Bass Pattern Loop');
    // Progression pads preview the chord legato, not the old pattern hold.
    expect(html).toContain('Hold to Preview Chord');
    expect(html).not.toContain(
      'title="Hold to Preview Chord &amp; Bass Pattern"',
    );
  });
});

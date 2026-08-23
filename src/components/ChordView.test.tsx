import { describe, expect, test, spyOn } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { audioEngine } from '../audio/engine';
import type { ChordItem, SynthParams } from '../types';
import {
  playChordLegato,
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
  test('triggers every chord note once immediately and schedules no note-offs', () => {
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');

    playChordLegato(
      { root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] } as ChordItem,
      SYNTH,
      audioEngine,
    );

    expect(onSpy).toHaveBeenCalledTimes(3);
    expect(onSpy).toHaveBeenCalledWith('C4', SYNTH, 0.8, 0, 'chord');
    expect(onSpy).toHaveBeenCalledWith('E4', SYNTH, 0.8, 0, 'chord');
    expect(onSpy).toHaveBeenCalledWith('G4', SYNTH, 0.8, 0, 'chord');
    // Legato = the envelope sustains until the caller releases the preview.
    expect(offSpy).not.toHaveBeenCalled();

    onSpy.mockRestore();
    offSpy.mockRestore();
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

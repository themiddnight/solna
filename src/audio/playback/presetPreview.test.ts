import { describe, expect, test } from 'bun:test';
import { audioEngine } from '../engine';
import { freshEngine } from '../testFakes';
import type { SynthParams, ChordItem } from '../../types';
import { previewChordProgression, previewSequencerNote } from './presetPreview';

/* eslint-disable @typescript-eslint/no-explicit-any -- tests deliberately
   reach private engine fields (sourceVoices) via casts, same as engine.test.ts. */

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
  arpActive: false,
  arpMode: 'up',
  arpRate: '16n',
  arpOctaves: 1,
  preset: 'Test',
};

/**
 * presetPreview.ts only ever reaches the shared `audioEngine` singleton
 * (never an injectable instance, by design — components have no other way
 * to touch the engine). Exercising its REAL triggerSynthNoteOn/stopSource
 * behaviour therefore means swapping the singleton's own internal state for
 * a fresh, fake-ctx-backed one — the same fields freshEngine() sets up for a
 * throwaway instance — and restoring the original afterwards.
 */
function withFakeAudioEngine() {
  const original = { ...(audioEngine as unknown as Record<string, unknown>) };
  const { engine, ctx } = freshEngine();
  Object.assign(audioEngine, engine);
  return {
    ctx,
    restore: () => {
      Object.assign(audioEngine, original);
    },
  };
}

describe('preview handle lifetimes', () => {
  test('the disposer silences a sounding preview note', () => {
    const { ctx, restore } = withFakeAudioEngine();
    try {
      const handle = previewSequencerNote('C4', SYNTH, 0.8);
      const voices = Array.from(
        (audioEngine as any).sourceVoices.get('preview') as Set<{ gains: { gain: { cancels: number[] } }[] }>,
      );
      expect(voices).toHaveLength(1);

      handle();

      expect(voices[0].gains[0].gain.cancels).toContain(ctx.currentTime);
    } finally {
      restore();
    }
  });

  test('the disposer hard-silences a preview note scheduled but not yet started', () => {
    const { ctx, restore } = withFakeAudioEngine();
    try {
      // A 2-chord progression schedules its 2nd chord in the future relative
      // to ctx.currentTime.
      const chords: ChordItem[] = [
        { id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4'] },
        { id: 'c2', root: 'G', quality: 'maj', bars: 1, notes: ['G4'] },
      ];
      const handle = previewChordProgression(chords, SYNTH);

      const voices = Array.from(
        (audioEngine as any).sourceVoices.get('preview') as Set<{ startTime: number }>,
      );
      const future = voices.find((v) => v.startTime > ctx.currentTime);
      expect(future).toBeTruthy();

      handle();

      // stopSource hard-silences (removes from tracking) any voice whose
      // startTime is still in the future, rather than ramping it from the
      // GainNode's intrinsic 1.0.
      const after = (audioEngine as any).sourceVoices.get('preview') as Set<unknown>;
      expect(after.has(future)).toBe(false);
    } finally {
      restore();
    }
  });

  test('disposing the same handle twice does not throw', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const handle = previewSequencerNote('C4', SYNTH, 0.8);
      handle();
      expect(() => handle()).not.toThrow();
    } finally {
      restore();
    }
  });

  test('a superseded handle is a no-op once a newer preview has started', () => {
    const { ctx, restore } = withFakeAudioEngine();
    try {
      const stale = previewSequencerNote('C4', SYNTH, 0.8);
      // Starting a 2nd preview intentionally cuts the 1st (existing
      // behaviour); the returned handle for the 1st preview must not be able
      // to reach into the 2nd preview it no longer owns.
      const current = previewSequencerNote('E4', SYNTH, 0.8);

      const voices = Array.from(
        (audioEngine as any).sourceVoices.get('preview') as Set<{
          noteName: string;
          gains: { gain: { cancels: number[] } }[];
        }>,
      );
      const currentVoice = voices.find((v) => v.noteName === 'E4')!;
      expect(currentVoice).toBeTruthy();

      stale();
      expect(currentVoice.gains[0].gain.cancels).not.toContain(ctx.currentTime);

      current();
      expect(currentVoice.gains[0].gain.cancels).toContain(ctx.currentTime);
    } finally {
      restore();
    }
  });
});

import {
  PREVIEW_CHORD_DURATION,
  PREVIEW_LOOKAHEAD_SEC,
  chordsDueBy,
  previewChordProgression as previewProgression,
  type PreviewScheduler,
} from './presetPreview';

describe('chordsDueBy', () => {
  test('schedules only the chords whose start time is inside the horizon', () => {
    // start 10, 0.5 s per chord -> chord i starts at 10 + i*0.5
    expect(chordsDueBy(16, 10, 0.5, 0, 11.5)).toBe(4); // chords 0..3 start at 10, 10.5, 11, 11.5
  });

  test('an exact boundary start time is included', () => {
    expect(chordsDueBy(16, 10, 0.5, 0, 10)).toBe(1);
  });

  test('it never returns less than nextIndex', () => {
    expect(chordsDueBy(16, 10, 0.5, 6, 10)).toBe(6);
  });

  test('it clamps to the chord count', () => {
    expect(chordsDueBy(4, 10, 0.5, 0, 1000)).toBe(4);
  });

  test('an empty progression is a no-op', () => {
    expect(chordsDueBy(0, 10, 0.5, 0, 1000)).toBe(0);
  });

  test('the shipped lookahead keeps three chords in flight at the shipped duration', () => {
    expect(chordsDueBy(16, 0, PREVIEW_CHORD_DURATION, 0, PREVIEW_LOOKAHEAD_SEC)).toBe(4);
  });
});

/** A scheduler a test drives by hand: no timers, no clock, no sleeping. */
function fakeScheduler(startNow: number) {
  const ticks = new Set<() => void>();
  const state = {
    now: startNow,
    subscribed: 0,
    unsubscribed: 0,
    advanceTo(t: number) {
      state.now = t;
      for (const tick of Array.from(ticks)) tick();
    },
  };
  const scheduler: PreviewScheduler = {
    now: () => state.now,
    subscribe: (tick) => {
      state.subscribed++;
      ticks.add(tick);
      return () => {
        state.unsubscribed++;
        ticks.delete(tick);
      };
    },
  };
  return { scheduler, state };
}

const sixteenChords: ChordItem[] = Array.from({ length: 16 }, (_, i) => ({
  id: `c${i}`,
  root: 'C',
  quality: 'maj',
  bars: 1,
  notes: ['C4', 'E4', 'G4', 'B4'],
}));

describe('progression audition streams instead of bursting', () => {
  test('the click handler schedules only the lookahead window, not all 16 chords', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);

      const voices = (audioEngine as any).sourceVoices.get('preview') as Set<unknown>;
      // 4 chords inside the 1.5 s horizon x 4 notes = 16 voices, not 64.
      expect(voices.size).toBe(16);
    } finally {
      restore();
    }
  });

  test('advancing the clock schedules the next chords and nothing earlier twice', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);

      const voices = (audioEngine as any).sourceVoices.get('preview') as Set<{ noteName: string }>;
      const afterFirst = voices.size;

      state.advanceTo(11.0); // horizon 12.5 -> chords 0..5 due, 4 already done
      expect(voices.size).toBe(afterFirst + 8);

      state.advanceTo(11.0); // same time again: nothing new
      expect(voices.size).toBe(afterFirst + 8);
    } finally {
      restore();
    }
  });

  test('the whole progression is eventually scheduled, in order', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);
      state.advanceTo(20);

      const voices = Array.from(
        (audioEngine as any).sourceVoices.get('preview') as Set<{ startTime: number }>,
      );
      expect(voices.length).toBe(64);
      const starts = Array.from(new Set(voices.map((v) => v.startTime))).sort((a, b) => a - b);
      expect(starts).toEqual(sixteenChords.map((_, i) => 10 + i * PREVIEW_CHORD_DURATION));
    } finally {
      restore();
    }
  });

  test('the subscription is dropped once the last chord is scheduled', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);
      expect(state.subscribed).toBe(1);
      expect(state.unsubscribed).toBe(0);

      state.advanceTo(20);
      expect(state.unsubscribed).toBe(1);
    } finally {
      restore();
    }
  });

  test('the disposer stops the stream and silences what is already scheduled', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      const handle = previewProgression(sixteenChords, SYNTH, scheduler);

      handle();
      expect(state.unsubscribed).toBe(1);

      const before = ((audioEngine as any).sourceVoices.get('preview') as Set<unknown>).size;
      state.advanceTo(20);
      // No further chords are scheduled after disposal.
      expect(((audioEngine as any).sourceVoices.get('preview') as Set<unknown>).size)
        .toBeLessThanOrEqual(before);
    } finally {
      restore();
    }
  });

  test('a superseded audition stops streaming when a newer one starts', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const a = fakeScheduler(10);
      const b = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, a.scheduler);
      previewProgression(sixteenChords, SYNTH, b.scheduler);

      expect(a.state.unsubscribed).toBe(1);
    } finally {
      restore();
    }
  });

  test('a short progression that fits inside the horizon never subscribes', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      previewProgression(sixteenChords.slice(0, 2), SYNTH, scheduler);
      expect(state.subscribed).toBe(0);
    } finally {
      restore();
    }
  });
});

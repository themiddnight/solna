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

      // Task 6: stopSource hard-silences (removes from tracking) any voice
      // whose startTime is still in the future, rather than ramping it from
      // the GainNode's intrinsic 1.0.
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

import { describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../engine';
import { freshEngine } from '../testFakes';
import type { ChordItem } from '@/types';
import type { ActiveSynth } from '@/types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { generateBlockChordNotes, noteFrequency } from '@/utils/musicTheory';
import { previewChordProgression, previewSequencerNote, previewSynthPatch } from './presetPreview';
import {
  resetNoteInputListeners,
  subscribeNoteInput,
  type NoteInputEvent,
} from './noteInputBus';

/* eslint-disable @typescript-eslint/no-explicit-any -- tests deliberately
   reach private engine fields (sourceVoices) via casts, same as engine.test.ts. */

const SYNTH: ActiveSynth<'subtractive'> = SUBTRACTIVE_INIT;

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

/**
 * The voice groups the manager is holding on the shared preview bus.
 *
 * One entry per NOTE-ON (a unison stack is one group), with the resolved
 * frequency it sounds, the audio-clock instant it starts and whether it has
 * been released.
 * Reached through the manager's private map because the engine deliberately
 * exposes no per-source voice accessor — a public one would be a door into
 * voice state for `src/components/`, which may not have it.
 */
interface PreviewGroup {
  frequency: number;
  startedAt: number;
  releasing: boolean;
  voices: { nodes: { ampGain: { gain: { cancels: number[] } } } }[];
}

function previewGroups(): PreviewGroup[] {
  const manager = (audioEngine as any).synthManager;
  return Array.from((manager?.groups.get('preview') ?? []) as Iterable<PreviewGroup>);
}

describe('preview handle lifetimes', () => {
  test('the disposer silences a sounding preview note', () => {
    const { ctx, restore } = withFakeAudioEngine();
    try {
      const handle = previewSequencerNote('C4', SYNTH, 0.8);
      const groups = previewGroups();
      expect(groups).toHaveLength(1);

      handle();

      expect(groups[0].voices[0].nodes.ampGain.gain.cancels).toContain(ctx.currentTime);
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
        { id: 'c1', root: 'C', quality: 'maj', bars: 1 },
        { id: 'c2', root: 'G', quality: 'maj', bars: 1 },
      ];
      const handle = previewChordProgression(chords, SYNTH);

      const future = previewGroups().find((g) => g.startedAt > ctx.currentTime);
      expect(future).toBeTruthy();

      handle();

      // stopSource reaches a voice whose note-on is still ahead of the clock,
      // not only the ones already sounding — otherwise every chord the
      // audition had queued would play on after the panel was closed.
      expect(future!.releasing).toBe(true);
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
    const { restore } = withFakeAudioEngine();
    try {
      const stale = previewSequencerNote('C4', SYNTH, 0.8);
      // Starting a 2nd preview intentionally cuts the 1st (existing
      // behaviour); the returned handle for the 1st preview must not be able
      // to reach into the 2nd preview it no longer owns.
      const current = previewSequencerNote('E4', SYNTH, 0.8);

      const currentGroup = previewGroups().find((g) => g.frequency === noteFrequency('E4'))!;
      expect(currentGroup).toBeTruthy();
      const cancels = currentGroup.voices[0].nodes.ampGain.gain.cancels;
      const before = cancels.length;

      stale();
      expect(cancels.length).toBe(before);

      current();
      expect(cancels.length).toBeGreaterThan(before);
    } finally {
      restore();
    }
  });
});

describe('previewSequencerNote default gate', () => {
  // SequencerView's row preview passes no options at all, so this default IS
  // that surface's behaviour. The melody grid used to reach in and shorten it
  // to 0.22 s at its own call site; it now passes a musical length instead,
  // and this pins the default so a future edit there cannot drift the drum
  // rows with it.
  test('holds 0.5 s when the caller states no length', () => {
    const { restore } = withFakeAudioEngine();
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    const offSpy = spyOn(audioEngine, 'triggerSynthNoteOff');
    try {
      const handle = previewSequencerNote('C4', SYNTH, 0.8);
      const startedAt = onSpy.mock.calls[0][3] as number;
      const releasedAt = offSpy.mock.calls[0][2] as number;
      expect(releasedAt - startedAt).toBeCloseTo(0.5, 10);
      handle();
    } finally {
      onSpy.mockRestore();
      offSpy.mockRestore();
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

// maj7 so each chord derives exactly 4 notes (C4 E4 G4 B4), preserving the
// note-count arithmetic below now that notes are derived, not stored.
const sixteenChords: ChordItem[] = Array.from({ length: 16 }, (_, i) => ({
  id: `c${i}`,
  root: 'C',
  quality: 'maj7',
  bars: 1,
}));

describe('progression audition streams instead of bursting', () => {
  test('the click handler schedules only the lookahead window, not all 16 chords', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);

      // 4 chords inside the 1.5 s horizon x 4 notes = 16 voices, not 64.
      expect(previewGroups()).toHaveLength(16);
    } finally {
      restore();
    }
  });

  test('advancing the clock schedules the next chords and nothing earlier twice', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);

      const afterFirst = previewGroups().length;

      state.advanceTo(11.0); // horizon 12.5 -> chords 0..5 due, 4 already done
      expect(previewGroups()).toHaveLength(afterFirst + 8);

      state.advanceTo(11.0); // same time again: nothing new
      expect(previewGroups()).toHaveLength(afterFirst + 8);
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

      const groups = previewGroups();
      expect(groups.length).toBe(64);
      const starts = Array.from(new Set(groups.map((g) => g.startedAt))).sort((a, b) => a - b);
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

      const before = previewGroups().length;
      state.advanceTo(20);
      // No further chords are scheduled after disposal.
      expect(previewGroups().length).toBeLessThanOrEqual(before);
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

describe('a grid audition is not a performance', () => {
  test('it sounds on the preview bus, never on the one holding the played keys', () => {
    const { restore } = withFakeAudioEngine();
    try {
      previewSequencerNote('C4', SYNTH, 0.8, { holdSec: 0.22, releaseSec: 0.5 });

      // Its own bus, not the one carrying the player's held keys: a disposer
      // firing on 'synth' would cut whatever the player is holding, and the
      // separation is what keeps an audition from ever reaching it.
      const manager = (audioEngine as any).synthManager;
      expect((manager.groups.get('synth') as Set<unknown> | undefined)?.size ?? 0).toBe(0);
      expect(previewGroups()).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test('it says nothing on the note-input bus, so an armed recorder ignores it', () => {
    const { restore } = withFakeAudioEngine();
    const events: NoteInputEvent[] = [];
    subscribeNoteInput((e) => events.push(e));
    try {
      previewSequencerNote('C4', SYNTH, 0.8);
      // Clicking a cell to hear what you drew is not performing a note. If it
      // announced itself, recording and clicking would write the cell twice.
      expect(events).toEqual([]);
    } finally {
      resetNoteInputListeners();
      restore();
    }
  });
});

describe('a preview auditions the patch it is handed', () => {
  // The per-preset trim lookup this block used to guard is gone: a patch
  // carries its own `common.outputGainDb`, so there is no per-source trim map
  // for one audition to leave behind for the next. What is left to prove HERE
  // is the bridge's own contract — each entry point hands the engine the
  // complete patch it was given, on the shared preview bus, as a 'preview'
  // voice. That the level then follows `outputGainDb` is asserted where the
  // envelope is built, in `synth/subtractiveVoice.test.ts`.
  const LOUD: ActiveSynth<'subtractive'> = {
    ...SYNTH,
    patch: { ...SYNTH.patch, common: { ...SYNTH.patch.common, outputGainDb: -3 } },
  };

  test('previewSequencerNote plays the patch it was given, on the preview bus', () => {
    const { restore } = withFakeAudioEngine();
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    try {
      previewSequencerNote('C4', LOUD, 0.8);
      const [freq, synth, velocity, , source, scaleFactor, owner] = onSpy.mock.calls[0];
      expect([freq, synth, velocity, source, scaleFactor, owner]).toEqual(
        [noteFrequency('C4'), LOUD, 0.8, 'preview', 1, 'preview'],
      );
    } finally {
      onSpy.mockRestore();
      restore();
    }
  });

  test('previewSynthPatch plays the patch it was given, not a merge over another', () => {
    const { restore } = withFakeAudioEngine();
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    try {
      previewSynthPatch(LOUD);
      const [freq, synth, , , source, scaleFactor, owner] = onSpy.mock.calls[0];
      expect([freq, synth, source, scaleFactor, owner]).toEqual(
        [noteFrequency('C4'), LOUD, 'preview', 1, 'preview'],
      );
    } finally {
      onSpy.mockRestore();
      restore();
    }
  });

  test('plays notes derived from quality/root at the audition octave, not a stored array', () => {
    const { restore } = withFakeAudioEngine();
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    try {
      const chords: ChordItem[] = [{ id: 'p1', root: 'A', quality: 'min7', bars: 1 }];
      previewChordProgression(chords, SYNTH, undefined);
      const expected = generateBlockChordNotes('min7', 'A', 4).map((n) => noteFrequency(n));
      const played = onSpy.mock.calls.map((call) => call[0]);
      expect(played).toEqual(expected);
    } finally {
      onSpy.mockRestore();
      restore();
    }
  });

  test('previewChordProgression plays every note of a chord on the same patch', () => {
    const { restore } = withFakeAudioEngine();
    const onSpy = spyOn(audioEngine, 'triggerSynthNoteOn');
    try {
      previewChordProgression(
        [{ id: 'c1', root: 'C', quality: 'maj', bars: 1 }] as ChordItem[],
        LOUD,
      );
      expect(onSpy).toHaveBeenCalledTimes(3);
      for (const call of onSpy.mock.calls) expect(call[1]).toBe(LOUD);
    } finally {
      onSpy.mockRestore();
      restore();
    }
  });
});

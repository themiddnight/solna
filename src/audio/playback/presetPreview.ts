import { audioEngine } from '../engine';
import { DEFAULT_VELOCITY } from '../constants';
import type { SynthParams, ChordItem } from '../../types';
import { applyPreset, type SynthPresetItem } from '../synthPresets';

/**
 * One-shot previews for library entries (synth patches, chord templates,
 * sequencer rows). Components reach the engine only through these wrappers
 * (layering rule 3).
 */

/**
 * Auditions run on their own source bus. The default 'synth' bus carries the
 * user's held keyboard notes, so a disposer firing there would cut them.
 */
const PREVIEW_SOURCE = 'preview';

/** Stops whatever the preview scheduled. Always safe to call more than once. */
export type PreviewHandle = () => void;

const NOOP: PreviewHandle = () => undefined;

function stopAllPreviews(): void {
  audioEngine.stopSource(PREVIEW_SOURCE, 0.05);
}

// All three preview functions share one 'preview' bus, so a bare
// `stopAllPreviews` handle would let ANY caller's disposer cut every other
// audition in flight — e.g. React unmounting a stale ChordPresetLibrary
// disposer while SynthPresetLibrary's audition is still ringing. Each call to
// beginPreview() bumps the generation and stops whatever came before it (the
// existing "starting a new preview cuts the previous one" behaviour); the
// returned handle only acts if IT is still the most recent preview, so an
// old, already-superseded handle is a no-op instead of cutting a newer one.
let currentGeneration = 0;

let cancelCurrentStream: (() => void) | null = null;

/**
 * `onSupersede` is called when a NEWER preview starts. previewChordProgression
 * passes its unsubscribe here, so a superseded audition also stops feeding
 * the shared clock — otherwise it would keep scheduling chords onto the
 * 'preview' bus even though it no longer has a handle able to silence them.
 */
function beginPreview(onSupersede?: () => void): PreviewHandle {
  currentGeneration += 1;
  const generation = currentGeneration;
  cancelCurrentStream?.();
  cancelCurrentStream = onSupersede ?? null;
  stopAllPreviews();
  return () => {
    if (generation === currentGeneration) {
      cancelCurrentStream?.();
      cancelCurrentStream = null;
      stopAllPreviews();
    }
  };
}

/** Seconds each chord holds in an audition — the strum's step. */
export const PREVIEW_CHORD_DURATION = 0.5;

/**
 * How far ahead of the audio clock chords are allowed to be scheduled.
 *
 * 1.5 s is three chords at PREVIEW_CHORD_DURATION: comfortably more than the
 * 25 ms clock tick needs to stay ahead of the playhead, and far short of the
 * up to 8 s a 16-chord progression used to reserve in one synchronous burst.
 */
export const PREVIEW_LOOKAHEAD_SEC = 1.5;

/**
 * Exclusive end index of the chords whose start time is at or before
 * `horizon`, given `startTime` for chord 0 and `chordDuration` per chord.
 *
 * Pure so the streaming policy is testable without an AudioContext or a timer.
 */
export function chordsDueBy(
  chordCount: number,
  startTime: number,
  chordDuration: number,
  nextIndex: number,
  horizon: number,
): number {
  if (chordDuration <= 0) return chordCount;
  const due = Math.floor((horizon - startTime) / chordDuration) + 1;
  return Math.min(chordCount, Math.max(nextIndex, due));
}

/**
 * Clock source for a streaming audition. Injected so tests drive it
 * synchronously instead of sleeping; production passes the shared 16th-note
 * clock, which already runs a 25 ms lookahead timer.
 */
export interface PreviewScheduler {
  now(): number;
  subscribe(tick: () => void): () => void;
}

function liveScheduler(ctx: AudioContext): PreviewScheduler {
  return {
    now: () => ctx.currentTime,
    // subscribeClock starts the shared 25 ms timer if it is not already
    // running and stops it again once the last listener leaves and the
    // metronome is off. It never touches clockStepIndex/clockNextStepTime —
    // only resetClock() does, and nothing here calls it — so an audition
    // cannot move the transport grid the sequencer and chord players share.
    subscribe: (tick) => audioEngine.subscribeClock(() => tick()),
  };
}

/**
 * Chord progression audition: a quick strum through every chord in sequence.
 *
 * Streamed rather than burst: scheduling every chord synchronously in the
 * click handler meant a 16-chord progression created ~384 nodes and 64
 * pending teardown timers in one frame, with the tail reserved up to 8 s
 * ahead of the clock for no benefit. This keeps at most PREVIEW_LOOKAHEAD_SEC
 * of chords in flight and schedules the rest as the clock advances.
 *
 * Scheduled on the AUDIO clock rather than with setTimeout at wall-clock
 * offsets, and returns a disposer — previously, leaving the panel mid-audition
 * left every remaining chord queued in a timer with no way to cancel it. The
 * disposer also drops the clock subscription, so an abandoned audition stops
 * generating scheduling work, not just sound.
 */
export function previewChordProgression(
  chords: ChordItem[],
  params: SynthParams,
  scheduler?: PreviewScheduler,
): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  const clock = scheduler ?? liveScheduler(ctx);
  const startTime = clock.now();
  let unsubscribe: (() => void) | null = null;
  const stop = beginPreview(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  let nextIndex = 0;

  const scheduleDue = () => {
    const end = chordsDueBy(
      chords.length,
      startTime,
      PREVIEW_CHORD_DURATION,
      nextIndex,
      clock.now() + PREVIEW_LOOKAHEAD_SEC,
    );
    for (; nextIndex < end; nextIndex++) {
      const start = startTime + nextIndex * PREVIEW_CHORD_DURATION;
      for (const n of chords[nextIndex].notes) {
        audioEngine.triggerSynthNoteOn(n, params, 0.75, start, PREVIEW_SOURCE);
        audioEngine.triggerSynthNoteOff(
          n,
          0.3,
          start + PREVIEW_CHORD_DURATION * 0.85,
          PREVIEW_SOURCE,
        );
      }
    }
    if (nextIndex >= chords.length && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  scheduleDue();
  if (nextIndex < chords.length) {
    // A progression whose whole length fits inside the first window (the
    // common case — most library entries are a handful of chords) never
    // reaches here, so it costs exactly what it did before this change: one
    // synchronous burst, no clock subscription.
    unsubscribe = clock.subscribe(scheduleDue);
  }

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    stop();
  };
}

/** Synth preset audition: C4 with the preset merged over the current params. */
export function previewSynthPreset(
  preset: SynthPresetItem,
  currentParams: SynthParams,
): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  const testParams = applyPreset(currentParams, preset);
  const handle = beginPreview();
  const start = ctx.currentTime;
  audioEngine.triggerSynthNoteOn('C4', testParams, 0.85, start, PREVIEW_SOURCE);
  audioEngine.triggerSynthNoteOff('C4', testParams.release || 0.4, start + 0.45, PREVIEW_SOURCE);
  return handle;
}

/**
 * One-note audition: a sequencer row, or a melody-grid cell you clicked to
 * hear what you drew. A 0.5 s gate by default; `holdSec` and `releaseSec`
 * exist because the melody grid wants a shorter, drier blip, and giving it
 * its own function was how it ended up auditioning on the 'synth' bus and
 * cutting the player's held keys.
 *
 * Silent on the note-input bus by construction — it reaches the engine
 * directly — which is what a grid click needs: clicking a cell is not
 * performing a note, and an armed recorder must not write it a second time.
 */
export function previewSequencerNote(
  note: string,
  params: SynthParams,
  velocity = DEFAULT_VELOCITY,
  { holdSec = 0.5, releaseSec = 0.3 }: { holdSec?: number; releaseSec?: number } = {},
): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  const handle = beginPreview();
  const start = ctx.currentTime;
  audioEngine.triggerSynthNoteOn(note, params, velocity, start, PREVIEW_SOURCE);
  audioEngine.triggerSynthNoteOff(note, releaseSec, start + holdSec, PREVIEW_SOURCE);
  return handle;
}

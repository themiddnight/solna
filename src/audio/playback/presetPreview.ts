import { audioEngine } from '../engine';
import { DEFAULT_VELOCITY } from '../constants';
import type { SynthParams, ChordItem } from '../../types';
import type { SynthPresetItem } from '../synthPresets';

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

function stopPreview(): void {
  audioEngine.stopSource(PREVIEW_SOURCE, 0.05);
}

/**
 * Chord progression audition: a quick strum through every chord in sequence.
 *
 * Scheduled on the AUDIO clock rather than with setTimeout at wall-clock
 * offsets, and returns a disposer — previously, leaving the panel mid-audition
 * left every remaining chord queued in a timer with no way to cancel it.
 */
export function previewChordProgression(chords: ChordItem[], params: SynthParams): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  const chordDuration = 0.5;
  stopPreview();
  chords.forEach((chord, chordIdx) => {
    const start = ctx.currentTime + chordIdx * chordDuration;
    for (const n of chord.notes) {
      audioEngine.triggerSynthNoteOn(n, params, 0.75, start, PREVIEW_SOURCE);
      audioEngine.triggerSynthNoteOff(n, 0.3, start + chordDuration * 0.85, PREVIEW_SOURCE);
    }
  });
  return stopPreview;
}

/** Synth preset audition: C4 with the preset merged over the current params. */
export function previewSynthPreset(
  preset: SynthPresetItem,
  currentParams: SynthParams,
): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  // TODO(Task 11): swap for the shared `applyPreset` helper once it lands.
  const testParams: SynthParams = {
    ...currentParams,
    ...preset.params,
    preset: preset.name,
  };
  stopPreview();
  const start = ctx.currentTime;
  audioEngine.triggerSynthNoteOn('C4', testParams, 0.85, start, PREVIEW_SOURCE);
  audioEngine.triggerSynthNoteOff('C4', testParams.release || 0.4, start + 0.45, PREVIEW_SOURCE);
  return stopPreview;
}

/** Sequencer track audition (synth/bass rows): one note with a 0.5 s gate. */
export function previewSequencerNote(
  note: string,
  params: SynthParams,
  velocity = DEFAULT_VELOCITY,
): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  stopPreview();
  const start = ctx.currentTime;
  audioEngine.triggerSynthNoteOn(note, params, velocity, start, PREVIEW_SOURCE);
  audioEngine.triggerSynthNoteOff(note, 0.3, start + 0.5, PREVIEW_SOURCE);
  return stopPreview;
}

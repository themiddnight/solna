import { audioEngine } from '../engine';
import type { SynthParams, ChordItem } from '../../types';
import type { SynthPresetItem } from '../synthPresets';

/**
 * One-shot preview for library entries (synth patches and chord templates).
 * Bodies moved verbatim from ChordPresetLibrary.tsx / SynthPresetLibrary.tsx
 * so the components themselves never touch audio/engine (layering rule 3).
 */
export function previewSynthNote(note: string, params: SynthParams, velocity = 0.8, source = 'synth'): void {
  audioEngine.init();
  audioEngine.triggerSynthNoteOn(note, params, velocity, undefined, source);
}

/**
 * Chord progression audition: quick arpeggiated strum of all chords in
 * sequence. Body moved verbatim from ChordPresetLibrary.tsx handleAudition
 * (the component-side auditioning-name state stays in the wrapper).
 */
export function previewChordProgression(chords: ChordItem[], params: SynthParams): void {
  audioEngine.init();

  // Play quick arpeggiated strum of all chords in sequence
  const chordDurationMs = 500;
  chords.forEach((chord, chordIdx) => {
    setTimeout(() => {
      chord.notes.forEach((n) => {
        audioEngine.triggerSynthNoteOn(n, params, 0.75);
      });

      setTimeout(() => {
        chord.notes.forEach((n) => {
          audioEngine.triggerSynthNoteOff(n, 0.3);
        });
      }, chordDurationMs * 0.85);
    }, chordIdx * chordDurationMs);
  });
}

/**
 * Synth preset audition: plays C4 with the preset's params merged over the
 * current params. Body moved verbatim from SynthPresetLibrary.tsx handleAudition.
 */
export function previewSynthPreset(preset: SynthPresetItem, currentParams: SynthParams): void {
  audioEngine.init();
  const testParams: SynthParams = {
    ...currentParams,
    ...preset.params,
    preset: preset.name,
  };
  audioEngine.triggerSynthNoteOn('C4', testParams, 0.85);
  setTimeout(() => {
    audioEngine.triggerSynthNoteOff('C4', testParams.release || 0.4);
  }, 450);
}

/**
 * Sequencer track audition (synth/bass rows): init + one-shot note with a
 * fixed 500 ms note-off. Body moved verbatim from SequencerView.tsx (the
 * C2/C4 note choice stays in the view).
 */
export function previewSequencerNote(
  note: string,
  params: SynthParams,
  velocity = 0.8,
): void {
  audioEngine.init();
  audioEngine.triggerSynthNoteOn(note, params, velocity);
  setTimeout(() => audioEngine.triggerSynthNoteOff(note), 500);
}

import { audioEngine } from "../engine";
import { emitNoteInput } from "./noteInputBus";
import type { SynthParams } from "../../types";

// Thin engine bridge for SynthView's keyboard/arp handlers (layering rule 3):
// the view never touches audio/engine directly. The handlers keep all their
// logic (equal-power velocity scaling with held.size, arp state) — only the
// engine calls move here, one per wrapper, bodies verbatim.
export function initSynthPlayback(): void {
  audioEngine.init();
}

export function hasSynthPlaybackContext(): boolean {
  return !!audioEngine.getAudioContext();
}

export function applySynthPlaybackVelocityScale(scale: number): void {
  audioEngine.applySynthVelocityScale(scale);
}

/**
 * A note a PERSON played — the computer keyboard, the on-screen keyboard, a
 * MIDI device. Every one of those routes through here, and here is where the
 * note-input bus is told about it, so a feature that wants performed notes
 * subscribes once instead of being soldered onto each source.
 *
 * Two things deliberately do NOT come through here. Sequenced notes go to
 * playbackEngine, because a step the transport played is not a step the user
 * performed. Grid auditions go to previewSequencerNote, because clicking a
 * cell to hear what you just drew is not playing a note either — routing it
 * here would let a preview click record itself. That one also has to stay off
 * the 'synth' bus, which carries the notes the player is holding down.
 */
export function synthPlaybackNoteOn(
  note: string,
  params: SynthParams,
  velocity = 0.8,
  time?: number,
  target = "synth",
  scaleFactor = 1,
): void {
  audioEngine.triggerSynthNoteOn(
    note,
    params,
    velocity,
    time,
    target,
    scaleFactor,
  );
  // After the engine call, never before: a subscriber that throws must not be
  // able to swallow the note the user played.
  emitNoteInput({ kind: "on", note, velocity, time });
}

/** The release half of synthPlaybackNoteOn; announced on the same bus. */
export function synthPlaybackNoteOff(
  note: string,
  releaseTime = 0.3,
  time?: number,
  target = "synth",
): void {
  audioEngine.triggerSynthNoteOff(note, releaseTime, time, target);
  emitNoteInput({ kind: "off", note, velocity: 0, time });
}

export function releaseSynthPlaybackVoices(
  target: string,
  releaseTime = 0.1,
): void {
  audioEngine.releaseSoundingVoices(target, releaseTime);
}

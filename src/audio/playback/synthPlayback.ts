import { audioEngine } from "../engine";
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
}

export function synthPlaybackNoteOff(
  note: string,
  releaseTime = 0.3,
  time?: number,
  target = "synth",
): void {
  audioEngine.triggerSynthNoteOff(note, releaseTime, time, target);
}

export function releaseSynthPlaybackVoices(
  target: string,
  releaseTime = 0.1,
): void {
  audioEngine.releaseSoundingVoices(target, releaseTime);
}

import { audioEngine, STEPS_PER_BAR } from "../engine";
import type { SynthParams } from "../../types";

// Engine bridge for the component-layer playback hooks (layering rules 1+3):
// the store-reading hooks (useChordPlayback, useSequencerPlayback) moved out
// of audio/ into components/, and they reach the engine only through this
// module — audio/ owns the engine, components own store reads and the clock
// subscription.
export { STEPS_PER_BAR };

export function initPlaybackEngine(): void {
  audioEngine.init();
}

export function playbackNoteOn(
  noteName: string,
  params: SynthParams,
  velocity = 0.8,
  time?: number,
  source = "synth",
): void {
  audioEngine.triggerSynthNoteOn(noteName, params, velocity, time, source);
}

export function playbackNoteOff(
  noteName: string,
  releaseTime = 0.3,
  time?: number,
  source = "synth",
): void {
  audioEngine.triggerSynthNoteOff(noteName, releaseTime, time, source);
}

export function subscribePlaybackClock(
  listener: (step: number, beat: number, time: number) => void,
): () => void {
  return audioEngine.subscribeClock(listener);
}

/**
 * Silences a whole playback source — sounding voices AND hits already
 * scheduled ahead of the transport. `time` anchors the release on the audio
 * clock so a soft stop lands exactly on a bar line.
 */
export function playbackStopSource(
  source: string,
  releaseTime = 0.1,
  time?: number,
): void {
  audioEngine.stopSource(source, releaseTime, time);
}

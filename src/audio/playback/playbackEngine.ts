import { audioEngine } from "../engine";
import type { SynthParams } from "../../types";

// Engine bridge for the component-layer playback hooks (layering rules 1+3):
// the store-reading hooks (useChordPlayback, useSequencerPlayback) moved out
// of audio/ into components/, and they reach the engine only through this
// module — audio/ owns the engine, components own store reads and the clock
// subscription.

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
 * How long from NOW until `time` is actually heard, in seconds.
 *
 * The clock is a lookahead scheduler: it hands listeners the future
 * AudioContext time a step will sound at, tens of milliseconds before it
 * does. `outputLatency` is the further delay between the context reaching
 * that time and the sound leaving the speaker. Anything that should coincide
 * with what the user HEARS — a playhead, most of all — has to wait out both.
 *
 * Returns 0 when there is no context yet, or when `time` has already passed.
 */
export function playbackAudibleDelaySec(time: number): number {
  const now = playbackNowSec();
  if (now === null) return 0;
  return Math.max(0, time + playbackOutputLatencySec() - now);
}

/** The AudioContext's clock, or null when there is no context yet. */
export function playbackNowSec(): number | null {
  return audioEngine.getAudioContext()?.currentTime ?? null;
}

/**
 * The delay between the context reaching a time and the sound leaving the
 * speaker. Pure and separately exported because it is read in BOTH
 * directions: playbackAudibleDelaySec adds it to hold a playhead back until
 * the step is heard (DEV-376), and live lead capture subtracts it to place a
 * press at the moment the player actually reacted to (DEV-374).
 *
 * outputLatency is unimplemented on some browsers; baseLatency is the
 * conservative stand-in, and 0 is better than NaN in either case.
 */
export function outputLatencySec(
  ctx: { outputLatency?: number; baseLatency?: number } | null | undefined,
): number {
  if (!ctx) return 0;
  return ctx.outputLatency || ctx.baseLatency || 0;
}

export function playbackOutputLatencySec(): number {
  return outputLatencySec(audioEngine.getAudioContext());
}

/**
 * Release time for a HARD stop: short enough to read as an instant cut, long
 * enough not to click. Lives beside playbackStopSource, which owns the
 * semantics — it was declared verbatim in both note-based playback hooks, and
 * a tuning constant for an audible fade must not have two copies to drift.
 */
export const HARD_STOP_RELEASE = 0.02;

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

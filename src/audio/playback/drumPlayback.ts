import { audioEngine } from '../engine';

/**
 * `init()` is idempotent but not free — and triggerPad is called from inside
 * the sequencer's clock callback (useSequencerPlayback.ts), i.e. ~8x per
 * second during playback. Callers that fire on a user gesture call this once;
 * the per-step path does not call it at all.
 */
export function ensureDrumEngine(): void {
  audioEngine.init();
}

/**
 * Unified drum trigger for pads, sequencer steps, and previews. `time` is the
 * audio-clock time for scheduled hits (sequencer); undefined plays immediately.
 * Assumes the AudioContext already exists — call ensureDrumEngine() on the
 * gesture that starts playback, not per hit.
 */
export function triggerPad(instrument: string, volume: number, time?: number): void {
  audioEngine.triggerDrum(instrument, volume, time);
}

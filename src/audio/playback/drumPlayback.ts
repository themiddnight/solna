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
/**
 * `velocity` is a per-hit PERFORMANCE attribute in 0..1 (see the Velocity
 * brand in utils/gainUnits.ts), never a level. The Beat fader reaches the
 * drums exactly once, on the sequencer source bus, through engineSync's
 * setSourceGain('sequencer', …) — passing it here as well is what made drum
 * output proportional to the fader's square.
 */
export function triggerPad(instrument: string, velocity: number, time?: number): void {
  audioEngine.triggerDrum(instrument, velocity, time);
}

import { audioEngine } from '../engine';

/**
 * Unified drum trigger for pads, sequencer steps, and previews. `time` is the
 * audio-clock time for scheduled hits (sequencer); undefined plays immediately.
 */
export function triggerPad(instrument: string, volume: number, time?: number): void {
  audioEngine.init();
  audioEngine.triggerDrum(instrument, volume, time);
}

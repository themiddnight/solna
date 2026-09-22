/**
 * Builders for the stems tests. A `*Fixture` file: excluded from the
 * production Knip graph by name, like `mixdownFixture.ts`.
 */
import { beatPatternFixture, FACTORY_EFFECTS, mixdownLoop, mixdownMelodyBar, mixdownSnapshot } from './mixdownFixture';
import { STEM_TRACKS } from './renderStems';
import type { MixdownBusState, MixdownLoop, MixdownSnapshot } from '../playback/plan/songSnapshot';
import type { BeatPattern, BeatVoiceId, MasterEffects } from '@/types';

/** Every master stage neutral: wets 0, EQ bypassed, no compressor, no limiter. */
export const NEUTRAL_EFFECTS: MasterEffects = {
  ...FACTORY_EFFECTS,
  reverbWet: 0,
  delayWet: 0,
  distortionWet: 0,
  eqBypass: true,
  compressorEnabled: false,
  limiterEnabled: false,
};

/** Sends at 0 on every bus: nothing leaves a bus but its dry path. */
function drySends(buses: readonly MixdownBusState[]): MixdownBusState[] {
  return buses.map((bus) => ({ ...bus, sends: { reverb: 0, delay: 0, distortion: 0 } }));
}

/** One bar where all six tracks sound: chords (chord, bass, pad), a Lead bar, an FX bar, the kick. */
export function allTracksLoop(over: Partial<MixdownLoop> = {}): MixdownLoop {
  const loop = mixdownLoop({
    leadMelodySteps: mixdownMelodyBar('E4'),
    fxMelodySteps: mixdownMelodyBar('G5'),
    ...over,
  });
  return { ...loop, buses: over.buses ?? drySends(loop.buses) };
}

/** Neutral master, master volume 1, zero sends, one all-tracks loop. */
export function neutralSnapshot(over: Partial<MixdownSnapshot> = {}): MixdownSnapshot {
  const snapshot = mixdownSnapshot({ effects: NEUTRAL_EFFECTS, masterVolume: 1, loops: [allTracksLoop()] });
  return { ...snapshot, buses: drySends(snapshot.buses), ...over };
}

/** Every Beat row off. */
export function silentBeatPattern(): BeatPattern {
  const pattern = beatPatternFixture();
  for (const voice of Object.keys(pattern.rows) as BeatVoiceId[]) {
    pattern.rows[voice] = pattern.rows[voice].map(() => false);
  }
  return pattern;
}

/** Stem `name`'s left and right channels out of the multichannel stems buffer. */
export function stemChannels(buffer: AudioBuffer, name: string): [Float32Array, Float32Array] {
  const index = STEM_TRACKS.findIndex((track) => track.name === name);
  if (index < 0) throw new Error(`no stem named ${name}`);
  return [buffer.getChannelData(2 * index), buffer.getChannelData(2 * index + 1)];
}

export function maxAbsDiff(a: Float32Array, b: Float32Array, from = 0, to = a.length): number {
  let max = 0;
  for (let i = from; i < to; i += 1) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

export function peakOf(data: Float32Array, from = 0, to = data.length): number {
  let max = 0;
  for (let i = from; i < to; i += 1) max = Math.max(max, Math.abs(data[i]));
  return max;
}

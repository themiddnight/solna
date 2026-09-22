/* eslint-disable @typescript-eslint/no-explicit-any -- node-web-audio-api's
   context is cast at the seam, and the dry bus is a private rack field. */
import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { createRenderEngine } from './engine';
import { BEAT_PRESETS } from '@/data/beatPresets';
import { FACTORY_EFFECTS } from './export/mixdownFixture';
import type { TrackSendLevels } from '@/types';

/**
 * One snare (voice reverbSend 0.5) through a real render engine with the DRY
 * path muted, so the output is the effect returns alone. `wet` picks which
 * return is audible; distortion is always off.
 */
async function effectPeak(beat: TrackSendLevels, wet: { reverbWet: number; delayWet: number }): Promise<number> {
  const ctx: any = new OfflineAudioContext(2, Math.round(44100 * 0.6), 44100);
  const engine = createRenderEngine(ctx);
  const voices = structuredClone(BEAT_PRESETS[0].patch.voices);
  voices.snare.reverbSend = 0.5;
  engine.setDrumKit(voices, 0);
  engine.setMasterVolume(1);
  engine.updateEffects({ ...FACTORY_EFFECTS, ...wet, distortionWet: 0 });
  engine.setSourceSends('sequencer', beat, 0, 'settle');
  (engine as any).masterRack.dryGain.gain.value = 0;
  engine.triggerDrum('snare', 1, 0);
  const buffer: any = await ctx.startRendering();
  const data: Float32Array = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  return peak;
}

const REVERB_ONLY = { reverbWet: 1, delayWet: 0 };
const DELAY_ONLY = { reverbWet: 0, delayWet: 1 };

describe('Beat through the per-track sends (render engine)', () => {
  test('the voice reverbSend multiplies the Beat reverb send: send 0 leaves the reverb silent', async () => {
    expect(await effectPeak({ reverb: 0, delay: 0, distortion: 0 }, REVERB_ONLY)).toBeLessThan(1e-7);
    expect(await effectPeak({ reverb: 1, delay: 0, distortion: 0 }, REVERB_ONLY)).toBeGreaterThan(0);
  });

  test('the Beat delay send puts the kit on the delay return; 0 leaves it silent', async () => {
    expect(await effectPeak({ reverb: 0, delay: 1, distortion: 0 }, DELAY_ONLY)).toBeGreaterThan(0);
    expect(await effectPeak({ reverb: 0, delay: 0, distortion: 0 }, DELAY_ONLY)).toBeLessThan(1e-7);
  });
});

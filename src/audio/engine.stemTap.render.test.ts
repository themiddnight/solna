/* eslint-disable @typescript-eslint/no-explicit-any -- the engine's public
   surface is typed against the DOM's BaseAudioContext, and node-web-audio-api
   implements the same spec with its own classes; the casts are at the seam,
   in a test, as in engine.render.test.ts. */
import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { createRenderEngine, type AudioEngine } from './engine';
import { MIXDOWN_SEED, withSeededRandom } from './rng';
import { BEAT_PRESETS } from '@/data/beatPresets';

function offlineCtx(): any {
  return new OfflineAudioContext(2, Math.round(44100 * 0.25), 44100);
}

function peak(buffer: any): number {
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data: Float32Array = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]));
  }
  return max;
}

/** One kick at t=0 on a fresh render engine, seeded, then rendered. */
async function renderKick(
  build: (ctx: any) => AudioEngine,
  before: (engine: AudioEngine, ctx: any) => void = () => {},
): Promise<any> {
  const ctx = offlineCtx();
  await withSeededRandom(MIXDOWN_SEED, () => {
    const engine = build(ctx);
    engine.setDrumKit(BEAT_PRESETS[0].patch.voices, 0);
    engine.setMasterVolume(1);
    before(engine, ctx);
    engine.triggerDrum('kick', 1, 0);
  });
  return ctx.startRendering();
}

describe('createRenderEngine(ctx, { masterOutput })', () => {
  test('a detached master output leaves the destination silent', async () => {
    const buffer = await renderKick((ctx) => createRenderEngine(ctx, { masterOutput: ctx.createGain() }));
    expect(peak(buffer)).toBe(0);
  });

  test('without options the master still reaches the destination', async () => {
    const buffer = await renderKick((ctx) => createRenderEngine(ctx));
    expect(peak(buffer)).toBeGreaterThan(0);
  });
});

describe('connectSourceStem', () => {
  test('carries the bus output with no master stage: master volume 0 does not silence it', async () => {
    const buffer = await renderKick(
      (ctx) => createRenderEngine(ctx, { masterOutput: ctx.createGain() }),
      (engine, ctx) => {
        engine.setMasterVolume(0);
        engine.connectSourceStem('sequencer', ctx.destination);
      },
    );
    expect(peak(buffer)).toBeGreaterThan(0);
  });

  test('is taken after the fader and mute: a muted bus sends nothing down the stem', async () => {
    const buffer = await renderKick(
      (ctx) => createRenderEngine(ctx, { masterOutput: ctx.createGain() }),
      (engine, ctx) => {
        engine.setSourceState('sequencer', { gain: 1, muted: true }, 0, 'settle');
        engine.connectSourceStem('sequencer', ctx.destination);
      },
    );
    expect(peak(buffer)).toBe(0);
  });

  test('an edge to an unconnected node changes nothing the destination receives', async () => {
    const plain = await renderKick((ctx) => createRenderEngine(ctx));
    const tapped = await renderKick(
      (ctx) => createRenderEngine(ctx),
      (engine, ctx) => engine.connectSourceStem('sequencer', ctx.createGain()),
    );
    for (let c = 0; c < 2; c += 1) {
      expect(tapped.getChannelData(c)).toEqual(plain.getChannelData(c));
    }
  });
});

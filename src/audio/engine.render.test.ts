/* eslint-disable @typescript-eslint/no-explicit-any -- the engine's public
   surface is typed against the DOM's BaseAudioContext, and node-web-audio-api
   implements the same spec with its own class objects. The casts are at the
   seam, in a test, and nowhere in src/audio/export/. */
import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { AudioEngine, createRenderEngine } from './engine';
import { DEFAULT_DRUM_KIT } from '@/data/drumKits';
import { synthParamsFixture } from './testFakes';

/** A real offline context, at the app's working rate and channel count. */
function offlineCtx(seconds: number): any {
  return new OfflineAudioContext(2, Math.round(44100 * seconds), 44100);
}

describe('createRenderEngine', () => {
  test('returns a fresh AudioEngine bound to the context it was handed', () => {
    const ctx = offlineCtx(0.1);
    const engine = createRenderEngine(ctx);
    expect(engine).toBeInstanceOf(AudioEngine);
    expect(engine.getAudioContext()).toBe(ctx as unknown as BaseAudioContext);
  });

  test('builds the master chain, so a bus exists and a kick makes sound', async () => {
    const ctx = offlineCtx(0.25);
    const engine = createRenderEngine(ctx);
    engine.setDrumKit(DEFAULT_DRUM_KIT, 'default');
    engine.setMasterVolume(1);
    engine.triggerDrum('kick', 1, 0);
    const buffer: any = await ctx.startRendering();
    const data: Float32Array = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    // A seam that bound the context but never ran setupMasterChain() would
    // render a perfectly well-formed, perfectly silent buffer, and the
    // instance assertions above would all still pass.
    expect(peak).toBeGreaterThan(0);
  });

  test('a synth voice survives wall-clock delay until the offline timeline renders it', async () => {
    const ctx = offlineCtx(0.5);
    const engine = createRenderEngine(ctx);
    const params = synthParamsFixture({ release: 0.05 });
    engine.setMasterVolume(1);
    engine.triggerSynthNoteOn('C4', params, 1, 0, 'synth', 1, 'sequencer');
    engine.triggerSynthNoteOff('C4', params.release, 0.05, 'synth');

    // The release used to arm a wall-clock teardown for 200 ms. A long
    // offline render could therefore disconnect this voice before its audio
    // timeline was processed, while drum one-shots remained intact.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const buffer: any = await ctx.startRendering();
    const data: Float32Array = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    expect(peak).toBeGreaterThan(0);
  });

  test('each call gets its OWN engine — the singleton is never reused', () => {
    const a = createRenderEngine(offlineCtx(0.05));
    const b = createRenderEngine(offlineCtx(0.05));
    expect(a).not.toBe(b);
  });
});

describe('getAudioContext on a render engine', () => {
  test('is the offline context, not an AudioContext', () => {
    const ctx = offlineCtx(0.05);
    const engine = createRenderEngine(ctx);
    const widened = engine.getAudioContext();
    // The field is BaseAudioContext | null, and this is the test that the
    // widening actually happened rather than the field quietly staying
    // realtime. `startRendering` is the spec's offline-only member and
    // `baseLatency` its realtime-only one — deliberately NOT `state`, which
    // lives on BaseAudioContext and is present ("suspended") on an
    // OfflineAudioContext, exactly like `resume()` and `suspend()`. Those three
    // being shared is why every realtime-only path in the engine narrows back
    // through realtimeCtx() on `startRendering` instead.
    expect(widened).not.toBeNull();
    expect(typeof widened?.currentTime).toBe('number');
    expect(typeof (widened as any).startRendering).toBe('function');
    expect((widened as any).baseLatency).toBeUndefined();
  });
});

describe('a render engine never takes the idle path', () => {
  test('no idle timer is armed and no suspend() is called on the offline context', () => {
    const ctx = offlineCtx(0.05);
    const engine = createRenderEngine(ctx);
    engine.setDrumKit(DEFAULT_DRUM_KIT, 'default');
    let suspendCalls = 0;
    ctx.suspend = () => {
      suspendCalls += 1;
      return Promise.resolve();
    };

    // triggerDrum reaches wakeIfIdle on every event, and maybeSuspendNow is what
    // the idle timer would eventually call. An OfflineAudioContext has BOTH
    // `resume` and `state` ("suspended") and a `suspend` that requires an
    // argument, so a narrowing test that accepted either of those would arm a
    // timer here and reject with "1 argument required, but only 0 present".
    engine.triggerDrum('kick', 1, 0);
    engine.wakeIfIdle();
    (engine as any).maybeSuspendNow();

    expect((engine as any).idleTimer).toBeNull();
    expect(suspendCalls).toBe(0);
    expect((engine as any).suspendedForIdle).toBe(false);
  });
});

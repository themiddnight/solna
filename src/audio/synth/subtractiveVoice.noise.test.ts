import { describe, expect, test } from 'bun:test';
import type { EnginePatch, SubtractiveParams } from '@/types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { dbToGain } from '@/utils/synthPatch';
import {
  asAudioContext,
  fakeVoiceContext,
  type FakeVoiceContext,
  type FakeVoiceNode,
  type FakeVoiceSource,
  type LoggedParam,
} from '../engineTestHelpers';
import { createSubtractiveVoice, type SubtractiveVoiceEvent } from './subtractiveVoice';

/**
 * The voice's noise source: how it is built, and what a LIVE patch change may
 * and may not do to it — split out of `subtractiveVoice.test.ts` only because
 * that file reached the 750-line gate. Same fixtures, same casts.
 */
const wiring = (node: unknown): FakeVoiceNode => node as unknown as FakeVoiceNode;
const source = (node: unknown): FakeVoiceSource => node as unknown as FakeVoiceSource;
const logged = (param: unknown): LoggedParam => param as unknown as LoggedParam;

const INIT = SUBTRACTIVE_INIT.patch;

function patchWith(synth: Partial<SubtractiveParams>): EnginePatch<'subtractive'> {
  return { common: INIT.common, synth: { ...INIT.synth, ...synth } };
}

function noteEvent(over: Partial<SubtractiveVoiceEvent> = {}): SubtractiveVoiceEvent {
  return { source: 'synth', owner: 'live', noteName: 'C4', velocity: 1, at: 2, ...over };
}

function build(ctx: FakeVoiceContext, patch: EnginePatch<'subtractive'>, event = noteEvent()) {
  const output = ctx.createGain();
  const voice = createSubtractiveVoice(asAudioContext(ctx), patch, event, {
    output: output as unknown as AudioNode,
  });
  return { voice, output };
}

describe('createSubtractiveVoice noise source', () => {
  const noisePatch = (color: 'white' | 'pink' | 'brown') =>
    patchWith({ utility: { ...INIT.synth.utility, noiseEnabled: true, noiseColor: color, noiseLevelDb: -12 } });

  test('an enabled noise source loops one buffer cached per context and color', () => {
    const ctx = fakeVoiceContext(8_000);
    const first = build(ctx, noisePatch('white')).voice;
    const second = build(ctx, noisePatch('white')).voice;
    const pink = build(ctx, noisePatch('pink')).voice;

    expect(ctx.bufferSources).toHaveLength(3);
    expect(first.nodes.noise).not.toBeNull();
    expect(source(first.nodes.noise).startArgs).toEqual([2]);
    expect(ctx.bufferSources[0].loop).toBe(true);
    // Same context, same color: the identical buffer object, not an equal one.
    expect(ctx.bufferSources[1].buffer).toBe(ctx.bufferSources[0].buffer);
    expect(ctx.bufferSources[2].buffer).not.toBe(ctx.bufferSources[0].buffer);
    expect(second.nodes.noiseGain).not.toBeNull();
    expect(pink.nodes.noise).not.toBeNull();
  });

  test('a second context gets its own buffer — a buffer belongs to the context that made it', () => {
    const ctxA = fakeVoiceContext(8_000);
    const ctxB = fakeVoiceContext(8_000);
    build(ctxA, noisePatch('white'));
    build(ctxB, noisePatch('white'));

    expect(ctxB.bufferSources[0].buffer).not.toBe(ctxA.bufferSources[0].buffer);
  });
});

describe('SubtractiveVoice noise update', () => {
  /**
   * The noise source is a STARTED `AudioBufferSourceNode`: it can be given
   * neither a new buffer nor a first one mid-note without a click, so
   * `noiseEnabled` and `noiseColor` are deferred to the next note-on. The flat
   * engine this replaced added and removed the node on a live voice instead;
   * these three pin the replacement's DECISION, which until now lived only in
   * a comment inside `updateUtility`.
   */
  test('a noise-enable change builds no node on a live voice, and the next note gets it', () => {
    const ctx = fakeVoiceContext();
    const previous = patchWith({ utility: { ...INIT.synth.utility, noiseEnabled: false } });
    const { voice } = build(ctx, previous);
    const sourcesBefore = ctx.bufferSources.length;
    const next = patchWith({
      utility: { ...previous.synth.utility, noiseEnabled: true, noiseLevelDb: -6 },
    });

    voice.update(previous, next, 7);

    expect(ctx.bufferSources.length).toBe(sourcesBefore);
    expect(voice.nodes.noise).toBeNull();
    expect(voice.nodes.noiseGain).toBeNull();

    expect(build(ctx, next, noteEvent({ at: 9 })).voice.nodes.noise).not.toBeNull();
  });

  test('a noise-disable change neither silences nor stops the sounding voice', () => {
    const ctx = fakeVoiceContext();
    const previous = patchWith({
      utility: { ...INIT.synth.utility, noiseEnabled: true, noiseLevelDb: -12 },
    });
    const { voice } = build(ctx, previous);
    const gain = logged(voice.nodes.noiseGain?.gain);
    expect(gain.events).toHaveLength(0);

    voice.update(
      previous,
      patchWith({ utility: { ...previous.synth.utility, noiseEnabled: false } }),
      7,
    );

    expect(gain.events).toHaveLength(0);
    expect(source(voice.nodes.noise).stopArgs).toEqual([]);
    expect(wiring(voice.nodes.noise).disconnects).toBe(0);
  });

  test('the noise LEVEL knob, unlike enable and color, does reach a sounding voice', () => {
    const ctx = fakeVoiceContext();
    const previous = patchWith({
      utility: { ...INIT.synth.utility, noiseEnabled: true, noiseColor: 'white', noiseLevelDb: -12 },
    });
    const { voice } = build(ctx, previous);
    const noiseBuffer = (voice.nodes.noise as unknown as { buffer: unknown }).buffer;
    const gain = logged(voice.nodes.noiseGain?.gain);

    voice.update(
      previous,
      patchWith({ utility: { ...previous.synth.utility, noiseColor: 'pink', noiseLevelDb: -24 } }),
      7,
    );

    // The color moved and the buffer did not: a re-buffer would need a restart.
    expect((voice.nodes.noise as unknown as { buffer: unknown }).buffer).toBe(noiseBuffer);
    expect(gain.events).toHaveLength(1);
    expect(gain.events[0][0]).toBe('set');
    expect(gain.events[0][1]).toBeCloseTo(dbToGain(-24), 10);
    expect(gain.events[0][2]).toBe(7);
  });
});

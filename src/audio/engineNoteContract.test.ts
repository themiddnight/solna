/**
 * The engine's note contract, at its public surface (DEV-399).
 *
 * Every assertion here is about the CONTRACT, not the DSP: a note-on takes a
 * resolved frequency and returns the identity a note-off addresses; an owner
 * scopes a release; a bus-wide stop is a different method with a different
 * reach. The audible result of any one note is `subtractiveVoice.test.ts`'s
 * subject, not this file's.
 *
 * `liveVoiceCount()` counts every physical voice INCLUDING one still in a
 * release tail (see its own docstring on `AudioEngine`), and a release tail
 * here is a real `setTimeout` the fake context never advances — so it cannot
 * tell "this specific id was released" from "nothing happened yet". The
 * `registered` map a voice id addresses IS cleared synchronously by every
 * release path, exactly like `voiceManager.test.ts` already asserts at the
 * manager level (`has(id)`); the reach-and-identity tests below read that
 * same fact off the engine's own `synthManager`, typed against the real
 * exported `SynthVoiceManager` rather than a locally re-declared shape.
 */
import { describe, expect, test } from 'bun:test';
import { noteFrequency } from '../utils/musicTheory';
import { freshEngine, makeEngine, type EngineInstance } from './testFakes';
import { ACTIVE_SYNTH } from './engineTestHelpers';
import type { SynthVoiceManager } from './synth/voiceManager';

const C4 = noteFrequency('C4');
const E4 = noteFrequency('E4');

/** ACTIVE_SYNTH in Mono, with a glide long enough to be a bend rather than a step. */
const MONO_SYNTH = {
  ...ACTIVE_SYNTH,
  patch: {
    ...ACTIVE_SYNTH.patch,
    common: { ...ACTIVE_SYNTH.patch.common, voiceMode: 'mono' as const, glideSeconds: 0.1 },
  },
};

/** The engine's private voice manager, typed against the real exported class. */
function synthManagerOf(engine: EngineInstance): SynthVoiceManager {
  return (engine as unknown as { synthManager: SynthVoiceManager }).synthManager;
}

describe('engine note contract: identity', () => {
  test('a note-on at a frequency returns an id, and two note-ons at the SAME frequency return different ids', () => {
    const { engine } = freshEngine();
    const first = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live');
    const second = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'sequencer');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(engine.liveVoiceCount()).toBe(2);
  });

  test('a note-off releases exactly the voice its id names, leaving the other sounding', () => {
    const { engine } = freshEngine();
    const live = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    const sequencer = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'sequencer')!;
    engine.triggerSynthNoteOff(live, 0.3, 0);
    const synthManager = synthManagerOf(engine);
    expect(synthManager.has(live)).toBe(false);
    expect(synthManager.has(sequencer)).toBe(true);
  });

  test('a note-on before the AudioContext exists returns null and sounds nothing', () => {
    const engine = makeEngine();
    expect(engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, undefined, 'synth', 1, 'live')).toBeNull();
  });
});

describe('engine note contract: owners', () => {
  test('releaseSoundingVoices reaches ONE owner on ONE bus and no other', () => {
    const { engine } = freshEngine();
    const live = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    const arpSynth = engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'arp')!;
    const arpBass = engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'bass', 1, 'arp')!;
    engine.releaseSoundingVoices('synth', 0.05, 'arp');
    const synthManager = synthManagerOf(engine);
    // the live voice on 'synth' and the arp voice on 'bass' both survive.
    expect(synthManager.has(live)).toBe(true);
    expect(synthManager.has(arpBass)).toBe(true);
    // only the arp voice on the named bus is reached.
    expect(synthManager.has(arpSynth)).toBe(false);
  });

  test('stopSource is whole-bus: it reaches every owner on that bus', () => {
    const { engine } = freshEngine();
    const live = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    const arp = engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'arp')!;
    const bassSeq = engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'bass', 1, 'sequencer')!;
    engine.stopSource('synth', 0.05, 0);
    const synthManager = synthManagerOf(engine);
    // Both owners on 'synth' are gone — that is the difference from the test
    // above, and it is what a project install, a loop load and a vibe swap
    // rely on.
    expect(synthManager.has(live)).toBe(false);
    expect(synthManager.has(arp)).toBe(false);
    // Only the other BUS survives.
    expect(synthManager.has(bassSeq)).toBe(true);
  });
});

describe('engine note contract: a focus change mid-hold', () => {
  test('a note started on one bus is released on the bus it was started on, whatever is focused now', () => {
    const { engine } = freshEngine();
    // The keyboard's bus follows focusTrack, so a hold can span a change: the
    // id, not the current focus, is what the release addresses.
    const held = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    const bassNote = engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'bass', 1, 'live')!;
    engine.triggerSynthNoteOff(held, 0.3, 0);
    const synthManager = synthManagerOf(engine);
    expect(synthManager.has(held)).toBe(false);
    // ...the voice on the bus focus moved TO is untouched by that release.
    expect(synthManager.has(bassNote)).toBe(true);
    engine.stopSource('bass', 0.05, 0);
    expect(synthManager.has(bassNote)).toBe(false);
  });
});

describe('engine note contract: glide', () => {
  test('a second note on a mono bus bends the sounding voice rather than building a new one', () => {
    const { engine } = freshEngine();
    const first = engine.triggerSynthNoteOn(C4, MONO_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    const second = engine.triggerSynthNoteOn(E4, MONO_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    expect(second).not.toBe(first);
    // One SOUNDING voice, two held ids: the bus is shared and the stack is
    // what every decision about it is taken on.
    expect(engine.liveVoiceCount()).toBe(1);
    const synthManager = synthManagerOf(engine);
    expect(synthManager.has(first)).toBe(true);
    expect(synthManager.has(second)).toBe(true);
    engine.triggerSynthNoteOff(second, 0.3, 0);
    // Releasing the more recently held id bends the voice back to the one
    // still on the stack rather than tearing it down.
    expect(synthManager.has(second)).toBe(false);
    expect(synthManager.has(first)).toBe(true);
    expect(engine.liveVoiceCount()).toBe(1);
    engine.triggerSynthNoteOff(first, 0.3, 0);
    // The stack is now empty: the voice itself releases.
    expect(synthManager.has(first)).toBe(false);
  });
});

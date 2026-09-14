import { describe, expect, test } from 'bun:test';
import type { EnginePatch, SubtractiveParams } from '@/types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { noteFrequency } from '@/utils/musicTheory';
import {
  asAudioContext,
  fakeVoiceContext,
  type FakeVoiceContext,
  type LoggedParam,
} from '../engineTestHelpers';
import { createSubtractiveVoice, type SubtractiveVoiceEvent } from './subtractiveVoice';

/**
 * `SubtractiveVoice.glideTo` and the retune path that has to survive it —
 * split out of `subtractiveVoice.test.ts` only because that file reached the
 * 750-line gate. Same fixtures, same casts.
 */
const logged = (param: unknown): LoggedParam => param as unknown as LoggedParam;

const INIT = SUBTRACTIVE_INIT.patch;

function patchWith(synth: Partial<SubtractiveParams>, common: Partial<EnginePatch<'subtractive'>['common']> = {}): EnginePatch<'subtractive'> {
  return {
    common: { ...INIT.common, ...common },
    synth: { ...INIT.synth, ...synth },
  };
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

const C4 = noteFrequency('C4');
const E4 = noteFrequency('E4');
const C5 = noteFrequency('C5');

/** Osc 1 at unity, osc 2 a fifth up, the sub an octave down: three different ratios to follow. */
function glidePatch(over: Partial<SubtractiveParams> = {}): EnginePatch<'subtractive'> {
  return patchWith({
    oscillators: [
      { ...INIT.synth.oscillators[0], enabled: true },
      { ...INIT.synth.oscillators[1], enabled: true, semitone: 7 },
    ],
    utility: { ...INIT.synth.utility, subEnabled: true, subOctave: -1 },
    ...over,
  }, { glideSeconds: 0.4 });
}

describe('SubtractiveVoice glide', () => {

  test('ramps every pitched source to the new note exponentially, each keeping its own tuning', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, glidePatch(), noteEvent({ at: 2 }));

    voice.glideTo('E4', 2.5, 0.4);

    const fifth = Math.pow(2, 7 / 12);
    for (const [param, ratio] of [
      [logged(ctx.oscillators[0].frequency), 1],
      [logged(ctx.oscillators[1].frequency), fifth],
      [logged(ctx.oscillators[2].frequency), 0.5],
    ] as const) {
      expect(param.events[0]).toEqual(['cancel', 2.5]);
      expect(param.events[1][0]).toBe('set');
      expect(param.events[1][1]).toBeCloseTo(C4 * ratio, 6);
      expect(param.events[2][0]).toBe('exp');
      expect(param.events[2][1]).toBeCloseTo(E4 * ratio, 6);
      expect(param.events[2][2]).toBeCloseTo(2.9, 6);
    }
  });

  test('a glide of zero moves the pitch on the instant with no ramp at all', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, glidePatch(), noteEvent({ at: 2 }));

    voice.glideTo('E4', 3, 0);

    const events = logged(ctx.oscillators[0].frequency).events;
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(['cancel', 3]);
    expect(events[1][0]).toBe('set');
    expect(events[1][1]).toBeCloseTo(E4, 6);
  });

  test('a glide booked mid-flight anchors where the ramp WILL be, not at the note it started from', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, glidePatch(), noteEvent({ at: 2 }));

    voice.glideTo('C5', 2, 1);
    voice.glideTo('E4', 2.5, 0.5);

    const events = logged(ctx.oscillators[0].frequency).events;
    // Halfway through an octave glide, in the exponential space the ramp runs in.
    expect(events[3]).toEqual(['cancel', 2.5]);
    expect(events[4][1]).toBeCloseTo(C4 * Math.sqrt(C5 / C4), 6);
  });

  test('a tuning change mid-glide bends to the new tuning instead of being discarded', () => {
    const ctx = fakeVoiceContext();
    const patch = glidePatch();
    const { voice } = build(ctx, patch, noteEvent({ at: 2 }));

    voice.glideTo('C5', 2, 1);
    voice.update(patch, patchWith({
      oscillators: [
        { ...patch.synth.oscillators[0], octave: 1 },
        patch.synth.oscillators[1],
      ],
      utility: patch.synth.utility,
    }, { glideSeconds: 0.4 }), 2.5);

    const events = logged(ctx.oscillators[0].frequency).events;
    // The knob lands NOW, on the value the glide is passing through...
    expect(events[4][1]).toBeCloseTo(C4 * Math.sqrt(C5 / C4) * 2, 6);
    // ...and the glide still arrives, at the NEW tuning and its original end time.
    expect(events[5][0]).toBe('exp');
    expect(events[5][1]).toBeCloseTo(C5 * 2, 6);
    expect(events[5][2]).toBeCloseTo(3, 6);
  });

  test('a tuning change before a glide BOOKED AHEAD does not drag the glide earlier', () => {
    const ctx = fakeVoiceContext();
    const patch = glidePatch();
    const { voice } = build(ctx, patch, noteEvent({ at: 2 }));

    voice.glideTo('C5', 5, 1);
    voice.update(patch, patchWith({
      oscillators: [
        { ...patch.synth.oscillators[0], octave: 1 },
        patch.synth.oscillators[1],
      ],
      utility: patch.synth.utility,
    }, { glideSeconds: 0.4 }), 3);

    const events = logged(ctx.oscillators[0].frequency).events;
    expect(events[3]).toEqual(['cancel', 3]);
    // The knob lands at 3 and is HELD there until the glide is actually due...
    expect(events[4][1]).toBeCloseTo(C4 * 2, 6);
    expect(events[4][2]).toBe(3);
    expect(events[5][1]).toBeCloseTo(C4 * 2, 6);
    expect(events[5][2]).toBe(5);
    // ...and only then does the booked glide run, to its own end time.
    expect(events[6][0]).toBe('exp');
    expect(events[6][1]).toBeCloseTo(C5 * 2, 6);
    expect(events[6][2]).toBe(6);
  });

  test('the voice reports the note it is now sounding, not the note that built it', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, glidePatch(), noteEvent({ at: 2 }));

    expect(voice.noteName).toBe('C4');
    voice.glideTo('E4', 3, 0.4);
    expect(voice.noteName).toBe('E4');
  });

});

describe('SubtractiveVoice glide and the filter', () => {
  test('a key-tracked cutoff follows the glide', () => {
    const ctx = fakeVoiceContext();
    const patch = glidePatch({ filter: { ...INIT.synth.filter, cutoffHz: 4000, keyTrack: 1 } });
    const { voice } = build(ctx, patch, noteEvent({ at: 2 }));

    voice.glideTo('C5', 2, 0.4);

    const events = logged(ctx.filters[0].frequency).events;
    expect(events[1][1]).toBeCloseTo(4000, 6);
    expect(events[2][0]).toBe('exp');
    expect(events[2][1]).toBeCloseTo(8000, 6);
  });

  test('a cutoff with no key tracking does not move with the note', () => {
    const ctx = fakeVoiceContext();
    const patch = glidePatch({ filter: { ...INIT.synth.filter, cutoffHz: 4000, keyTrack: 0 } });
    const { voice } = build(ctx, patch, noteEvent({ at: 2 }));

    voice.glideTo('C5', 2, 0.4);

    expect(logged(ctx.filters[0].frequency).events).toEqual([]);
  });

  test('a cutoff ENV2 owns is left to its contour rather than re-anchored by the glide', () => {
    const ctx = fakeVoiceContext();
    const patch = glidePatch({
      filter: { ...INIT.synth.filter, cutoffHz: 4000, keyTrack: 1 },
      env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 24 }],
    });
    const { voice } = build(ctx, patch, noteEvent({ at: 2 }));
    const before = logged(ctx.filters[0].frequency).events.length;

    voice.glideTo('C5', 2, 0.4);

    expect(logged(ctx.filters[0].frequency).events).toHaveLength(before);
  });

  test('a later patch update tunes from the note now sounding', () => {
    const ctx = fakeVoiceContext();
    const patch = glidePatch();
    const { voice } = build(ctx, patch, noteEvent({ at: 2 }));

    voice.glideTo('E4', 3, 0);
    voice.update(patch, patchWith({
      oscillators: [
        { ...patch.synth.oscillators[0], octave: 1 },
        patch.synth.oscillators[1],
      ],
      utility: patch.synth.utility,
    }, { glideSeconds: 0.4 }), 4);

    const events = logged(ctx.oscillators[0].frequency).events;
    expect(events[events.length - 1][1]).toBeCloseTo(E4 * 2, 6);
  });
});

import { describe, expect, test } from 'bun:test';
import type { ActiveSynth, CommonVoiceParams, EnginePatch } from '@/types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { asAudioContext, fakeVoiceContext, type LoggedParam } from '../engineTestHelpers';
import { createSubtractiveVoice, type SubtractiveVoice } from './subtractiveVoice';
import type { LfoParams } from '@/types/synth';
import {
  SynthVoiceManager,
  type ManagedVoice,
  type SynthVoiceFactory,
  type SynthVoiceManagerOptions,
  type SynthVoiceNoteOn,
} from './voiceManager';

const logged = (param: unknown): LoggedParam => param as unknown as LoggedParam;

/**
 * A voice that records what the manager asked of it. The manager's whole
 * subject is WHICH voice is addressed and WHEN, so every assertion here reads
 * a call log rather than an audio graph; the two tests that care about the
 * graph (unison equal power) wrap the real `createSubtractiveVoice` instead.
 */
interface FakeVoice extends ManagedVoice {
  noteName: string;
  releases: [number, number][];
  glides: [string, number, number][];
  stops: number[];
  disconnects: number;
  updates: [EnginePatch<'subtractive'>, EnginePatch<'subtractive'>, number][];
  polyphonyScales: [number, number][];
  unisonIndex: number;
}

function recordingFactory(): { create: SynthVoiceFactory; created: FakeVoice[] } {
  const created: FakeVoice[] = [];
  const create: SynthVoiceFactory = (_ctx, _patch, event) => {
    const voice: FakeVoice = {
      id: `fake-${created.length + 1}`,
      source: event.source,
      owner: event.owner,
      noteName: event.noteName,
      startedAt: event.at,
      unisonIndex: event.unisonIndex ?? 0,
      releases: [],
      glides: [],
      stops: [],
      disconnects: 0,
      updates: [],
      polyphonyScales: [],
      lfoDestination: () => null,
      release(at, seconds) {
        voice.releases.push([at, seconds]);
      },
      glideTo(noteName, at, seconds) {
        voice.noteName = noteName;
        voice.glides.push([noteName, at, seconds]);
      },
      update(previous, next, at) {
        voice.updates.push([previous, next, at]);
      },
      setPolyphonyScale(scale, at) {
        voice.polyphonyScales.push([scale, at]);
      },
      stopSources(at) {
        voice.stops.push(at);
      },
      disconnect() {
        voice.disconnects += 1;
      },
    };
    created.push(voice);
    return voice;
  };
  return { create, created };
}

interface FakeTimer {
  delayMs: number;
  callback: () => void;
  cancelled: boolean;
}

function synthWith(common: Partial<CommonVoiceParams>): ActiveSynth<'subtractive'> {
  return {
    ...SUBTRACTIVE_INIT,
    patch: {
      ...SUBTRACTIVE_INIT.patch,
      common: { ...SUBTRACTIVE_INIT.patch.common, ...common },
    },
  };
}

/** The same sound arriving as a different library entry — what applying a preset produces. */
function presetNamed(id: string): ActiveSynth<'subtractive'> {
  return { ...SUBTRACTIVE_INIT, sourcePresetId: id };
}

const MONO = synthWith({ voiceMode: 'mono', glideSeconds: 0.1 });
const MONO_NO_GLIDE = synthWith({ voiceMode: 'mono', glideSeconds: 0 });

function harness(over: Partial<SynthVoiceManagerOptions> = {}) {
  const ctx = fakeVoiceContext();
  const output = ctx.createGain() as unknown as AudioNode;
  const timers: FakeTimer[] = [];
  const factory = recordingFactory();
  const manager = new SynthVoiceManager({
    ctx: asAudioContext(ctx),
    destinationsFor: () => ({ output }),
    createVoice: factory.create,
    schedule: (callback, delayMs) => {
      const timer: FakeTimer = { delayMs, callback, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    ...over,
  });
  const runTimers = () => {
    for (const timer of timers.splice(0)) {
      if (!timer.cancelled) timer.callback();
    }
  };
  return { manager, ctx, timers, runTimers, created: factory.created };
}

/**
 * The manager driving REAL voices. Needed wherever the assertion is about an
 * envelope rather than about which voice was addressed — a recording double
 * cannot see a gain level, which is how a release-over-a-release click went
 * unnoticed by a test that only counted calls.
 */
function realHarness(over: Partial<SynthVoiceManagerOptions> = {}) {
  const real: SubtractiveVoice[] = [];
  const createVoice: SynthVoiceFactory = (ctx, patch, noteEvent, destinations) => {
    const voice = createSubtractiveVoice(ctx, patch, noteEvent, destinations);
    real.push(voice);
    return voice;
  };
  return { ...harness({ createVoice, ...over }), real };
}

/** Full level until note-off, so every envelope anchor below is an exact number. */
const FLAT: ActiveSynth<'subtractive'> = {
  ...SUBTRACTIVE_INIT,
  patch: {
    common: { ...SUBTRACTIVE_INIT.patch.common, outputGainDb: 0, velocityToAmplitude: 0 },
    synth: {
      ...SUBTRACTIVE_INIT.patch.synth,
      ampEnvelope: { attack: 0, decay: 0, sustain: 1, release: 1 },
    },
  },
};

function event(over: Partial<SynthVoiceNoteOn> = {}): SynthVoiceNoteOn {
  return {
    source: 'synth',
    owner: 'live',
    noteName: 'C4',
    velocity: 1,
    at: 1,
    synth: SUBTRACTIVE_INIT,
    ...over,
  };
}

describe('SynthVoiceManager voice identity', () => {
  test('a key-up on one owner cannot cut short another owner playing the same note', () => {
    const { manager } = harness();

    const live = manager.noteOn(event({ owner: 'live', noteName: 'C4' }));
    const arp = manager.noteOn(event({ owner: 'arp', noteName: 'C4' }));
    manager.noteOff(arp!, 2, 0.1);

    expect(manager.has(live!)).toBe(true);
    expect(manager.has(arp!)).toBe(false);
  });

  test('the same owner retriggering the same note gets a second, separately addressable voice', () => {
    const { manager, created } = harness();

    const first = manager.noteOn(event({ noteName: 'C4', at: 1 }));
    const second = manager.noteOn(event({ noteName: 'C4', at: 2 }));

    expect(first).not.toBe(second);
    expect(created).toHaveLength(2);

    manager.noteOff(first!, 3, 0.2);

    expect(created[0].releases).toEqual([[3, 0.2]]);
    expect(created[1].releases).toEqual([]);
    expect(manager.has(second!)).toBe(true);
  });

  test('a note-on booked in the future is a live voice from the moment it is booked', () => {
    const { manager, created } = harness();

    const scheduled = manager.noteOn(event({ at: 30 }));

    expect(manager.has(scheduled!)).toBe(true);
    expect(created[0].startedAt).toBe(30);
    expect(manager.liveVoiceCount()).toBe(1);
  });

  test('releaseOwner releases that owner on that source and leaves every other voice alone', () => {
    const { manager, created } = harness();

    const live = manager.noteOn(event({ owner: 'live', noteName: 'C4' }));
    const arpLow = manager.noteOn(event({ owner: 'arp', noteName: 'E4' }));
    const arpHigh = manager.noteOn(event({ owner: 'arp', noteName: 'G4' }));
    const otherBus = manager.noteOn(event({ owner: 'arp', noteName: 'E4', source: 'bass' }));

    manager.releaseOwner('synth', 'arp', 4, 0.25);

    expect(manager.has(live!)).toBe(true);
    expect(manager.has(arpLow!)).toBe(false);
    expect(manager.has(arpHigh!)).toBe(false);
    expect(manager.has(otherBus!)).toBe(true);
    expect(created.map((voice) => voice.releases)).toEqual([[], [[4, 0.25]], [[4, 0.25]], []]);
  });

  test('stopSource silences every owner on that bus and nothing on any other bus', () => {
    const { manager, created } = harness();

    const live = manager.noteOn(event({ owner: 'live' }));
    const sequenced = manager.noteOn(event({ owner: 'sequencer', noteName: 'E4' }));
    const bass = manager.noteOn(event({ source: 'bass' }));

    manager.stopSource('synth', 5);

    expect(manager.has(live!)).toBe(false);
    expect(manager.has(sequenced!)).toBe(false);
    expect(manager.has(bass!)).toBe(true);
    expect(created[0].releases).toHaveLength(1);
    expect(created[1].releases).toHaveLength(1);
    expect(created[2].releases).toEqual([]);
  });

  test('teardown disconnects only the voice whose id was released', () => {
    const { manager, created, runTimers } = harness();

    const first = manager.noteOn(event({ noteName: 'C4' }));
    manager.noteOn(event({ noteName: 'E4' }));
    manager.noteOff(first!, 2, 0.3);
    runTimers();

    expect(created[0].disconnects).toBe(1);
    expect(created[1].disconnects).toBe(0);
    expect(manager.liveVoiceCount()).toBe(1);
  });

  test('noteOff of an id that has already been released does nothing at all', () => {
    const { manager, created } = harness();

    const voice = manager.noteOn(event());
    manager.noteOff(voice!, 2, 0.3);
    manager.noteOff(voice!, 3, 0.3);

    expect(created[0].releases).toEqual([[2, 0.3]]);
  });

  test('a source with no destination yet creates no voice and returns null', () => {
    const { manager, created } = harness({ destinationsFor: () => null });

    expect(manager.noteOn(event())).toBeNull();
    expect(created).toEqual([]);
  });
});

describe('SynthVoiceManager mono legato', () => {
  test('the first mono note builds exactly one voice and glides nothing', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 1 }));

    expect(created).toHaveLength(1);
    expect(created[0].startedAt).toBe(1);
    expect(created[0].glides).toEqual([]);
  });

  test('an overlapping note reuses the sounding voice and glides instead of retriggering', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 1 }));
    const e4 = manager.noteOn(event({ synth: MONO, noteName: 'E4', at: 2 }));

    expect(created).toHaveLength(1);
    expect(created[0].glides).toEqual([['E4', 2, 0.1]]);
    expect(created[0].releases).toEqual([]);
    expect(manager.has(e4!)).toBe(true);
    expect(manager.liveVoiceCount()).toBe(1);
  });

  test('releasing the top note glides back to the note still held underneath', () => {
    const { manager, created } = harness();

    const c4 = manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 1 }));
    const e4 = manager.noteOn(event({ synth: MONO, noteName: 'E4', at: 2 }));
    manager.noteOff(e4!, 3, 0.4);

    expect(created[0].glides).toEqual([
      ['E4', 2, 0.1],
      ['C4', 3, 0.1],
    ]);
    expect(created[0].releases).toEqual([]);
    expect(manager.has(c4!)).toBe(true);
    expect(manager.has(e4!)).toBe(false);
  });

  test('a glide of zero moves the pitch immediately and still does not retrigger', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ synth: MONO_NO_GLIDE, noteName: 'C4', at: 1 }));
    manager.noteOn(event({ synth: MONO_NO_GLIDE, noteName: 'E4', at: 2 }));

    expect(created).toHaveLength(1);
    expect(created[0].glides).toEqual([['E4', 2, 0]]);
    expect(created[0].releases).toEqual([]);
  });

  test('releasing the last held note releases the voice and tears it down', () => {
    const { manager, created, runTimers } = harness();

    const c4 = manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 1 }));
    const e4 = manager.noteOn(event({ synth: MONO, noteName: 'E4', at: 2 }));
    manager.noteOff(e4!, 3, 0.4);
    manager.noteOff(c4!, 4, 0.4);
    runTimers();

    expect(created[0].releases).toEqual([[4, 0.4]]);
    expect(created[0].stops).toEqual([4.4]);
    expect(created[0].disconnects).toBe(1);
    expect(manager.liveVoiceCount()).toBe(0);
  });

  test('a note-on after the mono voice has been released starts a fresh voice', () => {
    const { manager, created } = harness();

    const c4 = manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 1 }));
    manager.noteOff(c4!, 2, 0.4);
    manager.noteOn(event({ synth: MONO, noteName: 'E4', at: 3 }));

    expect(created).toHaveLength(2);
    expect(created[1].startedAt).toBe(3);
  });

  test("one owner's key-up never removes another owner's stack entry", () => {
    const { manager, created } = harness();

    const held = manager.noteOn(event({ synth: MONO, owner: 'live', noteName: 'C4', at: 1 }));
    const arp = manager.noteOn(event({ synth: MONO, owner: 'arp', noteName: 'E4', at: 2 }));
    manager.noteOff(arp!, 3, 0.4);

    expect(created[0].releases).toEqual([]);
    expect(created[0].glides).toEqual([
      ['E4', 2, 0.1],
      ['C4', 3, 0.1],
    ]);
    expect(manager.has(held!)).toBe(true);
  });

  test("an owner-scoped release drops only that owner's entries and glides to what is left", () => {
    const { manager, created } = harness();

    const live = manager.noteOn(event({ synth: MONO, owner: 'live', noteName: 'C4', at: 1 }));
    const arp = manager.noteOn(event({ synth: MONO, owner: 'arp', noteName: 'E4', at: 2 }));
    manager.releaseOwner('synth', 'arp', 3, 0.4);

    expect(manager.has(live!)).toBe(true);
    expect(manager.has(arp!)).toBe(false);
    expect(created[0].releases).toEqual([]);
    expect(created[0].glides[1]).toEqual(['C4', 3, 0.1]);
  });

  test("releasing the underneath note keeps the top note sounding and does not re-glide", () => {
    const { manager, created } = harness();

    const c4 = manager.noteOn(event({ synth: MONO, owner: 'live', noteName: 'C4', at: 1 }));
    const e4 = manager.noteOn(event({ synth: MONO, owner: 'arp', noteName: 'E4', at: 2 }));
    manager.noteOff(c4!, 3, 0.4);

    expect(created[0].releases).toEqual([]);
    expect(created[0].glides).toEqual([['E4', 2, 0.1]]);
    expect(manager.has(e4!)).toBe(true);
  });

  test('stopSource empties the mono stack so the next note starts a new voice', () => {
    const { manager, created } = harness();

    const c4 = manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 1 }));
    manager.stopSource('synth', 2);
    manager.noteOn(event({ synth: MONO, noteName: 'E4', at: 3 }));

    expect(manager.has(c4!)).toBe(false);
    expect(created).toHaveLength(2);
    expect(created[0].releases).toHaveLength(1);
  });
});

describe('SynthVoiceManager poly allocation and unison', () => {
  test('poly gives every note-on its own independent voice', () => {
    const { manager, created } = harness();

    const first = manager.noteOn(event({ noteName: 'C4', at: 1 }));
    const second = manager.noteOn(event({ noteName: 'E4', at: 2 }));

    expect(created).toHaveLength(2);
    expect(created[0].glides).toEqual([]);
    expect(manager.liveVoiceCount()).toBe(2);

    manager.noteOff(first!, 3, 0.2);

    expect(created[1].releases).toEqual([]);
    expect(manager.has(second!)).toBe(true);
  });

  test('a unison note-on is ONE logical voice made of one physical voice per member', () => {
    const { manager, created } = harness();

    const id = manager.noteOn(event({ synth: synthWith({ unisonVoices: 3 }), at: 1 }));

    expect(created.map((voice) => voice.unisonIndex)).toEqual([0, 1, 2]);
    expect(manager.liveVoiceCount()).toBe(3);

    manager.noteOff(id!, 2, 0.3);

    expect(created.map((voice) => voice.releases)).toEqual([
      [[2, 0.3]],
      [[2, 0.3]],
      [[2, 0.3]],
    ]);
  });

  test('unison members share the equal-power normalisation the voice itself applies', () => {
    const real: SubtractiveVoice[] = [];
    const createVoice: SynthVoiceFactory = (ctx, patch, noteEvent, destinations) => {
      const voice = createSubtractiveVoice(ctx, patch, noteEvent, destinations);
      real.push(voice);
      return voice;
    };
    const { manager } = harness({ createVoice });

    manager.noteOn(event({ synth: synthWith({ unisonVoices: 4, outputGainDb: 0 }), at: 1 }));

    expect(real).toHaveLength(4);
    const peaks = real.map((voice) => {
      const ramp = logged(voice.nodes.ampGain.gain).events.find(([kind]) => kind === 'ramp');
      return ramp?.[1];
    });
    for (const peak of peaks) {
      expect(peak).toBeCloseTo(1 / Math.sqrt(4), 10);
    }
  });
});

describe('SynthVoiceManager voice stealing', () => {
  const budget = { maxVoicesPerSource: 2 };

  test('a voice already releasing is stolen before any held voice, and never lifted back up', () => {
    const { manager, real } = realHarness(budget);

    const first = manager.noteOn(event({ synth: FLAT, noteName: 'C4', at: 0 }));
    manager.noteOn(event({ synth: FLAT, noteName: 'E4', at: 1 }));
    manager.noteOff(first!, 2, 4);
    const untouched = logged(real[1].nodes.ampGain.gain).events.length;
    manager.noteOn(event({ synth: FLAT, noteName: 'G4', at: 3 }));

    // A quarter of the way down a four-second tail. Anchoring at sustain here
    // would snap the gain back to full and fade it over 20 ms — a click.
    const stolen = logged(real[0].nodes.ampGain.gain).events;
    expect(stolen[stolen.length - 2][1]).toBeCloseTo(0.75, 6);
    expect(stolen[stolen.length - 1]).toEqual(['ramp', 0, 3.02]);
    // The held voice is the one that was NOT chosen.
    expect(logged(real[1].nodes.ampGain.gain).events).toHaveLength(untouched);
  });

  test('a stolen voice stops answering has() and lets go of its group', () => {
    const { manager, created, runTimers } = harness({ maxVoicesPerSource: 1 });

    const first = manager.noteOn(event({ noteName: 'C4', at: 0 }));
    manager.noteOn(event({ noteName: 'E4', at: 1 }));

    expect(created[0].releases).toEqual([[1, 0.02]]);
    expect(manager.has(first!)).toBe(false);

    runTimers();

    expect(manager.liveVoiceCount()).toBe(1);
  });

  test('a voice scheduled in the future is never stolen', () => {
    const { manager, created } = harness(budget);

    manager.noteOn(event({ noteName: 'C4', at: 0 }));
    manager.noteOn(event({ noteName: 'E4', at: 10 }));
    manager.noteOn(event({ noteName: 'G4', at: 3 }));

    expect(created[0].releases).toEqual([[3, 0.02]]);
    expect(created[1].releases).toEqual([]);
  });

  test('the oldest held voice is the last resort', () => {
    const { manager, created } = harness(budget);

    manager.noteOn(event({ noteName: 'C4', at: 0 }));
    manager.noteOn(event({ noteName: 'E4', at: 1 }));
    manager.noteOn(event({ noteName: 'G4', at: 2 }));

    expect(created[0].releases).toEqual([[2, 0.02]]);
    expect(created[1].releases).toEqual([]);
    expect(created[2].releases).toEqual([]);
  });

  test('nothing is stolen when every other voice is still scheduled ahead', () => {
    const { manager, created } = harness(budget);

    manager.noteOn(event({ noteName: 'C4', at: 10 }));
    manager.noteOn(event({ noteName: 'E4', at: 11 }));
    manager.noteOn(event({ noteName: 'G4', at: 3 }));

    expect(created.map((voice) => voice.releases)).toEqual([[], [], []]);
  });

  test('the mono voice a player is holding is never the victim', () => {
    const { manager, created } = harness({ maxVoicesPerSource: 1 });

    const held = manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 0 }));
    manager.noteOn(event({ noteName: 'G4', at: 1 }));
    manager.noteOn(event({ synth: MONO, noteName: 'E4', at: 2 }));

    expect(created[0].releases).toEqual([]);
    expect(created[0].glides).toEqual([['E4', 2, 0.1]]);
    expect(manager.has(held!)).toBe(true);
  });

  test('the budget is per source — a busy bus never steals from a quiet one', () => {
    const { manager, created } = harness(budget);

    manager.noteOn(event({ noteName: 'C4', at: 0, source: 'bass' }));
    manager.noteOn(event({ noteName: 'C4', at: 1 }));
    manager.noteOn(event({ noteName: 'E4', at: 2 }));
    manager.noteOn(event({ noteName: 'G4', at: 3 }));

    expect(created[0].releases).toEqual([]);
    expect(created[1].releases).toEqual([[3, 0.02]]);
  });
});

describe('SynthVoiceManager teardown lifecycle', () => {
  test('release schedules the stop on the audio clock and the disconnect on the wall clock', () => {
    const { manager, created, timers, ctx } = harness();
    ctx.currentTime = 2;

    const voice = manager.noteOn(event({ at: 2 }));
    manager.noteOff(voice!, 3, 0.5);

    expect(created[0].stops).toEqual([3.5]);
    expect(created[0].disconnects).toBe(0);
    expect(timers).toHaveLength(1);
    expect(timers[0].delayMs).toBeCloseTo(1500, 6);

    timers[0].callback();

    expect(created[0].disconnects).toBe(1);
  });

  test('an offline render stops on the audio clock and never disconnects', () => {
    const ctx = fakeVoiceContext() as ReturnType<typeof fakeVoiceContext> & { startRendering: () => void };
    ctx.startRendering = () => {};
    const output = ctx.createGain() as unknown as AudioNode;
    const factory = recordingFactory();
    const timers: FakeTimer[] = [];
    const manager = new SynthVoiceManager({
      ctx: asAudioContext(ctx),
      destinationsFor: () => ({ output }),
      createVoice: factory.create,
      schedule: (callback, delayMs) => {
        timers.push({ delayMs, callback, cancelled: false });
        return () => {};
      },
    });

    const voice = manager.noteOn(event({ at: 1 }));
    manager.noteOff(voice!, 2, 0.4);

    expect(factory.created[0].stops).toEqual([2.4]);
    expect(factory.created[0].disconnects).toBe(0);
    expect(timers).toEqual([]);
    expect(manager.liveVoiceCount()).toBe(0);
  });

  test('a teardown already booked is cancelled and re-armed when the voice is stolen', () => {
    const { manager, created, timers } = harness({ maxVoicesPerSource: 1 });

    const first = manager.noteOn(event({ noteName: 'C4', at: 0 }));
    manager.noteOff(first!, 1, 4);
    manager.noteOn(event({ noteName: 'E4', at: 2 }));

    expect(timers).toHaveLength(2);
    expect(timers[0].cancelled).toBe(true);
    expect(timers[1].cancelled).toBe(false);
    expect(timers[1].delayMs).toBeCloseTo(2020, 6);

    timers[1].callback();

    expect(created[0].disconnects).toBe(1);
  });
});

describe('SynthVoiceManager LFO bank lifecycle', () => {
  function bankHarness(offline = false) {
    const connects: [string, LfoParams, number][] = [];
    const disconnects: string[] = [];
    const retires: [string, number][] = [];
    const updates: [string, LfoParams, LfoParams, number][] = [];
    const lfoBank = {
      connectVoice: (voice: ManagedVoice, params: LfoParams, at: number) => {
        connects.push([voice.id, params, at]);
      },
      disconnectVoice: (voice: ManagedVoice) => {
        disconnects.push(voice.id);
      },
      retireVoiceOffline: (voice: ManagedVoice, at: number) => {
        retires.push([voice.id, at]);
      },
      updateSource: (source: string, previous: LfoParams, next: LfoParams, at: number) => {
        updates.push([source, previous, next, at]);
      },
    };
    // An offline context is one that can render: `isOfflineContext` tests for
    // `startRendering`, so adding it is the whole of "this is a mixdown".
    const ctx = fakeVoiceContext();
    if (offline) (ctx as { startRendering?: () => void }).startRendering = () => {};
    return {
      ...harness({ lfoBank, ctx: asAudioContext(ctx) }),
      connects,
      disconnects,
      retires,
      updates,
    };
  }

  test('every physical voice is connected to the bank at its own note-on time', () => {
    const { manager, connects } = bankHarness();

    manager.noteOn(event({ synth: synthWith({ unisonVoices: 2 }), at: 4 }));

    expect(connects.map(([id, , at]) => [id, at])).toEqual([
      ['fake-1', 4],
      ['fake-2', 4],
    ]);
    expect(connects[0][1]).toBe(SUBTRACTIVE_INIT.patch.synth.lfo);
  });

  test('a patch change is forwarded to the bank, topology change included', () => {
    const { manager, updates } = bankHarness();
    const wobbly: ActiveSynth<'subtractive'> = {
      ...SUBTRACTIVE_INIT,
      patch: {
        ...SUBTRACTIVE_INIT.patch,
        synth: {
          ...SUBTRACTIVE_INIT.patch.synth,
          lfo: { ...SUBTRACTIVE_INIT.patch.synth.lfo, depth: 1, route: { target: 'filter-cutoff', unit: 'semitones', amount: 12 } },
        },
      },
    };

    manager.noteOn(event({ at: 1 }));
    manager.updatePatch('synth', SUBTRACTIVE_INIT, wobbly, 2);

    expect(updates).toEqual([['synth', SUBTRACTIVE_INIT.patch.synth.lfo, wobbly.patch.synth.lfo, 2]]);

    // And it still lands when the same change also switches voice mode, which
    // returns early from everything below it: an LFO edit bundled with a mode
    // switch is still an LFO edit. The bundle has to CARRY one — a mode switch
    // that leaves `synth.lfo` alone is not an LFO edit and is skipped below.
    const wobblyMono: ActiveSynth<'subtractive'> = {
      ...wobbly,
      patch: {
        ...wobbly.patch,
        common: { ...wobbly.patch.common, voiceMode: 'mono' },
        synth: { ...wobbly.patch.synth, lfo: { ...wobbly.patch.synth.lfo, depth: 0.5 } },
      },
    };
    manager.updatePatch('synth', wobbly, wobblyMono, 3);
    expect(updates).toHaveLength(2);
    expect(updates[1]![3]).toBe(3);
  });

  test('a patch change that leaves the LFO alone never reaches the bank', () => {
    const { manager, updates } = bankHarness();
    // Panels write immutably and leave untouched branches by reference, so an
    // unedited `synth.lfo` IS the same object. 7 of 8 Pro modules are this
    // case, at one push per animation frame while a knob is down.
    const base = SUBTRACTIVE_INIT.patch;
    const brighter: ActiveSynth<'subtractive'> = {
      ...SUBTRACTIVE_INIT,
      patch: { ...base, synth: { ...base.synth, filter: { ...base.synth.filter, cutoffHz: 8000 } } },
    };

    manager.noteOn(event({ at: 1 }));
    manager.updatePatch('synth', SUBTRACTIVE_INIT, brighter, 2);

    expect(updates).toEqual([]);
  });

  test('the bank is released before the voice cuts its own edges, and only at teardown', () => {
    const { manager, disconnects, runTimers } = bankHarness();

    const voice = manager.noteOn(event({ at: 1 }));
    manager.noteOff(voice!, 2, 0.3);

    expect(disconnects).toEqual([]);

    runTimers();

    expect(disconnects).toEqual(['fake-1']);
  });

  test('an offline teardown retires the voice from the bank without cutting an edge', () => {
    const { manager, disconnects, retires } = bankHarness(true);

    const voice = manager.noteOn(event({ at: 1 }));
    manager.noteOff(voice!, 2, 0.3);

    // No timer offline: `scheduleTeardown` has already run, during scheduling.
    // `retireVoiceOffline`, never `disconnectVoice` — a synchronous disconnect
    // here cuts the edge before sample zero and silences the LFO for the WHOLE
    // render (rule 3). It must still drop the bookkeeping and schedule the
    // generator's stop, or every note's LFO free-runs to the end of a mixdown.
    expect(disconnects).toEqual([]);
    expect(retires).toEqual([['fake-1', 2.3]]);
  });
});

describe('SynthVoiceManager patch updates', () => {
  test('a continuous control change reaches every sounding voice on that source only', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ noteName: 'C4', at: 1 }));
    manager.noteOn(event({ noteName: 'E4', at: 1 }));
    manager.noteOn(event({ noteName: 'C2', at: 1, source: 'bass' }));

    const next = synthWith({ stereoWidth: 1 });
    manager.updatePatch('synth', SUBTRACTIVE_INIT, next, 5);

    expect(created[0].updates).toEqual([[SUBTRACTIVE_INIT.patch, next.patch, 5]]);
    expect(created[1].updates).toHaveLength(1);
    expect(created[2].updates).toEqual([]);
  });

  test('a voice-mode change quickly releases the bus instead of updating it', () => {
    const { manager, created } = harness();

    const poly = manager.noteOn(event({ noteName: 'C4', at: 1 }));
    manager.noteOn(event({ noteName: 'C4', at: 1, source: 'bass' }));
    manager.updatePatch('synth', SUBTRACTIVE_INIT, MONO, 2);

    expect(created[0].releases).toEqual([[2, 0.02]]);
    expect(created[0].updates).toEqual([]);
    expect(manager.has(poly!)).toBe(false);
    expect(created[1].releases).toEqual([]);
  });

  // The spec line "Preset application stops current voices and atomically
  // installs engine and complete patch" is NOT enforced here, and this pins
  // that on purpose. `store/synthPresetInstall.ts` stops the bus before the
  // patch is written, because the decision is not derivable from two patches:
  // every edit path PRESERVES `sourcePresetId`, so a knob move and a re-pick of
  // the preset being edited reach this method identical in the only field a
  // predicate could have read. A patch arriving under a new preset id is
  // therefore an ordinary live update down here.
  test('a differing preset id does not by itself release the bus', () => {
    const { manager, created } = harness();

    const poly = manager.noteOn(event({ noteName: 'C4', at: 1 }));
    manager.updatePatch('synth', SUBTRACTIVE_INIT, presetNamed('factory-lead-saw-stack'), 2);

    expect(created[0].releases).toEqual([]);
    expect(manager.has(poly!)).toBe(true);
  });

  // The case that made the old predicate wrong: an edit keeps the id of the
  // preset it started from, so an inequality test over the two values sees a
  // knob move and a re-install as the same event.
  test('a manual edit keeps the preset id and is a live update', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ noteName: 'C4', at: 1 }));
    const edited = { ...synthWith({ stereoWidth: 1 }), sourcePresetId: 'factory-lead-saw-stack' };
    manager.updatePatch('synth', presetNamed('factory-lead-saw-stack'), edited, 5);

    expect(created[0].releases).toEqual([]);
    expect(created[0].updates).toHaveLength(1);
  });

  test('a patch arriving under the preset already playing is a live update', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ noteName: 'C4', at: 1 }));
    manager.updatePatch('synth', SUBTRACTIVE_INIT, synthWith({ stereoWidth: 1 }), 5);

    expect(created[0].releases).toEqual([]);
    expect(created[0].updates).toHaveLength(1);
  });

  test('a mono bus that changes mode leaves no stale stack for a later note to glide', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 1 }));
    manager.updatePatch('synth', MONO, SUBTRACTIVE_INIT, 2);
    manager.noteOn(event({ synth: MONO, noteName: 'E4', at: 3 }));

    expect(created).toHaveLength(2);
    expect(created[0].glides).toEqual([]);
    expect(created[1].startedAt).toBe(3);
  });

  test('a mono glide time change applies to the next glide', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 1 }));
    const slower = synthWith({ voiceMode: 'mono', glideSeconds: 0.5 });
    manager.updatePatch('synth', MONO, slower, 2);
    manager.noteOn(event({ synth: slower, noteName: 'E4', at: 3 }));

    expect(created[0].glides).toEqual([['E4', 3, 0.5]]);
  });
});

describe('SynthVoiceManager owner-scoped and schedule-scoped silencing', () => {
  test('stopOwner silences one player\'s voices including ones already releasing', () => {
    const { manager, created } = harness();

    const held = manager.noteOn(event({ owner: 'live', noteName: 'C4', at: 1 }))!;
    const scheduled = manager.noteOn(event({ owner: 'sequencer', noteName: 'E4', at: 1 }))!;
    // The transport books its release at scheduling time, the way every
    // sequencer bridge does — this is exactly the voice releaseOwner skips.
    manager.noteOff(scheduled, 5, 0.5);

    manager.stopOwner('synth', 'sequencer', 2);

    // The sequencer's voice is cut at 2, not left ringing until its booked 5.
    expect(created[1].releases[created[1].releases.length - 1][0]).toBe(2);
    expect(created[1].stops.length).toBeGreaterThan(0);
    // The live key the player is still holding is untouched.
    expect(created[0].releases).toEqual([]);
    expect(manager.has(held)).toBe(true);
  });

  test('stopOwner leaves a mono channel belonging to another owner holding its stack', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ synth: MONO, owner: 'live', noteName: 'C4', at: 1 }));
    manager.stopOwner('synth', 'sequencer', 2);

    expect(created[0].releases).toEqual([]);
  });

  test('dropScheduledFrom silences only the voices that start at or after the boundary', () => {
    const { manager, created } = harness();

    const sounding = manager.noteOn(event({ noteName: 'C4', at: 1 }))!;
    const ahead = manager.noteOn(event({ noteName: 'E4', at: 4 }))!;

    manager.dropScheduledFrom('synth', 4);

    expect(created[0].releases).toEqual([]);
    expect(manager.has(sounding)).toBe(true);
    expect(created[1].releases.length).toBe(1);
    expect(manager.has(ahead)).toBe(false);
  });

  test('dropScheduledFrom reaches a mono bus whose sounding group starts past the boundary', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ synth: MONO, noteName: 'C4', at: 4 }));
    manager.dropScheduledFrom('synth', 4);

    expect(created[0].releases.length).toBe(1);
    // The stack goes with it: a later note must build a new voice, not glide
    // one that has already been told to die.
    manager.noteOn(event({ synth: MONO, noteName: 'E4', at: 5 }));
    expect(created).toHaveLength(2);
    expect(created[0].glides).toEqual([]);
  });
});

describe('SynthVoiceManager teardown re-arming across a context suspend', () => {
  test('rearmTeardowns re-books a pending teardown against the resumed audio clock', () => {
    const ctx = fakeVoiceContext();
    const output = ctx.createGain() as unknown as AudioNode;
    const timers: FakeTimer[] = [];
    const factory = recordingFactory();
    const manager = new SynthVoiceManager({
      ctx: asAudioContext(ctx),
      destinationsFor: () => ({ output }),
      createVoice: factory.create,
      schedule: (callback, delayMs) => {
        const timer: FakeTimer = { delayMs, callback, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    });

    ctx.currentTime = 0;
    const id = manager.noteOn(event({ at: 0 }))!;
    manager.noteOff(id, 0, 2);
    expect(timers[0].delayMs).toBe(2000);

    // The context was suspended for a while: wall time advanced, the audio
    // clock did not. Without a re-arm the pending timer fires early and cuts
    // the graph in the middle of the release ramp.
    manager.rearmTeardowns();

    expect(timers[0].cancelled).toBe(true);
    expect(timers[1].delayMs).toBe(2000);
  });

  test('rearmTeardowns leaves a group with no pending teardown alone', () => {
    const { manager, timers } = harness();

    manager.noteOn(event({ at: 1 }));
    manager.rearmTeardowns();

    expect(timers).toHaveLength(0);
  });
});

describe('SynthVoiceManager mono channels are shared, so stopOwner may not orphan one', () => {
  test('a channel glided onto another owner\'s note is cut when THAT owner stops', () => {
    const { manager, created } = harness();

    // The player holds C4: this creates the channel, and the group records
    // 'live' as the owner that built it.
    const liveId = manager.noteOn(event({ synth: MONO, owner: 'live', noteName: 'C4', at: 1 }))!;
    // The sequencer plays E4 on the same mono bus — one voice, glided.
    manager.noteOn(event({ synth: MONO, owner: 'sequencer', noteName: 'E4', at: 2 }));
    expect(created).toHaveLength(1);
    // The player lets go. The stack pops to the sequencer's entry and the
    // group keeps sounding, still carrying 'live' as its own owner.
    manager.noteOff(liveId, 3, 0.2);
    expect(created[0].releases).toEqual([]);

    manager.stopOwner('synth', 'sequencer', 4);

    // Nothing holds the bus any more, so the voice must be cut whoever built
    // it. Keying the decision off `group.owner` left it sounding forever.
    expect(created[0].releases.at(-1)![0]).toBe(4);
    expect(created[0].stops.length).toBeGreaterThan(0);
  });

  test('stopping the owner that BUILT a channel leaves the other holders addressable', () => {
    const { manager, created } = harness();

    const liveId = manager.noteOn(event({ synth: MONO, owner: 'live', noteName: 'C4', at: 1 }))!;
    const seqId = manager.noteOn(event({ synth: MONO, owner: 'sequencer', noteName: 'E4', at: 2 }))!;

    manager.stopOwner('synth', 'live', 3);

    expect(manager.has(liveId)).toBe(false);
    // The sequencer is still holding the bus. Dropping the whole channel
    // because its BUILDER stopped left this id registered and unreachable —
    // `has` answering true for a voice nothing can address is exactly the
    // invariant teardown exists to keep.
    expect(manager.has(seqId)).toBe(true);
    expect(created[0].releases).toEqual([]);

    manager.noteOff(seqId, 4, 0.2);
    expect(created[0].releases.at(-1)![0]).toBe(4);
  });
});

describe('SynthVoiceManager polyphony ducking', () => {
  test('setPolyphonyScale reaches every voice a bus is holding', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ noteName: 'C4', at: 1 }));
    manager.noteOn(event({ noteName: 'E4', at: 1 }));
    manager.setPolyphonyScale('synth', 0.5, 2);

    expect(created[0].polyphonyScales).toEqual([[0.5, 2]]);
    expect(created[1].polyphonyScales).toEqual([[0.5, 2]]);
  });

  test('a voice already releasing keeps its level, so a key-up cannot duck a fading tail', () => {
    const { manager, created } = harness();

    const held = manager.noteOn(event({ noteName: 'C4', at: 1 }))!;
    manager.noteOn(event({ noteName: 'E4', at: 1 }));
    manager.noteOff(held, 2, 0.5);

    manager.setPolyphonyScale('synth', 0.7, 3);

    expect(created[0].polyphonyScales).toEqual([]);
    expect(created[1].polyphonyScales).toEqual([[0.7, 3]]);
  });

  test('the scale is per BUS — ducking Lead never touches FX', () => {
    const { manager, created } = harness();

    manager.noteOn(event({ source: 'synth', noteName: 'C4', at: 1 }));
    manager.noteOn(event({ source: 'fx', noteName: 'C4', at: 1 }));
    manager.setPolyphonyScale('synth', 0.5, 2);

    expect(created[0].polyphonyScales).toEqual([[0.5, 2]]);
    expect(created[1].polyphonyScales).toEqual([]);
  });
});

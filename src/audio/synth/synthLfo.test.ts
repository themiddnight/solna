import { describe, expect, test } from 'bun:test';
/* eslint-disable max-lines -- disposal uses the same strict Web Audio graph fake as the LFO lifecycle suite. */
import type { LfoParams, ModRoute, ModTarget, NoteDivision } from '@/types/synth';
import { fakeAutomationParam } from '../engineTestHelpers';
import { createSampleHoldBuffer, phasePeriodicWave, SynthLfoBank, type LfoDestination, type LfoVoiceHandle } from './synthLfo';

/**
 * A local, module-scoped fake `BaseAudioContext` — deliberately not shared
 * with `engineTestHelpers.ts`/`testFakes.ts`, neither of which models
 * `createPeriodicWave`, `setPeriodicWave` or `AudioBufferSourceNode.playbackRate`,
 * all three of which this module is the only thing in the repo that needs.
 */
function wiredNode<T extends object>(fields: T) {
  const node = { ...fields, connections: [] as unknown[], disconnects: 0 } as T & {
    connections: unknown[];
    disconnects: number;
    connect(target: unknown): unknown;
    disconnect(target?: unknown): void;
  };
  node.connect = (target: unknown) => {
    node.connections.push(target);
    return target;
  };
  // Mirrors the real `AudioNode.disconnect(destination?)` overload: with no
  // argument it clears every edge; with one, it severs only that edge and
  // leaves any other destination's fan-out from this same node untouched —
  // required now that one shared scale gain fans out to many voices. The
  // targeted form also mirrors the real API's `InvalidAccessError` when the
  // given destination isn't actually connected — a review round found a
  // double-disconnect bug that a more forgiving fake had let through
  // silently, so this fake is deliberately as strict as the platform here.
  node.disconnect = (target?: unknown) => {
    node.disconnects += 1;
    if (target === undefined) {
      node.connections.length = 0;
      return;
    }
    const index = node.connections.indexOf(target);
    if (index < 0) {
      throw new Error('InvalidAccessError: the given destination is not connected');
    }
    node.connections.splice(index, 1);
  };
  return node;
}

function sourceNode<T extends object>(fields: T) {
  const node = wiredNode(fields) as ReturnType<typeof wiredNode<T>> & {
    startArgs: number[];
    stopArgs: number[];
    stopped: boolean;
    start(...args: number[]): void;
    stop(...args: number[]): void;
  };
  node.startArgs = [];
  node.stopArgs = [];
  node.stopped = false;
  node.start = (...args: number[]) => {
    node.startArgs = args;
  };
  node.stop = (...args: number[]) => {
    node.stopped = true;
    node.stopArgs = args;
  };
  return node;
}

interface FakePeriodicWave {
  real: Float32Array;
  imag: Float32Array;
}

function fakeLfoContext(sampleRate = 100) {
  const oscillators: ReturnType<typeof buildOscillator>[] = [];
  const bufferSources: ReturnType<typeof buildBufferSource>[] = [];
  const gains: ReturnType<typeof wiredNode<{ gain: ReturnType<typeof fakeAutomationParam> }>>[] = [];
  const periodicWaves: FakePeriodicWave[] = [];

  function buildOscillator() {
    const node = sourceNode({
      type: 'custom',
      frequency: fakeAutomationParam(440),
      periodicWave: undefined as FakePeriodicWave | undefined,
    });
    return Object.assign(node, {
      setPeriodicWave(wave: FakePeriodicWave) {
        node.periodicWave = wave;
      },
    });
  }

  function buildBufferSource() {
    return sourceNode({
      buffer: null as unknown,
      loop: false,
      playbackRate: fakeAutomationParam(1),
    });
  }

  return {
    sampleRate,
    currentTime: 0,
    oscillators,
    bufferSources,
    gains,
    periodicWaves,
    createOscillator() {
      const node = buildOscillator();
      oscillators.push(node);
      return node;
    },
    createBufferSource() {
      const node = buildBufferSource();
      bufferSources.push(node);
      return node;
    },
    createGain() {
      const node = wiredNode({ gain: fakeAutomationParam(1) });
      gains.push(node);
      return node;
    },
    createBuffer(channels: number, length: number, rate: number) {
      const data = new Float32Array(length);
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        duration: length / rate,
        getChannelData: () => data,
      };
    },
    createPeriodicWave(real: Float32Array, imag: Float32Array) {
      const wave = { real: Float32Array.from(real), imag: Float32Array.from(imag) };
      periodicWaves.push(wave);
      return wave;
    },
  };
}

type FakeLfoContext = ReturnType<typeof fakeLfoContext>;

function asCtx(ctx: FakeLfoContext): BaseAudioContext {
  return ctx as unknown as BaseAudioContext;
}

let nextVoiceId = 0;

/** A fake voice's own destination `AudioParam`s — plain identity objects, never actually automated. */
function fakeDestinationParam(name: string): AudioParam {
  return { name } as unknown as AudioParam;
}

/**
 * `destinations` defaults to a single `filter-cutoff` destination — enough
 * for every test that does not care which target it is — and is overridable
 * for tests asserting reconnection across a target change or `pitch-all`'s
 * multi-param fan-out.
 *
 * `unitScale` defaults to 1, so a fake voice's destination is in the route's
 * own unit and every scale-gain value asserted below is `depth * amount`
 * unchanged. A real voice's is not 1 — see `unitScale` on `LfoDestination`
 * and the test at the bottom of this file that pins the bank multiplying
 * by it.
 */
function fakeVoice(
  source: string,
  destinations: Partial<Record<ModTarget, AudioParam | AudioParam[] | null>> = { 'filter-cutoff': fakeDestinationParam('filter-cutoff') },
  unitScale = 1,
): LfoVoiceHandle {
  nextVoiceId += 1;
  return {
    id: `voice-${nextVoiceId}`,
    source,
    lfoDestination(target: ModTarget): LfoDestination | null {
      const destination = destinations[target];
      if (destination == null) return null;
      return { params: Array.isArray(destination) ? destination : [destination], unitScale };
    },
  };
}

const CUTOFF_ROUTE: ModRoute = { target: 'filter-cutoff', unit: 'semitones', amount: 12 };

function lfoParams(over: Partial<LfoParams> = {}): LfoParams {
  return {
    waveform: 'sine',
    depth: 1,
    phaseDegrees: 0,
    triggerMode: 'transport',
    rate: { mode: 'hz', hz: 2 },
    route: CUTOFF_ROUTE,
    ...over,
  };
}

function division(value: NoteDivision['value'], modifier: NoteDivision['modifier'] = 'straight'): NoteDivision {
  return { value, modifier };
}

/** Reads the raw oscillator/buffer-source node the bank wrote into `voice.lfoSource`. */
function rawSource(voice: LfoVoiceHandle) {
  return voice.lfoSource as ReturnType<FakeLfoContext['createOscillator']> | ReturnType<FakeLfoContext['createBufferSource']>;
}

/** `rawSource`, narrowed to the oscillator shape — every call site here only ever builds oscillators. */
function oscSource(voice: LfoVoiceHandle): ReturnType<FakeLfoContext['createOscillator']> {
  return voice.lfoSource as ReturnType<FakeLfoContext['createOscillator']>;
}

describe('SynthLfoBank trigger ownership', () => {
  test('dispose stops and disconnects every owned generator and pending teardown idempotently', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const transportVoice = fakeVoice('synth');
    const noteVoice = fakeVoice('lead');
    bank.connectVoice(transportVoice, lfoParams(), 0);
    bank.connectVoice(noteVoice, lfoParams({ triggerMode: 'note' }), 0);
    bank.setTransportOrigin(1);

    bank.dispose(2);
    bank.dispose(2);

    expect(ctx.oscillators.every((node) => node.stopped)).toBe(true);
    expect(ctx.oscillators.every((node) => node.connections.length === 0)).toBe(true);
    expect(ctx.gains.every((node) => node.connections.length === 0)).toBe(true);
    expect(transportVoice.lfoSource).toBeUndefined();
    expect(noteVoice.lfoSource).toBeUndefined();
    const oscillatorCount = ctx.oscillators.length;
    bank.connectVoice(fakeVoice('synth'), lfoParams(), 3);
    expect(ctx.oscillators).toHaveLength(oscillatorCount);
  });

  test('transport-triggered voices on the same channel share one generator', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voiceA = fakeVoice('synth');
    const voiceB = fakeVoice('synth');

    bank.setTransportOrigin(4);
    bank.connectVoice(voiceA, lfoParams({ triggerMode: 'transport' }), 5);
    bank.connectVoice(voiceB, lfoParams({ triggerMode: 'transport' }), 5.5);

    expect(voiceA.lfoSource).toBeDefined();
    expect(voiceA.lfoSource).toBe(voiceB.lfoSource);
    expect(ctx.oscillators).toHaveLength(1);
  });

  test('note-triggered voices each get their own generator', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voiceC = fakeVoice('synth');
    const voiceD = fakeVoice('synth');

    bank.connectVoice(voiceC, lfoParams({ triggerMode: 'note' }), 6);
    bank.connectVoice(voiceD, lfoParams({ triggerMode: 'note' }), 6.2);

    expect(voiceC.lfoSource).toBeDefined();
    expect(voiceD.lfoSource).toBeDefined();
    expect(voiceC.lfoSource).not.toBe(voiceD.lfoSource);
    expect(ctx.oscillators).toHaveLength(2);
  });

  test('a transport generator starts at the origin, not at whichever time a voice first connects', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voiceA = fakeVoice('synth');

    bank.setTransportOrigin(4);
    bank.connectVoice(voiceA, lfoParams({ triggerMode: 'transport' }), 5.5);

    expect(rawSource(voiceA).startArgs[0]).toBe(4);
  });

  test('a silent config (no route, or depth 0) connects nothing', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voiceNoRoute = fakeVoice('synth');
    const voiceZeroDepth = fakeVoice('synth');

    bank.connectVoice(voiceNoRoute, lfoParams({ triggerMode: 'note', route: null }), 1);
    bank.connectVoice(voiceZeroDepth, lfoParams({ triggerMode: 'note', depth: 0 }), 1);

    expect(voiceNoRoute.lfoSource).toBeUndefined();
    expect(voiceZeroDepth.lfoSource).toBeUndefined();
    expect(ctx.oscillators).toHaveLength(0);
  });
});

describe('SynthLfoBank sync rate and BPM', () => {
  test('1/8 straight at 120 BPM is 4 Hz', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');

    bank.connectVoice(voice, lfoParams({ triggerMode: 'note', rate: { mode: 'sync', division: division(8) } }), 0);

    expect(oscSource(voice).frequency.value).toBeCloseTo(4, 10);
  });

  test('dotted lengthens the period by exactly 1.5x (rate / 1.5); triplet shortens it by exactly 2/3 (rate * 1.5)', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const dotted = fakeVoice('synth');
    const triplet = fakeVoice('synth');

    bank.connectVoice(dotted, lfoParams({ triggerMode: 'note', rate: { mode: 'sync', division: division(8, 'dotted') } }), 0);
    bank.connectVoice(triplet, lfoParams({ triggerMode: 'note', rate: { mode: 'sync', division: division(8, 'triplet') } }), 0);

    expect(oscSource(dotted).frequency.value).toBeCloseTo(4 / 1.5, 10);
    expect(oscSource(triplet).frequency.value).toBeCloseTo(4 * 1.5, 10);
  });

  test('an updated BPM re-rates a sync-mode transport generator in place', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');

    bank.connectVoice(voice, lfoParams({ triggerMode: 'transport', rate: { mode: 'sync', division: division(8) } }), 0);
    expect(oscSource(voice).frequency.value).toBeCloseTo(4, 10);

    bank.setBpm(240, 10);
    expect(oscSource(voice).frequency.value).toBeCloseTo(8, 10);
    // Re-rated in place, not rebuilt: still the same node, no second oscillator.
    expect(ctx.oscillators).toHaveLength(1);
  });

  test('an updated BPM never touches an Hz-mode generator', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');

    bank.connectVoice(voice, lfoParams({ triggerMode: 'transport', rate: { mode: 'hz', hz: 3 } }), 0);
    bank.setBpm(240, 10);

    expect(oscSource(voice).frequency.value).toBe(3);
  });
});

describe('phasePeriodicWave', () => {
  test('phase 0 leaves a sine wave as a pure sin term', () => {
    const ctx = fakeLfoContext();
    const wave = phasePeriodicWave(asCtx(ctx), 'sine', 0) as unknown as FakePeriodicWave;
    expect(wave.imag[1]).toBeCloseTo(1, 10);
    expect(wave.real[1]).toBeCloseTo(0, 10);
  });

  test('rotating a sine wave by 90 degrees turns it into a cosine term', () => {
    const ctx = fakeLfoContext();
    const wave = phasePeriodicWave(asCtx(ctx), 'sine', 90) as unknown as FakePeriodicWave;
    expect(wave.real[1]).toBeCloseTo(1, 6);
    expect(wave.imag[1]).toBeCloseTo(0, 6);
  });

  test('rotating by 360 degrees is the identity', () => {
    const ctx = fakeLfoContext();
    const base = phasePeriodicWave(asCtx(ctx), 'sawtooth', 0) as unknown as FakePeriodicWave;
    const rotated = phasePeriodicWave(asCtx(ctx), 'sawtooth', 360) as unknown as FakePeriodicWave;
    for (let k = 1; k < base.imag.length; k++) {
      expect(rotated.imag[k]).toBeCloseTo(base.imag[k], 6);
      expect(rotated.real[k]).toBeCloseTo(base.real[k], 6);
    }
  });

  test('a note-triggered voice is built with a wave rotated to its own phaseDegrees', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');

    bank.connectVoice(voice, lfoParams({ triggerMode: 'note', waveform: 'sine', phaseDegrees: 90 }), 3);

    const osc = rawSource(voice) as ReturnType<FakeLfoContext['createOscillator']>;
    expect(osc.periodicWave?.real[1]).toBeCloseTo(1, 6);
    expect(osc.periodicWave?.imag[1]).toBeCloseTo(0, 6);
  });
});

describe('createSampleHoldBuffer', () => {
  function sequence(values: number[]) {
    let i = 0;
    return () => values[i++ % values.length];
  }

  test('each held plateau lasts exactly one LFO period', () => {
    const ctx = fakeLfoContext(100);
    const periodSeconds = 0.2; // 20 samples at this fake sample rate
    const values = [0.1, 0.9, 0.3, 0.7];
    const buffer = createSampleHoldBuffer(ctx as unknown as BaseAudioContext, periodSeconds, {
      steps: values.length,
      random: sequence(values),
    });
    const data = buffer.getChannelData(0);
    const stepSamples = periodSeconds * ctx.sampleRate;
    expect(data.length).toBe(stepSamples * values.length);
    for (let step = 0; step < values.length; step++) {
      const expected = values[step] * 2 - 1;
      for (let i = 0; i < stepSamples; i++) {
        // Float32Array storage: single precision, ~7 significant decimal digits.
        expect(data[step * stepSamples + i]).toBeCloseTo(expected, 6);
      }
    }
  });

  test('transport-triggered sample-and-hold voices share the same buffer, drawn only once', () => {
    const ctx = fakeLfoContext();
    let calls = 0;
    const random = () => {
      calls += 1;
      return 0.5;
    };
    const bank = new SynthLfoBank(asCtx(ctx), random);
    const voiceA = fakeVoice('synth');
    const voiceB = fakeVoice('synth');

    bank.setTransportOrigin(0);
    bank.connectVoice(voiceA, lfoParams({ triggerMode: 'transport', waveform: 'sample-and-hold' }), 1);
    bank.connectVoice(voiceB, lfoParams({ triggerMode: 'transport', waveform: 'sample-and-hold' }), 2);

    expect(voiceA.lfoSource).toBe(voiceB.lfoSource);
    expect(ctx.bufferSources).toHaveLength(1);
    expect(calls).toBeGreaterThan(0);
    const drawsForOneBuffer = calls;

    // A second, unrelated channel draws its own fresh sequence...
    const voiceOtherChannel = fakeVoice('bass');
    bank.connectVoice(voiceOtherChannel, lfoParams({ triggerMode: 'transport', waveform: 'sample-and-hold' }), 3);
    // ...but the FIRST channel's voices never triggered a second draw.
    expect(calls).toBe(drawsForOneBuffer * 2);
  });

  test('note-triggered sample-and-hold voices restart at their own first value (offset 0)', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voiceC = fakeVoice('synth');
    const voiceD = fakeVoice('synth');

    bank.connectVoice(voiceC, lfoParams({ triggerMode: 'note', waveform: 'sample-and-hold' }), 5);
    bank.connectVoice(voiceD, lfoParams({ triggerMode: 'note', waveform: 'sample-and-hold' }), 7);

    const bufferC = rawSource(voiceC) as ReturnType<FakeLfoContext['createBufferSource']>;
    const bufferD = rawSource(voiceD) as ReturnType<FakeLfoContext['createBufferSource']>;
    expect(bufferC).not.toBe(bufferD);
    expect(bufferC.startArgs).toEqual([5, 0]);
    expect(bufferD.startArgs).toEqual([7, 0]);
  });
});

describe('SynthLfoBank.updateSource', () => {
  test('turning depth to 0 ramps the scale to exact zero with a linear ramp, and schedules the generator to stop', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');
    const on = lfoParams({ triggerMode: 'transport' });
    const off = lfoParams({ triggerMode: 'transport', depth: 0 });

    bank.connectVoice(voice, on, 0);
    const generator = rawSource(voice);
    const scaleGain = ctx.gains.at(-1)!;

    bank.updateSource('synth', on, off, 10);

    const rampEvents = scaleGain.gain.events.filter((e) => e[0] === 'ramp');
    expect(rampEvents).toHaveLength(1);
    expect(rampEvents[0][1]).toBe(0);
    // `fakeAutomationParam` has no `setTargetAtTime` at all, so the fact this
    // compiles and runs already proves the ramp used `linearRampToValueAtTime`
    // — the exact-zero mechanism this task's brief requires — not the
    // asymptotic `setTargetAtTime` that never reaches it.
    expect(generator.stopArgs).toHaveLength(1);
  });

  test('changing only the rate re-rates the existing generator without rebuilding it', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');
    const at2Hz = lfoParams({ triggerMode: 'transport', rate: { mode: 'hz', hz: 2 } });
    const at5Hz = lfoParams({ triggerMode: 'transport', rate: { mode: 'hz', hz: 5 } });

    bank.connectVoice(voice, at2Hz, 0);
    bank.updateSource('synth', at2Hz, at5Hz, 1);

    expect(ctx.oscillators).toHaveLength(1);
    expect(oscSource(voice).frequency.value).toBe(5);
  });

  test('changing waveform rebuilds the generator but keeps the same scale gain', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');
    const sine: LfoParams = lfoParams({ triggerMode: 'transport', waveform: 'sine' });
    const square: LfoParams = lfoParams({ triggerMode: 'transport', waveform: 'square' });

    bank.connectVoice(voice, sine, 0);
    const scaleGainBefore = ctx.gains.at(-1);
    bank.updateSource('synth', sine, square, 1);

    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0].stopArgs).toEqual([1]);
    expect(ctx.gains.at(-1)).toBe(scaleGainBefore);
  });
});

describe('SynthLfoBank.disconnectVoice', () => {
  test('disconnecting a note voice stops and disconnects its dedicated generator', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');

    bank.connectVoice(voice, lfoParams({ triggerMode: 'note' }), 0);
    const generator = rawSource(voice);
    bank.disconnectVoice(voice);

    expect(generator.stopped).toBe(true);
    expect(generator.disconnects).toBe(1);
    expect(voice.lfoSource).toBeUndefined();
  });

  test('disconnecting one transport voice leaves the shared channel generator running for the others', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voiceA = fakeVoice('synth');
    const voiceB = fakeVoice('synth');

    bank.connectVoice(voiceA, lfoParams({ triggerMode: 'transport' }), 0);
    bank.connectVoice(voiceB, lfoParams({ triggerMode: 'transport' }), 0.5);
    const shared = rawSource(voiceA);
    bank.disconnectVoice(voiceA);

    expect(shared.stopArgs).toHaveLength(0);
    expect(shared.disconnects).toBe(0);
    expect(voiceA.lfoSource).toBeUndefined();
    expect(voiceB.lfoSource).toBe(shared);
  });
});

describe('SynthLfoBank connects to the voice destination (review Important #1)', () => {
  test('connectVoice wires the depth/route-scaled output onto the voice own real destination', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });

    bank.connectVoice(voice, lfoParams({ triggerMode: 'note' }), 0);

    const scaleGain = ctx.gains.at(-1)!;
    expect(scaleGain.connections).toContain(cutoffParam);
  });

  test('a route-target change reconnects the scale gain from the old destination to the new one, without rebuilding the oscillator', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const resonanceParam = fakeDestinationParam('resonance');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam, 'filter-resonance': resonanceParam });

    const cutoffRoute: ModRoute = { target: 'filter-cutoff', unit: 'semitones', amount: 12 };
    const resonanceRoute: ModRoute = { target: 'filter-resonance', unit: 'normalized', amount: 0.5 };
    const withCutoff = lfoParams({ triggerMode: 'transport', route: cutoffRoute });
    const withResonance = lfoParams({ triggerMode: 'transport', route: resonanceRoute });

    bank.connectVoice(voice, withCutoff, 0);
    const oscillatorBefore = rawSource(voice);
    const scaleGain = ctx.gains.at(-1)!;
    expect(scaleGain.connections).toContain(cutoffParam);

    bank.updateSource('synth', withCutoff, withResonance, 1);

    expect(scaleGain.connections).not.toContain(cutoffParam);
    expect(scaleGain.connections).toContain(resonanceParam);
    // The oscillator itself must survive a target-only change — a rebuild
    // would restart its phase and click.
    expect(rawSource(voice)).toBe(oscillatorBefore);
    expect(ctx.oscillators).toHaveLength(1);
  });
});

describe('SynthLfoBank keeps voice.lfoSource fresh across a channel rebuild (review Important #2)', () => {
  test('a mid-song re-anchor rebuilds the shared generator and reconnects every attached voice to it', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const voiceA = fakeVoice('synth', { 'filter-cutoff': cutoffParam });

    bank.setTransportOrigin(0);
    bank.connectVoice(voiceA, lfoParams({ triggerMode: 'transport' }), 1);
    const firstOscillator = rawSource(voiceA);
    const firstScaleGain = ctx.gains.at(-1)!;
    expect(firstScaleGain.connections).toContain(cutoffParam);

    bank.setTransportOrigin(10); // mid-song re-anchor while voiceA is still attached

    expect(firstOscillator.stopped).toBe(true);
    const secondOscillator = rawSource(voiceA);
    expect(secondOscillator).not.toBe(firstOscillator);
    expect(secondOscillator.startArgs[0]).toBe(10);
    const secondScaleGain = ctx.gains.at(-1)!;
    expect(secondScaleGain).not.toBe(firstScaleGain);
    expect(secondScaleGain.connections).toContain(cutoffParam);
    // The stale generator's own scale gain is severed by the deferred
    // teardown, not here — see the describe below for why.
    bank.setBpm(120, 10);
    expect(firstScaleGain.connections).not.toContain(cutoffParam);
  });

  test('a waveform change on an already-connected channel rebuilds the oscillator and updates every attached voice.lfoSource', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voiceA = fakeVoice('synth');
    const voiceB = fakeVoice('synth');
    const sine = lfoParams({ triggerMode: 'transport', waveform: 'sine' });
    const square = lfoParams({ triggerMode: 'transport', waveform: 'square' });

    bank.connectVoice(voiceA, sine, 0);
    bank.connectVoice(voiceB, sine, 0.5);
    const before = rawSource(voiceA);
    expect(rawSource(voiceB)).toBe(before);

    bank.updateSource('synth', sine, square, 1);

    expect(rawSource(voiceA)).not.toBe(before);
    expect(rawSource(voiceA)).toBe(rawSource(voiceB));
    expect(before.stopped).toBe(true);
  });
});

describe('SynthLfoBank defers a re-anchored channel\'s disconnect to the audio clock', () => {
  test('the retired scale gain keeps feeding the destination until the sweep passes the stop time', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });

    bank.setTransportOrigin(0);
    bank.connectVoice(voice, lfoParams({ triggerMode: 'transport' }), 1);
    const retired = ctx.gains.at(-1)!;

    bank.setTransportOrigin(10);

    // `stop(10)` is booked on the AUDIO clock while the disconnect would run
    // now, and every caller books a lookahead window ahead of itself — so
    // cutting the edge here drops the modulation for that whole window and
    // snaps the destination back to its base value mid-note.
    const revived = ctx.gains.at(-1)!;
    expect(revived).not.toBe(retired);
    expect(retired.connections).toContain(cutoffParam);
    expect(revived.connections).toContain(cutoffParam);

    // Any public call at or past the stop time flushes it.
    bank.setBpm(120, 10);

    expect(retired.connections).not.toContain(cutoffParam);
    expect(revived.connections).toContain(cutoffParam);
  });

  test('a fade teardown already in flight survives a re-anchor of the same bus', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');
    const audible = lfoParams({ triggerMode: 'transport' });
    const silent = lfoParams({ triggerMode: 'transport', depth: 0 });

    bank.connectVoice(voice, audible, 0);
    const faded = ctx.gains.at(-1)!;
    bank.updateSource('synth', audible, silent, 1); // ramps to zero, teardown at 1.05

    bank.connectVoice(voice, audible, 1.01); // a fresh channel on the same bus
    const reAnchored = ctx.gains.at(-1)!;
    bank.setTransportOrigin(1.02); // a SECOND teardown on the same bus, fade still pending

    expect(reAnchored).not.toBe(faded);

    bank.setBpm(120, 2);

    // Two retired pairs, both disconnected: keying the pending map by source
    // would have the re-anchor overwrite the fade and strand its generator.
    expect(faded.disconnects).toBeGreaterThan(0);
    expect(reAnchored.disconnects).toBeGreaterThan(0);
  });
});

describe('SynthLfoBank pairs stop with disconnect on the silence path (review Important #3)', () => {
  test('the shared generator and every attached destination edge are NOT disconnected before the fade lands', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });
    const on = lfoParams({ triggerMode: 'transport' });
    const off = lfoParams({ triggerMode: 'transport', depth: 0 });

    bank.connectVoice(voice, on, 0);
    const generator = rawSource(voice);
    const scaleGain = ctx.gains.at(-1)!;

    bank.updateSource('synth', on, off, 10); // fade lands at 10 + LFO_DEPTH_FADE_SECONDS (0.05)

    expect(generator.stopped).toBe(true);
    expect(generator.disconnects).toBe(0);
    expect(scaleGain.connections).toContain(cutoffParam); // edge still live mid-fade

    // A subsequent call whose `at` still lands before the fade has actually
    // elapsed must not sweep the teardown away early.
    bank.setBpm(120, 10.01);
    expect(generator.disconnects).toBe(0);
    expect(scaleGain.connections).toContain(cutoffParam);
    expect(voice.lfoSource).toBeDefined();
  });

  test('once the fade has actually elapsed, the next call disconnects both the generator and every attached edge', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });
    const on = lfoParams({ triggerMode: 'transport' });
    const off = lfoParams({ triggerMode: 'transport', depth: 0 });

    bank.connectVoice(voice, on, 0);
    const generator = rawSource(voice);
    const scaleGain = ctx.gains.at(-1)!;

    bank.updateSource('synth', on, off, 10);
    bank.setBpm(120, 10.2); // safely past the fade window

    expect(generator.disconnects).toBe(1);
    expect(scaleGain.disconnects).toBeGreaterThan(0);
    expect(scaleGain.connections).not.toContain(cutoffParam);
    expect(voice.lfoSource).toBeUndefined();
  });
});

describe('SynthLfoBank reviving a silenced channel (re-review Critical)', () => {
  test('toggling depth off then back on, target unchanged, restores modulation on the held voice', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });
    const on = lfoParams({ triggerMode: 'transport' });
    const off = lfoParams({ triggerMode: 'transport', depth: 0 });

    bank.connectVoice(voice, on, 0);
    expect(ctx.gains.at(-1)!.connections).toContain(cutoffParam);

    bank.updateSource('synth', on, off, 1);
    // Depth back on before the fade has even landed — the ordinary "knob
    // down, knob back up" gesture on a note that is still held.
    bank.updateSource('synth', off, on, 1.01);

    const revivedScaleGain = ctx.gains.at(-1)!;
    expect(revivedScaleGain.connections).toContain(cutoffParam);
    expect(voice.lfoSource).toBeDefined();
  });

  test('a channel revived after its fade has fully swept still reconnects every voice that was on it', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });
    const on = lfoParams({ triggerMode: 'transport' });
    const off = lfoParams({ triggerMode: 'transport', depth: 0 });

    bank.connectVoice(voice, on, 0);
    bank.updateSource('synth', on, off, 1); // fade lands at 1.05
    bank.setBpm(120, 2); // sweeps: voice transitions to dormant

    expect(voice.lfoSource).toBeUndefined();

    bank.updateSource('synth', off, on, 3);

    const revivedScaleGain = ctx.gains.at(-1)!;
    expect(revivedScaleGain.connections).toContain(cutoffParam);
    expect(voice.lfoSource).toBeDefined();
  });
});

describe('SynthLfoBank connecting to a silent channel then going live (re-review Important, same root cause)', () => {
  test('a voice that connects while the channel is silent is reconnected once the channel goes live', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });
    const off = lfoParams({ triggerMode: 'transport', depth: 0 });
    const on = lfoParams({ triggerMode: 'transport' });

    // The channel was never live: connectVoice sees a silent config and
    // registers the voice as dormant rather than building anything.
    bank.connectVoice(voice, off, 0);
    expect(voice.lfoSource).toBeUndefined();
    expect(ctx.oscillators).toHaveLength(0);

    bank.updateSource('synth', off, on, 1);

    expect(ctx.oscillators).toHaveLength(1);
    const scaleGain = ctx.gains.at(-1)!;
    expect(scaleGain.connections).toContain(cutoffParam);
    expect(voice.lfoSource).toBeDefined();
  });
});

describe('SynthLfoBank tears down each destination edge exactly once (re-review Important)', () => {
  test('disconnecting a voice while its channel silence-teardown is still pending does not double-disconnect the edge on the later sweep', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });
    const on = lfoParams({ triggerMode: 'transport' });
    const off = lfoParams({ triggerMode: 'transport', depth: 0 });

    bank.connectVoice(voice, on, 0);
    bank.updateSource('synth', on, off, 1); // schedules the fade; teardown pending until 1.05

    // The voice itself is torn down (e.g. its note released) BEFORE the
    // pending channel teardown has a chance to sweep.
    expect(() => bank.disconnectVoice(voice)).not.toThrow();

    // A later call whose `at` is past the fade window sweeps the pending
    // teardown — this must not throw trying to disconnect the same edge
    // `disconnectVoice` already severed.
    expect(() => bank.setBpm(120, 2)).not.toThrow();
  });

  test('reviving a channel with a CHANGED target while a prior silence teardown is still pending does not throw when that teardown later sweeps', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('cutoff');
    const resonanceParam = fakeDestinationParam('resonance');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam, 'filter-resonance': resonanceParam });
    const cutoffRoute: ModRoute = { target: 'filter-cutoff', unit: 'semitones', amount: 12 };
    const resonanceRoute: ModRoute = { target: 'filter-resonance', unit: 'normalized', amount: 0.5 };
    const on = lfoParams({ triggerMode: 'transport', route: cutoffRoute });
    const off = lfoParams({ triggerMode: 'transport', route: cutoffRoute, depth: 0 });
    const revivedWithNewTarget = lfoParams({ triggerMode: 'transport', route: resonanceRoute });

    bank.connectVoice(voice, on, 0);
    bank.updateSource('synth', on, off, 1); // schedules the fade against the OLD (cutoff) scale gain; teardown pending until 1.05

    // Revive BEFORE that teardown sweeps, with a DIFFERENT route target —
    // this rebuilds the channel and reconnects the voice to a brand new
    // scale gain and destination, while the stale teardown above still
    // holds a claim on the OLD scale gain and the OLD (cutoff) destination.
    bank.updateSource('synth', off, revivedWithNewTarget, 1.01);

    const revivedScaleGain = ctx.gains.at(-1)!;
    expect(revivedScaleGain.connections).toContain(resonanceParam);

    // A later call whose `at` is past the ORIGINAL fade window sweeps the
    // stale teardown. It must sever the OLD (cutoff) edge on the OLD scale
    // gain — never touch the NEW (resonance) edge on the NEW one — and it
    // must not throw doing so.
    expect(() => bank.setBpm(120, 2)).not.toThrow();
    expect(revivedScaleGain.connections).toContain(resonanceParam);
    expect(voice.lfoSource).toBeDefined();
  });
});

/**
 * The bank's half of the unit contract. `LfoDestination.unitScale` is what
 * turns a route amount out of its own musical unit (semitones, dB, a
 * normalized delta) and into the unit of the `AudioParam` the modulator is
 * summed into. It shipped without one — every scale gain carried the raw
 * amount — which is why a 12-semitone route arrived as 12 cents and the LFO
 * was reported as having no audible effect at all.
 *
 * The rendered proof that a real voice's conversions are the RIGHT ones is in
 * `subtractiveSignal.test.ts`; these are the bank applying whatever the voice
 * says, at every point it writes the gain.
 */
describe('SynthLfoBank applies the destination`s unit scale', () => {
  const CENTS_PER_SEMITONE = 100;

  test('a fresh connection scales the route amount into the destination`s unit', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('filter-cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam }, CENTS_PER_SEMITONE);

    // depth 0.5 * 12 semitones = 6 semitones, which is 600 of the param's cents.
    bank.connectVoice(voice, lfoParams({ triggerMode: 'note', depth: 0.5 }), 0);

    expect(ctx.gains.at(-1)!.gain.value).toBe(600);
  });

  test('a depth edit on a live transport channel rescales in the same unit', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('filter-cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam }, CENTS_PER_SEMITONE);
    const quiet = lfoParams({ triggerMode: 'transport', depth: 0.25 });
    const loud = lfoParams({ triggerMode: 'transport', depth: 1 });

    bank.connectVoice(voice, quiet, 0);
    const scaleGain = ctx.gains.at(-1)!;
    expect(scaleGain.gain.value).toBe(300);

    // No target change, so nothing reconnects — and the new depth still has
    // to land, converted, on the gain that was already there.
    bank.updateSource('synth', quiet, loud, 1);
    expect(scaleGain.gain.value).toBe(1200);
    expect(scaleGain.connections).toContain(cutoffParam);
  });
});

/**
 * The per-voice half of a live edit. A note-triggered voice owns its
 * generator and its scale gain outright, so none of it is reachable through
 * the shared channel — `allVoicesFor` filters `triggerMode === 'transport'`.
 * These are the four decisions `updateNoteVoice` makes, each isolated: the
 * rendered pair in `subtractiveSignal.test.ts` proves the edit is audible,
 * and these pin WHICH node it moved, which a rendered test cannot see.
 */
describe('SynthLfoBank live edits on a note-triggered voice', () => {
  const NOTE_LFO = { triggerMode: 'note' } as const;

  test('a rate change re-rates the running generator instead of rebuilding it', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const voice = fakeVoice('synth');
    const slow = lfoParams({ ...NOTE_LFO, rate: { mode: 'hz', hz: 2 } });
    const fast = lfoParams({ ...NOTE_LFO, rate: { mode: 'hz', hz: 9 } });

    bank.connectVoice(voice, slow, 0);
    const generator = oscSource(voice);
    expect(ctx.oscillators).toHaveLength(1);

    bank.updateSource('synth', slow, fast, 1);

    // Same node, new rate — a rebuild would restart the phase and click.
    expect(oscSource(voice)).toBe(generator);
    expect(ctx.oscillators).toHaveLength(1);
    expect(generator.frequency.value).toBe(9);
    expect(generator.stopped).toBe(false);
  });

  test('a waveform change rebuilds the generator onto the same scale gain', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('filter-cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });
    const sine = lfoParams(NOTE_LFO);
    const square = lfoParams({ ...NOTE_LFO, waveform: 'square' });

    bank.connectVoice(voice, sine, 0);
    const first = oscSource(voice);
    const scaleGain = ctx.gains.at(-1)!;

    bank.updateSource('synth', sine, square, 1);

    const second = oscSource(voice);
    expect(second).not.toBe(first);
    expect(first.stopped).toBe(true);
    expect(first.stopArgs).toEqual([1]);
    // Rebuilt onto the gain that was already there, so the edge to the
    // destination is untouched and nothing has to be reconnected.
    expect(second.connections).toContain(scaleGain);
    expect(scaleGain.connections).toContain(cutoffParam);
  });

  test('a route target change re-points this voice`s own edge', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('filter-cutoff');
    const resonanceParam = fakeDestinationParam('filter-resonance');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam, 'filter-resonance': resonanceParam });
    const onCutoff = lfoParams(NOTE_LFO);
    const onResonance = lfoParams({ ...NOTE_LFO, route: { target: 'filter-resonance', unit: 'normalized', amount: 0.5 } });

    bank.connectVoice(voice, onCutoff, 0);
    const generator = oscSource(voice);
    const scaleGain = ctx.gains.at(-1)!;
    expect(scaleGain.connections).toContain(cutoffParam);

    bank.updateSource('synth', onCutoff, onResonance, 1);

    expect(scaleGain.connections).not.toContain(cutoffParam);
    expect(scaleGain.connections).toContain(resonanceParam);
    // Re-point, never rebuild: the audible oscillator is not this edit's concern.
    expect(oscSource(voice)).toBe(generator);
  });

  test('depth to 0 ramps this voice`s scale to exact zero, and raising it again revives', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('filter-cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });
    const on = lfoParams(NOTE_LFO);
    const off = lfoParams({ ...NOTE_LFO, depth: 0 });

    bank.connectVoice(voice, on, 0);
    const scaleGain = ctx.gains.at(-1)!;

    bank.updateSource('synth', on, off, 1);

    const ramps = scaleGain.gain.events.filter((e) => e[0] === 'ramp');
    expect(ramps).toHaveLength(1);
    // Exact zero, not an asymptote — `fakeAutomationParam` has no
    // `setTargetAtTime` at all, so this compiling proves which one was used.
    expect(ramps[0][1]).toBe(0);
    // The generator stays: it dies with the voice at `disconnectVoice`, and
    // keeping it is what makes the knob coming back up a ramp, not a rebuild.
    expect(oscSource(voice).stopped).toBe(false);

    bank.updateSource('synth', off, on, 2);
    expect(scaleGain.gain.value).toBe(12);
    expect(scaleGain.connections).toContain(cutoffParam);
  });

  test('a voice that started silent is built by the edit that turns it on', () => {
    const ctx = fakeLfoContext();
    const bank = new SynthLfoBank(asCtx(ctx));
    const cutoffParam = fakeDestinationParam('filter-cutoff');
    const voice = fakeVoice('synth', { 'filter-cutoff': cutoffParam });
    const off = lfoParams({ ...NOTE_LFO, depth: 0 });
    const on = lfoParams(NOTE_LFO);

    // Dormant from the note-on: no generator was ever built for it.
    bank.connectVoice(voice, off, 0);
    expect(ctx.oscillators).toHaveLength(0);
    expect(voice.lfoSource).toBeUndefined();

    bank.updateSource('synth', off, on, 1);

    expect(ctx.oscillators).toHaveLength(1);
    // Started at the EDIT's instant, not the note's: there is nothing before
    // it to stay in phase with.
    expect(oscSource(voice).startArgs).toEqual([1]);
    expect(ctx.gains.at(-1)!.connections).toContain(cutoffParam);
  });
});

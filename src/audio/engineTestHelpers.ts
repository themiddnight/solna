import type { ActiveSynth } from '@/types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { fakeNode, fakeParam, freshEngine } from './testFakes';
import type { AutomationParam } from './synth/modulation';

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private subsystem fields and the
   unexported constructor via casts. */

// Full-fidelity fake context for setupMasterChain: every node records its
// connect() targets so a test can prove the exact wiring order.
export function masterChainCtx() {
  const mk = (type: string) => {
    const n = fakeNode();
    (n as any)._connectTargets = [] as unknown[];
    (n as any).connect = (target: unknown) => {
      (n as any)._connectTargets.push(target);
    };
    // rewireMasterDynamics calls disconnect() with no argument and then
    // re-makes exactly the edges the topology needs, so the fake has to forget
    // its outgoing edges too. fakeNode's inherited disconnect clears
    // `connectedTo`, which this override does not use — without this, a
    // "bypassed" assertion would read every edge the graph has EVER had.
    // The COUNT matters as much as the clearing: rewireMasterDynamics returns
    // early when the topology is unchanged, and because this fake forgets its
    // edges on every disconnect, an edge assertion alone cannot tell a guarded
    // rewire from an unguarded one that tore the tail down and rebuilt it
    // identically. Counting teardowns is what distinguishes them.
    (n as any)._disconnects = 0;
    (n as any).disconnect = () => {
      (n as any)._disconnects += 1;
      (n as any)._connectTargets.length = 0;
    };
    (n as any)._type = type;
    return n;
  };
  return {
    currentTime: 10,
    sampleRate: 44100,
    destination: {},
    createOscillator: () => mk('osc'),
    createGain: () => mk('gain'),
    createBiquadFilter: () => mk('biquad'),
    createDynamicsCompressor: () => {
      const n: any = mk('compressor');
      n.threshold = fakeParam();
      n.knee = fakeParam();
      n.ratio = fakeParam();
      n.attack = fakeParam();
      n.release = fakeParam();
      return n;
    },
    createAnalyser: () => mk('analyser'),
    createConvolver: () => mk('convolver'),
    createWaveShaper: () => mk('waveshaper'),
    createDelay: () => {
      const n: any = mk('delay');
      n.delayTime = fakeParam();
      return n;
    },
    createBuffer: () => ({
      length: 1024,
      getChannelData: () => new Float32Array(1024),
    }),
    resume: async () => {},
  };
}

/**
 * The complete patch every engine-facade test plays. The factory default
 * itself, not a variant of it: a test that only needs "a note sounds" should
 * not have to state a patch, and one that needs a specific value spreads over
 * this the way `voiceManager.test.ts` does.
 */
export const ACTIVE_SYNTH: ActiveSynth<'subtractive'> = SUBTRACTIVE_INIT;

// Collects every node the engine creates during one call, by kind. Module
// scope: every drum task's tests use it.
export function recordNodes(ctx: any) {
  const made: Record<string, any[]> = { osc: [], gain: [], biquad: [], noise: [] };
  for (const [kind, method] of [
    ['osc', 'createOscillator'], ['gain', 'createGain'],
    ['biquad', 'createBiquadFilter'], ['noise', 'createBufferSource'],
  ] as const) {
    const orig = ctx[method].bind(ctx);
    ctx[method] = (...a: unknown[]) => { const n = orig(...a); made[kind].push(n); return n; };
  }
  return made;
}

/** freshEngine's fake context has no state/suspend — add the two this needs. */
export function suspendableEngine() {
  const { engine, ctx } = freshEngine();
  const c = ctx as any;
  c.state = 'running';
  c.suspendCalls = 0;
  c.resumeCalls = 0;
  c.suspend = async () => {
    c.suspendCalls++;
    c.state = 'suspended';
  };
  c.resume = async () => {
    c.resumeCalls++;
    c.state = 'running';
  };
  return { engine, ctx: c };
}

/**
 * One logged automation call: `[method, value, time]` for `setValueAtTime`,
 * `linearRampToValueAtTime` and `exponentialRampToValueAtTime`, `[method,
 * time]` for `cancelScheduledValues` (which takes no value). Tuples, not the
 * object shape `testFakes.ts`'s
 * `fakeParam` uses, because `src/audio/synth/modulation.test.ts` and
 * `noise.test.ts` want to assert an exact call sequence with a plain
 * `toEqual` literal — see `fakeAutomationParam` below for why the two fakes
 * do not share one shape.
 */
export type AutomationEvent =
  | ['set', number, number]
  | ['ramp', number, number]
  | ['exp', number, number]
  | ['cancel', number];

/**
 * The one `AudioParam` method `AutomationParam` (`src/audio/synth/modulation.ts`)
 * deliberately leaves out: every envelope in that module ramps linearly, but a
 * PITCH glide has to be exponential in Hz or it rushes through the low end of
 * its own interval. `SubtractiveVoice.glideTo` is the only caller, so the
 * method is declared beside the fake rather than widened into `AutomationParam`,
 * where it would suggest the envelope primitives accept it too.
 */
export interface ExponentialParam {
  exponentialRampToValueAtTime(value: number, endTime: number): void;
}

/**
 * A minimal fake implementing `AutomationParam`
 * (`src/audio/synth/modulation.ts`) — `setValueAtTime`,
 * `linearRampToValueAtTime`, `cancelScheduledValues` and a plain `value`
 * field — plus `ExponentialParam` above, rather than the DOM's much larger
 * `AudioParam`. Kept separate from `testFakes.ts`'s `fakeParam` even though
 * that one has grown a `linearRampToValueAtTime` of its own: `fakeParam`
 * logs to an OBJECT shape that dozens of engine assertions already read,
 * while the primitives suites want to compare a whole call sequence against a
 * plain tuple literal. Two logs, one for each question.
 */
export function fakeAutomationParam(initialValue = 0): AutomationParam & ExponentialParam & { events: AutomationEvent[] } {
  const events: AutomationEvent[] = [];
  return {
    value: initialValue,
    events,
    setValueAtTime(value: number, startTime: number) {
      this.value = value;
      events.push(['set', value, startTime]);
    },
    linearRampToValueAtTime(value: number, endTime: number) {
      this.value = value;
      events.push(['ramp', value, endTime]);
    },
    exponentialRampToValueAtTime(value: number, endTime: number) {
      this.value = value;
      events.push(['exp', value, endTime]);
    },
    cancelScheduledValues(startTime: number) {
      events.push(['cancel', startTime]);
    },
  };
}

/** An `AutomationParam` that also keeps its tuple call log — what every fake node below exposes. */
export type LoggedParam = AutomationParam & ExponentialParam & { events: AutomationEvent[] };

/**
 * The wiring surface every node in the subtractive voice graph shares:
 * `connect`/`disconnect` plus the two logs an assertion reads. `connections`
 * is the list of targets in call order, so a test can walk the whole chain
 * from the source outwards; `disconnects` is a COUNT rather than a boolean
 * because `teardown` must be idempotent and a boolean cannot tell one
 * teardown from two.
 */
export interface FakeVoiceNode {
  connections: unknown[];
  disconnects: number;
  connect(target: unknown): unknown;
  disconnect(): void;
}

/** A started/stopped source records its scheduled times: teardown must stop everything it created. */
export interface FakeVoiceSource extends FakeVoiceNode {
  startArgs: number[];
  stopArgs: number[];
  start(when?: number): void;
  stop(when?: number): void;
}

export interface FakeOscillatorNode extends FakeVoiceSource {
  type: string;
  frequency: LoggedParam;
  detune: LoggedParam;
}

export interface FakeBufferSourceNode extends FakeVoiceSource {
  buffer: unknown;
  loop: boolean;
}

export interface FakeGainNode extends FakeVoiceNode {
  gain: LoggedParam;
}

export interface FakeBiquadNode extends FakeVoiceNode {
  type: string;
  frequency: LoggedParam;
  detune: LoggedParam;
  Q: LoggedParam;
}

export interface FakePannerNode extends FakeVoiceNode {
  pan: LoggedParam;
}

export interface FakeWaveShaperNode extends FakeVoiceNode {
  curve: Float32Array | null;
  oversample: string;
}

/**
 * Adds the wiring surface to a node's own fields. The methods are assigned
 * AFTER the object exists and close over it, rather than being spread in from
 * a shared factory — a spread copies a closure that still writes to the
 * object it was built for, which would have every node in the graph reporting
 * the first one's `disconnects` count.
 */
function withWiring<T extends object>(fields: T): T & FakeVoiceNode {
  const node = { ...fields, connections: [] as unknown[], disconnects: 0 } as T & FakeVoiceNode;
  node.connect = (target: unknown) => {
    node.connections.push(target);
    return target;
  };
  node.disconnect = () => {
    node.disconnects += 1;
    node.connections.length = 0;
  };
  return node;
}

function withSourceWiring<T extends object>(fields: T): T & FakeVoiceSource {
  const node = withWiring(fields) as T & FakeVoiceSource;
  node.startArgs = [];
  node.stopArgs = [];
  node.start = (when?: number) => {
    node.startArgs.push(when ?? 0);
  };
  node.stop = (when?: number) => {
    node.stopArgs.push(when ?? 0);
  };
  return node;
}

/**
 * A fake `BaseAudioContext` for the subtractive voice graph
 * (`src/audio/synth/subtractiveVoice.ts`). Every factory records what it made,
 * in creation order, so a test asserts on counts and on the exact chain rather
 * than on a mock's call list.
 *
 * Separate from `testFakes.ts`'s `fakeCtx` for the same reason
 * `fakeAutomationParam` is separate from `fakeParam`: the voice graph
 * schedules with `linearRampToValueAtTime`, which `fakeParam` does not have,
 * and it needs `createStereoPanner`/`createWaveShaper`, which `fakeCtx` does
 * not make. Widening the shared fake would put a new param shape under dozens
 * of unrelated engine assertions.
 *
 * `sampleRate` is a parameter because the cutoff clamp is expressed against
 * Nyquist: a test proving the clamp needs a rate whose Nyquist sits INSIDE the
 * audible range, which no real device has.
 */
export function fakeVoiceContext(sampleRate = 48_000) {
  const oscillators: FakeOscillatorNode[] = [];
  const gains: FakeGainNode[] = [];
  const filters: FakeBiquadNode[] = [];
  const panners: FakePannerNode[] = [];
  const shapers: FakeWaveShaperNode[] = [];
  const bufferSources: FakeBufferSourceNode[] = [];
  return {
    currentTime: 0,
    sampleRate,
    oscillators,
    gains,
    filters,
    panners,
    shapers,
    bufferSources,
    createOscillator(): FakeOscillatorNode {
      const node = withSourceWiring({
        type: 'sine',
        frequency: fakeAutomationParam(440),
        detune: fakeAutomationParam(0),
      });
      oscillators.push(node);
      return node;
    },
    createBufferSource(): FakeBufferSourceNode {
      const node = withSourceWiring({ buffer: null as unknown, loop: false });
      bufferSources.push(node);
      return node;
    },
    createGain(): FakeGainNode {
      const node = withWiring({ gain: fakeAutomationParam(1) });
      gains.push(node);
      return node;
    },
    createBiquadFilter(): FakeBiquadNode {
      const node = withWiring({
        type: 'lowpass',
        frequency: fakeAutomationParam(350),
        detune: fakeAutomationParam(0),
        Q: fakeAutomationParam(1),
      });
      filters.push(node);
      return node;
    },
    createStereoPanner(): FakePannerNode {
      const node = withWiring({ pan: fakeAutomationParam(0) });
      panners.push(node);
      return node;
    },
    createWaveShaper(): FakeWaveShaperNode {
      const node = withWiring({ curve: null as Float32Array | null, oversample: 'none' });
      shapers.push(node);
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
  };
}

/** The fake voice context, seen the way `createSubtractiveVoice` declares its parameter. */
export type FakeVoiceContext = ReturnType<typeof fakeVoiceContext>;

/**
 * The one cast a voice-graph test needs. `fakeVoiceContext` implements the
 * handful of factories the voice calls, not the whole `BaseAudioContext`
 * surface, so it is structurally incompatible by design — spelling the cast
 * once here keeps it out of every test body.
 */
export function asAudioContext(ctx: FakeVoiceContext): BaseAudioContext {
  return ctx as unknown as BaseAudioContext;
}

import { audioEngine } from './engine';

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; tests deliberately reach private fields (ctx, buses,
   activeVoices) and the unexported constructor via casts. */
// The engine class isn't exported (singleton pattern), so fresh test
// instances are created from the singleton's constructor. Shared here so
// every test file drives the same fake, rather than each forking its own.
export type EngineInstance = typeof audioEngine;
export const makeEngine = () => new (audioEngine.constructor as any)() as EngineInstance;

// Minimal WebAudio stand-ins: params record every cancelScheduledValues target
// time, so a test can prove that scheduling a future note never cancels the
// envelope of a voice that is already fully scheduled (the chord-rhythm
// regression: all but the last hit of a multi-hit pattern were silenced).
/** `cancelAndHold: false` stands in for Firefox, which has no cancelAndHoldAtTime. */
export type FakeOpts = { cancelAndHold?: boolean };

export function fakeParam(opts: FakeOpts = {}) {
  const param = {
    value: 1,
    cancels: [] as number[],
    targets: [] as { v: number; t: number; tc: number }[],
    // Ramps are recorded so a test can prove a release ramp that has not
    // started yet is re-armed with a newly turned Release knob.
    ramps: [] as { v: number; t: number }[],
    // The automation timeline in call order, so valueAt() can evaluate the
    // curve the engine actually scheduled instead of a test re-deriving it.
    events: [] as { kind: 'set' | 'exp' | 'target'; v: number; t: number; tc?: number }[],
    setValueAtTime(v: number, t: number) {
      this.value = v;
      this.events.push({ kind: 'set', v, t });
    },
    cancelScheduledValues(t: number) {
      this.cancels.push(t);
      this.events = this.events.filter((e) => e.t < t);
    },
    /**
     * Per spec this keeps the curve BEFORE `t` intact: a ramp straddling `t`
     * is truncated to end there at its interpolated value, it is not deleted.
     * Modelling it as a plain drop would fake a discontinuity that the real
     * API does not produce. `cancels` records it alongside
     * cancelScheduledValues — both mean "automation was cut at this time".
     */
    cancelAndHoldAtTime(t: number) {
      this.cancels.push(t);
      const sorted = [...this.events].sort((a, b) => a.t - b.t);
      // Verified against an OfflineAudioContext render in Chrome: with nothing
      // scheduled at or after `t` there is nothing to cancel and NO hold point
      // is inserted, so the next ramp starts from the last event rather than
      // from `t`. Modelling this as an unconditional hold hid a real bug.
      if (!sorted.some((e) => e.t >= t)) return;
      const held = this.valueAt(t);
      const straddling = sorted.find((e) => e.t > t);
      this.events = sorted.filter((e) => e.t < t);
      this.events.push({ kind: straddling?.kind === 'exp' ? 'exp' : 'set', v: held, t });
    },
    exponentialRampToValueAtTime(v: number, t: number) {
      this.ramps.push({ v, t });
      this.events.push({ kind: 'exp', v, t });
    },
    setTargetAtTime(v: number, t: number, tc: number) {
      this.targets.push({ v, t, tc });
      this.events.push({ kind: 'target', v, t, tc });
    },
    /**
     * Web Audio's value-at-time for the automation the envelope path uses:
     * setValueAtTime holds, exponentialRampToValueAtTime interpolates
     * geometrically from the previous event. setTargetAtTime never ends, so
     * every later event's start value would depend on it — rather than model
     * that approximately and have tests quietly trust a wrong number, this
     * refuses to evaluate a timeline containing one.
     */
    valueAt(t: number): number {
      const evs = [...this.events].sort((a, b) => a.t - b.t);
      if (evs.some((e) => e.kind === 'target')) {
        throw new Error('valueAt does not model setTargetAtTime');
      }
      if (evs.length === 0) return this.value;
      if (t <= evs[0].t) return evs[0].v;

      let cur = evs[0].v;
      let curT = evs[0].t;
      for (let i = 1; i < evs.length; i++) {
        const e = evs[i];
        if (e.t <= t) {
          cur = e.v;
          curT = e.t;
          continue;
        }
        if (e.kind !== 'exp') return cur;
        const span = e.t - curT;
        return span <= 0 ? e.v : cur * Math.pow(e.v / cur, (t - curT) / span);
      }
      return cur;
    },
  };
  if (opts.cancelAndHold === false) {
    delete (param as Partial<typeof param>).cancelAndHoldAtTime;
  }
  return param;
}

export function fakeNode(opts: FakeOpts = {}) {
  return {
    type: '',
    // Connections are recorded so a test can assert routing, not just levels:
    // a source wired past the filter still produces the right gain value.
    connectedTo: [] as unknown[],
    connect(target: unknown) {
      this.connectedTo.push(target);
    },
    disconnect() {
      this.connectedTo.length = 0;
    },
    start() {},
    stop() {},
    gain: fakeParam(opts),
    frequency: fakeParam(opts),
    detune: fakeParam(opts),
    Q: fakeParam(opts),
  };
}

// A buffer source stands in for the noise generator: `loop` and `buffer` are
// recorded so a test can prove the noise is looped (createNoiseNode's buffer is
// 2 s, shorter than a long pad release).
export function fakeBufferSource(opts: FakeOpts = {}) {
  const node = {
    ...fakeNode(opts),
    buffer: null as unknown,
    loop: false,
    // Records the args passed to start() so a test can read the noise read
    // offset (noiseStartOffset) without re-deriving it.
    _startArgs: [] as number[],
  };
  node.start = (...args: number[]) => {
    node._startArgs = args;
  };
  return node;
}

export function fakeCtx(opts: FakeOpts = {}) {
  const gains: ReturnType<typeof fakeNode>[] = [];
  const bufferSources: ReturnType<typeof fakeBufferSource>[] = [];
  return {
    currentTime: 10,
    // Deliberately tiny: createNoiseNode fills sampleRate * 2 samples with
    // Math.random(), and the real 44_100 would make every test that touches
    // noise fill 88_200 floats for no added coverage.
    sampleRate: 64,
    createOscillator: () => fakeNode(opts),
    createGain: () => {
      const g = fakeNode(opts);
      gains.push(g);
      return g;
    },
    createBiquadFilter: () => fakeNode(opts),
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      sampleRate,
      // Real AudioBuffers expose duration; noiseStartOffset reads it to pick a
      // random start, so the fake must too or every offset would be 0.
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      const s = fakeBufferSource(opts);
      bufferSources.push(s);
      return s;
    },
    resume: async () => {},
    _gains: gains,
    _bufferSources: bufferSources,
  };
}

export function freshEngine(opts: FakeOpts = {}) {
  const engine = makeEngine();
  const ctx = fakeCtx(opts);
  (engine as any).ctx = ctx;
  (engine as any).dryGain = fakeNode(opts);
  (engine as any).drumBusFilter = fakeNode(opts);
  (engine as any).drumSendFilter = fakeNode(opts);
  (engine as any).delayNode = undefined;
  (engine as any).reverbNode = undefined;
  (engine as any).distortionNode = undefined;
  return { engine, ctx };
}

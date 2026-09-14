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
export interface FakeOpts { cancelAndHold?: boolean }

export function fakeParam(opts: FakeOpts = {}) {
  const param = {
    value: 1,
    cancels: [] as number[],
    targets: [] as { v: number; t: number; tc: number }[],
    // Ramps are recorded so a test can prove a release ramp that has not
    // started yet is re-armed with a newly turned Release knob.
    ramps: [] as { v: number; t: number }[],
    // Linear ramps are kept in their own log rather than folded into `ramps`:
    // the subtractive voice's envelopes ramp linearly while every legacy
    // engine envelope ramps exponentially, and dozens of assertions read
    // `ramps` expecting only the exponential ones.
    linearRamps: [] as { v: number; t: number }[],
    // The automation timeline in call order, so valueAt() can evaluate the
    // curve the engine actually scheduled instead of a test re-deriving it.
    events: [] as { kind: 'set' | 'exp' | 'ramp' | 'target'; v: number; t: number; tc?: number }[],
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
    linearRampToValueAtTime(v: number, t: number) {
      this.linearRamps.push({ v, t });
      this.events.push({ kind: 'ramp', v, t });
    },
    setTargetAtTime(v: number, t: number, tc: number) {
      this.targets.push({ v, t, tc });
      this.events.push({ kind: 'target', v, t, tc });
    },
    /**
     * Web Audio's value-at-time for the automation the envelope path uses:
     * setValueAtTime holds, exponentialRampToValueAtTime interpolates
     * geometrically and linearRampToValueAtTime arithmetically from the
     * previous event. setTargetAtTime never ends, so
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
        if (e.kind !== 'exp' && e.kind !== 'ramp') return cur;
        const span = e.t - curT;
        if (span <= 0) return e.v;
        const progress = (t - curT) / span;
        return e.kind === 'ramp'
          ? cur + (e.v - cur) * progress
          : cur * Math.pow(e.v / cur, progress);
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
    /** Set by `setPeriodicWave`, so a test can tell a custom wave from a named one. */
    periodicWave: null as unknown,
    // WaveShaperNode's two fields. Present on every node for the same reason
    // `gain`/`frequency`/`Q` are: this is one fake standing in for every node
    // kind, and splitting it per kind would mean re-teaching every existing
    // engine test which factory made which node.
    curve: null as unknown,
    oversample: 'none',
    connect(target: unknown) {
      this.connectedTo.push(target);
      return target;
    },
    /**
     * Mirrors the real `AudioNode.disconnect(destination?)` overload: with no
     * argument it severs everything, with one it severs exactly that edge and
     * THROWS if the edge does not exist. The throw is the point — `SynthLfoBank`
     * is the one caller that disconnects a single `AudioParam`, and a forgiving
     * fake is what let a double-disconnect through before (see the same strict
     * fake in `synth/synthLfo.test.ts`).
     */
    disconnect(target?: unknown) {
      if (target === undefined) {
        this.connectedTo.length = 0;
        return;
      }
      const index = this.connectedTo.indexOf(target);
      if (index === -1) {
        throw new Error('InvalidAccessError: the given destination is not connected');
      }
      this.connectedTo.splice(index, 1);
    },
    start() {},
    stop() {},
    setPeriodicWave(wave: unknown) {
      this.periodicWave = wave;
      this.type = 'custom';
    },
    gain: fakeParam(opts),
    frequency: fakeParam(opts),
    detune: fakeParam(opts),
    Q: fakeParam(opts),
    pan: fakeParam(opts),
    playbackRate: fakeParam(opts),
  };
}

// A buffer source stands in for the noise generator: `loop` and `buffer` are
// recorded so a test can prove the noise is looped (createNoiseNode's buffer is
// 2 s, shorter than a long pad release).
function fakeBufferSource(opts: FakeOpts = {}) {
  const node = {
    ...fakeNode(opts),
    buffer: null as unknown,
    loop: false,
    // Records the args passed to start() so a test can read the noise read
    // offset (noiseStartOffset) without re-deriving it.
    _startArgs: [] as number[],
    // Records the args passed to stop() so a test can pin that a choke really
    // stops every source of a voice — the base fakeNode's stop() is a no-op.
    _stopArgs: [] as number[],
  };
  node.start = (...args: number[]) => {
    node._startArgs = args;
  };
  node.stop = (...args: number[]) => {
    node._stopArgs = args;
  };
  return node;
}

export function fakeCtx(opts: FakeOpts = {}) {
  const gains: ReturnType<typeof fakeNode>[] = [];
  const filters: ReturnType<typeof fakeNode>[] = [];
  const bufferSources: ReturnType<typeof fakeBufferSource>[] = [];
  const oscillators: ReturnType<typeof fakeNode>[] = [];
  const panners: ReturnType<typeof fakeNode>[] = [];
  const shapers: ReturnType<typeof fakeNode>[] = [];
  return {
    currentTime: 10,
    // Deliberately tiny: createNoiseNode fills sampleRate * 2 samples with
    // Math.random(), and the real 44_100 would make every test that touches
    // noise fill 88_200 floats for no added coverage.
    sampleRate: 64,
    createOscillator: () => {
      const o = fakeNode(opts);
      oscillators.push(o);
      return o;
    },
    // The three the subtractive voice graph and the LFO bank need, which the
    // legacy voice path never called. `createPeriodicWave` returns an opaque
    // token: nothing reads it back except `setPeriodicWave`, and modelling the
    // Fourier coefficients would be a fake with an opinion about DSP.
    createStereoPanner: () => {
      const p = fakeNode(opts);
      panners.push(p);
      return p;
    },
    createWaveShaper: () => {
      const s = fakeNode(opts);
      shapers.push(s);
      return s;
    },
    createPeriodicWave: (real: Float32Array, imag: Float32Array) => ({ real, imag }),
    createGain: () => {
      const g = fakeNode(opts);
      gains.push(g);
      return g;
    },
    createBiquadFilter: () => {
      const f = fakeNode(opts);
      filters.push(f);
      return f;
    },
    createAnalyser: () => ({ ...fakeNode(opts), fftSize: 2048, smoothingTimeConstant: 0.8 }),
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
    _filters: filters,
    _bufferSources: bufferSources,
    _oscillators: oscillators,
    _panners: panners,
    _shapers: shapers,
  };
}

/**
 * Binds a fake context to every subsystem on a test engine — the `bind()` half of
 * `bindContext`, without `setupMasterChain`, so a test can hand-build only the
 * nodes its assertion reads.
 *
 * A test used to write `(engine as any).ctx = ctx`, which reached the engine and
 * nothing else. Each subsystem keeps its OWN context reference now (a node belongs
 * to the context that made it), so one field assignment no longer arms any of them
 * and this is the door that does.
 */
export function bindFakeCtx(engine: EngineInstance, ctx: unknown): void {
  // Spelled as a widened structural cast rather than `(engine as any).ctx` so the
  // mechanical cast-rewriter that walks this tree cannot rewrite this line into a
  // call to itself.
  (engine as unknown as { ctx: unknown }).ctx = ctx;
  (engine as any).bindSubsystems();
}

export function freshEngine(opts: FakeOpts = {}) {
  const engine = makeEngine();
  const ctx = fakeCtx(opts);
  bindFakeCtx(engine, ctx);
  (engine as any).masterRack.dryGain = fakeNode(opts);
  (engine as any).masterRack.drumBusFilter = fakeNode(opts);
  (engine as any).masterRack.drumSendFilter = fakeNode(opts);
  (engine as any).masterRack.delayNode = undefined;
  (engine as any).masterRack.reverbNode = undefined;
  (engine as any).masterRack.distortionNode = undefined;
  return { engine, ctx };
}

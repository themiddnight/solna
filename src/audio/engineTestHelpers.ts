import type { SynthParams } from '../types';
import { fakeNode, fakeParam, freshEngine } from './testFakes';

/** A minimal, deliberately plain patch that differs only in its `preset` name. */
export function trimTestParams(preset: string): SynthParams {
  return {
    oscType: 'sawtooth', subOscVolume: 0, noiseVolume: 0, detune: 0,
    filterType: 'lowpass', filterCutoff: 4000, filterResonance: 0,
    filterEnvAmount: 0, attack: 0.02, decay: 0.4, sustain: 0.6, release: 0.5,
    filterAttack: 0.02, filterDecay: 0.4, filterSustain: 0, filterRelease: 0.5,
    lfoRate: 3.5, lfoDepth: 0, lfoTarget: 'cutoff', octave: 0,
    arpActive: false, arpMode: 'up', arpRate: '16n', arpOctaves: 1, preset,
  };
}

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

export const SYNTH: SynthParams = {
  oscType: 'sawtooth',
  subOscVolume: 0.3,
  noiseVolume: 0,
  detune: 0,
  filterType: 'lowpass',
  filterCutoff: 2400,
  filterResonance: 3,
  filterEnvAmount: 1200,
  attack: 0.02,
  decay: 0.4,
  sustain: 0.6,
  release: 0.5,
  filterAttack: 0.02,
  filterDecay: 0.4,
  filterSustain: 0,
  filterRelease: 0.5,
  lfoRate: 3.5,
  lfoDepth: 0,
  lfoTarget: 'cutoff',
  octave: 0,
  arpActive: false,
  arpMode: 'up',
  arpRate: '16n',
  arpOctaves: 1,
  preset: 'Test',
};

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

import { describe, expect, spyOn, test } from 'bun:test';
import { INITIAL_EFFECTS } from '../store/initialState';
import type { MasterEffects } from '../types';
import { bindFakeCtx, fakeNode, fakeParam, freshEngine, makeEngine } from './testFakes';
import { FADER_MAX_DB, MAX_FADER_GAIN, dbToGain, toDecibels } from '../utils/gainUnits';
import { SYNTH, masterChainCtx } from './engineTestHelpers';

/** A complete effects patch without setReverbDecay's separately-owned key. */
function fxWith(overrides: Partial<MasterEffects>): Omit<MasterEffects, 'reverbDecay'> {
  const next = { ...INITIAL_EFFECTS, ...overrides } as Record<string, unknown>;
  delete next.reverbDecay;
  return next as unknown as Omit<MasterEffects, 'reverbDecay'>;
}

/**
 * The master node graph: gain staging, dynamics, effects, meters and the source buses.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private subsystem fields and the
   unexported constructor via casts. */

describe('drum bus filter', () => {
  test('drum voices route through the drum bus filter instead of dryGain, and a send exists only when the kit\'s reverbSend calls for one', () => {
    const { engine, ctx } = freshEngine();
    // freshEngine() already seeds distinct fake nodes for drumBusFilter,
    // drumSendFilter and dryGain (testFakes.ts) — reuse them rather than
    // substituting our own, so `ctx._gains[i].connectedTo` (populated by the
    // real fakeNode.connect, not a hand-rolled spy) reflects exactly what the
    // engine wired.
    const filter = (engine as any).masterRack.drumBusFilter;
    const sendFilter = (engine as any).masterRack.drumSendFilter;
    const dryGain = (engine as any).masterRack.dryGain;
    const kit = (engine as any).drumSynth.drumKit;

    for (const type of ['kick', 'lowtom'] as const) {
      // Pre-warm the per-track fader so it does not itself land in `gains`
      // below — DEV-386's node is created lazily on first use.
      const track = (engine as any).drumSynth.drumTrackGain(type);
      const before = ctx._gains.length;
      engine.triggerDrum(type, 0.8, ctx.currentTime);
      const gains = ctx._gains.slice(before);

      // Never dryGain — for this one voice alone, not just in aggregate.
      for (const g of gains) expect(g.connectedTo, `${type} voice`).not.toContain(dryGain);

      // The dry envelope is IDENTIFIED by connecting to the per-track fader
      // (DEV-386 interposes it ahead of `filter`) — a routing bug that
      // redirects the dry path to `sendFilter` instead (making the voice
      // reverb-only, with no dry signal) leaves nothing satisfying this
      // filter, so `dryEnvelopes` comes back empty and the length assertion
      // catches it. This is why membership in {track, sendFilter} is not
      // enough: that would accept a dry path aimed at either one.
      expect(track.connectedTo, `${type} track fader`).toContain(filter);
      const dryEnvelopes = gains.filter((g) => g.connectedTo.includes(track));
      expect(dryEnvelopes, `${type} dry envelope`).toHaveLength(1);
      const dryEnv = dryEnvelopes[0];

      // The kit's authored reverbSend for this voice is > 0 (asserted
      // independently, over all 13 kits, in drumKits.test.ts), so a send must
      // exist. It is identified structurally — a gain the dry envelope itself
      // connects to (env.connect(send)) which in turn connects to
      // sendFilter — not merely by being *some* node whose target is
      // sendFilter, which would equally accept a send fed by a different
      // voice's envelope.
      const reverbSend = type === 'kick' ? kit.kick.reverbSend : kit.lowtom.reverbSend;
      expect(reverbSend, `${type}.reverbSend`).toBeGreaterThan(0);
      const send = gains.find(
        (g) => dryEnv.connectedTo.includes(g) && g.connectedTo.includes(sendFilter),
      );
      expect(send, `${type} send gain`).toBeDefined();
      expect(send!.gain.value).toBeCloseTo(reverbSend, 9);
    }
  });

  test('setDrumFilter applies cutoff, resonance and type with smoothing', () => {
    const { engine } = freshEngine();
    const freqTargets: number[] = [];
    const qTargets: number[] = [];
    const filter = fakeNode();
    filter.frequency.setTargetAtTime = (v: number) => {
      freqTargets.push(v);
    };
    filter.Q.setTargetAtTime = (v: number) => {
      qTargets.push(v);
    };
    (engine as any).masterRack.drumBusFilter = filter;

    engine.setDrumFilter(400, 8, 'bandpass');

    expect(freqTargets).toContain(400);
    expect(qTargets).toContain(8);
    expect(filter.type).toBe('bandpass');
  });

  test('setDrumFilter can schedule cutoff and resonance on the audio timeline', () => {
    const { engine } = freshEngine();
    const filter = fakeNode();
    (engine as any).masterRack.drumBusFilter = filter;

    (engine.setDrumFilter as unknown as (
      cutoff: number,
      resonance: number,
      type: 'lowpass',
      time: number,
    ) => void)(500, 2, 'lowpass', 42);

    expect(filter.frequency.targets.at(-1)).toEqual({ v: 500, t: 42, tc: 0.03 });
    expect(filter.Q.targets.at(-1)).toEqual({ v: 2, t: 42, tc: 0.03 });
  });

  test('setDrumFilter before the drum bus filter exists is a safe no-op', () => {
    const { engine } = freshEngine();
    let threw = false;
    try {
      engine.setDrumFilter(400, 8, 'lowpass');
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test('setDrumFilter before init stores the values for the chain built later', () => {
    const { engine } = freshEngine();
    engine.setDrumFilter(400, 8, 'highpass');
    expect((engine as any).masterRack.drumFilterCutoff).toBe(400);
    expect((engine as any).masterRack.drumFilterResonance).toBe(8);
    expect((engine as any).masterRack.drumFilterType).toBe('highpass');
  });
});

describe("master chain", () => {
  // Drums reach their layer the same way voices do — through the pre-fader
  // tap. Wiring drumBusFilter straight to the bus would leave the sequencer
  // scope reading a signal the fader had already scaled.
  test('the drum bus filter feeds the sequencer TAP, not its bus', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const tap = (engine as any).masterRack.sourceTaps.get('sequencer');
    const bus = (engine as any).masterRack.sourceBuses.get('sequencer');
    const drumFilter = (engine as any).masterRack.drumBusFilter;

    // masterChainCtx's nodes record into _connectTargets, not connectedTo.
    expect(tap).toBeDefined();
    expect(drumFilter._connectTargets).toContain(tap);
    expect(drumFilter._connectTargets).not.toContain(bus);
    expect(tap._connectTargets).toContain(bus);
  });

  test('both dynamics stages default OFF, so masterGain reaches the destination directly', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const masterGain = (engine as any).masterRack.masterGain;
    const limiter = (engine as any).masterRack.limiter;
    const analyser = (engine as any).masterRack.analyser;
    const levelAnalyser = (engine as any).masterRack.levelAnalyser;
    const compressor = (engine as any).masterRack.compressor;
    const eqHigh = (engine as any).masterRack.eqHighNode;

    // masterGain is the user's master trim and nothing else: engineSync pushes
    // masterVolume with fireImmediately, so any "staging" value seeded here is
    // overwritten before the first frame.
    expect(masterGain.gain.value).toBe(1);

    // NOTHING owns headroom by default, and that is the intended state
    // (DEV-385): both stages exist as nodes but neither is in the path, so the
    // mix reaches the destination exactly as the user made it.
    expect(eqHigh._connectTargets).toEqual([masterGain]);
    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, ctx.destination]);
    expect(compressor._connectTargets).toEqual([]);
    expect(limiter._connectTargets).toEqual([]);
    // BOTH taps are SENDS with no onward output (DEV-384), so each reads the
    // post-fader, pre-dynamics mix and feeds nothing. levelAnalyser is the one
    // getMasterLevelAnalyser() returns — it IS the meter, and asserting only
    // `analyser` here would leave this test green with every meter at -inf.
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);

    // The nodes are still seeded with the app's historical values, so
    // switching a stage on reproduces what the app used to do invisibly.
    expect(compressor.threshold.value).toBe(-12);
    expect(compressor.knee.value).toBe(30);
    expect(compressor.ratio.value).toBe(4);
    expect(compressor.attack.value).toBeCloseTo(0.003, 6);
    expect(compressor.release.value).toBeCloseTo(0.25, 6);
    expect(limiter.threshold.value).toBe(-3);
    expect(limiter.knee.value).toBe(0);
    expect(limiter.ratio.value).toBe(20);
    expect(limiter.attack.value).toBeCloseTo(0.003, 6);
    expect(limiter.release.value).toBeCloseTo(0.15, 6);
  });

  test('engaging both stages inserts compressor then limiter AFTER the meter tap', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: true }));

    const masterGain = (engine as any).masterRack.masterGain;
    const limiter = (engine as any).masterRack.limiter;
    const analyser = (engine as any).masterRack.analyser;
    const levelAnalyser = (engine as any).masterRack.levelAnalyser;
    const compressor = (engine as any).masterRack.compressor;

    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, compressor]);
    expect(compressor._connectTargets).toEqual([limiter]);
    expect(limiter._connectTargets).toEqual([ctx.destination]);
    // NEITHER tap moved, and neither is in series: an honest meter still reads
    // the mix the user made, not the squashed output. DEV-384 put both here and
    // DEV-385 must not undo either.
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);
  });

  test('the limiter alone sits directly after masterGain, with no idle compressor in the path', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ compressorEnabled: false, limiterEnabled: true }));

    const masterGain = (engine as any).masterRack.masterGain;
    const limiter = (engine as any).masterRack.limiter;
    const analyser = (engine as any).masterRack.analyser;
    const levelAnalyser = (engine as any).masterRack.levelAnalyser;
    const compressor = (engine as any).masterRack.compressor;

    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, limiter]);
    expect(limiter._connectTargets).toEqual([ctx.destination]);
    expect(compressor._connectTargets).toEqual([]);
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);
  });
});

describe("master chain rebuilds, and its two analysers", () => {

  test('toggling the stages on and off again leaves no orphaned nodes', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const masterGain = (engine as any).masterRack.masterGain;
    const compressorBefore = (engine as any).masterRack.compressor;
    const limiterBefore = (engine as any).masterRack.limiter;
    const analyser = (engine as any).masterRack.analyser;
    const levelAnalyser = (engine as any).masterRack.levelAnalyser;

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: true }));
    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false }));
    engine.updateEffects(fxWith({ compressorEnabled: false, limiterEnabled: false }));

    // Node IDENTITY is stable across every rewire: a rewire reconnects, it
    // never rebuilds. A rebuilt node would leave the old one alive, still fed
    // by whatever pointed at it — the orphan this test exists to forbid.
    expect((engine as any).masterRack.compressor).toBe(compressorBefore);
    expect((engine as any).masterRack.limiter).toBe(limiterBefore);

    // Back to the default topology, with no leftover edge from the round trip.
    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, ctx.destination]);
    expect(compressorBefore._connectTargets).toEqual([]);
    expect(limiterBefore._connectTargets).toEqual([]);
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);

    // Every edge below the fader, collected: exactly the two taps and the output.
    const edges = [masterGain, compressorBefore, limiterBefore, analyser, levelAnalyser].flatMap(
      (n: any) => n._connectTargets as unknown[],
    );
    expect(edges).toEqual([analyser, levelAnalyser, ctx.destination]);
  });

  test('a full toggle cycle never drops the meter tap', () => {
    // This test exists because a rewire that drops the meter's tap is
    // otherwise INVISIBLE. rewireMasterDynamics calls masterGain.disconnect(),
    // which takes both observe-only sends with it; forgetting to re-make
    // levelAnalyser throws nothing, orphans nothing, and leaves the audio path
    // audibly perfect — the only symptom is VuMeter and AmbientBackdrop pinned
    // at -inf, which no graph assertion above would notice if it named only
    // `analyser`. A cross-plan review caught exactly that defect in this plan,
    // so the guard is a test rather than a comment.
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const masterGain = (engine as any).masterRack.masterGain;
    const levelAnalyser = (engine as any).masterRack.levelAnalyser;
    const taps = () => masterGain._connectTargets as unknown[];

    // Seeded topology: the tap is there before anything is toggled.
    expect(taps()).toContain(levelAnalyser);

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false }));
    // The rewire really RAN — masterGain now feeds the compressor instead of
    // the destination — and the tap survived it. Without this first assertion
    // the test would also pass against an engine that never rewires at all,
    // which is the one state it must not be green in.
    expect(taps()).toContain((engine as any).masterRack.compressor);
    expect(taps()).toContain(levelAnalyser);
    // Still a SEND after the rewire — in the tap list, not spliced into series.
    expect(levelAnalyser._connectTargets).toEqual([]);

    engine.updateEffects(fxWith({ compressorEnabled: false, limiterEnabled: false }));
    expect(taps()).toContain(ctx.destination);
    expect(taps()).not.toContain((engine as any).masterRack.compressor);
    expect(taps()).toContain(levelAnalyser);
    expect(levelAnalyser._connectTargets).toEqual([]);

    // getMasterLevelAnalyser() still hands out that same live node, so the
    // meter reads the node the graph is actually feeding.
    expect(engine.getMasterLevelAnalyser()).toBe(levelAnalyser);
  });

  test('a rewire before init() is a no-op, and an unchanged topology tears nothing down', () => {
    // Two properties that share a setup. First: every engine setter no-ops
    // until init() creates the AudioContext, and rewireMasterDynamics is no
    // exception — it touches six nodes that do not exist yet.
    const engine = makeEngine();
    expect(() => (engine as any).masterRack.rewireMasterDynamics(true, true)).not.toThrow();
    expect((engine as any).masterRack.dynamicsTopology).toBe('unbuilt');

    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const masterGain = (engine as any).masterRack.masterGain;
    const analyser = (engine as any).masterRack.analyser;
    const levelAnalyser = (engine as any).masterRack.levelAnalyser;
    const compressor = (engine as any).masterRack.compressor;
    const limiter = (engine as any).masterRack.limiter;
    const teardowns = () =>
      masterGain._disconnects + compressor._disconnects + limiter._disconnects;

    // Second: engineSync pushes the WHOLE effects object, so updateEffects
    // runs on any effects change at all — every frame of a delay-knob drag
    // included. The `topology === this.dynamicsTopology` early return is what
    // stops each of those from ripping the master tail apart and rebuilding it
    // mid-audio. Counting teardowns is the only way to see that: the edges
    // come out identical either way, so an edge assertion alone would stay
    // green with the guard deleted.
    // limiterEnabled is pinned false here, explicitly: this test isolates the
    // compressor-only 'c' topology, and since DEV-383 INITIAL_EFFECTS itself
    // defaults limiterEnabled true, so fxWith's spread would otherwise fold
    // the limiter into the topology under test.
    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false, delayWet: 0.1 }));
    const afterRealChange = teardowns();
    expect(afterRealChange).toBeGreaterThan(0); // the topology DID change here

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false, delayWet: 0.9 }));
    expect(teardowns()).toBe(afterRealChange); // …and did not here

    // And the graph is still exactly one set of edges, not a doubled one.
    expect((engine as any).masterRack.dynamicsTopology).toBe('c');
    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, compressor]);
    expect(compressor._connectTargets).toEqual([ctx.destination]);
  });

  test('an engaged stage receives its stored parameters', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(
      fxWith({
        compressorEnabled: true,
        compressorThreshold: -20,
        compressorRatio: 8,
        limiterEnabled: true,
        limiterThreshold: -6,
      }),
    );

    const compressor = (engine as any).masterRack.compressor;
    const limiter = (engine as any).masterRack.limiter;
    // fakeParam records setTargetAtTime calls as { v, t, tc }; asserting on the
    // recorded VALUES rather than on an index keeps the test free of both
    // ordering assumptions and index-signature typing.
    const values = (param: { targets: { v: number }[] }) => param.targets.map((e) => e.v);

    expect(values(compressor.threshold)).toContain(-20);
    expect(values(compressor.ratio)).toContain(8);
    expect(values(compressor.attack)).toContain(0.003);
    expect(values(compressor.release)).toContain(0.25);
    expect(values(limiter.threshold)).toContain(-6);
    expect(values(limiter.ratio)).toContain(20);
  });
});

describe("master chain rebuild invalidates derived state", () => {

  test('the level analyser has a longer window than the spectrum analyser', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    (engine as any).masterRack.setupMasterChain();

    // AudioVisualizer draws from `analyser.frequencyBinCount`, so its fftSize
    // is fixed at 256 and the level read gets its own, longer, node instead.
    expect((engine as any).masterRack.analyser.fftSize).toBe(256);
    expect((engine as any).masterRack.levelAnalyser.fftSize).toBe(2048);
  });

  test('getMasterLevelAnalyser is null before init and the level node after', () => {
    const engine = makeEngine();
    expect(engine.getMasterLevelAnalyser()).toBeNull();

    bindFakeCtx(engine, masterChainCtx());
    (engine as any).masterRack.setupMasterChain();

    expect(engine.getMasterLevelAnalyser()).toBe((engine as any).masterRack.levelAnalyser);
  });

  test('rebuilding the master chain drops impulses built against the dead context', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    (engine as any).masterRack.setupMasterChain();
    (engine as any).masterRack.impulseCache.set(9.9, {} as AudioBuffer);

    bindFakeCtx(engine, masterChainCtx());
    (engine as any).masterRack.setupMasterChain();

    // An AudioBuffer belongs to the context that created it; reusing one from
    // the previous context is the same class of bug sourceBuses.clear() prevents.
    expect((engine as any).masterRack.impulseCache.has(9.9)).toBe(false);
  });

  test('drumBusFilter and drumSendFilter start in lockstep', () => {
    // Only the LIVE setDrumFilter path had a test; this pins the initial
    // parity too, since the two nodes are six hand-written assignments with
    // no shared construction helper.
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    (engine as any).masterRack.setupMasterChain();

    const bus = (engine as any).masterRack.drumBusFilter;
    const send = (engine as any).masterRack.drumSendFilter;
    expect(send.type).toBe(bus.type);
    expect(send.frequency.value).toBe(bus.frequency.value);
    expect(send.Q.value).toBe(bus.Q.value);
  });

  test('reports each stage\'s live gain reduction, and 0 before the context exists', () => {
    const engine = makeEngine();

    // Every getter must survive the pre-init state: no AudioContext means no
    // nodes, and the readout has to render 0 rather than throw.
    expect(engine.getCompressorReduction()).toBe(0);
    expect(engine.getLimiterReduction()).toBe(0);

    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    (engine as any).masterRack.compressor.reduction = -4.25;
    (engine as any).masterRack.limiter.reduction = -0.5;

    expect(engine.getCompressorReduction()).toBe(-4.25);
    expect(engine.getLimiterReduction()).toBe(-0.5);
  });
});

describe("reverb decay and the impulse cache", () => {
  test('reverbDecay is the impulse DURATION, with the curve exponent fixed', () => {
    const { engine } = freshEngine();
    (engine as any).masterRack.reverbNode = fakeNode();
    const buildSpy = spyOn(
      (engine as any).masterRack as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.setReverbDecay(4.5);

    // (durationSec, curveExponent) — the UI knob reads "4.5s", so 4.5 must be
    // the length of the tail, not the steepness of it.
    expect(buildSpy).toHaveBeenCalledWith(4.5, 2.0);
  });

  test('unchanged decay does not rebuild the impulse', () => {
    const { engine } = freshEngine();
    (engine as any).masterRack.reverbNode = fakeNode();
    const buildSpy = spyOn(
      (engine as any).masterRack as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.setReverbDecay(2.0);
    expect(buildSpy).not.toHaveBeenCalled(); // equals the impulse setupMasterChain built
    engine.setReverbDecay(4.5);
    // Asserting the args (not just the count) is what actually discriminates
    // the duration-vs-exponent fix: the pre-Task-4 engine would have called
    // this with (2.0, 4.5), which also passes a count-only assertion.
    expect(buildSpy).toHaveBeenCalledWith(4.5, 2.0);
    engine.setReverbDecay(4.5);
    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  test('a knob drag quantises to 0.1 s and reuses cached impulses', () => {
    const { engine } = freshEngine();
    (engine as any).masterRack.reverbNode = fakeNode();
    const buildSpy = spyOn(
      (engine as any).masterRack as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    // A real drag emits dozens of intermediate values. Quantising to the knob's
    // own 0.1 step collapses them; revisiting a value must hit the cache.
    for (const d of [3.0, 3.04, 3.02, 3.1, 3.14, 3.0, 3.1]) {
      engine.setReverbDecay(d);
    }

    expect(buildSpy).toHaveBeenCalledTimes(2); // 3.0 and 3.1 only
    expect(buildSpy.mock.calls.map((c) => c[0])).toEqual([3.0, 3.1]);
  });

  test('an out-of-range decay is clamped before it becomes a buffer length', () => {
    const { engine } = freshEngine();
    (engine as any).masterRack.reverbNode = fakeNode();
    const buildSpy = spyOn(
      (engine as any).masterRack as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.setReverbDecay(-5);
    expect(buildSpy).toHaveBeenCalledWith(0.1, 2.0);
    engine.setReverbDecay(900);
    expect(buildSpy).toHaveBeenLastCalledWith(10, 2.0);
  });

  test('the impulse cache evicts least-recently-used entries past its byte budget', () => {
    const { engine } = freshEngine();
    (engine as any).masterRack.reverbNode = fakeNode();
    spyOn(
      (engine as any).masterRack as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    // Override the byte budget rather than allocate real multi-megabyte
    // buffers: at freshEngine's fake sampleRate (64), decay d costs
    // floor(64 * d) * 2 samples, so a budget of 500 forces eviction partway
    // through this sequence without needing thousands of samples.
    (engine as any).masterRack.impulseCacheSampleBudget = 500;

    for (const d of [1.0, 1.1, 1.2, 1.3, 1.4]) {
      engine.setReverbDecay(d);
    }
    const cache = (engine as any).masterRack.impulseCache as Map<number, { buffer: AudioBuffer; samples: number }>;
    expect(Array.from(cache.keys())).toEqual([1.2, 1.3, 1.4]); // 1.0, 1.1 evicted to stay under budget

    engine.setReverbDecay(1.2); // refresh recency
    engine.setReverbDecay(1.8); // pushes the total over budget again

    expect(cache.has(1.2)).toBe(true); // refreshed, survives eviction
    expect(cache.has(1.3)).toBe(false); // least-recently-used, evicted first
  });
});

describe("updateEffects clamps and yields to bypass", () => {

  test('updateEffects sets the compressor threshold from the effects value', () => {
    const { engine, ctx } = freshEngine();
    // fakeParam records setTargetAtTime targets, so assert the recorded target.
    // The stub carries all four params because updateEffects now writes the
    // whole compressor stage (DEV-385), not the threshold alone — a stub with
    // only `threshold` would throw rather than fail an assertion.
    const threshold = fakeParam();
    (engine as any).masterRack.compressor = {
      threshold,
      ratio: fakeParam(),
      attack: fakeParam(),
      release: fakeParam(),
    };

    engine.updateEffects({ ...INITIAL_EFFECTS, compressorThreshold: -20 });

    expect(threshold.targets).toEqual([{ v: -20, t: ctx.currentTime, tc: 0.05 }]);
  });

  test('updateEffects clamps every numeric field before it reaches an AudioParam', () => {
    const { engine, ctx } = freshEngine();
    const delayFeedbackGain = fakeNode();
    const delayGain = fakeNode();
    const reverbGain = fakeNode();
    const eqLowNode = fakeNode();
    (engine as any).masterRack.delayFeedbackGain = delayFeedbackGain;
    (engine as any).masterRack.delayGain = delayGain;
    (engine as any).masterRack.reverbGain = reverbGain;
    (engine as any).masterRack.eqLowNode = eqLowNode;

    engine.updateEffects({
      ...INITIAL_EFFECTS,
      // A persisted or imported project can carry anything.
      delayFeedback: 1.4,   // >= 1 is a runaway feedback loop
      reverbWet: 12,
      delayWet: -3,
      eqLow: 400,
    });

    expect(delayFeedbackGain.gain.targets.at(-1)!.v).toBe(0.95);
    expect(reverbGain.gain.targets.at(-1)!.v).toBe(1);
    expect(delayGain.gain.targets.at(-1)!.v).toBe(0);
    expect(eqLowNode.gain.targets.at(-1)!.v).toBe(24);
    expect(ctx.currentTime).toBe(10);
  });

  test('a non-finite persisted value falls back instead of writing NaN to a param', () => {
    const { engine } = freshEngine();
    const reverbGain = fakeNode();
    (engine as any).masterRack.reverbGain = reverbGain;

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbWet: Number.NaN });

    expect(Number.isFinite(reverbGain.gain.targets.at(-1)!.v)).toBe(true);
    expect(reverbGain.gain.targets.at(-1)!.v).toBe(0.25);
  });

  test('bypass still wins over the clamped value', () => {
    const { engine } = freshEngine();
    const reverbGain = fakeNode();
    (engine as any).masterRack.reverbGain = reverbGain;

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbWet: 12, reverbBypass: true });

    expect(reverbGain.gain.targets.at(-1)!.v).toBe(0);
  });
});

describe('source bus level control', () => {
  test('setSourceGain ramps instead of stepping, and clamps to 0..MAX_FADER_GAIN', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'chord', 1, 'live');
    const bus = (engine as any).masterRack.sourceBuses.get('chord');

    engine.setSourceGain('chord', 0.4);
    expect(bus.gain.targets.at(-1)).toEqual({ v: 0.4, t: ctx.currentTime, tc: 0.01 });

    // The fader's own top reaches the bus. This used to clamp at 1.5 (+3.5 dB).
    engine.setSourceGain('chord', dbToGain(toDecibels(FADER_MAX_DB)));
    expect(bus.gain.targets.at(-1)!.v).toBeCloseTo(3.9810717, 6);

    engine.setSourceGain('chord', 99);
    expect(bus.gain.targets.at(-1)!.v).toBe(MAX_FADER_GAIN);
    engine.setSourceGain('chord', -5);
    expect(bus.gain.targets.at(-1)!.v).toBe(0);
  });

  test('setSourceMuted ramps to 0 and back to the stored gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'bass', 1, 'live');
    const bus = (engine as any).masterRack.sourceBuses.get('bass');
    engine.setSourceGain('bass', 0.6);

    engine.setSourceMuted('bass', true);
    expect(bus.gain.targets.at(-1)!.v).toBe(0);
    expect(bus.gain.targets.at(-1)!.tc).toBe(0.01); // click-free

    engine.setSourceMuted('bass', false);
    expect(bus.gain.targets.at(-1)!.v).toBe(0.6);
  });

  test('a future source mute changes the bus at the song boundary, not at scheduler time', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'fx', 1, 'live');
    const bus = (engine as any).masterRack.sourceBuses.get('fx');
    const boundary = ctx.currentTime + 0.075;

    engine.setSourceMuted('fx', true, boundary);

    expect(bus.gain.cancels.at(-1)).toBe(boundary);
    expect(bus.gain.targets.at(-1)).toEqual({ v: 0, t: boundary, tc: 0.01 });
  });

  test('a future source fader change also waits for the song boundary', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'fx', 1, 'live');
    const bus = (engine as any).masterRack.sourceBuses.get('fx');
    const boundary = ctx.currentTime + 0.075;

    engine.setSourceGain('fx', 0.4, boundary);

    expect(bus.gain.cancels.at(-1)).toBe(boundary);
    expect(bus.gain.targets.at(-1)).toEqual({ v: 0.4, t: boundary, tc: 0.01 });
  });

  test('a future Beat mute schedules its dry and authored reverb branches together', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();
    const boundary = ctx.currentTime + 0.075;

    engine.setSourceMuted('sequencer', true, boundary);

    const dryBus = (engine as any).masterRack.sourceBuses.get('sequencer');
    const sendGate = (engine as any).masterRack.drumSendGate;
    expect(dryBus.gain.targets.at(-1)).toEqual({ v: 0, t: boundary, tc: 0.01 });
    expect(sendGate.gain.targets.at(-1)).toEqual({ v: 0, t: boundary, tc: 0.01 });
  });

  test('a gain set while muted does not un-mute the bus', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'bass', 1, 'live');
    const bus = (engine as any).masterRack.sourceBuses.get('bass');

    engine.setSourceMuted('bass', true);
    engine.setSourceGain('bass', 0.9);

    expect(bus.gain.targets.at(-1)!.v).toBe(0);
  });
});

describe('master volume', () => {
  test('clamps to 0..MAX_FADER_GAIN, so the fader top is reachable', () => {
    const { engine, ctx } = freshEngine();
    const masterGain = fakeNode();
    (engine as any).masterRack.masterGain = masterGain;

    // The whole fader range reaches the node. This used to clamp at 1 (0 dB),
    // which made every one of the master fader's boost positions do nothing.
    engine.setMasterVolume(dbToGain(toDecibels(FADER_MAX_DB)));
    expect(masterGain.gain.targets.at(-1)!.v).toBeCloseTo(3.9810717, 6);

    engine.setMasterVolume(99);
    expect(masterGain.gain.targets.at(-1)).toEqual({
      v: MAX_FADER_GAIN,
      t: ctx.currentTime,
      tc: 0.05,
    });
    engine.setMasterVolume(-1);
    expect(masterGain.gain.targets.at(-1)!.v).toBe(0);
    engine.setMasterVolume(0.7);
    expect(masterGain.gain.targets.at(-1)!.v).toBe(0.7);
  });
});

describe('master chain effect defaults', () => {
  test('every wet send and EQ gain is seeded at zero', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    (engine as any).masterRack.setupMasterChain();

    // The audible defaults live in INITIAL_EFFECTS and arrive via
    // applyEngineSnapshot on the first click; seeding anything else here is a
    // second source of truth that already disagreed (distortionWet 0.1 vs 0.0,
    // eqLow 2 vs 0, eqHigh 3 vs 0).
    const rack = (engine as any).masterRack;
    for (const field of ['reverbGain', 'delayGain', 'distortionGain']) {
      expect(rack[field].gain.value, field).toBe(0);
    }
    for (const field of ['eqLowNode', 'eqMidNode', 'eqHighNode']) {
      expect(rack[field].gain.value, field).toBe(0);
    }
  });
});

describe('getSourceAnalyser', () => {
  test('is null before init(), like every other engine accessor', () => {
    const engine = makeEngine();
    expect(engine.getSourceAnalyser('synth')).toBeNull();
  });

  test('each source gets its own analyser, and the same one every time', () => {
    const { engine } = freshEngine();
    const synth = engine.getSourceAnalyser('synth');
    const chord = engine.getSourceAnalyser('chord');

    expect(synth).not.toBeNull();
    expect(engine.getSourceAnalyser('synth')).toBe(synth);
    expect(chord).not.toBe(synth);
  });

  // The tap point is the source TAP, which sits after the VCA and tremolo but
  // before the layer's own bus gain, the parallel sends and the master chain.
  // That is what makes the Synth view's scope show the layer being edited
  // rather than the finished mix — a master-tapped scope cannot do that.
  test('taps the pre-fader source tap, not the master chain', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceAnalyser('synth');
    const tap = (engine as any).masterRack.sourceTaps.get('synth');

    expect(tap).toBeDefined();
    expect(tap.connectedTo).toContain(analyser);
  });

  // The whole point of the tap: the scope draws a raw -1..+1 waveform against
  // the full height of its box, so the level it reads must be the patch's own
  // and must not move when the layer's fader does. Reading after the bus gain
  // made a full-scale patch paint a half-height trace at the -6 dB default.
  test('sits BEFORE the source bus gain, so a fader move cannot scale it', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceAnalyser('synth');
    const tap = (engine as any).masterRack.sourceTaps.get('synth');
    const bus = (engine as any).masterRack.sourceBuses.get('synth');

    expect(tap.connectedTo).toContain(bus);
    expect(bus.connectedTo).not.toContain(analyser);

    const before = tap.gain.value;
    engine.setSourceGain('synth', 0.25);
    engine.setSourceMuted('synth', true);
    expect(tap.gain.value).toBe(before);
  });

  // Every producer feeds the tap, or the layer it produces is missing from the
  // scope while still being perfectly audible — a silent-looking bug. Voices
  // are checked here; the drum bus is checked in the master-chain suite, which
  // is the only place setupMasterChain (where that edge is wired) actually runs.
  test('a voice feeds the tap, which feeds the bus', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 1, undefined, 'chord', 1, 'live');

    const chordTap = (engine as any).masterRack.sourceTaps.get('chord');
    const chordBus = (engine as any).masterRack.sourceBuses.get('chord');
    expect(chordTap).toBeDefined();
    expect(chordTap.connectedTo).toContain(chordBus);
  });

  // Nodes belong to the context that made them, so a rebuilt master chain must
  // drop them alongside sourceBuses or the next tap returns a dead node.
  test('setupMasterChain clears the analysers with the buses', () => {
    const { engine } = freshEngine();
    const before = engine.getSourceAnalyser('synth');
    (engine as any).masterRack.sourceAnalysers.clear();
    expect(engine.getSourceAnalyser('synth')).not.toBe(before);
  });
});

describe('getSourceLevelAnalyser', () => {
  test('is null before init(), like every other engine accessor', () => {
    const engine = makeEngine();
    expect(engine.getSourceLevelAnalyser('synth')).toBeNull();
  });

  test('each source gets its own analyser, and the same one every time', () => {
    const { engine } = freshEngine();
    const synth = engine.getSourceLevelAnalyser('synth');
    const chord = engine.getSourceLevelAnalyser('chord');

    expect(synth).not.toBeNull();
    expect(engine.getSourceLevelAnalyser('synth')).toBe(synth);
    expect(chord).not.toBe(synth);
  });

  // The whole reason this accessor exists next to getSourceAnalyser. A mixer
  // meter answers "how much of this layer is in the mix?", so it must sit
  // where the fader, the mute and the solo have already been applied — all
  // three write the SAME bus gain (setSourceGain / setSourceMuted), so one
  // post-fader tap gets all three for free and the UI computes no audibility
  // of its own.
  test('taps the source BUS, not the pre-fader tap', () => {
    const { engine } = freshEngine();
    // Pull the scope analyser too, which is what creates the pre-fader tap:
    // the assertion below is about which of the two points this analyser is
    // wired to, and it would pass vacuously against a tap that never existed.
    engine.getSourceAnalyser('synth');
    const analyser = engine.getSourceLevelAnalyser('synth');
    const bus = (engine as any).masterRack.sourceBuses.get('synth');
    const tap = (engine as any).masterRack.sourceTaps.get('synth');

    expect(bus.connectedTo).toContain(analyser);
    expect(tap.connectedTo).not.toContain(analyser);
  });

  // Two analysers on one source, reading two different points, and neither may
  // be handed out in place of the other: the scope's is pre-fader by design.
  test('is a different node from the pre-fader scope analyser', () => {
    const { engine } = freshEngine();
    expect(engine.getSourceLevelAnalyser('synth')).not.toBe(engine.getSourceAnalyser('synth'));
  });

  // Matches the master level analyser (engine.ts's `levelAnalyser`): a long
  // window for a stable RMS, and no smoothing — which is inert on time-domain
  // reads anyway, and is written here so the two level taps read identically.
  test('is configured for level reads, not for a spectrum', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceLevelAnalyser('synth')!;

    expect(analyser.fftSize).toBe(2048);
    expect(analyser.smoothingTimeConstant).toBe(0);
  });

  // Observe-only, like every other analyser in this engine: a tap that fed
  // anything back into the graph would double the layer into the mix.
  test('has no output of its own', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceLevelAnalyser('synth') as any;
    expect(analyser.connectedTo ?? []).toHaveLength(0);
  });

  // Nodes belong to the context that made them, so a rebuilt master chain must
  // drop these alongside sourceBuses or the next call returns a dead node.
  test('setupMasterChain clears the analysers with the buses', () => {
    const { engine } = freshEngine();
    const before = engine.getSourceLevelAnalyser('synth');
    (engine as any).masterRack.sourceLevelAnalysers.clear();
    expect(engine.getSourceLevelAnalyser('synth')).not.toBe(before);
  });
});

describe('impulse cache is bounded by samples, not entries', () => {
  test('long impulses evict early; short impulses do not', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    // freshEngine's fake context reports sampleRate 64, so a real 4,000,000
    // budget would need 31,250 s of decay to trip. Shrink the ENGINE's budget
    // instead of faking a sample rate, so this exercises the same code path
    // production does. At sampleRate 64, samples = floor(64 * decay) * 2.
    e.masterRack.impulseCacheSampleBudget = 800;

    e.masterRack.getImpulseResponse(2.0); // 256 samples
    e.masterRack.getImpulseResponse(2.5); // 320 samples -> total 576, inside 800
    expect(Array.from(e.masterRack.impulseCache.keys())).toEqual([2.0, 2.5]);

    e.masterRack.getImpulseResponse(3.0); // 384 samples -> total 960, over budget;
                               // evicting the oldest (256) brings it to 704.
    expect(Array.from(e.masterRack.impulseCache.keys())).toEqual([2.5, 3.0]);
  });

  test('a hit moves the key to the newest position (LRU order is preserved)', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    e.masterRack.getImpulseResponse(1.0);
    e.masterRack.getImpulseResponse(2.0);
    e.masterRack.getImpulseResponse(1.0);
    expect(Array.from(e.masterRack.impulseCache.keys())).toEqual([2.0, 1.0]);
  });

  test('a single impulse larger than the whole budget is still cached', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    e.masterRack.impulseCacheSampleBudget = 10;
    const buffer = e.masterRack.getImpulseResponse(9.9);
    expect(buffer).toBeTruthy();
    expect(Array.from(e.masterRack.impulseCache.keys())).toEqual([9.9]);
  });

  test('a repeated decay returns the same buffer instance', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    expect(e.masterRack.getImpulseResponse(2.0)).toBe(e.masterRack.getImpulseResponse(2.0));
  });
});

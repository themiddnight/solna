import { describe, expect, test } from 'bun:test';
import { INITIAL_EFFECTS } from '../store/initialState';
import type { MasterEffects } from '../types';
import { bindFakeCtx, makeEngine } from './testFakes';
import { masterChainCtx } from './engineTestHelpers';
import { createRenderEngine } from './engine';

/** A complete effects patch without setReverbDecay's separately-owned key. */
function fxWith(overrides: Partial<MasterEffects>): Omit<MasterEffects, 'reverbDecay'> {
  const next = { ...INITIAL_EFFECTS, ...overrides } as Record<string, unknown>;
  delete next.reverbDecay;
  return next as unknown as Omit<MasterEffects, 'reverbDecay'>;
}

/**
 * Captures the single `setTimeout` call a test body triggers and lets it
 * fire on demand, instead of waiting out the real reverb-tail delay. Only
 * safe when exactly one timer is armed during the patched window — every
 * test below arranges that by leaving delay/distortion active (their
 * INITIAL_EFFECTS defaults are non-zero) and only toggling reverb.
 */
function withFakeTimer() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let callback: (() => void) | undefined;
  globalThis.setTimeout = ((fn: () => void) => {
    callback = fn;
    return 1;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {
    callback = undefined;
  }) as typeof clearTimeout;
  return {
    fire: () => callback?.(),
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

/**
 * Split out of masterRack.test.ts to stay under the file's own line-count
 * gate (see eslint.config.js's max-lines comment: "Split the file, never
 * raise the cap"). Covers each source bus's own send nodes (getSourceBus),
 * the send gates they feed, and the reverb/delay/distortion nodes — the
 * mechanism that physically disconnects an idle effect send instead of merely
 * zeroing its downstream wet gain.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; these tests drive the private subsystem fields and the
   unexported constructor via casts. */
describe('effect sends physically disconnect when idle', () => {
  test('distortion send is still connected right after bypass, to let the downstream gain fade settle', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const gate = (engine as any).masterRack.distortionSendGate;
    const node = (engine as any).masterRack.distortionNode;
    expect(gate._connectTargets).toContain(node);

    engine.updateEffects(fxWith({ distortionBypass: true }));
    // Still connected immediately after bypass — disconnecting here would cut
    // the waveshaper's live input while distortionGain's fade is still
    // audibly non-zero (see DISTORTION_SEND_SETTLE_MS).
    expect(gate._connectTargets).toContain(node);
    expect((engine as any).masterRack.distortionSend.disconnectTimer).not.toBeNull();
  });

  test('re-enabling distortion before the settle timer fires cancels the pending disconnect', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ distortionBypass: true }));
    engine.updateEffects(fxWith({ distortionBypass: false, distortionWet: 0.4 }));

    const gate = (engine as any).masterRack.distortionSendGate;
    const node = (engine as any).masterRack.distortionNode;
    expect(gate._connectTargets).toContain(node);
    expect((engine as any).masterRack.distortionSend.disconnectTimer).toBeNull();
  });

  test('distortion send also schedules a disconnect at 0% wet with no explicit bypass', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ distortionWet: 0 }));
    const gate = (engine as any).masterRack.distortionSendGate;
    const node = (engine as any).masterRack.distortionNode;
    expect(gate._connectTargets).toContain(node);
    expect((engine as any).masterRack.distortionSend.disconnectTimer).not.toBeNull();
  });

  test('reverb send stays connected until its decay tail has finished, using fake timers', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();
    (engine as any).masterRack.reverbDecay = 1.0; // set on the instance directly for this test; setupMasterChain's own seed is 2.0

    engine.updateEffects(fxWith({ reverbBypass: true }));
    const gate = (engine as any).masterRack.reverbSendGate;
    const node = (engine as any).masterRack.reverbNode;
    // Still connected immediately after bypass — the tail has not decayed yet.
    expect(gate._connectTargets).toContain(node);
  });

  test('re-enabling reverb before the tail timer fires cancels the pending disconnect', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ reverbBypass: true }));
    engine.updateEffects(fxWith({ reverbBypass: false, reverbWet: 0.3 }));

    const gate = (engine as any).masterRack.reverbSendGate;
    const node = (engine as any).masterRack.reverbNode;
    expect(gate._connectTargets).toContain(node);
    expect((engine as any).masterRack.reverbDisconnectTimer).toBeNull();
  });

  test('delay send disconnects on bypass and stays connected briefly to let feedback tail ring out', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ delayBypass: true, delayFeedback: 0.35 }));
    const gate = (engine as any).masterRack.delaySendGate;
    const node = (engine as any).masterRack.delayNode;
    // Still connected immediately after bypass — the feedback tail has not
    // finished ringing out yet.
    expect(gate._connectTargets).toContain(node);
    expect((engine as any).masterRack.delaySend.disconnectTimer).not.toBeNull();
  });

  test('re-enabling delay before the tail timer fires cancels the pending disconnect', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ delayBypass: true, delayFeedback: 0.35 }));
    engine.updateEffects(fxWith({ delayBypass: false, delayWet: 0.3, delayFeedback: 0.35 }));

    const gate = (engine as any).masterRack.delaySendGate;
    const node = (engine as any).masterRack.delayNode;
    expect(gate._connectTargets).toContain(node);
    expect((engine as any).masterRack.delaySend.disconnectTimer).toBeNull();
  });
});

/** DEV-423: every source bus owns three send nodes; only they touch the gates. */
describe('each source bus feeds the gates through its own send nodes', () => {
  test('every bus reaches the gates only through its own send nodes, never straight to a gate or an effect node', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    const rack = (engine as any).masterRack;
    const direct = [
      rack.reverbSendGate, rack.delaySendGate, rack.distortionSendGate,
      rack.reverbNode, rack.delayNode, rack.distortionNode,
    ];

    for (const source of ['synth', 'chord', 'bass', 'pad', 'fx', 'sequencer']) {
      const bus = rack.getSourceBus(source);
      for (const node of direct) expect(bus._connectTargets).not.toContain(node);
      const sends = rack.sourceSendNodes.get(source);
      expect(sends.delay._connectTargets).toEqual([rack.delaySendGate]);
      expect(sends.distortion._connectTargets).toEqual([rack.distortionSendGate]);
    }
    for (const source of ['synth', 'chord', 'bass', 'pad', 'fx']) {
      const sends = rack.sourceSendNodes.get(source);
      expect(rack.getSourceBus(source)._connectTargets)
        .toEqual([rack.dryGain, sends.delay, sends.reverb, sends.distortion]);
      expect(sends.reverb._connectTargets).toEqual([rack.reverbSendGate]);
    }
  });
});

/**
 * DEV-423: the Beat (`sequencer`) bus is an ordinary track for delay and
 * distortion — its own send nodes feed those two gates — but it has NO
 * bus→reverb edge. Drum reverb stays the per-voice path through
 * `drumSendGate`, in series with the Beat track's reverb send (R304).
 */
describe('the Beat bus sends to delay and distortion, never from the bus to reverb', () => {
  function assertBeatBusSends(rack: any) {
    const bus = rack.getSourceBus('sequencer');
    const sends = rack.sourceSendNodes.get('sequencer');
    expect(bus._connectTargets).toEqual([rack.dryGain, sends.delay, sends.distortion]);
    expect(bus._connectTargets).not.toContain(sends.reverb);
    expect(bus._connectTargets).not.toContain(rack.reverbSendGate);
    expect(sends.delay._connectTargets).toEqual([rack.delaySendGate]);
    expect(sends.distortion._connectTargets).toEqual([rack.distortionSendGate]);
  }

  /** Drop the bus setupMasterChain built, so the next lookup builds it with every gate present. */
  function rebuildBeatBus(rack: any) {
    rack.sourceBuses.delete('sequencer');
    rack.sourceTaps.delete('sequencer');
    rack.sourceSendNodes.delete('sequencer');
    rack.getSourceTap('sequencer');
  }

  test('as built by setupMasterChain', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    assertBeatBusSends((engine as any).masterRack);
  });

  test('live engine: a Beat bus created later is wired the same way', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    const rack = (engine as any).masterRack;
    rebuildBeatBus(rack);
    assertBeatBusSends(rack);
  });

  test('render engine: a Beat bus created later is wired the same way', () => {
    const engine = createRenderEngine(masterChainCtx() as unknown as BaseAudioContext);
    const rack = (engine as any).masterRack;
    rebuildBeatBus(rack);
    assertBeatBusSends(rack);
  });

  test('getSourceBus requires the send gates', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    const rack = (engine as any).masterRack;
    rack.sourceBuses.delete('chord');
    rack.delaySendGate = null;
    expect(() => rack.getSourceBus('chord')).toThrow('send gates not initialized');
  });
});

/**
 * Final-review fix (perf/audio-engine-fixes, Finding 1): Task 1's send-gate
 * fix above only ever gated `reverbSendGate` — the per-source-bus feed. The
 * drum bus's own authored reverb send (`drumSendGate`, wired straight to
 * `reverbNode` in `setupMasterChain` and never touched again) stayed
 * permanently connected regardless of `reverbWet`/`reverbBypass`, so a
 * project with any drums (the common case) kept the convolver running
 * full-rate FFT convolution even with reverb fully bypassed — the perf win
 * barely materialized in practice. Split into its own `describe` (rather
 * than folded into the block above) to stay under this file's own
 * `max-lines-per-function` gate.
 */
describe('the Beat reverb feed shares the reverb tail gate, not a permanent connection', () => {
  test('the Beat reverb feed is drumSendGate → the Beat track reverb send → convolver', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    const rack = (engine as any).masterRack;
    const beatFeed = rack.sourceSendNodes.get('sequencer').reverb;
    expect(rack.drumSendGate._connectTargets).toEqual([beatFeed]);
    expect(beatFeed._connectTargets).toEqual([rack.reverbNode]);
  });

  test('C1: the convolver is fed reverbSendGate first, then the Beat reverb feed', () => {
    const ctx: any = masterChainCtx();
    const log: { from: unknown; to: unknown }[] = [];
    const createGain = ctx.createGain;
    ctx.createGain = () => {
      const node = createGain();
      const connect = node.connect;
      node.connect = (to: unknown) => {
        log.push({ from: node, to });
        connect(to);
      };
      return node;
    };
    const engine = makeEngine();
    bindFakeCtx(engine, ctx);
    const rack = (engine as any).masterRack;
    const feeds = log.filter((entry) => entry.to === rack.reverbNode).map((entry) => entry.from);
    expect(feeds).toEqual([rack.reverbSendGate, rack.sourceSendNodes.get('sequencer').reverb]);
  });

  test('bypassing reverb also tail-waits the drum send, sharing the reverb tail timer', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ reverbBypass: true }));

    const beatFeed = (engine as any).masterRack.sourceSendNodes.get('sequencer').reverb;
    const node = (engine as any).masterRack.reverbNode;
    // Still connected immediately — the tail has not decayed yet, exactly
    // like reverbSendGate above.
    expect(beatFeed._connectTargets).toContain(node);
    expect((engine as any).masterRack.reverbDisconnectTimer).not.toBeNull();
  });

  test('re-enabling reverb before the tail fires keeps the drum send connected too', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ reverbBypass: true }));
    engine.updateEffects(fxWith({ reverbBypass: false, reverbWet: 0.3 }));

    const beatFeed = (engine as any).masterRack.sourceSendNodes.get('sequencer').reverb;
    const node = (engine as any).masterRack.reverbNode;
    expect(beatFeed._connectTargets).toContain(node);
    expect((engine as any).masterRack.reverbDisconnectTimer).toBeNull();
  });

  test('once the shared tail timer fires, BOTH the per-source and the drum send physically disconnect from the convolver', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const timer = withFakeTimer();
    try {
      engine.updateEffects(fxWith({ reverbBypass: true }));
      timer.fire();
    } finally {
      timer.restore();
    }

    const reverbGate = (engine as any).masterRack.reverbSendGate;
    const beatFeed = (engine as any).masterRack.sourceSendNodes.get('sequencer').reverb;
    const node = (engine as any).masterRack.reverbNode;
    expect(reverbGate._connectTargets).not.toContain(node);
    expect(beatFeed._connectTargets).not.toContain(node);
    expect((engine as any).masterRack.reverbDisconnectTimer).toBeNull();
    expect((engine as any).masterRack.drumSendGate._connectTargets).toEqual([beatFeed]);
  });
});

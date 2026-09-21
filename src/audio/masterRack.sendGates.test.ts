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
 * raise the cap"). Covers the send gates that sit between every source bus
 * (getSourceBus) and the reverb/delay/distortion nodes — the mechanism that
 * physically disconnects an idle effect send instead of merely zeroing its
 * downstream wet gain.
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

  test('every source bus connects to the send gates, never straight to the effect nodes', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    const rack = (engine as any).masterRack;
    rack.setupMasterChain();

    const bus = rack.getSourceBus('synth');
    expect(bus._connectTargets).toContain(rack.reverbSendGate);
    expect(bus._connectTargets).toContain(rack.delaySendGate);
    expect(bus._connectTargets).toContain(rack.distortionSendGate);
    expect(bus._connectTargets).not.toContain(rack.reverbNode);
    expect(bus._connectTargets).not.toContain(rack.delayNode);
    expect(bus._connectTargets).not.toContain(rack.distortionNode);
  });
});

/**
 * The Beat (`sequencer`) source bus is the one bus that never feeds the
 * generic master sends: drums reach reverb only through the authored
 * per-voice `drumSendGate`, and never reach delay or distortion. This used to
 * hold only because setupMasterChain happened to create the sequencer bus
 * BEFORE the send gates, so getSourceBus's `if (this.delaySendGate)` guards
 * skipped. These tests rebuild the bus AFTER the gates exist, which is the
 * order that would have leaked, in the live engine and in a render engine.
 */
describe('the Beat bus never feeds the generic master sends', () => {
  function assertBeatBusExcluded(rack: any) {
    // Drop the bus setupMasterChain built, so the next lookup creates it with
    // every send gate already present.
    rack.sourceBuses.delete('sequencer');
    rack.sourceTaps.delete('sequencer');
    expect(rack.delaySendGate).not.toBeNull();
    expect(rack.reverbSendGate).not.toBeNull();
    expect(rack.distortionSendGate).not.toBeNull();

    const tap = rack.getSourceTap('sequencer');
    const bus = rack.getSourceBus('sequencer');
    expect(tap._connectTargets).toContain(bus);
    expect(bus._connectTargets).toContain(rack.dryGain);
    expect(bus._connectTargets).not.toContain(rack.delaySendGate);
    expect(bus._connectTargets).not.toContain(rack.reverbSendGate);
    expect(bus._connectTargets).not.toContain(rack.distortionSendGate);

    // Every other source still fans out to all three gates.
    const synth = rack.getSourceBus('synth');
    expect(synth._connectTargets).toContain(rack.delaySendGate);
    expect(synth._connectTargets).toContain(rack.reverbSendGate);
    expect(synth._connectTargets).toContain(rack.distortionSendGate);
  }

  test('as built by setupMasterChain, the sequencer bus reaches only the dry path', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    // bindContext already ran setupMasterChain once, which is the production
    // shape; a second explicit call would build over live buses.
    const rack = (engine as any).masterRack;
    const bus = rack.getSourceBus('sequencer');
    expect(bus._connectTargets).toEqual([rack.dryGain]);
  });

  test('live engine: a sequencer bus created after the send gates still skips them', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    assertBeatBusExcluded((engine as any).masterRack);
  });

  test('render engine: a sequencer bus created after the send gates still skips them', () => {
    const engine = createRenderEngine(masterChainCtx() as unknown as BaseAudioContext);
    assertBeatBusExcluded((engine as any).masterRack);
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
describe('the drum reverb send shares the reverb tail gate, not a permanent connection', () => {
  test('the drum reverb send is a second feed into the convolver, wired at setup like reverbSendGate', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    const drumGate = (engine as any).masterRack.drumSendGate;
    const node = (engine as any).masterRack.reverbNode;
    expect(drumGate._connectTargets).toContain(node);
  });

  test('bypassing reverb also tail-waits the drum send, sharing the reverb tail timer', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ reverbBypass: true }));

    const drumGate = (engine as any).masterRack.drumSendGate;
    const node = (engine as any).masterRack.reverbNode;
    // Still connected immediately — the tail has not decayed yet, exactly
    // like reverbSendGate above.
    expect(drumGate._connectTargets).toContain(node);
    expect((engine as any).masterRack.reverbDisconnectTimer).not.toBeNull();
  });

  test('re-enabling reverb before the tail fires keeps the drum send connected too', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    bindFakeCtx(engine, ctx);
    (engine as any).masterRack.setupMasterChain();

    engine.updateEffects(fxWith({ reverbBypass: true }));
    engine.updateEffects(fxWith({ reverbBypass: false, reverbWet: 0.3 }));

    const drumGate = (engine as any).masterRack.drumSendGate;
    const node = (engine as any).masterRack.reverbNode;
    expect(drumGate._connectTargets).toContain(node);
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
    const drumGate = (engine as any).masterRack.drumSendGate;
    const node = (engine as any).masterRack.reverbNode;
    expect(reverbGate._connectTargets).not.toContain(node);
    expect(drumGate._connectTargets).not.toContain(node);
    expect((engine as any).masterRack.reverbDisconnectTimer).toBeNull();
  });
});

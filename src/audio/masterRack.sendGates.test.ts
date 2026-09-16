import { describe, expect, test } from 'bun:test';
import { INITIAL_EFFECTS } from '../store/initialState';
import type { MasterEffects } from '../types';
import { bindFakeCtx, makeEngine } from './testFakes';
import { masterChainCtx } from './engineTestHelpers';

/** A complete effects patch without setReverbDecay's separately-owned key. */
function fxWith(overrides: Partial<MasterEffects>): Omit<MasterEffects, 'reverbDecay'> {
  const next = { ...INITIAL_EFFECTS, ...overrides } as Record<string, unknown>;
  delete next.reverbDecay;
  return next as unknown as Omit<MasterEffects, 'reverbDecay'>;
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
    expect((engine as any).masterRack.distortionDisconnectTimer).not.toBeNull();
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
    expect((engine as any).masterRack.distortionDisconnectTimer).toBeNull();
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
    expect((engine as any).masterRack.distortionDisconnectTimer).not.toBeNull();
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
    expect((engine as any).masterRack.delayDisconnectTimer).not.toBeNull();
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
    expect((engine as any).masterRack.delayDisconnectTimer).toBeNull();
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

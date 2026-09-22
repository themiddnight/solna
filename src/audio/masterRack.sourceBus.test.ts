import { describe, expect, test } from 'bun:test';
import { bindFakeCtx, freshEngine, makeEngine } from './testFakes';
import { FADER_MAX_DB, MAX_FADER_GAIN, dbToGain, toDecibels } from '../utils/gainUnits';
import { noteFrequency } from '../utils/musicTheory';
import { ACTIVE_SYNTH, masterChainCtx } from './engineTestHelpers';
import { MasterRack } from './masterRack';

const C4_HZ = noteFrequency('C4');

/* eslint-disable @typescript-eslint/no-explicit-any -- source-bus maps are
   intentionally private; the production engine surface drives this real rack. */

describe('source bus level control', () => {
  test('setSourceState atomically remembers gain and mute, then settles the bus', () => {
    const { engine, ctx } = freshEngine();
    ctx.currentTime = 0;
    engine.triggerSynthNoteOn(C4_HZ, ACTIVE_SYNTH, 0.8, undefined, 'synth', 1, 'live');
    const rack = (engine as any).masterRack;
    const synthBus = rack.sourceBuses.get('synth');
    const calls: [method: string, ...args: number[]][] = [];
    synthBus.gain.cancelScheduledValues = (at: number) => calls.push(['cancelScheduledValues', at]);
    synthBus.gain.setValueAtTime = (value: number, at: number) => calls.push(['setValueAtTime', value, at]);
    synthBus.gain.cancelAndHoldAtTime = (at: number) => calls.push(['cancelAndHoldAtTime', at]);
    synthBus.gain.setTargetAtTime = (value: number, at: number, constant: number) => {
      calls.push(['setTargetAtTime', value, at, constant]);
    };

    rack.setSourceState('synth', { gain: 0.8, muted: true }, 0, 'settle');

    expect(calls).toEqual([
      ['cancelScheduledValues', 0],
      ['setValueAtTime', 0, 0],
    ]);
    expect(rack.sourceGains.get('synth')).toBe(0.8);
    expect(rack.sourceMuted.get('synth')).toBe(true);

    calls.length = 0;
    engine.setSourceMuted('synth', false);
    expect(calls).toEqual([
      ['cancelAndHoldAtTime', 0],
      ['setTargetAtTime', 0.8, 0, 0.01],
    ]);
  });

  test('setSourceGain ramps instead of stepping, and clamps to 0..MAX_FADER_GAIN', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn(C4_HZ, ACTIVE_SYNTH, 0.8, undefined, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn(C4_HZ, ACTIVE_SYNTH, 0.8, undefined, 'bass', 1, 'live');
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
    engine.triggerSynthNoteOn(C4_HZ, ACTIVE_SYNTH, 0.8, undefined, 'fx', 1, 'live');
    const bus = (engine as any).masterRack.sourceBuses.get('fx');
    const boundary = ctx.currentTime + 0.075;

    engine.setSourceMuted('fx', true, boundary);

    expect(bus.gain.cancels.at(-1)).toBe(boundary);
    expect(bus.gain.targets.at(-1)).toEqual({ v: 0, t: boundary, tc: 0.01 });
  });

  test('a future source fader change also waits for the song boundary', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn(C4_HZ, ACTIVE_SYNTH, 0.8, undefined, 'fx', 1, 'live');
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
    engine.triggerSynthNoteOn(C4_HZ, ACTIVE_SYNTH, 0.8, undefined, 'bass', 1, 'live');
    const bus = (engine as any).masterRack.sourceBuses.get('bass');

    engine.setSourceMuted('bass', true);
    engine.setSourceGain('bass', 0.9);

    expect(bus.gain.targets.at(-1)!.v).toBe(0);
  });
});

function builtRack() {
  const engine = makeEngine();
  const ctx = masterChainCtx();
  bindFakeCtx(engine, ctx);
  return { engine, ctx, rack: (engine as any).masterRack };
}

/** Everything a param has been told, so "never touched" is one comparison. */
function automationOf(node: any): string {
  return JSON.stringify([node.gain.cancels, node.gain.events, node.gain.targets]);
}

describe('source send levels', () => {
  test('setSourceSends clamps, remembers and settles all three send nodes', () => {
    const { rack } = builtRack();
    rack.setSourceSends('chord', { reverb: 1.7, delay: -0.2, distortion: Number.NaN }, 10, 'settle');
    expect(rack.sourceSends.get('chord')).toEqual({ reverb: 1, delay: 0, distortion: 0 });
    const sends = rack.sourceSendNodes.get('chord');
    expect(sends.reverb.gain.events.at(-1)).toEqual({ kind: 'set', v: 1, t: 10 });
    expect(sends.delay.gain.events.at(-1)).toEqual({ kind: 'set', v: 0, t: 10 });
    expect(sends.distortion.gain.events.at(-1)).toEqual({ kind: 'set', v: 0, t: 10 });
  });

  test('a future send change transitions at the boundary, through the engine facade', () => {
    const { engine, ctx, rack } = builtRack();
    const boundary = ctx.currentTime + 0.075;
    engine.setSourceSends('bass', { reverb: 0.5, delay: 0.25, distortion: 0 }, boundary);
    const sends = rack.sourceSendNodes.get('bass');
    expect(sends.reverb.gain.targets.at(-1)).toEqual({ v: 0.5, t: boundary, tc: 0.01 });
    expect(sends.delay.gain.targets.at(-1)).toEqual({ v: 0.25, t: boundary, tc: 0.01 });
  });

  test('a send with no level received is seeded silent', () => {
    const { rack } = builtRack();
    rack.getSourceBus('pad');
    const sends = rack.sourceSendNodes.get('pad');
    expect([sends.reverb.gain.value, sends.delay.gain.value, sends.distortion.gain.value]).toEqual([0, 0, 0]);
  });

  test('levels received before init are kept and seed the lazily built nodes', () => {
    const rack: any = new MasterRack();
    rack.setSourceSends('pad', { reverb: 0.3, delay: 0.4, distortion: 0.5 });
    expect(rack.sourceSends.get('pad')).toEqual({ reverb: 0.3, delay: 0.4, distortion: 0.5 });
    rack.bind(masterChainCtx() as unknown as BaseAudioContext);
    rack.setupMasterChain();
    rack.getSourceBus('pad');
    const sends = rack.sourceSendNodes.get('pad');
    expect([sends.reverb.gain.value, sends.delay.gain.value, sends.distortion.gain.value]).toEqual([0.3, 0.4, 0.5]);
  });

  test('setSourceState never touches a send node; setSourceSends never touches the bus or drumSendGate', () => {
    const { rack } = builtRack();
    const bus = rack.getSourceBus('sequencer');
    const sends = rack.sourceSendNodes.get('sequencer');
    const sendNodes = [sends.reverb, sends.delay, sends.distortion];
    const sendsBefore = sendNodes.map(automationOf);
    rack.setSourceState('sequencer', { gain: 0.5, muted: false }, 10, 'settle');
    expect(sendNodes.map(automationOf)).toEqual(sendsBefore);

    const busBefore = [automationOf(bus), automationOf(rack.drumSendGate)];
    rack.setSourceSends('sequencer', { reverb: 0.5, delay: 0.5, distortion: 0.5 }, 10, 'settle');
    expect([automationOf(bus), automationOf(rack.drumSendGate)]).toEqual(busBefore);
  });

  test('dispose releases every send node and forgets every level', () => {
    const { ctx, rack } = builtRack();
    rack.setSourceSends('fx', { reverb: 1, delay: 1, distortion: 1 }, 10, 'settle');
    const sends = rack.sourceSendNodes.get('fx');
    rack.dispose(ctx.currentTime);
    expect(rack.sourceSendNodes.size).toBe(0);
    expect(rack.sourceSends.size).toBe(0);
    expect(sends.reverb._connectTargets).toEqual([]);
  });
});

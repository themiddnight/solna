import { describe, expect, test } from 'bun:test';
import { bindFakeCtx, freshEngine, makeEngine } from './testFakes';
import { FADER_MAX_DB, MAX_FADER_GAIN, dbToGain, toDecibels } from '../utils/gainUnits';
import { noteFrequency } from '../utils/musicTheory';
import { ACTIVE_SYNTH, masterChainCtx } from './engineTestHelpers';

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

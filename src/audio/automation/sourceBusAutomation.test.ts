import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  applySourceBusAutomation,
  SOURCE_BUS_TIME_CONSTANT_SEC,
  type SourceBusAutomationParam,
} from './sourceBusAutomation';

type Call = [method: string, ...args: number[]];

function recordingParam(options: { holdThrows?: boolean } = {}) {
  const calls: Call[] = [];
  const param: SourceBusAutomationParam = {
    value: 0.375,
    cancelScheduledValues(at) {
      calls.push(['cancelScheduledValues', at]);
    },
    cancelAndHoldAtTime(at) {
      calls.push(['cancelAndHoldAtTime', at]);
      if (options.holdThrows) throw new Error('unsupported');
    },
    setValueAtTime(value, at) {
      calls.push(['setValueAtTime', value, at]);
    },
    setTargetAtTime(value, at, constant) {
      calls.push(['setTargetAtTime', value, at, constant]);
    },
  };
  return { calls, param };
}

describe('applySourceBusAutomation', () => {
  test('settles the source bus immediately', () => {
    const { calls, param } = recordingParam();

    applySourceBusAutomation(param, 0, 0, 'settle');

    expect(calls).toEqual([
      ['cancelScheduledValues', 0],
      ['setValueAtTime', 0, 0],
    ]);
  });

  test('holds the current value and transitions toward the target', () => {
    const { calls, param } = recordingParam();

    applySourceBusAutomation(param, 0, 4, 'transition');

    expect(calls).toEqual([
      ['cancelAndHoldAtTime', 4],
      ['setTargetAtTime', 0, 4, SOURCE_BUS_TIME_CONSTANT_SEC],
    ]);
  });

  test('preserves earlier automation when cancelAndHoldAtTime throws', () => {
    const { calls, param } = recordingParam({ holdThrows: true });
    applySourceBusAutomation(param, 1, 0, 'settle');
    calls.length = 0;

    applySourceBusAutomation(param, 0, 4, 'transition');

    expect(calls).toEqual([
      ['cancelAndHoldAtTime', 4],
      ['cancelScheduledValues', 4],
      ['setValueAtTime', 1, 4],
      ['setTargetAtTime', 0, 4, SOURCE_BUS_TIME_CONSTANT_SEC],
    ]);
  });

  for (const { target, afterTenMilliseconds } of [
    { target: 0, afterTenMilliseconds: 0.0000167017 },
    { target: 0.5, afterTenMilliseconds: 0.3160769811 },
  ]) {
    test(`fallback retargets a future decay toward ${target} without reopening or jumping`, async () => {
      const sampleRate = 48_000;
      const ctx = new OfflineAudioContext(1, sampleRate * 0.3, sampleRate);
      const source = ctx.createConstantSource();
      const bus = ctx.createGain();
      source.connect(bus).connect(ctx.destination);
      source.start(0);
      let fallbackCount = 0;
      bus.gain.cancelAndHoldAtTime = () => {
        fallbackCount += 1;
        throw new Error('forced unsupported hold');
      };

      applySourceBusAutomation(bus.gain, 1, 0, 'settle');
      applySourceBusAutomation(bus.gain, 0, 0.1, 'transition');
      // Also replace a later scheduled opening: cancellation must keep the
      // earlier decay and discard this future event, even before rendering.
      applySourceBusAutomation(bus.gain, 1, 0.25, 'transition');
      applySourceBusAutomation(bus.gain, target, 0.2, 'transition');

      const samples = (await ctx.startRendering()).getChannelData(0);
      expect(fallbackCount).toBe(3);
      expect(samples[2400]).toBe(1); // audible control before the first mute
      expect(samples[5280]).toBeCloseTo(0.3678794412, 5); // 10 ms into the decay
      expect(samples[9600]).toBeCloseTo(0.0000453999, 6); // held value at 200 ms
      expect(samples[10080]).toBeCloseTo(afterTenMilliseconds, 5);
      let largestJump = 0;
      for (let i = 4800; i < samples.length; i += 1) {
        largestJump = Math.max(largestJump, Math.abs(samples[i] - samples[i - 1]));
      }
      expect(largestJump).toBeLessThan(0.0021);
      if (target === 0) {
        expect(samples.subarray(9600).every((value) => value < 0.000046)).toBe(true);
      }
    });
  }
});

import { describe, expect, test } from 'bun:test';
import {
  advanceAudioHealth,
  initialAudioHealthState,
  type AudioClockSample,
} from './health';
import type { AudioRuntimePolicy } from './policy';

const policy: AudioRuntimePolicy = {
  id: 'default',
  sampleIntervalMs: 1000,
  minClockRatio: 0.75,
  maxClockRatio: 1.25,
  suspiciousSamplesToFail: 3,
  maxWallGapMs: 2500,
  quirks: [],
};

const sample = (overrides: Partial<AudioClockSample> = {}): AudioClockSample => ({
  wallTimeMs: 0,
  audioTimeSec: 0,
  active: true,
  visible: true,
  contextState: 'running',
  ...overrides,
});

const feedRatios = (ratios: number[]) => {
  let state = initialAudioHealthState();
  let wallTimeMs = 0;
  let audioTimeSec = 0;

  state = advanceAudioHealth(state, sample({ wallTimeMs, audioTimeSec }), policy);
  for (const ratio of ratios) {
    wallTimeMs += policy.sampleIntervalMs;
    audioTimeSec += ratio;
    state = advanceAudioHealth(state, sample({ wallTimeMs, audioTimeSec }), policy);
  }

  return state;
};

describe('advanceAudioHealth ratios', () => {
  const ratioCases = [
    { name: 'normal clock', ratios: [1], phase: 'healthy', suspiciousCount: 0, lastRatio: 1 },
    { name: 'slow clock', ratios: [0.4], phase: 'suspected', suspiciousCount: 1, lastRatio: 0.4 },
    { name: 'fast clock', ratios: [1.6], phase: 'suspected', suspiciousCount: 1, lastRatio: 1.6 },
    { name: 'frozen clock', ratios: [0], phase: 'suspected', suspiciousCount: 1, lastRatio: 0 },
    { name: 'isolated spike', ratios: [1, 0.4, 1], phase: 'healthy', suspiciousCount: 0, lastRatio: 1 },
    { name: 'three consecutive slow samples', ratios: [1, 0.4, 0.4, 0.4], phase: 'unhealthy', suspiciousCount: 3, lastRatio: 0.4 },
    { name: 'three consecutive fast samples', ratios: [1, 1.6, 1.6, 1.6], phase: 'unhealthy', suspiciousCount: 3, lastRatio: 1.6 },
    { name: 'three consecutive frozen samples', ratios: [1, 0, 0, 0], phase: 'unhealthy', suspiciousCount: 3, lastRatio: 0 },
  ] as const;

  for (const { name, ratios, phase, suspiciousCount, lastRatio } of ratioCases) {
    test(`${name} has the expected health state`, () => {
      const state = feedRatios([...ratios]);

      expect(state.phase).toBe(phase);
      expect(state.suspiciousCount).toBe(suspiciousCount);
      expect(state.lastRatio).toBeCloseTo(lastRatio);
    });
  }

  const ratioBoundaryCases = [
    { name: 'the minimum boundary', ratio: 0.75, phase: 'healthy' },
    { name: 'the maximum boundary', ratio: 1.25, phase: 'healthy' },
    { name: 'just below the minimum', ratio: 0.749999, phase: 'suspected' },
    { name: 'just above the maximum', ratio: 1.250001, phase: 'suspected' },
  ] as const;

  for (const { name, ratio, phase } of ratioBoundaryCases) {
    test(`${name} clock ratio is ${phase}`, () => {
      const state = feedRatios([ratio]);

      expect(state.phase).toBe(phase);
      expect(state.lastRatio).toBeCloseTo(ratio);
    });
  }
});

describe('advanceAudioHealth baseline and latch', () => {
  const invalidCases = [
    { name: 'hidden document', invalid: { visible: false } },
    { name: 'suspended context', invalid: { contextState: 'suspended' as const } },
    { name: 'inactive monitor', invalid: { active: false } },
  ] as const;

  for (const { name, invalid } of invalidCases) {
    test(`${name} resets the baseline and suspicion`, () => {
      let state = feedRatios([0.4]);
      state = advanceAudioHealth(state, sample({ wallTimeMs: 2000, audioTimeSec: 1.4, ...invalid }), policy);

      expect(state).toEqual({
        phase: 'idle',
        previous: null,
        suspiciousCount: 0,
        lastRatio: null,
      });
    });
  }

  test('a wall gap above the policy limit resets the baseline and suspicion', () => {
    let state = initialAudioHealthState();
    state = advanceAudioHealth(state, sample(), policy);
    state = advanceAudioHealth(state, sample({ wallTimeMs: 2501, audioTimeSec: 2.501 }), policy);

    expect(state).toEqual({
      phase: 'idle',
      previous: null,
      suspiciousCount: 0,
      lastRatio: null,
    });
  });

  test('a wall gap exactly at the policy limit remains a valid ratio', () => {
    let state = initialAudioHealthState();
    state = advanceAudioHealth(state, sample(), policy);
    state = advanceAudioHealth(state, sample({ wallTimeMs: 2500, audioTimeSec: 2.5 }), policy);

    expect(state.phase).toBe('healthy');
    expect(state.suspiciousCount).toBe(0);
    expect(state.lastRatio).toBe(1);
  });

  test('does not reuse an invalid sample as the next ratio baseline', () => {
    let state = initialAudioHealthState();
    state = advanceAudioHealth(state, sample(), policy);
    state = advanceAudioHealth(state, sample({ wallTimeMs: 1000, audioTimeSec: 0.4, visible: false }), policy);
    state = advanceAudioHealth(state, sample({ wallTimeMs: 2000, audioTimeSec: 1.4 }), policy);

    expect(state).toEqual({
      phase: 'healthy',
      previous: sample({ wallTimeMs: 2000, audioTimeSec: 1.4 }),
      suspiciousCount: 0,
      lastRatio: null,
    });
  });

  test('keeps an unhealthy incident latched through a healthy sample until the reducer is reset', () => {
    const unhealthy = feedRatios([1, 0.4, 0.4, 0.4]);
    const afterRecovery = advanceAudioHealth(
      unhealthy,
      sample({ wallTimeMs: 5000, audioTimeSec: 3.2 }),
      policy,
    );

    expect(afterRecovery.phase).toBe('unhealthy');
    expect(initialAudioHealthState().phase).toBe('idle');
  });

  const unhealthyResetCases = [
    { name: 'invalid sample', sample: sample({ visible: false }) },
    { name: 'long wall gap', sample: sample({ wallTimeMs: 7000, audioTimeSec: 5.2 }) },
  ] as const;

  for (const { name, sample: nextSample } of unhealthyResetCases) {
    test(`keeps an unhealthy incident latched through ${name}`, () => {
      const unhealthy = feedRatios([1, 0.4, 0.4, 0.4]);
      const state = advanceAudioHealth(unhealthy, nextSample, policy);

      expect(state).toEqual({
        phase: 'unhealthy',
        previous: null,
        suspiciousCount: 0,
        lastRatio: null,
      });
    });
  }
});

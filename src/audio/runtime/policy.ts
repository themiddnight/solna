import type { RuntimeProfile } from './profile';

export interface AudioRuntimePolicy {
  id: 'default' | 'ios-webkit';
  sampleIntervalMs: 1000;
  minClockRatio: 0.75;
  maxClockRatio: 1.25;
  suspiciousSamplesToFail: 3;
  maxWallGapMs: 2500;
  quirks: readonly string[];
}

const DEFAULT_POLICY: AudioRuntimePolicy = {
  id: 'default',
  sampleIntervalMs: 1000,
  minClockRatio: 0.75,
  maxClockRatio: 1.25,
  suspiciousSamplesToFail: 3,
  maxWallGapMs: 2500,
  quirks: [],
};

const IOS_WEBKIT_POLICY: AudioRuntimePolicy = {
  ...DEFAULT_POLICY,
  id: 'ios-webkit',
  quirks: ['ios-webkit-clock-drift'],
};

export function runtimePolicyFor(profile: RuntimeProfile): AudioRuntimePolicy {
  return profile.platform === 'ios' && profile.engine === 'webkit'
    ? IOS_WEBKIT_POLICY
    : DEFAULT_POLICY;
}

import { describe, expect, test } from 'bun:test';
import { detectRuntimeProfile } from './profile';
import { runtimePolicyFor } from './policy';

const iPhoneSafari = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
  standalone: false,
};

const macSafari = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 0,
  standalone: false,
};

const nonIosWebKitEnvironments = [
  macSafari,
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    maxTouchPoints: 0,
    standalone: false,
  },
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
    platform: 'Linux x86_64',
    maxTouchPoints: 0,
    standalone: false,
  },
  {
    userAgent: 'SolnaRuntime/1.0',
    platform: 'Unknown',
    maxTouchPoints: 0,
    standalone: false,
  },
];

describe('runtimePolicyFor', () => {
  test('applies the clock-drift quirk only to iOS WebKit', () => {
    const iosPolicy = runtimePolicyFor(detectRuntimeProfile(iPhoneSafari));
    expect(iosPolicy).toEqual({
      id: 'ios-webkit',
      sampleIntervalMs: 1000,
      minClockRatio: 0.75,
      maxClockRatio: 1.25,
      suspiciousSamplesToFail: 3,
      maxWallGapMs: 2500,
      quirks: ['ios-webkit-clock-drift'],
    });

    for (const environment of nonIosWebKitEnvironments) {
      const policy = runtimePolicyFor(detectRuntimeProfile(environment));
      expect(policy.quirks).toEqual([]);
      expect(policy.id).toBe('default');
    }
  });
});

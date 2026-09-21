import { describe, expect, test } from 'bun:test';
import { detectRuntimeProfile } from './profile';

const classifications = [
    {
      name: 'iPhone Safari',
      environment: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
        standalone: false,
      },
      expected: { engine: 'webkit', platform: 'ios', standalone: false },
    },
    {
      name: 'installed iPhone PWA',
      environment: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
        standalone: true,
      },
      expected: { engine: 'webkit', platform: 'ios', standalone: true },
    },
    {
      name: 'iPad in desktop mode',
      environment: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        platform: 'MacIntel',
        maxTouchPoints: 5,
        standalone: false,
      },
      expected: { engine: 'webkit', platform: 'ios', standalone: false },
    },
    {
      name: 'iPhone Chrome, which still renders with WebKit',
      environment: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
        standalone: false,
      },
      expected: { engine: 'webkit', platform: 'ios', standalone: false },
    },
    {
      name: 'iPhone Firefox, which still renders with WebKit',
      environment: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/128.0 Mobile/15E148 Safari/605.1.15',
        platform: 'iPhone',
        maxTouchPoints: 5,
        standalone: false,
      },
      expected: { engine: 'webkit', platform: 'ios', standalone: false },
    },
    {
      name: 'macOS Safari',
      environment: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        standalone: false,
      },
      expected: { engine: 'webkit', platform: 'macos', standalone: false },
    },
    {
      name: 'macOS Chrome',
      environment: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        standalone: false,
      },
      expected: { engine: 'chromium', platform: 'macos', standalone: false },
    },
    {
      name: 'macOS Firefox',
      environment: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        standalone: false,
      },
      expected: { engine: 'gecko', platform: 'macos', standalone: false },
    },
    {
      name: 'macOS unknown engine',
      environment: {
        userAgent: 'SolnaRuntime/1.0 (Macintosh; Intel Mac OS X 14.6)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        standalone: false,
      },
      expected: { engine: 'unknown', platform: 'macos', standalone: false },
    },
    {
      name: 'Firefox',
      environment: {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
        platform: 'Linux x86_64',
        maxTouchPoints: 0,
        standalone: false,
      },
      expected: { engine: 'gecko', platform: 'linux', standalone: false },
    },
    {
      name: 'an unknown runtime',
      environment: {
        userAgent: 'SolnaRuntime/1.0',
        platform: 'Unknown',
        maxTouchPoints: 0,
        standalone: false,
      },
      expected: { engine: 'unknown', platform: 'unknown', standalone: false },
    },
  ] as const;

describe('detectRuntimeProfile', () => {
  for (const { name, environment, expected } of classifications) {
    test(`classifies ${name}`, () => {
      expect(detectRuntimeProfile(environment)).toEqual({
        ...expected,
        userAgent: environment.userAgent,
      });
    });
  }
});

import { describe, expect, test } from 'bun:test';
import { canonicalContent, defaultContentFingerprint, fingerprintContent, isContentDirty } from './projectFingerprint';
import { factoryProjectContent } from './projectFormat';
import { createDefaultLoop } from './loopSlice';

/** Rebuilds an object with its keys in reverse insertion order, recursively. */
function reversedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reversedKeys) as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse()) {
      out[key] = reversedKeys((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

describe('fingerprintContent', () => {
  test('is stable across key insertion order, including nested objects', () => {
    const a = factoryProjectContent();
    const b = reversedKeys(a);
    expect(Object.keys(b)[0]).not.toBe(Object.keys(a)[0]); // the reorder really happened
    expect(fingerprintContent(a)).toBe(fingerprintContent(b));
    expect(canonicalContent(a)).toBe(canonicalContent(b));
  });

  test('changes when any content field changes', () => {
    const base = factoryProjectContent();
    const baseline = fingerprintContent(base);
    expect(fingerprintContent({ ...base, bpm: 121 })).not.toBe(baseline);
    expect(fingerprintContent({ ...base, meterId: '3/4' })).not.toBe(baseline);
    expect(fingerprintContent({ ...base, masterVolume: 0.5 })).not.toBe(baseline);
    expect(fingerprintContent({ ...base, effects: { ...base.effects, reverbWet: 0.99 } })).not.toBe(baseline);
    const loop = { ...createDefaultLoop(), chordFeel: 0.77 };
    expect(fingerprintContent({ ...base, loops: [loop] })).not.toBe(baseline);
    expect(fingerprintContent({ ...base, loops: [createDefaultLoop(), createDefaultLoop()] })).not.toBe(baseline);
  });

  test('ignores keys outside the content set even when they are present', () => {
    const base = factoryProjectContent();
    const withExtras = { ...base, selectedVibeId: 'cyber-dance', controlTarget: 'bass', activeLoopId: 'zzz' };
    expect(fingerprintContent(withExtras as never)).toBe(fingerprintContent(base));
  });

  test('is a short token, not a copy of the content', () => {
    expect(fingerprintContent(factoryProjectContent()).length).toBeLessThan(32);
  });
});

describe('defaultContentFingerprint / isContentDirty', () => {
  test('the default fingerprint is the fingerprint of the factory content, and is stable across calls', () => {
    expect(defaultContentFingerprint()).toBe(fingerprintContent(factoryProjectContent()));
    expect(defaultContentFingerprint()).toBe(defaultContentFingerprint());
  });

  test('an untitled session is clean only while it equals the default project', () => {
    const base = factoryProjectContent();
    expect(isContentDirty(base, null, null)).toBe(false);
    expect(isContentDirty({ ...base, bpm: 121 }, null, null)).toBe(true);
    expect(isContentDirty({ ...base, loops: [createDefaultLoop(), createDefaultLoop()] }, null, null)).toBe(true);
  });

  test('an untitled session ignores any stray baseline hash', () => {
    const base = factoryProjectContent();
    expect(isContentDirty(base, null, 'stale-hash')).toBe(false);
  });

  test('a saved project compares against its baseline', () => {
    const base = factoryProjectContent();
    const changed = { ...base, bpm: 121 };
    expect(isContentDirty(changed, 'p-1', fingerprintContent(changed))).toBe(false);
    expect(isContentDirty(changed, 'p-1', fingerprintContent(base))).toBe(true);
  });

  test('a saved project with no baseline is treated as dirty', () => {
    expect(isContentDirty(factoryProjectContent(), 'p-1', null)).toBe(true);
  });

  test('the injected fingerprint is used for the content, so a spy can count computations', () => {
    let calls = 0;
    isContentDirty(factoryProjectContent(), 'p-1', 'x', (c) => { calls++; return fingerprintContent(c); });
    expect(calls).toBe(1);
  });
});

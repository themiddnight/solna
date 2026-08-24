import { describe, expect, test } from 'bun:test';
import { persistTheme, readStoredTheme, resolveInitialTheme } from './Header';

describe('resolveInitialTheme', () => {
  test('a stored theme always wins over the OS preference', () => {
    expect(resolveInitialTheme('solva-light', false)).toBe('solva-light');
    expect(resolveInitialTheme('solva-dark', true)).toBe('solva-dark');
  });

  test('first visit follows the OS preference', () => {
    expect(resolveInitialTheme(null, true)).toBe('solva-light');
    expect(resolveInitialTheme(null, false)).toBe('solva-dark');
  });

  test('a corrupt or legacy stored value falls back to the OS preference', () => {
    expect(resolveInitialTheme('murva-dark', true)).toBe('solva-light');
    expect(resolveInitialTheme('', false)).toBe('solva-dark');
    expect(resolveInitialTheme('null', false)).toBe('solva-dark');
  });
});

// Storage access itself can throw (Safari private browsing, "block all
// cookies", some embedded webviews) — not merely return null. These stubs
// simulate that failure mode without needing a real blocked browser.
const throwingGetStorage = {
  getItem(): string | null {
    throw new Error('SecurityError: storage is blocked');
  },
};

const throwingSetStorage = {
  setItem(): void {
    throw new Error('SecurityError: storage is blocked');
  },
};

describe('readStoredTheme', () => {
  test('returns the stored value when storage works normally', () => {
    const storage = { getItem: () => 'solva-light' };
    expect(readStoredTheme(storage)).toBe('solva-light');
  });

  test('degrades to null when storage access throws, instead of propagating', () => {
    expect(readStoredTheme(throwingGetStorage)).toBeNull();
  });

  test('returns null with no storage injected and no global (bun test has no localStorage)', () => {
    // Regression: the old `storage = localStorage` default parameter evaluated
    // the property access BEFORE the try/catch ran, so environments without a
    // localStorage global threw a ReferenceError at call time.
    expect(readStoredTheme()).toBeNull();
  });
});

describe('persistTheme', () => {
  test('writes the theme under the storage key when storage works normally', () => {
    const calls: Array<[string, string]> = [];
    const storage = {
      setItem: (key: string, value: string) => {
        calls.push([key, value]);
      },
    };
    persistTheme('solva-light', storage);
    expect(calls).toEqual([['solva_theme', 'solva-light']]);
  });

  test('does not throw when storage access throws (best-effort persistence)', () => {
    expect(() => persistTheme('solva-dark', throwingSetStorage)).not.toThrow();
  });

  test('does not throw with no storage injected and no global (bun test has no localStorage)', () => {
    // Same regression as readStoredTheme: the default parameter must not
    // evaluate localStorage outside the try/catch.
    expect(() => persistTheme('solva-light')).not.toThrow();
  });
});

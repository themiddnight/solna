import { describe, expect, test } from 'bun:test';
import { AUTOMATION_TABS, persistTheme, readStoredTheme, resolveInitialTheme, SOLO_TABS } from './Header';

describe('resolveInitialTheme', () => {
  test('a stored theme always wins over the OS preference', () => {
    expect(resolveInitialTheme('solna-light', false)).toBe('solna-light');
    expect(resolveInitialTheme('solna-dark', true)).toBe('solna-dark');
  });

  test('first visit follows the OS preference', () => {
    expect(resolveInitialTheme(null, true)).toBe('solna-light');
    expect(resolveInitialTheme(null, false)).toBe('solna-dark');
  });

  test('a corrupt or legacy stored value falls back to the OS preference', () => {
    expect(resolveInitialTheme('murva-dark', true)).toBe('solna-light');
    expect(resolveInitialTheme('', false)).toBe('solna-dark');
    expect(resolveInitialTheme('null', false)).toBe('solna-dark');
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
    const storage = { getItem: () => 'solna-light' };
    expect(readStoredTheme(storage)).toBe('solna-light');
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
    persistTheme('solna-light', storage);
    expect(calls).toEqual([['solna_theme', 'solna-light']]);
  });

  test('does not throw when storage access throws (best-effort persistence)', () => {
    expect(() => persistTheme('solna-dark', throwingSetStorage)).not.toThrow();
  });

  test('does not throw with no storage injected and no global (bun test has no localStorage)', () => {
    // Same regression as readStoredTheme: the default parameter must not
    // evaluate localStorage outside the try/catch.
    expect(() => persistTheme('solna-light')).not.toThrow();
  });
});

describe('header tab grouping', () => {
  test('only the two automation players carry a transport', () => {
    expect(AUTOMATION_TABS.map((t) => t.view)).toEqual(['sequencer', 'chords']);
    expect(AUTOMATION_TABS.every((t) => t.module !== undefined)).toBe(true);
  });

  test('synth and master fx stand alone, with no transport', () => {
    expect(SOLO_TABS.map((t) => t.view)).toEqual(['synth', 'effects']);
  });

  test('every tab view is still reachable', () => {
    const views = [...SOLO_TABS, ...AUTOMATION_TABS].map((t) => t.view).sort();
    expect(views).toEqual(['chords', 'effects', 'sequencer', 'synth']);
  });
});

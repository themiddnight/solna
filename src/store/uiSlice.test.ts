import { describe, expect, test } from 'bun:test';
import { createUiSlice, persistKeyboardMode, readStoredKeyboardMode } from './uiSlice';

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

describe('readStoredKeyboardMode', () => {
  test('adopts a valid stored value', () => {
    const storage = { getItem: () => 'chord' };
    expect(readStoredKeyboardMode(storage)).toBe('chord');
  });

  test('returns null when nothing is stored', () => {
    const storage = { getItem: () => null };
    expect(readStoredKeyboardMode(storage)).toBeNull();
  });

  test('rejects an invalid stored value rather than adopting it', () => {
    expect(readStoredKeyboardMode({ getItem: () => 'banana' })).toBeNull();
    expect(readStoredKeyboardMode({ getItem: () => '' })).toBeNull();
  });

  test('degrades to null when storage access throws, instead of propagating', () => {
    expect(readStoredKeyboardMode(throwingGetStorage)).toBeNull();
  });

  test('returns null with no storage injected and no global (bun test has no localStorage)', () => {
    expect(readStoredKeyboardMode()).toBeNull();
  });
});

describe('persistKeyboardMode', () => {
  test('writes the mode under the storage key when storage works normally', () => {
    const calls: Array<[string, string]> = [];
    const storage = {
      setItem: (key: string, value: string) => {
        calls.push([key, value]);
      },
    };
    persistKeyboardMode('chromatic', storage);
    expect(calls).toEqual([['solna_keyboard_mode', 'chromatic']]);
  });

  test('does not throw when storage access throws (best-effort persistence)', () => {
    expect(() => persistKeyboardMode('chord', throwingSetStorage)).not.toThrow();
  });

  test('does not throw with no storage injected and no global (bun test has no localStorage)', () => {
    expect(() => persistKeyboardMode('scale-locked')).not.toThrow();
  });
});

describe('createUiSlice defaults', () => {
  test('falls back to scale-locked when there is no global localStorage (bun test)', () => {
    const calls: Record<string, unknown>[] = [];
    const slice = createUiSlice(((partial: Record<string, unknown>) => calls.push(partial)) as never);
    expect(slice.keyboardMode).toBe('scale-locked');
  });

  test('setKeyboardMode still updates in-memory state when the write-through throws', () => {
    let applied: Record<string, unknown> | undefined;
    const slice = createUiSlice(((partial: Record<string, unknown>) => {
      applied = partial;
    }) as never);
    // persistKeyboardMode() inside setKeyboardMode resolves the real (absent)
    // localStorage global and swallows the failure; state must still update.
    slice.setKeyboardMode('chord');
    expect(applied).toEqual({ keyboardMode: 'chord' });
  });
});

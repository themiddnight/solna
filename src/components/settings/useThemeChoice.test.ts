import { describe, expect, test } from 'bun:test';
import type { ThemeChoice, ThemeId } from './themes';
import {
  createThemeChoiceStore,
  persistThemeChoice,
  readThemeChoice,
  type ThemeChoiceEnv,
} from './useThemeChoice';

// Storage access itself can throw (Safari private browsing, "block all
// cookies", some embedded webviews) — not merely return null.
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

/** An env that records what the store paints and persists, with a switchable OS scheme. */
function fakeEnv(prefersLight = false) {
  let light = prefersLight;
  const listeners = new Set<() => void>();
  const painted: ThemeId[] = [];
  const persisted: ThemeChoice[] = [];
  let themeColorWrites = 0;
  const env: ThemeChoiceEnv = {
    prefersLight: () => light,
    onSchemeChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDocumentTheme: (id) => {
      painted.push(id);
    },
    syncThemeColor: () => {
      themeColorWrites += 1;
    },
    persist: (choice) => {
      persisted.push(choice);
    },
  };
  return {
    env,
    painted,
    persisted,
    listeners,
    themeColorWrites: () => themeColorWrites,
    setOs(next: boolean) {
      light = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('readThemeChoice / persistThemeChoice', () => {
  test('a legacy stored theme reads back as that choice', () => {
    expect(readThemeChoice({ getItem: () => 'solna-light' })).toBe('solna-light');
  });

  test("an unknown stored id reads back as 'system'", () => {
    expect(readThemeChoice({ getItem: () => 'murva-dark' })).toBe('system');
  });

  test("a throwing read degrades to 'system'", () => {
    expect(readThemeChoice(throwingGetStorage)).toBe('system');
  });

  test("no storage injected and no global (bun test has no localStorage) reads 'system'", () => {
    expect(readThemeChoice()).toBe('system');
  });

  test('writes the choice under solna_theme', () => {
    const calls: Array<[string, string]> = [];
    persistThemeChoice('dracula', { setItem: (key: string, value: string) => void calls.push([key, value]) });
    expect(calls).toEqual([['solna_theme', 'dracula']]);
  });

  test('a throwing or absent storage does not throw', () => {
    expect(() => persistThemeChoice('dracula', throwingSetStorage)).not.toThrow();
    expect(() => persistThemeChoice('system')).not.toThrow();
  });
});

describe('createThemeChoiceStore — start, select, apply, revert', () => {
  test('start paints the resolved theme and writes theme-color once', () => {
    const fake = fakeEnv(true);
    const store = createThemeChoiceStore('system', fake.env);
    store.start();
    expect(fake.painted).toEqual(['solna-light']);
    expect(fake.themeColorWrites()).toBe(1);
    expect(store.getSnapshot()).toEqual({ applied: 'system', preview: 'system', resolved: 'solna-light' });
  });

  // Review Focus 3: the bootstrap wrote an unknown id verbatim; mount corrects it.
  test('start corrects an unknown stored id to the System resolution', () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore(readThemeChoice({ getItem: () => 'retired-theme' }), fake.env);
    store.start();
    expect(fake.painted).toEqual(['solna-dark']);
  });

  test('select previews without persisting', () => {
    const fake = fakeEnv();
    const store = createThemeChoiceStore('solna-dark', fake.env);
    store.start();
    store.select('dracula');
    expect(fake.painted.at(-1)).toBe('dracula');
    expect(fake.persisted).toEqual([]);
    expect(store.getSnapshot()).toEqual({ applied: 'solna-dark', preview: 'dracula', resolved: 'dracula' });
  });

  test('select then apply persists the preview once', () => {
    const fake = fakeEnv();
    const store = createThemeChoiceStore('solna-dark', fake.env);
    store.select('nord');
    store.apply();
    store.apply();
    expect(fake.persisted).toEqual(['nord']);
    expect(store.getSnapshot().applied).toBe('nord');
  });

  test('select then revert restores the applied theme on screen', () => {
    const fake = fakeEnv();
    const store = createThemeChoiceStore('solna-dark', fake.env);
    store.start();
    store.select('cupcake');
    store.revert();
    expect(fake.painted.at(-1)).toBe('solna-dark');
    expect(store.getSnapshot()).toEqual({ applied: 'solna-dark', preview: 'solna-dark', resolved: 'solna-dark' });
    expect(fake.persisted).toEqual([]);
  });
});

describe('createThemeChoiceStore — OS scheme, theme-color, subscribers', () => {
  test('an OS change while System is previewed re-resolves live', () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore('system', fake.env);
    store.start();
    fake.setOs(true);
    expect(fake.painted.at(-1)).toBe('solna-light');
    expect(store.getSnapshot().resolved).toBe('solna-light');
  });

  // Review Focus 1.
  test('an OS change while previewing a fixed theme changes nothing', () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore('system', fake.env);
    store.start();
    store.select('dracula');
    const paints = fake.painted.length;
    fake.setOs(true);
    expect(fake.painted.length).toBe(paints);
    expect(store.getSnapshot().resolved).toBe('dracula');
    store.revert();
    expect(fake.painted.at(-1)).toBe('solna-light'); // back to System, resolved by today's OS
  });

  // Review Focus 4.
  test("applying System persists 'system' and keeps following the OS", () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore('solna-dark', fake.env);
    store.start();
    store.select('system');
    store.apply();
    expect(fake.persisted).toEqual(['system']);
    fake.setOs(true);
    expect(fake.painted.at(-1)).toBe('solna-light');
  });

  test('a throwing storage keeps the session theme', () => {
    const fake = fakeEnv();
    const env: ThemeChoiceEnv = { ...fake.env, persist: (choice) => persistThemeChoice(choice, throwingSetStorage) };
    const store = createThemeChoiceStore('solna-dark', env);
    store.select('dracula');
    expect(() => store.apply()).not.toThrow();
    expect(store.getSnapshot()).toEqual({ applied: 'dracula', preview: 'dracula', resolved: 'dracula' });
    expect(fake.painted.at(-1)).toBe('dracula');
  });

  test('theme-color is rewritten after every repaint, and not when nothing changes', () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore('system', fake.env);
    store.start(); // 1
    store.select('dracula'); // 2
    store.select('dracula'); // unchanged
    store.select('system'); // 3
    fake.setOs(true); // 4
    expect(fake.themeColorWrites()).toBe(4);
  });

  test('subscribers are notified on change, and the start cleanup drops the OS listener', () => {
    const fake = fakeEnv();
    const store = createThemeChoiceStore('system', fake.env);
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    const stop = store.start();
    store.select('nord');
    expect(calls).toBe(1);
    expect(fake.listeners.size).toBe(1);
    stop();
    expect(fake.listeners.size).toBe(0);
  });
});

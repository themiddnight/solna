import { useEffect, useState, useSyncExternalStore } from 'react';
import { persistGuardedStorageValue, readGuardedStorageValue } from '@/utils/storage';
import { resolveThemeRgb, rgbToCss } from '@/utils/themeColor';
import { parseThemeChoice, resolveTheme, THEME_STORAGE_KEY, type ThemeChoice, type ThemeId } from './themes';

const PREFERS_LIGHT_QUERY = '(prefers-color-scheme: light)';

/** The stored choice, validated on read (R214, R345); a throwing read is "nothing stored". */
export function readThemeChoice(storage?: Pick<Storage, 'getItem'>): ThemeChoice {
  return parseThemeChoice(readGuardedStorageValue(THEME_STORAGE_KEY, storage));
}

/** Best-effort (R244): a throwing `setItem` loses only cross-session persistence. */
export function persistThemeChoice(choice: ThemeChoice, storage?: Pick<Storage, 'setItem'>): void {
  persistGuardedStorageValue(THEME_STORAGE_KEY, choice, storage);
}

interface ThemeChoiceState {
  /** What is persisted. */
  readonly applied: ThemeChoice;
  /** What is on screen. */
  readonly preview: ThemeChoice;
  /** `preview` resolved against the OS scheme — the `data-theme` actually painted. */
  readonly resolved: ThemeId;
}

/** Everything the store touches outside itself — the browser in the app, fakes in tests. */
export interface ThemeChoiceEnv {
  prefersLight: () => boolean;
  onSchemeChange: (listener: () => void) => () => void;
  setDocumentTheme: (id: ThemeId) => void;
  syncThemeColor: () => void;
  persist: (choice: ThemeChoice) => void;
}

export interface ThemeChoiceStore {
  getSnapshot: () => ThemeChoiceState;
  subscribe: (listener: () => void) => () => void;
  /** Paints once and follows the OS scheme; returns the cleanup. */
  start: () => () => void;
  select: (choice: ThemeChoice) => void;
  apply: () => void;
  revert: () => void;
}

/**
 * Preview vs apply (R346): `select` paints without persisting, `apply`
 * persists the preview, `revert` repaints the applied choice. A `system`
 * preview re-resolves when the OS scheme changes; a fixed one ignores it.
 * Every repaint rewrites `<meta name="theme-color">` (R347).
 */
export function createThemeChoiceStore(initial: ThemeChoice, env: ThemeChoiceEnv): ThemeChoiceStore {
  let state: ThemeChoiceState = {
    applied: initial,
    preview: initial,
    resolved: resolveTheme(initial, env.prefersLight()),
  };
  const listeners = new Set<() => void>();

  const paint = () => {
    env.setDocumentTheme(state.resolved);
    env.syncThemeColor();
  };

  const commit = (applied: ThemeChoice, preview: ThemeChoice) => {
    const resolved = resolveTheme(preview, env.prefersLight());
    if (applied === state.applied && preview === state.preview && resolved === state.resolved) return;
    const repaint = resolved !== state.resolved;
    state = { applied, preview, resolved };
    if (repaint) paint();
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      paint();
      return env.onSchemeChange(() => {
        if (state.preview === 'system') commit(state.applied, state.preview);
      });
    },
    select: (choice) => commit(state.applied, choice),
    apply() {
      if (state.preview === state.applied) return;
      env.persist(state.preview);
      commit(state.preview, state.preview);
    },
    revert: () => commit(state.applied, state.applied),
  };
}

/** The real env. Lazy: nothing here touches the DOM until the store paints (never under renderToString). */
function browserThemeEnv(): ThemeChoiceEnv {
  const media = (): MediaQueryList | null =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(PREFERS_LIGHT_QUERY)
      : null;
  return {
    prefersLight: () => media()?.matches ?? false,
    onSchemeChange(listener) {
      const list = media();
      if (!list) return () => {};
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    setDocumentTheme: (id) => document.documentElement.setAttribute('data-theme', id),
    // daisyUI 5 colours are oklch(); resolveThemeRgb normalises to rgb(), which
    // every browser accepts in theme-color. base-200 is the <body> background.
    syncThemeColor: () =>
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', rgbToCss(resolveThemeRgb('--color-base-200'))),
    persist: (choice) => persistThemeChoice(choice),
  };
}

export interface UseThemeChoice extends ThemeChoiceState {
  readonly isPreviewing: boolean;
  select: (choice: ThemeChoice) => void;
  apply: () => void;
  revert: () => void;
}

/**
 * The theme, for the app modal — which is always mounted, so the OS listener
 * and the theme-color sync always run. Theme state never enters a zustand
 * slice (R346).
 */
export function useThemeChoice(): UseThemeChoice {
  const [store] = useState(() => createThemeChoiceStore(readThemeChoice(), browserThemeEnv()));
  useEffect(() => store.start(), [store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    ...state,
    isPreviewing: state.preview !== state.applied,
    select: store.select,
    apply: store.apply,
    revert: store.revert,
  };
}

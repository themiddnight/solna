import type { StoreApi } from 'zustand';
import type { KeyboardMode } from '../types';
import type { AppStore, UiSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

const KEYBOARD_MODE_STORAGE_KEY = 'solna_keyboard_mode';

const KNOWN_KEYBOARD_MODES: readonly KeyboardMode[] = ['chromatic', 'scale-locked', 'chord'];

function isKeyboardMode(value: string | null): value is KeyboardMode {
  return KNOWN_KEYBOARD_MODES.includes(value as KeyboardMode);
}

/**
 * Reads the persisted keyboard-mode choice, degrading to `null` (i.e. "no
 * stored preference, or garbage") if storage access throws or the stored
 * value isn't one of the three known modes. Mirrors `readStoredTheme` in
 * Header.tsx: `storage ?? localStorage` is resolved *inside* the try because
 * Safari private browsing, "block all cookies" and some embedded webviews
 * throw on the property access itself, not just on read failure.
 */
export function readStoredKeyboardMode(storage?: Pick<Storage, 'getItem'>): KeyboardMode | null {
  try {
    const s = storage ?? localStorage;
    const stored = s.getItem(KEYBOARD_MODE_STORAGE_KEY);
    return isKeyboardMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort persistence: swallows a throwing `setItem` so the in-memory
 * mode still updates for the session — only cross-session persistence is
 * lost when storage is blocked.
 */
export function persistKeyboardMode(mode: KeyboardMode, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(KEYBOARD_MODE_STORAGE_KEY, mode);
  } catch {
    // Blocked storage (private mode, cookies disabled, some webviews): the
    // session still works, it just won't remember the choice next visit.
  }
}

/**
 * UI slice: active tab + modal visibility + keyboard input mode. None of
 * this rides in the project persist blob (partializeAppState) — the active
 * tab lives in the URL query (?tab=...) instead, and the keyboard mode is
 * persisted separately to its own localStorage key (like the theme), since
 * an input mode has no business travelling with a saved/exported song.
 */
export function createUiSlice(set: Set): UiSlice {
  return {
    activeTab: 'synth',
    isProjectModalOpen: false,
    keyboardMode: readStoredKeyboardMode() ?? 'scale-locked',

    setActiveTab: (activeTab) => set({ activeTab }),
    openProjectsModal: () => set({ isProjectModalOpen: true }),
    closeProjectsModal: () => set({ isProjectModalOpen: false }),
    setKeyboardMode: (keyboardMode) => {
      persistKeyboardMode(keyboardMode);
      set({ keyboardMode });
    },
  };
}

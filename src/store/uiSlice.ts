import type { StoreApi } from 'zustand';
import type { KeyboardMode } from '../types';
import type { AppStore, UiSlice } from './types';
import { DEFAULT_MIDI_MAPPINGS } from './types';
import { readValidatedStorageValue, persistGuardedStorageValue } from '../utils/storage';

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
 * Header.tsx via the shared guarded-storage helpers.
 */
export function readStoredKeyboardMode(storage?: Pick<Storage, 'getItem'>): KeyboardMode | null {
  return readValidatedStorageValue(KEYBOARD_MODE_STORAGE_KEY, isKeyboardMode, storage);
}

/**
 * Best-effort persistence: swallows a throwing `setItem` so the in-memory
 * mode still updates for the session — only cross-session persistence is
 * lost when storage is blocked.
 */
export function persistKeyboardMode(mode: KeyboardMode, storage?: Pick<Storage, 'setItem'>): void {
  persistGuardedStorageValue(KEYBOARD_MODE_STORAGE_KEY, mode, storage);
}

/**
 * UI slice: active tab + keyboard input mode. Neither rides in the project
 * persist blob (partializeAppState) — the active tab lives in the URL query
 * (?tab=...) instead, and the keyboard mode is persisted separately to its
 * own localStorage key (like the theme), since an input mode has no business
 * travelling with a saved/exported song.
 */
export function createUiSlice(set: Set): UiSlice {
  return {
    activeTab: 'synth',
    keyboardMode: readStoredKeyboardMode() ?? 'scale-locked',
    midiActivityTimestamp: null,
    midiMappings: DEFAULT_MIDI_MAPPINGS,
    isMidiSettingsOpen: false,
    midiLearnTargetId: null,
    selectedMidiInputId: 'all',

    setActiveTab: (activeTab) => set({ activeTab }),
    setKeyboardMode: (keyboardMode) => {
      persistKeyboardMode(keyboardMode);
      set({ keyboardMode });
    },
    triggerMidiActivity: () => set({ midiActivityTimestamp: Date.now() }),
    setMidiMappings: (midiMappings) => set({ midiMappings }),
    updateMidiMapping: (id, updates) =>
      set((state) => ({
        midiMappings: state.midiMappings.map((m) => (m.id === id ? { ...m, ...updates } : m)),
      })),
    addMidiMapping: (mapping) =>
      set((state) => ({
        midiMappings: [...state.midiMappings, mapping],
      })),
    removeMidiMapping: (id) =>
      set((state) => ({
        midiMappings: state.midiMappings.filter((m) => m.id !== id),
      })),
    resetMidiMappings: () => set({ midiMappings: DEFAULT_MIDI_MAPPINGS }),
    setIsMidiSettingsOpen: (isMidiSettingsOpen) => set({ isMidiSettingsOpen }),
    setMidiLearnTargetId: (midiLearnTargetId) => set({ midiLearnTargetId }),
    setSelectedMidiInputId: (selectedMidiInputId) => set({ selectedMidiInputId }),
  };
}

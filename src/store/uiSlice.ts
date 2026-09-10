import type { StoreApi } from 'zustand';
import type { InputPanelMode, KeyboardMode } from '../types';
import type { AppStore, UiSlice } from './types';
import { DEFAULT_MIDI_MAPPINGS } from './types';
import { readValidatedStorageValue, persistGuardedStorageValue } from '../utils/storage';
import { toggleSolo } from './trackAudibility';

type Set = StoreApi<AppStore>['setState'];

const KEYBOARD_MODE_STORAGE_KEY = 'solna_keyboard_mode';

const FOLLOW_PLAYHEAD_STORAGE_KEY = 'solna_follow_playhead';

function isFollowFlag(value: string | null): value is 'on' | 'off' {
  return value === 'on' || value === 'off';
}

/**
 * Reads the persisted follow-playhead choice, degrading to `null` (no stored
 * preference, or garbage) exactly as `readStoredKeyboardMode` does. Stored as
 * `'on'`/`'off'` rather than `'true'`/`'false'` so a legacy or hand-edited
 * value can never be read as a boolean by accident.
 */
export function readStoredFollowPlayhead(storage?: Pick<Storage, 'getItem'>): boolean | null {
  const stored = readValidatedStorageValue(FOLLOW_PLAYHEAD_STORAGE_KEY, isFollowFlag, storage);
  return stored === null ? null : stored === 'on';
}

/** Best-effort persistence, same contract as {@link persistKeyboardMode}. */
export function persistFollowPlayhead(follow: boolean, storage?: Pick<Storage, 'setItem'>): void {
  persistGuardedStorageValue(FOLLOW_PLAYHEAD_STORAGE_KEY, follow ? 'on' : 'off', storage);
}

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
 *
 * `focusTrack` is the exception in this slice: it IS persisted, top-level,
 * in the place `controlTarget` used to occupy — which track you were working
 * on is a preference worth surviving a reload, and it is validated on read
 * (sanitizePersistedState) rather than carried through a migration chain. The
 * Pattern segment is no longer a field at all: it is `segmentForFocus(focus)`,
 * derived at each of the three surfaces that show it.
 */
export function createUiSlice(set: Set): UiSlice {
  return {
    activeTab: 'sound',
    focusTrack: 'synth',
    patternSegment: 'lead',
    soloTracks: [],
    keyboardMode: readStoredKeyboardMode() ?? 'scale-locked',
    followPlayhead: readStoredFollowPlayhead() ?? true,
    midiActivityTimestamp: null,
    midiMappings: DEFAULT_MIDI_MAPPINGS,
    isMidiSettingsOpen: false,
    isProjectManagerOpen: false,
    isInputPanelOpen: false,
    inputPanelMode: 'keyboard',
    midiLearnTargetId: null,
    selectedMidiInputId: 'all',

    setActiveTab: (activeTab) => set({ activeTab }),
    setFocusTrack: (focusTrack) => set({ focusTrack }),
    setPatternSegment: (patternSegment) => set({ patternSegment }),
    toggleSoloTrack: (track) =>
      set((state) => ({ soloTracks: toggleSolo(state.soloTracks, track) })),
    // Guarded on emptiness so the array reference is stable: a fresh [] would
    // hand every `soloTracks` subscriber a new reference for a value that did
    // not change. It does NOT make the call free — zustand treats a `{}`
    // partial as a state change and still notifies everyone and re-serialises
    // the persisted slice — which is why startSoloNavClear tests emptiness on
    // its side too, before calling at all.
    clearSoloTracks: () =>
      set((state) => (state.soloTracks.length === 0 ? {} : { soloTracks: [] })),
    // One writer, not two. A `setFollowPlayhead(boolean)` sat beside this with
    // no caller but its own test, which is indistinguishable from a live action
    // at review time — and it meant one preference had two write-through paths
    // to keep in step. The toggle is the only entry point the UI offers.
    toggleFollowPlayhead: () =>
      set((state) => {
        const followPlayhead = !state.followPlayhead;
        persistFollowPlayhead(followPlayhead);
        return { followPlayhead };
      }),
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
    setIsProjectManagerOpen: (isProjectManagerOpen) => set({ isProjectManagerOpen }),
    setMidiLearnTargetId: (midiLearnTargetId) => set({ midiLearnTargetId }),
    setIsInputPanelOpen: (isInputPanelOpen) => set({ isInputPanelOpen }),
    setInputPanelMode: (inputPanelMode: InputPanelMode) => set({ inputPanelMode }),
    setSelectedMidiInputId: (selectedMidiInputId) => set({ selectedMidiInputId }),
  };
}

import type { StoreApi } from 'zustand';
import { INITIAL_CHORDS } from './initialState';
import { deriveChordNotes } from '../utils/musicTheory';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import type { AppStore, ChordsSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Chords slice. `setChordOctave` derives the new chord notes INSIDE the same
 * `set()` call (replacing the old App.tsx effect that mapped the chords
 * afterwards), so the octave and the notes can never be observed out of sync.
 */
export function createChordsSlice(set: Set): ChordsSlice {
  return {
    // The old App derived the chord notes on mount (useEffect on chordOctave),
    // so the initial chords displayed at octave 4 — keep that exact value.
    chords: INITIAL_CHORDS.map((chord) => deriveChordNotes(chord, 4)),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    chordFeel: 0.5,
    chordOctave: 4,
    chordMuted: false,
    chordVolume: 1.0,

    setChords: (chords) => set({ chords }),
    setChordRhythmId: (chordRhythmId) => set({ chordRhythmId }),
    setChordRhythmMode: (chordRhythmMode) => set({ chordRhythmMode }),
    // Stored at a fixed MAX width (non-destructive, drum-row style): the UI
    // toggles one step of the already-wide array, so no per-edit normalization
    // is needed and setMeter never rewrites it.
    setCustomChordRhythm: (customChordRhythm) => set({ customChordRhythm }),
    setChordFeel: (chordFeel) => set({ chordFeel }),
    setChordVolume: (chordVolume) => set({ chordVolume }),
    toggleChordMuted: () => set((state) => ({ chordMuted: !state.chordMuted })),

    setChordOctave: (chordOctave) =>
      set((state) => ({
        chordOctave,
        chords: state.chords.map((chord) => deriveChordNotes(chord, chordOctave)),
      })),
  };
}

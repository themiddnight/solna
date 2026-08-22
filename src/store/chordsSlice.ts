import type { StoreApi } from 'zustand';
import { INITIAL_CHORDS } from './initialState';
import { deriveChordNotes } from '../utils/musicTheory';
import type { AppStore, ChordsSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Chords slice. `setChordOctave` derives the new chord notes INSIDE the same
 * `set()` call (replacing the old App.tsx effect that mapped the chords
 * afterwards), so the octave and the notes can never be observed out of sync.
 */
export function createChordsSlice(set: Set, _get: Get): ChordsSlice {
  return {
    chords: INITIAL_CHORDS,
    chordRhythmId: 'sustained',
    chordFeel: 0.5,
    chordOctave: 4,
    chordMuted: false,
    chordVolume: 1.0,

    setChordOctave: (chordOctave) =>
      set((state) => ({
        chordOctave,
        chords: state.chords.map((chord) => deriveChordNotes(chord, chordOctave)),
      })),
  };
}

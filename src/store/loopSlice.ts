import type { StoreApi } from 'zustand';
import { BASS_PATTERNS, type BassStepChoice } from '../audio/bassPatterns';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import { deriveChordNotes } from '../utils/musicTheory';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { INITIAL_CHORDS, INITIAL_SEQUENCER_TRACKS, INITIAL_SYNTH_PARAMS } from './initialState';
import { cloneLoop, fallbackActiveLoopId, newLoopId, nextLoopName } from './loop';
import type { AppStore, Loop, LoopSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export const DEFAULT_LOOP_ID = 'loop-default-1';

/** The loop every fresh project starts with — matches the store's flat defaults. */
export function createDefaultLoop(): Loop {
  return {
    id: DEFAULT_LOOP_ID,
    name: 'Loop 1',
    repeatCount: 1,
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: { ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params },
    chords: INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    chordFeel: 0.5,
    chordOctave: 4,
    bassPatternId: BASS_PATTERNS[0].id,
    bassPatternMode: 'preset',
    customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
    bassFeel: 0.5,
    bassOctave: 2,
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]),
    leadLoopLength: 1,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,
    sequencerTracks: INITIAL_SEQUENCER_TRACKS.map((t) => ({ ...t, steps: [...t.steps] })),
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 0.7,
    drumFilterType: 'lowpass',
    synthVolume: 1.0,
    synthMuted: false,
    chordVolume: 1.0,
    chordMuted: false,
    bassVolume: 1.0,
    bassMuted: false,
    masterSequencerVolume: 0.8,
    drumMuted: false,
  };
}

export function createLoopSlice(set: Set, get: Get): LoopSlice {
  return {
    loops: [createDefaultLoop()],
    activeLoopId: DEFAULT_LOOP_ID,

    // A new loop is a copy of the active loop (default), appended. Content
    // is identical to what the flat slices already hold, so no loadLoop call
    // is needed — only the cursor moves.
    addLoop: () => {
      const state = get();
      const source =
        state.loops.find((r) => r.id === state.activeLoopId) ?? state.loops[0];
      const loop: Loop = {
        ...cloneLoop(source),
        id: newLoopId(),
        name: nextLoopName(state.loops),
      };
      set({ loops: [...state.loops, loop], activeLoopId: loop.id });
      return loop.id;
    },

    // Deep clone inserted immediately after the original. When the clone is
    // auto-activated (original was active) the content matches the flat slices,
    // so no loadLoop is needed; otherwise the caller must load the clone.
    duplicateLoop: (id) => {
      const state = get();
      const index = state.loops.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const clone: Loop = {
        ...cloneLoop(state.loops[index]),
        id: newLoopId(),
        name: nextLoopName(state.loops),
      };
      const cloneActive = id === state.activeLoopId;
      const loops = [
        ...state.loops.slice(0, index + 1),
        clone,
        ...state.loops.slice(index + 1),
      ];
      set(cloneActive ? { loops, activeLoopId: clone.id } : { loops });
      return cloneActive ? null : clone.id;
    },

    // A project always has ≥ 1 loop. Deleting the active loop returns the
    // fallback id so the caller can loadLoop it.
    deleteLoop: (id) => {
      const state = get();
      if (state.loops.length <= 1) return null;
      const index = state.loops.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const wasActive = id === state.activeLoopId;
      const loops = state.loops.filter((r) => r.id !== id);
      // Song mode: the cursor must track the ACTIVE loop's index in the NEW
      // list, so a delete (of the active loop or a neighbour) can't leave it
      // pointing at the wrong loop or out of range (which would freeze the
      // song advance). Loop mode keeps the null cursor.
      const cursor = (activeId: string) =>
        state.songLoopIndex !== null
          ? Math.max(0, loops.findIndex((r) => r.id === activeId))
          : null;
      if (!wasActive) {
        set({ loops, songLoopIndex: cursor(state.activeLoopId) });
        return null;
      }
      const fallback = fallbackActiveLoopId(state.loops, id) ?? loops[0].id;
      set({ loops, activeLoopId: fallback, songLoopIndex: cursor(fallback) });
      return fallback;
    },

    reorderLoops: (id, direction) =>
      set((state) => {
        const index = state.loops.findIndex((r) => r.id === id);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= state.loops.length) return {};
        const loops = [...state.loops];
        const [moved] = loops.splice(index, 1);
        loops.splice(target, 0, moved);
        return {
          loops,
          // activeLoopId is unchanged by a reorder; only its list index
          // shifts, so re-derive the song cursor onto its new position (kept
          // null in loop mode).
          songLoopIndex:
            state.songLoopIndex !== null
              ? Math.max(0, loops.findIndex((r) => r.id === state.activeLoopId))
              : null,
        };
      }),

    reorderLoopsArray: (loops) =>
      set((state) => ({
        loops,
        songLoopIndex:
          state.songLoopIndex !== null
            ? Math.max(0, loops.findIndex((r) => r.id === state.activeLoopId))
            : null,
      })),

    setLoopName: (id, name) =>
      set((state) => ({
        loops: state.loops.map((r) => (r.id === id ? { ...r, name } : r)),
      })),

    setLoopRepeatCount: (id, repeatCount) =>
      set((state) => ({
        loops: state.loops.map((r) =>
          r.id === id ? { ...r, repeatCount: Math.max(1, Math.min(32, Math.round(repeatCount))) } : r
        ),
      })),

    setLoopMix: (id, patch) =>
      set((state) => {
        const loops = state.loops.map((r) => (r.id === id ? { ...r, ...patch } : r));
        // Mirror onto the flat slices only when the edited loop is the active
        // (sounding) one, so the engine follows live (engineSync reads the flat
        // fields) and loopSync writes the same values back idempotently. A
        // non-active loop is edited for later use only.
        if (id !== state.activeLoopId) return { loops };
        return { loops, ...patch };
      }),

    setActiveLoop: (id) => set({ activeLoopId: id }),
  };
}

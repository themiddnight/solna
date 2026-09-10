import type { StoreApi } from 'zustand';
import { BASS_PATTERNS, type BassStepChoice } from '@/data/bassPatterns';
import { deriveChordNotes } from '../utils/musicTheory';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import {
  defaultFxState,
  defaultPadState,
  INITIAL_BASS_SYNTH_PARAMS,
  INITIAL_CHORDS,
  INITIAL_SEQUENCER_TRACKS,
  INITIAL_SYNTH_PARAMS,
} from './initialState';
import { cloneLoop, fallbackActiveLoopId, newLoopId, nextDuplicateLabel, nextUntitledName } from './loop';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import { rescopeToLoop, scopedLoopId, SCOPE_NONE } from './playbackScope';
import { stopAllPlayersPatch } from './transportSlice';
import type { AppStore, Loop, LoopSlice } from './types';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';
import { DEFAULT_LEAD_STEP_RESOLUTION, LEAD_TICKS_PER_BAR } from '../utils/stepResolution';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export const DEFAULT_LOOP_ID = 'loop-default-1';

/** The loop every fresh project starts with — matches the store's flat defaults. */
export function createDefaultLoop(): Loop {
  return {
    id: DEFAULT_LOOP_ID,
    name: '',
    tempName: 'untitled-1',
    repeatCount: 1,
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: INITIAL_BASS_SYNTH_PARAMS,
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
    ...defaultPadState(),
    ...defaultFxState(),
    leadMelodySteps: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
    leadLoopLength: 1,
    leadStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,
    leadGate: DEFAULT_LEAD_GATE,
    sequencerTracks: INITIAL_SEQUENCER_TRACKS.map((t) => ({ ...t, steps: [...t.steps] })),
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 0.7,
    drumFilterType: 'lowpass',
    // Decibels from here down: unity is 0 dB. The old 0.8 drum-bus default
    // was a -1.9 dB trim nobody chose; DEV-383 sets a measured one
    // (DEFAULT_BUS_TRIM_DB — see its comment in levelUnits.ts for the
    // measurement) on every source bus except padVolume, which comes through
    // defaultPadState() below instead.
    synthVolume: DEFAULT_BUS_TRIM_DB,
    synthMuted: false,
    chordVolume: DEFAULT_BUS_TRIM_DB,
    chordMuted: false,
    bassVolume: DEFAULT_BUS_TRIM_DB,
    bassMuted: false,
    masterSequencerVolume: DEFAULT_BUS_TRIM_DB,
    drumMuted: false,
  };
}

export function createLoopSlice(set: Set, get: Get): Omit<LoopSlice, 'applyLoopCopy'> {
  return {
    loops: [createDefaultLoop()],
    activeLoopId: DEFAULT_LOOP_ID,

    // A new loop is a copy of the active loop (default), appended. Content
    // is identical to what the flat slices already hold, so no loadLoop call
    // is needed — the cursor and the scope move, nothing else.
    addLoop: () => {
      const state = get();
      const source =
        state.loops.find((r) => r.id === state.activeLoopId) ?? state.loops[0];
      const loop: Loop = {
        ...cloneLoop(source),
        id: newLoopId(),
        // Add is a fresh slot: no name, and a number of its own.
        name: '',
        tempName: nextUntitledName(state.loops),
      };
      // The scope moves with the cursor: the new loop is a copy of the active
      // one, so the audio is unchanged and must keep playing — but under an id
      // that names the loop now in focus. Left behind, the scope would point
      // at the old loop and the master Play would render enabled and do
      // nothing (soloLoop early-returns on an unchanged scope reference).
      // rescopeToLoop leaves `song` and `none` alone.
      set({
        loops: [...state.loops, loop],
        activeLoopId: loop.id,
        playbackScope: rescopeToLoop(state.playbackScope, loop.id),
      });
      return loop.id;
    },

    // Deep clone inserted immediately after the original. When the clone is
    // auto-activated (original was active) the content matches the flat slices,
    // so no loadLoop is needed; otherwise the caller must load the clone.
    duplicateLoop: (id) => {
      const state = get();
      const index = state.loops.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const source = state.loops[index];
      const clone: Loop = {
        ...cloneLoop(source),
        id: newLoopId(),
        // Derived, not fresh: the label increments the one on screen.
        ...nextDuplicateLabel(state.loops, source),
      };
      const cloneActive = id === state.activeLoopId;
      const loops = [
        ...state.loops.slice(0, index + 1),
        clone,
        ...state.loops.slice(index + 1),
      ];
      // Same rule as addLoop: only the auto-activated branch moves the cursor,
      // so only it moves the scope.
      set(
        cloneActive
          ? {
              loops,
              activeLoopId: clone.id,
              playbackScope: rescopeToLoop(state.playbackScope, clone.id),
            }
          : { loops },
      );
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
      // Deleting the loop that is sounding stops playback: after this the
      // loop that was sounding is not the loop in focus, because it is not
      // anywhere. Folded into the same set() as the removal so no subscriber
      // ever sees a scope naming a loop that `loops` no longer contains — the
      // one scope value focus-loop cannot heal, since it would compare the
      // focused id against a ghost. A `song` scope is deliberately untouched:
      // an arrangement one slot shorter is still an arrangement, which is why
      // the cursor below is re-derived rather than dropped.
      const stopPatch =
        scopedLoopId(state.playbackScope) === id
          ? { playbackScope: SCOPE_NONE, ...stopAllPlayersPatch(state) }
          : {};
      // Song mode: the cursor must track the ACTIVE loop's index in the NEW
      // list, so a delete (of the active loop or a neighbour) can't leave it
      // pointing at the wrong loop or out of range (which would freeze the
      // song advance). Loop mode keeps the null cursor.
      const cursor = (activeId: string) =>
        state.songLoopIndex !== null
          ? Math.max(0, loops.findIndex((r) => r.id === activeId))
          : null;
      if (!wasActive) {
        set({ loops, songLoopIndex: cursor(state.activeLoopId), ...stopPatch });
        return null;
      }
      const fallback = fallbackActiveLoopId(state.loops, id) ?? loops[0].id;
      set({
        loops,
        activeLoopId: fallback,
        songLoopIndex: cursor(fallback),
        ...stopPatch,
      });
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

    setLoopTempName: (id, tempName) => {
      // tempName's own contract (types.ts) is "the app's label, never empty",
      // and loopLabel's `name || tempName` has no third tier to fall back to —
      // sanitizeLoops enforces this on load, but this is a live setter, so it
      // must enforce it here too. A blank/whitespace call is a no-op rather
      // than writing '' and letting the label go blank at every render site
      // that consolidated onto loopLabel specifically to avoid that.
      const trimmed = tempName.trim();
      if (!trimmed) return;
      set((state) => ({
        loops: state.loops.map((r) => (r.id === id ? { ...r, tempName: trimmed } : r)),
      }));
    },

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

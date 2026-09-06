import type { StoreApi } from 'zustand';
import { defaultPadState } from './initialState';
import { normalizePadIntervals } from './sanitize';
import type { AppStore, PadSlice } from './types';
import type { PadInterval } from '../types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Pad/drone module slice: a full synth voice plus the two modes' controls.
 *
 * `padVoicing` is dormant in drone mode and `padDroneDegree`/`padDroneIntervals`
 * are dormant in pad mode — both are still persisted, so switching modes back
 * and forth never loses a setting.
 */
export function createPadSlice(set: Set): PadSlice {
  return {
    ...defaultPadState(),

    setPadSynthParams: (padSynthParams) => set({ padSynthParams }),
    setPadMode: (padMode) => set({ padMode }),
    setPadOctave: (padOctave) => set({ padOctave }),
    setPadVoicing: (padVoicing) => set({ padVoicing }),
    setPadDroneDegree: (padDroneDegree) => set({ padDroneDegree }),
    setPadVolume: (padVolume) => set({ padVolume }),
    togglePadMuted: () => set((state) => ({ padMuted: !state.padMuted })),

    // Both write through sanitize's normalizePadIntervals — see the rationale
    // there; a selection edited here and one read back from disk must be the
    // same array.
    setPadDroneIntervals: (intervals) =>
      set({ padDroneIntervals: normalizePadIntervals(intervals) }),

    togglePadDroneInterval: (interval: PadInterval) =>
      set((state) => {
        const next = state.padDroneIntervals.includes(interval)
          ? state.padDroneIntervals.filter((i) => i !== interval)
          : [...state.padDroneIntervals, interval];
        return { padDroneIntervals: normalizePadIntervals(next) };
      }),
  };
}

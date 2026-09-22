import type { StoreApi } from 'zustand';
import { clampSendLevels } from '@/audio/sourceSends';
import type { TrackSendLevels, TrackSends } from '@/types';
import type { LoopContent } from './loop';
import type { SourceBusId } from './sourceBuses';
import type { AppStore } from './types';

type Set = StoreApi<AppStore>['setState'];

export interface TrackSendsSlice {
  /** Per-loop: the loop mirror carries it into `loops[active]` (LOOP_FLAT_KEYS). */
  trackSends: TrackSends;
  /** Replace one track's three levels (clamped 0..1). Writes only that track's row. */
  setTrackSends: (source: SourceBusId, sends: TrackSendLevels) => void;
}

/**
 * The per-track master sends (DEV-423). A new outer object and a new row per
 * write, so the other five rows keep their references (R210) and each
 * engineSync subscription fires only for the row that moved. Written once per
 * knob gesture, on release (`useTrackSendsDraft`), never mid-drag (R016).
 */
export function createTrackSendsSlice(set: Set, defaults: LoopContent): TrackSendsSlice {
  return {
    trackSends: defaults.trackSends,
    setTrackSends: (source, sends) =>
      set((state) => ({ trackSends: { ...state.trackSends, [source]: clampSendLevels(sends) } })),
  };
}

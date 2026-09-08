import React from 'react';
import type { PatternSegment, ViewMode } from '@/types';
import { useAppStore } from './store';
import type { AppStore } from './types';

/**
 * The navigation axes that empty the track-solo set (spec §4: "changing tab,
 * Pattern segment, layer, or active loop").
 *
 * Three fields, not four: the LAYER is derived from the tab (`layerForTab` in
 * src/types.ts), so a layer change is always a tab change and needs no entry of
 * its own.
 *
 * ONE subscription over these fields, rather than a clear inside each writer.
 * activeLoopId alone has six writers today (loadLoop's two setState calls,
 * addLoop, duplicateLoop, deleteLoop, setActiveLoop) plus applyProjectContent's
 * open patch, and song advance reaches it through loadLoop; a per-writer clear
 * would have to be remembered by every one of those and by every writer added
 * later, and a missed one is silent — the solo just keeps silencing tracks.
 * Watching the field covers every writer that exists and every writer that will
 * exist. The only remaining way to forget is to add a NEW navigation axis, and
 * soloNav.test.ts asserts this list exhaustively so that has to be a decision.
 *
 * A song advance therefore clears the set mid-song. That is correct: it is
 * already empty (reaching the Song layer was a tab change), and a solo that
 * survived a loop boundary would be silencing tracks in a loop nobody soloed
 * anything in.
 */
export const SOLO_NAV_KEYS = ['activeTab', 'patternSegment', 'activeLoopId'] as const;

export interface SoloNavSignature {
  activeTab: ViewMode;
  patternSegment: PatternSegment;
  activeLoopId: string;
}

export function soloNavSignature(state: AppStore): SoloNavSignature {
  return {
    activeTab: state.activeTab,
    patternSegment: state.patternSegment,
    activeLoopId: state.activeLoopId,
  };
}

/**
 * Field-by-field rather than `shallow`, for the same reason songMode's own
 * equalityFn is hand-written: the selector allocates a fresh object on every
 * set(), and subscribeWithSelector runs it on every set(), so this comparison
 * is on the hot path and stays three `===` checks.
 */
export function soloNavUnchanged(a: SoloNavSignature, b: SoloNavSignature): boolean {
  return (
    a.activeTab === b.activeTab &&
    a.patternSegment === b.patternSegment &&
    a.activeLoopId === b.activeLoopId
  );
}

/**
 * Starts the clear. Returns the unsubscribe, mirroring startSongModeSync.
 *
 * The listener runs synchronously inside the navigating set()'s own
 * notification pass, so there is no frame in which the stale solo is audible.
 * clearSoloTracks is reference-stable on an already-empty set, so a navigation
 * with no solo latched notifies nothing further.
 */
export function startSoloNavClear(): () => void {
  return useAppStore.subscribe(
    soloNavSignature,
    () => useAppStore.getState().clearSoloTracks(),
    { equalityFn: soloNavUnchanged },
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useSoloNavClear(): void {
  React.useEffect(() => startSoloNavClear(), []);
}

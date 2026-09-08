import React from 'react';
import { useAppStore } from './store';
import { layerForTab } from '../types';
import type { AppStore } from './types';

/**
 * The navigation axes that empty the track-solo set: a change of LAYER (Loop
 * ↔ Song, derived from the tab via `layerForTab`) and a change of active loop.
 *
 * Neither the raw `activeTab` nor `patternSegment` is watched any more.
 * Moving between Sound and Pattern, or between Pattern's segments, stays
 * WITHIN the Loop layer and must not clear the set — see below for why. Only
 * leaving the layer (Loop → Song), swapping the active loop, or swapping the
 * whole project's content clears it.
 *
 * WHY staying inside the Loop layer must not clear: solo is a set, not a
 * radio (spec §4), specifically so "write a lead over just the drums" is
 * expressible as two simultaneous solos. But Drums' solo button lives in the
 * Beat segment of Pattern and Lead's lives on Sound (and in Pattern's Lead
 * segment) — so building that two-track set requires either a tab change or a
 * segment change between the two clicks. Clearing on either one made the
 * workflow the spec calls load-bearing impossible to actually perform: the
 * first solo was always wiped before the second could be added. Watching the
 * LAYER instead of the tab keeps both of those navigations free while still
 * clearing the moment the user leaves the loop being edited — a solo built
 * for one loop must never silence tracks in another loop or in the song.
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
 * already empty (reaching the Song layer was a layer change), and a solo that
 * survived a loop boundary would be silencing tracks in a loop nobody soloed
 * anything in.
 *
 * Changing the Sound view's control target does NOT clear the solo set,
 * deliberately, and that is now MORE consistent than before rather than a
 * special case: a control-target change and a Pattern-segment change are both
 * within-Loop-layer navigations, and neither one clears. With one solo button
 * on Sound following the active target, clearing on a target change would
 * make a two-track solo set unbuildable on that surface — each new solo would
 * erase the last — which would silently delete the "write a lead over just the
 * drums" workflow the spec calls load-bearing. The transport bar's
 * `SOLO · … ×` chip is what keeps a solo set on another target visible.
 */
const SOLO_NAV_SOURCES = {
  layer: (state: AppStore) => layerForTab(state.activeTab),
  activeLoopId: (state: AppStore) => state.activeLoopId,
};

/**
 * Derived from `SOLO_NAV_SOURCES`, not hand-declared, so the constant and the
 * table cannot drift apart: adding a key to the table changes what this list
 * (and, below, what `soloNavSignature` actually reads) covers automatically.
 */
export const SOLO_NAV_KEYS = Object.keys(SOLO_NAV_SOURCES) as (keyof typeof SOLO_NAV_SOURCES)[];

/**
 * Also derived from `SOLO_NAV_SOURCES`: a mapped type over its keys, rather
 * than a `Pick<AppStore, ...>`, because the watched values are no longer a
 * plain projection of store fields — `layer` is computed from `activeTab`,
 * not a field on `AppStore` at all.
 */
export type SoloNavSignature = {
  [K in keyof typeof SOLO_NAV_SOURCES]: ReturnType<(typeof SOLO_NAV_SOURCES)[K]>;
};

/**
 * Built by iterating `SOLO_NAV_KEYS` and calling each key's source function —
 * see the type above for why a hand-listed `Pick` no longer fits.
 */
export function soloNavSignature(state: AppStore): SoloNavSignature {
  return Object.fromEntries(
    SOLO_NAV_KEYS.map((key) => [key, SOLO_NAV_SOURCES[key](state)]),
  ) as SoloNavSignature;
}

/**
 * Also driven by `SOLO_NAV_KEYS`, for the same reason: `shallow` would work
 * here too, but hand-listing the watched fields a second time is exactly the
 * kind of duplicate the table exists to prevent.
 */
export function soloNavUnchanged(a: SoloNavSignature, b: SoloNavSignature): boolean {
  return SOLO_NAV_KEYS.every((key) => a[key] === b[key]);
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

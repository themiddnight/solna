import React from 'react';
import { useAppStore } from './store';
import { layerForTab } from '../types';
import type { AppStore } from './types';

/**
 * The navigation axes that empty the track-solo set: a change of LAYER (Loop
 * ↔ Song, derived from the tab via `layerForTab`), a change of Pattern
 * segment, and a change of active loop.
 *
 * The raw `activeTab` is no longer watched — `layer` replaces it, so moving
 * between Sound and Pattern no longer clears the set. `patternSegment` is
 * still watched exactly as before: a segment change still clears.
 *
 * WHY Sound ↔ Pattern must not clear, but a segment change still must: Sound
 * and Pattern are the two halves of editing ONE loop — its sound and its
 * notes — and a user crosses between them constantly while working on that
 * loop, adjusting the synth and then the pattern and back. A solo set that
 * survives that crossing is the working state; having to re-toggle it on
 * every tab switch was the friction this change removes. A Pattern-segment
 * change is a different kind of navigation: Lead, Accompaniment and Beat are
 * different THINGS being edited within Pattern, not two views onto the same
 * edit, so moving between them is a change of subject and still clears —
 * consistent with why a layer change clears, one level up.
 *
 * Consequence, on the record: because the Sound ↔ Pattern hop survives, a set
 * spanning Drums and the melodic tracks IS buildable — solo Drums in Beat,
 * hop to Sound, then add lead/chord/bass/pad one at a time via the control
 * target (a target change doesn't clear either). What still empties the set
 * is moving between Pattern's segments, leaving the Loop layer, changing the
 * active loop, or swapping the project.
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
 * deliberately: the Sound view has one solo button that follows the active
 * target, and it must be able to build a set across targets — clearing on a
 * target change would make a two-track solo set unbuildable on that surface,
 * since each new solo would erase the last. The transport bar's
 * `SOLO · … ×` chip is what keeps a solo set on another target visible.
 */
const SOLO_NAV_SOURCES = {
  layer: (state: AppStore) => layerForTab(state.activeTab),
  patternSegment: (state: AppStore) => state.patternSegment,
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
 * than a `Pick<AppStore, ...>`, because one watched value is no longer a
 * plain projection of a store field — `layer` is computed from `activeTab`,
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

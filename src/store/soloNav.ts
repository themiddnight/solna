import React from 'react';
import { shallow } from 'zustand/shallow';
import { useAppStore } from './store';
import { layerForTab } from '../types';
import type { AppStore } from './types';

/**
 * The navigation axes that empty the track-solo set: a change of LAYER (Loop
 * ↔ Song, derived from the tab via `layerForTab`) and a change of active loop.
 * A project swap clears it too, in projectSlice's own atomic patch — loop ids
 * are not unique across projects, so `activeLoopId` cannot catch that one.
 *
 * The raw `activeTab` is not watched — `layer` replaces it, so moving between
 * Sound and Pattern does not clear the set.
 *
 * WHY THE PATTERN-SEGMENT AXIS WENT AWAY. This table used to watch
 * `patternSegment` as well, and this docblock used to argue two things at
 * once: that a segment change is a change of SUBJECT and must clear, and that
 * a Sound-view target change must NOT clear, because the Sound view has one
 * solo button following the target and clearing on a target change would make
 * a two-track set unbuildable on that surface. With `focusTrack` those are the
 * same event. Keeping the clear would make a multi-track set unbuildable
 * everywhere, which is the failure the second argument existed to prevent —
 * and the second argument is the stronger one, because solo is a monitoring
 * gesture whose entire purpose is comparing tracks. A focus change therefore
 * never clears the set. soloNav.test.ts asserts that directly, so restoring
 * the clear has to be a decision.
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
 * The view header's `SOLO · … ×` chip (components/ui/SoloChip.tsx) is what
 * keeps a solo set on another track visible — it rides the shared HeaderCard
 * rather than one view, so it survives every hop the set itself survives.
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
 *
 * A plain loop rather than `Object.fromEntries(SOLO_NAV_KEYS.map(...))`: this
 * runs on EVERY store `set()`, since the subscription below is mounted at the
 * app root for the life of the session. The map form allocated one array plus
 * a two-element tuple per key on every knob tick and every clock-driven write,
 * for an object of three strings. The loop keeps the same derived-from-the-
 * table property with one allocation.
 */
export function soloNavSignature(state: AppStore): SoloNavSignature {
  // The accumulator is widened and cast once at the end, exactly as the
  // `Object.fromEntries` form was: writing through a union of mapped-type keys
  // narrows the value slot to `never`, and the alternative — an object literal
  // naming the three fields — is the drift this table exists to prevent.
  const signature: Record<string, unknown> = {};
  for (const key of SOLO_NAV_KEYS) {
    signature[key] = SOLO_NAV_SOURCES[key](state);
  }
  return signature as SoloNavSignature;
}

/**
 * Starts the clear. Returns the unsubscribe, mirroring startSongModeSync.
 *
 * The listener runs synchronously inside the navigating set()'s own
 * notification pass, so there is no frame in which the stale solo is audible.
 *
 * The emptiness test is HERE and not only inside clearSoloTracks, because the
 * action's own guard returns `{}` and zustand still treats that as a state
 * change: it builds a new state object, runs every listener, and — through
 * persist, which wraps the slice `set` — re-runs partialize and JSON.stringify
 * over the whole persisted slice including `loops[]`. Nothing is soloed on the
 * overwhelming majority of navigations, so calling unconditionally doubled the
 * notification and serialise cost of every tab, segment and loop change to
 * write a value that was already correct.
 *
 * With this test in front of it, the guard inside `clearSoloTracks` no longer
 * stops anything on this path — the nested hop soloNav.test.ts's "never
 * watches soloTracks itself" docblock describes would now terminate HERE, on
 * the second pass reading an empty set. It stays in the action anyway, as
 * reference stability for any caller that does not test first; its only other
 * caller today is the transport chip, which renders only while the set is
 * non-empty.
 */
export function startSoloNavClear(): () => void {
  return useAppStore.subscribe(
    soloNavSignature,
    () => {
      const state = useAppStore.getState();
      if (state.soloTracks.length > 0) state.clearSoloTracks();
    },
    // zustand's own `shallow`, not a hand-written comparison: it compares the
    // keys the selector actually returned, so it stays bound to
    // SOLO_NAV_SOURCES without naming a single field.
    { equalityFn: shallow },
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useSoloNavClear(): void {
  React.useEffect(() => startSoloNavClear(), []);
}

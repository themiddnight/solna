import React from 'react';
import { shallow } from 'zustand/shallow';
import { useAppStore } from './store';
import type { AppStore } from './types';
import { createNavSignature } from './navSignature';

/**
 * The "Auto-Reharmonized" badge describes the ACTIVE loop's chords. When the
 * active loop changes (select, song advance, delete fallback, undo) or a
 * project is installed (loop ids collide across projects, so activeLoopId
 * alone cannot catch it), the chords on screen were replaced wholesale, not
 * harmonized — the badge clears. One subscription for every writer, the
 * soloNav.ts pattern. It replaces the chord view's old key-delta rule
 * (shouldClearReharmonizeIndicator), which needed a key delta only because an
 * effect could not see who replaced the chords.
 */
const REHARMONIZE_NAV_SOURCES = {
  activeLoopId: (state: AppStore) => state.activeLoopId,
  projectInstallCount: (state: AppStore) => state.projectInstallCount,
};

const { signature } = createNavSignature(REHARMONIZE_NAV_SOURCES);

export function startReharmonizeNavClear(): () => void {
  return useAppStore.subscribe(
    signature,
    () => {
      // Tested first: an unconditional write would re-serialise persist on
      // every loop change for a value that is almost always already false.
      if (useAppStore.getState().reharmonizedIndicator) {
        useAppStore.getState().setReharmonizedIndicator(false);
      }
    },
    { equalityFn: shallow },
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useReharmonizeNavClear(): void {
  React.useEffect(() => startReharmonizeNavClear(), []);
}

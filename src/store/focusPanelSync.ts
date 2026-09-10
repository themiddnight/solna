import React from 'react';
import { useAppStore } from './store';
import { type MixLayerId } from './focusTrack';
import type { InputPanelMode } from '../types';

/**
 * Which input-deck panel a focus wants. The melodic keyboard has nothing to
 * play on a drum focus, so leaving the user looking at it would be exactly the
 * invisible-state failure the focus track exists to remove.
 */
export function panelModeForFocus(focus: MixLayerId): InputPanelMode {
  return focus === 'drum' ? 'drums' : 'keyboard';
}

/**
 * One subscription on `focusTrack`, mirroring startSoloNavClear: the panel
 * follows focus wherever focus is written from, rather than each of the six
 * writers of `setFocusTrack` remembering to switch it. A per-writer switch is
 * one more thing every future writer has to know.
 *
 * It watches FOCUS and never the panel, which is what keeps the tabs
 * clickable: a manual panel change writes `inputPanelMode` and this listener
 * does not run. A user who wants the drum grid focused while auditioning
 * melodic notes switches the panel back and stays there until focus moves
 * again (spec, Open risks 2).
 *
 * The equality guard is here and not only in the action: zustand treats every
 * `set()` as a state change and re-runs partialize over the whole persisted
 * slice, and most focus changes leave the panel where it already was.
 *
 * `fireImmediately: true` runs the same check once at mount, against whatever
 * `focusTrack` a reload restored. `focusTrack` is persisted and
 * `inputPanelMode` is not, so without this a reload that left focus on `drum`
 * boots with the dock showing the melodic Keyboard until focus changes again —
 * the exact disagreement this sync exists to remove, reached with no user
 * action at all. It does not fight a manual panel choice: the immediate fire
 * happens once at mount, before the user can have made one.
 */
export function startFocusPanelSync(): () => void {
  return useAppStore.subscribe(
    (state) => state.focusTrack,
    (focusTrack) => {
      const wanted = panelModeForFocus(focusTrack);
      if (useAppStore.getState().inputPanelMode !== wanted) {
        useAppStore.getState().setInputPanelMode(wanted);
      }
    },
    { fireImmediately: true },
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useFocusPanelSync(): void {
  React.useEffect(() => startFocusPanelSync(), []);
}

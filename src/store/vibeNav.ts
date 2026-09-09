import React from 'react';
import { useAppStore } from './store';

/**
 * The vibe chip highlight means "the loop this vibe was applied to is in
 * focus", so it must clear the moment `activeLoopId` moves to any OTHER
 * loop — whoever the writer is. Mirrors soloNav.ts's design for the same
 * reason: `activeLoopId` has six writers today (loadLoop's two setState
 * calls, addLoop, duplicateLoop, deleteLoop, setActiveLoop) plus
 * applyProjectContent's open patch and the song advance, which reaches it
 * through loadLoop. A clear hand-copied into every one of those writers has
 * to be remembered by each of them and by every writer added later, and a
 * missed one is silent — the chip just stays lit on a loop the vibe was
 * never applied to. That happened twice inside this feature's own review
 * history before this subscription replaced the inline copies. ONE
 * subscription over the field covers every writer that exists and every
 * writer that will exist.
 *
 * Unlike soloNav.ts there is exactly one axis here, so no signature object
 * and no `shallow` comparator are needed — the selector already IS the one
 * value being watched.
 *
 * A whole-project content swap (New / Open / Import) still clears
 * `selectedVibeId` directly inside `applyProjectContent`
 * (projectFormat.ts), not through this subscription — that patch also
 * replaces `loops[]` itself, and loop ids are not unique across projects
 * (every fresh project's default loop is `loop-default-1`), so a bare
 * `activeLoopId` comparison cannot be trusted to catch it on its own. The
 * subscription still fires on that patch (harmlessly — the value is already
 * being set to null), it just isn't what the guarantee rests on there.
 */
export function startVibeNavClear(): () => void {
  return useAppStore.subscribe(
    (state) => state.activeLoopId,
    () => {
      const state = useAppStore.getState();
      if (state.selectedVibeId !== null) state.setSelectedVibeId(null);
    },
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useVibeNavClear(): void {
  React.useEffect(() => startVibeNavClear(), []);
}

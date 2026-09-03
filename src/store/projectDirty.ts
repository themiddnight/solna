import { shallow } from 'zustand/shallow';
import { idleWriteScheduler, type WriteScheduler } from '../utils/coalescedStorage';
import { buildProjectContent, type ProjectContent } from './projectFormat';
import { fingerprintContent, isContentDirty } from './projectFingerprint';
import type { AppStore } from './types';

export interface DirtyTrackerApi {
  getState(): AppStore;
  setState(partial: Partial<AppStore>): void;
  subscribe<U>(
    selector: (state: AppStore) => U,
    listener: (next: U, prev: U) => void,
    options?: { equalityFn?: (a: U, b: U) => boolean },
  ): () => void;
}

export interface DirtyTracker {
  /**
   * Queue a pass on the next idle callback. Exported for the ONE caller the
   * content subscription cannot serve: the boot pass in store.ts (see below).
   */
  schedule(): void;
  /** Run the pending pass now (pagehide), cancelling the scheduled one. */
  runNow(): void;
  stop(): void;
}

type ContentRefs = [number, string, number, AppStore['effects'], AppStore['loops'], string | null, string | null];

/**
 * Owns the `dirty` boolean. MUST NOT run per set(): a knob drag is 60-120
 * set() calls a second, and fingerprinting the whole arrangement on each one
 * would serialise it hundreds of times per drag on the audio scheduler's
 * thread. So: a subscribeWithSelector subscription over the content keys (by
 * reference) marks a pass pending and schedules ONE idle callback through the
 * same scheduler coalescedStorage uses; many set()s in a window collapse to
 * one computation; `dirty` changes at most once per window. Once dirty, the
 * pass early-outs until a save / open / New clears it.
 *
 * The rule itself lives in isContentDirty (projectFingerprint.ts): a saved
 * project compares against its baseline, an untitled session against the
 * default project. The tracker NEVER seeds a baseline from what is on screen —
 * that made a migrated session look clean, so Import could silently replace
 * unsaved pre-upgrade work because the dirty guard never fired.
 *
 * The subscription alone cannot make a RELOADED session honest: persist
 * hydration is synchronous inside create(), so it has already run by the time
 * this tracker exists, and nothing writes the content keys again at boot. The
 * caller must therefore schedule() one pass after construction — see store.ts.
 */
export function createDirtyTracker(
  api: DirtyTrackerApi,
  options: { scheduler?: WriteScheduler; fingerprint?: (content: ProjectContent) => string } = {},
): DirtyTracker {
  const scheduler = options.scheduler ?? idleWriteScheduler;
  const fingerprint = options.fingerprint ?? fingerprintContent;
  let handle: number | null = null;

  const cancel = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  const pass = (): void => {
    handle = null;
    const state = api.getState();
    if (state.dirty) return;
    if (isContentDirty(buildProjectContent(state), state.currentProjectId, state.projectBaselineHash, fingerprint)) {
      api.setState({ dirty: true });
    }
  };

  const schedule = (): void => {
    if (api.getState().dirty) return;
    if (handle === null) handle = scheduler.schedule(pass);
  };

  const unsubscribe = api.subscribe(
    (s): ContentRefs => [s.bpm, s.meterId, s.masterVolume, s.effects, s.loops, s.projectBaselineHash, s.currentProjectId],
    schedule,
    { equalityFn: shallow },
  );

  return {
    schedule,
    runNow: () => {
      cancel();
      pass();
    },
    stop: () => {
      cancel();
      unsubscribe();
    },
  };
}

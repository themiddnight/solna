import { shallow } from 'zustand/shallow';
import { idleWriteScheduler, type WriteScheduler } from '../utils/coalescedStorage';
import { PROJECT_CONTENT_KEYS } from './projectFormat';
import type { AppStore } from './types';

export interface AutosaveApi {
  getState(): AppStore;
  subscribe<U>(
    selector: (state: AppStore) => U,
    listener: (next: U, prev: U) => void,
    options?: { equalityFn?: (a: U, b: U) => boolean },
  ): () => void;
}

export interface ProjectAutosave {
  /** Start writing on content changes. Called only once boot's load() has settled. */
  arm(): void;
  /** Stop writing and drop any buffered write. */
  disarm(): void;
  /** Write a pending change now (pagehide / hidden), cancelling the idle one. */
  flush(): void;
  /** Test/diagnostic: true while a write is buffered for the next idle window. */
  isScheduled(): boolean;
  /** Stop writing (R335): a content change marks a write without scheduling it; `flush()` is a no-op. A flag, not a count. */
  hold(): void;
  /** End a hold; schedules ONE write if a change was marked while held. A no-op when not held. */
  release(): void;
}

// The name is envelope data but must share the content's coalesced write.
const WRITE_KEYS = [...PROJECT_CONTENT_KEYS, 'projectName'] as const;

/**
 * Owns the autosave write. MUST NOT write per set(): a knob drag is 60-120
 * set() calls a second, and serialising the whole arrangement on each one
 * would run on the audio scheduler's thread. So: a subscribeWithSelector
 * subscription over the watched keys marks a write pending and schedules ONE
 * idle callback through the same scheduler coalescedStorage uses; many set()s
 * in a window collapse to one `save()`.
 *
 * It starts DISARMED. Boot's `load()` reads the slot asynchronously, and a
 * write scheduled before that settles could overwrite a freshly-loaded project
 * with the placeholder content the store booted with — see `bootProject` in
 * store.ts, which arms it in a `finally`.
 *
 * The pagehide/hidden flush mirrors coalescedStorage's: a killed tab must have
 * already written its last edit, so `flush()` writes a pending change on the
 * spot rather than waiting out the idle window.
 *
 * The vibe preview holds it (R335) — separate from the boot `arm`/`disarm`.
 */
export function createProjectAutosave(
  api: AutosaveApi,
  options: { scheduler?: WriteScheduler } = {},
): ProjectAutosave {
  const scheduler = options.scheduler ?? idleWriteScheduler;
  let handle: number | null = null;
  let armed = false;
  let held = false;
  let heldChange = false;

  const cancel = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  const write = (): void => {
    handle = null;
    if (!armed) return;
    void api.getState().save();
  };

  const schedule = (): void => {
    if (!armed) return;
    if (held) {
      heldChange = true;
      return;
    }
    if (handle === null) handle = scheduler.schedule(write);
  };

  api.subscribe(
    (s) => WRITE_KEYS.map((key) => s[key]),
    schedule,
    { equalityFn: shallow },
  );

  return {
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
      heldChange = false;
      cancel();
    },
    flush: () => {
      if (held || handle === null) return;
      cancel();
      write();
    },
    isScheduled: () => handle !== null,
    hold: () => {
      if (held) return;
      held = true;
      if (handle !== null) {
        heldChange = true;
        cancel();
      }
    },
    release: () => {
      if (!held) return;
      held = false;
      const changed = heldChange;
      heldChange = false;
      if (changed) schedule();
    },
  };
}

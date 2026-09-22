/**
 * The export mixdown slice.
 *
 * The split follows `projectSlice`'s `destination: 'download'` variant exactly:
 * **the store decides and the component writes.** Nothing here touches
 * `document`, creates an object URL or clicks an anchor — it returns the Blob
 * and the file name, and the header's click handler hands them to the browser.
 * That is what makes the whole export testable with no DOM.
 *
 * `exporting` and `mixdownProgress` are SESSION state: absent from
 * `partializeAppState` and `PROJECT_CONTENT_KEYS`, never persisted, and they
 * do not move `PERSIST_VERSION`.
 */
import type { StoreApi } from 'zustand';
import {
  renderMixdown,
  type MixdownFailureReason,
  type MixdownRenderProgress,
} from '../audio/export/renderMixdown';
import type { MixdownSnapshot } from '../audio/playback/plan/songSnapshot';
import type { AppStore } from './types';
import { reportOperationFailure } from '@/incidents/operationFailure';
import { MIXDOWN_FAILURE_MESSAGE, wavFileName } from './exportKinds';
import { buildMixdownSnapshot } from './mixdownSnapshot';

export type MixdownProgress =
  | MixdownRenderProgress
  | { phase: 'cancelling' }
  | { phase: 'downloading' };

export type MixdownResult =
  | { ok: true; destination: 'download'; blob: Blob; fileName: string }
  | { ok: false; reason: MixdownFailureReason };

export interface MixdownSlice {
  exporting: boolean;
  mixdownProgress: MixdownProgress | null;
  setMixdownProgress: (progress: MixdownProgress | null) => void;
  cancelMixdown: () => void;
  isMixdownCancelled: () => boolean;
  exportMixdown: () => Promise<MixdownResult>;
  buildMixdownSnapshot: () => MixdownSnapshot;
}

/**
 * Whether an export is running or its download is in flight. One predicate so
 * the header's Export menu and the project menu's replace guard cannot derive
 * "is a mixdown busy" two different ways.
 */
export function selectMixdownBusy(s: AppStore): boolean {
  return s.exporting || s.mixdownProgress !== null;
}

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export function createMixdownSlice(set: Set, get: Get): MixdownSlice {
  let activeJob: { controller: AbortController } | null = null;

  return {
    exporting: false,
    mixdownProgress: null,
    setMixdownProgress: (mixdownProgress) => set({ mixdownProgress }),
    cancelMixdown: () => {
      if (!activeJob && get().mixdownProgress === null) return;
      activeJob?.controller.abort();
      set({ mixdownProgress: { phase: 'cancelling' } });
    },
    isMixdownCancelled: () => get().mixdownProgress?.phase === 'cancelling',
    buildMixdownSnapshot: () => buildMixdownSnapshot(get()),

    exportMixdown: async () => {
      const job = { controller: new AbortController() };
      activeJob = job;
      // Capture content and identity in the click's task. The paint yield below
      // must never let a project replacement split the audio from its name.
      const snapshot = buildMixdownSnapshot(get());
      const fileName = wavFileName(get().projectName);
      set({ exporting: true, mixdownProgress: { phase: 'preparing' } });
      try {
        // Put graph construction in the next task so React can paint the
        // pending state before the synchronous scheduling walk begins.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (job.controller.signal.aborted) {
          return { ok: false, reason: { kind: 'cancelled' } };
        }
        const rendered = await renderMixdown(snapshot, (mixdownProgress) => {
          if (activeJob === job && !job.controller.signal.aborted) {
            set({ mixdownProgress });
          }
        }, job.controller.signal);
        if (!rendered.ok) {
          // The FAILURE notice is written here, not by the caller: it is a
          // property of the render, which this slice is the only witness to,
          // and a caller that ignored the result would otherwise leave the
          // user with a button that did nothing. The SUCCESS notice is the
          // component's, because it names a file the component has just
          // handed to the browser — the same split projectSlice's 'download'
          // destination uses.
          if (rendered.reason.kind !== 'cancelled') {
            set({ projectNotice: MIXDOWN_FAILURE_MESSAGE[rendered.reason.kind] });
            // Only an exception inside the render is a defect; an empty
            // arrangement or an unsupported browser is an expected outcome.
            if (rendered.reason.kind === 'render-failed') {
              reportOperationFailure('mixdown', new Error(rendered.reason.detail), 'degraded');
            }
          }
          return { ok: false, reason: rendered.reason };
        }
        return {
          ok: true,
          destination: 'download',
          blob: rendered.blob,
          fileName,
        };
      } finally {
        if (activeJob === job) {
          activeJob = null;
          set({ exporting: false, mixdownProgress: null });
        }
      }
    },
  };
}

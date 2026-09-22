/**
 * The export slice: one session-only job (R291, R292).
 *
 * `exportJob` is SESSION state — absent from `partializeAppState` and
 * `PROJECT_CONTENT_KEYS`, never persisted, never a version bump. The closure
 * `activeJob` is the single-job lock: it is set before the first await and
 * cleared in the `finally`, so one lifecycle runs from click to download.
 */
import type { StoreApi } from 'zustand';
import { reportOperationFailure } from '@/incidents/operationFailure';
import { downloadBlob } from '@/utils/projectFileIO';
import { exportKind, type ExportKindId, type ExportSnapshot } from './exportKinds';
import {
  runExportJob,
  yieldToBrowserPaint,
  yieldToTask,
  type ExportJob,
  type ExportJobPhase,
  type ExportOutcome,
} from './exportJob';
import { buildMixdownSnapshot } from './mixdownSnapshot';
import type { AppStore } from './types';

export interface ExportSlice {
  exportJob: ExportJob | null;
  startExport: (kind: ExportKindId) => Promise<ExportOutcome>;
  cancelExport: () => void;
}

/**
 * Whether an export is running, cancelling or downloading. One predicate so
 * the Header trigger, the dialog and the project menu's replace guard cannot
 * derive "busy" differently.
 */
export function selectExportBusy(s: AppStore): boolean {
  return s.exportJob !== null;
}

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export function createExportSlice(set: Set, get: Get): ExportSlice {
  let activeJob: { controller: AbortController; kind: ExportKindId } | null = null;

  return {
    exportJob: null,

    // The lock alone decides: reading `kind` off the closure job (not
    // `get().exportJob`) means a store desync — a timed-out test's `afterEach`
    // resetting `exportJob` while the closure job is still running, say —
    // can never make this a silent no-op.
    cancelExport: () => {
      if (activeJob === null) return;
      const { controller, kind } = activeJob;
      controller.abort();
      set({ exportJob: { kind, phase: 'cancelling' } });
    },

    startExport: async (kindId) => {
      if (activeJob !== null) return { status: 'ignored' };
      // Capture content and identity in the click's task, before any await:
      // the paint yield must never let a project replacement split the audio
      // from its name.
      const state = get();
      const snapshot: ExportSnapshot = { song: buildMixdownSnapshot(state), projectName: state.projectName };
      const job = { controller: new AbortController(), kind: kindId };
      activeJob = job;
      set({ exportJob: { kind: kindId, phase: 'preparing' } });
      const publish = (phase: ExportJobPhase) => {
        if (activeJob === job && !job.controller.signal.aborted) {
          set({ exportJob: { kind: kindId, ...phase } });
        }
      };
      try {
        return await runExportJob({
          kind: exportKind(kindId),
          snapshot,
          signal: job.controller.signal,
          publish,
          setNotice: (projectNotice) => set({ projectNotice }),
          download: downloadBlob,
          yieldToTask,
          yieldToBrowserPaint,
          reportFailure: (operation, detail) => reportOperationFailure(operation, new Error(detail), 'degraded'),
        });
      } finally {
        if (activeJob === job) {
          activeJob = null;
          set({ exportJob: null });
        }
      }
    },
  };
}

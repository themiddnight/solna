/**
 * The steps every export kind shares (R294): paint the pending state, run the
 * kind, report its failure, hand the file to the browser, say so.
 *
 * Every effect is an injected dependency, so the whole job is testable with
 * no DOM, no store and no renderer. `exportSlice.ts` supplies the real ones
 * and owns what is left: the single active job, snapshot capture in the
 * click's task, and clearing the job afterwards.
 */
import type {
  ExportFailureReason,
  ExportKindId,
  ExportKindResult,
  ExportKindSpec,
  ExportProgress,
  ExportSnapshot,
  IncidentOperation,
} from './exportKinds';

export type ExportJobPhase = ExportProgress | { phase: 'downloading' } | { phase: 'cancelling' };

/** The one piece of export state in the store; session-only (R291). */
export type ExportJob = { kind: ExportKindId } & ExportJobPhase;

/** What happened to the whole job — not what the renderer returned. */
export type ExportOutcome =
  | { status: 'downloaded'; fileName: string }
  | { status: 'download-failed'; fileName: string }
  | { status: 'failed'; reason: Exclude<ExportFailureReason, { kind: 'cancelled' }> }
  | { status: 'cancelled' }
  | { status: 'ignored' };

export interface ExportJobDeps {
  kind: ExportKindSpec;
  snapshot: ExportSnapshot;
  signal: AbortSignal;
  /** Publishes a phase; the slice drops it once the job is aborted or superseded. */
  publish: (phase: ExportJobPhase) => void;
  setNotice: (message: string) => void;
  download: (fileName: string, blob: Blob) => void;
  yieldToTask: () => Promise<void>;
  yieldToBrowserPaint: () => Promise<void>;
  reportFailure: (operation: IncidentOperation, detail: string) => void;
}

/**
 * What a download that threw reads as. The same sentence — and the same
 * reasoning — as `ProjectMenu`'s `downloadCopy`: the anchor/blob path can
 * throw in a restricted embedding, and downloading is best-effort.
 */
export const EXPORT_DOWNLOAD_FAILED_MESSAGE =
  'Could not write the file. Check the browser’s download settings.';

export function exportSuccessMessage(fileName: string): string {
  return `Exported ${fileName}.`;
}

/** Put the render in the next task so React can paint the pending state first. */
export function yieldToTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Let React commit the delivery phase for one visible frame before download. */
export function yieldToBrowserPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return yieldToTask();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** A kind that rejects is a render failure, so no kind can wedge the job. */
async function runKind(deps: ExportJobDeps): Promise<ExportKindResult> {
  try {
    return await deps.kind.run(deps.snapshot, deps.publish, deps.signal);
  } catch (err) {
    return {
      ok: false,
      reason: { kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * The failure notice is written here, once: a caller that ignored the outcome
 * would otherwise leave the user with a button that did nothing. Only an
 * exception inside the render is a defect worth an incident; an empty
 * arrangement or an unsupported browser is an expected outcome.
 */
function reportKindFailure(deps: ExportJobDeps, reason: ExportFailureReason): ExportOutcome {
  if (reason.kind === 'cancelled') return { status: 'cancelled' };
  deps.setNotice(deps.kind.failureMessages[reason.kind]);
  if (reason.kind === 'render-failed') deps.reportFailure(deps.kind.incidentOperation, reason.detail);
  return { status: 'failed', reason };
}

/**
 * The success notice is written only after the download has actually
 * returned; a download that throws is reported instead, because on that path
 * the user has waited out a full render and has no file.
 */
async function deliver(deps: ExportJobDeps, blob: Blob, fileName: string): Promise<ExportOutcome> {
  if (deps.signal.aborted) return { status: 'cancelled' };
  deps.publish({ phase: 'downloading' });
  await deps.yieldToBrowserPaint();
  if (deps.signal.aborted) return { status: 'cancelled' };
  try {
    deps.download(fileName, blob);
  } catch {
    deps.setNotice(EXPORT_DOWNLOAD_FAILED_MESSAGE);
    return { status: 'download-failed', fileName };
  }
  deps.setNotice(exportSuccessMessage(fileName));
  return { status: 'downloaded', fileName };
}

export async function runExportJob(deps: ExportJobDeps): Promise<ExportOutcome> {
  await deps.yieldToTask();
  if (deps.signal.aborted) return { status: 'cancelled' };
  const result = await runKind(deps);
  if (!result.ok) return reportKindFailure(deps, result.reason);
  return deliver(deps, result.blob, result.fileName);
}

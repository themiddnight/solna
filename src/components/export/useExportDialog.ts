/**
 * The export dialog's logic (R265): pure view helpers here, the hook in
 * Task 5. Kind-specific wording comes from the kind's spec; the three generic
 * phases are worded here once.
 */
import type { ExportJob, ExportOutcome } from '@/store/exportJob';
import { exportKind } from '@/store/exportKinds';

export interface ExportStatusView {
  label: string;
  /** Rendering only; `null` renders an indeterminate bar. */
  percent: number | null;
  canCancel: boolean;
}

export interface ExportTriggerView {
  busy: boolean;
  /** Visible text: 'Export' idle, the percent while rendering, none otherwise. */
  text: string | null;
  ariaLabel: string;
}

export function exportProgressLabel(job: ExportJob): string {
  switch (job.phase) {
    case 'preparing':
      return 'Preparing arrangement…';
    case 'rendering':
      return `${exportKind(job.kind).progressLabels.rendering}… ${job.percent}%`;
    case 'encoding':
      return `${exportKind(job.kind).progressLabels.encoding}…`;
    case 'cancelling':
      return 'Cancelling…';
    case 'downloading':
      return 'Downloading…';
  }
}

export function exportStatusView(job: ExportJob | null): ExportStatusView | null {
  if (job === null) return null;
  return {
    label: exportProgressLabel(job),
    percent: job.phase === 'rendering' ? job.percent : null,
    canCancel: job.phase !== 'cancelling',
  };
}

export function exportTriggerView(job: ExportJob | null): ExportTriggerView {
  if (job === null) return { busy: false, text: 'Export', ariaLabel: 'Export' };
  return {
    busy: true,
    text: job.phase === 'rendering' ? `${job.percent}%` : null,
    ariaLabel: exportProgressLabel(job),
  };
}

/** The toast reports a finished download; any other ending keeps the dialog open. */
export function closesDialogAfter(outcome: ExportOutcome): boolean {
  return outcome.status === 'downloaded';
}

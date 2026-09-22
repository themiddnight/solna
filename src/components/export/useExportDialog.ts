/**
 * The export dialog's logic (R265): pure view helpers here. Kind-specific
 * wording comes from the kind's spec; the three generic phases are worded
 * here once.
 */
import { useCallback, useState } from 'react';
import { useLiveStore } from '@/components/ui/useLiveStore';
import type { ExportJob, ExportOutcome } from '@/store/exportJob';
import { exportKind, type ExportKindId } from '@/store/exportKinds';
import { selectExportBusy } from '@/store/exportSlice';

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

export interface UseExportDialog {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  busy: boolean;
  status: ExportStatusView | null;
  trigger: ExportTriggerView;
  start: (kind: ExportKindId) => void;
  cancel: () => void;
}

/**
 * Called once, at `ExportButton` (R268). `open` is local UI state; the job is
 * the store's, so closing the dialog leaves it running and the trigger is the
 * way back in (R295). Reads go through `useLiveStore` so `renderToString`
 * tests see `setState` (R257).
 */
export function useExportDialog(): UseExportDialog {
  const [open, setOpen] = useState(false);
  const job = useLiveStore((s) => s.exportJob);
  const busy = useLiveStore(selectExportBusy);
  const startExport = useLiveStore((s) => s.startExport);
  const cancel = useLiveStore((s) => s.cancelExport);
  const openDialog = useCallback(() => setOpen(true), []);
  // Stable: `Modal` re-binds its native `close` listener whenever onClose changes.
  const closeDialog = useCallback(() => setOpen(false), []);
  const start = useCallback(
    (kind: ExportKindId) => {
      void startExport(kind).then((outcome) => {
        if (closesDialogAfter(outcome)) setOpen(false);
      });
    },
    [startExport],
  );
  return {
    open,
    openDialog,
    closeDialog,
    busy,
    status: exportStatusView(job),
    trigger: exportTriggerView(job),
    start,
    cancel,
  };
}

import { Modal } from '@/components/ui/Modal';
import type { ExportKindId, ExportKindSpec } from '@/store/exportKinds';
import type { ExportStatusView } from './useExportDialog';

export interface ExportDialogProps {
  open: boolean;
  /** Only closes. Closing never cancels a running job (R295). */
  onClose: () => void;
  kinds: readonly Pick<ExportKindSpec, 'id' | 'label'>[];
  busy: boolean;
  status: ExportStatusView | null;
  onStart: (kind: ExportKindId) => void;
  onCancel: () => void;
}

function ExportKindRows({ kinds, busy, onStart }: {
  kinds: ExportDialogProps['kinds']; busy: boolean; onStart: ExportDialogProps['onStart'];
}) {
  return (
    <div className="flex flex-col gap-2">
      {kinds.map((kind) => (
        <button key={kind.id} id={`btn-export-${kind.id}`} type="button"
          className="btn btn-sm btn-outline justify-start" disabled={busy} onClick={() => onStart(kind.id)}>
          {kind.label}
        </button>
      ))}
    </div>
  );
}

function ExportStatus({ status, onCancel }: { status: ExportStatusView; onCancel: () => void }) {
  return (
    <div id="export-status" role="status" aria-live="polite" className="space-y-2">
      <p className="text-xs font-semibold">{status.label}</p>
      {status.percent === null ? (
        <progress className="progress w-full" aria-label={status.label} />
      ) : (
        <progress className="progress progress-primary w-full" value={status.percent} max={100} aria-label={status.label} />
      )}
      {status.canCancel && (
        <button id="btn-cancel-export" type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel export
        </button>
      )}
    </div>
  );
}

export function ExportDialog({ open, onClose, kinds, busy, status, onStart, onCancel }: ExportDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Export" size="sm" boxClassName="space-y-4">
      <ExportKindRows kinds={kinds} busy={busy} onStart={onStart} />
      {status && <ExportStatus status={status} onCancel={onCancel} />}
    </Modal>
  );
}

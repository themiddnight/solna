import type { ReactNode } from 'react';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** Paints the confirm button with the error role — a destructive action. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The replacement for `confirm()`. The native dialog blocks the main thread —
 * which, in a workstation whose clock and scheduling live on it, means the
 * transport stalls while the user reads the question — and it cannot be
 * themed, so a delete prompt in a dark-themed app arrived as a white OS box.
 *
 * Mounted only while it should be shown, like the project dialogs it was
 * lifted from, so it passes `open` to Modal rather than exposing one.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open onClose={onCancel} title={title} boxClassName="space-y-4">
      <p className="text-sm">{message}</p>
      <div className="modal-action">
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- a dialog raised by a destructive action must open with Cancel focused, or a stray Enter confirms it. */}
        <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
        <button type="button" className={danger ? 'btn btn-error' : 'btn btn-primary'} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

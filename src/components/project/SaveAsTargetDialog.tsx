import { Cloud, HardDrive } from 'lucide-react';
import { Modal } from '../ui/Modal';

export const SAVE_AS_TITLE = 'Save as';
export const SAVE_AS_THIS_DEVICE = 'This device';
export const SAVE_AS_DRIVE = 'Google Drive';

export interface SaveAsTargetDialogProps {
  open: boolean;
  /** False when the deployment has no client id: the Drive row is absent, not disabled. */
  driveAvailable: boolean;
  onClose: () => void;
  onLocal: () => void;
  onDrive: () => void;
}

/**
 * The one question Save As asks that its two backends disagree about: WHERE.
 * Which name, and how the write happens, belong to the target — a local picker
 * or the Drive browser — so this dialog is two buttons and nothing else.
 */
export function SaveAsTargetDialog({
  open,
  driveAvailable,
  onClose,
  onLocal,
  onDrive,
}: SaveAsTargetDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={SAVE_AS_TITLE} size="sm" boxClassName="space-y-3">
      <button type="button" className="btn btn-ghost w-full justify-start gap-2 font-normal" onClick={onLocal}>
        <HardDrive className="w-4 h-4 text-base-content/60" aria-hidden="true" />
        {SAVE_AS_THIS_DEVICE}
      </button>
      {driveAvailable && (
        <button type="button" className="btn btn-ghost w-full justify-start gap-2 font-normal" onClick={onDrive}>
          <Cloud className="w-4 h-4 text-base-content/60" aria-hidden="true" />
          {SAVE_AS_DRIVE}
        </button>
      )}
    </Modal>
  );
}

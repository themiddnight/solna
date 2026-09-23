import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useAppStore } from '@/store/store';
import { syncDialogOpen } from './syncDialogOpen';

/**
 * A feedback hold while a MODAL dialog is `open`, as an effect's return: the
 * release is the cleanup, so closing (`open` → false) or unmounting lets the
 * timers run again. A non-modal dialog takes none — nothing behind it is inert
 * or covered by a backdrop, so a toast raised while it is open is seen.
 */
export function holdFeedbackWhile(open: boolean, modal = true): (() => void) | undefined {
  return open && modal ? useAppStore.getState().holdFeedback() : undefined;
}

/**
 * Whether an Escape keydown closes an open non-modal dialog. `show()` gives a
 * dialog no close request of its own, so the hook listens for the key. It
 * yields to a modal dialog open above the sheet (the MIDI settings a sheet row
 * opens): that Escape is the modal's own close request, and it must not close
 * the sheet underneath as well. Exported because the rule is the only part
 * this runner (no DOM) can test.
 */
export function escapeClosesNonModal(
  e: Pick<KeyboardEvent, 'key' | 'defaultPrevented'>,
  modalOpen: boolean,
): boolean {
  return e.key === 'Escape' && !e.defaultPrevented && !modalOpen;
}

/**
 * Platform glue shared by `Modal` and `BottomSheet`: syncs a native
 * `<dialog>` to a React `open` prop and turns its native `close` event (which
 * Escape, the backdrop form and a header button all end in) into `onClose`.
 *
 * The `openRef` guard stops the `close()` the sync effect issues itself (when
 * the parent sets `open=false`) from calling back into the parent a second
 * time — it is written before the sync so the listener can tell the two apart.
 *
 * While a modal dialog is open it holds the feedback timers (R329, R330): a
 * toast cannot rise above a modal backdrop, so it waits under it rather than
 * expiring unseen. The hold is released on close or unmount; this hook is the
 * only place that takes one. `modal: false` (R326) opens with `show()`, takes
 * no hold, and closes on Escape through its own listener.
 */
export function useNativeDialog(
  open: boolean,
  onClose: () => void,
  modal = true,
): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
    syncDialogOpen(ref.current, open, modal);
  }, [open, modal]);

  useEffect(() => holdFeedbackWhile(open, modal), [open, modal]);

  useEffect(() => {
    if (modal || !open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (escapeClosesNonModal(e, document.querySelector('dialog:modal') !== null)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [modal, open, onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => {
      if (openRef.current) onClose();
    };
    el.addEventListener('close', handleClose);
    return () => el.removeEventListener('close', handleClose);
  }, [onClose]);

  return ref;
}

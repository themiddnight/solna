import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useAppStore } from '@/store/store';
import { syncDialogOpen } from './syncDialogOpen';

/**
 * A feedback hold while `open`, as an effect's return: the release is the
 * cleanup, so closing (`open` → false) or unmounting lets the timers run again.
 */
export function holdFeedbackWhile(open: boolean): (() => void) | undefined {
  return open ? useAppStore.getState().holdFeedback() : undefined;
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
 * While open it holds the feedback timers (R329, R330): a toast cannot rise
 * above a modal backdrop, so it waits under it rather than expiring unseen.
 * The hold is released on close or unmount; this hook is the only place that
 * takes one.
 */
export function useNativeDialog(open: boolean, onClose: () => void): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
    syncDialogOpen(ref.current, open);
  }, [open]);

  useEffect(() => holdFeedbackWhile(open), [open]);

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

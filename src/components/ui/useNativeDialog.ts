import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { syncDialogOpen } from './syncDialogOpen';

/**
 * Platform glue shared by `Modal` and `BottomSheet`: syncs a native
 * `<dialog>` to a React `open` prop and turns its native `close` event (which
 * Escape, the backdrop form and a header button all end in) into `onClose`.
 *
 * The `openRef` guard stops the `close()` the sync effect issues itself (when
 * the parent sets `open=false`) from calling back into the parent a second
 * time — it is written before the sync so the listener can tell the two apart.
 */
export function useNativeDialog(open: boolean, onClose: () => void): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
    syncDialogOpen(ref.current, open);
  }, [open]);

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

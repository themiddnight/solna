import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

/** Cancels whatever this ref has pending, then schedules `fn` to replace it. */
export function scheduleTimeout(
  ref: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  fn: () => void,
  ms: number,
): void {
  if (ref.current) clearTimeout(ref.current);
  ref.current = setTimeout(fn, ms);
}

/**
 * One toast with one dismissal timer. Showing a new toast replaces the old one
 * AND its timer, so an older timer can never dismiss a newer toast early; the
 * pending timer is cleared on unmount, so it never sets state on an unmounted
 * component.
 */
export function useTimedToast<T>(): {
  toast: T | null;
  show: (t: T, ms: number) => void;
  dismiss: () => void;
} {
  const [toast, setToast] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      // A pending timer id is written by a later show(), never by this effect,
      // so only the ref read at cleanup time can name the timer still armed.
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const show = useCallback((next: T, ms: number) => {
    setToast(next);
    scheduleTimeout(timerRef, () => setToast(null), ms);
  }, []);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast(null);
  }, []);

  return { toast, show, dismiss };
}

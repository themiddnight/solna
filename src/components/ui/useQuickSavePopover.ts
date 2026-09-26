import { useEffect, useRef, type RefObject } from 'react';

export interface UseQuickSavePopover {
  /** The name input: `Popup`'s `initialFocusRef`, and the text selected on open. */
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * What `ui/Popup` does not do for the quick-save popover: select the name's
 * text on open, so typing replaces it. `Popup` moves focus to the input from
 * its own effect, which runs first because `Popup` is a child; this hook only
 * selects, so `Popup` still records the trigger as the place focus returns to.
 */
export function useQuickSavePopover(open: boolean): UseQuickSavePopover {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);
  return { inputRef };
}

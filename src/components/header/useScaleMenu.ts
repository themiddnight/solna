import { useCallback, useRef, useState, type RefObject } from 'react';
import { useAppStore } from '@/store/store';
import { commitScaleType } from './useScaleTypeListbox';

export interface UseScaleMenu {
  scaleRoot: string;
  scaleType: string;
  open: boolean;
  toggle: () => void;
  close: () => void;
  listboxRef: RefObject<HTMLDivElement | null>;
  /** Writes the scale (unless unchanged); the panel stays open. */
  onCommit: (value: string) => void;
}

/** The compact (below `xl`) key/scale panel's state. */
export function useScaleMenu(): UseScaleMenu {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const setScaleType = useAppStore((s) => s.setScaleType);
  const [open, setOpen] = useState(false);
  const listboxRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((wasOpen) => !wasOpen), []);
  const close = useCallback(() => setOpen(false), []);
  // A commit does not close the panel, as the <details> it replaces did not:
  // the root select sits beside the list, and a key is often set in two picks.
  const onCommit = useCallback(
    (value: string) => commitScaleType(scaleType, value, setScaleType),
    [scaleType, setScaleType],
  );

  return { scaleRoot, scaleType, open, toggle, close, listboxRef, onCommit };
}

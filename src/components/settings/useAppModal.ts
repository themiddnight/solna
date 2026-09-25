import { useCallback } from 'react';
import { useAppStore } from '@/store/store';
import { useThemeChoice, type UseThemeChoice } from './useThemeChoice';

/**
 * Every close path — Escape, the backdrop, the close button — ends here via
 * Modal's onClose: an unapplied preview is reverted first (R346).
 */
export function closeAppModal(revert: () => void, setOpen: (open: boolean) => void): void {
  revert();
  setOpen(false);
}

export interface UseAppModal {
  open: boolean;
  close: () => void;
  theme: UseThemeChoice;
}

export function useAppModal(): UseAppModal {
  const open = useAppStore((s) => s.isAppModalOpen);
  const setOpen = useAppStore((s) => s.setIsAppModalOpen);
  const theme = useThemeChoice();
  const { revert } = theme;
  // Stable (revert is stable for the store's lifetime): Modal re-binds its
  // native close listener whenever onClose changes.
  const close = useCallback(() => closeAppModal(revert, setOpen), [revert, setOpen]);
  return { open, close, theme };
}

/** What the wordmark calls, on both frames. */
export function useOpenAppModal(): () => void {
  const setOpen = useAppStore((s) => s.setIsAppModalOpen);
  return useCallback(() => setOpen(true), [setOpen]);
}

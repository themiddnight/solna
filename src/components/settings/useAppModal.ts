import { useCallback, useState } from 'react';
import { useAppStore } from '@/store/store';
import { useThemeChoice, type UseThemeChoice } from './useThemeChoice';

export type AppModalTab = 'settings' | 'about';

export const APP_MODAL_TABS: readonly { readonly id: AppModalTab; readonly label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'about', label: 'About' },
];

/**
 * Every close path — Escape, the backdrop, the close button — ends here via
 * Modal's onClose: an unapplied preview is reverted first (R346). Switching
 * to About is not a close, so it keeps the preview.
 */
export function closeAppModal(revert: () => void, setOpen: (open: boolean) => void): void {
  revert();
  setOpen(false);
}

export interface UseAppModal {
  open: boolean;
  /** Remembered for the session: component state, and the modal stays mounted. */
  tab: AppModalTab;
  selectTab: (tab: AppModalTab) => void;
  close: () => void;
  theme: UseThemeChoice;
}

export function useAppModal(): UseAppModal {
  const open = useAppStore((s) => s.isAppModalOpen);
  const setOpen = useAppStore((s) => s.setIsAppModalOpen);
  const theme = useThemeChoice();
  const [tab, selectTab] = useState<AppModalTab>('settings');
  const { revert } = theme;
  // Stable (revert is stable for the store's lifetime): Modal re-binds its
  // native close listener whenever onClose changes.
  const close = useCallback(() => closeAppModal(revert, setOpen), [revert, setOpen]);
  return { open, tab, selectTab, close, theme };
}

/** What the wordmark calls, on both frames. */
export function useOpenAppModal(): () => void {
  const setOpen = useAppStore((s) => s.setIsAppModalOpen);
  return useCallback(() => setOpen(true), [setOpen]);
}

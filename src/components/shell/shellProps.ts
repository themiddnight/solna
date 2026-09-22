import type { InputDeckDrumProps, InputDeckKeyboardProps } from '@/components/useInputDeck';

/**
 * What a shell takes from `Workspace`: the input deck's two bags (for the
 * dock) and the update banner's state. Both are owned above the shell so a
 * layout-mode switch never resets them (R316).
 */
export interface ShellProps {
  keyboardProps: InputDeckKeyboardProps;
  drumProps: InputDeckDrumProps;
  updateReady: boolean;
  onApplyUpdate: () => void;
  onDismissUpdate: () => void;
}

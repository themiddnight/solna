import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type IconButtonSize = 'xs' | 'sm' | 'md';
export type IconButtonVariant = 'ghost' | 'outline' | 'primary' | 'error';

/** The shape every icon button shares; the guard test regexes for it. */
export const ICON_BUTTON_BASE = 'btn btn-square';

const SIZE_CLASS: Record<IconButtonSize, string> = {
  xs: 'btn-xs',
  sm: 'btn-sm',
  md: 'btn-md',
};

/**
 * `outline` is *this app's* outlined icon button — a ghost button with an
 * explicit base-300 border — not daisyUI's `btn-outline`, which paints the
 * border in the button's own colour and would change four call sites' look.
 * This closed union ends the `btn-ghost border border-base-300` drift for
 * every icon-only call site. Three hand-written text-button copies remain
 * out of scope — `LeadMelodyGrid.tsx`'s octave `-`/`+` buttons and
 * `LfoPanel.tsx`'s octave selector (`-2`…`+2`) — because `IconButton`
 * requires an `icon` and these render literal text, not an icon.
 */
const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  ghost: 'btn-ghost',
  outline: 'btn-ghost border border-base-300',
  primary: 'btn-primary',
  error: 'btn-error',
};

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title' | 'aria-label'> {
  /**
   * The accessible name. Required, and emitted as both `aria-label` and
   * `title`: an icon-only button has no text node, so without it the button is
   * announced as "button" and hovers with no hint.
   */
  label: string;
  icon: ReactNode;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** Adds daisyUI's `btn-active` — a pressed/selected icon button. */
  active?: boolean;
}

export function IconButton({
  label,
  icon,
  size = 'sm',
  variant = 'ghost',
  active = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cx(ICON_BUTTON_BASE, SIZE_CLASS[size], VARIANT_CLASS[variant], active && 'btn-active', className)}
    >
      {icon}
    </button>
  );
}

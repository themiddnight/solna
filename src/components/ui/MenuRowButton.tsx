import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

/** The only prop a `HEADER_TOOLS` component takes; field tools ignore it. */
export interface ToolVariantProps {
  /** `bar` inline in a toolbar (default), `row` as a labelled menu row. */
  variant?: 'bar' | 'row';
}

export interface MenuRowButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode;
  /** Visible text: a row in a touch menu is never icon-only. */
  label: string;
}

/**
 * One full-width, 44px-tall menu row: icon + label. A plain button, not a
 * daisyUI `menu` item — a tool row may carry its own `<dialog>` beside it,
 * and `.menu li > *` would restyle that dialog as a menu item.
 */
export function MenuRowButton({ icon, label, className, type = 'button', ...rest }: MenuRowButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('btn btn-ghost btn-block justify-start gap-3 min-h-11 text-sm font-semibold', className)}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

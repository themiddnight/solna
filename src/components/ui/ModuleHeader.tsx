import type { ReactNode } from 'react';
import { cx } from './cx';
import { STEP_BADGE } from './fieldClasses';

/** The header row ten cards spelled out by hand. `fieldClasses.test.ts` guards it. */
export const MODULE_HEADER_ROW = 'flex items-center justify-between border-b border-base-300 pb-2';

/** The title inside that row — ten hand-written copies. Guarded in the same sweep. */
export const MODULE_TITLE = 'text-xs font-bold text-base-content flex items-center gap-1.5';

export interface ModuleHeaderProps {
  /** The canonical title. Omit it and pass `children` when the left cell is bespoke. */
  title?: ReactNode;
  /** The ordinal chip a numbered module carries (the synth's five stages, the rack's four units). */
  badge?: ReactNode;
  icon?: ReactNode;
  /** The row's second cell — a bypass toggle, a close button. */
  right?: ReactNode;
  /** Used instead of `title` when the left cell is not the canonical title span. */
  children?: ReactNode;
  className?: string;
  /**
   * False where the parent already draws the rule (PresetLibrary's inline save
   * form): the row keeps its layout and drops `border-b … pb-2`.
   */
  divider?: boolean;
}

export function ModuleHeader({
  title,
  badge,
  icon,
  right,
  children,
  className,
  divider = true,
}: ModuleHeaderProps) {
  return (
    <div className={cx(divider ? MODULE_HEADER_ROW : 'flex items-center justify-between', className)}>
      {title === undefined ? (
        children
      ) : (
        <span className={MODULE_TITLE}>
          {badge !== undefined && <span className={STEP_BADGE}>{badge}</span>}
          {icon}
          {title}
        </span>
      )}
      {right}
    </div>
  );
}

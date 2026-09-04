import type { ReactNode } from 'react';
import { cx } from './cx';

/** The panel shell sixteen cards spelled out by hand. `fieldClasses.test.ts` guards it. */
export const PANEL_CARD = 'card bg-panel border border-base-300 shadow-md';

export interface PanelCardProps {
  /**
   * The module tint — the computed `ring` + `tint` pair from
   * `SYNTH_TARGET_STYLES` that `useSynthChannel()` returns as `tintClass`.
   * A string rather than a union: the value is two classes joined at runtime,
   * and typing it as a token would make this primitive import `utils/`.
   */
  tint?: string;
  className?: string;
  children: ReactNode;
}

export function PanelCard({ tint, className, children }: PanelCardProps) {
  return <div className={cx(PANEL_CARD, tint, className)}>{children}</div>;
}

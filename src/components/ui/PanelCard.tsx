import type { ReactNode } from 'react';
import { cx } from './cx';

/** The panel shell sixteen cards spelled out by hand. `fieldClasses.test.ts` guards it. */
export const PANEL_CARD = 'card bg-panel border border-base-300 shadow-md';

/**
 * The same card NESTED inside another one — the synth's five signal stages and
 * the Simple-mode macro dials, which sit inside the Synth `SectionCard`.
 *
 * A panel drawn on `bg-panel` with a shadow reads as FLOATING, so a card of
 * them inside a card read as a pile rather than as one instrument's
 * compartments. This recesses instead: `bg-base-200`, no shadow — the well
 * idiom the oscilloscope box and `JOIN_LANE` already use, so a nested panel
 * looks like part of its parent and not a sibling that landed there.
 */
export const PANEL_CARD_INSET = 'card bg-base-200 border border-base-300';

export interface PanelCardProps {
  /**
   * Draw the recessed shell instead of the floating one, for a card nested
   * inside another card. Mutually exclusive with `tint` by construction: an
   * inset panel is a compartment of a section that already carries the tint.
   */
  inset?: boolean;
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

export function PanelCard({ inset, tint, className, children }: PanelCardProps) {
  return <div className={cx(inset ? PANEL_CARD_INSET : PANEL_CARD, tint, className)}>{children}</div>;
}

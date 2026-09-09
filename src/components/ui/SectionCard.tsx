import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ACTION_CLUSTER, SECTION_HEADER } from './fieldClasses';
import { cx } from './cx';
import { PanelCard } from './PanelCard';

export interface SectionCardProps {
  icon: LucideIcon;
  title: string;
  /**
   * The module tint — the computed `ring` + `tint` pair from
   * `SYNTH_TARGET_STYLES`. Only the Synth section takes one, and it takes it
   * HERE rather than on the panels inside: see design.md §6.5.
   */
  tint?: string;
  /** The band's right-hand cell — controls that belong to this section alone. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * A named section of a view: `ViewHeader` one level down.
 *
 * `ViewHeader` names the TAB and wears the primary icon chip; this names one
 * SECTION inside it. The Sound tab holds three — Synth, Drum Sound, Mixer —
 * and before this component the three announced themselves at three different
 * weights, which is what made the tab read as "the synth, plus two leftovers"
 * rather than as three things.
 *
 * The icon is `text-primary` like every other piece of non-signal-stage chrome
 * (design.md §6.5); the module identity colours stay on the synth's own signal
 * stages, inside.
 */
export function SectionCard({
  icon: Icon,
  title,
  tint,
  actions,
  children,
}: SectionCardProps) {
  return (
    <PanelCard tint={tint}>
      <div className="card-body p-3 sm:p-4 gap-3">
        {/* One band, not three near-copies: the Sound tab's sections are only
            legible as PEERS while their headings are identical, and they were
            not — Synth had no band at all, Drum drew an icon plus a
            `SECTION_HEADER`, and the Mixer drew a bare `SECTION_HEADER` with
            no icon. It stays a literal rather than a guarded token: the class
            combination is generic layout that legitimately recurs (the
            sequencer's toolbar row is the same three utilities), so a guard on
            it would fire on markup that is not this role. */}
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center gap-2">
            <Icon className="w-3.5 h-3.5 text-primary" />
            <span className={SECTION_HEADER}>{title}</span>
          </div>
          {/* Its own cell, the way HeaderCard gives its actions one: a bare
              fragment here makes each button a direct child of a
              `justify-between` row, which spreads two buttons across the band
              instead of grouping them opposite the title.

              `relative` so an action can hang a toast off ITSELF. Anchoring
              one to the card instead puts `top-full` at the bottom of the
              whole section — hundreds of pixels from the button that raised
              it, and off-screen on a tall card. */}
          {actions !== undefined && (
            <div className={cx(ACTION_CLUSTER, 'relative')}>{actions}</div>
          )}
        </div>
        {children}
      </div>
    </PanelCard>
  );
}

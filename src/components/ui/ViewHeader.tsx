import type { LucideIcon } from 'lucide-react';
import React from 'react';
import type { ViewMode } from '@/types';
import { VIEW_META } from '../viewMeta';
import { ACTION_CLUSTER, HEADER_BADGE } from './fieldClasses';
import { cx } from './cx';
import { PanelCard } from './PanelCard';
import { SoloChip } from './SoloChip';

export interface ViewHeaderProps {
  view: ViewMode;
  /** Machine-computed context, e.g. the sequencer's "16-Step · 4/4". */
  badge?: React.ReactNode;
  /** The group beside the title that selects what this view shows. */
  viewControls?: React.ReactNode;
  /** Right-hand control cluster. */
  actions?: React.ReactNode;
}

/**
 * The header card every view opens with. This markup used to be copy-pasted
 * into SequencerView, ChordView and EffectsRackView (and was simply missing
 * from SoundView); centralising it is what stops the four from drifting again.
 *
 * The icon chip is always `primary`. Module identity colours are reserved for
 * the synth's signal stages (design.md 6.5) — ChordView used to tint this chip
 * `module-chord`, which is the violation this component removes.
 */
export function ViewHeader({ view, badge, viewControls, actions }: ViewHeaderProps) {
  const { icon, title } = VIEW_META[view];
  // No `children` pass-through. It advertised a slot for absolutely-positioned
  // extras that no call site used, and the slot did not work: a child here
  // lands in a `justify-between` flex row with no positioned ancestor, which
  // is exactly why SoundView's save toast now hangs off SectionCard's actions
  // cell instead. `children` stays live on HeaderCard, which SegmentHeader uses.
  return (
    <HeaderCard
      icon={icon}
      title={title}
      badge={badge}
      viewControls={viewControls}
      actions={actions}
    />
  );
}

export interface HeaderCardProps {
  icon: LucideIcon;
  title: string;
  badge?: React.ReactNode;
  /**
   * The control that selects WHAT this view shows — Pattern's segment row
   * (which content) and the Sound tab's focus chips (which track).
   *
   * `actions` holds everything else in the header's right cluster, INCLUDING
   * how deep the selected thing is shown. Focus and depth are different axes —
   * which track, versus how much of it — and putting both on the same side
   * would read as one compound switcher rather than two controls.
   *
   * This slot used to hold the Sound tab's depth switch, on the argument that
   * `actions` is for things you DO to what is on screen and a control that
   * changes the screen itself is not one of them. That argument was made when
   * the slot had exactly one candidate to sort, which made it untestable;
   * opposite sides is more honest than that placement was, not a relaxation
   * of it.
   *
   * Only Pattern's occupant wears `HEADER_GROUP`, the join shell a segmented
   * control needs to read as one control at one height. Sound's occupant,
   * `SoundFocusChips`, is not that shape — a focus selector is a set of
   * independent choices, not a segmented switcher — so it wears its own
   * `bg-base-200` group instead; assuming `HEADER_GROUP` on every occupant
   * here would be reading a rule off the one caller that no longer holds it.
   * `HEADER_GROUP` still governs the depth switch, just in `actions` now.
   */
  viewControls?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * The card itself. Takes its icon and title as props because it has exactly
 * two callers, and each of those looks the pair up in ITS OWN registry —
 * ViewHeader in VIEW_META, SegmentHeader in VIEW_META's `pattern` entry.
 * Feature code never reaches this component, so "icon and label come from a
 * registry, never from a local literal" still holds at every call site that
 * exists.
 */
export function HeaderCard({
  icon: Icon,
  title,
  badge,
  viewControls,
  actions,
  children,
}: HeaderCardProps) {
  // Every card pins to the top of the scrolling `<main>`, in both frames, so
  // its controls stay in reach down a long view. A card with controls drops
  // its icon and title on a phone only: MobileTabBar already names the tab,
  // and every row the card pins is a row the view below it loses. One with
  // nothing but its title (Master) keeps it, or it would pin an empty bar.
  const compact = viewControls !== undefined || actions !== undefined;
  const phoneHidden = compact && 'max-md:hidden';
  // The title leaves the eye, not the outline: the view keeps its heading.
  const phoneTitle = compact && 'max-md:sr-only';
  return (
    <PanelCard className="relative sticky top-0 z-20">
      <div className="card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center flex-wrap gap-2 min-h-8 min-w-0 max-w-full">
          <div className={cx('p-1.5 rounded-selector bg-primary/20 border border-primary/30 text-primary', phoneHidden)}>
            <Icon className="w-4 h-4" />
          </div>
          <h2 className={cx('font-bold text-sm sm:text-base text-base-content', phoneTitle)}>{title}</h2>
          {badge !== undefined && (
            <span className={HEADER_BADGE}>
              {badge}
            </span>
          )}
          {viewControls}
        </div>
        {/* The right-hand cluster. It holds `actions` and the solo chip: the
            chip is not an action a view declares, it is the loop's own state
            showing up wherever the user is (see ui/SoloChip.tsx), so a view
            that declares no actions at all still has to be able to show it.
            The chip leads, so its position does not shift as a view's actions
            come and go. `empty:hidden` rather than a rendered condition —
            both children can render nothing, and only the DOM knows that
            after the fact, so the cluster collapses on `:empty` instead of
            the card asking the chip whether it will draw. */}
        <div className={cx(ACTION_CLUSTER, 'empty:hidden')}>
          <SoloChip />
          {actions}
        </div>
        {children}
      </div>
    </PanelCard>
  );
}

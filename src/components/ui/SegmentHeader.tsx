import React from 'react';
import type { PatternSegment } from '@/types';
import { segmentForFocus } from '@/store/focusTrack';
import { useLiveStore } from './useLiveStore';
import { PatternSegmentRow } from './SegmentedControl';
import { VIEW_META } from '../viewMeta';
import { HeaderCard } from './ViewHeader';

export interface SegmentHeaderProps {
  segment: PatternSegment;
  /**
   * Right-hand control cluster. Only what belongs to the TAB lives here — a
   * segment's own solo and its context badge sit on that segment's content
   * card instead, beside the thing they describe.
   */
  actions?: React.ReactNode;
  /** Absolutely-positioned extras that belong to the header, e.g. save toasts. */
  children?: React.ReactNode;
}

/**
 * The header the Pattern tab opens with — ViewHeader's sibling, sharing its
 * card so the two cannot drift.
 *
 * It is named for the TAB, not the segment, and carries the segment row
 * itself. Three things used to assert identity in a stack: the navbar tab
 * ("Pattern"), the segment row ("Accompaniment"), and this card
 * ("Accompaniment" again) — the last two saying the same word twice. Now each
 * part says something the others do not: the title names the view, the row
 * names which segment, the actions belong to that segment. It also matches the
 * Sound tab, whose ViewHeader names the tab the same way, and it buys back a
 * whole row of vertical space.
 *
 * An earlier note here argued the opposite — that a strip reading "Pattern"
 * under a segment row is duplication. That was true while the row sat OUTSIDE
 * the strip; folding the row in is what dissolved it.
 *
 * Still rendered per segment rather than once by PatternView, because each
 * segment's actions close over that segment's own local state (Accompaniment's
 * quick-save and its toast) and hoisting them would drag that state up with
 * them. All three segments stay MOUNTED, though, so only
 * the active one may draw the row — three copies would put three
 * `id="segment-lead"` buttons in the DOM.
 */
export function SegmentHeader({ segment, actions, children }: SegmentHeaderProps) {
  // useLiveStore for the same reason PatternView's gate uses it: this decides
  // which of the four mounted headers draws the segment row, and a test that
  // sets focusTrack must be able to see the result.
  const activeSegment = segmentForFocus(useLiveStore((s) => s.focusTrack));
  const { icon, title } = VIEW_META.pattern;
  return (
    <HeaderCard
      icon={icon}
      title={title}
      viewControls={activeSegment === segment ? <PatternSegmentRow /> : undefined}
      actions={actions}
    >
      {children}
    </HeaderCard>
  );
}

import React from 'react';
import type { PatternSegment } from '@/types';
import { PATTERN_SEGMENTS } from '../viewMeta';
import { HeaderCard } from './ViewHeader';

export interface SegmentHeaderProps {
  segment: PatternSegment;
  /** Machine-computed context, e.g. the beat segment's "16-Step · 4/4". */
  badge?: React.ReactNode;
  /** Right-hand control cluster. */
  actions?: React.ReactNode;
  /** Absolutely-positioned extras that belong to the header, e.g. save toasts. */
  children?: React.ReactNode;
}

/**
 * The header card a Pattern SEGMENT opens with — ViewHeader's sibling, sharing
 * its card so the two cannot drift.
 *
 * Pattern deliberately has no tab-level header of its own: a strip reading
 * "Pattern" directly under a segment row that already names the segment is
 * duplication, while each segment owns an actions cluster (Accompaniment's
 * quick-save, Beat's meter badge) that needs a home. So the header is per
 * segment, and there is exactly one of them on screen at a time.
 */
export function SegmentHeader({ segment, badge, actions, children }: SegmentHeaderProps) {
  const meta = PATTERN_SEGMENTS.find((s) => s.id === segment);
  if (!meta) throw new Error(`SegmentHeader: unknown segment "${segment}"`);
  return (
    <HeaderCard icon={meta.icon} title={meta.title} badge={badge} actions={actions}>
      {children}
    </HeaderCard>
  );
}

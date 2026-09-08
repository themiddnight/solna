import type { LucideIcon } from 'lucide-react';
import React from 'react';
import type { ViewMode } from '@/types';
import { VIEW_META } from '../viewMeta';
import { HEADER_BADGE } from './fieldClasses';
import { PanelCard } from './PanelCard';

export interface ViewHeaderProps {
  view: ViewMode;
  /** Machine-computed context, e.g. the sequencer's "16-Step · 4/4". */
  badge?: React.ReactNode;
  /** Right-hand control cluster. */
  actions?: React.ReactNode;
  /** Absolutely-positioned extras that belong to the header, e.g. save toasts. */
  children?: React.ReactNode;
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
export function ViewHeader({ view, badge, actions, children }: ViewHeaderProps) {
  const { icon, title } = VIEW_META[view];
  return (
    <HeaderCard icon={icon} title={title} badge={badge} actions={actions}>
      {children}
    </HeaderCard>
  );
}

export interface HeaderCardProps {
  icon: LucideIcon;
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * The card itself. Takes its icon and title as props because it has exactly
 * two callers, and each of those looks the pair up in ITS OWN registry —
 * ViewHeader in VIEW_META, SegmentHeader in PATTERN_SEGMENTS. Feature code
 * never reaches this component, so "icon and label come from a registry, never
 * from a local literal" still holds at every call site that exists.
 */
export function HeaderCard({ icon: Icon, title, badge, actions, children }: HeaderCardProps) {
  return (
    <PanelCard className="relative">
      <div className="card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-h-8">
          <div className="p-1.5 rounded-selector bg-primary/20 border border-primary/30 text-primary">
            <Icon className="w-4 h-4" />
          </div>
          <h2 className="font-bold text-sm sm:text-base text-base-content">{title}</h2>
          {badge !== undefined && (
            <span className={HEADER_BADGE}>
              {badge}
            </span>
          )}
        </div>
        {actions !== undefined && (
          <div className="flex items-center flex-wrap gap-1.5 min-h-8">{actions}</div>
        )}
        {children}
      </div>
    </PanelCard>
  );
}

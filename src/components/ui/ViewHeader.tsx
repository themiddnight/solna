import React from 'react';
import type { ViewMode } from '../../types';
import { VIEW_META } from '../viewMeta';
import { HEADER_BADGE } from './fieldClasses';

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
 * from SynthView); centralising it is what stops the four from drifting again.
 *
 * The icon chip is always `primary`. Module identity colours are reserved for
 * the synth's signal stages (design.md 6.5) — ChordView used to tint this chip
 * `module-chord`, which is the violation this component removes.
 */
export const ViewHeader: React.FC<ViewHeaderProps> = ({ view, badge, actions, children }) => {
  const { icon: Icon, title } = VIEW_META[view];
  return (
    <div className="card bg-panel border border-base-300 shadow-md relative">
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
    </div>
  );
};

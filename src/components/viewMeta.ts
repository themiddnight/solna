import { AudioWaveform, Grid, Music, Sliders, type LucideIcon } from 'lucide-react';
import type { ViewMode } from '../types';

/**
 * One row per tab: the icon and the two names it goes by. Both `Header`'s tab
 * buttons and `ui/ViewHeader` read this table, so a tab and the view it opens
 * can never disagree about what they are called.
 *
 * `tabLabel` is the short form on the nav button (hidden below `xl`);
 * `title` is the long form on the view's own header card.
 */
export interface ViewMeta {
  icon: LucideIcon;
  tabLabel: string;
  title: string;
}

/** Left-to-right order in the nav; also the iteration order tests assert on. */
export const VIEW_ORDER = ['synth', 'sequencer', 'chords', 'effects'] as const;

export const VIEW_META: Record<ViewMode, ViewMeta> = {
  synth: { icon: Sliders, tabLabel: 'Synth', title: 'Synth Lab' },
  sequencer: { icon: Grid, tabLabel: 'Beat Step', title: 'Drum Sequencer' },
  chords: { icon: Music, tabLabel: 'Chords', title: 'Chord Studio' },
  // Was `Sliders`, identical to Synth's — see viewMeta.test.ts.
  effects: { icon: AudioWaveform, tabLabel: 'Master FX', title: 'Master Effects Rack' },
};

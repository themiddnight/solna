import { AudioWaveform, Grid, LayoutList, Sliders, type LucideIcon } from 'lucide-react';
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

/**
 * Every view exactly once, in the order the nav happens to show them — but the
 * nav does NOT read this. `Header`'s `AUTOMATION_TABS` and `SONG_NAV_TABS` are
 * what actually render, so reordering here alone moves nothing on screen; keep
 * the two in step by hand. What this list is for is coverage: the tests below
 * iterate it to prove every view has a distinct icon and a unique label.
 */
export const VIEW_ORDER = ['sound', 'pattern', 'arrange', 'master'] as const;

// INTERIM (Task 1 of the nav restructure): these four rows reuse the old
// views' icons and labels verbatim so the union compiles and the nav renders
// something truthful enough to click. Task 3 chooses the real labels.
export const VIEW_META: Record<ViewMode, ViewMeta> = {
  sound: { icon: Sliders, tabLabel: 'Synth/Lead', title: 'Synth / Lead' },
  pattern: { icon: Grid, tabLabel: 'Beat Step', title: 'Drum Sequencer' },
  arrange: { icon: LayoutList, tabLabel: 'Arrange', title: 'Arrangement' },
  master: { icon: AudioWaveform, tabLabel: 'Master FX', title: 'Master Effects Rack' },
};

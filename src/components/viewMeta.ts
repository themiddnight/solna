import { AudioWaveform, Drum, Grid, Layers, LayoutList, Music, Sliders, type LucideIcon } from 'lucide-react';
import { LOOP_TABS, SONG_TABS } from '../types';
import type { PatternSegment, ViewMode } from '../types';

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
 * Every view exactly once, loop layer first — the same two lists the nav and
 * the router read, concatenated, rather than a third literal of the same
 * roster. What this is for is coverage: the tests below iterate it to prove
 * every view has a distinct icon and a unique label, and a view that reached
 * `ViewMode` without reaching this list would have slipped both checks with
 * nothing failing.
 */
export const VIEW_ORDER = [...LOOP_TABS, ...SONG_TABS] as const;

export const VIEW_META: Record<ViewMode, ViewMeta> = {
  // Keeps `Sliders` from the old `synth` view: the tab is still the synth
  // engine, and after the mixer lands (Task 7) a fader bank is literally what
  // the icon depicts.
  sound: { icon: Sliders, tabLabel: 'Sound', title: 'Sound' },
  // Takes `Grid` from the old `sequencer` view. All three Pattern segments are
  // step grids, so the icon that named one of them now names all three.
  // `title` and `icon` here ARE what the Pattern tab's header card shows:
  // SegmentHeader names the header for the TAB and hangs the segment row off
  // it, so the segments no longer supply a title of their own.
  pattern: { icon: Grid, tabLabel: 'Pattern', title: 'Pattern' },
  arrange: { icon: LayoutList, tabLabel: 'Arrange', title: 'Arrangement' },
  // Was `Sliders`, identical to the synth tab's — see viewMeta.test.ts.
  master: { icon: AudioWaveform, tabLabel: 'Master FX', title: 'Master Effects Rack' },
};

/**
 * Pattern's segment row: id, the name on the button, and the icon.
 *
 * There is no long `title` any more. It existed for a per-segment header card
 * that named the segment; SegmentHeader names the TAB now and carries this row
 * inside it, so the button IS the segment's name and a second, longer one
 * would be the duplication that change removed.
 *
 * Unlike VIEW_ORDER/VIEW_META this is ONE list, not an order plus a record:
 * there are three entries, the row renders them in this order, and nothing
 * needs to look a segment up by id often enough to earn a second structure.
 */
export const PATTERN_SEGMENTS: ReadonlyArray<{
  id: PatternSegment;
  label: string;
  icon: LucideIcon;
}> = [
  // `Music` is free: it was the departed `chords` view's icon, and the note
  // grid is the most literally musical surface in the app.
  { id: 'lead', label: 'Lead', icon: Music },
  // Chord + bass + pad, stacked — `Layers` says "several at once" without
  // naming any one of them, the same reasoning that made this group
  // `Accompany` rather than `Chords/Bass` when the pad layer landed.
  { id: 'accompaniment', label: 'Accompaniment', icon: Layers },
  { id: 'beat', label: 'Beat', icon: Drum },
];

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
  // `title` is dead data by design: PatternView renders no tab-level
  // ViewHeader, because one would duplicate the segment row directly beneath
  // it. viewMeta.test.ts still enforces title uniqueness over it — that's
  // fine, this string just never reaches the screen.
  pattern: { icon: Grid, tabLabel: 'Pattern', title: 'Pattern' },
  arrange: { icon: LayoutList, tabLabel: 'Arrange', title: 'Arrangement' },
  // Was `Sliders`, identical to the synth tab's — see viewMeta.test.ts.
  master: { icon: AudioWaveform, tabLabel: 'Master FX', title: 'Master Effects Rack' },
};

/**
 * Pattern's segment row: id, the short name on the button, the long name on
 * the segment's own header card, and the icon. Same contract as VIEW_META
 * above and for the same reason — `Header`'s segment row and each segment's
 * `SegmentHeader` both read this table, so a button and the thing it opens can
 * never disagree about what they are called.
 *
 * Unlike VIEW_ORDER/VIEW_META this is ONE list, not an order plus a record:
 * there are three entries, the row renders them in this order, and nothing
 * needs to look a segment up by id often enough to earn a second structure.
 */
export const PATTERN_SEGMENTS: ReadonlyArray<{
  id: PatternSegment;
  label: string;
  title: string;
  icon: LucideIcon;
}> = [
  // `Music` is free: it was the departed `chords` view's icon, and the note
  // grid is the most literally musical surface in the app.
  { id: 'lead', label: 'Lead', title: 'Lead Melody', icon: Music },
  // Chord + bass + pad, stacked — `Layers` says "several at once" without
  // naming any one of them, the same reasoning that made this group
  // `Accompany` rather than `Chords/Bass` when the pad layer landed.
  { id: 'accompaniment', label: 'Accompaniment', title: 'Accompaniment', icon: Layers },
  { id: 'beat', label: 'Beat', title: 'Drum Pattern', icon: Drum },
];

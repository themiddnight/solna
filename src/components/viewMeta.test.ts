import { describe, expect, test } from 'bun:test';
import { PATTERN_SEGMENTS, VIEW_META, VIEW_ORDER } from './viewMeta';
import { PATTERN_SEGMENT_IDS } from '../types';
import { LOOP_TABS, SONG_TABS } from '../types';

describe('VIEW_META', () => {
  test('covers every view exactly once', () => {
    expect(VIEW_ORDER).toEqual(['sound', 'pattern', 'arrange', 'master']);
    expect(Object.keys(VIEW_META).sort()).toEqual(
      ['arrange', 'master', 'pattern', 'sound'],
    );
  });

  // The tab label is the only text on a nav button that is not `hidden
  // xl:inline`-suppressed below 1280px, so a label that names a PART of a tab
  // is a wrong label, not a terse one. "Synth/Lead" named a part of Sound;
  // "Beat Step" named a part of Pattern.
  test('a tab is named for the whole tab, not for one thing inside it', () => {
    expect(VIEW_META.sound.tabLabel).toBe('Sound');
    expect(VIEW_META.pattern.tabLabel).toBe('Pattern');
    expect(VIEW_META.arrange.tabLabel).toBe('Arrange');
    expect(VIEW_META.master.tabLabel).toBe('Master FX');
  });

  // The bug this pins: Synth and Master FX both used `Sliders`, and the tab
  // label is `hidden xl:inline`, so under 1280px the two tabs rendered
  // identically. Distinctness is now an invariant, not a code review.
  test('every view has its own icon', () => {
    const icons = VIEW_ORDER.map((v) => VIEW_META[v].icon);
    expect(new Set(icons).size).toBe(VIEW_ORDER.length);
  });

  test('labels and titles are unique and non-empty', () => {
    const tabLabels = VIEW_ORDER.map((v) => VIEW_META[v].tabLabel);
    const titles = VIEW_ORDER.map((v) => VIEW_META[v].title);
    expect(new Set(tabLabels).size).toBe(VIEW_ORDER.length);
    expect(new Set(titles).size).toBe(VIEW_ORDER.length);
    expect(tabLabels.every((l) => l.trim().length > 0)).toBe(true);
    expect(titles.every((t) => t.trim().length > 0)).toBe(true);
  });

  test('Header covers every view across its two tab groups', () => {
    const covered = [...SONG_TABS, ...LOOP_TABS].sort();
    expect(covered).toEqual(['arrange', 'master', 'pattern', 'sound']);
  });
});

describe('PATTERN_SEGMENTS', () => {
  test('lists the four segments in the order the row renders them', () => {
    expect(PATTERN_SEGMENTS.map((s) => s.id)).toEqual(['lead', 'fx', 'accompaniment', 'beat']);
  });

  /**
   * Coverage, not order — the assertion above pins the list against itself and
   * would stay green if the `PatternSegment` union grew a member this table
   * never gained. Unlike VIEW_META this is a list rather than a
   * `Record<PatternSegment, …>`, so nothing in the type system says the two
   * agree; a missing segment is a `SegmentHeader` throw and a blank Pattern
   * tab at runtime. `PATTERN_SEGMENT_IDS` is what the union is derived FROM,
   * so comparing against it is comparing against the union itself.
   */
  test('covers every PatternSegment the union allows', () => {
    expect(PATTERN_SEGMENTS.map((s) => s.id).sort()).toEqual([...PATTERN_SEGMENT_IDS].sort());
  });

  test('every segment has its own icon, and none collides with a view icon', () => {
    const segmentIcons = PATTERN_SEGMENTS.map((s) => s.icon);
    expect(new Set(segmentIcons).size).toBe(PATTERN_SEGMENTS.length);
    const viewIcons = new Set(VIEW_ORDER.map((v) => VIEW_META[v].icon));
    for (const icon of segmentIcons) expect(viewIcons.has(icon)).toBe(false);
  });

  // No `title` to check: a segment's button label is the only name it has now
  // — SegmentHeader names the Pattern TAB and holds this row inside it.
  test('labels are unique and non-empty', () => {
    const labels = PATTERN_SEGMENTS.map((s) => s.label);
    expect(new Set(labels).size).toBe(PATTERN_SEGMENTS.length);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
  });
});

describe('PATTERN_SEGMENTS — the fx segment', () => {
  test('the ids are the four segments, FX beside Lead', () => {
    expect(PATTERN_SEGMENTS.map((s) => s.id)).toEqual(['lead', 'fx', 'accompaniment', 'beat']);
  });

  /**
   * PATTERN_SEGMENTS is a LIST, not a Record<PatternSegment, …>, so the compiler
   * cannot see a missing entry: SegmentHeader would throw at render and
   * PatternView would show a blank tab. This comparison against
   * PATTERN_SEGMENT_IDS is the only thing that catches it.
   */
  test('the table covers PATTERN_SEGMENT_IDS exactly', () => {
    expect(PATTERN_SEGMENTS.map((s) => s.id)).toEqual([...PATTERN_SEGMENT_IDS]);
  });

  /**
   * The icon has to be genuinely UNUSED, not merely apt: this assertion spans
   * the tab icons and the segment icons together, so reusing one another view
   * already wears fails here.
   */
  test('every segment icon is distinct from every other segment and view icon', () => {
    const icons = [
      ...PATTERN_SEGMENTS.map((s) => s.icon),
      ...VIEW_ORDER.map((v) => VIEW_META[v].icon),
    ];
    expect(new Set(icons).size).toBe(icons.length);
  });

  test('FX is labelled FX', () => {
    expect(PATTERN_SEGMENTS.find((s) => s.id === 'fx')?.label).toBe('FX');
  });
});

import { describe, expect, test } from 'bun:test';
import { PATTERN_SEGMENTS, VIEW_META, VIEW_ORDER } from './viewMeta';
import { AUTOMATION_TABS, SONG_NAV_TABS } from './Header';

describe('VIEW_META', () => {
  test('covers every view exactly once', () => {
    expect(VIEW_ORDER).toEqual(['sound', 'pattern', 'arrange', 'master']);
    expect(Object.keys(VIEW_META).sort()).toEqual(
      ['arrange', 'master', 'pattern', 'sound'],
    );
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
    const covered = [...SONG_NAV_TABS, ...AUTOMATION_TABS].sort();
    expect(covered).toEqual(['arrange', 'master', 'pattern', 'sound']);
  });
});

describe('PATTERN_SEGMENTS', () => {
  test('lists the three segments in the order the row renders them', () => {
    expect(PATTERN_SEGMENTS.map((s) => s.id)).toEqual(['lead', 'accompaniment', 'beat']);
  });

  test('every segment has its own icon, and none collides with a view icon', () => {
    const segmentIcons = PATTERN_SEGMENTS.map((s) => s.icon);
    expect(new Set(segmentIcons).size).toBe(PATTERN_SEGMENTS.length);
    const viewIcons = new Set(VIEW_ORDER.map((v) => VIEW_META[v].icon));
    for (const icon of segmentIcons) expect(viewIcons.has(icon)).toBe(false);
  });

  test('labels and titles are unique and non-empty', () => {
    const labels = PATTERN_SEGMENTS.map((s) => s.label);
    const titles = PATTERN_SEGMENTS.map((s) => s.title);
    expect(new Set(labels).size).toBe(PATTERN_SEGMENTS.length);
    expect(new Set(titles).size).toBe(PATTERN_SEGMENTS.length);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
    expect(titles.every((t) => t.trim().length > 0)).toBe(true);
  });
});

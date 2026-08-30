import { describe, expect, test } from 'bun:test';
import { VIEW_META, VIEW_ORDER } from './viewMeta';
import { AUTOMATION_TABS, SONG_NAV_TABS } from './Header';

describe('VIEW_META', () => {
  test('covers every view exactly once', () => {
    expect(VIEW_ORDER).toEqual(['synth', 'sequencer', 'chords', 'arrange', 'effects']);
    expect(Object.keys(VIEW_META).sort()).toEqual(
      ['arrange', 'chords', 'effects', 'sequencer', 'synth'],
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
    const covered = [...SONG_NAV_TABS, ...AUTOMATION_TABS.map((t) => t.view)].sort();
    expect(covered).toEqual(['arrange', 'chords', 'effects', 'sequencer', 'synth']);
  });
});

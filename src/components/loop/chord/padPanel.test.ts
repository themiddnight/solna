import { describe, expect, test } from 'bun:test';
import type { CategoryPresetGroup } from '@/audio/presetRegistry';
import { droneDegreeButtons, padPresetGroups } from './padPanel';

function group(category: string, presetNames: string[]): CategoryPresetGroup {
  return {
    category: category as CategoryPresetGroup['category'],
    label: category,
    badgeClass: '',
    description: '',
    presets: presetNames.map((name) => ({
      id: name,
      name,
      category: category as CategoryPresetGroup['category'],
      params: {},
    })),
  };
}

// These are pure functions ON PURPOSE. zustand wires getServerSnapshot to the
// store's creation-time state, so under renderToString a
// `useAppStore.setState({ padDroneDegree: 3 })` before the render has no effect
// and a rendered assertion silently checks the wrong state. Nothing in
// `bun run verify` catches that. Test the decision, not the markup.
describe('droneDegreeButtons', () => {
  test('a seven-degree scale renders seven buttons with roman labels', () => {
    const buttons = droneDegreeButtons('C', 'Major', 0);
    expect(buttons).toHaveLength(7);
    expect(buttons[0].label).toBe('I');
    expect(buttons[0].active).toBe(true);
  });

  // SCALES holds five- and six-note scales too. Hardcoding seven is the
  // mistake the table's shape exists to prevent.
  test('Hirajoshi renders five buttons, not seven', () => {
    expect(droneDegreeButtons('A', 'Hirajoshi', 0)).toHaveLength(5);
  });

  // The highlight follows `selected % length`, and the STORED value is left
  // alone. Selecting degree 6 in Major and switching to Hirajoshi makes the
  // resolver wrap to degree 1; the highlight wraps with it, so what is shown is
  // always what is heard. Clamping the stored value would destroy a setting
  // merely because the user looked at another scale.
  test('a degree beyond the scale length highlights its wrapped position', () => {
    const buttons = droneDegreeButtons('A', 'Hirajoshi', 6);
    expect(buttons.filter((b) => b.active)).toHaveLength(1);
    expect(buttons[1].active).toBe(true);
  });

  test('minor and diminished degrees keep their lower-cased numerals', () => {
    const buttons = droneDegreeButtons('C', 'Major', 0);
    expect(buttons[1].label).toBe(buttons[1].label.toLowerCase());
  });
});

// The preset <select> is a controlled input showing padSynthParams.preset.
// A plain category filter loses that guarantee the moment AdjustSynthButton
// loads a non-Pad preset (Keys, Lead, User…) onto the pad channel — the
// select would fall back to its blank placeholder and misreport what is
// actually playing. padPresetGroups keeps the curated Pad-only list AND
// guarantees the selected preset's own group is always present, so the
// control never lies about its current value.
describe('padPresetGroups', () => {
  const groups = [group('Pad', ['Warm Pad']), group('Keys', ['Rhodes'])];

  test('no selection shows only the curated Pad category', () => {
    const shown = padPresetGroups(groups, '');
    expect(shown.map((g) => g.category)).toEqual(['Pad']);
  });

  test('a preset loaded from outside Pad still shows in its own group', () => {
    const shown = padPresetGroups(groups, 'Rhodes');
    expect(shown.map((g) => g.category)).toEqual(['Pad', 'Keys']);
  });

  test('a Pad-category selection does not duplicate the group', () => {
    const shown = padPresetGroups(groups, 'Warm Pad');
    expect(shown.map((g) => g.category)).toEqual(['Pad']);
  });

  test('an unresolved preset name (deleted custom preset) does not add a phantom group', () => {
    const shown = padPresetGroups(groups, 'Deleted Custom Preset');
    expect(shown.map((g) => g.category)).toEqual(['Pad']);
  });
});

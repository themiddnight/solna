import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { CategoryPresetGroup } from '@/utils/synthPresets';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { droneDegreeButtons, padPresetGroups } from './padPanel';

/**
 * A group of stand-in presets. `id` is the name lower-cased and hyphenated so
 * the two axes the selector uses — what is SHOWN (name) and what is STORED
 * (id) — cannot be accidentally interchangeable in these assertions.
 */
function group(category: string, presetNames: string[]): CategoryPresetGroup {
  return {
    category: category as CategoryPresetGroup['category'],
    label: category,
    badgeClass: '',
    description: '',
    presets: presetNames.map((name) => ({
      id: name.toLowerCase().replace(/ /g, '-'),
      name,
      category: category as CategoryPresetGroup['category'],
      engine: 'subtractive' as const,
      patch: SUBTRACTIVE_INIT.patch,
      tags: [],
      description: '',
      isFactory: true,
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
    const shown = padPresetGroups(groups, null);
    expect(shown.map((g) => g.category)).toEqual(['Pad']);
  });

  test('a preset loaded from outside Pad still shows in its own group', () => {
    const shown = padPresetGroups(groups, 'rhodes');
    expect(shown.map((g) => g.category)).toEqual(['Pad', 'Keys']);
  });

  test('a Pad-category selection does not duplicate the group', () => {
    const shown = padPresetGroups(groups, 'warm-pad');
    expect(shown.map((g) => g.category)).toEqual(['Pad']);
  });

  test('an unresolved preset id (deleted custom preset) does not add a phantom group', () => {
    const shown = padPresetGroups(groups, 'deleted-custom-preset');
    expect(shown.map((g) => g.category)).toEqual(['Pad']);
  });
});

/**
 * The resizable custom lane is a Chord/Bass thing: those two are the layers
 * whose pattern is a HAND-DRAWN cycle, so only they need a bar selector and a
 * span timeline. The pad follows the progression (or drones across all of it),
 * and has no per-lane cycle to shorten.
 *
 * Pinned against the source rather than a render: the pad card is the third
 * module in the same column as its two siblings, so a copy-paste of their lane
 * is the likely way one appears — and a rendered assertion cannot tell "the pad
 * has no bar field" from "the pad has one that happens to be hidden".
 */
describe('the pad card grows no custom lane', () => {
  const src = readFileSync(new URL('./PadModulePanel.tsx', import.meta.url), 'utf8');

  test('it renders neither the bar selector nor a span timeline', () => {
    expect(src).not.toContain('PatternBarsField');
    expect(src).not.toContain('CustomPatternTimeline');
  });

  test('it invents no pad-side custom pattern state to store', () => {
    // The lane's state lives in the chord and bass slices; there is no
    // `customPad*` field and no pad setter for one.
    expect(src).not.toContain('customPad');
  });
});

import { describe, expect, test } from 'bun:test';
import type { ListboxGroup } from './Listbox';
import { activeForValue, groupHeadingId, indexGroups, nextActive, optionId, parseOptionIndex, revealScrollTop } from './useListbox';

const GROUPS: readonly ListboxGroup[] = [
  {
    label: 'Fruit',
    options: [
      { value: 'green apple', label: 'Apple', description: 'Crisp and tart' },
      { value: 'banana', label: 'Banana' },
    ],
  },
  { label: 'Root veg', options: [{ value: 'carrot', label: 'Carrot', description: 'Sweet and earthy' }] },
];

describe('indexGroups', () => {
  test('numbers the options across groups in flat order', () => {
    const { groups, values, labels } = indexGroups(GROUPS);
    expect(values).toEqual(['green apple', 'banana', 'carrot']);
    expect(labels).toEqual(['Apple', 'Banana', 'Carrot']);
    expect(groups.map((g) => g.options.map((o) => o.index))).toEqual([[0, 1], [2]]);
    expect(groups[1]).toEqual({
      label: 'Root veg',
      options: [{ value: 'carrot', label: 'Carrot', description: 'Sweet and earthy', index: 2 }],
    });
  });

  test('an empty list indexes to nothing', () => {
    expect(indexGroups([])).toEqual({ groups: [], values: [], labels: [] });
  });
});

describe('ids', () => {
  // Scale keys contain spaces ('Natural Minor'), which an id cannot.
  test('option and heading ids come from indexes, never from the value', () => {
    expect(optionId('lb', 2)).toBe('lb-opt-2');
    expect(groupHeadingId('lb', 1)).toBe('lb-grp-1');
  });
});

describe('activeForValue', () => {
  test('the highlight starts on the selected option', () => {
    expect(activeForValue(['a', 'b', 'c'], 'b')).toBe(1);
  });

  test('a value not among the options starts the highlight on the first', () => {
    expect(activeForValue(['a', 'b'], 'stale key')).toBe(0);
  });

  test('an empty list has no highlight', () => {
    expect(activeForValue([], 'a')).toBe(-1);
  });
});

describe('nextActive', () => {
  const VALUES = ['a', 'b', 'c'];

  // Arrows and hover own the highlight while the value stands: an unrelated
  // re-render must never snap it back to the selected option.
  test('an unchanged value keeps the highlight where the user moved it', () => {
    expect(nextActive('b', 'b', 2, VALUES)).toBe(2);
    expect(nextActive('b', 'b', 0, VALUES)).toBe(0);
  });

  test('a value changed from outside moves the highlight to its option', () => {
    expect(nextActive('a', 'c', 0, VALUES)).toBe(2);
  });

  test('a commit re-seeds onto the option it just committed, a no-op', () => {
    expect(nextActive('a', 'b', 1, VALUES)).toBe(1);
  });

  test('a new value that is not an option starts on the first; an empty list has none', () => {
    expect(nextActive('a', 'stale key', 2, VALUES)).toBe(0);
    expect(nextActive('a', 'b', 0, [])).toBe(-1);
  });
});

describe('parseOptionIndex', () => {
  test('reads an in-range data-option-index', () => {
    expect(parseOptionIndex('2', 3)).toBe(2);
    expect(parseOptionIndex('0', 3)).toBe(0);
  });

  test('a missing, non-integer or out-of-range index is no option', () => {
    for (const raw of [null, undefined, '', '1.5', 'x', '3', '-1']) {
      expect(parseOptionIndex(raw, 3)).toBeNull();
    }
  });
});

describe('revealScrollTop', () => {
  // Only the listbox's own scroll box moves: scrollIntoView would also scroll
  // every ancestor, including the app's overflow-hidden root on a short screen.
  test('a visible option leaves the scroll where it is', () => {
    expect(revealScrollTop({ scrollTop: 40, height: 100 }, { top: 60, height: 20 })).toBe(40);
  });

  test('an option above the view scrolls up to its top', () => {
    expect(revealScrollTop({ scrollTop: 40, height: 100 }, { top: 10, height: 20 })).toBe(10);
  });

  test('an option below the view scrolls down until its bottom shows', () => {
    expect(revealScrollTop({ scrollTop: 40, height: 100 }, { top: 150, height: 20 })).toBe(70);
  });
});

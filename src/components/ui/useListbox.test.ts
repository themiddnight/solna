import { describe, expect, test } from 'bun:test';
import type { ListboxGroup } from './Listbox';
import { activeForValue, groupHeadingId, indexGroups, optionId, parseOptionIndex } from './useListbox';

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

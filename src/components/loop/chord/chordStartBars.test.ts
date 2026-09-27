import { describe, expect, test } from 'bun:test';
import { chordStartBars } from './chordStartBars';

describe('chordStartBars', () => {
  test('calculates each chord start in one forward pass', () => {
    expect(chordStartBars([{ bars: 1 }, { bars: 2 }, { bars: 4 }])).toEqual([1, 2, 4]);
  });

  test('treats missing and zero bar counts as one, matching progression defaults', () => {
    expect(chordStartBars([{ bars: 0 }, {}, { bars: 3 }])).toEqual([1, 2, 3]);
  });

  test('returns an empty array for an empty progression', () => {
    expect(chordStartBars([])).toEqual([]);
  });
});

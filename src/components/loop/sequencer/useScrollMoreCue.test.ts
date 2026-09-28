import { describe, expect, test } from 'bun:test';
import { hasMoreToRight, scrollMoreCueClass } from './useScrollMoreCue';

// UX F-03: at 360px the Beat grid showed steps 1-5 and nothing said 6-16
// existed to the right. The cue shows while content is off-screen right.
describe('hasMoreToRight', () => {
  test('a grid scrolled to the start of a wider track has more to the right', () => {
    expect(hasMoreToRight({ scrollLeft: 0, clientWidth: 300, scrollWidth: 700 })).toBe(true);
  });

  test('mid-scroll there is still more', () => {
    expect(hasMoreToRight({ scrollLeft: 200, clientWidth: 300, scrollWidth: 700 })).toBe(true);
  });

  test('at the scroll end there is none — fractional pixels included', () => {
    expect(hasMoreToRight({ scrollLeft: 400, clientWidth: 300, scrollWidth: 700 })).toBe(false);
    expect(hasMoreToRight({ scrollLeft: 399.5, clientWidth: 300, scrollWidth: 700 })).toBe(false);
  });

  test('a grid that fits has none', () => {
    expect(hasMoreToRight({ scrollLeft: 0, clientWidth: 800, scrollWidth: 800 })).toBe(false);
  });
});

describe('scrollMoreCueClass', () => {
  test('never takes a pointer, whether shown or not, so the cells under it stay tappable', () => {
    expect(scrollMoreCueClass(true)).toContain('pointer-events-none');
    expect(scrollMoreCueClass(false)).toContain('pointer-events-none');
  });

  test('fades from the card surface token, never a palette colour', () => {
    expect(scrollMoreCueClass(true)).toContain('from-base-100');
    expect(scrollMoreCueClass(true)).not.toMatch(/(slate|gray|white|black)-/);
  });

  test('shown while there is more, hidden at the end', () => {
    expect(scrollMoreCueClass(true)).toContain('opacity-100');
    expect(scrollMoreCueClass(false)).toContain('opacity-0');
  });
});

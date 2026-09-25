import { describe, expect, test } from 'bun:test';
import { placePopover, type DOMRectLike } from './placePopover';

const viewport = { width: 1024, height: 768 };
const panel = { width: 200, height: 300 };

function rect(partial: Partial<DOMRectLike> & { top: number; left: number; height: number; width: number }): DOMRectLike {
  const { top, left, width, height } = partial;
  return { top, left, width, height, right: left + width, bottom: top + height };
}

describe('placePopover', () => {
  test('below: plenty of room under the trigger, left-aligned to it', () => {
    const trigger = rect({ top: 100, left: 200, width: 200, height: 32 });
    expect(placePopover(trigger, panel, viewport)).toEqual({ top: 140, left: 200 });
  });

  test('flip-up: space below is smaller than the panel and space above is larger', () => {
    const trigger = rect({ top: 650, left: 200, width: 200, height: 40 });
    // spaceBelow = 768 - 690 = 78 < 300; spaceAbove = 650 > 78
    expect(placePopover(trigger, panel, viewport)).toEqual({ top: 650 - 300 - 8, left: 200 });
  });

  test('clamp-left: trigger near/off the left edge clamps to the 8px margin', () => {
    const trigger = rect({ top: 100, left: -50, width: 200, height: 32 });
    expect(placePopover(trigger, panel, viewport).left).toBe(8);
  });

  test('clamp-right: trigger near the right edge clamps so the panel stays inside with an 8px margin', () => {
    const trigger = rect({ top: 100, left: 900, width: 200, height: 32 });
    expect(placePopover(trigger, panel, viewport).left).toBe(1024 - 200 - 8);
  });
});

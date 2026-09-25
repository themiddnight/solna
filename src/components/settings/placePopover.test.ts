import { describe, expect, test } from 'bun:test';
import { placePopover, type DOMRectLike } from './placePopover';

const viewport = { width: 1024, height: 768 };
const panel = { width: 200, height: 300 };

function rect(partial: Partial<DOMRectLike> & { top: number; left: number; height: number; width: number }): DOMRectLike {
  const { top, left, width, height } = partial;
  return { top, left, width, height, right: left + width, bottom: top + height };
}

describe('placePopover', () => {
  test('below: plenty of room under the trigger, left-aligned to it, uncapped height', () => {
    const trigger = rect({ top: 100, left: 200, width: 200, height: 32 });
    const result = placePopover(trigger, panel, viewport);
    expect(result.top).toBe(140);
    expect(result.left).toBe(200);
    expect(result.maxHeight).toBeGreaterThanOrEqual(panel.height);
  });

  test('flip-up: space below is smaller than the panel and space above is larger, both fit', () => {
    const trigger = rect({ top: 650, left: 200, width: 200, height: 40 });
    const result = placePopover(trigger, panel, viewport);
    // above (634px available) beats below (62px available); the panel fits above, unclamped.
    expect(result.top).toBe(650 - 300 - 8);
    expect(result.left).toBe(200);
    expect(result.maxHeight).toBeGreaterThanOrEqual(panel.height);
  });

  test('neither side fits: caps to the chosen side and never renders off-screen', () => {
    // viewport 800 tall, trigger near the bottom: above (734px usable) beats below (2px usable),
    // but even 734px is smaller than the 900px-tall panel this test poses (a very long list).
    const tallViewport = { width: 1280, height: 800 };
    const tallPanel = { width: 200, height: 900 };
    const trigger = rect({ top: 750, left: 200, width: 200, height: 32 });
    const result = placePopover(trigger, tallPanel, tallViewport);
    expect(result.top).toBeGreaterThanOrEqual(0);
    expect(result.top).toBe(8); // clamped to the 8px margin, not negative
    expect(result.maxHeight).toBe(750 - 8 - 8); // availableAbove: trigger.top - GAP - MARGIN
    expect(result.maxHeight).toBeLessThan(tallPanel.height); // genuinely capped, not the full panel
  });

  test('fits below but more room above → stays below', () => {
    // availableAbove (404px) > availableBelow (300px), but 300px is exactly enough for the
    // 300px-tall panel, so the panel opens below — it does not chase the side with more room.
    const trigger = rect({ top: 420, left: 200, width: 200, height: 32 });
    const result = placePopover(trigger, panel, viewport);
    expect(result.top).toBe(420 + 32 + 8);
    expect(result.maxHeight).toBeGreaterThanOrEqual(panel.height);
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

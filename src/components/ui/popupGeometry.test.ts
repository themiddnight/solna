import { describe, expect, test } from 'bun:test';
import { isDismissKey, panelNaturalRect, popupShift } from './popupGeometry';

describe('isDismissKey', () => {
  test('Escape dismisses; nothing else does', () => {
    expect(isDismissKey({ key: 'Escape' })).toBe(true);
    expect(isDismissKey({ key: 'Enter' })).toBe(false);
    expect(isDismissKey({ key: 'Esc' })).toBe(false);   // the IE spelling is not a browser we ship to
    expect(isDismissKey({ key: 'a' })).toBe(false);
  });
});

describe('popupShift', () => {
  test('a panel that already fits needs no shift', () => {
    expect(popupShift({ left: 100, right: 300 }, 500)).toBe(0);
  });

  test('a panel overflowing the left edge shifts right by the overhang plus margin', () => {
    expect(popupShift({ left: -20, right: 200 }, 500, 8)).toBe(28);
  });

  test('a panel overflowing the right edge shifts left by the overhang plus margin', () => {
    expect(popupShift({ left: 400, right: 600 }, 500, 8)).toBe(-108);
  });

  test('a panel wider than the viewport pins its left edge to the margin', () => {
    // width (650) exceeds viewportWidth - 2*margin (484): pin left to 8,
    // rather than try (and fail) to also satisfy the right edge.
    expect(popupShift({ left: -50, right: 600 }, 500, 8)).toBe(58);
  });
});

describe('panelNaturalRect', () => {
  test('adds the wrapper origin to the panel offset box', () => {
    expect(panelNaturalRect(120, { offsetLeft: 0, offsetWidth: 200 })).toEqual({
      left: 120,
      right: 320,
    });
  });

  test('measuring is idempotent: applying the computed shift never changes the natural rect', () => {
    // offsetLeft/offsetWidth are box-model values, so unlike
    // getBoundingClientRect() they never move once our own translateX(shift)
    // is applied to the panel, nor while daisyUI's open-transition scale is
    // still animating — the same inputs are read every time.
    const wrapperLeft = 400;
    const panel = { offsetLeft: 0, offsetWidth: 200 }; // overflows the right edge at vw 500
    const viewportWidth = 500;

    const firstNatural = panelNaturalRect(wrapperLeft, panel);
    const firstShift = popupShift(firstNatural, viewportWidth);
    expect(firstShift).not.toBe(0);

    // "Apply" firstShift (as the translateX style) and measure again from
    // the same untransformed box-model inputs.
    const secondNatural = panelNaturalRect(wrapperLeft, panel);
    const secondShift = popupShift(secondNatural, viewportWidth);

    expect(secondNatural).toEqual(firstNatural);
    expect(secondShift).toBe(firstShift);
  });

  test('a resize with no geometry change reports the same shift, never flipping to 0', () => {
    const wrapperLeft = 400;
    const panel = { offsetLeft: 0, offsetWidth: 200 };
    const measure = () => popupShift(panelNaturalRect(wrapperLeft, panel), 500);

    const beforeResize = measure();
    const afterResize = measure(); // simulated resize event, same geometry
    expect(afterResize).toBe(beforeResize);
    expect(afterResize).not.toBe(0);
  });
});

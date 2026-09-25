/**
 * The pure half of a popup: which key dismisses it and where its panel sits.
 * Kept free of React and the DOM so this runner, which has no DOM, can test
 * it; `usePopup.ts` and `useQuickSavePopover.ts` wire it to real events.
 */

/**
 * Escape dismisses a popup. Exported because the key rule is the only part
 * of the dismissal that can be tested here — this runner has no DOM, so the
 * listener that calls it cannot be exercised.
 */
export function isDismissKey(e: Pick<KeyboardEvent, 'key'>): boolean {
  return e.key === 'Escape';
}

/**
 * Keeps the anchored panel inside the viewport horizontally (R328). `panel`
 * is the measured `left`/`right` of the rendered `dropdown-content` (its
 * natural position, anchored under the trigger); the return value is the
 * `translateX` (px) that pulls it back on screen. A panel wider than the
 * viewport cannot satisfy both edges, so it pins its left edge to `margin`
 * rather than split the overflow between the two.
 */
export function popupShift(
  panel: { left: number; right: number },
  viewportWidth: number,
  margin = 8,
): number {
  const width = panel.right - panel.left;
  if (width > viewportWidth - margin * 2) {
    return margin - panel.left;
  }
  if (panel.left < margin) {
    return margin - panel.left;
  }
  if (panel.right > viewportWidth - margin) {
    return viewportWidth - margin - panel.right;
  }
  return 0;
}

/**
 * The panel's viewport-relative position **before** any shift is applied to
 * it. `offsetLeft`/`offsetWidth` are box-model properties: unlike
 * `getBoundingClientRect()` they ignore `transform` entirely, so they read
 * the same natural position whether or not our own `translateX(shift)` is
 * currently applied, and whether or not daisyUI's `@starting-style`
 * `scale(.95)` open transition is still mid-flight. That makes measurement
 * idempotent — measuring twice in a row (or once before and once after
 * `shift` is applied) always yields the same natural rect, so `popupShift`
 * never flip-flops. This assumes `panel`'s offset parent is `wrapperLeft`'s
 * element (true here: daisyUI's `.dropdown` is `position: relative` and
 * `.dropdown-content` is `position: absolute`).
 */
export function panelNaturalRect(
  wrapperLeft: number,
  panel: { offsetLeft: number; offsetWidth: number },
): { left: number; right: number } {
  const left = wrapperLeft + panel.offsetLeft;
  return { left, right: left + panel.offsetWidth };
}

/**
 * Whether an event's node lies outside the popup's wrapper: the one test
 * behind both the outside-pointerdown close and the focus-leave close.
 * `null` is never outside. A focusout with no `relatedTarget` (Safari
 * focusing nothing on a click, a click on panel padding, a native select
 * handing off to its OS picker) has not left the popup, and closing on it
 * would shut the panel under the user's finger. The trigger sits inside the
 * wrapper, so a pointerdown on it is not outside either: the trigger's own
 * click toggles the popup shut, rather than an outside close firing first
 * and the click reopening it.
 */
export function isOutside<T>(node: T | null, contains: (node: T) => boolean): boolean {
  return node !== null && !contains(node);
}

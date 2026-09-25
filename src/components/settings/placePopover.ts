/** The subset of `DOMRect` the geometry needs — easy to construct in a test. */
export interface DOMRectLike {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface PopoverSize {
  readonly width: number;
  readonly height: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface PopoverPosition {
  readonly top: number;
  readonly left: number;
  /** The panel's capped height on the chosen side; always `<= panel.height`. */
  readonly maxHeight: number;
}

/** Gap between the trigger and the panel, and the clamp margin from the viewport edge. */
const GAP = 8;
const MARGIN = 8;

/**
 * `position: fixed` geometry for a popover anchored to `trigger`: left-aligned
 * to it, just below by default, flipping above when that side has more room
 * (below unless above is strictly larger). Neither side is guaranteed to fit
 * the whole panel, so the chosen side's available room becomes `maxHeight` —
 * the panel never renders off-screen; its content shrinks and scrolls inside
 * that cap instead. Clamped horizontally inside the viewport with the same
 * 8px margin. No CSS anchor positioning (Firefox support is incomplete) —
 * this is the pure helper the popover's colocated hook calls on `toggle`
 * (newState `open`) and on `resize`/`scroll` while open.
 */
export function placePopover(trigger: DOMRectLike, panel: PopoverSize, viewport: ViewportSize): PopoverPosition {
  const availableBelow = viewport.height - trigger.bottom - GAP - MARGIN;
  const availableAbove = trigger.top - GAP - MARGIN;
  const opensUpward = availableAbove > availableBelow;

  const maxHeight = Math.max(opensUpward ? availableAbove : availableBelow, 0);
  const height = Math.min(panel.height, maxHeight);

  const rawTop = opensUpward ? trigger.top - GAP - height : trigger.bottom + GAP;
  const lowestTop = Math.max(viewport.height - MARGIN - height, MARGIN);
  const top = Math.min(Math.max(rawTop, MARGIN), lowestTop);

  const maxLeft = Math.max(viewport.width - panel.width - MARGIN, MARGIN);
  const left = Math.min(Math.max(trigger.left, MARGIN), maxLeft);

  return { top, left, maxHeight };
}

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
}

/** Gap between the trigger and the panel, and the clamp margin from the viewport edge. */
const GAP = 8;
const MARGIN = 8;

/**
 * `position: fixed` geometry for a popover anchored to `trigger`: left-aligned
 * to it, just below; flips above when the space below is smaller than the
 * panel and the space above is larger. Clamped horizontally inside the
 * viewport with an 8px margin. No CSS anchor positioning (Firefox support is
 * incomplete) — this is the pure helper the popover's colocated hook calls on
 * `toggle` (newState `open`) and on `resize`/`scroll` while open.
 */
export function placePopover(trigger: DOMRectLike, panel: PopoverSize, viewport: ViewportSize): PopoverPosition {
  const spaceBelow = viewport.height - trigger.bottom;
  const spaceAbove = trigger.top;
  const opensUpward = spaceBelow < panel.height && spaceAbove > spaceBelow;
  const top = opensUpward ? trigger.top - panel.height - GAP : trigger.bottom + GAP;
  const maxLeft = Math.max(viewport.width - panel.width - MARGIN, MARGIN);
  const left = Math.min(Math.max(trigger.left, MARGIN), maxLeft);
  return { top, left };
}

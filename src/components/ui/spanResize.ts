/**
 * The store-free, DOM-free half of a span-resize gesture: how far the
 * pointer must travel before a press is a drag, where a dragged pointer
 * lands between a span's floor and its ceiling, and what a finished gesture
 * is allowed to do.
 *
 * Everything decidable lives here, and that is a testing requirement rather
 * than tidiness: this repository has no DOM and no testing-library, so a
 * decision embedded in a pointer handler has no coverage at all — and a
 * source-text assertion about a handler passes just as happily when the
 * guard sits on the wrong branch. `useSpanResize` is left with nothing but
 * listener plumbing.
 */

/**
 * How far the pointer must travel before the gesture counts as a drag.
 *
 * A grab strip covers the last few pixels of a span, so a slop is what keeps
 * the strip from swallowing the click that should have removed the thing
 * under it — without one, every span would carry a dead zone on its edge.
 */
export const SPAN_RESIZE_SLOP_PX = 4;

/**
 * One gesture, from pointer-down to teardown. Closed over by the handlers
 * that gesture attaches, never held in a shared ref: a second pointer-down
 * before the first gesture ended would overwrite it, after which the first
 * gesture's end handler would bail on the pointerId check and never remove
 * the listeners it added — one dead handler on window per orphaned gesture.
 */
export interface SpanResizeDrag<TIdentity> {
  /** What this gesture resizes, opaque to this module. */
  identity: TIdentity;
  /** Span length at pointer-down, in steps. */
  startLength: number;
  /** The longest this span may become, in steps. */
  maxLength: number;
  /** What the pointer moves over: one step per this many pixels. */
  pixelsPerStep: number;
  startX: number;
  pointerId: number;
  /** Set once the pointer has travelled past the slop. See spanResizeMoved. */
  moved: boolean;
}

export function spanResizeMoved(startX: number, clientX: number): boolean {
  return Math.abs(clientX - startX) >= SPAN_RESIZE_SLOP_PX;
}

/**
 * Where the pointer puts the end of the span: the start length plus the
 * whole steps travelled, rounded to the nearest step and clamped to
 * [1, maxLength].
 *
 * A span of zero steps cannot be drawn and cannot be grabbed again, so the
 * floor wins over a maxLength below it rather than allowing one.
 */
export function resizeLengthAtPointer(
  startLength: number,
  deltaPx: number,
  pixelsPerStep: number,
  maxLength: number,
): number {
  const raw = startLength + Math.round(deltaPx / pixelsPerStep);
  return Math.min(Math.max(1, maxLength), Math.max(1, raw));
}

/**
 * What a finished gesture does. A press on the handle that never became a
 * drag is a CLICK on the span, so the handle is not a hole in the behaviour
 * the rest of the span already has.
 */
export type SpanResizeOutcome<TIdentity> =
  | { kind: 'none' }
  | { kind: 'click'; identity: TIdentity }
  | { kind: 'resize'; identity: TIdentity; length: number };

/**
 * Only a real `pointerup` does anything. `pointercancel` means the PLATFORM
 * aborted the gesture — a touch-scroll takeover, another gesture interrupting
 * — not that the user released, so acting on it would silently rewrite a span
 * the user never chose to change.
 */
export function spanResizeOutcome<TIdentity>(
  drag: SpanResizeDrag<TIdentity> | null,
  eventType: string,
  clientX: number,
): SpanResizeOutcome<TIdentity> {
  if (!drag || eventType !== 'pointerup') return { kind: 'none' };
  if (!drag.moved) return { kind: 'click', identity: drag.identity };
  return {
    kind: 'resize',
    identity: drag.identity,
    length: resizeLengthAtPointer(
      drag.startLength,
      clientX - drag.startX,
      drag.pixelsPerStep,
      drag.maxLength,
    ),
  };
}

/** The live preview of one gesture: the span it grabbed, and its length. */
export interface SpanResizePreview<TIdentity> {
  identity: TIdentity;
  length: number;
}

/**
 * Whether a freshly computed preview is the one already on screen.
 *
 * A pointermove fires per frame, but a preview only CHANGES once the pointer
 * has crossed a whole step — at 20px, most moves of a gesture resolve to the
 * length already drawn. Returning the previous object for those keeps the
 * state from bumping, which is what keeps everything derived from the
 * preview memoized and un-re-rendered.
 *
 * Identity is compared BY REFERENCE on purpose: this runs once per
 * pointermove, and a structural compare would walk the feature's identity on
 * every frame. Callers hand back the object they started the gesture with.
 */
export function spanPreviewUnchanged<TIdentity>(
  prev: SpanResizePreview<TIdentity> | null,
  next: SpanResizePreview<TIdentity>,
): boolean {
  return prev !== null && prev.length === next.length && prev.identity === next.identity;
}

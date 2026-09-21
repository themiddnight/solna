import { useCallback, useState } from 'react';
import type React from 'react';
import {
  resizeLengthAtPointer,
  spanPreviewUnchanged,
  spanResizeMoved,
  spanResizeOutcome,
  type SpanResizeDrag,
  type SpanResizePreview,
} from './spanResize';

/**
 * Everything a feature must supply to start a resize. The identity is the
 * feature's own addressing of the thing being resized — a note, a step, a
 * pattern — and this module never looks inside it.
 */
export interface SpanResizeStart<TIdentity> {
  identity: TIdentity;
  /** Span length at pointer-down, in steps. */
  startLength: number;
  /** The longest this span may become, in steps. */
  maxLength: number;
  /** What the pointer moves over: one step per this many pixels. */
  pixelsPerStep: number;
  /** A moved pointerup: write the new length, in steps. */
  onCommit: (identity: TIdentity, length: number) => void;
  /** An unmoved pointerup: the press was a click on the span itself. */
  onClick: (identity: TIdentity) => void;
}

/**
 * The pointer plumbing for a span resize, with no idea what a span IS: no
 * store slice, no audio, no knowledge of the feature that called it. The
 * arithmetic is resizeLengthAtPointer's and the ruling at the end of a
 * gesture is spanResizeOutcome's, both in spanResize.ts where they are
 * testable; what is left here cannot be decided without a DOM.
 *
 * The preview length lives in LOCAL state and reaches a store exactly ONCE,
 * through onCommit. That is required by ADR-0012, not a preference: every
 * tab view stays mounted, so a store write per pointermove would re-render
 * every view and re-serialise the persisted slice on every frame.
 */
export function useSpanResize<TIdentity>(): {
  /** This gesture's length in steps for `identity`, or null if it is not the
   * one being dragged. Compared by reference — pass the object you started
   * the gesture with, not a fresh one per render. */
  previewFor: (identity: TIdentity) => number | null;
  startResize: (event: React.PointerEvent<HTMLElement>, input: SpanResizeStart<TIdentity>) => void;
} {
  const [preview, setPreview] = useState<SpanResizePreview<TIdentity> | null>(null);

  const previewFor = useCallback(
    (identity: TIdentity): number | null =>
      preview !== null && preview.identity === identity ? preview.length : null,
    [preview],
  );

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLElement>, input: SpanResizeStart<TIdentity>): void => {
      // Never let the gesture reach the element's own click handling, or the
      // drag would toggle off the very thing it started on.
      event.stopPropagation();
      event.preventDefault();
      // Each gesture owns its OWN drag object — no shared ref. See
      // SpanResizeDrag for what a shared one cost.
      const drag: SpanResizeDrag<TIdentity> = {
        identity: input.identity,
        startLength: input.startLength,
        maxLength: input.maxLength,
        pixelsPerStep: input.pixelsPerStep,
        startX: event.clientX,
        pointerId: event.pointerId,
        moved: false,
      };
      setPreview({ identity: drag.identity, length: drag.startLength });

      const onMove = (ev: PointerEvent): void => {
        if (ev.pointerId !== drag.pointerId) return;
        // Sticky: a gesture that has travelled stays a drag even if it comes
        // back to where it started, so a wobble out and back is not a click.
        if (!drag.moved && spanResizeMoved(drag.startX, ev.clientX)) drag.moved = true;
        const next: SpanResizePreview<TIdentity> = {
          identity: drag.identity,
          length: resizeLengthAtPointer(
            drag.startLength,
            ev.clientX - drag.startX,
            drag.pixelsPerStep,
            drag.maxLength,
          ),
        };
        // Bail out INSIDE the updater: a new object every move would bump the
        // state on every frame, and the view would re-render for moves that
        // resolve to the very same step-quantised length.
        setPreview((prev) => (spanPreviewUnchanged(prev, next) ? prev : next));
      };
      const detach = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        setPreview(null);
      };
      const onEnd = (ev: PointerEvent): void => {
        if (ev.pointerId !== drag.pointerId) return;
        detach();
        // Whether this gesture commits — and what it commits — is
        // spanResizeOutcome's decision, so it can be tested for real.
        const outcome = spanResizeOutcome(drag, ev.type, ev.clientX);
        if (outcome.kind === 'resize') {
          input.onCommit(outcome.identity, outcome.length);
        } else if (outcome.kind === 'click') {
          input.onClick(outcome.identity);
        }
      };
      // WINDOW, not the grabbed handle, and no setPointerCapture. A handle
      // that sits at the END of a span is relocated by the first preview
      // growth: React unmounts the very element the gesture started on,
      // taking a pointer capture and its listeners with it, and the drag then
      // dies after one step with nothing committed. Listening on window is
      // immune to the handle unmounting; pointerId keeps a second touch from
      // steering someone else's drag.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [],
  );

  return { previewFor, startResize };
}

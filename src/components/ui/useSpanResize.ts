import { useCallback, useRef, useState } from 'react';
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
 * What a resize reads to start. A React pointer event qualifies (Chord/Bass
 * and the Lead handle pass theirs, and get propagation and default stopped);
 * so does a plain object, which is how a touch long-press starts a resize
 * after its pointerdown has long passed.
 */
export interface SpanResizePointer {
  pointerId: number;
  clientX: number;
  stopPropagation?: () => void;
  preventDefault?: () => void;
}

/** The fields a session reads off a window pointer event. */
interface SpanResizePointerEvent extends Event {
  pointerId: number;
  clientX: number;
}

/** `window` in the app; a bare EventTarget in tests. */
type SpanResizeTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * One resize gesture's listeners, with no React in it — the hook below is a
 * wrapper, and this is the part a test can drive with a plain EventTarget.
 * `cancel` detaches and clears the preview without committing: a gesture the
 * caller abandons writes nothing, exactly as a pointercancel (R125).
 */
export function openSpanResizeSession<TIdentity>(
  pointer: SpanResizePointer,
  input: SpanResizeStart<TIdentity>,
  setPreview: React.Dispatch<React.SetStateAction<SpanResizePreview<TIdentity> | null>>,
  target: SpanResizeTarget,
): { cancel: () => void } {
  // Never let the gesture reach the element's own click handling, or the
  // drag would toggle off the very thing it started on.
  pointer.stopPropagation?.();
  pointer.preventDefault?.();
  const drag: SpanResizeDrag<TIdentity> = {
    identity: input.identity,
    startLength: input.startLength,
    maxLength: input.maxLength,
    pixelsPerStep: input.pixelsPerStep,
    startX: pointer.clientX,
    pointerId: pointer.pointerId,
    moved: false,
  };
  setPreview({ identity: drag.identity, length: drag.startLength });

  const onMove = (event: Event): void => {
    const ev = event as SpanResizePointerEvent;
    if (ev.pointerId !== drag.pointerId) return;
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
    setPreview((prev) => (spanPreviewUnchanged(prev, next) ? prev : next));
  };
  const detach = (): void => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onEnd);
    target.removeEventListener('pointercancel', onEnd);
    setPreview(null);
  };
  const onEnd = (event: Event): void => {
    const ev = event as SpanResizePointerEvent;
    if (ev.pointerId !== drag.pointerId) return;
    detach();
    const outcome = spanResizeOutcome(drag, ev.type, ev.clientX);
    if (outcome.kind === 'resize') {
      input.onCommit(outcome.identity, outcome.length);
    } else if (outcome.kind === 'click') {
      input.onClick(outcome.identity);
    }
  };
  // WINDOW, not the grabbed handle, and no setPointerCapture. A handle that
  // sits at the END of a span is relocated by the first preview growth:
  // React unmounts the element the gesture started on, taking a pointer
  // capture and its listeners with it. Listening on window is immune to
  // that; pointerId keeps a second touch from steering someone else's drag.
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onEnd);
  target.addEventListener('pointercancel', onEnd);
  return { cancel: detach };
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
  startResize: (pointer: SpanResizePointer, input: SpanResizeStart<TIdentity>) => void;
  /** Abandon the live gesture: no commit, preview cleared. */
  cancel: () => void;
} {
  const [preview, setPreview] = useState<SpanResizePreview<TIdentity> | null>(null);
  const sessionRef = useRef<{ cancel: () => void } | null>(null);

  const previewFor = useCallback(
    (identity: TIdentity): number | null =>
      preview !== null && preview.identity === identity ? preview.length : null,
    [preview],
  );

  const startResize = useCallback(
    (pointer: SpanResizePointer, input: SpanResizeStart<TIdentity>): void => {
      sessionRef.current = openSpanResizeSession(pointer, input, setPreview, window);
    },
    [],
  );

  const cancel = useCallback((): void => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
  }, []);

  return { previewFor, startResize, cancel };
}

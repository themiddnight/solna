import { describe, expect, test } from 'bun:test';
import {
  SPAN_RESIZE_SLOP_PX,
  resizeLengthAtPointer,
  spanPreviewUnchanged,
  spanResizeMoved,
  spanResizeOutcome,
  type SpanResizeDrag,
} from './spanResize';

/**
 * A drag on a 2-step span with room to grow to 8, at 20px per step — the
 * Lead shape this was extracted from, with the identity left opaque (a
 * string here) because the shared module never looks inside it.
 */
const drag: SpanResizeDrag<string> = {
  identity: 'C4:4',
  startLength: 2,
  maxLength: 8,
  pixelsPerStep: 20,
  startX: 100,
  pointerId: 1,
  moved: true,
};

/** The same gesture, released without ever travelling past the slop. */
const press: SpanResizeDrag<string> = { ...drag, moved: false };

/** An identity that is an object, the way Lead addresses a note. */
interface NoteIdentity {
  stepIndex: number;
  note: string;
}

const noteDrag: SpanResizeDrag<NoteIdentity> = {
  identity: { stepIndex: 4, note: 'C4' },
  startLength: 2,
  maxLength: 8,
  pixelsPerStep: 20,
  startX: 100,
  pointerId: 1,
  moved: true,
};

describe('spanResizeMoved', () => {
  test('a press only becomes a drag once it travels past the slop', () => {
    expect(spanResizeMoved(100, 100 + SPAN_RESIZE_SLOP_PX - 1)).toBe(false);
    expect(spanResizeMoved(100, 100 + SPAN_RESIZE_SLOP_PX)).toBe(true);
    expect(spanResizeMoved(100, 100 - SPAN_RESIZE_SLOP_PX)).toBe(true);
  });

  test('the slop is sticky-agnostic — it only ever asks about one move', () => {
    // Whether a gesture HAS moved stays on the drag record; this predicate
    // answers about a single pointer position and nothing else, so a wobble
    // back to the start is the caller's `moved` flag to keep, not this.
    expect(spanResizeMoved(100, 100)).toBe(false);
  });
});

describe('resizeLengthAtPointer', () => {
  test('a full step of travel is a full step of length', () => {
    expect(resizeLengthAtPointer(2, 19, 10, 4)).toBe(4);
    expect(resizeLengthAtPointer(1, 0, 20, 16)).toBe(1);
    expect(resizeLengthAtPointer(1, 10, 20, 16)).toBe(2);
    expect(resizeLengthAtPointer(1, 31, 20, 16)).toBe(3);
  });

  test('fractional travel rounds to the nearest step', () => {
    expect(resizeLengthAtPointer(1, 9, 20, 16)).toBe(1);
    expect(resizeLengthAtPointer(2, 10, 20, 8)).toBe(3);
    expect(resizeLengthAtPointer(2, 9, 20, 8)).toBe(2);
  });

  test('a span never shrinks below one step, however far left the pointer goes', () => {
    expect(resizeLengthAtPointer(2, -21, 20, 16)).toBe(1);
    expect(resizeLengthAtPointer(3, -400, 20, 16)).toBe(1);
  });

  test('a span never grows past maxLength, however far right the pointer goes', () => {
    expect(resizeLengthAtPointer(3, 4000, 20, 16)).toBe(16);
    expect(resizeLengthAtPointer(1, 100, 20, 2)).toBe(2);
  });

  test('the floor wins over a maxLength below it, so a length is never zero', () => {
    // A zero-length span cannot be drawn and cannot be clicked, so an
    // unusable max is clamped up rather than allowed to produce one.
    expect(resizeLengthAtPointer(1, 100, 20, 0)).toBe(1);
    expect(resizeLengthAtPointer(1, -100, 20, -5)).toBe(1);
  });
});

describe('spanResizeOutcome', () => {
  test('a pointerup resizes the span the drag started on, at the dragged length', () => {
    expect(spanResizeOutcome(drag, 'pointerup', 100 + 3 * 20)).toEqual({
      kind: 'resize',
      identity: 'C4:4',
      length: 5,
    });
  });

  test('a pointercancel does NOTHING — the platform aborted, the user did not release', () => {
    expect(spanResizeOutcome(drag, 'pointercancel', 140)).toEqual({ kind: 'none' });
  });

  test('a press that never moved is a CLICK, so the handle is not a dead zone', () => {
    expect(spanResizeOutcome(press, 'pointerup', 101)).toEqual({ kind: 'click', identity: 'C4:4' });
  });

  test('an already-torn-down drag does nothing, whatever the event says', () => {
    expect(spanResizeOutcome(null, 'pointerup', 999)).toEqual({ kind: 'none' });
  });

  test('anything that is not a terminal pointerup does nothing', () => {
    // Only pointerup ends a gesture. A pointermove that somehow reached the
    // end handler must not be read as a release.
    expect(spanResizeOutcome(drag, 'pointermove', 140)).toEqual({ kind: 'none' });
    expect(spanResizeOutcome(press, 'pointerdown', 100)).toEqual({ kind: 'none' });
  });

  test('the resized length goes through resizeLengthAtPointer, so both clamps apply', () => {
    expect(spanResizeOutcome(drag, 'pointerup', 100 - 40 * 20)).toEqual({
      kind: 'resize',
      identity: 'C4:4',
      length: 1,
    });
    expect(spanResizeOutcome(drag, 'pointerup', 100 + 40 * 20)).toEqual({
      kind: 'resize',
      identity: 'C4:4',
      length: 8,
    });
  });

  test('the identity comes back UNTOUCHED, whatever shape the feature gave it', () => {
    expect(spanResizeOutcome(noteDrag, 'pointerup', 100 + 1 * 20)).toEqual({
      kind: 'resize',
      identity: { stepIndex: 4, note: 'C4' },
      length: 3,
    });
    expect(spanResizeOutcome({ ...noteDrag, moved: false }, 'pointerup', 100)).toEqual({
      kind: 'click',
      identity: { stepIndex: 4, note: 'C4' },
    });
  });
});

describe('spanPreviewUnchanged', () => {
  const preview = { identity: 'C4:4', length: 6 };

  test('the very first preview of a gesture always counts as a change', () => {
    expect(spanPreviewUnchanged(null, preview)).toBe(false);
  });

  test('the same length on the same identity is not a change', () => {
    expect(spanPreviewUnchanged(preview, { ...preview })).toBe(true);
  });

  test('either field moving is a change', () => {
    expect(spanPreviewUnchanged(preview, { ...preview, length: 8 })).toBe(false);
    expect(spanPreviewUnchanged(preview, { ...preview, identity: 'C4:5' })).toBe(false);
  });

  test('identity is compared by reference, so a per-render object is never "the same"', () => {
    // The hook pays one comparison per pointermove; a structural compare
    // would walk the feature's identity on every frame. Callers therefore
    // hand back the object they started the gesture with.
    expect(spanPreviewUnchanged({ identity: { a: 1 }, length: 6 }, { identity: { a: 1 }, length: 6 })).toBe(false);
  });
});

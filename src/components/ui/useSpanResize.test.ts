import { describe, expect, test } from 'bun:test';
import type React from 'react';
import type { SpanResizePreview } from './spanResize';
import { openSpanResizeSession, type SpanResizeStart } from './useSpanResize';

type Preview = SpanResizePreview<string> | null;

function previewBox(): { set: React.Dispatch<React.SetStateAction<Preview>>; get: () => Preview } {
  let value: Preview = null;
  return {
    set: (next) => {
      value = typeof next === 'function' ? next(value) : next;
    },
    get: () => value,
  };
}

/** A pointer event as the session reads it: a real Event with the two fields added. */
const pointerEvent = (type: string, pointerId: number, clientX: number): Event =>
  Object.assign(new Event(type), { pointerId, clientX });

function rig() {
  const target = new EventTarget();
  const preview = previewBox();
  const commits: Array<[string, number]> = [];
  const clicks: string[] = [];
  const input: SpanResizeStart<string> = {
    identity: 'C4:0',
    startLength: 2,
    maxLength: 8,
    pixelsPerStep: 28,
    onCommit: (id, length) => {
      commits.push([id, length]);
    },
    onClick: (id) => {
      clicks.push(id);
    },
  };
  return { target, preview, commits, clicks, input };
}

describe('openSpanResizeSession', () => {
  test('a React-event start stops propagation and default, as the Chord/Bass handles rely on', () => {
    const { target, preview, input } = rig();
    let stopped = 0;
    let prevented = 0;
    openSpanResizeSession(
      {
        pointerId: 1,
        clientX: 100,
        stopPropagation: () => {
          stopped += 1;
        },
        preventDefault: () => {
          prevented += 1;
        },
      },
      input,
      preview.set,
      target,
    );
    expect([stopped, prevented]).toEqual([1, 1]);
  });

  test('a plain-object start (the touch long-press) works without either', () => {
    const { target, preview, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    expect(preview.get()).toEqual({ identity: 'C4:0', length: 2 });
  });

  test('a moved pointerup commits once, at the step-quantised length', () => {
    const { target, preview, commits, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointermove', 1, 156));
    expect(preview.get()?.length).toBe(4);
    target.dispatchEvent(pointerEvent('pointerup', 1, 156));
    expect(commits).toEqual([['C4:0', 4]]);
    expect(preview.get()).toBeNull();
  });

  test('pointercancel commits nothing and clears the preview (R125)', () => {
    const { target, preview, commits, clicks, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointermove', 1, 156));
    target.dispatchEvent(pointerEvent('pointercancel', 1, 156));
    expect(commits).toEqual([]);
    expect(clicks).toEqual([]);
    expect(preview.get()).toBeNull();
  });

  test('cancel() detaches: a later pointerup commits nothing', () => {
    const { target, preview, commits, input } = rig();
    const session = openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointermove', 1, 156));
    session.cancel();
    target.dispatchEvent(pointerEvent('pointerup', 1, 156));
    expect(commits).toEqual([]);
    expect(preview.get()).toBeNull();
  });

  test("another pointer's release does not end the drag", () => {
    const { target, preview, commits, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointerup', 2, 300));
    expect(commits).toEqual([]);
    expect(preview.get()).not.toBeNull();
  });

  test('an unmoved pointerup is a click on the span', () => {
    const { target, preview, clicks, input } = rig();
    openSpanResizeSession({ pointerId: 1, clientX: 100 }, input, preview.set, target);
    target.dispatchEvent(pointerEvent('pointerup', 1, 102));
    expect(clicks).toEqual(['C4:0']);
  });
});

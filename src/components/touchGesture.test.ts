import { describe, expect, test } from 'bun:test';
import {
  TOUCH_LONG_PRESS_MS,
  TOUCH_SLOP_PX,
  touchGestureReduce,
  touchGestureStart,
  type TouchGestureEvent,
  type TouchGestureState,
} from './touchGesture';

const DOWN_AT = 1000;
const start = (): TouchGestureState => touchGestureStart(DOWN_AT, 100, 100);
const move = (dt: number, dx: number, dy = 0): TouchGestureEvent => ({
  type: 'move',
  t: DOWN_AT + dt,
  x: 100 + dx,
  y: 100 + dy,
});
const up = (dt: number, dx = 0, dy = 0): TouchGestureEvent => ({
  type: 'up',
  t: DOWN_AT + dt,
  x: 100 + dx,
  y: 100 + dy,
});

describe('touchGestureReduce — the gesture table', () => {
  test('the thresholds are the agreed 300ms and 8px', () => {
    expect(TOUCH_LONG_PRESS_MS).toBe(300);
    expect(TOUCH_SLOP_PX).toBe(8);
  });

  test('a lift before the hold, inside the slop, is a tap', () => {
    expect(touchGestureReduce(start(), up(299, 7)).phase).toBe('tap');
  });

  test('a lift at exactly the hold is a long-press, never a tap', () => {
    expect(touchGestureReduce(start(), up(300)).phase).toBe('long-press');
    expect(touchGestureReduce(start(), up(301)).phase).toBe('long-press');
  });

  test('the timer turns a still finger into a long-press', () => {
    expect(touchGestureReduce(start(), { type: 'timer' }).phase).toBe('long-press');
  });

  test('moving 8px before the hold is a scroll; 7px is still pending', () => {
    expect(touchGestureReduce(start(), move(50, 8)).phase).toBe('scroll');
    expect(touchGestureReduce(start(), move(50, 7)).phase).toBe('pending');
    expect(touchGestureReduce(start(), move(50, 0, -8)).phase).toBe('scroll');
  });

  test('the slop is a distance, not per axis', () => {
    // 6px right and 6px down is 8.49px from the down point.
    expect(touchGestureReduce(start(), move(50, 6, 6)).phase).toBe('scroll');
    // 5px and 5px is 7.07px.
    expect(touchGestureReduce(start(), move(50, 5, 5)).phase).toBe('pending');
  });

  test('a lift after moving past the slop, before the hold, is a scroll, not a tap', () => {
    expect(touchGestureReduce(start(), up(120, 12)).phase).toBe('scroll');
  });

  test('a move once the hold is due counts as the hold, whatever its distance', () => {
    // The gesture is only still pending because it stayed inside the slop
    // until now; a late timer must not turn a hold into a scroll.
    expect(touchGestureReduce(start(), move(301, 40)).phase).toBe('long-press');
  });

  test('cancel from pending is cancelled', () => {
    expect(touchGestureReduce(start(), { type: 'cancel' }).phase).toBe('cancelled');
  });
});

describe('touchGestureReduce — every verdict is final', () => {
  const verdicts: TouchGestureEvent[] = [up(100), { type: 'timer' }, move(50, 20), { type: 'cancel' }];
  for (const verdict of verdicts) {
    test(`after ${verdict.type}, no later event changes the state`, () => {
      const settled = touchGestureReduce(start(), verdict);
      for (const later of [move(400, 0), up(500), { type: 'timer' } as const, { type: 'cancel' } as const]) {
        expect(touchGestureReduce(settled, later)).toBe(settled);
      }
    });
  }
});

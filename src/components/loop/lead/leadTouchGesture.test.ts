import { describe, expect, test } from 'bun:test';
import {
  LEAD_LONG_PRESS_MS,
  LEAD_TOUCH_SLOP_PX,
  leadTouchReduce,
  leadTouchStart,
  type LeadTouchEvent,
  type LeadTouchState,
} from './leadTouchGesture';

const DOWN_AT = 1000;
const start = (): LeadTouchState => leadTouchStart(DOWN_AT, 100, 100);
const move = (dt: number, dx: number, dy = 0): LeadTouchEvent => ({
  type: 'move',
  t: DOWN_AT + dt,
  x: 100 + dx,
  y: 100 + dy,
});
const up = (dt: number, dx = 0, dy = 0): LeadTouchEvent => ({
  type: 'up',
  t: DOWN_AT + dt,
  x: 100 + dx,
  y: 100 + dy,
});

describe('leadTouchReduce — the gesture table', () => {
  test('the thresholds are the agreed 300ms and 8px', () => {
    expect(LEAD_LONG_PRESS_MS).toBe(300);
    expect(LEAD_TOUCH_SLOP_PX).toBe(8);
  });

  test('a lift before the hold, inside the slop, is a tap', () => {
    expect(leadTouchReduce(start(), up(299, 7)).phase).toBe('tap');
  });

  test('a lift at exactly the hold is a long-press, never a tap', () => {
    expect(leadTouchReduce(start(), up(300)).phase).toBe('long-press');
    expect(leadTouchReduce(start(), up(301)).phase).toBe('long-press');
  });

  test('the timer turns a still finger into a long-press', () => {
    expect(leadTouchReduce(start(), { type: 'timer' }).phase).toBe('long-press');
  });

  test('moving 8px before the hold is a scroll; 7px is still pending', () => {
    expect(leadTouchReduce(start(), move(50, 8)).phase).toBe('scroll');
    expect(leadTouchReduce(start(), move(50, 7)).phase).toBe('pending');
    expect(leadTouchReduce(start(), move(50, 0, -8)).phase).toBe('scroll');
  });

  test('the slop is a distance, not per axis', () => {
    // 6px right and 6px down is 8.49px from the down point.
    expect(leadTouchReduce(start(), move(50, 6, 6)).phase).toBe('scroll');
    // 5px and 5px is 7.07px.
    expect(leadTouchReduce(start(), move(50, 5, 5)).phase).toBe('pending');
  });

  test('a lift after moving past the slop, before the hold, is a scroll, not a tap', () => {
    expect(leadTouchReduce(start(), up(120, 12)).phase).toBe('scroll');
  });

  test('a move once the hold is due counts as the hold, whatever its distance', () => {
    // The gesture is only still pending because it stayed inside the slop
    // until now; a late timer must not turn a hold into a scroll.
    expect(leadTouchReduce(start(), move(301, 40)).phase).toBe('long-press');
  });

  test('cancel from pending is cancelled', () => {
    expect(leadTouchReduce(start(), { type: 'cancel' }).phase).toBe('cancelled');
  });
});

describe('leadTouchReduce — every verdict is final', () => {
  const verdicts: LeadTouchEvent[] = [up(100), { type: 'timer' }, move(50, 20), { type: 'cancel' }];
  for (const verdict of verdicts) {
    test(`after ${verdict.type}, no later event changes the state`, () => {
      const settled = leadTouchReduce(start(), verdict);
      for (const later of [move(400, 0), up(500), { type: 'timer' } as const, { type: 'cancel' } as const]) {
        expect(leadTouchReduce(settled, later)).toBe(settled);
      }
    });
  }
});

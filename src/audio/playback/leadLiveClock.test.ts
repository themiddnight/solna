import { describe, expect, test } from 'bun:test';
import { startLeadLiveClockWith } from './leadLiveClock';

/**
 * Task 3 shipped `startLeadLiveClock` closing over a module-level clock
 * singleton with no guard: a second call before the first disposer ran added
 * a second listener to the shared clock and leaked the first subscription
 * forever. These tests pin the fix down without an AudioContext, using a
 * fake subscribe function shaped like subscribePlaybackClock.
 */
describe('startLeadLiveClockWith — double-start guard', () => {
  test('a second start while one is live adds no second subscription', () => {
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    const subscribe = (): (() => void) => {
      subscribeCalls++;
      return () => {
        unsubscribeCalls++;
      };
    };

    const stopFirst = startLeadLiveClockWith(subscribe);
    const stopSecond = startLeadLiveClockWith(subscribe);

    expect(subscribeCalls).toBe(1);

    // The second disposer is an inert no-op: it must not tear down the one
    // real subscription started by the first call.
    stopSecond();
    expect(unsubscribeCalls).toBe(0);

    stopFirst();
    expect(unsubscribeCalls).toBe(1);
  });

  test('the first disposer still tears the subscription down cleanly', () => {
    let unsubscribeCalls = 0;
    const subscribe = (): (() => void) => {
      return () => {
        unsubscribeCalls++;
      };
    };

    const stop = startLeadLiveClockWith(subscribe);
    stop();
    expect(unsubscribeCalls).toBe(1);

    // Calling it again must not double-tear-down.
    stop();
    expect(unsubscribeCalls).toBe(1);
  });

  test('once stopped, a fresh start subscribes again', () => {
    let subscribeCalls = 0;
    const subscribe = (): (() => void) => {
      subscribeCalls++;
      return () => {};
    };

    const stopFirst = startLeadLiveClockWith(subscribe);
    stopFirst();
    const stopSecond = startLeadLiveClockWith(subscribe);

    expect(subscribeCalls).toBe(2);

    // Leaving this one live would leak `activeStop` for the rest of the
    // process — exactly the leak this guard exists to prevent — and would
    // silently turn the next real startLeadLiveClock() call into a no-op.
    stopSecond();
  });
});

import { describe, expect, test } from 'bun:test';
import { create } from 'zustand';
import { createFeedbackSlice, type FeedbackSchedule, type FeedbackSlice } from './feedbackSlice';
import type { FeedbackRequest } from './feedback';

/** A scheduler the test drives by hand: every armed timer, and whether it was cancelled. */
function fakeScheduler() {
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule: FeedbackSchedule = (fn, ms) => {
    const timer = { fn, ms, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  };
  const live = () => timers.filter((t) => !t.cancelled);
  /** Fires one timer the way a real clock would: once, and only if not cancelled. */
  const fire = (timer: (typeof timers)[number]) => {
    if (timer.cancelled) return;
    timer.cancelled = true;
    timer.fn();
  };
  return { timers, schedule, live, fire };
}

function makeSlice() {
  const clock = fakeScheduler();
  const store = create<FeedbackSlice>()((set, get) => createFeedbackSlice(set, get, { schedule: clock.schedule }));
  return { clock, store, state: () => store.getState() };
}

const toast = (key: string, message = key): FeedbackRequest => ({ key, message, tone: 'success' });

describe('the feedback slice', () => {
  test('starts empty and unheld', () => {
    const { state } = makeSlice();
    expect(state().feedback).toEqual([]);
    expect(state().feedbackHolds).toBe(0);
  });

  test('an entry expires after its duration', () => {
    const { clock, state } = makeSlice();
    state().showFeedback(toast('vibe'));
    expect(state().feedback.map((e) => e.key)).toEqual(['vibe']);
    expect(clock.live().map((t) => t.ms)).toEqual([3000]);
    clock.fire(clock.live()[0]);
    expect(state().feedback).toEqual([]);
  });

  test('a replacement cancels the old timer, and the old timer cannot remove it', () => {
    const { clock, state } = makeSlice();
    state().showFeedback(toast('vibe', 'loaded'));
    const first = clock.timers[0];
    state().showFeedback(toast('vibe', 'rerolled'));
    expect(first.cancelled).toBe(true);
    // Even a timer that fires regardless (a real clock racing the cancel) is a no-op.
    first.fn();
    expect(state().feedback.map((e) => e.message)).toEqual(['rerolled']);
    clock.fire(clock.live()[0]);
    expect(state().feedback).toEqual([]);
  });

  test('an entry pushed past the limit leaves with its timer', () => {
    const { clock, state } = makeSlice();
    for (const key of ['a', 'b', 'c', 'd']) state().showFeedback(toast(key));
    expect(state().feedback.map((e) => e.key)).toEqual(['b', 'c', 'd']);
    expect(clock.timers[0].cancelled).toBe(true);
    expect(clock.live()).toHaveLength(3);
  });

  test('dismiss removes the entry and cancels its timer', () => {
    const { clock, state } = makeSlice();
    state().showFeedback(toast('synth-preset'));
    state().dismissFeedback('synth-preset');
    expect(state().feedback).toEqual([]);
    expect(clock.live()).toHaveLength(0);
  });

  test('a snackbar action runs, then its entry is dismissed', () => {
    const { clock, state } = makeSlice();
    const order: string[] = [];
    state().showFeedback({
      key: 'loop-delete',
      message: 'Deleted loop',
      tone: 'info',
      action: {
        id: 'btn-undo-loop-delete',
        label: 'Undo',
        run: () => order.push(`run with ${state().feedback.length} showing`),
      },
    });
    expect(clock.live().map((t) => t.ms)).toEqual([5000]);
    state().runFeedbackAction('loop-delete');
    expect(order).toEqual(['run with 1 showing']);
    expect(state().feedback).toEqual([]);
    expect(clock.live()).toHaveLength(0);
  });

  test('an action that raises a message under its own key keeps it', () => {
    const { clock, state } = makeSlice();
    state().showFeedback({
      key: 'k',
      message: 'first',
      tone: 'info',
      action: { id: 'btn-x', label: 'X', run: () => state().showFeedback(toast('k', 'second')) },
    });
    state().runFeedbackAction('k');
    expect(state().feedback.map((e) => e.message)).toEqual(['second']);
    expect(clock.live()).toHaveLength(1);
  });
});

describe('a dialog hold', () => {
  test('no timer is armed while a dialog holds', () => {
    const { clock, state } = makeSlice();
    const release = state().holdFeedback();
    expect(state().feedbackHolds).toBe(1);
    state().showFeedback(toast('drive'));
    expect(clock.live()).toHaveLength(0);
    expect(state().feedback.map((e) => e.key)).toEqual(['drive']);
    release();
  });

  test('a hold pauses timers already running', () => {
    const { clock, state } = makeSlice();
    state().showFeedback(toast('vibe'));
    const release = state().holdFeedback();
    expect(clock.live()).toHaveLength(0);
    expect(state().feedback).toHaveLength(1);
    release();
  });

  test('the last release arms a fresh full-duration timer for every queued entry', () => {
    const { clock, state } = makeSlice();
    const outer = state().holdFeedback();
    const inner = state().holdFeedback();
    state().showFeedback(toast('a'));
    state().showFeedback({ key: 'b', message: 'failed', tone: 'error' });
    inner();
    expect(clock.live()).toHaveLength(0);
    outer();
    expect(state().feedbackHolds).toBe(0);
    expect(clock.live().map((t) => t.ms)).toEqual([3000, 8000]);
    for (const t of clock.live()) clock.fire(t);
    expect(state().feedback).toEqual([]);
  });

  test('a double release is a no-op', () => {
    const { clock, state } = makeSlice();
    const first = state().holdFeedback();
    const second = state().holdFeedback();
    state().showFeedback(toast('a'));
    first();
    first();
    expect(state().feedbackHolds).toBe(1);
    expect(clock.live()).toHaveLength(0);
    second();
    expect(state().feedbackHolds).toBe(0);
    expect(clock.live()).toHaveLength(1);
  });
});

describe('feedback is session state', () => {
  test('it is absent from the persisted shape', async () => {
    const { partializeAppState, useAppStore } = await import('./store');
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('feedback' in persisted).toBe(false);
    expect('feedbackHolds' in persisted).toBe(false);
  });
});

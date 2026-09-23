import { describe, expect, test } from 'bun:test';
import { enqueueFeedback, feedbackDurationMs, removeFeedback, type FeedbackEntry } from './feedback';

const entry = (key: string, seq: number, extra: Partial<FeedbackEntry> = {}): FeedbackEntry => ({
  key,
  seq,
  message: `${key} #${seq}`,
  tone: 'success',
  ...extra,
});

describe('enqueueFeedback', () => {
  test('appends the newest last', () => {
    const list = enqueueFeedback(enqueueFeedback([], entry('a', 1)), entry('b', 2));
    expect(list.map((e) => e.key)).toEqual(['a', 'b']);
  });

  test('the same key replaces, and the replacement becomes the newest', () => {
    let list = enqueueFeedback([], entry('vibe', 1));
    list = enqueueFeedback(list, entry('synth-preset', 2));
    list = enqueueFeedback(list, entry('vibe', 3, { message: 'rerolled' }));
    expect(list.map((e) => [e.key, e.seq])).toEqual([['synth-preset', 2], ['vibe', 3]]);
    expect(list[1].message).toBe('rerolled');
  });

  test('keeps three by default; the oldest drops', () => {
    let list: readonly FeedbackEntry[] = [];
    for (const [i, key] of ['a', 'b', 'c', 'd'].entries()) list = enqueueFeedback(list, entry(key, i));
    expect(list.map((e) => e.key)).toEqual(['b', 'c', 'd']);
  });

  test('honours an explicit limit', () => {
    const list = enqueueFeedback([entry('a', 1)], entry('b', 2), 1);
    expect(list.map((e) => e.key)).toEqual(['b']);
  });
});

describe('removeFeedback', () => {
  test('removes by key when no seq is given', () => {
    expect(removeFeedback([entry('a', 1), entry('b', 2)], 'a').map((e) => e.key)).toEqual(['b']);
  });

  test('a stale seq removes nothing — the replacement survives an old timer', () => {
    const list = [entry('a', 5)];
    expect(removeFeedback(list, 'a', 4)).toBe(list);
  });

  test('the matching seq removes', () => {
    expect(removeFeedback([entry('a', 5)], 'a', 5)).toEqual([]);
  });

  test('returns the same list when nothing matched', () => {
    const list = [entry('a', 1)];
    expect(removeFeedback(list, 'zzz')).toBe(list);
  });
});

describe('feedbackDurationMs', () => {
  const action = { id: 'btn-undo', label: 'Undo', run: () => {} };

  test('a toast 3 s, an error toast 8 s, a snackbar 5 s', () => {
    expect(feedbackDurationMs({ key: 'k', message: 'm', tone: 'success' })).toBe(3000);
    expect(feedbackDurationMs({ key: 'k', message: 'm', tone: 'info' })).toBe(3000);
    expect(feedbackDurationMs({ key: 'k', message: 'm', tone: 'error' })).toBe(8000);
    expect(feedbackDurationMs({ key: 'k', message: 'm', tone: 'info', action })).toBe(5000);
  });

  test('an explicit duration wins', () => {
    expect(feedbackDurationMs({ key: 'k', message: 'm', tone: 'error', durationMs: 1200 })).toBe(1200);
  });
});

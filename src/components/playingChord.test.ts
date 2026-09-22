import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createPlayingChordPublisher, playingChord, usePlayingChord } from './playingChord';

describe('playing chord publisher', () => {
  test('get returns what set recorded, and starts empty', () => {
    const p = createPlayingChordPublisher();
    expect(p.get()).toBeNull();
    p.set({ index: 2, chordId: 'c-2' });
    expect(p.get()).toEqual({ index: 2, chordId: 'c-2' });
  });

  test('notifies once per change, and a same-content chord is a no-op', () => {
    const p = createPlayingChordPublisher();
    const seen: Array<{ index: number; chordId: string } | null> = [];
    p.subscribe((value) => seen.push(value));
    p.set({ index: 0, chordId: 'a' });
    p.set({ index: 0, chordId: 'a' }); // a new object, same content
    p.set({ index: 1, chordId: 'b' });
    p.set({ index: 1, chordId: 'a' }); // id alone differs
    expect(seen).toEqual([
      { index: 0, chordId: 'a' },
      { index: 1, chordId: 'b' },
      { index: 1, chordId: 'a' },
    ]);
  });

  test('a clear always notifies, even when nothing is playing', () => {
    // The chord view resets its held-card highlight on every notify; the old
    // clearChordUi nulled that id on every call, so a clear must reach it.
    const p = createPlayingChordPublisher();
    let notified = 0;
    p.subscribe(() => { notified++; });
    p.set(null);
    p.set(null);
    expect(notified).toBe(2);
    expect(p.get()).toBeNull();
  });

  test('unsubscribe stops notifications', () => {
    const p = createPlayingChordPublisher();
    let notified = 0;
    const off = p.subscribe(() => { notified++; });
    off();
    p.set({ index: 0, chordId: 'a' });
    expect(notified).toBe(0);
  });

  test('usePlayingChord renders the published value under renderToString', () => {
    playingChord.set({ index: 3, chordId: 'x' });
    const Probe = () => {
      const value = usePlayingChord();
      return createElement('span', null, value ? `${value.index}:${value.chordId}` : 'none');
    };
    expect(renderToString(createElement(Probe))).toContain('3:x');
    playingChord.set(null);
    expect(renderToString(createElement(Probe))).toContain('none');
  });
});

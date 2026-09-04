import { afterEach, describe, expect, test } from 'bun:test';
import {
  emitNoteInput,
  resetNoteInputListeners,
  subscribeNoteInput,
  type NoteInputEvent,
} from './noteInputBus';

afterEach(() => resetNoteInputListeners());

const on = (note: string): NoteInputEvent => ({ kind: 'on', note, velocity: 1 });

describe('noteInputBus', () => {
  test('delivers an event to every subscriber', () => {
    const a: NoteInputEvent[] = [];
    const b: NoteInputEvent[] = [];
    subscribeNoteInput((e) => a.push(e));
    subscribeNoteInput((e) => b.push(e));

    emitNoteInput(on('C4'));

    expect(a).toEqual([{ kind: 'on', note: 'C4', velocity: 1 }]);
    expect(b).toEqual(a);
  });

  test('emitting with nobody listening is a no-op, not a throw', () => {
    expect(() => emitNoteInput(on('C4'))).not.toThrow();
  });

  test('the returned function unsubscribes', () => {
    const seen: NoteInputEvent[] = [];
    const off = subscribeNoteInput((e) => seen.push(e));
    emitNoteInput(on('C4'));
    off();
    emitNoteInput(on('E4'));

    expect(seen.map((e) => e.note)).toEqual(['C4']);
  });

  test('unsubscribing twice is harmless', () => {
    const off = subscribeNoteInput(() => {});
    off();
    expect(() => off()).not.toThrow();
  });

  test('a listener that unsubscribes itself mid-emit does not derail the others', () => {
    // The walk copies the set first. Without that, removing during iteration
    // silently skips whoever came next.
    const seen: string[] = [];
    const off = subscribeNoteInput(() => {
      seen.push('first');
      off();
    });
    subscribeNoteInput(() => seen.push('second'));

    emitNoteInput(on('C4'));
    emitNoteInput(on('E4'));

    expect(seen).toEqual(['first', 'second', 'second']);
  });

  test('carries velocity and time through untouched', () => {
    let got: NoteInputEvent | null = null;
    subscribeNoteInput((e) => {
      got = e;
    });

    emitNoteInput({ kind: 'on', note: 'F#3', velocity: 0.42, time: 12.5 });

    expect(got).toEqual({ kind: 'on', note: 'F#3', velocity: 0.42, time: 12.5 });
  });
});

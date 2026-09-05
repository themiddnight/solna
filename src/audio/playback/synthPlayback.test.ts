import { afterEach, describe, expect, test } from 'bun:test';
import {
  synthPlaybackNoteOff,
  synthPlaybackNoteOn,
  synthPlaybackPreview,
} from './synthPlayback';
import {
  resetNoteInputListeners,
  subscribeNoteInput,
  type NoteInputEvent,
} from './noteInputBus';
import { INITIAL_SYNTH_PARAMS } from '@/store/initialState';

afterEach(() => resetNoteInputListeners());

/** Collect everything the bus reports for the duration of a test. */
function heard(): NoteInputEvent[] {
  const events: NoteInputEvent[] = [];
  subscribeNoteInput((e) => events.push(e));
  return events;
}

// The engine no-ops until init() creates the AudioContext, so these run
// without audio and assert only what reaches the bus.
describe('synthPlayback → note-input bus', () => {
  test('a played note is announced, with its velocity and time', () => {
    const events = heard();
    synthPlaybackNoteOn('C4', INITIAL_SYNTH_PARAMS, 0.5, 3.25);
    expect(events).toEqual([{ kind: 'on', note: 'C4', velocity: 0.5, time: 3.25 }]);
  });

  test('a release is announced too, so a listener can tell when the key came up', () => {
    const events = heard();
    synthPlaybackNoteOff('C4', 0.3);
    expect(events).toEqual([{ kind: 'off', note: 'C4', velocity: 0, time: undefined }]);
  });

  test('the audition target does not change what the bus reports', () => {
    // The keyboard auditions on its own target; a listener cares that a
    // person played C4, not which voice pool it landed in.
    const events = heard();
    synthPlaybackNoteOn('C4', INITIAL_SYNTH_PARAMS, 1, undefined, 'keyboard-audition', 0.7);
    expect(events).toHaveLength(1);
    expect(events[0].note).toBe('C4');
  });

  test('a PREVIEW is silent on the bus — clicking a grid cell must never record', () => {
    // This is the whole reason preview has its own function. If it went
    // through synthPlaybackNoteOn, arming the recorder and clicking a cell
    // would write that cell twice.
    const events = heard();
    synthPlaybackPreview('C4', INITIAL_SYNTH_PARAMS, 1);
    expect(events).toEqual([]);
  });

  test('a throwing listener cannot swallow the note, or the next listener', () => {
    const events = heard();
    subscribeNoteInput(() => {
      throw new Error('subscriber blew up');
    });
    const after: string[] = [];
    subscribeNoteInput((e) => after.push(e.note));

    // Two guarantees, not one. Ordering gives the first: the engine call
    // happens before the emit, so the sound is already scheduled by the time
    // a listener can misbehave. Ordering does NOT give the second — the emit
    // sits in the MIDDLE of its callers (useInputDeck re-scales polyphony and
    // clears the held-note set AFTER synthPlaybackNoteOff returns), so a
    // propagating throw would leave the key stuck and the voices mis-levelled.
    // Isolation per listener is what makes the bus safe to subscribe to.
    expect(() => synthPlaybackNoteOn('C4', INITIAL_SYNTH_PARAMS)).not.toThrow();
    expect(events.map((e) => e.note)).toEqual(['C4']);
    expect(after).toEqual(['C4']);
  });
});

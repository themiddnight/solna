import { afterEach, describe, expect, test } from 'bun:test';
import {
  synthPlaybackNoteOff,
  synthPlaybackNoteOn,
} from './synthPlayback';
import {
  resetNoteInputListeners,
  subscribeNoteInput,
  type NoteInputEvent,
} from './noteInputBus';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';

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
    synthPlaybackNoteOn('C4', SUBTRACTIVE_INIT, 0.5, 3.25);
    expect(events).toEqual([{ kind: 'on', note: 'C4', velocity: 0.5, time: 3.25 }]);
  });

  test('a release is announced too, so a listener can tell when the key came up', () => {
    const events = heard();
    // No context, so note-on returned no id — and the bus still has to hear
    // the key come up, or an armed recorder would never close the note.
    synthPlaybackNoteOff(null, 'C4', 0.3);
    expect(events).toEqual([{ kind: 'off', note: 'C4', velocity: 0, time: undefined }]);
  });

  test('the audition target does not change what the bus reports', () => {
    // The keyboard auditions on its own target; a listener cares that a
    // person played C4, not which voice pool it landed in.
    const events = heard();
    synthPlaybackNoteOn('C4', SUBTRACTIVE_INIT, 1, undefined, 'keyboard-audition', 0.7);
    expect(events).toHaveLength(1);
    expect(events[0].note).toBe('C4');
  });

  // The matching half of this contract — that an AUDITION is silent on the
  // bus — is pinned in presetPreview.test.ts, where previewSequencerNote now
  // lives and where a fake engine makes the assertion non-vacuous.

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
    // sits in the MIDDLE of its callers (useInputDeck clears the held-note
    // set AFTER synthPlaybackNoteOff returns), so a propagating throw would
    // leave the key stuck.
    // Isolation per listener is what makes the bus safe to subscribe to.
    expect(() => synthPlaybackNoteOn('C4', SUBTRACTIVE_INIT)).not.toThrow();
    expect(events.map((e) => e.note)).toEqual(['C4']);
    expect(after).toEqual(['C4']);
  });
});

import { describe, expect, test } from 'bun:test';
import { performNoteOff } from './useInputDeck';
import type { HeldNoteTargets } from '../audio/playback/heldNotes';
import type { SynthControlTarget } from '../utils/synthControl';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';

// `useEffect` does not run under `renderToString` and this repo bans
// DOM/testing-library, so `handleNoteOff`'s closure is not directly
// reachable from a test — `performNoteOff` is the decision extracted out of
// it, taking its three side effects as injected callbacks the way
// `releaseTriggeredTargets` already does.
describe('performNoteOff', () => {
  test('note-on with the arp off, then arp toggled on, then note-off still releases the captured bus', () => {
    // The actual drone sequence from the fix: a key is held on a bus while
    // the arp is OFF (captured into `held` by handleNoteOn, exactly as it
    // would be), the arp is then toggled ON, and the key is released before
    // the arp's first trigger. The old code released only in the non-arp
    // branch, so this sequence let a sustaining voice drone until reload.
    const held: HeldNoteTargets = new Map([['C4', 'synth' as SynthControlTarget]]);
    const released: Array<[string, number, SynthControlTarget]> = [];
    const rescaled: Array<[number, SynthControlTarget]> = [];
    const announced: string[] = [];

    performNoteOff(
      'C4',
      held,
      { ...INITIAL_SYNTH_PARAMS, arpActive: true, release: 0.42 },
      {
        releaseNote: (note, releaseTime, target) => released.push([note, releaseTime, target]),
        rescale: (scale, target) => rescaled.push([scale, target]),
        announce: (note) => announced.push(note),
      },
    );

    expect(released).toEqual([['C4', 0.42, 'synth']]);
    expect(announced).toEqual(['C4']);
    expect(rescaled).toEqual([]);
    expect(held.has('C4')).toBe(false);
  });

  test('the non-arp branch releases and rescales, and does not announce', () => {
    const held: HeldNoteTargets = new Map([['C4', 'synth' as SynthControlTarget]]);
    const released: Array<[string, number, SynthControlTarget]> = [];
    const rescaled: Array<[number, SynthControlTarget]> = [];
    const announced: string[] = [];

    performNoteOff(
      'C4',
      held,
      { ...INITIAL_SYNTH_PARAMS, arpActive: false, release: 0.5 },
      {
        releaseNote: (note, releaseTime, target) => released.push([note, releaseTime, target]),
        rescale: (scale, target) => rescaled.push([scale, target]),
        announce: (note) => announced.push(note),
      },
    );

    expect(released).toEqual([['C4', 0.5, 'synth']]);
    expect(rescaled.length).toBe(1);
    expect(rescaled[0][1]).toBe('synth');
    expect(announced).toEqual([]);
  });

  test('a note with no captured target (never held) triggers no action', () => {
    const held: HeldNoteTargets = new Map();
    const released: unknown[] = [];
    const rescaled: unknown[] = [];
    const announced: unknown[] = [];

    performNoteOff('C4', held, INITIAL_SYNTH_PARAMS, {
      releaseNote: (...args) => released.push(args),
      rescale: (...args) => rescaled.push(args),
      announce: (...args) => announced.push(args),
    });

    expect(released).toEqual([]);
    expect(rescaled).toEqual([]);
    expect(announced).toEqual([]);
  });
});

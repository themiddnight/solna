import { describe, expect, test } from 'bun:test';
import { performNoteOff, performNoteOn } from './useInputDeck';
import type { HeldNoteTargets } from '../audio/playback/heldNotes';
import type { SynthControlTarget } from '../utils/synthControl';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';
import { equalPowerVelocityScale } from '../audio/chordRhythms';

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

// `useEffect` does not run under `renderToString`, so `handleNoteOn`'s
// closure over the private `arpStateRef` is not directly reachable from a
// test either — `performNoteOn` is that decision extracted the same way
// `performNoteOff` is above, with its own fresh `held` map per test.
describe('performNoteOn', () => {
  test('the re-press guard fires in the arp branch too, and drones no bus', () => {
    // The exact sequence from the fix: arp off → hold C4 (captured 'synth')
    // → arp on → focus moves to fx → C4 re-pressed. Before the hoist, the
    // guard lived only inside the `!arpActive` branch, so this second call
    // (arp now on) skipped the release entirely and the 'synth' voice
    // drones with no map entry left to reach it.
    const held: HeldNoteTargets = new Map();
    const played: Array<[string, SynthControlTarget, number]> = [];
    const released: Array<[string, number, SynthControlTarget]> = [];
    const rescaled: Array<[number, SynthControlTarget]> = [];
    const announced: string[] = [];
    let engineInitCount = 0;
    const actions = {
      initEngine: () => { engineInitCount += 1; },
      playNote: (n: string, t: SynthControlTarget, s: number) => played.push([n, t, s]),
      releaseNote: (n: string, r: number, t: SynthControlTarget) => released.push([n, r, t]),
      rescale: (s: number, t: SynthControlTarget) => rescaled.push([s, t]),
      announce: (n: string) => announced.push(n),
    };

    // arp off → hold C4 on 'synth'
    performNoteOn('C4', 'synth', held, { ...INITIAL_SYNTH_PARAMS, arpActive: false }, actions);
    expect(held.get('C4')).toBe('synth');
    expect(played).toEqual([['C4', 'synth', 1]]);

    // arp on → focus moves to fx → C4 re-pressed
    released.length = 0;
    rescaled.length = 0;
    announced.length = 0;
    performNoteOn('C4', 'fx', held, { ...INITIAL_SYNTH_PARAMS, arpActive: true }, actions);

    // The stranded 'synth' voice IS released, and the map now points at 'fx'.
    expect(released).toEqual([['C4', INITIAL_SYNTH_PARAMS.release, 'synth']]);
    expect(held.get('C4')).toBe('fx');
    // The old bus is rescaled too (fix 3): 'synth' has nothing left held on
    // it, so it rescales to zero remaining voices' equal-power factor.
    expect(rescaled).toEqual([[equalPowerVelocityScale(0), 'synth']]);
    // The arp branch swallows the key: nothing plays, the press is announced.
    expect(played).toEqual([['C4', 'synth', 1]]);
    expect(announced).toEqual(['C4']);
    expect(engineInitCount).toBe(2);
  });

  test('a note re-pressed on the SAME bus never releases or rescales it', () => {
    const held: HeldNoteTargets = new Map([['C4', 'synth' as SynthControlTarget]]);
    const released: unknown[] = [];
    const rescaled: unknown[] = [];
    performNoteOn('C4', 'synth', held, INITIAL_SYNTH_PARAMS, {
      initEngine: () => {},
      playNote: () => {},
      releaseNote: (...args) => released.push(args),
      rescale: (...args) => rescaled.push(args),
      announce: () => {},
    });
    expect(released).toEqual([]);
    // previous === target, so the guard's condition is false and no release
    // or vacated-bus rescale runs; this is not a NEW note either (it was
    // already in `held`), so the non-arp branch's own rescale is skipped too.
    expect(rescaled).toEqual([]);
  });

  test('a brand-new note on the non-arp branch plays and rescales once', () => {
    const held: HeldNoteTargets = new Map();
    const played: unknown[] = [];
    const rescaled: unknown[] = [];
    performNoteOn('C4', 'synth', held, { ...INITIAL_SYNTH_PARAMS, arpActive: false }, {
      initEngine: () => {},
      playNote: (...args) => played.push(args),
      releaseNote: () => {},
      rescale: (...args) => rescaled.push(args),
      announce: () => {},
    });
    expect(played.length).toBe(1);
    expect(rescaled.length).toBe(1);
  });
});

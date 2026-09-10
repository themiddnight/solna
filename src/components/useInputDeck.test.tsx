import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
  useInputDeck,
  notesToReleaseOnKeyboardModeChange,
  releaseAllHeldNotes,
  subscribeArpState,
  selectArpActive,
  selectSynthRelease,
  synthTargetForFocus,
  performNoteOff,
  performNoteOn,
} from './useInputDeck';
import type { InputDeckDrumProps, InputDeckKeyboardProps } from './useInputDeck';
import type { SynthControlTarget } from '@/utils/synthControl';
import type { HeldNoteTargets } from '../audio/playback/heldNotes';
import { useAppStore } from '../store/store';
import { DEFAULT_PADS } from './ui/DrumPadGrid';
import { getChordKeyboardRows, getScaleLockedKeyboardNotes } from './ui/Keyboard';
import { MIX_LAYER_IDS } from '@/store/focusTrack';
import { audioEngine } from '../audio/engine';
import { subscribeNoteInput, resetNoteInputListeners, type NoteInputEvent } from '../audio/playback/noteInputBus';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';
import { equalPowerVelocityScale } from '../audio/chordRhythms';

let captured: { keyboardProps: InputDeckKeyboardProps; drumProps: InputDeckDrumProps } | null = null;

function Probe() {
  captured = useInputDeck();
  return null;
}

describe('useInputDeck', () => {
  test('exposes default octave and an empty held-note set', () => {
    renderToString(<Probe />);
    expect(captured!.keyboardProps.keyboardOctave).toBe(0);
    expect(captured!.keyboardProps.activeNotes.size).toBe(0);
  });

  test('exposes the keyboard mode from the store', () => {
    renderToString(<Probe />);
    expect(captured!.keyboardProps.keyboardMode).toBe(
      useAppStore.getState().keyboardMode,
    );
  });

  test('memoized keyboard rows match the pure Keyboard helpers at the same inputs', () => {
    renderToString(<Probe />);
    const { scaleRoot, scaleType, keyboardOctave, chordKeyboardRows, scaleLockedRows } =
      captured!.keyboardProps;
    expect(chordKeyboardRows).toEqual(getChordKeyboardRows(scaleRoot, scaleType, keyboardOctave));
    expect(scaleLockedRows).toEqual(getScaleLockedKeyboardNotes(scaleRoot, scaleType, keyboardOctave));
  });

  test('exposes drum pads matching DEFAULT_PADS with no active pad', () => {
    renderToString(<Probe />);
    expect(captured!.drumProps.pads).toEqual(DEFAULT_PADS);
    expect(captured!.drumProps.activePadId).toBeNull();
  });

  test('keyboardProps and drumProps still carry every field after memoizing', () => {
    renderToString(<Probe />);
    expect(Object.keys(captured!.keyboardProps).sort()).toEqual([
      'activeNotes', 'chordKeyboardRows', 'handleNoteOff', 'handleNoteOn',
      'keyboardMode', 'keyboardOctave', 'scaleLockedRows', 'scaleRoot',
      'scaleType', 'setKeyboardMode', 'setKeyboardOctave',
    ]);
    expect(Object.keys(captured!.drumProps).sort()).toEqual([
      'activePadId', 'onPadVolumeChange', 'onTriggerPad', 'pads',
    ]);
  });
});

describe('notesToReleaseOnKeyboardModeChange', () => {
  test('returns every currently-held note, deduplicated', () => {
    const held = new Set(['C4', 'E4', 'G4']);
    expect(notesToReleaseOnKeyboardModeChange(held)).toEqual(['C4', 'E4', 'G4']);
  });

  test('release list is the held snapshot, never what the new mode recomputes for the same key', () => {
    const chordSnapshot = ['C4', 'E4', 'G4'];
    const scaleLockedNoteForSameKey = 'C3';
    const released = notesToReleaseOnKeyboardModeChange(chordSnapshot);
    expect(released).toEqual(chordSnapshot);
    expect(released).not.toContain(scaleLockedNoteForSameKey);
  });

  test('returns an empty list when nothing is held', () => {
    expect(notesToReleaseOnKeyboardModeChange([])).toEqual([]);
  });
});

describe('releaseAllHeldNotes', () => {
  test('calls the release callback once per held note, in order', () => {
    const released: string[] = [];
    releaseAllHeldNotes(new Set(['C4', 'E4', 'G4']), (n) => released.push(n));
    expect(released).toEqual(['C4', 'E4', 'G4']);
  });

  test('calls the release callback zero times when nothing is held', () => {
    const released: string[] = [];
    releaseAllHeldNotes([], (n) => released.push(n));
    expect(released).toEqual([]);
  });

  test('deduplicates a note passed twice', () => {
    const released: string[] = [];
    releaseAllHeldNotes(['C4', 'C4'], (n) => released.push(n));
    expect(released).toEqual(['C4']);
  });
});

describe('subscribeArpState', () => {
  test('mirrors synthParams and bpm into the ref, then stops on dispose', () => {
    const ref = {
      current: {
        heldTargets: new Map<string, SynthControlTarget>(),
        params: useAppStore.getState().synthParams,
        target: 'synth' as SynthControlTarget | null,
        triggeredTargets: new Set<SynthControlTarget>(),
        bpm: useAppStore.getState().bpm,
      },
    };
    const startingBpm = useAppStore.getState().bpm;
    const startingFocus = useAppStore.getState().focusTrack;
    const stop = subscribeArpState(ref);
    try {
      // fireImmediately bootstrap
      expect(ref.current.params).toBe(useAppStore.getState().synthParams);
      expect(ref.current.bpm).toBe(startingBpm);

      const next = { ...useAppStore.getState().synthParams, detune: 17 };
      useAppStore.getState().setSynthParams(next);
      expect(ref.current.params.detune).toBe(17);

      useAppStore.getState().setBpm(133);
      expect(ref.current.bpm).toBe(133);

      // The keyboard follows focus: the ref's target is the focused melodic
      // track, and null when there is nothing melodic to play.
      useAppStore.getState().setFocusTrack('fx');
      expect(ref.current.target).toBe('fx');
      useAppStore.getState().setFocusTrack('drum');
      expect(ref.current.target).toBeNull();
      useAppStore.getState().setFocusTrack('synth');
      expect(ref.current.target).toBe('synth');

      stop();

      // After disposal the ref must go stale rather than keep tracking, on
      // every subscription this function set up — not just bpm. `stop()`
      // bundles three unsubscribes (params, bpm, focus); this proves the
      // returned teardown actually disposes all of them, not just the ones
      // the assertions above happened to touch. These mutations stay inside
      // this `try` (rather than after the `finally`, where a throw here
      // would leak `bpm`/`focusTrack` past this test) so the `finally` below
      // always restores both regardless of which assertion fails.
      useAppStore.getState().setBpm(97);
      expect(ref.current.bpm).toBe(133);

      useAppStore.getState().setFocusTrack('fx');
      expect(ref.current.target).toBe('synth');
    } finally {
      stop();
      useAppStore.getState().setBpm(startingBpm);
      useAppStore.getState().setFocusTrack(startingFocus);
    }
  });

  test('routes params through the FOCUSED channel: fx focus reads fxSynthParams, not synthParams', () => {
    const ref = {
      current: {
        heldTargets: new Map<string, SynthControlTarget>(),
        params: useAppStore.getState().synthParams,
        target: 'synth' as SynthControlTarget | null,
        triggeredTargets: new Set<SynthControlTarget>(),
        bpm: useAppStore.getState().bpm,
      },
    };
    const startingFocus = useAppStore.getState().focusTrack;
    const startingFxParams = useAppStore.getState().fxSynthParams;
    const startingSynthParams = useAppStore.getState().synthParams;
    const stop = subscribeArpState(ref);
    try {
      useAppStore.getState().setFocusTrack('fx');
      expect(ref.current.params).toBe(useAppStore.getState().fxSynthParams);
      expect(ref.current.params).not.toBe(useAppStore.getState().synthParams);

      // Flipping fxSynthParams.arpActive arms the arp while synthParams.arpActive
      // does not — the reader is the focused channel's own params, not Lead's.
      useAppStore.getState().setFxSynthParams({
        ...useAppStore.getState().fxSynthParams,
        arpActive: true,
      });
      expect(ref.current.params.arpActive).toBe(true);
      expect(selectArpActive(useAppStore.getState())).toBe(true);

      useAppStore.getState().setFxSynthParams({
        ...useAppStore.getState().fxSynthParams,
        arpActive: false,
      });
      useAppStore.getState().setSynthParams({
        ...useAppStore.getState().synthParams,
        arpActive: true,
      });
      expect(selectArpActive(useAppStore.getState())).toBe(false);
    } finally {
      stop();
      useAppStore.getState().setFxSynthParams(startingFxParams);
      useAppStore.getState().setSynthParams(startingSynthParams);
      useAppStore.getState().setFocusTrack(startingFocus);
    }
  });
});

describe('selectArpActive / selectSynthRelease narrowing', () => {
  // Pins the actual selectors useInputDeck() passes to useAppStore (not a
  // copy of their logic): each must return a bare primitive, and two
  // AppStore snapshots that differ only in a synthParams field the hook does
  // not read reactively (detune) must still produce identical selector
  // output. A selector widened back to the whole synthParams object, or to
  // any other field, fails this immediately.
  test('each selector returns a primitive unaffected by an unrelated synthParams field', () => {
    const baseState = useAppStore.getState();
    const baseParams = baseState.synthParams;
    const stateA = { ...baseState, synthParams: { ...baseParams, detune: baseParams.detune + 1 } };
    const stateB = { ...baseState, synthParams: { ...baseParams, detune: baseParams.detune + 2 } };

    expect(typeof selectArpActive(stateA)).toBe('boolean');
    expect(typeof selectSynthRelease(stateA)).toBe('number');
    expect(selectArpActive(stateA)).toBe(selectArpActive(stateB));
    expect(selectSynthRelease(stateA)).toBe(selectSynthRelease(stateB));
  });
});

describe('synthTargetForFocus', () => {
  test('every melodic focus plays its own bus', () => {
    expect(synthTargetForFocus('synth')).toBe('synth');
    expect(synthTargetForFocus('fx')).toBe('fx');
    expect(synthTargetForFocus('chord')).toBe('chord');
    expect(synthTargetForFocus('bass')).toBe('bass');
    expect(synthTargetForFocus('pad')).toBe('pad');
  });

  test('a drum focus has no melodic bus, and says so with null', () => {
    // Not a fallback to 'synth': that would make the drum focus play the Lead
    // patch off the melodic keyboard — the same invisible mis-routing this
    // change removes. The QWERTY drum PADS are a disjoint key set on their own
    // listener and are unaffected.
    expect(synthTargetForFocus('drum')).toBeNull();
  });

  // Deleted rather than kept as-is: it asserted only that the return type is
  // `string | null`, which any implementation satisfies — a version that
  // always returned 'synth', or always null, would pass it too. The two
  // tests above already cover every focus explicitly; what is worth pinning
  // instead is that exactly ONE focus resolves to null, and which one.
  test('exactly one focus has no melodic bus, and it is drum', () => {
    const nullFocuses = MIX_LAYER_IDS.filter((focus) => synthTargetForFocus(focus) === null);
    expect(nullFocuses).toEqual(['drum']);
  });
});

describe('handleNoteOn (via the rendered hook)', () => {
  afterEach(() => {
    resetNoteInputListeners();
    (audioEngine.init as unknown as { mockRestore?: () => void }).mockRestore?.();
    (audioEngine.triggerSynthNoteOn as unknown as { mockRestore?: () => void }).mockRestore?.();
    // Restored here, not as the last statement of each test body: a thrown
    // assertion above that line would otherwise leak a non-default
    // `focusTrack` into every test that runs afterwards.
    useAppStore.getState().setFocusTrack('synth');
  });

  function heard(): NoteInputEvent[] {
    const events: NoteInputEvent[] = [];
    subscribeNoteInput((e) => events.push(e));
    return events;
  }

  test('a drum focus is a complete no-op: no engine call, no heldTargets entry, nothing announced', () => {
    useAppStore.getState().setFocusTrack('drum');
    const initSpy = spyOn(audioEngine, 'init').mockImplementation(() => Promise.resolve());
    const noteOnSpy = spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation(() => {});
    const events = heard();

    renderToString(<Probe />);
    captured!.keyboardProps.handleNoteOn('C4');

    expect(initSpy).not.toHaveBeenCalled();
    expect(noteOnSpy).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    // The real proof of "no heldTargets entry": `performNoteOff` only emits
    // an 'off' event (via `synthPlaybackNoteOff`) when it finds a map entry
    // for the note. `noteOnSpy` can never fire from a note-off under any
    // implementation, so asserting on it here would pass even with a
    // leftover entry — `events` staying empty is what a leftover entry
    // would actually break.
    captured!.keyboardProps.handleNoteOff('C4');
    expect(events).toEqual([]);
  });

  test('a melodic focus plays the engine and announces on the bus', () => {
    useAppStore.getState().setFocusTrack('synth');
    const initSpy = spyOn(audioEngine, 'init').mockImplementation(() => Promise.resolve());
    const noteOnSpy = spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation(() => {});
    const events = heard();

    renderToString(<Probe />);
    captured!.keyboardProps.handleNoteOn('C4');

    expect(initSpy).toHaveBeenCalled();
    expect(noteOnSpy).toHaveBeenCalled();
    expect(noteOnSpy.mock.calls[0]?.[0]).toBe('C4');
    expect(events).toEqual([{ kind: 'on', note: 'C4', velocity: 1.0, time: undefined }]);

    // Proof the note-on wrote exactly one heldTargets entry on the focused
    // bus: a note-off for the same note only reaches `synthPlaybackNoteOff`
    // (and so only emits 'off') when `performNoteOff` finds a map entry.
    captured!.keyboardProps.handleNoteOff('C4');
    expect(events).toEqual([
      { kind: 'on', note: 'C4', velocity: 1.0, time: undefined },
      { kind: 'off', note: 'C4', velocity: 0, time: undefined },
    ]);
  });
});

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


  test('a melodic note-on adds exactly one heldTargets entry, on the focused bus', () => {
    // The map itself is what fix 1 asks to pin: `performNoteOn` is only ever
    // called with a melodic (non-null) target — the drum no-op returns
    // inside `handleNoteOn`, before this function is reached at all — so a
    // melodic focus is the whole space this function has an opinion about.
    const held: HeldNoteTargets = new Map();
    performNoteOn('C4', 'fx', held, { ...INITIAL_SYNTH_PARAMS, arpActive: false }, {
      initEngine: () => {},
      playNote: () => {},
      releaseNote: () => {},
      rescale: () => {},
      announce: () => {},
    });
    expect(held.size).toBe(1);
    expect(held.get('C4')).toBe('fx');
  });

  test('a non-arp cross-bus re-press rescales the bus the note ARRIVES at (fix 1)', () => {
    // Reproduced by the review: hold C4 on 'synth', hold E4 on 'fx', re-press
    // C4 on 'fx' — before the fix, `isNewNote` was computed from `previous`
    // (defined, since C4 was already held on 'synth'), so it read `false` and
    // 'fx' was never rescaled for its now-two held notes: E4 stayed at 1.0
    // while C4 arrived at 0.707, two notes on one bus at different levels.
    const held: HeldNoteTargets = new Map();
    const rescaled: Array<[number, SynthControlTarget]> = [];
    const played: Array<[string, SynthControlTarget, number]> = [];
    const actions = {
      initEngine: () => {},
      playNote: (n: string, t: SynthControlTarget, s: number) => played.push([n, t, s]),
      releaseNote: () => {},
      rescale: (s: number, t: SynthControlTarget) => rescaled.push([s, t]),
      announce: () => {},
    };
    const params = { ...INITIAL_SYNTH_PARAMS, arpActive: false };

    performNoteOn('C4', 'synth', held, params, actions);
    performNoteOn('E4', 'fx', held, params, actions);
    rescaled.length = 0;
    played.length = 0;

    performNoteOn('C4', 'fx', held, params, actions);

    expect(rescaled).toContainEqual([equalPowerVelocityScale(2), 'fx']);
    expect(played).toEqual([['C4', 'fx', equalPowerVelocityScale(2)]]);
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

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
} from './useInputDeck';
import type { InputDeckDrumProps, InputDeckKeyboardProps } from './useInputDeck';
import type { SynthControlTarget } from '@/utils/synthControl';
import { useAppStore } from '../store/store';
import { DEFAULT_PADS } from './ui/DrumPadGrid';
import { getChordKeyboardRows, getScaleLockedKeyboardNotes } from './ui/Keyboard';
import { MIX_LAYER_IDS } from '@/store/focusTrack';
import { audioEngine } from '../audio/engine';
import { subscribeNoteInput, resetNoteInputListeners, type NoteInputEvent } from '../audio/playback/noteInputBus';

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
    } finally {
      stop();
      useAppStore.getState().setFocusTrack(startingFocus);
    }

    // After disposal the ref must go stale rather than keep tracking, on
    // every subscription this function set up — not just bpm. `stop()`
    // bundles three unsubscribes (params, bpm, focus); this proves the
    // returned teardown actually disposes all of them, not just the ones
    // the assertions above happened to touch.
    useAppStore.getState().setBpm(97);
    expect(ref.current.bpm).toBe(133);
    useAppStore.getState().setBpm(startingBpm);

    useAppStore.getState().setFocusTrack('fx');
    expect(ref.current.target).toBe('synth');
    useAppStore.getState().setFocusTrack(startingFocus);
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
    // No heldTargets entry: the matching note-off then finds nothing to
    // release, so this second call is itself a no-op rather than proof of
    // a leftover entry.
    captured!.keyboardProps.handleNoteOff('C4');
    expect(noteOnSpy).not.toHaveBeenCalled();

    useAppStore.getState().setFocusTrack('synth');
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
  });
});

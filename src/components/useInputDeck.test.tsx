import { describe, expect, test } from 'bun:test';
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
    }

    // After disposal the ref must go stale rather than keep tracking.
    useAppStore.getState().setBpm(97);
    expect(ref.current.bpm).toBe(133);
    useAppStore.getState().setBpm(startingBpm);
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

  test('is total over the focus roster', () => {
    for (const focus of MIX_LAYER_IDS) {
      const target = synthTargetForFocus(focus);
      expect(target === null || typeof target === 'string').toBe(true);
    }
  });
});

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
  useInputDeck,
  notesToReleaseOnKeyboardModeChange,
  releaseAllHeldNotes,
  subscribeArpState,
  selectArpActive,
  selectSynthRelease,
  performNoteOff,
  performNoteOn,
} from './useInputDeck';
import type { InputDeckDrumProps, InputDeckKeyboardProps } from './useInputDeck';
import { synthTargetForFocus } from '@/store/focusTrack';
import type { SynthControlTarget } from '@/utils/synthControl';
import type { HeldNoteTargets } from '../audio/playback/heldNotes';
import { useAppStore } from '../store/store';
import { DEFAULT_PADS } from './ui/DrumPadGrid';
import { getChordKeyboardRows, getScaleLockedKeyboardNotes } from './ui/Keyboard';
import { MIX_LAYER_IDS } from '@/store/focusTrack';
import { audioEngine } from '../audio/engine';
import { subscribeNoteInput, resetNoteInputListeners, type NoteInputEvent } from '../audio/playback/noteInputBus';
import type { VoiceId } from '../audio/synth/voiceId';
import type { ActiveSynth } from '../types/synth';
import { equalPowerVelocityScale } from '../audio/chordRhythms';

/**
 * A patch differing from `base` in ONE nested field the hook does not read
 * reactively. Glide is that field: it lives in the common block, nothing in
 * this hook selects it, and a selector widened back to the whole patch would
 * start returning different values for two patches that differ only here.
 */
function withGlide(base: ActiveSynth, glideSeconds: number): ActiveSynth {
  return {
    ...base,
    patch: { ...base.patch, common: { ...base.patch.common, glideSeconds } },
  };
}

/** `[note, bus, voice id]` triples as the held-note map stores them. */
function heldWith(...entries: [string, SynthControlTarget, string][]): HeldNoteTargets {
  return new Map(
    entries.map(([note, target, voiceId]) => [note, { target, voiceId: voiceId as VoiceId }]),
  );
}

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
  test('mirrors the focused patch and bpm into the ref, then stops on dispose', () => {
    const ref = {
      current: {
        heldTargets: new Map() as HeldNoteTargets,
        synth: useAppStore.getState().synthParams,
        arp: useAppStore.getState().synthArpSettings,
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
      expect(ref.current.synth).toBe(useAppStore.getState().synthParams);
      expect(ref.current.bpm).toBe(startingBpm);

      const next = withGlide(useAppStore.getState().synthParams, 0.17);
      useAppStore.getState().setSynthParams(next);
      expect(ref.current.synth.patch.common.glideSeconds).toBe(0.17);

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
      // bundles four unsubscribes (patch, arp, bpm, focus); this proves the
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

  test('routes the patch through the FOCUSED channel: fx focus reads fxSynthParams, not synthParams', () => {
    const ref = {
      current: {
        heldTargets: new Map() as HeldNoteTargets,
        synth: useAppStore.getState().synthParams,
        arp: useAppStore.getState().synthArpSettings,
        target: 'synth' as SynthControlTarget | null,
        triggeredTargets: new Set<SynthControlTarget>(),
        bpm: useAppStore.getState().bpm,
      },
    };
    const startingFocus = useAppStore.getState().focusTrack;
    const startingFxArp = useAppStore.getState().fxArpSettings;
    const startingSynthArp = useAppStore.getState().synthArpSettings;
    const stop = subscribeArpState(ref);
    try {
      useAppStore.getState().setFocusTrack('fx');
      expect(ref.current.synth).toBe(useAppStore.getState().fxSynthParams);
      expect(ref.current.synth).not.toBe(useAppStore.getState().synthParams);

      // Arming FX's arp arms the arp while Lead's stays off — the reader is
      // the focused channel's own Arp settings, not Lead's. And Arp arrives
      // on its OWN field: it is performance state, never part of the patch.
      useAppStore.getState().setFxArpSettings({ ...startingFxArp, active: true });
      expect(ref.current.arp.active).toBe(true);
      expect(selectArpActive(useAppStore.getState())).toBe(true);

      useAppStore.getState().setFxArpSettings({ ...startingFxArp, active: false });
      useAppStore.getState().setSynthArpSettings({ ...startingSynthArp, active: true });
      expect(selectArpActive(useAppStore.getState())).toBe(false);
    } finally {
      stop();
      useAppStore.getState().setFxArpSettings(startingFxArp);
      useAppStore.getState().setSynthArpSettings(startingSynthArp);
      useAppStore.getState().setFocusTrack(startingFocus);
    }
  });
});

describe('selectArpActive / selectSynthRelease narrowing', () => {
  // Pins the actual selectors useInputDeck() passes to useAppStore (not a
  // copy of their logic): each must return a bare primitive, and two
  // AppStore snapshots that differ only in a patch field the hook does not
  // read reactively (glide) must still produce identical selector output. A
  // selector widened back to the whole patch object, or to any other field,
  // fails this immediately.
  test('each selector returns a primitive unaffected by an unrelated patch field', () => {
    const baseState = useAppStore.getState();
    const baseParams = baseState.synthParams;
    const stateA = { ...baseState, synthParams: withGlide(baseParams, 0.11) };
    const stateB = { ...baseState, synthParams: withGlide(baseParams, 0.22) };

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
  test('the arp branch releases the captured bus AND announces', () => {
    // The exact sequence the release-on-every-branch fix exists for: C4 held
    // while the arp is OFF (captured into `held` by handleNoteOn), the arp is
    // then toggled ON, and the key is released before the arp's first
    // trigger. The old code released only in the non-arp branch, so this
    // sequence let a sustaining voice drone until reload.
    const held = heldWith(['C4', 'synth', 'voice-1']);
    const released: Array<[VoiceId | null, string, number]> = [];
    const announced: string[] = [];

    const rescaled: Array<[number, SynthControlTarget]> = [];
    performNoteOff('C4', held, 0.42, true, {
      releaseVoice: (voiceId, note, releaseSeconds) => released.push([voiceId, note, releaseSeconds]),
      rescale: (scale, target) => rescaled.push([scale, target]),
      announce: (note) => announced.push(note),
    });

    // The VOICE the key started, never a bus-and-note lookup.
    expect(released).toEqual([['voice-1' as VoiceId, 'C4', 0.42]]);
    expect(announced).toEqual(['C4']);
    // The arp branch never rebalances: the key sounded no voice of its own on
    // this bus, so there is nothing for the remaining keys to rise back from.
    expect(rescaled).toEqual([]);
    expect(held.has('C4')).toBe(false);
  });

  test('the non-arp branch releases the voice, rebalances the bus, and does not announce', () => {
    const held = heldWith(['C4', 'synth', 'voice-9'], ['E4', 'synth', 'voice-10']);
    const released: Array<[VoiceId | null, string, number]> = [];
    const rescaled: Array<[number, SynthControlTarget]> = [];
    const announced: string[] = [];

    performNoteOff('C4', held, 0.5, false, {
      releaseVoice: (voiceId, note, releaseSeconds) => released.push([voiceId, note, releaseSeconds]),
      rescale: (scale, target) => rescaled.push([scale, target]),
      announce: (note) => announced.push(note),
    });

    expect(released).toEqual([['voice-9' as VoiceId, 'C4', 0.5]]);
    // One key left on the bus, so it rises back to full level. The engine
    // skips the voice that is already releasing, so the tail this key started
    // is not re-lifted with it.
    expect(rescaled).toEqual([[equalPowerVelocityScale(1), 'synth']]);
    expect(announced).toEqual([]);
  });

  test('a note with no captured target (never held) triggers no action', () => {
    const held: HeldNoteTargets = new Map();
    const released: unknown[] = [];
    const rescaled: unknown[] = [];
    const announced: unknown[] = [];

    performNoteOff('C4', held, 0.3, false, {
      releaseVoice: (...args) => released.push(args),
      rescale: (...args) => rescaled.push(args),
      announce: (...args) => announced.push(args),
    });

    expect(released).toEqual([]);
    expect(rescaled).toEqual([]);
    expect(announced).toEqual([]);
  });
});

describe('performNoteOn', () => {
  /** A note-on action set that hands back a distinct voice id per press. */
  function recordingActions() {
    const played: Array<[string, SynthControlTarget]> = [];
    const released: Array<[VoiceId | null, string, number]> = [];
    const rescaled: Array<[number, SynthControlTarget]> = [];
    const announced: string[] = [];
    let engineInitCount = 0;
    let serial = 0;
    return {
      played,
      released,
      rescaled,
      announced,
      initCount: () => engineInitCount,
      actions: {
        initEngine: () => { engineInitCount += 1; },
        playNote: (n: string, t: SynthControlTarget) => {
          played.push([n, t]);
          serial += 1;
          return `voice-${serial}` as VoiceId;
        },
        releaseVoice: (voiceId: VoiceId | null, n: string, r: number) => released.push([voiceId, n, r]),
        rescale: (scale: number, t: SynthControlTarget) => rescaled.push([scale, t]),
        announce: (n: string) => announced.push(n),
      },
    };
  }

  test('the re-press guard fires in the arp branch too, and drones no bus', () => {
    // The exact sequence from the fix: arp off -> hold C4 (captured 'synth')
    // -> arp on -> focus moves to fx -> C4 re-pressed. Before the hoist, the
    // guard lived only inside the `!arpActive` branch, so this second call
    // (arp now on) skipped the release entirely and the 'synth' voice
    // drones with no map entry left to reach it.
    const held: HeldNoteTargets = new Map();
    const rec = recordingActions();

    performNoteOn('C4', 'synth', held, 0.5, false, rec.actions);
    expect(held.get('C4')).toEqual({ target: 'synth', voiceId: 'voice-1' as VoiceId });
    expect(rec.played).toEqual([['C4', 'synth']]);

    rec.released.length = 0;
    rec.rescaled.length = 0;
    rec.announced.length = 0;
    performNoteOn('C4', 'fx', held, 0.5, true, rec.actions);

    // The stranded 'synth' voice IS released — by the ID it was given, not by
    // a name the arp and the sequencer also answer to — and the map now
    // points at 'fx'.
    expect(rec.released).toEqual([['voice-1' as VoiceId, 'C4', 0.5]]);
    expect(held.get('C4')).toEqual({ target: 'fx', voiceId: null });
    // The vacated bus rises back: 'synth' has nothing held on it any more.
    expect(rec.rescaled).toEqual([[equalPowerVelocityScale(0), 'synth']]);
    // The arp branch swallows the key: nothing plays, the press is announced.
    expect(rec.played).toEqual([['C4', 'synth']]);
    expect(rec.announced).toEqual(['C4']);
    expect(rec.initCount()).toBe(2);
  });

  test('a note re-pressed on the SAME bus releases the voice it replaces', () => {
    const held = heldWith(['C4', 'synth', 'voice-1']);
    const rec = recordingActions();
    performNoteOn('C4', 'synth', held, 0.5, false, rec.actions);
    // The map is keyed by note, so the re-press OVERWRITES the entry. Without
    // a release first, `voice-1` is stranded: unreachable by the key that
    // named it, unreachable by the blur backstop that walks `held`, and with
    // no wall-clock backstop in the manager by design — a drone until the next
    // loop load. Reached by ordinary play, since chord mode fans one key out
    // to several notes and two triads a third apart share two of them.
    expect(rec.released).toEqual([['voice-1' as VoiceId, 'C4', 0.5]]);
    expect(rec.played).toHaveLength(1);
    // One rescale, not two: the vacated-bus rescale is skipped when the bus is
    // the one being re-added to, since the trailing one lands on it anyway with
    // the right count. Both would be 1 here — the count is floored at 1 — so
    // the first only walked the bus to write a value that did not change.
    expect(rec.rescaled).toEqual([[equalPowerVelocityScale(1), 'synth']]);
  });

  test('a melodic note-on adds exactly one heldTargets entry, on the focused bus', () => {
    // `performNoteOn` is only ever called with a melodic (non-null) target —
    // the drum no-op returns inside `handleNoteOn`, before this function is
    // reached — so a melodic focus is the whole space it has an opinion about.
    const held: HeldNoteTargets = new Map();
    performNoteOn('C4', 'fx', held, 0.5, false, recordingActions().actions);
    expect(held.size).toBe(1);
    expect(held.get('C4')?.target).toBe('fx');
  });

  test('the whole bus settles at one level, whatever order the keys went down', () => {
    // The invariant this exists for: a chord pressed key by key must end with
    // every voice at the SAME level. Keydowns are sequential, so a scale
    // baked into each arriving note's velocity would leave a three-note chord
    // at 1, 1/sqrt(2), 1/sqrt(3) by press order — uneven, and unfixable once
    // the envelope has been planned.
    const held: HeldNoteTargets = new Map();
    const rec = recordingActions();

    performNoteOn('C4', 'synth', held, 0.5, false, rec.actions);
    performNoteOn('E4', 'synth', held, 0.5, false, rec.actions);
    performNoteOn('G4', 'synth', held, 0.5, false, rec.actions);

    // One rebalance per press, each covering every voice on the bus, so the
    // LAST one is the level all three settle at.
    expect(rec.rescaled).toEqual([
      [equalPowerVelocityScale(1), 'synth'],
      [equalPowerVelocityScale(2), 'synth'],
      [equalPowerVelocityScale(3), 'synth'],
    ]);
    // And the notes themselves carry no scale at all — level is the engine's.
    expect(rec.played).toEqual([['C4', 'synth'], ['E4', 'synth'], ['G4', 'synth']]);
  });

  test('a cross-bus re-press rebalances the bus it ARRIVES at, counting itself', () => {
    // Hold C4 on 'synth', hold E4 on 'fx', re-press C4 on 'fx'. 'fx' is now
    // holding two keys and must be balanced for two — computing "is this note
    // new" from the bus it LEFT read false and skipped the arriving bus.
    const held: HeldNoteTargets = new Map();
    const rec = recordingActions();

    performNoteOn('C4', 'synth', held, 0.5, false, rec.actions);
    performNoteOn('E4', 'fx', held, 0.5, false, rec.actions);
    rec.rescaled.length = 0;

    performNoteOn('C4', 'fx', held, 0.5, false, rec.actions);

    expect(rec.rescaled).toContainEqual([equalPowerVelocityScale(2), 'fx']);
  });

  test('the voice a press starts is captured in the map, so its key-up can reach it', () => {
    const held: HeldNoteTargets = new Map();
    const rec = recordingActions();
    performNoteOn('C4', 'synth', held, 0.5, false, rec.actions);
    expect(held.get('C4')?.voiceId).toBe('voice-1' as VoiceId);
  });
});

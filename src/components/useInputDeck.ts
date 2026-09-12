import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { equalPowerVelocityScale } from '@/audio/chordRhythms';
import { useArpPlayback, releaseTriggeredTargets, type ArpStateRef } from '../audio/playback/arpPlayback';
import { heldCountFor, noteTargetFor, type HeldNoteTargets } from '../audio/playback/heldNotes';
import {
  applySynthPlaybackVelocityScale,
  hasSynthPlaybackContext,
  initSynthPlayback,
  releaseSynthPlaybackVoices,
  synthPlaybackNoteOff,
  synthPlaybackNoteOn,
} from '../audio/playback/synthPlayback';
import { emitNoteInput } from '../audio/playback/noteInputBus';
import { ensureDrumEngine, triggerPad as triggerDrumPad } from '../audio/playback/drumPlayback';
import { useAppStore } from '../store/store';
import type { AppStore } from '../store/types';
import {
  clampKeyboardOctave,
  getChromaticKeyboardNotes,
  getScaleLockedKeyboardNotes,
  getScaleLockedKeyboardNotesFlat,
  getChordKeyboardRows,
} from './ui/Keyboard';
import type { DrumPad, KeyboardMode, SynthParams } from '../types';
import type { SynthControlTarget } from '../utils/synthControl';
import { isTypingTarget } from '../utils/keyboard';
import { DEFAULT_PADS } from './ui/DrumPadGrid';
import { synthTargetForFocus } from '../store/focusTrack';
import { SYNTH_PARAM_FIELD } from '../store/sourceBuses';

// The keyboard, the on-screen keyboard and the arp all play the FOCUSED track
// (`focusTrack` in the ui slice). They used to be pinned to a module constant
// (deleted with this change), whose stated reason was that pinning kept every
// audio call site (note-on, note-off, arp playback, voice release) agreeing on
// one engine, so a target switch could never strand voices on an engine
// nothing points at any more. The target varies now, so each of those
// guarantees is made explicitly instead:
//
//  - note-off releases on the target CAPTURED at note-on
//    (arpStateRef.current.heldTargets, see audio/playback/heldNotes.ts), never
//    on a target recomputed at release time. A focus change mid-hold would
//    otherwise send the release to a bus the voice was never on, and the held
//    voice would drone until the same key was pressed again on the same
//    track. Same rule as chordKeyNotesRef below, on a different axis.
//  - the arp records every bus it has TRIGGERED on and releases all of them
//    (arpPlayback.ts), because one hold spanning a focus change leaves voices
//    on more than one bus.
//  - equal-power polyphony counts the notes held on ONE bus, and the engine
//    rescale is scoped to that source, so playing a second track never
//    quietens the first.
//
// A focus change alone does NOT cut sounding voices: they ring out naturally.
// That is a decision (spec, Open risks 1) — cutting them is a hard stop the
// user did not ask for, and they are finite.

// Decide which notes must be force-released when the keyboard mode changes.
// Always releases from the snapshot of what is actually sounding right now
// (activeNotes) rather than recomputing under the new mode/key/scale/octave —
// a mode switch mid-hold can make a held key code mean a completely different
// note (or nothing) under the new mode, so recomputing would miss voices and
// leave them hanging forever. Exported so this decision is testable as pure
// logic, without rendering.
export function notesToReleaseOnKeyboardModeChange(
  currentlyHeldNotes: Iterable<string>,
): string[] {
  return Array.from(new Set(currentlyHeldNotes));
}

// Releases every note currently reported as held, via the given release
// callback. Shared by the keyboard-mode-change cleanup effect above and the
// window-blur / visibilitychange backstop below — a held note must never
// survive losing keyboard focus (Cmd-Tab, alt-tab, an OS dialog stealing
// the keyup) or its voice drones until the exact same key is pressed again.
export function releaseAllHeldNotes(
  heldNotes: Iterable<string>,
  releaseNote: (note: string) => void,
): void {
  notesToReleaseOnKeyboardModeChange(heldNotes).forEach(releaseNote);
}

/**
 * The note-off decision, extracted so it is testable without rendering: given
 * the note and the map it was captured into at note-on, releases the bus the
 * note actually PLAYED on — unconditionally, on every branch — then performs
 * the arp-mode-specific extra step.
 *
 * "Capture at note-on" means a note-off releases the bus a property of the
 * NOTE, not of the arp's current state. Before this, the release only ran in
 * the non-arp branch, so a key held with the arp off, then toggled on and
 * released before the arp's first trigger, drained neither `heldTargets` (via
 * this function it does) nor its own sounding voice — a drone that survived
 * until reload. In arp mode the held key usually sounded no voice of its own
 * on this bus, so the extra release here is a no-op; in the toggle-mid-hold
 * case it is exactly the backstop that was missing. The arp branch's OWN
 * triggered voices are released separately, by the `triggeredTargets` cleanup
 * in useInputDeck's arp-silence effect.
 */
export function performNoteOff(
  note: string,
  held: HeldNoteTargets,
  liveParams: SynthParams,
  actions: {
    releaseNote: (note: string, releaseTime: number, target: SynthControlTarget) => void;
    rescale: (scale: number, target: SynthControlTarget) => void;
    announce: (note: string) => void;
  },
): void {
  const target = noteTargetFor(held, note);
  held.delete(note);
  if (target === undefined) return;
  actions.releaseNote(note, liveParams.release, target);
  if (!liveParams.arpActive) {
    // Release first (marks the voice so re-scaling skips it), then let the
    // voices still held ON THAT BUS rise back toward full level.
    actions.rescale(equalPowerVelocityScale(heldCountFor(held, target)), target);
  } else {
    // Arp branch — see handleNoteOn's comment on the arp swallowing the key.
    actions.announce(note);
  }
}

/**
 * The note-on decision, extracted so it is testable without rendering — same
 * reason and same shape as `performNoteOff` above. `target` is the bus
 * ALREADY resolved by the caller (`synthTargetForFocus`/`arpStateRef.current.target`);
 * this function never sees `null`, since the caller's drum no-op returns
 * before reaching it.
 *
 * The re-press guard — releasing the note's PREVIOUS bus when the same note
 * is re-pressed on a new one — runs UNCONDITIONALLY, above the arp split, so
 * both branches see it. It used to sit only inside the non-arp branch: the
 * arp branch overwrote `held`'s entry with no release at all, so a note held
 * with the arp off, then re-pressed on a different bus after focus moved and
 * the arp was switched on, stranded the first bus's sounding voice with no
 * map entry left to reach it — a drone that survived until reload.
 *
 * The old bus is also rescaled after its release: the voices still held
 * there were counted assuming one more voice than is now sounding, so
 * leaving them at the old scale would keep them quieter than equal power
 * calls for. The note is dropped from `held` before that rescale, or
 * `heldCountFor` would still count it as sounding on the bus it just left.
 */
export function performNoteOn(
  note: string,
  target: SynthControlTarget,
  held: HeldNoteTargets,
  liveParams: SynthParams,
  actions: {
    initEngine: () => void;
    playNote: (note: string, target: SynthControlTarget, scale: number) => void;
    releaseNote: (note: string, releaseTime: number, target: SynthControlTarget) => void;
    rescale: (scale: number, target: SynthControlTarget) => void;
    announce: (note: string) => void;
  },
): void {
  actions.initEngine();
  const previous = noteTargetFor(held, note);
  if (previous !== undefined && previous !== target) {
    actions.releaseNote(note, liveParams.release, previous);
    held.delete(note);
    actions.rescale(equalPowerVelocityScale(heldCountFor(held, previous)), previous);
  }
  // Computed AFTER the re-press guard above (which may just have deleted this
  // note from `held` on a cross-bus re-press), not before it: "new" here means
  // new to the bus it is about to sound on, not new to `held` overall — a
  // cross-bus re-press left this false when computed from `previous`, so the
  // arriving bus was never rescaled to include the voice that just landed on
  // it, leaving it a hair quieter than every note already on that bus.
  const isNewNote = !held.has(note);
  if (!liveParams.arpActive) {
    // Equal-power polyphony: a new note lowers every voice held ON THIS BUS
    // so that instrument's total level stays flat as keys are added. The map
    // mirrors the held set synchronously so rapid presses see each other.
    held.set(note, target);
    const scale = equalPowerVelocityScale(heldCountFor(held, target));
    if (isNewNote) {
      actions.rescale(scale, target);
    }
    actions.playNote(note, target, scale);
  } else {
    // The arp swallows the key: it schedules the note itself, so nothing
    // plays it directly and the bus would never hear about a key the user
    // genuinely pressed. Announce it here instead, or arming the recorder
    // with the arp on would silently capture nothing. The map is still
    // written — the arp builds its sequence from the notes held on the bus
    // it is playing.
    held.set(note, target);
    actions.announce(note);
  }
}

export interface InputDeckKeyboardProps {
  keyboardMode: KeyboardMode;
  setKeyboardMode: (mode: KeyboardMode) => void;
  keyboardOctave: number;
  setKeyboardOctave: Dispatch<SetStateAction<number>>;
  activeNotes: Set<string>;
  scaleRoot: string;
  scaleType: string;
  scaleLockedRows: ReturnType<typeof getScaleLockedKeyboardNotes>;
  chordKeyboardRows: ReturnType<typeof getChordKeyboardRows>;
  handleNoteOn: (note: string) => void;
  handleNoteOff: (note: string) => void;
}

export interface InputDeckDrumProps {
  pads: DrumPad[];
  activePadId: string | null;
  onTriggerPad: (pad: DrumPad) => void;
  onPadVolumeChange: (padId: string, volume: number) => void;
}

// The synth params the keyboard/arp actually play: the FOCUSED track's, not
// always Lead's. Routes through `synthTargetForFocus` — the same store-layer
// projection the Pro/Simple panels resolve their channel from — so a drum
// focus is not re-decided here. Its `?? 'synth'` fallback is inert for
// playback: every path that would read this value for a drum focus already
// returns on the `null` before touching it, so which channel it falls back to
// cannot be heard.
//
// Indexes ONE field through the shared SYNTH_PARAM_FIELD map instead of
// building `synthChannelForFocus`'s full 5-channel record: this runs as a raw
// Zustand selector (selectArpActive/selectSynthRelease/subscribeArpState
// below), so it re-executes on every store `set()` for the app's lifetime, not
// just on a relevant change — and the map is the same one engineSync drives
// the engine from, so the arp cannot end up reading a different bus's patch
// than the one being played.
function resolveFocusedSynthParams(s: AppStore): SynthParams {
  return s[SYNTH_PARAM_FIELD[synthTargetForFocus(s.focusTrack) ?? 'synth']];
}

// Named (not inline) so a test can pin their behaviour directly: given two
// `synthParams` objects differing only in a field the hook does not read
// reactively, each selector must still return the SAME primitive — that
// equality is what lets `useAppStore(selectArpActive)` skip a re-render on
// every unrelated knob move.
export const selectArpActive = (s: AppStore): boolean => resolveFocusedSynthParams(s).arpActive;
export const selectSynthRelease = (s: AppStore): number => resolveFocusedSynthParams(s).release;

/**
 * Keeps `arpStateRef.current.params` / `.bpm` / `.target` fresh by IMPERATIVE
 * store subscription instead of by a render-driven effect. The hook used to
 * select the whole `synthParams` object at App level purely to feed this ref,
 * which re-rendered the entire application tree on every knob pointermove.
 * Zustand notifies synchronously on `set()`, so the ref is refreshed strictly
 * EARLIER than the old post-commit effect did it — the arp can never read
 * staler params than before. Same pattern as `useSequencerPlayback.ts:69-78`.
 */
export function subscribeArpState(ref: ArpStateRef): () => void {
  // A single selector over the FOCUSED channel's params, not always
  // `s.synthParams`: this re-fires both when that channel's own params object
  // changes AND when focus moves to a different channel (the selector then
  // returns a different object, e.g. `fxSynthParams` instead of
  // `synthParams`), so one subscription covers both triggers the fix calls
  // for — no separate focus-driven refresh of `.params` is needed.
  const unsubParams = useAppStore.subscribe(
    resolveFocusedSynthParams,
    (params) => {
      ref.current.params = params;
    },
    { fireImmediately: true },
  );
  const unsubBpm = useAppStore.subscribe(
    (s) => s.bpm,
    (bpm) => {
      ref.current.bpm = bpm;
    },
    { fireImmediately: true },
  );
  const unsubFocus = useAppStore.subscribe(
    (s) => s.focusTrack,
    (focus) => {
      ref.current.target = synthTargetForFocus(focus);
    },
    { fireImmediately: true },
  );
  return () => {
    unsubParams();
    unsubBpm();
    unsubFocus();
  };
}

type NoteHandler = (note: string) => void;

/**
 * The note-on/note-off pair every input source calls.
 *
 * Both are `useCallback` with a stable identity: they keep it by reading the
 * live arp state off `arpStateRef` — refreshed by an imperative store
 * subscription rather than by a render dependency — where a version that
 * depended on the params objects changed identity on every knob move and tore
 * down and re-registered the window keydown/keyup listeners ~60 times a second
 * during a drag.
 */
function useNoteHandlers(
  arpStateRef: ArpStateRef,
  setActiveNotes: Dispatch<SetStateAction<Set<string>>>,
): { handleNoteOn: NoteHandler; handleNoteOff: NoteHandler } {
  const handleNoteOn = useCallback(
    (note: string) => {
      // Params come from arpStateRef, kept fresh by an imperative store
      // subscription (subscribeArpState), so this reads the latest value
      // without the callback identity changing on every knob move.
      const liveParams = arpStateRef.current.params;
      // The bus focus names RIGHT NOW. Read once, used for both the engine
      // call and the map entry, so the note is captured on exactly the bus it
      // was played on even if focus moves during this callback.
      const target = arpStateRef.current.target;
      if (target === null) {
        // Focus is on the drum track: the melodic keyboard has nothing to
        // play. Nothing sounds, nothing is announced on the note-input bus
        // (announcing would let the recorder capture a note that made no
        // sound), and the key is not added to activeNotes — a highlighted key
        // that plays nothing is the invisible state this change removes.
        // Its note-off then finds no map entry and is a no-op, so the two
        // edges stay symmetric. The QWERTY drum PADS are a separate listener
        // over a disjoint key set and keep working.
        return;
      }
      const held = arpStateRef.current.heldTargets;
      performNoteOn(note, target, held, liveParams, {
        initEngine: initSynthPlayback,
        playNote: (n, t, scale) => synthPlaybackNoteOn(n, liveParams, 1.0, undefined, t, scale),
        releaseNote: (n, releaseTime, t) => synthPlaybackNoteOff(n, releaseTime, undefined, t),
        rescale: (scale, t) => applySynthPlaybackVelocityScale(scale, t),
        announce: (n) => emitNoteInput({ kind: 'on', note: n, velocity: 1.0 }),
      });
      setActiveNotes((prev) => new Set(prev).add(note));
    },
    [arpStateRef, setActiveNotes],
  );

  const handleNoteOff = useCallback(
    (note: string) => {
      // Same ref read as handleNoteOn — see the note there.
      const liveParams = arpStateRef.current.params;
      const held = arpStateRef.current.heldTargets;
      // The bus this note was PLAYED on, never the bus focus names right now:
      // recomputing would send the release to an engine the voice was never
      // on and the held voice would drone until the same key was pressed
      // again on the same track. See audio/playback/heldNotes.ts and
      // performNoteOff above.
      performNoteOff(note, held, liveParams, {
        releaseNote: (n, releaseTime, target) =>
          synthPlaybackNoteOff(n, releaseTime, undefined, target),
        rescale: (scale, target) => applySynthPlaybackVelocityScale(scale, target),
        announce: (n) => emitNoteInput({ kind: 'off', note: n, velocity: 0 }),
      });
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    },
    [arpStateRef, setActiveNotes],
  );

  return { handleNoteOn, handleNoteOff };
}

interface HeldNoteRelease {
  arpStateRef: ArpStateRef;
  /** Held key code → the exact notes it played, so key-up never recomputes a chord. */
  chordKeyNotesRef: React.RefObject<Map<string, string[]>>;
  handleNoteOff: NoteHandler;
  keyboardMode: KeyboardMode;
}

/**
 * The two backstops for a release gesture that never arrives.
 *
 * A keyboard-mode change (and the unmount that ends this hook) releases every
 * note still sounding and clears the chord key-tracking ref: without it, a mode
 * switch while a key is held leaves its voices hanging forever, because the
 * key-up handler that would have released them now branches on the NEW mode and
 * finds nothing to release. Separately, Cmd-Tab / alt-tab / an OS dialog steals
 * the keyup that would have released a held note, and window blur plus
 * visibilitychange (tab hidden) are the only two signals a page gets for "the
 * user is no longer interacting with this tab" — so both release everything
 * held. Both read the refs at cleanup time, because that is when the live set
 * is the one to release.
 */
function useHeldNoteRelease({
  arpStateRef,
  chordKeyNotesRef,
  handleNoteOff,
  keyboardMode,
}: HeldNoteRelease): void {
  // Kept fresh every render so the mode-change release effect below always
  // calls the latest handleNoteOff without needing it in its dependency array
  // (which would fire the release on every params/controlTarget change, not
  // just on an actual mode switch).
  const handleNoteOffRef = useRef(handleNoteOff);
  useEffect(() => {
    handleNoteOffRef.current = handleNoteOff;
  });

  useEffect(() => {
    return () => {
      // The notes to release are whichever are held WHEN the mode changes, so
      // both refs must be read at cleanup time; a copy taken at effect setup
      // would release the wrong set and clear the wrong map.
      releaseAllHeldNotes(arpStateRef.current.heldTargets.keys(), handleNoteOffRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- read at cleanup time by design
      chordKeyNotesRef.current.clear();
      // Cleared with it: handleNoteOff deletes each note it releases, but a
      // note released by any other path would otherwise leave a stale entry
      // naming a bus that has nothing sounding on it.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- read at cleanup time by design
      arpStateRef.current.heldTargets.clear();
    };
    // The two refs are parameters here, so the rule asks for them by name; both
    // are the caller's `useRef` objects, whose identity never changes.
  }, [keyboardMode, arpStateRef, chordKeyNotesRef]);

  useEffect(() => {
    const releaseHeld = () => {
      releaseAllHeldNotes(arpStateRef.current.heldTargets.keys(), handleNoteOffRef.current);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) releaseHeld();
    };
    window.addEventListener('blur', releaseHeld);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('blur', releaseHeld);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [arpStateRef]);
}

/** The chord / scale-locked / chromatic note tables for the current key and octave. */
function useKeyboardNoteTables(scaleRoot: string, scaleType: string, keyboardOctave: number) {
  // The keyboard listeners below used to rebuild these from tonal on every
  // keystroke, and the rows variant was called fresh in the JSX on every
  // render while its sibling chordKeyboardRows was already memoized.
  const chordKeyboardRows = useMemo(
    () => getChordKeyboardRows(scaleRoot, scaleType, keyboardOctave),
    [scaleRoot, scaleType, keyboardOctave],
  );
  const scaleLockedNotesFlat = useMemo(
    () => getScaleLockedKeyboardNotesFlat(scaleRoot, scaleType, keyboardOctave),
    [scaleRoot, scaleType, keyboardOctave],
  );
  const scaleLockedRows = useMemo(
    () => getScaleLockedKeyboardNotes(scaleRoot, scaleType, keyboardOctave),
    [scaleRoot, scaleType, keyboardOctave],
  );
  const chromaticNotes = useMemo(
    () => getChromaticKeyboardNotes(keyboardOctave),
    [keyboardOctave],
  );
  return { chordKeyboardRows, scaleLockedNotesFlat, scaleLockedRows, chromaticNotes };
}

interface QwertyNoteListeners {
  keyboardMode: KeyboardMode;
  chordKeyboardRows: ReturnType<typeof getChordKeyboardRows>;
  scaleLockedNotesFlat: ReturnType<typeof getScaleLockedKeyboardNotesFlat>;
  chromaticNotes: ReturnType<typeof getChromaticKeyboardNotes>;
  chordKeyNotesRef: React.RefObject<Map<string, string[]>>;
  setKeyboardOctave: Dispatch<SetStateAction<number>>;
  handleNoteOn: NoteHandler;
  handleNoteOff: NoteHandler;
}

/**
 * The computer keyboard's note listener. A key that means nothing in the
 * current mode is a no-op, and in chord mode the notes a key played are
 * captured at key-down so key-up releases exactly those, whatever the key,
 * scale or octave has become since.
 */
function useQwertyNoteListeners({
  keyboardMode,
  chordKeyboardRows,
  scaleLockedNotesFlat,
  chromaticNotes,
  chordKeyNotesRef,
  setKeyboardOctave,
  handleNoteOn,
  handleNoteOff,
}: QwertyNoteListeners): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.repeat) return;
      if (e.code === 'Minus') {
        setKeyboardOctave((o) => clampKeyboardOctave(o - 1));
        return;
      }
      if (e.code === 'Equal') {
        setKeyboardOctave((o) => clampKeyboardOctave(o + 1));
        return;
      }
      if (keyboardMode === 'chord') {
        const rows = chordKeyboardRows;
        const btn = [...rows.triadRow, ...rows.melodyRow].find(
          (b) => b.key === e.code,
        );
        if (btn) {
          chordKeyNotesRef.current.set(e.code, btn.notes);
          btn.notes.forEach((n) => handleNoteOn(n));
        }
        return;
      }
      const notesList =
        keyboardMode === 'scale-locked' ? scaleLockedNotesFlat : chromaticNotes;
      const keyObj = notesList.find((n) => n.key === e.code);
      if (keyObj) {
        handleNoteOn(keyObj.note);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (keyboardMode === 'chord') {
        const held = chordKeyNotesRef.current.get(e.code);
        if (held) {
          chordKeyNotesRef.current.delete(e.code);
          held.forEach((n) => handleNoteOff(n));
        }
        return;
      }
      const notesList =
        keyboardMode === 'scale-locked' ? scaleLockedNotesFlat : chromaticNotes;
      const keyObj = notesList.find((n) => n.key === e.code);
      if (keyObj) {
        handleNoteOff(keyObj.note);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    // handleNoteOn/handleNoteOff are useCallback with a stable identity, so
    // they never change — kept here because the effect genuinely calls them.
    // scaleRoot, scaleType and keyboardOctave are no longer read directly: they
    // reach the handlers through the tables above, which change identity only
    // when the notes actually change. keyboardOctave is still *written* by
    // handleKeyDown, but only through the setKeyboardOctave((o) => ...) updater
    // form, which never reads the current value from the closure. The two refs
    // are the caller's `useRef` objects — named here because they are
    // parameters, and never re-created.
    handleNoteOn,
    handleNoteOff,
    keyboardMode,
    chordKeyboardRows,
    scaleLockedNotesFlat,
    chromaticNotes,
    chordKeyNotesRef,
    setKeyboardOctave,
  ]);
}

/**
 * Drum pad state and the QWERTY drum listener (verbatim from DrumPads,
 * including the isTypingTarget guard, the e.repeat skip and the [pads,
 * triggerPad] deps). Returns the memoized prop bundle the dock renders from:
 * App mounts every tab at once and calls this hook once at the top, so a fresh
 * object per render would defeat React.memo on every consumer downstream no
 * matter how stable their other props are.
 */
function useDrumPads(): InputDeckDrumProps {
  const [pads, setPads] = useState<DrumPad[]>(DEFAULT_PADS);
  const [activePadId, setActivePadId] = useState<string | null>(null);

  const triggerPad = useCallback((pad: DrumPad) => {
    ensureDrumEngine();
    triggerDrumPad(pad.note, pad.volume);
    setActivePadId(pad.id);
    setTimeout(() => setActivePadId(null), 150);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.repeat) return;
      const pad = pads.find((p) => p.shortcut === e.code);
      if (pad) {
        triggerPad(pad);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pads, triggerPad]);

  const handlePadVolumeChange = useCallback((padId: string, volume: number) => {
    setPads((prev) => prev.map((p) => (p.id === padId ? { ...p, volume } : p)));
  }, []);

  return useMemo<InputDeckDrumProps>(
    () => ({
      pads,
      activePadId,
      onTriggerPad: triggerPad,
      onPadVolumeChange: handlePadVolumeChange,
    }),
    [pads, activePadId, triggerPad, handlePadVolumeChange],
  );
}

/** Plays notes (synth + drums) and owns the global QWERTY listeners. Mounted
 *  exactly once, at App level. The dock is a purely visual surface — it never
 *  gates these listeners. */
export function useInputDeck(): {
  keyboardProps: InputDeckKeyboardProps;
  drumProps: InputDeckDrumProps;
} {
  const keyboardMode = useAppStore((s) => s.keyboardMode);
  const setKeyboardMode = useAppStore((s) => s.setKeyboardMode);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  // Deliberately two PRIMITIVE selectors, not `(s) => s.synthParams`. This hook
  // is mounted in App, and `synthParams` is a fresh object on every knob
  // pointermove (60-120 Hz), so selecting the object re-rendered App and with
  // it SoundView + SequencerView + ArrangeView + BottomInputDock — three of
  // them on hidden tabs. These two scalars are the ONLY reactive reads; the
  // full params object reaches the arp through arpStateRef below.
  const arpActive = useAppStore(selectArpActive);
  const release = useAppStore(selectSynthRelease);

  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  // Keyboard display octave — independent from synth pitch octave (params.octave)
  const [keyboardOctave, setKeyboardOctave] = useState<number>(0);
  // Chord mode: maps a held KeyboardEvent.code to the exact notes it played,
  // so key-up releases those notes even if key/scale/octave changed while the
  // key was held — never recompute the chord at release time.
  const chordKeyNotesRef = useRef<Map<string, string[]>>(new Map());

  // Keep the live arp state in a ref so the clock listener reads it without
  // re-subscribing or stopping voices on every keystroke or parameter tweak.
  // `heldTargets` is written synchronously by handleNoteOn/handleNoteOff — in
  // the arp branch too, which is why the old commit-time mirror of
  // `activeNotes` is gone: the arp builds its sequence from this map, so it
  // must never lag a keypress by a render.
  const arpStateRef = useRef<ArpStateRef['current']>({
    heldTargets: new Map(),
    params: resolveFocusedSynthParams(useAppStore.getState()),
    target: synthTargetForFocus(useAppStore.getState().focusTrack),
    triggeredTargets: new Set(),
    bpm: useAppStore.getState().bpm,
  });
  // params/bpm/target come straight off the store — no render subscription needed.
  useEffect(() => subscribeArpState(arpStateRef), []);

  const { handleNoteOn, handleNoteOff } = useNoteHandlers(arpStateRef, setActiveNotes);

  // Arpeggiator playback: parameterized clock subscriber (the 4 rate branches
  // collapsed into computeArpTriggers, proven equivalent by the exhaustive
  // sweep in src/audio/playback/arpPlayback.test.ts)
  useArpPlayback(arpStateRef, arpActive);

  // Both backstops for a release gesture that never arrives: release every note
  // still sounding when the keyboard mode changes or this hook's owner unmounts,
  // and release everything held when the window loses focus.
  useHeldNoteRelease({ arpStateRef, chordKeyNotesRef, handleNoteOff, keyboardMode });

  // Silence lingering arp voices when all keys are released in arp mode.
  // Releases every bus the arp actually triggered on — a hold that spanned a
  // focus change left voices on more than one.
  useEffect(() => {
    if (arpActive && activeNotes.size === 0 && hasSynthPlaybackContext()) {
      releaseTriggeredTargets(
        arpStateRef.current.triggeredTargets,
        release,
        releaseSynthPlaybackVoices,
      );
    }
  }, [arpActive, activeNotes.size, release]);

  const { chordKeyboardRows, scaleLockedNotesFlat, scaleLockedRows, chromaticNotes } =
    useKeyboardNoteTables(scaleRoot, scaleType, keyboardOctave);

  // QWERTY Computer Keyboard mapping — uses keyboardOctave, NOT params.octave
  useQwertyNoteListeners({
    keyboardMode,
    chordKeyboardRows,
    scaleLockedNotesFlat,
    chromaticNotes,
    chordKeyNotesRef,
    setKeyboardOctave,
    handleNoteOn,
    handleNoteOff,
  });

  // Drums: pad state + trigger, and the QWERTY drum listener (verbatim from
  // DrumPads, including the isTypingTarget guard, e.repeat skip, and the
  // [pads, triggerPad] deps).
  const drumProps = useDrumPads();

  // App mounts every tab simultaneously and calls this hook once at the top,
  // so a fresh object here on every render defeats React.memo on every
  // consumer downstream no matter how stable their other props are.
  const keyboardProps = useMemo<InputDeckKeyboardProps>(
    () => ({
      keyboardMode,
      setKeyboardMode,
      keyboardOctave,
      setKeyboardOctave,
      activeNotes,
      scaleRoot,
      scaleType,
      scaleLockedRows,
      chordKeyboardRows,
      handleNoteOn,
      handleNoteOff,
    }),
    [
      keyboardMode,
      setKeyboardMode,
      keyboardOctave,
      setKeyboardOctave,
      activeNotes,
      scaleRoot,
      scaleType,
      scaleLockedRows,
      chordKeyboardRows,
      handleNoteOn,
      handleNoteOff,
    ],
  );

  return { keyboardProps, drumProps };
}

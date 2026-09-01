import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { equalPowerVelocityScale } from '../audio/rhythmPatterns';
import { useArpPlayback, type ArpStateRef } from '../audio/playback/arpPlayback';
import {
  applySynthPlaybackVelocityScale,
  hasSynthPlaybackContext,
  initSynthPlayback,
  releaseSynthPlaybackVoices,
  synthPlaybackNoteOff,
  synthPlaybackNoteOn,
} from '../audio/playback/synthPlayback';
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
import type { DrumPad, KeyboardMode } from '../types';
import type { SynthControlTarget } from '../utils/synthControl';
import { isTypingTarget } from '../utils/keyboard';
import { DEFAULT_PADS } from './ui/DrumPadGrid';

// The interactive keyboard always plays the main synth, regardless of which
// destination the panel's "Target" selector is currently editing — pinning it
// here (instead of routing through `controlTarget`) keeps every audio call
// site (note-on, note-off, arp playback, voice release) agreeing on one
// engine, so a mode/target switch can never strand voices on an engine nothing
// points at anymore (copied verbatim from SynthView).
const KEYBOARD_AUDITION_TARGET: SynthControlTarget = 'synth';

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

// Named (not inline) so a test can pin their behaviour directly: given two
// `synthParams` objects differing only in a field the hook does not read
// reactively, each selector must still return the SAME primitive — that
// equality is what lets `useAppStore(selectArpActive)` skip a re-render on
// every unrelated knob move.
export const selectArpActive = (s: AppStore): boolean => s.synthParams.arpActive;
export const selectSynthRelease = (s: AppStore): number => s.synthParams.release;

/**
 * Keeps `arpStateRef.current.params` / `.bpm` fresh by IMPERATIVE store
 * subscription instead of by a render-driven effect. The hook used to select
 * the whole `synthParams` object at App level purely to feed this ref, which
 * re-rendered the entire application tree on every knob pointermove. Zustand
 * notifies synchronously on `set()`, so the ref is refreshed strictly EARLIER
 * than the old post-commit effect did it — the arp can never read staler
 * params than before. Same pattern as `useSequencerPlayback.ts:69-78`.
 */
export function subscribeArpState(ref: ArpStateRef): () => void {
  const unsubParams = useAppStore.subscribe(
    (s) => s.synthParams,
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
  return () => {
    unsubParams();
    unsubBpm();
  };
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
  // The keyboard always auditions the main synth (KEYBOARD_AUDITION_TARGET),
  // regardless of which destination the panel's Target selector is editing.
  //
  // Deliberately two PRIMITIVE selectors, not `(s) => s.synthParams`. This hook
  // is mounted in App, and `synthParams` is a fresh object on every knob
  // pointermove (60-120 Hz), so selecting the object re-rendered App and with
  // it SynthView + SequencerView + ArrangeView + BottomInputDock — three of
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

  // Keep latest params and activeNotes in a ref so the clock listener reads live state
  // without re-subscribing or stopping voices on every keystroke/parameter tweak.
  // params/controlTarget here are always the keyboard's own (main synth) channel,
  // never the panel's currently-edited target — see KEYBOARD_AUDITION_TARGET.
  const arpStateRef = useRef({
    activeNotes,
    params: useAppStore.getState().synthParams,
    controlTarget: KEYBOARD_AUDITION_TARGET,
    bpm: useAppStore.getState().bpm,
  });
  // activeNotes is React state, so it still needs a commit-time mirror.
  useEffect(() => {
    arpStateRef.current.activeNotes = activeNotes;
  }, [activeNotes]);
  // params/bpm come straight off the store — no render subscription needed.
  useEffect(() => subscribeArpState(arpStateRef), []);

  // The keyboard always auditions the main synth (KEYBOARD_AUDITION_TARGET),
  // regardless of which destination the Target selector is currently editing.
  const handleNoteOn = useCallback(
    (note: string) => {
      // Params come from arpStateRef, kept fresh by an imperative store
      // subscription (subscribeArpState) rather than a render dependency, so
      // this reads the latest value without the callback identity changing
      // on every knob move — which used to tear down and re-register the
      // window keydown/keyup listeners ~60 times a second during a drag.
      const liveParams = arpStateRef.current.params;
      initSynthPlayback();
      if (!liveParams.arpActive) {
        // Equal-power polyphony: a new note lowers every held voice so the
        // total level stays flat as keys are added. The ref mirrors
        // activeNotes synchronously so rapid presses see each other.
        const held = arpStateRef.current.activeNotes;
        const isNewNote = !held.has(note);
        held.add(note);
        const scale = equalPowerVelocityScale(held.size);
        if (isNewNote) {
          applySynthPlaybackVelocityScale(scale);
        }
        synthPlaybackNoteOn(
          note,
          liveParams,
          1.0,
          undefined,
          KEYBOARD_AUDITION_TARGET,
          scale,
        );
      }
      setActiveNotes((prev) => new Set(prev).add(note));
    },
    [],
  );

  const handleNoteOff = useCallback(
    (note: string) => {
      // Same ref read as handleNoteOn — see the note there.
      const liveParams = arpStateRef.current.params;
      const held = arpStateRef.current.activeNotes;
      const wasHeld = held.delete(note);
      if (wasHeld && !liveParams.arpActive) {
        // Release first (marks the voice so re-scaling skips it), then let
        // the remaining held voices rise back toward full level.
        synthPlaybackNoteOff(
          note,
          liveParams.release,
          undefined,
          KEYBOARD_AUDITION_TARGET,
        );
        applySynthPlaybackVelocityScale(equalPowerVelocityScale(held.size));
      }
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    },
    [],
  );

  // Arpeggiator playback: parameterized clock subscriber (the 4 rate branches
  // collapsed into computeArpTriggers, proven equivalent by the exhaustive
  // sweep in src/audio/playback/arpPlayback.test.ts)
  useArpPlayback(arpStateRef, arpActive);

  // Kept fresh every render so the mode-change release effect below always
  // calls the latest handleNoteOff without needing it in its dependency array
  // (which would fire the release on every params/controlTarget change, not
  // just on an actual mode switch).
  const handleNoteOffRef = useRef(handleNoteOff);
  useEffect(() => {
    handleNoteOffRef.current = handleNoteOff;
  });

  // Bug fix: release every note still sounding whenever the keyboard mode
  // changes (or this hook's owner unmounts), and clear the chord key-tracking
  // ref. Without this, a mode switch while a key/button is held leaves its
  // voices hanging forever — the key-up/pointer-up handler that would have
  // released them now branches on the *new* mode and finds nothing to release.
  useEffect(() => {
    return () => {
      const held = notesToReleaseOnKeyboardModeChange(
        arpStateRef.current.activeNotes,
      );
      held.forEach((note) => handleNoteOffRef.current(note));
      chordKeyNotesRef.current.clear();
    };
  }, [keyboardMode]);

  // Silence lingering arp voices when all keys are released in arp mode.
  // Always the keyboard's own (main synth) channel — see KEYBOARD_AUDITION_TARGET.
  useEffect(() => {
    if (arpActive && activeNotes.size === 0 && hasSynthPlaybackContext()) {
      releaseSynthPlaybackVoices(KEYBOARD_AUDITION_TARGET, release);
    }
  }, [arpActive, activeNotes.size, release]);

  const chordKeyboardRows = useMemo(
    () => getChordKeyboardRows(scaleRoot, scaleType, keyboardOctave),
    [scaleRoot, scaleType, keyboardOctave],
  );

  // The keyboard handlers below used to rebuild these from tonal on every
  // keystroke, and the rows variant was called fresh in the JSX on every
  // render while its sibling chordKeyboardRows was already memoized.
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

  // QWERTY Computer Keyboard mapping — uses keyboardOctave, NOT params.octave
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
    // handleNoteOn/handleNoteOff are useCallback([]) now, so they never
    // change — kept here because the effect genuinely calls them. scaleRoot,
    // scaleType and keyboardOctave are no longer read directly: they reach
    // the handlers through the three memos above, which change identity only
    // when the notes actually change. keyboardOctave is still *written* by
    // handleKeyDown, but only through the setKeyboardOctave((o) => ...)
    // updater form, which never reads the current value from the closure.
    handleNoteOn,
    handleNoteOff,
    keyboardMode,
    chordKeyboardRows,
    scaleLockedNotesFlat,
    chromaticNotes,
  ]);

  // Cmd-Tab / alt-tab / an OS-level dialog steals the keyup that would have
  // released a held note — window blur and visibilitychange (tab hidden) are
  // the only two signals a page gets for "the user is no longer interacting
  // with this tab", so both release every held note. Reads activeNotes from
  // the ref (not the closed-over activeNotes state) for the same reason
  // handleNoteOn/handleNoteOff already do — see the comment above arpStateRef.
  useEffect(() => {
    const releaseHeld = () => {
      releaseAllHeldNotes(arpStateRef.current.activeNotes, handleNoteOffRef.current);
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
  }, []);

  // Drums: pad state + trigger, and the QWERTY drum listener (verbatim from
  // DrumPads, including the isTypingTarget guard, e.repeat skip, and the
  // [pads, triggerPad] deps).
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

  const drumProps = useMemo<InputDeckDrumProps>(
    () => ({
      pads,
      activePadId,
      onTriggerPad: triggerPad,
      onPadVolumeChange: handlePadVolumeChange,
    }),
    [pads, activePadId, triggerPad, handlePadVolumeChange],
  );

  return { keyboardProps, drumProps };
}

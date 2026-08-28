import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Suspense,
} from "react";
import {
  Sliders,
  Activity,
  Zap,
  Volume2,
  Sparkles,
  Bookmark,
  Library,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { equalPowerVelocityScale } from "../audio/rhythmPatterns";
import { useArpPlayback } from "../audio/playback/arpPlayback";
import {
  applySynthPlaybackVelocityScale,
  hasSynthPlaybackContext,
  initSynthPlayback,
  releaseSynthPlaybackVoices,
  synthPlaybackNoteOff,
  synthPlaybackNoteOn,
} from "../audio/playback/synthPlayback";
import { useAppStore } from "../store/store";
import {
  SynthPresetItem,
  SynthPresetCategory,
  SYNTH_CATEGORIES,
  applyPreset,
  findPresetByName,
  getAllSynthPresets,
  getPresetsGroupedByCategory,
  getCategoryMeta,
} from "../audio/synthPresets";
// The drawer is never needed on first paint — PresetLibrary early-returns
// null when closed — so it is code-split out of the main chunk.
const SynthPresetLibrary = React.lazy(() =>
  import("./SynthPresetLibrary").then((m) => ({ default: m.SynthPresetLibrary })),
);
import { AudioVisualizer } from "./AudioVisualizer";
import { SimpleSynthPanel } from "./SimpleSynthPanel";
import { Knob } from "./ui/Knob";
import { ChannelStrip } from "./ui/ChannelStrip";
import { QuickSavePopover } from "./ui/QuickSavePopover";
import { ViewHeader } from "./ui/ViewHeader";
import { COUNT_BADGE, SECTION_HEADER, STEP_BADGE } from "./ui/fieldClasses";
import {
  clampKeyboardOctave,
  getScaleLockedKeyboardNotes,
  getScaleLockedKeyboardNotesFlat,
  getChromaticKeyboardNotes,
  getChordKeyboardRows,
  ScaleLockedKeyboard,
  ChromaticKeyboard,
  ChordKeyboard,
} from "./ui/Keyboard";

// Re-exported for scripts/check-key-bindings.ts, which asserts that the synth
// key bindings never collide with the drum-pad shortcuts. The table itself
// lives in ui/Keyboard.tsx; this is the historical import path.
export { KEYBOARD_NOTES } from "./ui/Keyboard";
import { isTypingTarget } from "../utils/keyboard";
import {
  resolveSynthControlChannel,
  SYNTH_TARGET_STYLES,
} from "../utils/synthControl";
import type { SynthControlTarget } from "../utils/synthControl";

// The interactive keyboard always plays the main synth, regardless of which
// destination the "Target" selector is currently editing — pinning it here
// (instead of routing through `controlTarget`) keeps every audio call site
// (note-on, note-off, arp playback, voice release) agreeing on one engine, so
// a mode/target switch can never strand voices on an engine nothing points at
// anymore.
const KEYBOARD_AUDITION_TARGET: SynthControlTarget = "synth";

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

export const SynthView = () => {
  // Synth slice state + setters (named after the old props so the rest of the
  // component body is unchanged).
  const controlTarget = useAppStore((s) => s.controlTarget);
  // App keeps every view mounted (block/hidden) so audio survives a tab
  // switch, which means the scope's rAF loop must be gated on this or it
  // runs forever behind a hidden tab.
  const activeTab = useAppStore((s) => s.activeTab);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const onChangeControlTarget = useAppStore((s) => s.setControlTarget);
  const onChangeSynthParams = useAppStore((s) => s.setSynthParams);
  const onChangeChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const onChangeBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const bpm = useAppStore((s) => s.bpm);
  const synthVolume = useAppStore((s) => s.synthVolume);
  const setSynthVolume = useAppStore((s) => s.setSynthVolume);
  const chordVolume = useAppStore((s) => s.chordVolume);
  const setChordVolume = useAppStore((s) => s.setChordVolume);
  const bassVolume = useAppStore((s) => s.bassVolume);
  const setBassVolume = useAppStore((s) => s.setBassVolume);

  const activeTargetVolumeConfig = useMemo(() => {
    switch (controlTarget) {
      case "chord":
        return {
          idPrefix: "chord",
          volume: chordVolume,
          onVolumeChange: setChordVolume,
          accentClass: "text-module-chord" as const,
          sliderClassName:
            "range range-xs text-module-chord [--range-thumb:var(--color-module-chord-content)]",
        };
      case "bass":
        return {
          idPrefix: "bass",
          volume: bassVolume,
          onVolumeChange: setBassVolume,
          accentClass: "text-module-bass" as const,
          sliderClassName:
            "range range-xs text-module-bass [--range-thumb:var(--color-module-bass-content)]",
        };
      case "synth":
      default:
        return {
          idPrefix: "synth",
          volume: synthVolume,
          onVolumeChange: setSynthVolume,
          accentClass: "text-primary" as const,
          sliderClassName: "range range-xs range-primary",
        };
    }
  }, [
    controlTarget,
    synthVolume,
    setSynthVolume,
    chordVolume,
    setChordVolume,
    bassVolume,
    setBassVolume,
  ]);

  // Route the control panel (knobs, preset selects) to the selected
  // destination; the keyboard always plays the main synth (see handleNoteOn).
  const channels = {
    synth: { params: synthParams, setParams: onChangeSynthParams },
    chord: { params: chordSynthParams, setParams: onChangeChordSynthParams },
    bass: { params: bassSynthParams, setParams: onChangeBassSynthParams },
  };
  const channel = resolveSynthControlChannel(controlTarget, channels);
  const params = channel.params;
  const onChangeParams = channel.setParams;

  // The keyboard's own channel is always the main synth, independent of the
  // panel's target selector above (see KEYBOARD_AUDITION_TARGET).
  const keyboardChannel = resolveSynthControlChannel(
    KEYBOARD_AUDITION_TARGET,
    channels,
  );
  const keyboardParams = keyboardChannel.params;

  const tintClass = [
    SYNTH_TARGET_STYLES[controlTarget].ring,
    SYNTH_TARGET_STYLES[controlTarget].tint,
  ]
    .filter(Boolean)
    .join(" ");
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [customPresets, setCustomPresets] = useState<SynthPresetItem[]>([]);
  const allPresets = useMemo(
    () => getAllSynthPresets(customPresets),
    [customPresets],
  );
  const [selectedCategoryFilter, setSelectedCategoryFilter] =
    useState<string>("All");
  const [quickSaveCategory, setQuickSaveCategory] =
    useState<SynthPresetCategory>("User");
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>("");
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const keyboardMode = useAppStore((s) => s.keyboardMode);
  const setKeyboardMode = useAppStore((s) => s.setKeyboardMode);
  // Chord mode: maps a held KeyboardEvent.code to the exact notes it played,
  // so key-up releases those notes even if key/scale/octave changed while
  // the key was held — never recompute the chord at release time.
  const chordKeyNotesRef = useRef<Map<string, string[]>>(new Map());
  // Keyboard display octave — independent from synth pitch octave (params.octave)
  const [keyboardOctave, setKeyboardOctave] = useState<number>(0);

  // Simple vs Pro UI Mode toggle with localStorage persistence
  const [synthViewMode, setSynthViewMode] = useState<"simple" | "pro">(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = localStorage.getItem("musibox_synth_view_mode") || localStorage.getItem("murva_synth_view_mode");
      if (stored === "simple" || stored === "pro") return stored;
    }
    return "simple";
  });

  const handleToggleSynthViewMode = (mode: "simple" | "pro") => {
    setSynthViewMode(mode);
    try {
      localStorage.setItem("musibox_synth_view_mode", mode);
    } catch {
      // best-effort: ignore localStorage failures (e.g. private mode)
    }
  };

  // Sync custom presets from local storage
  const reloadPresets = useCallback(() => {
    setCustomPresets(useAppStore.getState().customSynthPresets);
  }, []);

  useEffect(() => {
    reloadPresets();
  }, [reloadPresets, isLibraryOpen]);

  const categoryGroups = useMemo(
    () => getPresetsGroupedByCategory(allPresets),
    [allPresets],
  );

  const activePresetItem = useMemo(
    () => findPresetByName(params.preset, allPresets),
    [params.preset, allPresets],
  );

  const activeCategoryMeta = useMemo(() => {
    if (!activePresetItem) return null;
    return getCategoryMeta(activePresetItem.category);
  }, [activePresetItem]);

  // Presets list based on selectedCategoryFilter for step navigation
  const selectablePresets = useMemo(() => {
    if (selectedCategoryFilter === "All") return allPresets;
    if (selectedCategoryFilter === "User")
      return allPresets.filter((p) => !p.isFactory || p.category === "User");
    return allPresets.filter((p) => p.category === selectedCategoryFilter);
  }, [selectedCategoryFilter, allPresets]);

  const handleCategoryFilterClick = (catId: string) => {
    setSelectedCategoryFilter(catId);
    if (catId === "All") return;
    const matching =
      catId === "User"
        ? allPresets.filter((p) => !p.isFactory || p.category === "User")
        : allPresets.filter((p) => p.category === catId);
    if (matching.length > 0) {
      const currentInCat = matching.some((p) => p.name === params.preset);
      if (!currentInCat) {
        handleSelectPreset(matching[0]);
      }
    }
  };

  const handleStepPreset = (direction: -1 | 1) => {
    if (selectablePresets.length === 0) return;
    const currentIndex = selectablePresets.findIndex(
      (p) => p.name === params.preset,
    );
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = selectablePresets.length - 1;
    if (nextIndex >= selectablePresets.length) nextIndex = 0;
    handleSelectPreset(selectablePresets[nextIndex]);
  };

  // Keep latest params and activeNotes in a ref so the clock listener reads live state
  // without re-subscribing or stopping voices on every keystroke/parameter tweak.
  // params/controlTarget here are always the keyboard's own (main synth) channel,
  // never the panel's currently-edited target — see KEYBOARD_AUDITION_TARGET.
  const arpStateRef = useRef({
    activeNotes,
    params: keyboardParams,
    controlTarget: KEYBOARD_AUDITION_TARGET,
    bpm,
  });
  useEffect(() => {
    arpStateRef.current = {
      activeNotes,
      params: keyboardParams,
      controlTarget: KEYBOARD_AUDITION_TARGET,
      bpm,
    };
  });

  // The keyboard always auditions the main synth (KEYBOARD_AUDITION_TARGET),
  // regardless of which destination the Target selector is currently editing.
  const handleNoteOn = useCallback(
    (note: string) => {
      // Params come from arpStateRef, refreshed by an unconditional effect
      // after every commit, so this reads exactly the value the closure used
      // to capture — but the callback identity no longer changes on every
      // knob move, which used to tear down and re-register the window
      // keydown/keyup listeners ~60 times a second during a drag.
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
  useArpPlayback(arpStateRef, keyboardParams.arpActive);

  // Kept fresh every render so the mode-change release effect below always
  // calls the latest handleNoteOff without needing it in its dependency array
  // (which would fire the release on every params/controlTarget change, not
  // just on an actual mode switch).
  const handleNoteOffRef = useRef(handleNoteOff);
  useEffect(() => {
    handleNoteOffRef.current = handleNoteOff;
  });

  // Bug fix: release every note still sounding whenever the keyboard mode
  // changes (or this view unmounts), and clear the chord key-tracking ref.
  // Without this, a mode switch while a key/button is held leaves its voices
  // hanging forever — the key-up/pointer-up handler that would have released
  // them now branches on the *new* mode and finds nothing to release.
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
    if (
      keyboardParams.arpActive &&
      activeNotes.size === 0 &&
      hasSynthPlaybackContext()
    ) {
      releaseSynthPlaybackVoices(KEYBOARD_AUDITION_TARGET, keyboardParams.release);
    }
  }, [keyboardParams.arpActive, activeNotes.size, keyboardParams.release]);

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
      if (e.code === "Minus") {
        setKeyboardOctave((o) => clampKeyboardOctave(o - 1));
        return;
      }
      if (e.code === "Equal") {
        setKeyboardOctave((o) => clampKeyboardOctave(o + 1));
        return;
      }
      if (keyboardMode === "chord") {
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
        keyboardMode === "scale-locked" ? scaleLockedNotesFlat : chromaticNotes;
      const keyObj = notesList.find((n) => n.key === e.code);
      if (keyObj) {
        handleNoteOn(keyObj.note);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (keyboardMode === "chord") {
        const held = chordKeyNotesRef.current.get(e.code);
        if (held) {
          chordKeyNotesRef.current.delete(e.code);
          held.forEach((n) => handleNoteOff(n));
        }
        return;
      }
      const notesList =
        keyboardMode === "scale-locked" ? scaleLockedNotesFlat : chromaticNotes;
      const keyObj = notesList.find((n) => n.key === e.code);
      if (keyObj) {
        handleNoteOff(keyObj.note);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
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

  const handleSelectPreset = (preset: SynthPresetItem) => {
    onChangeParams(applyPreset(params, preset));
    setSaveToast(`Loaded [${preset.category}] "${preset.name}"`);
    setTimeout(() => setSaveToast(null), 2500);
  };

  const handleDropdownChange = (name: string) => {
    const preset = findPresetByName(name, allPresets);
    if (preset) handleSelectPreset(preset);
  };

  const handleQuickSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSaveName.trim()) return;

    const saved = useAppStore.getState().saveCustomPreset(quickSaveName, params, quickSaveCategory);
    reloadPresets();
    setIsQuickSaving(false);
    setQuickSaveName("");
    handleSelectPreset(saved);
    setSaveToast(`Preset "${saved.name}" saved to ${saved.category}!`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const totalPresetsCount = allPresets.length;

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* Synth Lab Header: Mode Switcher + Save Current & Full Presets Library */}
      <ViewHeader
        view="synth"
        actions={
          <>
            {/* Mode Switcher: Simple vs Pro */}
            <div className="join flex items-center bg-base-200 border border-base-300 rounded-box px-0.5 h-8">
              <button
                id="btn-mode-simple"
                onClick={() => handleToggleSynthViewMode("simple")}
                className={`btn btn-xs join-item gap-1 text-xs font-semibold ${
                  synthViewMode === "simple"
                    ? "btn-primary"
                    : "btn-ghost text-base-content/60"
                }`}
                title="Simple Mode"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Simple</span>
              </button>
              <button
                id="btn-mode-pro"
                onClick={() => handleToggleSynthViewMode("pro")}
                className={`btn btn-xs join-item gap-1 text-xs font-semibold ${
                  synthViewMode === "pro"
                    ? "btn-primary"
                    : "btn-ghost text-base-content/60"
                }`}
                title="Pro Mode"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Pro</span>
              </button>
            </div>

            <button
              id="btn-quick-save-preset"
              onClick={() => {
                setQuickSaveName(
                  params.preset
                    ? `${params.preset} (Custom)`
                    : "My Synth Patch",
                );
                setQuickSaveCategory(activePresetItem?.category ?? "User");
                setIsQuickSaving(true);
              }}
              className="btn btn-sm btn-ghost gap-1 border border-base-300 text-xs font-semibold"
              title="Save preset"
            >
              <Bookmark className="w-3.5 h-3.5 text-primary" />
              <span className="hidden sm:inline">Save</span>
            </button>

            <button
              id="btn-open-presets-library"
              onClick={() => setIsLibraryOpen(true)}
              className="btn btn-sm btn-primary gap-1 text-xs font-semibold"
              title="Sound Library"
            >
              <Library className="w-3.5 h-3.5" />
              {/* Names the content, not the container: the Chords view has an
                  identical button in the identical place, and "Library" made
                  the two read as the same drawer. It also makes the count badge
                  answerable — "Library 29" never said 29 of what. */}
              <span>Sounds</span>
              <span className={COUNT_BADGE}>
                {totalPresetsCount}
              </span>
            </button>
          </>
        }
      >
        {saveToast && (
          <div className="toast toast-top toast-end absolute top-full right-4 mt-2 z-20">
            <div className="alert alert-success text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-lg">
              <Check className="w-3.5 h-3.5" />
              <span>{saveToast}</span>
            </div>
          </div>
        )}
      </ViewHeader>

      {/* Synth Target & Preset Selection Card */}
      <div className="card bg-panel border border-base-300 shadow-md">
        <div className="card-body p-3 sm:p-4 flex flex-col gap-3">
        {/* Row 1: Control Destination / Target Selector. Kept as its own row,
            visible in both Simple and Pro mode, because it's the only control
            that switches which channel (synth/chord/bass) params/onChangeParams
            below points at — Pro mode's oscillator/filter/envelope sections
            read that same params object, so folding this into the Simple-only
            preset bar would silently strand Pro mode on whatever target was
            last picked. */}
        {/* Row 1: Control Destination / Target Selector + Dynamic Target Volume Slider */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Control Destination Selector */}
          <div
            className={`join flex items-center gap-1 bg-base-200 border rounded-box p-1 shrink-0 ${
              controlTarget === "chord"
                ? "border-module-chord"
                : controlTarget === "bass"
                  ? "border-module-bass"
                  : "border-primary"
            }`}
          >
            <span className="text-[10px] uppercase tracking-wider text-base-content/50 font-semibold pl-1 pr-1 hidden sm:inline">
              Target:
            </span>
            {(
              Object.keys(SYNTH_TARGET_STYLES) as SynthControlTarget[]
            ).map((target) => (
              <button
                key={target}
                onClick={() => onChangeControlTarget(target)}
                className={`btn btn-xs join-item text-[11px] font-semibold ${
                  controlTarget === target
                    ? SYNTH_TARGET_STYLES[target].activeBtn
                    : "btn-ghost text-base-content/60"
                }`}
              >
                {SYNTH_TARGET_STYLES[target].label}
              </button>
            ))}
          </div>

          {/* Target Volume Slider, dynamic to active target with matching tint */}
          <div className="flex-1 min-w-44 max-w-xs">
            <ChannelStrip
              idPrefix={activeTargetVolumeConfig.idPrefix}
              volume={activeTargetVolumeConfig.volume}
              max={1.5}
              accentClass={activeTargetVolumeConfig.accentClass}
              sliderClassName={activeTargetVolumeConfig.sliderClassName}
              onVolumeChange={activeTargetVolumeConfig.onVolumeChange}
            />
          </div>

          {/* Per-target oscilloscope, the way a hardware synth puts a scope
              beside the section you are editing. It taps the TARGET layer's
              own bus — after the VCA, before the sends — so it shows the patch
              being edited rather than the finished mix the transport bar's
              master meter reads.

              The label is not decoration: the QWERTY keyboard always plays the
              'synth' layer regardless of Target (see KEYBOARD_AUDITION_TARGET),
              so with Target on Chord or Bass the trace stays flat while keys
              are pressed. Naming the tapped layer is what keeps that legible
              instead of reading as a broken scope. */}
          <div
            className="ml-auto hidden sm:flex items-center gap-2 bg-base-200 border border-base-300 rounded-box px-2 h-8 shrink-0 self-end mb-0.5"
            title={`Oscilloscope — ${SYNTH_TARGET_STYLES[controlTarget].label} layer`}
          >
            <span className="text-[10px] uppercase tracking-wider font-semibold text-base-content/50">
              {SYNTH_TARGET_STYLES[controlTarget].label}
            </span>
            <AudioVisualizer
              mode="oscilloscope"
              variant="inline"
              source={controlTarget}
              paused={activeTab !== 'synth'}
              height={22}
              className="w-28 lg:w-40 rounded"
              colorTheme={controlTarget === "chord" ? "accent" : "primary"}
            />
          </div>
        </div>

        {/* Pro Mode: Row 2 Categorized Preset Selection Bar */}
        {synthViewMode === "pro" && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 bg-base-300 border border-base-300 p-2 rounded-box">
            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none text-[11px]">
              <span className="text-[10px] uppercase font-bold text-base-content/50 px-1">
                Category:
              </span>
              {[
                { id: "All", label: "All" },
                { id: "Bass", label: "Bass" },
                { id: "Lead", label: "Lead" },
                { id: "Pad", label: "Pad" },
                { id: "Keys", label: "Keys" },
                { id: "Pluck", label: "Pluck" },
                { id: "Brass", label: "Brass" },
                { id: "FX", label: "FX" },
                { id: "User", label: "Custom" },
              ].map((cat) => {
                const isSelected = selectedCategoryFilter === cat.id;
                const count =
                  cat.id === "All"
                    ? allPresets.length
                    : cat.id === "User"
                      ? allPresets.filter(
                          (p) => !p.isFactory || p.category === "User",
                        ).length
                      : allPresets.filter((p) => p.category === cat.id).length;

                return (
                  <button
                    key={cat.id}
                    id={`filter-category-${cat.id.toLowerCase()}`}
                    onClick={() => handleCategoryFilterClick(cat.id)}
                    className={`btn btn-xs gap-1 font-semibold whitespace-nowrap text-xs ${
                      isSelected
                        ? "btn-primary"
                        : "btn-ghost text-base-content/60 hover:bg-base-300"
                    }`}
                  >
                    <span>{cat.label}</span>
                    <span
                      className={`badge badge-xs text-[9px] ${
                        isSelected
                          ? "badge-outline [--badge-color:currentColor]"
                          : "badge-ghost text-base-content/60"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Categorized Dropdown + Step Navigation + Active Category Tag */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Active Category Pill Tag */}
              {activeCategoryMeta && (
                <span
                  className={`badge badge-sm badge-outline text-[10px] font-semibold ${activeCategoryMeta.badgeClass}`}
                  title={`Category: ${activeCategoryMeta.label} - ${activeCategoryMeta.description}`}
                >
                  {activeCategoryMeta.shortLabel}
                </span>
              )}

              {/* Step Previous Preset Button */}
              <button
                id="btn-prev-synth-preset"
                onClick={() => handleStepPreset(-1)}
                className="btn btn-xs btn-square btn-ghost border border-base-300"
                title="Previous Preset"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {/* Categorized Dropdown with Optgroups */}
              <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-field px-2 min-w-50 max-w-60">
                <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
                <select
                  id="select-synth-preset"
                  value={params.preset}
                  onChange={(e) => handleDropdownChange(e.target.value)}
                  className="select select-sm select-ghost bg-transparent border-0 text-base-content text-xs focus:outline-none pr-2 font-medium max-w-60 truncate"
                >
                  {categoryGroups
                    .filter((g) =>
                      selectedCategoryFilter === "All"
                        ? true
                        : selectedCategoryFilter === "User"
                          ? g.category === "User"
                          : g.category === selectedCategoryFilter,
                    )
                    .map((group) => (
                      <optgroup
                        key={group.category}
                        label={group.label}
                        className="font-bold"
                      >
                        {group.presets.map((p) => (
                          <option key={p.id} value={p.name}>
                            {!p.isFactory ? `★ ${p.name}` : p.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              </div>

              {/* Step Next Preset Button */}
              <button
                id="btn-next-synth-preset"
                onClick={() => handleStepPreset(1)}
                className="btn btn-xs btn-square btn-ghost border border-base-300"
                title="Next Preset"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Simple Mode: Preset Selector & Category Chips merged into the header card */}
        {synthViewMode === "simple" && (
          <div className="pt-3 border-t border-base-300 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-0">
              {/* Preset Title & Category Badge */}
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                {activeCategoryMeta && (
                  <span
                    className={`badge badge-sm text-[10px] font-bold ${activeCategoryMeta.badgeClass}`}
                  >
                    {activeCategoryMeta.label}
                  </span>
                )}
                <p className="text-2xl leading-6 font-extrabold text-base-content tracking-tight truncate">
                  {params.preset || "Default Sound"}
                </p>
              </div>

              {/* Preset Stepper & Selector */}
              <div className="flex items-center gap-2">
                <button
                  id="btn-simple-prev-preset"
                  onClick={() => handleStepPreset(-1)}
                  className="btn btn-sm btn-square btn-ghost border border-base-300"
                  title="Previous Sound"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <select
                  id="select-simple-preset"
                  value={params.preset}
                  onChange={(e) => {
                    const found = allPresets.find(
                      (p) => p.name === e.target.value,
                    );
                    if (found) handleSelectPreset(found);
                  }}
                  className="select select-sm text-xs font-semibold max-w-50 truncate"
                >
                  {allPresets.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.category}: {p.name}
                    </option>
                  ))}
                </select>

                <button
                  id="btn-simple-next-preset"
                  onClick={() => handleStepPreset(1)}
                  className="btn btn-sm btn-square btn-ghost border border-base-300"
                  title="Next Sound"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Category Quick Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0 no-scrollbar">
              <span className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider font-sans mr-1">
                Sound Style:
              </span>
              {[
                { id: "All", label: "All Sounds", emoji: "✨" },
                { id: "Lead", label: "Lead Melody", emoji: "⚡" },
                { id: "Pad", label: "Ambient Pad", emoji: "🌌" },
                { id: "Keys", label: "Keys & Piano", emoji: "🎹" },
                { id: "Bass", label: "Deep Bass", emoji: "🔥" },
                { id: "Pluck", label: "Snappy Pluck", emoji: "🪕" },
                { id: "Brass", label: "Brass Stabs", emoji: "🎷" },
                { id: "FX", label: "Sci-Fi FX", emoji: "🛸" },
              ].map((cat) => {
                const isSelected = selectedCategoryFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryFilterClick(cat.id)}
                    className={`btn btn-xs gap-1.5 text-xs font-medium whitespace-nowrap ${
                      isSelected
                        ? "btn-primary font-semibold"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
                  >
                    <span>{cat.emoji}</span>
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Quick Save Modal Popover with Category selection */}
      <QuickSavePopover
        open={isQuickSaving}
        onClose={() => setIsQuickSaving(false)}
        heading="Save Custom Preset to LocalStorage:"
        placeholder="Preset Name..."
        saveLabel="Save Patch"
        name={quickSaveName}
        onNameChange={setQuickSaveName}
        categories={SYNTH_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
        category={quickSaveCategory}
        onCategoryChange={(v) => setQuickSaveCategory(v as SynthPresetCategory)}
        onSubmit={handleQuickSaveSubmit}
        formClassName="flex items-center gap-2 flex-1 max-w-xl flex-wrap sm:flex-nowrap"
      />

      {/* Simple Mode vs Pro Mode Body Panels */}
      {synthViewMode === "simple" ? (
        <>
          <SimpleSynthPanel
            params={params}
            onChangeParams={onChangeParams}
            tintClass={tintClass}
          />

          {/* Friendly Pro Mode Hint */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-base-100/70 border border-base-300 px-4 py-2.5 rounded-box text-xs text-base-content">
            <div className="flex items-center gap-2 text-base-content/60">
              <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
              <span>
                Want deep modular control over 5 oscillators, ADSR envelopes,
                filters & LFO modulation?
              </span>
            </div>
            <button
              id="btn-switch-pro-hint"
              onClick={() => handleToggleSynthViewMode("pro")}
              className="btn btn-xs btn-link text-accent font-bold whitespace-nowrap no-underline"
            >
              Switch to Pro Mode →
            </button>
          </div>
        </>
      ) : (
        /* Pro Mode: Control Panels Grid */
        <div className="w-full flex flex-wrap gap-3">
          {/* 1. Oscillators Section */}
          <div
            className={`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                <span className={STEP_BADGE}>1</span>
                <Activity className="w-3.5 h-3.5 text-module-osc" />
                Oscillators
              </span>
            </div>

            <div>
              <label className="text-xs text-base-content/60 block mb-1.5 font-medium">
                Waveform
              </label>
              <div className="grid grid-cols-4 gap-1">
                {(["sawtooth", "square", "sine", "triangle"] as const).map(
                  (w) => (
                    <button
                      key={w}
                      id={`btn-wave-${w}`}
                      onClick={() => onChangeParams({ ...params, oscType: w })}
                      className={`btn btn-xs text-[11px] font-semibold capitalize ${
                        params.oscType === w
                          ? "[--btn-color:var(--color-module-osc)] [--btn-fg:var(--color-module-osc-content)]"
                          : "btn-ghost border border-base-300 text-base-content/60"
                      }`}
                    >
                      {w.slice(0, 4)}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="flex items-start justify-between gap-2">
              <Knob
                id="slider-sub-osc"
                label="Sub-Osc"
                color="text-module-osc"
                value={params.subOscVolume}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => onChangeParams({ ...params, subOscVolume: v })}
              />

              <Knob
                id="slider-detune"
                label="Detune"
                color="text-module-osc"
                value={params.detune}
                min={0}
                max={50}
                step={1}
                format={(v) => `${v} ct`}
                onChange={(v) => onChangeParams({ ...params, detune: v })}
              />

              <Knob
                id="slider-noise"
                label="Noise"
                color="text-module-osc"
                value={params.noiseVolume}
                min={0}
                max={0.5}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => onChangeParams({ ...params, noiseVolume: v })}
              />
            </div>
            </div>
          </div>
          {/* 2. Filter Section */}
          <div
            className={`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                <span className={STEP_BADGE}>2</span>
                <Sliders className="w-3.5 h-3.5 text-module-filter" />
                VCF Filter
              </span>
            </div>

            <div>
              <label className="text-xs text-base-content/60 block mb-1.5 font-medium">
                Filter Type
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(["lowpass", "bandpass", "highpass"] as const).map((t) => (
                  <button
                    key={t}
                    id={`btn-filter-${t}`}
                    onClick={() => onChangeParams({ ...params, filterType: t })}
                    className={`btn btn-xs text-[11px] font-semibold uppercase ${
                      params.filterType === t
                        ? "[--btn-color:var(--color-module-filter)] [--btn-fg:var(--color-module-filter-content)]"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
                  >
                    {t === "lowpass" ? "LPF" : t === "bandpass" ? "BPF" : "HPF"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start justify-between gap-2">
              <Knob
                id="slider-filter-cutoff"
                label="Cutoff"
                color="text-module-filter"
                value={params.filterCutoff}
                min={50}
                max={12000}
                step={10}
                scale="log"
                format={(v) => `${Math.round(v)} Hz`}
                onChange={(v) => onChangeParams({ ...params, filterCutoff: v })}
              />

              <Knob
                id="slider-filter-resonance"
                label="Resonance"
                color="text-module-filter"
                value={params.filterResonance}
                min={0.1}
                max={20}
                step={0.1}
                scale="linear"
                format={(v) => v.toFixed(1)}
                onChange={(v) =>
                  onChangeParams({ ...params, filterResonance: v })
                }
              />

              <Knob
                id="slider-filter-env"
                label="Env Mod"
                color="text-module-filter"
                value={params.filterEnvAmount}
                min={0}
                max={6000}
                step={50}
                scale="linear"
                format={(v) => `+${Math.round(v)} Hz`}
                onChange={(v) =>
                  onChangeParams({ ...params, filterEnvAmount: v })
                }
              />
            </div>
            </div>
          </div>
          {/* 3. Envelope ADSR */}
          <div
            className={`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                <span className={STEP_BADGE}>3</span>
                <Volume2 className="w-3.5 h-3.5 text-module-env-vca" />
                ADSR Envelope
              </span>
            </div>

            {/* AMP / VCA */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] text-module-env-vca uppercase tracking-wider">
                  AMP / VCA
                </span>
                <span className="flex-1 h-px bg-base-300" />
              </div>
              <div className="flex items-start justify-around gap-2">
                {/* Attack */}
                <Knob
                  id="slider-env-attack"
                  label="ATT"
                  color="text-module-env-vca"
                  value={params.attack}
                  min={0.005}
                  max={2.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) => onChangeParams({ ...params, attack: v })}
                />

                {/* Decay */}
                <Knob
                  id="slider-env-decay"
                  label="DEC"
                  color="text-module-env-vca"
                  value={params.decay}
                  min={0.01}
                  max={2.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) => onChangeParams({ ...params, decay: v })}
                />

                {/* Sustain */}
                <Knob
                  id="slider-env-sustain"
                  label="SUS"
                  color="text-module-env-vca"
                  value={params.sustain}
                  min={0}
                  max={1.0}
                  step={0.01}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) => onChangeParams({ ...params, sustain: v })}
                />

                {/* Release */}
                <Knob
                  id="slider-env-release"
                  label="REL"
                  color="text-module-env-vca"
                  value={params.release}
                  min={0.01}
                  max={3.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) => onChangeParams({ ...params, release: v })}
                />
              </div>
            </div>

            {/* FILTER / VCF */}
            <div className="pt-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] text-module-env-vcf uppercase tracking-wider">
                  FILTER / VCF
                </span>
                <span className="flex-1 h-px bg-base-300" />
              </div>
              <div className="flex items-start justify-around">
                {/* Filter Attack */}
                <Knob
                  id="slider-env-filter-attack"
                  label="ATT"
                  color="text-module-env-vcf"
                  value={params.filterAttack}
                  min={0.005}
                  max={2.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) =>
                    onChangeParams({ ...params, filterAttack: v })
                  }
                />

                {/* Filter Decay */}
                <Knob
                  id="slider-env-filter-decay"
                  label="DEC"
                  color="text-module-env-vcf"
                  value={params.filterDecay}
                  min={0.01}
                  max={2.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) =>
                    onChangeParams({ ...params, filterDecay: v })
                  }
                />

                {/* Filter Sustain */}
                <Knob
                  id="slider-env-filter-sustain"
                  label="SUS"
                  color="text-module-env-vcf"
                  value={params.filterSustain}
                  min={0}
                  max={1.0}
                  step={0.01}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) =>
                    onChangeParams({ ...params, filterSustain: v })
                  }
                />

                {/* Filter Release */}
                <Knob
                  id="slider-env-filter-release"
                  label="REL"
                  color="text-module-env-vcf"
                  value={params.filterRelease}
                  min={0.01}
                  max={3.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) =>
                    onChangeParams({ ...params, filterRelease: v })
                  }
                />
              </div>
            </div>
            </div>
          </div>{" "}
          {/* 4. LFO & Master Pitch */}
          <div
            className={`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                <span className={STEP_BADGE}>4</span>
                <Activity className="w-3.5 h-3.5 text-module-lfo" />
                LFO & Octave
              </span>
            </div>

            <div>
              <label className="text-xs text-base-content/60 block mb-1.5 font-medium">
                LFO Destination
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(["cutoff", "pitch", "volume"] as const).map((t) => (
                  <button
                    key={t}
                    id={`btn-lfo-target-${t}`}
                    onClick={() => onChangeParams({ ...params, lfoTarget: t })}
                    className={`btn btn-xs text-[11px] font-semibold capitalize ${
                      params.lfoTarget === t
                        ? "[--btn-color:var(--color-module-lfo)] [--btn-fg:var(--color-module-lfo-content)]"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start justify-around gap-2">
              <Knob
                id="slider-lfo-rate"
                label="LFO Rate"
                color="text-module-lfo"
                value={params.lfoRate}
                min={0.1}
                max={20}
                step={0.1}
                format={(v) => `${v.toFixed(1)} Hz`}
                onChange={(v) => onChangeParams({ ...params, lfoRate: v })}
              />

              <Knob
                id="slider-lfo-depth"
                label="LFO Depth"
                color="text-module-lfo"
                value={params.lfoDepth}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => onChangeParams({ ...params, lfoDepth: v })}
              />
            </div>

            <div className="pt-1 flex items-center justify-between">
              <span className="text-xs text-base-content/60">Octave Pitch</span>
              <div className="flex items-center gap-1">
                {([-2, -1, 0, 1, 2] as const).map((oct) => (
                  <button
                    key={oct}
                    id={`btn-octave-${oct}`}
                    onClick={() => onChangeParams({ ...params, octave: oct })}
                    className={`btn btn-xs btn-square w-6 h-6 min-h-0 text-xs tabular-nums font-bold ${
                      params.octave === oct
                        ? "[--btn-color:var(--color-module-lfo)] [--btn-fg:var(--color-module-lfo-content)]"
                        : "btn-ghost border border-base-300 text-base-content/60 hover:text-base-content"
                    }`}
                  >
                    {oct > 0 ? `+${oct}` : oct}
                  </button>
                ))}
              </div>
            </div>
            </div>
          </div>
          {/* 5. Arpeggiator */}
          <div
            className={`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                <span className={STEP_BADGE}>5</span>
                <Sparkles className="w-3.5 h-3.5 text-module-arp" />
                Arpeggiator
              </span>
              <button
                id="btn-toggle-arp"
                onClick={() => {
                  initSynthPlayback();
                  onChangeParams({
                    ...params,
                    arpActive: !params.arpActive,
                  });
                }}
                className={`btn btn-xs text-[10px] font-bold uppercase tracking-wider ${
                  params.arpActive
                    ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)] shadow-md shadow-module-arp/30"
                    : "btn-ghost border border-base-300 text-base-content/60"
                }`}
              >
                {params.arpActive ? "Active" : "Bypass"}
              </button>
            </div>

            <div>
              <label className="text-xs text-base-content/60 block mb-1.5 font-medium">
                Arp Mode
              </label>
              <div className="grid grid-cols-4 gap-1">
                {(["up", "down", "updown", "random"] as const).map((m) => (
                  <button
                    key={m}
                    id={`btn-arp-mode-${m}`}
                    onClick={() => onChangeParams({ ...params, arpMode: m })}
                    className={`btn btn-xs text-[10px] font-semibold capitalize ${
                      params.arpMode === m
                        ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
                  >
                    {m === "updown" ? "Up/Dn" : m}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <label className="text-[11px] text-base-content/60 block mb-1 font-medium">
                  Rate
                </label>
                <div className="flex gap-1">
                  {(["16n", "8n", "32n"] as const).map((r) => (
                    <button
                      key={r}
                      id={`btn-arp-rate-${r}`}
                      onClick={() => onChangeParams({ ...params, arpRate: r })}
                      className={`btn btn-xs text-[11px] font-mono font-semibold ${
                        params.arpRate === r
                          ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]"
                          : "btn-ghost border border-base-300 text-base-content/60"
                      }`}
                    >
                      {r === "16n" ? "1/16" : r === "8n" ? "1/8" : "1/32"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] text-base-content/60 block mb-1 font-medium">
                  Octaves
                </label>
                <div className="flex gap-1">
                  {[1, 2, 3].map((oct) => (
                    <button
                      key={oct}
                      id={`btn-arp-octave-${oct}`}
                      onClick={() =>
                        onChangeParams({ ...params, arpOctaves: oct })
                      }
                      className={`btn btn-xs w-7 min-h-0 text-xs tabular-nums font-bold ${
                        params.arpOctaves === oct
                          ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]"
                          : "btn-ghost border border-base-300 text-base-content/60"
                      }`}
                    >
                      +{oct}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Piano Keyboard */}
      <div className="card bg-panel border border-base-300 shadow-xl">
        <div className="card-body p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className={SECTION_HEADER}>
              Keyboard
            </span>
            <span
              className="badge badge-sm badge-outline text-[10px] font-semibold badge-base-content/60"
              title="Active key and scale"
            >
              {`${scaleRoot} ${scaleType}`}
            </span>
          </div>

          {/* Keyboard Octave Pagination — independent from synth pitch octave */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-base-content/50 mr-1">
              KB OCT
            </span>

            {/* Keyboard Octave Controls */}
            <button
              id="btn-keyboard-octave-down"
              onClick={() => setKeyboardOctave((o) => Math.max(-2, o - 1))}
              disabled={keyboardOctave <= -2}
              className="btn btn-xs btn-square btn-ghost w-7 h-7 min-h-0 border border-base-300 text-base-content/60 hover:text-base-content hover:border-primary hover:bg-primary/20 disabled:opacity-30"
              title="Keyboard Octave Down"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="badge badge-primary badge-outline min-w-13 h-7 px-2">
              <span className="text-xs font-mono font-bold">
                {keyboardOctave >= 0 ? `+${keyboardOctave}` : keyboardOctave}{" "}
                Oct
              </span>
            </div>
            <button
              id="btn-keyboard-octave-up"
              onClick={() => setKeyboardOctave((o) => Math.min(2, o + 1))}
              disabled={keyboardOctave >= 2}
              className="btn btn-xs btn-square btn-ghost w-7 h-7 min-h-0 border border-base-300 text-base-content/60 hover:text-base-content hover:border-primary hover:bg-primary/20 disabled:opacity-30"
              title="Keyboard Octave Up"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Keyboard Input Mode Toggle */}
            <div
              className="join"
              role="radiogroup"
              aria-label="Keyboard input mode"
            >
              {(["chromatic", "scale-locked", "chord"] as const).map((m) => (
                <button
                  key={m}
                  id={`btn-keyboard-mode-${m}`}
                  onClick={() => setKeyboardMode(m)}
                  role="radio"
                  aria-checked={keyboardMode === m}
                  className={`btn btn-xs join-item text-[11px] font-semibold ${
                    keyboardMode === m
                      ? "btn-primary"
                      : "btn-ghost border border-base-300 text-base-content/60"
                  }`}
                  title={
                    m === "chromatic"
                      ? "Chromatic Mode: every semitone, ignores key/scale"
                      : m === "scale-locked"
                        ? "Scale Locked Mode: cuts notes outside the active scale"
                        : "Chord Mode: diatonic triads per scale degree, plus a melody zone"
                  }
                >
                  {m === "chromatic"
                    ? "Chromatic"
                    : m === "scale-locked"
                      ? "Scale"
                      : "Chord"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Keyboard Keys Layout — uses keyboardOctave for display range */}
        <div
          className={`flex justify-center relative h-45 select-none bg-base-300 p-2 rounded-box border border-base-300 overflow-x-auto ${
            keyboardMode === "scale-locked" || keyboardMode === "chord"
              ? "flex-col gap-1.5"
              : ""
          }`}
        >
          {keyboardMode === "chord" ? (
            <ChordKeyboard
              rows={chordKeyboardRows}
              activeNotes={activeNotes}
              onNoteOn={handleNoteOn}
              onNoteOff={handleNoteOff}
            />
          ) : keyboardMode === "scale-locked" ? (
            <ScaleLockedKeyboard
              rows={scaleLockedRows}
              activeNotes={activeNotes}
              onNoteOn={handleNoteOn}
              onNoteOff={handleNoteOff}
            />
          ) : (
            <ChromaticKeyboard
              octaveOffset={keyboardOctave}
              activeNotes={activeNotes}
              onNoteOn={handleNoteOn}
              onNoteOff={handleNoteOff}
            />
          )}
        </div>
        </div>
      </div>

      {/* Preset Library Sidebar Drawer / Modal */}
      <Suspense
        fallback={
          isLibraryOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/60">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : null
        }
      >
        <SynthPresetLibrary
          isOpen={isLibraryOpen}
          onClose={() => setIsLibraryOpen(false)}
          currentParams={params}
          target={controlTarget}
          showSoundBadges={synthViewMode === "pro"}
          onSelectPreset={(preset) => {
            handleSelectPreset(preset);
            setIsLibraryOpen(false);
          }}
        />
      </Suspense>
    </div>
  );
};

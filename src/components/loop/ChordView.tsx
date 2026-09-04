import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  Suspense,
} from "react";
import {
  Music,
  Sparkles,
  Plus,
  Library,
  Bookmark,
  Check,
  Volume2,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { ChordItem, CustomChordProgressionItem } from "../../types";
import { useAppStore } from "../../store/store";
import {
  useChordPlayback,
  resolvePlaybackRhythmPattern,
  resolvePlaybackBassPattern,
} from "./chord/useChordPlayback";
import {
  ensurePreviewEngine,
  hasPreviewEngine,
  playChordLegatoWithEngine,
  previewBarSeconds,
  previewChordForScale,
  previewEngineTime,
  startPatternLoop,
  stopBassPreviewSource,
  stopChordPreviewSource,
} from "../../audio/playback/chordPlayback";
import { getMeter } from "../../utils/meter";
import {
  deriveChordNotes,
  snapProgressionToScale,
  transposeProgression,
  SCALES,
  getDiatonicChordForDegree,
  getBorrowedChords,
  formatChordLabel,
} from "../../utils/musicTheory";
import { isProgressionAvailable } from "./chord/progressionAvailability";

// The drawer is never needed on first paint — PresetLibrary early-returns
// null when closed — so it is code-split out of the main chunk.
const ChordPresetLibrary = React.lazy(() =>
  import("./ChordPresetLibrary").then((m) => ({ default: m.ChordPresetLibrary })),
);
import { PowerToggle } from "../ui/PowerToggle";
import { QuickSavePopover } from "../ui/QuickSavePopover";
import { ViewHeader } from "../ui/ViewHeader";
import { ModuleHeader } from "../ui/ModuleHeader";
import { COUNT_BADGE, HEADER_BADGE } from '../ui/fieldClasses';
import { SortableChordCard } from "./chord/SortableChordCard";
import { AdjustSynthButton } from "./chord/AdjustSynthButton";
import { ChordModulePanel } from "./chord/ChordModulePanel";
import { BassModulePanel } from "./chord/BassModulePanel";
import { beatsPerBarFor, resolveBeatCounter } from "../../utils/playhead";

import { CHORD_PROGRESSIONS } from "../../audio/data/chordProgressions";

/**
 * Whether a run of the auto-harmonize effect should clear a stale "Auto-
 * Reharmonized" badge left over from an earlier run.
 *
 * `chordsReplaced` means "this render's chord array is not the one the last run
 * saw" — an Instant Vibe, a library preset or a template just wrote it. Those
 * chords were built in the key that arrived with them, so no key delta this
 * effect can observe is a delta they need. It is checked first for that reason.
 *
 * `chordsReplaced` alone is not enough: it is also true for the Re-harmonize
 * button and for manual chord edits (add / delete / reorder), both of which
 * replace the `chords` array reference but leave the key untouched — clearing
 * on `chordsReplaced` alone wipes the badge those actions just set. An
 * Instant Vibe swap sets root, scale and chords together, so requiring the
 * key to have actually changed is what distinguishes it from those cases.
 *
 * Known residual (not a regression, not chased here): a vibe whose key
 * happens to equal the current key still leaves a stale badge, because there
 * is no key delta to observe.
 */
export function shouldClearReharmonizeIndicator(
  from: { root: string; scaleType: string },
  to: { root: string; scaleType: string },
  chordsReplaced: boolean,
): boolean {
  return chordsReplaced && (from.root !== to.root || from.scaleType !== to.scaleType);
}

/**
 * As one pure function so it is testable without a DOM (repo convention:
 * components export their testable helpers).
 *
 * Transpose-then-snap is the only correct order for a combined change: snapping
 * first would measure the chords against a root they are not yet in.
 */
export function applyKeyScaleChange(
  chords: ChordItem[],
  from: { root: string; scaleType: string },
  to: { root: string; scaleType: string },
  octave: number,
  chordsReplaced: boolean,
): ChordItem[] | null {
  if (chordsReplaced || chords.length === 0) return null;

  const rootChanged = from.root !== to.root;
  const scaleChanged = from.scaleType !== to.scaleType;
  if (!rootChanged && !scaleChanged) return null;

  let next = chords;
  if (rootChanged) next = transposeProgression(next, from.root, to.root, octave);
  if (scaleChanged) next = snapProgressionToScale(next, to.root, to.scaleType, octave);
  return next;
}

export const ChordView: React.FC = React.memo(() => {
  // ChordView reads the store directly: every value below replaces one of
  // the ~34 props it used to receive from App.tsx.
  const chords = useAppStore((s) => s.chords);
  const setChords = useAppStore((s) => s.setChords);
  const playheadBeat = useAppStore((s) => s.playheadBeat);
  const playheadChordIndex = useAppStore((s) => s.playheadChordIndex);
  const playheadChordStartBeat = useAppStore((s) => s.playheadChordStartBeat);
  const meterId = useAppStore((s) => s.meterId);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const rhythmId = useAppStore((s) => s.chordRhythmId);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const chordRhythmMode = useAppStore((s) => s.chordRhythmMode);
  const customChordRhythm = useAppStore((s) => s.customChordRhythm);
  const bassPatternMode = useAppStore((s) => s.bassPatternMode);
  const customBassPattern = useAppStore((s) => s.customBassPattern);
  const chordMuted = useAppStore((s) => s.chordMuted);
  const toggleChordMuted = useAppStore((s) => s.toggleChordMuted);
  const bassMuted = useAppStore((s) => s.bassMuted);
  const toggleBassMuted = useAppStore((s) => s.toggleBassMuted);
  const bpm = useAppStore((s) => s.bpm);
  const { playChordWithRhythm, playBassWithPattern, playingIndex, activeChordId, setActiveChordId, isPlaying } = useChordPlayback();

  // Stable identity so SortableContext's contextValue (which lists `items` in
  // its own dep array) doesn't change on every render — an inline
  // chords.map() here defeats React.memo on every SortableChordCard, which
  // otherwise correctly bails out on the twice-a-second playheadBeat churn.
  // Same pattern as ArrangeView.tsx's loopIds.
  const chordIds = useMemo(() => chords.map((c) => c.id), [chords]);

  const rhythmPattern = useMemo(
    () =>
      resolvePlaybackRhythmPattern(
        chordRhythmMode,
        rhythmId,
        customChordRhythm,
        getMeter(meterId).stepsPerBar,
        getMeter(meterId).id,
      ),
    [chordRhythmMode, customChordRhythm, rhythmId, meterId],
  );

  // Master Playback Loop — driven by the shared audio-clock scheduler
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [customProgressions, setCustomProgressions] = useState<
    CustomChordProgressionItem[]
  >([]);
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>("");
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [autoReharmonize, setAutoReharmonize] = useState<boolean>(true);
  const [isAutoReharmonizedIndicator, setIsAutoReharmonizedIndicator] =
    useState<boolean>(false);
  const [use7thsInQuickAdd, setUse7thsInQuickAdd] = useState<boolean>(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = chords.findIndex((c) => c.id === active.id);
      const newIndex = chords.findIndex((c) => c.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setChords(arrayMove(chords, oldIndex, newIndex));
      }
    }
  };

  // Props of the memoized SortableChordCard, so their identity must be
  // stable. `chords` and `chordOctave` are read LIVE from the store: a
  // useCallback([]) over the render-scope values would pin the progression
  // as of the first render and silently corrupt every later edit. The
  // chords slice exposes a plain-value setter, not an updater.
  const handleMoveChord = useCallback((index: number, direction: -1 | 1) => {
    const { chords: liveChords, setChords } = useAppStore.getState();
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= liveChords.length) return;
    const updated = [...liveChords];
    const [removed] = updated.splice(index, 1);
    updated.splice(newIndex, 0, removed);
    setChords(updated);
  }, []);

  const bassPattern = useMemo(
    () =>
      resolvePlaybackBassPattern(
        bassPatternMode,
        bassPatternId,
        customBassPattern,
        getMeter(meterId).stepsPerBar,
        getMeter(meterId).id,
      ),
    [bassPatternMode, customBassPattern, bassPatternId, meterId],
  );

  // Auto-harmonize refs. The effect must not re-run when the toggle or the
  // octave changes — only when the key or the chords do — so those two are read
  // through refs kept fresh by an effect declared above it (effects run in
  // declaration order, so these are current by the time the next one runs).
  const keyRef = useRef({ root: scaleRoot, scaleType });
  const chordsRef = useRef(chords);
  const autoReharmonizeRef = useRef(autoReharmonize);
  const chordOctaveRef = useRef(chordOctave);

  useEffect(() => {
    autoReharmonizeRef.current = autoReharmonize;
    chordOctaveRef.current = chordOctave;
  });

  useEffect(() => {
    const previousKey = keyRef.current;
    const chordsReplaced = chordsRef.current !== chords;
    chordsRef.current = chords;
    keyRef.current = { root: scaleRoot, scaleType };

    // A wholesale replacement that also changes the key (Instant Vibe swap)
    // does not go through handleApplyLibraryChords, so a badge left over from
    // an earlier real harmonization would otherwise stay on screen and wrongly
    // claim the new chords were reharmonized. Re-harmonize and manual chord
    // edits also replace the array but leave the key alone, so they must not
    // trip this — see shouldClearReharmonizeIndicator's doc comment. This
    // can't be retriggered by the effect's own setChords below:
    // chordsRef.current is assigned before that call, so the follow-up run
    // sees chordsReplaced === false.
    if (shouldClearReharmonizeIndicator(previousKey, keyRef.current, chordsReplaced)) {
      setIsAutoReharmonizedIndicator(false);
    }

    if (!autoReharmonizeRef.current) return;

    const next = applyKeyScaleChange(
      chords,
      previousKey,
      keyRef.current,
      chordOctaveRef.current,
      chordsReplaced,
    );
    if (!next) return;

    // Remember what we wrote, so the run this setChords triggers sees the
    // chords as unreplaced rather than harmonizing its own output.
    chordsRef.current = next;
    setChords(next);
    setIsAutoReharmonizedIndicator(true);
  }, [scaleRoot, scaleType, chords, setChords]);

  const handleApplyLibraryChords = (libraryChords: ChordItem[]) => {
    // ChordPresetLibrary hands over chords already resolved in the active key
    // and scale (factory entries from their degrees, custom ones snapped), so
    // there is nothing left to harmonize here. Re-id and re-derive only.
    setChords(
      libraryChords.map((c, i) =>
        deriveChordNotes({ ...c, id: `lib-chord-${Date.now()}-${i}` }, chordOctave),
      ),
    );
    setIsAutoReharmonizedIndicator(false);
  };

  const handleQuickSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSaveName.trim() || chords.length === 0) return;

    const saved = useAppStore.getState().saveCustomChordProgression(
      quickSaveName.trim(),
      chords,
      "User",
      "Saved from Chord View",
      chords.map((c) => formatChordLabel(c.root, c.quality)).join(" → "),
    );

    setCustomProgressions(useAppStore.getState().customChordProgressions);
    setIsQuickSaving(false);
    setQuickSaveName("");
    setSaveToast(`Saved progression "${saved.name}"!`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const addChord = () => {
    const newChord: ChordItem = deriveChordNotes(
      {
        id: `chord-${Date.now()}`,
        root: scaleRoot,
        quality: "maj7",
        bars: 1,
        notes: [],
      },
      chordOctave,
    );
    setChords([...chords, newChord]);
  };

  const addDiatonicChord = (degreeIndex: number) => {
    const diatonic = getDiatonicChordForDegree(
      degreeIndex,
      scaleRoot,
      scaleType,
      use7thsInQuickAdd,
    );
    const newChord: ChordItem = deriveChordNotes(
      {
        id: `chord-${Date.now()}`,
        root: diatonic.root,
        quality: diatonic.quality,
        bars: 1,
        notes: [],
      },
      chordOctave,
    );
    setChords([...chords, newChord]);
  };

  const addBorrowedChord = (root: string, quality: string) => {
    const newChord: ChordItem = deriveChordNotes(
      {
        id: `chord-${Date.now()}`,
        root,
        quality,
        bars: 1,
        notes: [],
      },
      chordOctave,
    );
    setChords([...chords, newChord]);
  };

  const chordPatternPreviewStopRef = useRef<(() => void) | null>(null);
  const bassPatternPreviewStopRef = useRef<(() => void) | null>(null);

  // Stop a held pattern preview if the view unmounts mid-preview.
  useEffect(
    () => () => {
      chordPatternPreviewStopRef.current?.();
      chordPatternPreviewStopRef.current = null;
      bassPatternPreviewStopRef.current?.();
      bassPatternPreviewStopRef.current = null;
    },
    [],
  );

  // Held chord previews (catalog palette + progression cards): all notes
  // strike at once and sustain — no rhythm pattern, no scheduled note-offs.
  const handlePreviewMouseDown = (
    e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent,
    root: string,
    quality: string,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    ensurePreviewEngine();
    const tempChord: ChordItem = {
      id: "preview",
      root,
      quality,
      bars: 1,
      notes: [],
    };
    playChordLegatoWithEngine(
      deriveChordNotes(tempChord, chordOctave),
      chordSynthParams,
    );
  };

  const handlePreviewMouseUp = (e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hasPreviewEngine()) return;

    stopChordPreviewSource(0.15);
  };

  const handleCardPreviewMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent, chord: ChordItem) => {
      e.stopPropagation();
      ensurePreviewEngine();
      playChordLegatoWithEngine(chord, useAppStore.getState().chordSynthParams);
      setActiveChordId(chord.id);
    },
    [setActiveChordId],
  );

  const handleCardPreviewMouseUp = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      if (!hasPreviewEngine()) return;
      setActiveChordId(null);

      stopChordPreviewSource(0.15);
    },
    [setActiveChordId],
  );

  // Pattern previews are per-module: the chord button loops the chord pattern
  // only, the bass button loops the bass pattern only. Both use the scale's
  // I triad as their sound source until the mouse is released.
  const handleChordPatternPreviewMouseDown = (
    e: React.MouseEvent | React.TouchEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    ensurePreviewEngine();

    const previewChord = previewChordForScale(
      scaleRoot,
      scaleType,
      chordOctave,
    );
    const barSeconds =
      previewBarSeconds(bpm, getMeter(meterId).stepsPerBar) * (previewChord.bars || 1);

    chordPatternPreviewStopRef.current?.();
    chordPatternPreviewStopRef.current = startPatternLoop(
      (time) => playChordWithRhythm(previewChord, time, rhythmPattern),
      barSeconds,
      previewEngineTime,
    );
  };

  const handleChordPatternPreviewMouseUp = (
    e: React.MouseEvent | React.TouchEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hasPreviewEngine()) return;

    chordPatternPreviewStopRef.current?.();
    chordPatternPreviewStopRef.current = null;
    stopChordPreviewSource(0.15);
  };

  const handleBassPatternPreviewMouseDown = (
    e: React.MouseEvent | React.TouchEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    ensurePreviewEngine();

    const previewChord = previewChordForScale(
      scaleRoot,
      scaleType,
      chordOctave,
    );
    const barSeconds =
      previewBarSeconds(bpm, getMeter(meterId).stepsPerBar) * (previewChord.bars || 1);

    bassPatternPreviewStopRef.current?.();
    bassPatternPreviewStopRef.current = startPatternLoop(
      (time) =>
        playBassWithPattern(previewChord, time, bassPattern, [previewChord]),
      barSeconds,
      previewEngineTime,
    );
  };

  const handleBassPatternPreviewMouseUp = (
    e: React.MouseEvent | React.TouchEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hasPreviewEngine()) return;

    bassPatternPreviewStopRef.current?.();
    bassPatternPreviewStopRef.current = null;
    stopBassPreviewSource(0.15);
  };

  const removeChord = useCallback((id: string) => {
    const { chords: liveChords, setChords } = useAppStore.getState();
    // A loop must keep at least one chord: an empty chords array makes
    // loopLengthSteps() 0, which freezes the song advance on that loop
    // (a silent dead end with no way past).
    if (liveChords.length <= 1) return;
    setChords(liveChords.filter((c) => c.id !== id));
  }, []);

  const updateChord = useCallback((id: string, updates: Partial<ChordItem>) => {
    const { chords: liveChords, chordOctave: liveChordOctave, setChords } = useAppStore.getState();
    setChords(
      liveChords.map((c) => {
        if (c.id !== id) return c;
        return deriveChordNotes({ ...c, ...updates }, liveChordOctave);
      }),
    );
  }, []);

  // ChordView subscribes to playheadBeat, so it re-renders twice a second at
  // 120 BPM — the 16th-note step no longer passes through here (it is
  // published to components/playbackStep.ts and read by the two
  // PlayingStepRows), so this is again the real rate. Both memos below call
  // into tonal and must stay memoized.
  const borrowedChords = useMemo(
    () => getBorrowedChords(scaleRoot, scaleType),
    [scaleRoot, scaleType],
  );

  const diatonicChords = useMemo(
    () =>
      Array.from({ length: SCALES[scaleType]?.intervals.length || 7 }).map((_, i) =>
        getDiatonicChordForDegree(i, scaleRoot, scaleType, use7thsInQuickAdd),
      ),
    [scaleRoot, scaleType, use7thsInQuickAdd],
  );

  const totalProgressionsCount = useMemo(
    () =>
      CHORD_PROGRESSIONS.filter((p) => isProgressionAvailable(p, scaleType)).length +
      customProgressions.length,
    [scaleType, customProgressions],
  );

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* Scale & Chord Studio Header */}
      <ViewHeader
        view="chords"
        actions={
          <>
            <PowerToggle
              id="btn-mute-chord"
              on={!chordMuted}
              onToggle={toggleChordMuted}
              name="Chord"
              tone="module-chord"
            />
            <PowerToggle
              id="btn-mute-bass"
              on={!bassMuted}
              onToggle={toggleBassMuted}
              name="Bass"
              tone="module-bass"
            />
            <div className="divider divider-horizontal mx-0" />

            {/* Quick Save Current Progression */}
            <button
              id="btn-quick-save-chord-progression"
              onClick={() => {
                setQuickSaveName(`Progression in ${scaleRoot}`);
                setIsQuickSaving(true);
              }}
              className="btn btn-sm btn-ghost gap-1"
              title="Save chord progression"
            >
              <Bookmark className="w-3.5 h-3.5 text-module-chord" />
              <span className="hidden sm:inline">Save</span>
            </button>

            {/* Open Presets Library Drawer Button */}
            <button
              id="btn-open-chord-presets-library"
              onClick={() => setIsLibraryOpen(true)}
              className="btn btn-sm gap-1 [--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]"
              title="Progression Library"
            >
              <Library className="w-3.5 h-3.5" />
              {/* See the matching button in SynthView: content, not container. */}
              <span>Progressions</span>
              <span className={COUNT_BADGE}>
                {totalProgressionsCount}
              </span>
            </button>
          </>
        }
      >
        {saveToast && (
          <div className="alert alert-success absolute top-full right-4 mt-2 z-20 w-auto py-1.5 px-3 text-xs shadow-lg animate-fade-in">
            <Check className="w-3.5 h-3.5" />
            <span>{saveToast}</span>
          </div>
        )}
      </ViewHeader>

      {/* Quick Save Modal Popover */}
      <QuickSavePopover
        open={isQuickSaving}
        onClose={() => setIsQuickSaving(false)}
        heading="Save Custom Chord Progression to Browser:"
        placeholder="Progression Name..."
        saveLabel="Save Progression"
        name={quickSaveName}
        onNameChange={setQuickSaveName}
        onSubmit={handleQuickSaveSubmit}
      />

      {/* Active Progression Blocks & Playable Chord Pads */}
      <div className="card bg-panel tint-chord border border-module-chord/30 p-4 shadow-xl space-y-3">
        <ModuleHeader
          className="flex-wrap gap-2"
          right={
            <div className="flex items-center gap-2">
              <button
                id="btn-add-chord"
                onClick={addChord}
                className="btn btn-xs gap-1 [--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Chord</span>
              </button>
              <AdjustSynthButton target="chord" className="text-module-chord" />
            </div>
          }
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-base-content uppercase tracking-wider">
              Active Chord Progression Loop
            </span>
            <span className={HEADER_BADGE}>
              {chords.length} Chords
            </span>
            {isAutoReharmonizedIndicator && (
              <span
                className="badge badge-sm badge-secondary badge-outline gap-1 animate-fade-in"
                title="Automatically reharmonized to active scale"
              >
                <Sparkles className="w-3 h-3 text-secondary" />
                <span>
                  Auto-Reharmonized to {scaleRoot} {scaleType}
                </span>
              </span>
            )}
          </div>
        </ModuleHeader>

        <ChordModulePanel
          onPatternPreviewDown={handleChordPatternPreviewMouseDown}
          onPatternPreviewUp={handleChordPatternPreviewMouseUp}
          autoReharmonize={autoReharmonize}
          isPlaying={isPlaying}
          onToggleAutoReharmonize={() => {
            // Turning this ON must not rewrite the current chords: a snap here
            // would reproduce the exact scramble this feature exists to
            // remove (e.g. key change made while OFF, then toggled back ON
            // would snap chords still sitting in the old key). Flipping the
            // flag only starts applying `applyKeyScaleChange` to *future*
            // key/scale changes; it is not itself a harmonize action. The
            // explicit "Re-harmonize" button is the deliberate,
            // user-requested snap — leave that one alone.
            const nextVal = !autoReharmonize;
            setAutoReharmonize(nextVal);
            if (!nextVal) setIsAutoReharmonizedIndicator(false);
          }}
          onReharmonize={() => {
            const updated = snapProgressionToScale(chords, scaleRoot, scaleType, chordOctave);
            setChords(updated);
            setIsAutoReharmonizedIndicator(true);
            setSaveToast(`Re-harmonized progression to ${scaleRoot} ${scaleType} (Option B)!`);
            setTimeout(() => setSaveToast(null), 3000);
          }}
        />

        {/* In-Scale & Borrowed Quick Add Palette */}
        <div className="bg-base-100 border border-base-300 rounded-box p-3 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-module-chord font-medium">
              <Sparkles className="w-3.5 h-3.5 text-module-chord" />
              <span>
                In-Scale Chords ({scaleRoot} {scaleType}):
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-base-content/60">
                Click to append, 🔊 to preview:
              </span>
              <button
                type="button"
                onClick={() => setUse7thsInQuickAdd(!use7thsInQuickAdd)}
                className={`btn btn-xs text-[10px] font-semibold ${
                  use7thsInQuickAdd
                    ? "[--btn-color:var(--color-module-chord)] [--btn-fg:var(--color-module-chord-content)]"
                    : "btn-ghost"
                }`}
              >
                {use7thsInQuickAdd ? "7th Chords" : "Triads"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {diatonicChords.map((diatonic, i) => {
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => addDiatonicChord(i)}
                  className="btn btn-xs btn-soft group gap-1.5 h-auto py-1 normal-case"
                  title={`Click to add ${formatChordLabel(diatonic.root, diatonic.quality)} (${diatonic.degreeName})`}
                >
                  <span className="font-mono text-[10px] text-module-chord font-bold bg-base-300 px-1.5 py-0.5 rounded-selector">
                    {diatonic.degreeName}
                  </span>
                  <span className="font-mono font-semibold">
                    {formatChordLabel(diatonic.root, diatonic.quality)}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) =>
                      handlePreviewMouseDown(e, diatonic.root, diatonic.quality)
                    }
                    onMouseUp={(e) =>
                      handlePreviewMouseUp(e)
                    }
                    onMouseLeave={(e) =>
                      handlePreviewMouseUp(e)
                    }
                    onTouchStart={(e) =>
                      handlePreviewMouseDown(e, diatonic.root, diatonic.quality)
                    }
                    onTouchEnd={(e) =>
                      handlePreviewMouseUp(e)
                    }
                    onKeyDown={(e) => {
                      // Press-and-hold audition: the key repeat would retrigger
                      // the chord every few milliseconds.
                      if (e.repeat) return;
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      handlePreviewMouseDown(e, diatonic.root, diatonic.quality);
                    }}
                    onKeyUp={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      handlePreviewMouseUp(e);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-base-content/60 hover:text-module-chord transition-colors ml-0.5 rounded-selector hover:bg-base-300 cursor-pointer select-none"
                    title="Hold to Preview Chord Audio"
                  >
                    <Volume2 className="w-2.5 h-2.5" />
                  </span>
                </button>
              );
            })}
          </div>

          {/* Borrowed Chords (Modal Interchange) */}
          <div className="pt-2 border-t border-base-300/80">
            <div className="flex items-center justify-between text-xs mb-2">
              <div className="flex items-center gap-1.5 text-secondary font-medium">
                <Music className="w-3.5 h-3.5 text-secondary" />
                <span>Borrowed Chords (Modal Interchange):</span>
              </div>
              <span className="text-[10px] text-base-content/60">
                Add colorful non-diatonic flavor:
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {borrowedChords.map((borrowed, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    addBorrowedChord(borrowed.root, borrowed.quality)
                  }
                  className="btn btn-xs btn-soft btn-secondary group gap-1.5 h-auto py-1 normal-case"
                  title={`Click to add ${borrowed.label}: ${formatChordLabel(borrowed.root, borrowed.quality)}`}
                >
                  <span className="font-mono text-[10px] text-secondary font-bold bg-base-300 px-1.5 py-0.5 rounded-selector">
                    {borrowed.label}
                  </span>
                  <span className="font-mono font-semibold">
                    {formatChordLabel(borrowed.root, borrowed.quality)}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) =>
                      handlePreviewMouseDown(e, borrowed.root, borrowed.quality)
                    }
                    onMouseUp={(e) =>
                      handlePreviewMouseUp(e)
                    }
                    onMouseLeave={(e) =>
                      handlePreviewMouseUp(e)
                    }
                    onTouchStart={(e) =>
                      handlePreviewMouseDown(e, borrowed.root, borrowed.quality)
                    }
                    onTouchEnd={(e) =>
                      handlePreviewMouseUp(e)
                    }
                    onKeyDown={(e) => {
                      // Press-and-hold audition: the key repeat would retrigger
                      // the chord every few milliseconds.
                      if (e.repeat) return;
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      handlePreviewMouseDown(e, borrowed.root, borrowed.quality);
                    }}
                    onKeyUp={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      handlePreviewMouseUp(e);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-base-content/60 hover:text-secondary transition-colors ml-0.5 rounded-selector hover:bg-base-300 cursor-pointer select-none"
                    title="Hold to Preview Chord Audio"
                  >
                    <Volume2 className="w-2.5 h-2.5" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={chordIds}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              {chords.map((chord, idx) => {
                const startBar = chords
                  .slice(0, idx)
                  .reduce((sum, c) => sum + (c.bars || 1), 1);
                const isActive =
                  playingIndex === idx || activeChordId === chord.id;
                const beatsPerBar = beatsPerBarFor(meterId);
                const activeBeat =
                  playheadChordIndex === idx
                    ? resolveBeatCounter({
                        playheadBeat,
                        chordStartBeat: playheadChordStartBeat,
                        bars: chord.bars,
                        beatsPerBar,
                      }).activeBeat
                    : null;
                return (
                  <SortableChordCard
                    key={chord.id}
                    chord={chord}
                    idx={idx}
                    totalChords={chords.length}
                    startBar={startBar}
                    isActive={isActive}
                    activeBeat={activeBeat}
                    beatsPerBar={beatsPerBar}
                    updateChord={updateChord}
                    removeChord={removeChord}
                    handleMoveChord={handleMoveChord}
                    handleCardPreviewMouseDown={handleCardPreviewMouseDown}
                    handleCardPreviewMouseUp={handleCardPreviewMouseUp}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Bass Module Panel */}
      <BassModulePanel
        onPatternPreviewDown={handleBassPatternPreviewMouseDown}
        onPatternPreviewUp={handleBassPatternPreviewMouseUp}
        isPlaying={isPlaying}
      />

      {/* Full Chord Preset Library Sidebar Drawer */}
      <Suspense
        fallback={
          isLibraryOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/60">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : null
        }
      >
        <ChordPresetLibrary
          isOpen={isLibraryOpen}
          onClose={() => setIsLibraryOpen(false)}
          currentChords={chords}
          scaleRoot={scaleRoot}
          scaleType={scaleType}
          autoReharmonize={autoReharmonize}
          synthParams={synthParams}
          onApplyChords={handleApplyLibraryChords}
        />
      </Suspense>
    </div>
  );
});

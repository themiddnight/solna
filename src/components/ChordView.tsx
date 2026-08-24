import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  Music,
  Sparkles,
  Plus,
  Library,
  Bookmark,
  Check,
  Volume2,
  VolumeX,
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
import { ChordItem, CustomChordProgressionItem } from "../types";
import { useAppStore } from "../store/store";
import { useChordPlayback } from "./chord/useChordPlayback";
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
} from "../audio/playback/chordPlayback";
import {
  getAllSynthPresets,
  findPresetByName,
  getPresetsGroupedByCategory,
} from "../audio/synthPresets";
import {
  RHYTHM_PATTERNS,
  RHYTHM_STYLE_GROUPS,
} from "../audio/rhythmPatterns";
import {
  BASS_PATTERNS,
  BASS_STYLE_GROUPS,
} from "../audio/bassPatterns";
import {
  deriveChordNotes,
  reharmonizeProgressionToScale,
  SCALES,
  getDiatonicChordForDegree,
  getBorrowedChords,
  formatChordLabel,
} from "../utils/musicTheory";
import { ChordPresetLibrary } from "./ChordPresetLibrary";
import { ChannelStrip } from "./ui/ChannelStrip";
import { QuickSavePopover } from "./ui/QuickSavePopover";
import { Slider } from "./ui/Slider";
import { SortableChordCard } from "./chord/SortableChordCard";

import { CHORD_PROGRESSION_TEMPLATES } from "../audio/data/chordProgressions";

const SELECT_BASE = "select select-sm select-bordered font-semibold";
const LABEL_BASE = "label-text text-[10px] text-base-content/60 block mb-1";

export const ChordView: React.FC = React.memo(() => {
  // ChordView reads the store directly (Task 5): every value below replaces
  // one of the ~34 props it used to receive from App.tsx.
  const chords = useAppStore((s) => s.chords);
  const setChords = useAppStore((s) => s.setChords);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const setChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const setBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const rhythmId = useAppStore((s) => s.chordRhythmId);
  const setChordRhythmId = useAppStore((s) => s.setChordRhythmId);
  const chordFeel = useAppStore((s) => s.chordFeel);
  const setChordFeel = useAppStore((s) => s.setChordFeel);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const setChordOctave = useAppStore((s) => s.setChordOctave);
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const setBassPatternId = useAppStore((s) => s.setBassPatternId);
  const bassFeel = useAppStore((s) => s.bassFeel);
  const setBassFeel = useAppStore((s) => s.setBassFeel);
  const bassOctave = useAppStore((s) => s.bassOctave);
  const setBassOctave = useAppStore((s) => s.setBassOctave);
  const chordMuted = useAppStore((s) => s.chordMuted);
  const toggleChordMuted = useAppStore((s) => s.toggleChordMuted);
  const bassMuted = useAppStore((s) => s.bassMuted);
  const toggleBassMuted = useAppStore((s) => s.toggleBassMuted);
  const bpm = useAppStore((s) => s.bpm);
  const chordVolume = useAppStore((s) => s.chordVolume);
  const setChordVolume = useAppStore((s) => s.setChordVolume);
  const bassVolume = useAppStore((s) => s.bassVolume);
  const setBassVolume = useAppStore((s) => s.setBassVolume);
  const { playChordWithRhythm, playBassWithPattern, playingIndex, activeChordId, setActiveChordId } = useChordPlayback();
  // Chord sound presets: factory presets plus presets saved from the synth view
  const customPresets = useAppStore((s) => s.customSynthPresets);

  const rhythmPattern = useMemo(
    () => RHYTHM_PATTERNS.find((p) => p.id === rhythmId) ?? RHYTHM_PATTERNS[0],
    [rhythmId],
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

  const handleMoveChord = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= chords.length) return;
    const updated = [...chords];
    const [removed] = updated.splice(index, 1);
    updated.splice(newIndex, 0, removed);
    setChords(updated);
  };

  const bassPattern =
    BASS_PATTERNS.find((p) => p.id === bassPatternId) ?? BASS_PATTERNS[0];

  // Volumes live in the store; engineSync pushes them into the engine buses
  // (no dual-write here — Task 5).
  const handleChordVolumeChange = (vol: number) => {
    setChordVolume(vol);
  };

  const handleBassVolumeChange = (vol: number) => {
    setBassVolume(vol);
  };

  // Auto-reharmonize current chords when scale/root changes if autoReharmonize is enabled
  useEffect(() => {
    if (autoReharmonize && chords.length > 0) {
      const updated = reharmonizeProgressionToScale(
        chords,
        scaleRoot,
        scaleType,
        chordOctave,
      );
      setChords(updated);
      setIsAutoReharmonizedIndicator(true);
    }
  }, [scaleRoot, scaleType]);

  const handleApplyLibraryChords = (libraryChords: ChordItem[]) => {
    let finalChords = libraryChords.map((c, i) =>
      deriveChordNotes(
        { ...c, id: `lib-chord-${Date.now()}-${i}` },
        chordOctave,
      ),
    );

    if (autoReharmonize) {
      finalChords = reharmonizeProgressionToScale(
        finalChords,
        scaleRoot,
        scaleType,
        chordOctave,
      );
      setIsAutoReharmonizedIndicator(true);
    } else {
      setIsAutoReharmonizedIndicator(false);
    }

    setChords(finalChords);
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
    e: React.MouseEvent | React.TouchEvent,
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

  const handlePreviewMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hasPreviewEngine()) return;

    stopChordPreviewSource(0.15);
  };

  const handleCardPreviewMouseDown = (
    e: React.MouseEvent | React.TouchEvent,
    chord: ChordItem,
  ) => {
    e.stopPropagation();
    ensurePreviewEngine();
    playChordLegatoWithEngine(chord, chordSynthParams);
    setActiveChordId(chord.id);
  };

  const handleCardPreviewMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (!hasPreviewEngine()) return;
    setActiveChordId(null);

    stopChordPreviewSource(0.15);
  };

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
    const barSeconds = previewBarSeconds(bpm) * (previewChord.bars || 1);

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
    const barSeconds = previewBarSeconds(bpm) * (previewChord.bars || 1);

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

  const removeChord = (id: string) => {
    setChords(chords.filter((c) => c.id !== id));
  };

  const updateChord = (id: string, updates: Partial<ChordItem>) => {
    setChords(
      chords.map((c) => {
        if (c.id !== id) return c;
        return deriveChordNotes({ ...c, ...updates }, chordOctave);
      }),
    );
  };

  const totalProgressionsCount =
    CHORD_PROGRESSION_TEMPLATES.length + customProgressions.length;

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* Scale & Chord Studio Header */}
      <div className="card bg-base-100 border border-base-300 shadow-md relative">
        <div className="card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/20 border border-primary/30 text-primary">
            <Music className="w-4 h-4" />
          </div>
          <h2 className="font-bold text-sm sm:text-base text-base-content">
            Chord Studio & Harmony
          </h2>
        </div>

        {/* Action Controls & Layer Mutes */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Per-layer mute toggles */}
          <button
            id="btn-mute-chord"
            onClick={toggleChordMuted}
            className={`btn btn-sm gap-1 text-xs font-semibold ${
              chordMuted ? "btn-error btn-outline" : "btn-ghost"
            }`}
            title="Mute Chord Layer"
          >
            {chordMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-error" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-primary" />
            )}
            <span>Chord {chordMuted ? "Off" : "On"}</span>
          </button>

          <button
            id="btn-mute-bass"
            onClick={toggleBassMuted}
            className={`btn btn-sm gap-1 text-xs font-semibold ${
              bassMuted ? "btn-error btn-outline" : "btn-ghost"
            }`}
            title="Mute Bass Layer"
          >
            {bassMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-error" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-accent" />
            )}
            <span>Bass {bassMuted ? "Off" : "On"}</span>
          </button>

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
            <Bookmark className="w-3.5 h-3.5 text-primary" />
            <span className="hidden sm:inline">Save</span>
          </button>

          {/* Open Presets Library Drawer Button */}
          <button
            id="btn-open-chord-presets-library"
            onClick={() => setIsLibraryOpen(true)}
            className="btn btn-sm btn-primary gap-1"
            title="Progression Library"
          >
            <Library className="w-3.5 h-3.5" />
            <span>Library</span>
            <span className="badge badge-sm badge-primary font-mono py-0.5 hidden sm:inline">
              {totalProgressionsCount}
            </span>
          </button>
        </div>

        {/* Floating Save Toast */}
        {saveToast && (
          <div className="alert alert-success absolute top-full right-4 mt-2 z-20 w-auto py-1.5 px-3 text-xs shadow-lg animate-fade-in">
            <Check className="w-3.5 h-3.5" />
            <span>{saveToast}</span>
          </div>
        )}
        </div>
      </div>

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
      <div className="card bg-base-100 border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between border-b border-base-300 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-base-content uppercase tracking-wider">
              Active Chord Progression Loop ({chords.length} Chords)
            </span>
            {isAutoReharmonizedIndicator && (
              <span
                className="badge badge-sm badge-secondary badge-outline gap-1 animate-fade-in"
                title="Automatically reharmonized to active scale"
              >
                <Sparkles className="w-3 h-3 text-secondary" />
                <span className="font-mono">
                  Auto-Reharmonized to {scaleRoot} {scaleType}
                </span>
              </span>
            )}
          </div>
          <button
            id="btn-add-chord"
            onClick={addChord}
            className="btn btn-xs btn-primary gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Chord</span>
          </button>
        </div>

        <div className="flex flex-row flex-wrap items-end gap-3">
          {/* Chord Sound Preset Select */}
          <div>
            <label className={LABEL_BASE}>Chord Preset</label>
            <select
              id="select-chord-sound-preset"
              value={chordSynthParams.preset ?? ""}
              onChange={(e) => {
                const preset = findPresetByName(
                  e.target.value,
                  getAllSynthPresets(customPresets),
                );
                if (!preset) return;
                setChordSynthParams({
                  ...chordSynthParams,
                  ...preset.params,
                  preset: preset.name,
                });
              }}
              className={SELECT_BASE}
              title="Chord sound preset — factory and saved presets, synced with the synth page"
            >
              <option value="">Chord Preset…</option>
              {getPresetsGroupedByCategory(
                getAllSynthPresets(customPresets),
              ).map((group) => (
                <optgroup key={group.category} label={group.label} className="font-bold">
                  {group.presets.map((p) => (
                    <option
                      key={p.id}
                      value={p.name}
                      className={p.isFactory ? "" : "text-secondary"}
                    >
                      {!p.isFactory ? `★ ${p.name}` : p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Chord Octave Select */}
          <div>
            <label className={LABEL_BASE}>Chord Octave</label>
            <select
              id="select-chord-octave"
              value={chordOctave}
              onChange={(e) => setChordOctave(parseInt(e.target.value, 10))}
              className={SELECT_BASE}
              title="Octave for chord playback"
            >
              {[2, 3, 4, 5, 6].map((o) => (
                <option key={o} value={o}>
                  Oct {o}
                </option>
              ))}
            </select>
          </div>

          {/* Chord Rhythm Pattern Select */}
          <div>
            <label className={LABEL_BASE}>Chord Pattern</label>
            <div className="flex items-center gap-1.5">
              <select
                id="select-chord-rhythm-pattern"
                value={rhythmId}
                onChange={(e) => setChordRhythmId(e.target.value)}
                className={SELECT_BASE}
                title="Rhythm pattern for chord playback"
              >
                {RHYTHM_STYLE_GROUPS.map((group) => (
                  <optgroup key={group.style} label={group.style}>
                    {group.patterns.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                id="btn-preview-chord-pattern"
                type="button"
                onMouseDown={handleChordPatternPreviewMouseDown}
                onMouseUp={handleChordPatternPreviewMouseUp}
                onMouseLeave={handleChordPatternPreviewMouseUp}
                onTouchStart={handleChordPatternPreviewMouseDown}
                onTouchEnd={handleChordPatternPreviewMouseUp}
                className="btn btn-xs btn-ghost btn-square text-primary select-none"
                title="Hold to Preview Chord Pattern Loop"
              >
                <Volume2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Chord Feel Slider (tight ↔ loose) */}
          <div>
            <label className={LABEL_BASE}>Chord Feel</label>
            <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-lg px-2.5 py-1 text-xs h-8">
              <span className="text-[9px] text-base-content/60 font-mono shrink-0">
                tight
              </span>
              <Slider
                id="slider-chord-feel"
                min={0}
                max={1}
                step={0.01}
                value={chordFeel}
                onChange={setChordFeel}
                className="range range-xs range-primary w-20"
                title="Chord note length: tight (short holds) ↔ loose (long holds)"
              />
              <span className="text-[9px] text-base-content/60 font-mono shrink-0">
                loose
              </span>
            </div>
          </div>

          {/* Chord Layer Volume Slider */}
          <ChannelStrip
            idPrefix="chord"
            label="Chord Level"
            volume={chordVolume}
            accentClass="text-primary"
            sliderClassName="range range-xs range-primary"
            onVolumeChange={handleChordVolumeChange}
          />
          {/* Option B Re-harmonize Button */}
          <button
            id="btn-reharmonize-chord-progression"
            onClick={() => {
              const updated = reharmonizeProgressionToScale(
                chords,
                scaleRoot,
                scaleType,
                chordOctave,
              );
              setChords(updated);
              setIsAutoReharmonizedIndicator(true);
              setSaveToast(
                `Re-harmonized progression to ${scaleRoot} ${scaleType} (Option B)!`,
              );
              setTimeout(() => setSaveToast(null), 3000);
            }}
            className="btn btn-sm btn-secondary gap-1.5"
            title="Option B: Diatonically snap current chord progression to active key and scale"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Re-harmonize</span>
          </button>

          {/* Auto-Reharmonize Toggle */}
          <button
            id="btn-toggle-auto-reharmonize"
            onClick={() => {
              const nextVal = !autoReharmonize;
              setAutoReharmonize(nextVal);
              if (nextVal && chords.length > 0) {
                const updated = reharmonizeProgressionToScale(
                  chords,
                  scaleRoot,
                  scaleType,
                  chordOctave,
                );
                setChords(updated);
                setIsAutoReharmonizedIndicator(true);
              } else {
                setIsAutoReharmonizedIndicator(false);
              }
            }}
            className={`btn btn-sm gap-1.5 text-xs font-semibold ${
              autoReharmonize ? "btn-secondary btn-outline" : "btn-ghost"
            }`}
            title="Toggle automatic re-harmonization when loading presets or changing scales"
          >
            <Sparkles
              className={`w-3.5 h-3.5 ${autoReharmonize ? "text-secondary" : "text-base-content/50"}`}
            />
            <span>Auto-Reharmonize: {autoReharmonize ? "ON" : "OFF"}</span>
          </button>
        </div>

        {/* In-Scale & Borrowed Quick Add Palette */}
        <div className="bg-base-100 border border-base-300 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-primary font-medium">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
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
                  use7thsInQuickAdd ? "btn-primary" : "btn-ghost"
                }`}
              >
                {use7thsInQuickAdd ? "7th Chords" : "Triads"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {Array.from({
              length: SCALES[scaleType]?.intervals.length || 7,
            }).map((_, i) => {
              const diatonic = getDiatonicChordForDegree(
                i,
                scaleRoot,
                scaleType,
                use7thsInQuickAdd,
              );
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => addDiatonicChord(i)}
                  className="btn btn-xs btn-outline group gap-1.5 h-auto py-1 normal-case"
                  title={`Click to add ${formatChordLabel(diatonic.root, diatonic.quality)} (${diatonic.degreeName})`}
                >
                  <span className="font-mono text-[10px] text-primary font-bold bg-base-300 px-1.5 py-0.5 rounded">
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
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-base-content/60 hover:text-primary transition-colors ml-0.5 rounded hover:bg-base-300 cursor-pointer select-none"
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
              {getBorrowedChords(scaleRoot, scaleType).map((borrowed, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    addBorrowedChord(borrowed.root, borrowed.quality)
                  }
                  className="btn btn-xs btn-outline btn-secondary group gap-1.5 h-auto py-1 normal-case"
                  title={`Click to add ${borrowed.label}: ${formatChordLabel(borrowed.root, borrowed.quality)}`}
                >
                  <span className="font-mono text-[10px] text-secondary font-bold bg-base-300 px-1.5 py-0.5 rounded">
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
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-base-content/60 hover:text-secondary transition-colors ml-0.5 rounded hover:bg-base-300 cursor-pointer select-none"
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
            items={chords.map((c) => c.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              {chords.map((chord, idx) => {
                const startBar = chords
                  .slice(0, idx)
                  .reduce((sum, c) => sum + (c.bars || 1), 1);
                const isActive =
                  playingIndex === idx || activeChordId === chord.id;
                return (
                  <SortableChordCard
                    key={chord.id}
                    chord={chord}
                    idx={idx}
                    totalChords={chords.length}
                    startBar={startBar}
                    isActive={isActive}
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
      <div className="mt-4 card bg-base-100 border border-accent/30 bg-gradient-to-br from-accent/10 to-transparent rounded-xl p-4">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-accent">Bass Module</h3>
          <p className="text-[10px] text-base-content/60">
            Bass line follows the same chord progression loop; pattern steps are
            16th notes.
          </p>
        </div>
        <div className="flex flex-row flex-wrap items-end gap-3">
          <div>
            <label className={LABEL_BASE}>Bass Preset</label>
            <select
              id="select-bass-sound-preset"
              value={bassSynthParams.preset ?? ""}
              onChange={(e) => {
                const preset = findPresetByName(
                  e.target.value,
                  getAllSynthPresets(customPresets),
                );
                if (!preset) return;
                setBassSynthParams({
                  ...bassSynthParams,
                  ...preset.params,
                  preset: preset.name,
                });
              }}
              className={SELECT_BASE}
              title="Bass sound preset — any factory, bass, or saved preset, synced with the synth page"
            >
              <option value="">Bass Preset…</option>
              {getPresetsGroupedByCategory(
                getAllSynthPresets(customPresets),
              ).map((group) => (
                <optgroup key={group.category} label={group.label} className="font-bold">
                  {group.presets.map((p) => (
                    <option
                      key={p.id}
                      value={p.name}
                      className={p.isFactory ? "" : "text-secondary"}
                    >
                      {!p.isFactory ? `★ ${p.name}` : p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_BASE}>Bass Octave</label>
            <select
              id="select-bass-octave"
              value={bassOctave}
              onChange={(e) => setBassOctave(parseInt(e.target.value, 10))}
              className={SELECT_BASE}
              title="Register for the bass line (embedded in the note names)"
            >
              {[1, 2, 3, 4].map((o) => (
                <option key={o} value={o}>
                  Oct {o}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_BASE}>Bass Pattern</label>
            <div className="flex items-center gap-1.5">
              <select
                id="select-bass-rhythm-pattern"
                value={bassPatternId}
                onChange={(e) => setBassPatternId(e.target.value)}
                className={SELECT_BASE}
                title="Bass pattern (16th-note grid, deterministic)"
              >
                {BASS_STYLE_GROUPS.map((group) => (
                  <optgroup key={group.style} label={group.style}>
                    {group.patterns.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                id="btn-preview-bass-pattern"
                type="button"
                onMouseDown={handleBassPatternPreviewMouseDown}
                onMouseUp={handleBassPatternPreviewMouseUp}
                onMouseLeave={handleBassPatternPreviewMouseUp}
                onTouchStart={handleBassPatternPreviewMouseDown}
                onTouchEnd={handleBassPatternPreviewMouseUp}
                className="btn btn-xs btn-ghost btn-square text-accent select-none"
                title="Hold to Preview Bass Pattern Loop"
              >
                <Volume2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Bass Feel Slider (tight ↔ loose) */}
          <div>
            <label className={LABEL_BASE}>Bass Feel</label>
            <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-lg px-2.5 py-1 text-xs h-8">
              <span className="text-[9px] text-base-content/60 font-mono shrink-0">
                tight
              </span>
              <Slider
                id="slider-bass-feel"
                min={0}
                max={1}
                step={0.01}
                value={bassFeel}
                onChange={setBassFeel}
                className="range range-xs range-accent w-20"
                title="Bass note length: tight (short holds) ↔ loose (long holds)"
              />
              <span className="text-[9px] text-base-content/60 font-mono shrink-0">
                loose
              </span>
            </div>
          </div>

          <ChannelStrip
            idPrefix="bass"
            label="Bass Level"
            volume={bassVolume}
            accentClass="text-accent"
            onVolumeChange={handleBassVolumeChange}
            showReadout={false}
            sliderClassName="range range-xs range-accent"
          />
        </div>
      </div>

      {/* Full Chord Preset Library Sidebar Drawer */}
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
    </div>
  );
});

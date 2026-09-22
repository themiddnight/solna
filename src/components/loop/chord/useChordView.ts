import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useAppStore } from '@/store/store';
import { usePlayheadBeat } from '@/components/playheadBeat';
import { useTimedToast } from '@/components/ui/useTimedToast';
import { useChordAudition } from './useChordAudition';
import { playingChord } from '@/components/playingChord';
import {
  resolvePlaybackBassCycle,
  resolvePlaybackRhythmCycle,
} from '@/audio/chordRhythms';
import {
  ensurePreviewEngine,
  hasPreviewEngine,
  playChordLegatoWithEngine,
  previewChordForScale,
  previewCycleSeconds,
  previewEngineTime,
  startPatternLoop,
  stopBassPreviewSource,
  stopChordPreviewSource,
} from '@/audio/playback/chordPlayback';
import { getMeter } from '@/utils/timeSignature';
import { scaleEntry } from '@/musicCore';
import type { ChordQuality } from '@/musicCore';
import {
  snapProgressionToScale,
  getDiatonicChordForDegree,
  getBorrowedChords,
  formatChordLabel,
  generateBlockChordNotes,
} from '@/utils/musicTheory';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { isProgressionAvailable } from './progressionAvailability';
import { CHORD_PROGRESSIONS } from '@/data/chordProgressions';
import type { ChordItem, CustomChordProgressionItem } from '@/types';

/**
 * ChordView's state and behaviour, as hooks rather than as one 700-line body.
 *
 * The split is by CONCERN, not by size: `state` is what the view reads,
 * `saves` and `editor` are what it writes, `harmonize` is the one rule that
 * runs on its own, and the two preview hooks are two different gestures that
 * happen to share a name. The component below composes them and renders.
 */

/** What ChordView reads: the store slice it subscribes to, plus the derived tables. */
export function useChordViewState() {
  const chords = useAppStore((s) => s.chords);
  const setChords = useAppStore((s) => s.setChords);
  const playheadBeat = usePlayheadBeat();
  const playheadChordIndex = useAppStore((s) => s.playheadChordIndex);
  const playheadChordStartBeat = useAppStore((s) => s.playheadChordStartBeat);
  const meterId = useAppStore((s) => s.meterId);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const spellingKey = { scaleRoot, scaleType };
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const rhythmId = useAppStore((s) => s.chordRhythmId);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const chordRhythmMode = useAppStore((s) => s.chordRhythmMode);
  const customChordRhythm = useAppStore((s) => s.customChordRhythm);
  const bassPatternMode = useAppStore((s) => s.bassPatternMode);
  const customBassPattern = useAppStore((s) => s.customBassPattern);
  const customChordHoldSteps = useAppStore((s) => s.customChordHoldSteps);
  const customChordLoopLength = useAppStore((s) => s.customChordLoopLength);
  const customBassHoldSteps = useAppStore((s) => s.customBassHoldSteps);
  const customBassLoopLength = useAppStore((s) => s.customBassLoopLength);
  const bpm = useAppStore((s) => s.bpm);
  const audition = useChordAudition();
  const isPlaying = useAppStore((s) => s.chordsPlayer !== 'stopped');
  // A held card's highlight. The clock's chord arrives through `playingChord`;
  // the two are last-writer-wins, as they were when both wrote one id, so a
  // publish (a new chord, or a clear) drops the held card's id.
  const [activeChordId, setActiveChordId] = useState<string | null>(null);
  useEffect(() => playingChord.subscribe(() => setActiveChordId(null)), []);

  // Stable identity so SortableContext's contextValue (which lists `items` in
  // its own dep array) doesn't change on every render — an inline
  // chords.map() here defeats React.memo on every SortableChordCard, which
  // otherwise correctly bails out on the twice-a-second playheadBeat churn.
  // Same pattern as ArrangeView.tsx's loopIds.
  const chordIds = useMemo(() => chords.map((c) => c.id), [chords]);

  // Each lane resolves its OWN cycle: a preset lands on one bar, a custom row
  // on its own `loopLength * stepsPerBar`, and the two may span different
  // numbers of bars. The progression is what the custom boundaries fold onto —
  // the same duration array `customPatternSpans` feeds the store edits, never
  // `ChordItem.bars` raw.
  const stepsPerBar = getMeter(meterId).stepsPerBar;
  const chordDurations = useMemo(
    () => chords.map((chord) => Math.max(1, chord.bars || 1) * stepsPerBar),
    [chords, stepsPerBar],
  );

  const chordCycle = useMemo(
    () =>
      resolvePlaybackRhythmCycle(
        chordRhythmMode,
        rhythmId,
        customChordRhythm,
        customChordHoldSteps,
        customChordLoopLength,
        stepsPerBar,
        getMeter(meterId).id,
        chordDurations,
      ),
    [
      chordRhythmMode, customChordRhythm, customChordHoldSteps, customChordLoopLength,
      rhythmId, stepsPerBar, meterId, chordDurations,
    ],
  );

  const bassCycle = useMemo(
    () =>
      resolvePlaybackBassCycle(
        bassPatternMode,
        bassPatternId,
        customBassPattern,
        customBassHoldSteps,
        customBassLoopLength,
        stepsPerBar,
        getMeter(meterId).id,
        chordDurations,
      ),
    [
      bassPatternMode, customBassPattern, customBassHoldSteps, customBassLoopLength,
      bassPatternId, stepsPerBar, meterId, chordDurations,
    ],
  );

  return {
    chords, setChords, playheadBeat, playheadChordIndex, playheadChordStartBeat, meterId,
    scaleRoot, scaleType, spellingKey, chordSynthParams, rhythmId, chordOctave,
    bassPatternId, chordRhythmMode, customChordRhythm, bassPatternMode, customBassPattern, bpm,
    audition, isPlaying, activeChordId, setActiveChordId, chordIds, chordCycle, bassCycle,
  };
}

export type ChordViewState = ReturnType<typeof useChordViewState>;

/** The quick-save popover, its toast, and the browser's saved progressions. */
export function useProgressionSaves(state: ChordViewState) {
  const chords = state.chords;
  const [customProgressions, setCustomProgressions] = useState<CustomChordProgressionItem[]>([]);
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>('');
  const { toast: saveToast, show: showSaveToast } = useTimedToast<string>();

  const handleQuickSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSaveName.trim() || chords.length === 0) return;

    const saved = useAppStore.getState().saveCustomChordProgression(
      quickSaveName.trim(),
      chords,
      'User',
      'Saved from Chord View',
      chords.map((c) => formatChordLabel(c.root, c.quality, state.spellingKey)).join(' → '),
    );

    setCustomProgressions(useAppStore.getState().customChordProgressions);
    setIsQuickSaving(false);
    setQuickSaveName('');
    showSaveToast(`Saved progression "${saved.name}"!`, 3000);
  };

  const openQuickSave = () => {
    setQuickSaveName(`Progression in ${state.scaleRoot}`);
    setIsQuickSaving(true);
  };

  return {
    customProgressions, isQuickSaving, quickSaveName, saveToast,
    showSaveToast, setQuickSaveName, openQuickSave,
    closeQuickSave: () => setIsQuickSaving(false),
    handleQuickSaveSubmit,
  };
}

export type ProgressionSaves = ReturnType<typeof useProgressionSaves>;

/** A new one-bar chord of the given root/quality, appended to the progression. */
function appendChord(
  chords: ChordItem[],
  root: string,
  quality: ChordQuality,
  id: string,
): ChordItem[] {
  return [...chords, { id, root, quality, bars: 1 }];
}

/**
 * Every way the progression itself is edited: add, remove, reorder, retune.
 *
 * `clearReharmonizeBadge` is handed in rather than reached for: the badge is
 * owned by the harmonize hook, and applying a library progression is not a
 * harmonization — it just has to retire the badge the last one left.
 */
export function useProgressionEditor(
  state: ChordViewState,
  clearReharmonizeBadge: () => void,
) {
  const { chords, setChords, scaleRoot, scaleType } = state;
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
  // stable. `chords` is read LIVE from the store: a useCallback([]) over the
  // render-scope value would pin the progression as of the first render and
  // silently corrupt every later edit. The chords slice exposes a
  // plain-value setter, not an updater.
  const handleMoveChord = useCallback((index: number, direction: -1 | 1) => {
    const { chords: liveChords, setChords: writeChords } = useAppStore.getState();
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= liveChords.length) return;
    const updated = [...liveChords];
    const [removed] = updated.splice(index, 1);
    updated.splice(newIndex, 0, removed);
    writeChords(updated);
  }, []);

  const removeChord = useCallback((id: string) => {
    const { chords: liveChords, setChords: writeChords } = useAppStore.getState();
    // A loop must keep at least one chord: an empty chords array makes
    // loopLengthSteps() 0, which freezes the song advance on that loop
    // (a silent dead end with no way past).
    if (liveChords.length <= 1) return;
    writeChords(liveChords.filter((c) => c.id !== id));
  }, []);

  const updateChord = useCallback((id: string, updates: Partial<ChordItem>) => {
    const { chords: liveChords, setChords: writeChords } = useAppStore.getState();
    writeChords(liveChords.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  }, []);

  const addChord = () => {
    setChords(appendChord(chords, scaleRoot, 'maj7', `chord-${Date.now()}`));
  };

  const addDiatonicChord = (degreeIndex: number) => {
    const diatonic = getDiatonicChordForDegree(
      degreeIndex,
      scaleRoot,
      scaleType,
      use7thsInQuickAdd,
    );
    setChords(
      appendChord(chords, diatonic.root, diatonic.quality, `chord-${Date.now()}`),
    );
  };

  const addBorrowedChord = (root: string, quality: ChordQuality) => {
    setChords(appendChord(chords, root, quality, `chord-${Date.now()}`));
  };

  const handleApplyLibraryChords = (libraryChords: ChordItem[]) => {
    // ChordPresetLibrary hands over chords already resolved in the active key
    // and scale (factory entries from their degrees, custom ones snapped), so
    // there is nothing left to harmonize here. Re-id only.
    setChords(
      libraryChords.map((c, i) => ({ ...c, id: `lib-chord-${Date.now()}-${i}` })),
    );
    clearReharmonizeBadge();
  };

  return {
    use7thsInQuickAdd, setUse7thsInQuickAdd, sensors, handleDragEnd, handleMoveChord,
    removeChord, updateChord, addChord, addDiatonicChord, addBorrowedChord,
    handleApplyLibraryChords,
  };
}

export type ProgressionEditor = ReturnType<typeof useProgressionEditor>;

/**
 * The auto-harmonize rule: a key or scale change rewrites the progression,
 * and the badge says it did. Held as one hook because the refs, the two
 * effects and the two buttons are one mechanism — split them and the
 * declaration order that keeps the refs fresh stops being visible.
 */
/**
 * The progression's harmonize controls. The key change itself — melodies AND
 * chords — is one store write (`changeKey`, store/keyChange.ts); this hook only
 * reads the session toggle and badge and offers the two buttons.
 */
export function useProgressionHarmonize(state: ChordViewState, saves: ProgressionSaves) {
  const { chords, setChords, scaleRoot, scaleType } = state;
  const autoReharmonize = useAppStore((s) => s.autoReharmonize);
  const isAutoReharmonizedIndicator = useAppStore((s) => s.reharmonizedIndicator);
  const setAutoReharmonize = useAppStore((s) => s.setAutoReharmonize);
  const setReharmonizedIndicator = useAppStore((s) => s.setReharmonizedIndicator);

  // Turning this ON must not rewrite the current chords (a snap here would
  // reproduce the scramble this feature exists to remove); the store action
  // only flips the flag, and turning it OFF clears the badge.
  const toggleAutoReharmonize = () => setAutoReharmonize(!autoReharmonize);

  const reharmonizeNow = () => {
    const updated = snapProgressionToScale(chords, scaleRoot, scaleType);
    setChords(updated);
    setReharmonizedIndicator(true);
    saves.showSaveToast(
      `Re-harmonized progression to ${formatKeyLabel(scaleRoot, scaleType)} (Option B)!`,
      3000,
    );
  };

  return {
    autoReharmonize,
    isAutoReharmonizedIndicator,
    toggleAutoReharmonize,
    reharmonizeNow,
    clearReharmonizeBadge: () => setReharmonizedIndicator(false),
  };
}

export type ProgressionHarmonize = ReturnType<typeof useProgressionHarmonize>;

/**
 * Held chord previews (catalog palette + progression cards): all notes
 * strike at once and sustain — no rhythm pattern, no scheduled note-offs.
 */
export function useHeldChordPreview(state: ChordViewState) {
  const { chordOctave, chordSynthParams, setActiveChordId } = state;

  const handlePreviewMouseDown = (
    e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent,
    root: string,
    quality: ChordQuality,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    ensurePreviewEngine();
    playChordLegatoWithEngine(generateBlockChordNotes(quality, root, chordOctave), chordSynthParams);
  };

  const handlePreviewMouseUp = (
    e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hasPreviewEngine()) return;

    stopChordPreviewSource(0.15);
  };

  const handleCardPreviewMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent, chord: ChordItem) => {
      e.stopPropagation();
      ensurePreviewEngine();
      const { chordOctave: liveOctave, chordSynthParams: liveSynth } = useAppStore.getState();
      playChordLegatoWithEngine(
        generateBlockChordNotes(chord.quality, chord.root, liveOctave),
        liveSynth,
      );
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

  return {
    handlePreviewMouseDown, handlePreviewMouseUp,
    handleCardPreviewMouseDown, handleCardPreviewMouseUp,
  };
}

export type HeldChordPreview = ReturnType<typeof useHeldChordPreview>;

/**
 * Pattern previews are per-module: the chord button loops the chord pattern
 * only, the bass button loops the bass pattern only. Both use the scale's
 * I triad as their sound source until the mouse is released.
 */
export function usePatternPreviews(state: ChordViewState) {
  const { bpm, scaleRoot, scaleType, chordCycle, bassCycle } = state;
  const { playChordWithRhythm, playBassWithPattern } = state.audition;
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

  /**
   * The scale's I triad, auditioned under the lane's own cycle. The timer and
   * the scheduler callback are handed the SAME cycle, so the interval is
   * exactly the material the callback lays down — one bar for a preset, the
   * lane's own `loopLength * stepsPerBar` for a custom row.
   */
  const previewSource = () => previewChordForScale(scaleRoot, scaleType);

  const handleChordPatternPreviewMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    ensurePreviewEngine();

    const previewChord = previewSource();
    chordPatternPreviewStopRef.current?.();
    chordPatternPreviewStopRef.current = startPatternLoop(
      (time) => playChordWithRhythm(previewChord, time, chordCycle),
      previewCycleSeconds(chordCycle.cycleSteps, bpm),
      previewEngineTime,
    );
  };

  const handleChordPatternPreviewMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hasPreviewEngine()) return;

    chordPatternPreviewStopRef.current?.();
    chordPatternPreviewStopRef.current = null;
    stopChordPreviewSource(0.15);
  };

  const handleBassPatternPreviewMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    ensurePreviewEngine();

    const previewChord = previewSource();
    bassPatternPreviewStopRef.current?.();
    bassPatternPreviewStopRef.current = startPatternLoop(
      (time) => playBassWithPattern(previewChord, time, bassCycle, [previewChord]),
      previewCycleSeconds(bassCycle.cycleSteps, bpm),
      previewEngineTime,
    );
  };

  const handleBassPatternPreviewMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hasPreviewEngine()) return;

    bassPatternPreviewStopRef.current?.();
    bassPatternPreviewStopRef.current = null;
    stopBassPreviewSource(0.15);
  };

  return {
    handleChordPatternPreviewMouseDown, handleChordPatternPreviewMouseUp,
    handleBassPatternPreviewMouseDown, handleBassPatternPreviewMouseUp,
  };
}

export type PatternPreviews = ReturnType<typeof usePatternPreviews>;

/**
 * The quick-add palette's two rows and the library counter. Both memos call
 * into tonal, and ChordView re-renders twice a second at 120 BPM
 * (the local playhead-beat publisher), so they must stay memoized.
 */
export function useChordPalette(
  scaleRoot: string,
  scaleType: string,
  use7thsInQuickAdd: boolean,
  customProgressions: readonly CustomChordProgressionItem[],
) {
  const borrowedChords = useMemo(
    () => getBorrowedChords(scaleRoot, scaleType),
    [scaleRoot, scaleType],
  );

  const diatonicChords = useMemo(
    () =>
      Array.from({ length: scaleEntry(scaleType).intervals.length }).map((_, i) =>
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

  return { borrowedChords, diatonicChords, totalProgressionsCount };
}

export type ChordPalette = ReturnType<typeof useChordPalette>;

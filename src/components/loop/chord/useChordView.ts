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
import { useChordPlayback } from './useChordPlayback';
import {
  resolvePlaybackBassPattern,
  resolvePlaybackRhythmPattern,
} from '@/audio/chordRhythms';
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
} from '@/audio/playback/chordPlayback';
import { getMeter } from '@/utils/meter';
import { SCALES } from '@/data/scales';
import {
  deriveChordNotes,
  snapProgressionToScale,
  getDiatonicChordForDegree,
  getBorrowedChords,
  formatChordLabel,
} from '@/utils/musicTheory';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { isProgressionAvailable } from './progressionAvailability';
import { CHORD_PROGRESSIONS } from '@/data/chordProgressions';
import {
  applyKeyScaleChange,
  shouldClearReharmonizeIndicator,
} from './progressionHarmonize';
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
  const playheadBeat = useAppStore((s) => s.playheadBeat);
  const playheadChordIndex = useAppStore((s) => s.playheadChordIndex);
  const playheadChordStartBeat = useAppStore((s) => s.playheadChordStartBeat);
  const meterId = useAppStore((s) => s.meterId);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const spellingKey = { scaleRoot, scaleType };
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const rhythmId = useAppStore((s) => s.chordRhythmId);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const chordRhythmMode = useAppStore((s) => s.chordRhythmMode);
  const customChordRhythm = useAppStore((s) => s.customChordRhythm);
  const bassPatternMode = useAppStore((s) => s.bassPatternMode);
  const customBassPattern = useAppStore((s) => s.customBassPattern);
  const bpm = useAppStore((s) => s.bpm);
  const playback = useChordPlayback();

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

  return {
    chords, setChords, playheadBeat, playheadChordIndex, playheadChordStartBeat, meterId,
    scaleRoot, scaleType, spellingKey, synthParams, chordSynthParams, rhythmId, chordOctave,
    bassPatternId, chordRhythmMode, customChordRhythm, bassPatternMode, customBassPattern, bpm,
    playback, chordIds, rhythmPattern, bassPattern,
  };
}

export type ChordViewState = ReturnType<typeof useChordViewState>;

/** The quick-save popover, its toast, and the browser's saved progressions. */
export function useProgressionSaves(state: ChordViewState) {
  const chords = state.chords;
  const [customProgressions, setCustomProgressions] = useState<CustomChordProgressionItem[]>([]);
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>('');
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const handleQuickSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSaveName.trim() || chords.length === 0) return;

    const saved = useAppStore.getState().saveCustomChordProgression(
      quickSaveName.trim(),
      chords,
      'User',
      'Saved from Chord View',
      chords.map((c) => formatChordLabel(c.root, c.quality)).join(' → '),
    );

    setCustomProgressions(useAppStore.getState().customChordProgressions);
    setIsQuickSaving(false);
    setQuickSaveName('');
    setSaveToast(`Saved progression "${saved.name}"!`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const openQuickSave = () => {
    setQuickSaveName(`Progression in ${state.scaleRoot}`);
    setIsQuickSaving(true);
  };

  return {
    customProgressions, isQuickSaving, quickSaveName, saveToast,
    setSaveToast, setQuickSaveName, openQuickSave,
    closeQuickSave: () => setIsQuickSaving(false),
    handleQuickSaveSubmit,
  };
}

export type ProgressionSaves = ReturnType<typeof useProgressionSaves>;

/** A new one-bar chord of the given root/quality, appended to the progression. */
function appendChord(
  chords: ChordItem[],
  root: string,
  quality: string,
  octave: number,
  id: string,
): ChordItem[] {
  return [...chords, deriveChordNotes({ id, root, quality, bars: 1, notes: [] }, octave)];
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
  const { chords, setChords, scaleRoot, scaleType, chordOctave } = state;
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
    const { chords: liveChords, chordOctave: liveChordOctave, setChords: writeChords } =
      useAppStore.getState();
    writeChords(
      liveChords.map((c) => {
        if (c.id !== id) return c;
        return deriveChordNotes({ ...c, ...updates }, liveChordOctave);
      }),
    );
  }, []);

  const addChord = () => {
    setChords(appendChord(chords, scaleRoot, 'maj7', chordOctave, `chord-${Date.now()}`));
  };

  const addDiatonicChord = (degreeIndex: number) => {
    const diatonic = getDiatonicChordForDegree(
      degreeIndex,
      scaleRoot,
      scaleType,
      use7thsInQuickAdd,
    );
    setChords(
      appendChord(chords, diatonic.root, diatonic.quality, chordOctave, `chord-${Date.now()}`),
    );
  };

  const addBorrowedChord = (root: string, quality: string) => {
    setChords(appendChord(chords, root, quality, chordOctave, `chord-${Date.now()}`));
  };

  const handleApplyLibraryChords = (libraryChords: ChordItem[]) => {
    // ChordPresetLibrary hands over chords already resolved in the active key
    // and scale (factory entries from their degrees, custom ones snapped), so
    // there is nothing left to harmonize here. Re-id and re-derive only.
    setChords(
      libraryChords.map((c, i) =>
        deriveChordNotes({ ...c, id: `lib-chord-${Date.now()}-${i}` }, chordOctave),
      ),
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
export function useProgressionHarmonize(state: ChordViewState, saves: ProgressionSaves) {
  const { chords, setChords, scaleRoot, scaleType, chordOctave } = state;
  const [autoReharmonize, setAutoReharmonize] = useState<boolean>(true);
  const [isAutoReharmonizedIndicator, setIsAutoReharmonizedIndicator] = useState<boolean>(false);

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

  const toggleAutoReharmonize = () => {
    // Turning this ON must not rewrite the current chords: a snap
    // here would reproduce the exact scramble this feature exists
    // to remove (e.g. key change made while OFF, then toggled back
    // ON would snap chords still sitting in the old key). Flipping
    // the flag only starts applying `applyKeyScaleChange` to
    // *future* key/scale changes; it is not itself a harmonize
    // action. The explicit "Re-harmonize" button is the
    // deliberate, user-requested snap — leave that one alone.
    const nextVal = !autoReharmonize;
    setAutoReharmonize(nextVal);
    if (!nextVal) setIsAutoReharmonizedIndicator(false);
  };

  const reharmonizeNow = () => {
    const updated = snapProgressionToScale(chords, scaleRoot, scaleType, chordOctave);
    setChords(updated);
    setIsAutoReharmonizedIndicator(true);
    saves.setSaveToast(
      `Re-harmonized progression to ${formatKeyLabel(scaleRoot, scaleType)} (Option B)!`,
    );
    setTimeout(() => saves.setSaveToast(null), 3000);
  };

  return {
    autoReharmonize,
    isAutoReharmonizedIndicator,
    toggleAutoReharmonize,
    reharmonizeNow,
    clearReharmonizeBadge: () => setIsAutoReharmonizedIndicator(false),
  };
}

export type ProgressionHarmonize = ReturnType<typeof useProgressionHarmonize>;

/**
 * Held chord previews (catalog palette + progression cards): all notes
 * strike at once and sustain — no rhythm pattern, no scheduled note-offs.
 */
export function useHeldChordPreview(state: ChordViewState) {
  const { chordOctave, chordSynthParams, playback } = state;
  const { setActiveChordId } = playback;

  const handlePreviewMouseDown = (
    e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent,
    root: string,
    quality: string,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    ensurePreviewEngine();
    const tempChord: ChordItem = {
      id: 'preview',
      root,
      quality,
      bars: 1,
      notes: [],
    };
    playChordLegatoWithEngine(deriveChordNotes(tempChord, chordOctave), chordSynthParams);
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
  const { bpm, meterId, scaleRoot, scaleType, chordOctave, rhythmPattern, bassPattern } = state;
  const { playChordWithRhythm, playBassWithPattern } = state.playback;
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

  /** The scale's I triad, and how long one of its bars lasts at the active tempo. */
  const previewSource = () => {
    const previewChord = previewChordForScale(scaleRoot, scaleType, chordOctave);
    const barSeconds =
      previewBarSeconds(bpm, getMeter(meterId).stepsPerBar) * (previewChord.bars || 1);
    return { previewChord, barSeconds };
  };

  const handleChordPatternPreviewMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    ensurePreviewEngine();

    const { previewChord, barSeconds } = previewSource();
    chordPatternPreviewStopRef.current?.();
    chordPatternPreviewStopRef.current = startPatternLoop(
      (time) => playChordWithRhythm(previewChord, time, rhythmPattern),
      barSeconds,
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

    const { previewChord, barSeconds } = previewSource();
    bassPatternPreviewStopRef.current?.();
    bassPatternPreviewStopRef.current = startPatternLoop(
      (time) => playBassWithPattern(previewChord, time, bassPattern, [previewChord]),
      barSeconds,
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
 * (playheadBeat), so they must stay memoized.
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

  return { borrowedChords, diatonicChords, totalProgressionsCount };
}

export type ChordPalette = ReturnType<typeof useChordPalette>;

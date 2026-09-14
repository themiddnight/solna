import React, { useMemo } from "react";
import { useAppStore } from "@/store/store";
import type { SynthPreset } from "@/data/synthPresets";
import { CHORD_RHYTHM_STYLE_GROUPS } from '@/audio/chordRhythms';
import {
  getAllSynthPresets,
  groupPresets,
} from "@/utils/synthPresets";
import { getMeter } from "@/utils/meter";
import { foldPatternBoundaries, loopLengthDivisors, patternStoredIndexAt } from "@/utils/patternTimeline";
import { loopBars } from "@/utils/songStructure";
import { ModulePanelCard } from "./ModulePanelCard";
import { ModulePasteButton } from "../ModulePasteButton";
import { CustomPatternTimeline } from "./CustomPatternTimeline";
import {
  FeelSlider,
  OctaveSelect,
  PatternBarsField,
  PatternSelect,
  SoundPresetField,
} from "./moduleFields";
import { loadSynthPreset } from '@/store/synthPresetInstall';

export interface ChordModulePanelProps {
  onPatternPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onPatternPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
  /** Owned by ChordView, not this panel; passed through only to gate the timeline's playhead. */
  isPlaying: boolean;
}

/** The chord voicing's register — above the bass card's, below the pad's. */
const CHORD_OCTAVES = [2, 3, 4, 5, 6];

/**
 * What an activation on `column` writes: an empty column starts a one-step
 * onset, an already-active head clears it.
 *
 * It reads the value FIRST, because that is what makes the gesture a toggle —
 * re-firing `setCustomChordEvent(column, true)` at a head that is already on is
 * a write with no state change behind it, and the second click would do
 * nothing.
 *
 * The value comes from the STORED slot and not from `values[column]`: storage
 * is bar-major at `MAX_STEPS_PER_BAR`, so an index into it agrees with the
 * column only in the widest meter — the same reason the draw path goes through
 * `customPatternCells`.
 *
 * Exported so the toggle is pinned without a DOM, which this repo does not have.
 */
export function chordActivationValue(
  values: readonly boolean[],
  column: number,
  stepsPerBar: number,
): boolean {
  return !values[patternStoredIndexAt(column, stepsPerBar)];
}

/**
 * The chord lane: the `custom` branch of the pattern field, rendered below the
 * field row rather than inside the "Chord Pattern" cell, where its buttons
 * shared the width of one dropdown and rendered ~7px wide.
 *
 * A chord event has a LENGTH, so this is the span timeline and not one of the
 * drum sequencer's `StepRow`s: a held chord is one block the user can resize,
 * not a run of identical one-step cells that cannot say where it ends.
 *
 * It reads its own lane and its own meter, so the card above renders one
 * element for the whole branch and never re-renders when a step is toggled.
 */
function ChordPatternEditor({ isPlaying }: { isPlaying: boolean }) {
  const meterId = useAppStore((s) => s.meterId);
  const chords = useAppStore((s) => s.chords);
  const customChordRhythm = useAppStore((s) => s.customChordRhythm);
  const customChordHoldSteps = useAppStore((s) => s.customChordHoldSteps);
  const customChordLoopLength = useAppStore((s) => s.customChordLoopLength);
  const setCustomChordEvent = useAppStore((s) => s.setCustomChordEvent);
  const setCustomChordEventLength = useAppStore((s) => s.setCustomChordEventLength);

  const { stepsPerBar, accentGroups } = getMeter(meterId);
  const cycleSteps = customChordLoopLength * stepsPerBar;
  // The boundary map the store clamps a hold against (`customChordSpans`),
  // derived here from the same two inputs it uses. The lane must not draw a
  // block wider than the store will ever let the span become.
  const boundaries = useMemo(
    () => foldPatternBoundaries(
      chords.map((chord) => chord.bars * stepsPerBar),
      cycleSteps,
    ),
    [chords, stepsPerBar, cycleSteps],
  );

  return (
    <CustomPatternTimeline
      className="mt-3"
      values={customChordRhythm}
      holds={customChordHoldSteps}
      loopLength={customChordLoopLength}
      stepsPerBar={stepsPerBar}
      accentGroups={accentGroups}
      boundaries={boundaries}
      empty={false}
      label="Chord"
      color="bg-module-chord text-module-chord-content"
      isPlaying={isPlaying}
      onActivate={(column) =>
        setCustomChordEvent(column, chordActivationValue(customChordRhythm, column, stepsPerBar))
      }
      onErase={(column) => setCustomChordEvent(column, false)}
      onResize={setCustomChordEventLength}
    />
  );
}

/**
 * The card's control row: sound, register, comping pattern and its length,
 * feel.
 *
 * Reads its own slice rather than taking eight props — the same rule the three
 * module cards follow. The two preview handlers cannot be derived here (they
 * own ChordView's preview refs and the resolved rhythm pattern) and come in as
 * props, already stable useCallbacks in ChordView.
 */
function ChordPatternFields({
  onPatternPreviewDown,
  onPatternPreviewUp,
}: Pick<ChordModulePanelProps, 'onPatternPreviewDown' | 'onPatternPreviewUp'>) {
  const meterId = useAppStore((s) => s.meterId);
  const chords = useAppStore((s) => s.chords);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const rhythmId = useAppStore((s) => s.chordRhythmId);
  const setChordRhythmId = useAppStore((s) => s.setChordRhythmId);
  const chordFeel = useAppStore((s) => s.chordFeel);
  const setChordFeel = useAppStore((s) => s.setChordFeel);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const setChordOctave = useAppStore((s) => s.setChordOctave);
  const chordRhythmMode = useAppStore((s) => s.chordRhythmMode);
  const setChordRhythmMode = useAppStore((s) => s.setChordRhythmMode);
  const customChordLoopLength = useAppStore((s) => s.customChordLoopLength);
  const setCustomChordLoopLength = useAppStore((s) => s.setCustomChordLoopLength);
  const customPresets = useAppStore((s) => s.customSynthPresets);

  const allPresets = useMemo(
    () => getAllSynthPresets(customPresets),
    [customPresets],
  );
  const presetGroups = useMemo(
    () => groupPresets(allPresets),
    [allPresets],
  );
  // Only the divisors of the progression: a length it cannot divide leaves a
  // gap at the end of every repetition. The slice clamps to the same set, so
  // this field offers choices that survive the write rather than filtering
  // afterwards.
  const barOptions = useMemo(() => loopLengthDivisors(loopBars(chords)), [chords]);

  // `Custom…` swaps the dropdown's job for the span timeline below the row.
  const selectChordPattern = (value: string) => {
    if (value === 'custom') {
      setChordRhythmMode('custom');
      return;
    }
    setChordRhythmMode('preset');
    setChordRhythmId(value);
  };

  // The bus stop, the Arp read and the patch write all live in
  // `store/synthPresetInstall.ts` — see there for why a load stops the bus and
  // adopting a just-saved preset does not.
  const pickPreset = (preset: SynthPreset) => {
    loadSynthPreset('chord', preset);
  };

  return (
    <div className="flex flex-row flex-wrap items-end gap-3">
          <SoundPresetField
            id="select-chord-sound-preset"
            title="Chord sound preset — factory and saved presets, synced with the synth page"
            placeholder="Chord Preset…"
            groups={presetGroups}
            allPresets={allPresets}
            selectedPresetId={chordSynthParams.sourcePresetId}
            onPick={pickPreset}
          />

          <OctaveSelect
            id="select-chord-octave"
            label="Octave"
            title="Octave for chord playback"
            value={chordOctave}
            onChange={setChordOctave}
            octaves={CHORD_OCTAVES}
          />

          <PatternSelect
            id="select-chord-rhythm-pattern"
            label="Pattern"
            selectTitle="Rhythm pattern for chord playback"
            previewId="btn-preview-chord-pattern"
            previewLabel="Hold to Preview Chord Pattern Loop"
            previewTint="text-module-chord"
            value={chordRhythmMode === 'custom' ? 'custom' : rhythmId}
            groups={CHORD_RHYTHM_STYLE_GROUPS}
            onChange={selectChordPattern}
            onPreviewDown={onPatternPreviewDown}
            onPreviewUp={onPatternPreviewUp}
            meterId={meterId}
          />

          {/* Beside the pattern it lengthens, and only while that pattern is
              this lane's own: a preset already states its own length. */}
          {chordRhythmMode === 'custom' && (
            <PatternBarsField
              id="select-chord-pattern-bars"
              value={customChordLoopLength}
              options={barOptions}
              onChange={setCustomChordLoopLength}
            />
          )}

          <FeelSlider
            id="slider-chord-feel"
            value={chordFeel}
            onChange={setChordFeel}
            tint="text-module-chord [--range-thumb:var(--color-module-chord-content)]"
            title="Chord note length: tight (short holds) ↔ loose (long holds)"
          />
        </div>
  );
}

/**
 * The chord layer's own card — sibling to BassModulePanel and PadModulePanel,
 * and holding the same kind of controls they do: sound, register, comping
 * rhythm, feel, level.
 *
 * What it deliberately does NOT hold is Re-harmonize / Auto-Reharmonize. Those
 * two call `setChords` — they rewrite the progression every layer reads, not
 * this layer's voice of it — so they live in ChordView's progression card,
 * beside the `Auto-Reharmonized to …` badge that reports their effect.
 *
 * All it gates itself is the lane below the field row.
 */
export function ChordModulePanel({
  onPatternPreviewDown,
  onPatternPreviewUp,
  isPlaying,
}: ChordModulePanelProps) {
  const chordRhythmMode = useAppStore((s) => s.chordRhythmMode);

  // No `mt-4`: the GroupFrame in ChordView owns the spacing between these three
  // cards now (`p-1` + `gap-3 sm:gap-4`). The margin was left over from when
  // they were direct children of a `space-y` root, and inside the frame it
  // double-counted — a 20px top inset against 4px on the other three sides, and
  // 28px between cards where the gap says 12.
  // `role="group"` + the heading as its label is what lets every field below
  // drop its `Chord ` prefix: the context a screen reader needs comes from the
  // group, not from repeating the word five times.
  return (
    <ModulePanelCard
      target="chord"
      title="Chord Module"
      description={
        <>
          How the chord layer voices the progression above: its sound,
              register and comping rhythm.
        </>
      }
      actions={<ModulePasteButton groups={['chord-sound', 'chord-pattern']} />}
    >
      <ChordPatternFields
        onPatternPreviewDown={onPatternPreviewDown}
        onPatternPreviewUp={onPatternPreviewUp}
      />

      {chordRhythmMode === 'custom' && <ChordPatternEditor isPlaying={isPlaying} />}
    </ModulePanelCard>
  );
}

import React, { useMemo } from "react";
import { useAppStore } from "@/store/store";
import { CHORD_RHYTHM_STYLE_GROUPS } from '@/audio/chordRhythms';
import {
  applyPreset,
  getAllSynthPresets,
  getPresetsGroupedByCategory,
} from "@/audio/presetRegistry";
import { getMeter } from "@/utils/meter";
import { stepCells } from "@/components/sequencerGrid";
import { PlayingStepRow } from "@/components/ui/StepRow";
import { ModulePanelCard } from "./ModulePanelCard";
import { ModulePasteButton } from "../ModulePasteButton";
import {
  CustomPatternSteps,
  FeelSlider,
  OctaveSelect,
  PatternSelect,
  SoundPresetField,
} from "./moduleFields";

export interface ChordModulePanelProps {
  onPatternPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onPatternPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
  /** Owned by ChordView, not this panel; passed through only to gate the PlayingStepRow ring. */
  isPlaying: boolean;
}

/** The chord voicing's register — above the bass card's, below the pad's. */
const CHORD_OCTAVES = [2, 3, 4, 5, 6];

/**
 * The custom comping grid: the `custom` branch of the pattern field, below the
 * field row rather than inside the "Chord Pattern" field cell, where its 16
 * buttons shared the width of one dropdown and rendered ~7px wide. Same
 * `StepRow` the drum sequencer uses; only the container changed.
 *
 * Reads the grid and its meter itself, so the card above renders one element
 * for the whole branch and never re-renders when a step is toggled.
 */
function ChordPatternEditor({ isPlaying }: { isPlaying: boolean }) {
  const meterId = useAppStore((s) => s.meterId);
  const customChordRhythm = useAppStore((s) => s.customChordRhythm);
  const setCustomChordRhythm = useAppStore((s) => s.setCustomChordRhythm);

  const cells = useMemo(() => stepCells(getMeter(meterId)), [meterId]);

  return (
    <CustomPatternSteps
      labelId="label-custom-chord-pattern"
      label="Custom Chord Pattern"
      cells={cells}
      isPlaying={isPlaying}
    >
      <PlayingStepRow<boolean>
        player="chords"
        cells={cells}
        steps={customChordRhythm}
        isPlaying={isPlaying}
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={(i) =>
          setCustomChordRhythm(
            customChordRhythm.map((v, idx) => (idx === i ? !v : v)),
          )
        }
      />
    </CustomPatternSteps>
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
 * Reads its own slice of the store; the two pattern-preview handlers cannot be
 * derived here (they own ChordView's preview refs and the resolved rhythm
 * pattern) and come in as props, already stable useCallbacks in ChordView.
 */
export function ChordModulePanel({
  onPatternPreviewDown,
  onPatternPreviewUp,
  isPlaying,
}: ChordModulePanelProps) {
  const meterId = useAppStore((s) => s.meterId);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const setChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const rhythmId = useAppStore((s) => s.chordRhythmId);
  const setChordRhythmId = useAppStore((s) => s.setChordRhythmId);
  const chordFeel = useAppStore((s) => s.chordFeel);
  const setChordFeel = useAppStore((s) => s.setChordFeel);
  const chordOctave = useAppStore((s) => s.chordOctave);
  const setChordOctave = useAppStore((s) => s.setChordOctave);
  const chordRhythmMode = useAppStore((s) => s.chordRhythmMode);
  const setChordRhythmMode = useAppStore((s) => s.setChordRhythmMode);
  const customPresets = useAppStore((s) => s.customSynthPresets);

  const allPresets = useMemo(
    () => getAllSynthPresets(customPresets),
    [customPresets],
  );
  const presetGroups = useMemo(
    () => getPresetsGroupedByCategory(allPresets),
    [allPresets],
  );

  // `Custom…` swaps the dropdown's job for the step grid below it.
  const selectChordPattern = (value: string) => {
    if (value === 'custom') {
      setChordRhythmMode('custom');
      return;
    }
    setChordRhythmMode('preset');
    setChordRhythmId(value);
  };

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
      <div className="flex flex-row flex-wrap items-end gap-3">
          <SoundPresetField
            id="select-chord-sound-preset"
            title="Chord sound preset — factory and saved presets, synced with the synth page"
            placeholder="Chord Preset…"
            groups={presetGroups}
            allPresets={allPresets}
            value={chordSynthParams.preset ?? ""}
            onPick={(preset) =>
              setChordSynthParams(applyPreset(chordSynthParams, preset))
            }
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

          <FeelSlider
            id="slider-chord-feel"
            value={chordFeel}
            onChange={setChordFeel}
            tint="text-module-chord [--range-thumb:var(--color-module-chord-content)]"
            title="Chord note length: tight (short holds) ↔ loose (long holds)"
          />
        </div>

        {chordRhythmMode === 'custom' && <ChordPatternEditor isPlaying={isPlaying} />}
    </ModulePanelCard>
  );
}

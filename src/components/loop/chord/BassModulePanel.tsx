import React, { useMemo } from "react";
import { useAppStore } from "@/store/store";
import { BASS_STYLE_GROUPS } from "@/audio/bassPatterns";
import { type BassStepChoice } from "@/data/bassPatterns";
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
import { bassStepLabel, nextBassStepChoice } from "./bassStepChoice";

export interface BassModulePanelProps {
  onPatternPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onPatternPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
  /** Owned by ChordView, not this panel; passed through only to gate the PlayingStepRow ring. */
  isPlaying: boolean;
}

/** The bass line's register, narrower at the top than the chord card's. */
const BASS_OCTAVES = [1, 2, 3, 4];

/**
 * The custom step grid: the same `PlayingStepRow` the chord and drum grids use,
 * stepping through the tone cycle rather than toggling a boolean.
 *
 * Reads the grid and its meter itself, so the card above renders one element
 * for the whole `custom` branch and never re-renders when a step is edited.
 */
function BassStepEditor({ isPlaying }: { isPlaying: boolean }) {
  const meterId = useAppStore((s) => s.meterId);
  const customBassPattern = useAppStore((s) => s.customBassPattern);
  const setCustomBassPattern = useAppStore((s) => s.setCustomBassPattern);

  const cells = useMemo(() => stepCells(getMeter(meterId)), [meterId]);

  return (
    <CustomPatternSteps
      className="mt-3"
      labelId="label-custom-bass-pattern"
      label="Custom Bass Pattern"
      cells={cells}
      isPlaying={isPlaying}
    >
      {/* The tone letters bassStepLabel draws are only legible once a block is
          wider than the letter itself. */}
      <PlayingStepRow<BassStepChoice>
        player="chords"
        cells={cells}
        steps={customBassPattern}
        isPlaying={isPlaying}
        color="bg-module-bass text-module-bass-content"
        isActive={(v) => v !== 'rest'}
        getLabel={bassStepLabel}
        onStepClick={(i) =>
          setCustomBassPattern(
            customBassPattern.map((v, idx) =>
              idx === i ? nextBassStepChoice(v) : v,
            ),
          )
        }
      />
    </CustomPatternSteps>
  );
}

export function BassModulePanel({
  onPatternPreviewDown,
  onPatternPreviewUp,
  isPlaying,
}: BassModulePanelProps) {
  const meterId = useAppStore((s) => s.meterId);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const setBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const customPresets = useAppStore((s) => s.customSynthPresets);
  const bassOctave = useAppStore((s) => s.bassOctave);
  const setBassOctave = useAppStore((s) => s.setBassOctave);
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const setBassPatternId = useAppStore((s) => s.setBassPatternId);
  const bassPatternMode = useAppStore((s) => s.bassPatternMode);
  const setBassPatternMode = useAppStore((s) => s.setBassPatternMode);
  const bassFeel = useAppStore((s) => s.bassFeel);
  const setBassFeel = useAppStore((s) => s.setBassFeel);

  const allPresets = useMemo(
    () => getAllSynthPresets(customPresets),
    [customPresets],
  );
  const presetGroups = useMemo(
    () => getPresetsGroupedByCategory(allPresets),
    [allPresets],
  );

  // `Custom…` swaps the dropdown's job for the step grid below it: the mode is
  // what the grid is gated on, and the id is what the dropdown shows.
  const selectBassPattern = (value: string) => {
    if (value === 'custom') {
      setBassPatternMode('custom');
      return;
    }
    setBassPatternMode('preset');
    setBassPatternId(value);
  };

  // No `mt-4`, and `role="group"` names this card for a screen reader — see the
  // note in ChordModulePanel for both.
  return (
    <ModulePanelCard
      target="bass"
      title="Bass Module"
      description={
        <>
          Bass line follows the same chord progression loop; pattern steps
              are 16th notes.
        </>
      }
      actions={<ModulePasteButton groups={['bass-sound', 'bass-pattern']} />}
    >
      <div className="flex flex-row flex-wrap items-end gap-3">
          <SoundPresetField
            id="select-bass-sound-preset"
            title="Bass sound preset — any factory, bass, or saved preset, synced with the synth page"
            placeholder="Bass Preset…"
            groups={presetGroups}
            allPresets={allPresets}
            value={bassSynthParams.preset ?? ""}
            onPick={(preset) =>
              setBassSynthParams(applyPreset(bassSynthParams, preset))
            }
          />

          <OctaveSelect
            id="select-bass-octave"
            label="Octave"
            title="Register for the bass line (embedded in the note names)"
            value={bassOctave}
            onChange={setBassOctave}
            octaves={BASS_OCTAVES}
          />

          <PatternSelect
            id="select-bass-rhythm-pattern"
            label="Pattern"
            selectTitle="Bass pattern (16th-note grid, deterministic)"
            previewId="btn-preview-bass-pattern"
            previewLabel="Hold to Preview Bass Pattern Loop"
            previewTint="text-module-bass"
            value={bassPatternMode === 'custom' ? 'custom' : bassPatternId}
            groups={BASS_STYLE_GROUPS}
            onChange={selectBassPattern}
            onPreviewDown={onPatternPreviewDown}
            onPreviewUp={onPatternPreviewUp}
            meterId={meterId}
          />

          <FeelSlider
            id="slider-bass-feel"
            value={bassFeel}
            onChange={setBassFeel}
            tint="text-module-bass [--range-thumb:var(--color-module-bass-content)]"
            title="Bass note length: tight (short holds) ↔ loose (long holds)"
          />
        </div>

        {bassPatternMode === 'custom' && <BassStepEditor isPlaying={isPlaying} />}
    </ModulePanelCard>
  );
}

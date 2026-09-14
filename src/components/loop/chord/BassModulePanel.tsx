import React, { useMemo, useState } from "react";
import { useAppStore } from "@/store/store";
import type { SynthPreset } from "@/data/synthPresets";
import { BASS_STYLE_GROUPS } from "@/audio/bassPatterns";
import {
  getAllSynthPresets,
  groupPresets,
} from "@/utils/synthPresets";
import { getMeter } from "@/utils/meter";
import { foldPatternBoundaries, loopLengthDivisors } from "@/utils/patternTimeline";
import { loopBars } from "@/utils/songStructure";
import { JOIN_LANE, FIELD_LABEL } from "@/components/ui/fieldClasses";
import { SYNTH_TARGET_STYLES } from "@/utils/synthControl";
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
import { BASS_TOOLS, bassStepLabel, bassToolValue, type BassPatternTool } from "./bassStepChoice";
import { loadSynthPreset } from '@/store/synthPresetInstall';

export interface BassModulePanelProps {
  onPatternPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onPatternPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
  /** Owned by ChordView, not this panel; passed through only to gate the timeline's playhead. */
  isPlaying: boolean;
}

/** The bass line's register, narrower at the top than the chord card's. */
const BASS_OCTAVES = [1, 2, 3, 4];

/**
 * The note palette: which interval the NEXT click on a cell writes.
 *
 * A toolbar of single-select buttons rather than the click cycle it replaced —
 * a cell no longer means "the next value in a list", it means the one the user
 * armed. The visible face is the same letter an active span heads with
 * (`bassStepLabel`), and the full name goes on `aria-label`/`title`, so the
 * letter is never the only thing saying what a button does.
 */
function BassNotePalette({
  tool,
  onPick,
}: {
  tool: BassPatternTool;
  onPick: (tool: BassPatternTool) => void;
}) {
  return (
    <div className="mt-3">
      <span className={FIELD_LABEL} id="label-custom-bass-note">Note</span>
      <div className={JOIN_LANE} role="group" aria-labelledby="label-custom-bass-note">
        {BASS_TOOLS.map((choice) => (
          <button
            key={choice.tool}
            id={`btn-bass-note-${choice.tool}`}
            type="button"
            aria-pressed={tool === choice.tool}
            aria-label={choice.name}
            title={choice.name}
            onClick={() => onPick(choice.tool)}
            className={`btn btn-xs join-item text-[11px] font-semibold ${
              tool === choice.tool
                ? SYNTH_TARGET_STYLES.bass.activeBtn
                : "btn-ghost text-base-content/60"
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The bass lane: the `custom` branch of the pattern field, below the field row
 * rather than inside the "Bass Pattern" cell, where its buttons shared the
 * width of one dropdown.
 *
 * A bass event has a LENGTH like a chord event does, so this is the span
 * timeline and not the drum sequencer's `StepRow` — the two lanes are twins one
 * level apart, over a token array instead of a boolean one.
 *
 * The armed tool is LOCAL state: it is a transient editor gesture, not a
 * property of the pattern, so it is not persisted and two bass lanes could
 * never disagree about it.
 */
function BassStepEditor({ isPlaying }: { isPlaying: boolean }) {
  const meterId = useAppStore((s) => s.meterId);
  const chords = useAppStore((s) => s.chords);
  const customBassPattern = useAppStore((s) => s.customBassPattern);
  const customBassHoldSteps = useAppStore((s) => s.customBassHoldSteps);
  const customBassLoopLength = useAppStore((s) => s.customBassLoopLength);
  const setCustomBassEvent = useAppStore((s) => s.setCustomBassEvent);
  const setCustomBassEventLength = useAppStore((s) => s.setCustomBassEventLength);
  const [tool, setTool] = useState<BassPatternTool>('root');

  const { stepsPerBar, accentGroups } = getMeter(meterId);
  const cycleSteps = customBassLoopLength * stepsPerBar;
  // The boundary map the store clamps a hold against (`customBassSpans`),
  // derived here from the same two inputs it uses — one lane over, so the two
  // timelines can never disagree about where a chord change falls.
  const boundaries = useMemo(
    () => foldPatternBoundaries(
      chords.map((chord) => chord.bars * stepsPerBar),
      cycleSteps,
    ),
    [chords, stepsPerBar, cycleSteps],
  );

  // Writing an onset at a column that already holds one REPLACES its interval;
  // the store keeps the result one legal span, and the resize handle is the
  // only thing in this lane that changes a length.
  const activate = (column: number) => {
    setCustomBassEvent(column, bassToolValue(tool));
  };

  return (
    <>
      <BassNotePalette tool={tool} onPick={setTool} />
      <CustomPatternTimeline
        className="mt-2"
        values={customBassPattern}
        holds={customBassHoldSteps}
        loopLength={customBassLoopLength}
        stepsPerBar={stepsPerBar}
        accentGroups={accentGroups}
        boundaries={boundaries}
        empty="rest"
        label="Bass"
        color="bg-module-bass text-module-bass-content"
        valueLabel={bassStepLabel}
        isPlaying={isPlaying}
        onActivate={activate}
        onErase={(column) => setCustomBassEvent(column, bassToolValue('erase'))}
        onResize={setCustomBassEventLength}
      />
    </>
  );
}

/**
 * The card's control row: sound, register, pattern and its length, feel.
 *
 * Reads its own slice rather than taking eight props — the same rule the three
 * module cards follow. The two preview handlers come in from the card, already
 * stable useCallbacks in ChordView.
 */
function BassPatternFields({
  onPatternPreviewDown,
  onPatternPreviewUp,
}: Pick<BassModulePanelProps, 'onPatternPreviewDown' | 'onPatternPreviewUp'>) {
  const meterId = useAppStore((s) => s.meterId);
  const chords = useAppStore((s) => s.chords);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const customPresets = useAppStore((s) => s.customSynthPresets);
  const bassOctave = useAppStore((s) => s.bassOctave);
  const setBassOctave = useAppStore((s) => s.setBassOctave);
  const bassPatternId = useAppStore((s) => s.bassPatternId);
  const setBassPatternId = useAppStore((s) => s.setBassPatternId);
  const bassPatternMode = useAppStore((s) => s.bassPatternMode);
  const setBassPatternMode = useAppStore((s) => s.setBassPatternMode);
  const bassFeel = useAppStore((s) => s.bassFeel);
  const setBassFeel = useAppStore((s) => s.setBassFeel);
  const customBassLoopLength = useAppStore((s) => s.customBassLoopLength);
  const setCustomBassLoopLength = useAppStore((s) => s.setCustomBassLoopLength);

  const allPresets = useMemo(
    () => getAllSynthPresets(customPresets),
    [customPresets],
  );
  const presetGroups = useMemo(
    () => groupPresets(allPresets),
    [allPresets],
  );
  // The bass lane's own divisors — the progression's, not the chord lane's
  // cycle, which is why the two cards can show different lengths of the same
  // four bars.
  const barOptions = useMemo(() => loopLengthDivisors(loopBars(chords)), [chords]);

  // `Custom…` swaps the dropdown's job for the span timeline below the row: the
  // mode is what the lane is gated on, and the id is what the dropdown shows.
  const selectBassPattern = (value: string) => {
    if (value === 'custom') {
      setBassPatternMode('custom');
      return;
    }
    setBassPatternMode('preset');
    setBassPatternId(value);
  };

  // The bus stop, the Arp read and the patch write all live in
  // `store/synthPresetInstall.ts` — see there for why a load stops the bus and
  // adopting a just-saved preset does not.
  const pickPreset = (preset: SynthPreset) => {
    loadSynthPreset('bass', preset);
  };

  return (
    <div className="flex flex-row flex-wrap items-end gap-3">
          <SoundPresetField
            id="select-bass-sound-preset"
            title="Bass sound preset — any factory, bass, or saved preset, synced with the synth page"
            placeholder="Bass Preset…"
            groups={presetGroups}
            allPresets={allPresets}
            selectedPresetId={bassSynthParams.sourcePresetId}
            onPick={pickPreset}
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

          {/* Beside the pattern it lengthens, and only while that pattern is
              this lane's own: the lane's cycle is independent of the chord
              card's, so the two may show different lengths of the same bars. */}
          {bassPatternMode === 'custom' && (
            <PatternBarsField
              id="select-bass-pattern-bars"
              value={customBassLoopLength}
              options={barOptions}
              onChange={setCustomBassLoopLength}
            />
          )}

          <FeelSlider
            id="slider-bass-feel"
            value={bassFeel}
            onChange={setBassFeel}
            tint="text-module-bass [--range-thumb:var(--color-module-bass-content)]"
            title="Bass note length: tight (short holds) ↔ loose (long holds)"
          />
        </div>
  );
}

// No `mt-4`, and `role="group"` names this card for a screen reader — see the
// note in ChordModulePanel for both.
export function BassModulePanel({
  onPatternPreviewDown,
  onPatternPreviewUp,
  isPlaying,
}: BassModulePanelProps) {
  const bassPatternMode = useAppStore((s) => s.bassPatternMode);

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
      <BassPatternFields
        onPatternPreviewDown={onPatternPreviewDown}
        onPatternPreviewUp={onPatternPreviewUp}
      />

      {bassPatternMode === 'custom' && <BassStepEditor isPlaying={isPlaying} />}
    </ModulePanelCard>
  );
}

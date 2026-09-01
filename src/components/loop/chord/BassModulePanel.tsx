import React, { useMemo } from "react";
import { Volume2 } from "lucide-react";
import { useAppStore } from "../../../store/store";
import {
  BASS_STYLE_GROUPS,
  type BassStepChoice,
} from "../../../audio/bassPatterns";
import {
  getAllSynthPresets,
  findPresetByName,
  getPresetsGroupedByCategory,
} from "../../../audio/synthPresets";
import { patternMeterTitle, patternOptionLabel } from "../../meterSelect";
import { getMeter } from "../../../utils/meter";
import { stepCells } from "../../sequencerGrid";
import { ChannelStrip } from "../../ui/ChannelStrip";
import { FIELD_LABEL, FIELD_SELECT, SECTION_HEADER } from "../../ui/fieldClasses";
import { Slider } from "../../ui/Slider";
import { PlayingStepRow, STEP_ROW_CLASS } from "../../ui/StepRow";
import { PlayingStepHeader } from "../../ui/StepHeader";
import { AdjustSynthButton } from "./AdjustSynthButton";
import { bassStepLabel, nextBassStepChoice } from "./bassStepChoice";

export interface BassModulePanelProps {
  onPatternPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onPatternPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
  /** Owned by ChordView, not this panel; passed through only to gate the PlayingStepRow ring. */
  isPlaying: boolean;
}

export const BassModulePanel: React.FC<BassModulePanelProps> = ({
  onPatternPreviewDown,
  onPatternPreviewUp,
  isPlaying,
}) => {
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
  const customBassPattern = useAppStore((s) => s.customBassPattern);
  const setCustomBassPattern = useAppStore((s) => s.setCustomBassPattern);
  const bassFeel = useAppStore((s) => s.bassFeel);
  const setBassFeel = useAppStore((s) => s.setBassFeel);
  const bassVolume = useAppStore((s) => s.bassVolume);
  const setBassVolume = useAppStore((s) => s.setBassVolume);

  const chordCells = useMemo(() => stepCells(getMeter(meterId)), [meterId]);

  return (
      <div className="mt-4 card bg-panel tint-bass border border-module-bass/30 p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className={SECTION_HEADER}>
              Bass Module
            </h3>
            <p className="text-[10px] text-base-content/60">
              Bass line follows the same chord progression loop; pattern steps
              are 16th notes.
            </p>
          </div>
          <AdjustSynthButton target="bass" className="text-module-bass" />
        </div>
        <div className="flex flex-row flex-wrap items-end gap-3">
          <div>
            <label className={FIELD_LABEL}>Bass Preset</label>
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
              className={FIELD_SELECT}
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
            <label className={FIELD_LABEL}>Bass Octave</label>
            <select
              id="select-bass-octave"
              value={bassOctave}
              onChange={(e) => setBassOctave(parseInt(e.target.value, 10))}
              className={FIELD_SELECT}
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
            <label className={FIELD_LABEL}>Bass Pattern</label>
            <div className="flex items-center gap-1.5">
              <select
                id="select-bass-rhythm-pattern"
                value={bassPatternMode === 'custom' ? 'custom' : bassPatternId}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setBassPatternMode('custom');
                  } else {
                    setBassPatternMode('preset');
                    setBassPatternId(e.target.value);
                  }
                }}
                className={FIELD_SELECT}
                title="Bass pattern (16th-note grid, deterministic)"
              >
                <option value="custom">Custom…</option>
                {BASS_STYLE_GROUPS.map((group) => (
                  <optgroup key={group.style} label={group.style}>
                    {group.patterns.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        title={patternMeterTitle(p.name, p.meter, meterId)}
                      >
                        {patternOptionLabel(p.name, p.meter, meterId)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                id="btn-preview-bass-pattern"
                type="button"
                onMouseDown={onPatternPreviewDown}
                onMouseUp={onPatternPreviewUp}
                onMouseLeave={onPatternPreviewUp}
                onTouchStart={onPatternPreviewDown}
                onTouchEnd={onPatternPreviewUp}
                className="btn btn-xs btn-ghost btn-square text-module-bass select-none"
                title="Hold to Preview Bass Pattern Loop"
              >
                <Volume2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Bass Feel Slider (tight ↔ loose) */}
          <div>
            <label className={FIELD_LABEL}>Bass Feel</label>
            <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-box px-2.5 py-1 text-xs h-8">
              <span className="text-[9px] text-base-content/60 shrink-0">
                tight
              </span>
              <Slider
                id="slider-bass-feel"
                min={0}
                max={1}
                step={0.01}
                value={bassFeel}
                onChange={setBassFeel}
                className="range range-xs w-20 text-module-bass [--range-thumb:var(--color-module-bass-content)]"
                title="Bass note length: tight (short holds) ↔ loose (long holds)"
              />
              <span className="text-[9px] text-base-content/60 shrink-0">
                loose
              </span>
            </div>
          </div>

          <ChannelStrip
            idPrefix="bass"
            label="Bass Level"
            volume={bassVolume}
            max={1.5}
            accentClass="text-module-bass"
            onVolumeChange={setBassVolume}
            showReadout={false}
            sliderClassName="range range-xs text-module-bass [--range-thumb:var(--color-module-bass-content)]"
          />
        </div>

        {/* Full-width step editor — see ChordModulePanel for why this left the
            "Bass Pattern" field cell. The tone letters bassStepLabel draws are
            only legible once a block is wider than the letter itself. */}
        {bassPatternMode === 'custom' && (
          <div className="overflow-x-auto mt-3">
            <label className={FIELD_LABEL}>Custom Bass Pattern</label>
            <div className="min-w-[520px]">
              <PlayingStepHeader
                player="chords"
                cells={chordCells}
                isPlaying={isPlaying}
                className={`${STEP_ROW_CLASS} mb-1.5`}
              />
              <PlayingStepRow<BassStepChoice>
                player="chords"
                cells={chordCells}
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
            </div>
          </div>
        )}
      </div>
  );
};

import React, { useMemo } from "react";
import { Volume2 } from "lucide-react";
import { useAppStore } from "@/store/store";
import { CHORD_RHYTHM_STYLE_GROUPS } from '@/audio/chordRhythms';
import {
  getAllSynthPresets,
  findPresetByName,
  getPresetsGroupedByCategory,
} from "@/audio/presetRegistry";
import { patternMeterTitle, patternOptionLabel } from "@/components/meterSelect";
import { getMeter } from "@/utils/meter";
import { stepCells } from "@/components/sequencerGrid";
import { ChannelStrip } from "@/components/ui/ChannelStrip";
import { FIELD_LABEL, FIELD_SELECT, SECTION_HEADER } from "@/components/ui/fieldClasses";
import { SYNTH_TARGET_STYLES } from "@/utils/synthControl";
import { Slider } from "@/components/ui/Slider";
import { PlayingStepRow, STEP_ROW_CLASS } from "@/components/ui/StepRow";
import { PlayingStepHeader } from "@/components/ui/StepHeader";
import { IconButton } from "@/components/ui/IconButton";
import { AdjustSynthButton } from "./AdjustSynthButton";
import { PresetSelect } from "./PresetSelect";

export interface ChordModulePanelProps {
  onPatternPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onPatternPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
  /** Owned by ChordView, not this panel; passed through only to gate the PlayingStepRow ring. */
  isPlaying: boolean;
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
export const ChordModulePanel: React.FC<ChordModulePanelProps> = ({
  onPatternPreviewDown,
  onPatternPreviewUp,
  isPlaying,
}) => {
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
  const customChordRhythm = useAppStore((s) => s.customChordRhythm);
  const setCustomChordRhythm = useAppStore((s) => s.setCustomChordRhythm);
  const chordVolume = useAppStore((s) => s.chordVolume);
  const setChordVolume = useAppStore((s) => s.setChordVolume);
  const customPresets = useAppStore((s) => s.customSynthPresets);

  const chordCells = useMemo(() => stepCells(getMeter(meterId)), [meterId]);
  const allPresets = useMemo(
    () => getAllSynthPresets(customPresets),
    [customPresets],
  );
  const presetGroups = useMemo(
    () => getPresetsGroupedByCategory(allPresets),
    [allPresets],
  );

  return (
      <div className="mt-4 card bg-panel tint-chord border border-module-chord/30 p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className={SECTION_HEADER}>
              Chord Module
            </h3>
            <p className="text-[10px] text-base-content/60">
              How the chord layer voices the progression above: its sound,
              register and comping rhythm.
            </p>
          </div>
          <AdjustSynthButton target="chord" className="text-module-chord" />
        </div>
        <div className="flex flex-row flex-wrap items-end gap-3">
          {/* Chord Sound Preset Select */}
          <PresetSelect
            id="select-chord-sound-preset"
            label="Chord Preset"
            title="Chord sound preset — factory and saved presets, synced with the synth page"
            placeholder="Chord Preset…"
            groups={presetGroups}
            value={chordSynthParams.preset ?? ""}
            onSelect={(name) => {
              const preset = findPresetByName(name, allPresets);
              if (!preset) return;
              setChordSynthParams({
                ...chordSynthParams,
                ...preset.params,
                preset: preset.name,
              });
            }}
          />

          {/* Chord Octave Select */}
          <div>
            <label className={FIELD_LABEL} htmlFor="select-chord-octave">Chord Octave</label>
            <select
              id="select-chord-octave"
              value={chordOctave}
              onChange={(e) => setChordOctave(parseInt(e.target.value, 10))}
              className={FIELD_SELECT}
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
            <label className={FIELD_LABEL} htmlFor="select-chord-rhythm-pattern">Chord Pattern</label>
            <div className="flex items-center gap-1.5">
              <select
                id="select-chord-rhythm-pattern"
                value={chordRhythmMode === 'custom' ? 'custom' : rhythmId}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setChordRhythmMode('custom');
                  } else {
                    setChordRhythmMode('preset');
                    setChordRhythmId(e.target.value);
                  }
                }}
                className={FIELD_SELECT}
                title="Rhythm pattern for chord playback"
              >
                <option value="custom">Custom…</option>
                {CHORD_RHYTHM_STYLE_GROUPS.map((group) => (
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
              <IconButton
                id="btn-preview-chord-pattern"
                label="Hold to Preview Chord Pattern Loop"
                icon={<Volume2 className="w-3 h-3" />}
                size="xs"
                className="text-module-chord select-none"
                onMouseDown={onPatternPreviewDown}
                onMouseUp={onPatternPreviewUp}
                onMouseLeave={onPatternPreviewUp}
                onTouchStart={onPatternPreviewDown}
                onTouchEnd={onPatternPreviewUp}
              />
            </div>
          </div>

          {/* Chord Feel Slider (tight ↔ loose) */}
          <div>
            <label className={FIELD_LABEL} htmlFor="slider-chord-feel">Chord Feel</label>
            <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-box px-2.5 py-1 text-xs h-8">
              <span className="text-[9px] text-base-content/60 shrink-0">
                tight
              </span>
              <Slider
                id="slider-chord-feel"
                min={0}
                max={1}
                step={0.01}
                value={chordFeel}
                onChange={setChordFeel}
                className="range range-xs w-20 text-module-chord [--range-thumb:var(--color-module-chord-content)]"
                title="Chord note length: tight (short holds) ↔ loose (long holds)"
              />
              <span className="text-[9px] text-base-content/60 shrink-0">
                loose
              </span>
            </div>
          </div>

          {/* Chord Layer Volume Slider */}
          <ChannelStrip
            idPrefix="chord"
            label="Chord Level"
            volume={chordVolume}
            max={1.5}
            accentClass={SYNTH_TARGET_STYLES.chord.accent}
            sliderClassName={SYNTH_TARGET_STYLES.chord.slider}
            onVolumeChange={setChordVolume}
          />
        </div>

        {/* Full-width step editor. It sits BELOW the field row rather than
            inside the "Chord Pattern" field cell, where its 16 buttons shared
            the width of one dropdown and rendered ~7px wide. Same StepRow the
            drum sequencer uses; only the container changed. */}
        {chordRhythmMode === 'custom' && (
          <div className="overflow-x-auto">
            <span className={FIELD_LABEL} id="label-custom-chord-pattern">Custom Chord Pattern</span>
            {/* min-w keeps a narrow window scrolling rather than squeezing the
                blocks back down. Above `sm` it matches the drum grid's step
                area (its 700px less the 176px track-label gutter). A phone
                takes a smaller floor instead of that grid's: this one has no
                label gutter to scroll out of view, so less width per step buys
                less scrolling at no cost in orientation. */}
            <div className="min-w-[420px] sm:min-w-[520px]" role="group" aria-labelledby="label-custom-chord-pattern">
              <PlayingStepHeader
                player="chords"
                cells={chordCells}
                isPlaying={isPlaying}
                className={`${STEP_ROW_CLASS} mb-1.5`}
              />
              <PlayingStepRow<boolean>
                player="chords"
                cells={chordCells}
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
            </div>
          </div>
        )}
      </div>
  );
};

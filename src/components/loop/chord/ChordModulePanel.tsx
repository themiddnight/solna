import React, { useMemo } from "react";
import { Sparkles, Volume2 } from "lucide-react";
import { useAppStore } from "../../../store/store";
import { RHYTHM_STYLE_GROUPS } from "../../../audio/rhythmPatterns";
import {
  getAllSynthPresets,
  findPresetByName,
  getPresetsGroupedByCategory,
} from "../../../audio/synthPresets";
import { patternMeterTitle, patternOptionLabel } from "../../meterSelect";
import { getMeter } from "../../../utils/meter";
import { stepCells } from "../../sequencerGrid";
import { ChannelStrip } from "../../ui/ChannelStrip";
import { FIELD_LABEL, FIELD_SELECT } from "../../ui/fieldClasses";
import { Slider } from "../../ui/Slider";
import { PlayingStepRow, STEP_ROW_CLASS } from "../../ui/StepRow";
import { PlayingStepHeader } from "../../ui/StepHeader";

export interface ChordModulePanelProps {
  onPatternPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onPatternPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
  autoReharmonize: boolean;
  onToggleAutoReharmonize: () => void;
  onReharmonize: () => void;
  /** Owned by ChordView, not this panel; passed through only to gate the PlayingStepRow ring. */
  isPlaying: boolean;
}

/**
 * The Chord Module's control row. Moved verbatim from ChordView.tsx.
 *
 * Reads its own slice of the store; the four things it cannot derive — the two
 * pattern-preview handlers (which own ChordView's preview refs and the resolved
 * rhythm pattern), the auto-reharmonize toggle state and the Re-harmonize
 * action (which own ChordView's local toast and indicator state) — come in as
 * props. Those handlers are already stable useCallbacks / render-scope
 * functions in ChordView, exactly as before.
 */
export const ChordModulePanel: React.FC<ChordModulePanelProps> = ({
  onPatternPreviewDown,
  onPatternPreviewUp,
  autoReharmonize,
  onToggleAutoReharmonize,
  onReharmonize,
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

  return (
      <>
        <div className="flex flex-row flex-wrap items-end gap-3">
          {/* Chord Sound Preset Select */}
          <div>
            <label className={FIELD_LABEL}>Chord Preset</label>
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
              className={FIELD_SELECT}
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
            <label className={FIELD_LABEL}>Chord Octave</label>
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
            <label className={FIELD_LABEL}>Chord Pattern</label>
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
                {RHYTHM_STYLE_GROUPS.map((group) => (
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
                id="btn-preview-chord-pattern"
                type="button"
                onMouseDown={onPatternPreviewDown}
                onMouseUp={onPatternPreviewUp}
                onMouseLeave={onPatternPreviewUp}
                onTouchStart={onPatternPreviewDown}
                onTouchEnd={onPatternPreviewUp}
                className="btn btn-xs btn-ghost btn-square text-module-chord select-none"
                title="Hold to Preview Chord Pattern Loop"
              >
                <Volume2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Chord Feel Slider (tight ↔ loose) */}
          <div>
            <label className={FIELD_LABEL}>Chord Feel</label>
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
            accentClass="text-module-chord"
            sliderClassName="range range-xs text-module-chord [--range-thumb:var(--color-module-chord-content)]"
            onVolumeChange={setChordVolume}
          />
          {/* Option B Re-harmonize Button */}
          <button
            id="btn-reharmonize-chord-progression"
            onClick={onReharmonize}
            className="btn btn-sm btn-secondary btn-outline gap-1.5"
            title="Option B: Diatonically snap current chord progression to active key and scale"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Re-harmonize</span>
          </button>

          {/* Auto-Reharmonize Toggle */}
          <button
            id="btn-toggle-auto-reharmonize"
            onClick={onToggleAutoReharmonize}
            className={`btn btn-sm gap-1.5 text-xs font-semibold btn-secondary ${
              autoReharmonize ? "" : "btn-soft"
            }`}
            title="Toggle automatic re-harmonization when loading presets or changing scales"
          >
            <Sparkles
              className={`w-3.5 h-3.5 ${autoReharmonize ? "text-base" : "text-secondary"}`}
            />
            <span>Auto-Reharmonize: {autoReharmonize ? "ON" : "OFF"}</span>
          </button>
        </div>

        {/* Full-width step editor. It sits BELOW the field row rather than
            inside the "Chord Pattern" field cell, where its 16 buttons shared
            the width of one dropdown and rendered ~7px wide. Same StepRow the
            drum sequencer uses; only the container changed. */}
        {chordRhythmMode === 'custom' && (
          <div className="overflow-x-auto">
            <label className={FIELD_LABEL}>Custom Chord Pattern</label>
            {/* min-w keeps a narrow window scrolling rather than squeezing the
                blocks back down. Above `sm` it matches the drum grid's step
                area (its 700px less the 176px track-label gutter). A phone
                takes a smaller floor instead of that grid's: this one has no
                label gutter to scroll out of view, so less width per step buys
                less scrolling at no cost in orientation. */}
            <div className="min-w-[420px] sm:min-w-[520px]">
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
      </>
  );
};

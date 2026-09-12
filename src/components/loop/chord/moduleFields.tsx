import React from "react";
import { Volume2 } from "lucide-react";
import type { SynthPresetItem } from "@/data/synthPresets";
import { findPresetByName } from "@/audio/presetRegistry";
import type { CategoryPresetGroup } from "@/audio/presetRegistry";
import type { MeterId } from "@/utils/meter";
import { patternMeterTitle, patternOptionLabel } from "@/components/meterSelect";
import type { StepCell } from "@/components/sequencerGrid";
import { cx } from "@/components/ui/cx";
import { FIELD_LABEL, FIELD_SELECT } from "@/components/ui/fieldClasses";
import { Slider } from "@/components/ui/Slider";
import { STEP_ROW_CLASS } from "@/components/ui/StepRow";
import { PlayingStepHeader } from "@/components/ui/StepHeader";
import { IconButton } from "@/components/ui/IconButton";
import { PresetSelect } from "./PresetSelect";

/**
 * The three fields every accompaniment module card's control row is built from,
 * extracted the way `PresetSelect` was — each was spelled out once per card,
 * and the copies were already drifting.
 *
 * What is deliberately NOT here: the card shell (`ModulePanelCard`), the sound
 * preset dropdown (`PresetSelect`) and each layer's own controls (the pad's
 * mode toggles, the bass's step cycle). Only the fields whose markup AND
 * meaning are identical across cards live in this file.
 */

/** One entry of a `groupByStyle` pattern catalogue (`bassPatterns`, `chordRhythms`). */
export interface PatternChoice {
  id: string;
  name: string;
  meter?: MeterId;
}

/** One `style` group of a pattern catalogue, as `groupByStyle` returns it. */
export interface PatternChoiceGroup {
  style: string;
  patterns: PatternChoice[];
}

export interface SoundPresetFieldProps {
  /** DOM id of the `<select>`; the label's `htmlFor` follows it. */
  id: string;
  title: string;
  /** The blank first option's text — "Chord Preset…", "Pad Preset…". */
  placeholder: string;
  groups: CategoryPresetGroup[];
  /** The full library the chosen name is resolved against. */
  allPresets: SynthPresetItem[];
  /** The layer's currently selected preset NAME, or `''` for none. */
  value: string;
  /**
   * Receives the resolved preset. The caller merges it over its own params —
   * `applyPreset` (`audio/presetRegistry`) is that merge, and every card uses
   * it so the three cannot disagree about what picking a preset overwrites.
   */
  onPick: (preset: SynthPresetItem) => void;
}

/**
 * The sound-preset field, wrapping `PresetSelect` in the one thing every card
 * did on top of it: resolve the picked NAME back to a preset and merge it.
 *
 * The name -> preset resolution is the part worth centralising. It reads as
 * three lines and is a silent failure when it goes wrong — `PresetSelect`
 * hands back a name, the library is keyed by name, and a card that skipped the
 * lookup would store a preset name with no params behind it.
 */
export function SoundPresetField({
  id,
  title,
  placeholder,
  groups,
  allPresets,
  value,
  onPick,
}: SoundPresetFieldProps) {
  return (
    <PresetSelect
      id={id}
      label="Preset"
      title={title}
      placeholder={placeholder}
      groups={groups}
      value={value}
      onSelect={(name) => {
        const preset = findPresetByName(name, allPresets);
        if (!preset) return;
        onPick(preset);
      }}
    />
  );
}

export interface OctaveSelectProps {
  /** DOM id of the `<select>`; the label's `htmlFor` follows it. */
  id: string;
  label: string;
  title: string;
  value: number;
  onChange: (octave: number) => void;
  /**
   * The registers this card offers. Each layer picks its own span — the bass
   * bottoms out at 1, the chord tops out at 6, the pad reaches both — because
   * one control serves registers the others have no use for.
   */
  octaves: readonly number[];
}

/** The register field each module card carries, above its pattern field. */
export function OctaveSelect({ id, label, title, value, onChange, octaves }: OctaveSelectProps) {
  return (
    <div>
      <label className={FIELD_LABEL} htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className={FIELD_SELECT}
        title={title}
      >
        {octaves.map((o) => (
          <option key={o} value={o}>
            Oct {o}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface PatternSelectProps {
  /** DOM id of the `<select>`; the label's `htmlFor` follows it. */
  id: string;
  label: string;
  selectTitle: string;
  /** DOM id of the hold-to-preview button beside the select. */
  previewId: string;
  previewLabel: string;
  /** Module identity tint for the preview glyph, e.g. `text-module-bass`. */
  previewTint: string;
  /** The pattern id, or the literal `'custom'` when the grid is hand-edited. */
  value: string;
  groups: readonly PatternChoiceGroup[];
  onChange: (value: string) => void;
  onPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
  /** The active meter, so an option can name one it does not fit. */
  meterId: MeterId;
}

/**
 * The comping-pattern dropdown and its hold-to-preview button. The two are one
 * field, not two: the button previews exactly what the select has chosen, and
 * `Custom…` is the option that swaps the dropdown's job for the step grid.
 */
export function PatternSelect({
  id,
  label,
  selectTitle,
  previewId,
  previewLabel,
  previewTint,
  value,
  groups,
  onChange,
  onPreviewDown,
  onPreviewUp,
  meterId,
}: PatternSelectProps) {
  return (
    <div>
      <label className={FIELD_LABEL} htmlFor={id}>{label}</label>
      <div className="flex items-center gap-1.5">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={FIELD_SELECT}
          title={selectTitle}
        >
          <option value="custom">Custom…</option>
          {groups.map((group) => (
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
          id={previewId}
          label={previewLabel}
          icon={<Volume2 className="w-3 h-3" />}
          size="xs"
          className={`${previewTint} select-none`}
          onMouseDown={onPreviewDown}
          onMouseUp={onPreviewUp}
          onMouseLeave={onPreviewUp}
          onTouchStart={onPreviewDown}
          onTouchEnd={onPreviewUp}
        />
      </div>
    </div>
  );
}

export interface FeelSliderProps {
  /** DOM id of the `<input type="range">`; the label's `htmlFor` follows it. */
  id: string;
  value: number;
  onChange: (value: number) => void;
  /** Module identity tint plus the matching `--range-thumb` override. */
  tint: string;
  title: string;
}

/**
 * The note-length field: how long the layer holds each step, from staccato
 * (`tight`) to legato (`loose`). The two captions are what make a bare 0..1
 * number readable as a length rather than as a level.
 */
export function FeelSlider({ id, value, onChange, tint, title }: FeelSliderProps) {
  return (
    <div>
      <label className={FIELD_LABEL} htmlFor={id}>Feel</label>
      <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-box px-2.5 py-1 text-xs h-8">
        <span className="text-[9px] text-base-content/60 shrink-0">tight</span>
        <Slider
          id={id}
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={onChange}
          className={`range range-xs w-20 ${tint}`}
          title={title}
        />
        <span className="text-[9px] text-base-content/60 shrink-0">loose</span>
      </div>
    </div>
  );
}

export interface CustomPatternStepsProps {
  /** DOM id of the caption that also labels the group. */
  labelId: string;
  label: string;
  cells: StepCell[];
  isPlaying: boolean;
  /**
   * Extra classes on the scrolling shell. Only the bass card passes any
   * (`mt-3`): its editor is a sibling of the field row, while the chord card's
   * already sits in a spaced stack.
   */
  className?: string;
  /**
   * The `PlayingStepRow` itself. It is the one part that differs: the bass
   * steps through a tone cycle, the chord grid toggles a boolean.
   */
  children: React.ReactNode;
}

/**
 * The full-width step editor a card shows once its pattern mode is `custom`.
 *
 * It sits BELOW the field row rather than inside the pattern field cell, where
 * its 16 buttons shared the width of one dropdown and rendered ~7px wide — the
 * bass card's version stayed behind in the field cell long after the chord
 * card's moved out, which is why the two are one component now.
 *
 * `min-w` keeps a narrow window scrolling rather than squeezing the blocks back
 * down, and the floor is the drum grid's step area less its label gutter. A
 * phone takes a smaller one: this grid has no gutter to scroll out of view, so
 * less width per step buys less scrolling at no cost in orientation.
 */
export function CustomPatternSteps({
  labelId,
  label,
  cells,
  isPlaying,
  className,
  children,
}: CustomPatternStepsProps) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <span className={FIELD_LABEL} id={labelId}>{label}</span>
      <div className="min-w-[420px] sm:min-w-[520px]" role="group" aria-labelledby={labelId}>
        <PlayingStepHeader
          player="chords"
          cells={cells}
          isPlaying={isPlaying}
          className={`${STEP_ROW_CLASS} mb-1.5`}
        />
        {children}
      </div>
    </div>
  );
}

import React from "react";
import { Volume2 } from "lucide-react";
import type { SynthPreset } from "@/data/synthPresets";
import { findPresetByName } from "@/utils/synthPresets";
import type { CategoryPresetGroup } from "@/utils/synthPresets";
import type { MeterId } from "@/utils/timeSignature";
import { patternMeterTitle, patternOptionLabel } from "@/components/meterSelect";
import { FIELD_LABEL, FIELD_SELECT } from "@/components/ui/fieldClasses";
import { Slider } from "@/components/ui/Slider";
import { IconButton } from "@/components/ui/IconButton";
import { PresetSelect } from "./PresetSelect";

/**
 * The fields every accompaniment module card's control row is built from,
 * extracted the way `PresetSelect` was — each was spelled out once per card,
 * and the copies were already drifting.
 *
 * What is deliberately NOT here: the card shell (`ModulePanelCard`), the sound
 * preset dropdown (`PresetSelect`) and each layer's own controls (the pad's
 * mode toggles, the bass's note palette). Only the fields whose markup AND
 * meaning are identical across cards live in this file.
 */

/** One entry of a `groupByStyle` pattern catalogue (`bassPatterns`, `chordRhythms`). */
interface PatternChoice {
  id: string;
  name: string;
  meter?: MeterId;
}

/** One `style` group of a pattern catalogue, as `groupByStyle` returns it. */
interface PatternChoiceGroup {
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
  allPresets: SynthPreset[];
  /**
   * The layer's currently selected preset ID — `ActiveSynth.sourcePresetId` —
   * or `null` when the patch has been edited away from any library entry.
   *
   * An ID rather than the displayed name, because that is what the store
   * holds: taking a name here would make every card resolve the same id back
   * to a name, three times, with three chances to disagree.
   */
  selectedPresetId: string | null;
  /**
   * Receives the resolved preset. The caller installs it with
   * `applySynthPreset` (`utils/synthPresets`), which replaces the whole patch
   * and keeps the track's Arp — every card uses it, so the three cannot
   * disagree about what picking a preset overwrites.
   */
  onPick: (preset: SynthPreset) => void;
}

/**
 * The sound-preset field, wrapping `PresetSelect` in the one thing every card
 * did on top of it: resolve the picked NAME back to a preset and merge it.
 *
 * The id <-> name translation is the part worth centralising. `PresetSelect`
 * speaks NAMES in both directions while the store holds an ID, so this is
 * where the two meet: a card that did its own lookup would be one silent
 * mismatch away from showing a preset it is not playing.
 */
export function SoundPresetField({
  id,
  title,
  placeholder,
  groups,
  allPresets,
  selectedPresetId,
  onPick,
}: SoundPresetFieldProps) {
  const selectedName = selectedPresetId
    ? allPresets.find((p) => p.id === selectedPresetId)?.name ?? ""
    : "";
  return (
    <PresetSelect
      id={id}
      label="Preset"
      title={title}
      placeholder={placeholder}
      groups={groups}
      value={selectedName}
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

export interface PatternBarsFieldProps {
  /** DOM id of the `<select>`; the label's `htmlFor` follows it. */
  id: string;
  /** The lane's cycle in bars — always a divisor of the progression. */
  value: number;
  /** The divisors of the progression in bars, ascending (1, 2, 4 for four). */
  options: readonly number[];
  onChange: (bars: number) => void;
}

/**
 * How many bars the lane's pattern runs before it repeats.
 *
 * The cap the bass card's comment used to describe — a length the progression
 * cannot divide leaves a gap at the end of every repetition — is why `options`
 * is `loopLengthDivisors(loopBars(chords))` and not `1..totalBars`: a length
 * that divides the progression is the only one that lines up when the pattern
 * repeats under it. The STORE is still the authority — it clamps whatever it is
 * asked for onto the same divisor set — so this field only ever offers choices
 * that will survive the write.
 */
export function PatternBarsField({ id, value, options, onChange }: PatternBarsFieldProps) {
  return (
    <div>
      <label className={FIELD_LABEL} htmlFor={id}>Bars</label>
      <select id={id} className={FIELD_SELECT} value={value}
        onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((bars) => <option key={bars} value={bars}>{bars}</option>)}
      </select>
    </div>
  );
}


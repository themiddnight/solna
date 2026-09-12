import React from "react";
import { Volume2 } from "lucide-react";
import { Knob } from "@/components/ui/Knob";
import type { KnobColor } from "@/components/ui/Knob";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { PanelCard } from "@/components/ui/PanelCard";
import { useSynthChannel } from "./useSynthChannel";
import type { SynthParams } from "@/types";

/**
 * The eight envelope parameters, narrowed to the numeric keys a knob can write
 * — `keyof SynthParams` would also admit the patch's string and boolean fields
 * and make `params[key]` a union `Knob`'s `value` would reject.
 */
type EnvelopeParamKey =
  | 'attack' | 'decay' | 'sustain' | 'release'
  | 'filterAttack' | 'filterDecay' | 'filterSustain' | 'filterRelease';

const seconds = (v: number) => `${v.toFixed(2)}s`;
const percent = (v: number) => `${(v * 100).toFixed(0)}%`;

/**
 * The four controls of an ADSR row, in order.
 *
 * Amp and filter read out identically at each position — a time in seconds,
 * a time, a percentage, a time — and their ranges match too, so the only thing
 * that differs between the two rows is which params they write and which token
 * tints them. That is what makes the two halves one component rather than two
 * near-copies: the copy that had drifted was the row wrapper, not the knobs.
 */
const ADSR_CONTROLS = [
  { name: 'attack', label: 'ATT', min: 0.005, max: 2.0, format: seconds },
  { name: 'decay', label: 'DEC', min: 0.01, max: 2.0, format: seconds },
  { name: 'sustain', label: 'SUS', min: 0, max: 1.0, format: percent },
  { name: 'release', label: 'REL', min: 0.01, max: 3.0, format: seconds },
] as const;

/** The amp half's four params, in `ADSR_CONTROLS` order. */
const AMP_KEYS: readonly EnvelopeParamKey[] = ['attack', 'decay', 'sustain', 'release'];

/** The filter half's, tinted `module-env-vcf` rather than `module-env-vca`. */
const FILTER_KEYS: readonly EnvelopeParamKey[] = [
  'filterAttack', 'filterDecay', 'filterSustain', 'filterRelease',
];

interface AdsrRowProps {
  /** The caps caption naming the half, e.g. `AMP / VCA`. */
  caption: string;
  /** The `module-env-*` identity token this half's knobs and caption wear. */
  tone: KnobColor;
  /** The four params the knobs write, in `ADSR_CONTROLS` order. */
  keys: readonly EnvelopeParamKey[];
  /**
   * The knob ids' middle fragment: empty for the amp half, `filter-` for the
   * filter half, so ids stay `slider-env-attack` / `slider-env-filter-attack`.
   */
  idPrefix: string;
  /** Wrapper classes. The filter half is spaced off the amp half above it. */
  className?: string;
  /** The knob-row classes. Kept per row: the filter row carries no gap. */
  rowClassName: string;
  params: SynthParams;
  onChangeParams: (next: SynthParams) => void;
}

/** One ADSR half: a caps caption, its hairline rule, and four knobs. */
function AdsrRow({
  caption,
  tone,
  keys,
  idPrefix,
  className,
  rowClassName,
  params,
  onChangeParams,
}: AdsrRowProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[10px] ${tone} uppercase tracking-wider`}>
          {caption}
        </span>
        <span className="flex-1 h-px bg-base-300" />
      </div>
      <div className={rowClassName}>
        {ADSR_CONTROLS.map((control, i) => (
          <Knob
            key={control.label}
            id={`slider-env-${idPrefix}${control.name}`}
            label={control.label}
            color={tone}
            value={params[keys[i]]}
            min={control.min}
            max={control.max}
            step={0.01}
            format={control.format}
            onChange={(v) => onChangeParams({ ...params, [keys[i]]: v })}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Pro-Mode panel — Envelopes (amp and filter ADSR). Reads the active synth
 * channel from the store rather than taking props, so SoundView renders
 * `<EnvelopePanel />` with no wiring. Its two halves carry the
 * `module-env-vca` and `module-env-vcf` identity colours (docs/design.md
 * §6.5); the tokens are named in the class strings that moved with the
 * markup.
 */
export function EnvelopePanel() {
  const { params, onChangeParams } = useSynthChannel();
  // 3. Envelope ADSR
  return (
          <PanelCard inset className="flex-1">
            <div className="card-body p-4 space-y-3">
            <ModuleHeader
              badge={3}
              icon={<Volume2 className="w-3.5 h-3.5 text-module-env-vca" />}
              title="ADSR Envelope"
            />

            {/* AMP / VCA */}
            <AdsrRow
              caption="AMP / VCA"
              tone="text-module-env-vca"
              keys={AMP_KEYS}
              idPrefix=""
              rowClassName="flex items-start justify-around gap-2"
              params={params}
              onChangeParams={onChangeParams}
            />

            {/* FILTER / VCF */}
            <AdsrRow
              className="pt-2.5"
              caption="FILTER / VCF"
              tone="text-module-env-vcf"
              keys={FILTER_KEYS}
              idPrefix="filter-"
              rowClassName="flex items-start justify-around"
              params={params}
              onChangeParams={onChangeParams}
            />
            </div>
          </PanelCard>
  );
}

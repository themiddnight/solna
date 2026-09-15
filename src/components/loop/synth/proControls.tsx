import type { ReactNode } from 'react';
import { Power, PowerOff } from 'lucide-react';
import { Knob } from '@/components/ui/Knob';
import type { KnobColor, KnobScale, KnobSize } from '@/components/ui/Knob';
import { ModuleHeader } from '@/components/ui/ModuleHeader';
import { PanelCard } from '@/components/ui/PanelCard';
import { FIELD_LABEL } from '@/components/ui/fieldClasses';
import { defaultRouteFor, MOD_ROUTE_RANGES } from '@/utils/synthPatch';

import { TOOLBAR_BUTTON_IDLE } from '@/components/ui/Toolbar';
import type { EnginePatch, ModRoute, ModTarget } from '@/types/synth';

/**
 * The pieces every module of the approved Pro surface is assembled from
 * (prototype Variant A). A sixth file rather than six copies: the module shell,
 * the pressed-state toggle and the knob grid appear in all eight modules, and
 * the one thing a hand-copied toggle reliably loses is `aria-pressed`.
 *
 * It sits BESIDE the panels rather than inside `SubtractiveProPanel.tsx`
 * because that file imports every panel — a panel importing back would be a
 * genuine module cycle, not just a type one.
 */

/** The patch every module edits: common voice params plus the subtractive half. */
export type SubtractivePatch = EnginePatch<'subtractive'>;

/**
 * What a module panel takes. Each one receives the WHOLE patch and writes a
 * WHOLE patch back — a panel that took only its own branch could not express
 * "everything else is unchanged", which is the property the engine's
 * reference-equality checks depend on.
 */
export interface PatchPanelProps {
  patch: SubtractivePatch;
  onPatch: (next: SubtractivePatch) => void;
}

/**
 * The module identities this surface uses. A subset of `KnobColor`, because the
 * track identities (chord/bass/pad/fx) name a BUS and a module here names a
 * signal STAGE — colouring the filter with the bass token would say the filter
 * belongs to the bass track.
 *
 * Seven identities for seven panels, but ENV 1 and ENV 2 are two SHADES of
 * one — same green family, about 8 degrees apart — because they are one module
 * type instanced twice. Related, not interchangeable: a reader sweeping the
 * rack sees one envelope family, and a reader looking at the two side by side
 * can tell which is which without reading the badge. It used to be ENV 1 and Voice that shared, on the argument that
 * both are the amplitude stage and that the ring was full at nine hues with a
 * 25 degree floor. The count was right and the pairing was wrong: the two
 * envelopes are the panels a reader most needs to see as related, and Voice —
 * mono/poly, unison, spread, glide, width — is not a signal stage at all. The
 * ring did not have to grow; collapsing the envelopes freed the tenth slot
 * that was never available.
 */
export type ProModuleColor = Extract<
  KnobColor,
  | 'text-module-osc'
  | 'text-module-filter'
  | 'text-module-env-amp'
  | 'text-module-env-mod'
  | 'text-module-voice'
  | 'text-module-lfo'
  | 'text-module-arp'
>;

/**
 * The selected-toggle fill per module identity.
 *
 * Literals, never assembled from the token name: Tailwind v4 scans source
 * statically, so `[--btn-color:var(--color-${token})]` would emit nothing (the
 * same note `Knob`'s `BADGE_COLOR` and `SYNTH_TARGET_STYLES` carry).
 */
const ACTIVE_BUTTON: Record<ProModuleColor, string> = {
  'text-module-osc':
    '[--btn-color:var(--color-module-osc)] [--btn-fg:var(--color-module-osc-content)]',
  'text-module-filter':
    '[--btn-color:var(--color-module-filter)] [--btn-fg:var(--color-module-filter-content)]',
  'text-module-env-amp':
    '[--btn-color:var(--color-module-env-amp)] [--btn-fg:var(--color-module-env-amp-content)]',
  'text-module-env-mod':
    '[--btn-color:var(--color-module-env-mod)] [--btn-fg:var(--color-module-env-mod-content)]',
  'text-module-voice':
    '[--btn-color:var(--color-module-voice)] [--btn-fg:var(--color-module-voice-content)]',
  'text-module-lfo':
    '[--btn-color:var(--color-module-lfo)] [--btn-fg:var(--color-module-lfo-content)]',
  'text-module-arp':
    '[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]',
};

/**
 * One toggle in a group: pressed state is `aria-pressed`, never colour alone.
 *
 * `label` is the accessible name and MUST contain the button's visible text
 * (WCAG 2.5.3, Label in Name) — a button reading "1/16" whose name is
 * "Sixteenth notes" cannot be activated by a speech-input user saying what
 * they see. Where the visible content is an icon with no text, the name is
 * free to be the full word. `synthPanels.test.tsx` asserts the rule over every
 * button the Pro panel renders, so a new toggle cannot quietly break it.
 */
export function ToggleButton({
  id,
  label,
  pressed,
  color,
  onPress,
  className,
  children,
}: {
  id: string;
  /** The accessible name. Visible content may be an icon, a code or both. */
  label: string;
  pressed: boolean;
  color: ProModuleColor;
  onPress: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onPress}
      className={`btn btn-xs min-w-0 text-[10px] font-semibold ${
        pressed ? ACTIVE_BUTTON[color] : TOOLBAR_BUTTON_IDLE
      } ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

/**
 * The Pro rack's ENABLE switch: OSC 1, OSC 2, SUB OSC, NOISE and the Arp.
 *
 * Those five are one family — "this source or section is part of the sound" —
 * and nothing else on the surface is. The segmented rows (waveform, filter
 * response, rate, Mono/Poly) are CHOICES between options, and the Solo button
 * outside this rack is a monitoring gesture; neither belongs here, which is
 * what keeps "a round icon button is an enable switch" a rule rather than a
 * look applied wherever it happened to fit.
 *
 * Round, and the only round buttons in the rack. It reads as a panel switch
 * rather than one more rectangular cell among rectangular cells — and it ends
 * the reflow the words caused: "ON" and "OFF" are different widths, and the
 * switch sits in a `justify-between` header, so every toggle nudged the module
 * title sideways.
 *
 * State is NOT colour alone. Three things carry it — the glyph swaps (Power /
 * PowerOff), the fill swaps (module colour / idle outline), and `aria-pressed`
 * is on the button — so it survives a colour-blind reader and a screen reader
 * alike. The word that used to be the visible label is still the accessible
 * name, which is what WCAG 2.5.3 asks for once the visible content is an icon
 * carrying no text of its own.
 */
export function EnableToggle({
  id,
  name,
  enabled,
  color,
  onToggle,
}: {
  id: string;
  /** What is being switched — "OSC 1", "NOISE", "Arpeggiator". */
  name: string;
  enabled: boolean;
  color: ProModuleColor;
  onToggle: () => void;
}) {
  const Glyph = enabled ? Power : PowerOff;
  const label = `${name} ${enabled ? 'ON' : 'OFF'}`;
  return (
    <button
      id={id}
      type="button"
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={`btn btn-xs btn-circle min-w-0 ${
        enabled ? ACTIVE_BUTTON[color] : TOOLBAR_BUTTON_IDLE
      }`}
    >
      <Glyph className="w-3 h-3" aria-hidden="true" />
    </button>
  );
}

/** One option of a `ToggleRow`. */
export interface ToggleOption<T extends string> {
  value: T;
  /**
   * The accessible name. It must contain `content`'s visible text — spell the
   * code first and the words after it ("Sync to tempo", "1/16 sixteenth
   * notes") rather than replacing one with the other.
   */
  label: string;
  /** What the button shows. Defaults to `label`. */
  content?: ReactNode;
}

/**
 * A labelled row of mutually exclusive toggles. `role="group"` plus a visible
 * caption, so the row announces what it selects rather than leaving four
 * unrelated buttons on the page.
 */
export function ToggleRow<T extends string>({
  idPrefix,
  caption,
  options,
  value,
  color,
  columns,
  onSelect,
}: {
  /** Each button's id is `${idPrefix}-${option.value}`. */
  idPrefix: string;
  caption: string;
  options: readonly ToggleOption<T>[];
  value: T;
  color: ProModuleColor;
  /** Grid columns. Defaults to one per option. */
  columns?: number;
  onSelect: (value: T) => void;
}) {
  const labelId = `${idPrefix}-label`;
  return (
    <div>
      <span className={FIELD_LABEL} id={labelId}>
        {caption}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <ToggleButton
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            label={option.label}
            pressed={value === option.value}
            color={color}
            onPress={() => onSelect(option.value)}
          >
            {option.content ?? option.label}
          </ToggleButton>
        ))}
      </div>
    </div>
  );
}

/** One knob of a `KnobGrid`. */
export interface KnobSpec {
  id: string;
  label: string;
  /**
   * The accessible name where the visible label repeats elsewhere on the
   * panel — "Oct" under both oscillators, "Attack" under both envelopes. It
   * must contain the visible label (WCAG 2.5.3); see `Knob`'s own note.
   */
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  scale?: KnobScale;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

/**
 * The module's control row, as data.
 *
 * Written as specs rather than eight hand-placed `<Knob>` elements because a
 * module's knobs differ only in their four numbers and their writer — and
 * because `max-lines-per-function` is an error in this repo, which a column of
 * literal knobs blows through in every module that has four of them.
 */
export function KnobGrid({
  specs,
  color,
  size = 'sm',
  columns = 4,
  className,
}: {
  specs: readonly KnobSpec[];
  color: ProModuleColor;
  size?: KnobSize;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-x-1.5 gap-y-2.5 items-start ${className ?? ''}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {specs.map((spec) => (
        <Knob
          key={spec.id}
          id={spec.id}
          label={spec.label}
          ariaLabel={spec.ariaLabel}
          color={color}
          size={size}
          value={spec.value}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          scale={spec.scale}
          format={spec.format}
          onChange={spec.onChange}
        />
      ))}
    </div>
  );
}

/**
 * The shell every module wears: the recessed card, the numbered header, and an
 * optional chip on the right for the module's own state.
 */
export function ProModule({
  badge,
  title,
  color,
  chip,
  children,
}: {
  badge: number;
  title: string;
  color: ProModuleColor;
  /** The header's right cell — the LOCKED note, the voice count, the Arp switch. */
  chip?: ReactNode;
  children: ReactNode;
}) {
  return (
    /* No per-module sizing hook. The rack is a flex wrap, so a module's width
       comes from its own content and `grow`; the two `md:col-span-2` overrides
       that used to arrive through a `className` prop were grid-item properties
       a flex item ignores, and they outlived the grid by a commit. */
    <PanelCard inset className="min-w-0 grow">
      <div className="card-body p-3 gap-2.5">
        <ModuleHeader
          badge={badge}
          icon={<span className={`w-1.5 h-1.5 rounded-full bg-current ${color}`} />}
          title={title}
          right={chip}
        />
        {children}
      </div>
    </PanelCard>
  );
}

/** A read-only statement of module state, in the chip slot. */
export function ModuleChip({ color, children }: { color: ProModuleColor; children: ReactNode }) {
  return (
    <span className={`badge badge-sm badge-outline text-[9px] font-semibold ${color}`}>
      {children}
    </span>
  );
}

/**
 * The nine destinations, in the order the signal meets them, with the words a
 * musician reads rather than the union's kebab-case ids.
 */
const MOD_TARGET_LABELS: Record<ModTarget, string> = {
  'pitch-all': 'Pitch (all)',
  'osc1-pitch': 'OSC 1 pitch',
  'osc2-pitch': 'OSC 2 pitch',
  'osc1-level': 'OSC 1 level',
  'osc2-level': 'OSC 2 level',
  'filter-cutoff': 'Filter cutoff',
  'filter-resonance': 'Filter resonance',
  amplitude: 'Amplitude',
  pan: 'Pan',
};

const MOD_TARGETS = Object.keys(MOD_TARGET_LABELS) as ModTarget[];

/** The empty slot's option value. Not a `ModTarget`, so it cannot be stored. */
const NO_ROUTE = 'none';


/** The amount knob's range and readout for a route, by the unit it carries. */
function amountControlFor(
  route: ModRoute,
  // An LFO route caps deeper in dB than an ENV2 route does — it is summed
  // bipolar into a gain based at 1, so past `LFO_DB_ROUTE_LIMIT` the trough
  // inverts phase. The knob has to offer exactly what the validator accepts,
  // or a stored route renders pinned at a bound it can never be dragged off.
  dbRange: { min: number; max: number } = MOD_ROUTE_RANGES.db,
): {
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
} {
  switch (route.unit) {
    case 'semitones':
      return { ...MOD_ROUTE_RANGES.semitones, format: (v) => `${signed(v)} st` };
    case 'db':
      return { ...MOD_ROUTE_RANGES.db, ...dbRange, format: (v) => `${signed(v)} dB` };
    case 'normalized':
      return { ...MOD_ROUTE_RANGES.normalized, format: (v) => signed(v * 100, 0) };
    case 'pan':
      return { ...MOD_ROUTE_RANGES.pan, format: (v) => signed(v * 100, 0) };
  }
}

/** A signed reading — a modulation amount's direction is half of what it says. */
function signed(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/**
 * The amount knob and target select for ONE route slot, on ONE LINE.
 *
 * The knob is `layout="horizontal"` — caption and reading stacked to its LEFT
 * rather than above and below it. Vertically it made the row 74px tall against
 * a label-and-select column of 38, so more than half the row's height was the
 * knob's own caption and readout wrapping around a 36px dial. Three route rows
 * are on the rack at once (ENV 2 twice, LFO once), which is the height of a
 * whole module spent on six lines of 10px text.
 *
 * The rows are NOT paired two-across instead, which is the other way to get
 * the height back: the rack's columns run ~270-310px, so halving one leaves a
 * select too narrow for its own longest option ("Filter resonance") while the
 * knob beside it keeps its full width. Flattening the row costs no width at
 * all — the readout is `shrink-0` and the select is `flex-1`, so the select
 * absorbs the difference at whatever width the column happens to be.
 */
export function RouteRow({
  idPrefix,
  caption,
  amountLabel,
  route,
  color,
  dbRange,
  onChange,
}: {
  /** Ids are `select-${idPrefix}-target` and `slider-${idPrefix}-amount`. */
  idPrefix: string;
  caption: string;
  /**
   * The amount knob's accessible name, qualified by the module it belongs to.
   * Three route rows are on screen at once and every one of their knobs is
   * captioned "Amount", so the bare caption names none of them.
   */
  amountLabel: string;
  route: ModRoute | null;
  color: ProModuleColor;
  /** The dB bound this row's routes obey — see `amountControlFor`. */
  dbRange?: { min: number; max: number };
  onChange: (next: ModRoute | null) => void;
}) {
  const amount = route ? amountControlFor(route, dbRange) : null;
  return (
    /* ONE LINE: caption, select and dial abreast, not a captioned column beside
       a dial. The caption used to sit ABOVE the select, which made every route
       a two-line block — and three of them are on screen at once (ENV 2 has
       two, the LFO one), so the stacked caption cost the rack a knob row's
       worth of height for three words. Inline, the row is as tall as the dial
       and nothing else.

       `items-center` follows from that: with every cell now a single line,
       their centres are what line up. It was `items-end` for exactly as long
       as the left cell was two lines tall and the right cell one. */
    <div className="flex items-center gap-2 min-w-0">
      <label className={`${FIELD_LABEL} mb-0 shrink-0`} htmlFor={`select-${idPrefix}-target`}>
        {caption}
      </label>
      <div className="min-w-0 flex-1">
        <select
          id={`select-${idPrefix}-target`}
          className="select select-xs w-full text-[11px] font-semibold"
          value={route?.target ?? NO_ROUTE}
          onChange={(e) =>
            onChange(
              e.target.value === NO_ROUTE
                ? null
                : defaultRouteFor(e.target.value as ModTarget),
            )
          }
        >
          <option value={NO_ROUTE}>Off</option>
          {MOD_TARGETS.map((target) => (
            <option key={target} value={target}>
              {MOD_TARGET_LABELS[target]}
            </option>
          ))}
        </select>
      </div>
      {route && amount && (
        <Knob
          id={`slider-${idPrefix}-amount`}
          label="Amount"
          ariaLabel={amountLabel}
          color={color}
          size="sm"
          layout="horizontal"
          value={route.amount}
          min={amount.min}
          max={amount.max}
          step={amount.step}
          format={amount.format}
          onChange={(value) => onChange({ ...route, amount: value })}
        />
      )}
    </div>
  );
}

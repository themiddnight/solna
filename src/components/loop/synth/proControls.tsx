import type { ReactNode } from 'react';
import { Knob } from '@/components/ui/Knob';
import type { KnobColor, KnobScale, KnobSize } from '@/components/ui/Knob';
import { ModuleHeader } from '@/components/ui/ModuleHeader';
import { PanelCard } from '@/components/ui/PanelCard';
import { FIELD_LABEL } from '@/components/ui/fieldClasses';
import { defaultRouteFor, MOD_ROUTE_RANGES } from '@/utils/synthPatch';

// Re-exported so a Pro panel keeps reaching its controls through one module.
export { defaultRouteFor };
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
 * `text-module-env-vca` does double duty, on ENV 1 and on Voice. Those are the
 * two amplitude-stage modules — the prototype's own flow ribbon reads
 * "VOICE · AMP + UNISON" — and `index.css` records that the module ring is full
 * at nine hues with a 25 degree floor, so a tenth hue could not be more than
 * about 13 degrees from a neighbour. A shared identity that says something true
 * beats a new one that breaks the palette's own spacing rule.
 */
export type ProModuleColor = Extract<
  KnobColor,
  | 'text-module-osc'
  | 'text-module-filter'
  | 'text-module-env-vca'
  | 'text-module-env-vcf'
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
  'text-module-env-vca':
    '[--btn-color:var(--color-module-env-vca)] [--btn-fg:var(--color-module-env-vca-content)]',
  'text-module-env-vcf':
    '[--btn-color:var(--color-module-env-vcf)] [--btn-fg:var(--color-module-env-vcf-content)]',
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
  className,
  children,
}: {
  badge: number;
  title: string;
  color: ProModuleColor;
  /** The header's right cell — the LOCKED note, the voice count, the Arp switch. */
  chip?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <PanelCard inset className={`min-w-0 ${className ?? ''}`}>
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
export const MOD_TARGET_LABELS: Record<ModTarget, string> = {
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

export const MOD_TARGETS = Object.keys(MOD_TARGET_LABELS) as ModTarget[];

/** The empty slot's option value. Not a `ModTarget`, so it cannot be stored. */
export const NO_ROUTE = 'none';


/** The amount knob's range and readout for a route, by the unit it carries. */
export function amountControlFor(
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

/** The amount knob and target select for ONE route slot. */
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
    <div className="flex items-center gap-2 min-w-0">
      <div className="min-w-0 flex-1">
        <label className={FIELD_LABEL} htmlFor={`select-${idPrefix}-target`}>
          {caption}
        </label>
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

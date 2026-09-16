import type { AdsrParams, ModRoute } from '@/types/synth';
import { FIELD_LABEL } from '@/components/ui/fieldClasses';
import {
  KnobGrid,
  ModuleChip,
  ProModule,
  RouteRow,
  type PatchPanelProps,
  type ProModuleColor,
} from './proControls';

/**
 * Pro-Mode modules 4 and 5 — the two envelopes (prototype Variant A's
 * `env-primary` and the modulation row's `ENV 2`).
 *
 * One file, two exported panels: they are the same four knobs over two
 * different destinations, and the thing that must never drift between them is
 * the knob set. What differs is what they reach — ENV 1 is wired to amplitude
 * and says so, ENV 2 owns two assignable routes.
 */
/**
 * Two SHADES of one identity, not two identities. They are the same module
 * type instanced twice — same four knobs, same curve, different destination —
 * so they share a green family; ENV 1 sits warmer, toward the oscillator's
 * gold, which is enough to tell them apart side by side and not enough to read
 * as unrelated modules.
 *
 * The split is INSIDE a family, so it does not consume a second slot on the
 * hue ring and the ring's 25 degree floor does not apply between these two —
 * that floor separates module IDENTITIES, and these two are one. index.css
 * carries the numbers, the one floor exception ENV 1 does make against
 * --module-chord, and why the two themes separate the pair by different
 * amounts.
 */
const ENV1_COLOR = 'text-module-env-amp' as const;
const ENV2_COLOR = 'text-module-env-mod' as const;

/** The envelope time readout: milliseconds while it is one, seconds after. */
const envTime = (value: number) =>
  value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;

/**
 * The four ADSR knobs.
 *
 * Times run on a LOG taper from 1 ms: an envelope's useful detail is at the
 * short end — the difference between 8 ms and 40 ms of attack is the difference
 * between a pluck and a pad — and a linear 0..8 s knob spends nine tenths of its
 * travel on times nobody sets by hand.
 */
function AdsrKnobs({
  idPrefix,
  moduleName,
  envelope,
  color,
  onEnvelope,
  onCommit,
  onCancel,
}: {
  idPrefix: string;
  /** Qualifies each knob's accessible name — both envelopes caption theirs
   *  "Attack", "Decay", "Sustain", "Release". */
  moduleName: string;
  envelope: AdsrParams;
  color: ProModuleColor;
  onEnvelope: (next: AdsrParams) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <KnobGrid
      color={color}
      /* One size for both, for the same reason they share one hue: they are
         the same module twice over. ENV 1 was `md` and ENV 2 `sm`, which read
         as a hierarchy that does not exist — ENV 2 is not a lesser envelope,
         it is the one whose destination you choose. */
      size="md"
      specs={[
        {
          id: `slider-${idPrefix}-attack`,
          label: 'Attack',
          ariaLabel: `${moduleName} Attack`,
          value: envelope.attack,
          min: 0.001,
          max: 8,
          scale: 'log',
          format: envTime,
          onChange: (attack) => onEnvelope({ ...envelope, attack }),
          onCommit,
          onCancel,
        },
        {
          id: `slider-${idPrefix}-decay`,
          label: 'Decay',
          ariaLabel: `${moduleName} Decay`,
          value: envelope.decay,
          min: 0.001,
          max: 8,
          scale: 'log',
          format: envTime,
          onChange: (decay) => onEnvelope({ ...envelope, decay }),
          onCommit,
          onCancel,
        },
        {
          id: `slider-${idPrefix}-sustain`,
          label: 'Sustain',
          ariaLabel: `${moduleName} Sustain`,
          value: envelope.sustain,
          min: 0,
          max: 1,
          step: 0.01,
          format: (v) => `${Math.round(v * 100)}%`,
          onChange: (sustain) => onEnvelope({ ...envelope, sustain }),
          onCommit,
          onCancel,
        },
        {
          id: `slider-${idPrefix}-release`,
          label: 'Release',
          ariaLabel: `${moduleName} Release`,
          value: envelope.release,
          min: 0.001,
          max: 8,
          scale: 'log',
          format: envTime,
          onChange: (release) => onEnvelope({ ...envelope, release }),
          onCommit,
          onCancel,
        },
      ]}
    />
  );
}

/** ENV 1: the amp envelope, whose destination is a fact rather than a choice. */
export function AmpEnvelopePanel({ patch, onPatch, onCommit, onCancel }: PatchPanelProps) {
  return (
    <ProModule
      badge={5}
      title="ENV 1"
      color={ENV1_COLOR}
      chip={<ModuleChip color={ENV1_COLOR}>AMP · LOCKED</ModuleChip>}
    >
      <AdsrKnobs
        idPrefix="env1"
        moduleName="ENV 1"
        envelope={patch.synth.ampEnvelope}
        color={ENV1_COLOR}
        onEnvelope={(ampEnvelope) => onPatch({ ...patch, synth: { ...patch.synth, ampEnvelope } })}
        onCommit={onCommit}
        onCancel={onCancel}
      />
      {/* Read-only by construction, not a disabled control: ENV 1 is wired to
          amplitude in the engine and `SubtractiveParams` has no field that
          could hold anything else, so there is nothing here to operate. */}
      <div
        id="env1-destination"
        className="flex items-center justify-between gap-2 rounded-box border border-base-300 bg-base-100 px-2 py-1.5 mt-3"
      >
        <span className={`${FIELD_LABEL} m-0!`}>Target</span>
        <span className={`text-[11px] font-semibold ${ENV1_COLOR}`}>Amplitude</span>
      </div>
    </ProModule>
  );
}

/**
 * ENV 2: the same envelope over two assignable routes.
 *
 * The two slots are POSITIONAL in the view and a plain list in the patch — the
 * validator caps `env2Routes` at two. Setting a slot to Off drops it, so a
 * second route left assigned moves up into the first slot on the next render;
 * that is the honest consequence of a list, and the alternative (a fixed pair
 * with holes) would make "no routes assigned" unrepresentable in the type.
 */
export function ModEnvelopePanel({ patch, onPatch, onCommit, onCancel }: PatchPanelProps) {
  const routes = patch.synth.env2Routes;
  const writeRoute = (index: number, next: ModRoute | null) => {
    const slots: (ModRoute | null)[] = [routes[0] ?? null, routes[1] ?? null];
    slots[index] = next;
    onPatch({
      ...patch,
      synth: { ...patch.synth, env2Routes: slots.filter((slot): slot is ModRoute => slot !== null) },
    });
  };
  return (
    <ProModule
      badge={6}
      title="ENV 2"
      color={ENV2_COLOR}
      chip={<ModuleChip color={ENV2_COLOR}>MOD</ModuleChip>}
    >
      <AdsrKnobs
        idPrefix="env2"
        moduleName="ENV 2"
        envelope={patch.synth.modEnvelope}
        color={ENV2_COLOR}
        onEnvelope={(modEnvelope) => onPatch({ ...patch, synth: { ...patch.synth, modEnvelope } })}
        onCommit={onCommit}
        onCancel={onCancel}
      />
      {[0, 1].map((index) => (
        <RouteRow
          key={index}
          idPrefix={`env2-route-${index}`}
          caption={`Target ${index + 1}`}
          amountLabel={`ENV 2 target ${index + 1} Amount`}
          route={routes[index] ?? null}
          color={ENV2_COLOR}
          onChange={(next) => writeRoute(index, next)}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      ))}
    </ProModule>
  );
}

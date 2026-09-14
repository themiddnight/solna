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
const AMP_COLOR = 'text-module-env-vca' as const;
const MOD_COLOR = 'text-module-env-vcf' as const;

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
}: {
  idPrefix: string;
  /** Qualifies each knob's accessible name — both envelopes caption theirs
   *  "Attack", "Decay", "Sustain", "Release". */
  moduleName: string;
  envelope: AdsrParams;
  color: ProModuleColor;
  onEnvelope: (next: AdsrParams) => void;
}) {
  return (
    <KnobGrid
      color={color}
      size={idPrefix === 'env1' ? 'md' : 'sm'}
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
        },
      ]}
    />
  );
}

/** ENV 1: the amp envelope, whose destination is a fact rather than a choice. */
export function AmpEnvelopePanel({ patch, onPatch }: PatchPanelProps) {
  return (
    <ProModule
      badge={4}
      title="ENV 1"
      color={AMP_COLOR}
      chip={<ModuleChip color={AMP_COLOR}>AMP · LOCKED</ModuleChip>}
      className="md:col-span-2 xl:col-span-1"
    >
      <AdsrKnobs
        idPrefix="env1"
        moduleName="ENV 1"
        envelope={patch.synth.ampEnvelope}
        color={AMP_COLOR}
        onEnvelope={(ampEnvelope) => onPatch({ ...patch, synth: { ...patch.synth, ampEnvelope } })}
      />
      {/* Read-only by construction, not a disabled control: ENV 1 is wired to
          amplitude in the engine and `SubtractiveParams` has no field that
          could hold anything else, so there is nothing here to operate. */}
      <div
        id="env1-destination"
        className="flex items-center justify-between gap-2 rounded-box border border-base-300 bg-base-100 px-2 py-1.5 mt-auto"
      >
        <span className={`${FIELD_LABEL} mb-0`}>Destination</span>
        <span className={`text-[11px] font-semibold ${AMP_COLOR}`}>Amplitude</span>
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
export function ModEnvelopePanel({ patch, onPatch }: PatchPanelProps) {
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
      badge={5}
      title="ENV 2"
      color={MOD_COLOR}
      chip={<ModuleChip color={MOD_COLOR}>MOD</ModuleChip>}
    >
      <AdsrKnobs
        idPrefix="env2"
        moduleName="ENV 2"
        envelope={patch.synth.modEnvelope}
        color={MOD_COLOR}
        onEnvelope={(modEnvelope) => onPatch({ ...patch, synth: { ...patch.synth, modEnvelope } })}
      />
      {[0, 1].map((index) => (
        <RouteRow
          key={index}
          idPrefix={`env2-route-${index}`}
          caption={`Target ${index + 1}`}
          amountLabel={`ENV 2 target ${index + 1} Amount`}
          route={routes[index] ?? null}
          color={MOD_COLOR}
          onChange={(next) => writeRoute(index, next)}
        />
      ))}
    </ProModule>
  );
}

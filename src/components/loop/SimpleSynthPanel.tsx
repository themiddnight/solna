import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Knob } from '../ui/Knob';
import type { KnobScale } from '../ui/Knob';
import { PanelCard } from '../ui/PanelCard';
import { ToggleButton, ToggleRow, type ProModuleColor } from './synth/proControls';
import type { SynthChannel } from '@/utils/synthControl';
import { SYNTH_GAIN_FLOOR_DB } from '@/utils/synthPatch';
import {
  readSubtractiveSimple,
  simpleFeelSummary,
  writeSubtractiveSimple,
  type SimpleControlId,
  type SimpleReading,
} from '@/utils/subtractiveSimple';

/**
 * The approved Subtractive Simple surface — prototype Variant B, reconstructed
 * with production components
 * (docs/superpowers/prototypes/2026-09-14-synth-lab-approved-ui.html; Variant C
 * is historical and non-normative).
 *
 * It is a VIEW of the patch Pro edits and holds no state of its own: every
 * reading is computed by `utils/subtractiveSimple.ts` on render and every
 * gesture writes one canonical parameter straight back. Switching depth
 * therefore writes nothing at all — asserted in `SimpleSynthPanel.test.tsx`,
 * because a projection that normalised the patch on mount would mark a project
 * dirty just for looking at it.
 *
 * ONE continuous deck with four visually separated groups, not one card per
 * knob: the groups are Source / Tone / Feel / Motion, which is how a listener
 * describes a sound, and a card each would make eight equal-weight objects out
 * of four decisions.
 *
 * **Pro vocabulary stays in Pro.** No cent, no Q, no ENV 2 destination, no key
 * tracking, no unison detune appears on this surface — not as a caption, a
 * readout or a tooltip. The test holds the list.
 */

/** Everything the deck needs to draw ONE control, beside the id it writes. */
interface SimpleControlSpec {
  /** The caption above the knob, and the knob's accessible name. */
  label: string;
  /** The one-line hint under the reading. Plain language, never a unit name. */
  hint: string;
  /**
   * The knob's module identity — the colour its canonical parameter wears in
   * Pro, so a knob keeps its identity across a mode switch.
   *
   * Width is the one that does not match its GROUP: `common.stereoWidth` lives
   * in Pro's Voice module (`module-voice`) while Variant B files Width under
   * Motion. The identity follows the parameter, not the box it is drawn in —
   * which only became visible once Voice stopped borrowing the envelope's hue,
   * since before that Width wore the Feel group's colour by coincidence.
   */
  color: ProModuleColor;
  min: number;
  max: number;
  step?: number;
  scale?: KnobScale;
  format: (value: number) => string;
}

/** Milliseconds while it is one, seconds after — the Pro envelope readout. */
const envTime = (value: number) => (value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`);
const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * The eight controls. Each range is the SAME range Pro offers for the same
 * parameter — a Simple knob that could not reach a value Pro can set would
 * make a preset loadable and then unrecoverable from this surface.
 */
export const SIMPLE_CONTROL_SPECS: Record<SimpleControlId, SimpleControlSpec> = {
  shape: {
    label: 'Shape',
    hint: 'layer blend',
    color: 'text-module-osc',
    min: 0,
    max: 1,
    step: 0.01,
    format: percent,
  },
  weight: {
    label: 'Weight',
    hint: 'low-end body',
    color: 'text-module-osc',
    // The floor, not -60: factory presets park a silent sub at
    // `SYNTH_GAIN_FLOOR_DB`, and a knob that cannot reach it reports a value
    // below its own minimum (see UtilitySourcePanel).
    min: SYNTH_GAIN_FLOOR_DB,
    max: 0,
    step: 0.5,
    format: (v) => `${v.toFixed(1)} dB`,
  },
  brightness: {
    label: 'Brightness',
    hint: 'dark to bright',
    color: 'text-module-filter',
    min: 20,
    max: 20_000,
    step: 1,
    scale: 'log',
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`),
  },
  bite: {
    label: 'Bite',
    hint: 'smooth to sharp',
    color: 'text-module-filter',
    min: 0,
    max: 1,
    step: 0.01,
    format: percent,
  },
  attack: {
    label: 'Attack',
    hint: 'soft to punchy',
    color: 'text-module-env-amp',
    min: 0.001,
    max: 8,
    scale: 'log',
    format: envTime,
  },
  tail: {
    label: 'Tail',
    hint: 'short to lasting',
    color: 'text-module-env-amp',
    min: 0.001,
    max: 8,
    scale: 'log',
    format: envTime,
  },
  movement: {
    label: 'Movement',
    hint: 'steady to animated',
    color: 'text-module-lfo',
    min: 0,
    max: 1,
    step: 0.01,
    format: percent,
  },
  width: {
    label: 'Width',
    hint: 'narrow to wide',
    color: 'text-module-voice',
    min: 0,
    max: 1,
    step: 0.01,
    format: percent,
  },
};

/** The four listening-intent groups, in Variant B's order. */
const SIMPLE_GROUPS: readonly {
  id: string;
  title: string;
  kicker: string;
  color: ProModuleColor;
  controls: readonly SimpleControlId[];
}[] = [
  {
    id: 'source',
    title: 'Source',
    kicker: 'core character',
    color: 'text-module-osc',
    controls: ['shape', 'weight'],
  },
  {
    id: 'tone',
    title: 'Tone',
    kicker: 'colour & impact',
    color: 'text-module-filter',
    controls: ['brightness', 'bite'],
  },
  {
    id: 'feel',
    title: 'Feel',
    kicker: 'note response',
    color: 'text-module-env-amp',
    controls: ['attack', 'tail'],
  },
  {
    id: 'motion',
    title: 'Motion',
    kicker: 'movement & size',
    color: 'text-module-lfo',
    controls: ['movement', 'width'],
  },
];

/** One knob, its caption, its derived phrase and its hint. */
function SimpleControl({
  id,
  reading,
  onChange,
}: {
  id: SimpleControlId;
  reading: SimpleReading;
  onChange: (value: number) => void;
}) {
  const spec = SIMPLE_CONTROL_SPECS[id];
  return (
    <div className="min-w-0 flex flex-col items-center text-center">
      <Knob
        id={`slider-simple-${id}`}
        label={spec.label}
        color={spec.color}
        size="md"
        descriptor={reading.descriptor}
        value={reading.value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        scale={spec.scale}
        format={spec.format}
        onChange={onChange}
      />
      <span className="mt-1 text-[10px] leading-tight text-base-content/50">{spec.hint}</span>
    </div>
  );
}

/**
 * The deck's header: what this surface is, and one derived line naming the
 * sound as a whole. The wave is decorative and says so — it is a drawing, not
 * an analyser, so it carries no data and no `aria` role.
 */
function SimpleIntro({ summary }: { summary: string }) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 border-b border-base-300">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-base-content">Shape the sound</h2>
        <p className="text-[10px] text-base-content/60">
          Eight musical controls for fast changes. Open Pro when you need the routing underneath.
        </p>
      </div>
      <svg
        className="hidden md:block flex-1 min-w-40 h-10 text-module-osc/70"
        viewBox="0 0 700 70"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 36 C25 8 46 65 70 36 S116 8 140 36 S186 66 210 36 S256 9 280 36 S326 64 350 36 S396 7 420 36 S466 66 490 36 S536 9 560 36 S606 63 630 36 S676 12 700 36"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        />
      </svg>
      <div className="flex items-center gap-2 rounded-box border border-base-300 bg-base-100 px-2.5 py-1.5">
        <span className="text-[10px] text-base-content/60">Current feel</span>
        <strong className="text-[11px] font-semibold text-base-content">{summary}</strong>
      </div>
    </header>
  );
}

/** Play style, the Arp strip, and the one honest note about what Pro adds. */
function SimplePerformance({
  channel,
  onSwitchToPro,
}: {
  channel: SynthChannel;
  onSwitchToPro: () => void;
}) {
  const { activeSynth, arpSettings } = channel;
  const common = activeSynth.patch.common;
  return (
    <footer className="grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-end px-4 py-3 border-t border-base-300 bg-base-100/50">
      <ToggleRow
        idPrefix="btn-simple-voice"
        caption="Play style"
        /* `common.voiceMode` is a Voice parameter, so it wears Voice — the
           same "identity follows the parameter" rule the knob table above
           states. It read as the envelope's colour only while Voice had no
           hue of its own. */
        color="text-module-voice"
        value={common.voiceMode}
        options={[
          { value: 'mono', label: 'Mono, monophonic', content: 'Mono' },
          { value: 'poly', label: 'Poly, polyphonic', content: 'Poly' },
        ]}
        onSelect={(voiceMode) =>
          channel.setActiveSynth({
            ...activeSynth,
            patch: { ...activeSynth.patch, common: { ...common, voiceMode } },
          })
        }
      />

      <div className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] sm:items-end min-w-0">
        <ToggleButton
          id="btn-simple-arp-toggle"
          label={`Arp ${arpSettings.active ? 'on' : 'off'}`}
          pressed={arpSettings.active}
          color="text-module-arp"
          onPress={() => channel.setArpSettings({ ...arpSettings, active: !arpSettings.active })}
        >
          {arpSettings.active ? 'Arp on' : 'Arp off'}
        </ToggleButton>

        {/* All four rates and all four directions, though Variant B draws three
            rates: a setting the stored Arp can hold and this surface cannot
            reach is one a user can load and never get back to. */}
        <ToggleRow
          idPrefix="btn-simple-arp-rate"
          caption="Speed"
          color="text-module-arp"
          value={arpSettings.rate}
          options={[
            { value: '4n', label: '1/4, quarter notes', content: '1/4' },
            { value: '8n', label: '1/8, eighth notes', content: '1/8' },
            { value: '16n', label: '1/16, sixteenth notes', content: '1/16' },
            { value: '32n', label: '1/32, thirty-second notes', content: '1/32' },
          ]}
          onSelect={(rate) => channel.setArpSettings({ ...arpSettings, rate })}
        />

        <ToggleRow
          idPrefix="btn-simple-arp-mode"
          caption="Direction"
          color="text-module-arp"
          value={arpSettings.mode}
          options={[
            { value: 'up', label: 'Up', content: '↑' },
            { value: 'down', label: 'Down', content: '↓' },
            { value: 'updown', label: 'Up and down', content: '⇅' },
            { value: 'random', label: 'Random', content: '◆' },
          ]}
          onSelect={(mode) => channel.setArpSettings({ ...arpSettings, mode })}
        />
      </div>

      <button
        id="btn-switch-pro-hint"
        type="button"
        onClick={onSwitchToPro}
        className="btn btn-xs btn-ghost justify-self-start lg:justify-self-end text-[10px] font-semibold text-base-content/60 gap-1"
      >
        Detailed routing stays in Pro
        <ChevronRight className="w-3 h-3" aria-hidden="true" />
      </button>
    </footer>
  );
}

/** One group: its coloured rule, its heading pair, and its two controls. */
function SimpleGroup({
  group,
  children,
}: {
  group: (typeof SIMPLE_GROUPS)[number];
  children: ReactNode;
}) {
  return (
    <section className="relative min-w-0 px-3 pt-4 pb-4 border-b border-base-300 last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 xl:border-r xl:[&:nth-child(2n)]:border-r xl:last:border-r-0">
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-0.5 bg-current opacity-70 ${group.color}`}
      />
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-[11px] font-bold text-base-content">{group.title}</h3>
        <span className="text-[10px] text-base-content/50 truncate">{group.kicker}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 min-w-0">{children}</div>
    </section>
  );
}

export function SimpleSynthPanel({
  channel,
  onSwitchToPro,
}: {
  channel: SynthChannel;
  onSwitchToPro: () => void;
}) {
  const activeSynth = channel.activeSynth;
  const readings = readSubtractiveSimple(activeSynth);
  // The ONE wiring site: a control's id picks both its reading and its write,
  // so a mis-wired knob is a type error rather than a knob that edits its
  // neighbour's parameter.
  const write = (id: SimpleControlId, value: number) =>
    channel.setActiveSynth(writeSubtractiveSimple(activeSynth, id, value));

  return (
    <PanelCard inset className="w-full min-w-0 overflow-hidden">
      <SimpleIntro summary={simpleFeelSummary(activeSynth)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {SIMPLE_GROUPS.map((group) => (
          <SimpleGroup key={group.id} group={group}>
            {group.controls.map((id) => (
              <SimpleControl
                key={id}
                id={id}
                reading={readings[id]}
                onChange={(value) => write(id, value)}
              />
            ))}
          </SimpleGroup>
        ))}
      </div>
      <SimplePerformance channel={channel} onSwitchToPro={onSwitchToPro} />
    </PanelCard>
  );
}

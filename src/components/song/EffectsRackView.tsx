import React from "react";
import { Waves, Activity, Sparkles, Sliders, Gauge, ShieldCheck } from "lucide-react";
import { MasterEffects } from "@/types";
import { useAppStore } from "@/store/store";
import { Knob } from "../ui/Knob";
import { PowerToggle } from "../ui/PowerToggle";
import { ViewHeader } from "../ui/ViewHeader";
import { ModuleHeader } from "../ui/ModuleHeader";
import { PanelCard } from "../ui/PanelCard";
import { SECTION_HEADER } from "../ui/fieldClasses";
import { AudioVisualizer, VISUALIZER_MODES, VISUALIZER_MODE_LABEL, type VisualizerMode } from "../AudioVisualizer";
import {
  compressorRatioDescriptor,
  delayFeedbackDescriptor,
  distortionDriveDescriptor,
  dynamicsAttackDescriptor,
  dynamicsReleaseDescriptor,
  reverbDecayDescriptor,
} from "../fxDescriptors";
import { GainReductionMeter } from "../ui/GainReductionMeter";

/** The numeric fields of `MasterEffects` — the only ones a knob may drive. `-?` is what
 *  keeps `undefined` out of the union: MasterEffects has optional members, and a mapped
 *  type that preserves their optionality yields `undefined` as a key. */
type DynamicsValueKey = {
  [K in keyof MasterEffects]-?: MasterEffects[K] extends number ? K : never;
}[keyof MasterEffects];

/** The two required `*Enabled` booleans; the optional `*Bypass?` flags are a different
 *  mechanism entirely (see the comment on MasterEffects in types.ts). */
type DynamicsEnabledKey = "compressorEnabled" | "limiterEnabled";

interface DynamicsKnobSpec {
  id: string;
  label: string;
  /** Indexes `MasterEffects`, so a renamed field fails here rather than writing a
   *  patch nothing reads. */
  valueKey: DynamicsValueKey;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  /** Omitted where the value has no plain-language reading worth printing. */
  descriptor?: (value: number) => string;
}

interface DynamicsCardSpec {
  badge: number;
  icon: React.ReactNode;
  /** Shown as the card title AND used as the toggle's accessible name — the two were
   *  hand-written twice per card and must not be allowed to say different things. */
  title: string;
  toggleId: string;
  enabledKey: DynamicsEnabledKey;
  stage: "compressor" | "limiter";
  knobs: readonly DynamicsKnobSpec[];
}

/**
 * The two master dynamics cards, in the order they render.
 *
 * A table rather than two ~85-line JSX blocks: the compressor and the limiter are the
 * same card — same shell, same header, same four-knob row, same gain-reduction meter —
 * and differed only in these values. Two copies of that markup is two places to fix a
 * layout change and two places for one of them to be missed.
 *
 * What is deliberately NOT in the table is anything both cards share: the `text-success`
 * knob colour, the `accent` toggle tone, the enabled/disabled card border. A shared value
 * lifted into the table would read as a per-card choice and invite the two to diverge,
 * which is the state this replaced.
 */
const DYNAMICS_CARDS: readonly DynamicsCardSpec[] = [
  {
    badge: 5,
    icon: <Gauge className="w-3.5 h-3.5 text-success" />,
    title: "Master Compressor",
    toggleId: "btn-enable-compressor",
    enabledKey: "compressorEnabled",
    stage: "compressor",
    knobs: [
      {
        id: "slider-comp-threshold",
        label: "Threshold",
        valueKey: "compressorThreshold",
        min: -48,
        max: 0,
        step: 1,
        format: (v) => `${v}dB`,
      },
      {
        id: "slider-comp-ratio",
        label: "Ratio",
        valueKey: "compressorRatio",
        min: 1,
        max: 20,
        step: 0.5,
        descriptor: compressorRatioDescriptor,
        format: (v) => `${v.toFixed(1)}:1`,
      },
      {
        id: "slider-comp-attack",
        label: "Attack",
        valueKey: "compressorAttack",
        min: 0.001,
        max: 0.2,
        step: 0.001,
        descriptor: dynamicsAttackDescriptor,
        format: (v) => `${(v * 1000).toFixed(0)}ms`,
      },
      {
        id: "slider-comp-release",
        label: "Release",
        valueKey: "compressorRelease",
        min: 0.02,
        max: 1,
        step: 0.01,
        descriptor: dynamicsReleaseDescriptor,
        format: (v) => `${(v * 1000).toFixed(0)}ms`,
      },
    ],
  },
  {
    badge: 6,
    icon: <ShieldCheck className="w-3.5 h-3.5 text-success" />,
    title: "Brickwall Limiter",
    toggleId: "btn-enable-limiter",
    enabledKey: "limiterEnabled",
    stage: "limiter",
    knobs: [
      {
        // "Ceiling", not "Threshold": on a brickwall stage the number IS the output
        // ceiling, and the knob id stays `limiter-threshold` because it tracks the
        // store field, not the label.
        id: "slider-limiter-threshold",
        label: "Ceiling",
        valueKey: "limiterThreshold",
        min: -24,
        max: 0,
        step: 0.5,
        format: (v) => `${v.toFixed(1)}dB`,
      },
      {
        id: "slider-limiter-ratio",
        label: "Ratio",
        valueKey: "limiterRatio",
        min: 4,
        max: 20,
        step: 1,
        format: (v) => `${v.toFixed(0)}:1`,
      },
      {
        id: "slider-limiter-attack",
        label: "Attack",
        valueKey: "limiterAttack",
        min: 0.001,
        max: 0.05,
        step: 0.001,
        descriptor: dynamicsAttackDescriptor,
        format: (v) => `${(v * 1000).toFixed(0)}ms`,
      },
      {
        id: "slider-limiter-release",
        label: "Release",
        valueKey: "limiterRelease",
        min: 0.02,
        max: 0.5,
        step: 0.01,
        descriptor: dynamicsReleaseDescriptor,
        format: (v) => `${(v * 1000).toFixed(0)}ms`,
      },
    ],
  },
];

/** One master dynamics card. Both stages render through this; see DYNAMICS_CARDS. */
function DynamicsCard({
  spec,
  effects,
  updateFx,
}: {
  spec: DynamicsCardSpec;
  effects: MasterEffects;
  updateFx: (updates: Partial<MasterEffects>) => void;
}) {
  const enabled = effects[spec.enabledKey];
  return (
    <div
      className={`card bg-panel border shadow-md transition-all ${
        enabled ? "border-success/40 ring-1 ring-success/20" : "border-base-300 opacity-60"
      }`}
    >
      <div className="card-body p-3 sm:p-4 space-y-3">
        <ModuleHeader
          badge={spec.badge}
          icon={spec.icon}
          title={spec.title}
          right={
            <PowerToggle
              id={spec.toggleId}
              on={enabled}
              onToggle={() => updateFx({ [spec.enabledKey]: !enabled })}
              name={spec.title}
              tone="accent"
              size="xs"
              iconOnly
            />
          }
        />

        <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
          {spec.knobs.map((knob) => (
            <Knob
              key={knob.id}
              id={knob.id}
              label={knob.label}
              color="text-success"
              value={effects[knob.valueKey]}
              min={knob.min}
              max={knob.max}
              step={knob.step}
              disabled={!enabled}
              descriptor={knob.descriptor?.(effects[knob.valueKey])}
              format={knob.format}
              onChange={(v) => updateFx({ [knob.valueKey]: v })}
            />
          ))}
        </div>

        <GainReductionMeter stage={spec.stage} active={enabled} />
      </div>
    </div>
  );
}

/** The two props every FX unit card takes: the master effects, and its writer. */
interface FxUnitProps {
  effects: MasterEffects;
  updateFx: (updates: Partial<MasterEffects>) => void;
}

/**
 * One unit of the FX chain: the card shell, its numbered header and its power
 * toggle. `engagedClassName` is passed whole rather than composed from a tone,
 * because a Tailwind class built at runtime is a class the build never sees —
 * the four units ring in three different tones and each names its own.
 */
function FxCard({
  badge,
  icon,
  title,
  engagedClassName,
  bypassed,
  power,
  children,
}: {
  badge: number;
  icon: React.ReactNode;
  title: string;
  engagedClassName: string;
  /** Optional on MasterEffects, so undefined is passed through rather than defaulted. */
  bypassed: boolean | undefined;
  power: { id: string; name: string; onToggle: () => void };
  children: React.ReactNode;
}) {
  return (
    <div
      className={`card bg-panel border shadow-md transition-all ${
        bypassed ? "border-base-300 opacity-60" : engagedClassName
      }`}
    >
      <div className="card-body p-3 sm:p-4 space-y-3">
        <ModuleHeader
          badge={badge}
          icon={icon}
          title={title}
          right={
            <PowerToggle
              id={power.id}
              on={!bypassed}
              onToggle={power.onToggle}
              name={power.name}
              tone="accent"
              size="xs"
              iconOnly
            />
          }
        />
        {children}
      </div>
    </div>
  );
}

/** The centred knob row the reverb, delay and EQ units all lay their knobs out in. */
function FxKnobRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
      {children}
    </div>
  );
}

/** 1. Algorithmic Reverb Unit */
function ReverbUnit({ effects, updateFx }: FxUnitProps) {
  return (
    <FxCard
      badge={1}
      icon={<Waves className="w-3.5 h-3.5 text-accent" />}
      title="Space Reverb"
      engagedClassName="border-accent/40 ring-1 ring-accent/20"
      bypassed={effects.reverbBypass}
      power={{
        id: "btn-bypass-reverb",
        name: "Reverb",
        onToggle: () => updateFx({ reverbBypass: !effects.reverbBypass }),
      }}
    >
      <FxKnobRow>
        <Knob
          id="slider-reverb-wet"
          label="Mix"
          color="text-accent"
          value={effects.reverbWet}
          min={0}
          max={1}
          step={0.01}
          disabled={effects.reverbBypass}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => updateFx({ reverbWet: v })}
        />
        <Knob
          id="slider-reverb-decay"
          label="Decay"
          color="text-accent"
          value={effects.reverbDecay}
          min={0.5}
          max={6.0}
          step={0.1}
          disabled={effects.reverbBypass}
          descriptor={reverbDecayDescriptor(effects.reverbDecay)}
          format={(v) => `${v.toFixed(1)}s`}
          onChange={(v) => updateFx({ reverbDecay: v })}
        />
      </FxKnobRow>
    </FxCard>
  );
}

/** 2. Stereo Delay Unit */
function DelayUnit({ effects, updateFx }: FxUnitProps) {
  return (
    <FxCard
      badge={2}
      icon={<Activity className="w-3.5 h-3.5 text-accent" />}
      title="Stereo Echo"
      engagedClassName="border-accent/40 ring-1 ring-accent/20"
      bypassed={effects.delayBypass}
      power={{
        id: "btn-bypass-delay",
        name: "Delay",
        onToggle: () => updateFx({ delayBypass: !effects.delayBypass }),
      }}
    >
      <FxKnobRow>
        <Knob
          id="slider-delay-wet"
          label="Mix"
          color="text-accent"
          value={effects.delayWet}
          min={0}
          max={1}
          step={0.01}
          disabled={effects.delayBypass}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => updateFx({ delayWet: v })}
        />
        <Knob
          id="slider-delay-feedback"
          label="Feedback"
          color="text-accent"
          value={effects.delayFeedback}
          min={0}
          max={0.9}
          step={0.01}
          disabled={effects.delayBypass}
          descriptor={delayFeedbackDescriptor(effects.delayFeedback)}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => updateFx({ delayFeedback: v })}
        />
      </FxKnobRow>
    </FxCard>
  );
}

/** 3. Wave Distortion / Warmth Unit */
function DistortionUnit({ effects, updateFx }: FxUnitProps) {
  return (
    <FxCard
      badge={3}
      icon={<Sparkles className="w-3.5 h-3.5 text-primary" />}
      title="Distortion"
      engagedClassName="border-primary/40 ring-1 ring-primary/20"
      bypassed={effects.distortionBypass}
      power={{
        id: "btn-bypass-distortion",
        name: "Distortion",
        onToggle: () => updateFx({ distortionBypass: !effects.distortionBypass }),
      }}
    >
      <Knob
        id="slider-distortion-wet"
        label="Drive / Crunch"
        color="text-primary"
        value={effects.distortionWet}
        min={0}
        max={1}
        step={0.01}
        disabled={effects.distortionBypass}
        descriptor={distortionDriveDescriptor(effects.distortionWet)}
        format={(v) => `${(v * 100).toFixed(0)}%`}
        onChange={(v) => updateFx({ distortionWet: v })}
      />
    </FxCard>
  );
}

/** One EQ band. The three bands differ only in which value they read and write. */
function EqBandKnob({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  disabled: boolean | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <Knob
      id={id}
      label={label}
      color="text-secondary"
      value={value}
      min={-15}
      max={15}
      step={1}
      detent={0}
      disabled={disabled}
      format={(v) => `${v > 0 ? `+${v}` : v}dB`}
      onChange={onChange}
    />
  );
}

/** 4. 3-Band Equalizer */
function EqUnit({ effects, updateFx }: FxUnitProps) {
  return (
    <FxCard
      badge={4}
      icon={<Sliders className="w-3.5 h-3.5 text-secondary" />}
      title="3-Band EQ"
      engagedClassName="border-secondary/40 ring-1 ring-secondary/20"
      bypassed={effects.eqBypass}
      power={{
        id: "btn-bypass-eq",
        name: "Equalizer",
        onToggle: () => updateFx({ eqBypass: !effects.eqBypass }),
      }}
    >
      <FxKnobRow>
        <EqBandKnob
          id="slider-eq-low"
          label="LOW"
          value={effects.eqLow}
          disabled={effects.eqBypass}
          onChange={(v) => updateFx({ eqLow: v })}
        />
        <EqBandKnob
          id="slider-eq-mid"
          label="MID"
          value={effects.eqMid}
          disabled={effects.eqBypass}
          onChange={(v) => updateFx({ eqMid: v })}
        />
        <EqBandKnob
          id="slider-eq-high"
          label="HIGH"
          value={effects.eqHigh}
          disabled={effects.eqBypass}
          onChange={(v) => updateFx({ eqHigh: v })}
        />
      </FxKnobRow>
    </FxCard>
  );
}

/** The four-stage FX chain, in signal order. */
function FxChain({ effects, updateFx }: FxUnitProps) {
  return (
    <section className="space-y-2">
      <h3 className={`${SECTION_HEADER} px-1`}>FX Chain</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <ReverbUnit effects={effects} updateFx={updateFx} />
        <DelayUnit effects={effects} updateFx={updateFx} />
        <DistortionUnit effects={effects} updateFx={updateFx} />
        <EqUnit effects={effects} updateFx={updateFx} />
      </div>
    </section>
  );
}

/** The two master dynamics stages, each one card off the DYNAMICS_CARDS table. */
function MasterDynamicsSection({ effects, updateFx }: FxUnitProps) {
  return (
    <section className="space-y-2">
      <h3 className={`${SECTION_HEADER} px-1`}>Master Dynamics</h3>
      <p className="px-1 text-[11px] text-base-content/60">
        Both stages sit after the master fader and after the meter, so the level you see is
        the mix you made. The limiter starts on as a safety net for the occasional over; the
        compressor starts off. Switch either one to taste.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        {DYNAMICS_CARDS.map((spec) => (
          <DynamicsCard key={spec.stage} spec={spec} effects={effects} updateFx={updateFx} />
        ))}
      </div>
    </section>
  );
}

/** The monitor panel: the visualizer's mode switcher, and the visualizer itself. */
function MonitorSection({
  vizMode,
  onModeChange,
  paused,
}: {
  vizMode: VisualizerMode;
  onModeChange: (mode: VisualizerMode) => void;
  paused: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className={`${SECTION_HEADER} px-1`}>Monitor</h3>
      <PanelCard>
        <div className="card-body p-3 sm:p-4 gap-3">
          <div className="join self-start">
            {VISUALIZER_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onModeChange(mode)}
                className={`btn btn-xs join-item text-[11px] font-semibold ${
                  vizMode === mode ? "btn-active btn-primary" : "btn-ghost"
                }`}
              >
                {VISUALIZER_MODE_LABEL[mode]}
              </button>
            ))}
          </div>
          <AudioVisualizer
            mode={vizMode}
            height={120}
            className="w-full rounded-box"
            colorTheme="primary"

            // This view owns `vizMode` and renders its own switcher above,
            // so the visualizer must be controlled — otherwise a canvas
            // click and this switcher fight over two separate copies of
            // the mode (see AudioVisualizer's `onModeChange` doc comment).
            onModeChange={onModeChange}
            // Master FX is the only tab that renders this visualizer;
            // App.tsx keeps the tab mounted while hidden, so gate the
            // rAF loop on the active tab to avoid burning CPU off-screen.
            paused={paused}
          />
        </div>
      </PanelCard>
    </section>
  );
}

export const EffectsRackView = React.memo(function EffectsRackView() {
  const effects = useAppStore((s) => s.effects);
  const setEffects = useAppStore((s) => s.setEffects);
  const activeTab = useAppStore((s) => s.activeTab);
  const [vizMode, setVizMode] = React.useState<VisualizerMode>("wave");

  const updateFx = (updates: Partial<MasterEffects>) => {
    // Engine mirror happens via useEngineSync (one render later)
    setEffects({ ...effects, ...updates });
  };

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      <ViewHeader view="master" />

      <FxChain effects={effects} updateFx={updateFx} />

      <MasterDynamicsSection effects={effects} updateFx={updateFx} />

      <MonitorSection
        vizMode={vizMode}
        onModeChange={setVizMode}
        paused={activeTab !== "master"}
      />
    </div>
  );
});

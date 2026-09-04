import React from "react";
import { Waves, Activity, Sparkles, Sliders } from "lucide-react";
import { MasterEffects } from "../../types";
import { useAppStore } from "../../store/store";
import { Knob } from "../ui/Knob";
import { PowerToggle } from "../ui/PowerToggle";
import { ViewHeader } from "../ui/ViewHeader";
import { ModuleHeader } from "../ui/ModuleHeader";
import { PanelCard } from "../ui/PanelCard";
import { SECTION_HEADER } from "../ui/fieldClasses";
import { AudioVisualizer, VISUALIZER_MODES, VISUALIZER_MODE_LABEL, type VisualizerMode } from "../AudioVisualizer";
import {
  delayFeedbackDescriptor,
  distortionDriveDescriptor,
  reverbDecayDescriptor,
} from "../fxDescriptors";

export const EffectsRackView: React.FC = React.memo(() => {
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
      <ViewHeader view="effects" />

      <section className="space-y-2">
        <h3 className={`${SECTION_HEADER} px-1`}>
          FX Chain
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* 1. Algorithmic Reverb Unit */}
          <div
            className={`card bg-panel border shadow-md transition-all ${
              effects.reverbBypass
                ? "border-base-300 opacity-60"
                : "border-accent/40 ring-1 ring-accent/20"
            }`}
          >
            <div className="card-body p-3 sm:p-4 space-y-3">
              <ModuleHeader
                badge={1}
                icon={<Waves className="w-3.5 h-3.5 text-accent" />}
                title="Space Reverb"
                right={
                  <PowerToggle
                    id="btn-bypass-reverb"
                    on={!effects.reverbBypass}
                    onToggle={() => updateFx({ reverbBypass: !effects.reverbBypass })}
                    name="Reverb"
                    tone="accent"
                    size="xs"
                    iconOnly
                  />
                }
              />

              <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
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
              </div>
            </div>
          </div>

          {/* 2. Stereo Delay Unit */}
          <div
            className={`card bg-panel border shadow-md transition-all ${
              effects.delayBypass
                ? "border-base-300 opacity-60"
                : "border-accent/40 ring-1 ring-accent/20"
            }`}
          >
            <div className="card-body p-3 sm:p-4 space-y-3">
              <ModuleHeader
                badge={2}
                icon={<Activity className="w-3.5 h-3.5 text-accent" />}
                title="Stereo Echo"
                right={
                  <PowerToggle
                    id="btn-bypass-delay"
                    on={!effects.delayBypass}
                    onToggle={() => updateFx({ delayBypass: !effects.delayBypass })}
                    name="Delay"
                    tone="accent"
                    size="xs"
                    iconOnly
                  />
                }
              />

              <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
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
              </div>
            </div>
          </div>

          {/* 3. Wave Distortion / Warmth Unit */}
          <div
            className={`card bg-panel border shadow-md transition-all ${
              effects.distortionBypass
                ? "border-base-300 opacity-60"
                : "border-primary/40 ring-1 ring-primary/20"
            }`}
          >
            <div className="card-body p-3 sm:p-4 space-y-3">
              <ModuleHeader
                badge={3}
                icon={<Sparkles className="w-3.5 h-3.5 text-primary" />}
                title="Distortion"
                right={
                  <PowerToggle
                    id="btn-bypass-distortion"
                    on={!effects.distortionBypass}
                    onToggle={() =>
                      updateFx({ distortionBypass: !effects.distortionBypass })
                    }
                    name="Distortion"
                    tone="accent"
                    size="xs"
                    iconOnly
                  />
                }
              />

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
            </div>
          </div>

          {/* 4. 3-Band Equalizer */}
          <div
            className={`card bg-panel border shadow-md transition-all ${
              effects.eqBypass
                ? "border-base-300 opacity-60"
                : "border-secondary/40 ring-1 ring-secondary/20"
            }`}
          >
            <div className="card-body p-3 sm:p-4 space-y-3">
              <ModuleHeader
                badge={4}
                icon={<Sliders className="w-3.5 h-3.5 text-secondary" />}
                title="3-Band EQ"
                right={
                  <PowerToggle
                    id="btn-bypass-eq"
                    on={!effects.eqBypass}
                    onToggle={() => updateFx({ eqBypass: !effects.eqBypass })}
                    name="Equalizer"
                    tone="accent"
                    size="xs"
                    iconOnly
                  />
                }
              />

              <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
                <Knob
                  id="slider-eq-low"
                  label="LOW"
                  color="text-secondary"
                  value={effects.eqLow}
                  min={-15}
                  max={15}
                  step={1}
                  detent={0}
                  disabled={effects.eqBypass}
                  format={(v) => `${v > 0 ? `+${v}` : v}dB`}
                  onChange={(v) => updateFx({ eqLow: v })}
                />

                <Knob
                  id="slider-eq-mid"
                  label="MID"
                  color="text-secondary"
                  value={effects.eqMid}
                  min={-15}
                  max={15}
                  step={1}
                  detent={0}
                  disabled={effects.eqBypass}
                  format={(v) => `${v > 0 ? `+${v}` : v}dB`}
                  onChange={(v) => updateFx({ eqMid: v })}
                />

                <Knob
                  id="slider-eq-high"
                  label="HIGH"
                  color="text-secondary"
                  value={effects.eqHigh}
                  min={-15}
                  max={15}
                  step={1}
                  detent={0}
                  disabled={effects.eqBypass}
                  format={(v) => `${v > 0 ? `+${v}` : v}dB`}
                  onChange={(v) => updateFx({ eqHigh: v })}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className={`${SECTION_HEADER} px-1`}>
          Monitor
        </h3>
        <PanelCard>
          <div className="card-body p-3 sm:p-4 gap-3">
            <div className="join self-start">
              {VISUALIZER_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setVizMode(mode)}
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
              onModeChange={setVizMode}
              // Master FX is the only tab that renders this visualizer;
              // App.tsx keeps the tab mounted while hidden, so gate the
              // rAF loop on the active tab to avoid burning CPU off-screen.
              paused={activeTab !== "effects"}
            />
          </div>
        </PanelCard>
      </section>
    </div>
  );
});

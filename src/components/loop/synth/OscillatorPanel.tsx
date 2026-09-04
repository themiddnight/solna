import React from "react";
import { Activity } from "lucide-react";
import { Knob } from "../../ui/Knob";
import { ModuleHeader } from "../../ui/ModuleHeader";
import { PanelCard } from "../../ui/PanelCard";
import { FIELD_LABEL } from "../../ui/fieldClasses";
import { useSynthChannel } from "./useSynthChannel";

/**
 * Pro-Mode panel — Oscillators. Reads the active synth channel from the
 * store rather than taking props, so SynthView renders `<OscillatorPanel />`
 * with no wiring. Its identity colour is `module-osc` (docs/design.md
 * §6.5); the token is named in the class strings that moved with the markup.
 */
export const OscillatorPanel: React.FC = () => {
  const { params, onChangeParams, tintClass } = useSynthChannel();
  // 1. Oscillators Section
  return (
          <PanelCard tint={tintClass} className="flex-1">
            <div className="card-body p-4 space-y-3.5">
            <ModuleHeader
              badge={1}
              icon={<Activity className="w-3.5 h-3.5 text-module-osc" />}
              title="Oscillators"
            />

            <div>
              <span className={FIELD_LABEL} id="label-osc-wave">
                Waveform
              </span>
              <div className="grid grid-cols-4 gap-1" role="group" aria-labelledby="label-osc-wave">
                {(["sawtooth", "square", "sine", "triangle"] as const).map(
                  (w) => (
                    <button
                      key={w}
                      id={`btn-wave-${w}`}
                      onClick={() => onChangeParams({ ...params, oscType: w })}
                      className={`btn btn-xs text-[11px] font-semibold capitalize ${
                        params.oscType === w
                          ? "[--btn-color:var(--color-module-osc)] [--btn-fg:var(--color-module-osc-content)]"
                          : "btn-ghost border border-base-300 text-base-content/60"
                      }`}
                    >
                      {w.slice(0, 4)}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="flex items-start justify-between gap-2">
              <Knob
                id="slider-sub-osc"
                label="Sub-Osc"
                color="text-module-osc"
                value={params.subOscVolume}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => onChangeParams({ ...params, subOscVolume: v })}
              />

              <Knob
                id="slider-detune"
                label="Detune"
                color="text-module-osc"
                value={params.detune}
                min={0}
                max={50}
                step={1}
                format={(v) => `${v} ct`}
                onChange={(v) => onChangeParams({ ...params, detune: v })}
              />

              <Knob
                id="slider-noise"
                label="Noise"
                color="text-module-osc"
                value={params.noiseVolume}
                min={0}
                max={0.5}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => onChangeParams({ ...params, noiseVolume: v })}
              />
            </div>
            </div>
          </PanelCard>
  );
};

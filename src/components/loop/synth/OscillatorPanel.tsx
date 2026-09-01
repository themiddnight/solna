import React from "react";
import { Activity } from "lucide-react";
import { Knob } from "../../ui/Knob";
import { STEP_BADGE } from "../../ui/fieldClasses";
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
          <div
            className={`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                <span className={STEP_BADGE}>1</span>
                <Activity className="w-3.5 h-3.5 text-module-osc" />
                Oscillators
              </span>
            </div>

            <div>
              <label className="text-xs text-base-content/60 block mb-1.5 font-medium">
                Waveform
              </label>
              <div className="grid grid-cols-4 gap-1">
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
          </div>
  );
};

import React from "react";
import { Activity } from "lucide-react";
import { Knob } from "../../ui/Knob";
import { STEP_BADGE } from "../../ui/fieldClasses";
import { useSynthChannel } from "./useSynthChannel";

/**
 * Pro-Mode panel — LFO and master pitch. Reads the active synth channel from
 * the store rather than taking props, so SynthView renders `<LfoPanel />`
 * with no wiring. Its identity colour is `module-lfo` (docs/design.md
 * §6.5); the token is named in the class strings that moved with the markup.
 */
export const LfoPanel: React.FC = () => {
  const { params, onChangeParams, tintClass } = useSynthChannel();
  // 4. LFO & Master Pitch
  return (
          <div
            className={`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                <span className={STEP_BADGE}>4</span>
                <Activity className="w-3.5 h-3.5 text-module-lfo" />
                LFO & Octave
              </span>
            </div>

            <div>
              <label className="text-xs text-base-content/60 block mb-1.5 font-medium">
                LFO Destination
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(["cutoff", "pitch", "volume"] as const).map((t) => (
                  <button
                    key={t}
                    id={`btn-lfo-target-${t}`}
                    onClick={() => onChangeParams({ ...params, lfoTarget: t })}
                    className={`btn btn-xs text-[11px] font-semibold capitalize ${
                      params.lfoTarget === t
                        ? "[--btn-color:var(--color-module-lfo)] [--btn-fg:var(--color-module-lfo-content)]"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start justify-around gap-2">
              <Knob
                id="slider-lfo-rate"
                label="LFO Rate"
                color="text-module-lfo"
                value={params.lfoRate}
                min={0.1}
                max={20}
                step={0.1}
                format={(v) => `${v.toFixed(1)} Hz`}
                onChange={(v) => onChangeParams({ ...params, lfoRate: v })}
              />

              <Knob
                id="slider-lfo-depth"
                label="LFO Depth"
                color="text-module-lfo"
                value={params.lfoDepth}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => onChangeParams({ ...params, lfoDepth: v })}
              />
            </div>

            <div className="pt-1 flex items-center justify-between">
              <span className="text-xs text-base-content/60">Octave Pitch</span>
              <div className="flex items-center gap-1">
                {([-2, -1, 0, 1, 2] as const).map((oct) => (
                  <button
                    key={oct}
                    id={`btn-octave-${oct}`}
                    onClick={() => onChangeParams({ ...params, octave: oct })}
                    className={`btn btn-xs btn-square w-6 h-6 min-h-0 text-xs tabular-nums font-bold ${
                      params.octave === oct
                        ? "[--btn-color:var(--color-module-lfo)] [--btn-fg:var(--color-module-lfo-content)]"
                        : "btn-ghost border border-base-300 text-base-content/60 hover:text-base-content"
                    }`}
                  >
                    {oct > 0 ? `+${oct}` : oct}
                  </button>
                ))}
              </div>
            </div>
            </div>
          </div>
  );
};

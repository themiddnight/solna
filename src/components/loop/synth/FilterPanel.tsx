import React from "react";
import { Sliders } from "lucide-react";
import { Knob } from "../../ui/Knob";
import { ModuleHeader } from "../../ui/ModuleHeader";
import { PanelCard } from "../../ui/PanelCard";
import { FIELD_LABEL } from "../../ui/fieldClasses";
import { useSynthChannel } from "./useSynthChannel";

/**
 * Pro-Mode panel — Filter. Reads the active synth channel from the store
 * rather than taking props, so SynthView renders `<FilterPanel />` with no
 * wiring. Its identity colour is `module-filter` (docs/design.md §6.5); the
 * token is named in the class strings that moved with the markup.
 */
export const FilterPanel: React.FC = () => {
  const { params, onChangeParams, tintClass } = useSynthChannel();
  // 2. Filter Section
  return (
          <PanelCard tint={tintClass} className="flex-1">
            <div className="card-body p-4 space-y-3.5">
            <ModuleHeader
              badge={2}
              icon={<Sliders className="w-3.5 h-3.5 text-module-filter" />}
              title="VCF Filter"
            />

            <div>
              <span className={FIELD_LABEL} id="label-filter-type">
                Filter Type
              </span>
              <div className="grid grid-cols-3 gap-1" role="group" aria-labelledby="label-filter-type">
                {(["lowpass", "bandpass", "highpass"] as const).map((t) => (
                  <button
                    key={t}
                    id={`btn-filter-${t}`}
                    onClick={() => onChangeParams({ ...params, filterType: t })}
                    className={`btn btn-xs text-[11px] font-semibold uppercase ${
                      params.filterType === t
                        ? "[--btn-color:var(--color-module-filter)] [--btn-fg:var(--color-module-filter-content)]"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
                  >
                    {t === "lowpass" ? "LPF" : t === "bandpass" ? "BPF" : "HPF"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start justify-between gap-2">
              <Knob
                id="slider-filter-cutoff"
                label="Cutoff"
                color="text-module-filter"
                value={params.filterCutoff}
                min={50}
                max={12000}
                step={10}
                scale="log"
                format={(v) => `${Math.round(v)} Hz`}
                onChange={(v) => onChangeParams({ ...params, filterCutoff: v })}
              />

              <Knob
                id="slider-filter-resonance"
                label="Resonance"
                color="text-module-filter"
                value={params.filterResonance}
                min={0.1}
                max={20}
                step={0.1}
                scale="linear"
                format={(v) => v.toFixed(1)}
                onChange={(v) =>
                  onChangeParams({ ...params, filterResonance: v })
                }
              />

              <Knob
                id="slider-filter-env"
                label="Env Mod"
                color="text-module-filter"
                value={params.filterEnvAmount}
                min={0}
                max={6000}
                step={50}
                scale="linear"
                format={(v) => `+${Math.round(v)} Hz`}
                onChange={(v) =>
                  onChangeParams({ ...params, filterEnvAmount: v })
                }
              />
            </div>
            </div>
          </PanelCard>
  );
};

import React from "react";
import { Volume2 } from "lucide-react";
import { Knob } from "../../ui/Knob";
import { ModuleHeader } from "../../ui/ModuleHeader";
import { PanelCard } from "../../ui/PanelCard";
import { useSynthChannel } from "./useSynthChannel";

/**
 * Pro-Mode panel — Envelopes (amp and filter ADSR). Reads the active synth
 * channel from the store rather than taking props, so SynthView renders
 * `<EnvelopePanel />` with no wiring. Its two halves carry the
 * `module-env-vca` and `module-env-vcf` identity colours (docs/design.md
 * §6.5); the tokens are named in the class strings that moved with the
 * markup.
 */
export const EnvelopePanel: React.FC = () => {
  const { params, onChangeParams, tintClass } = useSynthChannel();
  // 3. Envelope ADSR
  return (
          <PanelCard tint={tintClass} className="flex-1">
            <div className="card-body p-4 space-y-3">
            <ModuleHeader
              badge={3}
              icon={<Volume2 className="w-3.5 h-3.5 text-module-env-vca" />}
              title="ADSR Envelope"
            />

            {/* AMP / VCA */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] text-module-env-vca uppercase tracking-wider">
                  AMP / VCA
                </span>
                <span className="flex-1 h-px bg-base-300" />
              </div>
              <div className="flex items-start justify-around gap-2">
                {/* Attack */}
                <Knob
                  id="slider-env-attack"
                  label="ATT"
                  color="text-module-env-vca"
                  value={params.attack}
                  min={0.005}
                  max={2.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) => onChangeParams({ ...params, attack: v })}
                />

                {/* Decay */}
                <Knob
                  id="slider-env-decay"
                  label="DEC"
                  color="text-module-env-vca"
                  value={params.decay}
                  min={0.01}
                  max={2.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) => onChangeParams({ ...params, decay: v })}
                />

                {/* Sustain */}
                <Knob
                  id="slider-env-sustain"
                  label="SUS"
                  color="text-module-env-vca"
                  value={params.sustain}
                  min={0}
                  max={1.0}
                  step={0.01}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) => onChangeParams({ ...params, sustain: v })}
                />

                {/* Release */}
                <Knob
                  id="slider-env-release"
                  label="REL"
                  color="text-module-env-vca"
                  value={params.release}
                  min={0.01}
                  max={3.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) => onChangeParams({ ...params, release: v })}
                />
              </div>
            </div>

            {/* FILTER / VCF */}
            <div className="pt-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] text-module-env-vcf uppercase tracking-wider">
                  FILTER / VCF
                </span>
                <span className="flex-1 h-px bg-base-300" />
              </div>
              <div className="flex items-start justify-around">
                {/* Filter Attack */}
                <Knob
                  id="slider-env-filter-attack"
                  label="ATT"
                  color="text-module-env-vcf"
                  value={params.filterAttack}
                  min={0.005}
                  max={2.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) =>
                    onChangeParams({ ...params, filterAttack: v })
                  }
                />

                {/* Filter Decay */}
                <Knob
                  id="slider-env-filter-decay"
                  label="DEC"
                  color="text-module-env-vcf"
                  value={params.filterDecay}
                  min={0.01}
                  max={2.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) =>
                    onChangeParams({ ...params, filterDecay: v })
                  }
                />

                {/* Filter Sustain */}
                <Knob
                  id="slider-env-filter-sustain"
                  label="SUS"
                  color="text-module-env-vcf"
                  value={params.filterSustain}
                  min={0}
                  max={1.0}
                  step={0.01}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) =>
                    onChangeParams({ ...params, filterSustain: v })
                  }
                />

                {/* Filter Release */}
                <Knob
                  id="slider-env-filter-release"
                  label="REL"
                  color="text-module-env-vcf"
                  value={params.filterRelease}
                  min={0.01}
                  max={3.0}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) =>
                    onChangeParams({ ...params, filterRelease: v })
                  }
                />
              </div>
            </div>
            </div>
          </PanelCard>
  );
};

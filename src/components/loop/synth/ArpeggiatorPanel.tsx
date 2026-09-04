import React from "react";
import { Sparkles } from "lucide-react";
import { ModuleHeader } from "../../ui/ModuleHeader";
import { PanelCard } from "../../ui/PanelCard";
import { FIELD_LABEL } from "../../ui/fieldClasses";
import { initSynthPlayback } from "../../../audio/playback/synthPlayback";
import { useSynthChannel } from "./useSynthChannel";

/**
 * Pro-Mode panel — Arpeggiator. Reads the active synth channel from the
 * store rather than taking props, so SynthView renders `<ArpeggiatorPanel />`
 * with no wiring. Its identity colour is `module-arp` (docs/design.md
 * §6.5); the token is named in the class strings that moved with the markup.
 */
export const ArpeggiatorPanel: React.FC = () => {
  const { params, onChangeParams, tintClass } = useSynthChannel();
  // 5. Arpeggiator
  return (
          <PanelCard tint={tintClass} className="flex-1">
            <div className="card-body p-4 space-y-3.5">
            <ModuleHeader
              badge={5}
              icon={<Sparkles className="w-3.5 h-3.5 text-module-arp" />}
              title="Arpeggiator"
              right={
                <button
                  id="btn-toggle-arp"
                  onClick={() => {
                    initSynthPlayback();
                    onChangeParams({
                      ...params,
                      arpActive: !params.arpActive,
                    });
                  }}
                  className={`btn btn-xs text-[10px] font-bold uppercase tracking-wider ${
                    params.arpActive
                      ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)] shadow-md shadow-module-arp/30"
                      : "btn-ghost border border-base-300 text-base-content/60"
                  }`}
                >
                  {params.arpActive ? "Active" : "Bypass"}
                </button>
              }
            />

            <div>
              <span className={FIELD_LABEL} id="label-arp-mode">
                Arp Mode
              </span>
              <div className="grid grid-cols-4 gap-1" role="group" aria-labelledby="label-arp-mode">
                {(["up", "down", "updown", "random"] as const).map((m) => (
                  <button
                    key={m}
                    id={`btn-arp-mode-${m}`}
                    onClick={() => onChangeParams({ ...params, arpMode: m })}
                    className={`btn btn-xs text-[10px] font-semibold capitalize ${
                      params.arpMode === m
                        ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
                  >
                    {m === "updown" ? "Up/Dn" : m}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className={FIELD_LABEL} id="label-arp-rate">
                  Rate
                </span>
                <div className="flex gap-1" role="group" aria-labelledby="label-arp-rate">
                  {(["16n", "8n", "32n"] as const).map((r) => (
                    <button
                      key={r}
                      id={`btn-arp-rate-${r}`}
                      onClick={() => onChangeParams({ ...params, arpRate: r })}
                      className={`btn btn-xs text-[11px] font-mono font-semibold ${
                        params.arpRate === r
                          ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]"
                          : "btn-ghost border border-base-300 text-base-content/60"
                      }`}
                    >
                      {r === "16n" ? "1/16" : r === "8n" ? "1/8" : "1/32"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className={FIELD_LABEL} id="label-arp-octaves">
                  Octaves
                </span>
                <div className="flex gap-1" role="group" aria-labelledby="label-arp-octaves">
                  {[1, 2, 3].map((oct) => (
                    <button
                      key={oct}
                      id={`btn-arp-octave-${oct}`}
                      onClick={() =>
                        onChangeParams({ ...params, arpOctaves: oct })
                      }
                      className={`btn btn-xs w-7 min-h-0 text-xs tabular-nums font-bold ${
                        params.arpOctaves === oct
                          ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]"
                          : "btn-ghost border border-base-300 text-base-content/60"
                      }`}
                    >
                      +{oct}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            </div>
          </PanelCard>
  );
};

import React from "react";
import { Sparkles, Sun, Flame, Waves, Compass } from "lucide-react";
import { SynthParams } from "../../types";
import { Knob } from "../ui/Knob";

interface SimpleSynthPanelProps {
  params: SynthParams;
  onChangeParams: (params: SynthParams) => void;
  /** Target tint (chord/bass) from SynthView's TARGET_STYLES; "" for the main synth. */
  tintClass?: string;
}

export const SimpleSynthPanel: React.FC<SimpleSynthPanelProps> = React.memo(
  ({ params, onChangeParams, tintClass = "" }) => {
    // Macro 1: Tone (Brightness) -> Cutoff
    const cutoffValue = params.filterCutoff ?? 4000;
    const toneLabel =
      cutoffValue < 1800
        ? "Deep & Warm"
        : cutoffValue < 5500
          ? "Balanced Tone"
          : "Bright & Crisp";

    // Macro 2: Space (Release / Tail) -> Release & Sustain
    const releaseValue = params.release ?? 0.3;
    const spaceLabel =
      releaseValue < 0.18
        ? "Tight & Punchy"
        : releaseValue < 0.8
          ? "Natural Tail"
          : "Lush & Dreamy";

    // Macro 3: Vibe (Movement / Detune) -> Detune
    const detuneValue = params.detune ?? 10;
    const vibeLabel =
      detuneValue < 8
        ? "Clean & Solid"
        : detuneValue < 25
          ? "Stereo Shimmer"
          : "Wavy & Lush";

    // Macro 4: Punch (Attack & Sub Power) -> Sub-Osc & Attack
    const subValue = params.subOscVolume ?? 0.2;
    const punchLabel =
      subValue < 0.15
        ? "Smooth / Light"
        : subValue < 0.5
          ? "Balanced Punch"
          : "Heavy Sub Power";

    return (
      <div className="space-y-4">
        {/* 2. Four Friendly Macro Dials + 1-Click Arp */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Macro 1: Tone (Brightness) */}
          <div className={`card bg-panel border border-base-300 shadow-md ${tintClass}`}>
            <div className="card-body p-3 flex flex-col items-center justify-between text-center">
              <div className="flex items-center gap-1 text-xs font-bold text-base-content">
                <Sun className="w-3.5 h-3.5 text-module-filter" />
                <span>Tone</span>
              </div>

              <div className="my-1.5">
                <Knob
                  id="simple-macro-tone"
                  label=""
                  color="text-module-filter"
                  descriptor={toneLabel}
                  value={cutoffValue}
                  min={300}
                  max={12000}
                  step={50}
                  format={(v) => `${(v / 1000).toFixed(1)}k`}
                  onChange={(v) => onChangeParams({ ...params, filterCutoff: v })}
                />
              </div>
            </div>
          </div>

          {/* Macro 2: Space (Release & Tail) */}
          <div className={`card bg-panel border border-base-300 shadow-md ${tintClass}`}>
            <div className="card-body p-3 flex flex-col items-center justify-between text-center">
              <div className="flex items-center gap-1 text-xs font-bold text-base-content">
                <Compass className="w-3.5 h-3.5 text-module-env-vca" />
                <span>Space</span>
              </div>

              <div className="my-1.5">
                <Knob
                  id="simple-macro-space"
                  label=""
                  color="text-module-env-vca"
                  descriptor={spaceLabel}
                  value={releaseValue}
                  min={0.05}
                  max={2.5}
                  step={0.05}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) =>
                    onChangeParams({
                      ...params,
                      release: v,
                      sustain: Math.min(1.0, Math.max(0.2, v * 0.4 + 0.3)),
                    })
                  }
                />
              </div>
            </div>
          </div>

          {/* Macro 3: Vibe (Movement & Detune) */}
          <div className={`card bg-panel border border-base-300 shadow-md ${tintClass}`}>
            <div className="card-body p-3 flex flex-col items-center justify-between text-center">
              <div className="flex items-center gap-1 text-xs font-bold text-base-content">
                <Waves className="w-3.5 h-3.5 text-module-lfo" />
                <span>Vibe</span>
              </div>

              <div className="my-1.5">
                <Knob
                  id="simple-macro-vibe"
                  label=""
                  color="text-module-lfo"
                  descriptor={vibeLabel}
                  value={detuneValue}
                  min={0}
                  max={50}
                  step={1}
                  format={(v) => `${v} ct`}
                  onChange={(v) =>
                    onChangeParams({
                      ...params,
                      detune: v,
                      lfoDepth: v > 15 ? 0.2 : 0.05,
                    })
                  }
                />
              </div>
            </div>
          </div>

          {/* Macro 4: Punch (Sub & Power) */}
          <div className={`card bg-panel border border-base-300 shadow-md ${tintClass}`}>
            <div className="card-body p-3 flex flex-col items-center justify-between text-center">
              <div className="flex items-center gap-1 text-xs font-bold text-base-content">
                <Flame className="w-3.5 h-3.5 text-module-osc" />
                <span>Punch</span>
              </div>

              <div className="my-1.5">
                <Knob
                  id="simple-macro-punch"
                  label=""
                  color="text-module-osc"
                  descriptor={punchLabel}
                  value={subValue}
                  min={0}
                  max={1}
                  step={0.02}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) =>
                    onChangeParams({
                      ...params,
                      subOscVolume: v,
                      attack: v > 0.4 ? 0.01 : Math.max(0.01, params.attack),
                    })
                  }
                />
              </div>
            </div>
          </div>

          {/* 1-Click Easy Arpeggiator Card */}
          <div
            className={`col-span-2 sm:col-span-1 lg:col-span-1 card bg-panel border border-module-arp/30 shadow-md ${tintClass}`}
          >
            <div className="card-body p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-base-300 pb-1.5">
                <span className="text-xs font-bold text-module-arp flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-module-arp" />
                  Auto-Arp
                </span>
                <button
                  id="btn-simple-toggle-arp"
                  onClick={() => {
                    onChangeParams({
                      ...params,
                      arpActive: !params.arpActive,
                    });
                  }}
                  className={`btn btn-xs rounded-full text-[10px] font-bold uppercase ${
                    params.arpActive ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]" : "btn-outline"
                  }`}
                >
                  {params.arpActive ? "ON" : "OFF"}
                </button>
              </div>

              {/* Arp Speed Selector */}
              <div className="space-y-1 my-1.5">
                <div className="flex items-center justify-between text-[10px] text-base-content/60">
                  <span>Speed:</span>
                  <span className="font-mono text-module-arp font-bold">
                    {params.arpRate === "8n"
                      ? "1/8"
                      : params.arpRate === "32n"
                        ? "1/32"
                        : "1/16"}
                  </span>
                </div>
                <div className="join w-full">
                  {(["8n", "16n", "32n"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => onChangeParams({ ...params, arpRate: r })}
                      className={`btn join-item btn-xs flex-1 text-[10px] font-semibold ${
                        params.arpRate === r
                          ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]"
                          : "btn-outline"
                      }`}
                    >
                      {r === "8n" ? "1/8" : r === "16n" ? "1/16" : "1/32"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Arp Style Selector */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-base-content/60">
                  <span>Mode:</span>
                  <span className="capitalize text-module-arp font-bold">
                    {params.arpMode}
                  </span>
                </div>
                <div className="join w-full">
                  {(["up", "down", "updown", "random"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => onChangeParams({ ...params, arpMode: m })}
                      className={`btn join-item btn-xs flex-1 text-[10px] font-semibold ${
                        params.arpMode === m
                          ? "[--btn-color:var(--color-module-arp)] [--btn-fg:var(--color-module-arp-content)]"
                          : "btn-outline"
                      }`}
                      title={`Mode: ${m}`}
                    >
                      {m === "up"
                        ? "↑"
                        : m === "down"
                          ? "↓"
                          : m === "updown"
                            ? "⇅"
                            : "🎲"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

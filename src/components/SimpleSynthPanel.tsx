import React from "react";
import { Sparkles, Sun, Flame, Waves, Compass } from "lucide-react";
import { SynthParams } from "../types";
import { Knob } from "./ui/Knob";

interface SimpleSynthPanelProps {
  params: SynthParams;
  onChangeParams: (params: SynthParams) => void;
}

export const SimpleSynthPanel: React.FC<SimpleSynthPanelProps> = React.memo(
  ({ params, onChangeParams }) => {
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
          <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 flex flex-col items-center justify-between text-center shadow-md">
            <div className="flex items-center gap-1 text-xs font-bold text-slate-200">
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>Tone</span>
            </div>

            <div className="my-1.5">
              <Knob
                id="simple-macro-tone"
                label=""
                color="text-amber-400"
                value={cutoffValue}
                min={300}
                max={12000}
                step={50}
                format={(v) => `${(v / 1000).toFixed(1)}k`}
                onChange={(v) => onChangeParams({ ...params, filterCutoff: v })}
              />
            </div>

            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
              {toneLabel}
            </span>
          </div>

          {/* Macro 2: Space (Release & Tail) */}
          <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 flex flex-col items-center justify-between text-center shadow-md">
            <div className="flex items-center gap-1 text-xs font-bold text-slate-200">
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span>Space</span>
            </div>

            <div className="my-1.5">
              <Knob
                id="simple-macro-space"
                label=""
                color="text-cyan-400"
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

            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
              {spaceLabel}
            </span>
          </div>

          {/* Macro 3: Vibe (Movement & Detune) */}
          <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 flex flex-col items-center justify-between text-center shadow-md">
            <div className="flex items-center gap-1 text-xs font-bold text-slate-200">
              <Waves className="w-3.5 h-3.5 text-pink-400" />
              <span>Vibe</span>
            </div>

            <div className="my-1.5">
              <Knob
                id="simple-macro-vibe"
                label=""
                color="text-pink-400"
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

            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-300 border border-pink-500/20">
              {vibeLabel}
            </span>
          </div>

          {/* Macro 4: Punch (Sub & Power) */}
          <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 flex flex-col items-center justify-between text-center shadow-md">
            <div className="flex items-center gap-1 text-xs font-bold text-slate-200">
              <Flame className="w-3.5 h-3.5 text-emerald-400" />
              <span>Punch</span>
            </div>

            <div className="my-1.5">
              <Knob
                id="simple-macro-punch"
                label=""
                color="text-emerald-400"
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

            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              {punchLabel}
            </span>
          </div>

          {/* 1-Click Easy Arpeggiator Card */}
          <div className="col-span-2 sm:col-span-1 lg:col-span-1 bg-[#12152A] border border-purple-500/30 rounded-xl p-3 flex flex-col justify-between shadow-md">
            <div className="flex items-center justify-between border-b border-[#252B48] pb-1.5">
              <span className="text-xs font-bold text-purple-300 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
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
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase transition-all cursor-pointer ${
                  params.arpActive
                    ? "bg-purple-600 text-white shadow-xs"
                    : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                }`}
              >
                {params.arpActive ? "ON" : "OFF"}
              </button>
            </div>

            {/* Arp Speed Selector */}
            <div className="space-y-1 my-1.5">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>Speed:</span>
                <span className="font-mono text-purple-300 font-bold">
                  {params.arpRate === "8n"
                    ? "1/8"
                    : params.arpRate === "32n"
                      ? "1/32"
                      : "1/16"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(["8n", "16n", "32n"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => onChangeParams({ ...params, arpRate: r })}
                    className={`py-0.5 text-[10px] font-semibold rounded transition-all cursor-pointer ${
                      (params.arpRate ?? "16n") === r
                        ? "bg-purple-600 text-white shadow-xs"
                        : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                    }`}
                  >
                    {r === "8n" ? "1/8" : r === "16n" ? "1/16" : "1/32"}
                  </button>
                ))}
              </div>
            </div>

            {/* Arp Style Selector */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>Mode:</span>
                <span className="capitalize font-mono text-purple-300 font-bold">
                  {params.arpMode ?? "up"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {(["up", "down", "updown", "random"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => onChangeParams({ ...params, arpMode: m })}
                    className={`py-0.5 text-[10px] font-semibold rounded transition-all cursor-pointer ${
                      (params.arpMode ?? "up") === m
                        ? "bg-purple-600 text-white shadow-xs"
                        : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
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
    );
  },
);

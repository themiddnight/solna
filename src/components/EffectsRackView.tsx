import React from "react";
import { Sliders, Waves, Activity, Sparkles, Power } from "lucide-react";
import { MasterEffects } from "../types";
import { audioEngine } from "../audio/engine";

interface EffectsRackViewProps {
  effects: MasterEffects;
  onChangeEffects: (effects: MasterEffects) => void;
}

export const EffectsRackView: React.FC<EffectsRackViewProps> = React.memo(({
  effects,
  onChangeEffects,
}) => {
  const updateFx = (updates: Partial<MasterEffects>) => {
    const updated = { ...effects, ...updates };
    onChangeEffects(updated);
    audioEngine.updateEffects(updated);
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Top Header */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-400">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-100 flex items-center gap-2">
              Studio Master Effects Rack
            </h2>
            <p className="text-xs text-slate-400">
              Master bus processing with per-unit bypass and real-time DSP routing
            </p>
          </div>
        </div>
      </div>

      {/* Rack Units Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Algorithmic Reverb Unit */}
        <div
          className={`bg-[#12152A] border rounded-xl p-4 space-y-3.5 shadow-md transition-all ${
            effects.reverbBypass
              ? "border-[#252B48] opacity-60"
              : "border-cyan-500/40 ring-1 ring-cyan-500/20"
          }`}
        >
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Waves className="w-3.5 h-3.5 text-cyan-400" />
              1. Space Reverb
            </span>
            <button
              id="btn-bypass-reverb"
              onClick={() => updateFx({ reverbBypass: !effects.reverbBypass })}
              className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                effects.reverbBypass
                  ? "bg-slate-800 text-slate-400 border border-slate-700"
                  : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
              }`}
              title="Toggle Reverb Bypass"
            >
              <Power className="w-2.5 h-2.5" />
              {effects.reverbBypass ? "BYPASS" : "ON"}
            </button>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Wet / Dry Mix</span>
              <span className="font-mono text-cyan-300">
                {(effects.reverbWet * 100).toFixed(0)}%
              </span>
            </div>
            <input
              id="slider-reverb-wet"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={effects.reverbWet}
              disabled={effects.reverbBypass}
              onChange={(e) =>
                updateFx({ reverbWet: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-cyan-500 disabled:opacity-40"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Decay Time</span>
              <span className="font-mono text-cyan-300">
                {effects.reverbDecay.toFixed(1)}s
              </span>
            </div>
            <input
              id="slider-reverb-decay"
              type="range"
              min={0.5}
              max={6.0}
              step={0.1}
              value={effects.reverbDecay}
              disabled={effects.reverbBypass}
              onChange={(e) =>
                updateFx({ reverbDecay: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-cyan-500 disabled:opacity-40"
            />
          </div>
        </div>

        {/* 2. Stereo Delay Unit */}
        <div
          className={`bg-[#12152A] border rounded-xl p-4 space-y-3.5 shadow-md transition-all ${
            effects.delayBypass
              ? "border-[#252B48] opacity-60"
              : "border-indigo-500/40 ring-1 ring-indigo-500/20"
          }`}
        >
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              2. Stereo Echo Delay
            </span>
            <button
              id="btn-bypass-delay"
              onClick={() => updateFx({ delayBypass: !effects.delayBypass })}
              className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                effects.delayBypass
                  ? "bg-slate-800 text-slate-400 border border-slate-700"
                  : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
              }`}
              title="Toggle Delay Bypass"
            >
              <Power className="w-2.5 h-2.5" />
              {effects.delayBypass ? "BYPASS" : "ON"}
            </button>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Wet / Dry Mix</span>
              <span className="font-mono text-indigo-300">
                {(effects.delayWet * 100).toFixed(0)}%
              </span>
            </div>
            <input
              id="slider-delay-wet"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={effects.delayWet}
              disabled={effects.delayBypass}
              onChange={(e) =>
                updateFx({ delayWet: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-indigo-500 disabled:opacity-40"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Feedback Repeats</span>
              <span className="font-mono text-indigo-300">
                {(effects.delayFeedback * 100).toFixed(0)}%
              </span>
            </div>
            <input
              id="slider-delay-feedback"
              type="range"
              min={0}
              max={0.9}
              step={0.01}
              value={effects.delayFeedback}
              disabled={effects.delayBypass}
              onChange={(e) =>
                updateFx({ delayFeedback: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-indigo-500 disabled:opacity-40"
            />
          </div>
        </div>

        {/* 3. Wave Distortion / Warmth Unit */}
        <div
          className={`bg-[#12152A] border rounded-xl p-4 space-y-3.5 shadow-md transition-all ${
            effects.distortionBypass
              ? "border-[#252B48] opacity-60"
              : "border-amber-500/40 ring-1 ring-amber-500/20"
          }`}
        >
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              3. Tube Saturation
            </span>
            <button
              id="btn-bypass-distortion"
              onClick={() =>
                updateFx({ distortionBypass: !effects.distortionBypass })
              }
              className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                effects.distortionBypass
                  ? "bg-slate-800 text-slate-400 border border-slate-700"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
              }`}
              title="Toggle Tube Saturation Bypass"
            >
              <Power className="w-2.5 h-2.5" />
              {effects.distortionBypass ? "BYPASS" : "ON"}
            </button>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Drive / Crunch</span>
              <span className="font-mono text-amber-300">
                {(effects.distortionWet * 100).toFixed(0)}%
              </span>
            </div>
            <input
              id="slider-distortion-wet"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={effects.distortionWet}
              disabled={effects.distortionBypass}
              onChange={(e) =>
                updateFx({ distortionWet: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-amber-500 disabled:opacity-40"
            />
          </div>
        </div>

        {/* 4. 3-Band Equalizer */}
        <div
          className={`bg-[#12152A] border rounded-xl p-4 space-y-3.5 shadow-md transition-all ${
            effects.eqBypass
              ? "border-[#252B48] opacity-60"
              : "border-emerald-500/40 ring-1 ring-emerald-500/20"
          }`}
        >
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-emerald-400" />
              4. 3-Band Studio EQ
            </span>
            <button
              id="btn-bypass-eq"
              onClick={() => updateFx({ eqBypass: !effects.eqBypass })}
              className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                effects.eqBypass
                  ? "bg-slate-800 text-slate-400 border border-slate-700"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              }`}
              title="Toggle Equalizer Bypass"
            >
              <Power className="w-2.5 h-2.5" />
              {effects.eqBypass ? "BYPASS" : "ON"}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <span className="text-[10px] text-slate-400 block font-mono">
                LOW
              </span>
              <input
                id="slider-eq-low"
                type="range"
                min={-15}
                max={15}
                value={effects.eqLow}
                disabled={effects.eqBypass}
                onChange={(e) =>
                  updateFx({ eqLow: parseInt(e.target.value, 10) })
                }
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1 disabled:opacity-40"
              />
              <span className="text-[10px] font-mono text-emerald-300 block">
                {effects.eqLow > 0 ? `+${effects.eqLow}` : effects.eqLow}dB
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 block font-mono">
                MID
              </span>
              <input
                id="slider-eq-mid"
                type="range"
                min={-15}
                max={15}
                value={effects.eqMid}
                disabled={effects.eqBypass}
                onChange={(e) =>
                  updateFx({ eqMid: parseInt(e.target.value, 10) })
                }
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1 disabled:opacity-40"
              />
              <span className="text-[10px] font-mono text-emerald-300 block">
                {effects.eqMid > 0 ? `+${effects.eqMid}` : effects.eqMid}dB
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 block font-mono">
                HIGH
              </span>
              <input
                id="slider-eq-high"
                type="range"
                min={-15}
                max={15}
                value={effects.eqHigh}
                disabled={effects.eqBypass}
                onChange={(e) =>
                  updateFx({ eqHigh: parseInt(e.target.value, 10) })
                }
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1 disabled:opacity-40"
              />
              <span className="text-[10px] font-mono text-emerald-300 block">
                {effects.eqHigh > 0 ? `+${effects.eqHigh}` : effects.eqHigh}dB
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

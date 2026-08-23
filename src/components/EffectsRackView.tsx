import React from "react";
import { Sliders, Waves, Activity, Sparkles, Power } from "lucide-react";
import { MasterEffects } from "../types";
import { useAppStore } from "../store/store";
import { Knob } from "./ui/Knob";

export const EffectsRackView: React.FC = React.memo(() => {
  const effects = useAppStore((s) => s.effects);
  const setEffects = useAppStore((s) => s.setEffects);

  const updateFx = (updates: Partial<MasterEffects>) => {
    // Engine mirror happens via useEngineSync (one render later)
    setEffects({ ...effects, ...updates });
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

          <div className="flex items-start justify-between gap-2">
            <Knob
              id="slider-reverb-wet"
              label="Wet / Dry Mix"
              color="text-cyan-400"
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
              label="Decay Time"
              color="text-cyan-400"
              value={effects.reverbDecay}
              min={0.5}
              max={6.0}
              step={0.1}
              disabled={effects.reverbBypass}
              format={(v) => `${v.toFixed(1)}s`}
              onChange={(v) => updateFx({ reverbDecay: v })}
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

          <div className="flex items-start justify-between gap-2">
            <Knob
              id="slider-delay-wet"
              label="Wet / Dry Mix"
              color="text-indigo-400"
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
              label="Feedback Repeats"
              color="text-indigo-400"
              value={effects.delayFeedback}
              min={0}
              max={0.9}
              step={0.01}
              disabled={effects.delayBypass}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => updateFx({ delayFeedback: v })}
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

          <Knob
            id="slider-distortion-wet"
            label="Drive / Crunch"
            color="text-amber-400"
            value={effects.distortionWet}
            min={0}
            max={1}
            step={0.01}
            disabled={effects.distortionBypass}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => updateFx({ distortionWet: v })}
          />
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

          <div className="flex items-start justify-between gap-2">
            <Knob
              id="slider-eq-low"
              label="LOW"
              color="text-emerald-400"
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
              color="text-emerald-400"
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
              color="text-emerald-400"
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
  );
});

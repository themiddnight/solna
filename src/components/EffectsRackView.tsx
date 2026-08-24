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
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* Top Header */}
      <div className="bg-base-100 border border-base-300 rounded-xl p-3 sm:p-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-600 dark:text-purple-400">
            <Sliders className="w-4 h-4" />
          </div>
          <h2 className="font-bold text-sm sm:text-base text-base-content">
            Master Effects Rack
          </h2>
        </div>
      </div>

      {/* Rack Units Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Algorithmic Reverb Unit */}
        <div
          className={`bg-base-100 border rounded-xl p-3 sm:p-4 space-y-3 shadow-md transition-all ${
            effects.reverbBypass
              ? "border-base-300 opacity-60"
              : "border-cyan-500/40 ring-1 ring-cyan-500/20"
          }`}
        >
          <div className="flex items-center justify-between border-b border-base-300 pb-2">
            <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
              <Waves className="w-3.5 h-3.5 text-cyan-500" />
              1. Space Reverb
            </span>
            <button
              id="btn-bypass-reverb"
              onClick={() => updateFx({ reverbBypass: !effects.reverbBypass })}
              className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                effects.reverbBypass
                  ? "bg-base-200 text-base-content/50 border border-base-300"
                  : "bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40"
              }`}
              title="Toggle Reverb Bypass"
            >
              <Power className="w-2.5 h-2.5" />
              {effects.reverbBypass ? "BYPASS" : "ON"}
            </button>
          </div>

          <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
            <Knob
              id="slider-reverb-wet"
              label="Mix"
              color="text-cyan-500"
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
              label="Decay"
              color="text-cyan-500"
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
          className={`bg-base-100 border rounded-xl p-3 sm:p-4 space-y-3 shadow-md transition-all ${
            effects.delayBypass
              ? "border-base-300 opacity-60"
              : "border-indigo-500/40 ring-1 ring-indigo-500/20"
          }`}
        >
          <div className="flex items-center justify-between border-b border-base-300 pb-2">
            <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-500" />
              2. Stereo Echo
            </span>
            <button
              id="btn-bypass-delay"
              onClick={() => updateFx({ delayBypass: !effects.delayBypass })}
              className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                effects.delayBypass
                  ? "bg-base-200 text-base-content/50 border border-base-300"
                  : "bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/40"
              }`}
              title="Toggle Delay Bypass"
            >
              <Power className="w-2.5 h-2.5" />
              {effects.delayBypass ? "BYPASS" : "ON"}
            </button>
          </div>

          <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
            <Knob
              id="slider-delay-wet"
              label="Mix"
              color="text-indigo-500"
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
              label="Feedback"
              color="text-indigo-500"
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
          className={`bg-base-100 border rounded-xl p-3 sm:p-4 space-y-3 shadow-md transition-all ${
            effects.distortionBypass
              ? "border-base-300 opacity-60"
              : "border-amber-500/40 ring-1 ring-amber-500/20"
          }`}
        >
          <div className="flex items-center justify-between border-b border-base-300 pb-2">
            <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              3. Distortion
            </span>
            <button
              id="btn-bypass-distortion"
              onClick={() =>
                updateFx({ distortionBypass: !effects.distortionBypass })
              }
              className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                effects.distortionBypass
                  ? "bg-base-200 text-base-content/50 border border-base-300"
                  : "bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40"
              }`}
              title="Toggle Distortion Bypass"
            >
              <Power className="w-2.5 h-2.5" />
              {effects.distortionBypass ? "BYPASS" : "ON"}
            </button>
          </div>

          <Knob
            id="slider-distortion-wet"
            label="Drive / Crunch"
            color="text-amber-500"
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
          className={`bg-base-100 border rounded-xl p-3 sm:p-4 space-y-3 shadow-md transition-all ${
            effects.eqBypass
              ? "border-base-300 opacity-60"
              : "border-emerald-500/40 ring-1 ring-emerald-500/20"
          }`}
        >
          <div className="flex items-center justify-between border-b border-base-300 pb-2">
            <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-emerald-500" />
              4. 3-Band EQ
            </span>
            <button
              id="btn-bypass-eq"
              onClick={() => updateFx({ eqBypass: !effects.eqBypass })}
              className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
                effects.eqBypass
                  ? "bg-base-200 text-base-content/50 border border-base-300"
                  : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40"
              }`}
              title="Toggle Equalizer Bypass"
            >
              <Power className="w-2.5 h-2.5" />
              {effects.eqBypass ? "BYPASS" : "ON"}
            </button>
          </div>

          <div className="flex items-start justify-around gap-2 w-full min-w-max mx-auto">
            <Knob
              id="slider-eq-low"
              label="LOW"
              color="text-emerald-500"
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
              color="text-emerald-500"
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
              color="text-emerald-500"
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

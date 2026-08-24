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
      <div className="card bg-base-100 border border-base-300 shadow-md">
        <div className="card-body p-3 sm:p-4 flex-row items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/20 border border-primary/30 text-primary">
              <Sliders className="w-4 h-4" />
            </div>
            <h2 className="font-bold text-sm sm:text-base text-base-content">
              Master Effects Rack
            </h2>
          </div>
        </div>
      </div>

      {/* Rack Units Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Algorithmic Reverb Unit */}
        <div
          className={`card bg-base-100 border shadow-md transition-all ${
            effects.reverbBypass
              ? "border-base-300 opacity-60"
              : "border-accent/40 ring-1 ring-accent/20"
          }`}
        >
          <div className="card-body p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
                <Waves className="w-3.5 h-3.5 text-accent" />
                1. Space Reverb
              </span>
              <button
                id="btn-bypass-reverb"
                onClick={() => updateFx({ reverbBypass: !effects.reverbBypass })}
                className={`btn btn-xs gap-1 text-[10px] font-mono font-bold ${
                  effects.reverbBypass ? "btn-ghost" : "btn-accent btn-active"
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
                color="text-accent"
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
                color="text-accent"
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
        </div>

        {/* 2. Stereo Delay Unit */}
        <div
          className={`card bg-base-100 border shadow-md transition-all ${
            effects.delayBypass
              ? "border-base-300 opacity-60"
              : "border-accent/40 ring-1 ring-accent/20"
          }`}
        >
          <div className="card-body p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-accent" />
                2. Stereo Echo
              </span>
              <button
                id="btn-bypass-delay"
                onClick={() => updateFx({ delayBypass: !effects.delayBypass })}
                className={`btn btn-xs gap-1 text-[10px] font-mono font-bold ${
                  effects.delayBypass ? "btn-ghost" : "btn-accent btn-active"
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
                color="text-accent"
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
                color="text-accent"
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
        </div>

        {/* 3. Wave Distortion / Warmth Unit */}
        <div
          className={`card bg-base-100 border shadow-md transition-all ${
            effects.distortionBypass
              ? "border-base-300 opacity-60"
              : "border-primary/40 ring-1 ring-primary/20"
          }`}
        >
          <div className="card-body p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                3. Distortion
              </span>
              <button
                id="btn-bypass-distortion"
                onClick={() =>
                  updateFx({ distortionBypass: !effects.distortionBypass })
                }
                className={`btn btn-xs gap-1 text-[10px] font-mono font-bold ${
                  effects.distortionBypass ? "btn-ghost" : "btn-primary btn-active"
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
              color="text-primary"
              value={effects.distortionWet}
              min={0}
              max={1}
              step={0.01}
              disabled={effects.distortionBypass}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => updateFx({ distortionWet: v })}
            />
          </div>
        </div>

        {/* 4. 3-Band Equalizer */}
        <div
          className={`card bg-base-100 border shadow-md transition-all ${
            effects.eqBypass
              ? "border-base-300 opacity-60"
              : "border-secondary/40 ring-1 ring-secondary/20"
          }`}
        >
          <div className="card-body p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-secondary" />
                4. 3-Band EQ
              </span>
              <button
                id="btn-bypass-eq"
                onClick={() => updateFx({ eqBypass: !effects.eqBypass })}
                className={`btn btn-xs gap-1 text-[10px] font-mono font-bold ${
                  effects.eqBypass ? "btn-ghost" : "btn-secondary btn-active"
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
                color="text-secondary"
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
                color="text-secondary"
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
                color="text-secondary"
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
    </div>
  );
});

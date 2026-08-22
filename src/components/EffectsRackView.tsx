import React from "react";
import { Sliders, Waves, Activity, Sparkles } from "lucide-react";
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
          </div>
        </div>
      </div>

      {/* Rack Units Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Algorithmic Reverb Unit */}
        <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Waves className="w-3.5 h-3.5 text-cyan-400" />
              1. Space Reverb
            </span>
            <span className="text-[10px] text-cyan-400 font-mono">
              CONVOLUTION
            </span>
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
              onChange={(e) =>
                updateFx({ reverbWet: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-cyan-500"
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
              onChange={(e) =>
                updateFx({ reverbDecay: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-cyan-500"
            />
          </div>
        </div>

        {/* 2. Stereo Delay Unit */}
        <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              2. Stereo Echo Delay
            </span>
            <span className="text-[10px] text-indigo-400 font-mono">
              TAPE ECHO
            </span>
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
              onChange={(e) =>
                updateFx({ delayWet: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer"
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
              onChange={(e) =>
                updateFx({ delayFeedback: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer"
            />
          </div>
        </div>

        {/* 3. Wave Distortion / Warmth Unit */}
        <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              3. Tube Saturation
            </span>
            <span className="text-[10px] text-amber-400 font-mono">
              OVERDRIVE
            </span>
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
              onChange={(e) =>
                updateFx({ distortionWet: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-amber-500"
            />
          </div>
        </div>

        {/* 4. 3-Band Equalizer */}
        <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-emerald-400" />
              4. 3-Band Studio EQ
            </span>
            <span className="text-[10px] text-emerald-400 font-mono">
              PARAMETRIC
            </span>
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
                onChange={(e) =>
                  updateFx({ eqLow: parseInt(e.target.value, 10) })
                }
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1"
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
                onChange={(e) =>
                  updateFx({ eqMid: parseInt(e.target.value, 10) })
                }
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1"
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
                onChange={(e) =>
                  updateFx({ eqHigh: parseInt(e.target.value, 10) })
                }
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1"
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

import React, { useState, useEffect, useCallback } from 'react';
import { Sliders, Activity, Zap, Volume2, Sparkles } from 'lucide-react';
import { SynthParams } from '../types';
import { audioEngine } from '../audio/engine';

interface SynthViewProps {
  params: SynthParams;
  onChangeParams: (newParams: SynthParams) => void;
}

const PRESETS: Record<string, Partial<SynthParams>> = {
  'Cosmic Lead': {
    oscType: 'sawtooth',
    subOscVolume: 0.2,
    noiseVolume: 0.05,
    detune: 5,
    filterType: 'lowpass',
    filterCutoff: 2800,
    filterResonance: 3.5,
    filterEnvAmount: 1200,
    attack: 0.02,
    decay: 0.3,
    sustain: 0.7,
    release: 0.4,
    lfoRate: 4,
    lfoDepth: 0.15,
    lfoTarget: 'cutoff',
    octave: 0,
  },
  '808 Deep Bass': {
    oscType: 'sine',
    subOscVolume: 0.8,
    noiseVolume: 0.0,
    detune: 0,
    filterType: 'lowpass',
    filterCutoff: 450,
    filterResonance: 1.5,
    filterEnvAmount: 200,
    attack: 0.005,
    decay: 0.5,
    sustain: 0.4,
    release: 0.35,
    lfoRate: 1,
    lfoDepth: 0.0,
    lfoTarget: 'pitch',
    octave: -1,
  },
  'Warm PolyPad': {
    oscType: 'triangle',
    subOscVolume: 0.3,
    noiseVolume: 0.02,
    detune: 10,
    filterType: 'lowpass',
    filterCutoff: 1400,
    filterResonance: 2.0,
    filterEnvAmount: 600,
    attack: 0.4,
    decay: 0.8,
    sustain: 0.85,
    release: 1.2,
    lfoRate: 0.5,
    lfoDepth: 0.25,
    lfoTarget: 'cutoff',
    octave: 0,
  },
  'Acid Synth': {
    oscType: 'sawtooth',
    subOscVolume: 0.4,
    noiseVolume: 0.0,
    detune: 0,
    filterType: 'lowpass',
    filterCutoff: 1200,
    filterResonance: 12.0,
    filterEnvAmount: 3500,
    attack: 0.005,
    decay: 0.2,
    sustain: 0.15,
    release: 0.2,
    lfoRate: 6,
    lfoDepth: 0.4,
    lfoTarget: 'cutoff',
    octave: -1,
  },
  'Dream Keys': {
    oscType: 'sine',
    subOscVolume: 0.1,
    noiseVolume: 0.01,
    detune: 4,
    filterType: 'lowpass',
    filterCutoff: 3200,
    filterResonance: 1.2,
    filterEnvAmount: 800,
    attack: 0.01,
    decay: 0.6,
    sustain: 0.4,
    release: 0.6,
    lfoRate: 2.5,
    lfoDepth: 0.1,
    lfoTarget: 'pitch',
    octave: 0,
  },
  'Pluck': {
    oscType: 'square',
    subOscVolume: 0.2,
    noiseVolume: 0.05,
    detune: 8,
    filterType: 'lowpass',
    filterCutoff: 4000,
    filterResonance: 4.0,
    filterEnvAmount: 2800,
    attack: 0.005,
    decay: 0.15,
    sustain: 0.05,
    release: 0.25,
    lfoRate: 0.5,
    lfoDepth: 0.0,
    lfoTarget: 'cutoff',
    octave: 0,
  },
  'Vintage Brass': {
    oscType: 'sawtooth',
    subOscVolume: 0.35,
    noiseVolume: 0.03,
    detune: 12,
    filterType: 'lowpass',
    filterCutoff: 2100,
    filterResonance: 2.8,
    filterEnvAmount: 1800,
    attack: 0.08,
    decay: 0.4,
    sustain: 0.6,
    release: 0.5,
    lfoRate: 5,
    lfoDepth: 0.15,
    lfoTarget: 'volume',
    octave: 0,
  },
  'Cyber Drone': {
    oscType: 'square',
    subOscVolume: 0.6,
    noiseVolume: 0.1,
    detune: 18,
    filterType: 'bandpass',
    filterCutoff: 1100,
    filterResonance: 6.0,
    filterEnvAmount: 400,
    attack: 0.8,
    decay: 1.5,
    sustain: 0.9,
    release: 2.0,
    lfoRate: 0.2,
    lfoDepth: 0.4,
    lfoTarget: 'cutoff',
    octave: -1,
  },
};

const KEYBOARD_NOTES = [
  { note: 'C3', label: 'C3', key: 'a', isBlack: false },
  { note: 'C#3', label: 'C#', key: 'w', isBlack: true },
  { note: 'D3', label: 'D3', key: 's', isBlack: false },
  { note: 'D#3', label: 'D#', key: 'e', isBlack: true },
  { note: 'E3', label: 'E3', key: 'd', isBlack: false },
  { note: 'F3', label: 'F3', key: 'f', isBlack: false },
  { note: 'F#3', label: 'F#', key: 't', isBlack: true },
  { note: 'G3', label: 'G3', key: 'g', isBlack: false },
  { note: 'G#3', label: 'G#', key: 'y', isBlack: true },
  { note: 'A3', label: 'A3', key: 'h', isBlack: false },
  { note: 'A#3', label: 'A#', key: 'u', isBlack: true },
  { note: 'B3', label: 'B3', key: 'j', isBlack: false },
  { note: 'C4', label: 'C4', key: 'k', isBlack: false },
  { note: 'C#4', label: 'C#', key: 'o', isBlack: true },
  { note: 'D4', label: 'D4', key: 'l', isBlack: false },
  { note: 'D#4', label: 'D#', key: 'p', isBlack: true },
  { note: 'E4', label: 'E4', key: ';', isBlack: false },
  { note: 'F4', label: 'F4', key: "'", isBlack: false },
];

export const SynthView: React.FC<SynthViewProps> = ({ params, onChangeParams }) => {
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());

  const handleNoteOn = useCallback((note: string) => {
    audioEngine.init();
    audioEngine.triggerSynthNoteOn(note, params);
    setActiveNotes((prev) => new Set(prev).add(note));
  }, [params]);

  const handleNoteOff = useCallback((note: string) => {
    audioEngine.triggerSynthNoteOff(note, params.release);
    setActiveNotes((prev) => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, [params.release]);

  // QWERTY Computer Keyboard mapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;
      const keyObj = KEYBOARD_NOTES.find((n) => n.key.toLowerCase() === e.key.toLowerCase());
      if (keyObj) {
        handleNoteOn(keyObj.note);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const keyObj = KEYBOARD_NOTES.find((n) => n.key.toLowerCase() === e.key.toLowerCase());
      if (keyObj) {
        handleNoteOff(keyObj.note);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleNoteOn, handleNoteOff]);

  const setPreset = (presetName: string) => {
    const presetData = PRESETS[presetName];
    if (presetData) {
      onChangeParams({
        ...params,
        ...presetData,
        preset: presetName,
      });
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Top Synth Header & Presets */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-100 flex items-center gap-2">
              Analog Polyphonic Synthesizer
              <span className="text-[11px] font-mono font-normal text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                16-Voice Engine
              </span>
            </h2>
            <p className="text-xs text-slate-400">Dual oscillators, multi-mode filter, ADSR envelope, and LFO modulation</p>
          </div>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span className="text-xs text-slate-400 font-medium">Preset:</span>
          <select
            id="select-synth-preset"
            value={params.preset}
            onChange={(e) => setPreset(e.target.value)}
            className="bg-[#0B0D19] border border-[#2D355A] text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            {Object.keys(PRESETS).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Control Panels Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Oscillators Section */}
        <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              1. Oscillators
            </span>
            <span className="text-[10px] text-slate-400 font-mono">OSC 1 + SUB</span>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">Waveform</label>
            <div className="grid grid-cols-4 gap-1">
              {(['sawtooth', 'square', 'sine', 'triangle'] as const).map((w) => (
                <button
                  key={w}
                  id={`btn-wave-${w}`}
                  onClick={() => onChangeParams({ ...params, oscType: w })}
                  className={`py-1 text-[11px] rounded font-semibold capitalize transition-all cursor-pointer ${
                    params.oscType === w
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]'
                  }`}
                >
                  {w.slice(0, 4)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Sub-Osc Volume</span>
              <span className="font-mono text-indigo-300">{(params.subOscVolume * 100).toFixed(0)}%</span>
            </div>
            <input
              id="slider-sub-osc"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.subOscVolume}
              onChange={(e) => onChangeParams({ ...params, subOscVolume: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Detune Spread</span>
              <span className="font-mono text-indigo-300">{params.detune} ct</span>
            </div>
            <input
              id="slider-detune"
              type="range"
              min={0}
              max={50}
              value={params.detune}
              onChange={(e) => onChangeParams({ ...params, detune: parseInt(e.target.value, 10) })}
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Noise Generator</span>
              <span className="font-mono text-indigo-300">{(params.noiseVolume * 100).toFixed(0)}%</span>
            </div>
            <input
              id="slider-noise"
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={params.noiseVolume}
              onChange={(e) => onChangeParams({ ...params, noiseVolume: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer"
            />
          </div>
        </div>

        {/* 2. Filter Section */}
        <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-pink-400" />
              2. VCF Filter
            </span>
            <span className="text-[10px] text-slate-400 font-mono">24dB/OCT</span>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">Filter Type</label>
            <div className="grid grid-cols-3 gap-1">
              {(['lowpass', 'bandpass', 'highpass'] as const).map((t) => (
                <button
                  key={t}
                  id={`btn-filter-${t}`}
                  onClick={() => onChangeParams({ ...params, filterType: t })}
                  className={`py-1 text-[11px] rounded font-semibold uppercase transition-all cursor-pointer ${
                    params.filterType === t
                      ? 'bg-pink-600 text-white shadow-sm'
                      : 'bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]'
                  }`}
                >
                  {t === 'lowpass' ? 'LPF' : t === 'bandpass' ? 'BPF' : 'HPF'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Cutoff Frequency</span>
              <span className="font-mono text-pink-300">{Math.round(params.filterCutoff)} Hz</span>
            </div>
            <input
              id="slider-filter-cutoff"
              type="range"
              min={50}
              max={12000}
              step={10}
              value={params.filterCutoff}
              onChange={(e) => onChangeParams({ ...params, filterCutoff: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-pink-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Resonance (Q)</span>
              <span className="font-mono text-pink-300">{params.filterResonance.toFixed(1)}</span>
            </div>
            <input
              id="slider-filter-resonance"
              type="range"
              min={0.1}
              max={20}
              step={0.1}
              value={params.filterResonance}
              onChange={(e) => onChangeParams({ ...params, filterResonance: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-pink-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Env Mod Depth</span>
              <span className="font-mono text-pink-300">+{Math.round(params.filterEnvAmount)} Hz</span>
            </div>
            <input
              id="slider-filter-env"
              type="range"
              min={0}
              max={6000}
              step={50}
              value={params.filterEnvAmount}
              onChange={(e) => onChangeParams({ ...params, filterEnvAmount: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-pink-500"
            />
          </div>
        </div>

        {/* 3. Envelope ADSR */}
        <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              3. ADSR Envelope
            </span>
            <span className="text-[10px] text-slate-400 font-mono">AMP / VCA</span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            {/* Attack */}
            <div>
              <span className="text-[10px] text-slate-400 block font-mono">ATT</span>
              <input
                id="slider-env-attack"
                type="range"
                min={0.005}
                max={2.0}
                step={0.01}
                value={params.attack}
                onChange={(e) => onChangeParams({ ...params, attack: parseFloat(e.target.value) })}
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1"
              />
              <span className="text-[10px] font-mono text-emerald-300 block">{params.attack.toFixed(2)}s</span>
            </div>

            {/* Decay */}
            <div>
              <span className="text-[10px] text-slate-400 block font-mono">DEC</span>
              <input
                id="slider-env-decay"
                type="range"
                min={0.01}
                max={2.0}
                step={0.01}
                value={params.decay}
                onChange={(e) => onChangeParams({ ...params, decay: parseFloat(e.target.value) })}
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1"
              />
              <span className="text-[10px] font-mono text-emerald-300 block">{params.decay.toFixed(2)}s</span>
            </div>

            {/* Sustain */}
            <div>
              <span className="text-[10px] text-slate-400 block font-mono">SUS</span>
              <input
                id="slider-env-sustain"
                type="range"
                min={0}
                max={1.0}
                step={0.01}
                value={params.sustain}
                onChange={(e) => onChangeParams({ ...params, sustain: parseFloat(e.target.value) })}
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1"
              />
              <span className="text-[10px] font-mono text-emerald-300 block">{(params.sustain * 100).toFixed(0)}%</span>
            </div>

            {/* Release */}
            <div>
              <span className="text-[10px] text-slate-400 block font-mono">REL</span>
              <input
                id="slider-env-release"
                type="range"
                min={0.01}
                max={3.0}
                step={0.01}
                value={params.release}
                onChange={(e) => onChangeParams({ ...params, release: parseFloat(e.target.value) })}
                className="h-20 w-full bg-[#0B0D19] rounded-lg cursor-pointer [writing-mode:vertical-lr] [direction:rtl] my-1"
              />
              <span className="text-[10px] font-mono text-emerald-300 block">{params.release.toFixed(2)}s</span>
            </div>
          </div>
        </div>

        {/* 4. LFO & Master Pitch */}
        <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md">
          <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              4. LFO & Octave
            </span>
            <span className="text-[10px] text-slate-400 font-mono">MODULATION</span>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">LFO Destination</label>
            <div className="grid grid-cols-3 gap-1">
              {(['cutoff', 'pitch', 'volume'] as const).map((t) => (
                <button
                  key={t}
                  id={`btn-lfo-target-${t}`}
                  onClick={() => onChangeParams({ ...params, lfoTarget: t })}
                  className={`py-1 text-[11px] rounded font-semibold capitalize transition-all cursor-pointer ${
                    params.lfoTarget === t
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">LFO Rate</span>
              <span className="font-mono text-cyan-300">{params.lfoRate.toFixed(1)} Hz</span>
            </div>
            <input
              id="slider-lfo-rate"
              type="range"
              min={0.1}
              max={20}
              step={0.1}
              value={params.lfoRate}
              onChange={(e) => onChangeParams({ ...params, lfoRate: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-cyan-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">LFO Depth</span>
              <span className="font-mono text-cyan-300">{(params.lfoDepth * 100).toFixed(0)}%</span>
            </div>
            <input
              id="slider-lfo-depth"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.lfoDepth}
              onChange={(e) => onChangeParams({ ...params, lfoDepth: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-cyan-500"
            />
          </div>

          <div className="pt-1 flex items-center justify-between">
            <span className="text-xs text-slate-400">Octave Pitch</span>
            <div className="flex items-center gap-1">
              {([-2, -1, 0, 1, 2] as const).map((oct) => (
                <button
                  key={oct}
                  id={`btn-octave-${oct}`}
                  onClick={() => onChangeParams({ ...params, octave: oct })}
                  className={`w-6 h-6 rounded text-xs font-mono font-bold flex items-center justify-center transition-colors cursor-pointer ${
                    params.octave === oct
                      ? 'bg-indigo-600 text-white'
                      : 'bg-[#0B0D19] text-slate-400 hover:text-white border border-[#252B48]'
                  }`}
                >
                  {oct > 0 ? `+${oct}` : oct}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Piano Keyboard */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Interactive Keyboard
            </span>
            <span className="text-[11px] text-slate-400">
              (Use mouse, touch, or QWERTY keys: <span className="font-mono text-indigo-300">A W S E D F T G Y H U J K</span>)
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            Active: {Array.from(activeNotes).join(', ') || 'None'}
          </div>
        </div>

        {/* Keyboard Keys Layout */}
        <div className="relative h-44 flex select-none bg-[#0B0D19] p-2 rounded-lg border border-[#252B48] overflow-x-auto">
          {KEYBOARD_NOTES.map((k) => {
            const isActive = activeNotes.has(k.note);
            if (k.isBlack) {
              return (
                <div
                  key={k.note}
                  id={`key-${k.note}`}
                  onMouseDown={() => handleNoteOn(k.note)}
                  onMouseUp={() => handleNoteOff(k.note)}
                  onMouseLeave={() => isActive && handleNoteOff(k.note)}
                  onTouchStart={(e) => { e.preventDefault(); handleNoteOn(k.note); }}
                  onTouchEnd={(e) => { e.preventDefault(); handleNoteOff(k.note); }}
                  className={`absolute z-10 w-9 h-28 rounded-b-md border border-slate-900 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
                    isActive
                      ? 'bg-gradient-to-b from-indigo-500 to-indigo-700 shadow-lg shadow-indigo-500/50 scale-[0.98]'
                      : 'bg-gradient-to-b from-slate-800 to-slate-950 hover:bg-slate-800'
                  }`}
                  style={{
                    left: `${getBlackKeyLeftOffset(k.note)}%`,
                  }}
                >
                  <span className="text-[9px] font-mono font-bold text-slate-300">{k.label}</span>
                  <span className="text-[8px] font-mono text-indigo-400 uppercase">{k.key}</span>
                </div>
              );
            }

            return (
              <div
                key={k.note}
                id={`key-${k.note}`}
                onMouseDown={() => handleNoteOn(k.note)}
                onMouseUp={() => handleNoteOff(k.note)}
                onMouseLeave={() => isActive && handleNoteOff(k.note)}
                onTouchStart={(e) => { e.preventDefault(); handleNoteOn(k.note); }}
                onTouchEnd={(e) => { e.preventDefault(); handleNoteOff(k.note); }}
                className={`flex-1 h-full rounded-b-md border border-slate-700 mx-0.5 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
                  isActive
                    ? 'bg-gradient-to-b from-indigo-200 to-indigo-400 text-slate-950 shadow-inner scale-[0.99]'
                    : 'bg-gradient-to-b from-slate-100 to-slate-200 text-slate-800 hover:from-white hover:to-slate-100'
                }`}
              >
                <span className="text-[10px] font-mono font-bold">{k.label}</span>
                <span className="text-[9px] font-mono text-indigo-600 uppercase font-semibold">{k.key}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function getBlackKeyLeftOffset(note: string): number {
  const whiteKeyWidth = 100 / 11;
  const offsets: Record<string, number> = {
    'C#3': whiteKeyWidth * 0.7,
    'D#3': whiteKeyWidth * 1.7,
    'F#3': whiteKeyWidth * 3.7,
    'G#3': whiteKeyWidth * 4.7,
    'A#3': whiteKeyWidth * 5.7,
    'C#4': whiteKeyWidth * 7.7,
    'D#4': whiteKeyWidth * 8.7,
  };
  return offsets[note] || 0;
}

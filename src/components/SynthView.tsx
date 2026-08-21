import React, { useState, useEffect, useCallback } from 'react';
import { Sliders, Activity, Zap, Volume2, Sparkles, Bookmark, Plus, Library, FolderOpen, Check } from 'lucide-react';
import { SynthParams } from '../types';
import { audioEngine } from '../audio/engine';
import {
  FACTORY_PRESETS,
  SynthPresetItem,
  getCustomPresets,
  saveCustomPreset,
} from '../audio/synthPresets';
import { SynthPresetLibrary } from './SynthPresetLibrary';

interface SynthViewProps {
  params: SynthParams;
  onChangeParams: (newParams: SynthParams) => void;
}

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

/**
 * Real-time Oscillator Waveform Box
 * Displays waveform with center horizontal X-axis (zero crossing),
 * showing positive crests UP and negative troughs DOWN.
 */
const OscillatorCanvas: React.FC<{ params: SynthParams; activeNotesCount: number }> = ({
  params,
  activeNotesCount,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const centerY = h / 2;

      ctx.clearRect(0, 0, w, h);

      // 1. Draw Zero-Crossing Reference Center Line
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(0, centerY);
      ctx.lineTo(w, centerY);
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. Axis label markers (+ and -)
      ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.font = '8px monospace';
      ctx.fillText('+1', 4, 10);
      ctx.fillText('0', 4, centerY - 2);
      ctx.fillText('-1', 4, h - 3);

      const analyser = audioEngine.getAnalyser();
      const isSounding = activeNotesCount > 0 && analyser;

      const points: { x: number; y: number }[] = [];
      const numPoints = 128;
      const amp = (h / 2) * 0.82;

      if (isSounding && analyser) {
        // Read live Web Audio PCM time-domain buffer
        const bufferLen = analyser.frequencyBinCount;
        const timeData = new Uint8Array(bufferLen);
        analyser.getByteTimeDomainData(timeData);

        // Stabilize trigger
        let triggerOffset = 0;
        for (let i = 0; i < Math.min(bufferLen / 2, 256); i++) {
          if (timeData[i] < 128 && timeData[i + 1] >= 128) {
            triggerOffset = i;
            break;
          }
        }

        const slice = Math.min(bufferLen - triggerOffset, 256);
        for (let i = 0; i < numPoints; i++) {
          const idx = triggerOffset + Math.floor((i / (numPoints - 1)) * slice);
          const raw = timeData[idx] !== undefined ? timeData[idx] : 128;
          // Normalized -1.0 to +1.0
          const norm = (raw - 128) / 128.0;
          const x = (i / (numPoints - 1)) * w;
          // Positive UP, Negative DOWN
          const y = centerY - (norm * amp);
          points.push({ x, y });
        }
      } else {
        // Mathematical Oscillator Waveform Model with Sub-Osc & Detune
        const time = Date.now() * 0.0025;
        const cycles = 2.5; // Display 2.5 complete wave cycles across the box

        for (let i = 0; i < numPoints; i++) {
          const t = (i / (numPoints - 1)) * cycles * 2 * Math.PI + (time % (2 * Math.PI));
          let val = 0;

          // Main oscillator
          if (params.oscType === 'sine') {
            val = Math.sin(t);
          } else if (params.oscType === 'square') {
            val = Math.sin(t) >= 0 ? 0.9 : -0.9;
          } else if (params.oscType === 'sawtooth') {
            val = 2 * ((t / (2 * Math.PI)) - Math.floor(0.5 + (t / (2 * Math.PI))));
          } else if (params.oscType === 'triangle') {
            val = 2 * Math.abs(2 * ((t / (2 * Math.PI)) - Math.floor(0.5 + (t / (2 * Math.PI))))) - 1;
          }

          // Blend sub-oscillator (sine wave at half frequency)
          if (params.subOscVolume > 0) {
            const subVal = Math.sin(t * 0.5);
            val = val * (1 - params.subOscVolume * 0.3) + subVal * params.subOscVolume * 0.5;
          }

          // Blend detune spread (chorus shimmer)
          if (params.detune > 0) {
            const detuneFactor = 1 + (params.detune / 1200);
            const detuneVal = Math.sin(t * detuneFactor);
            val = val * 0.8 + detuneVal * 0.2;
          }

          // Add slight noise
          if (params.noiseVolume > 0) {
            val += (Math.random() * 2 - 1) * params.noiseVolume * 0.35;
          }

          // Clamp
          val = Math.max(-1, Math.min(1, val));

          const x = (i / (numPoints - 1)) * w;
          const y = centerY - (val * amp);
          points.push({ x, y });
        }
      }

      // Shaded area fill from center zero-axis to waveform
      ctx.beginPath();
      ctx.moveTo(points[0].x, centerY);
      for (let i = 0; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.lineTo(points[points.length - 1].x, centerY);
      ctx.closePath();
      ctx.fillStyle = isSounding ? 'rgba(99, 102, 241, 0.22)' : 'rgba(99, 102, 241, 0.1)';
      ctx.fill();

      // Main glowing waveform stroke line
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);

      ctx.shadowBlur = isSounding ? 10 : 3;
      ctx.shadowColor = '#818cf8';
      ctx.strokeStyle = isSounding ? '#c7d2fe' : '#a5b4fc';
      ctx.lineWidth = isSounding ? 2.2 : 1.8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(render);
    };

    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(canvas);

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, [params, activeNotesCount]);

  return <canvas ref={canvasRef} className="w-full h-full block rounded" />;
};

export const SynthView: React.FC<SynthViewProps> = ({ params, onChangeParams }) => {
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [customPresets, setCustomPresets] = useState<SynthPresetItem[]>([]);
  const [isQuickSaving, setIsQuickSaving] = useState<boolean>(false);
  const [quickSaveName, setQuickSaveName] = useState<string>('');
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Sync custom presets from local storage
  const reloadPresets = useCallback(() => {
    setCustomPresets(getCustomPresets());
  }, []);

  useEffect(() => {
    reloadPresets();
  }, [reloadPresets, isLibraryOpen]);

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

  const handleSelectPreset = (preset: SynthPresetItem) => {
    onChangeParams({
      ...params,
      ...preset.params,
      preset: preset.name,
    });
    setSaveToast(`Loaded "${preset.name}"`);
    setTimeout(() => setSaveToast(null), 2500);
  };

  const handleDropdownChange = (name: string) => {
    // Check factory presets first
    const factory = FACTORY_PRESETS.find((p) => p.name === name);
    if (factory) {
      handleSelectPreset(factory);
      return;
    }
    // Check custom presets
    const custom = customPresets.find((p) => p.name === name);
    if (custom) {
      handleSelectPreset(custom);
    }
  };

  const handleQuickSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSaveName.trim()) return;

    const saved = saveCustomPreset(quickSaveName, params, 'User');
    reloadPresets();
    setIsQuickSaving(false);
    setQuickSaveName('');
    handleSelectPreset(saved);
    setSaveToast(`Preset "${saved.name}" saved!`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const totalPresetsCount = FACTORY_PRESETS.length + customPresets.length;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Top Synth Header & Presets */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg relative">
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

        {/* Preset Selector & Presets Library Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Quick Dropdown with Groups */}
          <div className="flex items-center gap-1.5 bg-[#0B0D19] border border-[#2D355A] rounded-lg px-2.5 py-1">
            <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <select
              id="select-synth-preset"
              value={params.preset}
              onChange={(e) => handleDropdownChange(e.target.value)}
              className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer pr-2 font-medium"
            >
              <optgroup label="Factory Presets">
                {FACTORY_PRESETS.map((p) => (
                  <option key={p.id} value={p.name} className="bg-[#0B0D19] text-slate-200">
                    {p.name} ({p.category})
                  </option>
                ))}
              </optgroup>
              {customPresets.length > 0 && (
                <optgroup label="My Custom Presets (LocalStorage)">
                  {customPresets.map((p) => (
                    <option key={p.id} value={p.name} className="bg-[#0B0D19] text-purple-300">
                      ★ {p.name} ({p.category})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Quick Save Current Preset Button */}
          <button
            id="btn-quick-save-preset"
            onClick={() => {
              setQuickSaveName(params.preset ? `${params.preset} (Custom)` : 'My Synth Patch');
              setIsQuickSaving(true);
            }}
            className="flex items-center gap-1.5 bg-[#171B36] hover:bg-[#22284C] text-slate-200 hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#2D355A] transition-colors shadow-xs"
            title="Save current synth sound to LocalStorage"
          >
            <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Save</span>
          </button>

          {/* Open Full Presets Library Drawer */}
          <button
            id="btn-open-presets-library"
            onClick={() => setIsLibraryOpen(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-md transition-colors"
            title="Open Presets Library (Search, audition, export/import)"
          >
            <Library className="w-3.5 h-3.5" />
            <span>Presets Library</span>
            <span className="bg-indigo-700/80 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
              {totalPresetsCount}
            </span>
          </button>
        </div>

        {/* Floating Save Toast */}
        {saveToast && (
          <div className="absolute top-full right-4 mt-2 z-20 bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-xs px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>{saveToast}</span>
          </div>
        )}
      </div>

      {/* Quick Save Modal Popover */}
      {isQuickSaving && (
        <div className="bg-[#171B38] border border-indigo-500/40 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xl animate-in fade-in">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Bookmark className="w-4 h-4 text-indigo-400" />
            <span>Save Custom Synth Preset to Browser:</span>
          </div>
          <form onSubmit={handleQuickSaveSubmit} className="flex items-center gap-2 flex-1 max-w-md">
            <input
              type="text"
              required
              autoFocus
              placeholder="Preset Name..."
              value={quickSaveName}
              onChange={(e) => setQuickSaveName(e.target.value)}
              className="flex-1 bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xs transition-colors shrink-0"
            >
              Save Patch
            </button>
            <button
              type="button"
              onClick={() => setIsQuickSaving(false)}
              className="bg-[#0B0D19] hover:bg-[#1A1F3A] text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#252B48] transition-colors shrink-0"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

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
            <div className="grid grid-cols-4 gap-1 mb-2">
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

            {/* Centered Oscilloscope Waveform Display Box */}
            <div className="bg-[#0B0D19] border border-[#252B48] rounded-lg p-2 relative overflow-hidden">
              <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono mb-1">
                <span>OSC WAVEFORM (+ / -)</span>
                <span className="text-indigo-400 font-semibold uppercase">{params.oscType}</span>
              </div>
              <div className="h-16 w-full relative">
                <OscillatorCanvas params={params} activeNotesCount={activeNotes.size} />
              </div>
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

      {/* Preset Library Sidebar Drawer / Modal */}
      <SynthPresetLibrary
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        currentParams={params}
        onSelectPreset={(preset) => {
          handleSelectPreset(preset);
          setIsLibraryOpen(false);
        }}
      />
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

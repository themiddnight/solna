import React, { useState, useCallback, useEffect } from 'react';
import { Disc3, Volume2, Sparkles, Sliders } from 'lucide-react';
import { audioEngine } from '../audio/engine';
import { DrumPad } from '../types';

const DEFAULT_PADS: DrumPad[] = [
  { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-rose-500 to-red-600', shortcut: '1', volume: 0.9, pitch: 0, decay: 0.3 },
  { id: 'snare', name: 'Snare Snap', note: 'snare', color: 'from-amber-500 to-orange-600', shortcut: '2', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'hihat', name: 'Closed Hat', note: 'hihat', color: 'from-emerald-500 to-teal-600', shortcut: '3', volume: 0.75, pitch: 0, decay: 0.05 },
  { id: 'openhat', name: 'Open Hat', note: 'openhat', color: 'from-cyan-500 to-blue-600', shortcut: '4', volume: 0.8, pitch: 0, decay: 0.35 },
  { id: 'clap', name: 'Hand Clap', note: 'clap', color: 'from-purple-500 to-indigo-600', shortcut: 'Q', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'lowtom', name: 'Low Tom', note: 'tom', color: 'from-pink-500 to-rose-600', shortcut: 'W', volume: 0.8, pitch: 0, decay: 0.25 },
  { id: 'hightom', name: 'High Tom', note: 'tom', color: 'from-violet-500 to-purple-600', shortcut: 'E', volume: 0.8, pitch: 4, decay: 0.2 },
  { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-yellow-400 to-amber-600', shortcut: 'R', volume: 0.75, pitch: 0, decay: 0.8 },
];

export const DrumMachineView: React.FC = () => {
  const [pads, setPads] = useState<DrumPad[]>(DEFAULT_PADS);
  const [selectedKit, setSelectedKit] = useState<string>('808 Vintage');
  const [activePadId, setActivePadId] = useState<string | null>(null);

  const triggerPad = useCallback((pad: DrumPad) => {
    audioEngine.init();
    audioEngine.triggerDrum(pad.note, pad.volume);
    setActivePadId(pad.id);
    setTimeout(() => setActivePadId(null), 150);
  }, []);

  // Keyboard shortcut listener for pads
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;
      const pad = pads.find((p) => p.shortcut.toLowerCase() === e.key.toLowerCase());
      if (pad) {
        triggerPad(pad);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pads, triggerPad]);

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Top Kit Selector Bar */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-pink-600/20 border border-pink-500/30 text-pink-400">
            <Disc3 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-100 flex items-center gap-2">
              Acoustic & Electronic Drum Pads
              <span className="text-[11px] font-mono font-normal text-pink-400 bg-pink-500/10 px-2 py-0.5 rounded border border-pink-500/20">
                8-Velocity Trigger Matrix
              </span>
            </h2>
          </div>
        </div>

        {/* Kit Selector */}
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-pink-400" />
          <span className="text-xs text-slate-400 font-medium">Drum Kit:</span>
          <select
            id="select-drum-kit"
            value={selectedKit}
            onChange={(e) => setSelectedKit(e.target.value)}
            className="bg-[#0B0D19] border border-[#2D355A] text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-pink-500 cursor-pointer"
          >
            <option value="808 Vintage">808 Vintage Analog</option>
            <option value="909 Modern">909 Dance & Club</option>
            <option value="Acoustic Studio">Acoustic Studio Session</option>
            <option value="Lo-Fi Vinyl">Lo-Fi Dust & Vinyl</option>
            <option value="Trap Beat">Trap & Hyperpop</option>
          </select>
        </div>
      </div>

      {/* 8-Pad Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {pads.map((pad) => {
          const isActive = activePadId === pad.id;
          return (
            <div
              key={pad.id}
              id={`drum-pad-card-${pad.id}`}
              className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 flex flex-col justify-between space-y-3 shadow-md hover:border-[#3B4371] transition-all"
            >
              {/* Trigger Button Pad */}
              <button
                id={`btn-pad-${pad.id}`}
                onClick={() => triggerPad(pad)}
                className={`relative w-full h-32 rounded-lg bg-gradient-to-br ${pad.color} p-4 flex flex-col justify-between items-start text-white shadow-lg cursor-pointer transition-all duration-75 active:scale-95 ${
                  isActive
                    ? 'ring-4 ring-white brightness-125 scale-95 shadow-white/30'
                    : 'hover:brightness-110'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-bold uppercase tracking-wider">{pad.name}</span>
                  <span className="w-6 h-6 rounded-md bg-black/30 border border-white/20 text-[11px] font-mono font-bold flex items-center justify-center">
                    {pad.shortcut}
                  </span>
                </div>

                <div className="flex items-center justify-between w-full text-[10px] opacity-80 font-mono">
                  <span>{selectedKit.split(' ')[0]}</span>
                  <span>VEL {(pad.volume * 127).toFixed(0)}</span>
                </div>
              </button>

              {/* Volume Slider */}
              <div className="flex items-center gap-2 pt-1">
                <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                <input
                  id={`slider-pad-vol-${pad.id}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={pad.volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setPads((prev) => prev.map((p) => (p.id === pad.id ? { ...p, volume: val } : p)));
                  }}
                  className="w-full h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer"
                  title={`${pad.name} Volume`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

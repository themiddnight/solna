import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Disc3, Volume2, Sparkles } from 'lucide-react';
import { audioEngine } from '../audio/engine';
import { DRUM_KITS } from '../audio/drumKits';
import { isTypingTarget, shortcutLabel } from '../utils/keyboard';
import { DrumPad } from '../types';

export const DEFAULT_PADS: DrumPad[] = [
  { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-rose-500 to-red-600', shortcut: 'KeyZ', volume: 0.9, pitch: 0, decay: 0.3 },
  { id: 'snare', name: 'Snare Snap', note: 'snare', color: 'from-amber-500 to-orange-600', shortcut: 'KeyX', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'hihat', name: 'Closed Hat', note: 'hihat', color: 'from-emerald-500 to-teal-600', shortcut: 'KeyC', volume: 0.75, pitch: 0, decay: 0.05 },
  { id: 'openhat', name: 'Open Hat', note: 'openhat', color: 'from-cyan-500 to-blue-600', shortcut: 'KeyV', volume: 0.8, pitch: 0, decay: 0.35 },
  { id: 'clap', name: 'Hand Clap', note: 'clap', color: 'from-purple-500 to-indigo-600', shortcut: 'KeyM', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'lowtom', name: 'Low Tom', note: 'tom', color: 'from-pink-500 to-rose-600', shortcut: 'Comma', volume: 0.8, pitch: 0, decay: 0.25 },
  { id: 'hightom', name: 'High Tom', note: 'tom', color: 'from-violet-500 to-purple-600', shortcut: 'Period', volume: 0.8, pitch: 4, decay: 0.2 },
  { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-yellow-400 to-amber-600', shortcut: 'Slash', volume: 0.75, pitch: 0, decay: 0.8 },
];

export const DrumPads: React.FC<{ soundKit: string; onChangeSoundKit: (kit: string) => void }> = React.memo(({ soundKit, onChangeSoundKit }) => {
  const [pads, setPads] = useState<DrumPad[]>(DEFAULT_PADS);
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
      if (isTypingTarget(e)) return;
      if (e.repeat) return;
      const pad = pads.find((p) => p.shortcut === e.code);
      if (pad) {
        triggerPad(pad);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pads, triggerPad]);

  // Two groups of four, arranged in one row
  const groups = useMemo(() => [pads.slice(0, 4), pads.slice(4)], [pads]);

  return (
    <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 shadow-xl">
      {/* Strip Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Disc3 className="w-4 h-4 text-pink-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Drum Pads
          </span>
        </div>

        {/* Kit Selector */}
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-pink-400" />
          <span className="text-[11px] text-slate-500 font-medium">Drum Kit:</span>
          <select
            id="select-drum-kit"
            value={soundKit}
            onChange={(e) => onChangeSoundKit(e.target.value)}
            className="bg-[#0B0D19] border border-[#2D355A] text-slate-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-pink-500 cursor-pointer"
          >
            {Object.keys(DRUM_KITS).map((k) => (
              <option key={k} value={k} className="bg-[#0B0D19]">
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Single row, two groups of four */}
      <div className="flex gap-4">
        {groups.map((group, groupIndex) => (
          <React.Fragment key={groupIndex}>
            {groupIndex > 0 && <div className="w-px self-stretch bg-[#252B48]" />}
            <div className="flex-1 grid grid-cols-4 gap-2.5">
              {group.map((pad) => {
                const isActive = activePadId === pad.id;
                return (
                  <div
                    key={pad.id}
                    id={`drum-pad-card-${pad.id}`}
                    className="flex flex-col gap-1.5"
                  >
                    {/* Trigger Button Pad */}
                    <button
                      id={`btn-pad-${pad.id}`}
                      onClick={() => triggerPad(pad)}
                      className={`relative w-full h-16 rounded-lg bg-gradient-to-br ${pad.color} p-2 flex flex-col justify-between items-start text-white shadow-md cursor-pointer transition-all duration-75 ${
                        isActive
                          ? 'ring-4 ring-white brightness-125 scale-95 shadow-white/30'
                          : 'hover:brightness-110'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-[11px] font-bold uppercase tracking-wider truncate">{pad.name}</span>
                        <span className="w-5 h-5 rounded-md bg-black/30 border border-white/20 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                          {shortcutLabel(pad.shortcut)}
                        </span>
                      </div>
                    </button>

                    {/* Volume Slider */}
                    <div className="flex items-center gap-1.5 px-0.5">
                      <Volume2 className="w-3 h-3 text-slate-500 shrink-0" />
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
                        className="w-full h-1 bg-[#0B0D19] rounded-lg cursor-pointer"
                        title={`${pad.name} Volume`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
});

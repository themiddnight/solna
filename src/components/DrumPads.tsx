import React, { useState, useCallback, useEffect } from 'react';
import { Volume2 } from 'lucide-react';
import { triggerPad as triggerDrumPad } from "../audio/playback/drumPlayback";
import { isTypingTarget, shortcutLabel } from '../utils/keyboard';
import { DrumPad } from '../types';
import { Slider } from './ui/Slider';

const PADS: DrumPad[] = [
  { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-rose-500 to-red-600', shortcut: 'KeyZ', volume: 0.9, pitch: 0, decay: 0.3 },
  { id: 'snare', name: 'Snare Snap', note: 'snare', color: 'from-amber-500 to-orange-600', shortcut: 'KeyX', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'hihat', name: 'Closed Hat', note: 'hihat', color: 'from-emerald-500 to-teal-600', shortcut: 'KeyC', volume: 0.75, pitch: 0, decay: 0.05 },
  { id: 'openhat', name: 'Open Hat', note: 'openhat', color: 'from-cyan-500 to-blue-600', shortcut: 'KeyV', volume: 0.8, pitch: 0, decay: 0.35 },
  { id: 'clap', name: 'Hand Clap', note: 'clap', color: 'from-purple-500 to-indigo-600', shortcut: 'KeyM', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'lowtom', name: 'Low Tom', note: 'tom', color: 'from-pink-500 to-rose-600', shortcut: 'Comma', volume: 0.8, pitch: 0, decay: 0.25 },
  { id: 'hightom', name: 'High Tom', note: 'tom', color: 'from-violet-500 to-purple-600', shortcut: 'Period', volume: 0.8, pitch: 4, decay: 0.2 },
  { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-yellow-400 to-amber-600', shortcut: 'Slash', volume: 0.75, pitch: 0, decay: 0.8 },
];

export const DrumPads: React.FC = React.memo(() => {
  const [pads, setPads] = useState<DrumPad[]>(PADS);
  const [activePadId, setActivePadId] = useState<string | null>(null);

  const triggerPad = useCallback((pad: DrumPad) => {
    triggerDrumPad(pad.note, pad.volume);
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

  return (
    <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 sm:p-4 shadow-md">
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-2.5">
        {pads.map((pad) => {
          const isActive = activePadId === pad.id;
          return (
            <div
              key={pad.id}
              id={`drum-pad-card-${pad.id}`}
              className="flex flex-col gap-1"
            >
              {/* Trigger Button Pad */}
              <button
                id={`btn-pad-${pad.id}`}
                onClick={() => triggerPad(pad)}
                className={`relative w-full h-14 sm:h-16 rounded-lg bg-gradient-to-br ${pad.color} p-1.5 sm:p-2 flex flex-col justify-between items-start text-white shadow-sm cursor-pointer transition-all duration-75 ${
                  isActive
                    ? 'ring-4 ring-white brightness-125 scale-95 shadow-white/30'
                    : 'hover:brightness-110 active:scale-95'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider truncate">
                    {pad.name.replace(' Drum', '').replace(' Snap', '').replace(' Cymbal', '')}
                  </span>
                  <span className="w-4 h-4 sm:w-5 sm:h-5 rounded bg-black/30 border border-white/20 text-[9px] sm:text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                    {shortcutLabel(pad.shortcut)}
                  </span>
                </div>
              </button>

              {/* Volume Slider */}
              <div className="flex items-center gap-1 px-0.5">
                <Volume2 className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                <Slider
                  id={`slider-pad-vol-${pad.id}`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={pad.volume}
                  onChange={(val) => {
                    setPads((prev) => prev.map((p) => (p.id === pad.id ? { ...p, volume: val } : p)));
                  }}
                  className="w-full h-1 bg-[#0B0D19] rounded cursor-pointer"
                  title={`${pad.name} Volume`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

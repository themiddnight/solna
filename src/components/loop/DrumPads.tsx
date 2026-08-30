import React, { useState, useCallback, useEffect } from 'react';
import { Volume2 } from 'lucide-react';
import { ensureDrumEngine, triggerPad as triggerDrumPad } from "../../audio/playback/drumPlayback";
import { isTypingTarget, shortcutLabel } from '../../utils/keyboard';
import { DrumPad } from '../../types';
import { Slider } from '../ui/Slider';

/**
 * Exported under this name because scripts/check-key-bindings.ts imports
 * `DEFAULT_PADS` — the shortcut codes here are the source of truth for the
 * drum half of the global key map.
 *
 * `color` holds the full gradient stops plus the matching content token; it is
 * spliced into a `bg-gradient-to-br` className below. Three semantic ramps
 * rotate primary -> secondary -> accent so neighbours stay distinguishable in
 * both the 4-column and the 8-column grid.
 */
export const DEFAULT_PADS: DrumPad[] = [
  { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'KeyZ', volume: 0.9, pitch: 0, decay: 0.3 },
  { id: 'snare', name: 'Snare Snap', note: 'snare', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'KeyX', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'hihat', name: 'Closed Hat', note: 'hihat', color: 'from-accent to-accent/60 text-accent-content', shortcut: 'KeyC', volume: 0.75, pitch: 0, decay: 0.05 },
  { id: 'openhat', name: 'Open Hat', note: 'openhat', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'KeyV', volume: 0.8, pitch: 0, decay: 0.35 },
  { id: 'clap', name: 'Hand Clap', note: 'clap', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'KeyM', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'lowtom', name: 'Low Tom', note: 'tom', color: 'from-accent to-accent/60 text-accent-content', shortcut: 'Comma', volume: 0.8, pitch: 0, decay: 0.25 },
  { id: 'hightom', name: 'High Tom', note: 'tom', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'Period', volume: 0.8, pitch: 4, decay: 0.2 },
  { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'Slash', volume: 0.75, pitch: 0, decay: 0.8 },
];

export const DrumPads: React.FC = React.memo(() => {
  const [pads, setPads] = useState<DrumPad[]>(DEFAULT_PADS);
  const [activePadId, setActivePadId] = useState<string | null>(null);

  const triggerPad = useCallback((pad: DrumPad) => {
    ensureDrumEngine();
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
    <div className="card bg-panel border border-base-300 shadow-md">
      <div className="card-body p-3 sm:p-4">
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
                className={`btn relative w-full h-14 sm:h-16 border-0 rounded-field bg-gradient-to-br ${pad.color} p-1.5 sm:p-2 flex flex-col justify-between items-start shadow-sm transition-all duration-75 ${
                  isActive
                    ? 'ring-4 ring-primary brightness-125 scale-95 shadow-primary/30'
                    : 'hover:brightness-110 active:scale-95'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider truncate">
                    {pad.name.replace(' Drum', '').replace(' Snap', '').replace(' Cymbal', '')}
                  </span>
                  <kbd className="kbd-key">
                    {shortcutLabel(pad.shortcut)}
                  </kbd>
                </div>
              </button>

              {/* Volume Slider */}
              <div className="flex items-center gap-1 px-0.5">
                <Volume2 className="w-2.5 h-2.5 text-base-content/50 shrink-0" />
                <Slider
                  id={`slider-pad-vol-${pad.id}`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={pad.volume}
                  onChange={(val) => {
                    setPads((prev) => prev.map((p) => (p.id === pad.id ? { ...p, volume: val } : p)));
                  }}
                  className="range range-xs range-primary w-full"
                  title={`${pad.name} Volume`}
                />
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
});

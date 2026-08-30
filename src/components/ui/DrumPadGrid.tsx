import React from 'react';
import { Volume2 } from 'lucide-react';
import { shortcutLabel } from '../../utils/keyboard';
import type { DrumPad } from '../../types';
import { Slider } from './Slider';

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

export interface DrumPadGridProps {
  pads: DrumPad[];
  activePadId: string | null;
  onTriggerPad: (pad: DrumPad) => void;
  onPadVolumeChange: (padId: string, volume: number) => void;
}

/** The presentational pad grid, shared by the in-page DrumPads card and the
 *  dock's Drums tab. Owns no state; every interaction is lifted to the parent. */
export const DrumPadGrid: React.FC<DrumPadGridProps> = ({
  pads,
  activePadId,
  onTriggerPad,
  onPadVolumeChange,
}) => {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-2.5">
      {pads.map((pad) => {
        const isActive = activePadId === pad.id;
        return (
          <div key={pad.id} id={`drum-pad-card-${pad.id}`} className="flex flex-col gap-1">
            {/* Trigger Button Pad */}
            <button
              id={`btn-pad-${pad.id}`}
              onClick={() => onTriggerPad(pad)}
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
                onChange={(val) => onPadVolumeChange(pad.id, val)}
                className="range range-xs range-primary w-full"
                title={`${pad.name} Volume`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

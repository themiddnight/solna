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
 * The ten pads sit on the QWERTY bottom row, two rows of five, read
 * left-to-right top-to-bottom in canonical voice order:
 *   row 1  KeyZ=kick   KeyX=snare  KeyC=rimshot  KeyV=clap   KeyB=hihat
 *   row 2  KeyN=openhat KeyM=hitom Comma=lowtom  Period=ride Slash=crash
 * `bell` has no pad — see `PADLESS_VOICES` below — which frees `KeyQ`.
 *
 * `color` holds the full gradient stops plus the matching content token; it is
 * spliced into a `bg-gradient-to-br` className below. Each pad carries its own
 * `--color-drum-*` identity colour (`src/index.css`) instead of rotating
 * across the three semantic ramps, so adjacency always guarantees a colour
 * change.
 */
export const DEFAULT_PADS: DrumPad[] = [
  { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-drum-kick to-drum-kick/60 text-drum-kick-content', shortcut: 'KeyZ', volume: 0.9, pitch: 0, decay: 0.3 },
  { id: 'snare', name: 'Snare Snap', note: 'snare', color: 'from-drum-snare to-drum-snare/60 text-drum-snare-content', shortcut: 'KeyX', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'rimshot', name: 'Rim Shot', note: 'rimshot', color: 'from-drum-rimshot to-drum-rimshot/60 text-drum-rimshot-content', shortcut: 'KeyC', volume: 0.8, pitch: 0, decay: 0.12 },
  { id: 'clap', name: 'Hand Clap', note: 'clap', color: 'from-drum-clap to-drum-clap/60 text-drum-clap-content', shortcut: 'KeyV', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'hihat', name: 'Closed Hat', note: 'hihat', color: 'from-drum-hihat to-drum-hihat/60 text-drum-hihat-content', shortcut: 'KeyB', volume: 0.75, pitch: 0, decay: 0.05 },
  { id: 'openhat', name: 'Open Hat', note: 'openhat', color: 'from-drum-openhat to-drum-openhat/60 text-drum-openhat-content', shortcut: 'KeyN', volume: 0.8, pitch: 0, decay: 0.35 },
  { id: 'hitom', name: 'Hi Tom', note: 'hitom', color: 'from-drum-hitom to-drum-hitom/60 text-drum-hitom-content', shortcut: 'KeyM', volume: 0.8, pitch: 0, decay: 0.2 },
  { id: 'lowtom', name: 'Low Tom', note: 'lowtom', color: 'from-drum-lowtom to-drum-lowtom/60 text-drum-lowtom-content', shortcut: 'Comma', volume: 0.8, pitch: 0, decay: 0.25 },
  { id: 'ride', name: 'Ride Cymbal', note: 'ride', color: 'from-drum-ride to-drum-ride/60 text-drum-ride-content', shortcut: 'Period', volume: 0.75, pitch: 0, decay: 0.9 },
  { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-drum-crash to-drum-crash/60 text-drum-crash-content', shortcut: 'Slash', volume: 0.75, pitch: 0, decay: 0.8 },
];

/**
 * Voices with no pad. Ten pads fit one physical keyboard row (the QWERTY
 * bottom row); an eleventh did not, so `bell` was dropped from the grid. It
 * keeps its sequencer track, colour, kit entry and engine case — only the
 * pad goes. `DrumPadGrid.test.tsx` asserts that `DEFAULT_PADS`'s notes,
 * unioned with this list, equal `DRUM_TYPES` — so removing another voice
 * from the pads without adding it here fails loudly instead of silently.
 */
export const PADLESS_VOICES = ['bell'] as const;

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
    // 5 columns matches the two-row, five-per-row keyboard map exactly (ten
    // pads = 5+5, no ragged trailing row) at every width.
    <div className="grid grid-cols-5 gap-2 sm:gap-2.5">
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

import React from 'react';
import { shortcutLabel } from '@/utils/keyboard';
import type { DrumPad } from '@/types';

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
// A pad carries no level of its own: every pad strikes at the Beat page's
// audition velocity (`BEAT_PREVIEW_VELOCITY`), and what sets how loud a voice
// sounds is that voice's fader in the current loop's Beat mix, which the pad
// hit already passes through (R105).
export const DEFAULT_PADS: DrumPad[] = [
  { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-drum-kick to-drum-kick/60 text-drum-kick-content', shortcut: 'KeyZ', pitch: 0, decay: 0.3 },
  { id: 'snare', name: 'Snare Snap', note: 'snare', color: 'from-drum-snare to-drum-snare/60 text-drum-snare-content', shortcut: 'KeyX', pitch: 0, decay: 0.2 },
  { id: 'rimshot', name: 'Rim Shot', note: 'rimshot', color: 'from-drum-rimshot to-drum-rimshot/60 text-drum-rimshot-content', shortcut: 'KeyC', pitch: 0, decay: 0.12 },
  { id: 'clap', name: 'Hand Clap', note: 'clap', color: 'from-drum-clap to-drum-clap/60 text-drum-clap-content', shortcut: 'KeyV', pitch: 0, decay: 0.2 },
  { id: 'hihat', name: 'Closed Hat', note: 'hihat', color: 'from-drum-hihat to-drum-hihat/60 text-drum-hihat-content', shortcut: 'KeyB', pitch: 0, decay: 0.05 },
  { id: 'openhat', name: 'Open Hat', note: 'openhat', color: 'from-drum-openhat to-drum-openhat/60 text-drum-openhat-content', shortcut: 'KeyN', pitch: 0, decay: 0.35 },
  { id: 'hitom', name: 'Hi Tom', note: 'hitom', color: 'from-drum-hitom to-drum-hitom/60 text-drum-hitom-content', shortcut: 'KeyM', pitch: 0, decay: 0.2 },
  { id: 'lowtom', name: 'Low Tom', note: 'lowtom', color: 'from-drum-lowtom to-drum-lowtom/60 text-drum-lowtom-content', shortcut: 'Comma', pitch: 0, decay: 0.25 },
  { id: 'ride', name: 'Ride Cymbal', note: 'ride', color: 'from-drum-ride to-drum-ride/60 text-drum-ride-content', shortcut: 'Period', pitch: 0, decay: 0.9 },
  { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-drum-crash to-drum-crash/60 text-drum-crash-content', shortcut: 'Slash', pitch: 0, decay: 0.8 },
];

/**
 * Voices with no pad. Ten pads fit one physical keyboard row (the QWERTY
 * bottom row); an eleventh did not, so `bell` was dropped from the grid. It
 * keeps its Beat row, colour, patch entry and engine case — only the pad
 * goes. `DrumPadGrid.test.tsx` asserts that `DEFAULT_PADS`'s notes, unioned
 * with this list, equal `BEAT_VOICE_IDS` — so removing another voice from the
 * pads without adding it here fails loudly instead of silently.
 */
export const PADLESS_VOICES = ['bell'] as const;

export interface DrumPadGridProps {
  pads: DrumPad[];
  activePadId: string | null;
  onTriggerPad: (pad: DrumPad) => void;
}

/** The presentational pad grid, shared by the in-page DrumPads card and the
 *  dock's Drums tab. Owns no state; every interaction is lifted to the parent. */
export function DrumPadGrid({
  pads,
  activePadId,
  onTriggerPad,
}: DrumPadGridProps) {
  return (
    // 5 columns matches the two-row, five-per-row keyboard map exactly (ten
    // pads = 5+5, no ragged trailing row) at every width.
    <div className="grid grid-cols-5 gap-2 sm:gap-2.5">
      {pads.map((pad) => {
        const isActive = activePadId === pad.id;
        return (
          <div key={pad.id} id={`drum-pad-card-${pad.id}`}>
            <button
              id={`btn-pad-${pad.id}`}
              title={pad.name}
              onClick={() => onTriggerPad(pad)}
              className={`btn relative w-full h-14 sm:h-16 border-0 rounded-field bg-gradient-to-br ${pad.color} p-1.5 sm:p-2 flex flex-col justify-between items-start shadow-sm transition-all duration-75 ${
                isActive
                  ? 'ring-4 ring-primary brightness-125 scale-95 shadow-primary/30'
                  : 'hover:brightness-110 active:scale-95'
              }`}
            >
              {/* Stacked on a phone, side by side from `sm`. Five columns of a
                  375px screen leave a pad ~50px of inner width, and sharing
                  that row with the shortcut key truncated half the roster to
                  "HI T…" / "LOW…" / "CLO…" — three pads a user cannot tell
                  apart by name. Stacking gives the name the pad's full width
                  and lets it wrap to a second line instead of being cut. */}
              <div className="flex flex-col items-start gap-0.5 w-full sm:flex-row sm:items-center sm:justify-between sm:gap-0">
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider leading-tight text-left sm:truncate">
                  {pad.name.replace(' Drum', '').replace(' Snap', '').replace(' Cymbal', '')}
                </span>
                <kbd className="kbd-key">
                  {shortcutLabel(pad.shortcut)}
                </kbd>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

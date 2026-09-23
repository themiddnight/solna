import { useCallback, useState } from 'react';
import { useAppStore } from '../store/store';
import { aggregateAllPlayers, transportDisplayState } from '../store/transportSlice';
import type { Loop } from '../store/types';
import { getMeter, type MeterId } from '@/utils/timeSignature';
import { loopLabel } from '@/store/loop';
import { layerForTab } from '@/types';
import { playTargetLabel } from './transportAction';

/** The song-mode badge: present only while a song position exists. */
export function songModeLabel(
  songLoopIndex: number | null,
  loops: readonly Loop[],
): string | null {
  if (songLoopIndex === null) return null;
  const loop = loops[songLoopIndex];
  return loop ? `Song · ${loopLabel(loop)}` : null;
}

/** The mobile bar's read-only tempo readout: `120 · 4/4`. */
export function transportReadout(bpm: number, meterId: MeterId): string {
  return `${bpm} · ${getMeter(meterId).label}`;
}

export interface UseTransportBar {
  displayState: ReturnType<typeof transportDisplayState>;
  hardStopDisabled: boolean;
  /** Whether anything is sounding, off the true aggregate (the level meter's tier). */
  isPlaying: boolean;
  onPlay: () => void;
  onSoftStop: () => void;
  onHardStop: () => void;
  /** What Play will start: 'Song' on the song layer, the loop being edited on the loop layer. */
  target: string;
  songLabel: string | null;
  bpm: number;
  setBpm: (bpm: number) => void;
  meterId: MeterId;
  setMeter: (id: MeterId) => void;
  masterVolume: number;
  setMasterVolume: (db: number) => void;
  metronomeActive: boolean;
  toggleMetronome: () => void;
  /** The mobile transport sheet (R332): local UI state, never a slice (R016). */
  sheetOpen: boolean;
  toggleSheet: () => void;
  closeSheet: () => void;
}

/** The transport bar's store reads, its Play routing and the mobile sheet's open state. */
export function useTransportBar(): UseTransportBar {
  // Transport slice
  const playAll = useAppStore((s) => s.playAll);
  const soloLoop = useAppStore((s) => s.soloLoop);
  const softStopAll = useAppStore((s) => s.softStopAll);
  const hardStopAll = useAppStore((s) => s.hardStopAll);
  const bpm = useAppStore((s) => s.bpm);
  const setBpm = useAppStore((s) => s.setBpm);
  const meterId = useAppStore((s) => s.meterId);
  const setMeter = useAppStore((s) => s.setMeter);
  const masterVolume = useAppStore((s) => s.masterVolume);
  const setMasterVolume = useAppStore((s) => s.setMasterVolume);
  const metronomeActive = useAppStore((s) => s.metronomeActive);
  const toggleMetronome = useAppStore((s) => s.toggleMetronome);
  const playbackScope = useAppStore((s) => s.playbackScope);
  const activeTab = useAppStore((s) => s.activeTab);
  const activeLoopId = useAppStore((s) => s.activeLoopId);
  // Narrow selectors for label derivations: instead of subscribing to the whole
  // loops array (which changes on ANY loop field edit for ANY loop), each selector
  // reads only what it needs and returns a derived STRING. Re-render suppression
  // comes from that returned string's VALUE staying equal across an unrelated
  // `set()` (zustand's default `Object.is` comparator) — not from watching a
  // length or an index directly — so an edit to a loop's mix or mute leaves the
  // returned string unchanged and neither selector below re-renders the bar.
  //
  // This is a deliberate deviation from the original plan, which explicitly
  // REJECTED a `.find()`-based selector here: a narrower selector still
  // re-evaluates its body on every store `set()` app-wide (zustand has no
  // per-key subscription), and at the time that reasoning was written, a knob
  // drag's pointermove and a MIDI CC frame both wrote the store on every event
  // — making "re-evaluates on every set()" a real, measured cost, since a drag
  // could fire this selector dozens of times a second. Task 4 (synth/effects
  // draft-commit) and Task 8 (MIDI CC coalescing) removed both of those
  // high-frequency write sources, so the plan's own objection no longer applies
  // — a `set()` now happens at user-gesture rate, not per-pointermove/per-CC —
  // while the selector's win (skipping a full `TransportBar` subtree re-render
  // on every unrelated loop mix/mute edit) is unchanged. That is why the
  // narrower selector was reinstated here rather than reverted back to a
  // whole-array read.
  const activeLoopName = useAppStore((s) => {
    const activeLoop = s.loops.find((loop) => loop.id === s.activeLoopId);
    return activeLoop ? loopLabel(activeLoop) : '';
  });

  const aggregate = useAppStore(aggregateAllPlayers);
  const layer = layerForTab(activeTab);
  // On the song layer a solo-looping card leaves the master button offering
  // Play (a one-click takeover). On the loop layer the button owns the solo
  // loop of the loop being edited. Hard stop stays live off the REAL player
  // states, so sounding audio always has a visible global kill.
  const displayState = transportDisplayState(playbackScope, aggregate, layer, activeLoopId);
  // The meter loop only needs to know whether anything is sounding, off the
  // true aggregate — not the takeover-driven display state.
  const isPlaying = aggregate !== 'stopped';
  // Equivalent to `useAppStore(isAnyPlayerActive)`: `aggregate` already folds
  // every player's state the same way, so a second selector re-running
  // `allPlayerStates` on every store set() would only duplicate this one.
  const hardStopDisabled = !isPlaying;
  // Same narrow-selector tradeoff as `activeLoopName` above, and calls
  // `songModeLabel` directly rather than re-deriving its rule inline — the two
  // had drifted into two copies of one rule, with the tested one
  // (`TransportBar.test.tsx`) not the one that ran in production. `loops[i]` on
  // an empty array already yields `undefined`, so `songModeLabel` needs no
  // separate `loops.length === 0` guard for that case.
  const songLabel = useAppStore((s) => songModeLabel(s.songLoopIndex, s.loops));
  // The layer IS the choice: playAll() on song, soloLoop(activeLoopId) on loop.
  // It went through a `masterPlayTarget(layer)` helper that returned its own
  // argument — a function, a test and an import proving a ternary copied the
  // `Layer` union.
  const onPlay = () => {
    if (layer === 'song') {
      playAll();
      return;
    }
    soloLoop(activeLoopId);
  };

  const [sheetOpen, setSheetOpen] = useState(false);
  const toggleSheet = useCallback(() => setSheetOpen((open) => !open), []);
  // Stable: BottomSheet re-binds its close and Escape listeners whenever onClose changes.
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  return {
    displayState,
    hardStopDisabled,
    isPlaying,
    onPlay,
    onSoftStop: softStopAll,
    onHardStop: hardStopAll,
    target: playTargetLabel(layer, activeLoopName),
    songLabel,
    bpm,
    setBpm,
    meterId,
    setMeter,
    masterVolume,
    setMasterVolume,
    metronomeActive,
    toggleMetronome,
    sheetOpen,
    toggleSheet,
    closeSheet,
  };
}

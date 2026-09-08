import React from "react";
import { Volume2, Clock, Plus, Minus, X } from "lucide-react";
import { IconButton } from "./ui/IconButton";
import { useAppStore } from "../store/store";
import { soloChipLabel } from "@/store/trackAudibility";
import { useLiveStore } from "./ui/useLiveStore";
import { VolumeFader } from "@/components/ui/VolumeFader";
import { PlayerTransport } from "./ui/PlayerTransport";
import { PlayheadReadout } from "./PlayheadReadout";
import { VuMeter } from "./ui/VuMeter";
import { MidiIndicator } from "./ui/MidiIndicator";
import { aggregatePlayerState, isHardStopEnabled, transportDisplayState } from "../store/transportSlice";
import { METER_OPTIONS, coerceMeterChoice } from "./meterSelect";
import type { Loop } from '../store/types';
import { layerForTab } from '@/types';
import { playTargetLabel } from './transportAction';

/** The song-mode badge: present only while a song position exists. */
export function songModeLabel(
  songLoopIndex: number | null,
  loops: readonly Loop[],
): string | null {
  if (songLoopIndex === null) return null;
  const loop = loops[songLoopIndex];
  return loop ? `Song · ${loop.name}` : null;
}

export const TransportBar = React.memo(function TransportBar() {
  // Transport slice
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const leadPlayer = useAppStore((s) => s.leadPlayer);
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
  const songLoopIndex = useAppStore((s) => s.songLoopIndex);
  const loops = useAppStore((s) => s.loops);
  const playbackScope = useAppStore((s) => s.playbackScope);
  const activeTab = useAppStore((s) => s.activeTab);
  const activeLoopId = useAppStore((s) => s.activeLoopId);

  // Live reads (useLiveStore, not useAppStore): under renderToString a plain
  // useAppStore selector serves creation-time state, so the chip's test could
  // never latch a solo. Same reason Header.tsx reads its dirty flag this way.
  const soloTracks = useLiveStore((s) => s.soloTracks);
  const clearSoloTracks = useLiveStore((s) => s.clearSoloTracks);

  const aggregate = aggregatePlayerState(sequencerPlayer, chordsPlayer, leadPlayer);
  const layer = layerForTab(activeTab);
  // Derived in the render body, not in a selector: a zustand selector runs on
  // every store set() — including every pointermove of a knob drag, which does
  // not re-render this bar at all — whereas `loops` and `activeLoopId` are
  // already subscribed above, so scanning here costs one pass per render of
  // THIS component instead.
  const activeLoopName = loops.find((loop) => loop.id === activeLoopId)?.name ?? '';
  // On the song layer a solo-looping card leaves the master button offering
  // Play (a one-click takeover). On the loop layer the button owns the solo
  // loop of the loop being edited. Hard stop stays live off the REAL player
  // states, so sounding audio always has a visible global kill.
  const displayState = transportDisplayState(playbackScope, aggregate, layer, activeLoopId);
  const hardStopDisabled = !isHardStopEnabled(sequencerPlayer, chordsPlayer, leadPlayer);
  // The meter loop only needs to know whether anything is sounding, off the
  // true aggregate — not the takeover-driven display state.
  const isPlaying = aggregate !== 'stopped';
  const songLabel = songModeLabel(songLoopIndex, loops);
  const soloLabel = soloChipLabel(soloTracks);
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

  const handleToggleMetronome = () => {
    // Engine mirror happens via useEngineSync (one render later)
    toggleMetronome();
  };

  return (
    // Side columns are `minmax(max-content, 1fr)`: equal (so the playhead readout
    // sits dead-centre in the viewport) whenever there is room, and floored at
    // their own content width when there isn't — which degrades to an off-centre
    // readout instead of side groups overlapping or overflowing the bar.
    <div className="shrink-0 bg-base-100 border-t border-base-300 px-2 sm:px-3 py-1.5 sm:py-2 pb-safe sm:pb-safe-lg flex items-center justify-between gap-1.5 sm:gap-2 text-xs select-none sticky bottom-0 z-40 shadow-2xl">
      {/* Left Transport Actions: Play All + Tempo + Meter */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 min-w-0">
        {/* Master transport: drives both automation players together. */}
        <PlayerTransport
          id="btn-bottom-transport"
          state={displayState}
          size="sm"
          showHardStop
          hardStopDisabled={hardStopDisabled}
          onPlay={onPlay}
          onSoftStop={softStopAll}
          onHardStop={hardStopAll}
          showLabel
          describedBy="label-transport-play-target"
        />

        {/* What Play will start: 'Song' on the song layer, the loop being
            edited on the loop layer. Visible at every width — a click does
            one of two different things and the single Play button gives no
            other clue below `sm`, where the button's own text label hides.
            `id` ties it to the button via `aria-describedby` below: the
            button itself announces only "Play", so a screen reader reading
            the button alone gets no target without this tie. `max-w-20` is
            the live narrow-width cap now that this always renders; `sm:max-w-32`
            widens it once the song badge and BPM/meter controls have room too. */}
        <span
          id="label-transport-play-target"
          className="text-xs text-base-content/70 truncate max-w-20 sm:max-w-32 min-w-0"
        >
          {playTargetLabel(layer, activeLoopName)}
        </span>

        {songLabel && (
          <span
            id="badge-song-mode"
            className="badge badge-sm badge-ghost font-bold text-primary hidden md:inline-flex"
            title="Song mode: loops play in order in the song layer"
          >
            {songLabel}
          </span>
        )}

        {/* Track solo is session-only and clears itself on leaving the Loop
            layer, on a Pattern-segment change, or on changing loop — it
            survives a Sound <-> Pattern tab change, so this chip can outlive
            that, but it is still short-lived by construction. It still
            renders at EVERY width, unlike the song badge above: it is the
            only global "something is being silenced, and here is how to
            stop" affordance, so the names truncate rather than the chip
            disappearing. */}
        {soloLabel && (
          <span
            id="badge-track-solo"
            className="badge badge-sm badge-warning font-bold gap-1 max-w-32 sm:max-w-none"
            title="Track solo — cleared when you change Pattern segment, layer or loop"
          >
            <span className="truncate">{soloLabel}</span>
            <IconButton
              label="Clear solo"
              icon={<X className="w-3 h-3" />}
              size="xs"
              variant="ghost"
              className="btn-circle"
              onClick={clearSoloTracks}
            />
          </span>
        )}

        {/* Tempo BPM Control */}
        <div className="flex items-center gap-0.5 bg-base-200 border border-base-300 px-1 sm:px-1.5 py-0.5 sm:py-1 rounded-box">
          <span className="text-[10px] text-base-content/50 hidden sm:inline">BPM</span>
          <IconButton
            label="Decrease BPM"
            icon={<Minus className="w-3 h-3" />}
            size="xs"
            onClick={() => setBpm(Math.max(40, bpm - 1))}
          />
          <input
            id="input-transport-bpm"
            type="number"
            min={40}
            max={240}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="input input-xs input-ghost w-8 sm:w-12 px-0 text-center font-mono font-bold text-primary text-xs"
          />
          <IconButton
            label="Increase BPM"
            icon={<Plus className="w-3 h-3" />}
            size="xs"
            onClick={() => setBpm(Math.min(240, bpm + 1))}
          />
        </div>

        {/* Time Signature */}
        <div className="flex items-center gap-0.5 sm:gap-1 bg-base-200 border border-base-300 px-1 sm:px-1.5 py-0.5 sm:py-1 rounded-box">
          <span className="text-[10px] text-base-content/50 hidden sm:inline">Meter</span>
          <select
            id="select-transport-meter"
            value={meterId}
            onChange={(e) => setMeter(coerceMeterChoice(e.target.value, meterId))}
            className="select select-xs select-ghost focus:outline-none font-mono font-bold text-primary px-1"
            title="Time signature"
          >
            {METER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.title}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Middle: playhead readout — now/next chord + beat dots, visible on larger screens */}
      <div className="flex-1 max-w-xs hidden xl:flex items-center justify-center gap-2">
        <PlayheadReadout />
      </div>

      {/* Right Meter & Master Gain */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {/* Metronome Toggle */}
        <button
          id="btn-transport-metronome"
          onClick={handleToggleMetronome}
          className={`btn btn-sm btn-square sm:btn-md sm:w-auto sm:px-2 gap-1 text-xs ${
            metronomeActive ? "btn-primary" : "btn-ghost"
          }`}
          title="Metronome"
        >
          <Clock className="w-3.5 h-3.5" />
          <span className="hidden lg:inline text-[11px]">Click</span>
        </button>

        {/* MIDI Activity Indicator (hidden on small mobile to conserve space) */}
        <div className="hidden sm:block">
          <MidiIndicator />
        </div>

        {/* Real-time output level meter */}
        <VuMeter isPlaying={isPlaying} />

        {/* Master Output Fader */}
        <div className="flex items-center gap-1 bg-base-200 border border-base-300 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-box">
          <Volume2 className="w-3.5 h-3.5 text-base-content/60 shrink-0" />
          {/* The taper, the readout, the -inf detent and double-click-to-unity
              all live in VolumeFader — this bar states only the width and
              which readout it can afford. The readout is hidden below `sm`:
              both side groups are `shrink-0`, so under that breakpoint this
              bar has one fixed width (378px overran a 375px iPhone), and
              dropping the readout is what brings it back. The level stays
              readable from the fader position and exact in the `title`. */}
          <VolumeFader
            id="slider-transport-master"
            label="Master"
            valueDb={masterVolume}
            onChangeDb={setMasterVolume}
            className="range range-xs range-primary w-10 sm:w-16"
            readoutClassName="font-mono text-[10px] text-base-content/60 w-14 text-right hidden sm:inline"
          />
        </div>
      </div>
    </div>
  );
});

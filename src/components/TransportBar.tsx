import React from "react";
import { Volume2, Clock, Plus, Minus } from "lucide-react";
import { useAppStore } from "../store/store";
import { Slider } from "./ui/Slider";
import { PlayerTransport } from "./ui/PlayerTransport";
import { PlayheadReadout } from "./PlayheadReadout";
import { VuMeter } from "./ui/VuMeter";
import { MidiIndicator } from "./ui/MidiIndicator";
import { aggregatePlayerState, isHardStopEnabled } from "../store/transportSlice";
import { METER_OPTIONS, coerceMeterChoice } from "./meterSelect";
import type { Loop } from '../store/types';

/** The song-mode badge: present only while a song position exists. */
export function songModeLabel(
  songLoopIndex: number | null,
  loops: readonly Loop[],
): string | null {
  if (songLoopIndex === null) return null;
  const loop = loops[songLoopIndex];
  return loop ? `Song · ${loop.name}` : null;
}

export const TransportBar: React.FC = React.memo(() => {
  // Transport slice
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const leadPlayer = useAppStore((s) => s.leadPlayer);
  const playAll = useAppStore((s) => s.playAll);
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

  const aggregate = aggregatePlayerState(sequencerPlayer, chordsPlayer, leadPlayer);
  const hardStopDisabled = !isHardStopEnabled(sequencerPlayer, chordsPlayer, leadPlayer);
  // The meter loop only needs to know whether anything is sounding.
  const isPlaying = aggregate !== 'stopped';

  const handleToggleMetronome = () => {
    // Engine mirror happens via useEngineSync (one render later)
    toggleMetronome();
  };

  return (
    // Side columns are `minmax(max-content, 1fr)`: equal (so the playhead readout
    // sits dead-centre in the viewport) whenever there is room, and floored at
    // their own content width when there isn't — which degrades to an off-centre
    // readout instead of side groups overlapping or overflowing the bar.
    <div className="bg-base-100 border-t border-base-300 px-3 py-2 flex md:grid md:grid-cols-[minmax(max-content,1fr)_minmax(0,20rem)_minmax(max-content,1fr)] items-center justify-between gap-2 text-xs select-none sticky bottom-0 z-40 shadow-2xl overflow-x-auto no-scrollbar">
      {/* Left Transport Actions: Play All + Tab Play + Tempo */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Master transport: drives both automation players together. The
            hard stop stays live whenever anything is still scheduled, even
            when the aggregate reads `stopping`. */}
        <PlayerTransport
          id="btn-bottom-transport"
          state={aggregate}
          size="sm"
          showHardStop
          hardStopDisabled={hardStopDisabled}
          onPlay={playAll}
          onSoftStop={softStopAll}
          onHardStop={hardStopAll}
          showLabel
        />

        {songModeLabel(songLoopIndex, loops) && (
          <span
            id="badge-song-mode"
            className="badge badge-sm badge-ghost font-bold text-primary hidden md:inline-flex"
            title="Song mode: loops play in order in the song layer"
          >
            {songModeLabel(songLoopIndex, loops)}
          </span>
        )}

        {/* Tempo BPM Control */}
        <div className="flex items-center gap-0.5 bg-base-200 border border-base-300 px-1.5 py-1 rounded-box">
          <span className="text-[10px] text-base-content/50 hidden sm:inline">BPM</span>
          <button
            onClick={() => setBpm(Math.max(40, bpm - 1))}
            className="btn btn-xs btn-square btn-ghost"
            title="Decrease BPM"
          >
            <Minus className="w-3 h-3" />
          </button>
          <input
            id="input-transport-bpm"
            type="number"
            min={40}
            max={240}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="input input-xs input-ghost w-12 px-0 text-center font-mono font-bold text-primary text-xs"
          />
          <button
            onClick={() => setBpm(Math.min(240, bpm + 1))}
            className="btn btn-xs btn-square btn-ghost"
            title="Increase BPM"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Time Signature */}
        <div className="flex items-center gap-1 bg-base-200 border border-base-300 px-1.5 py-1 rounded-box">
          <span className="text-[10px] text-base-content/50 hidden sm:inline">Meter</span>
          <select
            id="select-transport-meter"
            value={meterId}
            onChange={(e) => setMeter(coerceMeterChoice(e.target.value, meterId))}
            className="select select-xs select-ghost focus:outline-none font-mono font-bold text-primary"
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

      {/* Middle: playhead readout — now/next chord + beat dots, visible on every tab */}
      <div className="flex-1 max-w-xs hidden md:flex items-center gap-2">
        <PlayheadReadout />
      </div>

      {/* Right Meter & Master Gain */}
      <div className="flex items-center gap-2 shrink-0 md:justify-self-end">
        {/* Metronome Toggle */}
        <button
          id="btn-transport-metronome"
          onClick={handleToggleMetronome}
          className={`btn btn-sm gap-1 text-xs ${
            metronomeActive ? "btn-primary" : "btn-ghost"
          }`}
          title="Metronome"
        >
          <Clock className="w-3.5 h-3.5" />
          <span className="hidden lg:inline text-[11px]">Click</span>
        </button>

        {/* MIDI Activity Indicator */}
        <MidiIndicator />

        {/* Real-time output level meter — owns its own rAF loop so the level
            does not re-render the transport bar (see ui/VuMeter). */}
        <VuMeter isPlaying={isPlaying} />

        {/* Master Output Fader */}
        <div className="flex items-center gap-1 bg-base-200 border border-base-300 px-2 py-1 rounded-box">
          <Volume2 className="w-3.5 h-3.5 text-base-content/60 shrink-0" />
          <Slider
            id="slider-transport-master"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={setMasterVolume}
            className="range range-xs range-primary w-14 sm:w-16"
            title={`Master: ${(masterVolume * 100).toFixed(0)}%`}
          />
          <span className="font-mono text-[10px] text-base-content/60 w-6 text-right">
            {(masterVolume * 100).toFixed(0)}
          </span>
        </div>
      </div>
    </div>
  );
});

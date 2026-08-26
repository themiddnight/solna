import React, { useState, useEffect, useRef } from "react";
import { Volume2, Clock, Waves, Plus, Minus } from "lucide-react";
import { audioEngine } from "../audio/engine";
import { AudioVisualizer, VisualizerMode } from "./AudioVisualizer";
import { useAppStore } from "../store/store";
import { Slider } from "./ui/Slider";
import { PlayerTransport } from "./ui/PlayerTransport";
import { aggregatePlayerState, isHardStopEnabled } from "../store/transportSlice";

export const TransportBar: React.FC = React.memo(() => {
  // Transport slice
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const playAll = useAppStore((s) => s.playAll);
  const softStopAll = useAppStore((s) => s.softStopAll);
  const hardStopAll = useAppStore((s) => s.hardStopAll);
  const bpm = useAppStore((s) => s.bpm);
  const setBpm = useAppStore((s) => s.setBpm);
  const masterVolume = useAppStore((s) => s.masterVolume);
  const setMasterVolume = useAppStore((s) => s.setMasterVolume);
  const metronomeActive = useAppStore((s) => s.metronomeActive);
  const toggleMetronome = useAppStore((s) => s.toggleMetronome);

  // Local visualizer state
  const [vuLevel, setVuLevel] = useState(0);
  const [vizMode, setVizMode] = useState<VisualizerMode>("wave");

  const aggregate = aggregatePlayerState(sequencerPlayer, chordsPlayer);
  const hardStopDisabled = !isHardStopEnabled(sequencerPlayer, chordsPlayer);
  // The meter loop only needs to know whether anything is sounding.
  const isPlaying = aggregate !== 'stopped';

  // Meter polling loop — runs only while playing, and only commits state when
  // the level moved enough to change a VU segment (avoids 60 re-renders/sec)
  const vuLevelRef = useRef(0);
  useEffect(() => {
    if (!isPlaying) {
      setVuLevel(0);
      vuLevelRef.current = 0;
      return;
    }
    let animId: number;
    const updateMeter = () => {
      const level = audioEngine.getAudioLevel();
      if (Math.abs(level - vuLevelRef.current) > 0.02) {
        vuLevelRef.current = level;
        setVuLevel(level);
      }
      animId = requestAnimationFrame(updateMeter);
    };
    animId = requestAnimationFrame(updateMeter);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  const handleToggleMetronome = () => {
    // Engine mirror happens via useEngineSync (one render later)
    toggleMetronome();
  };

  return (
    <div className="bg-base-100 border-t border-base-300 px-3 py-2 flex items-center justify-between gap-2 text-xs select-none sticky bottom-0 z-40 shadow-2xl">
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
      </div>

      {/* Middle Audio Spectrum Wave (Desktop & Tablet) */}
      <div className="flex-1 max-w-xs hidden md:flex items-center gap-2">
        <div className="flex-1 bg-base-200 border border-base-300 rounded-box p-1 flex items-center relative overflow-hidden shadow-inner group">
          <AudioVisualizer
            mode={vizMode}
            height={24}
            className="w-full rounded"
            colorTheme="primary"
            showControls={false}
          />
          <button
            onClick={() => {
              const modes: VisualizerMode[] = ["wave", "bars", "oscilloscope"];
              const nextIndex = (modes.indexOf(vizMode) + 1) % modes.length;
              setVizMode(modes[nextIndex]);
            }}
            className="btn btn-xs btn-square btn-ghost absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Switch Visualizer Mode"
          >
            <Waves className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Right Meter & Master Gain */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Real-time Stereo VU Meter */}
        <div className="hidden sm:flex items-center gap-1 bg-base-200 border border-base-300 p-1.5 rounded-box">
          <div className="w-14 h-2 bg-base-300 rounded-xs overflow-hidden flex gap-0.5 p-0.5">
            {Array.from({ length: 10 }).map((_, i) => {
              const active = vuLevel * 10 > i;
              const isRed = i >= 8;
              const isYellow = i >= 6 && i < 8;

              return (
                <div
                  key={i}
                  className={`flex-1 rounded-xs transition-colors duration-75 ${
                    active
                      ? isRed
                        ? "bg-error"
                        : isYellow
                          ? "bg-warning"
                          : "bg-success"
                      : "bg-base-300/50"
                  }`}
                />
              );
            })}
          </div>
        </div>

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

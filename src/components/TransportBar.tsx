import React, { useState, useEffect, useRef } from "react";
import { Play, Square, Volume2, Clock, Waves, Plus, Minus } from "lucide-react";
import { audioEngine } from "../audio/engine";
import { AudioVisualizer, VisualizerMode } from "./AudioVisualizer";
import { useAppStore } from "../store/store";

export const TransportBar: React.FC = React.memo(() => {
  // UI slice
  const activeTab = useAppStore((s) => s.activeTab);

  // Transport slice
  const isSequencerPlaying = useAppStore((s) => s.isSequencerPlaying);
  const isChordsPlaying = useAppStore((s) => s.isChordsPlaying);
  const bpm = useAppStore((s) => s.bpm);
  const setBpm = useAppStore((s) => s.setBpm);
  const masterVolume = useAppStore((s) => s.masterVolume);
  const setMasterVolume = useAppStore((s) => s.setMasterVolume);
  const metronomeActive = useAppStore((s) => s.metronomeActive);
  const toggleMetronome = useAppStore((s) => s.toggleMetronome);
  const toggleMasterPlay = useAppStore((s) => s.toggleMasterPlay);

  // Music context slice (read-only)
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);

  // Local visualizer state
  const [vuLevel, setVuLevel] = useState(0);
  const [vizMode, setVizMode] = useState<VisualizerMode>("wave");

  // Derived transport state (same logic that used to live in App.tsx)
  const isPlaying =
    activeTab === "sequencer"
      ? isSequencerPlaying
      : activeTab === "chords"
        ? isChordsPlaying
        : false;
  const isPlayingAll = isSequencerPlaying || isChordsPlaying;
  const isPlayDisabled = !["sequencer", "chords"].includes(activeTab);

  // Toggle whichever engine is attached to the current tab (same semantics as
  // the old toggleCurrentTabPlay handler in App.tsx)
  const onTogglePlay = () => {
    const {
      activeTab: tab,
      toggleSequencerPlay,
      toggleChordsPlay,
    } = useAppStore.getState();
    if (tab === "sequencer") {
      toggleSequencerPlay();
    } else if (tab === "chords") {
      toggleChordsPlay();
    }
  };
  const onTogglePlayAll = toggleMasterPlay;

  // Meter polling loop — runs only while playing, and only commits state when
  // the level moved enough to change a VU segment (avoids 60 re-renders/sec)
  const vuLevelRef = useRef(0);
  useEffect(() => {
    if (!isPlaying && !isPlayingAll) {
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
  }, [isPlaying, isPlayingAll]);

  const handleToggleMetronome = () => {
    // Engine mirror happens via useEngineSync (one render later)
    toggleMetronome();
  };

  const currentTabLabel =
    activeTab === "sequencer"
      ? "MATRIX"
      : activeTab === "chords"
        ? "CHORDS"
        : "TAB";

  return (
    <div className="bg-[#12152A] border-t border-[#252B48] px-3 py-2 flex items-center justify-between gap-2 text-xs select-none sticky bottom-0 z-40 shadow-2xl">
      {/* Left Transport Actions: Play All + Tab Play + Tempo */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Play All Button */}
        <button
          id="btn-bottom-play-all"
          onClick={onTogglePlayAll}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer shadow-xs ${
            isPlayingAll
              ? "bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-amber-500/20"
              : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20"
          }`}
          title="Play/Stop All"
        >
          {isPlayingAll ? (
            <Square className="w-3.5 h-3.5 fill-current" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
          <span className="hidden sm:inline">{isPlayingAll ? "Stop All" : "Play All"}</span>
        </button>

        {/* Tab Specific Play Button */}
        <button
          id="btn-bottom-play"
          onClick={onTogglePlay}
          disabled={isPlayDisabled}
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
            isPlayDisabled
              ? "bg-slate-800/60 text-slate-500 border border-[#252B48] cursor-not-allowed opacity-50"
              : isPlaying
                ? "bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs"
                : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs"
          }`}
          title={`Play/Stop ${currentTabLabel}`}
        >
          {isPlaying ? (
            <Square className="w-3.5 h-3.5 fill-current" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
          <span>{currentTabLabel}</span>
        </button>

        {/* Tempo BPM Control */}
        <div className="flex items-center gap-0.5 bg-[#0B0D19] border border-[#252B48] px-1.5 py-1 rounded-lg">
          <span className="text-[10px] text-slate-500 font-mono hidden xs:inline">BPM</span>
          <button
            onClick={() => setBpm(Math.max(40, bpm - 1))}
            className="p-0.5 text-slate-400 hover:text-white rounded hover:bg-[#1C213E] cursor-pointer"
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
            className="w-8 bg-transparent text-center font-mono font-bold text-indigo-300 focus:outline-none focus:text-white text-xs"
          />
          <button
            onClick={() => setBpm(Math.min(240, bpm + 1))}
            className="p-0.5 text-slate-400 hover:text-white rounded hover:bg-[#1C213E] cursor-pointer"
            title="Increase BPM"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Metronome Toggle */}
        <button
          id="btn-transport-metronome"
          onClick={handleToggleMetronome}
          className={`flex items-center gap-1 p-1.5 sm:px-2 sm:py-1 rounded-lg border text-xs cursor-pointer transition-colors ${
            metronomeActive
              ? "bg-indigo-600 border-indigo-500 text-white shadow-xs"
              : "bg-[#0B0D19] border-[#252B48] text-slate-400 hover:text-slate-200"
          }`}
          title="Metronome"
        >
          <Clock className="w-3.5 h-3.5" />
          <span className="hidden lg:inline text-[11px]">Click</span>
        </button>
      </div>

      {/* Middle Audio Spectrum Wave (Desktop & Tablet) */}
      <div className="flex-1 max-w-xs hidden md:flex items-center gap-2">
        <div className="flex-1 bg-[#0B0D19] border border-[#252B48] rounded-lg p-1 flex items-center relative overflow-hidden shadow-inner group">
          <AudioVisualizer
            mode={vizMode}
            height={24}
            className="w-full rounded"
            colorTheme="indigo"
            showControls={false}
          />
          <button
            onClick={() => {
              const modes: VisualizerMode[] = ["wave", "bars", "oscilloscope"];
              const nextIndex = (modes.indexOf(vizMode) + 1) % modes.length;
              setVizMode(modes[nextIndex]);
            }}
            className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-[#161B36]/90 text-slate-300 hover:text-white px-1 py-0.5 rounded text-[9px] flex items-center gap-0.5 border border-[#252B48] cursor-pointer"
            title="Switch Visualizer Mode"
          >
            <Waves className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Right Meter & Master Gain */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Real-time Stereo VU Meter */}
        <div className="hidden sm:flex items-center gap-1 bg-[#0B0D19] border border-[#252B48] p-1.5 rounded-lg">
          <div className="w-14 h-2 bg-[#161B36] rounded-xs overflow-hidden flex gap-0.5 p-0.5">
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
                        ? "bg-rose-500"
                        : isYellow
                          ? "bg-amber-400"
                          : "bg-emerald-400"
                      : "bg-[#22284C]"
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Master Output Fader */}
        <div className="flex items-center gap-1 bg-[#0B0D19] border border-[#252B48] px-2 py-1 rounded-lg">
          <Volume2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            id="slider-transport-master"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
            className="w-14 sm:w-16 h-1.5 bg-[#252B48] rounded cursor-pointer accent-indigo-500"
            title={`Master: ${(masterVolume * 100).toFixed(0)}%`}
          />
          <span className="font-mono text-[10px] text-slate-400 w-6 text-right">
            {(masterVolume * 100).toFixed(0)}
          </span>
        </div>
      </div>
    </div>
  );
});

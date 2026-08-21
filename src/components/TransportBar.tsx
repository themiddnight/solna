import React, { useState, useEffect } from 'react';
import { Play, Square, Circle, Repeat, Volume2, Music, Clock, Waves } from 'lucide-react';
import { audioEngine } from '../audio/engine';
import { AudioVisualizer, VisualizerMode } from './AudioVisualizer';

interface TransportBarProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  isPlayingAll: boolean;
  onTogglePlayAll: () => void;
  bpm: number;
  onChangeBpm: (bpm: number) => void;
  scaleRoot: string;
  scaleType: string;
  masterVolume: number;
  onChangeMasterVolume: (vol: number) => void;
  isPlayDisabled?: boolean;
}

export const TransportBar: React.FC<TransportBarProps> = ({
  isPlaying,
  onTogglePlay,
  isPlayingAll,
  onTogglePlayAll,
  bpm,
  onChangeBpm,
  scaleRoot,
  scaleType,
  masterVolume,
  onChangeMasterVolume,
  isPlayDisabled = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [vuLevel, setVuLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [vizMode, setVizMode] = useState<VisualizerMode>('wave');

  // Meter polling loop
  useEffect(() => {
    let animId: number;
    const updateMeter = () => {
      if (isPlaying) {
        const level = audioEngine.getAudioLevel();
        setVuLevel(level);
      } else {
        setVuLevel(0);
      }
      animId = requestAnimationFrame(updateMeter);
    };
    animId = requestAnimationFrame(updateMeter);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying) {
      setSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-[#12152A] border-t border-[#252B48] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs select-none sticky bottom-0 z-40 shadow-2xl">
      {/* Left Transport Actions */}
      <div className="flex items-center gap-2">
        <button
          id="btn-bottom-play-all"
          onClick={onTogglePlayAll}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
            isPlayingAll
              ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20'
          }`}
        >
          {isPlayingAll ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          <span>{isPlayingAll ? 'STOP ALL' : 'PLAY ALL'}</span>
        </button>

        <div className="w-px h-8 bg-[#252B48] mx-1" />

        <button
          id="btn-bottom-play"
          onClick={onTogglePlay}
          disabled={isPlayDisabled}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
            isPlayDisabled
              ? 'bg-slate-800 text-slate-500 border border-[#252B48] cursor-not-allowed opacity-50'
              : isPlaying
              ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
          }`}
        >
          {isPlaying ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
        </button>

        <button
          id="btn-bottom-record"
          onClick={() => setIsRecording(!isRecording)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer border ${
            isRecording
              ? 'bg-rose-600 border-rose-500 text-white animate-pulse'
              : 'bg-[#0B0D19] border-[#252B48] text-slate-400 hover:text-slate-200'
          }`}
        >
          <Circle className="w-3.5 h-3.5 fill-current" />
          <span>REC</span>
        </button>

        <button
          id="btn-bottom-loop"
          onClick={() => setIsLooping(!isLooping)}
          className={`p-2 rounded-lg border transition-all cursor-pointer ${
            isLooping
              ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
              : 'bg-[#0B0D19] border-[#252B48] text-slate-400 hover:text-slate-200'
          }`}
          title="Loop Playback"
        >
          <Repeat className="w-4 h-4" />
        </button>

        {/* Time Counter */}
        <div className="bg-[#0B0D19] border border-[#252B48] px-3 py-1.5 rounded-lg font-mono text-xs text-indigo-300 flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span>{formatTime(seconds)}</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">4/4</span>
        </div>
      </div>

      {/* Middle Harmony & Scale Info & Audio Spectrum Wave */}
      <div className="flex-1 max-w-xs md:max-w-md hidden sm:flex items-center gap-3">
        {/* Real-time Spectrum Wave in Transport */}
        <div className="flex-1 bg-[#0B0D19] border border-[#252B48] rounded-lg p-1 flex items-center relative overflow-hidden shadow-inner group">
          <AudioVisualizer
            mode={vizMode}
            height={32}
            className="w-full rounded"
            colorTheme="indigo"
            showControls={false}
          />
          <button
            onClick={() => {
              const modes: VisualizerMode[] = ['wave', 'bars', 'oscilloscope'];
              const nextIndex = (modes.indexOf(vizMode) + 1) % modes.length;
              setVizMode(modes[nextIndex]);
            }}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-[#161B36]/80 hover:bg-indigo-600 text-slate-300 hover:text-white p-1 rounded text-[10px] flex items-center gap-1 border border-[#252B48]"
            title="Click to switch Visualizer Mode (Wave / Bars / Oscilloscope)"
          >
            <Waves className="w-2.5 h-2.5" />
            <span className="capitalize text-[8px]">{vizMode}</span>
          </button>
        </div>

      </div>

      {/* Right Meter & Master Gain */}
      <div className="flex items-center gap-3">
        {/* Real-time Stereo VU Meter */}
        <div className="flex items-center gap-1 bg-[#0B0D19] border border-[#252B48] p-1.5 rounded-lg">
          <span className="text-[9px] font-mono text-slate-500 pr-1">VU</span>
          <div className="w-24 h-3 bg-[#161B36] rounded-sm overflow-hidden flex gap-0.5 p-0.5">
            {Array.from({ length: 12 }).map((_, i) => {
              const active = vuLevel * 12 > i;
              const isRed = i >= 10;
              const isYellow = i >= 8 && i < 10;

              return (
                <div
                  key={i}
                  className={`flex-1 rounded-xs transition-colors duration-75 ${
                    active
                      ? isRed
                        ? 'bg-rose-500'
                        : isYellow
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                      : 'bg-[#22284C]'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Master Output Fader */}
        <div className="flex items-center gap-1.5 bg-[#0B0D19] border border-[#252B48] px-2 py-1.5 rounded-lg">
          <Volume2 className="w-3.5 h-3.5 text-slate-400" />
          <input
            id="slider-transport-master"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              onChangeMasterVolume(val);
              audioEngine.setMasterVolume(val);
            }}
            className="w-20 h-1.5 bg-[#252B48] rounded cursor-pointer"
          />
          <span className="font-mono text-[10px] text-slate-300 w-7 text-right">
            {(masterVolume * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
};

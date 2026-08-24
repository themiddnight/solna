import { useState, useEffect } from "react";
import {
  Grid,
  Play,
  RotateCcw,
  Shuffle,
  ArrowLeft,
  ArrowRight,
  Volume2,
  VolumeX,
  Sparkles,
  Disc3,
  Filter,
} from "lucide-react";
import { useAppStore } from "../store/store";
import { useSequencerPlayback } from "./useSequencerPlayback";
import { triggerPad } from "../audio/playback/drumPlayback";
import { previewSequencerNote } from "../audio/playback/presetPreview";
import { GENRE_PRESETS } from "../audio/data/genrePresets";
import { DRUM_KITS, GENRE_TO_KIT } from "../audio/drumKits";
import { DrumPads } from "./DrumPads";
import { Knob } from "./ui/Knob";
import { Slider } from "./ui/Slider";


export const SequencerView = () => {
  // Sequencer/transport/synth state + setters (named after the old props so the
  // rest of the component body is unchanged).
  const tracks = useAppStore((s) => s.sequencerTracks);
  const onChangeTracks = useAppStore((s) => s.setSequencerTracks);
  const isPlaying = useAppStore((s) => s.isSequencerPlaying);
  const synthParams = useAppStore((s) => s.synthParams);
  const soundKit = useAppStore((s) => s.soundKit);
  const onChangeSoundKit = useAppStore((s) => s.setSoundKit);
  const masterSequencerVolume = useAppStore((s) => s.masterSequencerVolume);
  const setMasterSequencerVolume = useAppStore(
    (s) => s.setMasterSequencerVolume,
  );
  const drumFilterCutoff = useAppStore((s) => s.drumFilterCutoff);
  const drumFilterResonance = useAppStore((s) => s.drumFilterResonance);
  const drumFilterType = useAppStore((s) => s.drumFilterType);
  const setDrumFilterCutoff = useAppStore((s) => s.setDrumFilterCutoff);
  const setDrumFilterResonance = useAppStore((s) => s.setDrumFilterResonance);
  const setDrumFilterType = useAppStore((s) => s.setDrumFilterType);

  const { currentStep } = useSequencerPlayback();
  const [selectedGenre, setSelectedGenre] = useState<string>("Synthwave");

  useEffect(() => {
    onChangeSoundKit(GENRE_TO_KIT[selectedGenre] ?? selectedGenre);
  }, [selectedGenre, onChangeSoundKit]);

  const toggleStep = (trackId: string, stepIndex: number) => {
    onChangeTracks(
      tracks.map((t) => {
        if (t.id !== trackId) return t;
        const newSteps = [...t.steps];
        newSteps[stepIndex] = !newSteps[stepIndex];
        return { ...t, steps: newSteps };
      }),
    );
  };

  const toggleMute = (trackId: string) => {
    onChangeTracks(
      tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
    );
  };

  const clearAllSteps = () => {
    onChangeTracks(
      tracks.map((t) => ({
        ...t,
        steps: new Array(16).fill(false),
      })),
    );
  };

  const randomizeSteps = () => {
    onChangeTracks(
      tracks.map((t) => ({
        ...t,
        steps: Array.from({ length: 16 }, () => Math.random() > 0.75),
      })),
    );
  };

  const shiftSteps = (direction: "left" | "right") => {
    onChangeTracks(
      tracks.map((t) => {
        const newSteps = [...t.steps];
        if (direction === "right") {
          const last = newSteps.pop()!;
          newSteps.unshift(last);
        } else {
          const first = newSteps.shift()!;
          newSteps.push(first);
        }
        return { ...t, steps: newSteps };
      }),
    );
  };

  const applyGenrePreset = (genre: string) => {
    setSelectedGenre(genre);
    const preset = GENRE_PRESETS[genre];
    if (!preset) return;

    onChangeTracks(
      tracks.map((t) => {
        const pattern = preset[t.instrument];
        if (pattern) {
          return { ...t, steps: [...pattern] };
        }
        return t;
      }),
    );
  };

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* Top Header & Preset Bar */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2.5 shadow-md">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-400">
            <Grid className="w-4 h-4" />
          </div>
          <h2 className="font-bold text-sm sm:text-base text-slate-100">
            Drum Sequencer (16-Step)
          </h2>
        </div>

        {/* Preset & Action Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Master Volume */}
          <div className="flex items-center gap-1.5 mr-2">
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={masterSequencerVolume}
              onChange={setMasterSequencerVolume}
              className="w-16 sm:w-20 h-1.5 bg-[#0B0D19] rounded-lg cursor-pointer accent-emerald-500"
              title="Drums Master Volume"
            />
          </div>

          {/* Genre selector */}
          <div className="flex items-center gap-1 bg-[#0B0D19] border border-[#2D355A] px-2 py-1 rounded-lg">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <select
              id="select-sequencer-genre"
              value={selectedGenre}
              onChange={(e) => applyGenrePreset(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              {Object.keys(GENRE_PRESETS).map((g) => (
                <option key={g} value={g} className="bg-[#12152A]">
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* Sound kit selector */}
          <div className="flex items-center gap-1 bg-[#0B0D19] border border-[#2D355A] px-2 py-1 rounded-lg">
            <Disc3 className="w-3 h-3 text-pink-400" />
            <select
              id="select-sequencer-sound-kit"
              value={soundKit}
              onChange={(e) => onChangeSoundKit(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              {Object.keys(DRUM_KITS).map((k) => (
                <option key={k} value={k} className="bg-[#12152A]">
                  {k}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              id="btn-shift-left"
              onClick={() => shiftSteps("left")}
              className="p-1.5 rounded-lg bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Shift Pattern Left"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>

            <button
              id="btn-shift-right"
              onClick={() => shiftSteps("right")}
              className="p-1.5 rounded-lg bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Shift Pattern Right"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              id="btn-randomize-grid"
              onClick={randomizeSteps}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors text-xs font-medium cursor-pointer"
              title="Randomize Steps"
            >
              <Shuffle className="w-3 h-3" />
              <span className="hidden sm:inline">Random</span>
            </button>

            <button
              id="btn-clear-grid"
              onClick={clearAllSteps}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors text-xs font-medium cursor-pointer"
              title="Clear Steps"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>
      </div>

      {/* Drum Filter — global lowpass/bandpass/highpass on the drum bus */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 sm:p-4 shadow-md">
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-pink-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Drum Filter
            </span>
          </div>

          <div className="flex items-center gap-5 flex-wrap">
            <div className="grid grid-cols-3 gap-1 w-32">
              {(["lowpass", "bandpass", "highpass"] as const).map((t) => (
                <button
                  key={t}
                  id={`btn-drum-filter-${t}`}
                  onClick={() => setDrumFilterType(t)}
                  className={`py-1 text-[10px] rounded font-semibold uppercase transition-all cursor-pointer ${
                    drumFilterType === t
                      ? "bg-pink-600 text-white shadow-sm"
                      : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                  }`}
                >
                  {t === "lowpass" ? "LPF" : t === "bandpass" ? "BPF" : "HPF"}
                </button>
              ))}
            </div>

            <Knob
              id="knob-drum-filter-cutoff"
              label="Cutoff"
              color="text-pink-400"
              layout="horizontal"
              value={drumFilterCutoff}
              min={50}
              max={12000}
              step={10}
              scale="log"
              format={(v) => `${Math.round(v)} Hz`}
              onChange={setDrumFilterCutoff}
            />

            <Knob
              id="knob-drum-filter-resonance"
              label="Res"
              color="text-pink-400"
              layout="horizontal"
              value={drumFilterResonance}
              min={0.1}
              max={20}
              step={0.1}
              scale="linear"
              format={(v) => v.toFixed(1)}
              onChange={setDrumFilterResonance}
            />
          </div>
        </div>
      </div>

      {/* Sequencer Grid */}
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 sm:p-4 overflow-x-auto shadow-md">
        {/* Step Indicator Header (1-16) */}
        <div className="flex items-center gap-2 mb-2 pl-44 min-w-[700px]">
          {Array.from({ length: 16 }).map((_, i) => {
            const isDownbeat = i % 4 === 0;
            const isCurrent = currentStep === i && isPlaying;
            return (
              <div
                key={i}
                className={`flex-1 text-center font-mono text-[10px] py-1 rounded transition-all ${
                  isCurrent
                    ? "bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/50"
                    : isDownbeat
                      ? "text-indigo-400 font-bold bg-[#1C213E]/40"
                      : "text-slate-500"
                }`}
              >
                {i + 1}
              </div>
            );
          })}
        </div>

        {/* Track Lanes */}
        <div className="space-y-2 min-w-[700px]">
          {tracks.map((track) => (
            <div
              key={track.id}
              id={`sequencer-row-${track.id}`}
              className="flex items-center gap-2 bg-[#0B0D19] p-2 rounded-lg border border-[#252B48] hover:border-[#3B4371] transition-colors"
            >
              {/* Track Info & Mute */}
              <div className="w-40 flex items-center justify-between pr-2 border-r border-[#252B48]">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${track.color}`} />
                  <span className="text-xs font-bold text-slate-200 truncate">
                    {track.name}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (
                        track.instrument === "synth" ||
                        track.instrument === "bass"
                      ) {
                        const note = track.instrument === "bass" ? "C2" : "C4";
                        previewSequencerNote(note, synthParams, 0.8);
                      } else {
                        triggerPad(track.instrument, 0.8);
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                    title="Preview Instrument"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    id={`btn-mute-${track.id}`}
                    onClick={() => toggleMute(track.id)}
                    className={`p-1 rounded cursor-pointer transition-colors ${
                      track.muted
                        ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title={track.muted ? "Unmute" : "Mute"}
                  >
                    {track.muted ? (
                      <VolumeX className="w-3.5 h-3.5" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* 16 Step Buttons */}
              <div className="flex-1 flex items-center gap-1.5">
                {track.steps.map((isActive, stepIdx) => {
                  const isBeatGroup = Math.floor(stepIdx / 4) % 2 === 0;
                  const isCurrent = currentStep === stepIdx && isPlaying;

                  return (
                    <button
                      key={stepIdx}
                      id={`step-${track.id}-${stepIdx}`}
                      onClick={() => toggleStep(track.id, stepIdx)}
                      className={`flex-1 h-9 rounded-md transition-all cursor-pointer relative ${
                        isActive
                          ? `${track.color} shadow-md shadow-indigo-500/20 scale-[0.96]`
                          : isBeatGroup
                            ? "bg-[#181C35] hover:bg-[#252B48] border border-[#2D355A]/50"
                            : "bg-[#12152A] hover:bg-[#1E2342] border border-[#252B48]/40"
                      } ${isCurrent ? "ring-2 ring-emerald-400 brightness-125" : ""}`}
                    >
                      {isActive && (
                        <div className="absolute inset-0 bg-white/20 rounded-md animate-pulse" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Performance Drum Pads */}
      <DrumPads />
    </div>
  );
};

import { useState, useEffect, useRef } from "react";
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
import { getMeter } from "../utils/meter";
import { sequencerTitle, stepCells } from "./sequencerGrid";
import { rotateStepWindow, writeStepWindow } from "../utils/patternAdapt";
import { useSequencerPlayback } from "./useSequencerPlayback";
import { ensureDrumEngine, triggerPad } from "../audio/playback/drumPlayback";
import { previewSequencerNote } from "../audio/playback/presetPreview";
import type { PreviewHandle } from "../audio/playback/presetPreview";
import { GENRE_PRESETS } from "../audio/data/genrePresets";
import { DRUM_KITS, GENRE_TO_KIT } from "../audio/drumKits";
import { DrumPads } from "./DrumPads";
import { patternMeterTitle, patternOptionLabel } from "./meterSelect";
import { Knob } from "./ui/Knob";
import { Slider } from "./ui/Slider";


export const SequencerView = () => {
  // Sequencer/transport/synth state + setters (named after the old props so the
  // rest of the component body is unchanged).
  const tracks = useAppStore((s) => s.sequencerTracks);
  const onChangeTracks = useAppStore((s) => s.setSequencerTracks);
  const applyDrumPattern = useAppStore((s) => s.applyDrumPattern);
  const meter = getMeter(useAppStore((s) => s.meterId));
  const stepsPerBar = meter.stepsPerBar;
  const cells = stepCells(meter);
  const isPlaying = useAppStore((s) => s.sequencerPlayer !== 'stopped');
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
  const previewRef = useRef<PreviewHandle | null>(null);
  useEffect(() => () => previewRef.current?.(), []);

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

  // Clear/randomize/shift all act on the VISIBLE window only. The cells past it
  // are this row's programming for a wider meter; destroying them would make a
  // meter switch lossy, which is exactly what windowing exists to prevent.
  const clearAllSteps = () => {
    onChangeTracks(
      tracks.map((t) => ({
        ...t,
        steps: writeStepWindow(t.steps, stepsPerBar, new Array(stepsPerBar).fill(false)),
      })),
    );
  };

  const randomizeSteps = () => {
    onChangeTracks(
      tracks.map((t) => ({
        ...t,
        steps: writeStepWindow(
          t.steps,
          stepsPerBar,
          Array.from({ length: stepsPerBar }, () => Math.random() > 0.75),
        ),
      })),
    );
  };

  const shiftSteps = (direction: "left" | "right") => {
    onChangeTracks(
      tracks.map((t) => ({ ...t, steps: rotateStepWindow(t.steps, stepsPerBar, direction) })),
    );
  };

  const applyGenrePreset = (genre: string) => {
    setSelectedGenre(genre);
    const preset = GENRE_PRESETS[genre];
    if (!preset) return;
    // Apply-time adaptation: applyDrumPattern trims or loops each row to the
    // active bar length and writes it into the window, so what the grid shows
    // is exactly what will sound.
    applyDrumPattern(preset.rows);
  };

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* Top Header & Preset Bar */}
      <div className="card bg-panel border border-base-300 shadow-md">
        <div className="card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-selector bg-primary/20 border border-primary/30 text-primary">
            <Grid className="w-4 h-4" />
          </div>
          <h2 className="font-bold text-sm sm:text-base text-base-content">
            {sequencerTitle(meter)}
          </h2>
        </div>

        {/* Preset & Action Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Master Volume */}
          <div className="flex items-center gap-1.5 mr-2">
            <Volume2 className="w-3.5 h-3.5 text-primary" />
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={masterSequencerVolume}
              onChange={setMasterSequencerVolume}
              className="range range-primary range-xs w-16 sm:w-20"
              title="Drums Master Volume"
            />
          </div>

          {/* Genre selector */}
          <div className="flex items-center gap-1 bg-base-200 border border-base-300 px-2 py-1 rounded-field">
            <Sparkles className="w-3 h-3 text-accent" />
            <select
              id="select-sequencer-genre"
              value={selectedGenre}
              onChange={(e) => applyGenrePreset(e.target.value)}
              className="select select-xs select-ghost focus:outline-none"
            >
              {Object.entries(GENRE_PRESETS).map(([g, preset]) => (
                <option
                  key={g}
                  value={g}
                  title={patternMeterTitle(g, preset.meter, meter.id)}
                >
                  {patternOptionLabel(g, preset.meter, meter.id)}
                </option>
              ))}
            </select>
          </div>

          {/* Sound kit selector */}
          <div className="flex items-center gap-1 bg-base-200 border border-base-300 px-2 py-1 rounded-field">
            <Disc3 className="w-3 h-3 text-secondary" />
            <select
              id="select-sequencer-sound-kit"
              value={soundKit}
              onChange={(e) => onChangeSoundKit(e.target.value)}
              className="select select-xs select-ghost focus:outline-none"
            >
              {Object.keys(DRUM_KITS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              id="btn-shift-left"
              onClick={() => shiftSteps("left")}
              className="btn btn-xs btn-ghost btn-square"
              title="Shift Pattern Left"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>

            <button
              id="btn-shift-right"
              onClick={() => shiftSteps("right")}
              className="btn btn-xs btn-ghost btn-square"
              title="Shift Pattern Right"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              id="btn-randomize-grid"
              onClick={randomizeSteps}
              className="btn btn-xs btn-ghost gap-1"
              title="Randomize Steps"
            >
              <Shuffle className="w-3 h-3" />
              <span className="hidden sm:inline">Random</span>
            </button>

            <button
              id="btn-clear-grid"
              onClick={clearAllSteps}
              className="btn btn-xs btn-ghost gap-1"
              title="Clear Steps"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Drum Filter — global lowpass/bandpass/highpass on the drum bus */}
      <div className="card bg-panel border border-base-300 shadow-md">
        <div className="card-body p-3 sm:p-4">
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-secondary" />
            <span className="text-xs font-bold uppercase tracking-wider text-base-content">
              Drum Filter
            </span>
          </div>

          <div className="flex items-center gap-5 flex-wrap">
            <div className="join">
              {(["lowpass", "bandpass", "highpass"] as const).map((t) => (
                <button
                  key={t}
                  id={`btn-drum-filter-${t}`}
                  onClick={() => setDrumFilterType(t)}
                  className={`btn btn-xs join-item text-[10px] font-semibold uppercase ${
                    drumFilterType === t ? "btn-secondary" : "btn-ghost"
                  }`}
                >
                  {t === "lowpass" ? "LPF" : t === "bandpass" ? "BPF" : "HPF"}
                </button>
              ))}
            </div>

            <Knob
              id="knob-drum-filter-cutoff"
              label="Cutoff"
              color="text-secondary"
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
              color="text-secondary"
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
      </div>

      {/* Sequencer Grid */}
      <div className="card bg-panel border border-base-300 shadow-md">
        <div className="card-body p-3 sm:p-4 overflow-x-auto">
        {/* Step Indicator Header — one cell per step of the active bar */}
        <div className="flex items-center gap-2 mb-2 pl-44 min-w-[700px]">
          {cells.map((cell) => {
            const isCurrent = currentStep === cell.index && isPlaying;
            return (
              <div
                key={cell.index}
                className={`flex-1 text-center tabular-nums text-[10px] py-1 rounded transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-content font-bold shadow-md shadow-primary/50"
                    : cell.isBeatStart
                      ? "text-accent font-bold bg-base-300/40"
                      : "text-base-content/50"
                }`}
              >
                {cell.label}
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
              className="flex items-center gap-2 bg-base-200 p-2 rounded-box border border-base-300 hover:border-primary/40 transition-colors"
            >
              {/* Track Info & Mute */}
              <div className="w-40 flex items-center justify-between pr-2 border-r border-base-300">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${track.color}`} />
                  <span className="text-xs font-bold text-base-content truncate">
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
                        previewRef.current?.();
                        previewRef.current = previewSequencerNote(note, synthParams, 0.8);
                      } else {
                        ensureDrumEngine();
                        triggerPad(track.instrument, 0.8);
                      }
                    }}
                    className="btn btn-ghost btn-xs btn-square hover:text-primary"
                    title="Preview Instrument"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    id={`btn-mute-${track.id}`}
                    onClick={() => toggleMute(track.id)}
                    className={`btn btn-ghost btn-xs btn-square ${
                      track.muted ? "bg-error/20 text-error border border-error/30" : ""
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

              {/* Step Buttons — the visible window of this row */}
              <div className="flex-1 flex items-center gap-1.5">
                {cells.map((cell) => {
                  const isActive = track.steps[cell.index] === true;
                  const isCurrent = currentStep === cell.index && isPlaying;

                  return (
                    <button
                      key={cell.index}
                      id={`step-${track.id}-${cell.index}`}
                      onClick={() => toggleStep(track.id, cell.index)}
                      className={`flex-1 h-9 rounded-field transition-all cursor-pointer relative ${
                        isActive
                          ? `${track.color} shadow-md shadow-primary/20 scale-[0.96]`
                          : cell.isAltBeatGroup
                            ? "bg-base-100 hover:bg-base-300 border border-base-300/50"
                            : "bg-base-200 hover:bg-base-300 border border-base-300/40"
                      } ${isCurrent ? "ring-2 ring-primary brightness-125" : ""}`}
                    >
                      {isActive && (
                        <div className="absolute inset-0 bg-base-content/10 rounded-field animate-pulse" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* Live Performance Drum Pads */}
      <DrumPads />
    </div>
  );
};

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RotateCcw,
  Shuffle,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Disc3,
} from "lucide-react";
import { useAppStore } from "../store/store";
import { getMeter } from "../utils/meter";
import { sequencerMeterBadge, stepCells } from "./sequencerGrid";
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
import { ViewHeader } from "./ui/ViewHeader";
import { ChannelStrip } from "./ui/ChannelStrip";
import { FIELD_LANE, FIELD_SELECT, SECTION_HEADER } from "./ui/fieldClasses";
import { Field } from "./ui/Field";
import { StepHeader } from "./sequencer/StepHeader";
import { TrackRow } from "./sequencer/TrackRow";
import type { SequencerTrack } from "../types";


export const SequencerView = () => {
  // Sequencer/transport/synth state + setters (named after the old props so the
  // rest of the component body is unchanged).
  const tracks = useAppStore((s) => s.sequencerTracks);
  const onChangeTracks = useAppStore((s) => s.setSequencerTracks);
  const applyDrumPattern = useAppStore((s) => s.applyDrumPattern);
  const meterId = useAppStore((s) => s.meterId);
  // getMeter returns the shared METERS[id] object, so `meter` is a stable
  // identity per meterId and this memo only rebuilds on a real meter change.
  const meter = getMeter(meterId);
  const stepsPerBar = meter.stepsPerBar;
  const cells = useMemo(() => stepCells(meter), [meter]);
  const isPlaying = useAppStore((s) => s.sequencerPlayer !== 'stopped');
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

  // These are props of the memoized TrackRow, so their identity must be
  // stable. They read `sequencerTracks` LIVE from the store rather than from
  // the render scope: a useCallback([]) over the closed-over `tracks` would
  // capture the tracks as of the first render and silently drop every edit
  // made after it. The slice's setter takes a plain value, not an updater.
  const toggleStep = useCallback((trackId: string, stepIndex: number) => {
    const { sequencerTracks, setSequencerTracks } = useAppStore.getState();
    setSequencerTracks(
      sequencerTracks.map((t) => {
        if (t.id !== trackId) return t;
        const newSteps = [...t.steps];
        newSteps[stepIndex] = !newSteps[stepIndex];
        return { ...t, steps: newSteps };
      }),
    );
  }, []);

  const toggleMute = useCallback((trackId: string) => {
    const { sequencerTracks, setSequencerTracks } = useAppStore.getState();
    setSequencerTracks(
      sequencerTracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
    );
  }, []);

  const previewTrack = useCallback((track: SequencerTrack) => {
    if (track.instrument === "synth" || track.instrument === "bass") {
      const note = track.instrument === "bass" ? "C2" : "C4";
      previewRef.current?.();
      previewRef.current = previewSequencerNote(
        note,
        useAppStore.getState().synthParams,
        0.8,
      );
    } else {
      ensureDrumEngine();
      triggerPad(track.instrument, 0.8);
    }
  }, []);

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
      {/* Identity only. Every other view's header carries at most a few
          view-level buttons and lets each module own its own controls in its
          own card (see ChordView's chord/bass cards); this one had grown to
          seven, including the pattern edits that belong beside the grid. */}
      <ViewHeader view="sequencer" badge={sequencerMeterBadge(meter)} />

      {/* Drum Sound — everything that shapes how the kit sounds. Named for all
          of what it holds now (kit, filter, level), not just the filter. */}
      <div className="card bg-panel border border-base-300 shadow-md">
        <div className="card-body p-3 sm:p-4">
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center gap-2">
            <Disc3 className="w-3.5 h-3.5 text-secondary" />
            <span className={SECTION_HEADER}>
              Drum Sound
            </span>
          </div>

          {/* items-start + a shared lane per field: bottom-aligning controls of
              four different heights (32px select, 24px join, 48px knob, 30px
              fader) put these five labels on five different baselines. */}
          <div className="flex items-start gap-5 flex-wrap">
            <Field label="Kit" htmlFor="select-sequencer-sound-kit">
              <select
                id="select-sequencer-sound-kit"
                value={soundKit}
                onChange={(e) => onChangeSoundKit(e.target.value)}
                className={FIELD_SELECT}
                title="Drum kit — the sounds each track plays"
              >
                {Object.keys(DRUM_KITS).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Filter">
              <div className="join">
                {(["lowpass", "bandpass", "highpass"] as const).map((t) => (
                  <button
                    key={t}
                    id={`btn-drum-filter-${t}`}
                    onClick={() => setDrumFilterType(t)}
                    className={`btn btn-sm join-item text-[10px] font-semibold uppercase ${
                      drumFilterType === t ? "btn-secondary" : "btn-ghost"
                    }`}
                  >
                    {t === "lowpass" ? "LPF" : t === "bandpass" ? "BPF" : "HPF"}
                  </button>
                ))}
              </div>
            </Field>

            {/* `size="sm"` (36px), not the app-wide default 48px: every other
                knob is the main content of its own card, these two are one
                field in a row. No `label` — the stacked one above says it, so
                the knob renders its value readout alone. */}
            <Field label="Cutoff">
              <Knob
                id="knob-drum-filter-cutoff"
                size="sm"
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
            </Field>

            <Field label="Res">
              <Knob
                id="knob-drum-filter-resonance"
                size="sm"
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
            </Field>

            <ChannelStrip
              idPrefix="drums"
              label="Drum Level"
              volume={masterSequencerVolume}
              accentClass="text-primary"
              max={1}
              sliderClassName="range range-xs range-primary"
              onVolumeChange={setMasterSequencerVolume}
            />
          </div>
        </div>
        </div>
      </div>

      {/* Pattern — the grid plus the tools that rewrite it. They used to sit in
          the view header, two cards away from the thing Random and Clear wipe. */}
      <div className="card bg-panel border border-base-300 shadow-md">
        <div className="card-body p-3 sm:p-4 gap-3">
        {/* Outside the scroll container below, so the title and its tools stay
            put while a 700px-wide grid scrolls under them. */}
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span className={SECTION_HEADER}>
              Pattern
            </span>
          </div>

          {/* No stacked label here: the card is already titled Pattern and this
              is its only field, so a "Genre" label above it would say the same
              thing twice. With no label line to align to, the select and the
              action buttons share one centred row. `aria-label` keeps the name
              a visible label would have carried. */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* The lane wrapper is load-bearing, not decoration: daisyUI's
                `.select` is `width: 100%`, so as a direct flex child it claims
                the whole row and pushes the buttons onto a second line. */}
            <div className={FIELD_LANE}>
              <select
                id="select-sequencer-genre"
                value={selectedGenre}
                onChange={(e) => applyGenrePreset(e.target.value)}
                className={FIELD_SELECT}
                aria-label="Drum pattern genre"
                title="Loads that genre's drum pattern over the grid"
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

            <div className="flex items-center gap-1">
              <button
                id="btn-shift-left"
                onClick={() => shiftSteps("left")}
                className="btn btn-sm btn-ghost btn-square"
                title="Shift Pattern Left"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>

              <button
                id="btn-shift-right"
                onClick={() => shiftSteps("right")}
                className="btn btn-sm btn-ghost btn-square"
                title="Shift Pattern Right"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                id="btn-randomize-grid"
                onClick={randomizeSteps}
                className="btn btn-sm btn-ghost gap-1"
                title="Randomize Steps"
              >
                <Shuffle className="w-3 h-3" />
                <span className="hidden sm:inline">Random</span>
              </button>

              <button
                id="btn-clear-grid"
                onClick={clearAllSteps}
                className="btn btn-sm btn-ghost gap-1"
                title="Clear Steps"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
        {/* Step Indicator Header — one cell per step of the active bar */}
        <StepHeader cells={cells} currentStep={currentStep} isPlaying={isPlaying} />

        {/* Track Lanes */}
        <div className="space-y-2 min-w-[700px]">
          {tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              cells={cells}
              currentStep={currentStep}
              isPlaying={isPlaying}
              onToggleStep={toggleStep}
              onToggleMute={toggleMute}
              onPreview={previewTrack}
            />
          ))}
        </div>
        </div>
        </div>
      </div>

      {/* Live Performance Drum Pads */}
      <DrumPads />
    </div>
  );
};

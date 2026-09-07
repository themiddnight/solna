import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RotateCcw,
  Shuffle,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Disc3,
} from "lucide-react";
import { useAppStore } from "../../store/store";
import { getMeter } from "../../utils/meter";
import { sequencerMeterBadge, stepCells } from "../sequencerGrid";
import { rotateStepWindow, writeStepWindow } from "../../utils/patternAdapt";
import { ensureDrumEngine, triggerPad } from "../../audio/playback/drumPlayback";
import { previewSequencerNote } from "../../audio/playback/presetPreview";
import type { PreviewHandle } from "../../audio/playback/presetPreview";
import { DRUM_GRIDS } from "@/data/drumGrids";
import { DRUM_KITS } from "@/data/drumKits";
import { patternMeterTitle, patternOptionLabel } from "../meterSelect";
import { Knob } from "../ui/Knob";
import { ViewHeader } from "../ui/ViewHeader";
import { PanelCard } from "../ui/PanelCard";
import { ChannelStrip } from "../ui/ChannelStrip";
import { FIELD_LANE, FIELD_SELECT, SECTION_HEADER } from "../ui/fieldClasses";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { SequencerGrid } from "./sequencer/SequencerGrid";
import type { SequencerTrack } from "../../types";

// The kit roster never changes at runtime, so it is read once here rather than
// re-keyed on every render — a Knob drag re-renders this view per pointermove.
// Module-scope resolution is fine in `components/`; it is `src/data/` that may
// not (CLAUDE.md, layer 1).
const DRUM_KIT_NAMES = Object.keys(DRUM_KITS);

export const SequencerView: React.FC = React.memo(() => {
  // Sequencer/transport/synth state + setters (named after the old props so the
  // rest of the component body is unchanged).
  const tracks = useAppStore((s) => s.sequencerTracks);
  const onChangeTracks = useAppStore((s) => s.setSequencerTracks);
  const replaceDrumPattern = useAppStore((s) => s.replaceDrumPattern);
  const meterId = useAppStore((s) => s.meterId);
  // getMeter returns the shared METERS[id] object, so `meter` is a stable
  // identity per meterId and this memo only rebuilds on a real meter change.
  const meter = getMeter(meterId);
  const stepsPerBar = meter.stepsPerBar;
  const cells = useMemo(() => stepCells(meter), [meter]);
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

  const [selectedGridId, setSelectedGridId] = useState<string>("synthwave");
  const previewRef = useRef<PreviewHandle | null>(null);
  useEffect(() => () => previewRef.current?.(), []);

  // A grid names the kit it was written for, so picking one loads both. The
  // menu offers all 30 — the sequencer's own 14 genre grids, the 7 grids the
  // Instant Vibes are built from, and 9 sourced variants — which were split
  // across separate tables until they merged.
  useEffect(() => {
    const kit = DRUM_GRIDS[selectedGridId]?.kit;
    if (kit) onChangeSoundKit(kit);
  }, [selectedGridId, onChangeSoundKit]);

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

  const applyDrumGrid = (id: string) => {
    setSelectedGridId(id);
    const grid = DRUM_GRIDS[id];
    if (!grid) return;
    // Apply-time adaptation: replaceDrumPattern trims or loops each row to the
    // active bar length and writes it into the window, so what the grid shows
    // is exactly what will sound.
    replaceDrumPattern(grid.rows);
  };

  // The grid `<option>` list is ~30 entries and each one formats two label
  // strings, but the only render-varying input is the ACTIVE meter (the labels
  // mark which grids match it). This component subscribes to the drum filter
  // and volume values, and a Knob drag fires onChange per pointermove — so
  // without this memo one drag rebuilds all thirty labels ~60x/s. Everything
  // else the JSX reads (DRUM_GRIDS, the two label helpers) is module scope.
  const gridOptions = useMemo(
    () =>
      Object.entries(DRUM_GRIDS).map(([id, grid]) => (
        <option
          key={id}
          value={id}
          title={patternMeterTitle(grid.name, grid.meter, meter.id)}
        >
          {patternOptionLabel(grid.name, grid.meter, meter.id)}
        </option>
      )),
    [meter.id],
  );

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
      {/* Identity only. Every other view's header carries at most a few
          view-level buttons and lets each module own its own controls in its
          own card (see ChordView's chord/bass cards); this one had grown to
          seven, including the pattern edits that belong beside the grid. */}
      <ViewHeader view="sequencer" badge={sequencerMeterBadge(meter)} />

      {/* Drum Sound — everything that shapes how the kit sounds. Named for all
          of what it holds now (kit, filter, level), not just the filter. */}
      <PanelCard>
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
                {DRUM_KIT_NAMES.map((k) => (
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
      </PanelCard>

      {/* Pattern — the grid plus the tools that rewrite it. They used to sit in
          the view header, two cards away from the thing Random and Clear wipe. */}
      <PanelCard>
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
                id="select-sequencer-grid"
                value={selectedGridId}
                onChange={(e) => applyDrumGrid(e.target.value)}
                className={FIELD_SELECT}
                aria-label="Drum grid"
                title="Loads that grid's drum pattern, and its kit, over the sequencer"
              >
                {gridOptions}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <IconButton
                id="btn-shift-left"
                label="Shift Pattern Left"
                icon={<ArrowLeft className="w-3.5 h-3.5" />}
                size="sm"
                onClick={() => shiftSteps("left")}
              />

              <IconButton
                id="btn-shift-right"
                label="Shift Pattern Right"
                icon={<ArrowRight className="w-3.5 h-3.5" />}
                size="sm"
                onClick={() => shiftSteps("right")}
              />

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

        <SequencerGrid
          tracks={tracks}
          cells={cells}
          onToggleStep={toggleStep}
          onToggleMute={toggleMute}
          onPreview={previewTrack}
        />
        </div>
      </PanelCard>
    </div>
  );
});

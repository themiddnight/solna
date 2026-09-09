import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RotateCcw,
  Shuffle,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useAppStore } from "@/store/store";
import { getMeter } from "@/utils/meter";
import { sequencerMeterBadge, stepCells } from "../sequencerGrid";
import { rotateStepWindow, writeStepWindow } from "@/utils/patternAdapt";
import { ensureDrumEngine, triggerPad } from "@/audio/playback/drumPlayback";
import { previewSequencerNote } from "@/audio/playback/presetPreview";
import type { PreviewHandle } from "@/audio/playback/presetPreview";
import { DRUM_GRIDS } from "@/data/drumGrids";
import { patternMeterTitle, patternOptionLabel } from "../meterSelect";
import { SegmentHeader } from "../ui/SegmentHeader";
import { SoloButton } from "../ui/SoloButton";
import { PanelCard } from "../ui/PanelCard";
import { FIELD_LANE, FIELD_SELECT, HEADER_BADGE, SECTION_HEADER } from "../ui/fieldClasses";
import { IconButton } from "../ui/IconButton";
import { ModuleHeader } from "../ui/ModuleHeader";
import { ToolbarButton, ToolbarGroup, ToolbarLane } from "../ui/Toolbar";
import { SequencerGrid } from "./sequencer/SequencerGrid";
import type { SequencerTrack } from "@/types";

export const SequencerView = React.memo(function SequencerView() {
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

  // Starts unselected, not "synthwave": the tracks/kit on screen come from
  // whatever was rehydrated (or the last grid actually applied THIS session),
  // and this local state has no way to know which library grid, if any,
  // produced that arrangement. Claiming "Synthwave" here was the cosmetic
  // half of the DEV-388 refresh bug — the destructive half (a mount effect
  // that actually overwrote the rehydrated kit) is fixed by applyDrumGrid
  // being the ONLY writer below; this half is fixed by not asserting a grid
  // name nothing chose.
  const [selectedGridId, setSelectedGridId] = useState<string>("");
  const previewRef = useRef<PreviewHandle | null>(null);
  useEffect(() => () => previewRef.current?.(), []);

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

  const setTrackVolume = useCallback((trackId: string, db: number) => {
    useAppStore.getState().setTrackVolume(trackId, db);
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

  // A grid loads its PATTERN and nothing else. It still names, in
  // `DRUM_GRIDS[id].kit`, the kit it was transcribed against — that field is
  // provenance a reviewer and the tests read, not something this picker
  // applies. The kit <select> lives on the Sound tab now, two tabs away from
  // this one, and a control on one tab must not rewrite a control on another:
  // picking a pattern silently swapped the sound the user had chosen, with no
  // visible cause on the screen they were looking at.
  //
  // Consequence, deliberately: two grids with identical rows but different
  // authored kits now sound the same, so `drumGrids.test.ts`'s silent-duplicate
  // predicate no longer counts `kit` as a distinguisher. Do NOT re-add a kit
  // write here to "restore" that separation — the kit is the user's to pick on
  // Sound. (Nor as a `useEffect` keyed on
  // `selectedGridId`: that local state starts at `""` and does not track the
  // hydrated `soundKit`, so such an effect fired on every mount, refresh
  // included, and overwrote the rehydrated kit with synthwave's 'Retro Drive'
  // — the "kit resets to Retro Drive on refresh" bug.)
  //
  // The menu offers all 30 grids — the sequencer's own 14 genre grids, the 7
  // grids the Instant Vibes are built from, and 9 sourced variants — which were
  // split across separate tables until they merged.
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
      {/* The Beat segment's only solo is this track-level one: hearing the
          whole kit with nothing else under it. Auditioning a single voice is
          already the preview Play button every TrackRow carries, and a
          per-voice solo would be a second answer to a question that already
          has one. */}
      <SegmentHeader segment="beat" />

      {/* Pattern — the grid plus the tools that rewrite it. They used to sit in
          the view header, two cards away from the thing Random and Clear wipe. */}
      <PanelCard>
        <div className="card-body p-3 sm:p-4 gap-3">
        {/* `Drum Pattern`, not `Pattern`: the tab header above now reads
            `Pattern`, so the bare word here made the screen say Pattern ›
            Pattern. The meter badge and the drum solo moved down with the
            name — both describe THIS grid, and that header belongs to the tab.
            No icon: neither of the other two segments' content cards carries
            one, and a sparkle on a drum grid decorated rather than named. */}
        <ModuleHeader
          className="flex-wrap gap-2.5"
          right={<SoloButton track="drums" />}
        >
          {/* `children`, not `title`: ModuleHeader's title cell is the
              mixed-case MODULE_TITLE the numbered synth stages wear, and a
              segment's content card is a SECTION — uppercase — the same as
              Accompaniment's progression card beside it. */}
          <div className="flex items-center gap-2">
            <span className={SECTION_HEADER}>Drum Pattern</span>
            <span className={HEADER_BADGE}>{sequencerMeterBadge(meter)}</span>
          </div>
        </ModuleHeader>

        {/* Outside the scroll container below, so the tools stay put while a
            700px-wide grid scrolls under them.
            No stacked label on the select: it is the card's only field, so a
            "Genre" label above it would say what the option text already
            does. `aria-label` keeps the name a visible label would carry. */}
        <ToolbarLane className="justify-between">
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
              title="Loads that grid's drum pattern over the sequencer. The kit is unchanged — pick it on the Sound tab."
            >
              <option value="" disabled>
                Choose a grid…
              </option>
              {gridOptions}
            </select>
          </div>

          <ToolbarGroup>
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

            <ToolbarButton
              id="btn-randomize-grid"
              icon={<Shuffle className="w-3 h-3" />}
              label="Random"
              onClick={randomizeSteps}
              title="Randomize Steps"
              collapseLabel
              size="sm"
            />
          </ToolbarGroup>

          {/* Clear sits in its own group so the lane's wider gap separates a
              destructive action from the one beside it — the same rule the
              lead grid's action lane follows. */}
          <ToolbarGroup>
            <ToolbarButton
              id="btn-clear-grid"
              icon={<RotateCcw className="w-3 h-3" />}
              label="Clear"
              onClick={clearAllSteps}
              title="Clear Steps"
              collapseLabel
              size="sm"
            />
          </ToolbarGroup>
        </ToolbarLane>

        <SequencerGrid
          tracks={tracks}
          cells={cells}
          onToggleStep={toggleStep}
          onToggleMute={toggleMute}
          onPreview={previewTrack}
          onVolumeChange={setTrackVolume}
        />
        </div>
      </PanelCard>
    </div>
  );
});

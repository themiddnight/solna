import React, { useCallback, useMemo, useState } from "react";
import {
  RotateCcw,
  Shuffle,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useAppStore } from "@/store/store";
import { getMeter } from "@/utils/meter";
import type { MeterId } from "@/utils/meter";
import { sequencerMeterBadge, stepCells } from "../sequencerGrid";
import { rotateStepWindow } from "@/utils/patternAdapt";
import { BEAT_PREVIEW_VELOCITY, ensureDrumEngine, triggerPad } from "@/audio/playback/drumPlayback";
import { BEAT_VOICE_IDS } from "@/data/beatPresets";
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
import { ModulePasteButton } from "./ModulePasteButton";
import type { BeatPattern, BeatVoiceId } from "@/types";

/**
 * The callbacks each memoized TrackRow receives, plus the drum preview that
 * backs its Play button.
 *
 * Their identity must be stable, so every one of them is a `useCallback([])`
 * over a store ACTION read at call time rather than over render-scope state.
 * The slice owns the read-modify-write — `toggleBeatStep` reads the row, the
 * active meter and the window boundary itself — so this layer holds nothing
 * that could go stale.
 */
function useBeatVoiceActions() {
  const toggleStep = useCallback((voice: BeatVoiceId, stepIndex: number) => {
    useAppStore.getState().toggleBeatStep(voice, stepIndex);
  }, []);

  const toggleMute = useCallback((voice: BeatVoiceId) => {
    useAppStore.getState().toggleBeatVoiceMuted(voice);
  }, []);

  const setVoiceLevel = useCallback((voice: BeatVoiceId, db: number) => {
    useAppStore.getState().setBeatVoiceLevel(voice, db);
  }, []);

  // Every voice is a drum one-shot, so there is nothing to hold and nothing to
  // cancel: the note preview this replaced existed for the `'synth'`/`'bass'`
  // tracks the roster never had, and it took the component's only ref and its
  // only effect with it.
  const previewVoice = useCallback((voice: BeatVoiceId) => {
    ensureDrumEngine();
    triggerPad(voice, BEAT_PREVIEW_VELOCITY);
  }, []);

  return { toggleStep, toggleMute, setVoiceLevel, previewVoice };
}

/**
 * The three pattern edits the toolbar fires, as PURE transforms over
 * `BeatPattern.rows`: each returns one WINDOW-wide row per voice, and
 * `replaceBeatPattern` writes those into the active window. The cells past it
 * are the pattern's programming for a wider meter, and destroying them would
 * make a meter switch lossy — which is exactly what windowing exists to
 * prevent, and why none of these three ever writes a full-width row itself.
 */
type BeatRows = BeatPattern['rows'];

const mapRows = (fn: (voice: BeatVoiceId) => boolean[]): BeatRows => {
  const rows = {} as BeatRows;
  for (const voice of BEAT_VOICE_IDS) rows[voice] = fn(voice);
  return rows;
};

const clearedRows = (stepsPerBar: number): BeatRows =>
  mapRows(() => new Array<boolean>(stepsPerBar).fill(false));

const randomizedRows = (stepsPerBar: number): BeatRows =>
  mapRows(() => Array.from({ length: stepsPerBar }, () => Math.random() > 0.75));

const shiftedRows = (
  rows: BeatRows,
  stepsPerBar: number,
  direction: "left" | "right",
): BeatRows =>
  mapRows((voice) => rotateStepWindow(rows[voice], stepsPerBar, direction).slice(0, stepsPerBar));

export const SequencerView = React.memo(function SequencerView() {
  // The Beat pattern and the Beat mix, each read whole: a step toggle and a
  // fader move are user gestures, so this subscription is not a high-frequency
  // one — the playhead, which IS, stays inside SequencerGrid's own publisher.
  const pattern = useAppStore((s) => s.beatPattern);
  const mix = useAppStore((s) => s.beatMix);
  const replaceBeatPattern = useAppStore((s) => s.replaceBeatPattern);
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

  const { toggleStep, toggleMute, setVoiceLevel, previewVoice } = useBeatVoiceActions();

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
  // hydrated Beat patch, so such an effect fired on every mount, refresh
  // included, and overwrote the rehydrated sound with synthwave's 'Retro Drive'
  // — the "kit resets to Retro Drive on refresh" bug.)
  //
  // The menu offers all 30 grids — the sequencer's own 14 genre grids, the 7
  // grids the Instant Vibes are built from, and 9 sourced variants — which were
  // split across separate tables until they merged.
  const applyDrumGrid = (id: string) => {
    setSelectedGridId(id);
    const grid = DRUM_GRIDS[id];
    if (!grid) return;
    // Apply-time adaptation: replaceBeatPattern trims or loops each row to the
    // active bar length and writes it into the window, so what the grid shows
    // is exactly what will sound.
    replaceBeatPattern(grid.rows);
  };

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
          right={
            <div className="flex items-center gap-1.5">
              <ModulePasteButton groups={['beat-pattern']} />
              <SoloButton track="drums" />
            </div>
          }
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

        <DrumPatternToolbar
          meterId={meterId}
          selectedGridId={selectedGridId}
          onSelectGrid={applyDrumGrid}
          onShift={(direction) => replaceBeatPattern(shiftedRows(pattern.rows, stepsPerBar, direction))}
          onRandomize={() => replaceBeatPattern(randomizedRows(stepsPerBar))}
          onClear={() => replaceBeatPattern(clearedRows(stepsPerBar))}
        />

        <SequencerGrid
          pattern={pattern}
          mix={mix}
          cells={cells}
          onToggleStep={toggleStep}
          onToggleMute={toggleMute}
          onPreview={previewVoice}
          onVolumeChange={setVoiceLevel}
        />
        </div>
      </PanelCard>
    </div>
  );
});

/** The grid picker and the edits that rewrite the pattern. */
interface DrumPatternToolbarProps {
  meterId: MeterId;
  selectedGridId: string;
  onSelectGrid: (id: string) => void;
  onShift: (direction: "left" | "right") => void;
  onRandomize: () => void;
  onClear: () => void;
}

/**
 * Sits OUTSIDE the grid's scroll container, so the tools stay put while a
 * 700px-wide grid scrolls under them.
 */
function DrumPatternToolbar({
  meterId,
  selectedGridId,
  onSelectGrid,
  onShift,
  onRandomize,
  onClear,
}: DrumPatternToolbarProps) {
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
          title={patternMeterTitle(grid.name, grid.meter, meterId)}
        >
          {patternOptionLabel(grid.name, grid.meter, meterId)}
        </option>
      )),
    [meterId],
  );

  // No stacked label on the select: it is the card's only field, so a
  // "Genre" label above it would say what the option text already
  // does. `aria-label` keeps the name a visible label would carry.
  return (
    <ToolbarLane className="justify-between">
      {/* The lane wrapper is load-bearing, not decoration: daisyUI's
          `.select` is `width: 100%`, so as a direct flex child it claims
          the whole row and pushes the buttons onto a second line. */}
      <div className={FIELD_LANE}>
        <select
          id="select-sequencer-grid"
          value={selectedGridId}
          onChange={(e) => onSelectGrid(e.target.value)}
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
          onClick={() => onShift("left")}
        />

        <IconButton
          id="btn-shift-right"
          label="Shift Pattern Right"
          icon={<ArrowRight className="w-3.5 h-3.5" />}
          size="sm"
          onClick={() => onShift("right")}
        />

        <ToolbarButton
          id="btn-randomize-grid"
          icon={<Shuffle className="w-3 h-3" />}
          label="Random"
          onClick={onRandomize}
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
          onClick={onClear}
          title="Clear Steps"
          collapseLabel
          size="sm"
        />
      </ToolbarGroup>
    </ToolbarLane>
  );
}

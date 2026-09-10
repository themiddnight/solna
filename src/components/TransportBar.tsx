import React from "react";
import { Volume2, Clock, Plus, Minus } from "lucide-react";
import { TRANSPORT_FIELD_LABEL, TRANSPORT_FIELD_SHELL } from "./ui/fieldClasses";
import { IconButton } from "./ui/IconButton";
import { useAppStore } from "../store/store";
import { VolumeFader } from "@/components/ui/VolumeFader";
import { PlayerTransport } from "./ui/PlayerTransport";
import { PlayheadReadout } from "./PlayheadReadout";
import { VuMeter } from "./ui/VuMeter";
import { MidiIndicator } from "./ui/MidiIndicator";
import { aggregateAllPlayers, isAnyPlayerActive, transportDisplayState } from "../store/transportSlice";
import { METER_OPTIONS, coerceMeterChoice } from "./meterSelect";
import type { Loop } from '../store/types';
import { loopLabel } from '@/store/loop';
import { layerForTab } from '@/types';
import { playTargetLabel } from './transportAction';

/** The song-mode badge: present only while a song position exists. */
export function songModeLabel(
  songLoopIndex: number | null,
  loops: readonly Loop[],
): string | null {
  if (songLoopIndex === null) return null;
  const loop = loops[songLoopIndex];
  return loop ? `Song · ${loopLabel(loop)}` : null;
}

export const TransportBar = React.memo(function TransportBar() {
  // Transport slice
  const playAll = useAppStore((s) => s.playAll);
  const soloLoop = useAppStore((s) => s.soloLoop);
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
  const playbackScope = useAppStore((s) => s.playbackScope);
  const activeTab = useAppStore((s) => s.activeTab);
  const activeLoopId = useAppStore((s) => s.activeLoopId);

  // A nullable DRAFT, not a mirror of the store. Non-null only while the user
  // is mid-edit, so the field can be freely cleared and retyped — writing
  // straight to the store on every keystroke clamps a cleared/partial value
  // back to the floor mid-typing (setBpm's clamp is right for the store, wrong
  // for what is being typed). Committed on blur/Enter, then dropped back to
  // null, which makes the store the only thing the field can display when it
  // is not being edited.
  //
  // This replaced a `bpmText` mirror + a `bpmFocused` ref + a `[bpm]` sync
  // effect. That arrangement could get stuck: the effect was the only resync,
  // so a rejected entry that clamped to the value already stored changed
  // nothing, never re-ran the effect, and left the box showing a tempo the
  // transport was not playing. A null draft cannot desync because there is
  // nothing to keep in step.
  const [bpmDraft, setBpmDraft] = React.useState<string | null>(null);
  const commitBpm = () => {
    if (bpmDraft !== null) setBpm(Number(bpmDraft));
    setBpmDraft(null);
  };

  const aggregate = useAppStore(aggregateAllPlayers);
  const layer = layerForTab(activeTab);
  // Derived in the render body, not in a selector: a zustand selector runs on
  // every store set() — including every pointermove of a knob drag, which does
  // not re-render this bar at all — whereas `loops` and `activeLoopId` are
  // already subscribed above, so scanning here costs one pass per render of
  // THIS component instead.
  const activeLoop = loops.find((loop) => loop.id === activeLoopId);
  const activeLoopName = activeLoop ? loopLabel(activeLoop) : '';
  // On the song layer a solo-looping card leaves the master button offering
  // Play (a one-click takeover). On the loop layer the button owns the solo
  // loop of the loop being edited. Hard stop stays live off the REAL player
  // states, so sounding audio always has a visible global kill.
  const displayState = transportDisplayState(playbackScope, aggregate, layer, activeLoopId);
  const hardStopDisabled = !useAppStore(isAnyPlayerActive);
  // The meter loop only needs to know whether anything is sounding, off the
  // true aggregate — not the takeover-driven display state.
  const isPlaying = aggregate !== 'stopped';
  const songLabel = songModeLabel(songLoopIndex, loops);
  // The layer IS the choice: playAll() on song, soloLoop(activeLoopId) on loop.
  // It went through a `masterPlayTarget(layer)` helper that returned its own
  // argument — a function, a test and an import proving a ternary copied the
  // `Layer` union.
  const onPlay = () => {
    if (layer === 'song') {
      playAll();
      return;
    }
    soloLoop(activeLoopId);
  };

  const handleToggleMetronome = () => {
    // Engine mirror happens via useEngineSync (one render later)
    toggleMetronome();
  };

  return (
    // Side columns are `minmax(max-content, 1fr)`: equal (so the playhead readout
    // sits dead-centre in the viewport) whenever there is room, and floored at
    // their own content width when there isn't — which degrades to an off-centre
    // readout instead of side groups overlapping or overflowing the bar.
    <div className="shrink-0 bg-base-100 border-t border-base-300 px-2 sm:px-3 py-1.5 sm:py-2 pb-safe sm:pb-safe-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 text-xs select-none sticky bottom-0 z-40 shadow-2xl">
      {/* Left Transport Actions: Play All + Tempo + Meter.
          Below `sm` this is the bar's FIRST ROW rather than its left third:
          both side groups are content-sized, and at 375px they summed to 412px
          — the bar clipped its own master fader with no way to scroll to it.
          `w-full` + `justify-between` spreads transport and tempo across that
          row; from `sm` up the group goes back to hugging its content on the
          left of a single row. */}
      <div className="flex items-center gap-1 sm:gap-1.5 w-full sm:w-auto justify-between sm:justify-start sm:shrink-0 min-w-0">
        {/* What is playing, as one cluster: on the mobile first row it is the
            left half of a `justify-between`, so transport + target must not
            spread apart from each other. `sm:contents` dissolves the wrapper
            once the bar is a single row again, leaving the original flat
            child order and gaps untouched. */}
        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 sm:contents">
        {/* Master transport: drives both automation players together. */}
        <PlayerTransport
          id="btn-bottom-transport"
          state={displayState}
          size="sm"
          showHardStop
          hardStopDisabled={hardStopDisabled}
          onPlay={onPlay}
          onSoftStop={softStopAll}
          onHardStop={hardStopAll}
          showLabel
          describedBy="label-transport-play-target"
        />

        {/* What Play will start: 'Song' on the song layer, the loop being
            edited on the loop layer. Visible at every width — a click does
            one of two different things and the single Play button gives no
            other clue below `sm`, where the button's own text label hides.
            `id` ties it to the button via `aria-describedby` below: the
            button itself announces only "Play", so a screen reader reading
            the button alone gets no target without this tie. `max-w-20` is
            the live narrow-width cap now that this always renders; `sm:max-w-32`
            widens it once the song badge and BPM/meter controls have room too. */}
        <span
          id="label-transport-play-target"
          className="text-xs text-base-content/70 truncate max-w-20 sm:max-w-32 min-w-0"
        >
          {playTargetLabel(layer, activeLoopName)}
        </span>

        {songLabel && (
          <span
            id="badge-song-mode"
            className="badge badge-sm badge-ghost font-bold text-primary hidden md:inline-flex"
            title="Song mode: loops play in order in the song layer"
          >
            {songLabel}
          </span>
        )}
        </div>

        {/* Tempo and meter, the mobile first row's right half. Same
            `sm:contents` trick: one cluster below `sm`, two flat siblings
            above it. */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 sm:contents">
        {/* Tempo BPM Control */}
        <div className={TRANSPORT_FIELD_SHELL}>
          <span className={TRANSPORT_FIELD_LABEL}>BPM</span>
          <IconButton
            label="Decrease BPM"
            icon={<Minus className="w-3 h-3" />}
            size="xs"
            onClick={() => setBpm(Math.max(40, bpm - 1))}
          />
          <input
            id="input-transport-bpm"
            type="number"
            min={40}
            max={240}
            value={bpmDraft ?? String(bpm)}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="input input-xs input-ghost w-8 sm:w-12 px-0 text-center tabular-nums font-bold text-primary text-xs"
          />
          <IconButton
            label="Increase BPM"
            icon={<Plus className="w-3 h-3" />}
            size="xs"
            onClick={() => setBpm(Math.min(240, bpm + 1))}
          />
        </div>

        {/* Time Signature */}
        <div className={TRANSPORT_FIELD_SHELL}>
          <span className={TRANSPORT_FIELD_LABEL}>Meter</span>
          <select
            id="select-transport-meter"
            value={meterId}
            onChange={(e) => setMeter(coerceMeterChoice(e.target.value, meterId))}
            className="select select-xs select-ghost focus:outline-none font-bold text-primary w-16 ps-1 pe-6"
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
      </div>

      {/* Middle: playhead readout — now/next chord + beat dots, visible on larger screens */}
      <div className="flex-1 max-w-xs hidden xl:flex items-center justify-center gap-2">
        <PlayheadReadout />
      </div>

      {/* Right Meter & Master Gain — the bar's SECOND ROW below `sm` (see the
          left group's note). Metronome/MIDI and meter/fader are wrapped as two
          clusters so `justify-between` spreads them to the row's two ends
          instead of scattering five controls evenly. */}
      <div className="flex items-center gap-1 sm:gap-2 w-full sm:w-auto justify-between sm:justify-start shrink-0">
        <div className="flex items-center gap-1 sm:gap-2 sm:contents">
        {/* Metronome Toggle */}
        <button
          id="btn-transport-metronome"
          onClick={handleToggleMetronome}
          className={`btn btn-sm btn-square sm:btn-md sm:w-auto sm:px-2 gap-1 text-xs ${
            metronomeActive ? "btn-primary" : "btn-ghost"
          }`}
          title="Metronome"
        >
          <Clock className="w-3.5 h-3.5" />
          <span className="hidden lg:inline text-[11px]">Click</span>
        </button>

        {/* MIDI Activity Indicator. Visible at every width now that the bar
            wraps to two rows below `sm` — the row it shares with the meter and
            the fader has the space the single row did not. */}
        <MidiIndicator />
        </div>

        <div className="flex items-center gap-1 sm:gap-2 sm:contents">
        {/* Real-time output level meter */}
        <VuMeter isPlaying={isPlaying} />

        {/* Master Output Fader */}
        <div className="flex items-center gap-1 bg-base-200 border border-base-300 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-box">
          <Volume2 className="w-3.5 h-3.5 text-base-content/60 shrink-0" />
          {/* The taper, the readout, the -inf detent and double-click-to-unity
              all live in VolumeFader — this bar states only the width and
              which readout it can afford. The readout's visibility tracks the
              bar's own layout, not screen size in the usual direction: below
              `sm` the bar is two rows and the readout fits, from `sm` to `lg`
              it is ONE row whose two content-sized groups summed to 803px at a
              768px tablet, so the 56px readout is what has to go there, and it
              returns at `lg`. The level stays readable from the fader position
              and exact in the `title` wherever it is hidden. */}
          <VolumeFader
            id="slider-transport-master"
            label="Master"
            valueDb={masterVolume}
            onChangeDb={setMasterVolume}
            className="range range-xs range-primary w-16"
            readoutClassName="tabular-nums text-[10px] text-base-content/60 w-14 text-right inline sm:hidden lg:inline"
          />
        </div>
        </div>
      </div>
    </div>
  );
});

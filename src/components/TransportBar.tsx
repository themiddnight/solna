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
import { IncidentWarning } from "./ui/IncidentDialog";
import { aggregateAllPlayers, transportDisplayState } from "../store/transportSlice";
import { METER_OPTIONS, coerceMeterChoice } from "./meterSelect";
import type { Loop } from '../store/types';
import type { MeterId } from '@/utils/meter';
import { loopLabel } from '@/store/loop';
import { layerForTab } from '@/types';
import { playTargetLabel } from './transportAction';
import { markDiagnosticRender } from '@/diagnostics/renderCounts';

/** The song-mode badge: present only while a song position exists. */
export function songModeLabel(
  songLoopIndex: number | null,
  loops: readonly Loop[],
): string | null {
  if (songLoopIndex === null) return null;
  const loop = loops[songLoopIndex];
  return loop ? `Song · ${loopLabel(loop)}` : null;
}

/**
 * The tempo field.
 *
 * `bpmDraft` is a nullable DRAFT, not a mirror of the store. Non-null only
 * while the user is mid-edit, so the field can be freely cleared and retyped —
 * writing straight to the store on every keystroke clamps a cleared/partial
 * value back to the floor mid-typing (setBpm's clamp is right for the store,
 * wrong for what is being typed). Committed on blur/Enter, then dropped back to
 * null, which makes the store the only thing the field can display when it is
 * not being edited.
 *
 * This replaced a `bpmText` mirror + a `bpmFocused` ref + a `[bpm]` sync
 * effect. That arrangement could get stuck: the effect was the only resync, so
 * a rejected entry that clamped to the value already stored changed nothing,
 * never re-ran the effect, and left the box showing a tempo the transport was
 * not playing. A null draft cannot desync because there is nothing to keep in
 * step.
 */
function TempoField({ bpm, setBpm }: { bpm: number; setBpm: (bpm: number) => void }) {
  const [bpmDraft, setBpmDraft] = React.useState<string | null>(null);

  const commitBpm = () => {
    if (bpmDraft !== null) setBpm(Number(bpmDraft));
    setBpmDraft(null);
  };

  return (
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
          if (e.key === 'Enter') e.currentTarget.blur();
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
  );
}

/** The time-signature select. */
function MeterField({ meterId, setMeter }: { meterId: MeterId; setMeter: (id: MeterId) => void }) {
  return (
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
  );
}

/** The metronome toggle; the engine mirror happens via useEngineSync, one render later. */
function MetronomeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      id="btn-transport-metronome"
      onClick={onToggle}
      className={`btn btn-sm btn-square sm:btn-md sm:w-auto sm:px-2 gap-1 text-xs ${
        active ? "btn-primary" : "btn-ghost"
      }`}
      title="Metronome"
    >
      <Clock className="w-3.5 h-3.5" />
      <span className="hidden lg:inline text-[11px]">Click</span>
    </button>
  );
}

interface MasterTransportProps {
  displayState: ReturnType<typeof transportDisplayState>;
  hardStopDisabled: boolean;
  onPlay: () => void;
  onSoftStop: () => void;
  onHardStop: () => void;
  /** What Play will start: 'Song' on the song layer, the loop being edited on the loop layer. */
  target: string;
  songLabel: string | null;
}

/**
 * The master transport cluster: the play/stop button plus what Play will start.
 *
 * The target is visible at every width — a click does one of two different
 * things and the single Play button gives no other clue below `sm`, where the
 * button's own text label hides. Its `id` ties it to the button via
 * `aria-describedby`: the button itself announces only "Play", so a screen
 * reader reading the button alone gets no target without this tie. `max-w-20`
 * is the live narrow-width cap now that this always renders; `sm:max-w-32`
 * widens it once the song badge and BPM/meter controls have room too.
 */
function MasterTransport({
  displayState,
  hardStopDisabled,
  onPlay,
  onSoftStop,
  onHardStop,
  target,
  songLabel,
}: MasterTransportProps) {
  return (
    <>
      {/* Master transport: drives both automation players together. */}
      <PlayerTransport
        id="btn-bottom-transport"
        state={displayState}
        size="sm"
        showHardStop
        hardStopDisabled={hardStopDisabled}
        onPlay={onPlay}
        onSoftStop={onSoftStop}
        onHardStop={onHardStop}
        showLabel
        describedBy="label-transport-play-target"
      />

      <span
        id="label-transport-play-target"
        className="text-xs text-base-content/70 truncate max-w-20 sm:max-w-32 min-w-0"
      >
        {target}
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
    </>
  );
}

/**
 * The master output fader.
 *
 * The taper, the readout, the -inf detent and double-click-to-unity all live in
 * VolumeFader — this bar states only the width and which readout it can afford.
 * The readout's visibility tracks the bar's own layout, not screen size in the
 * usual direction: below `sm` the bar is two rows and the readout fits, from
 * `sm` to `lg` it is ONE row whose two content-sized groups summed to 803px at
 * a 768px tablet, so the 56px readout is what has to go there, and it returns
 * at `lg`. The level stays readable from the fader position and exact in the
 * `title` wherever it is hidden.
 */
function MasterFader({
  valueDb,
  onChangeDb,
}: {
  valueDb: number;
  onChangeDb: (volume: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-base-200 border border-base-300 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-box">
      <Volume2 className="w-3.5 h-3.5 text-base-content/60 shrink-0" />
      <VolumeFader
        id="slider-transport-master"
        label="Master"
        valueDb={valueDb}
        onChangeDb={onChangeDb}
        className="range range-xs range-primary w-16"
        readoutClassName="tabular-nums text-[10px] text-base-content/60 w-14 text-right inline sm:hidden lg:inline"
      />
    </div>
  );
}

export const TransportBar = React.memo(function TransportBar() {
  markDiagnosticRender('TransportBar');
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
  const playbackScope = useAppStore((s) => s.playbackScope);
  const activeTab = useAppStore((s) => s.activeTab);
  const activeLoopId = useAppStore((s) => s.activeLoopId);
  // Narrow selectors for label derivations: instead of subscribing to the whole
  // loops array (which changes on ANY loop field edit for ANY loop), each selector
  // reads only what it needs and returns a derived STRING. Re-render suppression
  // comes from that returned string's VALUE staying equal across an unrelated
  // `set()` (zustand's default `Object.is` comparator) — not from watching a
  // length or an index directly — so an edit to a loop's mix or mute leaves the
  // returned string unchanged and neither selector below re-renders this
  // component.
  //
  // This is a deliberate deviation from the original plan, which explicitly
  // REJECTED a `.find()`-based selector here: a narrower selector still
  // re-evaluates its body on every store `set()` app-wide (zustand has no
  // per-key subscription), and at the time that reasoning was written, a knob
  // drag's pointermove and a MIDI CC frame both wrote the store on every event
  // — making "re-evaluates on every set()" a real, measured cost, since a drag
  // could fire this selector dozens of times a second. Task 4 (synth/effects
  // draft-commit) and Task 8 (MIDI CC coalescing) removed both of those
  // high-frequency write sources, so the plan's own objection no longer applies
  // — a `set()` now happens at user-gesture rate, not per-pointermove/per-CC —
  // while the selector's win (skipping a full `TransportBar` subtree re-render
  // on every unrelated loop mix/mute edit) is unchanged. That is why the
  // narrower selector was reinstated here rather than reverted back to a
  // whole-array read.
  const activeLoopName = useAppStore((s) => {
    const activeLoop = s.loops.find((loop) => loop.id === s.activeLoopId);
    return activeLoop ? loopLabel(activeLoop) : '';
  });

  const aggregate = useAppStore(aggregateAllPlayers);
  const layer = layerForTab(activeTab);
  // On the song layer a solo-looping card leaves the master button offering
  // Play (a one-click takeover). On the loop layer the button owns the solo
  // loop of the loop being edited. Hard stop stays live off the REAL player
  // states, so sounding audio always has a visible global kill.
  const displayState = transportDisplayState(playbackScope, aggregate, layer, activeLoopId);
  // The meter loop only needs to know whether anything is sounding, off the
  // true aggregate — not the takeover-driven display state.
  const isPlaying = aggregate !== 'stopped';
  // Equivalent to `useAppStore(isAnyPlayerActive)`: `aggregate` already folds
  // every player's state the same way, so a second selector re-running
  // `allPlayerStates` on every store set() would only duplicate this one.
  const hardStopDisabled = !isPlaying;
  // Same narrow-selector tradeoff as `activeLoopName` above, and calls
  // `songModeLabel` directly rather than re-deriving its rule inline — the two
  // had drifted into two copies of one rule, with the tested one
  // (`TransportBar.test.tsx`) not the one that ran in production. `loops[i]` on
  // an empty array already yields `undefined`, so `songModeLabel` needs no
  // separate `loops.length === 0` guard for that case.
  const songLabel = useAppStore((s) => songModeLabel(s.songLoopIndex, s.loops));
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
          <MasterTransport
            displayState={displayState}
            hardStopDisabled={hardStopDisabled}
            onPlay={onPlay}
            onSoftStop={softStopAll}
            onHardStop={hardStopAll}
            target={playTargetLabel(layer, activeLoopName)}
            songLabel={songLabel}
          />
        </div>

        {/* Tempo and meter, the mobile first row's right half. Same
            `sm:contents` trick: one cluster below `sm`, two flat siblings
            above it. */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 sm:contents">
        {/* Tempo BPM Control */}
        <TempoField bpm={bpm} setBpm={setBpm} />

        {/* Time Signature */}
        <MeterField meterId={meterId} setMeter={setMeter} />
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
        {/* Metronome Toggle. Engine mirror happens via useEngineSync (one render later) */}
        <MetronomeToggle active={metronomeActive} onToggle={toggleMetronome} />

        {/* MIDI Activity Indicator. Visible at every width now that the bar
            wraps to two rows below `sm` — the row it shares with the meter and
            the fader has the space the single row did not. */}
        <MidiIndicator />

        {/* Shown while an incident exists and its dialog is dismissed. */}
        <IncidentWarning />
        </div>

        <div className="flex items-center gap-1 sm:gap-2 sm:contents">
        {/* Real-time output level meter */}
        <VuMeter isPlaying={isPlaying} />

        {/* Master Output Fader */}
        <MasterFader valueDb={masterVolume} onChangeDb={setMasterVolume} />
        </div>
      </div>
    </div>
  );
});

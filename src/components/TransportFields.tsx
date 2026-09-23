import React from "react";
import { Volume2, Clock, Plus, Minus } from "lucide-react";
import {
  TRANSPORT_FIELD_LABEL,
  TRANSPORT_FIELD_SHELL,
  TRANSPORT_SHEET_FIELD_LABEL,
} from "./ui/fieldClasses";
import { IconButton } from "./ui/IconButton";
import { VolumeFader } from "@/components/ui/VolumeFader";
import { METER_OPTIONS, coerceMeterChoice } from "./meterSelect";
import type { MeterId } from '@/utils/timeSignature';

/**
 * Where a transport control renders: the desktop bar's one row, or the mobile
 * transport sheet (R332), which has room for the captions and readouts the row
 * gives up. Only the desktop bar and the sheet use these, so they sit beside
 * `TransportBar` rather than in `ui/` (R276).
 */
export type TransportPlace = 'bar' | 'sheet';

const fieldLabel = (place: TransportPlace) =>
  place === 'sheet' ? TRANSPORT_SHEET_FIELD_LABEL : TRANSPORT_FIELD_LABEL;

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
export function TempoField({
  bpm,
  setBpm,
  place = 'bar',
}: {
  bpm: number;
  setBpm: (bpm: number) => void;
  place?: TransportPlace;
}) {
  const [bpmDraft, setBpmDraft] = React.useState<string | null>(null);

  const commitBpm = () => {
    if (bpmDraft !== null) setBpm(Number(bpmDraft));
    setBpmDraft(null);
  };

  return (
    <div className={TRANSPORT_FIELD_SHELL}>
      <span className={fieldLabel(place)}>BPM</span>
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
export function MeterField({
  meterId,
  setMeter,
  place = 'bar',
}: {
  meterId: MeterId;
  setMeter: (id: MeterId) => void;
  place?: TransportPlace;
}) {
  return (
    <div className={TRANSPORT_FIELD_SHELL}>
      <span className={fieldLabel(place)}>Meter</span>
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

/**
 * The metronome toggle; the engine mirror happens via useEngineSync, one render
 * later. In the sheet it is a labelled toggle (`aria-pressed`), because there
 * the word fits and the bar's readout dot is the only other sign it is on.
 */
export function MetronomeToggle({
  active,
  onToggle,
  place = 'bar',
}: {
  active: boolean;
  onToggle: () => void;
  place?: TransportPlace;
}) {
  const tone = active ? "btn-primary" : "btn-ghost";
  if (place === 'sheet') {
    return (
      <button
        id="btn-transport-metronome"
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`btn btn-sm gap-1.5 text-xs ${tone}`}
        title="Metronome"
      >
        <Clock className="w-3.5 h-3.5" />
        Metronome
      </button>
    );
  }
  return (
    <button
      id="btn-transport-metronome"
      onClick={onToggle}
      className={`btn btn-sm btn-square sm:btn-md sm:w-auto sm:px-2 gap-1 text-xs ${tone}`}
      title="Metronome"
    >
      <Clock className="w-3.5 h-3.5" />
      <span className="hidden lg:inline text-[11px]">Click</span>
    </button>
  );
}

/**
 * The master output fader.
 *
 * The taper, the readout, the -inf detent and double-click-to-unity all live in
 * VolumeFader — this states only the width and which readout it can afford. On
 * the desktop bar, from `md` to `lg` the bar is ONE row whose two content-sized
 * groups summed to 803px at a 768px tablet, so the 56px readout is what has to
 * go there, and it returns at `lg`; the level stays readable from the fader
 * position and exact in the `title` wherever it is hidden. The mobile
 * transport sheet has the room: the fader fills its row and the readout always
 * shows.
 */
export function MasterFader({
  valueDb,
  onChangeDb,
  place = 'bar',
}: {
  valueDb: number;
  onChangeDb: (volume: number) => void;
  place?: TransportPlace;
}) {
  const sheet = place === 'sheet';
  return (
    <div
      className={`flex items-center gap-1 bg-base-200 border border-base-300 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-box${
        sheet ? ' flex-1 min-w-0' : ''
      }`}
    >
      <Volume2 className="w-3.5 h-3.5 text-base-content/60 shrink-0" />
      <VolumeFader
        id="slider-transport-master"
        label="Master"
        valueDb={valueDb}
        onChangeDb={onChangeDb}
        className={sheet ? "range range-xs range-primary flex-1 min-w-0" : "range range-xs range-primary w-16"}
        readoutClassName={
          sheet
            ? "tabular-nums text-[10px] text-base-content/60 w-14 text-right shrink-0"
            : "tabular-nums text-[10px] text-base-content/60 w-14 text-right inline md:hidden lg:inline"
        }
      />
    </div>
  );
}

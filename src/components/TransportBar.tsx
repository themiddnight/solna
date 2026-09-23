import React from "react";
import { ChevronUp } from "lucide-react";
import { cx } from "./ui/cx";
import { IconButton } from "./ui/IconButton";
import { PlayerTransport } from "./ui/PlayerTransport";
import { PlayheadReadout } from "./PlayheadReadout";
import { VuMeter } from "./ui/VuMeter";
import { MidiIndicator } from "./ui/MidiIndicator";
import { IncidentWarning } from "./ui/IncidentDialog";
import { markDiagnosticRender } from '@/diagnostics/renderCounts';
import { MasterFader, MeterField, MetronomeToggle, TempoField } from './TransportFields';
import { TRANSPORT_SHEET_ID, TransportSheet } from './TransportSheet';
import { transportReadout, useTransportBar, type UseTransportBar } from './useTransportBar';
import type { MeterId } from '@/utils/timeSignature';

/**
 * Which bar the frame asks for (R316: the frame decides, never a media query
 * here). `desktop` is the one-row bar with every control inline; `mobile` is
 * the one-row phone bar whose settings live in the transport sheet (R332).
 */
export type TransportVariant = 'desktop' | 'mobile';

const DESKTOP_TARGET = "text-xs text-base-content/70 truncate max-w-20 sm:max-w-32 min-w-0";
const MOBILE_TARGET = "text-xs text-base-content/70 truncate min-w-0 flex-1";

interface MasterTransportProps {
  displayState: UseTransportBar['displayState'];
  hardStopDisabled: boolean;
  onPlay: () => void;
  onSoftStop: () => void;
  onHardStop: () => void;
  /** What Play will start: 'Song' on the song layer, the loop being edited on the loop layer. */
  target: string;
  /** The target label's classes: capped on the desktop row, the flexible middle of the mobile row. */
  targetClassName: string;
  songLabel: string | null;
}

/**
 * The master transport cluster: the play/stop button plus what Play will start.
 *
 * The target is visible at every width — a click does one of two different
 * things and the single Play button gives no other clue below `sm`, where the
 * button's own text label hides. Its `id` ties it to the button via
 * `aria-describedby`: the button itself announces only "Play", so a screen
 * reader reading the button alone gets no target without this tie. The
 * desktop row caps it (`DESKTOP_TARGET`); the mobile row lets it take the
 * space between the buttons and the readout and truncate there.
 */
function MasterTransport({
  displayState,
  hardStopDisabled,
  onPlay,
  onSoftStop,
  onHardStop,
  target,
  targetClassName,
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
        className={targetClassName}
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

interface SheetToggleProps {
  open: boolean;
  onToggle: () => void;
}

/**
 * The mobile bar's read-only tempo readout (`120 · 4/4`), a second way to
 * toggle the sheet. The dot shows while the metronome is on, so a click track
 * is never a mystery with the sheet closed; screen readers get the same fact
 * as text. Exported for the test: the metronome state cannot be set through a
 * rendered bar (R257).
 */
export function TransportReadout({ bpm, meterId, metronomeActive, open, onToggle }: SheetToggleProps & {
  bpm: number;
  meterId: MeterId;
  metronomeActive: boolean;
}) {
  return (
    <button
      id="btn-transport-readout"
      type="button"
      aria-expanded={open}
      aria-controls={TRANSPORT_SHEET_ID}
      onClick={onToggle}
      className="btn btn-ghost btn-sm min-h-11 shrink-0 gap-1 px-2 font-bold tabular-nums text-xs text-primary"
      title="Tempo and meter: open the transport settings"
    >
      {transportReadout(bpm, meterId)}
      {metronomeActive && (
        <>
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="sr-only">, metronome on</span>
        </>
      )}
    </button>
  );
}

/**
 * The chevron that opens and closes the transport sheet. It points where the
 * sheet will move: up while closed (the sheet rises out of the bar), and turns
 * to point down while open, in step with the sheet's own transition.
 */
function SheetToggle({ open, onToggle }: SheetToggleProps) {
  return (
    <IconButton
      id="btn-transport-sheet"
      label="Transport settings"
      icon={<ChevronUp className={cx('w-4 h-4 transition-transform duration-200 ease-out motion-reduce:transition-none', open && 'rotate-180')} />}
      aria-expanded={open}
      aria-controls={TRANSPORT_SHEET_ID}
      className="min-h-11 min-w-11 shrink-0"
      onClick={onToggle}
    />
  );
}

/**
 * `bottomInset` — whether this bar consumes `env(safe-area-inset-bottom)`;
 * the mobile frame gives it to the tab bar below (one consumer per frame).
 * `variant` — which bar the frame asks for (`TransportVariant`).
 */
export const TransportBar = React.memo(function TransportBar({
  bottomInset = true,
  variant = 'desktop',
}: {
  bottomInset?: boolean;
  variant?: TransportVariant;
}) {
  markDiagnosticRender('TransportBar');
  const t = useTransportBar();
  const inset = bottomInset ? ' pb-safe sm:pb-safe-lg' : '';

  if (variant === 'mobile') {
    return (
      // One row, sized for a 375px phone: the play/stop join, the target label
      // (the only flexible, truncating item), the incident chip when present,
      // the readout and the chevron. The sheet renders inside this bar so it
      // anchors to the bar's top edge; the bar is `sticky`, which makes it the
      // sheet's containing block.
      <div className={`shrink-0 bg-base-100 border-t border-base-300 px-2 py-1${inset} flex items-center gap-1 text-xs select-none sticky bottom-0 z-40 shadow-2xl`}>
        <MasterTransport
          displayState={t.displayState}
          hardStopDisabled={t.hardStopDisabled}
          onPlay={t.onPlay}
          onSoftStop={t.onSoftStop}
          onHardStop={t.onHardStop}
          target={t.target}
          targetClassName={MOBILE_TARGET}
          songLabel={null}
        />

        {/* Stays on the bar: an incident must be seen without looking for it. */}
        <IncidentWarning />

        <TransportReadout
          bpm={t.bpm}
          meterId={t.meterId}
          metronomeActive={t.metronomeActive}
          open={t.sheetOpen}
          onToggle={t.toggleSheet}
        />
        <SheetToggle open={t.sheetOpen} onToggle={t.toggleSheet} />

        <TransportSheet
          open={t.sheetOpen}
          onClose={t.closeSheet}
          bpm={t.bpm}
          setBpm={t.setBpm}
          meterId={t.meterId}
          setMeter={t.setMeter}
          metronomeActive={t.metronomeActive}
          onToggleMetronome={t.toggleMetronome}
          masterVolume={t.masterVolume}
          setMasterVolume={t.setMasterVolume}
          isPlaying={t.isPlaying}
        />
      </div>
    );
  }

  return (
    // Side columns are `minmax(max-content, 1fr)`: equal (so the playhead readout
    // sits dead-centre in the viewport) whenever there is room, and floored at
    // their own content width when there isn't — which degrades to an off-centre
    // readout instead of side groups overlapping or overflowing the bar.
    //
    // The desktop frame renders this bar only from `md` up (R315); below `md`
    // the mobile frame asks for the one-row `mobile` variant instead (R332).
    // The below-`md` classes and the `md:contents` wrappers are what the bar
    // wore when it also served the phone as two rows; they are kept so this
    // markup stays exactly what it was, and are inert at the widths it now
    // renders at.
    <div className={`shrink-0 bg-base-100 border-t border-base-300 px-2 sm:px-3 py-1.5 sm:py-2${inset} flex flex-col md:flex-row md:items-center md:justify-between gap-1 sm:gap-2 text-xs select-none sticky bottom-0 z-40 shadow-2xl`}>
      {/* Left Transport Actions: Play All + Tempo + Meter, hugging their
          content on the left of the row. */}
      <div className="flex items-center gap-1 sm:gap-1.5 w-full md:w-auto justify-between md:justify-start md:shrink-0 min-w-0">
        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 md:contents">
          <MasterTransport
            displayState={t.displayState}
            hardStopDisabled={t.hardStopDisabled}
            onPlay={t.onPlay}
            onSoftStop={t.onSoftStop}
            onHardStop={t.onHardStop}
            target={t.target}
            targetClassName={DESKTOP_TARGET}
            songLabel={t.songLabel}
          />
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 md:contents">
        {/* Tempo BPM Control */}
        <TempoField bpm={t.bpm} setBpm={t.setBpm} />

        {/* Time Signature */}
        <MeterField meterId={t.meterId} setMeter={t.setMeter} />
        </div>
      </div>

      {/* Middle: playhead readout — now/next chord + beat dots, visible on larger screens */}
      <div className="flex-1 max-w-xs hidden xl:flex items-center justify-center gap-2">
        <PlayheadReadout />
      </div>

      {/* Right: metronome, MIDI and the incident chip, then the level meter
          and the master fader. */}
      <div className="flex items-center gap-1 sm:gap-2 w-full md:w-auto justify-between md:justify-start shrink-0">
        <div className="flex items-center gap-1 sm:gap-2 md:contents">
        {/* Metronome Toggle. Engine mirror happens via useEngineSync (one render later) */}
        <MetronomeToggle active={t.metronomeActive} onToggle={t.toggleMetronome} />

        {/* MIDI Activity Indicator */}
        <MidiIndicator />

        {/* Shown while an incident exists and its dialog is dismissed. */}
        <IncidentWarning />
        </div>

        <div className="flex items-center gap-1 sm:gap-2 md:contents">
        {/* Real-time output level meter */}
        <VuMeter isPlaying={t.isPlaying} />

        {/* Master Output Fader */}
        <MasterFader valueDb={t.masterVolume} onChangeDb={t.setMasterVolume} />
        </div>
      </div>
    </div>
  );
});

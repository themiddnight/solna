import { Circle, ClipboardPaste, Copy, RotateCcw } from 'lucide-react';
import {
  TOOLBAR_BUTTON_IDLE,
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
  ToolbarLane,
} from '@/components/ui/Toolbar';
import { GROUP_LABEL } from '@/components/ui/fieldClasses';
import { Slider } from '@/components/ui/Slider';
import { LEAD_STEP_RESOLUTION_IDS } from '@/utils/stepResolution';
import type { MelodyTrackId } from '@/store/melodyTracks';
import type { LeadGridCommands, LeadGridModel, LeadGridTransport } from './useLeadGridModel';

/**
 * The grid's two lanes: what it SHOWS (settings) and what you DO to it
 * (actions).
 *
 * Settings pick how the grid looks or how it sounds back, and none of them is
 * a thing you tap twice in a row. View mode leads, then each setting behind a
 * GROUP_LABEL naming what it adjusts: a bare `4` and a bare `1/16` are only
 * legible to someone who already knows this grid.
 *
 * The action lane sits BELOW the grid on purpose: it lands next to the bottom
 * input dock, which is where the hands are when Rec matters, and the eye reads
 * grid-then-act rather than doubling back. Rec holds the left alone because it
 * is the only MODE here — it arms a state and stays armed — while
 * copy/paste/clear are one-shot commands; splitting them by kind also buys
 * Clear the most distance from the button beside it. Clear keeps its own group
 * so the lane's wider gap sets it apart from Paste, and it must not wear red as
 * well: an armed Rec already owns that.
 */

export interface LeadGridSettingsProps {
  trackId: MelodyTrackId;
  model: LeadGridModel;
}

interface LeadViewToggleProps {
  trackId: MelodyTrackId;
  view: LeadGridModel['melodyView'];
  onChange: LeadGridModel['setMelodyView'];
}

function LeadViewToggle({ trackId, view, onChange }: LeadViewToggleProps) {
  return (
    <div className="join">
      {(['scale-locked', 'chromatic'] as const).map((m) => (
        <button
          key={m}
          id={`btn-${trackId}-view-${m}`}
          type="button"
          onClick={() => onChange(m)}
          className={`btn btn-xs join-item text-[11px] font-semibold ${
            view === m ? 'btn-primary' : TOOLBAR_BUTTON_IDLE
          }`}
        >
          {m === 'scale-locked' ? 'Scale' : 'Chromatic'}
        </button>
      ))}
    </div>
  );
}

interface LeadOctaveControlProps {
  trackId: MelodyTrackId;
  octave: LeadGridModel['melodyOctave'];
  onChange: LeadGridModel['setMelodyOctave'];
}

/** The octave window the pitch rows are drawn from — a stepper, not a select. */
function LeadOctaveControl({ trackId, octave, onChange }: LeadOctaveControlProps) {
  return (
    <ToolbarGroup>
      <span className={GROUP_LABEL}>Octave</span>
      <button
        id={`btn-${trackId}-octave-down`}
        type="button"
        onClick={() => onChange(octave - 1)}
        className="btn btn-xs btn-square btn-ghost border border-base-300"
        title="Octave window down"
      >
        -
      </button>
      <span className="text-xs tabular-nums">{octave}</span>
      <button
        id={`btn-${trackId}-octave-up`}
        type="button"
        onClick={() => onChange(octave + 1)}
        className="btn btn-xs btn-square btn-ghost border border-base-300"
        title="Octave window up"
      >
        +
      </button>
    </ToolbarGroup>
  );
}

interface LeadLoopLengthControlProps {
  trackId: MelodyTrackId;
  loopLength: LeadGridModel['melodyLoopLength'];
  divisors: LeadGridModel['divisors'];
  onChange: LeadGridModel['setMelodyLoopLength'];
}

/** Only the divisors of the progression: a length it cannot divide is a gap. */
function LeadLoopLengthControl({
  trackId,
  loopLength,
  divisors,
  onChange,
}: LeadLoopLengthControlProps) {
  return (
    <ToolbarGroup>
      <span className={GROUP_LABEL}>Length</span>
      <select
        id={`select-${trackId}-loop-length`}
        value={loopLength}
        onChange={(e) => onChange(Number(e.target.value))}
        className="select select-xs select-ghost"
        title="Melody loop length (bars)"
      >
        {divisors.map((d) => (
          <option key={d} value={d}>
            {d} bar{d === 1 ? '' : 's'}
          </option>
        ))}
      </select>
    </ToolbarGroup>
  );
}

interface LeadStepControlProps {
  trackId: MelodyTrackId;
  resolution: LeadGridModel['melodyStepResolution'];
  onChange: LeadGridModel['setMelodyStepResolution'];
}

function LeadStepControl({ trackId, resolution, onChange }: LeadStepControlProps) {
  return (
    <ToolbarGroup>
      <span className={GROUP_LABEL}>Step</span>
      <select
        id={`select-${trackId}-step-resolution`}
        value={resolution}
        onChange={(e) => onChange(e.target.value as typeof resolution)}
        className="select select-xs select-ghost"
        title="Melody grid resolution — a finer grid reveals more columns and never moves a note"
      >
        {LEAD_STEP_RESOLUTION_IDS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </ToolbarGroup>
  );
}

interface LeadGateControlProps {
  trackId: MelodyTrackId;
  gate: LeadGridModel['melodyGate'];
  onChange: LeadGridModel['setMelodyGate'];
}

function LeadGateControl({ trackId, gate, onChange }: LeadGateControlProps) {
  return (
    <ToolbarGroup>
      <span className={GROUP_LABEL}>Gate</span>
      <Slider
        id={`range-${trackId}-gate`}
        value={Math.round(gate * 100)}
        min={5}
        max={100}
        step={5}
        onChange={(percent) => onChange(percent / 100)}
        className="range range-primary range-xs w-20"
        title="How much of each note's final step sounds. Applies when the arp is off."
      />
      <span className="text-[10px] tabular-nums text-base-content/60 whitespace-nowrap">
        {`${Math.round(gate * 100)}%`}
      </span>
    </ToolbarGroup>
  );
}

export function LeadGridSettings({ trackId, model }: LeadGridSettingsProps) {
  return (
    <ToolbarLane className="mb-3 justify-between">
      <ToolbarGroup>
        <LeadViewToggle trackId={trackId} view={model.melodyView} onChange={model.setMelodyView} />
      </ToolbarGroup>

      <ToolbarCluster>
        <LeadOctaveControl
          trackId={trackId}
          octave={model.melodyOctave}
          onChange={model.setMelodyOctave}
        />
        <LeadLoopLengthControl
          trackId={trackId}
          loopLength={model.melodyLoopLength}
          divisors={model.divisors}
          onChange={model.setMelodyLoopLength}
        />
        <LeadStepControl
          trackId={trackId}
          resolution={model.melodyStepResolution}
          onChange={model.setMelodyStepResolution}
        />
        <LeadGateControl
          trackId={trackId}
          gate={model.melodyGate}
          onChange={model.setMelodyGate}
        />
      </ToolbarCluster>
    </ToolbarLane>
  );
}

export interface LeadGridActionsProps {
  trackId: MelodyTrackId;
  transport: LeadGridTransport;
  commands: LeadGridCommands;
}

/**
 * Rec renders on whichever melody grid focus names, and on NEITHER when focus
 * is chord, bass, pad or drum — a Rec button that arms an invisible track is
 * the invisible-state failure focusTrack exists to remove. The left group
 * renders empty rather than not at all, so `justify-between` still has two
 * children and the actions cluster stays pinned right.
 */
export function LeadGridActions({ trackId, transport, commands }: LeadGridActionsProps) {
  const { armed, showRec, selectedBar, setRecordingTrack, copySelectedLeadBar } = transport;
  const { hasClipboard, pasteIntoSelectedLeadBar } = transport;

  return (
    <ToolbarLane className="mt-3 justify-between">
      <ToolbarGroup>
        {showRec && (
          <ToolbarButton
            id={`btn-${trackId}-record`}
            icon={<Circle className="w-3 h-3" />}
            label="Rec"
            onClick={() => setRecordingTrack(armed ? null : trackId)}
            pressed={armed}
            title={
              armed
                ? 'Stop recording played notes into the grid'
                : `Record played notes into bar ${selectedBar + 1}, from the selected step`
            }
          />
        )}
      </ToolbarGroup>

      <ToolbarCluster>
        <ToolbarGroup>
          <ToolbarButton
            id={`btn-${trackId}-copy-bar`}
            icon={<Copy className="w-3 h-3" />}
            label="Copy"
            onClick={copySelectedLeadBar}
            title={`Copy bar ${selectedBar + 1}`}
          />
          <ToolbarButton
            id={`btn-${trackId}-paste-bar`}
            icon={<ClipboardPaste className="w-3 h-3" />}
            label="Paste"
            onClick={pasteIntoSelectedLeadBar}
            disabled={!hasClipboard}
            title={`Paste over bar ${selectedBar + 1}`}
          />
        </ToolbarGroup>

        <ToolbarGroup>
          <ToolbarButton
            id={`btn-${trackId}-clear`}
            icon={<RotateCcw className="w-3 h-3" />}
            label="Clear"
            onClick={commands.clearMelody}
            title="Clear melody"
          />
        </ToolbarGroup>
      </ToolbarCluster>
    </ToolbarLane>
  );
}

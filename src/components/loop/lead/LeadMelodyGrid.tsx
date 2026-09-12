import React from 'react';
import { SECTION_HEADER } from '@/components/ui/fieldClasses';
import { PanelCard } from '@/components/ui/PanelCard';
import { ModuleHeader } from '@/components/ui/ModuleHeader';
import { SoloButton } from '@/components/ui/SoloButton';
import { type StepCell } from '@/components/sequencerGrid';
import { LEAD_CELL_WIDTH, leadCursorKeyTarget, leadRowLabelTone } from './melodyGrid';
import { useLeadMarkerColumn } from './useLeadMarker';
import { ModulePasteButton } from '../ModulePasteButton';
import { useLeadPlayback } from './useLeadPlayback';
import { useLeadStepPublisher } from './useLeadStepPublisher';
import { LeadMelodyCells } from './LeadMelodyCells';
import { LeadGridActions, LeadGridSettings } from './LeadGridControls';
import {
  useLeadGridCommands,
  useLeadGridModel,
  useLeadGridTransport,
} from './useLeadGridModel';
import type { MelodyTrackId } from '@/store/melodyTracks';

/** Fixed width (px) of the note-name column, shared by the header spacer. */
const LABEL_WIDTH = 44;

interface LeadMarkerViewProps {
  column: number;
}

/**
 * The one marker. Not two: the selection cursor and the playback playhead
 * both meant "this column", so they are drawn once, the way a DAW does —
 * except that this marker is also the column pointer recording writes at.
 *
 * Split out with an explicit prop so the geometry stays unit-testable:
 * renderToString cannot force a playing store state (zustand v5 serves
 * selector(api.getInitialState()) as the server snapshot — see
 * ui/BottomInputDock.tsx:9-21).
 *
 * It spans the header strips as well as the body, so it is offset by the
 * note-name column's width and strides by LEAD_CELL_WIDTH — the same
 * constant the header buttons size themselves with.
 */
export function LeadMarkerView({ column }: LeadMarkerViewProps) {
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 bg-primary/20 ring-1 ring-inset ring-primary"
      style={{
        width: LEAD_CELL_WIDTH,
        left: LABEL_WIDTH,
        transform: `translateX(${column * LEAD_CELL_WIDTH}px)`,
      }}
    />
  );
}

interface LeadMarkerProps {
  trackId: MelodyTrackId;
  columns: number;
}

/**
 * The marker, subscribed. The subscription lives HERE and not in
 * LeadMelodyGrid for exactly the reason the grid itself lives here and not in
 * the view that renders it (see the note on LeadMelodyGrid): a published step
 * arrives 8-32 times a second, and read from the grid's body it re-rendered
 * the whole toolbar — two selects, a Slider, eight buttons and 14-24 pitch
 * labels — to move one translateX. This component draws one div and nothing
 * else, so that is all a step now costs.
 */
export function LeadMarker({ trackId, columns }: LeadMarkerProps) {
  const column = useLeadMarkerColumn(trackId, columns);
  return <LeadMarkerView column={column} />;
}

// Memoized for the same reason as LeadMelodyCells above: LeadMelodyGrid
// re-renders once per 16th note to move the playhead, and these two strips
// rebuild `columns` divs each — 128 of them for a 4-bar loop in 4/4 — every
// time. stepsPerBar and columns are numbers, and cellsPerBar is useMemo'd on
// the shared METERS[id] object, so the shallow prop comparison is meaningful.
export const LeadMelodyHeaders = React.memo(function LeadMelodyHeaders({
  columns,
  cellsPerBar,
  cursor,
  selectedBar,
  onSelectColumn,
  columnsPerBar,
}: {
  columns: number;
  cellsPerBar: StepCell[];
  cursor: number;
  selectedBar: number;
  onSelectColumn: (col: number) => void;
  columnsPerBar: number;
}) {
  // Arrows move the cursor AND the focus together. Leaving focus behind would
  // put the ring on one column while the selection sat on another.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, col: number): void => {
    const next = leadCursorKeyTarget(col, e.key, e.shiftKey, columnsPerBar, columns);
    if (next === null) return;
    e.preventDefault();
    onSelectColumn(next);
    const strip = e.currentTarget.parentElement;
    (strip?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <>
      {/* Both strips are h-5 — one grid row cell tall — so a bar and a beat
          are pointer targets rather than 8px bands. The widths stay
          LEAD_CELL_WIDTH, the same constant the marker's translateX strides
          by: a marker that drifts from its own ruler is worse than two
          honest markers. */}
      {/* Bar-number header — the whole bar's width selects that bar. */}
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
        <div className="flex shrink-0">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / columnsPerBar);
            const stepInBar = col % columnsPerBar;
            return (
              <button
                key={col}
                type="button"
                aria-label={`Bar ${barIndex + 1}`}
                aria-pressed={barIndex === selectedBar}
                onClick={() => onSelectColumn(barIndex * columnsPerBar)}
                onKeyDown={(e) => onKeyDown(e, col)}
                // bg-primary/20 text-primary now means "the selected bar for
                // copy/paste" — it is a live selection tint, not a second
                // marker. It sits under the DEV-377 marker on purpose: the
                // marker is "this column", this strip is "this bar".
                className={`h-5 flex items-center justify-center text-[8px] leading-none font-bold ${
                  barIndex === selectedBar
                    ? 'bg-primary/20 text-primary'
                    : 'text-base-content/60'
                }`}
                style={{ width: LEAD_CELL_WIDTH }}
              >
                {stepInBar === 0 ? barIndex + 1 : '\u00a0'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Beat-number header — one column each, and the cursor lives here. */}
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
        <div className="flex shrink-0">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / columnsPerBar);
            const stepInBar = col % columnsPerBar;
            const cell = cellsPerBar[stepInBar];
            return (
              <button
                key={col}
                type="button"
                aria-label={`Bar ${barIndex + 1} step ${stepInBar + 1}`}
                aria-pressed={col === cursor}
                onClick={() => onSelectColumn(col)}
                onKeyDown={(e) => onKeyDown(e, col)}
                // aria-pressed stays: it is the button's SELECTION state, and
                // DEV-371's contract does not change. Only the band goes —
                // the marker is the one thing that says "this column" now.
                className="h-5 flex items-center justify-center text-[9px] leading-none text-base-content/50"
                style={{ width: LEAD_CELL_WIDTH }}
              >
                {cell.isBeatStart ? cell.beatIndex + 1 : '\u00a0'}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
});

export interface LeadMelodyGridProps {
  /**
   * REQUIRED, with no default. A default of 'lead' would make a call site
   * that forgot the prop render a second copy of the lead grid — visually
   * plausible, silently wrong, and caught by no test, because both instances
   * would be internally consistent.
   */
  trackId: MelodyTrackId;
}

// Mounted here, not in the view that renders it: the step used to arrive as
// a prop, so all 174 JSX nodes of the then-1208-line synth view reconciled
// 8x/sec to move one translateX. LeadMelodyGrid is mounted once PER TRACK
// (PatternView.tsx, the Lead and FX segments), which
// is what lets each instance's hooks subscribe the shared clock at all: two
// mounted grids are two players, each holding its own subscription, which is
// exactly what "the clock runs iff a player holds a subscription" permits.
//
// Two hooks, two gates, on purpose. useLeadPlayback schedules NOTES and
// owns the hard stop, so it runs while the track's player plays.
// useLeadStepPublisher moves the MARKER, which for the armed track also has to
// track somebody else's clock while Rec is armed, because that column is the
// recorder's write head — an unarmed track's marker follows its own player
// and nothing else. Its `isPlaying` return is not what the marker uses;
// useLeadMarkerColumn reads the same wider gate the publisher does — from
// inside LeadMarker, so the published step re-renders one div rather than
// this whole body.
//
// `trackId` is REQUIRED and has no default, and must stay that way. A default
// of `'lead'` would let a call site that forgot the prop render a second copy
// of the lead grid — visually plausible, internally consistent in both
// instances, and caught by no test. Rec makes that worse rather than better:
// both copies would agree about which track is armed and both would be wrong
// about which grid the user is looking at.
interface LeadRowLabelsProps {
  rows: readonly string[];
  rowLabels: readonly string[];
  outOfScale: readonly boolean[];
  onPreview: (note: string) => void;
}

/**
 * The note-name column: one preview button per pitch row, standing in the
 * sticky column beside the cell matrix. Clicking one auditions the row's own
 * pitch — the note column is a keyboard, not a caption.
 */
function LeadRowLabels({ rows, rowLabels, outOfScale, onPreview }: LeadRowLabelsProps) {
  return (
    <>
      {rows.map((note, rowIndex) => (
        <button
          key={note}
          type="button"
          onClick={() => onPreview(note)}
          title={`Preview ${rowLabels[rowIndex]}`}
          className={`h-5 flex items-center justify-end pr-2 text-[10px] leading-none cursor-pointer ${leadRowLabelTone(outOfScale[rowIndex])}`}
        >
          {rowLabels[rowIndex]}
        </button>
      ))}
    </>
  );
}

export function LeadMelodyGrid({ trackId }: LeadMelodyGridProps) {
  // Two hooks, two gates, on purpose. useLeadPlayback schedules NOTES and owns
  // the hard stop, so it runs while the track's player plays.
  // useLeadStepPublisher moves the MARKER, which for the armed track also has
  // to track somebody else's clock while Rec is armed, because that column is
  // the recorder's write head — an unarmed track's marker follows its own
  // player and nothing else. Its `isPlaying` return is not what the marker
  // uses; useLeadMarkerColumn reads the same wider gate the publisher does —
  // from inside LeadMarker, so the published step re-renders one div rather
  // than this whole body.
  useLeadPlayback(trackId);
  useLeadStepPublisher(trackId);
  const model = useLeadGridModel(trackId);
  const transport = useLeadGridTransport(trackId, model);
  const commands = useLeadGridCommands(trackId, model);
  const columns = model.columns;

  return (
    // `PanelCard`, not a hand-written copy of its shell: the Beat segment beside
    // this one renders the real component, and the copy that was here differed
    // by a shadow step (`shadow-xl` against PANEL_CARD's `shadow-md`), so two
    // segments one tab-click apart sat at different weights.
    <PanelCard>
      <div className="card-body p-4">
        {/* `Melody`, not `Lead Melody`: the segment row's own `Lead` chip sits
            directly above, so the card names what it HOLDS and the chip names
            which segment — the same split that lets the tab header say
            `Pattern` and nothing more. FX names itself instead, since its own
            segment chip says `FX` and "FX Melody" would be as redundant as
            "Lead Lead Melody".
            Solo rides here rather than in that tab header, because the header
            belongs to the tab now and this button silences one track. It is
            the rule the three Accompaniment module cards already follow. */}
        <ModuleHeader
          className="mb-3"
          right={
            <div className="flex items-center gap-1.5">
              <ModulePasteButton groups={[trackId === 'fx' ? 'fx-pattern' : 'lead-pattern']} />
              <SoloButton track={model.track.solo} />
            </div>
          }
        >
          {/* `children`, not `title`: ModuleHeader's title cell is the
              mixed-case MODULE_TITLE the numbered synth stages wear, and a
              segment's content card is a SECTION — uppercase — like the drum
              grid's and the progression card's. */}
          <span className={SECTION_HEADER}>{model.track.cardTitle}</span>
        </ModuleHeader>

        <LeadGridSettings trackId={trackId} model={model} />

        <div className="overflow-x-auto bg-base-200 p-3 rounded">
          <div className="w-fit mx-auto relative">
            <LeadMelodyHeaders
              cursor={transport.cursor}
              selectedBar={transport.selectedBar}
              onSelectColumn={transport.setMelodyCursor}
              columns={columns}
              cellsPerBar={model.cellsPerBar}
              columnsPerBar={model.colsPerBar}
            />

            {/* Body: note column + cells + marker */}
            <div className="flex">
              <div className="sticky left-0 z-10 shrink-0 bg-panel" style={{ width: LABEL_WIDTH }}>
                <LeadRowLabels
                  rows={model.rows}
                  rowLabels={model.rowLabels}
                  outOfScale={model.outOfScale}
                  onPreview={commands.previewNote}
                />
              </div>

              <div className="shrink-0">
                <LeadMelodyCells
                  trackId={trackId}
                  meter={model.meter}
                  loopLength={model.melodyLoopLength}
                  melody={model.melodySteps}
                  rows={model.rows}
                  rowLabels={model.rowLabels}
                  outOfScale={model.outOfScale}
                  root={model.scaleRoot}
                  onResize={commands.onResize}
                  stride={model.stride}
                  colsPerBar={model.colsPerBar}
                  cellsPerBar={model.cellsPerBar}
                  onPreview={commands.previewNote}
                />
              </div>
            </div>

            {/* Last child of the w-fit container, so it spans the ruler and
                the grid body as one column. */}
            <LeadMarker trackId={trackId} columns={columns} />
          </div>
        </div>

        <LeadGridActions trackId={trackId} transport={transport} commands={commands} />
      </div>
    </PanelCard>
  );
}

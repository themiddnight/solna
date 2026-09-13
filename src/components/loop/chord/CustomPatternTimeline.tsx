import React from 'react';
import { useCurrentStep } from '@/components/playbackStep';
import { useSpanResize, type SpanResizeStart } from '@/components/ui/useSpanResize';
import { cx } from '@/components/ui/cx';
import { beatIndexAt } from '@/utils/meter';
import {
  customPatternCells,
  customPatternKeyOutcome,
  customPatternPositionLabel,
  resizedPatternLength,
  type CustomPatternCell,
} from './customPatternGrid';

/**
 * The one-lane timeline a custom Chord or Bass pattern is edited on: bars laid
 * out horizontally, one cell per visible 16th column, and every event drawn as
 * a block that owns the columns it holds.
 *
 * Why this exists rather than the shared drum `StepRow`: a drum cell is one hit
 * at one step, while a chord or bass event has a LENGTH. The old editor drew a
 * held note as a run of identical active cells — a shape that cannot say where
 * one event ends and the next begins, cannot be resized, and stops being
 * readable the moment a pattern spans more than one bar.
 *
 * Three things this component deliberately does NOT own:
 *
 *  - The values and holds. It receives the stored, bar-major arrays and the
 *    active meter, and derives everything else through the pure model in
 *    `customPatternGrid.ts`. Nothing is written here.
 *  - The colours. The head block's classes arrive as `color` — the caller's
 *    module token — and everything else is a daisyUI semantic role, so the
 *    primitive stays theme-agnostic (`scripts/themeTokenGuard.ts` fails the
 *    build on a raw palette class).
 *  - The pointer plumbing. The resize gesture is `useSpanResize`; this file
 *    must not add a window listener of its own.
 *
 * It is presentational apart from one subscription: the public
 * `CustomPatternTimeline` reads the shared `'chords'` step. `View` is exported
 * separately and takes `currentStep` as a prop, because this repo has no DOM
 * and a subscriber cannot be handed a step in a server-render test.
 */

/** Fallback step width while dragging, when the grid cannot be measured (server render). */
const PATTERN_STEP_PX = 24;

/** Half of CELL_CLASS's `h-9` (36px): the floor below which a column never shrinks. */
const PATTERN_CELL_MIN_WIDTH = 18;

const GRID_CLASS = 'grid gap-px';

const CELL_CLASS = 'h-9';

const EMPTY_CELL_CLASS = cx(
  CELL_CLASS,
  'cursor-pointer border border-base-300/40 hover:bg-base-300',
);

const HEAD_BLOCK_CLASS = cx(
  CELL_CLASS,
  'absolute inset-0 cursor-pointer shadow-md shadow-primary/20',
);

/**
 * The grab strip on a span's right edge. `touch-none` is here and NOT on the
 * scroller: a touch-action of `none` on the container would kill the horizontal
 * scroll this lane needs on a phone, while the handle must swallow the pan so
 * the drag is not stolen by a scroll takeover.
 */
const RESIZE_HANDLE_CLASS =
  'absolute right-0 top-0 h-full w-1.5 cursor-ew-resize touch-none bg-base-content/20';

/** What one head's resize gesture needs to identify — stable by reference. */
interface PatternSpanIdentity {
  column: number;
}

/**
 * Everything a cell needs to render itself. Passed as one object so the cell
 * renderer can live at module scope: a component body that renders three kinds
 * of cell inline is a god function long before it is a god file.
 */
interface PatternCellContext<TValue> {
  nameOf: (column: number, spanName: string) => string;
  valueLabel?: (value: TValue) => string;
  color: string;
  identityFor: (column: number) => PatternSpanIdentity;
  /** Beat-based shading for empty columns, matching the drum grid's zebra. */
  isAltBeat: (column: number) => boolean;
  /** The measured width of one column in px, so a drag follows the cursor. */
  columnWidthPx: () => number;
  previewFor: (identity: PatternSpanIdentity) => number | null;
  startResize: (
    event: React.PointerEvent<HTMLElement>,
    input: SpanResizeStart<PatternSpanIdentity>,
  ) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>, cell: CustomPatternCell<TValue>) => void;
  onActivate: (column: number) => void;
  onResize: (column: number, length: number) => void;
}

/** One column, drawn as its own cell. */
function patternCellNode<TValue>(
  cell: CustomPatternCell<TValue>,
  context: PatternCellContext<TValue>,
): React.ReactNode {
  // A body is the tail of the head before it, not a second event: it is inert,
  // named by nobody, and its only job is to keep the covered columns
  // addressable so a column that is empty still has something to activate.
  if (cell.kind === 'body') {
    return (
      <div
        key={cell.column}
        data-column={cell.column}
        data-owner-column={cell.ownerColumn}
        aria-hidden="true"
        className="pointer-events-none"
        style={{ gridColumn: `${cell.column + 1}`, gridRow: '1' }}
      />
    );
  }

  if (cell.kind === 'empty') {
    return (
      <button
        key={cell.column}
        type="button"
        data-column={cell.column}
        aria-label={context.nameOf(cell.column, 'event')}
        onClick={() => context.onActivate(cell.column)}
        onKeyDown={(event) => context.onKeyDown(event, cell)}
        className={cx(
          EMPTY_CELL_CLASS,
          context.isAltBeat(cell.column) ? 'bg-base-100' : 'bg-base-200',
        )}
        style={{ gridColumn: `${cell.column + 1}`, gridRow: '1' }}
      />
    );
  }

  const spanName = context.valueLabel?.(cell.value) ?? 'event';
  const name = context.nameOf(cell.column, spanName);
  const identity = context.identityFor(cell.column);
  // The live preview while THIS span is being dragged, its stored length
  // otherwise. The block's width and the grid item's span are the same number,
  // so a drag resizes the block without a store write per frame.
  const length = context.previewFor(identity) ?? cell.length;

  return (
    <div
      key={cell.column}
      data-column={cell.column}
      className={cx(CELL_CLASS, 'relative')}
      style={{ gridColumn: `${cell.column + 1} / span ${length}`, gridRow: '1' }}
    >
      <button
        type="button"
        aria-label={name}
        onClick={() => context.onActivate(cell.column)}
        onKeyDown={(event) => context.onKeyDown(event, cell)}
        className={cx(HEAD_BLOCK_CLASS, context.color)}
      >
        {context.valueLabel ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center text-[10px] font-bold leading-none pointer-events-none select-none"
          >
            {spanName}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label={`Resize ${name}`}
        // A focused handle answers the same keys the head does, so it is not a
        // focusable control that does nothing: Enter activates the span (which
        // is what an unmoved press on the handle does with a pointer) and
        // Shift+Arrow resizes it.
        onKeyDown={(event) => context.onKeyDown(event, cell)}
        onPointerDown={(event) =>
          context.startResize(event, {
            identity,
            startLength: cell.length,
            maxLength: cell.maxLength,
            pixelsPerStep: context.columnWidthPx(),
            onCommit: (span, next) => context.onResize(span.column, next),
            onClick: (span) => context.onActivate(span.column),
          })
        }
        className={RESIZE_HANDLE_CLASS}
      />
    </div>
  );
}

/** One bar header per bar, spanning that bar's columns. */
function patternBarHeaders(
  loopLength: number,
  stepsPerBar: number,
): Array<{ key: string; start: number; span: number; bar: number }> {
  return Array.from({ length: loopLength }, (_, bar) => ({
    key: `bar-${bar}`,
    start: bar * stepsPerBar,
    span: stepsPerBar,
    bar: bar + 1,
  }));
}

/**
 * One bar label per bar, flush-left over that bar's first column. Repeats every
 * bar, because a lane can run for four of them and a bare grid of cells says
 * nothing about where you are in the form.
 */
function patternHeaderGrids(
  loopLength: number,
  stepsPerBar: number,
  gridStyle: React.CSSProperties,
): React.ReactNode {
  return (
    <div className={GRID_CLASS} style={gridStyle}>
      {patternBarHeaders(loopLength, stepsPerBar).map((bar) => (
        <div
          key={bar.key}
          className="py-1 text-left text-[10px] font-bold text-base-content/60"
          style={{ gridColumn: `${bar.start + 1} / span ${bar.span}`, gridRow: '1' }}
        >
          {`Bar ${bar.bar}`}
        </div>
      ))}
    </div>
  );
}

/** One column's measured width, gap included: what a drag divides by so the
 * resize follows the cursor. The columns are flexible (1fr), so a fixed
 * pixels-per-step reads as a different step count at every container width. */
function patternColumnWidthPx(grid: HTMLDivElement | null, cycleSteps: number): number {
  return grid ? grid.getBoundingClientRect().width / cycleSteps : PATTERN_STEP_PX;
}

/** Hairline dividers at each bar boundary, one fewer than the bar count. */
function patternBarDividers(loopLength: number, stepsPerBar: number): React.ReactNode {
  return Array.from({ length: loopLength - 1 }, (_, bar) => {
    const dividerColumn = (bar + 1) * stepsPerBar;
    return (
      <div
        key={`bar-divider-${dividerColumn}`}
        data-bar-divider={dividerColumn}
        aria-hidden="true"
        className="pointer-events-none w-px bg-base-content/25"
        style={{
          gridColumn: `${dividerColumn + 1}`,
          gridRow: '1',
          justifySelf: 'start',
        }}
      />
    );
  });
}

/** The marker over the column the transport is on, in this lane's own cycle. */
function patternPlayheadNode(foldedStep: number, positionLabel: string): React.ReactNode {
  return (
    <div
      data-playhead-column={foldedStep}
      aria-label={`Playhead at ${positionLabel}`}
      className="pointer-events-none h-9 ring-2 ring-primary"
      style={{ gridColumn: `${foldedStep + 1}`, gridRow: '1' }}
    />
  );
}

export interface CustomPatternTimelineViewProps<TValue> {
  /** Bar-major fixed-width storage, `loopLength * MAX_STEPS_PER_BAR` entries. */
  values: readonly TValue[];
  /** Hold length in 16th steps per stored slot; see `customPatternCells`. */
  holds: readonly number[];
  /** The lane's cycle length in bars: a divisor of the progression's bars. */
  loopLength: number;
  /** Bar length of the ACTIVE meter, in 16th steps. */
  stepsPerBar: number;
  /** The active meter's accent groups, summing to `stepsPerBar`. */
  accentGroups: readonly number[];
  /** Folded chord boundaries, in cycle steps — cap every span. */
  boundaries: readonly number[];
  /** The value that marks a slot with no event (`false`, `'rest'`). */
  empty: TValue;
  /** Lane name used in accessible names: "Chord", "Bass". */
  label: string;
  /** Module token classes for an event block, e.g. `bg-module-chord …`. */
  color: string;
  /** Optional short name for an active value ("5th"); heads default to "event". */
  valueLabel?: (value: TValue) => string;
  /** Whether the transport runs; a stopped lane draws no playhead. */
  isPlaying: boolean;
  /** The run-absolute step, or null. Folded by this lane's cycle before drawing. */
  currentStep: number | null;
  /** A click or Enter/Space on a column: set the event there. */
  onActivate: (column: number) => void;
  /** Delete/Backspace: clear the event at that column. */
  onErase: (column: number) => void;
  /** A committed resize: the span's new length, in 16th steps. */
  onResize: (column: number, length: number) => void;
  /** Extra classes on the horizontal scroller. */
  className?: string;
}

/**
 * The timeline as markup, with the transport position handed in. Exported
 * because a subscriber cannot be given a step under `renderToString`.
 */
export function CustomPatternTimelineView<TValue>({
  values,
  holds,
  loopLength,
  stepsPerBar,
  accentGroups,
  boundaries,
  empty,
  label,
  color,
  valueLabel,
  isPlaying,
  currentStep,
  onActivate,
  onErase,
  onResize,
  className,
}: CustomPatternTimelineViewProps<TValue>) {
  const cycleSteps = loopLength * stepsPerBar;
  const cells = customPatternCells(values, holds, loopLength, stepsPerBar, empty, boundaries);
  const identities = React.useRef(new Map<number, PatternSpanIdentity>());
  const gridRef = React.useRef<HTMLDivElement>(null);
  const { previewFor, startResize } = useSpanResize<PatternSpanIdentity>();

  // `previewFor` compares identity BY REFERENCE, so a span must keep the ONE
  // object it began its gesture with. One object per column, minted lazily and
  // reused for as long as the lane is mounted — a fresh literal per render
  // would silently stop the preview from ever matching.
  const identityFor = (column: number): PatternSpanIdentity => {
    let identity = identities.current.get(column);
    if (!identity) {
      identity = { column };
      identities.current.set(column, identity);
    }
    return identity;
  };

  // Empty columns shade by beat, matching the drum grid's zebra.
  const isAltBeat = (column: number): boolean =>
    beatIndexAt(column % stepsPerBar, accentGroups) % 2 === 0;
  const columnWidthPx = (): number => patternColumnWidthPx(gridRef.current, cycleSteps);

  const nameOf = (column: number, spanName: string): string =>
    `${label} ${spanName} at ${customPatternPositionLabel(column, stepsPerBar, accentGroups)}`;

  const onKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
    cell: CustomPatternCell<TValue>,
  ): void => {
    const outcome = customPatternKeyOutcome(event.key, event.shiftKey, cell);
    if (outcome === 'none') return;
    // Enter and Space would otherwise also fire the button's click, writing
    // the activation twice.
    event.preventDefault();
    if (outcome === 'erase') {
      onErase(cell.column);
    } else if (outcome === 'resize' && cell.kind === 'head') {
      onResize(cell.column, resizedPatternLength(cell, event.key));
    } else {
      onActivate(cell.column);
    }
  };

  const context: PatternCellContext<TValue> = {
    nameOf,
    valueLabel,
    color,
    identityFor,
    isAltBeat,
    columnWidthPx,
    previewFor,
    startResize,
    onKeyDown,
    onActivate,
    onResize,
  };

  const gridStyle = { gridTemplateColumns: `repeat(${cycleSteps}, minmax(0, 1fr))` };
  // The 'chords' publisher emits a PROGRESSION-relative step, so this lane
  // folds it by its own cycle: without the modulo a two-bar lane would have no
  // column for step 20, and with it step 20 and step 52 are the same place.
  const foldedStep =
    currentStep === null ? null : ((currentStep % cycleSteps) + cycleSteps) % cycleSteps;

  return (
    <div className={cx('overflow-x-auto', className)}>
      <div className="pb-1" role="group" aria-label={`${label} pattern`}
        style={{ minWidth: `${cycleSteps * PATTERN_CELL_MIN_WIDTH}px` }}>
        {patternHeaderGrids(loopLength, stepsPerBar, gridStyle)}
        <div ref={gridRef} className={GRID_CLASS} style={gridStyle}>
          {cells.map((cell) => patternCellNode(cell, context))}
          {patternBarDividers(loopLength, stepsPerBar)}
          {isPlaying && foldedStep !== null
            ? patternPlayheadNode(
                foldedStep,
                customPatternPositionLabel(foldedStep, stepsPerBar, accentGroups),
              )
            : null}
        </div>
      </div>
    </div>
  );
}

/** Every view prop except the one the subscriber supplies. */
export type CustomPatternTimelineProps<TValue> = Omit<
  CustomPatternTimelineViewProps<TValue>,
  'currentStep'
>;

/**
 * The timeline as the panels use it: the thin subscriber that reads the shared
 * chord step and hands it down.
 */
export function CustomPatternTimeline<TValue>(props: CustomPatternTimelineProps<TValue>) {
  const currentStep = useCurrentStep('chords');
  return <CustomPatternTimelineView<TValue> {...props} currentStep={currentStep} />;
}

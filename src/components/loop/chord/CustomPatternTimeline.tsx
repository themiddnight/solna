import React from 'react';
import { useSegmentGatedStep } from '@/components/playbackStep';
import { useSpanResize, type SpanResizeStart } from '@/components/ui/useSpanResize';
import { cx } from '@/components/ui/cx';
import { beatIndexAt } from '@/utils/meter';
import {
  customPatternCells,
  customPatternFoldedStep,
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
 * It is presentational apart from one subscription, and that subscription is
 * isolated to its own leaf: `CustomPatternTimeline` (the memoized cell grid,
 * exported below) never reads the shared `'chords'` step, so a step tick
 * cannot force it to rebuild its up-to-~128 cells or its per-cell context.
 * `CustomPatternPlayhead` is the ONLY thing in this file that calls
 * `useSegmentGatedStep` — mirroring the Lead grid's `LeadMarker`/`LeadMarkerView`
 * split — and `CustomPatternTimeline` renders it inline, as a grid item
 * inside the SAME `display:grid` container the cells live in (unlike
 * `LeadMarker`, which is a plain sibling positioned by pixel `translateX`:
 * this lane's columns are `1fr` tracks, so only a fellow grid item lines up
 * with them). A step change therefore re-renders `CustomPatternPlayhead`
 * alone; the grid is untouched.
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

export interface CustomPatternTimelineProps<TValue> {
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
  /** A click or Enter/Space on a column: set the event there. */
  onActivate: (column: number) => void;
  /** Delete/Backspace: clear the event at that column. */
  onErase: (column: number) => void;
  /** A committed resize: the span's new length, in 16th steps. */
  onResize: (column: number, length: number) => void;
  /** Extra classes on the horizontal scroller. */
  className?: string;
}

interface CustomPatternPlayheadProps {
  /** The lane's cycle length in bars: a divisor of the progression's bars. */
  loopLength: number;
  /** Bar length of the ACTIVE meter, in 16th steps. */
  stepsPerBar: number;
  /** The active meter's accent groups, summing to `stepsPerBar`. */
  accentGroups: readonly number[];
  /** Whether the transport runs; a stopped lane draws no playhead. */
  isPlaying: boolean;
}

/**
 * The playhead alone, subscribed. The ONLY thing in this file that calls
 * `useSegmentGatedStep` — mirroring `LeadMarker` — so a published step (8-16/sec
 * while this lane's transport runs) re-renders one grid item instead of the
 * whole lane. Rendered as a CHILD of `CustomPatternTimeline`'s own grid
 * container, not as a component-tree sibling the way `LeadMarker` is: this
 * lane's columns are `1fr` tracks sized by the browser, not a fixed pixel
 * width, so `gridColumn` placement only lines up with the cells when the
 * playhead is a fellow item of that same `display:grid` container.
 *
 * The subscription is also gated on Pattern-segment focus
 * (`useSegmentGatedStep`, `'accompaniment'`): Chord and Bass both live on the
 * Accompaniment segment, which — like every Pattern segment — stays mounted
 * even while Lead, FX or Beat is on screen, so an ungated subscription kept
 * this playhead re-rendering at the clock's rate for a lane nobody was
 * looking at. Chord/bass playback itself subscribes to the clock separately
 * and is unaffected by focus.
 */
function CustomPatternPlayhead({
  loopLength,
  stepsPerBar,
  accentGroups,
  isPlaying,
}: CustomPatternPlayheadProps): React.ReactNode {
  const currentStep = useSegmentGatedStep('chords', 'accompaniment');
  const cycleSteps = loopLength * stepsPerBar;
  const foldedStep = customPatternFoldedStep(currentStep, cycleSteps);
  if (!isPlaying || foldedStep === null) return null;
  return patternPlayheadNode(
    foldedStep,
    customPatternPositionLabel(foldedStep, stepsPerBar, accentGroups),
  );
}

/** Everything `usePatternCellContext` needs, one object so its own signature
 * stays a single parameter — see the planner convention this mirrors. */
interface PatternCellContextInput<TValue> {
  label: string;
  color: string;
  valueLabel?: (value: TValue) => string;
  stepsPerBar: number;
  accentGroups: readonly number[];
  cycleSteps: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  onActivate: (column: number) => void;
  onErase: (column: number) => void;
  onResize: (column: number, length: number) => void;
}

/**
 * The per-cell context object, split out of `CustomPatternTimeline` so the
 * component's own body stays short enough to read: everything here is
 * `useCallback`/`useMemo`'d on the actual data dependencies, so a step tick —
 * which never reaches this hook at all — cannot be what rebuilds it.
 */
function usePatternCellContext<TValue>({
  label,
  color,
  valueLabel,
  stepsPerBar,
  accentGroups,
  cycleSteps,
  gridRef,
  onActivate,
  onErase,
  onResize,
}: PatternCellContextInput<TValue>): PatternCellContext<TValue> {
  const identities = React.useRef(new Map<number, PatternSpanIdentity>());
  const { previewFor, startResize } = useSpanResize<PatternSpanIdentity>();

  // `previewFor` compares identity BY REFERENCE, so a span must keep the ONE
  // object it began its gesture with. One object per column, minted lazily and
  // reused for as long as the lane is mounted — a fresh literal per render
  // would silently stop the preview from ever matching.
  const identityFor = React.useCallback((column: number): PatternSpanIdentity => {
    let identity = identities.current.get(column);
    if (!identity) {
      identity = { column };
      identities.current.set(column, identity);
    }
    return identity;
  }, []);

  // Empty columns shade by beat, matching the drum grid's zebra.
  const isAltBeat = React.useCallback(
    (column: number): boolean => beatIndexAt(column % stepsPerBar, accentGroups) % 2 === 0,
    [stepsPerBar, accentGroups],
  );
  const columnWidthPx = React.useCallback(
    (): number => patternColumnWidthPx(gridRef.current, cycleSteps),
    [gridRef, cycleSteps],
  );

  const nameOf = React.useCallback(
    (column: number, spanName: string): string =>
      `${label} ${spanName} at ${customPatternPositionLabel(column, stepsPerBar, accentGroups)}`,
    [label, stepsPerBar, accentGroups],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>, cell: CustomPatternCell<TValue>): void => {
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
    },
    [onErase, onResize, onActivate],
  );

  return React.useMemo<PatternCellContext<TValue>>(
    () => ({
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
    }),
    [
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
    ],
  );
}

/**
 * The cell grid: every column, drawn from `values`/`holds`, with no per-step
 * subscription anywhere in it — `currentStep` never reaches this component at
 * all, which is what actually isolates a step tick from this ~128-cell grid:
 * `CustomPatternPlayhead` is the only subscriber and it renders as its own
 * grid item, so a step change re-renders that one item and never walks back
 * up into this component's own render at all. That isolation holds with or
 * without a `React.memo` around the component below — a step tick was never
 * going to re-render `CustomPatternTimeline` in the first place, because
 * nothing in it reads the step.
 *
 * There IS no `React.memo` here, on purpose. One was tried and removed: its
 * default shallow prop comparison never bails, because both call sites
 * (`ChordModulePanel`, `BassModulePanel`) pass fresh `onActivate`/`onErase`
 * closures on every render, so `prevProps.onActivate === nextProps.onActivate`
 * is false on every single render regardless of whether anything changed — the
 * exact same defect class the Beat voice grid's memo had before its own
 * comparator was written (`BeatVoiceCard.tsx`'s `arePropsEqual`). A `memo`
 * that never bails costs a shallow comparison every render and buys nothing,
 * which reads as protection while providing none. The actual win inside this
 * component is `cells` and `context` (`usePatternCellContext`'s own
 * `useMemo`/`useCallback`s): both are memoized on the data that changes them,
 * so a parent re-render that leaves `values`/`holds`/the callbacks referentially
 * unchanged still skips rebuilding either — but neither call site currently
 * holds its callbacks stable, so that win is theoretical today, not measured.
 * Making it real means `useCallback`-wrapping `onActivate`/`onErase` at both
 * call sites, deliberately left undone here rather than folded into this fix:
 * expanding the surface without a measured need is a second decision, not
 * an inert-memo cleanup.
 */
export function CustomPatternTimeline<TValue>({
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
  onActivate,
  onErase,
  onResize,
  className,
}: CustomPatternTimelineProps<TValue>) {
  const cycleSteps = loopLength * stepsPerBar;
  const cells = React.useMemo(
    () => customPatternCells(values, holds, loopLength, stepsPerBar, empty, boundaries),
    [values, holds, loopLength, stepsPerBar, empty, boundaries],
  );
  const gridRef = React.useRef<HTMLDivElement>(null);
  const context = usePatternCellContext<TValue>({
    label,
    color,
    valueLabel,
    stepsPerBar,
    accentGroups,
    cycleSteps,
    gridRef,
    onActivate,
    onErase,
    onResize,
  });

  const gridStyle = { gridTemplateColumns: `repeat(${cycleSteps}, minmax(0, 1fr))` };

  return (
    <div className={cx('overflow-x-auto', className)}>
      <div className="pb-1" role="group" aria-label={`${label} pattern`}
        style={{ minWidth: `${cycleSteps * PATTERN_CELL_MIN_WIDTH}px` }}>
        {patternHeaderGrids(loopLength, stepsPerBar, gridStyle)}
        <div ref={gridRef} className={GRID_CLASS} style={gridStyle}>
          {cells.map((cell) => patternCellNode(cell, context))}
          {patternBarDividers(loopLength, stepsPerBar)}
          <CustomPatternPlayhead
            loopLength={loopLength}
            stepsPerBar={stepsPerBar}
            accentGroups={accentGroups}
            isPlaying={isPlaying}
          />
        </div>
      </div>
    </div>
  );
}

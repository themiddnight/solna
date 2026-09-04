import type { LeadNotePaintMode } from '@/store/types';

/** A stroke can only draw or erase — 'toggle' is the click's business. */
export type LeadPaintMode = Exclude<LeadNotePaintMode, 'toggle'>;

export interface LeadPaintCommit {
  stepIndex: number;
  note: string;
  mode: LeadPaintMode;
}

export interface LeadPaintController {
  isActive: () => boolean;
  begin: (
    pointerId: number,
    stepIndex: number,
    col: number,
    note: string,
    covered: boolean,
  ) => void;
  visit: (pointerId: number, stepIndex: number, col: number, note: string) => void;
  end: (pointerId: number) => void;
}

/** Identity of one cell within a gesture: the row's note at a stored step. */
export function leadPaintKey(stepIndex: number, note: string): string {
  return `${stepIndex}:${note}`;
}

/**
 * Whether a click came from the keyboard rather than a pointer.
 *
 * The pointer session already commits what a mouse click would, so letting
 * the click through as well would immediately undo the stroke's first cell.
 * `detail` is 0 for Enter/Space on a button and 1+ for a real click, which
 * makes this a POSITIVE test for keyboard rather than a flag the pointer
 * path has to remember to set and clear.
 */
export function leadPaintClickIsKeyboard(detail: number): boolean {
  return detail === 0;
}

/**
 * The drag-to-paint state machine, deliberately free of React and the DOM so
 * the whole gesture can be tested as a sequence. The hook around it only
 * forwards events; every decision is here.
 *
 * The mode is decided ONCE, from the cell the gesture started on, and never
 * re-derived from later cells: a stroke that flipped to erase the moment it
 * crossed a filled cell would eat the notes it had just drawn.
 */
export function createLeadPaintController(
  emit: (commit: LeadPaintCommit) => void,
  resolveStepIndex: (col: number) => number,
): LeadPaintController {
  let mode: LeadPaintMode | null = null;
  let pointer = -1;
  let visited = new Set<string>();
  let last: { col: number; note: string } | null = null;

  const commit = (stepIndex: number, note: string): void => {
    if (!mode) return;
    const key = leadPaintKey(stepIndex, note);
    if (visited.has(key)) return;
    visited.add(key);
    emit({ stepIndex, note, mode });
  };

  return {
    isActive: () => mode !== null,
    begin: (pointerId, stepIndex, col, note, covered) => {
      mode = covered ? 'erase' : 'draw';
      pointer = pointerId;
      visited = new Set();
      last = { col, note };
      commit(stepIndex, note);
    },
    visit: (pointerId, stepIndex, col, note) => {
      if (mode === null || pointerId !== pointer) return;
      // A pointer moving faster than one cell per event skips the cells in
      // between, which comes out as a dotted line. Fill them — but only along
      // one row: a diagonal sweep crosses rows, and joining those cells would
      // invent a run of notes the user never drew.
      if (last && last.note === note && Math.abs(col - last.col) > 1) {
        const dir = col > last.col ? 1 : -1;
        for (let c = last.col + dir; c !== col; c += dir) commit(resolveStepIndex(c), note);
      }
      last = { col, note };
      commit(stepIndex, note);
    },
    end: (pointerId) => {
      if (pointerId !== pointer) return;
      mode = null;
      visited = new Set();
      last = null;
    },
  };
}


/** The parts of a pointer event the paint handlers read. */
export interface LeadPaintPointerLike {
  pointerId: number;
  button?: number;
}

/** The part of a click event that says whether a keyboard produced it. */
export interface LeadPaintClickLike {
  detail: number;
}

export interface LeadPaintHandlers {
  onCellPointerDown: (
    e: LeadPaintPointerLike,
    stepIndex: number,
    col: number,
    note: string,
    covered: boolean,
  ) => void;
  onCellPointerEnter: (
    e: LeadPaintPointerLike,
    stepIndex: number,
    col: number,
    note: string,
  ) => void;
  onCellClick: (e: LeadPaintClickLike, stepIndex: number, note: string) => void;
}

/**
 * Turns pointer and click events into controller calls. Kept out of the hook
 * so the event filtering — which button may paint, which click may toggle —
 * is testable; a rule that only exists inside a JSX callback is a rule this
 * repo cannot check at all.
 */
export function createLeadPaintHandlers(
  controller: LeadPaintController,
  toggle: (stepIndex: number, note: string) => void,
): LeadPaintHandlers {
  return {
    onCellPointerDown: (e, stepIndex, col, note, covered) => {
      // Only the primary button draws. `button` is 0 for touch and pen too.
      if ((e.button ?? 0) !== 0) return;
      controller.begin(e.pointerId, stepIndex, col, note, covered);
    },
    onCellPointerEnter: (e, stepIndex, col, note) => {
      controller.visit(e.pointerId, stepIndex, col, note);
    },
    onCellClick: (e, stepIndex, note) => {
      if (!leadPaintClickIsKeyboard(e.detail)) return;
      toggle(stepIndex, note);
    },
  };
}

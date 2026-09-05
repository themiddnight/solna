import { MAX_STEPS_PER_BAR } from './meter';

/**
 * How fine a lead melody cell is — the lead's second axis, on top of meter.
 *
 * This is deliberately NOT in meter.ts. That module's header states that
 * the 16th-note grid never changes, and it imports nothing at all so that
 * audio/, store/ and components/ may all reach it. A lead-only subdivision
 * table inside it would make its own header false and would put lead
 * concerns in a module the sequencer and the metronome depend on. Meter
 * answers "how long is a bar"; this answers "how fine is a lead cell". One
 * imports the other, in that direction only.
 *
 * The scheme is the one meter already teaches, one dimension over: STORE at
 * the finest and STRIDE to the active. A reshape on every resolution change
 * would silently lose the notes between the coarse columns on the way back.
 */

/** Ticks per clock 16th. The melody is stored at 1/32, always. */
export const TICKS_PER_SIXTEENTH = 2;

/**
 * The stored width of one melody bar, in ticks — the widest meter at the
 * finest resolution. Lead-only: the sequencer, chord-rhythm and bass grids
 * keep storing at MAX_STEPS_PER_BAR and are not part of this scheme.
 */
export const LEAD_TICKS_PER_BAR = MAX_STEPS_PER_BAR * TICKS_PER_SIXTEENTH;

export type LeadStepResolutionId = '1/8' | '1/16' | '1/32';

/**
 * How many stored ticks one column spans, per resolution. A bare stride
 * table rather than a row type: the id IS its own display string, so a row
 * would only carry a `label` equal to its own key and an `id` equal to it
 * too — three copies of one fact to keep in agreement.
 */
export const LEAD_STEP_STRIDES: Record<LeadStepResolutionId, number> = {
  '1/8': 4,
  '1/16': 2,
  '1/32': 1,
};

/** Declaration order — coarse to fine, the order the select lists them in. */
export const LEAD_STEP_RESOLUTION_IDS: LeadStepResolutionId[] = ['1/8', '1/16', '1/32'];

/**
 * 1/16 is not an arbitrary default: it is the resolution every project that
 * exists today was authored at, so a loop without the field opens with
 * every note on the same beat, the same length and the same sound.
 */
export const DEFAULT_LEAD_STEP_RESOLUTION: LeadStepResolutionId = '1/16';

export function isLeadStepResolutionId(value: unknown): value is LeadStepResolutionId {
  return typeof value === 'string' && Object.hasOwn(LEAD_STEP_STRIDES, value);
}

/**
 * The stride for an id — the only thing any caller ever wanted from the
 * table, which is why there is no exported row resolver beside it.
 *
 * Anything unknown — a persisted id from a future build, a corrupt payload,
 * an empty string — falls back to the default rather than throwing: this
 * value feeds the scheduler, and a throw there would freeze the transport.
 * Exactly getMeter's rule, for exactly the same reason.
 */
export function strideFor(id: string | null | undefined): number {
  const resolved = isLeadStepResolutionId(id) ? id : DEFAULT_LEAD_STEP_RESOLUTION;
  return LEAD_STEP_STRIDES[resolved];
}

/**
 * How many columns one bar draws: its ticks divided by the stride. Whole
 * for all eighteen meter x resolution combinations, pinned by
 * stepResolution.test.ts — so no bar ever ends mid-column.
 *
 * Floors at 1 rather than returning 0 or NaN for nonsense input: a
 * zero-column bar divides the grid by nothing and sizes the marker in NaN
 * pixels, which is worse than one wrong column.
 */
export function columnsPerBar(stepsPerBar: number, stride: number): number {
  if (!(stride > 0) || !(stepsPerBar > 0)) return 1;
  return Math.max(1, Math.floor((stepsPerBar * TICKS_PER_SIXTEENTH) / stride));
}

/**
 * How many CELLS a tick-counted length occupies — what SOUNDS is what is
 * DRAWN, in ONE place. The scheduler (resolveLeadStepTriggers), the live
 * recorder (heldStepLength) and the grid renderer (melodyGrid's
 * leadNoteCells re-export) all round a tick count to whole cells, and a
 * note that showed as two cells while sounding for five ticks reintroduces
 * exactly the invisible state silent dormancy was chosen to avoid.
 *
 * It lives HERE and not in melodyGrid.ts because audio/ may never import
 * components/ (CLAUDE.md, three-layer rule), and three prose comments
 * claiming to hold three copies of `Math.max(1, Math.ceil(len / stride))`
 * together is not a mechanism.
 *
 * Floors at one cell: a zero-length note is neither audible nor drawable,
 * and rounding UP is the only direction that agrees with what the note
 * already sounded and drew.
 */
export function leadNoteCells(len: number, stride: number): number {
  const cell = stride > 0 ? stride : 1;
  return Math.max(1, Math.ceil(len / cell));
}

/**
 * Pull a column onto the grid: the shared clamp behind the lead cursor
 * (clampLeadCursor), the stopped marker (leadMarkerColumn) and arrow-key
 * navigation (leadCursorKeyTarget).
 *
 * Clamping, not wrapping, is the point of it: these three sources are all
 * USER-placed positions rather than clock quantities, and landing on column
 * 0 via modulo would look like the user chose column 0, which they didn't.
 * A clock step wraps instead — see wrapColumn in audio/leadLiveRecord.ts.
 *
 * Non-finite input answers 0 rather than propagating NaN into a grid
 * template that would then size every column in NaN pixels.
 */
export function clampColumn(column: number, columns: number): number {
  if (!Number.isFinite(column)) return 0;
  return Math.min(Math.max(0, columns - 1), Math.max(0, Math.round(column)));
}

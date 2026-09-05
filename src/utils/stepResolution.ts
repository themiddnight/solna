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

export interface LeadStepResolution {
  id: LeadStepResolutionId;
  /** Display string for the melody grid's select. */
  label: string;
  /** How many stored ticks one column spans. */
  stride: number;
}

export const LEAD_STEP_RESOLUTIONS: Record<LeadStepResolutionId, LeadStepResolution> = {
  '1/8': { id: '1/8', label: '1/8', stride: 4 },
  '1/16': { id: '1/16', label: '1/16', stride: 2 },
  '1/32': { id: '1/32', label: '1/32', stride: 1 },
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
  return typeof value === 'string' && Object.hasOwn(LEAD_STEP_RESOLUTIONS, value);
}

/**
 * Resolve a resolution id. Anything unknown — a persisted id from a future
 * build, a corrupt payload, an empty string — falls back to the default
 * rather than throwing: this value feeds the scheduler, and a throw there
 * would freeze the transport. Exactly getMeter's rule, for exactly the same
 * reason.
 */
export function getLeadStepResolution(id: string | null | undefined): LeadStepResolution {
  return isLeadStepResolutionId(id)
    ? LEAD_STEP_RESOLUTIONS[id]
    : LEAD_STEP_RESOLUTIONS[DEFAULT_LEAD_STEP_RESOLUTION];
}

/** The stride alone, for the many call sites that want only the number. */
export function strideFor(id: string | null | undefined): number {
  return getLeadStepResolution(id).stride;
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

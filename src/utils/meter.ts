/**
 * The closed meter table and every bar-relative derivation in the app.
 *
 * This module imports NOTHING. That is load-bearing: audio/, store/ and
 * components/ all need it, and the eslint layering rules (eslint.config.js)
 * only permit that for a leaf module under utils/.
 *
 * The 16th-note grid never changes — every meter in scope is an integer number
 * of 16th steps per bar — so meter is a plumbing concern, not a DSP one.
 */

export type MeterId = '4/4' | '3/4' | '6/8' | '12/8' | '5/4' | '7/8';

export interface Meter {
  id: MeterId;
  /** Display string for the transport select. */
  label: string;
  /** Bar length, in 16th steps. */
  stepsPerBar: number;
  /**
   * 16th steps per beat group; MUST sum to stepsPerBar (pinned by meter.test.ts).
   *
   * This replaces a separate `stepsPerBeat` field and is the single source for
   * three things: where the metronome clicks, how many beats the chord playhead
   * counts, and how the sequencer UI draws its beat groupings. 3/4 and 6/8 share
   * a 12-step bar and are distinguished ONLY by this field — which is exactly
   * why bar length alone is not a sufficient pattern tag.
   */
  accentGroups: number[];
}

export const METERS: Record<MeterId, Meter> = {
  '4/4': { id: '4/4', label: '4/4', stepsPerBar: 16, accentGroups: [4, 4, 4, 4] },
  '3/4': { id: '3/4', label: '3/4', stepsPerBar: 12, accentGroups: [4, 4, 4] },
  '6/8': { id: '6/8', label: '6/8', stepsPerBar: 12, accentGroups: [6, 6] },
  '12/8': { id: '12/8', label: '12/8', stepsPerBar: 24, accentGroups: [6, 6, 6, 6] },
  '5/4': { id: '5/4', label: '5/4', stepsPerBar: 20, accentGroups: [4, 4, 4, 4, 4] },
  // 3+2+2, the standard Balkan grouping.
  '7/8': { id: '7/8', label: '7/8', stepsPerBar: 14, accentGroups: [6, 4, 4] },
};

/** Declaration order — the order the transport select lists them in. */
export const METER_IDS: MeterId[] = ['4/4', '3/4', '6/8', '12/8', '5/4', '7/8'];

export const DEFAULT_METER_ID: MeterId = '4/4';

/**
 * The widest bar in the table (the 12/8 row). Sequencer step arrays are always
 * STORED at this width so switching meter is non-destructive to the user's own
 * programming; playback and the UI window the first `stepsPerBar` entries.
 */
export const MAX_STEPS_PER_BAR = 24;

export function isMeterId(value: unknown): value is MeterId {
  return typeof value === 'string' && Object.hasOwn(METERS, value);
}

/**
 * Resolve a meter id. Anything unknown — a persisted id from a future build, a
 * corrupt payload, an empty string — falls back to 4/4 rather than throwing:
 * this value feeds the clock, and a throw there would freeze the transport.
 */
export function getMeter(id: string | null | undefined): Meter {
  return isMeterId(id) ? METERS[id] : METERS[DEFAULT_METER_ID];
}

/**
 * Which accent group contains `stepInBar`. For 4/4 this is exactly
 * `Math.floor(stepInBar / 4)`, which is what the engine currently dispatches as
 * its `beat` argument — so 4/4 output is unchanged by construction.
 *
 * Out-of-range steps clamp instead of returning NaN: a negative step reports
 * beat 0 and an overrun reports the last beat.
 */
export function beatIndexAt(stepInBar: number, accentGroups: number[]): number {
  if (accentGroups.length === 0) return 0;
  if (stepInBar <= 0) return 0;
  let cursor = 0;
  for (let i = 0; i < accentGroups.length; i++) {
    cursor += accentGroups[i];
    if (stepInBar < cursor) return i;
  }
  return accentGroups.length - 1;
}

/**
 * True only on the FIRST step of an accent group — i.e. where the metronome
 * clicks. For 4/4 this is exactly `stepInBar % 4 === 0`.
 */
export function isBeatBoundary(stepInBar: number, accentGroups: number[]): boolean {
  if (stepInBar < 0) return false;
  let cursor = 0;
  for (const group of accentGroups) {
    if (stepInBar === cursor) return true;
    cursor += group;
    if (stepInBar < cursor) return false;
  }
  return false;
}

/**
 * The arpeggiator's rate table (audio/arpSchedule.ts) fires on
 * `step % stepMod` with stepMod in {4, 2, 1, 0.5}, and the engine's
 * `clockStepIndex` is monotonic and never resets. When `stepsPerBar` is NOT a
 * multiple of 4 (7/8 = 14 steps) the arp phase slides against the bar line and
 * never lands the same way twice.
 *
 * `arpStepFor` re-phases the arp at each bar by widening every bar to the next
 * multiple of ARP_PHASE_QUANTUM for phase purposes only. This is DELIBERATE
 * behaviour, not a rounding artefact: in an odd meter the arp restarts its
 * subdivision phase on every downbeat.
 *
 * It is the IDENTITY whenever `stepsPerBar` is already a multiple of 4 — which
 * covers every meter in the table except 7/8 — so 4/4 output is byte-identical.
 */
export const ARP_PHASE_QUANTUM = 4;

export function arpBarPhaseLength(stepsPerBar: number): number {
  return Math.ceil(stepsPerBar / ARP_PHASE_QUANTUM) * ARP_PHASE_QUANTUM;
}

export function arpStepFor(clockStep: number, stepsPerBar: number): number {
  if (stepsPerBar <= 0) return clockStep;
  const barIndex = Math.floor(clockStep / stepsPerBar);
  const stepInBar = clockStep - barIndex * stepsPerBar;
  return barIndex * arpBarPhaseLength(stepsPerBar) + stepInBar;
}

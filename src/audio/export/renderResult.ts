/**
 * What every export renderer shares — the failure reasons, the progress
 * phases, the guarded reporter, the walk's yield cadence and the task yield.
 *
 * Kept apart from `renderMixdown.ts` because that file pulls in the engine,
 * and the MIDI export must run where `OfflineAudioContext` does not exist: it
 * may import values from here, only types from there (eslint, DEV-428).
 */

/**
 * Why a render produced no file. A union rather than a string so the slice's
 * `projectNotice` sentence is a switch the compiler checks, and so a test can
 * assert the reason without matching prose.
 */
export type MixdownFailureReason =
  | { kind: 'empty-arrangement' }
  | { kind: 'unsupported-context' }
  | { kind: 'cancelled' }
  | { kind: 'render-failed'; detail: string };

/** The failure branch of every renderer's result union. */
export interface RenderFailure {
  ok: false;
  reason: MixdownFailureReason;
}

export const RENDER_CANCELLED: RenderFailure = { ok: false, reason: { kind: 'cancelled' } };

export function renderFailed(err: unknown): RenderFailure {
  return { ok: false, reason: { kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) } };
}

export type MixdownRenderProgress =
  | { phase: 'preparing' }
  | { phase: 'rendering'; percent: number }
  | { phase: 'encoding' };

export type MixdownProgressReporter = (progress: MixdownRenderProgress) => void;

/** A progress observer must never be able to turn a valid render into a failure. */
export function safeProgressReporter(reporter?: MixdownProgressReporter): MixdownProgressReporter {
  return (progress) => {
    try {
      reporter?.(progress);
    } catch {
      // Reporting is best-effort; the render remains authoritative.
    }
  };
}

/**
 * Walk steps between yields (and, for the MIDI walk, progress reports). Chosen
 * so a yield lands roughly every few hundred AudioNode constructions on a
 * dense arrangement — frequent enough that Cancel feels responsive, rare
 * enough that the yield overhead (a macrotask hop) stays negligible next to
 * the scheduling work itself.
 */
export const WALK_YIELD_INTERVAL_STEPS = 200;

/** One macrotask hop: lets React paint a phase, and lets Cancel land. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

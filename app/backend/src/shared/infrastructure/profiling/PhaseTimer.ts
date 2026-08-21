import { performance } from 'node:perf_hooks';
import { loggingService } from '../logging/LoggingService';

/**
 * Lightweight per-phase timer for profiling hot paths (DEV-178).
 *
 * Construct once at the start of a request/connection, call `mark(phase)` at each
 * phase boundary, then `flush(metric, context)` once at the end to emit a single
 * structured performance log with a per-phase breakdown.
 *
 * When `enabled` is false every method is a near-no-op (no `performance.now()`
 * calls, no allocation churn, no logging), so it is safe to leave wired into the
 * hot path and toggle via `config.profiling.joinPath` (env `PROFILE_JOIN_PATH`).
 */
export class PhaseTimer {
  private readonly enabled: boolean;
  private readonly start: number = 0;
  private last = 0;
  private readonly phases: Record<string, number> = {};

  constructor(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      this.start = performance.now();
      this.last = this.start;
    }
  }

  /** Record the elapsed time since the previous mark (or construction) under `phase`. */
  mark(phase: string): void {
    if (!this.enabled) return;
    const now = performance.now();
    this.phases[phase] = (this.phases[phase] ?? 0) + (now - this.last);
    this.last = now;
  }

  /** Emit a single structured performance log with the per-phase breakdown + total. */
  flush(metric: string, context: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    const totalMs = round(performance.now() - this.start);
    const phases: Record<string, number> = {};
    for (const [phase, ms] of Object.entries(this.phases)) {
      phases[phase] = round(ms);
    }
    loggingService.logPerformanceMetric(metric, totalMs, { ...context, phases });
  }
}

/** Round to 2 decimal places to keep sub-millisecond resolution without log noise. */
function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

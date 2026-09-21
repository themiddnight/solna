import type { DiagnosticRenderId } from './types';

let active = false;
let counts: Partial<Record<DiagnosticRenderId, number>> = {};

/** A deliberately tiny hot-path hook. It is a no-op until a recording starts. */
export function markDiagnosticRender(id: DiagnosticRenderId): void {
  if (!active) return;
  counts[id] = (counts[id] ?? 0) + 1;
}

export function startDiagnosticRenderCounting(): () => void {
  active = true;
  counts = {};
  return () => {
    active = false;
    counts = {};
  };
}

export function drainDiagnosticRenderCounts(): Partial<Record<DiagnosticRenderId, number>> {
  const drained = counts;
  counts = {};
  return drained;
}


import type { AudioHealthSnapshot } from './runtime/healthMonitor';

export interface ClockDiagnosticSnapshot {
  listeners: number;
  dispatches: number;
  stalls: number;
  maxStallMs: number;
}

export interface VoiceDiagnosticSnapshot {
  groups: number;
  physicalVoices: number;
  registered: number;
  bySource: Record<string, number>;
}

export interface AudioDiagnosticSnapshot {
  contextState: AudioContextState | 'uninitialized';
  currentTimeSec: number | null;
  baseLatencySec: number | null;
  outputLatencySec: number | null;
  clock: ClockDiagnosticSnapshot;
  voices: VoiceDiagnosticSnapshot;
  readonly health?: AudioHealthSnapshot;
}

interface ContextWithLatency {
  baseLatency?: unknown;
  outputLatency?: unknown;
}

function finiteLatency(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function audioLatencySnapshot(ctx: BaseAudioContext | null): {
  baseLatencySec: number | null;
  outputLatencySec: number | null;
} {
  if (!ctx) return { baseLatencySec: null, outputLatencySec: null };
  const latency = ctx as ContextWithLatency;
  return {
    baseLatencySec: finiteLatency(latency.baseLatency),
    outputLatencySec: finiteLatency(latency.outputLatency),
  };
}

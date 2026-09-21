import { DIAGNOSTIC_SCHEMA_VERSION, type DiagnosticSessionV1 } from './types';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isGapCounts(value: unknown): boolean {
  return isObject(value)
    && isNumber(value.over50)
    && isNumber(value.over100)
    && isNumber(value.over250)
    && isNumber(value.maxMs);
}

function isDiagnosticSample(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.activity) || !isObject(value.audio)) return false;
  const activity = value.activity;
  const audio = value.audio;
  return isNumber(value.elapsedMs)
    && typeof value.route === 'string'
    && isNumber(value.collectorCostMs)
    && isNumber(activity.storeWrites)
    && isNumber(activity.playheadWrites)
    && isGapCounts(activity.eventLoopLag)
    && isGapCounts(activity.frameGaps)
    && isObject(audio.clock)
    && isNumber(audio.clock.stalls)
    && isNumber(audio.clock.maxStallMs)
    && isObject(audio.voices)
    && isNumber(audio.voices.physicalVoices);
}

export function isDiagnosticSessionV1(value: unknown): value is DiagnosticSessionV1 {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<DiagnosticSessionV1>;
  return session.schemaVersion === DIAGNOSTIC_SCHEMA_VERSION
    && typeof session.id === 'string'
    && typeof session.startedAt === 'number'
    && (session.endedAt === null || typeof session.endedAt === 'number')
    && typeof session.userAgent === 'string'
    && typeof session.standalone === 'boolean'
    && Array.isArray(session.samples)
    && session.samples.every(isDiagnosticSample)
    && typeof session.capabilities === 'object'
    && session.capabilities !== null;
}

export function serializeDiagnosticSession(session: DiagnosticSessionV1): string {
  return JSON.stringify(session, null, 2);
}

const maxOf = (values: number[]) => values.length === 0 ? 0 : Math.max(...values);
const sumOf = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function diagnosticSummary(session: DiagnosticSessionV1) {
  const costs = session.samples.map((sample) => sample.collectorCostMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(costs.length * 0.95) - 1);
  const last = session.samples.at(-1);
  return {
    interrupted: session.endedAt === null,
    durationMs: session.endedAt === null
      ? (last?.elapsedMs ?? 0)
      : Math.max(0, session.endedAt - session.startedAt),
    samples: session.samples.length,
    collectorP95Ms: costs[p95Index] ?? 0,
    maxEventLoopLagMs: maxOf(session.samples.map((sample) => sample.activity.eventLoopLag.maxMs)),
    maxFrameGapMs: maxOf(session.samples.map((sample) => sample.activity.frameGaps.maxMs)),
    clockStalls: maxOf(session.samples.map((sample) => sample.audio.clock.stalls)),
    maxClockStallMs: maxOf(session.samples.map((sample) => sample.audio.clock.maxStallMs)),
    maxPhysicalVoices: maxOf(session.samples.map((sample) => sample.audio.voices.physicalVoices)),
    totalStoreWrites: sumOf(session.samples.map((sample) => sample.activity.storeWrites)),
    totalPlayheadWrites: sumOf(session.samples.map((sample) => sample.activity.playheadWrites)),
  };
}

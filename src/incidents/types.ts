import type { AudioClockEvidence } from '@/audio/runtime/healthMonitor';
import type { RuntimeProfile } from '@/audio/runtime/profile';

export type { RuntimeProfile };

export const INCIDENT_KINDS = [
  'audio-health',
  'render-crash',
  'unhandled-error',
  'operation-failure',
  'manual',
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_SEVERITIES = ['fatal', 'interrupted', 'degraded'] as const;
type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const RECOVERY_RESULTS = [
  'recovered',
  'construct-failed',
  'resume-failed',
  'build-failed',
  'validate-failed',
] as const;

/** An error reduced to strings that cannot carry user content. */
export interface SanitizedError {
  name: string;
  message: string;
  stack: string | null;
  componentStack: string | null;
}

export interface RecoveryAttempt {
  startedAfterIncidentMs: number;
  generation: number;
  result: (typeof RECOVERY_RESULTS)[number];
}

/**
 * The whole public report. Every field is named here on purpose: there is no
 * open-ended bag, so nothing can be added to a report by accident.
 */
export interface IncidentReportV1 {
  schemaVersion: 1;
  id: string;
  fingerprint: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  occurredAt: number;
  buildId: string;
  summary: string;
  runtime: RuntimeProfile;
  error: SanitizedError | null;
  audio: { generation: number; samples: readonly AudioClockEvidence[] } | null;
  recoveryAttempts: readonly RecoveryAttempt[];
}

/** What a detector hands over; the reporter adds runtime, build and identity. */
export interface DetectedIncidentInput {
  kind: 'render-crash' | 'unhandled-error' | 'operation-failure' | 'manual';
  severity: IncidentReportV1['severity'];
  summary: string;
  error: SanitizedError | null;
}

export type RenderIncidentInput = DetectedIncidentInput & { kind: 'render-crash' };

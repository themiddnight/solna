import type { IncidentReportV1, RecoveryAttempt, SanitizedError } from './types';
import { INCIDENT_KINDS, INCIDENT_SEVERITIES, RECOVERY_RESULTS } from './types';

const MAX_MESSAGE_CHARS = 300;
const MAX_STACK_CHARS = 2000;
const MAX_STACK_FRAMES = 12;
const MAX_SAMPLES = 300;
const MAX_NAME_CHARS = 80;
const MAX_ATTEMPTS = 20;

const URL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/[^\s?#)'"]*)(?:[?#][^\s)'"]*)?/gi;
// Windows drive paths, and absolute POSIX paths with at least two segments.
const WIN_PATH_PATTERN = /\b[A-Za-z]:\\[^\s)'":]*/g;
const POSIX_PATH_PATTERN = /(?<![\w:/.])\/(?:[\w.@~+-]+\/)+[\w.@~+-]*/g;

/** Strips query/hash from URLs, and replaces local file paths with `<path>`. */
function redactText(text: string): string {
  return text
    .replace(URL_PATTERN, (_m, base: string) => base)
    .replace(WIN_PATH_PATTERN, '<path>')
    .replace(POSIX_PATH_PATTERN, '<path>');
}

function bound(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sanitizeStack(stack: string, maxChars: number): string | null {
  const lines = stack
    .split('\n')
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => redactText(line).trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  return bound(lines.join('\n'), maxChars);
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Reduces anything thrown to name, message, stack and component stack. Nested
 * objects, `cause`, and own enumerable properties are never read.
 */
export function sanitizeError(error: unknown, componentStack?: string | null): SanitizedError {
  let name = 'Error';
  let message = '';
  let stack: string | null = null;
  if (error instanceof Error) {
    name = error.name || 'Error';
    message = error.message;
    stack = stringField(error.stack);
  } else if (typeof error === 'string') {
    message = error;
  } else if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    name = stringField(record.name) ?? 'Error';
    message = stringField(record.message) ?? '';
    stack = stringField(record.stack);
  }
  return {
    name: bound(redactText(name), MAX_NAME_CHARS),
    message: bound(redactText(message), MAX_MESSAGE_CHARS),
    stack: stack === null ? null : sanitizeStack(stack, MAX_STACK_CHARS),
    componentStack: componentStack ? sanitizeStack(componentStack, MAX_STACK_CHARS) : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNullableString = (v: unknown): boolean => v === null || typeof v === 'string';

function isSanitizedError(value: unknown): value is SanitizedError {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['name', 'message', 'stack', 'componentStack']) &&
    typeof value.name === 'string' &&
    typeof value.message === 'string' &&
    isNullableString(value.stack) &&
    isNullableString(value.componentStack)
  );
}

function isRuntime(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['engine', 'platform', 'standalone', 'userAgent']) &&
    typeof value.engine === 'string' &&
    typeof value.platform === 'string' &&
    typeof value.standalone === 'boolean' &&
    typeof value.userAgent === 'string'
  );
}

function isEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['elapsedMs', 'audioTimeSec', 'ratio', 'contextState', 'visible']) &&
    isFiniteNumber(value.elapsedMs) &&
    isFiniteNumber(value.audioTimeSec) &&
    (value.ratio === null || isFiniteNumber(value.ratio)) &&
    typeof value.contextState === 'string' &&
    typeof value.visible === 'boolean'
  );
}

function isAttempt(value: unknown): value is RecoveryAttempt {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['startedAfterIncidentMs', 'generation', 'result']) &&
    isFiniteNumber(value.startedAfterIncidentMs) &&
    isFiniteNumber(value.generation) &&
    (RECOVERY_RESULTS as readonly unknown[]).includes(value.result)
  );
}

function isAudio(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      hasExactKeys(value, ['generation', 'samples']) &&
      isFiniteNumber(value.generation) &&
      Array.isArray(value.samples) &&
      value.samples.length <= MAX_SAMPLES &&
      value.samples.every(isEvidence))
  );
}

/**
 * Closed-schema check: unknown keys anywhere fail, so a stored or imported
 * body cannot smuggle extra fields into something later shared publicly.
 */
export function isIncidentReportV1(value: unknown): value is IncidentReportV1 {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'schemaVersion', 'id', 'fingerprint', 'kind', 'severity', 'occurredAt',
      'buildId', 'summary', 'runtime', 'error', 'audio', 'recoveryAttempts',
    ]) &&
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    typeof value.fingerprint === 'string' &&
    (INCIDENT_KINDS as readonly unknown[]).includes(value.kind) &&
    (INCIDENT_SEVERITIES as readonly unknown[]).includes(value.severity) &&
    isFiniteNumber(value.occurredAt) &&
    typeof value.buildId === 'string' &&
    typeof value.summary === 'string' &&
    isRuntime(value.runtime) &&
    (value.error === null || isSanitizedError(value.error)) &&
    isAudio(value.audio) &&
    Array.isArray(value.recoveryAttempts) &&
    value.recoveryAttempts.length <= MAX_ATTEMPTS &&
    value.recoveryAttempts.every(isAttempt)
  );
}

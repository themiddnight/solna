import { sanitizeError } from './sanitize';
import type { DetectedIncidentInput } from './types';

/**
 * The only operations allowed to raise an incident. The category is the whole
 * summary: a project or file name never reaches a public report.
 */
type ReportableOperation = 'boot' | 'mixdown' | 'midi-export' | 'project-load' | 'project-save';
type OperationSeverity = DetectedIncidentInput['severity'];

/**
 * Names browsers, the Google identity library and IndexedDB give to outcomes
 * the user caused or the app already answers with its own notice.
 */
const EXPECTED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'AbortError',
  'QuotaExceededError',
  'popup_closed',
  'popup_failed_to_open',
  'access_denied',
]);

/**
 * fetch() rejects with a bare TypeError and no other identity, so the message
 * is the only signal that an ordinary network outage happened. Matched on
 * these exact browser texts, and only for TypeError.
 */
const NETWORK_TYPE_ERROR_MESSAGES: ReadonlySet<string> = new Set([
  'Failed to fetch',
  'Load failed',
  'NetworkError when attempting to fetch resource.',
]);

/** Cancellation, quota, authentication and ordinary network failure are expected, never crashes. */
export function isExpectedFailure(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { name, message } = value as { name?: unknown; message?: unknown };
  if (typeof name !== 'string') return false;
  if (EXPECTED_ERROR_NAMES.has(name)) return true;
  return name === 'TypeError' && typeof message === 'string' && NETWORK_TYPE_ERROR_MESSAGES.has(message);
}

type OperationFailureSink = (input: DetectedIncidentInput) => void;
let sink: OperationFailureSink | null = null;

/** Wired by `store/incidentReporter.ts`: this folder may not import the store. */
export function setOperationFailureSink(next: OperationFailureSink | null): void {
  sink = next;
}

/** Additional evidence only; never a replacement for the operation's own notice. Never throws. */
export function reportOperationFailure(
  operation: ReportableOperation,
  error: unknown,
  severity: OperationSeverity,
): void {
  if (sink === null || isExpectedFailure(error)) return;
  try {
    sink({
      kind: 'operation-failure',
      severity,
      summary: `Unexpected failure during ${operation}`,
      error: sanitizeError(error),
    });
  } catch {
    // Reporting must never turn a handled failure into a second one.
  }
}

import { isExpectedFailure } from './operationFailure';
import { sanitizeError } from './sanitize';
import type { DetectedIncidentInput } from './types';

type CaptureTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Listens for uncaught errors and unhandled rejections and hands each distinct
 * one to `report` as a sanitized incident. An `error` event with no error
 * object (cross-origin "Script error.", ResizeObserver loop notices) carries
 * nothing worth reporting and is skipped. Returns the cleanup.
 */
export function installGlobalIncidentCapture(
  target: CaptureTarget,
  report: (input: DetectedIncidentInput) => void,
): () => void {
  const seen = new WeakSet<object>();

  function capture(error: unknown): void {
    if (error === null || error === undefined) return;
    if (isExpectedFailure(error)) return;
    if (typeof error === 'object') {
      if (seen.has(error)) return;
      seen.add(error);
    }
    report({
      kind: 'unhandled-error',
      severity: 'degraded',
      summary: 'Solna hit an unexpected error',
      error: sanitizeError(error),
    });
  }

  const onError = (event: Event) => {
    const error = (event as ErrorEvent).error as unknown;
    // Only a real thrown object counts: a bare message string has no identity to dedupe or classify.
    if (typeof error !== 'object' || error === null) return;
    capture(error);
  };
  const onRejection = (event: Event) => capture((event as PromiseRejectionEvent).reason);

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

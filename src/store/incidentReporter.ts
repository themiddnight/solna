import { audioEngine } from '@/audio/engine';
import { incidentPersistence, incidentStore, dismissIncident, publishIncident } from '@/incidents/incidentStore';
import { setOperationFailureSink } from '@/incidents/operationFailure';
import { newIncidentId } from '@/incidents/newId';
import { incidentFingerprint } from '@/incidents/fingerprint';
import { createIncidentRecorder } from '@/incidents/recorder';
import { audioRecoveryStore } from './audioRecovery';
import { BUILD_ID } from './buildId';
import type { AudioClockEvidence } from '@/audio/runtime/healthMonitor';
import type { DetectedIncidentInput, RenderIncidentInput } from '@/incidents/types';


/** Route categories a manual report may name; anything else is "unknown". Never the full path or query. */
const ROUTE_CATEGORIES = ['loop', 'song'] as const;

export function routeCategory(pathname: string): string {
  const first = pathname.split('/').find((part) => part.length > 0) ?? '';
  return ROUTE_CATEGORIES.find((category) => category === first) ?? 'unknown';
}

function freeze(input: DetectedIncidentInput, evidence: readonly AudioClockEvidence[] = []) {
  const recorder = createIncidentRecorder({
    store: incidentPersistence,
    runtime: audioEngine.getRuntimeProfile(),
    buildId: BUILD_ID,
    now: () => Date.now(),
    newId: () => newIncidentId(),
  });
  for (const sample of evidence) recorder.recordSample(sample);
  return recorder.freezeAudioIncident({ ...input, generation: 0 });
}

/**
 * Replacement rule (spec: "publishing a newer incident replaces the slot"):
 * a detected incident replaces whatever is held, except that (a) an unresolved
 * audio incident is never displaced while its recovery is still owed, and (b) a
 * repeat of the held fingerprint adds nothing. A stale report hydrated from a
 * previous session therefore never suppresses new evidence. Detected incidents
 * are published quietly (transport warning), not as a modal.
 */
function reportDetected(input: DetectedIncidentInput): void {
  const held = incidentStore.getState().current;
  const status = audioRecoveryStore.getState().status;
  const audioOwed = status === 'unhealthy' || status === 'recovering' || status === 'failed';
  if (held !== null && held.kind === 'audio-health' && audioOwed && input.kind !== 'render-crash') return;
  // Compared before freezing: freeze persists, and a repeat must not rewrite the slot.
  const fingerprint = incidentFingerprint({
    kind: input.kind,
    error: input.error,
    runtime: audioEngine.getRuntimeProfile(),
    buildId: BUILD_ID,
  });
  if (held !== null && held.fingerprint === fingerprint) return;
  publishIncident(freeze(input));
  dismissIncident();
}

export const reportGlobalIncident = reportDetected;

setOperationFailureSink(reportDetected);

export function reportRenderIncident(input: RenderIncidentInput): void {
  reportDetected(input);
}

/** User-initiated: opens the dialog. Carries runtime/build and a route category only; never project content. */
export function reportManualIncident(pathname: string = window.location.pathname): void {
  publishIncident(
    freeze({
      kind: 'manual',
      severity: 'degraded',
      summary: `Manual bug report from the ${routeCategory(pathname)} view`,
      error: null,
    }, audioEngine.getRecentAudioHealthSamples()),
  );
}

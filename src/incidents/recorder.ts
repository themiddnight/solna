import type { AudioClockEvidence } from '@/audio/runtime/healthMonitor';
import { incidentFingerprint } from './fingerprint';
import type { IncidentStore } from './storage';
import type { IncidentKind, IncidentReportV1, RecoveryAttempt, RuntimeProfile, SanitizedError } from './types';

/** Matches the playback health monitor's own retention; the recorder adds no sampling of its own. */
const MAX_SAMPLES = 300;

export interface IncidentRecorderDependencies {
  store: IncidentStore;
  runtime: RuntimeProfile;
  buildId: string;
  now: () => number;
  newId: () => string;
}

export interface FreezeIncidentInput {
  kind: IncidentKind;
  severity: IncidentReportV1['severity'];
  summary: string;
  error: SanitizedError | null;
  /** Audio generation; only `audio-health`, and a manual report with recorded samples, carry audio evidence. */
  generation: number;
}

export function createIncidentRecorder(dependencies: IncidentRecorderDependencies) {
  const { store, runtime, buildId, now, newId } = dependencies;
  let samples: AudioClockEvidence[] = [];
  let latest: IncidentReportV1 | null = null;

  function persist(incident: IncidentReportV1): void {
    void store.save(incident).catch(() => undefined);
  }

  return {
    recordSample(sample: AudioClockEvidence): void {
      samples.push(structuredClone(sample));
      if (samples.length > MAX_SAMPLES) samples = samples.slice(samples.length - MAX_SAMPLES);
    },
    freezeAudioIncident(input: FreezeIncidentInput): IncidentReportV1 {
      const error = input.error === null ? null : structuredClone(input.error);
      const incident: IncidentReportV1 = {
        schemaVersion: 1,
        id: newId(),
        fingerprint: incidentFingerprint({ kind: input.kind, error, runtime, buildId }),
        kind: input.kind,
        severity: input.severity,
        occurredAt: now(),
        buildId,
        summary: input.summary,
        runtime: structuredClone(runtime),
        error,
        audio:
          input.kind === 'audio-health' || (input.kind === 'manual' && samples.length > 0)
            ? { generation: input.generation, samples: structuredClone(samples) }
            : null,
        recoveryAttempts: [],
      };
      latest = incident;
      persist(incident);
      return structuredClone(incident);
    },
    appendRecoveryAttempt(id: string, attempt: RecoveryAttempt): IncidentReportV1 | null {
      if (latest === null || latest.id !== id) return null;
      latest = { ...latest, recoveryAttempts: [...latest.recoveryAttempts, structuredClone(attempt)] };
      persist(latest);
      return structuredClone(latest);
    },
  };
}

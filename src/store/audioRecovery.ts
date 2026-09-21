import { createStore, type StoreApi } from 'zustand/vanilla';
import { audioEngine, type AudioRecoveryResult } from '@/audio/engine';
import type { AudioClockEvidence, AudioHealthSnapshot } from '@/audio/runtime/healthMonitor';
import { incidentPersistence, publishIncident, updateIncident } from '@/incidents/incidentStore';
import { newIncidentId } from '@/incidents/newId';
import { createIncidentRecorder } from '@/incidents/recorder';
import type { RecoveryAttempt } from '@/incidents/types';
import { applyEngineSnapshot } from './engineSync';
import { BUILD_ID } from './buildId';
import { useAppStore } from './store';

type AudioRecoveryStatus = 'healthy' | 'unhealthy' | 'recovering' | 'ready' | 'failed';

/**
 * Recovery state lives in its own tiny external store, deliberately NOT in the
 * persisted app store: it is session-only, and nothing here may be written per
 * audio sample (only on a phase transition).
 */
export interface AudioRecoveryState {
  status: AudioRecoveryStatus;
  /** Whether the recovery modal is showing; dismissing keeps the status. */
  modalOpen: boolean;
  /** Clock evidence captured at the moment the session was declared unhealthy. */
  evidence: readonly AudioClockEvidence[];
}

export interface AudioRecoveryDeps {
  subscribeHealth(listener: (snapshot: AudioHealthSnapshot) => void): () => void;
  getRecentAudioHealthSamples(): readonly AudioClockEvidence[];
  recreateRealtimeSession(): Promise<AudioRecoveryResult>;
  validateRealtimeClock(): Promise<boolean>;
  hardStopAll(): void;
  applyEngineSnapshot(): void;
  /** Freezes the incident report; runs before hardStopAll so the evidence is not disturbed by the stop. */
  freezeIncident(evidence: readonly AudioClockEvidence[], generation: number): void;
  /** Appends one recovery attempt to the frozen report. */
  recordRecoveryAttempt(attempt: RecoveryAttempt): void;
  now(): number;
}

export interface AudioRecoveryController {
  store: StoreApi<AudioRecoveryState>;
  startBridge(): () => void;
  recover(): Promise<void>;
  dismiss(): void;
  reopen(): void;
}

const FAILURE_RESULT = {
  construct: 'construct-failed',
  resume: 'resume-failed',
  build: 'build-failed',
} as const satisfies Record<Extract<AudioRecoveryResult, { ok: false }>['reason'], RecoveryAttempt['result']>;

const INITIAL: AudioRecoveryState = { status: 'healthy', modalOpen: false, evidence: [] };

export function createAudioRecovery(deps: AudioRecoveryDeps): AudioRecoveryController {
  const store = createStore<AudioRecoveryState>(() => INITIAL);
  let inFlight: Promise<void> | null = null;
  let frozenAt = 0;
  let frozenGeneration = 0;

  function recordAttempt(result: RecoveryAttempt['result'], generation: number): void {
    deps.recordRecoveryAttempt({
      startedAfterIncidentMs: Math.max(0, attemptStartedAt - frozenAt),
      generation,
      result,
    });
  }
  let attemptStartedAt = 0;

  function handleHealth(snapshot: AudioHealthSnapshot): void {
    if (snapshot.phase !== 'unhealthy') return;
    const { status } = store.getState();
    // Repeated events, or an event while a recovery is running / awaiting a
    // decision, must do nothing.
    if (status !== 'healthy' && status !== 'ready') return;
    const evidence = deps.getRecentAudioHealthSamples().slice();
    frozenAt = deps.now();
    frozenGeneration = snapshot.generation;
    deps.freezeIncident(evidence, snapshot.generation);
    deps.hardStopAll();
    store.setState({ status: 'unhealthy', modalOpen: true, evidence });
  }

  function recover(): Promise<void> {
    if (inFlight) return inFlight;
    const { status } = store.getState();
    if (status !== 'unhealthy' && status !== 'failed') return Promise.resolve();
    attemptStartedAt = deps.now();
    store.setState({ status: 'recovering' });
    // The engine call is made synchronously, inside the user's gesture, so the
    // new context is constructed/resumed before the first async yield.
    let pending: Promise<AudioRecoveryResult>;
    try {
      pending = deps.recreateRealtimeSession();
    } catch {
      recordAttempt('construct-failed', frozenGeneration);
      store.setState({ status: 'failed' });
      return Promise.resolve();
    }
    const run = (async () => {
      try {
        const result = await pending;
        if (!result.ok) {
          recordAttempt(FAILURE_RESULT[result.reason], result.generation);
          store.setState({ status: 'failed' });
          return;
        }
        deps.applyEngineSnapshot();
        const valid = await deps.validateRealtimeClock();
        recordAttempt(valid ? 'recovered' : 'validate-failed', result.generation);
        store.setState(valid ? { status: 'ready', modalOpen: false } : { status: 'failed' });
      } catch {
        recordAttempt('build-failed', frozenGeneration);
        store.setState({ status: 'failed' });
      }
    })();
    inFlight = run;
    void run.finally(() => {
      if (inFlight === run) inFlight = null;
    });
    return run;
  }

  return {
    store,
    startBridge: () => deps.subscribeHealth(handleHealth),
    recover,
    dismiss: () => store.setState({ modalOpen: false }),
    reopen: () => store.setState({ modalOpen: true }),
  };
}

let recorder: ReturnType<typeof createIncidentRecorder> | null = null;
let incidentId: string | null = null;

const controller = createAudioRecovery({
  now: () => performance.now(),
  // A fresh recorder per incident, so samples never carry over from an earlier one.
  freezeIncident: (evidence, generation) => {
    recorder = createIncidentRecorder({
      store: incidentPersistence,
      runtime: audioEngine.getRuntimeProfile(),
      buildId: BUILD_ID,
      now: () => Date.now(),
      newId: () => newIncidentId(),
    });
    for (const sample of evidence) recorder.recordSample(sample);
    const report = recorder.freezeAudioIncident({
      kind: 'audio-health',
      severity: 'interrupted',
      summary: 'Audio playback stopped responding',
      error: null,
      generation,
    });
    incidentId = report.id;
    publishIncident(report);
  },
  recordRecoveryAttempt: (attempt) => {
    if (recorder === null || incidentId === null) return;
    const updated = recorder.appendRecoveryAttempt(incidentId, attempt);
    if (updated !== null) updateIncident(updated);
  },
  subscribeHealth: (listener) => audioEngine.subscribeHealth(listener),
  getRecentAudioHealthSamples: () => audioEngine.getRecentAudioHealthSamples(),
  recreateRealtimeSession: () => audioEngine.recreateRealtimeSession(),
  validateRealtimeClock: () => audioEngine.validateRealtimeClock(),
  hardStopAll: () => useAppStore.getState().hardStopAll(),
  applyEngineSnapshot,
});

export const audioRecoveryStore = controller.store;
export const startAudioRecoveryBridge = controller.startBridge;
export const recoverAudio = controller.recover;
export const dismissAudioRecovery = controller.dismiss;
export const reopenAudioRecovery = controller.reopen;

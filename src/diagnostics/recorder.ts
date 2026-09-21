import {
  DIAGNOSTIC_SCHEMA_VERSION,
  type DiagnosticActivity,
  type DiagnosticSampleBase,
  type DiagnosticSessionV1,
} from './types';
import {
  drainDiagnosticRenderCounts,
  startDiagnosticRenderCounting,
} from './renderCounts';

export const MAX_DIAGNOSTIC_SAMPLES = 1_800;
const FLUSH_SAMPLE_INTERVAL = 10;

interface LongTaskObservation {
  supported: boolean;
  stop(): void;
}

export interface DiagnosticRecorderDependencies {
  now(): number;
  wallNow(): number;
  captureBase(elapsedMs: number): DiagnosticSampleBase;
  scheduleEverySecond(listener: (lagMs?: number) => void): () => void;
  subscribeStore(listener: () => void): () => void;
  subscribePlayhead(listener: () => void): () => void;
  observeFrameGaps(listener: (gapMs: number) => void): () => void;
  observeLongTasks(listener: (durationMs: number) => void): LongTaskObservation;
  onPageHide(listener: () => void): () => void;
  saveLatest(session: DiagnosticSessionV1): Promise<void>;
  userAgent?: string;
  standalone?: boolean;
  heapSupported?: boolean;
}

interface DiagnosticRecorderState {
  status: 'idle' | 'recording' | 'stopped';
  session: DiagnosticSessionV1 | null;
  storage: 'ready' | 'unavailable';
}

export interface DiagnosticRecorder {
  start(): Promise<void>;
  stop(): Promise<DiagnosticSessionV1 | null>;
  getState(): DiagnosticRecorderState;
  subscribe(listener: () => void): () => void;
}

function emptyActivity(longTasksSupported: boolean): DiagnosticActivity {
  return {
    storeWrites: 0,
    playheadWrites: 0,
    renders: {},
    eventLoopLag: { over50: 0, over100: 0, over250: 0, maxMs: 0 },
    frameGaps: { over50: 0, over100: 0, over250: 0, maxMs: 0 },
    longTasks: { supported: longTasksSupported, count: 0, totalMs: 0, maxMs: 0 },
  };
}

function cloneSession(session: DiagnosticSessionV1): DiagnosticSessionV1 {
  return structuredClone(session);
}

function recordGap(
  gaps: { over50: number; over100: number; over250: number; maxMs: number },
  gapMs: number,
): void {
  if (gapMs > 50) gaps.over50 += 1;
  if (gapMs > 100) gaps.over100 += 1;
  if (gapMs > 250) gaps.over250 += 1;
  gaps.maxMs = Math.max(gaps.maxMs, gapMs);
}

function newSession(
  deps: DiagnosticRecorderDependencies,
  startedAt: number,
  longTasksSupported: boolean,
): DiagnosticSessionV1 {
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    id: `diag-${startedAt}`,
    startedAt,
    endedAt: null,
    userAgent: deps.userAgent ?? '',
    standalone: deps.standalone ?? false,
    capabilities: {
      longTasks: longTasksSupported,
      heap: deps.heapSupported ?? false,
    },
    samples: [],
  };
}

export function createDiagnosticRecorder(deps: DiagnosticRecorderDependencies): DiagnosticRecorder {
  let state: DiagnosticRecorderState = { status: 'idle', session: null, storage: 'ready' };
  let cleanup: Array<() => void> = [];
  let activity = emptyActivity(false);
  let startedAtMonotonic = 0;
  let samplesCaptured = 0;
  let saveChain: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const updateState = (patch: Partial<DiagnosticRecorderState>) => {
    state = { ...state, ...patch };
    notify();
  };

  const persist = (): Promise<void> => {
    const session = state.session;
    if (!session) return Promise.resolve();
    const snapshot = cloneSession(session);
    saveChain = saveChain
      .catch(() => {})
      .then(() => deps.saveLatest(snapshot))
      .catch(() => {
        if (state.storage !== 'unavailable') updateState({ storage: 'unavailable' });
      });
    return saveChain;
  };

  const resetActivity = (longTasksSupported: boolean) => {
    activity = emptyActivity(longTasksSupported);
  };

  const sample = (lagMs = 0) => {
    const session = state.session;
    if (!session) return;
    const before = deps.now();
    const elapsedMs = Math.max(0, before - startedAtMonotonic);
    const base = deps.captureBase(elapsedMs);
    const capturedActivity: DiagnosticActivity = {
      ...activity,
      renders: drainDiagnosticRenderCounts(),
      frameGaps: { ...activity.frameGaps },
      longTasks: { ...activity.longTasks },
    };
    recordGap(capturedActivity.eventLoopLag, lagMs);
    const collectorCostMs = Math.max(0, deps.now() - before);
    session.samples.push({ ...base, activity: capturedActivity, collectorCostMs });
    if (session.samples.length > MAX_DIAGNOSTIC_SAMPLES) session.samples.shift();
    samplesCaptured += 1;
    resetActivity(session.capabilities.longTasks);
    updateState({ session });
    if (samplesCaptured % FLUSH_SAMPLE_INTERVAL === 0) void persist();
  };

  const dispose = () => {
    for (const stop of cleanup.splice(0)) stop();
  };

  return {
    start: async () => {
      if (state.status === 'recording') return;
      dispose();
      startedAtMonotonic = deps.now();
      samplesCaptured = 0;
      const longTasks = deps.observeLongTasks((durationMs) => {
        activity.longTasks.count += 1;
        activity.longTasks.totalMs += durationMs;
        activity.longTasks.maxMs = Math.max(activity.longTasks.maxMs, durationMs);
      });
      resetActivity(longTasks.supported);
      const startedAt = deps.wallNow();
      const session = newSession(deps, startedAt, longTasks.supported);
      updateState({ status: 'recording', session, storage: 'ready' });
      cleanup = [
        deps.scheduleEverySecond(sample),
        deps.subscribeStore(() => { activity.storeWrites += 1; }),
        deps.subscribePlayhead(() => { activity.playheadWrites += 1; }),
        deps.observeFrameGaps((gapMs) => recordGap(activity.frameGaps, gapMs)),
        longTasks.stop,
        deps.onPageHide(() => { void persist(); }),
        startDiagnosticRenderCounting(),
      ];
    },
    stop: async () => {
      const session = state.session;
      if (!session || state.status !== 'recording') return session;
      dispose();
      session.endedAt = deps.wallNow();
      updateState({ status: 'stopped', session });
      await persist();
      return session;
    },
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

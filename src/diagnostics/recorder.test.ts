import { describe, expect, test } from 'bun:test';
import {
  MAX_DIAGNOSTIC_SAMPLES,
  createDiagnosticRecorder,
  type DiagnosticRecorderDependencies,
} from './recorder';
import { markDiagnosticRender } from './renderCounts';
import type { DiagnosticSampleBase } from './types';

function baseSample(elapsedMs: number): DiagnosticSampleBase {
  return {
    elapsedMs,
    route: '/loop?tab=sound',
    visibility: 'visible',
    viewport: { width: 393, height: 852, dpr: 3 },
    navigation: { activeTab: 'sound', focusTrack: 'synth' },
    transport: {
      bpm: 120,
      meterId: '4/4',
      players: { sequencer: 'playing', chords: 'playing', lead: 'stopped', fx: 'stopped' },
    },
    dom: { elements: 100, canvases: 2 },
    audio: {
      contextState: 'running',
      currentTimeSec: 1,
      baseLatencySec: null,
      outputLatencySec: null,
      clock: { listeners: 2, dispatches: 16, stalls: 0, maxStallMs: 0 },
      voices: { groups: 2, physicalVoices: 6, registered: 2, bySource: { chord: 6 } },
    },
    heapUsedBytes: null,
  };
}

function harness() {
  let now = 0;
  let interval: ((lagMs?: number) => void) | null = null;
  let storeListener: (() => void) | null = null;
  let playheadListener: (() => void) | null = null;
  let frameListener: ((gapMs: number) => void) | null = null;
  let longTaskListener: ((durationMs: number) => void) | null = null;
  let pageHideListener: (() => void) | null = null;
  const saves: unknown[] = [];
  const stops: string[] = [];

  const deps: DiagnosticRecorderDependencies = {
    now: () => now,
    wallNow: () => 1_800_000_000_000 + now,
    captureBase: () => baseSample(now),
    scheduleEverySecond: (listener) => {
      interval = listener;
      return () => {
        stops.push('interval');
        interval = null;
      };
    },
    subscribeStore: (listener) => {
      storeListener = listener;
      return () => {
        stops.push('store');
        storeListener = null;
      };
    },
    subscribePlayhead: (listener) => {
      playheadListener = listener;
      return () => {
        stops.push('playhead');
        playheadListener = null;
      };
    },
    observeFrameGaps: (listener) => {
      frameListener = listener;
      return () => {
        stops.push('frames');
        frameListener = null;
      };
    },
    observeLongTasks: (listener) => {
      longTaskListener = listener;
      return {
        supported: true,
        stop: () => {
          stops.push('longtasks');
          longTaskListener = null;
        },
      };
    },
    onPageHide: (listener) => {
      pageHideListener = listener;
      return () => {
        stops.push('pagehide');
        pageHideListener = null;
      };
    },
    saveLatest: async (session) => {
      saves.push(structuredClone(session));
    },
  };

  return {
    deps,
    setNow: (value: number) => { now = value; },
    tick: (lagMs?: number) => interval?.(lagMs),
    storeWrite: () => storeListener?.(),
    playheadWrite: () => playheadListener?.(),
    frameGap: (ms: number) => frameListener?.(ms),
    longTask: (ms: number) => longTaskListener?.(ms),
    pageHide: () => pageHideListener?.(),
    saves,
    stops,
  };
}

async function drainMicrotasks(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

describe('createDiagnosticRecorder', () => {
  test('is inert until start and tears every observer down on stop', async () => {
    const h = harness();
    const recorder = createDiagnosticRecorder(h.deps);

    expect(recorder.getState()).toEqual({ status: 'idle', session: null, storage: 'ready' });
    expect(h.stops).toEqual([]);

    await recorder.start();
    h.setNow(1000);
    h.tick();
    await recorder.stop();

    expect(h.stops.sort()).toEqual(['frames', 'interval', 'longtasks', 'pagehide', 'playhead', 'store']);
    expect(recorder.getState().status).toBe('stopped');
  });

  test('keeps recording when a panel subscriber closes', async () => {
    const h = harness();
    const recorder = createDiagnosticRecorder(h.deps);
    const unsubscribePanel = recorder.subscribe(() => {});
    await recorder.start();
    unsubscribePanel();
    h.setNow(1000);
    h.tick();

    expect(recorder.getState().status).toBe('recording');
    expect(recorder.getState().session?.samples).toHaveLength(1);
    await recorder.stop();
  });

  test('rolls one-second activity into a sample and resets interval counters', async () => {
    const h = harness();
    const recorder = createDiagnosticRecorder(h.deps);
    await recorder.start();

    h.storeWrite();
    h.storeWrite();
    h.playheadWrite();
    markDiagnosticRender('ChordView');
    markDiagnosticRender('ChordView');
    h.frameGap(40);
    h.frameGap(120);
    h.frameGap(300);
    h.longTask(73);
    h.setNow(1000);
    h.tick(125);

    h.setNow(2000);
    h.tick();
    const samples = recorder.getState().session?.samples;
    expect(samples?.[0].activity).toEqual({
      storeWrites: 2,
      playheadWrites: 1,
      renders: { ChordView: 2 },
      eventLoopLag: { over50: 1, over100: 1, over250: 0, maxMs: 125 },
      frameGaps: { over50: 2, over100: 2, over250: 1, maxMs: 300 },
      longTasks: { supported: true, count: 1, totalMs: 73, maxMs: 73 },
    });
    expect(samples?.[1].activity).toEqual({
      storeWrites: 0,
      playheadWrites: 0,
      renders: {},
      eventLoopLag: { over50: 0, over100: 0, over250: 0, maxMs: 0 },
      frameGaps: { over50: 0, over100: 0, over250: 0, maxMs: 0 },
      longTasks: { supported: true, count: 0, totalMs: 0, maxMs: 0 },
    });
  });

  test('keeps only the newest 1,800 samples and flushes every ten', async () => {
    const h = harness();
    const recorder = createDiagnosticRecorder(h.deps);
    await recorder.start();

    for (let second = 1; second <= MAX_DIAGNOSTIC_SAMPLES + 2; second++) {
      h.setNow(second * 1000);
      h.tick();
    }
    await recorder.stop();

    const samples = recorder.getState().session?.samples ?? [];
    expect(samples).toHaveLength(1800);
    expect(samples[0].elapsedMs).toBe(3000);
    // One periodic flush per ten samples, plus the final stop flush.
    expect(h.saves).toHaveLength(181);
  });
});

describe('createDiagnosticRecorder persistence', () => {
  test('pagehide persists an unfinished session for recovery without stopping it', async () => {
    const h = harness();
    const recorder = createDiagnosticRecorder(h.deps);
    await recorder.start();
    h.setNow(1000);
    h.tick();
    h.pageHide();
    await drainMicrotasks();

    const persisted = h.saves.at(-1) as { endedAt: number | null; samples: unknown[] };
    expect(persisted.endedAt).toBeNull();
    expect(persisted.samples).toHaveLength(1);
    expect(recorder.getState().status).toBe('recording');
  });

  test('storage failure degrades to memory while recording continues', async () => {
    const h = harness();
    h.deps.saveLatest = async () => { throw new Error('blocked'); };
    const recorder = createDiagnosticRecorder(h.deps);
    await recorder.start();
    for (let second = 1; second <= 10; second++) {
      h.setNow(second * 1000);
      h.tick();
    }
    await drainMicrotasks();

    expect(recorder.getState().status).toBe('recording');
    expect(recorder.getState().storage).toBe('unavailable');
    expect(recorder.getState().session?.samples).toHaveLength(10);
  });
});

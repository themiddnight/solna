import { audioEngine } from '@/audio/engine';
import { useAppStore } from '@/store/store';
import { createDiagnosticRecorder } from './recorder';
import { diagnosticSessionStore } from './storage';
import type { DiagnosticSampleBase } from './types';

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize?: number };
}

function captureBase(elapsedMs: number): DiagnosticSampleBase {
  const state = useAppStore.getState();
  const memory = (performance as PerformanceWithMemory).memory;
  return {
    elapsedMs,
    route: `${location.pathname}${location.search}${location.hash}`,
    visibility: document.visibilityState,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    navigation: { activeTab: state.activeTab, focusTrack: state.focusTrack },
    transport: {
      bpm: state.bpm,
      meterId: state.meterId,
      players: {
        sequencer: state.sequencerPlayer,
        chords: state.chordsPlayer,
        lead: state.leadPlayer,
        fx: state.fxPlayer,
      },
    },
    dom: {
      elements: document.getElementsByTagName('*').length,
      canvases: document.getElementsByTagName('canvas').length,
    },
    audio: audioEngine.getDiagnosticSnapshot(),
    heapUsedBytes: typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null,
  };
}

function scheduleEverySecond(listener: (lagMs?: number) => void): () => void {
  let expected = performance.now() + 1000;
  const timer = window.setInterval(() => {
    const now = performance.now();
    listener(Math.max(0, now - expected));
    expected = now + 1000;
  }, 1000);
  return () => window.clearInterval(timer);
}

function observeFrameGaps(listener: (gapMs: number) => void): () => void {
  let previous = performance.now();
  let frame = 0;
  const next = (now: number) => {
    listener(Math.max(0, now - previous));
    previous = now;
    frame = requestAnimationFrame(next);
  };
  frame = requestAnimationFrame(next);
  return () => cancelAnimationFrame(frame);
}

function observeLongTasks(listener: (durationMs: number) => void) {
  const supported = typeof PerformanceObserver !== 'undefined'
    && PerformanceObserver.supportedEntryTypes.includes('longtask');
  if (!supported) return { supported: false, stop: () => {} };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) listener(entry.duration);
  });
  observer.observe({ entryTypes: ['longtask'] });
  return { supported: true, stop: () => observer.disconnect() };
}

function onPageHide(listener: () => void): () => void {
  window.addEventListener('pagehide', listener);
  return () => window.removeEventListener('pagehide', listener);
}

const standalone = typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches;
const heapSupported = typeof performance !== 'undefined'
  && typeof (performance as PerformanceWithMemory).memory?.usedJSHeapSize === 'number';

export const diagnosticRecorder = createDiagnosticRecorder({
  now: () => performance.now(),
  wallNow: () => Date.now(),
  captureBase,
  scheduleEverySecond,
  subscribeStore: (listener) => useAppStore.subscribe(listener),
  subscribePlayhead: (listener) => useAppStore.subscribe((state) => state.playheadBeat, listener),
  observeFrameGaps,
  observeLongTasks,
  onPageHide,
  saveLatest: (session) => diagnosticSessionStore.save(session),
  userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  standalone,
  heapSupported,
});

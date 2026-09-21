import { useMemo, useState, useSyncExternalStore } from 'react';
import { Activity } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { diagnosticRecorder } from './browserRecorder';
import { exportDiagnosticSession } from './exportSession';
import { diagnosticSummary } from './session';
import { diagnosticSessionStore } from './storage';
import type { DiagnosticSessionV1 } from './types';

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function SessionSummary({ session }: { session: DiagnosticSessionV1 }) {
  const summary = useMemo(() => diagnosticSummary(session), [session]);
  return (
    <div className="grid grid-cols-2 gap-2 rounded-box bg-base-200 p-3 text-sm">
      <span>Status</span><strong>{summary.interrupted ? 'Interrupted / recording' : 'Stopped'}</strong>
      <span>Duration</span><strong>{seconds(summary.durationMs)}</strong>
      <span>Samples</span><strong>{summary.samples}</strong>
      <span>Collector p95</span>
      <strong className={summary.collectorP95Ms >= 5 ? 'text-warning' : ''}>
        {summary.collectorP95Ms.toFixed(2)} ms
      </strong>
      <span>Max event-loop lag</span><strong>{summary.maxEventLoopLagMs.toFixed(0)} ms</strong>
      <span>Max frame gap</span><strong>{summary.maxFrameGapMs.toFixed(0)} ms</strong>
      <span>Clock stalls</span><strong>{summary.clockStalls}</strong>
      <span>Max voices</span><strong>{summary.maxPhysicalVoices}</strong>
      <span>Store / playhead writes</span>
      <strong>{summary.totalStoreWrites} / {summary.totalPlayheadWrites}</strong>
    </div>
  );
}

export default function DiagnosticPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const recorder = useSyncExternalStore(
    diagnosticRecorder.subscribe,
    diagnosticRecorder.getState,
    diagnosticRecorder.getState,
  );
  const [recovered, setRecovered] = useState<DiagnosticSessionV1 | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const session = recorder.session ?? recovered;

  const recover = async () => {
    try {
      const value = await diagnosticSessionStore.load();
      setRecovered(value);
      setMessage(value ? (value.endedAt === null ? 'Recovered interrupted session.' : 'Loaded latest session.') : 'No saved session.');
    } catch {
      setMessage('Diagnostic storage is unavailable; recording can still run in memory.');
    }
  };

  const clear = async () => {
    try {
      await diagnosticSessionStore.clear();
      setRecovered(null);
      setMessage('Saved diagnostic session cleared.');
    } catch {
      setMessage('Could not clear diagnostic storage.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={<><Activity className="h-5 w-5" /> Performance diagnostics</>} size="lg" boxClassName="space-y-4">
      <p className="text-sm text-base-content/70">
        Local-only, bounded to 1,800 one-second samples. Closing this panel does not stop recording.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary btn-sm" type="button" disabled={recorder.status === 'recording'} onClick={() => void diagnosticRecorder.start()}>Start</button>
        <button className="btn btn-sm" type="button" disabled={recorder.status !== 'recording'} onClick={() => void diagnosticRecorder.stop()}>Stop</button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void recover()}>Recover latest</button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={!session} onClick={() => session && void exportDiagnosticSession(session)}>Share JSON</button>
        <button className="btn btn-ghost btn-sm text-error" type="button" onClick={() => void clear()}>Clear saved</button>
      </div>
      {session && <SessionSummary session={session} />}
      <div className="text-xs text-base-content/60">
        Recorder: {recorder.status}. Storage: {recorder.storage}. Long tasks and heap are capability-dependent.
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}
    </Modal>
  );
}

import { useState, useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  audioRecoveryStore,
  dismissAudioRecovery,
  recoverAudio,
  reopenAudioRecovery,
  type AudioRecoveryState,
} from '@/store/audioRecovery';
import {
  clearIncident,
  dismissIncident,
  incidentStore,
  openIncident,
} from '@/incidents/incidentStore';
import {
  exportIncident,
  type IncidentExportAction,
  type IncidentExportDependencies,
  type IncidentExportResult,
} from '@/incidents/exportIncident';
import { githubIssueUrl } from '@/incidents/githubReport';
import type { IncidentReportV1 } from '@/incidents/types';
import { Modal } from './Modal';

/** getState() serves both snapshots — see useLiveStore and testing.md. */
function useAudioRecovery(): AudioRecoveryState {
  return useSyncExternalStore(audioRecoveryStore.subscribe, audioRecoveryStore.getState, audioRecoveryStore.getState);
}

function useIncident() {
  return useSyncExternalStore(incidentStore.subscribe, incidentStore.getState, incidentStore.getState);
}

const RECOVERY_PENDING = ['unhealthy', 'recovering', 'failed'] as const;

function isRecoveryPending(status: AudioRecoveryState['status']): boolean {
  return (RECOVERY_PENDING as readonly string[]).includes(status);
}

/**
 * The dialog shows an audio incident only while the audio flow also wants it
 * open, so a successful recovery closes it without a second store write.
 */
function isDialogVisible(report: IncidentReportV1 | null, open: boolean, audio: AudioRecoveryState): boolean {
  // With no held report (discarded, or replaced) a pending recovery still owns the dialog.
  if (report === null) return isRecoveryPending(audio.status) && audio.modalOpen;
  if (!open) return false;
  return report.kind === 'audio-health' ? audio.modalOpen : true;
}

function discard(): void {
  void clearIncident();
  // Keep the transport chip reachable when a recovery is still owed.
  dismissAudioRecovery();
}

function dismiss(): void {
  dismissIncident();
  dismissAudioRecovery();
}

function reopen(): void {
  openIncident();
  reopenAudioRecovery();
}

/** Opened in a new browsing context that cannot reach back into the app. */
export function openGithubReport(report: IncidentReportV1, open: typeof window.open = (...a) => window.open(...a)): void {
  open(githubIssueUrl(report), '_blank', 'noopener,noreferrer');
}

export function browserExportDependencies(nav: Navigator = navigator): IncidentExportDependencies {
  return {
    share: typeof nav.share === 'function' ? (data) => nav.share(data) : undefined,
    canShare: typeof nav.canShare === 'function' ? (data) => nav.canShare(data) : undefined,
    writeClipboardText: nav.clipboard ? (text) => nav.clipboard.writeText(text) : undefined,
  };
}

const EXPORT_MESSAGE: Record<IncidentExportResult, string> = {
  shared: 'Report shared.',
  copied: 'Report copied to the clipboard.',
  downloaded: 'Report downloaded.',
};

/** A dismissed share sheet is a choice, not a failure, so it says nothing. */
export async function runIncidentExport(
  report: IncidentReportV1,
  action: IncidentExportAction,
  dependencies: IncidentExportDependencies,
  run: typeof exportIncident = exportIncident,
): Promise<string | null> {
  try {
    return EXPORT_MESSAGE[await run(report, action, dependencies)];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return null;
    return 'Could not export the report.';
  }
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function IncidentPreview({ report, now }: { report: IncidentReportV1; now: number }) {
  const attempts =
    report.recoveryAttempts.length === 0 ? 'none' : report.recoveryAttempts.map((a) => a.result).join(', ');
  const rows: [string, string][] = [
    ['Kind', report.kind],
    ['Fingerprint', report.fingerprint],
    ['Runtime', `${report.runtime.engine} / ${report.runtime.platform}`],
    ['Build', report.buildId],
    ['Occurred', formatAge(now - report.occurredAt)],
    ['Samples', String(report.audio?.samples.length ?? 0)],
    ['Recovery', attempts],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs bg-base-200 rounded-box p-3" aria-label="Incident summary">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="opacity-70">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Transport-bar button that reopens the dialog while an incident exists and the dialog is closed. */
export function IncidentWarning() {
  const { current, open } = useIncident();
  const audio = useAudioRecovery();
  const pending = isRecoveryPending(audio.status);
  // An audio pending state can exist before/without a published report; it still needs a way back.
  if (current === null && !(pending && !audio.modalOpen)) return null;
  if (current !== null && isDialogVisible(current, open, audio)) return null;
  const label = pending ? 'Audio needs recovery' : 'View incident report';
  return (
    <button type="button" className="btn btn-xs btn-warning gap-1" aria-label={label} title={label} onClick={reopen}>
      <AlertTriangle className="w-3 h-3" />
      <span className="hidden sm:inline">{pending ? 'Audio' : 'Report'}</span>
    </button>
  );
}

// eslint-disable-next-line complexity -- one dialog with report/no-report and recover/failed branches; splitting would scatter one state table
export function IncidentDialog() {
  const { current: report, open, storage } = useIncident();
  const audio = useAudioRecovery();
  const [message, setMessage] = useState<string | null>(null);
  const visible = isDialogVisible(report, open, audio);
  // Recovery is owed by the audio state, never by which report happens to be held.
  const canRecover = isRecoveryPending(audio.status);
  const isAudio = report === null || report.kind === 'audio-health';
  const recovering = audio.status === 'recovering';
  const failed = canRecover && audio.status === 'failed';

  const exportAs = (action: IncidentExportAction) => {
    if (report === null) return;
    void runIncidentExport(report, action, browserExportDependencies()).then(setMessage);
  };

  return (
    <Modal open={visible} onClose={dismiss} title={isAudio ? 'Audio stopped working' : 'Solna was interrupted'} size="md" boxClassName="space-y-4">
      {(report !== null || canRecover) && (
        <>
          <p className="text-sm">
            {isAudio
              ? 'Audio playback became unreliable, so everything was stopped. Your project is safe. Recovering restarts the audio engine; playback will remain stopped until you press play.'
              : 'Something went wrong and Solna stopped what it was doing. Your project is saved.'}
          </p>
          {failed && (
            <p role="alert" className="text-sm text-error">
              Audio could not be restarted. Try again, or reload the app. Your project is saved.
            </p>
          )}
          {report !== null && <IncidentPreview report={report} now={Date.now()} />}
          <p className="text-xs opacity-80">
            Reporting is optional and only happens when you choose it. GitHub issues are public: review the
            report before you submit it or attach the exported file. It contains no project content.
          </p>
          {report !== null && (
            <div className="flex flex-wrap gap-2">
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                <button type="button" className="btn btn-xs btn-outline" onClick={() => exportAs('share')}>Share</button>
              )}
              <button type="button" className="btn btn-xs btn-outline" onClick={() => exportAs('copy')}>Copy</button>
              <button type="button" className="btn btn-xs btn-outline" onClick={() => exportAs('download')}>Download</button>
              <button type="button" className="btn btn-xs btn-ghost" onClick={discard}>Discard report</button>
            </div>
          )}
          {report !== null && storage === 'memory' && (
            <p className="text-xs opacity-80">Device storage is unavailable, so this report is kept for this session only. Export it if you need it later.</p>
          )}
          {message !== null && <p role="status" className="text-xs">{message}</p>}
          <div className="modal-action flex-wrap">
            <button type="button" className="btn btn-sm btn-ghost" onClick={dismiss}>
              {canRecover ? 'Not Now' : 'Close'}
            </button>
            {failed && (
              <button type="button" className="btn btn-sm btn-ghost" aria-label="Reload App" onClick={() => window.location.reload()}>
                Reload App
              </button>
            )}
            {report !== null && (
              <button
                type="button"
                className={canRecover ? 'btn btn-sm btn-outline' : 'btn btn-sm btn-primary'}
                onClick={() => openGithubReport(report)}
              >
                Report on GitHub
              </button>
            )}
            {canRecover && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                aria-label={failed ? 'Retry' : 'Recover audio'}
                disabled={recovering}
                aria-busy={recovering}
                onClick={() => void recoverAudio()}
              >
                {recovering && <span className="loading loading-spinner loading-xs" aria-hidden="true" />}
                {recovering ? 'Recovering…' : failed ? 'Retry' : 'Recover'}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

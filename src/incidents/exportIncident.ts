import { downloadTextFile } from '@/utils/projectFileIO';
import { isIncidentReportV1 } from './sanitize';
import type { IncidentReportV1 } from './types';

export type IncidentExportAction = 'share' | 'copy' | 'download';
export type IncidentExportResult = 'shared' | 'copied' | 'downloaded';

export interface IncidentExportDependencies {
  /** Web Share, when the browser has it. */
  share?: (data: { files: File[]; title: string }) => Promise<void>;
  canShare?: (data: { files: File[] }) => boolean;
  writeClipboardText?: (text: string) => Promise<void>;
  download?: (fileName: string, text: string, mime: string) => void;
}

const MIME = 'application/json';

/** Date and fingerprint only: no project name, path or other user content. */
export function incidentFileName(report: IncidentReportV1): string {
  const date = new Date(report.occurredAt).toISOString().slice(0, 10);
  const fingerprint = report.fingerprint.replace(/[^a-z0-9]/gi, '');
  return `solna-incident-${date}-${fingerprint}.json`;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Explicit, user-chosen export of the validated schema and nothing else. Share
 * and copy degrade to download when the browser cannot do them; a share the
 * user dismisses (AbortError) propagates so the caller can stay quiet.
 */
export async function exportIncident(
  report: IncidentReportV1,
  action: IncidentExportAction,
  dependencies: IncidentExportDependencies,
): Promise<IncidentExportResult> {
  if (!isIncidentReportV1(report)) throw new Error('Refusing to export an invalid incident report');
  const fileName = incidentFileName(report);
  const text = JSON.stringify(report, null, 2);
  const download = dependencies.download ?? ((n, t, m) => downloadTextFile(n, t, m));

  if (action === 'share' && dependencies.share) {
    const files = [new File([text], fileName, { type: MIME })];
    if (dependencies.canShare?.({ files })) {
      try {
        await dependencies.share({ files, title: 'Solna incident report' });
        return 'shared';
      } catch (error) {
        if (isAbort(error)) throw error;
      }
    }
  }

  if (action === 'copy' && dependencies.writeClipboardText) {
    try {
      await dependencies.writeClipboardText(text);
      return 'copied';
    } catch {
      // Clipboard denied: fall through to the download.
    }
  }

  download(fileName, text, MIME);
  return 'downloaded';
}

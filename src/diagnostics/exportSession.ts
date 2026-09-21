import { downloadTextFile } from '@/utils/projectFileIO';
import { serializeDiagnosticSession } from './session';
import type { DiagnosticSessionV1 } from './types';

interface ExportDependencies {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  download?: (fileName: string, text: string, mime: string) => void;
}

export async function exportDiagnosticSession(
  session: DiagnosticSessionV1,
  dependencies: ExportDependencies = {},
): Promise<'shared' | 'downloaded'> {
  const json = serializeDiagnosticSession(session);
  const date = new Date(session.startedAt).toISOString().slice(0, 10);
  const fileName = `solna-diagnostics-${date}.json`;
  const file = new File([json], fileName, { type: 'application/json' });
  const share = dependencies.share ?? (typeof navigator === 'undefined' ? undefined : navigator.share?.bind(navigator));
  const canShare = dependencies.canShare ?? (typeof navigator === 'undefined' ? undefined : navigator.canShare?.bind(navigator));
  const shareData: ShareData = { title: 'Solna diagnostics', files: [file] };
  if (share && canShare?.(shareData)) {
    await share(shareData);
    return 'shared';
  }
  (dependencies.download ?? downloadTextFile)(fileName, json, 'application/json');
  return 'downloaded';
}

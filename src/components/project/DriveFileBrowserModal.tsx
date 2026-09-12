import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { DrivePage } from '@/store/driveClient';
import {
  DRIVE_EMPTY_HINT,
  DRIVE_EMPTY_STATE,
  DRIVE_LOADING_TEXT,
  DRIVE_OPEN_TITLE,
  DRIVE_SAVE_TITLE,
  appendPage,
  formatModified,
  sortBrowserRows,
  toBrowserRows,
  type DriveBrowserRow,
  type DriveListOutcome,
} from '@/utils/driveBrowser';
import { Modal } from '../ui/Modal';

export function browserTitle(mode: 'open' | 'save-as'): string {
  return mode === 'save-as' ? DRIVE_SAVE_TITLE : DRIVE_OPEN_TITLE;
}

/**
 * Pure props-to-markup, so it can be rendered and asserted on without a Drive
 * call in sight. The row list is ALREADY sorted by the caller — one order, one
 * place, and `renderToString` can then prove the order in the markup.
 */
export function DriveBrowserList({
  rows,
  onOpen,
}: {
  rows: DriveBrowserRow[];
  onOpen?: (fileId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-6 text-center space-y-1">
        <p className="text-xs text-base-content/60">{DRIVE_EMPTY_STATE}</p>
        <p className="text-xs text-base-content/50">{DRIVE_EMPTY_HINT}</p>
      </div>
    );
  }
  return (
    <ul className="max-h-72 overflow-y-auto">
      {rows.map((row) => (
        <li key={row.id}>
          {onOpen ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full justify-start gap-2 font-normal"
              onClick={() => onOpen(row.id)}
            >
              <FileText className="w-4 h-4 text-base-content/60" aria-hidden="true" />
              <span className="truncate">{row.name}</span>
              <span className="ml-auto text-xs text-base-content/50">{formatModified(row.modifiedTime)}</span>
            </button>
          ) : (
            <div className="flex min-h-8 items-center gap-2 px-3 text-sm text-base-content/60">
              <FileText className="w-4 h-4" aria-hidden="true" />
              <span className="truncate">{row.name}</span>
              <span className="ml-auto text-xs text-base-content/50">{formatModified(row.modifiedTime)}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface DriveFileBrowserModalProps {
  open: boolean;
  mode: 'open' | 'save-as';
  signedIn: boolean;
  /**
   * Save As's starting name, from the project (`defaultSaveName`). Required with
   * no default: a caller that forgot it would offer an empty field and silently
   * save as `untitled.solna`.
   */
  initialName: string;
  onClose: () => void;
  onConnect: () => void;
  /** MUST be referentially stable — it is an effect dependency (useCallback). */
  onList: (pageToken?: string) => Promise<DriveListOutcome>;
  onOpenFile: (fileId: string) => void;
  onSaveAs: (name: string) => void;
}

/**
 * The list renders only when a fetch has finished AND it either succeeded or a
 * later page failed with rows already on screen. A failed FIRST list must not
 * render as "you have no projects": the empty state is a claim about Drive's
 * contents, and an error is evidence of no such thing.
 */
export function shouldRenderList(loading: boolean, error: string | null, fileCount: number): boolean {
  return !loading && (error === null || fileCount > 0);
}

/** Save As may show existing files, but selecting one must never replace the current project. */
export function openHandlerForMode(
  mode: DriveFileBrowserModalProps['mode'],
  onOpenFile: DriveFileBrowserModalProps['onOpenFile'],
): DriveFileBrowserModalProps['onOpenFile'] | undefined {
  return mode === 'open' ? onOpenFile : undefined;
}

export function DriveFileBrowserModal({
  open,
  mode,
  signedIn,
  initialName,
  onClose,
  onConnect,
  onList,
  onOpenFile,
  onSaveAs,
}: DriveFileBrowserModalProps) {
  const [files, setFiles] = useState<DrivePage['files']>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  // TRUE, not false: the first page is fetched by the effect below, and
  // renderToString runs no effects — an initial `false` renders an empty list
  // that has not been fetched as "you have no projects".
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState(initialName);

  useEffect(() => {
    if (!open || !signedIn) {
      setLoading(false);
      return;
    }
    // A re-open abandons the previous listing's promise; without this the
    // slower of two responses would be the one on screen.
    let cancelled = false;
    setLoading(true);
    setError(null);
    void onList().then((outcome) => {
      if (cancelled) return;
      setLoading(false);
      if (outcome.ok === false) {
        setError(outcome.message);
        return;
      }
      setFiles(outcome.page.files);
      setNextPageToken(outcome.page.nextPageToken);
    });
    return () => {
      cancelled = true;
    };
  }, [open, signedIn, onList]);

  const loadMore = async () => {
    if (nextPageToken === undefined) return;
    setLoading(true);
    const outcome = await onList(nextPageToken);
    setLoading(false);
    if (outcome.ok === false) {
      setError(outcome.message);
      return;
    }
    const merged = appendPage({ files: [...files] }, outcome.page);
    setFiles(merged.files);
    setNextPageToken(merged.nextPageToken);
  };

  return (
    <Modal open={open} onClose={onClose} title={browserTitle(mode)} size="lg" boxClassName="space-y-3">
      {signedIn ? (
        <>
          {error !== null && <p className="text-xs text-error">{error}</p>}
          {loading && <p className="text-xs text-base-content/60">{DRIVE_LOADING_TEXT}</p>}

          {shouldRenderList(loading, error, files.length) && (
            <DriveBrowserList rows={sortBrowserRows(toBrowserRows([...files]))} onOpen={openHandlerForMode(mode, onOpenFile)} />
          )}

          {nextPageToken !== undefined && !loading && (
            <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => void loadMore()}>
              Load more
            </button>
          )}

          {mode === 'save-as' && (
            <div className="flex items-end gap-2">
              <label className="grow space-y-1">
                <span className="text-xs font-semibold">File name</span>
                <input
                  className="input input-sm w-full text-xs"
                  aria-label="File name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
              </label>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onSaveAs(saveName)}>
                Save to Drive
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-base-content/70">
            Solna asks for permission to see and edit only the files it creates in your Drive.
          </p>
          <button type="button" className="btn btn-sm btn-primary" onClick={onConnect}>
            Connect Google Drive
          </button>
        </div>
      )}
    </Modal>
  );
}

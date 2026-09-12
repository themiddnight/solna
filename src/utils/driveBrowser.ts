import { SOLNA_DRIVE_MIME, type DriveFileMeta, type DrivePage } from '../store/driveClient';

/**
 * One row per project. There is deliberately no `kind` and no folder crumb:
 * `drive.file` cannot see a folder this app did not create, so a folder row
 * could never be produced and a breadcrumb could never be navigated. See
 * Task 10 / the design's scope section before adding either back.
 */
export interface DriveBrowserRow {
  id: string;
  name: string;
  modifiedTime: string;
}

/**
 * What a listing call resolves to. It lives here, with the list helpers, so the
 * modal and the drive slice can agree on it without either importing the other.
 */
export type DriveListOutcome = { ok: true; page: DrivePage } | { ok: false; message: string };

export const DRIVE_EMPTY_STATE = 'No Solna projects in your Drive yet.';
/** Why the list may look empty when the user can see a .solna in Drive themselves. */
export const DRIVE_EMPTY_HINT =
  'Solna only sees files it created here. To open a .solna from somewhere else, download it and use Open .solna.';
export const DRIVE_LOADING_TEXT = 'Loading…';
export const DRIVE_OPEN_TITLE = 'Open from Google Drive';
export const DRIVE_SAVE_TITLE = 'Save to Google Drive';

/**
 * The listing's `q` asks for the solna MIME alone, so another type is not an
 * expected case — but a row that is not a project is not openable, and
 * rendering it would be a button that does nothing. It is dropped, and the row
 * count is the only thing that changes.
 */
export function toBrowserRows(files: ReadonlyArray<DriveFileMeta>): DriveBrowserRow[] {
  return files
    .filter((file) => file.mimeType === SOLNA_DRIVE_MIME)
    .map((file) => ({ id: file.id, name: file.name, modifiedTime: file.modifiedTime }));
}

/**
 * Newest first, then name — deliberately the SAME order DRIVE_LIST_ORDER asks
 * Drive for. The client sorts anyway because it is the only side that sees a
 * paginated list whole: page 2 may hold a file newer than anything on page 1,
 * and rendering pages in arrival order would strand it behind a "Load more".
 *
 * ISO-8601 strings compare lexicographically as timestamps, so no Date parsing
 * and no timezone involvement. The name tiebreaker is what makes the order
 * stable for two files saved in the same second.
 */
export function sortBrowserRows(rows: ReadonlyArray<DriveBrowserRow>): DriveBrowserRow[] {
  return [...rows].sort((a, b) => {
    if (a.modifiedTime !== b.modifiedTime) return a.modifiedTime < b.modifiedTime ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Pages are appended, not replaced, and keyed by id: a save between two listings
 * can shift the window so a file appears on both pages, and a duplicate key in
 * a React list is a warning plus a stale row. The later page wins, because it
 * was fetched later.
 */
export function appendPage(current: DrivePage, next: DrivePage): DrivePage {
  const byId = new Map<string, DriveFileMeta>();
  for (const file of [...current.files, ...next.files]) byId.set(file.id, file);
  const files = [...byId.values()];
  return next.nextPageToken === undefined ? { files } : { files, nextPageToken: next.nextPageToken };
}

/**
 * The date part of Drive's RFC 3339 timestamp, UTC and locale-free: a rendered
 * date that depended on the machine's locale or timezone would make the markup
 * test non-deterministic, and the time of day is noise in a file list.
 */
export function formatModified(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : '—';
}

/**
 * Save As's starting name. NOT slugified here: the modal collects a name a
 * person typed, and `createProject` runs it through `projectFileName`, so the
 * slug rule stays in one place.
 */
export function defaultSaveName(projectName: string | null): string {
  const trimmed = (projectName ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'untitled';
}

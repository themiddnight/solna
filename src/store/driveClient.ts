import { projectFileName } from '../utils/projectFileIO';
import type { ProjectBody } from './projectFormat';
import { parseProjectFile, serializeProject, type ProjectParseResult } from './projectFile';

/**
 * A dedicated MIME, NOT the `application/json` a download carries: `files.list`
 * filters on it, so the list shows solna projects without a client-side filter,
 * and Drive shows a sane name for a type it has never seen. The content is the
 * same JSON either way — only the metadata differs.
 */
export const SOLNA_DRIVE_MIME = 'application/vnd.solna';
export const DRIVE_PAGE_SIZE = 100;
export const DRIVE_LIST_FIELDS = 'nextPageToken, files(id, name, mimeType, modifiedTime)';
/** Newest first — the order the list renders without offering sorting options. */
export const DRIVE_LIST_ORDER = 'modifiedTime desc';

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

export interface DrivePage {
  files: DriveFileMeta[];
  nextPageToken?: string;
}

/**
 * Every solna project this app can see, wherever it lives. A CONSTANT, not a
 * function of a folder: under `drive.file` the listing already contains only
 * files this app created, so there is nothing to narrow — and narrowing by
 * `'root' in parents` would hide a project the moment the user filed it into a
 * folder from Drive's own UI, while Save carried on overwriting it by id.
 *
 * `trashed = false` because Drive keeps deleted files listable for 30 days and
 * a trashed row in an open dialog reads as a bug.
 */
export const DRIVE_LIST_QUERY = `mimeType = '${SOLNA_DRIVE_MIME}' and trashed = false`;

/**
 * The injected seam. Everything Google-shaped lives behind it — `gapi`'s
 * request envelope, the multipart upload framing, the token header — so this
 * file's tests are a five-line stub and Task 11's are about Google alone.
 */
export interface DriveTransport {
  list(params: {
    q: string;
    pageSize: number;
    orderBy: string;
    fields: string;
    pageToken?: string;
  }): Promise<DrivePage>;
  readText(fileId: string): Promise<string>;
  create(params: { name: string; mimeType: string; text: string }): Promise<DriveFileMeta>;
  update(params: { fileId: string; mimeType: string; text: string }): Promise<DriveFileMeta>;
}

export interface DriveClient {
  listProjects(pageToken?: string): Promise<DrivePage>;
  /** Reads a Drive file and runs it through the SAME parser a local open uses. */
  readProject(fileId: string): Promise<ProjectParseResult>;
  createProject(name: string, body: ProjectBody): Promise<DriveFileMeta>;
  updateProject(fileId: string, body: ProjectBody): Promise<DriveFileMeta>;
}

export function createDriveClient(transport: DriveTransport): DriveClient {
  return {
    listProjects: (pageToken) =>
      transport.list({
        q: DRIVE_LIST_QUERY,
        pageSize: DRIVE_PAGE_SIZE,
        orderBy: DRIVE_LIST_ORDER,
        fields: DRIVE_LIST_FIELDS,
        // Omitted rather than sent empty: gapi would serialise an empty string
        // as a page token and Drive answers that with a 400.
        ...(pageToken ? { pageToken } : {}),
      }),

    readProject: async (fileId) => parseProjectFile(await transport.readText(fileId)),

    // No `parents`: Drive's own default is My Drive, and any folder id this app
    // could name would be one `drive.file` cannot see.
    createProject: (name, body) =>
      transport.create({
        name: projectFileName(name),
        mimeType: SOLNA_DRIVE_MIME,
        text: serializeProject(body),
      }),

    updateProject: (fileId, body) =>
      transport.update({ fileId, mimeType: SOLNA_DRIVE_MIME, text: serializeProject(body) }),
  };
}

import type { GapiClient, GapiRequest, GapiResponse, GapiRoot } from '../utils/googleScriptLoader';
import { withDriveToken, type DriveAuth } from './driveAuth';
import type { DriveFileMeta, DrivePage, DriveTransport, DriveUserProfile } from './driveClient';

/**
 * Absolute paths, not discovery documents: `gapi.client.request` accepts a full
 * URL, and `gapi.client.drive` would need `gapi.client.init` against Drive's
 * discovery doc — an extra load for four endpoints whose paths are fixed.
 */
export const DRIVE_API_BASE = 'https://www.googleapis.com';
export const DRIVE_FILES_PATH = '/drive/v3/files';
export const DRIVE_ABOUT_PATH = '/drive/v3/about';
export const DRIVE_UPLOAD_PATH = '/upload/drive/v3/files';
export const DRIVE_BOUNDARY = 'solna-drive-boundary';
export const DRIVE_META_FIELDS = 'id, name, mimeType, modifiedTime';

export interface MultipartPart {
  contentType: string;
  body: string;
}

/**
 * A `multipart/related` body. The CRLF framing is not cosmetic — Drive's parser
 * rejects a body whose boundary lines are not CRLF-terminated, and a template
 * literal is the only place this is written.
 */
export function multipartBody(parts: ReadonlyArray<MultipartPart>, boundary: string = DRIVE_BOUNDARY): string {
  const chunks = parts.map((part) => `--${boundary}\r\nContent-Type: ${part.contentType}\r\n\r\n${part.body}\r\n`);
  return `${chunks.join('')}--${boundary}--`;
}

/** Create: metadata first (it names the file), media second. */
export function createFileBody(
  metadata: { name: string; mimeType: string },
  text: string,
  boundary: string = DRIVE_BOUNDARY,
): string {
  return multipartBody(
    [
      { contentType: 'application/json; charset=UTF-8', body: JSON.stringify(metadata) },
      { contentType: metadata.mimeType, body: text },
    ],
    boundary,
  );
}

/** Update: media only. The name and mimeType already exist on the file. */
export function updateFileBody(text: string, mimeType: string, boundary: string = DRIVE_BOUNDARY): string {
  // A multipart update still needs the metadata part: without it Drive reads
  // the single media part's `application/vnd.solna` as the metadata type and
  // rejects it with "Unsupported content with type" (400). The name is omitted
  // deliberately — an update keeps the file's existing name.
  return multipartBody(
    [
      { contentType: 'application/json; charset=UTF-8', body: JSON.stringify({ mimeType }) },
      { contentType: mimeType, body: text },
    ],
    boundary,
  );
}

/**
 * Only an `id` is required — Drive echoes exactly the fields `fields=` asked
 * for, and treating a missing display field as a failure would report a
 * successful write as an error. A record with no id IS unreadable: a Save As
 * that adopted it would have nowhere to write.
 */
export function toDriveFileMeta(result: unknown): DriveFileMeta | null {
  if (typeof result !== 'object' || result === null) return null;
  const raw = result as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : '',
    modifiedTime: typeof raw.modifiedTime === 'string' ? raw.modifiedTime : '',
  };
}

/** The listing's result envelope, guarded: a malformed row is dropped, never trusted. */
export function toDrivePage(result: unknown): DrivePage {
  const raw = (result ?? {}) as { files?: unknown; nextPageToken?: unknown };
  const rows = Array.isArray(raw.files) ? raw.files : [];
  const files = rows.map(toDriveFileMeta).filter((meta): meta is DriveFileMeta => meta !== null);
  return typeof raw.nextPageToken === 'string' ? { files, nextPageToken: raw.nextPageToken } : { files };
}

/**
 * Drive discloses the account's address only when the user has made it visible
 * to the app; both fields fall back to '' so the heading degrades gracefully.
 */
export function toUserProfile(raw: unknown): DriveUserProfile {
  const user = (raw as { user?: { emailAddress?: unknown; displayName?: unknown } } | null | undefined)?.user;
  return {
    email: typeof user?.emailAddress === 'string' ? user.emailAddress : '',
    name: typeof user?.displayName === 'string' ? user.displayName : '',
  };
}

/**
 * Three shapes, one string, because gapi's answer for `alt: 'media'` depends on
 * a content type this app chose to be unusual:
 *
 * - `application/vnd.solna` is not JSON as far as gapi is concerned, so it does
 *   not parse it: `result` is `false` and the bytes are in `response.body`.
 *   THIS is the real path, and reading only `result` reports every Drive open
 *   as a malformed project.
 * - A proxy or a future gapi that does parse it hands back an object.
 * - A plain string is what a hand-written stub returns.
 *
 * All three are accepted rather than losing the project; anything else is ''.
 */
export function readResultText(response: GapiResponse | unknown): string {
  const shaped = response as GapiResponse | null | undefined;
  if (typeof shaped?.body === 'string' && shaped.body.length > 0) return shaped.body;
  const result = shaped?.result;
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && result !== null) return JSON.stringify(result);
  return '';
}

function requireMeta(result: unknown): DriveFileMeta {
  const meta = toDriveFileMeta(result);
  if (!meta) throw new Error('Drive returned a file record with no id');
  return meta;
}

/**
 * The one place a token, a request envelope and Google's error shape meet. Every
 * call goes through `withDriveToken`, so a stale token is retried exactly once
 * wherever it surfaces.
 */
export function createGapiTransport(getGapi: () => Promise<GapiRoot>, auth: DriveAuth): DriveTransport {
  const run = <T>(op: (client: GapiClient) => Promise<T>): Promise<T> =>
    withDriveToken(auth, async (token) => {
      const gapi = await getGapi();
      // gapi carries the token on the client, not per request: set it before
      // every call rather than once at sign-in, because a retry is a new token.
      gapi.client.setToken({ access_token: token });
      return op(gapi.client);
    });

  return {
    list: (params) =>
      run(async (client) => {
        const response = await client.request({
          path: `${DRIVE_API_BASE}${DRIVE_FILES_PATH}`,
          method: 'GET',
          params: {
            q: params.q,
            pageSize: String(params.pageSize),
            orderBy: params.orderBy,
            fields: params.fields,
            ...(params.pageToken ? { pageToken: params.pageToken } : {}),
          },
        });
        return toDrivePage(response.result);
      }),

    readText: (fileId) =>
      run(async (client) => {
        const response = await client.request({
          path: `${DRIVE_API_BASE}${DRIVE_FILES_PATH}/${fileId}`,
          method: 'GET',
          params: { alt: 'media' },
        });
        // The WHOLE response, not `.result` — see readResultText.
        return readResultText(response);
      }),

    userProfile: () =>
      run(async (client) => {
        const response = await client.request({
          path: `${DRIVE_API_BASE}${DRIVE_ABOUT_PATH}`,
          method: 'GET',
          params: { fields: 'user(emailAddress, displayName)' },
        });
        return toUserProfile(response.result);
      }),

    // No `parents`: Drive's own default is My Drive, and any folder id this app
    // could name would be one `drive.file` cannot see.
    create: (params) =>
      run(async (client) => {
        const request: GapiRequest = {
          path: `${DRIVE_API_BASE}${DRIVE_UPLOAD_PATH}`,
          method: 'POST',
          params: { uploadType: 'multipart', fields: DRIVE_META_FIELDS },
          headers: { 'Content-Type': `multipart/related; boundary=${DRIVE_BOUNDARY}` },
          body: createFileBody({ name: params.name, mimeType: params.mimeType }, params.text),
        };
        return requireMeta((await client.request(request)).result);
      }),

    update: (params) =>
      run(async (client) => {
        const request: GapiRequest = {
          path: `${DRIVE_API_BASE}${DRIVE_UPLOAD_PATH}/${params.fileId}`,
          method: 'PATCH',
          params: { uploadType: 'multipart', fields: DRIVE_META_FIELDS },
          headers: { 'Content-Type': `multipart/related; boundary=${DRIVE_BOUNDARY}` },
          body: updateFileBody(params.text, params.mimeType),
        };
        return requireMeta((await client.request(request)).result);
      }),
  };
}

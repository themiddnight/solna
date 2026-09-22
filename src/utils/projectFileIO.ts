/**
 * Browser-side file I/O for `.solna` files. A Blob URL instead of the data
 * URL the preset libraries use: a project with many loops is far bigger than a
 * preset list, and data URLs have per-browser length limits.
 */
export function slugifyProjectName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'project';
}

export function projectFileName(name: string): string {
  return `${slugifyProjectName(name)}.solna`;
}

export interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

/**
 * Hands a Blob to the browser as a download.
 *
 * The `<a download>` dance, in one place, with the URL revoked in a `finally`
 * so a click that throws — a blocked download, a sandboxed frame — does not
 * leak an object URL that pins the blob for the life of the page. `doc` and
 * `url` are injectable for exactly the reason `downloadTextFile`'s are:
 * every caller — the project menu's `.solna` copy and the export job
 * (`store/exportSlice.ts`, which injects it into `runExportJob` as its
 * `download` dependency) — stays testable with no DOM at all.
 *
 * A Blob URL rather than a data URL, for the reason this file already
 * records: a rendered mixdown is far past any browser's data-URL length
 * limit.
 */
export function downloadBlob(
  fileName: string,
  blob: Blob,
  doc?: Document,
  url?: ObjectUrlApi,
): void {
  const d = doc ?? document;
  const u = url ?? URL;
  const href = u.createObjectURL(blob);
  const anchor = d.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  d.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    u.revokeObjectURL(href);
  }
}

export function downloadTextFile(
  fileName: string,
  text: string,
  mime: string,
  doc?: Document,
  url?: ObjectUrlApi,
): void {
  downloadBlob(fileName, new Blob([text], { type: mime }), doc, url);
}

/**
 * Read succeeded (possibly with empty content — a directory or a zero-byte
 * pick genuinely has none, and the caller's JSON parse correctly calls that
 * malformed) versus read FAILED, which is a different problem with a
 * different remedy and must not be reported as an invalid file. `cause` keeps
 * the original error available for diagnosis instead of discarding it.
 */
export type FileReadResult = { ok: true; text: string } | { ok: false; cause: unknown };

export const UNREADABLE_FILE_MESSAGE =
  'Could not read the file. It may have been moved, deleted, or its storage access revoked.';

/** A directory or a zero-byte pick reads as ok:true with empty text. */
export async function readFileAsText(file: Pick<File, 'text' | 'size'>): Promise<FileReadResult> {
  if (file.size === 0) return { ok: true, text: '' };
  try {
    return { ok: true, text: await file.text() };
  } catch (cause) {
    console.error('readFileAsText: file.text() failed', cause);
    return { ok: false, cause };
  }
}

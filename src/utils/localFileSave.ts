import { PROJECT_FILE_EXTENSION, PROJECT_FILE_MIME } from '../store/projectFile';

/**
 * Neither picker is in lib.dom.d.ts, so both are declared here rather than
 * pulled in from `@types/wicg-file-system-access` — solna adds no dependency
 * for two functions, and a structural declaration is exactly as checkable as
 * the ambient one.
 */
export interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

export type ShowSaveFilePicker = (options?: {
  suggestedName?: string;
  types?: FilePickerType[];
}) => Promise<FileSystemFileHandle>;

export type ShowOpenFilePicker = (options?: {
  multiple?: boolean;
  types?: FilePickerType[];
}) => Promise<FileSystemFileHandle[]>;

/** Saving offers one extension; the file solna writes is always `.solna`. */
export const SOLNA_SAVE_TYPE: FilePickerType = {
  description: 'Solna project',
  accept: { [PROJECT_FILE_MIME]: [PROJECT_FILE_EXTENSION] },
};

/**
 * Opening accepts `.json` too, for the same reason PROJECT_FILE_ACCEPT does:
 * some mobile file providers rewrite an extension they do not recognise, and a
 * user who cannot select their own project file has no way forward.
 */
export const SOLNA_OPEN_TYPE: FilePickerType = {
  description: 'Solna project',
  accept: { [PROJECT_FILE_MIME]: [PROJECT_FILE_EXTENSION, '.json'] },
};

/** The capability probe: null means "this browser cannot pick a save target". */
export function resolveSaveFilePicker(scope: unknown): ShowSaveFilePicker | null {
  if (typeof scope !== 'object' || scope === null) return null;
  const candidate = (scope as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  if (typeof candidate !== 'function') return null;
  return (candidate as ShowSaveFilePicker).bind(scope);
}

/** The same probe for the open direction: null means "fall back to the input". */
export function resolveOpenFilePicker(scope: unknown): ShowOpenFilePicker | null {
  if (typeof scope !== 'object' || scope === null) return null;
  const candidate = (scope as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  if (typeof candidate !== 'function') return null;
  return (candidate as ShowOpenFilePicker).bind(scope);
}

export type PickHandleResult =
  | { ok: true; handle: FileSystemFileHandle }
  | { ok: false; reason: 'unavailable' | 'cancelled' };

/**
 * Two failures, two meanings, and the caller must not treat them alike:
 * `unavailable` is the File System Access API being absent or refused (Safari,
 * Firefox, a permissions-policy iframe), which degrades Save to a download and
 * Open to the `<input>`; `cancelled` is the user dismissing the dialog, which
 * does nothing at all. Both are normal outcomes, not errors.
 */
export async function pickLocalSaveHandle(
  fileName: string,
  scope: unknown = globalThis,
): Promise<PickHandleResult> {
  const pick = resolveSaveFilePicker(scope);
  if (!pick) return { ok: false, reason: 'unavailable' };
  try {
    return { ok: true, handle: await pick({ suggestedName: fileName, types: [SOLNA_SAVE_TYPE] }) };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return { ok: false, reason: name === 'AbortError' ? 'cancelled' : 'unavailable' };
  }
}

/**
 * The handle a local Open keeps. `multiple: false` because one project is open
 * at a time; the API still answers with an ARRAY, and an empty one is treated
 * as a cancel rather than indexed into — a spec-compliant engine will not
 * return `[]`, but a crash on `[0].name` is not the failure mode to pick if one
 * does.
 */
export async function pickLocalOpenHandle(scope: unknown = globalThis): Promise<PickHandleResult> {
  const pick = resolveOpenFilePicker(scope);
  if (!pick) return { ok: false, reason: 'unavailable' };
  try {
    const handles = await pick({ multiple: false, types: [SOLNA_OPEN_TYPE] });
    const handle = handles[0];
    return handle ? { ok: true, handle } : { ok: false, reason: 'cancelled' };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return { ok: false, reason: name === 'AbortError' ? 'cancelled' : 'unavailable' };
  }
}

/**
 * Read for the parse, through the same handle that will later be written back.
 * Empty text on failure, matching `readFileAsText`: the caller runs it through
 * `parseProjectFile`, which reports "not a Solna project" — one failure surface
 * for every unreadable open, rather than a DOMException at one call site.
 */
export async function readTextFromHandle(handle: FileSystemFileHandle): Promise<string> {
  try {
    return await (await handle.getFile()).text();
  } catch {
    return '';
  }
}

/**
 * Write whole-file. A throw here is a real failure and the caller reports it.
 * The stream is deliberately NOT closed on the failure path: `createWritable`
 * writes to a swap file and only commits on `close()`, so abandoning it leaves
 * the user's existing file exactly as it was — which is the outcome to want.
 */
export async function writeTextToHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/**
 * Chrome drops write permission across a restart, so a stored handle can be
 * present and unwritable. `queryPermission` / `requestPermission` are not in
 * lib.dom.d.ts either, hence the structural read; a handle that has neither is
 * treated as writable, which is the behaviour of every engine that ships
 * `createWritable` without the permission API.
 */
export async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const probe = handle as unknown as {
    queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  if (typeof probe.queryPermission !== 'function') return true;
  if ((await probe.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (typeof probe.requestPermission !== 'function') return false;
  return (await probe.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** The project name a Save As adopts: the chosen file's name without `.solna`. */
export function fileNameWithoutExtension(name: string): string {
  return name.endsWith(PROJECT_FILE_EXTENSION)
    ? name.slice(0, -PROJECT_FILE_EXTENSION.length)
    : name;
}

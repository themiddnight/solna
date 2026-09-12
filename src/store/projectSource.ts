import { PROJECT_FORMAT_VERSION, newProjectId, type ProjectBody, type ProjectEnvelope } from './projectFormat';

/**
 * Where an explicit Save writes back to. It is held BESIDE the project body and
 * never inside it: a Drive file id is location metadata and a local handle is
 * not serialisable, so neither may reach serializeProject — the same "not
 * project content" judgement PROJECT_CONTENT_KEYS already makes. Because the
 * slot path is IndexedDB (structured clone), a handle sits in the slot happily;
 * it just never passes through JSON.stringify.
 */
export type ProjectSource =
  | { kind: 'untitled' }
  | { kind: 'drive'; fileId: string }
  | { kind: 'local'; handle: FileSystemFileHandle };

export const UNTITLED_SOURCE: ProjectSource = { kind: 'untitled' };

export type SaveTarget =
  | { kind: 'save-as' }
  | { kind: 'drive-update'; fileId: string }
  | { kind: 'local-write'; handle: FileSystemFileHandle };

/**
 * The whole dispatch, as a function of `source` and nothing else — no UI state,
 * no capability flag. `untitled` has no target to overwrite, so Save on an
 * untitled project IS Save As. Capability (can this browser pick a file at all?)
 * is a separate question the caller answers at the point of writing; folding it
 * in here would make this table untestable without a browser.
 *
 * The route carries its payload (the id, the handle) rather than being a bare
 * string, so the caller that switches on it needs no cast to recover what it
 * already narrowed — see `mergeDrumKit` in CLAUDE.md for the scar that rule
 * comes from.
 */
export function saveTarget(source: ProjectSource): SaveTarget {
  switch (source.kind) {
    case 'untitled':
      return { kind: 'save-as' };
    case 'drive':
      return { kind: 'drive-update', fileId: source.fileId };
    case 'local':
      return { kind: 'local-write', handle: source.handle };
  }
}

/** The identity of a document: an id and when it was born. */
export interface DocumentIdentity {
  id: string;
  createdAt: number;
}

/** A NEW document's identity — used by Save As, which must not reuse an id. */
export function newDocumentIdentity(now: number): DocumentIdentity {
  return { id: newProjectId(), createdAt: now };
}

/**
 * Save: the SAME document. The id and createdAt survive and only updatedAt
 * moves — a `.solna` file is a document and its envelope says so.
 */
export function envelopeForSave(previous: DocumentIdentity, name: string, now: number): ProjectEnvelope {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: previous.id,
    name,
    createdAt: previous.createdAt,
    updatedAt: now,
  };
}

/**
 * Save As: a NEW document — fresh id, the chosen name, and both timestamps at
 * the identity's own `createdAt`. There is deliberately NO `now` parameter: the
 * identity already carries the instant it was minted, a second clock read would
 * let the two timestamps disagree by a few milliseconds, and an unused third
 * argument fails `@typescript-eslint/no-unused-vars` — which is an error here.
 */
export function envelopeForSaveAs(identity: DocumentIdentity, name: string): ProjectEnvelope {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: identity.id,
    name,
    createdAt: identity.createdAt,
    updatedAt: identity.createdAt,
  };
}

/** The one slot's value: the project plus where explicit Save writes it back. */
export interface ProjectSlotRecord {
  body: ProjectBody;
  source: ProjectSource;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Out of range, wrong type, missing or not a member of the union gets untitled.
 * A handle cannot be validated structurally beyond "it is an object" — there is
 * no DOM here and no shape to check — so a broken handle degrades to untitled at
 * the first write, which drops the user into Save As rather than failing.
 */
export function sanitizeProjectSource(raw: unknown): ProjectSource {
  if (!isPlainObject(raw)) return UNTITLED_SOURCE;
  if (raw.kind === 'drive' && typeof raw.fileId === 'string' && raw.fileId.length > 0) {
    return { kind: 'drive', fileId: raw.fileId };
  }
  if (raw.kind === 'local' && isPlainObject(raw.handle)) {
    return { kind: 'local', handle: raw.handle as unknown as FileSystemFileHandle };
  }
  return UNTITLED_SOURCE;
}

/**
 * The slot's read guard, and where the shape widened: a record is recognised by
 * a `body` that LOOKS LIKE A BODY, a bare body by the same test applied to the
 * value itself. Both come back as a record — a slot written before sources
 * existed reads as `{ body, source: untitled }`. There is no version gate here
 * and none may be added: PERSIST_VERSION drives no read-time transform (see the
 * "no migration chains" note in CLAUDE.md), and validation on read is what
 * replaces a chain.
 *
 * `looksLikeBody` is applied to BOTH branches on purpose. Recognising a record
 * by `isPlainObject(raw.body)` alone would accept `{ body: {} }`, and an
 * envelope-less body reaches `normalizeName(undefined)` inside install() and
 * throws — a stricter test on one branch than the other is how that hole gets
 * in. The envelope is not re-validated beyond this; `normalizeStoredBody`
 * sanitises the content at the same read site.
 *
 * `null` means "there is no readable project here" — the not-found path — and is
 * deliberately distinct from "a project with no source", which is a valid slot.
 */
function looksLikeBody(value: unknown): boolean {
  return isPlainObject(value) && typeof value.id === 'string' && 'formatVersion' in value && isPlainObject(value.content);
}

export function sanitizeSlotRecord(raw: unknown): ProjectSlotRecord | null {
  if (!isPlainObject(raw)) return null;
  if (looksLikeBody(raw.body)) {
    return { body: raw.body as unknown as ProjectBody, source: sanitizeProjectSource(raw.source) };
  }
  if (looksLikeBody(raw)) {
    return { body: raw as unknown as ProjectBody, source: UNTITLED_SOURCE };
  }
  return null;
}

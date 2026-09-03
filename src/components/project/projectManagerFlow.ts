import type { ProjectBody, ProjectMeta } from '../../store/projectFormat';
import type { ProjectStoreStatus } from '../../store/projectStore';

export type ImportMode = 'new' | 'overwrite' | 'copy';

export type PendingAction =
  | { kind: 'open'; id: string }
  | { kind: 'new' }
  | { kind: 'import'; body: ProjectBody; mode: ImportMode };

export type NamePurpose = 'save' | 'save-copy' | 'export-session';

export type FlowDialog =
  | { kind: 'none' }
  | { kind: 'dirty-guard'; next: PendingAction }
  | { kind: 'name-prompt'; purpose: NamePurpose; initial: string; then: PendingAction | null }
  | { kind: 'delete-confirm'; project: ProjectMeta }
  | { kind: 'import-conflict'; body: ProjectBody; existing: ProjectMeta };

export const NO_DIALOG: FlowDialog = { kind: 'none' };
export const UNTITLED = 'Untitled project';

/** Any action that replaces the live session runs the dirty guard first. */
export function guardAction(dirty: boolean, action: PendingAction): FlowDialog {
  return dirty ? { kind: 'dirty-guard', next: action } : NO_DIALOG;
}

/** Same id already stored -> conflict dialog; otherwise a guarded import-as-new. */
export function importDialog(body: ProjectBody, list: readonly ProjectMeta[], dirty: boolean): FlowDialog {
  const existing = list.find((m) => m.id === body.id);
  if (existing) return { kind: 'import-conflict', body, existing };
  return guardAction(dirty, { kind: 'import', body, mode: 'new' });
}

/** Save with no current project behaves as Save As: prompt, then continue with `then`. */
export function saveDialog(currentProjectId: string | null, then: PendingAction | null): FlowDialog {
  if (currentProjectId) return NO_DIALOG;
  return { kind: 'name-prompt', purpose: 'save', initial: UNTITLED, then };
}

export function nameDefault(purpose: NamePurpose, currentName: string | null): string {
  const base = currentName ?? UNTITLED;
  return purpose === 'save-copy' ? `${base} copy` : purpose === 'save' ? UNTITLED : base;
}

/** Empty or whitespace-only is rejected; duplicates are allowed (id is the identity). */
export function isValidProjectName(name: string): boolean {
  return name.trim().length > 0;
}

export function sessionLabel(currentProjectId: string | null, currentProjectName: string | null): string {
  if (!currentProjectId) return 'Unsaved session';
  return currentProjectName ?? 'Unnamed project';
}

export function storageDisabled(status: ProjectStoreStatus): boolean {
  return status === 'unavailable';
}

/**
 * The import path's "close or stay" decision, as a single message: an
 * unavailable-storage caveat and/or unrecognised-reference warnings, joined
 * so both can be shown at once. `null` means nothing to say — the modal may
 * close; a non-null message means the modal must stay open so it is seen.
 */
export function importResultNotice(warnings: readonly string[], storageUnavailable: boolean): string | null {
  const parts: string[] = [];
  if (storageUnavailable) parts.push('Opened without saving — project storage is unavailable on this device.');
  if (warnings.length > 0) parts.push(`Imported with unrecognised references: ${warnings.join(', ')}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * `Export current session` needs a name when the current id names nothing
 * findable in `projectList` — a fresh session, or (per buildSessionExport's
 * precondition) a stored id that hasn't survived into the list, e.g. because
 * storage went unavailable after refreshProjects() emptied it.
 */
export function exportSessionDialog(
  currentProjectId: string | null,
  currentProjectName: string | null,
  projectList: readonly ProjectMeta[],
): FlowDialog {
  const resolvable = currentProjectId !== null && projectList.some((m) => m.id === currentProjectId);
  if (resolvable) return NO_DIALOG;
  return { kind: 'name-prompt', purpose: 'export-session', initial: nameDefault('export-session', currentProjectName), then: null };
}

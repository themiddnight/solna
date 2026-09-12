import type { StoreApi } from 'zustand';
import type { DriveListOutcome } from '../utils/driveBrowser';
import { DriveAuthError, driveErrorMessage, type DriveAuth } from './driveAuth';
import type { DriveClient, DriveUserProfile } from './driveClient';
import { UNTITLED_SOURCE } from './projectSource';
import type { ProjectSaveResult } from './projectSlice';
import type { AppStore } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export const DRIVE_NOT_CONFIGURED_MESSAGE =
  'Google Drive is not configured for this deployment. Saving to this device still works.';

export interface DriveSliceDeps {
  auth: DriveAuth;
  client: DriveClient;
  /** False when VITE_GOOGLE_CLIENT_ID is unset: a normal degraded state, not a boot failure. */
  available: boolean;
}

export interface DriveSlice {
  /** Mirrors DriveAuth.signedIn(). Never persisted — see .claude/rules and the design's token hygiene. */
  driveSignedIn: boolean;
  driveAvailable: boolean;
  /** The connected account's identity for the Drive section heading; null when signed out. */
  driveUser: DriveUserProfile | null;
  /** Ask for a token. Returns whether the app is now connected. */
  connectDrive: () => Promise<boolean>;
  /** Revoke at Google and sign out; a `drive` source reverts to untitled. */
  disconnectDrive: () => Promise<void>;
  /** One page of the project listing, already an outcome rather than a throw. */
  listDriveProjects: (pageToken?: string) => Promise<DriveListOutcome>;
  /** Read, parse and install a Drive file — the same path a local open takes. */
  openFromDrive: (fileId: string) => Promise<void>;
  /** Save the live body over the current `drive` source. */
  saveToDrive: () => Promise<ProjectSaveResult>;
  /** Save As to Drive: create a new file in My Drive, then re-point. No folder — see Task 10. */
  saveAsToDrive: (name: string) => Promise<ProjectSaveResult>;
}

/**
 * The one place a Drive failure becomes either a notice or an outcome. The
 * transport already retried once on a 401 (withDriveToken), so anything that
 * arrives here is final: a `DriveAuthError` means the grant is gone and the
 * sign-in mirror must be corrected, and everything else is a sentence.
 *
 * The mirror is only ever CORRECTED here, never set to true — a token was
 * acquired explicitly by connectDrive, so only the call that asked for one may
 * claim there is one.
 */
export function createDriveSlice(set: Set, get: Get, deps: DriveSliceDeps): DriveSlice {
  const setSignedIn = (signedIn: boolean): void => {
    if (get().driveSignedIn !== signedIn) set({ driveSignedIn: signedIn });
  };

  const guard = async <T>(op: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> => {
    try {
      const value = await op();
      setSignedIn(deps.auth.signedIn());
      return { ok: true, value };
    } catch (err) {
      if (err instanceof DriveAuthError) setSignedIn(false);
      return { ok: false, message: driveErrorMessage(err) };
    }
  };

  return {
    driveSignedIn: false,
    driveAvailable: deps.available,
    driveUser: null,

    connectDrive: async () => {
      if (!deps.available) {
        set({ projectNotice: DRIVE_NOT_CONFIGURED_MESSAGE });
        return false;
      }
      try {
        await deps.auth.token();
        setSignedIn(true);
        // Best-effort: a failed `about` read must not fail the connect the user
        // already granted, so the heading simply falls back to "Drive".
        const profile = await deps.client.userProfile().catch(() => null);
        set({ driveUser: profile, projectNotice: null });
        return true;
      } catch (err) {
        setSignedIn(false);
        set({ projectNotice: driveErrorMessage(err) });
        return false;
      }
    },

    disconnectDrive: async () => {
      await deps.auth.revoke();
      setSignedIn(false);
      set({ driveUser: null });
      // The design's sign-out row: the id is meaningless once the token is
      // revoked, so the project falls back to untitled. The body and the
      // autosaved slot are untouched — nothing here costs the user work.
      if (get().projectSource.kind === 'drive') await get().applyProjectSource(UNTITLED_SOURCE);
    },

    listDriveProjects: async (pageToken) => {
      const result = await guard(() => deps.client.listProjects(pageToken));
      // The message is NOT written to projectNotice: a failed listing is
      // rendered inside the modal it belongs to, and a toast over a modal
      // would be the same sentence twice.
      return result.ok ? { ok: true, page: result.value } : { ok: false, message: result.message };
    },

    openFromDrive: async (fileId) => {
      const read = await guard(() => deps.client.readProject(fileId));
      if (read.ok === false) {
        set({ projectNotice: read.message });
        return;
      }
      if (read.value.ok === false) {
        set({ projectNotice: read.value.message });
        return;
      }
      // One install path for every open — local file, Drive file, boot. Only
      // the source differs, and openProjectFile persists it.
      await get().openProjectFile(read.value.body, { kind: 'drive', fileId });
    },

    saveToDrive: async () => {
      const source = get().projectSource;
      if (source.kind !== 'drive') {
        // Unreachable through saveProject, which only routes here for a drive
        // source. Typed rather than asserted, so a future caller that gets it
        // wrong is told so instead of writing to id `undefined`.
        return { ok: false, message: DRIVE_NOT_CONFIGURED_MESSAGE };
      }
      const body = get().exportProjectFile();
      const updated = await guard(() => deps.client.updateProject(source.fileId, body));
      if (updated.ok === false) {
        set({ projectNotice: updated.message });
        return { ok: false, message: updated.message };
      }
      set({ projectNotice: null });
      return { ok: true, destination: 'drive' };
    },

    saveAsToDrive: async (name) => {
      // Built BEFORE the create and adopted after it — the same two-phase Save
      // As the local path uses, for the same reason: a create that fails must
      // not leave the live document wearing an id no file carries.
      const { body, identity } = get().saveAsBody(name);
      const created = await guard(() => deps.client.createProject(name, body));
      if (created.ok === false) {
        set({ projectNotice: created.message });
        return { ok: false, message: created.message };
      }
      await get().adoptSaveAs(identity, name, { kind: 'drive', fileId: created.value.id });
      set({ projectNotice: null });
      return { ok: true, destination: 'drive' };
    },
  };
}

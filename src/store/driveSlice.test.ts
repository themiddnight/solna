import { beforeAll, describe, expect, test } from 'bun:test';
import { DRIVE_DENIED_MESSAGE, DriveAuthError, type DriveAuth } from './driveAuth';
import { SOLNA_DRIVE_MIME, type DriveClient, type DriveFileMeta } from './driveClient';
import { DRIVE_NOT_CONFIGURED_MESSAGE, type DriveSliceDeps } from './driveSlice';
import { MALFORMED_MESSAGE } from './projectFile';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { UNTITLED_SOURCE } from './projectSource';
import type { ProjectBody } from './projectFormat';

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
});

const META: DriveFileMeta = {
  id: 'drive-1',
  name: 'mix.solna',
  mimeType: SOLNA_DRIVE_MIME,
  modifiedTime: '2026-09-12T00:00:00.000Z',
};

function okAuth(): DriveAuth {
  return { token: async () => 'tok', invalidate: () => {}, revoke: async () => {}, signedIn: () => true };
}

function okClient(overrides: Partial<DriveClient> = {}): DriveClient {
  return {
    listProjects: async () => ({ files: [META] }),
    // The FULL ProjectParseResult failure shape — `error` is not optional, and a
    // fake missing it fails `tsc --noEmit` rather than the test it belongs to.
    readProject: async () => ({ ok: false, error: 'malformed', message: MALFORMED_MESSAGE }),
    createProject: async () => META,
    updateProject: async () => META,
    ...overrides,
  };
}

let clock = 5_000;
let instance = 0;

/**
 * The REAL store module, one instance per test, plus a drive slice built on
 * INJECTED fakes — see projectBoot.test.ts for why the module is re-imported:
 * two tests sharing one store module share one set of closured slice state.
 */
async function freshStore(overrides: Partial<DriveSliceDeps> = {}) {
  const mod = await import(`./store?drive=${instance++}`);
  const { createProjectSlice } = await import('./projectSlice');
  const { createDriveSlice } = await import('./driveSlice');
  const projectStore = createProjectStore(async () => createMemoryBackend());
  const project = createProjectSlice(mod.useAppStore.setState, mod.useAppStore.getState, projectStore, () => clock);
  const deps: DriveSliceDeps = { auth: okAuth(), client: okClient(), available: true, ...overrides };
  const drive = createDriveSlice(mod.useAppStore.setState, mod.useAppStore.getState, deps);
  // Only the project and drive slices are replaced; every other slice keeps the
  // module's own instance, which is what the install path expects.
  mod.useAppStore.setState({ ...project, ...drive });
  return { useAppStore: mod.useAppStore, drive, deps };
}

describe('connectDrive', () => {
  test('acquires a token, flips driveSignedIn and clears any notice', async () => {
    const { useAppStore, drive } = await freshStore();
    useAppStore.setState({ projectNotice: 'something old' });
    expect(await drive.connectDrive()).toBe(true);
    expect(useAppStore.getState().driveSignedIn).toBe(true);
    expect(useAppStore.getState().projectNotice).toBeNull();
  });

  test('a denied grant reports Google’s refusal and stays signed out', async () => {
    const { useAppStore, drive } = await freshStore({
      auth: {
        ...okAuth(),
        token: async () => {
          throw new DriveAuthError('denied', DRIVE_DENIED_MESSAGE);
        },
      },
    });
    expect(await drive.connectDrive()).toBe(false);
    expect(useAppStore.getState().driveSignedIn).toBe(false);
    expect(useAppStore.getState().projectNotice).toBe(DRIVE_DENIED_MESSAGE);
  });

  test('an unconfigured deployment never asks for a token at all', async () => {
    const { useAppStore, drive } = await freshStore({
      available: false,
      auth: {
        ...okAuth(),
        token: async () => {
          throw new Error('auth must not be touched when Drive is unavailable');
        },
      },
    });
    expect(await drive.connectDrive()).toBe(false);
    expect(useAppStore.getState().driveAvailable).toBe(false);
    expect(useAppStore.getState().projectNotice).toBe(DRIVE_NOT_CONFIGURED_MESSAGE);
  });
});

describe('listDriveProjects', () => {
  test('hands back the page the client returned', async () => {
    const { drive } = await freshStore();
    expect(await drive.listDriveProjects()).toEqual({ ok: true, page: { files: [META] } });
  });

  test('passes a page token through, and omits it when there is none', async () => {
    const seen: Array<string | undefined> = [];
    const { drive } = await freshStore({
      client: okClient({
        listProjects: async (pageToken) => {
          seen.push(pageToken);
          return { files: [] };
        },
      }),
    });
    await drive.listDriveProjects();
    await drive.listDriveProjects('p2');
    expect(seen).toEqual([undefined, 'p2']);
  });

  test('a transport failure is a message, not a throw', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        listProjects: async () => {
          throw new Error('socket closed');
        },
      }),
    });
    const outcome = await drive.listDriveProjects();
    expect(outcome.ok).toBe(false);
    // Nothing was said in the toast: the modal renders the failure in place,
    // because a listing that failed is a panel, not an interruption.
    expect(useAppStore.getState().projectNotice).toBeNull();
  });

  test('an auth failure drops driveSignedIn, so the menu stops claiming a connection', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        listProjects: async () => {
          throw new DriveAuthError('denied', DRIVE_DENIED_MESSAGE);
        },
      }),
    });
    useAppStore.setState({ driveSignedIn: true });
    const outcome = await drive.listDriveProjects();
    expect(outcome.ok).toBe(false);
    expect(useAppStore.getState().driveSignedIn).toBe(false);
  });
});

describe('openFromDrive', () => {
  test('installs the file and points the source at it', async () => {
    const { useAppStore } = await freshStore();
    // A REAL body from the one reader that exposes the envelope, so the fixture
    // cannot drift from what a Drive file actually holds.
    const body = useAppStore.getState().exportProjectFile();
    const withFile = await freshStore({
      // `warnings` is part of the success shape and is not optional.
      client: okClient({ readProject: async () => ({ ok: true, body, warnings: [] }) }),
    });
    withFile.useAppStore.setState({ projectName: 'Old name', projectSource: UNTITLED_SOURCE });
    await withFile.drive.openFromDrive('drive-77');
    expect(withFile.useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-77' });
    // The fixture's name is '', an anonymous document, so the project name goes
    // back to null: an open ADOPTS the file's envelope, it does not merge with
    // the session's.
    expect(withFile.useAppStore.getState().projectName).toBeNull();
    expect(withFile.useAppStore.getState().projectNotice).toBeNull();
  });

  test('a malformed file reports the parse message and installs nothing', async () => {
    const { useAppStore, drive } = await freshStore();
    useAppStore.setState({ projectName: 'Keep me' });
    // okClient's default readProject is the malformed result, with the real
    // MALFORMED_MESSAGE rather than a sentence invented here.
    await drive.openFromDrive('drive-1');
    expect(useAppStore.getState().projectName).toBe('Keep me');
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
    expect(useAppStore.getState().projectNotice).toBe(MALFORMED_MESSAGE);
  });

  test('a failed read reports it and installs nothing', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        readProject: async () => {
          throw new DriveAuthError('denied', DRIVE_DENIED_MESSAGE);
        },
      }),
    });
    useAppStore.setState({ projectName: 'Keep me', driveSignedIn: true });
    await drive.openFromDrive('drive-1');
    expect(useAppStore.getState().projectName).toBe('Keep me');
    expect(useAppStore.getState().projectNotice).toBe(DRIVE_DENIED_MESSAGE);
    expect(useAppStore.getState().driveSignedIn).toBe(false);
  });
});

describe('saveToDrive', () => {
  test('updates the file the source names and keeps the document identity', async () => {
    const sent: Array<{ fileId: string; body: ProjectBody }> = [];
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        updateProject: async (fileId, body) => {
          sent.push({ fileId, body });
          return META;
        },
      }),
    });
    const before = useAppStore.getState().exportProjectFile();
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-9' } });
    clock = 8_000;
    expect(await drive.saveToDrive()).toEqual({ ok: true, destination: 'drive' });
    expect(sent[0].fileId).toBe('drive-9');
    // A Save is the SAME document being written again: the id and the creation
    // time are what make that true, and only updatedAt may move.
    expect(sent[0].body.id).toBe(before.id);
    expect(sent[0].body.createdAt).toBe(before.createdAt);
    expect(sent[0].body.updatedAt).toBe(8_000);
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-9' });
  });

  test('a failed update reports it and leaves the source alone', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        updateProject: async () => {
          throw new Error('503');
        },
      }),
    });
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-9' } });
    const result = await drive.saveToDrive();
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-9' });
    expect(useAppStore.getState().projectNotice).not.toBeNull();
  });

  test('with no drive source there is nothing to update, and it says so', async () => {
    const { useAppStore, drive } = await freshStore();
    const result = await drive.saveToDrive();
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });
});

describe('saveAsToDrive', () => {
  test('creates a new file, re-points the source and adopts the name', async () => {
    const created: Array<{ name: string; body: ProjectBody }> = [];
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        createProject: async (name, body) => {
          created.push({ name, body });
          return META;
        },
      }),
    });
    const before = useAppStore.getState().exportProjectFile();
    useAppStore.setState({ projectName: 'Sketch' });
    clock = 7_000;
    expect(await drive.saveAsToDrive('Remix')).toEqual({ ok: true, destination: 'drive' });
    expect(created[0].name).toBe('Remix');
    // A Save As is a NEW document: its own id, and createdAt = updatedAt = now.
    expect(created[0].body.id).not.toBe(before.id);
    expect(created[0].body.createdAt).toBe(7_000);
    expect(created[0].body.updatedAt).toBe(7_000);
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-1' });
    expect(useAppStore.getState().projectName).toBe('Remix');
  });

  test('a failed create adopts nothing — the live document is untouched', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        createProject: async () => {
          throw new Error('403');
        },
      }),
    });
    const before = useAppStore.getState().exportProjectFile();
    useAppStore.setState({ projectName: 'Sketch' });
    const result = await drive.saveAsToDrive('Remix');
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
    expect(useAppStore.getState().projectName).toBe('Sketch');
    // The identity a failed Save As did NOT adopt, checked through the one
    // reader that exposes it.
    expect(useAppStore.getState().exportProjectFile().id).toBe(before.id);
  });
});

describe('disconnectDrive', () => {
  test('revokes, signs out, and reverts a drive source to untitled', async () => {
    let revoked = 0;
    const { useAppStore, drive } = await freshStore({
      auth: { ...okAuth(), revoke: async () => { revoked += 1; } },
    });
    useAppStore.setState({ driveSignedIn: true, projectSource: { kind: 'drive', fileId: 'drive-9' } });
    await drive.disconnectDrive();
    expect(revoked).toBe(1);
    expect(useAppStore.getState().driveSignedIn).toBe(false);
    // The id is meaningless without a token; the body and the autosave are not
    // touched, which is what the design's sign-out row asks for.
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('a local source survives a sign-out — it was never Google’s', async () => {
    const { useAppStore, drive } = await freshStore();
    const handle = { name: 'sketch.solna' } as unknown as FileSystemFileHandle;
    useAppStore.setState({ driveSignedIn: true, projectSource: { kind: 'local', handle } });
    await drive.disconnectDrive();
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'local', handle });
  });
});

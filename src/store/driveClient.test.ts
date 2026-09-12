import { describe, expect, test } from 'bun:test';
import {
  DRIVE_LIST_FIELDS,
  DRIVE_LIST_ORDER,
  DRIVE_LIST_QUERY,
  DRIVE_PAGE_SIZE,
  SOLNA_DRIVE_MIME,
  createDriveClient,
  type DriveTransport,
} from './driveClient';
import { parseProjectFile } from './projectFile';
import { factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';

const body = (name: string, bpm: number): ProjectBody => ({
  ...makeEnvelope(name, 1_000),
  content: { ...factoryProjectContent(), bpm },
});

const meta = (id: string, name: string, mimeType = SOLNA_DRIVE_MIME) => ({
  id,
  name,
  mimeType,
  modifiedTime: '2026-09-12T10:00:00.000Z',
});

function stub(overrides: Partial<DriveTransport> = {}) {
  const calls: Array<[string, unknown]> = [];
  const transport: DriveTransport = {
    list: async (params) => {
      calls.push(['list', params]);
      return { files: [] };
    },
    readText: async (fileId) => {
      calls.push(['readText', fileId]);
      return '';
    },
    create: async (params) => {
      calls.push(['create', params]);
      return meta('new-1', params.name, params.mimeType);
    },
    update: async (params) => {
      calls.push(['update', params]);
      return meta(params.fileId, 'updated.solna', params.mimeType);
    },
    userProfile: async () => {
      calls.push(['userProfile', undefined]);
      return { email: '', name: '' };
    },
    ...overrides,
  };
  return { transport, calls };
}

describe('DRIVE_LIST_QUERY', () => {
  test('asks for solna files anywhere in the Drive, trashed excluded', () => {
    expect(DRIVE_LIST_QUERY).toBe("mimeType = 'application/vnd.solna' and trashed = false");
  });

  test('constrains no parent, so a project the user moved stays listed', () => {
    // Not a style preference: `drive.file` cannot see a folder this app did not
    // create, so `'<id>' in parents` could only ever name an invisible folder —
    // and filtering on 'root' would hide a project the moment the user filed it.
    expect(DRIVE_LIST_QUERY).not.toContain('parents');
    expect(DRIVE_LIST_QUERY).not.toContain('folder');
  });
});

describe('listProjects', () => {
  test('sends the query, the page size, the newest-first order and the fields', async () => {
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.listProjects();
    expect(calls[0]).toEqual([
      'list',
      {
        q: DRIVE_LIST_QUERY,
        pageSize: DRIVE_PAGE_SIZE,
        orderBy: DRIVE_LIST_ORDER,
        fields: DRIVE_LIST_FIELDS,
      },
    ]);
  });

  test('forwards the page token on a second page and omits it on the first', async () => {
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.listProjects();
    await client.listProjects('page-2');
    expect((calls[0][1] as { pageToken?: string }).pageToken).toBeUndefined();
    expect((calls[1][1] as { pageToken?: string }).pageToken).toBe('page-2');
  });
});

describe('readProject', () => {
  test('parses the media body and reports its unknown references', async () => {
    const text = JSON.stringify(body('Remote', 128));
    const { transport } = stub({ readText: async () => text });
    const client = createDriveClient(transport);
    const parsed = await client.readProject('file-1');
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.body.content.bpm).toBe(128);
    expect(parsed.ok && parsed.warnings).toEqual([]);
  });

  test('a Drive file that is not a solna project is malformed, never a throw', async () => {
    const { transport } = stub({ readText: async () => '<html>consent</html>' });
    const client = createDriveClient(transport);
    const parsed = await client.readProject('file-1');
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toBe('malformed');
  });

  test('a newer formatVersion is refused with the newer-version error', async () => {
    const newer = { ...body('Future', 100), formatVersion: 999 };
    const { transport } = stub({ readText: async () => JSON.stringify(newer) });
    const client = createDriveClient(transport);
    const parsed = await client.readProject('file-1');
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toBe('newer-version');
  });
});

describe('createProject', () => {
  test('names the file <slug>.solna with the solna MIME, and picks no folder', async () => {
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.createProject('My Sketch', body('My Sketch', 90));
    const [, params] = calls[0] as [string, { name: string; mimeType: string; text: string }];
    expect(params.name).toBe('my-sketch.solna');
    expect(params.mimeType).toBe(SOLNA_DRIVE_MIME);
    // No `parents`: the file lands in My Drive and the user may move it later.
    // A folder id could only name a folder `drive.file` cannot see.
    expect(params).not.toHaveProperty('parents');
  });

  test('the media it uploads is the same bytes serializeProject produces', async () => {
    const sketch = body('Sketch', 90);
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.createProject('Sketch', sketch);
    const [, params] = calls[0] as [string, { text: string }];
    expect(parseProjectFile(params.text)).toEqual({ ok: true, body: sketch, warnings: [] });
  });

  test('returns the created file metadata', async () => {
    const { transport } = stub();
    const client = createDriveClient(transport);
    const created = await client.createProject('Sketch', body('Sketch', 90));
    expect(created.id).toBe('new-1');
    expect(created.mimeType).toBe(SOLNA_DRIVE_MIME);
  });
});

describe('updateProject', () => {
  test('sends the file id, the solna MIME and the serialised body', async () => {
    const sketch = body('Sketch', 101);
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.updateProject('file-9', sketch);
    const [, params] = calls[0] as [string, { fileId: string; mimeType: string; text: string }];
    expect(params.fileId).toBe('file-9');
    expect(params.mimeType).toBe(SOLNA_DRIVE_MIME);
    expect(parseProjectFile(params.text).ok).toBe(true);
  });

  test('a body with an updated bpm round-trips through the upload', async () => {
    const sketch = body('Sketch', 145);
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.updateProject('file-9', sketch);
    const [, params] = calls[0] as [string, { text: string }];
    const parsed = parseProjectFile(params.text);
    expect(parsed.ok && parsed.body.content.bpm).toBe(145);
  });
});

describe('userProfile', () => {
  test('passes through to the transport that owns the about call', async () => {
    const { transport } = stub({ userProfile: async () => ({ email: 'ann@example.com', name: 'Ann' }) });
    const client = createDriveClient(transport);
    expect(await client.userProfile()).toEqual({ email: 'ann@example.com', name: 'Ann' });
  });
});

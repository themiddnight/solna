import { describe, expect, test } from 'bun:test';
import {
  DRIVE_ABOUT_PATH,
  DRIVE_API_BASE,
  DRIVE_BOUNDARY,
  DRIVE_FILES_PATH,
  DRIVE_UPLOAD_PATH,
  createFileBody,
  createGapiTransport,
  multipartBody,
  readResultText,
  toDriveFileMeta,
  toDrivePage,
  toUserProfile,
  updateFileBody,
} from './driveGapi';
import { DriveUnavailableError, driveErrorMessage, type DriveAuth } from './driveAuth';
import { DRIVE_LIST_FIELDS, DRIVE_LIST_ORDER, DRIVE_LIST_QUERY, SOLNA_DRIVE_MIME } from './driveClient';
import type { GapiRequest, GapiResponse, GapiRoot } from '../utils/googleScriptLoader';

function fakeGapi(requestImpl?: (request: GapiRequest) => Promise<GapiResponse>) {
  const calls: GapiRequest[] = [];
  const tokens: Array<{ access_token: string } | null> = [];
  const root: GapiRoot = {
    load: (_name, callback) => callback(),
    client: {
      setToken: (token) => {
        tokens.push(token);
      },
      request: async (request) => {
        calls.push(request);
        return requestImpl ? requestImpl(request) : { result: null };
      },
    },
  };
  return { root, calls, tokens };
}

function fakeAuth() {
  const state = { issued: 0, invalidated: 0, value: 'token-1' };
  const auth: DriveAuth = {
    token: async () => {
      state.issued++;
      return state.value;
    },
    invalidate: () => {
      state.invalidated++;
      state.value = 'token-2';
    },
    revoke: async () => {},
    signedIn: () => true,
  };
  return { auth, state };
}

describe('multipartBody', () => {
  test('frames each part and terminates with the boundary', () => {
    expect(multipartBody([{ contentType: 'application/json', body: '{"a":1}' }])).toBe(
      [
        `--${DRIVE_BOUNDARY}`,
        'Content-Type: application/json',
        '',
        '{"a":1}',
        `--${DRIVE_BOUNDARY}--`,
      ].join('\r\n'),
    );
  });
});

describe('createFileBody', () => {
  test('carries metadata first and media second', () => {
    const body = createFileBody({ name: 'sketch.solna', mimeType: SOLNA_DRIVE_MIME }, '{"v":1}');
    expect(body).toBe(
      [
        `--${DRIVE_BOUNDARY}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        '{"name":"sketch.solna","mimeType":"application/vnd.solna"}',
        `--${DRIVE_BOUNDARY}`,
        `Content-Type: ${SOLNA_DRIVE_MIME}`,
        '',
        '{"v":1}',
        `--${DRIVE_BOUNDARY}--`,
      ].join('\r\n'),
    );
  });
});

describe('updateFileBody', () => {
  test('carries metadata and media — Drive rejects a media-only update body', () => {
    expect(updateFileBody('{"v":2}', SOLNA_DRIVE_MIME)).toBe(
      [
        `--${DRIVE_BOUNDARY}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        `{"mimeType":"${SOLNA_DRIVE_MIME}"}`,
        `--${DRIVE_BOUNDARY}`,
        `Content-Type: ${SOLNA_DRIVE_MIME}`,
        '',
        '{"v":2}',
        `--${DRIVE_BOUNDARY}--`,
      ].join('\r\n'),
    );
  });
});

describe('readResultText', () => {
  test('prefers response.body — the shape a real vnd.solna media read returns', () => {
    // gapi does not parse a content type it does not know, so `result` is
    // `false` and the bytes are in `body`. A transport that read `result` only
    // would turn every Drive open into "not a Solna project".
    expect(readResultText({ result: false, body: '{"a":1}' })).toBe('{"a":1}');
  });

  test('falls back to a parsed object, and to a raw string', () => {
    expect(readResultText({ result: { a: 1 } })).toBe('{"a":1}');
    expect(readResultText({ result: '{"a":1}' })).toBe('{"a":1}');
  });

  test('an empty or unreadable response is an empty string', () => {
    expect(readResultText({ result: null })).toBe('');
    expect(readResultText(undefined)).toBe('');
    expect(readResultText({ result: 7 })).toBe('');
  });
});

describe('toDriveFileMeta', () => {
  test('keeps a full record', () => {
    const meta = { id: 'f1', name: 'a.solna', mimeType: SOLNA_DRIVE_MIME, modifiedTime: '2026-09-12T00:00:00.000Z' };
    expect(toDriveFileMeta(meta)).toEqual(meta);
  });

  test('fills in fields Drive did not echo, so a successful write is not read as a failure', () => {
    expect(toDriveFileMeta({ id: 'f1' })).toEqual({ id: 'f1', name: '', mimeType: '', modifiedTime: '' });
  });

  test('a record with no id is unreadable', () => {
    expect(toDriveFileMeta({ name: 'a.solna' })).toBeNull();
    expect(toDriveFileMeta('nope')).toBeNull();
  });
});

describe('toDrivePage', () => {
  test('drops rows with no id and keeps the rest', () => {
    const page = toDrivePage({ files: [{ id: 'f1', name: 'a' }, { name: 'broken' }, 'junk'] });
    expect(page.files).toHaveLength(1);
    expect(page.files[0].id).toBe('f1');
  });

  test('keeps nextPageToken only when it is a string', () => {
    expect(toDrivePage({ files: [], nextPageToken: 'p2' }).nextPageToken).toBe('p2');
    expect(toDrivePage({ files: [], nextPageToken: 7 }).nextPageToken).toBeUndefined();
    expect(toDrivePage(undefined).files).toEqual([]);
  });
});

describe('toUserProfile', () => {
  test('reads the disclosed address and name', () => {
    expect(toUserProfile({ user: { emailAddress: 'a@b.c', displayName: 'Ann' } })).toEqual({
      email: 'a@b.c',
      name: 'Ann',
    });
  });

  test('falls back to empty strings when Drive hides them', () => {
    expect(toUserProfile({ user: {} })).toEqual({ email: '', name: '' });
    expect(toUserProfile(undefined)).toEqual({ email: '', name: '' });
  });
});

describe('createGapiTransport', () => {
  test('lists through the files endpoint with the solna query, as strings', async () => {
    const gapi = fakeGapi(async () => ({ result: { files: [{ id: 'f1', name: 'a.solna' }] } }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    const page = await transport.list({ q: DRIVE_LIST_QUERY, pageSize: 100, orderBy: DRIVE_LIST_ORDER, fields: DRIVE_LIST_FIELDS });

    expect(gapi.tokens).toEqual([{ access_token: 'token-1' }]);
    expect(gapi.calls[0].path).toBe(`${DRIVE_API_BASE}${DRIVE_FILES_PATH}`);
    expect(gapi.calls[0].method).toBe('GET');
    expect(gapi.calls[0].params?.q).toBe(DRIVE_LIST_QUERY);
    expect(gapi.calls[0].params?.pageSize).toBe('100');
    expect(gapi.calls[0].params?.orderBy).toBe(DRIVE_LIST_ORDER);
    expect(gapi.calls[0].params?.fields).toBe(DRIVE_LIST_FIELDS);
    expect(gapi.calls[0].params?.pageToken).toBeUndefined();
    expect(page.files[0].id).toBe('f1');
  });

  test('forwards a page token only when one was given', async () => {
    const gapi = fakeGapi();
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    await transport.list({ q: 'q', pageSize: 100, orderBy: 'o', fields: 'f', pageToken: 'p2' });
    expect(gapi.calls[0].params?.pageToken).toBe('p2');
  });

  test('reads media with alt=media and hands back the text gapi could not parse', async () => {
    // The realistic shape: an unparsed body for a vnd.solna content type.
    const gapi = fakeGapi(async () => ({ result: false, body: '{"v":3}' }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    expect(await transport.readText('file-9')).toBe('{"v":3}');
    expect(gapi.calls[0].path).toBe(`${DRIVE_API_BASE}${DRIVE_FILES_PATH}/file-9`);
    expect(gapi.calls[0].params).toEqual({ alt: 'media' });
  });

  test('reads the account identity through the about endpoint', async () => {
    const gapi = fakeGapi(async () => ({ result: { user: { emailAddress: 'ann@example.com', displayName: 'Ann' } } }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    const profile = await transport.userProfile();
    expect(gapi.calls[0].path).toBe(`${DRIVE_API_BASE}${DRIVE_ABOUT_PATH}`);
    expect(gapi.calls[0].method).toBe('GET');
    expect(gapi.calls[0].params).toEqual({ fields: 'user(emailAddress, displayName)' });
    expect(profile).toEqual({ email: 'ann@example.com', name: 'Ann' });
  });

  test('creates with a multipart upload carrying metadata and media', async () => {
    const gapi = fakeGapi(async () => ({ result: { id: 'new-1', name: 'a.solna', mimeType: SOLNA_DRIVE_MIME, modifiedTime: 'x' } }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    const created = await transport.create({ name: 'a.solna', mimeType: SOLNA_DRIVE_MIME, text: '{"v":1}' });

    expect(gapi.calls[0].path).toBe(`${DRIVE_API_BASE}${DRIVE_UPLOAD_PATH}`);
    expect(gapi.calls[0].method).toBe('POST');
    expect(gapi.calls[0].params?.uploadType).toBe('multipart');
    expect(gapi.calls[0].headers?.['Content-Type']).toBe(`multipart/related; boundary=${DRIVE_BOUNDARY}`);
    expect(gapi.calls[0].body).toContain('{"name":"a.solna"');
    expect(gapi.calls[0].body).toContain('{"v":1}');
    expect(created.id).toBe('new-1');
  });

  test('updates with a PATCH to the file path and a multipart body without a name', async () => {
    const gapi = fakeGapi(async () => ({ result: { id: 'file-9' } }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    const updated = await transport.update({ fileId: 'file-9', mimeType: SOLNA_DRIVE_MIME, text: '{"v":2}' });

    expect(gapi.calls[0].path).toBe(`${DRIVE_API_BASE}${DRIVE_UPLOAD_PATH}/file-9`);
    expect(gapi.calls[0].method).toBe('PATCH');
    expect(gapi.calls[0].body).not.toContain('"name"');
    expect(gapi.calls[0].body).toContain('"mimeType":"application/vnd.solna"');
    expect(updated).toEqual({ id: 'file-9', name: '', mimeType: '', modifiedTime: '' });
  });

  test('an echo with no id is thrown, not returned as a half record', async () => {
    const gapi = fakeGapi(async () => ({ result: { name: 'a.solna' } }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    let caught: unknown;
    try {
      await transport.update({ fileId: 'f', mimeType: SOLNA_DRIVE_MIME, text: '{}' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect((caught as Error).message).toBe('Drive returned a file record with no id');
  });

  test('a 401 is retried once with a fresh token', async () => {
    let attempts = 0;
    const gapi = fakeGapi(async () => {
      attempts++;
      if (attempts === 1) throw { status: 401 };
      return { result: { files: [] } };
    });
    const { auth, state } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    await transport.list({ q: 'q', pageSize: 100, orderBy: 'o', fields: 'f' });
    expect(attempts).toBe(2);
    expect(state.invalidated).toBe(1);
    expect(gapi.tokens).toEqual([{ access_token: 'token-1' }, { access_token: 'token-2' }]);
  });

  test('a gapi client that will not load fails with the unavailable sentence', async () => {
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => {
      throw new DriveUnavailableError();
    }, auth);
    const err = await transport.list({ q: 'q', pageSize: 100, orderBy: 'o', fields: 'f' }).catch((thrown: unknown) => thrown);
    expect(driveErrorMessage(err)).toBe(
      'Could not load the Google Drive client. Check your connection and try again.',
    );
  });
});

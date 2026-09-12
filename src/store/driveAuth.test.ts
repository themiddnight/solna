import { describe, expect, test } from 'bun:test';
import {
  DRIVE_DENIED_MESSAGE,
  DRIVE_FAILED_MESSAGE,
  DRIVE_SCOPE,
  DRIVE_UNAVAILABLE_MESSAGE,
  DriveAuthError,
  DriveUnavailableError,
  createDriveAuth,
  driveClientId,
  driveErrorMessage,
  isAuthFailure,
  withDriveToken,
} from './driveAuth';
import type { GisOauth2, GisTokenClient, GisTokenResponse } from '../utils/googleScriptLoader';

/** A GIS stand-in: it answers with whatever the test queued and records its config. */
function fakeGis(responses: Array<GisTokenResponse | 'error'> = []) {
  const configs: Array<{ client_id: string; scope: string; include_granted_scopes: boolean }> = [];
  const prompts: Array<{ prompt?: string } | undefined> = [];
  const revoked: string[] = [];
  const oauth2: GisOauth2 = {
    initTokenClient: (config) => {
      configs.push(config);
      return {
        requestAccessToken: (overrides) => {
          prompts.push(overrides);
          const next = responses.shift() ?? { access_token: 'token-1', expires_in: 3600 };
          if (next === 'error') config.error_callback?.({ type: 'access_denied' });
          else config.callback(next);
        },
      } satisfies GisTokenClient;
    },
    revoke: (token, done) => {
      revoked.push(token);
      done();
    },
  };
  return { oauth2, configs, prompts, revoked };
}

const neverLoads = async () => ({ ok: false as const, message: 'offline' });

describe('createDriveAuth', () => {
  test('requests a token and reports signed in', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    expect(auth.signedIn()).toBe(false);
    expect(await auth.token()).toBe('token-1');
    expect(auth.signedIn()).toBe(true);
  });

  test('asks for exactly drive.file, the injected client id, and no inherited grant', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid-42' });
    await auth.token();
    const config = gis.configs[0];
    expect(config.client_id).toBe('cid-42');
    expect(config.scope).toBe('https://www.googleapis.com/auth/drive.file');
    expect(config.include_granted_scopes).toBe(false);
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });

  test('a live token is reused — GIS is not asked twice', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    await auth.token();
    await auth.token();
    expect(gis.configs).toHaveLength(1);
  });

  test('an expired token is re-requested, silently on the second round', async () => {
    let clock = 1_000;
    const gis = fakeGis([{ access_token: 'token-1', expires_in: 60 }, { access_token: 'token-2', expires_in: 60 }]);
    const auth = createDriveAuth({
      loadOauth2: async () => ({ ok: true, value: gis.oauth2 }),
      clientId: 'cid',
      now: () => clock,
    });
    expect(await auth.token()).toBe('token-1');
    clock = 1_000 + 61_000;
    expect(auth.signedIn()).toBe(false);
    expect(await auth.token()).toBe('token-2');
    expect(gis.configs).toHaveLength(2);
    // First acquisition may show consent; every one after it must not.
    expect(gis.prompts[0]).toBeUndefined();
    expect(gis.prompts[1]).toEqual({ prompt: '' });
  });

  test('a denied consent rejects with kind denied and leaves the app signed out', async () => {
    const gis = fakeGis(['error']);
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    // ONE queued response, so exactly one token() call may consume it. Calling
    // token() a second time here would fall through to the fake's default
    // success and assert the opposite of what the test name says.
    const err = await auth.token().catch((thrown: unknown) => thrown);
    expect(err instanceof DriveAuthError).toBe(true);
    expect((err as DriveAuthError).kind).toBe('denied');
    expect(driveErrorMessage(err)).toBe(DRIVE_DENIED_MESSAGE);
    expect(auth.signedIn()).toBe(false);
  });

  test('a GIS script that will not load is unavailable, not a hang', async () => {
    const auth = createDriveAuth({ loadOauth2: neverLoads, clientId: 'cid' });
    const err = await auth.token().catch((thrown: unknown) => thrown);
    expect(err instanceof DriveAuthError).toBe(true);
    expect((err as DriveAuthError).kind).toBe('unavailable');
    expect(driveErrorMessage(err)).toBe(DRIVE_UNAVAILABLE_MESSAGE);
  });

  test('revoke hands the token to GIS and forgets it', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    await auth.token();
    await auth.revoke();
    expect(gis.revoked).toEqual(['token-1']);
    expect(auth.signedIn()).toBe(false);
  });

  test('revoke without ever signing in is a no-op, not a crash', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    await auth.revoke();
    expect(gis.revoked).toEqual([]);
  });

  test('invalidate drops the token so the next call asks again', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    await auth.token();
    auth.invalidate();
    expect(auth.signedIn()).toBe(false);
    await auth.token();
    expect(gis.configs).toHaveLength(2);
  });
});

describe('isAuthFailure', () => {
  test('recognises the 401 both ways gapi reports one', () => {
    expect(isAuthFailure({ status: 401 })).toBe(true);
    expect(isAuthFailure({ result: { error: { code: 401 } } })).toBe(true);
  });

  test('leaves every other failure alone', () => {
    expect(isAuthFailure({ status: 404 })).toBe(false);
    expect(isAuthFailure(new Error('network'))).toBe(false);
    expect(isAuthFailure(null)).toBe(false);
  });
});

describe('withDriveToken', () => {
  const authWith = (value = 'token-1') => {
    let issued = 0;
    const auth = {
      token: async () => {
        issued++;
        return value;
      },
      invalidate: () => {},
      revoke: async () => {},
      signedIn: () => true,
    };
    return { auth, issued: () => issued };
  };

  test('passes a live token to the operation', async () => {
    const { auth } = authWith();
    expect(await withDriveToken(auth, async (token) => `saw:${token}`)).toBe('saw:token-1');
  });

  test('re-requests once on a 401 — GIS re-issues while its consent cookie holds', async () => {
    const { auth, issued } = authWith();
    let attempts = 0;
    const result = await withDriveToken(auth, async () => {
      attempts++;
      if (attempts === 1) throw { status: 401 };
      return 'recovered';
    });
    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
    expect(issued()).toBe(2);
  });

  test('a second 401 is the grant being gone, and leaves as a DriveAuthError', async () => {
    const { auth, issued } = authWith();
    let attempts = 0;
    const err = await withDriveToken(auth, async () => {
      attempts++;
      throw { status: 401 };
    }).catch((thrown: unknown) => thrown);
    // NOT the raw `{ status: 401 }`: the slice recognises DriveAuthError and
    // nothing else as the signal to drop `driveSignedIn`.
    expect(err instanceof DriveAuthError).toBe(true);
    expect((err as DriveAuthError).kind).toBe('denied');
    expect(attempts).toBe(2);
    expect(issued()).toBe(2);
  });

  test('a non-auth failure propagates immediately', async () => {
    const { auth, issued } = authWith();
    let caught: unknown;
    try {
      await withDriveToken(auth, async () => {
        throw new DriveUnavailableError('nope');
      });
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof DriveUnavailableError).toBe(true);
    expect((caught as Error).message).toBe('nope');
    expect(issued()).toBe(1);
  });
});

describe('driveErrorMessage', () => {
  test('maps each failure kind to its own sentence', () => {
    expect(driveErrorMessage(new DriveAuthError('denied', 'x'))).toBe(DRIVE_DENIED_MESSAGE);
    expect(driveErrorMessage(new DriveAuthError('unavailable', 'x'))).toBe(DRIVE_UNAVAILABLE_MESSAGE);
    expect(driveErrorMessage(new DriveUnavailableError(DRIVE_UNAVAILABLE_MESSAGE))).toBe(DRIVE_UNAVAILABLE_MESSAGE);
    expect(driveErrorMessage(new Error('boom'))).toBe(DRIVE_FAILED_MESSAGE);
  });
});

describe('driveClientId', () => {
  test('reads and trims the Vite env var', () => {
    expect(driveClientId({ VITE_GOOGLE_CLIENT_ID: '  abc.apps.googleusercontent.com ' })).toBe(
      'abc.apps.googleusercontent.com',
    );
  });

  test('an absent or non-string value is an empty id, never undefined', () => {
    // Every case passes its env explicitly. `driveClientId(undefined)` would
    // fall through to the `import.meta.env` DEFAULT, which bun populates from a
    // developer's own `.env` — a test that passes or fails depending on whose
    // machine it runs on.
    expect(driveClientId({})).toBe('');
    expect(driveClientId({ VITE_GOOGLE_CLIENT_ID: 42 })).toBe('');
    expect(driveClientId({ VITE_GOOGLE_CLIENT_ID: '   ' })).toBe('');
  });
});

describe('an unconfigured client id', () => {
  test('is unavailable, not denied — the user refused nothing', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: '' });
    const err = await auth.token().catch((thrown: unknown) => thrown);
    expect((err as DriveAuthError).kind).toBe('unavailable');
    // GIS is never even asked: initTokenClient('') fails inside Google's script
    // and surfaces through error_callback, which would report the deployment's
    // missing configuration as the USER having declined.
    expect(gis.configs).toHaveLength(0);
  });
});

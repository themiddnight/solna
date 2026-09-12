import type { GisOauth2, LoadResult } from '../utils/googleScriptLoader';

/**
 * `drive.file` and nothing else. It reads as "only the files this app created or
 * opened", it is NON-SENSITIVE (so no restricted-scope assessment), and it is
 * the whole of draw.io's permission model. Adding `drive`, `userinfo` or
 * `openid` would widen the consent screen for no v1 feature — account email and
 * avatar display are explicitly out of scope.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const DRIVE_DENIED_MESSAGE = 'Google Drive access was not granted.';
export const DRIVE_UNAVAILABLE_MESSAGE = 'Could not load the Google Drive client. Check your connection and try again.';
export const DRIVE_FAILED_MESSAGE = 'Google Drive did not respond. Your project is still autosaved on this device.';

/** The two ways acquiring a token fails, kept apart because the copy differs. */
export class DriveAuthError extends Error {
  constructor(
    readonly kind: 'denied' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

/** The gapi client itself could not be loaded — same sentence, different seam. */
export class DriveUnavailableError extends Error {
  constructor(message: string = DRIVE_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'DriveUnavailableError';
  }
}

/** One place a thrown thing becomes a sentence the toast can show. */
export function driveErrorMessage(err: unknown): string {
  if (err instanceof DriveAuthError) {
    return err.kind === 'denied' ? DRIVE_DENIED_MESSAGE : DRIVE_UNAVAILABLE_MESSAGE;
  }
  if (err instanceof DriveUnavailableError) return err.message;
  return DRIVE_FAILED_MESSAGE;
}

/**
 * gapi reports an expired token as a rejected object, not an Error: either
 * `{ status: 401 }` or `{ result: { error: { code: 401 } } }`. Both are the one
 * condition worth retrying, so both are recognised here.
 */
export function isAuthFailure(err: unknown): boolean {
  const shaped = err as { status?: unknown; result?: { error?: { code?: unknown } } } | null | undefined;
  return (shaped?.status ?? shaped?.result?.error?.code) === 401;
}

export interface DriveAuth {
  /** Start loading GIS without requesting a token or opening a popup. */
  preload?(): Promise<void>;
  /** A live access token, acquiring one if there is none. Rejects with DriveAuthError. */
  token(): Promise<string>;
  /** Forget the current token without telling Google — used after a 401. */
  invalidate(): void;
  /** Sign out: revoke at Google and forget locally. Never throws. */
  revoke(): Promise<void>;
  /** Whether an unexpired token is held. The store mirrors this as `driveSignedIn`. */
  signedIn(): boolean;
}

export interface DriveAuthDeps {
  loadOauth2: () => Promise<LoadResult<GisOauth2>>;
  clientId: string;
  now?: () => number;
}

/** The default GIS lifetime when it does not say. An hour, like the real one. */
const DEFAULT_LIFETIME_SECONDS = 3_600;

/**
 * The ONLY holder of the access token. It is a closure variable: no getter
 * exposes it, nothing persists it, and the store carries a boolean instead.
 */
export function createDriveAuth(deps: DriveAuthDeps): DriveAuth {
  const now = deps.now ?? Date.now;
  let token: { value: string; expiresAt: number } | null = null;
  let oauth2: GisOauth2 | null = null;
  let acquired = false;
  let pending: Promise<string> | null = null;
  let preloadPromise: Promise<void> | null = null;
  let loadError: DriveAuthError | null = null;

  const preload = (): Promise<void> => {
    preloadPromise ??= deps.loadOauth2().then((loaded) => {
      if (loaded.ok === false) {
        loadError = new DriveAuthError('unavailable', DRIVE_UNAVAILABLE_MESSAGE);
        return;
      }
      oauth2 = loaded.value;
    }).catch(() => {
      loadError = new DriveAuthError('unavailable', DRIVE_UNAVAILABLE_MESSAGE);
    });
    return preloadPromise;
  };

  /**
   * `prompt: ''` on every acquisition after the first: the user already granted
   * this scope, so GIS re-issues from its own consent cookie without a second
   * screen. The first call has no prompt override, which is what lets a consent
   * screen appear at all.
   */
  const request = (prompt: string | undefined): Promise<string> => {
    // Do not await GIS here. `requestAccessToken()` must be called on the
    // click's stack; waiting for a script load first makes browsers block the
    // consent popup. App boot calls `preload`, and an early click can retry.
    if (deps.clientId.length === 0) return Promise.reject(new DriveAuthError('unavailable', DRIVE_UNAVAILABLE_MESSAGE));
    if (!oauth2) return Promise.reject(loadError ?? new DriveAuthError('unavailable', DRIVE_UNAVAILABLE_MESSAGE));
    const client = oauth2;
    pending = new Promise<string>((resolve, reject) => {
      const deny = () => reject(new DriveAuthError('denied', DRIVE_DENIED_MESSAGE));
      const tokenClient = client.initTokenClient({
        client_id: deps.clientId,
        scope: DRIVE_SCOPE,
        // A fresh token must never silently inherit a broader earlier grant.
        include_granted_scopes: false,
        callback: (response) => {
          if (!response.access_token) {
            deny();
            return;
          }
          const lifetime =
            typeof response.expires_in === 'number' ? response.expires_in : DEFAULT_LIFETIME_SECONDS;
          token = { value: response.access_token, expiresAt: now() + lifetime * 1_000 };
          acquired = true;
          resolve(token.value);
        },
        error_callback: deny,
      });
      if (prompt === undefined) tokenClient.requestAccessToken();
      else tokenClient.requestAccessToken({ prompt });
    }).finally(() => {
      pending = null;
    });
    return pending;
  };

  return {
    preload,
    token: async () => {
      if (token && token.expiresAt > now()) return token.value;
      return request(acquired ? '' : undefined);
    },
    invalidate: () => {
      token = null;
      acquired = false;
    },
    revoke: async () => {
      const current = token;
      token = null;
      acquired = false;
      if (!current || !oauth2) return;
      const revoker = oauth2;
      await new Promise<void>((resolve) => {
        try {
          revoker.revoke(current.value, resolve);
        } catch {
          // A revoke that fails locally still signs the app out, which is the
          // part the user asked for; nothing here is worth an error surface.
          resolve();
        }
      });
    },
    signedIn: () => token !== null && token.expiresAt > now(),
  };
}

/**
 * Run a Drive call with a live token. A 401 invalidates it and returns a typed
 * denial for the UI to surface. GIS requires `requestAccessToken()` to begin
 * from a user gesture, while a 401 arrives after the request's async round
 * trip, so silently asking GIS for a replacement here would be popup-blocked.
 */
export async function withDriveToken<T>(auth: DriveAuth, op: (token: string) => Promise<T>): Promise<T> {
  const first = await auth.token();
  try {
    return await op(first);
  } catch (err) {
    if (!isAuthFailure(err)) throw err;
    auth.invalidate();
    throw new DriveAuthError('denied', DRIVE_DENIED_MESSAGE);
  }
}

/**
 * The OAuth *web* client id from the Vite env. It is not a secret — an OAuth web
 * client has no secret at all — but it is deployment-specific, so it is read at
 * the one place that builds the auth and an empty id is a normal degraded state
 * (Drive simply reports unavailable) rather than a boot failure.
 */
export function driveClientId(env: unknown = import.meta.env): string {
  const raw = (env as { VITE_GOOGLE_CLIENT_ID?: unknown } | undefined)?.VITE_GOOGLE_CLIENT_ID;
  return typeof raw === 'string' ? raw.trim() : '';
}

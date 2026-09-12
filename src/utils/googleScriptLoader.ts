/**
 * The allowlist, in code rather than in a build config, because a CSP is not
 * the only thing that has to agree with it: this function is what stops a
 * mistyped URL from being injected at all.
 *
 * CSP note for whoever deploys this: the site ships NO Content-Security-Policy
 * today, and adding a `<meta http-equiv>` one is deliberately NOT part of this
 * change — a meta CSP would need a hash or nonce for index.html's inline
 * pre-paint theme script, and getting that wrong trades a remote-code guard for
 * a flash of the wrong theme. If a CSP is adopted later (header or meta), its
 * `script-src` must list exactly `https://accounts.google.com` and
 * `https://apis.google.com`, and its `connect-src` exactly
 * `https://www.googleapis.com`.
 *
 * PWA note: vite.config.ts runs vite-plugin-pwa with workbox `runtimeCaching`
 * for the two font origins only, and `globPatterns` precaches local build
 * assets only — so nothing here is cached for offline use, which is correct.
 * No rule may ever be added for a Google script or API origin: a Drive response
 * served from cache would present a stale project as if it were the live one.
 * GIS's token client authenticates through a popup and postMessage, not a
 * redirect, so workbox's `navigateFallback: '/index.html'` never intercepts it.
 * `src/utils/googleOrigins.test.ts` (Task 17) is what keeps that true.
 */
export const GOOGLE_SCRIPT_ORIGINS = ['https://accounts.google.com', 'https://apis.google.com'] as const;

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
export const GAPI_SCRIPT_URL = 'https://apis.google.com/js/api.js';

export function isAllowedGoogleScript(url: string): boolean {
  return GOOGLE_SCRIPT_ORIGINS.some((origin) => url.startsWith(`${origin}/`));
}

export type LoadResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface ScriptElement {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

export interface ScriptDocument {
  createElement(tag: 'script'): ScriptElement;
  head: { appendChild(node: unknown): void };
}

export const GIS_LOAD_FAILED_MESSAGE = 'Could not load the Google Drive client. Check your connection and try again.';

/** One in-flight/resolved load per URL, so two callers share one script tag. */
const loaded = new Map<string, Promise<LoadResult<null>>>();

function inject(url: string, doc: ScriptDocument): Promise<LoadResult<null>> {
  return new Promise((resolve) => {
    const element = doc.createElement('script');
    element.src = url;
    element.async = true;
    element.onload = () => resolve({ ok: true, value: null });
    element.onerror = () => resolve({ ok: false, message: GIS_LOAD_FAILED_MESSAGE });
    doc.head.appendChild(element);
  });
}

/**
 * `doc` is injectable so the suite can run without a DOM, and supplying one
 * BYPASSES the cache — a shared cache keyed by URL alone would make the second
 * test in a file observe the first test's document.
 *
 * The real document is read as `globalThis.document`, NOT `globalThis`: a
 * `ScriptDocument` is `createElement` + `head`, and neither is on the global
 * object. Because every test injects a `doc`, nothing in the suite exercises
 * this line — so it is the one line here that has to be right by reading.
 * A non-browser scope (a test that forgets its `doc`, an SSR pass) reports
 * unavailable rather than throwing.
 */
export function loadScript(url: string, doc?: ScriptDocument): Promise<LoadResult<null>> {
  if (!isAllowedGoogleScript(url)) {
    return Promise.resolve({ ok: false, message: `Refused to load a script from outside the allowlist: ${url}` });
  }
  if (doc) return inject(url, doc);
  const host = (globalThis as { document?: unknown }).document;
  if (typeof (host as ScriptDocument | undefined)?.createElement !== 'function') {
    return Promise.resolve({ ok: false, message: GIS_LOAD_FAILED_MESSAGE });
  }
  let pending = loaded.get(url);
  if (!pending) {
    pending = inject(url, host as ScriptDocument);
    loaded.set(url, pending);
  }
  return pending;
}

// --- Google Identity Services -------------------------------------------------

export interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

export interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

export interface GisOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): GisTokenClient;
  revoke(token: string, done: () => void): void;
}

/**
 * The globals are READ here, after the script's onload, and never imported:
 * GIS installs `google.accounts.oauth2` and gapi installs `gapi` on the window,
 * so there is nothing to import and nothing to type-check against a dependency
 * solna does not have.
 */
export async function loadGis(
  doc?: ScriptDocument,
  scope: unknown = globalThis,
): Promise<LoadResult<GisOauth2>> {
  const script = await loadScript(GIS_SCRIPT_URL, doc);
  if (script.ok === false) return script;
  const oauth2 = (scope as { google?: { accounts?: { oauth2?: GisOauth2 } } }).google?.accounts?.oauth2;
  if (!oauth2 || typeof oauth2.initTokenClient !== 'function') {
    return { ok: false, message: GIS_LOAD_FAILED_MESSAGE };
  }
  return { ok: true, value: oauth2 };
}

// --- gapi ---------------------------------------------------------------------

export interface GapiRequest {
  path: string;
  method: 'GET' | 'POST' | 'PATCH';
  params?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * `result` is gapi's PARSED body — and it is `false` when the response was not
 * JSON by content type. `body` is the raw text and is always present, so it is
 * declared here and preferred when reading media: a `.solna` comes back as
 * `application/vnd.solna`, which gapi does not parse, and a transport that only
 * looked at `result` would report every Drive open as a malformed project.
 */
export interface GapiResponse {
  result: unknown;
  body?: string;
}

export interface GapiClient {
  request(request: GapiRequest): Promise<GapiResponse>;
  setToken(token: { access_token: string } | null): void;
}

export interface GapiRoot {
  client: GapiClient;
  load(name: string, callback: () => void): void;
}

export async function loadGapi(
  doc?: ScriptDocument,
  scope: unknown = globalThis,
): Promise<LoadResult<GapiRoot>> {
  const script = await loadScript(GAPI_SCRIPT_URL, doc);
  if (script.ok === false) return script;
  const gapi = (scope as { gapi?: GapiRoot }).gapi;
  if (!gapi || typeof gapi.load !== 'function') return { ok: false, message: GIS_LOAD_FAILED_MESSAGE };
  const ready = new Promise<void>((resolve) => gapi.load('client', resolve));
  await ready;
  if (!gapi.client || typeof gapi.client.request !== 'function') {
    return { ok: false, message: GIS_LOAD_FAILED_MESSAGE };
  }
  return { ok: true, value: gapi };
}

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  GAPI_SCRIPT_URL,
  GIS_LOAD_FAILED_MESSAGE,
  GIS_SCRIPT_URL,
  GOOGLE_SCRIPT_ORIGINS,
  isAllowedGoogleScript,
  loadGapi,
  loadGis,
  loadScript,
} from './googleScriptLoader';

interface FakeScript {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

/** A document that only records what was appended; the test fires the events. */
function fakeDoc() {
  const appended: FakeScript[] = [];
  return {
    appended,
    doc: {
      createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
      head: { appendChild: (node: unknown) => void appended.push(node as FakeScript) },
    },
  };
}

beforeEach(() => {
  // Each test starts from an empty module-level load cache.
  delete (globalThis as { google?: unknown }).google;
  delete (globalThis as { gapi?: unknown }).gapi;
  delete (globalThis as { document?: unknown }).document;
});

describe('the origin allowlist', () => {
  test('names exactly the two Google origins the design allows', () => {
    expect(GOOGLE_SCRIPT_ORIGINS).toEqual(['https://accounts.google.com', 'https://apis.google.com']);
  });

  test('accepts the two script URLs and nothing wider', () => {
    expect(isAllowedGoogleScript(GIS_SCRIPT_URL)).toBe(true);
    expect(isAllowedGoogleScript(GAPI_SCRIPT_URL)).toBe(true);
    expect(isAllowedGoogleScript('https://accounts.google.com.evil.test/gsi/client')).toBe(false);
    expect(isAllowedGoogleScript('https://www.googleapis.com/drive/v3/files')).toBe(false);
    expect(isAllowedGoogleScript('http://accounts.google.com/gsi/client')).toBe(false);
  });
});

describe('loadScript', () => {
  test('appends an async script for an allowed origin and resolves on load', async () => {
    const { appended, doc } = fakeDoc();
    const pending = loadScript(GIS_SCRIPT_URL, doc);
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe(GIS_SCRIPT_URL);
    expect(appended[0].async).toBe(true);
    appended[0].onload?.();
    expect(await pending).toEqual({ ok: true, value: null });
  });

  test('refuses a URL outside the allowlist without touching the document', async () => {
    const { appended, doc } = fakeDoc();
    const result = await loadScript('https://evil.test/tracker.js', doc);
    expect(result.ok).toBe(false);
    expect(appended).toHaveLength(0);
  });

  test('a script that fails to load is a typed failure, never a rejection', async () => {
    const { appended, doc } = fakeDoc();
    const pending = loadScript(GIS_SCRIPT_URL, doc);
    appended[0].onerror?.();
    const result = await pending;
    expect(result.ok).toBe(false);
  });

  test('a failed production load is retried instead of being cached forever', async () => {
    const { appended, doc } = fakeDoc();
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });

    const first = loadScript(GIS_SCRIPT_URL);
    appended[0].onerror?.();
    expect((await first).ok).toBe(false);

    const second = loadScript(GIS_SCRIPT_URL);
    expect(appended).toHaveLength(2);
    appended[1].onload?.();
    expect(await second).toEqual({ ok: true, value: null });
  });

  test('with no doc argument it reads globalThis.document, and says unavailable when there is none', async () => {
    // bun:test has no DOM, so this is the no-document branch — and it is the
    // ONLY coverage the un-injected path gets. It exists because the obvious
    // wrong implementation (`globalThis as ScriptDocument`) throws
    // `doc.createElement is not a function` in a real browser, where no test
    // would ever have reached it.
    expect(await loadScript(GIS_SCRIPT_URL)).toEqual({ ok: false, message: GIS_LOAD_FAILED_MESSAGE });
  });
});

describe('loadGis', () => {
  test('resolves the oauth2 object once the script announces it', async () => {
    const { appended, doc } = fakeDoc();
    const scope = { google: { accounts: { oauth2: { initTokenClient: () => ({}), revoke: () => {} } } } };
    const pending = loadGis(doc, scope);
    // The script's onload is what makes the global appear in a real browser.
    appended[0].onload?.();
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(scope.google.accounts.oauth2);
  });

  test('a loaded script that never defines oauth2 is unavailable, not a crash', async () => {
    const { appended, doc } = fakeDoc();
    const pending = loadGis(doc, {});
    appended[0].onload?.();
    const result = await pending;
    expect(result.ok).toBe(false);
  });
});

describe('loadGapi', () => {
  test('offers the client to gapi.load and resolves once it is ready', async () => {
    const { appended, doc } = fakeDoc();
    const client = { request: async () => ({ result: null }) };
    let loadArg = '';
    const scope = {
      gapi: {
        client,
        load: (name: string, callback: () => void) => {
          loadArg = name;
          callback();
        },
      },
    };
    const pending = loadGapi(doc, scope);
    appended[0].onload?.();
    const result = await pending;
    expect(loadArg).toBe('client');
    expect(result.ok && result.value.client).toBe(client);
  });

  test('a scope without gapi.load is unavailable, not a crash', async () => {
    const { appended, doc } = fakeDoc();
    const pending = loadGapi(doc, { gapi: {} });
    appended[0].onload?.();
    const result = await pending;
    expect(result.ok).toBe(false);
  });
});

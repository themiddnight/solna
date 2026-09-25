import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseThemeChoice, resolveTheme } from './themes';

/**
 * Runs the blocking <head> script from index.html against fakes, so the
 * bootstrap and the TS resolution (R345) can never disagree.
 */
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>\s*(\/\/ Pre-paint theme bootstrap[\s\S]*?)<\/script>/)?.[1];

const THROW = Symbol('throw');

function runBootstrap(stored: string | null | typeof THROW, prefersLight: boolean): string | undefined {
  if (script === undefined) throw new Error('bootstrap script not found in index.html');
  const dataset: Record<string, string> = {};
  const localStorage = {
    getItem: () => {
      if (stored === THROW) throw new Error('SecurityError: storage is blocked');
      return stored;
    },
  };
  const window = {
    matchMedia: (query: string) => ({ matches: query === '(prefers-color-scheme: light)' && prefersLight }),
  };
  const document = { documentElement: { dataset } };
  new Function('localStorage', 'window', 'document', script)(localStorage, window, document);
  return dataset.theme;
}

describe('index.html theme bootstrap', () => {
  test('matches resolveTheme(parseThemeChoice(stored)) for every known value', () => {
    for (const stored of [null, '', 'system', 'solna-dark', 'solna-light', 'dracula', 'acid', 'light']) {
      for (const prefersLight of [true, false]) {
        expect(runBootstrap(stored, prefersLight)).toBe(resolveTheme(parseThemeChoice(stored), prefersLight));
      }
    }
  });

  test('a throwing storage resolves like System', () => {
    expect(runBootstrap(THROW, true)).toBe('solna-light');
    expect(runBootstrap(THROW, false)).toBe('solna-dark');
  });

  // The one intended divergence: the script carries no roster, so an unknown
  // id is set verbatim (solna-dark is daisyUI's --default on :root, so the
  // page still paints) and useThemeChoice corrects it on mount.
  test('an unknown id is set verbatim', () => {
    expect(runBootstrap('retired-theme', true)).toBe('retired-theme');
  });
});

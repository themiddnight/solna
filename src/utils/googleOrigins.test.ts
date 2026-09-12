import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The literals are built from parts ON PURPOSE: this file is scanned by its own
 * rule, and a test that contains the strings it forbids would have to allowlist
 * itself — which is how a guard like this stops being read.
 */
const GOOGLEAPIS = ['goo', 'gleapis.com'].join('');
/**
 * Dots are matched as `[.\\]*\\.` — a literal dot OR an escaped one — because
 * the file this rule most needs to police writes its origins inside REGEX
 * LITERALS: workbox's `urlPattern: /^https:\/\/www\.googleapis\.com\//` spells
 * the host `www\.googleapis\.com`. A pattern that only matched a bare dot
 * passes that file happily and guards exactly nothing, which is the failure
 * mode this scan exists to prevent — so the shape is asserted below rather than
 * assumed.
 *
 * A lookbehind rather than a word boundary distinguishes the two cases that
 * differ by SUBDOMAIN: `fonts.googleapis.com` is a font host vite.config.ts
 * legitimately caches, `www.googleapis.com` is the API.
 */
/** A dot as it may appear in source: bare, or backslash-escaped inside a regex literal. */
const DOT = '\\\\?\\.';
/** `a.b.c` → a pattern matching `a.b.c` AND `a\.b\.c`. */
const host = (dotted: string): string => dotted.split('.').join(DOT);

const FORBIDDEN = new RegExp(
  [
    `(?<!fonts${DOT})${host(GOOGLEAPIS)}`,
    host('accounts.google.com'),
    host('apis.google.com'),
  ].join('|'),
);

/** The three files an origin may live in, and why each one is the right home. */
const ALLOWED = [
  'src/utils/googleScriptLoader.ts',
  'src/store/driveAuth.ts',
  'src/store/driveGapi.ts',
];

/** `fonts.googleapis.com` is a font host, not an API host, and is excluded by the pattern above. */
const FONTS_HOST = ['fonts', GOOGLEAPIS].join('.');

/**
 * `.test.ts(x)` files are EXCLUDED deliberately: a test that asserts ABOUT an
 * origin has to name it, and no test file reaches the bundle. This guard is
 * about what ships.
 */
function sourceFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, into);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) into.push(full);
  }
  return into;
}

function offenders(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return text.split('\n').filter((line) => FORBIDDEN.test(line));
}

describe('Google origins in the source', () => {
  test('appear only in the three files that own them', () => {
    const found = sourceFiles(join(ROOT, 'src'))
      .map((file) => relative(ROOT, file))
      .filter((file) => offenders(join(ROOT, file)).length > 0)
      .sort();
    expect(found).toEqual([...ALLOWED].sort());
  });

  test('the font host is not swept up by the rule, in either spelling', () => {
    // A guard that flagged the font origin would be switched off instead of
    // obeyed, so the exclusion is itself asserted rather than assumed.
    expect(FORBIDDEN.test(`url("https://${FONTS_HOST}/css2?family=Inter")`)).toBe(false);
    expect(FORBIDDEN.test(`urlPattern: /^https:\\/\\/${FONTS_HOST.replace(/\./g, '\\.')}\\//`)).toBe(false);
    expect(FORBIDDEN.test(`https://${GOOGLEAPIS}/drive/v3/files`)).toBe(true);
  });

  test('catches an API origin spelled the way a workbox rule spells it', () => {
    // THE test this guard lives or dies by. A `urlPattern` is a regex literal,
    // so its dots are backslash-escaped — and a rule that only matched a bare
    // dot would pass vite.config.ts forever while guarding nothing at all.
    const escaped = `www.${GOOGLEAPIS}`.replace(/\./g, '\\.');
    expect(FORBIDDEN.test(`urlPattern: /^https:\\/\\/${escaped}\\//`)).toBe(true);
  });

  test('vite.config.ts caches no Google origin', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    // The font host is asserted in the spelling a workbox `urlPattern` actually
    // writes — escaped dots — because a `urlPattern` IS a regex literal. The
    // bare spelling cannot appear in that file at all, so `toContain(FONTS_HOST)`
    // failed against the very file this assertion reads; this is the same
    // escaped-dot trap the pattern above exists to survive, and the assertion
    // still carries its real meaning: the font host IS here, so the lookbehind
    // exclusion below is exercised rather than vacuous.
    expect(config).toContain(FONTS_HOST.replace(/\./g, '\\.'));
    // No runtime cache rule may name an API or script origin: a cached OAuth
    // response or a cached `gsi/client` is a sign-in that never expires and a
    // policy that can never be tightened.
    expect(offenders(join(ROOT, 'vite.config.ts'))).toEqual([]);
  });

  test('no source asks for a Drive scope wider than drive.file, and the Picker is unused', () => {
    const authPrefix = `${GOOGLEAPIS}/auth/`;
    const scopeLines: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.includes(`${authPrefix}`)) scopeLines.push(line.trim());
      }
    }
    // Exactly one, in exactly one SHIPPING file: a second scope string anywhere
    // is how a broader grant arrives without anyone deciding to add it. Test
    // files are already excluded by sourceFiles.
    expect(scopeLines).toHaveLength(1);
    expect(scopeLines[0]).toContain(`${authPrefix}drive.file`);

    for (const file of sourceFiles(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      // The Picker is a non-goal: it is a Google-hosted iframe, a second origin,
      // and the API key it needs is the one thing this design removed.
      expect(text).not.toContain(['picker', GOOGLEAPIS].join('.'));
      expect(text).not.toContain(['gapi', 'load'].join('.') + "(" + "'picker'");
    }
  });
});

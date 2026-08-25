/**
 * Theme token guard.
 *
 * Scans the app source for legacy murva-palette leftovers that break the
 * `solna-light` daisyUI theme: raw hex literals, raw Tailwind palette colors,
 * absolute black/white, `dark:` variants, rgb()/rgba() literals, and a handful
 * of utilities that do not exist in Tailwind v4 (so they silently no-op).
 *
 * Deliberately dependency-free (node:fs / node:path only) so it runs under
 * `bun test`, under `bun run check:theme`, and in CI without a build step.
 *
 * Files still being migrated are listed in ALLOWLIST. Each migration task
 * deletes exactly one entry from that array as its failing-test step.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface Violation {
  /** 1-based line number within the scanned file. */
  line: number;
  /** Name of the RULES entry that matched. */
  rule: string;
  /** The trimmed source line the match occurred on. */
  snippet: string;
}

/** Every raw Tailwind palette family that must not appear in app source. */
const PALETTE_FAMILIES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');

export const RULES: { name: string; pattern: RegExp }[] = [
  {
    // Any hex color literal: Tailwind arbitrary values (bg-[#12152A]), SVG
    // presentation attributes (stroke="#252B48"), canvas fill/strokeStyle.
    name: 'raw-hex',
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    // indigo-500, slate-400, emerald-500/30, from-rose-500, ...
    name: 'palette-color',
    pattern: new RegExp(`\\b(?:${PALETTE_FAMILIES})-(?:50|[1-9]00|950)\\b`, 'g'),
  },
  {
    // text-white, bg-black/70, border-white/10, ring-black, ...
    name: 'absolute-bw',
    pattern:
      /\b(?:text|bg|border|fill|stroke|ring|shadow|from|via|to|divide|outline|decoration|accent|caret)-(?:white|black)(?:\/\d{1,3})?\b/g,
  },
  {
    // The `dark:` variant. daisyUI themes replace it entirely.
    name: 'dark-variant',
    pattern: /(?<![\w-])dark:/g,
  },
  {
    // rgb(...) / rgba(...) literals in canvas and inline-style code.
    name: 'rgba-literal',
    pattern: /\brgba?\(/g,
  },
  {
    // Utilities that do not exist in Tailwind v4 and therefore silently no-op:
    //   py-0.2 / px-0.2 / p-0.2  (spacing steps are .5-based)
    //   scale-NNN with NNN outside the real v4 scale steps
    //     (0, 50, 75, 90, 95, 100, 105, 110, 125, 150) — any other NNN
    //     (e.g. scale-98, scale-102) is a dead class that renders nothing
    //   z-60..z-69               (z index tops out at z-50)
    //   xs:                      (there is no xs breakpoint)
    // The `xs:` half is written separately with a lookbehind/lookahead so it
    // matches `hidden xs:inline` but NOT the object literal `{ xs: 22 }` used
    // in src/utils/knob.ts. The scale half uses a negative lookahead over the
    // valid values, so arbitrary-value forms like scale-[0.98] never match
    // (the `[` is not a digit).
    name: 'invalid-utility',
    pattern:
      /(?<![\w-])(?:-?p[xytblrse]?-0\.2|scale-(?!0\b|50\b|75\b|90\b|95\b|100\b|105\b|110\b|125\b|150\b)\d+|z-6[0-9])|(?<=["'`\s])xs:(?=[a-z[-])/g,
  },
];

/**
 * Repo-relative paths that are still allowed to contain violations.
 * SHRINKS ONLY. Each migration task deletes its own path here as its red step.
 * Never add a path back, and never add a path that is already clean — the
 * "allowlist contains no already-clean path" test enforces both.
 */
export const ALLOWLIST: readonly string[] = [];

/** Directories never walked, so hex in docs/ or built CSS in dist/ is ignored. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'docs',
  'build',
  'coverage',
  'public',
  'assets',
  '.git',
  '.worktrees',
  '.serena',
]);

const isTestFile = (relPath: string) => /\.test\.tsx?$/.test(relPath);
const isScannable = (relPath: string) => /\.tsx?$/.test(relPath) && !isTestFile(relPath);

/**
 * Line-level exemption: `// theme-guard-ignore: <reason>` on the violating
 * line itself, or on a line immediately above it that is ITSELF a
 * comment-only line (whitespace then `//`, nothing else before it),
 * suppresses every violation on that one line. A bare marker with no reason
 * text does NOT suppress — every exemption must be self-documenting. The
 * marker is matched against the line with string-literal contents masked
 * out, so writing the marker text inside a quoted string cannot suppress
 * anything. This exists for cases like a persisted-data migration table,
 * where a legacy literal must appear verbatim as a lookup key and is never
 * rendered as a className, so a whole-file ALLOWLIST entry would be both
 * too broad and permanent.
 */
const SUPPRESS_PATTERN = /\/\/\s*theme-guard-ignore:\s*\S/;
const COMMENT_ONLY_LINE = /^\s*\/\//;

/**
 * Blank out the contents of every string literal on a line (single/double/
 * template quotes), preserving length and everything outside quotes —
 * including a trailing `//` comment — so line/column offsets still line up.
 */
function maskStringLiterals(line: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;

  while (i < line.length) {
    const ch = line[i];

    if (quote) {
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      out += ' ';
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ' ';
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function isLineSuppressed(rawLines: string[], lineIndex: number): boolean {
  const current = maskStringLiterals(rawLines[lineIndex] ?? '');
  if (SUPPRESS_PATTERN.test(current)) return true;

  if (lineIndex === 0) return false;
  const above = maskStringLiterals(rawLines[lineIndex - 1] ?? '');
  return COMMENT_ONLY_LINE.test(above) && SUPPRESS_PATTERN.test(above);
}

/**
 * Strip `//` line comments and block comments, replacing them with spaces so
 * line numbers and column offsets are preserved. String literals containing
 * `//` (e.g. a URL) are left intact.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i += 1) out += source[i] === '\n' ? '\n' : ' ';
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Scan one file's source. Returns [] for test files (they legitimately assert
 * on legacy class strings) and for anything that is not .ts/.tsx.
 */
export function scanSource(relPath: string, source: string): Violation[] {
  const normalized = relPath.split(sep).join('/');
  if (!isScannable(normalized)) return [];

  const lines = stripComments(source).split('\n');
  const rawLines = source.split('\n');
  const violations: Violation[] = [];

  lines.forEach((line, index) => {
    if (isLineSuppressed(rawLines, index)) return;
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        violations.push({
          line: index + 1,
          rule: rule.name,
          snippet: (rawLines[index] ?? line).trim(),
        });
      }
    }
  });

  return violations;
}

/**
 * Walk `<rootDir>/src` and scan every non-test .ts/.tsx file.
 * Allowlisted files are omitted from the result entirely, so an empty Map
 * means "every non-exempt file is clean".
 */
export function scanRepo(rootDir: string): Map<string, Violation[]> {
  const allow = new Set(ALLOWLIST);
  const results = new Map<string, Violation[]>();
  const srcRoot = join(rootDir, 'src');

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      const rel = relative(rootDir, abs).split(sep).join('/');
      if (!isScannable(rel) || allow.has(rel)) continue;
      const violations = scanSource(rel, readFileSync(abs, 'utf8'));
      if (violations.length > 0) results.set(rel, violations);
    }
  };

  if (!statSync(srcRoot).isDirectory()) {
    throw new Error(`themeTokenGuard: expected a src/ directory at ${srcRoot}`);
  }
  walk(srcRoot);

  return results;
}

/** Human-readable report used by both the test and `bun run check:theme`. */
export function formatReport(results: Map<string, Violation[]>): string {
  const lines: string[] = [];
  for (const [file, violations] of [...results].sort()) {
    lines.push(file);
    for (const v of violations) {
      lines.push(`  ${String(v.line).padStart(4)}  ${v.rule.padEnd(16)}  ${v.snippet}`);
    }
  }
  return lines.join('\n');
}

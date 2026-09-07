/**
 * Verifies the AA contrast floor (4.5:1) for every `--drum-*` /
 * `--drum-*-content` pair, across both themes.
 *
 * Locates each theme's drum-palette block by REAL brace matching from the
 * offset of `--drum-kick`'s own declaration, and asserts exactly one such
 * block exists per theme. That assertion is what would have caught the
 * original ad hoc version of this check: it sliced the file with
 * `css.indexOf('[data-theme="solna-light"]')` running to end-of-file, which
 * silently swallowed the preceding dark block — the "light" measurement was
 * actually reading the dark palette, and reported a pass.
 *
 * Run with: bun scripts/check-drum-contrast.ts
 * Exit code 1 if any pair falls below 4.5:1, or if brace-matching does not
 * find exactly one drum-palette block per theme.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DRUM_TYPES } from '../src/data/drumKits.ts';

const CSS_PATH = fileURLToPath(new URL('../src/index.css', import.meta.url));

const css = readFileSync(CSS_PATH, 'utf8');
// Strip comments but preserve length (and newlines), so every offset below
// still lines up 1:1 with the source file — cheap to keep true, and it means
// a curly brace inside a comment can never be mistaken for a real one.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** The innermost `{ ... }` block, found by real brace matching, containing `idx`. */
function enclosingBlock(idx: number): { start: number; end: number } {
  const stack: number[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') {
      stack.push(i);
    } else if (ch === '}') {
      const start = stack.pop();
      // The first block to close (innermost first, by construction of a
      // brace stack) whose span contains idx is idx's enclosing block.
      if (start !== undefined && start < idx && idx < i) return { start, end: i };
    }
  }
  throw new Error(`no enclosing block found for offset ${idx}`);
}

function themeOfBlock(blockStart: number): 'dark' | 'light' {
  const selector = stripped.slice(Math.max(0, blockStart - 300), blockStart);
  const dark = selector.includes('[data-theme="solna-dark"]');
  const light = selector.includes('[data-theme="solna-light"]');
  if (dark === light) {
    throw new Error(`ambiguous theme for block at offset ${blockStart} (dark=${dark} light=${light})`);
  }
  return dark ? 'dark' : 'light';
}

/** The hex value of an exact `--name: #hex;` declaration inside [blockStart, blockEnd). */
function declarationValue(name: string, blockStart: number, blockEnd: number): string {
  const body = stripped.slice(blockStart, blockEnd);
  const match = body.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!match) throw new Error(`--${name} not found in block [${blockStart}, ${blockEnd})`);
  return match[1];
}

// Find the one dark block and the one light block that declare the drum
// palette, via brace-matching from every `--drum-kick` declaration.
const kickMatches = [...stripped.matchAll(/--drum-kick:\s*#[0-9A-Fa-f]{6}/g)];
const blocksByTheme = new Map<'dark' | 'light', { start: number; end: number }>();
for (const m of kickMatches) {
  const block = enclosingBlock(m.index!);
  const theme = themeOfBlock(block.start);
  if (blocksByTheme.has(theme)) {
    throw new Error(`found more than one ${theme} block declaring --drum-kick`);
  }
  blocksByTheme.set(theme, block);
}
for (const theme of ['dark', 'light'] as const) {
  if (!blocksByTheme.has(theme)) {
    throw new Error(`found no ${theme} block declaring --drum-kick`);
  }
}

// --- WCAG 2.x relative luminance / contrast ratio ---
function lin(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function relativeLuminance(hex: string): number {
  return (
    0.2126 * lin(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * lin(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * lin(parseInt(hex.slice(5, 7), 16))
  );
}
function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let floor = Infinity;
let floorLabel = '';
let failures = 0;

for (const theme of ['dark', 'light'] as const) {
  const block = blocksByTheme.get(theme)!;
  for (const voice of DRUM_TYPES) {
    const fill = declarationValue(`drum-${voice}`, block.start, block.end);
    const content = declarationValue(`drum-${voice}-content`, block.start, block.end);
    const ratio = contrastRatio(fill, content);
    const label = `${theme} ${voice}`;
    console.log(`${label.padEnd(14)} ${ratio.toFixed(3)}`);
    if (ratio < floor) {
      floor = ratio;
      floorLabel = label;
    }
    if (ratio < 4.5) failures += 1;
  }
}

console.log(`FLOOR ${floor.toFixed(3)} at ${floorLabel} ${floor >= 4.5 ? '— clears AA' : '— FAILS AA'}`);

if (failures > 0) {
  console.error(`${failures} pair(s) below the 4.5:1 AA floor`);
  process.exit(1);
}

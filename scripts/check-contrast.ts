/**
 * Verifies the AA contrast floor (4.5:1) for every fill/`-content` pair in the
 * two palettes that carry their own namespace in `src/index.css` — `--drum-*`
 * and `--module-*` — across both themes.
 *
 * Locates each theme's palette block by REAL brace matching from the offset of
 * the palette's anchor declaration (`--drum-kick`, `--module-osc`), and asserts
 * exactly one such block exists per theme. That assertion is what would have
 * caught the original ad hoc version of this check: it sliced the file with
 * `css.indexOf('[data-theme="solna-light"]')` running to end-of-file, which
 * silently swallowed the preceding dark block — the "light" measurement was
 * actually reading the dark palette, and reported a pass.
 *
 * The two palettes name their members differently on purpose. The drum roster
 * is `DRUM_TYPES`, imported from source, because a drum voice exists in code
 * whether or not anyone gave it a colour. The module roster has no equivalent
 * in `src/data/` — the only list is `Knob`'s closed `KnobColor` union, and a
 * CLI gate that imports a React component to learn a list of colours is worse
 * than one that reads the stylesheet it is already parsing. So module names
 * come from the CSS, and the vacuous-pass hole that opens (a palette that
 * declares nothing measures nothing and "passes") is closed by asserting the
 * two themes declare exactly the same module set, and that the set is not
 * empty. A module colour added to one theme only is a failure here, not a
 * silent skip.
 *
 * Run with: bun scripts/check-contrast.ts
 * Exit code 1 if any pair falls below 4.5:1, if brace-matching does not find
 * exactly one block per palette per theme, or if the two themes disagree about
 * which module colours exist.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DRUM_TYPES } from '../src/data/drumKits.ts';

const CSS_PATH = fileURLToPath(new URL('../src/index.css', import.meta.url));
const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

const css = readFileSync(CSS_PATH, 'utf8');
// Strip comments but preserve length (and newlines), so every offset below
// still lines up 1:1 with the source file — cheap to keep true, and it means
// a curly brace inside a comment can never be mistaken for a real one.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

interface Block {
  start: number;
  end: number;
}

/** The innermost `{ ... }` block, found by real brace matching, containing `idx`. */
function enclosingBlock(idx: number): Block {
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

function themeOfBlock(blockStart: number): Theme {
  const selector = stripped.slice(Math.max(0, blockStart - 300), blockStart);
  const dark = selector.includes('[data-theme="solna-dark"]');
  const light = selector.includes('[data-theme="solna-light"]');
  if (dark === light) {
    throw new Error(`ambiguous theme for block at offset ${blockStart} (dark=${dark} light=${light})`);
  }
  return dark ? 'dark' : 'light';
}

/** The hex value of an exact `--name: #hex;` declaration inside [blockStart, blockEnd). */
function declarationValue(name: string, block: Block): string {
  const body = stripped.slice(block.start, block.end);
  const match = body.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!match) throw new Error(`--${name} not found in block [${block.start}, ${block.end})`);
  return match[1];
}

/**
 * The one dark block and the one light block declaring `anchor`, found by
 * brace-matching from every declaration of it.
 */
function paletteBlocks(anchor: string): Map<Theme, Block> {
  const anchors = [...stripped.matchAll(new RegExp(`--${anchor}:\\s*#[0-9A-Fa-f]{6}`, 'g'))];
  const blocksByTheme = new Map<Theme, Block>();
  for (const m of anchors) {
    const block = enclosingBlock(m.index!);
    const theme = themeOfBlock(block.start);
    if (blocksByTheme.has(theme)) {
      throw new Error(`found more than one ${theme} block declaring --${anchor}`);
    }
    blocksByTheme.set(theme, block);
  }
  for (const theme of THEMES) {
    if (!blocksByTheme.has(theme)) throw new Error(`found no ${theme} block declaring --${anchor}`);
  }
  return blocksByTheme;
}

/**
 * The module names a block declares a 6-digit fill for. `-content` is the ink
 * measured against the fill and `-tint` is the same fill at 10% as an 8-digit
 * hex; neither is a member of the palette.
 */
function moduleNamesIn(block: Block): string[] {
  const body = stripped.slice(block.start, block.end);
  return [...body.matchAll(/--module-([a-z0-9-]+):\s*#[0-9A-Fa-f]{6}\s*;/g)]
    .map((m) => m[1])
    .filter((name) => !name.endsWith('-content') && !name.endsWith('-tint'))
    .sort();
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

const drumBlocks = paletteBlocks('drum-kick');
const moduleBlocks = paletteBlocks('module-osc');

// The module roster comes from the CSS, so it has to agree with itself before
// it can be trusted to say what "the whole palette" is.
const moduleNames = moduleNamesIn(moduleBlocks.get('dark')!);
if (moduleNames.length === 0) throw new Error('the dark module palette declares no fills');
const lightModuleNames = moduleNamesIn(moduleBlocks.get('light')!);
if (moduleNames.join() !== lightModuleNames.join()) {
  throw new Error(
    `the two themes declare different module colours:\n  dark:  ${moduleNames.join(' ')}\n  light: ${lightModuleNames.join(' ')}`,
  );
}

const palettes = [
  { prefix: 'drum', names: DRUM_TYPES as readonly string[], blocks: drumBlocks },
  { prefix: 'module', names: moduleNames, blocks: moduleBlocks },
];

let floor = Infinity;
let floorLabel = '';
let failures = 0;

for (const { prefix, names, blocks } of palettes) {
  for (const theme of THEMES) {
    const block = blocks.get(theme)!;
    for (const name of names) {
      const fill = declarationValue(`${prefix}-${name}`, block);
      const content = declarationValue(`${prefix}-${name}-content`, block);
      const ratio = contrastRatio(fill, content);
      const label = `${theme} ${prefix}-${name}`;
      console.log(`${label.padEnd(22)} ${ratio.toFixed(3)}`);
      if (ratio < floor) {
        floor = ratio;
        floorLabel = label;
      }
      if (ratio < 4.5) failures += 1;
    }
  }
}

console.log(`FLOOR ${floor.toFixed(3)} at ${floorLabel} ${floor >= 4.5 ? '— clears AA' : '— FAILS AA'}`);

if (failures > 0) {
  console.error(`${failures} pair(s) below the 4.5:1 AA floor`);
  process.exit(1);
}

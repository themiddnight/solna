/**
 * R289: no runtime import path from src/audio/playback/plan/ reaches the audio
 * engine singleton or playbackEngine. The planner ESLint block is per-file and
 * cannot see transitive edges — audit A4 existed under an armed block — so this
 * walks the graph. Type-only imports are erased at runtime and cannot
 * instantiate a singleton; Bun.Transpiler.scanImports drops them.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// tsc resolves `bun:test`'s ambient types from @types/node's `node:test` shape (no
// `Bun` global) even though the runtime is real Bun — a pre-existing repo quirk, not
// a DEV-420 concern (see the same shim in renderMixdownGolden.test.ts). This local
// type-only shim describes what Bun.Transpiler actually provides at runtime.
declare const Bun: {
  Transpiler: new (options: { loader: string }) => {
    scanImports(code: string): { path: string }[];
  };
};

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const PLAN_DIR = join(SRC, 'audio/playback/plan');
const ENGINE = join(SRC, 'audio/engine.ts');
const FORBIDDEN = new Set([ENGINE, join(SRC, 'audio/playback/playbackEngine.ts')]);
const TS = new Bun.Transpiler({ loader: 'ts' });
const TSX = new Bun.Transpiler({ loader: 'tsx' });
const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** A resolved source file, or null for a bare package / non-TS asset (a leaf). */
function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return null;
  if (/\.tsx?$/.test(base) && existsSync(base)) return base;
  for (const suffix of CANDIDATE_SUFFIXES) {
    if (existsSync(base + suffix)) return base + suffix;
  }
  return null;
}

/** Breadth-first runtime reachability; each reached file maps to its importer. */
function reach(starts: string[]): Map<string, string | null> {
  const parent = new Map<string, string | null>(starts.map((s) => [s, null]));
  const queue = [...starts];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const transpiler = file.endsWith('.tsx') ? TSX : TS;
    for (const { path } of transpiler.scanImports(readFileSync(file, 'utf8'))) {
      const target = resolveSpecifier(file, path);
      if (target === null || parent.has(target)) continue;
      parent.set(target, file);
      queue.push(target);
    }
  }
  return parent;
}

function chain(parent: Map<string, string | null>, file: string): string {
  const out: string[] = [];
  for (let f: string | null = file; f !== null; f = parent.get(f) ?? null) out.unshift(relative(ROOT, f));
  return out.join(' -> ');
}

function plannerFiles(): string[] {
  return readdirSync(PLAN_DIR)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(PLAN_DIR, name));
}

describe('playback planner runtime import graph (R289)', () => {
  test('no planner reaches audio/engine or playbackEngine at runtime', () => {
    const parent = reach(plannerFiles());
    const offending = [...parent.keys()].filter((f) => FORBIDDEN.has(f)).map((f) => chain(parent, f));
    expect(offending).toEqual([]);
  });

  test('positive control: the walker does reach the engine from chordPlayback.ts', () => {
    const parent = reach([join(SRC, 'audio/playback/chordPlayback.ts')]);
    expect(parent.has(ENGINE)).toBe(true);
  });

  test('the walker starts from at least the known planners', () => {
    const names = plannerFiles().map((f) => relative(PLAN_DIR, f));
    // The repo's bun:test shim (src/types/bun-test.d.ts) types `expect` as a
    // plain function with no static members, so `arrayContaining` needs a
    // local cast rather than a change to that shared ambient module.
    const expectWithArrayContaining = expect as typeof expect & {
      arrayContaining(sample: unknown[]): unknown;
    };
    expect(names).toEqual(expectWithArrayContaining.arrayContaining(['chordPlan.ts', 'padPlan.ts', 'melodyPlan.ts']));
  });
});

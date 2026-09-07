/**
 * The committed proof that the three `src/data/` bans are actually armed.
 *
 * Every row below was measured by hand while the spec was written (see
 * "Enforcement in eslint.config.js"). This test is what KEEPS them measured:
 * the whole "a helper in src/data/ is pure by construction" argument rests on
 * three rules that live in a config file, and a config file is exactly the kind
 * of thing an eslint or typescript-eslint upgrade loosens silently — a renamed
 * option, a changed `allowTypeImports` default, a selector that stops matching.
 *
 * Severity is asserted, not just presence. `bun run verify` tolerates warnings,
 * so a block that landed at 'warn' would pass a presence-only test and enforce
 * nothing. The global `no-restricted-syntax` entry this block replaces is now
 * 'error' too, but that is the global entry's business: this block sets its own
 * severity and nothing propagates one to the other.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

/**
 * A path that does not exist. `lintText` uses it only to resolve which config
 * blocks apply, so no scratch file is left in src/ for a real lint run to pick
 * up. It deliberately does NOT end in `.test.ts`: the block ignores those.
 */
const FIXTURE_PATH = 'src/data/__purityFixture__.ts';

/** The four rule ids the block is responsible for. Everything else is noise. */
const GUARDED = new Set([
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
  'no-restricted-globals',
  'no-restricted-syntax',
]);

const eslint = new ESLint({ cwd: process.cwd() });

async function guardedMessages(source: string) {
  const [result] = await eslint.lintText(source, { filePath: FIXTURE_PATH });
  return (result?.messages ?? [])
    .filter((m) => GUARDED.has(m.ruleId ?? ''))
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const err = (ruleId: string) => ({ ruleId, severity: 2 });
const IMPORT_BAN = '@typescript-eslint/no-restricted-imports';

describe('src/data/ import ban', () => {
  test('a type-only import is allowed', async () => {
    expect(
      await guardedMessages(
        "import type { MeterId } from '@/utils/meter';\nexport const M: MeterId = '4/4';\n",
      ),
    ).toEqual([]);
  });

  test('a value import from another folder is an error', async () => {
    expect(
      await guardedMessages(
        "import { METERS } from '../utils/meter';\nexport const M = METERS;\n",
      ),
    ).toContainEqual(err(IMPORT_BAN));
  });

  test('an aliased value import is an error', async () => {
    expect(
      await guardedMessages(
        "import { SCALES } from '@/utils/musicTheory';\nexport const S = SCALES;\n",
      ),
    ).toContainEqual(err(IMPORT_BAN));
  });

  test('a bare package import is an error', async () => {
    expect(
      await guardedMessages("import { Note } from 'tonal';\nexport const N = Note;\n"),
    ).toContainEqual(err(IMPORT_BAN));
  });

  // The independent-leaf invariant: src/data/ files may not read each other
  // either, so the folder has no evaluation graph and no temporal-dead-zone
  // failure mode. Nothing in the design needs a carve-out for this.
  test('a same-folder sibling import is an error', async () => {
    expect(
      await guardedMessages("import { SIB } from './sibling';\nexport const S = SIB;\n"),
    ).toContainEqual(err(IMPORT_BAN));
  });
});

describe('src/data/ impure-global ban', () => {
  test('Math is an error', async () => {
    expect(await guardedMessages('export const seed = Math.random();\n')).toContainEqual(
      err('no-restricted-globals'),
    );
  });

  test('Date is an error', async () => {
    expect(await guardedMessages('export const t = Date.now();\n')).toContainEqual(
      err('no-restricted-globals'),
    );
  });

  // The block REPLACES the global no-restricted-globals entry, so it has to
  // re-declare confirm/alert/prompt or they are silently un-banned here.
  test('confirm is still an error', async () => {
    expect(await guardedMessages("export const ok = confirm('x');\n")).toContainEqual(
      err('no-restricted-globals'),
    );
  });

  // Scope-aware: a local binding that shadows a banned name is untouched, which
  // is why this is no-restricted-globals and not an Identifier selector.
  test('a local binding named performance is allowed', async () => {
    expect(
      await guardedMessages(
        'const row = (performance: number) => ({ performance });\nexport const T = [row(1)];\n',
      ),
    ).toEqual([]);
  });
});

describe('src/data/ stateless-literal ban', () => {
  test('new is an error', async () => {
    expect(await guardedMessages('export const m = new Map();\n')).toContainEqual(
      err('no-restricted-syntax'),
    );
  });

  test('a function declaration is an error', async () => {
    expect(await guardedMessages('export function f() { return 1; }\n')).toContainEqual(
      err('no-restricted-syntax'),
    );
  });

  test('a module-scope let is an error', async () => {
    expect(await guardedMessages('let n = 0;\nexport const T = [n];\n')).toContainEqual(
      err('no-restricted-syntax'),
    );
  });

  // The export form is a child of ExportNamedDeclaration, not of Program, so a
  // single `Program >` selector misses it. This row is why there are two.
  test('an exported module-scope let is an error', async () => {
    expect(await guardedMessages('export let n = 0;\n')).toContainEqual(
      err('no-restricted-syntax'),
    );
  });

  // The allowed helper. A rule that rejects this is the rule mis-copied: `step`
  // is a shorter spelling of an object literal and the three bans above make it
  // pure, total and deterministic whatever it is written to do.
  test('a const arrow helper and a call to it are allowed', async () => {
    expect(
      await guardedMessages(
        'const step = (d: number) => ({ degree: d });\nexport const T = [step(0), step(1)];\n',
      ),
    ).toEqual([]);
  });

  test('satisfies and as const are untouched', async () => {
    expect(
      await guardedMessages(
        "export const T = { a: 1 } satisfies Record<string, number>;\nexport const U = ['x'] as const;\n",
      ),
    ).toEqual([]);
  });
});

describe('src/data/ inherits the global bans it replaces', () => {
  // The block replaces the global no-restricted-syntax entry, which carries
  // the React.FC and `../../` bans. Those are as true inside src/data/ as
  // anywhere, and the replacement must re-declare them — at 'error', which a
  // replacement block does not inherit.
  test('a ../../ import is an error, not a warning', async () => {
    expect(
      await guardedMessages(
        "import type { X } from '../../types';\nexport const T: X | null = null;\n",
      ),
    ).toContainEqual(err('no-restricted-syntax'));
  });
});

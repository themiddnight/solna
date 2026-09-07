/**
 * What changed in DRUM_GRIDS (per grid, per row, as step indices) and in
 * DRUM_KITS (per kit, per voice, per parameter), between a git rev and the
 * working tree.
 *
 *   bun run report:drums-diff <baseline-commit>
 *
 * A REPORT, NOT AN ASSERTION. It always exits 0 and is deliberately not part of
 * `bun run verify` — same rule as `report:library`. A changed drum row is a
 * fact about content, not a defect; asserting on the set of changes would mean
 * editing the assertion every time content is edited, which is a test that
 * asserts nothing.
 *
 * It exists because the drum-grid genre-accuracy work rewrites ten grids and
 * authors nine, and a reviewer cannot read that as thirty screens of booleans.
 * Its output is quoted in the commit message of the row-editing commits, and
 * that quote is the record of which changes were the intended corrections and
 * which were not intended at all.
 *
 * THERE IS NO SNAPSHOT FILE, ON PURPOSE. The "before" side is read straight out
 * of git at a pinned commit. A checked-in snapshot is a file in the working
 * tree, and any later edit — including the very edit it exists to check — can
 * regenerate it silently. A git object cannot drift.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DRUM_GRIDS, type DrumGrid } from '../src/data/drumGrids.ts';
import { DEFAULT_DRUM_KIT, DRUM_KITS } from '../src/data/drumKits.ts';

/**
 * The "before" side, as a git rev. REQUIRED, and deliberately not a default:
 * the previous hardcoded value went stale the moment the work it was pinned to
 * merged, and a stale default makes the report answer a question nobody asked
 * while looking exactly like a report that works.
 *
 * Pass the last commit before the work you are reporting on:
 *   bun run report:drums-diff 457de72
 */
const BASELINE = Bun.argv[2];
const TABLE_PATH = 'src/data/drumGrids.ts';
const KIT_TABLE_PATH = 'src/data/drumKits.ts';

if (!BASELINE) {
  console.log('Usage: bun run report:drums-diff <baseline-commit>');
  console.log('');
  console.log('  <baseline-commit>  any git rev. The "before" side is read straight out of');
  console.log('                     git, so there is no snapshot file that can drift.');
  console.log('');
  console.log('No baseline given — nothing to diff against. This is still a clean exit.');
  process.exit(0);
}

/**
 * Whether BASELINE resolves to a real commit at all. An invalid rev (a typo,
 * a rev that never existed) and a valid rev that merely predates one of the
 * two tables are different failures with different fixes — one means "check
 * what you typed", the other means "this file didn't exist yet" — so they
 * must not print the same sentence. Checked once, up front, before either
 * table is read.
 */
const BASELINE_VALID =
  Bun.spawnSync(['git', 'rev-parse', '--verify', `${BASELINE}^{commit}`]).exitCode === 0;

const on = (row: boolean[] | undefined): number[] =>
  (row ?? []).map((hit, i) => (hit ? i : -1)).filter((i) => i >= 0);

const fmt = (steps: number[]): string => (steps.length === 0 ? '(silent)' : steps.join(','));

function reportGrid(id: string, before: DrumGrid, after: DrumGrid): string[] {
  const lines: string[] = [];
  const rows = [...new Set([...Object.keys(before.rows), ...Object.keys(after.rows)])].sort();
  for (const row of rows) {
    const b = on(before.rows[row]);
    const a = on(after.rows[row]);
    if (b.join(',') === a.join(',') && row in before.rows === row in after.rows) continue;
    if (!(row in before.rows)) {
      lines.push(`    + row ${row.padEnd(8)} ${fmt(a)}`);
    } else if (!(row in after.rows)) {
      lines.push(`    - row ${row.padEnd(8)} ${fmt(b)}`);
    } else {
      const added = a.filter((i) => !b.includes(i));
      const removed = b.filter((i) => !a.includes(i));
      lines.push(`      ${row.padEnd(8)} ${fmt(b)}  ->  ${fmt(a)}`);
      lines.push(`               on: ${fmt(added)}   off: ${fmt(removed)}`);
    }
  }
  if (before.provenance !== after.provenance) {
    lines.push(`      provenance  ${before.provenance}  ->  ${after.provenance}`);
  }
  return lines;
}

let shown: ReturnType<typeof Bun.spawnSync> | undefined;
if (BASELINE_VALID) shown = Bun.spawnSync(['git', 'show', `${BASELINE}:${TABLE_PATH}`]);

if (!BASELINE_VALID) {
  console.log(`${BASELINE} is not a valid git revision — check what you typed.`);
  console.log('Nothing to diff against. This is still a clean exit.');
} else if (!shown || shown.exitCode !== 0) {
  console.log(`Cannot read ${BASELINE}:${TABLE_PATH} — it did not exist at that rev.`);
  console.log('Nothing to diff against. This is still a clean exit.');
} else {
  // The type-only imports are erased at runtime and `@/` will not resolve from
  // a temp directory, so drop every import line. `DrumGrid` is declared in the
  // same file; `MeterId` survives as an annotation Bun never checks.
  const source = shown.stdout
    .toString()
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n');
  // Everything from here down can fail (an unwritable tmpdir, a baseline that
  // no longer parses or imports cleanly) and none of it may crash the report:
  // the contract is "stdout only, exit code always 0". The temp dir is
  // created and torn down in the same try/finally so it is removed on every
  // path, success or failure — nothing else in this file may leave one behind.
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'solna-drum-diff-'));
    const file = join(dir, 'baselineDrumGrids.ts');
    writeFileSync(file, source, 'utf8');
    const mod = (await import(pathToFileURL(file).href)) as { DRUM_GRIDS: Record<string, DrumGrid> };
    const before = mod.DRUM_GRIDS;
    const after = DRUM_GRIDS;

    console.log(`DRUM_GRIDS, ${BASELINE} -> working tree.`);
    console.log('A report, not a check — this always exits 0.\n');
    console.log(`  entries: ${Object.keys(before).length} -> ${Object.keys(after).length}\n`);

    const added = Object.keys(after).filter((id) => !(id in before));
    const removed = Object.keys(before).filter((id) => !(id in after));
    const shared = Object.keys(after).filter((id) => id in before);

    for (const id of removed) {
      console.log(`  - ${id}  DELETED`);
      for (const [row, steps] of Object.entries(before[id].rows)) {
        console.log(`      ${row.padEnd(8)} ${fmt(on(steps))}`);
      }
      console.log('');
    }
    for (const id of added) {
      console.log(`  + ${id}  NEW  (${after[id].meter}, ${after[id].kit})`);
      console.log(`      provenance  ${after[id].provenance}`);
      for (const [row, steps] of Object.entries(after[id].rows)) {
        if (on(steps).length === 0) continue;
        console.log(`      ${row.padEnd(8)} ${fmt(on(steps))}`);
      }
      console.log('');
    }
    let changed = 0;
    for (const id of shared) {
      const lines = reportGrid(id, before[id], after[id]);
      if (lines.length === 0) continue;
      changed += 1;
      console.log(`  ~ ${id}`);
      for (const line of lines) console.log(line);
      console.log('');
    }
    console.log(
      `  ${removed.length} deleted, ${added.length} new, ${changed} changed, ` +
        `${shared.length - changed} untouched.`,
    );
    console.log('\nA changed row is content, not a defect. What this report is FOR is');
    console.log('spotting the row you did not mean to touch, in the same pass as the');
    console.log('ones you did.');
  } catch (err) {
    // An unparseable or unimportable baseline is the same kind of "nothing to
    // diff against" as a failed `git show` above — report it and exit clean.
    console.log(
      `Cannot build a comparable baseline from ${BASELINE}:${TABLE_PATH}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    console.log('Nothing to diff against. This is still a clean exit.');
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// --- DRUM_KITS: per kit, per voice, per parameter -------------------------
// A second, self-contained block with its own temp dir. It deliberately does
// NOT share the grid block's scaffolding: the contract is "stdout only, exit
// code always 0" for each half independently, and a kit-side failure must not
// take the working grid report down with it. Six duplicated lines is the
// cheaper of the two risks in a script that asserts nothing.

type Voices = Record<string, Record<string, number>>;

/**
 * mergeDrumKit's one-level-per-voice spread, rewritten locally on purpose.
 * Importing mergeDrumKit would merge the OLD table against TODAY's default and
 * against today's fixed list of voice names, so a slice that adds a voice would
 * report it as unchanged.
 */
const mergeVoices = (def: Voices, partial: Voices): Voices => {
  const out: Voices = {};
  // 'reference' is DRUM_KITS-entry documentation (DrumKitReference), not a
  // voice — Object.keys(def) never has it (DEFAULT_DRUM_KIT is pure engine
  // params) but Object.keys(partial) always does now, so it must be dropped
  // here or every kit reports a phantom "reference" voice changed.
  for (const voice of new Set([...Object.keys(def), ...Object.keys(partial)].filter((k) => k !== 'reference'))) {
    out[voice] = { ...(def[voice] ?? {}), ...(partial[voice] ?? {}) };
  }
  return out;
};

const val = (v: number | undefined): string => (v === undefined ? '-' : String(v));

/**
 * Where a merged value came from: the kit's own literal, or DEFAULT_DRUM_KIT.
 * Without this column a slice that adds a voice or a field to the DEFAULT makes
 * every parameter of every kit change at once, and the report is unreadable
 * exactly when it matters most. With it, a reader collapses the `inherited`
 * rows and is left with what someone actually typed.
 */
const originOf = (partial: Voices, voice: string, param: string): string =>
  partial[voice] !== undefined && param in partial[voice] ? 'kit' : 'inherited';

function reportKit(
  before: Voices,
  after: Voices,
  beforePartial: Voices,
  afterPartial: Voices,
): string[] {
  const lines: string[] = [];
  for (const voice of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const b = before[voice] ?? {};
    const a = after[voice] ?? {};
    const params = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    const changed = params.filter((p) => b[p] !== a[p]);
    if (changed.length === 0) continue;
    lines.push(`      ${voice}`);
    for (const p of changed) {
      const from = originOf(beforePartial, voice, p);
      const to = originOf(afterPartial, voice, p);
      const origin = from === to ? to : `${from} -> ${to}`;
      lines.push(
        `        ${p.padEnd(16)} ${val(b[p]).padStart(9)}  ->  ${val(a[p]).padStart(9)}` +
          `   [${origin}]`,
      );
    }
  }
  return lines;
}

{
  let kitDir: string | undefined;
  try {
    let shownKits: ReturnType<typeof Bun.spawnSync> | undefined;
    if (BASELINE_VALID) shownKits = Bun.spawnSync(['git', 'show', `${BASELINE}:${KIT_TABLE_PATH}`]);

    if (!BASELINE_VALID) {
      console.log(`\n${BASELINE} is not a valid git revision — check what you typed.`);
      console.log('No kit-value diff. This is still a clean exit.');
    } else if (!shownKits || shownKits.exitCode !== 0) {
      console.log(`\nCannot read ${BASELINE}:${KIT_TABLE_PATH} — it did not exist at that rev.`);
      console.log('No kit-value diff. This is still a clean exit.');
    } else {
      kitDir = mkdtempSync(join(tmpdir(), 'solna-kit-diff-'));
      const source = shownKits.stdout
        .toString()
        .split('\n')
        .filter((line) => !line.startsWith('import '))
        .join('\n');
      const file = join(kitDir, 'baselineDrumKits.ts');
      writeFileSync(file, source, 'utf8');
      const mod = (await import(pathToFileURL(file).href)) as {
        DEFAULT_DRUM_KIT: Voices;
        DRUM_KITS: Record<string, Voices>;
      };

      const beforePartials = mod.DRUM_KITS;
      const afterPartials = DRUM_KITS as unknown as Record<string, Voices>;
      const before: Record<string, Voices> = {};
      for (const [name, partial] of Object.entries(beforePartials)) {
        before[name] = mergeVoices(mod.DEFAULT_DRUM_KIT, partial);
      }
      const after: Record<string, Voices> = {};
      const todayDefault = DEFAULT_DRUM_KIT as unknown as Voices;
      for (const [name, partial] of Object.entries(afterPartials)) {
        after[name] = mergeVoices(todayDefault, partial);
      }

      console.log(`\nDRUM_KITS, ${BASELINE} -> working tree.`);
      console.log('Values are MERGED (default + override), so a DEFAULT_DRUM_KIT change shows');
      console.log('in every kit that does not override it. A missing value prints as "-", and');
      console.log('the [kit] / [inherited] column says whether the kit typed that value or got');
      console.log('it from DEFAULT_DRUM_KIT — collapse the inherited rows to see the authoring.\n');
      console.log(`  kits: ${Object.keys(before).length} -> ${Object.keys(after).length}\n`);

      const allKitNames = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      let changedKits = 0;
      for (const name of allKitNames) {
        if (!(name in before)) {
          console.log(`  + ${name}  NEW KIT\n`);
          changedKits += 1;
          continue;
        }
        if (!(name in after)) {
          console.log(`  - ${name}  DELETED\n`);
          changedKits += 1;
          continue;
        }
        const lines = reportKit(
          before[name],
          after[name],
          beforePartials[name],
          afterPartials[name],
        );
        if (lines.length === 0) continue;
        changedKits += 1;
        console.log(`  ~ ${name}`);
        for (const line of lines) console.log(line);
        console.log('');
      }
      console.log(`  ${changedKits} of ${allKitNames.length} kits changed.`);
      console.log('A changed kit parameter is a fact about content, not a defect.');
    }
  } catch (err) {
    console.log(
      `\nCannot build a comparable kit baseline from ${BASELINE}:${KIT_TABLE_PATH}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    console.log('Nothing to diff against. This is still a clean exit.');
  } finally {
    if (kitDir) rmSync(kitDir, { recursive: true, force: true });
  }
}

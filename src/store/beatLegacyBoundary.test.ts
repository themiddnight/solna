import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LOOP_FLAT_KEYS } from './loop';

/**
 * The boundary between "the Beat instrument" and "the drum state it replaced".
 *
 * Canonical loop state is exactly `beatParams`, `beatPattern` and `beatMix`.
 * The seven names below are the state that used to hold the same information,
 * and after this task they exist NOWHERE in `src/` except inside the one
 * converter that reads old input: `sanitizeBeat.ts` (`readBeatState` and its
 * private helpers), the test that covers it, and this guard.
 *
 * Three properties of this check are deliberate and must not be softened.
 *
 * THE ALLOWLIST IS LITERAL AND EXACT — three file paths, spelled out. It is
 * not a prefix, not a glob and not "any file whose name contains sanitize".
 * Adding a second compatibility reader anywhere therefore turns this suite red
 * and has to be argued for in review rather than merged as a one-line
 * addition, which is the entire point of writing the list this way.
 *
 * A MENTION IN A COMMENT COUNTS. Nothing here strips comments before matching:
 * a comment naming `sequencerTracks` as though it still existed is stale
 * documentation about state the reader cannot find, and the cheapest moment to
 * fix it is the moment the field goes. The history of the rename is recorded
 * once, in `sanitizeBeat.ts` and in `CLAUDE.md` — neither of which this scans
 * for the first reason and the second respectively.
 *
 * MATCHING IS CASE-INSENSITIVE, because the derived names are where a survivor
 * would actually hide: `setDrumFilterCutoff`, `toggleDrumMuted` and
 * `setSequencerTracks` do not contain their field's name with its original
 * capital, so a case-sensitive scan would wave every legacy ACTION straight
 * through while claiming the fields were gone.
 */
const FORBIDDEN_NAMES = [
  'soundKit',
  'drumFilterCutoff',
  'drumFilterResonance',
  'drumFilterType',
  'masterSequencerVolume',
  'drumMuted',
  'sequencerTracks',
] as const;

/** Exactly three paths, relative to the repository root. Literal, never derived. */
const ALLOWED_PATHS: readonly string[] = [
  'src/store/sanitizeBeat.ts',
  'src/store/sanitizeBeat.test.ts',
  'src/store/beatLegacyBoundary.test.ts',
];

const SRC_ROOT = new URL('../', import.meta.url).pathname;
const REPO_ROOT = new URL('../../', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('the legacy Beat field names exist in exactly three files', () => {
  test('no other source in src/ mentions one, in code or in a comment', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const path = relative(REPO_ROOT, file);
      if (ALLOWED_PATHS.includes(path)) continue;
      const lower = readFileSync(file, 'utf8').toLowerCase();
      const found = FORBIDDEN_NAMES.filter((name) => lower.includes(name.toLowerCase()));
      if (found.length > 0) offenders.push(`${path}: ${found.join(', ')}`);
    }
    // Printed one per line so a failure names every remaining reference at
    // once rather than one per run.
    expect(offenders.join('\n')).toBe('');
  });

  /**
   * The allowlist itself: every path on it must exist and must actually carry
   * a legacy name. An entry that has gone stale — a file deleted, or a reader
   * that no longer reads anything old — would otherwise sit there widening the
   * boundary for nothing, and the next file to take that name would inherit a
   * permission nobody granted it.
   */
  test('every allowlisted path exists and is really a legacy reader', () => {
    for (const path of ALLOWED_PATHS) {
      const lower = readFileSync(join(REPO_ROOT, path), 'utf8').toLowerCase();
      const found = FORBIDDEN_NAMES.filter((name) => lower.includes(name.toLowerCase()));
      expect([path, found.length > 0]).toEqual([path, true]);
    }
  });
});

describe('LOOP_FLAT_KEYS names the Beat model and nothing it replaced', () => {
  test('it carries all three canonical Beat keys', () => {
    for (const key of ['beatParams', 'beatPattern', 'beatMix']) {
      expect([key, (LOOP_FLAT_KEYS as readonly string[]).includes(key)]).toEqual([key, true]);
    }
  });

  test('it carries none of the legacy keys', () => {
    const keys = LOOP_FLAT_KEYS as readonly string[];
    expect(FORBIDDEN_NAMES.filter((name) => keys.includes(name))).toEqual([]);
  });

  /**
   * The ten mixer keys that are NOT legacy and must survive this task. They
   * are listed here because an earlier draft of the deletion described the
   * legacy set as a RANGE of the key list rather than as seven names, and that
   * range swallowed every one of these. A loop that silently lost its mixer
   * would read back at the defaults with nothing failing.
   */
  test('the per-loop mixer keys are untouched', () => {
    const keys = LOOP_FLAT_KEYS as readonly string[];
    for (const key of [
      'synthVolume', 'synthMuted', 'chordVolume', 'chordMuted', 'bassVolume',
      'bassMuted', 'padVolume', 'padMuted', 'fxVolume', 'fxMuted',
    ]) {
      expect([key, keys.includes(key)]).toEqual([key, true]);
    }
  });
});

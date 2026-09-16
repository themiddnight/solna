/**
 * Where a note name becomes a frequency (DEV-399).
 *
 * The ESLint block in eslint.config.js proves the ENGINE cannot resolve a
 * pitch. This proves the complementary half: the resolution happens at a
 * SHORT, REVIEWED list of controller boundaries rather than drifting back
 * across the app one convenience call at a time. A new entry here is a
 * decision a reviewer sees, which is the whole point — it is an allowlist, not
 * a count.
 *
 * Test files are excluded: a test may resolve a pitch to state its own
 * expectation, and several do.
 *
 * The walker covers `src/` AND `scripts/`, not `src/` alone. The ESLint gate
 * this guard complements is `src/**`-scoped (see eslint.config.js's final
 * block), but `scripts/calibration/renderOffline.ts` genuinely resolves a
 * pitch too — it drives the real engine's `triggerSynthNoteOn` for the
 * calibration harness and has to pass it a frequency the same way any other
 * caller does. Narrowing this test's scope to match the ESLint gate's `src/`
 * boundary would leave that call site checked by neither: it would be free to
 * grow a second, silent conversion with nothing here or in ESLint noticing.
 * `scripts/` already shares one test runner with `src/` — `bun test` (and
 * therefore `bun run verify`) picks up `scripts/calibration/*.test.ts` and
 * `scripts/themeTokenGuard.test.ts` the same way it picks up every `src/`
 * test — so scanning it here is extending an existing convention, not
 * inventing a second one.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every non-test module permitted to name `noteFrequency`. Each is a
 * controller that owns a scheduling decision and therefore owns resolving the
 * pitch for it — the live/MIDI bridge, the sequenced-note bridge, the arp, the
 * chord/bass/pad scheduler, the auditions, the offline mixdown renderer, and
 * the calibration harness, which schedules the same kind of material outside
 * `src/` entirely.
 */
const BOUNDARY = [
  'src/utils/musicTheory.ts', // where it is DEFINED
  'src/audio/playback/synthPlayback.ts',
  'src/audio/playback/playbackEngine.ts',
  'src/audio/playback/arpPlayback.ts',
  'src/audio/playback/chordPlayback.ts',
  'src/audio/playback/presetPreview.ts',
  'src/audio/export/renderMixdown.ts',
  'scripts/calibration/renderOffline.ts',
];

// Same walker idiom as src/store/beatLegacyBoundary.test.ts, which is the same
// kind of guard: a LITERAL allowlist over a source scan.
const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const SRC_ROOT = join(REPO_ROOT, 'src');
const SCRIPTS_ROOT = join(REPO_ROOT, 'scripts');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Non-test production-ish source paths under `src/` and `scripts/`, repo-relative. */
function productionSources(): string[] {
  return [...sourceFiles(SRC_ROOT), ...sourceFiles(SCRIPTS_ROOT)]
    .map((file) => relative(REPO_ROOT, file))
    .filter((path) => !path.includes('.test.'));
}

describe('the frequency-resolution boundary (DEV-399)', () => {
  test('only the approved controllers name noteFrequency', () => {
    const found = productionSources().filter((path) =>
      readFileSync(join(REPO_ROOT, path), 'utf8').includes('noteFrequency'),
    );
    expect(found.sort()).toEqual([...BOUNDARY].sort());
  });

  test('no file under src/audio/synth/ resolves a pitch at all', () => {
    const offenders = productionSources().filter(
      (path) =>
        path.startsWith('src/audio/synth/') &&
        readFileSync(join(REPO_ROOT, path), 'utf8').includes('noteFrequency'),
    );
    expect(offenders).toEqual([]);
  });
});

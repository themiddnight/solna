/**
 * The committed proof that DEV-397's planner purity block is armed.
 *
 * "A planner performs no store writes, engine calls, AudioContext reads or
 * wall-clock/global reads" is an argument that rests entirely on a config file,
 * and a config file is exactly what an ESLint upgrade loosens silently. Same
 * idiom as src/data/dataLayerPurity.test.ts and notePatternGuard.test.ts:
 * severity is asserted too, because `bun run verify` tolerates warnings and a
 * block that landed at 'warn' would enforce nothing.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

const PLANNER = 'src/audio/playback/plan/__purityFixture__.ts';
/** A file under src/audio/ that is NOT a planner, to prove the block is scoped. */
const NEIGHBOUR = 'src/audio/playback/chordPlayback.ts';

async function messagesFor(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null)
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const ENGINE_IMPORT = "import { audioEngine } from '@/audio/engine';\nexport const e = audioEngine;\n";
const STORE_IMPORT = "import { useAppStore } from '@/store/store';\nexport const s = useAppStore;\n";
const CLOCK_READ = 'export const now = Date.now();\n';
const TIMER = 'export const t = () => setTimeout(() => {}, 0);\n';
/**
 * The natural way a file inside src/audio/playback/plan/ reaches
 * src/audio/playback/playbackEngine.ts — the same relative idiom the
 * planners already use for '../chordPlayback' and '../padPlayback'. A
 * one-level `../` import does not trip the file-wide `../../` ban, so the
 * planner purity block must ban this specifically.
 */
const RELATIVE_PLAYBACK_ENGINE_IMPORT =
  "import { playbackNoteOn } from '../playbackEngine';\nexport const p = playbackNoteOn;\n";

describe('playback planner purity guard (DEV-397)', () => {
  test('importing the engine from a planner is an error', async () => {
    expect(await messagesFor(ENGINE_IMPORT, PLANNER)).toContainEqual({
      ruleId: 'no-restricted-imports',
      severity: 2,
    });
  });

  test('importing the store from a planner is an error', async () => {
    expect(await messagesFor(STORE_IMPORT, PLANNER)).toContainEqual({
      ruleId: 'no-restricted-imports',
      severity: 2,
    });
  });

  test('reading the wall clock from a planner is an error', async () => {
    expect(await messagesFor(CLOCK_READ, PLANNER)).toContainEqual({
      ruleId: 'no-restricted-globals',
      severity: 2,
    });
  });

  test('arming a timer from a planner is an error', async () => {
    expect(await messagesFor(TIMER, PLANNER)).toContainEqual({
      ruleId: 'no-restricted-globals',
      severity: 2,
    });
  });

  test('importing the engine from a planner via the relative form is also an error', async () => {
    expect(await messagesFor(RELATIVE_PLAYBACK_ENGINE_IMPORT, PLANNER)).toContainEqual({
      ruleId: 'no-restricted-imports',
      severity: 2,
    });
  });

  test('the block is SCOPED: the engine import is fine in its playback neighbour', async () => {
    const messages = await messagesFor(ENGINE_IMPORT, NEIGHBOUR);
    expect(messages).not.toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
  });

  test('the wider audio bans still apply inside the planner folder', async () => {
    // The narrower block REPLACES the broader rule rather than merging with it,
    // so every list it overrides has to be spread back in. These two prove it.
    expect(await messagesFor("import { note } from 'tonal';\nexport const n = note;\n", PLANNER))
      .toContainEqual({ ruleId: 'no-restricted-imports', severity: 2 });
    expect(await messagesFor('export const r = Math.random();\n', PLANNER))
      .toContainEqual({ ruleId: 'no-restricted-syntax', severity: 2 });
  });
});

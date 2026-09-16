/**
 * The committed proof that DEV-392's note-regex reintroduction guard is armed.
 * See eslint.config.js's NOTE_REGEX_BAN and the two blocks that apply it, and
 * docs/superpowers/plans/2026-09-16-dev-392-centralize-pitch-and-scale-lookup.md.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

const GUARDED = new Set(['no-restricted-syntax']);

async function guardedMessages(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => GUARDED.has(m.ruleId ?? ''))
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const err = (ruleId: string) => ({ ruleId, severity: 2 });
const NOTE_REGEX_SOURCE = "export const RE = /^([A-G]#?)(-?\\d+)$/;\n";

describe('note-regex reintroduction guard (DEV-392)', () => {
  test('a new regex literal in melodyGrid.ts is an error', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/components/loop/lead/melodyGrid.ts'),
    ).toContainEqual(err('no-restricted-syntax'));
  });

  test('a new regex literal in Keyboard.tsx is an error', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/components/ui/Keyboard.tsx'),
    ).toContainEqual(err('no-restricted-syntax'));
  });

  test('a new regex literal in musicTheory.ts is an error', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/utils/musicTheory.ts'),
    ).toContainEqual(err('no-restricted-syntax'));
  });

  test('a new regex literal in bassPatterns.ts is an error, and the Math.random ban still applies too', async () => {
    const messages = await guardedMessages(NOTE_REGEX_SOURCE, 'src/audio/bassPatterns.ts');
    expect(messages).toContainEqual(err('no-restricted-syntax'));
    const randomMessages = await guardedMessages(
      "export const R = Math.random();\n",
      'src/audio/bassPatterns.ts',
    );
    expect(randomMessages).toContainEqual(err('no-restricted-syntax'));
  });

  test('a new regex literal in leadStepRecord.ts is an error', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/audio/leadStepRecord.ts'),
    ).toContainEqual(err('no-restricted-syntax'));
  });

  test('a regex literal elsewhere in src/audio/ is unaffected (the guard is scoped, not global)', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/audio/synth/subtractiveVoice.ts'),
    ).toEqual([]);
  });

  test('src/musicCore/tonalAdapter.ts — where octaveOfNote/pitchClassOfNote actually live — is unaffected', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/musicCore/tonalAdapter.ts'),
    ).toEqual([]);
  });
});

/**
 * Committed proof that the src/incidents/** privacy block is armed at severity
 * error (verify tolerates warnings). Same idiom as playbackPlannerPurity.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });
const FILE = 'src/incidents/__privacyFixture__.ts';

async function messagesFor(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null)
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const BAN = { ruleId: 'no-restricted-imports', severity: 2 };

describe('incident privacy boundary', () => {
  const cases: [string, string][] = [
    ['store (aliased)', "import { useAppStore } from '@/store/store';\nexport const s = useAppStore;\n"],
    ['store (relative)', "import { useAppStore } from '../store/store';\nexport const s = useAppStore;\n"],
    ['component (aliased)', "import { Modal } from '@/components/ui/Modal';\nexport const m = Modal;\n"],
    ['engine (aliased)', "import { audioEngine } from '@/audio/engine';\nexport const e = audioEngine;\n"],
    ['engine (relative)', "import { audioEngine } from '../audio/engine';\nexport const e = audioEngine;\n"],
  ];
  for (const [name, source] of cases) {
    test(`importing ${name} is an error`, async () => {
      expect(await messagesFor(source, FILE)).toContainEqual(BAN);
    });
  }

  test('the block is scoped: the same store import elsewhere in src/utils is not this rule', async () => {
    const msgs = await messagesFor(
      "import { useAppStore } from '@/store/store';\nexport const s = useAppStore;\n",
      'src/store/__neighbourFixture__.ts',
    );
    expect(msgs).not.toContainEqual(BAN);
  });
});

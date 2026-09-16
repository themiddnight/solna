/**
 * The committed proof that DEV-395's `tonal`-confinement gate is armed.
 *
 * `src/data/dataLayerPurity.test.ts` proves the src/data/ bans; this file is
 * its sibling for the one new axis DEV-395 adds, which spans src/utils/,
 * src/audio/ and src/store/ at once and therefore does not belong inside any
 * single folder's own test. See
 * docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md
 * for the contract this test enforces and the allowlist rationale.
 *
 * The allowlist below is deliberately EXACT and LITERAL — six file paths,
 * copied from the contract doc, not a glob and not "anything under src/audio/
 * that already imports tonal". DEV-394 shrinks this list to the Tonal
 * adapter's own file(s); until then, a new tonal import anywhere else is a
 * red gate a reviewer sees, not a silent pass.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

/** Rule ids this file's assertions care about; everything else is noise. */
const GUARDED = new Set(['no-restricted-imports']);

async function guardedMessages(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => GUARDED.has(m.ruleId ?? ''))
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const err = (ruleId: string) => ({ ruleId, severity: 2 });
const TONAL_IMPORT = "import { Note } from 'tonal';\nexport const N = Note;\n";

describe('tonal import confinement (DEV-395)', () => {
  test('a new src/audio/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/audio/newDspHelper.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('the allowlisted src/audio/arpeggiator.ts may still import tonal', async () => {
    const messages = await guardedMessages(TONAL_IMPORT, 'src/audio/arpeggiator.ts');
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  test('src/audio/arpeggiator.ts is still banned from importing store/ (layering rule 1 survives the carve-out)', async () => {
    expect(
      await guardedMessages(
        "import { useAppStore } from '@/store/store';\nexport const S = useAppStore;\n",
        'src/audio/arpeggiator.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/store/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/store/newSlice.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('the allowlisted src/store/midiInput.ts may still import tonal', async () => {
    const messages = await guardedMessages(TONAL_IMPORT, 'src/store/midiInput.ts');
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  test('src/store/midiInput.ts is still banned from importing components/ (layering rule 2 survives the carve-out)', async () => {
    expect(
      await guardedMessages(
        "import { Keyboard } from '@/components/ui/Keyboard';\nexport const K = Keyboard;\n",
        'src/store/midiInput.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('the allowlisted src/utils/noteSpelling.ts may still import tonal', async () => {
    const messages = await guardedMessages(TONAL_IMPORT, 'src/utils/noteSpelling.ts');
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  test('a new src/utils/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/utils/someOtherHelper.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/components/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/components/loop/SomeView.tsx'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('VolumeFader.tsx importing tonal is still an error (its taper-ban carve-out does not exempt it from this one)', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/components/ui/VolumeFader.tsx'),
    ).toContainEqual(err('no-restricted-imports'));
  });
});

/**
 * The committed proof that DEV-394's Tonal-adapter confinement is armed.
 *
 * Supersedes DEV-395's six-file allowlist test: DEV-394 moved every
 * production Tonal call site behind src/musicCore/tonalAdapter.ts, so the
 * only file with a tonal exemption left is that one. See
 * docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md
 * (updated by DEV-394) for the contract this test enforces.
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

describe('musicCore layering (DEV-394)', () => {
  test('the adapter, src/musicCore/tonalAdapter.ts, may still import tonal', async () => {
    const messages = await guardedMessages(TONAL_IMPORT, 'src/musicCore/tonalAdapter.ts');
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  test('a new src/musicCore/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/musicCore/chordQuality.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('src/musicCore/tonalAdapter.ts is still banned from importing store/', async () => {
    expect(
      await guardedMessages(
        "import { useAppStore } from '@/store/store';\nexport const S = useAppStore;\n",
        'src/musicCore/tonalAdapter.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('src/musicCore/ is banned from importing components/', async () => {
    expect(
      await guardedMessages(
        "import { Keyboard } from '@/components/ui/Keyboard';\nexport const K = Keyboard;\n",
        'src/musicCore/chordQuality.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('src/musicCore/ is banned from importing src/audio/ (Music Core must not read the engine)', async () => {
    expect(
      await guardedMessages(
        "import { audioEngine } from '@/audio/engine';\nexport const E = audioEngine;\n",
        'src/musicCore/chordQuality.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('src/musicCore/tonalAdapter.ts is also banned from importing src/audio/', async () => {
    expect(
      await guardedMessages(
        "import { audioEngine } from '@/audio/engine';\nexport const E = audioEngine;\n",
        'src/musicCore/tonalAdapter.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('the six original call sites are no longer allowlisted for tonal', async () => {
    for (const file of [
      'src/utils/noteSpelling.ts',
      'src/utils/musicTheory.ts',
      'src/audio/arpeggiator.ts',
      'src/audio/bassPatterns.ts',
      'src/audio/playback/padPlayback.ts',
      'src/store/midiInput.ts',
    ]) {
      expect(await guardedMessages(TONAL_IMPORT, file)).toContainEqual(err('no-restricted-imports'));
    }
  });
});

describe('tonal import confinement outside musicCore (DEV-394)', () => {
  test('src/audio/arpeggiator.ts is still banned from importing store/ (layering rule 1)', async () => {
    expect(
      await guardedMessages(
        "import { useAppStore } from '@/store/store';\nexport const S = useAppStore;\n",
        'src/audio/arpeggiator.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('src/store/midiInput.ts is still banned from importing components/ (layering rule 2)', async () => {
    expect(
      await guardedMessages(
        "import { Keyboard } from '@/components/ui/Keyboard';\nexport const K = Keyboard;\n",
        'src/store/midiInput.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/audio/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/audio/newDspHelper.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/store/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/store/newSlice.ts'),
    ).toContainEqual(err('no-restricted-imports'));
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

  test('src/utils/noteSpelling.ts is still banned by TAPER_CONVERSION_BAN (DEV-386 taper ban survives)', async () => {
    expect(
      await guardedMessages(
        "import { dbToSliderPos } from '@/utils/gainUnits';\nexport const F = dbToSliderPos;\n",
        'src/utils/noteSpelling.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });
});

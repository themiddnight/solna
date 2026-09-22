/**
 * R314 (DEV-422): src/audio/ imports neither react nor react-dom. The ban is
 * spread into each of the four src/audio/ import blocks, because every block
 * that sets the rule REPLACES the broader one — one file per block here.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

/** renderMidi.ts's block uses the TS-aware rule id, so both are guarded. */
const GUARDED = new Set(['no-restricted-imports', '@typescript-eslint/no-restricted-imports']);

async function importErrors(source: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((m) => GUARDED.has(m.ruleId ?? '') && m.severity === 2).length;
}

const REACT = "import { useEffect } from 'react';\nexport const E = useEffect;\n";
const REACT_DOM = "import { createPortal } from 'react-dom';\nexport const P = createPortal;\n";
const REACT_DOM_SERVER = "import { renderToString } from 'react-dom/server';\nexport const R = renderToString;\n";

describe('src/audio/ imports no react (R314)', () => {
  for (const filePath of [
    'src/audio/playback/x.ts',
    'src/audio/playback/plan/x.ts',
    'src/audio/export/renderMidi.ts',
    'src/audio/masterRack.ts',
  ]) {
    test(`react is an error at ${filePath}`, async () => {
      expect(await importErrors(REACT, filePath)).toBeGreaterThan(0);
    });
  }

  test('react-dom and its subpaths are errors too', async () => {
    expect(await importErrors(REACT_DOM, 'src/audio/playback/x.ts')).toBeGreaterThan(0);
    expect(await importErrors(REACT_DOM_SERVER, 'src/audio/playback/x.ts')).toBeGreaterThan(0);
  });

  test('a component-layer controller may import react', async () => {
    expect(await importErrors(REACT, 'src/components/playback/x.ts')).toBe(0);
  });
});

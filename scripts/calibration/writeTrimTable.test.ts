import { describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTrimTableSource } from './writeTrimTable.ts';

const DRUMS = {
  'Retro Drive': { measuredDbfs: -12.4, trimDb: -5.6, configHash: 'aaa' },
};
const PRESETS = { 'factory-cosmic-lead': { measuredDbfs: -24.1, trimDb: 6.1, configHash: 'bbb' } };

describe('renderTrimTableSource', () => {
  test('marks the file generated and names the command that regenerates it', () => {
    const source = renderTrimTableSource(DRUMS, PRESETS);
    expect(source).toContain('GENERATED FILE — do not hand-edit');
    expect(source).toContain('bun run calibration:generate');
  });

  test('emits the contract surface verbatim', () => {
    const source = renderTrimTableSource(DRUMS, PRESETS);
    expect(source).toContain('export interface TrimEntry {');
    expect(source).toContain('export const DRUM_TRIMS: Record<string, TrimEntry> = {');
    expect(source).toContain('export const PRESET_TRIMS: Record<string, TrimEntry> = {');
  });

  test('emits every entry with its measurement alongside its trim, so a diff shows what moved and why', () => {
    const source = renderTrimTableSource(DRUMS, PRESETS);
    expect(source).toContain('measuredDbfs: -12.4, trimDb: -5.6, configHash: "aaa"');
    expect(source).toContain('measuredDbfs: -24.1, trimDb: 6.1, configHash: "bbb"');
  });

  test('holds nothing src/data/ forbids: no import, no new, no function, no impure global', () => {
    const source = renderTrimTableSource(DRUMS, PRESETS);
    // The line-start anchors keep prose in the header comment from matching.
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toMatch(/\bnew /);
    expect(source).not.toMatch(/^(export )?function /m);
    expect(source).not.toMatch(/\b(Math|Date|crypto)\./);
  });

  test('sorts kits and presets, so a re-run reorders nothing and the diff stays readable', () => {
    const source = renderTrimTableSource(
      { Zed: DRUMS['Retro Drive'], Alpha: DRUMS['Retro Drive'] },
      { 'z-preset': PRESETS['factory-cosmic-lead'], 'a-preset': PRESETS['factory-cosmic-lead'] },
    );
    expect(source.indexOf('"Alpha"')).toBeLessThan(source.indexOf('"Zed"'));
    expect(source.indexOf('"a-preset"')).toBeLessThan(source.indexOf('"z-preset"'));
  });
});

describe('numeric formatting', () => {
  test('rounds measuredDbfs and trimDb to 2 decimal places', () => {
    const source = renderTrimTableSource(
      {},
      {
        'rounded-preset': {
          measuredDbfs: -12.399999999999999,
          trimDb: 5.016,
          configHash: 'ccc',
        },
      },
    );
    expect(source).toContain('measuredDbfs: -12.4, trimDb: 5.02, configHash: "ccc"');
  });
});

describe('round trip', () => {
  test('writing the rendered source and re-rendering the parsed table yields identical bytes', async () => {
    const drums = {
      Zed: { measuredDbfs: -12.4, trimDb: -5.6, configHash: 'aaa' },
      Alpha: { measuredDbfs: -9.03, trimDb: -8.97, configHash: 'ddd' },
      Warehouse: { measuredDbfs: -20.11, trimDb: 2.11, configHash: 'eee' },
    };
    const presets = {
      'z-preset': { measuredDbfs: -24.1, trimDb: 6.1, configHash: 'bbb' },
      'a-preset': { measuredDbfs: -17.5, trimDb: -0.5, configHash: 'fff' },
    };

    const firstSource = renderTrimTableSource(drums, presets);
    const dir = dirname(fileURLToPath(import.meta.url));
    const tempPath = `${dir}/__roundTripFixture__.${Date.now()}.ts`;
    writeFileSync(tempPath, firstSource);

    try {
      const imported = (await import(tempPath)) as {
        DRUM_TRIMS: Record<string, { measuredDbfs: number; trimDb: number; configHash: string }>;
        PRESET_TRIMS: Record<string, { measuredDbfs: number; trimDb: number; configHash: string }>;
      };
      const secondSource = renderTrimTableSource(imported.DRUM_TRIMS, imported.PRESET_TRIMS);
      expect(secondSource).toBe(firstSource);
    } finally {
      rmSync(tempPath);
    }
  });
});

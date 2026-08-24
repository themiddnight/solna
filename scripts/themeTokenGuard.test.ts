import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWLIST, RULES, scanRepo, scanSource } from './themeTokenGuard';

const rulesOf = (source: string) =>
  scanSource('src/components/Fixture.tsx', source).map((v) => v.rule);

describe('scanSource — raw-hex', () => {
  test('flags a hex literal in a Tailwind arbitrary value', () => {
    expect(rulesOf('const c = "bg-[#12152A] border-[#252B48]";')).toContain('raw-hex');
  });

  test('flags a hex literal in an SVG presentation attribute', () => {
    expect(rulesOf('<rect stroke="#252B48" fill="#0B0D19" />')).toContain('raw-hex');
  });

  test('flags a hex literal in a canvas strokeStyle assignment', () => {
    expect(rulesOf("ctx.strokeStyle = '#6ee7b7';")).toContain('raw-hex');
  });

  test('does not flag a semantic class string', () => {
    expect(rulesOf('const c = "bg-base-100 border-base-300";')).not.toContain('raw-hex');
  });
});

describe('scanSource — palette-color', () => {
  test('flags indigo-500', () => {
    expect(rulesOf('const c = "bg-indigo-500 text-slate-400";')).toContain('palette-color');
  });

  test('flags a palette color inside a template literal with an opacity suffix', () => {
    expect(rulesOf('const c = `ring-emerald-500/30 from-rose-500`;')).toContain('palette-color');
  });

  test('does not flag base-100 / base-200 / base-300', () => {
    expect(rulesOf('const c = "bg-base-100 bg-base-200 border-base-300";')).not.toContain(
      'palette-color',
    );
  });

  test('does not flag a bare numeric utility like gap-500 on a non-color word', () => {
    expect(rulesOf('const c = "grid-cols-12 delay-500";')).not.toContain('palette-color');
  });
});

describe('scanSource — absolute-bw', () => {
  test('flags text-white', () => {
    expect(rulesOf('const c = "bg-indigo-600 text-white";')).toContain('absolute-bw');
  });

  test('flags bg-black with an opacity modifier', () => {
    expect(rulesOf('const c = "fixed inset-0 bg-black/70";')).toContain('absolute-bw');
  });

  test('does not flag text-primary-content', () => {
    expect(rulesOf('const c = "bg-primary text-primary-content";')).not.toContain('absolute-bw');
  });

  test('does not flag the word white inside an identifier', () => {
    expect(rulesOf('const whiteKeyIndex = 3;')).not.toContain('absolute-bw');
  });
});

describe('scanSource — dark-variant', () => {
  test('flags a dark: variant', () => {
    expect(rulesOf('const c = "text-purple-600 dark:text-purple-400";')).toContain('dark-variant');
  });

  test('does not flag the substring dark inside darkMode or a URL fragment', () => {
    expect(rulesOf('const darkMode = true; const u = "https://x.dev/dark";')).not.toContain(
      'dark-variant',
    );
  });
});

describe('scanSource — rgba-literal', () => {
  test('flags rgba(', () => {
    expect(rulesOf("ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';")).toContain('rgba-literal');
  });

  test('flags rgb(', () => {
    expect(rulesOf("el.style.color = 'rgb(0 0 0)';")).toContain('rgba-literal');
  });

  test('does not flag oklch() or a CSS var lookup', () => {
    expect(rulesOf("const c = 'oklch(var(--color-primary))';")).not.toContain('rgba-literal');
  });
});

describe('scanSource — invalid-utility', () => {
  test('flags py-0.2 (not a real Tailwind spacing step)', () => {
    expect(rulesOf('const c = "px-1.5 py-0.2 rounded";')).toContain('invalid-utility');
  });

  test('flags scale-102 (not a real Tailwind scale step)', () => {
    expect(rulesOf('const c = "shadow-2xl scale-102";')).toContain('invalid-utility');
  });

  test('flags ANY dead scale-NNN value, e.g. scale-98', () => {
    expect(rulesOf('const c = "shadow-lg scale-98";')).toContain('invalid-utility');
  });

  const VALID_SCALE_VALUES = ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150'];
  for (const value of VALID_SCALE_VALUES) {
    test(`does not flag the real Tailwind v4 scale value scale-${value}`, () => {
      expect(rulesOf(`const c = "scale-${value}";`)).not.toContain('invalid-utility');
    });
  }

  test('flags z-60 (Tailwind tops out at z-50)', () => {
    expect(rulesOf('const c = "fixed inset-0 z-60";')).toContain('invalid-utility');
  });

  test('flags the undeclared xs: breakpoint variant', () => {
    expect(rulesOf('const c = "hidden xs:inline";')).toContain('invalid-utility');
  });

  test('does not flag a size-key object literal that happens to be named xs', () => {
    expect(rulesOf('export const SIZE_PX = { xs: 22, sm: 36, md: 48 };')).not.toContain(
      'invalid-utility',
    );
  });

  test('does not flag valid utilities py-0.5, scale-105, z-50, text-xs', () => {
    expect(rulesOf('const c = "py-0.5 scale-105 z-50 text-xs";')).not.toContain('invalid-utility');
  });
});

describe('scanSource — mechanics', () => {
  test('ignores single-line and block comments', () => {
    const src = [
      '// legacy was bg-[#12152A] with text-white',
      '/* and dark:bg-indigo-500 */',
      'const c = "bg-base-100";',
    ].join('\n');
    expect(scanSource('src/components/Fixture.tsx', src)).toHaveLength(0);
  });

  test('reports a 1-based line number and a trimmed snippet', () => {
    const src = ['const a = 1;', 'const c = "bg-indigo-500";'].join('\n');
    const [violation] = scanSource('src/components/Fixture.tsx', src);
    expect(violation.line).toBe(2);
    expect(violation.snippet).toBe('const c = "bg-indigo-500";');
  });

  test('returns nothing for a *.test.tsx path even when the source is dirty', () => {
    expect(scanSource('src/components/Fixture.test.tsx', 'const c = "text-white";')).toHaveLength(0);
  });

  test('exposes one entry per rule name', () => {
    expect(RULES.map((r) => r.name).sort()).toEqual([
      'absolute-bw',
      'dark-variant',
      'invalid-utility',
      'palette-color',
      'raw-hex',
      'rgba-literal',
    ]);
  });
});

describe('scanSource — theme-guard-ignore suppression', () => {
  test('suppresses a violation via a same-line marker with a reason', () => {
    const src = "const legacy = 'bg-rose-500'; // theme-guard-ignore: persisted legacy lookup key";
    expect(scanSource('src/components/Fixture.tsx', src)).toHaveLength(0);
  });

  test('suppresses a violation via a marker on the line immediately above', () => {
    const src = [
      '// theme-guard-ignore: persisted legacy lookup key',
      "const legacy = 'bg-rose-500';",
    ].join('\n');
    expect(scanSource('src/components/Fixture.tsx', src)).toHaveLength(0);
  });

  test('a bare marker with no reason does not suppress', () => {
    const src = "const legacy = 'bg-rose-500'; // theme-guard-ignore";
    expect(rulesOf(src)).toContain('palette-color');
  });

  test('suppression does not leak past one line', () => {
    const src = [
      '// theme-guard-ignore: persisted legacy lookup key',
      "const legacy = 'bg-rose-500';",
      "const other = 'bg-indigo-500';",
    ].join('\n');
    const violations = scanSource('src/components/Fixture.tsx', src);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
    expect(violations[0].snippet).toBe("const other = 'bg-indigo-500';");
  });

  test('a same-line trailing marker does not also suppress the line below it', () => {
    const src = [
      "const legacy = 'bg-rose-500'; // theme-guard-ignore: persisted legacy lookup key",
      "const other = 'bg-indigo-500';",
    ].join('\n');
    const violations = scanSource('src/components/Fixture.tsx', src);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].snippet).toBe("const other = 'bg-indigo-500';");
  });

  test('a marker written inside a string literal does not suppress', () => {
    const src =
      'const legacy = \'bg-rose-500 // theme-guard-ignore: fake reason\';';
    expect(rulesOf(src)).toContain('palette-color');
  });
});

describe('scanRepo — every non-allowlisted src file is token-clean', () => {
  test('reports no violations outside the allowlist', () => {
    const results = scanRepo(process.cwd());
    const report = [...results]
      .sort()
      .map(
        ([file, violations]) =>
          `${file}\n` +
          violations.map((v) => `  ${v.line}  ${v.rule}  ${v.snippet}`).join('\n'),
      )
      .join('\n');

    expect(report).toBe('');
  });
});

describe('ALLOWLIST hygiene', () => {
  test('every allowlisted path exists on disk', () => {
    const missing = ALLOWLIST.filter((p) => !existsSync(join(process.cwd(), p)));
    expect(missing).toEqual([]);
  });

  test('no allowlisted path is already clean (delete it instead)', () => {
    const alreadyClean = ALLOWLIST.filter((p) => {
      const source = readFileSync(join(process.cwd(), p), 'utf8');
      return scanSource(p, source).length === 0;
    });
    expect(alreadyClean).toEqual([]);
  });

  test('is sorted and free of duplicates', () => {
    expect([...ALLOWLIST]).toEqual([...new Set(ALLOWLIST)].sort());
  });

  test('does not exempt InstantVibesBar, which is already token-clean', () => {
    expect(ALLOWLIST).not.toContain('src/components/InstantVibesBar.tsx');
  });

  test('shrinks to nothing by the end of the migration', () => {
    // Documents the finish line. Task 22 flips this to toHaveLength(0).
    expect(ALLOWLIST.length).toBeLessThanOrEqual(23);
  });

  test('ALLOWLIST is empty and stays empty', () => {
    // The migration is complete: every src file must pass the guard on its own
    // merits. Re-adding an entry here is how a theme regression gets shipped,
    // so this test exists specifically to make that a visible, deliberate act.
    expect(ALLOWLIST).toEqual([]);
    expect(ALLOWLIST.length).toBe(0);
  });
});

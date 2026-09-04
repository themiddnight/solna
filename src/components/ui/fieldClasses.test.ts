import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { COUNT_BADGE, FIELD_LABEL, FIELD_SELECT, SECTION_HEADER, STEP_BADGE } from './fieldClasses';
import { ICON_BUTTON_BASE } from './IconButton';
import { MODAL_BOX } from './Modal';
import { MODULE_HEADER_ROW, MODULE_TITLE } from './ModuleHeader';
import { PANEL_CARD } from './PanelCard';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [path];
  });
}

describe('field label token', () => {
  test('is the plain muted 10px form, not a section header', () => {
    expect(FIELD_LABEL).toContain('text-[10px]');
    expect(FIELD_LABEL).toContain('text-base-content/60');
    // design.md §3 keeps uppercase + bold + tracking for SECTION headers.
    expect(FIELD_LABEL).not.toContain('uppercase');
    expect(FIELD_LABEL).not.toContain('font-bold');
    expect(FIELD_SELECT).toContain('select');
  });

  /**
   * daisyUI centres a badge with its own `inline-flex`; a responsive display
   * utility that sets plain `inline` silently drops that centring, and the
   * digits then land wherever the font's line box falls inside the badge's
   * fixed height. It looks like a wash until you measure it — the two library
   * badges were off centre in opposite directions.
   */
  test('a badge is never given a plain inline display', () => {
    expect(COUNT_BADGE).toContain('inline-flex');
    const offenders = sourceFiles('src/components')
      .flatMap((f) => {
        const text = readFileSync(f, 'utf8');
        // className strings that name a badge and override display to `inline`
        const bad = text.match(/[^"'`\n]*\bbadge\b[^"'`\n]*\b[a-z]+:inline(?!-)[^"'`\n]*/g) ?? [];
        return bad.map((m) => `${f}: ${m.trim().slice(0, 70)}`);
      });
    expect(offenders).toEqual([]);
  });

  /**
   * The regression this token exists for: the same label was hand-written in
   * four components and had drifted in opacity, margin and weight. A new
   * inline copy must fail here rather than be noticed a year later.
   */
  test('no component hand-writes a stacked field label', () => {
    const offenders = sourceFiles('src/components')
      .filter((f) => !f.endsWith('fieldClasses.ts'))
      .filter((f) => /text-\[10px\][^"'`]*text-base-content\/\d+[^"'`]*block mb-/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  /**
   * `FIELD_LABEL` is defined as "not the section header", so the string it
   * defers to has to be one string. Six components spelled it out by hand.
   */
  test('no component hand-writes the section header', () => {
    expect(SECTION_HEADER).toContain('uppercase');
    expect(SECTION_HEADER).toContain('font-bold');
    const offenders = sourceFiles('src/components')
      .filter((f) => !f.endsWith('fieldClasses.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes(SECTION_HEADER));
    expect(offenders).toEqual([]);
  });

  /** The ordinal chip on a numbered module card — nine hand-written copies. */
  test('no component hand-writes the module step badge', () => {
    const offenders = sourceFiles('src/components')
      .filter((f) => !f.endsWith('fieldClasses.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes(`"${STEP_BADGE}"`));
    expect(offenders).toEqual([]);
  });

  /**
   * The existing sweep only catches a `text-[10px]` copy. The four components
   * that leaked wrote the same role at 11px and at text-xs, with two different
   * bottom margins — same drift, invisible to a regex pinned to one size.
   */
  test('no component hand-writes a stacked field label at any size', () => {
    const lookalike = /text-(\[1[01]px\]|xs)\s+text-base-content\/\d+[^"'`]*block\s+mb-/;
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('fieldClasses.ts'))
      .filter((f) => lookalike.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  /** design.md §3 reserves this exact combination for SECTION headers. */
  test('no component hand-writes the section header at any opacity', () => {
    const lookalike = /text-xs\s+font-bold\s+uppercase\s+tracking-wider/;
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('fieldClasses.ts'))
      .filter((f) => lookalike.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  /** ui/ModuleHeader owns the card header row and its title — ten copies each. */
  test('no component hand-writes the module header row or title', () => {
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('ModuleHeader.tsx'))
      .filter((f) => {
        const text = readFileSync(f, 'utf8');
        return text.includes(MODULE_HEADER_ROW) || text.includes(MODULE_TITLE);
      });
    expect(offenders).toEqual([]);
  });

  /** ui/PanelCard owns the panel shell — sixteen copies. */
  test('no component hand-writes the panel card shell', () => {
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('PanelCard.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes(PANEL_CARD));
    expect(offenders).toEqual([]);
  });

  /** ui/IconButton owns the icon-only button shape — a new hand-rolled copy must fail here. */
  test('no component hand-writes the icon button shape', () => {
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('IconButton.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes(ICON_BUTTON_BASE));
    expect(offenders).toEqual([]);
  });

  /** ui/Modal owns the dialog box chrome — a new hand-rolled copy must fail here. */
  test('no component hand-writes the modal box chrome', () => {
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('Modal.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes(MODAL_BOX));
    expect(offenders).toEqual([]);
  });
});

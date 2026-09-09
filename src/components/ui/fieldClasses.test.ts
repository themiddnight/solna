import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { COUNT_BADGE, FIELD_LABEL, FIELD_LANE, FIELD_SELECT, HEADER_FIELD_SHELL, HEADER_GROUP, HEADER_SELECT, JOIN_LANE, SECTION_HEADER, STEP_BADGE } from './fieldClasses';
import { ICON_BUTTON_BASE } from './IconButton';
import { MODAL_BOX } from './Modal';
import { MODULE_HEADER_ROW, MODULE_TITLE } from './ModuleHeader';

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

  /**
   * design.md §3 reserves this exact combination for SECTION headers.
   *
   * Checked as a SET of classes inside one string literal, not as an ordered
   * regex. ChordView's progression title spelled the same five classes in a
   * different order — `text-xs font-bold text-base-content uppercase
   * tracking-wider` — and slipped past both guards: the exact-match one
   * because `includes` is order-sensitive, and the old regex here because it
   * required the four tokens adjacent and in that order. Class order is
   * meaningless to CSS, so a guard that depends on it is a guard with a hole.
   */
  test('no component hand-writes the section header, in any class order', () => {
    const required = ['text-xs', 'font-bold', 'uppercase', 'tracking-wider'];
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('fieldClasses.ts'))
      .filter((f) =>
        (readFileSync(f, 'utf8').match(/["'`][^"'`\n]*["'`]/g) ?? []).some((literal) => {
          const classes = new Set(literal.slice(1, -1).split(/\s+/));
          return required.every((c) => classes.has(c));
        }),
      );
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

  /**
   * ui/PanelCard owns the panel shell — sixteen copies.
   *
   * Matched with a regex that stops BEFORE the shadow step, not with
   * `includes(PANEL_CARD)`. An exact-substring guard passes a copy that is one
   * utility off, which is what let the lead grid keep `card bg-panel border
   * border-base-300 shadow-xl` — the shell at a different weight from the Beat
   * segment beside it — while this test stayed green.
   */
  test('no component hand-writes the panel card shell, at any shadow step', () => {
    const shell = /card bg-panel border border-base-300 shadow-/;
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('PanelCard.tsx'))
      .filter((f) => shell.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  /** ui/IconButton owns the icon-only button shape — a new hand-rolled copy must fail here. */
  test('no component hand-writes the icon button shape', () => {
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('IconButton.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes(ICON_BUTTON_BASE));
    expect(offenders).toEqual([]);
  });

  /**
   * ui/Toolbar owns the grid toolbar's action button. The lead grid spelled
   * this string out four times and the drum grid wore a fifth, borderless
   * look for the same role — one job, two appearances, which is exactly the
   * drift the constants above exist to stop.
   */
  test('no component hand-writes the toolbar action button, at any opacity', () => {
    // Any opacity, not just the constant's own: the string was extracted at
    // `/70` while all eleven existing sites spelled it `/60`, so an exact
    // `includes` scan reported a clean toolbar with every copy still in place.
    const idle = /btn-ghost border border-base-300 text-base-content\//;
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('Toolbar.tsx'))
      .filter((f) => idle.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  /** ui/Modal owns the dialog box chrome — a new hand-rolled copy must fail here. */
  test('no component hand-writes the modal box chrome', () => {
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('Modal.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes(MODAL_BOX));
    expect(offenders).toEqual([]);
  });

  /**
   * `JOIN_LANE` had five hand-written copies before it existed — the synth's
   * mode switch and the pad module's four toggle groups. It must stay built on
   * `FIELD_LANE` (that is what puts its label on the shared baseline), and no
   * component may spell the shell out again.
   */
  test('no component hand-writes the join control lane', () => {
    expect(JOIN_LANE.startsWith('join ')).toBe(true);
    expect(JOIN_LANE).toContain(FIELD_LANE);
    // Token-set, not substring: a copy that shuffles the class order is the
    // same copy. `HEADER_GROUP` is a different join shell (`p-1 shrink-0`, no
    // lane height) and is correctly not a superset of this one.
    const lane = new Set(JOIN_LANE.split(' '));
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('fieldClasses.ts'))
      .flatMap((f) => {
        const strings = readFileSync(f, 'utf8').match(/["'`][^"'`\n]*\bjoin\b[^"'`\n]*["'`]/g) ?? [];
        return strings
          .filter((raw) => {
            const tokens = new Set(raw.slice(1, -1).trim().split(/\s+/));
            return [...lane].every((t) => tokens.has(t));
          })
          .map((raw) => `${f}: ${raw.slice(0, 70)}`);
      });
    expect(offenders).toEqual([]);
  });

  /**
   * The navbar's own two tokens. `HEADER_FIELD_SHELL` was written out inline
   * around the key/scale pair while it had one caller; the loop picker is the
   * second, and the project name the third. `HEADER_SELECT` carries
   * `appearance-none`, which is the difference between a long label
   * ellipsising and it painting over the chevron — a copy that drops it looks
   * identical until a name runs long.
   */
  test('no component hand-writes the header field shell or select', () => {
    expect(HEADER_SELECT).toContain('appearance-none');
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('fieldClasses.ts'))
      .flatMap((f) => {
        const text = readFileSync(f, 'utf8');
        const strings = text.match(/["'`][^"'`\n]*["'`]/g) ?? [];
        return strings
          .filter((raw) => {
            const tokens = new Set(raw.slice(1, -1).trim().split(/\s+/));
            // Token-set, not substring: class order is meaningless to CSS, so
            // a reordered copy is the same copy.
            return [HEADER_FIELD_SHELL, HEADER_SELECT].some((token) =>
              token.split(' ').every((c) => tokens.has(c)),
            );
          })
          .map((raw) => `${f}: ${raw.slice(0, 70)}`);
      });
    expect(offenders).toEqual([]);
  });

  /**
   * The header shell has four callers — the layer switcher, the tab bar,
   * Pattern's segment row and Sound's Simple/Pro switch — and its whole job is
   * that all four are the same height. It lived as a private const in
   * `Header.tsx` while only that file used it; a fifth caller spelling it out
   * again is the drift this scan stops.
   */
  test('no component hand-writes the header group shell', () => {
    const shell = new Set(HEADER_GROUP.split(' '));
    const offenders = sourceFiles('src')
      .filter((f) => !f.endsWith('fieldClasses.ts'))
      .flatMap((f) => {
        const strings = readFileSync(f, 'utf8').match(/["'`][^"'`\n]*\bjoin\b[^"'`\n]*["'`]/g) ?? [];
        return strings
          .filter((raw) => {
            const tokens = new Set(raw.slice(1, -1).trim().split(/\s+/));
            return [...shell].every((t) => tokens.has(t));
          })
          .map((raw) => `${f}: ${raw.slice(0, 70)}`);
      });
    expect(offenders).toEqual([]);
  });
});

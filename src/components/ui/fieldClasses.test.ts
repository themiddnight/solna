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

/** Every string literal on one line — a className in practice. */
const stringLiterals = (text: string): string[] => text.match(/["'`][^"'`\n]*["'`]/g) ?? [];

/**
 * The files under `dir` a guard reports against, formatted as `path: excerpt`.
 * `owner` is the file that legitimately defines the token being scanned for, so
 * it is the one file every scan excludes.
 */
function offenders(dir: string, owner: string, find: (text: string) => string[]): string[] {
  return sourceFiles(dir)
    .filter((path) => !path.endsWith(owner))
    .flatMap((path) => find(readFileSync(path, 'utf8')).map((hit) => `${path}: ${hit.slice(0, 70)}`));
}

/** The guard for an exact-string token: `includes` is the whole check. */
const containing = (token: string) => (text: string): string[] => (text.includes(token) ? [token] : []);

/**
 * Literals carrying every class of any one of `tokenGroups`. Checked as a SET
 * rather than as an ordered substring: class order is meaningless to CSS, so a
 * reordered copy is the same copy. ChordView's progression title spelled the
 * section header's five classes in a different order and slipped past both an
 * `includes` check and an order-sensitive regex.
 */
function literalsCarrying(text: string, ...tokenGroups: string[][]): string[] {
  return stringLiterals(text).filter((raw) => {
    const classes = new Set(raw.slice(1, -1).trim().split(/\s+/));
    return tokenGroups.some((tokens) => tokens.every((c) => classes.has(c)));
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
   * The regression this token exists for: the same label was hand-written in
   * four components and had drifted in opacity, margin and weight. A new
   * inline copy must fail here rather than be noticed a year later.
   */
  test('no component hand-writes a stacked field label', () => {
    const copy = (text: string): string[] =>
      text.match(/text-\[10px\][^"'`]*text-base-content\/\d+[^"'`]*block mb-/) ?? [];
    expect(offenders('src/components', 'fieldClasses.ts', copy)).toEqual([]);
  });

  /**
   * The existing sweep only catches a `text-[10px]` copy. The four components
   * that leaked wrote the same role at 11px and at text-xs, with two different
   * bottom margins — same drift, invisible to a regex pinned to one size.
   */
  test('no component hand-writes a stacked field label at any size', () => {
    const lookalike = /text-(\[1[01]px\]|xs)\s+text-base-content\/\d+[^"'`]*block\s+mb-/;
    const copy = (text: string): string[] => {
      const hit = text.match(lookalike);
      return hit ? [hit[0]] : [];
    };
    expect(offenders('src', 'fieldClasses.ts', copy)).toEqual([]);
  });
});

describe('section header token', () => {
  /**
   * `FIELD_LABEL` is defined as "not the section header", so the string it
   * defers to has to be one string. Six components spelled it out by hand.
   */
  test('no component hand-writes the section header', () => {
    expect(SECTION_HEADER).toContain('uppercase');
    expect(SECTION_HEADER).toContain('font-bold');
    expect(offenders('src/components', 'fieldClasses.ts', containing(SECTION_HEADER))).toEqual([]);
  });

  /** design.md §3 reserves this exact combination for SECTION headers. */
  test('no component hand-writes the section header, in any class order', () => {
    const header = ['text-xs', 'font-bold', 'uppercase', 'tracking-wider'];
    expect(offenders('src', 'fieldClasses.ts', (text) => literalsCarrying(text, header))).toEqual([]);
  });
});

describe('module chrome', () => {
  /**
   * daisyUI centres a badge with its own `inline-flex`; a responsive display
   * utility that sets plain `inline` silently drops that centring, and the
   * digits then land wherever the font's line box falls inside the badge's
   * fixed height. It looks like a wash until you measure it — the two library
   * badges were off centre in opposite directions.
   */
  test('a badge is never given a plain inline display', () => {
    expect(COUNT_BADGE).toContain('inline-flex');
    const overridden = (text: string): string[] =>
      text.match(/[^"'`\n]*\bbadge\b[^"'`\n]*\b[a-z]+:inline(?!-)[^"'`\n]*/g)?.map((m) => m.trim()) ?? [];
    expect(offenders('src/components', 'fieldClasses.ts', overridden)).toEqual([]);
  });

  /** The ordinal chip on a numbered module card — nine hand-written copies. */
  test('no component hand-writes the module step badge', () => {
    expect(offenders('src/components', 'fieldClasses.ts', containing(`"${STEP_BADGE}"`))).toEqual([]);
  });

  /** ui/ModuleHeader owns the card header row and its title — ten copies each. */
  test('no component hand-writes the module header row or title', () => {
    const header = (text: string): string[] =>
      [MODULE_HEADER_ROW, MODULE_TITLE].filter((token) => text.includes(token));
    expect(offenders('src', 'ModuleHeader.tsx', header)).toEqual([]);
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
    const copy = (text: string): string[] => {
      const hit = text.match(shell);
      return hit ? [hit[0]] : [];
    };
    expect(offenders('src', 'PanelCard.tsx', copy)).toEqual([]);
  });
});

describe('button and dialog chrome', () => {
  /** ui/IconButton owns the icon-only button shape — a new hand-rolled copy must fail here. */
  test('no component hand-writes the icon button shape', () => {
    expect(offenders('src', 'IconButton.tsx', containing(ICON_BUTTON_BASE))).toEqual([]);
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
    const copy = (text: string): string[] => {
      const hit = text.match(idle);
      return hit ? [hit[0]] : [];
    };
    expect(offenders('src', 'Toolbar.tsx', copy)).toEqual([]);
  });

  /** ui/Modal owns the dialog box chrome — a new hand-rolled copy must fail here. */
  test('no component hand-writes the modal box chrome', () => {
    expect(offenders('src', 'Modal.tsx', containing(MODAL_BOX))).toEqual([]);
  });
});

describe('shell tokens', () => {
  /**
   * `JOIN_LANE` had five hand-written copies before it existed — the synth's
   * mode switch and the pad module's four toggle groups. It must stay built on
   * `FIELD_LANE` (that is what puts its label on the shared baseline), and no
   * component may spell the shell out again.
   */
  test('no component hand-writes the join control lane', () => {
    expect(JOIN_LANE.startsWith('join ')).toBe(true);
    expect(JOIN_LANE).toContain(FIELD_LANE);
    // Token-set, not substring. `HEADER_GROUP` is a different join shell
    // (`p-1 shrink-0`, no lane height) and is correctly not a superset of this
    // one: carrying the `join` token is what a copy of this lane must do.
    const lane = JOIN_LANE.split(' ');
    expect(offenders('src', 'fieldClasses.ts', (text) => literalsCarrying(text, lane))).toEqual([]);
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
    const shells = [HEADER_FIELD_SHELL.split(' '), HEADER_SELECT.split(' ')];
    expect(offenders('src', 'fieldClasses.ts', (text) => literalsCarrying(text, ...shells))).toEqual([]);
  });

  /**
   * The header shell has four callers — the layer switcher, the tab bar,
   * Pattern's segment row and Sound's Simple/Pro switch — and its whole job is
   * that all four are the same height. It lived as a private const in
   * `Header.tsx` while only that file used it; a fifth caller spelling it out
   * again is the drift this scan stops.
   */
  test('no component hand-writes the header group shell', () => {
    const shell = HEADER_GROUP.split(' ');
    expect(offenders('src', 'fieldClasses.ts', (text) => literalsCarrying(text, shell))).toEqual([]);
  });
});

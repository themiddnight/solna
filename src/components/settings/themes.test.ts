import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import {
  parseThemeChoice,
  resolveTheme,
  themeChoiceLabel,
  themeEntry,
  THEMES,
  themesOfScheme,
} from './themes';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
/** Comments removed: index.css mentions `solna-light` in prose. */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector list (split on commas) of a rule whose selector names `[data-theme="<id>"]`. */
function selectorListsNaming(id: string): string[][] {
  const needle = `[data-theme="${id}"]`;
  const lists: string[][] = [];
  let at = stripped.indexOf(needle);
  while (at !== -1) {
    const start = stripped.lastIndexOf('}', at) + 1;
    const end = stripped.indexOf('{', at);
    lists.push(stripped.slice(start, end).split(',').map((s) => s.trim()));
    at = stripped.indexOf(needle, end);
  }
  return lists;
}

const attr = (id: string) => `[data-theme="${id}"]`;

describe('parseThemeChoice', () => {
  test('legacy stored values are valid choices as-is', () => {
    expect(parseThemeChoice('solna-dark')).toBe('solna-dark');
    expect(parseThemeChoice('solna-light')).toBe('solna-light');
  });

  test('any registry id is a choice', () => {
    expect(parseThemeChoice('dracula')).toBe('dracula');
    expect(parseThemeChoice('light')).toBe('light');
  });

  test("'system', null, empty and unknown values all parse to 'system'", () => {
    for (const stored of ['system', null, '', 'murva-dark', 'null', 'Solna-Dark']) {
      expect(parseThemeChoice(stored)).toBe('system');
    }
  });
});

describe('resolveTheme', () => {
  test('a fixed choice ignores the OS', () => {
    expect(resolveTheme('dracula', true)).toBe('dracula');
    expect(resolveTheme('solna-dark', true)).toBe('solna-dark');
    expect(resolveTheme('cupcake', false)).toBe('cupcake');
  });

  test('system follows prefers-color-scheme between the two Solna themes', () => {
    expect(resolveTheme('system', true)).toBe('solna-light');
    expect(resolveTheme('system', false)).toBe('solna-dark');
  });
});

describe('the registry', () => {
  test('opens with the two Solna themes, labelled for the UI', () => {
    expect(THEMES.slice(0, 2)).toEqual([
      { id: 'solna-dark', label: 'Solna Dark', scheme: 'dark' },
      { id: 'solna-light', label: 'Solna Light', scheme: 'light' },
    ]);
  });

  test('daisyUI themes follow alphabetically, title-cased', () => {
    const daisy = THEMES.slice(2).map((entry) => entry.id);
    expect(daisy).toEqual([...daisy].sort((a, b) => a.localeCompare(b)));
    expect(themeEntry('dracula').label).toBe('Dracula');
    expect(themeEntry('caramellatte').label).toBe('Caramellatte');
  });

  test('ids are unique', () => {
    expect(new Set(THEMES.map((entry) => entry.id)).size).toBe(THEMES.length);
  });

  test('each scheme list puts its Solna theme first', () => {
    expect(themesOfScheme('dark')[0].id).toBe('solna-dark');
    expect(themesOfScheme('light')[0].id).toBe('solna-light');
    expect(themesOfScheme('dark').every((entry) => entry.scheme === 'dark')).toBe(true);
    expect(themesOfScheme('dark').length + themesOfScheme('light').length).toBe(THEMES.length);
  });

  test('themeChoiceLabel names System and every entry', () => {
    expect(themeChoiceLabel('system')).toBe('System');
    expect(themeChoiceLabel('solna-light')).toBe('Solna Light');
    expect(themeChoiceLabel('nord')).toBe('Nord');
  });
});

describe('registry sync (R344)', () => {
  test('index.css lists exactly the registry, in registry order, solna-dark as --default', () => {
    const list = stripped.match(/@plugin "daisyui" \{\s*themes:\s*([^;]+);/)?.[1] ?? '';
    const entries = list.split(',').map((s) => s.trim());
    expect(entries[0]).toBe('solna-dark --default');
    expect(entries.map((s) => s.replace(/\s+--default$/, ''))).toEqual(THEMES.map((entry) => entry.id));
  });

  test('both light palette blocks select exactly the light roster', () => {
    const lists = selectorListsNaming('solna-light');
    // The piano-key block and the --module-*/--drum-* block.
    expect(lists).toHaveLength(2);
    const expected = themesOfScheme('light').map((entry) => attr(entry.id)).sort();
    for (const list of lists) expect([...list].sort()).toEqual(expected);
  });

  test('dark themes fall through to the :root / solna-dark blocks', () => {
    const lists = selectorListsNaming('solna-dark');
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(list).toEqual([':root', attr('solna-dark')]);
    for (const entry of themesOfScheme('dark').slice(1)) {
      expect(stripped.includes(attr(entry.id))).toBe(false);
    }
  });

  test("every daisyUI entry's scheme matches its installed theme file, and every file has an entry", () => {
    const dir = new URL('../../../node_modules/daisyui/theme/', import.meta.url);
    const files = readdirSync(dir).filter((file) => file.endsWith('.css'));
    expect(files.length).toBeGreaterThan(0);
    const installed = Object.fromEntries(
      files.map((file) => [
        file.slice(0, -'.css'.length),
        readFileSync(new URL(file, dir), 'utf8').match(/color-scheme:\s*(dark|light)/)?.[1],
      ]),
    );
    const registered = Object.fromEntries(
      THEMES.filter((entry) => !entry.id.startsWith('solna-')).map((entry) => [entry.id, entry.scheme]),
    );
    expect(registered).toEqual(installed);
  });
});

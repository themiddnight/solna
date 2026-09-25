# Theme picker modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking the wordmark opens a Settings | About modal whose Settings tab previews and applies any Solna or daisyUI built-in theme (plus a System choice), while the project menu moves to its own chevron trigger and the header theme toggle is removed.

**Architecture:** Task 1 adds the theme registry (`components/settings/themes.ts`), binds `src/index.css` to it with sync tests, and hardens `scripts/check-contrast.ts` for the longer light selector. Task 2 adds the preview/apply store and its hook (`useThemeChoice.ts`) plus the `index.html` bootstrap and a test that pins it to the TS resolution. Task 3 adds the session-only `isAppModalOpen` flag, the `AppModal` (tabs, About) and the `ThemePicker`, mounted in `Workspace`. Task 4 turns the `Wordmark` into a `<button>` that opens the modal on both frames and gives `ProjectMenu` a chevron trigger. Task 5 removes `ThemeToggle`/`useTheme` and the `theme` Header tool. Task 6 is the docs (rules, ADR-0051, design.md). Task 7 is the browser check and the gate.

**Tech Stack:** TypeScript, React 19 (`useState`, `useEffect`, `useCallback`, `useSyncExternalStore`), zustand, Tailwind v4 + daisyUI 5 (CSS-first, `@plugin "daisyui"`), native `<dialog>` via `ui/Modal`, Bun test runner (`renderToString`, no DOM), ESLint flat config, Knip. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-25-theme-picker-modal-design.md` — binding. Departures are listed under "Spec corrections" below.

## Global Constraints

- Branch `feat/theme-picker-modal` is already checked out; never commit on `main` (R262). No Linear issue.
- Storage key stays `solna_theme`, now holding a `ThemeChoice` (a theme id or `'system'`); legacy `solna-dark` / `solna-light` are valid as-is; absent/unknown parses to `'system'`. No migration, no version bump (R214, R035).
- Every storage read/write goes through `@/utils/storage` guarded helpers (R244); a throwing `setItem` keeps the session theme.
- Theme state never enters a zustand slice; only the modal's open flag (`isAppModalOpen`) does, and it is session-only.
- UI labels: "Solna Dark" / "Solna Light"; daisyUI themes are title-cased ids; the System row reads "System (follows OS)"; modal title "Solna"; tabs "Settings" | "About"; About: "A browser audio workstation", "Made by Pathompong Thitithan", link `https://github.com/themiddnight/solna` with `target="_blank"` and `rel="noopener noreferrer"`.
- Dropdown triggers (project chevron, theme trigger) are focusable `<span role="button" tabIndex={0}>`, never `<button>` (iOS Safari never focuses a tapped button; daisyUI dropdowns open on `:focus-within` — see `DROPDOWN_TRIGGER_NOTE` in `src/components/ui/BottomInputDock.tsx`).
- The list scrolls inside `max-h-90` (360px, murva's value); the Settings panel holds a `min-h-120` so the modal body does not clip the open panel.
- `<meta name="theme-color">` is written as `rgb()` from the live `--color-base-200`, via `resolveThemeRgb` + `rgbToCss` in `src/utils/themeColor.ts`.
- No DOM, no testing-library (testing.md). Logic lives in pure functions / a store the hook wraps; components are tested with `renderToString`, minding R257 (a store value set before `renderToString` is invisible to a plain `useAppStore` selector).
- Component logic lives in a colocated `useXxx` hook with a named, exported `UseXxx` return type (R265, R266); one value per store selector (R274).
- `bun run eslint` must print zero errors and zero warnings; a legitimate exception is a line-level `eslint-disable-next-line <rule> -- <reason>` (R264).
- Per-task gate: the task's own tests + `bun run lint` + `bun run eslint`. Both Knip scans only go green once Task 3 wires the new files into the app (before that, the new files are reachable only from tests, which the production scan does not count) — run the full `bun run verify` from Task 3 on, and it is mandatory in Task 7.
- Commit messages are conventional commits and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not record version numbers, file counts or line numbers in rules/ADRs (R001).

## Review Focus

1. **OS scheme flips while the user previews a fixed theme** — the preview must not change; only a `system` preview follows the OS. Test: Task 2, "an OS change while previewing a fixed theme changes nothing".
2. **Closing the modal by Escape, backdrop or the close button with an unapplied preview** — all three end in `Modal`'s `onClose`; it must revert before closing, and switching to About must not revert. Test: Task 3, `closeAppModal` order test + the store revert test in Task 2.
3. **A stored id this build does not know** (a theme dropped by a daisyUI upgrade, a hand-edited value) — the bootstrap sets it verbatim (daisyUI's `--default` still paints), then the React side must correct it to the System resolution on mount. Test: Task 2, "start corrects an unknown stored id" + the bootstrap divergence test.
4. **Applying System** — must persist the literal `'system'` (not the resolved id) so the next visit keeps following the OS, and the live session must keep following it. Test: Task 2, "applying System persists 'system' and keeps following the OS".
5. **Opening the picker while System is active and the OS is light** — the Dark | Light tab must open on Light, with System checked. Test: Task 3, ThemePicker "System on a light OS" render test.

## Spec corrections

- **Two light palette blocks, not one.** `src/index.css` has two `[data-theme="solna-light"]` blocks: the piano-key block (`--key-*`, `--roll-key-*`) and the `--module-*`/`--drum-*` block. Both selectors grow to the light roster, otherwise light daisyUI themes get dark piano keys. The sync test pins both.
- **`check-contrast.ts` would break.** It reads the 300 characters before a block's `{` to find its theme; a ~22-line light selector pushes `[data-theme="solna-light"]` out of that window ("ambiguous theme"). Task 1 changes it to read the block's real selector (from the previous `}` to the `{`).
- **There is no existing bootstrap ≡ TS test.** `App.tsx`'s comment only names `resolveInitialTheme` as a pattern. Task 2 adds `themeBootstrap.test.ts`, which executes the inline `index.html` script against fakes.
- **`docs/design.md`** (the authoritative UI spec per theming.md) also says "exactly two themes" and lists the Theme Toggle; Task 6 updates it alongside `theming.md`/`components.md`/`CLAUDE.md`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/components/settings/themes.ts` | Create | Registry (`THEMES`), `ThemeId`/`ThemeChoice`/`ThemeScheme`, `parseThemeChoice`, `resolveTheme`, `themeEntry`, `themesOfScheme`, `themeChoiceLabel`, `THEME_STORAGE_KEY` |
| `src/components/settings/themes.test.ts` | Create | Parse/resolve tests + the three registry-sync tests (index.css list, light selectors, daisyUI `color-scheme`) |
| `src/index.css` | Modify | `themes:` list, both light selectors |
| `scripts/check-contrast.ts` | Modify | Read the block's real selector |
| `src/components/settings/useThemeChoice.ts` | Create | `createThemeChoiceStore` (pure, env-injected), `readThemeChoice`/`persistThemeChoice`, browser env, `useThemeChoice` hook |
| `src/components/settings/useThemeChoice.test.ts` | Create | Store + storage tests |
| `index.html` | Modify | Bootstrap handles `system` and any id |
| `src/components/settings/themeBootstrap.test.ts` | Create | Runs the inline script against fakes; pins it to `resolveTheme(parseThemeChoice(…))` |
| `src/store/types.ts`, `src/store/uiSlice.ts`, `src/store/uiSlice.test.ts` | Modify | `isAppModalOpen` / `setIsAppModalOpen` |
| `src/components/settings/useAppModal.ts` | Create | Open flag, Settings/About tab, `closeAppModal`, `useOpenAppModal` |
| `src/components/settings/useThemePicker.ts` | Create | Panel's Dark/Light tab state |
| `src/components/settings/ThemePicker.tsx` (+ `.test.tsx`) | Create | Trigger, panel, rows, Apply |
| `src/components/settings/AppModal.tsx` (+ `.test.tsx`) | Create | Modal, tabs, About |
| `src/App.tsx` | Modify | Mount `<AppModal />`; comment update |
| `src/components/ui/Wordmark.tsx` (+ test) | Modify | Real `<button>` with `onClick` |
| `src/components/settings/AppWordmark.tsx` | Create | Wordmark wired to `useOpenAppModal` |
| `src/components/project/ProjectMenu.tsx` (+ test) | Modify | Chevron trigger |
| `src/components/Header.tsx`, `src/components/shell/MobileTopBar.tsx` | Modify | Render `AppWordmark` |
| `src/components/header/ThemeToggle.tsx`, `src/components/header/useTheme.ts` | Delete | — |
| `src/components/header/headerTools.ts` | Modify | Drop `theme` |
| `src/components/Header.test.tsx`, `src/components/shell/mobileShell.test.tsx`, `src/components/header/toolRows.test.tsx` | Modify | Drop theme-tool pins |
| `.claude/rules/theming.md`, `components.md`, `persistence.md`, `testing.md`, `docs/decisions/0051-theme-picker.md`, `docs/decisions/README.md`, `docs/decisions/0022-…md`, `docs/design.md`, `CLAUDE.md` | Modify/Create | Docs |

---

### Task 1: Theme registry, CSS roster and palette selectors

**Files:**
- Create: `src/components/settings/themes.ts`
- Create: `src/components/settings/themes.test.ts`
- Modify: `src/index.css` (the `@plugin "daisyui"` block near the top; the two `[data-theme="solna-light"] {` selectors)
- Modify: `scripts/check-contrast.ts` (`themeOfBlock`)

**Interfaces:**
- Consumes: nothing.
- Produces (exact):
  ```ts
  export type ThemeScheme = 'dark' | 'light';
  export type ThemeId = 'solna-dark' | 'solna-light' | /* daisyUI ids */ ...;
  export interface ThemeEntry { readonly id: ThemeId; readonly label: string; readonly scheme: ThemeScheme }
  export type ThemeChoice = ThemeId | 'system';
  export const THEME_STORAGE_KEY = 'solna_theme';
  export const THEMES: readonly ThemeEntry[];
  export function parseThemeChoice(stored: string | null): ThemeChoice;
  export function resolveTheme(choice: ThemeChoice, prefersLight: boolean): ThemeId;
  export function themeEntry(id: ThemeId): ThemeEntry;
  export function themesOfScheme(scheme: ThemeScheme): readonly ThemeEntry[];
  export function themeChoiceLabel(choice: ThemeChoice): string; // 'System' | entry label
  ```

- [ ] **Step 1: Record the stylesheet baseline**

Run: `bun run build 2>&1 | grep -E "\.css"` and note the raw and gzip size of `dist/assets/index-*.css` (you report the delta in Step 11).

- [ ] **Step 2: Write the failing registry tests**

Create `src/components/settings/themes.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/components/settings/themes.test.ts`
Expected: FAIL — `Cannot find module './themes'`.

- [ ] **Step 4: Implement the registry**

Create `src/components/settings/themes.ts`:

```ts
/**
 * The theme roster (R344): the two Solna themes, then every daisyUI built-in
 * in the installed major, alphabetically. `src/index.css` repeats this list
 * twice — the daisyUI plugin's `themes:` and the light palette selectors —
 * and `themes.test.ts` binds both to it, plus each built-in's `scheme` to the
 * `color-scheme` its daisyUI theme file declares, so an upgrade that adds,
 * drops or re-schemes a theme fails a test instead of silently mis-painting.
 */
export type ThemeScheme = 'dark' | 'light';

/** daisyUI's built-ins and their `color-scheme`, written by hand; the sync test checks every one. */
const DAISYUI_THEME_SCHEMES = {
  abyss: 'dark',
  acid: 'light',
  aqua: 'dark',
  autumn: 'light',
  black: 'dark',
  bumblebee: 'light',
  business: 'dark',
  caramellatte: 'light',
  cmyk: 'light',
  coffee: 'dark',
  corporate: 'light',
  cupcake: 'light',
  cyberpunk: 'light',
  dark: 'dark',
  dim: 'dark',
  dracula: 'dark',
  emerald: 'light',
  fantasy: 'light',
  forest: 'dark',
  garden: 'light',
  halloween: 'dark',
  lemonade: 'light',
  light: 'light',
  lofi: 'light',
  luxury: 'dark',
  night: 'dark',
  nord: 'light',
  pastel: 'light',
  retro: 'light',
  silk: 'light',
  sunset: 'dark',
  synthwave: 'dark',
  valentine: 'light',
  winter: 'light',
  wireframe: 'light',
} as const satisfies Record<string, ThemeScheme>;

type DaisyThemeId = keyof typeof DAISYUI_THEME_SCHEMES;

export type ThemeId = 'solna-dark' | 'solna-light' | DaisyThemeId;

export interface ThemeEntry {
  readonly id: ThemeId;
  readonly label: string;
  readonly scheme: ThemeScheme;
}

/** What `solna_theme` holds: a theme id, or `system` (follow the OS between the two Solna themes). */
export type ThemeChoice = ThemeId | 'system';

export const THEME_STORAGE_KEY = 'solna_theme';

const titleCase = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

export const THEMES: readonly ThemeEntry[] = [
  { id: 'solna-dark', label: 'Solna Dark', scheme: 'dark' },
  { id: 'solna-light', label: 'Solna Light', scheme: 'light' },
  ...(Object.keys(DAISYUI_THEME_SCHEMES) as DaisyThemeId[])
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, label: titleCase(id), scheme: DAISYUI_THEME_SCHEMES[id] })),
];

const THEME_BY_ID = Object.fromEntries(THEMES.map((entry) => [entry.id, entry])) as Record<ThemeId, ThemeEntry>;
const THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((entry) => entry.id));

/**
 * Validates a stored value on read (R214, R345): a registry id is kept as-is —
 * which covers the legacy `solna-dark` / `solna-light` — and anything else,
 * absence included, is `system`, today's first-visit behaviour.
 */
export function parseThemeChoice(stored: string | null): ThemeChoice {
  return stored !== null && THEME_IDS.has(stored) ? (stored as ThemeId) : 'system';
}

/** The theme to paint. `system` picks a Solna theme by `prefers-color-scheme`; `index.html` mirrors this. */
export function resolveTheme(choice: ThemeChoice, prefersLight: boolean): ThemeId {
  if (choice !== 'system') return choice;
  return prefersLight ? 'solna-light' : 'solna-dark';
}

export function themeEntry(id: ThemeId): ThemeEntry {
  return THEME_BY_ID[id];
}

/** One scheme's themes in registry order: its Solna theme first, then daisyUI's alphabetically. */
export function themesOfScheme(scheme: ThemeScheme): readonly ThemeEntry[] {
  return THEMES.filter((entry) => entry.scheme === scheme);
}

export function themeChoiceLabel(choice: ThemeChoice): string {
  return choice === 'system' ? 'System' : themeEntry(choice).label;
}
```

- [ ] **Step 5: Run the tests — the pure ones pass, the CSS sync ones still fail**

Run: `bun test src/components/settings/themes.test.ts`
Expected: `parseThemeChoice`, `resolveTheme`, `the registry` and the daisyUI-file test PASS; "index.css lists exactly the registry" and "both light palette blocks" FAIL (index.css still lists two themes).

- [ ] **Step 6: Update `src/index.css`**

Replace the plugin block at the top:

```css
@plugin "daisyui" {
  themes: solna-dark --default, solna-light, abyss, acid, aqua, autumn, black, bumblebee, business, caramellatte, cmyk, coffee, corporate, cupcake, cyberpunk, dark, dim, dracula, emerald, fantasy, forest, garden, halloween, lemonade, light, lofi, luxury, night, nord, pastel, retro, silk, sunset, synthwave, valentine, winter, wireframe;
}
```

Replace **both** lines that read exactly `[data-theme="solna-light"] {` (the piano-key block after `:root, [data-theme="solna-dark"]` near the top, and the module/drum palette block further down) with:

```css
/* The light roster (R344): every light theme in components/settings/themes.ts.
   Dark themes fall through to the :root / solna-dark block above. themes.test.ts
   fails if this list and the registry disagree. */
[data-theme="solna-light"],
[data-theme="acid"],
[data-theme="autumn"],
[data-theme="bumblebee"],
[data-theme="caramellatte"],
[data-theme="cmyk"],
[data-theme="corporate"],
[data-theme="cupcake"],
[data-theme="cyberpunk"],
[data-theme="emerald"],
[data-theme="fantasy"],
[data-theme="garden"],
[data-theme="lemonade"],
[data-theme="light"],
[data-theme="lofi"],
[data-theme="nord"],
[data-theme="pastel"],
[data-theme="retro"],
[data-theme="silk"],
[data-theme="valentine"],
[data-theme="winter"],
[data-theme="wireframe"] {
```

(The palette block already has a long comment above it; put the three-line comment directly above the selector, below any existing comment.) Specificity note: `:root` and `[data-theme=…]` are both (0,1,0); the light block comes later in the file, so it wins on `<html data-theme="acid">`.

- [ ] **Step 7: Run the sync tests to verify they pass**

Run: `bun test src/components/settings/themes.test.ts`
Expected: PASS (all).

- [ ] **Step 8: Show the contrast gate now fails**

Run: `bun run check:contrast`
Expected: FAIL with `ambiguous theme for block at offset … (dark=false light=false)` — the 300-character look-back no longer reaches `[data-theme="solna-light"]`, which is the first line of a ~22-line selector.

- [ ] **Step 9: Read the block's real selector in `scripts/check-contrast.ts`**

Replace `themeOfBlock` with:

```ts
/**
 * The selector list a block opens with: everything since the previous block
 * closed. Not a fixed look-back window — the light palette's selector lists
 * the whole light theme roster (R344) and outgrows any fixed window.
 */
function selectorOf(blockStart: number): string {
  return stripped.slice(stripped.lastIndexOf('}', blockStart - 1) + 1, blockStart);
}

function themeOfBlock(blockStart: number): Theme {
  const selector = selectorOf(blockStart);
  const dark = selector.includes('[data-theme="solna-dark"]');
  const light = selector.includes('[data-theme="solna-light"]');
  if (dark === light) {
    throw new Error(`ambiguous theme for block at offset ${blockStart} (dark=${dark} light=${light})`);
  }
  return dark ? 'dark' : 'light';
}
```

- [ ] **Step 10: Run the gates**

Run: `bun run check:contrast && bun run check:theme && bun run lint && bun run eslint`
Expected: contrast passes and still reports exactly the two Solna palettes (dark and light, same pair count as before your change); theme guard PASS; zero lint/eslint errors and warnings.

- [ ] **Step 11: Measure the stylesheet growth**

Run: `bun run build 2>&1 | grep -E "\.css"` — note raw and gzip size against Step 1; put both numbers in the commit body and keep them for the ADR (Task 6).

- [ ] **Step 12: Commit**

```bash
git add src/components/settings/themes.ts src/components/settings/themes.test.ts src/index.css scripts/check-contrast.ts
git commit -m "feat(theme): add the theme registry and bind index.css to it

Lists every daisyUI built-in beside the two Solna themes, grows both light
palette selectors to the light roster, and makes check-contrast read a
block's real selector. Stylesheet: <before> -> <after> (gzip <before> -> <after>).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Theme choice store, hook and the `index.html` bootstrap

**Files:**
- Create: `src/components/settings/useThemeChoice.ts`
- Create: `src/components/settings/useThemeChoice.test.ts`
- Create: `src/components/settings/themeBootstrap.test.ts`
- Modify: `index.html` (the `<script>` starting `// Pre-paint theme bootstrap.`)

**Interfaces:**
- Consumes: `parseThemeChoice`, `resolveTheme`, `THEME_STORAGE_KEY`, `ThemeChoice`, `ThemeId` from `./themes`; `readGuardedStorageValue`, `persistGuardedStorageValue` from `@/utils/storage`; `resolveThemeRgb`, `rgbToCss` from `@/utils/themeColor`.
- Produces (exact):
  ```ts
  export function readThemeChoice(storage?: Pick<Storage, 'getItem'>): ThemeChoice;
  export function persistThemeChoice(choice: ThemeChoice, storage?: Pick<Storage, 'setItem'>): void;
  export interface ThemeChoiceState { readonly applied: ThemeChoice; readonly preview: ThemeChoice; readonly resolved: ThemeId }
  export interface ThemeChoiceEnv {
    prefersLight: () => boolean;
    onSchemeChange: (listener: () => void) => () => void;
    setDocumentTheme: (id: ThemeId) => void;
    syncThemeColor: () => void;
    persist: (choice: ThemeChoice) => void;
  }
  export interface ThemeChoiceStore {
    getSnapshot: () => ThemeChoiceState;
    subscribe: (listener: () => void) => () => void;
    start: () => () => void;
    select: (choice: ThemeChoice) => void;
    apply: () => void;
    revert: () => void;
  }
  export function createThemeChoiceStore(initial: ThemeChoice, env: ThemeChoiceEnv): ThemeChoiceStore;
  export interface UseThemeChoice extends ThemeChoiceState {
    readonly isPreviewing: boolean;
    select: (choice: ThemeChoice) => void;
    apply: () => void;
    revert: () => void;
  }
  export function useThemeChoice(): UseThemeChoice;
  ```
  `select`, `apply`, `revert` are stable for the store's lifetime (Task 3 relies on that for a stable `Modal` `onClose`).

- [ ] **Step 1: Write the failing store tests**

Create `src/components/settings/useThemeChoice.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { ThemeChoice, ThemeId } from './themes';
import {
  createThemeChoiceStore,
  persistThemeChoice,
  readThemeChoice,
  type ThemeChoiceEnv,
} from './useThemeChoice';

// Storage access itself can throw (Safari private browsing, "block all
// cookies", some embedded webviews) — not merely return null.
const throwingGetStorage = {
  getItem(): string | null {
    throw new Error('SecurityError: storage is blocked');
  },
};
const throwingSetStorage = {
  setItem(): void {
    throw new Error('SecurityError: storage is blocked');
  },
};

/** An env that records what the store paints and persists, with a switchable OS scheme. */
function fakeEnv(prefersLight = false) {
  let light = prefersLight;
  const listeners = new Set<() => void>();
  const painted: ThemeId[] = [];
  const persisted: ThemeChoice[] = [];
  let themeColorWrites = 0;
  const env: ThemeChoiceEnv = {
    prefersLight: () => light,
    onSchemeChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDocumentTheme: (id) => {
      painted.push(id);
    },
    syncThemeColor: () => {
      themeColorWrites += 1;
    },
    persist: (choice) => {
      persisted.push(choice);
    },
  };
  return {
    env,
    painted,
    persisted,
    listeners,
    themeColorWrites: () => themeColorWrites,
    setOs(next: boolean) {
      light = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('readThemeChoice / persistThemeChoice', () => {
  test('a legacy stored theme reads back as that choice', () => {
    expect(readThemeChoice({ getItem: () => 'solna-light' })).toBe('solna-light');
  });

  test("an unknown stored id reads back as 'system'", () => {
    expect(readThemeChoice({ getItem: () => 'murva-dark' })).toBe('system');
  });

  test("a throwing read degrades to 'system'", () => {
    expect(readThemeChoice(throwingGetStorage)).toBe('system');
  });

  test("no storage injected and no global (bun test has no localStorage) reads 'system'", () => {
    expect(readThemeChoice()).toBe('system');
  });

  test('writes the choice under solna_theme', () => {
    const calls: Array<[string, string]> = [];
    persistThemeChoice('dracula', { setItem: (key: string, value: string) => void calls.push([key, value]) });
    expect(calls).toEqual([['solna_theme', 'dracula']]);
  });

  test('a throwing or absent storage does not throw', () => {
    expect(() => persistThemeChoice('dracula', throwingSetStorage)).not.toThrow();
    expect(() => persistThemeChoice('system')).not.toThrow();
  });
});

describe('createThemeChoiceStore', () => {
  test('start paints the resolved theme and writes theme-color once', () => {
    const fake = fakeEnv(true);
    const store = createThemeChoiceStore('system', fake.env);
    store.start();
    expect(fake.painted).toEqual(['solna-light']);
    expect(fake.themeColorWrites()).toBe(1);
    expect(store.getSnapshot()).toEqual({ applied: 'system', preview: 'system', resolved: 'solna-light' });
  });

  // Review Focus 3: the bootstrap wrote an unknown id verbatim; mount corrects it.
  test('start corrects an unknown stored id to the System resolution', () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore(readThemeChoice({ getItem: () => 'retired-theme' }), fake.env);
    store.start();
    expect(fake.painted).toEqual(['solna-dark']);
  });

  test('select previews without persisting', () => {
    const fake = fakeEnv();
    const store = createThemeChoiceStore('solna-dark', fake.env);
    store.start();
    store.select('dracula');
    expect(fake.painted.at(-1)).toBe('dracula');
    expect(fake.persisted).toEqual([]);
    expect(store.getSnapshot()).toEqual({ applied: 'solna-dark', preview: 'dracula', resolved: 'dracula' });
  });

  test('select then apply persists the preview once', () => {
    const fake = fakeEnv();
    const store = createThemeChoiceStore('solna-dark', fake.env);
    store.select('nord');
    store.apply();
    store.apply();
    expect(fake.persisted).toEqual(['nord']);
    expect(store.getSnapshot().applied).toBe('nord');
  });

  test('select then revert restores the applied theme on screen', () => {
    const fake = fakeEnv();
    const store = createThemeChoiceStore('solna-dark', fake.env);
    store.start();
    store.select('cupcake');
    store.revert();
    expect(fake.painted.at(-1)).toBe('solna-dark');
    expect(store.getSnapshot()).toEqual({ applied: 'solna-dark', preview: 'solna-dark', resolved: 'solna-dark' });
    expect(fake.persisted).toEqual([]);
  });

  test('an OS change while System is previewed re-resolves live', () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore('system', fake.env);
    store.start();
    fake.setOs(true);
    expect(fake.painted.at(-1)).toBe('solna-light');
    expect(store.getSnapshot().resolved).toBe('solna-light');
  });

  // Review Focus 1.
  test('an OS change while previewing a fixed theme changes nothing', () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore('system', fake.env);
    store.start();
    store.select('dracula');
    const paints = fake.painted.length;
    fake.setOs(true);
    expect(fake.painted.length).toBe(paints);
    expect(store.getSnapshot().resolved).toBe('dracula');
    store.revert();
    expect(fake.painted.at(-1)).toBe('solna-light'); // back to System, resolved by today's OS
  });

  // Review Focus 4.
  test("applying System persists 'system' and keeps following the OS", () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore('solna-dark', fake.env);
    store.start();
    store.select('system');
    store.apply();
    expect(fake.persisted).toEqual(['system']);
    fake.setOs(true);
    expect(fake.painted.at(-1)).toBe('solna-light');
  });

  test('a throwing storage keeps the session theme', () => {
    const fake = fakeEnv();
    const env: ThemeChoiceEnv = { ...fake.env, persist: (choice) => persistThemeChoice(choice, throwingSetStorage) };
    const store = createThemeChoiceStore('solna-dark', env);
    store.select('dracula');
    expect(() => store.apply()).not.toThrow();
    expect(store.getSnapshot()).toEqual({ applied: 'dracula', preview: 'dracula', resolved: 'dracula' });
    expect(fake.painted.at(-1)).toBe('dracula');
  });

  test('theme-color is rewritten after every repaint, and not when nothing changes', () => {
    const fake = fakeEnv(false);
    const store = createThemeChoiceStore('system', fake.env);
    store.start(); // 1
    store.select('dracula'); // 2
    store.select('dracula'); // unchanged
    store.select('system'); // 3
    fake.setOs(true); // 4
    expect(fake.themeColorWrites()).toBe(4);
  });

  test('subscribers are notified on change, and the start cleanup drops the OS listener', () => {
    const fake = fakeEnv();
    const store = createThemeChoiceStore('system', fake.env);
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    const stop = store.start();
    store.select('nord');
    expect(calls).toBe(1);
    expect(fake.listeners.size).toBe(1);
    stop();
    expect(fake.listeners.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/components/settings/useThemeChoice.test.ts`
Expected: FAIL — `Cannot find module './useThemeChoice'`.

- [ ] **Step 3: Implement the store and hook**

Create `src/components/settings/useThemeChoice.ts`:

```ts
import { useEffect, useState, useSyncExternalStore } from 'react';
import { persistGuardedStorageValue, readGuardedStorageValue } from '@/utils/storage';
import { resolveThemeRgb, rgbToCss } from '@/utils/themeColor';
import { parseThemeChoice, resolveTheme, THEME_STORAGE_KEY, type ThemeChoice, type ThemeId } from './themes';

const PREFERS_LIGHT_QUERY = '(prefers-color-scheme: light)';

/** The stored choice, validated on read (R214, R345); a throwing read is "nothing stored". */
export function readThemeChoice(storage?: Pick<Storage, 'getItem'>): ThemeChoice {
  return parseThemeChoice(readGuardedStorageValue(THEME_STORAGE_KEY, storage));
}

/** Best-effort (R244): a throwing `setItem` loses only cross-session persistence. */
export function persistThemeChoice(choice: ThemeChoice, storage?: Pick<Storage, 'setItem'>): void {
  persistGuardedStorageValue(THEME_STORAGE_KEY, choice, storage);
}

export interface ThemeChoiceState {
  /** What is persisted. */
  readonly applied: ThemeChoice;
  /** What is on screen. */
  readonly preview: ThemeChoice;
  /** `preview` resolved against the OS scheme — the `data-theme` actually painted. */
  readonly resolved: ThemeId;
}

/** Everything the store touches outside itself — the browser in the app, fakes in tests. */
export interface ThemeChoiceEnv {
  prefersLight: () => boolean;
  onSchemeChange: (listener: () => void) => () => void;
  setDocumentTheme: (id: ThemeId) => void;
  syncThemeColor: () => void;
  persist: (choice: ThemeChoice) => void;
}

export interface ThemeChoiceStore {
  getSnapshot: () => ThemeChoiceState;
  subscribe: (listener: () => void) => () => void;
  /** Paints once and follows the OS scheme; returns the cleanup. */
  start: () => () => void;
  select: (choice: ThemeChoice) => void;
  apply: () => void;
  revert: () => void;
}

/**
 * Preview vs apply (R346): `select` paints without persisting, `apply`
 * persists the preview, `revert` repaints the applied choice. A `system`
 * preview re-resolves when the OS scheme changes; a fixed one ignores it.
 * Every repaint rewrites `<meta name="theme-color">` (R347).
 */
export function createThemeChoiceStore(initial: ThemeChoice, env: ThemeChoiceEnv): ThemeChoiceStore {
  let state: ThemeChoiceState = {
    applied: initial,
    preview: initial,
    resolved: resolveTheme(initial, env.prefersLight()),
  };
  const listeners = new Set<() => void>();

  const paint = () => {
    env.setDocumentTheme(state.resolved);
    env.syncThemeColor();
  };

  const commit = (applied: ThemeChoice, preview: ThemeChoice) => {
    const resolved = resolveTheme(preview, env.prefersLight());
    if (applied === state.applied && preview === state.preview && resolved === state.resolved) return;
    const repaint = resolved !== state.resolved;
    state = { applied, preview, resolved };
    if (repaint) paint();
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      paint();
      return env.onSchemeChange(() => {
        if (state.preview === 'system') commit(state.applied, state.preview);
      });
    },
    select: (choice) => commit(state.applied, choice),
    apply() {
      if (state.preview === state.applied) return;
      env.persist(state.preview);
      commit(state.preview, state.preview);
    },
    revert: () => commit(state.applied, state.applied),
  };
}

/** The real env. Lazy: nothing here touches the DOM until the store paints (never under renderToString). */
function browserThemeEnv(): ThemeChoiceEnv {
  const media = (): MediaQueryList | null =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(PREFERS_LIGHT_QUERY)
      : null;
  return {
    prefersLight: () => media()?.matches ?? false,
    onSchemeChange(listener) {
      const list = media();
      if (!list) return () => {};
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    setDocumentTheme: (id) => document.documentElement.setAttribute('data-theme', id),
    // daisyUI 5 colours are oklch(); resolveThemeRgb normalises to rgb(), which
    // every browser accepts in theme-color. base-200 is the <body> background.
    syncThemeColor: () =>
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', rgbToCss(resolveThemeRgb('--color-base-200'))),
    persist: (choice) => persistThemeChoice(choice),
  };
}

export interface UseThemeChoice extends ThemeChoiceState {
  readonly isPreviewing: boolean;
  select: (choice: ThemeChoice) => void;
  apply: () => void;
  revert: () => void;
}

/**
 * The theme, for the app modal — which is always mounted, so the OS listener
 * and the theme-color sync always run. Theme state never enters a zustand
 * slice (R346).
 */
export function useThemeChoice(): UseThemeChoice {
  const [store] = useState(() => createThemeChoiceStore(readThemeChoice(), browserThemeEnv()));
  useEffect(() => store.start(), [store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    ...state,
    isPreviewing: state.preview !== state.applied,
    select: store.select,
    apply: store.apply,
    revert: store.revert,
  };
}
```

- [ ] **Step 4: Run the store tests**

Run: `bun test src/components/settings/useThemeChoice.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing bootstrap test**

Create `src/components/settings/themeBootstrap.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseThemeChoice, resolveTheme } from './themes';

/**
 * Runs the blocking <head> script from index.html against fakes, so the
 * bootstrap and the TS resolution (R345) can never disagree.
 */
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>\s*(\/\/ Pre-paint theme bootstrap[\s\S]*?)<\/script>/)?.[1];

const THROW = Symbol('throw');

function runBootstrap(stored: string | null | typeof THROW, prefersLight: boolean): string | undefined {
  if (script === undefined) throw new Error('bootstrap script not found in index.html');
  const dataset: Record<string, string> = {};
  const localStorage = {
    getItem: () => {
      if (stored === THROW) throw new Error('SecurityError: storage is blocked');
      return stored;
    },
  };
  const window = {
    matchMedia: (query: string) => ({ matches: query === '(prefers-color-scheme: light)' && prefersLight }),
  };
  const document = { documentElement: { dataset } };
  // eslint-disable-next-line no-new-func -- executes the inline index.html script under test; there is no module to import
  new Function('localStorage', 'window', 'document', script)(localStorage, window, document);
  return dataset.theme;
}

describe('index.html theme bootstrap', () => {
  test('matches resolveTheme(parseThemeChoice(stored)) for every known value', () => {
    for (const stored of [null, '', 'system', 'solna-dark', 'solna-light', 'dracula', 'acid', 'light']) {
      for (const prefersLight of [true, false]) {
        expect(runBootstrap(stored, prefersLight)).toBe(resolveTheme(parseThemeChoice(stored), prefersLight));
      }
    }
  });

  test('a throwing storage resolves like System', () => {
    expect(runBootstrap(THROW, true)).toBe('solna-light');
    expect(runBootstrap(THROW, false)).toBe('solna-dark');
  });

  // The one intended divergence: the script carries no roster, so an unknown
  // id is set verbatim (solna-dark is daisyUI's --default on :root, so the
  // page still paints) and useThemeChoice corrects it on mount.
  test('an unknown id is set verbatim', () => {
    expect(runBootstrap('retired-theme', true)).toBe('retired-theme');
  });
});
```

If `bun run eslint` reports the `no-new-func` disable as unused (the rule is not enabled), delete the disable comment rather than leaving an unused directive.

- [ ] **Step 6: Run to verify it fails**

Run: `bun test src/components/settings/themeBootstrap.test.ts`
Expected: FAIL — `'dracula'`/`'acid'`/`'light'` come back as `solna-dark`/`solna-light` (today's script only knows the two Solna ids), and the verbatim test gets a Solna id.

- [ ] **Step 7: Update the bootstrap in `index.html`**

Replace the whole `<script>` whose first line is `// Pre-paint theme bootstrap.` with:

```html
    <script>
      // Pre-paint theme bootstrap. Must stay inline and blocking (no defer/async)
      // so data-theme is correct before the first paint — otherwise light-theme
      // users get a dark flash. solna_theme holds a ThemeChoice: a theme id, or
      // 'system' / nothing, which follows prefers-color-scheme between the two
      // Solna themes. Any other value is set verbatim: an unknown id still
      // paints (solna-dark is daisyUI's --default), and useThemeChoice
      // (src/components/settings) corrects it on mount. themeBootstrap.test.ts
      // pins this to resolveTheme(parseThemeChoice(stored)).
      (function () {
        var choice = null;
        try {
          choice = localStorage.getItem('solna_theme');
        } catch (e) {
          // Private mode / blocked storage: fall through to the media query.
          choice = null;
        }
        var theme = choice;
        if (!choice || choice === 'system') {
          theme =
            window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: light)').matches
              ? 'solna-light'
              : 'solna-dark';
        }
        document.documentElement.dataset.theme = theme;
      })();
    </script>
```

Leave `<meta name="theme-color" content="#17100F" />` as it is: it stands until React mounts.

- [ ] **Step 8: Run the Task 2 tests and gates**

Run: `bun test src/components/settings && bun run lint && bun run eslint`
Expected: PASS; zero errors and zero warnings.

- [ ] **Step 9: Commit**

```bash
git add src/components/settings/useThemeChoice.ts src/components/settings/useThemeChoice.test.ts src/components/settings/themeBootstrap.test.ts index.html
git commit -m "feat(theme): add the preview/apply theme store and a System-aware bootstrap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: App modal flag, `AppModal`, `ThemePicker`, mounted in `Workspace`

**Files:**
- Modify: `src/store/types.ts` (beside `isMidiSettingsOpen` and `setIsMidiSettingsOpen`)
- Modify: `src/store/uiSlice.ts` (initial state beside `isMidiSettingsOpen: false,`; action beside `setIsMidiSettingsOpen`)
- Modify: `src/store/uiSlice.test.ts`
- Create: `src/components/settings/useAppModal.ts`
- Create: `src/components/settings/useThemePicker.ts`
- Create: `src/components/settings/ThemePicker.tsx`, `src/components/settings/ThemePicker.test.tsx`
- Create: `src/components/settings/AppModal.tsx`, `src/components/settings/AppModal.test.tsx`
- Modify: `src/App.tsx` (import; `<AppModal />` after `<MidiSettingsModal />` in `Workspace`)

**Interfaces:**
- Consumes: `useThemeChoice`, `UseThemeChoice` (Task 2); `themeEntry`, `themesOfScheme`, `themeChoiceLabel`, `ThemeChoice`, `ThemeId`, `ThemeScheme`, `ThemeEntry` (Task 1); `Modal` (`open`, `onClose`, `title`, `size`, `bodyClassName`) and `cx` from `@/components/ui/`.
- Produces (exact):
  ```ts
  // store
  isAppModalOpen: boolean;
  setIsAppModalOpen: (open: boolean) => void;
  // useAppModal.ts
  export type AppModalTab = 'settings' | 'about';
  export const APP_MODAL_TABS: readonly { readonly id: AppModalTab; readonly label: string }[];
  export function closeAppModal(revert: () => void, setOpen: (open: boolean) => void): void;
  export interface UseAppModal { open: boolean; tab: AppModalTab; selectTab: (tab: AppModalTab) => void; close: () => void; theme: UseThemeChoice }
  export function useAppModal(): UseAppModal;
  export function useOpenAppModal(): () => void;   // Task 4 uses this
  // ThemePicker.tsx
  export interface ThemePickerProps { preview: ThemeChoice; resolved: ThemeId; isPreviewing: boolean; onSelect: (choice: ThemeChoice) => void; onApply: () => void }
  export function ThemePicker(props: ThemePickerProps): JSX.Element;
  // AppModal.tsx
  export function AppModal(): JSX.Element;
  ```
  DOM ids: `app-modal-tab-settings`, `app-modal-tab-about`, `app-modal-panel-settings`, `app-modal-panel-about`, `link-app-repo`, `btn-theme-picker`, `btn-theme-apply`, `theme-scheme-dark`, `theme-scheme-light`, `theme-option-system`, `theme-option-<id>`.

- [ ] **Step 1: Write the failing slice tests**

Append to `src/store/uiSlice.test.ts` (it already imports `partializeAppState`, `useAppStore`, `PROJECT_CONTENT_KEYS`):

```ts
describe('app modal flag', () => {
  test('starts closed and opens through its setter', () => {
    expect(useAppStore.getState().isAppModalOpen).toBe(false);
    useAppStore.getState().setIsAppModalOpen(true);
    expect(useAppStore.getState().isAppModalOpen).toBe(true);
    useAppStore.getState().setIsAppModalOpen(false);
    expect(useAppStore.getState().isAppModalOpen).toBe(false);
  });

  test('is session-only: in neither partializeAppState nor PROJECT_CONTENT_KEYS', () => {
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('isAppModalOpen' in persisted).toBe(false);
    expect(PROJECT_CONTENT_KEYS).not.toContain('isAppModalOpen' as never);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/store/uiSlice.test.ts -t "app modal flag"`
Expected: FAIL — `isAppModalOpen` is `undefined`; `setIsAppModalOpen is not a function`.

- [ ] **Step 3: Add the flag**

In `src/store/types.ts`, directly under `isMidiSettingsOpen: boolean;` add:

```ts
  /** The wordmark's Settings | About modal. Session-only: never persisted (not in partializeAppState). */
  isAppModalOpen: boolean;
```

and directly under `setIsMidiSettingsOpen: (open: boolean) => void;` add:

```ts
  setIsAppModalOpen: (open: boolean) => void;
```

In `src/store/uiSlice.ts`, under `isMidiSettingsOpen: false,` add `isAppModalOpen: false,` and under `setIsMidiSettingsOpen: (isMidiSettingsOpen) => set({ isMidiSettingsOpen }),` add:

```ts
    setIsAppModalOpen: (isAppModalOpen) => set({ isAppModalOpen }),
```

`partializeAppState` in `src/store/store.ts` is an allow-list, so nothing else is needed there.

- [ ] **Step 4: Run the slice tests and the type check**

Run: `bun test src/store/uiSlice.test.ts && bun run lint`
Expected: PASS; `tsc` clean (if a test fixture builds a full `AppStore` literal and now misses the two keys, add them to it).

- [ ] **Step 5: Write the failing picker and modal tests**

Create `src/components/settings/ThemePicker.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ThemePicker } from './ThemePicker';
import { themesOfScheme, type ThemeChoice, type ThemeId } from './themes';

/** The full opening tag of the element whose markup contains `needle`. */
function openTag(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  return html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx) + 1);
}

const noop = () => {};
const render = (preview: ThemeChoice, resolved: ThemeId, isPreviewing: boolean) =>
  renderToString(
    <ThemePicker preview={preview} resolved={resolved} isPreviewing={isPreviewing} onSelect={noop} onApply={noop} />,
  );

describe('ThemePicker', () => {
  test('the trigger is a focusable span (iOS Safari), labelled with the current choice', () => {
    const trigger = openTag(render('solna-dark', 'solna-dark', false), 'id="btn-theme-picker"');
    expect(trigger.startsWith('<span')).toBe(true);
    expect(trigger).toContain('role="button"');
    expect(trigger).toContain('tabindex="0"');
    expect(trigger).toContain('aria-label="Theme: Solna Dark"');
  });

  test('the panel is a focusable radiogroup dropdown whose list scrolls at 360px', () => {
    const html = render('solna-dark', 'solna-dark', false);
    const panel = openTag(html, 'role="radiogroup"');
    expect(panel).toContain('tabindex="0"');
    expect(panel).toContain('dropdown-content');
    expect(html).toContain('max-h-90 space-y-1 overflow-y-auto');
  });

  test('nothing previewed: no warning, Apply disabled', () => {
    const html = render('solna-dark', 'solna-dark', false);
    expect(html).not.toContain('Previewing');
    expect(html).not.toContain('status-warning');
    expect(openTag(html, 'id="btn-theme-apply"')).toContain('disabled=""');
  });

  test('previewing: warning dot, Previewing tag, Apply enabled', () => {
    const html = render('dracula', 'dracula', true);
    expect(html).toContain('status status-warning');
    expect(html).toContain('Previewing');
    expect(openTag(html, 'id="btn-theme-apply"')).not.toContain('disabled');
  });

  test('a dark preview opens on the Dark tab: Solna Dark first, then every dark daisyUI theme, each painted in itself', () => {
    const html = render('dracula', 'dracula', true);
    expect(openTag(html, 'id="theme-scheme-dark"')).toContain('aria-selected="true"');
    expect(openTag(html, 'id="theme-scheme-dark"')).toContain('tab-active');
    for (const entry of themesOfScheme('dark')) {
      expect(openTag(html, `id="theme-option-${entry.id}"`)).toContain(`data-theme="${entry.id}"`);
    }
    expect(html).not.toContain('id="theme-option-acid"');
    expect(html.indexOf('id="theme-option-solna-dark"')).toBeLessThan(html.indexOf('id="theme-option-abyss"'));
    expect(openTag(html, 'id="theme-option-dracula"')).toContain('aria-checked="true"');
    expect(openTag(html, 'id="theme-option-solna-dark"')).toContain('aria-checked="false"');
  });

  // Review Focus 5.
  test('System on a light OS: the Light tab, System checked, Solna Light first', () => {
    const html = render('system', 'solna-light', false);
    expect(openTag(html, 'id="theme-scheme-light"')).toContain('aria-selected="true"');
    expect(openTag(html, 'id="theme-option-system"')).toContain('aria-checked="true"');
    expect(openTag(html, 'id="btn-theme-picker"')).toContain('aria-label="Theme: System"');
    expect(html).toContain('System (follows OS)');
    expect(html.indexOf('id="theme-option-solna-light"')).toBeLessThan(html.indexOf('id="theme-option-acid"'));
    expect(html).not.toContain('id="theme-option-dracula"');
  });

  test('the System row is not painted in any theme', () => {
    expect(openTag(render('system', 'solna-dark', false), 'id="theme-option-system"')).not.toContain('data-theme');
  });
});
```

Create `src/components/settings/AppModal.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AppModal } from './AppModal';
import { closeAppModal } from './useAppModal';

function openTag(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  return html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx) + 1);
}

// The open flag reads the store's creation-time value under renderToString
// (R257), so the modal renders closed — a native <dialog> still renders its
// children, which is what these tests pin.
const html = renderToString(<AppModal />);

describe('AppModal', () => {
  test('a Modal titled Solna with Settings then About tabs, Settings selected', () => {
    expect(html).toContain('<dialog class="modal"');
    expect(html).toContain('max-w-2xl'); // size lg
    expect(html).toContain('Solna</h3>');
    expect(html).toContain('role="tablist"');
    expect(html.indexOf('id="app-modal-tab-settings"')).toBeLessThan(html.indexOf('id="app-modal-tab-about"'));
    expect(openTag(html, 'id="app-modal-tab-settings"')).toContain('aria-selected="true"');
    expect(openTag(html, 'id="app-modal-tab-about"')).toContain('aria-selected="false"');
  });

  test('Settings holds the theme picker and the min-height its open panel needs', () => {
    const panel = openTag(html, 'id="app-modal-panel-settings"');
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain('min-h-120');
    expect(panel).not.toContain('hidden');
    expect(html).toContain('id="btn-theme-picker"');
  });

  test('About is rendered hidden with the name, description, author and repo link', () => {
    expect(openTag(html, 'id="app-modal-panel-about"')).toContain('hidden=""');
    expect(html).toContain('A browser audio workstation');
    expect(html).toContain('Made by Pathompong Thitithan');
    const link = openTag(html, 'id="link-app-repo"');
    expect(link).toContain('href="https://github.com/themiddnight/solna"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });
});

// Review Focus 2: Escape, the backdrop and the close button all end in
// Modal's onClose; that must revert an unapplied preview before closing.
describe('closeAppModal', () => {
  test('reverts, then closes', () => {
    const calls: string[] = [];
    closeAppModal(
      () => calls.push('revert'),
      (open) => calls.push(`open=${open}`),
    );
    expect(calls).toEqual(['revert', 'open=false']);
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `bun test src/components/settings/ThemePicker.test.tsx src/components/settings/AppModal.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 7: Implement the hooks**

Create `src/components/settings/useAppModal.ts`:

```ts
import { useCallback, useState } from 'react';
import { useAppStore } from '@/store/store';
import { useThemeChoice, type UseThemeChoice } from './useThemeChoice';

export type AppModalTab = 'settings' | 'about';

export const APP_MODAL_TABS: readonly { readonly id: AppModalTab; readonly label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'about', label: 'About' },
];

/**
 * Every close path — Escape, the backdrop, the close button — ends here via
 * Modal's onClose: an unapplied preview is reverted first (R346). Switching
 * to About is not a close, so it keeps the preview.
 */
export function closeAppModal(revert: () => void, setOpen: (open: boolean) => void): void {
  revert();
  setOpen(false);
}

export interface UseAppModal {
  open: boolean;
  /** Remembered for the session: component state, and the modal stays mounted. */
  tab: AppModalTab;
  selectTab: (tab: AppModalTab) => void;
  close: () => void;
  theme: UseThemeChoice;
}

export function useAppModal(): UseAppModal {
  const open = useAppStore((s) => s.isAppModalOpen);
  const setOpen = useAppStore((s) => s.setIsAppModalOpen);
  const theme = useThemeChoice();
  const [tab, selectTab] = useState<AppModalTab>('settings');
  const { revert } = theme;
  // Stable (revert is stable for the store's lifetime): Modal re-binds its
  // native close listener whenever onClose changes.
  const close = useCallback(() => closeAppModal(revert, setOpen), [revert, setOpen]);
  return { open, tab, selectTab, close, theme };
}

/** What the wordmark calls, on both frames. */
export function useOpenAppModal(): () => void {
  const setOpen = useAppStore((s) => s.setIsAppModalOpen);
  return useCallback(() => setOpen(true), [setOpen]);
}
```

Create `src/components/settings/useThemePicker.ts`:

```ts
import { useState } from 'react';
import { themeEntry, themesOfScheme, type ThemeEntry, type ThemeId, type ThemeScheme } from './themes';

export interface UseThemePicker {
  scheme: ThemeScheme;
  selectScheme: (scheme: ThemeScheme) => void;
  themes: readonly ThemeEntry[];
}

/**
 * The panel's Dark | Light tab. Local state, so switching tabs previews
 * nothing. It opens on the painted theme's scheme; AppModal remounts the
 * picker on every open (`key`), so each open starts from the current preview.
 */
export function useThemePicker(resolved: ThemeId): UseThemePicker {
  const [scheme, selectScheme] = useState<ThemeScheme>(() => themeEntry(resolved).scheme);
  return { scheme, selectScheme, themes: themesOfScheme(scheme) };
}
```

- [ ] **Step 8: Implement `ThemePicker`**

Create `src/components/settings/ThemePicker.tsx` (daisyUI 5 classes verified against daisyui.com: `dropdown`/`dropdown-content`, `tabs tabs-box tabs-sm`/`tab tab-active`, `status status-warning`, `badge badge-warning badge-sm`):

```tsx
import { Check, ChevronDown, Monitor } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { themeChoiceLabel, type ThemeChoice, type ThemeId, type ThemeScheme } from './themes';
import { useThemePicker } from './useThemePicker';

const SCHEME_TABS: readonly { readonly id: ThemeScheme; readonly label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const DOT = 'h-3 w-3 rounded-full border border-base-100';

/** Colour dots painted by whichever theme the nearest `data-theme` names. */
function Swatches({ accent }: { accent: boolean }) {
  return (
    <span className="flex -space-x-1" aria-hidden="true">
      <span className={cx(DOT, 'bg-primary')} />
      <span className={cx(DOT, 'bg-secondary')} />
      {accent && <span className={cx(DOT, 'bg-accent')} />}
    </span>
  );
}

interface ThemeOptionProps {
  id: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
  /** Paints the row in this theme (daisyUI sets the row's colours from `data-theme`); System has none. */
  theme?: ThemeId;
}

function ThemeOption({ id, label, checked, onSelect, theme }: ThemeOptionProps) {
  return (
    <button
      id={id}
      type="button"
      role="radio"
      aria-checked={checked}
      data-theme={theme}
      onClick={onSelect}
      className={cx(
        'flex w-full min-h-11 items-center justify-between gap-3 rounded-field px-2 text-left text-sm transition-colors hover:bg-base-300',
        checked && 'ring-1 ring-primary/40',
      )}
    >
      <span className="flex items-center gap-3">
        {theme ? <Swatches accent /> : <Monitor className="w-4 h-4" aria-hidden="true" />}
        <span className="font-medium">{label}</span>
      </span>
      {checked && <Check className="w-4 h-4 text-success" aria-hidden="true" />}
    </button>
  );
}

export interface ThemePickerProps {
  preview: ThemeChoice;
  resolved: ThemeId;
  isPreviewing: boolean;
  onSelect: (choice: ThemeChoice) => void;
  onApply: () => void;
}

/**
 * The Settings tab's theme row, modelled on murva's ThemePicker: a dropdown
 * trigger showing the previewed choice, and Apply. Picking a row previews it
 * at once; only Apply persists (R346).
 */
export function ThemePicker({ preview, resolved, isPreviewing, onSelect, onApply }: ThemePickerProps) {
  const { scheme, selectScheme, themes } = useThemePicker(resolved);
  const label = themeChoiceLabel(preview);
  return (
    <div className="flex items-center gap-2">
      <div className="dropdown flex-1">
        {/* A focusable <span>, not a <button>: see DROPDOWN_TRIGGER_NOTE in ui/BottomInputDock.tsx. */}
        <span
          id="btn-theme-picker"
          role="button"
          tabIndex={0}
          aria-label={`Theme: ${label}`}
          className={cx('btn btn-outline w-full justify-between gap-2 font-normal', isPreviewing && 'border-warning/50')}
        >
          <span className="flex min-w-0 items-center gap-2">
            {isPreviewing && <span className="status status-warning" aria-hidden="true" />}
            <Swatches accent={false} />
            <span className="truncate">{label}</span>
          </span>
          <span className="flex items-center gap-2">
            {isPreviewing && <span className="badge badge-warning badge-sm">Previewing</span>}
            <ChevronDown className="w-4 h-4 opacity-60" aria-hidden="true" />
          </span>
        </span>
        <div
          // Focusable so a tap inside keeps the dropdown's :focus-within
          // (Safari never focuses a tapped <button>). Picking a row does NOT
          // blur, unlike DockMenu: the panel stays open while the user previews.
          tabIndex={0}
          role="radiogroup"
          aria-label="Theme"
          className="dropdown-content z-50 mt-2 w-full space-y-2 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          <ThemeOption
            id="theme-option-system"
            label="System (follows OS)"
            checked={preview === 'system'}
            onSelect={() => onSelect('system')}
          />
          <div role="tablist" aria-label="Scheme" className="tabs tabs-box tabs-sm">
            {SCHEME_TABS.map((tab) => (
              <button
                key={tab.id}
                id={`theme-scheme-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={scheme === tab.id}
                onClick={() => selectScheme(tab.id)}
                className={cx('tab flex-1', scheme === tab.id && 'tab-active')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="max-h-90 space-y-1 overflow-y-auto overscroll-contain">
            {themes.map((entry) => (
              <ThemeOption
                key={entry.id}
                id={`theme-option-${entry.id}`}
                theme={entry.id}
                label={entry.label}
                checked={preview === entry.id}
                onSelect={() => onSelect(entry.id)}
              />
            ))}
          </div>
        </div>
      </div>
      <button id="btn-theme-apply" type="button" className="btn btn-primary" disabled={!isPreviewing} onClick={onApply}>
        Apply
      </button>
    </div>
  );
}
```

- [ ] **Step 9: Implement `AppModal` and mount it**

Create `src/components/settings/AppModal.tsx`:

```tsx
import { cx } from '@/components/ui/cx';
import { Modal } from '@/components/ui/Modal';
import { ThemePicker } from './ThemePicker';
import { APP_MODAL_TABS, useAppModal } from './useAppModal';

const REPO_URL = 'https://github.com/themiddnight/solna';

function AboutPanel() {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-lg font-bold">Solna</p>
      <p>A browser audio workstation</p>
      <p className="text-base-content/70">Made by Pathompong Thitithan</p>
      <a id="link-app-repo" href={REPO_URL} target="_blank" rel="noopener noreferrer" className="link link-primary">
        github.com/themiddnight/solna
      </a>
    </div>
  );
}

/**
 * The app modal the wordmark opens on both frames (R348): Settings (the theme
 * picker) and About. Mounted once in Workspace, beside MidiSettingsModal; it
 * calls useThemeChoice, so the OS listener and the theme-color sync run for
 * the whole session (R346, R347).
 */
export function AppModal() {
  const { open, tab, selectTab, close, theme } = useAppModal();
  return (
    <Modal open={open} onClose={close} title="Solna" size="lg" bodyClassName="space-y-4">
      <div role="tablist" aria-label="Solna" className="tabs tabs-border">
        {APP_MODAL_TABS.map(({ id, label }) => (
          <button
            key={id}
            id={`app-modal-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`app-modal-panel-${id}`}
            onClick={() => selectTab(id)}
            className={cx('tab', tab === id && 'tab-active')}
          >
            {label}
          </button>
        ))}
      </div>
      {/* min-h-120 holds the open theme panel: the modal body scrolls, so it
          would otherwise clip the absolutely positioned dropdown. */}
      <div
        id="app-modal-panel-settings"
        role="tabpanel"
        aria-labelledby="app-modal-tab-settings"
        hidden={tab !== 'settings'}
        className="min-h-120 space-y-2"
      >
        <h4 className="text-sm font-semibold">Theme</h4>
        <ThemePicker
          key={String(open)}
          preview={theme.preview}
          resolved={theme.resolved}
          isPreviewing={theme.isPreviewing}
          onSelect={theme.select}
          onApply={theme.apply}
        />
      </div>
      <div id="app-modal-panel-about" role="tabpanel" aria-labelledby="app-modal-tab-about" hidden={tab !== 'about'}>
        <AboutPanel />
      </div>
    </Modal>
  );
}
```

In `src/App.tsx`: add `import { AppModal } from './components/settings/AppModal';` beside the `MidiSettingsModal` import, and directly after `<MidiSettingsModal />` in `Workspace`'s return add:

```tsx
      {/* The wordmark's Settings | About modal; owns the live theme (R346). */}
      <AppModal />
```

- [ ] **Step 10: Run the tests and gates**

Run: `bun test src/components/settings src/store/uiSlice.test.ts && bun run lint && bun run eslint`
Expected: PASS; zero errors and zero warnings. If jsx-a11y reports `no-noninteractive-tabindex` on the `role="radiogroup"` panel, add the same line-level disable `DockMenu` uses, with the reason "focusable so a tap inside keeps the dropdown's :focus-within (Safari)".

- [ ] **Step 11: Run the full gate once**

Run: `bun run verify`
Expected: PASS — the new files are now reachable from `src/main.tsx`, so both Knip scans are clean. (The old `ThemeToggle` still exists; it is removed in Task 5.)

- [ ] **Step 12: Commit**

```bash
git add src/store/types.ts src/store/uiSlice.ts src/store/uiSlice.test.ts src/components/settings src/App.tsx
git commit -m "feat(settings): add the Settings | About app modal with a theme picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wordmark opens the modal; ProjectMenu gets a chevron trigger

**Files:**
- Modify: `src/components/ui/Wordmark.tsx`, `src/components/ui/Wordmark.test.tsx`
- Create: `src/components/settings/AppWordmark.tsx`
- Modify: `src/components/project/ProjectMenu.tsx` (`ProjectMenu()` at the end of the file; the `Wordmark` import), `src/components/project/ProjectMenu.test.tsx` (`describe('ProjectMenu rendering'`)
- Modify: `src/components/Header.tsx`, `src/components/Header.test.tsx`
- Modify: `src/components/shell/MobileTopBar.tsx`, `src/components/shell/mobileShell.test.tsx`
- Modify: `src/components/ui/BottomInputDock.tsx` (the `DROPDOWN_TRIGGER_NOTE` comment only)

**Interfaces:**
- Consumes: `useOpenAppModal(): () => void` (Task 3).
- Produces: `Wordmark({ onClick, markOnly? })` renders `<button id="btn-app-modal" type="button" aria-haspopup="dialog" aria-label="Solna — settings and about">`; `AppWordmark()`; ProjectMenu trigger `<span id="btn-project-menu" role="button" tabIndex={0} aria-label="Project menu">`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/components/ui/Wordmark.test.tsx` with:

```tsx
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Wordmark } from './Wordmark';

const noop = () => {};

describe('Wordmark', () => {
  // A real <button> now: it opens the app modal, and is no longer a dropdown
  // trigger (the project menu has its own chevron) — R348.
  test('is a button that announces a dialog, with a 44px target', () => {
    const html = renderToString(<Wordmark onClick={noop} />);
    expect(html.startsWith('<button')).toBe(true);
    expect(html).toContain('id="btn-app-modal"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('min-h-11 min-w-11');
    expect(html).toContain('h-8 w-8');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex');
  });

  test('its accessible name contains the visible word (label in name)', () => {
    expect(renderToString(<Wordmark onClick={noop} />)).toContain('aria-label="Solna — settings and about"');
  });

  test('shows a hover and focus-visible affordance from theme tokens', () => {
    const html = renderToString(<Wordmark onClick={noop} />);
    expect(html).toContain('hover:bg-base-200');
    expect(html).toContain('focus-visible:outline-primary');
  });

  test('markOnly drops the text', () => {
    expect(renderToString(<Wordmark onClick={noop} markOnly />)).not.toContain('solna</span>');
  });
});
```

In `src/components/project/ProjectMenu.test.tsx`, replace the test `'renders a labelled dropdown trigger and a hidden file picker'` with (add the `openTag` helper from Task 3 at the top of the file if the file has none):

```tsx
  test('renders a chevron dropdown trigger, a focusable span, and a hidden file picker', () => {
    const html = renderToString(<ProjectMenu />);
    expect(html).toContain('dropdown');
    const trigger = openTag(html, 'aria-label="Project menu"');
    expect(trigger.startsWith('<span')).toBe(true);
    expect(trigger).toContain('id="btn-project-menu"');
    expect(trigger).toContain('role="button"');
    expect(trigger).toContain('tabindex="0"');
    expect(html).not.toContain('solna</span>'); // the wordmark is no longer inside the menu
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".solna,.json"');
  });
```

In `src/components/Header.test.tsx`, inside `describe('the tabs lead the header, the subject run follows'`, add:

```tsx
  test('the wordmark leads, the project chevron sits right after it, then the tab nav', () => {
    const wordmarkAt = src.indexOf('<AppWordmark />');
    expect(wordmarkAt).toBeGreaterThan(-1);
    expect(src.indexOf('<ProjectMenu />')).toBeGreaterThan(wordmarkAt);
    expect(navAt).toBeGreaterThan(src.indexOf('<ProjectMenu />'));
  });
```

In `src/components/shell/mobileShell.test.tsx`, extend `'the top bar shows the full wordmark, and its field tools keep their desktop heights'`:

```tsx
    expect(html).toContain('id="btn-app-modal"'); // the wordmark opens the app modal on the phone too
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/components/ui/Wordmark.test.tsx src/components/project/ProjectMenu.test.tsx src/components/Header.test.tsx src/components/shell/mobileShell.test.tsx`
Expected: FAIL — Wordmark is a span; ProjectMenu's trigger is the Wordmark; Header has no `<AppWordmark />`; no `btn-app-modal` in the top bar.

- [ ] **Step 3: Rewrite `Wordmark`**

Replace `src/components/ui/Wordmark.tsx` with:

```tsx
import { cx } from './cx';

interface WordmarkProps {
  /** Opens the app modal (R348). */
  onClick: () => void;
  /** Hide the "Solna" text and show the logo mark only. */
  markOnly?: boolean;
}

/**
 * The brand wordmark: a real <button> that opens the app modal (Settings |
 * About) on both frames (R348). It is no longer a dropdown trigger — the
 * project menu has its own chevron beside it — so a click is all it needs,
 * and Safari's refusal to focus a tapped button does not matter here.
 */
export function Wordmark({ onClick, markOnly = false }: WordmarkProps) {
  return (
    <button
      id="btn-app-modal"
      type="button"
      aria-label="Solna — settings and about"
      aria-haspopup="dialog"
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-2 min-h-11 min-w-11 px-1.5',
        'rounded-box cursor-pointer transition-colors hover:bg-base-200',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
      )}
    >
      <img src="/assets/favicon.svg" alt="" className="h-8 w-8" draggable={false} />
      {!markOnly && (
        <span className="text-2xl font-normal text-primary leading-none" style={{ letterSpacing: '0.08em' }}>
          solna
        </span>
      )}
    </button>
  );
}
```

(`chevron`, `ariaLabel`, `interactive` and `className` are gone: none has a caller after this task.)

Create `src/components/settings/AppWordmark.tsx`:

```tsx
import { Wordmark } from '@/components/ui/Wordmark';
import { useOpenAppModal } from './useAppModal';

/** The wordmark wired to the app modal — the one both frames render (R348). */
export function AppWordmark() {
  const openAppModal = useOpenAppModal();
  return <Wordmark onClick={openAppModal} />;
}
```

- [ ] **Step 4: Give `ProjectMenu` its chevron trigger**

In `src/components/project/ProjectMenu.tsx`: delete `import { Wordmark } from '../ui/Wordmark';`, add `ChevronDown` to the `lucide-react` import, and in `ProjectMenu()` replace `<Wordmark ariaLabel="Project menu" chevron />` with:

```tsx
      {/* A focusable <span>, not a <button>: see DROPDOWN_TRIGGER_NOTE in ui/BottomInputDock.tsx. */}
      <span
        id="btn-project-menu"
        role="button"
        tabIndex={0}
        aria-label="Project menu"
        className="inline-flex min-h-11 min-w-8 items-center justify-center rounded-box cursor-pointer transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ChevronDown className="w-4 h-4 text-base-content/60" aria-hidden="true" />
      </span>
```

The `<ul>` panel and `ProjectMenuEffects` stay as they are.

- [ ] **Step 5: Wire both frames**

In `src/components/Header.tsx`: add `import { AppWordmark } from './settings/AppWordmark';` and replace the `<ProjectMenu />` line (keep the comment above it, reworded) with:

```tsx
        {/* The desktop frame only: the phone has its own top bar
            (`shell/MobileTopBar.tsx`). The wordmark opens the app modal; the
            chevron right after it is the project menu (R348). */}
        <div className="flex items-center">
          <AppWordmark />
          <ProjectMenu />
        </div>
```

In `src/components/shell/MobileTopBar.tsx`: replace `import { Wordmark } from '@/components/ui/Wordmark';` with `import { AppWordmark } from '@/components/settings/AppWordmark';` and `<Wordmark interactive={false} />` with `<AppWordmark />`. Update the `MobileTopBar` doc comment: "the wordmark (which opens the app modal), the layer's field tools …".

In `src/components/ui/BottomInputDock.tsx`, in `DROPDOWN_TRIGGER_NOTE`, replace "the same shape as the project menu's Wordmark trigger." with "the same shape as the project menu's chevron trigger and the theme picker's trigger."

- [ ] **Step 6: Run the tests and gates**

Run: `bun test src/components && bun run lint && bun run eslint`
Expected: PASS; zero errors and zero warnings.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/Wordmark.tsx src/components/ui/Wordmark.test.tsx src/components/settings/AppWordmark.tsx src/components/project/ProjectMenu.tsx src/components/project/ProjectMenu.test.tsx src/components/Header.tsx src/components/Header.test.tsx src/components/shell/MobileTopBar.tsx src/components/shell/mobileShell.test.tsx src/components/ui/BottomInputDock.tsx
git commit -m "feat(header): open the app modal from the wordmark; move the project menu to a chevron

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Remove `ThemeToggle`, `useTheme` and the `theme` Header tool

**Files:**
- Delete: `src/components/header/ThemeToggle.tsx`, `src/components/header/useTheme.ts`
- Modify: `src/components/header/headerTools.ts`
- Modify: `src/components/Header.tsx` (right-cluster comment)
- Modify: `src/components/Header.test.tsx`, `src/components/shell/mobileShell.test.tsx`, `src/components/header/toolRows.test.tsx`
- Modify (comments only): `src/App.tsx` (`registerFirstGesture` doc), `src/store/uiSlice.ts` (`readStoredKeyboardMode` doc), `src/components/loop/useSoundDepth.ts` (guard comment)

**Interfaces:**
- Consumes: `parseThemeChoice` (Task 1), `readThemeChoice` (Task 2) — named in comments only.
- Produces: `HeaderToolId` without `'theme'`.

- [ ] **Step 1: Update the tests to the new roster (failing)**

`src/components/shell/mobileShell.test.tsx`:
- `'loop layer: loop picker and key inline; vibes, copy and theme in the menu'` → rename to `'loop layer: loop picker and key inline; vibes and copy in the menu'`, expect `ids(menu)` to equal `['vibes', 'loop-copy']`.
- `'song layer: project name inline; follow, export and theme in the menu'` → rename to `'song layer: project name inline; follow and export in the menu'`, expect `['follow-playhead', 'export']`.
- In the two menu-sheet tests, remove `'btn-toggle-theme'` from the "contains" id lists, rename them to drop "theme", and add `expect(html).not.toContain('id="btn-toggle-theme"');` to each.

`src/components/Header.test.tsx`:
- Delete the import `import { persistTheme, readStoredTheme, resolveInitialTheme } from './header/useTheme';`.
- Delete everything from `describe('resolveInitialTheme', () => {` through the closing `});` of `describe('persistTheme', …)`, including the comment and the `throwingGetStorage` / `throwingSetStorage` stubs between them (their replacements live in `settings/useThemeChoice.test.ts`).
- In `describe('the tabs lead the header, the subject run follows'`: change `const subject = HEADER_TOOLS.filter((tool) => tool.id !== 'theme').map((tool) => tool.id);` to `const subject = HEADER_TOOLS.map((tool) => tool.id);`, and replace the test `'the Header renders the tab nav, then the tools, the theme last'` with:

```tsx
  test('the Header renders the tab nav, then the tools; the theme is not a tool', () => {
    expect(navAt).toBeGreaterThan(-1);
    expect(src.indexOf('headerToolsOn(')).toBeGreaterThan(navAt);
    expect(HEADER_TOOLS.map((tool) => tool.id as string)).not.toContain('theme');
  });
```

`src/components/header/toolRows.test.tsx`: delete `import { ThemeToggle } from './ThemeToggle';` and the `['ThemeToggle', …]` row of `ROW_TOOLS`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/components/shell/mobileShell.test.tsx src/components/Header.test.tsx`
Expected: FAIL — the menus still hold `theme` and the sheet still renders `btn-toggle-theme`.

- [ ] **Step 3: Remove the tool**

```bash
git rm src/components/header/ThemeToggle.tsx src/components/header/useTheme.ts
```

In `src/components/header/headerTools.ts`: delete `import { ThemeToggle } from './ThemeToggle';`, remove `| 'theme'` from `HeaderToolId`, delete the `{ id: 'theme', Component: ThemeToggle, layers: BOTH },` row, and delete `const BOTH …` (no row uses it any more).

In `src/components/Header.tsx`, in the right-cluster comment, delete "; then the theme" so the sentence ends "…per `HEADER_TOOLS`' order."

- [ ] **Step 4: Repoint the comments that named `useTheme`**

- `src/App.tsx`, `registerFirstGesture` doc: "same pattern as `resolveInitialTheme` in `components/header/useTheme.ts`" → "same pattern as `parseThemeChoice` in `components/settings/themes.ts`".
- `src/store/uiSlice.ts`, above `readStoredKeyboardMode`: "Mirrors `readStoredTheme` in `components/header/useTheme.ts`" → "Mirrors `readThemeChoice` in `components/settings/useThemeChoice.ts`".
- `src/components/loop/useSoundDepth.ts`: "the same rule `header/useTheme.ts`'s theme helpers follow" → "the same rule `settings/useThemeChoice.ts`'s theme helpers follow".

Then confirm nothing else names the deleted files:

Run: `grep -rn "useTheme\b\|ThemeToggle\|resolveInitialTheme\|readStoredTheme\|persistTheme\|btn-toggle-theme" src scripts index.html`
Expected: no output.

- [ ] **Step 5: Run the gate**

Run: `bun run verify`
Expected: PASS, including both Knip scans (no dead export or file left behind) and zero ESLint warnings.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/header src/components/Header.tsx src/components/Header.test.tsx src/components/shell/mobileShell.test.tsx src/App.tsx src/store/uiSlice.ts src/components/loop/useSoundDepth.ts
git commit -m "refactor(header): remove the theme toggle; the theme lives in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rules, ADR-0051 and the design doc

**Files:**
- Modify: `.claude/rules/theming.md`, `.claude/rules/components.md`, `.claude/rules/persistence.md`, `.claude/rules/testing.md`
- Create: `docs/decisions/0051-theme-picker.md`
- Modify: `docs/decisions/README.md` (index row), `docs/decisions/0022-persist-write-path-and-guarded-storage.md` (path correction only)
- Modify: `docs/design.md`, `CLAUDE.md`

**Interfaces:** New rule ids **R344–R348** (the highest existing id is R343 — re-check with `grep -rhoE "R[0-9]{3}" .claude/rules CLAUDE.md docs/decisions | sort -u | tail -1` and shift all five if it moved).

- [ ] **Step 1: `theming.md`**

Replace the first paragraph under `# Theming — the hard rule` (the "Two daisyUI themes…" paragraph) with:

```markdown
Two Solna themes (`solna-dark`, `solna-light`) are declared CSS-first in `src/index.css` via
`@plugin "daisyui/theme"`; every daisyUI built-in in the installed major is listed beside them.
**There is no `tailwind.config.*` and none may be added.**

## Theme roster and choice

- The roster is `THEMES` in `src/components/settings/themes.ts`: the two Solna themes, then the
  daisyUI built-ins alphabetically, each with a hand-written `scheme`. `index.css`'s `themes:` list
  and both light palette selectors (`--key-*`/`--roll-key-*` and `--module-*`/`--drum-*`) repeat
  it; `themes.test.ts` binds all three to the registry and each built-in's `scheme` to the
  `color-scheme` in `node_modules/daisyui/theme/<id>.css`. A daisyUI upgrade that adds, drops or
  re-schemes a theme fails there. Dark themes fall through to the `:root` / `solna-dark` blocks. <!-- R344 -->
- `solna_theme` holds a `ThemeChoice` — a roster id or `system` — validated on read by
  `parseThemeChoice` (absent/unknown → `system`); `system` resolves to `solna-light`/`solna-dark`
  by `prefers-color-scheme`, live. `index.html`'s blocking script mirrors `resolveTheme` and sets
  any other value verbatim; `themeBootstrap.test.ts` pins the two together. <!-- R345 -->
- Choosing a theme previews it (`data-theme` on `<html>` only); only **Apply** persists; closing
  the app modal by any path reverts an unapplied preview. Theme state lives in
  `useThemeChoice` (`createThemeChoiceStore`), called once by the always-mounted `AppModal`, and
  never enters a zustand slice. <!-- R346 -->
- `<meta name="theme-color">` follows the painted theme: the live `--color-base-200` resolved to
  `rgb()` through `utils/themeColor.ts`, rewritten on every repaint. <!-- R347 -->

([ADR-0051](../../docs/decisions/0051-theme-picker.md))
```

Keep the "Components name **roles**…" paragraph and everything after it. Add `"index.html"` to the front-matter `paths:` list. In `## Palette contrast gate`, change "in both themes" to "in both Solna palettes (the light one also serves every light daisyUI theme)". Append to `## Prohibited`:

```markdown
- A theme in `index.css` or a light palette selector that is not in `THEMES`, or the reverse <!-- R344 -->
- A migration or version bump for `solna_theme`; a bootstrap that disagrees with `resolveTheme` <!-- R345 -->
- Persisting on select, or a theme value in a zustand slice <!-- R346 -->
- An `oklch()` or hard-coded `theme-color` written at runtime <!-- R347 -->
```

- [ ] **Step 2: `components.md`**

Under `## Layout shell`, after the R317 bullet, add:

```markdown
- The wordmark (`ui/Wordmark.tsx`, rendered through `settings/AppWordmark.tsx`) is a `<button>` that opens the app modal (Settings | About, `settings/AppModal.tsx`, open flag `isAppModalOpen`) on both frames; on desktop the project menu's trigger is the chevron `<span role="button">` right after it. The theme is chosen only in Settings — it is not a `HEADER_TOOLS` row. <!-- R348 --> ([ADR-0051](../../docs/decisions/0051-theme-picker.md))
```

Append to `## Prohibited`: `- A theme control outside the app modal's Settings tab, or a wordmark that is not the app modal's button <!-- R348 -->`

- [ ] **Step 3: `persistence.md`, `testing.md`, ADR-0022**

- `persistence.md` front-matter `paths:`: replace `"src/components/header/useTheme.ts"` with `"src/components/settings/useThemeChoice.ts"` and `"src/components/settings/themes.ts"`. In the R244 bullet, replace "(`header/useTheme.ts` theme functions)" with "(`settings/useThemeChoice.ts` theme functions)".
- `testing.md`: replace "`resolveInitialTheme`/`persistTheme` from `header/useTheme.ts`" with "`parseThemeChoice` from `settings/themes.ts`, `createThemeChoiceStore` from `settings/useThemeChoice.ts`".
- `docs/decisions/0022-persist-write-path-and-guarded-storage.md`: the two mentions of `components/header/useTheme.ts` / `header/useTheme.ts` become `components/settings/useThemeChoice.ts` / `settings/useThemeChoice.ts` (a renamed-file correction, allowed in place by the ADR README).

- [ ] **Step 4: ADR-0051**

Create `docs/decisions/0051-theme-picker.md`:

```markdown
# ADR-0051: Theme picker — every daisyUI theme, System default, preview then apply

**Status:** Accepted — 2026-09-25. No issue.

## Context

Solna shipped two themes and a header toggle between them (`ThemeToggle`, `header/useTheme.ts`).
The wordmark was the project menu's trigger. Users asked for more themes; murva already offers
daisyUI's built-ins through a preview-then-apply picker. The `--drum-*`/`--module-*` and piano-key
palettes exist only for the two Solna themes, and `<meta name="theme-color">` was a static dark hex.

## Decision

- The wordmark is a `<button>` that opens an app modal (Settings | About), on both frames; the
  project menu moves to a chevron trigger beside it (desktop) and stays in the ☰ sheet (mobile).
  `ThemeToggle` and the `theme` `HEADER_TOOLS` row are removed.
- The roster is `THEMES` in `components/settings/themes.ts`: Solna Dark, Solna Light, then every
  daisyUI built-in of the installed major. Sync tests bind `index.css` and the installed daisyUI
  theme files to it.
- `solna_theme` holds a `ThemeChoice`; `system` (the default) follows `prefers-color-scheme` live.
  Legacy values are valid choices, so there is no migration (ADR-0023).
- Picking a theme previews it; Apply persists; closing the modal reverts. The state is a small
  env-injected store (`createThemeChoiceStore`) wrapped by `useThemeChoice`, called by the
  always-mounted `AppModal`; never a zustand slice.
- The palettes follow the scheme through CSS: the light blocks' selectors list every light theme.
- `theme-color` is rewritten from the live `base-200`, as `rgb()`, on every repaint.

Rejected:

- **A runtime `data-palette` attribute** chosen by scheme: the bootstrap would need the roster's
  schemes too, duplicating the registry inside `index.html`, and a second attribute to keep in step.
- **Persist on select** (murva's behaviour is preview-first; a stray click would otherwise stick).
- **Keeping the header toggle** beside Settings: two controls for one choice, and a two-state
  toggle cannot express 37 themes plus System.
- **`themes: all`** in the daisyUI plugin: the roster would not be a list a test can compare.

## Consequences

- The stylesheet grows by every built-in theme's variables: <raw before → after, gzip before →
  after from Task 1 Step 11>.
- A daisyUI upgrade that changes the built-in roster fails `themes.test.ts` until the registry,
  `index.css` and the light selectors are updated together.
- `check-contrast` measures only the two Solna palettes; a light daisyUI theme shows the light
  palette on its own base colours, which the gate does not measure.
- An unknown stored id paints with daisyUI's default until React mounts and corrects it.

## Rules this implies

- **R344** — the theme roster is `THEMES`; `index.css`'s list and light selectors are bound to it by test (`theming.md`).
- **R345** — `solna_theme` holds a validated `ThemeChoice`; the bootstrap mirrors `resolveTheme` (`theming.md`).
- **R346** — select previews, Apply persists, close reverts; theme state never in a slice (`theming.md`).
- **R347** — `theme-color` follows the painted theme as `rgb()` (`theming.md`).
- **R348** — the wordmark opens the app modal; the theme is chosen only in Settings (`components.md`).

## Sources

Spec `docs/superpowers/specs/2026-09-25-theme-picker-modal-design.md`; plan
`docs/superpowers/plans/2026-09-25-theme-picker-modal.md`.
```

Fill the size placeholder with the numbers measured in Task 1 before committing. Add to the index table in `docs/decisions/README.md`, after the 0050 row:

```markdown
| [0051](0051-theme-picker.md) | Theme picker | The wordmark opens Settings / About; any Solna or daisyUI theme, System by default, previewed then applied; palettes follow the scheme through CSS selectors bound to a registry by test. |
```

- [ ] **Step 5: `docs/design.md` and `CLAUDE.md`**

- `docs/design.md` §2 opening sentence: "featuring two custom-crafted warm-tinted themes" → "featuring two custom-crafted warm-tinted themes (Solna Dark and Solna Light) plus every daisyUI built-in theme, chosen in Settings (ADR-0051)".
- The `> Both themes are declared CSS-first…` note: replace its last sentence with "The active theme is `document.documentElement.dataset.theme`; `solna_theme` in `localStorage` holds the choice (a theme id or `system`), and `index.html` resolves it in a blocking `<head>` script so light-theme users never see a dark first paint."
- §4 item 1 (`Header.tsx`): replace "Project modal trigger, the **Theme Toggle** button," with "the wordmark (opens the Settings / About modal) and the project menu's chevron,".
- The "Solna has exactly two themes, and every surface must work in both." sentence → "Every surface must work in every theme — the two Solna themes and every daisyUI built-in."
- `CLAUDE.md`: the `check:contrast` comment "(both themes)" → "(both Solna palettes)"; the rules-table row for `theming.md` → "Theme tokens, the theme roster and choice, and the palette contrast gate".

- [ ] **Step 6: Check the docs**

Run: `grep -rn "useTheme\b\|ThemeToggle\|Theme Toggle\|two daisyUI themes\|exactly two themes" .claude docs/design.md docs/decisions/0022-persist-write-path-and-guarded-storage.md CLAUDE.md`
Expected: no output. Then `bun run verify` → PASS.

- [ ] **Step 7: Commit**

```bash
git add .claude/rules docs/decisions docs/design.md CLAUDE.md
git commit -m "docs(theme): record the theme picker in ADR-0051 and rules R344-R348

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Browser verification and the completion gate

**Files:** `work/browser-evidence.md` (disposable working note, not committed). No product code unless a check fails — a failure goes back to the owning task's file with a test first where the runner can express it.

- [ ] **Step 1: Start the app**

Run: `bun run dev` (background) and open `http://localhost:3000` in a Chromium browser with DevTools. Clear `localStorage.solna_theme` first.

- [ ] **Step 2: Desktop (1280 × 800) checks** — record each result in `work/browser-evidence.md`

1. The wordmark opens the modal titled "Solna" on **Settings**; the chevron right of it opens the project menu, and a row (e.g. New) still works.
2. Open the theme trigger: the panel is fully visible inside the modal (not clipped by the body), the list scrolls at 360px, each row shows its own colours and dots.
3. Pick `dracula`: `document.documentElement.dataset.theme === 'dracula'`; the trigger shows the warning dot and "Previewing"; Apply is enabled; `document.querySelector('meta[name="theme-color"]').content` is an `rgb(…)` matching Dracula's base-200.
4. With a preview active, the Master tab visualizer / Sound oscilloscope canvases repaint in the preview colours (switch tabs behind the modal after closing if needed — record what you saw).
5. Revert paths: with an unapplied preview, (a) Escape, (b) backdrop click, (c) close button — each restores the applied theme and `theme-color`. Switching to **About** keeps the preview; About shows the name, description, author and the repo link opening in a new tab.
6. Apply `nord`, reload: no dark flash; `localStorage.solna_theme === 'nord'`.
7. Pick **System (follows OS)** and Apply: `localStorage.solna_theme === 'system'`; toggle DevTools → Rendering → `prefers-color-scheme` light/dark and watch `data-theme` switch between `solna-light`/`solna-dark` live.
8. A light daisyUI theme (`cupcake`): piano keys and Beat/module colours use the light palette.
9. Reopen the modal: it reopens on the last tab used; the Dark | Light tab matches the current theme's scheme.

- [ ] **Step 3: Mobile (390 × 844, device emulation) checks**

1. The top-bar wordmark opens the same modal; the ☰ sheet has no theme row and still lists the project rows.
2. The theme panel is not clipped (scroll the modal body if needed) and rows are ≥ 44px tall.
3. Repeat check 5 (revert on close) once.

- [ ] **Step 4: Note what this environment cannot prove**

iOS Safari focus behaviour (the reason for the `span` triggers) cannot be emulated in Chromium; list "chevron menu and theme dropdown open and stay open on an iPhone" as a manual check for the user in the final summary.

- [ ] **Step 5: Run the completion gate**

Run: `bun run verify && bun run eslint`
Expected: every step PASS; ESLint prints zero errors and zero warnings; both Knip scans report nothing. State each warning seen (if any) and its fix or line-level suppression in the summary.

- [ ] **Step 6: Commit any fixes** made during this task with a conventional message ending in the `Co-Authored-By` line; then report the stylesheet delta, the browser results and the manual iOS item.

---

## Self-Review

- **Spec coverage:** wordmark button + chevron (T4); `span` triggers (T3, T4); modal size lg, title, tabs, remembered tab, mounted in Workspace, session flag excluded from partialize (T3); picker trigger, Apply, warning dot/Previewing, System row, Dark/Light tabs, Solna-first ordering, `data-theme` rows, radio semantics, preview/apply/revert-on-close, About-no-revert, min-height/max-h (T3, verified T7); About content (T3); registry types and functions (T1); persistence and guarded storage (T2); bootstrap (T2); hook incl. matchMedia and theme-color (T2); CSS list + light selectors + check-contrast (T1); build size (T1, ADR T6); tests listed in the spec (T1–T5); ThemeToggle removal + test updates (T5); docs (T6); browser checks + gate (T7).
- **Placeholders:** the only fill-in is the measured CSS size in the Task 1 commit body and the ADR, which cannot be known before the build runs.
- **Type consistency:** `ThemeChoice`, `ThemeId`, `ThemeScheme`, `ThemeEntry`, `UseThemeChoice` (`applied`/`preview`/`resolved`/`isPreviewing`/`select`/`apply`/`revert`), `closeAppModal(revert, setOpen)`, `useOpenAppModal()`, `ThemePickerProps` are used with the same names and shapes in every task.
- **Review Focus:** each of the five lines has its test in Task 2 or Task 3.

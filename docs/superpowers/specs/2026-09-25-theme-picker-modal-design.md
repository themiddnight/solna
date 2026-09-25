# Theme picker modal — design

Date: 2026-09-25 · Branch: `feat/theme-picker-modal` · No Linear issue

## Goal

Clicking the wordmark opens an app modal with two tabs — **Settings** (a theme picker) and
**About** — instead of the project menu. The project menu moves to its own chevron trigger.
The theme picker lists the Solna themes (renamed "Solna Dark" / "Solna Light" in the UI) plus
every daisyUI built-in theme, with preview-then-apply behaviour modelled on murva's
`ThemePicker` (`../murva/murva-app/app/frontend/src/shared/components/ThemePicker.tsx`).

## Decisions (agreed in brainstorming)

1. `ThemeToggle` is removed from `HEADER_TOOLS`; the theme is chosen only in Settings.
2. On mobile the wordmark in `MobileTopBar` becomes interactive and opens the same modal; the
   ☰ menu sheet is unchanged (it loses the theme row because the tool is gone).
3. All daisyUI built-in themes in the installed major are listed (35 at the time of writing —
   the registry test, not this document, is the source of truth for the roster).
4. A **System** choice follows the OS: `solna-light` / `solna-dark` by
   `prefers-color-scheme`, live. It is the default when nothing is stored.
5. `--drum-*` / `--module-*` palettes follow the theme's scheme through CSS selectors bound to
   a TS registry (not a runtime `data-palette` attribute).
6. `<meta name="theme-color">` follows the active theme.

## UI

### Header (desktop) and top bar (mobile)

- `Wordmark` becomes a real `<button>` taking `onClick`; the `chevron` prop is removed. It
  opens the app modal. The `interactive={false}` static rendering is no longer used by the
  top bar; remove the prop if nothing else needs it (Knip decides).
- `ProjectMenu`'s dropdown trigger becomes a chevron-down control labelled "Project menu",
  placed right after the wordmark. It must be a focusable `<span tabIndex={0}
  role="button">`, **not** a `<button>`: daisyUI's dropdown opens on `:focus-within` and iOS
  Safari never focuses a tapped `<button>` (see commit `d661b013`, `BottomInputDock`). The
  menu rows and effects are unchanged.

### App modal

- Built on `ui/Modal` (overlay kind "modal", R325; pinned header, scrolling body, R339),
  size `lg`, title "Solna".
- A `role="tablist"` with **Settings | About** under the title. Opens on Settings; the last
  tab is remembered for the session (component state — the modal stays mounted).
- Mounted once in `Workspace` (`App.tsx`) beside `MidiSettingsModal`. Open state is a
  session-only `uiSlice` flag (`isAppModalOpen` / `setIsAppModalOpen`), excluded from
  `partialize` like `isMidiSettingsOpen`.

### Settings tab — Theme

Modelled on murva:

- One row: a theme trigger `[● ● <label> ▾]` (primary/secondary dots, current label) and an
  **Apply** button. While the preview differs from the applied choice the trigger shows a
  warning dot and a "Previewing" tag; Apply is disabled when they are equal.
- The trigger is a daisyUI dropdown using the same focusable-`span` pattern as above; its
  panel is a focusable list so it stays open while the user previews.
- Panel contents, top to bottom: a **System (follows OS)** row; a **Dark | Light** tab
  switcher (local state; opens on the tab matching the current preview's scheme); the theme
  list for that tab — the Solna theme of that scheme first, then the daisyUI themes
  alphabetically. Each row is wrapped in `data-theme={id}` and shows primary / secondary /
  accent dots rendered in that theme, the label, and a check on the previewed choice.
  Radio-group semantics.
- Choosing a row previews immediately (writes `data-theme` on `<html>`) without persisting.
- **Apply** persists the choice. **Closing the modal** by any path (Escape, backdrop, close
  button) with an unapplied preview reverts to the applied choice. Switching to About does
  not revert.
- Clipping: the modal body scrolls, so it can clip an absolutely positioned panel. The
  Settings tab gets a `min-height` that holds the panel, and the list scrolls inside a
  `max-h` (murva uses 360px). Verified in the browser at mobile and desktop widths.

### About tab

- App name and a one-line description ("A browser audio workstation").
- "Made by Pathompong Thitithan".
- A link to `https://github.com/themiddnight/solna`, `target="_blank"`,
  `rel="noopener noreferrer"`.

## Theme model

### Registry — `src/components/settings/themes.ts`

```ts
type ThemeScheme = 'dark' | 'light';
interface ThemeEntry { id: ThemeId; label: string; scheme: ThemeScheme }
export const THEMES: readonly ThemeEntry[];          // solna-dark, solna-light, then daisyUI
export type ThemeChoice = ThemeId | 'system';
export function parseThemeChoice(stored: string | null): ThemeChoice; // unknown/null → 'system'
export function resolveTheme(choice: ThemeChoice, prefersLight: boolean): ThemeId;
```

Labels are title-cased ids for daisyUI themes and "Solna Dark" / "Solna Light" for ours.
The `scheme` of each daisyUI theme is written by hand.

### Persistence

- Same key, `solna_theme`, now holding a `ThemeChoice`. The legacy values `solna-dark` /
  `solna-light` are valid choices as-is, and an absent value parses to `system`, which is
  today's first-visit behaviour — so no migration: validated on read (R214).
- Reads and writes go through the guarded storage helpers in `@/utils/storage` (R244); a
  throwing `setItem` keeps the session theme and loses only cross-session persistence.

### Bootstrap — `index.html`

The blocking head script: stored value absent or `system` → resolve by
`prefers-color-scheme`; any other value → set as `data-theme` verbatim. An unknown id is
harmless: `solna-dark` is daisyUI's `--default` (bound to `:root`), and the React side then
corrects it. The existing test that pins bootstrap ≡ TS resolution is updated.

### Hook — `src/components/settings/useThemeChoice.ts`

Replaces `components/header/useTheme.ts` (deleted with `ThemeToggle.tsx`).

- State: `applied: ThemeChoice` (persisted) and `preview: ThemeChoice` (on screen).
- `select(choice)` sets `preview` and writes `data-theme`.
- `apply()` persists `preview` and sets `applied = preview`.
- `revert()` sets `preview = applied` and restores `data-theme`.
- Subscribes to `matchMedia('(prefers-color-scheme: light)')` changes; when `preview` is
  `system`, the resolved theme follows the OS live.
- After every `data-theme` change (and once on mount) it writes
  `<meta name="theme-color">` from the live `base-200` colour (the `<body>` background)
  resolved through `utils/themeColor.ts`, which yields `rgb()` — daisyUI 5 colours are
  `oklch()`, whose support in `theme-color` is not assumed. Before React mounts, the static
  `#17100F` in `index.html` stands.
- Called by the app modal, which is always mounted, so the OS listener and meta sync always
  run. Theme state never enters a zustand slice.

Canvas colours already refresh on `data-theme` mutations (`themeColor.ts` observes the
attribute), so previews repaint canvases without further work — confirm in the browser.

## CSS — `src/index.css`

- `@plugin "daisyui" { themes: … }` lists `solna-dark --default, solna-light` and every
  daisyUI built-in. Measure the stylesheet growth in `bun run build` and report it.
- The light `--drum-*` / `--module-*` block's selector grows from
  `[data-theme="solna-light"]` to that plus every light daisyUI theme. Dark themes fall
  through to the `:root, [data-theme="solna-dark"]` block.
- `scripts/check-contrast.ts` finds blocks with `selector.includes(...)`; confirm it still
  measures exactly the two Solna palettes and adjust if not.

## Tests

- `themes.ts`: `parseThemeChoice` (legacy values, `system`, unknown, null) and
  `resolveTheme`.
- Registry sync: (a) the `themes:` list in `index.css` equals the registry ids; (b) the light
  palette selector equals the registry's light ids; (c) every daisyUI entry's `scheme`
  matches `color-scheme` in `node_modules/daisyui/theme/<id>.css`, and every file there has an
  entry — an upgrade that adds, drops or re-schemes a theme fails.
- `useThemeChoice`: select → apply persists; select → revert restores; OS change while
  `system` re-resolves; a throwing storage keeps the session theme; meta `theme-color` is
  written.
- App modal / picker / wordmark / project menu: `renderToString` structure tests, minding the
  store-before-render trap (R257).
- Update tests that pin `HEADER_TOOLS` ending in `theme`, and the `Wordmark` tests.
- Browser check (desktop + mobile width): dropdown not clipped, revert on close, canvas colours
  on preview, `theme-color` updates, chevron menu opens.
- Gate: `bun run verify`, `bun run eslint` with zero warnings, both Knip scans clean.

## Docs

- `.claude/rules/theming.md`: replace "two daisyUI themes" with the registry rule, the
  palette-selector binding and its sync test, and the System/preview/apply model.
- New ADR `docs/decisions/0051-theme-picker.md` (next free number at writing time): preview
  vs apply, System default, CSS selectors over `data-palette` (rejected: duplicates the
  roster in `index.html`), removal of `ThemeToggle`, `theme-color` sync.
- `components.md` / `CLAUDE.md`: update any mention of the theme header tool or of exactly two
  themes.

## Out of scope

Settings beyond the theme; About content beyond name, author and repo link.

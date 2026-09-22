# DEV-430 Layout shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One width query (`useLayoutMode`) picks `DesktopShell` or `MobileShell` for the visible frame, `Workspace` keeps everything that must survive a switch, and the Header's right-cluster tools become `HEADER_TOOLS` descriptors — with zero visible change in either mode.

**Architecture:** Task 1 moves the Header's tools (theme, project name, follow toggle, key/scale) out of `Header.tsx` into `components/header/`, verbatim. Task 2 turns the cluster into `HEADER_TOOLS` with `layers` as the only gate. Task 3 adds `components/shell/` (`useLayoutMode`, `LayerPages`, `DesktopShell`, `MobileShell`) and switches `Workspace` onto them — the hook lands with its first consumer, because the production Knip scan fails on a file nothing reaches from `main.tsx`. Task 4 is ADR-0040, R315–R317, the rule-text updates and the doc sync, then the full gate.

**Tech Stack:** TypeScript, React (`useSyncExternalStore`, `React.memo`), zustand, Tailwind v4 + daisyUI, Bun test runner (`bun:test`, `renderToString`), ESLint flat config, Knip. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-22-dev-430-layout-shell-design.md` — binding. Read §0 (facts F1–F14), §3 (layout), §4 (`useLayoutMode`), §5 (`Workspace` and the shells), §7 (`HEADER_TOOLS`), §8 (tests) and §9 (docs) before any task. Departures are listed under "Spec corrections".

## Global Constraints

- Branch `refactor/dev-430-layout-shell` (checked out). Never push, never commit on `main`, never switch branches.
- One commit per task. Conventional message with the suffix `(DEV-430)`, body ending with a blank line and exactly `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Spec header: "**User-visible change:** none, on desktop or on a phone. Both shells render today's DOM and classes; the golden WAV and `bun run verify` are unchanged."
- **Golden is frozen.** Never run anything with `GOLDEN_UPDATE=1`. After every task `git diff --stat ad154d90 -- src/audio/export/renderMixdownGolden*` prints nothing.
- **Markup is frozen.** Every JSX block that moves keeps its classes, ids, attributes and comments verbatim. Only imports, props named in a task, and the wrappers a task introduces change.
- Spec §2: "No user override, no persisted preference, no store slice for the mode (R016)." "No change to `PlaybackHost`, the coordinators, routing or any view's internals." No breakpoint class is removed (§6).
- New files use `@/…` imports across folders (`../../` is banned by `GLOBAL_RESTRICTED_SYNTAX`; `components/header/` and `components/shell/` are one level below `components/`).
- Gates per task: `bun run lint` clean; `bun run eslint` prints **zero errors and zero warnings** — never ignore a warning or call it pre-existing; fix it or add a line-level `// eslint-disable-next-line <rule> -- <reason>`; never relax a rule globally (R005, R264); `bun test` green; `bun run check:dead-code` and `bun run check:dead-code:production` zero findings.
- Size caps (`eslint.config.js`): `max-lines` 750 per file, `max-lines-per-function` 100 (blanks/comments skipped), `complexity` warns at 20 (a warning fails the gate).
- R270: never spread one props bag across several children — `Workspace` passes each shell its props explicitly.
- R001: no counts, versions or line numbers in any rule, ADR or CLAUDE.md text you write (plan-internal line references are for the implementer only).
- Large files (`useInputDeck.ts`, `eslint.config.js`, `docs/architecture/structure/*.md`, `docs/design.md`): `grep -n` + line ranges, never a whole-file dump.

## Spec corrections (found while verifying the spec against the code)

1. **`header/headerTools.ts`, not `.tsx`.** The descriptor list holds component references and no JSX.
2. **Unexported types.** Knip's default scan reports exported types nobody imports. `LayoutMode`, `HeaderTool`, `HeaderToolId` and `HeaderToolGroup` stay file-local in this issue (exported functions may return them); DEV-431 exports whichever it imports. Exported: `LAYOUT_MODE_QUERY`, `createLayoutModeSource`, `useLayoutMode`, `HEADER_TOOLS`, `headerToolsFor`, `ShellProps`.
3. **Shared shell test props.** `shells.test.tsx` and `appChildMemo.test.tsx` both need a full `ShellProps`; it lives in `src/components/shell/shellPropsFixture.ts`, which Knip's `*Fixture` pattern already excludes from the project graph.
4. **`Workspace` switches with a JSX ternary**, `mode === 'desktop' ? <DesktopShell …/> : <MobileShell …/>`, each with explicit props (R270) — not `const Shell = …; <Shell {...props} />`, which would spread one bag into two children.
5. **The Header's "key/scale on both breakpoints" test** reads `idPrefix` strings off `Header.tsx`. After Task 1 those strings live in `header/ScaleMenu.tsx`, so the test renders `<ScaleMenu />` and checks both select ids instead (the "precedes the nav" half becomes data in Task 2).
6. **ADR-0039's host position** ("in `Workspace` (`App.tsx`) before `<LoopPage />`") gets an amendment note: the host is now the root's first child, before the shell — still before every page.

## File map

| File | Task | Change |
|---|---|---|
| `src/components/header/useTheme.ts`, `ThemeToggle.tsx`, `ProjectNameLabel.tsx`, `FollowPlayheadToggle.tsx`, `ScaleMenu.tsx` | 1, 2 | **new** in 1 (verbatim moves out of `Header.tsx`); 2 drops `layer` props, `ScaleMenu` selects its own values |
| `src/components/Header.tsx` | 1, 2 | 1: imports the moved pieces, renders `<ThemeToggle />`; 2: renders `HeaderToolRun`s around the nav |
| `src/components/Header.test.tsx` | 1, 2 | imports follow the moves; order/export tests become data assertions |
| `src/App.tsx`, `src/components/loop/useSoundDepth.ts`, `src/store/uiSlice.ts` | 1 | comments naming the theme helpers' file |
| `src/components/header/headerTools.ts` (+ `.test.ts`) | 2 | **new** |
| `src/components/export/ExportButton.tsx` (+ `.test.tsx`) | 2 | no `layer` prop, no self-gate |
| `src/components/shell/useLayoutMode.ts` (+ `.test.tsx`), `shellProps.ts`, `shellPropsFixture.ts`, `LayerPages.tsx`, `DesktopShell.tsx`, `MobileShell.tsx`, `shells.test.tsx` | 3 | **new** |
| `src/App.tsx` | 3 | `Workspace` renders host + shell + dialogs |
| `src/components/appChildMemo.test.tsx` | 3 | shells and `LayerPages` join `CASES` |
| `docs/decisions/0040-layout-shell.md`, `README.md`, `0001`, `0022`, `0035`, `0039`, `CLAUDE.md`, `.claude/rules/{components,persistence,testing,export}.md`, `.claude/skills/music-theory/SKILL.md`, `docs/design.md`, `docs/architecture/**` | 4 | doc sync |
---

### Task 1: The Header's tools leave `Header.tsx` (verbatim moves)

**Files:**
- Create: `src/components/header/useTheme.ts`, `ThemeToggle.tsx`, `ProjectNameLabel.tsx`, `FollowPlayheadToggle.tsx`, `ScaleMenu.tsx`
- Modify: `src/components/Header.tsx` (imports `:1-22`, remove `:86-140`, `:142-330`, `:366-414`; theme `IconButton` `:493-506`; `useTheme()` call `:423`), `src/components/Header.test.tsx` (import line `:5`; test `:392-398`), comments in `src/App.tsx:51`, `src/components/loop/useSoundDepth.ts:107`, `src/store/uiSlice.ts:43-44`

**Interfaces:**
- Consumes: nothing new.
- Produces (all names unchanged, new paths):
  - `@/components/header/useTheme`: `SolnaTheme`, `resolveInitialTheme(stored, prefersLight)`, `readStoredTheme(storage?)`, `persistTheme(theme, storage?)`, `export interface UseTheme { currentTheme: SolnaTheme; toggleTheme: () => void }`, `useTheme(): UseTheme`.
  - `@/components/header/ThemeToggle`: `ThemeToggle()` (no props).
  - `@/components/header/ProjectNameLabel`: `UNTITLED_PROJECT_LABEL`, `projectDisplayName`, `ProjectNameLabel({ layer })` (prop removed in Task 2).
  - `@/components/header/FollowPlayheadToggle`: `FollowPlayheadToggle({ layer })` (prop removed in Task 2).
  - `@/components/header/ScaleMenu`: `ScaleSelects({ idPrefix, stacked })`, `ScaleMenu({ scaleRoot, scaleType })` (props removed in Task 2).

- [ ] **Step 1: Point the tests at the new paths (failing).** In `src/components/Header.test.tsx` replace the import at `:5` with:

```tsx
import { TabButton, LAYER_META, layerToggleTarget } from './Header';
import { persistTheme, readStoredTheme, resolveInitialTheme } from './header/useTheme';
import { projectDisplayName, ProjectNameLabel, UNTITLED_PROJECT_LABEL } from './header/ProjectNameLabel';
import { FollowPlayheadToggle } from './header/FollowPlayheadToggle';
import { ScaleMenu, ScaleSelects } from './header/ScaleMenu';
```

and replace the test at `:392-398` ("the key/scale group precedes the tab nav, on both breakpoints") with:

```tsx
  test('the key/scale group precedes the tab nav', () => {
    expect(src.indexOf('<ScaleMenu')).toBeGreaterThan(-1);
    expect(src.indexOf('<ScaleMenu')).toBeLessThan(navAt);
  });

  // Both copies render — the inline pair from xl up and the dropdown below —
  // each under its own id prefix, so the hidden copy never duplicates an id.
  test('the key/scale menu renders both breakpoint copies', () => {
    const html = renderToString(<ScaleMenu scaleRoot="C" scaleType="Major" />);
    expect(html).toContain('id="select-master-scale-root"');
    expect(html).toContain('id="select-master-scale-compact-root"');
  });
```

Run: `bun test src/components/Header.test.tsx` → FAIL (`Cannot find module './header/useTheme'`).

- [ ] **Step 2: Create `src/components/header/useTheme.ts`** — move verbatim from `Header.tsx`: `SolnaTheme` (`:257`), `THEME_STORAGE_KEY` (`:259`), `resolveInitialTheme` (`:261-269`), `readStoredTheme` (`:271-278`), `persistTheme` (`:280-287`), `useTheme` (`:289-330`) with their docblocks. Changes only: header imports

```ts
import { useEffect, useState } from 'react';
import { persistGuardedStorageValue, readGuardedStorageValue } from '@/utils/storage';
```

`React.useState` → `useState`, `React.useEffect` → `useEffect`; and the hook gets a named return type (R266):

```ts
export interface UseTheme {
  currentTheme: SolnaTheme;
  toggleTheme: () => void;
}

export function useTheme(): UseTheme {
```

- [ ] **Step 3: Create `src/components/header/ThemeToggle.tsx`** — the button body from `Header.tsx:493-506`, verbatim:

```tsx
import { Moon, Sun } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { useTheme } from './useTheme';

/** The light/dark switch. Owns the theme hook, so the Header holds no theme state. */
export function ThemeToggle() {
  const { currentTheme, toggleTheme } = useTheme();
  return (
    <IconButton
      id="btn-toggle-theme"
      label={`Switch to ${currentTheme === 'solna-dark' ? 'Light' : 'Dark'} Theme`}
      icon={
        currentTheme === 'solna-dark' ? (
          <Sun className="w-4 h-4 text-primary" />
        ) : (
          <Moon className="w-4 h-4 text-primary" />
        )
      }
      size="sm"
      onClick={toggleTheme}
    />
  );
}
```

- [ ] **Step 4: Create the other three files**, each a verbatim move with its docblocks:
  - `header/ProjectNameLabel.tsx`: `UNTITLED_PROJECT_LABEL` (`:142-143`), `projectDisplayName` (`:145-153`), `ProjectNameLabelProps` + `ProjectNameLabel` (`:155-213`). Imports: `import { useState } from 'react';` (`React.useState` → `useState`), `import type { Layer } from '@/types';`, `import { useLiveStore } from '@/components/ui/useLiveStore';`, `import { GROUP_LABEL, HEADER_FIELD_SHELL } from '@/components/ui/fieldClasses';`.
  - `header/FollowPlayheadToggle.tsx`: `:215-255`. Imports: `import { LocateFixed, LocateOff } from 'lucide-react';`, `import type { Layer } from '@/types';`, `import { useLiveStore } from '@/components/ui/useLiveStore';`, `import { IconButton } from '@/components/ui/IconButton';`.
  - `header/ScaleMenu.tsx`: `ScaleSelectsProps` + `ScaleSelects` (`:86-140`), `ScaleMenu` (`:366-414`), `export` added to `ScaleMenu`. Imports: `import { ChevronDown } from 'lucide-react';`, `import { SCALES } from '@/data/scales';`, `import { KEY_OPTIONS, formatKeyLabel, getTonicSpelling } from '@/utils/noteSpelling';`, `import { useAppStore } from '@/store/store';`, `import { HEADER_FIELD_SHELL, HEADER_SELECT } from '@/components/ui/fieldClasses';`.

- [ ] **Step 5: Slim `Header.tsx`.** Delete the moved blocks. Import block becomes:

```tsx
import React from "react";
import { Layer, layerForTab, ViewMode } from "../types";
import { defaultTabForLayer, tabsForLayer } from "../routing/tabRouting";
import { useAppStore } from "../store/store";
import { HEADER_GROUP } from "./ui/fieldClasses";
import { LoopCopyButton } from "./loop/LoopCopyButton";
import { LoopSelector } from "./loop/LoopSelector";
import { ProjectMenu } from "./project/ProjectMenu";
import { ExportButton } from "./export/ExportButton";
import { VIEW_META } from "./viewMeta";
import { ProjectNameLabel } from "./header/ProjectNameLabel";
import { FollowPlayheadToggle } from "./header/FollowPlayheadToggle";
import { ScaleMenu } from "./header/ScaleMenu";
import { ThemeToggle } from "./header/ThemeToggle";
```

In `Header`, delete `const { currentTheme, toggleTheme } = useTheme();` and replace the `{/* Theme Toggle Button */}` `IconButton` element with `<ThemeToggle />` (keep the comment line above it). Nothing else in the JSX changes.

- [ ] **Step 6: Comments that name the old file.** `src/App.tsx:51` `` `resolveInitialTheme` in `components/Header.tsx` `` → `` `resolveInitialTheme` in `components/header/useTheme.ts` ``; `src/components/loop/useSoundDepth.ts:107` `` `Header.tsx`'s theme helpers `` → `` `header/useTheme.ts`'s theme helpers ``; `src/store/uiSlice.ts:43-44` `readStoredTheme` in `Header.tsx` → in `components/header/useTheme.ts`.

- [ ] **Step 7: Verify.** `bun test src/components/Header.test.tsx` → PASS. `grep -n "useTheme\|IconButton\|SCALES\|useLiveStore" src/components/Header.tsx` → no hits. Then the per-task gates (Global Constraints).

- [ ] **Step 8: Commit**

```bash
git add src/components/header src/components/Header.tsx src/components/Header.test.tsx \
  src/App.tsx src/components/loop/useSoundDepth.ts src/store/uiSlice.ts
git commit -m "refactor(header): move the theme, project name, follow toggle and key menu out of Header.tsx (DEV-430)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `HEADER_TOOLS` — the right cluster as data, `layers` the only gate

**Files:**
- Create: `src/components/header/headerTools.ts`, `src/components/header/headerTools.test.ts`
- Modify: `src/components/header/ProjectNameLabel.tsx`, `FollowPlayheadToggle.tsx`, `ScaleMenu.tsx`, `src/components/export/ExportButton.tsx` (`:2`, `:29-37`), `src/components/export/ExportButton.test.tsx`, `src/components/Header.tsx`, `src/components/Header.test.tsx`

**Interfaces:**
- Consumes: Task 1's components.
- Produces: `export const HEADER_TOOLS: readonly HeaderTool[]`; `export function headerToolsFor(layer: Layer, group: 'subject' | 'actions'): readonly HeaderTool[]` at `@/components/header/headerTools`, where `HeaderTool = { id: 'loop-copy' | 'loop-selector' | 'project-name' | 'follow-playhead' | 'export' | 'scale' | 'theme'; Component: ComponentType; layers: readonly Layer[]; group: 'subject' | 'actions' }`. `ProjectNameLabel()`, `FollowPlayheadToggle()`, `ExportButton()`, `ScaleMenu()` take no props.

- [ ] **Step 1: Write the failing test** — create `src/components/header/headerTools.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { HEADER_TOOLS, headerToolsFor } from './headerTools';

const ids = (tools: readonly { id: string }[]) => tools.map((tool) => tool.id);

describe('HEADER_TOOLS', () => {
  test('lists the right cluster in today\'s order, each tool once', () => {
    expect(ids(HEADER_TOOLS)).toEqual([
      'loop-copy', 'loop-selector', 'project-name', 'follow-playhead', 'export', 'scale', 'theme',
    ]);
    expect(new Set(ids(HEADER_TOOLS)).size).toBe(HEADER_TOOLS.length);
  });

  test('the loop layer gets the copy button, the loop picker, the key menu and the theme', () => {
    expect([...ids(headerToolsFor('loop', 'subject')), ...ids(headerToolsFor('loop', 'actions'))])
      .toEqual(['loop-copy', 'loop-selector', 'scale', 'theme']);
  });

  // Project name, follow and export are what the SONG tabs edit; an export is
  // an arrangement action, so it never shows over a loop.
  test('the song layer gets the project name, follow toggle, export and the theme', () => {
    expect([...ids(headerToolsFor('song', 'subject')), ...ids(headerToolsFor('song', 'actions'))])
      .toEqual(['project-name', 'follow-playhead', 'export', 'theme']);
  });

  // The tab nav sits between the two groups: everything that names WHAT is
  // edited comes before it, only the theme after.
  test('the theme is the only tool after the tab nav', () => {
    expect(ids(HEADER_TOOLS.filter((tool) => tool.group === 'actions'))).toEqual(['theme']);
  });

  test('every tool is available on at least one layer', () => {
    for (const tool of HEADER_TOOLS) expect(tool.layers.length).toBeGreaterThan(0);
  });
});
```

Run: `bun test src/components/header/headerTools.test.ts` → FAIL (`Cannot find module './headerTools'`).

- [ ] **Step 2: Create `src/components/header/headerTools.ts`:**

```ts
import type { ComponentType } from 'react';
import type { Layer } from '@/types';
import { ExportButton } from '@/components/export/ExportButton';
import { LoopCopyButton } from '@/components/loop/LoopCopyButton';
import { LoopSelector } from '@/components/loop/LoopSelector';
import { FollowPlayheadToggle } from './FollowPlayheadToggle';
import { ProjectNameLabel } from './ProjectNameLabel';
import { ScaleMenu } from './ScaleMenu';
import { ThemeToggle } from './ThemeToggle';

type HeaderToolId =
  | 'loop-copy' | 'loop-selector' | 'project-name' | 'follow-playhead' | 'export' | 'scale' | 'theme';

/** Which side of the tab nav a tool sits on in the desktop row. */
type HeaderToolGroup = 'subject' | 'actions';

interface HeaderTool {
  readonly id: HeaderToolId;
  /** Takes no props: each tool reads the store itself. */
  readonly Component: ComponentType;
  /** The layers the tool is available on — its only availability gate (R317). */
  readonly layers: readonly Layer[];
  readonly group: HeaderToolGroup;
}

const LOOP: readonly Layer[] = ['loop'];
const SONG: readonly Layer[] = ['song'];
const BOTH: readonly Layer[] = ['loop', 'song'];

/**
 * The Header's right-hand tools, in desktop order (R317). The desktop Header
 * renders them inline around the tab nav; a narrower frame chooses by `id`
 * which to show inline and which to put behind a menu — a rendering choice,
 * never a new field here. ProjectMenu, the layer switch and the tab nav are
 * structure, not tools: a mobile frame replaces them rather than moving them.
 */
export const HEADER_TOOLS: readonly HeaderTool[] = [
  { id: 'loop-copy', Component: LoopCopyButton, layers: LOOP, group: 'subject' },
  { id: 'loop-selector', Component: LoopSelector, layers: LOOP, group: 'subject' },
  { id: 'project-name', Component: ProjectNameLabel, layers: SONG, group: 'subject' },
  { id: 'follow-playhead', Component: FollowPlayheadToggle, layers: SONG, group: 'subject' },
  { id: 'export', Component: ExportButton, layers: SONG, group: 'subject' },
  { id: 'scale', Component: ScaleMenu, layers: LOOP, group: 'subject' },
  { id: 'theme', Component: ThemeToggle, layers: BOTH, group: 'actions' },
];

/** The tools of `group` available on `layer`, in list order. */
export function headerToolsFor(layer: Layer, group: HeaderToolGroup): readonly HeaderTool[] {
  return HEADER_TOOLS.filter((tool) => tool.group === group && tool.layers.includes(layer));
}
```

- [ ] **Step 3: One gate — drop the self-gates.**
  - `ProjectNameLabel.tsx`: delete `ProjectNameLabelProps`, the `{ layer }` parameter and `if (layer !== 'song') return null;`, and the `Layer` import. Docblock: replace the "Takes `layer` as a prop … in a test." sentence with "Song layer only through its `HEADER_TOOLS` row (`headerTools.ts`), which is its only gate (R317)."
  - `FollowPlayheadToggle.tsx`: same — no parameter, no `if (layer !== 'song') return null;`, no `Layer` import; the docblock's "same `layer !== 'song'` gate `ProjectNameLabel` uses" → "song layer only, like `ProjectNameLabel`, through its `HEADER_TOOLS` row"; delete the "Takes `layer` as a prop …" paragraph.
  - `export/ExportButton.tsx`: `export function ExportButton() {`, delete `if (layer !== 'song') return null;` and `import type { Layer } from '@/types';`; docblock → `The export feature's root: a song-layer Header tool whose \`HEADER_TOOLS\` row (\`header/headerTools.ts\`) is its only layer gate (R317).`
  - `ScaleMenu.tsx`: `export function ScaleMenu() {` with, as its first lines, `const scaleRoot = useAppStore((s) => s.scaleRoot);` and `const scaleType = useAppStore((s) => s.scaleType);`; JSX unchanged.

- [ ] **Step 4: `Header.tsx` renders the list.** Imports: remove `LoopCopyButton`, `LoopSelector`, `ExportButton`, `ProjectNameLabel`, `FollowPlayheadToggle`, `ScaleMenu`, `ThemeToggle`; add `import { headerToolsFor } from "./header/headerTools";`. Above `Header` (below `LayerSwitcher`, R267) add:

```tsx
/** One run of Header tools: those of `group` available on `layer`, in `HEADER_TOOLS` order. */
function HeaderToolRun({ layer, group }: { layer: Layer; group: Parameters<typeof headerToolsFor>[1] }) {
  return (
    <>
      {headerToolsFor(layer, group).map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  );
}
```

In `Header`: delete the `scaleRoot`/`scaleType` selectors. In the right-cluster `div`, replace everything from `{layer === 'loop' && (` (the copy button + selector fragment) through `{layer === 'loop' && <ScaleMenu … />}` with `<HeaderToolRun layer={layer} group="subject" />`, and the `{/* Theme Toggle Button */}` + `<ThemeToggle />` with `<HeaderToolRun layer={layer} group="actions" />`. Keep the cluster's leading comment; fold the per-tool comments (subject first, follow between name and tabs, export with the song's controls, key/scale before the tabs so the tabs stay anchored) into one comment above the subject run — their content is now what `HEADER_TOOLS`' order encodes. The `<nav>` block is unchanged.

- [ ] **Step 5: Tests follow the one gate.**
  - `ExportButton.test.tsx`: `<ExportButton layer="song" />` → `<ExportButton />` (three places); delete the test "the loop layer renders nothing — an export is an arrangement action" (now `headerTools.test.ts`); describe title → `'ExportButton'`.
  - `Header.test.tsx`: `<ProjectNameLabel layer="song" />` → `<ProjectNameLabel />`, `<FollowPlayheadToggle layer="song" />` → `<FollowPlayheadToggle />`; delete "the loop layer renders no project-name control at all" and "the loop layer never shows it — the scroll it governs is Arrange only"; `<ScaleMenu scaleRoot="C" scaleType="Major" />` → `<ScaleMenu />`. Add imports `import { HEADER_TOOLS } from './header/headerTools';` and `import { ExportButton } from './export/ExportButton';`. Replace the three describes "export lives in its own feature folder", "the header cluster leads with the subject, not the tabs" (keep its explanatory docblock, reworded from "read off the source" to "read off `HEADER_TOOLS`") and "the loop layer renders the copy button beside the loop selector" with:

```tsx
describe('export lives in its own feature folder', () => {
  const header = readFileSync(new URL('./Header.tsx', import.meta.url), 'utf8');
  const tools = readFileSync(new URL('./header/headerTools.ts', import.meta.url), 'utf8');

  test('the tool list takes the export root from src/components/export/', () => {
    expect(tools).toContain("import { ExportButton } from '@/components/export/ExportButton';");
    expect(HEADER_TOOLS.find((tool) => tool.id === 'export')?.Component).toBe(ExportButton);
  });

  test('neither the Header nor its tool list holds export logic', () => {
    for (const src of [header, tools]) {
      for (const symbol of ['startExport', 'cancelExport', 'exportJob', 'downloadBlob', 'mixdownProgressLabel', 'export-menu']) {
        expect(src).not.toContain(symbol);
      }
    }
  });
});

describe('the header cluster leads with the subject, not the tabs', () => {
  const src = readFileSync(new URL('./Header.tsx', import.meta.url), 'utf8');
  const navAt = src.indexOf('<nav className={`${HEADER_GROUP}');
  const subject = HEADER_TOOLS.filter((tool) => tool.group === 'subject').map((tool) => tool.id);

  test('the Header renders the subject tools, then the tab nav, then the actions', () => {
    expect(navAt).toBeGreaterThan(-1);
    expect(src.indexOf('<HeaderToolRun layer={layer} group="subject" />')).toBeLessThan(navAt);
    expect(src.indexOf('<HeaderToolRun layer={layer} group="actions" />')).toBeGreaterThan(navAt);
  });

  // Subject, then what Arrange does with it while it plays, then export, then
  // the key it is in — all before the tabs, which then stay anchored beside
  // the theme toggle on both layers.
  test('loop picker, project name, follow toggle, export and key/scale all precede the tabs', () => {
    expect(subject).toEqual(['loop-copy', 'loop-selector', 'project-name', 'follow-playhead', 'export', 'scale']);
  });

  test('the copy button sits immediately before the loop selector', () => {
    expect(subject.indexOf('loop-selector')).toBe(subject.indexOf('loop-copy') + 1);
  });
});
```

The "the key/scale menu renders both breakpoint copies" test (Task 1) moves into this file's `key picker` describe; delete the "precedes the tab nav" `indexOf('<ScaleMenu')` test from Task 1 (now the data assertion above).

- [ ] **Step 6: Verify.** `bun test src/components/header src/components/Header.test.tsx src/components/export` → PASS. `grep -n "layer !== 'song'" src/components/header src/components/export` → no hits. Per-task gates.

- [ ] **Step 7: Commit**

```bash
git add src/components/header src/components/Header.tsx src/components/Header.test.tsx src/components/export/ExportButton.tsx src/components/export/ExportButton.test.tsx
git commit -m "refactor(header): HEADER_TOOLS descriptors; the tool list is the only layer gate (DEV-430)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `useLayoutMode`, `DesktopShell`, `MobileShell`, `LayerPages`; `Workspace` switches

**Files:**
- Create: `src/components/shell/useLayoutMode.ts` (+ `useLayoutMode.test.tsx`), `shellProps.ts`, `shellPropsFixture.ts`, `LayerPages.tsx`, `DesktopShell.tsx`, `MobileShell.tsx`, `shells.test.tsx`
- Modify: `src/App.tsx` (imports `:3-14, :32`; `activeTab` selector `:136-137`; JSX `:161-224`), `src/components/appChildMemo.test.tsx`

**Interfaces:**
- Consumes: `Header` (Task 2); `InputDeckKeyboardProps`, `InputDeckDrumProps` from `@/components/useInputDeck`.
- Produces: `export const LAYOUT_MODE_QUERY = '(min-width: 48rem)'`; `export function createLayoutModeSource(matchMedia): { subscribe(onChange: () => void): () => void; getSnapshot(): 'desktop' | 'mobile' }`; `export function useLayoutMode(): 'desktop' | 'mobile'` at `@/components/shell/useLayoutMode`; `export interface ShellProps { keyboardProps: InputDeckKeyboardProps; drumProps: InputDeckDrumProps; updateReady: boolean; onApplyUpdate: () => void; onDismissUpdate: () => void }` at `@/components/shell/shellProps`; memo'd `DesktopShell`, `MobileShell` (`ShellProps`) and `LayerPages` (no props); `SHELL_PROPS` test fixture.

- [ ] **Step 1: Layout mode — write the failing test** — create `src/components/shell/useLayoutMode.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createLayoutModeSource, LAYOUT_MODE_QUERY, useLayoutMode } from './useLayoutMode';

/** A MediaQueryList stand-in: `set` flips `matches` and fires `change`, like a resize across 48rem. */
function fakeMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  const list = {
    matches: initial,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
  };
  return {
    queries,
    listeners,
    matchMedia: (query: string) => {
      queries.push(query);
      return list as unknown as MediaQueryList;
    },
    set(matches: boolean) {
      list.matches = matches;
      listeners.forEach((listener) => listener());
    },
  };
}

function Probe() {
  return createElement('span', null, useLayoutMode());
}

describe('layout mode source', () => {
  test('a width at or above md is desktop, below it mobile', () => {
    expect(createLayoutModeSource(fakeMatchMedia(true).matchMedia).getSnapshot()).toBe('desktop');
    expect(createLayoutModeSource(fakeMatchMedia(false).matchMedia).getSnapshot()).toBe('mobile');
  });

  test('a change notifies the subscriber and the next snapshot follows it', () => {
    const fake = fakeMatchMedia(true);
    const source = createLayoutModeSource(fake.matchMedia);
    let calls = 0;
    source.subscribe(() => { calls += 1; });
    fake.set(false);
    expect(calls).toBe(1);
    expect(source.getSnapshot()).toBe('mobile');
  });

  test('unsubscribe removes the listener', () => {
    const fake = fakeMatchMedia(true);
    const unsubscribe = createLayoutModeSource(fake.matchMedia).subscribe(() => {});
    expect(fake.listeners.size).toBe(1);
    unsubscribe();
    expect(fake.listeners.size).toBe(0);
  });

  test('the Tailwind md query is created once, however often it is read', () => {
    const fake = fakeMatchMedia(true);
    const source = createLayoutModeSource(fake.matchMedia);
    source.getSnapshot();
    source.subscribe(() => {})();
    source.getSnapshot();
    expect(fake.queries).toEqual([LAYOUT_MODE_QUERY]);
    expect(LAYOUT_MODE_QUERY).toBe('(min-width: 48rem)');
  });

  test('with no matchMedia the mode is desktop and subscribe is inert', () => {
    const source = createLayoutModeSource(undefined);
    expect(source.getSnapshot()).toBe('desktop');
    expect(() => source.subscribe(() => {})()).not.toThrow();
  });
});

describe('useLayoutMode', () => {
  test('renders desktop under renderToString (the server snapshot)', () => {
    expect(renderToString(createElement(Probe))).toBe('<span>desktop</span>');
  });

  // LAYOUT_MODE_QUERY is Tailwind v4's default `md` (48rem). A `--breakpoint-md`
  // override in the CSS would move every `md:` class and leave the mode behind.
  test('index.css does not override Tailwind md, so the query and md: agree', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    expect(css).not.toContain('--breakpoint-md');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/shell/useLayoutMode.test.tsx`
Expected: FAIL — `Cannot find module './useLayoutMode'`.

- [ ] **Step 3: Implement the layout mode** — create `src/components/shell/useLayoutMode.ts`:

```ts
import { useSyncExternalStore } from 'react';

/** Which frame the workspace renders. Width only: no pointer, hover or orientation query. */
type LayoutMode = 'desktop' | 'mobile';

/**
 * Tailwind v4's default `md` breakpoint (48rem; `src/index.css` sets no
 * `--breakpoint-md`), so the mode flips at exactly the edge every `md:` class
 * already uses. A test pins the CSS side.
 */
export const LAYOUT_MODE_QUERY = '(min-width: 48rem)';

type MediaQuery = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
type MatchMedia = (query: string) => MediaQuery;

/**
 * The layout mode as an external store over one MediaQueryList, created on
 * first read so importing this module touches no browser API. With no
 * `matchMedia` (bun test, a non-browser host) the mode is desktop.
 */
export function createLayoutModeSource(matchMedia: MatchMedia | undefined): {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => LayoutMode;
} {
  let list: MediaQuery | null = null;
  const mediaQuery = (): MediaQuery | null => {
    if (!matchMedia) return null;
    list ??= matchMedia(LAYOUT_MODE_QUERY);
    return list;
  };
  return {
    subscribe(onChange) {
      const query = mediaQuery();
      if (!query) return () => {};
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    getSnapshot() {
      const query = mediaQuery();
      return query === null || query.matches ? 'desktop' : 'mobile';
    },
  };
}

const browserSource = createLayoutModeSource(
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? (query) => window.matchMedia(query)
    : undefined,
);

const serverSnapshot = (): LayoutMode => 'desktop';

/**
 * The one layout-mode switch (R315). Never a slice, never persisted, no user
 * override: the viewport decides. `getServerSnapshot` is desktop, so every
 * `renderToString` test renders the desktop frame.
 */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(browserSource.subscribe, browserSource.getSnapshot, serverSnapshot);
}
```

- [ ] **Step 4: Run the layout-mode test** — `bun test src/components/shell/useLayoutMode.test.tsx` → PASS.

- [ ] **Step 5: Props and fixture.** Create `src/components/shell/shellProps.ts`:

```ts
import type { InputDeckDrumProps, InputDeckKeyboardProps } from '@/components/useInputDeck';

/**
 * What a shell takes from `Workspace`: the input deck's two bags (for the
 * dock) and the update banner's state. Both are owned above the shell so a
 * layout-mode switch never resets them (R316).
 */
export interface ShellProps {
  keyboardProps: InputDeckKeyboardProps;
  drumProps: InputDeckDrumProps;
  updateReady: boolean;
  onApplyUpdate: () => void;
  onDismissUpdate: () => void;
}
```

and `src/components/shell/shellPropsFixture.ts`:

```ts
import { getChordKeyboardRows, getScaleLockedKeyboardNotes } from '@/components/ui/Keyboard';
import type { ShellProps } from './shellProps';

const noop = () => {};

/** Inert shell props for renderToString tests. */
export const SHELL_PROPS: ShellProps = {
  keyboardProps: {
    keyboardMode: 'scale-locked', setKeyboardMode: noop,
    keyboardOctave: 0, setKeyboardOctave: noop,
    activeNotes: new Set<string>(), scaleRoot: 'C', scaleType: 'Major',
    scaleLockedRows: getScaleLockedKeyboardNotes('C', 'Major', 0),
    chordKeyboardRows: getChordKeyboardRows('C', 'Major', 0),
    handleNoteOn: noop, handleNoteOff: noop,
  },
  drumProps: { pads: [], activePadId: null, onTriggerPad: noop, onPadVolumeChange: noop, onPadVolumeCommit: noop },
  updateReady: false,
  onApplyUpdate: noop,
  onDismissUpdate: noop,
};
```

- [ ] **Step 6: Write the failing test** — create `src/components/shell/shells.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DesktopShell } from './DesktopShell';
import { MobileShell } from './MobileShell';
import { SHELL_PROPS } from './shellPropsFixture';

/** See appChildMemo.test.tsx: dnd-kit numbers its ids from a process-wide counter. */
function normalizeDndIds(html: string): string {
  return html.replace(/DndDescribedBy-\d+/g, 'DndDescribedBy-N');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const read = (path: string) => stripComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

describe('the shells', () => {
  const desktop = renderToString(createElement(DesktopShell, SHELL_PROPS));
  const mobile = renderToString(createElement(MobileShell, SHELL_PROPS));

  test('the desktop shell renders the whole frame', () => {
    for (const marker of [
      '<header class="navbar',
      'id="layer-loop"',
      'id="btn-vibe-',
      '<main class="flex-1 min-h-0 relative overflow-y-auto pb-9">',
      'id="btn-focus-chip"',
      'id="btn-bottom-transport"',
    ]) {
      expect(desktop).toContain(marker);
    }
  });

  // DEV-430 changes no pixel on a phone: the mobile shell is today's frame
  // until DEV-431 diverges it. This equality is that promise; DEV-431 replaces it.
  test('the mobile shell renders exactly the desktop markup (for now)', () => {
    expect(normalizeDndIds(mobile)).toBe(normalizeDndIds(desktop));
  });

  test('no shell mounts the host, a coordinator or an app-level dialog (R316)', () => {
    for (const file of ['./DesktopShell.tsx', './MobileShell.tsx', './LayerPages.tsx']) {
      const src = read(file);
      for (const name of ['PlaybackHost', 'useInputDeck', 'useEngineSync', 'IncidentDialog', 'MidiSettingsModal', 'ProjectNotice']) {
        expect(src).not.toContain(name);
      }
    }
  });
});

describe('Workspace keeps what survives a layout switch', () => {
  const app = read('../../App.tsx');

  test('it renders no frame component itself', () => {
    for (const frame of ['<Header', '<InstantVibesBar', '<LoopPage', '<SongPage', '<BottomInputDock', '<UpdateBanner', '<TransportBar']) {
      expect(app).not.toContain(frame);
    }
  });

  test('the host precedes both shells, and each dialog is mounted once', () => {
    const host = app.indexOf('<PlaybackHost />');
    expect(host).toBeGreaterThan(-1);
    expect(host).toBeLessThan(app.indexOf('<DesktopShell'));
    expect(host).toBeLessThan(app.indexOf('<MobileShell'));
    for (const dialog of ['<IncidentDialog />', '<MidiSettingsModal />', '<ProjectNotice />']) {
      expect(app.split(dialog).length - 1).toBe(1);
    }
  });

  test('the frame is picked by useLayoutMode', () => {
    expect(app).toContain('useLayoutMode()');
  });
});
```

Run: `bun test src/components/shell/shells.test.tsx` → FAIL (`Cannot find module './DesktopShell'`).

- [ ] **Step 7: `LayerPages.tsx`** — `App.tsx:194-199` verbatim, R014's first level:

```tsx
import React from 'react';
import { isSongLayer } from '@/types';
import { useAppStore } from '@/store/store';
import { LoopPage } from '@/components/loop/LoopPage';
import { SongPage } from '@/components/song/SongPage';

/**
 * Both layers, always mounted, gated block/hidden on the active layer — the
 * first of R014's three gating levels (LoopPage and PatternView are the other
 * two). Shared by both shells: the gate is the one piece every frame keeps.
 */
export const LayerPages = React.memo(function LayerPages() {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      <div className={isSongLayer(activeTab) ? 'hidden' : 'block'}>
        <LoopPage />
      </div>
      <div className={isSongLayer(activeTab) ? 'block' : 'hidden'}>
        <SongPage />
      </div>
    </>
  );
});
```

- [ ] **Step 8: `DesktopShell.tsx`** — the frame from `App.tsx:171-213`, comments verbatim (the `<main>` comment loses only its `PlaybackHost` paragraph, which stays in `App.tsx`):

```tsx
import React from 'react';
import { isSongLayer } from '@/types';
import { useAppStore } from '@/store/store';
import { Header } from '@/components/Header';
import { InstantVibesBar } from '@/components/InstantVibesBar';
import { TransportBar } from '@/components/TransportBar';
import { BottomInputDock } from '@/components/ui/BottomInputDock';
import { UpdateBanner } from '@/components/ui/UpdateBanner';
import { LayerPages } from './LayerPages';
import type { ShellProps } from './shellProps';

/**
 * The desktop frame (`useLayoutMode() === 'desktop'`): today's layout. Owns
 * only the visible frame — the host, coordinators and dialogs stay in
 * `Workspace` so a layout switch never remounts them (R316).
 */
export const DesktopShell = React.memo(function DesktopShell({
  keyboardProps,
  drumProps,
  updateReady,
  onApplyUpdate,
  onDismissUpdate,
}: ShellProps) {
  const activeTab = useAppStore((s) => s.activeTab);
  return (
    <>
      {/* Navigation Header */}
      <Header />

      {/* …the InstantVibesBar comment from App.tsx:174-177, verbatim… */}
      {!isSongLayer(activeTab) && <InstantVibesBar />}

      {/* …the two <main> comments from App.tsx:180-188, verbatim… */}
      <main className="flex-1 min-h-0 relative overflow-y-auto pb-9">
        <LayerPages />
      </main>

      {/* Bottom Input Dock — Keyboard | Drums, reachable from any page */}
      <BottomInputDock keyboardProps={keyboardProps} drumProps={drumProps} />

      {/* A waiting service worker, announced above the transport bar. */}
      <UpdateBanner open={updateReady} onReload={onApplyUpdate} onDismiss={onDismissUpdate} />

      {/* Persistent Transport Bar at bottom */}
      <TransportBar />
    </>
  );
});
```

(Replace the two `…verbatim…` placeholders with the exact comment text from those `App.tsx` lines — they are copied, not rewritten.)

- [ ] **Step 9: `MobileShell.tsx`** — the same body as `DesktopShell` (same imports, same JSX and comments), function and const named `MobileShell`, docblock:

```tsx
/**
 * The mobile frame (`useLayoutMode() === 'mobile'`, below Tailwind's `md`).
 * DEV-430 ships it as a deliberate copy of DesktopShell — no visible change on
 * a phone — so DEV-431 can diverge it (bottom nav, top bar + menu over
 * HEADER_TOOLS) without touching Workspace or the desktop frame. Same
 * ownership rule: the visible frame only (R316).
 */
```

- [ ] **Step 10: `Workspace`.** In `src/App.tsx`:
  - Imports: delete `BottomInputDock`, `Header`, `InstantVibesBar`, `LoopPage`, `SongPage`, `TransportBar`, `UpdateBanner` and `isSongLayer`; `import { bootProject, useAppStore } from './store/store';` → `import { bootProject } from './store/store';` (the `activeTab` selector was its only `useAppStore` use); add `import { DesktopShell } from './components/shell/DesktopShell';`, `import { MobileShell } from './components/shell/MobileShell';`, `import { useLayoutMode } from './components/shell/useLayoutMode';`.
  - Replace `// UI slice` + `const activeTab = …` with:

```tsx
  // Desktop or mobile frame, by viewport width only (R315). Everything above
  // and every element outside the shell below survives a switch (R316).
  const mode = useLayoutMode();
```

  - The returned JSX becomes (root `div` and its comment unchanged):

```tsx
    <div
      /* …root comment and className unchanged… */
    >
      {/* Every transport controller, mounted once (DEV-422, R312): a lane
          sounds because this is mounted, never because its grid is. Outside
          the shell, so a layout switch never remounts it; before it, so its
          hook order stays ahead of every page's clock listener. */}
      <PlaybackHost />

      {mode === 'desktop' ? (
        <DesktopShell
          keyboardProps={keyboardProps}
          drumProps={drumProps}
          updateReady={updateReady}
          onApplyUpdate={applyPendingUpdate}
          onDismissUpdate={dismissUpdate}
        />
      ) : (
        <MobileShell
          keyboardProps={keyboardProps}
          drumProps={drumProps}
          updateReady={updateReady}
          onApplyUpdate={applyPendingUpdate}
          onDismissUpdate={dismissUpdate}
        />
      )}

      <IncidentDialog />

      {/* MIDI Settings Modal */}
      <MidiSettingsModal />

      {/* …ProjectNotice comment unchanged… */}
      <ProjectNotice />
    </div>
```

- [ ] **Step 11: `appChildMemo.test.tsx`.** Add imports `import { DesktopShell } from './shell/DesktopShell';`, `import { MobileShell } from './shell/MobileShell';`, `import { LayerPages } from './shell/LayerPages';`, `import { SHELL_PROPS } from './shell/shellPropsFixture';` and three `CASES` rows after `SongPage`:

```tsx
  ['LayerPages', LayerPages, {}],
  ['DesktopShell', DesktopShell, { ...SHELL_PROPS }],
  ['MobileShell', MobileShell, { ...SHELL_PROPS }],
```

- [ ] **Step 12: Verify.** `bun test src/components/shell src/components/appChildMemo.test.tsx src/App.test.tsx` → PASS. Then all per-task gates; both Knip scans zero. Manual pass (`bun run dev`, a desktop window and devtools device mode at 375px): identical header, vibes bar, pages, dock, transport as on `ad154d90`; start the song, resize across 768px — audio keeps playing, the frame re-renders.

- [ ] **Step 13: Commit**

```bash
git add src/components/shell src/App.tsx src/components/appChildMemo.test.tsx
git commit -m "refactor(shell): useLayoutMode picks DesktopShell or MobileShell in Workspace (DEV-430)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: ADR-0040, rules R315–R317, rule-text updates, doc sync, full gate

**Files:**
- Create: `docs/decisions/0040-layout-shell.md`
- Modify: `docs/decisions/README.md`, `0001-always-mounted-views.md` (`:20`, `:53`), `0022-persist-write-path-and-guarded-storage.md` (`:35`, `:60`), `0035-export-feature.md` (`:56` and its R295 line), `0039-playback-host.md` (`:19`), `CLAUDE.md` (`:53-63` and the rules table), `.claude/rules/components.md`, `persistence.md` (`paths:` `:16`, `:38`), `testing.md` (`:15`), `export.md` (`paths:` `:6`, `:21`, `:25`, `:56`), `.claude/skills/music-theory/SKILL.md` (`:75`), `docs/design.md` (`:140`), `docs/architecture/feature-overview.md` (`:45`, `:58`), `docs/architecture/structure/{README,01-ui}.md`

**Interfaces:**
- Consumes: every name from Tasks 1–3.
- Produces: rules R315–R317 (next free after R314), ADR-0040. No code.

Rule texts (verbatim below):
- **R315** — The layout mode is `useLayoutMode()` (`components/shell/useLayoutMode.ts`): viewport width at Tailwind's `md`, never persisted, never a slice, no user override; nothing else reads the viewport to pick a frame.
- **R316** — `Workspace` owns everything that must survive a layout switch — the coordinators, `PlaybackHost` and the app-level dialogs; a shell (`DesktopShell`, `MobileShell`) owns only the visible frame and never mounts one of those.
- **R317** — A Header tool is a `HEADER_TOOLS` row (`components/header/headerTools.ts`) whose `layers` is its only availability gate; a new tool is a row, never JSX in `Header.tsx`, and never gates itself on the layer.

- [ ] **Step 1: ADR-0040.** Create `docs/decisions/0040-layout-shell.md` in ADR-0039's shape: `# ADR-0040: Layout shell and one layout-mode switch`, `**Status:** Accepted — 2026-09-22. DEV-430`, `## Context`, `## Decision`, `## Rejected alternatives`, `## Consequences`, `## Rules this implies`, `## Sources`. Content:
  - **Context:** the mobile epic DEV-433 needs a different frame on a phone (DEV-431: bottom nav of four tabs, top bar with a menu); the frame was hard-wired in `Workspace` beside the coordinators, the host and the dialogs; the Header's tools were inline JSX with two kinds of layer gate (inline `layer === 'loop' &&`, and song-only components returning `null`); the theme still lived in `Header.tsx` (audit U7).
  - **Decision:** `useLayoutMode()` — `useSyncExternalStore` over one `(min-width: 48rem)` MediaQueryList, Tailwind v4's default `md`, server snapshot desktop, created lazily; `Workspace` keeps the coordinators, root `div`, `PlaybackHost` (first child of the root) and the three dialogs, and renders `DesktopShell` or `MobileShell`; the shells own `Header`, `InstantVibesBar`, `<main>`, `BottomInputDock`, `UpdateBanner`, `TransportBar`; `LayerPages` is the shared layer gate; `MobileShell` is a deliberate copy until DEV-431; `HEADER_TOOLS` — seven rows with `id`, `Component`, `layers`, `group` (`subject` before the tab nav, `actions` after), `ProjectMenu`/layer switch/tab nav structural; the tools and the theme moved to `components/header/`; no breakpoint class removed.
  - **Rejected alternatives:** a store slice or a persisted override for the mode (R016; no requirement for an override); CSS-only responsive frames (both frames' markup mounted at once, doubling every always-mounted view); `pointer: coarse` or user-agent detection (a tablet with a keyboard should get the desktop frame; width is what the `md:` classes already use); keeping the host, the input deck or the dialogs inside the shells (a switch would remount them — the arp and held notes would reset); a `placement`/`priority` hint on the descriptor (the mobile split is a choice of ids — YAGNI); `ProjectMenu`, the layer switch or the tab nav as tools (DEV-431 replaces them, it does not relocate them).
  - **Consequences:** a layout switch remounts the frame: UI state inside it (scroll, open menus, a drag in progress, meter history) resets, audio does not stop (R040), nothing committed is lost; crossing 48rem is a rotation or a resize, so this is rare. R014's first level moved from `App.tsx` to `shell/LayerPages.tsx`. U7's theme half is closed. The golden and `bun run verify` did not change.
  - **Amends ADR-0001** (R014's first gating level, now `shell/LayerPages.tsx`), **ADR-0039** (the host's position: first child of `Workspace`'s root, before the shell), **ADR-0022** (R244's example path) and **ADR-0035** (R293/R295: the Header's tool list).
  - **Rules this implies:** R315, R316, R317 — texts above.
  - **Sources:** DEV-430, DEV-431, DEV-433; `docs/superpowers/specs/2026-09-22-dev-430-layout-shell-design.md`; `docs/superpowers/plans/2026-09-22-dev-430-layout-shell.md`; ADR-0001, ADR-0022, ADR-0035, ADR-0039.
  Index row in `docs/decisions/README.md` after the 0039 row:
  `| [0040](0040-layout-shell.md) | Layout shell and one layout-mode switch | useLayoutMode picks DesktopShell or MobileShell by width at Tailwind md; Workspace keeps the coordinators, PlaybackHost and dialogs; the Header's tools are HEADER_TOOLS rows gated by layer. |`

- [ ] **Step 2: ADRs in place.**
  - ADR-0001 `:20` `` `App.tsx` on the layer (`isSongLayer(activeTab)`), `` → `` `App.tsx` on the layer (`isSongLayer(activeTab)`; since ADR-0040, `components/shell/LayerPages.tsx`), ``; `:53` R014 text `gated `block`/`hidden` in `App.tsx`` → `` gated `block`/`hidden` in `shell/LayerPages.tsx` `` (keep the rest).
  - ADR-0039 `:19`: after `(`App.tsx`) before `<LoopPage />`` add ` (amended by ADR-0040: the first child of `Workspace`'s root, before the layout shell — still ahead of every page)`.
  - ADR-0022 `:35` and `:60`: `` `Header.tsx`'s theme functions `` / `` (`Header.tsx` theme functions) `` → `` `components/header/useTheme.ts`'s theme functions `` / `` (`header/useTheme.ts` theme functions) ``.
  - ADR-0035 `:56` (R293): `` `Header.tsx` or `src/components/export/` `` → `` `Header.tsx`, `header/headerTools.ts` or `src/components/export/` ``; its R295 line: "The Header holds only the song-layer `ExportButton`" → "The Header's tool list (`header/headerTools.ts`) holds only the song-layer `ExportButton`".

- [ ] **Step 3: Rules files.**
  - `components.md`: after the `## Placement` section's ADR link add

```markdown
## Layout shell

- The layout mode is `useLayoutMode()` (`components/shell/useLayoutMode.ts`): viewport width at Tailwind's `md`, never persisted, never a slice, no user override; nothing else reads the viewport to pick a frame. <!-- R315 -->
- `Workspace` owns everything that must survive a layout switch — the coordinators, `PlaybackHost` and the app-level dialogs; a shell (`DesktopShell`, `MobileShell`) owns only the visible frame and never mounts one of those. <!-- R316 -->
- A Header tool is a `HEADER_TOOLS` row (`components/header/headerTools.ts`) whose `layers` is its only availability gate; a new tool is a row, never JSX in `Header.tsx`, and never gates itself on the layer. <!-- R317 -->

([ADR-0040](../../docs/decisions/0040-layout-shell.md))
```

    R273: drop `` `Header.tsx`, `` from the debt list and `DEV-426 / DEV-430` → `DEV-426`. `## Prohibited` gains:

```markdown
- A viewport read that picks a frame outside `useLayoutMode`, or the layout mode in a slice or storage <!-- R315 -->
- A coordinator, `PlaybackHost` or an app-level dialog mounted inside a shell <!-- R316 -->
- A Header tool written as JSX in `Header.tsx`, or a tool gating itself on the layer <!-- R317 -->
```

  - `persistence.md`: `paths:` `"src/components/Header.tsx"` → `"src/components/header/useTheme.ts"`; R244 `` (`Header.tsx` theme functions) `` → `` (`header/useTheme.ts` theme functions) ``.
  - `testing.md` `:15`: `` `resolveInitialTheme`/`persistTheme` from `Header.tsx` `` → `` `resolveInitialTheme`/`persistTheme` from `header/useTheme.ts` ``.
  - `export.md`: `paths:` add `  - "src/components/header/headerTools.ts"` after the `Header.tsx` entry; R293 and R295 as in Step 2; `## Prohibited` R295 line → "Cancelling a job when the dialog closes, or export logic in `Header.tsx` or `header/headerTools.ts`".

- [ ] **Step 4: CLAUDE.md.**
  - `## Architecture` paragraph, after its first sentence add: `` `Workspace` (`App.tsx`) keeps the coordinators, `PlaybackHost` and the dialogs; `useLayoutMode()` picks `DesktopShell` or `MobileShell` (`src/components/shell/`) for the visible frame. <!-- R316 --> ``
  - R014 bullet: `` `App.tsx` (`isSongLayer(activeTab)`) `` → `` `shell/LayerPages.tsx` (`isSongLayer(activeTab)`) ``; `Why:` line gains `` , `docs/decisions/0040-layout-shell.md` ``.
  - Rules table `components.md` row → "Component logic in a colocated hook, narrow store selectors, placement, the layout shell and `HEADER_TOOLS`".

- [ ] **Step 5: Skill and design doc.** `music-theory/SKILL.md:75`: `` `Header.tsx` renders the pickers `` → `` `header/ScaleMenu.tsx` renders the pickers ``. `docs/design.md:140` (the `Header.tsx` item): append "The right-hand cluster is data — `HEADER_TOOLS` in `header/headerTools.ts`, rendered around the tab nav; each tool's `layers` is its only gate (ADR-0040)."

- [ ] **Step 6: Architecture docs** (audit snapshots: update names/paths and the facts that changed; add no line numbers).
  - `feature-overview.md`: the `components/` row's examples gain `shell/*` (`DesktopShell`, `MobileShell`, `useLayoutMode`) and `header/*`; the mermaid `Header` node → `"Layout shell (DesktopShell / MobileShell)<br/>Header · TransportBar · InstantVibesBar"`.
  - `structure/01-ui.md`: §1.1 table row `Workspace` → "Mounts every coordinator hook, `PlaybackHost` and the dialogs; renders `DesktopShell` or `MobileShell` by `useLayoutMode()`"; the render-order list → `PlaybackHost`, the shell (`Header`, `InstantVibesBar`, `<main>` → `shell/LayerPages`, `BottomInputDock`, `UpdateBanner`, `TransportBar`), then `IncidentDialog`, `MidiSettingsModal`, `ProjectNotice`; the mermaid adds a `Shell["shell/DesktopShell · MobileShell"]` node between `WS` and the frame children, `PB` hangs off `WS`, `LP`/`SP` hang off `shell/LayerPages`. §1.2 Header subgraph: the tool nodes sit under a `HEADER_TOOLS (header/headerTools.ts)` node; `ProjectNameLabel`, `FollowPlayheadToggle`, `ScaleMenu`, the theme toggle labelled with `header/` paths. §2.1 rows: project name → `header/ProjectNameLabel.tsx`, follow → `header/FollowPlayheadToggle.tsx`, key & scale → `header/ScaleMenu.tsx`, theme → `header/ThemeToggle.tsx`, `header/useTheme.ts`. §4.2: Layer row → `shell/LayerPages.tsx`; Vibes bar row → the shells; "Song-only header controls" row → "`HEADER_TOOLS` `layers` (`header/headerTools.ts`) — not rendered off the song layer". §5b "Components doing too much" Header bullet → append "**Fixed (DEV-430):** theme, project name, follow toggle and key menu moved to `components/header/`; the cluster is `HEADER_TOOLS`."
  - `structure/README.md`: the smells bullet's "the theme still lives in `Header.tsx`" → "**Theme half fixed (DEV-430):** the theme is `components/header/useTheme.ts`"; the mermaid `Shell` node → `"App · layout shell (useLayoutMode → DesktopShell / MobileShell)<br/>Header (tabs, HEADER_TOOLS: key/scale, export, theme)<br/>InstantVibesBar · TransportBar (play, BPM, meter, metronome)"`.
  - Verify: `grep -rn "Header.tsx" .claude CLAUDE.md docs/decisions` → only `Header.tsx` as the frame (R293/R295/R317, ADR history); `grep -rn "isSongLayer(activeTab)" CLAUDE.md .claude docs/decisions` → names `LayerPages`.

- [ ] **Step 7: Completion gate.** `bun run verify` → green. `bun run eslint` → zero errors, zero warnings. `git diff --stat ad154d90 -- src/audio/export/renderMixdownGolden*` → empty.

- [ ] **Step 8: Commit**

```bash
git add docs/decisions/0040-layout-shell.md docs/decisions/README.md docs/decisions/0001-always-mounted-views.md \
  docs/decisions/0022-persist-write-path-and-guarded-storage.md docs/decisions/0035-export-feature.md \
  docs/decisions/0039-playback-host.md CLAUDE.md .claude/rules/components.md .claude/rules/persistence.md \
  .claude/rules/testing.md .claude/rules/export.md .claude/skills/music-theory/SKILL.md docs/design.md \
  docs/architecture/feature-overview.md docs/architecture/structure/README.md docs/architecture/structure/01-ui.md
git commit -m "docs: ADR-0040 layout shell, rules R315-R317 (DEV-430)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| §0 facts F1–F14 | Verified against `ad154d90`; departures under "Spec corrections" |
| §3 layout, placement | Tasks 1 (`header/`), 2 (`headerTools.ts`, correction 1), 3 (`shell/`) |
| §4 `useLayoutMode` (query, lazy list, server snapshot, CSS guard) | Task 3, Steps 1–4 |
| §5 `Workspace` split, DOM identity, listener order, switch behaviour, `LayerPages`, `ShellProps` | Task 3 (corrections 3, 4); manual resize pass |
| §6 no breakpoint class removed | Global Constraints ("Markup is frozen") |
| §7 `HEADER_TOOLS`, `group`, structural pieces, one gate, theme out of Header | Tasks 1 (moves), 2 (descriptors, gates) |
| §8 tests | Task 2 (`headerTools.test.ts`, Header/Export tests), 3 (`useLayoutMode.test.tsx`, `shells.test.tsx`, `appChildMemo`) |
| §9 ADR-0040, R315–R317, R014/R244/R293/R295/R273 texts, CLAUDE.md, architecture docs | Task 4 (correction 6) |
| §10 risks | K1 verbatim moves + shell equality test; K2 R316 + App source test; K3 one query; K4 `header/` one-way imports; K5 availability test |

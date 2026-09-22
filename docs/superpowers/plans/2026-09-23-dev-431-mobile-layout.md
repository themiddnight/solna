# DEV-431 Mobile layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below 48rem, `MobileShell` renders its own frame — a one-row top bar (mark, inline field tools, menu button), a bottom-sheet menu with the remaining `HEADER_TOOLS` and the project actions, and a four-tab bottom bar — while desktop stays pixel-identical.

**Architecture:** Task 1 teaches the four button-shaped Header tools a `row` variant. Task 2 splits `ProjectMenu` into a hook, its rows and its effects so a second frame can render them (desktop markup byte-identical). Task 3 adds the bottom tab bar and gives the tab bar the bottom safe-area inset. Task 4 replaces `Header` in `MobileShell` with the top bar + menu sheet and drops `Header`'s dead below-`sm` halves. Task 5 is ADR-0041, R318–R321, the doc sync and the full gate.

**Tech Stack:** TypeScript, React (`React.memo`, `useState`), zustand, Tailwind v4 + daisyUI v5 (`dock`, `modal-bottom`, `menu`), native `<dialog>` via `ui/Modal`, Bun test runner (`renderToString`), ESLint flat config, Knip. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-23-dev-431-mobile-layout-design.md` — binding. Read §0 (facts F1–F16), §4 (shell order), §5 (top bar), §6 (sheet), §7 (tab bar), §9 (desktop) and §10 (tests) before any task. Departures are under "Spec corrections".

## Global Constraints

- Branch `feat/dev-431-mobile-layout` (checked out). Never push, never commit on `main`, never switch branches.
- One commit per task. Conventional message with the suffix `(DEV-431)`, body ending with a blank line and exactly `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Spec header: "At and above `md` nothing changes on screen. Audio, the coordinators, `PlaybackHost` and the app-level dialogs are untouched (R316), and every view stays mounted (R014)."
- **Desktop markup is frozen** except `Header.tsx`'s dead below-`sm` classes (Task 4, spec §9). Every new prop defaults to today's markup (`variant` → `'bar'`, `bottomInset` → `true`, `placement` → `'middle'`, `interactive` → `true`, `rowClassName` → none).
- **Golden is frozen.** Never run anything with `GOLDEN_UPDATE=1`. After every task `git diff --stat 0d439627 -- src/audio/export/renderMixdownGolden*` prints nothing.
- No store slice, no persisted UI state; `menuOpen` is local `useState` (R016). Navigation goes only through `setActiveTab` (spec §7).
- Theme tokens only; no hex/rgb/oklch literal, no new colour (`.claude/rules/theming.md`; `bun run check:theme`, `bun run check:contrast` stay green).
- daisyUI classes allowed in new markup (verified against the installed v5 CSS and daisyui.com): `dock`, `dock-active`, `dock-label`, `modal`, `modal-bottom`, `modal-box`, `modal-backdrop`, `menu`, `menu-title`, `btn`, `btn-ghost`, `btn-block`, `btn-square`, `btn-active`, `loading`, `loading-spinner`, `loading-sm`, `navbar`. Any other daisyUI class: look it up in the v5 docs first.
- Every new interactive control is ≥ 44px (`min-h-11`, plus `min-w-11` when square).
- New files use `@/…` imports across folders (`../../` is banned by `GLOBAL_RESTRICTED_SYNTAX`).
- Gates per task: `bun run lint` clean; `bun run eslint` prints **zero errors and zero warnings** — never ignore a warning or call it pre-existing; fix it or add a line-level `// eslint-disable-next-line <rule> -- <reason>`; never relax a rule globally (R005, R264); `bun test` green; `bun run check:dead-code` and `bun run check:dead-code:production` zero findings.
- Size caps (`eslint.config.js`): `max-lines` 750 per file, `max-lines-per-function` 100, `complexity` warns at 20 (a warning fails the gate).
- R270: explicit props per child; R274: one value per `useAppStore` selector; R265/R266: component state in a colocated hook with a named, exported return type; R267: children above the root.
- R001: no counts, versions or line numbers in any rule, ADR or CLAUDE.md text you write (plan-internal line references are for the implementer only).
- Large files (`ProjectMenu.tsx`, `TransportBar.tsx`, `docs/architecture/structure/*.md`): `grep -n` + line ranges, never a whole-file dump.

## Spec corrections (found while turning the spec into code)

1. **`useProjectMenu` stays in `project/ProjectMenu.tsx`**, not a new `useProjectMenu.ts`: it calls `runMenuAction`, `visibleMenuSections` and `useProjectFileCommands`, which live in `ProjectMenu.tsx`, while `ProjectMenu.tsx` would import the hook — a cycle. `useProjectFileCommands` already sets the in-file precedent.
2. **The tool props type is `ToolVariantProps` in `ui/MenuRowButton.tsx`**, beside `ToolVariant` — not `HeaderToolProps` in `headerTools.ts`, which imports the tools (a tool importing it back is a cycle).
3. **Exports land with their first importer (Knip).** `headerToolsOn`, `HeaderTool`, `HeaderToolId`, `useProjectMenu`, `UseProjectMenu`, `ProjectMenuSections` and `ProjectMenuEffects` become exports in Task 4, not earlier. `MOBILE_BAR_TOOL_IDS` stays file-local and is tested through `mobileHeaderTools`.
4. **`MobileMenuSheet` is exported** from `MobileTopBar.tsx` so the test can render it per layer (precedent: `onSelectLoop`, "exported for a store-driven test").

## File map

| File | Task | Change |
|---|---|---|
| `src/components/ui/MenuRowButton.tsx` (+ `.test.tsx`) | 1 | **new**: `ToolVariant`, `ToolVariantProps`, `MenuRowButton` |
| `src/components/loop/LoopCopyButton.tsx`, `header/ThemeToggle.tsx`, `header/FollowPlayheadToggle.tsx`, `export/ExportButton.tsx` | 1 | `variant` prop, `row` rendering |
| `src/components/header/headerTools.ts` | 1, 4 | 1: `Component: ComponentType<ToolVariantProps>`; 4: `headerToolsOn`, type exports |
| `src/components/header/toolRows.test.tsx` | 1 | **new** |
| `src/components/project/ProjectMenu.tsx` | 2, 4 | 2: `useProjectMenu`, `ProjectMenuSections({ sections, onChoose, rowClassName })`, `ProjectMenuEffects`; 4: exported |
| `src/components/TransportBar.tsx` | 3 | `bottomInset` prop |
| `src/components/shell/MobileTabBar.tsx`, `shell/mobileShell.test.tsx` | 3 | **new** |
| `src/components/shell/MobileShell.tsx` | 3, 4 | 3: tab bar last, transport without inset; 4: `MobileTopBar` replaces `Header` |
| `src/components/shell/shells.test.tsx` | 3, 4 | 3: parity test dropped; 4: desktop-has-no-mobile-chrome, R316 file list |
| `src/components/shell/useMobileTopBar.ts`, `shell/MobileTopBar.tsx` | 4 | **new** |
| `src/components/ui/Modal.tsx` (+ `.test.tsx`), `ui/Wordmark.tsx` (+ `.test.tsx`) | 4 | `placement`/`afterBox`; `interactive` |
| `src/components/Header.tsx` | 4 | dead below-`sm` halves |
| `src/components/appChildMemo.test.tsx` | 3, 4 | `MobileTabBar`, `MobileTopBar` join `CASES` |
| `docs/decisions/0041-mobile-frame.md`, `README.md`, `0040-layout-shell.md`, `CLAUDE.md`, `.claude/rules/components.md`, `docs/architecture/**` | 5 | doc sync |

---

### Task 1: Header tools render as menu rows

**Files:**
- Create: `src/components/ui/MenuRowButton.tsx`, `src/components/header/toolRows.test.tsx`
- Modify: `src/components/loop/LoopCopyButton.tsx`, `src/components/header/ThemeToggle.tsx`, `src/components/header/FollowPlayheadToggle.tsx`, `src/components/export/ExportButton.tsx`, `src/components/header/headerTools.ts` (the `Component` field)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `@/components/ui/MenuRowButton`: `export type ToolVariant = 'bar' | 'row'`; `export interface ToolVariantProps { variant?: ToolVariant }`; `export function MenuRowButton(props: MenuRowButtonProps)` where `MenuRowButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> { icon: ReactNode; label: string }`.
  - `LoopCopyButton`, `ThemeToggle`, `FollowPlayheadToggle`, `ExportButton` each take `{ variant = 'bar' }: ToolVariantProps`; `'bar'` renders today's markup, `'row'` a `MenuRowButton` with the same `id`.
  - `HeaderTool.Component: ComponentType<ToolVariantProps>`.

- [ ] **Step 1: Failing tests.** Create `src/components/header/toolRows.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { createElement, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import type { ToolVariantProps } from '@/components/ui/MenuRowButton';
import { ExportButton } from '@/components/export/ExportButton';
import { LoopCopyButton } from '@/components/loop/LoopCopyButton';
import { FollowPlayheadToggle } from './FollowPlayheadToggle';
import { ThemeToggle } from './ThemeToggle';

const ROW_TOOLS: Array<[string, ComponentType<ToolVariantProps>, string, string]> = [
  ['LoopCopyButton', LoopCopyButton, 'btn-copy-loop', 'Copy loop'],
  ['ThemeToggle', ThemeToggle, 'btn-toggle-theme', 'Theme'],
  ['FollowPlayheadToggle', FollowPlayheadToggle, 'btn-follow-playhead', 'Follow the playing loop'],
  ['ExportButton', ExportButton, 'btn-export', 'Export'],
];

describe('menu tools render a touch-sized row', () => {
  for (const [name, Tool, id, label] of ROW_TOOLS) {
    test(`${name} row: same id, a visible label, 44px tall`, () => {
      const html = renderToString(createElement(Tool, { variant: 'row' }));
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain('btn-block');
      expect(html).toContain('min-h-11');
      expect(html).toContain(label);
    });

    test(`${name} with no variant renders the bar markup, unchanged`, () => {
      const bar = renderToString(createElement(Tool));
      expect(bar).toBe(renderToString(createElement(Tool, { variant: 'bar' })));
      expect(bar).not.toContain('btn-block');
    });
  }

  test('the export row keeps its dialog beside it and still announces a dialog', () => {
    const html = renderToString(<ExportButton variant="row" />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('<dialog class="modal"');
  });

  test('the follow row is a pressed-state toggle', () => {
    expect(renderToString(<FollowPlayheadToggle variant="row" />)).toContain('aria-pressed=');
  });
});
```

Run: `bun test src/components/header/toolRows.test.tsx` → FAIL (`Cannot find module '@/components/ui/MenuRowButton'`).

- [ ] **Step 2: Create `src/components/ui/MenuRowButton.tsx`.**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

/** How a Header tool renders: `bar` inline in a toolbar (default), `row` as a labelled menu row. */
export type ToolVariant = 'bar' | 'row';

/** The only prop a `HEADER_TOOLS` component takes; field tools ignore it. */
export interface ToolVariantProps {
  variant?: ToolVariant;
}

export interface MenuRowButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode;
  /** Visible text: a row in a touch menu is never icon-only. */
  label: string;
}

/**
 * One full-width, 44px-tall menu row: icon + label. A plain button, not a
 * daisyUI `menu` item — a tool row may carry its own `<dialog>` beside it,
 * and `.menu li > *` would restyle that dialog as a menu item.
 */
export function MenuRowButton({ icon, label, className, type = 'button', ...rest }: MenuRowButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('btn btn-ghost btn-block justify-start gap-3 min-h-11 text-sm font-semibold', className)}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
```

- [ ] **Step 3: The four tools.**
  - `loop/LoopCopyButton.tsx`: signature `export function LoopCopyButton({ variant = 'bar' }: ToolVariantProps)`; first statement:

```tsx
  if (variant === 'row') {
    return (
      <MenuRowButton id="btn-copy-loop" icon={<Copy className="w-4 h-4" aria-hidden="true" />}
        label="Copy loop" onClick={() => copyLoopSection()} />
    );
  }
```

  - `header/ThemeToggle.tsx`:

```tsx
export function ThemeToggle({ variant = 'bar' }: ToolVariantProps) {
  const { currentTheme, toggleTheme } = useTheme();
  const label = `Switch to ${currentTheme === 'solna-dark' ? 'Light' : 'Dark'} Theme`;
  const icon = currentTheme === 'solna-dark' ? (
    <Sun className="w-4 h-4 text-primary" />
  ) : (
    <Moon className="w-4 h-4 text-primary" />
  );
  if (variant === 'row') return <MenuRowButton id="btn-toggle-theme" icon={icon} label={label} onClick={toggleTheme} />;
  return <IconButton id="btn-toggle-theme" label={label} icon={icon} size="sm" onClick={toggleTheme} />;
}
```

  - `header/FollowPlayheadToggle.tsx`: signature `({ variant = 'bar' }: ToolVariantProps)`; hoist the `icon` JSX into a `const icon`, then before the `IconButton` return:

```tsx
  if (variant === 'row') {
    // A toggle's name stays fixed; aria-pressed carries the state.
    return (
      <MenuRowButton id="btn-follow-playhead" icon={icon} label="Follow the playing loop"
        aria-pressed={followPlayhead} className={followPlayhead ? 'btn-active' : undefined}
        onClick={toggleFollowPlayhead} />
    );
  }
```

  - `export/ExportButton.tsx`: add above `ExportButton`

```tsx
/** The menu-row trigger: same id and dialog semantics, a visible label for a touch menu. */
function ExportRowTrigger({ trigger, onOpen }: { trigger: ExportTriggerView; onOpen: () => void }) {
  return (
    <MenuRowButton id="btn-export" aria-haspopup="dialog" aria-busy={trigger.busy}
      label={trigger.busy ? trigger.ariaLabel : 'Export'}
      icon={trigger.busy
        ? <span className="loading loading-spinner loading-sm" aria-hidden="true" />
        : <Download className="w-4 h-4" aria-hidden="true" />}
      onClick={onOpen} />
  );
}
```

    and `ExportButton({ variant = 'bar' }: ToolVariantProps)` renders `{variant === 'row' ? <ExportRowTrigger trigger={d.trigger} onOpen={d.openDialog} /> : <ExportTrigger trigger={d.trigger} onOpen={d.openDialog} />}` before the unchanged `<ExportDialog … />`. Docblock: add "`variant="row"` is the mobile menu's form; the dialog renders beside either trigger."
  - Imports: `import { MenuRowButton, type ToolVariantProps } from '@/components/ui/MenuRowButton';` in each.

- [ ] **Step 4: `headerTools.ts`.** `import type { ToolVariantProps } from '@/components/ui/MenuRowButton';` and the field becomes

```ts
  /** Reads the store itself; its only prop is the rendering variant (`bar` inline, `row` in a menu). */
  readonly Component: ComponentType<ToolVariantProps>;
```

- [ ] **Step 5: Run.** `bun test src/components/header src/components/loop/LoopCopyButton.test.tsx src/components/export src/components/Header.test.tsx` → PASS. Then the per-task gates.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/MenuRowButton.tsx src/components/header/toolRows.test.tsx \
  src/components/loop/LoopCopyButton.tsx src/components/header/ThemeToggle.tsx \
  src/components/header/FollowPlayheadToggle.tsx src/components/export/ExportButton.tsx \
  src/components/header/headerTools.ts
git commit -m "feat(header): button-shaped Header tools render as menu rows (DEV-431)" \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Split `ProjectMenu` into hook, rows and effects (desktop byte-identical)

**Files:**
- Modify: `src/components/project/ProjectMenu.tsx` (`ProjectBrowseMode` near `:208`, `ProjectMenuSections` `:480-517`, `ProjectMenu` `:519-627`)
- Test: a throwaway snapshot test (not committed); `src/components/project/ProjectMenu.test.tsx` unchanged

**Interfaces:**
- Consumes: nothing new.
- Produces (file-local in this task; exported in Task 4):
  - `interface UseProjectMenu` and `function useProjectMenu(): UseProjectMenu` — shape below.
  - `function ProjectMenuSections({ sections, onChoose, rowClassName }: { sections: readonly ProjectMenuSection[]; onChoose: (action: ProjectMenuAction) => void; rowClassName?: string })`.
  - `function ProjectMenuEffects({ menu }: { menu: UseProjectMenu })`.
  - `ProjectMenu({ textClassName })` unchanged signature and markup.

- [ ] **Step 1: Record today's markup.** Create `src/components/project/zzSnapshot.test.tsx` (deleted in Step 5):

```tsx
import { test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { ProjectMenu } from './ProjectMenu';

test('snapshot', () => {
  writeFileSync(process.env.SNAP_OUT ?? '/tmp/project-menu.html',
    renderToString(<ProjectMenu textClassName="hidden sm:inline" />) + renderToString(<ProjectMenu />));
});
```

Run: `SNAP_OUT=/tmp/pm-before.html bun test src/components/project/zzSnapshot.test.tsx` → PASS, file written.

- [ ] **Step 2: The hook.** Below `useProjectFileCommands`, add (imports: `DriveFileBrowserModalProps` type from `./DriveFileBrowserModal`):

```tsx
interface UseProjectMenu {
  sections: readonly ProjectMenuSection[];
  choose: (action: ProjectMenuAction) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  confirming: ReplacingAction | null;
  exporting: boolean;
  onConfirmReplace: () => void;
  cancelConfirm: () => void;
  browser: ProjectBrowseMode | null;
  driveSignedIn: boolean;
  projectName: AppStore['projectName'];
  closeBrowser: () => void;
  connectDrive: () => void;
  listDrive: DriveFileBrowserModalProps['onList'];
  openDriveFile: (fileId: string) => void;
  saveAsDriveFile: (name: string) => void;
  pending: string | null;
  diagnosticsOpen: boolean;
  closeDiagnostics: () => void;
}

/**
 * The project menu's state and commands, called once per frame (R268): the
 * desktop dropdown and the mobile menu sheet render the same rows and the
 * same dialogs from it. Which dialog is open is local UI state.
 */
function useProjectMenu(): UseProjectMenu {
  const [confirming, setConfirming] = useState<ReplacingAction | null>(null);
  const [browser, setBrowser] = useState<ProjectBrowseMode | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectName = useLiveStore((s) => s.projectName);
  const exporting = useLiveStore(selectExportBusy);
  const projectSource = useLiveStore((s) => s.projectSource);
  const driveAvailable = useLiveStore((s) => s.driveAvailable);
  const driveSignedIn = useLiveStore((s) => s.driveSignedIn);
  const driveUser = useLiveStore((s) => s.driveUser);
  const connectDrive = useLiveStore((s) => s.connectDrive);
  const newProject = useLiveStore((s) => s.newProject);

  const commands = useProjectFileCommands({ setPending, setBrowser, fileInputRef });

  const choose = (action: ProjectMenuAction) =>
    runMenuAction(action, {
      confirm: setConfirming,
      save: () => void commands.runSave(),
      saveAs: () => void commands.runSaveAs(),
      browseSaveAs: () => setBrowser('save-as'),
      disconnectDrive: () => void commands.disconnectDrive(),
      diagnostics: () => setDiagnosticsOpen(true),
      reportBug: () => reportManualIncident(),
    });

  const onConfirmReplace = () => {
    const action = confirming;
    setConfirming(null);
    if (action === null) return;
    if (action === 'open') void commands.runOpenLocal();
    if (action === 'open-drive') setBrowser('open');
    if (action === 'new') newProject();
  };

  return {
    sections: visibleMenuSections(driveAvailable, driveSignedIn, projectSource.kind, driveUser),
    choose,
    fileInputRef,
    onPickFile: commands.onPickFile,
    confirming,
    exporting,
    onConfirmReplace,
    cancelConfirm: () => setConfirming(null),
    browser,
    driveSignedIn,
    projectName,
    closeBrowser: () => setBrowser(null),
    connectDrive: () => void connectDrive(),
    listDrive: commands.listDrive,
    openDriveFile: (fileId) => void commands.runOpenFromDrive(fileId),
    saveAsDriveFile: (name) => {
      setBrowser(null);
      void commands.runSaveAsToDrive(name);
    },
    pending,
    diagnosticsOpen,
    closeDiagnostics: () => setDiagnosticsOpen(false),
  };
}
```

If `lint` rejects a type (`onPickFile`'s or `listDrive`'s), take it from `ReturnType<typeof useProjectFileCommands>` instead — never `any`.

- [ ] **Step 3: Rows and effects.** Replace `ProjectMenuSections`' props with `{ sections, onChoose, rowClassName }` (docblock: "The menu's rows, as the dropdown and the mobile sheet both render them."), map `sections` directly instead of calling `visibleMenuSections`, and put `className={rowClassName}` on the row `<button>` after `id` (undefined renders no attribute). Below it add `ProjectMenuEffects`, moving `ProjectMenu`'s JSX from the `<input ref={fileInputRef}` through the `DiagnosticPanel` block verbatim, each value read from `menu`:

```tsx
/** Everything a row can open: the file input, the confirm, the Drive browser, the pending overlay, Diagnostics. */
function ProjectMenuEffects({ menu }: { menu: UseProjectMenu }) {
  return (
    <>
      <input
        ref={menu.fileInputRef}
        type="file"
        accept={PROJECT_FILE_ACCEPT}
        aria-label="Open a .solna project file"
        className="hidden"
        onChange={(e) => void menu.onPickFile(e)}
      />
      {menu.confirming !== null && (
        <ConfirmDialog
          title={CONFIRM_COPY[menu.confirming].title}
          message={replaceConfirmMessage(menu.exporting)}
          confirmLabel={CONFIRM_COPY[menu.confirming].label}
          onConfirm={menu.onConfirmReplace}
          onCancel={menu.cancelConfirm}
        />
      )}
      {menu.browser !== null && (
        <DriveFileBrowserModal
          open
          mode={menu.browser}
          signedIn={menu.driveSignedIn}
          initialName={defaultSaveName(menu.projectName)}
          onClose={menu.closeBrowser}
          onConnect={menu.connectDrive}
          onList={menu.listDrive}
          onOpenFile={menu.openDriveFile}
          onSaveAs={menu.saveAsDriveFile}
        />
      )}
      {menu.pending !== null && <ProjectLoading overlay label={menu.pending} />}
      {DiagnosticPanel && menu.diagnosticsOpen && (
        <React.Suspense fallback={<ProjectLoading overlay label="Loading diagnostics…" />}>
          <DiagnosticPanel open onClose={menu.closeDiagnostics} />
        </React.Suspense>
      )}
    </>
  );
}
```

- [ ] **Step 4: `ProjectMenu` becomes layout only.** Keep the long docblock above it and the `ul`'s comment and `eslint-disable-next-line` verbatim:

```tsx
export function ProjectMenu({ textClassName }: { textClassName?: string }) {
  const menu = useProjectMenu();
  return (
    <div className="dropdown">
      <Wordmark textClassName={textClassName} ariaLabel="Project menu" chevron />
      <ul
        /* …the existing comment, verbatim… */
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="dropdown-content menu menu-sm z-50 mt-2 min-w-44 max-w-[calc(100vw-2rem)] rounded-box bg-base-100 border border-base-300 p-1 shadow-lg"
      >
        <ProjectMenuSections sections={menu.sections} onChoose={menu.choose} />
      </ul>
      <ProjectMenuEffects menu={menu} />
    </div>
  );
}
```

Remove now-unused imports only if `lint`/`eslint` says so.

- [ ] **Step 5: Byte-compare, then delete the snapshot test.**
Run: `SNAP_OUT=/tmp/pm-after.html bun test src/components/project/zzSnapshot.test.tsx && cmp /tmp/pm-before.html /tmp/pm-after.html` → no output. Then `rm src/components/project/zzSnapshot.test.tsx`. Run `bun test src/components/project` → PASS; per-task gates.

- [ ] **Step 6: Commit**

```bash
git add src/components/project/ProjectMenu.tsx
git commit -m "refactor(project): ProjectMenu as useProjectMenu + rows + effects (DEV-431)" \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Bottom tab bar; the tab bar owns the bottom inset

**Files:**
- Create: `src/components/shell/MobileTabBar.tsx`, `src/components/shell/mobileShell.test.tsx`
- Modify: `src/components/TransportBar.tsx` (`:229` signature, `:313` root class), `src/components/shell/MobileShell.tsx`, `src/components/shell/shells.test.tsx` (drop the parity test and its `normalizeDndIds` if unused), `src/components/appChildMemo.test.tsx`

**Interfaces:**
- Consumes: `VIEW_ORDER`, `VIEW_META` (`@/components/viewMeta`); `ViewMode`, `layerForTab` (`@/types`); store `activeTab`, `setActiveTab`.
- Produces: `export const MOBILE_TABS: readonly ViewMode[]`; `export const MobileTabBar = React.memo(function MobileTabBar({ activeTab, onSelect }: { activeTab: ViewMode; onSelect: (view: ViewMode) => void }))`; `TransportBar({ bottomInset = true }: { bottomInset?: boolean })`.

- [ ] **Step 1: Failing tests.** Create `src/components/shell/mobileShell.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { layerForTab, type ViewMode } from '@/types';
import { TransportBar } from '@/components/TransportBar';
import { MobileShell } from './MobileShell';
import { MOBILE_TABS, MobileTabBar } from './MobileTabBar';
import { SHELL_PROPS } from './shellPropsFixture';

const noop = () => {};
const tabIds = (html: string) => [...html.matchAll(/id="tab-([a-z]+)"/g)].map((m) => m[1]);

describe('the mobile tab bar', () => {
  test('four tabs, loop layer first — the same roster the desktop nav and router use', () => {
    expect(MOBILE_TABS).toEqual(['sound', 'pattern', 'arrange', 'master']);
    expect(MOBILE_TABS.map(layerForTab)).toEqual(['loop', 'loop', 'song', 'song']);
  });

  for (const active of ['sound', 'pattern', 'arrange', 'master'] as ViewMode[]) {
    test(`on ${active}, exactly that tab is current`, () => {
      const html = renderToString(createElement(MobileTabBar, { activeTab: active, onSelect: noop }));
      expect(tabIds(html)).toEqual(['sound', 'pattern', 'arrange', 'master']);
      expect(html.split('aria-current="page"').length - 1).toBe(1);
      expect(html).toMatch(new RegExp(`id="tab-${active}" type="button" aria-current="page" class="dock-active`));
    });
  }

  test('is an in-flow daisyUI dock labelled for assistive tech', () => {
    const html = renderToString(createElement(MobileTabBar, { activeTab: 'sound', onSelect: noop }));
    expect(html).toContain('<nav aria-label="Views" class="dock relative');
    expect(html).toContain('class="dock-label"');
  });
});

describe('one bottom inset per frame', () => {
  test('the transport keeps it by default and drops it on request', () => {
    expect(renderToString(createElement(TransportBar))).toContain('pb-safe sm:pb-safe-lg');
    expect(renderToString(createElement(TransportBar, { bottomInset: false }))).not.toContain('pb-safe');
  });

  test('the mobile shell ends with the tab bar, after an inset-free transport', () => {
    const html = renderToString(createElement(MobileShell, SHELL_PROPS));
    const transport = html.indexOf('id="btn-bottom-transport"');
    const nav = html.indexOf('<nav aria-label="Views"');
    expect(transport).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(transport);
    expect(html).not.toContain('pb-safe');
  });
});
```

Run: `bun test src/components/shell/mobileShell.test.tsx` → FAIL (`Cannot find module './MobileTabBar'`).

- [ ] **Step 2: `TransportBar`.** Signature `export const TransportBar = React.memo(function TransportBar({ bottomInset = true }: { bottomInset?: boolean }) {` with a docblock line: "`bottomInset` — whether this bar consumes `env(safe-area-inset-bottom)`; the mobile frame gives it to the tab bar below (one consumer per frame)." Root `div` at `:313`:

```tsx
    <div className={`shrink-0 bg-base-100 border-t border-base-300 px-2 sm:px-3 py-1.5 sm:py-2${bottomInset ? ' pb-safe sm:pb-safe-lg' : ''} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 text-xs select-none sticky bottom-0 z-40 shadow-2xl`}>
```

(The default string is byte-identical to today's.) If `complexity` warns on `TransportBar`, hoist the class into `const transportBarClass = (bottomInset: boolean) => …` above the component.

- [ ] **Step 3: Create `src/components/shell/MobileTabBar.tsx`.**

```tsx
import React from 'react';
import type { ViewMode } from '@/types';
import { VIEW_META, VIEW_ORDER } from '@/components/viewMeta';

/**
 * The mobile frame's four tabs: every view, loop layer first — `VIEW_ORDER`,
 * the roster the desktop nav and the router already share. The tab implies
 * the layer (`layerForTab`), so the phone has no Loop/Song switch.
 */
export const MOBILE_TABS: readonly ViewMode[] = VIEW_ORDER;

interface MobileTabBarProps {
  activeTab: ViewMode;
  /** The store's `setActiveTab` — the same action the desktop tabs call; the URL follows via useRouteSync. */
  onSelect: (view: ViewMode) => void;
}

/**
 * Bottom navigation (daisyUI `dock`). `relative` puts the dock, fixed by
 * default, back in the frame's flex column; the dock's own height and padding
 * consume the bottom safe-area inset, so the transport above it does not.
 */
export const MobileTabBar = React.memo(function MobileTabBar({ activeTab, onSelect }: MobileTabBarProps) {
  return (
    <nav aria-label="Views" className="dock relative z-40 shrink-0 border-t border-base-300">
      {MOBILE_TABS.map((view) => {
        const { icon: Icon, tabLabel } = VIEW_META[view];
        const isActive = view === activeTab;
        return (
          <button
            key={view}
            id={`tab-${view}`}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            className={isActive ? 'dock-active text-primary' : undefined}
            onClick={() => onSelect(view)}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span className="dock-label">{tabLabel}</span>
          </button>
        );
      })}
    </nav>
  );
});
```

- [ ] **Step 4: `MobileShell`.** Add `const setActiveTab = useAppStore((s) => s.setActiveTab);`; replace `<TransportBar />` with `<TransportBar bottomInset={false} />` and append after it:

```tsx
      {/* Bottom navigation, last: the thumb's reach, and the frame's one
          consumer of the bottom safe-area inset. */}
      <MobileTabBar activeTab={activeTab} onSelect={setActiveTab} />
```

Update the docblock: "The mobile frame (below Tailwind's `md`): the tab bar is its navigation…" (drop "deliberate copy"). `Header` stays until Task 4.

- [ ] **Step 5: Tests follow.** In `shells.test.tsx` delete the test "the mobile shell renders exactly the desktop markup (for now)" and its comment (and `normalizeDndIds` if now unused); add `'./MobileTabBar.tsx'` to the R316 file list. In `appChildMemo.test.tsx` import `MobileTabBar` and add `['MobileTabBar', MobileTabBar, { activeTab: 'sound', onSelect: () => {} }],` after the `MobileShell` row.

- [ ] **Step 6: Run.** `bun test src/components/shell src/components/appChildMemo.test.tsx` → PASS; per-task gates.

- [ ] **Step 7: Commit**

```bash
git add src/components/shell/MobileTabBar.tsx src/components/shell/mobileShell.test.tsx \
  src/components/shell/MobileShell.tsx src/components/shell/shells.test.tsx \
  src/components/TransportBar.tsx src/components/appChildMemo.test.tsx
git commit -m "feat(shell): mobile bottom tab bar owns the bottom inset (DEV-431)" \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Mobile top bar and menu sheet; `Header` loses its dead phone halves

**Files:**
- Create: `src/components/shell/useMobileTopBar.ts`, `src/components/shell/MobileTopBar.tsx`
- Modify: `src/components/ui/Modal.tsx` (+ `Modal.test.tsx`), `src/components/ui/Wordmark.tsx` (+ `Wordmark.test.tsx`), `src/components/header/headerTools.ts`, `src/components/project/ProjectMenu.tsx` (exports), `src/components/shell/MobileShell.tsx`, `src/components/Header.tsx` (`:123-146`), `src/components/shell/mobileShell.test.tsx`, `src/components/shell/shells.test.tsx`, `src/components/appChildMemo.test.tsx`

**Interfaces:**
- Consumes: `ToolVariantProps`/row variants (Task 1); `useProjectMenu`, `ProjectMenuSections`, `ProjectMenuEffects` (Task 2); `MobileTabBar` (Task 3).
- Produces:
  - `headerTools.ts`: `export type HeaderToolId`, `export interface HeaderTool`, `export function headerToolsOn(layer: Layer): readonly HeaderTool[]`.
  - `ProjectMenu.tsx`: `export interface UseProjectMenu`, `export function useProjectMenu`, `export function ProjectMenuSections`, `export function ProjectMenuEffects`.
  - `Modal` props `placement?: 'middle' | 'bottom'`, `afterBox?: ReactNode`; `Wordmark` prop `interactive?: boolean`.
  - `useMobileTopBar.ts`: `export interface MobileHeaderTools { bar: readonly HeaderTool[]; menu: readonly HeaderTool[] }`, `export function mobileHeaderTools(layer: Layer): MobileHeaderTools`, `export interface UseMobileTopBar extends MobileHeaderTools { menuOpen: boolean; openMenu: () => void; closeMenu: () => void }`, `export function useMobileTopBar(): UseMobileTopBar`.
  - `MobileTopBar.tsx`: `export function MobileMenuSheet({ tools, open, onClose })`, `export const MobileTopBar` (memo, no props).

- [ ] **Step 1: Failing tests.**
  - `Modal.test.tsx` add:

```tsx
  test('a bottom sheet: modal-bottom, full width, inset-padded, 44px close, content after the box', () => {
    const html = renderToString(
      <Modal open onClose={noop} title="Menu" placement="bottom" afterBox={<i id="after" />}>body</Modal>,
    );
    expect(html).toContain('<dialog class="modal modal-bottom"');
    expect(html).not.toContain('max-w-md');
    expect(html).toContain('pb-[calc(1.5rem+env(safe-area-inset-bottom))]');
    expect(html).toContain('min-h-11 min-w-11');
    expect(html.indexOf('id="after"')).toBeGreaterThan(html.indexOf('body'));
    expect(html.indexOf('id="after"')).toBeLessThan(html.indexOf('modal-backdrop'));
  });
```

  - `Wordmark.test.tsx` add:

```tsx
  test('non-interactive: an image, not a button, and not focusable', () => {
    const html = renderToString(<Wordmark markOnly interactive={false} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Solna"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('cursor-pointer');
  });
```

  - `mobileShell.test.tsx` add (imports `mobileHeaderTools` from `./useMobileTopBar`, `MobileMenuSheet` from `./MobileTopBar`, `HEADER_TOOLS` from `@/components/header/headerTools`):

```tsx
const ids = (tools: readonly { id: string }[]) => tools.map((tool) => tool.id);

describe('the mobile top bar splits HEADER_TOOLS by id', () => {
  test('loop layer: loop picker and key inline; copy and theme in the menu', () => {
    const { bar, menu } = mobileHeaderTools('loop');
    expect(ids(bar)).toEqual(['loop-selector', 'scale']);
    expect(ids(menu)).toEqual(['loop-copy', 'theme']);
  });

  test('song layer: project name inline; follow, export and theme in the menu', () => {
    const { bar, menu } = mobileHeaderTools('song');
    expect(ids(bar)).toEqual(['project-name']);
    expect(ids(menu)).toEqual(['follow-playhead', 'export', 'theme']);
  });

  test('every tool lands in exactly one place on every layer it is available on', () => {
    for (const layer of ['loop', 'song'] as const) {
      const { bar, menu } = mobileHeaderTools(layer);
      const expected = HEADER_TOOLS.filter((tool) => tool.layers.includes(layer)).map((tool) => tool.id);
      expect([...ids(bar), ...ids(menu)].sort()).toEqual([...expected].sort());
    }
  });
});

describe('the menu sheet', () => {
  const sheet = (layer: 'loop' | 'song') =>
    renderToString(createElement(MobileMenuSheet, { tools: mobileHeaderTools(layer).menu, open: false, onClose: noop }));

  test('loop layer: copy, theme and the project rows; no song tools', () => {
    const html = sheet('loop');
    for (const id of ['btn-copy-loop', 'btn-toggle-theme', 'project-menu-new', 'project-menu-save']) expect(html).toContain(`id="${id}"`);
    for (const id of ['btn-export', 'btn-follow-playhead']) expect(html).not.toContain(`id="${id}"`);
  });

  test('song layer: follow, export, theme and the project rows; no loop tools', () => {
    const html = sheet('song');
    for (const id of ['btn-follow-playhead', 'btn-export', 'btn-toggle-theme', 'project-menu-new']) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain('id="btn-copy-loop"');
  });

  test('is a bottom sheet, with project rows touch-sized and no dialog inside a menu item', () => {
    const html = sheet('song');
    expect(html).toContain('<dialog class="modal modal-bottom"');
    expect(html).toContain('id="project-menu-new" class="min-h-11"');
    expect(html).not.toMatch(/<li[^>]*>(?:(?!<\/li>)[\s\S])*<dialog/);
  });
});

describe('the mobile frame', () => {
  test('has the menu button and four tabs, and no layer switch or desktop tab nav', () => {
    const html = renderToString(createElement(MobileShell, SHELL_PROPS));
    expect(html).toContain('id="btn-mobile-menu"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(tabIds(html)).toEqual(['sound', 'pattern', 'arrange', 'master']);
    expect(html).not.toContain('id="layer-loop"');
    expect(html).not.toContain('id="layer-song"');
  });
});
```

  - `shells.test.tsx` add to "the shells":

```tsx
  test('the desktop frame carries none of the mobile chrome', () => {
    for (const marker of ['class="dock', 'id="btn-mobile-menu"', 'modal-bottom']) {
      expect(desktop).not.toContain(marker);
    }
  });
```

    and add `'./MobileTopBar.tsx'`, `'./useMobileTopBar.ts'` to the R316 file list.

Run: `bun test src/components/ui/Modal.test.tsx src/components/ui/Wordmark.test.tsx src/components/shell` → FAIL (missing modules/props).

- [ ] **Step 2: `Modal`.** Add to `ModalProps`:

```tsx
  /** `bottom`: a full-width sheet anchored to the bottom edge (daisyUI `modal-bottom`). */
  placement?: 'middle' | 'bottom';
  /**
   * Rendered inside the dialog, after the box. For fixed overlays: the box's
   * `translate` would make itself their containing block and clip them.
   */
  afterBox?: ReactNode;
```

Destructure `placement = 'middle'`, `afterBox`; `const sheet = placement === 'bottom';` then

```tsx
    <dialog ref={ref} className={cx('modal', sheet && 'modal-bottom')}>
      <div className={cx(MODAL_BOX, !sheet && SIZE_CLASS[size], sheet && 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]', boxClassName)}>
        …header unchanged, the close button gains `className={sheet ? 'min-h-11 min-w-11' : undefined}`…
        {children}
      </div>
      {afterBox}
      <form method="dialog" className="modal-backdrop">…unchanged…</form>
    </dialog>
```

The existing Modal tests prove the default markup is unchanged.

- [ ] **Step 3: `Wordmark`.** Add prop doc "`interactive` (default true): false renders a static brand image — no button role, no focus, no hover — for a frame where the mark is not the project menu." Render:

```tsx
    <span
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : 'img'}
      aria-label={interactive ? ariaLabel : 'Solna'}
      className={interactive
        ? `inline-flex items-center gap-2 min-h-11 min-w-11 px-1.5 rounded-box cursor-pointer transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`
        : `inline-flex items-center gap-2 min-h-11 min-w-11 px-1.5 ${className}`}
    >
```

If `jsx-a11y` warns on the conditional `tabIndex`/role, split into two early returns sharing a `content` fragment rather than disabling the rule.

- [ ] **Step 4: Exports.** `headerTools.ts`: `export type HeaderToolId`, `export interface HeaderTool`, and

```ts
/** Every tool available on `layer`, both groups, in list order — for frames without the tab nav between them. */
export function headerToolsOn(layer: Layer): readonly HeaderTool[] {
  return HEADER_TOOLS.filter((tool) => tool.layers.includes(layer));
}
```

`ProjectMenu.tsx`: prefix `export` on `UseProjectMenu`, `useProjectMenu`, `ProjectMenuSections`, `ProjectMenuEffects`.

- [ ] **Step 5: Create `src/components/shell/useMobileTopBar.ts`.**

```ts
import { useCallback, useMemo, useState } from 'react';
import { layerForTab, type Layer } from '@/types';
import { useAppStore } from '@/store/store';
import { headerToolsOn, type HeaderTool, type HeaderToolId } from '@/components/header/headerTools';

/**
 * The tools the phone's top bar shows inline: the field-shaped ones (a select,
 * an input) — what is being edited. Every other available tool goes in the
 * menu sheet as a row. A rendering choice of ids, never a descriptor field.
 */
const MOBILE_BAR_TOOL_IDS: ReadonlySet<HeaderToolId> = new Set<HeaderToolId>(['loop-selector', 'scale', 'project-name']);

export interface MobileHeaderTools {
  bar: readonly HeaderTool[];
  menu: readonly HeaderTool[];
}

export function mobileHeaderTools(layer: Layer): MobileHeaderTools {
  const tools = headerToolsOn(layer);
  return {
    bar: tools.filter((tool) => MOBILE_BAR_TOOL_IDS.has(tool.id)),
    menu: tools.filter((tool) => !MOBILE_BAR_TOOL_IDS.has(tool.id)),
  };
}

export interface UseMobileTopBar extends MobileHeaderTools {
  menuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
}

/** The top bar's state: the layer's tools and whether the sheet is open (local, never a slice — R016). */
export function useMobileTopBar(): UseMobileTopBar {
  const activeTab = useAppStore((s) => s.activeTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  // Stable: Modal re-binds its native `close` listener whenever onClose changes.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const tools = useMemo(() => mobileHeaderTools(layerForTab(activeTab)), [activeTab]);
  return { ...tools, menuOpen, openMenu, closeMenu };
}
```

- [ ] **Step 6: Create `src/components/shell/MobileTopBar.tsx`.**

```tsx
import React from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import type { HeaderTool } from '@/components/header/headerTools';
import { ProjectMenuEffects, ProjectMenuSections, useProjectMenu } from '@/components/project/ProjectMenu';
import { IconButton } from '@/components/ui/IconButton';
import { Modal } from '@/components/ui/Modal';
import { Wordmark } from '@/components/ui/Wordmark';
import { useMobileTopBar } from './useMobileTopBar';

interface MobileMenuSheetProps {
  tools: readonly HeaderTool[];
  open: boolean;
  onClose: () => void;
}

/**
 * The menu: the layer's button-shaped tools as rows, then the project actions
 * inline. Always rendered and closed only by dismissal (Escape, backdrop,
 * close button) — a dialog a row opens (export, confirm, Drive) stacks above
 * it in the top layer and must close first. The project effects sit after the
 * box so the pending overlay covers the sheet instead of being clipped by it.
 * Exported for the test.
 */
export function MobileMenuSheet({ tools, open, onClose }: MobileMenuSheetProps) {
  const project = useProjectMenu();
  return (
    <Modal open={open} onClose={onClose} title="Menu" placement="bottom" boxClassName="space-y-3"
      afterBox={<ProjectMenuEffects menu={project} />}>
      <div className="flex flex-col gap-1">
        {tools.map(({ id, Component }) => (
          <Component key={id} variant="row" />
        ))}
      </div>
      <ul className="menu w-full p-0">
        <li className="menu-title">Project</li>
        <ProjectMenuSections sections={project.sections} onChoose={project.choose} rowClassName="min-h-11" />
      </ul>
    </Modal>
  );
}

/**
 * The phone's top bar: the mark, the layer's field tools (loop picker + key,
 * or the project name), and the menu button. Replaces the desktop Header's
 * layer switch and tab nav, which the bottom tab bar covers.
 */
export const MobileTopBar = React.memo(function MobileTopBar() {
  const { bar, menu, menuOpen, openMenu, closeMenu } = useMobileTopBar();
  return (
    <header className="navbar min-h-0 shrink-0 bg-base-100 border-b border-base-300 px-2 py-1.5 gap-2 select-none sticky top-0 z-40 flex items-center text-sm">
      <Wordmark markOnly interactive={false} />
      {/* The shared field tools keep their compact sizes; this cell lifts
          their controls to a 44px touch height without touching them. */}
      <div className="flex flex-1 min-w-0 items-center justify-end gap-1.5 [&_select]:min-h-11 [&_summary]:min-h-11 [&_input]:min-h-11">
        {bar.map(({ id, Component }) => (
          <Component key={id} />
        ))}
      </div>
      <IconButton id="btn-mobile-menu" label="Menu" icon={<MenuIcon className="w-5 h-5" />}
        aria-haspopup="dialog" aria-expanded={menuOpen} className="min-h-11 min-w-11" onClick={openMenu} />
      <MobileMenuSheet tools={menu} open={menuOpen} onClose={closeMenu} />
    </header>
  );
});
```

- [ ] **Step 7: `MobileShell`.** Replace `import { Header } …` and `<Header />` with `MobileTopBar` from `./MobileTopBar` (comment: "Top bar: mark, the layer's field tools, the menu"). Final order: `MobileTopBar`, `InstantVibesBar` (loop only), `<main …><LayerPages /></main>`, `BottomInputDock`, `UpdateBanner`, `TransportBar bottomInset={false}`, `MobileTabBar`.

- [ ] **Step 8: `Header` drops the halves it can no longer use** (it now renders only at ≥ 48rem, where every `sm:` value applies — pixel-identical):
  - `<header>` class → `navbar min-h-0 shrink-0 bg-base-100 border-b border-base-300 px-4 py-2 select-none sticky top-0 z-40 flex flex-nowrap items-center justify-between gap-x-3 text-sm`
  - brand `div` → `flex items-center gap-2.5 shrink-0`; cluster `div` → `flex items-center gap-1.5 shrink-0`
  - `<ProjectMenu textClassName="hidden sm:inline" />` → `<ProjectMenu />`, and replace the comment above it with "The desktop frame only: the phone has its own top bar (`shell/MobileTopBar.tsx`)."
  - Leave `TabButton`, `LayerSwitcher` and every shared component untouched.

- [ ] **Step 9: `appChildMemo.test.tsx`.** Import `MobileTopBar` and add `['MobileTopBar', MobileTopBar, {}],`.

- [ ] **Step 10: Run.** `bun test` → PASS; per-task gates.

- [ ] **Step 11: Manual check (real browser — the Claude preview can open the app but cannot test file-open).** `bun run dev`, open `http://localhost:3000` at 390×844 and at 360×640 (DevTools device mode): top bar is one row; the tab bar sits in flow below the transport (computed `position: relative`), nothing hidden behind it; tapping each tab switches view and the URL's `/loop`↔`/song`; the menu opens as a bottom sheet with focus inside, Escape and the backdrop close it and focus returns to the menu button; on the song layer, Export opens its dialog above the sheet, Escape closes the dialog first; theme and follow rows toggle in place; at ≥ 768px the desktop Header is unchanged. Record the result in the task report (no file).

- [ ] **Step 12: Commit**

```bash
git add src/components/shell/useMobileTopBar.ts src/components/shell/MobileTopBar.tsx \
  src/components/shell/MobileShell.tsx src/components/shell/mobileShell.test.tsx \
  src/components/shell/shells.test.tsx src/components/ui/Modal.tsx src/components/ui/Modal.test.tsx \
  src/components/ui/Wordmark.tsx src/components/ui/Wordmark.test.tsx \
  src/components/header/headerTools.ts src/components/project/ProjectMenu.tsx \
  src/components/Header.tsx src/components/appChildMemo.test.tsx
git commit -m "feat(shell): mobile top bar and menu sheet over HEADER_TOOLS and the project menu (DEV-431)" \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ADR-0041, rules R318–R321, doc sync, full gate

**Files:**
- Create: `docs/decisions/0041-mobile-frame.md`
- Modify: `docs/decisions/README.md`, `docs/decisions/0040-layout-shell.md`, `.claude/rules/components.md`, `CLAUDE.md` (the `## Architecture` paragraph's shell sentence, the rules-table `components.md` row), `docs/architecture/feature-overview.md`, `docs/architecture/structure/01-ui.md`, `docs/architecture/structure/README.md`

**Interfaces:**
- Consumes: every name from Tasks 1–4.
- Produces: rules R318–R321 (next free after R317), ADR-0041. No code.

Rule texts (verbatim):
- **R318** — Mobile navigation is `MobileTabBar` (`components/shell/MobileTabBar.tsx`): the `VIEW_ORDER` tabs, each calling `setActiveTab`; the tab implies the layer (`layerForTab`); the mobile frame has no layer switch, no second navigation state and no route logic of its own.
- **R319** — The mobile top bar splits `HEADER_TOOLS` by id (`MOBILE_BAR_TOOL_IDS`, `components/shell/useMobileTopBar.ts`): field tools inline, every other available tool in the menu sheet as `variant="row"`; a tool that can reach the menu renders a `MenuRowButton` for `row`; the descriptor gains no placement or label field.
- **R320** — The mobile menu sheet is a `Modal` with `placement="bottom"`, always rendered and closed only by dismissal; what a row opens renders inside the sheet's dialog — a nested dialog, or `afterBox` for a fixed overlay — never inside a daisyUI `menu` item.
- **R321** — Exactly one element per frame consumes `env(safe-area-inset-bottom)`: `TransportBar` on desktop, `MobileTabBar` on mobile (`TransportBar bottomInset={false}`).

- [ ] **Step 1: ADR-0041.** `docs/decisions/0041-mobile-frame.md` in ADR-0040's shape: `# ADR-0041: Mobile frame — bottom tabs, top bar, menu sheet`, `**Status:** Accepted — 2026-09-23. DEV-431`, then:
  - **Context:** DEV-430 left `MobileShell` a copy of the desktop frame; on a phone the Header wrapped to several rows, the Loop/Song switch plus two tabs cost a row of their own, and the tools were icon-only at 32px; the DEV-430 review found `HEADER_TOOLS` could place a tool inline but not as a menu row (`ExportButton` owns its dialog; no row label).
  - **Decision:** spec §4–§7 in one bullet each — frame order with the tab bar last and owning the bottom inset; `MobileTabBar` over `VIEW_ORDER` → `setActiveTab`, daisyUI `dock` made `relative`; top bar = static mark, field tools inline by `MOBILE_BAR_TOOL_IDS`, 44px menu button; the sheet = `Modal placement="bottom"`, always rendered, closed only by dismissal, tool rows via `variant="row"`/`MenuRowButton` in a plain column, project rows inline from `useProjectMenu` with `ProjectMenuEffects` in `afterBox`; `Header` lost its dead below-`sm` halves.
  - **Rejected alternatives:** a Loop/Song switch on the phone (the tab already names the layer); a nested project submenu (a second tap, a hover idiom on touch; the sections are titled); a `label` field on the descriptor (theme, follow and export labels are state-dependent); a placement field (ADR-0040's rejection stands — a choice of ids); closing the sheet on row tap (it would hide a dialog the row just opened); lifting `ExportDialog` and the project dialogs to `Workspace` (widens R316, breaks R268 at the export trigger); portals per tool; tool rows as a daisyUI `menu` (restyles a `<dialog>` inside an `li`); `dock-sm` (items under 44px); a phone-specific `TransportBar` (follow-up).
  - **Consequences:** the sheet stays open under a launched dialog until dismissed; Escape during a pending save closes the sheet and hides the overlay while the save completes and still reports through `ProjectNotice`; the phone loses about a third of its height to chrome on the loop layer (a slimmer transport is the next lever); ids are shared between frames because only one is mounted.
  - **Amends [ADR-0040](0040-layout-shell.md):** `MobileShell` is no longer a copy; `HEADER_TOOLS`' `Component` takes `ToolVariantProps`.
  - **Rules this implies:** R318–R321, texts above.
  - **Sources:** DEV-431, DEV-433; the spec and this plan; ADR-0001, ADR-0040.
  Index row in `docs/decisions/README.md` after 0040:
  `| [0041](0041-mobile-frame.md) | Mobile frame — bottom tabs, top bar, menu sheet | Below md, MobileShell renders a four-tab bottom dock over setActiveTab, a top bar with the field tools inline and a bottom-sheet Modal holding the other HEADER_TOOLS as rows plus the project actions; the tab bar owns the bottom inset. |`

- [ ] **Step 2: ADR-0040.** Under `## Consequences` append: "**Amended by [ADR-0041](0041-mobile-frame.md):** DEV-431 diverged `MobileShell`; a tool's `Component` takes an optional `variant` (`bar` | `row`)." Leave its decision text as history.

- [ ] **Step 3: `.claude/rules/components.md`.** In `## Layout shell`, append the four rule bullets verbatim (each ending `<!-- R3xx -->`) and change the section's ADR link line to `([ADR-0040](../../docs/decisions/0040-layout-shell.md), [ADR-0041](../../docs/decisions/0041-mobile-frame.md))`. `## Prohibited` gains:

```markdown
- A layer switch, a second navigation state or route logic in the mobile frame <!-- R318 -->
- A placement or label field on a `HEADER_TOOLS` row, or a menu tool without a `row` rendering <!-- R319 -->
- Closing the mobile menu sheet on a row tap, or a dialog rendered inside a daisyUI `menu` item <!-- R320 -->
- Two elements of one frame both consuming the bottom safe-area inset <!-- R321 -->
```

- [ ] **Step 4: `CLAUDE.md`.** After "…for the visible frame. <!-- R316 -->" add: "Below `md` the mobile frame navigates by a four-tab bottom bar (the tab implies the layer) and holds the non-field tools and project actions in a menu sheet. <!-- R318 -->" Rules-table `components.md` row → "Component logic in a colocated hook, narrow store selectors, placement, the layout shell, `HEADER_TOOLS` and the mobile frame".

- [ ] **Step 5: Architecture docs** (no line numbers).
  - `feature-overview.md`: the `components/` row's `shell/*` list gains `MobileTopBar`, `MobileTabBar`; the mermaid shell node → `"Layout shell (DesktopShell / MobileShell)<br/>Header or MobileTopBar + MobileTabBar · TransportBar · InstantVibesBar"`.
  - `structure/01-ui.md`: the render-order list under "The layout shell" becomes two lists — desktop (unchanged) and mobile (`MobileTopBar` → sheet, `InstantVibesBar`, `<main>` → `shell/LayerPages`, `BottomInputDock`, `UpdateBanner`, `TransportBar` without the bottom inset, `MobileTabBar`); the mermaid `Shell` node gains `MobileTopBar · MobileTabBar`; the §1.2 Header subgraph notes "desktop frame only"; the §4.2 Vibes bar row keeps naming both shells.
  - `structure/README.md`: the mermaid `Shell` node → `"App · layout shell (useLayoutMode → DesktopShell / MobileShell)<br/>Header or MobileTopBar (HEADER_TOOLS, menu sheet) · MobileTabBar<br/>InstantVibesBar · TransportBar (play, BPM, meter, metronome)"`.
  - Verify: `grep -rn "deliberate copy\|verbatim copy" docs/architecture CLAUDE.md .claude` → nothing current-tense about `MobileShell`.

- [ ] **Step 6: Completion gate.** `bun run verify` → green. `bun run eslint` → zero errors, zero warnings. `git diff --stat 0d439627 -- src/audio/export/renderMixdownGolden*` → empty.

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/0041-mobile-frame.md docs/decisions/README.md docs/decisions/0040-layout-shell.md \
  .claude/rules/components.md CLAUDE.md docs/architecture/feature-overview.md \
  docs/architecture/structure/01-ui.md docs/architecture/structure/README.md
git commit -m "docs: ADR-0041 mobile frame, rules R318-R321 (DEV-431)" \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| §4 frame order, one bottom inset | 3 (tab bar, `bottomInset`), 4 (top bar in place of `Header`) |
| §5 top bar, 44px field cell, static mark | 4 |
| §6.1 sheet container, lifetime, `Modal` props | 4 |
| §6.2 tool rows, `ToolVariant`, `MenuRowButton`, `headerToolsOn`, type exports | 1, 4 |
| §6.3 project rows inline, `ProjectMenu` split | 2, 4 |
| §6.4 accessibility | 3 (`aria-current`), 4 (`aria-expanded`, native dialog), Step 11 manual check |
| §7 tab bar | 3 |
| §8 tokens, daisyUI classes | Global Constraints |
| §9 desktop, `Header` dead halves | 4 Step 8 |
| §10 tests | 1, 3, 4 |
| §12.11 ADR-0041, R318–R321 | 5 |

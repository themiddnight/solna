# Phase 2 — Primitives in `ui/` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five shared view primitives the spec names — `IconButton`, `Modal`, `ConfirmDialog`, `ModuleHeader`, `PanelCard` — and land each one together with every call site it replaces, so the accessibility gaps and class-string drift measured on `main` cannot recur. Plus the popover Escape/focus fix, the `fieldClasses` guard extension, and the two ESLint flips this phase owns: the `confirm`/`alert`/`prompt` ban moves to `no-restricted-globals` + `no-restricted-properties` at **error**, and every `jsx-a11y` rule goes to **error** after its warning count reaches zero.

**Architecture:** Everything new lives in `src/components/ui/` (Phase 3 moves the folder to `src/ui/`). The primitives are pure view components — no store reads, no engine calls — composed from one shared `cx()` class joiner. `Modal`'s only DOM-dependent behaviour (`showModal()` / `close()`) is pushed into a pure `syncDialogOpen(el, open)` helper so it can be tested against a stub in a runner with no DOM. Two source-scanning guard tests (`iconOnlyButtons.test.ts`, the extended `fieldClasses.test.ts`) make a future hand-written copy fail `bun run verify` rather than be noticed a year later.

**Tech Stack:** Bun (tests + scripts), Vite + React 19, TypeScript `strict`, Tailwind v4 + daisyUI v5 (CSS-first themes, no `tailwind.config.*`), `lucide-react` icons, ESLint flat config via `typescript-eslint` + `eslint-plugin-jsx-a11y` + `eslint-plugin-react-hooks`.

**Spec:** `docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md` — sections *Goal*, *Decisions* (D1, D3, D4, D5), *Phase 2 — Primitives in `ui/`*, *ESLint rule matrix*, *Testing*, *Risks*.

## Global Constraints

- **`bun run verify` must be green at the end of every task.** The gate is
  `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`.
  Zero ESLint **errors** at every task boundary; warnings are tolerated until the task that flips
  the rule.
- **Baseline on `main` at `3b944f5`:** 1732 tests pass, `bun run eslint` reports
  `✖ 358 problems (0 errors, 358 warnings)`. Record the new count in each commit body that
  changes it.
- **Every ESLint rule this plan adds or flips gets a step that proves it fires on a real
  violation before the task is called done.** Phase 1 shipped two selectors that matched
  nothing; that class of bug must not repeat. The probe is a throwaway file, deleted before the
  commit, and `git status --short` is checked afterwards.
- **Verify every daisyUI class against the v5 docs before using it.** Class names differ across
  majors and there is no `tailwind.config.*` in this repo. The classes this plan uses were
  checked on 2026-09-04 against daisyui.com for v5: `btn`, `btn-xs`/`btn-sm`/`btn-md`,
  `btn-square`, `btn-ghost`, `btn-primary`, `btn-error`, `btn-active`, `modal`, `modal-box`,
  `modal-action`, `modal-backdrop`, `alert`, `alert-success`, `alert-error`, `card`. Do not
  invent a sixth.
- **No file-level `eslint-disable`.** A disable is `eslint-disable-next-line <rule> -- <reason>`
  and the reason is a sentence, not a restatement of the rule.
- Spec D1: component style is `export function X(props: XProps)` with `interface XProps`, named
  exports, **no `React.FC`**. Every file this plan *creates* follows D1. Files it *edits* keep
  their existing `React.FC` — Phase 3 converts all 46 in one mechanical commit.
- Spec D4: **no Radix or other headless library.** Native `<dialog>` + `showModal()` provides the
  focus trap and Escape.
- Spec D5: a new rule lands as `warn` and flips to `error` in the phase that fixes the offending
  code. This phase flips exactly two things (spec, *Warn vs error at end of Phase 2*): the
  confirm/alert/prompt ban and all `jsx-a11y` rules. `React.FC`, `../../`,
  `consistent-type-definitions` and `exhaustive-deps` stay `warn`.
- Spec, Phase 2 *Warn vs error*: `no-restricted-syntax` holds three bans sharing one rule id and
  ESLint has one severity per rule id, so "confirm/alert to error while `React.FC` stays warn" is
  only expressible by **moving** the confirm ban to `no-restricted-globals` +
  `no-restricted-properties`. That is Task 5.
- Spec, Phase 2 scope line: "Each primitive replaces every current copy of its role in the same
  PR; **a primitive with zero call sites is not done.**"
- Spec acceptance: `grep -rn "confirm(\|alert(\|modal-open" src` returns nothing outside
  `ui/Modal.tsx`'s own comment; every `<button>` whose only child is an icon carries `aria-label`.
- Tests are `bun:test`. **There is no DOM and no testing-library, and none may be added**
  (`.claude/rules/testing.md`). Rendered-markup tests use `renderToString` from
  `react-dom/server` and assert **single literal substrings covering several classes at once**,
  which is what proves the classes sit on the *same* element.
- **The zustand + `renderToString` trap** (`.claude/rules/testing.md`): `getServerSnapshot` is
  wired to `api.getInitialState()`, captured once at store creation, so
  `useAppStore.setState(...)` before a `renderToString` has **no effect, silently**. None of the
  five primitives read the store, so their tests are unaffected — but the call-site tests this
  plan edits (`ChordView.test.tsx`, `SimpleSynthPanel.test.tsx`, `synthPanels.test.tsx`,
  `ProjectManagerModal.test.tsx`, `TrackRow.test.tsx`) all render against creation-time state.
  Do not "fix" one by calling `setState`.
- Theming (`.claude/rules/theming.md`): components name **roles**, never colours.
  `scripts/themeTokenGuard.ts` fails the build on raw hex, Tailwind palette classes,
  `text-white`, the `dark:` variant and dead utilities; its `ALLOWLIST` is empty and must stay
  empty. Every class string this plan writes is already in use somewhere in `src/`.
- Layering (`eslint.config.js`, all `error`): `src/audio/` never imports `store/` or
  `components/`; `src/store/` never imports `components/`; components never import
  `audio/engine`. **The new primitives must not import `store/`** — Phase 3's mapping moves them
  to `src/ui/`, which gets an `error`-level rule banning exactly that.
- Commits use `git add <named files>`, never `-A`. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  ```

---

## Scope decision

One plan, one branch, ten tasks, ten commits. Order is forced by three dependencies and one
spec rule:

- `ConfirmDialog` is built on `Modal` (spec), so `Modal` precedes it.
- `Modal`'s header close button is an `IconButton` (spec), so `IconButton` precedes `Modal`.
- Task 5 can only flip the confirm ban to `error` after Task 4 has deleted the last `confirm()`.
- Task 9's guard sweep covers `PanelCard`'s and `ModuleHeader`'s class strings, so it follows
  Tasks 6 and 7.

`IconButton` has 32 call sites across 13 files; splitting it across Tasks 1 and 2 (the `ui/`
folder, then the feature folders) keeps each reviewable while still landing the primitive and
its sites together — Task 2 closes the set and adds the completeness guard, so "a primitive with
zero call sites is not done" is satisfied by the pair, not by either half.

## Measurements taken on `main` at `3b944f5` (2026-09-04, after Phase 1 merged)

The spec's counts were taken before Phase 1; these supersede them. Every task below names the
exact files it rewrites.

| Role | Sites now | Spec said |
| --- | --- | --- |
| Icon-only `<button>` with no `aria-label` | **32** in 13 files | ~12 |
| `<dialog className="modal modal-open">` | **4** (+2 assertions in `ProjectManagerModal.test.tsx`) | 4 |
| `confirm()` / `alert()` | **6** (4 confirm, 2 alert) | 6 |
| Header row `flex items-center justify-between border-b border-base-300 pb-2` | **10** | 9 |
| Title span `text-xs font-bold text-base-content flex items-center gap-1.5` | **10** | 10 |
| Card shell `card … bg-panel border border-base-300 shadow-md` | **16** | 4 |
| `FIELD_LABEL` lookalikes | **10** in 5 files | 4 |
| `jsx-a11y` warnings | **41** across 5 rules | — |

## File Structure

Created:

| Path | Responsibility |
| --- | --- |
| `src/components/ui/cx.ts` | One class-name joiner; drops falsy fragments, collapses whitespace. |
| `src/components/ui/cx.test.ts` | Its unit test. |
| `src/components/ui/IconButton.tsx` | The square icon button; owns `aria-label` + `title` and the size/variant class table. |
| `src/components/ui/IconButton.test.tsx` | `renderToString` contract test. |
| `src/components/ui/iconOnlyButtons.test.ts` | Source-scanning guard: no icon-only `<button>` without `aria-label`. |
| `src/components/ui/syncDialogOpen.ts` | Pure `showModal()`/`close()` reconciler + the `DialogHandle` shape. |
| `src/components/ui/syncDialogOpen.test.ts` | Stub-driven test (no DOM). |
| `src/components/ui/Modal.tsx` | Native `<dialog>` shell: `modal-box`, header, backdrop, native `close` wiring. |
| `src/components/ui/Modal.test.tsx` | `renderToString` markup test. |
| `src/components/ui/ConfirmDialog.tsx` | Confirmation built on `Modal`. |
| `src/components/ui/ConfirmDialog.test.tsx` | `renderToString` markup test. |
| `src/components/ui/ModuleHeader.tsx` | The card header row + canonical title span. |
| `src/components/ui/ModuleHeader.test.tsx` | `renderToString` markup test. |
| `src/components/ui/PanelCard.tsx` | The panel card shell + module tint. |
| `src/components/ui/PanelCard.test.tsx` | `renderToString` markup test. |

Modified (grouped by the task that touches them):

| Path | Change | Task |
| --- | --- | --- |
| `src/components/ui/MidiSettingsModal.tsx` | 2 icon buttons; dialog → `Modal`; 2 labels get `htmlFor` | 1, 3, 10 |
| `src/components/ui/PresetLibrary.tsx` | 5 icon buttons; save modal → `Modal`; `toastTone`; header → `ModuleHeader`; 7 labels; drawer overlay | 1, 3, 4, 6, 9, 10 |
| `src/components/ui/BottomInputDock.tsx` | 2 icon buttons | 1 |
| `src/components/ui/PlayerTransport.tsx` | 1 icon button | 1 |
| `src/components/ui/QuickSavePopover.tsx` | Escape close + return focus; `autoFocus` → effect | 8 |
| `src/components/ui/QuickSavePopover.test.tsx` | new assertions | 8 |
| `src/components/ui/PresetLibrary.test.tsx` | modal-heading + tone assertions | 3, 4 |
| `src/components/ui/fieldClasses.test.ts` | guard extension | 9 |
| `src/components/ui/ViewHeader.tsx` | card → `PanelCard` | 7 |
| `src/components/TransportBar.tsx` | 2 icon buttons | 2 |
| `src/components/Header.tsx` | 1 icon button (theme toggle) | 2 |
| `src/components/loop/SequencerView.tsx` | 2 icon buttons; 2 cards | 2, 7 |
| `src/components/loop/SynthView.tsx` | 4 icon buttons; 1 card | 2, 7 |
| `src/components/loop/SynthPresetLibrary.tsx` | 3 icon buttons; 2 `confirm`; 1 `alert` | 2, 4 |
| `src/components/loop/ChordPresetLibrary.tsx` | 3 icon buttons; 2 `confirm`; 1 `alert` | 2, 4 |
| `src/components/loop/sequencer/TrackRow.tsx` | 1 icon button | 2 |
| `src/components/loop/sequencer/TrackRow.test.tsx` | 4 golden HTML strings regenerated | 2 |
| `src/components/loop/chord/BassModulePanel.tsx` | 1 icon button; 5 labels | 2, 10 |
| `src/components/loop/chord/ChordModulePanel.tsx` | 1 icon button; 5 labels | 2, 10 |
| `src/components/loop/chord/SortableChordCard.tsx` | 4 icon buttons; 3 labels | 2, 10 |
| `src/components/project/ProjectDialogs.tsx` | `Shell` deleted; `DeleteConfirmDialog` → thin call | 3, 4 |
| `src/components/project/ProjectManagerModal.tsx` | dialog → `Modal` | 3 |
| `src/components/project/ProjectManagerModal.test.tsx` | 2 `modal-open` assertions | 3 |
| `src/components/project/ProjectList.tsx` | 1 `autoFocus` disable | 10 |
| `src/components/song/EffectsRackView.tsx` | 4 headers; 1 card | 6, 7 |
| `src/components/song/SortableLoopCard.tsx` | 1 `autoFocus` + 2 click-handler disables | 10 |
| `src/components/loop/ChordView.tsx` | 1 header; 2 preview spans get keyboard handlers | 6, 10 |
| `src/components/loop/SimpleSynthPanel.tsx` | 4 cards | 7 |
| `src/components/loop/synth/{Oscillator,Filter,Envelope,Lfo,Arpeggiator}Panel.tsx` | 5 headers; 5 cards; 6 labels | 6, 7, 9 |
| `src/components/loop/synth/synthPanels.test.tsx` | 2 card-class assertions | 7 |
| `eslint.config.js` | confirm ban moved to error; jsx-a11y to error | 5, 10 |

---

### Task 1: `cx`, `IconButton`, and the ten `ui/` call sites

Spec, Phase 2 table: `IconButton` takes `label: string` (required; emitted as **both**
`aria-label` and `title`), `icon`, `size: 'xs' | 'sm' | 'md'`, `variant: 'ghost' | 'outline' |
'primary' | 'error'`, `active?`, plus native button props. It replaces the unlabelled icon
buttons and the hand-written icon-button class variants.

**Files:**
- Create: `src/components/ui/cx.ts`, `src/components/ui/cx.test.ts`
- Create: `src/components/ui/IconButton.tsx`, `src/components/ui/IconButton.test.tsx`
- Modify: `src/components/ui/MidiSettingsModal.tsx:84`, `:227`
- Modify: `src/components/ui/BottomInputDock.tsx:121`, `:136`
- Modify: `src/components/ui/PresetLibrary.tsx:204`, `:264`, `:316`, `:393`, `:531`
- Modify: `src/components/ui/PlayerTransport.tsx:104`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `cx(...parts: Array<string | false | null | undefined>): string` from `ui/cx.ts`.
  - `IconButton(props: IconButtonProps)` from `ui/IconButton.tsx`, plus the exported types
    `IconButtonSize = 'xs' | 'sm' | 'md'`, `IconButtonVariant = 'ghost' | 'outline' | 'primary'
    | 'error'`, and the constant `ICON_BUTTON_BASE = 'btn btn-square'`.
  - `IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title' |
    'aria-label'>` with `label: string`, `icon: ReactNode`, `size?: IconButtonSize`,
    `variant?: IconButtonVariant`, `active?: boolean`.
  - Rendered class order is `btn btn-square {size} {variant} [btn-active] [className]`.

- [ ] **Step 1: Write the failing test for `cx`**

Create `src/components/ui/cx.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { cx } from './cx';

describe('cx', () => {
  test('drops falsy fragments', () => {
    expect(cx('btn', undefined, false, null, 'btn-xs')).toBe('btn btn-xs');
  });

  /**
   * The primitives interpolate optional props into a class string. Without the
   * collapse, an absent `tint` leaves a double space in the rendered attribute
   * and every renderToString assertion has to know about it.
   */
  test('collapses the whitespace an absent fragment leaves behind', () => {
    expect(cx('btn  btn-square', '   ', 'btn-ghost')).toBe('btn btn-square btn-ghost');
  });

  test('is the empty string when every fragment is falsy', () => {
    expect(cx(undefined, '', false)).toBe('');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/components/ui/cx.test.ts`
Expected: FAIL — `Cannot find module './cx'`.

- [ ] **Step 3: Write `cx`**

Create `src/components/ui/cx.ts`:

```ts
/**
 * Joins class-name fragments, dropping the falsy ones and collapsing runs of
 * whitespace.
 *
 * Every primitive in this folder composes a fixed base string with optional
 * caller-supplied extras. Template interpolation leaves a double space when an
 * optional fragment is absent, which then has to be reproduced in every
 * renderToString assertion; this makes the rendered attribute the same whether
 * or not the optional prop was passed.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/components/ui/cx.test.ts`
Expected: `3 pass`.

- [ ] **Step 5: Write the failing test for `IconButton`**

Create `src/components/ui/IconButton.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  /**
   * The whole reason this primitive exists: 32 icon-only buttons rendered no
   * accessible name at all. `label` is required, and it is emitted twice — as
   * `aria-label` for assistive tech and as `title` for the sighted hover hint
   * the hand-written copies already had.
   */
  test('emits the label as both aria-label and title', () => {
    const html = renderToString(<IconButton label="Close" icon={<X className="w-4 h-4" />} />);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('title="Close"');
  });

  test('defaults to a small ghost square button', () => {
    const html = renderToString(<IconButton label="Close" icon={<X className="w-4 h-4" />} />);
    expect(html).toContain('class="btn btn-square btn-sm btn-ghost"');
  });

  test('size, variant, active and className land in one class attribute', () => {
    const html = renderToString(
      <IconButton
        label="Mute"
        icon={<X className="w-3 h-3" />}
        size="xs"
        variant="outline"
        active
        className="text-module-bass select-none"
      />,
    );
    expect(html).toContain(
      'class="btn btn-square btn-xs btn-ghost border border-base-300 btn-active text-module-bass select-none"',
    );
  });

  test('renders type="button" so an icon inside a form never submits it', () => {
    expect(renderToString(<IconButton label="Delete" icon={<X />} />)).toContain('type="button"');
  });

  test('passes native button props through', () => {
    const html = renderToString(
      <IconButton id="btn-x" label="Delete" icon={<X />} disabled variant="error" />,
    );
    expect(html).toContain('id="btn-x"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('btn-error');
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `bun test src/components/ui/IconButton.test.tsx`
Expected: FAIL — `Cannot find module './IconButton'`.

- [ ] **Step 7: Write `IconButton`**

Create `src/components/ui/IconButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type IconButtonSize = 'xs' | 'sm' | 'md';
export type IconButtonVariant = 'ghost' | 'outline' | 'primary' | 'error';

/** The shape every icon button shares; the guard test regexes for it. */
export const ICON_BUTTON_BASE = 'btn btn-square';

const SIZE_CLASS: Record<IconButtonSize, string> = {
  xs: 'btn-xs',
  sm: 'btn-sm',
  md: 'btn-md',
};

/**
 * `outline` is *this app's* outlined icon button — a ghost button with an
 * explicit base-300 border — not daisyUI's `btn-outline`, which paints the
 * border in the button's own colour and would change four call sites' look.
 * Four hand-written copies of `btn-ghost border border-base-300` are the drift
 * this closed union exists to end.
 */
const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  ghost: 'btn-ghost',
  outline: 'btn-ghost border border-base-300',
  primary: 'btn-primary',
  error: 'btn-error',
};

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title' | 'aria-label'> {
  /**
   * The accessible name. Required, and emitted as both `aria-label` and
   * `title`: an icon-only button has no text node, so without it the button is
   * announced as "button" and hovers with no hint.
   */
  label: string;
  icon: ReactNode;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** Adds daisyUI's `btn-active` — a pressed/selected icon button. */
  active?: boolean;
}

export function IconButton({
  label,
  icon,
  size = 'sm',
  variant = 'ghost',
  active = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cx(ICON_BUTTON_BASE, SIZE_CLASS[size], VARIANT_CLASS[variant], active && 'btn-active', className)}
    >
      {icon}
    </button>
  );
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `bun test src/components/ui/IconButton.test.tsx`
Expected: `5 pass`.

- [ ] **Step 9: Convert the two `MidiSettingsModal` buttons**

`src/components/ui/MidiSettingsModal.tsx` — add `import { IconButton } from './IconButton';`
after the existing `import { SECTION_HEADER } from './fieldClasses';` (line 5).

At line 84 (the header close button):

```diff
-          <button
-            type="button"
-            onClick={() => setIsOpen(false)}
-            className="btn btn-sm btn-ghost btn-square"
-            title="Close"
-          >
-            <X className="w-4 h-4" />
-          </button>
+          <IconButton label="Close" icon={<X className="w-4 h-4" />} onClick={() => setIsOpen(false)} />
```

At line 227 (the per-mapping delete):

```diff
-                      <button
-                        type="button"
-                        onClick={() => removeMidiMapping(m.id)}
-                        className="btn btn-xs btn-ghost btn-square text-error"
-                        title="Delete Mapping"
-                      >
-                        <Trash2 className="w-3.5 h-3.5" />
-                      </button>
+                      <IconButton
+                        label="Delete Mapping"
+                        icon={<Trash2 className="w-3.5 h-3.5" />}
+                        size="xs"
+                        className="text-error"
+                        onClick={() => removeMidiMapping(m.id)}
+                      />
```

Keep the surrounding JSX exactly as it is; only the button element changes. If ESLint then
reports `X` or `Trash2` as unused, the import list at line 2 keeps both (they are still used by
the `icon` props above) — do not delete them.

- [ ] **Step 10: Convert the two `BottomInputDock` chevrons**

`src/components/ui/BottomInputDock.tsx` — add `import { IconButton } from './IconButton';`
next to the other `./` imports. Lines 121 and 136 carry an identical long class string; the part
that is not `btn btn-xs btn-square btn-ghost` moves to `className`:

```diff
-                  <button
-                    type="button"
-                    onClick={...}
-                    disabled={...}
-                    title="Previous octave"
-                    className="btn btn-xs btn-square btn-ghost w-7 h-7 min-h-0 border border-base-300 text-base-content/60 hover:text-base-content hover:border-primary hover:bg-primary/20 disabled:opacity-30"
-                  >
-                    <ChevronLeft className="w-4 h-4" />
-                  </button>
+                  <IconButton
+                    label="Previous octave"
+                    icon={<ChevronLeft className="w-4 h-4" />}
+                    size="xs"
+                    onClick={...}
+                    disabled={...}
+                    className="w-7 h-7 min-h-0 border border-base-300 text-base-content/60 hover:text-base-content hover:border-primary hover:bg-primary/20 disabled:opacity-30"
+                  />
```

Do the same at line 136 with `ChevronRight` and the label `Next octave`. **Read the existing
`title` attribute on each button and use it verbatim as `label`** — do not paraphrase; the two
strings above are what is there today. Leave the `onClick`/`disabled` expressions byte-identical.

- [ ] **Step 11: Convert the five `PresetLibrary` icon buttons**

`src/components/ui/PresetLibrary.tsx` — add `import { IconButton } from './IconButton';` to the
`./` import group. These five have **no** `title` and **no** `aria-label` today, so each gets a
new name; the names below are chosen from the surrounding markup and are the ones to use:

| Line | Current | Replacement |
| --- | --- | --- |
| 204 | close `<X className="w-4 h-4" />`, dynamic `clearBtnClass`-style className | `<IconButton label="Close" icon={<X className="w-4 h-4" />} className={<existing className expression>} onClick={onClose} />` |
| 264 | clear-search `<X className="w-3 h-3" />` | `<IconButton label="Clear search" icon={<X className="w-3 h-3" />} size="xs" className={<existing className expression>} onClick={() => setQuery('')} />` |
| 316 | inline-save close, `btn btn-xs btn-ghost btn-circle` | `<IconButton label="Close save form" icon={<X className="w-3.5 h-3.5" />} size="xs" className="btn-circle" onClick={() => setShowSave(false)} />` |
| 393 | modal-save close, `btn btn-xs btn-ghost btn-circle` | `<IconButton label="Close save form" icon={<X className="w-4 h-4" />} size="xs" className="btn-circle" onClick={() => setShowSave(false)} />` |
| 531 | entry delete, `btn btn-xs btn-ghost btn-circle text-base-content/60 hover:text-error` | `<IconButton label={\`Delete ${entry.name}\`} icon={<Trash2 className="w-3.5 h-3.5" />} size="xs" className="btn-circle text-base-content/60 hover:text-error" onClick={<existing onClick expression>} />` |

`btn-circle` stays in `className` rather than becoming a variant: it is a *shape*, and adding a
shape axis to a primitive with one shape-exception is more surface than it buys. `btn btn-square
btn-xs btn-ghost btn-circle` renders as a circle — `btn-circle` and `btn-square` set the same
properties and the later declaration in daisyUI's stylesheet wins; verify visually in Step 14 and,
if the button renders square, drop `ICON_BUTTON_BASE`'s `btn-square` for these three by passing
`className="btn-circle"` **and** confirming with `bun run build` + a browser check.

Copy each `onClick` / `className` expression verbatim from the current source; do not retype it
from this table.

Note (line 393): the modal-save close button is deleted entirely in Task 3 when
`PresetLibraryModal` moves onto `Modal`, which renders its own header close. Converting it here
keeps this task self-contained and Task 3's diff a straight deletion.

- [ ] **Step 12: Convert the `PlayerTransport` hard-stop button**

`src/components/ui/PlayerTransport.tsx:104`. `sizeClass` (line 84) is derived from the `size`
prop, which is already `'xs' | 'sm'` — pass the prop straight through instead:

```diff
-        <button
-          id={id ? `${id}-hard` : undefined}
-          type="button"
-          onClick={onHardStop}
-          disabled={hardStopDisabled ?? buttons.hard.disabled}
-          title="Stop immediately"
-          className={`btn ${sizeClass} join-item btn-error btn-square font-bold text-xs`}
-        >
-          <X className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
-        </button>
+        <IconButton
+          id={id ? `${id}-hard` : undefined}
+          label="Stop immediately"
+          icon={<X className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
+          size={size}
+          variant="error"
+          onClick={onHardStop}
+          disabled={hardStopDisabled ?? buttons.hard.disabled}
+          className="join-item font-bold text-xs"
+        />
```

Add `import { IconButton } from './IconButton';`. `sizeClass` is still used by the main button on
line 93, so leave the `const` alone.

- [ ] **Step 13: Run the touched tests**

Run: `bun test src/components/ui/`
Expected: every file passes. `PlayerTransport.test.tsx` asserts only on the pure
`resolvePlayerTransport` helper (no markup), so it is unaffected. If
`PresetLibrary.test.tsx:51` (`drawer-overlay`) or `:77` (`alert alert-success`) fails, you
changed something outside this task's scope — revert that part.

- [ ] **Step 14: Verify and commit**

Run: `bun run verify`
Expected: green; `bun run eslint` still reports `0 errors`. The warning total drops by however
many `jsx-a11y` warnings the ten conversions cleared (none of the ten were in the a11y list, so
expect `358` unchanged — the a11y rules do not flag a missing `aria-label` on a `<button>`,
which is exactly why the guard test in Task 2 is needed).

```bash
git add src/components/ui/cx.ts src/components/ui/cx.test.ts src/components/ui/IconButton.tsx src/components/ui/IconButton.test.tsx src/components/ui/MidiSettingsModal.tsx src/components/ui/BottomInputDock.tsx src/components/ui/PresetLibrary.tsx src/components/ui/PlayerTransport.tsx
git commit -m "feat(ui): add IconButton and cx, and convert the ten ui/ icon buttons

IconButton takes a required label and emits it as both aria-label and
title; size and variant are closed unions over the measured daisyUI
classes, so the nine hand-written icon-button variants have one home.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 2: The remaining 22 icon buttons, and the guard that closes the set

Spec acceptance: "Every `<button>` whose only child is an icon carries `aria-label`." This task
converts the rest and then ships a source-scanning test so a thirty-third cannot appear quietly.

**Files:**
- Modify: `src/components/TransportBar.tsx:93`, `:109`
- Modify: `src/components/Header.tsx:384`
- Modify: `src/components/loop/SequencerView.tsx:294`, `:303`
- Modify: `src/components/loop/SynthView.tsx:493`, `:536`, `:568`, `:595`
- Modify: `src/components/loop/SynthPresetLibrary.tsx:331`, `:340`, `:358`
- Modify: `src/components/loop/ChordPresetLibrary.tsx:334`, `:402`, `:426`
- Modify: `src/components/loop/sequencer/TrackRow.tsx:86`
- Modify: `src/components/loop/sequencer/TrackRow.test.tsx:58-61` (four golden HTML strings)
- Modify: `src/components/loop/chord/BassModulePanel.tsx:158`
- Modify: `src/components/loop/chord/ChordModulePanel.tsx:160`
- Modify: `src/components/loop/chord/SortableChordCard.tsx:83`, `:97`, `:106`, `:115`
- Create: `src/components/ui/iconOnlyButtons.test.ts`

**Interfaces:**
- Consumes: `IconButton` and its props from Task 1.
- Produces: no new API. After this task, `src/` contains zero icon-only `<button>` elements
  without an `aria-label`, and the guard test enforces it.

- [ ] **Step 1: Convert the twenty-two sites**

Every one is `import { IconButton } from '<relative path to ui/IconButton>';` plus the
substitution below. The `label` column is the button's **existing `title` attribute, copied
verbatim** — read it from the source before typing it. `className` receives everything the
current class string has beyond `btn`, the size, and the variant.

| File:line | `label` (= today's `title`) | `size` | `variant` | `className` |
| --- | --- | --- | --- | --- |
| `TransportBar.tsx:93` | (read it) | `xs` | `ghost` | — |
| `TransportBar.tsx:109` | (read it) | `xs` | `ghost` | — |
| `Header.tsx:384` | `` {`Switch to ${currentTheme === 'solna-dark' ? 'Light' : 'Dark'} Theme`} `` | `sm` | `ghost` | — |
| `SequencerView.tsx:294` | (read it) | `sm` | `ghost` | — |
| `SequencerView.tsx:303` | (read it) | `sm` | `ghost` | — |
| `SynthView.tsx:493` | (read it) | `xs` | `outline` | — |
| `SynthView.tsx:536` | (read it) | `xs` | `outline` | — |
| `SynthView.tsx:568` | (read it) | `sm` | `outline` | — |
| `SynthView.tsx:595` | (read it) | `sm` | `outline` | — |
| `SynthPresetLibrary.tsx:331` | (read it) | `xs` | `ghost` | `hover:btn-primary` |
| `SynthPresetLibrary.tsx:340` | (read it) | `xs` | `ghost` | `hover:btn-error` |
| `SynthPresetLibrary.tsx:358` | (read it) | `sm` | `ghost` | `disabled:opacity-40` |
| `ChordPresetLibrary.tsx:334` | (read it) | `xs` | `ghost` | the whole existing template literal minus `btn ` and `btn-xs ` |
| `ChordPresetLibrary.tsx:402` | (read it) | `xs` | `ghost` | as above |
| `ChordPresetLibrary.tsx:426` | (read it) | `xs` | `ghost` | `hover:btn-error` |
| `TrackRow.tsx:86` | `Preview Instrument` | `xs` | `ghost` | `hover:text-primary hidden sm:inline-flex` |
| `BassModulePanel.tsx:158` | (read it) | `xs` | `ghost` | `text-module-bass select-none` |
| `ChordModulePanel.tsx:160` | (read it) | `xs` | `ghost` | `text-module-chord select-none` |
| `SortableChordCard.tsx:83` | (read it) | `xs` | `ghost` | `cursor-grab active:cursor-grabbing text-base-content/50 hover:text-base-content focus:outline-none` |
| `SortableChordCard.tsx:97` | (read it) | `xs` | `ghost` | `disabled:opacity-30` |
| `SortableChordCard.tsx:106` | (read it) | `xs` | `ghost` | `disabled:opacity-30` |
| `SortableChordCard.tsx:115` | (read it) | `xs` | `ghost` | `hover:text-error ml-1 disabled:opacity-30` |

Two shapes, written out in full so the pattern is unambiguous.

`TransportBar.tsx:93` (the plain case):

```diff
-          <button
-            id="btn-bpm-down"
-            onClick={...}
-            className="btn btn-xs btn-square btn-ghost"
-            title="Decrease BPM"
-          >
-            <Minus className="w-3 h-3" />
-          </button>
+          <IconButton
+            id="btn-bpm-down"
+            label="Decrease BPM"
+            icon={<Minus className="w-3 h-3" />}
+            size="xs"
+            onClick={...}
+          />
```

`Header.tsx:384` (the ternary-icon case — note the icon expression moves inside `icon`, and the
dynamic title becomes the dynamic label):

```diff
-        <button
-          id="btn-toggle-theme"
-          onClick={toggleTheme}
-          className="btn btn-sm btn-square btn-ghost"
-          title={`Switch to ${currentTheme === 'solna-dark' ? 'Light' : 'Dark'} Theme`}
-        >
-          {currentTheme === 'solna-dark' ? (
-            <Sun className="w-4 h-4 text-primary" />
-          ) : (
-            <Moon className="w-4 h-4 text-primary" />
-          )}
-        </button>
+        <IconButton
+          id="btn-toggle-theme"
+          label={`Switch to ${currentTheme === 'solna-dark' ? 'Light' : 'Dark'} Theme`}
+          icon={
+            currentTheme === 'solna-dark' ? (
+              <Sun className="w-4 h-4 text-primary" />
+            ) : (
+              <Moon className="w-4 h-4 text-primary" />
+            )
+          }
+          onClick={toggleTheme}
+        />
```

`SortableChordCard.tsx:83` is the drag handle: it carries dnd-kit's `{...attributes}
{...listeners}` spread. Keep the spread as the **first** prop on `IconButton` so the explicit
`label`/`title` below it win — dnd-kit sets its own `aria-*` attributes and `role="button"`, and
`IconButton` must not let them replace the name.

- [ ] **Step 2: Regenerate the four `TrackRow` golden strings**

`src/components/loop/sequencer/TrackRow.test.tsx:58-61` pins four full HTML strings, each
containing the preview button as
`class="btn btn-ghost btn-xs btn-square hover:text-primary hidden sm:inline-flex" title="Preview Instrument"`.
`IconButton` renders the same classes in its own order and adds `aria-label`, so all four
constants change.

Run: `bun test src/components/loop/sequencer/TrackRow.test.tsx`
Expected: FAIL, four times, with bun printing the received string for each.

For each of `IDLE`, `PLAYING_STEP_4`, `PLAYING_BUT_STOPPED`, `MUTED`, copy the **received**
string from the failure output into the constant, replacing the expected one. Then re-read the
diff between old and new by eye and confirm the *only* differences are, on the preview button:
`class="btn btn-ghost btn-xs btn-square …"` → `class="btn btn-square btn-xs btn-ghost …"`, and
the added `aria-label="Preview Instrument"`. If anything else moved, you changed markup you were
not asked to change.

Run: `bun test src/components/loop/sequencer/TrackRow.test.tsx`
Expected: PASS.

- [ ] **Step 3: Write the guard test and watch it pass on a clean tree**

Create `src/components/ui/iconOnlyButtons.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx$/.test(name) || /\.test\.tsx$/.test(name)) return [];
    return [path];
  });
}

/**
 * Walks to the `>` that ends a JSX opening tag, ignoring `>` inside strings and
 * inside `{...}` expression containers (`onClick={() => x > 1}` is not the end
 * of the tag).
 */
function endOfOpeningTag(text: string, from: number): number {
  let i = from;
  let depth = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
    i++;
  }
  return text.length;
}

/**
 * The regression `ui/IconButton.tsx` exists for: 32 buttons whose only child
 * was an SVG icon rendered no accessible name at all — a screen reader
 * announced "button" and nothing else. Use `IconButton`, which requires a
 * label; a bare `<button>` with an icon and no `aria-label` fails here.
 *
 * Known limitation: a body that is a single `{cond ? <A/> : <B/>}` still reads
 * as text to this scanner and is skipped. Header's theme toggle was the one
 * such case and it is an IconButton; a new one would slip through.
 */
describe('icon-only buttons', () => {
  test('every icon-only <button> in src/ carries an aria-label', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      const re = /<button\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const end = endOfOpeningTag(text, m.index + '<button'.length);
        const open = text.slice(m.index, end + 1);
        if (open.includes('aria-label')) continue;
        const close = text.indexOf('</button>', end);
        if (close === -1) continue;
        const body = text.slice(end + 1, close).trim().replace(/\s+/g, ' ');
        if (/<span|<div/.test(body)) continue;          // has a text slot
        if (!/<[A-Z]/.test(body)) continue;             // not an icon component
        const withoutTags = body.replace(/<[^>]*>/g, '').replace(/[{}?:()/\\'"]/g, ' ').trim();
        if (withoutTags !== '') continue;               // has literal text
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line} ${body.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

Run: `bun test src/components/ui/iconOnlyButtons.test.ts`
Expected: PASS with an empty offender list. **If it lists anything, the list is the work** —
convert each named site with the same substitution and re-run. Do not soften the scanner.

- [ ] **Step 4: Prove the guard actually catches a regression**

```bash
cat > src/components/ui/guardProbe.tsx <<'PROBE'
import { X } from 'lucide-react';
export function GuardProbe() {
  return <button type="button" className="btn btn-xs btn-square btn-ghost"><X className="w-3 h-3" /></button>;
}
PROBE
bun test src/components/ui/iconOnlyButtons.test.ts
rm src/components/ui/guardProbe.tsx
```

Expected: the run **fails** and names `src/components/ui/guardProbe.tsx:3` in the offender array.
Then:

Run: `bun test src/components/ui/iconOnlyButtons.test.ts && git status --short`
Expected: PASS, and `guardProbe.tsx` is gone from the status output.

- [ ] **Step 5: Verify and commit**

Run: `bun run verify`
Expected: green, `0 errors`.

Run: `bun run eslint 2>&1 | tail -1`
Expected: `✖ N problems (0 errors, N warnings)` — record `N` in the commit body.

```bash
git add src/components/TransportBar.tsx src/components/Header.tsx src/components/loop/SequencerView.tsx src/components/loop/SynthView.tsx src/components/loop/SynthPresetLibrary.tsx src/components/loop/ChordPresetLibrary.tsx src/components/loop/sequencer/TrackRow.tsx src/components/loop/sequencer/TrackRow.test.tsx src/components/loop/chord/BassModulePanel.tsx src/components/loop/chord/ChordModulePanel.tsx src/components/loop/chord/SortableChordCard.tsx src/components/ui/iconOnlyButtons.test.ts
git commit -m "feat(ui): convert the remaining 22 icon buttons and guard the set

All 32 icon-only buttons now render an accessible name.
iconOnlyButtons.test.ts scans src/ and fails verify on a bare <button>
whose only child is an icon component.

bun run eslint: 0 errors, <N> warnings.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

Replace `<N>` with the number from Step 5 before running.

---

### Task 3: `Modal` — one `<dialog>` that actually calls `showModal()`

Spec, *Measurements*: all four `<dialog className="modal modal-open">` sites never call
`showModal()`, so they have **no focus trap, no Escape, and their `onCancel` handlers never
fire** (the `cancel` event only fires for modal dialogs). Spec contract: `open`, `onClose`,
`title`, `children` inside `modal-box`, optional `size`; a ref + effect calling `showModal()` /
`close()`; `onClose` bound to the native `close` event so Escape, the backdrop form and the
header button all go through one path; **never renders `modal-open`**.

**Files:**
- Create: `src/components/ui/syncDialogOpen.ts`, `src/components/ui/syncDialogOpen.test.ts`
- Create: `src/components/ui/Modal.tsx`, `src/components/ui/Modal.test.tsx`
- Modify: `src/components/ui/MidiSettingsModal.tsx:76-292` (the `<dialog>` wrapper only)
- Modify: `src/components/ui/PresetLibrary.tsx:386-485` (`PresetLibraryModal`)
- Modify: `src/components/ui/PresetLibrary.test.tsx` (the save-modal heading assertion)
- Modify: `src/components/project/ProjectDialogs.tsx:1-16` (`Shell` deleted) and its five callers
- Modify: `src/components/project/ProjectManagerModal.tsx:145-…`
- Modify: `src/components/project/ProjectManagerModal.test.tsx:32`, `:71`

**Interfaces:**
- Consumes: `IconButton`, `cx` (Task 1).
- Produces:
  - `interface DialogHandle { open: boolean; showModal(): void; close(): void }` and
    `syncDialogOpen(el: DialogHandle | null, open: boolean): void` from `ui/syncDialogOpen.ts`.
  - `Modal(props: ModalProps)` and `type ModalSize = 'sm' | 'md' | 'lg'` and
    `const MODAL_BOX = 'modal-box bg-base-100 border border-base-300 shadow-2xl'` from
    `ui/Modal.tsx`.
  - `ModalProps = { open: boolean; onClose: () => void; title: ReactNode; size?: ModalSize;
    headerDivider?: boolean; boxClassName?: string; children: ReactNode }`.

**Two deliberate convergences.** The spec's non-goal is "no visual change", but four dialogs
wear four different boxes and one primitive cannot render all four. These two are intended and
are the only ones:

1. `PresetLibraryModal`'s box goes from `modal-box max-w-sm bg-base-100 border border-primary/40
   space-y-4` to the standard `modal-box bg-base-100 border border-base-300 shadow-2xl max-w-sm
   space-y-4` — it gains the shadow and loses the primary-tinted border.
2. `PresetLibraryModal`'s heading goes from `font-bold text-sm` to the shared header's
   `font-bold text-lg`.

`headerDivider` and `boxClassName` are **extensions** to the spec's contract, added because
`MidiSettingsModal`'s header is ruled off with `border-b border-base-300 pb-4` and the four boxes
use two different `space-y` values. Without them those would be a third and fourth convergence.

- [ ] **Step 1: Write the failing test for `syncDialogOpen`**

Create `src/components/ui/syncDialogOpen.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { syncDialogOpen, type DialogHandle } from './syncDialogOpen';

/**
 * There is no DOM in this runner (.claude/rules/testing.md), so the reconciler
 * is tested against the three-member shape it actually uses. A real
 * HTMLDialogElement satisfies the same shape.
 */
function stubDialog(open: boolean): DialogHandle & { calls: string[] } {
  return {
    open,
    calls: [] as string[],
    showModal() {
      this.open = true;
      this.calls.push('showModal');
    },
    close() {
      this.open = false;
      this.calls.push('close');
    },
  };
}

describe('syncDialogOpen', () => {
  test('opens a closed dialog modally', () => {
    const el = stubDialog(false);
    syncDialogOpen(el, true);
    expect(el.calls).toEqual(['showModal']);
    expect(el.open).toBe(true);
  });

  test('closes an open dialog', () => {
    const el = stubDialog(true);
    syncDialogOpen(el, false);
    expect(el.calls).toEqual(['close']);
    expect(el.open).toBe(false);
  });

  /**
   * The effect re-runs on every parent render. showModal() on an already-open
   * dialog throws InvalidStateError, so the no-ops are the point of the helper,
   * not a nicety.
   */
  test('is a no-op when the dialog already matches the prop', () => {
    const alreadyOpen = stubDialog(true);
    syncDialogOpen(alreadyOpen, true);
    expect(alreadyOpen.calls).toEqual([]);

    const alreadyClosed = stubDialog(false);
    syncDialogOpen(alreadyClosed, false);
    expect(alreadyClosed.calls).toEqual([]);
  });

  test('tolerates a ref that has not attached yet', () => {
    expect(() => syncDialogOpen(null, true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/components/ui/syncDialogOpen.test.ts`
Expected: FAIL — `Cannot find module './syncDialogOpen'`.

- [ ] **Step 3: Write `syncDialogOpen`**

Create `src/components/ui/syncDialogOpen.ts`:

```ts
/**
 * The three members `syncDialogOpen` touches. `HTMLDialogElement` satisfies it
 * structurally, and so does a plain object — which is what makes this testable
 * in a runner with no DOM.
 */
export interface DialogHandle {
  open: boolean;
  showModal(): void;
  close(): void;
}

/**
 * Brings a native `<dialog>` in line with a React `open` prop.
 *
 * `showModal()` — not the `modal-open` class — is what gives the dialog its
 * focus trap, its Escape handling and its top-layer stacking; all four dialogs
 * in this app used the class and had none of the three. Calling `showModal()`
 * on an already-open dialog throws `InvalidStateError`, and the effect that
 * calls this re-runs on every render, so both no-op branches are load-bearing.
 */
export function syncDialogOpen(el: DialogHandle | null, open: boolean): void {
  if (!el) return;
  if (open && !el.open) el.showModal();
  else if (!open && el.open) el.close();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/components/ui/syncDialogOpen.test.ts`
Expected: `4 pass`.

- [ ] **Step 5: Write the failing test for `Modal`**

Create `src/components/ui/Modal.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Sliders } from 'lucide-react';
import { Modal } from './Modal';

const noop = () => {};

describe('Modal', () => {
  /**
   * The bug this primitive fixes: `modal-open` shows the dialog without making
   * it modal, so there is no focus trap and Escape does nothing. Openness is a
   * DOM property set by showModal(), never a class.
   */
  test('never renders modal-open', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('<dialog class="modal"');
    expect(html).not.toContain('modal-open');
  });

  test('renders the standard box chrome and the default width', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('class="modal-box bg-base-100 border border-base-300 shadow-2xl max-w-md"');
  });

  test('size and boxClassName compose onto the box', () => {
    const html = renderToString(
      <Modal open onClose={noop} title="MIDI" size="lg" boxClassName="space-y-6">body</Modal>,
    );
    expect(html).toContain(
      'class="modal-box bg-base-100 border border-base-300 shadow-2xl max-w-2xl space-y-6"',
    );
  });

  test('the header carries the title and a labelled close button', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('class="flex items-center justify-between"');
    expect(html).toContain('<h3 class="font-bold text-lg flex items-center gap-2">Projects</h3>');
    expect(html).toContain('aria-label="Close"');
  });

  test('headerDivider rules the header off from the body', () => {
    const html = renderToString(
      <Modal open onClose={noop} headerDivider title={<><Sliders className="w-5 h-5 text-primary" />MIDI</>}>
        body
      </Modal>,
    );
    expect(html).toContain('class="flex items-center justify-between border-b border-base-300 pb-4"');
  });

  test('renders the backdrop form the platform closes on', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('<form method="dialog" class="modal-backdrop">');
  });

  /**
   * Openness lives in the DOM, so the two prop values must produce identical
   * markup — the effect, not the render, is what opens the dialog. If this ever
   * diverges, a server-rendered modal would flash.
   */
  test('markup does not depend on the open prop', () => {
    const opened = renderToString(<Modal open onClose={noop} title="X">body</Modal>);
    const closed = renderToString(<Modal open={false} onClose={noop} title="X">body</Modal>);
    expect(opened).toBe(closed);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `bun test src/components/ui/Modal.test.tsx`
Expected: FAIL — `Cannot find module './Modal'`.

- [ ] **Step 7: Write `Modal`**

Create `src/components/ui/Modal.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { syncDialogOpen } from './syncDialogOpen';

export type ModalSize = 'sm' | 'md' | 'lg';

/** `lg` is `max-w-2xl` because that is the width the two wide dialogs use. */
const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
};

/** The box chrome every dialog in the app shares; the guard test regexes for it. */
export const MODAL_BOX = 'modal-box bg-base-100 border border-base-300 shadow-2xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: ModalSize;
  /** Rules the header off from the body — MidiSettingsModal's `border-b pb-4`. */
  headerDivider?: boolean;
  /** Extra classes on `modal-box`; the dialogs differ only in their `space-y`. */
  boxClassName?: string;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  headerDivider = false,
  boxClassName,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);

  useEffect(() => {
    // Written before the sync so the `close` listener below can tell our own
    // close() apart from a user's Escape.
    openRef.current = open;
    syncDialogOpen(ref.current, open);
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Listen natively rather than through React's onClose: Escape, the backdrop
    // form and the header button all end in the same `close` event, which is
    // the single path the spec asks for and the one the platform's own focus
    // restoration already assumes. The openRef guard stops the close() we issue
    // ourselves (when the parent sets open=false) from calling back into the
    // parent a second time.
    const handleClose = () => {
      if (openRef.current) onClose();
    };
    el.addEventListener('close', handleClose);
    return () => el.removeEventListener('close', handleClose);
  }, [onClose]);

  return (
    <dialog ref={ref} className="modal">
      <div className={cx(MODAL_BOX, SIZE_CLASS[size], boxClassName)}>
        <div className={cx('flex items-center justify-between', headerDivider && 'border-b border-base-300 pb-4')}>
          <h3 className="font-bold text-lg flex items-center gap-2">{title}</h3>
          <IconButton label="Close" icon={<X className="w-4 h-4" />} onClick={onClose} />
        </div>
        {children}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `bun test src/components/ui/Modal.test.tsx`
Expected: `7 pass`.

- [ ] **Step 9: Move `MidiSettingsModal` onto `Modal`**

`src/components/ui/MidiSettingsModal.tsx`. The component already returns `null` when closed
(line 58), so it mounts only when open and passes `open`.

```diff
-  return (
-    <dialog className="modal modal-open">
-      <div className="modal-box max-w-2xl bg-base-100 border border-base-300 shadow-2xl space-y-6">
-        {/* Header */}
-        <div className="flex items-center justify-between border-b border-base-300 pb-4">
-          <div className="flex items-center gap-2">
-            <Sliders className="w-5 h-5 text-primary" />
-            <h3 className="text-lg font-bold">MIDI Controller & Mappings</h3>
-          </div>
-          <IconButton label="Close" icon={<X className="w-4 h-4" />} onClick={() => setIsOpen(false)} />
-        </div>
+  return (
+    <Modal
+      open
+      onClose={() => setIsOpen(false)}
+      size="lg"
+      headerDivider
+      boxClassName="space-y-6"
+      title={<><Sliders className="w-5 h-5 text-primary" />MIDI Controller &amp; Mappings</>}
+    >
```

and at the end of the component:

```diff
-      </div>
-      <form method="dialog" className="modal-backdrop">
-        <button onClick={() => setIsOpen(false)}>close</button>
-      </form>
-    </dialog>
-  );
+    </Modal>
+  );
```

Everything between stays. Add `import { Modal } from './Modal';`; delete the now-unused
`IconButton` import **only if** ESLint reports it unused (line 227's delete button still uses it,
so it stays). `X` is now unused in this file — remove it from the `lucide-react` import list.

- [ ] **Step 10: Move `PresetLibraryModal` onto `Modal`**

`src/components/ui/PresetLibrary.tsx:386`. The function already returns `null` unless
`showSave && save.variant === 'modal'`.

```diff
-  return (
-    <dialog className="modal modal-open">
-      <div className="modal-box max-w-sm bg-base-100 border border-primary/40 space-y-4">
-        <div className="flex items-center justify-between">
-          <h4 className="font-bold text-sm text-base-content flex items-center gap-2">
-            <Bookmark className="w-4 h-4 text-primary" />
-            {save.heading}
-          </h4>
-          <IconButton label="Close save form" icon={<X className="w-4 h-4" />} size="xs" className="btn-circle" onClick={() => setShowSave(false)} />
-        </div>
-
+  return (
+    <Modal
+      open
+      onClose={() => setShowSave(false)}
+      size="sm"
+      boxClassName="space-y-4"
+      title={<><Bookmark className="w-4 h-4 text-primary" />{save.heading}</>}
+    >
```

and at the end:

```diff
-      </div>
-      <form method="dialog" className="modal-backdrop">
-        <button type="button" onClick={() => setShowSave(false)}>close</button>
-      </form>
-    </dialog>
-  );
+    </Modal>
+  );
```

Add `import { Modal } from './Modal';`.

- [ ] **Step 11: Update the `PresetLibrary` heading assertion**

Run: `bun test src/components/ui/PresetLibrary.test.tsx`
Expected: FAIL if a test pins the old `font-bold text-sm` heading or the `border-primary/40` box.
Change each failing assertion to the new string that the failure output shows, and add a comment
above it recording why:

```ts
// Phase 2: the save modal shares ui/Modal's box and header, so the heading is
// the app's `font-bold text-lg` and the box is the standard chrome. This is one
// of the two deliberate visual convergences in that phase.
```

If nothing fails, leave the file untouched and say so in the commit body.

- [ ] **Step 12: Delete `ProjectDialogs`'s `Shell`**

`src/components/project/ProjectDialogs.tsx`. Replace lines 1–16:

```diff
 import React, { useEffect, useRef, useState } from 'react';
 import type { ProjectMeta } from '../../store/projectFormat';
+import { Modal } from '../ui/Modal';
 import { isValidProjectName } from './projectManagerFlow';
-
-/** Shared shell: a daisyUI modal stacked above the manager (MidiSettingsModal pattern). */
-const Shell: React.FC<{ title: string; onCancel: () => void; children: React.ReactNode }> = ({ title, onCancel, children }) => (
-  <dialog className="modal modal-open" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
-    <div className="modal-box max-w-md bg-base-100 border border-base-300 shadow-2xl space-y-4">
-      <h3 className="font-bold text-lg">{title}</h3>
-      {children}
-    </div>
-    <form method="dialog" className="modal-backdrop">
-      <button type="button" onClick={onCancel}>close</button>
-    </form>
-  </dialog>
-);
```

Then in each of the four dialogs, replace the wrapper element — the bodies do not change:

```diff
-    <Shell title={title} onCancel={onCancel}>
+    <Modal open onClose={onCancel} title={title} boxClassName="space-y-4">
       …
-    </Shell>
+    </Modal>
```

`NamePromptDialog` (line 37), `DirtyGuardDialog` (63), `DeleteConfirmDialog` (74),
`ImportConflictDialog` (90). `title` for the last three is the literal string that was passed to
`Shell`: `"Unsaved changes"`, `"Delete project"`, `"Import project"`.

Note: each of these gains a close `IconButton` in its header, which it did not have. That is the
primitive's contract and it is an improvement (a dialog with no visible close was reachable only
by Escape — which, before `showModal()`, did not work either).

- [ ] **Step 13: Move `ProjectManagerModal` onto `Modal`**

`src/components/project/ProjectManagerModal.tsx:145`:

```diff
-      <dialog className="modal modal-open" onCancel={(e) => { e.preventDefault(); close(); }}>
-        <div className="modal-box max-w-2xl bg-base-100 border border-base-300 shadow-2xl space-y-6">
-          <div className="flex items-center justify-between">
-            <h2 className="font-bold text-lg">Projects</h2>
-            <button type="button" className="btn btn-sm btn-ghost btn-square" aria-label="Close" onClick={close}><X className="w-4 h-4" /></button>
-          </div>
+      <Modal open onClose={close} size="lg" boxClassName="space-y-6" title="Projects">
```

and close the element where the `</div></dialog>` pair was, with `</Modal>`. Add
`import { Modal } from '../ui/Modal';`; drop `X` from the `lucide-react` import if ESLint reports
it unused.

The heading element changes from `<h2>` to `Modal`'s `<h3>`. That is a level change inside a
dialog whose accessible name now comes from the same text; no visual difference (both are
`font-bold text-lg`).

- [ ] **Step 14: Update `ProjectManagerModal.test.tsx`**

Lines 32 and 71 assert `'<dialog class="modal modal-open"'`. Both become:

```diff
-    expect(html).toContain('<dialog class="modal modal-open"');
+    // Phase 2: openness is a DOM property set by showModal(), never a class.
+    expect(html).toContain('<dialog class="modal"');
```

Run: `bun test src/components/project/`
Expected: all pass.

- [ ] **Step 15: Prove `modal-open` is gone from the tree**

Run: `grep -rn "modal-open" src`
Expected: no output at all. (`Modal.tsx`'s comment says "never renders `modal-open`" — if you
kept a comment containing the literal string, the spec allows exactly that one occurrence in
`ui/Modal.tsx`; nothing anywhere else.)

- [ ] **Step 16: Verify and commit**

Run: `bun run verify`
Expected: green, `0 errors`.

Manual check the spec's *Risks* table asks for, done once here: `bun run dev`, open the Projects
modal from the wordmark, make an edit so the session is dirty, then click a project to load it —
the dirty-guard dialog must stack **above** the manager, Escape must close the top one only, and
focus must not escape to the page behind. Nested `showModal()` is supported by the platform and
the later call sits on top.

```bash
git add src/components/ui/syncDialogOpen.ts src/components/ui/syncDialogOpen.test.ts src/components/ui/Modal.tsx src/components/ui/Modal.test.tsx src/components/ui/MidiSettingsModal.tsx src/components/ui/PresetLibrary.tsx src/components/ui/PresetLibrary.test.tsx src/components/project/ProjectDialogs.tsx src/components/project/ProjectManagerModal.tsx src/components/project/ProjectManagerModal.test.tsx
git commit -m "feat(ui): add Modal and move all four dialogs onto showModal()

The four <dialog className='modal modal-open'> sites never called
showModal(), so none had a focus trap, Escape, or a working onCancel.
Modal holds the ref, reconciles open through the pure syncDialogOpen
helper, and binds onClose to the native close event so Escape, the
backdrop and the header button share one path. ProjectDialogs' Shell is
deleted. The preset save modal converges on the standard box chrome and
the shared text-lg heading.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 4: `ConfirmDialog`, and the end of `confirm()` / `alert()`

Spec: `ConfirmDialog` is built on `Modal` with `title`, `message`, `confirmLabel`,
`danger?: boolean`, `onConfirm`, `onCancel`; it is lifted from `DeleteConfirmDialog`, which
becomes a thin call. It replaces the 4 `confirm()` calls; the 2 `alert()` calls become inline
`role="alert"` notices in the preset libraries.

**Files:**
- Create: `src/components/ui/ConfirmDialog.tsx`, `src/components/ui/ConfirmDialog.test.tsx`
- Modify: `src/components/project/ProjectDialogs.tsx` (`DeleteConfirmDialog`)
- Modify: `src/components/ui/PresetLibrary.tsx` (`toastTone` through three components)
- Modify: `src/components/loop/SynthPresetLibrary.tsx:153`, `:199`, `:439`
- Modify: `src/components/loop/ChordPresetLibrary.tsx:178`, `:244`, `:514`

**Interfaces:**
- Consumes: `Modal`, `ModalProps` (Task 3); `cx` (Task 1).
- Produces:
  - `ConfirmDialog(props: ConfirmDialogProps)` from `ui/ConfirmDialog.tsx`, where
    `ConfirmDialogProps = { title: string; message: ReactNode; confirmLabel: string;
    danger?: boolean; onConfirm: () => void; onCancel: () => void }`. There is **no `open` prop**:
    the dialog is mounted only when it should be shown, exactly like the four existing project
    dialogs, and it passes `open` to `Modal` itself.
  - `PresetLibraryProps` gains `toastTone?: 'success' | 'error'` (default `'success'`), threaded
    to `PresetLibraryHeader` and `PresetLibraryToolbar`.

- [ ] **Step 1: Write the failing test for `ConfirmDialog`**

Create `src/components/ui/ConfirmDialog.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ConfirmDialog } from './ConfirmDialog';

const noop = () => {};

describe('ConfirmDialog', () => {
  test('renders the title, the message and the confirm label', () => {
    const html = renderToString(
      <ConfirmDialog
        title="Delete preset"
        message="Are you sure?"
        confirmLabel="Delete"
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('<h3 class="font-bold text-lg flex items-center gap-2">Delete preset</h3>');
    expect(html).toContain('<p class="text-sm">Are you sure?</p>');
    expect(html).toContain('>Delete</button>');
  });

  test('is a Modal — never a modal-open div', () => {
    const html = renderToString(
      <ConfirmDialog title="T" message="M" confirmLabel="OK" onConfirm={noop} onCancel={noop} />,
    );
    expect(html).toContain('<dialog class="modal"');
    expect(html).not.toContain('modal-open');
  });

  test('danger paints the confirm button with the error role, not a colour', () => {
    const plain = renderToString(
      <ConfirmDialog title="T" message="M" confirmLabel="OK" onConfirm={noop} onCancel={noop} />,
    );
    const danger = renderToString(
      <ConfirmDialog title="T" message="M" confirmLabel="OK" danger onConfirm={noop} onCancel={noop} />,
    );
    expect(plain).toContain('class="btn btn-primary"');
    expect(danger).toContain('class="btn btn-error"');
  });

  /**
   * A dialog raised BY a destructive action must not open with the destructive
   * button focused, or a stray Enter deletes the thing. Cancel is the initial
   * focus target; jsx-a11y/no-autofocus is disabled on that line with the same
   * reason.
   */
  test('the cancel button is the autofocus target', () => {
    const html = renderToString(
      <ConfirmDialog title="T" message="M" confirmLabel="Delete" danger onConfirm={noop} onCancel={noop} />,
    );
    const cancel = html.slice(html.indexOf('modal-action'));
    expect(cancel.indexOf('autofocus')).toBeLessThan(cancel.indexOf('btn-error'));
  });

  test('a ReactNode message renders its markup', () => {
    const html = renderToString(
      <ConfirmDialog
        title="Delete project"
        message={<>Delete <strong>Demo</strong>? This cannot be undone.</>}
        confirmLabel="Delete"
        danger
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('<strong>Demo</strong>');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/components/ui/ConfirmDialog.test.tsx`
Expected: FAIL — `Cannot find module './ConfirmDialog'`.

- [ ] **Step 3: Write `ConfirmDialog`**

Create `src/components/ui/ConfirmDialog.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** Paints the confirm button with the error role — a destructive action. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The replacement for `confirm()`. The native dialog blocks the main thread —
 * which, in a workstation whose clock and scheduling live on it, means the
 * transport stalls while the user reads the question — and it cannot be
 * themed, so a delete prompt in a dark-themed app arrived as a white OS box.
 *
 * Mounted only while it should be shown, like the project dialogs it was
 * lifted from, so it passes `open` to Modal rather than exposing one.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open onClose={onCancel} title={title} boxClassName="space-y-4">
      <p className="text-sm">{message}</p>
      <div className="modal-action">
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- a dialog raised by a destructive action must open with Cancel focused, or a stray Enter confirms it. */}
        <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
        <button type="button" className={danger ? 'btn btn-error' : 'btn btn-primary'} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/components/ui/ConfirmDialog.test.tsx`
Expected: `5 pass`.

- [ ] **Step 5: Make `DeleteConfirmDialog` a thin call**

`src/components/project/ProjectDialogs.tsx` — replace the whole `DeleteConfirmDialog` (lines
73–81 on `main`, shifted by Task 3):

```diff
-export const DeleteConfirmDialog: React.FC<{ name: string; onConfirm: () => void; onCancel: () => void }> = ({ name, onConfirm, onCancel }) => (
-  <Modal open onClose={onCancel} title="Delete project" boxClassName="space-y-4">
-    <p className="text-sm">Delete <strong>{name}</strong>? This cannot be undone.</p>
-    <div className="modal-action">
-      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
-      <button type="button" className="btn btn-error" onClick={onConfirm}>Delete</button>
-    </div>
-  </Modal>
-);
+export const DeleteConfirmDialog: React.FC<{ name: string; onConfirm: () => void; onCancel: () => void }> = ({ name, onConfirm, onCancel }) => (
+  <ConfirmDialog
+    title="Delete project"
+    message={<>Delete <strong>{name}</strong>? This cannot be undone.</>}
+    confirmLabel="Delete"
+    danger
+    onConfirm={onConfirm}
+    onCancel={onCancel}
+  />
+);
```

Add `import { ConfirmDialog } from '../ui/ConfirmDialog';`. Keep `React.FC` here — Phase 3
converts the whole file.

Run: `bun test src/components/project/`
Expected: pass. If a project test pinned the delete dialog's `autoFocus` position, the markup is
byte-identical apart from that one `eslint-disable` comment (comments do not render), so nothing
should move.

- [ ] **Step 6: Add the error tone to `PresetLibrary`'s notice**

`src/components/ui/PresetLibrary.tsx`. Three edits, all additive:

1. In `PresetLibraryProps` (near line 54, beside `toast` / `toastPlacement`):

```ts
  /** `error` switches the notice to alert-error and role="alert" (an import that failed to parse). */
  toastTone?: 'success' | 'error';
```

2. In `PresetLibraryHeader`'s props (near line 166) and `PresetLibraryToolbar`'s (near line 236),
   add the same `toastTone?: 'success' | 'error';` line and pull it out of `props` in each
   destructuring (lines 169 and 239).

3. Replace both notice blocks (line 211 in the header, line 288 in the toolbar). Keep the class
   order exactly as shown so the success case renders the string
   `alert alert-success mx-4 mt-3 py-2 text-xs animate-fade-in` that `PresetLibrary.test.tsx:77`
   pins:

```diff
       {toastPlacement === 'top' && toast && (
-        <div className="alert alert-success mx-4 mt-3 py-2 text-xs animate-fade-in">
-          <Check className="w-3.5 h-3.5 shrink-0" />
+        <div
+          role={toastTone === 'error' ? 'alert' : 'status'}
+          className={cx('alert', toastTone === 'error' ? 'alert-error' : 'alert-success', 'mx-4 mt-3 py-2 text-xs animate-fade-in')}
+        >
+          {toastTone === 'error'
+            ? <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
+            : <Check className="w-3.5 h-3.5 shrink-0" />}
           <span>{toast}</span>
```

and the toolbar copy the same way, keeping its own `py-1.5 text-xs animate-fade-in` tail.

4. Thread `toastTone` from `PresetLibrary`'s destructuring (line 548) to both children (lines
   629–630 and 649–650), beside the existing `toast` / `toastPlacement` props.

Add `TriangleAlert` to the `lucide-react` import and `import { cx } from './cx';`.

- [ ] **Step 7: Replace the two `confirm()` calls and the `alert()` in `SynthPresetLibrary`**

`src/components/loop/SynthPresetLibrary.tsx`. Add the imports:

```ts
import { ConfirmDialog } from '../ui/ConfirmDialog';
```

Add the state beside `toastMsg` (line 57):

```ts
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');
```

Widen `showToast` (line 61) to carry the tone — read the existing body and add the parameter:

```ts
  const showToast = (msg: string, tone: 'success' | 'error' = 'success') => {
    setToastTone(tone);
    // …existing body unchanged (setToastMsg + the clearing timeout)…
  };
```

Line 153:

```diff
 const handleDelete = (id: string, name: string) => {
-    if (confirm(`Are you sure you want to delete preset "${name}"?`)) {
-      deletePreset(id);
-    }
+    setPendingDelete({ id, name });
   };
```

Line 199:

```diff
       } catch {
-        alert('Invalid JSON preset file');
+        showToast('Invalid JSON preset file', 'error');
       }
```

Line 439 (inside the `onDelete` prop):

```diff
       onDelete={(id) => {
         const entry = entries.find((en) => en.id === id);
-        if (entry && confirm(`Are you sure you want to delete preset "${entry.name}"?`)) {
-          deletePreset(id);
-        }
+        if (entry) setPendingDelete({ id, name: entry.name });
       }}
```

And the render — wrap the single `<PresetLibrary … />` return in a fragment, pass `toastTone`,
and mount the dialog beside it:

```diff
   return (
-    <PresetLibrary
-      …
-      onSave={handleSave}
-    />
+    <>
+      <PresetLibrary
+        …
+        toastTone={toastTone}
+        onSave={handleSave}
+      />
+      {pendingDelete && (
+        <ConfirmDialog
+          title="Delete preset"
+          message={<>Are you sure you want to delete preset <strong>{pendingDelete.name}</strong>?</>}
+          confirmLabel="Delete"
+          danger
+          onConfirm={() => {
+            deletePreset(pendingDelete.id);
+            setPendingDelete(null);
+          }}
+          onCancel={() => setPendingDelete(null)}
+        />
+      )}
+    </>
   );
```

- [ ] **Step 8: Do the same in `ChordPresetLibrary`**

`src/components/loop/ChordPresetLibrary.tsx`, identical shape with the progression wording:

- add `pendingDelete` / `toastTone` state and widen `showToast` the same way;
- line 178 `handleDeleteCustom` becomes `setPendingDelete({ id, name })`;
- line 244 `alert('Invalid JSON chord progression file')` becomes
  `showToast('Invalid JSON chord progression file', 'error')`;
- line 514 `onDelete` becomes `if (entry) setPendingDelete({ id, name: entry.name });`;
- wrap the return in a fragment, pass `toastTone`, and mount:

```tsx
      {pendingDelete && (
        <ConfirmDialog
          title="Delete progression"
          message={<>Delete custom progression <strong>{pendingDelete.name}</strong>?</>}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deleteProgression(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
```

- [ ] **Step 9: Prove the native prompts are gone**

Run: `grep -rnE "(^|[^.\w])(confirm|alert|prompt)\(" src --include='*.ts' --include='*.tsx'`
Expected: no output.

Run: `grep -rn "window\.\(confirm\|alert\|prompt\)" src`
Expected: no output.

Run: `bun run eslint 2>&1 | grep -c "Native prompts"`
Expected: `0` — the six `no-restricted-syntax` warnings from Phase 1 are gone. This is the
precondition Task 5 needs.

- [ ] **Step 10: Verify and commit**

Run: `bun run verify`
Expected: green, `0 errors`, warnings down by at least 6.

```bash
git add src/components/ui/ConfirmDialog.tsx src/components/ui/ConfirmDialog.test.tsx src/components/ui/PresetLibrary.tsx src/components/project/ProjectDialogs.tsx src/components/loop/SynthPresetLibrary.tsx src/components/loop/ChordPresetLibrary.tsx
git commit -m "feat(ui): add ConfirmDialog and delete the last native prompts

The four confirm() calls become a themed dialog that does not block the
main thread; the two alert() calls become the preset libraries' own
role=alert notice through a new toastTone prop. DeleteConfirmDialog is
now a thin call over the shared primitive.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 5: Move the confirm/alert/prompt ban to `error`

Spec, Phase 2: `no-restricted-syntax` holds three bans under one rule id, and ESLint has one
severity per rule id, so "confirm/alert to error while `React.FC` stays warn" is not expressible.
This task **moves** the ban out into `no-restricted-globals` (bare calls) and
`no-restricted-properties` (`window.confirm` etc.), both at `error`, and leaves
`no-restricted-syntax` at `warn` holding `React.FC` and `../../` only.

**Files:**
- Modify: `eslint.config.js:39-76` (delete two selectors) and `:32-38` (add two rules)

**Interfaces:**
- Consumes: nothing from earlier tasks except the precondition that Task 4 removed every call.
- Produces: `no-restricted-globals: 'error'` for `confirm`, `alert`, `prompt`;
  `no-restricted-properties: 'error'` for the same three on `window`. `no-restricted-syntax`
  keeps `warn` and five selectors (two `React.FC`, three `../../`).

**Why not `no-restricted-imports`.** Phase 1 already learned this: flat config replaces a rule's
options wholesale, and the three path-scoped `no-restricted-imports` blocks at the bottom of the
file erase any global copy for every file under `src/`. `no-restricted-globals` and
`no-restricted-properties` are not set by those blocks, so a single global entry reaches every
file — including `src/audio/`, `src/store/` and `src/components/`. Step 3 proves that.

- [ ] **Step 1: Delete the two selectors from `no-restricted-syntax`**

In `eslint.config.js`, remove lines 49–56 exactly:

```diff
-        {
-          selector: "CallExpression[callee.name=/^(confirm|alert|prompt)$/]",
-          message: 'Native prompts block the audio thread and cannot be styled — use a dialog component.',
-        },
-        {
-          selector: "CallExpression[callee.object.name='window'][callee.property.name=/^(confirm|alert|prompt)$/]",
-          message: 'Native prompts block the audio thread and cannot be styled — use a dialog component.',
-        },
```

The two `React.FC` selectors above and the three `../../` selectors below stay untouched, and
the rule stays `'warn'`.

- [ ] **Step 2: Add the two error-level rules**

In the same config object, after `'@typescript-eslint/consistent-type-definitions'` (line 38) and
before `'no-restricted-syntax'`:

```js
      // Phase 2 moved this ban out of no-restricted-syntax: one rule id has one
      // severity, and that rule still carries the React.FC and ../../ bans,
      // which stay `warn` until Phase 3. Splitting the confirm ban into the two
      // rules below is what makes it expressible at `error` on its own.
      //
      // Native prompts block the main thread — the transport's clock lives
      // there — and cannot be themed. Use ui/ConfirmDialog or ui/Modal.
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use ui/ConfirmDialog — confirm() blocks the main thread and cannot be themed.' },
        { name: 'alert', message: 'Use an inline role="alert" notice — alert() blocks the main thread and cannot be themed.' },
        { name: 'prompt', message: 'Use ui/Modal with a form — prompt() blocks the main thread and cannot be themed.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm', message: 'Use ui/ConfirmDialog — window.confirm blocks the main thread and cannot be themed.' },
        { object: 'window', property: 'alert', message: 'Use an inline role="alert" notice — window.alert blocks the main thread and cannot be themed.' },
        { object: 'window', property: 'prompt', message: 'Use ui/Modal with a form — window.prompt blocks the main thread and cannot be themed.' },
      ],
```

- [ ] **Step 3: Prove both new rules fire, in a path a layering block covers**

Phase 1 shipped two selectors that matched nothing. This probe is deliberately placed under
`src/components/`, which is one of the three paths whose layering block overrode
`no-restricted-imports` in Phase 1 — if the same shadowing hit these two rules, the probe stays
silent and the ban is fiction.

```bash
cat > src/components/lintProbe.tsx <<'PROBE'
export function LintProbe() {
  const a = confirm('bare confirm');
  const b = window.alert('member alert');
  const c = prompt('bare prompt');
  return <div>{String(a)}{String(b)}{String(c)}</div>;
}
PROBE
bun run eslint src/components/lintProbe.tsx 2>&1 | grep -oE "no-restricted-(globals|properties)" | sort | uniq -c
bun run eslint src/components/lintProbe.tsx 2>&1 | tail -2
rm src/components/lintProbe.tsx
```

Expected:
```
   2 no-restricted-globals
   1 no-restricted-properties
```
and a summary line reading `3 problems (3 errors, 0 warnings)` — **errors, not warnings**. If
either count is `0`, stop: the rule is not reaching this path and the config is wrong. If the
severity reads `warning`, the `'error'` string is in the wrong position in the array.

Run: `git status --short`
Expected: only `eslint.config.js` — confirm `src/components/lintProbe.tsx` is gone.

- [ ] **Step 4: Prove `no-restricted-syntax` still fires for what it kept**

```bash
cat > src/components/lintProbe2.tsx <<'PROBE'
import React from 'react';
import { clampBpm } from '../../src/utils/musicTheory';
interface Props { on: boolean }
export const Probe: React.FC<Props> = ({ on }) => <div>{on ? clampBpm(1) : 0}</div>;
PROBE
bun run eslint src/components/lintProbe2.tsx 2>&1 | grep -c "no-restricted-syntax"
bun run eslint src/components/lintProbe2.tsx 2>&1 | grep -c "error"
rm src/components/lintProbe2.tsx
```

Expected: `2` syntax hits (the `React.FC` type reference and the `../../` import) and `0` lines
containing "error" — both must still be **warnings**, because Phase 3 owns their flip.

Run: `git status --short`
Expected: only `eslint.config.js`.

- [ ] **Step 5: Verify and commit**

Run: `bun run verify`
Expected: green. `bun run eslint` reports `0 errors` — there are no `confirm`/`alert`/`prompt`
calls left for the new rules to catch, which is precisely why the flip is safe now.

```bash
git add eslint.config.js
git commit -m "chore(eslint): confirm/alert/prompt ban moves to error

One rule id has one severity, and no-restricted-syntax still carries the
React.FC and ../../ bans that Phase 3 owns. Splitting the prompt ban into
no-restricted-globals (bare calls) and no-restricted-properties (window.*)
is what makes error-level enforcement expressible now.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 6: `ModuleHeader` — the card header row and its title

Spec contract: `badge?`, `icon?`, `title`, `right?: ReactNode`; renders the
`flex items-center justify-between border-b border-base-300 pb-2` row with the
`text-xs font-bold … gap-1.5` title. Measured: **10** header rows and **10** title spans.

**Files:**
- Create: `src/components/ui/ModuleHeader.tsx`, `src/components/ui/ModuleHeader.test.tsx`
- Modify: `src/components/song/EffectsRackView.tsx:45-46`, `:101-102`, `:157-158`, `:201-202`
- Modify: `src/components/loop/synth/ArpeggiatorPanel.tsx:21-22`,
  `FilterPanel.tsx:21-22`, `LfoPanel.tsx:21-22`, `EnvelopePanel.tsx:23-24`,
  `OscillatorPanel.tsx:21-22`
- Modify: `src/components/loop/ChordView.tsx:632`
- Modify: `src/components/ui/PresetLibrary.tsx:311-320`

**Interfaces:**
- Consumes: `cx` (Task 1), `STEP_BADGE` from `ui/fieldClasses.ts`.
- Produces: `ModuleHeader(props: ModuleHeaderProps)` plus the two exported class constants
  `MODULE_HEADER_ROW = 'flex items-center justify-between border-b border-base-300 pb-2'` and
  `MODULE_TITLE = 'text-xs font-bold text-base-content flex items-center gap-1.5'` — Task 9's
  guard imports both.
  `ModuleHeaderProps = { title?: ReactNode; badge?: ReactNode; icon?: ReactNode;
  right?: ReactNode; children?: ReactNode; className?: string; divider?: boolean }`.

**Two extensions to the spec's contract, with reasons.** `divider` (default `true`) exists
because `PresetLibrary.tsx:311` is the tenth title span and it sits in a row with **no**
`border-b` — its parent form already draws one. `children` exists because `ChordView.tsx:632`
is the tenth header row and its left cell is a section header plus two badges, not the canonical
title span; passing it as `title` would wrap it in the canonical span and move the badges. Left
cell = `title` when given, `children` otherwise.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/ModuleHeader.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Waves } from 'lucide-react';
import { ModuleHeader } from './ModuleHeader';

describe('ModuleHeader', () => {
  test('renders the row and the canonical title as one class string each', () => {
    const html = renderToString(<ModuleHeader title="Space Reverb" />);
    expect(html).toContain('class="flex items-center justify-between border-b border-base-300 pb-2"');
    expect(html).toContain('class="text-xs font-bold text-base-content flex items-center gap-1.5"');
    expect(html).toContain('Space Reverb');
  });

  test('badge and icon sit inside the title span, badge first', () => {
    const html = renderToString(
      <ModuleHeader badge={1} icon={<Waves className="w-3.5 h-3.5 text-accent" />} title="Space Reverb" />,
    );
    expect(html).toContain('class="badge badge-sm badge-outline tabular-nums">1</span>');
    expect(html.indexOf('badge-outline')).toBeLessThan(html.indexOf('lucide-waves'));
  });

  test('right is the row’s second cell', () => {
    const html = renderToString(<ModuleHeader title="Reverb" right={<button type="button">Bypass</button>} />);
    expect(html).toContain('<button type="button">Bypass</button>');
  });

  /** PresetLibrary's inline save header: the parent form already draws the rule. */
  test('divider={false} drops the border and the padding', () => {
    const html = renderToString(<ModuleHeader divider={false} title="Save" />);
    expect(html).toContain('class="flex items-center justify-between"');
    expect(html).not.toContain('border-b border-base-300 pb-2');
  });

  /** ChordView's left cell is a section header plus badges, not the canonical title. */
  test('children replace the title span entirely', () => {
    const html = renderToString(
      <ModuleHeader className="flex-wrap gap-2">
        <div className="flex items-center gap-2">custom</div>
      </ModuleHeader>,
    );
    expect(html).toContain('class="flex items-center justify-between border-b border-base-300 pb-2 flex-wrap gap-2"');
    expect(html).not.toContain('text-xs font-bold text-base-content flex items-center gap-1.5');
    expect(html).toContain('custom');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/components/ui/ModuleHeader.test.tsx`
Expected: FAIL — `Cannot find module './ModuleHeader'`.

- [ ] **Step 3: Write `ModuleHeader`**

Create `src/components/ui/ModuleHeader.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cx } from './cx';
import { STEP_BADGE } from './fieldClasses';

/** The header row ten cards spelled out by hand. `fieldClasses.test.ts` guards it. */
export const MODULE_HEADER_ROW = 'flex items-center justify-between border-b border-base-300 pb-2';

/** The title inside that row — ten hand-written copies. Guarded in the same sweep. */
export const MODULE_TITLE = 'text-xs font-bold text-base-content flex items-center gap-1.5';

export interface ModuleHeaderProps {
  /** The canonical title. Omit it and pass `children` when the left cell is bespoke. */
  title?: ReactNode;
  /** The ordinal chip a numbered module carries (the synth's five stages, the rack's four units). */
  badge?: ReactNode;
  icon?: ReactNode;
  /** The row's second cell — a bypass toggle, a close button. */
  right?: ReactNode;
  /** Used instead of `title` when the left cell is not the canonical title span. */
  children?: ReactNode;
  className?: string;
  /**
   * False where the parent already draws the rule (PresetLibrary's inline save
   * form): the row keeps its layout and drops `border-b … pb-2`.
   */
  divider?: boolean;
}

export function ModuleHeader({
  title,
  badge,
  icon,
  right,
  children,
  className,
  divider = true,
}: ModuleHeaderProps) {
  return (
    <div className={cx(divider ? MODULE_HEADER_ROW : 'flex items-center justify-between', className)}>
      {title === undefined ? (
        children
      ) : (
        <span className={MODULE_TITLE}>
          {badge !== undefined && <span className={STEP_BADGE}>{badge}</span>}
          {icon}
          {title}
        </span>
      )}
      {right}
    </div>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/components/ui/ModuleHeader.test.tsx`
Expected: `5 pass`.

- [ ] **Step 5: Convert the four `EffectsRackView` headers**

`src/components/song/EffectsRackView.tsx` — add
`import { ModuleHeader } from '../ui/ModuleHeader';`. Each of the four blocks (45, 101, 157, 201)
has the same shape; the reverb one written out in full:

```diff
-              <div className="flex items-center justify-between border-b border-base-300 pb-2">
-                <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
-                  <span className={STEP_BADGE}>1</span>
-                  <Waves className="w-3.5 h-3.5 text-accent" />
-                  Space Reverb
-                </span>
-                <PowerToggle
-                  id="btn-bypass-reverb"
-                  on={!effects.reverbBypass}
-                  onToggle={() => updateFx({ reverbBypass: !effects.reverbBypass })}
-                  name="Reverb"
-                  tone="accent"
-                  size="xs"
-                  iconOnly
-                />
-              </div>
+              <ModuleHeader
+                badge={1}
+                icon={<Waves className="w-3.5 h-3.5 text-accent" />}
+                title="Space Reverb"
+                right={
+                  <PowerToggle
+                    id="btn-bypass-reverb"
+                    on={!effects.reverbBypass}
+                    onToggle={() => updateFx({ reverbBypass: !effects.reverbBypass })}
+                    name="Reverb"
+                    tone="accent"
+                    size="xs"
+                    iconOnly
+                  />
+                }
+              />
```

Do the same for the three below it, copying each block's own badge number, icon element, title
text and `PowerToggle` props verbatim. If `STEP_BADGE` ends up unused in this file, remove it
from the `./fieldClasses` import.

- [ ] **Step 6: Convert the five Pro-Mode synth panel headers**

`ArpeggiatorPanel.tsx:21`, `FilterPanel.tsx:21`, `LfoPanel.tsx:21`, `EnvelopePanel.tsx:23`,
`OscillatorPanel.tsx:21` — same substitution, with each panel's own badge, icon and title, and
`right=` receiving the panel's existing second cell (`ArpeggiatorPanel` has the arp toggle
button; the others may have nothing, in which case omit `right`). Add
`import { ModuleHeader } from '../../ui/ModuleHeader';` to each — two `../`, which the `../../`
ban's selector matches on the **source string**, so write it as `'../../ui/ModuleHeader'` and
accept the `no-restricted-syntax` warning it adds. Phase 3 rewrites every one of these to `@/ui`.
Count the added warnings in the commit body.

Run: `bun test src/components/loop/synth/synthPanels.test.tsx`
Expected: pass — those tests assert ids and identity tokens, not the header string.

- [ ] **Step 7: Convert `ChordView`'s header row (the `children` form)**

`src/components/loop/ChordView.tsx:632`:

```diff
-        <div className="flex items-center justify-between border-b border-base-300 pb-2 flex-wrap gap-2">
-          <div className="flex items-center gap-2">
+        <ModuleHeader className="flex-wrap gap-2" right={<>{/* the existing right-hand cell, moved verbatim */}</>}>
+          <div className="flex items-center gap-2">
             …unchanged…
           </div>
-          …existing right-hand cell…
-        </div>
+        </ModuleHeader>
```

Read the current block before editing: whatever sits after the closing `</div>` of the left cell
and before the row's own `</div>` is the right-hand cell and moves into `right=` unchanged. If
there is nothing there, omit `right` and the row renders with one child, which is what it does
today.

Add `import { ModuleHeader } from '../ui/ModuleHeader';`.

Run: `bun test src/components/loop/ChordView.test.tsx`
Expected: pass.

- [ ] **Step 8: Convert `PresetLibrary`'s inline save header (the `divider={false}` form)**

`src/components/ui/PresetLibrary.tsx:311`:

```diff
-      <div className="flex items-center justify-between">
-        <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
-          <Bookmark className="w-3.5 h-3.5 text-primary" />
-          {save.heading}
-        </span>
-        <IconButton label="Close save form" icon={<X className="w-3.5 h-3.5" />} size="xs" className="btn-circle" onClick={() => setShowSave(false)} />
-      </div>
+      <ModuleHeader
+        divider={false}
+        icon={<Bookmark className="w-3.5 h-3.5 text-primary" />}
+        title={save.heading}
+        right={
+          <IconButton
+            label="Close save form"
+            icon={<X className="w-3.5 h-3.5" />}
+            size="xs"
+            className="btn-circle"
+            onClick={() => setShowSave(false)}
+          />
+        }
+      />
```

Add `import { ModuleHeader } from './ModuleHeader';`.

- [ ] **Step 9: Confirm every copy is gone**

Run: `grep -rn "flex items-center justify-between border-b border-base-300 pb-2" src --include='*.tsx' | grep -v ModuleHeader.tsx`
Expected: no output.

Run: `grep -rn "text-xs font-bold text-base-content flex items-center gap-1.5" src --include='*.tsx' | grep -v ModuleHeader.tsx`
Expected: no output.

- [ ] **Step 10: Verify and commit**

Run: `bun run verify`
Expected: green, `0 errors`. Warnings rise by the five `../../` imports added in Step 6 — record
the new total.

```bash
git add src/components/ui/ModuleHeader.tsx src/components/ui/ModuleHeader.test.tsx src/components/song/EffectsRackView.tsx src/components/loop/synth/ArpeggiatorPanel.tsx src/components/loop/synth/FilterPanel.tsx src/components/loop/synth/LfoPanel.tsx src/components/loop/synth/EnvelopePanel.tsx src/components/loop/synth/OscillatorPanel.tsx src/components/loop/ChordView.tsx src/components/ui/PresetLibrary.tsx
git commit -m "feat(ui): add ModuleHeader and take the ten header rows onto it

Ten copies of the header row and ten of its title span had one home
between them. divider=false serves the inline save form whose parent
already draws the rule; children serve ChordView's bespoke left cell.

bun run eslint: 0 errors, <N> warnings.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 7: `PanelCard` — the panel shell

Spec contract: `tint?`, `children`, `className?`; renders
`card bg-panel border border-base-300 shadow-md` plus the module tint class. Measured: **16**
sites, not 4.

**Files:**
- Create: `src/components/ui/PanelCard.tsx`, `src/components/ui/PanelCard.test.tsx`
- Modify: `src/components/ui/ViewHeader.tsx:28`
- Modify: `src/components/song/EffectsRackView.tsx:270`
- Modify: `src/components/loop/DrumPads.tsx:16`
- Modify: `src/components/loop/SynthView.tsx:348`
- Modify: `src/components/loop/SequencerView.tsx:152`, `:251`
- Modify: `src/components/loop/SimpleSynthPanel.tsx:56`, `:81`, `:112`, `:143`
- Modify: `src/components/loop/synth/{Oscillator,Filter,Envelope,Lfo,Arpeggiator}Panel.tsx` (the
  card wrapper on lines 18/18/20/18/18)
- Modify: `src/components/loop/synth/synthPanels.test.tsx:31`, `:95`

**Interfaces:**
- Consumes: `cx` (Task 1).
- Produces: `PanelCard(props: PanelCardProps)` and
  `const PANEL_CARD = 'card bg-panel border border-base-300 shadow-md'` (Task 9's guard imports
  it). `PanelCardProps = { tint?: string; className?: string; children: ReactNode }`.

**Contract deviation, with the reason.** The spec writes `tint?: ModuleTint`. There is no
`ModuleTint` type in the tree, and what the call sites actually pass is `tintClass` — a computed
**string** of two classes (`SYNTH_TARGET_STYLES[target].ring` + `.tint`, joined; see
`loop/synth/useSynthChannel.ts:36` and `loop/SynthView.tsx:141`). A closed union cannot express
that pair, and inventing one would force `ui/PanelCard.tsx` to import `utils/synthControl`. So
`tint?: string`, documented as "the computed tint class from `SYNTH_TARGET_STYLES`".

**Class order changes on five sites.** The five Pro-Mode panels render
`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}` today; through `PanelCard`
they render `card bg-panel border border-base-300 shadow-md ${tint} flex-1`. Tailwind utilities
are order-independent in the attribute (the stylesheet decides), and `flex-1` conflicts with
nothing here, so this is not a visual change — but `synthPanels.test.tsx` pins the old order and
is updated in Step 6.

**Sites deliberately not converted** (their shell is a different composition, not a copy):
`EffectsRackView.tsx:38,94,150,194` (conditional border/ring, no `border-base-300`),
`ChordView.tsx:631` (`tint-chord border-module-chord/30 p-4 shadow-xl`),
`SimpleSynthPanel.tsx:175` (`border-module-arp/30` + col-span),
`LeadMelodyGrid.tsx:239` (`shadow-xl`), `chord/BassModulePanel.tsx:56` (`tint-bass … p-4`),
`chord/SortableChordCard.tsx:74` (no `bg-panel` shadow, conditional border). List them in the
commit body so the next reader does not think they were missed.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/PanelCard.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { PanelCard } from './PanelCard';

describe('PanelCard', () => {
  test('renders the shell as one class string', () => {
    const html = renderToString(<PanelCard>body</PanelCard>);
    expect(html).toContain('<div class="card bg-panel border border-base-300 shadow-md">body</div>');
  });

  test('tint follows the shell', () => {
    const html = renderToString(<PanelCard tint="ring-1 ring-module-chord/40 tint-chord">body</PanelCard>);
    expect(html).toContain('class="card bg-panel border border-base-300 shadow-md ring-1 ring-module-chord/40 tint-chord"');
  });

  test('className follows the tint', () => {
    const html = renderToString(<PanelCard tint="tint-bass" className="flex-1">body</PanelCard>);
    expect(html).toContain('class="card bg-panel border border-base-300 shadow-md tint-bass flex-1"');
  });

  /**
   * An absent tint must not leave the double space that template interpolation
   * produced — every call-site test asserts on a literal class string.
   */
  test('an absent tint leaves no gap in the attribute', () => {
    const html = renderToString(<PanelCard className="relative">body</PanelCard>);
    expect(html).toContain('class="card bg-panel border border-base-300 shadow-md relative"');
    expect(html).not.toContain('  ');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/components/ui/PanelCard.test.tsx`
Expected: FAIL — `Cannot find module './PanelCard'`.

- [ ] **Step 3: Write `PanelCard`**

Create `src/components/ui/PanelCard.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cx } from './cx';

/** The panel shell sixteen cards spelled out by hand. `fieldClasses.test.ts` guards it. */
export const PANEL_CARD = 'card bg-panel border border-base-300 shadow-md';

export interface PanelCardProps {
  /**
   * The module tint — the computed `ring` + `tint` pair from
   * `SYNTH_TARGET_STYLES` that `useSynthChannel()` returns as `tintClass`.
   * A string rather than a union: the value is two classes joined at runtime,
   * and typing it as a token would make this primitive import `utils/`.
   */
  tint?: string;
  className?: string;
  children: ReactNode;
}

export function PanelCard({ tint, className, children }: PanelCardProps) {
  return <div className={cx(PANEL_CARD, tint, className)}>{children}</div>;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/components/ui/PanelCard.test.tsx`
Expected: `4 pass`.

- [ ] **Step 5: Convert the sixteen sites**

Each import path is relative to the file: `./PanelCard` inside `ui/`, `../ui/PanelCard` from
`loop/` and `song/`, `'../../ui/PanelCard'` from `loop/synth/`.

| File:line | Replacement opening tag | Closing |
| --- | --- | --- |
| `ui/ViewHeader.tsx:28` | `<PanelCard className="relative">` | `</PanelCard>` |
| `song/EffectsRackView.tsx:270` | `<PanelCard>` | `</PanelCard>` |
| `loop/DrumPads.tsx:16` | `<PanelCard>` | `</PanelCard>` |
| `loop/SynthView.tsx:348` | `<PanelCard tint={tintClass}>` | `</PanelCard>` |
| `loop/SequencerView.tsx:152` | `<PanelCard>` | `</PanelCard>` |
| `loop/SequencerView.tsx:251` | `<PanelCard>` | `</PanelCard>` |
| `loop/SimpleSynthPanel.tsx:56`, `:81`, `:112`, `:143` | `<PanelCard tint={tintClass}>` | `</PanelCard>` |
| `loop/synth/OscillatorPanel.tsx:18` | `<PanelCard tint={tintClass} className="flex-1">` | `</PanelCard>` |
| `loop/synth/FilterPanel.tsx:18` | same | `</PanelCard>` |
| `loop/synth/EnvelopePanel.tsx:20` | same | `</PanelCard>` |
| `loop/synth/LfoPanel.tsx:18` | same | `</PanelCard>` |
| `loop/synth/ArpeggiatorPanel.tsx:18` | same | `</PanelCard>` |

In every case the element's **children are untouched** — only the opening `<div className=…>`
and its matching `</div>` change. Match the right `</div>`: it is the one immediately after the
card body's closing tag, at the same indentation as the opening.

- [ ] **Step 6: Update the two `synthPanels` assertions**

`src/components/loop/synth/synthPanels.test.tsx`:

```diff
-    expect(html).toContain('card flex-1 bg-panel border border-base-300 shadow-md');
+    // Phase 2: ui/PanelCard renders the shell first and the caller's extras
+    // last, so `flex-1` moved to the end. Tailwind utilities are
+    // order-independent in the attribute; nothing renders differently.
+    expect(html).toContain('card bg-panel border border-base-300 shadow-md');
```

```diff
-      expect(html.split('card flex-1 bg-panel').length - 1).toBe(1);
+      expect(html.split('card bg-panel border border-base-300 shadow-md').length - 1).toBe(1);
```

Run: `bun test src/components/loop/synth/synthPanels.test.tsx`
Expected: pass, including the "exactly one card wrapper" test.

- [ ] **Step 7: Run every test that pins a card class string**

Run: `bun test src/components/loop/ChordView.test.tsx src/components/loop/DrumPads.test.tsx src/components/loop/SimpleSynthPanel.test.tsx src/components/loop/SequencerView.test.tsx src/components/song/EffectsRackView.test.tsx src/components/loop/chord/SortableChordCard.test.tsx src/components/loop/chord/modulePanels.test.tsx`
Expected: all pass. `SimpleSynthPanel.test.tsx:75` counts five `card bg-panel` matches and
asserts each carries `tint-chord`: four now come from `PanelCard` (tint appended) and the fifth
from the untouched arp card at line 175, so the count and the tint both hold. If it fails,
`tintClass` was dropped from one of the four conversions.

- [ ] **Step 8: Confirm every copy is gone**

Run: `grep -rn "card bg-panel border border-base-300 shadow-md\|card flex-1 bg-panel" src --include='*.tsx' | grep -v PanelCard.tsx | grep -v '\.test\.'`
Expected: no output.

- [ ] **Step 9: Verify and commit**

Run: `bun run verify`
Expected: green, `0 errors`.

```bash
git add src/components/ui/PanelCard.tsx src/components/ui/PanelCard.test.tsx src/components/ui/ViewHeader.tsx src/components/song/EffectsRackView.tsx src/components/loop/DrumPads.tsx src/components/loop/SynthView.tsx src/components/loop/SequencerView.tsx src/components/loop/SimpleSynthPanel.tsx src/components/loop/synth/OscillatorPanel.tsx src/components/loop/synth/FilterPanel.tsx src/components/loop/synth/EnvelopePanel.tsx src/components/loop/synth/LfoPanel.tsx src/components/loop/synth/ArpeggiatorPanel.tsx src/components/loop/synth/synthPanels.test.tsx
git commit -m "feat(ui): add PanelCard and take the sixteen panel shells onto it

tint is the computed SYNTH_TARGET_STYLES string, not a token union — the
value is a ring class and a tint class joined at runtime, and a union
would make ui/ import utils/. Six shells with a different composition
(EffectsRackView's bypass-conditional border, ChordView's tinted card,
SimpleSynthPanel's arp card, LeadMelodyGrid, BassModulePanel,
SortableChordCard) are deliberately left alone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 8: `QuickSavePopover` — close on Escape, give focus back

Spec, Phase 2: "`ui/QuickSavePopover.tsx`: close on Escape, return focus to the trigger on
close." Today the popover has neither: it is a `card` div (not a `<dialog>`), so it gets nothing
from the platform, and its `autoFocus` steals focus from the button that opened it and never
gives it back — the user is dropped at the top of the document.

**Files:**
- Modify: `src/components/ui/QuickSavePopover.tsx:1-43` (imports, hooks) and `:50-59` (the input)
- Modify: `src/components/ui/QuickSavePopover.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isDismissKey(e: Pick<KeyboardEvent, 'key'>): boolean` exported from
  `ui/QuickSavePopover.tsx` — the pure part, testable without a DOM. `QuickSavePopoverProps` is
  unchanged; no caller changes.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/ui/QuickSavePopover.test.tsx` (keep the existing tests):

```tsx
import { isDismissKey } from './QuickSavePopover';

describe('QuickSavePopover dismissal', () => {
  test('Escape dismisses; nothing else does', () => {
    expect(isDismissKey({ key: 'Escape' })).toBe(true);
    expect(isDismissKey({ key: 'Enter' })).toBe(false);
    expect(isDismissKey({ key: 'Esc' })).toBe(false);   // the IE spelling is not a browser we ship to
    expect(isDismissKey({ key: 'a' })).toBe(false);
  });

  /**
   * autoFocus is replaced by an effect that records the trigger first, so the
   * popover can hand focus back when it closes. The attribute must be gone from
   * the markup or React focuses the input before the effect can look at
   * document.activeElement.
   */
  test('the name input no longer carries autoFocus', () => {
    const html = renderToString(
      <QuickSavePopover
        open
        onClose={() => {}}
        heading="Save"
        placeholder="Name"
        saveLabel="Save"
        name=""
        onNameChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(html).not.toContain('autofocus');
    expect(html).toContain('class="input input-sm flex-1"');
  });
});
```

If the existing file does not already import `renderToString` and `QuickSavePopover`, add them at
the top rather than duplicating the imports inside the new `describe`.

- [ ] **Step 2: Run and watch it fail**

Run: `bun test src/components/ui/QuickSavePopover.test.tsx`
Expected: FAIL — `isDismissKey` is not exported, and `autofocus` is present in the markup.

- [ ] **Step 3: Rewrite the component's head**

`src/components/ui/QuickSavePopover.tsx`. Replace line 1 and the component's opening:

```diff
-import React from "react";
+import React, { useEffect, useRef } from "react";
 import { Bookmark } from "lucide-react";
```

Add above the component:

```tsx
/**
 * Escape dismisses the popover. Exported because the key rule is the only part
 * of the dismissal that can be tested here — this runner has no DOM, so the
 * listener that calls it cannot be exercised.
 */
export function isDismissKey(e: Pick<KeyboardEvent, 'key'>): boolean {
  return e.key === 'Escape';
}
```

Replace the body between the destructuring and `if (!open) return null;`:

```tsx
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Recorded before focus moves. The popover is a plain card, not a
    // <dialog>, so the platform does nothing for it: without this the user is
    // dropped at the top of the document when the popover closes, several tab
    // stops away from the button they opened it with.
    triggerRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isDismissKey(e)) return;
      // The popover overlays a page full of shortcut-bound keys; stopping here
      // keeps Escape from also reaching a transport or keyboard handler.
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
```

Both hooks sit **above** the `if (!open) return null` early return — a hook after a conditional
return is what `react-hooks/rules-of-hooks` (error since Phase 1) exists to catch.

- [ ] **Step 4: Take `autoFocus` off the input and give it the ref**

```diff
         <input
+          ref={inputRef}
           type="text"
           required
-          autoFocus
           placeholder={placeholder}
```

- [ ] **Step 5: Run and watch it pass**

Run: `bun test src/components/ui/QuickSavePopover.test.tsx`
Expected: all pass, including the pre-existing tests.

Run: `bun run eslint src/components/ui/QuickSavePopover.tsx`
Expected: no `jsx-a11y/no-autofocus` warning for this file any more, and no
`react-hooks/exhaustive-deps` warning (both effects list every value they read).

- [ ] **Step 6: Verify and commit**

Run: `bun run verify`
Expected: green. The `jsx-a11y` warning total drops by one (from 41 to 40).

Manual check: `bun run dev`, open the synth quick-save from the Save button, press Escape — the
popover closes and the Save button is focused again (press Enter to confirm it reopens).

```bash
git add src/components/ui/QuickSavePopover.tsx src/components/ui/QuickSavePopover.test.tsx
git commit -m "fix(ui): QuickSavePopover closes on Escape and returns focus

It is a card, not a <dialog>, so it got neither from the platform, and
its autoFocus dropped the user at the top of the document on close. The
focus target is now taken before focus moves and restored on unmount.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 9: Extend the class-drift guard, and fix the ten leaks

Spec, Phase 2: extend `ui/fieldClasses.test.ts` to regex over `src/` for hand-written
`FIELD_LABEL` and `SECTION_HEADER` lookalikes and fix the leaks. Spec, *Risks*: the same sweep is
extended to `ModuleHeader`'s and `PanelCard`'s strings so a hand-written copy fails `verify`.

The measured leaks are **10, in 5 files** — not the 4 the spec recorded. Two shapes:

| Leak string | Sites |
| --- | --- |
| `text-[11px] text-base-content/60 block mb-1` | `ui/PresetLibrary.tsx:400`, `:413`, `:428`, `:441`; `loop/synth/ArpeggiatorPanel.tsx:70`, `:92` |
| `text-xs text-base-content/60 block mb-1.5 font-medium` | `loop/synth/ArpeggiatorPanel.tsx:47`; `loop/synth/FilterPanel.tsx:30`; `loop/synth/LfoPanel.tsx:30`; `loop/synth/OscillatorPanel.tsx:30` |

`FIELD_LABEL` is `text-[10px] text-base-content/60 block mb-1`, so the leaks are the same role at
three different sizes and two different margins — exactly the drift the token exists to end.
Converging them makes those labels one pixel smaller and drops `font-medium`: **an intended
visual change**, the third and last in this phase.

Six of the ten (`ArpeggiatorPanel` ×3, `Filter`/`Lfo`/`Oscillator` ×1 each) label a *group of
buttons*, not a control, so they also become `<span>` inside a `role="group"` container — which
clears six of the `jsx-a11y/label-has-associated-control` warnings Task 10 must drive to zero.

**Files:**
- Modify: `src/components/ui/fieldClasses.test.ts`
- Modify: `src/components/loop/synth/ArpeggiatorPanel.tsx:47`, `:70`, `:92`
- Modify: `src/components/loop/synth/FilterPanel.tsx:30`
- Modify: `src/components/loop/synth/LfoPanel.tsx:30`
- Modify: `src/components/loop/synth/OscillatorPanel.tsx:30`
- Modify: `src/components/ui/PresetLibrary.tsx:400`, `:413`, `:428`, `:441`

**Interfaces:**
- Consumes: `FIELD_LABEL`, `SECTION_HEADER` from `ui/fieldClasses.ts`; `PANEL_CARD` (Task 7),
  `MODULE_HEADER_ROW` and `MODULE_TITLE` (Task 6).
- Produces: four new tests in `fieldClasses.test.ts`. No source API changes.

- [ ] **Step 1: Add the four failing guard tests**

Append inside the existing `describe('field label token', …)` in
`src/components/ui/fieldClasses.test.ts`, and extend its import line:

```ts
import { MODULE_HEADER_ROW, MODULE_TITLE } from './ModuleHeader';
import { PANEL_CARD } from './PanelCard';
```

```ts
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
      .filter((f) => lookalike.test(readFileSync(f, 'utf8').replace(SECTION_HEADER, '')));
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
```

Note the existing helper is `sourceFiles('src/components')`; these four widen it to `'src'`
because Phase 3 moves this folder. `sourceFiles` already skips `.test.ts(x)`.

- [ ] **Step 2: Run and read the failure as the work list**

Run: `bun test src/components/ui/fieldClasses.test.ts`
Expected: the first new test FAILS listing exactly these five files:
`src/components/loop/synth/ArpeggiatorPanel.tsx`, `FilterPanel.tsx`, `LfoPanel.tsx`,
`OscillatorPanel.tsx`, `src/components/ui/PresetLibrary.tsx`. The other three must PASS — if the
header/card/section tests fail, Tasks 6 and 7 left a copy behind; fix that there, not here.

- [ ] **Step 3: Fix the six group labels in the synth panels**

`ArpeggiatorPanel.tsx:47` (and the identical shape at `FilterPanel.tsx:30`,
`LfoPanel.tsx:30`, `OscillatorPanel.tsx:30`):

```diff
             <div>
-              <label className="text-xs text-base-content/60 block mb-1.5 font-medium">
-                Arp Mode
-              </label>
-              <div className="grid grid-cols-4 gap-1">
+              <span className={FIELD_LABEL} id="label-arp-mode">Arp Mode</span>
+              <div className="grid grid-cols-4 gap-1" role="group" aria-labelledby="label-arp-mode">
```

`ArpeggiatorPanel.tsx:70` and `:92` are the same with `Rate` / `Octaves`, their own ids
(`label-arp-rate`, `label-arp-octaves`) and their own `<div className="flex gap-1">` containers.

For the other three panels use the ids `label-filter-type`, `label-lfo-target`,
`label-osc-wave` and read each panel's own label text and container `className` from the source.

`<label>` → `<span>` because these label a *set* of buttons, not one control: `htmlFor` has
nothing to point at, and `role="group"` + `aria-labelledby` is what names a group. Add
`FIELD_LABEL` to each file's `./fieldClasses` / `../../ui/fieldClasses` import (the panels import
`STEP_BADGE` from there already).

- [ ] **Step 4: Fix the four `PresetLibrary` labels**

`ui/PresetLibrary.tsx:400`, `:413`, `:428`, `:441` are real labels for real controls, so they stay
`<label>` and gain the token plus an association. The inputs have no ids; mint them from
`useId()` so two mounted libraries cannot collide:

At the top of `PresetLibraryModal` (line 382, after the destructuring):

```ts
  const uid = useId();
```

Then, for each of the four:

```diff
           <div>
-            <label className="text-[11px] text-base-content/60 block mb-1">Progression Name</label>
+            <label className={FIELD_LABEL} htmlFor={`${uid}-name`}>Progression Name</label>
             <input
+              id={`${uid}-name`}
               type="text"
```

Suffixes: `-name`, `-category`, `-roman`, `-description`, matching the four fields in order. Add
`useId` to the `react` import and `FIELD_LABEL` to the `./fieldClasses` import.

- [ ] **Step 5: Run the guard and the touched tests**

Run: `bun test src/components/ui/fieldClasses.test.ts`
Expected: all tests pass, new ones included.

Run: `bun test src/components/ui/PresetLibrary.test.tsx src/components/loop/synth/synthPanels.test.tsx`
Expected: pass. If a `synthPanels` test pinned the old label class string, update it to
`FIELD_LABEL`'s value with a one-line comment recording the convergence.

- [ ] **Step 6: Prove the widened guard catches a new leak**

```bash
cat > src/components/ui/leakProbe.tsx <<'PROBE'
export function LeakProbe() {
  return <label className="text-[11px] text-base-content/60 block mb-1">Leak</label>;
}
PROBE
bun test src/components/ui/fieldClasses.test.ts
rm src/components/ui/leakProbe.tsx
```

Expected: the run **fails** naming `src/components/ui/leakProbe.tsx`. Then:

Run: `bun test src/components/ui/fieldClasses.test.ts && git status --short`
Expected: PASS, and `leakProbe.tsx` is gone.

- [ ] **Step 7: Verify and commit**

Run: `bun run verify`
Expected: green. The `jsx-a11y/label-has-associated-control` count drops from 29 to 19 (six group
labels became spans, four `PresetLibrary` labels gained `htmlFor`).

Run: `bun run eslint 2>&1 | grep -c "label-has-associated-control"`
Expected: `19`.

```bash
git add src/components/ui/fieldClasses.test.ts src/components/loop/synth/ArpeggiatorPanel.tsx src/components/loop/synth/FilterPanel.tsx src/components/loop/synth/LfoPanel.tsx src/components/loop/synth/OscillatorPanel.tsx src/components/ui/PresetLibrary.tsx
git commit -m "test(ui): widen the class-drift guard and close the ten label leaks

The old sweep was pinned to text-[10px]; the ten leaks wore the same role
at 11px and text-xs. The sweep now also covers ModuleHeader's row and
title and PanelCard's shell, so a hand-written copy of any of the five
fails verify. The six labels that named a button group became spans with
role=group + aria-labelledby.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 10: `jsx-a11y` to zero, then to `error`

Spec, *Warn vs error at end of Phase 2*: flip all `jsx-a11y` rules to error. Spec, *Risks*: the
recommended set flags patterns beyond icon buttons — "these are real findings; fix or
line-disable with a reason", and "`autoFocus` in dialogs is kept and disabled with a reason: it
is the correct focus target for a modal."

**The exact warning list** on `main` at `3b944f5` (41 across 5 rules), and where each is handled:

| Rule | Count | Sites | Handled |
| --- | --- | --- | --- |
| `label-has-associated-control` | 29 | see below | 10 in Task 9, 1 in Step 3, 18 in Step 1 |
| `no-autofocus` | 6 | `ProjectDialogs.tsx:67`, `:77`, `:99`; `ProjectList.tsx:43`; `SortableLoopCard.tsx:324`; `QuickSavePopover.tsx:54` | 1 removed in Task 8, 1 folded into `ConfirmDialog` in Task 4, 4 disabled in Step 2 |
| `click-events-have-key-events` | 4 | `ChordView.tsx:734`, `:791`; `SortableLoopCard.tsx:233`; `PresetLibrary.tsx:610` | Steps 3–5 |
| `no-static-element-interactions` | 1 | `SortableLoopCard.tsx:233` | Step 5 |
| `no-noninteractive-element-interactions` | 1 | `PresetLibrary.tsx:610` | Step 3 |

`label-has-associated-control` sites: `BassModulePanel.tsx:71,110,127,176,214`;
`ChordModulePanel.tsx:71,111,129,178,242`; `SortableChordCard.tsx:164,182,219`;
`ArpeggiatorPanel.tsx:47,70,92`; `FilterPanel.tsx:30`; `LfoPanel.tsx:30`;
`OscillatorPanel.tsx:30`; `MidiSettingsModal.tsx:245,260`;
`PresetLibrary.tsx:322,336,350,400,413,428,441,610`. (Line numbers shift as earlier tasks land —
re-run the enumeration command in Step 1 rather than trusting these.)

**Files:**
- Modify: `src/components/loop/chord/BassModulePanel.tsx`, `ChordModulePanel.tsx`,
  `SortableChordCard.tsx`, `src/components/ui/MidiSettingsModal.tsx`,
  `src/components/ui/PresetLibrary.tsx`
- Modify: `src/components/project/ProjectDialogs.tsx`, `ProjectList.tsx`,
  `src/components/song/SortableLoopCard.tsx`, `src/components/loop/ChordView.tsx`
- Modify: `eslint.config.js:7-19`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond their having landed.
- Produces: `jsxA11yAsErrors` replaces `jsxA11yAsWarnings` in `eslint.config.js`; the same
  filtered rule set, severity `'error'`.

- [ ] **Step 1: Re-enumerate, then associate every remaining label**

Run: `bun run eslint 2>&1 | grep jsx-a11y | grep -oE "jsx-a11y/[a-z-]+" | sort | uniq -c`
Expected: the counts above minus what Tasks 4, 8 and 9 already cleared. Write the actual output
into the commit body at the end.

Run: `bun run eslint 2>&1 | awk '/^\//{f=$0} /label-has-associated-control/{print f" "$1}'`
Expected: the file:line list to work through. For each, add `htmlFor` pointing at the control's
existing `id`:

```diff
-            <label className={FIELD_LABEL}>Bass Preset</label>
+            <label className={FIELD_LABEL} htmlFor="select-bass-sound-preset">Bass Preset</label>
```

The ids already exist for eighteen of them — `select-bass-sound-preset`, `select-bass-octave`,
`select-bass-rhythm-pattern`, `slider-bass-feel`, and the `chord` equivalents; and
`` `select-chord-root-${chord.id}` ``, `` `select-chord-quality-${chord.id}` ``,
`` `select-chord-bars-${chord.id}` `` in `SortableChordCard` (use the same template literal in
`htmlFor`). Three need work:

- `BassModulePanel.tsx:214` "Custom Bass Pattern" and `ChordModulePanel.tsx:242` "Custom Chord
  Pattern" label a **step grid**, not a control: make them `<span className={FIELD_LABEL}
  id="label-custom-bass-pattern">` and put `role="group" aria-labelledby="label-custom-bass-pattern"`
  on the grid container, exactly as Task 9 did for the synth button groups.
- `MidiSettingsModal.tsx:245`, `:260`: the select and the number input have no id. Add
  `id="select-midi-target"` / `id="input-midi-cc"` and the matching `htmlFor`. Keep the labels'
  existing `label label-text text-xs` classes — they are daisyUI form-control labels, a different
  role from `FIELD_LABEL`, and nothing in this phase converges them.
- `PresetLibrary.tsx:322,336,350` (the **inline** save form; the modal four were done in Task 9):
  same `useId()` treatment — `const uid = useId();` in `PresetLibraryInlineSave`, then
  `htmlFor={`${uid}-name`}` / `-category` / `-description` with matching `id` on each control.

Run: `bun run eslint 2>&1 | grep -c "label-has-associated-control"`
Expected: `0`.

- [ ] **Step 2: Disable the four remaining `autoFocus` uses, each with its own reason**

Spec: `autoFocus` in a dialog is the correct focus target and is kept. Add the line directly
above each attribute (not above the element — the directive must be on the line before the
report):

`ProjectDialogs.tsx` `DirtyGuardDialog` (Cancel button) and `ImportConflictDialog` (Cancel
button):

```tsx
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- Cancel is the safe initial focus target for a dialog raised by an action that would lose work. */}
      <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
```

`ProjectList.tsx:43` (the inline rename input) and `SortableLoopCard.tsx:324` (the loop-name
input):

```tsx
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the input replaces the name in place on an explicit rename click; focusing it is the action the user asked for. */}
```

`ProjectDialogs.tsx`'s `NamePromptDialog` uses an effect + ref rather than the attribute already
(lines 26–30) — leave it. `DeleteConfirmDialog`'s `autoFocus` moved into `ConfirmDialog` in
Task 4 with its own disable.

Run: `bun run eslint 2>&1 | grep -c "no-autofocus"`
Expected: `0`.

- [ ] **Step 3: Make `PresetLibrary`'s drawer overlay a real button**

`src/components/ui/PresetLibrary.tsx:610` is a `<label className="drawer-overlay">` with an
`onClick` — one element triggering three rules (`label-has-associated-control`,
`click-events-have-key-events`, `no-noninteractive-element-interactions`). A label that labels
nothing and handles clicks is the wrong element; a button is the right one and needs no
suppressions:

```diff
-        <label
-          className="drawer-overlay"
-          aria-label="Close preset library"
-          onClick={onClose}
-        />
+        <button
+          type="button"
+          className="drawer-overlay"
+          aria-label="Close preset library"
+          onClick={onClose}
+        />
```

`drawer-overlay` in daisyUI v5 is a plain class (position, size, background) with no element
selector, so the styling carries over. `PresetLibrary.test.tsx:51` asserts only that the string
`drawer-overlay` is present, so it still passes.

Run: `bun test src/components/ui/PresetLibrary.test.tsx`
Expected: pass.

Manual check in Step 7: the backdrop must still dim and still close the drawer on click.

- [ ] **Step 4: Give `ChordView`'s two preview spans keyboard equivalents**

`ChordView.tsx:734` and `:791` are `<span role="button" tabIndex={0}>` with
`onMouseDown`/`onMouseUp`/`onMouseLeave` and no key handler: a keyboard user can focus them and
get nothing. The two handlers (`handlePreviewMouseDown` at line 388, `handlePreviewMouseUp` at
409) touch only `stopPropagation()` and `preventDefault()`, both of which a keyboard event has —
so widen the signatures and wire the keys.

At line 388 and 409:

```diff
-  const handlePreviewMouseDown = (
-    e: React.MouseEvent | React.TouchEvent,
+  const handlePreviewMouseDown = (
+    e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent,
     root: string,
     quality: string,
   ) => {
```

```diff
-  const handlePreviewMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
+  const handlePreviewMouseUp = (e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent) => {
```

Then on each of the two spans, after the existing `onMouseLeave`:

```tsx
                    onKeyDown={(e) => {
                      // Press-and-hold audition: the key repeat would retrigger
                      // the chord every few milliseconds.
                      if (e.repeat) return;
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      handlePreviewMouseDown(e, diatonic.root, diatonic.quality);
                    }}
                    onKeyUp={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      handlePreviewMouseUp(e);
                    }}
```

At line 791 the same, with `borrowed.root` / `borrowed.quality`.

Run: `bun test src/components/loop/ChordView.test.tsx && bun run lint`
Expected: tests pass; `tsc --noEmit` clean under `strict` (the widened unions must not break
either call site).

- [ ] **Step 5: Disable the two `SortableLoopCard` card-click reports**

`SortableLoopCard.tsx:233` is the card `<div>` whose `onClick` calls `onSelect(loop.id)` — a
shortcut, not the only path: line 223 explicitly ignores clicks that landed on a real control,
and line 343 is a real `<button onClick={() => onSelect(loop.id)}>` carrying the loop name. Two
rules report the same element, so two directives:

```tsx
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the card click is a shortcut for the loop-name button inside it (line 343), which is a real focusable control; the handler already ignores clicks that landed on a control. */}
      <div
        id={`card-loop-${loop.id}`}
```

Run: `bun run eslint 2>&1 | grep -c jsx-a11y`
Expected: `0`.

- [ ] **Step 6: Flip the rules to `error`**

`eslint.config.js` lines 7–19 and 28:

```diff
-// Phase 1 of the hygiene plan lands every jsx-a11y rule the preset actually
-// enables as `warn`; Phase 2 (the primitives that fix the offending markup)
-// flips them to `error`. Rules the preset ships `off` (e.g. the deprecated
-// `label-has-for`, superseded by `label-has-associated-control`) stay `off`
-// — a blanket `Object.keys().map()` would arm those too.
-const jsxA11yAsWarnings = Object.fromEntries(
+// Phase 2 flipped every jsx-a11y rule the preset actually enables to `error`:
+// the primitives that fix the offending markup have landed and the count is
+// zero. Rules the preset ships `off` (e.g. the deprecated `label-has-for`,
+// superseded by `label-has-associated-control`) stay `off` — a blanket
+// `Object.keys().map()` would arm those too.
+const jsxA11yAsErrors = Object.fromEntries(
   Object.entries(jsxA11y.flatConfigs.recommended.rules)
     .filter(([, severity]) => {
       const level = Array.isArray(severity) ? severity[0] : severity;
       return level !== 'off' && level !== 0;
     })
-    .map(([rule]) => [rule, 'warn']),
+    .map(([rule]) => [rule, 'error']),
 );
```

```diff
-    rules: jsxA11yAsWarnings,
+    rules: jsxA11yAsErrors,
```

- [ ] **Step 7: Prove the flip fires as an error**

```bash
cat > src/components/a11yProbe.tsx <<'PROBE'
export function A11yProbe() {
  return (
    <div>
      <label className="text-xs">Unassociated</label>
      <input type="text" autoFocus />
      <div onClick={() => {}}>clickable div</div>
    </div>
  );
}
PROBE
bun run eslint src/components/a11yProbe.tsx 2>&1 | grep -oE "(error|warning) +.*jsx-a11y/[a-z-]+" | sort -u
bun run eslint src/components/a11yProbe.tsx 2>&1 | tail -2
rm src/components/a11yProbe.tsx
```

Expected: at least `jsx-a11y/label-has-associated-control`, `jsx-a11y/no-autofocus`,
`jsx-a11y/click-events-have-key-events` and `jsx-a11y/no-static-element-interactions`, every one
prefixed **`error`**, and a summary line reporting `0 warnings` for those rules. If any prints
`warning`, the flip did not take — check that the spread config object below `...tseslint.configs`
is the one whose `rules` you replaced.

Run: `git status --short`
Expected: only `eslint.config.js` and the files edited in Steps 1–5; `a11yProbe.tsx` is gone.

- [ ] **Step 8: Final verify, and record the phase's numbers**

Run: `bun run verify`
Expected: green end to end.

Run: `bun run eslint 2>&1 | tail -1`
Expected: `✖ N problems (0 errors, N warnings)` with **N well below 358** and zero `jsx-a11y`
among them. Put this line and the following two in the PR description as the Phase 2 result:

Run: `bun run eslint 2>&1 | grep -oE "(no-restricted-syntax|consistent-type-definitions|exhaustive-deps|complexity)" | sort | uniq -c`
Expected: only the four rules Phase 3 and the backlog own — `no-restricted-syntax` (React.FC and
`../../`), `consistent-type-definitions`, `exhaustive-deps`, `complexity`.

Run: `grep -rn "confirm(\|alert(\|modal-open" src`
Expected: nothing outside `ui/Modal.tsx`'s own comment — the spec's acceptance criterion.

```bash
git add src/components/loop/chord/BassModulePanel.tsx src/components/loop/chord/ChordModulePanel.tsx src/components/loop/chord/SortableChordCard.tsx src/components/ui/MidiSettingsModal.tsx src/components/ui/PresetLibrary.tsx src/components/project/ProjectDialogs.tsx src/components/project/ProjectList.tsx src/components/song/SortableLoopCard.tsx src/components/loop/ChordView.tsx eslint.config.js
git commit -m "chore(eslint): jsx-a11y to error, with the 41 findings closed

Every remaining form label is associated with its control (or is a span
naming a role=group); the drawer overlay is a button rather than a label
that labels nothing; ChordView's press-and-hold audition spans answer
Enter and Space. The four autoFocus uses that survive are the correct
initial focus target for the dialog or inline edit they sit in and carry
a line-level disable with that reason.

bun run eslint: 0 errors, <N> warnings, 0 jsx-a11y.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

Replace `<N>` with the number from Step 8 before running.

---

## Self-review

**Spec coverage** — every Phase 2 item maps to a task:

| Spec item | Task |
| --- | --- |
| `Modal`: `open`/`onClose`/`title`/`children` in `modal-box`, optional `size`, ref + effect calling `showModal()`/`close()`, `onClose` on the native `close` event, never `modal-open`; replaces the 4 dialog sites; `ProjectDialogs`'s `Shell` deleted | 3 |
| `ConfirmDialog` on `Modal`; `title`/`message`/`confirmLabel`/`danger?`/`onConfirm`/`onCancel`; `DeleteConfirmDialog` a thin call; replaces 4 `confirm()`; 2 `alert()` become inline `role="alert"` | 4 |
| `IconButton`: `label` required as `aria-label` **and** `title`, `icon`, `size`, `variant`, `active?`, native props; replaces the unlabelled icon buttons and the hand-written variants | 1, 2 |
| `ModuleHeader`: `badge?`/`icon?`/`title`/`right?`; the header row + title span; 10 rows + 10 spans | 6 |
| `PanelCard`: `tint?`/`children`/`className?`; the card shell + tint | 7 |
| `QuickSavePopover`: Escape close, return focus to trigger | 8 |
| `fieldClasses.test.ts` regex sweep for `FIELD_LABEL` / `SECTION_HEADER` lookalikes; fix the leaks | 9 |
| *Risks*: the sweep extended to `ModuleHeader` and `PanelCard` strings | 9 |
| Every primitive gets a `renderToString` test; `Modal`'s DOM behaviour via a pure `syncDialogOpen(el, open)` tested with a stub | 1, 3, 4, 6, 7 |
| Flip to error: confirm/alert/prompt ban, moved to `no-restricted-globals` + `no-restricted-properties` | 5 |
| Flip to error: all `jsx-a11y` rules | 10 |
| Still `warn`: `React.FC`, `../../`, `consistent-type-definitions`, `exhaustive-deps` | 5 (Step 4 proves it), 10 (Step 8 counts them) |
| Acceptance: `verify` green; `grep confirm(\|alert(\|modal-open` empty; every icon-only button has `aria-label` | 4 (Step 9), 3 (Step 15), 2 (Step 3), 10 (Step 8) |
| *Risks*: nested `showModal()` verified manually with the dirty-guard flow | 3 (Step 16) |
| *Risks*: jsx-a11y findings beyond icon buttons fixed or line-disabled with a reason; `autoFocus` in dialogs kept and disabled with a reason | 10 (Steps 2–5) |

**Placeholder scan** — no "TBD", "handle edge cases", or "similar to Task N". The deliberate
templates are `<N>` in four commit bodies, each filled from a command run in the step above it,
and the "(read it)" entries in Task 2's conversion table, which are an explicit instruction to
copy the button's existing `title` attribute verbatim rather than let the implementer invent
label text.

**Type consistency** — `cx` (Task 1) is used unchanged by `IconButton`, `Modal`, `ModuleHeader`,
`PanelCard`. `IconButtonProps.label` is the same name Task 2's table fills. `DialogHandle` /
`syncDialogOpen` (Task 3) are the exact names the spec uses. `ModalProps.boxClassName` and
`headerDivider` are introduced in Task 3 and consumed by `ConfirmDialog` (Task 4) and the four
call sites. `PANEL_CARD` (Task 7), `MODULE_HEADER_ROW` and `MODULE_TITLE` (Task 6) are exported
under exactly the names Task 9's guard imports. `toastTone: 'success' | 'error'` is the same
union in `PresetLibrary`, `SynthPresetLibrary` and `ChordPresetLibrary`.

**Three deviations from the spec, all deliberate and all recorded in the task that makes them:**

1. `PanelCard`'s `tint` is `string`, not the spec's `ModuleTint` — no such type exists and the
   real value is a runtime-joined pair of classes (Task 7).
2. `Modal` gains `headerDivider` and `boxClassName`; `ModuleHeader` gains `divider` and
   `children` — four call sites wearing three different header shapes cannot share one
   primitive otherwise (Tasks 3, 6).
3. Three visual convergences, not zero: the preset save modal's box chrome and its heading size
   (Task 3), and the ten field labels dropping to `FIELD_LABEL`'s 10px (Task 9). The spec's "no
   visual change" non-goal is about markup moving into primitives unchanged; a primitive cannot
   render four different boxes, and a token whose whole purpose is to end drift cannot preserve
   the drift.

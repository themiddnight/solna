# Shared Popup Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every popup in the app (the two dock menus, the project menu and the quick-save popover) on `ui/Popup`, so one hook handles dismissal and focus return for all of them. The CSS `:focus-within` dropdowns and the hand-written `useQuickSavePopover` dismissal go away.

**Architecture:** First `usePopup` changes: it reads `onClose` through a latest-ref, and it listens for outside `pointerdown` in the capture phase. `Popup` gains `side`, a wrapper `className` and a `tabIndex={-1}` panel. `useListbox` re-seeds its highlight when `value` changes from outside. A small shared hook, `ui/usePopupMenu.ts`, holds a menu's open state and closes the menu when a row is picked. `ui/DockMenu.tsx` (the dock) and `project/ProjectMenu.tsx` both use it. `QuickSavePopover` renders `Popup` directly, and its hook only selects the input text.

**Tech Stack:** Bun (test runner), TypeScript, React 19 (`renderToString` tests), Tailwind v4 + daisyUI v5, lucide-react, ESLint (jsx-a11y and react-hooks at error), Knip.

**Spec:** `docs/superpowers/specs/2026-09-26-shared-popup-migration-design.md` (binding). Read it before Task 1.

## Global Constraints

- Tests are `bun:test`, with no DOM and no testing-library, and none may be added (`.claude/rules/testing.md`). Test pure functions, or render with `renderToString` and assert on literal substrings. Nothing is observable through effects: no effect runs under `renderToString`.
- The `renderToString` zustand trap (R257): a component only shows a `setState` made before its render if it reads through `useLiveStore` (the dock does). Otherwise assert against `useAppStore.getInitialState()`, or pass the data in directly.
- Component state, callbacks, effects and handlers live in a colocated `useXxx` hook (R265), and the hook's return type is named and exported as `UseXxx` (R266). Child components are defined above the root (R267). A state hook is called once, at the root (R268).
- Placement (R276): code used by one area stays with it. `usePopupMenu` serves `ui/DockMenu` and `project/ProjectMenu`. It is part of the `ui/Popup` primitive family, so it lives in `src/components/ui/` beside `usePopup.ts`.
- `bun run eslint` reports **zero errors and zero warnings** (R005, R264). Fix a warning, or disable it on one line with `// eslint-disable-next-line <rule> -- <reason>`. Never relax a rule. Limits: `max-lines-per-function` is 100 and also applies to test `describe` callbacks; `max-lines` is 750 per file; `complexity` warns above 20.
- Both Knip scans stay at zero findings (R006). An export needs an importer, and a test import counts for `check:dead-code`.
- No new dependencies. No popover API and no CSS anchor positioning (R328). Popup panels stay at `z-50` (R331).
- daisyUI classes: `dropdown`, `dropdown-start`, `dropdown-end`, `dropdown-top`, `dropdown-open` and `dropdown-content`. Each one was checked on 2026-09-26 against https://daisyui.com/components/dropdown/ ("`dropdown-top` — Placement — Open from top") and against the installed `node_modules/daisyui/components/dropdown.css` (`.dropdown-top .dropdown-content{…top:auto;bottom:100%}`). The same docs recommend `tabindex="-1"` on the content. Write every class as a **literal string**, never `` `dropdown-${side}` ``, because Tailwind only emits classes it finds verbatim. Use theme tokens only: no hex, palette colours or `dark:` (`check:theme`).
- A popup trigger never carries `tabindex`. daisyUI gives `.dropdown-open > [tabindex]:first-child` `pointer-events: none`, so the click would fall through. The panel is never the wrapper's first child, so its `tabIndex={-1}` is safe.
- No `role="menu"` anywhere in this change (spec §4).
- Rules files and ADRs record no version numbers, file counts or line numbers (R001). A rule change updates its rules file **and** its ADR in the same commit. ADR-0055 is Accepted: only its Status line changes.
- Commit on `refactor/shared-popup-migration` with a conventional message whose last line is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `git add` with explicit paths only; never add `.ux-assessment/`. Never push. There is no Linear issue.
- Code, comments and docs are in English.

## Review Focus

1. **Typing in the QuickSave name keeps the caret where it is.** The callers pass `onClose`, and a parent re-render (every keystroke calls `onNameChange`) can hand in a new function. If `usePopup`'s focus effect depended on `onClose`, each keystroke would return focus to the trigger, refocus the input and select it, so the next character would replace the text. The latest-ref in Task 1 prevents this. No DOM exists to test it, so Task 7's browser check pins it: type three characters and the value ends in all three.
2. **A listbox re-render with an unchanged `value` must leave the arrow or hover highlight alone.** Only an external value change re-seeds it. A stale value re-seeds to option 0 and an empty list to -1, and neither throws. Pinned by the `nextActive` tests in Task 2.
3. **A project-menu row that opens a dialog must survive the menu closing.** `ProjectMenuEffects` (the file input, the confirm, the Drive browser, the pending overlay, Diagnostics) renders as a sibling of `Popup`, never inside its panel. Inside the panel it would unmount with the menu, together with the dialog it just opened. Pinned in Task 4 by asserting `</button></div><input` in the closed markup.
4. **A locked target chip (recording armed, R341) cannot open, and a chip that locks while open shuts and stays shut when unlocked.** The trigger is `disabled`, and `usePopupMenu` clears its open state during render instead of masking it. Pinned by the `settledMenuOpen` tests and the dock's existing armed test in Task 3.
5. **Closing QuickSave returns focus to the trigger, not to the name input.** `Popup`'s focus effect (a child's, so it runs first) records the trigger and then focuses the input, and after that the hook's effect selects the text. If the hook moved focus itself before `Popup` recorded the element to return to, `Popup` would record the input instead. Pinned in Task 5 by a source test that `useQuickSavePopover.ts` never calls `.focus(`, and in Task 7's browser check.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/components/ui/usePopup.ts` | `useLatest` for `onClose`; capture-phase outside pointerdown | 1 |
| `src/components/ui/Popup.tsx` | `side`, wrapper `className`, panel `tabIndex={-1}` + `outline-none`; the stable-`onClose` note removed | 1 |
| `src/components/ui/Popup.test.tsx` | Panel markup updated; `side="top"`, `className` tests | 1 |
| `src/components/ui/useListbox.ts` | Pure `nextActive`; re-seed during render | 2 |
| `src/components/ui/useListbox.test.ts` | `nextActive` tests | 2 |
| `src/components/ui/usePopupMenu.ts` (new) | `usePopupMenu` → `UsePopupMenu<T>`; pure `settledMenuOpen` | 3 |
| `src/components/ui/usePopupMenu.test.ts` (new) | `settledMenuOpen` | 3 |
| `src/components/ui/DockMenu.tsx` (new) | `DockMenuList`, `DockMenu` on `Popup` (`side="top"`) | 3 |
| `src/components/ui/DockMenu.test.tsx` (new) | Trigger, closed state, list markup | 3 |
| `src/components/ui/BottomInputDock.tsx` | Old `DockMenu` and `DROPDOWN_TRIGGER_NOTE` deleted; both chips use `ui/DockMenu` | 3 |
| `src/components/ui/BottomInputDock.test.tsx` | Item tests moved onto `DockMenuList`; `<button>`/no-`tabindex` tests | 3 |
| `src/components/project/ProjectMenu.tsx` | `ProjectMenuTrigger`; `ProjectMenu` on `Popup` + `usePopupMenu`; effects outside the popup | 4 |
| `src/components/project/ProjectMenu.test.tsx` | Row tests render `ProjectMenuSections`; the trigger test rewritten | 4 |
| `src/components/ui/useQuickSavePopover.ts` | Shrinks to `inputRef` + select-on-open | 5 |
| `src/components/ui/QuickSavePopover.tsx` | On `Popup` (`align="end"`, `initialFocusRef`) | 5 |
| `src/components/ui/QuickSavePopover.test.tsx` | Panel markup and focus-order source test | 5 |
| `src/components/ui/popupGeometry.ts` | Header comment: one consumer | 5 |
| `.claude/rules/components.md` | R328 amended; a new Prohibited line | 6 |
| `docs/decisions/0056-popup-migration-complete.md` (new) | The ADR | 6 |
| `docs/decisions/README.md` | Index row | 6 |
| `docs/decisions/0055-shared-popup-and-listbox.md` | Status-line pointer only | 6 |
| `work/browser-evidence.md` (gitignored) | Browser evidence | 7 |

The tasks run in order. Tasks 3–5 each depend on Task 1's `side`/`className` and on the latest-ref. Task 3 creates `usePopupMenu`, which Task 4 uses.

---

### Task 1: `usePopup` latest-ref and capture; `Popup` gets `side`, `className` and a `tabIndex={-1}` panel

The spec's §1 and §2. The two `usePopup` changes cannot be observed without a DOM, so the browser check in Task 7 covers them. This task's test cycle is the `Popup` markup.

**Files:**
- Modify: `src/components/ui/usePopup.ts` (whole file)
- Modify: `src/components/ui/Popup.tsx` (whole file)
- Test: `src/components/ui/Popup.test.tsx`

**Interfaces:**
- Consumes: `isDismissKey`, `isOutside`, `panelNaturalRect` and `popupShift` from `./popupGeometry`, unchanged; `cx` from `./cx`.
- Produces: `Popup` props `{ open: boolean; onClose: () => void; trigger: ReactNode; align: 'start' | 'end'; side?: 'bottom' | 'top'; className?: string; panelClassName?: string; initialFocusRef?: RefObject<HTMLElement | null>; children: ReactNode }`. `onClose` no longer has to be stable. The rendered wrapper class is `cx('dropdown', align === 'end' ? 'dropdown-end' : 'dropdown-start', side === 'top' && 'dropdown-top', open && 'dropdown-open', className)`. The open panel renders as `<div tabindex="-1" class="dropdown-content z-50 outline-none …panelClassName">`.

- [ ] **Step 1: Write the failing tests**

Replace `src/components/ui/Popup.test.tsx` with:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Popup } from './Popup';

function render(
  open: boolean,
  align: 'start' | 'end' = 'end',
  extra: { side?: 'bottom' | 'top'; className?: string } = {},
) {
  return renderToString(
    <Popup
      open={open}
      onClose={() => {}}
      align={align}
      panelClassName="w-80 p-2"
      trigger={<button type="button" id="btn-popup-test">Open</button>}
      {...extra}
    >
      <p>Panel body</p>
    </Popup>,
  );
}

describe('Popup', () => {
  test('closed renders only the trigger inside the dropdown wrapper, no panel', () => {
    const html = render(false);
    expect(html).toBe('<div class="dropdown dropdown-end"><button type="button" id="btn-popup-test">Open</button></div>');
  });

  test('open adds dropdown-open and mounts the z-50 panel after the trigger', () => {
    const html = render(true);
    expect(html).toContain('<div class="dropdown dropdown-end dropdown-open"><button type="button" id="btn-popup-test">Open</button>');
    expect(html).toContain('<p>Panel body</p></div>');
  });

  // A pointerdown on panel padding (or, in Safari, on a <button>) leaves
  // focus on the panel — inside the wrapper — instead of dropping it to
  // <body>. -1 keeps it out of the tab order; it is not a control, so no ring.
  test('the open panel is focusable by pointer only, with no focus ring', () => {
    expect(render(true)).toContain('<div tabindex="-1" class="dropdown-content z-50 outline-none w-80 p-2">');
  });

  test('align start anchors the panel to the trigger’s start edge', () => {
    expect(render(true, 'start')).toContain('<div class="dropdown dropdown-start dropdown-open">');
  });

  test('side top opens the panel above the trigger (daisyUI dropdown-top)', () => {
    expect(render(true, 'start', { side: 'top' })).toContain('<div class="dropdown dropdown-start dropdown-top dropdown-open">');
    expect(render(false, 'start', { side: 'bottom' })).toBe(
      '<div class="dropdown dropdown-start"><button type="button" id="btn-popup-test">Open</button></div>',
    );
  });

  test('className lands last on the wrapper', () => {
    expect(render(false, 'start', { side: 'top', className: 'flex' })).toContain('<div class="dropdown dropdown-start dropdown-top flex">');
  });

  test('an unshifted panel carries no transform', () => {
    expect(render(true)).not.toContain('style=');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/ui/Popup.test.tsx`
Expected: FAIL. The `tabindex="-1"`, `side top` and `className` tests fail because `Popup` has none of these yet. The other four pass.

- [ ] **Step 3: Rewrite `src/components/ui/usePopup.ts`**

```ts
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { isDismissKey, isOutside, panelNaturalRect, popupShift } from './popupGeometry';

export interface UsePopup {
  /** The `dropdown` wrapper: the trigger and the panel both sit inside it. */
  wrapperRef: RefObject<HTMLDivElement | null>;
  /** The `dropdown-content` panel, mounted only while open. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Horizontal `translateX` (px) that keeps the panel inside the viewport. */
  shift: number;
}

interface PopupOptions {
  open: boolean;
  /** Read through a latest-ref: an inline arrow is fine, and a new one never re-runs an effect. */
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The newest `value`, readable from a listener without that listener's effect
 * depending on it. Written in a layout effect, never during render, so it is
 * current before any passive effect or event reads it.
 */
function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Escape and a pointerdown outside the wrapper close the popup. Escape stops
 * propagating here: the page is full of shortcut keys on `window`. It stays
 * in the bubble phase, so a focused control inside the panel sees it first.
 * The pointerdown listens in the capture phase: an outside handler that
 * stops propagation (a span-resize handle, say) cannot keep the popup open.
 */
function useDismiss(
  open: boolean,
  onCloseRef: RefObject<() => void>,
  wrapperRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isDismissKey(e)) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    const onPointerDown = (e: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (!isOutside(e.target as Node | null, (node) => wrapper?.contains(node) ?? false)) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
    };
  }, [open, onCloseRef, wrapperRef]);
}

/**
 * On open, focus moves to `initialFocusRef`; on close it goes back to what
 * had it before (the trigger). The panel is a plain `dropdown-content`, not
 * a <dialog>, so the platform does none of this. Focus leaving the wrapper
 * (Tab away) closes the popup and keeps focus where Tab sent it — pulling it
 * back to the trigger would fight the browser's own focus move. The effect
 * never depends on `onClose`: a re-subscription would hand focus back to the
 * trigger and refocus the input on every parent re-render.
 */
function useFocusHandoff(
  open: boolean,
  onCloseRef: RefObject<() => void>,
  wrapperRef: RefObject<HTMLDivElement | null>,
  initialFocusRef: RefObject<HTMLElement | null> | undefined,
): void {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!open || !wrapper) return;
    let returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef?.current?.focus();
    const onFocusOut = (e: FocusEvent) => {
      if (!isOutside(e.relatedTarget as Node | null, (node) => wrapper.contains(node))) return;
      returnTo = null;
      onCloseRef.current();
    };
    wrapper.addEventListener('focusout', onFocusOut);
    return () => {
      wrapper.removeEventListener('focusout', onFocusOut);
      returnTo?.focus();
    };
  }, [open, onCloseRef, wrapperRef, initialFocusRef]);
}

/** Measures the panel on open and on resize and returns the shift that keeps it on screen (R328). */
function usePanelShift(
  open: boolean,
  wrapperRef: RefObject<HTMLDivElement | null>,
  panelRef: RefObject<HTMLDivElement | null>,
): number {
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      // The panel unmounts while closed; reset so a reopen never paints one
      // frame at a stale shift before `measure()` runs.
      setShift(0);
      return;
    }
    const measure = () => {
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!wrapperRect || !panel) return;
      const natural = panelNaturalRect(wrapperRect.left, {
        offsetLeft: panel.offsetLeft,
        offsetWidth: panel.offsetWidth,
      });
      setShift(popupShift(natural, window.innerWidth));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, wrapperRef, panelRef]);
  return shift;
}

/**
 * `ui/Popup`'s platform glue (R328): dismissal, focus handoff and the
 * viewport shift, split into one small hook each.
 */
export function usePopup({ open, onClose, initialFocusRef }: PopupOptions): UsePopup {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useLatest(onClose);
  useDismiss(open, onCloseRef, wrapperRef);
  useFocusHandoff(open, onCloseRef, wrapperRef, initialFocusRef);
  const shift = usePanelShift(open, wrapperRef, panelRef);
  return { wrapperRef, panelRef, shift };
}
```

- [ ] **Step 4: Rewrite `src/components/ui/Popup.tsx`**

```tsx
import type { ReactNode, RefObject } from 'react';
import { cx } from './cx';
import { usePopup } from './usePopup';

interface PopupProps {
  open: boolean;
  /** Closes the popup. Any function will do; `usePopup` reads the latest one. */
  onClose: () => void;
  /** The trigger the caller renders; it must not carry `tabindex` (daisyUI disables pointer events on one while open). */
  trigger: ReactNode;
  /** Which trigger edge the panel hangs from. */
  align: 'start' | 'end';
  /** Which side of the trigger the panel opens on; `top` is daisyUI `dropdown-top`. */
  side?: 'bottom' | 'top';
  /** Extra wrapper classes (e.g. `flex`, so a trigger in a `join` keeps the group's height). */
  className?: string;
  panelClassName?: string;
  /** Focused when the popup opens. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * The one popup shell (R328): a controlled daisyUI `dropdown` anchored to its
 * trigger, `dropdown-open` while open, its `z-50` panel (R331) mounted only
 * while open, opening below the trigger or above it (`side="top"`), and
 * shifted back inside the viewport. Closes on Escape, an outside pointerdown
 * and focus leaving it; see `usePopup`. The panel is `tabIndex={-1}`: a
 * pointerdown on its padding keeps focus inside the wrapper instead of
 * dropping it to <body>, and it stays out of the tab order.
 */
export function Popup({
  open,
  onClose,
  trigger,
  align,
  side = 'bottom',
  className,
  panelClassName,
  initialFocusRef,
  children,
}: PopupProps) {
  const { wrapperRef, panelRef, shift } = usePopup({ open, onClose, initialFocusRef });
  return (
    <div
      ref={wrapperRef}
      className={cx(
        'dropdown',
        align === 'end' ? 'dropdown-end' : 'dropdown-start',
        side === 'top' && 'dropdown-top',
        open && 'dropdown-open',
        className,
      )}
    >
      {trigger}
      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          className={cx('dropdown-content z-50 outline-none', panelClassName)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/components/ui/Popup.test.tsx src/components/Header.test.tsx`
Expected: PASS. The header's two `Popup` callers (`header/ScaleMenu.tsx`, `header/ScaleTypeListbox.tsx`) pass no `side`, so their markup is unchanged apart from the open panel, and they render closed in the tests.

- [ ] **Step 6: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: zero errors, zero warnings. jsx-a11y's `no-noninteractive-tabindex` allows `tabIndex={-1}`, so the panel should not trip it. If it does, fix the site or disable that one line with a reason (R264), and never relax the rule.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/usePopup.ts src/components/ui/Popup.tsx src/components/ui/Popup.test.tsx
git commit -m "$(cat <<'EOF'
refactor(ui): Popup reads onClose through a latest-ref, listens in capture, gains side

usePopup holds onClose in a latest-ref, so no effect re-subscribes when a
caller passes an inline arrow, and it hears an outside pointerdown in the
capture phase, so a handler that stops propagation cannot keep a popup
open. Popup gains side ('top' is daisyUI dropdown-top), a wrapper
className, and a tabIndex=-1 panel that keeps a padding click's focus
inside the wrapper.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `useListbox` re-seeds its highlight on an external value change

The spec's §3.

**Files:**
- Modify: `src/components/ui/useListbox.ts` (add `nextActive` after `activeForValue`; add the re-seed lines to `useListbox`)
- Test: `src/components/ui/useListbox.test.ts`

**Interfaces:**
- Consumes: `activeForValue(values: readonly string[], value: string): number` (existing).
- Produces: `export function nextActive(prevValue: string, value: string, active: number, values: readonly string[]): number`. The public API of `useListbox` does not change.

- [ ] **Step 1: Write the failing tests**

In `src/components/ui/useListbox.test.ts`, add `nextActive` to the import from `./useListbox`, so that it reads:

```ts
import { activeForValue, groupHeadingId, indexGroups, nextActive, optionId, parseOptionIndex, revealScrollTop } from './useListbox';
```

Add this block after the `activeForValue` describe:

```ts
describe('nextActive', () => {
  const VALUES = ['a', 'b', 'c'];

  // Arrows and hover own the highlight while the value stands: an unrelated
  // re-render must never snap it back to the selected option.
  test('an unchanged value keeps the highlight where the user moved it', () => {
    expect(nextActive('b', 'b', 2, VALUES)).toBe(2);
    expect(nextActive('b', 'b', 0, VALUES)).toBe(0);
  });

  test('a value changed from outside moves the highlight to its option', () => {
    expect(nextActive('a', 'c', 0, VALUES)).toBe(2);
  });

  test('a commit re-seeds onto the option it just committed, a no-op', () => {
    expect(nextActive('a', 'b', 1, VALUES)).toBe(1);
  });

  test('a new value that is not an option starts on the first; an empty list has none', () => {
    expect(nextActive('a', 'stale key', 2, VALUES)).toBe(0);
    expect(nextActive('a', 'b', 0, [])).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/ui/useListbox.test.ts`
Expected: FAIL with `SyntaxError: Export named 'nextActive' not found` (or the TS equivalent).

- [ ] **Step 3: Add the helper and the re-seed**

In `src/components/ui/useListbox.ts`, add this directly after `activeForValue`:

```ts
/**
 * The highlight after `value` may have changed. While `value` stands, the
 * highlight is the user's (arrows, Home/End, type-ahead, hover) and is kept.
 * When `value` changed from outside, it re-seeds onto the new value's option.
 * A commit also changes `value`, onto the option already highlighted, so the
 * re-seed lands where the highlight already is.
 */
export function nextActive(prevValue: string, value: string, active: number, values: readonly string[]): number {
  return prevValue === value ? active : activeForValue(values, value);
}
```

In `useListbox`, directly after the `const [active, setActive] = useState(...)` line, add:

```ts
  // "Adjusting state during render", not an effect: the re-seeded highlight
  // paints in the same frame as the new value. Guarded by the comparison, so
  // it runs once per value change and never loops.
  const [seededValue, setSeededValue] = useState(value);
  if (seededValue !== value) {
    setSeededValue(value);
    setActive(nextActive(seededValue, value, active, model.values));
  }
```

A changed `active` then runs the existing reveal effect with `revealRef.current === true`, so the re-seeded option scrolls into view. That is intended.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/ui/useListbox.test.ts src/components/ui/Listbox.test.tsx src/components/Header.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `bun run lint && bun run eslint`
Expected: zero errors, zero warnings. The react-hooks `set-state-in-render` check only flags an *unconditional* render-phase `setState`. This one is guarded, which is React's documented pattern. If the check flags it anyway, read the message before you change anything. Do not disable the rule file-wide.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/useListbox.ts src/components/ui/useListbox.test.ts
git commit -m "$(cat <<'EOF'
fix(ui): re-seed the listbox highlight when its value changes from outside

The pure nextActive keeps the user's highlight while the value stands and
moves it to the new value's option when the value changed from outside;
useListbox applies it during render, tracking the previous value in state.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The two dock menus on `ui/Popup`

The spec's §4. The old in-file `DockMenu` becomes `ui/DockMenu.tsx`, a `Popup` with its own trigger button, and both chips use it. The open state, and the close that follows a pick, live in a new shared hook, `ui/usePopupMenu.ts`. Task 4 reuses that hook.

**Files:**
- Create: `src/components/ui/usePopupMenu.ts`
- Create: `src/components/ui/usePopupMenu.test.ts`
- Create: `src/components/ui/DockMenu.tsx`
- Create: `src/components/ui/DockMenu.test.tsx`
- Modify: `src/components/ui/BottomInputDock.tsx` (delete the `DROPDOWN_TRIGGER_NOTE` comment block and the old `DockMenu` function; rewrite the dropdown in `InputTargetGroup` and all of `KeyboardModePicker`)
- Modify: `src/components/ui/BottomInputDock.test.tsx`

**Interfaces:**
- Consumes: `Popup` from Task 1 (`side`, `className`).
- Produces:
  - `ui/usePopupMenu.ts`: `export interface UsePopupMenu<T> { open: boolean; toggle: () => void; close: () => void; pick: (value: T) => void }`, `export function usePopupMenu<T>(onPick: (value: T) => void, disabled?: boolean): UsePopupMenu<T>` and `export function settledMenuOpen(isOpen: boolean, disabled: boolean): boolean`.
  - `ui/DockMenu.tsx`: `export function DockMenuList<T extends string>(props: DockMenuListProps<T>)` and `export function DockMenu<T extends string>(props: DockMenuProps<T>)`. The list id is `${idPrefix}-list` and each item id is `${idPrefix}-${option}`.

- [ ] **Step 1: Write the failing `usePopupMenu` test**

Create `src/components/ui/usePopupMenu.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { settledMenuOpen } from './usePopupMenu';

describe('settledMenuOpen', () => {
  test('an enabled menu is open exactly when it was opened', () => {
    expect(settledMenuOpen(true, false)).toBe(true);
    expect(settledMenuOpen(false, false)).toBe(false);
  });

  // R341: arming a recording locks the target chip. A menu open at that
  // moment shuts, and because usePopupMenu writes this back into its state
  // rather than masking it, unlocking never springs the menu open again.
  test('a disabled menu is shut whether or not it was open', () => {
    expect(settledMenuOpen(true, true)).toBe(false);
    expect(settledMenuOpen(false, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing `DockMenu` tests**

Create `src/components/ui/DockMenu.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { DockMenu, DockMenuList } from './DockMenu';

// Same helper as BottomInputDock.test.tsx: ties an assertion to ONE element's opening tag.
function openTagContaining(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  return html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx) + 1);
}

const OPTIONS = ['alpha', 'beta'] as const;
const LABELS = { alpha: 'Alpha', beta: 'Beta' } as const;
const TITLES = { alpha: 'The first', beta: 'The second' } as const;

function renderMenu(disabled = false) {
  return renderToString(
    <DockMenu
      triggerId="btn-test-chip"
      triggerLabel="Test: Beta"
      triggerTitle="Pick one"
      triggerClassName="btn btn-xs"
      disabled={disabled}
      options={OPTIONS}
      current="beta"
      idPrefix="btn-test"
      labels={LABELS}
      onPick={() => {}}
    >
      <span>Beta</span>
    </DockMenu>,
  );
}

describe('DockMenu', () => {
  test('the trigger is a real <button> that names its list and reports it closed', () => {
    const tag = openTagContaining(renderMenu(), 'id="btn-test-chip"');
    expect(tag.startsWith('<button')).toBe(true);
    expect(tag).toContain('type="button"');
    expect(tag).toContain('aria-label="Test: Beta"');
    expect(tag).toContain('aria-expanded="false"');
    expect(tag).toContain('aria-controls="btn-test-list"');
    expect(tag).toContain('title="Pick one"');
    expect(tag).not.toContain('role=');
    expect(tag).not.toContain('disabled');
  });

  // No tabindex anywhere: daisyUI turns off pointer events on a `[tabindex]`
  // first child of an open dropdown, and the old focusable-list hack is gone.
  test('closed, it is the Popup wrapper, opening upward, with no panel and no tabindex', () => {
    const html = renderMenu();
    expect(html.startsWith('<div class="dropdown dropdown-start dropdown-top flex"><button')).toBe(true);
    expect(html).not.toContain('dropdown-content');
    expect(html).not.toContain('btn-test-alpha');
    expect(html).not.toContain('tabindex');
  });

  test('disabled, the trigger is a disabled button', () => {
    expect(openTagContaining(renderMenu(true), 'id="btn-test-chip"')).toContain('disabled=""');
  });
});

describe('DockMenuList', () => {
  const html = renderToString(
    <DockMenuList options={OPTIONS} current="beta" idPrefix="btn-test" labels={LABELS} titles={TITLES} onPick={() => {}} />,
  );

  test('is a plain menu list: no role="menu", no tabindex', () => {
    expect(openTagContaining(html, 'id="btn-test-list"')).toBe('<ul id="btn-test-list" class="menu menu-sm w-full p-0">');
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('tabindex');
  });

  test('one button per option, only the current one marked', () => {
    const alpha = openTagContaining(html, 'id="btn-test-alpha"');
    const beta = openTagContaining(html, 'id="btn-test-beta"');
    expect(alpha).not.toContain('aria-current');
    expect(alpha).toContain('title="The first"');
    expect(beta).toContain('aria-current="true"');
    expect(beta).toContain('active font-bold');
    expect(html).toContain('>Alpha</button>');
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `bun test src/components/ui/usePopupMenu.test.ts src/components/ui/DockMenu.test.tsx`
Expected: FAIL with `Cannot find module './usePopupMenu'` and `Cannot find module './DockMenu'`.

- [ ] **Step 4: Create `src/components/ui/usePopupMenu.ts`**

```ts
import { useCallback, useState } from 'react';

export interface UsePopupMenu<T> {
  /** Whether the menu is open; never while disabled. */
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** Closes the menu and runs the pick (both land in one render). */
  pick: (value: T) => void;
}

/** Whether a menu is open: what the user opened, and never while it is disabled. */
export function settledMenuOpen(isOpen: boolean, disabled: boolean): boolean {
  return isOpen && !disabled;
}

/**
 * The open state of a menu built on `ui/Popup` (the dock chips, the project
 * menu). Picking a row closes the menu, then runs the row's action, so any
 * dialog the action opens takes focus after `Popup` has handed it back to
 * the trigger.
 */
export function usePopupMenu<T>(onPick: (value: T) => void, disabled = false): UsePopupMenu<T> {
  const [isOpen, setOpen] = useState(false);
  const open = settledMenuOpen(isOpen, disabled);
  // "Adjusting state during render", not an effect: a menu disabled while
  // open is shut in its state, not just masked, so re-enabling it never
  // springs it back open. Guarded, so it runs once.
  if (isOpen !== open) setOpen(open);

  const toggle = useCallback(() => setOpen((wasOpen) => !wasOpen), []);
  const close = useCallback(() => setOpen(false), []);
  const pick = useCallback(
    (value: T) => {
      setOpen(false);
      onPick(value);
    },
    [onPick],
  );

  return { open, toggle, close, pick };
}
```

- [ ] **Step 5: Create `src/components/ui/DockMenu.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Popup } from './Popup';
import { usePopupMenu } from './usePopupMenu';

/** The panel's box, the look the CSS-only dropdown's list wore. */
const DOCK_MENU_PANEL = 'mb-1 w-36 rounded-box bg-base-100 border border-base-300 p-1 shadow-lg';

const listId = (idPrefix: string) => `${idPrefix}-list`;

interface DockMenuListProps<T extends string> {
  options: readonly T[];
  current: T;
  /** The list is `${idPrefix}-list`; each item is `${idPrefix}-${option}`. */
  idPrefix: string;
  labels: Readonly<Record<T, string>>;
  titles?: Readonly<Record<T, string>>;
  onPick: (option: T) => void;
}

/**
 * A dock menu's items: one button per option, the current one marked. Not
 * `role="menu"` — that promises arrow-key navigation this list does not
 * have; Tab reaches each button, as it always has.
 */
export function DockMenuList<T extends string>({ options, current, idPrefix, labels, titles, onPick }: DockMenuListProps<T>) {
  return (
    <ul id={listId(idPrefix)} className="menu menu-sm w-full p-0">
      {options.map((option) => (
        <li key={option}>
          <button
            id={`${idPrefix}-${option}`}
            type="button"
            aria-current={current === option ? 'true' : undefined}
            onClick={() => onPick(option)}
            className={current === option ? 'active font-bold' : ''}
            title={titles?.[option]}
          >
            {labels[option]}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface DockMenuProps<T extends string> extends DockMenuListProps<T> {
  triggerId: string;
  triggerLabel: string;
  triggerTitle: string;
  triggerClassName: string;
  /** Locked: the trigger is disabled and an open menu shuts (R341's armed lock). */
  disabled?: boolean;
  /** The trigger's visible content. */
  children: ReactNode;
}

/**
 * A dock header menu (the target chip, the keyboard mode chip) on `ui/Popup`
 * (R328). It opens upward, over the dock, from the trigger's start edge, and
 * a pick closes it. The wrapper is `flex` so a trigger inside a `join` keeps
 * the group's height.
 */
export function DockMenu<T extends string>({
  triggerId,
  triggerLabel,
  triggerTitle,
  triggerClassName,
  disabled = false,
  children,
  onPick,
  ...list
}: DockMenuProps<T>) {
  const menu = usePopupMenu(onPick, disabled);
  return (
    <Popup
      open={menu.open}
      onClose={menu.close}
      align="start"
      side="top"
      className="flex"
      panelClassName={DOCK_MENU_PANEL}
      trigger={
        <button
          type="button"
          id={triggerId}
          aria-label={triggerLabel}
          aria-expanded={menu.open}
          aria-controls={listId(list.idPrefix)}
          disabled={disabled}
          onClick={menu.toggle}
          className={triggerClassName}
          title={triggerTitle}
        >
          {children}
        </button>
      }
    >
      <DockMenuList {...list} onPick={menu.pick} />
    </Popup>
  );
}
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `bun test src/components/ui/usePopupMenu.test.ts src/components/ui/DockMenu.test.tsx`
Expected: PASS. If the `DockMenuList` `<ul>` tag assertion fails on attribute order, check that the JSX lists `id` before `className` as above. React serialises props in JSX order.

- [ ] **Step 7: Rewrite the dock's item tests (they fail once the dock migrates)**

In `src/components/ui/BottomInputDock.test.tsx`, add these imports:

```ts
import { DockMenuList } from './DockMenu';
import { MIX_LAYER_LABELS } from '../mixLayers';
```

In `describe('the keyboard mode picker')`, replace the first two tests (`'is in the header both collapsed and open'` and `'marks exactly the current mode'`) with:

```tsx
  test('is in the header both collapsed and open, a closed <button> menu', () => {
    for (const isInputPanelOpen of [false, true]) {
      useAppStore.setState({ isInputPanelOpen });
      const html = render();
      const tag = openTagContaining(html, 'id="btn-keyboard-mode-chip"');
      expect(tag.startsWith('<button')).toBe(true);
      expect(tag).toContain('aria-label="Keyboard mode: Scale"');
      expect(tag).toContain('aria-expanded="false"');
      expect(tag).toContain('aria-controls="btn-keyboard-mode-list"');
      // Closed, Popup mounts no panel: the items exist only while open
      // (their markup is pinned on DockMenuList in DockMenu.test.tsx).
      expect(html).not.toContain('id="btn-keyboard-mode-chromatic"');
    }
  });

  test('the chip names the current mode and carries its title', () => {
    const html = renderToString(
      <BottomInputDock keyboardProps={{ ...keyboardProps, keyboardMode: 'chord' }} drumProps={drumProps} />,
    );
    const tag = openTagContaining(html, 'id="btn-keyboard-mode-chip"');
    expect(tag).toContain('aria-label="Keyboard mode: Chord"');
    expect(tag).toContain('title="Chord Mode: diatonic triads per scale degree, plus a melody zone"');
  });
```

In `describe('the dock target chip')`, replace `'the menu offers every track'` and `'exactly one item carries aria-current, matching the target'` with:

```tsx
  test('the menu offers every track', () => {
    const html = renderToString(
      <DockMenuList options={MIX_LAYER_IDS} current="synth" idPrefix="btn-focus-chip" labels={MIX_LAYER_LABELS} onPick={() => {}} />,
    );
    for (const id of MIX_LAYER_IDS) expect(html).toContain(`id="btn-focus-chip-${id}"`);
  });

  test('a pinned target names the chip, and the menu marks exactly that track', () => {
    useAppStore.setState({ focusTrack: 'synth', inputTargetPin: 'drum' });
    expect(openTagContaining(render(), 'id="btn-focus-chip"')).toContain('aria-label="Keys play Beat"');
    const html = renderToString(
      <DockMenuList options={MIX_LAYER_IDS} current="drum" idPrefix="btn-focus-chip" labels={MIX_LAYER_LABELS} onPick={() => {}} />,
    );
    const current = MIX_LAYER_IDS.filter((id) =>
      openTagContaining(html, `id="btn-focus-chip-${id}"`).includes('aria-current="true"'),
    );
    expect(current).toEqual(['drum']);
  });
```

Add a new describe after `describe('the dock target chip')`:

```tsx
describe('the dock menus on ui/Popup', () => {
  test('both triggers are real buttons, and nothing is focusable by hack', () => {
    const html = render();
    for (const id of ['btn-focus-chip', 'btn-keyboard-mode-chip']) {
      const tag = openTagContaining(html, `id="${id}"`);
      expect(tag.startsWith('<button')).toBe(true);
      expect(tag).toContain('aria-expanded="false"');
    }
    expect(html).not.toContain('role="button"');
    expect(html).not.toMatch(/<ul[^>]*tabindex/);
  });

  test('the target menu opens upward from a flex wrapper inside the joined group', () => {
    expect(render()).toContain(
      '<div id="input-target-group" class="join"><div class="dropdown dropdown-start dropdown-top flex"><button',
    );
  });
});
```

The existing `'armed: the chip and the link are disabled; disarmed they are not'` test stays as it is. It now matches the chip's `disabled=""` attribute.

- [ ] **Step 8: Run the dock tests to verify the new ones fail**

Run: `bun test src/components/ui/BottomInputDock.test.tsx`
Expected: FAIL. `the dock menus on ui/Popup` fails because the triggers are still `role="button"` `<div>`s, and the mode chip has no `aria-expanded`.

- [ ] **Step 9: Migrate `src/components/ui/BottomInputDock.tsx`**

Add `import { DockMenu } from './DockMenu';` beside the other `./` imports.

Delete the whole `/* DROPDOWN_TRIGGER_NOTE … */` comment block and the whole old `function DockMenu<T extends string>(…) { … }`, together with its JSDoc.

In `InputTargetGroup`, replace the comment above `return` (the one that ends "…which is what keeps daisyUI's dropdown shut.") with:

```tsx
  // Armed, the keys must play the armed track (the recorder writes every
  // performed note there), so both halves lock to the selection: the chip's
  // button is disabled, and a menu open at that moment shuts (usePopupMenu).
```

In the same function's JSX, replace the whole `<div className="dropdown dropdown-top flex"> … </div>` element (the trigger `<div role="button">` and the old `<DockMenu … />`) with:

```tsx
      <DockMenu
        triggerId="btn-focus-chip"
        triggerLabel={`Keys play ${MIX_LAYER_LABELS[target]}`}
        triggerTitle={isLocked ? LOCKED_TITLE : 'Which track the keys play'}
        triggerClassName={`btn btn-xs join-item gap-1 text-[11px] font-semibold ${style}${isLocked ? ' btn-disabled' : ''}`}
        disabled={isLocked}
        options={MIX_LAYER_IDS}
        current={target}
        idPrefix="btn-focus-chip"
        labels={MIX_LAYER_LABELS}
        onPick={onPick}
      >
        <span className="text-base-content/50 uppercase tracking-wider text-[9px]">On</span>
        <span>{MIX_LAYER_LABELS[target]}</span>
        <ChevronDown aria-hidden="true" className="w-3 h-3 opacity-60" />
      </DockMenu>
```

Replace the body of `KeyboardModePicker` (its `return (…)`) with:

```tsx
  return (
    <DockMenu
      triggerId="btn-keyboard-mode-chip"
      triggerLabel={`Keyboard mode: ${KEYBOARD_MODE_LABELS[keyboardMode]}`}
      triggerTitle={KEYBOARD_MODE_TITLES[keyboardMode]}
      triggerClassName={`btn btn-xs gap-1 text-[11px] font-semibold ${TOOLBAR_BUTTON_IDLE}`}
      options={KEYBOARD_MODES}
      current={keyboardMode}
      idPrefix="btn-keyboard-mode"
      labels={KEYBOARD_MODE_LABELS}
      titles={KEYBOARD_MODE_TITLES}
      onPick={onSelect}
    >
      <span>{KEYBOARD_MODE_LABELS[keyboardMode]}</span>
      <ChevronDown aria-hidden="true" className="w-3 h-3 opacity-60" />
    </DockMenu>
  );
```

In `InputTargetGroup`'s JSDoc, the sentence "A daisyUI dropdown rather than a cycling button" becomes "A menu (`ui/DockMenu`) rather than a cycling button". Leave the rest of the JSDoc alone.

- [ ] **Step 10: Run the dock tests to verify they pass**

Run: `bun test src/components/ui/BottomInputDock.test.tsx src/components/ui/DockMenu.test.tsx src/components/ui/usePopupMenu.test.ts`
Expected: PASS.

- [ ] **Step 11: Lint, type-check, dead code**

Run: `bun run lint && bun run eslint && bun run check:dead-code`
Expected: zero errors, zero warnings, zero Knip findings. `DockMenuList` has an importer in `DockMenu.test.tsx` and `BottomInputDock.test.tsx`, and `settledMenuOpen` in `usePopupMenu.test.ts`. Run `grep -n "no-noninteractive-tabindex\|blur()" src/components/ui/BottomInputDock.tsx`. It must print nothing, which means both hacks are gone.

- [ ] **Step 12: Commit**

```bash
git add src/components/ui/usePopupMenu.ts src/components/ui/usePopupMenu.test.ts src/components/ui/DockMenu.tsx src/components/ui/DockMenu.test.tsx src/components/ui/BottomInputDock.tsx src/components/ui/BottomInputDock.test.tsx
git commit -m "$(cat <<'EOF'
refactor(ui): move the dock target and keyboard-mode menus onto ui/Popup

Both chips become ui/DockMenu: a real <button> trigger with aria-expanded
and aria-controls, a Popup opening upward (side="top"), and a pick that
closes it. The role="button" spans, the focusable-list tabIndex and the
Safari blur() hack go. Open state lives in the shared usePopupMenu, which
shuts a menu whose trigger locks while it is open.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `ProjectMenu` on `ui/Popup`

The spec's §5. The mobile frame (`shell/MobileTopBar.tsx`) keeps `ProjectMenuSections` and `menu.choose`, and does not change.

**Files:**
- Modify: `src/components/project/ProjectMenu.tsx`: imports; a new `ProjectMenuTrigger` above `ProjectMenu`; `ProjectMenu` rewritten
- Test: `src/components/project/ProjectMenu.test.tsx`

**Interfaces:**
- Consumes: `Popup` (Task 1); `usePopupMenu<T>(onPick: (value: T) => void): UsePopupMenu<T>` (Task 3); `useProjectMenu(): UseProjectMenu`, `ProjectMenuSections`, `ProjectMenuEffects`, `visibleMenuSections(driveAvailable, driveSignedIn, sourceKind, driveUser)` (existing, unchanged).
- Produces: the trigger `<button id="btn-project-menu" aria-label="Project menu" aria-expanded aria-controls="project-menu-list">` and the list `<ul id="project-menu-list">`. No exported names change.

- [ ] **Step 1: Write the failing tests**

In `src/components/project/ProjectMenu.test.tsx`, add `ProjectMenuSections` to the `./ProjectMenu` import list. The three row tests that render `<ProjectMenu />` would fail, because a closed popup renders no rows. Replace them with tests that render the rows directly. Add this helper after `openTag`:

```tsx
/** The menu's rows as the popup panel renders them (a closed Popup renders none). */
function renderRows(...args: Parameters<typeof visibleMenuSections>): string {
  return renderToString(
    <ul>
      <ProjectMenuSections sections={visibleMenuSections(...args)} onChoose={() => {}} />
    </ul>,
  );
}
```

Replace `'renders Save actions without the removed Export action'`, `'renders "Save to Drive" when the project came from Drive'` and `'renders the account under the Drive heading on its own line'` with:

```tsx
  test('renders Save actions without the removed Export action', () => {
    const html = renderRows(true, false, 'untitled', null);
    expect(html).toContain('id="project-menu-save"');
    expect(html).toContain('id="project-menu-save-as"');
    expect(html).not.toContain('id="project-menu-export"');
    expect(html).not.toContain('Export .solna');
    expect(html).toContain('Open from Drive');
  });

  test('renders "Save to Drive" when the project came from Drive', () => {
    const html = renderRows(true, false, 'drive', null);
    expect(html).toContain('Save to Drive');
    expect(html).toContain('id="project-menu-save-as-drive"');
  });

  test('renders the account under the Drive heading on its own line', () => {
    const html = renderRows(true, false, 'untitled', { email: 'ann@example.com', name: 'Ann' });
    expect(html).toContain('ann@example.com');
    expect(html).toContain('block truncate');
  });
```

With these gone, `useAppStore` has no remaining use in this file. Delete `import { useAppStore } from '@/store/store';`.

Replace the whole `describe('ProjectMenu rendering', …)` block with:

```tsx
describe('ProjectMenu rendering', () => {
  // renderToString renders the popup closed, so the closed state is what is
  // pinned here: the trigger, no panel, and the effects outside the popup.
  test('renders a chevron <button> trigger that reports the menu closed', () => {
    const html = renderToString(<ProjectMenu />);
    const trigger = openTag(html, 'aria-label="Project menu"');
    expect(trigger.startsWith('<button')).toBe(true);
    expect(trigger).toContain('type="button"');
    expect(trigger).toContain('id="btn-project-menu"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain('aria-controls="project-menu-list"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('solna</span>'); // the wordmark is no longer inside the menu
  });

  test('closed, the Popup renders no panel and no rows', () => {
    const html = renderToString(<ProjectMenu />);
    expect(html.startsWith('<div class="dropdown dropdown-start"><button')).toBe(true);
    expect(html).not.toContain('dropdown-content');
    expect(html).not.toContain('id="project-menu-');
  });

  // A row that opens a dialog closes the menu in the same render. Inside the
  // panel, the dialog would unmount with it.
  test('the file input and the dialogs render beside the popup, not inside it', () => {
    const html = renderToString(<ProjectMenu />);
    expect(html).toContain('</button></div><input');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".solna,.json"');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/project/ProjectMenu.test.tsx`
Expected: FAIL. `ProjectMenu rendering` fails because the trigger is still a `<span role="button" tabindex="0">`, the closed markup still contains every row, and the input sits inside the wrapper `div`. The three row tests pass.

- [ ] **Step 3: Migrate `ProjectMenu`**

In `src/components/project/ProjectMenu.tsx`, add these beside the other `../ui/` imports:

```ts
import { Popup } from '../ui/Popup';
import { usePopupMenu } from '../ui/usePopupMenu';
```

Directly above `export function ProjectMenu()`, add:

```tsx
/** The panel's box: the look the CSS-only dropdown's list wore. */
const PROJECT_MENU_PANEL =
  'mt-2 min-w-44 max-w-[calc(100vw-2rem)] rounded-box bg-base-100 border border-base-300 p-1 shadow-lg';

/** The chevron that opens the menu: a real <button>, so a click toggles it in every browser. */
function ProjectMenuTrigger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      id="btn-project-menu"
      aria-label="Project menu"
      aria-expanded={open}
      aria-controls="project-menu-list"
      onClick={onToggle}
      className="inline-flex min-h-11 min-w-8 items-center justify-center rounded-box cursor-pointer transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <ChevronDown className="w-4 h-4 text-base-content/60" aria-hidden="true" />
    </button>
  );
}
```

Replace the whole `export function ProjectMenu() { … }` with:

```tsx
/**
 * The desktop project menu on `ui/Popup` (R328). Choosing a row closes the
 * menu, then runs the action: `Popup` hands focus back to the trigger as it
 * closes, and a dialog the action opens then takes it (`showModal`), handing
 * it back to the trigger when it closes. `ProjectMenuEffects` renders beside
 * the popup, never inside its panel, so the dialog outlives the menu.
 */
export function ProjectMenu() {
  const menu = useProjectMenu();
  const popup = usePopupMenu(menu.choose);
  return (
    <>
      <Popup
        open={popup.open}
        onClose={popup.close}
        align="start"
        panelClassName={PROJECT_MENU_PANEL}
        trigger={<ProjectMenuTrigger open={popup.open} onToggle={popup.toggle} />}
      >
        <ul id="project-menu-list" className="menu menu-sm w-full p-0">
          <ProjectMenuSections sections={menu.sections} onChoose={popup.pick} />
        </ul>
      </Popup>
      <ProjectMenuEffects menu={menu} />
    </>
  );
}
```

The old `<span role="button" tabIndex={0}>`, its `DROPDOWN_TRIGGER_NOTE` comment, and the `<ul tabIndex={0}>` with its `eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex` comment all go away with the old body.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/project/ProjectMenu.test.tsx src/components/Header.test.tsx src/components/shell`
Expected: PASS. If a header or shell test asserts the old `<span … role="button">` project trigger, update that assertion to the `<button` form above in the same step. Never delete it without a replacement.

- [ ] **Step 5: Lint, type-check, dead code**

Run: `bun run lint && bun run eslint && bun run check:dead-code`
Expected: zero errors, zero warnings, zero findings. Run `grep -n "DROPDOWN_TRIGGER_NOTE\|no-noninteractive-tabindex" src/components/project/ProjectMenu.tsx src/components/ui/BottomInputDock.tsx`. It must print nothing.

- [ ] **Step 6: Commit**

```bash
git add src/components/project/ProjectMenu.tsx src/components/project/ProjectMenu.test.tsx
git commit -m "$(cat <<'EOF'
refactor(project): move the project menu onto ui/Popup

The trigger is a real <button> with aria-expanded; choosing a row closes
the menu, then runs the action, so a dialog it opens takes focus after
Popup hands it back. ProjectMenuEffects renders beside the popup so the
dialog outlives the menu. The focusable-list tabIndex and its eslint
disable go.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `QuickSavePopover` on `ui/Popup`

The spec's §6 and §7.

**Files:**
- Modify: `src/components/ui/useQuickSavePopover.ts` (whole file)
- Modify: `src/components/ui/QuickSavePopover.tsx` (`QuickSavePanel` and `QuickSavePopover`)
- Modify: `src/components/ui/popupGeometry.ts` (the header comment only)
- Test: `src/components/ui/QuickSavePopover.test.tsx`

**Interfaces:**
- Consumes: `Popup` (Task 1).
- Produces: `export interface UseQuickSavePopover { inputRef: RefObject<HTMLInputElement | null> }` and `export function useQuickSavePopover(open: boolean): UseQuickSavePopover`. The props of `QuickSavePopover` do not change, so its three callers (`loop/ChordView.tsx`, `loop/SoundSynthSection.tsx`, `loop/beat/BeatSoundSection.tsx`) are untouched.

- [ ] **Step 1: Write the failing tests**

In `src/components/ui/QuickSavePopover.test.tsx`, add `import { readFileSync } from 'node:fs';` at the top, and add these tests inside the `describe`:

```tsx
  test('the panel is Popup’s: pointer-focusable only, hanging from the trigger’s end edge', () => {
    const html = renderToString(<QuickSavePopover {...base} open={true} />);
    expect(html).toContain('<div class="dropdown dropdown-end dropdown-open">');
    expect(html).toContain('<div tabindex="-1" class="dropdown-content z-50 outline-none mt-2 w-80');
    expect(html).toContain('<div role="dialog" aria-label="Save Custom Preset:">');
  });

  /**
   * Popup's focus effect (a child's, so it runs first) records the trigger,
   * then focuses the name input; the hook's effect only selects the text. A
   * hook that focused the input itself would make Popup record the input,
   * and closing would leave focus there instead of on the trigger.
   */
  test('useQuickSavePopover selects the text but never moves focus itself', () => {
    const source = readFileSync(new URL('./useQuickSavePopover.ts', import.meta.url), 'utf8');
    expect(source).toContain('.select()');
    expect(source).not.toContain('.focus(');
    expect(source).not.toContain('addEventListener');
  });
```

The existing tests stay. `'closed renders only the trigger button, no panel'` already covers the spec's "closed renders no panel".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/ui/QuickSavePopover.test.tsx`
Expected: FAIL. The panel has no `tabindex="-1"` and carries `role="dialog"` itself, and the hook source contains `.focus(` and `addEventListener`.

- [ ] **Step 3: Rewrite `src/components/ui/useQuickSavePopover.ts`**

```ts
import { useEffect, useRef, type RefObject } from 'react';

export interface UseQuickSavePopover {
  /** The name input: `Popup`'s `initialFocusRef`, and the text selected on open. */
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * What `ui/Popup` does not do for the quick-save popover: select the name's
 * text on open, so typing replaces it. `Popup` moves focus to the input from
 * its own effect, which runs first because `Popup` is a child; this hook only
 * selects, so `Popup` still records the trigger as the place focus returns to.
 */
export function useQuickSavePopover(open: boolean): UseQuickSavePopover {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);
  return { inputRef };
}
```

- [ ] **Step 4: Move `QuickSavePopover` onto `Popup`**

In `src/components/ui/QuickSavePopover.tsx`, add `import { Popup } from "./Popup";` below the `useQuickSavePopover` import. Then add this constant below the imports:

```tsx
/** The panel's box, the look the hand-rolled dropdown's panel wore. */
const QUICK_SAVE_PANEL =
  "mt-2 w-80 max-w-[calc(100vw-1rem)] card bg-base-100 border border-primary/40 p-3.5 shadow-xl animate-fade-in";
```

In `QuickSavePanel`, remove the `panelRef` and `shift` parameters and their types from the `& { … }` intersection, keeping only `inputRef`. Replace its outer `<div ref={panelRef} role="dialog" … className="dropdown-content …">` with a plain dialog wrapper, because `Popup` now owns the panel box:

```tsx
    <div role="dialog" aria-label={heading}>
```

Leave the inner header row and the `<form>` exactly as they are.

Replace the body of `QuickSavePopover` (from `const { wrapperRef, … } = useQuickSavePopover(open, onClose);` to the end of its `return`) with:

```tsx
  const { inputRef } = useQuickSavePopover(open);

  return (
    <Popup
      open={open}
      onClose={onClose}
      align="end"
      panelClassName={QUICK_SAVE_PANEL}
      initialFocusRef={inputRef}
      trigger={<QuickSaveTriggerButton trigger={trigger} open={open} onOpen={onOpen} onClose={onClose} />}
    >
      <QuickSavePanel
        inputRef={inputRef}
        heading={heading}
        placeholder={placeholder}
        saveLabel={saveLabel}
        name={name}
        onNameChange={onNameChange}
        onSubmit={onSubmit}
        categories={categories}
        category={category}
        onCategoryChange={onCategoryChange}
        onClose={onClose}
      />
    </Popup>
  );
```

The daisyUI `card` is `flex-direction: column`, and its one child (the `role="dialog"` div) stretches to the card's width, so the look does not change. Tab-away now closes the popover through `Popup`'s focusout. That is the spec's one new behaviour.

- [ ] **Step 5: Update the `popupGeometry.ts` header comment**

In `src/components/ui/popupGeometry.ts`, replace the first comment's last line:

```ts
 * it; `usePopup.ts` and `useQuickSavePopover.ts` wire it to real events.
```

with:

```ts
 * it; `usePopup.ts`, behind every popup, wires it to real events.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/components/ui/QuickSavePopover.test.tsx src/components/ui/popupGeometry.test.ts src/components/loop`
Expected: PASS.

- [ ] **Step 7: Lint, type-check, dead code**

Run: `bun run lint && bun run eslint && bun run check:dead-code && bun run check:dead-code:production`
Expected: zero errors, zero warnings, zero findings. `UseQuickSavePopover` now has one field, `inputRef`, which is used. `panelNaturalRect`, `popupShift` and `isDismissKey` are still imported by `usePopup.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/useQuickSavePopover.ts src/components/ui/QuickSavePopover.tsx src/components/ui/QuickSavePopover.test.tsx src/components/ui/popupGeometry.ts
git commit -m "$(cat <<'EOF'
refactor(ui): move the quick-save popover onto ui/Popup

Popup now owns its dismissal, focus return and viewport shift; the hook
keeps only inputRef and selects the name's text on open, after Popup's
own effect has focused it. Tabbing out of the popover now closes it, as
every other popup does.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rules, ADR-0056 and the ADR index

The spec's "Docs and rules". The memory file `scale-select-followups.md` is not in the repo. The main session updates it, and this plan does not touch it.

**Files:**
- Modify: `.claude/rules/components.md` (R328 bullet; the ADR pointer paragraph under the overlay bullets; the Prohibited list)
- Create: `docs/decisions/0056-popup-migration-complete.md`
- Modify: `docs/decisions/README.md` (index row after 0055)
- Modify: `docs/decisions/0055-shared-popup-and-listbox.md` (Status line only)

**Interfaces:**
- Consumes: the code from Tasks 1–5.
- Produces: none (docs).

- [ ] **Step 1: Amend R328 in `.claude/rules/components.md`**

In the R328 bullet, replace:

```
- A popup is built on `ui/Popup` (its hook `ui/usePopup.ts`): a daisyUI `dropdown` anchored to
  its trigger (`dropdown-open` while open), kept inside the viewport horizontally by `popupShift`
```

with:

```
- A popup is built on `ui/Popup` (its hook `ui/usePopup.ts`): a daisyUI `dropdown` anchored to
  its trigger (`dropdown-open` while open), opening below it or, with `side="top"`, above it, kept inside the viewport horizontally by `popupShift`
```

In the same bullet, delete this sentence:

```
Not yet on
  `ui/Popup` (sub-project 3 of ADR-0055): the two `DockMenu`s in `ui/BottomInputDock.tsx`,
  `project/ProjectMenu.tsx` and `ui/QuickSavePopover.tsx`.
```

The sentence before it then runs on as "…while the browser floor lacks them. The one exception is a popup that must sit above an open `Modal`…".

In the paragraph that closes the overlay bullets, replace:

```
[ADR-0055](../../docs/decisions/0055-shared-popup-and-listbox.md))
```

with:

```
[ADR-0055](../../docs/decisions/0055-shared-popup-and-listbox.md); every popup on it:
[ADR-0056](../../docs/decisions/0056-popup-migration-complete.md))
```

- [ ] **Step 2: Add the Prohibited line**

In `## Prohibited`, directly after the line that ends ``or a `<details>` used as a popup <!-- R328 -->``, add:

```
- A `:focus-within` dropdown (daisyUI's CSS-only open state) as a popup <!-- R328 -->
```

- [ ] **Step 3: Write `docs/decisions/0056-popup-migration-complete.md`**

```markdown
# ADR-0056: Every popup on ui/Popup

**Status:** Accepted — 2026-09-26. Completes sub-project 3 of [ADR-0055](0055-shared-popup-and-listbox.md) (R328). No issue.

## Context

ADR-0055 introduced `ui/Popup` and moved the header scale menus onto it, but three popups still
dismissed and returned focus in other ways. The two dock menus (the target chip and the keyboard
mode chip) and the project menu were daisyUI CSS-only dropdowns. They opened on `:focus-within`,
so they needed a focusable `role="button"` span (Safari never focuses a tapped `<button>`), a
focusable `<ul tabIndex={0}>` under an eslint-disable, and a `blur()` after a pick. The quick-save
popover had its own hook with a second copy of the Escape, outside-click, focus-return and shift
code.

## Decision

- **All four popups use `ui/Popup`.** The dock menus are `ui/DockMenu`, and they and the project
  menu keep their open state in `ui/usePopupMenu`. Picking a row closes the menu, then runs the
  row. `useQuickSavePopover` now only selects the name's text on open.
- **The triggers are real `<button>`s** with `aria-expanded` and `aria-controls`. A click on a
  button toggles controlled state whether or not Safari focuses it, so the reason for the span
  is gone.
- **`usePopup` reads `onClose` through a latest-ref.** No effect depends on it, so a caller may
  pass an inline arrow. A focus effect that re-ran on a new `onClose` would, on every parent
  re-render, send focus back to the trigger and refocus the input.
- **The outside `pointerdown` listens in the capture phase**, so an outside handler that stops
  propagation (a span-resize handle) cannot keep a popup open. Escape stays in the bubble phase,
  so a focused control inside the panel sees it first.
- **`Popup` gains `side`** (`'top'` is daisyUI `dropdown-top`, for the dock) and a wrapper
  `className` (a dock chip inside a `join` needs a `flex` wrapper to keep the group's height).
- **The panel is `tabIndex={-1}`** with no focus ring. A pointerdown on its padding, or in Safari
  on a `<button>`, leaves focus inside the wrapper instead of on `<body>`. It is not in the tab
  order.
- **Tabbing out of the quick-save popover now closes it**, as every other popup does. Before, only
  Escape and an outside click did.
- **No `role="menu"`.** It promises arrow-key navigation these lists do not have. Rows stay
  `<li><button>`, reached by Tab.
- **ADR-0055's sub-project 4 is dropped.** `settings/ThemePicker` stays as it is: it is a
  `role="radiogroup"`, not a listbox, so R357 does not reach it. It paints each row in its own
  theme and puts the System row and the Dark/Light tabs above the list, and neither fits
  `Listbox`'s group model. Moving it would grow `Listbox` for one caller, and the only gain would
  be arrow keys and type-ahead.

Rejected: keeping the CSS-only dropdowns and fixing their Safari handling in place. That kept three
dismissal mechanisms, and focus return stayed missing in two of them.

## Consequences

- One hook handles dismissal, focus return and placement for every popup. A fix there reaches
  all of them.
- A `:focus-within` dropdown is now prohibited as a popup (R328).
- Firefox and Safari behaviour, including the Space-keyup-after-commit check left from ADR-0055,
  is checked by hand. The in-app preview is Chromium.

## Rules this implies

- **R328** (amended): a popup opens below its trigger or, with `side="top"`, above it; no popup
  is exempt from `ui/Popup` except the top-layer-escape case; a `:focus-within` dropdown is
  prohibited as a popup.

## Sources

Spec `docs/superpowers/specs/2026-09-26-shared-popup-migration-design.md`; plan
`docs/superpowers/plans/2026-09-26-shared-popup-migration.md`; branch
`refactor/shared-popup-migration`.
```

- [ ] **Step 4: Add the index row and the ADR-0055 pointer**

In `docs/decisions/README.md`, add directly after the `| [0055](…) |` row:

```
| [0056](0056-popup-migration-complete.md) | Every popup on ui/Popup | The dock menus, the project menu and quick-save move onto `ui/Popup`; `usePopup` reads `onClose` through a latest-ref and hears an outside pointerdown in capture; `Popup` gains `side` and a `tabIndex={-1}` panel; no `role="menu"`; ThemePicker's move dropped; amends R328. |
```

In `docs/decisions/0055-shared-popup-and-listbox.md`, change only the Status line:

```
**Status:** Accepted — 2026-09-26. Amends [ADR-0044](0044-secondary-canvas-taxonomy.md) (R327, R328). No issue.
```

to:

```
**Status:** Accepted — 2026-09-26. Amends [ADR-0044](0044-secondary-canvas-taxonomy.md) (R327, R328). No issue. Sub-project 3 completed, sub-project 4 dropped: [ADR-0056](0056-popup-migration-complete.md).
```

- [ ] **Step 5: Check the docs**

Run: `grep -n "sub-project 3\|Not yet on" .claude/rules/components.md; grep -c "0056" docs/decisions/README.md docs/decisions/0055-shared-popup-and-listbox.md .claude/rules/components.md`
Expected: the first grep prints nothing, and each file reports a count of `1`: the index row, the Status line, and the rules file's pointer paragraph.

Run: `bun test` (the full suite, because some doc-link tests may scan `docs/decisions/`).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude/rules/components.md docs/decisions/0056-popup-migration-complete.md docs/decisions/README.md docs/decisions/0055-shared-popup-and-listbox.md
git commit -m "$(cat <<'EOF'
docs(rules): R328 covers every popup; ADR-0056 records the migration

R328 drops its not-yet-migrated list, names side="top", and prohibits a
:focus-within dropdown as a popup. ADR-0056 records the migration, the
latest-ref and capture-phase changes, the tabIndex=-1 panel, Tab-away
closing quick-save, no role="menu", and ThemePicker's move dropped.
ADR-0055 gains a Status-line pointer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Browser verification and the full gate

The spec's browser checks, in the in-app preview (Chromium). Write the evidence to `work/browser-evidence.md`, which is gitignored. Overwrite it; do not append a history. The note holds the objective, the decisive selectors and snippets, what each check observed, and a pass/fail per check. Query elements with focused `preview_eval` snippets rather than full DOM snapshots or screenshots.

**Files:**
- Create/overwrite: `work/browser-evidence.md` (not committed)
- Modify: only what a failing check proves wrong. Such a fix goes back to the task that owns the file, gets a failing test first where one is possible, and gets its own commit.

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: none.

- [ ] **Step 1: Start the app**

Start the preview with the `solna-dev` configuration in `.claude/launch.json` (`bun run dev`, port 3000). Click once anywhere in the app first, because the `AudioContext` starts on the first click.

- [ ] **Step 2: Dock menus at 375px and at desktop (1280px)**

Run each check below at both widths. First set the input target to a non-drum track so the mode chip shows. `menuOpen` is `(id) => !!document.getElementById(id)`.

1. Click `#btn-focus-chip`. The list opens **upward**: `document.getElementById('btn-focus-chip-list').getBoundingClientRect().bottom <= document.getElementById('btn-focus-chip').getBoundingClientRect().top + 1`, and `aria-expanded` is `"true"`.
2. Click `#btn-focus-chip-lead`. The chip then reads Lead, `menuOpen('btn-focus-chip-list')` is `false`, and `document.activeElement.id` is `btn-focus-chip`.
3. Reopen it and press Escape. It closes and focus is on the chip.
4. Reopen it and click (tap) the page header. It closes.
5. Reopen it, Tab to the last item, and press Tab again. It closes, and focus stays where Tab sent it.
6. Reopen it and press Shift+Tab from the first item. Focus goes back to the chip and the menu **stays open**.
7. Run steps 1–5 again on `#btn-keyboard-mode-chip` / `#btn-keyboard-mode-list` (pick `#btn-keyboard-mode-chord`).
8. Arm recording on a melody track. `#btn-focus-chip` has the `disabled` attribute, and clicking it opens nothing. Disarm it, and the menu is still closed.

- [ ] **Step 3: Capture phase**

With `#btn-focus-chip` open, run:

```js
const d = document.createElement('div');
document.body.append(d);
d.addEventListener('pointerdown', (e) => e.stopPropagation());
d.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
const open = !!document.getElementById('btn-focus-chip-list');
d.remove();
open;
```

Expected: `false`. An outside handler that stops propagation no longer keeps the popup open. The spec's Testing bullet words this as "a popup stays open when…", which contradicts its §1. This plan follows §1: the popup closes.

- [ ] **Step 4: ProjectMenu (desktop width)**

1. Click `#btn-project-menu`. `#project-menu-list` exists, and `aria-expanded` is `"true"`.
2. Click `#project-menu-new`. The list is gone, a confirm `<dialog>` is open, and `document.activeElement.closest('dialog') !== null`.
3. Press Escape, or click the dialog's Cancel. `document.activeElement.id` is `btn-project-menu`.
4. Reopen the menu and Tab past the last row. It closes.

- [ ] **Step 5: QuickSave**

On the Sound tab, click `#btn-quick-save-preset`.

1. `document.activeElement.tagName === 'INPUT'`, and `activeElement.selectionStart === 0 && activeElement.selectionEnd === activeElement.value.length`.
2. Type `abc`. The value ends in `abc` and focus is still in the input. This is Review Focus 1: no re-render may reselect or refocus.
3. Tab to Cancel, to Save, then once more. The popover closes.
4. Reopen it and press Escape. It closes and `document.activeElement.id` is `btn-quick-save-preset`.
5. Repeat check 1 on `#btn-beat-quick-save` (Beat sound) and `#btn-quick-save-chord-progression` (Pattern → Accompaniment).

- [ ] **Step 6: Console**

Read the preview's console logs. Expected: no errors and no warnings. Handle any warning under the repo's warning rule: fix it, or suppress it at the narrowest scope with a reason. Record the decision in the evidence note.

- [ ] **Step 7: Write the evidence note**

Overwrite `work/browser-evidence.md` with the objective, one line per check above (the selector or snippet, the observed value, and pass or fail), and the console result. Also list what this preview cannot check, which the user checks by hand: Firefox and Safari, all of the above, and the Space-keyup-after-commit check left from ADR-0055.

- [ ] **Step 8: Run the full gate**

Run: `bun run verify`
Expected: all tests, static and domain checks, both dead-code scans and the production build pass.

Run: `bun run eslint`
Expected: zero errors and zero warnings.

Run: `git status --short`
Expected: a clean tree apart from `?? .ux-assessment/`. `work/` is gitignored and never staged.

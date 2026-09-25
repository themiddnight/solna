# Scale-Type Listbox (shared Popup and Listbox primitives) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the header's native Scale Type `<select>` with a murva-style listbox (name, one-line description, category groups, a check on the selected scale), built from two new shared primitives, `ui/Popup` and `ui/Listbox`, and move the compact `<details>` scale menu onto `ui/Popup`.

**Architecture:** Three layers. `ui/Popup` + `ui/usePopup` is a controlled daisyUI `dropdown` shell (Escape, outside pointerdown and focus-leave dismissal, focus handoff, viewport shift via the pure helpers in `ui/popupGeometry.ts`). `ui/Listbox` + `ui/useListbox` is an `aria-activedescendant` listbox whose keys go through the pure `listboxKey` in `ui/listboxKeys.ts`; arrows only move the highlight, and Enter, Space or a click commits. `header/ScaleTypeListbox` composes them at `xl` and up. Below `xl`, `header/ScaleMenu` puts the native root select and an inline `Listbox` in a `Popup` panel.

**Tech Stack:** Bun (test runner), TypeScript, React 19 (`ref` as a prop; `renderToString` tests), Tailwind v4 + daisyUI v5, lucide-react, ESLint (jsx-a11y at error), Knip.

**Spec:** `docs/superpowers/specs/2026-09-26-scale-type-listbox-design.md` (binding). Read it before Task 1.

## Global Constraints

- Tests are `bun:test`. There is no DOM and no testing-library, and none may be added (`.claude/rules/testing.md`). Test pure functions, or render with `renderToString` and assert on literal substrings.
- The `renderToString` zustand trap (R257): a rendered component reads creation-time store state. Assert against `useAppStore.getInitialState()`, and never `setState` before a render expecting it to show.
- A component's `useState`/`useCallback`/`useEffect`/handlers live in a colocated `useXxx` hook (R265). The hook's return type is named and exported as `UseXxx` (R266). Child components are defined above the root in the same file (R267).
- `bun run eslint` reports **zero errors and zero warnings** (R005, R264). A warning is either fixed or line-disabled with `// eslint-disable-next-line <rule> -- <reason>`; a rule is never relaxed. `max-lines-per-function` is 100 (blank lines and comments skipped). It applies to components, hooks **and test `describe` callbacks**. `complexity` warns above 20.
- Both Knip scans hold zero findings (R006). Every new value export must have an importer; a test import counts for `check:dead-code`. `check:dead-code:production` flags a file unreachable from `src/main.tsx`, so the new `ui/` files from Tasks 2–4 show as unused files until Task 6 wires them in. Run the full `bun run verify` only from Task 6 on.
- No new dependencies.
- No popover API and no CSS anchor positioning (R328). Popup panels sit at `z-50` (R331); no new z-index.
- daisyUI classes are limited to `dropdown`, `dropdown-start`, `dropdown-end`, `dropdown-open` and `dropdown-content`, each verified in the installed `node_modules/daisyui/components/dropdown.css`. Write each as a **literal string**, never `` `dropdown-${align}` ``, because Tailwind only emits classes it finds verbatim. Rows, headings and triggers are plain Tailwind with theme tokens only: no hex, palette colours or `dark:` (`check:theme`).
- Option ids come from the flat index (`${id}-opt-${i}`), never from the value, because scale keys contain spaces.
- Commit is explicit. Arrows, Home/End, type-ahead and hover only move the highlight. A value commits only on Enter, Space or click, because `setScaleType` re-renders the app and can reharmonize.
- The root note stays a native `<select>` everywhere. `song/KeyChangeDialog` stays native, because a pick inside a `Modal` stays native.
- A description is `text-xs text-base-content/70` (murva's `/45` fails this repo's AA floor). Descriptions wrap and never truncate.
- Rules files, ADRs and skills record no version numbers, file counts or line numbers (R001). A rule change updates its rules file **and** its ADR in the same commit.
- Commit on `feat/scale-type-listbox` with a conventional message whose last line is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` explicit paths only; never add `.ux-assessment/`. Never push. There is no Linear issue.
- Code, comments and docs are in English.

## Review Focus

1. **A `focusout` whose `relatedTarget` is `null` must leave the popup open.** It fires when Safari focuses nothing on a click in the panel, on a click on panel padding, and when the compact panel's native root `<select>` hands off to its OS picker on a phone. Only focus that moves to a node outside the wrapper closes it. Pinned by the `isOutside` tests in Task 3.
2. **Space always commits and is never type-ahead.** `e.key` is `' '`, a single printable character, so a naive type-ahead branch would swallow it. A Ctrl/Meta/Alt chord (Cmd+R, Ctrl+F) is left to the browser, never type-ahead. Pinned in Task 2.
3. **Committing the already-selected scale writes nothing.** A native select fires no change event for it. `setScaleType` would still run `changeKey` and a store `set()` for nothing. Pinned by the `commitScaleType` tests in Task 6.
4. **A `value` that is not among the options** (a stale persisted key) renders no `aria-selected="true"`, highlights option 0 and throws nothing. An empty list renders no `aria-activedescendant`. Pinned in Task 4 (`activeForValue` and the render tests).
5. **Clicking the trigger while open closes it, and never closes then reopens it.** The pointerdown is inside the wrapper, so the outside-close must not fire, and the trigger's own click toggles it shut. Enter on the xl trigger opens it once, with no synthetic click toggling it back. No trigger may carry `tabindex`, because daisyUI gives `.dropdown-open > [tabindex]:first-child` `pointer-events: none`, and the click would then fall through to whatever lies beneath. Pinned by `isOutside` in Task 3 and the no-`tabindex` test in Task 6.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/components/ui/popupGeometry.ts` (new) | Pure: `isDismissKey`, `popupShift`, `panelNaturalRect` (moved); `isOutside` (T3) | 1, 3 |
| `src/components/ui/popupGeometry.test.ts` (new) | Moved geometry/dismiss tests; `isOutside` tests | 1, 3 |
| `src/components/ui/useQuickSavePopover.ts` | Imports the helpers instead of defining them | 1 |
| `src/components/ui/QuickSavePopover.tsx` | Drops the re-export line | 1 |
| `src/components/ui/QuickSavePopover.test.tsx` | Loses the three moved `describe` blocks | 1 |
| `src/components/ui/listboxKeys.ts` (new) | Pure: `listboxKey`, `isOpenKey`, `isCommandChord` | 2 |
| `src/components/ui/listboxKeys.test.ts` (new) | Every key case | 2 |
| `src/components/ui/usePopup.ts` (new) | `usePopup` → `UsePopup` | 3 |
| `src/components/ui/Popup.tsx` (new) | The controlled dropdown shell | 3 |
| `src/components/ui/Popup.test.tsx` (new) | Closed/open/align markup | 3 |
| `src/components/ui/useListbox.ts` (new) | `useListbox` → `UseListbox`; pure `indexGroups`, `optionId`, `groupHeadingId`, `activeForValue`, `parseOptionIndex` | 4 |
| `src/components/ui/useListbox.test.ts` (new) | The pure helpers | 4 |
| `src/components/ui/Listbox.tsx` (new) | `Listbox`, `ListboxOption`, `ListboxGroup` | 4 |
| `src/components/ui/Listbox.test.tsx` (new) | Rendered ARIA and visuals | 4 |
| `src/components/ui/scaleGroups.ts` (new) | `SCALE_GROUPS` | 5 |
| `src/components/ui/scaleGroups.test.ts` (new) | Order, completeness, no duplicates | 5 |
| `src/components/ui/ScaleTypeOptions.tsx` → `src/components/song/ScaleTypeOptions.tsx` | Uses `SCALE_GROUPS` (T5); moves to `song/`, its only consumer (T6, R276) | 5, 6 |
| `src/components/ui/ScaleTypeOptions.test.tsx` → `src/components/song/ScaleTypeOptions.test.tsx` | Moves with it | 6 |
| `src/components/song/KeyChangeDialog.tsx` | Import path only | 6 |
| `src/components/header/useScaleTypeListbox.ts` (new) | `useScaleTypeListbox` → `UseScaleTypeListbox`; pure `commitScaleType` | 6 |
| `src/components/header/ScaleTypeListbox.tsx` (new) | `SCALE_LISTBOX_GROUPS`, the xl trigger + `Popup` + `Listbox` | 6 |
| `src/components/header/useScaleMenu.ts` (new) | `useScaleMenu` → `UseScaleMenu` | 6 |
| `src/components/header/ScaleMenu.tsx` | `RootSelect`, compact trigger, `ScaleMenuPanel`, `ScaleMenu` on `Popup` | 6 |
| `src/components/Header.test.tsx` | Key-picker block rewritten; scale-type tests | 6 |
| `.claude/rules/components.md` | R327, R328 amended; R357 new; Prohibited lines | 7 |
| `docs/decisions/0055-shared-popup-and-listbox.md` (new) | The ADR | 7 |
| `docs/decisions/README.md` | Index row | 7 |
| `docs/decisions/0044-secondary-canvas-taxonomy.md`, `docs/decisions/0051-theme-picker.md` | Status-line pointer only | 7 |
| `.claude/skills/music-theory/SKILL.md` | The picker line | 7 |

---

### Task 1: Move the popup helpers into `ui/popupGeometry.ts`

A pure refactor with no behaviour change. `QuickSavePopover` is **not** migrated (that is sub-project 3).

**Files:**
- Create: `src/components/ui/popupGeometry.ts`
- Create: `src/components/ui/popupGeometry.test.ts`
- Modify: `src/components/ui/useQuickSavePopover.ts` (delete the three functions at the top; add one import)
- Modify: `src/components/ui/QuickSavePopover.tsx` (delete the re-export line)
- Modify: `src/components/ui/QuickSavePopover.test.tsx` (import line; delete the three trailing `describe` blocks)

**Interfaces:**
- Consumes: nothing.
- Produces (in `src/components/ui/popupGeometry.ts`):
  - `isDismissKey(e: Pick<KeyboardEvent, 'key'>): boolean`
  - `popupShift(panel: { left: number; right: number }, viewportWidth: number, margin?: number): number`
  - `panelNaturalRect(wrapperLeft: number, panel: { offsetLeft: number; offsetWidth: number }): { left: number; right: number }`

- [ ] **Step 1: Write the moved tests in their new home**

Create `src/components/ui/popupGeometry.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { isDismissKey, panelNaturalRect, popupShift } from './popupGeometry';

describe('isDismissKey', () => {
  test('Escape dismisses; nothing else does', () => {
    expect(isDismissKey({ key: 'Escape' })).toBe(true);
    expect(isDismissKey({ key: 'Enter' })).toBe(false);
    expect(isDismissKey({ key: 'Esc' })).toBe(false);   // the IE spelling is not a browser we ship to
    expect(isDismissKey({ key: 'a' })).toBe(false);
  });
});

describe('popupShift', () => {
  test('a panel that already fits needs no shift', () => {
    expect(popupShift({ left: 100, right: 300 }, 500)).toBe(0);
  });

  test('a panel overflowing the left edge shifts right by the overhang plus margin', () => {
    expect(popupShift({ left: -20, right: 200 }, 500, 8)).toBe(28);
  });

  test('a panel overflowing the right edge shifts left by the overhang plus margin', () => {
    expect(popupShift({ left: 400, right: 600 }, 500, 8)).toBe(-108);
  });

  test('a panel wider than the viewport pins its left edge to the margin', () => {
    // width (650) exceeds viewportWidth - 2*margin (484): pin left to 8,
    // rather than try (and fail) to also satisfy the right edge.
    expect(popupShift({ left: -50, right: 600 }, 500, 8)).toBe(58);
  });
});

describe('panelNaturalRect', () => {
  test('adds the wrapper origin to the panel offset box', () => {
    expect(panelNaturalRect(120, { offsetLeft: 0, offsetWidth: 200 })).toEqual({
      left: 120,
      right: 320,
    });
  });

  test('measuring is idempotent: applying the computed shift never changes the natural rect', () => {
    // offsetLeft/offsetWidth are box-model values, so unlike
    // getBoundingClientRect() they never move once our own translateX(shift)
    // is applied to the panel, nor while daisyUI's open-transition scale is
    // still animating — the same inputs are read every time.
    const wrapperLeft = 400;
    const panel = { offsetLeft: 0, offsetWidth: 200 }; // overflows the right edge at vw 500
    const viewportWidth = 500;

    const firstNatural = panelNaturalRect(wrapperLeft, panel);
    const firstShift = popupShift(firstNatural, viewportWidth);
    expect(firstShift).not.toBe(0);

    // "Apply" firstShift (as the translateX style) and measure again from
    // the same untransformed box-model inputs.
    const secondNatural = panelNaturalRect(wrapperLeft, panel);
    const secondShift = popupShift(secondNatural, viewportWidth);

    expect(secondNatural).toEqual(firstNatural);
    expect(secondShift).toBe(firstShift);
  });

  test('a resize with no geometry change reports the same shift, never flipping to 0', () => {
    const wrapperLeft = 400;
    const panel = { offsetLeft: 0, offsetWidth: 200 };
    const measure = () => popupShift(panelNaturalRect(wrapperLeft, panel), 500);

    const beforeResize = measure();
    const afterResize = measure(); // simulated resize event, same geometry
    expect(afterResize).toBe(beforeResize);
    expect(afterResize).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./src/components/ui/popupGeometry.test.ts`
Expected: FAIL, with an error that `./popupGeometry` cannot be resolved.

- [ ] **Step 3: Create `src/components/ui/popupGeometry.ts`**

```ts
/**
 * The pure half of a popup: which key dismisses it and where its panel sits.
 * Kept free of React and the DOM so this runner, which has no DOM, can test
 * it; `usePopup.ts` and `useQuickSavePopover.ts` wire it to real events.
 */

/**
 * Escape dismisses a popup. Exported because the key rule is the only part
 * of the dismissal that can be tested here — this runner has no DOM, so the
 * listener that calls it cannot be exercised.
 */
export function isDismissKey(e: Pick<KeyboardEvent, 'key'>): boolean {
  return e.key === 'Escape';
}

/**
 * Keeps the anchored panel inside the viewport horizontally (R328). `panel`
 * is the measured `left`/`right` of the rendered `dropdown-content` (its
 * natural position, anchored under the trigger); the return value is the
 * `translateX` (px) that pulls it back on screen. A panel wider than the
 * viewport cannot satisfy both edges, so it pins its left edge to `margin`
 * rather than split the overflow between the two.
 */
export function popupShift(
  panel: { left: number; right: number },
  viewportWidth: number,
  margin = 8,
): number {
  const width = panel.right - panel.left;
  if (width > viewportWidth - margin * 2) {
    return margin - panel.left;
  }
  if (panel.left < margin) {
    return margin - panel.left;
  }
  if (panel.right > viewportWidth - margin) {
    return viewportWidth - margin - panel.right;
  }
  return 0;
}

/**
 * The panel's viewport-relative position **before** any shift is applied to
 * it. `offsetLeft`/`offsetWidth` are box-model properties: unlike
 * `getBoundingClientRect()` they ignore `transform` entirely, so they read
 * the same natural position whether or not our own `translateX(shift)` is
 * currently applied, and whether or not daisyUI's `@starting-style`
 * `scale(.95)` open transition is still mid-flight. That makes measurement
 * idempotent — measuring twice in a row (or once before and once after
 * `shift` is applied) always yields the same natural rect, so `popupShift`
 * never flip-flops. This assumes `panel`'s offset parent is `wrapperLeft`'s
 * element (true here: daisyUI's `.dropdown` is `position: relative` and
 * `.dropdown-content` is `position: absolute`).
 */
export function panelNaturalRect(
  wrapperLeft: number,
  panel: { offsetLeft: number; offsetWidth: number },
): { left: number; right: number } {
  const left = wrapperLeft + panel.offsetLeft;
  return { left, right: left + panel.offsetWidth };
}
```

- [ ] **Step 4: Point `useQuickSavePopover.ts` at the new module**

In `src/components/ui/useQuickSavePopover.ts`, delete everything from the `/**` docblock above `export function isDismissKey` down to the closing `}` of `panelNaturalRect`, which ends just before `export interface UseQuickSavePopover`. Then change the first line from

```ts
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
```

to

```ts
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { isDismissKey, panelNaturalRect, popupShift } from "./popupGeometry";
```

The rest of the hook body is unchanged: it already calls the three functions by these names.

- [ ] **Step 5: Drop the re-export and the moved tests from QuickSavePopover**

In `src/components/ui/QuickSavePopover.tsx`, delete this line and the blank line after it:

```ts
export { isDismissKey, popupShift, panelNaturalRect } from "./useQuickSavePopover";
```

In `src/components/ui/QuickSavePopover.test.tsx`, change the import

```ts
import { QuickSavePopover, isDismissKey, popupShift, panelNaturalRect } from './QuickSavePopover';
```

to

```ts
import { QuickSavePopover } from './QuickSavePopover';
```

Then delete the three `describe` blocks at the end of the file, `describe('QuickSavePopover dismissal', …)`, `describe('popupShift', …)` and `describe('panelNaturalRect', …)`. The file now ends with the closing `});` of `describe('QuickSavePopover', …)`.

- [ ] **Step 6: Run the tests, the type-check and the linter**

Run: `bun test ./src/components/ui/popupGeometry.test.ts ./src/components/ui/QuickSavePopover.test.tsx`
Expected: PASS, with 8 tests in popupGeometry and 7 in QuickSavePopover, and 0 fail.

Run: `bun run lint`
Expected: exits 0 with no diagnostics.

Run: `bunx eslint src/components/ui/popupGeometry.ts src/components/ui/popupGeometry.test.ts src/components/ui/useQuickSavePopover.ts src/components/ui/QuickSavePopover.tsx src/components/ui/QuickSavePopover.test.tsx`
Expected: no output (zero errors, zero warnings).

Run: `bun run check:dead-code`
Expected: exits 0 with no findings. `QuickSavePopover.tsx` no longer re-exports the helpers, and the test imports them straight from `popupGeometry`.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/popupGeometry.ts src/components/ui/popupGeometry.test.ts src/components/ui/useQuickSavePopover.ts src/components/ui/QuickSavePopover.tsx src/components/ui/QuickSavePopover.test.tsx
git commit -m "$(cat <<'EOF'
refactor(ui): move the popup helpers into ui/popupGeometry

popupShift, panelNaturalRect and isDismissKey leave useQuickSavePopover so
the coming ui/Popup can share them; QuickSavePopover behaves as before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure listbox key handling (`ui/listboxKeys.ts`)

**Files:**
- Create: `src/components/ui/listboxKeys.ts`
- Test: `src/components/ui/listboxKeys.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (in `src/components/ui/listboxKeys.ts`):
  - `interface ListboxKeyState { active: number; labels: readonly string[] }`: `active` is the highlighted flat index (`-1` = none) and `labels` are every option's label in flat order.
  - `interface ListboxKeyResult { active: number; commit: boolean; handled: boolean }`. `handled` means the listbox owns the key: the caller calls `preventDefault()` and `stopPropagation()`.
  - `listboxKey(state: ListboxKeyState, key: string): ListboxKeyResult`
  - `isOpenKey(key: string): boolean`: true for `ArrowDown`, `ArrowUp`, `Enter` and `' '`.
  - `isCommandChord(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/listboxKeys.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { isCommandChord, isOpenKey, listboxKey } from './listboxKeys';

// Flat order across groups; index 4 is lower-case on purpose (case-insensitive type-ahead).
const LABELS = ['Major', 'Minor (Natural)', 'Dorian', 'Mixolydian', 'lydian'];
const at = (active: number, key: string) => listboxKey({ active, labels: LABELS }, key);
const moved = (active: number) => ({ active, commit: false, handled: true });

describe('listboxKey: arrows, Home and End move the highlight', () => {
  test('ArrowDown moves one option down', () => {
    expect(at(1, 'ArrowDown')).toEqual(moved(2));
  });

  test('ArrowUp moves one option up', () => {
    expect(at(2, 'ArrowUp')).toEqual(moved(1));
  });

  test('ArrowDown stops at the last option: no wrap, as in a native select', () => {
    expect(at(4, 'ArrowDown')).toEqual(moved(4));
  });

  test('ArrowUp stops at the first option: no wrap', () => {
    expect(at(0, 'ArrowUp')).toEqual(moved(0));
  });

  test('Home and End jump to the first and last option', () => {
    expect(at(3, 'Home')).toEqual(moved(0));
    expect(at(0, 'End')).toEqual(moved(4));
  });
});

describe('listboxKey: commit is explicit', () => {
  test('Enter commits the highlighted option', () => {
    expect(at(2, 'Enter')).toEqual({ active: 2, commit: true, handled: true });
  });

  // Space arrives as e.key === ' ', a single printable character: it must hit
  // the commit branch before the type-ahead branch ever sees it.
  test('Space commits the highlighted option and is never type-ahead', () => {
    const labels = [' starts with a space', 'Major'];
    expect(listboxKey({ active: 1, labels }, ' ')).toEqual({ active: 1, commit: true, handled: true });
  });

  test('a highlight outside the list never commits', () => {
    expect(listboxKey({ active: -1, labels: LABELS }, 'Enter').commit).toBe(false);
  });
});

describe('listboxKey: type-ahead', () => {
  test('a character jumps to the next option whose label starts with it', () => {
    expect(at(0, 'm')).toEqual(moved(1));
  });

  test('matching is case-insensitive', () => {
    expect(at(2, 'L')).toEqual(moved(4));
  });

  test('repeating the character steps through the matches and wraps', () => {
    expect(at(1, 'm')).toEqual(moved(3));
    expect(at(3, 'm')).toEqual(moved(0));
  });

  test('with no highlight the search starts at the first option', () => {
    expect(at(-1, 'm')).toEqual(moved(0));
  });

  test('no match leaves the highlight put but still claims the key', () => {
    expect(at(2, 'z')).toEqual(moved(2));
  });
});

describe('listboxKey: every other key, and an empty list', () => {
  test('any other key is a no-op the listbox does not claim', () => {
    for (const key of ['Tab', 'Escape', 'Shift', 'F1', 'PageDown', 'ArrowLeft']) {
      expect(at(2, key)).toEqual({ active: 2, commit: false, handled: false });
    }
  });

  test('an empty list never throws, moves or commits', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'm']) {
      expect(listboxKey({ active: -1, labels: [] }, key)).toEqual({ active: -1, commit: false, handled: false });
    }
  });
});

describe('isOpenKey', () => {
  test('ArrowDown, ArrowUp, Enter and Space open the list from its trigger', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) expect(isOpenKey(key)).toBe(true);
  });

  test('nothing else does', () => {
    for (const key of ['Escape', 'Tab', 'ArrowLeft', 'm', 'Home']) expect(isOpenKey(key)).toBe(false);
  });
});

describe('isCommandChord', () => {
  const none = { ctrlKey: false, metaKey: false, altKey: false };

  test('Ctrl, Meta or Alt make the key a browser or OS command, never type-ahead', () => {
    expect(isCommandChord({ ...none, ctrlKey: true })).toBe(true);
    expect(isCommandChord({ ...none, metaKey: true })).toBe(true);
    expect(isCommandChord({ ...none, altKey: true })).toBe(true);
  });

  test('a bare key (Shift is not a command) is not a chord', () => {
    expect(isCommandChord(none)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./src/components/ui/listboxKeys.test.ts`
Expected: FAIL, with an error that `./listboxKeys` cannot be resolved.

- [ ] **Step 3: Implement `src/components/ui/listboxKeys.ts`**

```ts
/**
 * The keyboard half of `ui/Listbox` (R357), pure so it can be tested
 * without a DOM. Arrows, Home, End and type-ahead only move the highlight;
 * a value commits on Enter or Space (or a click, handled in `useListbox`).
 * Browsing never writes: the header's scale commit re-renders the app and
 * can reharmonize.
 */

/** What `listboxKey` reads: the highlighted flat index (`-1` = none) and every option's label, in flat order. */
export interface ListboxKeyState {
  active: number;
  labels: readonly string[];
}

/** What a key does to the listbox. */
export interface ListboxKeyResult {
  /** The highlighted flat index after the key. */
  active: number;
  /** Commit the option at `active`. */
  commit: boolean;
  /**
   * The listbox owns this key: the caller prevents its default (arrows and
   * Space would scroll) and stops it reaching the page's note and transport
   * shortcuts, which listen on `window`.
   */
  handled: boolean;
}

const OPEN_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);

function moved(active: number): ListboxKeyResult {
  return { active, commit: false, handled: true };
}

/** The next label after `active` that starts with `char`, wrapping; `active` itself last. No match keeps `active`. */
function typeAhead(labels: readonly string[], active: number, char: string): number {
  const needle = char.toLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const index = (active + step) % labels.length;
    if (labels[index].toLowerCase().startsWith(needle)) return index;
  }
  return active;
}

/**
 * One key against the listbox. Arrows move one option and stop at the ends
 * (no wrap, as in a native select); Home/End jump; Enter and Space commit;
 * a printable single character jumps to the next label starting with it
 * (case-insensitive, wrapping). Space is `' '` — a printable character — so
 * it is matched before type-ahead and always commits. Any other key is not
 * handled. An empty list handles nothing.
 */
export function listboxKey(state: ListboxKeyState, key: string): ListboxKeyResult {
  const { active, labels } = state;
  const last = labels.length - 1;
  if (last < 0) return { active: -1, commit: false, handled: false };
  switch (key) {
    case 'ArrowDown':
      return moved(Math.min(active + 1, last));
    case 'ArrowUp':
      return moved(Math.max(active - 1, 0));
    case 'Home':
      return moved(0);
    case 'End':
      return moved(last);
    case 'Enter':
    case ' ':
      return { active, commit: active >= 0 && active <= last, handled: true };
    default:
      break;
  }
  if (key.length !== 1) return { active, commit: false, handled: false };
  return moved(typeAhead(labels, active, key));
}

/** The keys that open a listbox from its trigger button. */
export function isOpenKey(key: string): boolean {
  return OPEN_KEYS.has(key);
}

/**
 * A key held with Ctrl, Meta or Alt is a browser or OS command (Cmd+R,
 * Ctrl+F), never type-ahead: the listbox leaves it alone. Shift is not a
 * command — Shift+M is just an upper-case M.
 */
export function isCommandChord(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}
```

- [ ] **Step 4: Run the tests and the linters**

Run: `bun test ./src/components/ui/listboxKeys.test.ts`
Expected: PASS, with 19 tests and 0 fail.

Run: `bun run lint`
Expected: exits 0 with no diagnostics.

Run: `bunx eslint src/components/ui/listboxKeys.ts src/components/ui/listboxKeys.test.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/listboxKeys.ts src/components/ui/listboxKeys.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): pure listbox key handling

listboxKey moves the highlight on arrows, Home, End and type-ahead and
commits only on Enter or Space; isOpenKey and isCommandChord gate the
trigger and browser chords.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The shared popup shell (`ui/Popup` + `ui/usePopup`)

**Files:**
- Modify: `src/components/ui/popupGeometry.ts` (add `isOutside`)
- Modify: `src/components/ui/popupGeometry.test.ts` (add `isOutside` tests)
- Create: `src/components/ui/usePopup.ts`
- Create: `src/components/ui/Popup.tsx`
- Test: `src/components/ui/Popup.test.tsx`

**Interfaces:**
- Consumes: `isDismissKey`, `popupShift`, `panelNaturalRect` from `./popupGeometry` (Task 1); `cx(...parts)` from `./cx`.
- Produces:
  - `isOutside<T>(node: T | null, contains: (node: T) => boolean): boolean` in `popupGeometry.ts`.
  - `usePopup(options: { open: boolean; onClose: () => void; initialFocusRef?: RefObject<HTMLElement | null> }): UsePopup`, where `interface UsePopup { wrapperRef: RefObject<HTMLDivElement | null>; panelRef: RefObject<HTMLDivElement | null>; shift: number }`.
  - `Popup` props: `open: boolean`, `onClose: () => void` (**must be stable**, e.g. from `useCallback`), `trigger: ReactNode`, `align: 'start' | 'end'`, `panelClassName?: string`, `initialFocusRef?: RefObject<HTMLElement | null>`, `children: ReactNode`.
  - Markup: `<div class="dropdown dropdown-{start|end}[ dropdown-open]">{trigger}[<div class="dropdown-content z-50 {panelClassName}">…</div>]</div>`. The panel is mounted only while open.
- Behaviour (spec, plus one ruling): Escape closes and stops propagation; a pointerdown outside the wrapper closes; a focusout to a node outside the wrapper closes; on open, focus moves to `initialFocusRef`; on close, focus returns to what had it before opening. **Ruling:** after a Tab-away close, focus stays where Tab sent it. It is not pulled back to the trigger, because that would fight the browser's own focus move.

- [ ] **Step 1: Write the failing `isOutside` tests**

Append to `src/components/ui/popupGeometry.test.ts`, and change its import line to `import { isDismissKey, isOutside, panelNaturalRect, popupShift } from './popupGeometry';`:

```ts
describe('isOutside', () => {
  // The wrapper holds the trigger and the panel; `contains` stands in for Node.contains.
  const inWrapper = new Set(['trigger', 'panel', 'option', 'root select']);
  const contains = (node: string) => inWrapper.has(node);

  test('a node outside the wrapper is outside', () => {
    expect(isOutside('page button', contains)).toBe(true);
  });

  test('a node inside the panel is not', () => {
    expect(isOutside('option', contains)).toBe(false);
    expect(isOutside('root select', contains)).toBe(false);
  });

  // The trigger is inside the wrapper, so a pointerdown on it while open does
  // not close the popup: the trigger's own click toggles it shut instead, and
  // there is no close-then-reopen.
  test('a pointerdown on the trigger is not outside', () => {
    expect(isOutside('trigger', contains)).toBe(false);
  });

  // Safari focuses nothing on a click, a click on panel padding focuses
  // nothing, and a phone's native select hands off to its OS picker: each is
  // a focusout with relatedTarget null, and none of them left the popup.
  test('a focusout with no relatedTarget is not leaving', () => {
    expect(isOutside(null, () => false)).toBe(false);
  });
});
```

Create `src/components/ui/Popup.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Popup } from './Popup';

function render(open: boolean, align: 'start' | 'end' = 'end') {
  return renderToString(
    <Popup
      open={open}
      onClose={() => {}}
      align={align}
      panelClassName="w-80 p-2"
      trigger={<button type="button" id="btn-popup-test">Open</button>}
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
    expect(html).toContain('<div class="dropdown-content z-50 w-80 p-2"><p>Panel body</p></div>');
  });

  test('align start anchors the panel to the trigger’s start edge', () => {
    expect(render(true, 'start')).toContain('<div class="dropdown dropdown-start dropdown-open">');
  });

  test('an unshifted panel carries no transform', () => {
    expect(render(true)).not.toContain('style=');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test ./src/components/ui/popupGeometry.test.ts ./src/components/ui/Popup.test.tsx`
Expected: FAIL. `isOutside` is not exported (a SyntaxError on the import, or `isOutside is not a function`), and `./Popup` cannot be resolved.

- [ ] **Step 3: Add `isOutside` to `src/components/ui/popupGeometry.ts`**

Append:

```ts
/**
 * Whether an event's node lies outside the popup's wrapper: the one test
 * behind both the outside-pointerdown close and the focus-leave close.
 * `null` is never outside. A focusout with no `relatedTarget` (Safari
 * focusing nothing on a click, a click on panel padding, a native select
 * handing off to its OS picker) has not left the popup, and closing on it
 * would shut the panel under the user's finger. The trigger sits inside the
 * wrapper, so a pointerdown on it is not outside either: the trigger's own
 * click toggles the popup shut, rather than an outside close firing first
 * and the click reopening it.
 */
export function isOutside<T>(node: T | null, contains: (node: T) => boolean): boolean {
  return node !== null && !contains(node);
}
```

- [ ] **Step 4: Create `src/components/ui/usePopup.ts`**

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
  /** Must be stable: every listener below re-subscribes when it changes. */
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Escape and a pointerdown outside the wrapper close the popup. Escape stops
 * propagating here: the page is full of shortcut keys on `window`.
 */
function useDismiss(open: boolean, onClose: () => void, wrapperRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isDismissKey(e)) return;
      e.stopPropagation();
      onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (!isOutside(e.target as Node | null, (node) => wrapper?.contains(node) ?? false)) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onClose, wrapperRef]);
}

/**
 * On open, focus moves to `initialFocusRef`; on close it goes back to what
 * had it before (the trigger). The panel is a plain `dropdown-content`, not
 * a <dialog>, so the platform does none of this. Focus leaving the wrapper
 * (Tab away) closes the popup and keeps focus where Tab sent it — pulling it
 * back to the trigger would fight the browser's own focus move.
 */
function useFocusHandoff(
  open: boolean,
  onClose: () => void,
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
      onClose();
    };
    wrapper.addEventListener('focusout', onFocusOut);
    return () => {
      wrapper.removeEventListener('focusout', onFocusOut);
      returnTo?.focus();
    };
  }, [open, onClose, wrapperRef, initialFocusRef]);
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
  useDismiss(open, onClose, wrapperRef);
  useFocusHandoff(open, onClose, wrapperRef, initialFocusRef);
  const shift = usePanelShift(open, wrapperRef, panelRef);
  return { wrapperRef, panelRef, shift };
}
```

- [ ] **Step 5: Create `src/components/ui/Popup.tsx`**

```tsx
import type { ReactNode, RefObject } from 'react';
import { cx } from './cx';
import { usePopup } from './usePopup';

interface PopupProps {
  open: boolean;
  /** Closes the popup. Must be stable (`useCallback`): the dismissal listeners re-subscribe when it changes. */
  onClose: () => void;
  /** The trigger the caller renders; it must not carry `tabindex` (daisyUI disables pointer events on one while open). */
  trigger: ReactNode;
  /** Which trigger edge the panel hangs from. */
  align: 'start' | 'end';
  panelClassName?: string;
  /** Focused when the popup opens. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * The one popup shell (R328): a controlled daisyUI `dropdown` anchored to its
 * trigger, `dropdown-open` while open, its `z-50` panel (R331) mounted only
 * while open and shifted back inside the viewport. Closes on Escape, an
 * outside pointerdown and focus leaving it; see `usePopup`.
 */
export function Popup({ open, onClose, trigger, align, panelClassName, initialFocusRef, children }: PopupProps) {
  const { wrapperRef, panelRef, shift } = usePopup({ open, onClose, initialFocusRef });
  return (
    <div
      ref={wrapperRef}
      className={cx('dropdown', align === 'end' ? 'dropdown-end' : 'dropdown-start', open && 'dropdown-open')}
    >
      {trigger}
      {open && (
        <div
          ref={panelRef}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          className={cx('dropdown-content z-50', panelClassName)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests and the linters**

Run: `bun test ./src/components/ui/popupGeometry.test.ts ./src/components/ui/Popup.test.tsx`
Expected: PASS, with 12 tests in popupGeometry and 4 in Popup, and 0 fail.

Run: `bun run lint`
Expected: exits 0 with no diagnostics.

Run: `bunx eslint src/components/ui/popupGeometry.ts src/components/ui/popupGeometry.test.ts src/components/ui/usePopup.ts src/components/ui/Popup.tsx src/components/ui/Popup.test.tsx`
Expected: no output. If `react-hooks/exhaustive-deps` warns, the fix is to add the named dependency. Never disable the rule for these effects: every ref and callback here is already listed.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/popupGeometry.ts src/components/ui/popupGeometry.test.ts src/components/ui/usePopup.ts src/components/ui/Popup.tsx src/components/ui/Popup.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): the shared Popup shell

A controlled daisyUI dropdown that closes on Escape, an outside pointerdown
and focus leaving it, hands focus in and back, and keeps its panel on
screen. isOutside never treats a null relatedTarget as leaving.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The shared listbox (`ui/Listbox` + `ui/useListbox`)

**Files:**
- Create: `src/components/ui/useListbox.ts`
- Create: `src/components/ui/Listbox.tsx`
- Test: `src/components/ui/useListbox.test.ts`
- Test: `src/components/ui/Listbox.test.tsx`

**Interfaces:**
- Consumes: `listboxKey`, `isCommandChord` from `./listboxKeys` (Task 2); `cx` from `./cx`; `Check` from `lucide-react`.
- Produces:
  - In `Listbox.tsx`: `interface ListboxOption { value: string; label: string; description?: string }`, `interface ListboxGroup { label: string; options: readonly ListboxOption[] }`, and `Listbox` with props `{ id: string; label: string; groups: readonly ListboxGroup[]; value: string; onCommit: (value: string) => void; className?: string; ref?: Ref<HTMLDivElement> }`.
  - In `useListbox.ts`: `interface IndexedOption extends ListboxOption { index: number }`, `interface IndexedGroup { label: string; options: readonly IndexedOption[] }`, `optionId(listboxId: string, index: number): string` (→ `${listboxId}-opt-${index}`), `groupHeadingId(listboxId: string, groupIndex: number): string` (→ `${listboxId}-grp-${groupIndex}`), `indexGroups(groups)`, `activeForValue(values, value): number`, `parseOptionIndex(raw: string | null | undefined, count: number): number | null`, and `useListbox({ id, groups, value, onCommit }): UseListbox`.
- **Ruling (spec gap):** `Listbox` takes `className` for its root, which is the scroll box: the spec gives xl `max-h-96` and compact `max-h-80 overflow-y-auto overscroll-contain`. It also takes `ref` (React 19 prop) so a `Popup` can focus it. Clicks and hover are handled on the root by event delegation through `data-option-index`. Focus therefore never leaves the root, and option rows carry no handlers (jsx-a11y would otherwise demand key handlers and a `tabIndex` on each).

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/useListbox.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { ListboxGroup } from './Listbox';
import { activeForValue, groupHeadingId, indexGroups, optionId, parseOptionIndex } from './useListbox';

const GROUPS: readonly ListboxGroup[] = [
  {
    label: 'Fruit',
    options: [
      { value: 'green apple', label: 'Apple', description: 'Crisp and tart' },
      { value: 'banana', label: 'Banana' },
    ],
  },
  { label: 'Root veg', options: [{ value: 'carrot', label: 'Carrot', description: 'Sweet and earthy' }] },
];

describe('indexGroups', () => {
  test('numbers the options across groups in flat order', () => {
    const { groups, values, labels } = indexGroups(GROUPS);
    expect(values).toEqual(['green apple', 'banana', 'carrot']);
    expect(labels).toEqual(['Apple', 'Banana', 'Carrot']);
    expect(groups.map((g) => g.options.map((o) => o.index))).toEqual([[0, 1], [2]]);
    expect(groups[1]).toEqual({
      label: 'Root veg',
      options: [{ value: 'carrot', label: 'Carrot', description: 'Sweet and earthy', index: 2 }],
    });
  });

  test('an empty list indexes to nothing', () => {
    expect(indexGroups([])).toEqual({ groups: [], values: [], labels: [] });
  });
});

describe('ids', () => {
  // Scale keys contain spaces ('Natural Minor'), which an id cannot.
  test('option and heading ids come from indexes, never from the value', () => {
    expect(optionId('lb', 2)).toBe('lb-opt-2');
    expect(groupHeadingId('lb', 1)).toBe('lb-grp-1');
  });
});

describe('activeForValue', () => {
  test('the highlight starts on the selected option', () => {
    expect(activeForValue(['a', 'b', 'c'], 'b')).toBe(1);
  });

  test('a value not among the options starts the highlight on the first', () => {
    expect(activeForValue(['a', 'b'], 'stale key')).toBe(0);
  });

  test('an empty list has no highlight', () => {
    expect(activeForValue([], 'a')).toBe(-1);
  });
});

describe('parseOptionIndex', () => {
  test('reads an in-range data-option-index', () => {
    expect(parseOptionIndex('2', 3)).toBe(2);
    expect(parseOptionIndex('0', 3)).toBe(0);
  });

  test('a missing, non-integer or out-of-range index is no option', () => {
    for (const raw of [null, undefined, '', '1.5', 'x', '3', '-1']) {
      expect(parseOptionIndex(raw, 3)).toBeNull();
    }
  });
});
```

Create `src/components/ui/Listbox.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Listbox, type ListboxGroup } from './Listbox';

const GROUPS: readonly ListboxGroup[] = [
  {
    label: 'Fruit',
    options: [
      { value: 'green apple', label: 'Apple', description: 'Crisp and tart' },
      { value: 'banana', label: 'Banana' },
    ],
  },
  { label: 'Root veg', options: [{ value: 'carrot', label: 'Carrot', description: 'Sweet and earthy' }] },
];

const HEADING = 'px-2 pt-2 pb-1 text-[11px] uppercase font-bold tracking-wider text-base-content/60';
const ROW = 'flex items-center gap-2 px-2 py-1.5 rounded-field cursor-pointer';

function render(value: string, groups: readonly ListboxGroup[] = GROUPS) {
  return renderToString(
    <Listbox id="lb" label="Food" groups={groups} value={value} onCommit={() => {}} className="max-h-96 overflow-y-auto" />,
  );
}

describe('Listbox: the listbox root', () => {
  test('is a focusable, labelled listbox pointing at the selected option', () => {
    expect(render('banana')).toContain(
      '<div id="lb" role="listbox" aria-label="Food" tabindex="0" aria-activedescendant="lb-opt-1" class="',
    );
  });

  test('takes the caller’s classes (the scroll box)', () => {
    expect(render('banana')).toMatch(/role="listbox"[^>]*class="[^"]*max-h-96 overflow-y-auto"/);
  });
});

describe('Listbox: groups and options', () => {
  test('each group is a role=group labelled by its visible heading', () => {
    const html = render('banana');
    expect(html).toContain(`<div role="group" aria-labelledby="lb-grp-0"><div id="lb-grp-0" class="${HEADING}">Fruit</div>`);
    expect(html).toContain(`<div role="group" aria-labelledby="lb-grp-1"><div id="lb-grp-1" class="${HEADING}">Root veg</div>`);
  });

  test('option ids run in flat order across groups', () => {
    const html = render('banana');
    expect(html).toContain('id="lb-opt-0" role="option" aria-selected="false" data-option-index="0"');
    expect(html).toContain('id="lb-opt-2" role="option" aria-selected="false" data-option-index="2"');
  });

  test('only the selected option is aria-selected, active, primary and checked', () => {
    const html = render('banana');
    expect(html.match(/aria-selected="true"/g) ?? []).toHaveLength(1);
    expect(html).toContain(`id="lb-opt-1" role="option" aria-selected="true" data-option-index="1" class="${ROW} bg-base-200"`);
    expect(html.match(/bg-base-200/g) ?? []).toHaveLength(1);
    expect(html).toContain('<div class="text-sm font-medium text-primary">Banana</div>');
    expect(html).toContain('<div class="text-sm font-medium">Apple</div>');
    expect(html.match(/lucide-check/g) ?? []).toHaveLength(1);
    const check = html.indexOf('lucide-check');
    expect(check).toBeGreaterThan(html.indexOf('id="lb-opt-1"'));
    expect(check).toBeLessThan(html.indexOf('id="lb-opt-2"'));
  });

  test('descriptions show under their names, and an option without one has none', () => {
    const html = render('banana');
    expect(html).toContain('<div class="text-xs text-base-content/70">Crisp and tart</div>');
    expect(html).toContain('<div class="text-xs text-base-content/70">Sweet and earthy</div>');
    expect(html.match(/text-base-content\/70/g) ?? []).toHaveLength(2);
  });
});

describe('Listbox: defensive values', () => {
  test('a value not among the options selects nothing and highlights the first option', () => {
    const html = render('stale key');
    expect(html).not.toContain('aria-selected="true"');
    expect(html).not.toContain('lucide-check');
    expect(html).toContain('aria-activedescendant="lb-opt-0"');
  });

  test('an empty list renders an empty listbox with no active descendant', () => {
    const html = render('anything', []);
    expect(html).toContain('role="listbox"');
    expect(html).not.toContain('aria-activedescendant');
    expect(html).not.toContain('role="option"');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test ./src/components/ui/useListbox.test.ts ./src/components/ui/Listbox.test.tsx`
Expected: FAIL, with errors that `./useListbox` and `./Listbox` cannot be resolved.

- [ ] **Step 3: Create `src/components/ui/useListbox.ts`**

```ts
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { ListboxGroup, ListboxOption } from './Listbox';
import { isCommandChord, listboxKey } from './listboxKeys';

/** An option with its flat index across every group: the index its id and the highlight use. */
export interface IndexedOption extends ListboxOption {
  index: number;
}

export interface IndexedGroup {
  label: string;
  options: readonly IndexedOption[];
}

interface IndexedListbox {
  groups: readonly IndexedGroup[];
  /** Every option's value, in flat order. */
  values: readonly string[];
  /** Every option's label, in flat order (type-ahead reads these). */
  labels: readonly string[];
}

/** An option's DOM id: from its flat index, never its value — scale keys contain spaces. */
export function optionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`;
}

/** A group heading's DOM id, referenced by the group's `aria-labelledby`. */
export function groupHeadingId(listboxId: string, groupIndex: number): string {
  return `${listboxId}-grp-${groupIndex}`;
}

/** Numbers every option across groups, in order. */
export function indexGroups(groups: readonly ListboxGroup[]): IndexedListbox {
  const values: string[] = [];
  const labels: string[] = [];
  const indexed = groups.map((group) => ({
    label: group.label,
    options: group.options.map((option) => {
      values.push(option.value);
      labels.push(option.label);
      return { ...option, index: values.length - 1 };
    }),
  }));
  return { groups: indexed, values, labels };
}

/** Where the highlight starts: the selected option, or the first when the value is not an option; none in an empty list. */
export function activeForValue(values: readonly string[], value: string): number {
  if (values.length === 0) return -1;
  return Math.max(0, values.indexOf(value));
}

/** A `data-option-index` attribute as an option index, or `null` when it names no option. */
export function parseOptionIndex(raw: string | null | undefined, count: number): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 && index < count ? index : null;
}

/** The option row under an event target (clicks and hover are delegated to the listbox root). */
function optionIndexAt(target: EventTarget, count: number): number | null {
  if (!(target instanceof Element)) return null;
  return parseOptionIndex(target.closest('[data-option-index]')?.getAttribute('data-option-index'), count);
}

export interface UseListbox {
  groups: readonly IndexedGroup[];
  /** The highlighted flat index, `-1` in an empty list. */
  active: number;
  /** The highlighted option's id for `aria-activedescendant`. */
  activeId: string | undefined;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
}

interface ListboxOptions {
  id: string;
  groups: readonly ListboxGroup[];
  value: string;
  onCommit: (value: string) => void;
}

/**
 * `ui/Listbox`'s logic (R357). Focus stays on the listbox root; the
 * highlight is `aria-activedescendant`. Keys go through `listboxKey`, and a
 * handled key is kept from the page's `window` shortcuts, so type-ahead never
 * plays a note. Hover moves the highlight; a click or Enter/Space commits.
 */
export function useListbox({ id, groups, value, onCommit }: ListboxOptions): UseListbox {
  const model = useMemo(() => indexGroups(groups), [groups]);
  const [active, setActive] = useState(() => activeForValue(model.values, value));

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optionId(id, active))?.scrollIntoView({ block: 'nearest' });
  }, [id, active]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (isCommandChord(e)) return;
      const next = listboxKey({ active, labels: model.labels }, e.key);
      if (!next.handled) return;
      e.preventDefault();
      e.stopPropagation();
      setActive(next.active);
      if (next.commit) onCommit(model.values[next.active]);
    },
    [active, model, onCommit],
  );

  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const index = optionIndexAt(e.target, model.values.length);
      if (index === null) return;
      setActive(index);
      onCommit(model.values[index]);
    },
    [model, onCommit],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const index = optionIndexAt(e.target, model.values.length);
      if (index !== null) setActive(index);
    },
    [model],
  );

  return {
    groups: model.groups,
    active,
    activeId: active >= 0 ? optionId(id, active) : undefined,
    onKeyDown,
    onClick,
    onPointerMove,
  };
}
```

- [ ] **Step 4: Create `src/components/ui/Listbox.tsx`**

```tsx
import type { Ref } from 'react';
import { Check } from 'lucide-react';
import { cx } from './cx';
import { groupHeadingId, optionId, useListbox, type IndexedGroup, type IndexedOption } from './useListbox';

export interface ListboxOption {
  value: string;
  label: string;
  /** One line under the label; wraps, never truncates. */
  description?: string;
}

export interface ListboxGroup {
  label: string;
  options: readonly ListboxOption[];
}

interface ListboxProps {
  id: string;
  /** The listbox's accessible name (`aria-label`). */
  label: string;
  groups: readonly ListboxGroup[];
  /** The committed value; its option is `aria-selected` and checked. */
  value: string;
  /** Called on Enter, Space or a click — never on an arrow key or hover. */
  onCommit: (value: string) => void;
  /** Classes for the root, which is also the scroll box (`max-h-*`, `overflow-y-auto`). */
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** Matches the "Master Key & Scale" heading's look. */
const GROUP_HEADING = 'px-2 pt-2 pb-1 text-[11px] uppercase font-bold tracking-wider text-base-content/60';
const ROW = 'flex items-center gap-2 px-2 py-1.5 rounded-field cursor-pointer';
const ROOT = 'rounded-box focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

interface ListboxRowProps {
  listboxId: string;
  option: IndexedOption;
  active: boolean;
  selected: boolean;
}

function ListboxRow({ listboxId, option, active, selected }: ListboxRowProps) {
  return (
    <div
      id={optionId(listboxId, option.index)}
      role="option"
      aria-selected={selected}
      data-option-index={option.index}
      className={cx(ROW, active && 'bg-base-200')}
    >
      <div className="min-w-0 flex-1">
        <div className={cx('text-sm font-medium', selected && 'text-primary')}>{option.label}</div>
        {option.description && <div className="text-xs text-base-content/70">{option.description}</div>}
      </div>
      {selected && <Check className="w-4 h-4 shrink-0 text-primary" />}
    </div>
  );
}

interface ListboxSectionProps {
  listboxId: string;
  group: IndexedGroup;
  groupIndex: number;
  active: number;
  value: string;
}

function ListboxSection({ listboxId, group, groupIndex, active, value }: ListboxSectionProps) {
  const headingId = groupHeadingId(listboxId, groupIndex);
  return (
    <div role="group" aria-labelledby={headingId}>
      <div id={headingId} className={GROUP_HEADING}>{group.label}</div>
      {group.options.map((option) => (
        <ListboxRow
          key={option.value}
          listboxId={listboxId}
          option={option}
          active={option.index === active}
          selected={option.value === value}
        />
      ))}
    </div>
  );
}

/**
 * The one custom listbox (R357): grouped options with an optional
 * description line, a check on the selected one, `aria-activedescendant`
 * focus and explicit commit. Clicks and hover are delegated to the root, so
 * DOM focus never leaves it.
 */
export function Listbox({ id, label, groups, value, onCommit, className, ref }: ListboxProps) {
  const listbox = useListbox({ id, groups, value, onCommit });
  return (
    <div
      ref={ref}
      id={id}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={listbox.activeId}
      onKeyDown={listbox.onKeyDown}
      onClick={listbox.onClick}
      onPointerMove={listbox.onPointerMove}
      className={cx(ROOT, className)}
    >
      {listbox.groups.map((group, groupIndex) => (
        <ListboxSection
          key={group.label}
          listboxId={id}
          group={group}
          groupIndex={groupIndex}
          active={listbox.active}
          value={value}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests and the linters**

Run: `bun test ./src/components/ui/useListbox.test.ts ./src/components/ui/Listbox.test.tsx`
Expected: PASS, with 8 tests in useListbox and 8 in Listbox, and 0 fail.

Run: `bun run lint`
Expected: exits 0 with no diagnostics.

Run: `bunx eslint src/components/ui/useListbox.ts src/components/ui/useListbox.test.ts src/components/ui/Listbox.tsx src/components/ui/Listbox.test.tsx`
Expected: no output. If a jsx-a11y rule fires on the root, first check that `tabIndex={0}`, `role="listbox"` and `onKeyDown` are all present, and fix the markup. Never line-disable an a11y rule here.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/useListbox.ts src/components/ui/useListbox.test.ts src/components/ui/Listbox.tsx src/components/ui/Listbox.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): the shared Listbox

Grouped options with an optional description, a check on the selected one,
aria-activedescendant focus and explicit commit. Option ids come from the
flat index; a value that is not an option selects nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Lift `SCALE_GROUPS` into `ui/scaleGroups.ts`

**Files:**
- Create: `src/components/ui/scaleGroups.ts`
- Test: `src/components/ui/scaleGroups.test.ts`
- Modify: `src/components/ui/ScaleTypeOptions.tsx` (whole file shown)

**Interfaces:**
- Consumes: `SCALES`, `SCALE_CATEGORIES`, `ScaleCategory` from `@/data/scales`.
- Produces: `SCALE_GROUPS: readonly { category: ScaleCategory; keys: readonly string[] }[]`, the categories in `SCALE_CATEGORIES` order, each holding its `SCALES` keys in `SCALES` order.
- **Ruling:** the spec's "24 entries" is asserted as "every `SCALES` key exactly once" (`toEqual(Object.keys(SCALES))`), not as the literal 24. This follows R001 and the recent "drop stale scale counts" cleanup, so the 8 excluded scales can land without editing this test.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/scaleGroups.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SCALES, SCALE_CATEGORIES } from '@/data/scales';
import { SCALE_GROUPS } from './scaleGroups';

describe('SCALE_GROUPS', () => {
  test('one group per category, in SCALE_CATEGORIES order', () => {
    expect(SCALE_GROUPS.map((group) => group.category)).toEqual([...SCALE_CATEGORIES]);
  });

  test('holds every SCALES key exactly once, in SCALES order', () => {
    const keys = SCALE_GROUPS.flatMap((group) => group.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(Object.keys(SCALES));
  });

  test('each key sits under its own category', () => {
    for (const { category, keys } of SCALE_GROUPS) {
      for (const key of keys) expect(SCALES[key].category, key).toBe(category);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./src/components/ui/scaleGroups.test.ts`
Expected: FAIL, with an error that `./scaleGroups` cannot be resolved.

- [ ] **Step 3: Create `src/components/ui/scaleGroups.ts`**

```ts
import { SCALES, SCALE_CATEGORIES, type ScaleCategory } from '@/data/scales';

/**
 * Each scale category with its SCALES keys, in display order. Shared by the
 * native `ScaleTypeOptions` (the key-change dialog) and the header's scale
 * listbox, so it lives in `ui/` (R276). Built once: SCALES is static content.
 */
export const SCALE_GROUPS: readonly { category: ScaleCategory; keys: readonly string[] }[] = SCALE_CATEGORIES.map(
  (category) => ({
    category,
    keys: Object.keys(SCALES).filter((key) => SCALES[key].category === category),
  }),
);
```

- [ ] **Step 4: Make `ScaleTypeOptions` use it**

Replace the whole of `src/components/ui/ScaleTypeOptions.tsx` with:

```tsx
import { SCALES } from '@/data/scales';
import { SCALE_GROUPS } from '@/components/ui/scaleGroups';

/**
 * The scale-type `<option>`s for a native `<select>`, one `<optgroup>` per
 * category. The value is the persisted SCALES key; the text is the display
 * name. Shared by the header's scale select and the key-change dialog's.
 */
export function ScaleTypeOptions() {
  return (
    <>
      {SCALE_GROUPS.map(({ category, keys }) => (
        <optgroup key={category} label={category}>
          {keys.map((key) => (
            <option key={key} value={key}>
              {SCALES[key].name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
```

- [ ] **Step 5: Run the tests and the linters**

Run: `bun test ./src/components/ui/scaleGroups.test.ts ./src/components/ui/ScaleTypeOptions.test.tsx ./src/components/song/KeyChangeDialog.test.tsx ./src/components/Header.test.tsx`
Expected: PASS, with 0 fail. The existing optgroup tests are unchanged and still green.

Run: `bun run lint`
Expected: exits 0 with no diagnostics.

Run: `bunx eslint src/components/ui/scaleGroups.ts src/components/ui/scaleGroups.test.ts src/components/ui/ScaleTypeOptions.tsx`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/scaleGroups.ts src/components/ui/scaleGroups.test.ts src/components/ui/ScaleTypeOptions.tsx
git commit -m "$(cat <<'EOF'
refactor(ui): lift SCALE_GROUPS into ui/scaleGroups

The native scale options and the coming header listbox both group scales
by category, so the grouping moves to ui/ (R276).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The header scale-type listbox, and the compact menu on `ui/Popup`

**Files:**
- Create: `src/components/header/useScaleTypeListbox.ts`
- Create: `src/components/header/ScaleTypeListbox.tsx`
- Create: `src/components/header/useScaleMenu.ts`
- Modify: `src/components/header/ScaleMenu.tsx` (whole file shown)
- Modify: `src/components/Header.test.tsx` (two import lines; the `describe('key picker', …)` block, which is the file's last, is replaced)
- Move: `src/components/ui/ScaleTypeOptions.tsx` → `src/components/song/ScaleTypeOptions.tsx`, and its test alongside it
- Modify: `src/components/song/KeyChangeDialog.tsx` (import path)

**Interfaces:**
- Consumes: `Popup` (Task 3; props `open, onClose, trigger, align, panelClassName, initialFocusRef, children`); `Listbox`, `ListboxGroup` (Task 4; props `id, label, groups, value, onCommit, className, ref`); `isOpenKey` (Task 2); `SCALE_GROUPS` (Task 5); `useAppStore` selectors `scaleRoot`, `scaleType`, `setScaleRoot`, `setScaleType`.
- Produces:
  - `commitScaleType(current: string, next: string, write: (scaleType: string) => void): void` and `useScaleTypeListbox(): UseScaleTypeListbox` in `header/useScaleTypeListbox.ts`.
  - `SCALE_LISTBOX_GROUPS: readonly ListboxGroup[]` and `ScaleTypeListbox()` in `header/ScaleTypeListbox.tsx`.
  - `useScaleMenu(): UseScaleMenu` in `header/useScaleMenu.ts`.
  - `RootSelect({ id, stacked? })`, `ScaleMenuPanel({ scaleType, listboxRef, onCommit })` and `ScaleMenu()` in `header/ScaleMenu.tsx`. `ScaleSelects` is removed.
  - DOM ids: xl trigger `btn-scale-type`, xl listbox `listbox-master-scale-type`, compact trigger `btn-scale-dropdown` (unchanged), compact root select `select-master-scale-compact-root` (unchanged), compact listbox `listbox-master-scale-type-compact`, inline root select `select-master-scale-root` (unchanged).
- **Rulings:** (a) Committing the current scale skips `setScaleType`, matching a native select, which fires no change. (b) The xl panel hangs `align="end"` like the compact one, and `popupShift` handles any overflow. (c) The trigger's open-key handler calls `preventDefault()` so Enter does not also synthesise a click that toggles the popup shut. (d) `ScaleTypeOptions` moves to `song/`: with the header off it, `KeyChangeDialog` is its only consumer (R276). The header's optgroup tests are dropped, because `song/KeyChangeDialog.test.tsx` ("the scale select groups its options…") and the moved `ScaleTypeOptions.test.tsx` already cover the native groups.

- [ ] **Step 1: Rewrite the header's key-picker tests (failing)**

In `src/components/Header.test.tsx`, change

```ts
import { ScaleMenu, ScaleSelects } from './header/ScaleMenu';
```

to

```ts
import { RootSelect, ScaleMenu, ScaleMenuPanel } from './header/ScaleMenu';
import { ScaleTypeListbox } from './header/ScaleTypeListbox';
import { commitScaleType } from './header/useScaleTypeListbox';
```

and change

```ts
import { SCALES, SCALE_CATEGORIES } from '@/data/scales';
```

to

```ts
import { SCALES } from '@/data/scales';
```

Delete the old `describe('key picker', …)` block, which runs to the end of the file:

```bash
cd /Users/Pathompong/Sites/Personal/solna && perl -0pi -e "s/\ndescribe\('key picker'.*\z/\n/s" src/components/Header.test.tsx && tail -4 src/components/Header.test.tsx
```

Expected tail: the end of `describe('the header tabs cover every view', …)`, closing with `});`.

Then append:

```bash
cd /Users/Pathompong/Sites/Personal/solna && cat >> src/components/Header.test.tsx <<'EOF'

describe('key picker', () => {
  test('the root select offers the dual label while storing the sharp name', () => {
    const html = renderToString(<RootSelect id="test-root" />);
    expect(html).toContain('<option value="C#">C#/Db</option>');
    expect(html).toContain('<option value="C">C</option>');
  });

  // Both breakpoint copies render — the inline field from xl up, the compact
  // trigger below it — each under its own ids, so the hidden copy never
  // duplicates one. The compact panel mounts only while open.
  test('the key/scale menu renders the inline field and the compact trigger', () => {
    const html = renderToString(<ScaleMenu />);
    expect(html).toContain('id="select-master-scale-root"');
    expect(html).toContain('id="btn-scale-type"');
    expect(html).toContain('id="btn-scale-dropdown"');
    expect(html).not.toContain('role="listbox"');
  });

  // The dropdown trigger stands beside the loop picker / project name, which
  // wear the field box around a `select-sm`; it wears the same box around a
  // content-box `h-8`, so both come out the same height on every frame.
  test('the dropdown trigger wears the field box at the select height', () => {
    const html = renderToString(<ScaleMenu />);
    expect(html).toContain(`id="btn-scale-dropdown" class="${HEADER_FIELD_SHELL} box-content h-8 `);
  });

  // The compact trigger shows the scale's authored abbreviation, never a cut of
  // its display name: a four-letter cut read 'Mino' for three different scales.
  // Reads the creation-time scale, which is what renderToString sees (R257).
  test('the compact trigger shows the scale abbreviation', () => {
    const { scaleType } = useAppStore.getInitialState();
    const html = renderToString(<ScaleMenu />);
    expect(html).toContain(`max-[390px]:hidden">${SCALES[scaleType].abbr}</span>`);
  });

  // daisyUI gives `.dropdown-open > [tabindex]:first-child` pointer-events:
  // none. A trigger carrying tabindex would let a click on it while open fall
  // through to whatever lies beneath instead of toggling the popup shut.
  test('neither trigger carries a tabindex', () => {
    const html = renderToString(<ScaleMenu />);
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag);
    expect(buttons).toHaveLength(2);
    for (const tag of buttons) expect(tag).not.toContain('tabindex');
  });
});

describe('key picker widths', () => {
  // The header pair is FIXED width, and the names ellipsise inside it:
  // daisyUI's `.select` sizes itself (`clamp(3rem, 20rem, 100%)`), so a
  // `min-w-*` let the navbar decide the width AND meant the label never
  // overflowed anything to be clipped against. The numbers are a design call
  // and get retuned; ONE fixed width per control, and no min-width, is the rule.
  test('the inline pair is fixed width, not min-width', () => {
    const root = renderToString(<RootSelect id="test-root" />);
    const trigger = openTagContaining(renderToString(<ScaleTypeListbox />), 'id="btn-scale-type"');
    expect(root.match(/\bw-\d+\b/g) ?? []).toHaveLength(1);
    expect(trigger.match(/\bw-\d+\b/g) ?? []).toHaveLength(1);
    expect(root + trigger).not.toContain('min-w-');
  });

  // `appearance-none` is load-bearing, not decoration — see HEADER_SELECT's
  // comment. Without it daisyUI opts the select into Chrome's customizable
  // select, and the root name paints over the chevron and out past the border.
  test('the root select opts out of the customizable-select rendering', () => {
    const html = renderToString(<RootSelect id="test-root" />);
    expect(html.match(/appearance-none/g) ?? []).toHaveLength(1);
  });

  // The panel copy has a panel to fill and no navbar to hold still.
  test('the stacked root select fills its panel instead', () => {
    const html = renderToString(<RootSelect id="test-root" stacked />);
    expect(html.match(/w-full/g) ?? []).toHaveLength(1);
    expect(html).not.toMatch(/\bw-\d+\b/);
  });
});

describe('scale type listbox', () => {
  test('the xl trigger announces a listbox and shows the full scale name', () => {
    const { scaleType } = useAppStore.getInitialState();
    const html = renderToString(<ScaleTypeListbox />);
    const trigger = openTagContaining(html, 'id="btn-scale-type"');
    expect(trigger).toContain('aria-haspopup="listbox"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(html).toContain(`<span class="truncate">${SCALES[scaleType].name}</span>`);
    expect(html).not.toContain('dropdown-content');
  });

  test('every scale is an option, with its description', () => {
    const html = renderToString(
      <ScaleMenuPanel scaleType="Dorian" listboxRef={{ current: null }} onCommit={() => {}} />,
    );
    // renderToString escapes `&` (Major Blues reads "… R&B").
    const escaped = (text: string) => text.replace(/&/g, '&amp;');
    for (const scale of Object.values(SCALES)) {
      expect(html).toContain(`>${escaped(scale.name)}</div>`);
      expect(html).toContain(`<div class="text-xs text-base-content/70">${escaped(scale.description)}</div>`);
    }
  });

  test('the compact panel holds the heading, the root select and the scale listbox', () => {
    const html = renderToString(
      <ScaleMenuPanel scaleType="Dorian" listboxRef={{ current: null }} onCommit={() => {}} />,
    );
    expect(html).toContain('Master Key &amp; Scale');
    expect(html).toContain('id="select-master-scale-compact-root"');
    expect(html).toContain('id="listbox-master-scale-type-compact" role="listbox" aria-label="Scale Type"');
    expect(html.match(/aria-selected="true"/g) ?? []).toHaveLength(1);
    expect(html).toContain('<div class="text-sm font-medium text-primary">Dorian</div>');
  });
});

describe('scale type commit', () => {
  test('a different scale is written', () => {
    const writes: string[] = [];
    commitScaleType('Major', 'Dorian', (type) => writes.push(type));
    expect(writes).toEqual(['Dorian']);
  });

  // A native select fires no change for its current value; the listbox must
  // not either, or re-picking the scale would run changeKey and a set() for nothing.
  test('re-committing the current scale writes nothing', () => {
    const writes: string[] = [];
    commitScaleType('Dorian', 'Dorian', (type) => writes.push(type));
    expect(writes).toEqual([]);
  });
});
EOF
```

The description assertion escapes `&` because one description today contains "R&B". `·`, `♭` and `♯` pass through `renderToString` unescaped. If a future name or description gains `<`, `>`, `"` or `'`, extend `escaped` to cover it.

- [ ] **Step 2: Run the header tests to verify they fail**

Run: `bun test ./src/components/Header.test.tsx`
Expected: FAIL. `./header/ScaleTypeListbox` and `./header/useScaleTypeListbox` cannot be resolved, and `RootSelect`/`ScaleMenuPanel` are not exported.

- [ ] **Step 3: Create `src/components/header/useScaleTypeListbox.ts`**

```ts
import { useCallback, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useAppStore } from '@/store/store';
import { isOpenKey } from '@/components/ui/listboxKeys';

/**
 * Writes a committed scale type unless it is the current one — as a native
 * select, which fires no change for its current value. `setScaleType` runs
 * `changeKey` and a store `set()` even for an unchanged type.
 */
export function commitScaleType(current: string, next: string, write: (scaleType: string) => void): void {
  if (next !== current) write(next);
}

export interface UseScaleTypeListbox {
  scaleType: string;
  open: boolean;
  toggle: () => void;
  close: () => void;
  onTriggerKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  listboxRef: RefObject<HTMLDivElement | null>;
  /** Writes the scale (unless unchanged) and closes the popup. */
  onCommit: (value: string) => void;
}

/** The xl scale-type trigger's state: open/close, open keys and commit. */
export function useScaleTypeListbox(): UseScaleTypeListbox {
  const scaleType = useAppStore((s) => s.scaleType);
  const setScaleType = useAppStore((s) => s.setScaleType);
  const [open, setOpen] = useState(false);
  const listboxRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((wasOpen) => !wasOpen), []);
  const close = useCallback(() => setOpen(false), []);

  const onTriggerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (open || !isOpenKey(e.key)) return;
      // Enter would also synthesise a click on the button, toggling the popup
      // straight back shut; the page's shortcuts must not see the key either.
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    },
    [open],
  );

  const onCommit = useCallback(
    (value: string) => {
      commitScaleType(scaleType, value, setScaleType);
      setOpen(false);
    },
    [scaleType, setScaleType],
  );

  return { scaleType, open, toggle, close, onTriggerKeyDown, listboxRef, onCommit };
}
```

- [ ] **Step 4: Create `src/components/header/ScaleTypeListbox.tsx`**

```tsx
import type { KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { SCALES } from '@/data/scales';
import { Listbox, type ListboxGroup } from '@/components/ui/Listbox';
import { Popup } from '@/components/ui/Popup';
import { SCALE_GROUPS } from '@/components/ui/scaleGroups';
import { useScaleTypeListbox } from './useScaleTypeListbox';

/**
 * The scale library as listbox groups: the SCALES key is the value (the
 * persisted identity), the display name the label, the one-line mood/genre
 * line the description. Static content, built once.
 */
export const SCALE_LISTBOX_GROUPS: readonly ListboxGroup[] = SCALE_GROUPS.map(({ category, keys }) => ({
  label: category,
  options: keys.map((key) => ({ value: key, label: SCALES[key].name, description: SCALES[key].description })),
}));

/**
 * Matches the ghost `select-sm` it replaced (`HEADER_SELECT`): 32px tall,
 * bold 12px text, a chevron at the end, and ONE fixed width (`w-36`, never a
 * `min-w-*`) so the name ellipsises instead of pushing the navbar.
 */
const SCALE_TYPE_TRIGGER =
  'flex items-center justify-between gap-1 w-36 h-8 ps-3 pe-2 rounded-field text-xs font-bold text-base-content/80 cursor-pointer hover:bg-base-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** `p-1.5` leaves room for the listbox's 2px focus outline at its 2px offset. */
const PANEL = 'mt-1 w-80 max-w-[calc(100vw-1rem)] p-1.5 bg-base-100 border border-base-300 rounded-box shadow-xl';

interface ScaleTypeTriggerProps {
  name: string;
  open: boolean;
  onToggle: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

function ScaleTypeTrigger({ name, open, onToggle, onKeyDown }: ScaleTypeTriggerProps) {
  return (
    <button
      type="button"
      id="btn-scale-type"
      className={SCALE_TYPE_TRIGGER}
      title={`Scale Type — ${name}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span className="truncate">{name}</span>
      <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
    </button>
  );
}

/**
 * The master Scale Type from `xl` up: a trigger in place of the old native
 * select, opening a `Popup` whose `Listbox` shows each scale's name and
 * description by category. A commit closes it; so do Escape, an outside
 * click and tabbing away.
 */
export function ScaleTypeListbox() {
  const { scaleType, open, toggle, close, onTriggerKeyDown, listboxRef, onCommit } = useScaleTypeListbox();
  const name = SCALES[scaleType]?.name ?? scaleType;
  return (
    <Popup
      open={open}
      onClose={close}
      align="end"
      panelClassName={PANEL}
      initialFocusRef={listboxRef}
      trigger={<ScaleTypeTrigger name={name} open={open} onToggle={toggle} onKeyDown={onTriggerKeyDown} />}
    >
      <Listbox
        ref={listboxRef}
        id="listbox-master-scale-type"
        label="Scale Type"
        groups={SCALE_LISTBOX_GROUPS}
        value={scaleType}
        onCommit={onCommit}
        className="max-h-96 overflow-y-auto overscroll-contain"
      />
    </Popup>
  );
}
```

- [ ] **Step 5: Create `src/components/header/useScaleMenu.ts`**

```ts
import { useCallback, useRef, useState, type RefObject } from 'react';
import { useAppStore } from '@/store/store';
import { commitScaleType } from './useScaleTypeListbox';

export interface UseScaleMenu {
  scaleRoot: string;
  scaleType: string;
  open: boolean;
  toggle: () => void;
  close: () => void;
  listboxRef: RefObject<HTMLDivElement | null>;
  /** Writes the scale (unless unchanged); the panel stays open. */
  onCommit: (value: string) => void;
}

/** The compact (below `xl`) key/scale panel's state. */
export function useScaleMenu(): UseScaleMenu {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const setScaleType = useAppStore((s) => s.setScaleType);
  const [open, setOpen] = useState(false);
  const listboxRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((wasOpen) => !wasOpen), []);
  const close = useCallback(() => setOpen(false), []);
  // A commit does not close the panel, as the <details> it replaces did not:
  // the root select sits beside the list, and a key is often set in two picks.
  const onCommit = useCallback(
    (value: string) => commitScaleType(scaleType, value, setScaleType),
    [scaleType, setScaleType],
  );

  return { scaleRoot, scaleType, open, toggle, close, listboxRef, onCommit };
}
```

- [ ] **Step 6: Rewrite `src/components/header/ScaleMenu.tsx`**

Replace the whole file with:

```tsx
import type { RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/store';
import { SCALES } from '@/data/scales';
import { KEY_OPTIONS, formatKeyLabel, getTonicSpelling } from '@/utils/noteSpelling';
import { HEADER_FIELD_SHELL, HEADER_SELECT } from '@/components/ui/fieldClasses';
import { Listbox } from '@/components/ui/Listbox';
import { Popup } from '@/components/ui/Popup';
import { SCALE_LISTBOX_GROUPS, ScaleTypeListbox } from './ScaleTypeListbox';
import { useScaleMenu } from './useScaleMenu';

/**
 * The compact trigger inside its field box: a content-box `h-8`, the
 * `select-sm` height of the selects in the boxes beside it, so the padding and
 * border land on top exactly as theirs do.
 */
const SCALE_TRIGGER =
  'box-content h-8 cursor-pointer select-none text-xs font-bold hover:bg-base-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** `max-w` plus `popupShift` keep the 320px panel inside a 375px phone. */
const COMPACT_PANEL =
  'mt-1 w-80 max-w-[calc(100vw-1rem)] p-2.5 flex flex-col gap-2 bg-base-100 border border-base-300 rounded-box shadow-xl';

interface RootSelectProps {
  id: string;
  stacked?: boolean;
}

/** The master root note: a native select everywhere (R327). */
export function RootSelect({ id, stacked }: RootSelectProps) {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const setScaleRoot = useAppStore((s) => s.setScaleRoot);
  return (
    <select
      id={id}
      value={scaleRoot}
      onChange={(e) => setScaleRoot(e.target.value)}
      // `w-*`, never `min-w-*`: a min-width keeps the select from ever
      // shrinking, which is what makes HEADER_SELECT's ellipsis unreachable.
      // The panel copy is `w-full`, where there is room for all of it.
      className={`${HEADER_SELECT} text-primary ${stacked ? 'w-full' : 'w-18'}`}
      title="Root Note"
    >
      {KEY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface CompactTriggerProps {
  scaleRoot: string;
  scaleType: string;
  open: boolean;
  onToggle: () => void;
}

/**
 * The trigger wears the navbar's field box (`HEADER_FIELD_SHELL`) around a
 * select-height row, so it stands the same height as the loop picker or
 * project name beside it, at every width it shows.
 */
function CompactTrigger({ scaleRoot, scaleType, open, onToggle }: CompactTriggerProps) {
  return (
    <button
      type="button"
      id="btn-scale-dropdown"
      className={`${HEADER_FIELD_SHELL} ${SCALE_TRIGGER}`}
      title={`Key & Scale — ${formatKeyLabel(scaleRoot, scaleType, { long: true })}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="text-primary">{getTonicSpelling(scaleRoot, scaleType)}</span>
      {/* Dropped below 390px — the width at which brand + this group stop
          sharing one row and the navbar grows a third one. Narrower phones
          keep the root note, the full name in the `title`, and both pickers
          one tap away in the panel. */}
      <span className="text-[10px] text-base-content/70 max-w-12 truncate max-[390px]:hidden">
        {SCALES[scaleType]?.abbr ?? scaleType}
      </span>
      <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
    </button>
  );
}

interface ScaleMenuPanelProps {
  scaleType: string;
  listboxRef: RefObject<HTMLDivElement | null>;
  onCommit: (value: string) => void;
}

/** The compact panel's body: heading, native root select, then the scale listbox inline. */
export function ScaleMenuPanel({ scaleType, listboxRef, onCommit }: ScaleMenuPanelProps) {
  return (
    <>
      <div className="text-[11px] font-bold text-base-content/60 uppercase tracking-wider px-1">
        Master Key & Scale
      </div>
      <RootSelect id="select-master-scale-compact-root" stacked />
      <Listbox
        ref={listboxRef}
        id="listbox-master-scale-type-compact"
        label="Scale Type"
        groups={SCALE_LISTBOX_GROUPS}
        value={scaleType}
        onCommit={onCommit}
        className="max-h-80 overflow-y-auto overscroll-contain"
      />
    </>
  );
}

/**
 * The master key/scale group: an inline field from `xl` up (root select +
 * scale-type listbox), a `Popup` panel below it. The panel hangs from the
 * trigger's right edge (`align="end"`): below `md` the trigger sits at the
 * right end of the mobile top bar, and `popupShift` pulls any overflow back.
 */
export function ScaleMenu() {
  const { scaleRoot, scaleType, open, toggle, close, listboxRef, onCommit } = useScaleMenu();
  return (
    <>
      <div className={`hidden xl:flex ${HEADER_FIELD_SHELL}`}>
        <RootSelect id="select-master-scale-root" />
        <ScaleTypeListbox />
      </div>
      <div className="xl:hidden">
        <Popup
          open={open}
          onClose={close}
          align="end"
          panelClassName={COMPACT_PANEL}
          initialFocusRef={listboxRef}
          trigger={<CompactTrigger scaleRoot={scaleRoot} scaleType={scaleType} open={open} onToggle={toggle} />}
        >
          <ScaleMenuPanel scaleType={scaleType} listboxRef={listboxRef} onCommit={onCommit} />
        </Popup>
      </div>
    </>
  );
}
```

- [ ] **Step 7: Move `ScaleTypeOptions` to `song/`, its only consumer**

```bash
cd /Users/Pathompong/Sites/Personal/solna && git mv src/components/ui/ScaleTypeOptions.tsx src/components/song/ScaleTypeOptions.tsx && git mv src/components/ui/ScaleTypeOptions.test.tsx src/components/song/ScaleTypeOptions.test.tsx
```

In `src/components/song/KeyChangeDialog.tsx`, change

```ts
import { ScaleTypeOptions } from '@/components/ui/ScaleTypeOptions';
```

to

```ts
import { ScaleTypeOptions } from './ScaleTypeOptions';
```

In `src/components/song/ScaleTypeOptions.tsx`, replace the docblock sentence

```
 * name. Shared by the header's scale select and the key-change dialog's.
```

with

```
 * name. The key-change dialog's scale select: a pick inside a `Modal` stays
 * native (R327); the header's scale type is `header/ScaleTypeListbox`.
```

The moved test imports `./ScaleTypeOptions` relatively, so it needs no edit.

- [ ] **Step 8: Run the header, dialog and moved tests**

Run: `bun test ./src/components/Header.test.tsx ./src/components/song/KeyChangeDialog.test.tsx ./src/components/song/ScaleTypeOptions.test.tsx ./src/components/shell/mobileShell.test.tsx`
Expected: PASS, with 0 fail.

- [ ] **Step 9: Type-check, lint and run the full gate**

Run: `bun run lint`
Expected: exits 0 with no diagnostics.

Run: `bun run eslint`
Expected: zero errors and zero warnings. A warning is fixed, or line-disabled with a reason, per R264; a rule is never relaxed.

Run: `bun run verify`
Expected: every step green. That covers all tests, `lint`, `eslint`, `check:keys`, `check:drums`, `check:contrast`, `check:levels`, both Knip scans with zero findings, and `build`. Every new `ui/` file is now reachable from `src/main.tsx` through `ScaleMenu`. If Knip reports an unused export, delete that export; never add a Knip ignore.

- [ ] **Step 10: Commit**

```bash
git add src/components/header/useScaleTypeListbox.ts src/components/header/ScaleTypeListbox.tsx src/components/header/useScaleMenu.ts src/components/header/ScaleMenu.tsx src/components/Header.test.tsx src/components/song/ScaleTypeOptions.tsx src/components/song/ScaleTypeOptions.test.tsx src/components/song/KeyChangeDialog.tsx
git commit -m "$(cat <<'EOF'
feat(header): scale type listbox with descriptions

From xl up the Scale Type is a trigger opening a Popup + Listbox that shows
each scale's name and description by category; below xl the key/scale
menu moves off <details> onto ui/Popup, with the native root select and
the listbox inline. Re-picking the current scale writes nothing.
ScaleTypeOptions moves to song/, its only remaining consumer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Rules, ADR-0055 and the skill line

CLAUDE.md requires that a rule change updates its rules file **and** its ADR in the same commit. Record no version numbers, file counts or line numbers.

**Files:**
- Modify: `.claude/rules/components.md`
- Create: `docs/decisions/0055-shared-popup-and-listbox.md`
- Modify: `docs/decisions/README.md`
- Modify: `docs/decisions/0044-secondary-canvas-taxonomy.md` (Status line only)
- Modify: `docs/decisions/0051-theme-picker.md` (Status line only)
- Modify: `.claude/skills/music-theory/SKILL.md`

**Interfaces:**
- Consumes: the shipped names from Tasks 1–6 (`ui/Popup`, `ui/usePopup.ts`, `ui/popupGeometry.ts`, `ui/Listbox`, `ui/useListbox.ts`, `ui/listboxKeys.ts`, `ui/scaleGroups.ts`, `header/ScaleTypeListbox.tsx`, `song/ScaleTypeOptions.tsx`).
- Produces: R327 and R328 amended, and R357 new, each tagged in `components.md` and listed in ADR-0055.

- [ ] **Step 1: Amend R327 in `.claude/rules/components.md`**

Replace

```
- A preset library is a `PresetLibrary` side drawer on both frames, never a sheet; a quick
  in-place pick is a native `<select>`; a surface with a user library that can be deleted from
  gets a drawer, even where a quick pick also exists. <!-- R327 -->
```

with

```
- A preset library is a `PresetLibrary` side drawer on both frames, never a sheet; a quick
  in-place pick is a native `<select>` or a `ui/Listbox` — a `Listbox` when the options need a
  description or more than one line of text, a native `<select>` for any pick inside a `Modal`;
  a surface with a user library that can be deleted from gets a drawer, even where a quick pick
  also exists. <!-- R327 -->
```

- [ ] **Step 2: Amend R328 and add R357**

Replace

```
- A popup is a daisyUI `dropdown` anchored to its trigger (`dropdown-open` when controlled), kept
  inside the viewport horizontally by a pure helper; no popover API or CSS anchor positioning
  while the browser floor lacks them. The one exception is a popup that must sit above an open
```

with

```
- A popup is built on `ui/Popup` (its hook `ui/usePopup.ts`): a daisyUI `dropdown` anchored to
  its trigger (`dropdown-open` while open), kept inside the viewport horizontally by `popupShift`
  (`ui/popupGeometry.ts`), closed by Escape, a pointerdown outside it or focus leaving it, and
  handing focus back on close. No hand-rolled dismissal or placement, no `<details>` as a popup,
  and no popover API or CSS anchor positioning while the browser floor lacks them. Not yet on
  `ui/Popup` (sub-project 3 of ADR-0055): the two `DockMenu`s in `ui/BottomInputDock.tsx`,
  `project/ProjectMenu.tsx` and `ui/QuickSavePopover.tsx`. The one exception is a popup that must sit above an open
```

Then replace

```
  inline controls for its `row` variant instead. <!-- R328 -->
```

with

```
  inline controls for its `row` variant instead. <!-- R328 -->
- A custom listbox is `ui/Listbox` only: DOM focus stays on its `role="listbox"` root, which
  names the highlighted option through `aria-activedescendant`; option ids come from the flat
  index, never the value; keys go through `listboxKey` (`ui/listboxKeys.ts`) — arrows, Home, End,
  type-ahead and hover move only the highlight, and a value commits only on Enter, Space or a
  click. <!-- R357 -->
```

Then replace the section's ADR trailer

```
([ADR-0044](../../docs/decisions/0044-secondary-canvas-taxonomy.md); R328's top-layer-escape
case: [ADR-0051](../../docs/decisions/0051-theme-picker.md))
```

with

```
([ADR-0044](../../docs/decisions/0044-secondary-canvas-taxonomy.md); R328's top-layer-escape
case: [ADR-0051](../../docs/decisions/0051-theme-picker.md); `ui/Popup`, `ui/Listbox` and R357:
[ADR-0055](../../docs/decisions/0055-shared-popup-and-listbox.md))
```

- [ ] **Step 3: Add the Prohibited lines**

In `## Prohibited`, replace

```
- A preset library rendered as a sheet, or a deletable user library left as a quick pick with no drawer <!-- R327 -->
```

with

```
- A preset library rendered as a sheet, or a deletable user library left as a quick pick with no drawer <!-- R327 -->
- A quick pick that is neither a native `<select>` nor `ui/Listbox`, or a `Listbox` inside a `Modal` <!-- R327 -->
```

and replace

```
  positioning anywhere but the top-layer-escape case above; that case positioned via CSS anchor
  positioning <!-- R328 -->
```

with

```
  positioning anywhere but the top-layer-escape case above; that case positioned via CSS anchor
  positioning <!-- R328 -->
- A new popup not built on `ui/Popup` — its own dismissal listeners or placement math — or a
  `<details>` used as a popup <!-- R328 -->
- A custom listbox other than `ui/Listbox`, DOM focus moved onto its options, an option id built
  from its value, or a value committed by an arrow key, Home/End, type-ahead or hover <!-- R357 -->
```

- [ ] **Step 4: Write `docs/decisions/0055-shared-popup-and-listbox.md`**

```markdown
# ADR-0055: Shared Popup and Listbox primitives

**Status:** Accepted — 2026-09-26. Amends [ADR-0044](0044-secondary-canvas-taxonomy.md) (R327, R328). No issue.

## Context

The header's Scale Type was a native `<select>`. The scale library
([ADR-0054](0054-derived-scale-intervals.md)) gave every scale a one-line description, and a native
option shows one line of plain text, so the descriptions could not be seen while choosing. murva's
scale dropdown (a Radix Select) shows each scale's name and description, grouped by category, with a
check on the selected one.

Popups also dismissed through three different mechanisms: CSS `:focus-within` with a Safari `blur()`
workaround (the two `DockMenu`s in `ui/BottomInputDock.tsx`, `project/ProjectMenu.tsx`), a
hand-written hook (`ui/useQuickSavePopover.ts`), and a `<details>` (the compact key/scale menu in
`header/ScaleMenu.tsx`). The `<details>` could not close on Escape or on an outside click, and its
placement was hand-tuned.

## Decision

Three composable layers:

- **`ui/Popup`** with **`ui/usePopup.ts`**: a controlled daisyUI `dropdown`, `dropdown-open` while
  open, whose `dropdown-content z-50` panel mounts only while open and is shifted inside the viewport
  by `popupShift`/`panelNaturalRect` (moved into the pure `ui/popupGeometry.ts`). It closes on
  Escape (propagation stopped, since the page is full of shortcut keys), on a pointerdown outside
  the wrapper, and on focus leaving the wrapper. `isOutside` treats a `null` node as inside, so a
  focusout with no `relatedTarget` (Safari focusing nothing on a click, a native select handing off
  to its OS picker) keeps the popup open. Focus moves to `initialFocusRef` on open and returns to
  what had it on close, except after a Tab-away, where it stays where Tab sent it.
- **`ui/Listbox`** with **`ui/useListbox.ts`** and the pure **`ui/listboxKeys.ts`**: a
  `role="listbox"` root that keeps DOM focus and names the highlight through
  `aria-activedescendant`, groups as `role="group"` with visible headings, option ids from the flat
  index (scale keys contain spaces). `listboxKey` moves the highlight on arrows (no wrap), Home, End
  and type-ahead, and commits only on Enter or Space; a click commits and hover highlights, both
  delegated to the root. Handled keys are kept from the page's `window` shortcuts, so type-ahead
  never plays a note.
- **`header/ScaleTypeListbox`**: from `xl` up, a trigger in place of the scale-type select opens a
  `Popup` holding a `Listbox`; a commit closes it. Below `xl`, `ScaleMenu` moves from `<details>`
  onto `ui/Popup`: the panel holds the native root select and the `Listbox` inline, and a commit
  does not close it.

Commit is explicit because `setScaleType` re-renders the app and can reharmonize; browsing must not
write, and re-committing the current scale writes nothing, as a native select fires no change.
`SCALE_GROUPS` lifts to `ui/scaleGroups.ts`, shared by the listbox and the native
`song/ScaleTypeOptions.tsx`. The root note stays a native `<select>` everywhere, and a pick inside a
`Modal` (`song/KeyChangeDialog.tsx`) stays native.

Rejected:

- **One Radix-style `ui/Select`** fusing trigger, popup and list. It cannot serve the compact panel,
  where the list sits inline beside a root select, nor `ThemePicker`'s `popover="auto"` body, nor
  the sub-project 3 menus, which are popups without a list.
- **`appearance: base-select`** (the customizable `<select>`). Chromium-only; it fails the same
  browser floor as R328.
- **Keep the native select and show the selected scale's description under it.** About twenty
  lines, but it shows no description while browsing and lays no foundation for sub-projects 3 and 4.

## Consequences

- We own keyboard handling, ARIA and scrolling that the native select gave for free. DOM behaviour
  cannot be unit-tested in this repo, so the decisions live in pure functions with tests
  (`listboxKey`, `isOpenKey`, `isCommandChord`, `isOutside`, `popupShift`, `indexGroups`,
  `activeForValue`, `commitScaleType`), the markup is pinned through `renderToString`, and the
  keyboard, dismissal, viewport and contrast paths are checked in a browser.
- Sub-project 3 moves the two `DockMenu`s, `ProjectMenu` and `QuickSavePopover` onto `ui/Popup`;
  until then R328 names them as debt. Sub-project 4 moves `ThemePicker`'s body onto `ui/Listbox` and
  adds a leading slot for its swatches then, not before. The theme picker's top-layer `popover`
  exception (ADR-0051) stands.
- A trigger passed to `Popup` must not carry `tabindex`: daisyUI disables pointer events on
  `.dropdown-open > [tabindex]:first-child`. `onClose` must be stable, because the dismissal
  listeners re-subscribe when it changes.
- R331's accepted trade-off still stands: a toast can cover a bar popup.

## Rules this implies

- **R327** (amended) — a quick in-place pick is a native `<select>` or `ui/Listbox`; `Listbox` when
  options need a description or more than one line; a pick inside a `Modal` stays native.
- **R328** (amended) — a new popup is built on `ui/Popup`; no hand-rolled dismissal or placement and
  no `<details>` as a popup; the popups not yet migrated are named as sub-project 3 debt.
- **R357** — a custom listbox is `ui/Listbox` only: `aria-activedescendant`, keys through
  `listboxKey`, arrows move the highlight, and a value commits only on Enter, Space or click.

## Sources

Spec `docs/superpowers/specs/2026-09-26-scale-type-listbox-design.md`; plan
`docs/superpowers/plans/2026-09-26-scale-type-listbox.md`; branch `feat/scale-type-listbox`.
```

- [ ] **Step 5: Index row and Status-line pointers**

In `docs/decisions/README.md`, insert this row directly after the `| [0054](0054-derived-scale-intervals.md) | …` row:

```
| [0055](0055-shared-popup-and-listbox.md) | Shared Popup and Listbox primitives | Popups build on `ui/Popup` (a controlled daisyUI dropdown with one dismissal, focus and placement hook); a custom listbox is `ui/Listbox` (active descendant, explicit commit); the header Scale Type is the first consumer; amends ADR-0044's R327 and R328. |
```

In `docs/decisions/0044-secondary-canvas-taxonomy.md`, replace

```
**Status:** Accepted — 2026-09-24. Amends [ADR-0041](0041-mobile-frame.md) (R320).
```

with

```
**Status:** Accepted — 2026-09-24. Amends [ADR-0041](0041-mobile-frame.md) (R320). R327 and R328 amended by [ADR-0055](0055-shared-popup-and-listbox.md).
```

In `docs/decisions/0051-theme-picker.md`, replace

```
**Status:** Accepted — 2026-09-25. No issue.
```

with

```
**Status:** Accepted — 2026-09-25. No issue. R328 amended by [ADR-0055](0055-shared-popup-and-listbox.md) (new popups build on `ui/Popup`; this picker's top-layer exception stands).
```

Change nothing else in either accepted ADR.

- [ ] **Step 6: The music-theory skill line**

In `.claude/skills/music-theory/SKILL.md`, replace

```
`header/ScaleMenu.tsx` renders the pickers from `KEY_OPTIONS` / `ui/ScaleTypeOptions.tsx` (one optgroup
per category). The sequencer is **not**
```

with

```
`header/ScaleMenu.tsx` renders the root picker from `KEY_OPTIONS`; the header scale type is a `ui/Listbox`
(`header/ScaleTypeListbox.tsx`) showing each scale's name and description, grouped by `SCALE_GROUPS`
(`ui/scaleGroups.ts`); `song/KeyChangeDialog.tsx` keeps the native `song/ScaleTypeOptions.tsx`. The sequencer is **not**
```

- [ ] **Step 7: Check the docs and commit**

Run: `grep -c "R357" .claude/rules/components.md docs/decisions/0055-shared-popup-and-listbox.md`
Expected: `.claude/rules/components.md:3` (the rule, its Prohibited line and the section's ADR trailer) and `docs/decisions/0055-shared-popup-and-listbox.md:1` (its "Rules this implies" line).

Run: `git diff --stat`
Expected: only the six files listed for this task.

```bash
git add .claude/rules/components.md docs/decisions/0055-shared-popup-and-listbox.md docs/decisions/README.md docs/decisions/0044-secondary-canvas-taxonomy.md docs/decisions/0051-theme-picker.md .claude/skills/music-theory/SKILL.md
git commit -m "$(cat <<'EOF'
docs(rules): R327, R328 and R357 for the shared Popup and Listbox

ADR-0055 records the three layers, the rejected Select and base-select,
the complexity trade-off and the plan for sub-projects 3 and 4; 0044 and
0051 get Status-line pointers only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Browser verification and the final gate

There are no new files. Record the evidence in `work/browser-evidence.md`, which is git-ignored: the objective, the decisive selectors, what you observed, and a verdict per check. Overwrite that note rather than append to it, and never commit it. Fix any failure in the task that owns the code, and commit the fix there with the same message style.

**Files:** none (plus fixes, if any, in the owning files).

**Interfaces:**
- Consumes: DOM ids `btn-scale-type`, `listbox-master-scale-type`, `btn-scale-dropdown`, `select-master-scale-compact-root`, `listbox-master-scale-type-compact`; options `[role="option"]`, `data-option-index`.

- [ ] **Step 1: Start the app**

Start the dev server with the preview tool, or run `bun run dev` in the background. Open `http://localhost:3000` at a viewport **1440×900**; `xl` is 1280px and up, so the inline field shows. Stay on the Sound or Pattern tab, where the `scale` tool is available on the loop layer.

- [ ] **Step 2: Keyboard path (xl)**

1. Tab to `#btn-scale-type`. Press **ArrowDown**. Expected: the panel opens, `document.activeElement.id === 'listbox-master-scale-type'`, the selected scale's row has `bg-base-200` and is scrolled into view, and `aria-activedescendant` names its id.
2. Press **ArrowDown** twice. Expected: the highlight moves two rows, and the trigger text **does not change** (no commit).
3. Press **l**. Expected: the highlight jumps to the next label starting with "l" (Lydian…). The on-screen keyboard shows no key pressed and no note sounds.
4. Press **Enter**. Expected: the panel closes, the trigger shows the new name, and `document.activeElement.id === 'btn-scale-type'`.
5. Press **Space** on the trigger. Expected: it opens once and stays open, with no immediate close. Press **Space** again. Expected: it commits the highlighted scale and closes.
6. Open it with **Enter**. Expected: it opens once and stays open. Press **Escape**. Expected: it closes, the scale is unchanged, focus is on the trigger, and the transport did not react.

- [ ] **Step 3: Pointer and dismissal (xl)**

1. Click the trigger. Expected: it opens. Click the trigger again. Expected: it closes, with no flicker and no reopen.
2. Open it, move the mouse over the rows (the highlight follows), and click a row. Expected: that scale commits and the panel closes.
3. Open it and click an empty area of the page. Expected: it closes.
4. Open it and press **Tab**. Expected: it closes, and focus is on the next control after the key/scale field, **not** back on the trigger (the Tab-away ruling).
5. Open it and click the panel's padding, outside any row. Expected: it stays open.

- [ ] **Step 4: Compact panel at 375px**

Resize to **375×812**. Tap `#btn-scale-dropdown`. Then evaluate:

```js
(() => {
  const panel = document.querySelector('#btn-scale-dropdown').closest('.dropdown').querySelector('.dropdown-content');
  const r = panel.getBoundingClientRect();
  return { left: r.left, right: r.right, vw: innerWidth, focus: document.activeElement.id };
})()
```

Expected: `left >= 8`, `right <= vw - 8`, and `focus === 'listbox-master-scale-type-compact'`.

Then:

1. Change the root with the panel's root `<select>`. Expected: the panel stays open.
2. Tap a scale row. Expected: it commits, the panel **stays open**, and the check moves to the new row.
3. Press **Escape**. Expected: it closes.
4. Reopen it and tap outside. Expected: it closes.

- [ ] **Step 5: Description contrast, light and dark**

Open a listbox (xl or compact) and evaluate:

```js
(() => {
  const px = (paint) => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); paint(g); return g.getImageData(0, 0, 1, 1).data; };
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; } return 'white'; };
  const lum = (d) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(d[0]) + 0.7152 * f(d[1]) + 0.0722 * f(d[2]); };
  const ratio = (el) => {
    const bg = bgOf(el); const fg = getComputedStyle(el).color;
    const b = px((g) => { g.fillStyle = bg; g.fillRect(0, 0, 1, 1); });
    const f = px((g) => { g.fillStyle = bg; g.fillRect(0, 0, 1, 1); g.fillStyle = fg; g.fillRect(0, 0, 1, 1); });
    const [hi, lo] = [lum(f), lum(b)].sort((x, y) => y - x);
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
  };
  const active = document.querySelector('[role="option"].bg-base-200 .text-xs');
  const idle = document.querySelector('[role="option"]:not(.bg-base-200) .text-xs');
  return { theme: document.documentElement.dataset.theme, active: ratio(active), idle: ratio(idle) };
})()
```

Expected: `active >= 4.5` and `idle >= 4.5`. Run it once per Solna palette: evaluate `localStorage.setItem('solna_theme', 'solna-light'); location.reload()`, reopen the listbox and re-run; then do the same with `'solna-dark'`. If a ratio is below 4.5, raise the description's opacity step in `Listbox.tsx` (`/70` → `/80`), update the matching `Listbox.test.tsx` and `Header.test.tsx` assertions, and re-run.

- [ ] **Step 6: Final gate**

Run: `bun run verify`
Expected: every step green, both Knip scans with zero findings, and the build succeeding.

Run: `bun run eslint`
Expected: zero errors and zero warnings. For every warning that appears in any output (build, tests, eslint, browser console during Steps 2–5), decide and act per R264 and the user's warning policy, and state each decision in the hand-off summary.

Run: `git status --short`
Expected: only `?? .ux-assessment/` (untouched), plus nothing else uncommitted.

- [ ] **Step 7: Hand off**

Do not push, and do not open a PR. Report: the commits on `feat/scale-type-listbox`, the browser verdicts from `work/browser-evidence.md`, and the warning decisions.

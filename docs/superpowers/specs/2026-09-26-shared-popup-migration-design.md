# Shared popup migration — design

Sub-project 3 of the scale-select work (ADR-0055). It also closes the minors deferred from
sub-project 2. Sub-project 4 (moving `ThemePicker`'s body onto `ui/Listbox`) is **dropped**:
see "Sub-project 4" below.

Branch `refactor/shared-popup-migration`, no Linear issue.

## Goal

Every popup in the app dismisses and hands focus back through the same code, `ui/Popup`.
Today three mechanisms do this:

- CSS `:focus-within` with Safari workarounds, in the two `DockMenu`s and `ProjectMenu`;
- a hand-written hook, `ui/useQuickSavePopover.ts`;
- `ui/Popup`, in the header scale menus.

After this change only the third one is left.

## 1. `usePopup` preparation

Both changes land before any new caller.

- **`onClose` held in a latest-ref.** Each effect in `usePopup` depends on `open` (and the
  refs), never on `onClose`. The "must be stable" notes on `PopupOptions.onClose` and
  `PopupProps.onClose` go away, so a caller may pass an inline arrow.
- **Outside `pointerdown` in the capture phase** (`{ capture: true }`). A handler that calls
  `stopPropagation`, such as `useSpanResize`, can no longer keep a popup open.
  - The Escape listener stays in the bubble phase, because a focused control inside the panel
    may need Escape first.
  - Test: neither change is observable without a DOM (no effects run under
    `renderToString`), so both are covered by the browser check, not a unit test.

## 2. `Popup` API additions

- **`side?: 'bottom' | 'top'`**, default `'bottom'`. `'top'` adds daisyUI `dropdown-top`, so the
  panel opens above the trigger. The dock menus need this.
  - `popupShift` is horizontal-only and stays unchanged.
  - Look up `dropdown-top` in the daisyUI v5 docs before use.
- **The panel gets `tabIndex={-1}`.** A pointerdown on panel padding, or in Safari on a
  `<button>`, then leaves focus on the panel, inside the wrapper, instead of dropping it to
  `<body>`. This fixes the deferred "panel-padding click drops focus" minor. Keyboard users
  never land on the panel: it is -1 and not in the tab order.
  - The panel gets no focus ring (`outline-none`); it is not a control.

## 3. `useListbox`: re-seed the highlight on an external value change

If `value` changes while the listbox is mounted and the change came from outside (not a
commit), `active` moves to the new value's option. This uses the "adjust state during render"
pattern, tracking the previous `value` in state; it is not an effect.

- A commit also changes `value`. The re-seed lands on the option just committed, which is
  already active, so this is a no-op.
- Pure test: extract the decision as a helper
  (`nextActive(prevValue, value, active, values)` or similar) and test it.

## 4. The two `DockMenu`s (`ui/BottomInputDock.tsx`)

The target chip menu and the keyboard mode menu.

- **Each becomes a controlled `Popup`:** `side="top"`, with its alignment kept as it is today.
  Open state lives in a colocated hook (R265, R266).
- **The trigger is a real `<button>`** with `aria-expanded` and `aria-controls`. The
  `role="button"` span, its `tabIndex`, and the `DROPDOWN_TRIGGER_NOTE` block all go away.
  - A click on a `<button>` toggles state whether or not Safari focuses it, so the Safari
    reason for the span no longer applies.
- **The menu `<ul>` loses `tabIndex={0}`** and its eslint-disable, and the item `onClick`
  loses the `blur()` hack. Picking an item calls `onPick`, then closes the popup.
- **No `role="menu"`.** It promises arrow-key navigation this list does not have. Items stay
  `<li><button>` with `aria-current`, reachable by Tab as they are today.
- Everything else stays as it is: ids (`${idPrefix}-${option}`), labels, titles and the
  `menu menu-sm w-36` look. `dropdown-content z-50` now comes from `Popup`; the classes move to
  `panelClassName`.

## 5. `ProjectMenu` (`project/ProjectMenu.tsx`)

- **It becomes a controlled `Popup`**, `side="bottom"`, `align="start"`. The trigger is a
  `<button id="btn-project-menu" aria-label="Project menu">` with `aria-expanded`, and it keeps
  its current look.
- **Choosing a row closes the menu, then runs the action.**
  - An action that opens a `Modal` gets focus from the modal: the popup's focus return fires on
    close first, then `showModal` moves focus into the dialog.
  - When the modal closes, focus returns to the trigger.
  - Verify this order in the browser.
- **The `<ul>` loses `tabIndex={0}`** and its eslint-disable comment.
- `ProjectMenuEffects` and the sections model do not change.

## 6. `QuickSavePopover` (`ui/QuickSavePopover.tsx`)

- **It moves onto `Popup`**, with its alignment unchanged (`end`). `initialFocusRef` points at
  the name input.
- **`useQuickSavePopover` shrinks to what `Popup` does not do:** it owns `inputRef` and selects
  the input's text on open.
  - `Popup`'s child effect focuses the input first, then the parent's effect selects the text.
  - Its dismissal, focus-return and shift code are deleted.
- **One new behaviour:** tabbing out of the popover now closes it, as every other popup does.
  Today only Escape and an outside click close it.
- The trigger, form, Cancel/Submit and category select are unchanged.

## 7. Dead code

- After the migration, the `popupGeometry` helpers have a single consumer, `usePopup`. They
  stay in `popupGeometry.ts`, the pure, tested module.
- Knip must stay at zero findings. Remove any export left unused, such as
  `UseQuickSavePopover` fields.

## Sub-project 4 — dropped

`ThemePicker` stays as it is. Its reasons:

- It is a `role="radiogroup"`, not a listbox, so R357 does not cover it.
- Each row is painted in its own theme (`data-theme`), and the System row and the Dark/Light
  tabs sit above the list. Neither fits `Listbox`'s group model.
- Moving it would grow `Listbox` (a leading slot plus per-option theming) for one caller, and
  the only gain would be arrow keys and type-ahead.

The user chose to drop it on 2026-09-26.

## Docs and rules

- **`.claude/rules/components.md` R328:**
  - Delete the "Not yet on `ui/Popup` (sub-project 3 …)" sentence.
  - Mention `side` in one clause.
  - Add a Prohibited line: "a `:focus-within` dropdown (daisyUI's CSS-only open state) as a
    popup". It sits beside the existing `<details>` line.
- **New ADR `docs/decisions/0056-popup-migration-complete.md`.** It is short and records:
  - the migration;
  - the latest-ref and capture-phase changes, and why;
  - `side`;
  - the panel `tabIndex={-1}`;
  - Tab-away now closing QuickSave;
  - no `role="menu"`;
  - sub-project 4 dropped, and why.

  Add its row to `docs/decisions/README.md`.
- **ADR-0055 is Accepted:** add a Status-line pointer to 0056 and nothing else.
- **Memory `scale-select-followups.md`:** mark items 2–4 done or dropped.

## Testing

`bun:test` with no DOM (`.claude/rules/testing.md`, the R257 trap).

- **Pure tests:** the listbox re-seed helper.
- **`renderToString`:**
  - **`Popup`:** `side="top"` renders `dropdown-top`; the open panel has `tabindex="-1"`.
  - **Dock:** each trigger is a `<button>` with `aria-expanded="false"` and no `role="button"`;
    no `<ul tabindex>`.
  - **`ProjectMenu`:** the `<button id="btn-project-menu">` trigger has `aria-expanded`; the
    closed menu renders no panel.
  - **`QuickSavePopover`:** closed renders no panel. Existing tests are updated to match; none
    is deleted without a replacement.
- **Browser check** (in-app preview, Chromium):
  - both dock menus at 375px and desktop: they open upward, a pick closes the menu, and
    Escape, an outside tap and Tab-away all close it;
  - ProjectMenu: a row that opens a modal hands focus into it, and closing the modal returns
    focus to the trigger;
  - QuickSave: the input is focused with its text selected, and Tab-away closes it;
  - a popup stays open when a pointerdown handler calls `stopPropagation` (capture);
  - the console shows no warnings.
- **Not checkable here:** Firefox and Safari, including the Space-keyup-after-commit check left
  from sub-project 2. The user checks these by hand.
- **Gate:** `bun run verify`, and `bun run eslint` with zero errors and zero warnings.

## Out of scope

- The 8 excluded scales, which get their own spec.
- `role="menu"` arrow-key navigation.
- `ThemePicker`.

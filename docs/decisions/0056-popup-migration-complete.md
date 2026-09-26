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

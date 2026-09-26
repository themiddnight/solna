# ADR-0055: Shared Popup and Listbox primitives

**Status:** Accepted — 2026-09-26. Amends [ADR-0044](0044-secondary-canvas-taxonomy.md) (R327, R328). No issue. Sub-project 3 completed, sub-project 4 dropped: [ADR-0056](0056-popup-migration-complete.md).

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

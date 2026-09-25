# Scale-type listbox: shared Popup and Listbox primitives — design

Sub-project 2 of 4 in the scale-select work. The others, each with its own spec:
(1) the scale library — done, ADR-0054;
(3) migrate the two `DockMenu`s in `ui/BottomInputDock.tsx`, `ProjectMenu` and `QuickSavePopover`
onto `ui/Popup`;
(4) move `ThemePicker`'s body onto `ui/Listbox`.

Branch `feat/scale-type-listbox`, no Linear issue.

## Goal

The header Scale Type selector works like murva's (`murva-app` `ScaleDropdown`, a Radix Select).
Each scale shows its name and a one-line description, grouped by category, with a check on the
selected one. Descriptions come from `SCALES[key].description`, which the scale library added.

## Decisions

- **Three composable layers**: a shared popup shell (`ui/Popup`), a shared listbox
  (`ui/Listbox`), and the header feature that composes them (`header/ScaleTypeListbox`).
- **Rejected: one Radix-style `ui/Select`.** It fuses trigger, popup and list. It cannot serve
  the compact header panel, where the list sits inline beside a root-note select. It cannot
  serve `ThemePicker`'s `popover="auto"` body or the sub-project 3 menus, which are popups
  without a list.
- **Rejected: `appearance: base-select`** (customizable `<select>`). It is Chromium-only, and it
  fails the same browser floor as R328.
- **Commit is explicit.** Arrow keys only move the highlight. A value commits on Enter, Space or
  click. `setScaleType` re-renders the app and can reharmonize, so browsing must not write.
- **The root note stays a native `<select>` everywhere.** `KeyChangeDialog` stays native too,
  because it lives inside a `Modal`.

## Layer 1 — `ui/Popup`

A controlled daisyUI dropdown shell.

**`src/components/ui/popupGeometry.ts`** (pure). `popupShift`, `panelNaturalRect` and
`isDismissKey` move here from `src/components/ui/useQuickSavePopover.ts`. That hook imports
them back, so its behaviour does not change, and their existing tests move with them.
`QuickSavePopover` itself is not migrated; that is sub-project 3.

**`src/components/ui/Popup.tsx`** with its colocated hook **`src/components/ui/usePopup.ts`**
(R265 colocated hook; R266 named, exported return type `UsePopup`).

Props: `open`, `onClose`, `trigger` (ReactNode), `align` (`'start' | 'end'`), `panelClassName`,
`initialFocusRef`, `children`.

It renders `<div class="dropdown dropdown-{align}">` containing the trigger, plus `dropdown-open`
while open. The panel (`dropdown-content z-50`) is mounted only while open and carries the
measured `translateX` shift.

`usePopup`:

- Closes on Escape, with `stopPropagation`, because the page is full of shortcut keys.
- Closes on a `pointerdown` outside the wrapper.
- Closes on a `focusout` that leaves the wrapper (Tab away). `QuickSavePopover` has no such
  close today.
- Focuses `initialFocusRef` on open. On close, it returns focus to the element that had focus
  before opening (the trigger).
- Measures the shift on open and on resize, via `popupShift` and `panelNaturalRect`.

## Layer 2 — `ui/Listbox`

**`src/components/ui/listboxKeys.ts`** (pure).

`listboxKey(state, key) → { active, commit }`:

- ArrowUp/ArrowDown move one option and stop at the ends. There is no wrap, as in a native select.
- Home/End jump to the first/last option.
- Enter/Space return `commit: true`.
- A printable single character jumps to the next option whose label starts with it
  (case-insensitive). The search wraps; if no label matches, the highlight stays put.
- Any other key is a no-op.
- An empty list never throws.

`isOpenKey(key)` is true for ArrowDown, ArrowUp, Enter and Space; the trigger uses it.

**`src/components/ui/Listbox.tsx`** with **`src/components/ui/useListbox.ts`**.

Props: `id`, `label` (becomes `aria-label`), `groups: { label, options: { value, label,
description? }[] }[]`, `value`, `onCommit(value)`.

- The root is `role="listbox"`, `tabIndex={0}`, with `aria-activedescendant`.
- Each group is `role="group"` with a visible heading referenced by `aria-labelledby`.
- Each option is `role="option"` with `aria-selected`.
- Option ids come from the flat index (`${id}-opt-${i}`), never from the value, because scale
  keys contain spaces.
- The highlight starts on the selected option. Hover moves it, and a click commits.
- The highlighted option is scrolled into view with `block: 'nearest'`.

YAGNI: there is no leading slot for theme swatches. Sub-project 4 adds one.

## Layer 3 — `header/ScaleTypeListbox`

**`src/components/ui/scaleGroups.ts`** exports `SCALE_GROUPS`: categories in
`SCALE_CATEGORIES` order, each holding its `SCALES` keys. `ScaleTypeOptions` (the native
options, still used by `KeyChangeDialog`) and the header listbox both use it, so it lifts to
`ui/` under R276.

**`src/components/header/ScaleTypeListbox.tsx`**, plus a colocated hook if it has logic.

**xl and up.** A trigger button replaces the scale-type `<select>` in place:

- Its width (`w-36`) and look match the old ghost select: bold text and a chevron. It shows the
  full display name, truncated with an ellipsis.
- It sets `aria-haspopup="listbox"` and `aria-expanded`.
- A click or an `isOpenKey` key opens a `Popup` (`w-80`). The list scrolls inside `max-h-96`,
  and the `Listbox` takes focus on the selected option.
- A commit closes the popup. Escape, an outside click or tabbing away also close it, and focus
  returns to the trigger.

**Below xl (compact, including mobile).** `src/components/header/ScaleMenu.tsx`'s `<details>`
dropdown moves onto `ui/Popup` in this sub-project. A `<details>` cannot close on Escape or on an
outside click, and its placement was hand-tuned with `dropdown-end`.

- The trigger (abbreviation plus chevron) does not change.
- The panel widens from `w-56` to `w-80 max-w-[calc(100vw-1rem)]`. `popupShift` keeps it inside
  a 375px screen.
- The panel holds the "Master Key & Scale" heading, the native root select, then the `Listbox`
  inline (`max-h-80 overflow-y-auto overscroll-contain`).
- On open, focus goes to the `Listbox` (its `initialFocusRef`), highlighting the selected scale.
- A commit does **not** close the panel, as today.
- R331's accepted trade-off still stands: a toast can cover a bar popup.

## Visuals (from murva)

- **Option row.** The name is `text-sm font-medium`. When the option is selected, the name also
  gets `text-primary` and a check icon sits on the right.
- **Description.** `text-xs text-base-content/70`. Murva uses `/45`, which is too faint for this
  repo's AA gate. The description wraps rather than truncating; the longest is 52 characters.
- **Active row.** `bg-base-200`.
- **Group heading.** `text-[11px] uppercase font-bold tracking-wider text-base-content/60`, which
  matches the existing "Master Key & Scale" heading.

## Complexity trade-off

This adds about 390 production lines:

| Part | Lines (approx.) |
|---|---|
| `Popup` + `usePopup` | 130 |
| `listboxKeys` | 50 |
| `Listbox` + `useListbox` | 150 |
| `ScaleTypeListbox` + `ScaleMenu` changes | 60 |
| `popupGeometry` | moved, not new |

Tests add about 250–300 lines.

A native select gave us keyboard handling, ARIA, scrolling and the OS picker for free. After
this change we own all of them, and DOM behaviour cannot be unit-tested in this repo.

The payoff comes with sub-project 3. Today popups dismiss through three mechanisms:

- CSS `:focus-within` with a `blur()` Safari workaround, in the dock menus and `ProjectMenu`;
- a hand-written hook, in `QuickSavePopover`;
- `<details>`, in `ScaleMenu`.

`ui/Popup` collapses these into one.

**Cheaper alternative, declined.** Keep the native select and show the selected scale's
description under it (about 20 lines). It shows no descriptions while browsing, and it lays no
foundation for sub-projects 3 and 4.

## Testing

`bun:test` with no DOM (`.claude/rules/testing.md`).

**Pure tests:**

- `listboxKey`: every case listed under Layer 2.
- `isOpenKey`.
- `popupGeometry`: the tests that move from `useQuickSavePopover`.
- `SCALE_GROUPS`: 24 entries, category order, no duplicates.

**`renderToString` tests:**

- **`Listbox`:** `role="listbox"`, `aria-label`, and `aria-activedescendant` pointing at the
  selected option; groups with headings; `aria-selected` and the check only on the selected
  option; descriptions shown.
- **`Popup`:** closed renders no panel; open renders `dropdown-open` and
  `dropdown-content z-50`.
- **Header:** the xl trigger has `aria-haspopup="listbox"` and the full name; the compact panel
  has both the root select and the listbox; the existing abbreviation test still passes. The
  header's optgroup tests move to `KeyChangeDialog`, which still uses `ScaleTypeOptions`.
- Mind the `renderToString` zustand trap (R257): the tests use `useAppStore.getInitialState()`.

**Browser check (preview):**

- the full keyboard path;
- Escape, an outside click and tabbing away;
- the panel inside a 375px viewport;
- description contrast in light and dark.

**Gate:** `bun run verify`, and `bun run eslint` with zero errors and zero warnings.

## Rules and docs

- **`.claude/rules/components.md` R327:** a quick in-place pick is a native `<select>` or
  `ui/Listbox`. Use `Listbox` when options need a description or more than one line of text.
  A pick inside a `Modal` stays native.
- **R328:** a new popup is built on `ui/Popup`. No hand-rolled dismissal or placement, and no
  `<details>` as a popup. Name the popups not yet migrated as sub-project 3 debt.
- **New R357:** a custom listbox is `ui/Listbox` only. It uses `aria-activedescendant` and
  handles keys through `listboxKey`; arrows move the highlight, and a value commits only on
  Enter, Space or click. Add matching `## Prohibited` lines for R327, R328 and R357.
- **New ADR `docs/decisions/0055-shared-popup-and-listbox.md`:** why three layers, the rejected
  alternatives, the complexity trade-off, and the plan for 3 and 4. Add its row to the index in
  `docs/decisions/README.md`.
- **Accepted ADRs are never rewritten.** `docs/decisions/0044-secondary-canvas-taxonomy.md` and
  `docs/decisions/0051-theme-picker.md` each get only a Status-line pointer to 0055.
- **`.claude/skills/music-theory/SKILL.md`:** one line saying the header scale type is a listbox
  with descriptions.

## Out of scope

- Sub-projects 3 and 4.
- The 8 excluded scales.
- The Phrygian Dominant spelling question.

# Mobile layout — design

**Issue:** DEV-431 "Mobile layout" (epic DEV-433). Builds on DEV-430 (ADR-0040).
**Branch:** `feat/dev-431-mobile-layout`.
**Status:** Approved design, made concrete (2026-09-23). §12 lists the decisions one per line.

**User-visible change:** below Tailwind's `md` (48rem) the app gets its own frame — a one-row top
bar (mark, loop picker, key, menu button), a menu sheet holding every other tool and the project
actions, and a bottom tab bar of four tabs that replaces the Loop/Song switch. At and above `md`
nothing changes on screen. Audio, the coordinators, `PlaybackHost` and the app-level dialogs are
untouched (R316), and every view stays mounted (R014).

---

## 0. Verified facts (checked against the code on this branch, @0d439627)

| # | Claim | Evidence |
|---|---|---|
| F1 | `Workspace` renders `DesktopShell` or `MobileShell` by `useLayoutMode()`, each with explicit `ShellProps`; the input deck gets the mode | `App.tsx:125-190`; `useInputDeck(mode)` `:130` |
| F2 | `MobileShell` is a verbatim copy of `DesktopShell`; `shells.test.tsx` pins their markup equal | `shell/MobileShell.tsx`; `shell/shells.test.tsx` "renders exactly the desktop markup" |
| F3 | Tabs: `LOOP_TABS = ['sound','pattern']`, `SONG_TABS = ['arrange','master']`; `layerForTab`/`isSongLayer` derive the layer; `VIEW_ORDER = [...LOOP_TABS, ...SONG_TABS]`; `VIEW_META` gives icon + `tabLabel` | `types.ts:51-76`; `components/viewMeta.ts` |
| F4 | Navigation state is `activeTab` only; the Header's tabs and layer switch both call `setActiveTab`; `useRouteSync` pushes `/loop|/song?tab=` from `layerForTab(activeTab)` | `Header.tsx` `LayerSwitcher`, `TabButton`; `routing/useRouteSync.ts:36-50` |
| F5 | `HEADER_TOOLS` rows: `loop-copy`, `loop-selector`, `project-name`, `follow-playhead`, `export`, `scale`, `theme`; `Component: ComponentType` (no props); `HeaderToolId`/`HeaderTool` are file-local | `header/headerTools.ts` |
| F6 | `ExportButton` renders its trigger **and** `ExportDialog`; `open` is local state in `useExportDialog`, called once at `ExportButton` (R268) | `export/ExportButton.tsx`, `export/useExportDialog.ts` |
| F7 | `ProjectMenu` is the wordmark dropdown; it owns the confirm dialog, the Drive browser, the pending overlay (`ProjectLoading overlay`, `fixed inset-0 z-50`), the hidden file input and the dev Diagnostics panel; rows come from `visibleMenuSections(...)` over `PROJECT_MENU_SECTIONS` | `project/ProjectMenu.tsx:86, 141, 351, 480, 519`; `ProjectLoading.tsx:26` |
| F8 | Every dialog is `ui/Modal`: a native `<dialog class="modal">` driven by `showModal()` (top layer, focus trap, Escape → `close` → `onClose`); `MODAL_BOX` is guarded against hand-written copies | `ui/Modal.tsx`; `ui/syncDialogOpen.ts`; `ui/fieldClasses.test.ts` "no component hand-writes the modal box chrome" |
| F9 | daisyUI (installed v5) `.modal-box` animates with `translate`/`scale` (a containing block for `position: fixed` descendants); `.modal-bottom > .modal-box` is full width, bottom-anchored | `node_modules/daisyui/components/modal.css` |
| F10 | daisyUI `.menu :where(li:not(.menu-title) > :not(ul,menu,details,.menu-title,.btn))` sets `display: grid` — a `<dialog>` placed inside a menu `li` would be restyled | `node_modules/daisyui/components/menu.css` |
| F11 | daisyUI `.dock` is `position: fixed; bottom: 0`, height `calc(4rem + env(safe-area-inset-bottom))`, `padding-bottom: env(safe-area-inset-bottom)`; items get `.dock-active`/`.dock-label`; it lives in a nested layer under `utilities`, so a Tailwind utility (`relative`) overrides its position | `node_modules/daisyui/components/dock.css`; daisyui.com/components/dock |
| F12 | `TransportBar` (memo, no props) carries `py-1.5 sm:py-2 pb-safe sm:pb-safe-lg`: it consumes the bottom safe-area inset today; the root `div` handles left/right insets | `TransportBar.tsx:229, 313`; `index.css` `@utility pb-safe`; `App.tsx:167` |
| F13 | `BottomInputDock` costs no height when collapsed: its toggle strip floats `absolute bottom-full`; `<main>`'s `pb-9` reserves that strip | `ui/BottomInputDock.tsx`; `shell/DesktopShell.tsx` comment |
| F14 | `LoopSelector` (select, caption hidden below `sm`), `ScaleMenu` (compact `details` below `xl`) and `ProjectNameLabel` (`input-xs`) already have compact forms; their controls are `select-sm`/`btn-sm`/`input-xs` (under 44px tall) | `loop/LoopSelector.tsx`; `header/ScaleMenu.tsx`; `header/ProjectNameLabel.tsx` |
| F15 | `Wordmark` is always `role="button" tabIndex={0}` (it is the dropdown trigger) | `ui/Wordmark.tsx` |
| F16 | Latest rule id R317, latest ADR 0040 | `.claude/rules/components.md`; `docs/decisions/README.md` |

---

## 1. Goal

A phone gets a frame built for it — navigation at the thumb, one compact top row, everything else
one tap away — as a rendering change inside `MobileShell`, reusing the tab model, `HEADER_TOOLS`
and the project menu's data, with no new navigation state.

## 2. Non-goals

- No desktop change on screen (§9 removes only class halves that can no longer apply).
- No change to `Workspace`, `PlaybackHost`, the coordinators, routing, the store or any view's
  internals. No new slice, no persisted UI state (R016).
- No redesign of `TransportBar`, `InstantVibesBar` or the input dock for phones (follow-ups).

---

## 3. Target layout

```
src/components/shell/
  MobileShell.tsx          the mobile frame (§4) — rewritten
  MobileTopBar.tsx         top bar + menu sheet (§5, §6)
  useMobileTopBar.ts       MOBILE_BAR_TOOL_IDS, mobileHeaderTools(layer), useMobileTopBar()
  MobileTabBar.tsx         bottom tab bar (§7); MOBILE_TABS
  mobileShell.test.tsx     replaces the parity half of shells.test.tsx (§10)
src/components/ui/MenuRowButton.tsx    ToolVariant + the menu-row button (§6.2)
src/components/project/useProjectMenu.ts   the menu's state and commands, lifted out of ProjectMenu.tsx
```

Changed: `header/headerTools.ts` (tool props type, `headerToolsOn`), `LoopCopyButton`,
`ThemeToggle`, `FollowPlayheadToggle`, `ExportButton` (a `row` variant), `project/ProjectMenu.tsx`
(split: `ProjectMenuSections`, `ProjectMenuEffects`), `ui/Modal.tsx` (`placement`, `afterBox`),
`ui/Wordmark.tsx` (`interactive`), `TransportBar.tsx` (`bottomInset`), `Header.tsx` (dead
below-`md` class halves), `shells.test.tsx`, `appChildMemo.test.tsx`.

**Placement (R276).** Everything mobile-only lives in `shell/`. `MenuRowButton` and `ToolVariant`
are used by `header/`, `export/` and `loop/` → `ui/`. `useProjectMenu` has two consumers
(`ProjectMenu`, the sheet) and stays in `project/`, its feature.

## 4. `MobileShell`

Order, top to bottom:

```
MobileTopBar                         (§5) sticky, one row
InstantVibesBar                      loop layer only — unchanged rule
<main flex-1 min-h-0 overflow-y-auto pb-9>  <LayerPages/>   R014 level 1, unchanged
BottomInputDock                      collapsed = 0 height; toggle floats over main's pb-9
UpdateBanner
TransportBar bottomInset={false}
MobileTabBar                         (§7) owns env(safe-area-inset-bottom)
```

- **Tab bar last.** The platform convention and the thumb's natural reach; the transport sits
  directly above it, so play/stop stay one reach away on every tab. The dock and the banner stay
  above the transport exactly as on desktop.
- **One bottom inset.** Exactly one element consumes `env(safe-area-inset-bottom)` per frame: the
  tab bar (daisyUI `dock` builds it into its height and padding, F11). `TransportBar` gains
  `bottomInset?: boolean` (default `true`, desktop unchanged); `false` drops `pb-safe
  sm:pb-safe-lg` and its `py-*` pads the bottom again.
- **Vertical budget** at 667px (iPhone SE): top bar ≈ 57, vibes bar ≈ 40 (loop layer), transport
  two rows ≈ 72, tab bar 64 → ≈ 430px of scrolling view. Accepted; a slimmer phone transport is a
  follow-up (§11 K5).
- `MobileShell` selects `activeTab` and `setActiveTab` (one value per selector, R274) and passes
  both to `MobileTabBar`. `PlaybackHost` is untouched and stays in `Workspace`.

## 5. The top bar

```
<header navbar>  [mark]  [bar tools … flex-1, right-aligned]  [☰]
```

- **Mark:** `Wordmark markOnly interactive={false}` — on the phone the wordmark is not the project
  menu (its actions move into the sheet, §6.3), so it must not pose as a button. New
  `interactive?: boolean` (default `true`): `false` renders no `role="button"`/`tabIndex`, no hover,
  and `role="img" aria-label="Solna"`. Mark only: at 360px the text's ~74px is what the loop
  picker needs.
- **Bar tools:** `mobileHeaderTools(layer).bar` — the rows of `HEADER_TOOLS` available on the
  layer whose id is in `MOBILE_BAR_TOOL_IDS = {'loop-selector', 'scale', 'project-name'}`, in list
  order, each `<Component key={id} />`. Loop layer: loop picker + key. Song layer: the project name
  — the song layer's subject, mirroring the loop picker, so the top bar also tells which layer is
  shown now that there is no layer switch. The rule: **field-shaped tools (select, input) sit
  inline; button-shaped tools go in the menu.**
- **Touch height:** the bar-tools container raises its descendants' controls to 44px
  (`[&_select]:min-h-11 [&_summary]:min-h-11 [&_input]:min-h-11`) without touching the shared
  components (F14).
- **Menu button:** `IconButton` `id="btn-mobile-menu"`, label "Menu", `aria-haspopup="dialog"`,
  `aria-expanded={menuOpen}`, `className="min-h-11 min-w-11"`, lucide `Menu` icon.
- `useMobileTopBar()` (colocated, R265): selects `activeTab`, derives `layer`, owns `menuOpen`
  (`useState`, local — R016), returns `{ layer, bar, menu, menuOpen, openMenu, closeMenu }` as the
  exported `UseMobileTopBar`. `MobileTopBar` is `React.memo`.

## 6. The menu sheet

### 6.1 Container and lifetime

`MobileMenuSheet` (in `MobileTopBar.tsx`, above the root, R267) is a `Modal` with
`placement="bottom"`, title "Menu", always rendered (`open={menuOpen}`) — so its content stays
mounted while closed, like every other `Modal`. It closes **only** on dismissal: Escape, the
backdrop, the close button. Tapping a row never closes it.

Why that rule is the smallest correct one (the DEV-430 review's constraint): the tools own their
dialogs (F6) and the project menu owns its overlays (F7). A row that closed the sheet would have to
close it *around* a dialog the sheet's subtree still owns. Staying open costs nothing: a dialog a
row opens is a nested `showModal()` — it enters the top layer above the sheet, Escape closes the
topmost first, and focus returns into the sheet when it closes. Rejected: lifting `ExportDialog`
and the project dialogs to `Workspace` (widens R316's dialog list and breaks R268's
"hook called once at the trigger" for export); closing on row tap and portaling each dialog
(a portal per tool, and the pending overlay still loses its stacking context).

`Modal` gains two optional props, both inert by default (desktop markup unchanged):
- `placement?: 'middle' | 'bottom'` — `'bottom'` adds `modal-bottom` to the `<dialog>`, drops the
  size class (daisyUI makes the box full width), adds
  `pb-[calc(1.5rem+env(safe-area-inset-bottom))]` to the box and `min-h-11 min-w-11` to the close
  button.
- `afterBox?: ReactNode` — rendered inside the `<dialog>`, after the box: for fixed overlays that
  the box's `translate` would otherwise contain (F9).

### 6.2 Tool rows

`mobileHeaderTools(layer).menu` — every other tool available on the layer, in `HEADER_TOOLS`
order, each rendered `<Component key={id} variant="row" />` inside a plain
`<div className="flex flex-col gap-1">` — **not** a daisyUI `menu`, because `ExportButton`'s
`<dialog>` would be restyled inside a menu `li` (F10).

| Layer | Menu tools |
|---|---|
| loop | `loop-copy` (Copy loop), `theme` |
| song | `follow-playhead`, `export`, `theme` |

**Row rendering is a component variant, not a descriptor label.** `HEADER_TOOLS`' `Component`
becomes `ComponentType<HeaderToolProps>` with `HeaderToolProps = { variant?: ToolVariant }`,
`ToolVariant = 'bar' | 'row'` (default `'bar'`: today's markup). A static label field would be
wrong for three of the four: the theme row names the theme it switches to, follow is a pressed
state, export shows the job's progress — the component already owns that copy. Each menu tool
renders, for `row`, a `MenuRowButton` (`ui/MenuRowButton.tsx`): `btn btn-ghost btn-block
justify-start gap-3 min-h-11 text-sm font-semibold`, icon + visible label, same `id` as its bar
form (one frame is mounted at a time). `ExportButton`'s `row` swaps only the trigger; its
`ExportDialog` renders beside it as today. Field tools ignore the prop.

No placement field on the descriptor (ADR-0040 rejected one): the split is
`MOBILE_BAR_TOOL_IDS` in the mobile top bar — a rendering choice. `headerToolsOn(layer)` (all
groups, list order) joins `headerToolsFor(layer, group)`; `HeaderToolId`, `HeaderTool` and
`HeaderToolProps` become exports.

### 6.3 Project rows — inline, not nested

Below the tool rows: `<ul className="menu w-full p-0">` with a `menu-title` "Project", then
`ProjectMenuSections` — the same `visibleMenuSections` rows and headings (Local, Drive + account,
Tools) the dropdown shows. **Inline, not a nested menu:** a sheet already scrolls
(`max-height: calc(100vh - 5em)`), a submenu is a second tap and a hover idiom on touch, and the
sections are already titled.

`ProjectMenu.tsx` splits so both frames share one source:
- `useProjectMenu()` (`project/useProjectMenu.ts`, R265/R266): today's `ProjectMenu` state
  (`confirming`, `browser`, `pending`, `diagnosticsOpen`, `fileInputRef`), `useProjectFileCommands`,
  the store reads, `sections` (`visibleMenuSections(...)`), `choose` and `onConfirmReplace`;
  returns `UseProjectMenu`. Called once per frame's root (R268).
- `ProjectMenuSections({ sections, onChoose, rowClassName? })` — the `li` rows; the sheet passes
  `rowClassName="min-h-11"`.
- `ProjectMenuEffects({ menu })` — the file input, `ConfirmDialog`, `DriveFileBrowserModal`, the
  pending overlay and the dev Diagnostics panel.
- `ProjectMenu` (desktop) = `div.dropdown` + `Wordmark` + `ul` + `ProjectMenuEffects`, markup
  byte-identical to today.

The sheet renders `ProjectMenuEffects` through `afterBox`: the nested dialogs reach the top layer,
and the pending overlay covers the sheet from inside its dialog (it would sit *under* a top-layer
sheet anywhere else, and inside the box it would be clipped to the box, F9).

### 6.4 Accessibility

Native `showModal()`: focus moves into the sheet, the rest of the page is inert, Escape closes,
focus returns to the menu button on close. `aria-expanded` mirrors `menuOpen`. Rows are real
`<button>`s with visible text; toggles keep `aria-pressed`; the export row keeps
`aria-haspopup="dialog"` and `aria-busy`. Every new control is ≥ 44px.

## 7. The tab bar

```tsx
export const MOBILE_TABS: readonly ViewMode[] = VIEW_ORDER;   // sound, pattern, arrange, master
<nav aria-label="Views" className="dock relative z-40 shrink-0 border-t border-base-300">
  <button id={`tab-${view}`} aria-current={active ? 'page' : undefined}
    className={active ? 'dock-active text-primary' : undefined} onClick={() => onSelect(view)}>
    <Icon className="size-5" aria-hidden="true" /><span className="dock-label">{tabLabel}</span>
  </button> …
</nav>
```

- `MobileTabBar({ activeTab, onSelect })`, `React.memo`, props only (renders under
  `renderToString` without the R257 trap). `onSelect` is the store's `setActiveTab` — the **same**
  action the desktop tabs and layer switch call (F4). The layer follows from the tab
  (`layerForTab`), the URL follows through `useRouteSync`: no layer switch, no second navigation
  state, no new route logic.
- `relative` puts the fixed daisyUI dock back in the flex column (F11); plain `dock` (md size)
  because its items are 48px tall, `dock-sm`'s 40px.
- Icons and labels from `VIEW_META` — the same table as the desktop tabs.
- The loop/song grouping is carried by order (loop tabs first) and by the top bar's subject (loop
  picker vs project name); no divider element (a `dock` child would become an item).

## 8. Theme and tokens

Only theme tokens (`bg-base-100`, `border-base-300`, `text-primary`, daisyUI component colours);
no new colour, so `bun run check:contrast` and the theme guard are unaffected. Classes used —
`dock`, `dock-active`, `dock-label`, `modal`, `modal-bottom`, `modal-box`, `menu`, `menu-title`,
`btn`, `btn-ghost`, `btn-block`, `btn-square` — are verified against the installed daisyUI v5 CSS
and daisyui.com.

## 9. Desktop

`DesktopShell`, `Header`, `HeaderToolRun` and the desktop tabs render as today. `Header` now only
ever renders at ≥ 48rem, so its own below-`sm` halves are dead; they collapse to the `sm:`/`md:`
value that already applies there (`px-4`, `gap-x-3`, `flex-nowrap`, no `gap-y-2`, `gap-2.5`,
`gap-1.5`, `ProjectMenu` without `textClassName`) — pixel-identical at ≥ 48rem. Shared components
(`LoopSelector`, `ScaleMenu`, `TabButton`, `TransportBar`) keep theirs: they render in both
frames. `xl:` halves are live on desktop and stay.

## 10. Tests

- **Dropped:** "the mobile shell renders exactly the desktop markup (for now)" (DEV-431 replaces it,
  as it said).
- **`shell/mobileShell.test.tsx`:** the mobile shell has a `dock` nav with exactly four
  `tab-*` buttons in `sound, pattern, arrange, master` order, `btn-mobile-menu`, the transport
  without `pb-safe`, the tab bar after the transport, and no `id="layer-loop"`/`layer-song` and no
  `navbar` desktop header; `MobileTabBar` with each `activeTab` marks exactly that tab
  `aria-current="page"` + `dock-active`; `MOBILE_TABS` maps through `layerForTab` to
  `loop, loop, song, song`; `mobileHeaderTools('loop')` = bar `loop-selector, scale` / menu
  `loop-copy, theme`, `('song')` = bar `project-name` / menu `follow-playhead, export, theme`;
  every tool is in exactly one of the two lists on every layer it is available; `MobileMenuSheet`
  rendered per layer contains its menu tools' ids and `project-menu-new`, never the other layer's
  tools, and no `<dialog` inside an `li`.
- **Row variants:** each menu tool with `variant="row"` renders `min-h-11` and a visible label; with
  no prop, its markup is today's.
- **Desktop unchanged:** `shells.test.tsx` keeps the desktop markers and R316 source checks (the new
  shell files join the list) and asserts the desktop shell has no `dock`/`btn-mobile-menu`;
  `ProjectMenu` renders byte-identically before/after the split (Header/ProjectMenu tests
  unchanged); `Modal` default markup unchanged, `placement="bottom"` adds `modal-bottom`.
- **`appChildMemo.test.tsx`:** `MobileTopBar` and `MobileTabBar` join `CASES`.
- `Wordmark interactive={false}` renders no `role="button"`/`tabindex`.

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | A dialog opened from the sheet hides when the sheet closes | Sheet closes only on dismissal; nested `showModal()` is topmost, so it must close first |
| K2 | Escape/back closes the sheet while a save is pending, hiding its overlay | The save still completes and reports through `ProjectNotice`; accepted |
| K3 | `dock` stays `position: fixed` and covers the transport | `relative` (F11); manual check at 390px in the plan |
| K4 | Two bottom insets, or none | One consumer rule (§4); `bottomInset` test |
| K5 | Phone vertical space | Budget §4; slimmer transport is a follow-up |
| K6 | Desktop drift from the `ProjectMenu` split or `Modal` props | Byte-compare tests, defaults inert |

## 12. Decisions for review

1. Mobile order: top bar, vibes (loop), main, dock, banner, transport, **tab bar last**; the tab bar owns the bottom inset (`TransportBar bottomInset={false}`).
2. Tab bar = `VIEW_ORDER` → `setActiveTab`; daisyUI `dock` made `relative`; no layer switch.
3. Top bar: mark only (non-interactive), `loop-selector`/`scale` (loop) or `project-name` (song) inline, menu button.
4. Split by `MOBILE_BAR_TOOL_IDS` in the mobile top bar: fields inline, buttons in the menu; no descriptor field.
5. Row rendering = `variant: 'bar' | 'row'` prop on the tool component, `ui/MenuRowButton`; not a descriptor label.
6. Sheet = `Modal placement="bottom"`, always mounted, closes only on dismissal; launched dialogs stack above it.
7. Project actions inline in the sheet; `ProjectMenu` split into `useProjectMenu` + `ProjectMenuSections` + `ProjectMenuEffects`; effects via `Modal`'s `afterBox`.
8. Tool rows in a plain column, not a daisyUI `menu` (dialog-in-`li` restyle).
9. Inline field tools raised to 44px by the top bar's container, shared components untouched.
10. `Header`'s dead below-`sm` class halves removed; shared components keep theirs.
11. ADR-0041; R318–R321 new; R317 text gains the `variant` prop.

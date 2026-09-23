# ADR-0041: Mobile frame — bottom tabs, top bar, menu sheet

**Status:** Accepted — 2026-09-23. DEV-431. R320 amended by [0044](0044-secondary-canvas-taxonomy.md).

## Context

DEV-430 left `MobileShell` a copy of the desktop frame; on a phone the Header wrapped to several
rows, the Loop/Song switch plus two tabs cost a row of their own, and the tools were icon-only at
32px; the DEV-430 review found `HEADER_TOOLS` could place a tool inline but not as a menu row
(`ExportButton` owns its dialog; no row label).

## Decision

- Frame order with the tab bar last and owning the bottom inset: top bar, vibes bar (loop layer),
  `<main>`, input dock, update banner, transport, tab bar.
- `MobileTabBar` over `VIEW_ORDER` → `setActiveTab`; the daisyUI `dock` is made `relative` so it
  rejoins the frame's flex column instead of floating fixed.
- The top bar is a static wordmark (mark and "solna") plus the layer's field tools inline, split
  by `MOBILE_BAR_TOOL_IDS`, and a 44px menu button. The field tools keep their desktop heights,
  so the bar is no taller than it needs to be.
- The sheet is a `Modal` with `placement="bottom"`, always rendered, closed only by dismissal;
  tool rows render via `variant="row"`/`MenuRowButton` in a plain column, project rows render
  inline from `useProjectMenu` with `ProjectMenuEffects` in `afterBox`.
- `Header` lost its dead below-`sm` class halves, since it now only ever renders at or above `md`.

## Rejected alternatives

- A Loop/Song switch on the phone (the tab already names the layer).
- A nested project submenu (a second tap, a hover idiom on touch; the sections are titled).
- A `label` field on the descriptor (theme, follow and export labels are state-dependent).
- A placement field (ADR-0040's rejection stands — a choice of ids).
- Closing the sheet on row tap (it would hide a dialog the row just opened).
- Lifting `ExportDialog` and the project dialogs to `Workspace` (widens R316, breaks R268 at the
  export trigger).
- A portal per tool.
- Tool rows as a daisyUI `menu` (restyles a `<dialog>` inside an `li`).
- `dock-sm` (items under 44px).
- A phone-specific `TransportBar` (follow-up).

## Consequences

The sheet stays open under a launched dialog until dismissed; Escape during a pending save closes
the sheet and hides the overlay while the save completes and still reports through
`ProjectNotice`; the phone loses about a third of its height to chrome on the loop layer (a
slimmer transport is the next lever); ids are shared between frames because only one is mounted.

**Amends [ADR-0040](0040-layout-shell.md):** `MobileShell` is no longer a copy; `HEADER_TOOLS`'
`Component` takes `ToolVariantProps`.

## Rules this implies

- **R318** — Mobile navigation is `MobileTabBar` (`components/shell/MobileTabBar.tsx`): the
  `VIEW_ORDER` tabs, each calling `setActiveTab`; the tab implies the layer (`layerForTab`); the
  mobile frame has no layer switch, no second navigation state and no route logic of its own.
- **R319** — The mobile top bar splits `HEADER_TOOLS` by id (`MOBILE_BAR_TOOL_IDS`,
  `components/shell/useMobileTopBar.ts`): field tools inline, every other available tool in the
  menu sheet as `variant="row"`; a tool that can reach the menu renders a `MenuRowButton` for
  `row`; the descriptor gains no placement or label field.
- **R320** — The mobile menu sheet is a `Modal` with `placement="bottom"`, always rendered and
  closed only by dismissal; what a row opens renders inside the sheet's dialog — a nested dialog,
  or `afterBox` for a fixed overlay — never inside a daisyUI `menu` item.
- **R321** — Exactly one element per frame consumes `env(safe-area-inset-bottom)`: `TransportBar`
  on desktop, `MobileTabBar` on mobile (`TransportBar bottomInset={false}`).

## Sources

DEV-431, DEV-433; the spec and this plan; ADR-0001, ADR-0040.

# ADR-0040: Layout shell and one layout-mode switch

**Status:** Accepted — 2026-09-22. DEV-430

## Context

The mobile epic DEV-433 needs a different frame on a phone (DEV-431: bottom nav of four tabs, top
bar with a menu); the frame was hard-wired in `Workspace` beside the coordinators, the host and
the dialogs; the Header's tools were inline JSX with two kinds of layer gate (inline
`layer === 'loop' &&`, and song-only components returning `null`); the theme still lived in
`Header.tsx` (audit U7).

## Decision

- `useLayoutMode()` — `useSyncExternalStore` over one `(min-width: 48rem)` MediaQueryList,
  Tailwind v4's default `md`, server snapshot desktop, created lazily.
- `Workspace` keeps the coordinators, the root `div`, `PlaybackHost` (first child of the root) and
  the three dialogs, and renders `DesktopShell` or `MobileShell`.
- The shells own `Header`, `InstantVibesBar`, `<main>`, `BottomInputDock`, `UpdateBanner`,
  `TransportBar`; `LayerPages` is the shared layer gate. `MobileShell` is a deliberate copy until
  DEV-431.
- `HEADER_TOOLS` — seven rows with `id`, `Component`, `layers`, `group` (`subject` before the tab
  nav, `actions` after). `ProjectMenu`, the layer switch and the tab nav are structural. The tools
  and the theme moved to `components/header/`.
- No breakpoint class removed.

## Rejected alternatives

- A store slice or a persisted override for the mode (R016; no requirement for an override).
- CSS-only responsive frames (both frames' markup mounted at once, doubling every always-mounted
  view).
- `pointer: coarse` or user-agent detection (a tablet with a keyboard should get the desktop
  frame; width is what the `md:` classes already use).
- Keeping the host, the input deck or the dialogs inside the shells (a switch would remount them
  — the arp and held notes would reset).
- A `placement`/`priority` hint on the descriptor (the mobile split is a choice of ids — YAGNI).
- `ProjectMenu`, the layer switch or the tab nav as tools (DEV-431 replaces them, it does not
  relocate them).

## Consequences

A layout switch remounts the frame: UI state inside it (scroll, open menus, a drag in progress,
meter history) resets, audio does not stop (R040), nothing committed is lost. Crossing 48rem is a
rotation or a resize, so this is rare. Two consequences of that remount:

- A note held on the on-screen keyboard would hang, because the remounted `KeyCap` never gets its
  own mouseup/touchend. `Workspace` passes the mode to `useInputDeck`, which releases every held
  note on a mode change, the same way it does on a keyboard-mode change.
- An effects-knob drag cut off by a switch can leave the engine at the dragged value while the
  store keeps the committed one, until the next effects write. Accepted: a rotation mid-drag is
  rare.

R014's first level moved from `App.tsx` to
`shell/LayerPages.tsx`. U7's theme half is closed. The golden and `bun run verify` did not change.

**Amends [ADR-0001](0001-always-mounted-views.md)** (R014's first gating level, now
`shell/LayerPages.tsx`), **[ADR-0039](0039-playback-host.md)** (the host's position: first child
of `Workspace`'s root, before the shell), **[ADR-0022](0022-persist-write-path-and-guarded-storage.md)**
(R244's example path) and **[ADR-0035](0035-export-feature.md)** (R293/R295: the Header's tool
list).

## Rules this implies

- **R315** — The layout mode is `useLayoutMode()` (`components/shell/useLayoutMode.ts`): viewport
  width at Tailwind's `md`, never persisted, never a slice, no user override; nothing else reads
  the viewport to pick a frame.
- **R316** — `Workspace` owns everything that must survive a layout switch — the coordinators,
  `PlaybackHost` and the app-level dialogs; a shell (`DesktopShell`, `MobileShell`) owns only the
  visible frame and never mounts one of those.
- **R317** — A Header tool is a `HEADER_TOOLS` row (`components/header/headerTools.ts`) whose
  `layers` is its only availability gate; a new tool is a row, never JSX in `Header.tsx`, and
  never gates itself on the layer.

## Sources

DEV-430, DEV-431, DEV-433; `docs/superpowers/specs/2026-09-22-dev-430-layout-shell-design.md`;
`docs/superpowers/plans/2026-09-22-dev-430-layout-shell.md`; ADR-0001, ADR-0022, ADR-0035,
ADR-0039.

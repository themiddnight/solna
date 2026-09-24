# ADR-0049: Per-view scroll memory

**Status:** Accepted — 2026-09-24.

## Context

Each frame has one vertical scroll container (`<main>` under `ShellBody`), and every tab view and
Pattern segment stays mounted inside it, toggled `block`/`hidden` (R014). Switching from a long
view to a short one clamped `scrollTop` to the short view's bottom — Accompaniment at 900 opened
Lead at 255, its last row — and the clamp's scroll event flashed the macOS overlay scrollbar.
Every view shared one position, so none kept its own.

## Decision

`ViewScrollArea` (`components/shell/ViewScrollArea.tsx`) renders the container for both frames,
and its hook `useViewScrollMemory` remembers the position per visible view.

- **The key** is the active tab, plus the Pattern segment on Pattern (`viewScrollKey`:
  `sound`, `pattern:lead`, `pattern:accompaniment`, `pattern:beat`, `arrange`, `master`). The
  three accompaniment focuses share one key because they share one segment.
- **Record from the scroll listener, restore in a layout effect.** A passive `scroll` listener
  records `scrollTop` against the current key. When the key changes, a `useLayoutEffect` sets
  `scrollTop` to the new key's saved value (0 on a first visit) before paint, so the clamped
  position is never shown. The outgoing value is never read at the switch: by then the DOM has
  switched and the value may already be clamped.
- **The switch's own events are ignored.** The clamp and the restore each fire a scroll event a
  frame later. `switchTo` opens a settling window and a `requestAnimationFrame` closes it; the
  frame's scroll events are dispatched before its animation-frame callbacks, so they fall inside
  the window and are recorded against neither view.
- **The memory lives in the hook** (`useState`), never in a slice and never persisted (R016); a
  layout switch remounts the frame and may drop it.
- The container is its own component so a view switch re-renders only it; `ShellBody` passes the
  pages as `children`, which do not re-render with it.

### Rejected alternatives

- **One scroll container per view or segment.** No shared position to clamp, but every view would
  need its own bounded height and the dock's floating header strip (`pb-9`) repeated per view — a
  bigger layout change for the same result.
- **Positions in the ui slice.** A scroll position is high-frequency state; a slice write
  re-renders every mounted view (R016), and nothing needs it across a reload.

## Consequences

- Returning to a view lands where it was left; a new view opens at the top.
- A dock height change (keyboard ↔ pads) can still clamp the current view; that clamp is recorded
  as the view's real position, since the view did not change.

## Rules this implies

- **R342** — the frame's one scroll container remembers its position per visible view and restores
  it before paint; positions come from its scroll listener, the switch's own events are ignored,
  and the memory never enters a slice (mirrored in `.claude/rules/components.md`).

## Sources

Branch `feat/input-target-link`, `work/checkpoint.md` (browser measurement at 402px).

# ADR-0014: Loop delete is atomic, seamless and undoable

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

Deleting the active loop needs a fallback loop to become active. If the removal and the install of
the fallback are separate writes, a subscriber can observe an `activeLoopId` whose content the flat
slices do not hold. If the transport stops on delete, deleting a loop interrupts playback; if it
does not stop and nothing is cut, the deleted loop's sustained voices keep sounding its key for
bars. A confirm dialog before delete is the usual guard against a mistaken delete, at the cost of an
interruption on every intended one.

## Decision

**Deleting a loop is one atomic write, and it can be undone.** `deleteLoop` removes the loop and,
when it was the active one, installs the fallback loop's per-loop fields in the same `set()` — the
shape `projectSlice.reconcileActiveLoop` writes — so no caller follows up with `loadLoop` and no
subscriber sees an `activeLoopId` whose content the flat slices do not hold.

That write is pure state and touches no audio; the UI calls `deleteLoopLive` (`store/loadLoop.ts`),
which wraps it in `crossLoopSeam` — the helper `loadLoop`'s `atBoundary` path uses — when the
transport is running the loop being deleted. **The transport never stops.** Instead the deleted
loop's voices are cut at `LOAD_LOOP_RELEASE` (every accompaniment bus, plus the melody grids'
sequencer-owned notes) and the clock is reset, so the fallback enters at step 0 and song advance
counts a whole pass of it. A full-hold chord, bass or pad is booked to end at its chord change and a
drone at pass end, so leaving them to "ring out" would sound the deleted loop's key for bars. Only
an audition scoped to the deleted loop stops.

`deleteLoop` returns a `DeletedLoop` snapshot that `restoreLoop` puts back at its index without
activating it. The Arrange view offers that as a timed Undo toast instead of a confirm dialog, and
`undoLoopDelete` re-activates a restored active loop through the same seam (or `loadLoop` when
nothing plays), so Undo never stops the transport either. A project install dismisses a pending
Undo (`projectInstallCount`), because loop ids collide across projects.

## Consequences

- Rejected alternative: a confirm dialog. The Undo toast lets an intended delete proceed without
  interruption while keeping a mistaken one recoverable.
- Rejected alternative: letting the deleted loop's voices ring out — full-hold and drone voices are
  booked to their chord change or pass end, so they would sound the deleted key for bars.
- Callers never need a follow-up `loadLoop`; a subscriber can never see a half-applied delete.
- Voice cutting relies on owner-scoped release of sequencer notes
  ([ADR-0017](0017-voice-identity-and-ownership.md)).
- An Undo can never restore a loop into a different project than the one it was deleted from.

## Rules this implies

- **R149** — `deleteLoop` is one `set()` that also installs the fallback loop's fields
  (`projectSlice.reconcileActiveLoop` shape); callers never follow with `loadLoop`.
- **R150** — `deleteLoop` touches no audio; the UI calls `deleteLoopLive` (`store/loadLoop.ts`),
  which wraps it in `crossLoopSeam` when the transport runs the deleted loop.
- **R151** — The transport never stops on delete: deleted loop's voices cut at
  `LOAD_LOOP_RELEASE`, clock reset, fallback enters at step 0.
- **R152** — Only an audition scoped to the deleted loop stops.
- **R153** — `deleteLoop` returns `DeletedLoop`; `restoreLoop` reinserts at its index without
  activating.
- **R154** — Arrange offers a timed Undo toast (not a confirm); `undoLoopDelete` reactivates via
  the same seam (or `loadLoop` when idle); Undo never stops the transport.
- **R155** — A project install dismisses a pending Undo (`projectInstallCount`).

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 486-501.

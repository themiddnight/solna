# ADR-0033: Batch key change across loops

**Status:** Accepted — 2026-09-22. DEV-427 (epic DEV-433).

## Context

A key change reached only the active loop: the Header's key/scale controls wrote the flat
`AppStore` fields, so any other loop kept its old key until it was opened and changed by hand.
PR 1 of this epic ([ADR-0032](0032-key-change-as-loop-content-operation.md)) made `changeKey`
loop-agnostic — a pure function over any `KeyChangeSource`, the flat store or a `Loop` — which is
what makes a batch operation over several loops at once possible without a second harmonize
implementation.

## Decision

`changeKeyAcrossLoops` (`store/loopKeyChange.ts`) runs `changeKey` over every selected loop and
returns the updated `loops[]` plus a `LoopKeySnapshot[]` of each changed loop's pre-change key
fields. `applyLoopKeyChange` and `undoLoopKeyChange` (`store/loopKeyChangeSlice.ts`) are each one
`set()`: non-active loops land in `loops[]`, and the active loop's new (or restored) key fields
ride as flat values in the same partial, so engineSync and the grids follow immediately — the
same path a Header key change already takes. Neither action goes through `crossLoopSeam` or
`loadLoop`; there is no audible transport event for a metadata write to a loop that is not
playing, and the active loop's own write is already one atomic `set()`.

A target is either **Set** (every selected loop moves to one `{ root, scaleType }`) or
**Transpose** (`transposeRoot` shifts each loop's own root by the same interval and keeps its
existing scale type) — `BatchKeyTarget`. `transposeRoot` reads and writes through `ROOTS`, so a
transposed root is always `ROOTS`-spelled like every other stored root (R064).

The undo snapshot (`LoopKeySnapshot`) holds exactly the fields `changeKey` can write —
`scaleRoot`, `scaleType`, `chords`, `leadMelodySteps`, `fxMelodySteps` — and nothing else: it
restores the key change, not the loop's state as a whole. An Undo therefore reverts those five
fields to their pre-batch value even if something else wrote one of them during the Undo window
(a Header key change, a chord edit, a lead note recorded while armed); every other field on the
loop — knobs, drums, mix — is untouched and keeps whatever it holds at Undo time. It is
session-only and single-level,
matching the loop-delete Undo ([ADR-0014](0014-atomic-loop-delete-with-undo.md)): a second batch
key change replaces the pending Undo rather than stacking, and a project install dismisses it,
because loop ids collide across projects. A loop deleted between the apply and the undo is
simply absent from `loops[]` and its snapshot entry is skipped.

**Rejected:**
- Route the active loop's write through `crossLoopSeam` or reload it via `loadLoop` — both exist
  to make an audible transport change look seamless; a key-change write to the active loop is a
  silent metadata update the engine already reads from the same `set()`, so seaming it would
  insert an unnecessary audible cut.
- Snapshot each changed loop's whole `LoopContent` for undo — restoring the entire loop would
  also revert any other edit made to it between the apply and the undo, not just the key change.
- Persist the pending Undo, or allow more than one level — neither the loop-delete Undo nor any
  other Undo in the app has precedent for this, and loop ids are not stable across projects, so a
  persisted or older-than-one-level snapshot could restore into a loop that no longer means what
  it meant when the snapshot was taken.

## Consequences

A loop that is not active and not playing only starts sounding its new key when song playback
reaches it at the next loop boundary — the same lag any other non-active-loop edit already has.
The single-level rule above is per Undo kind, not global: a loop delete and a batch key change
can each have a pending Undo at the same time. `ArrangeView` renders both through one shared
daisyUI toast container, which stacks the two alerts instead of letting them overlap.

## Rules this implies

- **R284** — `applyLoopKeyChange` and `undoLoopKeyChange` are one `set()` each: non-active loops
  in `loops[]`, the active loop through its flat fields — never `crossLoopSeam` or `loadLoop`.
- **R285** — The undo snapshot holds only the fields `changeKey` writes (`scaleRoot`,
  `scaleType`, `chords`, both melody rows); it is session-only and single-level; a loop deleted
  in between is skipped.
- **R286** — A project install dismisses a pending key-change Undo (loop ids collide across
  projects).

## Sources

Spec `docs/superpowers/specs/2026-09-22-loop-content-and-batch-key-design.md`; plan
`docs/superpowers/plans/2026-09-22-dev-427-batch-key-change.md`.

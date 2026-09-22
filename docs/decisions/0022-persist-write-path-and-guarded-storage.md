# ADR-0022: Deduped, coalesced persist writes; guarded storage

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

The app store uses zustand `persist` over `localStorage` (the persist key and read path are in
[ADR-0023](0023-validation-instead-of-migration.md)). zustand runs `partialize` on every `set()`,
and many `set()`s touch no persisted key at all; serialising and writing the whole persisted state
on each of them is wasted synchronous work on the main thread. Separately, `localStorage` is not a
reliable API: it can *throw* (Safari private mode, blocked cookies, embedded webviews), not just
return null.

## Decision

### `persist` serialises only when a persisted value changed; the write is coalesced

- zustand still runs `partialize` on every `set()`, but `store/persistStorage.ts`
  (`createDedupedJsonStorage`) compares the result with the last one it wrote and stringifies
  nothing when every persisted top-level value is the same reference — so a `set()` that touches no
  persisted key costs no JSON work.
- That comparison is by reference, so every writer of a persisted value must **replace it, never
  mutate it in place** (`store.test.ts` pins this).
- The write itself goes through `utils/coalescedStorage.ts`, which buffers it to an idle callback
  and flushes on `pagehide`/`visibilitychange`.
- A `set()` that DOES change a persisted key still re-serialises the whole persisted state on the
  spot, so anything driven by a pointer, a clock tick or an animation frame must not write persisted
  state directly.
- Consequence for tests and for reading `localStorage` in a live page: storage lags the store by up
  to one idle window; call `flushPersistedWrites()` before asserting on it.

### Storage access is always guarded

`store.ts` falls back to an in-memory `StateStorage` when `localStorage` is unusable, and helpers
like `components/header/useTheme.ts`'s theme functions take an injectable storage param and read it *inside* a `try`,
never in a default-parameter expression (a default-parameter expression evaluates outside the
`try`, so a throwing `localStorage` would escape it).

## Consequences

- An in-place mutation of a persisted value is silently not saved — the dedupe sees the same
  reference.
- High-frequency state must stay out of persisted keys (see also
  [ADR-0001](0001-always-mounted-views.md) and [ADR-0028](0028-sample-based-metering.md)).
- Tests asserting on `localStorage` must flush first.
- A device where `localStorage` throws still runs, with session-only state. The same "degraded
  state, not exception path" discipline governs IndexedDB in
  [ADR-0024](0024-storage-zones-project-slot-autosave.md).

## Rules this implies

- **R210** — Persisted values are replaced, never mutated in place (`createDedupedJsonStorage`
  compares by reference; `store.test.ts` pins).
- **R211** — The `localStorage` write goes through `utils/coalescedStorage.ts` (idle callback, flush
  on `pagehide`/`visibilitychange`).
- **R212** — Pointer-, clock- or animation-frame-driven code never writes persisted state directly.
- **R213** — Tests/live reads call `flushPersistedWrites()` before asserting on `localStorage`.
- **R244** — Storage access is guarded: `localStorage` can throw; `store.ts` falls back to in-memory
  `StateStorage`; helpers take an injectable storage param read inside a `try`, never in a
  default-parameter expression (`header/useTheme.ts` theme functions).

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 705-715 and 852-855.

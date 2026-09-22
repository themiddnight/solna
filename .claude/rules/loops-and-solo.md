---
paths:
  - "src/store/loopSlice.ts"
  - "src/store/loadLoop.ts"
  - "src/store/projectSlice.ts"
  - "src/store/soloNav.ts"
  - "src/store/trackAudibility.ts"
  - "src/store/engineSync.ts"
  - "src/store/loop.ts"
  - "src/store/loopDefaults.ts"
  - "src/store/loopSync.ts"
  - "src/store/keyChange.ts"
  - "src/store/loopKeyChange*.ts"
  - "src/components/song/**"
  - "src/components/ui/Solo*.tsx"
---

# Loops and solo

Loop content and defaults, atomic loop delete with Undo, and the session-only track solo set.

## Loop content

- `LoopContent` (`store/loop.ts`) is `Pick<Loop, LoopFlatKey>`; a loop is slot identity (`id`, `name`, `tempName`, `repeatCount`) plus content, and `loop.test.ts` fails to compile if a `Loop` field is neither. <!-- R282 -->
- `createDefaultLoopContent()` (`store/loopDefaults.ts`) is the only place a per-loop default is written; slices read it through their `defaults` parameter, or through the shared `default*State()` factories `createDefaultLoopContent` itself spreads. <!-- R283 -->
- `trackSends` is per-loop content: in `LOOP_FLAT_KEYS` and the `mix` copy group, keyed by engine source id (`synth`, `chord`, `bass`, `pad`, `fx`, `sequencer`), levels linear 0..1. Its default is written only in `createDefaultLoopContent`: 1/1/1 on every track except `sequencer` delay 0 and distortion 0; `mixdownFixture.ts` is the one test copy and a test pins it equal. <!-- R301 -->

([ADR-0032](../../docs/decisions/0032-key-change-as-loop-content-operation.md), [ADR-0037](../../docs/decisions/0037-per-track-sends.md))

## Batch key change

- `applyLoopKeyChange` and `undoLoopKeyChange` are one `set()` each: non-active loops in `loops[]`, the active loop through its flat fields — never `crossLoopSeam` or `loadLoop`. <!-- R284 -->
- The undo snapshot holds only the fields `changeKey` writes (`scaleRoot`, `scaleType`, `chords`, both melody rows); restoring it overwrites any edit made to those fields inside the Undo window, but every other field is untouched; it is session-only and single-level; a loop deleted in between is skipped. <!-- R285 -->
- A project install dismisses a pending key-change Undo (loop ids collide across projects). <!-- R286 -->

([ADR-0033](../../docs/decisions/0033-batch-key-change-across-loops.md))

## Loop delete

- `deleteLoop` is one `set()` that also installs the fallback loop's per-loop fields (the `projectSlice.reconcileActiveLoop` shape); callers never follow it with `loadLoop`. <!-- R149 -->
- `deleteLoop` touches no audio; the UI calls `deleteLoopLive` (`store/loadLoop.ts`), which wraps it in `crossLoopSeam` when the transport runs the deleted loop. <!-- R150 -->
- The transport never stops on delete: the deleted loop's voices are cut at `LOAD_LOOP_RELEASE` (every accompaniment bus plus the melody grids' sequencer-owned notes), the clock resets, the fallback enters at step 0, and song advance counts a whole pass of it. <!-- R151 -->
- Only an audition scoped to the deleted loop stops. <!-- R152 -->
- `deleteLoop` returns a `DeletedLoop`; `restoreLoop` reinserts it at its index without activating it. <!-- R153 -->
- Arrange offers a timed Undo toast, not a confirm dialog; `undoLoopDelete` reactivates through the same seam (or `loadLoop` when idle) and never stops the transport. <!-- R154 -->
- A project install dismisses a pending Undo (`projectInstallCount`), because loop ids collide across projects. <!-- R155 -->

([ADR-0014](../../docs/decisions/0014-atomic-loop-delete-with-undo.md))

## Solo

- `soloTracks` lives in the ui slice, is absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`, and never touches `LoopMixPatch`. <!-- R156 -->
- Solo is a set (not a radio), beats mute, and scopes the whole loop. <!-- R157 -->
- Solo clears on a layer change (`layerForTab`) or an `activeLoopId` change, via the single subscription in `store/soloNav.ts`, and on a project install (`projectSlice`'s atomic clear). <!-- R158 -->
- A `focusTrack` change never clears solo. <!-- R159 -->
- Effective audibility is computed only in `engineSync.ts`, from `SOURCE_BUSES` with `isTrackAudible` (`store/trackAudibility.ts`); a view never computes it. <!-- R160 -->
- Solo moves the Beat bus only; per-voice mute (`beatMix.voices`) is independent and both must pass. <!-- R161 -->

([ADR-0015](../../docs/decisions/0015-session-only-track-solo.md))

## Prohibited

- Following `deleteLoop` with `loadLoop` <!-- R149 -->
- Audio calls inside `deleteLoop`, or a UI calling it instead of `deleteLoopLive` <!-- R150 -->
- Stopping the transport on delete or on Undo <!-- R151 --> <!-- R154 -->
- Stopping an audition not scoped to the deleted loop <!-- R152 -->
- `restoreLoop` activating the loop it restores <!-- R153 -->
- A confirm dialog in place of the Undo toast <!-- R154 -->
- Keeping a pending Undo across a project install <!-- R155 -->
- Persisting `soloTracks`, or solo touching `LoopMixPatch` <!-- R156 -->
- Solo as a radio, or mute beating solo <!-- R157 -->
- A solo clear inside each writer instead of `soloNav.ts` <!-- R158 -->
- Clearing solo on a `focusTrack` change <!-- R159 -->
- Computing audibility outside `engineSync.ts` <!-- R160 -->
- Solo overriding per-voice Beat mute <!-- R161 -->
- A per-loop default literal in a slice <!-- R283 -->
- A `Loop` field outside identity and `LOOP_FLAT_KEYS` <!-- R282 -->
- A `trackSends` default literal outside `createDefaultLoopContent` (the mixdown fixture excepted) <!-- R301 -->
- Seaming or reloading the active loop for a batch key change <!-- R284 -->
- A whole-`LoopContent` undo snapshot <!-- R285 -->
- Keeping a pending key-change Undo across a project install <!-- R286 -->

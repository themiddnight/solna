---
paths:
  - "src/store/loopSlice.ts"
  - "src/store/loadLoop.ts"
  - "src/store/projectSlice.ts"
  - "src/store/soloNav.ts"
  - "src/store/trackAudibility.ts"
  - "src/store/engineSync.ts"
  - "src/components/song/**"
  - "src/components/ui/Solo*.tsx"
---

# Loops and solo

Atomic loop delete with Undo, and the session-only track solo set.

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

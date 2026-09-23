# ADR-0045: Vibe picker with preview

**Status:** Accepted — 2026-09-24. Amends [ADR-0009](0009-vibes-as-data-and-single-drum-grid-library.md) (R086, R095).

## Context

Instant Vibes lived in an always-visible strip of genre chips above the transport, in the body
both frames share. The strip cost a row of vertical space on the desktop and on the phone for an
action used rarely, mostly at project start. A chip click was also final: `applyVibeToStore` ran
`hardStopAll`, cut the accompaniment sources, wrote the vibe over the current loop in one
`setState` and restarted whatever had been playing. There was no audition before the write and no
undo after it, so a curious click overwrote a loop the user had built.

## Decision

- **The strip is removed; vibes open from a Header tool.** A `vibes` row in `HEADER_TOOLS`
  (`components/vibes/VibesButton.tsx`, loop layer) renders a Header button on the desktop and,
  because it is not a mobile bar field tool, a menu row in the phone's menu sheet, where the
  picker opens as a nested dialog inside the sheet's dialog (R320). No frame renders a vibe strip.
- **The picker is a centred `Modal` on both frames** (`components/vibes/VibePickerModal.tsx`):
  Modal's own header, a card grid that scrolls, and a pinned footer holding the preview summary,
  Play/Stop, Cancel and Use. The layout comes from `boxClassName` making the box a flex column;
  no footer prop is added to `Modal`. Use and Play stay disabled until a vibe has been previewed.
- **Preview commands live in `store/vibePreview.ts`**, one per picker action:
  `beginVibePreview` (hold persisted writes, suspend note input, stop and cut, return the
  snapshot), `previewVibe` (resolve first, then stop, cut, one write, play), `rerollPreview` (the
  feature's one `Math.random` call, then `previewVibe`), `playPreview`/`stopPreview` (on what the
  store holds now, never re-applying, so a rerolled variant survives), `commitVibePreview` (Use)
  and `cancelVibePreview` (every other exit). A preview plays with the loop-scope
  `soloLoop(activeLoopId)`, the loop layer's own starter, never `playAll()`, which would put the
  transport under the song scope from a loop-layer surface.
- **Cancel restores a one-write snapshot.** `captureVibeTargets` (`store/vibes.ts`) captures the
  current value of every key a vibe patch may write, plus `loops` and `selectedVibeId`. Values
  are captured by reference; the restore relies on persisted values being replaced, never mutated
  (R210). Cancel, Escape, the close button, the backdrop and an unmount while open all route to
  `cancelVibePreview`, which writes the snapshot back through `withMirror` in one `setState`.
- **Persisted writes are held while the picker is open.** `holdPersistedWrites` (`store/store.ts`)
  flushes both writers first — the coalesced `localStorage` blob and the project autosave — then
  holds them; while held neither schedules a write and a flush (`pagehide`, hidden) is a no-op, so
  a tab closed mid-preview reloads the pre-preview state, the same outcome as Cancel.
  `releasePersistedWrites` lets each writer schedule one write if anything changed. The hold is a
  flag, not a count, so one release frees it after a double open.
- **Note input is suspended while the picker is open.** A session-only ui-slice flag,
  `noteInputSuspended`, written only on open and close, gates the QWERTY note keydown, the QWERTY
  drum-pad keydown and MIDI note-on and CC at their entry; note-off and keyup pass. Its rising
  edge releases every held QWERTY note the way the blur backstop does. A CC is dropped too because
  it would edit the previewed state that Cancel then wipes.
- **`applyVibeToStore` and its restart-after-stop are deleted**, and `components/vibeActions.ts`
  is folded into the preview commands. Opening the picker stops the transport and closing it
  leaves the transport stopped; vibes never restart what was playing.
- **The preview module stays lazy (R095).** The picker imports `VIBES` eagerly and makes no
  resolver call; `store/vibePreview.ts`, which reaches the engine and the resolvers, is loaded
  through a cached dynamic `import()` in `components/vibes/useVibePicker.ts`, prefetched on the
  button's hover and focus and awaited once on open.

### Rejected alternatives

- **A modal `BottomSheet` on the phone:** R326 reserves the bottom sheet for what sits inline on
  the desktop; the picker sits inline nowhere.
- **A non-modal surface beside the real `TransportBar`:** the user could edit the loop
  mid-preview and Cancel's restore would wipe the edit; it would also need R326 widened.
- **A side drawer without an overlay:** invents a position outside the overlay taxonomy (R325).
- **Always applying a vibe to a new loop:** clutters `loops[]` for an action mostly used on an
  empty project.
- **Overwrite plus Undo:** keeps the accidental apply, needs a snapshot anyway, and still offers
  no audition.
- **Overwrite only when the loop is empty:** silently does nothing once content exists, or needs a
  second path for that case.

## Consequences

Reaching vibes costs one more tap, and on the phone the menu sheet must be opened first. Opening
the picker stops playback, and the user presses Play after closing it. On the phone the Use
toast is raised under the menu sheet's dialog and waits until that sheet closes (R329). A MIDI
key held across the open is not force-released; its own note-off still passes and releases it.
The snapshot covers exactly what a vibe writes, so a vibe that starts writing a new store key must
add it to `captureVibeTargets` — the invariant test in `store/vibePreview.test.ts`, which checks
every vibe and a sample of rerolls, fails before such a key can escape Cancel. The persistence
hold is the only one in the app; a second feature that wants to hold writes needs its own
decision.

## Rules this implies

- **R333** — Vibes are reached only through the `vibes` `HEADER_TOOLS` row
  (`components/vibes/VibesButton.tsx`); no frame renders an always-visible vibe strip.
- **R334** — The vibe picker is a centred `Modal` on both frames: the card grid scrolls between
  Modal's pinned header and a pinned footer; **Use** (and Play) stay disabled until a vibe has
  been previewed.
- **R335** — Only the vibe preview holds persisted writes
  (`holdPersistedWrites`/`releasePersistedWrites`); the hold flushes first; nothing is written
  while held, `pagehide`/hidden included; release writes once.
- **R336** — `noteInputSuspended` gates QWERTY notes, QWERTY drum pads and MIDI note-on/CC at
  their entry (note-off and keyup pass); its rising edge releases every held QWERTY note.
- **R337** — A vibe preview is stop → cut → one write → `soloLoop(activeLoopId)`; opening and
  closing the picker leave the transport stopped; vibes never restart after a stop.
- **R338** — Cancel restores `captureVibeTargets` in one write; every key a vibe patch writes is
  in the snapshot, pinned by the invariant test in `vibePreview.test.ts`.
- **R086** (reworded) — `previewVibe` (`store/vibePreview.ts`) writes a resolved vibe through
  `vibeContentPatch`.
- **R095** (reworded) — The vibe picker imports `VIBES` eagerly, makes no resolver call, and
  reaches `store/vibePreview.ts` only through a cached dynamic `import()`.

## Sources

`docs/superpowers/specs/2026-09-24-vibe-picker-modal-design.md` (§1, §3–§7, §11),
`docs/superpowers/plans/2026-09-24-vibe-picker-modal.md`;
[ADR-0009](0009-vibes-as-data-and-single-drum-grid-library.md),
[ADR-0022](0022-persist-write-path-and-guarded-storage.md),
[ADR-0041](0041-mobile-frame.md),
[ADR-0044](0044-secondary-canvas-taxonomy.md).

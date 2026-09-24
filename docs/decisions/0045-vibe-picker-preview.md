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
  Modal's own header, a list that scrolls, and a pinned footer holding the preview summary,
  Play/Stop, Cancel and Use. The layout comes from `boxClassName` making the box a flex column;
  no footer prop is added to `Modal`. Use and Play stay disabled until a vibe has been previewed.
  The summary is the name line (name · key · BPM) and one detail line (progression · comp rhythm
  · bass pattern · drum grid), shown from the first pick. A reroll changes both lines in place
  and marks the name line with the dice icon, so the name is never printed twice.
- **The vibes stack one per row, and every row carries its own dice.** A row is the vibe's card,
  then a square dice button. The dice previews a fresh variant of its row's vibe at once, so a
  reroll does not need a pick first. A single column reads as a list that grows downward, so a new
  vibe adds a row, and the dice beside each card shows which vibes can be rerolled before any is
  previewed. An earlier multi-column grid showed the dice only on the previewed card.
- **The Vibes tool comes first.** Its row leads `HEADER_TOOLS`, so it is the first loop-layer tool
  in the desktop Header and the first row of the phone's menu sheet, and its icon takes
  `text-primary`, the same accent as the theme switch. A project starts with a vibe, so the entry
  point comes before the tools that edit what it loads.
- **A picker that cannot open says so and closes.** The preview chunk loads on the first open. A
  load that rejects is not cached, so the next open fetches it again. A `beginVibePreview` that
  throws releases the hold and the input suspension before rethrowing. Either failure shows one
  error message under the `vibe` key and closes the picker, instead of leaving it open with every
  card disabled.
- **A close that throws still ends the preview.** The picker drops its session before it calls
  `commitVibePreview` or `cancelVibePreview`, so nothing would release the hold later. Both end
  the preview in a `finally`, and Cancel restores the snapshot before it does. Without that, a
  stop that threw on close would leave every persisted write held and note input suspended for
  the rest of the session.
- **The card of the vibe the loop was loaded from is marked Current.** The picker labels the card
  whose id is `selectedVibeId` "Current", restoring the readout the strip's selected chip gave.
  The label is separate from the pressed state, which marks the previewed card, so a card can show
  both. While a session is open the store's `selectedVibeId` holds the vibe being previewed, so the
  picker uses the value captured at open. The hook reads it through `useLiveStore`, one value per
  selector. The mark survives a reload: `selectedVibeId` is persisted, and boot's install keeps it
  when it resumes the same loop it was set for. Open and New still clear it, because loop ids are
  not unique across projects.
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
  holds them; while held neither schedules a write, the coalesced storage buffers a removal
  instead of making it, and a flush (`pagehide`, hidden) is a no-op, so
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
decision. `selectedVibeId` and its clear on any `activeLoopId` change (`store/vibeNav.ts`) keep a
reader: the Current mark. Removing the field was the alternative. That would be a persisted-shape
change and would drop the cue the strip gave, so it was not done here.

## Rules this implies

- **R333** — Vibes are reached only through the `vibes` `HEADER_TOOLS` row
  (`components/vibes/VibesButton.tsx`), which leads the list, so it is the first tool in the Header
  and in the menu sheet; no frame renders an always-visible vibe strip.
- **R334** — The vibe picker is a centred `Modal` on both frames: the vibes stack one per row, each
  a card then its own dice, and the list scrolls between Modal's pinned header and a pinned footer;
  a row's dice previews a variant of that row's vibe whether or not it was being previewed; **Use** (and Play) stay disabled until a vibe has
  been previewed; the card of the vibe the active loop was loaded from (`selectedVibeId`, as
  captured at open) carries a "Current" label, never the pressed state, which belongs to the
  previewed card; boot keeps `selectedVibeId` when it resumes the loop it was set for, so the
  label survives a reload.
- **R335** — Only the vibe preview holds persisted writes
  (`holdPersistedWrites`/`releasePersistedWrites`); the hold flushes first; nothing is written
  or removed while held, `pagehide`/hidden included; release writes once; an open, Use or Cancel
  that throws releases the hold and input before rethrowing (Cancel restores the snapshot first).
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

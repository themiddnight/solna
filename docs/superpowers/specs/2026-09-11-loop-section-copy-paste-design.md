# Loop Section Copy/Paste — Design

## Context

The Arrange view already has `LoopCopyDialog`, a **pull** model: open a dialog on the
destination loop, pick the source, tick the groups to copy, apply. It is the right tool for
copying *several* groups at once, but for "copy this loop, then bring a couple of its sections
into another loop" it is several clicks more than the gesture needs.

This feature adds a **push** model with the direction reversed: a single **copy** button in the
app shell remembers the whole active loop as the copy source, and a **paste** button on each
module card brings just that module's data over. Copy and paste reuse the exact copy machinery
the dialog already sits on — `LOOP_COPY_GROUPS`, `buildLoopCopyPatch`, `applyLoopCopy` — so no
copy or merge logic is written twice.

## Goals

- One copy button captures the active loop as a one-slot source buffer; per-module paste buttons
  drop that module's slice into whichever loop is active.
- Reuse `LOOP_COPY_GROUPS` / `buildLoopCopyPatch` / `applyLoopCopy` unchanged.
- Session-only buffer, consistent with the `loopCopySelection` session state this work follows.
- Coexist with `LoopCopyDialog` (dialog = bulk pull; buttons = single-module push).

## Non-goals

- No per-section copy buttons — one copy button only.
- No `key`/`mix` paste buttons (those loop-wide groups are not a module; the dialog still covers
  them). `key` is only ever applied as a side effect of pasting the chord progression.
- No transposition. A pasted progression always carries its source key (see *Key handling*).
- No toast — paste applies immediately; the button's disabled state and tooltip are the feedback.
- No persistence across reload.

## Design

### Buffer (ui slice, session-only)

```
loopClipboard: { sourceLoopId: string } | null
```

- One slot; a new copy overwrites it. Copy is "copy all", so the buffer is a *reference to the
  source loop*, not a pre-selected group list — which groups actually move is decided per paste.
- The paste button resolves `loopLabel(sourceLoop)` from the current loop, so a rename cannot
  leave stale duplicated label data in the buffer.
- A project install clears the buffer atomically with the content swap because loop ids may
  collide across projects.

### Copy action

`copyLoopSection()`:

1. Read the active loop; no-op when there is none.
2. Store `{ sourceLoopId: activeLoopId }`.

### Paste action

`pasteLoopSection(groups: readonly LoopCopyGroupId[])`:

1. No buffer → no-op.
2. `sourceLoopId === activeLoopId` → no-op (pasting a loop into itself).
3. Source loop no longer exists → clear the buffer.
4. Otherwise `applyLoopCopy(activeLoopId, sourceLoopId, pasteGroupsFor(groups))`.

`applyLoopCopy` already no-ops on a missing source/target and an empty selection, and already
handles both the "target is active" and "target is not active" branches; paste always targets the
active loop, so it lands in the well-tested active branch. The buffer is NOT cleared on a
successful paste, so one copy can be pasted into several loops in turn.

### `pasteGroupsFor` — the one piece of new copy logic

```
pasteGroupsFor(groups) = groups includes 'chord-progression' && not 'key'
  ? [...groups, 'key']
  : [...groups]
```

The push model learns the target only at paste time, so it cannot run `withImpliedKey`'s
conditional (which needs both keys in hand). A progression paste therefore captures `key`
unconditionally: pasting into an equal key is a no-op on `scaleRoot`/`scaleType`, and pasting into
a different key brings the correct key along. Sound and pattern pastes never capture `key` — a
voice or rhythm is key-agnostic, matching `impliesKeyCopy`'s rule.

### Buttons

- **Copy (1):** `LoopCopyButton` in the app shell (`Header.tsx`), next to `LoopSelector` and gated
  on the loop layer. It captures the active loop.
- **Paste (9):** `ModulePasteButton { groups }` in the top-right of each module card's header,
  always visible but disabled while there is no buffer or the source is the active loop:

  | Module card | groups |
  |---|---|
  | Synth (focused melodic track's sound) | `['lead-sound']` / `['fx-sound']` / `['chord-sound']` / `['bass-sound']` / `['pad-sound']` (focus-dependent) |
  | Drum Sound | `['drums-sound']` |
  | Lead melody | `['lead-pattern']` |
  | FX melody | `['fx-pattern']` |
  | Chord progression | `['chord-progression']` |
  | Chord module | `['chord-sound', 'chord-pattern']` |
  | Bass module | `['bass-sound', 'bass-pattern']` |
  | Pad module | `['pad-sound', 'pad-pattern']` |
  | Beat (drum sequencer) | `['drums-pattern']` |

## Key handling — the one correctness point

A chord-progression paste captures `key` too (via `pasteGroupsFor`). The consequence worth stating
outright: push-paste of a progression **always carries the source key** — "paste these chords into
a different key without changing the key" is deliberately not supported here. That move remains
available through `LoopCopyDialog`, which lets the user untick `key`. Without transposition, the
alternative (pasting absolute-root chords into a different key) would produce a musically broken
loop, so carrying the key is the only sound default for push.

## Reuse

- `applyLoopCopy` (`loopCopySlice`) — paste.
- `buildLoopCopyPatch` (`loopCopy`) — the deep-cloned patch.
- `LOOP_COPY_GROUPS` (`loopCopy`) — the canonical group→keys map; buttons read their label from it.
- `loopLabel` (`loop`) — the copy source name.

## New code

- ui slice: `loopClipboard` + `setLoopClipboard` / `clearLoopClipboard`.
- `store/loopClipboard.ts`: `pasteGroupsFor(groups)`, `copyLoopSection()`,
  `pasteLoopSection(groups)` — the first is pure; the latter two are thin actions over
  `useAppStore.getState()`.
- `LoopCopyButton` + `ModulePasteButton` components.

## Edge cases

- Copy with no active loop → no-op.
- Paste onto the same loop → the button is disabled (no-op).
- Source loop deleted between copy and paste → paste clears the buffer.
- The buffer survives tab switches (Sound ↔ Pattern — both views stay mounted), but is session-only
  and gone on reload.

## Testing

- `pasteGroupsFor`: `['chord-progression']` → `['chord-progression', 'key']`; `['chord-sound',
  'chord-pattern']` → unchanged; `['lead-sound']` → unchanged.
- `copyLoopSection` / `pasteLoopSection` through the store: copy sets the buffer; paste calls
  `applyLoopCopy` with the resolved groups; same-loop and missing-source are no-ops.
- Buffer is session-only: absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`.
- Markup: the copy button renders in the header; each paste button renders disabled when the buffer
  is empty and enabled when it is set.

## Out of scope

`key`/`mix` paste buttons, transposition, per-section copy buttons, multiple clipboard slots,
toasts, and any persistence.

# Bottom Input Dock — Design Spec

Date: 2026-08-30
Status: Draft (awaiting review)

## Problem

The QWERTY synth keyboard lives inside `loop/SynthView.tsx`; the drum pads live in
`loop/DrumPads.tsx`. Both register `window`-level `keydown` listeners. Because every
view stays mounted (`block`/`hidden` in `App.tsx`), those listeners already fire on
**every page of the app** — loop and song alike.

The visual input surfaces, however, are buried inside their pages: the keyboard is only
visible on the Synth page and the pads only on the Sequencer page. We want both reachable
from any page through a bottom dock, while leaving the QWERTY listeners' current global
behavior unchanged.

## Goals

1. A bottom dock, openable from any page, hosting the synth keyboard and drum pads in one
   panel with an internal Keyboard | Drums toggle.
2. Dock height is intrinsic (auto); no drag-resize.
3. QWERTY listeners stay global and always-on (keyboard + drums simultaneously; their key
   sets are already disjoint). The dock's open/closed state and mode toggle do **not** gate
   QWERTY input.
4. Preserve current note-playing and listener guards exactly: `isTypingTarget`, `e.repeat`
   skip, octave via `Minus`/`Equal`, chord key-hold release, and the Task 6 listener
   memoization.

## Non-goals (YAGNI)

- No per-device split (inline on desktop vs drawer on mobile) — one dock everywhere.
- No drag-resize or preset height stops.
- No persistence of dock open/mode state (session-only).
- No new dependency (Radix, vaul, react-resizable-panels).

## Decisions

- **Hand-rolled dock, no new dependency.** daisyUI v5 `drawer` is a side overlay driven by a
  hidden checkbox that covers content — not a bottom dock sharing vertical space. Radix
  `Dialog`/vaul is modal with focus trapping, which blocks the core "play keyboard below while
  tweaking params above" interaction. Neither fits.
- **QWERTY listeners are decoupled from the dock.** Input (QWERTY) and surface (dock) are
  independent units. The dock is purely visual/touch.
- **Both dock and QWERTY are global across all pages.** This matches current behavior
  (listeners already fire everywhere); no layer gating.

## Architecture

Two units sharing one input hook.

### 1. `useInputDeck()` — new hook (plays notes + owns the global QWERTY listeners)

Mounted once at `App` level.

- Owns synth keyboard state: `keyboardOctave`, the notes memos (`chromaticNotes`,
  `scaleLockedNotesFlat`, `chordKeyboardRows`), `keyboardMode` (from store), and the chord
  key-hold ref.
- Note-on/off via `audio/playback/synthPlayback` (velocity scaling preserved); drum trigger via
  `audio/playback/drumPlayback`.
- Registers `keydown`/`keyup` on `window`, with the listener bodies copied verbatim from
  `SynthView.tsx` (lines 446–515) and `DrumPads.tsx` (lines 41–53): `isTypingTarget` guard,
  `e.repeat` skip, octave, chord, scale-locked/chromatic, drum shortcuts.
- No layer gating — always active (matches current global behavior).
- Returns `{ keyboardProps, drumProps }` for the dock (and any future consumer).

### 2. `BottomInputDock` — new component (visual/touch surface)

Rendered in `App.tsx` between `<main>` and `<TransportBar>`.

- Header button toggles `isInputPanelOpen`.
- Internal tabs Keyboard | Drums driven by `inputPanelMode`.
- Keyboard tab renders `ui/Keyboard` (Chromatic/ScaleLocked/Chord) bound to `keyboardProps`;
  Drums tab renders the extracted pad grid.
- Intrinsic height; slide-in animation.

### 3. Store

`uiSlice` gains `isInputPanelOpen: boolean` and `inputPanelMode: 'keyboard' | 'drums'` plus
setters. Session-only (not in `partializeAppState`), mirroring `isMidiSettingsOpen`.

## Files touched

- `src/App.tsx` — mount `useInputDeck`, render `<BottomInputDock>`, pass props.
- `src/store/uiSlice.ts` + `src/store/types.ts` — new state + setters.
- `src/components/useInputDeck.ts` (new) — extracted playing + QWERTY logic.
- `src/components/ui/BottomInputDock.tsx` (new) — dock shell + tabs.
- `src/components/loop/SynthView.tsx` — remove visual keyboard + QWERTY listener; keep any
  non-keyboard synth code paths (arp/lead).
- `src/components/loop/DrumPads.tsx` — extract pad grid to shared; remove QWERTY listener.
- Tests: `SynthView.test.tsx`, `DrumPads.test.tsx`, `Keyboard.test.ts`, `check-key-bindings.ts` —
  update imports/targets.

## Behavior contract to preserve (critical)

- `isTypingTarget(e)` guard on every listener (do not steal keys from form fields).
- `e.repeat` skip.
- Octave via `Minus`/`Equal`.
- Chord key-hold release via `chordKeyNotesRef` + `keyup`.
- Task 6 memoization of notes so listeners do not re-register during drags (~60 Hz).
- `check-key-bindings` invariant (synth vs drum `code` sets disjoint) — unchanged, since both
  stay simultaneously active.
- First-gesture `keydown` path that starts the audio engine (`registerFirstGesture` in `App`) —
  unaffected.

## Risks / open questions

- `handleNoteOn` may be shared with SynthView's arp/lead paths — verify before removal so no
  voices strand on a target switch.
- Slide animation technique (transform vs height) with intrinsic-height content — pick one that
  does not fight auto height.
- Confirm no song-mode page relies on QWERTY being suppressed beyond the existing
  `isTypingTarget` guard (all current inputs are already guarded).

## Testing

- `bun run verify` (tests + lint + `check:keys` + `check:drums` + build) must stay green.
- Update existing tests that import moved symbols.
- Manual: open the dock from every page; QWERTY fires on every page including song mode;
  keyboard + drums simultaneous; typing in a text field does not trigger notes.

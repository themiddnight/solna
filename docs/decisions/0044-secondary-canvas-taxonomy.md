# ADR-0044: Secondary-canvas taxonomy

**Status:** Accepted — 2026-09-24. Amends [ADR-0041](0041-mobile-frame.md) (R320).

## Context

Overlays and transient messages had grown one ad hoc mechanism per feature. `Modal` doubled as a
bottom sheet through a `placement` prop, so "centered dialog" and "sheet that slides up on a
phone" shared one component with two different platform-glue paths. `QuickSavePopover` was an
in-flow card laid out by its parent rather than a panel anchored to its trigger. Beat had grown a
user preset library (save, delete) with no library UI at all, while the module and synth presets
already had one. Transient feedback was scattered per surface: a vibe toast, a synth toast, a
chord toast and a loop-undo toast each carried their own fixed positioning and z-index, and
`projectNotice` mixed one-shot successes and failures with persistent storage warnings under one
name, never auto-dismissing. Nothing forced a new surface to reuse a position, a z-index or a
timer — each one invented its own.

## Decision

Every secondary surface is exactly one of eight kinds, each with one primitive:

| Kind | Purpose | Layout | Primitive |
|---|---|---|---|
| Dock | The virtual keyboard / drum pad | both | `ui/BottomInputDock` |
| Drawer | A preset library: search, categories, delete, audition, save | both, same side | `ui/PresetLibrary` |
| Bottom sheet | What sits inline on desktop but does not fit a phone | mobile only | `ui/BottomSheet` |
| Modal / dialog | A task or confirmation that blocks | both, centered | `ui/Modal` |
| Popup | A small panel tied to its trigger | both | daisyUI `dropdown`; `QuickSavePopover` when controlled |
| Quick pick | Choosing a preset in place | both | native `<select>` |
| Toast / snackbar | Transient, no action or at most one (Undo) | both | `ui/FeedbackHost` via `showFeedback` |
| Banner | Persistent until handled, in layout flow | both | `ui/UpdateBanner`, `project/ProjectNotice` |

`daisyUI`'s `dock` class on `MobileTabBar` is navigation, not the Dock kind. An `alert` inside a
modal, drawer or card body is content, not feedback (a library's own save/import line stays
inline). `Modal` loses `placement`/`afterBox` and is always centered; `BottomSheet` becomes the
one bottom-sheet primitive, sharing a `useNativeDialog` hook with `Modal` for the platform glue
(open sync, native `close` listener) while each keeps its own header and box classes. A preset
library is always a side drawer, on both frames, never a sheet; a surface whose user library
supports delete gets a drawer even where a quick pick also exists (Beat joins the module and synth
presets). A popup is a daisyUI `dropdown` anchored to its trigger, kept inside the viewport by a
pure helper; it never renders inside a bottom sheet, because a bottom sheet's own tool renders
inline `row` controls instead.

**A non-modal bottom sheet.** `BottomSheet` is modal by default. `modal={false}` exists for one
case the modal shape cannot serve: a sheet whose own frame must stay usable while it is open — the
mobile transport sheet, whose Play/Stop sit on the bar directly below it, so a user can
nudge the tempo or the master level while starting and stopping playback. A modal sheet would make
the bar inert under its backdrop and force a close before every Play. The non-modal sheet opens
with `show()`: no backdrop, not in the top layer, nothing made inert. It is not a `.modal`/
`.modal-box` either — daisyUI's `.modal` is a `fixed inset-0` layer that would catch every tap on
the page. It renders inside the bar it opens from and anchors to that bar's top edge
(`absolute bottom-full`), so it needs no offset and no safe-area padding of its own; its z-index is
the frame-bar step (40), because it is part of that bar. `show()` gives a dialog no close request,
so the shared hook listens for Escape while the sheet is open, yielding to a modal dialog open
above it. It never closes on an outside tap: the page around it is meant to be used.

**Nesting.** A modal may open from a sheet, a drawer or another modal (top layer). A popup never
nests inside a bottom sheet.

**Z-scale** (one scale, states each step): 10 in-content overlays (sticky labels, keys, search
icons); 20 pinned view headers; 30 the input dock body; 40 frame bars (`Header`, `MobileTopBar`,
`TransportBar`, `MobileTabBar`, the dock's header); 50 drawer and popup panels plus full-screen
overlays; 55 the feedback slot, placed above drawers because a drawer action (a synth preset load)
can itself fire a toast; top layer for `Modal` and a modal `BottomSheet`, above every z-index. A
non-modal sheet is not in the top layer; it takes the step of the frame bar it belongs to (40). A
new layer takes one of these listed steps rather than picking an arbitrary number.

**Feedback waits while a dialog is open.** A toast cannot rise above a modal or sheet backdrop —
nothing below the top layer can — so a toast/snackbar raised while a `Modal` or `BottomSheet` is
open would expire unseen behind it. Feedback is therefore a session-only store slice
(`showFeedback`/`dismissFeedback`, read through `useLiveStore`) feeding one `FeedbackHost` per
frame, and the slice holds a `feedbackHolds` counter: `useNativeDialog` takes a hold while its
modal dialog is open and releases it on close or unmount. A non-modal sheet takes no hold: it has
no backdrop and covers only part of the page, and the mobile feedback host sits under the top bar,
clear of a sheet rising from the transport bar, so a toast raised while it is open is seen. While
any hold is active no timer runs; entries still render in the host, under the backdrop, so nothing
is lost and a snackbar's action stays valid. When the last hold releases, every queued entry gets a fresh full-duration timer.
This is the only place feedback timing is paused or resumed.

### Rejected alternatives

- A modal transport sheet: its backdrop makes Play/Stop inert, so every start or stop costs a
  close first — the one control a transport sheet sits beside is the one it would block.
- A non-modal sheet positioned `fixed` above the bar: needs the bar's height as a number (or a
  measurement) and the safe-area inset a second time; anchoring inside the bar needs neither.
- The HTML popover API or CSS anchor positioning for popups and toasts: both sit above the
  project's browser floor (Tailwind v4's minimum supported browsers — see
  `docs/dependency-upgrade-research.md` — and the iPhone Home-Screen PWA target).
- A `fixed` popup panel positioned from `getBoundingClientRect`: needs scroll/resize listeners
  inside a scrolling `<main>` that the anchored `dropdown` avoids entirely.
- A `ScaleMenu` `row` variant for the mobile menu sheet: no popup reaches the sheet today, so the
  variant would be dead code; a guard test pins the "never inside a sheet" rule instead.
- Keeping `projectNotice` as one undifferentiated channel: it mixed one-shot successes/failures
  with persistent storage warnings under one name and one lifetime; splitting by what the message
  is (banner vs. toast) removes that mismatch without redesigning either's clear points.

## Consequences

A new overlay or message picks a row of the taxonomy and a step of the z-scale instead of
inventing a position, a z-index and a timer. `Modal` and `BottomSheet` share one platform-glue
hook instead of one component carrying two shapes. Every preset library, including Beat's, looks
and behaves the same. An error raised inside a Drive or export dialog is guaranteed to be visually
seen, not silently expired behind the backdrop, at the cost of a small hold/release bookkeeping in
the feedback slice and in `useNativeDialog` — while that dialog is open the entry is still inert to
assistive tech, same as everything else behind an open `Modal`/`BottomSheet`, until it closes. A
future surface that seems to need a new position or a bespoke timer is a signal that the taxonomy
is missing a kind, not license to add an ad hoc one.

A popup that opens from inside a frame bar or the input dock (step 40/30) is capped by that
parent's own stacking context: even at its nominal step (50), it cannot rise above a step outside
that parent, because painting is scoped to the ancestor's context first. The feedback host (55)
can therefore cover an open bar popup — the mobile Scale dropdown under a toast, say. This is an
accepted trade-off of the fixed z-scale, not a bug to chase with a higher one-off z-index.

## Rules this implies

- **R325** — Every overlay is exactly one kind: Dock, Drawer, Bottom sheet, Modal, Popup; a new
  one picks a kind and its primitive.
- **R326** — `Modal` is always centered; `BottomSheet` is the only bottom-sheet primitive, mobile
  frame only; modal by default, non-modal (`show()`, no backdrop, no feedback hold, anchored in
  its bar at the frame-bar step) only where the frame must stay interactive.
- **R327** — A preset library is a side drawer on both frames; a deletable user library gets one.
- **R328** — A popup is an anchored daisyUI `dropdown`, kept in-viewport, never inside a bottom
  sheet.
- **R329** — Feedback is toast, snackbar or banner; it queues and holds while a modal dialog is open.
- **R330** — Toasts/snackbars go only through `showFeedback` into one `FeedbackHost`; only
  `useNativeDialog` holds/releases their timers.
- **R331** — The z-scale is fixed; a new layer takes a listed step.

## Sources

`docs/superpowers/specs/2026-09-24-secondary-canvas-taxonomy-design.md` (§3, §5.1–§5.6, §6).

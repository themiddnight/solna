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

**Nesting.** A modal may open from a sheet, a drawer or another modal (top layer). A popup never
nests inside a bottom sheet.

**Z-scale** (one scale, states each step): 10 in-content overlays (sticky labels, keys, search
icons); 20 pinned view headers; 30 the input dock body; 40 frame bars (`Header`, `MobileTopBar`,
`TransportBar`, `MobileTabBar`, the dock's header); 50 drawer and popup panels plus full-screen
overlays; 55 the feedback slot, placed above drawers because a drawer action (a synth preset load)
can itself fire a toast; top layer for `Modal`/`BottomSheet`, above every z-index. A new layer
takes one of these listed steps rather than picking an arbitrary number.

**Feedback waits while a dialog is open.** A toast cannot rise above a modal or sheet backdrop —
nothing below the top layer can — so a toast/snackbar raised while a `Modal` or `BottomSheet` is
open would expire unseen behind it. Feedback is therefore a session-only store slice
(`showFeedback`/`dismissFeedback`, read through `useLiveStore`) feeding one `FeedbackHost` per
frame, and the slice holds a `feedbackHolds` counter: `useNativeDialog` takes a hold while its
dialog is open and releases it on close or unmount. While any hold is active no timer runs;
entries still render in the host, under the backdrop, so nothing is lost and a snackbar's action
stays valid. When the last hold releases, every queued entry gets a fresh full-duration timer.
This is the only place feedback timing is paused or resumed.

### Rejected alternatives

- The HTML popover API or CSS anchor positioning for popups and toasts: both sit above the
  project's browser floor (Safari 16.4, and the iPhone Home-Screen PWA target).
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
and behaves the same. An error raised inside a Drive or export dialog is guaranteed to be seen,
not silently expired behind the backdrop, at the cost of a small hold/release bookkeeping in the
feedback slice and in `useNativeDialog`. A future surface that seems to need a new position or a
bespoke timer is a signal that the taxonomy is missing a kind, not license to add an ad hoc one.

## Rules this implies

- **R325** — Every overlay is exactly one kind: Dock, Drawer, Bottom sheet, Modal, Popup; a new
  one picks a kind and its primitive.
- **R326** — `Modal` is always centered; `BottomSheet` is the only bottom-sheet primitive, mobile
  frame only.
- **R327** — A preset library is a side drawer on both frames; a deletable user library gets one.
- **R328** — A popup is an anchored daisyUI `dropdown`, kept in-viewport, never inside a bottom
  sheet.
- **R329** — Feedback is toast, snackbar or banner; it queues and holds while a dialog is open.
- **R330** — Toasts/snackbars go only through `showFeedback` into one `FeedbackHost`; only
  `useNativeDialog` holds/releases their timers.
- **R331** — The z-scale is fixed; a new layer takes a listed step.

## Sources

`docs/superpowers/specs/2026-09-24-secondary-canvas-taxonomy-design.md` (§3, §5.1–§5.6, §6).

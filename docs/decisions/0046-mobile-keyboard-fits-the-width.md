# ADR-0046: The mobile keyboard fits the width

**Status:** Accepted — 2026-09-24. Builds on [ADR-0041](0041-mobile-frame.md) and
[ADR-0040](0040-layout-shell.md).

## Context

On the phone the input dock's three keyboard modes each sized their keys a different way:

- **Scale** shrank its 11 + 12 QWERTY-row keys to fit, to about 33px each — below a
  comfortable touch target.
- **Chromatic** kept a fixed 46px stride over ten white keys and scrolled sideways.
- **Chord** set the Chords group and the Melody group side by side with `gap-14`, far wider than
  a phone, inside a plain `justify-center`: the overflow split to both sides, and the part past
  the left edge (the first chords) could not be scrolled to at all.

Scrolling a playing surface is itself the wrong gesture: a swipe starts by touching a key, so it
plays that key.

## Decision

Below `md` the keyboard surface fits every key to the width and never scrolls; the range moves by
the octave buttons. The frame asks for it — `MobileShell` passes `keyboardVariant="mobile"`
through `ShellBody` to `BottomInputDock`, which hands it to the three keyboards — the same way it
asks for the transport bar (R332), never through a media query in the keyboard.

- **Chromatic** shows one octave, C to C (eight white keys), on a stride of 1/8 of the container.
- **Scale** shows one octave of the scale per row: the tonic's octave above the octave under it,
  each row scale-length keys sharing the width (`getScaleLockedTouchRows`). The keys are picked
  out of the QWERTY rows, so each keeps its desktop shortcut.
- **Chord** shows the chords only, one row sharing the width. The melody keys are not rendered;
  they stay playable from a computer keyboard, which the dock never gates.

The desktop surface does not change, except that the chord keyboard's root now centres with
`justify-center-safe`, so an overflow is always reachable.

## Rejected alternatives

- **Keep scrolling and fix only the chord overflow.** Makes chord mode reachable, but every
  scroll still sounds a note and the three modes still behave three ways.
- **The melody keys as a second row in chord mode.** Nine keys in a phone row are ~38px wide;
  the chords are what chord mode is for, and the melody is one mode switch away (Scale).
- **A media query in the keyboard.** The frame already decides phone vs desktop (R315, R316); a
  second breakpoint here could disagree with it.

## Consequences

- On the phone the chromatic keyboard covers one octave instead of one and a half; the octave
  buttons cover the rest of the range.
- The desktop chromatic keyboard lost its dead phone metrics: the desktop frame is never narrower
  than `md`, so its `sm:` stride always applied.

## Rules this implies

- **R340**: Below `md` the input dock's keyboard fits the width and never scrolls, asked for by the
  frame (`keyboardVariant`); chromatic shows one octave, scale one octave of the scale per row,
  chord the chords only.

## Sources

- `src/components/ui/Keyboard.tsx` (`KeyboardVariant`, `getScaleLockedTouchRows`)
- `src/components/ui/BottomInputDock.tsx` (`KeyboardSurface`)
- `src/components/shell/MobileShell.tsx`, `src/components/shell/ShellBody.tsx`

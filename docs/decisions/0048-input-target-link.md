# ADR-0048: Input target link

**Status:** Accepted — 2026-09-24. Amends [ADR-0016](0016-focus-routed-note-input.md) (R163, R167).

## Context

`focusTrack` was two things at once: the track the user is looking at (the Pattern segment, the
Sound channel, the mixer row) and the track the keyboard plays. Two use cases pull those apart:

- **Audition the synth being tuned.** The keys should follow whatever track is selected — what
  ADR-0016 gave.
- **Jam over another track.** Keep the keys on one track while moving around the loop: play Lead
  while looking at or editing the Chord grid.

With one field the second was impossible, and picking a track in the dock's chip moved the page.
The dock also had Keyboard | Drums tabs whose choice `focusPanelSync` overwrote whenever focus
crossed the melodic/drum line, so the tab was state that mostly mirrored focus.

## Decision

The keys play an **input target**, derived as
`inputTargetOf(s) = s.recordingTrack !== null ? s.focusTrack : (s.inputTargetPin ?? s.focusTrack)`
in `store/focusTrack.ts`.

- **One new persisted ui-slice key, `inputTargetPin: MixLayerId | null`.** `null` is linked (the
  target follows the selection); a track id is unlinked (the target stays there). One field holds
  both the link state and the pinned track, so the two cannot drift apart and no sync subscription
  is needed. It is validated on read (`isMixLayerId(v) ? v : null`, R214) with no version bump
  (R035), persisted beside `focusTrack` and, like it, not project content.
- **Record arm overrides the pin.** The recorder writes every performed note into the armed track
  whatever bus sounded it (notes carry no bus), so a pin to Chord with Lead armed would sound Chord
  and write Lead. The arm can only be set on the focused track and disarms when focus leaves it
  (`startRecordArmSync`), so while armed "follow focus" is "play the armed track". The pin is kept
  and resumes on disarm; the disarm rules do not change. **Amended:** arming also re-links
  (`setRecordingTrack` clears the pin), and disarming does not restore the old pin, so there is
  no earlier state to remember. The override is kept for a pin made while armed.
- **The dock's header is `[chevron + Input] [ON <target> ▾ | link] [<mode> ▾]`.** The chip and a
  link toggle (lucide `Link2` / `Unlink2`) are one daisyUI `join`. Linked, a pick from the chip
  calls `setFocusTrack` and navigates, as before; pinned, a pick calls `setInputTargetPin` and
  never navigates. Unlinking pins the current target, so the press itself changes nothing
  audible; re-linking clears the pin and the target snaps back to the selection. Linked, both
  halves wear the accent tint; pinned, they drop to the idle style (amended at the user's
  review: the tint marks the default, following state). The "Input" word is `sr-only` below `md`, so the row fits a 375px
  screen and the toggle keeps its accessible name.
- **The Keyboard | Drums tabs go.** The panel is derived from the target (`drum` → pads, anything
  else → keyboard); `inputPanelMode`, `setInputPanelMode`, `InputPanelMode` and
  `store/focusPanelSync.ts` are deleted. The QWERTY drum keys keep their own always-on listener.
- **The keyboard mode (Chromatic / Scale / Chord) is a header dropdown**, open or collapsed, hidden
  for a `drum` target; it left the keyboard toolbar.
- **`kbd` keycaps show only on a desktop screen.** The one `kbd-key` utility in `src/index.css` is
  `display: none` unless `(width >= lg) and (hover: hover) and (pointer: fine)`; the pointer
  condition hides them on a landscape iPad too. Keys and pads have fixed heights, so a hidden
  keycap moves nothing around it.

What follows the target and what stays on focus:

| Follows `inputTargetOf` | Stays on `focusTrack` |
|---|---|
| `useInputDeck`: the patch, the arp and the bus captured at note-on (R164 unchanged) | Pattern segment, Sound channel, mixer row, `SegmentedControl`, `SegmentHeader` |
| R167's drum no-op | Solo button and solo nav |
| The dock's chip label, its panel, the mode picker's visibility | Record arm and its disarm sync |

External MIDI still plays Lead (R168); making it follow the target is out of scope.

### Rejected alternatives

- **A lock icon.** "Lock" reads as "cannot be changed", but a pinned target is still changed from
  the chip; the link/unlink pair says what the toggle does — tie the keys to the selection or not.
- **A separate `linked` boolean beside a target field.** Two fields that must agree, and a sync
  subscription to keep the target on focus while linked; one nullable pin cannot disagree with
  itself.
- **Keeping the Keyboard | Drums tabs.** A second answer to "what do the keys play", which a focus
  change already overwrote; with the target explicit, the tabs only duplicated the chip.
- **Forcing the target to Lead while armed.** Wrong for FX, which is also a melody track; the
  armed track is always the focused one, so following focus is the general answer.

## Consequences

- A user can jam on one track while editing another; the pinned track survives a reload.
- Arming a track drops the pin; after disarm the keys keep following the selection until the user
  unlinks again.
- Anything new that must play "what the keys play" reads `inputTargetOf`, never
  `inputTargetPin` or `focusTrack` directly.
- A phone shows no QWERTY hints; the shortcuts still work with a hardware keyboard.

## Rules this implies

- **R341** — The keys play `inputTargetOf` (arm → focus, else pin, else focus); `inputTargetPin`
  is the one persisted link-and-pin field; arming re-links and disarming does not restore; a linked pick selects, a pinned pick only re-pins; the
  dock panel and the mode picker's visibility derive from the target.
- **R163** (amended) — Keyboard, on-screen keyboard and arp play the input target's bus and patch.
- **R167** (amended) — A `drum` input target makes the melodic keyboard a complete no-op.

## Sources

- `docs/superpowers/specs/2026-09-24-input-target-link.md`
- `src/store/focusTrack.ts` (`inputTargetOf`), `src/store/store.ts` (`sanitizePersistedState`)
- `src/components/useInputDeck.ts`, `src/components/ui/useBottomInputDock.ts`,
  `src/components/ui/BottomInputDock.tsx`
- `src/index.css` (`@utility kbd-key`)

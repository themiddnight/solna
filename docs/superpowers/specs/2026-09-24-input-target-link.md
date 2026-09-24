# Input target link — spec

Branch `feat/input-target-link` (stacked on `feat/mobile-keyboard-fit`). New rule R341, new ADR-0048;
amends R163 and R167 (ADR-0016).

## Problem

`focusTrack` is two things at once: the track the user is looking at (Pattern segment, Sound
channel, mixer row) and the track the keyboard plays. So you cannot keep playing Lead while you look
at or edit the Chord grid, and picking a target in the dock's chip moves the page.

Two use cases:

- **Audition the synth being tuned.** The keys should follow whatever track is selected (today).
- **Jam over another track.** Keep the keys on one track while moving around the loop.

## Decisions (agreed with the user)

1. **Link/unlink toggle, not "lock".** A link icon beside the target chip. Linked (default) = the
   target follows the selected track. Unlinked = the target is pinned. Re-linking snaps the target
   back to the selection.
2. **Picking from the chip:** linked → selects that track (`setFocusTrack`, navigates as today);
   unlinked → changes only the pinned target, never navigates.
3. **The Keyboard | Drums tabs go.** The panel is derived from the target: `drum` → pads, anything
   else → keyboard. The QWERTY drum keys keep their own always-on listener.
4. **The collapsed header still picks the target and the keyboard mode** (Chromatic/Scale/Chord).
   The mode picker is hidden when the target is `drum`.
5. **`kbd` keycaps show only on desktop screens.** Shown only at `lg` (64rem) and wider with a fine,
   hovering pointer, through the global `kbd-key` utility in `src/index.css`.

## Model

- One new persisted ui-slice key: `inputTargetPin: MixLayerId | null`. `null` = linked. One field
  holds both the link state and the pinned track, so the two cannot drift apart and no sync
  subscription is needed.
- Sanitized in `sanitizePersistedState`: `isMixLayerId(v) ? v : null` (R214, no version bump, R035).
- Actions: `setInputTargetPin(id: MixLayerId | null)`.
- The derived target lives in `store/focusTrack.ts`:
  `inputTargetOf(s) = s.recordingTrack !== null ? s.focusTrack : (s.inputTargetPin ?? s.focusTrack)`.
- **Why record arm overrides the pin:** the recorder writes every performed note into the armed
  track whatever bus sounded it (`leadRecord.ts`, notes carry no bus). A pin to Chord with Lead
  armed would sound Chord and write Lead. The arm can only be set on the focused track and disarms
  when focus leaves it (`startRecordArmSync`), so while armed, "follow focus" = "play the armed
  track". The pin is kept and resumes on disarm. The disarm rules themselves do not change.

## What reads which

| Follows the input target (`inputTargetOf`) | Stays on `focusTrack` |
|---|---|
| `useInputDeck`: the patch and arp it plays (`synthTargetForFocus` call sites), the bus captured at note-on (R164 unchanged: captured, never recomputed) | Pattern segment, Sound channel, mixer row, `SegmentedControl`, `SegmentHeader` |
| R167's drum no-op | Solo button and solo nav |
| The dock's chip label, the panel (pads vs keyboard), the mode picker's visibility | Record arm and its disarm sync |

External MIDI still plays Lead (R168); making it follow the target is out of scope.

## Removed

- `inputPanelMode`, `setInputPanelMode`, `InputPanelMode` (if nothing else uses it).
- `store/focusPanelSync.ts` and its mount (`App.tsx` ~line 107).
- `PanelTabs` and `CollapsedSummary` in `BottomInputDock.tsx`; the mode toggle in
  `KeyboardToolbar`, which moves to the header.

## Dock header

`[chevron + "Input" (label hidden below md)] [ON <target> ▾ | link] [<mode> ▾]`

- The chip and the link button are one joined group. Pinned: both take the primary/accent style,
  and the link icon becomes unlink (lucide `Link2` / `Unlink2`). Titles: "Follow selection" /
  "Pinned — follow selection again".
- The mode picker is a daisyUI dropdown like the chip (three values, `dropdown-top`), in both the
  open and collapsed states.
- Must fit one row at 375px with no overflow.
- Check the daisyUI v5 docs for every class used.

## kbd utility

In `@utility kbd-key`, show the keycap only on a desktop screen with a fine pointer: hide it unless
`(width >= 64rem) and (hover: hover) and (pointer: fine)` (use the `lg` breakpoint variable rather
than a literal if the utility syntax allows it). The pointer condition hides it on an iPad in
landscape too. Check that a key or pad with its keycap hidden keeps its layout (`KeyCap` in
`Keyboard.tsx`, the pad header in `DrumPadGrid.tsx`).

## Docs

- R341 in `.claude/rules/note-input.md` (the target and the link) plus a Prohibited entry. Amend
  R163/R167 wording to say "input target". Update `components.md` if it describes the dock tabs.
- ADR-0048 (context = the two use cases; decision; rejected: a lock icon, a separate `linked`
  boolean beside a target field, keeping the Keyboard | Drums tabs, forcing the target to Lead
  while armed). Mark ADR-0016 as amended. Add the index row.

## Tests

- `inputTargetOf`: linked follows focus; pinned ignores focus; armed follows focus despite a pin.
- Sanitize: a valid pin kept, junk → `null`; `PERSISTED_KEYS` and the store writer-probe list gain
  `inputTargetPin`.
- `useInputDeck`: a pinned target plays its patch while focus is elsewhere; a drum pin makes the
  melodic keyboard a no-op.
- Dock render: pads iff target is `drum`; no Keyboard/Drums tabs; the mode picker is present when
  collapsed and absent for `drum`; the pinned chip carries the unlink icon and accent class; picking
  while linked calls `setFocusTrack`, while pinned `setInputTargetPin` (source or store assertion,
  since `renderToString` cannot click).
- `kbd-key` CSS: assert the media rule is in `index.css`.
- Browser at 402px and 1024px: the header fits in one row; pin Lead, switch to the Beat segment, the
  chip still says Lead and the keyboard still shows; `kbd` hidden at 402 and 900, shown at 1280 (the browser pane has a mouse, so `pointer: fine` holds).

## Gate

`bun run verify` exit 0; `bun run eslint` zero warnings. Commit per logical change.

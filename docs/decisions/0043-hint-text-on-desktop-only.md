# ADR-0043: Hint text on the desktop frame only

**Status:** Accepted — 2026-09-23. Builds on [ADR-0041](0041-mobile-frame.md).

## Context

Many surfaces carried a line of muted prose under or beside their heading: the Chord, Bass and Pad
module cards' descriptions, the Simple synth deck's intro, group kickers and per-knob hints, the
chord catalog's "Hold to preview, + to add:" and "Add colorful non-diatonic flavor:", the Master
Dynamics paragraph, and the preset libraries' header subtitle. On a phone each costs one to three
lines of height on every card, and a sentence a returning user no longer reads.

## Decision

- `HINT_TEXT` (`ui/fieldClasses.ts`, `max-md:hidden`) marks prose that describes or teaches a
  surface. It shows on the desktop frame and is hidden below `md`, the layout-mode width.
- It is a hide, not a deletion: the desktop frame keeps the words for a first-time user, where the
  width costs nothing.
- State, feedback and warnings are not hints and never wear it: empty states, loading text,
  errors, the incident and confirm dialogs, the project-replace warning, the loop-copy notices,
  and the Drive permission statement.
- A preset's own description is content that helps choose it, not a hint. It stays on the phone,
  clamped to one line.
- The chord catalog's "Hold to preview" cue is hidden too. The `+` explains the append, and holding
  a chip sounds at once, so the gesture is found by trying it.
- A module card's header centres its title against its buttons on a phone, since the description
  no longer makes the title block two lines tall.

## Rejected alternatives

- Deleting the prose everywhere. It still helps on the desktop frame, where it costs no height.
- A hide written per site (`hidden md:block`, `max-md:hidden`). One knob hint already used
  `hidden sm:block`, which left it showing between 640px and the mobile frame's edge; a single
  token keeps every hint on the layout-mode width.
- Moving the hints into tooltips on a phone. Touch has no hover, so a `title` never shows there.

## Consequences

- `fieldClasses.test.ts` pins each hint site to `HINT_TEXT` by a marker in its text. A new
  description is added to that table.

## Rules this implies

- **R323**: Descriptive prose wears `HINT_TEXT` and shows on the desktop frame only; state,
  feedback and warnings never wear it, and a phone surface reads from its headings and controls.

## Sources

The design discussion on branch `feat/mobile-arrange-rows`, and `src/components/ui/fieldClasses.ts`.

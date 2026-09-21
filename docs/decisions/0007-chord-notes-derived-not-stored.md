# ADR-0007: A chord's notes are derived on read

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

`ChordItem` used to store `notes` alongside `root`/`quality` and trusted every writer to keep them
in sync. The sanitize boundary could only check that a stored `notes` was an array of strings,
never that it matched the chord it sat beside, so an imported or hand-edited body could carry a
`notes` array naming a different chord than its own `root`/`quality` said — and playback, preview
and display would each sound or show a different chord depending on which of them still bothered to
derive fresh rather than trust the stored array.

## Decision

**A chord's notes are derived at the moment they are needed, never a second stored fact.**
`ChordItem` carries `id`, `root`, `quality`, `bars` and an optional `bassNote` — never `notes`.

Every consumer that needs the actual pitches — live chord playback, the pad arm, bass chord-tone
fallback, the held-chord preview, the progression audition, the chord card's readout, the loop
card's tooltip — calls `generateBlockChordNotes(quality, root, octave)` (the single Music
Core-backed derivation entrypoint `src/utils/musicTheory.ts` re-exports) with whichever octave that
surface already owns (a loop's `chordOctave`, its `bassOctave`, its `padOctave`, or a fixed
audition octave), never a `chord.notes` field, because there is none to read.

The sanitize boundary (`store/sanitize.ts`) enforces the same shape on the way in: `toChordItem`
rebuilds every persisted chord as a fresh `{id, root, quality, bars, bassNote?}` literal rather than
casting the raw input through, so a `notes` field left over in old or hand-edited data cannot
survive sanitization even though nothing explicitly rejects it.

## Consequences

- Deriving on every read makes the notes/chord disagreement structurally impossible instead of
  merely validated against.
- Changing `chordOctave` is now a single field write (`setChordOctave` in `store/chordsSlice.ts`
  sets nothing else) with nothing else to keep in sync, because there is nothing else stored to
  fall out of sync.
- Old or hand-edited bodies carrying `notes` are silently cleaned by the rebuild, consistent with
  validation-over-migration ([ADR-0023](0023-validation-instead-of-migration.md)).
- Chord-quality resolution behind `generateBlockChordNotes` is Music Core's
  ([ADR-0005](0005-music-core-and-tonal-confinement.md)).

## Rules this implies

- **R069** — `ChordItem` = `id`, `root`, `quality`, `bars`, optional `bassNote`; never `notes`.
- **R070** — Every pitch consumer calls `generateBlockChordNotes(quality, root, octave)` with the
  octave its surface owns (`chordOctave`/`bassOctave`/`padOctave`/fixed audition octave).
- **R071** — `setChordOctave` (`store/chordsSlice.ts`) writes only the octave.
- **R072** — `toChordItem` (`store/sanitize.ts`) rebuilds a fresh `{id, root, quality, bars,
  bassNote?}` literal, never casts raw input through.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 214-234.

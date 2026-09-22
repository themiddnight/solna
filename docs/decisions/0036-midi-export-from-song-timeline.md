# ADR-0036: MIDI export from the song timeline

**Status:** Accepted — 2026-09-22. DEV-428

## Context

DEV-420 made the song timeline pure (`walkSongTimeline`/`buildSongTimeline`, ADR-0034): an
arrangement becomes timed note/drum events with no `AudioContext` and no engine call. DEV-421 made
export kinds data (`ExportKindSpec` in `store/exportKinds.ts`, ADR-0035): a new export format is
one spec entry, not a rewrite of the runner. A MIDI file needs neither an `OfflineAudioContext`
nor any DSP — it needs the same timed events the WAV performer already walks, encoded as bytes
instead of rendered as audio. Before this change, `yieldPreservingRandomStream` (the seeded-RNG
yield used to keep a long render cancellable) lived in `renderMixdown.ts` beside
`createRenderEngine`, so any file that wanted the same seeded, cancellable walk had to import the
renderer — and with it, transitively, the engine.

This branch stacks directly on DEV-421's tip (ADR-0035), which is not yet merged to `main`, rather
than on `main` itself; the export kind pattern and the runner it composes with are therefore
already in place for this decision to build on, not something this decision also has to invent.

## Decision

A format-1 Standard MIDI File is built from the same `walkSongTimeline` the WAV performs, so the
two outputs cannot disagree about what plays when:

1. Format 1: a conductor track (title, tempo, time signature) plus one track per lane — six lane
   tracks always written, even when empty, so a track's lane and channel never shift with content.
2. PPQ 480 — every grid position the app can emit (16th, Lead/FX 1/32, triplet 16th) is an exact
   integer tick, so strum and feel offsets round by at most ~0.5 ms.
3. No key-signature meta (`FF 59`) — Solna's modal and exotic scales have no honest
   sharps/flats count, and spelling is a display-only decision (R064), not a `FF 59` fact.
4. Fixed channels (Chord 1, Bass 2, Pad 3, Lead 4, FX 5, Beat 10) and no program change — the app
   claims no GM instrument mapping; the DAW assigns instruments.
5. A GM percussion map (kick 36 … bell 56, the 808 cowbell circuit) lives beside the builder.
6. The file holds the **performed** timeline — arp, chord rhythm, strum and hold already
   resolved, nothing re-derived; a drum lasts one 16th (GM percussion ignores note length).
7. Velocity is linear `round(v·127)` clamped 1..127; `v ≤ 0` drops the note (silent in the WAV,
   and a note-on at velocity 0 is a note-off in MIDI).
8. Note-off is the timeline's clipped `endSec` (no synth release tail); on one channel and pitch,
   a same-tick start merges into the earlier note and a later start cuts the earlier one, so no
   channel ever holds two sounding instances of one pitch.
9. Mute is honoured exactly like the WAV — per loop bus row and, for drums, per Beat voice gain —
   and solo never reaches the file, because it never reaches the snapshot the WAV reads either.
10. Note numbers are resolved by `noteMidi` (`@/musicCore`) only at the MIDI boundary; the timeline
    itself stays one ROOTS-spelled, unit-agnostic shape (R051, R064); an unparseable name drops
    that note.
11. `src/audio/export/smfWriter.ts` (pure SMF byte encoder) and `src/audio/export/renderMidi.ts`
    (song → SMF) are new. `yieldPreservingRandomStream` moves, verbatim, from `renderMixdown.ts`
    to `rng.ts`, so `renderMidi.ts` never imports the renderer or the engine. This retires the
    DEV-420/421 working constraint that `renderMixdown.ts`'s source stay byte-unchanged — the real
    invariant is `renderMixdownGolden.test.ts`, which pins the renderer's *output* bytes, not its
    source text, and it passed unchanged across the move.
12. Both files are seeded with `MIXDOWN_SEED`, so two exports of one project are byte-identical;
    an arp `'random'` lane's MIDI notes may still differ from that project's WAV, because the WAV
    interleaves engine draws (noise offsets, sample-and-hold buffers) with the arp's on one seeded
    stream and the MIDI export does not run the engine at all (accepted, documented below).
13. File `<slug>.mid`, MIME `audio/midi`, dialog label "Export MIDI (.mid)", incident operation
    `'midi-export'`.
14. Tests: golden bytes pin `smfWriter.ts`'s encoder; a parse-back + timeline-equivalence test
    (via the test-only `smfTestReader.ts`) pins `renderMidi.ts` against `buildSongTimeline`; no
    committed hash of a whole-song `.mid`. `smfWriter.ts` throws `RangeError` on an out-of-range
    channel, note, velocity or tick — a thrown writer is a `render-failed`, never a silently
    corrupt file — and the writer test asserts each case with `toBeInstanceOf(RangeError)`.
15. Conductor title is the project name (UTF-8 via `TextEncoder`) or `Solna` when the project is
    unnamed.

An ESLint block scoped to `renderMidi.ts`/`smfWriter.ts` restates the `audio/` layering bans and
additionally bans the engine module and its DSP neighbours outright; it allows only a type-only
import from `./renderMixdown` (`MixdownFailureReason`/`MixdownProgressReporter`), so the ban is
mechanical, not a convention. `smfTestReader.ts` is excluded from the production Knip graph, like
the other test-only support files beside their production code. R287 (ADR-0034) widens: the "one
place an arrangement becomes timed events, no lane planner" guarantee it states for
`renderMixdown.ts` now also names `renderMidi.ts`.

**Rejected alternatives:**
- `src/utils/smf.ts` for the writer — it has one consumer today; lift it to a shared location the
  day a second one (stems metadata, MIDI input) appears (R276).
- Omitting empty lane tracks — the track↔lane mapping would then shift with content, and a DAW
  template built on one export would misroute the next.
- Format 0 (one track, channels only) — the importer must split it itself and the lane names are
  lost.
- PPQ 96 — the 1/32 cell would be 12 ticks and a strum offset would quantise to ~5 ms at 120 BPM,
  audibly flamming a strum.
- Emitting overlapping same-pitch notes and letting the receiver pair note-offs — DAWs pair them
  FIFO or LIFO inconsistently, so the same file would import with different note lengths in
  different hosts.
- One `FF 59` per pass, for Major/Natural-Minor loops only — a file that carries a key for some
  loops and silently not others misleads more than one that carries none.
- A fixed GM program per lane — it pretends a patch export and is wrong for most loops; the DAW
  assigns instruments instead.
- `src/data/drumGmNotes.ts` for the GM map, as the focus-track spec once proposed — it is not
  factory content (`data/` holds that only, R021), and moving it later, when MIDI input needs the
  same table, is a lift to a shared location (R276), not a reason to pre-place it.
- Ignoring mute entirely — the WAV and the MIDI of one project would then disagree about which
  parts exist, and mute is arrangement intent the mixdown deliberately exports.
- Honouring mute flags only, without the gain-0 fader case — a fader pulled to the bottom is
  silent in the WAV exactly like a mute, and the rule "the MIDI holds what the WAV plays" would
  then have a silent exception.
- Importing `yieldPreservingRandomStream` from `renderMixdown.ts` instead of moving it — that
  would keep a runtime edge from `renderMidi.ts` into the engine-touching renderer, the one thing
  this decision exists to avoid.

## Consequences

A GM percussion map now exists in the codebase. ADR-0016's external MIDI input handling stays
focus-agnostic and is not changed by this decision; lifting the GM map to a shared location is a
R276 move for whichever day a second reader (MIDI input, stems metadata) needs it, not something
to anticipate now. An arp `'random'` lane's exported MIDI notes may differ from the same project's
WAV (spec risk R2) — documented in `renderMidi`'s docblock, not hidden. Key changes are not represented
in the file; every note is a plain pitch number, so nothing is lost musically, only the visual key
signature a DAW might otherwise show.

## Rules this implies

- **R296** — MIDI export is built only from `walkSongTimeline`; `renderMidi.ts` calls no lane
  planner (`planArrangement` only sizes the walk) and re-derives no arp, rhythm, strum or hold.
- **R297** — A timeline event is exported iff the WAV makes it audible by routing: its loop's bus
  row is unmuted with gain > 0 (drums: and the voice's `beatVoiceGains` > 0). Solo never reaches
  it.
- **R298** — A MIDI note number comes from `noteMidi` (`@/musicCore`) applied to the timeline's
  ROOTS name in `renderMidi.ts`; `TimelineEvent` never carries Hz or a note number, and nothing
  converts Hz to MIDI.
- **R299** — `GM_DRUM_NOTE` and `MIDI_TIME_SIGNATURE` are `Record`s over `BeatVoiceId` and
  `MeterId`; they and `MIDI_LANES` live beside the MIDI builder, not in `src/data/`.
- **R300** — On one channel and pitch at most one note sounds: a same-tick duplicate merges, a
  later start cuts the earlier note; note-offs precede note-ons at equal ticks.

Identical to `.claude/rules/export.md`'s `## MIDI` section.

**Amends [ADR-0034](0034-pure-song-event-timeline.md): R287** — the "one place an arrangement
becomes timed events, no lane planner" guarantee now also names `renderMidi.ts`.

## Sources

`docs/superpowers/specs/2026-09-22-dev-428-midi-export-design.md`,
`docs/superpowers/plans/2026-09-22-dev-428-midi-export.md`, Linear DEV-428.

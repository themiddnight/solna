# ADR-0059: An interop reader with its own contract

**Status:** Accepted — 2026-10-09. Amended by [0060](0060-embedded-resolved-song.md): the app now
writes the resolved song into every file it saves, and `readSolnaSong` is the reader for files
without one.

## Context

murva's Arrange room imports a `.solna` project (murva spec
`2026-10-09-solna-project-import-design.md`). A `.solna` file stores what the user set, not what
plays: Chord, Bass and Pad are derived at play time from the progression, the rhythm and pattern
ids, the octaves and the arp; only Lead and FX store notes, and those in ticks of this app's own
grid. A consumer that read the file directly would have to re-implement the lane planners and
would go stale with every content change here — a new chord rhythm, a new bass pattern, a new
`formatVersion`.

The app already resolves a project into timed events without audio: `buildSongTimeline`
(ADR-0034), the walk the WAV and MIDI exports perform (ADR-0036).

## Decision

1. `src/interop/` is a second entry point beside `src/main.tsx`. `bun run build:interop` bundles
   `src/interop/index.ts` into `dist-interop/solna-interop.js` (ESM, `tonal` external, not
   committed). Nothing in the app imports that index. Since [0060](0060-embedded-resolved-song.md),
   `store/projectFile.ts` imports two modules of the folder, `resolveSong.ts` and `embeddedSong.ts`.
2. `readSolnaSong(text)` reads a file through the app's own validator (`parseProjectFile`) and
   hands the body to `resolveSong` (`resolveSong.ts`, split out by 0060), which uses the
   export snapshot (`buildMixdownSnapshotFromContent`) and the export walk (`buildSongTimeline`,
   under `MIXDOWN_SEED`). `resolveSong` regroups that timeline by loop, part and pass and converts seconds to
   beats. It calls no lane planner and derives no note of its own.
3. `src/interop/contract.ts` is the whole public shape of the song and imports nothing, so a consumer copies
   it verbatim as the bundle's type declaration. Times are quarter-note beats, pitches MIDI
   numbers, levels fader dB, velocity linear 0..1. The synth patch is restated inline;
   `conformance.test.ts` stops compiling when it drifts from `EnginePatch<'subtractive'>`.
4. `SOLNA_INTEROP_CONTRACT_VERSION` is bumped for a change a consumer could read differently — a
   renamed or removed field, a changed unit, a changed guarantee. An added optional field is not a
   bump.
5. Mute is reported, not applied: a muted part still lists what it would play, and the consumer
   decides. A Beat VOICE mute is applied, because the walk itself schedules nothing for it.
6. A chord is named by Tonal's symbol for its registered alias (`chordSymbol`, `@/musicCore`),
   which any Tonal-based consumer parses back to the same intervals.
7. The contract carries no vocabulary of any consumer. Mapping a patch leaf, a drum voice or a
   scale name onto another app is that app's work.
8. `buildMixdownSnapshot(s)` now delegates to `buildMixdownSnapshotFromContent(content, buses)`.
   The song-level `buses` rows are session mix state, not project content; the reader passes `[]`
   because the walk never reads them.

## Consequences

- A content addition that the planners already resolve (a rhythm, a pattern, a preset, a scale)
  reaches a consumer by rebuilding the bundle, with no contract change. Since
  [0060](0060-embedded-resolved-song.md) it also reaches a consumer through any file saved after
  the addition, with no rebuild.
- A new patch leaf fails the consumer's own exhaustiveness test against `SOLNA_REFERENCE_PATCH`
  on its next bundle update, instead of being dropped silently.
- The bundle is about 220 kB unminified: it carries the planners and the content tables. It
  contains no React and no store runtime.
- A random arp reads the same on every call, and may differ from the notes of that project's WAV
  for the reason ADR-0036 records.

## Rejected

- **Vendoring this app's source into the consumer.** About fifteen thousand lines that drift from
  the day they are copied.
- **Having the consumer parse the MIDI export.** It loses the per-loop patch, level and mute, the
  loop boundaries, the chord symbols and the key.
- **A contract that names the consumer's instruments or parameters.** It would couple this repo's
  releases to another app's model.

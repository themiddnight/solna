---
paths:
  - "src/musicCore/**"
  - "src/utils/musicTheory.ts"
  - "src/utils/noteSpelling.ts"
  - "src/data/scales.ts"
  - "src/data/chordProgressions.ts"
  - "src/store/chordsSlice.ts"
  - "src/store/sanitize.ts"
  - "src/audio/leadStepRecord.ts"
  - "src/audio/bassPatterns.ts"
  - "src/audio/arpeggiator.ts"
  - "src/audio/playback/padPlayback.ts"
  - "src/components/loop/lead/melodyGrid.ts"
  - "src/components/ui/Keyboard.tsx"
  - "src/components/loop/chord/**"
  - "src/store/keyChange.ts"
  - "src/store/reharmonizeNav.ts"
  - "src/store/musicContextSlice.ts"
---

# Music domain

Music Core, chord qualities, scale-degree derivation, note spelling, chord notes, reharmonization and Roman numerals.

## Music Core and Tonal

- `tonal` is imported only from `src/musicCore/tonalAdapter.ts`; `src/audio/` never imports it. <!-- R044 -->
- Every other file needing pitch, interval or chord-quality operations imports `src/musicCore/index.ts`. <!-- R046 -->
- `utils/noteSpelling.ts`, `utils/musicTheory.ts`, `audio/arpeggiator.ts`, `audio/bassPatterns.ts`, `audio/playback/padPlayback.ts`, `store/midiInput.ts` import no `tonal` and keep their public exports. <!-- R047 -->
- `src/musicCore/chordQuality.ts` owns the one chord-quality registry (token, Tonal alias, display suffix, picker label/group, reharmonization category); `ChordItem['quality']`, the picker options, `formatChordQuality`/`formatChordLabel` and `resolveChordNotes` derive from it. <!-- R048 -->
- An unregistered quality literal is a compile error; an unregistered runtime string throws at `resolveChordNotes`, never a silent `maj`. <!-- R049 -->
- `src/musicCore/**` imports nothing from `store/`, `components/`, `audio/` or `utils/`; dependencies run audio → Music Core and utils → Music Core only. <!-- R050 -->
- Keep three kinds apart: musical intent (persisted user decision), derived representation (pure function of intent), playable event (resolved, timestamped, owner assigned — the engine's sole input, DEV-399). Contract: `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`. <!-- R051 -->
- Music Core owns pitch parsing, octave extraction and scale fallback; nothing outside `src/musicCore/` hand-rolls a note-name regex. <!-- R082 -->
- Primitives: `octaveOfNote`, `noteMidi`, `pitchClassOfNote`, `chromaOfNote`, `midiToSharpName` (`tonalAdapter.ts`); `transposePitchClassPreservingOctave` (`pitch.ts`); `scale.ts` is the one place an unknown scale type resolves to Major. <!-- R083 -->
- Core functions fail explicitly (`null`/`NaN`), never substitute; a consumer's defensive default stays in the consumer's file. <!-- R084 -->
- `NOTE_REGEX_BAN` bans any regex literal in `leadStepRecord.ts`, `bassPatterns.ts`, `melodyGrid.ts`, `Keyboard.tsx`, `musicTheory.ts`. <!-- R085 -->

([ADR-0005](../../docs/decisions/0005-music-core-and-tonal-confinement.md))

## Degree qualities and spelling

- `SCALES` states `intervals` (pinned by `src/data/scales.test.ts`), `tonal`, `tonality` and, for scales under seven degrees, a 7-note `parent`; it states no chord qualities. <!-- R061 -->
- `resolveDegreeQuality` maps a degree onto the parent by semitone offset, stacks thirds over spelled names and measures with `Interval.distance`; never index `degree % 7` (wrong quality, right shape). <!-- R062 -->
- An unmapped interval tuple throws (no `maj` fallback); `SCALES` gets no override fields. <!-- R063 -->
- A sharp name is an identity: everything generated, computed or persisted is `ROOTS`-spelled. <!-- R064 -->
- `src/utils/noteSpelling.ts` spells for display only, at `formatChordLabel`'s third parameter, `leadRowLabel`, the keyboard `label`, `KEY_OPTIONS`, and `getTonicSpelling(scaleRoot, scaleType)` for a purely rendered key name. <!-- R065 -->
- Decide by what the value becomes next: a stored, compared or lookup-key value stays `ROOTS`-spelled. <!-- R066 -->
- The progression quick-save name is built from the raw root and is not spelled (it is persisted). <!-- R067 -->
- Nothing spelled is persisted, so spelling never moves the persist `version` or `.solna` `formatVersion`. <!-- R068 -->

([ADR-0006](../../docs/decisions/0006-derived-degree-qualities-and-display-spelling.md))

## Chord notes are derived

- `ChordItem` is `id`, `root`, `quality`, `bars`, optional `bassNote` — never `notes`. <!-- R069 -->
- Every pitch consumer calls `generateBlockChordNotes(quality, root, octave)` with the octave its surface owns (`chordOctave`, `bassOctave`, `padOctave`, or a fixed audition octave). <!-- R070 -->
- `setChordOctave` (`store/chordsSlice.ts`) writes only the octave. <!-- R071 -->
- `toChordItem` (`store/sanitize.ts`) rebuilds a fresh `{id, root, quality, bars, bassNote?}` literal, never casts raw input through. <!-- R072 -->

([ADR-0007](../../docs/decisions/0007-chord-notes-derived-not-stored.md))

## Reharmonization and Roman numerals

- `ChordQualityEntry.reharmonizationCategory` names the family; `shouldPreserveQualityOnSnap`: `sixth`, `added-tone`, `extension`, `suspended` PRESERVE; `triad`, `seventh`, `diminished-half-diminished`, `altered` REGENERATE the landing degree's diatonic quality. <!-- R073 -->
- The split tracks `resolveDegreeQuality`'s output set: a family regenerates iff some degree of some scale can emit it. <!-- R074 -->
- `dim`, `aug`, `dim7`, `minMaj7`, `maj7#5` regenerate. <!-- R075 -->
- `snapProgressionToScale` reads no substring of a quality token (no `includes('7')`/`includes('9')`); a source-scan test in `musicTheory.test.ts` pins it. <!-- R076 -->
- Root snap is nearest degree, tie to the lower-indexed degree (`nearestDegrees(...)[0]`). <!-- R077 -->
- `degreeToRoman` = position + case (lowercase iff the RESOLVED quality — the explicit override if present — has a minor third) + an accidental, for 7-degree scales only, comparing the scale's interval against Major's at that position. <!-- R078 -->
- The third degree never carries an accidental (`III`, never `bIII`). <!-- R079 -->
- Scales under seven degrees never get an accidental. <!-- R080 -->
- `CHORD_PROGRESSIONS` `roman` summaries are validated (numeral, case, accidental) by `src/audio/chordProgressions.test.ts`; the quality suffix stays unvalidated on purpose. <!-- R081 -->

([ADR-0008](../../docs/decisions/0008-reharmonization-category-and-roman-numerals.md))

## Key change

- A key change's chord harmonize runs only in `changeKey` (`store/keyChange.ts`), transpose then snap; never in a component effect. <!-- R279 -->
- `autoReharmonize` and `reharmonizedIndicator` are session-only store fields (not in `partializeAppState`, `PROJECT_CONTENT_KEYS` or `LOOP_FLAT_KEYS`); turning the toggle on rewrites nothing. <!-- R280 -->
- The badge clears only where chords are replaced wholesale: a vibe's single write, `applyLoopCopy` with `chord-progression`, library apply, toggle off, the `reharmonizeNav.ts` subscription (loop change, project install), and `undoLoopKeyChange` restoring the active loop. <!-- R281 -->

([ADR-0032](../../docs/decisions/0032-key-change-as-loop-content-operation.md))

## Prohibited

- Importing `tonal` outside `src/musicCore/tonalAdapter.ts` <!-- R044 -->
- Pitch, interval or chord-quality operations not routed through `src/musicCore/index.ts` <!-- R046 -->
- A second chord-quality table, or a silent `maj` for an unregistered quality <!-- R048 --> <!-- R049 -->
- `src/musicCore/**` importing `store/`, `components/`, `audio/` or `utils/` <!-- R050 -->
- Mixing musical intent, derived representation and playable event in one value <!-- R051 -->
- A hand-rolled note-name regex outside `src/musicCore/` <!-- R082 -->
- A core function substituting a default instead of returning `null`/`NaN` <!-- R084 -->
- Chord qualities or override fields in `SCALES` <!-- R061 --> <!-- R063 -->
- Indexing `degree % 7` into a parent scale <!-- R062 -->
- Persisting, comparing or keying on a spelled note name <!-- R064 --> <!-- R066 -->
- Spelling the progression quick-save name <!-- R067 -->
- A `notes` field on `ChordItem`, or reading stored chord notes <!-- R069 --> <!-- R070 -->
- `setChordOctave` writing anything besides the octave <!-- R071 -->
- Casting raw input through `toChordItem` <!-- R072 -->
- Reading a substring of a quality token in `snapProgressionToScale` <!-- R076 -->
- `bIII` on the mediant, or an accidental on a scale under seven degrees <!-- R079 --> <!-- R080 -->
- Harmonizing chords on a key change outside `changeKey` <!-- R279 -->
- Persisting the reharmonize toggle or badge <!-- R280 -->
- A per-writer badge clear on loop change instead of `reharmonizeNav.ts` <!-- R281 -->

# DEV-425 — Move rationale out of CLAUDE.md into ADRs (spec)

Status: draft for execution. Source snapshot: `CLAUDE.md` at `02cf1a9b` (946 lines, 78,566 chars).
All line ranges below refer to that snapshot. Writers: do not re-derive ranges from a later edit.

## 0. Target model (recap, binding for writers)

| Layer | Loaded | Holds |
|---|---|---|
| `CLAUDE.md` | every session + subagent | commands, `verify` gate, mounted-views rule, layer map (1 line/layer), cross-cutting invariants (1 line + link), traps, git, index of skills/rules/ADRs. Budget ≤ 15k chars. |
| `.claude/rules/<topic>.md` | when a `paths:` glob matches an opened file | normative rules for one area: rule + minimum "because", each tagged with its `R###` and a link to its ADR. |
| `docs/decisions/NNNN-<slug>.md` | on demand | Status, Context, Decision, Consequences, **Rules this implies** (`R###` list). Rationale, history, rejected alternatives, examples. |

Conventions for writers:
- Rule text in a rules file keeps every identifier the inventory row names. Tag each rule `(R###, ADR-NNNN)`.
- A row with destination `both` appears in CLAUDE.md as one line (+ link to the rules file) and in full in the rules file.
- ADR `Status:` = `Accepted` for all, dated 2026-09-22, "Recorded retroactively from CLAUDE.md (DEV-425)". Keep the DEV-### ids the source cites.
- Do not add `paths:` globs that match nothing. All globs in §2 were checked with `git ls-files -- ':(glob)…'` (counts given).
- Frontmatter format copies `.claude/rules/testing.md` (YAML list under `paths:`, quoted globs).

## 1. Rule inventory

Destination keys: `C` = CLAUDE.md; `r/<name>` = `.claude/rules/<name>.md`; `both` = C one-liner + rules file(s) listed.

### Preamble, commands, gates (1–53)

| ID | Rule | Lines | Dest | ADR |
|---|---|---|---|---|
| R001 | Never record version numbers, file counts or line numbers in CLAUDE.md, rules files or ADRs; read `package.json`/source and write the rule. | 5-7 | C | — |
| R002 | Runtime is Bun (tests + scripts); app is Vite + React. | 11 | C | — |
| R003 | Command table (`dev`, `build`, `lint`, `eslint`, `test`, `check:theme/keys/drums/contrast/levels`, `check:dead-code`, `check:dead-code:production`, `verify`). | 13-29 | C | — |
| R004 | `bun run verify` is the completion gate; run it before claiming work done. | 31 | C | 0029 |
| R005 | `bun run eslint` reports zero errors; no rule other than `react-hooks/exhaustive-deps` (and `complexity`, see §5 C2) may warn. | 31-33 | both: r/boundaries-and-gates | 0029 |
| R006 | Both Knip scans (`check:dead-code`, `check:dead-code:production`) hold a zero-finding baseline. | 33-34 | C | 0029 |
| R007 | Default Knip graph includes tests + manually invoked tooling; production graph excludes tests and narrowly named test-support fixtures (test-only-kept code shows as unused production file). | 34-37 | r/boundaries-and-gates | 0029 |
| R008 | D5: a new ESLint rule lands as `warn` and flips to `error` in the change that empties it. | 37-40 | r/boundaries-and-gates | 0029 |
| R009 | `React.FC` ban, `../../` ban, `consistent-type-definitions` are `error`. | 38-39 | r/boundaries-and-gates | 0029 |
| R010 | `react-hooks/exhaustive-deps` and `complexity` stay `warn`; every remaining site carries a line disable naming its reason; never relax the rule for everybody. | 41-43 | r/boundaries-and-gates | 0029 |
| R264 | Never ignore an ESLint warning: fix it or line-disable with a reason; eslint prints zero warnings (added 2026-09-22, user decision) | — | C + r/boundaries-and-gates | 0029 |
| R011 | `check:contrast` holds both `--drum-*` and `--module-*` palettes ≥ AA 4.5 in both themes; it is a gate, not a report. | 43-46 | r/theming (extend) | 0030 |
| R012 | Contrast rosters: Beat voices from `BEAT_VOICE_IDS` (CSS tokens stay `--drum-*`, same id strings); module names parsed from `index.css`; the CLI gate must not import a React component (`Knob`'s `KnobColor`). | 46-50 | r/theming | 0030 |
| R013 | Contrast script asserts both themes declare the same, non-empty module set (one-theme-only colour fails). | 51-53 | r/theming | 0030 |

### Mounted views and layers (55-189)

| ID | Rule | Lines | Dest | ADR |
|---|---|---|---|---|
| R014 | Every layer (Loop, Song), tab view (Sound, Pattern, Arrange, Master) and Pattern segment (Lead, FX, Accompaniment, Beat) stays mounted; gated `block`/`hidden` in `App.tsx` (`isSongLayer(activeTab)`), `LoopPage.tsx` (`activeTab`), `PatternView.tsx` (`segmentForFocus(focusTrack)`). | 57-62 | C | 0001 |
| R015 | Audio never stops when switching tabs. | 63 | C | 0001 |
| R016 | High-frequency state (playback step, playhead beat, knob drag value) stays local to the subtree that shows it, never in a store slice. | 63-66 | C | 0001 |
| R017 | Step and playhead beat travel through module pub/subs `src/components/playbackStep.ts`, `playheadBeat.ts`. | 66-67 | r/playback | 0001 |
| R018 | Accepted exception: `midiActivityTimestamp` is a ui-slice key written per MIDI message; it must stay unpersisted. | 67-69 | r/note-input (extend) | 0001 |
| R019 | Four layers enforced by eslint `no-restricted-imports` (+ `no-restricted-globals`, `no-restricted-syntax` for `src/data/`). | 71-72 | C | 0002 |
| R020 | `src/data/` imports nothing at runtime, not even a sibling in `src/data/`. | 74 | both: r/data-layer | 0002 |
| R021 | `src/data/` holds factory content only (synth presets, Beat presets, drum grids, chord progressions, chord rhythms, bass patterns, effect chains, scales). | 74-76 | r/data-layer | 0002 |
| R022 | `src/data/` reads no impure global (`Math`, `Date`, `crypto`, …), declares no function, uses no `new`, has no module-scope `let`/`var`. | 76-78 | r/data-layer | 0002 |
| R023 | `src/data/` may declare types and `import type` from anywhere. | 79 | r/data-layer | 0002 |
| R024 | Top-level `const` arrow literal-shorthand helpers (`step()`, `block()`, `strum()`) are allowed only in the same file as the table they build. | 79-81 | r/data-layer | 0002 |
| R025 | Every `src/data/` file is an independent leaf (no evaluation graph). | 81-82 | r/data-layer | 0002 |
| R026 | `src/data/dataLayerPurity.test.ts` (fixture sources linted through eslint's API) keeps R020-R025 true across tool upgrades; keep it. | 83-84 | r/data-layer | 0002 |
| R027 | Belongs in `src/data/` only if adding an entry is an edit to that table and nothing else; `METERS`, `THEME_TOKENS`, `VIEW_META` are registries and stay with their readers. | 84-86 | r/data-layer | 0002 |
| R028 | `src/audio/` never imports `store/` or `components/`; may import `data/`. | 87 | C | 0002 |
| R029 | Audio is raw Web Audio API; no Tone.js. | 88 | C | 0002 |
| R030 | One `audioEngine` singleton; every engine setter no-ops until `init()` creates the `AudioContext`. | 88-89 | r/playback | 0002 |
| R031 | `createRenderEngine(ctx)` is the one open door: throwaway engine on a caller context; `renderMixdown.ts` never touches `audioEngine`; its snapshot is assembled by `store/mixdownSlice.ts`. | 90-93 | r/playback, r/synth-voices | 0021 |
| R032 | `src/store/` never imports `components/`. | 94 | C | 0002 |
| R033 | One Zustand app store composed from the slices `store.ts` lists (that list binds) + one separate vanilla store `audioRecovery.ts`, outside the persisted store. | 94-98 | r/persistence | 0002 |
| R034 | `persist` key `musibox_project_state_v1`; `partialize` + `migrate` in `store.ts`; legacy-key adoption in `migrate.ts`; `subscribeWithSelector`. | 98-99 | r/persistence | 0023 |
| R035 | No per-version migration step; `PERSIST_VERSION` is stamped but drives no transform; a persisted shape change = validate the key in `merge`'s `sanitizePersistedState`, never bump the version. | 100-107 | both: r/persistence | 0023 |
| R036 | `store/driveAuth.ts` holds the only Google access token, in a closure; no getter hands it out. | 107-108 | r/persistence | 0025 |
| R037 | No slice reads the token; `driveSignedIn` is a mirror only; every Drive call acquires one via `withDriveToken` when needed; a token never enters a slice/`partialize`. | 108-112 | r/persistence | 0025 |
| R038 | `src/components/` = views + live playback controllers; must not import `audio/engine`. | 113-114 | C | 0002 |
| R039 | Controllers (`useChordPlayback`, `useLeadPlayback`, `useSequencerPlayback`, `useInputDeck`, `usePlayheadSync`) and pub/subs live in `components/`, reach audio via `audio/playback/playbackEngine`, never `audio/engine`. | 114-117 | r/playback | 0002 |
| R040 | Controllers are mounted inside the grids: a lane sounds because its grid is mounted. | 117-118 | C | 0001 |
| R041 | Only `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/GainReductionMeter.tsx`, `ui/SourceMeter.tsx` (read-only analyser consumers) and tests are exempt from the components→engine ban. | 119-123 | r/metering, r/boundaries-and-gates | 0028 |
| R042 | That exemption block turns `no-restricted-imports` off entirely (tonal + taper bans lifted); reviewers keep those four files free of such imports by hand. | 123-125, 159-161 | r/metering | 0028 |
| R043 | `eslint.config.js` is the binding list; any change to the analyser allowlist is made in the config AND in `r/metering`. | 125-127 | r/boundaries-and-gates, r/metering | 0002 |
| R044 | `tonal` is imported only from `src/musicCore/tonalAdapter.ts`. | 129-130 | both: r/music-domain | 0005 |
| R045 | Tonal confinement uses the replace-not-merge `no-restricted-imports` pattern (`TAPER_CONVERSION_BAN` mechanism). | 130-132 | r/boundaries-and-gates | 0005 |
| R046 | Every other file needing pitch/interval/chord-quality ops imports `src/musicCore/index.ts`. | 132-134 | r/music-domain | 0005 |
| R047 | The six ex-DEV-395 files (`utils/noteSpelling.ts`, `utils/musicTheory.ts`, `audio/arpeggiator.ts`, `audio/bassPatterns.ts`, `audio/playback/padPlayback.ts`, `store/midiInput.ts`) import no `tonal` and keep their public exports. | 134-138 | r/music-domain | 0005 |
| R048 | `src/musicCore/chordQuality.ts` owns the one chord-quality registry (token, Tonal alias, display suffix, picker label/group, reharmonization category); `ChordItem['quality']`, picker options, `formatChordQuality`/`formatChordLabel`, `resolveChordNotes` derive from it. | 138-142 | r/music-domain | 0005 |
| R049 | An unregistered quality literal is a compile error; an unregistered runtime string throws at `resolveChordNotes`, never a silent `maj`. | 142-144 | r/music-domain | 0005 |
| R050 | `src/musicCore/**` imports nothing from `store/`, `components/`, `audio/`, `utils/`; dependency runs audio→Music Core and utils→Music Core only. | 144-147 | both: r/music-domain | 0005 |
| R051 | Musical intent (persisted user decision) ≠ derived representation (pure function of intent) ≠ playable event (resolved, timestamped, owner assigned; the engine's sole input, DEV-399). Contract: `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`. | 147-155 | both: r/music-domain | 0005 |
| R052 | `src/data/`'s block already forbids every value import incl. `tonal`; no separate carve-out. | 155-156 | r/data-layer | 0005 |
| R053 | Import bans cover non-test `src/**` only: the final config block exempts `**/*.test.{ts,tsx}` from every import ban; `scripts/` is outside. | 156-159 | r/boundaries-and-gates | 0005 |
| R054 | `src/architecture/` holds cross-cutting architecture tests; `dependencyLayers.test.ts` proves Music Core layering + tonal confinement (layer bans are proved by `bun run eslint` over the tree). | 162-165 | r/boundaries-and-gates | 0002 |
| R055 | A non-test file in `src/architecture/` falls under the `src/**` catch-all; the folder has no layering block. | 165-167 | r/boundaries-and-gates | 0002 |
| R056 | `src/incidents/` may not import `store/`, `components/` or the audio engine (type-only `@/audio/runtime/*` allowed); a state snapshot must have no path into a report. | 169-172 | both: r/boundaries-and-gates | 0003 |
| R057 | `IncidentReportV1` is a closed schema (no open bag); `isIncidentReportV1` rejects unknown keys. | 172-173 | r/boundaries-and-gates | 0003 |
| R058 | `src/utils/` sits outside the chain above `data/`: may read `data/` at runtime; `data/` reads `utils/` only via `import type`. | 175-177 | both: r/data-layer | 0004 |
| R059 | `src/utils/` may import `@/musicCore`, never the reverse. | 177-180 | C | 0004 |
| R060 | Sole inversion: `utils/localFileSave.ts` and `utils/driveBrowser.ts` import types/constants (`.solna` MIME, Drive MIME) from `src/store/`; no `utils/` file reads store state, subscribes or names a slice. | 180-189 | r/boundaries-and-gates | 0004 |

### Music domain (191-293)

| ID | Rule | Lines | Dest | ADR |
|---|---|---|---|---|
| R061 | `SCALES` states `intervals` (pinned by `src/data/scales.test.ts`), `tonal`, `tonality`, and for <7-degree scales a 7-note `parent`; it states no chord qualities. | 191-194 | r/music-domain | 0006 |
| R062 | `resolveDegreeQuality` maps a degree onto the parent by semitone offset, stacks thirds over spelled names, measures with `Interval.distance`; never index `degree % 7`. | 194-198 | r/music-domain | 0006 |
| R063 | An unmapped interval tuple throws (no `maj` fallback); no override fields in `SCALES`. | 198-201 | r/music-domain | 0006 |
| R064 | A sharp name is an identity; everything generated, computed or persisted is `ROOTS`-spelled. | 201-202 | both: r/music-domain | 0006 |
| R065 | `src/utils/noteSpelling.ts` spells for display only, at: `formatChordLabel`'s 3rd param, `leadRowLabel`, the keyboard `label`, `KEY_OPTIONS`, `getTonicSpelling(scaleRoot, scaleType)` for purely rendered key names. | 203-206 | r/music-domain | 0006 |
| R066 | The boundary is what the value becomes next: stored, compared or lookup-key values stay `ROOTS`-spelled. | 206-208 | r/music-domain | 0006 |
| R067 | The progression quick-save name is built from the raw root and must not be spelled. | 208-211 | r/music-domain | 0006 |
| R068 | Nothing spelled is persisted; spelling never moves persist `version` or `.solna` `formatVersion`. | 211-212 | r/music-domain | 0006 |
| R069 | `ChordItem` = `id`, `root`, `quality`, `bars`, optional `bassNote`; never `notes`. | 214-215 | r/music-domain | 0007 |
| R070 | Every pitch consumer calls `generateBlockChordNotes(quality, root, octave)` with the octave its surface owns (`chordOctave`/`bassOctave`/`padOctave`/fixed audition octave). | 215-221 | r/music-domain | 0007 |
| R071 | `setChordOctave` (`store/chordsSlice.ts`) writes only the octave. | 228-230 | r/music-domain | 0007 |
| R072 | `toChordItem` (`store/sanitize.ts`) rebuilds a fresh `{id, root, quality, bars, bassNote?}` literal, never casts raw input through. | 230-234 | r/music-domain, r/persistence | 0007 |
| R073 | `ChordQualityEntry.reharmonizationCategory` names the family; `shouldPreserveQualityOnSnap`: `sixth`, `added-tone`, `extension`, `suspended` PRESERVE; `triad`, `seventh`, `diminished-half-diminished`, `altered` REGENERATE the landing degree's diatonic quality. | 236-242 | r/music-domain | 0008 |
| R074 | The preserve/regenerate split tracks `resolveDegreeQuality`'s output set (regenerate iff some degree of some scale can emit the family). | 242-248 | r/music-domain | 0008 |
| R075 | `dim`, `aug`, `dim7`, `minMaj7`, `maj7#5` regenerate. | 248-256 | r/music-domain | 0008 |
| R076 | `snapProgressionToScale` reads no substring of a quality token (no `includes('7')`/`includes('9')`); pinned by a source-scan test in `musicTheory.test.ts`. | 256-259 | r/music-domain | 0008 |
| R077 | Root snap = nearest degree, tie → lower-indexed degree (`nearestDegrees(...)[0]`). | 259-261 | r/music-domain | 0008 |
| R078 | `degreeToRoman` = position + case (lowercase iff the RESOLVED quality — explicit override if present — has a minor third) + accidental for 7-degree scales comparing against Major's interval at that position. | 263-269 | r/music-domain | 0008 |
| R079 | The third degree never carries an accidental (`III`, never `bIII`). | 269-272 | r/music-domain | 0008 |
| R080 | Scales with <7 degrees never get an accidental. | 272-274 | r/music-domain | 0008 |
| R081 | `CHORD_PROGRESSIONS` `roman` summaries are validated (numeral, case, accidental) by `src/audio/chordProgressions.test.ts`; the quality suffix stays unvalidated on purpose. | 274-277 | r/music-domain | 0008 |
| R082 | Music Core owns pitch parsing, octave extraction and scale fallback; nothing outside `src/musicCore/` hand-rolls a note-name regex. | 279-280 | both: r/music-domain | 0005 |
| R083 | Primitives: `octaveOfNote`, `noteMidi`, `pitchClassOfNote`, `chromaOfNote`, `midiToSharpName` (`tonalAdapter.ts`); `transposePitchClassPreservingOctave` (`pitch.ts`); `scale.ts` is the one place an unknown scale type resolves to Major. | 280-285 | r/music-domain | 0005 |
| R084 | Core functions fail explicitly (`null`/`NaN`), never substitute; a consumer's defensive default stays in the consumer's file. | 285-289 | r/music-domain | 0005 |
| R085 | `NOTE_REGEX_BAN` bans any regex literal in `leadStepRecord.ts`, `bassPatterns.ts`, `melodyGrid.ts`, `Keyboard.tsx`, `musicTheory.ts`. | 290-293 | r/music-domain, r/boundaries-and-gates | 0005 |

### Vibes, drum grids, Beat (295-397)

| ID | Rule | Lines | Dest | ADR |
|---|---|---|---|---|
| R086 | `VIBES` (`src/data/vibes.ts`) are `VibeSpec` literals naming ids only; `resolveVibe` (`store/vibes.ts`) → `ResolvedVibe`; `applyVibeToStore` writes it. | 295-298 | r/vibes-and-grids | 0009 |
| R087 | One drum-grid library `DRUM_GRIDS` serves the sequencer menu and vibes; entries carry `name`, `meter`, `kit`, `rows`. | 299-301 | r/vibes-and-grids | 0009 |
| R088 | `replaceBeatPattern` looks rows up by Beat voice id and clears every voice no row names; never merge. | 302-306 | r/vibes-and-grids, r/beat | 0009 |
| R089 | Clearing goes through `writeStepWindow` (active window only; wider-meter padding survives). | 306-308 | r/vibes-and-grids | 0009 |
| R090 | A grid never changes the sound; a grid's `beatPresetId` is provenance nothing applies. | 308-310 | r/vibes-and-grids | 0009 |
| R091 | Every grid row names a voice the Beat instrument plays (no `bass`); `drumGrids.test.ts` rejects others. | 310-314 | r/vibes-and-grids | 0009 |
| R092 | Every grid writes every row its origin group defines, empty or not. | 314-316 | r/vibes-and-grids | 0009 |
| R093 | Every grid carries `provenance` (URL or `'authored'`); the `'authored'` set is an allowlist in `drumGrids.test.ts`. | 316-319 | r/vibes-and-grids | 0009 |
| R094 | A URL-sourced grid may be re-voiced (hit to another row) but never re-transcribed (hit added/moved step); only `'authored'` grids gain or move hits. | 319-322 | r/vibes-and-grids | 0009 |
| R095 | The vibes table resolves nothing at module scope; no resolver call in `InstantVibesBar`. | 323-326 | r/vibes-and-grids | 0009 |
| R096 | Each vibe's dice pool is explicit arrays (`random.progressions`, …), never a filter over the shared library. | 327-329 | r/vibes-and-grids | 0009 |
| R097 | Beat per loop = exactly `beatParams` (sound), `beatPattern` (events), `beatMix` (levels); every action writes exactly one. | 331-333 | r/beat | 0010 |
| R098 | No fourth field/flat sibling; legacy names (`soundKit`, `drumFilter*`, `masterSequencerVolume`, `drumMuted`, `sequencerTracks`) appear only in `sanitizeBeat.ts`, its test and `beatLegacyBoundary.test.ts` (literal allowlist). | 333-338 | r/beat | 0010 |
| R099 | `readBeatState` is the only reader of the old shape; new writes never contain old fields. | 338-339 | r/beat | 0010 |
| R100 | `beatParams` carries `outputTrimDb` and its bus filter; no runtime trim table; `src/audio/trims.ts` must not exist; `src/data/trimTable.ts` is a generated artefact read by no runtime code (`check:levels` only). | 340-344 | r/beat | 0010 |
| R101 | Every Beat control writes the patch directly; knob drag previews via draft and commits once (`useBeatParamDraft`). | 345-346 | r/beat | 0010 |
| R102 | `applyBeatParams` (`src/audio/beatAdapter.ts`) is the one patch→DSP hop (live, preview, offline). | 346-347 | r/beat | 0010 |
| R103 | Voice order `kick snare rimshot clap hihat openhat hitom lowtom ride crash bell` is declared once in `BEAT_VOICE_IDS`; `BeatVoices`, `DEFAULT_BEAT_VOICES`, `BEAT_PRESETS`, `DEFAULT_PADS`, `triggerDrum` follow it. | 349-352 | r/beat | 0010 |
| R104 | `bell` has no pad (`PADLESS_VOICES`). | 353-354 | r/beat | 0010 |
| R105 | Pad velocity override = `drumPadVelocities` in the ui slice keyed by voice id, committed once on slider release, never per drag frame. | 354-355 | r/beat | 0010 |
| R106 | `BeatVoices` has no `reference` field; provenance lives on `FactoryBeatPreset`; `keyof BeatVoices` = the roster. | 356-358 | r/beat | 0010 |
| R107 | `DRUM_ALIASES` is exactly `{ closedhat: 'hihat' }`, asserted with `toEqual`. | 358-361 | r/beat | 0010 |
| R108 | A Beat patch is complete: every voice states every field; no `Partial` over a default, no `mergeDrumKit`. | 363-364 | r/beat | 0010 |
| R109 | `DEFAULT_BEAT_VOICES` is the default preset's own voices object (identity pinned by `beatPresets.test.ts`). | 365-367 | r/beat | 0010 |
| R110 | A Beat preset is installed whole (`structuredClone`), never merged. | 367-368 | r/beat | 0010 |
| R111 | New `check:drums` parameters enter through `spread()`/`spreadDefined()`, never `PAIRWISE_PARAMS`. | 370-373 | r/beat | 0011 |
| R112 | Voice-vs-sibling collapse inside one preset is covered by the within-kit check. | 373-376 | r/beat | 0011 |
| R113 | `spreadDefined` drops zeros and enforces a counted minimum. | 376-379 | r/beat | 0011 |
| R114 | `withinKit` fails closed on a non-finite ratio, with a counted minimum. | 379-381 | r/beat | 0011 |
| R115 | The "voiced away from default" check skips exactly one entry (the default preset), asserted. | 381-384 | r/beat | 0011 |
| R116 | A `spread()` factor chosen after measurement is commented as calibration and is a floor, never lowered. | 384-386 | r/beat | 0011 |
| R117 | All five reroll axes are id pools (`keys`, `progressions`, `chordRhythms`, `bassPatterns`, `drumGrids`); `progressions` and `drumGrids` use `pick`, the other three `pickDistinct`. | 388-392 | r/vibes-and-grids | 0009 |
| R118 | A rerolled vibe's `drumGridId` names the grid actually playing. | 392-393 | r/vibes-and-grids | 0009 |
| R119 | Do not reintroduce the density catalogue / kick-collision filter for authored grids. | 393-397 | r/vibes-and-grids | 0009 |

### Pattern grids and melody tracks (399-515)

| ID | Rule | Lines | Dest | ADR |
|---|---|---|---|---|
| R120 | Sequencer, chord-rhythm and bass grids store every bar at `MAX_STEPS_PER_BAR` and window to `stepsPerBar`. | 399-401 | r/pattern-grids | 0012 |
| R121 | Lead/FX store at `LEAD_TICKS_PER_BAR` (`utils/stepResolution.ts`) and stride; `leadMelodySteps`/`fxMelodySteps` index = tick; `LeadNote.len` in ticks. | 401-404 | r/pattern-grids | 0012 |
| R122 | Both dormancy tests (meter, resolution) live in `leadActivePosAt` only. | 404-406 | r/pattern-grids | 0012 |
| R123 | A view change (meter/resolution) never writes; only an explicit edit writes. | 406-407 | r/pattern-grids | 0012 |
| R124 | Three step layouts: drums on one-cell `StepRow`; Chord and Bass on the span timeline; melody on the pitch matrix; moving a lane between layouts is a design change (`playbackStep.wiring.test.ts` pins the drum half). | 409-415 | r/pattern-grids | 0012 |
| R125 | Span resize = `useSpanResize` over `spanResize.ts` with an opaque identity; commits once on `pointerup`, writes nothing on cancel, preview in local state; renderers are not shared. | 417-423 | r/pattern-grids | 0012 |
| R126 | Custom Chord/Bass pattern stored fixed-width (`MAX_STEPS_PER_BAR` per bar), bar-major. | 425-428 | r/pattern-grids | 0012 |
| R127 | Each lane's active length is independent and clamped to a divisor of the progression's bars. | 428-430 | r/pattern-grids | 0012 |
| R128 | An unreachable bar is dormant, not deleted; the read path pads a lane's width and never cuts it. | 430-432 | r/pattern-grids | 0012 |
| R129 | A custom span crosses neither the folded chord boundary (durations `%` cycle) nor its cycle end; the write clamps to the nearer. | 434-438 | r/pattern-grids | 0012 |
| R130 | A full-cycle custom span releases/retriggers at the seam; the full-hold fast path is preset-only (`isFullHoldRhythmCycle`/`isFullHoldBassCycle`). | 438-441 | r/pattern-grids, r/playback | 0012 |
| R131 | The Chord publisher emits a progression-relative absolute step; each reader folds by its own cycle; a producer never folds. | 443-447 | r/pattern-grids, r/playback | 0012 |
| R132 | `MELODY_TRACKS` (`store/melodyTracks.ts`) spells each row's store field names as data; no `` `${id}MelodySteps` `` convention. | 449-453 | r/melody-tracks | 0013 |
| R133 | `leadSlice` is one factory instantiated twice. | 454 | r/melody-tracks | 0013 |
| R134 | `LeadMelodyGrid` takes a required `trackId` with no default. | 454-457 | r/melody-tracks | 0013 |
| R135 | Two mounted melody grids hold two clock subscriptions (permitted by R220); neither starts a timer. | 457-458 | r/melody-tracks | 0013 |
| R136 | The step publisher is keyed per track (`StepPlayerId` includes `'fx'`). | 459-461 | r/melody-tracks | 0013 |
| R137 | `recordingTrack: MelodyTrackId \| null` in the ui slice: at most one armed track. | 461-463 | r/melody-tracks | 0013 |
| R138 | `store/leadRecord.ts` is a factory over `MELODY_TRACKS`; each bridge writes only while `recordingTrack` names its row; one shared anchor collector. | 463-465 | r/melody-tracks | 0013 |
| R139 | Rec renders on the grid `melodyTrackForFocus(focusTrack)` names; on neither for chord/bass/pad/drum focus. | 465-467 | r/melody-tracks | 0013 |
| R140 | `startRecordArmSync` clears the arm on layer change (not Sound↔Pattern), `activeLoopId` change and focus change; a project install clears it in the same atomic patch that clears solo. | 467-472 | r/melody-tracks | 0013 |
| R141 | Nothing couples the arm back to the audition target. | 472-474 | r/melody-tracks | 0013 |
| R142 | Known deferred limits, not bugs: FX synth voice has no pitch riser (filter env ramps `filter.frequency` only); LFO restarts per note. | 474-477 | r/melody-tracks, r/synth-voices | 0013 |
| R143 | `keyChangePatch` (`store/musicContextSlice.ts`) is the whole write for a root/scale change, transposing/remapping every `MELODY_TRACKS` row; a vibe folds it into its single `set()`. | 479-482 | r/melody-tracks | 0013 |
| R144 | Loop-copy `key` group copies the key and transposes neither melody (`impliesKeyCopy`). | 482-484 | r/melody-tracks | 0013 |
| R145 | A view change never deletes/hides an out-of-key note: `leadPitchRows` merges out-of-scale notes from `leadNotesInWindow` back in as rows. | 503-507 | r/melody-tracks | 0013 |
| R146 | A borrowed row is derived, not stored; a note unreachable by resolution/loop length conjures no row. | 507-510 | r/melody-tracks | 0013 |
| R147 | A borrowed row's window is the span the scale rows cover, not the octave suffix. | 510-513 | r/melody-tracks | 0013 |
| R148 | Out-of-scale rows use `--color-accent` via `leadSpanClasses`' 3rd arg and `leadRowLabelTone`. | 513-515 | r/melody-tracks | 0013 |

### Loops, solo, input, voices, synth patch (486-703)

| ID | Rule | Lines | Dest | ADR |
|---|---|---|---|---|
| R149 | `deleteLoop` is one `set()` that also installs the fallback loop's fields (`projectSlice.reconcileActiveLoop` shape); callers never follow with `loadLoop`. | 486-489 | r/loops-and-solo | 0014 |
| R150 | `deleteLoop` touches no audio; the UI calls `deleteLoopLive` (`store/loadLoop.ts`), which wraps it in `crossLoopSeam` when the transport runs the deleted loop. | 489-492 | r/loops-and-solo | 0014 |
| R151 | The transport never stops on delete: deleted loop's voices cut at `LOAD_LOOP_RELEASE`, clock reset, fallback enters at step 0. | 492-496 | r/loops-and-solo | 0014 |
| R152 | Only an audition scoped to the deleted loop stops. | 496-497 | r/loops-and-solo | 0014 |
| R153 | `deleteLoop` returns `DeletedLoop`; `restoreLoop` reinserts at its index without activating. | 497-498 | r/loops-and-solo | 0014 |
| R154 | Arrange offers a timed Undo toast (not a confirm); `undoLoopDelete` reactivates via the same seam (or `loadLoop` when idle); Undo never stops the transport. | 498-500 | r/loops-and-solo | 0014 |
| R155 | A project install dismisses a pending Undo (`projectInstallCount`). | 500-501 | r/loops-and-solo | 0014 |
| R156 | `soloTracks` is in the ui slice, absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`, never touches `LoopMixPatch`. | 517-520 | r/loops-and-solo | 0015 |
| R157 | Solo is a set (not a radio), beats mute, scopes the whole loop. | 520-522 | r/loops-and-solo | 0015 |
| R158 | Solo clears on layer change (`layerForTab`) or `activeLoopId` change (single subscription in `store/soloNav.ts`) and on project install (`projectSlice` atomic clear). | 522-526 | r/loops-and-solo | 0015 |
| R159 | A `focusTrack` change never clears solo. | 526-537 | r/loops-and-solo | 0015 |
| R160 | Effective audibility is computed only in `engineSync.ts` (`SOURCE_BUSES` + `isTrackAudible` from `store/trackAudibility.ts`); a view never computes it. | 539-542 | both: r/loops-and-solo | 0015 |
| R161 | Solo moves the Beat bus only; per-voice mute (`beatMix.voices`) is independent; both must pass. | 542-544 | r/loops-and-solo, r/beat | 0015 |
| R162 | Per-voice mute has two appliers, keep both: `audio/beatSteps.ts` skips hits; `engineSync`'s `pushBeatVoiceGains` sets gain 0 (pads, live triggers). | 544-547 | r/beat | 0015 |
| R163 | Keyboard, on-screen keyboard and arp play the track `focusTrack` names (bus and patch). | 549-550 | r/note-input (extend) | 0016 |
| R164 | A note's bus is captured at note-on, never recomputed at release. | 550-551 | r/note-input | 0016 |
| R165 | Equal-power polyphony counts held notes per bus, never globally. | 551-553 | r/note-input | 0016 |
| R166 | The arp releases every bus it actually triggered. | 553-555 | r/note-input | 0016 |
| R167 | `drum` focus makes the melodic keyboard a complete no-op (nothing sounds, nothing on the note-input bus); drum-pad keys are a separate listener. | 555-558 | r/note-input | 0016 |
| R168 | External MIDI always plays Lead (`store/midiInput.ts` names `'synth'`) whatever the focus. | 558-561 | r/note-input | 0016 |
| R169 | `triggerSynthNoteOn` returns a `VoiceId` (`src/audio/synth/voiceId.ts`); `triggerSynthNoteOff` takes it; source+note is never an identity. | 563-568 | r/synth-voices | 0017 |
| R170 | Every voice carries `owner: VoiceOwner` (`live`/`arp`/`sequencer`/`preview`, `src/audio/voiceOwner.ts`), required with no default. | 569-570 | r/synth-voices | 0017 |
| R171 | `releaseSoundingVoices(source, releaseTime, owner)` releases one player's sounding voices, skipping releasing ones; `stopOwnedVoices(source, owner, …)` also reaches booked tails; two methods, never one with a flag. | 570-574 | r/synth-voices | 0017 |
| R172 | `stopSource` = whole bus; used for project install, loop load, vibe swap. | 574-576 | r/synth-voices | 0017 |
| R173 | Whole-bus reach requires a method whose name says so, never an omitted argument (same for `applySynthVelocityScale`'s required `source`). | 576-579 | r/synth-voices | 0017 |
| R174 | The owner is chosen by bridges in `src/audio/playback/`; no file in `src/components/` names one. | 579-581 | r/synth-voices | 0017 |
| R175 | Mono-bus decisions are taken on the held-note stack, never on `group.owner`. | 581-584 | r/synth-voices | 0017 |
| R176 | The engine takes a frequency (Hz), never a note name: `triggerSynthNoteOn(frequency, synth, velocity, time, source, scaleFactor, owner)`; `SynthVoiceNoteOn`, `ManagedVoice`, `SubtractiveVoiceEvent` carry `frequency` and no name. | 586-589 | both: r/synth-voices | 0018 |
| R177 | `noteFrequency` is called by the controller; `src/architecture/frequencyBoundary.test.ts` holds the literal allowlist of files (src + scripts) that may name it. | 589-593 | r/synth-voices | 0018 |
| R178 | The engine never regains a note name, not even for logging; names belong on the note-input bus (`emitNoteInput`). | 594-598 | r/synth-voices | 0018 |
| R179 | The engine may import only the timing half of `utils/musicTheory.ts` (`STEPS_PER_BAR`, `stepDurationSec`) — `ENGINE_MUSIC_DOMAIN_BAN` is an `allowImportNames` allowlist. | 598-602 | r/synth-voices, r/boundaries-and-gates | 0018 |
| R180 | The gate covers `src/audio/engine.ts`, `src/audio/synth/**`, `drumSynth.ts`, `masterRack.ts`; not `clock.ts` or `src/audio/playback/**`. | 603-605 | r/synth-voices | 0018 |
| R181 | Guarded files may not import `src/audio/playback/**`, not even type-only. | 605-608 | r/synth-voices | 0018 |
| R182 | `src/architecture/engineDomainPurity.test.ts` proves the block armed at `error`, aliased and relative. | 608-610 | r/synth-voices | 0018 |
| R183 | Polyphony scale = `applySynthVelocityScale(scale, source)` → `SynthVoiceManager.setPolyphonyScale` ramping a dedicated `polyGain` between tremolo gain and panner; never the amp envelope or `tremoloGain`. | 612-618 | r/synth-voices | 0019 |
| R184 | The count is the caller's (`useInputDeck` counts held notes per bus; arp/sequencer excluded); the manager skips releasing groups. | 618-621 | r/synth-voices, r/note-input | 0019 |
| R185 | Notes play at plain velocity; the rebalance runs after, one call covering all sounding voices. | 622-624 | r/synth-voices | 0019 |
| R186 | `ActiveSynth` (`src/types/synth.ts`) = `engine` tag + `patch {common, synth}` + `sourcePresetId`; `sourcePresetId` is never a DSP input. | 626-628 | r/synth-patch | 0020 |
| R187 | `SynthEngineId` has one member; no placeholder members. | 628-630 | r/synth-patch | 0020 |
| R188 | Adding an engine = params type in `EnginePatchMap` + a case wherever the tag is read; `common` is engine-independent. | 630-633 | r/synth-patch | 0020 |
| R189 | An unknown stored `engine` is never repaired: `sanitizeTrackSynth` returns the track default. | 633-635 | r/synth-patch | 0020 |
| R190 | `applySynthPreset(currentArp, preset)` returns `{activeSynth, arpSettings}` with a `structuredClone`d patch; never a `Partial` merge. | 637-641 | r/synth-patch | 0020 |
| R191 | Every `src/data/synthPresets.ts` entry states a whole `EnginePatch`. | 641-643 | r/synth-patch | 0020 |
| R192 | Output calibration lives in `common.outputGainDb`; no preset-id trim table. | 643-645 | r/synth-patch | 0020 |
| R193 | Never hand out the library preset object (clone is load-bearing). | 645-646 | r/synth-patch | 0020 |
| R194 | Arp settings live per track beside the `ActiveSynth` (`chordArpSettings` next to `chordSynthParams`, …), never inside the patch; `applySynthPreset` passes the current arp back. | 648-654 | r/synth-patch | 0020 |
| R195 | `ArpSettings` inlines its own literal unions; never reuse `src/types.ts` `ArpMode`/`ArpRate` (arp scheduler types); the two modules do not import each other. | 654-657 | r/synth-patch | 0020 |
| R196 | `FilterType` has one owner (`src/types/synth.ts`); `BeatFilterType` derives from it. | 657-659 | r/synth-patch | 0020 |
| R197 | Every patch field names its unit (dB `…Db`, seconds, Hz `…Hz`, `octave`/`semitone`, `…Cents`, unitless 0..1 for `resonance`, `keyTrack`, `stereoWidth`, `velocityToAmplitude`, LFO `depth`). | 661-665 | r/synth-patch | 0020 |
| R198 | Nothing stored is linear gain or `-Infinity`; `enabled: false` = silence; `SYNTH_GAIN_FLOOR_DB` clamps both conversion directions. | 665-668 | r/synth-patch | 0020 |
| R199 | `ModRoute` is discriminated by target and carries `unit`. | 668-671 | r/synth-patch | 0020 |
| R200 | `src/utils/synthPatch.ts` is the only place patch-level math lives; it does not import `utils/gainUnits.ts`. | 671-674 | r/synth-patch | 0020 |
| R201 | No wall-clock timer guards a voice's lifetime in `SynthVoiceManager`. | 676-679 | r/synth-voices | 0019 |
| R202 | Live keyboard backstop: `useInputDeck.ts` releases every held note on `window` blur and `visibilitychange`. | 681-683 | r/synth-voices, r/note-input | 0019 |
| R203 | Known narrowed gap: held chord preview (`playChordLegato`) — surfaces bind `onMouseLeave`/`onTouchEnd` beside `onMouseUp`; `playChordLegato` first stops its bus; the proper fix is a blur/`visibilitychange` backstop, never a manager timer. | 683-690 | r/synth-voices | 0019 |
| R204 | A new caller holding a `VoiceId` across an await, render or user event must add its own backstop. | 690-691 | r/synth-voices | 0019 |
| R205 | `maxVoicesPerSource` bounds count, not leaks; a droning voice means a bridge dropped its id. | 691-693 | r/synth-voices | 0019 |
| R206 | One synth implementation serves live and offline: `createSubtractiveVoice` takes any `BaseAudioContext`; `SynthVoiceManager` holds no module state. | 695-698 | r/synth-voices | 0021 |
| R207 | Every scheduled time is an argument; the voice module never reads `ctx.currentTime`; the manager's single read sits behind the realtime teardown timer. | 698-700 | r/synth-voices | 0021 |
| R208 | Realtime-only concerns narrow through `realtimeCtx()` and stay out of the offline path. | 700-702 | r/synth-voices, r/playback | 0021 |
| R209 | Never write a render-only copy of shared audio code. | 702-703 | r/synth-voices, r/playback | 0021 |

### Persistence, clock, playback, meters, storage (705-901)

| ID | Rule | Lines | Dest | ADR |
|---|---|---|---|---|
| R210 | Persisted values are replaced, never mutated in place (`createDedupedJsonStorage` compares by reference; `store.test.ts` pins). | 705-710 | both: r/persistence | 0022 |
| R211 | The `localStorage` write goes through `utils/coalescedStorage.ts` (idle callback, flush on `pagehide`/`visibilitychange`). | 710-712 | r/persistence | 0022 |
| R212 | Pointer-, clock- or animation-frame-driven code never writes persisted state directly. | 712-714 | both: r/persistence | 0022 |
| R213 | Tests/live reads call `flushPersistedWrites()` before asserting on `localStorage`. | 714-715 | r/persistence, r/testing (extend) | 0022 |
| R214 | No migration chains: `sanitizePersistedState` (`store.ts`) and `sanitizeContent` (`projectFile.ts`) validate every key on every read — invalid/missing/not-a-member → default; in-range passes untouched. | 717-732 | both: r/persistence | 0023 |
| R215 | `migrate` in `store.ts` stays identity + legacy-key adoption (zustand throws without it). | 721-723 | r/persistence | 0023 |
| R216 | `PERSIST_VERSION`/`PROJECT_FORMAT_VERSION` still stamped on every write; `parseProjectFile` refuses a newer `formatVersion`. | 723-726, 884-885 | r/persistence | 0023 |
| R217 | `sanitizeContent` is the only non-test caller of `sanitizeLoops` (loops live in IndexedDB). | 727-729 | r/persistence | 0023 |
| R218 | Precondition: no real users. If it lapses, reintroduce chains one `if (version < N)` guard per change, frozen once shipped, persist and project-body chains kept separate. | 732-742, 920-924 | r/persistence | 0023 |
| R219 | Never add a version-gated branch "just in case". | 742-745 | both: r/persistence | 0023 |
| R220 | The shared 16th clock runs iff a player holds a subscription (`subscribeClock` starts, `stopClockTimer` ends); nothing else starts or holds it. | 747-749 | both: r/playback | 0026 |
| R221 | The metronome is a click only: `setMetronomeEnabled` arms the click `clockTick` emits; it never starts the clock or blocks idle suspend; recording to a click = press play on the lead. | 749-754 | r/playback | 0026 |
| R222 | `src/store/engineSync.ts`: one `subscribeWithSelector` subscription per engine-settable value with `fireImmediately`, started once by `useEngineSync()` in `App.tsx`. | 756-758 | r/playback | 0026 |
| R223 | `AudioContext` is created on the first user click; `applyEngineSnapshot()` then re-applies persisted audio state. | 758-759 | r/playback | 0026 |
| R224 | Never call engine setters from a component; add state to a slice and wire it in `engineSync.ts`. | 759-760 | C | 0026 |
| R225 | Direct `audioEngine` calls from `src/store/` are only for cuts, previews and lifecycle, each with a docblock reason; the list (`loadLoop`, `vibes`, `projectSlice`, `synthPatchPreview`, `effectsPreview`, `beatPreview`, `synthPresetInstall`, `audioRecovery`, `incidentReporter`, `sourceBuses`) is a snapshot — re-derive with `grep -ln audioEngine src/store/*.ts`. | 760-769 | r/playback | 0026 |
| R226 | A persistent value (incl. a MIDI CC patch edit) reaches the engine only via its `engineSync` subscription. | 766-767 | r/playback | 0026 |
| R227 | Planners in `src/audio/playback/plan/` (`padPlan.ts`, `chordPlan.ts`, `melodyPlan.ts`) are pure: no store, no engine setter, no `AudioContext`, no wall clock, no timer (ESLint block on the folder). | 771-777 | r/playback | 0027 |
| R228 | `src/architecture/playbackPlannerPurity.test.ts` asserts the block's severity. | 777-779 | r/playback | 0027 |
| R229 | A planner must not call `chordPlayback`'s engine-touching exports (`playFullHoldChord`, `emitStepEvents`, `scheduleWholeChord`) — convention, not gated. | 779-784 | r/playback | 0027 |
| R230 | Clock subscription, arming state, full-hold strikes, note-ons belong to controllers (`useChordPlayback.ts`, `useLeadPlayback.ts`, `renderMixdown.ts`). | 784-786 | r/playback | 0027 |
| R231 | Four per-lane snapshot types (arm-time immutable) + per-step context (emit-time live); never unify into one `PlaybackSnapshot`. | 788-798 | r/playback | 0027 |
| R232 | Chord/bass fix cycle, notes and arp ACTIVE flag at arm; read synth patches and Arp settings live per step; `chordFeel`/`bassFeel` read at both (arm → `cycleHoldScale`, emit → `feelToHoldScale`); pad arm-only; melody emit-only. | 788-796 | r/playback | 0027 |
| R233 | `src/store/playbackPlanSnapshots.ts` takes `AppStore` as an argument; never calls `useAppStore.getState()`. | 800-802 | r/playback | 0027 |
| R234 | A new lane field goes in both snapshot builders (`playbackPlanSnapshots.ts`, `renderMixdown.ts`) or neither. | 806-807 | r/playback | 0027 |
| R235 | Every `plan<Lane>*` function's 2nd parameter is a single context object, never positional scalars. | 809-813 | r/playback | 0027 |
| R236 | Planner output: inline anonymous type if read only where returned; named + exported if it crosses a call boundary; export a type only when a second file needs its name. | 815-823 | r/playback | 0027 |
| R237 | `planChordStep`'s arp branch uses `feelToHoldScale`, not `cycleHoldScale`. | 823-826 | r/playback | 0027 |
| R238 | Meters compute peak + windowed RMS in dBFS from `getFloatTimeDomainData`; never `getByteFrequencyData`. | 831-838 | r/metering | 0028 |
| R239 | Master analysers are observe-only sends off `masterGain`, post-fader, ahead of compressor and limiter. | 838-840 | r/metering | 0028 |
| R240 | Compressor defaults off; limiter defaults on at -3 dB; source-bus default -6 dB keeps `over` reachable. | 840-842 | r/metering | 0028 |
| R241 | Every meter ticks through `utils/meterScheduler.ts` (one rAF loop, tiers, per-element `IntersectionObserver` visibility gate). | 842-846 | r/metering | 0028 |
| R242 | No meter value enters a zustand slice. | 846-847 | both: r/metering | 0028 |
| R243 | Meter constants (`-24`/`-6`/`-1` zones, `0/5/30/100` scale, 14 dB/s decay, −60 dBFS floor) are the murva interop contract in `docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`; never re-derive. | 847-850 | r/metering | 0028 |
| R244 | Storage access is guarded: `localStorage` can throw; `store.ts` falls back to in-memory `StateStorage`; helpers take an injectable storage param read inside a `try`, never in a default-parameter expression (`Header.tsx` theme functions). | 852-855 | both: r/persistence | 0022 |
| R245 | Four storage zones: `localStorage` = live session; `sessionStorage` = nothing; IndexedDB = the one project slot, only via `store/projectStore.ts`; Google Drive = optional remote, absent when `VITE_GOOGLE_CLIENT_ID` unset. | 857-860 | r/persistence | 0024 |
| R246 | `projectStore` resolves availability once, lazily; every failure is a typed result; a storage-less device is a rendered degraded state, never an exception path. | 860-863 | r/persistence | 0024 |
| R247 | IndexedDB: one object store `project`, one fixed slot key (`projectStoreIdb.ts`). | 864-866 | r/persistence | 0024 |
| R248 | Slot value is `{ body, source }` (`ProjectSlotRecord`, `store/projectSource.ts`); `source` is held beside the body and never reaches `serializeProject` / the `.solna` body. | 866-871 | r/persistence | 0024 |
| R249 | `projectSource` is not a localStorage persist key (absent from `partializeAppState`, `PROJECT_CONTENT_KEYS`); it lives in the IDB slot record. | 871-874 | r/persistence | 0024 |
| R250 | `sanitizeSlotRecord` reads a pre-source slot as `{ body, source: untitled }`, no version gate. | 875-877 | r/persistence | 0024 |
| R251 | A project body is the `PROJECT_CONTENT_KEYS` content set only (no view/session/library state). | 877-879 | r/persistence | 0024 |
| R252 | `.solna` `formatVersion` is independent of the persist `version`; never read one payload shape as the other; the two never collapse. | 879-885 | r/persistence | 0024 |
| R253 | `customSynthPresets`, `customChordProgressions`, `customBeatPresets` are capped at write time, evicting oldest first; never a read-time repair. | 885-889 | r/persistence | 0024 |
| R254 | No dirty tracking; `src/store/projectAutosave.ts` holds one `subscribeWithSelector` subscription over `PROJECT_CONTENT_KEYS` + `projectName` with `equalityFn: shallow`. | 891-896 | r/persistence | 0024 |
| R255 | A pending autosave is scheduled once per idle window (`idleWriteScheduler`) and flushed on `pagehide`/`visibilitychange`. | 896-898 | r/persistence | 0024 |
| R256 | Autosave starts disarmed; `store.ts` arms it in a `finally` after `loadProject()` resolves. | 898-901 | r/persistence | 0024 |

### Testing, traps, git, index (903-946)

| ID | Rule | Lines | Dest | ADR |
|---|---|---|---|---|
| R257 | `renderToString` trap: `useAppStore.setState(...)` before a render has no effect unless the component reads the store like `ui/BottomInputDock.tsx` (already in r/testing — verify, don't duplicate). | 905-908 | both: r/testing | — |
| R258 | Tap Tempo and stereo VU are unbuilt, not broken (`docs/design.md` §4 item 3). | 912 | C | — |
| R259 | `asLeadNoteMatrix` (`sanitize.ts`) returns `undefined` for the pre-DEV-369 `string[][]` shape → blank payload, no throw/warning; do not "fix". | 913-917 | r/persistence, r/melody-tracks | 0023 |
| R260 | A stale-but-valid `LeadNote[][]` (pre-tick-resolution) passes through unchanged at its written tick density. | 917-920 | r/persistence | 0023 |
| R261 | Branch names `<type>/<issue-code>-<name>` (type ∈ `feat`/`fix`/`refactor`/`docs`/`chore`; issue code lowercased, omitted if none; kebab-case name). | 928-931 | C | — |
| R262 | Feature work never lands as a commit directly on `main`. | 931-932 | C | — |
| R263 | Index: repo skills (`dsp-audio`, `music-theory`, `instant-vibes`), rules files, global `squash-by-logical-change`. | 936-946 | C | — |

Total: 263 rules.

### Rationale coverage (every paragraph → ADR)

| Lines | Content | ADR |
|---|---|---|
| 1-7 | header, doc policy | — (stays C) |
| 9-29 | commands | — (stays C) |
| 31-43 | verify / eslint / knip / D5 | 0029 |
| 43-53 | contrast gate | 0030 |
| 57-69 | mounted views, high-freq state | 0001 |
| 71-89, 94-99, 113-127 | four layers, analyser exemption | 0002 (113-127 analyser part also 0028) |
| 90-93 | render-engine door | 0021 |
| 100-107 | persist no-migration (dup of 717-745) | 0023 |
| 107-112 | Drive token | 0025 |
| 129-161, 279-293 | Music Core, tonal confinement, pitch parsing | 0005 |
| 162-167 | `src/architecture/` | 0002 |
| 169-173 | incidents | 0003 |
| 175-189 | utils placement, store inversion | 0004 |
| 191-212 | derived qualities, spelling | 0006 |
| 214-234 | chord notes derived | 0007 |
| 236-277 | reharmonization, Roman numerals | 0008 |
| 295-329, 388-397 | vibes, drum grids, dice | 0009 |
| 331-368 | Beat instrument | 0010 |
| 370-386 | check:drums | 0011 |
| 399-447 | step storage, layouts, span editors, custom patterns, publisher | 0012 |
| 449-484, 503-515 | FX twin, rec arm, key change, borrowed rows | 0013 |
| 486-501 | loop delete + undo | 0014 |
| 517-547 | solo | 0015 |
| 549-561 | focus-routed input | 0016 |
| 563-584 | voice identity/ownership | 0017 |
| 586-610 | frequency boundary | 0018 |
| 612-624, 676-693 | polyphony gain, voice lifetime | 0019 |
| 626-674 | synth patch model | 0020 |
| 695-703 | shared live/offline synth | 0021 |
| 705-715, 852-855 | persist write path, guarded storage | 0022 |
| 717-745, 913-924 | validation instead of migration, lead-melody trap | 0023 |
| 857-901 | storage zones, slot, autosave | 0024 |
| 747-769 | clock, engine bridge | 0026 |
| 771-829 | playback planning | 0027 |
| 831-850 | metering | 0028 |
| 903-908 | testing trap | — (r/testing) |
| 910-912 | Tap Tempo/VU | — (C) |
| 926-946 | git, index | — (C) |

## 2. File layout

### 2.1 New rules files (`.claude/rules/`)

Match counts from `git ls-files -- ':(glob)<g>'` at `02cf1a9b` (tests included).

| File | `paths:` globs (count) | Rules |
|---|---|---|
| `data-layer.md` | `src/data/**` (16) | R020-R027, R052, R058 |
| `music-domain.md` | `src/musicCore/**` (9), `src/utils/musicTheory.ts`, `src/utils/noteSpelling.ts`, `src/data/scales.ts`, `src/data/chordProgressions.ts`, `src/store/chordsSlice.ts`, `src/store/sanitize.ts`, `src/audio/leadStepRecord.ts`, `src/audio/bassPatterns.ts`, `src/audio/arpeggiator.ts`, `src/audio/playback/padPlayback.ts`, `src/components/loop/lead/melodyGrid.ts`, `src/components/ui/Keyboard.tsx`, `src/components/loop/chord/**` (24) | R044, R046-R051, R061-R085 |
| `vibes-and-grids.md` | `src/data/vibes.ts`, `src/data/drumGrids.ts`, `src/audio/drumGrids.ts`, `src/store/vibe*.ts` (9), `src/components/InstantVibesBar.tsx`, `src/components/vibeActions.ts` | R086-R096, R117-R119 |
| `beat.md` | `src/store/beatSlice.ts`, `src/store/beatPresets.ts`, `src/store/beatPreview.ts`, `src/store/sanitizeBeat.ts`, `src/data/beatPresets.ts`, `src/data/trimTable.ts`, `src/audio/beatAdapter.ts`, `src/audio/beatSteps.ts`, `src/audio/drumSynth.ts`, `src/components/loop/beat/**` (12), `src/components/ui/DrumPadGrid.tsx`, `src/components/drumPadVelocity.ts`, `scripts/check-drum-kit-separation.ts`, `scripts/check-levels.ts`, `scripts/calibration/**` (22) | R088, R097-R116, R161, R162 |
| `pattern-grids.md` | `src/utils/stepResolution.ts`, `src/utils/customPattern.ts`, `src/utils/patternTimeline.ts`, `src/utils/patternAdapt.ts`, `src/audio/leadMelody.ts`, `src/store/bassSlice.ts`, `src/store/chordsSlice.ts`, `src/components/ui/StepRow.tsx`, `src/components/ui/spanResize.ts`, `src/components/ui/useSpanResize.ts`, `src/components/playbackStep.ts`, `src/components/loop/chord/**`, `src/components/loop/lead/**` (19), `src/components/loop/sequencer/**` (3) | R120-R131 |
| `melody-tracks.md` | `src/store/melodyTracks.ts`, `src/store/leadSlice.ts`, `src/store/fxSlice.ts`, `src/store/leadRecord.ts`, `src/store/musicContextSlice.ts`, `src/store/loopCopy*.ts` (4), `src/audio/leadMelody.ts`, `src/components/loop/lead/**` | R132-R148, R259 |
| `loops-and-solo.md` | `src/store/loopSlice.ts`, `src/store/loadLoop.ts`, `src/store/projectSlice.ts`, `src/store/soloNav.ts`, `src/store/trackAudibility.ts`, `src/store/engineSync.ts`, `src/components/song/**` (17), `src/components/ui/Solo*.tsx` (3) | R149-R161 |
| `synth-voices.md` | `src/audio/engine.ts`, `src/audio/synth/**` (15), `src/audio/drumSynth.ts`, `src/audio/masterRack.ts`, `src/audio/voiceOwner.ts`, `src/audio/playback/**` (25), `src/audio/export/**` (7), `src/components/useInputDeck.ts` | R031, R142, R169-R185, R201-R209 |
| `synth-patch.md` | `src/types/synth.ts`, `src/utils/synthPatch.ts`, `src/utils/synthPresets.ts`, `src/data/synthPresets.ts`, `src/store/synthSlice.ts`, `src/store/sanitizeSynth.ts`, `src/store/synthPresetInstall.ts`, `src/store/synthPatchPreview.ts`, `src/components/loop/synth/**` (17) | R186-R200 |
| `persistence.md` | `src/store/store.ts`, `src/store/migrate.ts`, `src/store/persistStorage.ts`, `src/store/sanitize*.ts` (6), `src/store/project*.ts` (15), `src/store/presetsSlice.ts`, `src/store/drive*.ts` (8), `src/utils/coalescedStorage.ts`, `src/utils/storage.ts`, `src/utils/idbPromise.ts`, `src/utils/localFileSave.ts`, `src/utils/driveBrowser.ts`, `src/utils/projectFileIO.ts`, `src/components/Header.tsx`, `src/components/project/**` (6) | R033-R037, R072, R210-R219, R244-R256, R259, R260 |
| `playback.md` | `src/audio/clock.ts`, `src/audio/engine.ts`, `src/audio/playback/**`, `src/audio/export/**`, `src/store/engineSync.ts`, `src/store/playbackPlanSnapshots.ts`, `src/store/mixdownSlice.ts`, `src/store/loadLoop.ts`, `src/store/songMode.ts`, `src/components/**/use*Playback.ts` (3), `src/components/usePlayheadSync.ts`, `src/components/playbackStep.ts`, `src/components/playheadBeat.ts`, `src/App.tsx` | R017, R030, R031, R039, R130, R131, R208, R209, R220-R237 |
| `metering.md` | `src/utils/meter*.ts` (14), `src/utils/gainUnits.ts`, `src/utils/gainReduction.ts`, `src/components/AudioVisualizer.tsx`, `src/components/visualizerDraw.ts`, `src/components/ui/*Meter*.tsx` (8), `src/components/ui/useMeterLevel.ts`, `src/audio/masterRack.ts` | R041-R043, R238-R243 |
| `boundaries-and-gates.md` | `eslint.config.js`, `knip.json`, `src/architecture/**` (7), `src/incidents/**`, `src/utils/localFileSave.ts`, `src/utils/driveBrowser.ts` | R005, R007-R010, R041, R043, R045, R053-R057, R060, R085, R179 |

### 2.2 Existing rules files — extensions only

| File | Change | Rules |
|---|---|---|
| `theming.md` | add glob `scripts/check-contrast.ts`; add contrast-gate section (line 28 already mentions it — extend, don't duplicate) | R011-R013 |
| `note-input.md` | add a "Focus routing" section under `## Rules` | R018, R163-R168, R184, R202 |
| `testing.md` | confirm the renderToString trap (lines 25+) covers R257; add R213 | R213, R257 |

### 2.3 ADRs (`docs/decisions/`)

Also create `docs/decisions/README.md` (index + template). Slugs are final.

| ID | File | Title | Source lines |
|---|---|---|---|
| 0001 | `0001-always-mounted-views.md` | Every view stays mounted; high-frequency state stays local | 57-69, 117-118 |
| 0002 | `0002-four-layer-import-architecture.md` | Four import layers enforced by ESLint | 71-89, 94-99, 113-127, 162-167 |
| 0003 | `0003-incidents-privacy-boundary.md` | `src/incidents/` is a privacy boundary | 169-173 |
| 0004 | `0004-utils-placement-and-store-constant-inversion.md` | `src/utils/` placement and the MIME-constant inversion | 175-189 |
| 0005 | `0005-music-core-and-tonal-confinement.md` | Music Core owns music theory; Tonal confined to one file | 129-161, 279-293 |
| 0006 | `0006-derived-degree-qualities-and-display-spelling.md` | Degree qualities are derived; spelling is display-only | 191-212 |
| 0007 | `0007-chord-notes-derived-not-stored.md` | A chord's notes are derived on read | 214-234 |
| 0008 | `0008-reharmonization-category-and-roman-numerals.md` | Reharmonization by registry category; Roman numeral accidentals | 236-277 |
| 0009 | `0009-vibes-as-data-and-single-drum-grid-library.md` | Vibes are pure data over one drum-grid library | 295-329, 388-397 |
| 0010 | `0010-beat-instrument-three-fields.md` | Beat is a per-loop instrument of three complete fields | 331-368 |
| 0011 | `0011-check-drums-non-vacuous.md` | `check:drums` asks two questions and cannot pass vacuously | 370-386 |
| 0012 | `0012-pattern-storage-and-step-layouts.md` | Fixed-width storage, three step layouts, span mechanics | 399-447 |
| 0013 | `0013-melody-tracks-table-and-record-arm.md` | FX as Lead's twin via `MELODY_TRACKS`; one armed track; borrowed rows | 449-484, 503-515 |
| 0014 | `0014-atomic-loop-delete-with-undo.md` | Loop delete is atomic, seamless and undoable | 486-501 |
| 0015 | `0015-session-only-track-solo.md` | Track solo is a session-only monitoring set | 517-547 |
| 0016 | `0016-focus-routed-note-input.md` | Input plays the focused track | 549-561 |
| 0017 | `0017-voice-identity-and-ownership.md` | Note-on returns `VoiceId`; every voice has an owner | 563-584 |
| 0018 | `0018-engine-frequency-boundary.md` | The engine takes Hz, never a note name | 586-610 |
| 0019 | `0019-polyphony-gain-and-voice-lifetime.md` | Dedicated polyphony gain; no lifetime timer | 612-624, 676-693 |
| 0020 | `0020-synth-patch-model.md` | Engine-tagged complete patches, arp beside, units in names | 626-674 |
| 0021 | `0021-shared-live-and-offline-render.md` | One synth implementation for speakers and mixdown | 90-93, 695-703 |
| 0022 | `0022-persist-write-path-and-guarded-storage.md` | Deduped, coalesced persist writes; guarded storage | 705-715, 852-855 |
| 0023 | `0023-validation-instead-of-migration.md` | Validation replaced migration chains (with precondition) | 98-107, 717-745, 913-924 |
| 0024 | `0024-storage-zones-project-slot-autosave.md` | Four storage zones, one project slot, autosave | 857-901 |
| 0025 | `0025-drive-token-in-closure.md` | The Google token lives only in a closure | 107-112 |
| 0026 | `0026-clock-and-engine-bridge.md` | Clock runs iff a player subscribes; store→engine bridge | 747-769 |
| 0027 | `0027-planned-then-performed-playback.md` | Pure planners, four snapshots, context objects | 771-829 |
| 0028 | `0028-sample-based-metering.md` | Meters read samples before the dynamics | 113-127 (analyser exemption), 831-850 |
| 0029 | `0029-verify-gate-and-lint-severity.md` | `verify` gate, Knip baselines, D5 severity policy | 31-43 |
| 0030 | `0030-palette-contrast-gate.md` | Palette contrast is a non-vacuous gate | 43-53 |

## 3. CLAUDE.md outline (target ≤ 15k chars; projected ~13k)

| # | Heading | Content | Rules | ~chars |
|---|---|---|---|---|
| 1 | `# CLAUDE.md` + doc policy | one para; add "rules → `.claude/rules/`, why → `docs/decisions/`" | R001 | 600 |
| 2 | `## Commands` | table verbatim | R002, R003 | 1,300 |
| 3 | `## Completion gate` | verify, eslint 0 errors, Knip 0 findings; link ADR-0029, r/boundaries-and-gates | R004-R006 | 500 |
| 4 | `## Architecture` → `### Everything stays mounted` | 3-4 lines | R014-R016, R040 | 800 |
| 5 | `### Layer map` | table: layer → one-line rule → rules file → ADR (data, audio, store, components, musicCore, utils, incidents) | R019, R020, R028, R029, R032, R038, R044, R050, R056, R058, R059 | 2,000 |
| 6 | `### Cross-cutting invariants` | one line + link each | R016 (meters: R242), R035/R214, R219, R064, R176, R210, R212, R220, R224, R160, R244, R051 | 2,600 |
| 7 | `## Traps — don't "fix" these` | bullets | R257 (one line → r/testing), R258, R259 (one line → r/persistence) | 600 |
| 8 | `## Git conventions` | verbatim | R261, R262 | 600 |
| 9 | `## Skills, rules and decisions` | skills list (3 repo + global); rules table (file → covers); ADR index link to `docs/decisions/README.md` (not a 30-row list) | R263 | 2,400 |

## 4. Inbound references to CLAUDE.md

`grep -rn "CLAUDE.md" src scripts .claude docs/architecture` at `02cf1a9b`.

### 4.1 Source/scripts comments — repoint

| File:line | Points at | New target | Note |
|---|---|---|---|
| `src/utils/stepResolution.ts:94` | "three-layer rule" | ADR-0002 / r/boundaries-and-gates | stale wording: four layers |
| `src/audio/leadMelody.ts:38` | "three-layer rule" | ADR-0002 | stale wording |
| `src/utils/meterScheduler.ts:101` | meter reads samples | ADR-0028 (R238) | |
| `src/components/playheadBeat.ts:6` | every view stays mounted | ADR-0001 (R014) | |
| `src/components/playbackStep.ts:210` | Pattern segments mounted | ADR-0001 | |
| `src/components/ui/useSpanResize.ts:39` | commit once on pointerup | ADR-0012 (R125) | |
| `src/components/loop/useSoundDepth.ts:83` | no migration chains | ADR-0023 | |
| `src/architecture/schedulingFocusIndependence.test.ts:16` | Architecture section | ADR-0001 / ADR-0016 | |
| `src/components/loop/lead/useLeadMarker.ts:9` | "Pattern's own four segments" | ADR-0001 | quote no longer verbatim after move |
| `src/audio/masterRack.ts:832` | "delayTime is GONE…" | **no such section exists today** | stale; writer: delete the pointer or find the true source (git log) |
| `src/audio/synth/modulation.ts:273` | whole-bus-release defect | ADR-0017 (R173) | |
| `src/audio/synth/voiceId.ts:8` | "recorded in CLAUDE.md at `activeVoices`" | ADR-0017 | stale: `activeVoices` appears nowhere in CLAUDE.md |
| `src/audio/synth/voiceManager.ts:24` | known deferred defect | ADR-0019 (R203) | |
| `src/store/store.test.ts:866` | no migration chains | ADR-0023 | |
| `src/store/songMode.ts:267` | clock runs iff player subscribes | ADR-0026 (R220) | |
| `src/store/projectStore.test.ts:151` | no migration chains | ADR-0023 | |
| `src/store/projectFile.ts:203` | "IndexedDB the saved…" | ADR-0024 | check wording still matches R245 |
| `src/store/beatLegacyBoundary.test.ts:27` | legacy names also in CLAUDE.md, unscanned | r/beat + ADR-0010 | legacy names will now appear in `.claude/rules/beat.md` and `docs/decisions/0010-…`; confirm the scan (readdir at line ~58) stays under `src/` so they don't fail the literal allowlist |
| `src/store/projectSource.ts:33` | `releaseSoundingVoices` scar | ADR-0017 (R173) | |
| `src/store/projectSource.ts:117` | no migration chains | ADR-0023 | |
| `src/store/beatSlice.ts:28` | every view stays mounted | ADR-0001 | |
| `src/store/presetsSlice.ts:12` | no migration chains | ADR-0023 | |
| `src/store/store.ts:47` | no real users yet | ADR-0023 (R218) | |
| `scripts/calibration/renderOffline.smoke.ts:106` | `spread()` factor floor | ADR-0011 (R116) | |

### 4.2 Skills

| File:line | Points at | New target |
|---|---|---|
| `.claude/skills/music-theory/SKILL.md:88` | reharmonization category | ADR-0008 / r/music-domain (R073) |
| `.claude/skills/dsp-audio/SKILL.md:257` | "no migration chains" precondition | ADR-0023 (R218) |
| `.claude/skills/dsp-audio/SKILL.md:355` | what `verify` runs | CLAUDE.md §Completion gate (stays) |

### 4.3 docs/architecture

`docs/architecture/structure/*.md` hits (01-ui, 02-store, 03-audio, 04-domain, README) are dated audit records quoting CLAUDE.md as it was — leave unchanged. Repoint only `docs/architecture/feature-overview.md:4` ("CLAUDE.md is authoritative") → "CLAUDE.md, `.claude/rules/` and `docs/decisions/` are authoritative".

## 5. Conflicts / stale (listed, not investigated)

- C1. Line 88 says `tonal` "is used for theory only" in `src/audio/`; lines 129-130 confine `tonal` to `src/musicCore/tonalAdapter.ts`. Drop the line-88 clause. Same drift in `.claude/skills/music-theory/SKILL.md:12-14` ("use `tonal`") and `dsp-audio/SKILL.md:8`; skills should say "use Music Core".
- C2. Lines 31-33 say only `exhaustive-deps` warnings print; lines 41-43 say both `exhaustive-deps` and `complexity` stay `warn` and every remaining site carries a line disable (so none should print). Decide which; R005/R010 wording depends on it.
- C3. Line 936 "ships two skills"; `.claude/skills/` has three (`instant-vibes` missing).
- C4. Lines 100-107 duplicate 717-723 (`migrate` identity); lines 123-125 duplicate 159-161 (analyser block). Single source after move.
- C5. Line 910 heading "Traps recorded in the spec" names no spec.
- C6. Line 680 "all four sequencer bridges" — not cross-checked.
- C7. Stale code pointers: `masterRack.ts:832` ("delayTime is GONE"), `voiceId.ts:8` ("at `activeVoices`"), `stepResolution.ts:94` and `leadMelody.ts:38` ("three-layer rule").
- C8. Line 113-115 lists `useInputDeck` and `usePlayheadSync` as "playback controllers"; `docs/architecture/structure/01-ui.md:421-423` already flags the label as inaccurate.
- C9. Line 125-127 "add to both" presumes a doc copy of the analyser allowlist; after the move that copy is `r/metering` (R043) — keep exactly one doc copy.

## 6. Verification for the executor

1. Every `R###` in §1 appears in exactly the destination(s) listed (grep `R[0-9]{3}` across `CLAUDE.md`, `.claude/rules/`, `docs/decisions/`).
2. Every ADR's "Rules this implies" lists exactly the rows whose ADR column names it.
3. `wc -c CLAUDE.md` ≤ 15,000.
4. Every `paths:` glob matches ≥ 1 file (`git ls-files -- ':(glob)…'`).
5. `bun run verify` passes (`beatLegacyBoundary.test.ts`, `frequencyBoundary.test.ts` must not pick up the new markdown).

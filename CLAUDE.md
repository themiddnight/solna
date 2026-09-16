# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Do not record version numbers here.** Dependency versions, the persist `version`, file
counts and line numbers all change through routine work and go stale silently. Read
`package.json` / the source instead, and write down the *rule*, not the number.

## Commands

Runtime is **Bun** (test runner + scripts); the app itself is Vite + React.

```bash
bun run dev            # Vite dev server on 0.0.0.0:3000
bun run build          # production build
bun run lint           # tsc --noEmit (type-check only)
bun run eslint         # eslint . (import-layering rules live here)
bun test               # all tests
bun test src/audio/engine.test.ts          # one file
bun test -t "reverb decay"                 # one test by name
bun run check:theme    # theme-token guard suite only
bun run check:keys     # drum-pad vs synth key-binding collision check
bun run check:drums    # Beat-preset audible-separation check
bun run check:contrast # Beat-voice and module palette AA contrast floor (both themes)
bun run check:levels   # calibration trim table still matches today's Beat-preset defaults
bun run check:dead-code             # unused files, exports, types and dependencies across app + tooling
bun run check:dead-code:production  # strict shipped-code file and dependency graph
bun run verify         # all tests, static/domain checks, both dead-code scans, and the production build
```

`bun run verify` is the completion gate — run it before claiming work is done. It runs
`bun run eslint`, which currently reports **nothing at all** — no errors and no warnings — and
both Knip scans, which likewise have a zero-finding baseline. The default Knip graph includes
tests and manually invoked tooling; the production graph excludes tests and narrowly named
test-support fixtures, so code kept alive only by tests still appears as an unused production
file while intentional test infrastructure does not. Per decision D5 a new rule lands as `warn` and flips to
`error` in the change that empties it, which is why the `React.FC` ban, the `../../` ban and
`consistent-type-definitions` are now errors (see the ESLint rule matrix in
`docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md`).
`react-hooks/exhaustive-deps` and `complexity` stay at `warn` deliberately: both have
legitimate exceptions, so each remaining one carries a line disable naming its reason rather
than a rule relaxed for everybody. `check:contrast`
holds **both** namespaced palettes — `--drum-*` and `--module-*` — above the AA floor in both
themes; the closest pair sits a few thousandths above 4.5, so that step is a gate a palette can
fail, not a report of what the palettes are. The two rosters are named differently on purpose:
Beat voices come from `BEAT_VOICE_IDS` (a voice exists in code whether or not it has a colour;
the CSS tokens are still named `--drum-*`, and the ids are the same strings), while
module names are read out of `index.css` itself, since the only module list is `Knob`'s
`KnobColor` union and a CLI gate should not import a React component to learn a list of colours.
What stops the CSS-derived half passing vacuously is that the script asserts both themes declare
the *same* module set and that the set is non-empty — a module colour added to one theme only
fails rather than being skipped.

## Architecture

Single-page audio workstation ("Solna"): two layers (Loop, Song) holding four tab views between
them — Sound and Pattern on the loop layer, Arrange and Master on the song layer — plus Pattern's
own four segments (Lead, FX, Accompaniment, Beat). **Every one of them stays mounted
simultaneously**, gated `block`/`hidden` at three levels: `App.tsx` on the layer
(`isSongLayer(activeTab)`), `LoopPage.tsx` on `activeTab`, `PatternView.tsx` on
`segmentForFocus(focusTrack)`.
Audio therefore never stops when switching tabs. **Consequence:** state that lives in a store slice or high in the tree
re-renders *every* mounted view, not just the visible one. High-frequency state — the current
playback step, a value being dragged on a knob — must therefore stay local to the subtree that
shows it, never in a slice.

**Four layers, enforced by eslint (`no-restricted-imports`, plus `no-restricted-globals` and
`no-restricted-syntax` for the first):**

1. `src/data/` — **imports nothing at runtime, not even a sibling in `src/data/`.** Factory
   content only: synth presets, Beat presets, drum grids, chord progressions,
   chord rhythms, bass patterns, effect chains, scales. It reads no impure global (`Math`,
   `Date`, `crypto`, …),
   declares no function, constructs no object with `new`, and holds no module-scope `let`/`var`;
   it may declare types and `import type` from anywhere. Top-level `const` arrow helpers that are
   shorthand for writing a literal — `step()`, `block()`, `strum()` — are allowed and must sit in
   the same file as the table they build. **Every file is an independent leaf**, so the folder has
   no evaluation graph and a reviewer with one file open has all of its inputs on screen.
   `src/data/dataLayerPurity.test.ts` lints fixture sources through eslint's own API and is what
   keeps that true across tool upgrades. The distinguishing test for what belongs: **adding an
   entry must be an edit to that table and nothing else** — which is why `METERS`, `THEME_TOKENS`
   and `VIEW_META` are registries and stay where the code that reads them lives.
2. `src/audio/` — never imports `store/` or `components/`; may import `data/`. Pure DSP + a
   single `audioEngine` singleton built on the **raw Web Audio API** (no Tone.js; `tonal` is used
   for theory only). All engine setters no-op until `init()` creates the `AudioContext`.
   **One door on that singleton is deliberately open: `createRenderEngine(ctx)` returns a
   throwaway engine bound to a caller-supplied context, which is how the offline mixdown render
   (`src/audio/export/renderMixdown.ts`) works — it never touches `audioEngine`, and the snapshot
   it renders is assembled by `store/mixdownSlice.ts`, because `src/audio/` may not read the store.**
3. `src/store/` — never imports `components/`. One Zustand store composed from slices
   (`transport`, `musicContext`, `synth`, `chords`, `bass`, `beat`, `effects`, `ui`,
   `presets`, `loop`, `lead`, `project`), with `persist` (key `musibox_project_state_v1`, `partialize` +
   `migrate` in `store.ts`, legacy-key adoption in `migrate.ts`) and `subscribeWithSelector`.
   There is no per-version migration step to add any more — `PERSIST_VERSION` is stamped on
   every write but, since DEV-388, drives no read-time transform (`migrate` in `store.ts` is
   identity except for the legacy localStorage-key adoption it still calls, kept only because
   zustand's `persist` throws without a `migrate` function at all). A
   persisted shape change is handled by validating the new key in `merge`'s
   `sanitizePersistedState`, not by bumping the version. See the "no migration
   chains" note further down for why, and for the precondition under which that stops being
   true. **`store/driveAuth.ts` holds the only Google access token, in a closure** — no getter
   hands it out, and **no slice may read it**: `driveSignedIn` in the drive slice is a
   *mirror* of "an unexpired token is held", not the token, and every Drive call acquires one
   through `withDriveToken` at the moment it needs it. A token in a slice would be a token in
   `partialize` the first time someone added it to the list, and a token in the store is a
   token in the devtools panel.
4. `src/components/` — dumb views; must not import `audio/engine`. Only `AudioVisualizer.tsx`,
   `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`, `ui/GainReductionMeter.tsx` and `ui/SourceMeter.tsx`
   (read-only analyser consumers) and test files are exempt — routing their per-frame analyser
   reads through the store would mean a store write on every animation frame and a re-render of
   every subscriber. **`eslint.config.js` is the list that binds**; this one has drifted behind it
   before, so add to both or the allowlist quietly grows without anyone reading it.

**A fifth axis sits on top of the four layers: Tonal.js is confined to one file.** `tonal` may be
imported only from `src/musicCore/tonalAdapter.ts` (DEV-394), enforced with the same
replace-not-merge `no-restricted-imports` pattern as the four layers above (see
`TAPER_CONVERSION_BAN` and its carve-outs for the mechanism this reuses). Every other file that
needs pitch, interval or chord-quality operations imports Music Core's public API
(`src/musicCore/index.ts`) instead — including the six files that carried a temporary,
file-named allowlist under DEV-395 (`src/utils/noteSpelling.ts`, `src/utils/musicTheory.ts`,
`src/audio/arpeggiator.ts`, `src/audio/bassPatterns.ts`, `src/audio/playback/padPlayback.ts`,
`src/store/midiInput.ts`); none of them import `tonal` directly any more, and each keeps its own
pre-existing public exports unchanged. `src/musicCore/chordQuality.ts` also owns the one canonical
chord-quality registry — app token, Tonal alias, display suffix, picker label/group and
reharmonization category — that `ChordItem['quality']`'s TypeScript type, the chord picker's
options, `formatChordQuality`/`formatChordLabel` and chord-note resolution (`resolveChordNotes`)
all derive from; a quality absent from the registry is a compile error anywhere it is written as a
literal, and a runtime string that names no registered quality is a thrown error at
`resolveChordNotes`, never a silent `maj` chord. `src/musicCore/**` is itself ESLint-enforced to
import nothing from `src/store/`, `src/components/`, `src/audio/`, or `src/utils/` — the
dependency runs audio → Music Core and utils → Music Core, never the reverse (`src/utils/`
already imports `@/musicCore`; see the `src/utils/` paragraph below). A **musical intent** (a persisted, user-authored
decision — a chord's root/quality, a key, a note's pitch and timing) is not the same thing as a
**derived representation** (a value a pure function computes from musical intent, such as a
resolved chord quality or a display-spelled label) or a **playable event** (a fully resolved,
timestamped instruction — pitch and timing already resolved, voice ownership already assigned —
that is the sole input the audio engine may take once DEV-399 narrows its contract); the full
contract, including the compile-time, runtime-flow and data-ownership diagrams, lives in
`docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md` (updated by
DEV-394). `src/data/`'s own block already forbids every value import including `tonal`, so it
carries no separate carve-out. The gate covers non-test files under `src/` only — the config's
final block exempts `**/*.test.{ts,tsx}` from every import ban, which is how `scales.test.ts`,
`src/musicCore/tonalAdapter.test.ts` and `noteSpelling.test.ts` deliberately pin behavior against
tonal, and `scripts/` sits outside the gate's `src/**` scope entirely. The analyser exceptions two
paragraphs up (`AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`,
`ui/GainReductionMeter.tsx`, `ui/SourceMeter.tsx`) are unrelated to this axis and unchanged by it.
`src/architecture/` holds
cross-cutting architecture tests that don't belong to any single layer — `dependencyLayers.test.ts`
proves this axis and the four layers above it — and a non-test file placed there would fall under
the `src/**` catch-all block like everything else, since the folder has no layering block of its
own.

`src/utils/` stays outside the chain, above `data/`: it may read `data/` at runtime
(`musicTheory.ts` imports `SCALES`), but nothing in `data/` may read it back except through an
`import type` (e.g. `MeterId`), which is erased at compile. `src/utils/` may also import
`@/musicCore` (`musicTheory.ts`, `noteSpelling.ts`, DEV-394) — never the reverse: `src/musicCore/`
is ESLint-banned from importing `src/utils/`, alongside its store/components/audio bans, so this
relationship reads in one direction from either paragraph. **One deliberate inversion is
recorded here so a reader does not have to discover it: `utils/localFileSave.ts` and
`utils/driveBrowser.ts` import *types and constants* from `src/store/`** — the `.solna` MIME
type and the Drive MIME type. It is an exception because the alternative is duplicating a
contract string in two places, where the two copies can disagree silently and only one of them
is the one `projectFile.ts` actually parses against; the honest fix (a leaf module under
`src/utils/` both layers import) was considered and rejected, because it would move constants
out of already-shipped, already-reviewed search-and-save code for a docs-only change. It is an
import of a *value that never varies*, never a call into the store: no file in `utils/` reads
store state, subscribes, or names a slice.

**A per-degree chord quality is derived, and a note name is spelled only where it is read.**
`SCALES` states `intervals` — content a reviewer can check by eye, pinned to `tonal` by
`src/data/scales.test.ts` — plus `tonal`, `tonality` and, for scales under seven degrees, a
7-note `parent`. It states no chord qualities: `resolveDegreeQuality` derives them by mapping a
degree onto a parent degree **by semitone offset**, stacking thirds over the parent's spelled
names and measuring with `Interval.distance`. Indexing `degree % 7` into the parent is the trap —
it would make Minor Pentatonic's ♭III resolve as the parent's ii°, with the right shape, the right
length and only the sound wrong. An unmapped interval tuple throws rather than falling back to
`maj`, and **there are no overrides**: an override field is the shortcut people reach for instead
of fixing the derivation, which is exactly how two of eleven entries came to contradict the
table's own stated rule with nothing failing. Separately, **a sharp name is an identity and a
spelled name is a label.** Everything generated, computed or persisted is `ROOTS`-spelled;
`src/utils/noteSpelling.ts` spells for display only, at `formatChordLabel`'s optional third
parameter, the lead grid's `leadRowLabel`, the keyboard's `label` field, the key picker's
`KEY_OPTIONS`, and `getTonicSpelling(scaleRoot, scaleType)` at a key name that is purely
rendered — a heading, a chip, a tooltip, a toast, an option label. The boundary is what the value
becomes next, not where it sits: a key name that is only read stays a candidate for spelling, one
that is stored, compared, or used as a lookup key must stay `ROOTS`-spelled. The progression
quick-save name is the case that looks like a miss and is not — it is built from the raw root and
then written into a saved progression's name, so spelling it would put an accidental into
persisted state. Nothing spelled is persisted, so spelling never moves a persist `version` or a
`.solna` `formatVersion`.

**A vibe is pure data, and every library id in it is written once.** `VIBES` in
`src/data/vibes.ts` is a list of `VibeSpec` literals that name ids and nothing else;
`resolveVibe` in `src/store/vibes.ts` turns them into a `ResolvedVibe` — the spec
plus `chords`, `drumPattern` and `effects` — and `applyVibeToStore` writes that.
**There is one drum-grid library, not one per consumer.** `DRUM_GRIDS` serves both
the sequencer's grid menu and the vibes; an entry carries its own `name`, `meter`,
`kit` and `rows`, so a vibe may reference any grid and the menu may offer any grid.
**A drum grid determines the whole pattern.** `replaceBeatPattern` looks a row up by
Beat voice id and **clears every voice no row names** — so picking a grid gives you
that grid, never that grid plus leftovers. It was `applyDrumPattern` and it merged,
which was invisible while every grid declared every row the five tracks had and
became a bug the moment `tom` and `crash` tracks existed. Clearing goes through
`writeStepWindow`, so only the active window clears and the wider-meter padding
survives. **A grid changes the pattern and never the sound**: `beatPresetId` on a
grid entry is provenance nothing applies, so the Beat patch stays the user's to pick
on Sound. **Every row in a grid must name a voice the Beat instrument can play.**
The 53 `bass` cells 23 grids used to carry are deleted, not kept as authored intent:
`bass` is not a Beat voice — no `BeatVoices` field, no `triggerDrum` case — and a row
that cannot sound is not a rhythm. `drumGrids.test.ts` now rejects any row name no
voice plays, so re-adding one turns the suite red. Every grid still
writes every row its origin group defines, empty or not, because a grid should
state what it plays. Each entry also carries a `provenance` — a source URL or the literal `'authored'` —
and the `'authored'` set is an allowlist in `drumGrids.test.ts`, so shipping an
unsourced grid is a name a reviewer sees rather than the default when nobody
looked. **Provenance governs editing, not just disclosure:** a grid carrying a source URL may be
re-voiced — a hit moved from one row to another — because that does not change what the source says
was played, but it may never be re-transcribed — a hit added or moved to a different step — without
the URL becoming a lie. Only a `provenance: 'authored'` grid may gain or move a hit.
The table resolves nothing at module scope, which is what lets the always-mounted
`InstantVibesBar` import it eagerly with no resolver graph behind it; a single
resolver call in that file would put four library modules back into the eager
chunk and bring back the hand-duplicated chip table that was deleted with it.
Each vibe's dice pool is its own explicit arrays (`random.progressions` and the
rest), not the output of a filter over the shared library — so adding a
progression never reaches into a vibe that did not ask for it.

**Beat is a per-loop INSTRUMENT, and it is exactly three sibling fields.** `beatParams` is the
sound, `beatPattern` is the events, `beatMix` is the levels, and every action writes exactly one of
them — a sound edit can never replace a pattern. There is no fourth field and no flat sibling: the
kit-name-only state this replaced (`soundKit`, `drumFilter*`, `masterSequencerVolume`, `drumMuted`,
`sequencerTracks`) is gone from the app, and `src/store/beatLegacyBoundary.test.ts` enforces that
those seven names appear in exactly three files — `sanitizeBeat.ts`, its test, and the guard — with
a LITERAL allowlist, so a second compatibility reader fails review visibly rather than merging as a
one-line addition. **Old input is accepted, new writes never contain old fields**: `readBeatState`
converts a body written in the old shape, and it is the only thing in the app that may read one.
**`beatParams` carries its own output trim** (`outputTrimDb`, the measured calibration figure) and
its own bus filter, so a patch a user edits, saves or exports is self-contained — there is no
trim table beside the engine to look a kit's level up in, and `src/audio/trims.ts` does not exist.
**Every control writes the patch directly**; a knob mid-drag previews through a draft and commits
once (`useBeatParamDraft`), and `applyBeatParams` (`src/audio/beatAdapter.ts`) is the one hop from a
patch to the DSP, shared by the live bridge, the preview and the offline render.

**Eleven Beat voices, and the canonical order is written once.** `kick snare rimshot clap hihat
openhat hitom lowtom ride crash bell` is the order `BEAT_VOICE_IDS` declares, and the `BeatVoices`
interface, `DEFAULT_BEAT_VOICES`, every `BEAT_PRESETS` patch, `DEFAULT_PADS` and `triggerDrum`'s
dispatch all follow it, so a reviewer comparing any two of those lists is comparing sorted lists.
`BeatVoices` carries no `reference` field — a preset's provenance lives on `FactoryBeatPreset`
instead, deliberately off the voices type, so `keyof BeatVoices` stays exactly the voice roster and
never drifts into carrying documentation. `DRUM_ALIASES` is `{ closedhat: 'hihat' }` and nothing
else: `triggerDrum` resolves an alias BEFORE its dispatch, so an alias pointing at a voice that has
since gained its own case makes that case dead code with no error and no failing test — a guard
asserts the table exhaustively (`toEqual`, not a subset check).

**A Beat patch is COMPLETE, and that is what removed the merge.** Every voice states every field, so
there is no `Partial` laid over a shared default and no `mergeDrumKit` to enumerate voices by hand.
`DEFAULT_BEAT_VOICES` is the default preset's own voices object — the drum synth seeds its pre-patch
default from it, and `beatPresets.test.ts` pins that the two are the same object rather than copies
that can drift. A preset is installed WHOLE (`structuredClone`d on the way in), never merged over
whatever the track was already holding.

**`check:drums` asks two different questions, and neither can pass vacuously.** `PAIRWISE_PARAMS`
asks whether two PRESETS differ, and its separation for a pair is a `max` over the list — so adding
a parameter can only raise every pair's separation and make the floor easier to clear. New
parameters therefore enter through `spread()`/`spreadDefined()`, never `PAIRWISE_PARAMS`; a voice
that could collapse into a sibling voice inside one preset (a rimshot against that preset's own
snare, a tom against its own sibling tom) is covered by the separate within-kit check instead, which
asks whether two VOICES differ inside the same patch. `spread()` asserts `max >= factor * min`,
which is vacuously true at `min = 0`, so `spreadDefined` DROPS a zero — a zero is the disabled state
stated explicitly (`clickLevel: 0`), not a measurement — and its counted minimum then makes "too few
presets carry one" a failure rather than a silent pass. `withinKit` fails CLOSED on a non-finite
ratio — an unmeasurable pair is dropped, never treated as passing — plus a counted minimum, so a
preset that goes entirely unmeasurable fails the count instead of silently clearing the floor. The
"every preset voices every voice away from the default" check skips exactly ONE entry, the default
preset itself, because a baseline cannot differ from itself; the script asserts that exactly one
entry is the baseline, so that exclusion cannot quietly grow. A `spread()` factor chosen after its
values were measured is calibration, and its comment says so: from the commit that adds it, the
factor is a floor, never lowered to make a retune easier.

**The dice repoints the drum grid; it does not decorate one.** All five reroll axes
are id pools now (`keys`, `progressions`, `chordRhythms`, `bassPatterns`,
`drumGrids`), and three of the five use `pickDistinct` — `progressions` and
`drumGrids` use plain `pick`, because neither has a `current` in the store to
exclude and manufacturing one would fail silently. A rerolled vibe's `drumGridId`
therefore always names the grid actually playing. The density catalogue and the
kick-collision filter that used to sit behind this axis are deleted, deliberately:
they constrained GENERATED rows, and authored grids are curated — a crash on beat 1
over a kick on beat 1 is standard, not a clash, and porting the filter would reject
grids for being correct.

**The melody tracks store at their own width, and only they do.** The sequencer, chord-rhythm and
bass grids store every bar at the widest meter's `MAX_STEPS_PER_BAR` and window it to the active
`stepsPerBar`. The two melody tracks — Lead and FX — run the same non-destructive scheme on a
second axis: they store at the finest *step resolution* (`LEAD_TICKS_PER_BAR` in
`utils/stepResolution.ts`) and *stride* to the active one, so a `leadMelodySteps` or
`fxMelodySteps` index is a tick, not a 16th, and a `LeadNote.len` counts ticks. Two consequences: a
slot is dormant either because the meter cannot reach it or because the resolution cannot, and
**both tests live in `leadActivePosAt` and nowhere else**; and a change of view never writes — an
explicit edit writes, changing meter or resolution does not.

**Three step layouts, and each lane keeps its own.** The drum voices are the only thing on the
fixed one-cell `StepRow`: a drum cell is one hit at one step and has no length. An event that HAS a
length gets a one-lane span timeline instead, and there are two of them — Chord and Bass — drawn
as bars of cells where an event is one block owning the columns it holds. The melody tracks stay on
the pitch matrix, where a length is a field on the note rather than a column count. Rendering one
of these three for a lane belonging to another is a design change, not a refactor, and
`playbackStep.wiring.test.ts` pins the drum half of it.

**The three span editors share headless pointer mechanics, never a renderer.** Resizing a span is
`useSpanResize` over the pure arithmetic in `spanResize.ts`, and neither knows what a span IS
beyond an opaque identity the feature hands it. Chord and Bass reach it through one shared timeline
component; Lead reaches it through its own grid. The mechanics are shared because a gesture that
must commit once on `pointerup`, write nothing on cancel, and keep its preview in local state is
the same gesture everywhere; the renderers are not, because a note in a pitch matrix and an event
on a bar lane do not draw the same thing.

**A custom Chord or Bass pattern is stored fixed-width and bar-major, and its active length is an
independent divisor of the progression's bars.** Every bar is `MAX_STEPS_PER_BAR` slots whatever
the active meter is, so a stored row never moves when the meter changes — only which of its slots
the view can reach. The two lanes' cycles are independent of each other, so a two-bar chord lane
under a four-bar bass lane is normal, and each is clamped to a divisor of the progression so the
pattern repeats evenly against the chords above it. A bar the current cycle cannot reach is
DORMANT, not deleted: raising the length again brings its onsets back, which is why the read path
pads a lane's width and never cuts it.

**A folded chord boundary caps every custom span, and a full-cycle span retriggers at the seam.**
The boundary map is the progression's chord durations folded onto the lane's cycle with `%`: a lane
shorter than the progression repeats, so a chord change can fall in the MIDDLE of every repetition.
A span may cross neither that boundary nor its own cycle end, and the write clamps to the nearer of
the two — so a span drawn longer stops at the chord change instead of swallowing it. A custom span
covering a whole cycle is a length the user drew, so it releases and retriggers at the seam: the
whole-chord full-hold fast path is preset-only and no custom pattern may borrow it, which is what
the `isFullHoldRhythmCycle`/`isFullHoldBassCycle` wrappers exist to make unforgettable.

**The Chord publisher emits a progression-relative ABSOLUTE step, and each reader folds it
locally.** One playback source feeds the chord lane and the bass lane, and their cycles have
different widths, so a bar-relative step would name a column only one of them has. The step is
published once in progression coordinates and every reader modulos it by its OWN cycle width; a
producer that folded it would hand an independently sized reader a column that does not exist.

**FX is the lead track's twin, and the symmetry comes from a table rather than a rename.**
`MELODY_TRACKS` (`store/melodyTracks.ts`) has one row per melody track and spells its store field
names out as table data — the `SOURCE_BUSES` precedent — because the LEAD row is irregular in four
columns (`synthParams`, `synthVolume`, `synthMuted`, engine source `'synth'`) and a
`` `${id}MelodySteps` `` convention would need a per-column exception for one of the two rows.
`leadSlice` is one factory instantiated twice, and `LeadMelodyGrid` takes a **required** `trackId`
with no default — a default of `'lead'` would make a call site that forgot the prop render a second
copy of the lead grid, visually plausible and caught by no test, because both instances would be
internally consistent. Two mounted grids hold two clock subscriptions, which is what the "the clock
runs iff a player holds a subscription" rule permits: both are players and neither starts a timer.
The step publisher is keyed per track (`StepPlayerId` gained `'fx'`); one shared slot would have the
FX playhead driving the lead's marker at whichever grid's stride published last, with no error
anywhere. **Rec is armed per melody track, and the armed track is ONE value.**
`recordingTrack: MelodyTrackId | null` lives in the ui slice, so two tracks can never be armed at
once and one keypress can never write two grids; `store/leadRecord.ts` is a factory over
`MELODY_TRACKS` and each bridge writes only while `recordingTrack` names its own row, with one
shared anchor collector rather than one per bridge. The Rec button renders on whichever melody
grid `melodyTrackForFocus(focusTrack)` names and on neither when focus is chord, bass, pad or
drum. **The arm is cleared by any navigation away from the armed grid**, not by a focus change
alone: `startRecordArmSync` watches the two axes `soloNav.ts` watches — the LAYER (derived from
`activeTab`, so a Sound <-> Pattern hop does NOT disarm) and `activeLoopId` — PLUS the focus,
which solo deliberately ignores, and a project install clears the arm in the same atomic patch
that clears the solo set. A recorder left armed on a grid the user has navigated away from writes
notes the user cannot see, and a focus change is not the only way to navigate away. Nothing
couples the arm back to the audition target, because the armed track already IS the focused
track. Separately, **the FX track's synth voice** cannot do a PITCH riser as shipped (the filter
envelope ramps `filter.frequency` only), and its LFO still restarts on every note (the LFO
oscillator is created per voice at note-on); a FILTER-SWEEP riser works today. Both limits are
deferred to their own spec.

**A scale-locked lead grid borrows a row; it never hides a note.** A note outside the key is
never deleted by a view change — before, it simply had no row to be drawn on, so switching to
scale-locked made it invisible. `leadPitchRows` now takes the set `leadNotesInWindow` returns —
the notes the ACTIVE window actually draws, walked in leadCellKinds' own coordinate space — and
merges any that are out of scale back in as rows. Two consequences. A borrowed row is **derived,
not stored**: erase its last note and the row goes with it, and a note the resolution or the loop
length cannot reach conjures no row, because an empty row whose note is invisible reads as a bug
rather than as preservation. And the window a borrowed row is bounded by is **the span the scale
rows cover, not the octave suffix** — a scale spills into the next octave label (D major at
octave 4 runs D4..C#5), so bounding by suffix would admit a C4 that sits below the grid's own
lowest row. Out-of-scale rows name `--color-accent` in both views — `leadSpanClasses`' third
argument for the notes, `leadRowLabelTone` for the label — so in chromatic view the accent
labels also read as the semitones the key leaves out.

**Track solo is a monitoring gesture, and it is session-only on purpose.** `soloTracks` lives in
the ui slice, is absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`, and never touches
`LoopMixPatch` — mute is arrangement intent and stays per loop; solo exists only to hear something
while editing it. It is a **set, not a radio** (soloing Drums then Lead sounds both — with the
per-module play buttons gone, "write a lead over just the drums" is only expressible that way),
**solo beats mute**, and its scope is the whole loop. It is **cleared by leaving the Loop layer, by changing the active loop, or by
swapping the project** — a change of the LAYER (derived from `activeTab` via
`layerForTab`) or of `activeLoopId`, watched by the single subscription in
`store/soloNav.ts` rather than by a clear inside each writer, plus
`projectSlice`'s own atomic clear on an install. **A `focusTrack` change never
clears it.** That is forced rather than chosen: `focusTrack` merged the Pattern
segment and the Sound control target into one value, and soloNav's docblock
used to argue that a segment change must clear while a target change must not —
contradictory once they are the same event. The target rule wins, because solo
is a monitoring gesture whose entire purpose is comparing tracks and clearing on
every focus change would make a multi-track set unbuildable anywhere.
Consequence, on the record: a set spanning Drums and the melodic tracks is
buildable from any surface — solo Drums with focus on `drum`, then focus each
melodic track in turn and solo it, on Sound, on Pattern or from the mixer. What
still empties the set is leaving the Loop layer, changing the active loop, or
swapping the project. That
clearing rule is the feature, not a rough edge: a control that can silence a track must not keep
doing so once the user has left the loop it was set in or moved to a different thing to edit. Effective
audibility is computed **only** in `engineSync.ts`, off the same `SOURCE_BUSES` table that drives
the snapshot and the subscriptions, using `isTrackAudible` from `store/trackAudibility.ts` —
`src/components/` may not import `audio/engine`, so a view may never compute it. Solo moves the
Beat **bus** only; the per-voice mute in `beatMix.voices` is a second, independent layer, and both
must pass for a voice to sound. That layer has TWO appliers by design: `audio/beatSteps.ts` skips a
muted voice's scheduled hits so no silent voice is ever built, and `engineSync`'s
`pushBeatVoiceGains` drives the voice's gain to 0 — which is the one that silences what the step
walk never sees, a drum PAD hit or a live trigger. Neither cancels the other; both mean silence.

**The keyboard, the on-screen keyboard and the arp all play whichever track `focusTrack`
names — bus AND patch.** A note's bus is CAPTURED at note-on and never recomputed at release, so
a focus change mid-hold cannot send a note-off to a bus the voice was never on. Equal-power
polyphony counts held notes per BUS, never globally — playing a second track never quietens the
first. The arp releases every bus it has actually TRIGGERED a voice on (not just whichever bus is
focused at cleanup time), because one hold can span a focus change and leave voices on more than
one bus. A `drum` focus makes the melodic keyboard a complete no-op: nothing sounds and nothing is
announced on the note-input bus, because announcing a silent key would let the recorder capture a
note that made no sound; the disjoint QWERTY drum-pad keys are a separate listener and keep
working regardless of focus. **One surface is deliberately exempt: an external MIDI device still
plays Lead whatever the focus is** — `store/midiInput.ts` names `'synth'` outright — because
routing it needs a drum-pad ↔ GM-note mapping this app does not have and does not need, being
designed to require no external device.

**A note-on returns the identity a note-off addresses, and every voice records the PLAYER that
created it.** `triggerSynthNoteOn` hands back a `VoiceId` (`src/audio/synth/voiceId.ts`) and
`triggerSynthNoteOff` takes one, so a bridge releases the instance it started. A source-and-note
pair is NOT an identity: three players share each melodic bus (live input, the arp, the
melody-track sequencer), so the old `` `${source}:${noteName}` `` key named as many voices as
happened to be sounding that note, and an arp key-up cut short a melody track's note. Every voice
also carries an `owner: VoiceOwner` from `src/audio/voiceOwner.ts` — `live`, `arp`, `sequencer`,
`preview` — **required with no default** at `triggerSynthNoteOn`, because the bulk calls are
owner-scoped: `releaseSoundingVoices(source, releaseTime, owner)` releases what one player holds
and skips anything already releasing (so an arp key-up cannot cancel notes the clock has planned),
while `stopOwnedVoices(source, owner, …)` reaches that player's booked tails too — which is why
the two are different methods and not one with a flag. `stopSource` keeps its whole-bus meaning
for a project install, a loop load and a vibe swap, which genuinely mean "silence this bus,
whatever is on it". **Whole-bus reach therefore requires calling a method whose name says so, and
can never be reached by omitting an argument** — which is exactly how the defect came to exist,
and the same scar `applySynthVelocityScale`'s required `source` carries (see the polyphony note
below). The owner is chosen by the bridges in `src/audio/playback/` and **no file in
`src/components/` names one**, so the layering rules do not move and a view cannot pick the wrong
owner. A mono bus is the one SHARED voice: several players can hold notes on it, `group.owner`
records only which of them built it, and every decision about it is therefore taken on the held-note
stack — keying one off the owner stranded a sounding voice and left another player's id resolving
to nothing.

**Equal-power polyphony rides a gain of its own, never the envelope.** One bus's total level stays
flat as keys are added to it: `applySynthVelocityScale(scale, source)` reaches
`SynthVoiceManager.setPolyphonyScale`, which ramps a dedicated `polyGain` sitting between the
voice's tremolo gain and its panner. It has to be separable from both neighbours — an amp envelope
cannot be re-planned mid-note without a click (the legacy engine folded the scale into its peak and
had to cancel and re-plan every held voice's ramps), and `tremoloGain` carries whatever contour
ENV2's amplitude route and the LFO have scheduled, which a write would re-anchor. The COUNT is the
caller's: `useInputDeck` counts the notes held on that bus, so the arp and the melody sequencer,
which share these buses, never enter into it — and the manager skips any group already releasing,
so a key-down cannot duck what the transport is playing and a key-up cannot re-lift a fading tail.
The note itself is played at plain velocity and the rebalance runs AFTER it, one call covering the
arriving voice and the ones already sounding: keydowns are sequential, so a scale baked into each
note's velocity would leave a chord pressed key by key at 1, 1/√2, 1/√3 by press order.

**A patch names its ENGINE, and that tag is what a reader dispatches on.** A synth channel holds an
`ActiveSynth` (`src/types/synth.ts`): an `engine` tag, a `patch` of `{ common, synth }`, and a
`sourcePresetId` that is display provenance and **never a DSP input**. `SynthEngineId` has one
member and deliberately no placeholder second one — an FM or wavetable id nothing implements is a
branch every reader must handle and no test can reach. Adding an engine means adding its params
type to `EnginePatchMap` and a case wherever the tag is read; `common` is the half that does NOT
move, because a voice mode, a glide, a unison spread and an output calibration mean the same thing
whatever makes the sound. A stored body whose `engine` is not a member is never repaired:
`sanitizeTrackSynth` hands back that track's default, by the same "validate, don't migrate" rule as
everything else here.

**A preset is a COMPLETE patch, and applying one installs it whole.** `applySynthPreset(currentArp,
preset)` returns `{ activeSynth, arpSettings }` whose patch is a `structuredClone` of the preset's
own — never a `Partial` merged over what the track was already holding. Merging is what the flat
shape it replaced did, and it meant the sound you got depended on the sound you had: two tracks on
the same preset could differ and nothing said so. Three rules follow. Every entry in
`src/data/synthPresets.ts` states a whole `EnginePatch`, so there is no such thing as a preset that
inherits. **Output calibration lives in the patch** — `common.outputGainDb`, not a preset-id trim
table beside the engine — so a patch a user edits or saves stays self-contained and a renamed preset
cannot silently lose its level. And the clone is load-bearing: handing out the library object would
let the next knob edit write back into the factory table.

**Arp is performance state, stored beside the patch and never inside it.** Each track carries its
own Arp field beside the `ActiveSynth` its sound lives in — `chordArpSettings` next to
`chordSynthParams`, and so on for every track — so installing a preset replaces the sound and
leaves the arpeggiation running exactly as it was — which is why `applySynthPreset` takes the
current Arp and hands it straight back rather than reading one out of the preset. An arp buried in
the patch is a performance setting a preset would overwrite, which is the defect this split exists
to make unrepresentable. `ArpSettings` (`src/types/synth.ts`) inlines its own literal unions rather
than reusing the `ArpMode`/`ArpRate` in `src/types.ts`, which belong to the arp SCHEDULER
(`audio/arpSchedule.ts`, `audio/arpeggiator.ts`); the two modules therefore export no colliding
names and neither imports the other.

**Every patch field carries its unit in its name, and the conversion to linear gain happens at the
`AudioParam`.** Levels are dB (`levelDb`, `subLevelDb`, `noiseLevelDb`, `driveDb`, `outputGainDb`),
envelope and glide times are seconds, frequency is Hz (`cutoffHz`), pitch offsets are an integer
`octave`/`semitone` pair plus `fineCents`/`unisonDetuneCents`, and `resonance`, `keyTrack`,
`stereoWidth`, `velocityToAmplitude` and LFO `depth` are unitless 0..1. **Nothing stored is a linear
gain and nothing stored is `-Infinity`** — `enabled: false` is how a source represents silence, and
`SYNTH_GAIN_FLOOR_DB` (`src/utils/synthPatch.ts`) is the floor both directions of the conversion
clamp to, so every field stays a number a slider can produce and a validator can range-check. A
modulation amount is the one value whose unit could not be read off its name, so `ModRoute` is
discriminated BY TARGET and carries `unit` in the type: semitones for pitch and cutoff, dB for
levels and amplitude, a normalized delta for resonance, -1..1 for pan. `src/utils/synthPatch.ts` is
the only place that math lives, and it deliberately does not import `utils/gainUnits.ts` — that one
is a branded fader/meter contract kept in sync with murva, while a patch level is a plain unbranded
number with its own floor.

**No timer guards a voice's lifetime, and two paths depend on a later event rather than on the
audio clock.** The flat engine armed a 30-second wall-clock backstop per voice against a note-off
that never arrived. `SynthVoiceManager` has no counterpart on purpose (rule 5 in its header records
the whole argument): nearly every `triggerSynthNoteOn` in the app calls `triggerSynthNoteOff` in the
same synchronous block on the audio clock — arp, preview, all four sequencer bridges, the offline
render — so for those nothing can fail to arrive. The exceptions are **live keyboard input**, whose
key-up carries its own backstop in `useInputDeck.ts` (every held note released on `window` blur and
on `visibilitychange`), and **the held chord preview**, which does not. `playChordLegato` schedules
no note-off and drops the `VoiceId`s outright; release is `stopSource('chord')` from a pointer
event, and `useInputDeck`'s backstop releases what the KEYBOARD holds and knows nothing about a
chord held with the mouse. That one is narrowed rather than closed — every surface binds
`onMouseLeave` and `onTouchEnd` beside `onMouseUp`, and `playChordLegato` opens by stopping its own
bus, so a stranded preview lasts until the next preview, loop load, project install or vibe swap.
Closing it properly means a blur/`visibilitychange` backstop for that preview, never a timer in the
manager. A new caller that keeps a `VoiceId` across an await, a React render or a user event is
adding a third such path and owes itself the same treatment. The per-source budget
(`maxVoicesPerSource`) bounds the voice COUNT and is not a leak guard; a voice that does drone means
a bridge dropped its id, so trace the bridge and not the manager.

**One synth implementation serves the speakers and the mixdown; the context is the only difference.**
`createSubtractiveVoice` builds on whatever `BaseAudioContext` it is handed and
`SynthVoiceManager` holds no module-level state, so `createRenderEngine(ctx)` renders with the same
voices the live engine plays. What keeps that true is that **every scheduled time is an argument**:
the voice module never reads `ctx.currentTime`, and the manager's single read sits behind the
realtime teardown timer, whose offline branch forgets the group immediately instead. A realtime-only
concern narrows through `realtimeCtx()` — idle suspend, `resume()`, a `setTimeout` — and a
subsystem that cannot narrow has no business in the offline path. Treat "the render needs its own
copy of this" as a defect report about the shared code, not as a second implementation to write.

**`persist` serialises on every `set()`; only the `localStorage` write is coalesced.** Every
`set()` that touches a key returned by `partialize` re-serialises that slice on the spot. The
write itself goes through `utils/coalescedStorage.ts`, which buffers it to an idle callback and
flushes on `pagehide`/`visibilitychange` — so the serialise cost is still per-`set()`, and
anything driven by a pointer, a clock tick or an animation frame must not write persisted state
directly. Consequence for tests and for reading `localStorage` in a live page: storage lags the
store by up to one idle window; call `flushPersistedWrites()` before asserting on it.

**There are no migration chains — validation replaced them, and that is a decision with a
precondition, not an accident.** DEV-388 deleted both read-time upgrade chains (the persist
`migrate` in `store.ts` and the `.solna` chain in `projectFormatMigrate.ts`, which a follow-up
then deleted outright — the file, not just its chain — once its sole export had settled to a
literal identity function with no production caller). `migrate` in `store.ts` is identity except
for the legacy localStorage-key adoption it still calls, kept only because zustand's `persist`
throws on a version mismatch with no `migrate` function at all. `PERSIST_VERSION` and
`PROJECT_FORMAT_VERSION` still exist and are still stamped on every write — the latter is still
the murva-facing interop marker and still what `parseProjectFile` refuses a *newer* body
against — but neither drives a read-time transform any more. In place of a chain,
`sanitizePersistedState` (store.ts) and `sanitizeContent` (projectFile.ts, which is the only
non-test caller of `sanitizeLoops` — loops live in the IndexedDB slot, not in `localStorage`, so
the persist path never reads one) validate every key on every read regardless of which version
wrote it: out of range, wrong type, missing, or not a member of an allowed set gets the default;
a value that is in range passes through untouched, whatever unit or shape convention was current
when it was written. The precondition is **solna has no real users yet** — a fader value is a
plain number, and a number in range is indistinguishable between, say, linear gain and dB, so
nothing here guesses which one wrote it. The case worth naming, not just the benign one: a
pre-DEV-386 bus a user had faded all the way down was stored as linear `0`, and `0` is also a
perfectly legal dB value — *unity* — so that bus now reads back at full level, not silent. A
developer who hits a stale-looking value fixes it by hand. If solna gains users with sessions
worth preserving across a unit or shape change validation truly cannot express, that
precondition is gone and a chain — sequenced the way the old ones were, one `if (version < N) …`
guard per shape change, never reused once shipped, output frozen the moment its guard ships — is
the thing to bring back, in `migrate`/`merge` and in a re-created project-body equivalent of
`projectFormatMigrate.ts`, kept as two separate chains for the reason below. Until then, do not
add a version-gated branch "just in case": a guard against a version nothing produces any more is
dead code with no test forcing it to stay honest, which is exactly the shape the old chains
rotted into.

**The shared 16th clock runs if and only if a player holds a subscription.** `subscribeClock`
starts the timer for the first listener and `stopClockTimer` ends it with the last, and nothing
else may start or hold it. The metronome is a **click, not a transport**: `setMetronomeEnabled`
only arms the click that `clockTick` emits, so it sounds while something plays and does nothing
at all otherwise. It once started the clock and blocked the idle suspend, which made the toggle a
second, invisible transport — the grid's playhead ran and the lead recorder quantised against it
with no music playing. Anything that needs a clock must start a player; to record in time to a
click alone, press play on the lead.

**The store→engine bridge** is `src/store/engineSync.ts`: one `subscribeWithSelector`
subscription per engine-settable value with `fireImmediately`, started once by `useEngineSync()`
in `App.tsx`. The `AudioContext` is created on the first user click, after which
`applyEngineSnapshot()` re-applies the whole persisted audio state. **Never call engine setters
from a component** — add the state to a slice and wire it in `engineSync.ts`.

**A meter reads samples, not a spectrum, and it reads them before the dynamics.** Level is peak
and windowed RMS computed from `getFloatTimeDomainData` and reported in dBFS (`src/utils/`:
`gainUnits.ts`, `meterZones.ts`, `meterScale.ts`, `meterLevel.ts`; a zone's colour comes from
`meterColor.ts`'s `zoneFillClass`, which is `vuMeter.ts` renamed when the ten-segment bar became
a continuous fill — there is no `vuMeter.ts` any more). Averaging
`getByteFrequencyData` bins — what `getAudioLevel()` did — measures a patch's brightness, not its
loudness, and yields a 0..1 with no dB meaning, which is why the segments it drove corresponded
to nothing. The master analysers are **observe-only sends off `masterGain`**, post-fader and
ahead of *both* dynamics stages — the compressor and the limiter sit downstream of the tap, so a
reading is never capped by either regardless of which is engaged. The compressor defaults off;
the limiter defaults on (DEV-383) but only catches occasional peaks at its -3 dB threshold given
the -6 dB source-bus default, so the `over` zone stays reachable in the common case. Every meter ticks through
`utils/meterScheduler.ts` — one rAF loop, a tier per registration, and an `IntersectionObserver`
per element. That last part is not an optimisation here: every tab view AND every Pattern segment
stays mounted, so a meter with no visibility gate reads its analyser forever on a surface nobody
is looking at. **No
meter value may enter a zustand slice** — a write per tick re-renders every mounted view — and
the numbers (`-24`/`-6`/`-1` zones, the `0/5/30/100` piecewise scale, 14 dB/s decay, a −60 dBFS
display floor) are an interop contract with murva recorded in
`docs/superpowers/plans/2026-09-07-dev-383-gain-staging-contract.md`, not values to re-derive.

**Storage access is always guarded.** `localStorage` can *throw* (Safari private mode, blocked
cookies, embedded webviews), not just return null — `store.ts` falls back to an in-memory
`StateStorage`, and helpers like `Header.tsx`'s theme functions take an injectable storage param
and read it *inside* a `try`, never in a default-parameter expression.

**Four storage zones, not three.** `localStorage` holds the live session (persist, above);
`sessionStorage` nothing; **IndexedDB holds the one project slot**, reached only
through `store/projectStore.ts`; and **Google Drive is the optional remote source an explicit
Save commits to** — absent, not disabled, when `VITE_GOOGLE_CLIENT_ID` is unset. That wrapper
resolves availability *once, lazily* and turns
every failure into a typed result — a device that cannot store projects is a **normal degraded
state the UI renders, never an exception path**, the same discipline `resolveStorage()` follows.
Bodies and metadata live in **separate object stores** so listing the library never deserialises
a single project body; every write touches both in one transaction. The slot's value is a
**record, `{ body, source }`** (`ProjectSlotRecord` in `store/projectSource.ts`): `source` is
where an explicit Save writes back — `untitled`, a Drive `fileId`, or a local
`FileSystemFileHandle` — and it is held **beside** the body, never inside it, because a file id
is location metadata and a handle is not serialisable, so neither may reach `serializeProject`.
**The source never travels in the `.solna` body**, and **`projectSource` is not a *localStorage*
persist key** — it is deliberately absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`
— but it lives in the IndexedDB slot record beside the body, so a reload restores the source
from the slot record; only the `.solna` file carries no pointer to where it came from.
`sanitizeSlotRecord` accepts a slot written before sources existed and reads it as
`{ body, source: untitled }`; there is no version gate for that widening, by the same "no
migration chains" rule as everything else here. A **project body is the
content set only** (see `PROJECT_CONTENT_KEYS`) — view, session and library state are excluded
by construction — and its `formatVersion` is deliberately **independent of the persist
`version`**: that one is stamped for private `localStorage` reshapes, this one for the `.solna`
content contract, and a body's `.solna` shape must never be read by treating it as a
`localStorage` payload or vice versa. Neither version drives a transform any more (see the "no
migration chains" note above), but they still mean different things and must not collapse into
one — `parseProjectFile` refuses a body whose `formatVersion` is newer than
`PROJECT_FORMAT_VERSION` regardless of what `PERSIST_VERSION` is doing.

**`dirty` is derived, never persisted.** One idle pass fingerprints the content set and compares
it to the project's baseline (or, untitled, to the default project) — see `projectDirty.ts`;
computing it per `set()` would fingerprint the whole arrangement on every knob tick. Because
hydration runs synchronously *inside* `create()`, before the tracker exists, `store.ts` schedules
**one pass at boot** — that pass is what makes a reloaded session honest, and without it a
restored session with unsaved work gets no badge and no dirty guard.

## Testing — the one trap worth knowing up front

Roughly a third of the suite renders React through `renderToString`, and zustand wires
`getServerSnapshot` to the store's **creation-time** state — so `useAppStore.setState(...)`
before a render has no effect unless the component reads the store the way
`ui/BottomInputDock.tsx` does. Full conventions live in `.claude/rules/testing.md`.

## Traps recorded in the spec — don't "fix" these

- **Tap Tempo and stereo VU are unbuilt**, not broken — see `docs/design.md` §4 item 3.
- **The lead melody's two read-time upgrade chains are gone (DEV-388), and the shape they used
  to fix up is now just validated.** `asLeadNoteMatrix` (sanitize.ts) — the guard both read paths
  go through — still returns `undefined` for the pre-DEV-369 `string[][]` shape, so a payload in
  that shape still comes back blank with no throw and no warning; that part is unchanged and is
  the trap. What is gone is the pair of chains that used to widen a *valid but stale* shape (the
  pre-tick-resolution `LeadNote[][]`) before sanitize ever saw it — a stale-but-valid shape is now
  accepted as-is and passed through unchanged, at whatever tick density it was written, because
  it is not invalid, just old. When the two chains existed they were never merged even though
  they shared their pure transforms, because a persist payload is private `localStorage` shape and
  a project body is an external contract — if a genuinely un-validatable shape change ever forces
  a chain back (see the "no migration chains" note above), that split is still the right call and
  should not be "fixed" into one shared chain.

## Git conventions

Branch names are `<type>/<issue-code>-<name>`: the type is the conventional-commit type the
branch's work will land as (`feat`, `fix`, `refactor`, `docs`, `chore`), the issue code is the
Linear id lowercased and is omitted entirely when the work has no issue, and the name is a short
kebab-case summary — `feat/dev-369-lead-note-length`, `chore/eslint-guards`. Feature work never
lands as a commit made directly on `main`.

## Repo-local skills and rules

`.claude/skills/` ships two skills worth loading when relevant: `dsp-audio` (read before touching
effect chains, signal routing, or `AudioContext` lifecycle) and `music-theory` (before touching
notes, keyboard, drum pads, sequencer, or chord/bass generation).

`.claude/rules/` holds path-scoped rules that load automatically when you open the files they
cover: `theming.md` (components, `index.css`, `themeColor.ts`), `testing.md` (test files and
`scripts/`), and `note-input.md` (the one dispatcher every played note goes through, and why
previews and sequenced notes stay off it).

`squash-by-logical-change` (consolidating noisy agent-generated commits before review) is a
**global** skill in `~/.claude/skills/`, not part of this repo.

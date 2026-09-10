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
bun run check:drums    # drum-kit audible-separation check
bun run check:contrast # drum- and module-palette AA contrast floor (both themes)
bun run check:levels   # calibration trim table still matches today's kit/preset defaults
bun run verify         # test + lint + eslint + check:keys + check:drums + check:contrast + check:levels + build (the gate)
```

`bun run verify` is the completion gate — run it before claiming work is done. It runs
`bun run eslint`, which currently reports **nothing at all** — no errors and no warnings — and
that is the state to keep it in. Per decision D5 a new rule lands as `warn` and flips to
`error` in the change that empties it, which is why the `React.FC` ban, the `../../` ban and
`consistent-type-definitions` are now errors (see the ESLint rule matrix in
`docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md`).
`react-hooks/exhaustive-deps` and `complexity` stay at `warn` deliberately: both have
legitimate exceptions, so each remaining one carries a line disable naming its reason rather
than a rule relaxed for everybody. `check:contrast`
holds **both** namespaced palettes — `--drum-*` and `--module-*` — above the AA floor in both
themes; the closest pair sits a few thousandths above 4.5, so that step is a gate a palette can
fail, not a report of what the palettes are. The two rosters are named differently on purpose:
drum voices come from `DRUM_TYPES` (a voice exists in code whether or not it has a colour), while
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
   content only: synth presets, drum kits, drum grids, chord progressions,
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
3. `src/store/` — never imports `components/`. One Zustand store composed from slices
   (`transport`, `musicContext`, `synth`, `chords`, `bass`, `sequencer`, `effects`, `ui`,
   `presets`, `loop`, `lead`, `project`), with `persist` (key `musibox_project_state_v1`, `partialize` +
   `migrate` in `store.ts`, legacy-key adoption in `migrate.ts`) and `subscribeWithSelector`.
   There is no per-version migration step to add any more — `PERSIST_VERSION` is stamped on
   every write but, since DEV-388, drives no read-time transform (`migrate` in `store.ts` is
   identity except for the legacy localStorage-key adoption it still calls, kept only because
   zustand's `persist` throws without a `migrate` function at all). A
   persisted shape change is handled by validating the new key in `merge`'s
   `sanitizePersistedState`/`sanitizeLoops`, not by bumping the version. See the "no migration
   chains" note further down for why, and for the precondition under which that stops being
   true.
4. `src/components/` — dumb views; must not import `audio/engine`. Only `AudioVisualizer.tsx`,
   `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`, `ui/GainReductionMeter.tsx` and `ui/SourceMeter.tsx`
   (read-only analyser consumers) and test files are exempt — routing their per-frame analyser
   reads through the store would mean a store write on every animation frame and a re-render of
   every subscriber. **`eslint.config.js` is the list that binds**; this one has drifted behind it
   before, so add to both or the allowlist quietly grows without anyone reading it.

`src/utils/` stays outside the chain, above `data/`: it may read `data/` at runtime
(`musicTheory.ts` imports `SCALES`), but nothing in `data/` may read it back except through an
`import type` (e.g. `MeterId`), which is erased at compile.

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
**A drum grid determines the whole kit.** `replaceDrumPattern` looks a row up by
the sequencer track's instrument name and **clears every track no row names** — so
picking a grid gives you that grid, never that grid plus leftovers. It was
`applyDrumPattern` and it merged, which was invisible while every grid declared
every row the five tracks had and became a bug the moment `tom` and `crash` tracks
existed. Clearing goes through `writeStepWindow`, so only the active window clears
and the wider-meter padding survives. **Every row in a grid must name a voice a
sequencer track can play.** The 53 `bass` cells 23 grids used to carry are deleted,
not kept as authored intent: `bass` is not a drum voice — no `DRUM_KITS` field, no
`triggerDrum` case, no track — and a row that cannot sound is not a rhythm.
`drumGrids.test.ts` now rejects any row name no track plays, so re-adding one turns
the suite red. Every grid still
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

**Eleven drum voices, and the canonical order is written once.** `kick snare rimshot clap hihat
openhat hitom lowtom ride crash bell` is the order `DRUM_TYPES` declares, and the `DrumKit`
interface, `DEFAULT_DRUM_KIT`, `mergeDrumKit`, `INITIAL_SEQUENCER_TRACKS`, `DEFAULT_PADS` and
`triggerDrum`'s dispatch all follow it, so a reviewer comparing any two of those lists is comparing
sorted lists. `DrumKit.reference` does not exist — `reference` lives on `DRUM_KITS`'s value type
instead, deliberately off the interface, so `keyof DrumKit` stays exactly the voice roster and
never drifts into carrying documentation. `DRUM_ALIASES` is `{ closedhat: 'hihat' }` and nothing
else: `triggerDrum` resolves an alias BEFORE its dispatch, so an alias pointing at a voice that has
since gained its own case makes that case dead code with no error and no failing test — a guard
asserts the table exhaustively (`toEqual`, not a subset check).

**`mergeDrumKit` enumerates every voice by hand, deliberately.** Each voice has a differently
shaped params type, so merging a partial kit against the default by looping over `DRUM_TYPES` would
need a cast inside the loop — trading a compile error for a runtime hole the first time a partial
kit is malformed.

**`check:drums` asks two different questions, and neither can pass vacuously.** `PAIRWISE_PARAMS`
asks whether two KITS differ, and its separation for a pair is a `max` over the list — so adding a
parameter can only raise every pair's separation and make the floor easier to clear. New parameters
therefore enter through `spread()`/`spreadDefined()`, never `PAIRWISE_PARAMS`; a voice that could
collapse into a sibling voice inside one kit (a rimshot against that kit's own snare, a tom against
its own sibling tom) is covered by the separate within-kit check instead, which asks whether two
VOICES differ inside the same kit. `spread()` asserts `max >= factor * min`, which is vacuously
true at `min = 0`, so a parameter that must never be zero carries its own explicit `> 0`
assertion; `withinKit` fails CLOSED on a non-finite ratio — an unmeasurable pair is dropped, never
treated as passing — plus a counted minimum, so a kit that goes entirely unmeasurable fails the
count instead of silently clearing the floor. A `spread()` factor chosen after its values were
measured is calibration, and its comment says so: from the commit that adds it, the factor is a
floor, never lowered to make a retune easier.

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
anywhere. **FX has no live recorder** — `leadRecording` and `store/leadRecord.ts` stay lead-only —
and it is not a constraint on the material: a user who wants a counter-melody writes one and the
track behaves identically. What it cannot do as shipped is a PITCH riser (the filter envelope ramps
`filter.frequency` only) and its LFO still restarts on every note (the LFO oscillator is created per
voice at note-on); a FILTER-SWEEP riser works today. Both limits are deferred to their own spec.

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
**solo beats mute**, and its scope is the whole loop. It is **cleared by a Pattern-segment change,
by leaving the Loop layer, or by changing the active loop** — a change of `patternSegment`, of the
LAYER (derived from `activeTab` via `layerForTab`), or of `activeLoopId`, watched by the single
subscription in `store/soloNav.ts` rather than by a clear inside each writer of `activeLoopId`. A
tab change between Sound and Pattern does **not** clear it: Sound and Pattern are the two halves of
editing one loop and the user crosses between them constantly, so a solo set that survives that
crossing is the working state, while a Pattern-segment change is a change of subject and still
clears. Consequence, on the record: because the Sound ↔ Pattern hop survives, a set spanning Drums
and the melodic tracks IS buildable — solo Drums in Beat, hop to Sound, then add lead/fx/chord/bass/pad
one at a time via the control target, since a target change doesn't clear either. What still empties
the set is a Pattern-segment change, leaving the Loop layer, changing the active loop, or swapping
the project. That
clearing rule is the feature, not a rough edge: a control that can silence a track must not keep
doing so once the user has left the loop it was set in or moved to a different thing to edit, so do
not "fix" it into stickiness — and do not "fix" the Sound/Pattern survival back into clearing on
every tab change either. Effective
audibility is computed **only** in `engineSync.ts`, off the same `SOURCE_BUSES` table that drives
the snapshot and the subscriptions, using `isTrackAudible` from `store/trackAudibility.ts` —
`src/components/` may not import `audio/engine`, so a view may never compute it. Solo moves the
drums **bus** only; the per-voice drum mute in `sequencerTracks` is a second, independent layer
applied in `useSequencerPlayback`, and both must pass for a voice to sound.

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
`sanitizePersistedState`/`sanitizeLoops` (store.ts) and `sanitizeContent` (projectFile.ts,
which also calls `sanitizeLoops`) validate every key on every read regardless of which version
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

**Three storage zones, not two.** `localStorage` holds the live session (persist, above);
`sessionStorage` nothing; and **IndexedDB holds the saved project library**, reached only
through `store/projectStore.ts`. That wrapper resolves availability *once, lazily* and turns
every failure into a typed result — a device that cannot store projects is a **normal degraded
state the UI renders, never an exception path**, the same discipline `resolveStorage()` follows.
Bodies and metadata live in **separate object stores** so listing the library never deserialises
a single project body; every write touches both in one transaction. A **project body is the
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

# Vibe as References — Design

Date: 2026-08-26
Status: Approved, not yet implemented
Scope: Project D of the Vibe work (A = Automation Player Transport, B1 = degree-based
progression library + auto-harmonize fix, B2 = Vibe Variation Engine / dice, D = Vibe
Sound as Library References). D follows the Vibe Variation Engine
(`docs/superpowers/specs/2026-08-26-vibe-variation-engine-design.md`), already
implemented on this branch — `InstantVibe`, `VibeVariation`, `DrumDecorationRule` and
`DecorationLayer` live in `src/types.ts`, and `src/store/instantVibes.ts` and
`src/store/vibeVariation.ts` are in place. D depends on B1 (`CHORD_PROGRESSIONS`,
`resolveProgression`) and B2 (`VibeVariation`, the dice) but does not touch the dice,
the draw, or `resolveVibeVariation`. It changes what an `InstantVibe` *is authored as*
— a set of library references instead of an inline sound snapshot — which the
variation engine then reads and rerolls exactly as it does today.

No code, no implementation plan. This is the architectural decision record; the four
phases below are sequencing, not a task breakdown.

## The problem

The six Instant Vibes carry every piece of their sound as inline, hand-typed data:
chords, synth params, effects and drum pattern are all authored once, directly on
`INSTANT_VIBES` (`src/store/instantVibes.ts`), with no library behind any of them. Each
vibe is a ~130-line literal, six vibes total. That is fine for six fixed presets, but it
makes adding a vibe expensive, leaves the app unable to say what preset inventory it
needs, and one subsystem has silently stopped working — three things, all measurable.

**Synth params are decorative labels wrapped around a full override.**
`buildSynthParams` (`src/store/instantVibes.ts:11`) is:

```ts
function buildSynthParams(presetName: string, overrides?: Partial<SynthParams>): SynthParams {
  return {
    ...INITIAL_SYNTH_PARAMS,
    ...overrides,
    preset: presetName,
  };
}
```

`presetName` is spread in *last* only for the `preset` display field — it never looks
anything up in a preset table. The actual sound comes entirely from `overrides`, a
literal `Partial<SynthParams>` authored inline for each voice. Every vibe calls this
three times — once each for `chordSynthParams`, `bassSynthParams` and `synthParams` —
so there are 6 vibes × 3 voices = **18 distinct synth voices**, none looked up from
anywhere. Measured against the real data:

- All 18 are distinct from each other.
- 0 of 18 match any factory preset: the closest preset still differs in 16-19 of 24
  params, and the preset each voice is *named after* differs in 16-22 of 24.
- Each vibe overrides 9-16 of 24 `SynthParams` fields; the rest fall through to
  `INITIAL_SYNTH_PARAMS`.

The `*PresetName` fields (`synthPresetName`, `chordPresetName`, `bassPresetName`) are
therefore pure display strings today: changing one to a factory preset's real name
would change nothing the user hears, because the override object beside it always
wins. Editing "Dream Keys" in the preset library changes nothing about any vibe.

**A real preset library exists and is unused by vibes.** `src/audio/synthPresets.ts`
declares `FACTORY_PRESETS` (22 entries) and combines it with `src/audio/bassPresets.ts`'s
`FACTORY_BASS_PRESETS` (5 entries) into `ALL_FACTORY_PRESETS`
(`src/audio/synthPresets.ts:733-735`), 27 entries total. Every preset carries a
`category` naming a timbre role — Bass, Lead, Pad, Keys, Pluck, Brass, or FX — never a
genre:

| category | count |
| --- | --- |
| Bass | 9 (4 in `FACTORY_PRESETS` + 5 in `FACTORY_BASS_PRESETS`) |
| Keys | 4 |
| Pad | 4 |
| Lead | 3 |
| FX | 3 |
| Brass | 2 |
| Pluck | 2 |

None of these 27 presets is ever referenced by an Instant Vibe.

**Effects are hand-typed per vibe with no shared library.** Each vibe's `effects`
block has 8-9 fields (`reverbWet`, `reverbDecay`, `delayWet`, `delayFeedback`, an
optional `distortionWet`, `compressorThreshold`, `eqLow`, `eqMid`, `eqHigh`); all six
are distinct object literals, and there is no `EFFECT_CHAINS`-style table anywhere for
a vibe to draw from.

**Drums are hand-typed per vibe with no shared library, unlike genres.** Each vibe's
`drumPattern` is a `Record<string, number[]>` with exactly seven keys, in order `kick,
snare, hihat, openhat, clap, tom, crash`, each a 16-step 0/1 array, authored once per
vibe. `src/audio/data/genrePresets.ts` has an analogous-looking library,
`GENRE_PRESETS`, for the sequencer's genre button — 12 genres (Synthwave, House, Trap,
Boom Bap, Cyberpunk, DnB, Dubstep, Techno, Funk, Rock, Reggae, Lo-Fi Hip-Hop), rows
`kick snare hihat openhat clap tom bass`, boolean cells — but it is not reusable here.
Its seventh row, `bass`, is a **pitched note-trigger**, not a drum:
`SequencerView.tsx:335` plays `const note = track.instrument === "bass" ? "C2" :
"C4";` when previewing it. A vibe's `drumPattern` has no `bass` row at all — its
seventh row is `crash`, a drum hit — so the two shapes agree on six rows and diverge on
the seventh, and the divergence is semantic (pitched trigger vs. drum hit) and typed
(boolean vs. number), not just naming. `GENRE_PRESETS` is consumed only by
`applyGenrePreset` at `SequencerView.tsx:106`; nothing today reads it from vibe
application, and there is no 1:1 mapping between the 12 genres and the 6 vibes (Trap,
DnB, Dubstep, Techno, Funk, Rock and Reggae have no vibe; Zen and Ambient have no
`GENRE_PRESETS` entry).

**Chords are inline `ChordItem[]` literals, mostly with no progression id that
reproduces them.** `makeVibeChord(id, root, quality, bars, octave)` builds each vibe's
chord list by hand, through `deriveChordNotes`, not through `resolveProgression`.
`CHORD_PROGRESSIONS` (`src/audio/data/chordProgressions.ts`) holds 40 entries, and every
vibe's `variation.progressionIds` resolves against it for the dice — but the vibe's
*authored* `chords` array, the one the chip loads before any dice press, still does not
come from that library for four of six vibes. Only 2 of 6 reproduce byte-for-byte from
a progression already in the library: `synthwave-80s` via `cine-epic-ostinato`,
`asian-zen` via `zen-bamboo-vamp`. The other four match none of the 40 progressions:

| vibe | literal chords | bars | scale (degrees) |
| --- | --- | --- | --- |
| `lofi-chill` | Cmaj7 – Amin7 – Dmin7 – G7 | 1 each | C Major (I–vi–ii–V) |
| `cyber-dance` | Fmin – D#maj – C#maj – Cmin | 1 each | F Natural Minor (i–VII–VI–v) |
| `ambient-chill` | Dmaj7 – Emaj – F#min7 – G#m7b5 | 2 each | D Lydian (I–II–iii–#ivø7) |
| `hiphop-groove` | Emin7 – A7 – Dmaj7 – Gmaj7 | 1 each | E Dorian (i–IV7–VII–III) |

## Settled decisions

1. **Every sound a vibe produces becomes a library reference. `InstantVibe` keeps no
   authored sound data.** Chords, synth voices, drums and effects are all replaced by
   ids that resolve into a shared library — the same pattern the vibe already uses for
   `chordRhythmId` and `bassPatternId`. Where a vibe's configuration has no library
   home today, this project creates one rather than leaving it inline.

2. **The sound may change**, provided what lands in the libraries is researched,
   principled data rather than a snapshot of today's values. The measurements above
   justify this: the 18 voices are not designed sounds but the residue of
   half-overriding defaults — no two alike, none close to any preset, not even their
   namesakes — and there is no reason a resolved preset must reproduce today's override
   object byte for byte.

3. **No genre tags on presets.** A proposal to tag every preset with genres and derive
   each vibe by collecting a tag was rejected, for two reasons. First, genre is
   metadata about *authored* content, but presets are content users will create —
   forcing a genre field on a user's own Lead patch asks a question that often has no
   answer ("is this fat bass lofi or boombap? depends what you use it for"), filling
   the field with noise and making any invariant built on it untrustworthy for every
   preset, factory or not. Second, it inverts curation: a vibe's identity (`name`,
   `emoji`, `tagline`, `projectTitle`) and musical anchor (`scaleType`, `keyPool`,
   `bpmRange`) cannot be *derived* from a tag search over presets — the vibe has to
   pick its sound explicitly, the same way it already picks its comp rhythm and bass
   pattern explicitly by id via `rhythmIds`/`bassPatternIds`, not by a rhythm-genre tag.

4. **`ChordProgression.genres[]` stays, and this is not inconsistent with decision 3.**
   `CHORD_PROGRESSIONS` is authored library content, not user-generated content —
   user-saved progressions are `CustomChordProgressionItem` (`src/types.ts:76`), which
   has no `genres` field at all. `VibeVariation.progressionIds` is an explicit,
   authored list per vibe, not a runtime filter over `genres` — the dice never queries
   `CHORD_PROGRESSIONS` by genre at draw time; the pool is pinned per vibe ahead of
   time. `genres[]` is an authoring aid and the basis of B1's genre-floor invariant test
   (at least four progressions per genre), not a dispatch mechanism, and this project
   does not add an equivalent tag to presets, drum patterns or effect chains.

5. **`VibeVariation` does not change.** The dice already randomizes exactly
   `scaleRoot`, `bpm`, `chordRhythmId`, `bassPatternId`, `chords` (via a drawn
   `progressionIds` member) and the `hihat`/`openhat`/`tom`/`crash` drum-decoration
   rows. Timbre and effects are genre identity and stay fixed per vibe by the variation
   engine's own design. A vibe needs exactly one synth preset id per role, one
   drum-pattern id, and one effect-chain id — a single reference each, not a pool — so
   full referencing adds no field to `VibeVariation`.

6. **`applyInstantVibeToStore` keeps its current transport behaviour exactly as it
   stands today.** It performs a synchronous `audioEngine.stopSource('chord', 0.02)` /
   `stopSource('bass', 0.02)` cut before the first vibe-state write, then selectively
   restarts players that were active. Two real fixes are already in place for this
   function — `d8df714 fix(vibes): cut scheduled voices before swapping so vibes never
   overlap` and `c4a253a fix(transport): actually cut audio on an Instant Vibe swap` —
   and this project changes only what the function's caller resolves *before* calling
   it (ids become concrete field values ahead of the call), never the cut-and-restart
   behaviour itself, and introduces no second apply path.

## Target shape

```ts
export interface InstantVibe {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  bpm: number;
  scaleRoot: string;
  scaleType: string;
  projectTitle: string;
  soundKit: string;
  drumPatternId: string;
  chords: ChordItem[];
  progressionId: string;
  chordRhythmId: string;
  chordFeel: string;
  chordOctave: number;
  chordPresetId: string;
  bassPatternId: string;
  bassFeel: string;
  bassOctave: number;
  bassPresetId: string;
  synthPresetId: string;
  effectChainId: string;
  variation?: VibeVariation;
}
```

**Field naming is `*Id`, not `*Name`.** The existing fields are `synthPresetName` /
`chordPresetName` / `bassPresetName`, matched against `SynthPresetItem.name` only for
display, never resolved back into the library — `buildSynthParams` never used them to
look anything up, it only stamped the string into the `preset` display field while the
literal override object beside it did all the real work. Every other library reference
already in the codebase uses ids — `progressionIds`, `rhythmIds`, `bassPatternIds` —
and renaming a preset must not silently detach a vibe from its sound, which an id
survives and a name does not. `chordRhythmId` and `bassPatternId` already use the `Id`
suffix today and are unchanged; only the three synth-related fields are renamed
(`synthPresetId`, `chordPresetId`, `bassPresetId`) and two new library fields are added
(`drumPatternId`, `effectChainId`), alongside the new `progressionId`. `chords:
ChordItem[]` stays on the type: it is the *resolved* output of `progressionId`, cached
the same way the variation engine's resolver already produces a concrete `chords` array
rather than storing an unresolved reference on the applied vibe.

Six vibes today span roughly `instantVibes.ts` lines 107-841 — about 730 lines across 6
vibes, ~120 lines each. A vibe authored purely as references — six ids plus a handful
of scalar fields (`bpm`, `scaleRoot`, `scaleType`, `chordOctave`, `bassOctave`,
`chordFeel`, `bassFeel`, `soundKit`, plus identity fields) — is roughly one field per
line plus structure: ~25 lines per vibe.

**The synth pool is two-dimensional.** A vibe needs three synth voices in three
distinct **roles**: lead (`synthPresetId`), chord/comp (`chordPresetId`) and bass
(`bassPresetId`). The existing preset library's `category` field (the 8-value union
Bass, Lead, Pad, Keys, Pluck, Brass, FX, User) is a **timbre role**, not a genre —
nothing in the 27-preset library says "this preset is for Synthwave" or "this preset is
for Boom Bap," and decision 3 is exactly why that stays true. That means the inventory
requirement for this axis is not "N presets per genre" — it is **"at least one
suitable preset for each role a vibe needs."** This is what makes the requirement
testable: an invariant test can assert that each vibe's three preset ids resolve to
real library entries whose category is appropriate for the role, without ever needing a
genre concept inside the preset library itself. The role-to-category mapping is not 1:1
for every role: `bassPresetId` must resolve to a `Bass`-category preset — that
constraint is hard, because bass is a physical register, not a taste call — but
`synthPresetId` (lead) and `chordPresetId` (comp) can reasonably draw from `Lead`,
`Pad`, `Keys`, `Pluck`, `Brass` or `FX` depending on the vibe's character; only the bass
role is a hard category constraint, the other two are judged suitable by ear against
the vibe's genre.

## Inventory

The concrete build list for all six vibes to resolve purely from libraries:

**Chord progressions — 4 new entries in `CHORD_PROGRESSIONS`,** one per vibe currently
missing a matching entry (`synthwave-80s` and `asian-zen` already resolve via
`cine-epic-ostinato` and `zen-bamboo-vamp` and need only a `progressionId` pointing at
the existing entry):

- `lofi-chill`: I–vi–ii–V in C Major, 1 bar each (Cmaj7 Amin7 Dmin7 G7 — the "extended
  sevenths throughout" flavour lofi's other entries already use).
- `cyber-dance`: the F Natural Minor progression as authored (Fmin, D#maj, C#maj,
  Cmin), 1 bar each.
- `ambient-chill`: the D Lydian progression, 4 bars each (Dmaj7, Emaj, F#min7, G#m7b5).
- `hiphop-groove`: the E Dorian progression, 1 bar each (Emin7, A7, Dmaj7, Gmaj7).

`ambient-chill` was originally authored at 2 bars/chord, which disagreed both with the
`ambient` genre's own bar-floor rule B1 researched (every `ambient`-tagged
`CHORD_PROGRESSIONS` entry holds `bars >= 4`) and with every progression already in
`ambient-chill`'s own dice pool (4 or 8 bars/chord). Rather than relax the rule to fit
the vibe, the vibe was corrected to 4 bars/chord — the one place Phase 1 is permitted
to change what a vibe sounds like.

Each new entry follows the existing `ChordProgression` shape (`id`, `name`, `roman`,
`description`, `category: ProgressionCategory`, `referenceScale`, `genres`,
`minScaleLength`, `steps: ProgressionStep[]` — note the field is `steps`, not
`chords`, and `category` and `referenceScale` are required), is
tagged with the vibe's `variation.genre`, and must reproduce the vibe's current sound
exactly through `resolveProgression` — this phase is not permitted to change what the
chip sounds like, only where the data lives (contrast phase 2, where sound change is
explicitly allowed).

**Synth presets — coverage matrix, 3 roles × 6 genres.** Not a fixed preset count: the
requirement is that `synthPresetId`, `chordPresetId` and `bassPresetId` for every vibe
each resolve to a preset whose `category` fits the role (`bassPresetId` always into
`FACTORY_BASS_PRESETS`, category `Bass`; lead/comp draw from Lead, Pad, Keys, Pluck,
Brass or FX as the genre's timbre calls for). Where an existing preset in the 27-strong
library already fits a vibe's role and genre, the vibe references it; where none does,
phase 2's research adds one designed preset per gap, not per vibe — a gap can be shared
(e.g. one bright analog-lead preset can serve both `synthwave-80s` and `cyber-dance`'s
lead role if the research supports it). The exact preset set is phase 2 work, not
decided here; what is decided is the shape of the requirement — 18 role slots (6 vibes
× 3 roles), each resolved by id, each checkable against `category` alone, never against
a genre field on the preset.

**Drum patterns — 6 entries, one per vibe,** each the vibe's current authored
`kick`/`snare`/`hihat`/`openhat`/`clap`/`tom`/`crash` rows, moved verbatim into a new
library keyed by id (`drumPatternId`), matching today's authored 7×16 shape. `soundKit`
stays a separate field on `InstantVibe`, exactly as it is today (a drum pattern is a
rhythm; a sound kit is a timbre — decision 5 keeps them independently swappable even
though nothing today swaps `soundKit` per vibe). Phase 3 also carries the open question
below on this library's relationship to `GENRE_PRESETS`.

**Effect chains — 6 entries, one per vibe,** each the vibe's current authored
`effects` block (`reverbWet`, `reverbDecay`, `delayWet`, `delayFeedback`, optional
`distortionWet`, `compressorThreshold`, `eqLow`, `eqMid`, `eqHigh`), moved verbatim
into a new library keyed by id (`effectChainId`). `applyInstantVibeToStore`'s
`store.setEffects({ ...store.effects, ...vibe.effects })` spread becomes `...
store.effects, ...resolveEffectChain(vibe.effectChainId)` (mechanism only; no code in
this spec) — every effect chain remains a **partial** `MasterEffects`, since not every
vibe sets `distortionWet` today and that must not change.

## Invariants to enforce with tests

Pure-logic `bun:test`, no DOM, no testing-library — none may be added, per the repo's
testing convention: components export testable helpers and the `.test.tsx` file
imports those rather than rendering React.

1. Every id a vibe references resolves to a real entry in its respective library:
   `synthPresetId` / `chordPresetId` in `ALL_FACTORY_PRESETS`, `bassPresetId` in
   `FACTORY_BASS_PRESETS`, `progressionId` in `CHORD_PROGRESSIONS`, `drumPatternId` in
   the new drum-pattern library, `effectChainId` in the new effect-chain library,
   `chordRhythmId` in `RHYTHM_PATTERNS`, `bassPatternId` in `BASS_PATTERNS` — the
   superset of the variation engine's existing per-vibe resolution checks, extended to
   the three new singular ids.
2. Every vibe has all three synth roles filled — `synthPresetId`, `chordPresetId` and
   `bassPresetId` are each non-empty and each resolves to a preset whose `category` is
   plausible for its role (`bassPresetId` -> category `Bass`, always).
3. Every drum pattern's rows are exactly 16 steps long, numeric 0/1 only, and a pattern
   has exactly the 7 keys `kick, snare, hihat, openhat, clap, tom, crash` — no more, no
   fewer — the same shape check the variation engine's invariants already run against
   `DRUM_DENSITIES`, now also run against the new library's authored rows.
4. `applyInstantVibeToStore`'s cut-and-restart behaviour is preserved: the variation
   engine spec's existing non-regression tests (hard-stop call on `('chord', 0.02)` and
   `('bass', 0.02)`, restart-what-was-playing, resetClock once, chip stays highlighted)
   are re-run unchanged against the referencing version of `INSTANT_VIBES`, proving the
   refactor changed no runtime behaviour.
5. `VibeVariation` pools stay non-empty for every vibe: the existing invariants
   (`keyPool`, `bpmRange`, `progressionIds`, `rhythmIds`, `bassPatternIds`, and
   `drumDecoration.densities` per layer) continue to pass unmodified. This is inherited
   from the variation engine spec and must not regress once vibes are restructured to
   reference libraries — the restructuring touches the same file, and this phase must
   not touch `variation` data itself, only the fields that sit beside it.

## Four phases

Each phase ends with `bun run verify` and `bun run eslint` green, run separately,
before the next begins.

1. **Chords -> `progressionId`.** Add the 4 missing progressions to
   `CHORD_PROGRESSIONS`, give `synthwave-80s` and `asian-zen` a `progressionId`
   pointing at their existing entries, and replace all six vibes' inline `chords`
   arrays with `progressionId` + a call to `resolveProgression` at apply time.
   Smallest phase — the library already exists for two of six vibes — and it proves
   the reference-and-resolve pattern (add data, point an id at it, resolve at apply
   time, assert byte-identical sound) before the more expensive work in phases 2-4.
2. **Synth -> preset references.** Research-driven: this is the phase where the actual
   sound the user hears changes, because none of the 18 existing override objects is
   preserved as-is. Largest phase — it requires filling the 3×6 preset-role coverage
   matrix, adding designed presets for gaps the existing 27 do not cover, and replacing
   `synthParams` / `chordSynthParams` / `bassSynthParams` and `buildSynthParams`'s dead
   `presetName` parameter with `synthPresetId` / `chordPresetId` / `bassPresetId`
   resolved through the preset library — the point where `buildSynthParams` stops
   discarding the preset it is named after.
3. **Drums -> a drum-pattern library.** Move the six authored `drumPattern` blocks into
   a new library keyed by id, add `drumPatternId` to `InstantVibe`. Carries the open
   question below about its relationship to `GENRE_PRESETS`, settled during this
   phase's own planning, not guessed at now.
4. **Effects -> an effect-chain library.** Move the six authored `effects` blocks into
   a new library keyed by id, add `effectChainId` to `InstantVibe`. Smallest of the
   remaining phases — it benefits from the reference-and-resolve pattern the first
   three phases establish, since effect chains have no cross-cutting design question
   like drums do.

## One explicitly open question, deferred to phase 3

How does the new vibe drum-pattern library relate to the existing `GENRE_PRESETS`
(`src/audio/data/genrePresets.ts`)? Two candidate answers, neither decided here:

- **Two separate libraries with two separate jobs.** `GENRE_PRESETS` stays the
  sequencer's genre-button starter-pattern feature (12 genres, `kick snare hihat
  openhat clap tom bass`, boolean cells, `bass` a pitched track), consumed only by
  `SequencerView.tsx`'s genre dropdown; a new vibe drum-pattern library is authored
  independently for the six vibes (`kick snare hihat openhat clap tom crash`, number
  cells, no `bass` row, no `crash` on the sequencer side), consumed by vibe
  application. They already disagree on cell type, row set, and consumer, so they could
  simply stay separate.
- **One drum source feeds both**, with the sequencer's pitched `bass` row pulled out
  as its own concept layered on top of a shared kick/snare/hihat/openhat/clap/tom core,
  so a genre's rhythm data is authored once.

Measured input for whichever way phase 3 decides: 12 genres vs. 6 vibes with no 1:1
mapping (Trap, DnB, Dubstep, Techno, Funk, Rock and Reggae have no vibe; Zen and
Ambient have no `GENRE_PRESETS` entry); boolean vs. number cells; a row-set mismatch in
both directions (`bass` only on the sequencer side, `crash` only on the vibe side); and
a single current consumer each (`applyGenrePreset` in `SequencerView.tsx`,
`applyInstantVibeToStore` in `instantVibes.ts`) — nothing today reads both, so merging
them is not forced by any existing call site.

## Codebase constraints

- **Three-layer import rule, enforced by eslint `no-restricted-imports`:**
  `src/audio/` never imports `store/` or `components/`; `src/store/` never imports
  `components/` (store/ importing audio/ **is** allowed and already used —
  `src/store/instantVibes.ts` imports `audioEngine` from `../audio/engine`, and
  `src/store/vibeVariation.ts` imports from `src/audio/data/chordProgressions.ts`);
  `src/components/` must not import `audio/engine` (exceptions: `AudioVisualizer.tsx`,
  `TransportBar.tsx`, test files) — components reach audio only through
  `src/audio/playback/playbackEngine.ts`. A new store-side preset/drum/effect
  resolution module (e.g. an extension of `src/store/instantVibes.ts` or a sibling
  file), and new libraries living under `src/audio/`, may be read from
  `src/store/instantVibes.ts` — that direction is allowed — but must never import from
  `src/components/`.
- **Engine setters are never called from components.** This project adds no new engine
  calls of its own — it only changes what `buildSynthParams`/vibe-application *reads*
  (ids resolved into concrete values before the existing apply path runs), not the
  store->engine bridge in `src/store/engineSync.ts`.
- **`scripts/themeTokenGuard.ts`'s `ALLOWLIST` is empty and must stay empty.** This
  project is data/store-only and touches no UI, so it is not directly implicated — but
  whoever eventually builds a preset picker (choosing among the 27 factory presets by
  role) must obey the guard's rules on raw colours and Tailwind palette classes.
- **`deriveChordNotes` (`src/utils/musicTheory.ts:325`) stays the single source of
  truth for `ChordItem.notes`.** Unchanged by this project — `resolveProgression`
  calls through to it — so no chord ever gets a `notes` array built by a second code
  path.
- **`SCALES` degree counts vary — nothing may assume 7.** Concrete example: Hirajoshi
  has 5 degrees (`intervals: [0, 2, 3, 7, 8]`), same as B1's spec cites. The new
  `lofi-chill`, `cyber-dance`, `ambient-chill` and `hiphop-groove` progressions are all
  7-degree scales (Major, Natural Minor, Lydian, Dorian), so `minScaleLength: 7` is
  correct for all four; this must not be copied as a default for a future 5- or
  6-degree scale's progression. Any code this project adds that touches scale degrees
  must go through the existing `minScaleLength`-aware machinery B1 built, not a
  hard-coded 7.
- **Gate:** `bun run verify` (test + lint + check:keys + check:drums + build);
  `bun run eslint` is run separately, not part of `verify`, and must be run explicitly
  whenever imports move, which phases 1-4 all do.
- **`src/types.ts` must stay a zero-import leaf.** `InstantVibe`, `VibeVariation`,
  `DrumDecorationRule` and `DecorationLayer` already live there; this project's field
  renames on `InstantVibe` add no import to the file.

## No-users note

The app has no users yet, so persisted shapes and the store's `persist` version
(currently 3, `src/store/store.ts:274`) are not compatibility constraints for this
project. No migration and no version bump is required, even though `InstantVibe`'s
shape changes substantially (three `*Name` fields renamed to `*Id`, three new `*Id`
fields added, six inline data blobs replaced by references). Every new library id this
project introduces (progression, preset, drum-pattern, effect-chain ids) is free to be
chosen and renamed at will, since nothing external references them yet.

**Instant Vibe ids must not be renamed**, though, because `resolveSelectedVibeId`
(`src/components/InstantVibesBar.tsx:54`) resolves the currently-loaded vibe by
matching against `INSTANT_VIBES` by id, and the id/label drift between a vibe's id and
its display name is deliberate and protected by CLAUDE.md. The four drift pairs,
verbatim: `cyber-dance` -> "Cyber EDM", `ambient-chill` -> "Deep Ambient",
`hiphop-groove` -> "Boom Bap", `asian-zen` -> "Zen Garden". `lofi-chill` and
`synthwave-80s` have no drift — their ids match their display names.

---

## Phase 2 settled — the preset matrix, the arp removal, and the resolved `InstantVibe` shape

Appended 2026-08-26, after Phase 1 landed. The "Inventory" section above deferred the
preset set ("The exact preset set is phase 2 work, not decided here"). This section
records what Phase 2's research and review settled, so the deferral is closed. Nothing
above is retracted except the one correction marked in "Target shape".

### The 18 role slots, resolved

16 of the 18 slots resolve to a preset that already exists in the 27-entry library.
Two do not, and two new presets are authored for them. No preset is authored per vibe;
each new preset exists because a specific slot has no adequate candidate.

| vibe | lead — `synthPresetId` | comp — `chordPresetId` | bass — `bassPresetId` |
| --- | --- | --- | --- |
| `lofi-chill` | `factory-dream-keys` (Keys) | `factory-mellow-epiano` (Keys) | `bass-deep-sine` (Bass) |
| `synthwave-80s` | `factory-hyper-saw-lead` (Lead) | `factory-neon-poly-saw` (Pad, **new**) | `bass-saw-growl` (Bass) |
| `cyber-dance` | `factory-pluck` (Pluck) | `factory-trance-pluck` (Pluck) | `bass-punchy-square` (Bass) |
| `ambient-chill` | `factory-celestial-shimmer` (Pad) | `factory-warm-polypad` (Pad) | `bass-deep-sine` (Bass) |
| `hiphop-groove` | `factory-mellow-epiano` (Keys) | `factory-fm-tine-piano` (Keys) | `bass-round-pluck` (Bass) |
| `asian-zen` | `factory-glocken-bell` (Keys) | `factory-koto-pluck` (Pluck, **new**) | `bass-warm-tri` (Bass) |

All six bass slots resolve to `category === 'Bass'`, which is the one hard category
constraint the "Target shape" section names. The lead and comp slots draw from Keys,
Lead, Pad and Pluck; no slot needs Brass or FX.

Two presets serve two slots each. `factory-mellow-epiano` is `lofi-chill`'s comp and
`hiphop-groove`'s lead — both Rhodes-comping genres, and the two slots differ in role,
register and rhythm. `bass-deep-sine` is `lofi-chill`'s bass and `ambient-chill`'s bass.
Reuse is intended, not a shortfall: the inventory requirement is one suitable preset per
role slot, not one preset per slot.

### The two new presets, and why each gap is real

**`factory-neon-poly-saw` (Pad) — `synthwave-80s` comp.** No existing preset covers a
detuned-saw poly bed that survives 8th-note stabs at 118 BPM. `factory-string-ensemble`
has the right oscillator and detune but `attack: 0.35`, longer than the 0.25 s eighth
note it would have to articulate. `factory-vintage-brass` is the right family but its
`lfoTarget: 'volume'` tremolo at 5 Hz beats against a grid-tight (`chordFeel: 0.12`)
pattern. `factory-hyper-saw-lead` is the vibe's own lead and its 3800 Hz cutoff would put
the comp on top of it. `factory-warm-polypad` is triangle at cutoff 1400 — wrong
oscillator, far too dark. The new preset is a Juno-style saw at `detune: 15` with
brightness supplied by `filterEnvAmount: 1200` over `filterCutoff: 2600`, so the comp
opens per note and stays under the lead between attacks, and `release: 0.5` (longer than
the 0.25 s note gap) glues consecutive stabs into a bed.

**`factory-koto-pluck` (Pluck) — `asian-zen` comp.** The slot needs a mid-register
plucked string that rings for roughly a bar (~3.1 s at 78 BPM). The two existing Pluck
presets die far too fast (`factory-pluck` `decay: 0.15` / `sustain: 0.05`;
`factory-trance-pluck` `decay: 0.18` / `sustain: 0.02`). `factory-glocken-bell` has the
decay length but is a bell at `octave: +1`, and it is already this vibe's lead.
`factory-dream-keys` is a held key with no attack transient. The new preset combines a
near-instant `attack: 0.004` with `noiseVolume: 0.04` for the pick contact, a large
`filterEnvAmount: 2200` collapsing to `filterSustain: 0.12` for the fast partial damping
of a plucked string, and `decay: 1.3` / `sustain: 0.35` / `release: 1.5` for the residual
ring the existing plucks lack.

Both are authored with `octave: 0` and neither carries any arp field.

### `bass-drone-sub` was proposed and rejected

Phase 2 research proposed a third new preset, `bass-drone-sub`, for `ambient-chill`'s
bass, on the grounds that `bass-deep-sine`'s `release: 0.6` leaves a gap between
whole-note drone roots at 68 BPM. It is not adopted. `ambient-chill` runs
`reverbDecay: 5.8` and `delayFeedback: 0.58`, which manufacture the tail the release was
meant to supply; on a pure sine sub there are no harmonics for a 0.01 s attack to click
with. `ambient-chill`'s bass slot resolves to `bass-deep-sine`, the same preset
`lofi-chill` uses. Adding a preset to close a gap the effect rack already closes is
inventory for its own sake.

### Four slots are deliberate redesigns

The remaining fourteen slots land within earshot of today's hand-authored voice.
Four are a changed instrument, accepted under settled decision 2 ("the sound may
change, provided what lands in the libraries is researched, principled data"):

- **`lofi-chill` comp → `factory-mellow-epiano`.** Today's voice is a sine with a 1.5 Hz
  pitch vibrato — a tape wow. The genre's actual comping instrument is a Rhodes with
  amplitude tremolo, which is what `factory-mellow-epiano` is (4.5 Hz on `volume`). The
  wow moves to the lead, where a melody line is where it is audible; the vibe's own
  `eqHigh: -2` supplies the cassette roll-off the old 2200 Hz cutoff did by hand.
- **`cyber-dance` comp → `factory-trance-pluck`.** Today's supersaw stab holds
  `sustain: 0.35` on `offbeatStabs`, so each offbeat bleeds into the next kick.
  A plucked offbeat chord (`sustain: 0.02`, `filterEnvAmount: 3000`) clears the
  downbeat, which is why the genre uses one. This is the most audible single change in
  Phase 2.
- **`ambient-chill` comp → `factory-warm-polypad`.** Today the comp and the lead are the
  same patch — the clearest symptom of the half-override problem. Moving the shimmer up
  to the lead (`factory-celestial-shimmer`, `octave: +1`) leaves the comp needing a warm
  mid-register bed, which `factory-warm-polypad` is. Its shorter `release: 1.2` is
  covered by the vibe's own reverb and delay.
- **`asian-zen` lead → `factory-glocken-bell`.** Today's lead is a keyed triangle
  (`sustain: 0.35`, `decay: 1.1`) sitting in the same register as the comp. A struck
  bell is the instrument class the genre and the vibe's own comment ("Pentatonic Bell
  Arp") always named, and `factory-glocken-bell`'s `octave: +1` separates the lead from
  the new koto comp at `octave: 0` — which matters more now that the comp is a plucked
  string rather than a keyed tone. Its `sustain: 0.05` means a held note rings out and
  dies instead of droning, which is what a sparse pentatonic melody over a slow bed
  wants.

No fallback is retained for any of the four. Each row is decided, not offered.

### Arp is removed from Instant Vibes entirely

No preset in `synthPresets.ts` or `bassPresets.ts` sets `arpActive`, `arpMode`, `arpRate`
or `arpOctaves` — zero occurrences across all 27 entries. Three vibes turn the
arpeggiator on today, and in every case it is on the **lead** voice (`synthParams`, which
`applyInstantVibeToStore` writes through `store.setSynthParams`), never the comp or the
bass: `synthwave-80s` (`updown`, `16n`, 2 octaves), `cyber-dance` (`up`, `16n`, 2),
`asian-zen` (`up`, `8n`, 2). Every other voice in every vibe sets `arpActive: false`
explicitly, which is identical to the `INITIAL_SYNTH_PARAMS` default.

Phase 2 drops all of it. Arp is a performance setting the user drives from the UI —
`src/audio/playback/arpPlayback.ts` reads `params.arpActive` off whichever voice the
user's `controlTarget` selects and arpeggiates notes the user is physically holding on
the QWERTY keyboard; nothing in the chord or bass players consults it. A vibe should not
switch that on behind the user's back, and baking it into a preset would be worse still,
dragging the setting along every time the preset was reused for another role.

So **`InstantVibe` carries no arp data at all**: no `synthArp` field, no arp members
inside any voice. `INITIAL_SYNTH_PARAMS.arpActive` is already `false`
(`src/store/initialState.ts:26`), and the resolver's merge begins from
`INITIAL_SYNTH_PARAMS`, so a vibe that sets no arp fields leaves the arp off. No explicit
`arpActive: false` is needed anywhere in the vibe table.

`synthwave-80s`, `cyber-dance` and `asian-zen` therefore lose the arpeggio they turn on
today. That is intended, and is a sanctioned sound change under settled decision 2.
Two pieces of authored copy assert the old behaviour and become false with it, so Phase 2
corrects both: `cyber-dance`'s tagline ("…punchy kicks & arps") and the comment above
`synthwave-80s`'s `variation.keyPool`, which justifies the pool's upper bound by the
arp's octave range. The `keyPool` data itself is `variation` data and is not touched —
only the comment that explains it.

### "Target shape" needs no correction

The `InstantVibe` block in the "Target shape" section above already reflects Phase 2
exactly: it lists `synthPresetId`, `chordPresetId` and `bassPresetId`, and it lists no
`synthParams` / `chordSynthParams` / `bassSynthParams` and no arp field. Phase 2 adds
nothing to that block and removes nothing from it. The three `*PresetName` fields and the
three `*SynthParams` fields that exist in today's `InstantVibe` are deleted outright.

### `buildSynthParams` after Phase 2

`buildSynthParams(presetName, overrides)` today stamps a display string into `preset`
while the literal override object beside it supplies the whole sound. It is replaced by a
resolver that takes a preset id and nothing else:

```ts
function resolveVibeSynthParams(presetId: string): SynthParams
```

which merges `INITIAL_SYNTH_PARAMS`, then the resolved preset's `params`, then
`preset: presetItem.name`. The arp block falls through from `INITIAL_SYNTH_PARAMS` in
every case, so every voice of every vibe loads with `arpActive: false`. The three call
sites in `applyInstantVibeToStore` stay exactly where they are, so the ordered audio cut
and selective restart the function performs is untouched (settled decision 6); only the
arguments change shape.

`preset: presetItem.name` is deliberate and load-bearing: `ChordView.tsx`'s preset
selects bind to `params.preset`, so after Phase 2 a loaded vibe leaves those selects
pointing at the preset that actually produced the sound — which is exactly what
`buildSynthParams` never did.

Lookup needs a by-id accessor, which the library does not currently export
(`findPresetByName` is name-keyed). Phase 2 adds `presetById(id)` to
`src/audio/synthPresets.ts`, searching `ALL_FACTORY_PRESETS`.

### Phase 2 invariants to enforce with tests

Pure-logic `bun:test`, no DOM, no testing-library — the same convention the
"Invariants to enforce with tests" section above states.

1. Every `synthPresetId` and every `chordPresetId` on every vibe resolves to an entry in
   `ALL_FACTORY_PRESETS`.
2. Every `bassPresetId` resolves to an entry whose `category === 'Bass'`.
3. All preset ids in `ALL_FACTORY_PRESETS` are unique — a duplicate id would make
   `presetById` silently return the wrong sound.
4. No preset's `params` sets `arpActive`, `arpMode`, `arpRate` or `arpOctaves`, in either
   `FACTORY_PRESETS` or `FACTORY_BASS_PRESETS`. This invariant stands unchanged and is
   still worth pinning: it is what keeps arp a performance setting rather than timbre
   data, and it stays true as users author their own presets.
5. Applying any vibe leaves all three voices with `arpActive === false` — no vibe turns
   the arpeggiator on. Asserted over `synthParams`, `chordSynthParams` and
   `bassSynthParams` for all six vibes.
6. `applyInstantVibeToStore`'s cut-and-restart behaviour is unchanged — the existing
   non-regression tests (`stopSource('chord', 0.02)` / `stopSource('bass', 0.02)` before
   the first vibe-state write, restart-what-was-playing, chip stays highlighted) re-run
   unmodified against the referencing version of `INSTANT_VIBES`.

Invariants 1-3 hold for user-created presets too as the library grows, which is why they
are stated over `ALL_FACTORY_PRESETS` and `category`, never over any genre concept —
settled decision 3 is unaffected by anything in this section. Neither new preset carries
a genre tag; `category` remains a timbre role.

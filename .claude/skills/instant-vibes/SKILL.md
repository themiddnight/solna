---
name: instant-vibes
description: Add, remove, retune or debug an Instant Vibe in solna — the genre chips in the top bar (Lo-Fi Chill, Synthwave 80s, Cyber EDM, Deep Ambient, Boom Bap, Zen Garden) and the dice that rerolls them. Carries a survey-first workflow, the six library ids a vibe resolves, the computed dice-pool rule, and the invariant tests that pin exact counts and id sets — two of which fail silently. Also covers changing a vibe's chords, synth voices, drum decoration, key pool or BPM range, and failures in instantVibes / vibeVariation / instantVibesProgressions tests.
---

# Instant Vibes (solna)

A vibe is the genre chip in the top bar. Clicking it rewrites the whole project;
the dice beside it rerolls into different music in the same genre.

The table lives in **`src/store/instantVibes.ts`** (`INSTANT_VIBES`, six entries at
lines 126, 201, 279, 354, 428, 505). `applyInstantVibeToStore` in the same file
writes a vibe into the store.

## Start by surveying, not by writing

A vibe is assembled from libraries, so the first question is what those libraries
already hold. One call answers it:

```bash
bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts            # all genres
bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts synthwave  # one genre, in full
```

It prints the genre's fixed scale, its exact dice pool (copy that verbatim), which
of those progressions have the 4 steps a vibe's own `progressionId` needs, every
preset by category with its timbre-defining parameters, what the existing vibes use,
and the comp-rhythm and bass-pattern ids.

Then decide, in this order:

1. **Does an existing progression fit?** It must be tagged with the genre and have
   exactly 4 steps. Reuse is the normal answer — a genre pool is deliberately shared.
2. **Do three existing presets fit the lead, comp and bass roles?** Bass must be
   `category: 'Bass'`; lead and comp are judged by ear.
3. **Only if something genuinely does not exist**, author it — read
   `references/authoring-libraries.md` first. It carries the gap test ("name the
   closest candidate and say what disqualifies it"), the seventh-chord trap that
   silently downgrades progressions to triads, the genre convention rules, and the
   engine facts that decide whether a preset's numbers are audible at all.

Authoring the library entry before the vibe keeps the vibe from ever pointing at
something that does not exist yet.

## What a vibe is now

Chords and synth voices are **references into shared libraries**, not authored data.
Drums and effects are still authored inline — those library migrations are planned
but unbuilt (`docs/superpowers/specs/2026-08-26-vibe-as-references-design.md`,
phases 3-4). So a vibe today is: identity fields, six library ids, a few scalars,
one inline drum pattern, one inline effects block, one `variation` rule.

| field | resolves through | hard constraint |
|---|---|---|
| `progressionId` | `progressionById` → `CHORD_PROGRESSIONS` | must have **exactly 4 steps** |
| `synthPresetId` (lead) | `presetById` → `ALL_FACTORY_PRESETS` | any category |
| `chordPresetId` (comp) | `presetById` | any category |
| `bassPresetId` | `presetById` | **`category === 'Bass'`** |
| `chordRhythmId` | `RHYTHM_PATTERNS` | — |
| `bassPatternId` | `BASS_PATTERNS` | — |

Bass is a hard category constraint because register is physics, not taste. Lead and
comp are judged by ear against the genre — there are deliberately **no genre tags on
presets**, and adding one is a rejected design (see the spec's settled decision 3).

`chords` is a *computed* field, never typed out:

```ts
chords: resolveProgression(progressionById('lofi-morning-turnaround')!, 'C', 'Major', 4),
```

The three arguments must equal the vibe's own `scaleRoot`, `scaleType` and
`chordOctave`. They are written as plain literals rather than sibling references
because every other field in these objects is a plain value — but a mismatch changes
what the vibe sounds like without changing `progressionId`, so check them.

## Genre decides the scale — you do not

`scaleType` is not a free choice. It must equal `VIBE_GENRE_SCALES[variation.genre]`
(`src/audio/data/chordProgressions.ts:64`), and an invariant test recomputes it:

| genre | scaleType |
|---|---|
| `lofi` | Major |
| `synthwave` | Natural Minor |
| `edm` | Natural Minor |
| `ambient` | Lydian |
| `boombap` | Dorian |
| `zen` | Hirajoshi |

Scale type is genre identity, which is also why the dice never rerolls it.

## `progressionIds` is a computed set, not a taste call

The dice pool is the **complete** genre-and-scale-length filter over the library.
Picking a subset you like fails `'progressionIds equals the full genre-and-scale-length filter'`.
Compute it rather than curating it:

```bash
bun -e "
const {CHORD_PROGRESSIONS}=await import('./src/audio/data/chordProgressions.ts');
const {SCALES}=await import('./src/utils/musicTheory.ts');
const genre='lofi', scaleType='Major';
console.log(JSON.stringify(CHORD_PROGRESSIONS
  .filter(p=>p.genres.includes(genre) && p.minScaleLength<=SCALES[scaleType].intervals.length)
  .map(p=>p.id)));
"
```

This also means **adding one progression to the library retags four vibes' pools** —
that is the point of the test, not a nuisance.

## The dice must be able to land on the vibe as authored

`'the dice can always land back on the vibe as authored'` pins all five:
`keyPool` contains `scaleRoot`; `bpmRange` contains `bpm`; `rhythmIds` contains
`chordRhythmId`; `bassPatternIds` contains `bassPatternId`; `progressionIds`
contains `progressionId`.

Give every pool **≥2 members**. The tests only assert non-empty, so a one-member
pool passes — but `pickDistinct` falls back to the current value when it is the sole
member, so that layer silently stops rerolling. Today's authored minimum is 2
(`ambient-chill` and `asian-zen` bass pools); keys are 5-6 and rhythms 3.

## Drum decoration is the fiddliest part

`variation.drumDecoration` rewrites only `hihat`, `openhat`, `tom`, `crash`
(`DecorationLayer`) — `kick`, `snare` and `clap` are the genre skeleton and are not
assignable to the type, so they can never be rerolled. Four rules bite:

1. **All seven rows must be authored** on `drumPattern`, each exactly 16 numeric
   0/1 steps. Re-clicking a chip restores the authored pattern only because a
   reroll merges over a complete row set.
2. `densities` keys must equal `layers` **exactly** — no extras, no omissions.
3. Every `openhat` and `tom` candidate that shares a step with this vibe's `kick`
   is dropped by the collision filter, and at least one must survive. Cross-check
   your kick row against `DRUM_DENSITIES` before choosing candidates.
4. `'the filter removes exactly one candidate across all authored data'` is a
   **global count** across every vibe — see the test section below.

## Tests that pin exact counts or sets

Two kinds, and the difference matters more than the list.

**These fail loudly.** You cannot miss them; the gate stops you:

| file:line | what it pins |
|---|---|
| `src/store/instantVibes.test.ts:11` | `INSTANT_VIBES.length` is 6 |
| `src/store/instantVibes.test.ts:112` | the 6×3 preset matrix, id by id |

**These fail silently — the real hazard.** They iterate their own hard-coded
`VIBE_IDS` list rather than `INSTANT_VIBES`, so a seventh vibe passes the whole gate
while being covered by none of them:

| file | what silently stops covering your vibe |
|---|---|
| `src/store/instantVibesProgressions.test.ts:6` | that `progressionId` resolves, and that `chords` really is its resolved output |
| `src/store/instantVibesChordsFixture.ts` | the independent chord snapshot behind that proof |

Add your vibe's id to `VIBE_IDS` and its chords to the fixture. A green gate is not
evidence you did — verified by adding a seventh vibe without touching either: 568
tests, 0 failures, and the new vibe unproven.

The fixture deliberately imports nothing from `instantVibes.ts` — that independence
is what makes it a proof rather than a tautology. Extend it by hand; never make it
read the vibe table.

One more that *may* fire: `'the filter removes exactly one candidate across all
authored data'` in `vibeVariation.test.ts` is a global count across every vibe. It
holds if your `openhat`/`tom` candidates avoid your `kick` steps, which is worth
aiming for anyway — but if you do collide deliberately, update the number rather
than deleting the test. It is what makes a later kick edit that quietly empties a
pool visible.

## Two things a vibe must not carry

- **No arp.** No vibe sets `arpActive`/`arpMode`/`arpRate`/`arpOctaves`, and no
  preset does either. The arpeggiator is a performance control the user drives from
  the UI, and a vibe must not switch it on behind them.
  `INITIAL_SYNTH_PARAMS.arpActive` is already `false`, so simply omit the fields —
  never write an explicit `arpActive: false`.
- **No presentational fields.** `color`, `bgGradient`, `borderColor`, `textColor`
  are forbidden; the chip's look comes from theme tokens (see `docs/design.md`).

## Never touch `applyInstantVibeToStore`

It runs `store.hardStopAll()`, then a synchronous `audioEngine.stopSource('chord',
0.02)` / `stopSource('bass', 0.02)` cut **before the first vibe-state write**, then
restarts only the players that were active. Two real overlapping-audio bug fixes
live in that ordering (`d8df714`, `c4a253a`). Adding a vibe is pure data — the
function does not change. Non-regression tests pin the ordering.

## Adding a new genre is four coordinated edits

`VibeGenre` is a closed union (`src/types.ts:8`), and a new one needs an anchor
scale plus **at least four** progressions tagged with it before any test passes.
`references/authoring-libraries.md` has the full procedure.

Reach for it only when an existing genre genuinely cannot host the vibe. Genre here
means "which progressions may this vibe draw", not a marketing label — a slower,
moodier entry inside an existing genre is usually the honest answer, and it inherits
a tested pool.

## Order of work

1. Survey (`scripts/vibe-inventory.ts`) and decide what, if anything, is missing
2. Author only the genuinely missing library entries, with their tests —
   see `references/authoring-libraries.md`
3. The vibe literal, with `chords` resolved from `progressionId`
4. `variation`, with `progressionIds` computed by the snippet above
5. Update the loud tests, then the silent ones — `VIBE_IDS` and the chord fixture
   are the two the gate will never remind you about
6. `bun run verify`, then `bun run eslint` separately

## Gate

`bun run verify` (test + lint + check:keys + check:drums + build). Run
`bun run eslint` **separately** — it is not part of `verify` — whenever imports move.

## Bundled with this skill

- `scripts/vibe-inventory.ts` — what the libraries hold, per genre
- `references/authoring-libraries.md` — read when the survey found a real gap

Related skills: `dsp-audio` before touching the engine or effect routing,
`music-theory` before touching scales, chord generation or bass/rhythm patterns.

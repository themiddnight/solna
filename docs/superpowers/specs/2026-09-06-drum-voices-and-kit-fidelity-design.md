# Drum Voices and Kit Fidelity — Design

Date: 2026-09-06
Status: Draft — all owner decisions settled and folded in (eleven voices, thirteen named kits,
`DrumKit.reference`, one hi-hat choke group, optional grid rows, `--color-drum-*` track colours,
and the four-slice order).

## This spec supersedes the old Part 2 plan

**`docs/superpowers/plans/2026-09-06-drum-grid-genre-accuracy-part2.md` is superseded and must not
be executed.** That plan implemented items 13–15 of
`docs/superpowers/specs/2026-09-06-drum-grid-genre-accuracy-design.md`: add `ride` and `bell`, move
two smuggled rows onto them, done. Everything it says about *mechanism* is still true — a voice is
a params interface, a default, per-kit overrides and a `case` in `triggerDrum`, and tuning rather
than typing is the bulk of the work. What changed is the *scope and the order*, on four counts:

1. **Two voices became four new ones and a rename.** `rimshot` outranks both of the planned voices
   on the evidence (`2026-09-06-genre-drum-voice-selection.md` §5: seven genres, and in four of
   them it *is* the backbeat), and the `tom` → `hitom`/`lowtom` split was not in that plan at all.
2. **`crash` is kept.** The old plan inherited a `ride`-replaces-`crash` framing; the research
   (`genre-drum-voice-selection.md` §6) shows rock and drum & bass need an accent *and* a
   timekeeper, which are different jobs.
3. **Values come before voices.** Three of the four synthesis research documents conclude that the
   library's largest audible losses are mis-tuned parameters and one-line engine omissions, not
   missing voices. Shipping voices first would have tuned twelve kits against a baseline we already
   know is wrong.
4. **A voice is now four things, not two.** `DRUM_ALIASES` deletions, sequencer tracks, theme
   colours and two migration chains all scale with the number of voices, and eleven voices exceed
   the eight semantic theme tokens — a trap the Part 1 spec named in its item 11 and left open.

Part 1 of the drum-grid work (`…-drum-grid-genre-accuracy-design.md`) is **not** superseded. It has
landed, and this spec builds on it: 30 grids, `DrumGrid.provenance`, `replaceDrumPattern`,
`withDrumTracks`, seven sequencer tracks, persist `version: 13`, `PROJECT_FORMAT_VERSION` 5.

## Evidence base

Four research documents, cited by section throughout and **not restated here**:

- `docs/research/2026-09-06-drum-synthesis-hats-and-cymbals.md` — the metallic oscillator bank, the
  choke, ride vs crash, bell.
- `docs/research/2026-09-06-drum-synthesis-kick-snare-clap-toms.md` — kick pitch envelopes, the
  snare's two body oscillators (and therefore the rimshot), the clap's burst schedule, the tom
  split.
- `docs/research/2026-09-06-drum-kit-identities.md` — what each kit refers to, how far it is
  reachable, and §5's naming-honesty argument.
- `docs/research/2026-09-06-genre-drum-voice-selection.md` — which voices each genre plays, which
  kit each grid should carry, and the ranked list of voices we do not have.

**Every count in this spec was measured by evaluating the data on this branch (`bun` against
`src/data/*.ts`) or by reading the named source line — never by grepping for a count.** Where a
measurement disagrees with a research document or with a settled decision's supporting number, the
disagreement is recorded in place rather than smoothed over.

## Goal

**Give the drum library the voices its own grids are already trying to play, and make every kit
name an honest claim about a reachable sound.**

Two halves, and they are not the same problem:

- **Voices.** Eleven, replacing seven. Four genres in this library name a timekeeper that has no
  row (`genre-drum-voice-selection.md` §3), and three of them need it to sound *at the same time as*
  the hi-hat. Adding rows is the difference between stating a rhythm and playing an idiom.
- **Fidelity.** No kit scores above 3.0 out of 5 against its referent today
  (`drum-kit-identities.md` §5.2), and the two named after real machines are not in the top half.
  Some of that gap is bad tuning, some is a capability wall, and the point of the slice order below
  is that we find out which is which *before* we spend a tuning pass on eleven voices.

## Context — what was measured

All numbers below were produced on this branch by evaluating `DRUM_GRIDS`, `DRUM_KITS` and
`DEFAULT_DRUM_KIT`, or by reading the cited line.

### The library has 30 grids, 12 named kits and 7 playable voices

| row | grids that declare it |
|---|---|
| kick, snare, hihat, openhat, clap, tom | 30 each |
| bass | 23 |
| crash | 8 |

`crash` fires at **step 0 and nowhere else** in all eight grids that declare it. `bass` carries
**53 authored hits across 23 rows** and cannot sound: `DRUM_KITS` defines seven voices and
`triggerDrum` has seven cases, none of them `bass`.

### Three measured facts that decide the voice roster

1. **The `tom` we have is a low tom.** Across the 13 merged kit entries (`DEFAULT_DRUM_KIT` plus
   12 named), `tom.freqEnd` spans **65–110 Hz** and `freqStart` spans **120–180 Hz**. The TR-808's
   low tom centres at 90 Hz and its high tom at 185 Hz
   (`drum-synthesis-kick-snare-clap-toms.md` §4.1). There is no high tom in the kit.
2. **The "High Tom" pad is a lie the code already tells.** `DEFAULT_PADS`
   (`src/components/ui/DrumPadGrid.tsx:24`) has `{ id: 'hightom', note: 'tom', pitch: 4 }`, and
   `triggerPad` (`src/audio/playback/drumPlayback.ts:19`) is
   `audioEngine.triggerDrum(instrument, volume, time)` — **`pitch` is never read by anything.**
   The High Tom pad plays the identical low tom.
3. **`ride` is an alias for `crash`.** `DRUM_ALIASES` (`src/audio/engine.ts:92–96`) is exactly
   `{ closedhat: 'hihat', lowtom: 'tom', ride: 'crash' }`, resolved *before* the switch at
   `engine.ts:1678`. Every ride hit in the app today is a crash.

### The kick, the clap and the snare are mis-tuned in ways nothing checks

- **`kick.pitchTime`.** `Sub Weight` glides for **0.35 s under a 0.60 s decay — a ratio of 0.583**,
  so 58% of the note is a falling pitch; `Trap Beat` is 0.462. The 808's own sweep is over in ~6 ms
  (`…kick-snare-clap-toms.md` §1.2), and the same section's operational rule puts everything above
  `pitchTime / decay > 0.3` in the "smeared — usually a mistake" band. **Nine of the twelve named
  kits sweep longer than 50 ms; the other three sit exactly at 50 ms, and `DEFAULT_DRUM_KIT` is at
  120 ms.** So of the 13 merged entries, **10 exceed 50 ms and all 13 are at or above it.**

  > **Measured correction to a supporting number.** The settled decision was written as "10 of 12
  > kits sweep longer than 50 ms". Measured, that is **10 of 13 entries** (counting
  > `DEFAULT_DRUM_KIT`) or **9 of 12 named kits**. The decision — retune `kick.pitchTime` in slice 1
  > — is unaffected: no entry in the library is anywhere near the ~6 ms figure, and the three at
  > exactly 0.05 s still want retuning by the `pitchTime ≤ 0.1 × decay` rule.

- **The clap's loudest burst is its last.** `engine.ts:1732–1735` schedules, over `drumEnv`'s
  opening `setValueAtTime(peak)`: `setValueAtTime(peak * 0.25, t + 0.012)` then
  `setValueAtTime(peak * 1.1, t + 0.024)`. `setValueAtTime` **holds** a value, so the envelope is
  three plateaus at 1.0, 0.25 and 1.1 — not three bursts. A real machine clap is three *decaying*
  bursts at 10–11 ms plus a distinct tail (`…kick-snare-clap-toms.md` §3.2).

- **`snare.bodyTime` is `0.08` in all 13 entries.** It has never been tuned; `check:drums` does not
  look at it. Its sibling axis is worse off than the research recorded: measured,
  `noiseGain / bodyGain` spans **0.87 (Lo-Fi Vinyl) to 2.00 (Trap Beat)**, where
  `…kick-snare-clap-toms.md` §2.3 wants 0.7–2.8 and §5 A4 quotes today's span as 1.2–2.0. The
  measured floor is lower than the research states; the ceiling matches.

- **Only 4 of 13 entries have a kick click at all** — `909 Modern`, `Chrome Pulse`, `Warehouse`,
  `Acoustic Studio`. The other nine kicks have no attack except the `drumEnv` discontinuity.

### The engine leaves parameters on the table that it already supports

- `drumNoiseBurst` (`engine.ts:1624`) accepts `q`. **`crash` passes `q: 0.8`; `hihat`, `openhat`
  and `snare` pass none** and take the default 1.
- `hihat` and `openhat` pass **no `reverbSend`** and are highpass-only, with no upper corner.
- **`KickParams` and `TomParams` have no `reverbSend` field, and `drumTone` never passes one.**
  Measured across all 13 entries: no kick object carries the key.
- Because the hat filter is a **highpass**, `Lo-Fi Vinyl`'s 3500 Hz — the lowest corner in the
  library — passes everything from 3.5 kHz to Nyquist, making it the **fullest and brightest** hat
  in the set. The kit whose whole identity is 12-bit fold-back has the least filtered hat.

### `check:drums` cannot see most of this

`scripts/check-drum-kit-separation.ts` runs two checks: every kit overrides every voice by ≥1
parameter, and eight **aggregate** spreads — `hihat.filter` 2.5×, `kick.decay` 3×, `kick.freqEnd`
1.5×, `snare.noiseFilter` 2.8×, `snare.bodyFreqEnd` 1.5×, `clap.filter` 1.8×, `openhat.filter` 2.2×,
`crash.filter` 1.5×. It never tests `hihat.decay`, `hihat.gain`, `snare.bodyTime`,
`kick.pitchTime` or `kick.clickLevel`, and being aggregate it cannot see that two named kits are
twins. Measured spreads it does not assert: `hihat.decay` 0.030–0.060 (2.0×), `hihat.gain`
0.25–0.40 (1.6×).

### Three vibes name a kit that does not exist, and the fix is not an invention

Measured: `cyber-edm` → `'Hyperpop 2000'`, `deep-ambient` → `'Minimal Glitch'`, `zen-garden` →
`'Minimal Glitch'`. None is a key of `DRUM_KITS`, so `mergeDrumKit` returns `DEFAULT_DRUM_KIT` and
three vibes silently ship the fallback. `drumGrids.test.ts:116–124` guards grid→kit;
`store/vibes.test.ts:29` asserts only that `soundKit` is truthy.

**The library already has a convention, and it is exactly the five vibes that work:**

| vibe | `drumGridId` | that grid's `kit` | `soundKit` |
|---|---|---|---|
| lofi-chill | lofi-half-time-brush | 808 Vintage | 808 Vintage |
| synthwave-80s | synthwave-four-on-floor | Retro Drive | Retro Drive |
| boom-bap | boombap-swung-break | 808 Vintage | 808 Vintage |
| lofi-waltz | waltz-brush-three | Lo-Fi Vinyl | Lo-Fi Vinyl |
| afro-six-eight | afro-six-eight-bell | Acoustic Studio | Acoustic Studio |
| **cyber-edm** | house | **909 Modern** | **Hyperpop 2000** ✗ |
| **deep-ambient** | ambient-sparse-drift | **Warehouse** | **Minimal Glitch** ✗ |
| **zen-garden** | zen-bamboo-pulse | **Acoustic Studio** | **Minimal Glitch** ✗ |

Every vibe whose `soundKit` resolves names the kit its own grid names. The three that do not are
the three that are broken. That is what makes decision 5 a repair rather than three new sound
decisions.

### The hi-hat rows say something one hi-hat cannot do

Measured across the 30 grids: **33 steps in 18 grids have `hihat` and `openhat` both true.** A
hi-hat is one physical instrument — the closure *is* the damping
(`…hats-and-cymbals.md` §4.1) — so those 33 steps are a transcription artefact, not an authored
layer. This is why decision 20 must land before decision 28.

### Eleven tracks against eight semantic tokens

`INITIAL_SEQUENCER_TRACKS` (`src/store/initialState.ts:45`) has seven tracks using `bg-error`,
`bg-warning`, `bg-success`, `bg-accent`, `bg-secondary`, `bg-primary`, `bg-info`. **`bg-neutral` is
the only non-surface `THEME_TOKENS` entry left.** Eleven tracks cannot each hold a distinct
semantic token; the Part 1 spec named this trap in its item 11 and left it as its open question 4.
Decision 11 answers it.

---

## The contract — what the library looks like when all four slices have landed

These decisions span slices. They are stated once, here, and the slices below implement them.

### 1. Eleven drum voices, in this order

```
kick  snare  rimshot  clap  hihat  openhat  hitom  lowtom  ride  crash  bell
```

The order is the canonical one: it is the order of `INITIAL_SEQUENCER_TRACKS`, of the `DrumKit`
interface's fields, of the `triggerDrum` switch, of `DEFAULT_PADS`, and of the colour families in
decision 11. **One order, written down once, so a reviewer comparing any two of those five lists is
comparing sorted lists.**

Why each of the four new ones, with the evidence:

- **`rimshot`** — the highest-value missing voice by both count and severity
  (`genre-drum-voice-selection.md` §5 rank 1). Seven genres use it; in reggae, jazz waltz, Afro 6/8
  and lo-fi hip-hop it **is** the backbeat, currently faked on `snare`, so those grids get a loud
  crack where the idiom wants a dry woody click.
- **`hitom` / `lowtom`** — `tom` is renamed, not split in place, because measurement says today's
  tom already *is* a low tom (context, fact 1). A descending fill is not expressible with one tom,
  and the High Tom pad has been pretending otherwise (fact 2).
- **`ride`** — the timekeeper for jazz waltz, drum & bass and rock-in-chorus
  (`genre-drum-voice-selection.md` §3). It ships with a single `ping` parameter crossfading a ping
  component against a wash component, per `…hats-and-cymbals.md` §3 — **one voice with one
  parameter, not two voices.**
- **`bell`** — essential for Afro 6/8, colour for four more genres (funk, reggae, house, rock).
  Its recipe is the most fully sourced of the four: two squares at 800/540 Hz through a bandpass at
  ~880 Hz, Q ≈ 4.8 (`…hats-and-cymbals.md` §2.4).

### 2. `crash` is kept. `ride` is added alongside it, not instead of it

Rock and drum & bass want an **accent on the downbeat and a timekeeper underneath**, and a ride
"maintains a steady pattern rather than providing the accent of a crash"
(`genre-drum-voice-selection.md` §6; `…hats-and-cymbals.md` §3). They are different jobs.

The measured evidence that the swap would have been cheap is also the evidence that it would have
been wrong: the whole `crash` row in the library is **step 0 in all eight grids that have it** —
one gesture, the downbeat accent, repeated eight times. Replacing `crash` with `ride` would have
cost one gesture to buy a timekeeper, and then rock and dnb would have had no accent to re-home it
to.

### 3. The `bass` row is deleted from every grid

23 rows and 53 authored hits go. `bass` is not a drum voice: it has no `DrumKit` field, no
`triggerDrum` case, and no sequencer track, and it could never sound. The head comment on
`src/data/drumGrids.ts:39–44` already says so.

**This is a deletion, not a migration.** Grid rows are `src/data/` content; a persisted payload
stores step arrays on tracks, never a grid's rows, so no chain is involved.

### 4. `DRUM_ALIASES` loses two entries, and that is the failure mode to fear

After this work `DRUM_ALIASES` is exactly `{ closedhat: 'hihat' }`.

> **If the split lands without deleting `lowtom → tom` and `ride → crash`, it fails silently.**
> `triggerDrum` resolves `DRUM_ALIASES[name] ?? name` **before** its switch (`engine.ts:1678`), so
> a new `case 'ride'` is dead code nothing can reach, and every `lowtom` step keeps playing the old
> single tom. No error, no test failure from the alias table itself — `engine.test.ts` asserts only
> that every alias *target* is a real drum type, which stays true.

`closedhat → hihat` stays: it is a caller-facing synonym for a voice that still exists, not a
stand-in for a voice we lack.

**`tom` does not become an alias for `lowtom`.** The tempting one-liner would keep old payloads
sounding, at the price of making a persisted-shape problem permanent in the engine. The rename is
handled where renames belong — in the two migration chains (decision 37).

### 5. Thirteen named kits; `Dusty Break` is the thirteenth

`DRUM_KITS` goes 12 → 13, plus `DEFAULT_DRUM_KIT`.

**`Dusty Break`** exists because four grids — `boom-bap`, `boombap-swung-break`, `boombap-8th-hat`,
`lofi-half-time-brush` — point at `808 Vintage`, and boom bap's instrument is *acoustic breaks
through a 12-bit SP-1200*, the opposite of a bridged-T sine
(`drum-kit-identities.md` §4 Gap 1, which supplies the values). Its second effect matters as much
as its first: **it frees `808 Vintage` to be an actual 808** instead of a compromise between two
referents.

**The three dangling `soundKit` names are repointed to the kit their own grid names** (context
table above): `cyber-edm` → the renamed 909 kit, `deep-ambient` → `Warehouse`, `zen-garden` →
`Acoustic Studio`. This invents nothing — it applies the convention every working vibe already
follows. **No kit is created to satisfy a dangling name**, which would be inventing a sound
decision to make a typo true.

`store/vibes.test.ts` gains the existence assertion `drumGrids.test.ts:116–124` already makes for
grids: **every vibe's `soundKit` is a key of `DRUM_KITS`.** Today's `expect(Boolean(vibe.soundKit))`
at `vibes.test.ts:29` passes on a name that resolves to nothing, which is how this shipped.

### 6. No ambient kit — a non-goal recorded with its reason

`ambient-sparse-drift` sits on `Warehouse`, which is a techno kit: the shortest decays in the
library under a grid that wants long tails (`genre-drum-voice-selection.md` §4). **No ambient kit is
added anyway.** No research pass found a sourced referent for one — `genre-drum-voice-selection.md`
§1 labels the whole ambient row *unsourced — engineering judgement* — and inventing a kit with no
referent is precisely the overclaim decisions 7 and 8 exist to prevent.

**Recorded, not fixed: `ambient-sparse-drift` on `Warehouse` is a known imperfect fit.** It goes in
that kit's `reference` note. Whether the grid moves to an existing better-fitting kit is open
question 3.

### 7. `DrumKit.reference` — `DrumGrid.provenance` applied to the audio domain

```ts
/**
 * What the kit is modelled on. Same discipline as DrumGrid.provenance:
 * 'authored' is an honest answer and an allowlisted one; never invent a
 * source to get off that list. `reachable` is the part that matters — it
 * records, PER VOICE, which parts of the referent this engine can approach
 * and which it cannot, so the next person retuning this kit knows what is a
 * gap and what is a wall.
 */
reference: { referent: string; source: string; reachable: string };
```

**The argument is the one `provenance` already won, moved one domain over.** Part 1's item 4 added
`provenance` because a research pass had to be spent rediscovering which of 22 grids had a
documented basis — information that was never recorded when the grids were written. The kits are in
exactly that state now, and worse: a kit's referent is *partially* reachable, and which part is
which is not derivable from the numbers. Nothing in `drumKits.ts` says that the 909's kick topology
is ours and its cymbals are 6-bit PCM.

**`reachable` is per voice, not per kit, and that is the whole point.** The TR-909 case is the
proof: kick, snare, toms and clap are analogue and genuinely reachable; hats, ride and crash are
6-bit PCM of real Paiste and Zildjian cymbals and **never will be**
(`drum-kit-identities.md` §5.1, `…hats-and-cymbals.md` §1.3). A per-kit score would average those
into a number that is true of no voice.

It stays inside the `src/data/` rules: a plain object literal on a literal — no import, no `new`,
no function, no impure global. Adding a kit remains an edit to that table and nothing else.

`reference` is **required**, not optional. An optional field makes omission the default and
silence indistinguishable from "nobody looked" — the failure mode `provenance`'s allowlist was
designed to make impossible. A kit with no referent writes `referent: 'authored'`; `Chrome Pulse`
is the existing example, and it is the allowlist working, not a gap in it.

### 8. `909 Modern` is renamed; `808 Vintage` is kept and held to a higher bar

**Rename `909 Modern`.** It is the only shipped name that makes a machine claim on voices this
engine cannot reach, and the unreachable set includes the busiest voice in the library
(`drum-kit-identities.md` §5.3). Retuning raises its kick from 2.0 to 3.5 and leaves the hat claim
exactly as false as it was — **fixing the sound cannot justify the name.** The new name is
evocative rather than referential; `drum-kit-identities.md` §5.4 offers `Club Standard`,
`Peak Hour`, `Four Floor`, and the choice is the owner's.

**Keep `808 Vintage`,** for two reasons that hold together: the TR-808 is the one machine on the
§5.1 table that is analogue in *every* voice, so accuracy there is a real target rather than a
pretence; and in trap and hip-hop "808" has become a common noun for a long sine sub-bass. The
obligation that comes with keeping it: **`808 Vintage` is held to a higher accuracy bar than any
other kit**, because it is the only one where the bar is reachable. Its `reference.reachable` says
out loud that the metal percussion needs the six-oscillator bank and is not modelled until
decision 30 lands.

**Cost, stated so it is not discovered later.** Kit names are the persisted key (`loop.soundKit`),
so a rename is a persist migration **and** a `.solna` `migrateProjectBody` step — two pieces of
work, never merged (decision 37). Measured: **no vibe names `909 Modern`**, so the rename's data
blast radius inside `src/data/` is one grid (`house`) and the kit table itself.

### 9. One choke group, hi-hats only

| new hit | cuts | release |
|---|---|---|
| `hihat` | any sounding `openhat`, any sounding `hihat` | **20 ms** |
| `openhat` | any sounding `openhat`, any sounding `hihat` | **8 ms** |
| `ride`, `crash`, `bell` | nothing | — |

A hi-hat is one physical instrument and the closure *is* the damping
(`…hats-and-cymbals.md` §4.1); the TR-808 implements this as the closed-hat envelope forced onto
the open hat's VCA — **an envelope, not a switch**, so the cut has a shape.

**An instant cut clicks.** A gain value that jumps discontinuously between samples is an audible
pop; ~15 ms reads as immediate without it (`…hats-and-cymbals.md` §4.2). 20 ms is the default for
closed-cuts-open, where nothing loud follows to mask the cut. 8 ms is enough for a hat cutting its
own kind, because the new strike masks it.

**`ride`, `crash` and `bell` are in no group and may ring together.** Real crashes ring through
each other, and a ride struck in time-keeping must overlap itself — a mono ride would cut every
quarter-note ping and destroy the wash that makes it a ride.

Implementation constraints that are not negotiable: `exponentialRampToValueAtTime` cannot ramp to
0, so a choke ramps to the existing `ENV_FLOOR`; the ramp must start from the value **at the choke
moment**, not from the peak, or the choke re-swells the voice; and the node must still be
`stop()`ed after the ramp.

### 10. A grid may omit a voice

**This is already correct behaviour, and Part 1 is what made it so.** `replaceDrumPattern`
(`src/store/sequencerSlice.ts:36`) clears any track the incoming pattern does not name, so an
omitted row and an all-false row are now identical in effect. Optional rows are therefore a
documentation and test change, not a behaviour change.

The tests move with it. Measured, `drumGrids.test.ts` has **three** row-shape tests, not one —
`:132` ("the sequencer genre grids define all seven of their rows, and only house has an eighth"),
`:140` ("the vibe grids define all seven of their rows and nothing else") and `:146` ("the sourced
variants define all seven genre rows and nothing else") — plus an `EXTRA_ROWS` exception table
carrying `house: ['crash']`. **All three collapse into one assertion: a grid declares only known
voice names.** `EXTRA_ROWS` is deleted with them; it exists to describe an exception to a rule that
no longer exists.

What is *not* relaxed: the head comment's authoring guidance at `drumGrids.ts:46–50` — *"write
every row your origin group defines anyway, even where the source is silent"* — stays. Omission
becomes legal; it does not become the recommended way to say "silent". A row of `false` states
that the genre plays nothing there; an omitted row states that the question was not asked.

### 11. Track colours become `--color-drum-*`, in four families

**Raw Tailwind palette classes are not an option.** `scripts/themeTokenGuard.ts` fails the build on
22 palette families, its `ALLOWLIST` is empty (`themeTokenGuard.ts:106`) and the suite's shrink
tests (`themeTokenGuard.test.ts:252`, `:255`, `:259`) make re-populating it fail. Beyond the guard,
there are two live themes, and a fixed palette colour adapts to neither.

**Follow the `--color-module-*` precedent** (`src/index.css:122–160`): identity colours defined per
theme as `--drum-*` variables, exposed through an `@theme` block as `--color-drum-*`, so components
still name a role and the guard still passes. The module set's own rules apply unchanged — hues
spaced around the **OKLCH** wheel (not sRGB HSL, which bunches the yellows) at a fixed lightness per
theme, ~0.75 dark and ~0.57 light, with content colours per member.

**Four families, and the grouping is the teaching:**

| family | members | how members separate |
|---|---|---|
| heads | kick, snare, rimshot, clap | hue ±10–14° within the family, plus lightness |
| hats | hihat, openhat | **one hue** — sharing a hue family is what makes the choke group of decision 9 visible in the grid |
| toms | hitom, lowtom | one hue, **lightness only** — hitom lighter, so high/low reads off brightness |
| metals | ride, crash, bell | hue ±12° within the family |

The rule the plan implements: **four family anchors at least 60° apart on the OKLCH wheel; members
of a family never differ by more than ~14°.** Four members is too many to separate by lightness
alone, which is why heads get a small hue spread and toms — which must read as one drum at two
pitches — deliberately do not.

Two constraints from `index.css`'s own comment carry over verbatim: **no drum colour may reuse a
semantic hex**, and the **20–60° amber band belongs to `--color-primary`.** See open question 2 —
the second constraint is already contradicted in the file.

Scope note: the eleven need only be mutually separable *within the sequencer*. No drum colour and
no module colour ever share a surface, so the drum hues do not have to thread the gaps in the
module ladder (87 / 125 / 162 / 213 / 256 / 294 / 322 / 356°). The no-semantic-hex rule is absolute
regardless.

---

## Why four slices, and why this order

### 12. The order is load-bearing, and each step is the cheapest test of the next

The four slices are **values → data → small engine changes → new voices**, and every adjacent pair
has a reason that is not "smallest first".

- **Values before everything, because we do not yet know how much of the problem is tuning.**
  `drum-kit-identities.md` §5.2 scores every kit three ways — today, after values, after values plus
  engine work — and the values column moves eight of twelve kits by a full point or more, with
  `Warm Riddim` moving 2.0 → 4.0 on values *alone*. Slice 1 is audible immediately, is reversible
  by `git revert` of a data file, and **it tells us how much of what remains is a real capability
  gap rather than bad tuning.** Doing it last would mean tuning eleven voices against a baseline we
  know is wrong, and then not knowing which of the fixes did the work.
- **Data corrections before the choke, because the choke makes the current data worse.** 33 steps
  in 18 grids have `hihat` and `openhat` both true. Today they merely double up. **After the choke,
  the closed hat instantly kills the open hat that shares its step** — so shipping decision 28
  before decision 20 would take 33 authored open-hat gestures and silence them, in the name of
  realism. Same argument for the kit reassignments: retuning a kit and then moving four grids off
  it is one listening pass; doing it in the other order is two.
- **Small engine changes before new voices, because two of them are prerequisites and all four are
  independently reversible.** The hat `topCut` and `q` are how the hat becomes a two-axis voice at
  all; every hat value a new voice is tuned *against* moves when they land. And each of the four is
  a contained change with an obvious off switch, which is not true of anything in slice 4.
- **New voices last, because they are the only irreversible step.** Slice 4 adds four voices, four
  tracks, four pads, eleven colours and two migration rounds. Everything before it can be reverted
  by editing data or deleting a branch in `triggerDrum`; slice 4 changes the persisted shape twice
  and cannot.

**Each slice ships on its own and is listenable on its own.** That is the property that makes the
order worth insisting on: if slice 1 turns out to close most of the gap, slices 3 and 4 get
re-scoped with evidence instead of being executed because they were planned.

---

## Slice 1 — values only, no code change

> **One measured exception, and it is open question 1.** Decision 15's clap fix lives in
> `engine.ts:1732–1735`, not in a kit parameter. Slice 1 is "values, plus one hardcoded envelope
> constant in `triggerDrum`" — or the clap moves to slice 3. The spec does not resolve this; see
> open questions.

Slice 1 applies `…kick-snare-clap-toms.md` §5(a) and `…hats-and-cymbals.md` §5.1, plus the per-kit
tables in `drum-kit-identities.md` §2. The research documents carry the numbers; the decisions below
carry the rules those numbers must satisfy, so a reviewer can check a table without re-deriving it.

### 13. Collapse `kick.pitchTime`; pin the long kicks to a note

Rule: **`pitchTime ≤ 0.1 × decay`** for every kit. Where `pitchTime` shortens, `freqStart` rises,
because a 20 ms sweep from 95 Hz is nearly inaudible — the sweep must still be *heard* as an attack.

Second rule, for the two kits whose kick is a sustained note rather than a thump: **if `decay` >
0.5 s, `freqEnd` is a note frequency, not a round number** (`Sub Weight` 38 → 36.71 Hz = D1;
`Trap Beat` 42 → 41.20 Hz = E1). A kick that rings for 600 ms has a pitch whether or not we chose
one; choosing one is how it stops fighting the bass.

### 14. Nine kits gain a kick click

Only four of thirteen entries have one. The click family table in `…kick-snare-clap-toms.md` §1.4
assigns by referent: the 808 and trap-808 kits **omit it entirely** (the 808 has no separate click
path — that is a fact about the machine, not an oversight), 909-family kits take 1600 Hz / 0.30 /
8 ms, acoustic kits take 3500 Hz / 0.22 / 6 ms, lo-fi takes 900 Hz / 0.15 / 12 ms.

Recorded as a limit, not a defect: **solna's click is a static sine.** A 1200 Hz sine over 15 ms is
a pitched blip, and both the 909's click and an acoustic beater are broadband. Slice 1 can only
choose where the blip sits. The real fix is a `clickType: 'tone' | 'noise'` branch, which is named
in non-goals.

### 15. The clap's three bursts stop rising

Replace the two-`setValueAtTime` shape with three **decaying** bursts plus a distinct tail, per
`…kick-snare-clap-toms.md` §3.4's schedule. Two properties must hold and are what a test should
assert: **amplitudes are monotonically non-increasing**, and **each burst decays rather than
plateauing**, with a short gap before the next — the gaps are what make them read as separate
hands.

No new parameter: `drumEnv` calls `shape(gain.gain)` *before* appending its closing ramp, so the
whole corrected envelope schedules through the existing hook.

The filter follows: the 808/909 clap bandpass is ~1000 Hz, and most kits are set well above it.

### 16. `snare.bodyTime` and the body glide

Two rules, applied to every kit:

- **`bodyTime` 0.08 → 0.010–0.030.** It is a copy-pasted constant in all 13 entries.
- **`bodyFreqEnd ≥ 0.85 × bodyFreqStart`.** A snare's tonal component is the head's (0,1) mode —
  fixed partials that barely bend. `DEFAULT_DRUM_KIT` currently sweeps 220 → 90 Hz over 80 ms,
  which is a 2.4:1 downward glide: tom behaviour on a snare.

### 17. `noise:body` becomes the snare's genre axis

Measured span today: **0.87–2.00**. Target: **0.7–2.8** (`…kick-snare-clap-toms.md` §2.3) — trap
≈ 2.8, gated 80s ≈ 1.4, acoustic and 808 ≈ 0.9, lo-fi ≈ 0.7. **Genre lives in the gain ratio, not
in the frequency**, which is why moving `bodyFreqStart` around has bought so little separation.

### 18. Hat and tom values widen inside the existing model

Honest ceiling first, because it decides how much effort this deserves: **re-tuning three numbers
buys about 2.5 distinguishable hat characters and cannot buy genre identity**
(`…hats-and-cymbals.md` §5.1). With one highpass over white noise, raising the cutoff makes the hat
thinner *and* quieter — the two are not separable — and no setting of three numbers makes noise
beat or makes the spectrum move during the decay.

What is nonetheless free: **the decay range is far too narrow.** All 13 closed hats live in
0.030–0.060 s; the 808's own closed hat is 0.050 s and loose acoustic hats ring much longer.
Widening to 0.020–0.110 s is the single largest free win on the busiest row in the library. The
five archetypes in §5.1's table are the assignment.

Toms follow `…kick-snare-clap-toms.md` §4.3's ratios *as a low tom only* — the split itself is
slice 4. The shallow-sweep rule lands here, because it is the main reason a tom currently reads as
a small kick: **`freqStart / freqEnd` ≈ 1.35 (4–6 semitones)**, against today's 2.15:1.

### 19. `check:drums` gains the parameters that let the collapse through

Add `hihat.decay`, `hihat.gain`, `snare.bodyTime`, `kick.pitchTime` and `kick.clickLevel` to the
spread list, and **add a pairwise nearest-neighbour check alongside the aggregate one.** An
aggregate spread is satisfied by two extreme kits and says nothing about the ten in between; the
measured `909 Modern` ↔ `Warehouse` twinning (`drum-kit-identities.md` §3) passed CI for exactly
that reason.

This lands in **slice 1**, not later, and that is deliberate: the check must be tightened by the
slice that has just made the values wide enough to pass it. Tightening it after slice 4 would mean
tightening it against eleven voices at once.

---

## Slice 2 — data corrections that need no new voice

### 20. De-collide `hihat` and `openhat` — 33 steps in 18 grids

**Where an open hat sounds, the closed hat is off.** One hi-hat cannot do both; the sources that
these grids were transcribed from meant a single instrument, and writing both rows true was our
transcription artefact.

This must precede decision 28 (see decision 12): after the choke, a colliding step becomes an open
hat that is instantly killed by its own closed hat.

### 21. Clap corrections, per genre

`genre-drum-voice-selection.md` §2 is the change list, and measured against it: `clap` is
byte-identical to `snare` in **14 of 30** grids, all-false in 11, genuinely different in 5.

Of the 14 duplicates, six are **deleted outright** because the genre has no clap at all — boom bap
and dnb use a sampled acoustic snare, funk and rock use a snare, Afro 6/8 uses cross-stick and bell.
Two become **clap-only with the snare dropped** (house, techno, where the clap carries the
backbeat). Four are **correct layers and stay** (trap, dubstep, synthwave ×2). The rest are lo-fi
judgement calls that thin rather than delete. The strays on `waltz` and `waltz-brush-three` go.

"Dropped" now means **the row is omitted** (decision 10), not written all-false.

### 22. `Dusty Break` lands, and the kit reassignments follow it

Adding a kit is pure data. Four grids move off `808 Vintage` onto `Dusty Break`; `afro-6-8` and
`afro-six-eight-bell` stop disagreeing about their kit and both take `Acoustic Studio`
(`genre-drum-voice-selection.md` §4).

**Blast radius to enumerate, not discover:** two vibes name `808 Vintage` while their grids move to
`Dusty Break` — `lofi-chill` (grid `lofi-half-time-brush`) and `boom-bap` (grid
`boombap-swung-break`). If the grids move and the vibes do not, those two join the three broken ones
in disagreeing with their own grid. The convention in decision 5 says they move together.

### 23. Optional rows, and the three row tests become one

Decision 10's test change lands here, with the row deletions that need it — the `bass` deletion
(decision 3) and the clap deletions (decision 21) both produce grids that no longer declare seven
rows, so the tests must move in the same commit or the suite is red between them.

### 24. A vibe's `soundKit` must exist

Decision 5's repoint plus the new assertion in `store/vibes.test.ts`. It lands in slice 2 because
it is data, and because it is the last thing that can be fixed before the kit rename in slice 4
starts moving `soundKit` values for a different reason.

---

## Slice 3 — small engine changes

Four changes, each contained, each independently revertible.

### 25. `reverbSend` on `KickParams` and `TomParams`

`wireDrumVoice` already accepts a send; `drumTone` simply never passes one. Threading it through is
the smallest change in this spec and, per `drum-kit-identities.md` §5.2, **the largest ceiling gain
in the library**: `Warehouse` moves 2.5 → 4.0, because its two defining traits are both routing —
a dense low-passed reverb fed from the kick, doing the job of a bassline. Without it `Warehouse`
reduces to "909 Modern with a duller kick and a brighter hat", which is what the measured twinning
in §3 says it currently is.

Second beneficiary: `Acoustic Studio` gets a room.

### 26. `topCut` — a lowpass on the hat params

The hat's `filter` is a **highpass**, which is why `Lo-Fi Vinyl`'s 3500 Hz corner makes it the
brightest hat in the library — the exact inverse of its intent (context, and
`drum-kit-identities.md` §2). "Lo-fi" means a *band*, not a floor. A second biquad gives the hat an
upper corner and turns the busiest row in the library from a one-axis voice into a two-axis one:
808 ~12 kHz, LinnDrum ~12 kHz, 909 ~15 kHz are all reachable only through it.

### 27. Pass `q` to the hats

`drumNoiseBurst` already takes `q`; `crash` passes 0.8 and the hats pass nothing. A highpass at
Q 4–6 has a resonant bump at the cutoff, which is **the cheapest available approximation of a
partial** and needs no new kit field if it starts hardcoded.
`…hats-and-cymbals.md` §5.1 calls it the highest value-per-line change in that document.

### 28. The choke group

Decision 9's table, implemented as a map of sounding hat voices in `engine.ts` plus a ramp to
`ENV_FLOOR`. It is independent of every other change here and can ship first within the slice.

**Prerequisite: decision 20 must have landed.** This is the one ordering constraint inside the
whole spec that produces a worse-sounding app if violated.

---

## Slice 4 — new voices, and everything that depends on them

### 29. All of slice 4 ships together

`check:drums` enforces parameter spread across the merged kits, so adding *one* voice already
forces a tuning pass over all thirteen. Four voices at once is the same pass, not four passes. The
same argument Part 1's item 15 made for two voices holds harder for four.

### 30. The metallic oscillator bank, for hats and cymbals

Six square oscillators at the 808's inharmonic ratios `[1, 1.483, 1.800, 2.546, 2.630, 3.897]`
against a `tone` fundamental, band-split into two bandpasses (~7100 Hz and ~3440 Hz) with **an
independent envelope per band**, highpassed and summed (`…hats-and-cymbals.md` §1.2, §2.0).

**This is the one change that answers "why doesn't this sound like a hi-hat".** The measured hat
collapse across thirteen kits is a *capability* gap wearing an authoring gap's clothes: the hat is
the single voice for which solna's model resembles none of its referents, so there was nothing to
differentiate toward, and every author converged on the same white-noise burst because the engine
offers exactly one (`drum-kit-identities.md` §5.1).

Two structural properties are the reason it works and must not be dropped in implementation:
**the two bands have different decays** — the high band dies first, the low band rings on, which is
what produces a falling spectral centroid that a single gain envelope over a single filter cannot
produce at any cutoff; and the **design rule is "avoid even multiples"**, because simple ratios
sound pitched.

One generator serves hat, open hat, ride and crash, with different envelopes and band mix
(`…hats-and-cymbals.md` §1.2). `bell` does **not** need it: its two-oscillator recipe is sourced and
sufficient.

Cost to watch: node count per hat hit goes from ~3 to ~10. At 16ths and 140 BPM that is ~9
oscillator starts per second per hat track. The teardown pattern already exists (`onended`
disconnects), but the plan must measure it, not assume it.

### 31. A second snare body oscillator — and `rimshot` for free

`SnareParams` gains `bodyFreqStart2` / `bodyFreqEnd2` / `bodyGain2`. An acoustic snare's tonal
component is a **pair** of partials near 180 and 330 Hz, and the 808, the 909 and the standard
SH-101 snare patch all use two oscillators for exactly that reason
(`…kick-snare-clap-toms.md` §2.1). One triangle cannot produce it.

**`rimshot` is then a preset over the same code path, not a new voice class.** With two body
oscillators, the 808's rimshot is two inharmonic tones at 455 and 1667 Hz with almost no noise, and
a cross-stick is 780/2400 Hz with a shorter decay (§2.4). One code path, two presets — which is why
the highest-value missing voice is also among the cheapest.

> **A `rimshot` sequencer row and a `rimshot` `DrumKit` field still exist**, because a grid and a
> kit must be able to name it. What decision 31 avoids is a *third* synthesis path. The distinction
> matters for `check:drums`: `rimshot` is a `DRUM_TYPES` member and must be separated like any
> other voice.

### 32. `hitom` / `lowtom`

`lowtom` keeps today's `freqEnd`, `decay` and `gain`; `hitom` is derived by the ratios in
`…kick-snare-clap-toms.md` §4.3 — `hitom.freqEnd / lowtom.freqEnd` ≈ 2.0 (one octave, per the 808's
185/90), `lowtom.decay / hitom.decay` ≈ 1.9, the same shallow `freqStart / freqEnd` for both.

**One guard must be encoded, because the mechanical ratio collides:**
`hitom.freqEnd ≤ 0.85 × snare.bodyFreqEnd`. `Chrome Pulse` and `Acoustic Studio` both need it —
without the cap their hi tom sits on the same note as the snare body and a fill turns to mud.

`check:drums` must cover `hitom` and `lowtom` as separate types, or the split passes vacuously on
two identical entries.

### 33. `ride`, with one `ping` parameter

A ping component (bandpass 3.5–5 kHz at Q 3–5, plus a 300–600 Hz body band, 0–2 ms attack,
90–160 ms decay) and a wash component (bandpass 7–9 kHz at Q 0.7, 8–15 ms bloom, 1.2–2.5 s decay),
crossfaded by `ping` in 0..1 (`…hats-and-cymbals.md` §2.3, §3).

**A ride is a defined ping over a bed that survives the next strike; a crash is a faster bloom that
collapses. Neither is the other, and neither is a filtered version of the other.** If `ride` is
implemented as a re-filtered crash, `check:drums` is the thing that should catch it — and if it does
not, the voice is not worth adding.

### 34. `bell`

Two squares at 800 and 540 Hz — a deliberately detuned fifth (1.481), so they beat — through a
bandpass at ~880 Hz with **Q ≈ 4.8**, decaying over ~400 ms (`…hats-and-cymbals.md` §2.4). The ride
bell / bembé variant is ~1700/1150 Hz through a 2000 Hz bandpass with a wash tail.

**`bell` against `hihat` and `openhat` is the hard `check:drums` case** — they are the nearest
neighbours in brightness. It is also the case where the check is most likely to pass on numbers
while failing the ear, because the bell's separation from a hat is *harmonic structure*, which no
parameter-spread assertion looks at. The listening pass (decision 42) is the real gate here.

### 35. Eleven sequencer tracks, eleven `--color-drum-*` colours

The seven existing tracks are recoloured onto the new namespace along with the four new ones —
**not seven semantic tokens plus four new colours.** A mixed scheme would make the four families of
decision 11 unreadable, and would leave the sequencer as the one surface in the app where colour
means two different things.

`tom`'s track becomes `lowtom` by rename (decision 37), keeping the user's programmed steps.

### 36. Pads

`DEFAULT_PADS` goes from eight entries to eleven, and two existing entries are corrected: the
`hightom` pad's `note` becomes `'hitom'` and its dead `pitch: 4` is removed (context, fact 2); the
`lowtom` pad's `note` becomes `'lowtom'`, which is what its id has always claimed.

Three free key codes are needed. Today's eight use `KeyZ`, `KeyX`, `KeyC`, `KeyV`, `KeyM`, `Comma`,
`Period`, `Slash`; the new codes must collide with neither those nor the synth keyboard map, and
**`bun run check:keys` is the arbiter.** They were not searched for here — that is a plan task.

### 37. Both migration chains, twice-over, never merged

The persisted shape changes in three ways, and they need **two** pure transforms, not one:

| change | transform | why it cannot be `withDrumTracks` |
|---|---|---|
| `tom` track → `lowtom` | **`renameDrumTrack`** (new) | `withDrumTracks` appends only and **never rewrites a track that is present** — by design, so a user's renamed, recoloured, muted, reprogrammed track survives. Run alone, it would leave `tom` in place *and* append `lowtom`, so the user's tom row goes silent while a blank one appears beside it. |
| four new tracks appended | **`withDrumTracks`** (existing, unchanged) | it already appends exactly what is missing, and is idempotent |
| `909 Modern` → new name in `loop.soundKit` | **`renameSoundKit`** (new) | a scalar field, not a track list |

**`renameDrumTrack` runs before `withDrumTracks`.** Reversed, the append step sees no `lowtom`,
adds a blank one, and the rename then produces two.

Both transforms are pure, idempotent, and shared between the chains — `withDrumTracks` is the
precedent established in Part 1's item 12, itself following `defaultPadState()`.

| chain | where | version move |
|---|---|---|
| persist | `migrate` in `store/store.ts`, before `merge` | `version: 13` → **14** |
| project body | `migrateProjectBody` in `store/projectFormatMigrate.ts`, before `sanitizeContent` | `PROJECT_FORMAT_VERSION: 5` → **6** |

> **Never merge the chains.** A persist payload is private `localStorage` shape; a project body is
> an external contract; their versions move for different reasons. `CLAUDE.md` records the rule and
> `upgradePadLayerV4`'s docblock is the standing precedent.

`sequencerTracks` is reachable by either chain in **exactly one place: inside every `loops[]`
entry.** The store's flat copy is derived on hydration and appears in neither `partializeAppState`
nor `PROJECT_CONTENT_KEYS`. Both chains map `loops[]` and nothing else.

**Sound does not change for an existing session or `.solna` file.** Appended tracks are silent
(all-`false` steps); a renamed track keeps its steps; a renamed kit resolves to the same parameters.
This is the discipline `upgradePadLayerV4` follows — *a project written before the layer existed must
reopen sounding the way it sounded when it was closed.*

### 38. The grid re-authoring that needed the new voices

Only the parts that were impossible before land here:

- **Rimshot backbeats move off `snare`** in the grids where the idiom is a cross-stick — reggae,
  jazz waltz, Afro 6/8, lo-fi hip-hop.
- **The bembé bell moves off `hihat` onto `bell`, and the jazz-waltz ride off `hihat` onto `ride`.**
  Part 1 wrote both onto `hihat` deliberately, as the half of the fix that needed no new voice, and
  recorded that the timbre stayed wrong. Only now can a bell and a hi-hat sound at the same time,
  which is what the source arrangements do.
- **The five two-hit tom grids are re-authored to start on the snare** — measured, they are
  `synthwave`, `house`, `cyberpunk`, `techno`, `synthwave-four-on-floor`. With only two toms, a fill
  needs the snare on its first step to read as descending; two toms alone at the end of a bar read
  as "two hits", not "a fall" (`…kick-snare-clap-toms.md` §4.4). The kit brackets the ladder —
  snare 175–235, hi tom 124–181, low tom 65–110, kick 45–70 Hz — so the four-step descent is the
  shape a listener recognises.
- **Rows that were authored blind become audible.** Techno's tom row is a *timekeeping* device
  (filtered 16th rolls), not a fill, and Afro 6/8's toms are the drum parts themselves rather than
  ornament (`genre-drum-voice-selection.md` §1). Whatever the listening pass finds here is in scope.

---

## Verification

### 39. A green gate cannot judge whether drums sound right

`bun run verify` is the gate — test, `tsc --noEmit`, eslint at **zero errors**, `check:keys`,
`check:drums`, build. It proves that nothing broke and that the values differ. **It cannot tell us
that a bell sounds like a bell.**

This is the same problem Part 1 stated in its item 17, one degree worse: Part 1 changed rhythms,
where a test asserting a step list is at least a transcription check against a source URL. Here we
change *timbre*, and there is no assertion whose passing means anything about the sound. A
`check:drums` pass means the parameters differ; two voices can differ in every parameter and still
be indistinguishable, and two voices can share most parameters and be obviously different.

**The listening checklist in decision 42 is a human gate of equal weight to `bun run verify`, and
the plan carries it as numbered steps, not as a closing note.**

### 40. `check:drums` must not be able to pass vacuously

Three properties, and the first is the one the current script lacks:

1. **Pairwise nearest-neighbour separation**, not only aggregate spread (decision 19).
2. **`DRUM_TYPES` is one list.** Measured, it is currently duplicated as a local `const` in two test
   files — `src/audio/drumKits.test.ts:5` and `src/data/drumKits.test.ts:4` — plus the script's own.
   Adding four voices to two of three copies is a silent hole exactly the size of the missing
   voice.
3. **Every new voice appears in the spread list before its values are authored**, so the first
   authoring pass is done against a check that can fail.

### 41. A `reference` test, mirroring the provenance test

Two assertions, the same shape as Part 1's item 20:

1. **Every kit has a non-empty `reference` with all three fields populated.**
2. **Every kit whose `referent` is `'authored'` is in a named allowlist in the test.**

The second is load-bearing: it makes shipping an un-referenced kit a **deliberate act** — adding a
name to a list a reviewer sees — rather than the default that happens when nobody looked.
`Chrome Pulse` is on that allowlist by decision.

Plus the sibling that closes the measured bug: **every vibe's `soundKit` is a key of `DRUM_KITS`**
(decision 5).

### 42. The listening checklist, per slice

- **After slice 1** — play each of the thirteen kits from the drum pads. The specific questions the
  measurements pose: does `Sub Weight`'s kick still slide? Is the clap's *first* burst now the
  loudest? Is `Lo-Fi Vinyl`'s hat still the brightest in the set (it will be, until decision 26 —
  confirming that is how we know `topCut` is genuinely needed and not a nicety).
- **After slice 2** — load every corrected grid from the sequencer menu. Specifically listen to the
  18 grids that had colliding hats: the correction removes hits, so it must not have removed the
  groove with them.
- **After slice 3** — `Warehouse` against the renamed 909 kit, back to back, on the same grid. If
  the kick send has done its job they are no longer the same kit; if they still are, decision 25
  did not land the way its research predicted and that is a finding.
- **After slice 4** — audition every new voice in every kit. `bell` against `hihat` and `openhat`
  is the pair to spend time on (decision 34). Then a descending fill on each kit, to check the
  ladder of decision 38 and the `hitom` ≤ 0.85 × snare guard of decision 32.
- **Throughout** — press all eight vibe chips and roll the dice on each. Three vibes get a real kit
  for the first time in slice 2; two more change kit in slice 2; one changes name in slice 4.

### 43. `report:drums-diff` covers the rows; nothing covers the values

`scripts/report-drum-diff.ts` exists from Part 1 and reads its "before" side out of git at a pinned
commit. It reports **row changes**, so slices 2 and 4's grid edits are covered by an artifact a
reviewer can read and the commit message can quote.

**No equivalent exists for kit values, and slice 1 is nothing but kit values.** The plan should
extend the same report to `DRUM_KITS` — per-kit, per-voice, per-parameter before/after — for the
same reason and under the same rule: **a report that always exits 0, never an assertion.** A changed
kit parameter is a fact about content, not a defect.

---

## Non-goals

Each of these is named with its reason, so it is a decision rather than an omission.

- **An ambient-specific kit.** Decision 6. No sourced referent exists; inventing one is the
  overclaim this spec exists to prevent.
- **Samples, of any kind.** The engine's premise is synthesis from scratch. This is why the 909's
  cymbals, the LinnDrum, the DMX, the TR-707 and the RZ-1 are permanently out of reach — **by
  construction, not by difficulty** (`drum-kit-identities.md` §5.1) — and why decision 8 renames
  rather than promises.
- **`shaker` / `tambourine`, `conga` / `bongo`, `rototom`.** Ranked 2, 4 and 5 in
  `genre-drum-voice-selection.md` §5. The shaker is the strongest of the three (six genres) and is
  the obvious next voice; it is out because eleven voices is already two migration rounds, eleven
  colours and a thirteen-kit tuning pass. Rototom is largely redundant once `hitom`/`lowtom` exists.
- **`clickType: 'tone' | 'noise'` on the kick.** Named in decision 14 as the real fix for a blip
  that should be a broadband attack. It is a genuine slice-3-shaped change and was not selected;
  the first candidate for a follow-up.
- **`attack` on every voice.** `…hats-and-cymbals.md` §5.2 ranks it sixth with a trivial cost — a
  crash *blooms* rather than switching on. Deferred with `clickType`, and for the same reason: slice
  3 was scoped to four changes and adding a fifth would have made it the biggest slice.
- **Per-voice `delaySend`.** Dub is tape echo as much as reverb, and drums bypass the delay by
  design. Re-adding a delay tap deliberately reverses an earlier removal and needs its own
  discussion — not a line snuck into a tuning pass.
- **An envelope on the reverb send** (true gated reverb for `Retro Drive`), and **`trackPitch` on
  the kick** (trap's melodic 808). The second also crosses the `audio/` ← `store/` boundary and
  would have to arrive via `engineSync.ts`.
- **Distortion on the drum bus.** Drums bypassing distortion is a deliberate routing decision, and
  `Warehouse` is reachable well enough through decision 25.
- **Per-cell velocity, swing, and a per-grid step resolution.** Inherited unchanged from Part 1's
  non-goals. A boolean grid cannot hold ghost-note velocity, and a resolution axis touches the
  shared 16th clock, which is a transport change.

---

## Open questions, left to the plan

1. **Which slice owns the clap-shape rewrite.** Decision 15 is listed as slice 1 ("values only, no
   code change"), but measured, that envelope is hardcoded in `engine.ts:1732–1735` and is not a kit
   parameter. Either slice 1 is "values plus one envelope constant" or the clap fix is a fifth item
   in slice 3. **Recorded rather than decided, because the settled decision placed it in slice 1 and
   the code says slice 1 has no code changes.** The audible argument favours slice 1 — it is the
   single largest change in the kick/snare/clap/tom research and it is one function's worth of work.
2. **`--module-pad` already sits inside the reserved amber band.** `src/index.css:178` (dark) and
   `:225` (light) both define `--module-pad` at **40°**, and the module-colour comment at `:138`
   states that *"the 20-60° amber band belongs to `--color-primary` alone"*. The light-theme entry
   documents its own exception (darkened off `--color-warning`, ~10° lower in hue, ~0.07 lower in
   OKLCH L); the dark-theme entry does not. **Decision 11 requires drum colours to honour a
   constraint the file already breaks.** The plan must either treat the amber band as reserved (and
   record `--module-pad` as a known exception in the comment) or restate the constraint to match
   reality. It must not quietly do neither.
3. **Whether `ambient-sparse-drift` moves off `Warehouse`.** Decision 6 settles that no ambient kit
   is added and that the misfit is recorded. It does not settle whether the grid moves to an
   existing kit — `genre-drum-voice-selection.md` §4 recommends `Acoustic Studio` (long crash, long
   tom) over `Warehouse` (the shortest decays in the library). That is a listening call, and it also
   moves `deep-ambient`'s `soundKit`, which decision 5 has just repointed to `Warehouse`.
4. **The new name for `909 Modern`.** Three candidates are offered; the choice is the owner's, and
   it is the one thing in decision 8 that is not settled.
5. **Three free keyboard shortcuts for the new pads.** Not searched for; `check:keys` is the
   arbiter (decision 36).
6. **The exact hues and lightnesses of the eleven `--color-drum-*` entries.** Decision 11 fixes the
   families, the separation rule and the two constraints; the hex values are a design pass that
   must be done against both themes side by side, and open question 2 gates one of its constraints.
7. **The exact field sets for `RideParams` and `BellParams`, and whether `metal` is a per-kit
   parameter or a per-voice constant.** `…hats-and-cymbals.md` §5.2 proposes `metal` as a 0..1 mix
   between the oscillator bank and noise. Whether thirteen kits each need to author it, or whether
   the bank is simply how a hat is made now, is a `dsp-audio` question answered against the engine.
8. **Whether the "18 test files assert the absence of raw palette classes" figure is right.** It was
   not reproducible as stated. Measured on this branch: **38** test files reference a semantic-token
   class or a `module-` colour, and **17** contain a `not.toContain('bg-…'|'text-…')` assertion.
   Neither is 18. The decision does not depend on it — decision 11 rests on the guard itself, which
   *was* verified: `ALLOWLIST` is empty at `themeTokenGuard.ts:106` and three shrink tests at
   `themeTokenGuard.test.ts:252/255/259` make re-populating it fail.

---

## Self-review

Scanned for placeholders, internal contradictions, requirements readable two ways, and unmeasured
counts. What was found and fixed inline:

- **Three counts in the settled decisions did not survive measurement**, and all three are recorded
  in place rather than corrected silently: "10 of 12 kits sweep longer than 50 ms" is **10 of 13
  entries / 9 of 12 named kits** (Context); "18 test files" is **not reproducible**, measured at 38
  and 17 by two different readings (open question 8); and the snare `noise:body` span quoted in the
  research as 1.2–2.0 measures **0.87–2.00**, a lower floor than stated (Context, decision 17).
- **One settled decision is contradicted by the code**: slice 1 is defined as "values only, no code
  change" while containing the clap-shape fix, which lives in `engine.ts`. Recorded as open
  question 1, not resolved.
- **One settled decision's premise is contradicted by the code**: the 20–60° amber band is
  documented as reserved for `--color-primary`, and `--module-pad` sits at 40° in both themes.
  Recorded as open question 2.
- **A missing transform was found while writing decision 37.** The settled decisions say "both
  migration chains", implying `withDrumTracks` suffices. It does not: `withDrumTracks` appends only
  and never rewrites, so `tom` → `lowtom` needs its own `renameDrumTrack`, ordered *before* it. That
  is a spec-level correction, and it is stated as a decision rather than left for the plan to
  discover.
- **Decision 31 was ambiguous on first writing.** "Rimshot is a snare preset, not a new voice" could
  be read as "rimshot needs no row and no kit field". Rewritten to say explicitly that the row, the
  `DrumKit` field and the `DRUM_TYPES` membership all exist; what is shared is the synthesis path.
- **Decision 10 was ambiguous on first writing.** "A grid may omit a voice" could be read as
  licence to omit silent rows generally. Rewritten to keep the head comment's authoring guidance and
  to distinguish an all-false row (the genre plays nothing there) from an omitted row (the question
  was not asked).
- **Decision 35 was under-specified.** "Track colours become `--color-drum-*`" left open whether the
  seven existing tracks keep their semantic tokens. They do not; stated, with the reason.
- No placeholder, TODO or unresolved cross-reference remains. Every research citation is by document
  and section; no research content is restated at length.

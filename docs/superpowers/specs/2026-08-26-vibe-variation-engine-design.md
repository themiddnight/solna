# Vibe Variation Engine — Design

Date: 2026-08-26
Status: Approved, not yet implemented
Scope: Project B2 of three (A = Automation Player Transport, B1 = degree-based
progression library + auto-harmonize fix, C = Keyboard Chord Mode). **B1 ships
first and B2 builds on it.**

**Amended 2026-08-26** to carry the controller's cross-check rulings, recorded
in `.superpowers/sdd/vibe-variation-context.md` under "Cross-check rulings":

| ruling | change |
| --- | --- |
| R1 | "What B1 must provide" item 8 now states the *requirement* and cites B1's `chordsReplaced` identity guard. B2's `chordsSourceRoot` proposal is withdrawn. |
| R2 | Non-regression test 18 is **inverted**: a reroll rewinding the shared bar grid is intended, user-tested behaviour, and is now pinned rather than forbidden. |
| R4 | B1 ships four progressions per genre; the derived `progressionIds` filter yields at least four for every vibe. |
| I2 | `DrumDecorationRule.densities` is `Partial<Record<DecorationLayer, DensityName[]>>`. |
| I3 | Boom Bap's `openhat` pool is 2 of 3 after the collision filter — recorded in accepted limitations. |
| I4 | Re-measured: `lofi16ths` / `swung16ths` are **not** inverted. Rows unchanged; the identity is promoted to invariant test 6b. |
| M7 | A reroll can change the chord-loop length against a 1-bar drum pattern — recorded in accepted limitations. |
| M8 | The `I–IV–vi–V` toast example is labelled illustrative. |

## Problem

The six Instant Vibes are frozen snapshots. Clicking a chip always produces the
identical bar of music: same key, same four chords, same comp rhythm, same bass
pattern, same beat, same BPM. That determinism is wanted — a chip is a preset,
not a surprise — but it means the app has exactly six pieces of music in it. A
user who likes Boom Bap has one Boom Bap and no way to ask for another one.

The pieces needed to generate a second Boom Bap already exist and are unused:
15 chord-comp rhythms across 9 styles, 12 bass patterns, 12 roots, and (after
B1) a library of chord progressions stored as scale degrees, which can be
resolved into any key. Nothing joins them to a vibe.

## Goals

- A **dice button** that rerolls the loaded vibe into a different piece of music
  in the same genre.
- The genre survives the reroll. Scale type, timbre and effects are genre
  identity and do not move.
- Every press changes something the user can hear, and the UI says what changed.
- The reroll reuses `applyInstantVibeToStore` verbatim, so the mid-playback
  hard-stop fix and the shared bar grid cannot regress.
- The draw policy is unit-testable without depending on chance.

## Non-goals

- **No undo and no per-axis locks.** The user was offered both and declined.
  Neither is designed in; both can be added later without touching the data
  model.
- No seeded or shareable rerolls. The draw is not recorded.
- No generative rhythm. Drum decoration is picked from a fixed catalogue of
  hand-authored rows; nothing is synthesised per step.
- Scale type, synth presets, master effects, sound kit, `chordOctave`,
  `bassOctave`, `chordFeel`, `bassFeel` and `projectTitle` do not vary.
- `kick`, `snare` and `clap` never vary. (`clap` doubles the snare on the
  backbeat in every vibe that uses it; rerolling it would break the skeleton
  that decision #3 protects.)
- Rerolling a vibe that is not loaded. The dice acts on the loaded vibe only.

## Architecture

### Shape of the change

One new pure module plus data on the existing vibes. No new store slice, no new
store state, no engine call, no persist version bump — the reroll's output is an
`InstantVibe`, and applying it is the existing code path.

```
InstantVibesBar (dice click)
      │
      ├─ resolveVibeVariation(vibe, current, draw)   ← pure, store/vibeVariation.ts
      │     └─ resolveProgression(...)               ← B1, audio/data/chordProgressions.ts
      │  returns { vibe: InstantVibe, summary: VariationSummary }
      │
      └─ applyInstantVibeToStore(result.vibe)        ← unchanged, store/instantVibes.ts
```

Because the resolver returns a whole `InstantVibe`, the reroll is
indistinguishable from a chip click as far as the store and audio layers are
concerned. That is the mechanism by which the two "must not regress" invariants
are protected: there is no second apply path to keep in sync.

### Types

`InstantVibe` moves from `src/store/instantVibes.ts` to `src/types.ts`, joining
`SynthParams`, `ChordItem` and `MasterEffects`. This is purely to break an
import cycle (`instantVibes.ts` needs `DRUM_DENSITIES` from `vibeVariation.ts`;
`vibeVariation.ts` needs the `InstantVibe` type). The interface body is
unchanged apart from the new field. The app has no users, so no re-export shim
is kept; the importers are updated.

`VibeGenre` gets the same treatment for the same reason: `VibeVariation` lives
in `src/types.ts` and needs it, while `chordProgressions.ts` already imports
`ChordItem` from `src/types.ts`. So `VibeGenre` is **declared** in
`src/types.ts` and **re-exported** from `src/audio/data/chordProgressions.ts`
(`export type { VibeGenre } from '../../types';`). The pinned export site stays
valid for B1 and no cycle is created.

```ts
// src/types.ts
export type DecorationLayer = 'hihat' | 'openhat' | 'tom' | 'crash';

export type DensityName =
  | 'off' | 'downbeat' | 'halves' | 'backbeat' | 'quarters'
  | 'offbeat8ths' | 'and2and4' | 'eighths' | 'swung16ths' | 'lofi16ths'
  | 'sixteenths' | 'pickup' | 'lateFill' | 'fillTail' | 'midBar';

export interface DrumDecorationRule {
  /** Layers the dice may rewrite. Authoritative: a layer absent here is never
   *  rewritten even if `densities` has an entry for it. kick, snare and clap
   *  are not assignable to DecorationLayer, so they can never be listed. */
  layers: DecorationLayer[];
  /** Named density choices the dice picks between, per layer. Must contain an
   *  entry for every layer in `layers` and no others — which is why this is
   *  `Partial`: the total form would demand an entry for a layer the vibe
   *  deliberately leaves out, contradicting the rule it is meant to express.
   *  Invariant test 5 enforces the exact-match half that the type cannot. */
  densities: Partial<Record<DecorationLayer, DensityName[]>>;
}

export interface VibeVariation {
  /** Which progressions in CHORD_PROGRESSIONS this vibe may draw. */
  genre: VibeGenre;
  /** Roots that suit the genre. The dice picks one. */
  keyPool: string[];
  /** Inclusive [min, max] integer BPM. */
  bpmRange: [number, number];
  /** Ids into CHORD_PROGRESSIONS. */
  progressionIds: string[];
  /** Ids into RHYTHM_PATTERNS. */
  rhythmIds: string[];
  /** Ids into BASS_PATTERNS. */
  bassPatternIds: string[];
  drumDecoration: DrumDecorationRule;
}

// InstantVibe gains:  variation?: VibeVariation
// Optional, so a vibe without one simply has no dice.
```

Two deviations from the pinned shared block, both declared rather than silent:

1. **`VibeVariation` gains `genre: VibeGenre`.** `ChordProgression.genres` keys
   off `VibeGenre`, but nothing on `InstantVibe` says which genre a vibe is.
   Without this the mapping would have to be a second, parallel lookup table
   keyed by vibe id — a table that can drift out of step with the vibes. All
   pinned field names and types are otherwise unchanged.
2. **`DrumDecorationRule.densities` narrows** from `Record<string, number[][]>`
   to `Partial<Record<DecorationLayer, DensityName[]>>`. The pinned type cannot express
   the *names* that decision #3 requires, and the UI needs the name to tell the
   user what the beat became. Narrowing also makes "never a hand-typed row" a
   compile error instead of a test. `DrumDecorationRule` is B2-owned, so this
   does not touch B1's surface.

### The draw

```ts
// src/store/vibeVariation.ts
export interface VibeDraw {
  /** Uniform choice. Throws on an empty list — an empty pool is an authoring bug. */
  pick<T>(items: T[]): T;
  /** Uniform choice excluding `current`. Falls back to `current` only when it is
   *  the sole member of `items`. */
  pickDistinct<T>(items: T[], current: T): T;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
}

export function createDraw(random: () => number): VibeDraw;
```

`Math.random` is referenced in exactly one place in the codebase for this
feature: the `createDraw(Math.random)` call inside `rerollVibe`. Everything
below it takes a `VibeDraw`.

### The resolver

```ts
export interface VariationSummary {
  scaleRoot: string;
  scaleType: string;
  bpm: number;
  progressionName: string;
  progressionRoman: string;
  rhythmName: string;
  bassPatternName: string;
  drums: Array<{ layer: DecorationLayer; density: DensityName }>;
}

export function resolveVibeVariation(
  vibe: InstantVibe,
  current: { scaleRoot: string; chordRhythmId: string; bassPatternId: string },
  draw: VibeDraw,
): { vibe: InstantVibe; summary: VariationSummary };
```

`current` is read from the store by the caller — all three fields are plain
store values (`scaleRoot`, `chordRhythmId`, `bassPatternId`). No new state is
introduced to remember previous draws.

The resolver starts from the **authored** vibe every time, spreads it, and
overwrites exactly six fields:

| field | how |
| --- | --- |
| `scaleRoot` | `draw.pickDistinct(keyPool, current.scaleRoot)` |
| `bpm` | `draw.int(...bpmRange)` |
| `chordRhythmId` | `draw.pickDistinct(rhythmIds, current.chordRhythmId)` |
| `bassPatternId` | `draw.pickDistinct(bassPatternIds, current.bassPatternId)` |
| `chords` | `resolveProgression(prog, scaleRoot, vibe.scaleType, vibe.chordOctave)` where `prog` is `draw.pick(progressionIds)` resolved through `CHORD_PROGRESSIONS` |
| `drumPattern` | authored rows, with each layer in `layers` replaced (see below) |

`scaleType` is copied, never drawn — a test asserts this for every vibe and
every draw. `id`, `name`, `emoji`, `tagline` and `projectTitle` are copied, so
`resolveSelectedVibeId` keeps the chip highlighted after a reroll.

**Why three axes use `pickDistinct` and BPM does not.** With no undo, a press
that appears to do nothing is the worst failure mode — the user cannot tell
"unlucky draw" from "broken button". Forcing key, comp rhythm and bass pattern
to change guarantees an audible difference on every press. BPM is left as a
plain draw because Cyber EDM's range is only five values wide; excluding the
current one there would make the range four, and a repeated BPM cannot read as
"nothing happened" when the other three axes have moved. The progression is a
plain `pick` for the same reason — its pool is small, and a repeated
progression in a new key is already a different piece of music.

**B2 never transposes.** A reroll re-resolves the chosen progression from its
degrees directly in the new key. It never touches `transposeProgression` or
`snapProgressionToScale`, and is therefore structurally immune to the
auto-harmonize bug B1 fixes. (See "What B1 must provide" item 8 for the one way
that immunity can still be undone from outside.)

### Drum decoration

`kick` and `snare` are the genre's skeleton and are copied from the authored
vibe untouched. Only `hihat`, `openhat`, `tom` and `crash` are rewritten, and
only by choosing a whole row from a shared catalogue.

```ts
// src/store/vibeVariation.ts — one bar of sixteenths, step 0 = beat 1
export const DRUM_DENSITIES: Record<DensityName, number[]> = {
  off:          [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  downbeat:     [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  halves:       [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
  backbeat:     [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
  quarters:     [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
  offbeat8ths:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
  and2and4:     [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
  eighths:      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
  swung16ths:   [1,0,1,1, 1,0,1,0, 1,0,1,1, 1,0,1,0],
  lofi16ths:    [1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1],
  sixteenths:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
  pickup:       [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
  midBar:       [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0],
  lateFill:     [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,1,0],
  fillTail:     [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,1],
};
```

Every row is either a **regular subdivision of the bar** (`sixteenths`,
`eighths`, `offbeat8ths`, `quarters`, `halves`, `downbeat`, `backbeat`, `off`)
or a **fixed one-bar figure** in the genre's idiom (`swung16ths` is the boom-bap
hat, `lofi16ths` the lo-fi hat, `pickup` / `midBar` / `lateFill` / `fillTail`
are tom/open-hat accents). None is generated.

**The two genre-named rows are verified against the authored vibes, byte for
byte.** Cross-check item I4 reported `lofi16ths` and `swung16ths` as swapped,
which would have made the toast name the wrong pattern for what the user hears.
That was re-measured directly against the source rather than accepted:

| row | value | authored row it must equal |
| --- | --- | --- |
| `lofi16ths` | `[1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1]` | `lofi-chill.drumPattern.hihat` (`instantVibes.ts:166`) |
| `swung16ths` | `[1,0,1,1, 1,0,1,0, 1,0,1,1, 1,0,1,0]` | `hiphop-groove.drumPattern.hihat` (`instantVibes.ts:570`) |

Both matched exactly; the rows above are **correct as written and are not
changed**. I4 was a false positive. Because the risk it named is real —
a silent swap makes the toast lie — the identity is promoted from prose to
**invariant test 6b**, which asserts each of those two equalities against the
live `INSTANT_VIBES` data rather than against a copied literal.

**Three things stop a reroll from fighting the kick.**

1. **The skeleton is not in play.** `DecorationLayer` cannot name `kick`,
   `snare` or `clap`, so no draw can move the pulse or the backbeat. Whatever
   the hats do, the groove still lands where it landed.
2. **Rows are metrically regular by construction, never per-step draws.** A
   regular subdivision cannot syncopate against the kick: at worst it doubles a
   kick step, which is what hi-hats do anyway. This is decision #3's whole
   point — a coin flip per step produces rows like `[0,1,0,0,1,1,0,...]` that
   have no relationship to the pulse.
3. **A collision filter for the loud layers.** Before drawing, the resolver
   removes from the `openhat` and `tom` pools every candidate that places a hit
   on a step where the vibe's authored `kick` row already hits. An open hi-hat's
   decay smears the kick's attack and a tom occupies the kick's register, so
   those two must not double it. `hihat` and `crash` are **exempt**: closed hats
   are short and quiet and routinely double the kick, and a crash on a kick
   downbeat is the standard accent, not a clash.

   The filter can never empty a pool, because `off` is a member of every
   `openhat` and `tom` pool and collides with nothing. That is an invariant, and
   it is tested for every vibe rather than assumed.

   Measured over the authored data, the filter removes exactly one candidate in
   total: `and2and4` from `hiphop-groove`'s `openhat` pool, whose kick hits
   step 6. Every other `openhat` and `tom` pool survives intact. See *Accepted
   limitations*.

The resolved rows are written into `drumPattern` in the same
`Record<string, number[]>` shape the authored vibes already use, so
`applyInstantVibeToStore`'s existing `val === 1` conversion handles them with no
new code.

### Key pools

A vibe's `bassOctave` and `chordOctave` are fixed and are not rerolled, so the
root's position in the chromatic octave fixes the absolute pitch of the bass —
a root at C2 is 65 Hz and a root at B2 is 123 Hz, nearly an octave of spread
that the user cannot compensate for. The pools are therefore chosen from two
constraints:

- **Register (physical).** Vibes with a strong sub-oscillator one octave below
  the played root (`cyber-dance` 0.7, `synthwave-80s` 0.6) must stay off the
  bottom of the octave or the sub-osc fundamental falls under ~37 Hz and
  disappears on laptop and phone speakers, taking the pump with it. Vibes with a
  sustained drone bass under a long reverb tail (`ambient-chill` decay 5.8s,
  `asian-zen` 4.4s) must also stay off the bottom, or the drone smears into
  unpitched rumble. `lofi-chill` is exempt from that: its bass is filtered at
  260 Hz and a very deep, half-audible sub is the genre's texture, not a fault.
  `hiphop-groove` is exempt because a walking line spends most of its time above
  the root.
- **Genre convention (judgment).** Within the register window, the pool is the
  set of roots that read as normal for the genre.

| vibe | scale | key pool | window and reason |
| --- | --- | --- | --- |
| `lofi-chill` | Major | C, D, D#, F, G, A | the jazz/soul record keys lo-fi samples from (C, D, E♭, F, G, A); full lower-to-middle span allowed, deep sub is wanted |
| `synthwave-80s` | Natural Minor | D, E, F, F#, G, A | starts at D so the Saw Growl sub-osc stays above ~37 Hz; stops at A so the Neon Pluck stack at octave 4 keeps headroom under the arp's two octaves |
| `cyber-dance` | Natural Minor | D#, E, F, F#, G, A | the club-minor band; starts at D# for the same sub-osc floor, one step higher than synthwave because the Punchy Square carries more sub weight (0.7) |
| `ambient-chill` | Lydian | D, E, F, F#, G, A | avoids C, C#, D# entirely so a multi-bar drone through a 5.8s tail keeps a pitched fundamental above ~73 Hz |
| `hiphop-groove` | Dorian | C, D, D#, E, F, G | lower half only, so the walking line's upper notes stay under ~200 Hz where the Round Pluck's 420 Hz cutoff still shapes them |
| `asian-zen` | Hirajoshi | D, E, F#, G, A | koto-register roots (the instrument is conventionally tuned from around D); avoids the chromatic extremes where the Glocken Bell partials either muddy or thin out |

Every pool contains the vibe's authored `scaleRoot`, so the dice can land back
on the vibe's own key. That is an invariant and is tested.

### BPM ranges

Taken from the researched ranges, narrowed to the part of the range that still
reads as the genre rather than the full outer bounds.

| vibe | research | `bpmRange` | authored |
| --- | --- | --- | --- |
| `lofi-chill` | 70–90, core 80–85 | [78, 88] | 84 |
| `synthwave-80s` | 95–135, sweet spot 108–118 | [108, 118] | 118 |
| `cyber-dance` | 126–130 | [126, 130] | 128 |
| `ambient-chill` | 60–90 | [62, 80] | 72 |
| `hiphop-groove` | 85–95 | [85, 95] | 92 |
| `asian-zen` | **not found** | [70, 84] | 78 |

Zen's range is the one unsourced value: it is the authored 78 ± 6, matching the
breadth of the neighbouring slow genres. Every authored `bpm` lies inside its
own range; that is an invariant and is tested.

### Rhythm, bass and progression pools

| vibe | `rhythmIds` | `bassPatternIds` |
| --- | --- | --- |
| `lofi-chill` | `lofiSwing`, `syncopatedPush`, `bassPlusStrum` | `dilla-sub`, `walking-groove`, `half-time-legato` |
| `synthwave-80s` | `eighthPads`, `fourOnFloor`, `popBallad8ths` | `driving-eighths`, `offbeat-sub`, `root-fifth-walk` |
| `cyber-dance` | `offbeatStabs`, `fourOnFloor`, `eighthPads` | `offbeat-sub`, `driving-eighths`, `funk-octaves` |
| `ambient-chill` | `sustained`, `arpRollUp`, `arpDownEighths` | `whole-note-root`, `half-time-legato` |
| `hiphop-groove` | `syncopatedPush`, `lofiSwing`, `funkSyncopation` | `walking-groove`, `dilla-sub`, `classic-walk` |
| `asian-zen` | `sustained`, `arpRollUp`, `arpDownEighths` | `whole-note-root`, `half-time-legato` |

Each vibe's authored `chordRhythmId` and `bassPatternId` is a member of its own
pool — invariant, tested.

`progressionIds` is **not** hand-picked per vibe. The authoring rule is: take
every progression in `CHORD_PROGRESSIONS` whose `genres` includes the vibe's
`genre` and whose `minScaleLength` is at most
`SCALES[vibe.scaleType].intervals.length`, and list those ids. The field exists
so a specific progression can later be excluded from one vibe without editing
the library; today no vibe deviates from the rule. The implementer fills the
arrays from the library B1 ships, and the invariant test below catches any
drift.

Cross-check ruling R4 settled the size of that filter's output: **B1 ships four
progressions for every one of the six `VibeGenre` values**, and raises its own
coverage test's floor from three to four. So the derived `progressionIds` is at
least four entries for every vibe — including `ambient` and `zen`, the two
genres with no pre-existing category — and the 6 × 4 × 3 × 3 ≈ 216
key/harmony/comp/bass combinations quoted in "What B1 must provide" item 3 hold
for every vibe rather than for four of six.

### Drum decoration pools

| vibe | `hihat` | `openhat` | `tom` | `crash` |
| --- | --- | --- | --- | --- |
| `lofi-chill` | `lofi16ths`, `eighths`, `swung16ths` | `off`, `and2and4`, `pickup` | `off`, `pickup`, `fillTail` | `off`, `downbeat` |
| `synthwave-80s` | `sixteenths`, `eighths`, `offbeat8ths` | `off`, `offbeat8ths`, `pickup` | `off`, `fillTail`, `lateFill` | `off`, `downbeat` |
| `cyber-dance` | `offbeat8ths`, `sixteenths`, `eighths` | `off`, `offbeat8ths`, `pickup` | `off`, `lateFill`, `fillTail` | `off`, `downbeat` |
| `ambient-chill` | `off`, `backbeat`, `halves` | `off`, `pickup`, `midBar` | `off`, `midBar` | `off`, `downbeat` |
| `hiphop-groove` | `swung16ths`, `eighths`, `lofi16ths` | `off`, `pickup`, `and2and4` | `off`, `fillTail`, `pickup` | `off`, `downbeat` |
| `asian-zen` | `quarters`, `eighths`, `halves` | `off`, `pickup`, `midBar` | `off`, `midBar`, `pickup` | `off`, `downbeat` |

The research is applied directly: boom bap's hats sit on 8ths and swung 16ths
and never on straight 16ths; EDM's hats are offbeat-first; synthwave's are the
straight-16th machine grid; ambient's barely exist. `crash` is deliberately a
two-state choice everywhere — a crash anywhere but the downbeat of a looping
one-bar pattern is noise.

## UI

`src/components/InstantVibesBar.tsx` only. No new component file.

### The control

The dice appears **only on the loaded chip**, as the second half of a daisyUI
`join`:

```
[ ☕ Lo-Fi Chill  C · 84 ][🎲]      ← loaded vibe
[ 🏎️ Synthwave 80s  118 ]           ← others, unchanged
```

Unselected chips render exactly as today, a bare `btn btn-xs btn-soft`. The
selected chip is wrapped in `<div className="join shrink-0">` with the chip
button and the dice button both carrying `join-item`. Attaching the dice to the
chip makes its target unambiguous — it can only mean "reroll this" — and costs
no horizontal space in a row that already scrolls.

Classes, all verified against the daisyUI v5 docs:

- chip: `join-item btn btn-xs btn-primary` (as today, plus `join-item`)
- dice: `join-item btn btn-xs btn-primary btn-square`
- icon: lucide `Dices`, `w-3.5 h-3.5`, with `animate-spin motion-reduce:animate-none`
  while a 400 ms `isRolling` state is set on click. Both are core Tailwind
  utilities, not daisyUI.
- The dice carries `title` and `aria-label` (`Reroll Lo-Fi Chill`), matching the
  file's existing convention of `title` rather than the `tooltip` component.

### Telling the user what changed

Two signals, one transient and one persistent — necessary because there is no
undo, so the user must be able to read the current state at any time rather
than reconstruct it from a message they missed.

**Persistent: the chip itself.** The selected chip currently prints the
*authored* `vibe.bpm`, which stops being true the moment the dice is pressed.
The selected chip instead prints the store's live `scaleRoot` and `bpm`
(`C · 84`); unselected chips keep printing their authored BPM. The chip becomes
the always-visible readout of what is actually loaded.

**Transient: the toast.** The existing `toast toast-top toast-end` container is
reused with `alert alert-info alert-soft` — a different colour role from the
load toast's `alert-success`, so a reroll and a load are visually distinct. Two
lines:

```
🎲 Lo-Fi Chill — F Major · 81 BPM
I–IV–vi–V · Syncopated Soul Push · Soulful Walking Bass · drums: hats eighths, crash downbeat
```

**This example is illustrative of the layout only, not of a real draw.**
`I–IV–vi–V` is the `roman` of no `lofi`-tagged progression in B1's library —
every lo-fi entry is seventh/ninth harmony, per the research. The rhythm and
bass names are real (`syncopatedPush`, `walking-groove`), and the second line's
shape is what the pinned rules below produce; the roman numeral stands in for
whichever entry the dice actually drew, printed verbatim from
`ChordProgression.roman`.

It holds 4 s rather than the load toast's 3 s, since there is more to read. The
existing narrow-screen fallback pattern (`hidden md:inline` / `md:hidden`) is
kept, with `🎲 Rerolled` as the short form.

Both lines are produced by a pure exported helper in
`src/store/vibeVariation.ts`, so they are testable without a DOM, matching the
repo convention:

```ts
export function formatVariationSummary(
  summary: VariationSummary,
): { headline: string; detail: string };
```

The `detail` string is pinned exactly:

- Four `·`-joined segments, in this order: `progressionRoman`, `rhythmName`,
  `bassPatternName`, then the drum segment.
- The drum segment is `drums: ` followed by the comma-joined layers whose drawn
  density is **not** `off`, each printed as `<label> <densityName>`, in the
  fixed order hihat, openhat, tom, crash. Labels are `hats`, `open`, `tom`,
  `crash`. Layers drawn as `off` are omitted.
- When every decoration layer drew `off`, the segment is exactly `drums: bare`.

### Where reroll is wired

```ts
export function rerollVibe(
  vibe: InstantVibe,
  deps: { onToast: (text: string) => void },
): void;
```

Mirrors the existing `selectVibe`. It reads `scaleRoot` / `chordRhythmId` /
`bassPatternId` from the store for `current`, calls `resolveVibeVariation(vibe,
current, createDraw(Math.random))`, then `applyInstantVibeToStore(result.vibe)`
and the toast. It makes **no engine call of its own** — every stop, restart and
clock decision stays inside `applyInstantVibeToStore`, which is not modified by
this project.

### Escape hatch

Clicking the vibe chip re-applies the authored snapshot deterministically, so a
user who dislikes a reroll is one click from the vibe's original. This is not
undo — it discards every reroll, not the last one — and it is not presented as
undo anywhere in the UI.

## Files touched

| Layer | Files |
| --- | --- |
| types | `src/types.ts` — `InstantVibe` moves here; `DecorationLayer`, `DensityName`, `DrumDecorationRule`, `VibeVariation` added |
| store | `src/store/vibeVariation.ts` (new) — `DRUM_DENSITIES`, `createDraw`, `resolveVibeVariation`, `formatVariationSummary` |
| store | `src/store/instantVibes.ts` — `variation` populated for all six vibes; `InstantVibe` interface removed (re-exported as a type for existing importers is **not** kept) |
| ui | `src/components/InstantVibesBar.tsx` — join + dice, live chip readout, `rerollVibe` |
| tests | `src/store/vibeVariation.test.ts` (new), `src/components/InstantVibesBar.test.tsx` (extended) |

Read but not modified: `src/audio/data/chordProgressions.ts`,
`src/audio/rhythmPatterns.ts`, `src/audio/bassPatterns.ts`,
`src/utils/musicTheory.ts`.

`applyInstantVibeToStore` is **not modified**.

Importers of `InstantVibe` to update: `src/store/instantVibes.ts`,
`src/components/InstantVibesBar.tsx`, `src/components/InstantVibesBar.test.tsx`.

Layering: `src/store/vibeVariation.ts` imports from `src/audio/`, which is the
allowed direction (`engineSync.ts` already does it). It imports nothing from
`src/components/`. Run `bun run eslint` — this change adds cross-layer imports.

## Testing

Pure-logic `bun:test`, no DOM.

### Making the draw deterministic

Randomness is never exercised through `Math.random` in tests. Three fixtures:

1. `firstDraw` — `pick`/`pickDistinct` return the first eligible item, `int`
   returns `min`.
2. `lastDraw` — the last eligible item, `int` returns `max`.
3. `scriptedDraw(indices: number[])` — consumes a fixed list of indices, one per
   call, so a test can name the exact combination it wants and assert an exact
   `InstantVibe`.

`createDraw(random)` itself is tested against a stub `random` returning
`0`, `0.5`, `0.999…`, asserting the mapping to indices and to integer BPM is
uniform and in range — no statistics, three exact cases.

Policy properties that must hold for *every* draw are tested by **exhaustive
enumeration**, not sampling: every pool is a small finite list, so the tests
iterate the full product of candidates per vibe directly.

### Invariants over the authored data (all six vibes)

1. `scaleRoot ∈ keyPool`; `bpm ∈ [min, max]` and `min ≤ max`;
   `chordRhythmId ∈ rhythmIds`; `bassPatternId ∈ bassPatternIds`.
2. Every id in `rhythmIds` resolves in `RHYTHM_PATTERNS`; every id in
   `bassPatternIds` resolves in `BASS_PATTERNS`; every id in `progressionIds`
   resolves in `CHORD_PROGRESSIONS`, lists the vibe's `genre`, and has
   `minScaleLength <= SCALES[vibe.scaleType].intervals.length`.
3. `progressionIds` equals the full genre-and-scale-length filter over
   `CHORD_PROGRESSIONS` — this is what catches drift when B1 adds a
   progression.
4. `keyPool ⊆ ROOTS`, non-empty, no duplicates. Same for every id pool.
5. `Object.keys(densities)` equals `layers` exactly.
6. Every `DensityName` used resolves in `DRUM_DENSITIES`; every
   `DRUM_DENSITIES` row is length 16 and contains only 0 and 1.

   6b. **The two genre-named rows equal the hats they are named after.**
   `DRUM_DENSITIES.lofi16ths` deep-equals `lofi-chill`'s authored
   `drumPattern.hihat`, and `DRUM_DENSITIES.swung16ths` deep-equals
   `hiphop-groove`'s. Read from `INSTANT_VIBES`, not from a literal, so a
   future edit to either side fails. This is what stops the toast naming a
   pattern the user is not hearing.
7. For every vibe, after the kick-collision filter, the `openhat` and `tom`
   pools are still non-empty.
8. Every vibe has a `variation` (the field is optional in the type, but all six
   ship one).

### Resolver behaviour

9. `scaleType` is byte-identical to the authored value for every vibe under
   every draw. So are `id`, `projectTitle`, `chordOctave`, `bassOctave`,
   `chordFeel`, `bassFeel`, `soundKit`, and all four `*SynthParams` /
   `effects` objects.
10. `drumPattern.kick` and `drumPattern.snare` are byte-identical to the
    authored rows under every draw. So is `clap` where present.
11. For every vibe and every eligible candidate, no drawn `openhat` or `tom`
    row shares a step with the authored `kick` row.
12. `hihat` and `crash` are *not* subject to the collision filter — asserted on
    `lofi-chill`, whose kick hits steps 0 and 10 and whose whole hihat pool
    (`lofi16ths`, `eighths`, `swung16ths`) overlaps it, yet all three stay
    drawable. This pins the exemption as intentional rather than a gap.
13. `pickDistinct` never returns `current` when the pool has ≥ 2 members;
    returns `current` when the pool has exactly 1. Therefore, with `current`
    set to the authored values, a reroll always changes `scaleRoot`,
    `chordRhythmId` and `bassPatternId`.
14. `chords` are produced by `resolveProgression` in the drawn root: every
    chord's root is in `getScaleNotes(drawnRoot, vibe.scaleType)`, and the chord
    count equals the progression's step count (no collapsing).
15. `formatVariationSummary` — exact `headline` and `detail` strings for a
    scripted draw: the multi-layer case, a case where one layer drew `off` and
    is omitted, and the all-`off` case (`drums: bare`).

### Non-regression

16. With both players `playing` before the reroll, after `rerollVibe` both are
    `playing` again, and `audioEngine.stopSource` was called with
    `('chord', 0.02)` and `('bass', 0.02)`. This is the hard-stop-on-swap fix;
    `spyOn(audioEngine, 'stopSource')` makes it observable, and
    `InstantVibesBar.test.tsx` already spies on `audioEngine`.
17. With both players `stopped`, a reroll leaves both `stopped`.
18. **A reroll rewinds the shared bar grid, and that is intended.** With
    `startEngineSync()` running in the test process and both players
    `playing`, `rerollVibe` calls `audioEngine.resetClock` exactly once.

    Why it happens: `applyInstantVibeToStore` calls `hardStopAll()`, which
    takes the engineSync transport flags to 0, and then restarts the players
    that were running, which takes them back up. zustand's subscription is
    synchronous and not React-batched, so the `flags !== 0 && prevFlags === 0`
    branch in `engineSync.ts` genuinely runs. It is not an artefact of the
    test harness.

    Why it is wanted: the user tested exactly this on the vibe-chip click and
    reported it as good — "every press starts playing anew, the old sound
    doesn't hang over, good UX". A reroll is the same gesture on the same code
    path and gets the same treatment. The assertion exists so the behaviour is
    **pinned** rather than left to chance: it would otherwise be an emergent
    consequence of three separate mechanisms that a later refactor could
    silently drop.

    (An earlier draft of this spec asserted the opposite — that `resetClock` is
    *not* called — on the assumption that a mid-playback rewind would be a
    regression. Cross-check ruling R2 reversed it.)
19. `resolveSelectedVibeId(result.vibe.projectTitle)` still returns the vibe's
    id after a reroll — the chip stays highlighted.

`bun run verify` is the gate; `bun run eslint` is run separately.

## What B1 must provide

The shared context promises `CHORD_PROGRESSIONS`, `ChordProgression`,
`ProgressionStep`, `resolveProgression`, `transposeProgression` and
`snapProgressionToScale`. B2 uses the first four and neither of the last two.
Beyond the pinned signatures, B2 depends on eight guarantees:

1. `resolveProgression` returns `ChordItem`s whose `id`s are unique within the
   returned array. The chord list is keyed by id in the store and in
   `ChordView`.
2. `resolveProgression` never collapses two `ProgressionStep`s onto one chord,
   and returns exactly `steps.length` chords. B2 test 14 asserts this; if B1
   cannot guarantee it for five-note scales, B1 must say so and B2 will drop
   the affected progressions from the zen pool.
3. **At least four progressions per `VibeGenre`.** With three rhythm and three
   bass options, four progressions gives roughly 6 × 4 × 3 × 3 = 216 harmonic
   /arrangement combinations per vibe before drums. Fewer than four and the
   harmony axis is visibly repetitive. This includes the two genres with no
   existing category: `ambient` and `zen`. **Agreed by cross-check ruling R4** —
   B1's draft shipped three for `edm`, `ambient` and `zen` and pinned "at least
   three"; it now ships four everywhere and its coverage test's floor is four.
4. `SCALES` contains `Hirajoshi` (5 degrees) and `asian-zen.scaleType` is
   `'Hirajoshi'`. B2's zen key pool and its `minScaleLength <= 5` filter assume
   both.
5. `VibeGenre` remains exported from `src/audio/data/chordProgressions.ts` as
   pinned, but is **declared** in `src/types.ts` and re-exported from
   `chordProgressions.ts`. B2 needs it inside `src/types.ts` for
   `VibeVariation.genre`, and `chordProgressions.ts` already imports
   `ChordItem` from `src/types.ts`, so declaring it in `chordProgressions.ts`
   would make the two files import each other. B1 loses nothing: the pinned
   export site still resolves.
6. `resolveProgression`'s `octave` parameter accepts the vibe's `chordOctave`
   (4 for all six vibes today).
7. `ChordProgression.roman` is display-ready — B2 prints it verbatim in the
   toast and does not post-process it.
8. **`ChordView`'s auto-reharmonize effect must not act when chords arrive
   together with a key change.** This is the one way B2's immunity to the
   harmonize bug can be undone from outside. `applyInstantVibeToStore` sets
   `scaleRoot`, `scaleType` and `chords` in the same click; `ChordView.tsx:178`
   runs an effect on `[scaleRoot, scaleType]` with `autoReharmonize` defaulting
   to `true`, so after B1's fix the effect would see "root changed" and
   transpose the already-correct chords a second time, from the old root — and,
   because a vibe apply moves the scale type too, would also snap them. Both
   halves must be suppressed, not just the transpose.

   The mechanism is **B1's `chordsReplaced` identity guard** (B1 design, *Call
   sites* item 1): the effect holds `chords` in a ref, adds `chords` to its
   dependency list, and returns early when `chordsRef.current !== chords`. That
   asks "were the chords replaced?" rather than "did the root move?", so one
   condition covers the transpose and the snap axes together and needs no new
   store state and no ordering contract inside `applyInstantVibeToStore`.

   B2 previously proposed a `chordsSourceRoot` stamp on the store. It is
   **withdrawn** (cross-check ruling R1): it closes only the transpose half,
   would need a parallel `chordsSourceScaleType` to close the other, and adds
   store surface B1's non-goals exclude. B2 asserts the *requirement* here and
   leaves the mechanism to B1, which owns `ChordView.tsx`.

   This is already latent for the existing chip click; the dice makes it fire
   far more often.

Two type deviations B1 should be aware of, both re-stated from Architecture:
`VibeVariation` gains `genre: VibeGenre`, and `DrumDecorationRule.densities`
narrows to `Partial<Record<DecorationLayer, DensityName[]>>`. Neither changes
any name or type B1 owns.

## Accepted limitations

- **No undo and no locks.** A reroll is irreversible; re-clicking the chip
  restores the authored vibe, discarding every reroll. The risk that users
  become reluctant to press the dice was raised and accepted.
- **BPM can repeat.** Only key, comp rhythm and bass pattern are
  change-guaranteed. Cyber EDM's five-value range repeats about one press in
  five. The other three axes always moving means this never reads as a dead
  button.
- **The dice exists only while a vibe is loaded**, i.e. while `projectTitle`
  matches a vibe. Editing the project title deselects the chip and the dice
  disappears until a vibe is clicked again.
- **Boom Bap's open-hat pool is 2 candidates, not 3.** `hiphop-groove`'s kick
  hits steps 0, 6 and 9, and `and2and4` hits step 6, so the collision filter
  drops it — leaving `off` and `pickup`. The cost falls on the one genre whose
  research explicitly calls for open hats on the "and", and `pickup` (step 14,
  the "and" of beat 4) is the only one that survives. Measured, not assumed: the
  filter removes nothing from any other vibe's `openhat` or `tom` pool. Fixing
  it would mean either moving the kick — which decision #3 forbids — or adding a
  boom-bap-specific open-hat row that dodges step 6, which is a data edit and can
  be done later without touching the resolver.
- **A reroll can change the chord loop's length while the drum pattern stays
  one bar.** Drum rows are always 16 steps, but a drawn progression's total
  `bars` is whatever B1 authored: ambient entries run 16 bars (`8 + 8`, `4×4`)
  or 8, EDM entries 8 (`4 × 2 bars`), lo-fi and boom bap mostly 4. So the beat
  can loop 16 times under one pass of the harmony where it previously looped 8.
  This is normal for the genres involved — a long modal vamp over a short beat is
  the ambient idiom — and the two players stay phase-locked because both count
  the same shared bar grid. It is recorded because the *perceived* loop length
  changes between presses without the UI saying so.
- **Crash is effectively a one-bit choice** (`off` / `downbeat`) in every vibe,
  so it contributes almost nothing to the variation. This is intentional; a
  crash elsewhere in a looping one-bar pattern is noise.
- **Ambient and Zen have only two bass patterns each**, so their bass axis
  repeats on every second press. `BASS_PATTERNS` has no third pattern suited to
  a drone; adding one is out of scope.
- **Decoration does not return to the authored beat.** Unlike key, BPM and the
  rhythm/bass ids, a vibe's authored decoration rows are not required to be
  members of its density pools. Two of them are in the catalogue anyway
  (`lofi16ths` and `swung16ths` are the lo-fi and boom-bap hats verbatim,
  because those two rows are genre-defining); the rest are hand-tuned one-offs
  that would each cost a catalogue entry for no musical gain. The authored beat
  is still reachable by clicking the chip.
- **One stray drum hit after a reroll.** Inherited from
  `applyInstantVibeToStore`: `triggerDrum` builds untracked fire-and-forget
  nodes, so at most one already-scheduled hit can land within
  `CLOCK_LOOKAHEAD` (100 ms) of the press.
- **Key pools are a judgment call.** The register half of the reasoning is
  physical and checkable; the genre-convention half is taste, unlike the BPM
  ranges, which are sourced. The pools are plain data and are one-line edits.
- **Zen's BPM range is unsourced** — no production guide gave a range for the
  genre, so it is the authored tempo ± 6.

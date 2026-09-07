# Authoring library entries for a vibe

Read this only when the survey showed a real gap. If an existing progression and
three existing presets fit, stop — reuse costs nothing and inherits tested data.

## Contents

- [Is it actually a gap?](#is-it-actually-a-gap)
- [Authoring a chord progression](#authoring-a-chord-progression)
- [Authoring a synth preset](#authoring-a-synth-preset)
- [Choosing what a vibe pools](#choosing-what-a-vibe-pools)

## Is it actually a gap?

The bar that Phase 2 of the reference migration settled on, after filling 16 of 18
role slots from a 27-preset library:

**Name the closest existing candidate and say precisely what disqualifies it.** Not
"nothing quite fits" — "`factory-string-ensemble` has the right saw and detune but
`attack: 0.35` is longer than the 0.254 s eighth note it must articulate at 118 BPM."
If you cannot write that sentence, it is not a gap; you have a preference, and the
existing preset wins.

Two more rules from that migration:

- **One new entry per gap, not per vibe.** Two vibes with the same hole share one
  preset. The library is a shared resource, not per-vibe storage.
- **Presets never carry genre.** A preset is a timbre role. Genre lives on the vibe
  and on `ChordProgression.genres`. Tagging presets by genre was proposed and
  rejected: it asks a question that often has no answer, and user-created presets
  would have to answer it too.

## Authoring a chord progression

Entries live in `CHORD_PROGRESSIONS` (`src/data/chordProgressions.ts`), appended
before the closing `];`. Shape:

```ts
{
  id: 'lofi-morning-turnaround',
  name: 'Morning Brew Turnaround',
  roman: 'Imaj7 – vim7 – iim7 – V7',
  description: '...',
  category: 'Lofi & R&B',      // ProgressionCategory, a closed union
  referenceScale: 'Major',     // the scale this was authored against; a vibe pooling it must play the same one
  genres: ['lofi'],            // free-form browsing tag; nothing computes from it
  minScaleLength: 7,           // SCALES[referenceScale].intervals.length
  steps: [step(0, 1, 'maj7'), step(5, 1, 'min7'), step(1, 1, 'min7'), step(4, 1, '7')],
}
```

`step(degree, bars = 1, quality?)` is a module-local helper. Degrees are 0-indexed.

### The trap that silently downgrades every seventh chord

`resolveProgression` computes the chord as `progressionStep.quality ?? diatonic.quality`,
and the diatonic lookup it uses (`getDiatonicChordForDegree(degree, root, scaleType, false)`)
returns **the triad, never the seventh**. So any step you intend as a seventh chord
must carry an explicit `quality` — *including* where that quality happens to equal
the scale's own seventh-chord table entry. Omit it and the chord quietly becomes a
triad, with no test to catch it unless you assert the resolved qualities.

Write a resolution test for each new entry — the four Phase 1 entries each have one:

```ts
expect(resolveProgression(p, 'C', 'Major', 4).map((c) => `${c.root}${c.quality}`))
  .toEqual(['Cmaj7', 'Amin7', 'Dmin7', 'G7']);
```

### `roman` is user-visible

The reroll toast prints it verbatim. It must describe the chords the steps actually
produce — writing `I – vi – ii – V` over `maj7/min7/min7/7` steps tells the user
triads while sevenths play. Match the file's house style: lower-case for minor,
`m7`/`maj7` suffixes, and `VII`/`III` written without a flat sign.

### Research-backed conventions, pinned by hardcoded id lists

`src/audio/chordProgressions.test.ts`'s `describe('authoring conventions from the
research')` pins these rules, and they are not negotiable by the new entry — if
your idea conflicts, the idea changes:

| style | rule |
|---|---|
| ambient | every step `bars >= 4`, and no V-I — **including across the loop point** |
| lofi, boombap | every step's quality matches `/7\|9\|11\|13/` — an extension on every chord |
| edm | one uniform bar count per progression, and ≥3 of the five entirely 2-bar |
| zen | playable on five notes — `minScaleLength: 5`, no degree above 4 |

**These tests do not read `genres` at all.** Each one iterates a hardcoded id array
in that file (`EDM_IDS`, `AMBIENT_IDS`, `EXTENSION_IDS`, `ZEN_IDS`) via a local
`byIds()` helper. Tagging your new entry `genres: ['edm']` documents it for a human
browsing the library; it does **not** enrol the entry in the `edm` convention test.
If your entry should be held to one of these rules, add its id to the matching
array in `chordProgressions.test.ts` by hand.

Also: no entry may rely on degree wrapping, ids must be unique, and `minScaleLength`
must equal the reference scale's real degree count. Hirajoshi has **5** degrees and
the pentatonics 5-6 — never copy `7` as a default.

A tag here is browsing metadata only — adding one to an entry does not join it to
any vibe's dice pool. If a vibe should be able to roll it, add its id to that
vibe's own `random.progressions` in `src/data/vibes.ts`.

## Authoring a synth preset

One array now: append to `SYNTH_PRESETS` in `src/data/synthPresets.ts`, `category: 'Bass'`
selecting the bass role. Ids follow the file's convention: `factory-*` for most, `bass-*` for
the five that predate the merge. **Both id and name must be unique** across
`SYNTH_PRESETS` — pinned by `src/data/synthPresets.test.ts` and
`src/audio/presetRegistry.test.ts`. Name uniqueness matters because
`resolveVibeSynthParams` stamps the resolved entry's `name` into `params.preset`, and
the preset UI selects back by name.

`params` is a `Partial<SynthParams>`; anything omitted falls back to
`INITIAL_SYNTH_PARAMS`. Prefer authoring the full timbre set — every existing entry
does, so a half-specified preset reads as an accident.

### Four engine facts that decide whether your numbers do anything

1. **The filter sweeps upward from `filterCutoff`.** It goes
   `filterCutoff → filterCutoff + filterEnvAmount → + filterEnvAmount * filterSustain`,
   and never below the base cutoff.
2. **A cutoff above the oscillator's harmonic energy makes the whole filter section
   inaudible.** A triangle wave has almost nothing above its 9th harmonic, so a
   triangle voice at ~390 Hz with `filterCutoff: 3200` has its cutoff, resonance,
   envelope amount and filter ADSR all doing nothing you can hear. Match the cutoff
   to the oscillator and the register the voice will actually play in: the library's
   sine and triangle entries sit at `filterEnvAmount` 400-900, its saw and square
   entries at 2200-3500, and that correlation is not a coincidence.
3. **`octave` stacks with the vibe's own octave.** `chordOctave`/`bassOctave` choose
   the note names; `params.octave` then transposes again. `factory-glocken-bell` and
   `factory-celestial-shimmer` carry `+1` deliberately; the negative-octave bass
   presets exist for voices that are not already sitting at `bassOctave: 2`.
4. **`noiseVolume` is a real third source** into the same filter and amp envelope,
   scaled directly by the value. The library uses 0.01-0.05 for an air layer and 0.4
   for an FX riser. (It was inert until recently — older notes calling it decorative
   are stale.)

### No arp, ever

No preset sets `arpActive`, `arpMode`, `arpRate` or `arpOctaves`, and an invariant
test pins that. The arpeggiator is a performance control the user drives; baking it
into a preset would drag it along every role that preset is reused for.

### Write the test with the preset

Assert the parameters that carry the argument you made for the gap — if you claimed
the release outlasts the note gap so stabs glue into a bed, assert the release. A
test that only checks the entry exists adds nothing.

Note what a data test cannot tell you: it pins numbers, not audible behaviour. Name
such a test for what it does ("pins a filter envelope that closes before the amp
decay finishes"), not for a sound you have not heard.

## Choosing what a vibe pools

There is no genre union and no quota. A vibe's `random.progressions` is a taste
call, bounded by two facts about the scale it plays: every member must have
`referenceScale === vibe.scaleType`, and `minScaleLength` no greater than that
scale's degree count. Two invariant tests enforce exactly that and nothing more.

`ChordProgression.genres` is a free-form `string[]` for human browsing. Nothing
computes from it, so tagging a progression `kpop` widens no type and obliges no
other file to change.

Prefer reuse. A pool of existing progressions that suit the vibe is a better
answer than four new ones, and `bun run report:library` will show you which
entries nothing has claimed yet.

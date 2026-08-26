# Progression Library as Degrees, and the Auto-Harmonize Fix — Design

Date: 2026-08-26
Status: Approved, not yet implemented
Scope: Project B1 of the Vibe Variation work. B2 (the dice / Vibe Variation Engine)
consumes what this project produces and is out of scope here. Project A
(Automation Player Transport) is already specified separately.

## Problem

### 1. Progressions are stored as absolute semitone intervals

`src/audio/data/chordProgressions.ts` holds 22 templates as
`relativeChords: Array<{ interval, quality, bars }>`, where `interval` is
semitones from the key root. That representation is key-relative but **scale-
blind**: `I – V – vi – IV` is stored as `0, 7, 9, 5` with hard-coded
`maj/maj/min/maj`. It cannot be re-used in a different scale, cannot be sampled
by a genre-aware randomiser, and duplicates knowledge that `SCALES` already
holds. A shared library that both `ChordPresetLibrary` and the dice draw from
has to speak in scale degrees.

### 2. Auto-harmonize scrambles the progression whenever the key changes

`reharmonizeProgressionToScale(chords, newRoot, newScaleType, octave)`
(`src/utils/musicTheory.ts:215`) never receives the **source** key. All it can
compute is how far each chord sits from the *new* root
(`musicTheory.ts:227`), then it snaps that to the nearest degree of the new
scale. That is correct when the chords are already in the target key and you
only want to force them into the scale. It is wrong whenever the root changes,
because the input chords are still in the old key.

Measured, not assumed:

```
A Natural Minor, i–VI–III–VII :  Amin – Fmaj – Cmaj – Gmaj
reharmonised to C Nat. Minor  :  G#maj – Fmin – Cmin – Gmin   (= bVI–iv–i–v)
correct transposition          :  Cmin – G#maj – D#maj – A#maj (= i–bVI–bIII–bVII)
```

The tonic moves from position 1 to position 3 — a different progression, not
the same one in a new key. A second failure: to F# Natural Minor the same input
yields `Amaj – F#min – Bmin – F#min`, where two distinct chords collapse onto
one degree and a 4-chord progression becomes 3 with a repeat. Collapse gets
worse the fewer notes the scale has, so pentatonic and Hirajoshi are the
dangerous cases.

This is live today: `ChordView.tsx:178` runs an effect on `[scaleRoot,
scaleType]` and `autoReharmonize` defaults to `true` (`ChordView.tsx:128`), so
changing the key in the header scrambles the user's progression right now.

`ChordPresetLibrary.tsx:131` is *not* affected: it transposes the template via
`rc.interval` first, so reharmonize then runs on chords already in the target
key — the case the function handles correctly.

### 3. The same effect also corrupts Instant Vibes

`applyInstantVibeToStore` writes `scaleRoot`, `scaleType` and `chords` in one
batch. The `ChordView` effect keys on `[scaleRoot, scaleType]` only, so it fires
afterwards and reharmonizes the *vibe's own* chords against the vibe's own key —
chords that were authored to be correct already. The vibe you hear is not the
vibe that was authored.

### 4. Zen Garden is not on the scale it claims

`src/store/instantVibes.ts:657` sets `scaleType: 'Pentatonic Major'`. There is
no such key in `SCALES` (the real key is `'Major Pentatonic'`), so every lookup
falls through `SCALES[scaleType] || SCALES['Major']` and the vibe silently runs
in **Major**. Separately, the research says the Yo scale (≈ Major Pentatonic) is
bright and festive with no minor notes; the meditative Japanese sound is
Hirajoshi, which emphasises the half-step. The vibe's name and its sound
disagree twice over.

### 5. The library does not cover the genres

There is no ambient category at all. `bars` is `1` in 96 of 99 slots, so nothing
matches EDM's 2-bars-per-chord or ambient's 4+-bar vamps, and no progression is
playable on a 5-note scale.

## Goals

- One shared progression library, in **degree form**, that both
  `ChordPresetLibrary` and B2's dice read.
- All 22 existing progressions migrated, with a machine-checked proof that no
  progression's sound changed in its original key and scale.
- Changing the key transposes; changing the scale snaps; changing both does
  both, in that order.
- Applying an Instant Vibe or a library preset never triggers auto-harmonize.
- Hirajoshi in `SCALES`, with hand-authored per-degree qualities, and Zen Garden
  moved onto it.
- Every genre in the research table has progressions that match its documented
  conventions, and every progression is tagged with `genres` and
  `minScaleLength`.

## Non-goals

- Chromatic / borrowed chords as a first-class step type. `ProgressionStep` has
  `degree` and an optional `quality`; there is no "raw semitone" escape hatch.
  See *Migration rules* for what happens to the chromatic entries, and *Accepted
  limitations* for the consequence.
- Storing a source key on user-saved custom progressions. They stay absolute
  chords and can therefore only be snapped, never transposed.
- Any change to the dice, `VibeVariation`, or `DrumDecorationRule` — B2 owns
  those.
- Voice leading, inversions, or voicing selection. `deriveChordNotes` stays the
  single source of truth for `ChordItem.notes`.
- A migration or store-version bump. The app has no users; persisted
  `scaleType: 'Pentatonic Major'` values are not preserved.

## Architecture

### Hirajoshi

Added to `SCALES` under the key `'Hirajoshi'`, category `'World & Exotic'`
(declared but so far unused), display name `'Hirajoshi (Japanese)'`.

```
intervals: [0, 2, 3, 7, 8]      // 1, 2, b3, 5, b6
step pattern: 2 – 1 – 4 – 1 – 4  (two half-steps, two major thirds)
```

This is the Burrows/Wikipedia spelling, the one cited by the research and the
one most guitar and koto references use.

**How the qualities were derived.** Stacking scale-steps (degree i, i+2, i+4)
on a scale with two major-third gaps does not produce tertian chords — degree 0
would come out `{0,3,8}` (a minor triad with a raised fifth) and degree 4
`{0,6,11}`. Those are not names any user recognises and several are not tonal
chord types at all. The repo's existing pentatonic tables solve this a different
way: `Major Pentatonic` uses `['maj','min','min','maj','min']`, which is exactly
degrees I, ii, iii, V, vi of the parent major scale, and `Minor Pentatonic`
takes i, bIII, iv, v, bVII from natural minor. The convention is **inherit the
quality from the parent 7-note scale that contains the pentatonic**.

Hirajoshi `{0,2,3,7,8}` is a subset of natural minor `{0,2,3,5,7,8,10}`, at
natural-minor degrees 1, 2, 3, 5, 6 — i.e. i, ii°, bIII, v, bVI.

One deliberate deviation from the parent. On degree 3 the parent gives `min`
(root, b3, 5 → adds a semitone-10 that Hirajoshi does not contain), while
`sus4` — root, 4th, 5th taken as degrees 3, 4, 0 of the scale — is **entirely
inside the 5 notes** and is the canonical open-fourth koto sound. The
hand-authored table exists precisely so this choice can be made, so degree 3 is
`sus4` / `7sus4`.

```ts
triadQualities:   ['min',  'dim',   'maj',  'sus4',  'maj']
seventhQualities: ['min7', 'm7b5',  'maj7', '7sus4', 'maj7']
```

**What `getDiatonicChordForDegree` returns**, in C (roman numerals are
positional, as the existing function computes them):

| degree | semitone | root in C | triad | 7th | roman | notes outside the scale |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | C | `min` | `min7` | `i` | triad: none · 7th: A# |
| 1 | 2 | D | `dim` | `m7b5` | `ii` | F |
| 2 | 3 | D# | `maj` | `maj7` | `III` | A# |
| 3 | 7 | G | `sus4` | `7sus4` | `IV` | triad: none · 7th: F |
| 4 | 8 | G# | `maj` | `maj7` | `V` | none, either form |

So: **triads on degrees 0, 3 and 4 and the maj7 on degree 4 are fully inside
the scale; every other chord contributes exactly one outside tone.** That is
inherent to a half-step-heavy pentatonic — there are only five notes and a
triad needs three of them a third apart — and it is the same trade the existing
pentatonic tables already make (`Major Pentatonic` degree 0 `maj7` reaches
outside for its leading tone). The three fully-in-scale chords are enough to
build a progression that never leaves the scale, and the Zen progressions below
are built from them.

`getScaleNotes('G', 'Hirajoshi')` → `['G', 'A', 'A#', 'D', 'D#']`.

**Zen Garden** (`src/store/instantVibes.ts`, id `asian-zen` — the id stays,
only the data changes) gets `scaleType: 'Hirajoshi'`, keeps `scaleRoot: 'G'`,
and its `chords` become `zen-bamboo-vamp` resolved in G Hirajoshi:
`Gmin – Dsus4 – Gmin – D#maj`, 2 bars each — the same 8-bar length as today,
and every note inside the scale.

### Progression data model

`src/audio/data/chordProgressions.ts` is rewritten. `ProgressionTemplate` and
`CHORD_PROGRESSION_TEMPLATES` are deleted outright — no side-by-side
representation, no compatibility alias.

```ts
// Declared in src/types.ts and re-exported here, so the export site the shared
// context pins stays valid. See "Deviations from the shared context" item 4.
export type { VibeGenre } from '../../types';

export type ProgressionCategory =
  | 'Pop & EDM' | 'Jazz & Neo-Soul' | 'Lofi & R&B' | 'Rock & Blues'
  | 'Anime & J-Pop' | 'Cinematic & Modal' | 'Classical & Baroque'
  | 'Ambient & Zen';                    // new chip

export interface ProgressionStep {
  degree: number;      // 0-based; wraps modulo the scale's own length
  quality?: string;    // overrides the diatonic quality; omit for the scale's own
  bars: number;        // 1 lofi/boom bap, 2 EDM, 4+ ambient
}

export interface ChordProgression {
  id: string;
  name: string;
  roman: string;                  // true in referenceScale
  description: string;
  category: ProgressionCategory;  // library chip
  referenceScale: string;         // key of SCALES the degrees were authored in
  genres: VibeGenre[];            // empty = library-only, never randomised
  minScaleLength: number;
  steps: ProgressionStep[];
}

export const CHORD_PROGRESSIONS: ChordProgression[];
export const VIBE_GENRE_SCALES: Record<VibeGenre, string>;
export function progressionById(id: string): ChordProgression | undefined;

export function resolveProgression(
  progression: ChordProgression,
  scaleRoot: string,
  scaleType: string,
  octave?: number,      // default 4
): ChordItem[];
```

Three rules fix the meaning of the fields, each with exactly one reading:

1. **An omitted `quality` always means the scale's *triad* quality for that
   degree** — `getDiatonicChordForDegree(degree, root, scaleType, false)`. A
   progression that wants sevenths writes them out. This is what the shared
   interface's comment already anticipates ("genres whose identity is extended
   harmony set this"); it is stated here because `ProgressionStep` carries no
   `use7ths` flag and the alternative readings are silently different music.
2. **`minScaleLength = SCALES[referenceScale].intervals.length`** — 7 for every
   diatonic reference, 5 for Hirajoshi. It is the length of the scale the
   qualities were chosen against, which is the only length at which the entry
   is guaranteed to sound as named.
3. **A genre tag may only be applied when `referenceScale` equals that genre's
   vibe scale**, per `VIBE_GENRE_SCALES`:
   `lofi→Major`, `synthwave→Natural Minor`, `edm→Natural Minor`,
   `ambient→Lydian`, `boombap→Dorian`, `zen→Hirajoshi`.
   This makes "the dice never hands a vibe a progression written for another
   scale" a mechanically checkable property rather than an intention.

`resolveProgression` is:

```
steps.map((step, i) => {
  const d = getDiatonicChordForDegree(step.degree, scaleRoot, scaleType, false);
  const quality = step.quality ?? d.quality;
  return deriveChordNotes(
    { id: `${progression.id}-${i}`, root: d.root, quality, bars: step.bars, notes: [] },
    octave ?? 4,
  );
})
```

It does **not** enforce `minScaleLength`; degrees wrap, per the field's
documented semantics. Filtering is the caller's job (see *Call sites*).

### Migration rules — interval form to degree form

Each progression is migrated against a declared `referenceScale`, chosen by this
rule:

1. Pick the first scale S in the fixed preference order
   `[Major, Natural Minor, Dorian, Mixolydian, Lydian, Phrygian, Harmonic
   Minor]` such that **every chord root interval in the progression is one of
   S's `intervals`**, and no two chords that were distinct in interval form land
   on the same degree.
2. `degree` = the index of that interval in `S.intervals`.
3. `quality` is **omitted** when the original quality equals `S.triadQualities
   [degree]`, and written out verbatim otherwise. Chromatic *qualities* on
   diatonic roots (a secondary dominant `VI7`, a `maj9`, a `m7b5`) are therefore
   preserved exactly by the override.
4. `bars` is copied verbatim.

**Chromatic roots** are handled by step 1, not by an escape hatch: a root that
is not a degree of the obvious scale is a root that belongs to a different mode.
`I – bVII – IV` is not chromatic Major, it is diatonic **Mixolydian** (degrees
0, 6, 3). `Imaj7 – bVImaj7 – bIImaj7 – V7sus4` is diatonic **Phrygian** (degrees
0, 5, 1, 4). All 22 existing progressions migrate losslessly this way — none is
dropped, none is approximated, no `quality` is lost.

For progressions added later: if no scale in `SCALES` contains every chord root,
the progression **is not admissible** in degree form and must either be
re-voiced onto a reference scale or kept out of the library. Snapping it to a
"nearest" degree is explicitly forbidden — that is the collapse behaviour this
project exists to remove.

#### Migration table

Degrees are written `d` or `d:quality` where a quality override is written out.

| id | name | ref scale | steps | bars | genres |
| --- | --- | --- | --- | --- | --- |
| `pop-i-v-vi-iv` | Classic 4-Chord Pop Anthem | Major | 0, 4, 5, 3 | 1×4 | — |
| `pop-vi-iv-i-v` | Emotional Minor Synthwave | Major | 5, 3, 0, 4 | 1×4 | — |
| `pop-doowop` | Classic 50s Doo-Wop Cadence | Major | 0, 5, 3, 4 | 1×4 | — |
| `pop-future-bass` | Future Bass / Euphoric EDM Lift | Major | 3:maj7, 4:7, 2:min7, 5:min7 | 1×4 | — |
| `pop-club-house` | Club Dance & House Groove | Natural Minor | 0:min7, 5:maj7, 6:7, 4:min7 | 1×4 | synthwave, edm |
| `jazz-ii-v-i-vi` | Jazz ii-V-I-VI Turnaround | Major | 1:min7, 4:7, 0:maj7, 5:7 | 1×4 | lofi |
| `jazz-neosoul-butter` | Neo-Soul Butter Flow | Major | 0:maj9, 6:m7b5, 2:7, 5:min9 | 1×4 | lofi |
| `jazz-chromatic-mediants` | Chromatic Mediants / Giant Step Cycle | Phrygian | 0:maj7, 5:maj7, 1:maj7, 4:7sus4 | 1×4 | — |
| `lofi-coffeehouse` | Lofi Extended 9th Coffeehouse | Major | 1:min9, 4:7, 0:maj9, 3:maj7 | 1×4 | lofi |
| `lofi-trapsoul` | Contemporary R&B / Trap-Soul Flow | Natural Minor | 0:min9, 3:min7, 6:9, 2:maj7 | 1×4 | — |
| `lofi-bedroom-pop` | Melancholy Bedroom Pop | Major | 0:maj7, 3:maj7, 1:min7, 4:7 | 1×4 | lofi |
| `jpop-royal-road` | Royal Road / Oudo Cadence (王道進行) | Major | 3:maj7, 4:7, 2:min7, 5:min7 | 1×4 | — |
| `jpop-marusa` | City Pop / Marusa Groove (丸サ進行) | Major | 3:maj7, 2:7, 5:min7, 0:7 | 1×4 | — |
| `jpop-heroic` | Heroic Anthem / J-Rock Drive | Major | 5, 3, 4, 0 | 1×4 | — |
| `blues-12bar` | 12-Bar Blues Standard | Major | 0:7, 3:7, 0:7, 4:7, 3:7, 0:7 | 2,1,1,1,1,2 | — |
| `rock-mixolydian` | Mixolydian Rock Anthem | Mixolydian | 0, 6, 3, 0 | 1×4 | — |
| `rock-andalusian` | Andalusian / Flamenco Descent | Natural Minor | 0, 6, 5, 4:7 | 1×4 | — |
| `cine-epic-ostinato` | Epic Cinematic Ostinato | Natural Minor | 0, 5, 2, 6 | 1×4 | synthwave |
| `cine-dorian-voyage` | Dorian Space Voyage | Dorian | 0:min7, 3:7, 0:min7, 3:7 | 1×4 | boombap |
| `cine-lydian-dream` | Lydian Dreamscape | Lydian | 0:maj7, 1, 0:maj7, 1 | 1×4 | — |
| `baroque-canon` | Baroque Canon Cadence | Major | 0, 4, 5, 2, 3, 0, 3, 4 | 1×8 | — |
| `baroque-passacaglia` | Passacaglia / Circle of Fifths Descent | Natural Minor | 0, 3, 6, 2, 5, 1, 4:7, 0 | 1×8 | — |

`category` for each is its current category verbatim. `roman`, `name` and
`description` are carried over unchanged, including the Japanese suffixes on
`jpop-royal-road` (王道進行) and `jpop-marusa` (丸サ進行) — the names in the
existing file carry them and they are part of the entry, not decoration.

`pop-club-house` carries **two** genre tags. Both `synthwave` and `edm` map to
`Natural Minor` in `VIBE_GENRE_SCALES`, so rule 3 permits it, and it is the
fourth `edm` entry ruling R4 requires. Its `bars` stay `1` — they are copied
verbatim and the migration proof forbids touching them — which is why the `edm`
convention test is written as *uniform bars per entry* rather than *always 2*;
see *Testing* item 2 and *Accepted limitations*.

Note `pop-future-bass` and `jpop-royal-road` have identical steps — they were
already the same progression in interval form. Both are kept as separate library
entries; de-duplication is out of scope.

#### New progressions

18 additions. Each block states its `category`, and **every entry carries its
`genres` list explicitly** — B2 authors each vibe's `progressionIds` as the exact
output of the genre-and-scale-length filter over `CHORD_PROGRESSIONS` and pins it
with a test, so an implied tag is a failing test in B2, not a judgement call.

**Ambient — Lydian, `minScaleLength: 7`, 4+ bars, no V–I** (`category: 'Ambient & Zen'`)

| id | name | roman | steps | bars | genres |
| --- | --- | --- | --- | --- | --- |
| `ambient-still-water` | Still Water Pedal | Imaj7 – vim7 | 0:maj7, 5:min7 | 8, 8 | `['ambient']` |
| `ambient-lydian-drift` | Lydian Drift | Imaj7 – II – iiim7 – II | 0:maj7, 1, 2:min7, 1 | 4×4 | `['ambient']` |
| `ambient-open-fourths` | Open-Fourth Vamp | Isus2 – IIsus2 | 0:sus2, 1:sus2 | 4, 4 | `['ambient']` |
| `ambient-glass-horizon` | Glass Horizon | vim7 – Imaj7 – iiim7 – IIsus2 | 5:min7, 0:maj7, 2:min7, 1:sus2 | 4×4 | `['ambient']` |

No entry contains degree 4 at all, so none carries a V–I cadence — including
across the loop point. `ambient-glass-horizon` is the fourth entry ruling R4
requires; it is the only one that does not begin on the tonic, which is what
makes it audibly a different draw rather than a re-ordering of the others.

**EDM — Natural Minor, 2 bars per chord** (`category: 'Pop & EDM'`)

| id | name | roman | steps | bars | genres |
| --- | --- | --- | --- | --- | --- |
| `edm-cyber-drop` | Cyber Drop Loop | i – VII – VI – VII | 0, 6, 5, 6 | 2×4 | `['edm']` |
| `edm-neon-rise` | Neon Rise | i – VI – III – VII | 0, 5, 2, 6 | 2×4 | `['edm']` |
| `edm-arena-sweep` | Arena Sweep | i – III – VII – VI | 0, 2, 6, 5 | 2×4 | `['edm']` |

These are the three shapes the research names for 126–130 BPM EDM. The fourth
`edm` entry is the cross-tag on the migrated `pop-club-house`, above.

**Synthwave — Natural Minor, 1 bar per chord** (`category: 'Pop & EDM'`)

| id | name | roman | steps | bars | genres |
| --- | --- | --- | --- | --- | --- |
| `synthwave-midnight-drive` | Midnight Drive | i – iv – VI – V | 0, 3, 5, 4:maj | 1×4 | `['synthwave']` |
| `synthwave-neon-horizon` | Neon Horizon | i – VII – III – VI | 0, 6, 2, 5 | 1×4 | `['synthwave']` |

`4:maj` on `synthwave-midnight-drive` is the documented "occasional modal
borrowing for brightness" — a major V over a natural-minor scale. With the two
migrated entries (`pop-club-house`, `cine-epic-ostinato`) this genre has four.

**Lo-Fi — Major, sevenths and ninths throughout** (`category: 'Lofi & R&B'`)

| id | name | roman | steps | bars | genres |
| --- | --- | --- | --- | --- | --- |
| `lofi-rainy-window` | Rainy Window | vim9 – IVmaj7 – ii9 – V7 | 5:min9, 3:maj7, 1:min9, 4:7 | 1×4 | `['lofi']` |
| `lofi-tape-loop` | Tape Loop | Imaj9 – vim7 – ii9 – V9 | 0:maj9, 5:min7, 1:min9, 4:9 | 1×4 | `['lofi']` |

`lofi-tape-loop`'s last chord is a dominant **ninth**, so its `roman` reads `V9`,
not `V13`. B2 prints `roman` verbatim in its reroll toast, so a roman that
disagrees with its own step is user-visible text, not a comment.

**Boom Bap — Dorian, min7 / maj7 / extensions** (`category: 'Lofi & R&B'`)

| id | name | roman | steps | bars | genres |
| --- | --- | --- | --- | --- | --- |
| `boombap-dusty-ii-v` | Dusty ii–V–i | iim7 – V7 – im9 | 1:min7, 4:7, 0:min9 | 1, 1, 2 | `['boombap']` |
| `boombap-crate-dig` | Crate Dig | im9 – VIImaj7 – IIImaj7 – IV7 | 0:min9, 6:maj7, 2:maj7, 3:7 | 1×4 | `['boombap']` |
| `boombap-head-nod` | Head Nod | im7 – IV7 – im7 – iim7 | 0:min7, 3:7, 0:min7, 1:min7 | 1×4 | `['boombap']` |

`4:7` in `boombap-dusty-ii-v` is the dominant V the ii–V–i needs; Dorian's own
degree 4 is minor. With the migrated `cine-dorian-voyage` this genre has four.

**Zen — Hirajoshi, `minScaleLength: 5`** (`category: 'Ambient & Zen'`)

| id | name | roman | steps | bars | genres |
| --- | --- | --- | --- | --- | --- |
| `zen-bamboo-vamp` | Bamboo Vamp | i – IV – i – V | 0, 3, 0, 4 | 2×4 | `['zen']` |
| `zen-moonlit-koto` | Moonlit Koto | i – V – IV – III | 0, 4, 3, 2 | 2×4 | `['zen']` |
| `zen-still-pond` | Still Pond | im7 – Vmaj7 | 0:min7, 4:maj7 | 4, 4 | `['zen']` |
| `zen-temple-bell` | Temple Bell | i – III – V – IV | 0, 2, 4, 3 | 2×4 | `['zen']` |

`zen-bamboo-vamp` uses only degrees 0, 3 and 4, so **every note it plays is in
the scale**. The other three each reach one tone outside, per the Hirajoshi
table. `zen-temple-bell` is the fourth entry ruling R4 requires; its degree
sequence `0, 2, 4, 3` is not a rotation of any of the other three, so as a loop
it is a genuinely different progression and not the same vamp entered at a
different point.

Genre coverage after this: lofi 6, synthwave 4, edm 4, ambient 4, boombap 4,
zen 4 — at least four everywhere, per ruling R4. The library holds 40 entries:
22 migrated plus 18 new.

### The auto-harmonize fix

`reharmonizeProgressionToScale` is **removed** and replaced by two functions in
`src/utils/musicTheory.ts`. No alias is kept — the app has no users.

```ts
transposeProgression(chords: ChordItem[], fromRoot: string, toRoot: string, octave?: number): ChordItem[]
snapProgressionToScale(chords: ChordItem[], root: string, scaleType: string, octave?: number): ChordItem[]
```

**`transposeProgression`** shifts every chord root by
`(rootSemitone(toRoot) - rootSemitone(fromRoot) + 12) % 12`, keeps `quality`,
`bars` and `id` verbatim, transposes `bassNote` by the same amount when present
(otherwise a slash bass stays in the old key), and re-derives `notes` through
`deriveChordNotes` at `octave` (default 4). It touches nothing else; scale
degrees are preserved by construction because every chord moves by the same
interval.

**`snapProgressionToScale`** is today's `reharmonizeProgressionToScale` body
verbatim, renamed. Nearest-degree snapping and the
`maj9 / min9 / 7sus4 / sus4` quality-preservation clause both stay — that
behaviour is correct for the snap case and is not thrown away. A golden test
pins it (see *Testing*).

**The combined operation** is a new pure helper exported from `ChordView.tsx`,
per the repo's "components export their testable helpers" convention:

```ts
export function applyKeyScaleChange(
  chords: ChordItem[],
  from: { root: string; scaleType: string },
  to:   { root: string; scaleType: string },
  octave: number,
  chordsReplaced: boolean,
): ChordItem[] | null      // null = nothing to do
```

- `chordsReplaced` → `null`, whatever else changed
- root changed only → `transposeProgression(chords, from.root, to.root, octave)`
- scale changed only → `snapProgressionToScale(chords, to.root, to.scaleType, octave)`
- both changed → transpose **first**, then snap the result
- neither changed, or `chords` is empty → `null`

`chordsReplaced` is the guard ruling R1 adopted: the caller passes "this render's
`chords` array is not the one the last run saw". It lives in the parameter list
rather than in the effect body so the whole decision is one pure function and the
guard is testable without a DOM. It is deliberately checked **first**: when a new
chord list arrives, no key delta the effect can observe is a delta those chords
need, because they were built in the key that arrived with them.

Transpose-then-snap is the only correct order: snapping first would measure the
chords against a root they are not yet in, which is exactly today's bug.

### Call sites

Five, all named:

1. **`ChordView.tsx:178` — the auto-harmonize effect.** Rewritten around two
   refs so it can tell a user key change from a programmatic one:

   ```
   useEffect(() => {
     const prev = keyRef.current;
     const chordsReplaced = chordsRef.current !== chords;
     chordsRef.current = chords;
     keyRef.current = { root: scaleRoot, scaleType };
     if (!autoReharmonizeRef.current) return;
     const next = applyKeyScaleChange(
       chords, prev, keyRef.current, chordOctaveRef.current, chordsReplaced,
     );
     if (!next) return;
     chordsRef.current = next;
     setChords(next);
     setIsAutoReharmonizedIndicator(true);
   }, [scaleRoot, scaleType, chords]);
   ```

   `chords` joins the dependency list. The `chordsReplaced` guard is what stops
   an Instant Vibe from being reharmonized against its own key (Problem 3), and
   it also makes the effect's own `setChords` a no-op on the following run.
   `autoReharmonize` and `chordOctave` are read through refs so toggling them
   does not re-run the effect. Because `keyRef` is initialised from the current
   key, the effect no longer snaps on mount — a deliberate behaviour change:
   the persisted progression is left as the user saved it.

2. **`ChordView.tsx:200` — `handleApplyLibraryChords`.** The reharmonize call is
   **deleted**. `ChordPresetLibrary` now hands over chords already resolved in
   the active key and scale; this handler only re-ids them and re-derives notes
   at `chordOctave`.

3. **`ChordView.tsx:695` — the manual "Re-harmonize" button.** Calls
   `snapProgressionToScale(chords, scaleRoot, scaleType, chordOctave)`.
   Behaviour unchanged; the chords on the grid are already in the current key,
   which is the case the function handles correctly.

4. **`ChordView.tsx:722` — the "Auto-Reharmonize: ON" toggle.** Same:
   `snapProgressionToScale` on switch-on. Behaviour unchanged.

5. **`ChordPresetLibrary.tsx` — `resolveTemplateChords` (:129) and
   `resolveCustomChords` (:148).**
   - `resolveTemplateChords(template)` becomes
     `resolveProgression(progression, scaleRoot, scaleType, 4)`. It is **not**
     gated on `autoReharmonize` any more: degree form has no other resolution,
     and the result is in-scale by construction. The "Auto" badge is therefore
     removed from factory cards.
   - `resolveCustomChords(chords)` keeps `snapProgressionToScale(chords,
     scaleRoot, scaleType)` behind the `autoReharmonize` flag, and keeps its
     "Auto" badge. Custom progressions are absolute chords with no recorded
     source key, so snapping is the only operation available to them.

   The component additionally filters its factory entries through a pure
   exported predicate:

   ```ts
   export function isProgressionAvailable(p: ChordProgression, scaleType: string): boolean
   // SCALES[scaleType]?.intervals.length ?? 7  >=  p.minScaleLength
   ```

   Entries that fail are hidden rather than resolved with wrapped degrees.
   `BASE_CHORD_CATEGORIES` gains an `'Ambient & Zen'` chip.

## Files touched

| Layer | Files |
| --- | --- |
| theory | `src/utils/musicTheory.ts` (Hirajoshi; `transposeProgression` + `snapProgressionToScale` replace `reharmonizeProgressionToScale`; `TONAL_CHORD_ALIASES` gains `export`) |
| types | `src/types.ts` (declares `VibeGenre`; stays a leaf — it still imports nothing) |
| data | `src/audio/data/chordProgressions.ts` (rewritten) |
| store | `src/store/instantVibes.ts` (`asian-zen`: `scaleType`, `chords`) |
| ui | `src/components/ChordView.tsx`, `src/components/ChordPresetLibrary.tsx` |
| tests | `src/utils/musicTheory.test.ts`, `src/components/ChordPresetLibrary.test.tsx`, new `src/audio/data/chordProgressions.test.ts`, new `src/audio/data/chordProgressions.migration.test.ts`, `src/components/ChordView.test.tsx` |
| docs | `.claude/skills/music-theory/SKILL.md` (the `SCALES` key list and the `reharmonizeProgressionToScale` line are both now wrong) |

No engine file, no `engineSync.ts`, no store slice, no `partialize`/`migrate`
change. `src/audio/data/chordProgressions.ts` gains imports from
`src/utils/musicTheory.ts` (`getDiatonicChordForDegree`, `deriveChordNotes`) and
`src/types.ts` (`ChordItem`, `VibeGenre`). Both are allowed: `eslint.config.js`
restricts `src/audio/**` only from `**/store/**` and `**/components/**`, and
neither `utils/` nor `types.ts` is either. `bun run eslint` is still run
separately because import lists change in five files.

## Testing

Pure-logic `bun:test`, no DOM, per repo convention.

1. **Migration equivalence** (`chordProgressions.migration.test.ts`) — the
   central proof. The test file carries a fixture: the 22 original
   `relativeChords` arrays copied verbatim from the deleted
   `CHORD_PROGRESSION_TEMPLATES`, keyed by the new progression id, plus that
   progression's `referenceScale`. For **each of the 12 roots in `ROOTS`**, for
   each progression, assert that
   `resolveProgression(p, root, p.referenceScale, 4)` equals, element for
   element, the chord list the interval form produced:
   `{ root: ROOTS[(rootSemitone(root) + interval) % 12], quality, bars }`, with
   `notes` compared as well. 264 comparisons; a single wrong degree fails.
   Running all 12 roots rather than one catches modulo and wrap mistakes that a
   C-only test would miss.

2. **Library invariants** (`chordProgressions.test.ts`) — over every entry of
   `CHORD_PROGRESSIONS`:
   - `id` unique, non-empty; `steps` non-empty; every `bars` an integer ≥ 1.
   - `referenceScale` is a key of `SCALES`.
   - `minScaleLength === SCALES[referenceScale].intervals.length`.
   - every `step.degree` is an integer in `[0, minScaleLength)` — no entry
     relies on wrapping.
   - every explicit `step.quality` is a chord type `tonal` actually knows:
     `Chord.getChord(TONAL_CHORD_ALIASES[q.toLowerCase()] ?? q.toLowerCase(), 'C')`
     is not empty. This is required because `generateBlockChordNotes` silently
     falls back to `maj` on an unknown token, so a typo would otherwise be
     inaudible in tests. `TONAL_CHORD_ALIASES` is `const` and **not exported**
     today (`musicTheory.ts:289`); this test needs it, so the declaration gains
     `export`. That is the only change to that symbol.
   - for every `g` in `genres`: `p.referenceScale === VIBE_GENRE_SCALES[g]`.
   - genre coverage: each of the six `VibeGenre` values has at least **4**
     entries (ruling R4 — with three rhythm and three bass options per vibe,
     fewer than four progressions makes the harmony axis visibly repetitive on a
     dice button that has no undo).
   - genre conventions: every `edm` entry holds every chord for the same number
     of bars, and at least three `edm` entries hold each chord for 2 bars (the
     research's 2-bars-per-chord shape). It is not "every `edm` entry is 2 bars"
     because `pop-club-house` is cross-tagged from the migrated set and its
     `bars` are fixed at 1 by the migration proof; `ambient`
     entries have every `bars >= 4` and contain no step with `degree === 4`
     immediately followed, cyclically, by a step with `degree === 0` (the
     precise reading of "avoids V–I cadences"); `lofi` and `boombap` entries
     have an explicit `quality` on every step matching `/7|9|11|13/`; `zen`
     entries have `minScaleLength === 5`.
   - `genres` is an authored array on every entry (`[]` for library-only
     entries), never inferred: the test asserts the exact set of ids per genre
     against a literal list in the test file, so adding a library entry without
     deciding its tags fails rather than silently joining a dice pool.

3. **`resolveProgression`** — resolves `pop-i-v-vi-iv` in C Major to
   `C – G – Am – F`; an omitted `quality` yields the **triad**, never the
   seventh; an explicit `quality` survives verbatim; `bars` and id shape are
   carried through; `notes` match `deriveChordNotes` for the same chord.

4. **Hirajoshi** (`musicTheory.test.ts`) — `intervals` is
   `[0, 2, 3, 7, 8]` and both quality arrays have length 5;
   `getScaleNotes('G', 'Hirajoshi')` is `['G','A','A#','D','D#']`;
   `getDiatonicChordForDegree` returns the exact five `{root, quality,
   degreeName}` rows of the table above for C, and the corresponding roots for
   G; degrees 0, 3 and 4 produce triads whose every note passes
   `isNoteInScale`, and degree 4's `maj7` does too; degrees 1 and 2 produce
   exactly one out-of-scale tone each (asserted as a count, so a future
   re-authoring that makes them worse fails).

5. **`transposeProgression`** — quality and bars preserved verbatim; the
   semitone interval between every adjacent pair of chords is preserved; the
   scale degree of each chord in `(fromRoot, scaleType)` equals its degree in
   `(toRoot, scaleType)`; `bassNote` is transposed; and for **all 144 ordered
   root pairs**, `transposeProgression(transposeProgression(p, a, b), b, a)`
   deep-equals `p`. The round trip is then guaranteed rather than a property of
   one lucky progression. The measured case is pinned explicitly: `Amin – Fmaj
   – Cmaj – Gmaj` from A to C yields `Cmin – G#maj – D#maj – A#maj`.

6. **`snapProgressionToScale`** — a golden test with inputs and outputs copied
   from today's `reharmonizeProgressionToScale` behaviour, proving the rename
   changed nothing; every output root is a degree of the target scale; the
   `maj9 / min9 / 7sus4 / sus4` qualities survive.

7. **`applyKeyScaleChange`** — root-only change transposes and does not snap
   (the A→C case above comes out untouched by snapping); scale-only change
   snaps and does not transpose; both-changed transposes then snaps, and the
   result differs from snap-then-transpose on at least one pinned input, so the
   order is actually pinned; unchanged key and empty chord list both return
   `null`.

   The `chordsReplaced` guard is pinned from both sides, per ruling R1:
   - `chordsReplaced: true` returns `null` even when root **and** scale both
     changed — the Instant Vibe case (Problem 3).
   - **A root-only change with `chordsReplaced: false` still transposes.** This
     is the one case the guard could wrongly skip, so it is asserted on the same
     `Amin – Fmaj – Cmaj – Gmaj`, A→C input and compared element-for-element
     against `Cmin – G#maj – D#maj – A#maj`. A guard widened into "never
     transpose" fails here.

8. **`isProgressionAvailable`** — a `minScaleLength: 7` entry is unavailable in
   `Hirajoshi`, `Major Pentatonic` and `Blues`, available in every 7-note
   scale; a `minScaleLength: 5` entry is available everywhere; an unknown
   `scaleType` is treated as length 7, matching `SCALES`' own fallback.

9. **Instant Vibes** — every vibe's `scaleType` is a key of `SCALES` (this
   alone would have caught `'Pentatonic Major'`); `asian-zen` is `Hirajoshi`
   with `scaleRoot: 'G'`, and every note of every one of its chords passes
   `isNoteInScale` for G Hirajoshi.

`bun run verify` is the gate; `bun run eslint` is run separately.

## Accepted limitations

- **Explicit qualities are absolute.** A `lofi` entry's `maj9` stays `maj9` in
  any scale it is resolved into, so loading a lo-fi progression while in a
  minor scale produces chords with tones outside it. The Re-harmonize button
  exists for exactly that; the alternative — deriving extensions from the scale
  — would erase the genre identity the research says to keep.
- **The same library entry sounds different in different scales.** Entries with
  omitted qualities follow the active scale, so `I – V – vi – IV` loaded in
  Natural Minor is `i – v – VI – iv`. This is the point of degree form, but it
  is a visible behaviour change from the interval form, including in the
  library card's "In {scaleRoot}:" preview line.
- **A 5- or 6-note scale shows almost no library.** With `Hirajoshi`,
  `Major Pentatonic`, `Minor Pentatonic` or `Blues` active, the factory list is
  filtered down to the four `zen` entries. That is honest — the other 37 were
  written for 7 degrees — but it is a sparse screen, covered only by the
  existing empty state.
- **Roman numerals in 5-note scales are positional.** Hirajoshi degree 4
  displays as `V` although it is a b6 in absolute terms.
  `getDiatonicChordForDegree` has always numbered by index and the existing
  pentatonics have the same quirk; it is not changed here.
- **The fourth `edm` progression is a 1-bar-per-chord entry.**
  `pop-club-house` is cross-tagged rather than newly authored, so three of the
  four `edm` draws change chord every 2 bars and one changes every bar. That is
  a real musical difference inside one genre pool, and it is the honest price of
  not rewriting a migrated entry's `bars` — doing so would invalidate the
  migration-equivalence proof, which compares `bars` verbatim.
- **Most Hirajoshi chords contain one tone outside the scale.** Only the
  triads on degrees 0, 3, 4 and the `maj7` on degree 4 are fully inside it.
  This is a property of a 5-note scale with two half-steps, not a table error;
  the per-degree counts are pinned by test 4.
- **`resolveProgression` does not enforce `minScaleLength`.** Degrees wrap, per
  the field's documented semantics. Every caller must filter; the two that
  exist today (`ChordPresetLibrary`, and B2's dice) do.
- **Custom user progressions can only be snapped.** They are stored as
  absolute chords with no source key, so a key change reaches them through
  `snapProgressionToScale` and can still collapse two chords onto one degree.
  Recording a source key on save would fix it and is out of scope.
- **No chromatic escape hatch in `ProgressionStep`.** A future progression
  whose chord root is outside every scale in `SCALES` cannot be added to the
  library. None of the 22 existing ones is affected — every one of them turned
  out to be diatonic in some mode.
- **`pop-future-bass` and `jpop-royal-road` are byte-identical progressions**
  under different names. They already were; both are kept.
- **A reroll can change the chord-loop length.** An `ambient` draw is 16 bars
  and an `edm` draw 8, against a 1-bar drum pattern that simply repeats. This is
  B2's surface, noted here because the `bars` values that cause it are authored
  in this project.
- **The explicit `Re-harmonize` button snaps, not transposes, by design.** It
  is the deliberate, user-requested "diatonically snap to the active key and
  scale" action and stays that way even though a snap can move chords further
  than a transpose would (see the first bullet above). The `Auto-Reharmonize`
  toggle no longer rewrites the current chords when switched on — flipping it
  only starts applying transpose-on-root-change / snap-on-scale-change to
  *future* key/scale changes, so turning it back on after a key change made
  while it was off cannot reproduce the old scramble.

## Deviations from the shared context

The shared interface block is used verbatim for `VibeGenre`, `ProgressionStep`,
`resolveProgression` and every field of `ChordProgression` it declares. Three
things are added or pinned down, none of which changes a name or a shape B2
reads:

1. **`ChordProgression.category` added** (`ProgressionCategory`, the existing
   union plus `'Ambient & Zen'`). `ChordPresetLibrary` renders category chips
   and the shared block has no field for them; without it the library loses its
   filtering. Purely additive.
2. **`ChordProgression.referenceScale` added** (`string`, a key of `SCALES`).
   The migration cannot be verified without knowing which scale each
   progression's degrees were authored in, and the `roman` string is only true
   in that scale. It also makes rules 2 and 3 above (`minScaleLength` and the
   genre-tag constraint) mechanically checkable. Purely additive; B2 can ignore
   it.
3. **`ProgressionStep.quality`, when omitted, is defined to mean the *triad***,
   not the seventh. This is a clarification, not a change: the field's shape is
   untouched, but `getDiatonicChordForDegree` takes a `use7ths` flag that
   `ProgressionStep` has no room for, and leaving it unstated would let two
   implementations produce different music from the same data.

4. **`VibeGenre` is declared in `src/types.ts`, not here**, and re-exported from
   `chordProgressions.ts` as `export type { VibeGenre } from '../../types';`.
   The shared block's export *site* is unchanged — `import type { VibeGenre }
   from '.../chordProgressions'` still resolves — but the declaration moves.
   B2 needs `VibeGenre` inside `src/types.ts` for `VibeVariation.genre`, and
   `chordProgressions.ts` already imports `ChordItem` from `src/types.ts`, so
   declaring it here would make the two files import each other. `src/types.ts`
   imports nothing today and still imports nothing after this change.

Two smaller additions to the module's exports, both additive and both useful to
B2: `VIBE_GENRE_SCALES` (the genre → scale map the tagging rule depends on) and
`progressionById(id)`.

The context file's licence to prefer a clean change over a compatibility shim is
taken up twice: `reharmonizeProgressionToScale` and `CHORD_PROGRESSION_TEMPLATES`
are both deleted outright rather than kept as aliases, and the persisted
`scaleType: 'Pentatonic Major'` value is not migrated.

## Cross-check amendments (applied 2026-08-26)

An independent cross-check read this spec against B2's and the shared context.
The controller's rulings are folded in above; this is the index, not a second
source of truth.

| ruling | what changed here |
| --- | --- |
| R1 | The `chordsReplaced` guard is kept and moves into `applyKeyScaleChange`'s parameter list, so the whole effect decision is one pure function. Testing item 7 gains the case the guard could wrongly skip: a **root-only change with a stable `chords` reference still transposes**. |
| R3 | `VibeGenre` is declared in `src/types.ts` and re-exported from `chordProgressions.ts`. Deviations item 4; `src/types.ts` added to *Files touched*. |
| R4 | Four progressions per genre. Added `ambient-glass-horizon`, `zen-temple-bell`, and the `edm` cross-tag on `pop-club-house`. The library-invariant test's floor rises from 3 to 4 and the `edm` bars convention is restated as uniform-per-entry. |
| I1 | `TONAL_CHORD_ALIASES` gains `export`; the quality-validity test needs it. |
| I5 | Genre counts corrected: lofi 6, synthwave 4, edm 4, ambient 4, boombap 4, zen 4. |
| I6 | Every new progression carries an explicit `genres` column, and the invariant test asserts the exact id set per genre. |
| M4 | `lofi-tape-loop`'s roman is `V9`, matching its `4:9` step. B2 prints `roman` verbatim. |
| M5 | `jpop-royal-road` (王道進行) and `jpop-marusa` (丸サ進行) keep their Japanese suffixes. |
| M6 | The layering justification is corrected: `chordProgressions.ts` will import `musicTheory.ts`, which the eslint rule permits — it restricts `src/audio/**` only from `store/` and `components/`. |
| M7 | Reroll loop-length variance recorded in *Accepted limitations*. |

**R2** (a vibe swap rewinding the shared bar grid is intended) and the
`densities` / toast / open-hat items are B2's; nothing here depends on them.
The cross-check verified the 22-row migration table against the original
interval form across all 12 roots (0 discrepancies) and confirmed Hirajoshi
`[0, 2, 3, 7, 8]`; neither is reopened.

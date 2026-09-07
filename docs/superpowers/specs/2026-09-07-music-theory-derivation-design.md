# Music Theory Derivation — Design

Date: 2026-09-07
Issue: DEV-380
Status: Settled — every owner decision below is a decision, not a proposal. The two behaviour
changes (Blues, Hirajoshi degree 3) were measured before the decision and accepted knowingly.

## Context

`SCALES` in `src/data/scales.ts` carries four things per entry: a display `name`, a `category`, a
semitone `intervals` array, and two hand-written quality arrays — `triadQualities` and
`seventhQualities`, one token per degree. The interval array is checkable by eye: a reader who
knows the scale can read `[0, 2, 3, 7, 8]` and say whether it is Hirajoshi. The quality arrays are
not. `['min', 'dim', 'maj', 'sus4', 'maj']` is a claim about what stacking thirds over each degree
produces, and verifying it means doing the stacking by hand for every degree, twice, per scale —
140 tokens across the eleven entries, not one of which any test derives.

The gap between the two is the whole issue. `intervals` is **content**: the table states it and a
test can pin it against `tonal`. The quality arrays are a **computation frozen into a literal**,
and a frozen computation drifts silently. Two of the eleven scales are already wrong by their own
stated rule — the file says the pentatonics "inherit the parent 7-note scale's qualities", and
Blues and Hirajoshi do not.

This change deletes the frozen computation and keeps the content. It also fixes the second-order
consequence: because the app has only ever had one spelling (`ROOTS`, sharp-only), every scale the
user sees is spelled in sharps regardless of key, so A♭ Natural Minor renders as
`G# A# B C# D# E F#`. That is not a different opinion about spelling; it is the absence of one.

Three parts, in dependency order:

- **Part 1** — `ScaleDefinition` loses both quality arrays and gains `tonal`, `parent?` and
  `tonality`. `intervals` stays a literal.
- **Part 2** — `resolveDegreeQuality(scaleType, degree, use7ths)` in `src/utils/musicTheory.ts`
  derives what the arrays used to state.
- **Part 3** — `src/utils/noteSpelling.ts` gives every *display* surface the key's own accidentals,
  while every stored and every computed value stays sharp.

## Part 1 — the shape of `ScaleDefinition`

### The new shape

```ts
export interface ScaleDefinition {
  name: string;
  category: 'Major / Minor' | 'Modal' | 'Pentatonic & Blues' | 'World & Exotic';
  intervals: number[];
  /** tonal's scale name, e.g. 'harmonic minor'. `Scale.get('C ' + tonal)` spells this scale. */
  tonal: string;
  /** SCALES key of the 7-note scale whose harmony this scale borrows. 7-note scales omit it. */
  parent?: string;
  /** Which tonic-spelling convention this scale writes its key with. */
  tonality: 'major' | 'minor';
}
```

`triadQualities` and `seventhQualities` are deleted outright — not deprecated, not kept as a
fallback. A fallback array is a second answer to a question that now has one.

### `intervals` stays a literal, and a test pins it to `tonal`

The obvious next step — deriving `intervals` from `tonal` too, so the table holds only a scale name
— is **rejected**. `.intervals` is read at **fourteen sites in six files**: nine inside
`musicTheory.ts` (`getScaleNotes`, `getScaleNotesInOctave`, `isNoteInScale`,
`remapNoteByScaleDegree`, `isInScalePaletteChord`, `getDiatonicChordForDegree`,
`snapProgressionToScale`), plus `audio/bassPatterns.ts:101`, `components/ui/Keyboard.tsx:324`,
`components/loop/ChordView.tsx:546`, `components/loop/chord/progressionAvailability.ts:17` and
`components/loop/chord/padPanel.ts:20`. Routing all fourteen through a resolver is churn with no
output change: every one of them would get back the array it reads today.

The distinction that decides it is the one `CLAUDE.md` already states for `src/data/`: **an
interval array is the table's content — adding a scale is an edit to that table and nothing else.**
A quality array is not content, because a reviewer cannot check it by reading it. So: delete what
is unverifiable, keep what a test can pin.

The test that pins it, in `src/data/scales.test.ts`:

```ts
expect(Scale.get('C ' + entry.tonal).notes.map((n) => Note.get(n).chroma)).toEqual(entry.intervals);
```

**Measured, 2026-09-07: all eleven `intervals` arrays already match `tonal` exactly**, including
`blues` (`[0, 3, 5, 6, 7, 10]`) and `hirajoshi` (`[0, 2, 3, 7, 8]`) — the two most likely to
disagree, because both have more than one published spelling. The test therefore lands green and
its job from that day forward is to stay green: a hand-edited interval that `tonal` disagrees with
is either a typo or a decision to leave `tonal`, and both should be visible.

### Why `tonality` lives in data

`tonality` exists so that `utils/noteSpelling.ts` can pick between `MAJOR_TONICS` and
`MINOR_TONICS` while importing only `tonal` and `@/data/scales` — never `musicTheory.ts`.

This is a direct lesson from murva, where the equivalent module imports `normalizeToMajorMinor`
from `musicUtils`, `musicUtils` imports `getTonicSpelling` back, and the resulting cycle is managed
rather than removed: murva keeps a **local copy of the sharp-name list** inside `noteSpelling.ts`
with a test pinning the copy to the original, because importing it would make the cycle
load-bearing at module-evaluation time. Solna does not need that trade. Putting the major/minor
answer in the data table — where it is one field on an entry a reviewer is already reading — means
the cycle never forms, and the duplicated list with its guard test never has to exist.

`tonality` is also not derivable from `intervals` without re-deriving it: Dorian and Blues are
minor-tonality scales whose spelling convention nobody computes from a third. Stating it is
honest; computing it would be a second frozen computation of exactly the kind this change deletes.

### There are no overrides, of any kind

An `overrideTriads?: (string | null)[]` escape hatch was considered and is **rejected**.

The reason is not that overrides are inelegant. It is that an override field is the shortcut people
reach for **instead of** fixing the derivation. The moment the table can say "derive, except here",
every future disagreement between a scale's harmony and the resolver has a one-line answer that
costs nothing to write and leaves no trace of why — which is precisely the state this change
exists to leave. Hirajoshi's `sus4` is the proof: it is a defensible musical choice, it is
documented in a good comment, and it still made the table's own stated rule false for two of eleven
entries with nothing failing.

If the derivation is wrong for a scale, the fix is the derivation or the `parent`. If a specific
chord is wanted at a specific degree, `CHORD_PROGRESSIONS` already has the field for it: a `step`'s
explicit `quality`, which is authored content, sits in the progression that wants it, and cannot
leak into the quick-add palette of every other song in that scale.

## Part 2 — `resolveDegreeQuality`

### The function

New in `src/utils/musicTheory.ts`, memoized on `(scaleType, degree, use7ths)`:

```ts
export function resolveDegreeQuality(scaleType: string, degree: number, use7ths: boolean): string
```

`getDiatonicChordForDegree` is its only caller inside the app; it keeps its current signature,
its degree wrapping and its roman-numeral lower-casing, and swaps two array reads for one call.

### The algorithm

1. **Resolve the parent.** `SCALES[scaleType].parent ?? scaleType` — a 7-note scale is its own
   parent. The parent is always a 7-note scale, so stacking thirds over it is well-defined.
2. **Map the degree to a parent degree by semitone offset.** Take `iv = scale.intervals[degree]`
   and find the parent degree whose own interval equals `iv`. **Not by index.**
3. **Stack thirds over the parent's spelled note names.** `Scale.get('C ' + parent.tonal).notes`
   gives seven spelled names; the chord over parent degree `j` is `notes[j]`, `notes[(j+2) % 7]`,
   `notes[(j+4) % 7]`, and for sevenths `notes[(j+6) % 7]`.
4. **Measure with `Interval.distance`.** Spelled names are what make this work: `Eb`→`B` is `5A`
   and `Eb`→`Cb` would be `6m`, and only a speller that agrees with the scale gets that right.
   Hand-rolled semitone arithmetic cannot tell an augmented fifth from a minor sixth at all.
5. **Map the measured tuple to a quality token.** `(3M, 5P) → maj`, `(3m, 5P) → min`,
   `(3m, 5d) → dim`, `(3M, 5A) → aug`; with the seventh, `(3M, 5P, 7M) → maj7`,
   `(3M, 5P, 7m) → 7`, `(3m, 5P, 7m) → min7`, `(3m, 5d, 7m) → m7b5`, `(3m, 5d, 7d) → dim7`,
   `(3m, 5P, 7M) → minMaj7`, `(3M, 5A, 7M) → maj7#5`. The map is exhaustive over what the eleven
   scales produce; an unmapped tuple **throws**, because a silent fallback to `maj` is how a
   wrong chord reaches the UI with nothing to notice it. (`getDiatonicChordForDegree`'s existing
   `|| 'maj'` / `|| '7'` fallbacks go away with the arrays they guarded.)

### The trap: `degree % 7` is not the parent degree

murva's equivalent, `resolveDegreeBaseChord`, indexes `degree % 7` straight into the parent. That
is correct **only** when the scale and its parent have the same number of degrees, which for a
pentatonic is never.

Copying it here would make Minor Pentatonic degree 1 — interval 3, the ♭III — resolve as the
parent's degree 1, which in Natural Minor is the **ii°**. The quick-add row would offer a
diminished chord where a major one belongs, and nothing would fail: the shape is right, the length
is right, and only the sound is wrong. Mapping by semitone offset is what makes Minor Pentatonic
degree 1 find Natural Minor degree 2 and come back `maj`/`maj7`, which is what the hand-written
table says today and what the derivation must reproduce.

### Degrees the parent does not contain, and ties

A degree whose interval no parent degree matches uses the **nearest parent degree by semitone
distance**. Exactly one such degree exists in the table today: **Blues degree 3**, the ♭5 at
interval 6, whose neighbours in Natural Minor are interval 5 (degree 3) and interval 7 (degree 4) —
both one semitone away.

When two parent degrees are equidistant, **their qualities must agree**, and a test asserts it
rather than the code picking. Measured: Natural Minor degree 3 and degree 4 are both `min`/`min7`,
so the tie is decided by agreement and not by array order. If a future scale introduces a tie whose
sides disagree, `scales.test.ts` goes red and the answer is an explicit `parent` change or a scale
whose intervals were mis-entered — never a tiebreak rule invented at that moment to make the suite
pass.

### Memoization

The resolver is called once per degree per render of the quick-add row and once per key on
`Keyboard.tsx`'s scale-locked chord rows — cheap individually, but it runs `Scale.get` and up to
three `Interval.distance` calls each time, and the answer depends on nothing but its three
arguments. A module-scope `Map` keyed by `` `${scaleType}|${degree}|${use7ths}` `` is correct
forever because `SCALES` is frozen content. The cache lives in `utils/`, not in `data/` — a
`src/data/` file holds no mutable module-scope binding.

## Part 3 — what the derivation changes, measured

Every number below was computed on 2026-09-07 by running the algorithm above against the current
table, not estimated.

### Nine of eleven scales are reproduced exactly

All seven 7-note scales — Major, Natural Minor, Harmonic Minor, Dorian, Mixolydian, Lydian,
Phrygian — plus **Minor Pentatonic** (parent Natural Minor) and **Major Pentatonic** (parent Major)
derive to the arrays they currently declare, **triads and sevenths both, every degree**. Harmonic
Minor's `aug` at degree 2 and `maj7#5` at degree 2 come out of the spelled stacking with no special
case, which is the strongest single piece of evidence that the method is the one the table was
written from.

### Blues changes at four degrees

| | current | derived |
|---|---|---|
| triads | `min maj dim dim min maj` | `min maj min min min maj` |
| sevenths | `7 maj7 dim7 dim7 7 7` | `min7 maj7 min7 min7 min7 7` |

Degrees 2 and 3 lose their diminished chords because Natural Minor has no diminished triad at the
4th or 5th degree — the current values are stacked from the blues scale's own notes, which is a
different rule than the one the table claims to follow. Degrees 0 and 4 lose their dominant
sevenths for the same reason: a `7` on the tonic is a blues *idiom*, and idioms belong in a
progression's explicit `quality`, not in the scale's diatonic palette.

**No progression and no vibe references Blues** — `referenceScale: 'Blues'` appears zero times in
`CHORD_PROGRESSIONS`, and no `VibeSpec` sets `scaleType: 'Blues'`. The change is therefore visible
in exactly one place: the quick-add degree row a user sees after choosing Blues by hand. Nothing
resolved, saved or shipped moves.

### Hirajoshi degree 3 changes, and it is a pitch change

`sus4` → `min`, `7sus4` → `min7`. This is the one change in the whole issue that alters what comes
out of the speakers for content that ships, and it is accepted knowingly.

What it costs, stated exactly. In G Hirajoshi (`G A Bb D Eb`) degree 3 is `D`. The current `sus4`
is `D–G–A`, all three notes inside the five. The derived `min` is `D–F–A`, and `F` is not in the
scale. Three of Zen Garden's four progressions use degree 3: `zen-bamboo-vamp` (degrees 0, 3, 0,
4), `zen-moonlit-koto` (0, 4, 3, 2) and `zen-temple-bell` (0, 2, 4, 3). `zen-still-pond`
(degree 0 `min7`, degree 4 `maj7`) does not.

### Why "every note is inside the scale" turned out not to be the property it looked like

The objection to the Hirajoshi change is that it breaks scale purity. Measured, purity is not a
property this system has, and not one Zen Garden has either. Against the **current, hand-written**
tables, counting chords whose every note lies inside the scale, over all degrees × {triad, 7th}:

| scale | slots inside the scale |
|---|---|
| Minor Pentatonic | 3 / 10 |
| Major Pentatonic | 3 / 10 |
| Blues | 2 / 12 |
| Hirajoshi | 4 / 10 |

Hirajoshi's own degree-3 `7sus4` is already outside — it reaches the 4th, a pitch the scale does
not contain — so even the degree this argument is about is only pure as a triad.

And of Zen Garden's four progressions, **only `zen-bamboo-vamp` is fully inside the scale today**.
`zen-moonlit-koto` and `zen-temple-bell` both leave it through degree 2's major triad
(`Bb–D–F` in G, and `F` is not in the scale); `zen-still-pond` leaves it through degree 0's `min7`
(`G–Bb–D–F`). So derivation costs **one progression's purity, not the vibe's**, and the vibe was
never pure to begin with.

That is why the prose has to be rewritten rather than softened. `zen-bamboo-vamp`'s description
("every note it plays is inside the scale") stops being true, and the replacement must say the true
thing: **Hirajoshi is a scale most of whose diatonic chords reach outside it** — which is a fact
about a five-note scale with two major-third gaps, not a defect in the derivation.

### Spelling, measured

Over all 132 (root × scale) pairs, spelling changes **at least one note name in 68 of them**.
Two pairs reach a double accidental and take the fallback:

- `D#` + Blues — tonic spelled `Eb`, and `tonal` gives `Eb Gb Ab Bbb Bb Db`; `Bbb` falls back to
  `A`.
- `G#` + Harmonic Minor — `tonal` gives `G# A# B C# D# E F##`; `F##` falls back to `G`.

Single accidentals that look unusual are **kept**: F# major's `E#` stays `E#`, because it is what
the key signature writes and it is readable. Only doubles fall back, and they fall back to the
key's own accidental direction, so a flat key never shows a sharp.

## Part 4 — spelling

### The module

New `src/utils/noteSpelling.ts`, ported from
`/Users/Pathompong/Sites/Personal/murva/murva-app/shared/src/music/noteSpelling.ts`:
`MAJOR_TONICS`, `MINOR_TONICS`, `getTonicSpelling`, `getKeyAccidental`, `spellPitchClassInKey`,
`spellMidiInKey`, including the double-accidental fallback and `spellMidiInKey`'s octave
correction (`Cb4` and `B3` are the same key, so the letter that wraps the octave boundary shifts
it; the result is checked against `Note.midi` and corrected, which makes it structurally impossible
for the function to return a name denoting a different pitch).

It imports `tonal` and `@/data/scales` and nothing else — see "Why `tonality` lives in data".

The tonic tables are **conventional spellings by circle-of-fifths practice, not computed**.
Counting accidentals is not enough: it ties on E♭/D♯ minor and picks the wrong side outright for
blues and pentatonic scales, whose `tonal` spelling carries accidentals that say nothing about the
key. That comment travels with the table.

### Spelling is render-time only, and nothing spelled is ever persisted

A stored root is an **identity** — one of twelve pitch classes, written as its canonical sharp
name. Every accidental a user sees is derived from `(scaleRoot, scaleType)` at render time. This is
the whole contract, and it is what makes the change safe to ship with no persist-version bump and
no `.solna` format bump: nothing about the stored shape changes, so there is nothing to migrate.
(`CLAUDE.md`: a version stamped into persisted data is a contract; not bumping one that did not
change is the other half of respecting it.)

### Why the resolvers do NOT return spelled roots

murva's resolvers return spelled roots. Solna's must not, for three reasons that are each
independently fatal:

1. **`src/components/loop/chord/SortableChordCard.tsx:171` renders its root `<select>` from
   `ROOTS`.** An `Eb` value matches no `<option>`, so the select silently shows the wrong entry.
2. **`generateBlockChordNotes` maps note names back through `ROOTS`.** A card showing `Eb` would
   sit beside a note list reading `D#4 G4 A#4` — the same pitches under two spellings, on one row.
3. **`ChordItem.root` is persisted.** A spelled root would be written into `localStorage` and into
   `.solna` bodies, which breaks the issue's own rule that spelling is never persisted.

So `getDiatonicChordForDegree`, `getBorrowedChords`, `transposeProgression`,
`snapProgressionToScale` and `generateBlockChordNotes` all keep returning canonical sharp roots.
Spelling enters **only** at a label.

### Where spelling lands

`formatChordLabel(root, quality, key?)` gains an **optional third parameter** — `{ scaleRoot,
scaleType }` — so the call sites migrate one at a time and the un-migrated ones keep today's
output. There are twelve call sites in four files: `PlayheadReadout.tsx:36-37`,
`ui/Keyboard.tsx:338`, `loop/ChordView.tsx:317,759,765,827,833` and
`loop/ChordPresetLibrary.tsx:221,331,388,526`. `formatChordQuality` is unchanged — a quality suffix
has no accidental.

Beyond chord labels, three surfaces:

- **`components/loop/lead/melodyGrid.ts`**, scale-locked mode — the row **label** only. See the
  trap below.
- **`components/ui/Keyboard.tsx`**, scale-locked key captions.
- **`components/Header.tsx:110`**, the key picker — adopt murva's `KEY_OPTIONS` dual label
  (`value` stays the sharp name so the stored contract is unchanged; `label` reads `C#/Db`
  regardless of scale, so the picker never has to explain why the same button reads differently
  after a scale change).

### Three traps, each verified against the code

**1. `getScaleNotes` must keep returning sharp names.** `ui/Keyboard.tsx:75` does
`(ROOTS as readonly string[]).indexOf(n)` on its output to recover a semitone. A flat name yields
`-1` and the keyboard silently mis-maps — no throw, no failing type. Display gets a **separate**
`spellScaleNotes(root, scaleType)`; `getScaleNotes` is not touched.

**2. The lead grid's row strings are identities, not labels.** `leadPitchRows` returns
`['C4', 'D4', …]`, and `LeadMelodyGrid.tsx` uses those exact strings as `kinds.get(note)` map keys,
as `previewNote(note)` arguments, and as the values written into `LeadNote.note` — which is
persisted. `isRootNote` compares `note.replace(/\d+$/, '') === root` against a sharp `ROOTS` value,
so a flat row name also loses the tonic highlight. Spelling therefore applies **only to the label
rendered at `LeadMelodyGrid.tsx:594`**, never to the row identity `leadPitchRows` returns. Anything
else writes a spelled name into persisted state.

**3. `KEYBOARD_NOTES` stays sharp.** It is a key-agnostic binding table — 18 chromatic codes to
notes, C3–F4 — that `scripts/check-key-bindings.ts` pins and that does not change when the key
changes. Only the scale-locked caption spells.

## Consequent edits

Each of these is required by the change above; none is optional cleanup.

- **`src/store/instantVibesChordsFixture.ts`**, the `'zen-garden'` golden: `snapshotChord('zn2',
  'D', 'sus4', 2, 4)` becomes `'min'`. Exactly one line; if a second line moves, something else
  changed too.
- **`roman` fields in `src/data/chordProgressions.ts`.** Derived Hirajoshi triads are
  `min dim maj min maj`, so a degree-3 chord's numeral lower-cases:
  `zen-bamboo-vamp` `i – IV – i – V` → `i – iv – i – V`;
  `zen-moonlit-koto` `i – V – IV – III` → `i – V – iv – III`;
  `zen-temple-bell` `i – III – V – IV` → `i – III – V – iv`.
  `zen-still-pond` carries explicit qualities and does not move. **Verify each against
  `getDiatonicChordForDegree`'s output, not against this list** — the numeral is lower-cased by a
  rule (`quality.includes('min') || quality === 'dim'`), and a rule is what should decide it.
- **Descriptions** at `src/data/chordProgressions.ts:542` ("every note it plays is inside the
  scale") and `:578` ("before the open fourth settles it") — both name the open fourth that no
  longer exists.
- **The block comment above Hirajoshi's qualities in `src/data/scales.ts`**, which documents a
  deviation that is being deleted, and the file's header paragraph, which says the qualities are
  hand-written and pinned by `musicTheory.test.ts`.
- **`.claude/skills/music-theory/SKILL.md:26-28 and :42-43`** — the "one deliberately
  hand-authored table" claim and the Hirajoshi sus4 sentence.
- **`CLAUDE.md`** — the music-theory material there is currently a pointer to the skill; the
  derivation rule and the sharp-identity/spelled-display split belong wherever a reader will hit
  them before editing `SCALES`.
- **`src/audio/chordProgressions.migration.test.ts:123`** reads
  `SCALES[progression.referenceScale].triadQualities[step.degree]` directly and must call the
  resolver. It is the only non-test-of-scales reader of the arrays outside
  `getDiatonicChordForDegree` itself; `src/data/scales.test.ts:13-14` and
  `src/utils/musicTheory.test.ts:128-129` only assert the arrays' lengths and go away with them.
- **`getBorrowedChords` output may shift for Blues and Hirajoshi.** It filters candidates against
  the in-scale triad/7th palette (`isInScalePaletteChord`), and that palette is exactly what
  changes. **The implementation must measure the before/after list for those two scales and record
  it**, not assume it is unchanged — `scripts/verify-borrowed.mts` already walks every scale
  through `getDiatonicChordForDegree` and prints the palette, so it is a diff, not an
  investigation. (Note: that script does **not** read `triadQualities`; it goes through the
  resolver already and needs no edit.)

## Testing

**The characterization test is written first, before any code changes**, modelled on murva's
`chordSymbol.characterization.test.ts`. It pins `getDiatonicChordForDegree` for **every scale ×
all 12 roots × {triad, 7th}** — root, quality and `degreeName` — as a snapshot committed against
the *current* hand-written tables. Written after the derivation, it would pin whatever the
derivation happens to do, which proves nothing.

After the derivation lands, that snapshot moves at **Blues (all four changed degrees, in all 12
roots) and Hirajoshi degree 3, and nowhere else.** A move anywhere else is a bug in the
derivation, not a fixture to update.

`src/data/scales.test.ts` gains three assertions:

1. every entry's `intervals` equals `Scale.get('C ' + entry.tonal).notes.map(chroma)`;
2. every `parent` names an existing `SCALES` key whose `intervals.length === 7`, and no 7-note
   scale declares one;
3. every degree that resolves through equidistant parent neighbours gets the same quality from
   both — the tie is consistent, not order-dependent.

Spelling gets **its own snapshot across all 132 (root × scale) pairs, not a sample.** A sample
would miss both double-accidental pairs, which are the only cases exercising the fallback, and
would miss `F#` major's `E#` — the case that proves single accidentals are kept.

`bun run verify` is the gate, and one negative assertion runs through the whole exercise: **no
pitch assertion outside Hirajoshi degree 3 may move.** The existing chord-progression migration
proof, the vibe golden fixtures other than Zen Garden's one line, and every bass/keyboard test are
all unchanged by construction; if one of them moves, the derivation reached further than this spec
says it does.

## Commit sequence

1. **Characterization test only** — no behaviour change, no source edit. Green on the current
   tables.
2. **Derive the qualities.** `ScaleDefinition` reshaped, `resolveDegreeQuality` added,
   `getDiatonicChordForDegree` rewired, `chordProgressions.migration.test.ts` moved to the
   resolver. The snapshot moves at Blues and Hirajoshi only; the Zen Garden fixture line, the three
   `roman` fields and the two progression descriptions change **in this same commit**, because
   splitting them leaves an intermediate commit whose data contradicts its own tests.
3. **`src/utils/noteSpelling.ts` and its tests**, with no callers — the module is provably correct
   before anything depends on it.
4. **Spelling into chord labels** — `formatChordLabel`'s third parameter and the seven call sites.
5. **Spelling into the melody grid, the keyboard and the key picker** — the three display surfaces,
   with the row-identity trap held.
6. **Docs** — `CLAUDE.md`, `SKILL.md` — and `bun run verify`.

## Risks

- **The Hirajoshi pitch change ships to an existing saved session.** A session whose chords were
  resolved from `zen-bamboo-vamp` holds `D sus4` in persisted state and keeps it: nothing rewrites
  stored chords, and nothing should. Only newly applied vibes and newly added quick-add chords use
  the derived quality. That is a divergence between an old session and a new one, and it is the
  correct behaviour — silently rewriting a user's chords to match a library edit is the failure
  mode the `snapProgressionToScale` / `transposeProgression` split exists to prevent.
- **`getBorrowedChords` for Blues and Hirajoshi** is the one output this spec cannot predict from
  the measurements above, because the filter's input is what moved. It is flagged in "Consequent
  edits" as something to measure during implementation.
- **The quality map throwing on an unmapped tuple** is deliberate and will be the first thing a
  twelfth scale hits. That is the point: a new scale whose stacking produces a tuple nobody has
  named should stop, not guess.

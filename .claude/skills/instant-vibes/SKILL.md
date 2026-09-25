---
name: instant-vibes
description: Add, remove, retune or debug an Instant Vibe in solna — the genre cards (Lo-Fi Chill, Synthwave 80s, Cyber EDM, Deep Ambient, Boom Bap, Zen Garden, Lo-Fi Waltz, Afro 6/8) in the Vibes picker, a Header tool, and the dice that rerolls them. Carries a survey-first workflow, the eight library ids a vibe resolves, the per-vibe dice pools and the two invariants that guard them, and the three golden fixtures behind the tests. Also covers changing a vibe's chords, synth voices, drum decoration, key pool or BPM range, and failures in vibes / vibeVariation / instantVibesProgressions tests.
---

# Instant Vibes (solna)

A vibe is a card in the Vibes picker. Picking one previews it on the current loop;
Use keeps it, Cancel restores the loop; the dice beside each card previews a reroll
of that vibe: different music with the same identity.

**A vibe is pure data.** The table is `VIBES` in **`src/data/vibes.ts`** — eight
`VibeSpec` literals that name library ids and nothing else. `src/data/` files
import nothing at runtime, so that file has no dependencies at all, which is why
the picker can import it eagerly.

**Resolution lives somewhere else.** `resolveVibe(spec)` in
**`src/store/vibes.ts`** turns the ids into a `ResolvedVibe` — the spec plus
`chords`, `drumPattern` and `effects` — and `previewVibe`
(`store/vibePreview.ts`) writes it through `vibeContentPatch`.

**Every library id is written exactly once.** It used to be written twice (an id
beside its resolved value), and the second copy was a documented typo hazard.
`resolveVibe` also passes the vibe's own `scaleRoot` and `scaleType` to
`resolveProgression`, so those cannot disagree with the vibe any more either.
`resolveProgression` takes no octave — the resulting `ChordItem`s carry no `notes`,
only `{id, root, quality, bars}`; the vibe's own `chordOctave` is applied later,
at derivation time, by whichever surface plays or displays the chords.

## Start by surveying, not by writing

A vibe is assembled from libraries, so the first question is what those libraries
already hold. One call answers it:

```bash
bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts            # summary
bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts Major      # one scale, in full
bun run report:library                                                # what nothing uses
```

The inventory prints, per scale type: which progressions are playable in it,
which of those have the 4 steps a vibe's own `progressionId` needs, every preset
by category with its timbre-defining parameters, what the existing vibes use, and
the comp-rhythm, bass-pattern, drum-grid and effect-chain ids.
`report:library` lists entries no vibe references — often the best candidates.

Then decide, in this order:

1. **Does an existing progression fit?** It must have `referenceScale` equal to
   your vibe's `scaleType`, `minScaleLength` no greater than that scale's degree
   count, and exactly 4 steps. Reuse is the normal answer.
2. **Do three existing presets fit the lead, comp and bass roles?** Bass must be
   `category: 'Bass'`; lead and comp are judged by ear.
3. **Only if something genuinely does not exist**, author it — read
   `references/authoring-libraries.md` first. It carries the gap test ("name the
   closest candidate and say what disqualifies it"), the seventh-chord trap that
   silently downgrades progressions to triads, and the engine facts that decide
   whether a preset's numbers are audible at all.

Authoring the library entry before the vibe keeps the vibe from ever pointing at
something that does not exist yet.

## What a vibe is

Identity fields, eight library ids, a few scalars, one `random` rule — and
nothing hand-authored that a library could hold instead.

| field | resolves through | hard constraint |
|---|---|---|
| `progressionId` | `progressionById` → `CHORD_PROGRESSIONS` (`src/data/chordProgressions.ts`) | must have **exactly 4 steps**; `referenceScale === scaleType` |
| `synthPresetId` (lead) | `presetById` → `SYNTH_PRESETS` (`src/data/synthPresets.ts`) | any category |
| `chordPresetId` (comp) | `presetById` | any category |
| `bassPresetId` | `presetById` | **`category === 'Bass'`** |
| `chordRhythmId` | `CHORD_RHYTHMS` (`src/data/chordRhythms.ts`) | — |
| `bassPatternId` | `BASS_PATTERNS` (`src/data/bassPatterns.ts`) | — |
| `drumGridId` | `drumGridById` → `DRUM_GRIDS` (`src/data/drumGrids.ts`) | rows are **every row the grid's origin group defines** (7 for a vibe grid, 8 for `house`), one bar of that grid's own meter, booleans |
| `effectChainId` | `requireEffectChain` → `EFFECT_CHAINS` (`src/data/effectChains.ts`) | stays a **`Partial`** — an omitted key means "inherit" |

Bass is a hard category constraint because register is physics, not taste. Lead
and comp are judged by ear — there are deliberately **no genre tags on presets**,
and adding one is a rejected design.

**`chords`, `drumPattern` and `effects` are not fields of a vibe.** Never write
one. If you need them in a test, call `resolveVibe(spec)`.

**`resolveVibe` throws on all three unknown ids**, by name:

```
Vibe "lofi-chill" references unknown progression id: nope
Vibe "lofi-chill" references unknown drum grid id: nope
Unknown vibe effect chain id: nope
```

## Arp: a vibe states it, in full

**This rule was inverted by the synth-engine change — do not follow an older
copy of it.** A vibe used to carry no arp at all, on the grounds that the
arpeggiator is a performance control and a vibe must not switch it on behind
the user. Half of that still holds; the omission does not.

- **Every vibe carries `arp`, and it names all five synth-capable tracks.**
  `VibeSpec.arp` is a required `Record<SynthControlTarget, ArpSettings>` —
  `synth`, `fx`, `chord`, `bass`, `pad` — and `previewVibe`
  (`store/vibePreview.ts`) writes all five through `vibeContentPatch`. Omitting a track is the bug the completeness is here to prevent: an
  unwritten track would keep whatever the PREVIOUS vibe armed, so "apply Lo-Fi
  Chill" would mean different things depending on history. Same rule, same
  reason as a drum grid writing every row its origin group defines, empty or
  not. `vibes.test.ts` fails on a missing key.
- **Write `{ active: false, mode: 'up', rate: '16n', octaves: 1 }` explicitly**
  for a track the vibe does not arpeggiate. That is the shape to copy; there is
  no "omit it and inherit a default" any more.
- **Arming one is a decision, and the table records how many exist.** Exactly
  one row in `VIBES` is `active: true` today — Cyber EDM's lead, where a 16th
  up-arpeggio over two octaves IS the genre — and a test pins that it is the
  only one. The old concern is answered by that test rather than by a blanket
  ban: arming an arpeggiator now requires editing a pinned count, which a
  reviewer sees, instead of being reachable by a stray default.
- **The flat fields are still forbidden.** `arpActive`/`arpMode`/`arpRate`/
  `arpOctaves` belong to the deleted flat `SynthParams` shape. A vibe writes
  `ArpSettings` objects (`active`/`mode`/`rate`/`octaves`) and a synth preset
  carries no Arp at all — `synthPresets.test.ts` rejects one that does.

## One thing a vibe must not carry

- **No presentational fields.** `color`, `bgGradient`, `borderColor`, `textColor`
  are forbidden; the card's look comes from theme tokens in
  `components/vibes/VibePickerModal.tsx`. An
  invariant test in `store/vibes.test.ts` pins this.

## `src/data/vibes.ts` may not import anything at runtime

This is an eslint rule (`src/data/**`), not a convention, and it is what lets the
vibe picker (`components/vibes/*`) import `VIBES` eagerly while the preview
module, `store/vibePreview.ts`, which reaches the engine and the resolvers, loads
lazily through a cached dynamic `import()`. The old vibe strip once read a
hand-duplicated seven-field copy (`store/vibeChips.ts`) precisely because
importing the real table dragged four library modules into the eager chunk.

**If you find yourself wanting to call a resolver inside `src/data/vibes.ts`,
stop.** That single call brings back the eager-chunk cost and the
duplication with it. Resolve in `store/vibes.ts` instead.

## Scale type is the vibe's identity — the dice never rerolls it

There is no genre union any more. `scaleType` is a free choice, made once per
vibe, and everything the vibe pools must agree with it. Two invariant tests in
`vibeVariation.test.ts` enforce that, per pooled progression:

1. `'every pooled progression fits the vibe's scale'` —
   `minScaleLength <= scaleEntry(vibe.scaleType).intervals.length`. This matters most
   for `zen-garden` (Hirajoshi, 5 degrees) and the pentatonic scales, where a
   7-degree progression used to vanish from the pool silently.
2. `'every pooled progression was authored against the vibe's own scale'` —
   `referenceScale === vibe.scaleType`.

`ChordProgression.genres` still exists as a free-form `string[]` for human
browsing. **Nothing computes from it.** A tag constrains no vibe and widens no
union; adding one is an edit to that progression and nothing else.

## The dice pool is a taste call, written out

`random` carries six explicit fields:

```ts
random: {
  keys: ['C', 'D', 'D#', 'F', 'G', 'A'],
  bpm: [78, 88],
  progressions: ['jazz-ii-v-i-vi', /* … */ 'lofi-coffeehouse', /* … */ 'lofi-morning-turnaround'],
  chordRhythms: ['lofiSwing', 'syncopatedPush', 'bassPlusStrum'],
  bassPatterns: ['dilla-sub', 'walking-groove', 'half-time-legato'],
  drumGrids: ['lofi-half-time-brush', 'lofi-hip-hop', 'lofi-ghost-kick', 'boombap-8th-hat'],
}
```

(`progressions` is abridged above — `lofi-chill`'s real pool has 7 entries, not 3.)

It used to be derived: `progressionIds` was pinned to the complete
genre-and-scale-length filter over the library, so adding one tagged progression
silently changed what unrelated vibes could roll. Pools are per-vibe now. The
accepted cost is that a new library entry does not join any pool automatically —
`bun run report:library` is what makes that visible.

`'the dice can always land back on the vibe as authored'` pins all six:
`keys ∋ scaleRoot`, `bpm[0] <= bpm <= bpm[1]`, `chordRhythms ∋ chordRhythmId`,
`bassPatterns ∋ bassPatternId`, `progressions ∋ progressionId`,
`drumGrids ∋ drumGridId`.

**A one-member array is legitimate** — it says "this axis is deliberately fixed",
and there is no `>= 4` floor any more. Know what it means: `pickDistinct` falls
back to the current value when it is the sole member, so that axis stops
rerolling. If you want the axis to reroll, give it **≥2 members**. Today's
authored minimum is 2 (`deep-ambient`, `zen-garden`, `lofi-waltz` and
`afro-six-eight` bass pools); keys are 5-6, chord rhythms 3 and drum grids 3-4.

## The drum axis is a pool like every other axis

`random.drumGrids` is a list of ids into `DRUM_GRIDS` — the same shape as
`progressions`, `chordRhythms` and `bassPatterns`. A reroll REPOINTS the vibe's
grid; nothing is rewritten in place any more. Two rules bite, and only two:

1. **The pool contains the vibe's own `drumGridId`**, so the dice can land back on
   the vibe as authored, and **every id resolves**. There is no meter constraint
   (trim-or-loop is the documented rule and the menus already surface it) and no
   minimum pool size (a one-member array says "this axis is deliberately fixed").
2. **The grid you point at must define every row its origin group defines**, each
   exactly one bar of that grid's own meter. `replaceDrumPattern` clears every
   track no row names, so an omitted row no longer leaks the previous grid's hits
   — but a grid should still state what it plays, including where it plays nothing.

The seven vibe grids, the sequencer's fourteen genre grids and the nine sourced
variants are **one table** of 30; a vibe may pool any of them and the sequencer menu
offers all of them. The CONTENT still did not merge: measured, no vibe's grid
matches its own genre entry best. There are no silent duplicates left:
`edm-offbeat-pump` was deleted (house and festival EDM cannot be honestly
distinguished on a step grid) and `afro-6-8` was corrected, so `drumGrids.test.ts`
pins that set as **empty**.

## Tests that pin exact counts or sets

**These fail loudly.** You cannot miss them; the gate stops you:

| file | what it pins |
|---|---|
| `src/store/vibes.test.ts` | `VIBES.length` is 8; the 8×3 preset matrix, id by id; the exact id list; id uniqueness; that `resolveVibe` succeeds for every vibe |
| `src/store/vibeVariation.test.ts` | every pool member resolves; the two scale guards; the dice lands back on the vibe as authored; the two drum-pool invariants |
| `src/audio/meterRegression.test.ts` | every vibe's declared meter |

**Three golden fixtures fail loudly too — but only about the right thing.**
`instantVibesChordsFixture.ts`, `instantVibesDrumsFixture.ts` and
`instantVibesEffectsFixture.ts` each hold a hand-copied snapshot of what the
eight vibes resolve to, and each is checked against `VIBE_IDS`, so a ninth vibe
**does** fail them, with a key-set mismatch naming your id.

| fixture | what it pins |
|---|---|
| `src/store/instantVibesChordsFixture.ts` | every vibe's resolved chords |
| `src/store/instantVibesDrumsFixture.ts` | every vibe's drum rows — seven, or eight for `cyber-edm`, which points at `house` |
| `src/store/instantVibesEffectsFixture.ts` | every vibe's effect chain, including which keys it omits |

Add your vibe's entry to all three by hand. They deliberately import nothing from
`VIBES`, from `resolveVibe` or from the libraries — **that independence is what
makes them proofs rather than tautologies, so never make one read the vibe table
or the resolver.** When a fixture test goes red on an *existing* vibe, that is
not a fixture to update: it means someone changed a library entry, and the
question is whether that sound change was intended.

One more that *may* fire: `'a pool may cross meters, and four members do —
deliberately'` in `vibeVariation.test.ts` is a global count of the pooled ids
whose meter differs from the pooling vibe's. Cross-meter pooling is allowed on
purpose — the grid is trimmed or looped to the transport's meter — so if your
new pool adds one, update the number rather than deleting the test.

## Never reorder the preview commands

`store/vibePreview.ts` runs `hardStopAll()`, then the synchronous
`audioEngine.stopSource('chord'|'bass'|'pad', 0.02)` cut **before the one content
write**, then `soloLoop(activeLoopId)`. Two real overlapping-audio bug fixes live
in that ordering (`d8df714`, `c4a253a`); `vibePreview.test.ts` pins it. Adding a
vibe is pure data and touches none of it — but a vibe that writes a new store key
must add it to `captureVibeTargets` (`store/vibes.ts`), or Cancel cannot restore
it (R338); the snapshot invariant test fails first.

## Adding a vibe: three files under `src/data/`, plus four more

| file | edit |
|---|---|
| `src/data/chordProgressions.ts` | a new `ChordProgression`, if none fits — `genres` is a free string array with no union to widen |
| `src/data/drumGrids.ts` | one grid — `name`, `meter`, `kit` and `rows` in one entry — if none fits |
| `src/data/vibes.ts` | one `VibeSpec`, whose `random.progressions` names whatever suits it |

Plus one row each in the three golden fixtures, and the count/matrix/id-list
updates in `store/vibes.test.ts`. `src/types.ts` is never touched, nor is
anything under `src/audio/`, `src/store/` or `src/components/`.

## Order of work

1. Survey (`scripts/vibe-inventory.ts`, `bun run report:library`) and decide what,
   if anything, is missing
2. Author only the genuinely missing library entries, with their tests —
   see `references/authoring-libraries.md`
3. The vibe literal in `src/data/vibes.ts` — every sound field an id, nothing
   hand-authored, and **no resolver call in that file**
4. `random`, with pools you chose and can defend
5. Update `store/vibes.test.ts`'s count, preset matrix and id list, then add your
   entry to all three golden fixtures. Every one of these fails loudly, so the
   gate will walk you through them — but it reports them one at a time, so expect
   several passes
6. `bun run verify`

## Gate

`bun run verify` (test + lint + eslint + check:keys + check:drums + build).
`bun run report:library` is **not** in it and never asserts anything.

## Bundled with this skill

- `scripts/vibe-inventory.ts` — what the libraries hold, per scale type
- `references/authoring-libraries.md` — read when the survey found a real gap

Related skills: `dsp-audio` before touching the engine or effect routing,
`music-theory` before touching scales, chord generation or bass/rhythm patterns.

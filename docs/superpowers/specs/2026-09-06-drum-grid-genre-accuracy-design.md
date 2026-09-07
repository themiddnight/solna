# Drum-Grid Genre Accuracy, and the Vibe Drum-Grid Pool — Design

Date: 2026-09-06
Status: Draft — all owner decisions settled and folded in (the ten corrections, the nine new
grids, `edm-offbeat-pump`'s deletion, `provenance`, the drum axis becoming a pool, the
`tom`/`crash` tracks, and `ride`/`bell` as slice 2)

Evidence base: `docs/research/2026-09-06-drum-grid-genre-survey.md`. Every canonical pattern and
every source URL cited below comes from that survey; this spec does not restate them, it decides
what to do about them. Every *count* below was re-measured against `src/data/drumGrids.ts` on this
branch — where a re-measurement disagrees with the survey, the disagreement is recorded rather
than smoothed over.

## Goal

**Make the drum library's grids say what their genres actually play, and make the drum axis a
dice pool like every other axis.**

Two things follow from that one sentence, and they are the two slices:

1. **The rhythms** — correct ten grids to a sourced pattern, author nine more, delete one that
   cannot be authored honestly, record where every grid came from, and give the sequencer the two
   tracks (`tom`, `crash`) that make already-authored rows audible.
2. **The voices** — add `ride` and `bell`, the two identity instruments the library's own 3/4 and
   6/8 idioms need and the schema does not have.

## Context — what was measured

### The library's rows are least differentiated exactly where genre lives

Re-measured on this branch over all 22 grids (`Object.keys(DRUM_GRIDS).length === 22`, counting
distinct row values by `JSON.stringify`):

| row | present in | distinct patterns |
|---|---|---|
| kick | 22 | **13** |
| tom | 22 | 11 |
| hihat | 22 | **11** |
| bass | 14 | 11 |
| openhat | 22 | **10** |
| snare | 22 | 7 |
| clap | 22 | 5 |
| crash | 8 | 2 |

- `clap` is a byte-exact copy of `snare` in **16 of 22** grids — re-measured, matches the survey.
- `hihat 2,6,10,14` is shared by **six** grids: house, dnb, dubstep, techno, reggae,
  `edm-offbeat-pump`.
- `hihat 0,2,4,6,8,10,12,14` is shared by three: synthwave, funk, rock.
- `hihat 0,2,4,6,8,10` is shared by **all four** twelve-step grids.
- `trap` and `synthwave-four-on-floor` both have all sixteen hihat steps on.

> **Two of the survey's Part-1 numbers differ from this table, and both are correct — they
> answer different questions.** The survey counted distinct rows by their hit-index list, which
> treats a bar as its rhythm regardless of length; this table counts by array value, which does
> not. Measured, the entire difference is cross-meter merging, and nothing else:
>
> - kick 12 vs **13** — hits `[0]` covers `waltz` (12 steps), `waltz-brush-three` (12) and
>   `ambient-sparse-drift` (16).
> - openhat 8 vs **10** — hits `[8]` covers `cyberpunk` (16), `afro-6-8` (12) and
>   `afro-six-eight-bell` (12); hits `[10]` covers `synthwave` (16), `ambient-sparse-drift` (16),
>   `waltz` (12) and `waltz-brush-three` (12).
>
> No empty row is involved (every one of the 22 grids defines kick, snare, hihat and openhat;
> only reggae's openhat is empty). **This spec uses array equality**, because a downbeat-only bar
> in 3/4 is not the same rhythm as one in 4/4 and should not be counted as one. The numbers the
> argument rests on are unaffected either way — **hihat 11** and **snare 7** are identical under
> both methods, as is clap-equals-snare at 16 of 22.

**The finding, stated as the reason this work exists:** the hihat is the row that carries genre
character, and it is the library's second-least-differentiated melodic-rhythm row. Six grids
across house, drum and bass, dubstep, techno, reggae and EDM — five genres that share almost
nothing musically — play the identical hat. That is backwards.

### Only 4 of 12 checked grids match a sourced canonical pattern

The survey checked twelve grids against sourced transcriptions and found four matches: **house,
dnb, rock, edm-offbeat-pump**. Its Part-2 diff table is the authoritative list of what is wrong
and what it should be; slice 1 implements that table and nothing beyond it.

### 44 authored rows are silently dropped, and only 30 of them are recoverable

`INITIAL_SEQUENCER_TRACKS` has five tracks (`kick`, `snare`, `hihat`, `openhat`, `clap`), and
`applyDrumPattern` looks a row up by track instrument name and ignores every row matching none.
Measured across the library:

| unplayable rows | rows | authored hits |
|---|---|---|
| `tom` + `crash` | 30 | 29 |
| `bass` | 14 | 53 |
| **total** | **44** | **82** |

**Adding `tom` and `crash` tracks recovers 30 rows and 29 hits — not all 44 and 82.** `bass` is
not a drum voice at all: `DRUM_KITS` defines kick, snare, hihat, openhat, clap, tom and crash, and
nothing else. The `bass` rows stay unplayable after this work, deliberately and permanently, and
the head comment on `drumGrids.ts` already says so. Anyone quoting "44 rows and 82 hits" as the
size of the win is quoting the size of the *problem*.

### DEV-382 left one table, which is what makes this change possible

`DRUM_GRIDS` is a single 22-entry table keyed by library id, with `meter` and `kit` as fields
rather than sidecar maps. A vibe's `drumGridId` can already name any of the 22. That is the
precondition for slice 1 item 6 — a drum *pool* was not expressible while a vibe could only reach
its own eight grids.

## Slice 1 — data and store

### 1. Ten grids are corrected to their sourced canonical pattern

The survey's Part-2 table is the change list. **Ten grids, not eight**: `waltz` and `afro-6-8`
appear in that table too, and their corrections are as sourced as the other eight.

The eight 4/4 corrections — techno, synthwave, dubstep, trap, boom-bap, lofi-hip-hop, funk,
reggae — are straight row rewrites against the sourced values.

The two twelve-step corrections need a caveat written into the diff, because they are the only
two that will land *half* right:

- **`afro-6-8`** — `snare` becomes the cross-stick `1,4,7,10`; `hihat` becomes the **standard
  bembé bell** `0,2,4,5,7,9,11`.
- **`waltz`** — `hihat` becomes the **jazz-waltz ride figure** `0,4,6,8`.

> **Both are written on the `hihat` row for now. The rhythm becomes correct; the timbre stays
> wrong.** A bembé bell played by a closed hi-hat is the right rhythm on the wrong instrument, and
> so is a jazz ride. Slice 2 gives both a real row and moves them there. Writing them onto `hihat`
> in slice 1 is not a shortcut around slice 2 — it is the half of the fix that does not need a new
> DSP voice, shipped first, and the survey's Part-4 entry for these two idioms is the note that
> keeps the other half from being forgotten.

The survey also records that in a real drum-set arrangement the bell and the hi-hat play
**simultaneously**. Slice 1 cannot express that at all; slice 2 can.

### 2. Nine new 4/4 grids; the library goes 22 → 30

From the survey's Part-3 table, the nine 4/4 entries: `techno-rolling`, `synthwave-attack`,
`dubstep-halftime`, `trap-quarter-hat`, `boombap-8th-hat`, `lofi-ghost-kick`, `funky-drummer`,
`rock-driving-8th`, `reggae-rockers`. Each is expressible at 16 steps and distinguishable from
what exists; each carries a source URL, which becomes its `provenance`.

The arithmetic: **22 − 1 (`edm-offbeat-pump`) + 9 = 30.**

The two twelve-step entries from Part 3 — `bembe-standard-bell` and `jazz-waltz-ride` — are
**slice 2**, not slice 1. Both are defined by a row the schema does not have yet, so authoring
them in slice 1 would mean authoring them onto `hihat` and then rewriting them, which is two edits
to make one change.

### 3. `edm-offbeat-pump` is deleted; `cyber-edm` repoints to `house`

**Decision, with its reason:** the survey found that house and trance/festival EDM are *literally
identical* on this grid — kick `0,4,8,12`, backbeat `4,12`, openhat `2,6,10,14` — and that sources
separate them only by sound design and sidechain, never by step position. **A distinct grid
cannot be authored honestly here**, so the library should not pretend to hold one. This is the
independent explanation for the library's own measured finding that `edm-offbeat-pump` and `house`
play identically today.

Measured, so the move is exact. The two grids differ on nothing a sequencer track can reach:

```
house              kick 0,4,8,12 | snare 4,12 | hihat 2,6,10,14 | openhat 2,6,10,14 | clap 4,12 | tom (empty) | bass 2,6,10,14
edm-offbeat-pump   kick 0,4,8,12 | snare 4,12 | hihat 2,6,10,14 | openhat 2,6,10,14 | clap 4,12 | tom 7,14     | crash 0
```

So: **move `edm-offbeat-pump`'s `tom 7,14` and `crash 0` into `house`**, which has an empty `tom`
row and no `crash` row today. That is **additive, not an overwrite** — nothing in `house` is
replaced — and it is what keeps `cyber-edm`'s sound intact once the tom and crash tracks exist. A
repoint that dropped those two rows would silently make `cyber-edm` quieter the moment item 11
lands.

Blast radius, grepped: `src/data/vibes.ts:288` (the repoint), `src/data/drumGrids.ts:291` (the
deletion), `src/data/drumGrids.test.ts` (`:30`, `:57`, `:143`, `:184`),
`src/audio/meterRegression.test.ts:129`, `src/store/instantVibesDrums.test.ts:73`, and
`.claude/skills/instant-vibes/SKILL.md:176`. The `drumGrids.test.ts:143` assertion on
`edm-offbeat-pump`'s openhat is deleted with the grid.

### 4. `DrumGrid` gains `provenance: string`

A source URL, or the literal `'authored'`.

**The reason is the cost we just paid.** A research pass was spent rediscovering which of 22 grids
had a documented basis and which were invented, and the answer is not recoverable from the table —
it was not recorded when the grids were written. The table should carry it, so the next question
of the form "where did this rhythm come from?" is answered by reading the entry.

It keeps `src/data/` purity trivially: a plain string field on a literal, no import, no
construction, no global. It also satisfies the folder's own distinguishing test — adding a grid
stays an edit to that table and nothing else.

### 5. `zen-bamboo-pulse` keeps its content, with `provenance: 'authored'`

**The survey found that "zen garden" is not a documented percussion tradition.** Searches surface
karesansui gardens, ambient playlists and Midori Takada; nothing with canonical patterns. The
nearest real East Asian idioms with notatable patterns — Miyake, Yatai-bayashi taiko — are dense
ensemble music, the opposite of the sparse thing this grid is.

**State that plainly in the entry's comment; do not soften it.** The grid is an invention that
sounds good, and `'authored'` is the honest label. The alternative — quietly attaching a
tangentially related source — is the failure mode `provenance` exists to prevent.

`zen-bamboo-pulse` is not the only `'authored'` entry; item 20 makes the full list an explicit
allowlist so that being unsourced is a deliberate act rather than an omission.

### 6. `VibeRandomRule.drumDecoration` becomes `drumGrids: string[]`

The same shape as `progressions`, `chordRhythms` and `bassPatterns`. **No new concept is
introduced** — the drum axis stops being the one axis with bespoke machinery and becomes the
fourth id pool.

`VibeSpec.drumGridId` is unchanged and stays the vibe's authored grid. `random.drumGrids` is the
set the dice may land on.

### 7. The decoration machinery is deleted outright

From `src/types.ts`: `DrumDecorationRule`, `DecorationLayer`, `DensityName`.

From `src/store/vibeVariation.ts`: `DRUM_DENSITIES`, `DRUM_DENSITY_METER`, `densityRowFor`,
`DECORATION_ORDER`, `LAYER_LABELS`, `COLLISION_FILTERED`, `collidesWithKick`, `eligibleDensities`,
`rollDecoration`.

**The kick-collision filter is deliberately not replaced, and that is a decision rather than an
omission.** `collidesWithKick` existed to constrain *generated* rows: a density picked at random
for `openhat` or `tom` could land on top of the kick and mud the downbeat, so the roll filtered
those candidates out. Authored grids are curated — a human chose every cell — and **real music has
reasons to double a kick**. A crash on beat 1 over a kick on beat 1 is standard, not a collision,
and `edm-offbeat-pump`'s `crash 0` against `kick 0,4,8,12` is an example already in the library.
Porting the filter to a pool of authored grids would reject grids for being correct.

`eligibleFor` is **kept** — it is the generic used by `pickDistinct` for every axis, not
decoration machinery.

One consequence the plan must enumerate rather than discover: `VariationSummary.drums` and
whatever type describes its elements are typed in terms of `DecorationLayer` and `DensityName`,
so they go too, replaced by the grid's name (item 8).

### 8. A rerolled vibe's `drumGridId` starts telling the truth

`VibeSpec.drumGridId`'s doc comment today documents a real disagreement:

> Unlike `progressionId`, a reroll does NOT repoint this: the dice decorates the resolved grid in
> place, overwriting only the `hihat`/`openhat`/`tom`/`crash` rows … so a rerolled vibe's
> `drumGridId` and its `drumPattern` can legitimately disagree.

**After this change that disagreement disappears.** The dice picks a grid id, `resolveVibe`
resolves it, and `resolved.drumGridId` names the grid actually playing — exactly as
`progressionId` already behaves. Delete the comment; do not rewrite it into a weaker version.

The variation toast follows: `formatVariationSummary`'s drum segment stops being
`drums: closed hat swung16ths, open hat pickup` — built from `LAYER_LABELS` and density names —
and becomes the **grid's display name**. That is both shorter and more useful: a listener who
hears the drums change can now be told what to look for in the sequencer's grid menu.

### 9. Two pool invariants, and exactly two

1. **`random.drumGrids` contains the vibe's own `drumGridId`** — the dice can always land back on
   the vibe as authored. The sibling assertions already exist for keys, chord rhythms, bass
   patterns and progressions.
2. **Every id in `random.drumGrids` resolves** in `DRUM_GRIDS`.

**Explicitly NOT a meter constraint.** Trim-or-loop is the project's existing, documented rule for
a pattern whose meter differs from the transport's, and it is surfaced to users by
`patternMeterTitle` / `patternOptionLabel` in the sequencer, chord and bass menus. Forcing
same-meter membership in the dice alone would make the dice stricter than the menu that sits three
inches from it — the app would refuse to roll something the user can select by hand.

**Explicitly NOT a minimum pool size.** `VibeRandomRule`'s own doc comment already settles this:
*"A ONE-MEMBER ARRAY IS LEGITIMATE. It says 'this axis is deliberately fixed' in the same shape as
every other axis."* Reintroducing a floor here would re-create the quota the previous branch spent
Part 3 removing.

**Cross-meter pooling is therefore allowed, and it is how the 3/4 and 6/8 vibes get variety before
slice 2.** `lofi-waltz` and `afro-six-eight` have four twelve-step grids between them in the whole
library, all four of which share the same hihat row today. Being permitted to pool a 4/4 grid is
the difference between a dice that does something and a dice that does nothing.

**Pools are authored same-meter by default.** The permission is a design property; using it is a
taste decision made per vibe, and the plan should say which vibes exercise it and why.

### 10. The drum axis uses `draw.pick`, following the progression axis

`resolveVibeVariation` takes a `current` of exactly three fields — `scaleRoot`, `chordRhythmId`,
`bassPatternId` — and `pickDistinct` needs one. There is no fourth to give it: the playing grid
id lives nowhere. `SequencerView` keeps it in a `useState`, and `applyVibeToStore` never writes
it at all.

An earlier draft of this spec said `pickDistinct`, "like the other axes". Three of the four axes
use it; **`progressions` uses plain `draw.pick`** (`vibeVariation.ts:201`), and the drum axis
follows that one:

```ts
const drumGridId = draw.pick(rule.drumGrids);
```

The alternative was a new `activeDrumGridId` in the sequencer slice, written by both
`applyVibeToStore` and the sequencer menu. That is a second source of truth for the playing grid,
and if either writer is ever missed, `pickDistinct` silently excludes the wrong id — leaving pool
invariant 1 true on paper and false in the running app. The accepted cost is that consecutive
rolls can repeat a grid, at the same 1-in-N the progression axis already accepts.

### 10a. `applyDrumPattern` becomes `replaceDrumPattern`, and replaces

Today `applyDrumPattern` skips any track whose instrument the pattern does not name
(`sequencerSlice.ts:34`, `if (!row) return track`). That has been invisible because every grid
declares every row the five tracks have, so merging and replacing were the same operation.

**Adding tom and crash breaks that**, and it is a bug this work introduces, not one it inherits:
the 14 sequencer genre grids declare no `crash`, so loading one after a vibe leaves the vibe's
crash ringing under it. Reproduce: press a vibe chip, then pick `techno` from the sequencer menu.
Part 2 makes it worse — nine tracks, and most grids name neither `ride` nor `bell`.

The fix restores the semantics that already held: **a drum grid determines the whole kit.** A
track the pattern does not name has its window cleared:

```ts
const next = row ? adaptStepRow(row, stepsPerBar) : new Array(stepsPerBar).fill(false);
return { ...track, steps: writeStepWindow(track.steps, stepsPerBar, next) };
```

Clearing goes through `writeStepWindow`, so it clears only the active window and **the padding
beyond `stepsPerBar` survives** — the non-destructive meter scheme is untouched, and
`store.test.ts`'s seeded-`true`-at-index-20 proof still holds.

The action is renamed `replaceDrumPattern` because the contract changed and the old name no
longer describes it: a partial call now clears everything it does not name. The rename forces
every call site to be re-read, which is the point. Both real callers — the sequencer menu and
`applyVibeToStore` — already pass a whole grid.

`store.test.ts:242-280` encodes the old contract in two assertions (other tracks untouched; an
unmatched key changes nothing) and both are rewritten, not deleted: the first becomes "every
track the pattern does not name is cleared in the window and keeps its padding", the second
becomes "a pattern naming only unknown instruments clears every track".

### 11. `tom` and `crash` sequencer tracks

`DRUM_KITS` already synthesises both — `TomParams` and `CrashParams` are two of the six param
interfaces, and `engine.triggerDrum` has `case 'tom'` and `case 'crash'` — and the drum pads
already play them by keyboard (`DEFAULT_PADS` has `lowtom`, `hightom` and `crash` on `Comma`,
`Period` and `Slash`). **Only the sequencer tracks were missing.** This is the change that makes
30 authored rows and 29 authored hits audible for the first time.

Track colours must be **semantic theme tokens** and pass `check:theme`. The five existing tracks
use `bg-error`, `bg-warning`, `bg-success`, `bg-accent`, `bg-secondary`, which leaves
`bg-primary`, `bg-info` and `bg-neutral` unused among the non-surface tokens in `THEME_TOKENS`.
Two of those three go to tom and crash.

> **A trap for slice 2, found while counting.** `THEME_TOKENS` has **eight** non-surface entries
> (primary, secondary, accent, neutral, success, warning, error, info). Five tracks today, seven
> after this item, **nine after slice 2's ride and bell** — so nine tracks cannot each hold a
> distinct semantic token. Slice 2 must either repeat a token, use an opacity variant, or change
> how a track's colour is chosen. This is named here so it is a decision in the plan rather than a
> surprise at the end of slice 2.

### 12. Migration: one shared pure transform, used by two chains that never merge

```
withDrumTracks(tracks: SequencerTrack[]): SequencerTrack[]
```

- **Idempotent.** Running it twice is running it once.
- **Appends only.** It adds a track whose `instrument` is absent and **never rewrites one that is
  present** — a user who renamed, recoloured, muted or reprogrammed a track keeps it exactly.

`sequencerTracks` is **stored in exactly one place that either chain can reach: inside every
`loops[]` entry.** It exists on the store's flat state too, but neither chain sees that copy —
`partializeAppState` (`store/store.ts`) is an allowlist of 9 global fields plus `loops`, and it
does not list `sequencerTracks`; `PROJECT_CONTENT_KEYS` is `['bpm', 'meterId', 'masterVolume',
'effects', 'loops']` and does not either. The flat copy is derived from the active loop on
hydration, by design.

Both chains therefore map `loops[]` and nothing else. An earlier draft of this spec said "top
level and inside every `loops[]` entry"; that was wrong, and a migration written to it would have
patched a key no payload contains — silently doing nothing at the top level while appearing to
cover two cases. `migrate.ts` does touch a flat `state.sequencerTracks`, but only on the pre-v6
legacy path, which a v12 payload has already left behind.

The two chains:

| chain | where | version move |
|---|---|---|
| persist | `migrate` in `store/store.ts`, before `merge` | `version: 12` → **13**, one more line at the bottom of the ordered chain |
| project body | `migrateProjectBody` in `store/projectFormatMigrate.ts`, before `sanitizeContent` | `PROJECT_FORMAT_VERSION: 4` → **5** |

> **Never merge the chains.** `CLAUDE.md` records the rule and `projectFormatMigrate.ts`'s own
> `upgradePadLayerV4` docblock is the precedent: it shares exactly one pure helper
> (`defaultPadState()`) with the persist chain's `migratePadLayer` and *"must not be refactored
> into one function with it: a project body is an external contract, the persist payload is
> private localStorage shape, and their version numbers move for different reasons."*
> `withDrumTracks` is the `defaultPadState()` of this change — a shared pure transform, called from
> two separate upgrade steps.

**No existing session or `.solna` file changes sound.** An appended track is silent: its `steps`
are all `false`. The new rows are heard only when a grid or a vibe is applied afterwards, which is
a deliberate user action. This is the same discipline `upgradePadLayerV4` follows with
`padMuted: true` — *"a project written before the layer existed must reopen sounding the way it
sounded when it was closed."*

## Slice 2 — DSP and schema

### 13. `ride` and `bell` become real voices

> **Trap — `ride` is already an alias for `crash`.** `DRUM_ALIASES` in `src/audio/engine.ts` maps
> `ride: 'crash'`, and `triggerDrum` resolves `DRUM_ALIASES[name] ?? name` *before* its switch, so
> a `case 'ride'` added without deleting that alias is dead code nothing can reach. Two engine
> tests pin the alias by name (`'closedhat, lowtom and ride resolve to their canonical voices'`
> and `'ride resolves to crash specifically, not clap'`); they are rewritten when it goes, not
> deleted. Nothing equivalent exists for `bell`.

The full surface, enumerated so the plan can cost it:

- **`DrumKit` interface** gains `ride: RideParams` and `bell: BellParams`; the two new param
  interfaces join the six existing ones (`KickParams`, `SnareParams`, `HatParams` — shared by
  `hihat` and `openhat` — `ClapParams`, `TomParams`, `CrashParams`).
- **`DEFAULT_DRUM_KIT`** gains both.
- **All 12 kits** gain both: Retro Drive, 909 Modern, Trap Beat, 808 Vintage, Chrome Pulse,
  Velocity Breaks, Sub Weight, Warehouse, Tight Pocket, Acoustic Studio, Warm Riddim, Lo-Fi
  Vinyl — **24 new param objects**, hand-tuned per kit.
- **Two `engine.triggerDrum` cases**, joining the seven that exist. **A ride is a defined ping
  with sustain; a bell is a pitched metallic tone. Neither is the existing crash's wash** — if
  either is implemented as a filtered crash, `check:drums` is the thing that should catch it, and
  if it does not, the voice is not worth adding.
- **Two `DEFAULT_PADS` entries** with shortcuts that pass `check:keys`. Today's eight pads use
  `KeyZ`, `KeyX`, `KeyC`, `KeyV`, `KeyM`, `Comma`, `Period`, `Slash`; the two new codes must
  collide with neither those nor the synth keyboard map. I did **not** search for two free codes —
  that is a plan task, and `check:keys` is the arbiter.
- **Two more sequencer tracks**, subject to the eight-token trap named in item 11.
- **A second migration round on both chains** — persist 13 → 14 and `PROJECT_FORMAT_VERSION`
  5 → 6, reusing `withDrumTracks` unchanged, since it appends only what is missing.

### 14. `bembe-standard-bell` and `jazz-waltz-ride` are authored, and the two smuggled rows move home

Both are twelve-step grids from the survey's Part-3 table:

- `bembe-standard-bell` — snare `1,4,7,10`, bell `0,2,4,5,7,9,11`
  (Jerry Leake, *Perspectives on the Standard African Bell*)
- `jazz-waltz-ride` — ride `0,4,6,8` (studydrums.com)

And the half-fix from slice 1 item 1 is completed: **`afro-6-8`'s bell rhythm moves off `hihat`
onto `bell`, and `waltz`'s ride figure moves off `hihat` onto `ride`.** Only after that can either
grid express what the survey says the real arrangement does — bell and hi-hat sounding at the same
time, on two rows.

### 15. Both voices ship together, in one slice

**Reason:** `check:drums` enforces parameter spread across the merged kits, so adding *one* voice
already forces a retune of all twelve kits. Adding the second at the same time is the same tuning
pass, not a second one. Splitting them would mean tuning twelve kits twice for one net result.

### 16. Correcting a loose claim: there is no free row to reclaim

An earlier point in discussion suggested `clap` could be freed for a new voice. **That is wrong,
and it is recorded here so it is not acted on later.**

`clap` is a real voice: it has `ClapParams` in every kit, a `case 'clap'` in `triggerDrum`, a
`DEFAULT_PADS` entry on `KeyM`, and a sequencer track (`bg-secondary`). The survey's finding was
that clap *data* duplicates snare data in 16 of 22 grids — **an authoring observation about how
the grids were written**, not a statement that the voice is unused. Reclaiming the row would
delete a working instrument to avoid adding a new one.

**`ride` and `bell` are net-new voices**, with everything item 13 lists. The schema grows from
seven drum voices to nine; nothing is recycled.

## Verification — and the problem it cannot solve

### 17. This slice cannot prove itself the way the previous branch did

The data-layer-extraction branch had a contract a machine could settle: *"only import paths and
symbol names may change. If an asserted value has to change, something broke."* Measurement
decided every question, because the sound was required to be identical.

**Here the sound changes on purpose.** Ten grids are rewritten and nine are invented; every test
that pins a drum row will go red *by design*. So the suite can tell us **what** changed and that
nothing changed by accident — it can never tell us that the new rhythm is right. A test asserting
`techno.hihat === all sixteen` is a transcription check against a source URL, not a judgement that
techno sounds like techno.

**That is this spec's central verification problem, and it is stated up front so nobody mistakes a
green `bun run verify` for a finished change.** The machinery below exists to make the human
listening pass (item 24) *cheap and targeted*, not to replace it.

### 18. Snapshot before, diff report after

Before any edit, snapshot all 22 grids. Then a diff-report script in the shape of
`report:library` — **a report that always exits 0, never an assertion** — prints per-grid,
per-row step changes: what steps came on, what went off, per row, per grid.

It is reviewed by eye **once**, and **its output is quoted in the commit message**. That is the
artifact a reviewer reads instead of scrolling through 30 grids of booleans, and it is the record
that says which of the changes were the ten intended corrections and which were not intended at
all.

It is a report and not a test for the same reason `report:library` is: a changed drum row is a
fact about content, not a defect, and asserting on the set of changes would mean editing the
assertion every time content is edited — which is a test that asserts nothing.

### 19. Test names cite their source

> `test("techno's hat is rolling 16ths with an open on every offbeat (Attack Magazine)")`

The name is the only place the *reason* for an expected value survives. A test called
`'techno hihat'` asserting sixteen `true`s is indistinguishable from a test that pins a typo; the
same test with the source in its name tells the next reader both what is being claimed and who
claims it. This applies to all ten corrections and all nine new grids.

### 20. A provenance test

Two assertions:

1. **Every grid has a non-empty `provenance`.**
2. **Every grid whose provenance is `'authored'` is in a named allowlist in the test.**

The second is the load-bearing one: it makes shipping an unsourced grid a **deliberate act** —
adding a name to a list a reviewer sees — rather than the default that happens when nobody looked
for a source. `zen-bamboo-pulse` is on that allowlist by decision (item 5).

### 21. The silent-duplicate test goes from two pairs to zero

`drumGrids.test.ts` currently pins exactly two silent duplicates —
`['edm-offbeat-pump', 'house']` and `['afro-six-eight-bell', 'afro-6-8']` — plus a sweep asserting
*"no other vibe/genre pair is a silent duplicate."*

Both disappear in slice 1: `edm-offbeat-pump` is deleted (item 3), and `afro-6-8`'s snare and
hihat are rewritten (item 1) so it no longer plays identically to `afro-six-eight-bell`.
`SILENT_DUPLICATES` becomes `[]`.

**The sweep is kept and keeps guarding.** An empty expected set is the strongest form this test
has ever had: any new duplicate is now a failure with no allowlist to hide behind.

### 22. `withDrumTracks` preserves user programming by reference

A 5-track payload yields 7, and **the first five are reference-identical** — `toBe`, not
`toEqual`. A `toEqual` assertion passes against a `withDrumTracks` that rebuilds every track from
defaults and happens to reproduce the same values today; `toBe` fails against it. That distinction
is the whole point of the transform: a user's renamed, recoloured, muted, reprogrammed track must
come back as *the same object*, not as an equal one.

Plus: idempotence (`withDrumTracks(withDrumTracks(x))` equals `withDrumTracks(x)`), and coverage
of the loop-nested case, since a payload's `loops[]` entries each carry their own
`sequencerTracks`.

### 23. Exactly one golden-fixture change

**`instantVibesDrumsFixture`'s `cyber-edm` entry gains house's `bass` row. Every other vibe's
entry stays byte-identical.**

That follows from the measurement in item 3: repointing `cyber-edm` from `edm-offbeat-pump` to
`house` changes nothing on kick, snare, hihat, openhat or clap; the tom and crash rows **move
with it** into `house`; and the only row `house` has that `edm-offbeat-pump` did not is `bass`.
**`cyber-edm`'s sound does not change**, because `bass` is not a drum voice and stays unplayable
after slice 1 and after slice 2.

If any other fixture value moves, something was edited that this spec did not authorise.

### 24. Explicit listening tasks, in the plan

`bun run verify` cannot judge whether drums sound right, so the plan must carry listening tasks as
numbered steps with the same weight as the code steps:

- **Load each corrected genre from the sequencer's grid menu and listen** — techno, synthwave,
  dubstep, trap, boom-bap, lofi-hip-hop, funk, reggae, waltz, afro-6-8. The question is not "did
  the steps change" (the report answers that) but "does this sound like the genre now".
- **Press all eight vibe chips**, confirming each still sounds like itself.
- **Roll the dice repeatedly on each vibe** — the drum axis is new, so this is the first time a
  reroll changes the grid rather than decorating it. Listen specifically for a cross-meter pool
  member landing on `lofi-waltz` or `afro-six-eight` and being trimmed or looped (item 9).
- **Compare tom and crash before and after the tracks exist** — 30 rows become audible at once,
  and some of them were written by an author who could not hear them. If a tom fill is wrong, this
  is where it shows up, and fixing it is in scope.
- **Audition all 12 kits' new ride and bell** in slice 2, after `check:drums` passes. A passing
  separation check means the parameters differ, not that the voices sound like a ride and a bell.

## Non-goals

- **A per-grid step-resolution axis.** This is the big one and it gets **its own spec**. The
  survey's Part 4 is clear that resolution, not authoring, is what blocks real trap hat rolls
  (32nd/triplet) and the Purdie shuffle (8th-note triplets). The lead melody already has this axis
  via `LEAD_TICKS_PER_BAR`, so the shape is known — but a drum grid finer than its transport meter
  touches **the shared 16th clock**, which `CLAUDE.md` documents as starting and stopping with its
  subscriptions and which nothing else may hold. That is a transport change, not a content change.
- **Per-cell velocity.** The survey's Part 4 names ghost-note velocity as *the* groove in
  Purdie/Stubblefield funk. A boolean grid cannot hold it.
- **Swing and shuffle timing.** Attack Magazine's cited MPC swing figures — 57% on 8ths, 74% on
  16ths — are what separates boom bap and lo-fi from generic straight hip-hop, and are not
  storable in this schema.
- **Changing which progression, synth preset or effect chain any vibe uses.** This change touches
  the drum axis and nothing else about a vibe.
- **The three vibes naming a `soundKit` that `DRUM_KITS` does not define** — `cyber-edm` →
  "Hyperpop 2000", `deep-ambient` and `zen-garden` → "Minimal Glitch". Verified: `DRUM_KITS` has
  twelve kits and neither name is among them. **This is a real pre-existing bug**, recorded in
  DEV-382's comments, and it is deliberately left out: **no source says which kit those three
  should have**, so fixing it here would mean inventing three sound decisions inside a change whose
  entire justification is that its decisions are sourced. It needs its own listening pass.
- **Reclaiming the `clap` row** — see item 16.

## Open questions, left to the plan

These are decisions the spec deliberately does not make, because each needs work the spec has not
done:

1. **Which vibes get cross-meter pool members, and which.** Item 9 permits it; nothing has chosen
   it. `lofi-waltz` and `afro-six-eight` are the two that need it, and the specific ids are a
   taste call for whoever listens.
2. **The nine new grids' pool membership.** Nine grids arrive and each vibe's `random.drumGrids`
   is authored by hand. Which vibe pools which of the nine is content, not mechanism — and
   `report:library` will list any of the nine that no vibe references, which is a fact, not a
   failure.
3. **Two free keyboard shortcuts for the ride and bell pads.** Not searched for; `check:keys` is
   the arbiter (item 13).
4. **Nine tracks against eight semantic tokens.** Repeat a token, use an opacity variant, or
   change how a track's colour is assigned — named in item 11, decided in the plan.
5. **Whether any tom row needs re-authoring once it is audible.** 30 rows become hearable at once
   and some were written blind (item 24). Whatever the listening pass finds is in scope for this
   work; what it will find is not predictable from the source.
6. **The exact `RideParams` / `BellParams` fields.** Item 13 states what the voices must *sound*
   like and what they must not be; the synthesis is a `dsp-audio` question answered against the
   engine, not here.

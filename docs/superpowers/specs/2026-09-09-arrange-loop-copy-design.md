# Selective loop copy on the Arrange page

Date: 2026-09-09 · Status: design agreed, not yet planned

Two gestures on the Arrange card: `Duplicate`, which already exists and gets an honest name for
its clone, and `Copy into…`, which is new and takes only the parts you point at. Under both of
them, a change to what a loop's label *is*: two fields, one the user's and one the app's, so a
card can say something about the loop before anybody has named it.

## Problem

**The only way to move material between loops today is to copy all of it.** `duplicateLoop`
runs `cloneLoop` — a `structuredClone` of the whole `Loop` — and inserts the result after the
original. That is the right shape for "give me another one of these", and it is the wrong shape
for the two things people actually want while arranging: *take the lead patch from the chorus
into the verse*, or *take the drum pattern from the intro and leave everything else alone*.
There is no gesture for either, so the workaround is to duplicate and then hand-rebuild
whatever should not have come along.

**The clone also loses its lineage.** `duplicateLoop` names the copy with `nextLoopName`, which
scans for `^Loop (\d+)$` and returns one above the highest match. Custom names do not consume
numbers, so duplicating a loop called `Drop` produces `Loop 5` — a name that says nothing about
where the loop came from, in a list where the whole point of duplicating was that the two are
related.

**And a loop's name cannot be told apart from a loop's name.** `createDefaultLoop` and `addLoop`
write `Loop N` into the same `name` field the rename input writes to, so nothing in the state
distinguishes *the app called this Loop 3* from *the user called this Loop 3*. Every consequence
follows from that one collision: `Loop 3` cannot be reverted to an automatic label, because there
is nothing to revert to; a rename input cannot be opened empty, because emptiness is not a value
the field can hold; and the card has no room to hint at what the loop sounds like, because the
only slot it has is already occupied by a number the user did not choose.

## Two label fields

`Loop` gains **`tempName: string`** beside the existing **`name: string`**.

- **`name` is the user's.** It is `''` until they set one, and `''` again if they clear it.
  Nothing but a rename ever writes it.
- **`tempName` is the app's.** It is never empty. It starts at `untitled-{n}` and is overwritten
  with a vibe's name whenever a vibe is applied to that loop.

**The displayed label is `name || tempName`.** One `||`, no third tier and no fallback string at
the call site, because sanitize guarantees `tempName` is a non-empty string on every loop that
reaches the store — see Persistence below. A resolver that ends in `?? 'Loop'` would be admitting
that guarantee is not real.

`createDefaultLoop` therefore ships `name: ''`, `tempName: 'untitled-1'`, and the `Loop N` string
leaves the codebase as a stored value entirely.

### `tempName` is a snapshot, not a reference

When a vibe is applied, `tempName` is set to the vibe's **display name** — the plain string
`Synthwave 80s`, not the id `synthwave-80s` and not a pointer to the entry.

**Why a copied name rather than a stored `vibeId`.** Applying a vibe is a *bulk setter*: it writes
key, BPM, meter, chords, patterns, kit and four synth patches in one gesture, because typing all
of that by hand is tedious. It is not a declaration that the loop *is* that genre. The user is
free to keep the chords, swap the kit, halve the tempo and end up somewhere else entirely — and
they usually do, which is the whole point of the chips being a starting position. A stored vibe id
is a reference that claims identity, and it goes on claiming it after the sound has moved on: the
card would say `Cyber EDM` about a loop that has been a ballad for an hour, and no amount of
re-resolving fixes that, because the id is not wrong about the library, it is wrong about the
loop. A copied name claims only history — *this loop was started from Cyber EDM* — and history
cannot go stale.

Three structural consequences follow, and they are the reason this is worth stating rather than
just doing:

- **No new persisted key that must resolve against a library.** `store.ts` keeps a deliberate
  group of persisted keys that must name a real library entry rather than merely satisfy a bare
  `typeof`; a loop-level `vibeId` would join that group and drag `VIBES` into `sanitizeLoops`,
  which today validates loops with no knowledge of the vibe library at all. A string needs a string
  check.
- **Renaming or removing a vibe cannot dangle an old loop.** The library is free to churn — the
  Instant Vibes roster is expected to — and no loop written before the churn is left pointing at
  nothing.
- **`tempName` is loop-slot identity, not loop content.** It sits with `id`, `name` and
  `repeatCount` on the far side of the same boundary `LoopStatePatch`
  (`Omit<Loop, 'id' | 'name' | 'repeatCount'>`) already draws, so it stays **out of
  `LOOP_FLAT_KEYS`** and out of the patch. It needs no copy group, it does not disturb the coverage
  invariant below, and `applyLoopCopy` never touches either label field.

### The `n` in `untitled-{n}` is stored, not positional

The number is assigned once, at creation, by the same max-plus-one scan `nextLoopName` already
does — with `untitled-` as the stem instead of `Loop `, and reading `tempName` instead of `name`.
It is then a stored string like any other, never recomputed.

**The trade this accepts:** the label never shifts when loops are dragged, at the cost of gaps
after deletions. `untitled-2` can sit directly above `untitled-7`. That is the lesser problem in
both directions — a positional label would silently rename every card below a reorder or a delete,
which is a label lying about which loop it is attached to, whereas a gap reads correctly as *that
one was made later* and costs nothing.

**The lowercase hyphenated form is deliberate.** Every other label in the app is title-cased
(`Loop 1`, `Drop`, `Lo-Fi Chill`), so `untitled-3` does not look like a name somebody chose. The
shape is the signal that the slot is empty.

### Who writes `tempName`

`applyVibeToStore` already calls `setSelectedVibeId(vibe.id)` in its context step; it gains one
more call there, writing the vibe's display name into the **active loop's** `tempName`.

Because `tempName` is not in `LOOP_FLAT_KEYS`, the flat→`loops[]` mirror in `loopSync.ts` will not
carry it — there is no flat field for it to mirror from. So it needs its **own small loop-slice
action writing `loops[]` directly, in the shape of `setLoopName`**, and the vibe path calls that.
Adding a flat mirror field instead would put a label into the copyable content set and break the
boundary the previous section just drew.

**The write happens even when the loop already has a user `name`.** `tempName` always means "the
last vibe applied here, else the untitled number I was born with" — it simply stays invisible
behind the user's name. A conditional write would make clearing a name reveal a stale untitled
number instead of the vibe the loop was actually built from, which is the one moment the field
exists to serve.

### One resolver, because labels reach aria-labels

A pure **`loopLabel(loop)`** returning `name || tempName`. `ArrangeView` resolves it and passes it
to the card as a prop, so the card never reads the raw fields; `LoopSelector` calls the same
function, and so do both of `TransportBar`'s reads — the `Song · <loop>` badge and its
`activeLoopName` — which would otherwise render a bare `Song · ` for an unnamed loop. Every
site that renders a loop's label goes through this function; none reads `name` directly.

This is one function rather than a `||` repeated per site because **several of the card's reads
are `aria-label`s** — `Drag to reorder ${loop.name}`, `Rename ${loop.name}`, `Edit`, `Move up`,
`Move down`, `Duplicate`, `Delete`, `Repeat count for` — plus the `loopName` prop handed to
`LoopAuditionButton`. A single missed site is not a visibly blank card; it is a screen reader
announcing "Delete ", which nobody sees in review and no snapshot test notices.

### Rename UX, and the bug in the way

**The input opens EMPTY, with the displayed label as its `placeholder`.** Not prefilled with it.
Prefilling is the trap: a user opens rename, changes their mind, and blurs — `handleSaveName` runs
on blur — and `Synthwave 80s` is silently promoted from a snapshot into a real `name`, after which
it stops tracking vibe applications forever. Nothing on screen changes, so there is no way to
notice it happened. With a placeholder, an untouched input saves `''`, which is what the user did.

**`handleSaveName` currently discards an empty input.** Its guard is `if (trimmed && trimmed !==
loop.name)`, so "clear the name to go back to the temporary label" cannot work until `''` is
accepted as a real value rather than treated as a cancel. The condition becomes a comparison
against the current `name` alone; saving an empty field writes `name: ''` and the card falls back
to `tempName` through `loopLabel`.

One rename to do while in there: the card's existing local `useState` for the in-progress input is
itself called `tempName`. Two different `tempName`s in one file, one a draft of `name` and one the
new stored field, is a collision worth removing in the same change — the local becomes
`draftName` or similar.

### Persistence

**No `version` bump and no migration step**, per the repo's standing rule: validation replaces
chains. A loop persisted before this change has no `tempName`, and `sanitizeLoops` fills a missing
or blank one at read time — the same shape it already uses for a missing `name`, and the thing
that makes the display resolver's single `||` safe. The fill is not a plain positional
`untitled-{index + 1}`: `resolveTempName` first gathers every explicit `tempName` already present
anywhere in the raw array, then claims the next free `untitled-N` ordinal, skipping any number an
explicit `tempName` elsewhere in the array has already claimed — so a missing `tempName` at index 1
resolves to `untitled-3`, not `untitled-2`, when some other row in the payload already carries
`tempName: 'untitled-2'`. This avoids handing out a collision on the very read path meant to
guarantee `tempName` is unique. `name` loses its `Loop N` fallback in the same place: a missing or
non-string `name` becomes `''`, since `''` is now a legal value rather than a hole.

`sanitizeContent` (projectFile.ts) calls `sanitizeLoops`, so a `.solna` body written before this
change gets the same treatment on import, with no `formatVersion` move.

### One contradiction cleaned up: `selectedVibeId`

`selectedVibeId` **stays exactly where it is** — a single global value in `musicContextSlice`,
persisted, driving the vibe bar's highlight. Under this model that highlight means *the chip just
pressed*, not *what this loop is*; the per-loop answer is now `tempName` and there is no reason for
two of them.

But today it survives a loop switch, so it can contradict the card: switch from a loop built out of
`Synthwave 80s` to one built out of `Lo-Fi Chill`, and the card reads `Lo-Fi Chill` while the bar
still highlights `Synthwave 80s`. **`loadLoop` therefore clears `selectedVibeId` to `null`** in the
`setState` it already performs alongside `loopStatePatch(loop)` and `activeLoopId` — on both paths,
the boundary path and the hard-stop path, but only when the switch actually **leaves** the loop that
was active (`store.activeLoopId !== id`). Re-entering the loop that is already active — an audition
toggle, a re-select of the same card — is not leaving it, so that case omits the key and the chip
survives untouched; a first cut cleared it unconditionally and blanked the chip on exactly that
re-entry, which is why the guard exists. Leaving the loop turns the light off; the bar highlights
a chip only while you are still on the loop you pressed it for. (Project Open already nulls it for
the same reason, in `projectFormat.ts`.)

**This is deliberately the smallest fix.** The vibe id is *not* being moved per-loop, because under
this model it is not a property of a loop at all — the loop's relationship to a vibe is the name
snapshot, and the id is a fact about the last button pressed.

## The two gestures

They stay visibly distinct on the card, because they answer different questions.

### `Duplicate` — a whole new loop, derived from this one

Behaviour is unchanged: deep clone, inserted immediately after the original, activated when the
original was active. Only the **label rule** changes.

**Duplicate increments the label the card is displaying, in the field it came from.** That is the
whole rule, and the two fields make it two cases:

| source | clone |
| --- | --- |
| `name: 'Drop'` | `name: 'Drop 2'`, `tempName` copied unchanged |
| `name: 'Drop 2'` | `name: 'Drop 3'` (or `Drop 4` when `Drop 3` is taken) |
| `name: ''`, `tempName: 'Synthwave 80s'` | `name: ''`, `tempName: 'Synthwave 80s 2'` |
| `name: ''`, `tempName: 'untitled-3'` | `name: ''`, `tempName: 'untitled-4'` (or the lowest free) |

**The trap this exists to avoid:** copying `tempName` verbatim would put two cards reading
`Synthwave 80s` side by side with nothing to tell them apart — which is the old `Loop 5` problem
wearing a nicer word. And promoting the displayed label into `name` on the clone would be worse
still: the copy would stop tracking vibe applications while its original kept tracking them, so
two loops that started identical would diverge in behaviour for a reason the user never chose.

The **stem-and-lowest-free-integer** rule itself is unchanged — strip a trailing ` N` to get the
stem, take the lowest free integer `>= 2` for that stem, and never produce a label already in
`loops`. Only *which field it is applied to* is new. "Lowest free" rather than "one above the
highest" because the numbers belong to a stem, not to the project, and a gap in `Drop 2, Drop 4`
is a slot a copy should fill. Collision is checked against the **displayed** label of every
existing loop, since that is what the user is looking at; the property the test asserts is that
no two cards can read the same thing, not the arithmetic that gets there.

**`addLoop` never inherits a label.** The Add Loop button gets `name: ''` and a fresh
`tempName: untitled-{next}` from the max-plus-one scan, even though it clones the active loop's
content. Add is a fresh slot; Duplicate is a derived one; the labels should say which, and a user
who wanted the derived one had a button for it. Sharing one namer between the two would erase the
distinction the change exists to create.

### `Copy into…` — parts of another loop, into this one

A new dialog, opened from the **target** card. Pick a source loop, tick which parts to take,
Apply overwrites those parts of the target.

**Pull, not push, and the reason is where the user is standing.** The moment this gesture is
wanted is while working on the loop that needs fixing — "this verse needs the chorus's bass
sound" — so the loop in view is the destination. Pull is also the low-risk direction: a
misclick damages exactly the one loop you are looking at, whereas a push dialog can scatter an
overwrite across loops that are not on screen.

A future "apply to several targets at once" row fits this same dialog as an extra selector, and
is deliberately **not** in scope (see Out of scope).

## What is copyable

**Twelve groups: a five-track × two-aspect matrix, plus two loop-wide groups.** The tracks are
the same five `LoopMixPatch` names the app uses everywhere (`lead`, `chord`, `bass`, `pad`,
`drums`); the two aspects are the Sound/Pattern boundary the navigation already draws —
*changes the sound but not the notes* versus *changes the notes or the rhythm*.

| group | track · aspect | keys |
| --- | --- | --- |
| `lead-sound` | Lead · Sound | `synthParams` |
| `lead-pattern` | Lead · Pattern | `leadMelodySteps`, `leadLoopLength`, `leadStepResolution`, `leadMelodyView`, `leadMelodyOctave`, `leadGate` |
| `chord-sound` | Chords · Sound | `chordSynthParams` |
| `chord-pattern` | Chords · Pattern | `chords`, `chordRhythmId`, `chordRhythmMode`, `customChordRhythm`, `chordFeel`, `chordOctave` |
| `bass-sound` | Bass · Sound | `bassSynthParams` |
| `bass-pattern` | Bass · Pattern | `bassPatternId`, `bassPatternMode`, `customBassPattern`, `bassFeel`, `bassOctave` |
| `pad-sound` | Pad · Sound | `padSynthParams` |
| `pad-pattern` | Pad · Pattern | `padMode`, `padOctave`, `padVoicing`, `padDroneDegree`, `padDroneIntervals` |
| `drums-sound` | Drums · Sound | `soundKit`, `drumFilterCutoff`, `drumFilterResonance`, `drumFilterType` |
| `drums-pattern` | Drums · Pattern | `sequencerTracks` |
| `key` | loop-wide | `scaleRoot`, `scaleType` |
| `mix` | loop-wide | the ten fields of `LoopMixPatch`: `synthVolume`, `synthMuted`, `chordVolume`, `chordMuted`, `bassVolume`, `bassMuted`, `padVolume`, `padMuted`, `masterSequencerVolume`, `drumMuted` |

That partition was checked against `LOOP_FLAT_KEYS` in `store/loop.ts`: every flat key appears
in exactly one group, and no group names a key the list does not have. Note that a `Loop`
reaches its pad fields through `PadState`, so `padVolume`/`padMuted` arrive by a different
inheritance path than the other eight mixer fields — they still belong to `mix`, because the
group is the mixer strip a user sees, not the interface a field is declared in.

**`repeatCount` is deliberately not copyable.** It is arrangement data — how many times this
loop plays in the song — not loop content, which is exactly why `LoopStatePatch`
(`Omit<Loop, 'id' | 'name' | 'repeatCount'>`) already omits it. Copying it would mean a gesture
labelled "take the drums from the chorus" could silently change how long this loop occupies the
arrangement. It is one click to change on the card.

`id`, `name` and `tempName` are excluded for the same structural reason: they identify the loop
being copied *into*, and overwriting them would make the gesture a replace rather than a copy.

**A copy never changes a loop's label — neither field, in either direction.** Take the drums from
the chorus and the verse is still called the verse; take *everything* and it is still called the
verse, because the user pointed at the verse and asked for it to change, not to become something
else. `tempName` in particular is not touched even though a copy can move far more of the loop's
sound than a vibe does: `tempName` records what this loop was *started from*, and a copy does not
restart a loop, it edits one. Structurally this costs nothing to honour — neither label is in
`LOOP_FLAT_KEYS`, so neither is in `LoopStatePatch`, so no group could name one even by accident,
and the coverage invariant below never has to reason about labels at all.

## The coverage invariant

**A test asserts that the union of every group's keys `toEqual`s the set of `LOOP_FLAT_KEYS`.**
Both directions matter: no flat key may be uncovered, and no key may appear in two groups.

This is the same discipline as the exhaustive `toEqual` guard on `DRUM_ALIASES`, and for the
same reason. A subset check ("every group key is a real flat key") would pass forever while the
feature quietly rotted: someone adds a field to `Loop`, adds it to `LOOP_FLAT_KEYS` so it
persists and syncs, and never adds it to a group — producing a field that is saved, loaded,
mirrored, and permanently impossible to copy, with nothing red. With the equality assertion, the
suite goes red at the moment the field lands and stays red until someone decides which group
owns it. The decision is cheap; noticing that it was never made is not.

Duplication across groups is caught by the same assertion, since a key counted twice makes the
union a multiset the equality rejects — build the union as a `Set` and compare sizes, or collect
into an array and assert no duplicates before the `toEqual`. A key in two groups would mean two
checkboxes silently fighting over one field.

## Content traps

Two places where copying a group alone produces a target that contradicts itself. Both are
handled in the dialog, not by widening a group — the groups stay a clean partition, and the
coupling lives where the user can see and override it.

### Chords imply Key

`chords` holds already-derived, `ROOTS`-spelled note content. `scaleRoot`/`scaleType` is the
metadata everything else reads: what the card's key badge renders, what generation and the
scale-locked lead grid resolve against.

Copy `chord-pattern` into a loop in a different key and the target displays its old key over
another key's chords. The badge lies, and every subsequent generated part is built against a
key that no longer describes what is sounding.

**Rule:** ticking `chord-pattern` auto-ticks `key` **only when the two loops' keys actually
differ**, with a short reason shown beside it. The user may untick it deliberately — copying a
progression into a different key on purpose is a real musical move (it is what a chord library
paste does), so this is a default, not a lock. When the keys already match, nothing is
auto-ticked and nothing is said: a notice that fires every time is a notice nobody reads.

### Chords change the loop's length

`loopBars(chords)` sums each chord's `bars` and *is* the loop's length in the arrangement — the
Arrange card's bar badge, the per-card cycle length, and the total the song advance divides by
all come from it. So copying a chord progression stretches or shrinks this loop inside the song.

**Rule:** when `loopBars(source.chords) !== loopBars(target.chords)` and `chord-pattern` is
ticked, the dialog states the consequence in the concrete ("This loop becomes 8 bars, was 4").
When the lengths match, it says nothing. Same principle as above: the notice earns its place by
being conditional.

## Architecture

Three pieces, on the layer each one belongs to: a pure module with the rules, one store action
with the write, one dumb view.

### `src/store/loopCopy.ts` — pure, no React, no audio

- **`LOOP_COPY_GROUPS`** — the table above as data. Each entry is
  `{ id, track, aspect, label, keys }`, where `keys` is a readonly tuple of `LoopStatePatch`
  keys. `track` is `'lead' | 'chord' | 'bass' | 'pad' | 'drums' | 'loop'` and `aspect` is
  `'sound' | 'pattern' | 'whole'`; the two loop-wide groups are the `'loop'`/`'whole'` pair, so
  the dialog can lay the matrix out from the table and render the rest as loop-wide rows,
  instead of hard-coding a second list beside it. **The table is the only place the grouping is
  written** — the dialog, the patch builder and the coverage test all read it.
- **`buildLoopCopyPatch(source, selectedGroupIds)`** → `Partial<LoopStatePatch>` holding exactly
  the selected groups' keys and nothing else. **Values are deep-cloned.** A copied
  `sequencerTracks`, `leadMelodySteps`, `chords`, `customChordRhythm`, `customBassPattern` or
  `padDroneIntervals` must never share mutable substructure with the source loop — the same
  reason `cloneLoop` exists, and the same failure it prevents: a later edit to one loop's grid
  silently rewriting the other's. `structuredClone` on the assembled patch is enough and matches
  what the rest of the loop code already does.
- **`impliesKeyCopy(source, target, selected)`** — the Chords-implies-Key rule as a predicate,
  so the coupling is testable without a DOM.

These are pure functions because every interesting rule here (coverage, cloning, the implication)
is a statement about values. Testing them through a rendered dialog would test the checkbox
wiring and call it a test of the rules.

### `applyLoopCopy(targetId, sourceId, selected)` on the loop slice

Two branches, mirroring the shape `setLoopMix` already uses — this is not a new idiom, it is the
existing one applied to a bigger patch.

The action belongs to `LoopSlice`, but its body cannot live in `loopSlice.ts`: the active branch
calls `loadLoop`, and `loadLoop.ts` imports `store.ts`, which calls `createLoopSlice()` at module
scope. That cycle makes the app's boot depend on which file is entered first, and it fails in the
temporal dead zone of `loopSlice.ts`'s own module-level constants — reordering imports to dodge it
would leave correctness resting on import order. It therefore ships as its own `loopCopySlice.ts`,
holding a hoisted function and no module-level constant, composed into the store beside
`createLoopSlice`. The store's public surface is unchanged; only the file the body sits in moved.

- **Target is not the active loop.** `set({ loops })` with the patch merged into that loop and
  nothing else. No flat-slice write, no engine contact, nothing audible. A non-active loop is
  edited for later use, exactly as `setLoopMix` treats it.
- **Target is the active loop.** Write `loops[]`, then call `loadLoop(targetId)`.

The active branch **adds no new audio code**. `loadLoop` is already the protocol for rewriting
the content of the loop that is sounding: capture the active players → `hardStopAll` → cut the
queued accompaniment voices → write the flat slices from the loop → `commitRestartAfterStop`,
which already owns the Loop-layer/Song-layer restart rule and the scope it leaves behind. It is
the same protocol `applyVibeToStore` runs on every vibe swap, and reimplementing any part of it
here would create a second place that has to stay correct.

Order matters: the `loops[]` write must land **before** `loadLoop`, because `loadLoop` reads the
loop out of the store and copies it into the flat slices. Writing the array afterwards would
load the pre-copy content and then mirror it back over the patch.

Calling `loadLoop` with the id that is already active is intended, not a degenerate case: the
id has not moved, the *content behind it* has, and the default path — the one that stops, cuts
and restarts — is exactly the protocol for that. There is no early return on an unchanged id to
work around.

One subtlety about the mirror: `loopMirrorPartial` (in `loopSync.ts`) returns `null` for a
partial that carries `loops` alone with no per-loop flat key, so the non-active branch writes
the array untouched — the mirror never reaches in and overwrites the edited loop with the active
loop's flat state. The active branch's `loadLoop` moves no `activeLoopId` (target is already
active) but writes the full `loopStatePatch` through `useAppStore.setState`, which is outside the
mirroring `set` by construction, so the two paths converge on `loops[]` and the flat slices
agreeing.

### The accepted restart, stated as a decision

**Copying only a SOUND into the loop that is currently playing still stops and restarts on the
next bar line.** `engineSync`'s per-value subscriptions could have absorbed a `synthParams`
change with no transport transition at all — a patch swap is exactly what they exist for.

This is accepted, not overlooked. A second, faster path would need its own always-correct rule
for which selections may skip the restart, and that rule is not "sound groups are safe": `mix`
is absorbable too, `key` is not, `drums-sound` includes a kit id the sequencer reads at trigger
time, and the set of safe keys would have to be re-derived every time a field joins `Loop` —
a rule with no test that can force it to stay honest. One path is provably correct today, and an
Instant Vibe swap already restarts this way, so the behaviour is familiar rather than surprising.

If it proves annoying in use, a fast path can be added later behind its own test — driven from
`LOOP_COPY_GROUPS` with an explicit per-group `absorbable` flag, so the rule lives next to the
grouping it depends on and the coverage invariant keeps it complete.

### Persist and `dirty` need no work

`loops` is already in `partialize` and in `PROJECT_CONTENT_KEYS`, so the write persists through
the coalesced storage path and the idle dirty pass fingerprints it. No persist `version` move, no
`.solna` `formatVersion` move, and **no sanitize work for the copy action**: every value it writes
was already legal in the source loop, so a patch cannot produce a shape sanitize has not already
accepted once. (The label fields do add a `sanitizeLoops` clause — see Persistence above — but
that is the new `tempName` key, not this action.)

## UI

### The card button

One new button beside `Duplicate` in the card's action row, `id="btn-loop-copy-into-<loopId>"`,
following the row's existing id convention (`btn-loop-edit-`, `btn-loop-duplicate-`,
`btn-loop-delete-`). **Disabled when the project holds only one loop** — there is no source to
copy from — the same shape as the existing `disabled={totalLoops <= 1}` on Delete.

`Duplicate` stays exactly where it is, with its own icon and title. The two gestures must read
as different at a glance: one makes a new loop, the other changes this one.

### `src/components/song/LoopCopyDialog.tsx`

A **new file**, built on the shared `ui/Modal` at `size="lg"`. New rather than more of
`SortableLoopCard` because that card is already the largest component in the view, and a
twelve-checkbox form with two conditional notices is not card chrome.

**Rendered once from `ArrangeView`**, which holds `copyTargetId: string | null` and passes the
target loop down — *not* one dialog per card. Every card is mounted simultaneously inside the
`SortableContext`, so a per-card dialog would mount a full form per loop and re-render all of
them on every tick of the arrange playhead. The card gains exactly one new prop for this gesture,
`onCopyInto(id)` — its disabled state comes from `totalLoops`, which it already receives — and
the dialog's entire state lives in the dialog. (It gains a second new prop from the label change,
`label`, resolved by `ArrangeView` through `loopLabel`; that one is not about this dialog.)

Selection state is local to the dialog and resets each time it opens. It is transient UI, so it
belongs nowhere near a slice — and certainly not in a persisted one.

```
┌─ Copy into "Verse" ───────────────────────────────────────── ✕ ─┐
│                                                                  │
│  From  [ Chorus — C Major · 8 bars            ▾ ]                │
│                                                                  │
│  [ All sounds ]  [ All patterns ]  [ Everything ]                │
│                                                                  │
│  ▾ Details — Lead sound, Chords pattern, Key   (shown expanded)  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Sound            Pattern                     │   │
│  │  Lead        [x]              [ ]                         │   │
│  │  Chords      [ ]              [x]                         │   │
│  │  Bass        [ ]              [ ]                         │   │
│  │  Pad         [ ]              [ ]                         │   │
│  │  Drums       [ ]              [ ]                         │   │
│  │  ────────────────────────────────────────────────────     │   │
│  │  Key / Scale [x]   added: source is in C Major, this      │   │
│  │                    loop is in A Minor                     │   │
│  │  Mix         [ ]                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ⓘ This loop becomes 8 bars, was 4.                              │
│                                                                  │
│                                    [ Cancel ]  [ Apply ]         │
└──────────────────────────────────────────────────────────────────┘
```

- **From** lists every loop except the target, each option showing the candidate's key and bar
  count — the two facts that decide whether the copy will surprise you, visible before the pick
  rather than after. The option's label, and the dialog's own title, come from `loopLabel`, so an
  unnamed loop reads as `Synthwave 80s — C Major · 8 bars` rather than as a blank followed by two
  facts about nothing.
- **Quick chips** — `All sounds`, `All patterns`, `Everything` — **tick the matrix**; they are
  not a separate mode. Quick and detailed are one selection state with two ways in, so a chip
  can be followed by a manual untick with no mode to leave. `All sounds` ticks the five Sound
  cells; `All patterns` ticks the five Pattern cells; `Everything` ticks all twelve. The
  Chords-implies-Key rule applies to a chip exactly as it applies to a manual tick.
- **Details** is collapsed by default, and **its summary line always states what is currently
  ticked**, so a quick chip is never a black box — the collapsed state still tells you what
  Apply will do.
- **The two notices** appear only when they apply, per the rules above.
- **Apply is disabled while nothing is ticked.** Cancel closes with no write.

**No confirmation dialog on top.** The dialog and its Apply button *are* the confirmation;
stacking a `ConfirmDialog` on a dialog the user just filled in adds a click and no information.
`ConfirmDialog` stays where it belongs, on Delete, which is the one destructive action reachable
in a single click.

**No toast.** This app has no central toast system — the vibes bar's is its own local thing —
and the result is visible immediately on the card that was the target: bar badge, key badge,
chord strip, and the mixer strip if `mix` was taken. A confirmation of something already on
screen is noise.

**The dialog is a dumb view.** It may not import `audio/engine`, and it reaches no state on its
own: `loops`, the resolved labels and the callbacks all arrive as props from `ArrangeView`, which
already holds every one of them. Reading the store directly would also put the dialog out of test
reach — zustand wires `getServerSnapshot` to the store's creation-time state, so a
`renderToString` test could never set up the loops it needs to assert on. Whether the copy restarts playback is the store
action's business, decided by `loadLoop`.

## Out of scope

Named so a later reader knows these were considered and declined, not missed:

- **Pushing to several loops at once.** The dialog's shape admits it later (a target multi-select
  beside the source picker); the pull-direction rationale above is what makes the single-target
  version safe to ship first.
- **A session clipboard** — copy now, paste later, into several places. That is a different
  interaction model with its own state and its own staleness question (what does a clipboard mean
  after the source loop is edited or deleted?), and it is not needed to make the gesture useful.
- **Undo.** The app has no undo stack; adding one for this action alone would be an undo that
  works in exactly one place, which is worse than none.
- **Copying `repeatCount`.** See above — arrangement data, not loop content.
- **Any change to how `duplicateLoop` clones or where it inserts.** Only its labelling changes.
- **Moving `selectedVibeId` per-loop.** It stays a single global; `loadLoop` clearing it is the
  whole fix, for the reason given above — under this model the id is a fact about the last chip
  pressed, not a property of a loop.
- **Any change to which fields a vibe writes.** `applyVibeToStore` gains exactly one call, for
  `tempName`. Its content behaviour, its ordering constraints and its transport transition are
  untouched.
- **A loop's vibe history beyond the single most recent name.** `tempName` holds one string. A
  list of every vibe ever applied is a different feature with its own staleness and its own UI,
  and nothing on the card has room to render it.

## Testing

`bun run verify` is the completion gate.

**`src/store/loopCopy.test.ts`**
- The coverage invariant: the union of every group's `keys` `toEqual`s the set of
  `LOOP_FLAT_KEYS`, with no key in two groups.
- `buildLoopCopyPatch` returns exactly the selected groups' keys — nothing extra, and nothing
  missing — for a single group, for several, and for the empty selection (an empty patch).
- Deep-clone proof: after a copy, mutating the source's `sequencerTracks` and `leadMelodySteps`
  in place leaves the built patch unchanged. Assert on nested content, not on reference identity
  alone — a shallow copy passes a `!==` check on the array and still shares every element.
- The Chords-implies-Key rule both ways: keys equal → not implied; keys differ → implied.

**`src/store/loopSlice.test.ts`** (or a sibling)
- Non-active target: `loops` carries the patch and **every flat per-loop field is untouched** —
  the branch's whole point is that editing a loop you are not on makes no sound.
- Active target: after the call, the flat slices and the target's entry in `loops[]` agree on
  every copied key.
- The order property: the copied content survives the `loadLoop` round trip rather than being
  overwritten by the pre-copy loop.

**`src/store/loop.test.ts`** — labels
- `loopLabel` resolution: a user `name` wins; a blank `name` falls through to `tempName`. Assert
  the blank case explicitly — it is the one the old code could not represent.
- The untitled counter: max-plus-one over existing `tempName`s, and its behaviour **with gaps** —
  with `untitled-2` and `untitled-7` present the next is `untitled-8`, not `untitled-3`. That is
  the stored-not-positional trade asserted rather than described.
- The duplicate rule in **both** fields: a named `Drop` yields `name: 'Drop 2'` with `name` the
  only field that moved; an unnamed loop showing `Synthwave 80s` yields `tempName: 'Synthwave
  80s 2'` with `name` still `''`. The second case is the whole point of the rule and must not be
  left to the first case's coverage.
- Collision avoidance: with `Drop 2` already present, duplicating `Drop` never yields `Drop 2`;
  no two loops resolve to the same `loopLabel`, whatever the arithmetic produced.
- `addLoop` yields `name: ''` and a fresh `untitled-{n}` — never the source's label, which is the
  regression the shared-namer shortcut would cause.

**`src/store/sanitize.test.ts`**
- A loop payload with no `tempName` reads back with `untitled-{index + 1}`; so does one with
  `tempName: ''`. This is what the display resolver's single `||` rests on.
- A loop payload with no `name` reads back with `name: ''`, not `Loop N` — the old fallback is
  gone and a test should notice if it comes back.

**`src/store/vibes.test.ts`**
- `applyVibeToStore` writes the vibe's display name into the **active** loop's `tempName`, and
  into no other loop's.
- It writes it even when that loop already has a user `name`, and the displayed label is unchanged
  by that write — the invisible-tracking rule, which is otherwise only observable later.

**`src/components/song/SortableLoopCard.test.tsx`** (or the existing card test)
- The rename path accepts an empty string: saving a blank input calls `onRename` with `''` rather
  than discarding it, and the card then renders `tempName`.
- The input opens empty with the displayed label as `placeholder`, not as `value` — the
  silent-promotion trap.

**`src/store/loadLoop.test.ts`**
- `loadLoop` clears `selectedVibeId` to `null`, on both the boundary path and the hard-stop path.

**`src/components/song/LoopCopyDialog.test.tsx`**
- Apply is disabled with nothing ticked.
- A quick chip ticks the right column and nothing else.
- The source list excludes the target loop.

**The renderToString trap applies here.** Roughly a third of this suite renders through
`renderToString`, and zustand wires `getServerSnapshot` to the store's **creation-time** state —
so `useAppStore.setState(...)` before rendering the dialog has no effect unless the component
reads the store the way `ui/BottomInputDock.tsx` does. Whoever writes the dialog test should
either follow that pattern or feed the loops in as props rather than expecting a pre-render
`setState` to be visible. Full conventions are in `.claude/rules/testing.md`.

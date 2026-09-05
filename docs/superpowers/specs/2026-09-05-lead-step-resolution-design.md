# Adjustable Lead Step Resolution (DEV-375) — Design

Date: 2026-09-05
Status: Approved (brainstormed and signed off before writing)
Linear: [DEV-375 — adjustable lead step resolution](https://linear.app/pathompong-thitithan/issue/DEV-375)

## Context

The melody grid has exactly one cell size. A column is a 16th note, because the shared clock
counts 16ths and `useLeadPlayback` treats `step % melodyLength` as a grid column directly. That
is fine for a riff and useless for a run: there is no way to place two notes inside one 16th, and
no way to draw a slow line without counting four cells for every note you actually want.

Two pieces of groundwork were laid for this on purpose and both pay off here. DEV-374 chose to
*measure* the step duration from clock anchors rather than compute it from bpm, and named the
clock-step-to-grid-column conversion (`clockStepToGridColumn`) even though it was the identity at
the time. Its spec says why in as many words: so that this work would not have to redo the
recorder. It does not. DEV-377 made one marker serve as both the playhead and the recorder's
write head, and pinned the marker's `translateX` to `LEAD_CELL_WIDTH` — which is the constraint
that decides the UI question below.

What this adds is a second axis to a scheme the repo already runs. Meter stores every bar at the
widest bar in the table (`MAX_STEPS_PER_BAR = 24`) and *windows* it to the active `stepsPerBar`,
so switching meter is non-destructive. Resolution does the same thing one dimension over: store
at the finest, and *stride* to the active. No new concept enters the codebase except stride.

## Scope: 1/8, 1/16, 1/32 — no triplets

Three straight subdivisions, selectable per loop. `'1/16'` remains the default and is what every
existing project is already authored at, so nothing that exists today changes when this ships.

Triplets are excluded, and not for lack of interest. Supporting both binary and ternary
subdivision means storing at LCM(2, 3) — 12 slots per 16th, 144 per bar, six times today's width
— and the payoff is a grid that *reads* differently, with cell boundaries that do not line up
with the bar's beat groupings and a ruler that has to draw two rulers. That is its own feature
with its own UI question, and it gets its own issue if it is ever wanted. Bolting it onto this
one would triple the storage cost of a feature most projects would never use.

## Storage: a stride over fixed fine storage

**The melody is stored at 1/32, always.** Two new constants, both lead-only:

```
TICKS_PER_SIXTEENTH = 2
LEAD_TICKS_PER_BAR  = MAX_STEPS_PER_BAR * TICKS_PER_SIXTEENTH   // 48
```

Resolution is a stride over those ticks: 1/8 → 4, 1/16 → 2, 1/32 → 1. A stored bar is 48 slots
wide whatever the resolution; changing resolution changes which of them the grid and the
scheduler can reach, and nothing else.

The alternative — reshape the stored array on every resolution change — was rejected for the
reason meter already settled: a destructive reshape means going 1/32 → 1/8 → 1/32 loses the
notes that were between the coarse columns, silently, with no undo. Windowing is the scheme this
codebase already teaches, and a user who has met a dormant meter slot has already met the rule.

**The sequencer, chord-rhythm and bass grids keep `MAX_STEPS_PER_BAR = 24` untouched.** They are
not part of this issue and they do not share the melody's storage. `customChordRhythm`,
`customBassPattern` and every `sequencerTracks[].steps` row stay 24 wide.

## Three coordinate spaces, and which code lives in which

The whole feature is one bookkeeping problem, so name the spaces once and use the names
everywhere:

- **Column** — what the user sees, clicks, arrows across and drags. What the recorder writes at,
  what `leadCursor` holds, what the marker points at, what `LEAD_CELL_WIDTH` sizes. Column count
  per bar is `columnsPerBar = stepsPerBar * TICKS_PER_SIXTEENTH / stride`.
- **Tick** — a 1/32 of a bar's grid. What `len` counts, what the scheduler ranges over per clock
  dispatch, and the unit both dormancy tests are expressed in.
- **Stored index** — bar-major at `LEAD_TICKS_PER_BAR`: `bar * 48 + tickInBar`. What
  `localStorage` and a `.solna` body hold, and the only space that never depends on meter or
  resolution.

`leadStoredIndexAt` converts column → stored index (it needs both `stepsPerBar` and `stride`);
`leadActivePosAt` converts stored index → column, or -1. Components and the store speak columns.
`audio/leadMelody.ts` is where the tick arithmetic lives. Storage is spoken by nothing except
those two functions, `resizeLeadMelody`, `copyLeadBar` / `pasteLeadBar` and the two migrations.

One consequence worth stating because it is a trap in the existing code:
`components/loop/lead/melodyGrid.ts` exports its own `leadStoredIndex(barIndex, stepInBar)`, a
second copy of the same arithmetic that survives today only because it does not depend on meter.
Under a stride it does. That copy must be deleted and its call sites routed through the audio-layer
function; two independent copies of a conversion that now takes a third argument is exactly the
"three scattered pieces of arithmetic that each look correct in isolation" DEV-374 named.

## Every meter divides cleanly at every resolution

This has to be true or the feature has a hole in it, so state the table and pin it with a test.
Active ticks per bar is `stepsPerBar * 2`:

| Meter | `stepsPerBar` | ticks/bar | cols @ 1/8 | cols @ 1/16 | cols @ 1/32 |
|-------|---------------|-----------|------------|-------------|-------------|
| 4/4   | 16            | 32        | 8          | 16          | 32          |
| 3/4   | 12            | 24        | 6          | 12          | 24          |
| 6/8   | 12            | 24        | 6          | 12          | 24          |
| 12/8  | 24            | 48        | 12         | 24          | 48          |
| 5/4   | 20            | 40        | 10         | 20          | 40          |
| 7/8   | 14            | 28        | 7          | 14          | 28          |

Every row is divisible by 4, 2 and 1, so `columnsPerBar` is a whole number in all eighteen
combinations and no bar ever ends mid-column. **7/8 is the row to call out**: 28 ticks gives 7
columns at 1/8, and 7/8 is precisely the meter whose bar length is not a multiple of 4, which is
why `arpStepFor` and `ARP_PHASE_QUANTUM` exist at all. It works here for a different reason —
divisibility runs the other way, ticks by stride, not bar by subdivision — and that difference is
easy to lose. The divisibility matrix must be pinned by a test in the same spirit as
`meter.test.ts` pinning `accentGroups` summing to `stepsPerBar`: it is an invariant of the meter
table, not a property of any one call site, and a seventh meter added later must fail loudly here
rather than quietly draw a broken bar.

`LEAD_TICKS_PER_BAR = 48` also covers 12/8's full 24 steps at 1/32, so no meter loses columns to
the storage width.

## `leadActivePosAt` knows both kinds of dormancy

Today a stored slot is dormant when the active meter cannot reach it. Now there are two ways, and
**both live in `leadActivePosAt` and nowhere else**:

```
tickInBar >= stepsPerBar * TICKS_PER_SIXTEENTH   →  outside the bar   (meter — existing)
tickInBar % stride !== 0                         →  off the grid      (resolution — new)
```

Both return -1, which every existing caller already handles: `paintLeadNote` falls back to the
slot's own contents, `setLeadNoteLength` refuses, `pasteLeadBar` skips. The scheduler reads
through columns only, so **an off-grid note is silent with no branch added anywhere else** — it
is simply never visited.

Silent-and-preserved was chosen over the DAW convention, where a snap grid changes what you can
*place* but never mutes what is already there. The reason is that in a DAW the piano roll is one
of several editors and a note off the snap grid is still visible, selectable and draggable. Here
the melody grid is the *only* editor: there is no note list, no event view, no way to reach a
slot the grid does not draw. A note that sounds but cannot be seen or deleted is a trap, and it
is the same trap `leadSoundingNotes` would otherwise create at 1/8 for a note drawn at 1/32. The
meter precedent already teaches the user the rule in the shape they will meet here: an
unreachable slot is quiet, not gone, and it comes back when you widen the window again.

**`resizeLeadMelody` has its own inline copy of the dormancy test** (`offset >= stepsPerBar`) and
must be updated in lockstep, or a loop-length change would clamp the `len` of off-grid notes
against a fictitious position — silently rewriting length data that a finer resolution still
needs. That is the same defect the existing comment in that function was written for.

## `len` counts ticks

**A note's length is a number of ticks, not a number of cells.** A quarter note is 8 ticks at
every resolution; changing resolution changes only how many cells it spans (2 at 1/8, 4 at 1/16,
8 at 1/32) and never how long it sounds.

Contrast this with meter, where `len` never had to change meaning: a meter change alters how many
16ths are in a bar but not how long a 16th is, so a length counted in active steps stayed honest.
A resolution change *does* alter the duration of a cell, so a length counted in cells would make
every note in the loop four times shorter the moment you switched from 1/8 to 1/32. Ticks are the
only unit that survives the switch.

`setLeadNoteLength` keeps all three invariants, restated in ticks:

1. Same-row overlap swallows the covered note, forward only from this note's start.
2. `start + len <= loopLength * ticksPerBar`, where `ticksPerBar = stepsPerBar * TICKS_PER_SIXTEENTH`.
3. `len` is an integer ≥ 1 tick.

**The editor writes whole cells** — every length the drag handle and the recorder produce is a
multiple of `stride`, with a floor of one cell. Sub-cell lengths are representable in storage (a
1/32-authored note read at 1/8) but never *created* at the current resolution, so the grid never
draws a note whose end lands inside a cell.

`resolveLeadStepTriggers` therefore works in ticks: `tickDur = stepDurationSec(bpm) / TICKS_PER_SIXTEENTH`,
and the gate still trims the tail of the note's final **cell**, not its final tick:

```
cells   = Math.max(1, Math.ceil(len / stride))
holdSec = (cells - 1 + gate) * stride * tickDur
```

At the default 1/16 (`stride = 2`) a one-cell note gives `gate * 2 * tickDur`, which is exactly
today's `(1 - 1 + gate) * stepDurSec` — so existing projects sound byte-identical, which is the
same bar `DEFAULT_LEAD_GATE` was chosen to clear. Writing it as `(len - 1 + gate) * tickDur`
instead would quietly make the gate four times less audible at 1/8. The `ceil` and the floor of
one cell are what keep a note authored *finer* than the current resolution audible: a one-tick
note read at 1/16 sounds for one cell rather than for a negative duration.

`leadSoundingNotes` scans backward by column but must carry **`age` in ticks**
(`age = columnsBack * stride`), so the `n.len > age` test and `leadAudibleLen`'s
`melodyLength - startPos` clamp keep working verbatim against tick-counted lengths.

## A resolution change never rewrites a length

The rounding in `cells` is a **read-time** decision. Storage keeps the note's true tick length,
and changing resolution writes nothing to the melody.

The alternative — snap every `len` to a whole number of cells at the moment of the switch — was
rejected, and not on taste. It ratchets: a 5-tick note becomes 6 at 1/16, then 8 at 1/8, and
returning to 1/32 gives back 8 rather than 5. Flipping the control three times lengthens music
nobody asked to lengthen, and the loss is unrecoverable because the original is gone. It would
also be the first view change in the lead that mutates stored data, against the invariant
`leadSlice.test.ts` already pins for meter — a meter change never touches the stored melody.

The rule this settles holds for the whole grid: **an explicit edit writes; a change of view never
does.** Dragging a note to three cells at 1/8 writes `len = 12` and discards the 5 — correct,
because the user asked for it. Switching resolution to look at the same music discards nothing.

Non-destructive is also the cheaper build. `cells` already exists for `holdSec` and is the same
number the grid draws the note's width with, so the read path costs nothing extra. The destructive
path would need a whole-melody transform on every switch (the shape of `resizeLeadMelody`), a
round-versus-floor decision, a re-clamp against the loop end after rounding, its own tests, and a
confirmation prompt for a select that would otherwise destroy work silently.

**What sounds is what is drawn.** `holdSec` uses the rounded `cells`, never the raw tick length: a
note that showed as two cells but sounded for five ticks would reintroduce exactly the invisible
state that silent dormancy was chosen to avoid, so the two roundings must stay the same
expression. The rounding cannot overrun the loop end — `startPos` is always on-grid and
`ticksPerBar` divides by `stride` for every meter, so `melodyLength - startPos` is a whole number
of cells and `ceil` cannot reach past it.

## The shared clock is not touched

The clock still counts 16ths, monotonically, for the sequencer, chords, bass, arp and metronome.
Nothing about `subscribePlaybackClock`, `arpStepFor` or the metronome changes.

On each dispatch the lead callback owns the tick range `[step * TICKS_PER_SIXTEENTH, step * TICKS_PER_SIXTEENTH + TICKS_PER_SIXTEENTH)`
— two ticks — and fires every *on-grid* tick in that range at offset
`(t - step * TICKS_PER_SIXTEENTH) * tickDur`. One loop, one formula, no special case per stride,
because an even stride can never land on an odd tick: at 1/8 and 1/16 only `t = step * 2` is ever
on-grid, and only 1/32 ever produces two columns from one dispatch.

The marker uses the same loop: one `publishStepAt` call per fired column, each with its own
audible time (`time + (t - step * 2) * tickDur`). DEV-376's deferred publish is preserved
unchanged and needs no modification — it already takes an audible time per call, which is exactly
what makes two publishes in one dispatch land at two different moments rather than both jumping
at once.

## One clock, and the question each consumer answers

**There is one clock and everything runs on it; what differs is the question each consumer asks
of it.** The melody grid answers *which pitches are held right now* — resolution changes that
answer, moving where a note starts and how long it lasts, and it changes nothing else. The
arpeggiator answers *when to strike them, and in what order* — and that comes from `arpRate` in
`synthParams`, a property of the voice, whose `stepMod` is counted in clock 16ths. Two questions,
two rates, one clock.

**They are already separate in the code, which is the point:** this is a clarification of the
architecture that exists, not a new decision. The evidence is in three places.

- The arp branch of `resolveLeadStepTriggers` does `sounding.map((s) => s.note)`. It reads
  *presence* only and never reads `len` for a duration.
- `computeArpTriggers` builds its own `holdSec` out of the rate config, which is exactly why
  `leadMelody.ts` already records "the gate has no effect while the arp is on".
- `computeArpTriggers` already subdivides the 16th itself for its 32nd rate (`cfg.notes === 2`
  → `stepDur16 / 2`), so it has never needed the grid to be fine.

**Therefore resolution must not change the arp's firing schedule.** Per clock dispatch:

- **arp off — column-driven.** Fire each on-grid tick's age-0 notes at offset
  `(t - step * TICKS_PER_SIXTEENTH) * tickDur`, exactly as above.
- **arp on — clock-driven.** Called once per dispatch, at the dispatch's own time, with
  `arpStep = arpStepFor(step, stepsPerBar)` unchanged and `sounding` read at the column that is
  *sounding* at the on-clock tick — the last column at or before `step * TICKS_PER_SIXTEENTH`,
  wrapped into the melody loop. That is `clockStepToGridColumn` and nothing else.

Reduce it and the three cases fall out. **At 1/16 both branches are today's behaviour exactly**,
which is the same bar every other read-path change here has to clear. **At 1/8 the arp still
fires on every 16th**, because the column sounding at the odd 16th is the 1/8 column that started
on the even one — the failure mode this avoids is the tempting gate on "does a column *start*
inside this dispatch", which at stride 4 finds an on-grid tick on only every other clock step and
so feeds the arp half as often merely because the grid got coarser. **At 1/32 the arp fires once
per dispatch instead of twice**, which is the doubling that same shortcut was reaching for and
the only reason it looked correct.

**The analogy has a limit and it stops at the conceptual.** Calling the grid an automated
instrument input is a way of seeing the split, not a routing claim: sequenced notes deliberately
do not pass through `noteInputBus` (`.claude/rules/note-input.md`), and nothing here changes
that.

One consequence falls out and is worth naming. Because the arp reads only presence, `len` in
ticks reaches it solely as "this note is still held" — which is the intended behaviour already
documented ("a long note under an arp visibly asks to keep feeding the arpeggio") — and the whole
`cells` / `holdSec` rounding stays confined to the block path.

## Live capture needs almost nothing

This is DEV-374's dividend, and it is worth being explicit about how little is left to do.

- **`measuredStepDurationSec` is unchanged.** It measures the 16th from clock anchors, and the
  clock still counts 16ths. Its own docblock predicted this ("a future adjustable step resolution
  follows for free"); the prediction holds because the thing it measures is the thing that did
  not change.
- **`quantiseInputStep` is unchanged.** It still returns a fractional-then-rounded clock step.
- **`clockStepToGridColumn` gains the stride and stops being the identity.** It converts a clock
  16th to a tick (`× TICKS_PER_SIXTEENTH`), then to a column (`/ stride`), then wraps against the
  loop's column count. This is the single named conversion DEV-374 created for exactly this
  moment, and it stays the only one — `useLeadPlayback`, `leadRecord.ts` and the marker all call
  it rather than each dividing by their own copy of the stride.

  At 1/32 a quantiser that rounds to the nearest 16th can only ever produce even columns. That is
  correct and deliberate: the clock is the only time reference there is, and a performance cannot
  be captured finer than the grid the anchors describe. Half of the 1/32 columns are reachable by
  drawing but not by recording, the same way a note played between two 16ths is captured on one
  of them today.
- **`heldStepLength` returns ticks**, with a floor of one cell (`stride`) rather than one tick, so
  a captured note is never shorter than the grid can draw. The loop-end truncation stays
  `setLeadNoteLength`'s job (invariant 2), as before.
- **`leadRecord.ts`'s `held` map keeps storing the raw, un-wrapped clock step** at note-on. That
  is what makes a note held across the loop seam yield a positive length, and the reasoning in
  that file survives verbatim — only the unit the length comes out in changes.

## Resolution is per-loop

A new `leadStepResolution` field on `Loop`, sitting beside `leadLoopLength`, added to
`LOOP_FLAT_KEYS` and mirrored in the flat store the way every other lead field is. Because
`LOOP_FLAT_KEYS` feeds `PROJECT_LOOP_KEYS`, the project fingerprint picks it up automatically —
and the test that pins that list will fail until the addition is acknowledged, which is the point
of that test. `loops` is already a project content key, so **no new top-level key and no change to
`PROJECT_CONTENT_KEYS`**.

The alternative was global, like `meterId`. It loses on two counts. A global flip would silence
off-grid notes in every loop at once, so refining one loop's melody would mute another loop the
user was not looking at — the blast radius of a meter change, for a decision that is not musical
in the way a meter is. And the data a resolution *reinterprets* is per-loop data: the melody
lives on the loop, so the lens onto it belongs there too.

Since the clipboard (`leadBarClipboard`) holds a bar at the full stored tick width, copying at one
resolution and pasting at another is well defined with no conversion: the clip carries ticks, and
the destination's resolution decides what is reachable. `copyLeadBar` widens from
`MAX_STEPS_PER_BAR` to `LEAD_TICKS_PER_BAR` slots and keeps copying the full stored width, for the
reason its docblock already gives.

## Where the table lives

A new leaf module, `src/utils/stepResolution.ts`, importing only `meter.ts`: the id union, the
label/stride table, the id list and default, an `isStepResolutionId` guard, a `getStride`
resolver with the same never-throw fallback discipline as `getMeter`, and `columnsPerBar`.

It is deliberately **not** added to `meter.ts`. That module's header states that the 16th-note
grid never changes and that meter is therefore a plumbing concern rather than a DSP one, and it
imports nothing at all so that all three layers may import it. Putting a lead-only subdivision
table inside it would make its own header false and would put lead concerns in a module the
sequencer and metronome depend on. Meter answers *how long is a bar*; this answers *how fine is a
lead cell*. One imports the other, in that direction only.

`stepResolution.ts` sits under `utils/` so `audio/`, `store/` and `components/` may all import it
under the eslint layering rules, exactly as `meter.ts` does.

## Migration is the bulk of the work

One pure transform, `upgradeLeadMelodyToTicks`, exported from `audio/leadMelody.ts` next to
`upgradeLeadMelodyV1`: each bar widens from `MAX_STEPS_PER_BAR` to `LEAD_TICKS_PER_BAR` slots,
stored slot `i` within a bar becomes tick `2i`, odd ticks are empty, and **every `len` doubles**
because it now counts ticks instead of 16ths. It is a no-op-safe transform on an
already-current payload.

It is called from **two separate functions**, and CLAUDE.md's rule applies verbatim: the persist
chain in `migrate` (which zustand runs *before* `merge`, and `merge` is where
`sanitizePersistedState` runs) and the `.solna` chain in `migrateProjectBody` (which
`projectFile.ts` runs *before* `sanitizeContent`). **These two chains must never be merged into
one.** A persist payload is private `localStorage` shape; a project body is an external contract;
their versions move for different reasons. The shared piece is the pure transform and only the
pure transform, the same arrangement `upgradeLeadMelodyV1` already has.

The trap, restated because it has already bitten once: **an un-upgraded payload that reaches the
sanitize step comes back blank — no throw, no warning.** `isLeadNoteMatrix` rejects a shape it
does not recognise and hands back an empty melody. The failure is a user's melody silently
vanishing on reload, which no test that only exercises the current shape will ever catch. Each
chain needs an end-to-end test that starts from a genuinely old payload and ends at a populated
melody.

Ordering inside each chain matters: the tick widening runs **after** the existing
`upgradeLeadMelodyV1` step, so a pre-DEV-369 `string[][]` payload becomes `LeadNote[][]` at the
narrow stored width first and is then widened to `LEAD_TICKS_PER_BAR`. Never the other way round.

Every loop without a `leadStepResolution` gets `'1/16'` — which is the resolution the melody
actually was authored at, not an arbitrary default — so with the doubling above, an existing
project opens with every note on the same beat, the same length and the same sound as before.
Both the persist `version` and the project `formatVersion` bump, each by its own rule and for its
own reason: the persisted shape changed, and the content contract changed.

## UI

**`LEAD_CELL_WIDTH` stays fixed at its current value.** A bar therefore gets physically wider at
1/32 and narrower at 1/8, and the grid scrolls further. There is deliberately no zoom control:
DEV-377 requires the marker's `translateX` and the ruler's header buttons to agree on a stride in
pixels, and a fixed cell width keeps that agreement free rather than making it a third thing to
keep in sync. A zoom control is a separate feature that would have to earn its own test.

The resolution select sits on the melody grid header, beside the loop-length control — the two
controls that decide the grid's extent belong together. DEV-371's keyboard navigation over the
header strips and the `aria-pressed` / `aria-label` contract on the bar and step buttons must
survive unaltered; the labels' *content* changes with the column count, their contract does not.

## Testing

Pure functions carry this, as they must: there is no DOM in this suite, so anything left inside a
clock callback or a bus listener cannot be tested at all. Required coverage:

- Both coordinate conversions, round-tripped: column → stored index → column, at every stride and
  in at least one odd meter.
- Both kinds of dormancy through `leadActivePosAt`: outside the bar, and off the grid.
- The meter × resolution divisibility matrix — all eighteen combinations, pinned as a table test.
- Quantisation and held-length at each stride, including the one-cell floor.
- `upgradeLeadMelodyToTicks`: slot placement, length doubling, and idempotence on current data.
- Both migration chains end to end, each from an old payload to a populated melody, asserting the
  chains stay separate.
- Playback at more than one resolution — the issue's Definition of Done requires it — driving
  `resolveLeadStepTriggers` and asserting both the fired columns and `holdSec`, including that a
  1/16 project's `holdSec` is unchanged from before.

Hand verification against a running transport is still required for the capture path, for the
reason DEV-374 gave: a fully green suite has previously proved nothing about whether the gesture
worked.

## Two costs, stated plainly

**`leadSoundingNotes` scans backward to column 0 on every dispatch.** At 1/32 with a 4-bar loop in
4/4 that is 128 iterations per dispatch instead of 64, and at 1/32 there can be two dispatched
columns per clock tick. This is accepted, not overlooked: the scan is array indexing over a short
array, and the stateless design exists so that seeks, loop switches and stops cannot desynchronise
a sounding-note map. If it ever shows up in a profile, the fix is a cache keyed on the melody, not
a stateful map.

**`leadMelodySteps` doubles its slot count**, 24 → 48 per bar, whether or not the loop uses the
finer grid. `persist` re-serialises the whole slice on **every `set()`** that touches it — only
the `localStorage` write is coalesced — so every drawn note, every drag, every recorded note pays
roughly twice today's serialise cost on the melody. This is the price of non-destructive storage
and it is the same price meter already pays. It is also why nothing driven by a pointer, a clock
tick or an animation frame may write `leadMelodySteps` directly.

## What is deliberately not in scope

- **Triplets**, for the LCM(2, 3) storage cost and the separate grid-reading problem above. Its
  own issue.
- **Cell-width zoom.** A fixed `LEAD_CELL_WIDTH` is what keeps the marker and the ruler in
  agreement for free.
- **The sequencer, chord-rhythm and bass grids.** They keep `MAX_STEPS_PER_BAR = 24` and are
  untouched by this work.
- **The global clock's rate.** It keeps counting 16ths for every other consumer; the lead
  subdivides within a dispatch instead.
- **Velocity.** Still not stored on a `LeadNote`, for the same reason DEV-374 gave: the note-input
  bus already carries it so that the day it lands needs no second refactor, but widening the note
  shape forces both version bumps and is not what this issue is for.

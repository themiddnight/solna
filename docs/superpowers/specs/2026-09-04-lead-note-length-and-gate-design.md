# Lead Note Length and Per-Loop Gate (DEV-369) — Design

Date: 2026-09-04
Status: Approved (brainstormed and signed off before writing)
Linear: [DEV-369 — SP2 — Per-note gate/length (legato vs step)](https://linear.app/pathompong-thitithan/issue/DEV-369)

## Goal

Let a lead note be held across more than one step, and let the player shape how much of the
final step each note actually sounds for. Today every lead note is exactly one step long and
every note is cut at the same fixed fraction of that step, so the melody grid can only produce
even, detached eighths and sixteenths — no held notes, no legato lines, no articulation.

## Terminology

- **Step** — one grid column, one 16th of a bar at the active meter.
- **Length (`len`)** — how many steps a note occupies, an integer ≥ 1. A property of the note.
- **Gate** — what fraction of the *final* step of a note is sounded before note-off. One value
  per loop, applied to every note in it.
- **Block mode** — arp off: every note starting on a step fires together as a chord.
- **Sounding** — a note that is audible at a given step, whether it started there or earlier.

## Context — what exists today

The lead melody is a step grid of absolute note names: `leadMelodySteps: string[][]`
(`src/store/types.ts:130`, mirrored per loop at `src/store/types.ts:262`), stored at a fixed
`MAX_STEPS_PER_BAR` slots per bar and windowed to the active `stepsPerBar` at playback and UI
time (`src/audio/leadMelody.ts:26-35`, `src/components/loop/lead/melodyGrid.ts:41-43`). The
array index is the step; the row is the set of note names drawn on it. Nothing in the structure
can express duration.

Playback reads the step's note set and resolves it into `LeadTrigger[]`
(`src/audio/leadMelody.ts:14-18`, `:117-142`). In block mode every note gets
`holdSec = LEAD_GATE * stepDurSec` with `LEAD_GATE = 0.85` hard-coded at
`src/audio/leadMelody.ts:12`; with arp on the note set is handed to `buildArpSequence` and
`computeArpTriggers`, which derive their own hold from `arpRate`. The clock callback in
`src/components/loop/lead/useLeadPlayback.ts:106-121` calls `playbackNoteOn` / `playbackNoteOff`
at absolute times derived from the trigger, and holds no state between ticks.

The grid renders one `<button>` per (pitch row × column) with `aria-pressed` bound to
"this note is in this step's row" (`src/components/loop/lead/LeadMelodyGrid.tsx:69-105`), and a
header row of view / octave / loop-length / clear controls (`:241-305`).

## Rejected framing: a per-note 0–1 gate

DEV-369 was originally written as a *per-note* gate value from 0 to 1, with legato produced by
detecting a repeated pitch across adjacent steps and merging it. That framing is rejected, and
the reason is worth recording because it will look like the obvious design again later.

A per-step gate cannot distinguish "one long note" from "the same short note played twice".
Both are the same data — the same pitch on two consecutive steps — and the only difference is
intent, which the data does not carry. Inferring legato from a repeated pitch therefore breaks
a legitimate musical case: two deliberate staccato notes on one pitch become one held note, and
the player has no way to ask for what they wanted. Any escape hatch (a "don't merge" flag)
re-introduces duration as a note property, just in a worse spelling.

## The chosen model: length and gate are orthogonal

Two controls, each answering a different question.

**Note length** answers *how long is this note* — an integer count of steps, set by dragging the
note's right edge in the grid the way every MIDI editor does, snapped to the grid.

**Gate** answers *how detached is the playing* — one slider per loop, applied uniformly to every
note, expressed as a percentage of **one cell**. It trims the tail of the final step only:

```
holdSec = (len - 1 + gate) * stepDurSec
```

At gate 50%, a `len: 1` note sounds for half a step and a `len: 3` note for two and a half. The
gate is articulation; the length is duration. This is why gate is *not* proportional to the
note's length — a proportional gate would scale with `len` and so would just be a second,
noisier way of setting duration, leaving no independent control of attack separation.

The important consequence: at gate 100% a note ends exactly where the next step begins, so two
same-pitch notes drawn back to back are audibly legato with no merging, no repeated-pitch
detection, and no special case anywhere in the code. DEV-369's acceptance criteria are met as a
*property of the model* rather than as a feature, which is the whole reason this shape was
chosen over the original one.

Gate is clamped to **5–100%**. The floor exists so the slider can never produce a note of zero
length (silent notes that still show as drawn in the grid are an unreportable bug); the ceiling
exists because a gate above 100% would overlap into the next note's step and re-introduce the
overlap problem invariant 1 exists to prevent.

There is **no velocity** in this change — see "Out of scope".

## Data model

`leadMelodySteps` becomes a matrix of objects:

```ts
export interface LeadNote {
  note: string;
  len: number;
}
```

`LeadNote` is defined in `src/audio/leadMelody.ts`, next to the functions that consume it. That
placement is layer-legal in both directions: `store/` and `components/` may import from
`audio/`, and `audio/` never has to import either (CLAUDE.md, three-layer rule).
`leadMelodySteps: LeadNote[][]`. The index still means **the step the note starts on**, the
matrix is still stored at `MAX_STEPS_PER_BAR` per bar and windowed to the active `stepsPerBar`,
and `leadStoredIndex` (`src/components/loop/lead/melodyGrid.ts:41-43`) is unchanged. The only
thing that changes is what a cell of the row holds.

A new per-loop field `leadGate: number` is added to `LeadSlice`
(`src/store/types.ts:128-144`), to `Loop` (`src/store/types.ts:262-265`, beside the other
`lead*` fields) and to `LOOP_FLAT_KEYS` (`src/store/loop.ts:4-36`) so the loop mirror, the
project body and the dirty fingerprint pick it up for free. Its default is **0.85** — exactly
today's `LEAD_GATE` — so a project that never touches the slider sounds identical to before.

### Alternatives rejected for the data model

**A parallel `leadNoteLengths: number[][]` grid.** Rejected because two positionally-aligned
arrays make an impossible state representable: a length with no note, a note with no length, a
row of three notes against a row of two lengths. Every writer — the slice, both migrations,
sanitize, resize, transpose, remap, the grid — would have to keep them in step by discipline
rather than by construction, and nothing would fail loudly when one of them forgot.

**A flat event list `{ step, note, len }[]`.** Rejected as premature. It is the shape a real
piano roll eventually wants, but adopting it now means rewriting `leadStoredIndex`,
`resizeLeadMelody`, the bar windowing and the whole grid render for a requirement that does not
exist yet. It also makes DEV-371 (per-bar copy/paste) harder, not easier: copying bar 2 of a
step-indexed matrix is an array slice, whereas on an event list it is a filter plus an offset
rewrite. The migration path stays open — if overlapping notes within a single pitch row are ever
needed, the object-per-note shape converts to an event list mechanically, and that is the point
at which the rewrite pays for itself.

## Invariants

All three are enforced in the slice setter, never at the call sites. A call site that can
violate an invariant is a call site that eventually will.

1. **Notes in the same pitch row may not overlap.** Extending a note over an existing note on
   the same row **swallows** it — the covered note is removed. This is what Ableton and Logic
   do, and it is the only behaviour that keeps a drag gesture from either silently failing or
   needing a modal.
2. **`start + len` may not cross the loop end.** A length that would overhang is clamped on
   write. Notes never wrap the loop boundary.
3. **`len` is an integer ≥ 1.**

`resizeLeadMelody` (`src/audio/leadMelody.ts:70-78`) gains one responsibility: when the loop
shrinks, clamp notes that now overhang the new end, so invariant 2 survives a loop-length
change as well as a write.

## Migration — two chains, one shared helper

Both readers of the old shape need the same transform, so it is written once as a pure
function in `src/audio/leadMelody.ts`:

```ts
export function upgradeLeadMelodyV1(steps: string[][]): LeadNote[][]
```

mapping each string to `{ note, len: 1 }`.

It is called from two places that stay separate functions:

1. **The persist chain.** The persist `version` in `src/store/store.ts:270` goes from its
   current value 9 to 10, with a step in the chain at `:275-312` that maps
   `loops[].leadMelodySteps` through the helper and seeds `leadGate` on each loop.
2. **The project-format chain.** `PROJECT_FORMAT_VERSION` (`src/store/projectFormat.ts:16`) goes
   from its current value 1 to 2, with the first real step in `migrateProjectBody`
   (`src/store/projectFormatMigrate.ts:10-16`) doing the same over `content.loops[]`.

They are not the same function and must not be refactored into one. CLAUDE.md's rule is that
the persist migration chain must never be used to read a project body: the persist payload is
private `localStorage` shape, the project body is an external contract, and the two version
numbers move for different reasons. Only the pure transform is shared.

### Ordering is a requirement, not an implementation detail

The two `isStringMatrix` guards that currently validate the melody
(`src/store/sanitize.ts:226` and `src/store/store.ts:204`, helper at
`src/store/sanitize.ts:123-127`) become `isLeadNoteMatrix`, checking rows of
`{ note: string; len: integer ≥ 1 }`. A non-integer or missing `len` on an otherwise valid note
falls back rather than rejecting the whole matrix.

**The upgrade must run before sanitize on both paths.** If it does not, a formatVersion-1
payload reaches the new guard as a matrix of strings, fails it, and falls back to the empty
default — the user's melody vanishes with no error and no warning. This failure mode is silent
by construction (blanked data, not a thrown exception), which is exactly why it is stated here
as a requirement rather than left to be noticed.

Both existing pipelines already have the correct order, and the new steps go inside them: on the
import path `parseProjectFile` runs `migrateProjectBody` at `src/store/projectFile.ts:91-93` and
only then `sanitizeContent` at `:100`; on the hydrate path zustand runs the persist `migrate`
before `merge`, and `merge` is where `sanitizePersistedState` is called
(`src/store/store.ts:319-320`). Neither transform may be moved into or after `merge` /
`sanitizeContent`.

## Scheduling

`leadStepNotes` (`src/audio/leadMelody.ts:26-35`) currently conflates two questions that a
length-aware model must keep apart: *which notes are sounding at this step* and *which notes
start at this step*. It is replaced by:

```ts
export interface LeadSounding { note: string; len: number; age: number }
export function leadSoundingNotes(
  steps: readonly LeadNote[][],
  stepInLoop: number,
  stepsPerBar: number,
): LeadSounding[]
```

— the same three arguments `leadStepNotes` takes today, so the call site's windowing arithmetic
is unchanged. `age` is how many steps ago the note started — `0` means it starts here. The
implementation looks backward from `stepInLoop`: at lookback distance `k`, a note in that
stored row with `len > k` is still sounding at the current step. The lookback stops at step 0 of
the loop, which is automatically correct because invariant 2 guarantees no note wraps the loop
boundary. Worst case is loop-length iterations of trivial array indexing per clock tick — a few
dozen comparisons on a 16th-note clock, orders of magnitude below the scheduling budget — and
the alternative (a persistent sounding-note map maintained across ticks) would introduce
cross-tick state that has to be rebuilt correctly on every seek, loop switch and stop. The
stateless scan is bought deliberately.

`resolveLeadStepTriggers` (`src/audio/leadMelody.ts:117-142`) takes `LeadSounding[]` plus the
loop's `gate`:

- **arp off (block).** Keep only `age === 0` and emit `holdSec = (len - 1 + gate) * stepDurSec`.
  Notes with `age > 0` emit nothing: their note-off was already scheduled at an absolute time
  when they started.
- **arp on.** Pass **all** sounding notes, including `age > 0`, as the arp pool into
  `buildArpSequence`; `arpFiresOnStep` and `computeArpTriggers` are unchanged. This was a
  deliberate decision, not a fallout: a note's length means the same thing in both modes —
  "this note is sounding here" — and the mode only decides *how* it sounds. A long note
  therefore keeps feeding the arpeggio for its whole duration, which is what drawing a long note
  under an arp visibly asks for.

**Known and accepted limitation: the gate slider has no effect while the arp is on.**
`computeArpTriggers` derives its own `holdSec` from `arpRate` and already applies its own hold
factor. Making the gate multiply it would change the sound of every existing arp pattern the
moment this lands, which fails the no-op guarantee below for no design gain. The slider's
tooltip states that gate applies when the arp is off.

`useLeadPlayback.ts:106-121` only needs to read `s.leadGate` and call the renamed functions. The
`playbackNoteOn` / `playbackNoteOff` pair is untouched: Web Audio schedules at absolute times,
so a four-step note simply gets its note-off at `time + 3.85 * stepDur` and needs no cross-tick
bookkeeping, no note-off queue and no change to the stop path.

`LEAD_GATE` (`src/audio/leadMelody.ts:12`) is retired as a runtime gate and becomes
`DEFAULT_LEAD_GATE = 0.85`, used for the slice default and as the migration seed — the two
places that must agree on "what old music sounded like".

`transposeLeadMelodyByRoot` (`:84-91`) and `remapLeadMelodyByScale` (`:97-106`) become
mechanical: map over `.note`, leave `.len` alone. Pitch operations never change duration.

## UI

**The gate slider** goes into the existing lead panel header row
(`src/components/loop/lead/LeadMelodyGrid.tsx:241-305`) using the existing
`src/components/ui/Slider.tsx` primitive: range 5–100, step 5, labelled like `Gate 85%`. It is
per loop, like every other control in that row.

**Long notes render as one button per cell, styled into a continuous bar.** The start cell
rounds its left corners, body and end cells drop their left border, and the end cell rounds its
right corners, so a three-step note reads as one bar while remaining three buttons. The
alternative — absolutely-positioned note `div`s floating over an empty grid — is a truer piano
roll, but it would mean rebuilding the accessibility layer that commit `0a9b4d3` has just
finished hardening now that the eslint a11y rules are at `error`. Per-cell buttons keep
`aria-pressed`, focus order and hit targets working for free
(`src/components/loop/lead/LeadMelodyGrid.tsx:95-105`), and the visual result is the same.

**The logic lives in pure functions**, added to `src/components/loop/lead/melodyGrid.ts`, which
already has a test file beside it. This placement is deliberate: it is what makes the behaviour
testable without a DOM (see Testing).

```ts
export type LeadCellKind = 'none' | 'start' | 'body' | 'end';
export function leadCellKinds(melody, rows, columns, stepsPerBar): Map<string, LeadCellKind[]>
export function leadResizeLen(startLen, dxPx, cellWidth, maxLen): number
```

`leadCellKinds` keys the map by pitch-row note name and stores one `LeadCellKind` per column,
so the render is a lookup rather than a search. It is computed in a single pass over the note data — walk each note once and paint
its span — rather than a per-cell backward lookup, so the render cost stays linear in notes
rather than in cells. `leadResizeLen` is
`clamp(1, maxLen, startLen + Math.round(dx / cellWidth))`, with `cellWidth` coming from
`LEAD_CELL_WIDTH` (`src/components/loop/lead/melodyGrid.ts:9`). `maxLen` derives from the loop
end **only**, never from the position of the next note, because dragging swallows (invariant 1).

**The drag gesture** is an ~8px grab strip on the right edge of a note's last cell:
`pointerdown` + `setPointerCapture` + `stopPropagation`, so it never fires the cell's `onClick`
and never toggles the note off mid-drag. **Drag-preview state lives in local component state and
is committed to the store exactly once, on `pointerup`.** This is required by CLAUDE.md, not a
preference: all four tab views stay mounted simultaneously, so a store write per `pointermove`
re-renders every view and re-serialises the persisted slice on every frame of the gesture. A
thin `useLeadNoteResize` hook holds the pointer plumbing; the arithmetic stays in
`leadResizeLen`.

**A keyboard equivalent is required, not optional**, because the a11y rules are at `error` and a
pointer-only editing affordance is an accessibility regression: `Shift+ArrowRight` and
`Shift+ArrowLeft` on a focused note cell grow and shrink it by one step, through the same slice
action as the drag.

**A new slice action** `setLeadNoteLength(stepIndex, note, len)` in `src/store/leadSlice.ts` is
the single place all three invariants are enforced. `toggleLeadNote`
(`src/store/leadSlice.ts:48-58`) stays as it is: a plain click still creates a `len: 1` note and
a click on a note still removes it.

## Testing

Two tests are the pass/fail condition of the whole change.

**1. The no-op guarantee.** An old melody — every note `len: 1` — at `leadGate = 0.85` must
produce byte-identical `LeadTrigger[]` to today, with the arp both on and off. If this passes,
no existing music changes sound, which is the entire risk budget of this change.

**2. The silent-failure regression.** A formatVersion-1 `.solna` fixture imported through the
real path (`src/store/projectFile.ts`) must come back with its melody intact. This is the
upgrade-before-sanitize ordering requirement, and it fails by blanking data rather than by
throwing, so nothing else in the suite would catch it.

Then, per file:

- `src/audio/leadMelody.test.ts` — `leadSoundingNotes` age values, lookback, the loop-start
  boundary, and stored-width-vs-active-`stepsPerBar` windowing; the `(len - 1 + gate)` formula
  at `len` 1 and 3 against gate 0.5 / 0.85 / 1.0; block mode drops `age > 0`; arp mode includes
  `age > 0`; `resizeLeadMelody` clamps overhanging notes when the loop shrinks.
- `src/store/leadSlice.test.ts` — all three invariants (swallow on overlap, clamp at loop end,
  integer ≥ 1), `toggleLeadNote` creates `len: 1`, `leadGate` clamping at both ends.
- `src/components/loop/lead/melodyGrid.test.ts` — `leadCellKinds` including two notes in one
  row and a note crossing a bar boundary; `leadResizeLen` rounding and both clamps.
- `src/store/migrate.test.ts` — the persist bump: strings become `{ note, len: 1 }` and
  `leadGate` is seeded.
- `src/store/projectFormat.test.ts` — the format bump.
- `src/store/sanitize.test.ts` — `isLeadNoteMatrix` accepts a valid matrix, rejects the old
  string matrix, and a non-integer `len` falls back.
- `src/components/loop/lead/useLeadPlayback.test.ts` — `leadGate` actually reaches the triggers.

**Accepted constraint on the DOM test.** `LeadMelodyGrid.test.tsx` runs through
`renderToString`, and zustand serves `getServerSnapshot` from the store's creation-time state,
so `useAppStore.setState(...)` before a render has no effect — CLAUDE.md's recorded trap. The
drag gesture therefore gets no DOM test. That is precisely why the arithmetic and the cell
classification were pushed into pure functions in `melodyGrid.ts`; the DOM test stays limited to
"the grid renders".

## Rejected alternatives

- **A per-note 0–1 gate with legato inferred from repeated pitches** — cannot distinguish one
  long note from the same short note repeated, and breaks deliberate staccato repeats on one
  pitch. See "Rejected framing" above.
- **A gate proportional to note length** — would scale with `len` and so duplicate the length
  control, leaving no independent way to set attack separation.
- **A parallel `leadNoteLengths: number[][]` grid** — makes desynchronised state representable
  and relies on every call site's discipline instead of construction.
- **A flat event list `{ step, note, len }[]`** — premature; requires rewriting
  `leadStoredIndex`, `resizeLeadMelody`, windowing and grid rendering with no requirement
  forcing it, and makes DEV-371's per-bar copy/paste harder. The path to it stays open.
- **Absolutely-positioned note `div`s over an empty grid** — a truer piano roll, but it would
  require rebuilding the accessibility layer just hardened in commit `0a9b4d3`, for no visual
  gain over styled per-cell buttons.
- **Gate multiplying the arp's hold** — would change the sound of every existing arp pattern on
  merge, breaking the no-op guarantee.
- **Notes wrapping the loop boundary** — would force `leadSoundingNotes` to scan across the loop
  seam and make "which note is this" ambiguous at step 0; clamping on write is both simpler and
  what the grid visually promises.

## Out of scope

Per-note velocity, per-note gate, step-record (DEV-370), and per-bar copy/paste (DEV-371).

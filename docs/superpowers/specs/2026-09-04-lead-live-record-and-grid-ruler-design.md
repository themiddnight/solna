# Live Lead Capture and a Single Grid Marker (DEV-374, DEV-377) — Design

Date: 2026-09-04
Status: Approved (brainstormed and signed off before writing)
Linear: [DEV-374 — live capture while the transport plays](https://linear.app/pathompong-thitithan/issue/DEV-374),
[DEV-377 — one marker, and a ruler you can hit](https://linear.app/pathompong-thitithan/issue/DEV-377)

## Context

Two pieces of groundwork are already shipped and this work sits directly on top of both.

DEV-370 built the note-input funnel. Every way a person can play a note — the computer
keyboard, the on-screen keyboard, a MIDI device — reaches `noteInputBus`, and exactly one
subscriber in the store (`startLeadRecordBridge` in `src/store/leadRecord.ts`) turns those
events into grid writes through `recordLeadNote`. That path currently only works with the
transport stopped: it writes at `leadCursor`, and `recordLeadNote` declines outright when
`leadPlayer !== 'stopped'`. The rules that made that path trustworthy — previews do not
announce, a source that swallows the sound still announces, observers live in `store/` and not
in `audio/` — are written down in `.claude/rules/note-input.md` and none of them change here.

DEV-376 fixed a timing bug that affected every playhead in the app. The shared clock is a
lookahead scheduler: it hands each listener the future `AudioContext` time a step will sound
at, tens of milliseconds before it does. Publishing the step inline from that callback put
every playhead ahead of its own audio, measured at roughly 116ms — at 120bpm very nearly a
whole column. The fix was `publishStepAt` in `src/components/playbackStep.ts`, which defers the
publish by `playbackAudibleDelaySec(audibleTime)` so the value lands when the step is *heard*.

What remains is capture against a running clock, and a grid that shows one marker instead of
two.

## DEV-374 — live capture while the transport plays

This fills the branch `recordLeadNote` currently declines. Eight decisions are settled.

**The time reference is the audio, not the screen.** A musician plays to what they hear: the
notes coming out of the speaker, or the app's metronome click, which runs on the same clock. At
the instant `ctx.currentTime = C`, the sound reaching their ear was scheduled for
`C - outputLatency`. So a key press observed at `C` is interpreted as having happened at
`C - outputLatency`, not at `C`. This is the exact mirror of DEV-376: that issue *added* the
same latency to delay the visual, this one *subtracts* it to advance the input. Skipping the
compensation would bias every recorded note late by a fixed amount. That is a one-directional
error, which round-to-nearest hides but does not remove — it reads as a sluggish groove and
gets worse as tempo rises, because the fixed error is a larger fraction of a shorter step.
Input latency, the delay from finger to JS event, is deliberately *not* compensated: it cannot
be measured from the page, and it is a few milliseconds.

**The step duration is measured, not computed.** Keep the two most recent clock anchors
`(step, time)` handed over by `subscribePlaybackClock`, and derive the step duration as
`(t2 - t1) / (s2 - s1)`. Do not call `stepDurationSec(bpm)`. The reason is that measuring makes
the quantiser independent of what a step *is*: a bpm change, a meter change, and a future
adjustable step resolution all follow for free. A bpm-derived constant would keep returning the
old value with no error anywhere — the notes would simply land on the wrong columns.

**Quantise to the nearest step, not the floor.** Players straddle the beat in both directions.
Flooring pushes everything played slightly early onto the previous step, which is the same
one-sided error the latency decision exists to avoid.

**Note length comes from how long the key was held**, counted in steps: `len = offStep - onStep`,
minimum 1. Counting in steps rather than seconds makes the length immune to a bpm change during
the hold. The write happens in two parts: at note-on the note goes in with `len` 1 so it appears
on the grid immediately, and at note-off it is extended through `setLeadNoteLength`. That
function already enforces all three length invariants — same-row swallow, integer ≥ 1, and the
clamp against the loop end — so a note held across the loop seam is truncated rather than
wrapping, and this feature needs no special case for it.

**The cursor does not move during playback.** The playhead is the write head; `leadCursor` is
left exactly where the user placed it. This is the same principle `src/audio/leadStepRecord.ts`
already documents for the stopped case — the cursor is the user's to place — applied to the
playing case by giving the write head a different source entirely.

**One named conversion from clock steps to grid steps.** Today the clock's 16th step and a grid
column are the same thing (`stepInLoop = step % melodyLength`, as `useLeadPlayback` computes
it), so the conversion is the identity. Name it anyway. When DEV-375 makes step resolution
adjustable there is then one place to change instead of three scattered pieces of arithmetic
that each look correct in isolation.

**Overdubbing the same pitch onto a step that already holds it is a no-op**, because the write
goes through `paintLeadNote` in `'draw'` mode. A performer repeating a note expects nothing to
happen, not the note to vanish — the same reason `recordLeadNote` already chose `'draw'` over
`'toggle'`.

**Gate the mode on whether the shared clock is running, not on `leadPlayer`.** The guard shipped
in DEV-370 is `state.leadPlayer !== 'stopped'`, which means that playing only the drums and then
pressing a key writes to a static cursor while the beat runs — incoherent, because the user is
plainly playing along to something. The rule should be expressible in one sentence: if music is
playing, record in time; if not, record at the cursor. This is a deliberate change to a guard
that shipped, not an oversight being patched.

**Layering.** The anchors and the quantise arithmetic go in `src/audio/` — pure functions, no
store imports, consistent with layering rule 1. The bridge stays the single `noteInputBus`
subscriber in `src/store/`. Note that `playbackStep.ts` is components-layer and the store must
not read it — but the recorder never needs it to. It derives the step itself from the audio-layer
anchors and `ctx.currentTime`, which is also the only way to get sub-step resolution; the
published step is a whole number meant for a highlight. Do not wire the publisher into the store
to satisfy this.

**Testing.** There is no DOM in this suite, so every decidable piece — anchor bookkeeping,
quantisation, latency subtraction, held-length counting — must sit in pure exported functions or
it cannot be tested at all. Beyond that: this feature area's history is that a fully green suite
proved nothing about whether a gesture actually worked. Hand verification against a running
transport is required here, not optional.

## DEV-377 — one marker, and a ruler you can hit

The melody grid currently shows two things that both mean "this column": the selection cursor,
drawn as a band on the header strips (`aria-pressed={col === cursor}`), and the playback
playhead, drawn as `LeadPlayhead`, a line in the grid body. Make them one marker, the way a DAW
does — except that this playhead is also the column pointer that recording writes at. Stopped,
it sits at `leadCursor` and is moved by header clicks and arrow keys. Playing, it follows the
clock.

The constraint that matters: **do not merge them into one stored value.** The running step lives
outside zustand on purpose. Holding it in React state at the playback hook's mount point
re-rendered whole views 8-16 times a second, including views on hidden tabs, because `App.tsx`
keeps every tab mounted and `display: none` skips layout and paint but not reconciliation. The
reasoning is written at the top of `src/components/playbackStep.ts`. Writing the running step
into `leadCursor` reintroduces exactly that, with the persist serialiser added on top.

So the merge is in the semantics and the pixels only. `leadCursor` remains the source while
stopped, `stepPublisher` remains the source while playing, and one small hook picks the live
source — feeding both the marker's position and, through the store-side bridge, the recorder's
write column.

Two consequences are worth stating because they are the payoff. Since `leadCursor` is never
touched during playback, "stop returns the marker to where you put it" is free — there is no
save-and-restore step to get wrong. And clicking a header while playing still moves
`leadCursor`, which takes visible effect the moment the transport stops; a ruler that went dead
during playback would be worse than one whose effect is deferred.

The ruler itself also needs to be hittable. The bar and step header strips are currently thin
`text-[8px]` and `text-[9px]` bands, and they should be as tall as a grid row cell so that a bar
or a beat is an easy target. The `aria-pressed` and `aria-label` contract and the keyboard
navigation delivered in DEV-371 must survive the change unaltered. One geometric detail: the
playhead's `translateX` is computed from `LEAD_CELL_WIDTH`, the same constant the header buttons
size themselves with, and the two must stay in agreement — a marker that drifts from its own
ruler is worse than two honest markers.

## What is deliberately not in scope

DEV-375, adjustable step resolution, is excluded. It needs its own brainstorm, and its real cost
is not the UI: the melody is stored at a fixed `MAX_STEPS_PER_BAR = 24` width per bar, so
changing resolution means a storage-width change, a persist `version` bump and a project
`formatVersion` bump. Decisions 2 and 6 above — measure the step duration, and name the
clock-step-to-grid-step conversion — exist precisely so that this work does not have to be
redone when DEV-375 lands.

Velocity is likewise out. It is carried on the note-input bus and reaches the recorder, but it
is still not stored on a note, for the same migration reason: `LeadNote` is `{ note, len }`, and
widening it forces both version bumps. The bus carries it so that day needs no second refactor.

## Ordering

DEV-374 first, then DEV-377. An earlier claim that a mis-aligned playhead blocked verification
of live capture was overstated — a player uses their ears, so the visual was never the blocker.
DEV-376 was worth doing on its own merits, as a bug affecting every playhead in the app. DEV-377
is comfort; the recorder is the feature actually being waited on.

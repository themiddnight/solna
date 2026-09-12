# Loop advance schedule-ahead — design

## Context

Crossing from one song loop to the next intermittently opens an audible gap, and the
first loop's first-beat kick occasionally drops. Both are intermittent — the tell of a
timing/jitter defect, not a logic error. The user confirmed this via A/B listening and
requested the fix be modelled on Tone.js's "schedule everything ahead of time against
the audio clock, never react at the moment" discipline.

Root cause: the loop advance is **reactive**. `songMode.ts` subscribes to the shared
clock and fires the advance on the boundary step (`step === totalSteps`), inside the
clock's `setInterval(25 ms)` dispatch. Under main-thread jitter (GC pause, a heavy React
render, the `setState` inside `loadLoop`), that dispatch lands late, so by the time the
deferred `resetClock(atBoundary)` runs, `atBoundary <= ctx.currentTime` and its fallback
re-anchors at `currentTime + 0.05` — off-grid and late, opening the gap.

`resetClock(atBoundary)` already schedules the re-anchor at the audio-clock time
(Tone.js-style, sample-accurate). The defect is purely the **fallback** path being
reached under jitter. The advance currently has ~75 ms of margin (boundary dispatched in
the 0.1 s lookahead, microtask runs right after); jitter past that margin is what fails.

## Fix: pre-arm the advance one step early

The boundary decision is deterministic — `songAdvanceDecision` returns `advance` iff
`step % totalSteps === 0 && step > 0`. So at step `totalSteps - 1` we already know the
next step crosses the boundary. Schedule the advance from there, one full step earlier:

- In `songMode.ts`'s clock callback, decide `songAdvanceDecision(…, step + 1, …)`.
- When it is `advance`, call `loadLoop(loopId, { atBoundary: time + stepDurationSec(bpm) })`
  where `time` is the current step's audio time, so `atBoundary` is still the true
  boundary instant. Audio timing is unchanged — only the *control* runs earlier.
- This lifts the margin from ~75 ms to ~200 ms (one 16th + the lookahead), so the
  `resetClock` fallback is no longer reached under ordinary jitter.

The `end` branch stays reactive: it does a **synchronous** `softStopAll()` that must land
on the boundary step before the playback hooks process it, so it cannot be pre-armed. The
song ending is a one-time event; its rewind gap (if any) is out of scope here.

## Out of scope — documented, not built

- **Web Worker ticker** (Tone.js runs its `Ticker` in a Worker). Its benefit is
  **background-tab resilience** — a Worker's timer is not throttled the way a
  main-thread `setInterval` is. It does *not* fix this gap: the dispatch still runs on
  the main thread, which is where GC/render jitter lives. Worth a follow-up for
  background-tab behaviour, but it is not the gap fix.
- **`end`-branch rewind robustness** — the song-ending "back to top" still uses the
  reactive path.

## Files

- `src/store/songMode.ts` — pre-arm the `advance` (remove the reactive advance, add the
  `step + 1` decision + `atBoundary = time + stepDurationSec(bpm)`).
- `src/store/songMode.test.ts` — pin that the advance is scheduled one step early at the
  correct boundary time, and that `end` remains synchronous.

## Verification

- `bun test src/store/songMode.test.ts`, then full `bun test`.
- `bun run verify`.
- The `boundaryErrorMs` tests in `src/audio/clock.test.ts` already pin the re-anchor
  lands step 0 on-grid; the new test pins the *margin* (decision one step early).

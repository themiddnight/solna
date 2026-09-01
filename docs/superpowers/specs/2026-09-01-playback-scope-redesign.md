# Playback scope redesign — solo vs. song

> Diagnosis and agreed design for the Arrange-page transport bug. Written during the
> 2026-08-31 performance-audit run, which deliberately did **not** fix it: a transport UX
> change must not be entangled with a performance diff. Build this on a branch off `main`.

# Arrange playback bug — diagnosis (2026-08-31)

## Report
Arrange page, bottom-left transport Play: expected the arrangement to advance
through loops in sequence; actual is a single loop repeating.

## Method
- `git worktree add /tmp/solna-main b9996ba` (main), symlinked `node_modules`
  from the branch checkout (identical `package.json`), removed when done.
  `git worktree list` now shows only the primary checkout; `git status` clean.
- Read `src/store/songMode.ts`, `src/store/loopSync.ts`, `src/App.tsx`,
  `src/store/loadLoop.ts`, `src/store/transportSlice.ts`,
  `src/store/engineSync.ts`, `src/components/useSequencerPlayback.ts`,
  `src/components/loop/chord/useChordPlayback.ts`, `src/components/song/ArrangeView.tsx`,
  `src/components/song/SortableLoopCard.tsx` on both revisions and diffed them.
- Wrote an executable repro (`src/store/_tmp_repro.test.ts`, created and
  deleted, never committed) that builds a 2-loop arrangement with **real
  store actions** — `setActiveTab('arrange')`, `addLoop()`, `setChords()`,
  `playAll()` — then drives a fake clock through `startSongModeSync` and
  asserts on `activeLoopId`/`songLoopIndex`. Ran it against both the branch
  and the `b9996ba` worktree.

## Result of the repro
Identical on both revisions:
```
songLoopIndex after playAll: 1   activeLoopId: <loop-2>
after tick 64: activeLoopId: loop-default-1   songLoopIndex: 0
```
The arrangement advances and wraps correctly on **both** `main` and the
branch for this call path.

## Findings on the named prime suspect (43ef639, loopSync fold)
- `loopMirrorPartial` skips mirroring whenever `activeLoopId` is present and
  changed in the partial (`src/store/loopSync.ts:33`) — every real call site
  that changes `activeLoopId` (`addLoop`, `duplicateLoop`, `loadLoop`) already
  supplies the correct `loops` array itself, so skipping the mirror is
  correct, not a regression.
- The four direct `useAppStore.setState()` callers named in the comment
  (`loadLoop.ts:35`, `songMode.ts:99`, `ArrangeView.tsx:139`, and the
  post-rehydrate nudge in `store.ts`) each either move `activeLoopId` or only
  touch `songLoopIndex`/`auditionLoopId` — never a `LOOP_FLAT_KEYS` field — so
  bypassing the wrapped `set` (and thus the mirror) is inconsequential for
  every path I traced.
- `useLoopSync()`'s removal from `App.tsx` is exactly the intended
  consequence of folding the mirror into `set()` — the old subscription had
  no other job.
- Conclusion: **could not confirm 43ef639 as the cause.** The fold is
  behaviorally equivalent to the old subscription for every real caller.

## Other suspects checked and ruled out
- `src/store/engineSync.ts` (5d20966/f63b19a): diffed against main — the
  `resetClock` subscription (`engineSync.ts:216-227`, bitmask of
  `isPlayerActive` across the three players, fires `audioEngine.resetClock()`
  only on the fully-stopped→active transition) is **untouched** by the
  branch; only the effects/synthParams bridge gained frame-coalescing, on a
  separate subscription.
- `src/components/useSequencerPlayback.ts` (84af9ec): the clock-callback now
  reads `sequencerTracks`/`synthParams`/`bpm`/`masterSequencerVolume` **live**
  off `useAppStore.getState()` every tick (`useSequencerPlayback.ts:149-166`)
  instead of a `useCallback` over render-scope values. This is strictly
  fresher, not stale — and `loadLoop.ts` writes the new loop's flat fields to
  the store *before* calling `play()`, so by the first tick after a boundary
  the live read already reflects the new loop.
- `src/components/loop/chord/useChordPlayback.ts` — **byte-identical** on
  both revisions (confirmed with `diff`); the chord player cannot be a
  branch-introduced regression.
- `src/store/store.ts` persist-write coalescing (ba257b9/9125e98) only defers
  the `localStorage` write; it does not touch the in-memory zustand state or
  `getState()`, so it cannot affect within-session playback logic.

## Verdict
**Not confirmed as a regression from this branch.** Every mechanism named as
a plausible cause was checked — most by reading both revisions, the loopSync
fold by an executable repro that produced *identical* results on `main`
(`b9996ba`) and the branch tip. I could not reproduce the reported symptom
(a real audio "single loop on repeat" instead of arrangement advance) with a
straightforward "add two loops, hit play" path on either revision.

This is an incomplete investigation, not a clean "pre-existing" verdict —
see Gaps below. Given the systematic-debugging discipline, I am stopping
short of proposing a fix because I have not pinned the actual failure mode.

## Gaps / next steps for a follow-up agent
1. **Re-run the repro in the real browser**, not just the store in isolation
   — use the `run` skill, build an arrangement of 3+ loops with distinct
   chord content, press the bottom-left transport Play, and listen/watch the
   Arrange page's per-card badges (`SortableLoopCard.tsx:358-369`:
   "Solo N/M" only renders when `isAuditioning` — i.e.
   `auditionLoopId === loop.id`, `ArrangeView.tsx:195`). The user's phrase
   "plays a single loop solo" is a suspicious near-exact match for that UI
   label; confirm whether `auditionLoopId` is somehow non-null when it
   shouldn't be. I traced every setter of `auditionLoopId`
   (`ArrangeView.tsx:139`, `songMode.ts:93`) and found no path from a plain
   Play click into it, but this needs eyes-on confirmation in the running
   app, since a store-level test cannot observe the actual bottom-left
   button's rendered/disabled state or React-batching edge cases across a
   real `requestAnimationFrame`/`AudioContext` clock (my repro used a
   synchronous fake clock, which cannot exercise the coalescer added in
   5d20966/f63b19a or real timing between `queueMicrotask` and the next
   audio-clock tick).
2. Try a **repeatCount > 1** loop and an **empty (0-chord) loop** in the
   arrangement — `songAdvanceTarget`'s dwell logic (`songMode.ts:44-52`) is
   untouched but was not exercised by my repro.
3. Check `ArrangeView.tsx`'s own progress-bar effect
   (`ArrangeView.tsx:84-90`, deps `[isPlaying]` only) — same live-read pattern
   as `useSequencerPlayback.ts` but not verified for correctness; if broken it
   would only affect the on-screen progress digit, not the audio, so it would
   not explain the reported symptom on its own but is worth ruling out to
   avoid a red herring.
4. If the browser repro reproduces the bug, capture the exact click sequence
   and re-run it against the `b9996ba` worktree (recreate with
   `git worktree add /tmp/solna-main b9996ba` + symlinked `node_modules`) to
   get the regression/pre-existing verdict this task was scoped to answer.

No file under `src/` was modified. No commits were made.

## Browser repro (2026-08-31, follow-up)

### Reproduced — but the mechanism is a stuck `auditionLoopId`, not a broken advance
Built a real arrangement (bun run build + vite preview on 4173, fresh
profile/localStorage), instrumented via `evaluate_script` polling
`localStorage['musibox_project_state_v1'].state.activeLoopId` (the only one of
the three suspect fields that is persisted) plus DOM snapshots for the
"SOLO N/M" / "PLAYING N/M" badges (`auditionLoopId`/`songLoopIndex` live only
in memory, so the DOM badge is the instrument for those).

**Clean-state timeline (3 fresh loops, straight "Play All"):** advances
correctly — `activeLoopId` sequence `loop-3 (stale UI cue) → loop-1 @3.0s →
loop-2 @10.8s → loop-3 @18.9s`, each dwell ≈8s matching 4 bars @120bpm. No bug.
This matches the store-level repro in the section above.

**Bug sequence — reproduces every time:**
1. On Arrange, click a loop's own "Play only Loop N" button (audition/solo).
2. Click the bottom-left transport's Stop (`softStopAll`, `id=btn-bottom-transport`).
3. Click the same transport's Play again ("Play All", `TransportBar.tsx:68`,
   `playAll()`).
Result: the transport shows "Stop" (playing) but the card still shows
**"SOLO N/M"** and the same single loop repeats forever — arrangement
advance never engages. This is an exact match for the user's report
("pressing Play plays a single loop solo, on repeat") and for the coordinator's
observed fact #2.

### Root cause (code-level, confirmed by reading, not by inference)
`auditionLoopId` (`src/store/types.ts:44`) is set only at
`ArrangeView.tsx:139` (`handleTogglePlayLoop`, the per-card solo button) and is
cleared in exactly two places:
- `ArrangeView.tsx:133` — only when the SAME loop's solo button is clicked
  again while it is the one auditioning.
- `songMode.ts:93` inside `reconcile()` — only on a **layer change**
  (`prevLayer !== layer`, i.e. leaving Arrange/Master-FX for Loop mode).

Neither `softStopAll` nor `hardStopAll` nor `playAll()` (`transportSlice.ts`)
ever touch `auditionLoopId`. `songMode.ts:101`'s song-advance subscription is
gated on `!s.auditionLoopId`, so once it's stuck non-null, Play All silently
falls into song-mode's "not advancing" branch (`songMode.ts:129`) and the
loop that was last auditioned just keeps playing through its own normal
loop-mode playback path — indistinguishable from Solo, forever, exactly as
reported.

### Regression verdict: NOT a regression — reproduces identically on `main`
`git diff b9996ba -- src/store/songMode.ts src/components/song/ArrangeView.tsx
src/store/transportSlice.ts` is **empty** — all three files controlling this
mechanism are byte-identical between `main` (`b9996ba`) and this branch. To
not rely on a static diff alone, the identical click sequence (Add Loop →
"Play only Loop 1" → Stop → Play) was run live against a `main` build served
on port 4174: **it reproduces there too** — `hasSolo: true` after Stop→Play,
transport showing "Stop" (playing). This contradicts the coordinator's
relayed claim ("it worked correctly on main, the user is certain") — the live
evidence says otherwise for this exact sequence on this exact commit. Worth
this qualifier: the user may have used a different exact click sequence, an
older main commit, or a stale/differently-shaped project than the fresh
2-loop arrangement built here — none of that was available to test.

### Smallest correct fix (analysis only — not applied, per scope)
`auditionLoopId` needs to be cleared wherever playback is stopped or a fresh
"Play All" begins, not only on layer change / same-button toggle-off:
- `transportSlice.ts`'s `softStopAll`/`hardStopAll` should reset
  `auditionLoopId: null` alongside stopping the players, and/or
- `playAll()` (or `ArrangeView`'s Play-All entry) should clear it when
  starting a normal (non-audition) transport-driven play.
Either change needs a test asserting: solo a loop, stop, Play All → the next
clock boundary advances to loop 2, not a repeat of loop 1.

### Cleanup
Both preview servers killed, `/tmp/solna-main-audit` worktree removed,
`git worktree list` shows only the primary checkout, `git status --short` is
clean. No file under `src/` was modified. No commits were made.

---

## RESOLUTION — not a regression; agreed redesign, deferred to its own branch

**Verdict: pre-existing on `main`.** Reproduced identically on both `perf/audit-2026-08-31` (:4173)
and a fresh `b9996ba` worktree (:4174) with the same click sequence (solo Loop 1 -> Stop ->
Play All): the card keeps its SOLO badge and `songMode.ts:101`'s `!s.auditionLoopId` gate never
opens. `songMode.ts`, `ArrangeView.tsx` and `transportSlice.ts` are byte-identical to `main`.
From a clean state with no prior solo click, `activeLoopId` advances loop1 -> loop2 -> loop3 on the
branch correctly, so arrangement advance itself was never broken.

**Mechanism.** `auditionLoopId` is set only at `ArrangeView.tsx:139` and cleared only at
`ArrangeView.tsx:133` (re-toggling the same card) or `songMode.ts:93` (a layer change). None of
`playAll`, `softStopAll` or `hardStopAll` clears it, so once set it survives every stop and every
subsequent play until the user happens to change layer.

**Agreed design (user decision), to be built on a branch off `main`, NOT on the perf branch.**
Mixing a transport UX change into a performance diff would make both harder to review and
impossible to revert independently.

Replace `auditionLoopId: string | null` with one explicit scope:

```ts
type PlaybackScope =
  | { kind: 'none' }
  | { kind: 'song' }
  | { kind: 'solo'; loopId: string }
```

Everything is derived from it, so the ambiguous state cannot be represented:
- Transport Play All shows Stop only when `kind === 'song'`. While `kind === 'solo'` it shows Play
  and **takes over** on click — clearing solo and starting song mode in one step.
- The soloing card shows Stop; other cards are disabled while `kind === 'solo'`; all card buttons
  are disabled while `kind === 'song'`.
- The SOLO badge renders only when `kind === 'solo'`.

**Takeover was chosen over disabling the transport button.** Disabling it costs an extra step to
get from solo to full playback, and — the deciding reason — it would leave audio sounding with no
visible global stop if the soloing card has scrolled out of view. Takeover removes the ambiguous
state just as completely in one click.

`auditionLoopId` is not in `partialize`, so no persist migration is needed. The scope transition
should be written as a pure `(scope, action) => scope` reducer and pinned by pure tests, which is
what today's arrangement cannot offer: correctness is currently spread across three files with no
executable proof.

### User-supplied repro (confirms the diagnosis exactly)

1. Refresh the page, press Play All first thing → **works correctly**, the arrangement advances.
2. Play any single loop from its card once.
3. Every subsequent Play All plays that one loop solo, **until the page is refreshed**.

This matches the mechanism above with nothing left unexplained. `auditionLoopId` is not in
`partialize`, so it is never persisted and a refresh always restores it to `null` — which is why
step 1 works and why a refresh is the only cure. Step 2 sets it at `ArrangeView.tsx:139`, and from
then on nothing clears it: `playAll`, `softStopAll` and `hardStopAll` all leave it alone, so
`songMode.ts:101`'s `!s.auditionLoopId` gate stays shut.

**Use these three steps verbatim as the acceptance test for the `PlaybackScope` redesign.** The
redesign does not merely clear the stale value at the right moment — it makes the state
unrepresentable: `{ kind: 'song' }` and `{ kind: 'solo', loopId }` cannot both hold, so there is no
"stuck" value left to leak. Sequencing Play All after a solo must advance the arrangement with no
refresh, and the transport must take over rather than being blocked.

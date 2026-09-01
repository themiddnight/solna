# Solna Perf Audit Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the stranded-voice / stuck-note correctness bugs and the highest-yield React re-render and audio-engine waste found by the 2026-08-31 performance audit, without touching the all-tabs-mounted architecture, the three-layer import boundaries, or the theme-token system.

**Architecture:** Solna is a single-page audio workstation with four tabs (Synth, Sequencer, Chords, Effects) plus an Arrange/Song layer, all kept mounted simultaneously (`block`/`hidden`) so audio never stops on tab switch. `src/audio/engine.ts` is a singleton Web Audio wrapper with no store/component imports; `src/store/` is a Zustand v5 store (`persist` + `subscribeWithSelector`) that bridges to the engine exclusively through `src/store/engineSync.ts`; `src/components/` are dumb views that read the store via `useAppStore` selectors. This plan's first ten tasks close four classes of bug/waste: (1) a voice/note-on that never receives a note-off is never torn down (engine + three UI event-loss paths), (2) unbounded polyphony from a fast arp with a long release, (3) two `SortableContext`/`useInputDeck` identity leaks that defeat existing `React.memo` boundaries, (4) preset-library wrappers building footer markup while their drawer is closed.

**Tech Stack:** React 19.2.8, Vite, Zustand v5 (persist + subscribeWithSelector), Bun (test runner + tsc lint), daisyUI 5 theme tokens, raw Web Audio API (no Tone.js; `tonal` for theory only).

**Spec:** `docs/superpowers/specs/2026-08-31-perf-audit-remediation.md`

## Global Constraints

- **Runtime is Bun.** `bun run dev` (Vite dev server), `bun test <file>` (single file), `bun test -t "name"` (single test), `bun run lint` (`tsc --noEmit`), `bun run eslint` (import-layering rules), `bun run verify` (test + lint + check:keys + check:drums + build — the completion gate; it does **not** run `bun run eslint`, run that separately whenever imports change).
- **Tests are `bun:test`, no DOM/testing-library.** Components export their testable helpers, and that is the preferred style. Rendering is also normal here, not exceptional: 29 of the 92 test files render markup via `renderToString` from `react-dom/server` and assert against the returned HTML **string** (there is no DOM — `renderToString` needs none), never against re-render counts. Assertions are single literal substrings covering several classes at once, so the classes are proven to sit on the same element. Note the zustand trap: `getServerSnapshot` is wired to the store's creation-time state, so `useAppStore.setState(...)` before a `renderToString` has no effect unless the component serves `getState()` for both snapshots (see `useLiveStore` in `src/components/ui/BottomInputDock.tsx`). Full conventions: `.claude/rules/testing.md`. There is no `react-test-renderer` and no fake-timer/jsdom harness — timer-dependent engine tests use small real delays (`await new Promise((r) => setTimeout(r, N))`), matching the existing style in `src/audio/engine.test.ts`.
- **Engine tests use `src/audio/testFakes.ts`.** `makeEngine()`/`freshEngine()` construct a real `AudioEngine` instance wired to a fake `AudioContext`; `fakeParam()` records every `cancelScheduledValues`/`cancelAndHoldAtTime`/`setValueAtTime`/`exponentialRampToValueAtTime`/`setTargetAtTime` call plus a `valueAt(t)` evaluator. Private engine fields are reached via `(engine as any).field` casts — this is the established, sanctioned pattern (see the file's own header comment), not a hack to avoid.
- **Persist:** key `musibox_project_state_v1`, version **7** (not 5 — CLAUDE.md is stale), `partialize` returns `{bpm, meterId, masterVolume, metronomeActive, selectedVibeId, controlTarget, effects, customSynthPresets, customChordProgressions, loops, activeLoopId}`, with `migrate` + guarded localStorage (in-memory fallback) in `store.ts`.
- **Three-layer import boundaries** (enforced by `eslint`'s `no-restricted-imports`): `audio/` never imports `store/` or `components/`; `store/` never imports `components/` (but **may** import `audio/` — `src/store/midiInput.ts` and `src/store/engineSync.ts` already do); `components/` never imports `audio/engine` except `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx` (read-only analyser consumers).
- **Store→engine bridge is `src/store/engineSync.ts`.** Never call engine setters from a component; add state to a slice and wire it there. Exactly two tasks in this plan touch that file — Task 15 (rAF coalescing) and Task 16 (reverb-decay debounce, applied on top of Task 15); no other task may add a subscription there.
- **No `tailwind.config.*`** may be added; daisyUI theme-token roles only, components name roles and never colours; `scripts/themeTokenGuard.ts` must stay green (no raw hex, no Tailwind palette classes, no `text-white`/`bg-black`, no `dark:` variant, no `rgb()`/`rgba()` literals, no silently-dead utilities). Its `ALLOWLIST` **is empty and must stay empty** — the guard suite has hygiene + shrink tests that fail if it is re-populated, so fix the code, not the allowlist. No task in this plan invents a new class string: every extraction (Tasks 22, 30, 31, 32, 33) copies its markup verbatim and proves it with a `renderToString` byte-identity or class-string assertion. Run `bun run check:theme` after any task that moves JSX.
- **Documented traps that must survive.** Instant Vibes ids intentionally drift from their labels (`cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden"); they are persisted in project files, so Task 30 must move `src/store/instantVibes.ts` behind a dynamic import **without renaming a single id**. Tap Tempo and stereo VU are **unbuilt, not broken** (`docs/design.md` §4 item 3) — no task may "fix" their absence. The three analyser-reading rAF components (`AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`) import `audio/engine` on purpose and keep that exemption.
- **No new npm dependency** may be added by any task.
- **Commit messages:** conventional-commit style; end with the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **No placeholders.** Every code step below is real, complete, compiling code — copy it verbatim into the named file at the named location.

## Phase Overview

Root causes are the spec's: **RC-1** voice lifetime has no owner, **RC-2** one pointer event
fans out into six expensive operations, **RC-3** step state is owned too high. "Shippable"
means the phase can be merged on its own without any later phase and leaves `bun run verify`
green — it does **not** mean the tasks inside it are order-independent.

| Phase | Tasks | What it does | Root cause | Independently shippable |
|---|---|---|---|---|
| 1 | 1–6 | Baseline measurement (Task 1), then close the stranded-voice leak: engine backstop, voice cap, and the three UI paths that lose a note-off | RC-1 (Task 1 is measurement, n/a) | Yes — Tasks 2–6 are mutually independent except 3-after-2 |
| 2 | 7–10 | Cheap identity/render fixes that need no new module: dnd-kit `items` memo, `keyboardProps`/`drumProps` memo, chromatic-note memo, closed-drawer footer guard | RC-2 | Yes — every task stands alone |
| 3 | 11–16 | The pointer-event fan-out itself: narrow the App-level subscription, stop the clock re-subscription, coalesce persisted writes, fold `loopSync`'s second `set()`, rAF-coalesce `engineSync`, debounce reverb Decay | RC-2 | Yes — but 16 must follow 15 (same file) |
| 4 | 17–23 | Move the 16th-note step out of the three big views into the leaves that render it, via a `useSyncExternalStore` publisher | RC-3 | Yes — but Tasks 18–22 all depend on Task 17; Task 23 is independent of the publisher by design |
| 5 | 24–29 | Engine-side and algorithmic waste: arp-sequence memo, bass note-on map copy, impulse byte budget, streamed progression audition, visualizer throttle, idle `AudioContext` suspend | RC-1 (25, 29) + RC-2 (24, 26, 27, 28) | Yes — every task stands alone; Task 29 is the riskiest in the plan |
| 6 | 30–33 | Bundle + structure: make the `React.lazy()` splits real, extract the five Synth panels and the two Chord/Bass panels, route `TrackRow` through `StepRow` | n/a — js-perf #2 and simplify H1/H2/M1, not an RC | Yes — but 33 must follow 32 (`StepRow` callers) and 18 (`StepRow` file) |
| 7 | 34–36 | Correct the stale comments and `CLAUDE.md`, update `docs/design.md` §4 for the extractions, then re-measure and run the gate | n/a — documentation and verification | No — must run last; Task 36 diffs against Task 1 |
| 8 | 37–40 | Coverage completions found while reconciling the three plan parts against the audits: App-child `React.memo` wrappers, `loopIds` identity, the duplicated `HARD_STOP_RELEASE`, and the two remaining M10 allocations | RC-2 (37, 38, 40) + n/a (39) | Yes — all four are optional follow-ups; re-run Task 36 if they land |

## File Structure

Full set of files touched across Tasks 1-36, with the real task numbers that touch
each one. Phase 8 (Tasks 37-40) adds `src/components/song/loopIdKey.ts` + its test and
`src/audio/playback/chordPlayback.ts`, and re-touches `SynthView.tsx`, `SequencerView.tsx`,
`ArrangeView.tsx`, `BottomInputDock.tsx`, `LoopPage.tsx`, `SongPage.tsx`,
`playbackEngine.ts`, `useChordPlayback.ts`, `useLeadPlayback.ts` and `engine.ts`; each of
those four tasks lists its own files. Where more than one task edits a file, they are listed in application order and the
later task's `**Files:**` line ranges are stated relative to the earlier task's result.

**Modified — `src/audio/`:**
- `src/audio/engine.ts` — Tasks 2, 3 (voice lifetime + steal), 16 (`setReverbDecay` extraction), 25 (bass note-on map copy), 26 (`impulseCache` budget), 29 (`teardownAt` + activity marks)
- `src/audio/engine.test.ts` — Tasks 2, 3, 16, 25, 26, 29 (append-only, one `describe` each)
- `src/audio/arpeggiator.ts` + `src/audio/arpeggiator.test.ts` — Task 24
- `src/audio/arpSchedule.ts` — Task 24
- `src/audio/leadMelody.ts` — Task 24
- `src/audio/playback/arpPlayback.ts` — Task 24
- `src/audio/playback/chordPlayback.ts` — Task 24
- `src/audio/playback/presetPreview.ts` + `presetPreview.test.ts` — Task 27

**Modified — `src/store/`:**
- `src/store/midiInput.ts` — Task 6
- `src/store/store.ts` — Task 13 (persist `storage` + `flushPersistedWrites`), Task 14 (wrap the `set` handed to every slice)
- `src/store/store.test.ts` — Task 13
- `src/store/loopSync.ts` + `loopSync.test.ts` — Task 14
- `src/store/engineSync.ts` — Task 15 (rAF coalescing), Task 16 (reverb-decay debounce, applied on top of Task 15)
- `src/store/engineSync.test.ts` — Task 16

**Modified — `src/components/`:**
- `src/App.tsx` — Task 14 (drop `useLoopSync`), Task 29 (`FIRST_GESTURE_EVENTS` + resume)
- `src/App.test.tsx` — Task 29
- `src/components/useInputDeck.ts` + `useInputDeck.test.tsx` — Task 4 (blur/visibilitychange release), Task 8 (`useMemo` the two prop objects), Task 11 (narrow the `synthParams` subscription)
- `src/components/useSequencerPlayback.ts` + `useSequencerPlayback.test.ts` — Task 12 (pure `sequencerStepEvents`), Task 22 (publish instead of `setState`)
- `src/components/AudioVisualizer.tsx` — Task 28
- `src/components/InstantVibesBar.tsx` + `InstantVibesBar.test.tsx` — Task 30
- `src/components/ui/Keyboard.tsx` + `Keyboard.test.ts` — Task 5 (`onTouchCancel`), Task 9 (`useMemo`)
- `src/components/ui/StepRow.tsx` + `StepRow.test.tsx` — Task 18 (append `PlayingStepRow`), Task 33 (three optional props on `StepRowProps`, applied on top of Task 18)
- `src/components/loop/ChordView.tsx` — Task 7 (`chordIds` memo), Task 18 (`PlayingStepRow`), Task 32 (extract the two module panels), Task 34 (stale comment)
- `src/components/loop/ChordView.test.tsx` — Tasks 7, 32
- `src/components/loop/SynthView.tsx` — Task 19 (drop `useLeadPlayback`), Task 31 (extract the five Pro-Mode panels)
- `src/components/loop/SequencerView.tsx` + `SequencerView.test.tsx` — Task 22
- `src/components/loop/ChordPresetLibrary.tsx` + `ChordPresetLibrary.test.tsx` — Task 10
- `src/components/loop/SynthPresetLibrary.tsx` + `SynthPresetLibrary.test.tsx` — Task 10
- `src/components/loop/chord/useChordPlayback.ts` — Task 18
- `src/components/loop/lead/useLeadPlayback.ts` — Task 19 (publish the step), Task 20 (publish only when the step plays)
- `src/components/loop/lead/LeadPianoRoll.tsx` + `LeadPianoRoll.test.tsx` — Task 19 (own the hook + `LeadPlayhead`), Task 21 (memoize the two header rows)
- `src/components/loop/sequencer/TrackRow.tsx` — Task 33 (Task 22 changes only who *renders* it; `TrackRow.tsx` itself is untouched until Task 33)
- `src/components/song/ArrangeView.tsx` — Task 23
- `src/components/song/ArrangeView.test.tsx` — Task 23 (run unchanged; no edit expected)

**Modified — docs:**
- `CLAUDE.md` — Task 34 (React 19, persist version 7, test-fakes note)
- `docs/design.md` — Task 35 (§4 items 4 and 6, the `ui/` primitive list, §6.5's "used by" column)
- `docs/superpowers/metrics-baseline.md` — Task 1 (the "Before" section), Task 36 (appends the "After" section under the same headings)

**Created:**
- `src/store/midiInput.test.ts` — Task 6
- `src/utils/coalescedStorage.ts`, `src/utils/coalescedStorage.test.ts` — Task 13
- `src/utils/frameCoalescer.ts`, `src/utils/frameCoalescer.test.ts` — Task 15
- `src/utils/trailingDebounce.ts`, `src/utils/trailingDebounce.test.ts` — Task 16
- `src/components/playbackStep.ts`, `src/components/playbackStep.test.ts` — Task 17
- `src/components/loop/sequencer/SequencerGrid.tsx` — Task 22 (its tests are appended to `SequencerView.test.tsx`)
- `src/components/song/arrangeStep.ts`, `src/components/song/arrangeStep.test.ts` — Task 23
- `src/audio/arpSchedule.test.ts` — Task 24
- `src/audio/impulseBudget.ts`, `src/audio/impulseBudget.test.ts` — Task 26
- `src/components/AudioVisualizer.test.tsx` — Task 28
- `src/audio/idleSuspend.ts`, `src/audio/idleSuspend.test.ts` — Task 29
- `src/store/vibeChips.ts`, `src/store/vibeChips.test.ts` — Task 30 (the `VIBE_CHIPS` metadata table; it lives in `store/` because it mirrors `store/instantVibes.ts` and must import nothing)
- `src/components/vibeActions.ts` — Task 30 (its tests are the existing `InstantVibesBar.test.tsx`, re-pointed at the new module)
- `src/components/loop/synth/useSynthChannel.ts` — Task 31
- `src/components/loop/synth/OscillatorPanel.tsx`, `FilterPanel.tsx`, `EnvelopePanel.tsx`, `LfoPanel.tsx`, `ArpeggiatorPanel.tsx` — Task 31
- `src/components/loop/synth/synthPanels.test.tsx` — Task 31
- `src/components/loop/chord/bassStepChoice.ts`, `AdjustSynthButton.tsx`, `ChordModulePanel.tsx`, `BassModulePanel.tsx` — Task 32
- `src/components/loop/chord/modulePanels.test.tsx` — Task 32
- `src/components/loop/sequencer/TrackRow.test.tsx` — Task 33 (the byte-identity pin)

**Read but never modified** (imported by new/edited code; listed so nobody edits them by
reflex): `src/audio/playback/playbackEngine.ts` (Tasks 12, 23 import `subscribePlaybackClock`
/ `triggerPad` from it), `src/store/instantVibes.ts` and `src/store/vibeVariation.ts`
(Task 30 imports them lazily — the Instant Vibes ids in `instantVibes.ts` must not change),
`src/utils/synthControl.ts`, `src/utils/meter.ts`, `src/components/sequencerGrid.ts`.

---

### Task 1: Capture the before-measurements baseline

Records the build size, test count/runtime, and a written manual-profiling protocol for the two hot gestures the later fixes target, so Task 36 (final verification) can compare like for like. No source code changes.

**Files:**
- Modify: `docs/superpowers/metrics-baseline.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `## Baseline (recorded in Task 1, branch perf/audit-2026-08-31, …)` under a new `# Perf audit remediation — metrics` H1 in `metrics-baseline.md`, with four `###` subsections — `Bundle`, `Tests`, `DevTools — 5 s filter-cutoff knob drag, chords playing`, `DevTools — 30 s idle playback on Master FX`. Task 36 appends a sibling `## After (…)` that mirrors those four headings one-for-one, so **the heading text and the bundle table's row names and order are a contract with Task 36** — do not improvise them.

- [ ] **Step 1: Run the build and capture the chunk table**

  Run: `bun run build`

  Real output on `perf/audit-2026-08-31` @ this branch tip:

  ```
  dist/index.html                               6.00 kB │ gzip:  2.00 kB
  dist/assets/index-BEwPIbws.css              173.95 kB │ gzip: 26.74 kB
  dist/assets/rolldown-runtime-CbXtAM7H.js      0.58 kB │ gzip:  0.36 kB
  dist/assets/SynthPresetLibrary-B_1zPVj8.js    7.57 kB │ gzip:  2.92 kB
  dist/assets/ChordPresetLibrary-CPkJ2ISe.js   10.15 kB │ gzip:  3.21 kB
  dist/assets/icons-CuNfNZC_.js                10.43 kB │ gzip:  4.00 kB
  dist/assets/PresetLibrary-C__iwxhh.js        13.07 kB │ gzip:  3.55 kB
  dist/assets/tonal-BvKN2h_A.js                23.56 kB │ gzip:  8.47 kB
  dist/assets/dndkit-BX1A6IQ6.js               55.19 kB │ gzip: 18.19 kB
  dist/assets/vendor-Bj1dzbYU.js              178.64 kB │ gzip: 56.45 kB
  dist/assets/index-Dg9gUfAs.js               304.90 kB │ gzip: 80.73 kB
  ```

  Total JS (excluding CSS/HTML): **604.09 kB raw / 177.88 kB gzip** across 9 chunks.

- [ ] **Step 2: Run the test suite and capture the count/runtime**

  Run: `bun test`

  Real output:

  ```
  bun test v1.3.14 (0d9b296a)

   1230 pass
   0 fail
   539260 expect() calls
  Ran 1230 tests across 92 files. [1.56s]
  ```

- [ ] **Step 3: Actually run the two profiles and write the numbers down**

  Task 36 re-runs these and diffs against them, so a protocol alone is not enough — **six baseline numbers must exist before Task 36 can execute at all**. Build once and serve the production bundle:

  ```bash
  bun run build
  bunx vite preview --port 4173
  ```

  (There is **no `preview` script** in `package.json` — the scripts are `dev`, `build`, `lint`, `eslint`, `check:theme`, `check:keys`, `check:drums`, `verify`. Use `bunx vite preview` and note the exact command in the file so Task 36 matches it.)

  Record the gestures **exactly as Task 36 will repeat them**:

  1. **Filter-cutoff knob drag, 5 s.** Synth tab in **Pro Mode**, with the **chord player running** so voices are live. DevTools → Performance → record, drag `#slider-filter-cutoff` continuously for 5 s (steady medium-speed back-and-forth, not a single flick), stop.
  2. **Idle playback, 30 s.** Press **Play All**, switch to the **Master FX** tab, record, leave it untouched for 30 s, stop.

  For each recording note (a) total **Scripting** ms from the summary bar, (b) the **Longest Task** ms (click the widest yellow block, read "Self Time"), (c) the **Layout** count (expand Rendering, count purple Layout events), and (d) whether any task carries a red "Long Task" marker. That is three numbers per gesture that Task 36's template has a `(baseline …)` slot for; the fourth is a yes/no note.

- [ ] **Step 4: Append the dated section to `metrics-baseline.md`**

  The file already contains an unrelated project's sections (`# murva restructure — metrics`, with its own `## Baseline (recorded before Task 2, 2026-08-24)` and `## After (recorded in Task 18)`). **Append below all of it; do not edit or overwrite those.** Use a new H1 so this branch's numbers cannot be confused with murva's, and use the `###` subsection names and row order verbatim — Task 36 mirrors them one-for-one:

  ```markdown

  # Perf audit remediation — metrics

  ## Baseline (recorded in Task 1, branch perf/audit-2026-08-31, base main @ b9996ba, 2026-08-31)

  Build served with `bun run build && bunx vite preview --port 4173`.

  ### Bundle

  | chunk | raw | gzip |
  |---|---|---|
  | index-*.js | 304.90 kB | 80.73 kB |
  | vendor-*.js | 178.64 kB | 56.45 kB |
  | dndkit-*.js | 55.19 kB | 18.19 kB |
  | tonal-*.js | 23.56 kB | 8.47 kB |
  | PresetLibrary-*.js | 13.07 kB | 3.55 kB |
  | icons-*.js | 10.43 kB | 4.00 kB |
  | ChordPresetLibrary-*.js | 10.15 kB | 3.21 kB |
  | SynthPresetLibrary-*.js | 7.57 kB | 2.92 kB |
  | rolldown-runtime-*.js | 0.58 kB | 0.36 kB |
  | **ALL JS** | **604.09 kB** | **177.88 kB** |
  | **FIRST-PAINT JS** (all but the three lazy PresetLibrary chunks) | **573.30 kB** | **168.20 kB** |
  | CSS | 173.95 kB | 26.74 kB |

  ### Tests
  - 1230 pass / 0 fail, 1560 ms (1.56 s)
  - 539260 expect() calls across 92 files

  ### DevTools — 5 s filter-cutoff knob drag, chords playing
  (Synth tab, Pro Mode, chord player running, `#slider-filter-cutoff`)
  - Scripting: <fill in from Step 3> ms
  - Longest task: <fill in> ms
  - Layout count: <fill in>
  - Long-task marker present: <yes/no>

  ### DevTools — 30 s idle playback on Master FX
  (Play All, then switch to the Master FX tab, untouched)
  - Scripting: <fill in from Step 3> ms
  - Longest task: <fill in> ms
  - Layout count: <fill in>
  - Long-task marker present: <yes/no>

  ```

  Replace every `<fill in>` with the real number from Step 3 before committing. **Do not commit this task with a placeholder left in** — Task 36 has no other source for these six values.

- [ ] **Step 5: Commit**

  ```bash
  git add docs/superpowers/metrics-baseline.md
  git commit -m "docs(perf): record pre-remediation build/test baseline and profiling protocol

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: Engine-side max-lifetime backstop for a voice whose note-off never arrives

A voice is only ever torn down by `triggerSynthNoteOff` reaching `releaseVoice` (via its `setTimeout`) or `silenceVoiceNow`. If a note-off is lost upstream (see Tasks 4–6), the voice's oscillators run and get re-targeted by every future `updateSynthParams` call forever. This task adds a wall-clock ceiling inside the engine itself, so the leak is unreachable regardless of what any UI layer does.

**Files:**
- Modify: `src/audio/engine.ts:66` (add a field to `SynthVoice`), `src/audio/engine.ts:138` (add an instance field), `src/audio/engine.ts:722` (arm the guard in `triggerSynthNoteOn`), `src/audio/engine.ts:751` (clear the guard in `teardownVoiceNodes`)
- Test: `src/audio/engine.test.ts` (append; current EOF is line 1829)

**Interfaces:**
- Consumes: nothing new — uses the existing `SynthVoice` type, `activeVoices`/`sourceVoices` maps, and `releaseVoice`/`teardownVoiceNodes` private methods, all already in `engine.ts`.
- Produces: `SynthVoice.lifetimeGuardTimer?: ReturnType<typeof setTimeout>`, `AudioEngine.maxVoiceLifetimeMs` (private instance field, default `30_000`, overridable via `(engine as any).maxVoiceLifetimeMs = N` in tests — the same cast pattern `testFakes.ts` already documents). Task 3 inserts its own code immediately after this task's block inside `triggerSynthNoteOn` and reads this same field/pattern; no exported API changes.

- [ ] **Step 1: Write the failing tests**

  Append to `src/audio/engine.test.ts` (after the final `});` at line 1829):

  ```ts

  describe('voice lifetime backstop', () => {
    // maxVoiceLifetimeMs is overridden via the same private-field cast
    // testFakes.ts documents (ctx, activeVoices, etc.) — waiting out the real
    // 30 s default would make this test take 30 s for no added coverage.
    test('a note-on with no matching note-off is torn down after maxVoiceLifetimeMs', async () => {
      const { engine, ctx } = freshEngine();
      (engine as any).maxVoiceLifetimeMs = 20;
      engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth');
      const voice = (engine as any).activeVoices.get('synth:C4');
      const stopped = spyOn(voice.oscs[0], 'stop');

      // Guard fires at 20 ms and calls releaseVoice(voice, 0.05, now), which
      // arms its own teardown timer of (max(0.05, 0.01) + 0.1) * 1000 = 150 ms
      // — wait past both.
      await new Promise((r) => setTimeout(r, 300));

      expect(stopped).toHaveBeenCalled();
      expect((engine as any).activeVoices.has('synth:C4')).toBe(false);
    });

    test('a voice released normally before the guard fires is never released twice', async () => {
      const { engine, ctx } = freshEngine();
      (engine as any).maxVoiceLifetimeMs = 50;
      engine.triggerSynthNoteOn(
        'C4',
        { ...SYNTH, release: 0.01, filterRelease: 0.01 },
        0.8,
        ctx.currentTime,
        'synth',
      );
      const voice = (engine as any).activeVoices.get('synth:C4');
      const stopped = spyOn(voice.oscs[0], 'stop');

      // The real note-off's releaseScheduledAt is set synchronously, well
      // before the 50 ms guard fires, so the guard must see it and no-op.
      engine.triggerSynthNoteOff('C4', 0.01, undefined, 'synth');
      await new Promise((r) => setTimeout(r, 250));

      expect(stopped).toHaveBeenCalledTimes(1);
    });

    test('a still-scheduled future voice is not touched by an already-expired guard', () => {
      const { engine, ctx } = freshEngine();
      (engine as any).maxVoiceLifetimeMs = 30_000;
      engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime + 5, 'synth');
      const voice = (engine as any).activeVoices.get('synth:C4');

      expect(voice.lifetimeGuardTimer).toBeDefined();
      expect(voice.releaseScheduledAt).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails**

  Run: `bun test src/audio/engine.test.ts -t "voice lifetime backstop"`
  Expected: FAIL on the first two tests — `stopped` is never called because nothing tears the voice down; `voice.lifetimeGuardTimer` is `undefined` in the third.

- [ ] **Step 3: Add the field to `SynthVoice`**

  In `src/audio/engine.ts`, immediately after line 66 (`teardownTimer?: ReturnType<typeof setTimeout>;`), inside the `SynthVoice` type:

  ```ts
  // Wall-clock backstop for a note-off that never arrives (window blur while
  // a key is held, a MIDI device unplugged mid-note, a touch interrupted by
  // the OS — see useInputDeck.ts, Keyboard.tsx and midiInput.ts). Cleared in
  // teardownVoiceNodes alongside lfoTeardownTimer so a normal release cannot
  // let this fire a second time.
  lifetimeGuardTimer?: ReturnType<typeof setTimeout>;
  ```

- [ ] **Step 4: Add the instance field**

  Immediately after line 138 (`private sourceVoices = new Map<string, Set<SynthVoice>>();`):

  ```ts

  // Ceiling on how long a voice can sit in activeVoices without a note-off,
  // in real wall-clock ms (not audio-clock seconds — this must keep counting
  // even if ctx.currentTime stalls). An instance field, not a module
  // constant, so a test can shrink it instead of waiting out 30 real seconds.
  private maxVoiceLifetimeMs = 30_000;
  ```

- [ ] **Step 5: Arm the guard in `triggerSynthNoteOn`**

  In `src/audio/engine.ts`, immediately after `voicesOfSource.add(voice);` (the line right before the function's closing `}` at what is currently line 722–723):

  ```ts
    voicesOfSource.add(voice);

    // Backstop: force this voice through the normal release path after
    // maxVoiceLifetimeMs of wall-clock time if nothing ever releases it. The
    // two `this.activeVoices.get(...) !== voice` / releaseScheduledAt checks
    // make this a no-op on every voice that was released normally — see
    // teardownVoiceNodes, which clears this timer on every real teardown path.
    const voiceKey = `${source}:${noteName}`;
    voice.lifetimeGuardTimer = setTimeout(() => {
      if (this.activeVoices.get(voiceKey) !== voice) return;
      if (voice.releaseScheduledAt !== undefined) return;
      if (!this.ctx) return;
      this.releaseVoice(voice, 0.05, this.ctx.currentTime);
    }, this.maxVoiceLifetimeMs);
  }
  ```

  (Task 3's cap-and-steal block is inserted immediately after this one, inside the same function, in the next task — do not add a second closing `}` here.)

- [ ] **Step 6: Clear the guard on every real teardown path**

  In `teardownVoiceNodes` (currently line 750–751), add the clear alongside the existing `lfoTeardownTimer` clear:

  ```ts
  private teardownVoiceNodes(voice: SynthVoice, when?: number): void {
    if (voice.lifetimeGuardTimer !== undefined) clearTimeout(voice.lifetimeGuardTimer);
    if (voice.lfoTeardownTimer !== undefined) clearTimeout(voice.lfoTeardownTimer);
  ```

  Every path that tears a voice down (`releaseVoice`'s delayed timeout, `silenceVoiceNow`) already routes through `teardownVoiceNodes`, so this is the single place the guard needs clearing.

- [ ] **Step 7: Run the tests, confirm pass**

  Run: `bun test src/audio/engine.test.ts -t "voice lifetime backstop"`
  Expected: PASS (all three).

- [ ] **Step 8: Run the full engine suite + type-check**

  Run: `bun test src/audio/engine.test.ts` then `bun run lint`
  Expected: both green — no other test relies on `SynthVoice`'s exact field set or on `triggerSynthNoteOn` not scheduling a timer.

- [ ] **Step 9: Commit**

  ```bash
  git add src/audio/engine.ts src/audio/engine.test.ts
  git commit -m "fix(audio): add a wall-clock max-lifetime backstop for voices with no note-off

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: Voice cap + oldest-started steal per source

Nothing currently bounds polyphony beyond same-note dedup and the forced-mono bass path — a fast arp with a long release settles at dozens of live voices per source. This task adds a generous per-source cap that steals the oldest already-started, not-yet-releasing voice when exceeded.

**Files:**
- Modify: `src/audio/engine.ts:144` (add an instance field — **post-Task-2**, which inserts 6 lines after `:66` and its own guard block after `:138`; pre-branch `:138`), `src/audio/engine.ts` inside `triggerSynthNoteOn` (append after Task 2's guard block — locate it by the text `voice.lifetimeGuardTimer = setTimeout(`, not by a line number)
- Test: `src/audio/engine.test.ts` (append after Task 2's new `describe` block)

**Interfaces:**
- Consumes: Task 2's `triggerSynthNoteOn` edit — this task's code is inserted immediately after Task 2's `voice.lifetimeGuardTimer = setTimeout(...)` block and its closing `}`, inside the same function, so it must be applied on top of Task 2 (both touch the tail of `triggerSynthNoteOn` — pre-branch `engine.ts:716-723`, roughly `:728-748` after Task 2).

> **Anchor-first rule for `engine.ts`.** Six tasks edit this file in order — 2, 3, 16, 25, 26, 29 — and each inserts lines above the next one's target. Every `engine.ts` line number quoted in Tasks 16, 25, 26, 29 and 34 is therefore **pre-branch** unless it says otherwise. Locate each target by the quoted code or comment text and re-derive the number from the file in front of you; do not trust the digits. As a rough guide after Tasks 2 and 3: `≤:66` unshifted, `:67-138` +6, `:139-722` +17, and everything below `triggerSynthNoteOn` about +53. Uses the existing `voicesOfSource` local (already in scope from the existing code) and `now` (already computed at the top of the function).
- Produces: `AudioEngine.maxVoicesPerSource` (private instance field, default `24`, overridable the same way as `maxVoiceLifetimeMs`). No exported API changes.

- [ ] **Step 1: Write the failing tests**

  Append to `src/audio/engine.test.ts` (after Task 2's `describe('voice lifetime backstop', ...)` block):

  ```ts

  describe('voice cap', () => {
    test('exceeding maxVoicesPerSource steals the oldest already-started voice', () => {
      const { engine, ctx } = freshEngine();
      (engine as any).maxVoicesPerSource = 3;
      engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
      engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth');
      engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth');
      const oldest = (engine as any).activeVoices.get('synth:C4');
      expect(oldest.releaseScheduledAt).toBeUndefined();

      engine.triggerSynthNoteOn('F4', SYNTH, 0.8, ctx.currentTime, 'synth');

      expect(oldest.releaseScheduledAt).toBeDefined();
      const newest = (engine as any).activeVoices.get('synth:F4');
      expect(newest.releaseScheduledAt).toBeUndefined();
    });

    test('a voice scheduled into the future is never stolen', () => {
      const { engine, ctx } = freshEngine();
      (engine as any).maxVoicesPerSource = 2;
      const future = ctx.currentTime + 5;
      engine.triggerSynthNoteOn('C4', SYNTH, 0.8, future, 'synth');
      engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth');
      engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth');

      const futureVoice = (engine as any).activeVoices.get('synth:C4');
      const middleVoice = (engine as any).activeVoices.get('synth:D4');
      expect(futureVoice.releaseScheduledAt).toBeUndefined();
      expect(middleVoice.releaseScheduledAt).toBeDefined();
    });

    test('a voice already releasing is never stolen a second time', () => {
      const { engine, ctx } = freshEngine();
      (engine as any).maxVoicesPerSource = 2;
      engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
      engine.triggerSynthNoteOff('C4', 0.3, ctx.currentTime, 'synth');
      const releasing = (engine as any).activeVoices.get('synth:C4');
      const releasedAt = releasing.releaseScheduledAt;

      engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth');
      engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth');

      expect(releasing.releaseScheduledAt).toBe(releasedAt);
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails**

  Run: `bun test src/audio/engine.test.ts -t "voice cap"`
  Expected: FAIL — with no cap, all four voices stay live; `oldest.releaseScheduledAt` is `undefined` after the fourth note-on.

- [ ] **Step 3: Add the instance field**

  Immediately after Task 2's `private maxVoiceLifetimeMs = 30_000;` field:

  ```ts

  // Generous per-source ceiling. Bounds worst case node count from a fast
  // arp with a long release — e.g. a chord arp at 32n with a 2 s release
  // settles around 50 voices with no cap (see the audit's arithmetic).
  private maxVoicesPerSource = 24;
  ```

- [ ] **Step 4: Add the cap-and-steal block**

  Immediately after Task 2's guard block, still inside `triggerSynthNoteOn`, before its closing `}`:

  ```ts
    voice.lifetimeGuardTimer = setTimeout(() => {
      if (this.activeVoices.get(voiceKey) !== voice) return;
      if (voice.releaseScheduledAt !== undefined) return;
      if (!this.ctx) return;
      this.releaseVoice(voice, 0.05, this.ctx.currentTime);
    }, this.maxVoiceLifetimeMs);

    // Voice cap: steal the oldest ALREADY-STARTED, not-yet-releasing voice of
    // this source when the cap is exceeded. `startTime > now` is excluded —
    // stealing a voice scheduled ahead would cancel a planned envelope, the
    // same hazard releaseVoice's own comments describe for reshapeableVoices.
    if (voicesOfSource.size > this.maxVoicesPerSource) {
      let oldest: SynthVoice | undefined;
      for (const tracked of voicesOfSource) {
        if (tracked === voice) continue;
        if (tracked.startTime > now) continue;
        if (tracked.releaseScheduledAt !== undefined) continue;
        if (!oldest || tracked.startTime < oldest.startTime) oldest = tracked;
      }
      if (oldest) {
        // releaseVoice() does NOT set releaseScheduledAt — verified against
        // engine.ts: the only writers are triggerSynthNoteOff (:735),
        // silenceVoiceNow (:903) and releaseSoundingVoices (:959). Mark it
        // here, or the `releaseScheduledAt !== undefined` guard three lines
        // up never excludes a voice this loop just stole, and the SAME voice
        // is re-stolen on every note-on over the cap while newer voices run
        // free. This is also what the test below asserts.
        oldest.releaseScheduledAt = now;
        oldest.releaseTime = 0.02;
        this.releaseVoice(oldest, 0.02, now);
      }
    }
  }
  ```

- [ ] **Step 5: Run the tests, confirm pass**

  Run: `bun test src/audio/engine.test.ts -t "voice cap"`
  Expected: PASS (all three).

- [ ] **Step 6: Run the full engine suite + type-check**

  Run: `bun test src/audio/engine.test.ts` then `bun run lint`
  Expected: both green. In particular re-check `describe('bass retrigger', ...)` and `describe('scheduled same-note dedup', ...)`, which also drive many `triggerSynthNoteOn` calls on the same source — with the default cap of 24 none of them come close to tripping it, but confirm by reading their voice counts if either fails.

- [ ] **Step 7: Commit**

  ```bash
  git add src/audio/engine.ts src/audio/engine.test.ts
  git commit -m "fix(audio): cap live voices per source and steal the oldest on overflow

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: Release all held notes on window blur and visibilitychange

Cmd-Tab, alt-tab, or an OS-level dialog steals the `keyup` that would have released a held QWERTY note — `useInputDeck.ts`'s `window.addEventListener('keydown'/'keyup', ...)` effect has no `blur` or `visibilitychange` handler, so the note drones until the exact same key is pressed again (the same-note dedup in `triggerSynthNoteOn`).

**Files:**
- Modify: `src/components/useInputDeck.ts:42-46` (the exported helper; its closing `}` is `:46`, not `:45`) and `:239-308` (the QWERTY note-keyboard effect — the new effect goes immediately after its closing `]);` at `:308`, **not** `:333`, which is inside the drum-pad effect at `:323-335`)
- Test: `src/components/useInputDeck.test.tsx`

**Interfaces:**
- Consumes: `notesToReleaseOnKeyboardModeChange` (already exported at `useInputDeck.ts:42`), `arpStateRef`, `handleNoteOffRef` (already defined in the hook).
- Produces: `releaseAllHeldNotes(heldNotes: Iterable<string>, releaseNote: (note: string) => void): void`, exported from `useInputDeck.ts`. No change to `useInputDeck()`'s return shape.

- [ ] **Step 1: Write the failing test**

  In `src/components/useInputDeck.test.tsx`, add the import and a new `describe` block:

  ```ts
  import {
    useInputDeck,
    notesToReleaseOnKeyboardModeChange,
    releaseAllHeldNotes,
  } from './useInputDeck';
  ```

  ```ts
  describe('releaseAllHeldNotes', () => {
    test('calls the release callback once per held note, in order', () => {
      const released: string[] = [];
      releaseAllHeldNotes(new Set(['C4', 'E4', 'G4']), (n) => released.push(n));
      expect(released).toEqual(['C4', 'E4', 'G4']);
    });

    test('calls the release callback zero times when nothing is held', () => {
      const released: string[] = [];
      releaseAllHeldNotes([], (n) => released.push(n));
      expect(released).toEqual([]);
    });

    test('deduplicates a note passed twice', () => {
      const released: string[] = [];
      releaseAllHeldNotes(['C4', 'C4'], (n) => released.push(n));
      expect(released).toEqual(['C4']);
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails**

  Run: `bun test src/components/useInputDeck.test.tsx -t "releaseAllHeldNotes"`
  Expected: FAIL — `releaseAllHeldNotes` is not exported.

- [ ] **Step 3: Add the pure helper**

  In `src/components/useInputDeck.ts`, immediately after `notesToReleaseOnKeyboardModeChange`'s closing `}` — that brace is **line 46**; line 45 is its `return Array.from(...)` statement:

  ```ts

  // Releases every note currently reported as held, via the given release
  // callback. Shared by the keyboard-mode-change cleanup effect above and the
  // window-blur / visibilitychange backstop below — a held note must never
  // survive losing keyboard focus (Cmd-Tab, alt-tab, an OS dialog stealing
  // the keyup) or its voice drones until the exact same key is pressed again.
  export function releaseAllHeldNotes(
    heldNotes: Iterable<string>,
    releaseNote: (note: string) => void,
  ): void {
    notesToReleaseOnKeyboardModeChange(heldNotes).forEach(releaseNote);
  }
  ```

- [ ] **Step 4: Run the pure test, confirm pass**

  Run: `bun test src/components/useInputDeck.test.tsx -t "releaseAllHeldNotes"`
  Expected: PASS (all three).

- [ ] **Step 5: Wire the effect**

  In `src/components/useInputDeck.ts`, immediately after the QWERTY note-keyboard effect's closing `]);` — **line 308** pre-branch, **line 320** after Step 3's 12-line insert above it. (Line 333 is inside the *drum-pad* effect, `:323-335`; putting the new effect there would nest it wrongly.) Add a new effect:

  ```ts

  // Cmd-Tab / alt-tab / an OS-level dialog steals the keyup that would have
  // released a held note — window blur and visibilitychange (tab hidden) are
  // the only two signals a page gets for "the user is no longer interacting
  // with this tab", so both release every held note. Reads activeNotes from
  // the ref (not the closed-over activeNotes state) for the same reason
  // handleNoteOn/handleNoteOff already do — see the comment above arpStateRef.
  useEffect(() => {
    const releaseHeld = () => {
      releaseAllHeldNotes(arpStateRef.current.activeNotes, handleNoteOffRef.current);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) releaseHeld();
    };
    window.addEventListener('blur', releaseHeld);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('blur', releaseHeld);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
  ```

  `handleNoteOffRef` is already defined and kept fresh every render earlier in the hook (the ref backing the mode-change cleanup effect), so this effect needs no dependency beyond `[]`.

- [ ] **Step 6: Run lint + full test file**

  Run: `bun run lint` then `bun test src/components/useInputDeck.test.tsx`
  Expected: both green.

- [ ] **Step 7: Manual verification**

  1. Run `bun run dev` and open the app in Chrome.
  2. Click into the page once (to create the `AudioContext`), then go to the Synth tab.
  3. Press and hold the `A` key (plays the default scale-locked/chromatic root note) without releasing it.
  4. While still physically holding `A`, press `Cmd+Tab` (macOS) or `Alt+Tab` (Windows/Linux) to switch to another application, wait one second, then switch back and release the `A` key.
  5. Expected: the note stops sounding at the moment you Cmd-Tab away (the `blur` handler fires immediately), not when you later release the key. Before this fix, the note would keep sounding after you return, because the browser never delivered the `keyup`.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/useInputDeck.ts src/components/useInputDeck.test.tsx
  git commit -m "fix(ui): release held keyboard notes on window blur and tab hide

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: Bind `onTouchCancel` to the same release path as `onTouchEnd`

An OS-interrupted touch (incoming call, a system gesture takeover) fires `touchcancel`, not `touchend` — every touch-playable key in `Keyboard.tsx` binds `onTouchEnd` but not `onTouchCancel`, so an interrupted touch leaves the note stuck on. `KeyCap` (used by `ScaleLockedKey` and `ChordRowButton`, i.e. scale-locked mode and chord mode) and `ChromaticKeyboard`'s two inline button blocks (chromatic mode, black and white keys) are the three touch-bound render sites in the file.

**Files:**
- Modify: `src/components/ui/Keyboard.tsx:196` (`KeyCap`), `src/components/ui/Keyboard.tsx:507` and `:556` (`ChromaticKeyboard`'s black/white key blocks)
- Test: `src/components/ui/Keyboard.test.ts` (or a new co-located test — see Step 1)

**Interfaces:**
- Consumes: nothing new — `onPress`/`onRelease` (`KeyCap`) and `onNoteOn`/`onNoteOff` (`ChromaticKeyboard`) are existing props.
- Produces: no new exports. `KeyCap` and `ChromaticKeyboard`'s prop signatures are unchanged.

- [ ] **Step 1: Write the failing/pinning test**

  This is a pure React-shape fix (an added event-handler prop never appears in server-rendered HTML) with no extractable logic core — `onTouchCancel` calls the exact same function reference as `onTouchEnd`. The proof is a byte-identical `renderToString` snapshot (so a future edit can't silently change the markup) plus a manual verification step, per this plan's testing strategy. Add to `src/components/ui/Keyboard.test.ts`:

  ```ts
  import { renderToString } from 'react-dom/server';
  import { KeyCap, ChromaticKeyboard } from './Keyboard';

  // djb2 — kept tiny so a 7 KB rendered string doesn't have to be pasted
  // literally; still catches any markup byte the touch-handler change might
  // accidentally introduce (React never serializes event handlers to HTML,
  // so this specifically pins "no other markup moved").
  function djb2(s: string): number {
    let hash = 5381;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  describe('touch handlers do not change rendered markup', () => {
    test('KeyCap renders byte-identically with onTouchCancel added', () => {
      const html = renderToString(
        <KeyCap
          id="key-test"
          ariaLabel="C4"
          isActive={false}
          label="C"
          shortcutKey="KeyA"
          onPress={() => {}}
          onRelease={() => {}}
        />,
      );
      expect(html).toBe(
        '<button type="button" id="key-test" aria-label="C4" aria-pressed="false" ' +
        'class="w-12 h-19.5 rounded-b-field border border-base-300 cursor-pointer ' +
        'flex flex-col justify-end pb-2 items-center transition-all select-none ' +
        'bg-key-white text-key-white-content hover:brightness-105">' +
        '<span class="text-[10px] font-mono font-bold">C</span>' +
        '<kbd class="kbd-key">A</kbd></button>',
      );
    });

    test('ChromaticKeyboard renders byte-identically with onTouchCancel added', () => {
      const html = renderToString(
        <ChromaticKeyboard
          octaveOffset={0}
          activeNotes={new Set()}
          onNoteOn={() => {}}
          onNoteOff={() => {}}
        />,
      );
      expect(html.length).toBe(7062);
      expect(djb2(html)).toBe(596260183);
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it currently passes (this is the pre-change baseline)**

  Run: `bun test src/components/ui/Keyboard.test.ts -t "touch handlers do not change rendered markup"`
  Expected: PASS — these values were captured from the CURRENT (pre-fix) code, proving the fix must not move a single byte of markup.

- [ ] **Step 3: Add `onTouchCancel` to `KeyCap`**

  In `src/components/ui/Keyboard.tsx`, immediately after the existing `onTouchEnd` handler (line 196-199):

  ```tsx
      onTouchEnd={(e) => {
        e.preventDefault();
        onRelease();
      }}
      onTouchCancel={onRelease}
  ```

- [ ] **Step 4: Add `onTouchCancel` to both `ChromaticKeyboard` button blocks**

  In the black-key block (after the `onTouchEnd` handler at line 507-510):

  ```tsx
              onTouchEnd={(e) => {
                e.preventDefault();
                onNoteOff(k.note);
              }}
              onTouchCancel={() => onNoteOff(k.note)}
  ```

  And in the white-key block (after the `onTouchEnd` handler at line 556-559):

  ```tsx
            onTouchEnd={(e) => {
              e.preventDefault();
              onNoteOff(k.note);
            }}
            onTouchCancel={() => onNoteOff(k.note)}
  ```

- [ ] **Step 5: Re-run the pinning tests, confirm they still pass**

  Run: `bun test src/components/ui/Keyboard.test.ts -t "touch handlers do not change rendered markup"`
  Expected: PASS — identical hash/length, proving the added handler changed no rendered markup.

- [ ] **Step 6: Run the full file + lint**

  Run: `bun test src/components/ui/Keyboard.test.ts` then `bun run lint`
  Expected: both green.

- [ ] **Step 7: Manual verification**

  Real `touchcancel` events require either a physical touchscreen or Chrome DevTools' touch emulation plus a script-dispatched event (DevTools' device toolbar alone cannot trigger a cancel). Verify by device if available:
  1. On a touchscreen device, open the app, go to the Synth tab, switch keyboard mode to Chord.
  2. Press and hold a chord button with a finger, then — while still touching — swipe down from the top edge to trigger the OS notification shade (iOS/Android both fire `touchcancel` on the in-progress touch when this happens).
  3. Expected: the chord's notes stop sounding immediately when the gesture takeover begins, not only when you eventually lift your finger elsewhere. Before this fix, the notes would keep sounding because no `touchend` is ever delivered to an interrupted touch.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/ui/Keyboard.tsx src/components/ui/Keyboard.test.ts
  git commit -m "fix(ui): release touch-held notes on touchcancel, not only touchend

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: Flush held notes when a MIDI device disappears

`midiInput.ts`'s `access.onstatechange` handler only re-binds `onmidimessage` to whatever inputs currently exist (`setupInputs`); it never notices that an input which had notes on has disappeared, so those notes drone forever (no dedup path recovers them, since the exact key can no longer be pressed on a device that no longer exists).

**Files:**
- Modify: `src/store/midiInput.ts:1-125` (add held-note tracking + a disconnect flush)
- Create: `src/store/midiInput.test.ts`

**Interfaces:**
- Consumes: `audioEngine.triggerSynthNoteOff` (already imported).
- Produces: `computeDisconnectedInputIds(previousIds: readonly string[], currentIds: readonly string[]): string[]` and `createHeldNoteTracker(): { noteOn(inputId, note), noteOff(inputId, note), release(inputId): string[] }`, both exported from `midiInput.ts`. No change to `startMidiInputBridge()`'s signature.

- [ ] **Step 1: Write the failing tests**

  Create `src/store/midiInput.test.ts`:

  ```ts
  import { describe, expect, test } from 'bun:test';
  import { computeDisconnectedInputIds, createHeldNoteTracker } from './midiInput';

  describe('computeDisconnectedInputIds', () => {
    test('returns ids present before but missing now', () => {
      expect(computeDisconnectedInputIds(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
    });

    test('returns an empty list when nothing disappeared', () => {
      expect(computeDisconnectedInputIds(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
    });

    test('returns an empty list on the first enumeration', () => {
      expect(computeDisconnectedInputIds([], ['a', 'b'])).toEqual([]);
    });
  });

  describe('createHeldNoteTracker', () => {
    test('release returns every note currently on for that input and clears it', () => {
      const tracker = createHeldNoteTracker();
      tracker.noteOn('dev-1', 'C4');
      tracker.noteOn('dev-1', 'E4');
      tracker.noteOn('dev-2', 'G3');

      expect(tracker.release('dev-1').sort()).toEqual(['C4', 'E4']);
      expect(tracker.release('dev-1')).toEqual([]);
      expect(tracker.release('dev-2')).toEqual(['G3']);
    });

    test('noteOff removes a note before it would be released', () => {
      const tracker = createHeldNoteTracker();
      tracker.noteOn('dev-1', 'C4');
      tracker.noteOff('dev-1', 'C4');

      expect(tracker.release('dev-1')).toEqual([]);
    });

    test('release on an unknown input id is a no-op', () => {
      const tracker = createHeldNoteTracker();
      expect(tracker.release('missing')).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails**

  Run: `bun test src/store/midiInput.test.ts`
  Expected: FAIL — `computeDisconnectedInputIds` and `createHeldNoteTracker` are not exported (module doesn't exist under those names yet).

- [ ] **Step 3: Add the pure helpers and module state**

  In `src/store/midiInput.ts`, immediately after `let started = false;`:

  ```ts

  // Diffs two id lists and returns the ones that dropped out. Pure so the
  // device-disconnect trigger below is unit-testable without a real
  // MIDIAccess object.
  export function computeDisconnectedInputIds(
    previousIds: readonly string[],
    currentIds: readonly string[],
  ): string[] {
    const current = new Set(currentIds);
    return previousIds.filter((id) => !current.has(id));
  }

  // Tracks which notes are currently on, per input device id, so a device
  // that disappears mid-note (unplugged, put to sleep, a USB hub dropping
  // out) can have its stuck notes released even though its note-off will
  // never arrive.
  export function createHeldNoteTracker() {
    const notesByInput = new Map<string, Set<string>>();
    return {
      noteOn(inputId: string, note: string): void {
        let set = notesByInput.get(inputId);
        if (!set) {
          set = new Set();
          notesByInput.set(inputId, set);
        }
        set.add(note);
      },
      noteOff(inputId: string, note: string): void {
        notesByInput.get(inputId)?.delete(note);
      },
      release(inputId: string): string[] {
        const set = notesByInput.get(inputId);
        if (!set) return [];
        const notes = Array.from(set);
        notesByInput.delete(inputId);
        return notes;
      },
    };
  }

  const heldNotes = createHeldNoteTracker();
  let knownInputIds: string[] = [];
  ```

- [ ] **Step 4: Run the pure tests, confirm pass**

  Run: `bun test src/store/midiInput.test.ts`
  Expected: PASS (all six).

- [ ] **Step 5: Track held notes in `handleMessage`**

  In `src/store/midiInput.ts`, the note on/off branch currently reads (inside `handleMessage`):

  ```ts
        if (command === 0x90 || command === 0x80) {
          const noteMapping = mappings.find((m) => m.enabled && m.type === 'note');
          if (noteMapping) {
            const noteName = Note.fromMidi(data1);
            if (!noteName) return;
            const params = s.synthParams;
            const velocity = data2;
            if (command === 0x90 && velocity > 0) {
              audioEngine.triggerSynthNoteOn(noteName, params, velocity / 127, undefined, 'synth', 1);
            } else {
              audioEngine.triggerSynthNoteOff(noteName, 0.3, undefined, 'synth');
            }
          }
        } else if (command === 0xB0) {
  ```

  Replace it with (adding the two `heldNotes` calls and the `inputId` local):

  ```ts
        if (command === 0x90 || command === 0x80) {
          const noteMapping = mappings.find((m) => m.enabled && m.type === 'note');
          if (noteMapping) {
            const noteName = Note.fromMidi(data1);
            if (!noteName) return;
            const params = s.synthParams;
            const velocity = data2;
            const inputId = sourceInput?.id ?? '';
            if (command === 0x90 && velocity > 0) {
              heldNotes.noteOn(inputId, noteName);
              audioEngine.triggerSynthNoteOn(noteName, params, velocity / 127, undefined, 'synth', 1);
            } else {
              heldNotes.noteOff(inputId, noteName);
              audioEngine.triggerSynthNoteOff(noteName, 0.3, undefined, 'synth');
            }
          }
        } else if (command === 0xB0) {
  ```

  (`sourceInput` is already defined earlier in `handleMessage` as `const sourceInput = event.target as MIDIInput | null;`.)

- [ ] **Step 6: Flush on disconnect in `setupInputs`**

  Currently:

  ```ts
      const setupInputs = (acc: MIDIAccess) => {
        for (const input of acc.inputs.values()) {
          input.onmidimessage = handleMessage;
        }
      };

      setupInputs(access);
      access.onstatechange = () => {
        setupInputs(access);
      };
  ```

  Replace with:

  ```ts
      const setupInputs = (acc: MIDIAccess) => {
        const currentIds: string[] = [];
        for (const input of acc.inputs.values()) {
          input.onmidimessage = handleMessage;
          currentIds.push(input.id);
        }
        // Any id known before this call but missing from the fresh
        // enumeration just disappeared — flush whatever notes it left on, or
        // they drone until the same key/pad is pressed again on a device
        // that no longer exists to press it.
        for (const goneId of computeDisconnectedInputIds(knownInputIds, currentIds)) {
          heldNotes.release(goneId).forEach((note) => {
            audioEngine.triggerSynthNoteOff(note, 0.05, undefined, 'synth');
          });
        }
        knownInputIds = currentIds;
      };

      setupInputs(access);
      access.onstatechange = () => {
        setupInputs(access);
      };
  ```

- [ ] **Step 7: Run lint + full test file**

  Run: `bun run lint` then `bun test src/store/midiInput.test.ts`
  Expected: both green.

- [ ] **Step 8: Run `bun run eslint`**

  Run: `bun run eslint`
  Expected: green — `midiInput.ts` already imports `audioEngine` from `../audio/engine`, which is allowed (`store/` may import `audio/`); no new import was added.

- [ ] **Step 9: Commit**

  ```bash
  git add src/store/midiInput.ts src/store/midiInput.test.ts
  git commit -m "fix(midi): release held notes when their input device disconnects

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 7: `useMemo` the dnd-kit `items` array in `ChordView`

`ChordView.tsx:1101` passes `items={chords.map((c) => c.id)}` — a fresh array every render — as `SortableContext`'s `items` prop. dnd-kit's `contextValue` lists `items` in its dependency array, so this fresh identity defeats `React.memo` on every `SortableChordCard`, which then re-renders 8×/sec during chord playback (`currentStep` changes) even though only one card's `activeBeat` actually changes.

**Files:**
- Modify: `src/components/loop/ChordView.tsx:247` (add the memo), `:1101` (use it)
- Test: `src/components/loop/ChordView.test.tsx`

**Interfaces:**
- Consumes: `chords` (already destructured from the store at `ChordView.tsx:201`).
- Produces: no new exports, but **+7 lines of line drift for every later task that cites `ChordView.tsx`**: Step 3 inserts 1 blank + 5 comment + 1 code line at `:248`, so every ChordView citation at or below `:248` in Tasks 18, 32 and 34 is quoted there as pre-branch `+7`. `ArrangeView.tsx:94` already does `const loopIds = useMemo(() => loops.map((l) => l.id), [loops]);` for the identical pattern — verified by reading; **no change needed there** for *this* defect (Task 38 later fixes a different one: the `loops` array identity itself). `SortableLoopCard.tsx` does not construct a `SortableContext` `items` array at all (it only consumes `useSortable()`), so it is also unaffected — verified by reading, not assumed.

- [ ] **Step 1: Write the pinning test**

  `ChordView.test.tsx` already renders `<ChordView />` via `renderToString` in several `describe` blocks (e.g. `'ChordView preview UI'`). Add a new block asserting the default-state render is byte-identical before and after this purely-identity-stabilising change:

  ```ts
  function djb2(s: string): number {
    let hash = 5381;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  describe('ChordView renders byte-identically with a memoized chordIds array', () => {
    test('default store snapshot', () => {
      const html = renderToString(<ChordView />);
      expect(html.length).toBe(58524);
      expect(djb2(html)).toBe(1897604956);
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it currently passes (pre-change baseline)**

  Run: `bun test src/components/loop/ChordView.test.tsx -t "renders byte-identically"`
  Expected: PASS — captured from the current code; a pure `useMemo` wrap around an existing `.map()` call cannot change any rendered attribute.

- [ ] **Step 3: Add the memo**

  In `src/components/loop/ChordView.tsx`, immediately after the existing `chordCells` memo (line 247):

  ```ts
  const chordCells = useMemo(() => stepCells(getMeter(meterId)), [meterId]);

  // Stable identity so SortableContext's contextValue (which lists `items` in
  // its own dep array) doesn't change on every render — an inline
  // chords.map() here defeats React.memo on every SortableChordCard, which
  // otherwise correctly bails out on the 8×/sec currentStep churn. Same
  // pattern as ArrangeView.tsx's loopIds.
  const chordIds = useMemo(() => chords.map((c) => c.id), [chords]);
  ```

- [ ] **Step 4: Use it at the `SortableContext`**

  At line 1101, change:

  ```tsx
          <SortableContext
            items={chords.map((c) => c.id)}
            strategy={rectSortingStrategy}
          >
  ```

  to:

  ```tsx
          <SortableContext
            items={chordIds}
            strategy={rectSortingStrategy}
          >
  ```

- [ ] **Step 5: Re-run the pinning test, confirm it still passes**

  Run: `bun test src/components/loop/ChordView.test.tsx -t "renders byte-identically"`
  Expected: PASS — identical hash/length.

- [ ] **Step 6: Run the full file + lint**

  Run: `bun test src/components/loop/ChordView.test.tsx` then `bun run lint`
  Expected: both green.

- [ ] **Step 7: Manual verification**

  1. Run `bun run dev`, open the app, click once to init audio.
  2. Go to the Chords tab with the default 4-chord progression (or add a few chords so there are at least 4).
  3. Open React DevTools → Profiler tab → click the gear icon → check "Record why each component rendered".
  4. Start recording, press Play, let 3 seconds of playback run, stop recording.
  5. In the flamegraph, select a commit from the middle of the recording and expand the chord-card list. Expected: only the chord card whose beat is currently active shows up as re-rendered in that commit; the other cards show as bailed out (not present in that commit's flamegraph, or greyed out if "Record why" surfaces them as skipped). Before this fix, every chord card re-rendered on every commit because `SortableContext`'s context value changed on every `ChordView` render.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/loop/ChordView.tsx src/components/loop/ChordView.test.tsx
  git commit -m "perf(chords): memoize the sortable chord-id array to restore card memoization

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 8: `useMemo` `keyboardProps` / `drumProps` in `useInputDeck`

`useInputDeck()` currently returns two fresh object literals every render (`keyboardProps`, `drumProps`). Since `useInputDeck` is called once in `App`, this permanently defeats any `React.memo` wrapper later added to `BottomInputDock`, `LoopPage`, or `SequencerView` (the three consumers), regardless of whether their other props are stable.

**Files:**
- Modify: `src/components/useInputDeck.ts` — the return block only: pre-branch `:341-362`, **`:374-395` after Task 4** (which inserts 12 lines after `:46` and 21 after `:308`, both above this block: +33). The react import at `:1` needs **no change** — it already reads `import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`.
- Test: `src/components/useInputDeck.test.tsx`

**Interfaces:**
- Consumes: **Task 4's line shift** — its helper insert after `:46` and its blur/visibilitychange effect after `:308` put +33 lines above the return block, so the block this task replaces is at `:374-395`. Task 4's `releaseAllHeldNotes` is module-level and is not a field of either props object, so neither dependency array changes because of it. Also every field already destructured/computed in the hook body (`keyboardMode`, `setKeyboardMode`, `keyboardOctave`, `setKeyboardOctave`, `activeNotes`, `scaleRoot`, `scaleType`, `scaleLockedRows`, `chordKeyboardRows`, `handleNoteOn`, `handleNoteOff`, `pads`, `activePadId`, `triggerPad`, `handlePadVolumeChange`).
- Produces: `useInputDeck()`'s return shape (`{ keyboardProps: InputDeckKeyboardProps; drumProps: InputDeckDrumProps }`) is **unchanged** — only the object identities become stable across renders where none of the constituent fields changed.

- [ ] **Step 1: Write the pinning test**

  `useInputDeck.test.tsx` already has a `Probe` component that calls `useInputDeck()` and captures the result. This is a pure React-shape fix with no extractable logic core (wrapping an existing return value in `useMemo` changes no field, only identity across renders — and `renderToString` only ever renders once, so it cannot observe identity across renders either). Add a shape-equality test as the "output unchanged" half of the proof:

  ```ts
  test('keyboardProps and drumProps still carry every field after memoizing', () => {
    renderToString(<Probe />);
    expect(Object.keys(captured!.keyboardProps).sort()).toEqual([
      'activeNotes', 'chordKeyboardRows', 'handleNoteOff', 'handleNoteOn',
      'keyboardMode', 'keyboardOctave', 'scaleLockedRows', 'scaleRoot',
      'scaleType', 'setKeyboardMode', 'setKeyboardOctave',
    ]);
    expect(Object.keys(captured!.drumProps).sort()).toEqual([
      'activePadId', 'onPadVolumeChange', 'onTriggerPad', 'pads',
    ]);
  });
  ```

- [ ] **Step 2: Run it, confirm it currently passes (pre-change baseline)**

  Run: `bun test src/components/useInputDeck.test.tsx -t "still carry every field"`
  Expected: PASS — this pins the field set so the `useMemo` refactor cannot silently drop or rename one.

- [ ] **Step 3: Verify the import — no edit expected**

  `useMemo` is **already imported**; the four existing memos in this file (`:215`, `:223`, `:228`, `:233`) need it. Confirm line 1 matches the line below and make **no edit**:

  ```ts
  import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
  ```

- [ ] **Step 4: Memoize the return object**

  Replace the current return block — pre-branch lines 341-362, **lines 374-395 after Task 4's +33**:

  ```ts
    return {
      keyboardProps: {
        keyboardMode,
        setKeyboardMode,
        keyboardOctave,
        setKeyboardOctave,
        activeNotes,
        scaleRoot,
        scaleType,
        scaleLockedRows,
        chordKeyboardRows,
        handleNoteOn,
        handleNoteOff,
      },
      drumProps: {
        pads,
        activePadId,
        onTriggerPad: triggerPad,
        onPadVolumeChange: handlePadVolumeChange,
      },
    };
  }
  ```

  with:

  ```ts
    const keyboardProps = useMemo<InputDeckKeyboardProps>(
      () => ({
        keyboardMode,
        setKeyboardMode,
        keyboardOctave,
        setKeyboardOctave,
        activeNotes,
        scaleRoot,
        scaleType,
        scaleLockedRows,
        chordKeyboardRows,
        handleNoteOn,
        handleNoteOff,
      }),
      [
        keyboardMode,
        setKeyboardMode,
        keyboardOctave,
        setKeyboardOctave,
        activeNotes,
        scaleRoot,
        scaleType,
        scaleLockedRows,
        chordKeyboardRows,
        handleNoteOn,
        handleNoteOff,
      ],
    );

    const drumProps = useMemo<InputDeckDrumProps>(
      () => ({
        pads,
        activePadId,
        onTriggerPad: triggerPad,
        onPadVolumeChange: handlePadVolumeChange,
      }),
      [pads, activePadId, triggerPad, handlePadVolumeChange],
    );

    return { keyboardProps, drumProps };
  }
  ```

- [ ] **Step 5: Re-run the pinning test + full file, confirm pass**

  Run: `bun test src/components/useInputDeck.test.tsx`
  Expected: all PASS, including the pre-existing tests that read `captured!.keyboardProps.*` / `captured!.drumProps.*` — field values are identical, only the wrapping object's identity changed, which `renderToString` (a single render) cannot observe either way.

- [ ] **Step 6: Run lint**

  Run: `bun run lint`
  Expected: green.

- [ ] **Step 7: Manual verification**

  1. Run `bun run dev`, open the app, click once to init audio.
  2. Open React DevTools → Components tab → find `BottomInputDock` in the tree → click the eye icon ("Inspect DOM element") is not needed; instead enable Profiler → gear icon → check "Highlight updates when components render".
  3. Go to the Synth tab, start dragging the Filter Cutoff knob continuously for 3 seconds while watching the highlight overlay on the bottom input dock (the keyboard/drum-pad area).
  4. Expected: the dock **still flashes** at this commit, and that is correct — `BottomInputDock` has no `React.memo` yet (Task 37) and `useInputDeck` still selects the whole `synthParams` object at App level (Task 11). Do not record this step as a failure. What it verifies is only the precondition for those two: React DevTools' "why did this render" for `BottomInputDock` must no longer name `keyboardProps` or `drumProps` as changed props, because none of their constituent fields changes from a filter-cutoff edit. If either still shows as changed, this task's `useMemo` dependency arrays are wrong and must be fixed before moving on.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/useInputDeck.ts src/components/useInputDeck.test.tsx
  git commit -m "perf(input): memoize keyboardProps and drumProps to enable downstream memoization

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 9: `useMemo` `getChromaticKeyboardNotes`

`ChromaticKeyboard` calls `getChromaticKeyboardNotes(octaveOffset)` inline in its render body (`Keyboard.tsx:478`); the function does a regex match, `parseInt`, and an object spread per key (25 keys). Combined with pointer-rate re-renders from other fixes in this plan, this ran at up to 60-120 Hz whenever the input dock was open.

**Files:**
- Modify: `src/components/ui/Keyboard.tsx:1` (add `useMemo` to the react import), `:478` (wrap the call)
- Test: `src/components/ui/Keyboard.test.ts`

**Interfaces:**
- Consumes: `getChromaticKeyboardNotes` (already defined and exported in the same file, at line 594).
- Produces: no new exports; `ChromaticKeyboard`'s props and rendered output are unchanged.

- [ ] **Step 1: Write a determinism test for the memoized function's input**

  `useMemo`'s safety depends on `getChromaticKeyboardNotes` being a pure function of `octaveOffset` alone. Pin that first, since it is the extractable core this fix leans on. Add to `src/components/ui/Keyboard.test.ts`:

  ```ts
  import { getChromaticKeyboardNotes } from './Keyboard';

  describe('getChromaticKeyboardNotes', () => {
    test('is deterministic for a given octaveOffset', () => {
      expect(getChromaticKeyboardNotes(1)).toEqual(getChromaticKeyboardNotes(1));
    });

    test('shifts every note name by the given octave offset', () => {
      const base = getChromaticKeyboardNotes(0);
      const shifted = getChromaticKeyboardNotes(2);
      expect(shifted.map((k) => k.note)).toEqual(
        base.map((k) => {
          const match = k.note.match(/^([A-G][#b]?)(-?\d+)/)!;
          return `${match[1]}${parseInt(match[2], 10) + 2}`;
        }),
      );
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it currently passes**

  Run: `bun test src/components/ui/Keyboard.test.ts -t "getChromaticKeyboardNotes"`
  Expected: PASS — `getChromaticKeyboardNotes` is already pure; this pins that fact so the `useMemo` dependency array (`[octaveOffset]`) is provably safe.

- [ ] **Step 3: Write the rendered-output pinning test**

  This reuses the same hash captured in Task 5 (the value is unaffected by that task's `onTouchCancel` addition, since neither change touches markup):

  ```ts
  describe('ChromaticKeyboard renders byte-identically once getChromaticKeyboardNotes is memoized', () => {
    test('default octave, no active notes', () => {
      const html = renderToString(
        <ChromaticKeyboard
          octaveOffset={0}
          activeNotes={new Set()}
          onNoteOn={() => {}}
          onNoteOff={() => {}}
        />,
      );
      expect(html.length).toBe(7062);
    });
  });
  ```

  (If Task 5 already added a `ChromaticKeyboard` hash test to this file, skip re-adding the `describe` block and instead confirm that test's expected values are unchanged by this task — they are, since `useMemo` does not alter output.)

- [ ] **Step 4: Add `useMemo` to the import**

  In `src/components/ui/Keyboard.tsx`, line 1:

  ```ts
  import { useMemo, useRef } from 'react';
  ```

- [ ] **Step 5: Wrap the call**

  In `ChromaticKeyboard` (currently line 478), change:

  ```tsx
  export function ChromaticKeyboard({
    octaveOffset,
    activeNotes,
    onNoteOn,
    onNoteOff,
  }: {
    octaveOffset: number;
    activeNotes: Set<string>;
    onNoteOn: (note: string) => void;
    onNoteOff: (note: string) => void;
  }) {
    return (
      <div className="relative flex">
        {getChromaticKeyboardNotes(octaveOffset).map((k, noteIndex) => {
  ```

  to:

  ```tsx
  export function ChromaticKeyboard({
    octaveOffset,
    activeNotes,
    onNoteOn,
    onNoteOff,
  }: {
    octaveOffset: number;
    activeNotes: Set<string>;
    onNoteOn: (note: string) => void;
    onNoteOff: (note: string) => void;
  }) {
    const notes = useMemo(() => getChromaticKeyboardNotes(octaveOffset), [octaveOffset]);
    return (
      <div className="relative flex">
        {notes.map((k, noteIndex) => {
  ```

- [ ] **Step 6: Re-run the pinning tests, confirm pass**

  Run: `bun test src/components/ui/Keyboard.test.ts`
  Expected: all PASS, including the new determinism tests and the unchanged rendered-length assertion.

- [ ] **Step 7: Run lint**

  Run: `bun run lint`
  Expected: green.

- [ ] **Step 8: Manual verification**

  1. Run `bun run dev`, open the app, switch keyboard mode to Chromatic.
  2. Open React DevTools → Profiler → gear icon → check "Record why each component rendered".
  3. Start recording, hold down a note key for 2 seconds (this re-renders `App`/`ChromaticKeyboard` via `activeNotes` changing, independent of the fixes in this plan), stop recording.
  4. Select a commit in which `ChromaticKeyboard` re-rendered. Expected: the "Why did this render" panel does not list a new `notes` array as a prop/state change reason on renders where `octaveOffset` did not change — `getChromaticKeyboardNotes` is no longer recomputed on every such render.

- [ ] **Step 9: Commit**

  ```bash
  git add src/components/ui/Keyboard.tsx src/components/ui/Keyboard.test.ts
  git commit -m "perf(keyboard): memoize the chromatic note table on octaveOffset

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 10: Skip building footer markup while the preset-library drawers are closed

`ChordPresetLibrary` and `SynthPresetLibrary` receive `isOpen` but build their `footer` JSX unconditionally, every render, before handing off to the generic `PresetLibrary`, which is the component that actually bails out (`PresetLibrary.tsx:581`, `if (!isOpen) return null;`). Both wrappers' `entries`/`categories` lists are already correctly memoized; `footer` is the one piece of JSX built eagerly (not inside a function) on every render regardless of `isOpen`.

Note: the literal fix the audit suggests — an early `if (!isOpen) return null;` at the top of each wrapper, before `<PresetLibrary>` is rendered — would be a regression. `PresetLibrary` (`ui/PresetLibrary.tsx:550-553`) holds its own `useState` for `query`, `category`, `showSave`, and `draft`; today it stays mounted continuously (its own `if (!isOpen) return null` only skips its *output*, not its *instance*), so a user's typed search text or open save-form state survives closing and reopening the drawer. If the wrapper stopped rendering `<PresetLibrary>` at all while closed, `PresetLibrary` would fully unmount and remount, silently resetting that state every time. This task instead guards only the expensive, eagerly-built `footer` value, which achieves the audit's actual performance goal (skip footer JSX construction while closed) with no behavior change.

**Files:**
- Modify: `src/components/loop/ChordPresetLibrary.tsx:446` (the `footer` declaration), `src/components/loop/SynthPresetLibrary.tsx:379` (the `footer` declaration)
- Test: `src/components/loop/ChordPresetLibrary.test.tsx`, `src/components/loop/SynthPresetLibrary.test.tsx`

**Interfaces:**
- Consumes: `isOpen` (already a prop on both components).
- Produces: no new exports; both components' rendered output is unchanged in every state that was already tested (both files' existing test suites render with `isOpen` true at module scope and must keep passing unmodified).

- [ ] **Step 1: Write the failing/pinning tests**

  In `src/components/loop/ChordPresetLibrary.test.tsx`, add:

  ```ts
  describe('ChordPresetLibrary closed', () => {
    test('renders nothing when isOpen is false', () => {
      const closedHtml = renderToString(
        <ChordPresetLibrary
          isOpen={false}
          onClose={noop}
          currentChords={[]}
          scaleRoot="C"
          scaleType="Major"
          autoReharmonize
          synthParams={INITIAL_SYNTH_PARAMS}
          onApplyChords={noop}
        />,
      );
      expect(closedHtml).toBe('');
    });
  });
  ```

  In `src/components/loop/SynthPresetLibrary.test.tsx`, add:

  ```ts
  describe('SynthPresetLibrary closed', () => {
    test('renders nothing when isOpen is false', () => {
      const closedHtml = renderToString(
        <SynthPresetLibrary
          isOpen={false}
          onClose={noop}
          currentParams={INITIAL_SYNTH_PARAMS}
          target="synth"
          onSelectPreset={noop}
        />,
      );
      expect(closedHtml).toBe('');
    });
  });
  ```

- [ ] **Step 2: Run them, confirm they currently pass (pre-change baseline)**

  Run: `bun test src/components/loop/ChordPresetLibrary.test.tsx -t "closed"` then `bun test src/components/loop/SynthPresetLibrary.test.tsx -t "closed"`
  Expected: both PASS already — `PresetLibrary` already bails to `null` when closed. This pins "closed renders nothing" as a regression guard for the footer-guard change about to be made, and for any future change to either wrapper.

- [ ] **Step 3: Guard `footer` in `ChordPresetLibrary`**

  In `src/components/loop/ChordPresetLibrary.tsx` (currently line 446), change:

  ```ts
    // PORT of the original footer (original lines ~504-530): labeled Export/Import
    // buttons + "{N} custom saved" counter.
    const footer = (
      <div className="p-3 border-t border-base-300 bg-base-200 flex items-center justify-between gap-2">
  ```

  to:

  ```ts
    // PORT of the original footer (original lines ~504-530): labeled Export/Import
    // buttons + "{N} custom saved" counter. Guarded on isOpen: PresetLibrary
    // itself bails to null while closed, but without this guard this ~10-node
    // tree was still built and discarded on every parent render regardless —
    // at pointer rate during a knob drag (App-level synthParams cascade) and
    // 8×/sec during chord playback (currentStep).
    const footer = !isOpen ? null : (
      <div className="p-3 border-t border-base-300 bg-base-200 flex items-center justify-between gap-2">
  ```

  and its closing `);` (currently line 462) is unchanged.

- [ ] **Step 4: Guard `footer` in `SynthPresetLibrary`**

  In `src/components/loop/SynthPresetLibrary.tsx` (currently line 379), change:

  ```ts
    const footer = (
      <div className="p-3 border-t border-base-300 bg-base-200 flex items-center justify-between text-[11px] text-base-content/60">
  ```

  to:

  ```ts
    // Guarded on isOpen for the same reason as ChordPresetLibrary's footer —
    // PresetLibrary bails to null while closed, but this JSX was still built
    // and discarded on every parent render without the guard.
    const footer = !isOpen ? null : (
      <div className="p-3 border-t border-base-300 bg-base-200 flex items-center justify-between text-[11px] text-base-content/60">
  ```

  and its closing `);` (currently line 388) is unchanged.

- [ ] **Step 5: Re-run the closed-state tests, confirm they still pass**

  Run: `bun test src/components/loop/ChordPresetLibrary.test.tsx -t "closed"` then `bun test src/components/loop/SynthPresetLibrary.test.tsx -t "closed"`
  Expected: both still PASS — `renderToString` output is `''` either way, since `PresetLibrary`'s own bail-out runs before `footer` (now `null` instead of a discarded element tree) would ever be used.

- [ ] **Step 6: Run both full test files (the existing open-state assertions must be untouched)**

  Run: `bun test src/components/loop/ChordPresetLibrary.test.tsx` then `bun test src/components/loop/SynthPresetLibrary.test.tsx`
  Expected: both green, including every pre-existing `describe('...theming', ...)` block, which renders with `isOpen` true at module scope — `footer` there evaluates to the exact same JSX as before (`!isOpen` is `false`, so the ternary's second branch runs unchanged).

- [ ] **Step 7: Run lint**

  Run: `bun run lint`
  Expected: green.

- [ ] **Step 8: Manual verification**

  1. Run `bun run dev`, open the app, click once to init audio, go to the Synth tab.
  2. Click "Browse Sounds" (or the equivalent button that opens `SynthPresetLibrary`), then close it again.
  3. Open React DevTools → Profiler → gear icon → check "Record why each component rendered".
  4. With the drawer closed, start recording, drag the Filter Cutoff knob for 3 seconds, stop recording.
  5. Expected: `SynthPresetLibrary` still appears in the flamegraph on every knob-driven `SynthView` re-render (its own `synthParams`/`customPresets` subscriptions are unrelated to this fix), but its committed render duration is smaller than before — the "footer" subtree is a `null` value rather than a freshly allocated `<div>` with a button, a label, and a file input inside it, on every one of those renders. This is a magnitude-of-work reduction, not a re-render-count reduction — the parent still re-renders; it just does less work per render while the drawer is closed.

- [ ] **Step 9: Commit**

  ```bash
  git add src/components/loop/ChordPresetLibrary.tsx src/components/loop/ChordPresetLibrary.test.tsx src/components/loop/SynthPresetLibrary.tsx src/components/loop/SynthPresetLibrary.test.tsx
  git commit -m "perf(presets): skip building footer markup while the library drawer is closed

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

### Task 11: Narrow `useInputDeck`'s App-level `synthParams` subscription to two primitives

`useInputDeck()` is called once, in `App` (`App.tsx:71`). Its line 83
(`const keyboardParams = useAppStore((s) => s.synthParams);`) subscribes `App` to the whole
`synthParams` object, which `synthSlice` replaces wholesale on every knob `pointermove`
(60–120 Hz). `App` re-renders, and because `LoopPage`, `SongPage`, `SynthView`,
`SequencerView`, `ArrangeView` and `BottomInputDock` are not memoized, all of them re-render
too — three of them on hidden tabs.

I verified every read of `keyboardParams` in the file before narrowing. There are exactly
five, and only two of them are reactive reads of a scalar:

| line | read | reactive? |
|---|---|---|
| `:99` | `params: keyboardParams` (ref initialiser) | no — ref only |
| `:106` | `params: keyboardParams` (unconditional per-commit effect) | no — ref only |
| `:177` | `useArpPlayback(arpStateRef, keyboardParams.arpActive)` | **yes**, scalar |
| `:207` / `:213` | `keyboardParams.arpActive` (effect guard + dep) | **yes**, scalar |
| `:211` / `:213` | `keyboardParams.release` (effect body + dep) | **yes**, scalar |

`bpm` (`:80`) is read at `:101` and `:108` only — ref-only, never rendered, so it leaves the
render scope entirely.

**Files:**
- Modify: `src/components/useInputDeck.ts:88-122` (selectors + ref sync), `:189`, `:217-225` — pre-branch `:76-110`, `:177`, `:205-213`, **+12** because Task 4 Step 3 inserts its `releaseAllHeldNotes` helper after `:46`, above all three. Task 4's second insert (21 lines after `:308`) is below them and contributes nothing here.
- Modify (test): `src/components/useInputDeck.test.tsx`

**Interfaces:**
- Consumes: **Task 4's +12 shift** above `:47` (its second insert is below every anchor here) and **Task 8's memoized return block**. No conflict with Task 8: neither `keyboardProps` nor `drumProps` contains a `synthParams`-derived field, so Task 8's dependency arrays stay correct verbatim after this task — `arpActive` and `release` must **not** be added to them. Also `useAppStore` (`src/store/store.ts`); `ArpStateRef` and `useArpPlayback(stateRef: ArpStateRef, active: boolean): void` from `src/audio/playback/arpPlayback.ts`, where
  `ArpStateRef = { current: { activeNotes: Set<string>; params: SynthParams; controlTarget: SynthControlTarget; bpm: number } }`.
- Produces: `export function subscribeArpState(ref: ArpStateRef): () => void` — starts two
  `useAppStore.subscribe` subscriptions (`synthParams` → `ref.current.params`, `bpm` →
  `ref.current.bpm`), both with `fireImmediately: true`, and returns a disposer that stops
  both. The hook's public return type (`{ keyboardProps: InputDeckKeyboardProps; drumProps: InputDeckDrumProps }`)
  is unchanged.

- [ ] **Step 1: Write the failing test for `subscribeArpState`**

Append to `src/components/useInputDeck.test.tsx`:

```tsx
describe('subscribeArpState', () => {
  test('mirrors synthParams and bpm into the ref, then stops on dispose', () => {
    const ref = {
      current: {
        activeNotes: new Set<string>(),
        params: useAppStore.getState().synthParams,
        controlTarget: 'synth' as const,
        bpm: useAppStore.getState().bpm,
      },
    };
    const startingBpm = useAppStore.getState().bpm;
    const stop = subscribeArpState(ref);
    try {
      // fireImmediately bootstrap
      expect(ref.current.params).toBe(useAppStore.getState().synthParams);
      expect(ref.current.bpm).toBe(startingBpm);

      const next = { ...useAppStore.getState().synthParams, detune: 17 };
      useAppStore.getState().setSynthParams(next);
      expect(ref.current.params.detune).toBe(17);

      useAppStore.getState().setBpm(133);
      expect(ref.current.bpm).toBe(133);
    } finally {
      stop();
    }

    // After disposal the ref must go stale rather than keep tracking.
    useAppStore.getState().setBpm(97);
    expect(ref.current.bpm).toBe(133);
    useAppStore.getState().setBpm(startingBpm);
  });
});
```

Add `subscribeArpState` to the existing import from `./useInputDeck` at the top of the file.

- [ ] **Step 2: Run it, confirm it fails**

Run: `bun test src/components/useInputDeck.test.tsx -t "subscribeArpState"`
Expected: FAIL — `subscribeArpState is not a function`.

- [ ] **Step 3: Add `subscribeArpState` to `useInputDeck.ts`**

Insert directly above `export function useInputDeck()` (i.e. above the docblock at `:69-71`):

```ts
/**
 * Keeps `arpStateRef.current.params` / `.bpm` fresh by IMPERATIVE store
 * subscription instead of by a render-driven effect. The hook used to select
 * the whole `synthParams` object at App level purely to feed this ref, which
 * re-rendered the entire application tree on every knob pointermove. Zustand
 * notifies synchronously on `set()`, so the ref is refreshed strictly EARLIER
 * than the old post-commit effect did it — the arp can never read staler
 * params than before. Same pattern as `useSequencerPlayback.ts:69-78`.
 */
export function subscribeArpState(ref: ArpStateRef): () => void {
  const unsubParams = useAppStore.subscribe(
    (s) => s.synthParams,
    (params) => {
      ref.current.params = params;
    },
    { fireImmediately: true },
  );
  const unsubBpm = useAppStore.subscribe(
    (s) => s.bpm,
    (bpm) => {
      ref.current.bpm = bpm;
    },
    { fireImmediately: true },
  );
  return () => {
    unsubParams();
    unsubBpm();
  };
}
```

Add the type import at the top of the file, next to the existing `useArpPlayback` import
(line 4), so it becomes:

```ts
import { useArpPlayback, type ArpStateRef } from '../audio/playback/arpPlayback';
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun test src/components/useInputDeck.test.tsx -t "subscribeArpState"`
Expected: PASS.

- [ ] **Step 5: Narrow the two selectors**

In `src/components/useInputDeck.ts`, replace lines 80-83:

```ts
  const bpm = useAppStore((s) => s.bpm);
  // The keyboard always auditions the main synth (KEYBOARD_AUDITION_TARGET),
  // regardless of which destination the panel's Target selector is editing.
  const keyboardParams = useAppStore((s) => s.synthParams);
```

with:

```ts
  // The keyboard always auditions the main synth (KEYBOARD_AUDITION_TARGET),
  // regardless of which destination the panel's Target selector is editing.
  //
  // Deliberately two PRIMITIVE selectors, not `(s) => s.synthParams`. This hook
  // is mounted in App, and `synthParams` is a fresh object on every knob
  // pointermove (60-120 Hz), so selecting the object re-rendered App and with
  // it SynthView + SequencerView + ArrangeView + BottomInputDock — three of
  // them on hidden tabs. These two scalars are the ONLY reactive reads; the
  // full params object reaches the arp through arpStateRef below.
  const arpActive = useAppStore((s) => s.synthParams.arpActive);
  const release = useAppStore((s) => s.synthParams.release);
```

- [ ] **Step 6: Rewire the ref and delete the per-commit effect**

Replace lines 97-110 (the `arpStateRef` initialiser and the unconditional effect):

```ts
  const arpStateRef = useRef({
    activeNotes,
    params: useAppStore.getState().synthParams,
    controlTarget: KEYBOARD_AUDITION_TARGET,
    bpm: useAppStore.getState().bpm,
  });
  // activeNotes is React state, so it still needs a commit-time mirror.
  useEffect(() => {
    arpStateRef.current.activeNotes = activeNotes;
  }, [activeNotes]);
  // params/bpm come straight off the store — no render subscription needed.
  useEffect(() => subscribeArpState(arpStateRef), []);
```

(The `useRef` initialiser calls `getState()` on every render and discards the result on all
but the first — two property reads, and after this task App re-renders rarely. Keeping it
inline is cheaper than the alternative lazy-init dance.)

- [ ] **Step 7: Point the three reactive reads at the new scalars**

- Line 177: `useArpPlayback(arpStateRef, keyboardParams.arpActive);` → `useArpPlayback(arpStateRef, arpActive);`
- Lines 205-213 become:

```ts
  useEffect(() => {
    if (arpActive && activeNotes.size === 0 && hasSynthPlaybackContext()) {
      releaseSynthPlaybackVoices(KEYBOARD_AUDITION_TARGET, release);
    }
  }, [arpActive, activeNotes.size, release]);
```

- [ ] **Step 8: Verify nothing else referenced the removed bindings**

Run: `grep -n "keyboardParams\|\bbpm\b" src/components/useInputDeck.ts`
Expected: zero hits for `keyboardParams`; the only `bpm` hits are inside `subscribeArpState`
and the `arpStateRef` initialiser.
Run: `bun run lint`
Expected: clean.

- [ ] **Step 9: Run the affected suites**

Run: `bun test src/components/useInputDeck.test.tsx src/audio/playback/arpPlayback.test.ts`
Expected: PASS.

- [ ] **Step 10: Manual verification**

1. `bun run dev`, open the app, click once to start audio, go to the **Synth** tab.
2. Hold a QWERTY note key (e.g. `A`) so a voice is sounding.
3. While still holding it, drag the **Filter Cutoff** knob across its full range.
   Expected: the held note's tone sweeps continuously and does not cut out or re-trigger.
4. Release the key, turn **Arp** on, hold a three-note chord (`A`, `D`, `G`), and drag the
   **Arp Rate** and **Release** knobs.
   Expected: the arpeggio keeps running throughout and follows the new rate/release; no
   silence gaps, no stuck notes on release.
5. Switch to the **Sequencer** tab and press Play, then switch back to **Synth** and drag a
   knob. Expected: the beat does not stutter.

- [ ] **Step 11: Commit**

```bash
git add src/components/useInputDeck.ts src/components/useInputDeck.test.tsx
git commit -m "perf(input): narrow the App-level synthParams subscription to two scalars

useInputDeck is mounted in App and selected the whole synthParams object, so
every knob pointermove re-rendered SynthView, SequencerView, ArrangeView and
BottomInputDock. Only arpActive and release are read reactively; the full
params object now reaches arpStateRef through an imperative store
subscription, which refreshes it strictly earlier than the old per-commit
effect did.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Stop `useSequencerPlayback` re-subscribing the audio clock on every knob frame

`src/components/useSequencerPlayback.ts:144` has deps `[isPlaying, playStepSounds]`, and
`playStepSounds` is a `useCallback` over `[tracks, synthParams, masterSequencerVolume, bpm]`
(`:79-104`). `synthParams` (`:53`) is a fresh object on every knob pointermove, so every
pointer frame tears down the clock subscription (`clockListeners.delete`) and re-subscribes,
and re-runs `ensureDrumEngine()`.

This does not currently break audio only because `usePlayheadSync` holds its own clock
subscription while any player runs, so `clockListeners.size` never reaches 0 and
`stopClockTimer()` never fires. That is an accident of an unrelated component, not a
guarantee.

The fix is the idiom this same file already documents and uses. The clock callback reads the
meter live at **`useSequencerPlayback.ts:123`**:

```ts
// Read the meter LIVE, for the same reason the player state is read live
// below: one clockTick dispatches several steps synchronously and the
// subscription outlives a React commit, so a captured bar length can be
// one meter behind.
const stepsPerBar = getMeter(useAppStore.getState().meterId).stepsPerBar;
```

and the player state live at `:125`. `useChordPlayback.ts:527-534` states the rule outright:
*"the clock effect's dep array must not gain chordSynthParams/bassSynthParams (that would
resubscribe on every param slide)"*. `useLeadPlayback.ts:90` does the same
(`const s = useAppStore.getState();` at the top of its callback).

The per-step work has a pure core, so it is extracted and TDD'd rather than just inlined.

**Files:**
- Modify: `src/components/useSequencerPlayback.ts:1-13` (imports), `:48-58` (selectors),
  `:79-104` (delete `playStepSounds`, add the pure `sequencerStepEvents`), `:118-144`
  (clock callback + deps)
- Modify (test): `src/components/useSequencerPlayback.test.ts`

**Interfaces:**
- Consumes: `useAppStore`; `stepDurationSec(bpm: number): number` (`src/utils/musicTheory.ts`);
  `playbackNoteOn(noteName: string, params: SynthParams, velocity?: number, time?: number, source?: string): void`
  and `playbackNoteOff(noteName: string, release: number, time?: number, source?: string): void`
  (`src/audio/playback/playbackEngine.ts`); `triggerPad(instrument: string, volume: number, time?: number): void`
  (`src/audio/playback/drumPlayback.ts`); `SequencerTrack` and `SynthParams` (`src/types.ts`).
- Produces:
  ```ts
  export type SequencerStepEvent =
    | { kind: 'note'; note: string; release: number; offsetSec: number }
    | { kind: 'pad'; instrument: string };

  export function sequencerStepEvents(
    tracks: readonly SequencerTrack[],
    stepIndex: number,
    synthParams: SynthParams,
    bpm: number,
  ): SequencerStepEvent[];
  ```
  `useSequencerPlayback(): { currentStep: number; setCurrentStep: (step: number) => void }`
  keeps its current signature — Task 22 is what changes it.

- [ ] **Step 1: Write the failing tests for `sequencerStepEvents`**

Append to `src/components/useSequencerPlayback.test.ts`:

```ts
import { sequencerStepEvents } from './useSequencerPlayback';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';
import type { SequencerTrack } from '../types';

const track = (over: Partial<SequencerTrack>): SequencerTrack => ({
  id: 't',
  name: 'T',
  instrument: 'kick',
  color: 'bg-primary',
  volume: 1,
  muted: false,
  steps: [true, false, true, false],
  ...over,
});

describe('sequencerStepEvents', () => {
  const params = { ...INITIAL_SYNTH_PARAMS, release: 0.4 };

  test('a muted track contributes nothing', () => {
    expect(sequencerStepEvents([track({ muted: true })], 0, params, 120)).toEqual([]);
  });

  test('an inactive step contributes nothing', () => {
    expect(sequencerStepEvents([track({})], 1, params, 120)).toEqual([]);
  });

  test('a drum track emits a pad event named after its instrument', () => {
    expect(sequencerStepEvents([track({ instrument: 'snare' })], 0, params, 120)).toEqual([
      { kind: 'pad', instrument: 'snare' },
    ]);
  });

  test('synth and bass tracks emit notes with the patch release and an 80% gate', () => {
    const events = sequencerStepEvents(
      [track({ id: 'a', instrument: 'synth' }), track({ id: 'b', instrument: 'bass' })],
      0,
      params,
      120,
    );
    // 120 bpm -> 0.5 s per beat -> 0.125 s per 16th; gate is 80% of that.
    expect(events).toEqual([
      { kind: 'note', note: 'C4', release: 0.4, offsetSec: 0.1 },
      { kind: 'note', note: 'C2', release: 0.4, offsetSec: 0.1 },
    ]);
  });

  test('the gate scales with bpm', () => {
    const slow = sequencerStepEvents([track({ instrument: 'synth' })], 0, params, 60);
    expect((slow[0] as { offsetSec: number }).offsetSec).toBeCloseTo(0.2, 10);
  });

  test('tracks are emitted in list order and out-of-range steps are ignored', () => {
    const events = sequencerStepEvents(
      [track({ id: 'a', instrument: 'kick' }), track({ id: 'b', instrument: 'hihat' })],
      99,
      params,
      120,
    );
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/components/useSequencerPlayback.test.ts -t "sequencerStepEvents"`
Expected: FAIL — `sequencerStepEvents is not a function`.

- [ ] **Step 3: Add the pure function**

In `src/components/useSequencerPlayback.ts`, **delete** the whole `playStepSounds` `useCallback`
(lines 79-104) from inside the hook body, and add the following at **module scope** — immediately
after `sequencerStepAction`'s closing brace (line 41) and above the hook's doc comment (line 43).
Do not paste it where `playStepSounds` used to sit: `useSequencerPlayback` opens at line 48, so an
`export type` / `export function` there is inside a function body and TypeScript rejects it
(`Modifiers cannot appear here`).

```ts
/** What one sequencer step must trigger. Pure so the per-step decision is
 *  testable without a clock, an AudioContext or a React render. */
export type SequencerStepEvent =
  | { kind: 'note'; note: string; release: number; offsetSec: number }
  | { kind: 'pad'; instrument: string };

export function sequencerStepEvents(
  tracks: readonly SequencerTrack[],
  stepIndex: number,
  synthParams: SynthParams,
  bpm: number,
): SequencerStepEvent[] {
  const events: SequencerStepEvent[] = [];
  const offsetSec = stepDurationSec(bpm) * 0.8;
  for (const track of tracks) {
    if (track.muted) continue;
    if (!track.steps[stepIndex]) continue;
    if (track.instrument === 'synth' || track.instrument === 'bass') {
      events.push({
        kind: 'note',
        note: track.instrument === 'bass' ? 'C2' : 'C4',
        release: synthParams.release,
        offsetSec,
      });
    } else {
      events.push({ kind: 'pad', instrument: track.instrument });
    }
  }
  return events;
}
```

Add to the type imports at the top of the file:

```ts
import type { SequencerTrack, SynthParams } from "../types";
```

and drop `useCallback` from the `react` import on line 1 (it is now unused):

```ts
import { useEffect, useRef, useState } from "react";
```

- [ ] **Step 4: Run the new tests, confirm they pass**

Run: `bun test src/components/useSequencerPlayback.test.ts`
Expected: PASS (new tests plus the existing `sequencerStepAction` suites).

- [ ] **Step 5: Read the four dead selectors and shrink the effect deps**

Replace lines 52-58:

```ts
  const tracks = useAppStore((s) => s.sequencerTracks);
  const synthParams = useAppStore((s) => s.synthParams);
  const masterSequencerVolume = useAppStore((s) => s.masterSequencerVolume);
  const bpm = useAppStore((s) => s.bpm);
  const playerState = useAppStore((s) => s.sequencerPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';
```

with:

```ts
  // tracks / synthParams / masterSequencerVolume / bpm are deliberately NOT
  // selected here: they are read LIVE inside the clock callback below. As
  // render-scope values they landed in playStepSounds' useCallback deps and
  // then in the clock effect's deps, so every knob pointermove tore down and
  // re-subscribed the clock (~120x/sec) and re-ran ensureDrumEngine(). The
  // live read is also strictly fresher — see the meter comment in the callback.
  const playerState = useAppStore((s) => s.sequencerPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';
```

- [ ] **Step 6: Rewrite the clock callback tail and the dep array**

Replace lines 140-144 (the tail of the callback and the effect's dep array):

```ts
      const stepInLoop = step % stepsPerBar;
      setCurrentStep(stepInLoop);
      playStepSounds(stepInLoop, time);
    });
  }, [isPlaying, playStepSounds]);
```

with:

```ts
      const stepInLoop = step % stepsPerBar;
      setCurrentStep(stepInLoop);

      // Everything the step needs, read LIVE off the store — same rationale as
      // the meter read above, and the pattern useLeadPlayback.ts:90 and
      // useChordPlayback.ts:632 already use.
      const live = useAppStore.getState();
      const volume = live.masterSequencerVolume;
      for (const event of sequencerStepEvents(
        live.sequencerTracks,
        stepInLoop,
        live.synthParams,
        live.bpm,
      )) {
        if (event.kind === 'note') {
          playbackNoteOn(event.note, live.synthParams, volume, time);
          playbackNoteOff(event.note, event.release, time + event.offsetSec);
        } else {
          triggerPad(event.instrument, volume, time);
        }
      }
    });
  }, [isPlaying, hardStop]);
```

- [ ] **Step 7: Type-check and run the suite**

Run: `bun run lint`
Expected: clean — in particular no "declared but never read" for `tracks`, `synthParams`,
`masterSequencerVolume`, `bpm` or `useCallback`.
Run: `bun test src/components/useSequencerPlayback.test.ts src/components/loop/SequencerView.test.tsx`
Expected: PASS.

- [ ] **Step 8: Manual verification**

1. `bun run dev`, click once to start audio, go to the **Sequencer** tab.
2. Press Play. Expected: the pattern runs and the step highlight advances.
3. While it runs, toggle a step on and off. Expected: the change is audible on the very next
   pass of that step (this is what proves the live read of `sequencerTracks` works).
4. Mute a track with its power toggle mid-playback. Expected: it drops out immediately.
5. Drag the **Drum Volume** slider and the **BPM** control while playing. Expected: the level
   and tempo follow, and the beat does not stutter or double-trigger.
6. Switch to the **Synth** tab (sequencer still playing) and drag Filter Cutoff for a few
   seconds. Expected: the beat stays perfectly steady — before this task each pointer frame
   tore down and rebuilt the clock subscription.

- [ ] **Step 9: Commit**

```bash
git add src/components/useSequencerPlayback.ts src/components/useSequencerPlayback.test.ts
git commit -m "perf(sequencer): read step state live instead of re-subscribing the clock

playStepSounds closed over synthParams, so it was a new callback on every knob
pointermove and the clock effect's dep array tore the subscription down and
re-ran ensureDrumEngine() ~120x/sec. The per-step decision is now the pure
sequencerStepEvents(), and the callback reads tracks/params/volume/bpm live
from the store, matching the meter read at :123 and useLeadPlayback.ts:90.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Coalesce persisted writes behind a write-batching `StateStorage` adapter

`src/store/store.ts:392-395` configures `persist` with `name`, `version`, `storage` and
`partialize` and **no throttle**. Zustand v5's persist wraps `set` as
`(...args) => { set(...args); setItem(); }` (`node_modules/zustand/esm/middleware.mjs:368-374`),
so every single `set()` anywhere in the app synchronously runs
`partializeAppState` → `JSON.stringify` → `storage.setItem`.

**Measured cost today: 4,366 bytes serialised in 0.036 ms with the default single-loop
project.** That is genuinely small, and I am not claiming this is the dominant cost at
default project size. The reasons to fix it anyway are the two multipliers: it fires at
*pointer rate* during a knob drag (60–120 Hz, doubled again by Task 14's mirror until that
lands), and the payload is `partialize`'s `loops` — the whole project body — so it scales
linearly with loop count and progression length. `localStorage.setItem` is a synchronous
main-thread IPC on the same thread as the scheduler and the renderer.

The adapter must preserve three existing guarantees:
1. `resolveStorage()` may return `null`, and `localStorage` can **throw** rather than return
   null (Safari private mode, blocked cookies, embedded webviews) — the `memoryStorage`
   fallback and the throw-swallowing must survive.
2. A tab close must not lose state → synchronous flush on `pagehide`.
3. What gets persisted must not change at all — the adapter sits *below* `partialize` and
   `createJSONStorage` and only sees an already-serialised string.

This is the most testable task in the plan; TDD it completely with an injected scheduler and
no sleeping.

**Files:**
- Create: `src/utils/coalescedStorage.ts`
- Create: `src/utils/coalescedStorage.test.ts`
- Modify: `src/store/store.ts:1-4` (imports), `:392-395` (persist `storage` option) and a new
  exported `flushPersistedWrites()`
- Modify (test): `src/store/store.test.ts` — the assertions that read
  `fakeLocalStorage.getItem('musibox_project_state_v1')` immediately after a store write
  (known sites: `:326`, `:463`, `:706`)

**Interfaces:**
- Consumes: `StateStorage` from `zustand/middleware`
  (`{ getItem(name: string): string | null | Promise<string | null>; setItem(name: string, value: string): unknown | Promise<unknown>; removeItem(name: string): unknown | Promise<unknown> }`).
- Produces:
  ```ts
  export const IDLE_FLUSH_TIMEOUT_MS: 250;

  export interface WriteScheduler {
    schedule: (flush: () => void) => number;
    cancel: (handle: number) => void;
  }

  export const idleWriteScheduler: WriteScheduler;

  export interface CoalescedStorage extends StateStorage {
    /** Writes every buffered value through to the base storage, synchronously. */
    flush(): void;
    /** Drops every buffered value without writing it. */
    discard(): void;
    /** Names with a write still buffered. Test/diagnostic use only. */
    pendingNames(): string[];
  }

  export function createCoalescedStorage(
    base: StateStorage,
    scheduler?: WriteScheduler,
  ): CoalescedStorage;
  ```
  and from `src/store/store.ts`: `export function flushPersistedWrites(): void;`

- [ ] **Step 1: Write the failing test file**

Create `src/utils/coalescedStorage.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { StateStorage } from 'zustand/middleware';
import { createCoalescedStorage, type WriteScheduler } from './coalescedStorage';

/** A storage whose every call is recorded, and which can be made to throw. */
function recordingStorage(opts: { throwOnSet?: boolean } = {}) {
  const data = new Map<string, string>();
  const calls: string[] = [];
  const storage: StateStorage = {
    getItem: (name) => {
      calls.push(`get:${name}`);
      return data.get(name) ?? null;
    },
    setItem: (name, value) => {
      calls.push(`set:${name}`);
      if (opts.throwOnSet) throw new Error('QuotaExceededError');
      data.set(name, value);
    },
    removeItem: (name) => {
      calls.push(`remove:${name}`);
      data.delete(name);
    },
  };
  return { storage, data, calls };
}

/** A scheduler the test drives by hand — no timers, no sleeping. */
function manualScheduler() {
  let next = 1;
  const queued = new Map<number, () => void>();
  const scheduler: WriteScheduler = {
    schedule: (flush) => {
      const handle = next++;
      queued.set(handle, flush);
      return handle;
    },
    cancel: (handle) => {
      queued.delete(handle);
    },
  };
  const run = () => {
    const due = [...queued.values()];
    queued.clear();
    due.forEach((fn) => fn());
  };
  return { scheduler, run, size: () => queued.size };
}

describe('createCoalescedStorage', () => {
  test('setItem buffers instead of writing through', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v1');

    expect(base.calls).toEqual([]);
    expect(storage.pendingNames()).toEqual(['k']);
  });

  test('N writes to one name collapse into one write of the LAST value', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v1');
    storage.setItem('k', 'v2');
    storage.setItem('k', 'v3');
    sched.run();

    expect(base.calls).toEqual(['set:k']);
    expect(base.data.get('k')).toBe('v3');
    expect(storage.pendingNames()).toEqual([]);
  });

  test('one flush is scheduled per burst, not one per write', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v1');
    storage.setItem('k', 'v2');
    storage.setItem('other', 'x');

    expect(sched.size()).toBe(1);
    sched.run();
    expect(base.calls.sort()).toEqual(['set:k', 'set:other']);
  });

  test('getItem reads back a buffered write before it has been flushed', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'pending');

    expect(storage.getItem('k')).toBe('pending');
    expect(base.calls).toEqual([]); // never consulted the base for a buffered name
    expect(storage.getItem('missing')).toBe(null);
    expect(base.calls).toEqual(['get:missing']);
  });

  test('removeItem drops the buffered write and deletes through immediately', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);
    base.storage.setItem('k', 'old');
    base.calls.length = 0;

    storage.setItem('k', 'pending');
    storage.removeItem('k');

    expect(base.calls).toEqual(['remove:k']);
    expect(base.data.has('k')).toBe(false);
    expect(storage.pendingNames()).toEqual([]);
    sched.run();
    expect(base.calls).toEqual(['remove:k']); // the dropped write never lands
  });

  test('flush() writes synchronously and cancels the scheduled callback', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v');
    storage.flush();

    expect(base.data.get('k')).toBe('v');
    expect(sched.size()).toBe(0);
    sched.run();
    expect(base.calls).toEqual(['set:k']); // no second write
  });

  test('flush() with nothing buffered never touches the base', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.flush();

    expect(base.calls).toEqual([]);
  });

  test('discard() drops buffered writes without writing them', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v');
    storage.discard();
    sched.run();

    expect(base.calls).toEqual([]);
    expect(storage.pendingNames()).toEqual([]);
  });

  test('a base whose setItem THROWS never breaks the adapter', () => {
    // Safari private mode / blocked cookies / embedded webviews: setItem
    // throws rather than returning. The buffer must still clear and later
    // writes must keep working.
    const base = recordingStorage({ throwOnSet: true });
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v1');
    expect(() => sched.run()).not.toThrow();
    expect(storage.pendingNames()).toEqual([]);

    storage.setItem('k', 'v2');
    expect(() => storage.flush()).not.toThrow();
    expect(base.calls).toEqual(['set:k', 'set:k']);
  });

  test('a throwing getItem/removeItem is swallowed too', () => {
    const base: StateStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base, sched.scheduler);

    expect(storage.getItem('k')).toBe(null);
    expect(() => storage.removeItem('k')).not.toThrow();
  });

  test('flushing again after a flush is a no-op', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v');
    storage.flush();
    storage.flush();

    expect(base.calls).toEqual(['set:k']);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/utils/coalescedStorage.test.ts`
Expected: FAIL — cannot resolve `./coalescedStorage`.

- [ ] **Step 3: Write the adapter**

Create `src/utils/coalescedStorage.ts`:

```ts
import type { StateStorage } from 'zustand/middleware';

/**
 * How long a buffered write may sit before it is forced out. Used as the
 * requestIdleCallback timeout, and as the plain setTimeout delay where there
 * is no requestIdleCallback (Safari < 16.4, and every non-browser runtime).
 */
export const IDLE_FLUSH_TIMEOUT_MS = 250;

export interface WriteScheduler {
  schedule: (flush: () => void) => number;
  cancel: (handle: number) => void;
}

// requestIdleCallback and cancelIdleCallback must be used as a PAIR — mixing an
// idle handle with clearTimeout silently fails to cancel — so the capability is
// probed once, for both.
const HAS_IDLE_CALLBACK =
  typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function';

export const idleWriteScheduler: WriteScheduler = {
  schedule: (flush) =>
    HAS_IDLE_CALLBACK
      ? requestIdleCallback(flush, { timeout: IDLE_FLUSH_TIMEOUT_MS })
      : (setTimeout(flush, IDLE_FLUSH_TIMEOUT_MS) as unknown as number),
  cancel: (handle) => {
    if (HAS_IDLE_CALLBACK) cancelIdleCallback(handle);
    else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

export interface CoalescedStorage extends StateStorage {
  /** Writes every buffered value through to the base storage, synchronously. */
  flush(): void;
  /** Drops every buffered value without writing it. */
  discard(): void;
  /** Names with a write still buffered. Test/diagnostic use only. */
  pendingNames(): string[];
}

/**
 * A write-coalescing `StateStorage`. `setItem` buffers the latest value per
 * name and schedules ONE flush; `getItem` reads the buffer first so hydration
 * and any read-your-writes caller still sees the newest value.
 *
 * Why: zustand's persist middleware has no throttle — it stringifies the whole
 * partialized state and calls setItem on EVERY set(), which during a knob drag
 * is 60-120 synchronous localStorage writes per second of the entire project
 * body, on the same main thread as the 25 ms audio scheduler.
 *
 * Every base call is wrapped in try/catch on purpose: `localStorage` does not
 * merely return null when it is unavailable, it THROWS (Safari private mode,
 * blocked cookies, embedded webviews). A throwing write must still clear the
 * buffer, or the adapter would retry the same doomed value forever.
 */
export function createCoalescedStorage(
  base: StateStorage,
  scheduler: WriteScheduler = idleWriteScheduler,
): CoalescedStorage {
  const pending = new Map<string, string>();
  let handle: number | null = null;

  const cancelScheduled = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  const flush = (): void => {
    cancelScheduled();
    if (pending.size === 0) return;
    // Drain BEFORE writing: a throwing setItem must not leave the entry
    // buffered for an endless retry.
    const drained = [...pending];
    pending.clear();
    for (const [name, value] of drained) {
      try {
        base.setItem(name, value);
      } catch {
        // ignore — see the docblock
      }
    }
  };

  return {
    getItem: (name) => {
      const buffered = pending.get(name);
      if (buffered !== undefined) return buffered;
      try {
        return base.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending.set(name, value);
      if (handle === null) handle = scheduler.schedule(flush);
    },
    removeItem: (name) => {
      pending.delete(name);
      if (pending.size === 0) cancelScheduled();
      try {
        base.removeItem(name);
      } catch {
        // ignore — see the docblock
      }
    },
    flush,
    discard: () => {
      pending.clear();
      cancelScheduled();
    },
    pendingNames: () => [...pending.keys()],
  };
}
```

- [ ] **Step 4: Run the adapter tests, confirm they pass**

Run: `bun test src/utils/coalescedStorage.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Wire the adapter into the store**

In `src/store/store.ts`, add the import next to the existing `./migrate` import block
(after line 29's `import { loopStatePatch } from './loop';`):

```ts
import { createCoalescedStorage } from '../utils/coalescedStorage';
```

Insert immediately after `resolveStorage()`'s closing brace (currently line 98):

```ts
/**
 * The persist storage. `resolveStorage()` may legitimately return null (no
 * localStorage at all) and its setItem already swallows throws; the in-memory
 * fallback keeps persist functional either way. The coalescer sits BELOW
 * partialize and createJSONStorage, so it only ever sees an already-serialised
 * string and cannot change WHAT is persisted — only how often it is written.
 */
const persistStorage = createCoalescedStorage(resolveStorage() ?? memoryStorage);

/**
 * Force every buffered persist write out to storage now. Called on pagehide and
 * on the hidden transition so closing or backgrounding a tab can never lose
 * state, and exported so tests can assert on storage right after a write.
 */
export function flushPersistedWrites(): void {
  persistStorage.flush();
}

// `pagehide` (not `beforeunload`) is the event that actually fires on iOS
// Safari and on bfcache navigations; `visibilitychange` covers a tab that is
// backgrounded and then killed by the OS without ever firing pagehide.
try {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', flushPersistedWrites);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPersistedWrites();
    });
  }
} catch {
  // ignore — a restricted embedding context may deny even addEventListener
}
```

Then change line 394 from:

```ts
      storage: createJSONStorage<PersistedState>(() => resolveStorage() ?? memoryStorage),
```

to:

```ts
      storage: createJSONStorage<PersistedState>(() => persistStorage),
```

- [ ] **Step 6: Fix the store tests that read storage synchronously**

`src/store/store.test.ts` asserts on `fakeLocalStorage` immediately after a store write inside
one synchronous block; those reads now happen before the flush. Add
`flushPersistedWrites` to the destructured import from the dynamic store module in each
affected test (the file already imports the store via `await getStore()`), and insert a
`flushPersistedWrites()` call on the line before each such assertion. The three known sites:

- `:326` — insert before `const persistedPayload = fakeLocalStorage.getItem('musibox_project_state_v1');`
- `:463` — insert before `expect(fakeLocalStorage.getItem('musibox_project_state_v1')).not.toBeNull();`
- `:706` — insert before `expect(fakeLocalStorage.getItem('musibox_project_state_v1')).not.toBeNull();`

Each insertion looks like:

```ts
    const { useAppStore, flushPersistedWrites } = await getStore();
    // ...
    flushPersistedWrites();
    const persistedPayload = fakeLocalStorage.getItem('musibox_project_state_v1');
```

- [ ] **Step 7: Run the store suite and fix any remaining site**

Run: `bun test src/store/store.test.ts`
Expected: PASS. Any remaining failure will be exactly the same shape — an assertion reading
`fakeLocalStorage.getItem('musibox_project_state_v1')` in the same synchronous block as the
store write that produced it. Insert `flushPersistedWrites()` immediately before it. Do NOT
change any assertion's expected value: the adapter cannot alter what is written, only when.

- [ ] **Step 8: Run the full gate**

Run: `bun test && bun run lint && bun run eslint`
Expected: all green. `eslint` matters here because this task adds a `store/` → `utils/`
import, which the import-layering rules must accept (`store.ts` already imports
`../utils/meter`).

- [ ] **Step 9: Manual verification**

1. `bun run dev`, click to start audio, set BPM to 128 and add two extra loops on the
   **Arrange** tab so the payload is non-trivial.
2. Open DevTools → Application → Local Storage → `musibox_project_state_v1`.
3. Go to the **Synth** tab and drag the Filter Cutoff knob for ~3 seconds.
   Expected: the stored value updates a handful of times, not continuously — before this task
   it changed on every pointer frame.
4. Stop dragging and wait ~0.5 s, then re-read the key.
   Expected: it contains the final `filterCutoff` value (the trailing flush landed).
5. Change the BPM to 96, then immediately close the tab (Cmd-W) and reopen the app.
   Expected: BPM is 96 — the `pagehide` flush wrote it.
6. Switch to another browser tab, wait a second, come back, reload.
   Expected: the last edit survived (the `visibilitychange` flush).

**Rollback:** revert this task alone with
`git revert <sha>` — it touches only `src/utils/coalescedStorage.ts`,
`src/utils/coalescedStorage.test.ts`, `src/store/store.ts` (one import, one inserted block,
one changed `storage:` line) and the `flushPersistedWrites()` insertions in
`src/store/store.test.ts`. Nothing else in the codebase imports the adapter. If only the
batching needs disabling while keeping the flush plumbing, change line 394 back to
`createJSONStorage<PersistedState>(() => resolveStorage() ?? memoryStorage)`; the
`flushPersistedWrites()` calls in tests then become harmless no-ops.

- [ ] **Step 10: Commit**

```bash
git add src/utils/coalescedStorage.ts src/utils/coalescedStorage.test.ts src/store/store.ts src/store/store.test.ts
git commit -m "perf(store): coalesce persisted writes behind an idle-flushing storage adapter

zustand's persist has no throttle: every set() stringifies the partialized
state (loops = the whole project body) and calls localStorage.setItem
synchronously. Measured at 4,366 bytes / 0.036 ms for the default project, but
it fires at pointer rate during a knob drag and scales with loop count. The
adapter buffers the latest value per name, flushes on idle, and flushes
synchronously on pagehide and on the hidden visibility transition so a tab
close cannot lose state. It sits below partialize, so WHAT is persisted is
unchanged, and every base call stays wrapped in try/catch because
localStorage throws rather than returning null in restricted contexts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---
### Task 14: Fold `loopSync`'s mirror into the same `set()` as the field write

`src/store/loopSync.ts:16-27` is a `subscribeWithSelector` subscription over the 31
`LOOP_FLAT_KEYS` (`src/store/loop.ts:4-36`) whose listener issues a **second, independent**
`useAppStore.setState`:

```ts
useAppStore.setState((s) => ({
  loops: s.loops.map((r) => (r.id === s.activeLoopId ? { ...r, ...patch } : r)),
}));   // loopSync.ts:24-26
```

Its `equalityFn` (`:29-35`) compares the 31 fields **by reference**, so a knob pointermove
(new `synthParams` object) counts as a change. Per gesture tick that is two full
`partialize` + `JSON.stringify` + `setItem` cycles instead of one, and a second render wave:
`loops` gets a new array identity, so `ArrangeView.tsx:51` re-renders, `loopIds`
(`ArrangeView.tsx:94`) recomputes, dnd-kit's `contextValue` changes and every
`SortableLoopCard` re-renders through context (bypassing its `React.memo`), plus
`TransportBar.tsx:39` and `LoopSelector.tsx:14`.

I read every writer of a `LOOP_FLAT_KEYS` field before choosing the shape. Every slice action
writes through the `set` handed to the state creator. The only writers that bypass it are
four direct `useAppStore.setState` calls, and none of them needs the mirror:

| site | writes | mirror today | after |
|---|---|---|---|
| `loadLoop.ts:37-45` | the full 31-field patch **plus** `activeLoopId` | skipped by `:22` (`next.activeLoopId !== prev.activeLoopId`) | skipped (same rule) |
| `songMode.ts:103` | `songLoopIndex` only | no change → no listener | no mirror |
| `ArrangeView.tsx:139` | `auditionLoopId`, `songLoopIndex` | no change → no listener | no mirror |
| `store.ts:460` | `{}` | no change → no listener | no mirror |

And inside `loopSlice.ts`: `addLoop` (`:72`) / `duplicateLoop` (`:94`) / `deleteLoop`
(`:120`) move `activeLoopId` → skipped both before and after; `deleteLoop`'s non-active
branch (`:116`), `reorderLoops` (`:124-142`), `reorderLoopsArray` (`:144-151`),
`setLoopName` (`:153`) and `setLoopRepeatCount` (`:158`) touch no flat key → no mirror
either way; `setLoopMix` (`:165-174`) writes `loops` **and** the flat patch, so the mirror
must map over the partial's `loops`, not the pre-write array (`:168-171` already documents
that today's sync-back rewrites the same values back idempotently).

The mirror therefore folds into a wrapper around the creator's `set`, and writes the **full**
31-field patch from the post-write state — byte-for-byte the same `loops` array the
subscription produced, so the persisted output is identical.

**Files:**
- Modify: `src/store/loopSync.ts:1-43` (replace `startLoopSync`/`useLoopSync` with the pure
  mirror + the `set` wrapper)
- Modify: `src/store/store.ts` — the `subscribeWithSelector((set, get, api) => {` state-creator
  body (`:373-390` pre-branch; roughly `:403-420` after Task 13 inserts an import line plus its
  ~29-line `persistStorage` / `flushPersistedWrites` block). **Find it by the anchor, not the
  number.**
- Modify: `src/App.tsx:16` (drop the `useLoopSync` import) and `:66-67` (drop the call)
- Modify (test): `src/store/loopSync.test.ts` (drop the `startLoopSync()` scaffolding, add
  the pure tests)

**Interfaces:**
- Consumes: `LOOP_FLAT_KEYS` and `loopStatePatch(source: object): LoopStatePatch` from
  `src/store/loop.ts`; `AppStore`, `Loop` from `src/store/types.ts`; `StoreApi` from `zustand`.
- Produces (replacing `startLoopSync` and `useLoopSync`, which are **deleted**):
  ```ts
  export function loopMirrorPartial(
    state: AppStore,
    partial: Partial<AppStore>,
  ): { loops: Loop[] } | null;

  export function createLoopMirroringSet(
    set: StoreApi<AppStore>['setState'],
    get: StoreApi<AppStore>['getState'],
  ): StoreApi<AppStore>['setState'];
  ```

- [ ] **Step 1: Write the failing pure tests**

Replace the whole body of `src/store/loopSync.test.ts` below its `afterEach` block (i.e.
keep lines 1-20 but change the `startLoopSync` import to `loopMirrorPartial`) with:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { loadLoop } from './loadLoop';
import { loopMirrorPartial } from './loopSync';
import { useAppStore } from './store';
import type { AppStore } from './types';

// These tests mutate the shared singleton store (loops, the flat per-loop
// slices, activeLoopId). bun runs every test file in one process without
// isolation, so a leftover scaleRoot/synthParams would bleed into
// loadLoop.test.ts (which asserts a pristine default store). Restore the
// default baseline after each test so the files stay order-independent.
afterEach(() => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    ...loopStatePatch(loop),
  });
});

describe('loopMirrorPartial', () => {
  const baseState = (): AppStore => useAppStore.getState();

  test('a partial with no per-loop field returns null', () => {
    expect(loopMirrorPartial(baseState(), { bpm: 128 })).toBeNull();
  });

  test('a per-loop field set to its CURRENT value returns null', () => {
    const state = baseState();
    expect(loopMirrorPartial(state, { scaleRoot: state.scaleRoot })).toBeNull();
  });

  test('a partial that moves activeLoopId returns null (loadLoop owns that write)', () => {
    const state = baseState();
    const other = { ...createDefaultLoop(), id: 'loop-other' };
    expect(
      loopMirrorPartial(
        { ...state, loops: [...state.loops, other] },
        { activeLoopId: 'loop-other', scaleRoot: 'F' },
      ),
    ).toBeNull();
  });

  test('a changed per-loop field patches the ACTIVE loop only', () => {
    const state = baseState();
    const other = { ...createDefaultLoop(), id: 'loop-other', scaleRoot: 'C' };
    const withTwo = { ...state, loops: [state.loops[0], other] } as AppStore;

    const mirror = loopMirrorPartial(withTwo, { scaleRoot: 'F' });

    expect(mirror).not.toBeNull();
    expect(mirror!.loops[0].scaleRoot).toBe('F');
    expect(mirror!.loops[1].scaleRoot).toBe('C');
    // Untouched loops keep their identity, so no consumer sees a fake change.
    expect(mirror!.loops[1]).toBe(other);
  });

  test('the mirror writes the FULL 31-field patch, not just the changed key', () => {
    const state = baseState();
    const stale = { ...state.loops[0], scaleType: 'Dorian', chordOctave: 1 };
    const withStale = { ...state, loops: [stale] } as AppStore;

    const mirror = loopMirrorPartial(withStale, { scaleRoot: 'F' })!;

    expect(mirror.loops[0].scaleRoot).toBe('F');
    expect(mirror.loops[0].scaleType).toBe(state.scaleType);
    expect(mirror.loops[0].chordOctave).toBe(state.chordOctave);
  });

  test('setLoopMix shape: the mirror maps over the PARTIAL loops, not the old array', () => {
    const state = baseState();
    const nextLoops = [{ ...state.loops[0], synthVolume: 0.25 }];

    const mirror = loopMirrorPartial(state, { loops: nextLoops, synthVolume: 0.25 })!;

    expect(mirror.loops[0].synthVolume).toBe(0.25);
    expect(mirror.loops).toHaveLength(1);
  });

  test('an activeLoopId with no matching loop returns null', () => {
    const state = baseState();
    expect(
      loopMirrorPartial({ ...state, activeLoopId: 'nope' } as AppStore, { scaleRoot: 'F' }),
    ).toBeNull();
  });
});

describe('loop live-write sync (now folded into set)', () => {
  test('a flat per-loop edit reaches loops[activeLoopId]', () => {
    const id = useAppStore.getState().activeLoopId;
    useAppStore.getState().setScaleRoot('D');
    const loop = useAppStore.getState().loops.find((r) => r.id === id)!;
    expect(loop.scaleRoot).toBe('D');
  });

  test('syncs into the CURRENT active loop after a loadLoop switch', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B', scaleRoot: 'C' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    loadLoop('loop-b');
    useAppStore.getState().setScaleRoot('E');
    const loop = useAppStore.getState().loops.find((r) => r.id === 'loop-b')!;
    expect(loop.scaleRoot).toBe('E');
    const loopA = useAppStore.getState().loops.find((r) => r.id === 'loop-default-1')!;
    expect(loopA.scaleRoot).toBe('A');
  });

  test('an activeLoopId-only change does not rewrite the loop', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B', scaleRoot: 'C' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    loadLoop('loop-b');
    useAppStore.getState().setActiveLoop('loop-default-1');
    const found = useAppStore.getState().loops.find((r) => r.id === 'loop-b')!;
    expect(found.scaleRoot).toBe('C');
  });

  test('nested edits (synthParams) sync by reference change', () => {
    const id = useAppStore.getState().activeLoopId;
    useAppStore.getState().setSynthParams({ ...useAppStore.getState().synthParams, detune: 42 });
    const loop = useAppStore.getState().loops.find((r) => r.id === id)!;
    expect(loop.synthParams.detune).toBe(42);
  });

  test('one edit produces ONE store notification, not two', () => {
    // The whole point of the fold: the mirror used to be a second, independent
    // setState, so every gesture tick notified subscribers (and persist) twice.
    let notifications = 0;
    const stop = useAppStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useAppStore.getState().setScaleRoot('G');
    } finally {
      stop();
    }
    expect(notifications).toBe(1);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/store/loopSync.test.ts`
Expected: FAIL — `loopMirrorPartial` is not exported, and the "ONE store notification" test
fails at 2 while `startLoopSync` still exists (it is started by `App`, not by the test, so it
may report 1 here; the import error is the blocking failure).

- [ ] **Step 3: Rewrite `loopSync.ts`**

Replace the entire contents of `src/store/loopSync.ts` with:

```ts
import type { StoreApi } from 'zustand';
import { LOOP_FLAT_KEYS, loopStatePatch } from './loop';
import type { AppStore, Loop } from './types';

/**
 * Live-write sync-back, folded into the store's own `set`.
 *
 * loops[] is always authoritative and persist always serializes the latest
 * edits — the "edits always sync back" half of the editing model. This used to
 * be a subscribeWithSelector subscription that issued a SECOND, independent
 * setState, which doubled the persist writes and the render waves per gesture
 * tick (a knob pointermove replaced the whole loops array, and dnd-kit's
 * SortableContext re-rendered every loop card through context). Emitting the
 * mirror inside the SAME set() produces exactly the same loops array with one
 * notification instead of two.
 */

/**
 * The `loops` patch that must accompany `partial`, or null when there is
 * nothing to mirror. Pure: `state` is the PRE-write state and `partial` the
 * already-resolved partial, so `{ ...state, ...partial }` is the post-write
 * value of every per-loop field.
 */
export function loopMirrorPartial(
  state: AppStore,
  partial: Partial<AppStore>,
): { loops: Loop[] } | null {
  // loadLoop owns the activeLoopId change and has already loaded the target
  // loop's fields into the flat slices; mirroring here would only rewrite the
  // just-loaded loop with itself.
  if ('activeLoopId' in partial && partial.activeLoopId !== state.activeLoopId) return null;

  const flat = partial as Record<string, unknown>;
  const current = state as unknown as Record<string, unknown>;
  let touched = false;
  for (const key of LOOP_FLAT_KEYS) {
    // Reference comparison, matching the old equalityFn: a new synthParams
    // object counts as a change, a playhead write does not.
    if (key in flat && flat[key] !== current[key]) {
      touched = true;
      break;
    }
  }
  if (!touched) return null;

  // setLoopMix writes `loops` AND the flat patch in one set(); the mirror must
  // build on the array that write produced, not on the pre-write one.
  const base = partial.loops ?? state.loops;
  const activeLoopId = state.activeLoopId;
  if (!base.some((loop) => loop.id === activeLoopId)) return null;

  const patch = loopStatePatch({ ...state, ...partial });
  return {
    loops: base.map((loop) => (loop.id === activeLoopId ? { ...loop, ...patch } : loop)),
  };
}

/**
 * Wraps the store creator's `set` so any write that changes a per-loop field
 * carries its loops[] mirror in the same state update. Every slice action goes
 * through this `set`; the four direct `useAppStore.setState` callers
 * (loadLoop, songMode, ArrangeView's audition write, the post-rehydrate
 * nudge) either move activeLoopId — which must not mirror — or touch no
 * per-loop field at all.
 */
export function createLoopMirroringSet(
  set: StoreApi<AppStore>['setState'],
  get: StoreApi<AppStore>['getState'],
): StoreApi<AppStore>['setState'] {
  const apply = set as unknown as (partial: unknown, replace?: boolean) => void;
  const wrapped = (
    partial: AppStore | Partial<AppStore> | ((state: AppStore) => AppStore | Partial<AppStore>),
    replace?: boolean,
  ): void => {
    // A full-state replace has no per-loop delta to derive; nothing in the app
    // uses it, and passing it through keeps the overload honest.
    if (replace === true) {
      apply(partial, true);
      return;
    }
    const state = get();
    const resolved = (
      typeof partial === 'function' ? partial(state) : partial
    ) as Partial<AppStore>;
    const mirror = loopMirrorPartial(state, resolved);
    apply(mirror ? { ...resolved, ...mirror } : resolved);
  };
  return wrapped as StoreApi<AppStore>['setState'];
}
```

- [ ] **Step 4: Wrap the creator's `set` in `store.ts`**

In `src/store/store.ts`, add to the imports (next to `import { loopStatePatch } from './loop';`
next to it — after Task 13's insert the exact line number has moved, so match the anchor text):

```ts
import { createLoopMirroringSet } from './loopSync';
```

Then replace the state-creator body — the lines from `subscribeWithSelector((set, get, api) => {` through the last `createXSlice(set, get),` (`:375-390` pre-branch, roughly `:405-420` after Task 13):

```ts
    subscribeWithSelector((set, get, api) => {
      storeApi = api;
      return {
        ...createTransportSlice(set, get),
```

with:

```ts
    subscribeWithSelector((set, get, api) => {
      storeApi = api;
      // Every slice writes through a `set` that carries the loops[] mirror in
      // the SAME state update — see loopSync.ts. This replaced a second,
      // independent setState that doubled persist writes and render waves on
      // every per-loop edit.
      const setWithLoopMirror = createLoopMirroringSet(set, get);
      return {
        ...createTransportSlice(setWithLoopMirror, get),
```

and change every remaining `createXSlice(set` on lines 379-388 to
`createXSlice(setWithLoopMirror`, i.e.:

```ts
        ...createMusicContextSlice(setWithLoopMirror),
        ...createSynthSlice(setWithLoopMirror),
        ...createChordsSlice(setWithLoopMirror),
        ...createBassSlice(setWithLoopMirror),
        ...createLeadSlice(setWithLoopMirror),
        ...createSequencerSlice(setWithLoopMirror),
        ...createEffectsSlice(setWithLoopMirror),
        ...createUiSlice(setWithLoopMirror),
        ...createPresetsSlice(setWithLoopMirror),
        ...createLoopSlice(setWithLoopMirror, get),
```

- [ ] **Step 5: Drop `useLoopSync` from App**

In `src/App.tsx`, delete line 16 (`import { useLoopSync } from './store/loopSync';`) and
change lines 66-68 from:

```ts
  // Loop live-write sync-back + song-mode coordinator (store-level, mounted once).
  useLoopSync();
  useSongModeSync();
```

to:

```ts
  // Song-mode coordinator (store-level, mounted once). The loop live-write
  // sync-back is no longer a subscription — it rides along inside the store's
  // own set(), see store/loopSync.ts.
  useSongModeSync();
```

- [ ] **Step 6: Confirm no other reference survives**

Run: `grep -rn "useLoopSync\|startLoopSync" src/`
Expected: zero hits.
Run: `bun run lint`
Expected: clean.

- [ ] **Step 7: Run the affected suites**

Run: `bun test src/store/loopSync.test.ts src/store/loadLoop.test.ts src/store/loopSlice.test.ts src/store/songMode.test.ts src/store/store.test.ts src/App.test.tsx`
Expected: PASS. The "ONE store notification" test is the regression pin for this task.

- [ ] **Step 8: Run the full gate**

Run: `bun test && bun run lint && bun run eslint`
Expected: all green.

- [ ] **Step 9: Manual verification**

1. `bun run dev`, click to start audio. On the **Arrange** tab, add three loops so the list
   has four rows.
2. Go to the **Chords** tab, change the key root, then return to **Arrange** and click
   **Edit** on a different loop, then back to the first.
   Expected: the key root you set is still there — the edit was mirrored into `loops[]`.
3. On **Arrange**, change a loop's channel mix (a `setLoopMix` write) for a NON-active loop.
   Expected: the value sticks on that card and the active loop's mix is unchanged.
4. Change the mix of the ACTIVE loop.
   Expected: the change is immediately audible (the flat slices moved too) and the card shows
   it.
5. Reorder loops by drag, rename one, set a repeat count, then reload the page.
   Expected: order, name, repeat count and every per-loop edit survive.
6. With the sequencer playing, drag a synth knob on the **Synth** tab.
   Expected: no audio stutter; DevTools → Local Storage shows the project updating.

**Rollback:** revert this task alone with `git revert <sha>`. It touches
`src/store/loopSync.ts`, `src/store/loopSync.test.ts`, `src/store/store.ts` (one import and
the eleven `createXSlice(set` call sites) and `src/App.tsx` (one import, one call). To
restore the old behaviour without a full revert, re-add `startLoopSync`/`useLoopSync` to
`loopSync.ts`, call `useLoopSync()` in `App.tsx`, and pass the raw `set` to the slices again —
`loopMirrorPartial` can stay, unused, since nothing else imports it.

- [ ] **Step 10: Commit**

```bash
git add src/store/loopSync.ts src/store/loopSync.test.ts src/store/store.ts src/App.tsx
git commit -m "perf(store): fold the loop sync-back mirror into the originating set()

loopSync mirrored any of the 31 per-loop fields into loops[] through a SECOND
independent setState, so every gesture tick paid two partialize +
JSON.stringify + setItem cycles and sent a second render wave through
ArrangeView, every SortableLoopCard (via dnd-kit context, bypassing memo),
TransportBar and LoopSelector. The mirror is now computed by the pure
loopMirrorPartial and emitted inside the same set(), producing an identical
loops array with one notification instead of two. loadLoop still owns the
activeLoopId switch and is deliberately not mirrored.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---
### Task 15: rAF-coalesce the store→engine parameter bridge

`src/store/engineSync.ts:102-123` forwards `effects` and the three `SynthParams` objects into
the engine on every shallow-unequal change, with nothing between the store and the engine.
`audioEngine.updateSynthParams` (`src/audio/engine.ts:1158-1220`) then iterates
`reshapeableVoices(source)` and, **per live voice**, issues ~15-20 AudioParam operations:
`cancelAndHold` + `setTargetAtTime` on `osc.detune` (`:1169-1170`), `filter.frequency`
(`:1173-1174`), `filter.Q` (`:1175-1176`), `subGain.gain` (`:1179-1180`), the noise gain
(`:1182`), the LFO block (`:1192`), `gains[0].gain` (`:1201-1202`), plus a possible
`releaseVoice` re-plan (`:1216-1218`). Every `cancelAndHold` is a `param.value` read followed
by `cancelAndHoldAtTime`, and each takes the AudioParam timeline lock, contending with the
render thread. Eight held voices during a knob drag is on the order of 8,600 lock
acquisitions per second.

**How a continuous change is distinguished from a discrete one.** The coalescer is keyed
(`'effects'`, `'synth'`, `'chord'`, `'bass'`) and **leading-edge**: the first value for a key
is applied *synchronously, in the same tick*, and a frame is armed. A key is treated as
continuous exactly when a **second value for that same key** arrives before the armed frame
drains — only then is it deferred, and only the latest value survives. So:

- a preset load, a vibe apply, a bypass toggle, an `fireImmediately` bootstrap → one value
  per key → **applied immediately, zero added latency**;
- a vibe apply that writes `synthParams`, `chordSynthParams`, `bassSynthParams` and `effects`
  in one action → four distinct keys → all four applied immediately;
- a knob drag → repeated values on one key → capped at one engine call per animation frame.

Honest bound: Chrome already coalesces `pointermove` to roughly one per frame, so on a 60 Hz
display in Chrome this is close to a no-op. It pays on high-refresh displays, on trackpads
that emit sub-frame events, and in Firefox/Safari, and it guarantees the cap regardless of
input rate. That is the claim — not that it halves the work everywhere.

**Files:**
- Create: `src/utils/frameCoalescer.ts`
- Create: `src/utils/frameCoalescer.test.ts`
- Modify: `src/store/engineSync.ts:1-8` (imports), `:56` (create the coalescer), `:102-123`
  (route the four subscriptions through it), `:152-157` (`stopCurrent` cancels it)

**Interfaces:**
- Consumes: nothing outside `globalThis`.
- Produces:
  ```ts
  export interface FrameScheduler {
    request: (fn: () => void) => number;
    cancel: (handle: number) => void;
  }

  export const rafScheduler: FrameScheduler;

  export interface FrameCoalescer {
    /** Leading-edge: applies `apply` now if this key has not applied inside the
     *  current frame window, otherwise stores it as the key's pending value. */
    push(key: string, apply: () => void): void;
    /** Runs every pending thunk now and cancels the armed frame. */
    flush(): void;
    /** Drops every pending thunk and cancels the armed frame. */
    cancel(): void;
    /** Keys with a thunk still pending. Test/diagnostic use only. */
    pendingKeys(): string[];
  }

  export function createFrameCoalescer(scheduler?: FrameScheduler): FrameCoalescer;
  ```

- [ ] **Step 1: Write the failing test file**

Create `src/utils/frameCoalescer.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createFrameCoalescer, type FrameScheduler } from './frameCoalescer';

/** A frame scheduler the test drives by hand — no rAF, no timers, no sleeping. */
function manualFrames() {
  let next = 1;
  const queued = new Map<number, () => void>();
  const scheduler: FrameScheduler = {
    request: (fn) => {
      const handle = next++;
      queued.set(handle, fn);
      return handle;
    },
    cancel: (handle) => {
      queued.delete(handle);
    },
  };
  const tick = () => {
    const due = [...queued.values()];
    queued.clear();
    due.forEach((fn) => fn());
  };
  return { scheduler, tick, armed: () => queued.size };
}

describe('createFrameCoalescer', () => {
  test('the first value for a key applies synchronously (discrete change, no latency)', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));

    expect(log).toEqual(['a']);
    expect(frames.armed()).toBe(1);
  });

  test('several DISTINCT keys in one tick all apply immediately', () => {
    // A vibe apply writes synthParams + chordSynthParams + bassSynthParams +
    // effects in one action; none of them may be delayed.
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('effects', () => log.push('fx'));
    c.push('synth', () => log.push('s'));
    c.push('chord', () => log.push('c'));
    c.push('bass', () => log.push('b'));

    expect(log).toEqual(['fx', 's', 'c', 'b']);
    expect(c.pendingKeys()).toEqual([]);
  });

  test('a repeat of the SAME key inside the window defers, and only the last one lands', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('v1'));
    c.push('synth', () => log.push('v2'));
    c.push('synth', () => log.push('v3'));

    expect(log).toEqual(['v1']);
    expect(c.pendingKeys()).toEqual(['synth']);

    frames.tick();
    expect(log).toEqual(['v1', 'v3']);
    expect(c.pendingKeys()).toEqual([]);
  });

  test('a sustained gesture is capped at one apply per frame', () => {
    const frames = manualFrames();
    const log: number[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    // Two pointer events per frame for four frames.
    let n = 0;
    for (let frame = 0; frame < 4; frame++) {
      c.push('synth', () => log.push(n));
      n++;
      c.push('synth', () => log.push(n));
      n++;
      frames.tick();
    }

    // leading 0, then the LAST value of each window: 1, 3, 5, 7.
    expect(log).toEqual([0, 1, 3, 5, 7]);
  });

  test('a frame that drains nothing does not re-arm, so the next push is leading again', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));
    frames.tick(); // nothing pending
    expect(frames.armed()).toBe(0);

    c.push('synth', () => log.push('b'));
    expect(log).toEqual(['a', 'b']); // applied immediately, not deferred
  });

  test('a frame that DID drain re-arms, so the cap holds across a long gesture', () => {
    const frames = manualFrames();
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => {});
    c.push('synth', () => {});
    frames.tick();

    expect(frames.armed()).toBe(1);
  });

  test('flush() applies pending work now and cancels the frame', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));
    c.push('synth', () => log.push('b'));
    c.flush();

    expect(log).toEqual(['a', 'b']);
    expect(frames.armed()).toBe(0);
    frames.tick();
    expect(log).toEqual(['a', 'b']); // no double apply
  });

  test('cancel() drops pending work without applying it', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));
    c.push('synth', () => log.push('b'));
    c.cancel();
    frames.tick();

    expect(log).toEqual(['a']);
    expect(c.pendingKeys()).toEqual([]);
  });

  test('keys are independent: a busy key never blocks a quiet one', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('s1'));
    c.push('synth', () => log.push('s2')); // deferred
    c.push('bass', () => log.push('b1')); // first for its key -> immediate

    expect(log).toEqual(['s1', 'b1']);
    frames.tick();
    expect(log).toEqual(['s1', 'b1', 's2']);
  });

  test('a throwing thunk does not strand the coalescer', () => {
    const frames = manualFrames();
    const log: string[] = [];
    const c = createFrameCoalescer(frames.scheduler);

    c.push('synth', () => log.push('a'));
    c.push('synth', () => {
      throw new Error('engine blew up');
    });
    expect(() => frames.tick()).not.toThrow();
    expect(c.pendingKeys()).toEqual([]);

    c.push('synth', () => log.push('c'));
    expect(log).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/utils/frameCoalescer.test.ts`
Expected: FAIL — cannot resolve `./frameCoalescer`.

- [ ] **Step 3: Write the coalescer**

Create `src/utils/frameCoalescer.ts`:

```ts
export interface FrameScheduler {
  request: (fn: () => void) => number;
  cancel: (handle: number) => void;
}

// requestAnimationFrame / cancelAnimationFrame must be used as a pair, so the
// capability is probed once for both. Outside a browser (bun, SSR) a 16 ms
// timer stands in — it never runs synchronously, which is exactly what the
// leading-edge rule below relies on to keep one-shot changes immediate.
const HAS_RAF =
  typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';

export const rafScheduler: FrameScheduler = {
  request: (fn) =>
    HAS_RAF ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number),
  cancel: (handle) => {
    if (HAS_RAF) cancelAnimationFrame(handle);
    else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

export interface FrameCoalescer {
  push(key: string, apply: () => void): void;
  flush(): void;
  cancel(): void;
  pendingKeys(): string[];
}

/**
 * Caps a keyed stream of "latest value wins" work at one application per
 * animation frame, WITHOUT delaying one-shot changes.
 *
 * Leading edge: the first value for a key inside the current frame window is
 * applied synchronously. A key is only treated as continuous once a SECOND
 * value for it arrives before the armed frame drains — so a preset load, a
 * vibe apply or a bootstrap (one value per key) is never deferred, while a
 * knob drag (many values on one key) collapses to one apply per frame.
 *
 * Used by store/engineSync.ts, where each application is an
 * updateSynthParams / updateEffects call that re-targets every live voice with
 * ~15-20 timeline-locking AudioParam operations apiece.
 */
export function createFrameCoalescer(
  scheduler: FrameScheduler = rafScheduler,
): FrameCoalescer {
  const pending = new Map<string, () => void>();
  let appliedThisWindow = new Set<string>();
  let handle: number | null = null;

  const cancelFrame = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  const runThunk = (apply: () => void): void => {
    try {
      apply();
    } catch {
      // A failing engine call must not strand the queue; the next value for
      // the same key supersedes it anyway.
    }
  };

  const drain = (): void => {
    handle = null;
    const due = [...pending];
    pending.clear();
    appliedThisWindow = new Set(due.map(([key]) => key));
    for (const [, apply] of due) runThunk(apply);
    // Re-arm only while work is still flowing, so an idle coalescer schedules
    // nothing at all.
    if (due.length > 0) handle = scheduler.request(drain);
  };

  return {
    push: (key, apply) => {
      if (handle === null) {
        runThunk(apply);
        appliedThisWindow = new Set([key]);
        handle = scheduler.request(drain);
        return;
      }
      if (!appliedThisWindow.has(key)) {
        runThunk(apply);
        appliedThisWindow.add(key);
        return;
      }
      pending.set(key, apply);
    },
    flush: () => {
      cancelFrame();
      const due = [...pending.values()];
      pending.clear();
      appliedThisWindow = new Set();
      for (const apply of due) runThunk(apply);
    },
    cancel: () => {
      pending.clear();
      appliedThisWindow = new Set();
      cancelFrame();
    },
    pendingKeys: () => [...pending.keys()],
  };
}
```

- [ ] **Step 4: Run the coalescer tests, confirm they pass**

Run: `bun test src/utils/frameCoalescer.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Route the four subscriptions through it**

In `src/store/engineSync.ts`, add to the imports after line 7
(`import { getMeter } from '../utils/meter';`):

```ts
import { createFrameCoalescer } from '../utils/frameCoalescer';
```

Insert after line 56 (`const subs: Array<() => void> = [];`) — insert **exactly** the lines below, with no extra blank line before them, so `engineSync.ts` ends this task at 193 lines and the offsets Task 16 cites (`:1-9` imports, `:27-47` `applySliceState`, `:113-119` effects) hold:

```ts
  // The parameter bridge is capped at one engine call per key per animation
  // frame. updateSynthParams re-targets EVERY live voice with ~15-20
  // timeline-locking AudioParam operations, so an unthrottled knob drag with
  // 8 held voices is thousands of lock acquisitions a second on the same
  // thread as the 25 ms scheduler. The coalescer is leading-edge, so a
  // one-shot change (preset load, vibe apply, the fireImmediately bootstrap)
  // still reaches the engine in the same tick — only a REPEAT on the same key
  // inside one frame is deferred.
  const paramFrames = createFrameCoalescer();
```

Replace lines 102-108 (the effects subscription):

```ts
  subs.push(
    useAppStore.subscribe(
      (s) => s.effects,
      (effects) => paramFrames.push('effects', () => audioEngine.updateEffects(effects)),
      { equalityFn: shallow, fireImmediately: true },
    ),
  );
```

Replace lines 115-123 (the three synth-source subscriptions):

```ts
  for (const [field, source] of synthSources) {
    subs.push(
      useAppStore.subscribe(
        (s) => s[field],
        (params) =>
          paramFrames.push(source, () => audioEngine.updateSynthParams(params, source)),
        { equalityFn: shallow, fireImmediately: true },
      ),
    );
  }
```

- [ ] **Step 6: Cancel the coalescer on teardown**

Replace lines 152-157:

```ts
  stopCurrent = () => {
    for (const unsub of subs) unsub();
    subs.length = 0;
    // Drop, don't flush: stopping the bridge means the engine must stop
    // receiving store values, and a flush would fire a call after the last
    // subscription was already torn down.
    paramFrames.cancel();
    syncStarted = false;
    stopCurrent = null;
  };
```

- [ ] **Step 7: Add a regression test for the leading edge**

Append inside the existing `describe('engineSync', ...)` block in
`src/store/engineSync.test.ts`, after the test at `:129-140`:

```ts
  test('a one-shot params change reaches the engine in the same tick', () => {
    // The coalescer is leading-edge on purpose: a preset load or a vibe apply
    // must NOT wait for an animation frame.
    const updateSynthParams = spyOn(audioEngine, 'updateSynthParams').mockImplementation(
      () => {},
    );
    startEngineSync();
    updateSynthParams.mockClear();

    useAppStore.setState((s) => ({ synthParams: { ...s.synthParams, detune: 11 } }));

    expect(updateSynthParams).toHaveBeenCalledTimes(1);
    expect(updateSynthParams.mock.calls[0][0].detune).toBe(11);
    expect(updateSynthParams.mock.calls[0][1]).toBe('synth');
    updateSynthParams.mockRestore();
  });

  test('one action touching three param sources applies all three immediately', () => {
    const updateSynthParams = spyOn(audioEngine, 'updateSynthParams').mockImplementation(
      () => {},
    );
    startEngineSync();
    updateSynthParams.mockClear();

    useAppStore.setState((s) => ({
      synthParams: { ...s.synthParams, detune: 3 },
      chordSynthParams: { ...s.chordSynthParams, detune: 4 },
      bassSynthParams: { ...s.bassSynthParams, detune: 5 },
    }));

    expect(updateSynthParams.mock.calls.map((c) => c[1]).sort()).toEqual([
      'bass',
      'chord',
      'synth',
    ]);
    updateSynthParams.mockRestore();
  });
```

- [ ] **Step 8: Run the suites**

Run: `bun test src/store/engineSync.test.ts src/utils/frameCoalescer.test.ts`
Expected: PASS. The pre-existing tests at `:105-115`, `:117-127` and `:129-140` must still
pass unchanged — that is the proof the leading edge preserved the current contract.

Run: `bun test && bun run lint && bun run eslint`
Expected: all green (`eslint` because this adds a `store/` → `utils/` import).

- [ ] **Step 9: Manual verification**

1. `bun run dev`, click to start audio, **Synth** tab, hold a three-note chord on the QWERTY
   keyboard with a long Release so several voices are live.
2. While holding, drag **Filter Cutoff** slowly across its full range.
   Expected: a smooth continuous sweep, no zipper noise, no clicks, no voices dropping out.
3. Release, then click through five different synth presets in the library.
   Expected: each preset's timbre is heard the instant it is clicked, with no perceptible
   lag — this is the leading edge doing its job.
4. Click an Instant Vibe chip.
   Expected: the whole patch (synth + chord + bass + effects) changes at once, immediately.
5. Start the Chords player, then drag Cutoff.
   Expected: the chords keep their timing.

- [ ] **Step 10: Commit**

```bash
git add src/utils/frameCoalescer.ts src/utils/frameCoalescer.test.ts src/store/engineSync.ts src/store/engineSync.test.ts
git commit -m "perf(engine-sync): cap the parameter bridge at one engine call per frame

updateSynthParams issues ~15-20 timeline-locking AudioParam operations per
live voice, and engineSync forwarded every store change straight through with
no throttle. The bridge now routes effects and the three SynthParams sources
through a keyed, leading-edge frame coalescer: the first value for a key still
applies synchronously, so a preset load, a vibe apply and the fireImmediately
bootstrap are not delayed at all; only a repeat on the same key inside one
frame is deferred, which is exactly the continuous-gesture case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**Rollback:** revert with `git revert <sha>`. Only `engineSync.ts` consumes the coalescer; to
disable the coalescing while keeping the module, change the four listeners back to calling
`audioEngine.updateEffects(effects)` / `audioEngine.updateSynthParams(params, source)`
directly and delete the `paramFrames.cancel()` line.

---

### Task 16: Commit reverb Decay on release instead of once per pointer frame

`src/audio/engine.ts:1514-1518`, inside `updateEffects`:

```ts
const nextDecay = this.quantiseDecay(fx.reverbDecay);
if (this.reverbNode && nextDecay !== this.reverbDecay) {
  this.reverbNode.buffer = this.getImpulseResponse(nextDecay);
  this.reverbDecay = nextDecay;
}
```

`quantiseDecay` (`:504-506`) rounds to 0.1 s — **the Decay knob's own step** — so a monotonic
drag produces a new quantised value on essentially every pointer frame. The 8-entry LRU
(`:190`, `IMPULSE_CACHE_MAX = 8`) cannot help a sweep: 0.1 → 10 s crosses ~100 distinct
decays, so every one is a miss. Each miss is a `buildImpulseResponse` (measured locally:
0.8 ms at a 2 s decay, 3.0 ms at 8 s, allocating up to 3.8 MB of `Float32Array`) **and** a
`ConvolverNode.buffer =` assignment, which is not a pointer swap — Blink rebuilds the whole
partitioned-FFT reverb and takes the graph lock. The engine's own field comment at `:103-107`
already concedes the cache "skips the expensive rebuild, not the swap itself". A 2-second
sweep is ~60-100 of both, on the thread that owns the 25 ms scheduler, whose stall detector
(the stall detector at `:283`, threshold constant at `:177`, 50 ms — `:294` is `this.clockNextStepTime += stepDuration;`) then re-anchors the grid and the sequence audibly jumps.

The fix keeps the audible end state identical: the *wet* control (`reverbGain`, `:1523`) is
already a smooth `setTargetAtTime` and stays continuous; only the *structural* impulse swap
is deferred to a trailing commit ~180 ms after the last movement. A sweep then rebuilds
**once**, with the final value. Debouncing a reverb length is what hardware does anyway.

The timing policy lives in `engineSync.ts` (the store→engine bridge already owns policy such
as the `shallow` equality functions), so the engine stays synchronous and fully testable, and
no wall-clock timer enters `src/audio/`.

**Files:**
- Create: `src/utils/trailingDebounce.ts`
- Create: `src/utils/trailingDebounce.test.ts`
- Modify: `src/audio/engine.ts:1500-1518` (extract `setReverbDecay`, drop decay from
  `updateEffects`)
- Modify: `src/store/engineSync.ts:1-9` (imports), `:27-47` (`applySliceState`), `:113-119`
  — **post-Task-15 numbers**: Task 15 inserts one import line after `:7` and a ten-line
  `paramFrames` block after `:56`, so everything below the coalescer is +11 and everything
  between the imports and it is +1
  (effects equality), plus the new decay subscription and teardown
- Modify (test): `src/audio/engine.test.ts:653-743` (five reverb tests),
  `src/store/engineSync.test.ts`

**Interfaces:**
- Consumes: **Task 15's output in `src/store/engineSync.ts`** — the `paramFrames` frame coalescer created just after `const subs`, the effects listener it already rewrote to push through that coalescer, and the `stopCurrent` teardown that already calls `paramFrames.cancel()`. Apply this task **on top of that shape**; do not restore the pre-Task-15 direct-call listener. Task 15 does not subsume this one: rAF coalescing still fires ~60×/s, which still misses the impulse cache on every frame of a Decay sweep, and this task moves decay onto a separate subscription that never goes through `paramFrames` at all. Also `clampEffectValue(key: EffectNumericKey, value: unknown): number` from
  `src/audio/effectLimits.ts`; `MasterEffects` from `src/types.ts`.
- Produces:
  ```ts
  // src/utils/trailingDebounce.ts
  export interface DebounceScheduler {
    schedule: (fn: () => void, delayMs: number) => number;
    cancel: (handle: number) => void;
  }
  export const timerDebounceScheduler: DebounceScheduler;

  export interface TrailingDebounce<T> {
    /** Records `value` and (re)starts the delay. Nothing is committed yet. */
    push(value: T): void;
    /** Commits the pending value now, if any, and clears the timer. */
    flush(): void;
    /** Drops the pending value and clears the timer. */
    cancel(): void;
    /** Whether a value is waiting to be committed. */
    isPending(): boolean;
  }

  export function createTrailingDebounce<T>(
    commit: (value: T) => void,
    delayMs: number,
    scheduler?: DebounceScheduler,
  ): TrailingDebounce<T>;
  ```
  ```ts
  // src/audio/engine.ts — new public method on the audioEngine singleton
  setReverbDecay(decay: number): void;
  ```
  ```ts
  // src/store/engineSync.ts
  export const REVERB_DECAY_COMMIT_MS: 180;
  ```

- [ ] **Step 1: Write the failing debounce tests**

Create `src/utils/trailingDebounce.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createTrailingDebounce, type DebounceScheduler } from './trailingDebounce';

/** A scheduler the test drives by hand — no timers, no sleeping. */
function manualTimers() {
  let next = 1;
  const queued = new Map<number, () => void>();
  const scheduler: DebounceScheduler = {
    schedule: (fn) => {
      const handle = next++;
      queued.set(handle, fn);
      return handle;
    },
    cancel: (handle) => {
      queued.delete(handle);
    },
  };
  const fire = () => {
    const due = [...queued.values()];
    queued.clear();
    due.forEach((fn) => fn());
  };
  return { scheduler, fire, armed: () => queued.size };
}

describe('createTrailingDebounce', () => {
  test('a single push commits nothing until the delay elapses', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(1);
    expect(committed).toEqual([]);
    expect(d.isPending()).toBe(true);

    timers.fire();
    expect(committed).toEqual([1]);
    expect(d.isPending()).toBe(false);
  });

  test('a whole sweep commits ONCE, with the final value', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    for (let i = 1; i <= 100; i++) d.push(i / 10);

    expect(committed).toEqual([]);
    expect(timers.armed()).toBe(1); // the timer was RESTARTED, not stacked
    timers.fire();
    expect(committed).toEqual([10]);
  });

  test('the timer restarts on every push, so the commit trails the LAST one', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(1);
    d.push(2);
    timers.fire();
    expect(committed).toEqual([2]);

    d.push(3);
    timers.fire();
    expect(committed).toEqual([2, 3]);
  });

  test('flush() commits the pending value immediately and disarms', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(4.5);
    d.flush();

    expect(committed).toEqual([4.5]);
    expect(timers.armed()).toBe(0);
    timers.fire();
    expect(committed).toEqual([4.5]); // no double commit
  });

  test('flush() with nothing pending commits nothing', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.flush();

    expect(committed).toEqual([]);
  });

  test('cancel() drops the pending value', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(9);
    d.cancel();
    timers.fire();

    expect(committed).toEqual([]);
    expect(d.isPending()).toBe(false);
  });

  test('a value of 0 is still a real pending value', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(0);
    expect(d.isPending()).toBe(true);
    timers.fire();
    expect(committed).toEqual([0]);
  });

  test('a throwing commit clears the pending state instead of stranding it', () => {
    const timers = manualTimers();
    let calls = 0;
    const d = createTrailingDebounce<number>(
      () => {
        calls++;
        throw new Error('convolver rejected the buffer');
      },
      180,
      timers.scheduler,
    );

    d.push(1);
    expect(() => timers.fire()).not.toThrow();
    expect(d.isPending()).toBe(false);

    d.push(2);
    timers.fire();
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/utils/trailingDebounce.test.ts`
Expected: FAIL — cannot resolve `./trailingDebounce`.

- [ ] **Step 3: Write the debouncer**

Create `src/utils/trailingDebounce.ts`:

```ts
export interface DebounceScheduler {
  schedule: (fn: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
}

export const timerDebounceScheduler: DebounceScheduler = {
  schedule: (fn, delayMs) => setTimeout(fn, delayMs) as unknown as number,
  cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
};

export interface TrailingDebounce<T> {
  push(value: T): void;
  flush(): void;
  cancel(): void;
  isPending(): boolean;
}

/**
 * Classic trailing debounce: `push` records the latest value and RESTARTS the
 * delay, so a continuous gesture commits exactly once, with its final value.
 * The scheduler is injectable so tests drive it synchronously.
 *
 * Used for the reverb Decay knob, whose commit rebuilds a multi-megabyte
 * impulse response and re-partitions the ConvolverNode.
 */
export function createTrailingDebounce<T>(
  commit: (value: T) => void,
  delayMs: number,
  scheduler: DebounceScheduler = timerDebounceScheduler,
): TrailingDebounce<T> {
  // A box, not a bare `T | null`, so 0 / '' / false are legitimate values.
  let pending: { value: T } | null = null;
  let handle: number | null = null;

  const disarm = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  const commitNow = (): void => {
    handle = null;
    const box = pending;
    // Clear BEFORE committing: a throwing commit must not leave the value
    // pending for an endless retry.
    pending = null;
    if (!box) return;
    try {
      commit(box.value);
    } catch {
      // ignore — the next push supersedes it
    }
  };

  return {
    push: (value) => {
      pending = { value };
      disarm();
      handle = scheduler.schedule(commitNow, delayMs);
    },
    flush: () => {
      disarm();
      commitNow();
    },
    cancel: () => {
      pending = null;
      disarm();
    },
    isPending: () => pending !== null,
  };
}
```

- [ ] **Step 4: Run the debounce tests, confirm they pass**

Run: `bun test src/utils/trailingDebounce.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Extract `setReverbDecay` in the engine**

Read `.claude/skills/dsp-audio/SKILL.md` before this step — it covers the AudioParam and
node-lifecycle traps this method sits next to.

In `src/audio/engine.ts`, change the import on line 12 from:

```ts
import { clampEffects } from './effectLimits';
```

to:

```ts
import { clampEffects, clampEffectValue } from './effectLimits';
```

Delete lines 1514-1518 from `updateEffects`:

```ts
    const nextDecay = this.quantiseDecay(fx.reverbDecay);
    if (this.reverbNode && nextDecay !== this.reverbDecay) {
      this.reverbNode.buffer = this.getImpulseResponse(nextDecay);
      this.reverbDecay = nextDecay;
    }
```

and insert this method immediately **before** `updateEffects` (i.e. before line 1500):

```ts
  /**
   * Structural half of the reverb control, split out of updateEffects so the
   * store bridge can commit it on gesture end.
   *
   * Assigning ConvolverNode.buffer is not a pointer swap: Blink rebuilds the
   * partitioned-FFT reverb and takes the graph lock, and a miss in
   * impulseCache additionally builds sampleRate * decay * 2 channels of
   * Float32Array on the main thread. quantiseDecay's 0.1 s step equals the
   * Decay knob's own step, so an unthrottled drag missed the cache on every
   * pointer frame — see engineSync's REVERB_DECAY_COMMIT_MS.
   *
   * The audible WET amount (reverbGain) is unaffected and stays continuous.
   */
  setReverbDecay(decay: number): void {
    if (!this.ctx || !this.reverbNode) return;
    // Clamped here, not by the caller: updateEffects used to clamp the whole
    // effects object before this ran, and a persisted or imported project is
    // untrusted input (a non-finite decay becomes a NaN buffer length).
    const nextDecay = this.quantiseDecay(clampEffectValue('reverbDecay', decay));
    if (nextDecay === this.reverbDecay) return;
    this.reverbNode.buffer = this.getImpulseResponse(nextDecay);
    this.reverbDecay = nextDecay;
  }
```

- [ ] **Step 6: Migrate the five engine reverb tests**

In `src/audio/engine.test.ts`, inside `describe('live effect knobs', ...)`, replace every
`engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: X })` with
`engine.setReverbDecay(X)`. The exact edits:

- `:662` → `engine.setReverbDecay(4.5);`
- `:677` → `engine.setReverbDecay(2.0);`
- `:679` → `engine.setReverbDecay(4.5);`
- `:684` → `engine.setReverbDecay(4.5);`
- `:699` (inside the `for (const d of [3.0, 3.04, 3.02, 3.1, 3.14, 3.0, 3.1])` loop) →
  `engine.setReverbDecay(d);`
- `:714` → `engine.setReverbDecay(-5);`
- `:716` → `engine.setReverbDecay(900);`
- `:731` (inside the `for (const d of [1.0, ... 1.7])` loop) → `engine.setReverbDecay(d);`
- `:736`, `:737`, `:738` → `engine.setReverbDecay(1.0);` / `(1.8);` / `(1.9);`

Every assertion (`buildSpy` args, call counts, cache size, LRU eviction) stays exactly as it
is — the behaviour is unchanged, only the entry point moved. If `INITIAL_EFFECTS` becomes an
unused import in that block, leave it: the compressor and clamp tests below still use it.

- [ ] **Step 7: Run the engine suite**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS.

- [ ] **Step 8: Split the decay out of the effects subscription**

In `src/store/engineSync.ts`, add to the imports:

```ts
import { createTrailingDebounce } from '../utils/trailingDebounce';
import type { MasterEffects } from '../types';
```

Add above `function applySliceState()` (line 27 after Task 15's import insert; line 26 pre-branch):

```ts
/**
 * Trailing-commit window for the reverb Decay knob. Long enough that a
 * continuous sweep rebuilds the impulse exactly once (on release), short
 * enough to read as immediate. The wet amount is a separate, continuous
 * AudioParam ramp, so the knob still sounds live while the tail length waits.
 */
export const REVERB_DECAY_COMMIT_MS = 180;

// Every MasterEffects field EXCEPT reverbDecay, which has its own debounced
// subscription below. Comparing on this list keeps a decay drag from also
// re-running updateEffects' seven setTargetAtTime calls for nothing.
const EFFECT_KEYS_EXCEPT_DECAY = [
  'reverbWet',
  'reverbBypass',
  'delayWet',
  'delayFeedback',
  'delayBypass',
  'distortionWet',
  'distortionBypass',
  'eqLow',
  'eqMid',
  'eqHigh',
  'eqBypass',
  'compressorThreshold',
] as const;

function effectsEqualExceptDecay(a: MasterEffects, b: MasterEffects): boolean {
  for (const key of EFFECT_KEYS_EXCEPT_DECAY) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
```

Add to `applySliceState()`, immediately after the `audioEngine.updateEffects(s.effects);` line (line 43 after Task 15; line 42 pre-branch):

```ts
  // Applied DIRECTLY, not through the debounce: applyEngineSnapshot runs once
  // right after init(), when every earlier setter was a no-op, so the impulse
  // must exist before the first note.
  audioEngine.setReverbDecay(s.effects.reverbDecay);
```

Change the effects subscription's equality function (the `{ equalityFn: shallow, ... }`
option — pre-existing at `:106`, post-Task-15 `:116`; Task 15 kept it while rewriting the listener body around it) to:

```ts
      { equalityFn: effectsEqualExceptDecay, fireImmediately: true },
```

and add the decay subscription immediately after that `subs.push(...)` block:

```ts
  // Decay is STRUCTURAL: committing it rebuilds a multi-megabyte impulse and
  // re-partitions the ConvolverNode, and quantiseDecay's 0.1 s step equals the
  // knob's own step, so an unthrottled drag rebuilt on ~every pointer frame
  // and starved the 25 ms scheduler. Commit on gesture end instead; the wet
  // amount above stays continuous, so the knob is still audibly live.
  const decayCommit = createTrailingDebounce<number>(
    (decay) => audioEngine.setReverbDecay(decay),
    REVERB_DECAY_COMMIT_MS,
  );
  subs.push(
    useAppStore.subscribe(
      (s) => s.effects.reverbDecay,
      (decay) => decayCommit.push(decay),
      { fireImmediately: true },
    ),
  );
```

Finally, extend the teardown Task 15 produced (post-Task-15 lines 163-172). `decayCommit` is declared in the same `startEngineSync` scope, so it is in view there:

```ts
    paramFrames.cancel();
    decayCommit.cancel();
```

- [ ] **Step 9: Add the bridge regression tests**

Append inside `describe('engineSync', ...)` in `src/store/engineSync.test.ts`:

```ts
  test('a reverbDecay drag does not re-run updateEffects', () => {
    const updateEffects = spyOn(audioEngine, 'updateEffects').mockImplementation(() => {});
    const setReverbDecay = spyOn(audioEngine, 'setReverbDecay').mockImplementation(() => {});
    startEngineSync();
    updateEffects.mockClear();
    setReverbDecay.mockClear();

    for (const d of [2.1, 2.2, 2.3, 2.4]) {
      useAppStore.setState((s) => ({ effects: { ...s.effects, reverbDecay: d } }));
    }

    // Decay is committed on a trailing timer, and the wet-path listener must
    // not fire at all for a decay-only change.
    expect(updateEffects).not.toHaveBeenCalled();
    expect(setReverbDecay).not.toHaveBeenCalled();
    updateEffects.mockRestore();
    setReverbDecay.mockRestore();
  });

  test('applyEngineSnapshot applies the decay directly, bypassing the debounce', () => {
    const setReverbDecay = spyOn(audioEngine, 'setReverbDecay').mockImplementation(() => {});
    useAppStore.setState((s) => ({ effects: { ...s.effects, reverbDecay: 3.3 } }));
    setReverbDecay.mockClear();

    applyEngineSnapshot();

    expect(setReverbDecay).toHaveBeenCalledWith(3.3);
    setReverbDecay.mockRestore();
  });
```

- [ ] **Step 10: Run the full gate**

Run: `bun test && bun run lint && bun run eslint`
Expected: all green. Note that the pre-existing test at `engineSync.test.ts:117-127` (a
`reverbWet` change reaching `updateEffects`) must still pass — that is the proof the new
equality function did not break the wet path.

- [ ] **Step 11: Manual verification**

1. `bun run dev`, click to start audio, go to the **Master FX** tab.
2. Raise **Reverb Wet** to about 60% and start the Chords player so there is a sustained
   source feeding the reverb.
3. Drag the **Reverb Decay** knob slowly from its minimum to its maximum over ~2 seconds.
   Expected: the readout tracks the pointer continuously; the chord playback does **not**
   stutter or jump (before this task the impulse rebuilt ~60-100 times, tripping the clock
   stall detector at `engine.ts:294`).
4. Release the knob and hold still for a moment.
   Expected: within ~0.2 s the tail audibly lengthens to the final value.
5. Set Decay to a low value, release, then to a high value, release.
   Expected: two clearly different tail lengths — the committed end state matches the knob.
6. Drag **Reverb Wet** during playback. Expected: still perfectly smooth and immediate.
7. Reload the page with a non-default Decay set, click once to start audio, play a chord.
   Expected: the persisted tail length is audible on the first chord (`applyEngineSnapshot`
   applied it directly).

- [ ] **Step 12: Commit**

```bash
git add src/utils/trailingDebounce.ts src/utils/trailingDebounce.test.ts src/audio/engine.ts src/audio/engine.test.ts src/store/engineSync.ts src/store/engineSync.test.ts
git commit -m "perf(reverb): commit the Decay impulse on gesture end, not per pointer frame

quantiseDecay's 0.1 s step equals the Decay knob's own step, so a sweep missed
the 8-entry impulse LRU on essentially every pointer frame: ~60-100 impulse
builds (0.8-3.0 ms and up to 3.8 MB each) plus ~60-100 graph-lock-taking
ConvolverNode re-partitions, on the thread that owns the 25 ms scheduler. The
structural swap is now audioEngine.setReverbDecay(), driven by a trailing
180 ms debounce in engineSync, so a sweep rebuilds once with the final value.
The wet amount keeps its continuous AudioParam ramp, and applyEngineSnapshot
applies the decay directly so the persisted tail exists before the first note.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---
### Task 17: Create the 16th-note step publisher

Four clock subscribers call a React `setState` on every 16th note (8 Hz at 120 BPM, 16 Hz at
240), and `App.tsx:106-113` keeps every view mounted behind `block`/`hidden` by design, so
three of the four re-render views the user cannot see. In each case the step is consumed by a
**leaf** — a `StepRow`, a `translateX`, a step-highlight class — but published from the top of
a 1200-1400-line view.

This task builds the shared plumbing: a tiny external store that a leaf can read through
`useSyncExternalStore` without its ancestors re-rendering. The codebase already has a
`useSyncExternalStore` precedent with a documented rationale at
`src/components/ui/BottomInputDock.tsx:9-30`.

It is pure logic and is TDD'd completely here; Tasks 18, 19, 21 and 22 consume it.

**Files:**
- Create: `src/components/playbackStep.ts`
- Create: `src/components/playbackStep.test.ts`

**Interfaces:**
- Consumes: `useCallback`, `useSyncExternalStore` from `react`. **Nothing else** — this module
  is in `components/` and must never import `audio/engine` or the store.
- Produces:
  ```ts
  /** One id per clock-driven player that publishes a step. */
  export type StepPlayerId = 'chords' | 'lead' | 'sequencer';

  export interface StepPublisher {
    /** Records `step` for `player` and notifies its listeners — but only when
     *  the value actually changed, so a repeated step is a no-op. */
    publish(player: StepPlayerId, step: number): void;
    /** The player's current step; 0 before anything was published. */
    getStep(player: StepPlayerId): number;
    /** Subscribes to one player. Returns the unsubscribe function. */
    subscribe(player: StepPlayerId, listener: () => void): () => void;
    /** Sets a player (or every player) back to 0, notifying on a real change. */
    reset(player?: StepPlayerId): void;
  }

  /** An isolated publisher — used by tests; the app shares the singleton. */
  export function createStepPublisher(): StepPublisher;

  /** The app-wide singleton. */
  export const stepPublisher: StepPublisher;

  /** Convenience wrappers over the singleton, for clock callbacks. */
  export function publishStep(player: StepPlayerId, step: number): void;
  export function resetStep(player: StepPlayerId): void;

  /** Leaf-side subscription. Re-renders ONLY the component that calls it. */
  export function useCurrentStep(player: StepPlayerId): number;
  ```

- [ ] **Step 1: Write the failing test file**

Create `src/components/playbackStep.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createStepPublisher } from './playbackStep';

describe('createStepPublisher', () => {
  test('every player starts at step 0', () => {
    const pub = createStepPublisher();
    expect(pub.getStep('chords')).toBe(0);
    expect(pub.getStep('lead')).toBe(0);
    expect(pub.getStep('sequencer')).toBe(0);
  });

  test('publish records the step and notifies that player', () => {
    const pub = createStepPublisher();
    let notified = 0;
    pub.subscribe('lead', () => {
      notified += 1;
    });

    pub.publish('lead', 5);

    expect(pub.getStep('lead')).toBe(5);
    expect(notified).toBe(1);
  });

  test('publishing the SAME step again does not notify', () => {
    // The bail-out matters: the clock re-dispatches a step whenever the stall
    // detector re-anchors the grid, and a repeated notification would be a
    // guaranteed re-render for an unchanged value.
    const pub = createStepPublisher();
    let notified = 0;
    pub.subscribe('lead', () => {
      notified += 1;
    });

    pub.publish('lead', 5);
    pub.publish('lead', 5);
    pub.publish('lead', 5);

    expect(notified).toBe(1);
  });

  test('players are independent', () => {
    const pub = createStepPublisher();
    let chordNotified = 0;
    pub.subscribe('chords', () => {
      chordNotified += 1;
    });

    pub.publish('lead', 3);
    pub.publish('sequencer', 7);

    expect(chordNotified).toBe(0);
    expect(pub.getStep('chords')).toBe(0);
    expect(pub.getStep('lead')).toBe(3);
    expect(pub.getStep('sequencer')).toBe(7);
  });

  test('every listener on a player is notified', () => {
    const pub = createStepPublisher();
    const seen: string[] = [];
    pub.subscribe('chords', () => seen.push('a'));
    pub.subscribe('chords', () => seen.push('b'));

    pub.publish('chords', 1);

    expect(seen).toEqual(['a', 'b']);
  });

  test('unsubscribing stops notifications and is safe to repeat', () => {
    const pub = createStepPublisher();
    let notified = 0;
    const stop = pub.subscribe('chords', () => {
      notified += 1;
    });

    pub.publish('chords', 1);
    stop();
    stop();
    pub.publish('chords', 2);

    expect(notified).toBe(1);
    expect(pub.getStep('chords')).toBe(2);
  });

  test('reset(player) returns it to 0 and notifies only on a real change', () => {
    const pub = createStepPublisher();
    let notified = 0;
    pub.subscribe('lead', () => {
      notified += 1;
    });

    pub.publish('lead', 9);
    expect(notified).toBe(1);

    pub.reset('lead');
    expect(pub.getStep('lead')).toBe(0);
    expect(notified).toBe(2);

    pub.reset('lead'); // already 0
    expect(notified).toBe(2);
  });

  test('reset() with no argument resets every player', () => {
    const pub = createStepPublisher();
    pub.publish('chords', 4);
    pub.publish('lead', 5);
    pub.publish('sequencer', 6);

    pub.reset();

    expect(pub.getStep('chords')).toBe(0);
    expect(pub.getStep('lead')).toBe(0);
    expect(pub.getStep('sequencer')).toBe(0);
  });

  test('a throwing listener does not stop the others or corrupt the value', () => {
    const pub = createStepPublisher();
    const seen: string[] = [];
    pub.subscribe('chords', () => {
      throw new Error('render exploded');
    });
    pub.subscribe('chords', () => seen.push('b'));

    expect(() => pub.publish('chords', 2)).not.toThrow();
    expect(seen).toEqual(['b']);
    expect(pub.getStep('chords')).toBe(2);
  });

  test('a listener that unsubscribes during notification does not skip a sibling', () => {
    const pub = createStepPublisher();
    const seen: string[] = [];
    const stopB = pub.subscribe('chords', () => seen.push('b'));
    pub.subscribe('chords', () => {
      seen.push('a');
      stopB();
    });

    pub.publish('chords', 1);

    expect(seen).toEqual(['b', 'a']);
  });

  test('instances are isolated from each other', () => {
    const a = createStepPublisher();
    const b = createStepPublisher();

    a.publish('lead', 8);

    expect(b.getStep('lead')).toBe(0);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/components/playbackStep.test.ts`
Expected: FAIL — cannot resolve `./playbackStep`.

- [ ] **Step 3: Write the module**

Create `src/components/playbackStep.ts`:

```ts
import { useCallback, useSyncExternalStore } from 'react';

/** One id per clock-driven player that publishes a 16th-note step. */
export type StepPlayerId = 'chords' | 'lead' | 'sequencer';

const PLAYER_IDS: readonly StepPlayerId[] = ['chords', 'lead', 'sequencer'];

export interface StepPublisher {
  publish(player: StepPlayerId, step: number): void;
  getStep(player: StepPlayerId): number;
  subscribe(player: StepPlayerId, listener: () => void): () => void;
  reset(player?: StepPlayerId): void;
}

/**
 * A minimal external store for the transport's 16th-note position.
 *
 * Why it exists: the playback hooks own scheduling and must stay mounted
 * exactly once, high in the tree — but the step they produce is consumed by
 * LEAVES (a StepRow's highlight, a piano-roll playhead's translateX, a
 * sequencer column). Holding it in React state at the hook's mount point
 * re-rendered whole 1200-1400 line views 8-16 times a second, including views
 * on hidden tabs (App.tsx keeps every tab mounted by design, and display:none
 * skips layout and paint but NOT reconciliation).
 *
 * Publishing here and reading it with useSyncExternalStore in the leaf moves
 * the re-render to where the value is actually rendered. The same
 * useSyncExternalStore pattern, with the same "serve the live value for both
 * snapshots" rule, is documented at ui/BottomInputDock.tsx:9-30.
 *
 * `publish` is identity-checked, so a repeated step (the clock re-dispatches
 * one whenever the stall detector re-anchors the grid) costs nothing.
 */
export function createStepPublisher(): StepPublisher {
  const steps = new Map<StepPlayerId, number>();
  const listeners = new Map<StepPlayerId, Set<() => void>>();

  const notify = (player: StepPlayerId): void => {
    const set = listeners.get(player);
    if (!set) return;
    // Snapshot: a listener may unsubscribe itself (or a sibling) while running.
    for (const listener of [...set]) {
      try {
        listener();
      } catch {
        // One failing subscriber must not silence the rest.
      }
    }
  };

  const set = (player: StepPlayerId, step: number): void => {
    if ((steps.get(player) ?? 0) === step) return;
    steps.set(player, step);
    notify(player);
  };

  return {
    publish: set,
    getStep: (player) => steps.get(player) ?? 0,
    subscribe: (player, listener) => {
      let set = listeners.get(player);
      if (!set) {
        set = new Set();
        listeners.set(player, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    reset: (player) => {
      if (player) {
        set(player, 0);
        return;
      }
      for (const id of PLAYER_IDS) set(id, 0);
    },
  };
}

/** The app-wide singleton. One clock, one publisher. */
export const stepPublisher: StepPublisher = createStepPublisher();

/** Convenience wrapper for clock callbacks. */
export function publishStep(player: StepPlayerId, step: number): void {
  stepPublisher.publish(player, step);
}

/** Convenience wrapper for the stop/rewind paths. */
export function resetStep(player: StepPlayerId): void {
  stepPublisher.reset(player);
}

/**
 * Subscribes the CALLING component — and only it — to one player's step.
 * `getSnapshot` is served for the server snapshot too: the value is a number,
 * so React's Object.is check suppresses a render when it has not moved, and
 * renderToString then reflects whatever was last published rather than a
 * frozen 0 (same reasoning as ui/BottomInputDock.tsx's useLiveStore).
 */
export function useCurrentStep(player: StepPlayerId): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => stepPublisher.subscribe(player, onStoreChange),
    [player],
  );
  const getSnapshot = useCallback(() => stepPublisher.getStep(player), [player]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `bun test src/components/playbackStep.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Verify the layering and type-check**

Run: `bun run lint && bun run eslint`
Expected: clean. `playbackStep.ts` imports only `react`; it must not import `../audio/engine`
or `../store/store`.

- [ ] **Step 6: Commit**

```bash
git add src/components/playbackStep.ts src/components/playbackStep.test.ts
git commit -m "feat(playback): add a leaf-readable 16th-note step publisher

A tiny keyed external store plus useCurrentStep(), so a leaf can read the
transport's step through useSyncExternalStore without its ancestors
re-rendering. publish() is identity-checked so a repeated step costs nothing.
No consumers yet — the four per-step setState call sites move onto it in the
following tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Move ChordView's step out of the view and into the two `StepRow` leaves

`src/components/loop/chord/useChordPlayback.ts:611` calls `setCurrentStep(step % stepsPerBar)`
on every clock step, unconditionally and before the action branch. The state lives in
`useChordPlayback`'s own `useState` (`:404`) and is returned at `:660`, where
`ChordView.tsx:243` destructures it — the top of a 1342-line, 146-JSX-node component.

Its only consumers are two `StepRow`s, and **both are conditionally rendered**:
`ChordView.tsx:869-881` inside `{chordRhythmMode === 'custom' && ...}` and
`ChordView.tsx:1270-1285` inside `{bassPatternMode === 'custom' && ...}` — **post-Task-7**,
which inserts 7 lines at `:248`; pre-branch those blocks are `:862-874` and `:1263-1278`. In the default
`preset` modes `currentStep` is not rendered at all — yet the entire view reconciles 8 times a
second to deliver it, on whichever tab the user is actually looking at.

The stop/rewind paths must clear the publisher too, or a stopped transport strands a
highlighted step: `useChordPlayback.ts:566` (the store-subscription stop handler) and `:599`
(the clock effect's `!isPlaying` branch) both currently call `setCurrentStep(0)`.

**Files:**
- Modify: `src/components/loop/chord/useChordPlayback.ts:1-15` (imports), `:404` (drop the
  `useState`), `:566`, `:599`, `:611`, `:660` (return shape)
- Modify: `src/components/ui/StepRow.tsx:1-2` (imports), append `PlayingStepRow`
- Modify: `src/components/loop/ChordView.tsx:86` (import), `:243` (destructure), `:869-881`,
  `:1270-1285` (the two call sites), `:629-631` (stale comment) — **all post-Task-7** (+7 for
  anything below its insert at `:248`); pre-branch these are `:862-874`, `:1263-1278`, `:622-624`
- Modify (test): `src/components/ui/StepRow.test.tsx`

**Interfaces:**
- Consumes: **Task 7's `chordIds` memo** in `ChordView.tsx` — not its API (it exports nothing new) but its line drift: Task 7 inserts 7 lines at `:248`, so every `ChordView.tsx` line number quoted in this task is already post-Task-7. Also `publishStep(player: StepPlayerId, step: number): void`,
  `resetStep(player: StepPlayerId): void`, `useCurrentStep(player: StepPlayerId): number`
  and `type StepPlayerId = 'chords' | 'lead' | 'sequencer'` from
  `src/components/playbackStep.ts` (Task 17); `StepRow<T>` and
  `StepRowProps<T>` from `src/components/ui/StepRow.tsx`.
- Produces:
  ```ts
  // src/components/ui/StepRow.tsx
  export function PlayingStepRow<T>(
    props: Omit<StepRowProps<T>, 'currentStep'> & { player: StepPlayerId },
  ): React.ReactElement;
  ```
  `useChordPlayback()` no longer returns `currentStep`; its return becomes
  `{ playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId, isPlaying }`.
  Because `PlayingStepRow` spreads `Omit<StepRowProps<T>, 'currentStep'>` straight through,
  the three optional props Task 33 later adds to `StepRowProps` (`getButtonId`,
  `activeOverlay`, `rowClassName`) reach `StepRow` for free — Task 33 does not have to
  touch this wrapper, and the byte-identity test in Step 1 keeps passing because all three
  default to today's markup. Append `PlayingStepRow` at EOF and leave the `StepRow` body
  alone; Task 33 edits that body and must find it unmodified.

- [ ] **Step 1: Write the failing test for `PlayingStepRow`**

Append to `src/components/ui/StepRow.test.tsx`:

```tsx
import { PlayingStepRow } from './StepRow';
import { stepPublisher } from '../playbackStep';
import { stepCells } from '../sequencerGrid';
import { getMeter } from '../../utils/meter';

describe('PlayingStepRow', () => {
  const cells = stepCells(getMeter('4/4'));
  const steps = cells.map(() => false);

  test('renders the ring on the step the publisher currently holds', () => {
    stepPublisher.publish('chords', 3);
    const html = renderToString(
      <PlayingStepRow<boolean>
        player="chords"
        cells={cells}
        steps={steps}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    // One highlighted column, and it is the published one.
    expect(html.split('ring-2 ring-primary').length - 1).toBe(1);

    stepPublisher.publish('chords', 4);
    const moved = renderToString(
      <PlayingStepRow<boolean>
        player="chords"
        cells={cells}
        steps={steps}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(moved).not.toBe(html);
    stepPublisher.reset('chords');
  });

  test('renders byte-identically to StepRow given the same step', () => {
    stepPublisher.publish('chords', 2);
    const wrapped = renderToString(
      <PlayingStepRow<boolean>
        player="chords"
        cells={cells}
        steps={steps}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    const plain = renderToString(
      <StepRow<boolean>
        cells={cells}
        steps={steps}
        currentStep={2}
        isPlaying
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(wrapped).toBe(plain);
    stepPublisher.reset('chords');
  });

  test('a stopped player shows no ring regardless of the published step', () => {
    stepPublisher.publish('chords', 5);
    const html = renderToString(
      <PlayingStepRow<boolean>
        player="chords"
        cells={cells}
        steps={steps}
        isPlaying={false}
        color="bg-module-chord text-module-chord-content"
        isActive={(v) => v === true}
        onStepClick={() => {}}
      />,
    );
    expect(html).not.toContain('ring-2 ring-primary');
    stepPublisher.reset('chords');
  });
});
```

(If `StepRow` is not already imported in that test file, add it to the existing import.)

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/components/ui/StepRow.test.tsx -t "PlayingStepRow"`
Expected: FAIL — `PlayingStepRow` is not exported.

- [ ] **Step 3: Add `PlayingStepRow`**

In `src/components/ui/StepRow.tsx`, add to the imports at the top:

```ts
import { useCurrentStep, type StepPlayerId } from '../playbackStep';
```

and append at the end of the file:

```tsx
/**
 * A StepRow that reads the transport position itself.
 *
 * The playhead used to arrive as a prop from ChordView, so the whole 1342-line
 * view re-rendered 8x/sec to deliver a value that is only rendered in the
 * 'custom' pattern modes. Subscribing here confines the per-step re-render to
 * this row.
 */
export function PlayingStepRow<T>({
  player,
  ...rest
}: Omit<StepRowProps<T>, 'currentStep'> & { player: StepPlayerId }) {
  const currentStep = useCurrentStep(player);
  return <StepRow<T> {...rest} currentStep={currentStep} />;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun test src/components/ui/StepRow.test.tsx`
Expected: PASS, including the byte-identity assertion.

- [ ] **Step 5: Publish instead of setState in `useChordPlayback`**

In `src/components/loop/chord/useChordPlayback.ts`, add to the imports:

```ts
import { publishStep, resetStep } from '../../playbackStep';
```

Delete line 404:

```ts
  const [currentStep, setCurrentStep] = useState<number>(0);
```

Replace `setCurrentStep(0);` at `:566` and at `:599` with:

```ts
            resetStep('chords');
```

(matching each site's indentation), and replace `:611`:

```ts
      setCurrentStep(step % stepsPerBar);
```

with:

```ts
      publishStep('chords', step % stepsPerBar);
```

Change the return at `:660` to drop `currentStep`:

```ts
  return { playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId, isPlaying };
```

If `useState` becomes unused in the file after this, remove it from the `react` import.

- [ ] **Step 6: Switch ChordView's two call sites to `PlayingStepRow`**

In `src/components/loop/ChordView.tsx`:

- Line 86: `import { StepRow } from "../ui/StepRow";` → `import { PlayingStepRow } from "../ui/StepRow";`
- Line 243: drop `currentStep` from the destructure, so it reads:

```ts
  const { playChordWithRhythm, playBassWithPattern, playingIndex, activeChordId, setActiveChordId, isPlaying } = useChordPlayback();
```

- Lines 869-873 — post-Task-7; pre-branch `:862-866`, i.e. the opening tag through and
  including the `isPlaying={isPlaying}` line — become:

```tsx
                <PlayingStepRow<boolean>
                  player="chords"
                  cells={chordCells}
                  steps={customChordRhythm}
                  isPlaying={isPlaying}
```

(the remaining props on `:874-880` are unchanged, and the closing `/>` at `:881` stays. Note
the replaced range **ends at** `isPlaying={isPlaying}` — do not leave the old one behind and
emit it twice).

- Lines 1270-1274 — post-Task-7; pre-branch `:1263-1267` — become:

```tsx
                <PlayingStepRow<BassStepChoice>
                  player="chords"
                  cells={chordCells}
                  steps={customBassPattern}
                  isPlaying={isPlaying}
```

(the remaining props on `:1275-1284` are unchanged).

- [ ] **Step 7: Correct the stale performance comment**

`ChordView.tsx:629-631` (post-Task-7; pre-branch `:622-624`) currently claims the view "re-renders twice a second at 120 BPM",
which stopped being true when `currentStep` was added at `:243` and became 8×/sec. That
comment is load-bearing documentation for the two `tonal` memos below it. Replace those three
lines with:

```ts
  // ChordView subscribes to playheadBeat, so it re-renders twice a second at
  // 120 BPM — the 16th-note step no longer passes through here (it is
  // published to components/playbackStep.ts and read by the two
  // PlayingStepRows), so this is again the real rate. Both memos below call
  // into tonal and must stay memoized.
```

- [ ] **Step 8: Verify and run the suites**

Run: `grep -n "currentStep" src/components/loop/ChordView.tsx src/components/loop/chord/useChordPlayback.ts`
Expected: zero hits.
Run: `bun run lint`
Expected: clean.
Run: `bun test src/components/loop/ChordView.test.tsx src/components/loop/chord/useChordPlayback.test.ts src/components/ui/StepRow.test.tsx src/components/loop/chord/SortableChordCard.test.tsx`
Expected: PASS.

- [ ] **Step 9: Manual verification**

1. `bun run dev`, click to start audio, go to the **Chords** tab.
2. Set **Chord Rhythm** to **Custom** and **Bass Pattern** to **Custom** so both step rows are
   visible. Toggle a few steps on in each.
3. Press Play on the Chords player.
   Expected: both rows show a single ring moving left to right, one step per 16th, in sync
   with each other and with the audio.
4. Press Stop.
   Expected: the ring disappears from both rows immediately and does not stay stuck on a step.
5. Press Play, then click an Instant Vibe chip mid-playback (this hard-stops and restarts
   inside one batched click). Expected: the ring restarts cleanly from the bar line; no
   stranded highlight.
6. Switch **Chord Rhythm** back to a preset while playing.
   Expected: that row disappears; the bass row keeps stepping correctly.
7. Press Play and watch the chord cards. Expected: the playing chord highlights and advances
   as before.

- [ ] **Step 10: Commit**

```bash
git add src/components/playbackStep.ts src/components/ui/StepRow.tsx src/components/ui/StepRow.test.tsx src/components/loop/chord/useChordPlayback.ts src/components/loop/ChordView.tsx
git commit -m "perf(chords): publish the 16th-note step to the StepRow leaves

useChordPlayback set currentStep on every clock step and it landed at the top
of the 1342-line ChordView, whose only consumers are two StepRows that render
solely in 'custom' mode — so the whole view reconciled 8x/sec to deliver a
value it usually does not render. The step now goes through
components/playbackStep.ts and the two rows read it via the new
PlayingStepRow. The stop and rewind paths reset the publisher so a stopped
transport cannot strand a highlight. Also corrects the stale re-render-rate
comment at ChordView.tsx:622.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---
### Task 19: Move `useLeadPlayback()` down into `LeadPianoRoll`

`src/components/loop/SynthView.tsx:160` calls
`const { currentStep: leadCurrentStep, isPlaying: leadIsPlaying } = useLeadPlayback();` and
passes both down at `:1182`. `useLeadPlayback.ts:94` sets that step on every 16th note, so
all 174 JSX nodes of the 1208-line `SynthView` reconcile 8×/sec — ~20 `<Knob>` SVGs, two
`<option>` lists over 26 presets, several `<button>` groups and `<SynthPresetLibrary>`'s body —
purely to move one `translateX` at `LeadPianoRoll.tsx:298-306`.

`LeadPianoRoll` is rendered exactly once (`SynthView.tsx:1182`, outside the
`{synthViewMode === "simple" ? ... : ...}` branches that close at `:1179`, so it renders in
both modes), which is what makes it safe to own the hook: `useLeadPlayback` subscribes the
clock and owns the hard stop, so it must be mounted exactly once. Its two effects are keyed
`[]` (`:61-78`) and `[isPlaying, hardStop]` (`:80-121`), so neither is mount-order sensitive.

The playhead's geometry is split into an exported, prop-driven `LeadPlayhead` so it stays
renderable in a test: once the hook owns `isPlaying`, `renderToString` can no longer force a
playing state (zustand v5 serves `selector(api.getInitialState())` as the server snapshot, so
a `setState` before the render is invisible — the reason documented at
`ui/BottomInputDock.tsx:9-21`).

**Files:**
- Modify: `src/components/loop/lead/useLeadPlayback.ts:1-15` (imports), `:50-55` (return type,
  drop the `useState`), `:68`, `:83`, `:94`, `:123` (return shape)
- Modify: `src/components/loop/lead/LeadPianoRoll.tsx:1-24` (imports + props), `:96`
  (component signature), `:289-307` (playhead), plus the new `LeadPlayhead`
- Modify: `src/components/loop/SynthView.tsx:40` (import), `:160` (delete), `:1182`
- Modify (test): `src/components/loop/lead/LeadPianoRoll.test.tsx`

**Interfaces:**
- Consumes: `publishStep`, `resetStep`, `useCurrentStep` from `src/components/playbackStep.ts`
  (Task 17); `LEAD_CELL_WIDTH: number` from `src/components/loop/lead/pianoRoll.ts`.
- Produces:
  ```ts
  // src/components/loop/lead/useLeadPlayback.ts
  export function useLeadPlayback(): { isPlaying: boolean };   // currentStep removed

  // src/components/loop/lead/LeadPianoRoll.tsx
  export const LeadPlayhead: React.FC<{ currentStep: number }>;
  export const LeadPianoRoll: React.FC;                        // LeadPianoRollProps deleted
  ```

- [ ] **Step 1: Rewrite the LeadPianoRoll tests for the new shape**

In `src/components/loop/lead/LeadPianoRoll.test.tsx`, change the import to:

```tsx
import { LeadPianoRoll, LeadPlayhead } from './LeadPianoRoll';
```

Replace every `renderToString(<LeadPianoRoll currentStep={0} isPlaying={false} />)` with
`renderToString(<LeadPianoRoll />)`, and replace the whole playhead test (currently
`:22-27`) with:

```tsx
  test('the playhead overlay translates by step × cell width', () => {
    expect(renderToString(<LeadPlayhead currentStep={3} />)).toContain('translateX(60px)'); // 3 × 20
    expect(renderToString(<LeadPlayhead currentStep={0} />)).toContain('translateX(0px)');
  });

  test('a stopped lead player renders no playhead at all', () => {
    // The store's lead player is 'stopped' by default, and LeadPianoRoll now
    // owns useLeadPlayback, so this is the real stopped rendering.
    expect(renderToString(<LeadPianoRoll />)).not.toContain('ring-inset ring-primary');
  });
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/components/loop/lead/LeadPianoRoll.test.tsx`
Expected: FAIL — `LeadPlayhead` is not exported, and `<LeadPianoRoll />` is missing required
props.

- [ ] **Step 3: Publish the step from `useLeadPlayback`**

In `src/components/loop/lead/useLeadPlayback.ts`:

- Add to the imports:

```ts
import { publishStep, resetStep } from '../../playbackStep';
```

- Change the signature at `:50` and delete the `useState` at `:55`:

```ts
export function useLeadPlayback(): { isPlaying: boolean } {
  const playerState = useAppStore((s) => s.leadPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';

  const armingRef = useRef<LeadArming>({ armed: false });
```

- Replace `setCurrentStep(0);` at `:68` and at `:83` with `resetStep('lead');`.
- Replace `:94`:

```ts
      setCurrentStep(step % melodyLength);
```

with:

```ts
      publishStep('lead', step % melodyLength);
```

- Change the return at `:123` to:

```ts
  return { isPlaying };
```

- Drop `useState` from the `react` import on line 1 (`import { useEffect, useRef } from 'react';`).

- [ ] **Step 4: Move the hook into `LeadPianoRoll` and split out the playhead**

In `src/components/loop/lead/LeadPianoRoll.tsx`:

- Add to the imports:

```ts
import { useCurrentStep } from '../../playbackStep';
import { useLeadPlayback } from './useLeadPlayback';
```

- Delete the `LeadPianoRollProps` interface (`:21-24`) and add, just below the
  `LABEL_WIDTH` constant (`:27`):

```tsx
/**
 * The moving column. Split out with an explicit prop so the geometry stays
 * unit-testable: LeadPianoRoll owns useLeadPlayback now, and renderToString
 * cannot force a playing store state (zustand v5 serves
 * selector(api.getInitialState()) as the server snapshot — see
 * ui/BottomInputDock.tsx:9-21).
 */
export const LeadPlayhead: React.FC<{ currentStep: number }> = ({ currentStep }) => (
  <div
    className="pointer-events-none absolute top-0 bottom-0 bg-primary/20 ring-1 ring-inset ring-primary"
    style={{
      width: LEAD_CELL_WIDTH,
      transform: `translateX(${currentStep * LEAD_CELL_WIDTH}px)`,
    }}
  />
);
```

- Change the component signature at `:96` to:

```tsx
export const LeadPianoRoll: React.FC = () => {
  // Mounted here, not in SynthView: the step used to arrive as a prop, so all
  // 174 JSX nodes of the 1208-line SynthView reconciled 8x/sec to move one
  // translateX. LeadPianoRoll is rendered exactly once (SynthView.tsx:1182, in
  // both simple and pro mode), which is the requirement — useLeadPlayback
  // subscribes the clock and owns the hard stop.
  const { isPlaying } = useLeadPlayback();
  const currentStep = useCurrentStep('lead');
  const meterId = useAppStore((s) => s.meterId);
```

(the remaining selectors on `:98-111` are unchanged).

- Replace the playhead block at `:298-306`:

```tsx
                {isPlaying && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 bg-primary/20 ring-1 ring-inset ring-primary"
                    style={{
                      width: LEAD_CELL_WIDTH,
                      transform: `translateX(${currentStep * LEAD_CELL_WIDTH}px)`,
                    }}
                  />
                )}
```

with:

```tsx
                {isPlaying && <LeadPlayhead currentStep={currentStep} />}
```

- [ ] **Step 5: Detach SynthView from the lead clock**

In `src/components/loop/SynthView.tsx`:

- Delete line 40 (`import { useLeadPlayback } from "./lead/useLeadPlayback";`).
- Delete line 160 (`const { currentStep: leadCurrentStep, isPlaying: leadIsPlaying } = useLeadPlayback();`).
- Change line 1182 to:

```tsx
      <LeadPianoRoll />
```

- [ ] **Step 6: Verify nothing else referenced the old shape**

Run: `grep -rn "leadCurrentStep\|leadIsPlaying\|LeadPianoRollProps" src/`
Expected: zero hits.
Run: `grep -rn "useLeadPlayback" src/ | grep -v "\.test\."`
Expected: only its own definition and the call inside `LeadPianoRoll.tsx` — exactly one
mount site.
Run: `bun run lint`
Expected: clean.

- [ ] **Step 7: Run the suites**

Run: `bun test src/components/loop/lead/LeadPianoRoll.test.tsx src/components/loop/lead/useLeadPlayback.test.ts src/components/loop/SynthView.test.tsx src/store/leadSlice.test.ts`
Expected: PASS.

- [ ] **Step 8: Manual verification**

1. `bun run dev`, click to start audio, **Synth** tab, scroll to **Lead Melody**.
2. Draw four notes across the grid, then press Play on the Lead player.
   Expected: the highlighted column sweeps across the roll one cell per 16th, in time with
   the notes you hear.
3. While it plays, drag **Filter Cutoff**.
   Expected: the tone follows and the playhead keeps moving smoothly — SynthView no longer
   re-renders per step, so the two must not interfere.
4. Press Stop.
   Expected: the playhead column disappears.
5. Change **Melody loop length** from 1 bar to 2 while playing.
   Expected: the roll widens and the playhead wraps at the new length.
6. Toggle **Simple** ↔ **Pro** view mode while the lead plays.
   Expected: the roll stays mounted and the playhead never stops or restarts — the hook is
   outside both branches.
7. Click an Instant Vibe chip while the lead plays.
   Expected: the playhead restarts cleanly from the bar line.

- [ ] **Step 9: Commit**

```bash
git add src/components/loop/lead/useLeadPlayback.ts src/components/loop/lead/LeadPianoRoll.tsx src/components/loop/lead/LeadPianoRoll.test.tsx src/components/loop/SynthView.tsx
git commit -m "perf(lead): own the lead playback hook inside LeadPianoRoll

SynthView held useLeadPlayback purely to forward currentStep to the piano
roll, so all 174 of its JSX nodes reconciled 8x/sec to move one translateX.
The hook now publishes to components/playbackStep.ts and is mounted inside
LeadPianoRoll (rendered exactly once, in both simple and pro mode). The
playhead geometry is an exported LeadPlayhead so it stays unit-testable now
that isPlaying comes from the store rather than a prop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Publish the lead step only when the step actually plays

After Task 19, `src/components/loop/lead/useLeadPlayback.ts:94` reads
`publishStep('lead', step % melodyLength);` and still sits **before** the action branch at
`:95-103`. So it publishes a moving playhead while the player is `idle` (armed, waiting for
the bar line) and while it is `stopping` — the roll sweeps before a single note has sounded,
and keeps sweeping through the stop.

The sibling scheduler already gets this right: `useSequencerPlayback.ts:130-141` returns on
`'idle'`, handles `'soft-stop'`, and only then computes `stepInLoop` and calls
`setCurrentStep`. This task makes the lead hook match.

There is no pure core to extract here — the decision function `leadStepAction` already exists
and is already covered by `useLeadPlayback.test.ts`; what changes is only *where* the publish
sits relative to it. The proof is therefore a structural check plus a precise manual
observation, per the sibling's established shape.

**Files:**
- Modify: `src/components/loop/lead/useLeadPlayback.ts:89-105`

**Interfaces:**
- Consumes: `publishStep(player: StepPlayerId, step: number): void` from
  `src/components/playbackStep.ts`; `leadStepAction(state: PlayerState, step: number, arming: LeadArming, stepsPerBar: number): LeadStepAction`
  (same file, `:31-41`).
- Produces: nothing new. `useLeadPlayback(): { isPlaying: boolean }` is unchanged.

- [ ] **Step 1: Move the publish below the action guard**

Replace lines 89-105 of `src/components/loop/lead/useLeadPlayback.ts`:

```ts
    return subscribePlaybackClock((step, _beat, time) => {
      const s = useAppStore.getState();
      const playerState = s.leadPlayer;
      const stepsPerBar = getMeter(s.meterId).stepsPerBar;
      const melodyLength = s.leadLoopLength * stepsPerBar;
      publishStep('lead', step % melodyLength);
      const action = leadStepAction(playerState, step, armingRef.current, stepsPerBar);

      if (action === 'soft-stop') {
        playbackStopSource('synth', s.synthParams.release, time);
        softStopPendingRef.current = true;
        hardStop('lead');
        return;
      }
      if (action !== 'play') return;

      const stepInLoop = step % melodyLength;
```

with:

```ts
    return subscribePlaybackClock((step, _beat, time) => {
      const s = useAppStore.getState();
      const playerState = s.leadPlayer;
      const stepsPerBar = getMeter(s.meterId).stepsPerBar;
      const melodyLength = s.leadLoopLength * stepsPerBar;
      const action = leadStepAction(playerState, step, armingRef.current, stepsPerBar);

      if (action === 'soft-stop') {
        playbackStopSource('synth', s.synthParams.release, time);
        softStopPendingRef.current = true;
        hardStop('lead');
        return;
      }
      // Publish AFTER the action check, matching useSequencerPlayback.ts:130-141.
      // Publishing first swept the piano-roll playhead during the pre-arm
      // window (armed, waiting for the bar line) and through 'stopping', so the
      // roll showed motion while nothing was sounding — and did the publish
      // work on every step in every state, not just the ones that play.
      if (action !== 'play') return;

      const stepInLoop = step % melodyLength;
      publishStep('lead', stepInLoop);
```

- [ ] **Step 2: Structural check**

Run: `grep -n "publishStep\|resetStep\|action !== 'play'\|action === 'soft-stop'" src/components/loop/lead/useLeadPlayback.ts`
Expected, in this order: `resetStep` (the store-subscription stop handler), `resetStep` (the
`!isPlaying` branch), `action === 'soft-stop'`, `action !== 'play'`, then `publishStep`. The
single `publishStep` line must have a **higher** line number than the `action !== 'play'`
guard — that is the whole change.

Run: `bun run lint`
Expected: clean.

- [ ] **Step 3: Run the suites**

Run: `bun test src/components/loop/lead/useLeadPlayback.test.ts src/components/loop/lead/LeadPianoRoll.test.tsx`
Expected: PASS.

- [ ] **Step 4: Manual verification**

1. `bun run dev`, click to start audio, **Synth** tab, **Lead Melody**. Draw notes on steps
   1, 5, 9 and 13 of a 1-bar loop.
2. Start the **Chords** player first and let it run, so the clock is already mid-bar.
3. Now press Play on the **Lead** player *deliberately off the bar line* (a beat or two into
   the bar).
   Expected: the piano-roll playhead **stays at column 0** until the next bar line, then
   starts sweeping from column 0 together with the first note. Before this change it swept
   through the remainder of the bar with no sound.
4. Press Stop on the Lead player while it is mid-bar (a soft stop, which completes on the
   next bar line).
   Expected: the playhead stops advancing at once and then disappears; it does not keep
   sweeping to the bar line.
5. Play again and confirm the playhead column and the audible note land on the same step.

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/lead/useLeadPlayback.ts
git commit -m "fix(lead): publish the playhead step only for steps that actually play

publishStep ran before the action branch, so the piano-roll playhead swept
during the pre-arm window (armed, waiting for the bar line) and through
'stopping' — motion with no sound — and did the work on every step in every
state. Moved below the action guard, matching useSequencerPlayback.ts:130-141.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Memoize the two `LeadPianoRoll` header rows

`src/components/loop/lead/LeadPianoRoll.tsx:233` and `:253` each run an
`Array.from({ length: columns }, ...)` in the render body — a bar-number strip and a
beat-number strip. With a 4-bar loop in 4/4 that is 64 + 64 = 128 `<div>`s rebuilt every time
the component renders. After Task 19 the component re-renders 8×/sec during lead playback
(it reads `useCurrentStep('lead')` at its top for the playhead), so those 128 divs are rebuilt
purely because the playhead moved.

`LeadPianoCells` (`:29-94`) is already correctly memoized and its comment states the
contract: *"Memoized: props are stable across clock ticks, so the cells never re-render when
only the playhead moves."* Its stability holds because `meter` is the shared `METERS[id]`
object (`utils/meter.ts:63-65`), `rows` is `useMemo`'d (`:119-123`), `onToggle` is
`useCallback`'d (`:135-138`), and `melody`/`root` come straight from the store. The headers
need exactly the same treatment: `meter` is stable, `columns` is a number, and `cellsPerBar`
is already `useMemo`'d on `[meter]` (`:117`).

**Files:**
- Modify: `src/components/loop/lead/LeadPianoRoll.tsx:94-95` (insert the new component after
  `LeadPianoCells`), `:229-268` (replace both header blocks)
- Modify (test): `src/components/loop/lead/LeadPianoRoll.test.tsx`

**Interfaces:**
- Consumes: `StepCell` (`src/components/sequencerGrid.ts`), `Meter`
  (`src/utils/meter.ts`), `LEAD_CELL_WIDTH: number` (`src/components/loop/lead/pianoRoll.ts`),
  and the file-local `LABEL_WIDTH` constant (`LeadPianoRoll.tsx:27`).
- Produces:
  ```ts
  export const LeadPianoHeaders: React.MemoExoticComponent<
    React.FC<{
      stepsPerBar: number;
      columns: number;
      cellsPerBar: StepCell[];
    }>
  >;
  ```

- [ ] **Step 1: Write the failing test**

Append to `src/components/loop/lead/LeadPianoRoll.test.tsx`:

```tsx
import { LeadPianoHeaders } from './LeadPianoRoll';
import { stepCells } from '../../sequencerGrid';
import { getMeter } from '../../../utils/meter';

describe('LeadPianoHeaders', () => {
  const meter = getMeter('4/4');
  const cellsPerBar = stepCells(meter);

  test('renders one cell per column in both strips, numbering bars and beats', () => {
    const html = renderToString(
      <LeadPianoHeaders stepsPerBar={meter.stepsPerBar} columns={32} cellsPerBar={cellsPerBar} />,
    );
    // Two strips of 32 columns, plus one label spacer each.
    expect(html.split('width:20px').length - 1).toBe(64);
    expect(html.split('width:44px').length - 1).toBe(2);
    // Bar numbers appear only at each bar start: 2 bars over 32 columns.
    expect(html).toContain('>1</div>');
    expect(html).toContain('>2</div>');
    expect(html).not.toContain('>3</div>');
  });

  test('output is byte-identical to the same props rendered twice', () => {
    const render = () =>
      renderToString(
        <LeadPianoHeaders stepsPerBar={meter.stepsPerBar} columns={16} cellsPerBar={cellsPerBar} />,
      );
    expect(render()).toBe(render());
  });

  test('is memoized, so the parent re-rendering with the same props is free', () => {
    // React.memo wraps the function component; assert the wrapper is present so
    // the whole point of the extraction cannot be silently undone.
    expect((LeadPianoHeaders as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });

  test('no raw palette or absolute black/white classes leak in', () => {
    const html = renderToString(
      <LeadPianoHeaders stepsPerBar={meter.stepsPerBar} columns={16} cellsPerBar={cellsPerBar} />,
    );
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('rgba(');
  });
});
```

- [ ] **Step 2: Capture the current markup, then run and confirm fail**

Before changing anything, record the current header markup so the extraction can be proven
byte-identical:

```bash
bun test src/components/loop/lead/LeadPianoRoll.test.tsx -t "the grid lays out"
```

Run: `bun test src/components/loop/lead/LeadPianoRoll.test.tsx -t "LeadPianoHeaders"`
Expected: FAIL — `LeadPianoHeaders` is not exported.

- [ ] **Step 3: Extract the memoized component**

In `src/components/loop/lead/LeadPianoRoll.tsx`, add `StepCell` to the imports:

```ts
import { stepCells, type StepCell } from '../../sequencerGrid';
```

and insert immediately after the `LeadPianoCells` definition (after `:94`):

```tsx
// Memoized for the same reason as LeadPianoCells above: LeadPianoRoll
// re-renders once per 16th note to move the playhead, and these two strips
// rebuild `columns` divs each — 128 of them for a 4-bar loop in 4/4 — every
// time. stepsPerBar and columns are numbers, and cellsPerBar is useMemo'd on
// the shared METERS[id] object, so the shallow prop comparison is meaningful.
export const LeadPianoHeaders = React.memo(function LeadPianoHeaders({
  stepsPerBar,
  columns,
  cellsPerBar,
}: {
  stepsPerBar: number;
  columns: number;
  cellsPerBar: StepCell[];
}) {
  return (
    <>
      {/* Bar-number header */}
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
        <div className="flex shrink-0">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / stepsPerBar);
            const stepInBar = col - barIndex * stepsPerBar;
            return (
              <div
                key={col}
                className="text-[8px] leading-none text-center font-bold text-base-content/60"
                style={{ width: LEAD_CELL_WIDTH }}
              >
                {stepInBar === 0 ? barIndex + 1 : ''}
              </div>
            );
          })}
        </div>
      </div>

      {/* Beat-number header */}
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
        <div className="flex shrink-0">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / stepsPerBar);
            const stepInBar = col - barIndex * stepsPerBar;
            const cell = cellsPerBar[stepInBar];
            return (
              <div
                key={col}
                className="text-[9px] leading-none text-center text-base-content/50"
                style={{ width: LEAD_CELL_WIDTH }}
              >
                {cell.isBeatStart ? cell.beatIndex + 1 : ''}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
});
```

`LABEL_WIDTH` is declared at `:27`, above this insertion point, so it is in scope.

- [ ] **Step 4: Replace both header blocks in the render body**

Replace lines 229-268 (the `{/* Bar-number header */}` block through the closing `</div>` of
the `{/* Beat-number header */}` block) with:

```tsx
            <LeadPianoHeaders
              stepsPerBar={stepsPerBar}
              columns={columns}
              cellsPerBar={cellsPerBar}
            />
```

- [ ] **Step 5: Run the suite and confirm the markup did not change**

Run: `bun test src/components/loop/lead/LeadPianoRoll.test.tsx`
Expected: PASS — including the pre-existing `'the grid lays out loopLength × stepsPerBar
columns'` and the theme-token tests, which is the byte-level proof that this is a pure
extraction.
Run: `bun run lint && bun run check:theme`
Expected: clean.

- [ ] **Step 6: Manual verification**

1. `bun run dev`, click to start audio, **Synth** tab, **Lead Melody**.
2. Compare the header strips against a screenshot or against `git stash`ing the change:
   Expected: identical bar numbers (`1`, `2`, …, one per bar start) and beat numbers (`1`-`4`
   at each beat start in 4/4), same widths, same alignment with the cells below.
3. Change **Melody loop length** from 1 to 4 bars.
   Expected: the headers widen and renumber correctly.
4. Change the meter (Header → meter selector) to 6/8 and then 3/4.
   Expected: the beat strip renumbers to the new grouping and stays aligned with the cells.
5. Press Play on the Lead player.
   Expected: the playhead sweeps and the headers do not flicker or shift.

- [ ] **Step 7: Commit**

```bash
git add src/components/loop/lead/LeadPianoRoll.tsx src/components/loop/lead/LeadPianoRoll.test.tsx
git commit -m "perf(lead): memoize the piano-roll header strips

Two Array.from loops in the render body rebuilt `columns` divs each — 128 for
a 4-bar loop in 4/4 — every time LeadPianoRoll re-rendered, which is 8x/sec
during playback purely because the playhead moved. Extracted as a memoized
LeadPianoHeaders beside the existing LeadPianoCells, whose stability argument
it shares: stepsPerBar and columns are numbers and cellsPerBar is useMemo'd on
the shared METERS[id] object. Pure extraction — the existing layout and
theme-token tests pin the markup byte for byte.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---
### Task 22: Give `SequencerView` a step-owning child

`src/components/loop/SequencerView.tsx:62` calls `useSequencerPlayback()` and consumes
`currentStep` at `:346` (`StepHeader`) and `:355` (`TrackRow`). So the whole 47-JSX-node view
plus every `TrackRow` re-renders once per 16th note — each row rebuilding its 16-24
`<button>`s and their inline `onClick` closures — **even when the Sequencer tab is hidden**,
because `App.tsx:106-113` and `LoopPage` keep it mounted by design.

`TrackRow` has a documented memo contract at `TrackRow.tsx:17-23`:

> One drum/synth lane. Memoized: the three callbacks are stable useCallbacks in SequencerView
> and `cells` is memoized there, so a knob drag or a genre change in the parent no longer
> rebuilds this row's 16 step buttons. `currentStep` is a real prop, so a transport tick DOES
> still re-render every row — the column highlight is per-step data each row needs.

That contract is **preserved exactly**: `TrackRow`'s props do not change, its memo stays
meaningful, and `currentStep` remains a real prop. Task 33 later delegates `TrackRow`'s cells
to `StepRow`, which also keeps `currentStep` as a prop, so nothing here conflicts with it.
What changes is only *who* owns the subscription: a new `SequencerGrid` child that renders
`StepHeader` + the row list, so the per-step re-render stops at that child instead of at the
top of the view.

`useSequencerPlayback` also stops holding the step in React state and publishes it instead, so
`SequencerView` has no per-step subscriber left at all.

**Files:**
- Create: `src/components/loop/sequencer/SequencerGrid.tsx`
- Modify: `src/components/useSequencerPlayback.ts:1` (imports), `:48-51` (return type), the
  `useState<number>(0)` line (`:60` pre-branch, `:63` after Task 12 grew the selector block by
  three lines), and the clock effect's `setCurrentStep(0)` / `setCurrentStep(stepInLoop)` sites
  plus the final `return` line. **Cite the anchors, not the numbers**: Task 12 also deletes the
  26-line `playStepSounds` `useCallback` from this hook and adds a module-scope function above it,
  so the pre-branch range `:106-146` no longer denotes anything.
- Modify: `src/components/loop/SequencerView.tsx:14` + `:27` (imports), `:48` (move
  `isPlaying`), `:62` (drop the hook call), `:344-363` (render the child)
- Modify (test): `src/components/loop/SequencerView.test.tsx`

**Interfaces:**
- Consumes: `publishStep`, `resetStep`, `useCurrentStep` from `src/components/playbackStep.ts`
  (Task 17); `StepHeader` (`{ cells: StepCell[]; currentStep: number; isPlaying: boolean }`)
  from `src/components/loop/sequencer/StepHeader.tsx`; `TrackRow`
  (`{ track: SequencerTrack; cells: StepCell[]; currentStep: number; isPlaying: boolean; onToggleStep: (trackId: string, stepIndex: number) => void; onToggleMute: (trackId: string) => void; onPreview: (track: SequencerTrack) => void }`)
  from `src/components/loop/sequencer/TrackRow.tsx` — **both unchanged**.
- Produces:
  ```ts
  // src/components/loop/sequencer/SequencerGrid.tsx
  export interface SequencerGridProps {
    tracks: SequencerTrack[];
    cells: StepCell[];
    onToggleStep: (trackId: string, stepIndex: number) => void;
    onToggleMute: (trackId: string) => void;
    onPreview: (track: SequencerTrack) => void;
  }
  export const SequencerGrid: React.FC<SequencerGridProps>;

  // src/components/useSequencerPlayback.ts
  export function useSequencerPlayback(): void;   // was { currentStep, setCurrentStep }
  ```

- [ ] **Step 1: Write the failing test**

Append to `src/components/loop/SequencerView.test.tsx`:

```tsx
import { SequencerGrid } from './sequencer/SequencerGrid';
import { stepPublisher } from '../playbackStep';
import { stepCells } from '../sequencerGrid';
import { getMeter } from '../../utils/meter';

describe('SequencerGrid', () => {
  const cells = stepCells(getMeter('4/4'));
  const tracks = useAppStore.getState().sequencerTracks;

  const render = () =>
    renderToString(
      <SequencerGrid
        tracks={tracks}
        cells={cells}
        onToggleStep={() => {}}
        onToggleMute={() => {}}
        onPreview={() => {}}
      />,
    );

  test('renders the step header and one row per track', () => {
    const html = render();
    for (const track of tracks) {
      expect(html).toContain(`id="sequencer-row-${track.id}"`);
    }
    expect(html).toContain('pl-44'); // StepHeader's strip
  });

  test('reads the playhead from the step publisher', () => {
    stepPublisher.reset('sequencer');
    const atZero = render();
    stepPublisher.publish('sequencer', 7);
    const atSeven = render();
    expect(atSeven).not.toBe(atZero);
    stepPublisher.reset('sequencer');
    expect(render()).toBe(atZero);
  });

  test('no raw palette or absolute black/white classes leak in', () => {
    const html = render();
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('rgba(');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/components/loop/SequencerView.test.tsx -t "SequencerGrid"`
Expected: FAIL — cannot resolve `./sequencer/SequencerGrid`.

- [ ] **Step 3: Publish the step from `useSequencerPlayback`**

In `src/components/useSequencerPlayback.ts`:

- Add to the imports:

```ts
import { publishStep, resetStep } from "./playbackStep";
```

- Replace the signature and the `useState` (`:48-60`) with:

```ts
export function useSequencerPlayback(): void {
  // tracks / synthParams / masterSequencerVolume / bpm are deliberately NOT
  // selected here: they are read LIVE inside the clock callback below.
  const playerState = useAppStore((s) => s.sequencerPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';

  // Real-time playback stepper — driven by the shared audio-clock scheduler
  const armingRef = useRef<SequencerArming>({ armed: false });
```

(the `useState<number>(0)` line and the comment above it are deleted).

- In the clock effect, replace `setCurrentStep(0);` in the `!isPlaying` branch with
  `resetStep('sequencer');`, and replace `setCurrentStep(stepInLoop);` with
  `publishStep('sequencer', stepInLoop);`.

- Delete the final `return { currentStep, setCurrentStep };` line.

- Drop `useState` from the `react` import on line 1.

- [ ] **Step 4: Create `SequencerGrid`**

Create `src/components/loop/sequencer/SequencerGrid.tsx`:

```tsx
import React from 'react';
import { useAppStore } from '../../../store/store';
import { useSequencerPlayback } from '../../useSequencerPlayback';
import { useCurrentStep } from '../../playbackStep';
import { StepHeader } from './StepHeader';
import { TrackRow } from './TrackRow';
import type { StepCell } from '../../sequencerGrid';
import type { SequencerTrack } from '../../../types';

export interface SequencerGridProps {
  tracks: SequencerTrack[];
  cells: StepCell[];
  onToggleStep: (trackId: string, stepIndex: number) => void;
  onToggleMute: (trackId: string) => void;
  onPreview: (track: SequencerTrack) => void;
}

/**
 * Owns the sequencer's step subscription so the rest of SequencerView does not
 * re-render 8-16 times a second — including while the Sequencer tab is hidden,
 * which App.tsx keeps mounted by design.
 *
 * `useSequencerPlayback` must be mounted EXACTLY once (it subscribes the clock
 * and owns the soft stop); SequencerView renders this child exactly once.
 *
 * TrackRow's memo contract (TrackRow.tsx:17-23) is unchanged on purpose:
 * currentStep is still a real prop, so a transport tick still re-renders every
 * row — the column highlight is per-step data each row needs. What this
 * component removes is everything ABOVE the grid re-rendering with them.
 */
export const SequencerGrid: React.FC<SequencerGridProps> = ({
  tracks,
  cells,
  onToggleStep,
  onToggleMute,
  onPreview,
}) => {
  useSequencerPlayback();
  const currentStep = useCurrentStep('sequencer');
  const isPlaying = useAppStore((s) => s.sequencerPlayer !== 'stopped');

  return (
    <div className="overflow-x-auto">
      {/* Step Indicator Header — one cell per step of the active bar */}
      <StepHeader cells={cells} currentStep={currentStep} isPlaying={isPlaying} />

      {/* Track Lanes */}
      <div className="space-y-2 min-w-[700px]">
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            cells={cells}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggleStep={onToggleStep}
            onToggleMute={onToggleMute}
            onPreview={onPreview}
          />
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Render the child from `SequencerView`**

In `src/components/loop/SequencerView.tsx`:

- Replace the imports on lines 14 and 27:

```ts
import { SequencerGrid } from "./sequencer/SequencerGrid";
```

(delete both `import { useSequencerPlayback } from "../useSequencerPlayback";` and
`import { StepHeader } from "./sequencer/StepHeader";`, and delete the `TrackRow` import if
this file no longer uses it — check with the grep in Step 6).

- Delete line 48 (`const isPlaying = useAppStore((s) => s.sequencerPlayer !== 'stopped');`) and
  line 62 (`const { currentStep } = useSequencerPlayback();`).
- Replace lines 344-363 (the `<div className="overflow-x-auto">` block through its closing
  `</div>`) with:

```tsx
        <SequencerGrid
          tracks={tracks}
          cells={cells}
          onToggleStep={toggleStep}
          onToggleMute={toggleMute}
          onPreview={previewTrack}
        />
```

- [ ] **Step 6: Verify and type-check**

Run: `grep -n "currentStep\|isPlaying\|StepHeader\|TrackRow" src/components/loop/SequencerView.tsx`
Expected: zero hits. Remove any import that grep shows is now unused.
Run: `grep -rn "useSequencerPlayback" src/ | grep -v "\.test\."`
Expected: only its own definition and the single call inside `SequencerGrid.tsx`.
Run: `bun run lint`
Expected: clean.

- [ ] **Step 7: Run the suites**

Run: `bun test src/components/loop/SequencerView.test.tsx src/components/useSequencerPlayback.test.ts src/components/playbackStep.test.ts`
Expected: PASS. The pre-existing `SequencerView` theming and markup tests must pass
untouched — they are the proof this is a pure move.

Run: `bun test && bun run lint && bun run eslint`
Expected: all green.

- [ ] **Step 8: Manual verification**

1. `bun run dev`, click to start audio, **Sequencer** tab.
2. Press Play. Expected: the step header highlights one column at a time and every track row
   shows the same highlighted column, advancing in time with the drums.
3. Toggle steps on and off while playing. Expected: the change is audible on the next pass and
   the button lights up immediately.
4. Mute and unmute a track with its power toggle. Expected: instant.
5. Click a track's preview (play) button. Expected: it auditions that instrument.
6. Use **Clear**, **Randomize** and the shift buttons while playing. Expected: the grid
   updates and the highlight keeps advancing correctly.
7. Change the meter to 3/4 in the header. Expected: the header and rows narrow to 12 steps and
   the highlight wraps at 12.
8. Press Stop. Expected: the highlight disappears from both the header and every row.
9. Switch to the **Chords** tab while the sequencer plays, then back.
   Expected: the beat is unaffected and the highlight is where it should be on return.

**Rollback:** revert with `git revert <sha>`. To undo only the extraction while keeping the
publisher, re-inline `SequencerGrid`'s JSX at `SequencerView.tsx:344`, re-add
`const isPlaying = useAppStore((s) => s.sequencerPlayer !== 'stopped');` and
`const currentStep = useCurrentStep('sequencer');` plus a bare `useSequencerPlayback();` call
in `SequencerView`, and delete `SequencerGrid.tsx`. `TrackRow` and `StepHeader` are untouched
by this task, so nothing else has to move.

- [ ] **Step 9: Commit**

```bash
git add src/components/loop/sequencer/SequencerGrid.tsx src/components/loop/SequencerView.tsx src/components/loop/SequencerView.test.tsx src/components/useSequencerPlayback.ts
git commit -m "perf(sequencer): move the step subscription into a SequencerGrid child

SequencerView held currentStep at its top, so the whole view plus every
TrackRow re-rendered once per 16th note — rebuilding ~128 step buttons and
their closures — even while the Sequencer tab was hidden, which App.tsx keeps
mounted by design. useSequencerPlayback now publishes to
components/playbackStep.ts, and StepHeader + the row list live in a
SequencerGrid child that owns the subscription. TrackRow's props and its
documented memo contract are unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Make `ArrangeView`'s step bar-relative and gate it on the arrange tab

`src/components/song/ArrangeView.tsx:82-90`:

```ts
  useEffect(() => {
    if (!isPlaying) {
      setCurrentStep(0);
      return;
    }
    return subscribePlaybackClock((step) => {
      setCurrentStep(step);
    });
  }, [isPlaying]);
```

Two problems:

1. **The stored value is the raw monotonic step.** It grows without bound for the whole
   session, so it is never equal to its previous value and React can never bail out of the
   `setCurrentStep` — every tick is a guaranteed re-render of `ArrangeView` plus the
   currently-playing `SortableLoopCard`.
2. **The effect is gated only on `isPlaying`, never on the tab.** `SongPage.tsx:10` renders
   `<ArrangeView />` inside `activeTab === 'arrange' ? 'block' : 'hidden'`, so this runs at
   8-16 Hz while the user is on the Synth, Sequencer, Chords or Master FX tab and the whole
   list is `display:none`.

Gating on the tab is the dominant win, and the codebase already establishes the idiom for
exactly this hazard: `EffectsRackView.tsx:296-300` passes `paused={activeTab !== "effects"}`
with the comment *"Master FX is the only tab that renders this visualizer; App.tsx keeps the
tab mounted while hidden, so gate the rAF loop on the active tab to avoid burning CPU
off-screen"*, `SynthView.tsx:418` does the same with `paused={activeTab !== 'synth'}`, and
`AudioVisualizer.tsx:603-612` spells out why skipping work *inside* a still-running loop is
not enough.

Making the value bar-relative is the smaller, secondary win, and I want to be precise about
what it buys: it does **not** make the common case bail out (a value that advances every tick
still differs every tick). It bounds the stored number to one arrangement cycle instead of
growing all session, and it lets the identity guard actually fire on the cases where the clock
re-dispatches a step it has already delivered — which the stall detector at `engine.ts:294`
does whenever it re-anchors the grid.

The derivation is the delicate part and is TDD'd. `:202-204` computes
`currentStep % totalStepsInLoop` **per card**, with a different `totalStepsInLoop` for each
loop, so the stored value may only be reduced modulo a **common multiple** of every card's
total — otherwise a card's progress bar would jump. That common multiple is the LCM, capped so
a pathological arrangement falls back to the raw step rather than producing a useless number.

**Files:**
- Create: `src/components/song/arrangeStep.ts`
- Create: `src/components/song/arrangeStep.test.ts`
- Modify: `src/components/song/ArrangeView.tsx:1-26` (imports), `:79-94` (the effect and the
  derived cycle)
- Modify (test): `src/components/song/ArrangeView.test.tsx` — no change expected; run it

**Interfaces:**
- Consumes: `loopBars(chords: readonly { bars?: number }[]): number` from
  `src/store/loop.ts`; `getMeter(id)` from `src/utils/meter.ts`; `useAppStore`;
  `subscribePlaybackClock` from `src/audio/playback/playbackEngine.ts`.
- Produces:
  ```ts
  /** Above this, the LCM stops being a useful bound and the raw step is used. */
  export const ARRANGE_CYCLE_MAX = 100_000;

  /**
   * The smallest step count after which EVERY loop's progress repeats, i.e. the
   * LCM of the per-loop totals. Returns 0 when there is no usable cycle (no
   * positive totals, or an LCM past ARRANGE_CYCLE_MAX).
   */
  export function arrangeCycleSteps(totals: readonly number[]): number;

  /** The step to store: reduced modulo `cycle`, or unchanged when cycle is 0. */
  export function arrangeStep(rawStep: number, cycle: number): number;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/components/song/arrangeStep.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { ARRANGE_CYCLE_MAX, arrangeCycleSteps, arrangeStep } from './arrangeStep';

describe('arrangeCycleSteps', () => {
  test('no loops means no cycle', () => {
    expect(arrangeCycleSteps([])).toBe(0);
  });

  test('one loop cycles on its own length', () => {
    expect(arrangeCycleSteps([64])).toBe(64);
  });

  test('identical loops cycle on that length, not on their product', () => {
    expect(arrangeCycleSteps([64, 64, 64])).toBe(64);
  });

  test('different lengths cycle on their least common multiple', () => {
    expect(arrangeCycleSteps([64, 96])).toBe(192);
    expect(arrangeCycleSteps([16, 24, 32])).toBe(96);
  });

  test('non-positive totals are ignored rather than poisoning the LCM', () => {
    expect(arrangeCycleSteps([64, 0, -3])).toBe(64);
    expect(arrangeCycleSteps([0, 0])).toBe(0);
  });

  test('an LCM past the cap gives up and returns 0', () => {
    // Three large coprime totals: the LCM is ~9.9e11, far past the cap.
    expect(arrangeCycleSteps([9973, 9967, 9949])).toBe(0);
    expect(ARRANGE_CYCLE_MAX).toBe(100_000);
  });

  test('an LCM exactly at the cap is still usable', () => {
    expect(arrangeCycleSteps([ARRANGE_CYCLE_MAX])).toBe(ARRANGE_CYCLE_MAX);
  });
});

describe('arrangeStep', () => {
  test('a zero cycle passes the raw step straight through', () => {
    expect(arrangeStep(12345, 0)).toBe(12345);
  });

  test('a real cycle wraps the step', () => {
    expect(arrangeStep(0, 64)).toBe(0);
    expect(arrangeStep(63, 64)).toBe(63);
    expect(arrangeStep(64, 64)).toBe(0);
    expect(arrangeStep(200, 64)).toBe(8);
  });

  test('THE INVARIANT: reducing by the cycle never changes any card’s progress', () => {
    // ArrangeView computes `currentStep % totalStepsInLoop` per card, so the
    // stored value may only be reduced modulo a COMMON multiple of every
    // total. This is the assertion that proves the derivation is safe.
    const totals = [64, 96, 48];
    const cycle = arrangeCycleSteps(totals);
    expect(cycle).toBe(192);
    for (let raw = 0; raw < 1000; raw++) {
      const stored = arrangeStep(raw, cycle);
      for (const total of totals) {
        expect(stored % total).toBe(raw % total);
      }
    }
  });

  test('the invariant also holds for a single loop', () => {
    const cycle = arrangeCycleSteps([48]);
    for (let raw = 0; raw < 500; raw++) {
      expect(arrangeStep(raw, cycle) % 48).toBe(raw % 48);
    }
  });

  test('the stored value repeats, so it is bounded for the whole session', () => {
    const cycle = arrangeCycleSteps([64, 96]);
    expect(arrangeStep(10_000_000, cycle)).toBeLessThan(cycle);
    expect(arrangeStep(5, cycle)).toBe(arrangeStep(5 + cycle, cycle));
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/components/song/arrangeStep.test.ts`
Expected: FAIL — cannot resolve `./arrangeStep`.

- [ ] **Step 3: Write the pure module**

Create `src/components/song/arrangeStep.ts`:

```ts
/**
 * Above this the LCM stops being a useful bound (an arrangement of coprime
 * loop lengths can push it into the billions), so the raw monotonic step is
 * used instead — correct, just unbounded, exactly as it was before.
 */
export const ARRANGE_CYCLE_MAX = 100_000;

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * The smallest step count after which EVERY loop's progress repeats.
 *
 * ArrangeView reduces the playhead per card with `currentStep %
 * totalStepsInLoop`, and each card has its own total, so the stored value may
 * only be reduced modulo a COMMON multiple of all of them — the LCM. Returns 0
 * when there is no usable cycle (no positive totals, or the LCM exceeds
 * ARRANGE_CYCLE_MAX), which callers read as "do not reduce".
 */
export function arrangeCycleSteps(totals: readonly number[]): number {
  let cycle = 0;
  for (const total of totals) {
    // A non-positive total is not a real loop length; ignoring it is safer
    // than letting a 0 collapse the LCM.
    if (!Number.isFinite(total) || total <= 0) continue;
    const next = Math.round(total);
    if (cycle === 0) {
      cycle = next;
    } else {
      cycle = (cycle / gcd(cycle, next)) * next;
    }
    if (cycle > ARRANGE_CYCLE_MAX) return 0;
  }
  return cycle;
}

/** The step to store: reduced modulo `cycle`, or unchanged when cycle is 0. */
export function arrangeStep(rawStep: number, cycle: number): number {
  return cycle > 0 ? rawStep % cycle : rawStep;
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `bun test src/components/song/arrangeStep.test.ts`
Expected: PASS (13 tests), including the invariant sweep.

- [ ] **Step 5: Wire it into `ArrangeView`**

In `src/components/song/ArrangeView.tsx`, add to the imports:

```ts
import { arrangeCycleSteps, arrangeStep } from './arrangeStep';
```

Replace lines 79-94:

```ts
  // Live playback clock step for real-time progress bar
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!isPlaying) {
      setCurrentStep(0);
      return;
    }
    return subscribePlaybackClock((step) => {
      setCurrentStep(step);
    });
  }, [isPlaying]);

  const stepsPerBar = useMemo(() => getMeter(meterId).stepsPerBar, [meterId]);

  const loopIds = useMemo(() => loops.map((l) => l.id), [loops]);
```

with:

```ts
  const activeTab = useAppStore((s) => s.activeTab);
  const stepsPerBar = useMemo(() => getMeter(meterId).stepsPerBar, [meterId]);

  // The per-card totals this view divides the playhead by (see the map below).
  // The stored step may only be reduced modulo a COMMON multiple of all of
  // them, or a card's progress bar would jump — arrangeStep.test.ts pins that
  // invariant.
  const cycleSteps = useMemo(
    () =>
      arrangeCycleSteps(
        loops.map(
          (loop) =>
            Math.max(1, loopBars(loop.chords) * stepsPerBar) *
            Math.max(1, loop.repeatCount ?? 1),
        ),
      ),
    [loops, stepsPerBar],
  );

  // Live playback clock step for real-time progress bar
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    // Gated on the tab, not just on isPlaying: SongPage.tsx:10 keeps this view
    // mounted behind `hidden` while the user is on any other tab, so without
    // this the clock drove a setState 8-16x/sec into an invisible list. Same
    // idiom (and same reason) as the AudioVisualizer `paused` gates at
    // EffectsRackView.tsx:299 and SynthView.tsx:418 — see
    // AudioVisualizer.tsx:603-612 for why gating inside the callback is not
    // enough.
    if (!isPlaying || activeTab !== 'arrange') {
      setCurrentStep(0);
      return;
    }
    return subscribePlaybackClock((step) => {
      // Bar-relative, not the raw monotonic step: bounded to one arrangement
      // cycle instead of growing all session, and the identity guard can then
      // actually suppress a render when the clock re-dispatches a step it has
      // already delivered (the stall detector at engine.ts:294 re-anchors the
      // grid and does exactly that).
      const next = arrangeStep(step, cycleSteps);
      setCurrentStep((prev) => (prev === next ? prev : next));
    });
  }, [isPlaying, activeTab, cycleSteps]);

  const loopIds = useMemo(() => loops.map((l) => l.id), [loops]);
```

Note the reorder: `stepsPerBar` moves **above** the effect because `cycleSteps` depends on it.

- [ ] **Step 6: Type-check and run the suites**

Run: `bun run lint`
Expected: clean — in particular `stepsPerBar` must be declared before `cycleSteps` uses it.
Run: `bun test src/components/song/ArrangeView.test.tsx src/components/song/SortableLoopCard.test.tsx src/components/song/arrangeStep.test.ts`
Expected: PASS.
Run: `bun run verify`
Expected: green.

- [ ] **Step 7: Manual verification**

1. `bun run dev`, click to start audio. On **Arrange**, create three loops with *different*
   lengths — e.g. leave Loop 1 at its default progression, give Loop 2 a progression of a
   different bar count, and set Loop 3's repeat count to 3.
2. Enter song mode and press Play, staying on the **Arrange** tab.
   Expected: the playing card's progress bar fills smoothly from 0 to 100% over that loop's
   full length (including its repeats), then hands over to the next card. The repeat counter
   (`1/3`, `2/3`, `3/3`) counts correctly.
3. Let the arrangement wrap around to the first loop at least twice.
   Expected: every card's progress bar still fills over exactly its own length — this is what
   would break if the stored step were reduced by the wrong modulus.
4. While it plays, switch to the **Synth** tab, wait ~10 seconds, then switch back to
   **Arrange**.
   Expected: the progress bar is correct for the currently-playing loop immediately on return
   (the effect re-arms on the tab change and the next clock tick repositions it).
5. Press Stop. Expected: every progress bar resets to 0.
6. Drag to reorder loops, and rename one, while playing.
   Expected: playback and progress stay coherent.

- [ ] **Step 8: Commit**

```bash
git add src/components/song/arrangeStep.ts src/components/song/arrangeStep.test.ts src/components/song/ArrangeView.tsx
git commit -m "perf(arrange): gate the clock effect on the arrange tab and bound its step

ArrangeView subscribed the clock whenever anything played, regardless of which
tab was visible, and stored the RAW monotonic step — so it drove a setState
8-16x/sec into a display:none list for the whole session. The effect is now
gated on activeTab === 'arrange', the same idiom as the AudioVisualizer
`paused` gates at EffectsRackView.tsx:299 and SynthView.tsx:418, and the
stored value is reduced modulo the LCM of every card's total step count, which
arrangeStep.test.ts pins as leaving each card's `step % total` identical.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Memoize `buildArpSequence` and move the rate early-out ahead of the build

`buildArpSequence` runs a `tonal`-backed sort plus N transposes *inside* the clock tick, on every 16th step, for every arp source (chord arp, bass arp, lead arp, keyboard arp). At rate `4n` four of every five of those rebuilds are thrown away because `computeArpTriggers` decides on the *next* line that this step does not fire. Two independent fixes: a keyed cache in front of the builder, and an `arpFiresOnStep` gate the callers can ask *before* they build.

`random` mode is deliberately excluded from the cache: it re-shuffles on every call today, and that per-step reshuffle is audible behaviour. Caching it would turn a per-step shuffle into a per-held-set shuffle — a real change, so it is gated out rather than accepted silently.

**Files:**
- Modify: `src/audio/arpeggiator.ts:11-51` (`buildArpSequence` — becomes a memo wrapper over a renamed pure builder)
- Modify: `src/audio/arpSchedule.ts:26-40` (`computeArpTriggers` — add `arpFiresOnStep`, route the existing early-out through it)
- Modify: `src/audio/playback/arpPlayback.ts:40-49` (gate before build)
- Modify: `src/audio/playback/chordPlayback.ts:176-190` (`arpEventsForStep` — gate before build)
- Modify: `src/audio/leadMelody.ts:132` (gate before build)
- Test: `src/audio/arpeggiator.test.ts` (append two describes), `src/audio/arpSchedule.test.ts` (create)

**Interfaces:**
- Consumes: `ArpMode`, `ArpRate` from `src/types.ts`; `arpStepFor` from `src/utils/meter.ts`.
- Produces:
  - `buildArpSequenceUncached(heldNotes: Iterable<string>, mode: ArpMode, octaves: number): string[]` — today's body, unchanged, exported for the cache test.
  - `buildArpSequence(heldNotes: Iterable<string>, mode: ArpMode, octaves: number): string[]` — memoized wrapper. Same signature and same return values as today. **The returned array must be treated as read-only by callers** (all three current callers only index it and read `.length`).
  - `resetArpSequenceCache(): void`
  - `arpCacheStats(): { hits: number; misses: number }`
  - `ARP_SEQUENCE_CACHE_MAX = 8` (number)
  - `arpFiresOnStep(step: number, rate: ArpRate): boolean` from `src/audio/arpSchedule.ts`

- [ ] **Step 1: Write the failing cache tests**

Append to `src/audio/arpeggiator.test.ts`:

```ts
import {
  ARP_SEQUENCE_CACHE_MAX,
  arpCacheStats,
  buildArpSequenceUncached,
  resetArpSequenceCache,
} from './arpeggiator';

describe('buildArpSequence memoization', () => {
  test('N ticks with unchanged inputs build the sequence exactly once', () => {
    resetArpSequenceCache();
    const held = new Set(['C4', 'E4', 'G4']);
    const first = buildArpSequence(held, 'up', 2);
    for (let tick = 0; tick < 15; tick++) {
      expect(buildArpSequence(held, 'up', 2)).toBe(first);
    }
    expect(arpCacheStats()).toEqual({ hits: 15, misses: 1 });
  });

  test('a changed held set, mode or octave count is a miss', () => {
    resetArpSequenceCache();
    buildArpSequence(['C4'], 'up', 1);
    buildArpSequence(['C4', 'E4'], 'up', 1);
    buildArpSequence(['C4', 'E4'], 'down', 1);
    buildArpSequence(['C4', 'E4'], 'down', 2);
    expect(arpCacheStats()).toEqual({ hits: 0, misses: 4 });
  });

  test('four concurrent arp sources with different held sets all stay cached', () => {
    // chord arp, bass arp, lead arp and the keyboard arp all call this from
    // the same clock tick with different held sets — a one-entry cache would
    // thrash to a 0% hit rate, which is why the cache holds 8.
    resetArpSequenceCache();
    const sets = [['C4', 'E4'], ['C2'], ['G5', 'B5'], ['A4']];
    for (let tick = 0; tick < 4; tick++) {
      for (const s of sets) buildArpSequence(s, 'up', 1);
    }
    expect(arpCacheStats()).toEqual({ hits: 12, misses: 4 });
  });

  test('the cache is bounded and evicts the oldest key', () => {
    resetArpSequenceCache();
    for (let i = 0; i < ARP_SEQUENCE_CACHE_MAX + 1; i++) {
      buildArpSequence([`C${i % 8}`, 'E4'], 'up', i + 1);
    }
    // The first key was evicted by the 9th insert, so asking for it again misses.
    buildArpSequence(['C0', 'E4'], 'up', 1);
    expect(arpCacheStats().misses).toBe(ARP_SEQUENCE_CACHE_MAX + 2);
  });

  test('random mode is never cached — its per-step reshuffle is the behaviour', () => {
    resetArpSequenceCache();
    const held = ['C4', 'E4', 'G4', 'B4', 'D5', 'F5'];
    buildArpSequence(held, 'random', 2);
    buildArpSequence(held, 'random', 2);
    buildArpSequence(held, 'random', 2);
    expect(arpCacheStats()).toEqual({ hits: 0, misses: 0 });
  });

  test('the memo wrapper returns exactly what the uncached builder returns', () => {
    resetArpSequenceCache();
    for (const mode of ['up', 'down', 'updown'] as const) {
      for (const octaves of [1, 2, 3]) {
        expect(buildArpSequence(['G4', 'C4', 'E4'], mode, octaves)).toEqual(
          buildArpSequenceUncached(['G4', 'C4', 'E4'], mode, octaves),
        );
      }
    }
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `bun test src/audio/arpeggiator.test.ts`
Expected: FAIL — `resetArpSequenceCache is not a function` / `buildArpSequenceUncached` is not exported.

- [ ] **Step 3: Add the cache to `arpeggiator.ts`**

In `src/audio/arpeggiator.ts`, rename the existing `export function buildArpSequence` to `buildArpSequenceUncached` (body byte-identical, doc comment kept) and append below it:

```ts
/**
 * How many distinct (heldNotes, mode, octaves) triples stay cached.
 *
 * Eight, not one: the chord arp, the bass arp, the lead arp and the keyboard
 * arp all call buildArpSequence from the SAME clock tick with different held
 * sets, so a one-entry cache would evict on every call and never hit.
 */
export const ARP_SEQUENCE_CACHE_MAX = 8;

const sequenceCache = new Map<string, string[]>();
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Held notes in ITERATION order, not sorted: sorting is the expensive half of
 * the build and doing it to compute a key would defeat the cache. The Set the
 * callers pass keeps insertion order stable for a given press sequence, so the
 * steady-state case (same held notes across many ticks) hits.
 */
function cacheKey(heldNotes: Iterable<string>, mode: ArpMode, octaves: number): string {
  let notes = '';
  for (const note of heldNotes) notes += `${note},`;
  return `${mode}|${octaves}|${notes}`;
}

/** Test-only: hit/miss counters for the memo, so a test can prove N ticks build once. */
export function arpCacheStats(): { hits: number; misses: number } {
  return { hits: cacheHits, misses: cacheMisses };
}

/** Test-only: drops every cached sequence and zeroes the counters. */
export function resetArpSequenceCache(): void {
  sequenceCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Memoized `buildArpSequenceUncached`.
 *
 * This runs inside the lookahead clock callback on every 16th step, for every
 * active arp source, and the uncached build is an Array.from + a sort whose
 * comparator calls Note.midi twice per comparison + one `transpose` per note
 * per octave + up to three more array spreads. Its inputs only change when the
 * held set or the Mode/Octaves knobs change, so all of that was steady-state
 * garbage generated in exactly the callback where a GC pause becomes a
 * scheduling stall.
 *
 * `random` is deliberately NOT cached: it reshuffles on every call today, and
 * that per-step reshuffle is audible behaviour, not an implementation detail.
 *
 * The returned array is SHARED with every other caller holding the same key —
 * callers must treat it as read-only. All three call sites only index it and
 * read `.length`.
 */
export function buildArpSequence(
  heldNotes: Iterable<string>,
  mode: ArpMode,
  octaves: number,
): string[] {
  if (mode === 'random') return buildArpSequenceUncached(heldNotes, mode, octaves);

  const key = cacheKey(heldNotes, mode, octaves);
  const cached = sequenceCache.get(key);
  if (cached) {
    cacheHits++;
    return cached;
  }
  cacheMisses++;
  const built = buildArpSequenceUncached(heldNotes, mode, octaves);
  sequenceCache.set(key, built);
  if (sequenceCache.size > ARP_SEQUENCE_CACHE_MAX) {
    const oldest = sequenceCache.keys().next().value;
    if (oldest !== undefined) sequenceCache.delete(oldest);
  }
  return built;
}
```

- [ ] **Step 4: Run the cache tests**

Run: `bun test src/audio/arpeggiator.test.ts`
Expected: PASS — all pre-existing `buildArpSequence` describes plus the six new ones.

- [ ] **Step 5: Write the failing `arpFiresOnStep` test**

Create `src/audio/arpSchedule.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { arpFiresOnStep, computeArpTriggers } from './arpSchedule';

describe('arpFiresOnStep', () => {
  test('16n fires on every step', () => {
    for (let step = 0; step < 16; step++) {
      expect(arpFiresOnStep(step, '16n')).toBe(true);
    }
  });

  test('8n fires on every other step', () => {
    expect([0, 1, 2, 3, 4].map((s) => arpFiresOnStep(s, '8n'))).toEqual([
      true, false, true, false, true,
    ]);
  });

  test('4n fires on one step in four', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => arpFiresOnStep(s, '4n'))).toEqual([
      true, false, false, false, true, false,
    ]);
  });

  test('32n fires on every step (it emits two notes per step)', () => {
    for (let step = 0; step < 8; step++) {
      expect(arpFiresOnStep(step, '32n')).toBe(true);
    }
  });

  test('it agrees exactly with computeArpTriggers returning nothing', () => {
    for (const rate of ['4n', '8n', '16n', '32n'] as const) {
      for (let step = 0; step < 32; step++) {
        const fires = computeArpTriggers(step, 4, rate, 0.125).length > 0;
        expect(`${rate}@${step}=${arpFiresOnStep(step, rate)}`).toBe(`${rate}@${step}=${fires}`);
      }
    }
  });
});
```

- [ ] **Step 6: Run, confirm fail**

Run: `bun test src/audio/arpSchedule.test.ts`
Expected: FAIL — `arpFiresOnStep` is not exported from `./arpSchedule`.

- [ ] **Step 7: Add `arpFiresOnStep` and route the early-out through it**

In `src/audio/arpSchedule.ts`, insert above `computeArpTriggers`:

```ts
/**
 * Whether `rate` fires anything at all on this bar-phased step.
 *
 * Exists so a clock subscriber can skip the expensive `buildArpSequence` on
 * the four-in-five steps a 4n arp does not fire on — the sequence used to be
 * built BEFORE computeArpTriggers got a chance to say "nothing here".
 *
 * `step` must already be bar-phased by `arpStepFor`, exactly like
 * computeArpTriggers' own `step`.
 */
export function arpFiresOnStep(step: number, rate: ArpRate): boolean {
  return step % ARP_RATE_CFG[rate].stepMod === 0;
}
```

and change `computeArpTriggers`' first two lines from

```ts
  const cfg = ARP_RATE_CFG[rate];
  if (step % cfg.stepMod !== 0) return [];
```

to

```ts
  if (!arpFiresOnStep(step, rate)) return [];
  const cfg = ARP_RATE_CFG[rate];
```

- [ ] **Step 8: Gate the three call sites before they build**

`src/audio/playback/arpPlayback.ts` — change the import on line 4 to `import { arpFiresOnStep, computeArpTriggers } from '../arpSchedule';` and reorder the callback body so the step math and the gate run before the build:

```ts
      if (!params.arpActive) return;
      if (activeNotes.size === 0) return;

      // Gate BEFORE the build: at rate 4n this skips four of every five
      // buildArpSequence calls, each of which is a tonal sort plus one
      // transpose per note per octave, inside the lookahead callback.
      const stepDur16 = stepDurationSec(bpm);
      const arpStep = arpStepFor(step, audioEngine.getMeter().stepsPerBar);
      if (!arpFiresOnStep(arpStep, params.arpRate)) return;

      const sequence = buildArpSequence(
        activeNotes,
        params.arpMode,
        params.arpOctaves,
      );
      if (sequence.length === 0) return;

      for (const t of computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDur16)) {
```

`src/audio/playback/chordPlayback.ts` — in `arpEventsForStep`, add the gate before the build:

```ts
  const arpStep = arpStepFor(step, stepsPerBar);
  if (!arpFiresOnStep(arpStep, params.arpRate)) return [];

  const sequence = buildArpSequence(
    notes,
    params.arpMode,
    params.arpOctaves,
  );
  if (sequence.length === 0) return [];

  return computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDur).map(
```

and add `arpFiresOnStep` to its existing `../arpSchedule` import (or add `import { arpFiresOnStep } from '../arpSchedule';` if it imports `computeArpTriggers` via `./arpPlayback`).

`src/audio/leadMelody.ts` — apply the same shape at line 132: compute the bar-phased step, `if (!arpFiresOnStep(arpStep, params.arpRate)) return [];`, then build.

- [ ] **Step 9: Run the whole audio suite**

Run: `bun test src/audio`
Expected: PASS, same test count as before plus the new ones. `leadMelody.test.ts:100` ("arp ON reuses buildArpSequence + computeArpTriggers (16n fires one note)") is the regression guard for the reorder in `leadMelody.ts`; `chordPlayback.test.ts` covers `arpEventsForStep`.

- [ ] **Step 10: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: both clean. `arpeggiator.ts` and `arpSchedule.ts` are in `src/audio/` and import nothing from `store/` or `components/`.

- [ ] **Step 11: Commit**

```bash
git add src/audio/arpeggiator.ts src/audio/arpeggiator.test.ts src/audio/arpSchedule.ts src/audio/arpSchedule.test.ts src/audio/playback/arpPlayback.ts src/audio/playback/chordPlayback.ts src/audio/leadMelody.ts
git commit -m "perf(audio): memoize buildArpSequence and gate the arp rate before the build

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Stop copying the whole voice map on every bass note-on

The forced-mono bass path snapshots **every** active voice — chord, lead, keyboard, preview — into a fresh array on every bass note-on, then filters it down to the `bass:` prefix. `sourceVoices.get('bass')` is already exactly the right set and is far smaller. Behaviour must be identical, including the subtlety that `activeVoices` only keeps the *latest* voice per key while `sourceVoices` keeps every live-or-releasing one.

**Files:**
- Modify: `src/audio/engine.ts:587-599` (the `if (source === 'bass')` block at the **head** of `triggerSynthNoteOn`) — pre-branch; roughly `:604-616` after Tasks 2 and 3, which append at that function's tail. See the anchor-first rule in Task 3.
- Test: `src/audio/engine.test.ts` (append one describe)

**Interfaces:**
- Consumes: Tasks 2 and 3 only as line drift — they append at the **tail** of `triggerSynthNoteOn` and never touch the bass mono-kill at its head, so this task's block is semantically independent of both. Task 3's cap calls `releaseVoice` directly and never iterates `sourceVoices.get('bass')`, and its default cap of 24 is unreachable on a monophonic bass source.
- Produces: nothing new. `triggerSynthNoteOn`'s signature and observable behaviour are unchanged.

- [ ] **Step 1: Write the behaviour-pinning tests**

Append to `src/audio/engine.test.ts`:

```ts
describe('bass mono kill iterates the bass voice set, not every active voice', () => {
  test('a new bass note releases the previous bass voice and leaves other sources alone', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'chord');
    e.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth');
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');

    const oldBass = e.activeVoices.get('bass:C2');
    expect(oldBass).toBeTruthy();
    expect(oldBass.releaseScheduledAt).toBeUndefined();

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass');

    // The previous bass voice was released...
    expect(oldBass.releaseScheduledAt).toBe(ctx.currentTime);
    // ...and nothing else was touched.
    expect(e.activeVoices.get('chord:C4').releaseScheduledAt).toBeUndefined();
    expect(e.activeVoices.get('synth:E4').releaseScheduledAt).toBeUndefined();
  });

  test('a bass voice whose release has already started is not re-released', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');
    e.triggerSynthNoteOff('C2', 0.2, ctx.currentTime, 'bass');
    const dying = e.activeVoices.get('bass:C2');
    const cancelsBefore = dying.gains[0].gain.cancels.length;

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass');

    expect(dying.gains[0].gain.cancels.length).toBe(cancelsBefore);
  });

  test('a bass voice whose release is scheduled in the FUTURE is still cut short', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');
    // Release planned one second ahead — a long scheduled note that would
    // otherwise ring through the new one and break monophony.
    e.triggerSynthNoteOff('C2', 0.2, ctx.currentTime + 1, 'bass');
    const pending = e.activeVoices.get('bass:C2');
    expect(pending.releaseScheduledAt).toBe(ctx.currentTime + 1);

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass');

    expect(pending.releaseScheduledAt).toBe(ctx.currentTime);
  });

  test('a superseded bass voice of the same note is not double-released', () => {
    // sourceVoices keeps every live-or-releasing voice; activeVoices keeps
    // only the latest per key. Iterating sourceVoices without the identity
    // guard would call triggerSynthNoteOff('C2') twice for the same note.
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');
    const superseded = e.activeVoices.get('bass:C2');
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');
    const current = e.activeVoices.get('bass:C2');
    expect(current).not.toBe(superseded);

    const currentCancels = current.gains[0].gain.cancels.length;
    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass');

    // Exactly one release reached the current C2 voice.
    expect(current.gains[0].gain.cancels.length).toBe(currentCancels + 1);
  });
});
```

- [ ] **Step 2: Run against the current implementation, confirm PASS**

Run: `bun test src/audio/engine.test.ts -t "bass mono kill"`
Expected: PASS. These tests pin *existing* behaviour before the refactor — that is the point. If any fails, stop and fix the test, not the engine.

- [ ] **Step 3: Replace the map copy with a bass-set iteration**

In `src/audio/engine.ts`, replace lines 581-599 (the comment block and the `if (source === 'bass')` body) with:

```ts
    // Bass is monophonic like a real bass: kill any other sounding bass voice
    // BEFORE creating the new one.
    //
    // Iterates sourceVoices.get('bass') — the set that already holds exactly
    // the bass voices — rather than snapshotting the WHOLE activeVoices map on
    // every bass note-on and filtering it down by key prefix. During an arp
    // that map holds every chord, lead and preview voice too.
    //
    // The identity guard restores the old semantics exactly: activeVoices kept
    // only the LATEST voice per key, so a superseded same-note voice was never
    // visited. sourceVoices keeps every live-or-releasing voice, so without
    // this check a superseded voice would send a second, duplicate note-off
    // for the same note name — which triggerSynthNoteOff resolves against the
    // CURRENT voice, releasing it twice.
    //
    // The set is snapshotted with Array.from for the same reason the map used
    // to be: triggerSynthNoteOff reaches releaseVoice, and a future change
    // there that deletes from sourceVoices synchronously must not invalidate
    // this iteration. The copy is now over ~1-2 bass voices, not ~50.
    //
    // Pass `time` so a live previous voice's release ramp starts exactly when
    // the new note starts (not immediately); the release timeout already
    // accounts for the future `time` in its delay math.
    if (source === 'bass') {
      const killAt = time ?? this.ctx.currentTime;
      const bassVoices = this.sourceVoices.get('bass');
      if (bassVoices) {
        for (const tracked of Array.from(bassVoices)) {
          if (this.activeVoices.get(`bass:${tracked.noteName}`) !== tracked) continue;
          // A voice whose release has already STARTED is on its way out;
          // killing it again only resets its teardown timer and re-runs the
          // ramps. A release still ahead on the clock is a different case and
          // must be cut short here, or a long scheduled note would ring
          // through the new one and break monophony.
          if (tracked.releaseScheduledAt !== undefined && tracked.releaseScheduledAt <= killAt) continue;
          this.triggerSynthNoteOff(tracked.noteName, 0.05, time, 'bass', true);
        }
      }
    }
```

- [ ] **Step 4: Re-run the pinned tests plus the whole engine suite**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS — the four new tests plus every pre-existing one, same counts.

- [ ] **Step 5: Run the playback suites that drive the bass path**

Run: `bun test src/audio/playback src/audio/meterRegression.test.ts`
Expected: PASS. `chordPlayback.test.ts` exercises the bass scheduler that feeds this branch.

- [ ] **Step 6: Type-check and commit**

Run: `bun run lint`

```bash
git add src/audio/engine.ts src/audio/engine.test.ts
git commit -m "perf(audio): iterate the bass voice set instead of copying activeVoices

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: Give `impulseCache` a byte budget

`IMPULSE_CACHE_MAX = 8` bounds the impulse cache by **entry count**. A 10 s stereo impulse at 48 kHz is 480,000 frames × 2 channels = 960,000 `Float32` samples ≈ 3.84 MB, so eight of those pin ~30 MB of `AudioBuffer` for the lifetime of the `AudioContext`. Eight *short* impulses cost almost nothing. The cap is measuring the wrong thing.

This is complementary to Part 2's Task 16 (trailing-debounce on `reverbDecay`), not redundant with it: Task 16 cuts how *often* the cache is filled during a knob drag; this task caps how much memory a filled cache may hold. Either alone leaves the other failure mode open.

The eviction decision is pure arithmetic — it goes in its own module and is TDD'd there. The engine's cache becomes `Map<number, { buffer: AudioBuffer; samples: number }>` so the sample count is recorded at build time from `sampleRate * decay * 2`; that avoids reading `AudioBuffer.length` / `.numberOfChannels`, which `testFakes.ts`'s `fakeCtx.createBuffer` does not model.

**Files:**
- Create: `src/audio/impulseBudget.ts`
- Create: `src/audio/impulseBudget.test.ts`
- Modify: `src/audio/engine.ts:95-108` (the `impulseCache` field + its comment — `:93-94` belong to the `reverbDecay` field above it), `:190` (`IMPULSE_CACHE_MAX` → removed), `:508-530` (`getImpulseResponse`). **All pre-branch** — see the anchor-first rule in Task 3; after Tasks 2/3 these sit near `:101-114`, `:207` and `:525-547`.
- Test: `src/audio/engine.test.ts` (append one describe)

**Interfaces:**
- Consumes: **Task 16's `setReverbDecay`** — after Task 16, `getImpulseResponse` has exactly one caller and it is no longer `updateEffects`, which is why this task's field comment names `setReverbDecay` as the swap-and-rebuild gate. The two caps are complementary: Task 16 bounds how *often* the cache is filled during a knob drag, this task how *much* it may hold. Also Tasks 2 and 3 as line drift (see the anchor-first rule in Task 3).
- Produces (from `src/audio/impulseBudget.ts`):
  - `IMPULSE_CACHE_SAMPLE_BUDGET = 4_000_000` (number)
  - `interface ImpulseCacheEntry { key: number; samples: number }`
  - `impulseSampleCount(sampleRate: number, decaySec: number, channels?: number): number`
  - `keysToEvict(entries: readonly ImpulseCacheEntry[], budget?: number): number[]`
    — `entries` must be in LRU order (oldest first, which is a `Map`'s own iteration order). Returns the oldest keys, in order, whose removal brings the total to or below `budget`. **Never returns the last entry's key**, so the impulse just built is always kept even if it alone exceeds the budget.

- [ ] **Step 1: Write the failing eviction tests**

Create `src/audio/impulseBudget.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  IMPULSE_CACHE_SAMPLE_BUDGET,
  impulseSampleCount,
  keysToEvict,
} from './impulseBudget';

describe('impulseSampleCount', () => {
  test('counts both channels of the buffer buildImpulseResponse creates', () => {
    // buildImpulseResponse: createBuffer(2, floor(sampleRate * durationSec), sampleRate)
    expect(impulseSampleCount(48000, 10)).toBe(48000 * 10 * 2);
    expect(impulseSampleCount(44100, 2)).toBe(44100 * 2 * 2);
  });

  test('a sub-sample decay still counts one frame, matching the engine clamp', () => {
    expect(impulseSampleCount(48000, 0)).toBe(2);
  });

  test('the channel count is overridable but defaults to stereo', () => {
    expect(impulseSampleCount(48000, 1, 1)).toBe(48000);
  });
});

describe('keysToEvict', () => {
  test('evicts nothing while the total is inside the budget', () => {
    expect(keysToEvict([{ key: 1, samples: 10 }, { key: 2, samples: 20 }], 100)).toEqual([]);
  });

  test('evicts the oldest keys first, and only as many as it must', () => {
    const entries = [
      { key: 0.1, samples: 40 },
      { key: 0.2, samples: 40 },
      { key: 0.3, samples: 40 },
    ];
    expect(keysToEvict(entries, 100)).toEqual([0.1]);
    expect(keysToEvict(entries, 45)).toEqual([0.1, 0.2]);
  });

  test('never evicts the newest entry, even when it alone blows the budget', () => {
    const entries = [
      { key: 0.1, samples: 10 },
      { key: 9.9, samples: 5_000_000 },
    ];
    expect(keysToEvict(entries, 1000)).toEqual([0.1]);
  });

  test('a single over-budget entry is kept rather than evicting the whole cache', () => {
    expect(keysToEvict([{ key: 9.9, samples: 5_000_000 }], 1000)).toEqual([]);
  });

  test('an empty cache evicts nothing', () => {
    expect(keysToEvict([], 100)).toEqual([]);
  });

  test('the shipped budget holds four full-length 10 s stereo impulses at 48 kHz', () => {
    const one = impulseSampleCount(48000, 10);
    expect(Math.floor(IMPULSE_CACHE_SAMPLE_BUDGET / one)).toBe(4);
  });

  test('the shipped budget is strictly tighter than the old 8-entry cap ever was', () => {
    // Old worst case: 8 x 10 s stereo at 48 kHz = 7,680,000 samples (~30 MB).
    expect(IMPULSE_CACHE_SAMPLE_BUDGET).toBeLessThan(8 * impulseSampleCount(48000, 10));
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/audio/impulseBudget.test.ts`
Expected: FAIL — module `./impulseBudget` does not exist.

- [ ] **Step 3: Write `impulseBudget.ts`**

Create `src/audio/impulseBudget.ts`:

```ts
/**
 * The reverb impulse cache's eviction policy, as pure arithmetic.
 *
 * The engine used to bound this cache by ENTRY COUNT (IMPULSE_CACHE_MAX = 8),
 * which measures the wrong thing: eight 0.2 s impulses are ~150 KB, eight 10 s
 * stereo impulses at 48 kHz are ~30 MB, and the cache treated them the same.
 * Bounding on total samples makes the memory ceiling the thing that is
 * actually capped.
 *
 * Lives outside engine.ts so the policy is testable without an AudioContext.
 */

/** One cached impulse: its quantised-decay key and its Float32 sample count. */
export interface ImpulseCacheEntry {
  key: number;
  samples: number;
}

/**
 * ~16 MB of Float32 (4 bytes/sample) — four full-length 10 s stereo impulses
 * at 48 kHz, or ~40 one-second ones. Chosen against the OLD worst case: the
 * 8-entry cap allowed 7,680,000 samples (~30 MB) of pinned AudioBuffer after a
 * sweep near the top of the Decay range.
 */
export const IMPULSE_CACHE_SAMPLE_BUDGET = 4_000_000;

/**
 * Sample count of the buffer `AudioEngine.buildImpulseResponse` creates for a
 * decay: `createBuffer(2, max(1, floor(sampleRate * durationSec)), sampleRate)`.
 *
 * Derived from the decay rather than read off the AudioBuffer so the engine
 * never has to touch `length`/`numberOfChannels` — the test fake models
 * neither.
 */
export function impulseSampleCount(sampleRate: number, decaySec: number, channels = 2): number {
  return Math.max(1, Math.floor(sampleRate * decaySec)) * channels;
}

/**
 * Which keys to drop, oldest first, to bring `entries` inside `budget`.
 *
 * `entries` must be in LRU order (oldest first) — a Map's own iteration order,
 * which `getImpulseResponse` already maintains by re-inserting on every hit.
 *
 * The newest entry is never evicted: it is the impulse the caller just built
 * and is about to assign to the ConvolverNode, and a single 10 s impulse can
 * legitimately exceed a budget smaller than itself. Evicting it would make the
 * cache a guaranteed miss at the top of the Decay range.
 */
export function keysToEvict(
  entries: readonly ImpulseCacheEntry[],
  budget = IMPULSE_CACHE_SAMPLE_BUDGET,
): number[] {
  if (entries.length === 0) return [];
  let total = 0;
  for (const entry of entries) total += entry.samples;

  const evicted: number[] = [];
  // entries.length - 1: stop before the newest entry.
  for (let i = 0; i < entries.length - 1 && total > budget; i++) {
    evicted.push(entries[i].key);
    total -= entries[i].samples;
  }
  return evicted;
}
```

- [ ] **Step 4: Run the eviction tests**

Run: `bun test src/audio/impulseBudget.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the failing engine-integration test**

Append to `src/audio/engine.test.ts`:

```ts
describe('impulse cache is bounded by samples, not entries', () => {
  test('long impulses evict early; short impulses do not', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    // freshEngine's fake context reports sampleRate 64, so a real 4,000,000
    // budget would need 31,250 s of decay to trip. Shrink the ENGINE's budget
    // instead of faking a sample rate, so this exercises the same code path
    // production does. At sampleRate 64, samples = floor(64 * decay) * 2.
    e.impulseCacheSampleBudget = 800;

    e.getImpulseResponse(2.0); // 256 samples
    e.getImpulseResponse(2.5); // 320 samples -> total 576, inside 800
    expect(Array.from(e.impulseCache.keys())).toEqual([2.0, 2.5]);

    e.getImpulseResponse(3.0); // 384 samples -> total 960, over budget;
                               // evicting the oldest (256) brings it to 704.
    expect(Array.from(e.impulseCache.keys())).toEqual([2.5, 3.0]);
  });

  test('a hit moves the key to the newest position (LRU order is preserved)', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    e.getImpulseResponse(1.0);
    e.getImpulseResponse(2.0);
    e.getImpulseResponse(1.0);
    expect(Array.from(e.impulseCache.keys())).toEqual([2.0, 1.0]);
  });

  test('a single impulse larger than the whole budget is still cached', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    e.impulseCacheSampleBudget = 10;
    const buffer = e.getImpulseResponse(9.9);
    expect(buffer).toBeTruthy();
    expect(Array.from(e.impulseCache.keys())).toEqual([9.9]);
  });

  test('a repeated decay returns the same buffer instance', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    expect(e.getImpulseResponse(2.0)).toBe(e.getImpulseResponse(2.0));
  });
});
```

- [ ] **Step 6: Run, confirm fail**

Run: `bun test src/audio/engine.test.ts -t "impulse cache is bounded"`
Expected: FAIL — `impulseCacheSampleBudget` is undefined, so the budget test evicts on the 8-entry rule and the key order assertions do not match.

- [ ] **Step 7: Rewire the engine's cache**

In `src/audio/engine.ts`:

Add to the imports at the top of the file:

```ts
import { IMPULSE_CACHE_SAMPLE_BUDGET, impulseSampleCount, keysToEvict } from './impulseBudget';
```

Replace the `impulseCache` field and its comment (pre-branch lines 95-108; roughly `:101-114` after Tasks 2/3 — the block starts at `// Impulse responses keyed by quantised decay` and ends at the `private impulseCache = new Map<number, AudioBuffer>();` declaration) with:

```ts
  // Impulse responses keyed by quantised decay, bounded by TOTAL SAMPLES
  // (see audio/impulseBudget.ts) rather than by entry count. The 0.1 s quantum
  // over the 0.1-10 s clamp range is up to 100 distinct decays, and a 10 s
  // stereo buffer at 48 kHz is ~3.84 MB — an 8-ENTRY cap therefore allowed
  // ~30 MB of pinned AudioBuffer, while eight short impulses cost ~150 KB. The
  // cap was measuring the wrong thing.
  //
  // Building one is sampleRate * decay * 2 channels of Math.random() +
  // Math.pow() on the main thread, so this cache skips the rebuild once a
  // value has been seen. Swap and rebuild share one gate
  // (nextDecay !== this.reverbDecay in setReverbDecay — Part 2's Task 16 moved
  // that gate out of updateEffects), so a monotonic sweep
  // still swaps convolver.buffer once per 0.1 s step crossed — this cache
  // skips the expensive rebuild, not the swap itself. `samples` is recorded at
  // build time from the decay rather than read off the AudioBuffer, so the
  // accounting does not depend on AudioBuffer.length. Cleared in
  // setupMasterChain: an AudioBuffer belongs to its context.
  private impulseCache = new Map<number, { buffer: AudioBuffer; samples: number }>();
  /** Overridable for tests; production always uses the module default. */
  private impulseCacheSampleBudget = IMPULSE_CACHE_SAMPLE_BUDGET;
```

Delete the `private static readonly IMPULSE_CACHE_MAX = 8; ...` declaration (pre-branch line 190; roughly `:207` after Tasks 2/3) entirely.

Replace `getImpulseResponse` (pre-branch lines 508-530; roughly `:525-547` after Tasks 2/3) with:

```ts
  /**
   * Cached impulse for a quantised decay, built on first use. Bounded by a
   * total-sample budget with LRU eviction — see `audio/impulseBudget.ts` for
   * the policy and the field comment on `impulseCache` for why bytes, not
   * entries, is the right unit here.
   */
  private getImpulseResponse(quantisedDecay: number): AudioBuffer {
    const cached = this.impulseCache.get(quantisedDecay);
    if (cached) {
      // Re-inserting moves the key to the end of the Map's iteration order,
      // which this cache uses as its LRU recency order.
      this.impulseCache.delete(quantisedDecay);
      this.impulseCache.set(quantisedDecay, cached);
      return cached.buffer;
    }
    const buffer = this.buildImpulseResponse(quantisedDecay, AudioEngine.REVERB_CURVE);
    const samples = impulseSampleCount(this.ctx?.sampleRate ?? 44100, quantisedDecay);
    this.impulseCache.set(quantisedDecay, { buffer, samples });

    const entries = Array.from(this.impulseCache, ([key, value]) => ({ key, samples: value.samples }));
    for (const key of keysToEvict(entries, this.impulseCacheSampleBudget)) {
      this.impulseCache.delete(key);
    }
    return buffer;
  }
```

- [ ] **Step 8: Run the engine suite**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS — the four new tests plus every pre-existing one. `setupMasterChain`'s `this.impulseCache.clear()` (pre-branch line 338) still compiles unchanged (`Map.clear` is type-agnostic).

- [ ] **Step 9: Type-check, lint, full audio suite**

Run: `bun run lint && bun run eslint && bun test src/audio`
Expected: all clean. Grep for stragglers: `grep -rn "IMPULSE_CACHE_MAX" src/` must return nothing.

- [ ] **Step 10: Commit**

```bash
git add src/audio/impulseBudget.ts src/audio/impulseBudget.test.ts src/audio/engine.ts src/audio/engine.test.ts
git commit -m "perf(audio): bound the reverb impulse cache by samples instead of entry count

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: Stream a progression audition off the clock

`previewChordProgression` allocates every chord's voices in one synchronous burst. A 16-chord × 4-note progression is 64 `triggerSynthNoteOn` calls creating ~384 nodes plus 64 pending teardown timers, all inside one click handler — a visible frame hitch, and the chords at the end of the burst sit scheduled up to 8 s in the future for no reason.

Replace the burst with a lookahead scheduler that keeps at most `PREVIEW_LOOKAHEAD_SEC` of chords scheduled ahead of `ctx.currentTime`, driven off the shared 16th-note clock (the same 25 ms lookahead timer the transport already uses). The scheduling decision is pure arithmetic and is extracted and TDD'd; the clock source is injected so a test can drive it synchronously and never sleep.

Subscribing the shared clock starts the 25 ms interval if it is not already running (`ensureClockRunning`), and the disposer stops it again when the last listener leaves and the metronome is off. It does **not** touch `clockStepIndex` or `clockNextStepTime` — only `resetClock()` does, and this never calls it — so an audition cannot move the transport grid.

**Files:**
- Modify: `src/audio/playback/presetPreview.ts:46-68` (`previewChordProgression`)
- Test: `src/audio/playback/presetPreview.test.ts` (append two describes)

**Interfaces:**
- Consumes: `audioEngine.subscribeClock`, `audioEngine.getAudioContext`, `audioEngine.triggerSynthNoteOn/Off`, `audioEngine.stopSource` (all already used by this module).
- Produces (from `src/audio/playback/presetPreview.ts`):
  - `PREVIEW_CHORD_DURATION = 0.5` (number, seconds — the value the old code inlined)
  - `PREVIEW_LOOKAHEAD_SEC = 1.5` (number)
  - `chordsDueBy(chordCount: number, startTime: number, chordDuration: number, nextIndex: number, horizon: number): number` — exclusive end index: the first index whose start time is past `horizon`, clamped to `chordCount` and never below `nextIndex`.
  - `interface PreviewScheduler { now(): number; subscribe(tick: () => void): () => void }`
  - `previewChordProgression(chords: ChordItem[], params: SynthParams, scheduler?: PreviewScheduler): PreviewHandle` — third parameter is optional and defaults to the live clock, so the single call site (`src/components/loop/ChordPresetLibrary.tsx:170`) is unchanged.

- [ ] **Step 1: Write the failing `chordsDueBy` tests**

Append to `src/audio/playback/presetPreview.test.ts`:

```ts
import {
  PREVIEW_CHORD_DURATION,
  PREVIEW_LOOKAHEAD_SEC,
  chordsDueBy,
  previewChordProgression as previewProgression,
  type PreviewScheduler,
} from './presetPreview';

describe('chordsDueBy', () => {
  test('schedules only the chords whose start time is inside the horizon', () => {
    // start 10, 0.5 s per chord -> chord i starts at 10 + i*0.5
    expect(chordsDueBy(16, 10, 0.5, 0, 11.5)).toBe(4); // chords 0..3 start at 10, 10.5, 11, 11.5
  });

  test('an exact boundary start time is included', () => {
    expect(chordsDueBy(16, 10, 0.5, 0, 10)).toBe(1);
  });

  test('it never returns less than nextIndex', () => {
    expect(chordsDueBy(16, 10, 0.5, 6, 10)).toBe(6);
  });

  test('it clamps to the chord count', () => {
    expect(chordsDueBy(4, 10, 0.5, 0, 1000)).toBe(4);
  });

  test('an empty progression is a no-op', () => {
    expect(chordsDueBy(0, 10, 0.5, 0, 1000)).toBe(0);
  });

  test('the shipped lookahead keeps three chords in flight at the shipped duration', () => {
    expect(chordsDueBy(16, 0, PREVIEW_CHORD_DURATION, 0, PREVIEW_LOOKAHEAD_SEC)).toBe(4);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/audio/playback/presetPreview.test.ts -t "chordsDueBy"`
Expected: FAIL — `chordsDueBy` is not exported.

- [ ] **Step 3: Write the failing streaming tests**

Append to `src/audio/playback/presetPreview.test.ts`:

```ts
/** A scheduler a test drives by hand: no timers, no clock, no sleeping. */
function fakeScheduler(startNow: number) {
  const ticks = new Set<() => void>();
  const state = {
    now: startNow,
    subscribed: 0,
    unsubscribed: 0,
    advanceTo(t: number) {
      state.now = t;
      for (const tick of Array.from(ticks)) tick();
    },
  };
  const scheduler: PreviewScheduler = {
    now: () => state.now,
    subscribe: (tick) => {
      state.subscribed++;
      ticks.add(tick);
      return () => {
        state.unsubscribed++;
        ticks.delete(tick);
      };
    },
  };
  return { scheduler, state };
}

const sixteenChords: ChordItem[] = Array.from({ length: 16 }, (_, i) => ({
  id: `c${i}`,
  root: 'C',
  quality: 'maj',
  bars: 1,
  notes: ['C4', 'E4', 'G4', 'B4'],
}));

describe('progression audition streams instead of bursting', () => {
  test('the click handler schedules only the lookahead window, not all 16 chords', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);

      const voices = (audioEngine as any).sourceVoices.get('preview') as Set<unknown>;
      // 4 chords inside the 1.5 s horizon x 4 notes = 16 voices, not 64.
      expect(voices.size).toBe(16);
    } finally {
      restore();
    }
  });

  test('advancing the clock schedules the next chords and nothing earlier twice', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);

      const voices = (audioEngine as any).sourceVoices.get('preview') as Set<{ noteName: string }>;
      const afterFirst = voices.size;

      state.advanceTo(11.0); // horizon 12.5 -> chords 0..5 due, 4 already done
      expect(voices.size).toBe(afterFirst + 8);

      state.advanceTo(11.0); // same time again: nothing new
      expect(voices.size).toBe(afterFirst + 8);
    } finally {
      restore();
    }
  });

  test('the whole progression is eventually scheduled, in order', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);
      state.advanceTo(20);

      const voices = Array.from(
        (audioEngine as any).sourceVoices.get('preview') as Set<{ startTime: number }>,
      );
      expect(voices.length).toBe(64);
      const starts = Array.from(new Set(voices.map((v) => v.startTime))).sort((a, b) => a - b);
      expect(starts).toEqual(sixteenChords.map((_, i) => 10 + i * PREVIEW_CHORD_DURATION));
    } finally {
      restore();
    }
  });

  test('the subscription is dropped once the last chord is scheduled', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, scheduler);
      expect(state.subscribed).toBe(1);
      expect(state.unsubscribed).toBe(0);

      state.advanceTo(20);
      expect(state.unsubscribed).toBe(1);
    } finally {
      restore();
    }
  });

  test('the disposer stops the stream and silences what is already scheduled', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      const handle = previewProgression(sixteenChords, SYNTH, scheduler);

      handle();
      expect(state.unsubscribed).toBe(1);

      const before = ((audioEngine as any).sourceVoices.get('preview') as Set<unknown>).size;
      state.advanceTo(20);
      // No further chords are scheduled after disposal.
      expect(((audioEngine as any).sourceVoices.get('preview') as Set<unknown>).size)
        .toBeLessThanOrEqual(before);
    } finally {
      restore();
    }
  });

  test('a superseded audition stops streaming when a newer one starts', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const a = fakeScheduler(10);
      const b = fakeScheduler(10);
      previewProgression(sixteenChords, SYNTH, a.scheduler);
      previewProgression(sixteenChords, SYNTH, b.scheduler);

      expect(a.state.unsubscribed).toBe(1);
    } finally {
      restore();
    }
  });

  test('a short progression that fits inside the horizon never subscribes', () => {
    const { restore } = withFakeAudioEngine();
    try {
      const { scheduler, state } = fakeScheduler(10);
      previewProgression(sixteenChords.slice(0, 2), SYNTH, scheduler);
      expect(state.subscribed).toBe(0);
    } finally {
      restore();
    }
  });
});
```

Note: `withFakeAudioEngine`, `SYNTH` and the `ChordItem` import already exist at the top of this file — reuse them, do not redeclare.

- [ ] **Step 4: Run, confirm fail**

Run: `bun test src/audio/playback/presetPreview.test.ts`
Expected: FAIL — `previewChordProgression` takes two arguments and bursts all 64 voices; the first test asserts 16.

- [ ] **Step 5: Rewrite `previewChordProgression`**

Replace lines 46-68 of `src/audio/playback/presetPreview.ts` with:

```ts
/** Seconds each chord holds in an audition — the strum's step. */
export const PREVIEW_CHORD_DURATION = 0.5;

/**
 * How far ahead of the audio clock chords are allowed to be scheduled.
 *
 * 1.5 s is three chords at PREVIEW_CHORD_DURATION: comfortably more than the
 * 25 ms clock tick needs to stay ahead of the playhead, and far short of the
 * 8 s a 16-chord progression used to reserve in one burst.
 */
export const PREVIEW_LOOKAHEAD_SEC = 1.5;

/**
 * Exclusive end index of the chords whose start time is at or before
 * `horizon`, given `startTime` for chord 0 and `chordDuration` per chord.
 *
 * Pure so the streaming policy is testable without an AudioContext or a timer.
 */
export function chordsDueBy(
  chordCount: number,
  startTime: number,
  chordDuration: number,
  nextIndex: number,
  horizon: number,
): number {
  if (chordDuration <= 0) return chordCount;
  const due = Math.floor((horizon - startTime) / chordDuration) + 1;
  return Math.min(chordCount, Math.max(nextIndex, due));
}

/**
 * Clock source for a streaming audition. Injected so tests drive it
 * synchronously instead of sleeping; production passes the shared 16th-note
 * clock, which already runs a 25 ms lookahead timer.
 */
export interface PreviewScheduler {
  now(): number;
  subscribe(tick: () => void): () => void;
}

function liveScheduler(ctx: AudioContext): PreviewScheduler {
  return {
    now: () => ctx.currentTime,
    // subscribeClock starts the shared 25 ms timer if it is not already
    // running and stops it again when the last listener leaves. It never
    // touches clockStepIndex/clockNextStepTime — only resetClock() does, and
    // nothing here calls it — so an audition cannot move the transport grid.
    subscribe: (tick) => audioEngine.subscribeClock(() => tick()),
  };
}

/**
 * Chord progression audition: a quick strum through every chord in sequence.
 *
 * STREAMED, not burst. Scheduling all 16 chords in the click handler was 64
 * triggerSynthNoteOn calls creating ~384 nodes and 64 pending teardown timers
 * in one synchronous go — a visible frame hitch, with the tail of the
 * progression reserved up to 8 s ahead of the clock for no benefit. This keeps
 * PREVIEW_LOOKAHEAD_SEC of chords in flight and schedules the rest as the
 * clock advances.
 *
 * Scheduled on the AUDIO clock rather than with setTimeout at wall-clock
 * offsets, and returns a disposer — previously, leaving the panel mid-audition
 * left every remaining chord queued with no way to cancel it. The disposer now
 * also drops the clock subscription, so an abandoned audition stops generating
 * work as well as stopping sound.
 */
export function previewChordProgression(
  chords: ChordItem[],
  params: SynthParams,
  scheduler?: PreviewScheduler,
): PreviewHandle {
  audioEngine.init();
  const ctx = audioEngine.getAudioContext();
  if (!ctx) return NOOP;

  const clock = scheduler ?? liveScheduler(ctx);
  const startTime = clock.now();
  const stop = beginPreview();

  let nextIndex = 0;
  let unsubscribe: (() => void) | null = null;

  const scheduleDue = () => {
    const end = chordsDueBy(
      chords.length,
      startTime,
      PREVIEW_CHORD_DURATION,
      nextIndex,
      clock.now() + PREVIEW_LOOKAHEAD_SEC,
    );
    for (; nextIndex < end; nextIndex++) {
      const start = startTime + nextIndex * PREVIEW_CHORD_DURATION;
      for (const n of chords[nextIndex].notes) {
        audioEngine.triggerSynthNoteOn(n, params, 0.75, start, PREVIEW_SOURCE);
        audioEngine.triggerSynthNoteOff(
          n,
          0.3,
          start + PREVIEW_CHORD_DURATION * 0.85,
          PREVIEW_SOURCE,
        );
      }
    }
    if (nextIndex >= chords.length && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  scheduleDue();
  if (nextIndex < chords.length) {
    unsubscribe = clock.subscribe(scheduleDue);
    // A progression whose whole length fit inside the first window never
    // subscribes at all, so the common 4-chord case costs exactly what it did
    // before this change.
  }

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    stop();
  };
}
```

- [ ] **Step 6: Make `beginPreview` cancel the previous audition's stream**

A superseded handle is already a no-op for *sound*, but its clock subscription would keep scheduling chords into the shared preview bus. Replace `beginPreview` (lines 37-44) with:

```ts
let currentGeneration = 0;
let cancelCurrentStream: (() => void) | null = null;

/**
 * `onSupersede` is called when a NEWER preview starts. previewChordProgression
 * passes its unsubscribe here: a superseded audition must stop generating
 * work, not merely stop being able to cut sound.
 */
function beginPreview(onSupersede?: () => void): PreviewHandle {
  currentGeneration += 1;
  const generation = currentGeneration;
  cancelCurrentStream?.();
  cancelCurrentStream = onSupersede ?? null;
  stopAllPreviews();
  return () => {
    if (generation === currentGeneration) {
      cancelCurrentStream?.();
      cancelCurrentStream = null;
      stopAllPreviews();
    }
  };
}
```

and in `previewChordProgression` change `const stop = beginPreview();` to:

```ts
  const stop = beginPreview(() => {
    unsubscribe?.();
    unsubscribe = null;
  });
```

moving the `let unsubscribe` declaration above it.

- [ ] **Step 7: Run the preview suite**

Run: `bun test src/audio/playback/presetPreview.test.ts`
Expected: PASS — the four pre-existing "preview handle lifetimes" tests plus the six `chordsDueBy` and seven streaming tests.

- [ ] **Step 8: Type-check, lint, full audio suite**

Run: `bun run lint && bun run eslint && bun test src/audio`
Expected: all clean. `src/components/loop/ChordPresetLibrary.tsx:170` still compiles — the third parameter is optional.

- [ ] **Step 9: Manual check**

Run `bun run dev`, open the Chords tab, open the chord Preset Library and audition a long progression (any 8-bar entry). The strum must sound identical to before: same tempo, same order, no gap and no dropped chord at the boundary between lookahead windows. Close the drawer mid-audition — sound stops immediately and no further chords sound.

- [ ] **Step 10: Commit**

```bash
git add src/audio/playback/presetPreview.ts src/audio/playback/presetPreview.test.ts
git commit -m "perf(audio): stream progression auditions off the clock instead of bursting

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 28: Throttle the visualizer after silent frames

`AudioVisualizer`'s rAF loop is gated on `paused` (tab visibility) but not on whether anything is sounding, so a visible Master FX or Synth tab draws a full canvas at 60 fps into silence for as long as the app is open. The loop already computes `isSounding` every frame at lines 216-238 — the information is there, it is just not used to skip work.

Throttle to ~10 fps after N consecutive silent frames, and snap back to full rate on the first non-silent frame. The analyser reads stay every-frame (two `getByte*` calls into pre-allocated buffers — that is the cheap part, and it is what detects the return of sound); only the canvas drawing is skipped.

**This file is one of the three deliberate `no-restricted-imports` exemptions** (`eslint.config.js:63-70`) that import `audio/engine` directly, alongside `ui/VuMeter.tsx` and `ui/AmbientBackdrop.tsx`. That is by design — routing per-frame analyser reads through the store would mean a store write on every animation frame and a re-render of every subscriber. Do not "fix" it.

**Files:**
- Modify: `src/components/AudioVisualizer.tsx:180-192` (move the `clearRect` below the throttle gate), `:239-257` (insert the gate)
- Create: `src/components/AudioVisualizer.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces (exported from `src/components/AudioVisualizer.tsx`, alongside the existing `VISUALIZER_MODES` / `VISUALIZER_MODE_LABEL`):
  - `SILENT_FRAMES_BEFORE_THROTTLE = 90` (number)
  - `THROTTLED_FRAME_INTERVAL_MS = 100` (number)
  - `interface SilenceThrottle { silentFrames: number; lastDrawAtMs: number }`
  - `initialSilenceThrottle(): SilenceThrottle`
  - `nextSilenceThrottle(state: SilenceThrottle, isSounding: boolean, nowMs: number): { state: SilenceThrottle; shouldDraw: boolean }`

- [ ] **Step 1: Write the failing state-machine tests**

Create `src/components/AudioVisualizer.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import {
  SILENT_FRAMES_BEFORE_THROTTLE,
  THROTTLED_FRAME_INTERVAL_MS,
  initialSilenceThrottle,
  nextSilenceThrottle,
  VISUALIZER_MODES,
} from './AudioVisualizer';

/** Drives N frames at 60 fps and returns how many of them drew. */
function runFrames(count: number, isSounding: (frame: number) => boolean) {
  let state = initialSilenceThrottle();
  let drawn = 0;
  for (let frame = 0; frame < count; frame++) {
    const out = nextSilenceThrottle(state, isSounding(frame), frame * (1000 / 60));
    state = out.state;
    if (out.shouldDraw) drawn++;
  }
  return { drawn, state };
}

describe('visualizer silence throttle', () => {
  test('every frame draws while audio is sounding', () => {
    expect(runFrames(300, () => true).drawn).toBe(300);
  });

  test('the first N silent frames still draw at full rate', () => {
    // The tail of a note must not stutter, so the throttle only engages after
    // a run of genuinely silent frames.
    expect(runFrames(SILENT_FRAMES_BEFORE_THROTTLE, () => false).drawn)
      .toBe(SILENT_FRAMES_BEFORE_THROTTLE);
  });

  test('past the threshold it settles to the throttled interval', () => {
    // 600 frames at 60 fps = 10 s. The first 90 draw at full rate; the
    // remaining 510 span ~8.5 s and draw at most once per 100 ms, so the
    // total lands around 175 rather than 600.
    const { drawn } = runFrames(600, () => false);
    expect(drawn).toBeGreaterThan(SILENT_FRAMES_BEFORE_THROTTLE);
    expect(drawn).toBeLessThanOrEqual(
      SILENT_FRAMES_BEFORE_THROTTLE + Math.ceil(8500 / THROTTLED_FRAME_INTERVAL_MS) + 1,
    );
    // The whole point: fewer than a third of the frames drew.
    expect(drawn).toBeLessThan(200);
  });

  test('a single sounding frame snaps straight back to full rate', () => {
    let state = initialSilenceThrottle();
    for (let frame = 0; frame < 300; frame++) {
      state = nextSilenceThrottle(state, false, frame * 16.67).state;
    }
    expect(state.silentFrames).toBeGreaterThanOrEqual(SILENT_FRAMES_BEFORE_THROTTLE);

    const wake = nextSilenceThrottle(state, true, 300 * 16.67);
    expect(wake.shouldDraw).toBe(true);
    expect(wake.state.silentFrames).toBe(0);
    // and the very next frame, 16 ms later, draws too — no throttle residue.
    expect(nextSilenceThrottle(wake.state, true, 301 * 16.67).shouldDraw).toBe(true);
  });

  test('the counter resets on sound and re-arms from zero afterwards', () => {
    let state = initialSilenceThrottle();
    for (let frame = 0; frame < 200; frame++) {
      const sounding = frame === 100;
      state = nextSilenceThrottle(state, sounding, frame * 16.67).state;
    }
    expect(state.silentFrames).toBe(99);
  });

  test('a throttled frame that draws records its timestamp', () => {
    let state = initialSilenceThrottle();
    for (let frame = 0; frame < SILENT_FRAMES_BEFORE_THROTTLE + 1; frame++) {
      state = nextSilenceThrottle(state, false, frame * 16.67).state;
    }
    const before = state.lastDrawAtMs;
    const skipped = nextSilenceThrottle(state, false, before + 10);
    expect(skipped.shouldDraw).toBe(false);
    expect(skipped.state.lastDrawAtMs).toBe(before);

    const due = nextSilenceThrottle(skipped.state, false, before + THROTTLED_FRAME_INTERVAL_MS);
    expect(due.shouldDraw).toBe(true);
    expect(due.state.lastDrawAtMs).toBe(before + THROTTLED_FRAME_INTERVAL_MS);
  });

  test('the mode table is untouched by this change', () => {
    expect(VISUALIZER_MODES).toEqual(['wave', 'bars', 'oscilloscope']);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/components/AudioVisualizer.test.tsx`
Expected: FAIL — `initialSilenceThrottle` is not exported.

- [ ] **Step 3: Add the state machine**

In `src/components/AudioVisualizer.tsx`, insert after the `VISUALIZER_MODES` export (line 32):

```tsx
/**
 * Consecutive silent frames before the render loop drops to a low rate.
 *
 * 90 frames is 1.5 s at 60 fps: past the tail of any release this app can
 * produce, so a decaying note never stutters, but short enough that an idle
 * tab stops burning a full canvas repaint within two seconds.
 */
export const SILENT_FRAMES_BEFORE_THROTTLE = 90;

/** ~10 fps while silent — enough for the idle trace to look alive. */
export const THROTTLED_FRAME_INTERVAL_MS = 100;

export interface SilenceThrottle {
  silentFrames: number;
  lastDrawAtMs: number;
}

export function initialSilenceThrottle(): SilenceThrottle {
  return { silentFrames: 0, lastDrawAtMs: Number.NEGATIVE_INFINITY };
}

/**
 * Whether this frame should draw, and the next state.
 *
 * The rAF loop is gated on `paused` (tab visibility) but was never gated on
 * whether anything is SOUNDING, so a visible tab repainted a full canvas at
 * 60 fps into silence for the whole session. The analyser reads stay
 * every-frame — they are two getByte* calls into pre-allocated buffers, and
 * they are what detects the return of sound; only the draw is skipped.
 *
 * Pure, and exported, so the state machine is testable without a canvas, a
 * DOM or a real animation frame (this repo has no testing-library setup).
 */
export function nextSilenceThrottle(
  state: SilenceThrottle,
  isSounding: boolean,
  nowMs: number,
): { state: SilenceThrottle; shouldDraw: boolean } {
  if (isSounding) {
    // Snap back instantly: one sounding frame is enough, so the first sample
    // of a new note is drawn on the frame it arrives.
    return { state: { silentFrames: 0, lastDrawAtMs: nowMs }, shouldDraw: true };
  }
  const silentFrames = state.silentFrames + 1;
  if (silentFrames <= SILENT_FRAMES_BEFORE_THROTTLE) {
    return { state: { silentFrames, lastDrawAtMs: nowMs }, shouldDraw: true };
  }
  if (nowMs - state.lastDrawAtMs >= THROTTLED_FRAME_INTERVAL_MS) {
    return { state: { silentFrames, lastDrawAtMs: nowMs }, shouldDraw: true };
  }
  return { state: { silentFrames, lastDrawAtMs: state.lastDrawAtMs }, shouldDraw: false };
}
```

- [ ] **Step 4: Run the state-machine tests**

Run: `bun test src/components/AudioVisualizer.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire the gate into the render loop**

Three edits inside the component, all in the `useEffect` that owns the loop.

(a) Add the throttle ref next to the other per-frame refs, after `prevDataRef` (line 113):

```tsx
  // Silence throttle state, in a ref: it is per-frame bookkeeping, so a
  // useState here would re-render the component 60 times a second — the same
  // reason indicatorRef exists.
  const throttleRef = useRef<SilenceThrottle>(initialSilenceThrottle());
```

(b) Move the unconditional `ctx.clearRect(0, 0, width, height);` out of line 180. Delete it there and put a copy inside the `!analyser` placeholder branch, so that branch still clears before drawing its idle line:

```tsx
      if (!analyser) {
        // Idle placeholder line
        ctx.clearRect(0, 0, width, height);
        ctx.beginPath();
```

(c) After the `isSounding` block and the indicator update (i.e. immediately after line 245, before the `if (mode === 'bars')` dispatch), insert:

```tsx
      // Nothing is sounding and nothing has been for SILENT_FRAMES_BEFORE_
      // THROTTLE frames: keep reading the analyser (that is how sound is
      // detected) but stop repainting the canvas every frame. The canvas is
      // NOT cleared on a skipped frame, so the last drawn image simply stays.
      const throttle = nextSilenceThrottle(
        throttleRef.current,
        isSounding,
        performance.now(),
      );
      throttleRef.current = throttle.state;
      if (!throttle.shouldDraw) {
        animationId = requestAnimationFrame(render);
        return;
      }

      ctx.clearRect(0, 0, width, height);

      if (mode === 'bars') {
```

(d) Reset the throttle whenever the effect re-runs, so a mode or theme switch repaints immediately. Add immediately before the existing `animationId = requestAnimationFrame(render);` at line 614:

```tsx
    throttleRef.current = initialSilenceThrottle();
    animationId = requestAnimationFrame(render);
```

- [ ] **Step 6: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: clean. `AudioVisualizer.tsx` is already exempt from layering rule 3 in `eslint.config.js`; nothing about its import list changes.

- [ ] **Step 7: Theme guard**

Run: `bun run check:theme`
Expected: PASS. No class strings were added or changed by this task.

- [ ] **Step 8: Manual check**

Run `bun run dev`. On the Master FX tab with nothing playing, open DevTools Performance and record 10 s: after ~1.5 s the scripting bars must drop to a sparse ~10/s pattern instead of a solid 60/s band. Press a key on the QWERTY keyboard — the trace must respond on the same frame, with no visible lag or first-frame stutter. Repeat in `bars` and `oscilloscope` modes and on the Synth tab's inline scope.

- [ ] **Step 9: Commit**

```bash
git add src/components/AudioVisualizer.tsx src/components/AudioVisualizer.test.tsx
git commit -m "perf(ui): throttle the visualizer canvas after a run of silent frames

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 29: Suspend the AudioContext when idle, and key voice teardown off the audio clock

Two related lifecycle defects in one task, because the fix for the first makes the second reachable.

1. **Nothing ever suspends the `AudioContext`.** `init()` (`engine.ts:194-210` pre-branch; roughly `:216-232` after Tasks 2/3/26) creates it on the first user gesture and resumes it if suspended; `grep -rn "suspend\|\.close()" src/` finds no other call. The master chain — two `DynamicsCompressor`, three biquads, a `WaveShaper` at `oversample: '4x'`, a `Convolver` with up to a 10 s impulse, a `Delay` with a feedback loop and an `Analyser` — stays live for the whole session, keeping the render thread and the device's audio hardware awake for hours after the user stops playing.

2. **Voice teardown runs on the wall clock while envelopes run on the audio clock.** `engine.ts:852` (pre-branch; roughly `:925` after Tasks 2/3/25) arms `setTimeout(teardownDelayMs)` from audio-clock arithmetic. When the context is suspended (backgrounded tab today, *and idle-suspended after this task*), `currentTime` freezes while the timer keeps counting in real time, so teardown fires before the release ramp has run and the note is simply gone on resume.

**This is the riskiest task in Phase 5.** The suspend predicate is pure and TDD'd; the resume path is eager (on `pointerdown`/`keydown`, not on the note-on) so the next note is never late.

**Rollback:** this task is a single commit and touches nothing else. To roll it back, `git revert <sha>` — the four new engine members (`idleTimer`, `suspendedForIdle`, `wakeIfIdle`, `rearmVoiceTeardowns`), `src/audio/idleSuspend.ts`, and the `registerIdleWake` listener in `App.tsx` are all additive, and `voice.teardownAt` is only read by `rearmVoiceTeardowns`. If only the *suspend* half misbehaves in the wild, the narrower rollback is to set `IDLE_SUSPEND_MS = Number.POSITIVE_INFINITY` in `src/audio/idleSuspend.ts`, which disarms the timer and leaves the teardown re-arm (a strict improvement) in place.

**Files:**
- Create: `src/audio/idleSuspend.ts`
- Create: `src/audio/idleSuspend.test.ts`
- Modify: `src/audio/engine.ts:66` (add `teardownAt` to `SynthVoice`, whose real span is `:14-67`, **not** `:44-78`), `:194-210` (`init`), `:218-240` (`setMetronomeEnabled` / `subscribeClock` mark activity), `:576` (`triggerSynthNoteOn` marks activity), `:844-862` (`releaseVoice`'s `finally` records `teardownAt`), `:1345` (`triggerDrum` marks activity). **All pre-branch** — see the anchor-first rule in Task 3; after Tasks 2/3/25/26 these sit near `:67`, `:216-232`, `:240-262`, `:600`, `:917-935` and `:1418`.
- Modify: `src/App.tsx:27` (`FIRST_GESTURE_EVENTS`), `:79-87` (the first-gesture effect)
- Test: `src/audio/engine.test.ts` (append one describe), `src/App.test.tsx` (append one describe)

**Interfaces:**
- Consumes: **Task 2's max-lifetime backstop** — complementary, not alternative: Task 2 is a WALL-clock ceiling on a voice that never got a note-off; this task re-derives the AUDIO-clock teardown of a voice that did. They are causally linked, because `shouldSuspendWhenIdle` refuses to suspend while `liveVoiceCount > 0` — without Task 2 a single leaked voice would disable idle suspend for the whole session. **Task 3's** voice cap is independent but bounds `liveVoiceCount()` per source. **Task 26** contributes line drift and one anchor change (the `impulseCache` block is now two fields). **Task 16** contributes no drift here — every anchor in this task is above `:1500`.
- Produces (from `src/audio/idleSuspend.ts`):
  - `IDLE_SUSPEND_MS = 30_000` (number)
  - `interface IdleSnapshot { clockListenerCount: number; metronomeEnabled: boolean; liveVoiceCount: number; contextState: AudioContextState }`
  - `shouldSuspendWhenIdle(snapshot: IdleSnapshot): boolean`
- Produces (on `audioEngine`):
  - `wakeIfIdle(): void` — cancels a pending idle suspend, resumes the context if this engine suspended it, and re-arms every pending voice teardown against the audio clock. Safe to call before `init()` and safe to call on every pointer event.
- Produces (from `src/App.tsx`):
  - `registerIdleWake(target: GestureEventTarget, onWake: () => void): () => void` — persistent (not one-shot) `pointerdown` + `keydown` listener registration, DOM-injectable for the test, mirroring `registerFirstGesture`.

- [ ] **Step 1: Write the failing suspend-predicate tests**

Create `src/audio/idleSuspend.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { IDLE_SUSPEND_MS, shouldSuspendWhenIdle } from './idleSuspend';

const idle = {
  clockListenerCount: 0,
  metronomeEnabled: false,
  liveVoiceCount: 0,
  contextState: 'running' as AudioContextState,
};

describe('shouldSuspendWhenIdle', () => {
  test('a genuinely idle running context may suspend', () => {
    expect(shouldSuspendWhenIdle(idle)).toBe(true);
  });

  test('never while a player holds the clock', () => {
    expect(shouldSuspendWhenIdle({ ...idle, clockListenerCount: 1 })).toBe(false);
  });

  test('never while the metronome is on', () => {
    expect(shouldSuspendWhenIdle({ ...idle, metronomeEnabled: true })).toBe(false);
  });

  test('never while any voice is live or still releasing', () => {
    expect(shouldSuspendWhenIdle({ ...idle, liveVoiceCount: 1 })).toBe(false);
  });

  test('never when the context is not running', () => {
    expect(shouldSuspendWhenIdle({ ...idle, contextState: 'suspended' })).toBe(false);
    expect(shouldSuspendWhenIdle({ ...idle, contextState: 'closed' })).toBe(false);
  });

  test('a held QWERTY note blocks suspend even with no player running', () => {
    // The exact regression this guards: hold a key for 30 s with the transport
    // stopped, and the sustained note must not be cut by the idle timer.
    expect(shouldSuspendWhenIdle({ ...idle, liveVoiceCount: 1, clockListenerCount: 0 })).toBe(false);
  });

  test('the idle window is long enough not to fire between two takes', () => {
    expect(IDLE_SUSPEND_MS).toBeGreaterThanOrEqual(30_000);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `bun test src/audio/idleSuspend.test.ts`
Expected: FAIL — module `./idleSuspend` does not exist.

- [ ] **Step 3: Write `idleSuspend.ts`**

Create `src/audio/idleSuspend.ts`:

```ts
/**
 * When the AudioContext may be suspended, as a pure predicate.
 *
 * Nothing in this app ever suspended the context: init() created it on the
 * first user gesture and only ever resumed it, so the whole master chain (two
 * compressors, three biquads, a 4x-oversampled WaveShaper, a Convolver with up
 * to a 10 s impulse, a Delay with a feedback loop and an Analyser) was pulled
 * for the entire session. Blink short-circuits silent nodes, so this is
 * battery and thermal cost rather than a glitch risk — but the render thread
 * stays awake at the hardware callback rate for hours.
 *
 * Pure and separate from engine.ts so every "must never suspend during X" case
 * is provable without an AudioContext.
 */

/**
 * Idle time before the context is suspended.
 *
 * 30 s: long enough that it never fires between two takes or while the user is
 * reading the UI, short enough to stop draining a laptop left on a tab.
 */
export const IDLE_SUSPEND_MS = 30_000;

export interface IdleSnapshot {
  /** How many listeners hold the shared 16th clock. Any player running is >= 1. */
  clockListenerCount: number;
  metronomeEnabled: boolean;
  /** Every voice still live OR still releasing, across all sources. */
  liveVoiceCount: number;
  contextState: AudioContextState;
}

export function shouldSuspendWhenIdle(snapshot: IdleSnapshot): boolean {
  if (snapshot.contextState !== 'running') return false;
  if (snapshot.clockListenerCount > 0) return false;
  if (snapshot.metronomeEnabled) return false;
  // A held QWERTY note is a live voice with no clock listener and no player —
  // suspending here would cut a sustained note the user is still holding.
  if (snapshot.liveVoiceCount > 0) return false;
  return true;
}
```

- [ ] **Step 4: Run the predicate tests**

Run: `bun test src/audio/idleSuspend.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing engine tests**

Append to `src/audio/engine.test.ts`:

```ts
describe('idle suspend and audio-clock teardown', () => {
  /** freshEngine's fake context has no state/suspend — add the two this needs. */
  function suspendableEngine() {
    const { engine, ctx } = freshEngine();
    const c = ctx as any;
    c.state = 'running';
    c.suspendCalls = 0;
    c.resumeCalls = 0;
    c.suspend = async () => {
      c.suspendCalls++;
      c.state = 'suspended';
    };
    c.resume = async () => {
      c.resumeCalls++;
      c.state = 'running';
    };
    return { engine, ctx: c };
  }

  test('an idle engine suspends when its idle timer fires', () => {
    const { engine, ctx } = suspendableEngine();
    (engine as any).maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(1);
  });

  test('a live voice blocks the suspend', () => {
    const { engine, ctx } = suspendableEngine();
    (engine as any).triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    (engine as any).maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(0);
  });

  test('a clock listener blocks the suspend', () => {
    const { engine, ctx } = suspendableEngine();
    const unsubscribe = engine.subscribeClock(() => {});
    (engine as any).maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(0);
    unsubscribe();
  });

  test('an enabled metronome blocks the suspend', () => {
    const { engine, ctx } = suspendableEngine();
    engine.setMetronomeEnabled(true);
    (engine as any).maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(0);
    engine.setMetronomeEnabled(false);
  });

  test('wakeIfIdle resumes a context this engine suspended', () => {
    const { engine, ctx } = suspendableEngine();
    (engine as any).maybeSuspendNow();
    expect(ctx.state).toBe('suspended');

    engine.wakeIfIdle();
    expect(ctx.resumeCalls).toBe(1);
  });

  test('wakeIfIdle on a running context is a no-op and never throws', () => {
    const { engine, ctx } = suspendableEngine();
    engine.wakeIfIdle();
    engine.wakeIfIdle();
    expect(ctx.resumeCalls).toBe(0);
  });

  test('wakeIfIdle before init never throws', () => {
    const engine = makeEngine();
    expect(() => engine.wakeIfIdle()).not.toThrow();
  });

  test('a released voice records its teardown time on the AUDIO clock', () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    e.triggerSynthNoteOff('C4', 0.5, ctx.currentTime, 'synth');

    const voice = e.activeVoices.get('synth:C4');
    // max(release 0.5, filterRelease 0.5) + 0.1 grace
    expect(voice.teardownAt).toBeCloseTo(ctx.currentTime + 0.6, 5);
  });

  test('resuming re-arms a pending teardown against the frozen audio clock', () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    e.triggerSynthNoteOff('C4', 0.5, ctx.currentTime, 'synth');
    const voice = e.activeVoices.get('synth:C4');
    const firstTimer = voice.teardownTimer;

    // Suspend, let 10 s of WALL time pass while currentTime stays frozen, wake.
    e.maybeSuspendNow();
    engine.wakeIfIdle();

    // The timer was replaced, and the voice is still tracked — the old wall
    // clock timer would have torn it down 10 s into a 0.6 s release.
    expect(voice.teardownTimer).not.toBe(firstTimer);
    expect(e.activeVoices.get('synth:C4')).toBe(voice);
    clearTimeout(voice.teardownTimer);
  });
});
```

- [ ] **Step 6: Run, confirm fail**

Run: `bun test src/audio/engine.test.ts -t "idle suspend"`
Expected: FAIL — `maybeSuspendNow` / `wakeIfIdle` / `voice.teardownAt` do not exist.

- [ ] **Step 7: Implement the engine side**

In `src/audio/engine.ts`:

Add to the imports at the top:

```ts
import { IDLE_SUSPEND_MS, shouldSuspendWhenIdle } from './idleSuspend';
```

Add to the `SynthVoice` interface, next to `teardownTimer` (line 66 pre-branch, `:67` after Task 2 — Task 2's `lifetimeGuardTimer` now sits between them):

```ts
  /**
   * AUDIO-clock time this voice's nodes should be torn down.
   *
   * teardownTimer is a wall-clock setTimeout while the envelope it waits on
   * runs on the audio clock. When the context is suspended, currentTime
   * freezes and the timer keeps counting, so teardown fires before the release
   * ramp has run and the note is gone on resume. rearmVoiceTeardowns() uses
   * this to re-derive the delay from the audio clock after a resume.
   */
  teardownAt?: number;
```

Add these private members next to `impulseCache`:

```ts
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * True only when THIS engine called suspend(). A context the BROWSER
   * suspended (backgrounded tab) is resumed by init()'s existing resume path,
   * and must not be resumed by a stray pointer event that only wakes idle
   * suspends.
   */
  private suspendedForIdle = false;
```

Add these methods (place them directly after `resetClock` — pre-branch `:258-261`, roughly `:281-284` after Tasks 2/3 — so the clock-lifecycle code sits together):

```ts
  /** Every voice still live OR still releasing, across every source. */
  private liveVoiceCount(): number {
    let count = 0;
    for (const voices of this.sourceVoices.values()) count += voices.size;
    return count;
  }

  /**
   * Restart the idle countdown. Called from every path that produces sound or
   * takes the clock — so the timer only ever reaches zero after genuinely
   * nothing has happened for IDLE_SUSPEND_MS.
   */
  private markActivity(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.ctx) return;
    this.idleTimer = setTimeout(() => this.maybeSuspendNow(), IDLE_SUSPEND_MS);
  }

  /** Suspend if and only if shouldSuspendWhenIdle agrees. */
  private maybeSuspendNow(): void {
    if (!this.ctx) return;
    const ok = shouldSuspendWhenIdle({
      clockListenerCount: this.clockListeners.size,
      metronomeEnabled: this.metronomeEnabled,
      liveVoiceCount: this.liveVoiceCount(),
      contextState: this.ctx.state,
    });
    if (!ok) {
      // Something is still running: re-arm rather than giving up for the
      // session, or a single note during the window would disable idle
      // suspend until the next init().
      this.markActivity();
      return;
    }
    this.suspendedForIdle = true;
    void Promise.resolve(this.ctx.suspend()).catch(() => {
      this.suspendedForIdle = false;
    });
  }

  /**
   * Wake from an idle suspend. Wired to pointerdown/keydown in App.tsx rather
   * than to the note-on itself: resuming a suspended context is asynchronous,
   * so doing it at note-on time would make the first note late. By the time a
   * pointer has travelled from press to a knob or a key, the context is back.
   *
   * Safe before init() and safe to call on every pointer event.
   */
  wakeIfIdle(): void {
    if (!this.ctx) return;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.suspendedForIdle) return;
    this.suspendedForIdle = false;
    void Promise.resolve(this.ctx.resume())
      .then(() => this.rearmVoiceTeardowns())
      .catch(() => { /* browser refused; init()'s resume path will retry */ });
    // Re-arm synchronously too: the fake context in tests resolves resume()
    // on a microtask, and a real one may take a frame — either way the pending
    // teardown delays are already wrong the moment the clock un-freezes.
    this.rearmVoiceTeardowns();
    this.markActivity();
  }

  /**
   * Re-derive every pending teardown delay from the audio clock.
   *
   * While the context is suspended, currentTime freezes and the wall-clock
   * teardown timers keep counting, so on resume they are due immediately and
   * a note in the middle of a 2 s release is torn down mid-ramp. Called on
   * every resume — this engine's idle wake AND init()'s existing resume path,
   * which covers a browser-initiated backgrounded-tab suspend.
   */
  private rearmVoiceTeardowns(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voices of this.sourceVoices.values()) {
      for (const voice of voices) {
        if (voice.teardownTimer === undefined || voice.teardownAt === undefined) continue;
        clearTimeout(voice.teardownTimer);
        voice.teardownTimer = setTimeout(
          () => this.finishVoiceTeardown(voice),
          Math.max(0, voice.teardownAt - now) * 1000,
        );
      }
    }
  }

  /** The body the teardown timer runs — shared by releaseVoice and the re-arm. */
  private finishVoiceTeardown(voice: SynthVoice): void {
    const voiceKey = `${voice.source}:${voice.noteName}`;
    // Only delete the map entry if this voice is still the current one — a
    // same-note retrigger overwrites the entry before this timeout fires. The
    // voice's own nodes are always torn down regardless.
    if (this.activeVoices.get(voiceKey) === voice) {
      this.activeVoices.delete(voiceKey);
    }
    this.sourceVoices.get(voice.source)?.delete(voice);
    this.teardownVoiceNodes(voice);
  }
```

Change `releaseVoice`'s `finally` block (pre-branch lines 844-862; roughly `:917-935` after Tasks 2/3/25) to record `teardownAt` and use the shared body. **Delete `const voiceKey = ...` at the top of `releaseVoice` (pre-branch `:802`) as part of this step** — its only two uses are the `activeVoices.get`/`.delete` pair inside the block you are replacing, so leaving it behind is an unused local that `bun run lint` will not catch (`tsconfig` has no `noUnusedLocals`) and that `bun run verify` does not check either, because `verify` excludes `bun run eslint`. Run `bun run eslint` before committing this task:

```ts
    } finally {
      // The old timer is cleared and the replacement is scheduled together,
      // right here, so a throw above can never leave the voice with no
      // teardown timer at all (it would otherwise stay in `activeVoices`/
      // `sourceVoices` forever and the same-note dedup at the top of
      // `triggerSynthNoteOn` would refuse to release it again).
      voice.ampReleaseAt = now;
      // Recorded on the AUDIO clock as well as armed on the wall clock:
      // rearmVoiceTeardowns() re-derives the delay from this after any resume,
      // because currentTime freezes while the context is suspended and the
      // wall-clock timer does not.
      voice.teardownAt = now + Math.max(releaseTime, filterRelease) + 0.1;
      if (voice.teardownTimer !== undefined) clearTimeout(voice.teardownTimer);
      voice.teardownTimer = setTimeout(() => this.finishVoiceTeardown(voice), teardownDelayMs);
    }
```

Mark activity at the four entry points:
- `init()` — add `this.markActivity();` as the last statement before `this.isInitialized = true;`, and add `this.rearmVoiceTeardowns();` immediately after the `await this.ctx.resume();` inside the existing `try`.
- `subscribeClock()` — add `this.markActivity();` after `this.ensureClockRunning();`, and add `this.markActivity();` inside the returned disposer after the `stopClockTimer()` branch (so the countdown starts the moment the last player leaves).
- `setMetronomeEnabled()` — add `this.markActivity();` as the last statement.
- `triggerSynthNoteOn()` — add `this.markActivity();` immediately after the `if (!this.ctx || !this.dryGain) return;` guard.
- `triggerDrum()` — same, immediately after its own context guard.

- [ ] **Step 8: Run the engine suite**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS — nine new tests plus every pre-existing one, same counts.

- [ ] **Step 9: Write the failing App wake-listener test**

Append to `src/App.test.tsx`:

```tsx
import { registerIdleWake } from './App';

describe('registerIdleWake', () => {
  function fakeTarget() {
    const listeners = new Map<string, Set<() => void>>();
    return {
      listeners,
      addEventListener: (type: string, fn: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners.get(type)?.delete(fn);
      },
      fire: (type: string) => {
        for (const fn of Array.from(listeners.get(type) ?? [])) fn();
      },
    };
  }

  test('it listens on pointerdown and keydown', () => {
    const target = fakeTarget();
    registerIdleWake(target, () => {});
    expect(Array.from(target.listeners.keys()).sort()).toEqual(['keydown', 'pointerdown']);
  });

  test('unlike registerFirstGesture it stays registered and fires every time', () => {
    const target = fakeTarget();
    let woken = 0;
    registerIdleWake(target, () => { woken++; });

    target.fire('pointerdown');
    target.fire('pointerdown');
    target.fire('keydown');
    expect(woken).toBe(3);
  });

  test('the returned cleanup removes both listeners', () => {
    const target = fakeTarget();
    let woken = 0;
    const cleanup = registerIdleWake(target, () => { woken++; });
    cleanup();

    target.fire('pointerdown');
    target.fire('keydown');
    expect(woken).toBe(0);
  });
});
```

- [ ] **Step 10: Run, confirm fail**

Run: `bun test src/App.test.tsx -t "registerIdleWake"`
Expected: FAIL — `registerIdleWake` is not exported from `./App`.

- [ ] **Step 11: Add `registerIdleWake` and wire it**

In `src/App.tsx`, add after `registerFirstGesture` (line 53):

```tsx
/** The two gestures that mean "the user is back" — a pointer press or a key. */
const IDLE_WAKE_EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * Persistent (NOT one-shot, unlike registerFirstGesture) listeners that wake
 * an idle-suspended AudioContext.
 *
 * Wired to the gesture rather than to the note-on: resuming is asynchronous,
 * so resuming at note-on time would make the first note late. A pointer press
 * happens tens of milliseconds before it reaches a key or a pad.
 *
 * DOM-injectable so it is unit-testable without a real DOM or
 * testing-library, same pattern as registerFirstGesture.
 */
export function registerIdleWake(
  target: GestureEventTarget,
  onWake: () => void,
): () => void {
  const handle = () => onWake();
  IDLE_WAKE_EVENTS.forEach((event) => target.addEventListener(event, handle));
  return () => {
    IDLE_WAKE_EVENTS.forEach((event) => target.removeEventListener(event, handle));
  };
}
```

and add a second effect next to the existing first-gesture one (after line 87):

```tsx
  // Wake an idle-suspended AudioContext on the first sign the user is back.
  useEffect(() => {
    return registerIdleWake(window, () => audioEngine.wakeIfIdle());
  }, []);
```

- [ ] **Step 12: Run the App tests and the full suite**

Run: `bun test src/App.test.tsx && bun test`
Expected: PASS throughout.

- [ ] **Step 13: Type-check, lint, theme guard**

Run: `bun run lint && bun run eslint && bun run check:theme`
Expected: all clean. `src/audio/idleSuspend.ts` imports nothing from `store/` or `components/`. `src/App.tsx` already imports `audio/engine` at line 10 and stays legal: `eslint.config.js`'s layering-rule-3 block scopes itself to `files: ['src/components/**/*.{ts,tsx}']`, and `App.tsx` is not under that path.

- [ ] **Step 14: Manual check — suspend**

Run `bun run dev`. Open DevTools → Performance monitor. Click once to init the engine, play nothing for 35 s: CPU usage must drop and the tab must stop showing the audio-thread activity. Click anywhere and play a note — it must sound with no perceptible extra latency on the first note. Repeat with a key press instead of a click.

- [ ] **Step 15: Manual check — never suspends during playback**

Start the sequencer and leave it running for 90 s untouched: playback must not stop, stutter, or drift. Stop the transport, hold a QWERTY note down for 40 s with the transport stopped: the note must still be sounding at 40 s and must release normally on key-up. Turn the metronome on with nothing else running and leave it 40 s: it must keep clicking.

- [ ] **Step 16: Manual check — backgrounded tab no longer eats notes**

Hold a long-release pad note (Pro Mode, Release ≈ 3 s), switch to another application for ~20 s, come back and press a key: the newly pressed note must sound normally. Before this task, backgrounding mid-release tore the voice down early.

- [ ] **Step 17: Commit**

```bash
git add src/audio/idleSuspend.ts src/audio/idleSuspend.test.ts src/audio/engine.ts src/audio/engine.test.ts src/App.tsx src/App.test.tsx
git commit -m "perf(audio): suspend the AudioContext when idle and re-arm voice teardown on resume

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 30: Make the existing `React.lazy()` splits real

`src/App.tsx:5` statically imports `InstantVibesBar`, which at `src/components/InstantVibesBar.tsx:3,11` statically imports `../store/instantVibes` and `../store/vibeVariation`. `instantVibes.ts:3,6-8` in turn statically imports `synthPresets`, `chordProgressions`, `vibeDrumPatterns` and `vibeEffectChains` — and its `INSTANT_VIBES` table *calls* `drumPatternById(...)`, `resolveProgression(progressionById(...))` and `requireEffectChain(...)` at module-evaluation time, so every one of those tables is pulled into the eagerly-parsed main chunk before first paint.

**Correction to the audit, verified by building `main` and grepping the chunks.** `js-perf.md` finding #2 claims this deferral would let the `SynthPresetLibrary` / `ChordPresetLibrary` `React.lazy()` boundaries "actually pay off" for `synthPresets.ts` and `chordProgressions.ts`. It will not, and the marker strings the audit grepped (`cyber-dance`, `pop-club-house`) cannot distinguish the sources because they appear in `instantVibes.ts` too. Those two tables have *independent* eager edges into always-mounted views:

- `src/components/loop/SynthView.tsx:22-31` imports `SYNTH_CATEGORIES`, `applyPreset`, `findPresetByName`, `getAllSynthPresets`, `getPresetsGroupedByCategory`, `getCategoryMeta` from `../../audio/synthPresets`.
- `src/components/loop/ChordView.tsx:52-56` imports three of the same, and `:93` imports `CHORD_PROGRESSIONS` for a count badge.
- `src/audio/playback/presetPreview.ts:4` imports `applyPreset`.

All four tabs stay mounted by design (`App.tsx:106-113`), so those cannot be deferred without changing the mount model — out of scope here and explicitly out of scope in the audit too. What this task *does* remove from the main chunk is `instantVibes.ts` (23,410 B source), `vibeVariation.ts` (11,386 B), `vibeDrumPatterns.ts` (7,089 B) and `vibeEffectChains.ts` (3,735 B) — ~45 KB of source that only the vibe chips need, and none of it is needed until a chip is clicked.

**The Instant Vibes ids are persisted in project files and must not change.** `cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden" drift from their labels **on purpose** (`docs/design.md` §4 item 2). The new chip table repeats those ids verbatim, and a new invariant test pins it field-by-field against `INSTANT_VIBES`.

The chip must still feel instant: the module is prefetched on `requestIdleCallback` after mount and again on chip hover/focus, so the click almost always finds a resolved promise, and the click handler awaits it either way.

**Files:**
- Create: `src/store/vibeChips.ts`
- Create: `src/store/vibeChips.test.ts`
- Create: `src/components/vibeActions.ts` (moves `selectVibe` + `rerollVibe` out of `InstantVibesBar.tsx` so the component can defer the whole module)
- Modify: `src/components/InstantVibesBar.tsx:1-11` (imports), `:13-46` (the two functions move out), `:58-105` (handlers become async + prefetch), `:120-167` (map over `VIBE_CHIPS`)
- Modify: `src/components/InstantVibesBar.test.tsx:7` (import `selectVibe`/`rerollVibe` from `./vibeActions`)
- Test: `src/store/vibeChips.test.ts` (new), `src/components/InstantVibesBar.test.tsx` (unchanged assertions, one changed import)

**Interfaces:**
- Consumes: `INSTANT_VIBES`, `applyInstantVibeToStore` from `src/store/instantVibes.ts`; `createDraw`, `formatVariationSummary`, `resolveVibeVariation`, `RerollToast` from `src/store/vibeVariation.ts`; `useAppStore`.
- Produces (from `src/store/vibeChips.ts` — **must import nothing but `./types`-level types**):
  - `interface VibeChip { id: string; name: string; emoji: string; bpm: number; scaleRoot: string; scaleType: string; hasVariation: boolean }`
  - `VIBE_CHIPS: VibeChip[]`
- Produces (from `src/components/vibeActions.ts`):
  - `selectVibe(vibe: InstantVibe, deps: { onToast: (text: string) => void }): void` — moved verbatim
  - `rerollVibe(vibe: InstantVibe, deps: { onToast: (toast: RerollToast) => void }): void` — moved verbatim
- Produces (from `src/components/InstantVibesBar.tsx`):
  - `loadVibeActions(): Promise<VibeActionsModule>` where `type VibeActionsModule = typeof import('./vibeActions') & { INSTANT_VIBES: InstantVibe[] }`
  - `InstantVibesBar` (unchanged export)

- [ ] **Step 1: Record the baseline build**

Run: `bun run build`
Expected (this is `main`'s measured baseline — confirm it before changing anything):

```
dist/assets/index-BEwPIbws.css              173.95 kB │ gzip: 26.74 kB
dist/assets/rolldown-runtime-CbXtAM7H.js      0.58 kB │ gzip:  0.36 kB
dist/assets/SynthPresetLibrary-B_1zPVj8.js    7.57 kB │ gzip:  2.92 kB
dist/assets/ChordPresetLibrary-CPkJ2ISe.js   10.15 kB │ gzip:  3.21 kB
dist/assets/icons-CuNfNZC_.js                10.43 kB │ gzip:  4.00 kB
dist/assets/PresetLibrary-C__iwxhh.js        13.07 kB │ gzip:  3.55 kB
dist/assets/tonal-BvKN2h_A.js                23.56 kB │ gzip:  8.47 kB
dist/assets/dndkit-BX1A6IQ6.js               55.19 kB │ gzip: 18.19 kB
dist/assets/vendor-Bj1dzbYU.js              178.64 kB │ gzip: 56.45 kB
dist/assets/index-Dg9gUfAs.js               304.90 kB │ gzip: 80.73 kB
```

Then run the marker grep and record the result:

```bash
for s in lofi-half-time-brush lofi-tape-room swung16ths cyber-dance factory-dream-keys pop-club-house; do
  printf "%-24s %s\n" "$s" "$(grep -l -- "$s" dist/assets/*.js | xargs -n1 basename | tr '\n' ' ')"
done
```

Expected baseline: all six markers appear **only** in `index-Dg9gUfAs.js`.

- [ ] **Step 2: Write the failing chip-table invariant test**

Create `src/store/vibeChips.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { VIBE_CHIPS } from './vibeChips';
import { INSTANT_VIBES } from './instantVibes';

describe('VIBE_CHIPS mirrors INSTANT_VIBES exactly', () => {
  test('same length and same ids in the same order', () => {
    expect(VIBE_CHIPS.map((c) => c.id)).toEqual(INSTANT_VIBES.map((v) => v.id));
  });

  test('every rendered field matches the full table field-for-field', () => {
    expect(VIBE_CHIPS).toEqual(
      INSTANT_VIBES.map((v) => ({
        id: v.id,
        name: v.name,
        emoji: v.emoji,
        bpm: v.bpm,
        scaleRoot: v.scaleRoot,
        scaleType: v.scaleType,
        hasVariation: Boolean(v.variation),
      })),
    );
  });

  test('the four deliberately drifting id/label pairs are reproduced verbatim', () => {
    // docs/design.md §4 item 2 — ids are persisted in project files. This is
    // NOT a bug to fix; it is pinned so the chip table cannot "correct" it.
    const byId = new Map(VIBE_CHIPS.map((c) => [c.id, c.name]));
    expect(byId.get('cyber-dance')).toBe('Cyber EDM');
    expect(byId.get('ambient-chill')).toBe('Deep Ambient');
    expect(byId.get('hiphop-groove')).toBe('Boom Bap');
    expect(byId.get('asian-zen')).toBe('Zen Garden');
  });

  test('chip ids are unique', () => {
    expect(new Set(VIBE_CHIPS.map((c) => c.id)).size).toBe(VIBE_CHIPS.length);
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `bun test src/store/vibeChips.test.ts`
Expected: FAIL — module `./vibeChips` does not exist.

- [ ] **Step 4: Write `vibeChips.ts`**

Create `src/store/vibeChips.ts`. It must import **nothing** — that is the whole point.

```ts
/**
 * Chip metadata for the always-mounted Instant Vibes bar.
 *
 * Deliberately duplicates seven fields of INSTANT_VIBES rather than importing
 * it: instantVibes.ts resolves its chords, drum patterns and effect chains at
 * MODULE EVALUATION time, so importing it drags synthPresets.ts,
 * chordProgressions.ts, vibeDrumPatterns.ts and vibeEffectChains.ts into the
 * eagerly-parsed main chunk. The bar renders none of that — it renders a name,
 * an emoji, a BPM and a key — and the full table is only needed once a chip is
 * actually clicked, so it is dynamically imported from the click handler.
 *
 * `vibeChips.test.ts` pins this table field-for-field against INSTANT_VIBES,
 * so the duplication cannot drift.
 *
 * THE IDS ARE PERSISTED IN PROJECT FILES. Four of them do not match their
 * display names, on purpose (docs/design.md §4 item 2). Do not "fix" them.
 */
export interface VibeChip {
  /** Persisted in project files — never rename. */
  id: string;
  name: string;
  emoji: string;
  bpm: number;
  scaleRoot: string;
  scaleType: string;
  /** Whether this vibe has a `variation` rule, i.e. whether it shows a dice. */
  hasVariation: boolean;
}

export const VIBE_CHIPS: VibeChip[] = [
  { id: 'lofi-chill',     name: 'Lo-Fi Chill',   emoji: '☕',  bpm: 84,  scaleRoot: 'C', scaleType: 'Major',         hasVariation: true },
  { id: 'synthwave-80s',  name: 'Synthwave 80s', emoji: '🏎️', bpm: 118, scaleRoot: 'A', scaleType: 'Natural Minor', hasVariation: true },
  { id: 'cyber-dance',    name: 'Cyber EDM',     emoji: '⚡',  bpm: 128, scaleRoot: 'F', scaleType: 'Natural Minor', hasVariation: true },
  { id: 'ambient-chill',  name: 'Deep Ambient',  emoji: '🌌', bpm: 72,  scaleRoot: 'D', scaleType: 'Lydian',        hasVariation: true },
  { id: 'hiphop-groove',  name: 'Boom Bap',      emoji: '🎙️', bpm: 92,  scaleRoot: 'E', scaleType: 'Dorian',        hasVariation: true },
  { id: 'asian-zen',      name: 'Zen Garden',    emoji: '🎋', bpm: 78,  scaleRoot: 'G', scaleType: 'Hirajoshi',     hasVariation: true },
  { id: 'lofi-waltz',     name: 'Lo-Fi Waltz',   emoji: '🎠', bpm: 96,  scaleRoot: 'F', scaleType: 'Major',         hasVariation: true },
  { id: 'afro-six-eight', name: 'Afro 6/8',      emoji: '🪘', bpm: 132, scaleRoot: 'D', scaleType: 'Dorian',        hasVariation: true },
];
```

- [ ] **Step 5: Run the chip test**

Run: `bun test src/store/vibeChips.test.ts`
Expected: PASS (4 tests). If the field-for-field test fails, fix `vibeChips.ts` to match `INSTANT_VIBES` — never the other way round.

- [ ] **Step 6: Move `selectVibe`/`rerollVibe` into their own module**

Create `src/components/vibeActions.ts` and move lines 13-46 of `InstantVibesBar.tsx` (`selectVibe`, `rerollVibe` and their doc comments) into it **verbatim**, with these imports:

```ts
import { applyInstantVibeToStore } from '../store/instantVibes';
import type { InstantVibe } from '../types';
import { useAppStore } from '../store/store';
import {
  createDraw,
  formatVariationSummary,
  resolveVibeVariation,
  type RerollToast,
} from '../store/vibeVariation';
```

Add this module doc at the top:

```ts
/**
 * The two vibe actions, in their own module so InstantVibesBar can defer the
 * whole dependency tree behind a dynamic import().
 *
 * Both stay SYNCHRONOUS and keep their exact signatures: the async boundary is
 * the module load in the click handler, not these functions, so
 * InstantVibesBar.test.tsx exercises them the same way it always did.
 */
```

- [ ] **Step 7: Rewrite `InstantVibesBar.tsx`'s data path**

Replace the imports at lines 1-11 with:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Check, Dices } from 'lucide-react';
import { VIBE_CHIPS, type VibeChip } from '../store/vibeChips';
import { useAppStore } from '../store/store';
```

Add, above the component:

```tsx
/**
 * The vibe table plus the two actions, loaded on demand.
 *
 * instantVibes.ts resolves every vibe's chords, drum pattern and effect chain
 * at module-evaluation time, so a static import here put ~45 KB of source
 * (instantVibes + vibeVariation + vibeDrumPatterns + vibeEffectChains) into
 * the eagerly-parsed main chunk for a bar that renders eight names and eight
 * emoji. None of it is needed until a chip is clicked.
 *
 * The promise is cached, so the module is fetched and evaluated at most once.
 */
let vibeActionsPromise: Promise<{
  INSTANT_VIBES: import('../types').InstantVibe[];
  selectVibe: typeof import('./vibeActions').selectVibe;
  rerollVibe: typeof import('./vibeActions').rerollVibe;
}> | null = null;

export function loadVibeActions() {
  if (!vibeActionsPromise) {
    vibeActionsPromise = Promise.all([
      import('./vibeActions'),
      import('../store/instantVibes'),
    ]).then(([actions, table]) => ({
      INSTANT_VIBES: table.INSTANT_VIBES,
      selectVibe: actions.selectVibe,
      rerollVibe: actions.rerollVibe,
    }));
  }
  return vibeActionsPromise;
}
```

Inside the component, add the prefetch and rewrite the two handlers:

```tsx
  // Prefetch so the click is never the first time this module is fetched.
  // Idle time after mount covers the common case; hover/focus covers a user
  // who clicks within the first idle-callback window.
  const prefetch = useCallback(() => { void loadVibeActions(); }, []);

  useEffect(() => {
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (idle) {
      idle(() => { void loadVibeActions(); }, { timeout: 2000 });
      return;
    }
    const timer = setTimeout(() => { void loadVibeActions(); }, 1200);
    return () => clearTimeout(timer);
  }, []);

  const handleSelectVibe = async (chip: VibeChip) => {
    const { INSTANT_VIBES, selectVibe } = await loadVibeActions();
    const vibe = INSTANT_VIBES.find((v) => v.id === chip.id);
    if (!vibe) return;
    selectVibe(vibe, { onToast: (text) => setToast({ kind: 'load', text }) });
    scheduleToastClear(3000);
  };

  const handleReroll = async (chip: VibeChip) => {
    const { INSTANT_VIBES, rerollVibe } = await loadVibeActions();
    const vibe = INSTANT_VIBES.find((v) => v.id === chip.id);
    if (!vibe) return;
    setRollingVibeId(chip.id);
    try {
      rerollVibe(vibe, { onToast: (t) => setToast({ kind: 'reroll', ...t }) });
      // 400 ms of spin, then the icon settles; the toast holds longer because
      // its second line has more to read than the load toast's one.
      scheduleToastClear(4000);
    } finally {
      // Robust to rerollVibe throwing: the spin must stop either way, or the
      // dice would spin forever.
      scheduleTimeout(spinTimerRef, () => setRollingVibeId(null), 400);
    }
  };
```

In the JSX, change `{INSTANT_VIBES.map((vibe) => {` to `{VIBE_CHIPS.map((vibe) => {`, change `!vibe.variation` to `!vibe.hasVariation` (both occurrences: the `join-item` class expression at line 130 and the early return at line 145), and add `onMouseEnter={prefetch}` / `onFocus={prefetch}` to the chip `<button>`. Every class string stays byte-identical.

- [ ] **Step 8: Repoint the component test's import**

In `src/components/InstantVibesBar.test.tsx`, change line 7 from

```tsx
import { selectVibe, InstantVibesBar, rerollVibe } from './InstantVibesBar';
```

to

```tsx
import { InstantVibesBar } from './InstantVibesBar';
import { rerollVibe, selectVibe } from './vibeActions';
```

Every assertion in that file stays exactly as it is — `selectVibe`/`rerollVibe` are still synchronous and still take a full `InstantVibe`.

- [ ] **Step 9: Run the vibe suites**

Run: `bun test src/store/instantVibes.test.ts src/store/instantVibesDrums.test.ts src/store/instantVibesEffects.test.ts src/store/instantVibesProgressions.test.ts src/store/vibeSynthPresets.test.ts src/store/vibeVariation.test.ts src/store/vibeChips.test.ts src/components/InstantVibesBar.test.tsx`
Expected: PASS, unchanged counts. `instantVibes.test.ts` pins `INSTANT_VIBES.length === 8` and the exact 8×3 preset matrix — those must be untouched.

- [ ] **Step 10: Run the full suite, type-check, lint and theme guard**

Run: `bun test && bun run lint && bun run eslint && bun run check:theme`
Expected: all clean. `vibeChips.ts` and `vibeActions.ts` obey the layering rules (`store/` imports no `components/`; `components/vibeActions.ts` importing `store/` is the allowed direction).

- [ ] **Step 11: Measure the build and record the real numbers**

Run: `bun run build`, then re-run the marker grep from Step 1.

Acceptance criteria — all four must hold, and the whole task is rejected if any does not:
1. `grep -l lofi-half-time-brush dist/assets/*.js` names a **lazy** chunk, not `index-*.js`.
2. Same for `lofi-tape-room` (vibeEffectChains), `swung16ths` (vibeVariation's `DRUM_DENSITIES`) and `cyber-dance` (instantVibes).
3. `factory-dream-keys` and `pop-club-house` **still** appear in `index-*.js` — they come from `synthPresets.ts` / `chordProgressions.ts`, which SynthView and ChordView pull eagerly (see the correction above). Their absence would mean an always-mounted view lost a dependency it needs.
4. `index-*.js` raw size drops by at least 25 KB and its gzip size by at least 6 KB against the 304.90 KB / 80.73 KB baseline.

Paste the new size table verbatim under this step, and record the per-chunk delta:

```
index-*.js   304.90 kB / 80.73 kB gzip  ->  ______ kB / ______ kB gzip   (Δ ______ / ______)
new vibes chunk                         ->  ______ kB / ______ kB gzip
total JS     604.09 kB / 177.88 kB gzip ->  ______ kB / ______ kB gzip   (Δ ______ / ______)
```

Total JS is expected to be roughly flat — the point is *what loads on first paint*, not the sum of all chunks.

- [ ] **Step 12: Manual check — the chip must still feel instant**

Run `bun run dev`. Load the page, wait two seconds, click a vibe chip: the music must swap with no perceptible delay and the toast must appear immediately. Then hard-reload and click a chip **within the first second**, before the idle prefetch can have run — measure it: open DevTools → Network, throttle to "Fast 3G", reload, and click a chip as fast as possible. Record the observed delay. If it exceeds ~150 ms on Fast 3G, add `<link rel="modulepreload">` for the vibes chunk rather than reverting the split. Also verify hover-then-click (the `onMouseEnter` prefetch path) is instant on Fast 3G.

- [ ] **Step 13: Manual check — nothing about the vibes changed**

Click every one of the eight chips in turn and confirm each loads its own BPM, key and drums. Click the dice on a selected chip and confirm the reroll toast still carries both lines. Save a project, reload, and confirm the previously selected chip is still highlighted (this proves `selectedVibeId` still round-trips against the unchanged ids).

- [ ] **Step 14: Commit**

```bash
git add src/store/vibeChips.ts src/store/vibeChips.test.ts src/components/vibeActions.ts src/components/InstantVibesBar.tsx src/components/InstantVibesBar.test.tsx
git commit -m "perf(bundle): defer the Instant Vibes data tables behind a dynamic import

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 31: Extract the five Pro-Mode panels out of `SynthView.tsx`

`SynthView.tsx` is **1206** lines at this point — 1208 pre-branch, minus the two lines Task 19 deletes (`:40`, the `useLeadPlayback` import, and `:160`, its destructure). **Every line number in this task is post-Task-19**, so anything pre-branch above `:40` is unchanged, between `:40` and `:160` is −1, and below `:160` is −2. 487 of those lines (`:689-1175`; pre-branch `:691-1177`) are five self-contained module cards that share nothing but `params`, `onChangeParams` and `tintClass`. `docs/design.md` §6.5 already registers `module-osc`, `module-filter`, `module-env-vca`, `module-env-vcf`, `module-lfo` and `module-arp` *specifically* for these five panels — the design system treats them as five modules and the component has not caught up.

**Pure move. No behaviour change, no markup change, no class change.** Every panel reproduces its JSX character-for-character apart from leading whitespace; the only new code is a five-line shared hook that re-derives `params` / `onChangeParams` / `tintClass` from the store instead of receiving them as props (`docs/design.md` §4's "modules hold their own controls", and the same store-direct pattern `SynthView` itself already uses).

Per `docs/design.md` §4 "The `ui/` primitive layer": the panels pass **no colour overrides** to `Knob` beyond its existing closed `color` union values, which move unchanged. Per §6.2 the markup is already `btn btn-xs` / `card` + `card-body` and stays so.

**Files:**
- Create: `src/components/loop/synth/useSynthChannel.ts`
- Create: `src/components/loop/synth/OscillatorPanel.tsx` (from `SynthView.tsx:689-763`; pre-branch `:691-765`)
- Create: `src/components/loop/synth/FilterPanel.tsx` (from `:765-844`; pre-branch `:767-846`)
- Create: `src/components/loop/synth/EnvelopePanel.tsx` (from `:846-992`; pre-branch `:848-994`)
- Create: `src/components/loop/synth/LfoPanel.tsx` (from `:994-1074`; pre-branch `:996-1076`)
- Create: `src/components/loop/synth/ArpeggiatorPanel.tsx` (from `:1076-1175`; pre-branch `:1078-1177`)
- Create: `src/components/loop/synth/synthPanels.test.tsx`
- Modify: `src/components/loop/SynthView.tsx:8-19` (icon imports), `:20` (`initSynthPlayback`), `:40` (`Knob` — **not `:41`**, see the trap in Step 7), `:44` (`STEP_BADGE`), `:685-1177` (the Pro-Mode grid). All post-Task-19; pre-branch these are `:41`, `:45`, `:687-1179`.

**Interfaces:**
- Consumes: **Task 19's edits to this same file** — Task 19 deletes `SynthView.tsx:40` (the `useLeadPlayback` import) and `:160` (its destructure), so every line number in this task is post-Task-19: `Knob` is `:40`, `fieldClasses` `:44`, `tintClass` `:140`, the Pro-Mode grid `:685-1177`, and Task 19's prop-free `<LeadPianoRoll />` sits at `:1180`, safely below this task's replace range. Also `useAppStore` (`src/store/store.ts`); `resolveSynthControlChannel`, `SYNTH_TARGET_STYLES`, `SynthControlTarget` (`src/utils/synthControl.ts`); `Knob` (`src/components/ui/Knob.tsx`); `STEP_BADGE` (`src/components/ui/fieldClasses.ts`); `initSynthPlayback` (`src/audio/playback/synthPlayback.ts`); `SynthParams` (`src/types.ts`).
- Produces (from `src/components/loop/synth/useSynthChannel.ts`):
  - `interface SynthChannel { params: SynthParams; onChangeParams: (next: SynthParams) => void; tintClass: string }`
  - `useSynthChannel(): SynthChannel`
- Produces (one default-free named export per file, all `React.FC` with **no props**):
  - `OscillatorPanel`, `FilterPanel`, `EnvelopePanel`, `LfoPanel`, `ArpeggiatorPanel`

**Exact symbol inventory — what each panel needs:**

| panel | source lines | store (via `useSynthChannel`) | other imports | ids it owns |
|---|---|---|---|---|
| `OscillatorPanel` | 689-763 | `params.oscType`, `.subOscVolume`, `.detune`, `.noiseVolume`; `onChangeParams`; `tintClass` | `Knob`, `STEP_BADGE`, `Activity` | `btn-wave-*`, `slider-sub-osc`, `slider-detune`, `slider-noise` |
| `FilterPanel` | 765-844 | `params.filterType`, `.filterCutoff`, `.filterResonance`, `.filterEnvAmount` | `Knob`, `STEP_BADGE`, `Sliders` | `btn-filter-*`, `slider-filter-cutoff`, `slider-filter-resonance`, `slider-filter-env` |
| `EnvelopePanel` | 846-992 | `params.attack`, `.decay`, `.sustain`, `.release`, `.filterAttack`, `.filterDecay`, `.filterSustain`, `.filterRelease` | `Knob`, `STEP_BADGE`, `Volume2` | `slider-env-{attack,decay,sustain,release}`, `slider-env-filter-{attack,decay,sustain,release}` |
| `LfoPanel` | 994-1074 | `params.lfoTarget`, `.lfoRate`, `.lfoDepth`, `.octave` | `Knob`, `STEP_BADGE`, `Activity` | `btn-lfo-target-*`, `slider-lfo-rate`, `slider-lfo-depth`, `btn-octave-*` |
| `ArpeggiatorPanel` | 1076-1175 | `params.arpActive`, `.arpMode`, `.arpRate`, `.arpOctaves` | `STEP_BADGE`, `Sparkles`, `initSynthPlayback` | `btn-toggle-arp`, `btn-arp-mode-*`, `btn-arp-rate-*`, `btn-arp-octave-*` |

`ArpeggiatorPanel` uses **no** `Knob`. Every panel's outermost element is the existing `<div className={\`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}\`}>` wrapper, moved with it.

- [ ] **Step 1: Write the shared channel hook**

Create `src/components/loop/synth/useSynthChannel.ts`:

```ts
import { useAppStore } from '../../../store/store';
import { resolveSynthControlChannel, SYNTH_TARGET_STYLES } from '../../../utils/synthControl';
import type { SynthParams } from '../../../types';

export interface SynthChannel {
  params: SynthParams;
  onChangeParams: (next: SynthParams) => void;
  tintClass: string;
}

/**
 * The three values every Pro-Mode module panel needs, derived from the store
 * exactly as SynthView derives them at its own top level (SynthView.tsx
 * 131-145, unchanged).
 *
 * Each panel calls this itself rather than taking props, so the five panels
 * are independent leaves: SynthView's own re-renders (preset stepping, save
 * toasts, library open/close, the lead piano-roll's per-step state) no longer
 * reconcile 487 lines of knob JSX, and a panel only re-renders when the
 * channel it is pointed at actually changes.
 */
export function useSynthChannel(): SynthChannel {
  const controlTarget = useAppStore((s) => s.controlTarget);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const setSynthParams = useAppStore((s) => s.setSynthParams);
  const setChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const setBassSynthParams = useAppStore((s) => s.setBassSynthParams);

  const channel = resolveSynthControlChannel(controlTarget, {
    synth: { params: synthParams, setParams: setSynthParams },
    chord: { params: chordSynthParams, setParams: setChordSynthParams },
    bass: { params: bassSynthParams, setParams: setBassSynthParams },
  });

  const tintClass = [
    SYNTH_TARGET_STYLES[controlTarget].ring,
    SYNTH_TARGET_STYLES[controlTarget].tint,
  ]
    .filter(Boolean)
    .join(' ');

  return { params: channel.params, onChangeParams: channel.setParams, tintClass };
}
```

- [ ] **Step 2: Create the five panel files by copying the JSX verbatim**

Each file has this shape — shown in full for `OscillatorPanel`, and the other four follow it exactly with their own imports from the inventory table and their own JSX range:

```tsx
import React from "react";
import { Activity } from "lucide-react";
import { Knob } from "../../ui/Knob";
import { STEP_BADGE } from "../../ui/fieldClasses";
import { useSynthChannel } from "./useSynthChannel";

/**
 * Pro-Mode panel 1 — Oscillators. Moved verbatim from SynthView.tsx 689-763.
 *
 * Reads the active synth channel from the store rather than taking props, so
 * SynthView renders `<OscillatorPanel />` with no wiring. Its identity colour
 * is `module-osc` (docs/design.md §6.5); no colour is chosen here, the token
 * is named in the class strings that moved with the markup.
 */
export const OscillatorPanel: React.FC = () => {
  const { params, onChangeParams, tintClass } = useSynthChannel();
  return (
    /* SynthView.tsx:689-763 verbatim, starting at the
       `<div className={`card flex-1 bg-panel border border-base-300 shadow-md ${tintClass}`}>`
       wrapper and ending at its closing `</div>`. */
  );
};
```

Copy the ranges with `sed`, do not retype them:

```bash
mkdir -p src/components/loop/synth
sed -n '689,763p' src/components/loop/SynthView.tsx   # OscillatorPanel body
sed -n '765,844p' src/components/loop/SynthView.tsx   # FilterPanel body
sed -n '846,992p' src/components/loop/SynthView.tsx   # EnvelopePanel body
sed -n '994,1074p' src/components/loop/SynthView.tsx  # LfoPanel body
sed -n '1076,1175p' src/components/loop/SynthView.tsx # ArpeggiatorPanel body
```

Note: line 992 ends `</div>{" "}` — drop the trailing `{" "}` (it was JSX whitespace between two sibling cards inside the flex grid and belongs to SynthView's grid, not to the panel). Line 688, 764, 845, 993, 1075 are the `{/* N. ... */}` comments — keep each one immediately above its panel's wrapper `div` inside the new file.

- [ ] **Step 3: Prove the copy is character-identical**

For each panel, run (substituting each range and file):

```bash
git show HEAD:src/components/loop/SynthView.tsx | sed -n '689,763p' | sed 's/^[[:space:]]*//' > /tmp/panel-before.txt
grep -n 'card flex-1 bg-panel' -A100000 src/components/loop/synth/OscillatorPanel.tsx \
  | sed 's/^[0-9]*[:-]//' | sed 's/^[[:space:]]*//' | sed '/^);$/,$d' > /tmp/panel-after.txt
diff /tmp/panel-before.txt /tmp/panel-after.txt
```

Expected: **empty diff** for all five. The panels use the same local names (`params`, `onChangeParams`, `tintClass`, `STEP_BADGE`), so nothing inside the JSX needs renaming. If a diff is non-empty, the copy was retyped — redo it with `sed`.

- [ ] **Step 4: Capture the render baseline for each panel**

Create `src/components/loop/synth/synthPanels.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ArpeggiatorPanel } from './ArpeggiatorPanel';
import { EnvelopePanel } from './EnvelopePanel';
import { FilterPanel } from './FilterPanel';
import { LfoPanel } from './LfoPanel';
import { OscillatorPanel } from './OscillatorPanel';

/**
 * These panels were MOVED out of SynthView.tsx, not rewritten. zustand v5
 * serves getInitialState as the server snapshot, so renderToString here
 * renders each panel against the store's initial synth params — the same
 * markup SynthView produced for the same state.
 *
 * The assertions below are structural, not a full snapshot: they pin the
 * element counts, every button/knob id, and the module identity token each
 * panel wears (docs/design.md §6.5), which is what a re-typed copy would get
 * wrong. The character-identity of the move itself is proved by the `diff`
 * in Task 31 Step 3.
 */
describe('Pro-Mode panels render the markup SynthView used to render inline', () => {
  test('OscillatorPanel: 4 waveform buttons + 3 knobs, all module-osc', () => {
    const html = renderToString(<OscillatorPanel />);
    for (const w of ['sawtooth', 'square', 'sine', 'triangle']) {
      expect(html).toContain(`id="btn-wave-${w}"`);
    }
    for (const id of ['slider-sub-osc', 'slider-detune', 'slider-noise']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('text-module-osc');
    expect(html).toContain('card flex-1 bg-panel border border-base-300 shadow-md');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
  });

  test('FilterPanel: 3 filter-type buttons + 3 knobs, all module-filter', () => {
    const html = renderToString(<FilterPanel />);
    for (const t of ['lowpass', 'bandpass', 'highpass']) {
      expect(html).toContain(`id="btn-filter-${t}"`);
    }
    for (const id of ['slider-filter-cutoff', 'slider-filter-resonance', 'slider-filter-env']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('text-module-filter');
    expect(html).toContain('LPF');
    expect(html).toContain('BPF');
    expect(html).toContain('HPF');
  });

  test('EnvelopePanel: both ADSR halves with their own identity tokens', () => {
    const html = renderToString(<EnvelopePanel />);
    for (const id of ['attack', 'decay', 'sustain', 'release']) {
      expect(html).toContain(`id="slider-env-${id}"`);
      expect(html).toContain(`id="slider-env-filter-${id}"`);
    }
    expect(html).toContain('text-module-env-vca');
    expect(html).toContain('text-module-env-vcf');
    expect(html).toContain('AMP / VCA');
    expect(html).toContain('FILTER / VCF');
  });

  test('LfoPanel: 3 destinations, 2 knobs, 5 octave buttons, all module-lfo', () => {
    const html = renderToString(<LfoPanel />);
    for (const t of ['cutoff', 'pitch', 'volume']) {
      expect(html).toContain(`id="btn-lfo-target-${t}"`);
    }
    expect(html).toContain('id="slider-lfo-rate"');
    expect(html).toContain('id="slider-lfo-depth"');
    for (const oct of [-2, -1, 0, 1, 2]) {
      expect(html).toContain(`id="btn-octave-${oct}"`);
    }
    expect(html).toContain('--color-module-lfo');
  });

  test('ArpeggiatorPanel: bypass toggle, 4 modes, 3 rates, 3 octave counts', () => {
    const html = renderToString(<ArpeggiatorPanel />);
    expect(html).toContain('id="btn-toggle-arp"');
    for (const m of ['up', 'down', 'updown', 'random']) {
      expect(html).toContain(`id="btn-arp-mode-${m}"`);
    }
    for (const r of ['16n', '8n', '32n']) {
      expect(html).toContain(`id="btn-arp-rate-${r}"`);
    }
    for (const o of [1, 2, 3]) {
      expect(html).toContain(`id="btn-arp-octave-${o}"`);
    }
    expect(html).toContain('--color-module-arp');
    // INITIAL_SYNTH_PARAMS.arpActive is false, so the toggle reads Bypass.
    expect(html).toContain('Bypass');
  });

  test('every panel renders exactly one card wrapper', () => {
    for (const Panel of [OscillatorPanel, FilterPanel, EnvelopePanel, LfoPanel, ArpeggiatorPanel]) {
      const html = renderToString(<Panel />);
      expect(html.split('card flex-1 bg-panel').length - 1).toBe(1);
    }
  });
});
```

- [ ] **Step 5: Run the panel tests against the still-inline SynthView**

Run: `bun test src/components/loop/synth/synthPanels.test.tsx`
Expected: PASS (6 tests). At this point the JSX exists twice — once inline in SynthView, once in the panels — which is exactly the state that lets the next step be a pure deletion.

- [ ] **Step 6: Replace the inline grid in SynthView**

In `src/components/loop/SynthView.tsx`, replace lines 686-1176 — post-Task-19; pre-branch `:688-1178` — (the `/* Pro Mode: Control Panels Grid */` comment through the closing `</div>` of the flex-wrap container) with. The ternary's `) : (` at `:685` and `)}` at `:1177` stay, and so does the prop-free `<LeadPianoRoll />` Task 19 left at `:1180`:

```tsx
        /* Pro Mode: Control Panels Grid */
        <div className="w-full flex flex-wrap gap-3">
          <OscillatorPanel />
          <FilterPanel />
          <EnvelopePanel />
          <LfoPanel />
          <ArpeggiatorPanel />
        </div>
```

and add the five imports next to the existing `SimpleSynthPanel` import (line 38):

```tsx
import { OscillatorPanel } from "./synth/OscillatorPanel";
import { FilterPanel } from "./synth/FilterPanel";
import { EnvelopePanel } from "./synth/EnvelopePanel";
import { LfoPanel } from "./synth/LfoPanel";
import { ArpeggiatorPanel } from "./synth/ArpeggiatorPanel";
```

- [ ] **Step 7: Remove the imports SynthView no longer uses**

Verified against the current file — these are used **only** inside the removed range:

- `Activity` and `Volume2` from the `lucide-react` import block (lines 10 and 12). `Sliders`, `Zap`, `Sparkles`, `Bookmark`, `Library`, `Check`, `ChevronLeft`, `ChevronRight` all stay.
- `import { initSynthPlayback } from "../../audio/playback/synthPlayback";` (line 20) — delete the whole line.
- `import { Knob } from "../ui/Knob";` — **line 40, not 41**. Task 19 deleted the `useLeadPlayback` import that used to sit at `:40`, so everything below moved up one: `:41` is now `import { ChannelStrip } ...`. Deleting `:41` here would remove the wrong import and break the file. Match the text, not the number, and delete the whole line.
- `STEP_BADGE` from **line 44** (pre-branch `:45`); the import becomes `import { COUNT_BADGE } from "../ui/fieldClasses";`.

`tintClass` (line 140; pre-branch `:141`) **stays** — it is still used at line 347 and passed to `SimpleSynthPanel` at line 664 (pre-branch `:349` and `:666`).

- [ ] **Step 8: Verify the line-count target and run the suites**

Run: `wc -l src/components/loop/SynthView.tsx`
Expected: 720-730 lines (from **1206** post-Task-19; ~491 lines of JSX out, ~7 in, 5 imports in, 4 removed).

Run: `bun test src/components/loop && bun test src/components/loop/synth`
Expected: PASS. `SynthView.test.tsx` (which imports `KEYBOARD_NOTES` re-exported from `SynthView.tsx:49`; pre-branch `:50`) must still pass unchanged — that re-export is outside the moved range.

- [ ] **Step 9: Type-check, lint, theme guard, key-binding invariant**

Run: `bun run lint && bun run eslint && bun run check:theme && bun run check:keys`
Expected: all clean. `check:theme` is mandatory here: five new files entered `src/**/*.tsx` and its `ALLOWLIST` is empty and must stay empty. `check:keys` because `scripts/check-key-bindings.ts` imports `KEYBOARD_NOTES` through `SynthView.tsx`.

- [ ] **Step 10: Manual check**

Run `bun run dev`, Synth tab, switch to Pro Mode. All five cards must look pixel-identical to before, in the same order, with the same tint on the card borders. Switch the Target between Synth / Chord / Bass — every knob must jump to that channel's value and the tint must follow. Drag one knob in each panel and confirm the sound changes on the selected target only.

- [ ] **Step 11: Commit**

```bash
git add src/components/loop/synth/ src/components/loop/SynthView.tsx
git commit -m "refactor(ui): extract the five Pro-Mode synth panels out of SynthView

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 32: Extract the Chord and Bass module panels out of `ChordView.tsx`

`ChordView.tsx` is 1342 lines. Two of its blocks — the Chord Module control row (`:754-964`, 211 lines) and the Bass Module card (`:1144-1317`, 174 lines) — are self-contained module cards driven by their own store slices. Pure move, same rules as Task 31.

What is *not* extracted, and why: the drag-and-drop progression grid and the in-scale / borrowed quick-add palettes share `handleMoveChord`, `removeChord`, `updateChord` and `SortableChordCard`'s memo contract too tightly to split without threading half of ChordView's state back in as props.

**Consumes Part 2's Task 18 — resolved, no branching.** Task 18 has been read; its outcome is now stated here so this task has no conditional. After Task 18:

- `currentStep` is **gone** from `ChordView`: it is dropped from the `useChordPlayback()` destructure at `:243`, and `grep -n "currentStep" src/components/loop/ChordView.tsx` returns zero hits.
- `isPlaying` **remains** a `ChordView` local — Task 18 keeps it in that same destructure and still passes it down as a prop.
- The two step grids are `<PlayingStepRow player="chords" …>`, **not** `<StepRow …>`. Task 18 swaps the import at `ChordView.tsx:86` to `import { PlayingStepRow } from "../ui/StepRow";` and rewrites the opening tags at `:869` and `:1270`; the remaining props on `:874-880` and `:1275-1284` are untouched. (Those are post-Task-7 numbers — Task 7 inserted 7 lines at `:248` — and Task 18 itself then adds 2 more lines at `:622`, which is why the extraction ranges below are quoted `+9`.)

So both extracted panels take exactly one step prop, `isPlaying: boolean`, threaded from `ChordView`, and both import `PlayingStepRow` (not `StepRow`) from `../../ui/StepRow`. Neither takes `currentStep` — the leaf subscribes for it. This is reflected in the two prop interfaces below; do not re-derive it.

**Files:**
- Create: `src/components/loop/chord/AdjustSynthButton.tsx` (from `ChordView.tsx:149-170`)
- Create: `src/components/loop/chord/bassStepChoice.ts` (from `ChordView.tsx:123-147`)
- Create: `src/components/loop/chord/ChordModulePanel.tsx` (from `ChordView.tsx:763-973`; pre-branch `:754-964`)
- Create: `src/components/loop/chord/BassModulePanel.tsx` (from `ChordView.tsx:1153-1326`; pre-branch `:1144-1317`)
- Create: `src/components/loop/chord/modulePanels.test.tsx`
- Modify: `src/components/loop/ChordView.tsx` — imports (`:9-18`, `:52-62`, `:80-88` — all above Task 7's insert at `:248`, so unshifted), the two moved blocks, and the store reads at `:210-247` that only the panels use (also unshifted; `:248` onward is where the +7 starts)
- Modify: `src/components/loop/ChordView.test.tsx:233` (import `nextBassStepChoice`/`bassStepLabel` from `./chord/bassStepChoice`)

**Interfaces:**
- Consumes: `useAppStore`; `PlayingStepRow` (`src/components/ui/StepRow.tsx`, added by Task 18 — **not** `StepRow`); `stepCells` (`src/components/sequencerGrid.ts`); `getMeter` (`src/utils/meter.ts`); `RHYTHM_STYLE_GROUPS` (`src/audio/rhythmPatterns.ts`); `BASS_STYLE_GROUPS`, `BassStepChoice` (`src/audio/bassPatterns.ts`); `patternMeterTitle`, `patternOptionLabel` (`src/components/meterSelect.ts`); `findPresetByName`, `getAllSynthPresets`, `getPresetsGroupedByCategory` (`src/audio/synthPresets.ts`); `ChannelStrip`, `Slider`, `FIELD_LABEL`, `FIELD_SELECT`, `SECTION_HEADER`; `focusSynthTarget`, `SYNTH_TARGET_STYLES`, `SynthControlTarget` (`src/utils/synthControl.ts`).
- Produces:
  - `src/components/loop/chord/bassStepChoice.ts` → `nextBassStepChoice(current: BassStepChoice): BassStepChoice`, `bassStepLabel(choice: BassStepChoice): string` (both moved verbatim, including their doc comments)
  - `src/components/loop/chord/AdjustSynthButton.tsx` → `AdjustSynthButton: React.FC<{ target: SynthControlTarget; className?: string }>` (moved verbatim, now exported)
  - `src/components/loop/chord/ChordModulePanel.tsx` → `ChordModulePanel: React.FC<ChordModulePanelProps>` with
    ```ts
    export interface ChordModulePanelProps {
      onPatternPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
      onPatternPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
      autoReharmonize: boolean;
      onToggleAutoReharmonize: () => void;
      onReharmonize: () => void;
      /** Still a ChordView local after Task 18; gates the PlayingStepRow ring. */
      isPlaying: boolean;
    }
    ```
  - `src/components/loop/chord/BassModulePanel.tsx` → `BassModulePanel: React.FC<BassModulePanelProps>` with
    ```ts
    export interface BassModulePanelProps {
      onPatternPreviewDown: (e: React.MouseEvent | React.TouchEvent) => void;
      onPatternPreviewUp: (e: React.MouseEvent | React.TouchEvent) => void;
      /** Still a ChordView local after Task 18; gates the PlayingStepRow ring. */
      isPlaying: boolean;
    }
    ```

**Exact store reads each panel takes over (verified: each of these has zero remaining uses in ChordView after the move):**

| `ChordModulePanel` | `BassModulePanel` |
|---|---|
| `chordSynthParams` *(also still read by ChordView at :496 and :512 — stays in both)* | `bassSynthParams`, `setBassSynthParams` |
| `setChordSynthParams` | `customSynthPresets` |
| `customSynthPresets` | `bassOctave`, `setBassOctave` |
| `chordOctave` *(also still read by ChordView — stays in both)*, `setChordOctave` | `bassPatternId` *(also still read by ChordView at :315/:320)*, `setBassPatternId` |
| `chordRhythmId` *(also still read at :253/:258)*, `setChordRhythmId` | `bassPatternMode` *(also still read at :314/:320)*, `setBassPatternMode` |
| `chordRhythmMode` *(also still read at :252/:258)*, `setChordRhythmMode` | `customBassPattern` *(also still read at :316/:320)*, `setCustomBassPattern` |
| `customChordRhythm` *(also still read at :254/:258)*, `setCustomChordRhythm` | `bassFeel`, `setBassFeel` |
| `chordFeel`, `setChordFeel` | `bassVolume`, `setBassVolume` |
| `chordVolume`, `setChordVolume` | `meterId` |
| `meterId` | |

Each panel computes its own `const chordCells = useMemo(() => stepCells(getMeter(meterId)), [meterId]);` — `chordCells` (`ChordView.tsx:247`) has exactly two uses, both inside the moved ranges, so its declaration and the `stepCells` import leave ChordView entirely.

`handleChordVolumeChange` (`:325-327`) and `handleBassVolumeChange` (`:329-331`) are one-line wrappers over the store setters with no other callers — they are **not** moved; each panel passes the store setter straight to `ChannelStrip.onVolumeChange`, and the two wrappers plus `setChordVolume`/`setBassVolume` are deleted from ChordView.

- [ ] **Step 1: Confirm the Task 18 shape before touching anything**

Run: `grep -n "currentStep\|isPlaying\|StepRow" src/components/loop/ChordView.tsx`
Expected, and asserted by the Consumes note above: **zero** hits for `currentStep`; `isPlaying` present in the `useChordPlayback()` destructure at `:243` and on the two grid call sites; `PlayingStepRow` imported at `:86` and used at `:862` and `:1263`. If any of those three does not hold, stop — Task 18 did not land as this task assumes, and the prop interfaces below need re-deriving before you move any JSX.

- [ ] **Step 2: Move the two pure helpers and the button**

`git mv`-style move by hand:

Create `src/components/loop/chord/bassStepChoice.ts` containing `ChordView.tsx:123-147` verbatim (`BASS_STEP_CYCLE`/`nextBassStepChoice`/`bassStepLabel` and their doc comments) with `import type { BassStepChoice } from '../../../audio/bassPatterns';` at the top. Delete those lines from `ChordView.tsx`.

Create `src/components/loop/chord/AdjustSynthButton.tsx` containing `ChordView.tsx:149-170` verbatim, with `export` added to the function, plus:

```tsx
import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '../../../store/store';
import { focusSynthTarget, SYNTH_TARGET_STYLES } from '../../../utils/synthControl';
import type { SynthControlTarget } from '../../../utils/synthControl';
```

Delete those lines from `ChordView.tsx` and add `import { AdjustSynthButton } from './chord/AdjustSynthButton';` — ChordView still renders it at `:750` (the chord card header, outside the moved range).

In `src/components/loop/ChordView.test.tsx`, change line 233 to `import { nextBassStepChoice, bassStepLabel } from './chord/bassStepChoice';`.

Run: `bun test src/components/loop/ChordView.test.tsx && bun run lint`
Expected: PASS — this sub-step is a strict move with no behaviour change.

- [ ] **Step 3: Create the two panels by copying the JSX verbatim**

```bash
sed -n '763,973p'   src/components/loop/ChordView.tsx  # ChordModulePanel body (pre-branch 754,964)
sed -n '1153,1326p' src/components/loop/ChordView.tsx  # BassModulePanel body (pre-branch 1144,1317)
```

`ChordModulePanel.tsx`:

```tsx
import React, { useMemo } from "react";
import { Sparkles, Volume2 } from "lucide-react";
import { useAppStore } from "../../../store/store";
import { RHYTHM_STYLE_GROUPS } from "../../../audio/rhythmPatterns";
import {
  findPresetByName,
  getAllSynthPresets,
  getPresetsGroupedByCategory,
} from "../../../audio/synthPresets";
import { patternMeterTitle, patternOptionLabel } from "../../meterSelect";
import { getMeter } from "../../../utils/meter";
import { stepCells } from "../../sequencerGrid";
import { ChannelStrip } from "../../ui/ChannelStrip";
import { FIELD_LABEL, FIELD_SELECT } from "../../ui/fieldClasses";
import { Slider } from "../../ui/Slider";
import { PlayingStepRow } from "../../ui/StepRow";

export interface ChordModulePanelProps { /* as in Interfaces above */ }

/**
 * The Chord Module's control row. Moved verbatim from ChordView.tsx 754-964.
 *
 * Reads its own slice of the store; the four things it cannot derive — the two
 * pattern-preview handlers (which own ChordView's preview refs and the resolved
 * rhythm pattern), the auto-reharmonize toggle state and the Re-harmonize
 * action (which own ChordView's local toast and indicator state) — come in as
 * props. Those handlers are already stable useCallbacks / render-scope
 * functions in ChordView, exactly as before.
 */
export const ChordModulePanel: React.FC<ChordModulePanelProps> = ({
  onPatternPreviewDown,
  onPatternPreviewUp,
  autoReharmonize,
  onToggleAutoReharmonize,
  onReharmonize,
}) => {
  /* the store reads from the table above */
  const chordCells = useMemo(() => stepCells(getMeter(meterId)), [meterId]);
  return (
    /* ChordView.tsx:754-964 verbatim */
  );
};
```

Three substitutions inside the copied JSX, and no others:
- `handleChordPatternPreviewMouseDown` → `onPatternPreviewDown` (1 site)
- `handleChordPatternPreviewMouseUp` → `onPatternPreviewUp` (4 sites: `onMouseUp`, `onMouseLeave`, `onTouchEnd`, and the `onMouseLeave` duplicate)
- `handleChordVolumeChange` → `setChordVolume` (1 site)
- the Re-harmonize button's inline `onClick={() => { ... }}` body (`:915-928`) → `onClick={onReharmonize}`
- the Auto-Reharmonize button's inline `onClick={() => { ... }}` body (`:939-953`) → `onClick={onToggleAutoReharmonize}`

`BassModulePanel.tsx` follows the same shape with `BASS_STYLE_GROUPS`, `bassStepLabel`, `nextBassStepChoice`, `AdjustSynthButton` and `SECTION_HEADER`, and these substitutions:
- `handleBassPatternPreviewMouseDown` → `onPatternPreviewDown`
- `handleBassPatternPreviewMouseUp` → `onPatternPreviewUp`
- `handleBassVolumeChange` → `setBassVolume`

- [ ] **Step 4: Prove the copy is character-identical apart from those substitutions**

```bash
git show HEAD:src/components/loop/ChordView.tsx | sed -n '754,964p' | sed 's/^[[:space:]]*//' \
  | sed -e 's/handleChordPatternPreviewMouseDown/onPatternPreviewDown/g' \
        -e 's/handleChordPatternPreviewMouseUp/onPatternPreviewUp/g' \
        -e 's/handleChordVolumeChange/setChordVolume/g' > /tmp/chordpanel-before.txt
```

Extract the same range out of `ChordModulePanel.tsx`, strip indentation, and `diff`. Expected: the only differences are the two `onClick` handler bodies collapsed to `onClick={onReharmonize}` / `onClick={onToggleAutoReharmonize}`. Repeat for the bass panel — that one must diff **empty**.

- [ ] **Step 5: Write the panel render tests**

Create `src/components/loop/chord/modulePanels.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { BassModulePanel } from './BassModulePanel';
import { ChordModulePanel } from './ChordModulePanel';

const noop = () => {};

describe('ChordModulePanel', () => {
  const html = renderToString(
    <ChordModulePanel
      onPatternPreviewDown={noop}
      onPatternPreviewUp={noop}
      autoReharmonize
      onToggleAutoReharmonize={noop}
      onReharmonize={noop}
    />,
  );

  test('renders every control the inline block rendered', () => {
    for (const id of [
      'select-chord-sound-preset',
      'select-chord-octave',
      'select-chord-rhythm-pattern',
      'btn-preview-chord-pattern',
      'slider-chord-feel',
      'btn-reharmonize-chord-progression',
      'btn-toggle-auto-reharmonize',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test('wears the chord module identity token and no raw colour', () => {
    expect(html).toContain('text-module-chord');
    expect(html).toContain('[--range-thumb:var(--color-module-chord-content)]');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('text-white');
  });

  test('the auto-reharmonize label follows the prop', () => {
    expect(html).toContain('Auto-Reharmonize: ON');
    const off = renderToString(
      <ChordModulePanel
        onPatternPreviewDown={noop}
        onPatternPreviewUp={noop}
        autoReharmonize={false}
        onToggleAutoReharmonize={noop}
        onReharmonize={noop}
      />,
    );
    expect(off).toContain('Auto-Reharmonize: OFF');
    expect(off).toContain('btn-soft');
  });

  test('the custom step grid is hidden while the mode is preset', () => {
    // INITIAL state has chordRhythmMode 'preset', so no PlayingStepRow renders.
    expect(html).not.toContain('rounded-field transition-all cursor-pointer relative');
  });
});

describe('BassModulePanel', () => {
  const html = renderToString(
    <BassModulePanel onPatternPreviewDown={noop} onPatternPreviewUp={noop} />,
  );

  test('renders every control the inline block rendered', () => {
    for (const id of [
      'select-bass-sound-preset',
      'select-bass-octave',
      'select-bass-rhythm-pattern',
      'btn-preview-bass-pattern',
      'slider-bass-feel',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test('keeps its tint-bass card shell and bass identity token', () => {
    expect(html).toContain('card bg-panel tint-bass border border-module-bass/30');
    expect(html).toContain('text-module-bass');
    expect(html).toContain('Bass Module');
    expect(html).not.toContain('#');
    expect(html).not.toContain('indigo-');
  });

  test('carries the Adjust Synth button', () => {
    expect(html).toContain('Adjust Synth');
  });
});
```

- [ ] **Step 6: Run the panel tests against the still-inline ChordView**

Run: `bun test src/components/loop/chord/modulePanels.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 7: Replace the two inline blocks in ChordView**

Replace `ChordView.tsx:763-973` (pre-branch `:754-964`) with:

```tsx
        <ChordModulePanel
          onPatternPreviewDown={handleChordPatternPreviewMouseDown}
          onPatternPreviewUp={handleChordPatternPreviewMouseUp}
          autoReharmonize={autoReharmonize}
          onToggleAutoReharmonize={() => {
            // Turning this ON must not rewrite the current chords: a snap here
            // would reproduce the exact scramble this feature exists to
            // remove (e.g. key change made while OFF, then toggled back ON
            // would snap chords still sitting in the old key). Flipping the
            // flag only starts applying `applyKeyScaleChange` to *future*
            // key/scale changes; it is not itself a harmonize action. The
            // explicit "Re-harmonize" button is the deliberate,
            // user-requested snap — leave that one alone.
            const nextVal = !autoReharmonize;
            setAutoReharmonize(nextVal);
            if (!nextVal) setIsAutoReharmonizedIndicator(false);
          }}
          onReharmonize={() => {
            const updated = snapProgressionToScale(chords, scaleRoot, scaleType, chordOctave);
            setChords(updated);
            setIsAutoReharmonizedIndicator(true);
            setSaveToast(`Re-harmonized progression to ${scaleRoot} ${scaleType} (Option B)!`);
            setTimeout(() => setSaveToast(null), 3000);
          }}
        />
```

Replace `ChordView.tsx:1153-1326` (pre-branch `:1144-1317`) with:

```tsx
      <BassModulePanel
        onPatternPreviewDown={handleBassPatternPreviewMouseDown}
        onPatternPreviewUp={handleBassPatternPreviewMouseUp}
      />
```

Add the two imports next to the existing `SortableChordCard` import (`:88`).

- [ ] **Step 8: Delete the store reads and imports ChordView no longer uses**

Delete from `ChordView.tsx`: `setChordSynthParams` (`:211`), `bassSynthParams` (`:212`), `setBassSynthParams` (`:213`), `setChordRhythmId` (`:215`), `chordFeel`/`setChordFeel` (`:216-217`), `setChordOctave` (`:219`), `setBassPatternId` (`:221`), `setChordRhythmMode` (`:223`), `setCustomChordRhythm` (`:225`), `setBassPatternMode` (`:227`), `setCustomBassPattern` (`:229`), `bassFeel`/`setBassFeel` (`:230-231`), `bassOctave`/`setBassOctave` (`:232-233`), `chordVolume`/`setChordVolume` (`:239-240`), `bassVolume`/`setBassVolume` (`:241-242`), `customPresets` (`:245`), `chordCells` (`:247`), `handleChordVolumeChange` (`:325-327`), `handleBassVolumeChange` (`:329-331`).

Delete these imports: `RHYTHM_STYLE_GROUPS` (`:57`), the whole `BASS_STYLE_GROUPS`/`BassStepChoice` block (`:58-61`), `patternMeterTitle`/`patternOptionLabel` (`:62`), the whole `getAllSynthPresets`/`findPresetByName`/`getPresetsGroupedByCategory` block (`:52-56`), `ChannelStrip` (`:80`), `Slider` (`:84`), `PlayingStepRow` (`:86` — Task 18 changed this line from `StepRow`), `stepCells` (`:87`).

The `fieldClasses` import at `:81` loses three of its five names — verified: `FIELD_LABEL`, `FIELD_SELECT` and `SECTION_HEADER` have **zero** uses in ChordView outside the two moved ranges, while `COUNT_BADGE` (`:692`) and `HEADER_BADGE` (`:726`) stay. It becomes:

```tsx
import { COUNT_BADGE, HEADER_BADGE } from '../ui/fieldClasses';
```

From the lucide import block, only `SlidersHorizontal` (`:17`) goes — it moves with `AdjustSynthButton`. **`Volume2` stays**: it is still used at `:1030` and `:1087` in the chord-card grid, outside the moved ranges. `Music`, `Sparkles`, `Plus`, `Library`, `Bookmark` and `Check` all stay too.

`bun run eslint` (`@typescript-eslint/no-unused-vars` from `tseslint.configs.recommended`) is the check that this list is complete — run it and delete anything else it flags.

- [ ] **Step 9: Verify the line-count target and run every ChordView-adjacent suite**

Run: `wc -l src/components/loop/ChordView.tsx`
Expected: 890-925 lines. The file is **1351** lines at this point (1342 pre-branch, +7 from Task 7's memo, +2 from Task 18's comment rewrite), and the four moved ranges alone are 432 lines.

Run: `bun test src/components/loop`
Expected: PASS — `ChordView.test.tsx`, `chord/SortableChordCard.test.tsx`, `chord/progressionAvailability` coverage and the new `chord/modulePanels.test.tsx`.

- [ ] **Step 10: Type-check, lint, theme guard**

Run: `bun run lint && bun run eslint && bun run check:theme`
Expected: all clean. `check:theme` is mandatory — four new files entered `src/**/*.tsx` and the `ALLOWLIST` must stay empty.

- [ ] **Step 11: Manual check**

Run `bun run dev`, Chords tab. Both cards must look identical. Change the chord preset, octave, pattern (including switching to Custom… and toggling steps), feel slider and level — every one must behave exactly as before. Hold the chord and bass pattern preview buttons: each must loop only its own module. Press Re-harmonize and toggle Auto-Reharmonize: the toast, the badge and the ON/OFF label must behave as before. Repeat every one of those for the Bass card. Switch the meter to 3/4 and confirm both custom step grids resize.

- [ ] **Step 12: Commit**

```bash
git add src/components/loop/chord/ src/components/loop/ChordView.tsx src/components/loop/ChordView.test.tsx
git commit -m "refactor(ui): extract the Chord and Bass module panels out of ChordView

Applied after the Task 18 step-subscription leaf; panels take no step props.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 33: Delegate `TrackRow`'s step buttons to `StepRow`

`src/components/ui/StepRow.tsx:55-61` and `src/components/loop/sequencer/TrackRow.tsx:71-77` carry the **byte-for-byte identical** button class expression. `StepRow`'s own doc comment (`:29-34`) says it "mirrors TrackRow ... the only difference being the per-step VALUE is generic" — it was written *after* `TrackRow` specifically to generalize this, and `TrackRow` was never migrated onto it.

> **Line numbers in this task are post-Task-18.** Task 18 (Part 2) inserts one import line at the top of `StepRow.tsx` (`import { useCurrentStep, type StepPlayerId } from '../playbackStep';`) and appends a `PlayingStepRow` wrapper at EOF, so every pre-branch line number in this file is +1 and the file is ~93 lines rather than 72 when this task starts. `TrackRow.tsx` is **not** edited by any earlier task, so its pre-branch numbers still stand.

Three real differences to close, not two:
1. `TrackRow` renders a `bg-base-content/10 animate-pulse` overlay div on active steps where `StepRow` renders a `getLabel` badge → `activeOverlay?: 'label' | 'pulse'`, default `'label'`.
2. `TrackRow` gives each button `id="step-${track.id}-${cell.index}"`; `StepRow` has none → `getButtonId?: (index: number) => string`.
3. **`TrackRow`'s row wrapper is `flex-1 flex items-center gap-1.5`; `StepRow`'s is `flex items-center gap-1.5`** (the audit missed this) → `rowClassName?: string`, defaulting to `StepRow`'s current literal so both existing callers are untouched.

**RISK — the memo contract.** `TrackRow.tsx:17-23` documents that "the three callbacks are stable useCallbacks in SequencerView and `cells` is memoized there, so a knob drag or a genre change in the parent no longer rebuilds this row's 16 step buttons. `currentStep` is a real prop, so a transport tick DOES still re-render every row." That contract is about `TrackRow`'s **own** props and `React.memo` wrapper, and none of them change here — `TrackRow` keeps exactly the same seven props and stays wrapped in `React.memo`. Part 2's Task 22 restructures `TrackRow`'s parent; read it before starting and re-confirm that `onToggleStep` is still a stable `useCallback` in whatever component now owns it (`SequencerView.tsx:76-86` today).

**How the new props stay referentially stable.** `getButtonId` and `onStepClick` are derived per-row from `track.id`, so they must be `useCallback`s inside `TrackRow` keyed on `[track.id]` and `[track.id, onToggleStep]`. That requires converting `TrackRow`'s expression body to a block body — which changes nothing about the `React.memo` comparison, since it compares props, not the body's shape. `StepRow` is not itself memoized today, so this stability is not load-bearing *yet*; it is done so that memoizing `StepRow` later is a one-line change rather than a silent no-op. `isActive` is a module-level constant (`const IS_ON = (v: boolean) => v === true;`) so it never changes identity at all.

**Files:** (post-Task-18 line numbers, per the note above)
- Modify: `src/components/ui/StepRow.tsx:5-27` (`StepRowProps<T>`), `:29-34` (the doc comment), `:35-73` (the `StepRow` body). **Leave `:74`-EOF — Task 18's `PlayingStepRow` — untouched.**
- Modify: `src/components/loop/sequencer/TrackRow.tsx:1-5` (imports), `:24-88` (body)
- Test: `src/components/ui/StepRow.test.tsx` (append one describe), `src/components/loop/sequencer/TrackRow.test.tsx` (create — byte-identity)
- Unchanged call sites: `src/components/loop/chord/ChordModulePanel.tsx` and `BassModulePanel.tsx` (post-Task-32; `ChordView.tsx:862` and `:1263` pre-Task-32), which since Task 18 render `PlayingStepRow` rather than `StepRow` — neither passes the new props, so both keep today's defaults.

**Interfaces:**
- Consumes: `StepCell` (`src/components/sequencerGrid.ts`); `SequencerTrack` (`src/types.ts`); `PowerToggle`. Also **Task 18's** `PlayingStepRow<T>(props: Omit<StepRowProps<T>, 'currentStep'> & { player: StepPlayerId })` in the same file, and **Task 22's** `SequencerGrid` (`src/components/loop/sequencer/SequencerGrid.tsx`), which is what renders `TrackRow` by the time this task runs.
- Produces (added to `StepRowProps<T>` in `src/components/ui/StepRow.tsx`, all optional and all backward-compatible):
  - `getButtonId?: (index: number) => string`
  - `activeOverlay?: 'label' | 'pulse'`
  - `rowClassName?: string`
- `TrackRow`'s exported `TrackRowProps` is **unchanged**.

**Composition with Task 18 — checked, no collision.** `PlayingStepRow` forwards `...rest` typed as `Omit<StepRowProps<T>, 'currentStep'>` into `<StepRow {...rest} currentStep={…} />`, so the three props this task adds flow through it automatically and need no change to `PlayingStepRow`'s signature or body. The only prop `PlayingStepRow` intercepts is `currentStep`, which this task does not touch. Task 18's own byte-identity assertion ("`PlayingStepRow` renders byte-identically to `StepRow` given the same step") still holds afterwards, because all three new props default to the values that reproduce today's markup. Task 18's three `PlayingStepRow` tests must therefore still pass unmodified — Step 6 below checks that explicitly.

**Composition with Task 22 — checked, no collision.** Task 22 does not edit `TrackRow.tsx`; it only moves the `<TrackRow>` render site from `SequencerView.tsx:355` into `SequencerGrid.tsx`, unchanged, with the same seven props. `onToggleStep` is still the same `useCallback([])` declared in `SequencerView.tsx:76-86` and threaded through `SequencerGrid`'s props, so `TrackRow`'s documented memo contract holds exactly as before and `handleStepClick`'s `[track.id, onToggleStep]` dep list is stable. Nothing in this task's diff overlaps Task 22's diff.

- [ ] **Step 1: Capture TrackRow's exact current output as a byte-identity test**

Create `src/components/loop/sequencer/TrackRow.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { TrackRow } from './TrackRow';
import { stepCells } from '../../sequencerGrid';
import { getMeter } from '../../../utils/meter';
import type { SequencerTrack } from '../../../types';

const cells = stepCells(getMeter('4/4'));

const track: SequencerTrack = {
  id: 'kick',
  name: 'Kick',
  instrument: 'kick',
  color: 'bg-error',
  muted: false,
  steps: [
    true, false, false, false,
    true, false, false, false,
    true, false, false, false,
    true, false, false, false,
    false, false, false, false,
    false, false, false, false,
  ],
};

const noop = () => {};

const render = (overrides: Partial<{ currentStep: number; isPlaying: boolean; muted: boolean }> = {}) =>
  renderToString(
    <TrackRow
      track={{ ...track, muted: overrides.muted ?? track.muted }}
      cells={cells}
      currentStep={overrides.currentStep ?? -1}
      isPlaying={overrides.isPlaying ?? false}
      onToggleStep={noop}
      onToggleMute={noop}
      onPreview={noop}
    />,
  );

/**
 * BYTE-IDENTITY PIN. TrackRow's step buttons are being re-routed through the
 * shared ui/StepRow primitive, which was written to generalize exactly this
 * markup. These four strings are the output of the PRE-refactor TrackRow,
 * captured verbatim; the refactor is correct if and only if they still match.
 *
 * Recorded by running this file once against the pre-refactor component and
 * pasting `render(...)` into each literal below. Do not "tidy" them.
 *
 * The capture is taken at THIS point in the branch, not before it: no task
 * from 1 to 32 edits TrackRow.tsx, so this is also byte-identical to the
 * pre-branch component. Task 22 moved the <TrackRow> render site into
 * SequencerGrid but changed neither the component nor its props, and this
 * test renders TrackRow directly, so that move cannot perturb the baseline.
 */
const IDLE = '__PASTE_render()_HERE__';
const PLAYING_STEP_4 = '__PASTE_render({ currentStep: 4, isPlaying: true })_HERE__';
const PLAYING_BUT_STOPPED = '__PASTE_render({ currentStep: 4, isPlaying: false })_HERE__';
const MUTED = '__PASTE_render({ muted: true })_HERE__';

describe('TrackRow markup is byte-identical across the StepRow migration', () => {
  test('idle row', () => {
    expect(render()).toBe(IDLE);
  });

  test('playing, step 4 highlighted', () => {
    expect(render({ currentStep: 4, isPlaying: true })).toBe(PLAYING_STEP_4);
  });

  test('a matching currentStep with isPlaying false draws no ring', () => {
    expect(render({ currentStep: 4, isPlaying: false })).toBe(PLAYING_BUT_STOPPED);
    expect(PLAYING_BUT_STOPPED).not.toContain('ring-2 ring-primary');
  });

  test('muted row', () => {
    expect(render({ muted: true })).toBe(MUTED);
  });
});

describe('TrackRow structural invariants the byte-identity pin also depends on', () => {
  test('every step button keeps its stable dom id', () => {
    const html = render();
    for (let i = 0; i < 16; i++) {
      expect(html).toContain(`id="step-kick-${i}"`);
    }
  });

  test('active steps keep the pulse overlay, not a label badge', () => {
    const html = render();
    expect(html).toContain('absolute inset-0 bg-base-content/10 rounded-field animate-pulse');
    expect(html).not.toContain('text-[10px] font-bold leading-none');
  });

  test('the step container keeps its flex-1', () => {
    expect(render()).toContain('flex-1 flex items-center gap-1.5');
  });

  test('the row renders exactly 16 step buttons for a 4/4 meter', () => {
    // 16 step buttons + the preview button + PowerToggle's button.
    expect(render().split('<button').length - 1).toBe(18);
  });
});
```

- [ ] **Step 2: Fill in the four captured strings**

Run: `bun test src/components/loop/sequencer/TrackRow.test.tsx`
Expected: FAIL, four times, each printing the received HTML. Paste each received string into its `const` verbatim (escape backticks/`${` if any — there are none in this markup). Re-run.
Expected: PASS (8 tests) against the **pre-refactor** component. This is the baseline; do not proceed until it is green. If any of the four literals disagrees with what a pre-branch `git stash` of `TrackRow.tsx` produces, stop — something earlier in the branch changed this markup and the whole premise of this task needs re-checking.

- [ ] **Step 3: Write the failing StepRow prop tests**

Append to `src/components/ui/StepRow.test.tsx`:

```tsx
describe('StepRow — the props TrackRow needs', () => {
  const cells = stepCells(getMeter('4/4'));
  const steps = Array.from({ length: 16 }, (_, i) => i % 4 === 0);

  const base = {
    cells,
    steps,
    currentStep: -1,
    isPlaying: false,
    color: 'bg-error',
    isActive: (v: boolean) => v === true,
    onStepClick: () => {},
  };

  test('getButtonId stamps a stable id on every button', () => {
    const html = renderToString(
      <StepRow<boolean> {...base} getButtonId={(i) => `step-kick-${i}`} />,
    );
    for (let i = 0; i < 16; i++) expect(html).toContain(`id="step-kick-${i}"`);
  });

  test('without getButtonId no id attribute is emitted (existing callers unchanged)', () => {
    expect(renderToString(<StepRow<boolean> {...base} />)).not.toContain('id="');
  });

  test('activeOverlay="pulse" renders the pulse div instead of a label', () => {
    const html = renderToString(<StepRow<boolean> {...base} activeOverlay="pulse" />);
    expect(html).toContain('absolute inset-0 bg-base-content/10 rounded-field animate-pulse');
    expect(html.split('animate-pulse').length - 1).toBe(4);
  });

  test('activeOverlay="pulse" ignores getLabel', () => {
    const html = renderToString(
      <StepRow<boolean> {...base} activeOverlay="pulse" getLabel={() => 'X'} />,
    );
    expect(html).not.toContain('>X<');
  });

  test('the default overlay is still the label badge', () => {
    const html = renderToString(<StepRow<boolean> {...base} getLabel={() => 'X'} />);
    expect(html).toContain('>X<');
    expect(html).not.toContain('animate-pulse');
  });

  test('rowClassName replaces the wrapper class and defaults to the current one', () => {
    expect(renderToString(<StepRow<boolean> {...base} />))
      .toContain('class="flex items-center gap-1.5"');
    expect(renderToString(<StepRow<boolean> {...base} rowClassName="flex-1 flex items-center gap-1.5" />))
      .toContain('class="flex-1 flex items-center gap-1.5"');
  });
});
```

- [ ] **Step 4: Run, confirm fail**

Run: `bun test src/components/ui/StepRow.test.tsx`
Expected: FAIL — the three new props are not in `StepRowProps`.

- [ ] **Step 5: Add the three props to StepRow**

In `src/components/ui/StepRow.tsx`, add to `StepRowProps<T>`:

```tsx
  /**
   * Stable DOM id per step button. TrackRow has stamped
   * `step-${track.id}-${index}` on its buttons since before this primitive
   * existed; nothing queries it today, but it is a reasonable convention to
   * preserve and the sequencer rows are the one grid a user can address by
   * track.
   */
  getButtonId?: (index: number) => string;
  /**
   * What an ACTIVE step draws on top of its fill.
   *
   * `'label'` (default) is the `getLabel` badge the chord and bass grids use.
   * `'pulse'` is the sequencer's `bg-base-content/10 animate-pulse` overlay —
   * the one difference that kept TrackRow off this primitive.
   */
  activeOverlay?: 'label' | 'pulse';
  /**
   * Classes on the row container. Defaults to the chord/bass grids' own
   * wrapper; the sequencer's row sits inside a flex header and needs `flex-1`.
   */
  rowClassName?: string;
```

and change the body:

```tsx
export function StepRow<T>({
  cells,
  steps,
  currentStep,
  isPlaying,
  color,
  isActive,
  getLabel,
  getButtonId,
  activeOverlay = 'label',
  rowClassName = 'flex items-center gap-1.5',
  onStepClick,
}: StepRowProps<T>) {
  return (
    <div className={rowClassName}>
      {cells.map((cell) => {
        const value = steps[cell.index];
        const active = value !== undefined && isActive(value);
        const isCurrent = isPlaying && currentStep === cell.index;
        return (
          <button
            key={cell.index}
            id={getButtonId?.(cell.index)}
            onClick={() => onStepClick(cell.index)}
            className={`flex-1 h-9 rounded-field transition-all cursor-pointer relative ${
              active
                ? `${color} shadow-md shadow-primary/20 scale-[0.96]`
                : cell.isAltBeatGroup
                  ? "bg-base-100 hover:bg-base-300 border border-base-300/50"
                  : "bg-base-200 hover:bg-base-300 border border-base-300/40"
            } ${isCurrent ? "ring-2 ring-primary brightness-125" : ""}`}
          >
            {active && activeOverlay === 'pulse' ? (
              <div className="absolute inset-0 bg-base-content/10 rounded-field animate-pulse" />
            ) : active && getLabel ? (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold leading-none pointer-events-none select-none">
                {getLabel(value)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
```

Also update the component doc comment (`:28-33`) — it currently says the conventions "mirror TrackRow"; they now *are* TrackRow's:

```tsx
/**
 * A theme-agnostic step grid row — the single implementation of a step button
 * app-wide. The chord on/off grid, the bass tone-choice grid and the
 * sequencer's drum/synth lanes all render through this; the per-step VALUE is
 * generic, the active fill colour is the caller's module token, and the active
 * overlay is either a short label or the sequencer's pulse.
 */
```

- [ ] **Step 6: Run the StepRow tests**

Run: `bun test src/components/ui/StepRow.test.tsx`
Expected: PASS — the seven pre-existing tests (the four original `StepRow` ones plus Task 18's three `PlayingStepRow` ones, none of which passes any of the new props) plus the six new ones: 13 in all. Task 18's "renders byte-identically to StepRow given the same step" assertion passing is the proof that `PlayingStepRow` still forwards correctly through the widened props.

- [ ] **Step 7: Route TrackRow through StepRow**

Rewrite `src/components/loop/sequencer/TrackRow.tsx`:

```tsx
import React, { useCallback } from "react";
import { Play } from "lucide-react";
import type { SequencerTrack } from "../../../types";
import type { StepCell } from "../../sequencerGrid";
import { PowerToggle } from "../../ui/PowerToggle";
import { StepRow } from "../../ui/StepRow";

export interface TrackRowProps {
  track: SequencerTrack;
  cells: StepCell[];
  currentStep: number;
  isPlaying: boolean;
  onToggleStep: (trackId: string, stepIndex: number) => void;
  onToggleMute: (trackId: string) => void;
  onPreview: (track: SequencerTrack) => void;
}

/** Module-level so its identity never changes across renders. */
const IS_ON = (value: boolean) => value === true;

/**
 * One drum/synth lane. Memoized: the three callbacks are stable useCallbacks
 * in SequencerView and `cells` is memoized there, so a knob drag or a genre
 * change in the parent no longer rebuilds this row's 16 step buttons.
 * `currentStep` is a real prop, so a transport tick DOES still re-render
 * every row — the column highlight is per-step data each row needs.
 *
 * The step buttons render through ui/StepRow, which was written to generalize
 * exactly this markup (its class expression was byte-for-byte identical to the
 * copy that used to live here) but was never wired up to it. The two
 * differences that kept them apart — the pulse overlay and the per-step DOM id
 * — are now StepRow props.
 */
export const TrackRow: React.FC<TrackRowProps> = React.memo(
  ({ track, cells, currentStep, isPlaying, onToggleStep, onToggleMute, onPreview }) => {
    // Derived from track.id, so they are memoized on it: StepRow is not itself
    // memoized today, so this is not load-bearing yet — it is what makes
    // wrapping StepRow in React.memo later a one-line change instead of a
    // silent no-op.
    const handleStepClick = useCallback(
      (index: number) => onToggleStep(track.id, index),
      [track.id, onToggleStep],
    );
    const getButtonId = useCallback((index: number) => `step-${track.id}-${index}`, [track.id]);

    return (
      <div
        id={`sequencer-row-${track.id}`}
        className="flex items-center gap-2 bg-base-200 p-2 rounded-box border border-base-300 hover:border-primary/40 transition-colors"
      >
        {/* Track Info & Mute */}
        <div className="w-40 flex items-center justify-between pr-2 border-r border-base-300">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${track.color}`} />
            <span className="text-xs font-bold text-base-content truncate">
              {track.name}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onPreview(track)}
              className="btn btn-ghost btn-xs btn-square hover:text-primary"
              title="Preview Instrument"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <PowerToggle
              id={`btn-mute-${track.id}`}
              on={!track.muted}
              onToggle={() => onToggleMute(track.id)}
              name={track.name}
              tone="primary"
              iconOnly
              size="xs"
              verb={{ on: 'Unmute', off: 'Mute' }}
            />
          </div>
        </div>

        {/* Step Buttons — the visible window of this row */}
        <StepRow<boolean>
          cells={cells}
          steps={track.steps}
          currentStep={currentStep}
          isPlaying={isPlaying}
          color={track.color}
          isActive={IS_ON}
          getButtonId={getButtonId}
          activeOverlay="pulse"
          rowClassName="flex-1 flex items-center gap-1.5"
          onStepClick={handleStepClick}
        />
      </div>
    );
  },
);
```

- [ ] **Step 8: Run the byte-identity pin**

Run: `bun test src/components/loop/sequencer/TrackRow.test.tsx`
Expected: PASS, all 8, with the four captured strings **unmodified**. If a byte-identity test fails, do not edit the expected string — the refactor changed the markup and must be corrected instead.

- [ ] **Step 9: Count the lines removed and run every affected suite**

Run: `wc -l src/components/loop/sequencer/TrackRow.tsx src/components/ui/StepRow.tsx`
Expected: `TrackRow.tsx` ~88 → ~85 with 25 lines of button markup replaced by an 11-line `<StepRow>` call plus 8 lines of memoized callbacks; `StepRow.tsx` ~93 (72 pre-branch + Task 18's import line and `PlayingStepRow` block) → ~116.

Run: `bun test src/components/ && bun test`
Expected: PASS throughout. The two (post-Task-32: `ChordModulePanel` / `BassModulePanel`) `StepRow` callers pass none of the new props and their rendered output is unchanged.

- [ ] **Step 10: Type-check, lint, theme guard, key bindings**

Run: `bun run lint && bun run eslint && bun run check:theme && bun run check:keys`
Expected: all clean.

- [ ] **Step 11: Manual check**

Run `bun run dev`, Beat Step tab. Toggle steps on every row and confirm each toggles the right step of the right track. Start the sequencer and confirm the playhead ring walks the grid on every row, and that active steps still pulse. Mute a row and confirm it silences. Switch the meter to 6/8 and confirm the grid resizes and the alternating beat-group shading is unchanged.

- [ ] **Step 12: Commit**

```bash
git add src/components/ui/StepRow.tsx src/components/ui/StepRow.test.tsx src/components/loop/sequencer/TrackRow.tsx src/components/loop/sequencer/TrackRow.test.tsx
git commit -m "refactor(ui): route TrackRow's step buttons through the shared StepRow primitive

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 34: Documentation and comment corrections

Three unrelated corrections, batched because each is a one-line-to-one-paragraph edit with no behaviour change. **Do not delete any code in this task** — (b) explicitly corrects a comment about code whose deletion is not proven safe.

**Files:**
- Verify only (no edit expected): `src/components/loop/ChordView.tsx` — the memo comment near `:622-624` pre-branch. **Task 18 already rewrote it**; line numbers shift again after Task 32. Find it by the string `must stay memoized`.
- Modify: `src/audio/engine.ts:330-339` (`setupMasterChain`'s cleanup comments) — pre-branch; roughly `:353-362` after Tasks 2, 3 and 26. Find it by the string `is (re)built on every AudioContext`.
- Modify: `CLAUDE.md:7`, `:32`, `:49-51`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. No exported symbol changes; no test changes.

- [ ] **Step 1: (a) Verify — do not rewrite — ChordView's memo comment**

This item was originally written as an edit: the comment justifying two `tonal` memos claimed the component "re-renders twice a second at 120 BPM" because it subscribes `playheadBeat`, when it also subscribed `currentStep` at the 16th-note rate. **Task 18 already fixed it**, and fixed it by removing the cause rather than restating the rate: `currentStep` no longer passes through `ChordView` at all, so "twice a second" became true again. Task 18's Step 7 replaced those three lines with:

```ts
  // ChordView subscribes to playheadBeat, so it re-renders twice a second at
  // 120 BPM — the 16th-note step no longer passes through here (it is
  // published to components/playbackStep.ts and read by the two
  // PlayingStepRows), so this is again the real rate. Both memos below call
  // into tonal and must stay memoized.
```

So there is **nothing to write here**. Do not re-edit this comment, and in particular do not restore the "SIXTEENTH-note rate" wording — that would be false after Task 18.

- [ ] **Step 2: Prove that, then move on**

Run: `grep -n "currentStep\|playheadBeat\|must stay memoized" src/components/loop/ChordView.tsx`
Expected: **zero** hits for `currentStep`; `playheadBeat` read in ChordView's render scope; Task 18's replacement comment present. If `currentStep` still has hits, Task 18 did not land — go back and finish it rather than patching the comment to match broken code. Record the grep output in the commit body and note in it that item (a) was a no-op verification.

- [ ] **Step 3: (b) Correct `setupMasterChain`'s unreachable-cleanup comments**

`engine.ts:330-339` (pre-branch; +23 or so after Tasks 2/3/26 — locate it by text) claims the chain "is (re)built on every AudioContext (re)creation" and clears `sourceBuses`, `sourceAnalysers` and `impulseCache` because "an AudioBuffer belongs to its context". Neither cleanup can run: `init()` only calls `setupMasterChain()` inside `if (!this.ctx)` (`:195-200`), and `grep -rn "\.close()" src/audio/` finds no call, so the context is created exactly once per page load and `setupMasterChain` runs exactly once.

First prove it, then correct the comment:

```bash
grep -rn "setupMasterChain" src/
grep -rn "\.close()" src/audio/
```

Expected: `setupMasterChain` has exactly one call site (`engine.ts:198`, inside the `!this.ctx` guard), and no `close()` call exists anywhere. Record both outputs in the commit body.

Replace lines 330-339 with:

```ts
    // NOTE: this cleanup is currently UNREACHABLE, and that is a deliberate
    // keep, not an oversight. init() only calls setupMasterChain inside
    // `if (!this.ctx)` and nothing anywhere calls ctx.close(), so the context
    // is created exactly once per page load and this method runs exactly once
    // — these three clears have never executed in production.
    //
    // They stay because they are the correct behaviour the day the context IS
    // recreated: per-source buses from a dead context are wired into dead
    // nodes, and an AudioBuffer belongs to the context that created it, so
    // impulses built against the old one must not survive into the new graph.
    // Do NOT write new code that relies on these running.
    this.sourceBuses.clear();
    this.sourceAnalysers.clear();
    this.impulseCache.clear();
    this.reverbDecay = 2.0;
```

(Note that idle-suspend from Task 29 does **not** make this reachable: `suspend()` keeps the same context and the same graph. Only `close()` would, and nothing calls it.)

- [ ] **Step 4: (c) Correct `CLAUDE.md`'s two stale facts**

`CLAUDE.md:7` — replace

```
Runtime is **Bun** (test runner + scripts); the app itself is Vite + React 18.
```

with

```
Runtime is **Bun** (test runner + scripts); the app itself is Vite 8 (Rolldown) + React 19.
```

Verified: `package.json:27-28` pins `react`/`react-dom` at `^19.2.8`, and `package.json:32` pins `vite` at `^8.2.2`.

`CLAUDE.md:32` — replace `**version 5**` with `**version 7**`. Verified: `src/store/store.ts:393` reads `version: 7`.

- [ ] **Step 5: (c) Document `testFakes.ts` in the testing-conventions section**

`src/audio/testFakes.ts` is the harness every engine test uses and `CLAUDE.md` does not mention it. Insert this paragraph in `CLAUDE.md` between the "Tests are `bun:test` and mostly pure-logic" paragraph (`:49`) and the invariant-scripts paragraph (`:51`):

```markdown
Engine tests do **not** stub the engine — they drive the real one against `src/audio/testFakes.ts`. It exports `makeEngine()` (a fresh instance from the singleton's constructor, since the class is not exported), `freshEngine(opts)` (that instance pre-wired to a fake `AudioContext`, returning `{ engine, ctx }`), `fakeNode()`, `fakeBufferSource()` and `fakeParam()`. `fakeParam` records `cancels` / `targets` / `ramps` / `events` and exposes `valueAt(t)`, which evaluates the automation curve the engine actually scheduled — so an envelope assertion reads the real value rather than re-deriving it. `FakeOpts.cancelAndHold: false` stands in for Firefox, which has no `cancelAndHoldAtTime`. Any new `src/audio/` test belongs on this harness; `src/audio/playback/presetPreview.test.ts` shows the pattern for the singleton-only modules (swap the singleton's internals for a `freshEngine()`'s, restore in a `finally`).

Two component tests render for real with `renderToString` from `react-dom/server` (`src/components/ui/PresetLibrary.test.tsx`, `src/components/loop/chord/SortableChordCard.test.tsx`) — zustand v5 serves `getInitialState` as the server snapshot, so a store-reading component renders against the initial state. That is also the tool for pinning a pure-move refactor: capture the exact HTML before the move and assert byte-equality after.
```

- [ ] **Step 6: Verify nothing else in CLAUDE.md is stale**

Run: `grep -n "React 1\|version [0-9]\|zustand" CLAUDE.md package.json src/store/store.ts | head -20`
Expected: no remaining `React 18` and no remaining `version 5`.

- [ ] **Step 7: Run the gate**

Run: `bun run verify`
Expected: PASS. This task changes only comments and Markdown, so every suite must be unchanged — if anything moved, a code edit slipped in.

- [ ] **Step 8: Commit**

```bash
git add src/components/loop/ChordView.tsx src/audio/engine.ts CLAUDE.md
git commit -m "docs: correct the ChordView re-render rate, the dead master-chain cleanup, and CLAUDE.md

ChordView re-renders at the 16th, not twice a second. setupMasterChain's
context-rebuild cleanup is unreachable (one call site, inside !this.ctx; no
ctx.close() anywhere) — comment corrected, code kept. CLAUDE.md: React 18 ->
19, persist version 5 -> 7, and audio/testFakes.ts documented.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 35: Update `docs/design.md` §4 for the extractions

**Verdict: this is a real edit, not a no-op check.** §4 was read before writing this task and three of its statements become wrong once Tasks 31-33 land:

1. **§4 item 4** names only `SimpleSynthPanel.tsx / SynthView.tsx` as the synthesizer interface. After Task 31 the Pro-Mode half is five separate components under `components/loop/synth/`, and §6.5's table already points at "SynthView panel 1 — Oscillators" etc. by *number*, which will no longer be findable in `SynthView.tsx`.
2. **§4 item 6** names only `ChordView.tsx`. After Task 32 the Chord and Bass module cards are `components/loop/chord/ChordModulePanel.tsx` / `BassModulePanel.tsx`.
3. **§4 "The `ui/` primitive layer"** lists `Knob`, `Slider`, `Keyboard`, `ChannelStrip`, `PresetLibrary`, `QuickSavePopover`, `ViewHeader`, `PowerToggle`, `viewMeta` — and **does not list `StepRow.tsx` at all**, even though it is a `ui/` primitive with a documented per-caller contract. Task 33 gives it three new public props and a third caller, which is exactly the kind of contract §4 exists to record.

**Files:**
- Modify: `docs/design.md:136` (§4 item 4), `:138` (§4 item 6), `:169-183` (the `ui/` primitive list), `:289-296` (§6.5's "used by" column)

**Interfaces:**
- Consumes: the file lists produced by Tasks 31, 32 and 33.
- Produces: nothing executable.

- [ ] **Step 1: Re-read §4 and confirm the three claims above still hold**

Run: `sed -n '133,195p' docs/design.md`
If Tasks 31-33 were altered during execution such that any of the three is no longer true, say so plainly in the commit body and drop that sub-edit rather than inventing one.

- [ ] **Step 2: Rewrite §4 item 4**

Replace item 4 with:

```markdown
4. **`SimpleSynthPanel.tsx` / `SynthView.tsx` / `loop/synth/*Panel.tsx`**: Dual-mode synthesizer interface. Simple mode is 4 friendly macro knobs (`Tone`, `Space`, `Vibe`, `Punch`) in `SimpleSynthPanel`. Pro mode is five independent module panels under `components/loop/synth/` — `OscillatorPanel`, `FilterPanel`, `EnvelopePanel`, `LfoPanel`, `ArpeggiatorPanel`, in that order — each wearing its own identity token from §6.5. They take **no props**: each calls `useSynthChannel()` (`loop/synth/useSynthChannel.ts`), which resolves `params` / `onChangeParams` / `tintClass` for the active Synth-Chord-Bass target straight from the store, so `SynthView` renders `<OscillatorPanel />` with no wiring and its own re-renders no longer reconcile the knob JSX. `SynthView` keeps the mode switcher, the preset header, the target selector, the keyboard, the lead piano-roll and the lazily-loaded preset library.
```

- [ ] **Step 3: Rewrite §4 item 6**

Replace item 6 with:

```markdown
6. **`ChordView.tsx` / `loop/chord/ChordModulePanel.tsx` / `loop/chord/BassModulePanel.tsx`**: Interactive chord progression builder. `ChordView` owns the sortable chord-card grid, the in-scale and borrowed quick-add palettes, the key/scale effects and the pattern-preview handlers; the two module cards own their own controls (preset, octave, pattern select + custom step grid, feel, level — plus Re-harmonize and Auto-Reharmonize on the chord card), read their own slice of the store, and take only what they cannot derive: the two preview handlers, and the chord card's auto-reharmonize state and Re-harmonize action. The grid is deliberately NOT extracted — it shares `handleMoveChord` / `removeChord` / `updateChord` and `SortableChordCard`'s memo contract too tightly to split without threading half of ChordView's state back in as props.
```

- [ ] **Step 4: Add `StepRow.tsx` to the `ui/` primitive list**

Insert after the `ChannelStrip.tsx` bullet:

```markdown
* **`StepRow.tsx`** — the single implementation of a step-grid row app-wide: the chord on/off grid, the bass tone-choice grid and the sequencer's drum/synth lanes all render through it. Generic over the per-step value; `isActive` says what counts as on and `color` is the caller's module token, so the primitive never names a colour. Three optional props cover the sequencer's needs without forking the markup: `getButtonId` (the `step-${track.id}-${index}` convention `TrackRow` has always stamped), `activeOverlay` (`'label'`, the default badge, or `'pulse'`, the sequencer's `animate-pulse` fill) and `rowClassName` (the sequencer's row needs `flex-1`). `TrackRow` used to carry a byte-for-byte copy of this button's class expression; it does not any more, and a byte-identity test in `sequencer/TrackRow.test.tsx` pins that the migration changed no markup.
```

- [ ] **Step 5: Repoint §6.5's "used by" column at the new files**

In the §6.5 table, change the four `SynthView panel N` cells:

| token | new "used by" text |
|---|---|
| `module-osc` | `loop/synth/OscillatorPanel.tsx` |
| `module-filter` | `loop/synth/FilterPanel.tsx` |
| `module-env-vca` | `loop/synth/EnvelopePanel.tsx` — AMP / VCA half |
| `module-env-vcf` | `loop/synth/EnvelopePanel.tsx` — FILTER / VCF half |

If the table also has `module-lfo` / `module-arp` / `module-chord` / `module-bass` rows naming `SynthView` or `ChordView`, repoint those to `loop/synth/LfoPanel.tsx`, `loop/synth/ArpeggiatorPanel.tsx`, `loop/chord/ChordModulePanel.tsx` and `loop/chord/BassModulePanel.tsx` respectively. Leave the "the Chord/Bass target in `SynthView`'s toggle" clauses alone — that toggle is still in `SynthView`.

- [ ] **Step 6: Verify every path named in §4 and §6.5 exists**

```bash
grep -o '`[a-zA-Z/.]*\.tsx\?`' docs/design.md | tr -d '`' | sort -u | while read -r p; do
  [ -e "src/$p" ] || [ -e "src/components/$p" ] || echo "MISSING: $p"
done
```

Expected: no `MISSING` lines for any path this task added. (Pre-existing entries written as bare names like `Header.tsx` resolve under `src/components/`.)

- [ ] **Step 7: Run the gate**

Run: `bun run verify`
Expected: PASS — this task is Markdown only.

- [ ] **Step 8: Commit**

```bash
git add docs/design.md
git commit -m "docs(design): record the extracted synth/chord panels and StepRow's primitive contract

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 36: Final verification and measurement

Close the branch: run the gate, re-measure everything Task 1 baselined, state which of the spec's success criteria are met and which are not, and walk a manual regression checklist covering every user-visible path this branch touched.

**Files:**
- Modify: `docs/superpowers/metrics-baseline.md` — append `## After (recorded in Task 36, branch perf/audit-2026-08-31)` as a sibling of the `## Baseline (recorded in Task 1, …)` section, **under the `# Perf audit remediation — metrics` H1 that Task 1 created**. The file also contains an unrelated `# murva restructure — metrics` H1 with its own `## Baseline` / `## After`; do not write under that one.

**Interfaces:**
- Consumes: the `## Baseline (recorded in Task 1, branch perf/audit-2026-08-31, …)` section, including its **six DevTools numbers** (Scripting / Longest task / Layout count, for each of the two gestures) — Task 1 Step 3 measures and Step 4 records them, and this task cannot fill its `(baseline …)` slots without them. Also the per-chunk build numbers recorded in Task 30 Step 11. If any baseline slot still reads `<fill in>`, stop and finish Task 1 rather than inventing a number.
- Produces: nothing executable.

- [ ] **Step 1: Run the gate and the linter**

Run: `bun run verify`
Expected: PASS — `bun test` + `bun run lint` + `bun run check:keys` + `bun run check:drums` + `bun run build`.

Run: `bun run eslint`
Expected: clean. `verify` does **not** include it, and this branch touched imports in `arpPlayback.ts`, `chordPlayback.ts`, `leadMelody.ts`, `engine.ts`, `presetPreview.ts`, `App.tsx`, `InstantVibesBar.tsx`, `SynthView.tsx`, `ChordView.tsx`, `TrackRow.tsx` and `StepRow.tsx`.

Run: `bun run check:theme`
Expected: PASS with an empty `ALLOWLIST`. Confirm it is still empty: `grep -n "ALLOWLIST" -A5 scripts/themeTokenGuard.ts`.

- [ ] **Step 2: Re-run the Task 1 baseline protocol**

Open `docs/superpowers/metrics-baseline.md` and find this branch's baseline with `grep -n "branch perf/audit-2026-08-31" docs/superpowers/metrics-baseline.md`, then re-run **every** measurement it lists, in the same way, on the same machine. Do not substitute a different method for any of them.

- [ ] **Step 3: Record the build size, per chunk**

Run: `bun run build` and append the full size table. Fill in this comparison (the "before" column is `main` @ b9996ba, measured):

```
                       before (raw / gzip)      after (raw / gzip)      delta
index-*.js             304.90 kB / 80.73 kB     ______ / ______         ______
vendor-*.js            178.64 kB / 56.45 kB     ______ / ______         ______
dndkit-*.js             55.19 kB / 18.19 kB     ______ / ______         ______
tonal-*.js              23.56 kB /  8.47 kB     ______ / ______         ______
PresetLibrary-*.js      13.07 kB /  3.55 kB     ______ / ______         ______
icons-*.js              10.43 kB /  4.00 kB     ______ / ______         ______
ChordPresetLibrary-*.js 10.15 kB /  3.21 kB     ______ / ______         ______
SynthPresetLibrary-*.js  7.57 kB /  2.92 kB     ______ / ______         ______
rolldown-runtime-*.js    0.58 kB /  0.36 kB     ______ / ______         ______
(new) vibes chunk            —                  ______ / ______         ______
ALL JS                 604.09 kB / 177.88 kB    ______ / ______         ______
CSS                    173.95 kB /  26.74 kB    ______ / ______         ______
```

Also record the **first-paint** JS total (every chunk the entry actually loads: `rolldown-runtime` + `vendor` + `tonal` + `dndkit` + `icons` + `index`), since that is what Task 30 moved and the all-JS total is expected to be roughly flat.

- [ ] **Step 4: Record test count and runtime**

Run: `bun test 2>&1 | tail -5`
Record the exact pass/fail counts and the wall time, against Task 1's baseline. Expected direction: pass count **up** (Tasks 24-33 add roughly 60 tests), fail count **0**. If runtime grew by more than ~20%, name which file did it.

- [ ] **Step 5: Manual DevTools profile — 5 s filter-cutoff knob drag**

Serve the production build exactly as Task 1 did: `bun run build && bunx vite preview --port 4173` (there is no `preview` npm script). Open the Synth tab in Pro Mode, start the chord player so voices are live, open DevTools → Performance, record, and drag the **Cutoff** knob (`#slider-filter-cutoff`) continuously for 5 seconds. Report, against the Task 1 baseline:
- total **Scripting** ms
- **longest task** ms
- **Layout** count
- any "Long task" warnings

- [ ] **Step 6: Manual DevTools profile — 30 s idle playback**

Start Play All, switch to the Master FX tab, record 30 seconds without touching anything. Report the same four numbers, plus: the rAF callback count (the visualizer throttle from Task 28 should cut it once nothing is sounding — during playback it should be unchanged, which is the point) and whether any audio dropout was audible.

- [ ] **Step 7: Write the "after" section**

Append to `docs/superpowers/metrics-baseline.md`, under the branch heading Task 1 created:

```markdown
## After (recorded in Task 36, branch perf/audit-2026-08-31)

### Bundle
<the table from Step 3, filled in, plus the first-paint total>

### Tests
- <N> pass / <M> fail, <T> ms (baseline: 1230 pass / 0 fail / 1560 ms)
- <E> expect() calls across <F> files (baseline: 539260 across 92)

### DevTools — 5 s filter-cutoff knob drag, chords playing
- Scripting: <X> ms (baseline <X0> ms)
- Longest task: <Y> ms (baseline <Y0> ms)
- Layout count: <Z> (baseline <Z0>)

### DevTools — 30 s idle playback on Master FX
- Scripting: <X> ms (baseline <X0> ms)
- Longest task: <Y> ms (baseline <Y0> ms)
- Layout count: <Z> (baseline <Z0>)

### Success criteria
<one line per criterion in the branch spec: MET / NOT MET, with the number that decides it>
```

- [ ] **Step 8: State plainly which success criteria are not met**

For every criterion the branch did not reach, write one sentence naming the number that missed and the reason. Two are known in advance and must appear whatever the numbers say:
- **`synthPresets.ts` and `chordProgressions.ts` are still in the main chunk.** Task 30 could not move them: `SynthView.tsx:22-31`, `ChordView.tsx:52-56` and `:93`, and `presetPreview.ts:4` import them eagerly, and all four tabs stay mounted by design. `js-perf.md` finding #2 implied otherwise; that implication is wrong and is corrected in Task 30's preamble.
- **`@dnd-kit` (55.19 kB / 18.19 kB gzip) still loads on first paint.** Same mount-everything constraint (`js-perf.md` finding #4, explicitly recorded there as not actionable without changing the mount model).

Do not round a missed number into a met one, and do not describe a criterion as "partially met".

- [ ] **Step 9: Manual regression checklist**

Run `bun run dev`. Walk every item; a single failure blocks the branch.

**Knobs — every module.** Drag each of these and confirm the value readout, the audible change and the absence of any click or stall:
- Pro Mode: `slider-sub-osc`, `slider-detune`, `slider-noise`, `slider-filter-cutoff`, `slider-filter-resonance`, `slider-filter-env`, all four `slider-env-*`, all four `slider-env-filter-*`, `slider-lfo-rate`, `slider-lfo-depth`
- Simple Mode: all four macro knobs
- Master FX: every knob in the FX Chain, **especially Reverb Decay** (Task 26 + Part 2's Task 16)
- Chords: `slider-chord-feel`, `slider-bass-feel`, the Chord Level and Bass Level faders
- Beat Step: the drum filter knobs and the level fader
- Transport: the Master Output fader

**Playback, loop layer.** Play All; play each of Sequencer / Chords / Lead alone; start one while another runs and confirm they stay bar-aligned; soft-stop then restart; hard stop.

**Playback, song layer.** Build a 3-loop song, play it, confirm the loop advance lands on the bar and the loop card progress bar tracks. Confirm no note hangs across a loop boundary.

**Tab switching during playback.** With everything playing, cycle Synth → Beat Step → Chords → Master FX → Song and back twice. Audio must not stop, stutter or drift; the visualizer must resume drawing on the tab that becomes visible (Task 28).

**QWERTY keyboard and drum pads.** Play notes in both scale-locked and chromatic modes; hold a note while switching tabs; hold a note and click into a text input; hold a note and Cmd-Tab away and back (Task 29's re-arm). Trigger every drum pad by key and by click.

**Touch.** On a touch device or DevTools touch emulation: piano keys, drum pads, every knob (drag), the chord and bass pattern-preview buttons (`onTouchStart`/`onTouchEnd`), and drag-reorder of a chord card.

**MIDI.** Connect a MIDI device, play notes, move a mapped CC. Disconnect it mid-note and confirm the app stays responsive. Reconnect and confirm notes resume.

**Instant Vibes.** Click all eight chips in order; confirm each loads its own BPM, key, drums, chords and effects. Click the dice on a selected chip several times. Do all of this **twice**: once after waiting for the idle prefetch, and once immediately after a hard reload (Task 30's async path).

**Persist flush (Task 13).** Change the BPM, then immediately close the tab and reopen it — the new BPM must survive. Repeat with a background/foreground switch instead of a close, and once with a hard reload within a second of the change. A coalesced write that never flushes is silent data loss, so this item is not optional.

**Presets.** Save a synth preset, load it, delete it. Export the synth preset library to JSON, reload the page, import it back and confirm the order is preserved. Same for the chord progression library. Save, export, import and load a full project.

**Drag-reorder.** Reorder chords in the Chords tab (mouse and keyboard sensors both) and loops in the Song tab. Confirm the progression sounds in the new order.

**Idle suspend (Task 29).** Leave the app untouched with nothing playing for 40 s, then click and play — the first note must sound immediately. Leave it playing for 90 s untouched — playback must not stop.

- [ ] **Step 10: Commit**

```bash
git add docs/superpowers/metrics-baseline.md
git commit -m "docs(metrics): record the after-measurements for the perf audit branch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 37: Wrap the six App-level children in `React.memo`

Closes react-perf.md C1 step 3 (`/tmp/solna-audit/react-perf.md:84-87`) — the "belt and braces" capping the blast radius of any *future* App-level subscription. `App.tsx` renders `LoopPage` (`:108`), `SongPage` (`:111`) and `BottomInputDock` (`:116`); `LoopPage.tsx:16-18` renders `SynthView`/`SequencerView`/`ChordView`, `SongPage.tsx:10-11` renders `ArrangeView`/`EffectsRackView`. None of the six is memoized, so every App render reconciles all of them.

Must land **after** Task 8 (props stable — memoizing `BottomInputDock`, `LoopPage`, `SequencerView` buys nothing while `keyboardProps`/`drumProps` change identity per render; Task 8's steps explicitly deferred this wrapping here), **after** Task 11 (App stops re-rendering per frame — that is the fix, this is the guard rail), and **after** Tasks 31/32 (extracted panels exist, so this edits an export line that will not move again).

Verified by reading: the zero-prop shape is `export const X: React.FC = React.memo(() => { ... });` at `ChordView.tsx:198`, **`src/components/song/EffectsRackView.tsx:16`** (not `src/components/EffectsRackView.tsx` — that path does not exist) and `TransportBar.tsx:23`; the prop-taking shape is `SortableLoopCard.tsx:144`. **No component is dropped** — none of the six is already memoized. Three are zero-prop (`SynthView.tsx:68`, `ArrangeView.tsx:50`, `SongPage.tsx:6`); three take props (`SequencerView.tsx:36`, `LoopPage.tsx:12`, `BottomInputDock.tsx:36`) and need an explicit annotation on the inner arrow, because inside `React.memo(...)` the destructured parameter is no longer contextually typed by the const's `React.FC<P>` and would be an implicit `any`.

**Files:**
- Modify: `src/components/loop/SynthView.tsx:68`, `src/components/loop/SequencerView.tsx:1,36`, `src/components/song/ArrangeView.tsx:50`, `src/components/ui/BottomInputDock.tsx:36-39`, `src/components/loop/LoopPage.tsx:12`, `src/components/song/SongPage.tsx:6` (plus each file's last line, `};` → `});`)
- Create: `src/components/appChildMemo.test.tsx`

**Interfaces:**
- Consumes: `InputDeckDrumProps` (`useInputDeck.ts:62`), `DEFAULT_PADS` (`ui/DrumPadGrid.tsx`), `getScaleLockedKeyboardNotes`/`getChordKeyboardRows` (`ui/Keyboard.tsx`) — the fixtures `BottomInputDock.test.tsx:8-29` and `SequencerView.test.tsx:9-14` already use.
- Produces: no new exports; every component keeps its name, export form and props. `BottomInputDock`'s inline props type is lifted to a file-local `BottomInputDockProps` interface.

- [ ] **Step 1: Write the failing test**

Create `src/components/appChildMemo.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { createElement, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { BottomInputDock } from './ui/BottomInputDock';
import { DEFAULT_PADS } from './ui/DrumPadGrid';
import { getChordKeyboardRows, getScaleLockedKeyboardNotes } from './ui/Keyboard';
import { LoopPage } from './loop/LoopPage';
import { SequencerView } from './loop/SequencerView';
import { SynthView } from './loop/SynthView';
import { ArrangeView } from './song/ArrangeView';
import { SongPage } from './song/SongPage';
import type { InputDeckDrumProps } from './useInputDeck';

// A React.memo result is an OBJECT with $$typeof === Symbol.for('react.memo')
// and the wrapped component on `.type` — NOT a function carrying `compare`,
// which is what a hasOwnProperty check would wrongly look for.
const REACT_MEMO = Symbol.for('react.memo');
type AnyProps = Record<string, unknown>;

/** Reached through `unknown` so this file compiles either way. */
function memoInner(component: unknown): ComponentType<AnyProps> {
  const w = component as { $$typeof?: symbol; type?: ComponentType<AnyProps> };
  expect(w.$$typeof).toBe(REACT_MEMO);
  if (!w.type) throw new Error('React.memo wrapper exposes no inner component');
  return w.type;
}

const noop = () => {};

const drumProps: InputDeckDrumProps = {
  pads: DEFAULT_PADS, activePadId: null, onTriggerPad: noop, onPadVolumeChange: noop,
};

const keyboardProps = {
  keyboardMode: 'scale-locked' as const, setKeyboardMode: noop,
  keyboardOctave: 0, setKeyboardOctave: noop,
  activeNotes: new Set<string>(), scaleRoot: 'C', scaleType: 'Major',
  scaleLockedRows: getScaleLockedKeyboardNotes('C', 'Major', 0),
  chordKeyboardRows: getChordKeyboardRows('C', 'Major', 0),
  handleNoteOn: noop, handleNoteOff: noop,
};

const CASES: Array<[string, unknown, AnyProps]> = [
  ['SynthView', SynthView, {}],
  ['SequencerView', SequencerView, { drumProps }],
  ['ArrangeView', ArrangeView, {}],
  ['BottomInputDock', BottomInputDock, { keyboardProps, drumProps }],
  ['LoopPage', LoopPage, { drumProps }],
  ['SongPage', SongPage, {}],
];

describe('App-level children are memoized, and memoizing changed no markup', () => {
  for (const [name, component, props] of CASES) {
    test(`${name} is a React.memo wrapper`, () => {
      expect(typeof memoInner(component)).toBe('function');
    });

    test(`${name} renders byte-identically through the wrapper`, () => {
      const outer = renderToString(createElement(component as ComponentType<AnyProps>, props));
      const inner = renderToString(createElement(memoInner(component), props));
      expect(outer.length).toBeGreaterThan(0);
      expect(outer).toBe(inner);
    });
  }
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `bun test src/components/appChildMemo.test.tsx`
Expected: FAIL — 12 failures, every one `expect(w.$$typeof).toBe(Symbol(react.memo))` receiving `undefined`.

- [ ] **Step 3: Wrap the three zero-prop components**

- `SynthView.tsx:68`: `export const SynthView = () => {` → `export const SynthView: React.FC = React.memo(() => {` (`React` is already the default import at `:1`).
- `ArrangeView.tsx:50`: `export const ArrangeView: React.FC = () => {` → `... = React.memo(() => {`.
- `SongPage.tsx:6`: `export const SongPage: React.FC = () => {` → `... = React.memo(() => {`.

In each, the file's last line `};` becomes `});`.

- [ ] **Step 4: Wrap the three prop-taking components**

`SequencerView.tsx:1` — add the default import: `import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";`. Then `:36`:

```tsx
export const SequencerView: React.FC<SequencerViewProps> = React.memo<SequencerViewProps>(({ drumProps: _drumProps }: SequencerViewProps = {}) => {
```

`LoopPage.tsx:12`:

```tsx
export const LoopPage: React.FC<LoopPageProps> = React.memo(({ drumProps }: LoopPageProps) => {
```

`BottomInputDock.tsx:36-39` — lift the inline type so the arrow can be annotated:

```tsx
interface BottomInputDockProps {
  keyboardProps: InputDeckKeyboardProps;
  drumProps: InputDeckDrumProps;
}

export const BottomInputDock: React.FC<BottomInputDockProps> = React.memo(({ keyboardProps, drumProps }: BottomInputDockProps) => {
```

In all three, the last line `};` becomes `});`.

- [ ] **Step 5: Re-run, confirm pass, then the gate**

Run: `bun test src/components/appChildMemo.test.tsx` → PASS 12/12. A failing `renders byte-identically` case means that component's render is non-deterministic (a `Math.random()`/`Date.now()` read during render) — a real bug to report, not a test to relax.
Then `bun test src/components`, `bun run lint`, `bun run check:theme`, `bun run verify` → all green. `bun run eslint` is not required: no import crosses a layer.

- [ ] **Step 6: Manual verification**

1. `bun run dev`, click once to init audio; React DevTools → Profiler → gear → "Record why each component rendered".
2. Record while dragging Filter Cutoff on the Synth tab for ~2 s. Expected: commits contain only `SynthView`'s knob subtree — `SongPage`, `ArrangeView`, `BottomInputDock` and `LoopPage` are absent (bailed out); before this task they reconciled on every App render.
3. Cycle Synth → Sequencer → Chords → Arrange → Master FX: nothing looks different and audio never drops.

- [ ] **Step 7: Commit**

```bash
git add src/components/loop/SynthView.tsx src/components/loop/SequencerView.tsx src/components/loop/LoopPage.tsx src/components/song/ArrangeView.tsx src/components/song/SongPage.tsx src/components/ui/BottomInputDock.tsx src/components/appChildMemo.test.tsx
git commit -m "perf(react): memoize the six App-level children

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 38: Stabilize `ArrangeView`'s `loopIds` against the mirrored-field write

Closes react-perf.md C2 fix (a) (`/tmp/solna-audit/react-perf.md:99-152`, fix at `:132-138`). Task 14 folds `loopSync`'s mirror into the field write and removes the second `setState`, but the surviving write is still `loops: s.loops.map(...)` (`src/store/loopSync.ts:24-26`) — a **new `loops` array identity on every mirrored field write**, i.e. every knob pointermove. So `const loopIds = useMemo(() => loops.map((l) => l.id), [loops]);` still recomputes into a fresh array at pointer rate, `@dnd-kit/sortable`'s `contextValue` (which lists `items` in its deps) still changes, and every `SortableLoopCard` still re-renders through context — straight past its `React.memo` at `SortableLoopCard.tsx:144`.

That line is `ArrangeView.tsx:94` today, but Task 23 replaces `:79-94` with a ~44-line block and leaves it as **the last line of that replacement block**, at roughly `:122`. Use the anchor string `const loopIds = useMemo(() => loops.map((l) => l.id), [loops]);`, not the number.

Fix: key the memo on the id **content**, via an exported pure helper testable in the repo's pure-logic style. Separator safety, verified by reading every id source: ids come only from `DEFAULT_LOOP_ID = 'loop-default-1'` (`loopSlice.ts:13`) and `newLoopId()` = `` `loop-${Date.now()}-${base36}` `` (`loop.ts:48`, also used by `migrate.ts:174`) — lowercase alphanumerics and `-`, never user input, never whitespace, so `'\n'` cannot occur inside an id.

**Files:**
- Create: `src/components/song/loopIdKey.ts`, `src/components/song/loopIdKey.test.ts`
- Modify: `src/components/song/ArrangeView.tsx` (imports; the `loopIds` anchor above)
- Modify (test): `src/components/song/ArrangeView.test.tsx` (append one describe)

**Interfaces:**
- Consumes: `loops` (already subscribed at `ArrangeView.tsx:51`).
- Produces: `loopIdKeyOf(loops: readonly { id: string }[]): string` and `loopIdsFromKey(key: string): string[]`. `SortableContext items={loopIds}` (`ArrangeView.tsx:189`) keeps the same contents in the same order.

- [ ] **Step 1: Write the ArrangeView pinning test, run it, confirm it PASSES (pre-change baseline)**

`ArrangeView.test.tsx` has no byte-identity assertion today (verified — it has `resetStore()` in `beforeEach`/`afterEach` and per-feature `renderToString` assertions), so add one that needs no stored baseline. Append:

```tsx
describe('a mirrored loopSync write changes nothing ArrangeView renders', () => {
  test('re-spreading every loop object leaves the markup identical', () => {
    const before = renderToString(<ArrangeView />);
    // Exactly what loopSync's `loops: s.loops.map(...)` produces: a new array
    // of new objects, same ids, same order.
    useAppStore.setState((s) => ({ loops: s.loops.map((r) => ({ ...r })) }));
    expect(renderToString(<ArrangeView />)).toBe(before);
  });
});
```

Run: `bun test src/components/song/ArrangeView.test.tsx -t "mirrored loopSync write"` → PASS. It pins the invariant this task leans on: the mirrored write is visually a no-op, so collapsing `loopIds` onto the id content cannot change what the user sees.

- [ ] **Step 2: Write the failing helper tests**

Create `src/components/song/loopIdKey.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { loopIdKeyOf, loopIdsFromKey } from './loopIdKey';

const loops = (...ids: string[]) => ids.map((id) => ({ id }));

describe('loopIdKeyOf / loopIdsFromKey', () => {
  test('round-trips any id list', () => {
    for (const ids of [[], ['loop-default-1'], ['a', 'b', 'c'], ['loop-1770000000000-x9k2']]) {
      expect(loopIdsFromKey(loopIdKeyOf(loops(...ids)))).toEqual(ids);
    }
  });

  test('is stable across structurally-equal but distinct arrays', () => {
    const a = loops('loop-default-1', 'loop-2', 'loop-3');
    const b = a.map((l) => ({ ...l })); // what loopSync writes on every field change
    expect(a).not.toBe(b);
    expect(loopIdKeyOf(b)).toBe(loopIdKeyOf(a));
  });

  test('changes on reorder, on add and on remove; empty is the empty key', () => {
    const base = loopIdKeyOf(loops('a', 'b', 'c'));
    expect(loopIdKeyOf(loops('a', 'c', 'b'))).not.toBe(base);
    expect(loopIdKeyOf(loops('a', 'b', 'c', 'd'))).not.toBe(base);
    expect(loopIdKeyOf(loops('a', 'c'))).not.toBe(base);
    expect(loopIdKeyOf([])).toBe('');
    expect(loopIdsFromKey('')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `bun test src/components/song/loopIdKey.test.ts`
Expected: FAIL — `Cannot find module './loopIdKey'`.

- [ ] **Step 4: Write the pure module**

Create `src/components/song/loopIdKey.ts`:

```ts
/**
 * A content key for a loop list's ids, and its inverse. loopSync rewrites the
 * whole `loops` array on every mirrored per-loop field write, so keying
 * ArrangeView's sortable id list on the array IDENTITY rebuilds it at pointer
 * rate — and dnd-kit then re-renders every card through context. Keying on the
 * id CONTENT means the list only changes when ordering or membership does.
 *
 * Separator safety: ids come only from DEFAULT_LOOP_ID ('loop-default-1',
 * store/loopSlice.ts:13) and newLoopId() (`loop-${Date.now()}-${base36}`,
 * store/loop.ts:48) — lowercase alphanumerics and '-', never user-authored, so
 * a newline cannot appear inside one.
 */
const SEPARATOR = '\n';

export function loopIdKeyOf(loops: readonly { id: string }[]): string {
  let key = '';
  for (let i = 0; i < loops.length; i++) {
    if (i > 0) key += SEPARATOR;
    key += loops[i].id;
  }
  return key;
}

export function loopIdsFromKey(key: string): string[] {
  return key === '' ? [] : key.split(SEPARATOR);
}
```

- [ ] **Step 5: Run the helper tests, confirm they pass**

Run: `bun test src/components/song/loopIdKey.test.ts` → PASS, 4/4.

- [ ] **Step 6: Wire it into `ArrangeView`**

Add `import { loopIdKeyOf, loopIdsFromKey } from './loopIdKey';` to the imports, then replace the anchor line with:

```ts
  // dnd-kit useMemo's `items` on the incoming array's IDENTITY and lists it in
  // contextValue's deps, so a fresh loopIds array re-renders every
  // SortableLoopCard through context — past its own React.memo. loopSync
  // writes a NEW loops array on every mirrored field write, so `[loops]`
  // rebuilt this list at pointer rate, on a hidden tab.
  const loopIdKey = loopIdKeyOf(loops);
  const loopIds = useMemo(() => loopIdsFromKey(loopIdKey), [loopIdKey]);
```

- [ ] **Step 7: Re-run the suites and type-check**

Run: `bun test src/components/song`, then `bun run lint`, then `bun run eslint` (imports changed).
Expected: green; the Step 1 pinning test still passes byte-identically.

- [ ] **Step 8: Manual verification**

1. `bun run dev`, click once to init audio, go to Arrange, add 4 loops. Drag one card onto another and drop: the reorder still works and survives a reload (it is persisted).
2. Switch to Synth, React DevTools → Profiler with "Record why each component rendered", record while dragging Filter Cutoff for ~2 s. Expected: no `SortableLoopCard` in any commit — before this task all 4 re-rendered per pointermove with the reason "Context changed".

- [ ] **Step 9: Commit**

```bash
git add src/components/song/loopIdKey.ts src/components/song/loopIdKey.test.ts src/components/song/ArrangeView.tsx src/components/song/ArrangeView.test.tsx
git commit -m "perf(song): key ArrangeView's sortable id list on loop id content

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 39: Move `HARD_STOP_RELEASE` to `playbackEngine.ts`

Closes simplify.md M2 (`/tmp/solna-audit/simplify.md:106-122`). `/** Short enough to read as an instant cut, long enough not to click. */` followed by `const HARD_STOP_RELEASE = 0.02;` is declared verbatim twice: `useChordPlayback.ts:47-48` and `useLeadPlayback.ts:17-18` (current numbers). Tasks 18, 19 and 20 all edit those two files first, so anchor on the string `const HARD_STOP_RELEASE = 0.02;` rather than the line. Both copies feed nothing but `playbackStopSource(<bus>, HARD_STOP_RELEASE)` (`useChordPlayback.ts:587-588`, `useLeadPlayback.ts:74`), and `playbackStopSource(source: string, releaseTime = 0.1, time?: number): void` is exported from `src/audio/playback/playbackEngine.ts:44-50` — that module already owns "release time on a hard stop".

Layering: `components/` → `audio/playback/` is legal; the eslint rule restricts only `components/` → `audio/engine` (three analyser-reading files are its exemptions), and both hooks already import from `playbackEngine`. Imports change, so **`bun run eslint` must be run separately** — `bun run verify` does not include it.

Verified by reading: `src/audio/playback/playbackEngine.test.ts` does **not** exist (the directory holds only `arpPlayback.test.ts`, `chordPlayback.test.ts`, `presetPreview.test.ts`) — it is a **Create**. Both hook test files exist and are pure-logic (`useChordPlayback.test.ts` imports `chordStepAction` etc.; `useLeadPlayback.test.ts` imports `leadStepAction`). Because the constant stays module-local in the hooks (imported, not re-exported), a test cannot compare references directly — so the divergence guard reads each hook's own source text and asserts no local declaration survives, while the value is pinned in `playbackEngine.test.ts`.

**Files:**
- Modify: `src/audio/playback/playbackEngine.ts:39` (add the export above `playbackStopSource`'s doc comment)
- Modify: `src/components/loop/chord/useChordPlayback.ts`, `src/components/loop/lead/useLeadPlayback.ts` (delete the local declaration, extend the existing `playbackEngine` import)
- Create: `src/audio/playback/playbackEngine.test.ts`
- Modify (test): `src/components/loop/chord/useChordPlayback.test.ts`, `src/components/loop/lead/useLeadPlayback.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const HARD_STOP_RELEASE = 0.02;` from `src/audio/playback/playbackEngine.ts`. No behaviour change — the same number reaches the same three `playbackStopSource` calls.

- [ ] **Step 1: Write all three tests**

Create `src/audio/playback/playbackEngine.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { HARD_STOP_RELEASE } from './playbackEngine';

describe('HARD_STOP_RELEASE', () => {
  test('is 20 ms — instant to the ear, long enough not to click', () => {
    expect(HARD_STOP_RELEASE).toBe(0.02);
  });

  test('is shorter than playbackStopSource\'s soft-stop default of 0.1 s', () => {
    expect(HARD_STOP_RELEASE).toBeLessThan(0.1);
  });
});
```

Append to `src/components/loop/chord/useChordPlayback.test.ts`:

```ts
describe('useChordPlayback shares the one HARD_STOP_RELEASE', () => {
  test('declares no local copy and still uses the shared constant', async () => {
    const source = await Bun.file(`${import.meta.dir}/useChordPlayback.ts`).text();
    expect(source).not.toMatch(/^const HARD_STOP_RELEASE/m);
    expect(source).toContain('HARD_STOP_RELEASE');
  });
});
```

Append the same block to `src/components/loop/lead/useLeadPlayback.test.ts` with `useLeadPlayback` substituted in both the filename and the describe title.

- [ ] **Step 2: Run all three, confirm they fail**

Run: `bun test src/audio/playback/playbackEngine.test.ts src/components/loop/chord/useChordPlayback.test.ts src/components/loop/lead/useLeadPlayback.test.ts`
Expected: FAIL — `playbackEngine.test.ts` cannot import `HARD_STOP_RELEASE`, and both source guards still match `^const HARD_STOP_RELEASE`.

- [ ] **Step 3: Export it from `playbackEngine.ts`**

Immediately above the `playbackStopSource` doc comment at `:39`:

```ts
/**
 * Release time for a HARD stop: short enough to read as an instant cut, long
 * enough not to click. Lives beside playbackStopSource, which owns the
 * semantics — it was declared verbatim in both note-based playback hooks, and
 * a tuning constant for an audible fade must not have two copies to drift.
 */
export const HARD_STOP_RELEASE = 0.02;
```

- [ ] **Step 4: Delete both locals and import instead**

In `src/components/loop/chord/useChordPlayback.ts`, delete the doc comment + `const HARD_STOP_RELEASE = 0.02;`, and add `HARD_STOP_RELEASE,` to the existing import so it reads:

```ts
import {
  HARD_STOP_RELEASE,
  initPlaybackEngine,
  playbackNoteOff,
  playbackNoteOn,
  playbackStopSource,
  subscribePlaybackClock,
} from "../../../audio/playback/playbackEngine";
```

Do the same in `src/components/loop/lead/useLeadPlayback.ts`, keeping that file's single-quoted specifier `'../../../audio/playback/playbackEngine'`.

- [ ] **Step 5: Re-run the three files, confirm they pass**

Run the Step 2 command again.
Expected: PASS — the two hook files at their pre-existing counts plus one test each.

- [ ] **Step 6: Type-check, lint the layering, run the gate**

Run: `bun run lint`, then `bun run eslint` (required — imports changed), then `bun run verify`.
Expected: all green; `components/` → `audio/playback/playbackEngine` is not on the restricted list.

- [ ] **Step 7: Manual verification**

1. `bun run dev`, click once to init audio. Chords tab: Play, let the progression run, then press Stop **twice** (the second press is the hard stop). Expected: chord and bass cut instantly, no click or pop.
2. Synth tab: draw a few notes in the lead piano roll, Play, then Stop twice. Expected: the lead cuts with the same instant-but-clickless character as before.

- [ ] **Step 8: Commit**

```bash
git add src/audio/playback/playbackEngine.ts src/audio/playback/playbackEngine.test.ts src/components/loop/chord/useChordPlayback.ts src/components/loop/chord/useChordPlayback.test.ts src/components/loop/lead/useLeadPlayback.ts src/components/loop/lead/useLeadPlayback.test.ts
git commit -m "refactor(playback): own HARD_STOP_RELEASE in playbackEngine

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 40: Remove the two remaining per-step allocations

Closes the two bullets of audio-perf.md M10 no other task covers: `/tmp/solna-audit/audio-perf.md:267-268` and `:273`. The other two are already banked — the `engine.ts:589` bass note-on map copy is Task 25, and `arpSchedule.ts` is Task 24, which also banked the I7 (GC-pause) half of M10's argument. **Task 15 reduces how often `reshapeableVoices` is called** (rAF-coalescing the store→engine bridge) but does nothing about the per-call allocation, so this is complementary, not redundant.

**(a)** `src/audio/playback/chordPlayback.ts:71-85` — `eventsForStep` does `.filter().map()`, two arrays, called twice per 16th step (chord + bass) for the whole session. A single `for` loop preserves the predicate (`ev.step === stepInBar && (isLastBar || !ev.lastBarOnly)`), the projection (`{noteName, velocity, timeOffset, hold}`, that key order) and the surviving events' order.

**(b)** `src/audio/engine.ts:1049-1067` — `reshapeableVoices()` allocates `out`, a `sets` array, and a throwaway `new Set<SynthVoice>()` on the named-source path, per call. **I read every caller before proposing the scratch array, and part (b) goes ahead.** There are exactly two: `applySynthVelocityScale` (`:917`) and `updateSynthParams` (`:1165`), both `for (const voice of this.reshapeableVoices(...))`. Neither retains the array past that synchronous loop, and neither is re-entered from inside it — the loop bodies call only `cancelAndHold`, `setTargetAtTime`, `updateVoiceNoise`, `updateVoiceLfo` and `releaseVoice`, none of which calls back into either method. Grep confirms the only external callers are `store/engineSync.ts:43-45,119`, `store/midiInput.ts:25-46` and `audio/playback/synthPlayback.ts:17` — sequential, never nested. The scratch is **instance-scoped**, so `makeEngine()`/`freshEngine()` test instances cannot share one, and the return type narrows to `readonly SynthVoice[]` so a future caller that retains or mutates it fails to compile.

**Files:**
- Modify: `src/audio/playback/chordPlayback.ts:71-85`, `src/audio/engine.ts:1041-1067`
- Modify (test): `src/audio/playback/chordPlayback.test.ts` (exists; already imports `eventsForStep` at `:12`), `src/audio/engine.test.ts` (append one describe)

**Interfaces:**
- Consumes: `BarInvariantEvent`/`StepEvent` (`chordPlayback.ts:24-34`), `freshEngine` + `fakeParam`'s recording API (`src/audio/testFakes.ts:19-102,178`).
- Produces: no new exports. `eventsForStep`'s signature is unchanged; `reshapeableVoices` is private and only narrows its return type.

- [ ] **Step 1: Write the pinning tests, run them, confirm they PASS (pre-change baseline)**

Append to `src/audio/playback/chordPlayback.test.ts`:

```ts
describe('eventsForStep output is unchanged by the single-pass rewrite', () => {
  const events: BarInvariantEvent[] = [
    { step: 0, noteName: 'C4', velocity: 0.8, timeOffset: 0, hold: 0.5 },
    { step: 0, noteName: 'E4', velocity: 0.7, timeOffset: 0.01, hold: 0.5 },
    { step: 4, noteName: 'G4', velocity: 0.6, timeOffset: 0, hold: 0.25 },
    { step: 4, noteName: 'B3', velocity: 0.5, timeOffset: 0, hold: 0.25, lastBarOnly: true },
    { step: 15, noteName: 'D4', velocity: 0.4, timeOffset: 0, hold: 0.1, lastBarOnly: true },
  ];

  // The old .filter().map(), kept verbatim as the oracle.
  const reference = (stepInBar: number, isLastBar: boolean) =>
    events
      .filter((ev) => ev.step === stepInBar && (isLastBar || !ev.lastBarOnly))
      .map(({ noteName, velocity, timeOffset, hold }) => ({ noteName, velocity, timeOffset, hold }));

  test('matches the reference across every step and both bar positions', () => {
    for (let step = 0; step < 16; step++) {
      for (const isLastBar of [false, true]) {
        expect(eventsForStep(events, step, isLastBar)).toEqual(reference(step, isLastBar));
      }
    }
  });

  test('returns a fresh array of fresh objects with exactly the four StepEvent keys', () => {
    const a = eventsForStep(events, 0, true);
    expect(a).not.toBe(eventsForStep(events, 0, true));
    expect(a[0]).not.toBe(events[0]);
    expect(Object.keys(a[0]).sort()).toEqual(['hold', 'noteName', 'timeOffset', 'velocity']);
    expect(eventsForStep([], 0, true)).toEqual([]);
  });
});
```

Append to `src/audio/engine.test.ts`:

```ts
describe('reshapeableVoices reuses one scratch array', () => {
  const visits = (v: any) => v.filter.Q.cancels.length;

  test('each call visits its own source exactly once, and no other', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;
    const t0 = ctx.currentTime;

    e.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    e.triggerSynthNoteOn('E4', SYNTH, 0.8, t0, 'chord');
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass');

    const a = e.activeVoices.get('chord:C4');
    const b = e.activeVoices.get('chord:E4');
    const bass = e.activeVoices.get('bass:C2');
    const base = [visits(a), visits(b), visits(bass)];

    engine.updateSynthParams(SYNTH, 'chord');
    expect([visits(a), visits(b), visits(bass)]).toEqual([base[0] + 1, base[1] + 1, base[2]]);

    // A call over a DIFFERENT source must not re-visit the first source's
    // voices — exactly what an uncleared scratch array would do.
    engine.updateSynthParams(SYNTH, 'bass');
    expect([visits(a), visits(b), visits(bass)]).toEqual([base[0] + 1, base[1] + 1, base[2] + 1]);

    // And the all-sources call visits each voice exactly once more.
    engine.updateSynthParams(SYNTH);
    expect([visits(a), visits(b), visits(bass)]).toEqual([base[0] + 2, base[1] + 2, base[2] + 2]);
  });

  test('two successive calls over the same voice set schedule identical automation', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'chord');
    const voice = e.activeVoices.get('chord:C4');

    engine.updateSynthParams(SYNTH, 'chord');
    engine.updateSynthParams(SYNTH, 'chord');

    const targets = voice.filter.frequency.targets;
    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect(targets.at(-1)).toEqual(targets.at(-2));
  });
});
```

Run: `bun test src/audio/playback/chordPlayback.test.ts -t "eventsForStep output"` and `bun test src/audio/engine.test.ts -t "reshapeableVoices reuses"`
Expected: both PASS. They pin *existing* behaviour before the refactor — that is the point. If either fails, fix the test, not the source.

- [ ] **Step 2: Rewrite `eventsForStep` as a single pass**

In `src/audio/playback/chordPlayback.ts`, keep the doc comment and replace the function with:

```ts
export function eventsForStep(
  events: BarInvariantEvent[],
  stepInBar: number,
  isLastBar: boolean,
): StepEvent[] {
  // One pass, one array. The old .filter().map() allocated two, and this runs
  // twice per 16th step (chord + bass) for the whole session.
  const out: StepEvent[] = [];
  for (const ev of events) {
    if (ev.step !== stepInBar) continue;
    if (!isLastBar && ev.lastBarOnly) continue;
    out.push({
      noteName: ev.noteName,
      velocity: ev.velocity,
      timeOffset: ev.timeOffset,
      hold: ev.hold,
    });
  }
  return out;
}
```

- [ ] **Step 3: Give `reshapeableVoices` an instance scratch array**

In `src/audio/engine.ts`, replace `reshapeableVoices` and its doc comment (`:1041-1067`) with:

```ts
  /**
   * Reused output buffer for reshapeableVoices. Instance-scoped, not
   * module-scoped, so the fake-context engines makeEngine()/freshEngine()
   * build in tests can never share one.
   */
  private readonly reshapeScratch: SynthVoice[] = [];

  /**
   * Every tracked voice of `source` (or all sources) that can be re-shaped
   * right now: it has started, and it is not already fading.
   *
   * Iterates sourceVoices, not activeVoices: activeVoices only keeps the
   * LATEST voice per note, so a still-sounding voice that a same-note retrigger
   * evicted would be skipped and left at the old level.
   *
   * The result is a CLEARED-AND-REFILLED scratch array, not a fresh one: this
   * runs on every updateSynthParams and every equal-power rebalance, i.e. at
   * knob-drag and note-on rate. Both callers consume it in one synchronous
   * for...of and neither is re-entered from inside that loop, so reuse is safe
   * — the `readonly` return type keeps it that way.
   */
  private reshapeableVoices(source?: string): readonly SynthVoice[] {
    const out = this.reshapeScratch;
    out.length = 0;
    if (!this.ctx) return out;
    const now = this.ctx.currentTime;
    if (source !== undefined) {
      this.collectReshapeable(this.sourceVoices.get(source), now, out);
    } else {
      for (const set of this.sourceVoices.values()) {
        this.collectReshapeable(set, now, out);
      }
    }
    return out;
  }

  /** Appends one source set's reshapeable voices to `out`. */
  private collectReshapeable(
    set: Set<SynthVoice> | undefined,
    now: number,
    out: SynthVoice[],
  ): void {
    if (!set) return;
    for (const voice of set) {
      // Voices scheduled ahead keep the envelopes they were planned with;
      // re-targeting them cancels their scheduled ramps, release included.
      if (voice.startTime > now) continue;
      // A voice already in its release tail keeps the ramp it was given.
      if (voice.releaseScheduledAt !== undefined && voice.releaseScheduledAt <= now) continue;
      out.push(voice);
    }
  }
```

- [ ] **Step 4: Re-run the pinned describes, then the full suites**

Run: `bun test src/audio/playback/chordPlayback.test.ts` then `bun test src/audio/engine.test.ts` → PASS, new tests plus every pre-existing one at the same counts.
Then `bun test src/audio src/components/loop/chord` and `bun run lint` → green. `bun run eslint` is **not** needed (no import changed).

- [ ] **Step 5: Manual verification**

1. `bun run dev`, click once to init audio. Chords tab: pick a busy rhythm pattern with approach-note bass and Play. Expected: progression, strums and bass approach notes sound exactly as before — approach notes still only on a chord's last bar.
2. Hold a chord and drag Filter Cutoff and Resonance for ~5 s while it rings: voices track the knobs smoothly, no clicks, no stuck voice.
3. Chrome DevTools → Performance, record 10 s of playback with a knob drag. Expected: the JS-heap sawtooth is flatter than the Task 1 baseline capture; no functional difference.

- [ ] **Step 6: Commit**

```bash
git add src/audio/playback/chordPlayback.ts src/audio/playback/chordPlayback.test.ts src/audio/engine.ts src/audio/engine.test.ts
git commit -m "perf(audio): drop the per-step eventsForStep and reshapeableVoices allocations

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

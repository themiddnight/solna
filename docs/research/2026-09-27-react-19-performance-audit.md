# React 19.2 performance audit of Solna

**Date:** 2026-09-27
**Scope:** current checkout, application UI, state bridges, audio visualization, initial bundle. This is an audit and research note; no runtime behavior was changed.
**Evidence level:** source inspection, production build, isolated benchmarks, and a repeated local Chrome CPU profile in the Vite development build. No production-browser/device measurement or React DevTools component-duration profile was captured, so source-level costs remain work performed rather than proven user-visible slowdowns.

## React behavior relevant to this app

The lockfile resolves `react` and `react-dom` to **19.2.8** (`bun.lock:1021-1023`). This is a client-rendered Vite application (`src/main.tsx`, `vite.config.ts`), so React Server Components and the server-only `cacheSignal` feature are not relevant to the current runtime. React renders function components after their own or ancestor updates, then commits only necessary DOM changes. A render can therefore consume CPU even when the DOM does not change. [React: Render and Commit](https://react.dev/learn/render-and-commit)

React 19.2 adds `<Activity>` and Performance Tracks. Hidden Activity preserves component state, cleans up Effects, and processes hidden updates at lower priority; it is **not** equivalent to the current CSS `hidden` wrappers, which keep Effects mounted. Activity also does not eliminate all hidden renders. React's Scheduler and Components tracks can reveal the update origin and component render time. [React 19.2 release](https://react.dev/blog/2025/10/01/react-19-2), [Activity reference](https://react.dev/reference/react/Activity), [Performance Tracks](https://react.dev/reference/dev-tools/react-performance-tracks)

React Compiler is optional and is **not configured here**: `vite.config.ts` calls `react()` with no compiler plugin and `package.json` does not include `babel-plugin-react-compiler`. React 19.2 by itself does not automatically memoize this code. Manual `memo`, `useMemo`, and `useCallback` remain meaningful, but React recommends profiling before adding them, and one newly allocated prop can defeat a `memo` boundary. [Compiler introduction](https://react.dev/learn/react-compiler/introduction), [memo reference](https://react.dev/reference/react/memo), [useCallback reference](https://react.dev/reference/react/useCallback)

Zustand subscriptions are external-store reads. React's `useSyncExternalStore` requires a stable snapshot and can restart non-blocking transition work as blocking when the store changes mid-transition. Therefore `startTransition` is not a blanket fix for the app's synchronous store updates; first reduce unnecessary writes and subscription scope. [useSyncExternalStore reference](https://react.dev/reference/react/useSyncExternalStore)

## Current baseline and existing safeguards

`bun run build` succeeded. Vite transformed 2,276 modules. The entry JS is **406.49 kB / 117.57 kB gzip**, but it is misleading to quote only that file: `dist/index.html` preloads six other JS chunks. Entry plus those preloaded chunks total approximately **977.08 kB raw / 291.95 kB gzip**. CSS is **263.55 kB / 40.49 kB gzip**. These are *asset sizes*, not download/parse/paint timings. The PWA reported 23 precache entries totalling 2,593.31 KiB. Preset drawers and vibe preview are already behind dynamic imports; their chunks are outside that initial JS sum. The HTML also loads Google Fonts CSS for Figtree and Anuphan (`index.html:59-61`).

Earlier performance work should not be re-reported as open defects. Playback controllers live outside the tab shell in `PlaybackHost`; playhead beats and steps are external publishers rather than Zustand fields; meters share one visibility-aware scheduler and suppress changes under 0.1 dB; visualizers pause when their tab is hidden; Synth, Beat, and Effects knobs preview locally and commit to the store at gesture end; the engine bridge coalesces patch pushes; several large grids and voice cards have effective memo boundaries. See `src/App.tsx`, `src/components/playbackStep.ts`, `src/utils/meterScheduler.ts`, `src/utils/meterLevel.ts`, `src/components/AudioVisualizer.tsx`, `src/components/loop/beat/BeatVoiceCard.tsx`, and the previous audit at `docs/superpowers/specs/2026-08-28-react-performance.md`.

## Findings, ordered by likely value

### Resolved P1 — MIDI activity made a global store write for every message

Before the local follow-up below, `src/store/midiInput.ts` called `triggerMidiActivity()` for each accepted message and the UI slice wrote a timestamp, notifying the whole Zustand store. This was resolved by moving the transient pulse to `src/store/midiActivity.ts`; see the benchmark and implementation notes below. Hardware MIDI was unavailable, so this finding was verified with the isolated dispatch benchmark rather than an end-to-end device stream.

### P1 — Pattern step subscriptions remain active on non-Pattern tabs

`useSegmentGatedStep` (`src/components/playbackStep.ts:210-245`) gates by `focusTrack`/Pattern segment, but explicitly does not inspect `activeTab`. Because `LayerPages`, `LoopPage`, and `PatternView` keep all views mounted (`src/components/shell/LayerPages.tsx`, `src/components/loop/LoopPage.tsx`, `src/components/loop/PatternView.tsx`), the focused Beat grid still receives roughly one update per 16th step while the user looks at Sound, Arrange, or Master. `SequencerGrid` passes that step into all eleven `TrackRow`s and their visible-window buttons (`src/components/loop/sequencer/SequencerGrid.tsx:50-81`). Lead/FX markers and custom-pattern playheads also remain subscribed on those tabs, although their leaves are much smaller.

**Recommendation:** gate *visual* subscriptions on both `activeTab === 'pattern'` and matching segment, while leaving `PlaybackHost` subscriptions untouched. Read the latest step when the tab returns. **Measure:** play Beat on Master for 30 seconds and count `SequencerGrid`/`TrackRow` commits before/after; verify step position on return and uninterrupted audio. This is the clearest hidden-work opportunity.

### P1 — Chord beat updates render the whole hidden ChordView

`useChordViewState` calls `usePlayheadBeat()` at its root (`src/components/loop/chord/useChordView.ts:54-58`), so every beat update re-renders `ChordView` (`src/components/loop/ChordView.tsx:134-184`) even when Accompaniment is not the visible Pattern segment or Pattern is not the active tab. That render walks hooks, builds `ProgressionCard`, `AccompanimentModules`, and the drawer element. The expensive chord-generation tables are correctly memoized, and `SortableChordCard` is memoized, so this is narrower than the old audit's original defect; the parent render and child reconciliation remain.

**Recommendation:** move the beat subscription into the visible progression/playhead leaf and gate it by tab plus segment. Keep chord audition and the audio player outside that visibility decision. **Measure:** compare `ChordView` and `ProgressionPlayhead` diagnostic render counts during playback on Accompaniment versus Master; verify the first displayed beat immediately after returning.

### P2 — First paint loads and mounts the full workstation

The current entry and preloads represent ~292 kB gzip of JS before adding CSS, and `LayerPages` mounts both layers, all four tab views, and all Pattern segments immediately. This buys scroll/local-state preservation but also allocates hidden component trees and runs their mount effects on first load. `PlaybackHost` is already independent of those views, making UI-on-demand possible in principle. Existing lazy preset libraries reduce only drawer code, not page/editor code. The build numbers confirm transfer/parse surface; whether this is a meaningful first-paint bottleneck needs a cold-load trace on a target phone.

**Recommendation:** profile cold start first. If initial JS evaluation or mount dominates, design a visited-tab cache: mount a view on first visit, retain it afterward, and keep playback controllers always mounted. Preserve the repo's R014 state-retention contract; any change to that architectural rule needs its rules file and ADR updated together. React 19.2 `<Activity>` may help prioritize hidden UI, but its Effect cleanup can stop subscriptions or gesture cleanup, so it needs a focused prototype and playback/overlay regression tests rather than a global replacement of `hidden`.

### P2 — Arrange progress still updates the entire sortable list

`useArrangePlayhead` correctly unsubscribes outside Arrange (`src/components/song/ArrangeView.tsx:128-155`). On Arrange, however, each step calls `setCurrentStep`; the view then rebuilds the `ArrangeLoopList` and maps **every** loop through `cardPlaybackProps`, `loopLabel`, and `SortableLoopCard` (`:476-567`, `:385-457`). `SortableLoopCard` can bail out for unchanged props, but the parent list and dnd-kit context still receive work at step cadence. This cost scales with the user's loop count.

**Recommendation:** give the active card a local step subscription or split its progress indicator into a self-subscribing leaf, leaving list ordering and drag context dependent only on structural loop changes. Keep the scroll-follow Effect keyed to playing loop identity, as it is now. **Measure:** profile a long arrangement at 120 BPM and compare list/card commits per step; test drag, loop switching, and progress reset.

### P2 — Beat preset equality serializes the whole patch during unrelated section renders

`BeatPresetToolbar` runs `isBeatPatchEdited` on each render (`src/components/loop/beat/BeatPresetToolbar.tsx:124-126`); that serializes the current eleven-voice patch and its base preset (`:24-27`). `BeatSoundSection` supplies committed `beatParams`, so the result cannot change during a local knob draft, but its parent re-renders on every draft frame (`src/components/loop/beat/BeatSoundSection.tsx:251-276`, `src/components/loop/beat/useBeatParamDraft.ts`). Thus an unchanged edited badge can repeat the full comparison throughout a drag. The select also filters the same `presets` array twice on each toolbar render (`BeatPresetToolbar.tsx:56-58`).

**Recommendation:** memoize the `edited` calculation by committed `params` and resolved `base` (or memoize the toolbar with stable props), and group the preset list when `presets` changes. Preserve structural comparison semantics; a stored boolean would go stale. **Measure:** profile a Beat knob drag and compare serialization count/toolbar commits before/after.

### P2 — Chord progression computes each start bar from the prefix again

`SortableProgression` (`src/components/loop/chord/ProgressionCard.tsx:279-313`) runs `chords.slice(0, idx).reduce(...)` for each card on every beat-driven render. This is O(number of chords squared) allocation/work even though the chord sequence rarely changes during playback. It also calls `beatsPerBarFor(meterId)` inside the map, although the value is shared by all cards. Individual chord cards can memo-bail, but these parent calculations occur before that bail.

**Recommendation:** derive start bars once when `chords` changes, and calculate beats-per-bar once outside the map. This is a small, deterministic improvement; it matters most when users have long progressions. **Measure:** React Profiler with a short and long progression, comparing progression-card render duration.

### P2 — The common knob and sequencer step use broad CSS transitions

`StepRow` applies `transition-all` to every step button (`src/components/ui/StepRow.tsx:90-112`), and `StepHeader` does likewise (`src/components/ui/StepHeader.tsx:43-62`). A Beat playhead changes active state every 16th step across eleven rows. Broad transitions let the browser animate properties beyond the intended highlight and can add style/paint work; whether that is significant here is unmeasured. The shared `Knob` creates several SVG child elements and derived values on every local preview (`src/components/ui/Knob.tsx:517-624`); this is expected work for the active control, so blanket `memo` on every knob is not justified without a profiler showing sibling churn.

**Recommendation:** constrain step transitions to the properties the design actually animates (or remove them from high-frequency playhead highlights) after a paint trace. Keep the shared knob as-is unless a concrete panel shows that unrelated knobs render on each drag.

### P3 — Two small per-event paths still cause avoidable UI churn

* `src/components/useInputDeck.ts:658-667` schedules one timeout per drum-pad hit to clear a single active-pad id. Rapid hits leave multiple timers that can clear the newest highlight early, and `useInputDeck` lives in `Workspace`, so each active-id change re-renders that root before memoized children bail. A cancellable/replaced timeout or a small pad-local publisher would make the pulse accurate and narrower. Profile only if pad playing is a target scenario.
* `src/components/loop/lead/useLeadGridModel.ts:49` computes `loopBars(s.chords)` in a Zustand selector for both mounted Lead and FX grids on **every** store write. It returns a primitive, so unrelated writes do not re-render either grid; the repeated reduction is limited to the number of chords. It could move to a memoized derivation keyed by `chords` if store-write frequency rises again, but this is low priority under the current draft/commit path.

### P3 — Cold-load fonts need measurement, not an automatic removal

`index.html:59-61` adds a third-party Google Fonts stylesheet for two variable families. It is in the document head and affects cold startup and offline fallback. The PWA has explicit font caching in `vite.config.ts`, which helps subsequent loads; the current build does not quantify first-load font request time. **Recommendation:** record a cold mobile network waterfall and compare first contentful paint with cached and uncached fonts before changing the typography strategy.

## Coverage notes and non-findings

| Area inspected | Current assessment |
|---|---|
| Root, desktop/mobile shells, layer/tab gates | Stable memoized shell children; intentional persistent mounts are the startup trade-off above. Switching layouts remounts the shell by design. |
| Playback host, beat/step publishers | Audio scheduling is separate from view mounting. Visual subscriptions have the two visibility gaps above. |
| Lead/FX grids | Matrix and headers are memoized; marker is a small subscriber. No basis for virtualizing the fixed-size grid before profiling. |
| Beat editor and sequencer | Per-voice comparator skips untouched voice cards during draft edits; step ticks still legitimately update the eleven visible rows. Preset toolbar equality and inactive-tab ticks are actionable. |
| Chord/bass/pad panels | Expensive chord derivations are memoized. Custom span timelines isolate playhead rendering from their cell grids; their fresh edit callbacks are a possible memo opportunity only if a profiler finds panel churn. |
| Arrange and sortable cards | Drag list structure is stable across loop-field writes, but step progress still reaches the list. |
| Master FX, visualizer, meters | Knob draft/commit, paused rAF, shared meter scheduler, visibility observer, 0.1 dB emission dead zone, and master/track tick tiers are already present. No new defect established here. |
| Project, presets, export, persistence | Preset drawers and diagnostics are split; autosave and local persistence coalesce writes. Export is a user-started job, not a per-frame React path. |
| Tiny shared UI primitives | Most have no state or subscriptions. `StepRow`/`StepHeader`, `MidiIndicator`, and drum-pad highlight were the notable small paths. |

## Suggested measurement sequence

1. Use the existing development-only **Project → Diagnostics** recorder (`docs/ios-pwa-performance-capture.md`) for 30-second identical scenarios: idle, Beat on Pattern, Beat on Master, Chords on Accompaniment, long Arrange playback, Beat knob drag, and MIDI CC sweep. Record store writes, `ChordView`/`ProgressionPlayhead` render counts, frame gaps, long tasks, DOM count, and recorder overhead. This recorder does **not** measure all component durations.
2. Use React 19.2 Performance Tracks in Chrome or React DevTools Profiler for short targeted captures of those scenarios. Compare component render counts and actual durations; distinguish React render time from browser layout/paint and audio scheduler time. [Performance Tracks](https://react.dev/reference/dev-tools/react-performance-tracks), [Profiler](https://react.dev/reference/react/Profiler)
3. Use a production cold-load network/CPU trace on a mid-range phone for initial chunk parse/evaluation, mount work, CSS/font fetches, and first interaction. Compare warm PWA loads separately; do not infer startup speed from gzip size alone.
4. Implement the P1 changes one at a time, preserving the audio/state-retention contracts. Re-run the same scenarios and the repository completion gate (`bun run verify`) before declaring a win.

**Priority interpretation:** P1 = clear, repeated unnecessary work with broad fan-out or a large hidden grid; P2 = repeated work that scales with UI size or patch size, pending profiler confirmation of user impact; P3 = small or situational improvement.

## Local follow-up: MIDI activity fan-out

Moved transient MIDI activity out of Zustand into `src/store/midiActivity.ts`. The indicator now subscribes with React's `useSyncExternalStore`; repeated events during the 250 ms active window only notify React on the inactive→active and active→inactive transitions. This preserves the indicator's visible timing while preventing each incoming message from notifying every Zustand subscriber.

**Repeatable dispatch benchmark:** seven runs of 100,000 calls to the existing `triggerMidiActivity()` action, timed with `performance.now()` under Bun, using the same script before and after. Before: median 2,536 ms and 700,000 Zustand notifications across all runs. After: median 13.2 ms and zero Zustand notifications. That's about 192× faster for this isolated store dispatch workload. The external-store unit test separately confirms two notifications for a burst (start and expiry).

This benchmark measures the store action path, not Web MIDI decoding or full-app frame rate. It establishes that broad Zustand fan-out was removed. No physical MIDI device was available for an end-to-end CC stream.

## Local follow-up: chord progression start bars

`SortableProgression` previously recomputed each chord's start bar with a fresh prefix `slice().reduce()` on every playhead-driven render. It now derives all start bars in one forward pass and calculates `beatsPerBar` once per render instead of once per card. The output preserves the previous one-based start-bar rules, including the fallback for a zero or missing bar count.

**Repeatable microbenchmark:** 2,000 derivations over 256 chords using the old prefix calculation versus the new helper. Results were identical; the old calculation took 152.2 ms and the linear helper 3.4 ms in this run (about 44× faster for this calculation). The real default progression is much shorter, so this synthetic result demonstrates the scaling improvement, not an end-user frame-rate gain. A React/browser profile with longer progressions is still needed to quantify that impact.

## Local browser profiling and functional smoke test

Captured three 5-second transport-playback profiles in a temporary Chrome profile for each state, alternating Pattern visible and Sound visible with Pattern retained but hidden. Across the three runs, median Chrome `TaskDuration` was 0.841 s for Pattern and 0.828 s for Sound; median `ScriptDuration` was 0.612 s and 0.619 s, respectively. These aggregate main-thread metrics are close in this workload and do not show a material cost from the hidden Pattern view. They are not React component timings, and the temporary profile was running Vite development code; do not generalize them to production or other devices. This is not evidence to change the repository's always-mounted view contract.

Browser smoke-tested the Lead and FX note grids, Beat preset/random/clear controls, chord progression edits, Arrange loop create/duplicate/reorder/rename/delete and repeat/mute controls, Sound mode/library/MIDI settings, Master FX toggles/EQ/visualizer, and transport playback. Temporary test notes and loops were removed; the app returned to one `untitled-1` loop with the Lead grid empty. No user A/B study was run. Export UI was not submitted to avoid creating downloads; its offline exporters are covered by repository tests.

**Verification:** `bun run verify` passed after these follow-ups (5,722 tests, TypeScript, ESLint with no errors or warnings, domain checks, both Knip scans, and production build); `git diff --check` passed.

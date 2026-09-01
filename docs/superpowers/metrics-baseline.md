# murva restructure — metrics

## Baseline (recorded before Task 2, 2026-08-24)
- Duplication % (jscpd, min-lines 5): 7.11%
- Total LOC (src, .ts + .tsx): 17742
- files-touched-per-feature (git log): recorded in Task 18

## After (recorded in Task 18)
- Duplication % (jscpd, min-lines 5): 6.92% (1272 duplicated lines of 18,377 analyzed lines, 51 clones)
- Total LOC (src, .ts + .tsx, wc -l): 18352
- files-touched-per-feature (git log): 6.47 files/commit avg (123 files touched across 19 restructure feature commits, be67859..3e08e3a; computed by summing `git show --stat` "N files changed" per commit, excluding the docs-only and metrics commits e4baa2e, 54ecc09, e84a168, 1b1255d)

Note: jscpd's analyzed-line count (18,377) differs from wc -l (18,352); baseline showed the same pattern (17,776 vs 17,742). Percentages are jscpd's own (duplicated lines / analyzed lines).

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

Matches the brief's quoted build output exactly (chunk hashes and sizes unchanged since the brief was written).

### Tests
- 1230 pass / 0 fail, 1580 ms (1.58 s)
- 539260 expect() calls across 92 files

(Brief quoted 1.56 s; re-run on this branch tip measured 1.58 s — pass/fail counts and expect() calls are identical. Within normal run-to-run jitter for `bun test`.)

### DevTools — 5 s filter-cutoff knob drag, chords playing
(Synth tab, Pro Mode, chord player running, `#slider-filter-cutoff`)
- Scripting: 762.13 ms
- Longest task: 54.76 ms
- Layout count: 165
- Long-task marker present: yes

Methodology note: driven headlessly via Chrome DevTools MCP against `bunx vite preview --port 4173`, not the interactive DevTools UI. Pro Mode + chord playback were enabled via `evaluate_script` DOM calls (clicking the "Pro" mode button and the Chords/Bass transport's Play button), then a `PointerEvent` sequence (`pointerdown` → ~165 `pointermove` steps on a 1 Hz sine sweep over `#slider-filter-cutoff` → `pointerup`) simulated the 5 s continuous drag. `performance_start_trace`/`performance_stop_trace` recorded the raw trace to JSON, which was then parsed offline: events were restricted to the main `CrRendererMain` thread, a stack-based self-time decomposition was computed from each event's `ts`/`dur` (self = own duration minus the sum of directly-nested children), and: **Scripting** = sum of self-time for events named `FunctionCall`, `EvaluateScript`, `EvaluateModule`, `v8.callFunction`, `V8.Execute`, `EventDispatch`, `RunMicrotasks`, `RequestAnimationFrame`, `FireAnimationFrame`, `CancelAnimationFrame`, `TimerFire`, `TimerInstall`, `TimerRemove`, `RequestIdleCallback`, `FireIdleCallback`, `CancelIdleCallback`, `V8.Compile*`, `WebSocketCreate`, `EmbedderCallback`; **Longest task** = the largest-duration top-level `RunTask` event (matches the browser Long Task definition and the >50 ms marker check below), reported as total duration, not self time; **Layout count** = count of `Layout`-named events; **Long-task marker** = whether any `RunTask` exceeded 50 ms. The recorded trace window was ~13.8 s rather than exactly 5 s — MCP tool round-trip latency between the drag script finishing and `performance_stop_trace` being called added idle time before/after the gesture, which is included in the totals above (idle time contributes negligible extra scripting/layout, since it's mostly animation-frame and audio-graph housekeeping, but it means these are not a pure isolated 5 s slice). Task 36 should use the same script-driven methodology for a fair diff, and ideally call `performance_stop_trace` immediately after the drag promise resolves to tighten the window.

### DevTools — 30 s idle playback on Master FX
(Play All, then switch to the Master FX tab, untouched)
- Scripting: 2009.62 ms
- Longest task: 30.88 ms
- Layout count: 21
- Long-task marker present: no

Methodology note: same script-driven approach and same trace-parsing method as above. "Play All" was triggered via `document.getElementById('btn-bottom-transport').click()` (confirmed by the button's title flipping to "Stop"), then the Song layer's Master Effects Rack tab was opened via `document.getElementById('tab-effects').click()` (`VIEW_META['effects']`, rendered by `SongPage`/`EffectsRackView`), then the trace was recorded for a real-time wait of ~30 s (actual captured window ~41.8 s, again inflated by tool round-trip latency around the wait, not by any user action). No `RunTask` exceeded 50 ms in this window.

## After (recorded in Task 36, branch perf/audit-2026-08-31)

Build served with `bun run build && bunx vite preview --port 4173`, same as Task 1. All 39 prior tasks landed; base of this measurement is the branch tip (d24ec28 at build time).

### Bundle

| chunk | before (raw/gzip) | after (raw/gzip) | delta |
|---|---|---|---|
| index-*.js | 304.90 kB / 80.73 kB | 211.75 kB / 56.36 kB | -93.15 kB / -24.37 kB |
| vendor-*.js | 178.64 kB / 56.45 kB | 178.64 kB / 56.45 kB | 0 / 0 (byte-identical, same hash) |
| dndkit-*.js | 55.19 kB / 18.19 kB | 55.19 kB / 18.19 kB | 0 / 0 (byte-identical, same hash) |
| tonal-*.js | 23.56 kB / 8.47 kB | 23.56 kB / 8.47 kB | 0 / 0 (byte-identical, same hash) |
| PresetLibrary-*.js | 13.07 kB / 3.55 kB | 13.07 kB / 3.55 kB | 0 / 0 (hash changed, size unchanged) |
| icons-*.js | 10.43 kB / 4.00 kB | 10.43 kB / 4.00 kB | 0 / 0 (byte-identical, same hash) |
| ChordPresetLibrary-*.js | 10.15 kB / 3.21 kB | 10.20 kB / 3.23 kB | +0.05 kB / +0.02 kB |
| SynthPresetLibrary-*.js | 7.57 kB / 2.92 kB | 7.62 kB / 2.94 kB | +0.05 kB / +0.02 kB |
| rolldown-runtime-*.js | 0.58 kB / 0.36 kB | 0.58 kB / 0.36 kB | 0 / 0 (byte-identical, same hash) |
| (new) synthPresets-*.js | — | 89.01 kB / 25.00 kB | +89.01 kB / +25.00 kB (new chunk, **still `modulepreload`ed / first-paint** — see structural note below) |
| (new) instantVibes-*.js | — | 14.73 kB / 3.72 kB | +14.73 kB / +3.72 kB (new chunk, lazy — not modulepreloaded) |
| (new) vibeActions-*.js | — | 3.33 kB / 1.43 kB | +3.33 kB / +1.43 kB (new chunk, lazy — not modulepreloaded) |
| **ALL JS** | **604.09 kB** / **177.88 kB** | **618.11 kB** / **183.70 kB** | **+14.02 kB** / **+5.82 kB** |
| **FIRST-PAINT JS** (rolldown-runtime + vendor + tonal + dndkit + synthPresets + icons + index) | **573.30 kB** / **168.20 kB** | **569.16 kB** / **168.83 kB** | **-4.14 kB** / **+0.63 kB** |
| CSS | 173.95 kB / 26.74 kB | 176.13 kB / 27.44 kB | +2.18 kB / +0.70 kB |

Structural note (per the controller's resolution #5): a later task deferred the Instant Vibes data behind a dynamic import, splitting `vibeActions` and `instantVibes` into their own lazy chunks. As a side effect, the bundler hoisted `synthPresets` (previously inlined into `index-*.js`) into its own chunk — but `index.html`'s `modulepreload` list still includes it (confirmed directly: `grep modulepreload dist/index.html` lists `rolldown-runtime`, `dndkit`, `vendor`, `tonal`, `synthPresets`, `icons` — six chunks, matching the six summed into FIRST-PAINT JS above alongside `index-*.js` itself). So the eye-catching `index-*.js` shrink (-93.15 kB raw / -24.37 kB gzip) is **not** a real first-paint win — most of it (89.01 kB / 25.00 kB) simply relocated into `synthPresets-*.js`, which still loads before paint. The honest comparison is the FIRST-PAINT JS row: raw is marginally down (-4.14 kB, ~0.7%) and gzip is marginally *up* (+0.63 kB, ~0.4%) — first-paint JS is flat within noise, not meaningfully reduced. ALL JS grew by +14.02 kB raw / +5.82 kB gzip (~2.3% / ~3.3%), consistent with the brief's own expectation that the all-JS total would be "roughly flat" once the three new lazy/relocated chunks are accounted for.

### Tests
- 1498 pass / 0 fail, 2420 ms (2.42 s) (baseline: 1230 pass / 0 fail / 1580 ms)
- 543610 expect() calls across 110 files (baseline: 539260 across 92)

Pass count is up by 268 (Tasks 24-33's ~60-test estimate undershoots the actual addition; 18 new test files landed, not all attributable to those tasks alone). Runtime grew from 1.58 s to 2.42 s — a **+53% increase**, well past the brief's ~20% flag threshold. Investigated by timing each of the 18 newly-added test files individually (`git diff --name-only --diff-filter=A b9996ba HEAD -- '*.test.ts' '*.test.tsx'`): the single largest contributor is `src/components/appChildMemo.test.tsx` at 136 ms standalone, followed by `src/components/loop/synth/synthPanels.test.tsx` (73 ms) and `src/components/loop/chord/modulePanels.test.tsx` (69 ms) — all three render real component trees via `renderToString` rather than testing pure functions, which is markedly more expensive than the rest of the suite's unit tests (most new files ran in 7-35 ms standalone). These three alone account for roughly a third of the per-file time measured across all 18 additions (278 ms of ~534 ms summed). No individual file's growth looks anomalous or bug-like; the increase is the expected cost of exercising more render paths, concentrated in a few render-heavy files.

### DevTools — 5 s filter-cutoff knob drag, chords playing
(Synth tab, Pro Mode, chord player running, `#slider-filter-cutoff`, driven via the same `PointerEvent` pointerdown/pointermove×N/pointerup sequence and the same trace-JSON self-time-decomposition script as Task 1)
- Scripting: 1391.01 ms (baseline 762.13 ms) — **up, the wrong direction**
- Longest task: 23.36 ms (baseline 54.76 ms) — down; no task in this run exceeded 50 ms
- Layout count: 299 (baseline 165) — **up, the wrong direction**
- Long-task marker present: no (baseline: yes)

Captured window: 14.545 s (main-thread event span), of which the in-page gesture itself measured exactly 5.005 s via `performance.now()` — the remaining ~9.5 s is MCP round-trip idle padding either side of the drag, the same effect Task 1 documented (its window was ~13.8 s against the same 5 s intended gesture). Attempts used: 1 of 3 (succeeded on the first try).

**Correction (fix round 1, 2026-09-01): the regression is an artefact of event count, not per-unit cost, and the prefetch hypothesis below is withdrawn.** The driving script paced `pointermove` dispatch off `requestAnimationFrame` and logged the actual count: **300 moves in 5.005 s** (~60 Hz), against Task 1's documented "~165 `pointermove`" (~33 Hz) — Task 1's loop was paced on a fixed timestep, not rAF, so the two runs processed a different number of input events for the same 5 s window. The event-count ratio (300/165 = 1.818) is close to both the Scripting ratio (1391.01/762.13 = 1.825) and the Layout ratio (299/165 = 1.812), and Scripting-per-layout is flat between runs: baseline 762.13 ms / 165 layouts = **4.619 ms/layout**; after 1391.01 ms / 299 layouts = **4.652 ms/layout**, a +0.72% difference — noise, not a regression. `Knob.tsx:304-317` calls `onChange` synchronously per `pointermove`, so Layout count tracks processed pointer events near 1:1 (confirmed exactly by the baseline's 165 moves producing 165 layouts); 299 ≈ 60 fps × 5 s, meaning this run was frame-rate-bound where the baseline was input-bound at ~33 Hz. Scripting and Layout both scaled by the same ~1.8x factor because there was ~1.8x more input to process, not because the same input got more expensive to handle.

The idle-`requestIdleCallback` Instant Vibes prefetch, floated in the original write-up as a possible explanation for the Scripting/Layout rise, is withdrawn: it is scheduled at `InstantVibesBar.tsx:82-91` with a `{timeout: 2000}` ceiling from page load, so on this 4173-port load it fires within ~2 s of mount — before the trace (started after two MCP round-trips) even began recording. It also pulls only `instantVibes` (14.73 kB) + `vibeActions` (3.33 kB) ≈ 18 kB of module evaluation, which cannot produce +628.88 ms of Scripting and produces no `Layout` events by itself. The per-layout arithmetic above fully accounts for the difference without it.

**Re-run not performed.** The brief called for re-running Gesture 1 alone with the drag pinned to Task 1's exact ~165-move, 5 s parameters to confirm the per-layout figures hold under matched input. The Chrome DevTools MCP server disconnected after this task's original Gesture 2 run and did not reconnect within this session (confirmed unavailable, not merely idle) — per the controller's instruction, no substitute measurement method was used; the re-run is recorded as not performed, for this reason, rather than attempted with different tooling.

### DevTools — 30 s idle playback on Master FX
(Play All from the Song layer, then `#tab-effects`, untouched, same trace-JSON methodology)
- Scripting: 1677.05 ms (baseline 2009.62 ms) — down, the right direction
- Longest task: 34.55 ms (baseline 30.88 ms) — up slightly, but still short of the 50 ms long-task threshold in both runs
- Layout count: 21 (baseline 21) — unchanged
- Long-task marker present: no (baseline: no)

Captured window: 40.334 s against an in-page-measured 30.002 s wait (`performance.now()` before/after `setTimeout`) — ~10.3 s of the same round-trip padding, comparable to Task 1's ~41.8 s window against the same intended 30 s. Attempts used: 1 of 3 (succeeded on the first try; the Chrome DevTools MCP connection dropped immediately after `performance_stop_trace` returned, but the trace file itself was already written and verified intact before the connection was lost — no retry was needed). rAF callback count and audible-dropout were not instrumented in this run (the brief's Step 6 asks for them in addition to the four DevTools numbers, but the trace-JSON parsing script built for parity with Task 1's methodology extracts only Scripting/Longest-task/Layout/long-task-marker; adding an rAF counter or an audio-dropout detector would have been a different, unreplicated method, which the controller's resolution #1 rules out). Layout count matching the baseline exactly (21 vs 21) is a useful cross-check that the trace-parsing methodology reproduced consistently between the two sessions.

### Success criteria
- **First-paint JS reduced**: NOT MET — FIRST-PAINT JS is flat within noise (raw -4.14 kB / ~0.7% down, gzip +0.63 kB / ~0.4% up); the apparent `index-*.js` shrink is a relocation into the still-first-paint `synthPresets-*.js` chunk, not a real reduction (see Bundle structural note).
- **ALL JS roughly flat**: MET — +14.02 kB raw (~2.3%) / +5.82 kB gzip (~3.3%), within the brief's own "roughly flat" expectation once new lazy/relocated chunks are accounted for.
- **`synthPresets.ts` and `chordProgressions.ts` off the first-paint path**: NOT MET. `synthPresets` now has its own chunk but that chunk is still `modulepreload`ed (confirmed in `dist/index.html`); `chordProgressions` remains inside `index-*.js`. `SynthView.tsx`, `ChordView.tsx` and `presetPreview.ts` still import both eagerly, and all four tabs stay mounted by design — unchanged from Task 30's finding that `js-perf.md` finding #2 was wrong to imply this was actionable.
- **`@dnd-kit` off the first-paint path**: NOT MET. `dndkit-*.js` (55.19 kB / 18.19 kB gzip) is still `modulepreload`ed and byte-identical to the baseline chunk — the mount-everything constraint (`js-perf.md` finding #4) was never actionable within this branch's scope.
- **Test suite green with more coverage**: MET — 1498 pass / 0 fail (+268 vs baseline), 543610 expect() calls across 110 files (+18 files). Runtime grew +53%, past the brief's ~20% flag; attributed above to three new render-heavy test files, not a hang or a bug.
- **`bun run verify` and `bun run eslint` clean**: MET — verify passes end-to-end; eslint reports zero errors, one pre-existing `SortableLoopCard` complexity warning (unchanged from Task 1's baseline eslint run, no new findings).
- **`bun run check:theme` passes with empty `ALLOWLIST`**: MET — confirmed both by the check itself and by re-reading `scripts/themeTokenGuard.ts:106`.
- **Gesture 1 (filter-cutoff drag) main-thread cost**: NOT MEASURABLE BY THIS PROTOCOL as a MET/NOT MET call on Scripting/Layout — the two runs drove a different number of input events (300 rAF-paced moves vs Task 1's ~165 fixed-timestep moves), so their totals are not comparable; Scripting-per-layout is flat (4.619 ms baseline vs 4.652 ms after, +0.72%), meaning per-unit main-thread cost did not regress. The headline result is the **longest task dropping from 54.76 ms to 23.36 ms** (below the browser's 50 ms long-task threshold, vs baseline which crossed it) while processing ~1.8x more events — a stronger win than a flat or improved figure would read as, since it held up under more load, not less.
- **Gesture 2 (30 s idle playback) main-thread cost reduced**: MET on Scripting (-332.57 ms / -17%) and flat on Layout (21 vs 21, unchanged); Longest task moved slightly up (+3.67 ms) but stayed well clear of the long-task threshold in both runs.

# Calibration harness (DEV-311)

Regenerates `src/engine/instruments/shared/calibration/trimTable.data.ts` — the committed,
measured pre-gain defaults every instrument ships with, so a new user's instruments all land
near −18 dBFS at velocity 127 without ever opening Instrument Settings (epic AC#1).

## When to re-run

- A soundfont/sample asset changed for any instrument.
- An instrument's envelope/ADSR or other loudness-affecting default changed.
- A new instrument was added to any category constants file.
- The fast locking test (`trimTable.lock.test.ts`) fails in CI — it means one of the above
  happened without a re-run.

## How to re-run

1. `cd app/frontend && bun run dev` (leave running in one terminal).
2. In another terminal: `bun run calibration:generate`. Full catalog is ~180 instruments; expect
   several minutes even on a fast machine (each instrument does a real
   `OfflineAudioContext` render + an `ffmpeg` pass). The table is written to disk after every
   instrument, so an interrupted run loses at most the in-flight one, not the whole batch — just
   re-run to pick up where the committed file left off (already-measured entries are
   overwritten with fresh data, not skipped, since a re-run means something may have changed).
3. Review console output for flagged instruments (trim outside the pre-gain range,
   `INSTRUMENT_GAIN_MIN_DB`..`INSTRUMENT_GAIN_MAX_DB`) — investigate each, do not ship a flagged
   run unreviewed. It means either a genuine outlier (a very quiet sample needing more than the
   range provides — a real product decision, possibly its own follow-up issue) or a harness bug
   (wrong pattern family, provider failed to actually play notes, silent WAV — see "Known
   pitfalls" below for what that usually turns out to be).
4. `git diff` the resulting `trimTable.data.ts` — confirm only the expected instruments moved.
5. By-ear spot check a few changed instruments (see the epic DoD's by-ear A/B sweep).
6. Commit.

## Architecture

Two stages:

1. **Render** — a dev-only route (`/dev/calibration-harness`, `CalibrationHarnessPage.tsx`)
   drives a real `OfflineAudioContext` through the actual instrument engine (sample providers via
   `InstrumentProvider`, synths via `OfflineSynthEngine`), publishing the result as a base64 WAV
   on `window.calibrationResult`. Driven by Playwright
   (`renderInstrumentOffline.ts`/`createCalibrationRenderSession`) — the batch orchestrator
   (`generateTrimTable.ts`) reuses one Chromium instance across the whole catalog rather than
   launching a fresh browser per instrument, since a cold launch dominates per-instrument cost at
   this scale.
2. **Measure** — `measureLoudness.ts` shells out to ffmpeg's `ebur128` filter for short-term
   LUFS, per the spec's explicit recommendation over integrated/whole-clip loudness.

See DEV-311's plan (`docs/superpowers/plans/2026-08-03-dev311-phase7-calibration-defaults.md`)
for the full rationale, including why this does **not** share code with the live in-browser
auto-trim (DEV-312) despite the spec originally suggesting they would (offline LUFS via ffmpeg
vs. live peak-based measurement — two different measurement algorithms sharing only the same
target level).

## Known pitfalls (all fixed once, but worth knowing if a re-run ever regresses)

- **StrictMode double-render**: `CalibrationHarnessPage`'s render effect must genuinely run only
  once per page load. A cancellation guard that merely discards a stale *result* is not enough —
  `SynthEngine.load()` calls Tone.js's process-global `setContext()`, so two concurrent
  invocations race on which `OfflineAudioContext` is "current" mid-render and silently corrupt
  each other's node graph (every synth measured as digital silence until this was fixed).
- **`InstrumentProvider.stop(note, time)` dropping `time`**: during offline scheduling every
  `play`/`stop` call happens synchronously *before* `startRendering()`, so `context.currentTime`
  is always 0 at that point. A `stop()` implementation that ignores its `time` argument and
  defaults to "stop now" cuts every note to zero length before it ever sounds. (Was true for the
  two Versilian-backed providers; `smplrStopTarget` already handled it correctly for the smplr
  soundfont/drum-machine providers.)
- **EBU R128's 3-second gate**: `ebur128`'s short-term (`S:`) reading is a rolling 3-second
  window — ffmpeg reports a fixed ~−120.7 LUFS sentinel for every frame until 3s of audio has
  accumulated, regardless of actual signal level. A calibration pattern shorter than 3s produces
  zero valid readings, full stop. Every pattern fixture must render for at least ~4s.
- **Percussion sets have no notes in common**: each percussion set's `gmNoteToRegion` is an
  independent, mostly non-GM mapping (congas use GM 60-64, world hand drums an extended 90-94
  block, orchestral 100-113, etc.) — a single fixed pattern only ever hits whichever set happens
  to share its notes, rendering silence for every other one. Percussion-category instruments
  build their calibration pattern from their own set's actual pads instead
  (`fixtures/buildPercussionSetPattern.ts`) rather than sharing `PERCUSSIVE_PATTERN`.
- **A "no valid LUFS readings" failure isn't always a pattern/duration problem** — it can mean
  the instrument is genuinely silent in production, not just in the harness. Found via 3 DrumAbuse
  machines (`korg-kr-55`, `korg-kpr-77`, `ace-tone-rhythm-ace-fr-1`, DEV-321): smplr always
  requests a sample's manifest-declared extension verbatim, but 2 machines' real CDN files used a
  different case (`.WAV` vs `.wav`, GitHub Pages is case-sensitive → 404 for every note), and the
  third's default sample set was `.aif`, which Chromium's `decodeAudioData` can't decode at all
  (confirmed via `ffprobe` — a valid PCM file, just an unsupported container, not corrupt data).
  Before assuming a harness bug, verify with a direct `curl` against the sample URL smplr would
  request. Fixed via `providers/smplrCaseFallbackStorage.ts` (extension-fallback retry at the
  smplr `Storage` layer, generic to any future case mismatch) and
  `drum/constants.ts#DRUM_ABUSE_SET_OVERRIDE_BY_ID` (pins a machine to an alternate, decodable
  sample set when its default one can't be fixed by a fetch retry).

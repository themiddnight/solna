# Audio runtime startup acceptance

This matrix checks muted Lead startup after a loud playback stop and Lead automation at future arrangement boundaries. Test Play All on the Song layer separately from playing a single loop on the Loop layer. Use it for Chrome on macOS and Safari on macOS. Record observations from the actual browser and device; repository-runtime audio tests are separate evidence and do not substitute for these runs.

User-reported reproduction context: Lead leakage occurs in Play All / arrangement playback; playing the target loop alone does not leak. This report motivates the paired cases below. It does not identify a browser build or establish that the fix has been manually verified; all verification results remain Pending until run.

## Deterministic fixtures

Build these fixtures in a fresh Solna project for each browser. Use the default project values: 4/4 meter, 120 BPM, A Natural Minor, one-bar Lead loop, 1/16 Lead resolution, octave window 3, and the factory `Cosmic Lead` patch (`factory-cosmic-lead`). Keep the factory Lead gate at 85%, arp off, and the factory master-effects settings unchanged. The factory Lead bus starts at -6 dB; set its `Lead Layer Gain` fader to 0 dB (double-click the fader to return it to unity) and confirm its tooltip says 0.0 dB. Keep every other source fader at its fresh-project default (-6 dB) and mute FX, Chord, Bass, Pad, and Beat in the Sound mixer. This leaves Lead as the only unmuted source.

Create the note by opening the Lead Pattern grid in Scale view and clicking A3 in the first column of bar 1. In the default 1/16 resolution, one cell creates a note of length 2 stored ticks; the note starts at step zero. Confirm every other Lead cell is empty. This exact note and patch form the loud fixture:

| Fixture ID | Lead patch / note | Lead source level and mute | Grid / other-source state |
|---|---|---|---|
| `SB-LOUD-LEAD` | Cosmic Lead (`factory-cosmic-lead`); A3 at bar 1, column 1 / step zero; length 2 ticks | 0.0 dB; unmuted | One-bar Lead loop, 1/16 resolution, 85% gate, arp off; all other Lead cells empty; FX, Chord, Bass, Pad, and Beat muted |
| `SB-MUTED-STEP0` | Same patch and note as `SB-LOUD-LEAD` | 0.0 dB; muted | Identical to `SB-LOUD-LEAD`; only Lead mute changes |
| `SB-MUTED-EMPTY` | Same patch; no Lead notes | 0.0 dB; muted | Same project state as `SB-MUTED-STEP0`; clear the Lead grid with its Clear action |
| `SB-MUTED-NEXT` | Same patch and note as `SB-MUTED-STEP0` | 0.0 dB; muted | A distinct duplicate of `SB-MUTED-STEP0`, used to check a later boundary while Lead remains muted |

Create each fixture as a distinct loop card before starting the runs: name the loud loop `SB-LOUD-LEAD`, use Duplicate loop to create and name the muted variants, then set each duplicate's Lead mute and grid as specified. Keep one repeat per card. Select another card and return to each fixture to confirm its name, mute and notes were retained. Do not prepare a test run by changing mute on the currently playing loud loop: the run must load a different saved loop.

Do not alter the meter, tempo, scale, patch, effects, Lead gate, or any source level between fixtures. Keep the same comfortable, clearly audible output-device volume throughout a browser's run.

## Manual procedure

For each browser, record its full build/version and the macOS version/build. Prepare all distinct fixtures above. The master Play button on Arrange / the Song layer invokes Play All; Play on the Loop layer or a loop card plays that loop alone. Record the layer and the loaded/playing fixture names in every playback result.

1. For the loop-only control, load and play `SB-LOUD-LEAD` on the Loop layer; confirm A3 is clearly audible. Hard-stop using the app's stop control. Select/load the distinct `SB-MUTED-STEP0` card and confirm its active name, mute and note. Return to the Loop layer and press Play. Listen from the instant playback starts. Hard-stop, load the loud card again, and repeat this complete load/start/stop sequence ten times.
2. Repeat step 1 with the distinct `SB-MUTED-EMPTY` card as the restart target. Verify its empty grid each time; do not clear or mute the loud card during the run.
3. For Play All restart, repeat the loud-play -> hard-stop -> select/load distinct muted-target sequence, then switch to Arrange and use the Song-layer master Play. Record the first playing loop and listen at startup and when Play All reaches the muted target. Run ten cycles for each muted target (`SB-MUTED-STEP0` and `SB-MUTED-EMPTY`); keep these results separate from the loop-only control.
4. For continuous arrangement boundaries, order the distinct cards `SB-LOUD-LEAD` -> `SB-MUTED-STEP0` -> `SB-MUTED-NEXT`, with one repeat each. Start Play All from the loud card and let it advance automatically, without a manual load or mute change. Confirm audible Lead on the first card. Listen at the first mute boundary and again at the next muted card's step-zero note; record each boundary separately, including whether any sound is a decaying tail or a new transient. Repeat ten times. Repeat with `SB-MUTED-EMPTY` as the middle card. At 120 BPM each one-bar boundary is two seconds apart.
5. Export `SB-MUTED-STEP0` alone as a mixdown, then export the three-card arrangement from step 4. Inspect every output channel and listen from time zero and at both arrangement boundaries. Record the first sample and opening 100 ms peak of the loop-only export; for the arrangement record the peak at each boundary and any newly audible Lead after the initial mute decay. Record export format/settings and inspection method.
6. Fill one result row per browser and case below. If a browser/device run has not happened, leave its build and OS as Pending and its result as **Pending / Not run**. Do not infer a pass from the automated evidence below.

## Cross-browser results

Record the date and output device in Notes. “Other-source leakage” means any audible source besides the selected Lead source, including Beat, chords, bass, FX, or a lingering playback tail.

| Browser | Browser build | macOS version/build | Case / fixture | Lead level / mute | Repetitions | Result | Other-source leakage? | Muted step-zero / empty-grid / mixdown observations | Notes / run date |
|---|---|---|---|---:|---|---|---|---|
| Chrome macOS | Pending | Pending | Loop-only restart: load `SB-MUTED-STEP0` after loud hard-stop | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | Pending | |
| Chrome macOS | Pending | Pending | Loop-only restart: load `SB-MUTED-EMPTY` after loud hard-stop | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | Pending | |
| Chrome macOS | Pending | Pending | Play All restart: load `SB-MUTED-STEP0` after loud hard-stop | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | First playing loop / target boundary: Pending | |
| Chrome macOS | Pending | Pending | Play All restart: load `SB-MUTED-EMPTY` after loud hard-stop | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | First playing loop / target boundary: Pending | |
| Chrome macOS | Pending | Pending | Play All: loud -> muted step-zero -> muted next | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | First mute / next muted boundary: Pending | |
| Chrome macOS | Pending | Pending | Play All: loud -> muted empty -> muted next | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | First mute / next muted boundary: Pending | |
| Chrome macOS | Pending | Pending | Export `SB-MUTED-STEP0`; inspect and listen at time zero | 0.0 dB / muted | 0/1 | Pending / Not run | Pending | First sample: Pending; opening 100 ms peak: Pending; audible at time zero: Pending | |
| Chrome macOS | Pending | Pending | Export loud -> muted step-zero -> muted next | 0.0 dB / muted | 0/1 | Pending / Not run | Pending | Both boundary peaks / audible reopening: Pending | |
| Safari macOS | Pending | Pending | Loop-only restart: load `SB-MUTED-STEP0` after loud hard-stop | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | Pending | |
| Safari macOS | Pending | Pending | Loop-only restart: load `SB-MUTED-EMPTY` after loud hard-stop | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | Pending | |
| Safari macOS | Pending | Pending | Play All restart: load `SB-MUTED-STEP0` after loud hard-stop | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | First playing loop / target boundary: Pending | |
| Safari macOS | Pending | Pending | Play All restart: load `SB-MUTED-EMPTY` after loud hard-stop | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | First playing loop / target boundary: Pending | |
| Safari macOS | Pending | Pending | Play All: loud -> muted step-zero -> muted next | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | First mute / next muted boundary: Pending | |
| Safari macOS | Pending | Pending | Play All: loud -> muted empty -> muted next | 0.0 dB / muted | 0/10 | Pending / Not run | Pending | First mute / next muted boundary: Pending | |
| Safari macOS | Pending | Pending | Export `SB-MUTED-STEP0`; inspect and listen at time zero | 0.0 dB / muted | 0/1 | Pending / Not run | Pending | First sample: Pending; opening 100 ms peak: Pending; audible at time zero: Pending | |
| Safari macOS | Pending | Pending | Export loud -> muted step-zero -> muted next | 0.0 dB / muted | 0/1 | Pending / Not run | Pending | Both boundary peaks / audible reopening: Pending | |

For playback rows, mark Result Pass only after all ten repetitions have no new audible transient; otherwise mark Fail and describe the repetition, playing fixture, boundary and sound. Existing effect tails and the first mute's 10 ms transition must be recorded separately from a source reopening. For the loop-only export, a pass requires a zero first sample in every channel, an exactly zero opening 100 ms peak in every channel, and no audible opening transient. For arrangement exports, record both boundaries and require no Lead reopening at the later boundary while mute remains enabled. Record measured values and the inspection method even on a pass.

## Automated repository-runtime evidence

The committed `src/audio/export/renderMixdown.sourceBus.test.ts` uses `node-web-audio-api`'s `OfflineAudioContext`; this is automated repository-runtime evidence, not a Chromium or Safari run. Task 4 recorded GREEN 6/6 muted-source cases, with exact zero peak in the first 100 ms for each muted render and a non-zero opening peak for its unmuted control. The six source fixtures are synth/Lead, FX, chord, bass, pad, and sequencer. Task 4 also recorded 138 focused checks and 4,595 checks in the full `bun run verify` gate. The reported environment was Bun 1.3.14 with `node-web-audio-api` 2.2.0.

These automated checks establish the offline render behavior represented by those fixtures. They do not establish audible browser playback behavior or physical-device output; keep the manual matrix pending until each browser/device run is performed.

Final-review regressions additionally force the `cancelAndHoldAtTime` fallback in real offline renders. A constant-source test measures the gain at multiple future boundaries, detects discontinuities and checks replacement of a later scheduled opening. The arrangement fixture renders distinct audible-Lead, muted-Lead and still-muted-Lead loops at 0, 2 and 4 seconds, checks both channels for no reopening after the initial mute decay, and verifies that the muted target alone starts at exact zero with an audible unmuted control. All six startup fixtures inspect both output channels for both positive signal and exact silence.

## Session health and recovery matrix

Status of every row below: **not yet run - manual.** Nothing here has been observed on a real
browser or device; the automated suites (`src/audio/runtime`, `engine`, `engineDiagnostics`,
`audioRecovery`, `IncidentDialog`) use simulated clocks only. Design and quirk policy:
`docs/architecture/audio-runtime-quirks.md`.

For each row record browser, OS, app build and exported diagnostics.

| Environment | Case | Expected | Browser / OS / build | Result |
|---|---|---|---|---|
| Chrome macOS | Normal playback for several minutes, tab visible and hidden | Recovery never raised | | Not yet run - manual |
| Safari macOS | Normal playback for several minutes, tab visible and hidden | Recovery never raised | | Not yet run - manual |
| iPhone Safari | 30-60 min continuous playback | If degradation occurs: modal appears after three suspicious samples, all players stop, recovery creates a new generation, playback resumes only after a new Play press | | Not yet run - manual |
| iPhone installed PWA | 30-60 min continuous playback | Same as iPhone Safari | | Not yet run - manual |

Also record whether the exported diagnostics show `runtimePolicyId: ios-webkit` on the iPhone rows
and `default` on the macOS rows.

## Verification note (Task 8, automated)

Targeted suites pass (90 tests). `bun test` in this worktree has 6 failures in
`src/store/songMode.test.ts`; they reproduce identically at the base commit `f137ce2f`, so they
predate this branch and are unrelated to audio recovery. `bun run eslint` reports 9
`react-hooks/exhaustive-deps` warnings in `useSynthPatchDraft.ts` and `useEffectsDraft.ts`,
files this branch does not touch.

## Incident reporting verification (Task 10)

Automated, run on this branch:

- Incident and recovery suites (`src/incidents`, `audioRecovery`, `IncidentDialog`, `ErrorBoundary`, `ProjectMenu`): 109 pass.
- `bun run verify`: `bun test` reports 6 failures, all in `src/store/songMode.test.ts`, identical at base `f137ce2f` (pre-existing). Run stage by stage, every later step passes: `lint`, `eslint` (0 errors, 9 pre-existing `react-hooks/exhaustive-deps` warnings), `check:keys`, `check:drums`, `check:contrast`, `check:levels`, both Knip scans, and the production build.
- Privacy audit of `src/incidents/`: no import of the store, project format or content modules; no `fetch`, beacon or XHR; the only outside utility is `downloadTextFile` for the user-initiated download. Files and the prefilled URL carry no project name, path, notes, chords, patterns, presets, tokens or stable ids. The report does include the browser user agent (`runtime.userAgent`); see `docs/reporting-bugs.md`.
- Production bundle: no diagnostic panel code is present, and the Diagnostics row is only listed when the compile-time `DEV` flag is true.

Manual desktop and iPhone flows (recover, dismiss/reopen, copy/share, open the prefilled form, inspect attachment, Error Boundary fixture, manual report): **not yet run - manual.**

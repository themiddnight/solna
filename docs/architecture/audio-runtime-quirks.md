# Audio runtime quirks

Browser-specific audio behaviour is expressed as a runtime policy (`src/audio/runtime/policy.ts`),
chosen by `runtimePolicyFor(profile)` from the detected platform and engine
(`src/audio/runtime/profile.ts`). Each row below must state detection, recovery, upstream
references, automated tests, last verified environment and the condition for deleting it.

## Policies

| Policy id | Selected when | Difference from default |
|---|---|---|
| `default` | Everything else | None; the baseline health thresholds |
| `ios-webkit` | `platform === 'ios'` and `engine === 'webkit'` | Carries the `ios-webkit-clock-drift` quirk tag. Numeric thresholds are currently identical to `default`; the tag exists so diagnostics attribute a failure to this environment and so thresholds can diverge without a new code path |

Shared thresholds: sample every 1000 ms; a sample is suspicious when the audio-clock / wall-clock
ratio is outside 0.75..1.25 or the wall gap exceeds 2500 ms; three consecutive suspicious samples
mark the session unhealthy.

## Row: ios-webkit / ios-webkit-clock-drift

- **Symptom:** on iOS WebKit (Safari and installed PWA) the `AudioContext` can report `running`
  while its clock advances slower or faster than wall time, or stalls, after long sessions;
  playback drifts or goes silent with no error event.
- **Detection:** `healthMonitor` samples `currentTime` against wall time once per second while
  playback is active and the page is visible; three suspicious samples in a row (`health.ts`)
  move the phase to `unhealthy`. Hidden pages, inactive playback and non-running contexts reset
  the baseline rather than counting.
- **Recovery:** the unhealthy state opens the recovery modal (`store/audioRecovery.ts`,
  `components/ui/IncidentDialog.tsx`). All players stop, the user confirms, the engine
  creates a new session generation (`audioSession.ts`, `engine.ts`), and playback resumes only
  after a new Play press. Nothing restarts automatically.
- **Upstream WebKit references:** none verified yet. TODO: link the relevant bugs.webkit.org
  entries for AudioContext clock drift / suspended-but-running contexts once identified; do not
  add a link that has not been read.
- **Automated tests:** `src/audio/runtime/*.test.ts` (profile, policy, health, healthMonitor,
  audioSession), `src/audio/engine.test.ts`, `src/audio/engineDiagnostics.test.ts`,
  `src/store/audioRecovery.test.ts`, `src/components/ui/IncidentDialog.test.tsx`.
  These use simulated clocks; none exercises real WebKit.
- **Last verified environment:** automated only (Bun test runner). Real iPhone Safari / PWA:
  **not yet run - manual** (see `docs/testing/audio-runtime-acceptance.md`).
- **Delete when:** a 30-60 minute run on current iOS Safari and installed PWA shows no clock
  degradation and no recovery prompt across the supported iOS versions, or the upstream WebKit
  issues are fixed in the minimum supported iOS. Then remove the `ios-webkit` policy and its
  tag; the `default` monitor may stay as a generic safeguard.

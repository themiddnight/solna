# Audio runtime recovery and incident reporting — design

## Context

Two independent audio failures were isolated from long-running browser tests.

1. On iPhone WebKit, the UI and analyser meters remain responsive while
   `AudioContext.currentTime` stops tracking wall time. In the captured session the
   ratio fell well below real time, later ran faster while the scheduler caught up,
   and then degraded again. `AudioContext.state` remained `running`; stopping and
   restarting the players did not recover output. Refreshing the page did. The same
   behavior occurs in Safari and in an installed PWA, while it has not been observed
   on macOS Safari.
2. On macOS Chromium, a short pitched transient can escape when playback starts from
   `stopped`, including at time zero in a mixdown. It remains with delay and reverb
   disabled. Source buses currently use `setTargetAtTime(..., 0.01)` for both
   interactive transitions and initial state settlement, so a bus intended to be
   muted begins above zero and decays after the first event has already started. The
   shared primitive means every source may be affected even though Lead is easiest to
   hear.

The repository is public. Production users should not need to find and operate a
diagnostics panel before a failure. Unexpected incidents should preserve bounded,
privacy-safe evidence and offer an explicit GitHub reporting flow, without remote
telemetry or automatic submission.

## Goals

- Make source-bus state deterministic at playback and offline-render time zero.
- Detect the observed audio-clock failure without depending on
  `AudioContext.state` or a browser name alone.
- Recreate every realtime context-bound object as one disposable generation.
- Stop playback on confirmed audio failure, let the user recover explicitly, and
  leave all players stopped after recovery.
- Isolate proven browser/platform workarounds without forking musical behavior into
  separate WebKit, Chromium, and Gecko engines.
- Replace the production diagnostics panel with a bounded incident flight recorder,
  recovery UI, and privacy-reviewed GitHub issue flow.
- Support both automatically detected incidents and a manual **Report a Bug** entry
  for defects that cannot be detected programmatically.

## Non-goals

- Remote telemetry, background upload, or automatic GitHub issue creation.
- Resuming transport automatically after audio recovery.
- A separate DSP, scheduler, or voice implementation per browser.
- Detecting every audible defect automatically. Wrong notes or visual defects may
  require the manual report path.
- Treating expected cancellation, validation, authentication, or network outcomes as
  crashes.

## Architecture

### Shared engine with replaceable sessions

`audioEngine` remains the stable public facade. Store bridges, playback adapters,
analyser consumers, and offline export keep one supported entry point. The realtime
facade owns a replaceable `AudioSession` generation:

```text
AudioEngine facade
  ├── runtime profile and policy
  ├── health monitor
  └── AudioSession generation
        ├── AudioContext
        ├── MasterRack and source buses
        ├── Clock
        ├── DrumSynth
        ├── SynthVoiceManager and LFO bank
        └── context-bound analysers and nodes
```

An `AudioSession` has explicit construction and disposal. Disposal clears timers and
listeners, stops voices and sources, disconnects context-bound nodes, and closes the
realtime context on a best-effort basis. No context-bound object survives into the
next generation. The facade exposes generation-safe delegates and analyser getters;
callers never retain a session directly.

`createRenderEngine(ctx)` remains a throwaway, caller-owned offline path. It uses the
same session construction and source-bus semantics but does not participate in
realtime health monitoring or recovery.

### Runtime profiles and narrow policies

Runtime classification records browser engine, operating system, standalone mode,
and supported Web Audio capabilities. It is best-effort metadata, not the primary
failure detector. In particular, the confirmed profile is `ios-webkit`, not all
WebKit: macOS Safari must not inherit an iPhone workaround without evidence.

Policies may control only context lifecycle, health thresholds, and recovery
sequencing. They may not alter note planning, patches, voice allocation, timing
semantics, or persisted state. The default policy remains the behavior for every
unclassified runtime. A platform-specific policy file is added only for a proven
difference; empty Chromium and Gecko implementations are not created pre-emptively.

Every quirk entry documents its affected environment, behavioral detection,
workaround, upstream issue when available, automated coverage, and removal condition.

### Atomic source-bus state

Source-bus state is one value, `{ gain, muted }`, and is applied atomically. It has two
explicit modes:

- `settle` sets the final effective gain at an exact audio time. It does not ramp from
  an intermediate value. Engine initialization, recovery snapshot application,
  playback restart from fully stopped, and mixdown time zero use this mode.
- `transition` starts from the held current value and performs a short click-free
  ramp. Interactive mute and fader changes while audio is already running use this
  mode.

Calling a gain setter followed by a mute setter must never create an observable
intermediate state. A muted source at time zero is zero before any note at time zero
is rendered. This is a browser-neutral contract. A browser-specific automation
primitive is allowed only if a conformance test proves that equivalent Web Audio
operations differ after the shared contract is corrected.

### Audio health state machine

The health monitor is active only while at least one playback clock listener exists.
It samples approximately once per second and compares the delta of
`AudioContext.currentTime` with `performance.now()`.

```text
idle -> healthy -> suspected -> unhealthy -> recovering -> ready
                                      |                       |
                                      +-------> failed <-------+
```

A sample is valid only while the document is visible and the realtime context reports
`running`. Visibility changes, browser suspension, and discarded long wall-time gaps
reset the baseline. A default ratio outside `0.75..1.25` is suspicious. Three
consecutive valid suspicious samples confirm `unhealthy`; one isolated sample does
not. Thresholds are named policy values and covered by pure tests.

The monitor writes no per-sample Zustand state. It emits only state transitions and
keeps its numeric evidence in the bounded incident recorder. When playback stops, its
timer and observations stop too.

On confirmed failure the store-side engine bridge, not `src/audio/`, performs
`hardStopAll`, records the incident, and exposes transient recovery state to the UI.
The audio layer continues to import neither store nor components.

### User-triggered recovery

The first confirmed failure freezes the pre-incident evidence before any recovery
mutation. The UI displays a modal and a persistent Transport warning if the modal is
dismissed. **Recover Audio** is the primary action.

One recovery is allowed in flight. Its gesture handler initiates closing the old
generation and constructs/resumes the replacement context before its first asynchronous
yield, preserving browser activation. It then disposes the remaining old generation,
rebuilds the complete graph, and calls the existing store-side snapshot boundary to
reapply current audio state. The new context must demonstrate advancing audio time
before recovery becomes `ready`. Every player remains `stopped`; the user presses Play
explicitly.

A rejected or hanging close is best-effort and cannot block the state machine
indefinitely. Constructor, resume, graph-build, snapshot-apply, or validation failure
leaves project state untouched and produces `failed`, with **Retry Audio Recovery** and
**Reload App** actions. Stale asynchronous completion from an older generation cannot
overwrite a newer generation's state.

## Incident reporting

### Incident producers and severity

A central incident contract accepts structured events from:

- the audio health monitor and recovery controller;
- the existing React error boundary;
- `window.error` and `unhandledrejection`, after filtering expected outcomes;
- critical storage, import, export, and initialization failures;
- the manual **Report a Bug** command.

Incidents are classified as `fatal`, `interrupted`, or `degraded`. Fatal render failure
uses a full-page recovery surface. Confirmed audio failure is interrupted and uses the
recovery modal. Degraded failures use a banner or toast and do not interrupt unrelated
work. Expected cancellations and user-correctable validation errors remain normal UI
messages and never prompt for a report.

### Production flight recorder

The current opt-in, long-session diagnostics panel is removed from production
navigation. It remains available only in development builds for maintainers. Production
uses a separate lightweight recorder while playback is active:

- one sample per second in a fixed 300-sample (five-minute) ring buffer;
- audio/wall-clock deltas, context state and latency, clock counters, bounded voice
  counts, player states, visibility, runtime profile, and session generation;
- no animation-frame observer, React render counters, heap polling, or continuous
  IndexedDB flushing;
- no scheduled work when playback is inactive.

An incident freezes the buffer and persists only the latest sanitized report so it can
survive a reload or failed recovery. Recovery attempts append outcomes to that frozen
incident rather than erasing the evidence.

### Privacy boundary

An incident may contain the build identifier, runtime profile, user agent,
standalone status, relative timestamps, route category, audio health values, player
states, BPM, meter, bounded voice counts, sanitized error name/message/stack, and
recovery results.

It must not contain project names, filenames or paths, notes, chords, progressions,
patterns, user presets, imported content, Drive credentials, access tokens, stable
cross-session user identifiers, or arbitrary store snapshots. Redaction is centralized
and schema-tested. The report preview states that GitHub issues and attachments are
public.

### GitHub flow

Solna never submits silently. **Report on GitHub** opens the repository's audio/general
issue form with a sanitized title, summary, runtime profile, and incident fingerprint
prefilled. The user may copy, download, or use Web Share for the diagnostic JSON and
chooses whether to attach it. Browsers cannot safely attach a local file to GitHub
cross-origin, so the UI gives explicit attachment instructions.

Direct issue creation through a bundled token, OAuth flow, GitHub App, or reporting
backend is out of scope. The repository adds a structured issue form for runtime,
reproduction, recovery result, fingerprint, and optional diagnostic attachment.

## Module boundaries

The implementation may adjust exact filenames during planning, but ownership remains:

| Area | Responsibility |
|---|---|
| `src/audio/runtime/` | runtime profile, policy contract, iOS WebKit policy, health monitor, session lifecycle |
| `src/audio/automation/` | shared source-bus settle/transition semantics |
| `src/audio/engine.ts` | stable facade and offline render factory |
| `src/diagnostics/` | development-only recorder UI and reusable sanitized schemas where appropriate |
| `src/incidents/` | bounded recorder, classification, redaction, fingerprinting, local persistence, GitHub report construction |
| `src/store/` bridge | stop orchestration, snapshot reapplication, transient incident/recovery state |
| `src/components/` | recovery modal, Transport warning, fatal boundary, manual report entry |
| `.github/ISSUE_TEMPLATE/` | public structured issue forms |

The existing dependency rules continue to bind: audio imports neither store nor
components, and components do not gain general access to `audio/engine`. Engine actions
flow through the store-side bridge; read-only analyser exemptions remain narrow.

## Verification

### Source-bus conformance

- A muted pitched source with a note at offline time zero produces no non-zero samples
  in the opening window.
- Lead, FX, Chord, Bass, Pad, and Beat satisfy the same initial-silence contract.
- `settle` emits no ramp from a prior value; `transition` remains click-free.
- Stop, load, and restart cannot leave a lookahead-scheduled voice from the prior run.
- Existing audible mixdown fixtures retain their deterministic output once expected
  reference data is deliberately updated for the corrected boundary behavior.

### Health and lifecycle

- Pure cadence tests cover normal, slow, fast, frozen, isolated-spike, hidden,
  suspended, and long-gap sequences.
- Monitoring owns no timer when idle and emits no per-sample store writes.
- Disposal removes timers, subscriptions, voices, and context-bound references.
- Recovery is single-flight, increments generation once, reapplies the snapshot, and
  leaves all players stopped.
- Analyser getters resolve nodes from the new generation.
- Close, construct, resume, rebuild, apply, and post-recovery validation failures are
  deterministic and leave user data intact.

### Incident system

- Severity classification excludes expected outcomes.
- Ring-buffer bounds and persistence remain fixed.
- Redaction and schema tests reject every forbidden project/user field.
- Duplicate fingerprints are stable for equivalent sanitized incidents.
- Recovery, retry, reload, dismiss, manual report, copy, share, download, and GitHub
  fallback paths have UI coverage.
- Production builds contain no user-facing diagnostics menu or eagerly loaded
  development panel.

Manual acceptance covers Chrome and Safari on macOS, Safari on iPhone, and installed
iPhone PWA. The transient test runs in every environment. Long-run iPhone runs cover
failure detection, evidence freeze, recovery, explicit replay, and report export.
Completion requires targeted suites followed by `bun run verify`.

## Delivery sequence

Implementation is split so each change has one observable contract and can be reverted
independently:

1. Correct atomic source-bus settlement and add cross-source offline/live conformance
   fixtures.
2. Introduce `AudioSession` ownership and deterministic disposal without changing
   normal playback behavior.
3. Add runtime profiles, the pure health state machine, and bounded active-playback
   monitoring.
4. Add store orchestration, recovery UI, full session recreation, and stopped-after-
   recovery behavior.
5. Replace production diagnostics UI with the incident flight recorder and preserve
   the long recorder for development only.
6. Add the central incident contract, privacy boundary, Error Boundary/global
   producers, and manual **Report a Bug**.
7. Add GitHub issue forms and copy/share/download report flows.
8. Run the cross-browser manual matrix and document each proven runtime quirk and its
   removal condition.

The detailed implementation plan will define red-green checkpoints and commits for
these phases after this design is approved.

# Audio Session Health and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect the observed iPhone audio-clock degradation, stop safely, and rebuild the complete realtime Web Audio session from a user gesture without reloading or restarting playback.

**Architecture:** Keep `audioEngine` as a stable facade over a replaceable `AudioSession`. A browser-neutral health reducer evaluates audio-time versus wall-time; runtime profiles and narrow policies label proven platform quirks and configure thresholds without forking DSP or scheduling.

**Tech Stack:** TypeScript, raw Web Audio API, Zustand store bridge, React, Bun tests.

**Spec:** `docs/superpowers/specs/2026-09-20-audio-runtime-recovery-and-incident-reporting-design.md`

**Depends on:** `docs/superpowers/plans/2026-09-20-source-bus-startup-transient.md`

## Global Constraints

- The audio layer imports neither store nor components.
- Browser policies may change lifecycle, thresholds, and recovery sequencing only.
- Runtime behavior, not user-agent text alone, confirms a failure.
- Monitoring exists only while playback clock listeners exist and writes no per-sample Zustand state.
- Recovery is explicit, single-flight, generation-safe, and leaves every player stopped.
- A new context is constructed/resumed in the recovery gesture before the first asynchronous yield.
- Offline rendering uses the same session construction but no realtime monitor or recovery.

---

## File map

| File | Responsibility |
|---|---|
| `src/audio/runtime/profile.ts` | Best-effort engine/OS/standalone/capability classification |
| `src/audio/runtime/policy.ts` | Health thresholds and documented runtime quirks |
| `src/audio/runtime/health.ts` | Pure clock-ratio state machine |
| `src/audio/runtime/healthMonitor.ts` | Timer/subscription lifecycle and bounded recent samples |
| `src/audio/runtime/audioSession.ts` | One context-bound graph generation and deterministic disposal |
| `src/audio/engine.ts` | Stable facade, generation ownership, health/recovery API |
| `src/audio/{clock,masterRack,drumSynth}.ts` | Explicit subsystem disposal |
| `src/audio/synth/{voiceManager,synthLfo}.ts` | Explicit voice/LFO disposal |
| `src/store/audioRecovery.ts` | Audio-to-store orchestration and recovery external store |
| `src/components/ui/AudioRecoveryModal.tsx` | Recover/retry/reload modal |
| `src/components/TransportBar.tsx` | Persistent warning after modal dismissal |
| `src/App.tsx` | Start/stop the one recovery bridge and mount the modal |
| `src/audio/diagnostics.ts` | Add runtime, health, and generation fields to snapshots |

### Task 1: Add runtime profiles and narrow policies

**Files:**
- Create: `src/audio/runtime/profile.ts`
- Create: `src/audio/runtime/profile.test.ts`
- Create: `src/audio/runtime/policy.ts`
- Create: `src/audio/runtime/policy.test.ts`

**Interfaces:**
- Produces: `RuntimeProfile`
- Produces: `detectRuntimeProfile(environment): RuntimeProfile`
- Produces: `AudioRuntimePolicy`
- Produces: `runtimePolicyFor(profile): AudioRuntimePolicy`

- [ ] **Step 1: Write failing classification and policy tests**

Pin at least these inputs: iPhone Safari → `ios/webkit`; installed iPhone PWA →
`ios/webkit` with `standalone: true`; macOS Safari → `macos/webkit`; macOS Chrome →
`macos/chromium`; Firefox → `gecko`; unknown UA → `unknown`. Assert that only the
iOS WebKit profile carries the documented `ios-webkit-clock-drift` quirk id.

- [ ] **Step 2: Run tests and verify red**

Run: `bun test src/audio/runtime/profile.test.ts src/audio/runtime/policy.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement the public contracts**

```ts
export type AudioEngineFamily = 'webkit' | 'chromium' | 'gecko' | 'unknown';
export type RuntimePlatform = 'ios' | 'macos' | 'windows' | 'android' | 'linux' | 'unknown';

export interface RuntimeProfile {
  engine: AudioEngineFamily;
  platform: RuntimePlatform;
  standalone: boolean;
  userAgent: string;
}

export interface AudioRuntimePolicy {
  id: 'default' | 'ios-webkit';
  sampleIntervalMs: 1000;
  minClockRatio: 0.75;
  maxClockRatio: 1.25;
  suspiciousSamplesToFail: 3;
  maxWallGapMs: 2500;
  quirks: readonly string[];
}
```

Inject `{ userAgent, platform, maxTouchPoints, standalone }` into detection so tests
do not patch globals. Detect iPad desktop mode through `platform === 'MacIntel' &&
maxTouchPoints > 1`. On iOS, classify AppleWebKit-based branded browsers as WebKit;
do not mistake `CriOS` or `FxiOS` for a different rendering engine.

- [ ] **Step 4: Run focused tests and verify green**

Run: `bun test src/audio/runtime/profile.test.ts src/audio/runtime/policy.test.ts`

- [ ] **Step 5: Commit runtime classification**

```bash
git add src/audio/runtime/profile.ts src/audio/runtime/profile.test.ts src/audio/runtime/policy.ts src/audio/runtime/policy.test.ts
git commit -m "feat(audio): classify runtime health policies"
```

### Task 2: Implement the pure audio-clock health state machine

**Files:**
- Create: `src/audio/runtime/health.ts`
- Create: `src/audio/runtime/health.test.ts`

**Interfaces:**
- Consumes: `AudioRuntimePolicy`
- Produces: `AudioClockSample`, `AudioHealthState`, `initialAudioHealthState()`
- Produces: `advanceAudioHealth(state, sample, policy): AudioHealthState`

- [ ] **Step 1: Write table-driven failing tests**

Cover normal `1.0`, slow `0.4`, fast `1.6`, frozen `0`, one isolated spike, hidden,
suspended, inactive, and a wall gap above 2500 ms. Three consecutive suspicious
valid ratios must produce `unhealthy`; invalid samples reset the baseline without
incrementing suspicion.

```ts
expect(feed([1, 0.4, 0.4, 0.4]).phase).toBe('unhealthy');
expect(feed([1, 0.4, 1, 1]).phase).toBe('healthy');
```

- [ ] **Step 2: Run the test and verify red**

Run: `bun test src/audio/runtime/health.test.ts`

- [ ] **Step 3: Implement the reducer**

```ts
export type AudioHealthPhase = 'idle' | 'healthy' | 'suspected' | 'unhealthy';

export interface AudioClockSample {
  wallTimeMs: number;
  audioTimeSec: number;
  active: boolean;
  visible: boolean;
  contextState: AudioContextState | 'uninitialized';
}

export interface AudioHealthState {
  phase: AudioHealthPhase;
  previous: AudioClockSample | null;
  suspiciousCount: number;
  lastRatio: number | null;
}
```

Compute ratio only between two valid samples. Once `unhealthy`, remain latched until a
new session generation resets the reducer; an apparent recovery in the damaged context
must not hide the incident.

- [ ] **Step 4: Run the focused test and verify green**

Run: `bun test src/audio/runtime/health.test.ts`

- [ ] **Step 5: Commit the state machine**

```bash
git add src/audio/runtime/health.ts src/audio/runtime/health.test.ts
git commit -m "feat(audio): detect realtime clock degradation"
```

### Task 3: Add an idle-free health monitor

**Files:**
- Create: `src/audio/runtime/healthMonitor.ts`
- Create: `src/audio/runtime/healthMonitor.test.ts`
- Modify: `src/audio/diagnostics.ts`

**Interfaces:**
- Consumes: `advanceAudioHealth`, a context getter, injected scheduler and visibility getter
- Produces: `AudioHealthMonitor.start()`, `.stop()`, `.resetGeneration()`
- Produces: `.subscribe(listener)`, `.snapshot()`, `.recentSamples()`
- Produces: `AudioClockEvidence`, the public bounded-sample shape
- Stores: at most 300 samples

- [ ] **Step 1: Write failing lifecycle tests**

Use an injected scheduler to assert: no timer before `start`; one timer after repeated
`start`; timer cleared and sample buffer retained on `stop`; no samples while inactive;
one transition callback for `healthy -> suspected -> unhealthy`; exactly 300 retained
samples after 301 ticks; `resetGeneration` clears the latch and evidence baseline.

- [ ] **Step 2: Run and verify red**

Run: `bun test src/audio/runtime/healthMonitor.test.ts`

- [ ] **Step 3: Implement monitor and diagnostic snapshot fields**

The monitor samples its context getter and `performance.now()` only inside the injected
one-second callback. Its external snapshot is:

```ts
export interface AudioHealthSnapshot {
  phase: AudioHealthPhase;
  lastRatio: number | null;
  suspiciousCount: number;
  generation: number;
  runtimePolicyId: AudioRuntimePolicy['id'];
}

export interface AudioClockEvidence {
  elapsedMs: number;
  audioTimeSec: number;
  ratio: number | null;
  contextState: AudioContextState | 'uninitialized';
  visible: boolean;
}
```

Extend `AudioDiagnosticSnapshot` with `health` without changing scheduling or voice
lifecycle.

- [ ] **Step 4: Run health and diagnostics tests**

Run: `bun test src/audio/runtime/healthMonitor.test.ts src/audio/engineDiagnostics.test.ts`

- [ ] **Step 5: Commit the monitor**

```bash
git add src/audio/runtime/healthMonitor.ts src/audio/runtime/healthMonitor.test.ts src/audio/diagnostics.ts src/audio/engineDiagnostics.test.ts
git commit -m "feat(audio): monitor realtime clock health"
```

### Task 4: Give every context-bound subsystem deterministic disposal

**Files:**
- Modify: `src/audio/clock.ts`, `src/audio/clock.test.ts`
- Modify: `src/audio/masterRack.ts`, `src/audio/masterRack.test.ts`
- Modify: `src/audio/drumSynth.ts`, `src/audio/drumSynth.test.ts`
- Modify: `src/audio/synth/voiceManager.ts`, `src/audio/synth/voiceManager.test.ts`
- Modify: `src/audio/synth/synthLfo.ts`, `src/audio/synth/synthLfo.test.ts`

**Interfaces:**
- Produces: `dispose(at?: number): void` on each context-bound subsystem
- Guarantees: repeated disposal is a no-op and leaves no timer, listener, active source, node edge, or context-bound cache reachable

- [ ] **Step 1: Add one failing disposal contract per subsystem**

Clock must clear interval, listeners, transport-origin listeners, and after-step tasks.
Voice manager must stop every group, cancel teardown timers, clear mono/registered/group
maps, and detach LFO voices. LFO bank must stop/disconnect generators and clear pending
teardowns. Drum synth must stop tracked sources and clear context nodes. Master rack
must disconnect graph nodes, clear source maps/analysers and context-specific buffers.
Each test calls `dispose()` twice.

- [ ] **Step 2: Run disposal suites and verify red**

Run: `bun test src/audio/clock.test.ts src/audio/masterRack.test.ts src/audio/drumSynth.test.ts src/audio/synth/voiceManager.test.ts src/audio/synth/synthLfo.test.ts`

- [ ] **Step 3: Implement minimal idempotent disposal**

Use each subsystem's existing ownership maps; do not add a generic graph walker. Clear
bookkeeping only after stop/disconnect calls have been issued. Set each stored context
and node reference to `null` so a disposed object cannot schedule again.

- [ ] **Step 4: Run disposal and existing lifecycle suites**

Run the command from Step 2 plus `bun test src/audio/idleSuspend.test.ts`.

- [ ] **Step 5: Commit disposal contracts**

```bash
git add src/audio/clock.ts src/audio/clock.test.ts src/audio/masterRack.ts src/audio/masterRack.test.ts src/audio/drumSynth.ts src/audio/drumSynth.test.ts src/audio/synth/voiceManager.ts src/audio/synth/voiceManager.test.ts src/audio/synth/synthLfo.ts src/audio/synth/synthLfo.test.ts
git commit -m "refactor(audio): make context subsystems disposable"
```

### Task 5: Extract one replaceable `AudioSession` generation

**Files:**
- Create: `src/audio/runtime/audioSession.ts`
- Create: `src/audio/runtime/audioSession.test.ts`
- Modify: `src/audio/engine.ts`
- Modify: `src/audio/engine.test.ts`
- Modify: `src/audio/engine.render.test.ts`

**Interfaces:**
- Produces: `AudioSession.create(ctx, hooks): AudioSession`
- Produces: `AudioSession.dispose(): Promise<void>`
- Produces: `AudioSession.generation: number`
- Preserves: every existing public `AudioEngine` method and `createRenderEngine(ctx)`

- [ ] **Step 1: Add failing session ownership tests**

Assert construction binds all subsystems once, setup builds one master chain, disposal
calls each subsystem in dependency-safe order, realtime disposal calls `close`, offline
disposal does not, and two sessions share no node/subsystem object. Add facade tests
showing pre-init setters still no-op and existing delegates reach the current session.

- [ ] **Step 2: Run engine/session tests and verify red**

Run: `bun test src/audio/runtime/audioSession.test.ts src/audio/engine.test.ts src/audio/engine.render.test.ts`

- [ ] **Step 3: Move composition into `AudioSession`**

```ts
export interface AudioSessionHooks extends EngineHooks {
  readonly generation: number;
}

export class AudioSession {
  readonly masterRack: MasterRack;
  readonly drumSynth: DrumSynth;
  readonly clock: Clock;
  readonly lfoBank: SynthLfoBank;
  readonly synthManager: SynthVoiceManager;
  // create(), realtimeCtx(), dispose()
}
```

`AudioEngine` holds `private session: AudioSession | null`, delegates to it, and owns
only stable lifecycle/policy/monitor state. Keep the public engine surface byte-for-byte
compatible except for the new health/recovery methods. Offline factory creates a facade
with one caller-owned offline session.

- [ ] **Step 4: Run all audio engine and render tests**

Run: `bun test src/audio/engine.test.ts src/audio/engine.render.test.ts src/audio/engineDiagnostics.test.ts src/audio/export/renderMixdown.test.ts`

- [ ] **Step 5: Commit the session boundary**

```bash
git add src/audio/runtime/audioSession.ts src/audio/runtime/audioSession.test.ts src/audio/engine.ts src/audio/engine.test.ts src/audio/engine.render.test.ts
git commit -m "refactor(audio): isolate replaceable audio sessions"
```

### Task 6: Integrate monitoring and generation-safe recreation

**Files:**
- Modify: `src/audio/engine.ts`
- Modify: `src/audio/engine.test.ts`
- Modify: `src/audio/engineDiagnostics.test.ts`

**Interfaces:**
- Produces: `audioEngine.subscribeHealth(listener): () => void`
- Produces: `audioEngine.recreateRealtimeSession(): Promise<AudioRecoveryResult>`
- Produces: `audioEngine.validateRealtimeClock(): Promise<boolean>`
- Produces: `audioEngine.getRecentAudioHealthSamples(): readonly AudioClockEvidence[]`
- Constant: `SESSION_CLOSE_TIMEOUT_MS = 1000`

```ts
export type AudioRecoveryResult =
  | { ok: true; generation: number }
  | { ok: false; generation: number; reason: 'construct' | 'resume' | 'build' };
```

- [ ] **Step 1: Add failing integration tests**

Assert first clock subscription starts monitoring, last unsubscribe stops it, health
transition is forwarded once, recreation constructs/resumes before awaiting old close,
old late completion cannot replace the new generation, parallel calls share one
in-flight promise, and success resets the health latch. A never-settling `close()` must
not delay completion beyond `SESSION_CLOSE_TIMEOUT_MS`. Assert a new analyser is returned
after recreation.

- [ ] **Step 2: Run and verify red**

Run: `bun test src/audio/engine.test.ts src/audio/engineDiagnostics.test.ts`

- [ ] **Step 3: Implement recreation**

Inject the realtime context factory into `AudioEngine` tests. In the public call,
capture the old generation, invoke old close, construct and invoke `resume()` on the
replacement before the first `await`, then build/install the new session. Guard every
post-await write with the generation token. Race old close/disposal completion against
`SESSION_CLOSE_TIMEOUT_MS`; timeout is best-effort cleanup, not recovery failure.
`validateRealtimeClock` compares two
samples separated by the monitor scheduler and returns false outside policy bounds.

- [ ] **Step 4: Run engine and playback tests**

Run: `bun test src/audio/engine.test.ts src/audio/engineDiagnostics.test.ts src/audio/playback/playbackEngine.test.ts`

- [ ] **Step 5: Commit health/recreation integration**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts src/audio/engineDiagnostics.test.ts
git commit -m "feat(audio): recreate unhealthy realtime sessions"
```

### Task 7: Add store orchestration and recovery UI

**Files:**
- Create: `src/store/audioRecovery.ts`
- Create: `src/store/audioRecovery.test.ts`
- Create: `src/components/ui/AudioRecoveryModal.tsx`
- Create: `src/components/ui/AudioRecoveryModal.test.tsx`
- Modify: `src/components/TransportBar.tsx`
- Modify: `src/components/TransportBar.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Produces: `AudioRecoveryStatus = 'healthy' | 'unhealthy' | 'recovering' | 'ready' | 'failed'`
- Produces: `audioRecoveryStore.subscribe/getState`
- Produces: `startAudioRecoveryBridge(): () => void`
- Produces: `recoverAudio(): Promise<void>`, `dismissAudioRecovery(): void`

- [ ] **Step 1: Add failing controller tests**

Inject engine/store dependencies. On `unhealthy`, assert evidence callback runs before
`hardStopAll`, state becomes unhealthy, and repeated events do nothing. On recovery,
assert `recreateRealtimeSession -> applyEngineSnapshot -> validateRealtimeClock`, then
`ready`, with no play action. Assert failures become `failed` and parallel clicks call
the engine once.

- [ ] **Step 2: Add failing UI tests**

Assert unhealthy opens the modal; Recover shows loading and disables duplicate clicks;
success closes the modal but does not play; dismiss leaves a Transport warning button;
failed shows Retry and Reload App; clicking the warning reopens the modal.

- [ ] **Step 3: Run focused tests and verify red**

Run: `bun test src/store/audioRecovery.test.ts src/components/ui/AudioRecoveryModal.test.tsx src/components/TransportBar.test.tsx src/App.test.tsx`

- [ ] **Step 4: Implement the bridge and UI**

Keep recovery state in the external store rather than persisted Zustand. Mount one
bridge effect and modal in `Workspace`. Use the existing `Modal` component and
daisyUI role tokens. Copy must state that the project is safe and playback will remain
stopped. Reload calls `window.location.reload()` only from the explicit button.

- [ ] **Step 5: Run focused tests and accessibility assertions**

Run the command from Step 3. Expected: modal has `role="dialog"`, failure message has
`role="alert"`, and all actions have accessible names.

- [ ] **Step 6: Commit recovery orchestration**

```bash
git add src/store/audioRecovery.ts src/store/audioRecovery.test.ts src/components/ui/AudioRecoveryModal.tsx src/components/ui/AudioRecoveryModal.test.tsx src/components/TransportBar.tsx src/components/TransportBar.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat(audio): add user-triggered session recovery"
```

### Task 8: Verify automated and long-run behavior

**Files:**
- Modify: `docs/testing/audio-runtime-acceptance.md`
- Create: `docs/architecture/audio-runtime-quirks.md`

**Interfaces:**
- Documents: default and `ios-webkit` policy, upstream WebKit references, removal conditions, and observed results

- [ ] **Step 1: Run targeted suites**

Run: `bun test src/audio/runtime src/audio/engine.test.ts src/audio/engineDiagnostics.test.ts src/store/audioRecovery.test.ts src/components/ui/AudioRecoveryModal.test.tsx`

- [ ] **Step 2: Run the completion gate**

Run: `bun run verify`

Expected: complete repository gate passes with no new lint or dead-code findings.

- [ ] **Step 3: Run the manual matrix**

On Chrome macOS and Safari macOS, confirm normal playback never raises recovery. On
iPhone Safari and installed PWA, run 30–60 minutes; if degradation occurs, confirm the
modal appears after three samples, all players stop, recovery creates a new generation,
and playback resumes only after a new Play press. Record browser/OS/build and exported
diagnostics.

- [ ] **Step 4: Document quirks and commit**

The iOS WebKit row must include detection, recovery, upstream WebKit issue links,
automated tests, last verified environment, and the condition for deleting the policy.

```bash
git add docs/testing/audio-runtime-acceptance.md docs/architecture/audio-runtime-quirks.md
git commit -m "docs: record audio runtime recovery coverage"
```

# Engine composition split — design

## Context

`chore/eslint-guards` landed `max-lines` (750) and `max-lines-per-function` (100) as
errors. `src/audio/engine.ts` (1611 loc) and `src/audio/engine.test.ts` (3168 loc) still
exceed them. This refactor splits `AudioEngine` into four composed classes so each file
fits the limits, with behaviour preserved byte-identically — guarded by the existing
engine test suite, the `renderMixdown.test.ts` byte-identity test, and the
`check:drums` / `check:levels` gates.

## Mechanism

Sub-class composition (selected): each subsystem is a real class with its own state.
`AudioEngine` holds an instance of each and delegates, keeping its public API unchanged
so no caller (`engineSync.ts`, `audio/playback/*`, exempt analyser consumers,
`renderMixdown.ts`) moves.

## Decomposition

| class (file) | owns fields | key methods |
|---|---|---|
| `MasterRack` (`src/audio/masterRack.ts`) | `masterGain`, EQ/delay/reverb/distortion/compressor/limiter, `analyser` + `levelAnalyser`, `sourceBuses`/`sourceTaps`/`sourceGains`/`sourceMuted`/`sourceAnalysers`/`sourceLevelAnalysers`, `noiseBuffer`, `impulseCache` | `setupMasterChain`, `updateEffects`, `rewireMasterDynamics`, `setMasterVolume`, `setReverbDecay`, `setSourceGain`/`setSourceMuted`, `getSourceBus`/`getSourceTap`, all `get*Analyser` |
| `SynthVoices` (`src/audio/synthVoices.ts`) | `activeVoices`, `sourceVoices`, `maxVoiceLifetimeMs`, `maxVoicesPerSource`, `reshapeScratch`, `presetTrims` | `triggerSynthNoteOn`/`…Off`, the three release paths, `stopSource`/`stopOwnedVoices`, LFO wiring, `updateSynthParams` |
| `DrumSynth` (`src/audio/drumSynth.ts`) | `soundingHats`, `drumBusFilter`/`drumSendFilter`/`drumSendGate`, `drumFilter*`, `drumKit`, `drumTrackGains`/`drumTrackLevels`, `drumTrimGain`, all drum-synthesis constants | `triggerDrum`, `triggerHatVoice`, `triggerNonSwitchVoice`, `chokeHats`, `setDrumKit`/`setDrumFilter`, `setDrumTrackGain` |
| `Clock` (`src/audio/clock.ts`) | `clockTimer`, `clockBpm`, `clockStepIndex`, `clockNextStepTime`, `clockListeners`, `meter`, `metronomeEnabled`, `CLOCK_*`, `clickBufferHigh`/`clickBufferLow` | `subscribeClock`, `clockTick`, `resetClock`, `setClockBpm`/`setMeter`/`setMetronomeEnabled`, `ensureClockRunning`/`stopClockTimer`, `createClickBuffers`/`playMetronomeClick` |

## Lifecycle & shared state

- `AudioEngine` owns `ctx`, `isInitialized`, `suspendedForIdle`, `idleTimer`, and the
  idle-suspend coordination (`markActivity`, `maybeSuspendNow`, `wakeIfIdle`,
  `liveVoiceCount`) — it is the one place that reads both the clock's listener count and
  the voice count together.
- Construction order: `MasterRack` first, then `SynthVoices(masterRack)`,
  `DrumSynth(masterRack)`, `Clock(masterRack)`. Cross-dependencies are explicit
  constructor references, not reach-through: `SynthVoices`/`DrumSynth` connect into
  `masterRack.getSourceBus(source)` / `getSourceTap(source)` and the drum reverb send;
  `Clock` plays its click through `masterRack.masterGain`.
- Each subsystem stores its own `ctx: BaseAudioContext | null` reference, set by a
  `bind(ctx)` that `init()` calls; node maps are cleared in `setupMasterChain` exactly as
  today. Setter no-op before `bind()` is preserved.

## Facade

`AudioEngine` keeps every public method signature as a one-line delegate, e.g.
`triggerDrum(...) { return this.drumSynth.triggerDrum(...); }`. Private helpers move
entirely into their owning subsystem and never appear on the facade.
`createRenderEngine(ctx)` is unchanged.

## Test split

`engine.test.ts` (52 `describe` blocks) splits along the same lines: drum describes →
`drumSynth.test.ts`, voice/LFO describes → `synthVoices.test.ts`, master/effect/analyser
describes → `masterRack.test.ts`, clock/idle describes → the existing `clock.test.ts`.
Shared harness (`masterChainCtx`, `recordNodes`, `trimTestParams`, `SYNTH`)
moves to `engineTestHelpers.ts`; the store-backed `fxWith` fixture stays local to
`masterRack.test.ts` so the audio layer never imports store code. Test casts into private fields change path, e.g.
`(engine as any).ctx` → `(engine as any).masterRack.ctx`.

## TDD order

One subsystem at a time, green at each step, in dependency order (each step's
dependencies are already extracted):

1. `MasterRack` — the foundation: owns the ctx-bound graph, buses, analysers;
   `SynthVoices`, `DrumSynth` and `Clock` all reference it.
2. `Clock` — depends on `masterRack` (the click plays into `dryGain`).
3. `DrumSynth` — depends on `masterRack` (buses, reverb send, noise buffer).
4. `SynthVoices` — depends on `masterRack` (buses, noise buffer).

After each: run the moved cluster's tests, then the full `bun test`.

## Verification

`bun run verify` (test + lint + eslint + check:keys + check:drums + check:contrast +
check:levels + build) must pass, and `renderMixdown.test.ts` (byte-identity) must stay
green throughout. eslint must report nothing, including on the new files.

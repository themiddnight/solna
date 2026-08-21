---
name: dsp-audio
description: DSP and audio signal routing — Tone.Channel volume/pan stage, effect chain order, AudioContext lifecycle, WebKit policy, latency optimization. Also covers adding new effects (EffectType enum, factory method, stereo/mono wiring). Read before touching effects or signal routing.
---

# DSP & Audio Signal Routing Skill

Read every time before touching: effect chains, signal routing, the volume/pan stage, AudioContext, or audio latency.

**Full architecture:** `app/frontend/docs/ARCHITECTURE.md` → Audio Architecture, Stereo Effects
**Effects DSP core (TR-38):** `app/frontend/src/engine/effects/` — `model/effectType.ts` (type + `EFFECT_TYPE`), `runtime/effects/*Effect.ts` (Tone.js classes), `runtime/EffectsFactory.ts`, `runtime/MixerEngine.ts`
**Effects UI/config:** `app/frontend/src/features/effects/` — per-effect `config.ts`, `constants/effectConfigs.ts`, `stores/effectsStore.ts`, `components/`
**Audio config:** `app/frontend/src/features/audio/constants/audioConfig.ts`
**Clean-input microphone constraints (TR-38):** `app/frontend/src/engine/audio/cleanInput.ts` — `buildInputConstraints`/`acquireCleanInput`/`verifyCleanInput`, the one constraint builder behind all six `getUserMedia` call sites (voice, Arrange recording/input, three mono probes). Full matrix + verification design: `docs/WEBRTC_CAPABILITY_PROFILE.md` → Clean Mode; operational summary: `webrtc-voice` skill.

---

## Complete Signal Chain

```
Instrument (Tone.js Synth/Sampler)
  → inputGain
  → monoToStereoConverter  ← Haas Effect (0.5ms L / 1.5ms R, right at 0.95x gain)
  → [effects chain]        ← per-instrument effects (Tone.js effects)
  → toneChannel            ← Tone.Channel — dB volume + equal-power pan (live volume/pan stage)
      → stereoEffectOutput (Tone.Gain)
      → masterSendGain     ← per-channel, for ref-counted master-mute (e.g. Vocoder-ext carrier)
      → masterSum          ← getMasterInput(); where every channel lands
      → [master inserts]   ← Arrange master effect chain (DEV-323) — EMPTY today, see below
      → masterGain         ← the master fader; also the meter tap (useMasterMeter)
      → masterOut          ← unity; the capture tap (getMasterTap — recording/shadow/broadcast/mixdown)
      → outputGain         ← unity, post-tap: heard but never printed (Arrange voice lands here)
      → AudioContext.destination
```

**The master insert chain is empty today, on purpose.** DEV-323 built the runtime substrate —
`MasterAudioBus.getMasterInput()` / `setMasterInserts()` and
`MixerEngine.applyMasterEffectChainState()` — but the master strip's UI is an open design
question, so it was deferred rather than guessed. Inserts sit **before** the fader (DAW master-
strip order: the fader is clean output trim, not the thing driving a compressor) and **before**
the tap, so they are printed into every capture. `'master'` is a valid `EffectChainType` and the
effects store seeds an empty chain for it, but `effectsIntegration.getChannelIdForChain('master')`
returns `null` deliberately — the master is not a mixer user-channel, and the per-channel
add/remove path must never claim it. When the UI lands, tap `applyMasterEffectChainState`.

No limiter, auto-gain, or auto-trim on the master bus (DEV-322) — murva measures level
honestly and never corrects it automatically (TR-40 in `docs/RULES_AND_CONSTRAINTS.md`); a
`DynamicsCompressorNode` briefly sat between `masterGain` and the tap (DEV-302) and was
removed. Full rationale + reserved-stage details: `app/frontend/docs/ARCHITECTURE.md` → Master
Bus section.

Remote voice enters at `channel.voiceGain` (per-peer fader, bypassing the instrument channel's
volume/pan stage) and lands in one of two places, chosen by the room via
`MixerEngine.setVoiceRouting` (DEV-325):

| Routing | Lands on | Relative to the capture tap | Room |
|---|---|---|---|
| `mix` | the master bus's pre-insert `masterSum` (`getMasterInput()`) | upstream — **printed** into recording / shadow / HLS | Perform (BR-14: the owner's mix is the broadcast) |
| `direct` | the master bus's post-tap `outputGain` | downstream — heard, **never printed**, and outside the master fader | Arrange (a mixdown holds the project, not the chat) |

Both destinations are on the master bus; **neither passes through the peer's own channel.** That
is deliberate and easy to get wrong: `stereoEffectOutput` is also what the channel's `analyser`,
`nativeAnalyser` and `monitorTap` read, so voice landing there made talking light up the avatar's
hold-halo glow — an *instrument* signal — and would feed a peer's voice into any aux consumer
keyed on their playing. Speaking has its own indicator (the amber border, from the websocket
speaking signal); the glow stays instrument-only. Per-peer voice level is still independent
because `voiceGain` sits on the branch itself, not on the channel fader.

It is a capability, never `if (perform/arrange)` in the engine (TR-38). `MixerEngine` is a
singleton that outlives a room change, so each room asserts its mode on mount via
`useVoiceRouting`; the setter rewires peers that were already connected.

**The source is `createMediaStreamSource` off `ontrack`'s stream, not the `<audio>` element.**
`createMediaElementSource` on a MediaStream-backed element yields silence (DEV-324) — voice
never entered the graph at all for as long as that was the wiring. The element is kept and
kept playing (it is the sink that keeps the receive pipeline pulling) but muted, so voice is
heard once. On WebKit/iOS `supportsRemoteStreamWebAudio` is false and voice stays on the
direct-element path — outside the graph, and capped at unity. See the `webrtc-voice` skill.

---

## Volume + Pan (`MixerEngine.setUserVolume`/`setUserPan`)

`MixerEngine.setUserVolume(userId, volumeDb: Decibels)` / `getUserVolume(userId): Decibels | null` are **dB-native** (branded `Decibels` from `@/shared/audio/gainUnits`), applied via Tone's native `Channel.volume`. Fader range is **-60..+12 dB** (`MIXER_VOLUME_MIN_DB`/`MIXER_VOLUME_MAX_DB`, exported from `runtime/MixerEngine.ts`). `-Infinity` bypasses the clamp uncapped — it's a true mute, never coerced to `-60` (DEV-295).

`MixerEngine.setUserPan(userId, pan)` takes a plain `-1..1` number and applies it via `Tone.Channel.pan` — **equal-power pan, built into Tone.js** (TR-34: use the maintained library instead of hand-rolling a pan law). Tone's `Channel`/`Panner` **default to `channelCount: 1` + `channelCountMode: "explicit"`**, which would silently down-mix stereo input to mono before panning at every pan position — `MixerEngine` avoids this by explicitly passing `channelCount: 2` in the `Channel` constructor, which makes the internal `StereoPannerNode` operate in true stereo mode instead. This is NOT because the input has already been made "stereo enough" upstream (the Haas converter feeds mono-derived stereo either way) — without `channelCount: 2` the down-mix happens regardless of what feeds it.

```typescript
// Setting a channel's fader from a plain-number dB value — brand it via toDecibels(),
// don't cast with `as Decibels` (see @/shared/audio/gainUnits):
mixer.setUserVolume(userId, toDecibels(volumeDb)); // -60..+12, or toDecibels(-Infinity) for true mute
mixer.setUserPan(userId, pan); // -1..1, unchanged
```

This replaced a hand-rolled linear-taper L/R `GainNode` network (`ChannelSplitter` → `leftGain`/`rightGain` computed from `targetVolume`/`targetPan` → `ChannelMerger`) that used to sit downstream of the effect chain — deleted as part of DEV-305. Do not reintroduce it; `Tone.Channel` is now the live volume/pan stage.

**`track.volume` (Arrange) is now dB-native at rest too (DEV-303, shipped).** The persisted `Track.volume` field — not just the `mixer.setUserVolume(...)` boundary above — is the branded `Decibels` type, unity = 0 dB, same **-60..+12** range (0.5 dB slider step on the track header, no percent representation). `Track.volume` is **never** `-Infinity`; mute is a separate, orthogonal `muted` boolean, not encoded in `volume` — `useTrackAudioParams.ts` derives the *effective* volume passed to `mixer.setUserVolume`/`trackInstrumentRegistry.updateChannelMix` each render (`track.volume`, or `SILENCE_DB`/`-Infinity` when muted or another track is soloed). Before DEV-303 it was linear `0..1`; the format change bumped `PROJECT_SCHEMA_VERSION` 2→3. Per the beta/legacy-load policy (DEV-319, TR-40), an old file's `volume: 0.8` is **not** refused — the loudness fields are reset to current defaults on load (`legacyLoudnessReset.ts`) and the user is told; only a file from a newer build is refused. `companion.volume` (`CompanionConfig` in Perform, `CompanionRegionConfig` in Arrange) was a separate field **not** touched by DEV-303 — it stayed percent `0..100` at the time. It has since been migrated to dB-native too (DEV-304, shipped): same `-60..+12` range, unity = 0, default `-3.1` (`DEFAULT_COMPANION_VOLUME_DB`), mute kept orthogonal via the separate `isMuted` boolean. Don't assume a raw `companion.volume` read is still percent.

**Voice volume is a separate control, but the same unit.** `setVoiceVolume`/`getVoiceVolume`/`UserChannel.voiceVolumeDb` are **dB** on the same -60..+12 range as the instrument fader (DEV-324 finished the migration this had been left out of; the old linear `0..~4` API is gone). It still routes the WebRTC voice branch, not the instrument channel fader — separate control, identical semantics, so the two write sites in `UserVolumeSlider` read the same. The range constants live in `runtime/mixerVolumeRange.ts` (`MixerEngine` re-exports them) so both faders share one definition without an import cycle.

Per-user levels are **personal and never synced**, persisted in **sessionStorage** via `features/rooms/shared/stores/userVolumeStore.ts` — a refresh keeps your mix, a new session does not inherit a stale fader. Companion volume is the deliberate exception and stays synced. `VoiceVolumeController` also holds a level set before the peer's channel exists (the ordinary case on a session restore) and opens the new gain at it, rather than at unity and correcting after.

---

## Mono-to-Stereo Converter (Haas Effect)

All instruments are mono → must pass through converter before effects:

```typescript
// Haas Effect delays create stereo width
leftDelay.delayTime.value  = 0.0005;  // 0.5ms
rightDelay.delayTime.value = 0.0015;  // 1.5ms
rightGain.gain.value       = 0.95;    // slight gain difference

// Connection:
instrument → inputGain → splitter → [leftDelay, rightDelay] → merger → monoToStereoOutput
```

---

## Effect Chain

### 20 Effect Types

| Effect | Module | Stereo? |
|---|---|---|
| Reverb | `reverb/` | Mono input → stereo |
| Delay | `delay/` | Mono |
| Ping Pong Delay | `pingpongdelay/` | ✅ True stereo |
| Chorus | `chorus/` | ✅ Stereo |
| Distortion | `distortion/` | Mono |
| Compressor | `compressor/` | Mono |
| Filter | `filter/` | Mono |
| Graphic EQ | `graphiceq/` | Mono |
| Auto Filter | `autofilter/` | Mono |
| Auto Panner | `autopanner/` | ✅ True stereo |
| Phaser | `phaser/` | Mono |
| Tremolo | `tremolo/` | ✅ Stereo |
| Stereo Widener | `stereowidener/` | ✅ True stereo |
| Bit Crusher | `bitcrusher/` | Mono |
| Vibrato | `vibrato/` | Mono |
| Auto Wah | `autowah/` | Mono |
| Autotune | `runtime/effects/AutotuneEffect.ts` (pitch-aware) | Mono, stereo-gain wired |
| Vocoder | `runtime/effects/VocoderEffect.ts` (pitch-aware) | Mono, stereo-gain wired |
| Ducker | `runtime/effects/DuckerEffect.ts` (aux-input, control role) | Mono, stereo-gain wired |
| Vocoder-ext | `runtime/effects/VocoderExtEffect.ts` (aux-input, heard role) | Mono, stereo-gain wired |

**Autotune** and **Vocoder** are capped at **1 instance per chain** (`EFFECT_INSTANCE_CAPS` in `app/frontend/src/features/effects/constants/effectCaps.ts`) — the "Add" button in `EffectChain.tsx` disables and shows a toast (`Only one {effect} effect is allowed per chain`) once the cap is hit. See "Pitch-Aware Effects" below for their internals.

### Effect Chain Rebuilding

Adding/removing a single effect **patches only the adjacent edges** of the chain (DEV-347) — no full rebuild:

```typescript
// Append (patchEffectIntoChainEnd):
prev → newEffect.inputNode       // prev = last effect's output, or monoToStereoOutput when the chain was empty
newEffect.outputNode → toneChannel

// Remove (patchEffectOutOfChain):
prev → next                      // prev = previous effect's output (monoToStereoOutput when first),
                                 // next = next effect's input (toneChannel when last)
```

The empty-chain transitions are the same two-edge patch: adding the first effect repoints `monoToStereoOutput → toneChannel` onto the new effect, and removing the last effect reconnects `monoToStereoOutput → toneChannel` directly.

**Full rebuild remains the apply-state path:** `rebuildChannelChain`/`applyEffectChainState` tear down and rewire the whole chain — used for apply-state (e.g. project load), not for drag-reorder (an order change is treated as an "updated" effect and only parameters/bypass are applied). `addEffectToChannel`/`removeEffectFromChannel` accept `preventRebuild=true` to skip the edge patch, leaving the chain unwired until the caller runs the full rebuild. **No production caller passes `preventRebuild=true` today** — treat it as a reserved escape hatch, not an actively used contract.

**Visualizers tick through `meterScheduler`**, never private rAF loops: Compressor, Ducker, and GraphicEQ register at the `'track'` tier (30fps). Compressor/Ducker register **without an analyser** — `onTick` reads the effect's getter methods (`getInputLevelDb()`/`getReduction()` for compressor, `getReduction()`/`getKeyLevelDb()` for ducker) and receives a 0-length buffer. GraphicEQ registers **frequency-domain** (`domain: 'frequency'`) registrations on its own input/output analysers (`frequencyBinCount`-sized buffers). Future effect visualizers must follow this pattern.

**Effect modules resolve their runtime `AudioEffect` via the `useEffectAudioEffect` hook** (`features/effects/hooks/useEffectAudioEffect.ts`) — subscribe-based: an immediate `getAudioEffect` lookup, then `effectsIntegration.subscribe` until the first successful resolution. Replaces the per-module `setInterval` polling.

**No effect pooling:** `EffectsFactory`'s `effectPool` was removed in DEV-347 — `createEffect` always constructs fresh nodes. `releaseEffect` remains but only cleans up (`.cleanup()` + disabled), never stores for reuse.

**Order matters:** Dynamic effects (compressor, filter) should be placed before time-based effects (reverb, delay).

---

## Pitch-Aware Effects (Autotune, Vocoder)

Pitch-aware effects live under `app/frontend/src/engine/effects/pitch/` (TR-38 engine layer — **imports 0 features**, only `shared/` + Web Audio primitives):

- `PitchDetector.ts` — main-thread **AMDF** detector (`pitchfinder`), bounded to the vocal range via `PITCH_MIN_FREQ_HZ`/`PITCH_MAX_FREQ_HZ` (DEV-343). Pacing lives in `public/worklets/pitch-tap-processor.js`: the audio thread accumulates a 1536-sample window, gates on RMS (`PITCH_SILENCE_RMS`), and posts a frame at a fixed `PITCH_DETECT_RATE_HZ` (25Hz) via `port.postMessage` — independent of the display refresh, and **not throttled in a backgrounded tab**, unlike the `requestAnimationFrame` loop this replaced. `PitchDetector` decimates each posted frame 3× to 16kHz/512 (`decimation.ts`'s tested FIR + `decimateByThree()`) and runs AMDF on the decimated buffer. **AMDF itself deliberately stays on the main thread** — not because `pitchfinder` can't bundle into a worklet, but because every `AudioWorkletNode` in a context shares **one** audio-rendering thread with a ~2.7ms deadline per 128-frame quantum, and AMDF stacked across a few active detectors would turn UI jank into audible dropouts. Re-measured against the real shipped constants + the real `decimateByThree()` output (not a tone synthesized directly at 16kHz): **~0.87ms/detect at 16kHz/512**, down from **~11-14ms/detect at the pre-epic 48kHz/2048** (machine-dependent; ~13-15× cheaper — see spec §2/§3 for the full table and what's measured vs. reasoned). Worst-case pitch error through the real decimator is **21 cents**, up from **14 cents** today — a deliberate, owner-approved trade-off (21¢ is likely inaudible). A browser without `AudioWorkletNode` support falls back to a fixed-rate `setInterval` (still 25Hz, still not rAF) reading an `AnalyserNode`. Shared by both effects. Not YIN: YIN needs ~40× the fundamental period in the analysis window to lock on, so at the 2048-sample buffer it couldn't detect below ~200Hz and returned ~20kHz garbage for real voices — AMDF bounded to the vocal range tracks the real fundamental at that buffer size.
- `pitchMath.ts` — pure scale-quantize + carrier-frequency math (`quantizeFreqToScale`, `droneCarrierFreq`, `followCarrierFreq`, `diatonicDegreeFreq`). `diatonicDegreeFreq(baseFreq, scaleMask, degree)` powers both the autotune Interval and the vocoder Voices — degree 1 = unison, 3/5 = diatonic third/fifth (walks scale steps from the snapped base), 8 = exact +12 semitones. `chordCarrierFreqs` was removed (subsumed by `diatonicDegreeFreq`).
- `pitchConstants.ts` — vocoder filterbank + default scale constants, plus `PITCH_MIN_FREQ_HZ`/`PITCH_MAX_FREQ_HZ` (vocal-range bounds for AMDF).
- `VocoderCarrier.ts` — a **`Tone.FatOscillator`** supersaw pool (main bus + an octave-up layer bus), unison detune via `count`/`spread`, summed with constant-power (`1/√n`) gain. A single saw's harmonics sit ~f0 apart — wider than a bandpass band's bandwidth — leaving filterbank gaps; the dense detuned partials of a supersaw fill them, which is what makes vowels intelligible.

**Scale injection (spec Decision 2):** the room's musical key is passed into both effects as two plain numeric params — `keyRoot` (0–11, pitch class) and `scaleMask` (12-bit bitmask, one bit per chromatic pitch class) — set via the normal `setParameter()` path, same as any other effect param. This is why the engine can quantize pitch without importing Tonal or any feature-layer scale utility: the mask is computed in `features/` (sync hook) and handed down as a number.

**Vocoder** (`runtime/effects/VocoderEffect.ts`) — synchronous channel vocoder built on the supersaw carrier: a **rebuildable** filterbank (`bandCount`, default 16; `melSpacing` toggles log-vs-mel spacing; `bandQ`) splits the modulator (voice) into bands, each rectified + lowpass-filtered into an envelope that VCA-multiplies the matching carrier band. The rectifier curve is **odd-length (257)**, which is the **DC-leak fix**: an even-length (256) curve has no sample at exact zero, so silence interpolated to ~0.004 DC that kept every band's VCA slightly open — the carrier leaked audibly during silence and after Stop. The 257-sample curve puts the midpoint exactly at input=0, so silence maps to exact zero. An input-RMS **silence gate** additionally stops unvoiced noise from hissing in gaps. A **noise carrier + sibilance passthrough + HF tilt** fill in consonant intelligibility (saw energy falls off 1/n and starves the noise/consonant bands otherwise), plus a makeup/`outputGain`. **Voices** is a diatonic-degree bitmask (root/3rd/5th/octave, via `diatonicDegreeFreq`) stacked on the base note. `carrierMode` is 0=drone or 1=follow only (`PitchDetector` drives follow) — the old chord mode was dropped, subsumed by Voices. ~18 tunable params total.

**Autotune** (`runtime/effects/AutotuneEffect.ts`) — built on **Signalsmith Stretch** (`signalsmith-stretch`, an ESM/WASM `AudioWorkletNode`), not Tone.js or rubberband-web. A `PitchDetector` + `diatonicDegreeFreq` compute the target semitone offset (`12·log2(target/detected)`) each animation frame, smoothed toward `currentSemitones` by `retuneSpeed` (0 = snap, 1 = slow glide), and pushed via `schedule({ semitones, formantCompensation, ... })` — a time-map update for smooth continuous tracking, not a phase-vocoder flush like rubberband-web's `setPitch()`. Adds an **Interval** select (Root/3rd/5th/Octave, via `diatonicDegreeFreq`), a **Formant** preservation toggle, and a **Latency** (`blockMs`, default 50ms, range 10–160) control, plus a synchronous `getLatency()` that caches the node's async `.latency()` (for a future arrange offline-apply path). Retains the async worklet-splice pattern: dry passthrough on `wetGain` until the worklet resolves, then it's spliced into the wet path.

**Dependency:** the pitch-shift dependency is **`signalsmith-stretch@1.3.2`**, typed via an ambient declaration (`app/frontend/src/types/signalsmith-stretch.d.ts`) since the package ships no types. It inlines its own WASM, so there's no public worklet asset to copy. `rubberband-web` is gone entirely (it was dropped in an earlier crackle-fix pass — WASM phase-vocoder FFT bursts overran the audio thread on high-sample-rate hardware).

**Latency (creative/preview, not pro-monitoring):**
- Vocoder: ~3–10ms (synchronous filterbank + VCA path only)
- Autotune: ≈ the configured `blockMs` (default 50ms, range 10–160) plus the pitch-detection analysis window

Both are acceptable for jam/preview use in-browser but are **not** a substitute for a dedicated low-latency pitch-correction pedal/plugin in a professional monitoring chain — call this out if a feature request implies sub-10ms autotune.

---

## Aux-Input Substrate (Ducker, Vocoder-ext)

A reusable substrate (DEV-287) lets an effect pull a signal **from another source** (another user, an AI companion, or — in Arrange — another track) as a second input, resolved locally per client. **Never call this "sidechain" in code, UI copy, or docs — the canonical term is `auxInput`/`externalInput` (TR-26).**

Two consumers, both **new** effects — the existing `CompressorEffect.ts` and `VocoderEffect.ts` are untouched, no regression risk to their tuned behavior:

- **Ducker** (`runtime/effects/DuckerEffect.ts`, `control` role) — aux signal is a *key*, analyzed only, never heard: an **audio-rate** envelope follower (`public/worklets/envelope-follower-processor.js` + `runtime/effects/envelopeFollowerWorklet.ts`'s `EnvelopeFollowerWorklet`, DEV-343) computes RMS→dB→attack/hold/release entirely on the audio thread and connects its gain-envelope output straight to `duckGain.gain` — a live AudioParam connection, not `setTargetAtTime`. This replaced a control-rate rAF loop whose ~16ms granularity could not represent a 5-20ms attack; the worklet path is sample-accurate and keeps running in a backgrounded tab, where rAF would stop. On key disconnect the envelope releases toward unity (not a snap), using the same Release time constant. Params: Threshold, Attack, Release, Amount/Depth, Hold + source picker. Monitors: `getReduction()`/`getKeyLevelDb()` read the worklet's ~20Hz metering messages (not a live computation). No key / disconnected / still-registering-the-worklet → `duckGain` stays at unity (fail-open, transparent — never fail-closed). No self-sidechain (resolver + picker guard).
- **Vocoder-ext** (`runtime/effects/VocoderExtEffect.ts`, `heard` role) — modulator is the normal voice input; carrier is an **external** node (another user's/companion's synth) feeding the per-band bandpass bank in place of the internal supersaw. Self-contained — does not import from or modify `VocoderEffect.ts` (re-implements its own band engine; reuses only the read-only `pitch/VocoderCarrier` + `pitch/pitchConstants`/`pitchMath`). Internal supersaw is an **automatic fallback** (not user-selectable) on disconnect / broken link / carrier-silence RMS gate — the vocoder never goes silent. Carrier picker v1 = companion + own synth only (remote-human carrier deferred, see below).

**Interface edge** (`engine/effects/runtime/audioEffectTypes.ts`) — optional `AudioEffect` methods, mirroring the DEV-230 optional-monitor pattern:

```ts
export type AuxRole = 'control' | 'heard';
connectAuxInput?(node: AudioNode, role: AuxRole): void;
disconnectAuxInput?(): void;
getKeyLevelDb?(): number;  // ducker key-level meter, mirrors getInputLevelDb
```

The runtime effect never stores the ref — it only receives a live `AudioNode` via `connectAuxInput`. Ref→node resolution and wiring live in the feature tier (TR-38: engine stays room-agnostic).

**Serialized link** — `AuxInputRef` (`app/frontend/src/shared/types/index.ts`, next to `EffectInstanceState`) round-trips through save/sync:

```ts
interface AuxInputRef {
  kind: 'user' | 'companion' | 'track';
  id: string;                          // userId | companion.id | trackId
  sourceKind: 'instrument' | 'voice';  // recorded now; per-user isolation is DEV-289
}
```

**Room resolver** (`features/effects/services/auxInputResolver.ts`) — every channel in both rooms exposes a post-effects `monitorTap: GainNode` on the shared `MixerEngine`, so resolution is just `mixer.getChannelMonitorTap(channelId)`:
- **Perform**: `companion` → `` `companion-${id}` `` channel; `user` → `userId` channel (that user's **instrument** only — remote voice lands on the master bus, not the channel, so it never reaches `monitorTap`; see limitation below). `track` refs → n/a (null).
- **Arrange**: `track` → `trackId` channel (clean — voice and each instrument are separate tracks/channels). `user`/`companion` refs → n/a (null).
- No-self guard: resolving to the effect's own channel returns `null` (treated as broken → graceful fallback); the source picker (`components/AuxSourceSelect.tsx`) also excludes self up front.

**Source picker** (`components/AuxSourceSelect.tsx`) branches on `room`:
- **Perform** → band members (`kind:"user"`) + companions (`kind:"companion"`). `instrumentOnly` (Vocoder-ext carrier + Ducker key in v1) restricts to companion + own synth.
- **Arrange** → the arrange track list (`kind:"track"`, id = trackId); every track is a clean channel, so any track but the effect's own is offerable. `allowedSourceKinds` filters by the track's *derived* kind (`audio → voice`, `midi → instrument`), which mirrors the save-rewrite so a saved ref round-trips. `instrumentOnly` doesn't apply here.

**Perform→Arrange save-rewrite** (`features/rooms/shared/utils/sessionToCollabConverter.ts`) — at the point an effect chain is retargeted from a per-user channel to `` `track:${trackId}` ``, each `auxInput` ref is rewritten from `user`/`companion`+channel to `{kind:'track', trackId}` using a channelId→trackIds map built while tracks are created. If no matching saved track exists, `auxInput` is **omitted** (graceful fallback on load), not left dangling.

**v1 limitation (DEV-289, now a standalone main task):** in Perform a user's **voice has no independently tappable/gain-controlled presence** in the mixer (voice bypasses it for latency). So in Perform both Vocoder-ext's carrier picker **and the Ducker key** are instrument-only (companion + own synth) — voice sources are deferred to DEV-289, which will give voice a lightweight parallel tap + gain (also fixing the band-member volume slider ignoring voice, DEV-290). Arrange is unaffected — every track is already a clean channel, so the picker offers all tracks there.

**Vocoder-ext carrier behavior:**
- **No carrier = silent.** There is no internal fallback carrier — the whole wet path (bands + noise + sibilance) runs through one `carrierPresenceGain` a watcher holds at 0 until a live external carrier is detected (RMS ≥ threshold). No link / broken link / silent carrier ⇒ silent output. (`carrierPresent(rms, threshold)` is the pure decision.) Replaced the original never-silent supersaw drone, which read as a stray root-note tone.
- **"Mute carrier in mix"** (`muteCarrierInMix` on the effect, default ON): silences the carrier track in the main mix while it still feeds the vocoder via the tap, so you hear only the vocoded result. Implemented with a dedicated `masterSendGain` per channel on the master branch only (`stereoEffectOutput → masterSendGain → master`; `monitorTap` taps `stereoEffectOutput` in parallel). Muting via volume/the M button would starve the tap (post-fader) — use this instead. `MixerEngine.setChannelMasterMuted(channelId, requesterId, muted)` is ref-counted by requester and idempotent; the aux reconciler drives it per vocoderext effect and releases the previous carrier on link change / mute-off / effect removal / room teardown. The Arrange track header badges a muted carrier ("carrier") so its silence isn't mysterious.

No WS/API/DB contract changes — `auxInput`/`muteCarrierInMix` are frontend-only fields on the existing generically-serialized effect-params blob (see `docs/superpowers/specs/2026-07-28-dev287-aux-input-substrate-design.md` for the full design).

---

## AudioContext Lifecycle

### Context Creation

```typescript
// 2 separate contexts — DO NOT share
const instrumentsCtx = new AudioContext({
  latencyHint: "interactive",  // minimize latency
  sampleRate: 48000
});
const voiceCtx = new AudioContext({
  latencyHint: "interactive",
  sampleRate: optimalSampleRate // 44100 on iOS/Safari, 48000 elsewhere (webrtc capabilities)
});
```

### WebKit / iOS Policy

```typescript
// AudioContext must only `.resume()` after a user gesture.
// DO NOT create/resume in `useEffect` without user interaction.

// Correct pattern:
async function handleUserInteraction() {
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
}

// Arrange Room: Deferred loading — wait for first user interaction.
// Perform Room: Eager loading — load immediately on join (but still resume after gesture).
```

### Suspend/Resume: What stops and what doesn't

When `AudioContext.suspend()` is called:
- `MediaStream`s and `HTMLMediaElement`s outputs are **ignored** (data is lost, not buffered)
- `AudioWorkletNode`s and `ScriptProcessorNode`s **stop processing**
- They resume when `AudioContext.resume()` is called
- `AnalyserNode` treats the stream as continuous — suspend/resume does not introduce silence

### ScriptProcessorNode — DEPRECATED

`createScriptProcessor()` is **deprecated** per the W3C spec. Do **not** add new uses.

Use `AudioWorkletNode` instead (runs on the audio thread — no main thread jank):

```typescript
// Load the worklet module once (requires user gesture or async init)
await audioCtx.audioWorklet.addModule('/processors/my-processor.js');

// Instantiate as a normal AudioNode
const workletNode = new AudioWorkletNode(audioCtx, 'my-processor');
source.connect(workletNode).connect(audioCtx.destination);
```

The project does not use `ScriptProcessorNode` directly — Tone.js handles synthesis internally. If custom DSP processing is ever needed, use `AudioWorkletNode`.

### Tone.js Context Sync

```typescript
// Tone.js must use the same context that was created
import * as Tone from "tone";
Tone.setContext(instrumentsCtx);
```

---

## Performance Config (`audioConfig.ts`)

```typescript
const audioConfig = {
  sampleRate: 48000,
  lookAhead: 0.005,
  updateInterval: 0.005,
  maxPolyphony: 16,             // 16 simultaneous notes per user
  haasDelayLeft: 0.0005,        // 0.5ms
  haasDelayRight: 0.0015,       // 1.5ms
};
```

---

## Adding a New Effect

### Step 1: Add the Effect Type

In `app/frontend/src/engine/effects/model/effectType.ts` — `EffectType` is a **string union type** with an enum-style `EFFECT_TYPE` const accessor (not a TS `enum`). Add your value to both:

```typescript
export type EffectType =
  | "reverb"
  // ... existing
  | "myeffect";

export const EFFECT_TYPE = {
  // ... existing
  MYEFFECT: "myeffect",
} as const satisfies Record<string, EffectType>;
```

### Step 2: Create a Modular Effect File

Create a new file in `app/frontend/src/engine/effects/runtime/effects/MyEffect.ts` (same factory-function pattern as the existing `ReverbEffect.ts`, `DelayEffect.ts`, …):

```typescript
import * as Tone from "tone";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";

export function createMyEffectEffect(context: AudioContext, id?: string): AudioEffect {
  const myEffect = new Tone.MyEffect({
    // parameters...
  });

  const inputNode = myEffect.input as any;
  const outputNode = myEffect.output as any;

  const parameters = new Map<string, EffectParameter>();
  parameters.set("wetLevel", {
    name: "Wet Level",
    value: myEffect.wet.value,
    min: 0,
    max: 1,
    unit: "%",
  });

  return {
    id: id || `myeffect_${Date.now()}`,
    type: EFFECT_TYPE.MYEFFECT,
    name: "My Effect",
    enabled: true,
    parameters,
    inputNode,
    outputNode,
    wetGainNode: outputNode,
    dryGainNode: inputNode,
    bypass: false,

    process(input: AudioNode): AudioNode {
      input.connect(this.inputNode);
      return this.outputNode;
    },

    setParameter(name: string, value: number): void {
      const param = this.parameters.get(name);
      if (!param) return;
      const v = Math.max(param.min, Math.min(param.max, value));
      param.value = v;
      switch (name) {
        case "wetLevel":
          myEffect.wet.setValueAtTime(v, context.currentTime);
          break;
        // handle other parameters...
      }
    },

    getParameter(name: string): number | undefined {
      return this.parameters.get(name)?.value;
    },

    enable(): void {
      this.enabled = true;
      const wetLevel = this.parameters.get("wetLevel")?.value || 0.5;
      myEffect.wet.setValueAtTime(wetLevel, context.currentTime);
    },

    disable(): void {
      this.enabled = false;
      myEffect.wet.setValueAtTime(0, context.currentTime);
    },

    cleanup(): void {
      try {
        (myEffect as any).dispose?.();
      } catch {
        // ignore
      }
    },
  };
}
```

### Step 3: Register in `EffectsFactory.ts`

Import the factory function and add it to the `createEffect` registry inside `app/frontend/src/engine/effects/runtime/EffectsFactory.ts`:

```typescript
import { createMyEffectEffect } from "./effects/MyEffect";

// Inside class EffectsFactory:
static createEffect(type: EffectType, id?: string): AudioEffect | null {
  // ...
  switch (type) {
    // ...
    case EFFECT_TYPE.MYEFFECT:
      return createMyEffectEffect(this.context, id);
    // ...
  }
}
```

### Step 4: Add to Effects Catalog (for UI)

In `app/frontend/src/features/effects/constants/effectConfigs.ts`, add an entry to `EFFECT_CONFIGS` (params, ranges, defaults) and place it in `EFFECT_ORDER` so it appears in the UI effects panel.

### Step 5: Create UI config

Add `app/frontend/src/features/effects/<effect-name>/config.ts` (per-effect UI config). The chain UI (`components/EffectModule.tsx`) renders the controls from that config — a custom component is only needed for special visualizers (e.g. `graphiceq/`).

### Step 6: Wire UI param names → engine keys (for any param the engine reads)

A UI param's `name` (e.g. `"Retune Speed"`) is **not** the engine's `setParameter` key (e.g. `retuneSpeed`). The bridge normalizes the name — `name.toLowerCase().replace(/[^a-z0-9]+/g, "_")` — then looks it up per effect type in **two maps that must stay in sync** (change one, change the other):

- `app/frontend/src/features/effects/services/effectMappings.ts` → `PARAMETER_MAP` (perform + audio-input bridges)
- `app/frontend/src/engine/effects/runtime/effectParameterMapping.ts` → `EFFECT_PARAMETER_NAME_MAP` (`MixerEngine`)

Add your effect's `{ normalized_name: engineKey }` entries to **both**. A normalized name that resolves to no key (or the wrong key) is a **silent dead control** — nothing errors, the knob just does nothing. Watch for name↔key mismatches (UI `"Latency"` → normalized `latency` → engine key `blockMs`). Lock it with a test that normalizes every config param name and asserts it resolves to the expected engine key in **both** maps. (`wetLevel` is scaled `/100` only when the config param's `max === 100`; a `0..1` Dry/Wet reaches the engine as `0..1`.)

**Control types** (`EffectParameter.type`): `knob` (default) · `slider` · `select` (enum: `options: string[]`, the option's **array index IS the numeric value** — option order must match the engine's numeric encoding) · `buttons` (bitmask multi-toggle: `bits: {bit,label}[]`, rendered by the shared `@/shared/ui` `ButtonGroup`, XOR-toggles each bit). Optional `group?: string` renders a divider; `EffectModule` renders ungrouped params first, then each group. Effect-config `name`/`options`/`group` are **bare strings** (rendered raw, not Lingui-wrapped) — the established lint-clean pattern for effect configs.

### Stereo vs Mono Wiring Rules

**Stereo effects** (PingPongDelay, AutoPanner, Chorus, Tremolo, StereoWidener):
- Use `Tone.Gain` for input/output — NOT native `GainNode`
- Use Tone.js built-in `wet` property — don't create separate wet/dry gain nodes
- Connect using Tone.js `connect()` method (ensures stereo signal flow)

**Mono effects** (Filter, Compressor, Distortion, etc.):
- Can use native `GainNode` for input/output
- Use `createStereoGainNode()` helper if stereo preservation is needed
- Manual wet/dry mixing acceptable

### Testing Checklist

- [ ] Effect loads without console errors
- [ ] Effect audio is audible
- [ ] Parameters update correctly
- [ ] Enable/disable bypasses correctly
- [ ] Volume/pan sliders work with effect active
- [ ] Multiple effects in chain work
- [ ] For stereo effects: L/R difference audible on headphones, pan interaction correct

---

## Tempo-Sync Effects (DEV-231)

Tempo-aware effects (delay/echo, autopan) can express time in **beat units** that track the room BPM, instead of only ms/Hz. Infrastructure lives in `app/frontend/src/features/effects/tempoSync/tempoSyncConfig.ts` + `hooks/useEffectTempoSync.ts`.

- **Push, not pull (TR-38).** Engine effects stay room-agnostic and keep consuming plain seconds/Hz. A feature-layer hook (`useEffectTempoSync`, mirroring `usePitchEffectScaleSync`) reads the room BPM + each effect's `Unit`/`Division` params, derives the value via shared `quarterNoteMs` (TR-23 — no hand-rolled tempo math), and pushes it into the live engine effect with `setParameter`. Wired once per room next to the pitch sync (Perform BPM = `useMetronomeStore`, Arrange BPM = `arrangeProjectStore`).
- **Params.** `tempoSyncParams()` appends two persisted `select` params to an effect's config: `Unit` (ms|beat — `beat` is the synced state) + `Division` (note value). They round-trip as ordinary `EffectParameterState` — no shared-type change. The **derived** seconds/Hz are never persisted (recomputed per client from the room-synced BPM).
- **Opt an effect in:** add a `TempoSyncDescriptor` entry to `TEMPO_SYNC_EFFECTS` (`{ engineParam, baseParamName, mode: 'duration'|'rate' }`) and append `...tempoSyncParams()` to its config. `duration` → seconds (delay time); `rate` → Hz, one LFO cycle per division (autopan). The shared `TempoSyncSection` (rendered by `EffectModule`) then shows `[Unit ms|beat] ── [Division | base knob]` for free — the base ms/Hz knob is shown in ms mode, the `Division` select in beat mode. Currently opted in: **Delay** + **PingPongDelay** (duration), **AutoPanner** (rate, DEV-235).
- **C0 forward-compat load:** `convertEffectInstanceState` rebuilds params from the full current config and overlays saved values by name, so params added later (like `Unit`/`Division`) appear on old saves.

## Dry/Wet Mixing (single mechanism)

Every effect blends dry/wet through the **one** shared equal-power helper, never through a Tone effect's internal `.wet`:

- Create `wetGain`/`dryGain` nodes (use `createStereoGainNode` for stereo effects) and wire them with `connectToneEffect(inputGain, toneEffect, wetGain, dryGain, outputGain)`.
- In `setParameter('wetLevel')`, `enable()`, and `disable()`, call `applyWetDry(wetGain, dryGain, wet, context)` (disable → `wet = 0`). Never hand-set linear `wetGain=v; dryGain=1-v` — that taper is louder/quieter at the midpoint and drifts from the rest of the catalog.
- If the Tone class exposes `.wet` (extends `Effect`), set it to **1** at construction so it stays fully wet and the wrapper owns the blend. Do NOT use `effect.wet` for the user-facing Dry/Wet — it fragments the taper (this is why Reverb and PingPongDelay were rewired).

**Default by role — three tiers** (a new effect picks one):
- **Tier A — pure transform** (Vibrato, Tremolo, AutoPanner): the effect already has a **Depth**/intensity knob, so it exposes **no Dry/Wet knob** and runs 100% wet. Removing the config `Dry/Wet` param is not enough — the engine wrapper must init `wetGain=1 / dryGain=0` and default its internal `wetLevel` param to `1`, or `applyEffectParameters` (which no longer has a param to push) leaves it stuck at the `0.5` init.
- **Tier B — insert / spectral processor** (Filter, AutoFilter, AutoWah, Distortion, BitCrusher, StereoWidener, Compressor): keep the `Dry/Wet` knob, default **1.0** (full wet; a filter/compressor that only half-applies is a bug). Config-only — the present param drives the `1.0` on load. GraphicEQ is Tier B with no knob (always full wet).
- **Tier C — send / time / modulation** (Reverb, Delay, PingPong, Chorus, Phaser): keep the knob, default **0.5** — their sound comes from blending against dry.

**Exception — internal latency:** effects with real lookahead/latency (e.g. the Autotune Signalsmith worklet) must NOT raw-mix a dry path (it combs against the latency-shifted wet). They stay 100% wet with their own handling.

## Common Mistakes

1. **Sharing AudioContext between instruments and voice** — always use separate contexts.
2. **Creating AudioContext without user gesture (WebKit)** — crashes in iOS Safari.
3. **Forgetting to rebuild effect chain** — when adding/removing an effect, you must reconnect the entire chain.
4. **Wrong effect order** — compressor/filter should always come before reverb/delay.
5. **Using `createScriptProcessor()`** — W3C deprecated; use `AudioWorkletNode` for any new custom DSP processing.
6. **Assuming MediaStream survives suspend** — data is lost (not buffered) during `AudioContext.suspend()`.
7. **Adding an `EffectParameter` field without updating `convertParameterState`** (`features/effects/stores/effectsStore.ts`) — it rebuilds each param **field-by-field** (does NOT spread), so a new field (`options`/`bits`/`group`/…) is silently dropped on project save-reload and collaborator sync, breaking the affected controls even though a freshly-added effect looks fine locally. Restore the field from the config `referenceParam` there too. **General rule: adding a field to a shared type → grep for every place that rebuilds it field-by-field.**
8. **Even-length WaveShaper rectifier curve** — an even array has no sample at exact input=0, so silence maps to a small DC offset that leaks through the VCA (audible carrier during silence / after Stop). Use an **odd** length so the midpoint lands on zero (the vocoder uses 257).
9. **pitchfinder `YIN` for vocals** — needs ~40× the fundamental period in the window, so below ~200 Hz at a 2048 buffer it returns ~20 kHz garbage. Use **`AMDF`** bounded to the vocal range (`minFrequency`/`maxFrequency`) instead.
10. **A worklet RPC method typed as sync when it's async** — e.g. Signalsmith's `start`/`schedule`/`configure` return Promises; calling them fire-and-forget trips `no-floating-promises`. Type them `Promise<unknown>` in the ambient `.d.ts` and `void` the calls. (Repo-wide `bun run lint` catches this cross-file; the per-file pre-commit hook does not.)
11. **Tone.Channel/Panner default to `channelCount: 1` + `channelCountMode: "explicit"`** — this silently down-mixes stereo input to mono before panning, at every pan position, not just extremes. Always pass `channelCount: 2` explicitly when using a Tone.Channel/PanVol/Panner as a live stereo stage.

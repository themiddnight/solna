# Polyphony Headroom and Limiting — Why Dense Chords Clip and How to Fix It

Date: 2026-08-23. Scope: master gain chain of `src/audio/engine.ts` (setupMasterChain, triggerSynthNoteOn), chord/bass voice stacking from `src/components/ChordView.tsx`, drum gains in `src/audio/drumKits.ts`; W3C Web Audio spec sections on `DynamicsCompressorNode` and `GainNode`; standard practice from iZotope, Sound On Sound, and the Yamaha Sound Reinforcement Handbook. Verified no Tone.js — `package.json:13-39` lists only `tonal` (a music-theory lib); all audio is raw Web Audio API.

Sources are cited inline per claim as [spec], [web-audio], or [standard practice].

## 1. The problem, with this repo's numbers

### 1.1 Current master chain (engine.ts)

```
source buses (getSourceBus, base gain 1.0, engine.ts:564-578)
        │  setSourceGain allows up to 1.5× per bus (engine.ts:600)
        ▼
dryGain (1.0, engine.ts:223-224)  ◄─ metronome clicks 0.6/0.35 (engine.ts:335)
        ▼
EQ lowshelf/peaking/highshelf (0 dB, engine.ts:206-220)
        ▼
DynamicsCompressorNode (engine.ts:198-203): threshold −12 dB, knee 30, ratio 4,
        attack 0.003 s, release 0.25 s
        ▼
masterGain = 0.8 (engine.ts:190-191)
        ▼
analyser → destination (engine.ts:272-273)
```

Notes on what already exists:
- A compressor **is** present (engine.ts:198-203) — but it is configured as a *glue* compressor, not a limiter (see §3.3/§3.4 for the distinction).
- The only fixed attenuation in the whole chain is `masterGain = 0.8` (−1.94 dB) at the very end (engine.ts:191), **after** the compressor. Nothing protects the compressor input from overdrive (Web Audio processes in 32-bit float, so intermediate nodes don't clip — only the final output does; the W3C spec frames compression as the tool "to control the overall signal level and help avoid clipping (distorting) the audio output to the speakers", https://webaudio.github.io/web-audio-api/#DynamicsCompressorNode).
- No velocity/polyphony compensation exists anywhere: grep for `sqrt|polyphon|voiceCount|activeVoices.size` in `src/audio/` returns nothing. Chords trigger every voice at the same fixed velocity.

### 1.2 How many voices stack, worst case

| Layer | Voices | Per-voice peak amplitude | Source |
|---|---|---|---|
| Chord (max 7 notes — tonal's longest chord intervals, e.g. maj13, `generateBlockChordNotes` musicTheory.ts:346-361) | up to 7 | main osc path `velocity × 0.4` (engine.ts:398) with velocity fixed at 0.8 (ChordView.tsx:483-484) = **0.32**; both osc1 and oscSub sum *before* the envelope gain (engine.ts:428-432), so total = 0.32 × (1 + `subOscVolume`) | engine.ts:394-400, 428-432; subOscVolume ranges 0.1–0.8 across presets (synthPresets.ts:102, 131, 160, 189, 218) |
| Bass (mono — older bass voice killed, engine.ts:355-359) | 1 | same formula, ≤ 0.32 × (1 + sub) ≈ 0.58 | engine.ts:344-398 |
| Drums (kick + snare + hats can coincide) | 3+ | kick gain up to **1.0** (drumKits.ts:92), snare 0.5–0.7, hats 0.32–0.45 | drumKits.ts:63-107 |
| Metronome click | 1 | 0.6 downbeat (engine.ts:335) | engine.ts:327-341 |

Per-voice peak at max subOscVolume: 0.32 × 1.8 = **0.576**.

Worst-case peak pre-compressor:
- Fully coherent (all oscillators in phase — worst case, e.g. sub of a higher chord tone coinciding with a lower chord tone): 7 × 0.576 + 0.576 (bass) + 1.0 (kick) ≈ **5.6** ≈ **+15 dB**.
- Realistic (chord tones are different frequencies, partially incoherent): ≈ √7 × 0.576 + bass/drums ≈ 1.5–2.2 ≈ **+3.6 to +7 dB**.

### 1.3 Why the current chain still clips

The compressor (engine.ts:198-203) with threshold −12 dB and knee 30 dB transitions to its linear 4:1 region above knee-top = threshold + knee/2 = **+3 dB** (curve math per [spec], §2.1). Above that:

```
output dB = 3 + (input dB − 3) / 4        (4:1 region)
then masterGain 0.8  →  −1.94 dB
```

| Pre-compressor peak | Post-compressor | After masterGain 0.8 | Result at destination |
|---|---|---|---|
| +6 dB (dense but realistic) | +3.75 dB | **+1.8 dB** | clips |
| +12 dB (coherent worst case) | +5.25 dB | **+3.3 dB** | clips hard |
| +15 dB (absolute worst) | +6 dB | **+4.1 dB** | clips hard |

Headroom after the compressor is only −1.94 dB (masterGain 0.8), so **any** pre-compressor peak above ≈ +8 dB still crosses 0 dBFS. A 7-note chord at velocity 0.8 with default sub levels, plus bass and a kick, is comfortably past that. Conclusion: today the compressor shapes tone but cannot prevent clipping — there is no real headroom or protection in the master chain.

## 2. What the Web Audio API provides (primary sources)

### 2.1 DynamicsCompressorNode — exact semantics [spec]

All from the W3C spec, https://webaudio.github.io/web-audio-api/#DynamicsCompressorNode (section "The DynamicsCompressorNode Interface", incl. `DynamicsCompressorOptions`):

| Param | Spec default | Allowed range | Meaning (spec text) |
|---|---|---|---|
| threshold | **−24 dB** | −100…0 | "the decibel value above which the compression will start taking effect" |
| knee | **30 dB** | 0…40 | "range above the threshold where the curve smoothly transitions to the 'ratio' portion" |
| ratio | **12** | 1…20 | "amount of dB change in input for a 1 dB change in output" |
| attack | **0.003 s** | 0…1 | "time (in seconds) to reduce the gain by 10 dB" |
| release | **0.25 s** | 0…1 | "time (in seconds) to increase the gain by 10 dB" |
| reduction | 0 (read-only) | — | "current amount of gain reduction ... for metering purposes" |

Processing-model facts [spec]:
- **The compression curve has three parts: identity, a monotonically-increasing soft-knee portion, then a linear part `f(x) = x/ratio`.** So above the knee the slope is exactly 1/ratio — there is no hard ceiling, which is why a compressor is not a limiter unless ratio is pushed near its max.
- **Fixed look-ahead**: "Fixed look-ahead (this means that an `DynamicsCompressorNode` adds a fixed latency to the signal chain)." It also has a tail-time: "this node continues to output non-silent audio with zero input due to the look-ahead delay." [web-audio] — so the node catches transients slightly *before* they arrive, at the cost of a few ms of latency (browser-dependent).
- Side-chaining is **not** supported.
- The spec explicitly endorses this node for exactly this app's problem: compression is "especially important in games and musical applications where large numbers of individual sounds are played simultaneous to control the overall signal level and help avoid clipping (distorting) the audio output to the speakers."
- Maximum ratio is **20:1** — a true brickwall limiter (∞:1) is impossible with this node alone.

This repo's compressor (engine.ts:198-203) keeps spec defaults for attack/release (0.003/0.25) but raises threshold to −12 dB and lowers ratio to 4 — a classic glue-compressor profile (§3.3), with the caveat that with knee 30 the "soft" zone is huge (spans −27 dB to +3 dB).

### 2.2 GainNode — exact semantics [spec], [web-audio]

- `GainNode.gain` is "the amount of gain to apply", default **1**, and it is an **a-rate AudioParam** — a per-sample, linear (unitless) multiplier: MDN, https://developer.mozilla.org/en-US/docs/Web/API/GainNode ("The gain is a unitless value ... multiplied to each corresponding sample"). It is not in dB; 0 = silence, 1 = unity, values >1 boost.
- MDN warns: setting `.value` directly causes clicks; use `setTargetAtTime` / exponential ramps. This repo already does (engine.ts:588-589, 599-600 use `setTargetAtTime` with 10 ms time constant) — good.
- Practical consequence for gain staging [web-audio]: since gain multiplies per-sample, N voices at peak `g` sum to between `g·√N` (incoherent) and `g·N` (coherent) — the same summing math as analog (§3.2). Halving per-voice gain only buys −6 dB; the *scaling with N* is what needs engineering.

### 2.3 Where clipping actually happens [web-audio]

Web Audio processes the graph in floating point; intermediate nodes have effectively unlimited headroom. Clipping occurs when the summed signal exceeds ±1.0 at the `AudioDestinationNode` / hardware output — distortion is baked into the speaker path and cannot be undone later. (MDN `AudioDestinationNode` documents only channel-count constraints; the clip-at-destination behavior follows from the float graph rendering to fixed-point hardware.) The practical target therefore is: **keep the post-master-chain peak ≤ 1.0 (0 dBFS) at all times**, not "keep the sum under 1.0 at every node".

## 3. Standard sound-engineering practice

### 3.1 Gain staging and headroom [standard practice]

- iZotope, "Gain Staging", https://www.izotope.com/en/learn/gain-staging.html: gain staging is "the process of making sure the audio is set to an optimal level for the next processor in the chain"; the standard digital operating level is **around −18 dBFS** per track (≈ −18 dBFS = the 0 VU sweet spot of analog-modeled processors), with peaks left headroom; the master rule: "make sure the output of the master bus doesn't hit 0 dBFS" because a file that exceeds 0 dBFS "permanently encodes the distortion."
- Yamaha Sound Reinforcement Handbook (Davis & Jones), full text at https://archive.org/stream/YamahaSoundReinforcementHandbookByGaryDavisRalphJones (headroom section §4.2; quoted via the same text): **20 dB of headroom is the recommended minimum for high-quality music** (10–15 dB suffices only for simple speech/background systems), because program peaks typically sit 10–25 dB above what an average-level meter shows. Dynamic range = peak level − noise floor.
- Synthesis for a synth like this [standard practice]: design per-voice levels so that the *fullest voicing* (7-note chord + bass + drums at max velocity) sums to roughly −18 dBFS RMS with peaks around −6 dBFS, i.e. leave 6–10 dB of peak headroom above nominal before the master.

### 3.2 Summing math: how N voices multiply level [standard practice]

Yamaha SRH (same source): "as a general rule, for each doubling of the [source] size, the [level] will increase by between 3 dB and the theoretical maximum of 6 dB" — 3 dB per doubling for incoherent signals (power adds), 6 dB for coherent/correlated ones (amplitude adds). Implications, applied here [standard practice]:
- 2× voices → +3 to +6 dB; 8× voices → +9 to +18 dB. That is exactly the gap between a single note and a full 7-note chord with sub oscillators (+8.5 dB incoherent → +17 dB coherent).
- Per-voice compensation must therefore be **non-linear in voice count**: cutting each voice by 1/N (amplitude-sum, `1/n`) keeps the coherent worst case flat; cutting by 1/√N (equal-power, used in constant-power pan laws and most polyphonic voice-normalization) keeps the *power* flat and is the standard compromise because real chord tones are mostly incoherent.
- Which to pick is a musical trade-off, not a correctness issue: `1/n` makes chords quieter-sounding (power drops with N), `1/√n` keeps perceived loudness constant [standard practice].

### 3.3 Bus / glue compression [standard practice]

Sound On Sound, "The SOS Guide To Mix Compression", https://www.soundonsound.com/techniques/sos-guide-mix-compression: the standard mix-bus profile is a **low ratio (1.5:1 to 2:1)** with medium attack/release, threshold set for **only 1–3 dB of gain reduction**; release should be matched to the tempo of the groove; too-fast attack "can make the mix sound dark and flat, pushing drums behind the speakers." Purpose: "glue" — cohesive level control, not protection.

This repo's compressor (ratio 4, threshold −12) is hotter than the glue norm but still in glue territory; its job per SOS would be tone/glue, which means it should *not* be expected to catch peaks.

### 3.4 Limiters as the safety net [standard practice]

Same SOS guide: "Even the fastest conventional attacks won't catch digital transients — that's for mastering-stage limiters." The limiter is the industry-standard final protection: a hard-ceiling device (ratio 10:1 and up, effectively ∞:1, threshold just below 0 dBFS) placed last in the master chain, doing nothing in normal operation and catching only overs. Trade-offs SOS flags: over-limiters pump and flatten dynamics; a heavily-limited mix stays limited even if you later turn it down ("if you're bringing down the output of a limited bus or track, it will still sound limited" — iZotope, §3.1).

### 3.5 Standard vs web-audio-specific, summary

| Practice | Classification | Primary source |
|---|---|---|
| −18 dBFS operating level, ~6–10 dB peak headroom, keep bus off 0 dBFS | standard practice (broad consensus) | iZotope; Yamaha SRH (20 dB headroom for music) |
| +3 dB / doubling (incoherent), +6 dB (coherent) | standard practice (physics, universal) | Yamaha SRH |
| Glue bus compressor: 1.5–2:1, 1–3 dB GR, tempo-matched release | standard practice | SOS |
| Master limiter as final safety net | standard practice | SOS |
| DynamicsCompressorNode as the compressor/limiter, its defaults, lookahead latency, ratio cap 20 | web-audio specific | W3C spec |
| Per-voice 1/√N equal-power scaling | standard practice (synth voice normalization); mechanics differ per engine | Yamaha SRH math; iZotope staging |

## 4. What this repo does today — audit

| Control | Value | Location | Verdict |
|---|---|---|---|
| Per-voice peak | velocity × 0.4 (0.32 @ vel 0.8) | engine.ts:398 | Hot: 7 voices + sub = 4× a single note |
| Voice-count compensation | **none** | (grep across src/audio: empty) | Missing — root cause |
| Sub oscillator | subOscVolume 0.1–0.8, summed pre-envelope | engine.ts:396, 428-432; synthPresets.ts | Compounds the multiplier (×1.8 worst case) |
| Bus gains | 1.0 default, clamped 0…1.5 | engine.ts:569, 600 | User can push +3.5 dB per bus |
| Drums | kick up to 1.0 | drumKits.ts:92 | Full-scale source competing with everything |
| Glue compressor | −12 dB, knee 30, ratio 4, 3 ms / 250 ms | engine.ts:198-203 | Good glue, not protection |
| Master headroom | masterGain 0.8 = −1.94 dB, after compressor | engine.ts:191, 271-272 | The only "headroom" — insufficient (§1.3) |
| Limiter | **none** | — | Missing — safety net |

## 5. Recommendations for THIS codebase

Ranked by (impact / effort). The industry-standard combination is **(a) + (b) + (d)**, with (c) kept as a tone tool.

### (a) Per-voice gain compensation as chord size grows — do this first

Where: the chord trigger loop, `src/components/ChordView.tsx:483-484` (`for (const note of chord.notes) engine.triggerSynthNoteOn(note, params, 0.8, 0, 'chord')`).

- Divide the per-voice velocity by **1/√n** (equal-power) as the default, with **1/n** as the conservative option: `engine.triggerSynthNoteOn(note, params, 0.8 / Math.sqrt(notes.length), 0, 'chord')`.
- 7-note chord: 1/√7 → −8.5 dB per voice → worst-case sum drops from +12 dB to ≈ +3.5 dB (coherent) / ≈ −5 dB (incoherent) — alone this mostly solves the problem [standard practice].
- Do **not** scale bass or drums (mono / fixed kit — they only add a constant); scale only the chord layer, which is where N grows. Consider additionally shaving the base factor 0.4 → 0.3 (engine.ts:398) to reclaim ~2.5 dB on every voice.
- Trade-off: `1/n` makes big chords audibly quieter than small ones; `1/√n` keeps loudness roughly constant — the standard choice.

### (b) Fixed headroom in the staging — cheap, do together with (a)

- Lower `masterGain` (engine.ts:191) from 0.8 to **0.5–0.63** (−6 to −4 dB) as a deliberate ceiling, and/or drop per-voice 0.4 factor (engine.ts:398) to 0.25–0.3. Target: the densest realistic voicing peaks around **−6 dBFS** before the compressor (−18 dBFS RMS) [standard practice].
- Trade-off: lowers maximum loudness; zero CPU; keeps the compressor input healthy (compressor overdrive is what pumps/darkens).

### (c) Keep the existing glue compressor, don't lean on it

- Current settings (engine.ts:198-203) are fine for glue; if it is meant purely as glue, ease ratio 4 → 2–3 to match the SOS 1.5–2:1 norm with 1–3 dB gain reduction [standard practice].
- Do not raise its ratio to do protection duty: with ratio 4 and knee 30 the "knee top" sits at +3 dB, so it starts clamping mid-level material while still letting peaks through (§1.3). Its lookahead latency is paid regardless [web-audio].

### (d) Master limiter as the final safety net — the piece actually missing

Web Audio has no dedicated limiter; the standard web-audio implementation is a second `DynamicsCompressorNode` after `masterGain` (engine.ts:271-272 region), or a gentle final WaveShaper soft-clip.

Concrete starting parameters [web-audio] (ranges per spec §2.1):

| Param | Starting value | Rationale |
|---|---|---|
| threshold | −6 to −3 dB | Only catches overs; normal material untouched |
| ratio | 20 (the spec max) | Steepest slope available; not brickwall, but with lookahead it's close |
| knee | 0–6 dB | Hard-ish knee = more ceiling-like |
| attack | 0.001–0.003 s | Fast; the node's fixed lookahead covers the rest |
| release | 0.1–0.25 s | Short enough not to pump at 120 BPM (0.5 s/beat) |

Watch the `reduction` property for metering; if it reads > 3 dB often, the limiter is doing staging work and (a)/(b) should be tightened instead [web-audio, standard practice]. Alternative pure safety net: a WaveShaper with a mild soft-clip curve (the repo already builds curves, `makeDistortionCurve` engine.ts:276-286 — reuse the shape with k ≈ 0.5–1 so it's transparent below −1 dBFS).

Trade-offs, in order of importance:
- **Pumping on drums**: any compressor after a kick at 120 BPM with release > 0.25 s will pump; the limiter's job is to be *mostly idle*, which it is if (a)/(b) are done. If you hear pumping from the limiter, staging is wrong, not the limiter [standard practice].
- **Latency**: the compressor's fixed lookahead adds a few ms to the whole chain (browser-dependent) [web-audio] — fine for playback/scheduled patterns, relevant if you add live low-latency playing.
- **CPU**: DynamicsCompressorNode is implemented natively in the browser; cost is negligible [web-audio].

### Bottom line

1. `1/√n` velocity scaling for the chord layer (ChordView.tsx:484) — the root cause fix.
2. Master ceiling of −4 to −6 dB (engine.ts:191) — one line.
3. Keep the existing glue compressor as-is (engine.ts:198-203).
4. Add a ratio-20, threshold −3 dB, hard-knee DynamicsCompressorNode after masterGain as a mostly-idle safety net.

That is the standard configuration: per-voice compensation + staging headroom at the source, glue for tone, limiter as insurance.

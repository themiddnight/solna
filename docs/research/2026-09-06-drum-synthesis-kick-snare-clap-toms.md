# Drum synthesis reference: kick, snare, clap, toms

Research for the `hitom`/`lowtom` split and the drum-voice retune. Sourced where a claim is
about how a real instrument or a real machine works; explicitly marked **unsourced —
engineering judgement** where it is my own inference from the numbers.

Every source URL is listed once in [Sources](#sources) and referenced inline by number.

---

## 0. What the code actually does today

Read: `src/audio/engine.ts` lines 1560–1760 (`drumEnv`, `drumTone`, `drumNoiseBurst`,
`noiseStartOffset`, `triggerDrum`) and lines 88–96 (`DRUM_ALIASES`), plus all of
`src/data/drumKits.ts`.

### The three primitives

| primitive | what it builds |
|---|---|
| `drumEnv(peak, decay, t, shape?)` | `GainNode`. `setValueAtTime(max(ENV_FLOOR, peak), t)` → optional `shape(gain.gain)` hook → `exponentialRampToValueAtTime(ENV_FLOOR, t + max(0.01, decay))`. `ENV_FLOOR = 0.0001` (`src/audio/constants.ts:15`). **Attack is a hard discontinuity — there is no attack ramp anywhere.** |
| `drumTone({type?, freq, freqEnd?, pitchTime?, peak, decay, t, stopAt?})` | One `OscillatorNode` (defaults to `sine`; only the snare body passes `'triangle'`) → `drumEnv`. Pitch: `setValueAtTime(freq, t)` then, only if `freqEnd` is given, `exponentialRampToValueAtTime(freqEnd, t + (pitchTime ?? 0.05))`. **A single ramp — constant cents-per-second — that completes at `t+pitchTime` and then holds flat.** No filter on the tone path. |
| `drumNoiseBurst({filterType, freq, q?, peak, decay, t, stopPad?, reverbSend?, shape?})` | Looped white-noise buffer source (2 s, uniform `Math.random()*2-1`, `createNoiseNode`, engine.ts:1806) started at a random offset → **one** `BiquadFilter` → `drumEnv`. One filter only: there is no way to bound the noise on both sides. |

Both primitives end at `wireDrumVoice(env, reverbSend)`: dry into `drumBusFilter`, plus an
optional per-voice send gain into `drumSendFilter`.

### The four voices under study

| voice | construction in `triggerDrum` |
|---|---|
| `kick` | `drumTone` sine, `freqStart → freqEnd` over `pitchTime`, decay `decay`. Then, **only if `clickFreq && clickLevel` are both set**, a second `drumTone`: a *static sine* at `clickFreq` (no `freqEnd`) with decay `clickDecay ?? 0.01`. |
| `snare` | `drumTone` **triangle**, `bodyFreqStart → bodyFreqEnd` over `bodyTime`, decay `bodyDecay`, `stopAt = t + bodyDecay + 0.05`; plus `drumNoiseBurst` **highpass** at `noiseFilter`, decay `noiseDecay`, `reverbSend`. |
| `clap` | one `drumNoiseBurst`, **bandpass, Q = 1.5**, at `filter`, with a hardcoded `shape`: `setValueAtTime(peak*0.25, t+0.012)`, `setValueAtTime(peak*1.1, t+0.024)`. |
| `tom` | one `drumTone` sine, `freqStart → freqEnd` over `pitchTime`, decay `decay`. Nothing else. |

### Five measured facts that matter

1. **`DRUM_ALIASES` already maps `lowtom → tom`** (engine.ts:92–96). The split cannot just add
   two voices; it has to remove that alias, or `lowtom` will silently keep resolving to the old
   single tom. `engine.test.ts:1709` asserts every alias target is a real drum type.
2. **`bodyTime` is `0.08` in all 13 kits** (`DEFAULT_DRUM_KIT` + 12 entries). It has never been
   tuned; it is a copy-pasted constant.
3. **Only 4 of 13 kits have a kick click at all** — `909 Modern`, `Chrome Pulse`, `Warehouse`,
   `Acoustic Studio`. `DEFAULT_DRUM_KIT.kick` sets no click params, so the other nine kicks have
   *only* the pitch-swept sine, and their entire attack is the `drumEnv` discontinuity.
4. **Today's `tom` spans `freqStart` 120–180 Hz → `freqEnd` 65–110 Hz** across the 13 kits, with
   `pitchTime` 0.10–0.30 and `decay` 0.16–0.45.
5. **The clap's `shape` schedules plateaus, not bursts.** `setValueAtTime` holds a *constant*
   value until the next event, so the envelope is: flat at `peak` for 12 ms, flat at `0.25·peak`
   for 12 ms, then a jump to `1.1·peak` at 24 ms which exponentially decays to the floor. Three
   levels, none of which decay individually, and **the loudest event is the last one**.

---

## 1. The kick

### 1.1 How the three families actually differ

| | TR-808 | TR-909 | acoustic |
|---|---|---|---|
| generator | one **bridged-T network** — a 2-pole self-oscillating notch/bandpass with feedback, excited by a ~1 ms pulse; it rings and dies on its own [2][3][4] | a **VCO with three separate contour generators** — one each for pitch, amplitude, and click [5] | head + shell modes, damped |
| pitch envelope | the envelope raises the bridged-T's centre frequency **for the first few milliseconds only** (~6 ms), then a retrigger pulse is injected into the network centre [1 summary][4] | a *pronounced* pitch modulation; the gap between the pitched attack and the low sustain is where the punch lives [6] | beater impact then rapid settle to fundamental |
| click | none as a separate path — the click is the pulse discontinuity itself | **a short burst of filtered noise on its own contour** [5][6] | beater/pedal attack, energy centred **~3.5 kHz** [11] |
| body | near-sine, very long ring | shorter, harder | 45–80 Hz fundamental depending on shell size [10][11] |

Acoustic kick fundamentals, by size, medium tuning [10]:

| shell | low | medium | high |
|---|---|---|---|
| 18″ | 60 | 70 | 80 |
| 20″ | 55 | 65 | 75 |
| 22″ | 50 | 60 | 70 |
| 24″ | 45 | 55 | 65 |

Sound On Sound's summary of the two machines is the single most useful line for us: the 909
needs *three* contours because pitch, amplitude and click are independent paths, whereas the 808
"produces a sound that decayed to silence" from one ringing network [5]. **Solna's model is
already the 909 topology** (separate pitch ramp, separate amplitude env, separate click voice) —
it is just tuned as if it were the 808 in every kit.

### 1.2 What actually creates the "808 sub" character

Not the sweep. The sweep is over in single-digit milliseconds [1][4]; the character is the
**long, steady, near-sine tail at a definite pitch** that follows it. This is confirmed from the
production side: producers transpose the whole song to fit the TR-808 bass drum rather than tune
the drum, precisely because the 808 BD has a *limited usable pitch range if its characteristic
sound is to be preserved* — its spectral formant and register are treated as fixed and the music
moves around it [1]. A sound you have to write the song around is a sound with a pitch.

**Consequence for solna, and this is the biggest single mis-tune in `drumKits.ts`:**

| kit | `pitchTime` | `decay` | what it sounds like |
|---|---|---|---|
| `Sub Weight` | **0.35** | 0.60 | 350 ms of continuous downward glide under a 600 ms decay — more than half the note is a *falling pitch*. This is a bass slide, not a kick. |
| `Trap Beat` | **0.30** | 0.65 | same problem |
| `Warm Riddim` / `Lo-Fi Vinyl` / `DEFAULT` | 0.12–0.14 | 0.25–0.35 | audible "dooo" bend |

The fix is not to shorten the decay — the long decay *is* the 808 — but to **collapse
`pitchTime`** so the glide is over before the ear locks onto the tail's pitch.

### 1.3 Where the boundary sits between a kick and a bass note

Sourced part: the 808 BD's pitch is musically load-bearing enough that songs get transposed to
it [1]; a 22″ acoustic kick's fundamental is 50–70 Hz [10], i.e. G#1–C#2, squarely in bass
register. So the frequency alone never settles it — a bass note and an 808 kick occupy the same
octave.

Unsourced — engineering judgement, the operational rule I would code to:

| total decay | pitch of the tail | reads as |
|---|---|---|
| < 0.25 s | irrelevant | a kick, period |
| 0.25–0.50 s | weakly perceived | a kick with sub |
| > 0.50 s **and** `pitchTime / decay < 0.1` | clearly perceived | **a bass note** — it must be in the song's key |
| > 0.50 s **and** `pitchTime / decay > 0.3` | smeared | a falling glide; neither, and usually a mistake |

`pitchTime / decay` for the current kits: `Sub Weight` 0.58, `Trap Beat` 0.46, `Warm Riddim`
0.56, `Lo-Fi Vinyl` 0.40, `DEFAULT` 0.34. **Every long-decay kit in the library is in the
"smeared" band.**

If a kick's decay exceeds ~0.5 s, `freqEnd` should be a note frequency, not a round number:

| note | Hz |
|---|---|
| D1 | 36.71 |
| E1 | 41.20 |
| F1 | 43.65 |
| F♯1 | 46.25 |
| G1 | 49.00 |
| A1 | 55.00 |
| C2 | 65.41 |

### 1.4 Click values per family

Note the structural problem first: solna's click is a **static sine** at `clickFreq`. A 1200 Hz
sine decaying over 15 ms is a pitched blip, not a click. Both the 909 and the acoustic beater
click are broadband — filtered noise [5][6] and a ~3.5 kHz transient [11] respectively. Within
today's parameters you can only pick where the blip sits; the real fix is item **B3** below.

| family | `clickFreq` | `clickLevel` | `clickDecay` | why |
|---|---|---|---|---|
| 808 | *omit entirely* | — | — | the 808 has no separate click path [5] |
| 909 | 1600 | 0.30 | 0.008 | 909's click is the defining difference [6]; short and mid-high |
| acoustic | 3500 | 0.22 | 0.006 | beater attack sits at 3.5 kHz [11] |
| lo-fi / boom-bap | 900 | 0.15 | 0.012 | dulled tape/vinyl attack — unsourced, engineering judgement |
| trap 808 | *omit* | — | — | trap 808s are 808 kicks; the attack comes from a layered sample, which solna does not have |

---

## 2. The snare

### 2.1 The physics the machines are copying

An acoustic snare's tonal component is dominated by the head's **(0,1) mode, which produces two
partials at roughly 180 Hz and 330 Hz**. The TR-808, the TR-909 and the standard SH-101 snare
patch all use *two* oscillators at those two frequencies [7]. The 808 realises this as two
bridged-T oscillators tuned about an octave apart [8][9] — original schematic values give
~173 Hz and ~499 Hz, with a later component revision bringing the high one down to ~335 Hz [9].
Noise is separate: white noise through a highpass, with a "snappy" contour attenuated and summed
back into the trigger for both oscillators [9].

Acoustic snare fundamentals [10]:

| shell | low | medium | high |
|---|---|---|---|
| 13″ | 190 | 210 | 235 |
| 14″ | 175 | 200 | 225 |

Mix reference: body/fatness 150–200 Hz, crack/snap ~5 kHz [11]. SOS gives an empirical starting
balance of roughly **35 % tone to 65 % noise** [7].

### 2.2 What the current kits get wrong

- **`DEFAULT_DRUM_KIT.snare` sweeps 220 → 90 Hz over 80 ms.** That is a 2.4:1 downward glide —
  tom behaviour, not snare behaviour. The (0,1) partials are fixed modes; a snare's tone barely
  bends [7]. `bodyFreqEnd` should sit within ~15 % of `bodyFreqStart`.
- **`bodyTime = 0.08` everywhere.** Should be 0.010–0.030.
- **The noise is highpass-only.** There is no upper bound, so every snare's noise runs to
  Nyquist. This is why a lo-fi snare is unreachable today: "lo-fi" means a *band*, not a floor.
- **There is only one body oscillator.** The 180/330 pair is the whole reason the machines sound
  like snares [7]; one triangle cannot produce it.

### 2.3 Body/noise balance by genre

`noise:body` is `noiseGain / bodyGain`.

| family | `bodyFreqStart` | `bodyFreqEnd` | `bodyTime` | `bodyDecay` | `bodyGain` | `noiseFilter` | `noiseDecay` | `noiseGain` | noise:body | `reverbSend` |
|---|---|---|---|---|---|---|---|---|---|---|
| tight gated 80s | 250 | 215 | 0.020 | 0.10 | 0.55 | 1400 | 0.18 | 0.75 | 1.36 | 0.50 |
| deep acoustic | 200 | 180 | 0.030 | 0.22 | 0.60 | 1100 | 0.28 | 0.55 | 0.92 | 0.30 |
| trap | 240 | 210 | 0.012 | 0.06 | 0.30 | 2200 | 0.16 | 0.85 | 2.83 | 0.10 |
| lo-fi | 180 | 165 | 0.030 | 0.14 | 0.50 | 700 | 0.13 | 0.35 | 0.70 | 0.25 |
| 909 | 240 | 205 | 0.020 | 0.12 | 0.45 | 1800 | 0.22 | 0.70 | 1.56 | 0.25 |
| 808 | 190 | 175 | 0.020 | 0.14 | 0.50 | 900 | 0.12 | 0.45 | 0.90 | 0.20 |

Reading of the axes (frequency numbers sourced to [7][9][10][11]; the per-genre assignment is
engineering judgement):

- **Genre lives in `noise:body`, not in frequency.** Trap ≈ 2.8, gated 80s ≈ 1.4, acoustic and
  808 ≈ 0.9, lo-fi ≈ 0.7. Frequency moves far less than gain ratio does.
- **`noiseFilter` is the second axis**: 700 Hz (lo-fi, dark) → 2200 Hz (trap, thin and bright).
- The gated 80s snare is *not* a snare setting — it is gated, heavily compressed room ambience
  cut off by a noise gate with hold ≈ 150 ms and release ≈ 148 ms [12][13]. Our
  `reverbSend: 0.5` approximates the send but nothing gates the return; see **B8**.

### 2.4 Rimshot and cross-stick

They are two different sounds and the distinction matters for reggae and jazz:

- **Rimshot**: stick strikes head and rim simultaneously — loud, with a strong pitched crack.
- **Cross-stick** (a.k.a. "rim click"): stick tip rests on the head near the bearing edge, shaft
  strikes the opposite rim. Produces a **dry, high-pitched click similar to claves** [14]. This
  is the reggae/jazz sound.

The TR-808 builds its rimshot from **two inharmonic bridged-T tones at 1667 Hz and 455 Hz**,
summed into a VCA with a percussive envelope and highpassed to remove the low end [15]. Others
synthesise it from 3–4 sines or triangles at inharmonic ratios with separate decays [16].

**Verdict: not reachable from `SnareParams` today** — the snare body is a *single* triangle and
its noise is broadband highpass. A rimshot is two inharmonic tones with almost no noise.

**But it becomes free the moment a second body oscillator exists** (item **B5**). With
`bodyFreqStart2`/`bodyGain2` added, a rimshot is just a snare preset:

| | `bodyFreqStart` | `bodyFreqEnd` | `bodyFreqStart2` | `bodyTime` | `bodyDecay` | `bodyGain` / `bodyGain2` | `noiseFilter` | `noiseDecay` | `noiseGain` |
|---|---|---|---|---|---|---|---|---|---|
| rimshot (808) | 455 | 440 | 1667 | 0.006 | 0.09 | 0.45 / 0.55 | 3000 | 0.03 | 0.15 |
| cross-stick | 780 | 760 | 2400 | 0.004 | 0.045 | 0.55 / 0.35 | 4000 | 0.020 | 0.10 |

455/1667 sourced to [15]; the cross-stick numbers are **unsourced — engineering judgement**,
derived from [14]'s "dry, high-pitched click similar to claves" (claves sit around 800 Hz
fundamental with a strong upper partial) plus a decay short enough to read as a click.

Recommendation: **do not add a separate `rimshot` voice class.** Add the second body oscillator
to `SnareParams` and expose rimshot/cross-stick as *drum types that read from a second
`SnareParams` block* in the kit. One code path, two presets.

---

## 3. The clap

### 3.1 Why a real clap is several bursts

A single human clap is a very short event: acoustically it is the rapid formation and excitation
of a **cavity between the two hands**, modelled reliably as a Helmholtz resonator [17][19];
Fletcher models the initial radiation as a shock-front from the expelled air jet [20]. The whole
useful waveform of a flat clap is on the order of **~22 ms** [19], and Repp's 1987 study
established eight clapping modes by hand configuration: a **flat clap is broadband out to about
10 kHz**, whereas a **domed clap has a subsidiary spectral maximum below 1 kHz and rolls off
above it much faster** [17][18].

So a single clap is not several bursts. **The multi-burst envelope is the drum machines'
simulation of several people clapping not-quite-together** — it is explicitly described that way
in the circuit literature [21], and it is why a machine clap can stand in for a snare while a
single sampled clap cannot.

### 3.2 What the machines actually schedule

From the 808 service-manual walkthrough [22]:

| stage | value |
|---|---|
| trigger pulse total | **30 ms** |
| pulse cycle | **10 ms** → **3 fast envelopes** at 0 / 10 / 20 ms |
| each discharge shape | **sawtooth** envelope (instant attack, linear-ish decay) — *not* a plateau |
| final discharge | **uninterrupted, 20 ms**, beginning at t + 30 ms |
| sawtooth envelope total | 50 ms |
| "reverb" envelope decay | **100 ms** |
| bandpass centre | **1000 Hz** (B5 + 21 ¢) |

Corroborating figures: "four times in rapid succession, each repeat roughly 11 ms apart" and a
four-part volume envelope [21][23]; the clamping AD envelope closes at about 40 ms, giving three
full iterations **with diminishing amplitudes** [23][24].

The 909 clap circuit is **nearly identical to the 808's** — the clap section is essentially the
same and only the "reverb" section differs; the real difference is the noise source (808 analogue
transistor noise vs 909 digital noise, with different divider and gain values) [21].

### 3.3 What solna gets right and wrong

| | current | correct | verdict |
|---|---|---|---|
| burst count | 3 events | 3 bursts **+ 1 tail** = 4 [21][22] | **wrong** — the tail is being spent as burst 3 |
| spacing | 12 ms | 10–11 ms [21][22] | close, slightly wide |
| burst shape | flat plateau (`setValueAtTime` holds) | sawtooth: attack then decay [22] | **wrong** — a plateau on noise is a gate, which reads as "noise chopped", not "hands" |
| amplitude order | 1.0, 0.25, **1.1** | diminishing [23] then a quiet long tail | **wrong** — loudest event is last |
| filter | bandpass, Q 1.5, 900–2800 Hz | bandpass ~1000 Hz [22] | right in kind; most kits are set too high |
| decay | 0.15–0.35 | tail ≈ 100 ms + room [22] | reasonable |
| tail | none distinct | 20 ms discharge + 100 ms reverb envelope [22] | missing as a distinct stage |

### 3.4 Concrete replacement schedule

Because `drumEnv` calls `shape(gain.gain)` *before* appending its closing exponential ramp, the
whole corrected envelope is schedulable through the existing `shape` hook — no new primitive is
needed. `peak` is already velocity-scaled.

```
t + 0.000  setValueAtTime(peak)            <- drumEnv already does this
t + 0.008  exponentialRampToValueAtTime(peak * 0.05)   burst 1 decays
t + 0.010  setValueAtTime(peak * 0.85)                 burst 2
t + 0.018  exponentialRampToValueAtTime(peak * 0.05)
t + 0.020  setValueAtTime(peak * 0.70)                 burst 3
t + 0.028  exponentialRampToValueAtTime(peak * 0.05)
t + 0.030  setValueAtTime(peak * 0.55)                 tail starts
           <- drumEnv's exponentialRampToValueAtTime(ENV_FLOOR, t + decay)
```

With `decay` ≈ 0.28–0.32 the tail runs ~250 ms from t+30 ms, which houses the 20 ms discharge
plus the 100 ms reverb envelope [22] with room to spare. The 2 ms gaps between a completed ramp
and the next `setValueAtTime` are the inter-burst silence — that is what makes them read as
separate hands.

### 3.5 909-style clap vs live crowd clap

| | 909/808-style | live crowd |
|---|---|---|
| bursts | 3 + tail [22] | 6–12 |
| spacing | 10–11 ms, **regular** [21][22] | 15–45 ms, **jittered** |
| jitter | none (it is a fixed oscillator [23]) | large — that irregularity *is* the crowd |
| bandpass centre | 1000 Hz [22] | ~700 Hz, from the domed-clap sub-max below 1 kHz [17] |
| Q | 1.5 (current) | ~0.7 — flat claps are broadband to 10 kHz [17] |
| tail | 100 ms envelope [22] | 400 ms–1 s of room |
| `reverbSend` | 0.15–0.30 | 0.45–0.60 |

The single highest-value knob for "crowd" is **jitter on the burst times** — regular 10 ms
spacing is unmistakably a machine. `Math.random()` is already used in `audio/` by
`noiseStartOffset()`, so this is legal in that layer.

---

## 4. Toms, for the hi/low split

### 4.1 What frequencies toms actually occupy

Acoustic fundamentals [10]:

| drum | size | low | medium | high |
|---|---|---|---|---|
| rack tom | 10″ | 120 | 140 | 165 |
| rack tom | 12″ | 95 | 115 | 140 |
| rack tom | 13″ | 85 | 105 | 125 |
| floor tom | 14″ | 80 | 95 | 115 |
| floor tom | 16″ | 65 | 80 | 100 |
| floor tom | 18″ | 55 | 70 | 85 |

Aggregate ranges quoted elsewhere: rack toms 85–190 Hz, floor toms 55–115 Hz [10]. Mix
reference: floor-tom body ~70–120 Hz, rack-tom body 200–500 Hz (that is the *shell/body* region,
above the fundamental), boxiness 300–600 Hz, attack 4–6 kHz [11][25].

TR-808 toms [26]:

| | frequency range | centre | decay |
|---|---|---|---|
| high tom | 165–220 Hz | 185 Hz | **100 ms** |
| mid tom | 120–160 Hz | 135 Hz | **130 ms** |
| low tom | 80–100 Hz | 90 Hz | **200 ms** |

**This confirms the brief.** Today's `tom` (`freqEnd` 65–110 Hz) is in the 808's *low* tom band
and the acoustic *floor* tom band. It is already a low tom; there is no high tom in the kit.

### 4.2 How a synthesized tom differs from a kick beyond frequency

Three things, and only one of them is frequency:

1. **The pitch envelope is far shallower.** The 808's tom sweep comes from diodes starving the
   bridged-T as its feedback dies, producing a *subtle* downward drift; the design target is
   stated as "less like a boing, more like a tonk" [26]. Solna's toms sweep 140 → 65 Hz — a
   **2.15:1 ratio, about 13 semitones**. That is kick-depth modulation on a tom, and it is the
   main reason a tom hit currently reads as a small kick. A kick wants 2.5–4.5:1; a tom wants
   roughly **1.25–1.45:1** (4–6 semitones). *The 1.25–1.45 figure is unsourced — engineering
   judgement, derived from [26]'s qualitative "subtle".*
2. **A tom has a noise/skin component; the 808 tom explicitly does.** "The tom is the same as the
   conga except for different tunings and the addition of some filtered noise" — pink noise
   through its own VCA whose decay is **slightly longer** than the oscillator's, deliberately
   subtle enough that most listeners will not consciously notice it [26]. Solna's tom is a bare
   sine with no noise at all. This is the second reason it sounds like a kick.
3. **A tom rings with overtones; a kick is deliberately near-sine.** Rack-tom "body" is quoted at
   200–500 Hz for a drum whose fundamental is 85–165 Hz [11] — i.e. the audible body is
   *harmonics above the fundamental*. A sine cannot supply them; a triangle can supply the odd
   ones cheaply (`drumTone` already accepts `type`).

### 4.3 Hi tom / low tom values that read as one kit

**The rule** (so future kits stay coherent):

| relation | value | source |
|---|---|---|
| `hitom.freqEnd / lowtom.freqEnd` | **1.9–2.1** (≈ one octave) | 808: 185 / 90 = 2.06 [26] |
| `lowtom.decay / hitom.decay` | **1.8–2.0** | 808: 200 / 100 = 2.0 [26] |
| `freqStart / freqEnd`, both toms | **1.35** — the *same* ratio | shallow sweep [26]; the exact figure unsourced |
| `pitchTime` | hi ≈ 0.7 × low | unsourced — engineering judgement (smaller head settles faster) |
| `gain` | identical, ±0.05 | unsourced — same drummer, same mic |

**The derived table.** `lowtom` keeps today's `freqEnd`, `decay` and `gain`; `freqStart` is
recomputed at 1.35× and `pitchTime` clamped into 0.08–0.14.

| kit | low `freqStart` | low `freqEnd` | low `pitchTime` | low `decay` | hi `freqStart` | hi `freqEnd` | hi `pitchTime` | hi `decay` | `gain` (both) |
|---|---|---|---|---|---|---|---|---|---|
| DEFAULT | 88 | 65 | 0.14 | 0.28 | 167 | 124 | 0.10 | 0.15 | 0.70 |
| Retro Drive | 115 | 85 | 0.14 | 0.22 | 219 | 162 | 0.10 | 0.12 | 0.65 |
| 909 Modern | 119 | 88 | 0.12 | 0.20 | 225 | 167 | 0.08 | 0.11 | 0.65 |
| Trap Beat | 101 | 75 | 0.14 | 0.30 | 193 | 143 | 0.10 | 0.17 | 0.70 |
| 808 Vintage | 108 | 80 | 0.14 | 0.25 | 205 | 152 | 0.10 | 0.14 | 0.65 |
| Chrome Pulse | 149 | 110 | 0.10 | 0.22 | 230 | 170 | 0.07 | 0.12 | 0.65 |
| Velocity Breaks | 128 | 95 | 0.10 | 0.16 | 244 | 181 | 0.07 | 0.09 | 0.60 |
| Sub Weight | 97 | 72 | 0.14 | 0.40 | 185 | 137 | 0.10 | 0.22 | 0.70 |
| Warehouse | 124 | 92 | 0.10 | 0.18 | 236 | 175 | 0.07 | 0.10 | 0.65 |
| Tight Pocket | 122 | 90 | 0.10 | 0.18 | 231 | 171 | 0.07 | 0.10 | 0.65 |
| Acoustic Studio | 135 | 100 | 0.14 | 0.45 | 230 | 170 | 0.10 | 0.25 | 0.75 |
| Warm Riddim | 101 | 75 | 0.14 | 0.35 | 193 | 143 | 0.10 | 0.19 | 0.60 |
| Lo-Fi Vinyl | 95 | 70 | 0.14 | 0.30 | 180 | 133 | 0.10 | 0.17 | 0.55 |

Two hand-adjustments already applied, because the mechanical 1.9× collided with the snare:
`Chrome Pulse` (snare `bodyFreqEnd` 200) and `Acoustic Studio` (snare `bodyFreqEnd` 220) have
their `hitom.freqEnd` capped at 170 rather than 209/190. **Guard to encode:
`hitom.freqEnd ≤ 0.85 × snare.bodyFreqEnd`** — otherwise the hi tom and the snare body sit on
the same note and a fill turns to mud. Unsourced — engineering judgement.

`check:drums` asserts the 12 kits stay audibly distinct; adding two voices means its per-voice
distance metric has to cover `hitom`/`lowtom` instead of `tom`, or the split will pass
vacuously.

### 4.4 Does a descending fill need more than two toms?

**Two are enough here, because the kit already brackets them.** The four voices' resting
fundamentals form a descending ladder with no gaps [10][26]:

| step | voice | Hz (proposed) |
|---|---|---|
| 1 | snare body | 175–235 |
| 2 | hi tom | 124–181 |
| 3 | low tom | 65–110 |
| 4 | kick | 45–70 |

A snare → hi tom → low tom → kick fill is a **four-step descent** covering roughly two octaves,
which is the shape a listener recognises as a fill. The classic 3-tom kit gives a fifth step; the
marginal gain is small next to the cost of a third voice, a third grid row and a third
`check:drums` distance pair.

Caveat, **unsourced — engineering judgement**: with only two toms, a fill needs the *snare* on
its first step to read as descending. Two toms alone at the end of a bar read as "two hits", not
"a fall". The five grids that currently place two tom hits at the end of a bar should therefore
be re-authored as snare → hi → low, or hi → hi → low, not just hi → low. That is a drum-grid
change, not an engine change.

---

## 5. Parameter proposal

### (a) Achievable by re-tuning existing parameters — no code change

Ordered by how wrong the current value is.

**A1 — Collapse `kick.pitchTime`.** The 808's sweep is over in ~6 ms [1][4]; ours runs
50–350 ms. Target `pitchTime ≤ 0.1 × decay`.

| kit | now (`pitchTime` / `decay`) | proposed `pitchTime` |
|---|---|---|
| Sub Weight | 0.35 / 0.60 | **0.035** |
| Trap Beat | 0.30 / 0.65 | **0.040** |
| Warm Riddim | 0.14 / 0.25 | **0.025** |
| Lo-Fi Vinyl | 0.12 / 0.30 | **0.030** |
| DEFAULT | 0.12 / 0.35 | **0.030** |
| 808 Vintage | 0.10 / 0.45 | **0.035** |
| Acoustic Studio | 0.09 / 0.30 | **0.012** |
| 909 Modern | 0.06 / 0.28 | **0.020** |
| Chrome Pulse | 0.06 / 0.35 | **0.020** |
| Retro Drive | 0.07 / 0.20 | **0.018** |
| Warehouse | 0.05 / 0.30 | **0.018** |
| Velocity Breaks | 0.05 / 0.16 | **0.015** |
| Tight Pocket | 0.05 / 0.14 | **0.015** |

Where `pitchTime` shortens, `freqStart` should *rise* to keep the attack audible — a 20 ms sweep
from 95 Hz is nearly inaudible. `909 Modern` 95 → **200**; `Acoustic Studio` 160 → **260**;
`Warehouse` 110 → **190**; `Tight Pocket` 110 → **180`.

**A2 — Pin long-decay kicks to a note.** `Sub Weight` `freqEnd` 38 → **36.71** (D1);
`Trap Beat` 42 → **41.20** (E1). See §1.3.

**A3 — Snare: stop the body glide.** Every kit: `bodyTime` 0.08 → **0.02**, and
`bodyFreqEnd ≥ 0.85 × bodyFreqStart`. The two that break this badly:
`DEFAULT` 220 → 90 becomes **220 → 195**; `808 Vintage` 190 → 160 becomes **190 → 175**.

**A4 — Snare: separate the genres by `noise:body`, not by frequency.** Apply §2.3. The current
library spans only 1.2–2.0; it should span 0.7–2.8.

**A5 — Clap filter down to ~1 kHz.** The 808/909 bandpass is 1000 Hz [22]. `Acoustic Studio`
2800 → **1400** (a real clap, not the machine, so keep it brighter); `Chrome Pulse` 1800 →
**1300**; `909 Modern` 1600 → **1100**; `Warehouse` 1600 → **1200**.

**A6 — Kick clicks on the nine kits that have none.** Apply the §1.4 table. Adding
`clickFreq: 3500, clickLevel: 0.22, clickDecay: 0.006` to `Acoustic Studio`-family kits is a
pure data edit that costs nothing.

### (b) Additions — new parameters or engine changes

Ranked by audible payoff per unit of implementation work. "Work" is my estimate in engine-file
terms; `S` = one small function change, `M` = a new parameter path through `drumKits.ts` +
`triggerDrum` + kit data, `L` = a new voice or a new primitive.

| # | change | unit / range | audible difference bought | work |
|---|---|---|---|---|
| **B1** | **Rewrite the clap `shape` callback** — 3 decaying bursts + a distinct tail, per §3.4. No new parameter. | — | The single largest change in the list. A machine clap instead of a chopped-noise gate; also stops the current inversion where the *last* event is the loudest. | **S** |
| **B2** | **`hitom` / `lowtom` split.** Add both to `DrumKit`; delete `lowtom` from `DRUM_ALIASES`; migrate `tom` → `lowtom`; extend `check:drums`; add the grid row. Values in §4.3. | — | Descending fills become expressible at all. Required by the brief. | **M** |
| **B3** | **`kick.clickType: 'tone' \| 'noise'` + `kick.clickFilter`** (Hz, 800–8000). When `'noise'`, route the click through `drumNoiseBurst` (highpass) instead of `drumTone`. | Hz | Turns the 909 and acoustic kicks from "sine + blip" into a real attack. The 909's click *is* filtered noise [5][6]; the acoustic beater is a 3.5 kHz transient [11]. Both primitives already exist — this is a branch, not new DSP. | **S** |
| **B4** | **`snare.noiseTop`** (Hz, 2000–16000) — a second biquad (lowpass) after the existing highpass in `drumNoiseBurst`, or a `filterType2` option. | Hz | Unlocks the lo-fi snare, which is currently unreachable: today the noise is highpass-only and runs to Nyquist, so every kit's snare is equally bright on top. | **S** |
| **B5** | **`snare.bodyFreqStart2` / `bodyFreqEnd2` / `bodyGain2`** — a second `drumTone` for the (0,1) partial pair. | Hz, Hz, 0–1 | This is *the* structural thing the machines do that we do not [7][9]. It also delivers **rimshot and cross-stick for free** as snare presets (§2.4) — reggae and jazz, at no extra voice class. Highest payoff of any single added parameter. | **M** |
| **B6** | **`tom.noiseLevel` + `tom.noiseFilter`** (0–0.4; Hz 200–2000, lowpass), noise decay = `1.15 × decay`. | 0–1, Hz | The stick/skin sound. The 808 tom has exactly this and describes it as deliberately subtle [26]. Second-biggest reason our toms read as small kicks (after sweep depth, which A-list retuning fixes). | **S** |
| **B7** | **`clap.burstCount` / `burstSpacing` / `burstJitter` / `tailLevel`** | 2–12 / 6–45 ms / 0–1 / 0–1 | Once B1 lands, these turn one clap into a *family*: machine clap (3, 10 ms, jitter 0) vs live crowd (8, 28 ms, jitter 0.6) — §3.5. Cheap because B1 already builds the schedule. | **S** |
| **B8** | **`snare.gateTime`** (s, 0.05–0.4) — hard-cut the reverb *send* return at `t + gateTime` instead of letting it ring. | s | The 80s gated snare, which is gated room ambience with hold ≈ 150 ms [12][13], not a snare setting. Needs a per-voice send envelope, which `wireDrumVoice` does not have today. | **M** |
| **B9** | **`bodyType: OscillatorType` on kick and tom** (`drumTone` already accepts `type`; only the snare passes it). | enum | Triangle toms gain the odd harmonics that make rack-tom "body" live at 200–500 Hz above an 85–165 Hz fundamental [11]. Costs one field. | **S** |
| **B10** | **`attackTime`** (s, 0–0.005) on every voice — replace `setValueAtTime(peak, t)` with a short `linearRampToValueAtTime`. | s | Today's attack is a hard discontinuity, which itself injects broadband noise [5]. That is free grit on a 909, but it is wrong on an 808 kick and on a lo-fi kit, and it is currently unavoidable. | **S** |
| **B11** | **Two-stage pitch envelope: `pitchTime2` + `pitchMid`** — ramp `freqStart → pitchMid` fast, then `pitchMid → freqEnd` slow. | Hz, s | A single `exponentialRampToValueAtTime` is constant-cents-per-second; a real bridged-T's pitch falls fastest at the start [4]. Audible mainly on kicks with a long tail. Lower payoff than it looks once A1 shortens `pitchTime`. | **M** |
| **B12** | **`kick.drive`** (0–1) — a `WaveShaperNode` on the kick body only. | 0–1 | 909/warehouse punch and harmonics that survive small speakers. Real, but the master rack already has distortion, so this is the most redundant item here. | **M** |
| **B13** | **Per-voice `pan`** (−1…1) on toms. | −1…1 | A descending fill panned across the kit is the classic cue. Needs a `StereoPannerNode` in `wireDrumVoice`. Low payoff until B2 lands; consider only after. | **M** |

**Suggested order:** B1 → B2 → B3 → B4 → B6 → B5 → B7 → B9/B10 → the rest. B1 and B3 are each
one small function's worth of work for a large, immediately audible change; B5 is the biggest
single win but costs a schema change, so it should follow the free ones.

---

## Sources

1. [Harmonic and Transposition Constraints Arising From The Use Of The Roland TR-808 Bass Drum (arXiv 2502.07524)](https://arxiv.org/abs/2502.07524)
2. [TR-808 kick drum — modelling bridged-T (KVR DSP forum)](https://www.kvraudio.com/forum/viewtopic.php?t=418439)
3. [Werner et al., "A Physically-Informed, Circuit-Bendable, Digital Model of the Roland TR-808 Bass Drum Circuit", DAFx-14](https://dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf)
4. [Baratatronix — Roland TR-808 Bass Drum Synthesis](https://www.baratatronix.com/blog/808-bd-synthesis)
5. [Sound On Sound — Practical Bass Drum Synthesis](https://www.soundonsound.com/techniques/practical-bass-drum-synthesis)
6. [Sound On Sound — Synthesizing Drums: The Bass Drum](https://www.soundonsound.com/techniques/synthesizing-drums-bass-drum)
7. [Sound On Sound — Practical Snare Drum Synthesis](https://www.soundonsound.com/techniques/practical-snare-drum-synthesis)
8. [N8 Synthesizers — Building a DIY Eurorack TR-808 Snare](https://www.n8synth.co.uk/diy-eurorack/eurorack-808-snare/)
9. [Kurt James Werner — ChucK TR-808 Emulator / Snare Drum (SD) emulation](https://www.tumblr.com/kurtjameswerner/51352144814/chuck-tr-808-emulator-snare-drum-sd-emulation)
10. [Drum-Tuning.com — Drum Tuning Chart: frequency reference for every drum size](https://drum-tuning.com/drum-tuning-chart/)
11. [Music Guy Mixing — The Complete Drum EQ Chart](https://www.musicguymixing.com/drum-eq-chart/)
12. [MusicRadar — How to recreate the Phil Collins '80s gated reverb drum sound](https://www.musicradar.com/how-to/recreate-the-phil-collins-80s-gated-reverb-drum-sound)
13. [Sweetwater inSync — Dissecting the Phil Collins Drum Sound](https://www.sweetwater.com/insync/dissecting-the-phil-collins-drum-sound/)
14. [Wikipedia — Cross-stick](https://en.wikipedia.org/wiki/Cross_stick)
15. [Baratatronix — Roland TR-808 Rimshot Synthesis](https://www.baratatronix.com/blog/808-rimshot)
16. [Synthesizing a 909-style Rimshot (MOD WIGGLER)](https://modwiggler.com/forum/viewtopic.php?t=183461)
17. [Peltola et al., "Synthesis of Hand Clapping Sounds"](https://www.researchgate.net/publication/3457767_Synthesis_of_Hand_Clapping_Sounds)
18. [Repp, "The sound of two hands clapping: An exploratory study", JASA 1987 — via Inferring the hand configuration from hand clapping sounds](https://www.researchgate.net/publication/228531719_Inferring_the_hand_configuration_from_hand_clapping_sounds)
19. [Revealing the sound, flow excitation, and collision dynamics of human handclaps — Phys. Rev. Research 7, 013259](https://journals.aps.org/prresearch/abstract/10.1103/PhysRevResearch.7.013259)
20. [Fletcher, "Shock waves and the sound of a hand-clap", Acoustics Australia 2013](https://www.acoustics.asn.au/journal/2013/2013_41_2_Fletcher_paper.pdf)
21. [Emulating the TR-909 (808) clap in detail (KVR Sound Design forum)](https://www.kvraudio.com/forum/viewtopic.php?t=466450)
22. [Baratatronix — Roland TR-808 Clap Synthesis](https://www.baratatronix.com/blog/cascadia-808-clap-synthesis)
23. [Mickey Delp — Thunderclap (four-part clap envelope)](https://mickeydelp.com/blog/thunderclap)
24. [The TR808 clap (KVR Sound Design forum)](https://www.kvraudio.com/forum/viewtopic.php?t=336866)
25. [AudioSpectra — How to EQ Toms](https://audiospectra.net/how-to-eq-toms/)
26. [Baratatronix — Roland TR-808 Tom Synthesis](https://www.baratatronix.com/blog/808-tom-synthesis)
27. [Overtone Labs — Drum-Set Tuning Guide (PDF)](https://tune-bot.com/tunebottuningguide.pdf)
28. [Musical U — Percussion Frequencies Part 1: Drums](https://www.musical-u.com/learn/percussion-frequencies-part-1-drums/)
29. [Roland — TR-808 Technical Specifications](https://support.roland.com/hc/en-us/articles/201963539-TR-808-Technical-Specifications)
30. [Wikipedia — Roland TR-808](https://en.wikipedia.org/wiki/Roland_TR-808)

Sources 27–30 are corroborating background for the tuning and machine-history claims and are not
the sole support for any number above. Forum sources (2, 16, 21, 24) are used only where a
circuit-level claim is corroborated by a second source; where a forum is the only support, the
claim is flagged in place.

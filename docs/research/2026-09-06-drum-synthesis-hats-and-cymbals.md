# Synthesizing hi-hats and cymbals — research reference

Date: 2026-09-06 · Scope: closed hat, open hat, ride, bell, crash · Target: raw Web Audio API, no samples, no Tone.js.

This is a research reference, not a plan. Every claim about how a real instrument or a real machine
works carries a URL. Claims that are my own reasoning are labelled **unsourced — engineering
judgement**. Numbers proposed for solna are marked as proposals, never as facts.

---

## 0. What solna does today (read from source, not from memory)

`src/audio/engine.ts`:

| Thing | Where | What it does |
| --- | --- | --- |
| `drumTone` | `engine.ts:1595` | one oscillator, optional `exponentialRampToValueAtTime` pitch sweep, `drumEnv` |
| `drumNoiseBurst` | `engine.ts:1624` | `createNoiseNode()` → one `BiquadFilterNode` (`filterType`, `freq`, optional `q`) → `drumEnv` → `wireDrumVoice` |
| `drumEnv` | `engine.ts:1570` | `setValueAtTime(peak, t)`, optional `shape` hook, `exponentialRampToValueAtTime(ENV_FLOOR, t + decay)`. `ENV_FLOOR = 0.0001` (`audio/constants.ts:15`) |
| `noiseStartOffset` | `engine.ts:1657` | random read offset into the one shared 2 s noise buffer, so simultaneous hits are not byte-identical |
| `createNoiseNode` | `engine.ts:1806` | one shared 2 s mono `Math.random()*2-1` buffer, `loop = true` |
| `DRUM_ALIASES` | `engine.ts:92` | `closedhat → hihat`, `lowtom → tom`, **`ride → crash`** |

The five voices relevant here, exactly as `triggerDrum` builds them (`engine.ts:1668`):

| Voice | Model | Filter | Q | Reverb send | Attack |
| --- | --- | --- | --- | --- | --- |
| `hihat` | noise burst | `highpass` @ `k.hihat.filter` | (unset → 1) | none | instant |
| `openhat` | noise burst | `highpass` @ `k.openhat.filter` | (unset → 1) | none | instant |
| `crash` | noise burst | **`bandpass`** @ `k.crash.filter` | **0.8** | `k.crash.reverbSend` | instant |
| `ride` | — | aliased to `crash`, so identical | | | |
| `bell` | — | does not exist; falls through `default: break` | | | |

Two corrections to the framing of the task, from reading the code:
- `crash` is **bandpass Q 0.8**, not highpass. At Q 0.8 a bandpass is broad (bandwidth ≈ f0/Q ≈ 1.25×f0), so it is closer to a wide band-emphasis than to a highpass — but it does roll off above the centre, which a highpass does not.
- `hihat` and `openhat` are the same code path with the same filter type, confirmed. They differ only by the three `HatParams` fields.

`src/data/drumKits.ts` — the only hat/crash knobs that exist:

```ts
export interface HatParams   { filter: number; decay: number; gain: number; }
export interface CrashParams { filter: number; decay: number; gain: number; reverbSend: number; }
```

Measured spread across the 12 kits + `DEFAULT_DRUM_KIT`:

| Param | Min | Max | Notes |
| --- | --- | --- | --- |
| `hihat.filter` | 3500 (Lo-Fi Vinyl) | 9500 (Chrome Pulse) | |
| `hihat.decay` | 0.03 | 0.06 | 13 kits inside a 30 ms window |
| `hihat.gain` | 0.25 | 0.40 | |
| `openhat.filter` | 3500 | 8800 | **lower than `hihat.filter` in every kit but Lo-Fi Vinyl, where they are equal** |
| `openhat.decay` | 0.18 | 0.35 | |
| `crash.filter` | 4500 | 6800 | |
| `crash.decay` | 0.7 | 1.7 | |

So the entire hi-hat identity of 12 kits rides on one cutoff and one decay, and the open hat's only
timbral difference from the closed hat is a slightly lower highpass. That is the problem.

---

## 1. Why filtered white noise does not sound like a hi-hat

### 1.1 The physics: metal plates are inharmonic, and cymbals are worse than inharmonic

A string or an air column vibrates in modes that are near-integer multiples of a fundamental. A
**circular plate does not**: its modes are set by a two-dimensional problem and land at ratios that
are not integers, which is why struck metal reads as "clangy" rather than "pitched". Studies of
cymbal normal modes report frequency ratios that "deviate substantially from integer multiples of
the fundamental"
([The normal modes of cymbals, Rollins Scholarship Online](https://scholarship.rollins.edu/cgi/viewcontent.cgi?article=1020&context=stud_fac)).

Cymbals go one step further. Driven hard, they are **nonlinear and eventually chaotic**: at low
amplitude harmonics develop, at medium amplitude subharmonics appear, and at high amplitude the
spectrum becomes very complex, with an upward energy cascade from low modes into high modes
([Fletcher, *Acoustics Australia*, PDF](https://acoustics.asn.au/journal/2012/2012_40_3_Fletcher.pdf);
[Nonlinear vibrations and chaos in gongs and cymbals](https://www.researchgate.net/publication/49946650_Nonlinear_vibrations_and_chaos_in_gongs_and_cymbals)).

That gives the three properties white noise cannot have:

1. **Discrete partials that beat.** Two close inharmonic partials produce audible beating — the
   "shimmer". White noise has no partials, so nothing beats; it just hisses.
2. **A spectrum that changes shape over the decay, not just level.** In a real cymbal the energy
   cascades upward and the low modes ring longest, so the spectral centroid *moves*. solna's single
   gain ramp scales the whole spectrum uniformly: at 10 ms and at 300 ms the sound has the same
   colour, only quieter. That uniform decay is the single most audible tell.
3. **A stable identity per hit.** Cymbal partials are fixed by geometry; two consecutive hi-hat hits
   are recognisably the same object. Independent white-noise draws are not the same object — which
   is why `noiseStartOffset` (a correct fix for correlated summing) also guarantees no two hits
   share any partial structure, because there is none to share.

Practical corollary for EQ ranges: ride cymbals carry body around **300–600 Hz** with sheen at
**4–6 kHz** and air above
([Musical-U, Percussion Frequencies Part 2 — Cymbals](https://www.musical-u.com/learn/percussion-frequencies-part-2-cymbals/)).
A highpass at 7500 Hz throws away the entire body region, which is exactly why solna's hats read as
"tss" rather than "chick".

### 1.2 The classic analogue approach: six square oscillators, then band-split

The TR-808 generates **both hi-hats and the cymbal from one bank of six square-wave oscillators**
tuned inharmonically. The frequencies:

| Osc | Frequency | Note | Tunable? | Ratio to lowest |
| --- | --- | --- | --- | --- |
| 1 | 800.0 Hz | G5 +35¢ | yes (trimpot, 359.4–1149.9 Hz) | 3.897 |
| 2 | 540.0 Hz | C♯5 −45¢ | yes (trimpot, 254.3–627.2 Hz) | 2.630 |
| 3 | 522.7 Hz | C5 −2¢ | no | 2.546 |
| 4 | 369.6 Hz | F♯4 −2¢ | no | 1.800 |
| 5 | 304.4 Hz | D♯4 −38¢ | no | 1.483 |
| 6 | 205.3 Hz | G♯3 −20¢ | no | 1.000 |

Source: [Baratatronix, 808 Hi-Hat](https://www.baratatronix.com/cascadia/cascadia-808-hi-hat) and
[Baratatronix, Roland TR-808 Cymbal & Hi-Hat Synthesis](https://www.baratatronix.com/blog/cascadia-808-cymbal-hi-hat-synthesis).
The same pages note component tolerance can move a real unit's fixed oscillators by ~20%, and give
the design rule as "avoid even multiples" — the ratios must not be simple, or the result sounds
pitched. A circuit-level model of the same section is published as
[The TR-808 Cymbal: a Physically-Informed, Circuit-Bendable, Digital Model](https://www.researchgate.net/publication/267630051_The_TR-808_Cymbal_a_Physically-Informed_Circuit-Bendable_Digital_Model)
(Werner, Abel, Smith).

After the mixer, the 808 **splits into parallel bands**, each with its own VCA and highpass, and
recombines:

| Stage | Value | Source |
| --- | --- | --- |
| Bandpass 1 centre | 7100 Hz | Baratatronix (blog) |
| Bandpass 2 centre | 3440 Hz | Baratatronix (blog) |
| Closed hat decay | 50 ms, fixed, non-adjustable | Baratatronix (blog) |
| Open hat decay | 90–600 ms, panel pot | Baratatronix (blog) |
| Cymbal decay | 350–1200 ms, modulating **only** the 3440 Hz path's VCA | Baratatronix (blog) |
| Cymbal attack | an "envelope smoother" gives it a short attack; hi-hats tap a bandpass output directly with no smoothing | Baratatronix (blog) |
| Cymbal tone control | mixes the two parallel paths; hi-hats have no such control | Baratatronix (blog) |

Sound On Sound's [Practical Cymbal Synthesis](https://www.soundonsound.com/techniques/practical-cymbal-synthesis)
describes the same architecture at block level — six enharmonically tuned square oscillators, low
harmonics removed, split by bandpass filters into bands with **independent AR contours per band**,
highpassed, then remixed — and states plainly that **shortening the envelope times of the same patch
yields "very acceptable hi-hats"**. That is the key structural fact: *hat, ride and crash are one
generator with different envelopes and band mix, not three different generators.*

The two-decay-per-band structure is also what produces the moving spectral centroid of §1.1 — the
high band dies first, the low band rings on. **A single gain envelope over a single filter cannot
produce it, no matter how the cutoff is tuned.**

### 1.3 The TR-909 did not do this — it gave up and sampled

The 909's kick, snare and toms are analogue, but its **hi-hats, ride and crash are 6-bit PCM
samples**: analogue cymbals "did not produce a sound that could satisfy demands", so with the
deadline approaching Roland used digital only for the cymbals
([Attack Magazine, interview with Atsushi Hoshiai](https://www.attackmagazine.com/features/interview/atsushi-hoshiai-the-man-behind-the-tr-909/);
SOS [Practical Cymbal Synthesis](https://www.soundonsound.com/techniques/practical-cymbal-synthesis)
describes the 909 path as a six-bit data table clocked at 30 kHz through a DAC, VCA and lowpass).

Consequence for solna, which has decided against samples: **the "909 Modern" kit's hats can never be
a 909**. The 909 hat sound *is* a 6-bit sample and its grit is quantisation noise. The closest
sample-free approximation is the 808-style oscillator bank plus deliberate bit-crush/waveshaping —
unsourced — engineering judgement.

### 1.4 Two published Web Audio recipes, with their actual numbers

**Joe Sullivan, "Synthesizing Hi-Hats with Web Audio"**
([article](http://joesul.li/van/synthesizing-hi-hats/), code:
[itsjoesullivan/hi-hat `index.js`](https://raw.githubusercontent.com/itsjoesullivan/hi-hat/master/index.js)):

| Item | Value |
| --- | --- |
| Oscillators | 6 × `square` |
| Fundamental | 80 Hz |
| Ratios | `[1, 1.5, 2.08, 2.715, 3.395, 4.105]` → 80, 120, 166.4, 217.2, 271.6, 328.4 Hz |
| Filter 1 | `bandpass` @ 10000 Hz |
| Filter 2 | `highpass` @ 7000 Hz |
| Output gain | 0.4 |
| Envelope | attack 0.0001 s, decay 0.02 s, sustain 0.3, release = duration − attack − decay |
| Closed duration | 0.1 s |
| Open duration | 1.3 s |
| Choke | an explicit `preChoke`/`postChoke` gain pair, both starting at 0 |

Note the two structural choices: an **AD-S-R** envelope (a 20 ms drop to 30%, then a long release) —
not a single exponential — and a **named choke stage in the graph**, not an ad-hoc cancel.

**cofx, "Browser beats II"**
([article](https://blog.cofx.nl/browser-beats-snare-and-hi-hat.html)): white noise → `highpass`
@ 2000 Hz → linear ramp to zero over 0.1 s, master gain 0.3. This is essentially solna's model, and
the article itself calls it "the simplest drum sound in the series". It is the baseline we are
trying to beat, and its cutoff (2000 Hz) is far *lower* than solna's 3500–9500 Hz.

**Nord Modular book, ch. 5 Percussion Synthesis**
([source](https://cim.mcgill.ca/~clark/nordmodularbook/nm_percussion.html)): two routes are given —
noise-FM (two sine oscillators FM'd by independent noise, master 5–7 kHz, into bandpass, overdrive
and ring modulation) and the 808 route (six square oscillators "with no precise tuning", two
bandpass filters, three gating circuits with distortion/limiting, three highpass filters with
different time constants, summed). The text states the 808 route "produces a much more realistic
cymbal sound". It also notes the distortion/limiting stages are part of the sound — unsourced
inference on my part: the square waves' odd harmonics folding through a limiter is what fills the
gaps between partials, which is the reason a 6-oscillator bank does not sound thin at 10 kHz.

---

## 2. Concrete Web Audio recipes per voice

All five voices below are **one generator**: a shared metallic oscillator bank plus optional noise,
into a band-split, into per-band envelopes. Values marked (S) are sourced from §1; values marked (J)
are unsourced — engineering judgement, chosen to sit inside sourced ranges.

### 2.0 The shared core

```
6 × OscillatorNode(type='square'), freq = tone * RATIO[i]
RATIO = [1, 1.483, 1.800, 2.546, 2.630, 3.897]   // 808 ratios, from the table in §1.2 (S)
  → mixGain (1/6 each, to keep headroom)
  → split: bandA = bandpass(fA, qA) ; bandB = bandpass(fB, qB)
  → each band → its own GainNode envelope → highpass(hpF)
  → sum → drumEnv-style master gain → wireDrumVoice()
```

`tone` is the one number that changes the instrument's size. 808 default is 205.3 Hz (S). Larger
cymbals are lower: a 20" ride versus a 14" hat is roughly a 1.4× diameter ratio, so a `tone` around
120–150 Hz for a ride is the right order (J).

### 2.1 Closed hat

| Parameter | Value | Basis |
| --- | --- | --- |
| Oscillators | 6 square, `tone` 205–320 Hz | (S) 808 |
| Band A | `bandpass` 7100 Hz, Q 1.0 | (S) centre; Q (J) |
| Band B | `bandpass` 3440 Hz, Q 1.2 | (S) centre; Q (J) |
| Band B level | 0.25 of band A | (J) — hats tap mostly the high path |
| Highpass | 7000 Hz, Q 0.7 | (S) Sullivan's 7000 |
| Attack | 0 ms (no smoothing) | (S) 808 hats have no envelope smoother |
| Decay | 50 ms both bands | (S) 808 CH is fixed at 50 ms |
| Noise layer | 0–15% at highpass 8 kHz, decay 25 ms | (J) restores stick "tick" |

Genre variants (J, within sourced ranges): tight techno `decay` 25–35 ms; 808 `tone` 205 Hz,
`decay` 50 ms; loose/jazz `decay` 80–110 ms with band B up to 0.4; trap `decay` 30 ms with
`tone` ~260 Hz and a hard highpass at 9 kHz.

### 2.2 Open hat

Identical generator; only the envelope and band mix move.

| Parameter | Value | Basis |
| --- | --- | --- |
| Decay, band A (high) | 180 ms | (J) inside the sourced 90–600 ms |
| Decay, band B (low) | 320 ms | (J) — longer low band is what makes the centroid fall |
| Band B level | 0.45 of band A | (J) — open hats have more body than closed |
| Highpass | 6000 Hz | (J); matches solna's existing "open hat cutoff below closed" instinct |
| Sustain shape | drop to ~0.3 of peak in 20 ms, then long release | (S) Sullivan's AD-S-R |

The Sullivan AD-S-R matters more here than anywhere else: a real open hat has a loud strike followed
by a much quieter ring, and a single exponential from peak makes the ring too loud in the first
100 ms and too quiet after.

Full-open, "sloshy" variants push band A decay to 400–600 ms (S: the 808's pot tops out at 600 ms).

### 2.3 Ride

| Parameter | Ping component | Wash component | Basis |
| --- | --- | --- | --- |
| Source | 6 osc, `tone` 120–150 Hz | same bank | (J) larger plate |
| Band | `bandpass` ~3.5–5 kHz, Q 3–5 | `bandpass` ~7–9 kHz, Q 0.7 | (J) from the 4–6 kHz sheen range (S) |
| Extra | + one `bandpass` at 300–600 Hz, Q 4, level 0.2 | — | (S) ride body 300–600 Hz |
| Attack | 0–2 ms | 8–15 ms (slow bloom) | (J) |
| Decay | 90–160 ms | 1.2–2.5 s | (J) |
| Noise | 10% highpass 6 kHz, 40 ms — the stick | 5% highpass 4 kHz, full length | (J) |

See §3 for why these are two components of one voice and not two voices.

### 2.4 Bell (ride bell / cowbell / agogô)

The bell is the one voice where a **two-oscillator** model is documented and sufficient. The 808
cowbell:

| Parameter | Value | Basis |
| --- | --- | --- |
| Oscillators | 2 × square: 800 Hz and 540 Hz | (S) |
| Interval | a detuned perfect fifth (800/540 = 1.481); deliberately not an exact ratio, so they beat | (S) |
| Bandpass centre | ~880 Hz (A5) | (S) |
| Bandpass −3 dB points | ~794 Hz and ~977 Hz → bandwidth 183 Hz → **Q ≈ 4.8** | Q derived by me from the sourced cutoffs |
| Decay | ~400 ms, exponential | (J) |

Sources: [Hackaday, How The Roland 808 Cowbell Worked](https://hackaday.com/2022/05/12/how-the-roland-808-cowbell-worked/);
[Baratatronix, 808 Cowbell Synthesis](https://www.baratatronix.com/blog/606-cymbal-and-hi-hat-synthesis-nnfnz);
circuit model: [More Cowbell: a Physically-Informed, Circuit-Bendable, Digital Model of the TR-808 Cowbell](https://www.researchgate.net/publication/267629988_More_Cowbell_a_Physically-Informed_Circuit-Bendable_Digital_Model_of_the_TR-808_Cowbell).

Variants:

| Bell type | Osc 1 / Osc 2 | Bandpass | Decay | Basis |
| --- | --- | --- | --- | --- |
| 808 cowbell | 800 / 540 Hz | 880 Hz, Q 4.8 | 0.40 s | (S) |
| Agogô high | ~1050 / 710 Hz | 1150 Hz, Q 5 | 0.35 s | (J) — agogô is a *pair* of cone bells, the two typically a minor or major third apart (S, below) |
| Agogô low | ~840 / 568 Hz | 920 Hz, Q 5 | 0.40 s | (J) |
| Ride bell / bembé | ~1700 / 1150 Hz + the 6-osc bank at 8% | 2000 Hz, Q 3 | 0.55 s with a 1.2 s wash tail | (J) |

Agogô as two cone-shaped metal bells of different pitch: [Wikipedia, Agogô](https://en.wikipedia.org/wiki/Agog%C3%B4);
the two bells are commonly a third apart, and the exact frequencies are not standardised (search-level
source, forum/retail consensus — treat the specific interval as weak). For cast bells generally, the
partials are near-harmonic **except** the third partial, which sits a minor third above the second —
that minor third is the "bell" signature
([The Sound of Bells — partial groups](https://www.hibberts.co.uk/lehr_1986_partial_groups/)).
A ride bell is a shallow dome, not a cast bell, so it is closer to the cowbell case than to the
church-bell case — unsourced — engineering judgement.

### 2.5 Crash

| Parameter | Value | Basis |
| --- | --- | --- |
| Oscillators | 6 square, `tone` 150–205 Hz | (S) 808 bank |
| Band A | `bandpass` 7100 Hz, Q 0.7 | (S) centre |
| Band B | `bandpass` 3440 Hz, Q 0.9 | (S) centre |
| **Which band the long decay modulates** | **band B only** (the 3440 Hz path) | (S) — this is exactly what the 808 cymbal does |
| Band A decay | 350–500 ms | (J) inside the 350–1200 ms range (S) |
| Band B decay | 1.2–3.0 s | (S) upper end of the pot, extended (J) |
| Attack | 5–12 ms, smoothed | (S) the 808 cymbal has an envelope smoother; hats do not |
| Noise layer | 25–35% at highpass 5 kHz, decay ≈ band A | (J) — noise is a *layer*, not the source |
| Tone control | crossfade band A ↔ band B | (S) the 808 cymbal has one, hats do not |
| Reverb send | keep solna's existing `reverbSend` | existing code |

The 5–12 ms attack is not cosmetic: it is the audible difference between "a cymbal was struck and
bloomed" and "a burst of noise was switched on".

---

## 3. Ride vs crash; ping vs wash

**Ride vs crash is a function difference before it is a timbre difference.** A ride "maintains a
steady pattern rather than providing the accent of a crash cymbal"; rides are 18–22" and are made to
sustain, and crashes have a "shorter, decaying sound"
([Wikipedia, Ride cymbal](https://en.wikipedia.org/wiki/Ride_cymbal)). Practically that inverts the
naive expectation: **the crash is the shorter-attack, faster-blooming, faster-collapsing sound and
the ride is the one with a long steady bed** — a crash's *perceived* length comes from a big
low-mid bloom, while a ride's comes from a bed that has to survive being struck again 250 ms later.

**Ping vs wash is a single continuum, not two sounds.** The bell "creates a brighter, less sustained
sound"; the bow produces the sustained shimmer; struck atop the bell the ride delivers "a clear
ping" (Wikipedia, ibid.). Drummers describe the pings as being anywhere from "very pronounced or
pingy where they are clearly separate and distinct from the overall cymbal sound" to "spread or
washy where the pings are cushioned or even buried in the overall cymbal sound"
([DFO drum forum thread on stick definition vs wash](https://www.drumforum.org/threads/controlling-sick-definition-and-wash-in-a-ride.95672/) —
player-community source, not a measurement). Paiste's own classification separates these axes
explicitly ([Paiste cymbal sound classification](https://www.paiste.com/en/about/everything-cymbals/cymbal-sound-classification-system)).

**Conclusion for solna: one `ride` voice with one parameter, not two voices.** A single `ping`
control in 0..1 crossfading the ping component against the wash component (§2.3) covers jazz
time-keeping (`ping` ≈ 0.8, short 100 ms transient over a low steady bed) and a washy rock ride
(`ping` ≈ 0.2). What `ping` cannot cover is the **ride bell**, which is a different strike location
with a genuinely different spectrum (§2.4) and is a separate General MIDI instrument: note 51 is Ride
Cymbal 1, note 53 is Ride Bell
([General MIDI percussion map](https://web.pdx.edu/~jnewton/assignments/043ft_finale_tutorials/finale_tutorials/Finale/General_MIDI_Percussion_Map_Table.htm)).

Recommendation: `ride` = one voice + `ping` parameter; `bell` = its own voice. That also matches the
GM map solna's row names loosely track (42 closed hat, 44 pedal hat, 46 open hat, 49 crash 1,
51 ride 1, 53 ride bell).

---

## 4. Choke behaviour

### 4.1 How real hats and machines do it

A hi-hat is **one physical instrument**: the bottom cymbal is fixed, the top moves down onto it when
the pedal is pressed, producing the short muted "chick"; releasing lets them ring
([Wikipedia, Hi-hat](https://en.wikipedia.org/wiki/Hi-hat)). Physically, an open hat cannot ring
while a closed hat is sounding — the closure *is* the damping. The same page documents the half-open
technique: "open and then closed after striking to dampen the ring".

In the TR-808 the open and closed hats have separate envelopes, VCAs and highpass filters, but the
open hat additionally has a **shut-off circuit driven by the closed-hat envelope**: if both are
triggered together, the closed hat's short envelope is forced onto the open hat's VCA, cutting its
decay (forum circuit discussion:
[MOD WIGGLER, TR-808 vs TR-606 hi-hats](https://www.modwiggler.com/forum/viewtopic.php?t=123644);
the same behaviour is exposed as a switchable "Choke" on the
[Tiptop HATS808 manual](https://www.tiptopaudio.com/manuals/Tiptop_Audio_HATS808_ns.pdf)).
Note that in the 808 the choke is applied by an *envelope*, not a switch — the cut has a shape.

In samplers the generalised form is the **choke group**: a monophonic group that favours the most
recent sound, muting existing ones, with hi-hats as the textbook case
([Attack Magazine, Live Hi-Hats](https://www.attackmagazine.com/technique/beat-dissected/live-hi-hats/)).

### 4.2 What release time the cut should use

An instant gain jump to zero produces an audible click because the value jumps discontinuously
between samples; a **15 ms** decay "gives the impression of being immediate but at the same time
removes the click", and ~**30 ms** "will eliminate the pops but still get a seemingly instant change"
([Web Audio: the ugly click and the human ear](http://alemangui.github.io/ramp-to-value)).

Mechanics that matter for the implementation:
- `exponentialRampToValueAtTime` **cannot ramp to 0** — the target must be non-zero
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/exponentialRampToValueAtTime)).
  solna already handles this with `ENV_FLOOR = 0.0001`, so a choke should ramp to `ENV_FLOOR`, not 0.
- `setTargetAtTime` approaches the target with a time constant rather than at a fixed end time
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/setTargetAtTime)) — it never
  arrives, so a hard `stop()` after ~4–5 time constants is still needed. For a scheduled choke with a
  known end time, `cancelScheduledValues` + `setValueAtTime(currentValue)` +
  `exponentialRampToValueAtTime(ENV_FLOOR, t + 0.02)` is the cleaner shape (J).
- The node must also be `stop()`ed after the ramp or the looping noise/oscillators keep running; and
  the ramp must start from the **value at the choke moment**, not from the peak, or the choke
  re-swells the voice. solna has a `cancelAndHold` helper in the synth path (`engine.ts`, used by
  `updateVoiceNoise`) that is the right primitive to reuse (J).

Proposed choke release: **20 ms** default, exposed as `chokeRelease` in 10–60 ms. 10 ms is on the
edge of clicking (below the 15 ms figure); 60 ms is audibly a "damp" rather than a cut (J).

### 4.3 Should an open hat cut a previous open hat?

**Yes.** A hi-hat is one pair of cymbals; two overlapping open-hat rings is a physical impossibility,
and practitioners state the case directly — "a high hat is basically a mono instrument and polyphony
is not required"
([Gearspace, open/closed hi-hat samples](https://gearspace.com/threads/the-relationship-between-open-and-closed-hi-hat-samples.815397/) —
practitioner source).

But the retrigger of the *same* voice should not use the choke ramp: a new open hat on top of a
decaying one should replace it with the *natural* strike, so the cut can be shorter (5–10 ms) and is
masked by the new attack. The 20 ms figure is for closed-cuts-open, where nothing loud follows to
mask it (J).

Since solna will ship exactly one choke group containing hi-hats only:

| New hit | Cuts | Release |
| --- | --- | --- |
| `hihat` | any sounding `openhat`, any sounding `hihat` | 20 ms |
| `openhat` | any sounding `openhat`, any sounding `hihat` | 8 ms |
| `pedalhat` (if added) | both | 20 ms |
| `ride`, `crash`, `bell` | nothing | — |

Explicitly **not** in the group: ride and crash. Real crashes ring through each other, and a ride
struck in time-keeping must overlap itself — a mono ride would cut every quarter-note ping and
destroy the wash. (J, but it follows directly from §3's "the ride's bed must survive the next hit".)

---

## 5. Parameter proposal

### 5.1 (a) What re-tuning `filter` / `decay` / `gain` alone can buy

Honest summary first: **re-tuning buys about 2.5 distinguishable hat characters — bright/thin,
dark/dull, and tight-vs-loose — and it cannot buy genre identity.** With one highpass over white
noise, raising the cutoff makes the hat thinner *and quieter* at the same time (the two are not
separable), lowering it makes it a hiss rather than a "chick", and the decay is the only truly
independent axis. There is no setting of three numbers that makes noise beat, and none that makes
the spectrum move during the decay. Expect a real but modest improvement.

What is nonetheless being left on the table today:

1. **The decay range is far too narrow.** All 13 closed hats live in 0.03–0.06 s. The 808's own
   closed hat is 0.05 s (S) and loose acoustic hats ring much longer. Widening to 0.02–0.11 s is the
   single largest free win.
2. **The two-band lesson can be faked crudely by cutoff choice.** Since a highpass at 7500 Hz throws
   away the 300–600 Hz body and the 3440 Hz band the 808 relies on (S), lowering the cutoff on the
   kits that want body is free and audible.
3. **Open hat cutoff is below closed hat cutoff in every kit** — defensible (more body), but combined
   with an identical filter type it means the open hat reads as "the same hiss, longer", which is
   the exact complaint.

Proposed re-tune, five archetypes, existing three parameters only (all values J, sitting inside
sourced decay ranges where sources exist):

| Archetype | `hihat.filter` | `hihat.decay` | `hihat.gain` | `openhat.filter` | `openhat.decay` | `openhat.gain` | Kits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tight machine | 8800 | 0.022 | 0.34 | 7200 | 0.16 | 0.38 | Warehouse, Velocity Breaks, Chrome Pulse |
| 808 dark | 5200 | 0.050 | 0.34 | 4400 | 0.42 | 0.38 | 808 Vintage, Warm Riddim |
| Trap | 9000 | 0.028 | 0.32 | 7600 | 0.22 | 0.36 | Trap Beat |
| Loose acoustic | 6400 | 0.085 | 0.36 | 5400 | 0.50 | 0.42 | Acoustic Studio, Retro Drive |
| Lo-fi muffled | 3600 | 0.045 | 0.26 | 3200 | 0.30 | 0.28 | Lo-Fi Vinyl, Tight Pocket |

Also worth doing inside the existing model, still no new kit params (small engine edits):

- Give the hats a **`q`** on the existing `drumNoiseBurst` call (the option already exists — `crash`
  passes `q: 0.8`, hats pass nothing and get the default 1). A highpass with Q 4–6 has a resonant
  bump at the cutoff, which is the cheapest available approximation of a partial. **This is the
  highest value-per-line change in the whole document** and needs no new kit field if hard-coded.
- Randomise the hat cutoff ±3% per hit (J) — costs one line in `triggerDrum`, cures a little of the
  machine-gun sameness of 16th-note hats.

### 5.2 (b) What must be ADDED, ranked by audible payoff per unit of work

Work estimates are mine (J). "New kit fields" means `HatParams` / new `RideParams` / `BellParams` in
`src/data/drumKits.ts`, which is a 12-kit authoring change as well as a type change.

| # | Addition | Unit | Range | Default | What it buys | Work |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **`metal` — oscillator-bank mix** vs noise | 0..1 | 0–1 | 0.7 | The whole of §1: beating inharmonic partials instead of hiss. Turns "shh" into "tss/chick". Nothing else on this list matters as much. | Medium: one new private `metalBank()` in `engine.ts` (6 oscillators + mix gain), reusing `drumEnv`/`wireDrumVoice` unchanged. |
| 2 | **`tone` — bank fundamental** | Hz | 120–420 | 205.3 | Cymbal *size*. A 14" hat vs a 20" ride vs a small splash, from one number. Only meaningful once (1) exists. | Small, once (1) exists. |
| 3 | **choke group + `chokeRelease`** | ms | 10–60 | 20 | Closed-cuts-open. The single most recognisable "this is a drum machine and it grooves" behaviour; also stops open hats piling up on 16th patterns. Independent of (1) — can ship first. | Small–medium: a `Map<string, {env, stopAt}>` of sounding hat voices in `engine.ts`, plus a ramp-to-`ENV_FLOOR`. No kit fields except `chokeRelease` (can be a constant first). |
| 4 | **`bodyLevel` + `bodyDecay` — the second band** | 0..1 / s | 0–1 / 0.05–3 | 0.3 / 2× main | The moving spectral centroid (§1.1, §1.2). Makes open hats and crashes *evolve* instead of fading. This is the 808's two-VCA trick. | Medium: a second bandpass+gain branch inside `drumNoiseBurst`/`metalBank`. |
| 5 | **real `ride` voice + `ping`** | 0..1 | 0–1 | 0.6 | Removes the `ride → crash` alias (`engine.ts:94`). Jazz time-keeping becomes possible at all; currently every ride hit is a crash. Given the hat row carries 257 of ~548 hits, moving jazz/swing patterns onto a real ride is a large library win. | Medium: new `case 'ride'` + `RideParams`; depends on (1) and (4) to sound like a ride at all. |
| 6 | **`attack`** | ms | 0–20 | 0 hats / 8 crash | Crash blooms instead of switching on (S: the 808 cymbal's envelope smoother, hats have none). Also removes the transient click on loud crashes. | Trivial: a `linearRampToValueAtTime` before the decay in `drumEnv`. Highest payoff-to-work ratio on the list after (3). |
| 7 | **`bell` voice** | — | — | — | A whole missing instrument; cheap because the 2-oscillator recipe is fully sourced (§2.4) and needs none of (1). Unlocks Latin/Afro grids and the ride-bell articulation. | Small: `drumTone`×2 into one bandpass; a new `case 'bell'`. |
| 8 | **`velToTone` — velocity→brightness** | 0..1 | 0–1 | 0.4 | Real cymbals get *brighter* when hit harder, not just louder (§1.1 energy cascade). Cures the "same hat 16 times" flatness that no amount of velocity scaling fixes today. | Trivial: scale filter/`tone` by `v` in `triggerDrum`. |
| 9 | **`jitter` — per-hit detune** | cents | 0–50 | 15 | Consecutive hats stop being identical. Trap rolls and techno 16ths stop machine-gunning. | Trivial once (1) exists. |
| 10 | **`sustain`/`hold` — AD-S-R instead of one exponential** | 0..1 | 0–1 | 0.3 | Sullivan's shape (S): loud strike, quieter ring. Fixes the open hat being too loud early and too quiet late. | Small: `drumEnv` already takes a `shape` hook (used by the clap) — this is exactly what it is for. |
| 11 | **`crush` — bit reduction** | bits | 4–12 | 12 (off) | The only sample-free route to a 909-ish hat (§1.3). Needs a `WaveShaperNode` or an `AudioWorklet`. | Medium–large: no existing waveshaper on the drum bus. |
| 12 | **`pan` / stereo spread** | −1..1 | −1..1 | 0 | Hats sit off-centre like a real kit; the two bands can be spread. Cheap, but it is a mix improvement, not a synthesis one. | Small: a `StereoPannerNode` in `wireDrumVoice`. |

**If only three things ship:** (3) choke, (6) attack, (1) the oscillator bank — in that order of
increasing cost. Choke and attack are near-free and immediately audible; the oscillator bank is the
one that actually answers "why doesn't this sound like a hi-hat".

**Interaction to watch:** (1) adds 6 oscillators per hat hit. At 16th notes and 140 BPM that is
~9 osc-starts/second/hat-track, on top of the existing per-hit node churn. solna already builds and
tears down nodes per hit and disconnects in `onended`, so the pattern is established — but the count
per hit goes from 3 nodes to ~10, and the `check:drums` audible-separation suite will need its
expectations reviewed. Unsourced — engineering judgement.

---

## 6. Sources

Machine and circuit:
1. [Baratatronix — 808 Hi-Hat (oscillator frequencies, tuning ranges)](https://www.baratatronix.com/cascadia/cascadia-808-hi-hat)
2. [Baratatronix — Roland TR-808 Cymbal & Hi-Hat Synthesis (bandpass 7100/3440 Hz, decay ranges, envelope smoother)](https://www.baratatronix.com/blog/cascadia-808-cymbal-hi-hat-synthesis)
3. [Sound On Sound — Practical Cymbal Synthesis](https://www.soundonsound.com/techniques/practical-cymbal-synthesis)
4. [Werner, Abel, Smith — The TR-808 Cymbal: a Physically-Informed, Circuit-Bendable, Digital Model](https://www.researchgate.net/publication/267630051_The_TR-808_Cymbal_a_Physically-Informed_Circuit-Bendable_Digital_Model)
5. [Werner et al. — More Cowbell: ... Digital Model of the TR-808 Cowbell](https://www.researchgate.net/publication/267629988_More_Cowbell_a_Physically-Informed_Circuit-Bendable_Digital_Model_of_the_TR-808_Cowbell)
6. [Hackaday — How The Roland 808 Cowbell Worked](https://hackaday.com/2022/05/12/how-the-roland-808-cowbell-worked/)
7. [Baratatronix — 808 Cowbell Synthesis](https://www.baratatronix.com/blog/606-cymbal-and-hi-hat-synthesis-nnfnz)
8. [Attack Magazine — Atsushi Hoshiai, the man behind the TR-909 (cymbals are 6-bit samples)](https://www.attackmagazine.com/features/interview/atsushi-hoshiai-the-man-behind-the-tr-909/)
9. [MOD WIGGLER — TR-808 vs TR-606 hi-hats (the OH shut-off circuit driven by the CH envelope) — forum](https://www.modwiggler.com/forum/viewtopic.php?t=123644)
10. [Tiptop Audio HATS808 manual (Choke switch)](https://www.tiptopaudio.com/manuals/Tiptop_Audio_HATS808_ns.pdf)

Acoustics:
11. [The normal modes of cymbals (Rollins)](https://scholarship.rollins.edu/cgi/viewcontent.cgi?article=1020&context=stud_fac)
12. [Fletcher — nonlinear behaviour of gongs and cymbals, Acoustics Australia (PDF)](https://acoustics.asn.au/journal/2012/2012_40_3_Fletcher.pdf)
13. [Nonlinear vibrations and chaos in gongs and cymbals](https://www.researchgate.net/publication/49946650_Nonlinear_vibrations_and_chaos_in_gongs_and_cymbals)
14. [The Sound of Bells — partial groups (Lehr 1986)](https://www.hibberts.co.uk/lehr_1986_partial_groups/)
15. [Musical-U — Percussion Frequencies Part 2: Cymbals](https://www.musical-u.com/learn/percussion-frequencies-part-2-cymbals/)

Instrument behaviour:
16. [Wikipedia — Hi-hat](https://en.wikipedia.org/wiki/Hi-hat)
17. [Wikipedia — Ride cymbal](https://en.wikipedia.org/wiki/Ride_cymbal)
18. [Wikipedia — Agogô](https://en.wikipedia.org/wiki/Agog%C3%B4)
19. [Paiste — Cymbal Sound Classification System](https://www.paiste.com/en/about/everything-cymbals/cymbal-sound-classification-system)
20. [DFO — Controlling stick definition and wash in a ride — player forum](https://www.drumforum.org/threads/controlling-sick-definition-and-wash-in-a-ride.95672/)
21. [Gearspace — The relationship between Open and Closed Hi-Hat samples — practitioner forum](https://gearspace.com/threads/the-relationship-between-open-and-closed-hi-hat-samples.815397/)
22. [Attack Magazine — Live Hi-Hats (choke groups)](https://www.attackmagazine.com/technique/beat-dissected/live-hi-hats/)
23. [General MIDI Percussion Map Table](https://web.pdx.edu/~jnewton/assignments/043ft_finale_tutorials/finale_tutorials/Finale/General_MIDI_Percussion_Map_Table.htm)

Web Audio implementation:
24. [Joe Sullivan — Synthesizing Hi-Hats with Web Audio](http://joesul.li/van/synthesizing-hi-hats/)
25. [itsjoesullivan/hi-hat — index.js (the actual constants)](https://raw.githubusercontent.com/itsjoesullivan/hi-hat/master/index.js)
26. [cofx — Browser beats II: synthesizing a snare drum and a hi-hat](https://blog.cofx.nl/browser-beats-snare-and-hi-hat.html)
27. [Nord Modular book, Ch.5 — Percussion Synthesis](https://cim.mcgill.ca/~clark/nordmodularbook/nm_percussion.html)
28. [Web Audio: the ugly click and the human ear (15 ms / 30 ms ramp figures)](http://alemangui.github.io/ramp-to-value)
29. [MDN — AudioParam.exponentialRampToValueAtTime()](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/exponentialRampToValueAtTime)
30. [MDN — AudioParam.setTargetAtTime()](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/setTargetAtTime)

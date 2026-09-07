# Drum kit identities: what solna's twelve kits refer to, and how far the parameters reach

Research document, 2026-09-06. Scope: `src/data/drumKits.ts` (the table) and the `triggerDrum`
switch in `src/audio/engine.ts` (what the numbers do). No source file was modified.

Every claim about how a machine or a style *sounds* carries a URL. Claims about solna's own code
are measured from the two files above. Claims with neither are labelled
**unsourced — engineering judgement**.

**Sections:** §0 what the parameters do · §1 referents · §2 per-kit target parameters (all twelve
get their own table; the famous machines get no more room than the rest) · §3 separation ·
§4 genre coverage · **§5 naming honesty — analogue vs PCM per voice, a per-kit closeness
scorecard, the `909 Modern` case, and a recommendation** · §6 engine changes.

**If you read one section, read §5.1.** It argues that the hi-hat collapse across all twelve kits
is not an authoring failure but a capability gap: the hat is the one voice for which solna's
synthesis model resembles none of the referents, so there was nothing to differentiate toward.

---

## 0. What the parameters actually do (measured from `engine.ts`)

Read before believing any number below. `triggerDrum` is at `engine.ts:1668`; the three
primitives it calls are `drumTone` (`:1593`), `drumNoiseBurst` (`:1622`) and `drumEnv` (`:1570`).

| voice | synthesis, exactly | notes that constrain the tables below |
|---|---|---|
| kick body | `OscillatorNode`, **sine** (no `type` passed, so the Web Audio default), `frequency` exp-ramped `freqStart`→`freqEnd` over `pitchTime` | one oscillator, no filter, no noise, no drive |
| kick click | a **second sine** at `clickFreq`, peak `clickLevel`, decay `clickDecay`; fires only if **both** `clickFreq` and `clickLevel` are truthy | the click is a *pitched tone*, not a noise transient |
| snare body | `OscillatorNode`, **triangle**, `bodyFreqStart`→`bodyFreqEnd` over `bodyTime` | body has **no** reverb send |
| snare noise | white noise → **highpass** at `noiseFilter` (Q default) | `reverbSend` applies to the noise only |
| hihat / openhat | white noise → **highpass** at `filter`, decay, gain. Three parameters, that is all | **no reverb send, no Q, no second corner** |
| clap | white noise → **bandpass Q=1.5** at `filter`, with a hardcoded 3-burst shape: peak at `t`, `0.25×peak` at `t+0.012`, `1.1×peak` at `t+0.024`, then decay | burst timings are **not** per-kit |
| tom | identical to kick body, no click | |
| crash | white noise → **bandpass Q=0.8** at `filter` | |

Five facts that drive everything that follows:

1. **The hat filter is a *highpass*.** Lowering `filter` adds low-mid energy; it never removes
   top end. The noise buffer is flat `Math.random()*2-1` white noise (`createNoiseNode`,
   `:1806`), so **all twelve kits have an identical spectrum above ~10 kHz** — the exact octave
   where a hi-hat's identity lives. The authored range 3500–9500 Hz reads as "dark to bright" but
   is really "thick to thin", with the sizzle constant.
2. **`decay` is total audible length, not T60.** `drumEnv` exponentially ramps the peak to
   `ENV_FLOOR` at `t + decay`, floored at 0.01 s.
3. **Drums bypass delay and distortion entirely** — stated in the `openhat` case comment and true
   of the routing: `wireDrumVoice` only reaches `drumBusFilter` (dry) and `drumSendFilter`
   (reverb). No saturation is available to any drum voice.
4. **The kick and the tom have no `reverbSend` at all.** `drumTone` calls
   `wireDrumVoice(env)` with the send argument omitted. `KickParams` and `TomParams` have no such
   field. This is load-bearing below (see Warehouse).
5. `peak` is always `velocity × gain`, so `gain` is a headroom budget, not a mix fader.

### What `check:drums` does and does not catch

`scripts/check-drum-kit-separation.ts` asserts (a) every kit overrides every voice by ≥1
parameter and (b) eight named parameters have an **aggregate** `max ≥ factor × min` spread. It
tests `hihat.filter` but **never `hihat.decay` or `hihat.gain`**, and being aggregate it cannot
see that two specific kits are twins. Both holes are why the hat collapse the brief describes
passed CI. `bodyTime` is `0.08` in all twelve kits — a fossil no check looks at.

---

## 1. Referents: what each name points at

Grid→kit mapping measured from `src/data/drumGrids.ts`:

| grid | kit | grid | kit |
|---|---|---|---|
| Synthwave | Retro Drive | Techno | Warehouse |
| House | 909 Modern | Funk | Tight Pocket |
| Trap | Trap Beat | Rock | Acoustic Studio |
| Boom Bap | **808 Vintage** | Reggae | Warm Riddim |
| Cyberpunk | Chrome Pulse | Lo-Fi Hip-Hop | Lo-Fi Vinyl |
| DnB | Velocity Breaks | Waltz | Acoustic Studio |
| Dubstep | Sub Weight | Afro 6/8 | Warm Riddim / Acoustic Studio |

| kit | referent | the two or three things that identify it in one hit | sources |
|---|---|---|---|
| **Retro Drive** | LinnDrum / Oberheim DMX / Simmons SDS, early-80s pop and synthwave | (a) gated-reverb snare — big room, hard cut at ~0.5 s; (b) the Simmons pitched tom sweep, "the most common tom sound in synthwave"; (c) hats peaking 7–9 kHz, rolling off 10–11 kHz, hard limit 12 kHz, "crunchy and warm with a midrange focus" | [1] [2] [3] [4] |
| **909 Modern** | Roland TR-909; the house machine (Derrick May, Jeff Mills) | (a) "aggressive and punchy" kick from a fast high→low glissando plus an added click and short filtered noise burst; (b) "snappy" noise-forward snare; (c) hats that are 6-bit *samples* — peak 7–9 kHz, roll-off 11–12 kHz, limit 15 kHz, "crisp, snappy, sizzly" | [5] [6] [7] [4] |
| **Trap Beat** | The 808 kick used as a tuned sustained sub, plus fast bright hats | (a) a kick whose decay is turned up until it becomes a sub-bass *note*, tuned to the key and glided with portamento; (b) hats at 32nd/64th rolls with ~10–15% swing; (c) thin bright snare/rimshot on the halftime backbeat | [8] [9] [10] |
| **808 Vintage** | Roland TR-808 itself | (a) bridged-T bass drum that self-rings, filter listed at 56 Hz (measured as low as 48 Hz) and goes **slightly flat** at long decays; (b) metal percussion from **6 square waves tuned 2–5 kHz through 3 highpass filters** — inharmonic, "metallic and diffused, without a sharp pitch", top end dead by ~12 kHz; (c) overall "clicky, robotic, toy-like" | [8] [11] [12] [13] [4] |
| **Chrome Pulse** | **No external referent.** solna's own name, tied to the Cyberpunk grid. Its role in the library is "the hardest transient, brightest hat, wettest tail" | unsourced — engineering judgement | — |
| **Velocity Breaks** | Drum & bass / jungle built on the Amen break — a 1969 acoustic kit (G.C. Coleman, The Winstons), sampled and sped up | (a) a real kit's crack, "punchy backbeat and busy inner motion", ghost notes; (b) everything shortened by the speed-up; (c) rough, transient-forward texture rather than machine tone | [14] [15] |
| **Sub Weight** | Dubstep at 140 BPM, halftime | (a) kick and snare **transient-shaped** — attack up, sustain down, "tight and punchy"; (b) snare peaking 150–200 Hz, layered with a clap; (c) sub felt as a separate solid layer under the kick | [16] [17] |
| **Warehouse** | Berlin / warehouse techno | (a) saturated 909 kick as transient click + body + **distorted tail**; (b) a dense mono low-passed **reverb fed from the kick** doing the job of a bassline; (c) "rattling hi-hats and overdriven claps, few melodic signposts" | [18] [19] [20] |
| **Tight Pocket** | Funk; specifically the "Funky Drummer" sound (Clyde Stubblefield, King Studios 1969) | (a) a Ludwig Vistalite kick **covered with blankets** — no gates, no compression, so the deadening is physical; (b) Ludwig Acrolite snare with ghost notes; (c) steady 16ths on 14" Zildjian K hats, **no crash at all**. **CORRECTION, not yet propagated below: "Vistalite" fails a date check — those shells did not ship until c.1972, three years after this 1969 session. The recording and the blanket-damping are not in question; the shell model is. Do not cite Vistalite for this kit anywhere downstream.** | [21] [22] |
| **Acoustic Studio** | Close-miked acoustic rock kit | (a) kick fundamental 60–100 Hz with the beater at 2–4 kHz; (b) snare fatness at 150–200 Hz plus a separate "head sound" at 6–10 kHz; (c) genuinely long toms and cymbals in a room | [23] |
| **Warm Riddim** | Reggae one drop (Carlton Barrett) and its dub treatment (King Tubby) | (a) beat 1 dropped, kick + **cross-stick/rimshot together on beat 3**, laid back; (b) upbeat hat accents; (c) dub's spring reverb and tape echo, bass and drums high in the mix | [24] [25] [26] [27] |
| **Lo-Fi Vinyl** | Lo-fi hip hop via the E-mu SP-1200 — **12-bit at 26.04 kHz** | (a) high frequencies **fold back**, transients soften; (b) added harmonics make drums feel heavier, not thinner; (c) dusty and warm, never clean | [28] [29] [30] |

---

## 2. Per-kit target parameters

Rules used: change only what carries identity; keep the twelve mutually distinguishable on the
**hat, the kick decay, and the snare wetness**, which are the three axes a listener resolves
fastest. Where a value is unreachable I have **not** invented one — see the "gap" line under each
table and §5.

Legend for the delta column: **=** unchanged, **↑/↓** direction, **NEW** parameter not currently set.

### Retro Drive — LinnDrum / Simmons / gated 80s

| voice | proposed | vs current |
|---|---|---|
| kick | `freqStart 140, freqEnd 55, pitchTime 0.05, decay 0.22, gain 0.85, clickFreq 1800, clickLevel 0.18, clickDecay 0.008` | freqEnd ↑42→55 (LinnDrum kick has little sub), click **NEW** |
| snare | `bodyFreqStart 230, bodyFreqEnd 190, bodyTime 0.05, bodyDecay 0.14, bodyGain 0.55, noiseFilter 1500, noiseDecay 0.13, noiseGain 0.75, reverbSend 0.50` | send ↑0.4→0.5 (highest in library), noiseDecay ↓0.2→0.13 — short body + max send is the closest reachable read of a gate |
| hihat | `filter 6500, decay 0.050, gain 0.38` | filter ↓7200→6500 |
| openhat | `filter 6000, decay 0.32, gain 0.42` | = |
| clap | `filter 1400, decay 0.30, gain 0.65, reverbSend 0.45` | = |
| **tom** | `freqStart 210, freqEnd 60, pitchTime 0.28, decay 0.50, gain 0.80` | **the single biggest win in the library.** Current `150→85 / 0.18 / 0.22` does not sweep. A 3.5:1 pitch drop over 280 ms *is* the Simmons tom [3], is fully reachable, and no other kit will own it |
| crash | `filter 6000, decay 0.90, gain 0.55, reverbSend 0.40` | = |

**Gap:** true gated reverb (reverb held flat then cut [2]) needs an envelope on the send, which
`wireDrumVoice` does not have — the send gain is a constant. High send + short source is an
approximation, not the effect.

### 909 Modern — TR-909, house

| voice | proposed | vs current |
|---|---|---|
| kick | `freqStart 175, freqEnd 48, pitchTime 0.03, decay 0.30, gain 0.95, clickFreq 1400, clickLevel 0.30, clickDecay 0.010` | **freqStart ↑95→175.** A 909's snap is the glissando [5][6]; starting at 95 Hz there is barely one. Fast `pitchTime` = "tighter and brighter" [6] |
| snare | `240/185, bodyTime 0.04, bodyDecay 0.11, bodyGain 0.45, noiseFilter 2000, noiseDecay 0.17, noiseGain 0.72, reverbSend 0.25` | noise-forward, per "snappy" [5] |
| hihat | `filter 8500, decay 0.045, gain 0.42` | decay ↑0.035→0.045, gain ↑0.35→0.42 — the 909 hat is sizzly and sits loud, not the shortest in the room |
| openhat | `filter 7200, decay 0.35, gain 0.45` | decay ↑0.25→0.35; the 909 open hat washes |
| clap | `filter 1700, decay 0.26, gain 0.62, reverbSend 0.30` | = |
| tom | `180→80, 0.10, 0.28, 0.70` | decay ↑0.20→0.28 |
| crash | `filter 6200, decay 1.40, gain 0.55, reverbSend 0.30` | decay ↑0.85→1.40 — 0.85 s is a crash that has been faded, not one that rang |

**Gap:** the 909 hat/crash are 6-bit samples of real Paiste/Zildjian cymbals [5]; a white-noise
burst has no partials and cannot be "crunchy". Reachable target is "bright and snappy", not "909".

### Trap Beat — the 808 as a tuned sub

| voice | proposed | vs current |
|---|---|---|
| kick | `freqStart 110, freqEnd 45, pitchTime 0.06, decay 0.90, gain 1.0` | **pitchTime ↓0.30→0.06, decay ↑0.65→0.90.** A trap 808 is a sustained *note*, not a 300 ms slide; the long tail is the identity [8][9] |
| snare | `320/260, bodyTime 0.02, bodyDecay 0.07, bodyGain 0.30, noiseFilter 2600, noiseDecay 0.14, noiseGain 0.70, reverbSend 0.10` | bodyFreq ↑↑ — thin bright snare/rimshot [10]; driest-but-one snare |
| **hihat** | `filter 9000, decay 0.022, gain 0.30` | **decay ↓0.04→0.022 — the shortest hat in the library.** Trap hats must survive 32nd/64th rolls [10] without smearing; this is the one hat value that is both identity-carrying and fully reachable |
| openhat | `filter 8000, decay 0.28, gain 0.35` | = |
| clap | `filter 1900, decay 0.20, gain 0.55, reverbSend 0.12` | drier |
| tom | `130→60, 0.20, 0.45, 0.70` | decay ↑0.30→0.45 |
| crash | `filter 6000, decay 1.30, gain 0.50, reverbSend 0.25` | ↑ |

**Gap — named, not invented:** the 808 in trap is **tuned to the song's key and glided between
pitches** [9]. `freqEnd` is a per-kit constant with no route to `musicContext`, so the kit can
produce a long sub but never a *melodic* one. This is a feature request (a `trackPitch` flag on
`KickParams` read by `triggerDrum`), not a value.

### 808 Vintage — the machine

| voice | proposed | vs current |
|---|---|---|
| kick | `freqStart 90, freqEnd 50, pitchTime 0.04, decay 0.70, gain 0.90, clickFreq 900, clickLevel 0.12, clickDecay 0.006` | decay ↑0.45→0.70. The bridged-T rings itself down [11][13]; the pitch move is small because the circuit has no pitch envelope |
| snare | `190/165, bodyTime 0.03, bodyDecay 0.16, bodyGain 0.45, noiseFilter 1500, noiseDecay 0.14, noiseGain 0.50, reverbSend 0.20` | **noiseFilter ↑900→1500.** At 900 Hz the highpass leaves low-mid mud; the 808 snare's noise is a *hiss* over two tuned tones |
| hihat | `filter 5500, decay 0.040, gain 0.32` | ↑5000→5500 |
| openhat | `filter 5000, decay 0.45, gain 0.38` | **decay ↑0.30→0.45** — the 808 open hat's long ring is one of its two most recognisable sounds |
| clap | `filter 1050, decay 0.28, gain 0.60, reverbSend 0.25` | = |
| tom | `120→95, 0.05, 0.50, 0.70` | **pitchTime ↓0.15→0.05, decay ↑0.25→0.50.** 808 toms are near-static decaying sines, not sweeps |
| crash | `filter 5200, decay 1.80, gain 0.45, reverbSend 0.25` | decay ↑0.90→1.80 — the 808 cymbal is famously *long* |

**Gap:** the 808's metal percussion is 6 square waves at 2–5 kHz through 3 highpasses [12][13].
White noise through one highpass has no inharmonic partials and **cannot be metallic**. The 808
hat is the clearest case in the library where the voice model, not the values, is the limit.

### Chrome Pulse — solna's own bright/hard/wet kit

All values below: **unsourced — engineering judgement.** The kit has no referent to be faithful
to; its job is to occupy the "hardest and brightest" corner so nothing else has to.

| voice | proposed | vs current |
|---|---|---|
| kick | `190→42, pitchTime 0.025, decay 0.30, gain 1.0, clickFreq 2400, clickLevel 0.40, clickDecay 0.012` | click ↑ to highest freq + level in library — this is its signature |
| snare | `300/230, 0.02, 0.09, 0.40, noiseFilter 3000, noiseDecay 0.30, noiseGain 0.80, reverbSend 0.50` | brightest snare noise, wettest |
| hihat | `filter 10500, decay 0.028, gain 0.34` | ↑9500 → 10500 (thinnest) |
| openhat | `filter 9500, decay 0.32, gain 0.36` | ↑ |
| clap | `filter 2200, decay 0.30, gain 0.62, reverbSend 0.50` | ↑ |
| tom | `220→95, 0.06, 0.20, 0.65` | shortest, highest tom |
| crash | `filter 7500, decay 1.20, gain 0.60, reverbSend 0.55` | ↑ |

### Velocity Breaks — Amen break, D&B

| voice | proposed | vs current |
|---|---|---|
| kick | `130→50, pitchTime 0.02, decay 0.12, gain 0.95, clickFreq 2600, clickLevel 0.22, clickDecay 0.006` | **shortest kick in the library**; click **NEW** — a sampled acoustic kick leads with stick, not sub [14][15] |
| snare | `280/210, 0.02, 0.06, 0.45, noiseFilter 2200, noiseDecay 0.13, noiseGain 0.78, reverbSend 0.18` | the crack: shortest body, loud noise |
| hihat | `filter 7800, decay 0.026, gain 0.32` | decay ↓0.03→0.026 |
| openhat | `filter 6800, decay 0.20, gain 0.34` | shortest openhat |
| tom | `190→100, 0.06, 0.18, 0.60` | = |
| clap | `1600, 0.13, 0.45, 0.15` | = |
| crash | `6400, 0.80, 0.50, 0.22` | = |

**Gap:** the Amen's identity is *ghost notes and internal syncopation* [14][15] — a pattern
property, owned by `src/data/drumGrids.ts` and by velocity, not by the kit. No kit table can make
a break groove.

### Sub Weight — dubstep

| voice | proposed | vs current |
|---|---|---|
| kick | `100→38, pitchTime 0.02, decay 0.50, gain 1.0, clickFreq 1600, clickLevel 0.28, clickDecay 0.008` | **pitchTime ↓0.35→0.02.** A 350 ms sine sweep is a slide whistle, not a dubstep kick; the genre's kick is transient-shaped — attack up, sustain down [16]. Click **NEW** supplies that attack |
| snare | `210/175, 0.03, 0.16, 0.55, noiseFilter 1600, noiseDecay 0.30, noiseGain 0.80, reverbSend 0.45` | body weight ↑ — "a big snare peaks between 150 and 200 Hz" [16][17] |
| hihat | `filter 7200, decay 0.035, gain 0.30` | ↓8000→7200 |
| openhat | `filter 6200, decay 0.30, gain 0.34` | = |
| clap | `1500, 0.32, 0.60, 0.40` | = |
| tom | `110→55, 0.12, 0.45, 0.72` | pitchTime ↓0.30→0.12 |
| crash | `5600, 1.20, 0.60, 0.50` | = |

### Warehouse — Berlin techno

| voice | proposed | vs current |
|---|---|---|
| kick | `150→40, pitchTime 0.02, decay 0.40, gain 1.0, clickFreq 1100, clickLevel 0.35, clickDecay 0.008` | freqStart ↑110→150, decay ↑0.30→0.40 |
| snare | `220/165, 0.03, 0.10, 0.40, noiseFilter 1800, noiseDecay 0.14, noiseGain 0.62, reverbSend 0.40` | send ↑0.35→0.40 |
| hihat | `filter 9200, decay 0.032, gain 0.34` | "rattling" [20] |
| openhat | `filter 8200, decay 0.28, gain 0.36` | = |
| clap | `1750, 0.30, 0.70, 0.35` | gain ↑ — "overdriven claps" [20] read partly as loud |
| tom | `170→60, 0.06, 0.22, 0.65` | freqEnd ↓92→60 |
| crash | `6600, 1.00, 0.50, 0.45` | ↑ |

**Gap — this is the most consequential one in the document (see also §5.2).** The warehouse kick is *click +
body + **distorted** tail* over *a dense low-passed reverb fed from the kick* [18][19][20].
solna can produce neither:

- drums bypass distortion by routing (§0 fact 3), and
- **`KickParams` has no `reverbSend`, and `drumTone` never passes one** (§0 fact 4).

Without a kick send, Warehouse reduces to "909 Modern with a duller kick and a brighter hat" —
see §3. Adding `reverbSend?: number` to `KickParams`/`TomParams` and threading it through
`drumTone` → `wireDrumVoice` is a small, contained change that unlocks the kit.

### Tight Pocket — funk

| voice | proposed | vs current |
|---|---|---|
| kick | `120→58, pitchTime 0.03, decay 0.13, gain 0.85, clickFreq 2200, clickLevel 0.25, clickDecay 0.006` | click **NEW** at 2–4 kHz = the beater [23]; short decay = the blankets [21] |
| snare | `260/215, 0.03, 0.08, 0.50, noiseFilter 1900, noiseDecay 0.11, noiseGain 0.62, reverbSend 0.12` | **driest snare in the library** — 1969 King Studios, no gates, no reverb ornament [21] |
| hihat | `filter 6800, decay 0.030, gain 0.40` | **gain ↑0.35→0.40 — the loudest hat.** In funk the 16ths *are* the groove [21][22]; this kit should be the one where the hat is a lead voice |
| openhat | `filter 5800, decay 0.16, gain 0.42` | barely-open hat |
| clap | `1300, 0.16, 0.50, 0.12` | drier |
| tom | `170→95, 0.08, 0.25, 0.68` | = |
| crash | `5400, 0.90, 0.48, 0.15` | "Funky Drummer" has no crash [22]; keep it usable but dry |

### Acoustic Studio — close-miked kit

| voice | proposed | vs current |
|---|---|---|
| kick | `180→65, 0.05, 0.32, 0.90, clickFreq 3000, clickLevel 0.28, clickDecay 0.008` | click ↑2000→3000, level ↑0.2→0.28 — 2–4 kHz is where the beater lives [23]; 2000 sits at the edge and 0.2 is inaudible under a band |
| snare | `240/190, 0.04, 0.20, 0.55, noiseFilter 1400, noiseDecay 0.26, noiseGain 0.65, reverbSend 0.35` | = mostly |
| hihat | `filter 6500, decay 0.055, gain 0.36` | **the longest closed hat** — a real hat rings; keep it as the top of the decay range |
| openhat | `filter 5800, decay 0.45, gain 0.45` | longest openhat |
| clap | `2000, 0.32, 0.55, 0.40` | filter ↓2800→2000 (a hand clap, not a stick) |
| tom | `200→110, 0.30, 0.60, 0.78` | decay ↑0.45→0.60 — longest tom, identity-carrying |
| crash | `5000, 2.00, 0.60, 0.50` | decay ↑1.7→2.0 — longest crash |

**Gap:** the snare's "head sound" at 6–10 kHz [23] is a *second* band. One highpass corner gives
body **or** sizzle, not both. Reachable target is "fat snare"; the papery top is out of reach
without a second noise burst in the snare case.

### Warm Riddim — reggae one drop / dub

| voice | proposed | vs current |
|---|---|---|
| kick | `100→52, pitchTime 0.06, decay 0.28, gain 0.85` — **no click** | a felt-muffled reggae kick has no beater snap; being one of the few clickless kits is itself separation |
| **snare** | `bodyFreqStart 900, bodyFreqEnd 800, bodyTime 0.01, bodyDecay 0.09, bodyGain 0.60, noiseFilter 2400, noiseDecay 0.08, noiseGain 0.30, reverbSend 0.45` | **the second-biggest win.** The one drop's beat-3 voice is a **cross-stick / rimshot** [24][25] — a high, short, wooden *tock*, not a noise wash. A 900 Hz triangle body with almost no noise is exactly that, is fully reachable, and **no other kit has a snare body above 320 Hz.** Current `180/150` makes it the dullest ordinary snare in the set |
| hihat | `filter 5200, decay 0.040, gain 0.30` | ↑4500→5200; upbeat accents need articulation, not mud |
| openhat | `filter 4600, decay 0.34, gain 0.36` | ↑ |
| clap | `1000, 0.30, 0.45, 0.50` | send ↑0.35→0.50 — wettest clap, per dub's spring reverb [26][27] |
| tom | `130→70, 0.18, 0.40, 0.62` | ↑ |
| crash | `4800, 1.50, 0.48, 0.50` | ↑ |

**Gap:** dub is **tape echo** as much as reverb [26][27], and drums bypass the delay by design.
Note the existing comment in the `openhat` case — the old unconditional `gain.connect(delayNode)`
was removed as *a stray with no kit parameter behind it*. The fix is therefore a real per-voice
`delaySend` parameter, not re-adding the stray.

### Lo-Fi Vinyl — SP-1200 lo-fi hip hop

| voice | proposed | vs current |
|---|---|---|
| kick | `95→45, 0.08, 0.32, 0.80` — no click | = roughly |
| snare | `175/150, 0.05, 0.15, 0.42, noiseFilter 1100, noiseDecay 0.16, noiseGain 0.40, reverbSend 0.28` | noiseFilter ↑700→1100 |
| **hihat** | `filter 5000, decay 0.038, gain 0.22` | **counter-intuitive and deliberate: raise the corner, drop the gain.** See below |
| openhat | `filter 4500, decay 0.24, gain 0.26` | ↑3500→4500 |
| clap | `950, 0.24, 0.42, 0.22` | = |
| tom | `115→68, 0.16, 0.30, 0.55` | = |
| crash | `4600, 1.00, 0.40, 0.30` | = |

**Gap, and a measured correction to the current authoring intent.** The kit sets
`hihat.filter: 3500`, the lowest in the library, on the reading "lo-fi = darker = lower number".
Because the filter is a **highpass over white noise**, 3500 Hz passes *everything from 3.5 kHz to
Nyquist* — so this hat has the library's full sizzle **plus** an extra octave and a half of
low-mid. It is the *fullest and loudest-sounding* hat in the set, not the dustiest. The 12-bit
character being aimed at is high-frequency **fold-back and softened transients** [28][29] — a
`topCut` lowpass around 7–8 kHz, or bit reduction. **Neither exists**, so raising the corner and
cutting gain is damage control, not the sound.

---

## 3. Separation analysis

### Intended near-neighbour pairs, and the minimum difference that resolves each

| pair | why they are close | minimum separating set (from §2) |
|---|---|---|
| **909 Modern ↔ Warehouse** | both are literally a TR-909 in a club [5][18] | kick `decay` 0.30 vs 0.40 and `clickFreq` 1400 vs 1100; hat 8500/0.045/0.42 vs 9200/0.032/0.34; snare `reverbSend` 0.25 vs 0.40. Axis: **dry-bright-short vs wet-dark-long.** Genuinely resolved only once the kick send lands |
| **Trap Beat ↔ Sub Weight** | both sub-forward halftime | kick `decay` 0.90 vs 0.50 and `pitchTime` 0.06 vs 0.02; snare `bodyGain` 0.30 vs 0.55, `reverbSend` 0.10 vs 0.45; hat decay 0.022 vs 0.035. Axis: **long sub + tiny dry snare vs punchy kick + big wet snare** |
| **808 Vintage ↔ Lo-Fi Vinyl** | both vintage and dark | kick decay 0.70 vs 0.32; tom `pitchTime` 0.05/decay 0.50 vs 0.16/0.30; crash 1.80 s vs 1.00 s. Axis: **machine that rings vs sampler that stops** |
| **Acoustic Studio ↔ Tight Pocket** | both real kits | kick decay 0.32 vs 0.13; snare `reverbSend` 0.35 vs 0.12; tom decay 0.60 vs 0.25; crash 2.0 s vs 0.9 s. Axis: **room vs blankets** [21][23]. Defensible; both earn their place |
| **Retro Drive ↔ Chrome Pulse** | both bright and synthetic | tom `210→60 / 0.28` (Simmons sweep) vs `220→95 / 0.06`; hat 6500 vs 10500; kick click 1800/0.18 vs 2400/0.40. Axis: **1983 vs now** |

### Kits that must be unmistakable from everything

Velocity Breaks (shortest kick, 0.12 s), Warm Riddim (only 900 Hz snare body), Acoustic Studio
(longest tom and crash), Trap Beat (shortest hat, longest kick). Each owns one extreme of one
axis after §2, which is the cheapest possible guarantee.

### The pair that is not earning its place — **as the table stands today**

**Warehouse vs 909 Modern.** Current deltas: kick `freqStart` 110 vs 95, `decay` 0.30 vs 0.28,
`clickFreq` 1500 vs 1200; hats 9000/0.03/0.30 vs 8500/0.035/0.35 — a 500 Hz corner shift on a
band whose top end is identical, and 5 ms. Snare sends 0.35 vs 0.30. On the hat and kick, the two
busiest voices, they are the same kit. Everything that would separate them — saturation on the
kick, reverb from the kick — is precisely what the engine cannot do. Either implement the kick
send (small change, §5 item 1) or merge them.

Second-order: **Velocity Breaks vs Warehouse** currently differ mainly by kick decay (0.16 vs
0.30). §2 widens that to 0.12 vs 0.40 and gives Velocity Breaks a click, which is enough.

### The structural problem behind all of it

Across the twelve current kits: hat `decay` spans 0.030–0.060 (2.0×) and `gain` 0.25–0.38
(1.5×), while `filter` spans 3500–9500 on a **highpass** whose stopband removal is inaudible for
noise that is flat to Nyquist. So the perceptual spread on the busiest row of the whole library is
smaller than the numbers suggest. §2 widens `decay` to 0.022–0.055 (2.5×) and `gain` to
0.22–0.42 (1.9×) — real but still modest. **The durable fix is a second corner** (§5 item 2);
until then, `hihat.decay` and `hihat.gain` should at minimum be added to
`check-drum-kit-separation.ts`, which tests neither. §5.1 argues that this collapse is a
capability gap wearing an authoring gap's clothes: the hat is the one voice for which solna's
model resembles *none* of the twelve referents, so there was nothing to differentiate toward.

---

## 4. Genre coverage: what is missing

| genre shipped | kit today | verdict |
|---|---|---|
| Synthwave | Retro Drive | correct referent [1][3] |
| House | 909 Modern | correct — the 909 is the house machine [5] |
| Trap | Trap Beat | correct [8][9] |
| **Boom Bap** | **808 Vintage** | **wrong referent — see below** |
| Cyberpunk | Chrome Pulse | no referent to be wrong about |
| DnB | Velocity Breaks | correct [14] |
| Dubstep | Sub Weight | correct [16] |
| Techno | Warehouse | correct [18][20] |
| Funk | Tight Pocket | correct [21][22] |
| Rock | Acoustic Studio | correct [23] |
| Reggae | Warm Riddim | correct [24][26] |
| Lo-Fi Hip-Hop | Lo-Fi Vinyl | correct [28] |
| Waltz | Acoustic Studio | fine — no gap |
| **Afro 6/8** | Warm Riddim / Acoustic Studio | **missing a voice, not a kit — see below** |

**Gap 1 — Boom Bap has no kit.** Four grids (`Boom Bap`, `Lo-Fi Half-Time Brush`,
`Boom Bap Swung Break`, `Boom Bap 8th Hat`) point at **808 Vintage**, but boom bap is *acoustic
breaks through a 12-bit SP-1200* [28][29][30] — the opposite of a bridged-T sine. Closest
existing kit is **Lo-Fi Vinyl** (right texture, wrong energy: it has the library's lowest kick
gain 0.8 and snare noiseGain 0.35, and boom bap's whole name is the *impact* of "boom" and
"bap" [30]). Recommend one addition, **"Dusty Break"**: Lo-Fi Vinyl's darkness, Acoustic
Studio's snare crack, a hard short kick —
`kick 150→52 / 0.04 / 0.20 / 0.95 + click 2400/0.30/0.006`,
`snare 250/200 / 0.03 / 0.12 / 0.55, noiseFilter 1800, noiseDecay 0.18, noiseGain 0.70, send 0.25`,
`hihat 6000 / 0.034 / 0.30`. This also frees **808 Vintage** to be an actual 808.

**Gap 2 — Afro 6/8 needs a bell, and no kit table can supply one.** The `Afro 6/8 Bell` grid has
no bell voice: `DrumKit` has seven voices and `DRUM_ALIASES` maps `ride → crash`, so a bell part
plays as a bandpassed noise crash. The honest recommendation is **a new voice, not a new kit** —
two square oscillators through a bandpass is precisely the 808 cowbell recipe (800 Hz and
540 Hz, two-stage decay) [8], reachable with the primitives `triggerDrum` already has.

**Gap 3 — three of the eight vibes name a kit that does not exist.** Measured in
`src/data/vibes.ts`: `cyber-edm` → `'Hyperpop 2000'` (:281), `deep-ambient` → `'Minimal Glitch'`
(:334), `zen-garden` → `'Minimal Glitch'` (:436). Neither key is in `DRUM_KITS`, so
`engineSync.ts:93/:146` passes `undefined` to `setDrumKit`, `mergeDrumKit(undefined)` returns
`DEFAULT_DRUM_KIT`, and **three vibes silently ship the fallback kit with no error**.
`drumGrids.test.ts:122` guards grid→kit; `store/vibes.test.ts:29` only asserts `soundKit` is
truthy. Either add the two kits or repoint the vibes — and extend the vibe test to the same
`DRUM_KITS[...]` existence check the grid test already makes.

No other genre is uncovered. Waltz on Acoustic Studio and Afro 6/8 on Warm Riddim are reasonable
re-use; do not add kits for them.

---

## 5. Naming honesty, and how far we can actually get

The repo already solved this problem once, in the rhythm domain. `DrumGrid.provenance`
(`drumGrids.ts:85`) is a required string; `'authored'` is explicitly *"an honest answer and an
allowlisted one"*, and the doc comment on it reads: **"Never invent a URL to get off that list —
a tangentially related source is worse than no source, because it reads as verification."** One
entry (`House`, `:118`) carries a comment saying the author remembers the pattern came from
somewhere but did not record the page, so it says `'authored'` — *"that is the allowlist working,
not a gap in it."* Kit names are the same problem moved into the audio domain, and the rest of
this section reasons about them that way.

### 5.1 The question that decides it: analogue or PCM, per voice

| machine | kick / snare / toms | hats & cymbals | claps & perc | source |
|---|---|---|---|---|
| **Roland TR-808** (1980) | **analogue** — bridged-T self-ringing oscillator, LPF, VCA | **analogue** — 6 square waves ~2–5 kHz through 3 highpass filters | **analogue** | [8] [11] [12] [13] |
| **Roland TR-909** (1983) | **analogue** | **6-bit PCM** — real Paiste and Zildjian cymbals recorded by Atsushi Hoshiai | **analogue** (clap shares the snare's noise source) | [5] |
| **Roland TR-707** (1985) | **8-bit PCM** — Roland's first all-sample drum machine | **6-bit PCM** (crash, ride) | **8-bit PCM** | [31] [32] [37] |
| **LinnDrum** (1982) | **8-bit PCM, 28–35 kHz** | **8-bit PCM** | **8-bit PCM** | [1] |
| **Oberheim DMX** (1981) | **8-bit PCM** — 24 sounds derived from 11 samples | **PCM** | **PCM** | [33] |
| **Simmons SDS-V** (1981) | **analogue** — SSM2044-filtered waveforms and noise generators on slotted cards | **sampled cymbal tones** | **analogue** | [34] |
| **Casio RZ-1** (1986) | **12-bit PCM @ 32 kHz** plus user sampling | **PCM** | **PCM** | [35] [36] |
| **E-mu SP-1200** (1987) | **12-bit sampler @ 26.04 kHz** — nothing in ROM; the sound *is* the converter | n/a | n/a | [28] [29] |

Two patterns fall out, and both bear directly on solna:

1. **1980–83 machines are analogue for their drum voices and reach for samples the moment they
   need metal; from 1985 the whole machine is PCM.** So the machines whose *drums* solna could
   model are exactly three — the 808, the 909's kick/snare/toms/clap, and the Simmons.
2. **Every machine on this list is PCM for its cymbals except the 808**, which is not PCM but is a
   6-oscillator inharmonic bank. solna's hat is one white-noise source through one highpass. It
   has neither mechanism.

Point 2 is, I think, the actual explanation for the measured collapse the brief names. Twelve kit
authors did not get lazy on the hi-hat; the hi-hat is the single voice where solna's synthesis
model has **nothing that resembles any of the targets**, so there was nothing to differentiate
*toward*. Everyone converged on the same white-noise burst because the engine offers exactly one.
That is a capability gap presenting as an authoring gap, and it will recur after any retune that
does not add the capability (§6 item 2).

**What this means for a claim of accuracy:**

| voice class | can solna approach it? | so a name promising it is… |
|---|---|---|
| analogue-derived (808 whole machine; 909 kick/snare/tom/clap; Simmons toms) | yes, imperfectly — a sine with a pitch envelope really is the topology [11][6]. "We got within X%" is a coherent, measurable goal and closing it is ordinary engineering | defensible, **and creates an obligation** |
| PCM-derived (LinnDrum, DMX, TR-707, RZ-1 throughout; 909/Simmons cymbals) | **no — by construction, not by difficulty.** No sample, no ROM, no route to one in an engine whose premise is synthesis from scratch | a promise that can never be honoured |

### 5.2 How close each kit actually gets — blunt

Scores are my judgement, not a measurement: **unsourced — engineering judgement**, on a 0–5
scale where 5 = a listener familiar with the referent would name it, 3 = the right family,
1 = shares only a label. "Today" is the shipped table; "values" is §2 with no engine change;
"+engine" is §2 plus items 1 and 2 of §6.

| kit | referent | today | values | +engine | what blocks the rest |
|---|---|---|---|---|---|
| Retro Drive | LinnDrum / DMX / Simmons | 2.0 | 3.0 | 3.5 | LinnDrum and DMX are 8-bit PCM [1][33] — unreachable. **The Simmons tom is the one voice of this kit that is analogue [34], and it is exactly the voice §2 changes most.** Gated reverb needs an envelope on the send |
| 909 Modern | TR-909 | 2.0 | 3.0 | 3.5 | kick/snare are analogue and reachable [5]; **hat, open hat, crash and ride are 6-bit PCM [5] and never will be.** Today's `freqStart: 95` also misses the glissando that is the 909 kick's entire character [6] |
| Trap Beat | the 808 used as a tuned sub | 3.0 | 4.0 | 4.0 | genuinely close — a long low sine *is* the sound [9]. Only key-tracking is missing (§6 item 8) |
| 808 Vintage | TR-808 | 2.5 | 3.5 | 4.0 kick / 1.5 metal | **the only machine here that is analogue in every voice** [8], so it is the one kit where accuracy is possible in principle. The metal still needs a 6-oscillator bank [12] |
| Chrome Pulse | none | — | — | — | nothing to be far from; it cannot overclaim |
| Velocity Breaks | Amen break | 2.0 | 3.0 | 3.0 | a *recording* of a 1969 acoustic kit [14]; and its identity is groove and ghost notes [15], which live in `drumGrids.ts`, not here |
| Sub Weight | dubstep | 3.0 | 4.0 | 4.0 | highest today, because dubstep drums are themselves synthesised and layered [16] — there is no vintage box to fall short of |
| Warehouse | Berlin techno | 2.0 | 2.5 | **4.0** | **the largest ceiling gain in the library from the smallest change.** Values alone barely move it, because both defining traits are routing: kick→reverb [18][19] and saturation |
| Tight Pocket | Funky Drummer | 2.0 | 3.0 | 3.0 | a miked 1969 Ludwig kit under blankets [21]; the snare's 6–10 kHz head sound needs a second noise band [23] |
| Acoustic Studio | close-miked kit | 2.5 | 3.0 | 3.5 | bandpassed noise is not bronze; the cymbals are the ceiling |
| Warm Riddim | one drop / dub | 2.0 | **4.0** | 4.5 | **the best values-only return in the library**: a cross-stick is a short pitched wooden tock [24][25], which is precisely what a triangle oscillator with a fast decay does well. Dub's tape echo still needs item 6 |
| Lo-Fi Vinyl | SP-1200 | 1.5 | 2.0 | 3.5 | lowest today, and the only kit whose current value is pointed the *wrong way*: a 3500 Hz highpass makes it the fullest hat in the set, not the dustiest (§2). 12-bit fold-back [28] needs `topCut` or bit reduction |

**The blunt summary: no kit scores above 3.0 today, and the two named after real machines —
`909 Modern` and `808 Vintage` — are not in the top half.** The three kits that score best are the
three with no vintage hardware to be measured against (Trap Beat, Sub Weight, Chrome Pulse). That
is not a coincidence; it is the analogue/PCM split showing up in the scorecard.

### 5.3 The `909 Modern` case specifically

It is the only shipped name that half-claims a machine, so it is worth deciding on its own.

| test | result |
|---|---|
| Is the referent's *topology* something this engine can model? | **For the kick and snare, yes.** The 909's kick is an oscillator with a pitch envelope and an amplitude envelope [5][6]; solna's kick is exactly that. So the claim is defensible *in kind* for two voices |
| Does the kit currently deliver it? | **No.** `freqStart: 95` gives almost no glissando, and the glissando is the 909 kick's whole character [6]. §2 raises it to 175 |
| Is the referent's *hi-hat* something this engine can model? | **No, by construction** — 6-bit PCM of real cymbals [5] |
| Which voices does the claim cover? | kick, snare, tom, clap = defensible. hihat, openhat, crash (+`ride` via `DRUM_ALIASES`) = never. **The unreachable set includes the voice that plays most often** |
| Does "Modern" soften it? | Somewhat — it reads as "a 909 as used now", weaker than "TR-909" but much stronger than "Warehouse". It is not enough to cover a hat that shares nothing with the referent |
| Cost of renaming | **Real, and not cosmetic.** The file header states kit names are the persisted key (`loop.soundKit`), so a rename is a project-file change: a persist migration *and* a `.solna` `migrateProjectBody` step — and per CLAUDE.md those two chains must never be merged, so it is two pieces of work |

**Verdict: the name is not justified by how the kit sounds, and fixing the sound cannot fully
justify it** — the cymbals are out of reach whatever we do to the values. Changing the sound
raises the kick from 2.0 to 3.5 and leaves the hat claim exactly as false as it was.

`808 Vintage` is a different case and I would **keep** it: the 808 is the one machine on the §5.1
table that is analogue in every voice [8], so accuracy there is a real target rather than a
pretence; and in trap and hip-hop "808" has become a common noun for a long sine sub-bass [9]
rather than a claim about a specific box. The right response is to hold that kit to a *higher*
accuracy bar than any other, because it is the only one where the bar is reachable.

### 5.4 Recommendation

**(c), the hybrid — with one rename.**

| option | cost | what it buys | verdict |
|---|---|---|---|
| **(a)** rename toward the real machines, accept the obligation | two migration chains per renamed kit (persist + `.solna`), plus an obligation the engine's own premise forbids: 4 of the 8 machines in §5.1 are PCM throughout and 7 of 8 are PCM for cymbals | a promise of fidelity | **reject.** It signs up for accuracy on voices that are unreachable by construction, not by effort. That is the definition of overclaiming |
| **(b)** evocative names permanently, accuracy as inspiration only | zero | nothing to maintain | **insufficient.** It discards the information. The next person tuning `909 Modern`'s kick has no record that it should glissando from ~175 Hz [6]; they re-derive it, or they do not. That is precisely the loss `DrumGrid.provenance` was added to stop |
| **(c)** evocative name is the identity; the referent is recorded in a documented field | one optional literal field per kit entry; no persisted-key change, no migration, no UI change | the reference is stated where a developer reads it and never promised where a user reads it | **pick this** |

Why (c) is the right shape and not a compromise: the failure mode being guarded against is a
*user-facing* promise the audio cannot keep. A field in `src/data/drumKits.ts` is read by
developers, and developers are exactly who needs the referent. The UI keeps a name that promises a
character — which is the one thing the parameters *can* deliver.

Proposed shape (a proposal; nothing was applied). Note it stays inside the `src/data/` rules:
object literals are the folder's whole purpose, and this adds no function, no `new`, no import.

```ts
/**
 * What the kit is modelled on. Same discipline as DrumGrid.provenance:
 * 'authored' is an honest answer and an allowlisted one; never invent a URL
 * to get off that list. `reachable` is the part that matters — it records
 * which voices the engine can actually approach and which it cannot, so the
 * next person retuning this kit knows what is a gap and what is a wall.
 */
reference?: { referent: string; source: string; reachable: string };
```

```
'Retro Drive' → referent: 'LinnDrum / Oberheim DMX / Simmons SDS-V'
                source:   'en.wikipedia.org/wiki/LinnDrum'
                reachable:'toms only — SDS-V drums are analogue; LinnDrum and DMX are 8-bit PCM'
'Chrome Pulse' → referent: 'authored'   (the allowlist working, not a gap in it)
```

**The one rename: `909 Modern` → an evocative name** (`Club Standard`, `Peak Hour`, `Four Floor`
— naming is the owner's call), because it is the only shipped name that makes a machine claim on
voices the engine cannot reach. If the two-migration cost is judged too high for what is otherwise
a cosmetic gain, the honest fallback is to keep the name **and** give it a `reference` entry whose
`reachable` field says out loud that the hats and cymbals are 6-bit samples and are not modelled.
What is not acceptable is leaving the claim un-annotated.

Sequencing note: do §6 items 1–3 and the §2 retune *before* any rename. A rename is a migration;
a retune is not, and the retune is where nearly all the audible gain is.

## 6. Engine changes that would unlock identity, ranked by value per line changed

| # | change | unlocks | size |
|---|---|---|---|
| 1 | `reverbSend?: number` on `KickParams` and `TomParams`; pass it in `drumTone` → `wireDrumVoice` (which already accepts it) | Warehouse's kick rumble [18][19] — the single difference that makes Warehouse ≠ 909 Modern. Also gives Acoustic Studio a room | ~4 lines |
| 2 | `topCut?: number` on `HatParams`: a second `lowpass` biquad in the hat path | the only route to 808 (12 kHz), LinnDrum (12 kHz), 909 (15 kHz) and Lo-Fi hats [4][28]. Turns the hat from a 1-axis voice into a 2-axis one across the busiest row in the library | ~6 lines |
| 3 | Add `hihat.decay`, `hihat.gain`, `kick.clickLevel` to `check-drum-kit-separation.ts`; add a **pairwise** nearest-neighbour check alongside the aggregate spread | stops the collapse that this document documents from recurring | test-only |
| 4 | Guard vibe `soundKit` against `DRUM_KITS` in `store/vibes.test.ts` | Gap 3 above | 1 assertion |
| 5 | A `bell` voice (2 squares + bandpass, 800/540 Hz) | Afro 6/8 [8] | ~15 lines |
| 6 | Per-voice `delaySend` | dub [26][27]; deliberately reverses an earlier removal, so needs its own discussion | medium |
| 7 | An envelope on the reverb send gain | true gated reverb for Retro Drive [2] | medium |
| 8 | `trackPitch` on `KickParams` so `freqEnd` follows the key | trap's melodic 808 [9] | medium; crosses the `audio/` ← `store/` boundary, so it must arrive via `engineSync.ts` |
| 9 | `reference?: { referent, source, reachable }` on the kit entry (§5.4) | the audio twin of `DrumGrid.provenance`; costs no migration | ~1 field + 12 literals |
| 10 | An inharmonic oscillator bank for hats — 6 squares, 2–5 kHz, through a highpass, per the 808 [12] | the only path to a *metallic* hat rather than a hissy one; would raise 808 Vintage's metal from 1.5 to ~3.5 (§5.2) | largest of the list; do items 1–3 first |

Distortion on the drum bus is **not** recommended: drums bypassing distortion is a deliberate
routing decision, and Warehouse can be reached well enough by items 1 and 2.

---

## Sources

Fetched and read in full:

1. Wikipedia, *LinnDrum* — https://en.wikipedia.org/wiki/LinnDrum
2. Wikipedia, *Gated reverb* — https://en.wikipedia.org/wiki/Gated_reverb
3. Vector Presets, *Free Synthwave VST Plugins: Drums* — https://vectorpresets.com/blogs/free-vst-plugins/free-synthwave-drum-vsts
4. Electronic Production, *Hi-Hat Top-End Roll-Off: Why Classic Drum Machines Sound Different* — https://www.electronicproduction.co.uk/post/hi-hat-top-end-roll-off-why-classic-drum-machines-sound-different
5. Wikipedia, *Roland TR-909* — https://en.wikipedia.org/wiki/Roland_TR-909
8. Wikipedia, *Roland TR-808* — https://en.wikipedia.org/wiki/Roland_TR-808

Read via search-result extract (page content, not fetched in full):

6. ModeAudio, *Massive Drum Design, Part 1: Kicks* — https://modeaudio.com/magazine/using-synths-for-drums-part-1-kicks
7. ADSR Sounds, *How to Make a 909 Kick in Reaktor* — https://www.adsrsounds.com/reaktor-tutorials/how-to-make-a-909-kick-in-reaktor/
9. Orphiq, *What Is an 808 in Music? Sound, History, and Bass Lines* — https://orphiq.com/resources/808-drums-explained
10. eMastered, *Trap Drum Patterns: The Ultimate Guide* — https://emastered.com/blog/trap-drum-patterns
11. Baratatronix, *Roland TR 808 Bass Drum Synthesis* — https://www.baratatronix.com/blog/808-bd-synthesis
12. ModWiggler forum, *Synthesizing 808 hi hats* — https://www.modwiggler.com/forum/viewtopic.php?t=120280
13. KVR Audio forum, *TR 808 kick drum — modelling bridged-T* — https://www.kvraudio.com/forum/viewtopic.php?t=418439
14. UKF, *10 Things You Need To Know About: The Amen Break* — https://ukf.com/read/10-things-you-need-to-know-about-the-amen-break/
15. Ethan Hein, *Building the Amen break* — https://www.ethanhein.com/wp/2023/building-the-amen-break/
16. SoundBridge, *A Quick Guide to Designing Dubstep Drums* — https://www.soundbridge.io/designing-dubstep-drums
17. Unison, *How to Make Dubstep Beats Step-by-Step* — https://unison.audio/how-to-make-dubstep/
18. Attack Magazine, *Processing Berghain Kicks With Multiband Distortion* — https://www.attackmagazine.com/technique/tutorials/processing-berghain-kicks-with-multiband-distortion/
19. Attack Magazine, *Beat Dissected: Dark Berlin Techno* — https://www.attackmagazine.com/technique/beat-dissected/dark-berlin-techno/
20. Undrgrnd Sounds, *Warehouse Techno Production Tips and Tricks* — https://undrgrndsounds.com/blogs/news/warehouse-techno-production-tips-and-tricks
21. Reverb, *Recreating James Brown's "Funky Drummer" Drum Sound* — https://reverb.com/news/video-recreating-the-funky-drummer-drum-sound-whats-that-sound
22. Wikipedia, *Funky Drummer* — https://en.wikipedia.org/wiki/Funky_Drummer
23. Music Guy Mixing, *Drum EQ Chart* — https://www.musicguymixing.com/drum-eq-chart/
24. Wikipedia, *One drop rhythm* — https://en.wikipedia.org/wiki/One_drop_rhythm
25. MusicRadar, *How to program a typical one drop reggae beat and add fills* — https://www.musicradar.com/how-to/how-to-program-a-typical-one-drop-reggae-beat-and-add-fills
26. Wikipedia, *King Tubby* — https://en.wikipedia.org/wiki/King_Tubby
27. Ableton, *A Brief History of The Studio As An Instrument: Part 3* — https://www.ableton.com/en/blog/studio-as-an-instrument-part-3/
28. LANDR, *SP-1200: The Sampler That Changed Hip-Hop Forever* — https://blog.landr.com/sp-1200/
29. Beat Production, *SP1200 Drums* — https://beatproduction.net/sp1200-drums/
30. Output, *Best Boom Bap VSTs: Drums, Bass & Sampling Plugins* — https://output.com/blog/best-boom-bap-vst-plugins
31. Wikipedia, *Roland TR-707* — https://en.wikipedia.org/wiki/Roland_TR-707
32. Vintage Synth Explorer, *Roland TR-707* — https://www.vintagesynth.com/roland/tr-707
33. Wikipedia, *Oberheim DMX* — https://en.wikipedia.org/wiki/Oberheim_DMX
34. Equipboard, *Simmons SDS-V Drum Synthesizer* — https://equipboard.com/items/simmons-sds-v-drum-synthesizer
35. Reverb, *The Casio RZ-1: An Entry-Level Sampler Behind Top-Tier Beats* — https://reverb.com/news/the-casio-rz-1-an-entry-level-sampler-behind-top-tier-beats
36. Vintage Synth Explorer, *Casio RZ-1* — https://www.vintagesynth.com/casio/rz-1
37. Attack Magazine, *ROM Expansion Enhances Roland TR-707 With Samples From The TR-808, LinnDrum And More* — https://www.attackmagazine.com/news/rom-expansion-roland-tr-707/

**37 sources.** Chrome Pulse's entire parameter set, and the specific numeric values proposed for
every kit, are **unsourced — engineering judgement** derived from the sourced characteristics
above and from the measured behaviour of `triggerDrum`; the sources establish *what the target
sounds like*, not what a Web Audio parameter should be set to.

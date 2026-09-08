# DEV-383 — Gain staging: shared contract and plan index

Every plan in this epic argues from this file. It carries the numbers that are an
**interop contract with murva** and the module surface each sub-issue creates or
consumes. A plan may not restate a number here with a different value; if one has to
move, it moves here first and the pinning test (DEV-388) is the thing that notices.

**Spec:** Linear DEV-383 and its five sub-issues (DEV-384 … DEV-388).
**Reference implementation:** `~/Sites/Personal/murva/murva-app/app/frontend/`.

---

## Plan index — execution order

| # | Issue | Plan | Branch |
|---|-------|------|--------|
| 1 | DEV-384 | `2026-09-07-dev-384-dbfs-metering.md` | `feat/dev-384-dbfs-metering` |
| 2 | DEV-385 | `2026-09-07-dev-385-master-dynamics-fx.md` | `feat/dev-385-master-dynamics-fx` |
| 3 | DEV-386 | `2026-09-07-dev-386-db-faders.md` | `feat/dev-386-db-faders` |
| 4 | DEV-387 | `2026-09-07-dev-387-level-calibration.md` | `feat/dev-387-level-calibration` |
| 5 | DEV-388 | `2026-09-07-dev-388-db-contract-pin.md` | `feat/dev-388-db-contract-pin` |
| 6 | DEV-389 | *(not yet planned — design work)* | `feat/dev-389-meter-fader-ui` |

Order is load-bearing. #1 gives the rest a real meter. #2 rewires the tap #1 moved.
#3 needs #1's `gainUnits.ts`. #4 needs #1's measurement path. #5 pins what #3 and #4
land, and is meaningless before them. #6 is design work on top of #1 and #3's wiring
and blocks nothing.

**Wiring and visual design are split deliberately.** #1 and #3 land everything below the
pixels — the unit layer, zone classification, the piecewise scale, the tiered scheduler,
`useMeterLevel`, an honest analyser tap, `meterColorForZone`, and a `VolumeFader` that
owns the taper. They give the two surfaces that already have a visual identity
(`VuMeter`, `AmbientBackdrop`) honest readings and stop there. #6 (DEV-389) owns the
meter's visual design and its placement beside every channel strip. Placing a per-source
meter in five views before deciding what a meter looks like would mean designing it five
times, and improvising that design inside a plumbing change is how it would happen.

---

## The numbers — copied from murva, never re-derived

Each is `murva path → value`. A plan cites this table; it does not re-argue the value.

**`src/shared/audio/gainUnits.ts`**

| Constant | Value |
|---|---|
| `UNITY_DB` | `0` |
| `UNITY_GAIN` | `1` |
| `DISPLAY_FLOOR_DBFS` | `-60` |
| `DEFAULT_UNITY_POS` | `0.75` |
| fader range | `-60 .. +12` dB |

**`src/shared/audio/meterZones.ts`**

| Constant | Value | Zone |
|---|---|---|
| `ZONE_TOO_QUIET_MAX` | `-24` | `tooQuiet` is `< -24` |
| `ZONE_GOOD_MAX` | `-6` | `good` is `-24 .. -6` |
| `ZONE_HOT_MAX` | `-1` | `hot` is `-6 .. -1`, `over` is `>= -1` |

**`src/shared/audio/meterScale.ts`** — piecewise, three segments:

| dBFS range | percent of track |
|---|---|
| `<= -60` | `0` |
| `-60 .. -48` | `0 .. 5` |
| `-48 .. -24` | `5 .. 30` |
| `-24 .. +6` | `30 .. 100` |

`METER_SCALE_CEILING_DBFS = 6`. `METER_TICK_DBFS = [-24, -6, 0]`.

**`src/engine/instruments/shared/calibration/trimMath.ts`**

| Constant | Value |
|---|---|
| `TARGET_DBFS` | `-18` |
| `TOLERANCE_DB` | `3` |

**Meter behaviour** (murva `src/features/audio/hooks/useMeterLevel.ts`)

| Constant | Value |
|---|---|
| `PEAK_DECAY_DB_PER_SEC` | `14` |
| `DEFAULT_RMS_WINDOW_MS` | `300` |
| `LEVEL_EPSILON_DB` | `0.1` |
| tier `master` | `1000 / 60` ms |
| tier `track` | `1000 / 30` ms |
| tier `offscreen` | `Infinity` (never ticks) |
| `TICK_EPSILON_MS` | `1` |

---

## Solna divergences from murva — deliberate, decided, do not "fix"

1. **No Zod branding.** murva brands `Decibels` / `Dbfs` / `LinearGain` with
   `z.number().brand<…>()`. solna has no Zod and is not adding one for 90 lines of
   arithmetic. Use plain TS branded aliases. **Keep the naming distinction**, which is
   the part that carries meaning: `Decibels` is RELATIVE (a fader or trim; `0` = unity;
   may be ±). `Dbfs` is ABSOLUTE (a meter reading; `0` = ceiling).

2. **Silence is a finite `-60 dB`, not `-Infinity` — and it is TRUE silence.** murva's
   canonical `SILENCE_DB` is `-Infinity`, which survives its Zod socket boundary. solna's
   values go through `JSON.stringify` twice — `persist` and the `.solna` body — and
   `JSON.stringify(-Infinity)` is `null`. So **stored** silence is the finite sentinel
   `-60`, which coincides with `DISPLAY_FLOOR_DBFS` so the fader bottom and the silence
   value are the same place. `-Infinity` remains legal **in transient meter readings
   only**, which are never serialised.

   The bottom of a fader's travel is a **detent**: it *displays* `-∞`, *stores* `-60`, and
   the store→engine boundary maps exactly `-60` to linear gain **`0`**, not
   `dbToGain(-60)`'s `0.001`. Every DAW's fader bottom is silence rather than "very
   quiet"; the finite sentinel keeps it JSON-safe and murva-importable; and the
   `-59.9 → -60` discontinuity is inaudible in both directions, so it produces no click.
   The sentinel is named, never a bare `-60` literal scattered around.

3. **The master compressor and limiter stay, toggleable; the limiter defaults ON, the
   compressor stays OFF.** murva deleted its limiter outright (DEV-322). solna keeps both
   because dice and vibes generate arrangements nobody gain-staged by hand. DEV-385 shipped
   both off for honest metering — an always-on limiter had capped a meter at -3 dBFS. DEV-383
   reverses that for the limiter only: the master analysers tap ahead of both dynamics stages
   (see `rewireMasterDynamics` in `src/audio/engine.ts`), so metering stays honest regardless
   of the limiter's state, and the limiter's -3 dB threshold against the new -6 dB source-bus
   default only catches occasional peaks, not a continuous squash. The compressor has no such
   argument for defaulting on, so it stays off; the toggle keeps both nets available.

4. **Internal voicing constants stay linear.** Drum-kit `gain` / `clickLevel` / `bodyGain` /
   `noiseGain` / `reverbSend`, preset `subOscVolume` / `noiseVolume`, and vibe pad `volume`
   are **not** faders and are explicitly out of DEV-386's scope. Their problem is
   consistency between kits, which DEV-387 solves with a measured trim.

5. **Live playback has no headroom, and a positive kit trim now sits closer to full scale.**
   DEV-387's calibration harness renders 12 dB (`CALIBRATION_HEADROOM_DB`) below unity so a
   trimmed kit reference can peak at a float 2.02 without clipping the measurement itself —
   but that headroom exists only inside the harness. Live playback has none. As of this
   issue, `limiterEnabled` defaults to `true` and `compressorEnabled` stays `false`
   (`src/store/initialState.ts`, divergence 3 above) — the limiter's -3 dB threshold against
   the new -6 dB source-bus default catches occasional peaks rather than compressing
   continuously, so the kits whose calibration trim is positive — Tight Pocket at +3.7 dB,
   Lo-Fi Vinyl at +3.2 dB — can still push a dense groove into the limiter more than they did
   before calibration, even though it is no longer fully unguarded. This is calibration
   working as intended, not a defect: those kits were quietly too quiet before, and the trim
   raises them. Capping how positive a kit trim may land remains a possible future refinement,
   recorded so the next person reasoning about headroom finds it before assuming a
   dense-groove clip is a new bug. See
   `scripts/calibration/README.md`'s "Positive trims move kits closer to full scale on live
   playback" section, which this note carries forward from DEV-387/DEV-388.

---

## Module surface — who creates what, who consumes it

Created by **DEV-384**, consumed by everything after it:

```ts
// src/utils/gainUnits.ts   (pure; no runtime imports)
export type Decibels = number & { readonly __brand: 'Decibels' };
export type Dbfs = number & { readonly __brand: 'Dbfs' };
export type LinearGain = number & { readonly __brand: 'LinearGain' };
/** A per-hit PERFORMANCE attribute, 0..1 — never a fader value. See D-383-3. */
export type Velocity = number & { readonly __brand: 'Velocity' };

export const toDecibels: (value: number) => Decibels;
export const toDbfs: (value: number) => Dbfs;
export const toLinearGain: (value: number) => LinearGain;
export const toVelocity: (value: number) => Velocity;

export const UNITY_DB: Decibels;                 // 0
export const UNITY_GAIN: LinearGain;             // 1
export const SILENCE_DB: Decibels;               // -60  (solna divergence 2)
export const DISPLAY_FLOOR_DBFS: number;         // -60
export const FADER_MAX_DB: number;               // +12
export const DEFAULT_UNITY_POS: number;          // 0.75

export const dbToGain: (db: Decibels) => LinearGain;
export const gainToDb: (gain: LinearGain) => Decibels;
export const gainToDbfs: (gain: LinearGain) => Dbfs;
export const clampForDisplay: (value: number, floor?: number) => number;
export const dbToSliderPos: (db: number, minDb?: number, maxDb?: number, unityPos?: number) => number;
export const sliderPosTodB: (pos: number, minDb?: number, maxDb?: number, unityPos?: number) => Decibels;
export const formatDb: (db: number) => string;   // "0.0 dB", "-6.0 dB", "-∞ dB" at SILENCE_DB

/**
 * The linear ceiling every fader-driven gain clamps to, DERIVED from the fader range
 * rather than being an independent magic number — see D-383-4. `dbToGain(12)` ≈ 3.98.
 * `src/audio/engine.ts` imports this CONSTANT (not a function), which is why the ceiling
 * and the fader range cannot drift apart.
 */
export const MAX_FADER_GAIN: LinearGain;
```

```ts
// src/utils/meterZones.ts  (pure)
export type MeterZone = 'tooQuiet' | 'good' | 'hot' | 'over';
export const ZONE_TOO_QUIET_MAX: number;   // -24
export const ZONE_GOOD_MAX: number;        // -6
export const ZONE_HOT_MAX: number;         // -1
export function classifyZone(peakDbfs: number): MeterZone;
```

```ts
// src/utils/meterScale.ts  (pure; imports the two above)
export const METER_SCALE_CEILING_DBFS: number;          // 6
export const METER_TICK_DBFS: readonly number[];        // [-24, -6, 0]
export function dbfsToPercent(dbfs: number): number;    // 0..100
```

```ts
// src/utils/meterScheduler.ts   (side-effecting singleton; rAF + IntersectionObserver)
export type MeterTier = 'master' | 'track' | 'offscreen';
export interface MeterRegistration {
  id: string;
  tier: MeterTier;
  analyser?: AnalyserNode;
  domain?: 'time' | 'frequency';
  onTick: (buffer: Float32Array) => void;
}
export const TIER_INTERVAL_MS: Record<MeterTier, number>;
export function registerMeter(reg: MeterRegistration): () => void;
export function observeVisibility(id: string, element: Element): () => void;
export const __resetSchedulerForTests: () => void;
export const __tickForTests: (now: number) => void;
export const __registrySizeForTests: () => number;
```

```ts
// src/components/ui/useMeterLevel.ts   (React hook; lives in components/ — it is a
// read-only analyser consumer and needs the same eslint exemption VuMeter holds)
export interface MeterLevel { peakDbfs: number; rmsDbfs: number; heldPeakDbfs: number }
export function useMeterLevel(
  analyser: AnalyserNode | null,
  options: { tier: MeterTier; visibilityRef?: RefObject<Element | null>; rmsWindowMs?: number },
): MeterLevel;
```

Also created by **DEV-384**, and not in the original surface above — recorded here so a later
plan consumes the real names rather than the ones this document guessed:

```ts
// src/utils/meterLevel.ts   — the pure peak / windowed-RMS / peak-hold math
export interface MeterLevel { peakDbfs: number; rmsDbfs: number; heldPeakDbfs: number }

// src/utils/meterAttach.ts  — internal glue between the scheduler and a level reading
// src/utils/meterColor.ts
export function meterZoneClass(zone: MeterZone): string;   // NOT `meterColorForZone`
// src/components/ui/MeterBar.tsx — PROVISIONAL presentation; DEV-389 replaces it
```

Created by **DEV-386**:

```ts
// src/store/levelUnits.ts — store-layer POLICY, deliberately not in gainUnits.ts
/**
 * The fader's dB → linear conversion, including the silence detent: returns exactly 0 at
 * or below SILENCE_DB rather than dbToGain's 0.001. This is policy about what a fader's
 * bottom MEANS, not a unit conversion, which is why it does not live beside dbToGain.
 */
export const faderDbToGain: (db: number) => LinearGain;
```

Created by **DEV-387**:

```ts
// src/data/trimTable.ts  (GENERATED; a src/data/ leaf — literals only, no imports,
// no `new`, no impure globals; src/data/dataLayerPurity.test.ts lints it)
export interface TrimEntry { measuredDbfs: number; trimDb: number; configHash: string }
export const DRUM_TRIMS: Record<string, TrimEntry>;   // kit name -> entry (whole kit)
export const PRESET_TRIMS: Record<string, TrimEntry>; // preset id
```

**DRUM_TRIMS is keyed by kit name, not by kit+voice.** The plan originally specified
`Record<string, Record<string, TrimEntry>>` (kit → voice), by analogy with murva's
per-instrument normalisation. Running the generator for real proved that model wrong
for drums: Trap Beat measured kick −13.7, snare −19.7, hihat −47.5, ride −45.9 dBFS —
a 33.8 dB span *inside one kit*, which is the kit's designed identity, not noise.
Normalising each voice to a common `TARGET_DBFS` would have trimmed that hihat
+29.5 dB and its kick −4.3 dB, closing the gap to roughly zero, across all 13 kits;
37 voices across the roster needed more trim than the ±12 dB fader range can give,
every one of them a clap, hihat, ride or openhat — the accent/wash voices a kit
deliberately sits quieter than its kick.

Per-voice normalisation fits *independent* instruments, which is why it is right for
`PRESET_TRIMS` (synth presets are independent patches; 28 of 29 already land inside
the ±3 dB band, only `factory-cyber-drone` flags). A drum kit's voices are not
independent — their relative levels are the instrument. So the trim is measured and
applied per KIT: `scripts/calibration/renderOffline.ts`'s `DRUM_KIT_BAR` (a fixed
kick/snare/closed-hat backbeat, identical across every kit, so kit-to-kit numbers
stay comparable) is rendered and measured as a whole, `drumLoudnessHash(kitName)`
fingerprints every voice of the merged kit together so retuning ANY voice fires the
lock test for that kit, and `src/audio/trims.ts`'s `drumTrimGainFor(kitName)`
resolves one gain per kit change, multiplied into `triggerDrum`'s post-`clampVelocity`
`hitLevel` exactly as before. Decision recorded on Linear DEV-387.

---

## Version ownership — who bumps what, in order

Two plans independently claimed persist `v16` for different content, and DEV-388 named the
wrong version as the interop boundary. Both were caught in review; this table exists so the
class cannot recur. **Check it before writing any migration step.**

Starting point on `main`: persist `version: 15` (`store.ts`), `PROJECT_FORMAT_VERSION = 7`
(`projectFormat.ts`).

| Plan | persist `version` | project `formatVersion` | what the step does |
|---|---|---|---|
| DEV-384 | — | — | no persisted shape changes |
| DEV-385 | **15 → 16** | — *(deliberately none)* | resets the master-dynamics keys |
| DEV-386 | **16 → 17** | **7 → 8** | `masterVolume` → dB (convert) |
| DEV-386 | **17 → 18** | **8 → 9** | the five bus faders → dB (convert) |
| DEV-386 | **18 → 19** | **9 → 10** | `SequencerTrack.volume` → dB (**reset** to 0 dB) |
| DEV-387 | — | — | the trim table is source, not persisted state |
| DEV-388 | — | — | documents the contract; bumps nothing |

**DEV-386's three bumps stay three.** Collapsing them would give one guard whose output
changes across commits — the same rule broken from the other direction. Each task's migration
output is final at its own commit.

**The interop boundary is `formatVersion` 10 — the version at which the LAST level key becomes
dB, not the first.** "The version dB levels first land" is the phrasing that produced the bug:
a body at v8 or v9 carries a **mixture** of units (v8: `masterVolume` dB, buses still linear;
v9: buses dB, `sequencerTracks[].volume` still linear). An importer must reject v8 and v9
rather than guess, because reading a linear `1.0` as `+1 dB` is a silent, plausible wrong
answer instead of a visible failure.

## Constraints every plan inherits

These come from `CLAUDE.md` and the epic. Each is a real failure mode in this repo,
not a style preference.

- **`bun run verify` is the gate.** It must be green, and `bun run eslint` must report
  **nothing at all** — no errors and no warnings. A new rule lands as `warn` and flips
  to `error` in the change that empties it (decision D5).
- **All four tab views stay mounted** (`App.tsx` toggles `block`/`hidden`). Anything
  per-frame must be pausable per view. Without the scheduler, every hidden tab's meters
  read analysers forever.
- **No meter value, and no gain-reduction readout, may enter a zustand slice.** A store
  write per frame re-renders every mounted view. Keep it local to the meter subtree.
- **Engine setters are called only from `src/store/engineSync.ts`**, never from a
  component (layering rule 3).
- **`src/audio/` keeps receiving linear gain.** No engine setter signature changes for
  DEV-386; the dB→linear conversion happens at the store→engine boundary.
- **`src/data/` files are independent leaves**: no runtime import (not even a sibling),
  no `new`, no impure global, no declared function beyond literal-shorthand helpers.
- **Persist `version` and project `formatVersion` are separate chains and must never be
  merged.** A persist payload is private `localStorage` shape; a project body is an
  external contract. Bump each in its own file, with its own step.
- **A version stamped into persisted data is a contract.** Do not ship a migration
  guard before its output is final; if the output must change later, bump again rather
  than redefining what the old number meant.
- **No backward compatibility is required** (the app has no real users). A migration
  step may be a documented *reset* to defaults rather than a conversion — but it must
  say so in its comment.
- **`localStorage` can throw**, not just return null. All storage access stays guarded.
- **Testing trap:** roughly a third of the suite renders through `renderToString`, and
  zustand wires `getServerSnapshot` to the store's **creation-time** state — so
  `useAppStore.setState(...)` before a render has no effect unless the component reads
  the store the way `ui/BottomInputDock.tsx` does. See `.claude/rules/testing.md`.
- **Read `.claude/skills/dsp-audio`** before touching effect chains, signal routing or
  `AudioContext` lifecycle.

---

## Line numbers in these plans are navigation, not references

Every `file.ts:123` in a plan was resolved against `main` on 2026-09-07 and **will drift**: each
sub-issue inserts lines into the files the next one edits — DEV-385 alone adds a guard line to
`store.ts`'s `migrate`, which moves everything DEV-386 cites below it.

**At execution time, locate by symbol, not by line.** Grep for the function, constant or comment
the plan names; the surrounding prose always names it. A line number that no longer matches is
expected, not a sign the plan is wrong. Nothing a plan says about line numbers is ever copied
into source or into a committed doc — CLAUDE.md bans that outright, and it is why the plans are
the only place they appear.

## Decisions taken for this epic (2026-09-07)

**D-383-1 — `SequencerTrack.volume` gets wired up as a per-track GAIN, not deleted.**
Recon found the field is stored, persisted, and in the `.solna` body, but read by
nothing: `useSequencerPlayback.ts:150` uses only `masterSequencerVolume`, and no UI
exposes a per-track fader. Rather than convert a fiction to dB or delete it, DEV-386
makes it real — stored in dB, applied as a **GainNode** between the voice envelope and
`drumBusFilter`, fed from `engineSync.ts` like every other fader, and given a fader in
the sequencer track row. **Not** multiplied into velocity — see D-383-3.

**D-383-3 — velocity and gain are separate quantities, and the sequencer path currently
conflates them.**

`masterSequencerVolume` is applied **twice** on the drum path today:

- `engineSync.ts`'s `SOURCE_BUSES` maps `sequencer → masterSequencerVolume`, so
  `setSourceGain('sequencer', v)` sets the bus `GainNode`.
- `engine.ts:727` — `drumBusFilter.connect(getSourceBus('sequencer'))`, so every drum
  voice passes through that bus.
- `useSequencerPlayback.ts:150,161` — the same `masterSequencerVolume` is passed as the
  **velocity** argument to `triggerPad` → `triggerDrum`, where `clampVelocity` feeds it
  into each voice's peak (`peak: v * s.bodyGain`).

Drum output is therefore proportional to `masterSequencerVolume²`. At the 0.8 default
that is 0.64 — −3.9 dB where the fader says −1.9 dB; at 0.5 it is −12 dB where the fader
says −6 dB. A squared fader law is precisely what an honest meter exists to expose, so
the fix belongs in this epic, in DEV-386, **before** `masterSequencerVolume` is converted
to dB — converting a squared curve first only makes the wrong curve harder to read.

**The rule, from murva's `NoteEvent`/mixer split:**

| | what it is | range | who sets it | where it lands |
|---|---|---|---|---|
| `Velocity` | a per-hit **performance** attribute | `0..1` linear | MIDI `data[2]/127`, a pad's strike strength, a step accent | a voice's peak envelope, per note |
| `Decibels` → `LinearGain` | a **level** | `-60..+12` dB | a fader, via `engineSync.ts` | a `GainNode` that persists across notes |

**A fader value is never passed into a velocity parameter, and a velocity is never
written to a gain node a fader owns.** Add `Velocity` as a branded alias beside
`Decibels` / `Dbfs` / `LinearGain` so the two cannot be assigned to each other by
accident.

solna already honours this on the **synth** path — `triggerSynthNoteOn` takes a real
velocity (`peakGain = velocity * 0.4 * scaleFactor`) while `setSourceGain` owns the bus,
and MIDI note velocity reaches it correctly through `synthPlaybackNoteOn` at
`midiInput.ts:150`. Only the sequencer path breaks the rule.

**Velocity stays a fixed constant in this epic.** The squaring fix at
`useSequencerPlayback.ts:150` passes `DEFAULT_VELOCITY` (`src/audio/constants.ts`,
currently `0.8`) and nothing else. No velocity model, no per-step accent, no stored
note velocity, no velocity lane — that is deliberate future work, not an oversight.

Three existing velocity sources are **out of scope and must not be flattened to 0.8** —
each is working, audible behaviour today:

- MIDI live velocity at `midiInput.ts:150` (`velocity / 127`).
- `bassPatterns.ts:130` — `DEFAULT_VELOCITY * (step.velocity ?? 1)`, the authored accents.
- `DEFAULT_PADS` in `ui/DrumPadGrid.tsx` — per-pad strike strength (kick `0.9`, hihat `0.75`).

**Recorded, not fixed in this epic** (two instances of the same conflation, both benign
today — do not fix them here, but do not let a new one land either):

- `DEFAULT_PADS` in `src/components/ui/DrumPadGrid.tsx` calls each pad's strike strength
  `volume` when it is a velocity.
- `sequencerStepEvents`' `'note'` branch calls `playbackNoteOn(...)` with `source`
  defaulting to `'synth'`, so a melodic sequencer track sums on the Lead bus while being
  scaled by the Beat fader. Latent: all eleven canonical tracks are drum voices.

**D-383-4 — one `VolumeFader` component owns the taper; the engine ceilings derive from
the fader range.**

After DEV-386 there are ~20 fader call sites: the transport master, `ChannelStrip` (used
by the chord / bass / pad panels, `SynthView` and `SequencerView`), five in
`SortableLoopCard`, and eleven per-track drum faders. With the taper at the call sites,
AC "faders use the DAW-style taper, unity at 0.75 of travel" is unenforceable; with one
component it is true by construction. `src/components/ui/VolumeFader.tsx` owns the taper,
the `formatDb` readout, double-click-to-unity, and the `-∞` detent. `ChannelStrip` becomes
a thin wrapper around it. DEV-389 owns how it looks.

**And the engine's clamps currently make `+12 dB` unreachable — a real bug, found during
planning, not in any issue:**

| site | clamp today | effect on a `-60..+12` fader |
|---|---|---|
| `engine.ts:1422` `setSourceGain` | `Math.min(1.5, volume)` | `dbToGain(+12) = 3.98` clamps to `1.5` = **+3.5 dB**; the top 8.5 dB does nothing |
| `engine.ts:2446` `setMasterVolume` | `Math.min(1, vol)` | clamps to `1.0` = **0 dB**; the master cannot boost at all |

A fader that displays `+12 dB` and stops responding above `+3.5 dB` is precisely the
dishonesty this epic exists to remove. Both ceilings become `dbToGain(FADER_MAX_DB)` —
**derived from the fader range, not an independent magic number**, so the two cannot
drift. Fixed in DEV-386.

**D-383-2 — offline rendering uses `node-web-audio-api`, not Playwright.**
The DEV-387 spike is resolved empirically: `node-web-audio-api@2.2.0` loads under
Bun 1.3.14, renders an `OfflineAudioContext`, and exposes `cancelAndHoldAtTime`;
ffmpeg 9.0.1 is on PATH. murva's Playwright route (Option B) is therefore **not** taken.
The package lands as a **devDependency used only by `bun run calibration:generate`**,
which is manual and on-demand. CI sees only the committed trim table and the
millisecond-scale lock test — no native addon on the `bun test` critical path.

**Proven end to end on 2026-09-07, not merely assumed.** solna's real `AudioEngine`,
fed a `node-web-audio-api` `OfflineAudioContext` through the existing `testFakes.ts`
seam (`(engine as any).ctx = ctx`, then `setupMasterChain()`), rendered eight Club
Standard kicks at velocity 1.0 over four seconds: **peak −0.69 dBFS, RMS −18.81 dBFS**.
The seam works, `setupMasterChain` runs against a real offline context, and the drum
voices sound. Two incidental readings worth carrying into DEV-387: a single kick at full
velocity already peaks inside the `over` zone (≥ −1 dBFS), and the untrimmed RMS lands
within a decibel of the −18 dBFS target, so the trims should come out small.

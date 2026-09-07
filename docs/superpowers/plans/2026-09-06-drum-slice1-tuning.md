# Drum Slice 1 — Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retune every drum-kit value in the library — kick sweep and click, clap burst shape, snare body and noise balance, hat decay range, tom sweep depth — so the thirteen kits sound like what they are named after, and tighten `check:drums` so the collapse those values fell into cannot happen again.

**Architecture:** Slice 1 of the four-slice design in the spec. It changes **numbers only** — twelve `Partial<DrumKit>` literals plus `DEFAULT_DRUM_KIT` in `src/data/drumKits.ts`, three numbers in one array-free envelope literal at the `clap` case in `src/audio/engine.ts`, and the parameter list in `scripts/check-drum-kit-separation.ts`. No new field, no new voice, no new signal path, no migration.

**Tech Stack:** TypeScript, Bun (test runner + scripts), raw Web Audio API. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md` — Slice 1 is decisions **13–19**, bound by the cross-slice contract in decisions **1–12** and the verification requirements in decisions **39–43**.

**Evidence base (numbers copied into this plan verbatim, so no task needs to re-open them):**
- `docs/research/2026-09-06-drum-synthesis-kick-snare-clap-toms.md` — §1.2, §1.3, §1.4, §2.3, §3.4, §4.3, §5(a)
- `docs/research/2026-09-06-drum-kit-identities.md` — §2 (per-kit target parameters), §3 (near-neighbour pairs)
- `docs/research/2026-09-06-drum-synthesis-hats-and-cymbals.md` — §5.1 (the five hat archetypes)

---

## Global Constraints

**Controller ruling that changes the spec's own framing — apply it, and it is why the clap task is in slice 1.**
The spec's open question 1 records that decision 15 (the clap-shape rewrite) sits in a slice labelled *"values only, no code change"*, while the clap envelope is measurably hardcoded at `src/audio/engine.ts:1732–1735` rather than being a kit parameter. **Ruling: the clap fix stays in slice 1, and slice 1's criterion is restated.** Slice 1 is **"tuning only — no new capability"**: it may change **numbers**, whether those numbers live in `src/data/drumKits.ts` or in an array literal at a `triggerDrum` call site, but it **may not add a parameter, a voice, or a signal path.** The clap shape is three numbers in a literal. The original "no code change" wording was the controller's error, not the spec's. **A reviewer must not flag Task 2 as out of slice.**

**The data-layer rule (`CLAUDE.md`, enforced by `src/data/dataLayerPurity.test.ts` and eslint).**
`src/data/**` imports nothing at runtime, not even a sibling in `src/data/`. It reads no impure global (`Math`, `Date`, `crypto`, …), declares no function, constructs no object with `new`, and holds no module-scope `let`/`var`. `drumKits.ts` lives there, so **every value change in Tasks 1, 3, 4 and 5 is an edit to a literal table and nothing else** — no helper, no derived constant, no computed value. Write `41.20`, never `Math.round(...)`.

**The gate.** `bun run verify` = `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`. **eslint must report zero errors.** Run it as the **last step of every task**, before the commit step.

**Measure by evaluating, never by grepping.** Every count in this plan came from `bun -e` over the real table. A documented past incident on this repo put a grep-derived count into a spec. When a step tells you to measure, run the command; do not eyeball the table.

**`mergeDrumKit` is a one-level spread per drum type** (`src/audio/drumKits.ts:4–14`): `{ ...DEFAULT_DRUM_KIT.kick, ...partial?.kick }`. **A kit therefore cannot remove a key `DEFAULT_DRUM_KIT` defines.** Consequence, and it is load-bearing for Task 1: **`DEFAULT_DRUM_KIT.kick` must stay clickless**, or `808 Vintage` and `Trap Beat` — which the 808 has no click path to justify — cannot omit theirs.

**Slice 1 must not touch:** grid rows (`src/data/drumGrids.ts`), the voice roster, `DRUM_ALIASES`, sequencer tracks, either migration chain, theme colours, or any engine signal path. Those are slices 2–4 (spec decisions 20–38).

**A green gate cannot judge whether drums sound right (spec decision 39).** Slice 1 changes sound on purpose. `bun run verify` proves nothing broke and that the values differ; it cannot tell you a clap sounds like hands. **The listening checklist at the end of this plan (spec decision 42) is a human gate of equal weight and must be worked through before the slice is called done.**

**Measured corrections to the spec's own supporting numbers, recorded rather than smoothed over** (this repo's discipline; see the spec's Context section, which does the same):

1. **Decision 14 says "nine kits gain a kick click."** Measured, four of thirteen entries have one today (`909 Modern`, `Chrome Pulse`, `Warehouse`, `Acoustic Studio`), and decision 14's own family table then omits the click from the 808 and trap-808 kits. Applying the decision as written: **five named kits gain a click** (`Retro Drive`, `Velocity Breaks`, `Sub Weight`, `Tight Pocket`, `Lo-Fi Vinyl`), **three named kits deliberately stay clickless** (`Trap Beat`, `808 Vintage`, `Warm Riddim`), and **`DEFAULT_DRUM_KIT` stays clickless by construction** (the merge rule above). The end state is **nine of twelve named kits carrying a click** — which is the "nine" the decision was reaching for. The decision itself is unaffected.

2. **Decision 13 names two long kicks to pin to a note.** `drum-kit-identities.md` §2 also raises `808 Vintage`'s kick decay 0.45 → 0.70, which moves it into decision 13's own `decay > 0.5 s` band. **Three kicks are pinned, not two:** `Sub Weight` 36.71 Hz (D1), `Trap Beat` 41.20 Hz (E1), `808 Vintage` 49.00 Hz (G1). The third follows from decision 13's rule applied to a decay decision 13 did not know about.

3. **Two research documents disagree about `Retro Drive`'s tom, and decision 18 settles it against the louder claim.** `drum-kit-identities.md` §2 calls a `210 → 60 / pitchTime 0.28` Simmons sweep *"the single biggest win in the library"*; decision 18 binds every tom to `…kick-snare-clap-toms.md` §4.3's **`freqStart / freqEnd` ≈ 1.35**, which forbids a 3.5:1 sweep. **Decision 18 wins — it is the spec.** The Simmons tom is not authored in slice 1. This is on the listening checklist so the loss is heard and recorded, not discovered later.

4. **Two research documents disagree about `Tight Pocket`'s hat.** `drum-kit-identities.md` §2 wants `gain 0.40` — the loudest hat, because in funk the 16ths *are* the groove. `…hats-and-cymbals.md` §5.1 puts `Tight Pocket` in the "Lo-fi muffled" archetype at `3600 / 0.045 / 0.26`. **Decision 18 says "the five archetypes in §5.1's table are the assignment"**, so the archetype wins. Recorded, and on the listening checklist.

5. **The archetype table deliberately gives three kits the same hat.** After Task 4, `Chrome Pulse`, `Velocity Breaks` and `Warehouse` share `8800 / 0.022 / 0.34`; `Retro Drive` and `Acoustic Studio` share one; `808 Vintage` and `Warm Riddim` share one; `Tight Pocket` and `Lo-Fi Vinyl` share one. That is the honest ceiling `…hats-and-cymbals.md` §5.1 states — *"re-tuning buys about 2.5 distinguishable hat characters"* — and it is why the pairwise check in Task 6 is a **whole-kit** metric, not a per-voice one: two kits may share a hat if their kicks and snares diverge. Decision 26 (`topCut`, slice 3) is what actually separates hats.

---

## File Structure

| file | responsibility in this slice | tasks |
|---|---|---|
| `src/data/drumKits.ts` | the thirteen literal parameter tables — the only thing that changes in Tasks 1, 3, 4, 5 | 1, 2, 3, 4, 5 |
| `src/audio/drumKits.test.ts` | rule tests over **merged** kits (it already imports `mergeDrumKit` and `@/data/drumKits`, so it is the layer-legal home for anything asserting a rule about a merged entry) | 1, 3, 4, 5 |
| `src/audio/engine.ts` | one `shape` callback at the `clap` case (~line 1732) — three numbers, no new parameter | 2 |
| `src/audio/engine.test.ts` | the clap envelope shape test, plus a restatement of the existing floor test | 2 |
| `scripts/check-drum-kit-separation.ts` | five new spreads and a new pairwise nearest-neighbour check | 6 |

**Task order is load-bearing.** Task 6 tightens `check:drums` against values Tasks 1–5 have already widened; run before them, its new assertions fail on values nobody has fixed yet. Tasks 1–5 are otherwise independent and each passes the *existing* `check:drums` on its own.

---

### Task 1: Kick — collapse the pitch sweep, pin the long kicks, assign the clicks

Implements **spec decisions 13 and 14**.

**Files:**
- Modify: `src/data/drumKits.ts` — every `kick:` line (13 of them: `DEFAULT_DRUM_KIT` at :71, and the twelve named kits)
- Test: `src/audio/drumKits.test.ts`

**Interfaces:**
- Consumes: `mergeDrumKit(partial?: Partial<DrumKit>): DrumKit` from `src/audio/drumKits.ts`; `DEFAULT_DRUM_KIT: DrumKit` and `DRUM_KITS: Record<string, Partial<DrumKit>>` from `src/data/drumKits.ts`. `KickParams` is `{ freqStart: number; freqEnd: number; pitchTime: number; decay: number; gain: number; clickFreq?: number; clickLevel?: number; clickDecay?: number }`.
- Produces: the retuned `kick` block of all 13 entries, and three exported-by-test rules later tasks rely on holding: `kick.pitchTime <= 0.1 * kick.decay`; `kick.decay >= 0.5` implies `kick.freqEnd` is one of `36.71, 41.20, 43.65, 46.25, 49.00, 55.00, 65.41`; `DEFAULT_DRUM_KIT.kick` has no `clickFreq`, `clickLevel` or `clickDecay` key. Task 6 adds `kick.pitchTime` and `kick.clickLevel` to `check:drums`; the values this task authors are what let those spreads pass.

**The target table.** `freqStart`/`freqEnd`/`decay`/`gain` are `drum-kit-identities.md` §2's per-kit values. `pitchTime` is §5(a) A1's value, except where §2's decay makes A1's value break decision 13's `pitchTime ≤ 0.1 × decay` rule, in which case it is `0.1 × decay` rounded down to three decimal places (marked †). Clicks: kits that already had one keep §2's per-kit values; kits that gain one take §2's per-kit value where §2 supplies one, and decision 14's lo-fi family value `900 / 0.15 / 0.012` for `Lo-Fi Vinyl`, which §2 leaves clickless.

| entry | `freqStart` | `freqEnd` | `pitchTime` | `decay` | `gain` | `clickFreq` | `clickLevel` | `clickDecay` |
|---|---|---|---|---|---|---|---|---|
| `DEFAULT_DRUM_KIT` | 150 | 35 | 0.03 | 0.35 | 0.9 | — | — | — |
| Retro Drive | 140 | 55 | 0.018 | 0.22 | 0.85 | 1800 | 0.18 | 0.008 |
| 909 Modern | 175 | 48 | 0.03 | 0.3 | 0.95 | 1400 | 0.3 | 0.01 |
| Trap Beat | 110 | **41.2** | 0.06 | 0.9 | 1.0 | — | — | — |
| 808 Vintage | 90 | **49.0** | 0.04 | 0.7 | 0.9 | — | — | — |
| Chrome Pulse | 190 | 42 | 0.025 | 0.3 | 1.0 | 2400 | 0.4 | 0.012 |
| Velocity Breaks | 130 | 50 | **0.012** † | 0.12 | 0.95 | 2600 | 0.22 | 0.006 |
| Sub Weight | 100 | **36.71** | 0.02 | 0.5 | 1.0 | 1600 | 0.28 | 0.008 |
| Warehouse | 150 | 40 | 0.02 | 0.4 | 1.0 | 1100 | 0.35 | 0.008 |
| Tight Pocket | 120 | 58 | **0.013** † | 0.13 | 0.85 | 2200 | 0.25 | 0.006 |
| Acoustic Studio | 180 | 65 | 0.012 | 0.32 | 0.9 | 3000 | 0.28 | 0.008 |
| Warm Riddim | 100 | 52 | 0.025 | 0.28 | 0.85 | — | — | — |
| Lo-Fi Vinyl | 95 | 45 | 0.03 | 0.32 | 0.8 | 900 | 0.15 | 0.012 |

- [ ] **Step 1: Measure the state this task is fixing**

Run:

```bash
bun -e '
import { DEFAULT_DRUM_KIT, DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const all = [["DEFAULT", DEFAULT_DRUM_KIT], ...Object.entries(DRUM_KITS).map(([n, p]) => [n, mergeDrumKit(p)])];
for (const [n, k] of all) {
  console.log(n.padEnd(18), "pitchTime", k.kick.pitchTime, "decay", k.kick.decay,
    "ratio", (k.kick.pitchTime / k.kick.decay).toFixed(3),
    "click", k.kick.clickFreq ?? "none");
}
'
```

Expected: 13 rows; ten with `pitchTime > 0.05`, `Sub Weight` at ratio `0.583`, `Trap Beat` at `0.462`, and only four rows showing a click. Write the ten and the four down — they are the "before" side of the commit message.

- [ ] **Step 2: Write the failing test**

Append to `src/audio/drumKits.test.ts`:

```ts
/**
 * Slice 1, spec decisions 13 and 14. These are rules over MERGED entries,
 * not over the literals: mergeDrumKit spreads DEFAULT_DRUM_KIT under each
 * partial, so a kit that omits `kick.pitchTime` still has to satisfy them.
 */
describe('kick tuning rules', () => {
  const merged: [string, ReturnType<typeof mergeDrumKit>][] = [
    ['DEFAULT_DRUM_KIT', mergeDrumKit()],
    ...Object.entries(DRUM_KITS).map(
      ([name, partial]) => [name, mergeDrumKit(partial)] as [string, ReturnType<typeof mergeDrumKit>],
    ),
  ];

  test('the pitch sweep is over before a tenth of the note has passed', () => {
    // The TR-808's sweep is over in ~6 ms; the operational rule puts anything
    // above pitchTime / decay > 0.3 in the "smeared, usually a mistake" band.
    for (const [name, kit] of merged) {
      expect(kit.kick.pitchTime, `${name}.kick.pitchTime`).toBeLessThanOrEqual(0.1 * kit.kick.decay + 1e-12);
    }
  });

  test('a kick that rings longer than half a second ends on a note', () => {
    // A 600 ms tail has a pitch whether or not we chose one; choosing one is
    // how it stops fighting the bass.
    const NOTE_HZ = [36.71, 41.2, 43.65, 46.25, 49.0, 55.0, 65.41];
    for (const [name, kit] of merged) {
      if (kit.kick.decay < 0.5) continue;
      expect(NOTE_HZ, `${name}.kick.freqEnd`).toContain(kit.kick.freqEnd);
    }
  });

  test('the default kit has no click, so a kit can omit one', () => {
    // mergeDrumKit is a one-level spread: a kit cannot DELETE a key the
    // default defines. If the default clicks, the 808 kits cannot not-click.
    expect(DEFAULT_DRUM_KIT.kick.clickFreq).toBeUndefined();
    expect(DEFAULT_DRUM_KIT.kick.clickLevel).toBeUndefined();
    expect(DEFAULT_DRUM_KIT.kick.clickDecay).toBeUndefined();
  });

  test('exactly the three referent-clickless kits have no click', () => {
    // 808 and trap-808 kits omit it because the machine has no separate click
    // path; Warm Riddim because a felt-muffled reggae kick has no beater snap.
    const clickless = Object.entries(DRUM_KITS)
      .filter(([, p]) => p.kick?.clickFreq === undefined)
      .map(([n]) => n)
      .sort();
    expect(clickless).toEqual(['808 Vintage', 'Trap Beat', 'Warm Riddim']);
  });

  test('every kit that has a click has all three of its parameters', () => {
    for (const [name, partial] of Object.entries(DRUM_KITS)) {
      if (partial.kick?.clickFreq === undefined) continue;
      expect(partial.kick.clickLevel, `${name}.kick.clickLevel`).toBeGreaterThan(0);
      expect(partial.kick.clickDecay, `${name}.kick.clickDecay`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run the test and see it fail**

Run: `bun test src/audio/drumKits.test.ts -t "kick tuning rules"`
Expected: FAIL. `the pitch sweep is over before a tenth of the note has passed` fails first, on `DEFAULT_DRUM_KIT.kick.pitchTime`: `expected 0.12 to be less than or equal to 0.035`. `exactly the three referent-clickless kits have no click` fails with a nine-name array.

- [ ] **Step 4: Retune `DEFAULT_DRUM_KIT.kick`**

In `src/data/drumKits.ts`, replace the `kick:` line of `DEFAULT_DRUM_KIT` (currently line 71):

```ts
  kick: { freqStart: 150, freqEnd: 35, pitchTime: 0.03, decay: 0.35, gain: 0.9 },
```

Leave it clickless. That is deliberate, not an omission — see the test in Step 2.

- [ ] **Step 5: Retune the six kicks that gain or keep a click and need no note pinning**

In `src/data/drumKits.ts`, replace each named kit's `kick:` line:

```ts
    // 'Retro Drive'
    kick: { freqStart: 140, freqEnd: 55, pitchTime: 0.018, decay: 0.22, gain: 0.85, clickFreq: 1800, clickLevel: 0.18, clickDecay: 0.008 },
```

```ts
    // '909 Modern'
    kick: { freqStart: 175, freqEnd: 48, pitchTime: 0.03, decay: 0.3, gain: 0.95, clickFreq: 1400, clickLevel: 0.3, clickDecay: 0.01 },
```

```ts
    // 'Chrome Pulse'
    kick: { freqStart: 190, freqEnd: 42, pitchTime: 0.025, decay: 0.3, gain: 1.0, clickFreq: 2400, clickLevel: 0.4, clickDecay: 0.012 },
```

```ts
    // 'Velocity Breaks'
    kick: { freqStart: 130, freqEnd: 50, pitchTime: 0.012, decay: 0.12, gain: 0.95, clickFreq: 2600, clickLevel: 0.22, clickDecay: 0.006 },
```

```ts
    // 'Warehouse'
    kick: { freqStart: 150, freqEnd: 40, pitchTime: 0.02, decay: 0.4, gain: 1.0, clickFreq: 1100, clickLevel: 0.35, clickDecay: 0.008 },
```

```ts
    // 'Tight Pocket'
    kick: { freqStart: 120, freqEnd: 58, pitchTime: 0.013, decay: 0.13, gain: 0.85, clickFreq: 2200, clickLevel: 0.25, clickDecay: 0.006 },
```

- [ ] **Step 6: Retune the remaining six kicks, including the three note pins and the three clickless kits**

```ts
    // 'Trap Beat' — freqEnd is E1. A trap 808 is a sustained note, not a slide.
    kick: { freqStart: 110, freqEnd: 41.2, pitchTime: 0.06, decay: 0.9, gain: 1.0 },
```

```ts
    // '808 Vintage' — freqEnd is G1. The bridged-T rings itself down; the
    // circuit has no pitch envelope, so the pitch move is small. No click:
    // the 808 has no separate click path.
    kick: { freqStart: 90, freqEnd: 49.0, pitchTime: 0.04, decay: 0.7, gain: 0.9 },
```

```ts
    // 'Sub Weight' — freqEnd is D1. Was 0.35 s of glide under a 0.60 s decay.
    kick: { freqStart: 100, freqEnd: 36.71, pitchTime: 0.02, decay: 0.5, gain: 1.0, clickFreq: 1600, clickLevel: 0.28, clickDecay: 0.008 },
```

```ts
    // 'Acoustic Studio'
    kick: { freqStart: 180, freqEnd: 65, pitchTime: 0.012, decay: 0.32, gain: 0.9, clickFreq: 3000, clickLevel: 0.28, clickDecay: 0.008 },
```

```ts
    // 'Warm Riddim' — no click: a felt-muffled reggae kick has no beater snap,
    // and being one of the few clickless kits is itself separation.
    kick: { freqStart: 100, freqEnd: 52, pitchTime: 0.025, decay: 0.28, gain: 0.85 },
```

```ts
    // 'Lo-Fi Vinyl' — the lo-fi click family: a dulled tape/vinyl attack.
    kick: { freqStart: 95, freqEnd: 45, pitchTime: 0.03, decay: 0.32, gain: 0.8, clickFreq: 900, clickLevel: 0.15, clickDecay: 0.012 },
```

- [ ] **Step 7: Run the test and see it pass**

Run: `bun test src/audio/drumKits.test.ts -t "kick tuning rules"`
Expected: PASS, 5 tests.

- [ ] **Step 8: Measure the result**

Run:

```bash
bun -e '
import { DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const kits = Object.values(DRUM_KITS).map(mergeDrumKit);
const pt = kits.map(k => k.kick.pitchTime);
const fe = kits.map(k => k.kick.freqEnd);
const cl = kits.map(k => k.kick.clickLevel).filter(x => x !== undefined);
console.log("pitchTime", Math.min(...pt), "-", Math.max(...pt), "ratio", (Math.max(...pt) / Math.min(...pt)).toFixed(3));
console.log("freqEnd  ", Math.min(...fe), "-", Math.max(...fe), "ratio", (Math.max(...fe) / Math.min(...fe)).toFixed(3));
console.log("clicks defined on", cl.length, "of 12 kits; level", Math.min(...cl), "-", Math.max(...cl), "ratio", (Math.max(...cl) / Math.min(...cl)).toFixed(3));
'
```

Expected exactly: `pitchTime 0.012 - 0.06 ratio 5.000`, `freqEnd 36.71 - 65 ratio 1.771`, `clicks defined on 9 of 12 kits; level 0.15 - 0.4 ratio 2.667`. If any figure differs, a value was mistyped — fix it before continuing.

- [ ] **Step 9: Run the gate**

Run: `bun run verify`
Expected: all green, eslint zero errors. `check:drums` still prints `PASS kick.freqEnd spread` (now `max=65, min=36.71`) and `PASS kick.decay spread` (now `max=0.9, min=0.12`).

- [ ] **Step 10: Commit**

```bash
git add src/data/drumKits.ts src/audio/drumKits.test.ts
git commit -m "$(cat <<'EOF'
feat(drums): collapse the kick pitch sweep and assign the clicks

Ten of thirteen entries swept longer than 50 ms; Sub Weight glided for 58%
of its note and Trap Beat for 46%, where the TR-808's own sweep is over in
~6 ms. Every entry now satisfies pitchTime <= 0.1 * decay.

Three kicks whose decay exceeds 0.5 s are pinned to a note rather than a
round number: Sub Weight 36.71 (D1), Trap Beat 41.20 (E1), 808 Vintage
49.00 (G1). A kick that rings for 600 ms has a pitch whether or not we
chose one.

Five kits gain a click and nine now carry one. Trap Beat, 808 Vintage and
Warm Riddim stay clickless by referent, and DEFAULT_DRUM_KIT stays
clickless by construction: mergeDrumKit is a one-level spread, so a kit
cannot delete a key the default defines.

Spec decisions 13 and 14.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 2: Clap — three decaying bursts, and the bandpass down toward 1 kHz

Implements **spec decision 15**. This is the task the controller ruling in Global Constraints exists for: it changes three numbers inside a `shape` callback in `src/audio/engine.ts`, adds no parameter and no signal path, and is therefore in slice 1.

**Files:**
- Modify: `src/audio/engine.ts` — the `case 'clap':` block, currently at lines 1725–1740
- Modify: `src/data/drumKits.ts` — the `clap:` line of four named kits
- Test: `src/audio/engine.test.ts` — one new test, and one existing test restated

**Interfaces:**
- Consumes: `ENV_FLOOR` (already imported at `src/audio/engine.ts:10` from `./constants`; value `0.0001`); `private drumEnv(peak: number, decay: number, t: number, shape?: (gain: AudioParam) => void): GainNode`, which calls `shape?.(gain.gain)` **between** its opening `setValueAtTime(Math.max(ENV_FLOOR, peak), t)` and its closing `exponentialRampToValueAtTime(ENV_FLOOR, t + Math.max(0.01, decay))`; `ClapParams` is `{ filter: number; decay: number; gain: number; reverbSend: number }`. From the test fakes: `fakeParam().events` is `{ kind: 'set' | 'exp' | 'target'; v: number; t: number }[]` in call order, and `fakeParam().ramps` is `{ v: number; t: number }[]` recording only exponential ramps.
- Produces: a clap envelope whose scheduled amplitudes are monotonically non-increasing and whose bursts decay rather than plateau. **No new field on `ClapParams`.** Later tasks and slices read nothing from this.

**The replacement schedule** (`…kick-snare-clap-toms.md` §3.4), scheduled relative to `now`:

```
t + 0.000  setValueAtTime(peak)                     <- drumEnv already does this
t + 0.008  exponentialRampToValueAtTime(peak*0.05)  burst 1 decays
t + 0.010  setValueAtTime(peak * 0.85)              burst 2
t + 0.018  exponentialRampToValueAtTime(peak*0.05)
t + 0.020  setValueAtTime(peak * 0.70)              burst 3
t + 0.028  exponentialRampToValueAtTime(peak*0.05)
t + 0.030  setValueAtTime(peak * 0.55)              tail starts
           <- drumEnv's closing exponentialRampToValueAtTime(ENV_FLOOR, t + decay)
```

The 2 ms windows between a completed ramp and the next `setValueAtTime` are the inter-burst silence — that is what makes them read as separate hands rather than as chopped noise.

**The four filter corrections** (`…kick-snare-clap-toms.md` §5(a) A5; the 808/909 clap bandpass is ~1000 Hz and these four sit well above it):

| kit | `clap.filter` before | after |
|---|---|---|
| Acoustic Studio | 2800 | **1400** (a real clap, not the machine — keep it brighter) |
| Chrome Pulse | 1800 | **1300** |
| 909 Modern | 1600 | **1100** |
| Warehouse | 1600 | **1200** |

- [ ] **Step 1: Measure the shape this task is fixing**

Run:

```bash
bun -e '
import { DRUM_KITS } from "./src/data/drumKits.ts";
for (const [n, k] of Object.entries(DRUM_KITS)) console.log(n.padEnd(18), "clap.filter", k.clap.filter);
'
```

Then read `src/audio/engine.ts` lines 1725–1740 and confirm the schedule is `setValueAtTime(peak * 0.25, now + 0.012)` then `setValueAtTime(peak * 1.1, now + 0.024)` — three plateaus at `1.0`, `0.25`, `1.1`, so **the loudest event is last**.

- [ ] **Step 2: Write the failing test**

Add to `src/audio/engine.test.ts`, inside the existing `describe('drum voice details', …)` block:

```ts
  test('the clap is three decaying bursts, not three rising plateaus', () => {
    const { engine, ctx } = freshEngine();
    const gain = (engine as any).drumKit.clap.gain;
    const before = ctx._gains.length;

    engine.triggerDrum('clap', 1.0);

    const evs = ctx._gains[before].gain.events as { kind: string; v: number; t: number }[];
    const t0 = evs[0].t;

    // A real clap is several hands landing within ~30 ms, and the hands do
    // not get louder. The old schedule ended on peak * 1.1.
    const strikes = evs.filter((e) => e.kind === 'set');
    expect(strikes.map((e) => Number((e.v / gain).toFixed(2)))).toEqual([1.0, 0.85, 0.7, 0.55]);
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i].v, `strike ${i}`).toBeLessThan(strikes[i - 1].v);
    }

    // Each burst DECAYS: every strike is followed by a ramp downward before
    // the next strike, with a gap. A plateau on noise is a gate, and reads as
    // "noise chopped", not as hands.
    const burstRamps = evs.filter((e) => e.kind === 'exp' && e.v > 0.0001);
    expect(burstRamps).toHaveLength(3);
    for (const r of burstRamps) expect(r.v).toBeCloseTo(gain * 0.05, 9);
    expect(burstRamps.map((e) => Number((e.t - t0).toFixed(3)))).toEqual([0.008, 0.018, 0.028]);
    expect(strikes.map((e) => Number((e.t - t0).toFixed(3)))).toEqual([0, 0.01, 0.02, 0.03]);
  });
```

- [ ] **Step 3: Run the test and see it fail**

Run: `bun test src/audio/engine.test.ts -t "three decaying bursts"`
Expected: FAIL on the first assertion — `expected [1, 0.25, 1.1] to equal [1, 0.85, 0.7, 0.55]`.

- [ ] **Step 4: Rewrite the clap's `shape` callback**

In `src/audio/engine.ts`, replace the whole `case 'clap':` block:

```ts
      case 'clap': {
        const c = k.clap;
        const peak = v * c.gain;
        // Three DECAYING bursts plus a distinct tail, ~10 ms apart. The old
        // schedule was three plateaus at 1.0, 0.25 and 1.1 - setValueAtTime
        // HOLDS a value, so it was a chopped-noise gate whose loudest event
        // was its last. A real clap's hands do not get louder.
        // The 2 ms window between a completed ramp and the next strike is the
        // inter-burst silence; that is what makes them read as separate hands.
        const floor = Math.max(ENV_FLOOR, peak * 0.05);
        this.drumNoiseBurst({
          filterType: 'bandpass', freq: c.filter, q: 1.5, peak, decay: c.decay,
          t: now, stopPad: 0.02, reverbSend: c.reverbSend,
          shape: (gain) => {
            gain.exponentialRampToValueAtTime(floor, now + 0.008);
            gain.setValueAtTime(peak * 0.85, now + 0.01);
            gain.exponentialRampToValueAtTime(floor, now + 0.018);
            gain.setValueAtTime(peak * 0.7, now + 0.02);
            gain.exponentialRampToValueAtTime(floor, now + 0.028);
            gain.setValueAtTime(peak * 0.55, now + 0.03);
          },
        });
        break;
      }
```

`Math.max(ENV_FLOOR, …)` is not decoration: `exponentialRampToValueAtTime` throws on a target of 0, and `triggerDrum` clamps velocity to a range that includes 0.

- [ ] **Step 5: Run the test and see it pass, and see one neighbour go red**

Run: `bun test src/audio/engine.test.ts`
Expected: `three decaying bursts` PASSES. **`every drum envelope floors at the same 0.0001` now FAILS** — `expected 0.025 to be 0.0001` — because it asserts *every* ramp on every drum envelope lands on the floor, and the clap's three inter-burst ramps deliberately do not. This is the test pinning the old shape, exactly as spec decision 39 predicts.

- [ ] **Step 6: Restate the floor test to assert where the envelope ends**

In `src/audio/engine.test.ts`, replace the body of `test('every drum envelope floors at the same 0.0001', …)`:

```ts
  test('every drum envelope floors at the same 0.0001', () => {
    const { engine, ctx } = freshEngine();
    for (const type of ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash']) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      for (const g of ctx._gains.slice(before)) {
        // The clap's inter-burst ramps land above the floor on purpose: each
        // burst decays and the next hand re-strikes. What must be identical
        // across every voice is where the envelope ENDS. Send gains have no
        // ramps at all.
        if (g.gain.ramps.length === 0) continue;
        expect(g.gain.ramps.at(-1)!.v).toBe(0.0001);
      }
    }
  });
```

- [ ] **Step 7: Run the engine suite and see it pass**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS, whole file. In particular `the clap ghost burst scales with velocity` still passes: every scheduled level is a multiple of `peak`, so it still halves when velocity does.

- [ ] **Step 8: Bring the four clap filters toward 1 kHz**

In `src/data/drumKits.ts`, replace the `clap:` line of four kits:

```ts
    // '909 Modern' — the 808/909 clap bandpass is ~1000 Hz.
    clap: { filter: 1100, decay: 0.26, gain: 0.62, reverbSend: 0.3 },
```

```ts
    // 'Chrome Pulse'
    clap: { filter: 1300, decay: 0.3, gain: 0.62, reverbSend: 0.5 },
```

```ts
    // 'Warehouse' — "overdriven claps" read partly as loud.
    clap: { filter: 1200, decay: 0.3, gain: 0.7, reverbSend: 0.35 },
```

```ts
    // 'Acoustic Studio' — a hand clap, not a stick; brighter than the machine.
    clap: { filter: 1400, decay: 0.32, gain: 0.55, reverbSend: 0.4 },
```

Then bring the remaining eight kits onto `drum-kit-identities.md` §2's per-kit clap values:

```ts
    // 'Retro Drive'
    clap: { filter: 1400, decay: 0.3, gain: 0.65, reverbSend: 0.45 },
```

```ts
    // 'Trap Beat' — drier.
    clap: { filter: 1900, decay: 0.2, gain: 0.55, reverbSend: 0.12 },
```

```ts
    // '808 Vintage'
    clap: { filter: 1050, decay: 0.28, gain: 0.6, reverbSend: 0.25 },
```

```ts
    // 'Velocity Breaks'
    clap: { filter: 1600, decay: 0.13, gain: 0.45, reverbSend: 0.15 },
```

```ts
    // 'Sub Weight'
    clap: { filter: 1500, decay: 0.32, gain: 0.6, reverbSend: 0.4 },
```

```ts
    // 'Tight Pocket' — drier.
    clap: { filter: 1300, decay: 0.16, gain: 0.5, reverbSend: 0.12 },
```

```ts
    // 'Warm Riddim' — the wettest clap in the library, per dub's spring reverb.
    clap: { filter: 1000, decay: 0.3, gain: 0.45, reverbSend: 0.5 },
```

```ts
    // 'Lo-Fi Vinyl'
    clap: { filter: 950, decay: 0.24, gain: 0.42, reverbSend: 0.22 },
```

`DEFAULT_DRUM_KIT.clap` is unchanged at `{ filter: 1200, decay: 0.2, gain: 0.5, reverbSend: 0.3 }`.

- [ ] **Step 9: Measure the result**

Run:

```bash
bun -e '
import { DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const f = Object.values(DRUM_KITS).map(p => mergeDrumKit(p).clap.filter);
console.log("clap.filter", Math.min(...f), "-", Math.max(...f), "ratio", (Math.max(...f) / Math.min(...f)).toFixed(3));
'
```

Expected exactly: `clap.filter 950 - 1900 ratio 2.000`. `check:drums` requires 1.8.

- [ ] **Step 10: Run the gate**

Run: `bun run verify`
Expected: all green, eslint zero errors.

- [ ] **Step 11: Commit**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts src/data/drumKits.ts
git commit -m "$(cat <<'EOF'
fix(audio): make the clap three decaying bursts instead of three plateaus

setValueAtTime HOLDS a value, so the old schedule - peak, 0.25*peak,
1.1*peak - was three plateaus whose LOUDEST event was its last. That is a
chopped-noise gate, not a clap. It is now three bursts that each decay to
5% before the next hand strikes, at 0/10/20 ms, followed by a distinct
tail at 30 ms, per the 808/909 schedule.

No new parameter: drumEnv calls shape(gain.gain) before appending its
closing ramp, so the whole corrected envelope schedules through the
existing hook.

The clap bandpass follows the shape down toward the machines' ~1000 Hz on
the four kits that sat well above it (Acoustic Studio 2800 -> 1400,
Chrome Pulse 1800 -> 1300, 909 Modern 1600 -> 1100, Warehouse
1600 -> 1200), and the other eight take their per-kit values.

`every drum envelope floors at the same 0.0001` asserted that every ramp
lands on the floor; the clap's inter-burst ramps deliberately do not, so
it now asserts where each envelope ENDS.

Spec decision 15, under the controller ruling that slice 1 is "tuning
only - no new capability", which permits numbers in an engine literal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 3: Snare — stop the body glide, and make `noise:body` the genre axis

Implements **spec decisions 16 and 17**.

**Files:**
- Modify: `src/data/drumKits.ts` — every `snare:` line (13 of them)
- Test: `src/audio/drumKits.test.ts`

**Interfaces:**
- Consumes: `mergeDrumKit(partial?: Partial<DrumKit>): DrumKit`; `DEFAULT_DRUM_KIT`, `DRUM_KITS`. `SnareParams` is `{ bodyFreqStart: number; bodyFreqEnd: number; bodyTime: number; bodyDecay: number; bodyGain: number; noiseFilter: number; noiseDecay: number; noiseGain: number; reverbSend: number }`.
- Produces: the retuned `snare` block of all 13 entries, satisfying `bodyTime` in `0.010..0.030`, `bodyFreqEnd >= 0.85 * bodyFreqStart`, and `noiseGain / bodyGain` in `0.70..2.84`. Task 6 adds `snare.bodyTime` to `check:drums`; the 3.0× spread this task authors is what lets it pass.

**Where the numbers come from.** `drum-kit-identities.md` §2's per-kit snare, with three corrections applied in this order:

1. `bodyTime` — §2's value clamped into decision 16's `0.010–0.030`, using `…kick-snare-clap-toms.md` §2.3's family value for the kit's family. It is a copy-pasted `0.08` in **all thirteen** entries today and has never been tuned.
2. `bodyFreqEnd` — `max(§2's value, round(0.86 × bodyFreqStart))`, which enforces decision 16's `bodyFreqEnd ≥ 0.85 × bodyFreqStart` deterministically. A snare's tonal component is the head's (0,1) mode: fixed partials that barely bend.
3. `noiseGain` — adjusted so `noiseGain / bodyGain` lands on §2.3's family ratio where the kit has a family: trap ≈ 2.83, gated 80s ≈ 1.36, 909 ≈ 1.56, acoustic and 808 ≈ 0.90, lo-fi ≈ 0.70. **Genre lives in the gain ratio, not in the frequency**, which is why moving `bodyFreqStart` around has bought so little separation. Measured span today: **0.87–2.00**.

One value is not from §2: `Chrome Pulse.snare.noiseFilter` is **3200**, not §2's 3000. `check:drums` asserts `snare.noiseFilter` spreads 2.8×, and §2's own change of `Lo-Fi Vinyl` 700 → 1100 raises the floor enough that 3000 gives only 2.727× and the gate goes red. `Chrome Pulse` owns the bright extreme by design (it is the authored kit whose whole job is the hardest, brightest corner), so it is the right place to take the 200 Hz. 3200/1100 = 2.909×.

| entry | `bodyFreqStart` | `bodyFreqEnd` | `bodyTime` | `bodyDecay` | `bodyGain` | `noiseFilter` | `noiseDecay` | `noiseGain` | ratio | `reverbSend` |
|---|---|---|---|---|---|---|---|---|---|---|
| `DEFAULT_DRUM_KIT` | 220 | **195** | **0.02** | 0.15 | 0.5 | 1000 | 0.22 | 0.6 | 1.20 | 0.3 |
| Retro Drive | 230 | 198 | 0.02 | 0.14 | 0.55 | 1500 | 0.13 | 0.75 | 1.36 | 0.5 |
| 909 Modern | 240 | 206 | 0.02 | 0.11 | 0.45 | 2000 | 0.17 | 0.7 | 1.56 | 0.25 |
| Trap Beat | 320 | 275 | 0.02 | 0.07 | 0.3 | 2600 | 0.14 | 0.85 | 2.83 | 0.1 |
| 808 Vintage | 190 | 165 | 0.03 | 0.16 | 0.45 | 1500 | 0.14 | 0.4 | 0.89 | 0.2 |
| Chrome Pulse | 300 | 258 | 0.02 | 0.09 | 0.4 | **3200** | 0.3 | 0.8 | 2.00 | 0.5 |
| Velocity Breaks | 280 | 241 | 0.02 | 0.06 | 0.45 | 2200 | 0.13 | 0.78 | 1.73 | 0.18 |
| Sub Weight | 210 | 181 | 0.03 | 0.16 | 0.55 | 1600 | 0.3 | 0.8 | 1.45 | 0.45 |
| Warehouse | 220 | 189 | 0.03 | 0.1 | 0.4 | 1800 | 0.14 | 0.62 | 1.55 | 0.4 |
| Tight Pocket | 260 | 224 | 0.03 | 0.08 | 0.5 | 1900 | 0.11 | 0.62 | 1.24 | 0.12 |
| Acoustic Studio | 240 | 206 | 0.03 | 0.2 | 0.55 | 1400 | 0.26 | 0.5 | 0.91 | 0.35 |
| Warm Riddim | 900 | 800 | 0.01 | 0.09 | 0.6 | 2400 | 0.08 | 0.42 | 0.70 | 0.45 |
| Lo-Fi Vinyl | 175 | 151 | 0.03 | 0.15 | 0.42 | 1100 | 0.16 | 0.3 | 0.71 | 0.28 |

- [ ] **Step 1: Measure the state this task is fixing**

Run:

```bash
bun -e '
import { DEFAULT_DRUM_KIT, DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const all = [["DEFAULT", DEFAULT_DRUM_KIT], ...Object.entries(DRUM_KITS).map(([n, p]) => [n, mergeDrumKit(p)])];
const r = all.map(([n, k]) => k.snare.noiseGain / k.snare.bodyGain);
console.log("bodyTime values:", [...new Set(all.map(([, k]) => k.snare.bodyTime))]);
console.log("noise:body", Math.min(...r).toFixed(2), "-", Math.max(...r).toFixed(2));
for (const [n, k] of all) console.log(n.padEnd(18), k.snare.bodyFreqStart, "->", k.snare.bodyFreqEnd, "ratio", (k.snare.bodyFreqEnd / k.snare.bodyFreqStart).toFixed(3));
'
```

Expected: `bodyTime values: [ 0.08 ]` — one value, all thirteen. `noise:body 0.87 - 2.00`. `DEFAULT` at `220 -> 90 ratio 0.409`, a 2.4:1 downward glide, which is tom behaviour on a snare.

- [ ] **Step 2: Write the failing test**

Append to `src/audio/drumKits.test.ts`:

```ts
describe('snare tuning rules', () => {
  const merged: [string, ReturnType<typeof mergeDrumKit>][] = [
    ['DEFAULT_DRUM_KIT', mergeDrumKit()],
    ...Object.entries(DRUM_KITS).map(
      ([name, partial]) => [name, mergeDrumKit(partial)] as [string, ReturnType<typeof mergeDrumKit>],
    ),
  ];

  test('the body pitch settles inside 30 ms', () => {
    // bodyTime was a copy-pasted 0.08 in all thirteen entries and nothing
    // checked it.
    for (const [name, kit] of merged) {
      expect(kit.snare.bodyTime, `${name}.snare.bodyTime`).toBeGreaterThanOrEqual(0.01);
      expect(kit.snare.bodyTime, `${name}.snare.bodyTime`).toBeLessThanOrEqual(0.03);
    }
  });

  test('the body barely bends', () => {
    // A snare's tonal component is the head's (0,1) mode - fixed partials.
    // DEFAULT swept 220 -> 90 over 80 ms, which is a tom.
    for (const [name, kit] of merged) {
      expect(kit.snare.bodyFreqEnd, `${name}.snare.bodyFreqEnd`).toBeGreaterThanOrEqual(
        0.85 * kit.snare.bodyFreqStart,
      );
    }
  });

  test('noise:body is the genre axis and spans 0.7 to 2.8', () => {
    // Trap ~2.8, gated 80s ~1.4, acoustic and 808 ~0.9, lo-fi ~0.7. Genre
    // lives in the gain ratio, not in the frequency. Measured span before
    // this task: 0.87 - 2.00.
    const ratios = merged.map(([name, kit]) => [name, kit.snare.noiseGain / kit.snare.bodyGain] as const);
    for (const [name, r] of ratios) {
      expect(r, `${name} noise:body`).toBeGreaterThanOrEqual(0.7);
      expect(r, `${name} noise:body`).toBeLessThanOrEqual(2.84);
    }
    const values = ratios.map(([, r]) => r);
    expect(Math.max(...values) / Math.min(...values)).toBeGreaterThanOrEqual(3.5);
  });
});
```

- [ ] **Step 3: Run the test and see it fail**

Run: `bun test src/audio/drumKits.test.ts -t "snare tuning rules"`
Expected: FAIL, all three. `the body pitch settles inside 30 ms` reports `DEFAULT_DRUM_KIT.snare.bodyTime: expected 0.08 to be less than or equal to 0.03`; `the body barely bends` reports `DEFAULT_DRUM_KIT.snare.bodyFreqEnd: expected 90 to be greater than or equal to 187`; the ratio test fails on the 3.5× spread (today's is 2.30×).

- [ ] **Step 4: Retune `DEFAULT_DRUM_KIT.snare` and the four brightest-bodied kits**

In `src/data/drumKits.ts`:

```ts
  // DEFAULT_DRUM_KIT
  snare: { bodyFreqStart: 220, bodyFreqEnd: 195, bodyTime: 0.02, bodyDecay: 0.15, bodyGain: 0.5, noiseFilter: 1000, noiseDecay: 0.22, noiseGain: 0.6, reverbSend: 0.3 },
```

```ts
    // 'Trap Beat' - thin bright snare, driest-but-one; noise:body 2.83.
    snare: { bodyFreqStart: 320, bodyFreqEnd: 275, bodyTime: 0.02, bodyDecay: 0.07, bodyGain: 0.3, noiseFilter: 2600, noiseDecay: 0.14, noiseGain: 0.85, reverbSend: 0.1 },
```

```ts
    // 'Chrome Pulse' - brightest snare noise, wettest. noiseFilter is 3200
    // rather than 3000 so snare.noiseFilter still spreads 2.8x once Lo-Fi
    // Vinyl's floor rises 700 -> 1100.
    snare: { bodyFreqStart: 300, bodyFreqEnd: 258, bodyTime: 0.02, bodyDecay: 0.09, bodyGain: 0.4, noiseFilter: 3200, noiseDecay: 0.3, noiseGain: 0.8, reverbSend: 0.5 },
```

```ts
    // 'Velocity Breaks' - the crack: shortest body, loud noise.
    snare: { bodyFreqStart: 280, bodyFreqEnd: 241, bodyTime: 0.02, bodyDecay: 0.06, bodyGain: 0.45, noiseFilter: 2200, noiseDecay: 0.13, noiseGain: 0.78, reverbSend: 0.18 },
```

```ts
    // 'Warm Riddim' - the one drop's beat-3 voice is a cross-stick: a high,
    // short, wooden tock. No other kit has a snare body above 320 Hz.
    snare: { bodyFreqStart: 900, bodyFreqEnd: 800, bodyTime: 0.01, bodyDecay: 0.09, bodyGain: 0.6, noiseFilter: 2400, noiseDecay: 0.08, noiseGain: 0.42, reverbSend: 0.45 },
```

- [ ] **Step 5: Retune the remaining seven snares**

```ts
    // 'Retro Drive' - highest send in the library; short body + max send is
    // the closest reachable read of a gate. noise:body 1.36.
    snare: { bodyFreqStart: 230, bodyFreqEnd: 198, bodyTime: 0.02, bodyDecay: 0.14, bodyGain: 0.55, noiseFilter: 1500, noiseDecay: 0.13, noiseGain: 0.75, reverbSend: 0.5 },
```

```ts
    // '909 Modern' - noise-forward, per "snappy". noise:body 1.56.
    snare: { bodyFreqStart: 240, bodyFreqEnd: 206, bodyTime: 0.02, bodyDecay: 0.11, bodyGain: 0.45, noiseFilter: 2000, noiseDecay: 0.17, noiseGain: 0.7, reverbSend: 0.25 },
```

```ts
    // '808 Vintage' - at 900 Hz the highpass left low-mid mud; the 808 snare's
    // noise is a hiss over two tuned tones. noise:body 0.89.
    snare: { bodyFreqStart: 190, bodyFreqEnd: 165, bodyTime: 0.03, bodyDecay: 0.16, bodyGain: 0.45, noiseFilter: 1500, noiseDecay: 0.14, noiseGain: 0.4, reverbSend: 0.2 },
```

```ts
    // 'Sub Weight' - a big snare peaks between 150 and 200 Hz.
    snare: { bodyFreqStart: 210, bodyFreqEnd: 181, bodyTime: 0.03, bodyDecay: 0.16, bodyGain: 0.55, noiseFilter: 1600, noiseDecay: 0.3, noiseGain: 0.8, reverbSend: 0.45 },
```

```ts
    // 'Warehouse'
    snare: { bodyFreqStart: 220, bodyFreqEnd: 189, bodyTime: 0.03, bodyDecay: 0.1, bodyGain: 0.4, noiseFilter: 1800, noiseDecay: 0.14, noiseGain: 0.62, reverbSend: 0.4 },
```

```ts
    // 'Tight Pocket' - driest snare in the library: 1969 King Studios, no
    // gates, no reverb ornament.
    snare: { bodyFreqStart: 260, bodyFreqEnd: 224, bodyTime: 0.03, bodyDecay: 0.08, bodyGain: 0.5, noiseFilter: 1900, noiseDecay: 0.11, noiseGain: 0.62, reverbSend: 0.12 },
```

```ts
    // 'Acoustic Studio' - deep acoustic, noise:body 0.91.
    snare: { bodyFreqStart: 240, bodyFreqEnd: 206, bodyTime: 0.03, bodyDecay: 0.2, bodyGain: 0.55, noiseFilter: 1400, noiseDecay: 0.26, noiseGain: 0.5, reverbSend: 0.35 },
```

```ts
    // 'Lo-Fi Vinyl' - the darkest and least noisy snare. noise:body 0.71.
    snare: { bodyFreqStart: 175, bodyFreqEnd: 151, bodyTime: 0.03, bodyDecay: 0.15, bodyGain: 0.42, noiseFilter: 1100, noiseDecay: 0.16, noiseGain: 0.3, reverbSend: 0.28 },
```

- [ ] **Step 6: Run the test and see it pass**

Run: `bun test src/audio/drumKits.test.ts -t "snare tuning rules"`
Expected: PASS, 3 tests.

- [ ] **Step 7: Measure the result**

Run:

```bash
bun -e '
import { DEFAULT_DRUM_KIT, DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const all = [["DEFAULT", DEFAULT_DRUM_KIT], ...Object.entries(DRUM_KITS).map(([n, p]) => [n, mergeDrumKit(p)])];
const r = all.map(([, k]) => k.snare.noiseGain / k.snare.bodyGain);
const kits = Object.values(DRUM_KITS).map(mergeDrumKit);
const nf = kits.map(k => k.snare.noiseFilter);
const bt = kits.map(k => k.snare.bodyTime);
console.log("noise:body", Math.min(...r).toFixed(2), "-", Math.max(...r).toFixed(2), "ratio", (Math.max(...r) / Math.min(...r)).toFixed(3));
console.log("noiseFilter", Math.min(...nf), "-", Math.max(...nf), "ratio", (Math.max(...nf) / Math.min(...nf)).toFixed(3));
console.log("bodyTime", Math.min(...bt), "-", Math.max(...bt), "ratio", (Math.max(...bt) / Math.min(...bt)).toFixed(3));
'
```

Expected exactly: `noise:body 0.70 - 2.83 ratio 4.048`, `noiseFilter 1100 - 3200 ratio 2.909`, `bodyTime 0.01 - 0.03 ratio 3.000`. The `noiseFilter` figure must stay at or above `check:drums`'s required 2.8.

- [ ] **Step 8: Run the gate**

Run: `bun run verify`
Expected: all green, eslint zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/data/drumKits.ts src/audio/drumKits.test.ts
git commit -m "$(cat <<'EOF'
feat(drums): stop the snare body glide and make noise:body the genre axis

bodyTime was a copy-pasted 0.08 in all thirteen entries and check:drums
never looked at it; it is now 0.010-0.030 per kit. Every body now
satisfies bodyFreqEnd >= 0.85 * bodyFreqStart - DEFAULT swept 220 -> 90
over 80 ms, which is tom behaviour on a snare.

Genre moves into the gain ratio, where it lives, rather than into the
frequency, where moving it has bought almost nothing: noiseGain/bodyGain
now spans 0.70 (Warm Riddim, a cross-stick) to 2.83 (Trap Beat) against a
measured 0.87-2.00 before.

Chrome Pulse's noiseFilter is 3200 rather than the researched 3000: Lo-Fi
Vinyl's floor rises 700 -> 1100, and check:drums requires a 2.8x spread on
that parameter. Chrome Pulse owns the bright extreme by design.

Spec decisions 16 and 17.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 4: Hats — five archetypes and a decay range four times as wide

Implements the hat half of **spec decision 18**.

**Files:**
- Modify: `src/data/drumKits.ts` — every `hihat:` and `openhat:` line (26 in total)
- Test: `src/audio/drumKits.test.ts`

**Interfaces:**
- Consumes: `mergeDrumKit(partial?: Partial<DrumKit>): DrumKit`; `DEFAULT_DRUM_KIT`, `DRUM_KITS`. `HatParams` is `{ filter: number; decay: number; gain: number }` and is the type of both `hihat` and `openhat`.
- Produces: the retuned `hihat` and `openhat` blocks of all 13 entries. Task 6 adds `hihat.decay` (3.0×) and `hihat.gain` (1.5×) to `check:drums`; the values this task authors are what let those pass.

**Read the ceiling before spending effort here.** `…hats-and-cymbals.md` §5.1: *"re-tuning buys about 2.5 distinguishable hat characters and cannot buy genre identity."* With one **highpass** over white noise, raising the cutoff makes the hat thinner *and* quieter — the two are not separable — and no setting of three numbers makes noise beat or makes the spectrum move during the decay. What **is** free is the decay range: all 13 closed hats live in `0.030–0.060 s` today, and the 808's own closed hat is `0.050 s` while loose acoustic hats ring far longer. Widening to `0.020–0.110 s` is the single largest free win on the busiest row in the library.

**The five archetypes** (`…hats-and-cymbals.md` §5.1's table, which decision 18 names as the assignment). Three named kits are not in that table; they take `drum-kit-identities.md` §2's per-kit values, marked ‡.

| archetype | kits | `hihat` f / d / g | `openhat` f / d / g |
|---|---|---|---|
| Tight machine | Warehouse, Velocity Breaks, Chrome Pulse | 8800 / 0.022 / 0.34 | 7200 / 0.16 / 0.38 |
| 808 dark | 808 Vintage, Warm Riddim | 5200 / 0.05 / 0.34 | 4400 / 0.42 / 0.38 |
| Trap | Trap Beat | 9000 / 0.028 / 0.32 | 7600 / 0.22 / 0.36 |
| Loose acoustic | Acoustic Studio, Retro Drive | 6400 / 0.085 / 0.36 | 5400 / 0.5 / 0.42 |
| Lo-fi muffled | Tight Pocket, Lo-Fi Vinyl | 3600 / 0.045 / 0.26 | 3200 / 0.3 / 0.28 |
| ‡ per-kit | 909 Modern | 8500 / 0.045 / 0.42 | 7200 / 0.35 / 0.45 |
| ‡ per-kit | Sub Weight | 7200 / 0.035 / 0.3 | 6200 / 0.3 / 0.34 |
| ‡ per-kit | `DEFAULT_DRUM_KIT` | 7500 / 0.05 / 0.36 | 6500 / 0.35 / 0.4 |

Two things a reviewer will notice and must not "fix": **four groups of kits end up with byte-identical hats**, which is the archetype table's design and the honest ceiling of a one-highpass model (Global Constraints, correction 5); and **`Tight Pocket` gets the muffled hat at `gain 0.26`**, not §2's `0.40` "loudest hat in the library, because in funk the 16ths *are* the groove" — decision 18 binds the archetypes and the archetypes win (correction 4). Both are on the listening checklist.

- [ ] **Step 1: Measure the state this task is fixing**

Run:

```bash
bun -e '
import { DEFAULT_DRUM_KIT, DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const kits = Object.values(DRUM_KITS).map(mergeDrumKit);
const d = kits.map(k => k.hihat.decay), g = kits.map(k => k.hihat.gain), f = kits.map(k => k.hihat.filter);
console.log("hihat.decay ", Math.min(...d), "-", Math.max(...d), "ratio", (Math.max(...d) / Math.min(...d)).toFixed(3));
console.log("hihat.gain  ", Math.min(...g), "-", Math.max(...g), "ratio", (Math.max(...g) / Math.min(...g)).toFixed(3));
console.log("hihat.filter", Math.min(...f), "-", Math.max(...f), "ratio", (Math.max(...f) / Math.min(...f)).toFixed(3));
console.log("brightest (lowest highpass corner):", Object.entries(DRUM_KITS).map(([n, p]) => [n, mergeDrumKit(p).hihat.filter]).sort((a, b) => a[1] - b[1])[0]);
'
```

Expected: `hihat.decay 0.03 - 0.06 ratio 2.000`, `hihat.gain 0.25 - 0.4 ratio 1.600`, and the brightest hat reported as `[ "Lo-Fi Vinyl", 3500 ]` — the kit whose whole identity is 12-bit fold-back has the least filtered hat, because the filter is a **highpass** and 3500 Hz passes everything up to Nyquist. Slice 1 cannot fix that; decision 26's `topCut` (slice 3) can. Confirming it is still true after this task is a listening-checklist item.

- [ ] **Step 2: Write the failing test**

Append to `src/audio/drumKits.test.ts`:

```ts
describe('hat tuning rules', () => {
  const kits = Object.entries(DRUM_KITS).map(
    ([name, partial]) => [name, mergeDrumKit(partial)] as const,
  );

  test('the closed-hat decay range is wide enough to carry character', () => {
    // All 13 closed hats lived in 0.030-0.060 s. The 808's own closed hat is
    // 0.050 s and loose acoustic hats ring much longer; the widened range is
    // 0.020-0.110 s and is the single largest free win on the busiest row.
    const decays = kits.map(([, k]) => k.hihat.decay);
    for (const [name, k] of kits) {
      expect(k.hihat.decay, `${name}.hihat.decay`).toBeGreaterThanOrEqual(0.02);
      expect(k.hihat.decay, `${name}.hihat.decay`).toBeLessThanOrEqual(0.11);
    }
    expect(Math.max(...decays) / Math.min(...decays)).toBeGreaterThanOrEqual(3.0);
  });

  test('every open hat rings longer than its own closed hat', () => {
    // The closure IS the damping: an open hat that decays faster than the
    // closed hat of the same kit is a data error, not a character.
    for (const [name, k] of kits) {
      expect(k.openhat.decay, `${name}.openhat.decay`).toBeGreaterThan(k.hihat.decay);
    }
  });

  test('every open hat sits below its own closed hat in cutoff', () => {
    // Defensible and deliberate: the open hat keeps more body.
    for (const [name, k] of kits) {
      expect(k.openhat.filter, `${name}.openhat.filter`).toBeLessThanOrEqual(k.hihat.filter);
    }
  });
});
```

- [ ] **Step 3: Run the test and see it fail**

Run: `bun test src/audio/drumKits.test.ts -t "hat tuning rules"`
Expected: FAIL on `the closed-hat decay range is wide enough to carry character` — `expected 2 to be greater than or equal to 3`. The other two pass already, and are there to stop this task breaking them.

- [ ] **Step 4: Retune `DEFAULT_DRUM_KIT` and the three "Tight machine" kits**

In `src/data/drumKits.ts`:

```ts
  // DEFAULT_DRUM_KIT
  hihat: { filter: 7500, decay: 0.05, gain: 0.36 },
  openhat: { filter: 6500, decay: 0.35, gain: 0.4 },
```

```ts
    // 'Chrome Pulse' - Tight machine.
    hihat: { filter: 8800, decay: 0.022, gain: 0.34 },
    openhat: { filter: 7200, decay: 0.16, gain: 0.38 },
```

```ts
    // 'Velocity Breaks' - Tight machine.
    hihat: { filter: 8800, decay: 0.022, gain: 0.34 },
    openhat: { filter: 7200, decay: 0.16, gain: 0.38 },
```

```ts
    // 'Warehouse' - Tight machine.
    hihat: { filter: 8800, decay: 0.022, gain: 0.34 },
    openhat: { filter: 7200, decay: 0.16, gain: 0.38 },
```

- [ ] **Step 5: Retune the "808 dark", "Trap" and "Loose acoustic" kits**

```ts
    // '808 Vintage' - 808 dark. The long open-hat ring is one of the machine's
    // two most recognisable sounds.
    hihat: { filter: 5200, decay: 0.05, gain: 0.34 },
    openhat: { filter: 4400, decay: 0.42, gain: 0.38 },
```

```ts
    // 'Warm Riddim' - 808 dark.
    hihat: { filter: 5200, decay: 0.05, gain: 0.34 },
    openhat: { filter: 4400, decay: 0.42, gain: 0.38 },
```

```ts
    // 'Trap Beat' - Trap. The shortest hat in the library: trap hats must
    // survive 32nd and 64th rolls without smearing.
    hihat: { filter: 9000, decay: 0.028, gain: 0.32 },
    openhat: { filter: 7600, decay: 0.22, gain: 0.36 },
```

```ts
    // 'Acoustic Studio' - Loose acoustic. The longest closed hat: a real hat
    // rings.
    hihat: { filter: 6400, decay: 0.085, gain: 0.36 },
    openhat: { filter: 5400, decay: 0.5, gain: 0.42 },
```

```ts
    // 'Retro Drive' - Loose acoustic.
    hihat: { filter: 6400, decay: 0.085, gain: 0.36 },
    openhat: { filter: 5400, decay: 0.5, gain: 0.42 },
```

- [ ] **Step 6: Retune the "Lo-fi muffled" kits and the two per-kit exceptions**

```ts
    // 'Tight Pocket' - Lo-fi muffled. drum-kit-identities.md wanted the
    // loudest hat in the library here (funk 16ths ARE the groove); decision
    // 18 binds the five archetypes, and the archetype wins. On the listening
    // checklist.
    hihat: { filter: 3600, decay: 0.045, gain: 0.26 },
    openhat: { filter: 3200, decay: 0.3, gain: 0.28 },
```

```ts
    // 'Lo-Fi Vinyl' - Lo-fi muffled. Raising the corner and cutting the gain
    // is damage control, not the sound: the filter is a HIGHPASS, so a low
    // corner makes this the brightest hat in the set. decision 26's topCut
    // (slice 3) is the real fix.
    hihat: { filter: 3600, decay: 0.045, gain: 0.26 },
    openhat: { filter: 3200, decay: 0.3, gain: 0.28 },
```

```ts
    // '909 Modern' - per-kit: the 909 hat is sizzly and sits loud, not the
    // shortest in the room, and the open hat washes.
    hihat: { filter: 8500, decay: 0.045, gain: 0.42 },
    openhat: { filter: 7200, decay: 0.35, gain: 0.45 },
```

```ts
    // 'Sub Weight' - per-kit.
    hihat: { filter: 7200, decay: 0.035, gain: 0.3 },
    openhat: { filter: 6200, decay: 0.3, gain: 0.34 },
```

- [ ] **Step 7: Run the test and see it pass**

Run: `bun test src/audio/drumKits.test.ts -t "hat tuning rules"`
Expected: PASS, 3 tests.

- [ ] **Step 8: Measure the result, and check one boundary explicitly**

Run:

```bash
bun -e '
import { DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const kits = Object.values(DRUM_KITS).map(mergeDrumKit);
for (const [label, pick, req] of [["hihat.filter", k => k.hihat.filter, 2.5], ["hihat.decay", k => k.hihat.decay, 3.0], ["hihat.gain", k => k.hihat.gain, 1.5], ["openhat.filter", k => k.openhat.filter, 2.2]]) {
  const v = kits.map(pick); const mn = Math.min(...v), mx = Math.max(...v);
  console.log(`${mx >= req * mn ? "PASS" : "FAIL"} ${label} ${mn} - ${mx} ratio ${(mx / mn).toFixed(3)} req ${req}`);
}
'
```

Expected exactly: `PASS hihat.filter 3600 - 9000 ratio 2.500 req 2.5`, `PASS hihat.decay 0.022 - 0.085 ratio 3.864 req 3`, `PASS hihat.gain 0.26 - 0.42 ratio 1.615 req 1.5`, `PASS openhat.filter 3200 - 7600 ratio 2.375 req 2.2`.

**`hihat.filter` lands on its requirement exactly**: `2.5 × 3600 = 9000` and the max is 9000, and both are exactly representable in IEEE-754, so `max >= required` holds. That is not slack — **do not nudge any hat cutoff without re-running this command.** The archetype values are the spec's assignment and the boundary is a symptom of the one-highpass ceiling, not of a bad number.

- [ ] **Step 9: Run the gate**

Run: `bun run verify`
Expected: all green, eslint zero errors.

- [ ] **Step 10: Commit**

```bash
git add src/data/drumKits.ts src/audio/drumKits.test.ts
git commit -m "$(cat <<'EOF'
feat(drums): widen the hat decay range onto five archetypes

All thirteen closed hats lived in 0.030-0.060 s (2.0x) and check:drums
looked at neither decay nor gain. The busiest row in the library now
spans 0.022-0.085 s (3.9x) and 0.26-0.42 gain (1.6x), assigned by the five
archetypes: tight machine, 808 dark, trap, loose acoustic, lo-fi muffled.
909 Modern, Sub Weight and DEFAULT_DRUM_KIT take per-kit values.

Four groups of kits deliberately share a hat. That is the honest ceiling
of one highpass over white noise - re-tuning three numbers buys about 2.5
distinguishable hat characters and cannot buy genre identity. Decision 26's
topCut, in slice 3, is what separates them.

Tight Pocket takes the muffled archetype rather than the loudest hat in
the library that drum-kit-identities.md argues for; decision 18 binds the
archetypes. Recorded on the listening checklist.

hihat.filter now spreads exactly 2.500x, which is exactly what check:drums
requires. Re-measure before touching any hat cutoff.

Spec decision 18 (hats).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 5: Toms and crash — a shallow sweep, and cymbals that ring as long as their referents

Implements the tom half of **spec decision 18**, plus the crash column of `drum-kit-identities.md` §2, which slice 1 applies as part of the same per-kit tables.

**Files:**
- Modify: `src/data/drumKits.ts` — every `tom:` and `crash:` line (26 in total)
- Test: `src/audio/drumKits.test.ts`

**Interfaces:**
- Consumes: `mergeDrumKit(partial?: Partial<DrumKit>): DrumKit`; `DEFAULT_DRUM_KIT`, `DRUM_KITS`. `TomParams` is `{ freqStart: number; freqEnd: number; pitchTime: number; decay: number; gain: number }`; `CrashParams` is `{ filter: number; decay: number; gain: number; reverbSend: number }`.
- Produces: the retuned `tom` and `crash` blocks of all 13 entries, every tom satisfying `freqStart / freqEnd` within `1.35 ± 0.02`. **The single `tom` voice stays a single voice** — the `hitom` / `lowtom` split is decision 32, in slice 4. These are the low-tom values only.

**Why the tom sweep shrinks.** Measured, `tom.freqStart / tom.freqEnd` spans **1.64–2.15** across the thirteen entries, and that depth is the main reason a tom currently reads as a small kick. `…kick-snare-clap-toms.md` §4.3 puts both toms of a coherent kit at the *same* shallow ratio, **1.35 (4–6 semitones)**, with `pitchTime` clamped into `0.08–0.14`. The values below are §4.3's **low-tom column**, which is what today's `tom` already is: measured, `tom.freqEnd` spans 65–110 Hz and the 808's low tom centres at 90 Hz while its high tom is at 185 Hz.

**A loss to record, not to fix here.** `drum-kit-identities.md` §2 calls a `210 → 60 / pitchTime 0.28 / decay 0.50` Simmons sweep on `Retro Drive` *"the single biggest win in the library."* Decision 18 forbids it — every tom takes the 1.35 ratio. The spec wins; the Simmons tom is not authored in slice 1, and the listening checklist asks whether that was the right call.

| entry | `tom` freqStart | freqEnd | pitchTime | decay | gain | `crash` filter | decay | gain | reverbSend |
|---|---|---|---|---|---|---|---|---|---|
| `DEFAULT_DRUM_KIT` | 88 | 65 | 0.14 | 0.28 | 0.7 | 5500 | 0.9 | 0.5 | 0.4 |
| Retro Drive | 115 | 85 | 0.14 | 0.22 | 0.65 | 6000 | 0.9 | 0.55 | 0.4 |
| 909 Modern | 119 | 88 | 0.12 | 0.2 | 0.65 | 6200 | 1.4 | 0.55 | 0.3 |
| Trap Beat | 101 | 75 | 0.14 | 0.3 | 0.7 | 6000 | 1.3 | 0.5 | 0.25 |
| 808 Vintage | 108 | 80 | 0.14 | 0.25 | 0.65 | 5200 | 1.8 | 0.45 | 0.25 |
| Chrome Pulse | 149 | 110 | 0.1 | 0.22 | 0.65 | 7500 | 1.2 | 0.6 | 0.55 |
| Velocity Breaks | 128 | 95 | 0.1 | 0.16 | 0.6 | 6400 | 0.8 | 0.5 | 0.22 |
| Sub Weight | 97 | 72 | 0.14 | 0.4 | 0.7 | 5600 | 1.2 | 0.6 | 0.5 |
| Warehouse | 124 | 92 | 0.1 | 0.18 | 0.65 | 6600 | 1.0 | 0.5 | 0.45 |
| Tight Pocket | 122 | 90 | 0.1 | 0.18 | 0.65 | 5400 | 0.9 | 0.48 | 0.15 |
| Acoustic Studio | 135 | 100 | 0.14 | 0.45 | 0.75 | 5000 | 2.0 | 0.6 | 0.5 |
| Warm Riddim | 101 | 75 | 0.14 | 0.35 | 0.6 | 4800 | 1.5 | 0.48 | 0.5 |
| Lo-Fi Vinyl | 95 | 70 | 0.14 | 0.3 | 0.55 | 4600 | 1.0 | 0.4 | 0.3 |

- [ ] **Step 1: Measure the state this task is fixing**

Run:

```bash
bun -e '
import { DEFAULT_DRUM_KIT, DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const all = [["DEFAULT", DEFAULT_DRUM_KIT], ...Object.entries(DRUM_KITS).map(([n, p]) => [n, mergeDrumKit(p)])];
for (const [n, k] of all) console.log(n.padEnd(18), "tom", k.tom.freqStart, "->", k.tom.freqEnd, "ratio", (k.tom.freqStart / k.tom.freqEnd).toFixed(2), "| crash decay", k.crash.decay);
'
```

Expected: `DEFAULT` at ratio `2.15`, every other entry between `1.64` and `1.85`, and `crash.decay` clustered at `0.7–1.7`.

- [ ] **Step 2: Write the failing test**

Append to `src/audio/drumKits.test.ts`:

```ts
describe('tom and crash tuning rules', () => {
  const merged: [string, ReturnType<typeof mergeDrumKit>][] = [
    ['DEFAULT_DRUM_KIT', mergeDrumKit()],
    ...Object.entries(DRUM_KITS).map(
      ([name, partial]) => [name, mergeDrumKit(partial)] as [string, ReturnType<typeof mergeDrumKit>],
    ),
  ];

  test('every tom sweeps 4 to 6 semitones, not an octave', () => {
    // The depth of the sweep is the main reason a tom reads as a small kick.
    // Measured before this task: 1.64 to 2.15.
    for (const [name, kit] of merged) {
      expect(kit.tom.freqStart / kit.tom.freqEnd, `${name} tom sweep`).toBeCloseTo(1.35, 1);
      expect(kit.tom.freqStart / kit.tom.freqEnd, `${name} tom sweep`).toBeLessThanOrEqual(1.37);
      expect(kit.tom.freqStart / kit.tom.freqEnd, `${name} tom sweep`).toBeGreaterThanOrEqual(1.33);
    }
  });

  test('every tom settles its pitch inside the 0.08-0.14 s band', () => {
    for (const [name, kit] of merged) {
      expect(kit.tom.pitchTime, `${name}.tom.pitchTime`).toBeGreaterThanOrEqual(0.08);
      expect(kit.tom.pitchTime, `${name}.tom.pitchTime`).toBeLessThanOrEqual(0.14);
    }
  });

  test('the tom sits below the snare body and above the kick', () => {
    // The descending ladder a listener recognises as a fill: snare body,
    // tom, kick. With one tom this is a three-step check; decision 32 adds
    // the fourth step in slice 4.
    for (const [name, kit] of merged) {
      expect(kit.tom.freqEnd, `${name} tom vs snare`).toBeLessThan(kit.snare.bodyFreqEnd);
      expect(kit.tom.freqEnd, `${name} tom vs kick`).toBeGreaterThan(kit.kick.freqEnd);
    }
  });

  test('crash decays span the difference between a fade and a ring', () => {
    // 0.85 s is a crash that has been faded, not one that rang; the 808
    // cymbal is famously long and Acoustic Studio owns the ceiling.
    const decays = Object.values(DRUM_KITS).map((p) => mergeDrumKit(p).crash.decay);
    expect(Math.max(...decays) / Math.min(...decays)).toBeGreaterThanOrEqual(2.4);
    expect(Math.max(...decays)).toBeGreaterThanOrEqual(1.8);
  });
});
```

- [ ] **Step 3: Run the test and see it fail**

Run: `bun test src/audio/drumKits.test.ts -t "tom and crash tuning rules"`
Expected: FAIL. `every tom sweeps 4 to 6 semitones` fails on `DEFAULT_DRUM_KIT tom sweep: expected 2.153846... to be less than or equal to 1.37`. `crash decays span…` fails on `expected 2.428... to be greater than or equal to 2.4` — no: it reports `Math.max(...decays)` of 1.7, `expected 1.7 to be greater than or equal to 1.8`.

- [ ] **Step 4: Retune `DEFAULT_DRUM_KIT` and the four lowest toms**

In `src/data/drumKits.ts`:

```ts
  // DEFAULT_DRUM_KIT
  tom: { freqStart: 88, freqEnd: 65, pitchTime: 0.14, decay: 0.28, gain: 0.7 },
  crash: { filter: 5500, decay: 0.9, gain: 0.5, reverbSend: 0.4 },
```

```ts
    // 'Lo-Fi Vinyl'
    tom: { freqStart: 95, freqEnd: 70, pitchTime: 0.14, decay: 0.3, gain: 0.55 },
    crash: { filter: 4600, decay: 1.0, gain: 0.4, reverbSend: 0.3 },
```

```ts
    // 'Sub Weight'
    tom: { freqStart: 97, freqEnd: 72, pitchTime: 0.14, decay: 0.4, gain: 0.7 },
    crash: { filter: 5600, decay: 1.2, gain: 0.6, reverbSend: 0.5 },
```

```ts
    // 'Trap Beat'
    tom: { freqStart: 101, freqEnd: 75, pitchTime: 0.14, decay: 0.3, gain: 0.7 },
    crash: { filter: 6000, decay: 1.3, gain: 0.5, reverbSend: 0.25 },
```

```ts
    // 'Warm Riddim'
    tom: { freqStart: 101, freqEnd: 75, pitchTime: 0.14, decay: 0.35, gain: 0.6 },
    crash: { filter: 4800, decay: 1.5, gain: 0.48, reverbSend: 0.5 },
```

- [ ] **Step 5: Retune the middle four**

```ts
    // '808 Vintage' - 808 toms are near-static decaying sines, and the 808
    // cymbal is famously long.
    tom: { freqStart: 108, freqEnd: 80, pitchTime: 0.14, decay: 0.25, gain: 0.65 },
    crash: { filter: 5200, decay: 1.8, gain: 0.45, reverbSend: 0.25 },
```

```ts
    // 'Retro Drive' - drum-kit-identities.md §2 wanted a 3.5:1 Simmons sweep
    // here and called it the single biggest win in the library. Decision 18
    // binds every tom to a 1.35 ratio, so it is not authored in slice 1.
    tom: { freqStart: 115, freqEnd: 85, pitchTime: 0.14, decay: 0.22, gain: 0.65 },
    crash: { filter: 6000, decay: 0.9, gain: 0.55, reverbSend: 0.4 },
```

```ts
    // '909 Modern' - 0.85 s is a crash that has been faded, not one that rang.
    tom: { freqStart: 119, freqEnd: 88, pitchTime: 0.12, decay: 0.2, gain: 0.65 },
    crash: { filter: 6200, decay: 1.4, gain: 0.55, reverbSend: 0.3 },
```

```ts
    // 'Tight Pocket' - "Funky Drummer" has no crash; keep it usable but dry.
    tom: { freqStart: 122, freqEnd: 90, pitchTime: 0.1, decay: 0.18, gain: 0.65 },
    crash: { filter: 5400, decay: 0.9, gain: 0.48, reverbSend: 0.15 },
```

- [ ] **Step 6: Retune the four highest toms**

```ts
    // 'Warehouse'
    tom: { freqStart: 124, freqEnd: 92, pitchTime: 0.1, decay: 0.18, gain: 0.65 },
    crash: { filter: 6600, decay: 1.0, gain: 0.5, reverbSend: 0.45 },
```

```ts
    // 'Velocity Breaks' - shortest crash.
    tom: { freqStart: 128, freqEnd: 95, pitchTime: 0.1, decay: 0.16, gain: 0.6 },
    crash: { filter: 6400, decay: 0.8, gain: 0.5, reverbSend: 0.22 },
```

```ts
    // 'Acoustic Studio' - longest tom and longest crash; both are
    // identity-carrying.
    tom: { freqStart: 135, freqEnd: 100, pitchTime: 0.14, decay: 0.45, gain: 0.75 },
    crash: { filter: 5000, decay: 2.0, gain: 0.6, reverbSend: 0.5 },
```

```ts
    // 'Chrome Pulse' - shortest, highest tom; brightest crash.
    tom: { freqStart: 149, freqEnd: 110, pitchTime: 0.1, decay: 0.22, gain: 0.65 },
    crash: { filter: 7500, decay: 1.2, gain: 0.6, reverbSend: 0.55 },
```

- [ ] **Step 7: Run the test and see it pass**

Run: `bun test src/audio/drumKits.test.ts -t "tom and crash tuning rules"`
Expected: PASS, 4 tests.

- [ ] **Step 8: Measure the result, and prove no kit fell back onto the defaults**

Run:

```bash
bun -e '
import { DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const kits = Object.values(DRUM_KITS).map(mergeDrumKit);
const cf = kits.map(k => k.crash.filter), cd = kits.map(k => k.crash.decay), te = kits.map(k => k.tom.freqEnd);
console.log("crash.filter", Math.min(...cf), "-", Math.max(...cf), "ratio", (Math.max(...cf) / Math.min(...cf)).toFixed(3), "req 1.5");
console.log("crash.decay ", Math.min(...cd), "-", Math.max(...cd), "ratio", (Math.max(...cd) / Math.min(...cd)).toFixed(3));
console.log("tom.freqEnd ", Math.min(...te), "-", Math.max(...te));
'
bun run check:drums
```

Expected: `crash.filter 4600 - 7500 ratio 1.630 req 1.5`, `crash.decay 0.8 - 2 ratio 2.500`, `tom.freqEnd 65 - 110`. `check:drums` prints `All checks passed.` — in particular all 84 `overrides <type>` lines must still say PASS, which is the check that no kit's voice collapsed onto `DEFAULT_DRUM_KIT` while values moved.

- [ ] **Step 9: Run the gate**

Run: `bun run verify`
Expected: all green, eslint zero errors.

- [ ] **Step 10: Commit**

```bash
git add src/data/drumKits.ts src/audio/drumKits.test.ts
git commit -m "$(cat <<'EOF'
feat(drums): shallow the tom sweep and let the crashes ring

tom.freqStart / freqEnd spanned 1.64 to 2.15 across the thirteen entries,
and that depth is the main reason a tom reads as a small kick. Every tom is
now at 1.35 (4-6 semitones), the same ratio on every kit, with pitchTime
inside 0.08-0.14. These are low-tom values only; the hitom/lowtom split is
decision 32, in slice 4.

drum-kit-identities.md wanted a 3.5:1 Simmons sweep on Retro Drive and
called it the single biggest win in the library. Decision 18 binds every
tom to 1.35, so it is not authored here. On the listening checklist.

Crashes take their per-kit decays: 808 Vintage 0.9 -> 1.8 (the 808 cymbal
is famously long), 909 Modern 0.85 -> 1.4 (0.85 s is a crash that has been
faded, not one that rang), Acoustic Studio 1.7 -> 2.0. The range is now
0.8-2.0 s against 0.7-1.7 before.

Spec decision 18 (toms), plus the crash column of the per-kit tables.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 6: `check:drums` — five new spreads and a pairwise nearest-neighbour check

Implements **spec decision 19**, and the first of the three properties in **decision 40**.

**This task must run last.** Its new assertions are calibrated against the values Tasks 1–5 author. Run before them and it fails on values nobody has fixed yet, which is a false failure and teaches a reviewer to ignore the script.

**Files:**
- Modify: `scripts/check-drum-kit-separation.ts`

**Interfaces:**
- Consumes: `DEFAULT_DRUM_KIT`, `DRUM_KITS`, `type DrumKit` from `../src/data/drumKits.ts`; `mergeDrumKit` from `../src/audio/drumKits.ts`. Existing script locals it must keep working with: `const DRUM_TYPES: (keyof DrumKit)[]`; `function report(label: string, pass: boolean, detail = ''): void`, which increments a module-level `let failures`; `const kits: { name: string; kit: DrumKit }[]`; `function spread(label: string, pick: (kit: DrumKit) => number, factor: number): void`.
- Produces, in the same file: `function spreadDefined(label: string, pick: (kit: DrumKit) => number | undefined, factor: number, minCount: number): void` — a spread over only the kits that define the parameter, which also fails if fewer than `minCount` kits define it; `const PAIRWISE_PARAMS: { label: string; pick: (kit: DrumKit) => number }[]`; `const MIN_PAIRWISE_SEPARATION = 0.8`; `const ACCEPTED_NEIGHBOURS: Record<string, string> = {}`. Nothing outside this script imports any of them.

**The metric.** For each of the 66 unordered pairs of named kits, separation is

```
sep(a, b) = max over p in PAIRWISE_PARAMS of |log2(p(a) / p(b))|
```

— the number of doublings on whichever single parameter differs most. It is **whole-kit, not per-voice**, which is the point: two kits may share a hat (they do, by design — see Global Constraints correction 5) as long as *something* about them diverges. `0.8` is a 1.74× difference on at least one parameter.

**Measured, and this is the failing test:** on the values as they stand before Tasks 1–5, the three closest pairs are `909 Modern ↔ Warehouse` at **0.415**, `Velocity Breaks ↔ Tight Pocket` at **0.474** and `808 Vintage ↔ Lo-Fi Vinyl` at **0.585**. All three are below 0.8. `909 Modern ↔ Warehouse` is the measured twinning that passed CI for years because an aggregate spread is satisfied by two extreme kits and says nothing about the ten in between. After Tasks 1–5 the minimum is **1.000**.

**The rule for a future failure, so nobody weakens the check to make it green:** if this check fails, the pair it names is a genuine twin and must be **retuned**. If — and only if — the pair is one the design intends to be near neighbours (`drum-kit-identities.md` §3 lists five), record it in `ACCEPTED_NEIGHBOURS` with a one-line reason, which is a deliberate act a reviewer sees. **Never lower `MIN_PAIRWISE_SEPARATION`.** Same discipline as the `referent: 'authored'` allowlist of decision 41.

- [ ] **Step 1: Measure the separation the current script cannot see**

Run:

```bash
bun -e '
import { DRUM_KITS } from "./src/data/drumKits.ts";
import { mergeDrumKit } from "./src/audio/drumKits.ts";
const kits = Object.entries(DRUM_KITS).map(([name, p]) => ({ name, kit: mergeDrumKit(p) }));
const P = [k => k.kick.freqStart, k => k.kick.freqEnd, k => k.kick.pitchTime, k => k.kick.decay, k => k.kick.gain,
k => k.snare.bodyFreqStart, k => k.snare.bodyDecay, k => k.snare.noiseFilter, k => k.snare.noiseDecay, k => k.snare.reverbSend,
k => k.hihat.filter, k => k.hihat.decay, k => k.hihat.gain, k => k.openhat.filter, k => k.openhat.decay,
k => k.clap.filter, k => k.clap.decay, k => k.clap.reverbSend, k => k.tom.freqEnd, k => k.tom.decay,
k => k.crash.filter, k => k.crash.decay, k => k.crash.reverbSend];
const pairs = [];
for (let i = 0; i < kits.length; i++) for (let j = i + 1; j < kits.length; j++)
  pairs.push([Math.max(...P.map(f => Math.abs(Math.log2(f(kits[i].kit) / f(kits[j].kit))))), kits[i].name, kits[j].name]);
pairs.sort((a, b) => a[0] - b[0]);
for (const p of pairs.slice(0, 4)) console.log(p[0].toFixed(3), p[1], "<->", p[2]);
'
```

Expected **after** Tasks 1–5: the closest pair is at `1.000`, and the four printed lines are all at or above it. If any line is below `0.800`, a value in Tasks 1–5 was mistyped — go back and find it before writing the check.

- [ ] **Step 2: Add the five new spreads that decision 19 names**

In `scripts/check-drum-kit-separation.ts`, immediately after the existing `spread('crash.filter', …)` line, add:

```ts
// --- Check 2b: the parameters that let the collapse through (spec decision 19) ---
// check:drums never looked at any of these, which is how hihat.decay sat in a
// 2.0x band and snare.bodyTime was one copy-pasted number in all 13 entries.
spread('hihat.decay', (k) => k.hihat.decay, 3.0);
spread('hihat.gain', (k) => k.hihat.gain, 1.5);
spread('snare.bodyTime', (k) => k.snare.bodyTime, 2.5);
spread('kick.pitchTime', (k) => k.kick.pitchTime, 3.0);
```

- [ ] **Step 3: Add the optional-parameter spread and use it for the click**

`kick.clickLevel` is optional, and three kits omit it on purpose (their referent has no click path). A plain `spread` would read those as `undefined`, and `Math.min` of an `undefined` is `NaN`, which makes the comparison silently false. Add, directly after the `spread` function definition:

```ts
/**
 * A spread over an OPTIONAL parameter: only the kits that define it count.
 * `minCount` is what stops the check passing vacuously - two kits with a
 * click and ten without would otherwise satisfy any factor.
 */
function spreadDefined(
  label: string,
  pick: (kit: DrumKit) => number | undefined,
  factor: number,
  minCount: number,
) {
  const values = kits.map((k) => pick(k.kit)).filter((v): v is number => v !== undefined);
  if (values.length < minCount) {
    report(`${label} spread`, false, `only ${values.length} of ${kits.length} kits define it, need ${minCount}`);
    return;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  report(
    `${label} spread`,
    max >= factor * min,
    `${values.length} kits define it, max=${max}, min=${min}, required max >= ${factor}*min=${(factor * min).toFixed(3)}`,
  );
}
```

and after the four lines from Step 2:

```ts
spreadDefined('kick.clickLevel', (k) => k.kick.clickLevel, 2.0, 8);
```

- [ ] **Step 4: Add the pairwise nearest-neighbour check**

Append to `scripts/check-drum-kit-separation.ts`, after the spread calls and before the closing `console.log`/`process.exit`:

```ts
// --- Check 3: pairwise nearest-neighbour separation (spec decision 19) ---
// An aggregate spread is satisfied by two extreme kits and says nothing about
// the ten in between: 909 Modern and Warehouse were measurably twins and
// passed CI for exactly that reason. This is whole-kit, not per-voice - two
// kits may share a hat (four groups deliberately do, because one highpass over
// white noise buys about 2.5 hat characters) as long as something diverges.
const PAIRWISE_PARAMS: { label: string; pick: (kit: DrumKit) => number }[] = [
  { label: 'kick.freqStart', pick: (k) => k.kick.freqStart },
  { label: 'kick.freqEnd', pick: (k) => k.kick.freqEnd },
  { label: 'kick.pitchTime', pick: (k) => k.kick.pitchTime },
  { label: 'kick.decay', pick: (k) => k.kick.decay },
  { label: 'kick.gain', pick: (k) => k.kick.gain },
  { label: 'snare.bodyFreqStart', pick: (k) => k.snare.bodyFreqStart },
  { label: 'snare.bodyDecay', pick: (k) => k.snare.bodyDecay },
  { label: 'snare.noiseFilter', pick: (k) => k.snare.noiseFilter },
  { label: 'snare.noiseDecay', pick: (k) => k.snare.noiseDecay },
  { label: 'snare.reverbSend', pick: (k) => k.snare.reverbSend },
  { label: 'hihat.filter', pick: (k) => k.hihat.filter },
  { label: 'hihat.decay', pick: (k) => k.hihat.decay },
  { label: 'hihat.gain', pick: (k) => k.hihat.gain },
  { label: 'openhat.filter', pick: (k) => k.openhat.filter },
  { label: 'openhat.decay', pick: (k) => k.openhat.decay },
  { label: 'clap.filter', pick: (k) => k.clap.filter },
  { label: 'clap.decay', pick: (k) => k.clap.decay },
  { label: 'clap.reverbSend', pick: (k) => k.clap.reverbSend },
  { label: 'tom.freqEnd', pick: (k) => k.tom.freqEnd },
  { label: 'tom.decay', pick: (k) => k.tom.decay },
  { label: 'crash.filter', pick: (k) => k.crash.filter },
  { label: 'crash.decay', pick: (k) => k.crash.decay },
  { label: 'crash.reverbSend', pick: (k) => k.crash.reverbSend },
];

/** Doublings on whichever single parameter separates the two kits most. */
const MIN_PAIRWISE_SEPARATION = 0.8;

/**
 * Pairs the design intends to be near neighbours, each with its reason.
 * Adding a name here is a DELIBERATE act a reviewer sees, and is the only
 * legal response to a failure other than retuning the kit.
 * NEVER lower MIN_PAIRWISE_SEPARATION to make this green.
 */
const ACCEPTED_NEIGHBOURS: Record<string, string> = {};

let closest = { sep: Infinity, pair: '', on: '' };
for (let i = 0; i < kits.length; i++) {
  for (let j = i + 1; j < kits.length; j++) {
    const a = kits[i];
    const b = kits[j];
    let sep = 0;
    let on = '';
    for (const { label, pick } of PAIRWISE_PARAMS) {
      const d = Math.abs(Math.log2(pick(a.kit) / pick(b.kit)));
      if (d > sep) {
        sep = d;
        on = label;
      }
    }
    const key = `${a.name} <-> ${b.name}`;
    if (sep < closest.sep) closest = { sep, pair: key, on };
    if (sep >= MIN_PAIRWISE_SEPARATION || key in ACCEPTED_NEIGHBOURS) continue;
    report(
      `pairwise ${key}`,
      false,
      `separation ${sep.toFixed(3)} < ${MIN_PAIRWISE_SEPARATION} (widest gap is ${on}); retune one kit, or add the pair to ACCEPTED_NEIGHBOURS with a reason`,
    );
  }
}
report(
  'pairwise nearest-neighbour separation',
  closest.sep >= MIN_PAIRWISE_SEPARATION,
  `closest is ${closest.pair} at ${closest.sep.toFixed(3)} on ${closest.on}`,
);
```

- [ ] **Step 5: Run the script and read every new line**

Run: `bun run check:drums`
Expected: `All checks passed.`, and among the lines:

```
PASS  hihat.decay spread  (max=0.085, min=0.022, required max >= 3*min=0.066)
PASS  hihat.gain spread  (max=0.42, min=0.26, required max >= 1.5*min=0.390)
PASS  snare.bodyTime spread  (max=0.03, min=0.01, required max >= 2.5*min=0.025)
PASS  kick.pitchTime spread  (max=0.06, min=0.012, required max >= 3*min=0.036)
PASS  kick.clickLevel spread  (9 kits define it, max=0.4, min=0.15, required max >= 2*min=0.300)
PASS  pairwise nearest-neighbour separation  (closest is Chrome Pulse <-> Warehouse at 1.100 on ...)
```

The closest pair's identity may differ — four pairs sit at exactly `1.000` — but **no `pairwise <kit> <-> <kit>` FAIL line may appear**, and the reported closest separation must be at or above `0.800`.

- [ ] **Step 6: Prove the check can fail, by hand**

Temporarily edit `scripts/check-drum-kit-separation.ts` to set `const MIN_PAIRWISE_SEPARATION = 1.5;` and run `bun run check:drums`.
Expected: several `FAIL  pairwise …` lines naming specific kit pairs and the parameter with the widest gap, and a non-zero exit. **Then set it back to `0.8`** and re-run to confirm `All checks passed.` A check that has never been seen to fail is not a check.

- [ ] **Step 7: Run the gate**

Run: `bun run verify`
Expected: all green, eslint zero errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-drum-kit-separation.ts
git commit -m "$(cat <<'EOF'
test(drums): add the spreads and the pairwise check that let the collapse through

check:drums tested eight aggregate spreads and never looked at hihat.decay,
hihat.gain, snare.bodyTime, kick.pitchTime or kick.clickLevel - which is how
the busiest row in the library sat in a 2.0x decay band and snare.bodyTime
was one copy-pasted 0.08 in all thirteen entries. All five are now asserted,
with spreadDefined() for the optional click so three deliberately clickless
kits do not turn the comparison into a NaN.

An aggregate spread is satisfied by two extreme kits and says nothing about
the ten in between: 909 Modern and Warehouse were measurably twins and
passed CI for exactly that reason. Check 3 is pairwise over all 66 pairs -
the doublings on whichever single parameter separates two kits most, floored
at 0.8. Measured on the pre-slice values, the three closest pairs were
909 Modern <-> Warehouse at 0.415, Velocity Breaks <-> Tight Pocket at 0.474
and 808 Vintage <-> Lo-Fi Vinyl at 0.585; after slice 1 the minimum is 1.000.

The check is whole-kit, not per-voice, because four groups of kits share a
hat by design - one highpass over white noise buys about 2.5 distinguishable
hat characters, and decision 26 is what fixes that.

A failure means retune the kit, or add the pair to ACCEPTED_NEIGHBOURS with
a reason. Never lower the threshold.

Spec decision 19, and decision 40's first property.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## The listening checklist for slice 1 — a human gate of equal weight to `bun run verify`

Spec decisions **39** and **42**. `bun run verify` proves nothing broke and that the values differ. **It cannot tell you a clap sounds like hands.** Slice 1 changes sound on purpose; work through every item below before calling the slice done, and record what you heard — including the items where the answer is "no", because those are findings that re-scope slices 3 and 4.

Setup: `bun run dev`, open the app, click once to create the `AudioContext`, then use the **drum pads** for single hits and the **sequencer** for anything about groove. Switch kits from the loop's sound-kit control. Go kit by kit; there are thirteen.

**The kick — decisions 13 and 14**

- [ ] `Sub Weight`, kick pad, single hits. **The kick must no longer read as a falling glide.** Before this slice it swept for 350 ms under a 600 ms decay. You should hear an attack and then a steady low note, not a slide whistle. If you can still follow the pitch downward with your ear, `pitchTime` did not collapse.
- [ ] `Trap Beat`, kick pad, hold a bar of eighth notes. The tail should sit at one pitch (E1) long enough that you could play a bass note against it. Then play the kick under a bass line in the same key — it should sit *with* the bass rather than smearing across it.
- [ ] `808 Vintage` kick against `Sub Weight` kick, back to back. Two long-tailed kicks at different notes (G1 vs D1) with different attacks. If they are hard to tell apart, that is a finding about decision 13's note pinning.
- [ ] `Velocity Breaks`, `Tight Pocket`, `Acoustic Studio`, `Chrome Pulse` kicks in turn. **Each should now begin with an audible tick before the body.** Then listen for the limitation the spec names: solna's click is a static sine, so it is a *pitched blip*, not a broadband beater. Can you hear the pitch of the click? If yes, that is the evidence for `clickType: 'tone' | 'noise'`, which is a named non-goal and the first follow-up candidate.
- [ ] `808 Vintage`, `Trap Beat`, `Warm Riddim` kicks. **These three must have no tick at all.** If one clicks, `DEFAULT_DRUM_KIT.kick` grew a click key and the merge is forcing it on every kit.

**The clap — decision 15**

- [ ] Any kit, clap pad, single hits at full velocity. **The first burst must be the loudest.** Before this slice the third event was at 1.1× peak, so the loudest event was the last. Listen for a hit that *starts* strong and falls away.
- [ ] Same, listening for structure rather than level. You should hear **three distinct hands** in the first 30 ms and then a tail, not one chopped-sounding noise gate. If it sounds like one hit, the gaps between bursts are not landing.
- [ ] Clap at velocity ~0.2 (light pad press). Every burst must scale down together; no burst should be louder than the first.
- [ ] `909 Modern`, `Warehouse`, `Chrome Pulse` and `Acoustic Studio` claps back to back. Their bandpass moved down toward the machines' ~1 kHz. They should read as *hands* rather than as sticks or as a hiss.
- [ ] `Warm Riddim` clap. Wettest in the library (`reverbSend` 0.5) — the tail should be obviously longer and more distant than any other kit's.

**The snare — decisions 16 and 17**

- [ ] `DEFAULT_DRUM_KIT` snare (any grid using a kit that does not override it, or via the drum pad on a kit before switching). Before this slice its body swept 220 → 90 Hz over 80 ms. **It must no longer read as a small tom.** No downward "dooo" under the noise.
- [ ] `Trap Beat` snare against `Lo-Fi Vinyl` snare, back to back. This is the widest end of the new genre axis: `noise:body` 2.83 against 0.71. Trap should be almost all *hiss*, lo-fi almost all *thud*. **If they sound like the same snare at different brightnesses, decision 17's premise — that genre lives in the gain ratio, not the frequency — did not survive contact.** That is a finding worth writing down.
- [ ] `Warm Riddim` snare, alone. It is a 900 Hz body with almost no noise — a **cross-stick**: a high, short, wooden *tock*. It should not sound like a snare at all. This is the single most distinctive snare in the library after the retune; if it still reads as an ordinary snare, the body gain and noise gain are the wrong way round.
- [ ] `Retro Drive` snare on the `synthwave-four-on-floor` grid. Short body plus the library's highest reverb send is the closest reachable read of a gated 80s snare. Judge it against a real gated snare in your head: **it will not be one** (nothing gates the return — spec non-goals). Is it close enough that a gated-reverb envelope is worth the slice-3-shaped work? That is the question this item exists to answer.

**The hats — decision 18**

- [ ] `Trap Beat` hat against `Acoustic Studio` hat, sixteenths on the sequencer. Decay 0.028 s against 0.085 s. **Trap must survive a 32nd-note roll without smearing into one sound; the acoustic hat must audibly ring between hits.** This is the widest free win in the slice.
- [ ] `Lo-Fi Vinyl` hat against every other kit's hat. **It will still be the brightest and fullest hat in the set** — the filter is a highpass, so its low corner passes everything up to Nyquist. Confirming that is how we know decision 26's `topCut` is genuinely needed and not a nicety. **Expect to hear the wrong thing here.** If `Lo-Fi Vinyl`'s hat somehow sounds dull, re-check its `filter` value.
- [ ] `Tight Pocket` on a funk sixteenth grid. The archetype gave it the *muffled* hat at gain 0.26, against the research's argument that in funk the sixteenths **are** the groove and this should be the loudest hat in the library. **Does the groove survive?** If the hat disappears under the kick and snare, that is the evidence for overriding the archetype on this one kit, and it is a real finding — record it rather than editing the value on the spot.
- [ ] `Chrome Pulse`, `Velocity Breaks` and `Warehouse` hats, back to back on the same grid. They are byte-identical by design. **Confirm the three kits are still tellable apart** — they must be, on kick and snare. If they now sound like one kit, the pairwise check in Task 6 is passing on numbers while failing the ear, and that is exactly the failure mode spec decision 39 warns about.
- [ ] `808 Vintage` open hat. Its ring went 0.30 → 0.42 s; the long open hat is one of the 808's two most recognisable sounds. It should be unmistakable against `Velocity Breaks`' 0.16 s.

**The toms and crashes — decision 18**

- [ ] Any kit, tom pad, single hits. **The tom must no longer read as a small kick.** The sweep went from roughly an octave to 4–6 semitones. You should hear a drum with a pitch, not a short falling thump.
- [ ] `Retro Drive` tom. This is the loss the slice took on purpose: the research wanted a 3.5:1 Simmons sweep here and called it the single biggest win in the library; decision 18's 1.35 ratio forbids it. **Listen to what we gave up.** If the shallow tom is clearly worse for this kit, that is an argument to revisit decision 18 for a per-kit exception in a later slice — write it down, do not edit the value.
- [ ] Snare → tom → kick on one kit, three hits in a row. That is the descending ladder. With one tom it is a three-step fall; decision 32 adds the fourth step in slice 4. **Does it read as a fall, or as three unrelated hits?** The answer decides how much the hi/low split is worth.
- [ ] `Acoustic Studio` crash (2.0 s) against `Velocity Breaks` crash (0.8 s). One must ring, the other must stop.
- [ ] `808 Vintage` crash. 0.9 → 1.8 s; the 808 cymbal is famously long. It should now be the second-longest in the library and obviously so.

**Across the app**

- [ ] Press all eight vibe chips and roll the dice on each. **Nothing should be silent, nothing should be broken, and every kit should still sit inside its own mix.** Note that three vibes (`cyber-edm`, `deep-ambient`, `zen-garden`) name a kit that does not exist and are silently shipping `DEFAULT_DRUM_KIT` — that is **spec decision 5, repaired in slice 2**, and hearing the default kit under those three chips is correct behaviour for now, not a slice-1 regression.
- [ ] Load three or four grids from the sequencer menu and let each run a few bars at 90, 120 and 150 BPM. Listen for the one thing a per-hit retune can break: **at fast tempos, do any of the longer decays now overlap into mud?** `Acoustic Studio`'s 0.085 s hat and 2.0 s crash are the ones to watch.
- [ ] Finally, the honest question the whole slice exists to answer (spec decision 12): **how much of the gap did tuning close?** Slice 1 is reversible by `git revert` of a data file. Write down, per kit, whether what remains is bad tuning or a capability wall — that judgement is what re-scopes slices 3 and 4 with evidence instead of executing them because they were planned.

---

## Self-Review

**1. Spec coverage — decisions 13–19, each mapped to a task**

| decision | what it requires | task |
|---|---|---|
| 13 | `pitchTime ≤ 0.1 × decay` everywhere; `freqStart` rises where the sweep shortens; long kicks pinned to a note | **Task 1**, Steps 4–6, tested in Step 2 |
| 14 | Kicks gain a click by referent family; 808 and trap-808 omit it | **Task 1**, Steps 5–6, tested in Step 2 |
| 15 | Three decaying bursts plus a tail; amplitudes monotonically non-increasing; each burst decays with a gap; the filter follows down toward 1 kHz | **Task 2**, Steps 4 and 8, tested in Step 2 |
| 16 | `bodyTime` 0.08 → 0.010–0.030; `bodyFreqEnd ≥ 0.85 × bodyFreqStart` | **Task 3**, Steps 4–5, tested in Step 2 |
| 17 | `noise:body` spans 0.7–2.8 and carries genre | **Task 3**, Steps 4–5, tested in Step 2 |
| 18 | Hats onto the five archetypes with decay widened to 0.020–0.110; toms at `freqStart / freqEnd ≈ 1.35` as a low tom only | **Task 4** (hats) and **Task 5** (toms) |
| 19 | `hihat.decay`, `hihat.gain`, `snare.bodyTime`, `kick.pitchTime`, `kick.clickLevel` added to the spread list; a pairwise nearest-neighbour check alongside the aggregate one | **Task 6**, Steps 2–4 |
| 39, 42 | The listening checklist as a human gate of equal weight, carried as numbered steps rather than a closing note | the checklist above |

**Not turned into a task, and why.** Decision **43** ("extend `report:drums-diff` to `DRUM_KITS` — per-kit, per-voice, per-parameter before/after, a report that always exits 0") is a verification decision, not one of 13–19, and it is a **new script capability**, which the slice-1 criterion in Global Constraints forbids. Each task's Step 1 and its penultimate measure step supply the same before/after evidence for the parameters that moved, and every commit message quotes it. If a reviewer wants the artifact rather than the commit bodies, it is a clean standalone follow-up. Decision **40**'s second and third properties (consolidate the three copies of `DRUM_TYPES`; add every new voice to the spread list before authoring it) are about voices that do not exist until slice 4 and are left there; **40**'s first property is Task 6.

**2. Placeholder scan** — no "TBD", no "add appropriate error handling", no "similar to Task N", no "write tests for the above". Every per-kit number is written out in a table and again in the code block that lands it, in all six tasks. Every test step carries its test; every code step carries its code. The one place a value is not fixed in advance — the identity of the closest pair in Task 6 Step 5 — is stated as a range with an explicit floor and a rule for what to do if it is missed, not as a blank.

**3. Type consistency** — `mergeDrumKit(partial?: Partial<DrumKit>): DrumKit` is named identically in Tasks 1, 3, 4, 5 and 6. `KickParams`, `SnareParams`, `HatParams`, `ClapParams`, `TomParams`, `CrashParams` and `DrumKit` match `src/data/drumKits.ts` exactly, including which fields are optional (`clickFreq`, `clickLevel`, `clickDecay` only). `ENV_FLOOR` in Task 2 is the identifier already imported at `src/audio/engine.ts:10`. `spread(label, pick, factor)`, `report(label, pass, detail)`, `kits` and `DRUM_TYPES` in Task 6 are the script's existing locals, unchanged; `spreadDefined`, `PAIRWISE_PARAMS`, `MIN_PAIRWISE_SEPARATION` and `ACCEPTED_NEIGHBOURS` are new and used nowhere else. The test-fake fields Task 2 reads — `gain.events` with `kind: 'set' | 'exp' | 'target'`, and `gain.ramps` — match `src/audio/testFakes.ts`.

**4. Cross-task value consistency** — every number in Tasks 1–5 was evaluated together as one merged table before this plan was written. Result: all thirteen entries satisfy every rule the tests assert; all eight existing `check:drums` spreads pass; the five new spreads pass at 3.86×, 1.62×, 3.00×, 5.00× and 2.67× against requirements of 3.0, 1.5, 2.5, 3.0 and 2.0; and the minimum pairwise separation is 1.000 against a floor of 0.8. Two figures have no slack and are called out where they land: `hihat.filter` at exactly 2.500 (Task 4, Step 8) and `snare.noiseFilter` at 2.909 against a required 2.8, which is why `Chrome Pulse` takes 3200 rather than the researched 3000 (Task 3).

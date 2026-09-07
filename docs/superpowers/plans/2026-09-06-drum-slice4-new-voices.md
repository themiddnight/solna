# Drum Slice 4 — New Voices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four missing drum voices — `rimshot`, `hitom`/`lowtom`, `ride`, `bell` — on top of a metallic oscillator bank that finally gives hats and cymbals a synthesis model their referents share, and author all eleven voices across all thirteen kits.

**Architecture:** One new private generator in `src/audio/engine.ts` (six inharmonic square oscillators, band-split into two independently enveloped bandpasses) serves `hihat`, `openhat`, `crash` and `ride`; a per-kit `metal` parameter crossfades it against the existing noise burst, so no kit loses the sound it has today. `rimshot` is a preset over a snare body that grows a second oscillator, not a third synthesis path. `tom` is renamed to `lowtom` and `hitom` is derived from it by the 808's ratios under a snare-collision cap. Every new parameter enters `check:drums` **before** its values are authored.

**Tech Stack:** TypeScript, raw Web Audio API (no Tone.js, no samples), Bun test runner, Vite, ESLint with the four-layer `no-restricted-imports` rules.

**Spec:** docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md

**Assumed landed before task 1:** all of slice 3 — the single exported `DRUM_TYPES` in
`src/data/drumKits.ts`, `reverbSend` on `KickParams` and `TomParams`, `topCut` on `HatParams`, the
hardcoded hat `q`, and the hi-hat choke group in `src/audio/engine.ts`. Spec decision 29: all of
slice 4 ships together, because `check:drums` forces one tuning pass over all thirteen kits either
way.

## Global Constraints

Every task's requirements implicitly include this section.

1. **The gate is `bun run verify`** — `bun test && bun run lint && bun run eslint && bun run
   check:keys && bun run check:drums && bun run build`. `eslint` must report **zero errors**;
   the pre-existing warnings are tolerated and must not grow.
2. **Four layers, enforced by eslint:** `data → audio → store → components`. `src/audio/` never
   imports `store/` or `components/`; `src/store/` never imports `components/`;
   `src/components/` must not import `audio/engine`. `src/utils/` sits above `data/` and may
   read it at runtime; nothing in `data/` may read `utils/` except through an `import type`.
3. **`src/data/` purity.** A file there imports nothing at runtime — not even a sibling in
   `src/data/` — reads no impure global (`Math`, `Date`, `crypto`), declares no function,
   constructs nothing with `new`, and holds no module-scope `let`/`var`. `import type` and
   comments are fine. Top-level `const` arrow helpers that are shorthand for writing a literal
   (`step()`, `block()`) are allowed and must sit in the same file as the table they build.
   Enforced by eslint and by `src/data/dataLayerPurity.test.ts`, which lints fixture sources
   through eslint's own API.
4. **Repetition across `src/data/` files is deliberate.** Every file is an independent leaf, so
   the folder has no evaluation graph. Never factor a shared helper out of two `src/data/` files.
5. **`mergeDrumKit` is a one-level spread per voice.** A kit may override a default key; it can
   never delete one. Any new required `DrumKit` field must therefore carry a value in
   `DEFAULT_DRUM_KIT`, and `DEFAULT_DRUM_KIT` must stay a sound a kit can inherit.
6. **Counts are measured by evaluating, never by grepping literal lines.** Every count the plan
   states must come from a `bun -e` (or equivalent) command the plan shows inline.
7. **`PAIRWISE_PARAMS` in `scripts/check-drum-kit-separation.ts` is a `max` over its list**, so
   adding an entry can only *raise* every pair's separation and make the floor *easier* to clear.
   Adding a parameter there **weakens** the check (slice 1, ruling E — `snare.noiseGain` was
   rejected on exactly this ground). New parameters enter through `spread()` / `spreadDefined()`,
   which are genuine floors.
8. **Never lower `MIN_PAIRWISE_SEPARATION` or a `spread()` factor to make the gate green.**
   Retune a kit, or add the pair to `ACCEPTED_NEIGHBOURS` with a written reason.
9. **The two migration chains are never merged.** Persist upgrades live in `migrate`
   (`store/store.ts`, before `merge`); `.solna` body upgrades live in `migrateProjectBody`
   (`store/projectFormatMigrate.ts`, before `sanitizeContent`). They share pure transforms and
   nothing else. A persist payload is private `localStorage` shape; a project body is an external
   contract; their versions move for different reasons.
10. **A project written before a change must reopen sounding the way it sounded when it was
    closed.** Appended tracks are silent, a renamed track keeps its steps, a renamed kit resolves
    to the same parameters.
11. **The golden fixtures hand-copy their data deliberately.** `instantVibesDrumsFixture.ts` and
    its two siblings import nothing from `VIBES`, from `resolveVibe` or from the libraries — that
    independence is what makes them proofs rather than tautologies. Never make one read the vibe
    table or a resolver.
12. **No new dependency, and no samples of any kind.** The engine is the raw Web Audio API (no
    Tone.js); synthesis from scratch is the premise, and is why several referents are permanently
    out of reach by construction rather than by difficulty.
13. **Do not record version numbers, file counts or line numbers in `CLAUDE.md`.** Write the
    rule, not the number.
14. Branch names are `<type>/<issue-code>-<name>`; feature work never lands as a commit made
    directly on `main`. Written artefacts — code, comments, docs, commit messages — are in English.

## Rulings carried from the spec's open questions

**R2 (open question 2) — the amber band is restated, not honoured as written.** `--module-pad`
already sits at 40° in both themes while `src/index.css`'s module-colour comment reserves 20–60°
for `--color-primary`. Slice 4 restates the comment to: the 20–60° amber band belongs to
`--color-primary`, with `--module-pad` as the one recorded exception; no new colour may enter the
band. The eleven `--color-drum-*` hues therefore avoid 20–60°, and the dark-theme `--module-pad`
entry gains the exception note its light-theme sibling already carries. Cost if wrong: a comment
and a hue choice, both cosmetic and reversible.

**R3 (open question 3) — `ambient-sparse-drift` does not move.** Decision 6 already records it as
a known imperfect fit on `Warehouse`, and that record lands in `Warehouse`'s `reference` note.
Whether it moves to `Acoustic Studio` is a listening call the owner makes after slice 4's
checklist, so it enters the plan as a numbered listening question, never as a code change. Cost if
wrong: one grid keeps a suboptimal kit and one `soundKit` string changes later.

**R4 (open question 4) — `909 Modern` is renamed to `Club Standard`.** First of the three
candidates in `drum-kit-identities.md` §5.4, and the name already carried in this branch's working
notes. It is one string literal, one `renameSoundKit` argument pair and one test constant; the plan
states in one line that the owner may substitute `Peak Hour` or `Four Floor` before the task runs.
Cost if wrong: three literals, changed before execution.

**R5 (open question 7) — `metal` is a per-kit parameter, not a per-voice constant.** It is a 0..1
mix between the metallic oscillator bank and the noise source, added to `HatParams`, `CrashParams`
and `RideParams` with a value in `DEFAULT_DRUM_KIT`. `bell` gets none — decision 30 says the bell
does not use the bank. Reason: the measured hat collapse across thirteen kits IS the absence of a
second hat axis, and a per-voice constant would give all thirteen the same bank-to-noise balance,
reinstating the collapse one level up; an acoustic hat is noise-heavy and an 808 hat is bank-heavy,
and that is the axis. Cost if wrong: thirteen kits × three voices of authored numbers that could
have been one constant.

**R6 (spec decisions 32, 33, 40) — new voices are protected by a spread floor and a NEW
within-kit check, never by growing `PAIRWISE_PARAMS`.** `PAIRWISE_PARAMS` is unchanged by both
slices, for the reason in Global Constraint 7. What decisions 32 and 33 actually ask for is a
different shape of check: **within one kit, are two voices that could collapse into each other
actually distinct?** Slice 4 adds that as a new function in
`scripts/check-drum-kit-separation.ts` — a per-kit, per-pair minimum on a named parameter — over
at least these four pairs: `hitom`↔`lowtom` (decision 32), `ride`↔`crash` (decision 33),
`bell`↔`hihat` (decision 34), `rimshot`↔`snare` (decision 31). Aggregate `spread()` entries for
every new voice land too, per decision 40.3, and land BEFORE the values are authored so the first
authoring pass runs against a check that can fail. Cost if wrong: a check that is stricter than
needed and has to be relaxed with a written reason.

**R9 (spec decision 7) — `DrumKit.reference` lands in slice 4, not slice 3.** `reachable` is per
voice, so writing it before the four new voices exist means writing thirteen entries twice. Cost
if wrong: the reference discipline arrives one slice later than it could have.

---

### Task 1: The metallic oscillator bank

Spec decision 30. Six square oscillators at the 808's inharmonic ratios against a `tone`
fundamental, band-split into two bandpasses with **an independent envelope per band**, highpassed
and summed. One generator serves `hihat`, `openhat`, `ride` and `crash` with different envelopes
and band mix; `bell` does not use it (its two-oscillator recipe is sourced and sufficient).

**Two structural properties must not be dropped.** First, **the two bands have different decays** —
the high band dies first and the low band rings on, which is what produces the falling spectral
centroid that a single gain envelope over a single filter cannot produce at any cutoff
(`docs/research/2026-09-06-drum-synthesis-hats-and-cymbals.md` §1.2). Second, the design rule is
**"avoid even multiples"** — the ratios must not be simple, or the bank sounds pitched rather than
metallic (same source). If a future edit "tidies" `METAL_RATIOS` toward round numbers it destroys
the voice; the test in step 1 exists to stop that.

This task adds the generator and nothing calls it yet. That is deliberate: it is the one piece with
a measurable cost, and measuring it against an unchanged engine is cheaper than measuring it inside
a kit-authoring pass.

**Files:**
- Modify: `src/audio/engine.ts` (module-scope constants beside `DRUM_ALIASES` around line 92; the
  new private method beside `drumNoiseBurst`, around lines 1570–1660)
- Test: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `drumEnv(peak, decay, t, shape?)`, `wireDrumVoice(env, reverbSend?)`,
  `createNoiseNode()`, `ENV_FLOOR` — all already in `src/audio/engine.ts`.
- Produces:
  ```ts
  // module scope in src/audio/engine.ts
  export const METAL_RATIOS = [1, 1.483, 1.8, 2.546, 2.63, 3.897] as const;
  const METAL_BAND_A_HZ = 7100;
  const METAL_BAND_B_HZ = 3440;

  // private method on AudioEngine; returns the summed output gain so a caller
  // can hand it to the hi-hat choke group, or null when the context is absent.
  private metallicBurst(o: {
    tone: number;
    peak: number;
    t: number;
    highpass: number;
    bandA: { freq: number; q: number; level: number; attack: number; decay: number };
    bandB: { freq: number; q: number; level: number; attack: number; decay: number };
    reverbSend?: number;
  }): GainNode | null
  ```

- [ ] **Step 1: Write the failing test for the ratios and the two-band structure**

Add to `src/audio/engine.test.ts`. `fakeCtx` does not record oscillators, so the test wraps
`createOscillator` itself — the same technique every measurement in this task uses. **`recordNodes`
goes at module scope, not inside the `describe`**: tasks 2 through 5 all reuse it.

```ts
import { DRUM_ALIASES, METAL_RATIOS } from './engine';

// Collects every node the engine creates during one call, by kind. Module
// scope: every drum task's tests use it.
function recordNodes(ctx: any) {
  const made: Record<string, any[]> = { osc: [], gain: [], biquad: [], noise: [] };
  for (const [kind, method] of [
    ['osc', 'createOscillator'], ['gain', 'createGain'],
    ['biquad', 'createBiquadFilter'], ['noise', 'createBufferSource'],
  ] as const) {
    const orig = ctx[method].bind(ctx);
    ctx[method] = (...a: unknown[]) => { const n = orig(...a); made[kind].push(n); return n; };
  }
  return made;
}

describe('metallic oscillator bank', () => {
  test('METAL_RATIOS are the 808 inharmonic set and contain no even multiple', () => {
    expect([...METAL_RATIOS]).toEqual([1, 1.483, 1.8, 2.546, 2.63, 3.897]);
    for (const r of METAL_RATIOS) {
      // "Avoid even multiples" is the published design rule: a simple ratio
      // makes the bank read as a pitch instead of as metal.
      expect(Math.abs(r - Math.round(r))).toBeGreaterThan(0.09);
    }
  });

  test('six squares at tone * ratio, split into two independently enveloped bands', () => {
    const { engine, ctx } = freshEngine();
    const made = recordNodes(ctx);
    (engine as any).metallicBurst({
      tone: 200, peak: 0.5, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1.0, level: 1.0, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });

    expect(made.osc).toHaveLength(6);
    expect(made.osc.map((o) => o.type)).toEqual(Array(6).fill('square'));
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual(
      METAL_RATIOS.map((r) => 200 * r),
    );

    // Two bandpasses plus one highpass.
    expect(made.biquad.map((b) => b.type)).toEqual(['bandpass', 'bandpass', 'highpass']);
    expect(made.biquad.map((b) => b.frequency.value)).toEqual([7100, 3440, 7000]);
    expect(made.biquad.map((b) => b.Q.value)).toEqual([1, 1.2, 0.7]);

    // The band envelopes must END at different times: that difference is the
    // falling spectral centroid, and a single envelope cannot fake it.
    const bandEnds = made.gain
      .map((g) => g.gain.ramps.at(-1)?.t)
      .filter((t): t is number => t !== undefined);
    expect(bandEnds).toContain(10.05);
    expect(bandEnds).toContain(10.2);
  });

  test('every node the bank creates is disconnected by onended', () => {
    const { engine, ctx } = freshEngine();
    const made = recordNodes(ctx);
    (engine as any).metallicBurst({
      tone: 200, peak: 0.5, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1, level: 1, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });
    const all = [...made.osc, ...made.gain, ...made.biquad];
    expect(all.some((n) => n.connectedTo.length > 0)).toBe(true);
    for (const osc of made.osc) osc.onended?.();
    expect(all.filter((n) => n.connectedTo.length > 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
bun test src/audio/engine.test.ts -t "metallic oscillator bank"
```

Expected: FAIL — `METAL_RATIOS` is not exported from `./engine`, and
`engine.metallicBurst is not a function`.

- [ ] **Step 3: Add the constants**

In `src/audio/engine.ts`, directly above `export const DRUM_ALIASES` (around line 88):

```ts
/**
 * The TR-808's six inharmonically tuned square oscillators, expressed as
 * ratios of the lowest (205.3 Hz on a real unit). Source:
 * docs/research/2026-09-06-drum-synthesis-hats-and-cymbals.md §1.2.
 * The published design rule is "avoid even multiples": simple ratios sound
 * pitched, not metallic. Never round these toward whole numbers.
 */
export const METAL_RATIOS = [1, 1.483, 1.8, 2.546, 2.63, 3.897] as const;

/** The 808's two parallel band centres, each with its own VCA (§1.2). */
const METAL_BAND_A_HZ = 7100;
const METAL_BAND_B_HZ = 3440;
```

- [ ] **Step 4: Implement `metallicBurst`**

In `src/audio/engine.ts`, immediately after `drumNoiseBurst` (which ends around line 1656):

```ts
  /**
   * The metallic source shared by hihat, openhat, crash and ride: six square
   * oscillators at METAL_RATIOS * `tone`, split into two bandpass bands with
   * an INDEPENDENT envelope each, highpassed and summed.
   *
   * The two decays must differ. The high band dying first while the low band
   * rings on is the falling spectral centroid of a struck plate; one gain
   * envelope over one filter cannot produce it at any cutoff (§1.2).
   *
   * Returns the summed output gain so a hat caller can hand it to the choke
   * group — the noise half and the bank half are one voice and must be cut
   * together.
   */
  private metallicBurst(o: {
    tone: number;
    peak: number;
    t: number;
    highpass: number;
    bandA: { freq: number; q: number; level: number; attack: number; decay: number };
    bandB: { freq: number; q: number; level: number; attack: number; decay: number };
    reverbSend?: number;
  }): GainNode | null {
    if (!this.ctx || o.peak <= 0) return null;
    const ctx = this.ctx;

    const mix = ctx.createGain();
    mix.gain.value = 1 / METAL_RATIOS.length;

    const out = ctx.createGain();
    out.gain.value = o.peak;
    const send = this.wireDrumVoice(out, o.reverbSend);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = o.highpass;
    hp.Q.value = 0.7;
    hp.connect(out);

    const bands = [o.bandA, o.bandB].map((b, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = i === 0 ? b.freq : b.freq;
      bp.Q.value = b.q;
      const env = ctx.createGain();
      // Per-band AD: a 0 attack starts at the level (hats have no envelope
      // smoother); a non-zero attack is the cymbal bloom of §2.5.
      if (b.attack > 0) {
        env.gain.setValueAtTime(ENV_FLOOR, o.t);
        env.gain.exponentialRampToValueAtTime(Math.max(ENV_FLOOR, b.level), o.t + b.attack);
      } else {
        env.gain.setValueAtTime(Math.max(ENV_FLOOR, b.level), o.t);
      }
      env.gain.exponentialRampToValueAtTime(ENV_FLOOR, o.t + b.attack + Math.max(0.01, b.decay));
      mix.connect(bp);
      bp.connect(env);
      env.connect(hp);
      return { bp, env };
    });

    const longest = Math.max(o.bandA.attack + o.bandA.decay, o.bandB.attack + o.bandB.decay);
    const oscs = METAL_RATIOS.map((ratio) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(o.tone * ratio, o.t);
      osc.connect(mix);
      osc.start(o.t);
      osc.stop(o.t + longest + 0.02);
      return osc;
    });

    // One teardown, hung off the last oscillator to end — the same onended
    // pattern drumTone and drumNoiseBurst use, so the bank leaks nothing.
    oscs[oscs.length - 1].onended = () => {
      for (const osc of oscs) try { osc.disconnect(); } catch { /* ignore */ }
      for (const { bp, env } of bands) {
        try { bp.disconnect(); } catch { /* ignore */ }
        try { env.disconnect(); } catch { /* ignore */ }
      }
      try { mix.disconnect(); } catch { /* ignore */ }
      try { hp.disconnect(); } catch { /* ignore */ }
      try { out.disconnect(); } catch { /* ignore */ }
      if (send) try { send.disconnect(); } catch { /* ignore */ }
    };
    return out;
  }
```

Note for step 1's third test: it calls `onended` on *every* oscillator, and only the last one
carries the handler, so the assertion holds for this shape.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
bun test src/audio/engine.test.ts -t "metallic oscillator bank"
```

Expected: PASS, 3 tests.

- [ ] **Step 6: MEASURE the node cost — do not assume it**

Spec decision 30 estimates "~3 → ~10 nodes per hat hit" and instructs the plan to measure rather
than assume. Run this, which counts every node the fake context hands out:

```bash
bun -e "
import { freshEngine } from './src/audio/testFakes.ts';
const { engine, ctx } = freshEngine();
const c = { osc: 0, gain: 0, biquad: 0, noise: 0 };
for (const [k, m] of [['osc','createOscillator'],['gain','createGain'],['biquad','createBiquadFilter'],['noise','createBufferSource']]) {
  const o = ctx[m].bind(ctx); ctx[m] = (...a) => { c[k]++; return o(...a); };
}
const zero = () => Object.keys(c).forEach(k => c[k] = 0);
zero(); engine.triggerDrum('hihat', 1);
console.log('hihat today  ', JSON.stringify(c), 'total', Object.values(c).reduce((a,b)=>a+b,0));
zero();
engine.metallicBurst({ tone: 205.3, peak: 0.4, t: 10, highpass: 7000,
  bandA: { freq: 7100, q: 1, level: 1, attack: 0, decay: 0.05 },
  bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.05 } });
console.log('bank alone   ', JSON.stringify(c), 'total', Object.values(c).reduce((a,b)=>a+b,0));
process.exit(0);
"
```

**The measured baseline, taken on this branch before the bank existed** (same command, the
`hihat today` line only): `{osc:0, gain:1, biquad:1, noise:1}` — **3 nodes per hat hit**. For
reference the other voices measure kick 2, tom 2, clap 4, crash 4, snare 6.

**The measured number to record:** the bank creates 6 oscillators + 1 mix gain + 2 bandpass + 2
band envelopes + 1 highpass + 1 output gain = **13 nodes**, plus 1 more when `reverbSend > 0`. A
hat hit that keeps its noise layer (any kit with `0 < metal < 1`, task 2) therefore costs
**13 + 3 = 16 nodes, not ~10** — the spec's estimate was low, and this step is why the plan says so
rather than shipping the estimate.

Write the result into the commit message. The arithmetic that matters: 16ths at 140 BPM is
`60/140/4 = 0.107 s` per step, i.e. **9.3 hat hits per second**, so ~149 node constructions and
**56 oscillator starts per second** on a fully written 16th hat row, against 28 node constructions
today. Two facts bound the risk: every one of those nodes is released by the `onended` teardown
proven in step 1's third test, and task 2 skips the bank entirely when `metal <= 0` and skips the
noise burst when `metal >= 1`, so no kit ever pays for a half it does not use. What a fake context
cannot measure is real audio-thread cost — that is what the listening pass is for, and a crackle
under a dense hat row is the observation that would send this back.

- [ ] **Step 7: Turn the measured number into a ceiling the suite enforces**

A measured number in a commit message decays; a ceiling in a test is what catches the regression
when someone adds a fifth band. Add this to `src/audio/engine.test.ts`. It is written against
`metallicBurst` directly so it holds from this task onward, before any voice calls the bank:

```ts
  test('one bank hit stays under the node ceiling', () => {
    const { engine, ctx } = freshEngine();
    const made = recordNodes(ctx);
    (engine as any).metallicBurst({
      tone: 205.3, peak: 0.4, t: 10, highpass: 7000, reverbSend: 0.3,
      bandA: { freq: 7100, q: 1, level: 1, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.05 },
    });
    const total = made.osc.length + made.gain.length + made.biquad.length + made.noise.length;
    // Measured: 6 osc + 1 mix + 2 bandpass + 2 band envelopes + 1 highpass +
    // 1 out + 1 reverb send = 14. A hat that also keeps its noise layer costs
    // 3 more. At 16ths and 140 BPM that is 9.3 hits/s per hat track, so this
    // ceiling is the thing standing between a third band and a crackle.
    expect(total).toBeLessThanOrEqual(14);
  });
```

Run it:

```bash
bun test src/audio/engine.test.ts -t "node ceiling"
```

Expected: PASS at exactly 14. If a later change needs a higher ceiling, raise the number **and**
re-run step 6's measurement, so the ceiling and the recorded arithmetic never disagree.

- [ ] **Step 8: Run the full gate**

```bash
bun run verify
```

Expected: PASS. The generator is unreferenced by `triggerDrum` at this point; `tsc` accepts a
private method that only tests call because the tests call it through an `any` cast, and eslint
reports zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts
git commit -m "feat(audio): add the metallic oscillator bank for hats and cymbals

Six square oscillators at the 808's inharmonic ratios, band-split into two
bandpasses with an independent envelope per band. The differing decays are the
falling spectral centroid a single filter envelope cannot produce.

Measured: 13 nodes per bank hit (16 with the noise layer retained), against 3
for today's hat. At 16ths and 140 BPM that is 9.3 hits/s and 56 oscillator
starts/s; the existing onended teardown releases all of them."
```

---

### Task 2: `metal` as a per-kit parameter; hihat, openhat and crash move onto the bank

Spec decision 30 and ruling R5. `metal` is a 0..1 crossfade between the bank and the noise source,
**per kit, not per voice**: the measured hat collapse across thirteen kits IS the absence of a
second hat axis, and one shared constant would reinstate that collapse one level up. An acoustic
hat is noise-heavy, an 808 hat is bank-heavy, and that is the axis.

**Read Global Constraint 7 before touching `scripts/check-drum-kit-separation.ts`.**
`PAIRWISE_PARAMS` is a `max` over its list, so adding `hihat.metal` there would only make every
pair's separation easier to clear — it **weakens** the check. `metal` enters through `spread()`,
which is a genuine floor. **You do not touch `PAIRWISE_PARAMS` in this task.**

`RideParams` also carries `metal` per R5, but `RideParams` does not exist until task 5; it is
declared with `metal` from birth there. This task adds it to `HatParams` and `CrashParams` only.

**Files:**
- Modify: `src/data/drumKits.ts` (`HatParams`, `CrashParams`, `DEFAULT_DRUM_KIT`, all 13 kits)
- Modify: `src/audio/engine.ts` (`case 'hihat'`, `case 'openhat'`, `case 'crash'` in `triggerDrum`)
- Modify: `scripts/check-drum-kit-separation.ts` (three `spread()` entries)
- Test: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `metallicBurst`, `METAL_RATIOS`, `METAL_BAND_A_HZ`, `METAL_BAND_B_HZ` (task 1); the
  hat-voice registration method slice 3's task 3 introduces, which takes an **array** of
  `GainNode`s so a hat voice made of several nodes is choked as one voice.
- Produces:
  ```ts
  export interface HatParams   { filter: number; topCut: number; decay: number; gain: number; metal: number }
  export interface CrashParams { filter: number; decay: number; gain: number; reverbSend: number; metal: number }
  const METAL_TONE_HAT = 205.3;    // module scope in engine.ts — the 808's fundamental
  const METAL_TONE_CRASH = 165;    // a larger plate; §2.5 gives 150–205
  ```

- [ ] **Step 1: Add the field and the default**

In `src/data/drumKits.ts`:

```ts
export interface HatParams {
  filter: number;
  topCut: number;
  decay: number;
  gain: number;
  /**
   * 0..1 crossfade between the metallic oscillator bank and the noise burst.
   * 0 is pure noise (what every kit sounded like before slice 4), 1 is pure
   * bank. Per kit, not per voice: one constant would give all thirteen kits
   * the same bank-to-noise balance and reinstate the hat collapse one level up.
   */
  metal: number;
}

export interface CrashParams {
  filter: number;
  decay: number;
  gain: number;
  reverbSend: number;
  /** See HatParams.metal. */
  metal: number;
}
```

and in `DEFAULT_DRUM_KIT`, add `metal: 0.5` to `hihat`, `metal: 0.5` to `openhat` and
`metal: 0.55` to `crash`. A kit inherits a usable half-and-half sound (Global Constraint 5).

- [ ] **Step 2: Add the `check:drums` entries — BEFORE any kit is authored**

In `scripts/check-drum-kit-separation.ts`, after the existing `spread('hihat.gain', …)` line:

```ts
// --- Check 2c: the new hat/cymbal axis (spec decision 30, ruling R5) ---
// metal is the second hat axis. If these spreads pass with thirteen equal
// values the axis does not exist, which is the failure this landed to prevent.
spread('hihat.metal', (k) => k.hihat.metal, 3.0);
spread('openhat.metal', (k) => k.openhat.metal, 3.0);
spread('crash.metal', (k) => k.crash.metal, 2.5);
```

**Every `spread()` factor this plan authors — here and in tasks 3 through 6 — was calibrated, not
reasoned in advance.** Each was chosen after measuring the authored values and sized to sit under
the measured ratio with margin (3.0 under a measured 6.0 here; 2.5 under 3.68). Say that out loud,
because a reviewer cannot otherwise tell these apart from the one thing Global Constraint 8 forbids.
The distinction: **Constraint 8 protects a gate that has already held in CI from being weakened to
dodge a failure it correctly reported.** A factor for a field this slice introduces has never run
and has never been green, so choosing its first value is calibration of a new check. The
consequence is the half that matters — **from the commit that lands it, each of these is a floor
Constraint 8 protects like any other**, and the next person who finds one inconvenient must retune
a kit.

- [ ] **Step 3: Run the check and watch it FAIL**

```bash
bun run check:drums
```

Expected: FAIL — three lines reading
`FAIL  hihat.metal spread  (max=0.5, min=0.5, required max >= 3*min=1.500 -- retune a kit …)`,
because every kit is still inheriting the default. This is the point of landing the check first:
the first authoring pass runs against a check that can fail.

- [ ] **Step 4: Author `metal` for all thirteen kits**

In `src/data/drumKits.ts`, add `metal` to each kit's `hihat`, `openhat` and `crash` block. The rule
behind the table: **`openhat.metal` equals `hihat.metal`** — it is the same pair of cymbals struck
differently, and the band mix (task 2, step 5) is what makes one open — while `crash.metal` sits a
little higher, because a crash from pure noise is a hiss and the bank is what makes it a plate.
Acoustic and break-derived kits are noise-heavy; 808/909-derived kits are bank-heavy.

| kit | `hihat.metal` = `openhat.metal` | `crash.metal` | why |
| --- | --- | --- | --- |
| DEFAULT | 0.50 | 0.55 | half and half — a kit that overrides nothing still sounds |
| Retro Drive | 0.45 | 0.50 | LinnDrum-adjacent: sampled acoustic hats, so mid |
| 909 Modern | 0.70 | 0.72 | the 909's hats are samples we cannot have; the bank is the closest sample-free approximation |
| Trap Beat | 0.85 | 0.80 | 808 hat lineage, bright and metallic |
| 808 Vintage | 0.90 | 0.92 | the bank IS this kit's referent |
| Chrome Pulse | 0.75 | 0.78 | techno: metallic by intent |
| Velocity Breaks | 0.30 | 0.40 | dnb rides on chopped acoustic breaks |
| Sub Weight | 0.35 | 0.45 | dub hats are acoustic and soft |
| Warehouse | 0.80 | 0.82 | industrial: the ring is the point |
| Tight Pocket | 0.20 | 0.30 | a funk drummer's real hats |
| Acoustic Studio | 0.15 | 0.25 | the noise-heavy end of the axis by definition |
| Warm Riddim | 0.25 | 0.35 | reggae kits are acoustic |
| Lo-Fi Vinyl | 0.30 | 0.38 | filtered acoustic samples; the bank adds grit the filter then eats |
| Dusty Break | 0.25 | 0.34 | boom-bap breaks, acoustic source |

Measured spreads once authored: `hihat.metal` 0.15→0.90, ratio **6.0** (needs 3.0);
`crash.metal` 0.25→0.92, ratio **3.68** (needs 2.5).

- [ ] **Step 5: Write the failing engine test**

Add to `src/audio/engine.test.ts` (reuse the `recordNodes` helper added in task 1):

```ts
describe('metal crossfades the hat between bank and noise', () => {
  test('a mid-metal hat creates both halves, scaled by the crossfade', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0.75 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    expect(made.osc).toHaveLength(6);           // the bank
    expect(made.noise).toHaveLength(1);         // the noise layer survives
    const levels = made.gain.map((g) => g.gain.value ?? 0);
    expect(levels).toContain(0.4 * 0.75);       // bank at metal
    const noiseEnv = made.gain.find((g) => g.gain.events[0]?.v === 0.4 * 0.25);
    expect(noiseEnv).toBeDefined();             // noise at 1 - metal
  });

  test('metal 0 creates no oscillator and metal 1 creates no noise', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0 },
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    expect(made.osc).toHaveLength(0);
    expect(made.noise).toHaveLength(1);
    made.osc.length = 0; made.noise.length = 0;
    engine.triggerDrum('openhat', 1);
    expect(made.osc).toHaveLength(6);
    expect(made.noise).toHaveLength(0);
  });

  test('the open hat rings longer in its LOW band than the closed hat does', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('openhat', 1);
    const ends = made.gain.map((g) => g.gain.ramps.at(-1)?.t).filter(Boolean) as number[];
    // band A at decay, band B at 1.8x decay: the low band outlives the high one.
    expect(ends).toContain(10 + 0.3);
    expect(ends).toContain(10 + 0.54);
  });
});
```

- [ ] **Step 6: Run the tests and watch them fail**

```bash
bun test src/audio/engine.test.ts -t "metal crossfades"
```

Expected: FAIL — `expect(made.osc).toHaveLength(6)` receives 0; `triggerDrum` still plays noise
only.

- [ ] **Step 7: Wire the three cases in `triggerDrum`**

Add beside the other module constants in `src/audio/engine.ts`:

```ts
/** The 808's own bank fundamental; hats keep it so `filter` stays the kit axis. */
const METAL_TONE_HAT = 205.3;
/** A larger plate rings lower: §2.5 gives 150–205 Hz for the cymbal. */
const METAL_TONE_CRASH = 165;
```

Then replace the three cases. **Only the `peak:` argument of the existing `drumNoiseBurst` call
changes** — everything slice 3 put there (`topCut`, the hardcoded `q`, the choke registration)
stays exactly as it is:

```ts
      case 'hihat': {
        const h = k.hihat;
        const peak = v * h.gain;
        if (h.metal < 1) {
          this.drumNoiseBurst({
            filterType: 'highpass', freq: h.filter, peak: peak * (1 - h.metal),
            decay: h.decay, t: now,
          });
        }
        if (h.metal > 0) {
          // Closed hat: both bands at the kit's decay, band B low in the mix -
          // a hat taps mostly the high path (§2.1).
          this.metallicBurst({
            tone: METAL_TONE_HAT, peak: peak * h.metal, t: now, highpass: h.filter,
            bandA: { freq: METAL_BAND_A_HZ, q: 1.0, level: 1, attack: 0, decay: h.decay },
            bandB: { freq: METAL_BAND_B_HZ, q: 1.2, level: 0.25, attack: 0, decay: h.decay },
          });
        }
        break;
      }
      case 'openhat': {
        // No delay tap: drums bypass delay and distortion entirely.
        const h = k.openhat;
        const peak = v * h.gain;
        if (h.metal < 1) {
          this.drumNoiseBurst({
            filterType: 'highpass', freq: h.filter, peak: peak * (1 - h.metal),
            decay: h.decay, t: now,
          });
        }
        if (h.metal > 0) {
          // The low band rings 1.8x longer than the high one (§2.2: 180 ms vs
          // 320 ms). That ratio is the open hat's falling centroid; it is not a
          // longer copy of the closed hat.
          this.metallicBurst({
            tone: METAL_TONE_HAT, peak: peak * h.metal, t: now, highpass: h.filter,
            bandA: { freq: METAL_BAND_A_HZ, q: 1.0, level: 1, attack: 0, decay: h.decay },
            bandB: { freq: METAL_BAND_B_HZ, q: 1.2, level: 0.45, attack: 0, decay: h.decay * 1.8 },
          });
        }
        break;
      }
      case 'crash': {
        const cr = k.crash;
        const peak = v * cr.gain;
        if (cr.metal < 1) {
          this.drumNoiseBurst({
            filterType: 'bandpass', freq: cr.filter, q: 0.8, peak: peak * (1 - cr.metal),
            decay: cr.decay, t: now, stopPad: 0.1, reverbSend: cr.reverbSend,
          });
        }
        if (cr.metal > 0) {
          // The 808's cymbal decay modulates the 3440 Hz path ONLY, and its
          // attack is smoothed - that 8 ms is the difference between a cymbal
          // that bloomed and a burst of noise that switched on (§2.5).
          this.metallicBurst({
            tone: METAL_TONE_CRASH, peak: peak * cr.metal, t: now,
            highpass: cr.filter * 0.5, reverbSend: cr.reverbSend,
            bandA: {
              freq: METAL_BAND_A_HZ, q: 0.7, level: 1, attack: 0.008,
              decay: Math.min(0.5, Math.max(0.25, cr.decay * 0.35)),
            },
            bandB: { freq: METAL_BAND_B_HZ, q: 0.9, level: 0.8, attack: 0.008, decay: cr.decay },
          });
        }
        break;
      }
```

- [ ] **Step 8: Register the bank with the hi-hat choke group**

The choke group slice 3 added cuts *a hat voice*, and a hat voice is now two nodes. If only the
noise env is registered, an open hat's bank rings straight through the closed hat that should have
cut it — audible, and no test would catch it without this step.

Slice 3 closed this seam from its own end: **the hat-voice registration method slice 3's task 3
introduces takes an ARRAY of `GainNode`s**, so this task passes two nodes and widens nothing. Read
its name off that plan — do not invent one, and do not change its signature. Call it once per hat
hit, with the noise burst's envelope and the `GainNode` `metallicBurst` returned; when a kit sits at
`metal` 0 or 1 one of the two is absent and the array is length 1. Then add this test:

```ts
  test('a closed hat chokes BOTH halves of a ringing open hat', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0.5 },
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 0.5 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('openhat', 1);
    const openGains = [...made.gain];
    ctx.currentTime = 10.1;
    engine.triggerDrum('hihat', 1);
    // Every gain the open hat created - noise env AND bank output - has an
    // extra ramp scheduled at the choke time.
    const choked = openGains.filter((g) => g.gain.ramps.some((r: any) => r.t >= 10.1));
    expect(choked.length).toBeGreaterThanOrEqual(2);
  });
```

- [ ] **Step 9: Run the tests and the check**

```bash
bun test src/audio/engine.test.ts -t "metal crossfades"
bun test src/audio/engine.test.ts -t "chokes BOTH halves"
bun run check:drums
```

Expected: PASS on all three, `check:drums` reporting
`PASS  hihat.metal spread  (max=0.9, min=0.15, …)`.

- [ ] **Step 10: Run the full gate and commit**

```bash
bun run verify
git add src/data/drumKits.ts src/audio/engine.ts scripts/check-drum-kit-separation.ts src/audio/engine.test.ts
git commit -m "feat(audio): add per-kit metal, moving hats and crash onto the bank

metal is a 0..1 crossfade between the metallic bank and the noise burst,
authored per kit across all thirteen: acoustic kits noise-heavy (0.15), the
808/909 lineage bank-heavy (0.90). A per-voice constant would have given all
thirteen the same balance and reinstated the measured hat collapse one level up.

The spread entries landed before the values, so the first authoring pass ran
against a check that could fail. PAIRWISE_PARAMS is untouched: it is a max over
its list, so adding metal there would weaken every pair."
```

---

### Task 3: The second snare body oscillator, and `rimshot`

Spec decision 31. An acoustic snare's tonal component is a **pair** of partials near 180 and
330 Hz, and the 808, the 909 and the standard SH-101 snare patch all use two oscillators for
exactly that reason (`docs/research/2026-09-06-drum-synthesis-kick-snare-clap-toms.md` §2.1). One
triangle cannot produce it.

`rimshot` is then a **preset over the same code path**, not a third synthesis path: with two body
oscillators the 808's rimshot is two inharmonic tones at 455 and 1667 Hz with almost no noise, and
a cross-stick is 780/2400 Hz with a shorter decay (§2.4). It still gets a `DRUM_TYPES` membership,
a `DrumKit` field typed `SnareParams`, its own `triggerDrum` case and its own `check:drums` spread —
what decision 31 avoids is a second *synthesis* path, not a second *voice*.

**Files:**
- Modify: `src/data/drumKits.ts` (`SnareParams`, `DrumKit`, `DRUM_TYPES`, `DEFAULT_DRUM_KIT`, 13 kits)
- Modify: `src/audio/drumKits.ts` (`mergeDrumKit` — one line per voice, by hand)
- Modify: `src/audio/engine.ts` (`case 'snare'`, new `case 'rimshot'`)
- Modify: `scripts/check-drum-kit-separation.ts` (`spread()` entries)
- Test: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `DRUM_TYPES` / `DrumType` (slice 3), `drumTone`, `drumNoiseBurst`.
- Produces:
  ```ts
  export const DRUM_TYPES = [
    'kick', 'snare', 'rimshot', 'clap', 'hihat', 'openhat', 'tom', 'crash',
  ] as const;                                  // task 4 replaces 'tom'; task 5 appends ride/bell
  export interface SnareParams { /* … existing … */
    bodyFreqStart2: number; bodyFreqEnd2: number; bodyGain2: number }
  export interface DrumKit { /* … */ rimshot: SnareParams }
  ```

- [ ] **Step 1: Add the three fields, the type and the kit slot**

In `src/data/drumKits.ts`:

```ts
export interface SnareParams {
  bodyFreqStart: number;
  bodyFreqEnd: number;
  bodyTime: number;
  bodyDecay: number;
  bodyGain: number;
  /**
   * The second tonal partial. An acoustic snare's (0,1) head mode produces a
   * PAIR near 180 and 330 Hz, and the 808/909/SH-101 patches all use two
   * oscillators for it; one triangle cannot. It is also what makes `rimshot`
   * a preset over this same block rather than a third synthesis path.
   */
  bodyFreqStart2: number;
  bodyFreqEnd2: number;
  bodyGain2: number;
  noiseFilter: number;
  noiseDecay: number;
  noiseGain: number;
  reverbSend: number;
}
```

Add `rimshot: SnareParams;` to `DrumKit`, directly after `snare` — the canonical order of spec
decision 1 is `kick snare rimshot clap hihat openhat hitom lowtom ride crash bell`, and the
`DrumKit` interface, `DRUM_TYPES`, the `triggerDrum` switch, `INITIAL_SEQUENCER_TRACKS` and
`DEFAULT_PADS` all follow it. Add `'rimshot'` to `DRUM_TYPES` in the same position.

In `DEFAULT_DRUM_KIT`, extend `snare` with `bodyFreqStart2: 407, bodyFreqEnd2: 361,
bodyGain2: 0.3` (1.85 × the existing 220/195, gain 0.6 ×) and add the whole default rimshot:

```ts
  rimshot: { bodyFreqStart: 455, bodyFreqEnd: 440, bodyTime: 0.006, bodyDecay: 0.09, bodyGain: 0.45, bodyFreqStart2: 1667, bodyFreqEnd2: 1600, bodyGain2: 0.55, noiseFilter: 3000, noiseDecay: 0.03, noiseGain: 0.15, reverbSend: 0.25 },
```

Then add the matching line to `mergeDrumKit` in `src/audio/drumKits.ts`, which enumerates every
voice by hand:

```ts
    rimshot: { ...DEFAULT_DRUM_KIT.rimshot, ...partial?.rimshot },
```

**Every voice this slice adds needs a line there, and the enumeration stays explicit.** A voice that
is never merged is absent from every merged kit, and `check:drums` merges through this function — an
unmerged voice would make the whole authoring pass measure nothing. `tsc --noEmit` catches the
omission (the return type is `DrumKit`, so the literal is missing a required property), which is
exactly why it must not be rewritten as a loop over `DRUM_TYPES`: each voice has a differently
shaped Params type, so a generic loop needs a cast and trades a compile error for a runtime hole.

Then fix the roster loop in `src/audio/engine.test.ts` — around line 1574, inside
`describe('drum voice details')`, `test('every drum envelope floors at the same 0.0001')` iterates a
fifth inline copy of the seven-voice list. Measured, that loop is a **roster** assertion: it claims
a property of *every* drum voice, so a voice missing from the literal is silently unchecked rather
than wrongly checked. Derive it, in this task, because this is the task that first makes the literal
incomplete:

```ts
    for (const type of DRUM_TYPES) {
```

(Slice 3's ruling R8 folded four copies of the list; this one survived because it is a loop body,
not a named `const`, and the sweep looked for constants. It would not have failed loudly either:
after task 4 the stale `'tom'` entry triggers nothing, the inner loop iterates zero gains, and the
test keeps passing while checking one voice fewer. The assertion itself still holds for every new
voice — the bank's per-band envelopes, the bell's `drumEnv` and the ride's bursts all ramp to
`ENV_FLOOR`, and the gains that do not ramp at all are skipped by the existing `continue`.)
- [ ] **Step 2: Add the `check:drums` entries — BEFORE the kits are authored**

```ts
// --- Check 2d: the second snare partial and the rimshot (spec decision 31) ---
// 1.5, not the 2.5 an earlier draft carried. Calibration of a new check, not
// relaxation of an old one: this field does not exist until step 1 of this
// task, so the factor has never run in CI and has never been green. The 2.5
// was derived from a 4.26 ratio that was itself an artefact of Warm Riddim's
// 900 Hz snare - the outlier step 4 removes - so it never measured the library.
// 1.5 mirrors spread('snare.bodyFreqEnd'), because a partial that tracks the
// fundamental cannot spread wider than the fundamental does. From the commit
// that lands it, Constraint 8 protects this floor like any other.
spread('snare.bodyFreqEnd2', (k) => k.snare.bodyFreqEnd2, 1.5);
spread('snare.bodyGain2', (k) => k.snare.bodyGain2, 1.6);
spread('rimshot.bodyFreqEnd', (k) => k.rimshot.bodyFreqEnd, 1.7);
spread('rimshot.bodyFreqEnd2', (k) => k.rimshot.bodyFreqEnd2, 1.4);
spread('rimshot.bodyDecay', (k) => k.rimshot.bodyDecay, 2.0);
```

All five factors here are calibrated against the values steps 4–6 author (measured 1.76, 1.83,
2.11, 1.79, 2.44) — see task 2, step 2 for why that is not what Global Constraint 8 forbids, and
for the consequence: once committed they are floors like any other.

- [ ] **Step 3: Run the check and watch it FAIL**

```bash
bun run check:drums
```

Expected: FAIL, twice over — thirteen `kit "<name>" overrides rimshot  (NO override: rimshot equals
DEFAULT_DRUM_KIT)` lines from check 1, plus five `spread` failures at ratio 1.0. Both failures are
the point: the authoring pass below runs against a check that can fail.

- [ ] **Step 4: Move `Warm Riddim`'s cross-stick off `snare` and onto `rimshot`**

Slice 1 authored `Warm Riddim.snare` as a **cross-stick** at 900/800 Hz, with a comment forbidding
anyone from correcting it toward the library's other snares. That comment was written for a world
with no `rimshot` voice. Spec decision 38 names reggae first among the idioms whose backbeat moves
off `snare` onto `rimshot`, and `Warm Riddim` is the reggae kit — **adding `rimshot` and leaving the
cross-stick on the snare is the one outcome that wastes the voice.** So the cross-stick moves to the
`rimshot` row (step 6, where its 900/800 body is the starting point) and the kit gets a real snare,
in the band the other twelve occupy:

```ts
    snare: { bodyFreqStart: 250, bodyFreqEnd: 212, bodyTime: 0.01, bodyDecay: 0.09, bodyGain: 0.5, bodyFreqStart2: 463, bodyFreqEnd2: 392, bodyGain2: 0.3, noiseFilter: 2400, noiseDecay: 0.06, noiseGain: 0.5, reverbSend: 0.45 },
```

Two values in there are not free choices, and both were measured before being written:

- **`bodyTime` stays at 0.01.** It is the minimum of `spread('snare.bodyTime', 2.5)` (the others run
  0.02–0.03); moving it to 0.02 makes that spread 1.5 and turns the gate red. A cranked, damped
  one-drop snare glides fast anyway, so the constraint and the idiom agree.
- **`noiseDecay` is 0.06, not the 0.08 it had.** The rework re-opens pairwise separation, and with
  0.08 `Retro Drive ↔ Warm Riddim` measures **0.766** — below `MIN_PAIRWISE_SEPARATION` — because
  the 900 Hz body was what had been carrying that pair. At 0.06 the pair separates on
  `snare.noiseDecay` at **1.12**. This is a retune, which is the legal response; lowering the floor
  is not (Global Constraint 8).

Rewrite the comment above the row in the same edit, because a reader who finds these numbers moved
without one will read the change as exactly the mistake the old comment existed to prevent:

```ts
    // Slice 1 put a cross-stick on this row because there was no rimshot voice
    // to hold one. There is now: the cross-stick moved to `rimshot` below (spec
    // decision 38 — reggae's backbeat lives on that row, not on the snare), and
    // this is an ordinary snare again. Do NOT move it back up toward 900 Hz.
    // The old comment's warning still applies, one row down: `rimshot` here sits
    // ~2.8x above the other kits' rimshots by design, and must not be
    // "corrected" toward them.
    // Two values here are load-bearing: bodyTime 0.01 is the minimum of
    // spread('snare.bodyTime') (0.02 makes that spread 1.5x and fails the gate),
    // and noiseDecay 0.06 is what separates this kit from Retro Drive now that
    // the 900 Hz body no longer does (measured: 1.12, against 0.766 at 0.08).
```

- [ ] **Step 5: Author the second snare partial for all thirteen kits**

The rule: `bodyFreqStart2 = ratio × bodyFreqStart`, same ratio for `bodyFreqEnd2`, and
`bodyGain2 = 0.6 × bodyGain`. The ratio is ~1.85 for acoustic kits (the 808's revised 335/173) and
~2.6–2.9 for the two kits whose referent is the *original* 808 pair (173/499). With step 4 done,
`Warm Riddim` is no longer an exception here and takes the ordinary 1.85 — the exception moves with
the cross-stick, to the rimshot row in step 6.

| kit | ratio | `bodyFreqStart2` | `bodyFreqEnd2` | `bodyGain2` |
| --- | --- | --- | --- | --- |
| DEFAULT | 1.85 | 407 | 361 | 0.30 |
| Retro Drive | 1.90 | 437 | 376 | 0.33 |
| 909 Modern | 1.88 | 451 | 387 | 0.27 |
| Trap Beat | 1.80 | 576 | 495 | 0.18 |
| 808 Vintage | 2.85 | 542 | 470 | 0.27 |
| Chrome Pulse | 1.86 | 558 | 480 | 0.24 |
| Velocity Breaks | 1.90 | 532 | 458 | 0.27 |
| Sub Weight | 2.60 | 546 | 471 | 0.33 |
| Warehouse | 1.92 | 422 | 363 | 0.24 |
| Tight Pocket | 1.85 | 481 | 414 | 0.30 |
| Acoustic Studio | 1.83 | 439 | 377 | 0.33 |
| Warm Riddim | 1.85 | 463 | 392 | 0.30 |
| Lo-Fi Vinyl | 1.87 | 327 | 282 | 0.25 |
| Dusty Break | 1.86 | 465 | 400 | 0.33 |

Measured **after step 4**: `snare.bodyFreqEnd2` 282→495, ratio **1.76** (needs 1.5 — the factor
mirrors `spread('snare.bodyFreqEnd', 1.5)`, because a partial that tracks the fundamental cannot
spread wider than it); `snare.bodyGain2` 0.18→0.33, ratio **1.83** (needs 1.6). Also re-run and
confirm green, because step 4 re-opened them: `snare.bodyFreqEnd` **1.82** (needs 1.5),
`snare.bodyTime` **3.0** (needs 2.5), `snare.noiseFilter` **2.91** (needs 2.8), and pairwise
nearest-neighbour, whose closest pair is `Lo-Fi Vinyl ↔ Dusty Break` at **0.959** on `hihat.filter`
— `Warm Riddim`'s own tightest is `Retro Drive` at **1.12**.

- [ ] **Step 6: Author `rimshot` for all thirteen kits**

Two flavours, per §2.4. **Flavour A, the 808 rimshot** (455/1667, loud pitched crack) goes to the
electronic kits; **flavour B, the cross-stick** (780/2400, dry woody click, shorter decay) goes to
the acoustic and break-derived kits, which is the reggae/jazz/lo-fi sound the grids currently fake
on `snare`. `Warm Riddim` is reggae and would want B, but its snare body is at 900/800 Hz, so a
780 Hz cross-stick would be the same note as its snare — it takes flavour A, where 470 Hz is a full
octave clear of the snare body, and the near-absent noise is what carries the idiom.

| kit | fl | `bodyFreqStart` | `bodyFreqEnd` | `bodyFreqStart2` | `bodyFreqEnd2` | `bodyGain` | `bodyGain2` | `bodyTime` | `bodyDecay` | `noiseFilter` | `noiseDecay` | `noiseGain` | `reverbSend` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEFAULT | A | 455 | 440 | 1667 | 1600 | 0.45 | 0.55 | 0.006 | 0.090 | 3000 | 0.030 | 0.15 | 0.25 |
| Retro Drive | A | 470 | 452 | 1720 | 1650 | 0.45 | 0.55 | 0.006 | 0.085 | 3100 | 0.030 | 0.16 | 0.30 |
| 909 Modern | A | 500 | 480 | 1800 | 1730 | 0.42 | 0.58 | 0.005 | 0.075 | 3400 | 0.026 | 0.14 | 0.24 |
| Trap Beat | A | 540 | 520 | 1980 | 1900 | 0.40 | 0.60 | 0.005 | 0.065 | 3800 | 0.022 | 0.12 | 0.20 |
| 808 Vintage | A | 455 | 440 | 1667 | 1600 | 0.45 | 0.55 | 0.006 | 0.100 | 3000 | 0.032 | 0.15 | 0.22 |
| Chrome Pulse | A | 520 | 500 | 1900 | 1820 | 0.40 | 0.60 | 0.004 | 0.060 | 3600 | 0.020 | 0.12 | 0.45 |
| Velocity Breaks | A | 610 | 590 | 2100 | 2020 | 0.48 | 0.52 | 0.004 | 0.055 | 3800 | 0.018 | 0.13 | 0.20 |
| Sub Weight | A | 430 | 415 | 1580 | 1520 | 0.50 | 0.50 | 0.007 | 0.110 | 2800 | 0.035 | 0.16 | 0.45 |
| Warehouse | A | 560 | 540 | 2000 | 1920 | 0.42 | 0.58 | 0.004 | 0.070 | 3600 | 0.022 | 0.13 | 0.40 |
| Tight Pocket | B | 800 | 780 | 2450 | 2350 | 0.55 | 0.35 | 0.004 | 0.045 | 4000 | 0.018 | 0.10 | 0.15 |
| Acoustic Studio | B | 760 | 740 | 2350 | 2260 | 0.56 | 0.34 | 0.004 | 0.050 | 4200 | 0.020 | 0.11 | 0.45 |
| Warm Riddim | B, from step 4 | 900 | 875 | 1350 | 1310 | 0.55 | 0.19 | 0.004 | 0.045 | 4000 | 0.018 | 0.10 | 0.50 |
| Lo-Fi Vinyl | B | 720 | 700 | 2200 | 2120 | 0.55 | 0.35 | 0.005 | 0.055 | 3400 | 0.022 | 0.12 | 0.28 |
| Dusty Break | B | 780 | 760 | 2400 | 2300 | 0.54 | 0.36 | 0.004 | 0.048 | 3900 | 0.019 | 0.11 | 0.30 |

`Warm Riddim`'s row is slice 1's cross-stick, moved here intact from the snare by step 4 and glided
900→875 rather than 900→800 (a click does not sweep a fifth of an octave; the research cross-stick
moves 780→760). Its second partial is the one place the 1.85 rule does not apply: **1.50 and a 0.35
gain factor**, because 1.85 over a 900 Hz body lands at 1665 Hz — shrill, and far outside the click
the row exists to make. It sits ~2.8× above the other kits' rimshots by design, which is the warning
slice 1's comment made about the snare row and step 4 re-pointed at this one.

Measured: `rimshot.bodyFreqEnd` 415→875, ratio **2.11** (needs 1.7); `rimshot.bodyFreqEnd2`
1310→2350, ratio **1.79** (needs 1.4); `rimshot.bodyDecay` 0.045→0.11, ratio **2.44** (needs 2.0).
The within-kit `rimshot` ↔ `snare` floor of task 6 also holds for the reworked kit: `noiseGain` 0.10
against 0.50 is **2.32 octaves**, well clear of the 1.32 that `Lo-Fi Vinyl` sets as the tightest.

- [ ] **Step 7: Write the failing engine test**

```ts
describe('snare pair and rimshot', () => {
  test('a snare schedules TWO body oscillators plus its noise', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    const made = recordNodes(ctx);
    engine.triggerDrum('snare', 1);
    expect(made.osc).toHaveLength(2);
    expect(made.osc.map((o) => o.type)).toEqual(['triangle', 'triangle']);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([220, 407]);
    expect(made.osc.map((o) => o.frequency.ramps[0].v)).toEqual([195, 361]);
    expect(made.noise).toHaveLength(1);
  });

  test('rimshot runs the same path off its own params, with almost no noise', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    const made = recordNodes(ctx);
    engine.triggerDrum('rimshot', 1);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([455, 1667]);
    const noiseEnv = made.gain.find((g) => g.gain.events[0]?.v === 0.15);
    expect(noiseEnv).toBeDefined();
  });
});
```

- [ ] **Step 8: Run the tests and watch them fail**

```bash
bun test src/audio/engine.test.ts -t "snare pair and rimshot"
```

Expected: FAIL — the snare creates 1 oscillator, not 2, and `rimshot` falls through to the switch's
`default` and creates nothing.

- [ ] **Step 9: Extend the snare case and add the rimshot case**

In `src/audio/engine.ts`, replace `case 'snare'` and add `case 'rimshot'` immediately after it, in
canonical order. Both delegate to one private helper so there is genuinely one code path:

```ts
      case 'snare':
        this.snareVoice(k.snare, v, now);
        break;
      case 'rimshot':
        // Decision 31: a rimshot is a PRESET over the snare path, not a third
        // synthesis path - two inharmonic tones with almost no noise.
        this.snareVoice(k.rimshot, v, now);
        break;
```

and add the helper beside `metallicBurst`:

```ts
  /** The two-partial body plus noise shared by `snare` and `rimshot`. */
  private snareVoice(s: SnareParams, v: number, now: number): void {
    this.drumTone({
      type: 'triangle', freq: s.bodyFreqStart, freqEnd: s.bodyFreqEnd,
      pitchTime: s.bodyTime, peak: v * s.bodyGain, decay: s.bodyDecay,
      t: now, stopAt: now + s.bodyDecay + 0.05,
    });
    // The second partial: the (0,1) head mode is a PAIR, and every machine
    // that copies it uses two oscillators (research §2.1).
    this.drumTone({
      type: 'triangle', freq: s.bodyFreqStart2, freqEnd: s.bodyFreqEnd2,
      pitchTime: s.bodyTime, peak: v * s.bodyGain2, decay: s.bodyDecay,
      t: now, stopAt: now + s.bodyDecay + 0.05,
    });
    this.drumNoiseBurst({
      filterType: 'highpass', freq: s.noiseFilter, peak: v * s.noiseGain,
      decay: s.noiseDecay, t: now, stopPad: 0.03, reverbSend: s.reverbSend,
    });
  }
```

`SnareParams` is already imported by `engine.ts` through the `drumKits` type imports; if it is not,
add it to the existing `import type { … } from '@/data/drumKits'` line rather than a new import.

- [ ] **Step 10: Run the tests, the check and the gate, then commit**

```bash
bun test src/audio/engine.test.ts -t "snare pair and rimshot"
bun run check:drums
bun run verify
git add src/data/drumKits.ts src/audio/drumKits.ts src/audio/engine.ts scripts/check-drum-kit-separation.ts src/audio/engine.test.ts
git commit -m "feat(audio): give the snare its second partial, and add rimshot

An acoustic snare's tonal component is a pair of partials near 180 and 330 Hz;
one triangle cannot produce it. With the second oscillator, rimshot is a preset
over the same path - 455/1667 Hz with almost no noise for the 808 flavour,
780/2400 for the cross-stick - so the highest-value missing voice is also the
cheapest. Thirteen kits authored for both; the spreads landed first.

Warm Riddim's cross-stick moves off snare onto rimshot, where decision 38 says
reggae's backbeat lives, and the kit gets an ordinary snare at 250/212. That
re-opened two gates: snare.bodyFreqEnd holds at 1.82x, and pairwise separation
needed noiseDecay 0.06 to keep Retro Drive <-> Warm Riddim above the floor
(1.12, against 0.766 at the old 0.08). Retuned, not relaxed.

mergeDrumKit gains its rimshot line - the enumeration stays explicit, because
each voice has a differently shaped Params type and a loop over DRUM_TYPES would
need a cast, trading a compile error for a runtime hole. engine.test.ts's
envelope-floor loop now reads DRUM_TYPES: it is a roster assertion, and the
fifth inline copy of the list would have kept passing while checking one voice
fewer."
```

---

### Task 4: `hitom` / `lowtom`

Spec decision 32. `tom` is **renamed** to `lowtom`, not split in place, because measurement says
today's tom already *is* a low tom: across the thirteen kits `tom.freqEnd` runs 65–110 Hz, which is
the low-tom band. It keeps its `freqEnd`, `decay`, `gain` and `reverbSend` exactly. `hitom` is
derived by the research ratios (`…kick-snare-clap-toms.md` §4.3): `hitom.freqEnd / lowtom.freqEnd`
≈ 2.0 (the 808's 185/90), `lowtom.decay / hitom.decay` ≈ 1.9, the same shallow 1.35
`freqStart / freqEnd` for both, `pitchTime` ≈ 0.7 × the low tom's, identical `gain`.

**One guard must be encoded: `hitom.freqEnd ≤ 0.85 × snare.bodyFreqEnd`.** Without the cap the hi
tom sits on the same note as the snare body and a fill turns to mud. Measured against the current
kits, the cap **binds in 8 of the 13** — `Retro Drive`, `909 Modern`, `808 Vintage`, `Chrome Pulse`,
`Warehouse`, `Acoustic Studio`, `Lo-Fi Vinyl` and `Dusty Break` — so it is load-bearing, not
decorative.

**Files:**
- Modify: `src/data/drumKits.ts` (`DrumKit`, `DRUM_TYPES`, `DEFAULT_DRUM_KIT`, 13 kits)
- Modify: `src/audio/drumKits.ts` (`mergeDrumKit` — rename the `tom` line, add `hitom`)
- Modify: `src/audio/engine.ts` (`case 'tom'` → `case 'lowtom'` + `case 'hitom'`; `DRUM_ALIASES`)
- Modify: `scripts/check-drum-kit-separation.ts` (rename two `PAIRWISE_PARAMS` entries, add spreads)
- Test: `src/data/drumKits.test.ts`, `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `TomParams` (with slice 3's `reverbSend`), `DRUM_TYPES`.
- Produces:
  ```ts
  export const DRUM_TYPES = [
    'kick', 'snare', 'rimshot', 'clap', 'hihat', 'openhat', 'hitom', 'lowtom', 'crash',
  ] as const;                                   // task 5 appends 'ride' and 'bell'
  export interface DrumKit { /* … */ hitom: TomParams; lowtom: TomParams }
  ```

- [ ] **Step 1: Rename the type and add the new one**

In `src/data/drumKits.ts`: rename `tom: TomParams` to `lowtom: TomParams` in `DrumKit` and add
`hitom: TomParams` **before** it (canonical order is `… openhat hitom lowtom ride crash bell`).
Replace `'tom'` with `'hitom', 'lowtom'` in `DRUM_TYPES`, in the same position. In
`DEFAULT_DRUM_KIT`, rename the `tom:` key to `lowtom:` — its values do not change — and add

```ts
  hitom: { freqStart: 176, freqEnd: 130, pitchTime: 0.1, decay: 0.15, gain: 0.7, reverbSend: R },
```

`reverbSend` is the one field this task does not invent. Slice 3 authored `TomParams.reverbSend`;
`R` above is that kit's existing value, read — never guessed — with:

```bash
bun -e "
import { DRUM_KITS, DEFAULT_DRUM_KIT } from './src/data/drumKits.ts';
import { mergeDrumKit } from './src/audio/drumKits.ts';
console.log('DEFAULT', DEFAULT_DRUM_KIT.tom.reverbSend);
for (const [n, p] of Object.entries(DRUM_KITS)) console.log(n, mergeDrumKit(p).tom.reverbSend);
process.exit(0);
"
```

Rename the `tom` line in `mergeDrumKit` (`src/audio/drumKits.ts`) and add the new voice beside it,
in canonical order — that enumeration is by hand, and a voice with no line there is absent from
every merged kit:

```ts
    hitom: { ...DEFAULT_DRUM_KIT.hitom, ...partial?.hitom },
    lowtom: { ...DEFAULT_DRUM_KIT.lowtom, ...partial?.lowtom },
```

Run the `reverbSend` command **before** step 4 renames the key, or it reads `undefined`. The rule is the same drummer in
the same room, so **`hitom.reverbSend` always equals `lowtom.reverbSend`** in every kit, and step
5's test is what enforces it.

- [ ] **Step 2: Add the `check:drums` entries — BEFORE the kits are authored**

Two edits. First, **rename** the two existing `PAIRWISE_PARAMS` entries — this is a rename of
entries that are already there, not an addition, so Global Constraint 7 is respected and the list
length is unchanged:

```ts
  { label: 'lowtom.freqEnd', pick: (k) => k.lowtom.freqEnd },
  { label: 'lowtom.decay', pick: (k) => k.lowtom.decay },
```

Second, add the aggregate spreads and the guard, which is a genuine floor:

```ts
// --- Check 2e: the tom split (spec decision 32) ---
spread('lowtom.freqEnd', (k) => k.lowtom.freqEnd, 1.5);
spread('hitom.freqEnd', (k) => k.hitom.freqEnd, 1.6);
spread('hitom.decay', (k) => k.hitom.decay, 2.5);
// Calibrated against step 4's derived table (measured 1.69, 1.71, 3.00), per
// task 2, step 2: a new check gets its first value here, and is a Constraint 8
// floor from this commit on.

// --- Check 2f: the hi tom must not sit on the snare's note ---
// Without this cap a descending fill turns to mud: the hi tom lands on the
// same pitch as the snare body and the ear hears one instrument, not two.
for (const { name, kit } of kits) {
  const cap = 0.85 * kit.snare.bodyFreqEnd;
  report(
    `kit "${name}" hitom.freqEnd <= 0.85 * snare.bodyFreqEnd`,
    kit.hitom.freqEnd <= cap,
    `hitom.freqEnd=${kit.hitom.freqEnd}, cap=${cap.toFixed(1)}`,
  );
}
```

- [ ] **Step 3: Run the check and watch it FAIL**

```bash
bun run check:drums
```

Expected: FAIL — thirteen `NO override: hitom equals DEFAULT_DRUM_KIT` lines, `hitom.freqEnd spread`
and `hitom.decay spread` at ratio 1.0, and the `lowtom.*` picks throwing until step 4 renames the
kit keys. (If the script exits on a `TypeError` rather than a `FAIL` line, that is the same signal:
`k.lowtom` is `undefined` because the kits still say `tom`.)

- [ ] **Step 4: Author both toms for all thirteen kits**

Rename each kit's `tom:` block to `lowtom:` **unchanged**, and add the `hitom:` block. The derived
values, with the cap applied — the "capped" column marks the eight kits where the mechanical 2.0×
would have collided with the snare:

| kit | low FS | low FE | low PT | low decay | hi FS | hi FE | hi PT | hi decay | gain (both) | cap | capped |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEFAULT | 88 | 65 | 0.14 | 0.28 | 176 | 130 | 0.10 | 0.15 | 0.70 | 165 | |
| Retro Drive | 115 | 85 | 0.14 | 0.22 | 227 | 168 | 0.10 | 0.12 | 0.65 | 168 | YES |
| 909 Modern | 119 | 88 | 0.12 | 0.20 | 236 | 175 | 0.08 | 0.11 | 0.65 | 175 | YES |
| Trap Beat | 101 | 75 | 0.14 | 0.30 | 203 | 150 | 0.10 | 0.16 | 0.70 | 233 | |
| 808 Vintage | 108 | 80 | 0.14 | 0.25 | 189 | 140 | 0.10 | 0.13 | 0.65 | 140 | YES |
| Chrome Pulse | 149 | 110 | 0.10 | 0.22 | 296 | 219 | 0.07 | 0.12 | 0.65 | 219 | YES |
| Velocity Breaks | 128 | 95 | 0.10 | 0.16 | 257 | 190 | 0.07 | 0.08 | 0.60 | 204 | |
| Sub Weight | 97 | 72 | 0.14 | 0.40 | 194 | 144 | 0.10 | 0.21 | 0.70 | 153 | |
| Warehouse | 124 | 92 | 0.10 | 0.18 | 216 | 160 | 0.07 | 0.09 | 0.65 | 160 | YES |
| Tight Pocket | 122 | 90 | 0.10 | 0.18 | 243 | 180 | 0.07 | 0.09 | 0.65 | 190 | |
| Acoustic Studio | 135 | 100 | 0.14 | 0.45 | 236 | 175 | 0.10 | 0.24 | 0.75 | 175 | YES |
| Warm Riddim | 101 | 75 | 0.14 | 0.35 | 203 | 150 | 0.10 | 0.18 | 0.60 | 180 | |
| Lo-Fi Vinyl | 95 | 70 | 0.14 | 0.30 | 173 | 128 | 0.10 | 0.16 | 0.55 | 128 | YES |
| Dusty Break | 128 | 95 | 0.08 | 0.30 | 246 | 182 | 0.06 | 0.16 | 0.70 | 182 | YES |

Each `hitom` also takes `reverbSend` equal to its kit's `lowtom.reverbSend`.

Measured: `hitom.freqEnd` 128→219, ratio **1.71** (needs 1.6); `hitom.decay` 0.08→0.24, ratio
**3.00** (needs 2.5); `lowtom.freqEnd` 65→110, ratio **1.69** (needs 1.5). Closest hi/low pair is
`Warehouse` at **0.799 octaves** — that number is what sets the floor in task 6.

- [ ] **Step 5: Write the failing tests**

In `src/data/drumKits.test.ts`:

```ts
test('every kit puts its hi tom about an octave above its low tom, under the snare cap', () => {
  for (const [name, partial] of Object.entries(DRUM_KITS)) {
    const k = mergeDrumKit(partial);
    const ratio = k.hitom.freqEnd / k.lowtom.freqEnd;
    expect(ratio, `${name} hi/low tom ratio`).toBeGreaterThanOrEqual(1.68);
    expect(ratio, `${name} hi/low tom ratio`).toBeLessThanOrEqual(2.15);
    expect(k.hitom.freqEnd, `${name} hitom vs snare body`)
      .toBeLessThanOrEqual(0.85 * k.snare.bodyFreqEnd);
    // Same drummer, same room.
    expect(k.hitom.reverbSend, `${name} tom sends`).toBe(k.lowtom.reverbSend);
    expect(k.hitom.gain, `${name} tom gains`).toBeCloseTo(k.lowtom.gain, 2);
  }
});
```

In `src/audio/engine.test.ts`:

```ts
test('hitom and lowtom are two different pitched voices', () => {
  const { engine, ctx } = freshEngine();
  (engine as any).drumKit = DEFAULT_DRUM_KIT;
  const made = recordNodes(ctx);
  engine.triggerDrum('lowtom', 1);
  engine.triggerDrum('hitom', 1);
  expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([88, 176]);
  expect(made.osc.map((o) => o.frequency.ramps[0].v)).toEqual([65, 130]);
});
```

- [ ] **Step 6: Run the tests and watch them fail**

```bash
bun test src/data/drumKits.test.ts -t "hi tom"
bun test src/audio/engine.test.ts -t "hitom and lowtom"
```

Expected: the engine test FAILS with an empty oscillator list — and **the reason is the failure
mode decision 4 names.** `triggerDrum` resolves `DRUM_ALIASES[name] ?? name` *before* its switch, so
`lowtom` is still being rewritten to `tom`, and `case 'tom'` no longer exists.

- [ ] **Step 7: Delete the `lowtom` alias and rewrite the case**

In `src/audio/engine.ts`, `DRUM_ALIASES` loses its `lowtom` entry:

```ts
export const DRUM_ALIASES: Record<string, string> = Object.assign(Object.create(null), {
  closedhat: 'hihat',
  ride: 'crash',
});
```

and `case 'tom'` becomes two cases in canonical order:

```ts
      case 'hitom': {
        const t = k.hitom;
        this.drumTone({
          freq: t.freqStart, freqEnd: t.freqEnd, pitchTime: t.pitchTime,
          peak: v * t.gain, decay: t.decay, t: now,
        });
        break;
      }
      case 'lowtom': {
        const t = k.lowtom;
        this.drumTone({
          freq: t.freqStart, freqEnd: t.freqEnd, pitchTime: t.pitchTime,
          peak: v * t.gain, decay: t.decay, t: now,
        });
        break;
      }
```

Slice 3 wired `reverbSend` on `TomParams`; keep whatever argument it passes on both cases.

`case 'tom'` is now gone and nothing resolves to it. Old persisted payloads that still say `tom` are
handled by the migration chains, **not** by an alias — decision 4 is explicit that `tom` must not
become an alias for `lowtom`, because that would make a persisted-shape problem permanent in the
engine.

- [ ] **Step 8: Run the tests, the check and the gate, then commit**

```bash
bun test src/data/drumKits.test.ts -t "hi tom"
bun test src/audio/engine.test.ts -t "hitom and lowtom"
bun run check:drums
bun run verify
git add src/data/drumKits.ts src/audio/drumKits.ts src/audio/engine.ts scripts/check-drum-kit-separation.ts src/data/drumKits.test.ts src/audio/engine.test.ts
git commit -m "feat(audio): split tom into hitom and lowtom

tom is renamed, not split in place: measured, today's tom already is a low tom
(freqEnd 65-110 Hz across the thirteen kits). hitom is derived by the 808's
ratios - an octave up, decay 1.9x shorter, the same shallow 1.35 sweep - under
the guard hitom.freqEnd <= 0.85 * snare.bodyFreqEnd, which binds in 8 of the 13
kits and is what keeps a fill from turning to mud.

The lowtom -> tom alias is deleted here because it must be: triggerDrum resolves
aliases before its switch, so leaving it would have made case 'lowtom' dead code.

mergeDrumKit's hand-written enumeration is renamed and extended in step with the
interface; a voice with no line there is absent from every merged kit and the
authoring pass would measure nothing."
```

---

### Task 5: `ride` and `bell`

Spec decisions 33 and 34.

**`ride` is one voice with one `ping` parameter, not two voices.** A ping component (bandpass
3.5–5 kHz at Q 3–5, plus a 300–600 Hz body band, 0–2 ms attack, 90–160 ms decay) and a wash
component (bandpass 7–9 kHz at Q 0.7, 8–15 ms bloom, 1.2–2.5 s decay), crossfaded by `ping` in 0..1
(`…hats-and-cymbals.md` §2.3, §3). **A ride is a defined ping over a bed that survives the next
strike; a crash is a faster bloom that collapses. Neither is a filtered version of the other** — if
`ride` ends up implemented as a re-filtered crash, the within-kit check in task 6 is what should
catch it.

**`bell` does not use the bank** (decision 30): two squares at 800 and 540 Hz — a deliberately
detuned fifth, 1.481, so they beat — through a bandpass at ~880 Hz with Q ≈ 4.8, over ~400 ms. The
ride-bell/bembé variant is ~1700/1150 Hz through a 2000 Hz bandpass with a wash tail; here that tail
is a longer `decay` plus a high `reverbSend`, because the drum bus already has a reverb send and a
second tail generator would be a parameter nobody asked for.

**The field sets are decided here.** Both keep their Q values, attacks and band levels as module
constants rather than kit fields — the same discipline ruling R7 applied to the hat `q`. A kit
authors what distinguishes kits; a constant holds what distinguishes *voices*.

**Files:**
- Modify: `src/data/drumKits.ts` (`RideParams`, `BellParams`, `DrumKit`, `DRUM_TYPES`,
  `DEFAULT_DRUM_KIT`, 13 kits)
- Modify: `src/audio/drumKits.ts` (`mergeDrumKit` — the `ride` and `bell` lines)
- Modify: `src/audio/engine.ts` (`DRUM_ALIASES`, `case 'ride'`, `case 'bell'`)
- Modify: `scripts/check-drum-kit-separation.ts` (`spread()` entries)
- Test: `src/data/drumKits.test.ts`, `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `metallicBurst`, `drumNoiseBurst`, `drumEnv`, `wireDrumVoice`, `DRUM_TYPES`.
- Produces:
  ```ts
  export interface RideParams {
    tone: number;        // bank fundamental, 120-150 Hz: a bigger plate rings lower
    ping: number;        // 0..1 crossfade, 1 = all ping, 0 = all wash
    pingFilter: number;  // ping band centre, 3.5-5 kHz
    pingDecay: number;   // 0.09-0.16 s
    washFilter: number;  // wash band centre, 7-9 kHz
    washDecay: number;   // 1.2-2.5 s
    bodyFilter: number;  // the 300-600 Hz body band
    metal: number;       // 0..1 bank vs noise, per ruling R5
    gain: number;
    reverbSend: number;
  }
  export interface BellParams {
    freq1: number;       // 800 Hz (808 cowbell) .. 1700 Hz (ride bell)
    freq2: number;       // freq1 / 1.481 - a detuned fifth, so the two beat
    filter: number;      // bandpass centre, ~1.1x freq1
    decay: number;
    gain: number;
    reverbSend: number;  // the ride bell's wash tail lives here
  }
  export interface DrumKit { /* … */ ride: RideParams; bell: BellParams }
  const RIDE_PING_Q = 4;
  const RIDE_WASH_Q = 0.7;
  const RIDE_BODY_Q = 4;
  const RIDE_BODY_LEVEL = 0.2;
  const RIDE_WASH_ATTACK = 0.012;
  const BELL_Q = 4.8;
  ```

- [ ] **Step 1: Add the two interfaces, the types and the defaults**

Add both interfaces to `src/data/drumKits.ts` with the field comments above; add
`ride: RideParams;` and `bell: BellParams;` to `DrumKit` in canonical order (`… lowtom ride crash
bell`); append `'ride'` and `'bell'` to `DRUM_TYPES` in the same order, giving the final eleven:

```ts
export const DRUM_TYPES = [
  'kick', 'snare', 'rimshot', 'clap', 'hihat', 'openhat',
  'hitom', 'lowtom', 'ride', 'crash', 'bell',
] as const;
```

In `DEFAULT_DRUM_KIT`:

```ts
  ride: { tone: 135, ping: 0.55, pingFilter: 4200, pingDecay: 0.12, washFilter: 8000, washDecay: 1.8, bodyFilter: 450, metal: 0.5, gain: 0.34, reverbSend: 0.35 },
  bell: { freq1: 800, freq2: 540, filter: 880, decay: 0.4, gain: 0.3, reverbSend: 0.3 },
```

and the last two lines of `mergeDrumKit` in `src/audio/drumKits.ts`, in canonical order, which
completes its hand-written enumeration at eleven:

```ts
    ride: { ...DEFAULT_DRUM_KIT.ride, ...partial?.ride },
    bell: { ...DEFAULT_DRUM_KIT.bell, ...partial?.bell },
```

- [ ] **Step 2: Add the `check:drums` entries — BEFORE the kits are authored**

```ts
// --- Check 2g: the two new cymbal voices (spec decisions 33, 34) ---
spread('ride.ping', (k) => k.ride.ping, 2.0);
spread('ride.pingDecay', (k) => k.ride.pingDecay, 1.6);
spread('ride.washDecay', (k) => k.ride.washDecay, 1.8);
spread('ride.pingFilter', (k) => k.ride.pingFilter, 1.35);
spread('ride.metal', (k) => k.ride.metal, 3.0);
spread('bell.filter', (k) => k.bell.filter, 2.0);
spread('bell.decay', (k) => k.bell.decay, 1.6);
spread('bell.gain', (k) => k.bell.gain, 1.25);
```

All eight factors are calibrated against the values steps 4 and 5 author (measured 2.67, 1.78,
2.08, 1.43, 6.0, 2.27, 1.83, 1.36) — task 2, step 2 states why that is not the relaxation Global
Constraint 8 forbids, and that they become protected floors the moment this commit lands.

- [ ] **Step 3: Run the check and watch it FAIL**

```bash
bun run check:drums
```

Expected: FAIL — twenty-six `NO override: ride / bell equals DEFAULT_DRUM_KIT` lines and eight
`spread` failures at ratio 1.0.

- [ ] **Step 4: Author `ride` for all thirteen kits**

The axis: `ping` high for kits that use a ride as a *timekeeper* (a defined stick attack over a
quiet bed), low for kits where the ride is wash and colour. `tone` is plate size — 120 Hz reads as a
22", 150 Hz as an 18".

| kit | `tone` | `ping` | `pingFilter` | `pingDecay` | `washFilter` | `washDecay` | `bodyFilter` | `metal` | `gain` | `reverbSend` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEFAULT | 135 | 0.55 | 4200 | 0.12 | 8000 | 1.8 | 450 | 0.50 | 0.34 | 0.35 |
| Retro Drive | 140 | 0.60 | 4400 | 0.11 | 8200 | 1.5 | 500 | 0.45 | 0.32 | 0.35 |
| 909 Modern | 145 | 0.70 | 4800 | 0.10 | 8600 | 1.3 | 520 | 0.70 | 0.33 | 0.28 |
| Trap Beat | 150 | 0.80 | 5000 | 0.09 | 9000 | 1.2 | 560 | 0.85 | 0.30 | 0.22 |
| 808 Vintage | 125 | 0.75 | 3800 | 0.10 | 7200 | 1.4 | 380 | 0.90 | 0.31 | 0.25 |
| Chrome Pulse | 148 | 0.65 | 4900 | 0.10 | 8800 | 1.6 | 540 | 0.75 | 0.35 | 0.50 |
| Velocity Breaks | 138 | 0.50 | 4600 | 0.09 | 8400 | 1.3 | 480 | 0.30 | 0.33 | 0.22 |
| Sub Weight | 128 | 0.40 | 3900 | 0.13 | 7400 | 2.2 | 400 | 0.35 | 0.34 | 0.50 |
| Warehouse | 142 | 0.60 | 4700 | 0.11 | 8600 | 2.0 | 520 | 0.80 | 0.32 | 0.45 |
| Tight Pocket | 130 | 0.75 | 4000 | 0.10 | 7000 | 1.4 | 420 | 0.20 | 0.36 | 0.18 |
| Acoustic Studio | 122 | 0.45 | 3600 | 0.15 | 7000 | 2.5 | 320 | 0.15 | 0.38 | 0.50 |
| Warm Riddim | 126 | 0.35 | 3700 | 0.14 | 7200 | 2.3 | 360 | 0.25 | 0.30 | 0.50 |
| Lo-Fi Vinyl | 120 | 0.30 | 3500 | 0.16 | 7000 | 1.9 | 300 | 0.30 | 0.28 | 0.30 |
| Dusty Break | 132 | 0.55 | 4100 | 0.12 | 7600 | 1.7 | 440 | 0.25 | 0.33 | 0.30 |

Measured: `ride.ping` 0.30→0.80, ratio **2.67** (needs 2.0); `ride.pingDecay` 0.09→0.16, **1.78**
(needs 1.6); `ride.washDecay` 1.2→2.5, **2.08** (needs 1.8); `ride.pingFilter` 3500→5000, **1.43**
(needs 1.35); `ride.metal` 0.15→0.90, **6.0** (needs 3.0).

- [ ] **Step 5: Author `bell` for all thirteen kits**

Four sourced flavours: the **808 cowbell** (800/540, bp 880), **agogô high** (1050/710, bp 1150),
**agogô low** (840/568, bp 920) and the **ride bell / bembé** (1700/1150, bp 2000, long decay plus a
wash tail carried by `reverbSend`). Every pair holds the detuned fifth 1.478–1.482, and every
`filter` sits 1.09–1.18 × `freq1`. The ride-bell flavour goes only to kits whose hats are bright
enough to stay clear of a 2000 Hz bell — `Tight Pocket` and `Lo-Fi Vinyl` have 3600 Hz hats and
therefore take cowbells.

| kit | flavour | `freq1` | `freq2` | `filter` | `decay` | `gain` | `reverbSend` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DEFAULT | 808 cowbell | 800 | 540 | 880 | 0.40 | 0.30 | 0.30 |
| Retro Drive | 808 cowbell | 800 | 540 | 880 | 0.38 | 0.32 | 0.35 |
| 909 Modern | agogô low | 840 | 568 | 920 | 0.34 | 0.30 | 0.28 |
| Trap Beat | agogô high | 1050 | 710 | 1150 | 0.30 | 0.28 | 0.20 |
| 808 Vintage | 808 cowbell | 800 | 540 | 880 | 0.45 | 0.34 | 0.25 |
| Chrome Pulse | agogô high | 1100 | 743 | 1200 | 0.32 | 0.30 | 0.50 |
| Velocity Breaks | ride bell | 1700 | 1150 | 2000 | 0.50 | 0.26 | 0.25 |
| Sub Weight | agogô low | 840 | 568 | 920 | 0.48 | 0.32 | 0.50 |
| Warehouse | agogô high | 1150 | 776 | 1250 | 0.36 | 0.29 | 0.45 |
| Tight Pocket | cowbell, up | 880 | 594 | 960 | 0.35 | 0.33 | 0.18 |
| Acoustic Studio | ride bell | 1700 | 1150 | 2000 | 0.55 | 0.31 | 0.50 |
| Warm Riddim | agogô high | 1050 | 710 | 1150 | 0.42 | 0.30 | 0.50 |
| Lo-Fi Vinyl | cowbell, up | 900 | 608 | 980 | 0.40 | 0.25 | 0.30 |
| Dusty Break | ride bell | 1700 | 1150 | 2000 | 0.52 | 0.27 | 0.30 |

Measured: `bell.filter` 880→2000, ratio **2.27** (needs 2.0); `bell.decay` 0.30→0.55, **1.83**
(needs 1.6); `bell.gain` 0.25→0.34, **1.36** (needs 1.25).

- [ ] **Step 6: Write the failing tests**

In `src/data/drumKits.test.ts`:

```ts
test('every bell is a detuned fifth under a bandpass just above its top partial', () => {
  for (const [name, partial] of Object.entries(DRUM_KITS)) {
    const b = mergeDrumKit(partial).bell;
    const fifth = b.freq1 / b.freq2;
    // 1.481 exactly would be a just fifth; the point is that it is NOT, so the
    // two oscillators beat. A tidy 1.5 removes the beating and the bell dies.
    expect(fifth, `${name} bell interval`).toBeGreaterThanOrEqual(1.4);
    expect(fifth, `${name} bell interval`).toBeLessThanOrEqual(1.55);
    const placement = b.filter / b.freq1;
    expect(placement, `${name} bell bandpass`).toBeGreaterThanOrEqual(1.05);
    expect(placement, `${name} bell bandpass`).toBeLessThanOrEqual(1.25);
  }
});
```

In `src/audio/engine.test.ts`:

```ts
describe('ride and bell', () => {
  test('a ride schedules a ping band, a body band and a long wash', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    const made = recordNodes(ctx);
    engine.triggerDrum('ride', 1);
    const centres = made.biquad.filter((b) => b.type === 'bandpass').map((b) => b.frequency.value);
    expect(centres).toContain(4200);   // ping
    expect(centres).toContain(450);    // body
    expect(centres).toContain(8000);   // wash
    // The wash outlives the ping by more than an order of magnitude: that bed
    // surviving the next strike is what makes it a ride and not a crash.
    const ends = made.gain.map((g) => g.gain.ramps.at(-1)?.t).filter(Boolean) as number[];
    expect(Math.max(...ends) - 10).toBeGreaterThan(1.5);
    expect(ends).toContain(10.12);
  });

  test('a bell is two squares a detuned fifth apart through one bandpass', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    const made = recordNodes(ctx);
    engine.triggerDrum('bell', 1);
    expect(made.osc).toHaveLength(2);
    expect(made.osc.map((o) => o.type)).toEqual(['square', 'square']);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([800, 540]);
    const bp = made.biquad.filter((b) => b.type === 'bandpass');
    expect(bp).toHaveLength(1);
    expect(bp[0].frequency.value).toBe(880);
    expect(bp[0].Q.value).toBe(4.8);
    expect(made.noise).toHaveLength(0);   // the bell does not use the bank or noise
  });
});
```

- [ ] **Step 7: Run the tests and watch them fail**

```bash
bun test src/audio/engine.test.ts -t "ride and bell"
```

Expected: FAIL — `bell` hits the switch's `default` and creates nothing, and `ride` is still being
rewritten to `crash` by `DRUM_ALIASES` before the switch ever sees it.

- [ ] **Step 8: Delete the `ride` alias and add both cases**

`DRUM_ALIASES` loses its second stale entry:

```ts
export const DRUM_ALIASES: Record<string, string> = Object.assign(Object.create(null), {
  closedhat: 'hihat',
});
```

Add the constants beside `METAL_TONE_CRASH`:

```ts
const RIDE_PING_Q = 4;      // §2.3 gives Q 3-5 for the defined stick attack
const RIDE_WASH_Q = 0.7;    // §2.3: the wash band is deliberately wide
const RIDE_BODY_Q = 4;      // the 300-600 Hz body band
const RIDE_BODY_LEVEL = 0.2;
const RIDE_WASH_ATTACK = 0.012;  // 8-15 ms bloom
const BELL_Q = 4.8;         // derived from the 808 cowbell's -3 dB points, 794/977 Hz
```

Then the two cases, in canonical order (`ride` before `crash`, `bell` last):

```ts
      case 'ride': {
        const r = k.ride;
        const peak = v * r.gain;
        // ping and wash are two COMPONENTS of one voice. The ping is a defined
        // attack; the wash is a bed that must survive the next strike 250 ms
        // later. A crash is the opposite trade - a faster bloom that collapses.
        if (r.metal > 0) {
          this.metallicBurst({
            tone: r.tone, peak: peak * r.metal * r.ping, t: now,
            highpass: r.bodyFilter, reverbSend: r.reverbSend,
            bandA: { freq: r.pingFilter, q: RIDE_PING_Q, level: 1, attack: 0, decay: r.pingDecay },
            bandB: { freq: r.bodyFilter, q: RIDE_BODY_Q, level: RIDE_BODY_LEVEL, attack: 0, decay: r.pingDecay * 1.6 },
          });
          this.metallicBurst({
            tone: r.tone, peak: peak * r.metal * (1 - r.ping), t: now,
            highpass: r.washFilter * 0.5, reverbSend: r.reverbSend,
            bandA: { freq: r.washFilter, q: RIDE_WASH_Q, level: 1, attack: RIDE_WASH_ATTACK, decay: r.washDecay },
            bandB: { freq: METAL_BAND_B_HZ, q: 0.9, level: 0.35, attack: RIDE_WASH_ATTACK, decay: r.washDecay * 0.7 },
          });
        }
        if (r.metal < 1) {
          // The stick, and the noise half of the bed (§2.3's 10% / 5% layers).
          this.drumNoiseBurst({
            filterType: 'bandpass', freq: r.pingFilter, q: RIDE_PING_Q,
            peak: peak * (1 - r.metal) * r.ping, decay: r.pingDecay, t: now,
          });
          this.drumNoiseBurst({
            filterType: 'bandpass', freq: r.washFilter, q: RIDE_WASH_Q,
            peak: peak * (1 - r.metal) * (1 - r.ping), decay: r.washDecay,
            t: now, stopPad: 0.1, reverbSend: r.reverbSend,
          });
        }
        break;
      }
      case 'bell': {
        const b = k.bell;
        // Decision 30: the bell does NOT use the metallic bank. Two squares a
        // detuned fifth apart already beat against each other, and the 808's
        // cowbell is exactly this circuit.
        const bp = this.ctx!.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = b.filter;
        bp.Q.value = BELL_Q;
        const env = this.drumEnv(v * b.gain, b.decay, now);
        bp.connect(env);
        const send = this.wireDrumVoice(env, b.reverbSend);
        const oscs = [b.freq1, b.freq2].map((freq) => {
          const osc = this.ctx!.createOscillator();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, now);
          osc.connect(bp);
          osc.start(now);
          osc.stop(now + b.decay + 0.02);
          return osc;
        });
        oscs[1].onended = () => {
          for (const osc of oscs) try { osc.disconnect(); } catch { /* ignore */ }
          try { bp.disconnect(); } catch { /* ignore */ }
          try { env.disconnect(); } catch { /* ignore */ }
          if (send) try { send.disconnect(); } catch { /* ignore */ }
        };
        break;
      }
```

- [ ] **Step 9: Run the tests, the check and the gate, then commit**

```bash
bun test src/audio/engine.test.ts -t "ride and bell"
bun test src/data/drumKits.test.ts -t "detuned fifth"
bun run check:drums
bun run verify
git add src/data/drumKits.ts src/audio/drumKits.ts src/audio/engine.ts scripts/check-drum-kit-separation.ts src/data/drumKits.test.ts src/audio/engine.test.ts
git commit -m "feat(audio): add ride and bell, completing the eleven voices

ride is one voice with one ping parameter crossfading a defined ping component
against a wash bed that survives the next strike; a crash is the opposite trade,
a faster bloom that collapses, and neither is a filtered version of the other.
bell is two squares a detuned fifth apart through a Q 4.8 bandpass - the 808
cowbell circuit - and deliberately does not use the metallic bank.

The ride -> crash alias is deleted here because it must be: it would have made
case 'ride' unreachable dead code.

mergeDrumKit's enumeration reaches eleven voices with these two lines."
```

---

### Task 6: `DRUM_ALIASES` reduced, and the within-kit distinctness check

Spec decisions 4 and 40, ruling R6.

**This is the failure mode to fear.** `triggerDrum` resolves `DRUM_ALIASES[name] ?? name`
**before** its switch (`src/audio/engine.ts:1678`). If `lowtom → tom` and `ride → crash` survive
this work, `case 'ride'` is dead code nothing can reach and every `lowtom` step keeps playing the
old single tom — **no error, no test failure**, because `engine.test.ts` asserts only that every
alias *target* is a real drum type, and `hihat`, `tom` and `crash` all keep passing that. Tasks 4
and 5 were forced to delete their entry to make their own tests pass; this task is where the table
is *proved* reduced and locked, so a future merge cannot quietly put one back.

`closedhat → hihat` stays: it is a caller-facing synonym for a voice that still exists, not a
stand-in for a voice we lack. **`tom` does not become an alias for `lowtom`** — that rename belongs
in the two migration chains (part 2), because an alias would make a persisted-shape problem
permanent in the engine.

The second half is R6's new check. `PAIRWISE_PARAMS` is not the tool for it: it is a `max` over its
list, so adding a voice there can only *raise* every pair's separation (Global Constraint 7). What
decisions 32–34 actually ask is a different question — **within one kit, are two voices that could
collapse into each other actually distinct?**

**Files:**
- Modify: `src/audio/engine.ts` (`DRUM_ALIASES`, only if a task left an entry behind)
- Modify: `scripts/check-drum-kit-separation.ts` (new `withinKit()` function and its four pairs)
- Test: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `DRUM_ALIASES` (engine), `DRUM_TYPES`, all eleven `DrumKit` fields (tasks 3–5),
  `report()` and `kits` (already in the script).
- Produces:
  ```ts
  export const DRUM_ALIASES = { closedhat: 'hihat' };   // exactly this, nothing else

  // scripts/check-drum-kit-separation.ts
  function withinKit(
    label: string,
    pick: (kit: DrumKit) => [number, number],
    minOctaves: number,
  ): void
  ```

- [ ] **Step 1: Verify the table by evaluating it, not by reading it**

```bash
bun -e "
import { DRUM_ALIASES } from './src/audio/engine.ts';
console.log(JSON.stringify(DRUM_ALIASES));
process.exit(0);
"
```

Expected after tasks 4 and 5: `{"closedhat":"hihat"}`. If either `lowtom` or `ride` is still there,
delete it now — that is this task's first job and the whole slice is silently broken until it is
done.

- [ ] **Step 2: Write the failing regression test**

Add to `src/audio/engine.test.ts`, beside the existing alias test:

```ts
  test('DRUM_ALIASES is exactly { closedhat: hihat }', () => {
    // Not a style assertion. triggerDrum resolves DRUM_ALIASES[name] ?? name
    // BEFORE its switch, so a resurrected `lowtom: 'tom'` or `ride: 'crash'`
    // makes case 'lowtom' / case 'ride' unreachable dead code and every step on
    // those rows plays the wrong voice - with no error and no other failing
    // test, because the "every target is a real drum type" test still passes.
    expect({ ...DRUM_ALIASES }).toEqual({ closedhat: 'hihat' });
  });

  test('every drum type reaches its own case, with no alias in the way', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    for (const type of DRUM_TYPES) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      expect(ctx._gains.length, `${type} produced no audio`).toBeGreaterThan(before);
    }
    expect(DRUM_TYPES).toHaveLength(11);
  });
```

Import `DRUM_TYPES` from `@/data/drumKits` at the top of the file if it is not already imported.

- [ ] **Step 3: Run the tests**

```bash
bun test src/audio/engine.test.ts -t "DRUM_ALIASES"
bun test src/audio/engine.test.ts -t "reaches its own case"
```

Expected: PASS if tasks 4 and 5 landed their deletions; FAIL with a diff naming the surviving entry
if one did not. A FAIL here is the check working — fix the table, do not relax the test.

- [ ] **Step 4: Add the within-kit check — the function first**

In `scripts/check-drum-kit-separation.ts`, after `spreadDefined` and **before** the
`PAIRWISE_PARAMS` block (which stays exactly as it is — see Global Constraint 7):

```ts
/**
 * Check 2h: WITHIN one kit, two voices that could collapse into each other
 * must be measurably apart on the parameter that defines the difference
 * (spec decisions 32-34, ruling R6).
 *
 * This is a different question from PAIRWISE_PARAMS, which asks whether two
 * KITS differ. It is also why the new voices do NOT enter PAIRWISE_PARAMS:
 * that list is a max over its entries, so adding one can only raise every
 * pair's separation and make the floor easier to clear. This is a floor.
 *
 * Distance is in octaves, |log2(a/b)|, so it reads the same for a frequency
 * and for a decay.
 */
function withinKit(
  label: string,
  pick: (kit: DrumKit) => [number, number],
  minOctaves: number,
) {
  let worst = { name: '', d: Infinity };
  for (const { name, kit } of kits) {
    const [a, b] = pick(kit);
    const d = Math.abs(Math.log2(a / b));
    if (d < worst.d) worst = { name, d };
  }
  report(
    `within-kit ${label}`,
    worst.d >= minOctaves,
    `closest kit is "${worst.name}" at ${worst.d.toFixed(3)} octaves, floor ${minOctaves}` +
      (worst.d >= minOctaves ? '' : ' -- retune that kit; do not lower the floor'),
  );
}

// hitom vs lowtom: the split is vacuous if both toms are the same drum. The
// research ratio is 1.9-2.1x, but the snare cap of decision 32 pulls eight
// kits below it, and Warehouse is the closest at 0.799.
withinKit('hitom vs lowtom on freqEnd', (k) => [k.hitom.freqEnd, k.lowtom.freqEnd], 0.75);

// ride vs crash: a ride is a DEFINED PING, a crash is a bloom that collapses.
// If a ride is ever implemented as a re-filtered crash, this is what catches it.
withinKit('ride vs crash on strike decay', (k) => [k.ride.pingDecay, k.crash.decay], 2.0);

// bell vs hihat: the nearest neighbours in brightness, and per decision 34 the
// case most likely to PASS ON NUMBERS WHILE FAILING THE EAR - the bell's real
// separation from a hat is harmonic structure, and no parameter-spread
// assertion looks at that. A green line here is not a verdict; the listening
// pass is.
withinKit('bell vs hihat on filter', (k) => [k.bell.filter, k.hihat.filter], 1.5);

// rimshot vs snare: the defining property is that a rimshot is nearly all tone
// and nearly no noise. Same code path, opposite balance.
withinKit('rimshot vs snare on noiseGain', (k) => [k.rimshot.noiseGain, k.snare.noiseGain], 1.2);
```

All four floors are calibrated against the authored kits — each sits just under the measured
closest pair in the table below, and 0.75 in particular was set by `Warehouse` at 0.799 rather than
chosen in advance. Task 2, step 2 states why that is calibration of a new check rather than the
relaxation Global Constraint 8 forbids, and that from this commit onward they are floors like any
other.

- [ ] **Step 5: Run the check and read the four new lines**

```bash
bun run check:drums
```

Expected: PASS on all four, with these measured closest kits — the numbers to compare against, so a
later retune that quietly narrows one is visible:

| pair | parameter | floor | measured closest |
| --- | --- | --- | --- |
| `hitom` ↔ `lowtom` | `freqEnd` | 0.75 | `Warehouse` at **0.799** |
| `ride` ↔ `crash` | `ride.pingDecay` vs `crash.decay` | 2.0 | `Lo-Fi Vinyl` at **2.64** |
| `bell` ↔ `hihat` | `filter` | 1.5 | `Acoustic Studio` at **1.68** (see below) |
| `rimshot` ↔ `snare` | `noiseGain` | 1.2 | `Lo-Fi Vinyl` at **1.32** |

**`bell` against `hihat` is the case most likely to pass on numbers while failing the ear**
(decision 34): the bell's separation from a hat is *harmonic structure*, and no parameter-spread
assertion looks at that. Treat a green line on that row as "not obviously wrong", never as a
verdict — decision 42's listening pass is the gate for it.

- [ ] **Step 6: Prove the check can fail**

A floor that no authored value can violate is decoration. Break one deliberately:

```bash
bun -e "
import { DRUM_KITS } from './src/data/drumKits.ts';
import { mergeDrumKit } from './src/audio/drumKits.ts';
const k = mergeDrumKit(DRUM_KITS['Warehouse']);
// What the check would report if hitom were authored one step flatter.
console.log('as authored', Math.abs(Math.log2(k.hitom.freqEnd / k.lowtom.freqEnd)).toFixed(3));
console.log('at 150 Hz  ', Math.abs(Math.log2(150 / k.lowtom.freqEnd)).toFixed(3), '-> below the 0.75 floor');
process.exit(0);
"
```

Expected output: `as authored 0.799` and `at 150 Hz 0.705 -> below the 0.75 floor`. Optionally edit
`Warehouse`'s `hitom.freqEnd` to 150, run `bun run check:drums`, confirm the FAIL line names
`Warehouse`, and revert. Do not commit the edit.

- [ ] **Step 7: Run the full gate and commit**

```bash
bun run verify
git add src/audio/engine.ts scripts/check-drum-kit-separation.ts src/audio/engine.test.ts
git commit -m "test(audio): lock DRUM_ALIASES to closedhat, and check voices within a kit

DRUM_ALIASES is now exactly { closedhat: hihat }, with a test that fails if
lowtom -> tom or ride -> crash returns. Aliases resolve before triggerDrum's
switch, so either one would make a new case unreachable dead code and leave the
old voice playing, with no error and no other failing test.

check:drums gains withinKit(): a per-kit floor in octaves over the four pairs
that could collapse into each other - hitom/lowtom, ride/crash, bell/hihat,
rimshot/snare. PAIRWISE_PARAMS is untouched, because it is a max over its list
and adding to it weakens every pair."
```

---

### Task 7: `renameDrumTrack`, `renameSoundKit`, both migration chains, and the `909 Modern` rename

The persisted shape changes in four ways and needs **three new pure transforms plus the existing
one**, in a fixed order. `withDrumTracks` **appends only and never rewrites a track that is
present** — by design, so a user's renamed, recoloured, muted, reprogrammed track survives. Run
alone against this change it would leave `tom` in place *and* append `lowtom`: the user's tom row
goes silent while a blank one appears beside it. Hence `renameDrumTrack`, and it runs **before**
`withDrumTracks`; reversed, the append sees no `lowtom`, adds a blank one, and the rename then
produces two.

`909 Modern` → **`Club Standard`** (ruling R4). The owner may substitute `Peak Hour` or
`Four Floor` before this task runs — it is one kit-table key, three `src/data/` string literals,
one `renameSoundKit` argument pair and one test constant.

Measured — every place the old name appears (`grep -rn "909 Modern" src scripts --include='*.ts'
--include='*.tsx'`): `src/data/drumKits.ts:90` (the table key), `src/data/drumGrids.ts:119`
(`house.kit`), `src/data/vibes.ts:280` (a comment) and `:283` (`cyber-edm.soundKit`), and
`scripts/check-drum-kit-separation.ts:106` (a comment). **The spec's decision 8 says "no vibe names
`909 Modern`" — that was true when the spec was written and is false now:** slice 2 repointed
`cyber-edm` onto it. The vibe is in the blast radius. The spec is **stale there, not wrong about the
design**: decision 8's blast-radius line was measured before slice 2 repointed the three dangling
`soundKit` names, and repointing one of them onto this kit is what put a vibe in the list.

**Files:**
- Modify: `src/store/initialState.ts` (add `renameDrumTrack`, `renameSoundKit` and `recolourDrumTracks` beside `withDrumTracks`)
- Modify: `src/store/migrate.ts` (add `migrateDrumVoices`, the v13 → v14 step; correct
  `migrateDrumTracks`'s docblock, which says the step appends two tracks)
- Modify: `src/store/store.ts:286` (`version: 13` → `14`) and its `migrate` chain
- Modify: `src/store/projectFormatMigrate.ts` (add `upgradeDrumVoicesV6`, wire it into
  `migrateProjectBody`; correct `upgradeDrumTracksV5`'s docblock at `:145–152`, which says a pre-v5
  body "can only be missing `tom` and `crash`" — after Task 8 that step appends nine)
- Modify: `src/store/projectFormat.ts:20` (`PROJECT_FORMAT_VERSION = 5` → `6`, and its docblock)
- Modify: `src/data/drumKits.ts:90`, `src/data/drumGrids.ts:119`, `src/data/vibes.ts:280,283`, `scripts/check-drum-kit-separation.ts:106`
- Test: `src/store/initialState.test.ts`, `src/store/migrate.test.ts`, `src/store/projectFormatMigrate.test.ts`

**Interfaces:**
- Consumes: `withDrumTracks(tracks: SequencerTrack[]): SequencerTrack[]` and
  `INITIAL_SEQUENCER_TRACKS` from `src/store/initialState.ts`; `mapLoops<T extends object>(state: T,
  fn: (loop: Record<string, unknown>) => Record<string, unknown>): T` (`migrate.ts:228`, module-private);
  `mapBodyLoops(raw: Record<string, unknown>, fn: (loop: Record<string, unknown>) =>
  Record<string, unknown>): Record<string, unknown>` (`projectFormatMigrate.ts:25`, module-private);
  the thirteen kits and the eleven-field `DrumKit` from part 1.
- Produces:
  `renameDrumTrack(tracks: SequencerTrack[], from: string, to: string): SequencerTrack[]`,
  `renameSoundKit<T extends object>(loop: T, from: string, to: string): T` and
  `recolourDrumTracks(tracks: SequencerTrack[]): SequencerTrack[]`, all three exported from
  `src/store/initialState.ts`;
  `migrateDrumVoices<T extends object>(state: T): T` exported from `src/store/migrate.ts`;
  persist `version: 14`; `PROJECT_FORMAT_VERSION = 6`; the kit key `'Club Standard'`.
  Task 8 appends the four new entries to `INITIAL_SEQUENCER_TRACKS`, which is what makes
  `withDrumTracks` append them here with no edit to this task's code. Task 10 writes
  `DRUM_KITS['Club Standard'].reference`.

**The acceptance property, tested in both chains: sound does not change for an existing session or
`.solna` file.** Appended tracks are silent, a renamed track keeps its steps, a renamed kit
resolves to the same parameters (only the key moved).

`sequencerTracks` is reachable by either chain in **exactly one place: inside every `loops[]`
entry.** The store's flat copy is derived on hydration and appears in neither `partializeAppState`
nor `PROJECT_CONTENT_KEYS`. Both chains map `loops[]` and nothing else — no top-level branch here,
unlike v13's belt-and-braces one.

**The fourth change: track colours, and it is not optional.** Decision 37's table lists three
changes; **that is the spec's omission, not a decision.** Decision 35 says in as many words that a
mixed scheme "would leave the sequencer as the one surface in the app where colour means two
different things" — and without a colour migration *every* existing session gets exactly that:
seven old semantic tokens beside four new `--color-drum-*`. So a fourth pure transform,
`recolourDrumTracks`, scoped the way `withDrumTracks` is scoped so it cannot overwrite a user's own
choice: **it rewrites a track's `color` only where that colour still equals the exact token the
pre-slice-4 `INITIAL_SEQUENCER_TRACKS` shipped for that track.** A track the user recoloured keeps
their colour; a track the user recoloured to some *other* track's factory token also keeps it,
because the map is per instrument, not a set of seven strings. `migrateTrackColors`
(`migrate.ts:126`) is the precedent — same shape, same "unknown colour is left alone" branch.

It changes no sound, so Global Constraint 10 is untouched, and it is idempotent: after the rewrite a
colour is a `bg-drum-*` token, which is not a key of the legacy map.

**Order: it runs LAST — `renameSoundKit` → `renameDrumTrack` → `withDrumTracks` → `recolourDrumTracks`.**
It must come after `renameDrumTrack`, or it sees `tom` where the map has `lowtom` and leaves the
row's `bg-primary` in place. Relative to `withDrumTracks` the order is free — tracks it appends are
born with `bg-drum-*` and so are never legacy-matched — and last is the order that reads correctly:
shape first, presentation last.

**The transform ships here; its wiring ships with the CSS in Task 9, on purpose.** The classes
`recolourDrumTracks` writes do not exist until Task 9 defines them, so wiring it into the chains
here would leave two commits in which a migrated grid renders uncoloured. Task 7 therefore lands the
function and its unit tests — pure, testable, no CSS in sight — and **Task 9 appends it to both
chains in the same commit as the `--color-drum-*` block.** There is no second version bump: the
whole slice ships together (decision 29), so v14 and v6 are simply not final until Task 9 lands.

**The other order was considered and is worse.** Landing the eleven tracks before this migration
would have an existing session hydrate with its old `tom` row intact *and* a blank `lowtom`
appended — the exact double-row bug decision 37 exists to prevent, live, in a window where someone
could program steps into the wrong row. A missing colour is recoverable; a silenced row that looks
like a working one is not.

- [ ] **Step 1: Write the failing tests for the two transforms**

Add to `src/store/initialState.test.ts`:

```ts
import { renameDrumTrack, renameSoundKit } from './initialState';

describe('renameDrumTrack', () => {
  const tom = {
    id: 'track-tom', name: 'My Tom', instrument: 'tom',
    steps: [true, false, true, false], volume: 0.4, muted: true, color: 'bg-primary',
  } as unknown as SequencerTrack;

  test('rewrites the instrument and id, and keeps everything the user owns', () => {
    const [next] = renameDrumTrack([tom], 'tom', 'lowtom');
    expect(next.instrument).toBe('lowtom');
    expect(next.id).toBe('track-lowtom');
    expect(next.name).toBe('My Tom');
    expect(next.steps).toEqual([true, false, true, false]);
    expect(next.volume).toBe(0.4);
    expect(next.muted).toBe(true);
    expect(next.color).toBe('bg-primary');
  });

  test('is idempotent, and returns the same array when there is nothing to rename', () => {
    const once = renameDrumTrack([tom], 'tom', 'lowtom');
    expect(renameDrumTrack(once, 'tom', 'lowtom')).toBe(once);
  });

  test('drops a BLANK target row and renames into it', () => {
    // Not hypothetical: an old payload runs the earlier version steps first, and
    // those append against the eleven-voice constant — so it arrives holding the
    // user's `tom` AND a blank `lowtom`.
    const blank = { ...tom, id: 'track-lowtom', instrument: 'lowtom', steps: [false, false] };
    const out = renameDrumTrack([tom, blank as unknown as SequencerTrack], 'tom', 'lowtom');
    expect(out).toHaveLength(1);
    expect(out[0].steps).toEqual([true, false, true, false]);
  });

  test('touches neither when the target row has programmed steps', () => {
    // Someone owns both rows; losing either is worse than a stale name.
    const both = [tom, { ...tom, id: 'track-lowtom', instrument: 'lowtom' } as SequencerTrack];
    expect(renameDrumTrack(both, 'tom', 'lowtom')).toBe(both);
  });

  test('survives the junk a pre-sanitize payload can hold', () => {
    const junk = [null, 7, { instrument: 'tom' }] as unknown as SequencerTrack[];
    expect(renameDrumTrack(junk, 'tom', 'lowtom')[2].instrument).toBe('lowtom');
  });
});

describe('renameSoundKit', () => {
  test('rewrites only the matching name', () => {
    expect(renameSoundKit({ soundKit: '909 Modern' }, '909 Modern', 'Club Standard'))
      .toEqual({ soundKit: 'Club Standard' });
  });

  test('returns the same object when it does not match, and is idempotent', () => {
    const other = { soundKit: 'Warehouse' };
    expect(renameSoundKit(other, '909 Modern', 'Club Standard')).toBe(other);
    const once = renameSoundKit({ soundKit: '909 Modern' }, '909 Modern', 'Club Standard');
    expect(renameSoundKit(once, '909 Modern', 'Club Standard')).toBe(once);
  });
});

describe('recolourDrumTracks', () => {
  const track = (instrument: string, color: string) =>
    ({ id: `track-${instrument}`, name: instrument, instrument,
       steps: [], volume: 1, muted: false, color }) as unknown as SequencerTrack;

  test('rewrites a factory colour onto the drum namespace, per instrument', () => {
    const out = recolourDrumTracks([
      track('kick', 'bg-error'), track('snare', 'bg-warning'), track('hihat', 'bg-success'),
      track('openhat', 'bg-accent'), track('clap', 'bg-secondary'),
      track('lowtom', 'bg-primary'), track('crash', 'bg-info'),
    ]);
    expect(out.map((t) => t.color)).toEqual([
      'bg-drum-kick', 'bg-drum-snare', 'bg-drum-hihat', 'bg-drum-openhat',
      'bg-drum-clap', 'bg-drum-lowtom', 'bg-drum-crash',
    ]);
  });

  test("keeps a colour the user chose, including another track's factory token", () => {
    // The map is per instrument, not a set of seven strings: bg-error was the
    // KICK's colour, so a snare wearing it is a user's choice, not a leftover.
    const mine = [track('snare', 'bg-error'), track('kick', 'bg-drum-kick')];
    expect(recolourDrumTracks(mine)).toBe(mine);
  });

  test('is idempotent and leaves an unknown instrument alone', () => {
    const once = recolourDrumTracks([track('kick', 'bg-error')]);
    expect(recolourDrumTracks(once)).toBe(once);
    const alien = [track('banjo', 'bg-error')];
    expect(recolourDrumTracks(alien)).toBe(alien);
  });
});

test('renameDrumTrack runs BEFORE recolourDrumTracks, or the tom row keeps bg-primary', () => {
  const tom = { id: 'track-tom', instrument: 'tom', steps: [], volume: 1,
                muted: false, name: 'Tom', color: 'bg-primary' } as unknown as SequencerTrack;
  expect(recolourDrumTracks([tom])[0].color).toBe('bg-primary');
  expect(recolourDrumTracks(renameDrumTrack([tom], 'tom', 'lowtom'))[0].color).toBe('bg-drum-lowtom');
});

test('rename BEFORE append renames; append BEFORE rename repairs — one lowtom either way', () => {
  // The documented order is rename-then-append: it never creates the blank row
  // at all. The reverse works only because renameDrumTrack drops a blank target,
  // which is a REPAIR path for old payloads that came through the v13/v5 steps,
  // not a licence to rely on it.
  const tom = { id: 'track-tom', name: 'Tom', instrument: 'tom', volume: 0.8, muted: false,
                color: 'bg-primary', steps: [true, false, true] } as unknown as SequencerTrack;
  const wrong = renameDrumTrack(withDrumTracks([tom]), 'tom', 'lowtom');
  const right = withDrumTracks(renameDrumTrack([tom], 'tom', 'lowtom'));
  for (const out of [wrong, right]) {
    const lowtoms = out.filter((t) => t.instrument === 'lowtom');
    expect(lowtoms).toHaveLength(1);
    expect(lowtoms[0].steps).toEqual([true, false, true]);
    expect(out.some((t) => t.instrument === 'tom')).toBe(false);
  }
});
```

> The order test only bites once Task 8 has put `lowtom` into `INITIAL_SEQUENCER_TRACKS`. Until
> then `withDrumTracks` appends nothing. Run it again at the end of Task 8 — that is Task 8's step 8.
>
> **Why the blank-target branch is load-bearing, not defensive:** an old payload runs the earlier
> version steps first, and `migrateDrumTracks` (v13) and `upgradeDrumTracksV5` call `withDrumTracks`
> against whatever `INITIAL_SEQUENCER_TRACKS` holds *today* — eleven voices after Task 8. So a
> pre-v13 session reaches the v14 step carrying its programmed `tom` row and a blank `lowtom` beside
> it. Without the branch the rename would decline, the `tom` row would name no track, and the user's
> tom pattern would go silent while a blank row sat where it used to be — the exact failure
> decision 37 exists to prevent, arriving by a different door.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/initialState.test.ts`
Expected: FAIL — `renameDrumTrack is not a function`, `renameSoundKit is not a function`.

- [ ] **Step 3: Write the two transforms**

In `src/store/initialState.ts`, directly under `withDrumTracks`:

```ts
/**
 * Rename one drum track in place, keeping every field the user owns.
 *
 * The companion withDrumTracks CANNOT do this: it appends only and never
 * rewrites a track that is present, which is exactly the property that lets a
 * renamed, recoloured, muted, reprogrammed row survive an upgrade. Run alone
 * against the tom -> lowtom change it would leave `tom` in place AND append
 * `lowtom`: the user's programmed tom row goes silent while a blank one appears
 * beside it.
 *
 * CALL THIS BEFORE withDrumTracks. Reversed, the append sees no `lowtom`, adds
 * a blank one, and the rename then produces two.
 *
 * Pure, idempotent, and shared by both migration chains — the discipline
 * withDrumTracks and defaultPadState() already follow. The cast and the `?.`
 * are because this runs BEFORE sanitize in both chains, so an element can be
 * anything a JSON file held.
 */
export function renameDrumTrack(
  tracks: SequencerTrack[],
  from: string,
  to: string,
): SequencerTrack[] {
  const instrumentOf = (t: unknown) => (t as Partial<SequencerTrack> | null)?.instrument;
  const silent = (t: unknown) => {
    const steps = (t as Partial<SequencerTrack> | null)?.steps;
    return !Array.isArray(steps) || !steps.some(Boolean);
  };
  if (!tracks.some((t) => instrumentOf(t) === from)) return tracks;
  const existing = tracks.find((t) => instrumentOf(t) === to);
  // BOTH present. This is not only the hand-edited case: an OLD payload reaches
  // this step through the earlier ones, and those call withDrumTracks against
  // the eleven-voice constant — so a pre-v13 session (pre-v5 body) arrives here
  // with the user's `tom` row AND a blank `lowtom` appended beside it. Drop the
  // blank one and rename; the user's steps are the row that matters. If the
  // `to` row has programmed steps, someone owns both and we touch neither.
  if (existing && !silent(existing)) return tracks;
  return tracks
    .filter((track) => track !== existing)
    .map((track) =>
      instrumentOf(track) === from
        ? { ...(track as SequencerTrack), id: `track-${to}`, instrument: to }
        : track,
    );
}

/**
 * Rename a loop's `soundKit`. A scalar field, not a track list, so it is its
 * own transform rather than a branch inside renameDrumTrack. Pure, idempotent
 * and shared by both chains for the same reason.
 */
export function renameSoundKit<T extends object>(loop: T, from: string, to: string): T {
  return (loop as { soundKit?: unknown }).soundKit === from ? { ...loop, soundKit: to } : loop;
}

/**
 * The colour every drum track shipped with before the --color-drum-* namespace
 * existed, keyed by the instrument it belonged to. `lowtom` holds what the old
 * `tom` track shipped with, so recolourDrumTracks MUST run after
 * renameDrumTrack — before it, the row is still `tom` and keeps bg-primary.
 *
 * Per instrument, not a set of seven strings: bg-error was the KICK's colour, so
 * a snare wearing it is a choice the user made and is left alone.
 */
const LEGACY_DRUM_TRACK_COLORS: Record<string, string> = {
  kick: 'bg-error', snare: 'bg-warning', hihat: 'bg-success',
  openhat: 'bg-accent', clap: 'bg-secondary', lowtom: 'bg-primary', crash: 'bg-info',
};

/**
 * Move the seven original tracks onto the drum colour namespace, WITHOUT
 * touching a colour the user chose.
 *
 * Scoped exactly the way withDrumTracks is: it rewrites only what still equals
 * the factory value for that instrument. The alternative — recolouring every
 * track — would throw away a user's palette; doing nothing at all would leave
 * the sequencer as the one surface in the app where colour means two different
 * things, seven semantic tokens beside four drum ones (decision 35).
 *
 * Pure, idempotent (a bg-drum-* value is not a key of the map), shared by both
 * chains, and it changes no sound. migrateTrackColors is the precedent.
 */
export function recolourDrumTracks(tracks: SequencerTrack[]): SequencerTrack[] {
  let recoloured = false;
  const next = tracks.map((track) => {
    const t = track as Partial<SequencerTrack> | null;
    if (!t || typeof t !== 'object') return track;
    const factory = LEGACY_DRUM_TRACK_COLORS[t.instrument as string];
    if (!factory || t.color !== factory) return track;
    recoloured = true;
    return { ...(track as SequencerTrack), color: `bg-drum-${t.instrument}` };
  });
  return recoloured ? next : tracks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/store/initialState.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing persist-chain test**

Add to `src/store/migrate.test.ts`:

```ts
import { migrateDrumVoices } from './migrate';

describe('migrateDrumVoices (v13 -> v14)', () => {
  // A v13 payload carries the SEMANTIC colours, so they are spelled out here
  // rather than sliced off INITIAL_SEQUENCER_TRACKS — Task 9 moves that constant
  // onto bg-drum-*, and a fixture that followed it would make the colour
  // assertion below pass without the migration doing anything.
  // A v13 payload: seven tracks, in the seven-voice order, carrying the SEMANTIC
  // colours. Written out rather than sliced off INITIAL_SEQUENCER_TRACKS —
  // Task 8 reorders that constant and Task 9 recolours it, and a fixture that
  // followed it would assert nothing.
  const v13Track = (id: string, instrument: string, color: string) =>
    ({ id, name: instrument, instrument, steps: [false, false], volume: 0.8,
       muted: false, color }) as unknown as SequencerTrack;
  const v13Loop = () => ({
    soundKit: '909 Modern',
    sequencerTracks: [
      v13Track('track-kick', 'kick', 'bg-error'),
      v13Track('track-snare', 'snare', 'bg-warning'),
      v13Track('track-hihat', 'hihat', 'bg-success'),
      v13Track('track-openhat', 'openhat', 'bg-accent'),
      v13Track('track-clap', 'clap', 'bg-secondary'),
      { id: 'track-tom', name: 'My Tom', instrument: 'tom',
        steps: [true, false, false, true], volume: 0.4, muted: true, color: 'bg-primary' },
      v13Track('track-crash', 'crash', 'bg-info'),
    ],
  });

  test('the tom row keeps its steps and becomes lowtom, exactly once', () => {
    const { loops } = migrateDrumVoices({ loops: [v13Loop()] }) as {
      loops: { sequencerTracks: SequencerTrack[] }[];
    };
    const lowtoms = loops[0].sequencerTracks.filter((t) => t.instrument === 'lowtom');
    expect(lowtoms).toHaveLength(1);
    expect(lowtoms[0].steps).toEqual([true, false, false, true]);
    expect(lowtoms[0].muted).toBe(true);
    expect(loops[0].sequencerTracks.some((t) => t.instrument === 'tom')).toBe(false);
  });

  test('the four new tracks are appended and every one of them is silent', () => {
    const { loops } = migrateDrumVoices({ loops: [v13Loop()] }) as {
      loops: { sequencerTracks: SequencerTrack[] }[];
    };
    expect(loops[0].sequencerTracks.map((t) => t.instrument)).toEqual([
      'kick', 'snare', 'hihat', 'openhat', 'clap', 'crash',
      'lowtom', 'rimshot', 'hitom', 'ride', 'bell',
    ]);
    for (const added of ['rimshot', 'hitom', 'ride', 'bell']) {
      const track = loops[0].sequencerTracks.find((t) => t.instrument === added)!;
      expect(track.steps.some(Boolean), `${added} must be appended silent`).toBe(false);
    }
  });

  test('the renamed kit resolves, and the old name no longer does', () => {
    const { loops } = migrateDrumVoices({ loops: [v13Loop()] }) as { loops: { soundKit: string }[] };
    expect(loops[0].soundKit).toBe('Club Standard');
    expect(DRUM_KITS['Club Standard']).toBeDefined();
    expect(DRUM_KITS['909 Modern']).toBeUndefined();
  });

  test('is idempotent and leaves an untouched loop alone', () => {
    const once = migrateDrumVoices({ loops: [v13Loop()] });
    expect(migrateDrumVoices(once)).toEqual(once);
    const clean = { loops: [{ soundKit: 'Warehouse', sequencerTracks: 'not an array' }] };
    expect(migrateDrumVoices(clean)).toEqual(clean);
  });
});
```

> The expected instrument ORDER is append order, not canonical order: the six kept rows, then the
> renamed `crash`/`lowtom` pair in the order the v13 payload held them, then the four appended in
> `INITIAL_SEQUENCER_TRACKS` order. A migrated session's row order is its own history; only a fresh
> session gets the canonical order of Task 8.

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test src/store/migrate.test.ts -t "migrateDrumVoices"`
Expected: FAIL with `migrateDrumVoices is not a function`.

- [ ] **Step 7: Write the persist step and bump the version**

In `src/store/migrate.ts`, under `migrateDrumTracks`:

```ts
/**
 * v13 -> v14: the seven-voice kit becomes eleven. Four shape changes, three of
 * which withDrumTracks cannot make:
 *
 *   1. the `tom` track becomes `lowtom`   -> renameDrumTrack, FIRST
 *   2. rimshot / hitom / ride / bell are appended -> withDrumTracks, SECOND
 *   3. loop.soundKit '909 Modern' -> 'Club Standard' -> renameSoundKit
 *   4. the seven factory colours move to bg-drum-* -> recolourDrumTracks, LAST,
 *      and it is wired in one task later, with the CSS that defines those class
 *      names. The version does not move again for it: the slice ships together.
 *
 * The order in 1/2 is load-bearing: reversed, the append sees no `lowtom`, adds
 * a blank one, and the rename then produces two. So is 1 before 4: before the
 * rename, the row is still `tom` and keeps bg-primary. 4 relative to 2 is free —
 * appended tracks are born with the new colour — and last is the order that
 * reads correctly: shape first, presentation last.
 *
 * Shares only the three pure transforms with the .solna chain's
 * upgradeDrumVoicesV6, and must NOT be refactored into one function with it: a
 * project body is an external contract, the persist payload is private
 * localStorage shape, and their version numbers move for different reasons.
 *
 * SOUND DOES NOT CHANGE. The renamed track keeps its steps; the four appended
 * ones are authored with an empty bar; the renamed kit is the same object under
 * a new key. `loops` only — partializeAppState persists no top-level
 * sequencerTracks and wrapFlatStateIntoLoop (v5 -> v6) has already run.
 */
export function migrateDrumVoices<T extends object>(state: T): T {
  return mapLoops(state, (row) => {
    const rekitted = renameSoundKit(row, '909 Modern', 'Club Standard');
    if (!Array.isArray(rekitted.sequencerTracks)) return rekitted;
    const tracks = rekitted.sequencerTracks as SequencerTrack[];
    // Task 9 appends recolourDrumTracks here, with the CSS that defines what it writes.
    return { ...rekitted, sequencerTracks: withDrumTracks(renameDrumTrack(tracks, 'tom', 'lowtom')) };
  });
}
```

Extend the import at `src/store/migrate.ts:13`:

```ts
import { defaultPadState, renameDrumTrack, renameSoundKit, withDrumTracks } from './initialState';
```

In `src/store/store.ts`, change `version: 13` to `version: 14` and add one line at the bottom of
the chain, directly under the v12 → v13 line:

```ts
        // v13 -> v14 (eleven drum voices: tom -> lowtom, four appended, kit rename)
        if (version < 14) next = migrateDrumVoices(next) as PersistedState;
```

…importing `migrateDrumVoices` alongside `migrateDrumTracks` in `store.ts`'s existing import from
`./migrate`.

- [ ] **Step 8: Run the persist tests**

Run: `bun test src/store/migrate.test.ts src/store/store.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing `.solna` chain test**

Add to `src/store/projectFormatMigrate.test.ts`:

```ts
describe('v5 -> v6: eleven drum voices', () => {
  const body = () => ({
    formatVersion: 5,
    content: {
      loops: [{
        soundKit: '909 Modern',
        sequencerTracks: [
          { id: 'track-kick', name: 'Kick', instrument: 'kick',
            steps: [true, false], volume: 0.9, muted: false, color: 'bg-error' },
          { id: 'track-tom', name: 'Tom', instrument: 'tom',
            steps: [false, true], volume: 0.8, muted: false, color: 'bg-primary' },
        ],
      }],
    },
  });

  test('renames the tom row, appends the missing voices silent, renames the kit', () => {
    const out = migrateProjectBody(body(), 5) as {
      content: { loops: { soundKit: string; sequencerTracks: SequencerTrack[] }[] };
    };
    const loop = out.content.loops[0];
    expect(loop.soundKit).toBe('Club Standard');
    const lowtom = loop.sequencerTracks.filter((t) => t.instrument === 'lowtom');
    expect(lowtom).toHaveLength(1);
    expect(lowtom[0].steps).toEqual([false, true]);
    // This body was hand-thin: withDrumTracks restores the nine it lacks as the
    // FACTORY rows, which is the documented repair case. What must hold for a
    // body this app actually wrote is that nothing it authored changed.
    expect(loop.sequencerTracks.find((t) => t.instrument === 'kick')!.steps).toEqual([true, false]);
    for (const added of ['rimshot', 'hitom', 'ride', 'bell']) {
      expect(loop.sequencerTracks.find((t) => t.instrument === added)!.steps.some(Boolean)).toBe(false);
    }
  });

  test('PROJECT_FORMAT_VERSION is 6 and a v6 body is untouched', () => {
    expect(PROJECT_FORMAT_VERSION).toBe(6);
    const already = migrateProjectBody(body(), 6);
    expect((already as typeof already & { content: { loops: { soundKit: string }[] } })
      .content.loops[0].soundKit).toBe('909 Modern');
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `bun test src/store/projectFormatMigrate.test.ts`
Expected: FAIL — `soundKit` is still `'909 Modern'` and `PROJECT_FORMAT_VERSION` is 5.

- [ ] **Step 11: Write the `.solna` step and bump its version**

In `src/store/projectFormatMigrate.ts`, under `upgradeDrumTracksV5`:

```ts
/**
 * v5 -> v6: the seven-voice kit becomes eleven, in a project body.
 *
 * The same pure transforms as the persist chain's migrateDrumVoices, in the
 * same order (rename BEFORE append, or the append adds a second lowtom; and
 * recolourDrumTracks joins both chains in the next task, after the rename, with
 * the CSS that defines what it writes),
 * and deliberately NOT the same function: a project body is an external
 * contract, the persist payload is private localStorage shape, and their
 * version numbers move for different reasons.
 *
 * `loops` only. A project body has no top-level sequencerTracks — the content
 * set is PROJECT_CONTENT_KEYS and sequencerTracks is a per-loop field — so a
 * top-level branch here would be dead code claiming a key exists.
 *
 * A project this app wrote reopens sounding the way it sounded when it was
 * closed: the renamed row keeps its steps, the four appended rows are empty,
 * 'Club Standard' is the same kit object '909 Modern' was, and a colour is not
 * a sound.
 */
function upgradeDrumVoicesV6(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (loop) => {
    const rekitted = renameSoundKit(loop, '909 Modern', 'Club Standard');
    if (!Array.isArray(rekitted.sequencerTracks)) return rekitted;
    const tracks = rekitted.sequencerTracks as SequencerTrack[];
    // Task 9 appends recolourDrumTracks here, with the CSS that defines what it writes.
    return { ...rekitted, sequencerTracks: withDrumTracks(renameDrumTrack(tracks, 'tom', 'lowtom')) };
  });
}
```

Add the step to `migrateProjectBody`, and extend the import at line 9:

```ts
import { defaultPadState, renameDrumTrack, renameSoundKit, withDrumTracks } from './initialState';
// …
  if (fromVersion < 6) next = upgradeDrumVoicesV6(next);
```

Two neighbouring docblocks go stale the moment `INITIAL_SEQUENCER_TRACKS` grows, because both
describe what `withDrumTracks` appends and both were written when it appended two. Correct the
sentence in each — `src/store/migrate.ts`'s `migrateDrumTracks` (v13) and
`src/store/projectFormatMigrate.ts:145–152`'s `upgradeDrumTracksV5` (v5):

```
 * NOTE, since INITIAL_SEQUENCER_TRACKS grew: this step now appends the eleven
 * canonical tracks, not two, so a pre-v5 body leaves it holding a blank
 * `lowtom` beside its own `tom` row. The v6 step is what resolves that — its
 * renameDrumTrack drops a BLANK target row and renames into it. The factory
 * beats are unchanged (kick 4 active steps, snare 2, hihat 8, openhat 1,
 * clap 2); the other six canonical rows are empty.
```

In `src/store/projectFormat.ts`, set the constant and extend its docblock:

```ts
 * v5 adds the `tom` and `crash` sequencer tracks to every loop. It moved in
 * the same change as persist v13 and by coincidence only — the two numbers
 * answer different questions and must never be assumed to track each other.
 *
 * v6 is the eleven-voice kit: `tom` becomes `lowtom`, `rimshot`/`hitom`/`ride`/
 * `bell` are appended silent, and the `909 Modern` kit name becomes
 * `Club Standard`.
 */
export const PROJECT_FORMAT_VERSION = 6;
```

- [ ] **Step 12: Run the `.solna` tests**

Run: `bun test src/store/projectFormatMigrate.test.ts src/store/projectFormat.test.ts`
Expected: PASS.

- [ ] **Step 13: Rename the kit in the data layer**

Four literal edits and one comment:

```ts
// src/data/drumKits.ts:90
  'Club Standard': {

// src/data/drumGrids.ts:119
    kit: 'Club Standard',

// src/data/vibes.ts:280,283
    // Beat: Club Standard club drums
    soundKit: 'Club Standard',

// scripts/check-drum-kit-separation.ts:106 — comment only
// the ten in between: Club Standard and Warehouse were measurably twins and
```

The name is evocative rather than referential on purpose: retuning raised the kit's kick but left
the hi-hat claim exactly as false as it was, and **fixing the sound cannot justify a machine name**
(`drum-kit-identities.md` §5.3, §5.4).

- [ ] **Step 14: Run the full gate for this task**

Run: `bun test && bun run lint && bun run check:drums`
Expected: PASS. If `src/store/instantVibesDrums.test.ts` or `src/store/vibes.test.ts` fails on the
kit name, update the expected string there — `cyber-edm` is the one vibe that names this kit.

- [ ] **Step 15: Commit**

```bash
git add src/store src/data scripts/check-drum-kit-separation.ts
git commit -m "feat(store): migrate both chains to the eleven-voice kit and rename 909 Modern

renameDrumTrack (tom -> lowtom) runs before withDrumTracks in both chains, so a
user's programmed tom row survives instead of being silenced beside a blank
lowtom. renameSoundKit carries 909 Modern -> Club Standard. Persist 13 -> 14,
PROJECT_FORMAT_VERSION 5 -> 6; the chains share the pure transforms and nothing
else.

recolourDrumTracks lands here as a tested pure function but is NOT yet wired into
either chain: the bg-drum-* classes it writes do not exist until the theme commit,
so the wiring ships there. No further version bump — the slice ships together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 8: Eleven sequencer tracks, eleven pads, three free key codes

`INITIAL_SEQUENCER_TRACKS` goes from seven entries to eleven in the canonical order of decision 1,
and `DEFAULT_PADS` from eight to eleven. **Two existing pads are corrected**: the `hightom` pad's
`note` becomes `'hitom'` and its dead `pitch: 4` is removed (it was pitching a voice the engine
never pitched), and the `lowtom` pad's `note` becomes `'lowtom'`, which is what its id has always
claimed.

**The three free key codes are measured, not left to the implementer.** Today's eight pads use
`KeyZ KeyX KeyC KeyV KeyM Comma Period Slash`; the synth keyboard uses
`KeyA KeyW KeyS KeyE KeyD KeyF KeyT KeyG KeyY KeyH KeyU KeyJ KeyK KeyO KeyL KeyP Semicolon Quote`.
Run:

```bash
bun -e '
const {KEYBOARD_NOTES}=await import("./src/components/loop/SynthView.tsx");
const {DEFAULT_PADS}=await import("./src/components/ui/DrumPadGrid.tsx");
const VALID=[...Array(26)].map((_,i)=>"Key"+String.fromCharCode(65+i))
  .concat([...Array(10)].map((_,i)=>"Digit"+i))
  .concat(["Comma","Period","Slash","Semicolon","Quote","BracketLeft","BracketRight","Minus","Equal"]);
const used=new Set([...KEYBOARD_NOTES.map(k=>k.key),...DEFAULT_PADS.map(p=>p.shortcut)]);
console.log(VALID.filter(c=>!used.has(c)).join(" "));'
```

Measured output: `KeyB KeyI KeyN KeyQ KeyR Digit0…Digit9 BracketLeft BracketRight Minus Equal`.
**The three chosen: `KeyB` (rimshot), `KeyN` (ride), `KeyQ` (bell).** `KeyB` and `KeyN` complete the
bottom row `Z X C V B N M , . /` — ten physically contiguous drum keys — and `KeyQ` is the one
free key on the row above, sitting over the synth's `KeyA`. All three pass
`scripts/check-key-bindings.ts`'s `VALID_CODE` regex (`Key[A-Z]`), and `bun run check:keys` is the
arbiter.

**Pads are not persisted.** `useInputDeck.ts:396` holds them in `useState(DEFAULT_PADS)`, so
reordering the array, renaming a pad id or changing a `note` needs no migration — only Task 7's
`sequencerTracks` do.

**Files:**
- Modify: `src/store/initialState.ts:45–113` (`INITIAL_SEQUENCER_TRACKS`)
- Modify: `src/components/ui/DrumPadGrid.tsx:17` (`DEFAULT_PADS`)
- Test: `src/store/initialState.test.ts` — **two seven-voice literals live here and this task owns
  both**: `:133` asserts the instrument roster `withDrumTracks` restores onto a two-track payload
  (and `:148–149` index the last two appended rows, which are no longer `tom` and `crash`), and
  `:158–166` is the `INITIAL_SEQUENCER_TRACKS` block whose first half asserts the seven-instrument
  roster — its second half, the colour list at `:162–165`, is **Task 9's**, not this task's, and its
  trailing note about "NINE after slice 2's ride and bell" is answered by Task 9 and deleted there
- Test: `src/components/ui/DrumPadGrid.test.tsx`, `bun run check:keys`

**Interfaces:**
- Consumes: `DRUM_TYPES` (the eleven-member list) and the eleven-field `DrumKit` from part 1;
  `SILENT_BAR` (`initialState.ts:38`, module-private, one empty bar at `MAX_STEPS_PER_BAR` = 24,
  **spread at each use site, never shared**); `renameDrumTrack` from Task 7.
- Produces: eleven `INITIAL_SEQUENCER_TRACKS` entries whose `instrument` values equal `DRUM_TYPES`
  member-for-member and in order; eleven `DEFAULT_PADS` entries in the same order. Task 9 replaces
  the `color` of all eleven tracks and all eleven pads.

**The four new tracks carry semantic colours in this task and Task 9 replaces all eleven in one
pass.** They are placed knowingly and briefly: `--color-drum-*` does not exist until Task 9, and a
class naming a token that does not exist renders as nothing at all.

- [ ] **Step 1: Write the failing track test**

Add to `src/store/initialState.test.ts`:

```ts
import { DRUM_TYPES } from '../data/drumKits';

test('the sequencer ships one track per drum voice, in the canonical order', () => {
  expect(INITIAL_SEQUENCER_TRACKS.map((t) => t.instrument)).toEqual([...DRUM_TYPES]);
});

test('every track id follows its instrument, and every bar is stored at the widest width', () => {
  for (const track of INITIAL_SEQUENCER_TRACKS) {
    expect(track.id, `${track.instrument} id`).toBe(`track-${track.instrument}`);
    expect(track.steps, `${track.instrument} bar width`).toHaveLength(24);
  }
});

test('the four new voices ship silent — a fresh session sounds like the old one plus nothing', () => {
  for (const added of ['rimshot', 'hitom', 'ride', 'bell']) {
    const track = INITIAL_SEQUENCER_TRACKS.find((t) => t.instrument === added)!;
    expect(track.steps.some(Boolean), `${added} must ship silent`).toBe(false);
  }
});

test('the factory beat that was on `tom` is now on `lowtom`, and it is still empty', () => {
  expect(INITIAL_SEQUENCER_TRACKS.some((t) => t.instrument === 'tom')).toBe(false);
  const lowtom = INITIAL_SEQUENCER_TRACKS.find((t) => t.instrument === 'lowtom')!;
  expect(lowtom.steps.some(Boolean)).toBe(false);
});

test('no two tracks share a steps array', () => {
  const arrays = INITIAL_SEQUENCER_TRACKS.map((t) => t.steps);
  expect(new Set(arrays).size).toBe(arrays.length);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/store/initialState.test.ts -t "canonical order"`
Expected: FAIL — the received list is the seven-voice one ending `…, 'tom', 'crash'`.

- [ ] **Step 3: Rewrite `INITIAL_SEQUENCER_TRACKS`**

Replace `src/store/initialState.ts:45–113` with the eleven entries. The five factory beats
(kick 4 hits, snare 2, hihat 8, openhat 1, clap 2) are byte-identical to today's; the six other
rows are `[...SILENT_BAR]`:

```ts
export const INITIAL_SEQUENCER_TRACKS: SequencerTrack[] = [
  {
    id: 'track-kick', name: 'Kick 808', instrument: 'kick',
    steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.9, muted: false, color: 'bg-error',
  },
  {
    id: 'track-snare', name: 'Snare Snap', instrument: 'snare',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.85, muted: false, color: 'bg-warning',
  },
  {
    id: 'track-rimshot', name: 'Rim Shot', instrument: 'rimshot',
    steps: [...SILENT_BAR], volume: 0.8, muted: false, color: 'bg-secondary',
  },
  {
    id: 'track-clap', name: 'Hand Clap', instrument: 'clap',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.85, muted: false, color: 'bg-secondary',
  },
  {
    id: 'track-hihat', name: 'Closed Hat', instrument: 'hihat',
    steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false, false, false, false, false, false, false],
    volume: 0.75, muted: false, color: 'bg-success',
  },
  {
    id: 'track-openhat', name: 'Open Hat', instrument: 'openhat',
    steps: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.8, muted: false, color: 'bg-accent',
  },
  {
    id: 'track-hitom', name: 'Hi Tom', instrument: 'hitom',
    steps: [...SILENT_BAR], volume: 0.8, muted: false, color: 'bg-primary',
  },
  {
    id: 'track-lowtom', name: 'Low Tom', instrument: 'lowtom',
    steps: [...SILENT_BAR], volume: 0.8, muted: false, color: 'bg-primary',
  },
  {
    id: 'track-ride', name: 'Ride', instrument: 'ride',
    steps: [...SILENT_BAR], volume: 0.7, muted: false, color: 'bg-accent',
  },
  {
    id: 'track-crash', name: 'Crash', instrument: 'crash',
    steps: [...SILENT_BAR], volume: 0.7, muted: false, color: 'bg-info',
  },
  {
    id: 'track-bell', name: 'Bell', instrument: 'bell',
    steps: [...SILENT_BAR], volume: 0.7, muted: false, color: 'bg-info',
  },
];
```

- [ ] **Step 4: Run the track tests**

Run: `bun test src/store/initialState.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing pad test**

Add to `src/components/ui/DrumPadGrid.test.tsx`:

```ts
import { DRUM_TYPES } from '../../data/drumKits';

test('there is one pad per drum voice, in the canonical order', () => {
  expect(DEFAULT_PADS.map((p) => p.note)).toEqual([...DRUM_TYPES]);
});

test('the two tom pads name the voice they actually play', () => {
  // The High Tom pad used to play `tom` with a dead `pitch: 4` — the engine
  // never read it, so the two tom pads were the same drum at the same pitch.
  const hitom = DEFAULT_PADS.find((p) => p.id === 'hitom')!;
  expect(hitom.note).toBe('hitom');
  expect(hitom.pitch).toBe(0);
  expect(DEFAULT_PADS.find((p) => p.id === 'lowtom')!.note).toBe('lowtom');
});

test('the three new shortcuts are free of the synth map and of each other', () => {
  const codes = DEFAULT_PADS.map((p) => p.shortcut);
  expect(new Set(codes).size).toBe(codes.length);
  expect(codes).toContain('KeyB');
  expect(codes).toContain('KeyN');
  expect(codes).toContain('KeyQ');
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test src/components/ui/DrumPadGrid.test.tsx`
Expected: FAIL — the received note list is eight long and holds `'tom'` twice.

- [ ] **Step 7: Rewrite `DEFAULT_PADS`**

Replace the array at `src/components/ui/DrumPadGrid.tsx:17`. Colours here are the existing
three-way semantic rotation and Task 9 replaces every one of them:

```ts
export const DEFAULT_PADS: DrumPad[] = [
  { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'KeyZ', volume: 0.9, pitch: 0, decay: 0.3 },
  { id: 'snare', name: 'Snare Snap', note: 'snare', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'KeyX', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'rimshot', name: 'Rim Shot', note: 'rimshot', color: 'from-accent to-accent/60 text-accent-content', shortcut: 'KeyB', volume: 0.8, pitch: 0, decay: 0.12 },
  { id: 'clap', name: 'Hand Clap', note: 'clap', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'KeyM', volume: 0.85, pitch: 0, decay: 0.2 },
  { id: 'hihat', name: 'Closed Hat', note: 'hihat', color: 'from-accent to-accent/60 text-accent-content', shortcut: 'KeyC', volume: 0.75, pitch: 0, decay: 0.05 },
  { id: 'openhat', name: 'Open Hat', note: 'openhat', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'KeyV', volume: 0.8, pitch: 0, decay: 0.35 },
  { id: 'hitom', name: 'Hi Tom', note: 'hitom', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'Period', volume: 0.8, pitch: 0, decay: 0.2 },
  { id: 'lowtom', name: 'Low Tom', note: 'lowtom', color: 'from-accent to-accent/60 text-accent-content', shortcut: 'Comma', volume: 0.8, pitch: 0, decay: 0.25 },
  { id: 'ride', name: 'Ride Cymbal', note: 'ride', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'KeyN', volume: 0.75, pitch: 0, decay: 0.9 },
  { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'Slash', volume: 0.75, pitch: 0, decay: 0.8 },
  { id: 'bell', name: 'Bell', note: 'bell', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'KeyQ', volume: 0.7, pitch: 0, decay: 0.4 },
];
```

The `hightom` pad id becomes `hitom` so that one voice has one name across the kit table, the
track list, the pad grid and the grid rows — the same "one order, written down once" argument as
decision 1. Nothing persists a pad id.

- [ ] **Step 8: Run the pad tests, the key check, and Task 7's order test again**

Run: `bun test src/components/ui/DrumPadGrid.test.tsx src/store/initialState.test.ts && bun run check:keys`
Expected: PASS, and `check:keys` prints `no drum/synth overlap (none)` plus
`drum pads unique (KeyZ KeyX KeyB KeyM KeyC KeyV Period Comma KeyN Slash KeyQ)`.
Task 7's `renameDrumTrack runs BEFORE withDrumTracks` test now has a `lowtom` in
`INITIAL_SEQUENCER_TRACKS` to append, so it is meaningful from here on — confirm it is green.

- [ ] **Step 9: Run the full suite and note what Task 9 must fix**

Run: `bun test`
Expected: `src/components/loop/SequencerView.test.tsx` and any snapshot of the pad grid may fail on
row/pad COUNT. Fix count expectations here; leave every colour expectation alone — Task 9 owns
those and will fail loudly if it forgets one.

- [ ] **Step 10: Commit**

```bash
git add src/store/initialState.ts src/components/ui/DrumPadGrid.tsx src/store/initialState.test.ts src/components/ui/DrumPadGrid.test.tsx src/components/loop/SequencerView.test.tsx
git commit -m "feat(sequencer): eleven drum tracks and eleven pads in canonical order

DEFAULT_PADS gains rimshot (KeyB), ride (KeyN) and bell (KeyQ) — the three codes
measured free against both the pad row and the synth map — and the two tom pads
stop lying: hightom played \`tom\` with a dead pitch: 4, and now plays \`hitom\`.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 9: Eleven `--color-drum-*` colours, both themes

**The seven existing tracks are recoloured onto the new namespace along with the four new ones —
not seven semantic tokens plus four new colours.** A mixed scheme would make the four families
unreadable and would leave the sequencer as the one surface in the app where colour means two
different things.

**Raw Tailwind palette classes are not an option.** `scripts/themeTokenGuard.ts` fails the build on
22 palette families, its `ALLOWLIST` is empty (`themeTokenGuard.ts:106`) and three shrink tests
(`themeTokenGuard.test.ts:252`, `:255`, `:259`) make re-populating it fail. Follow the
`--color-module-*` precedent at `src/index.css:122–160`: per-theme `--drum-*` variables exposed
through an `@theme` block as `--color-drum-*`.

**The rule:** four family anchors at least 60° apart on the **OKLCH** wheel (not sRGB HSL, which
bunches the yellows); members of a family never more than ~14° apart; a fixed lightness per theme,
~0.75 dark and ~0.57 light, varied only where the family separates by lightness. Anchors are
**0° / 90° / 180° / 270°** — 90° apart, the maximum available for four families, and all four
clear of the amber band.

| family | members | separation | hues |
|---|---|---|---|
| heads | kick, snare, rimshot, clap | hue **and** lightness — four members is too many for lightness alone | 0 / 5 / 9 / 14 |
| hats | hihat, openhat | **one hue**; lightness only — sharing a hue is what makes slice 3's choke group visible in the grid | 90 / 90 |
| toms | hitom, lowtom | one hue, **lightness only**, hitom lighter, so high/low reads off brightness | 180 / 180 |
| metals | ride, crash, bell | hue ±12° at one lightness | 258 / 270 / 282 |

**Ruling R2 governs the amber band:** the 20–60° band belongs to `--color-primary`, with
`--module-pad` as the one recorded exception; no new colour may enter it. Every drum hue above is
outside 20–60°. The dark-theme `--module-pad` entry gains the exception note its light-theme
sibling already carries.

**No drum colour reuses a semantic hex.** Verified — none of the 22 values below appears among the
56 hex literals already in `src/index.css`:

```bash
bun -e 'const css=await Bun.file("src/index.css").text();
const have=new Set((css.match(/#[0-9A-Fa-f]{6}/g)||[]).map(s=>s.toUpperCase()));
const mine=["#DD628E","#F8789A","#FF9DAE","#FFBDC2","#E6B816","#BA9300","#00E3C8","#00AA95","#79AFFF","#8EA9FF","#A1A3FF","#8B0F49","#A82E57","#C54866","#E26274","#A48100","#7A6000","#00A38F","#006D5F","#3475D3","#546ED4","#6B67D2"];
console.log(mine.filter(h=>have.has(h)).join(", ")||"none");'
```

Scope note from the spec: the eleven need only be mutually separable *within the sequencer*. No
drum colour and no module colour ever share a surface, so these hues need not thread the module
ladder's gaps (87 / 125 / 162 / 213 / 256 / 294 / 322 / 356°).

**The eleven values, both themes.** Chroma is the sRGB gamut maximum at that L and h, capped at
0.16; content colours are whichever of the theme's two ink colours clears 4.5:1 (worst case 4.51).

| voice | dark hex | dark L·C·h | dark content | light hex | light L·C·h | light content |
|---|---|---|---|---|---|---|
| kick | `#DD628E` | 0.66 · 0.160 · 0 | `#17100F` (5.56) | `#8B0F49` | 0.42 · 0.160 · 0 | `#FFFFFF` (9.28) |
| snare | `#F8789A` | 0.73 · 0.160 · 5 | `#17100F` (7.29) | `#A82E57` | 0.50 · 0.160 · 5 | `#FFFFFF` (6.58) |
| rimshot | `#FF9DAE` | 0.80 · 0.118 · 9 | `#17100F` (9.56) | `#C54866` | 0.58 · 0.160 · 9 | `#FFFFFF` (4.67) |
| clap | `#FFBDC2` | 0.86 · 0.076 · 14 | `#17100F` (11.91) | `#E26274` | 0.66 · 0.160 · 14 | `#2A1A20` (4.92) |
| hihat | `#E6B816` | 0.80 · 0.160 · 90 | `#17100F` (10.05) | `#A48100` | 0.62 · 0.127 · 90 | `#2A1A20` (4.51) |
| openhat | `#BA9300` | 0.68 · 0.139 · 90 | `#17100F` (6.50) | `#7A6000` | 0.50 · 0.103 · 90 | `#FFFFFF` (6.00) |
| hitom | `#00E3C8` | 0.82 · 0.149 · 180 | `#17100F` (11.47) | `#00A38F` | 0.64 · 0.116 · 180 | `#2A1A20` (5.24) |
| lowtom | `#00AA95` | 0.66 · 0.120 · 180 | `#17100F` (6.43) | `#006D5F` | 0.48 · 0.088 · 180 | `#FFFFFF` (6.26) |
| ride | `#79AFFF` | 0.75 · 0.129 · 258 | `#17100F` (8.40) | `#3475D3` | 0.57 · 0.160 · 258 | `#FFFFFF` (4.53) |
| crash | `#8EA9FF` | 0.75 · 0.128 · 270 | `#17100F` (8.30) | `#546ED4` | 0.57 · 0.160 · 270 | `#FFFFFF` (4.61) |
| bell | `#A1A3FF` | 0.75 · 0.132 · 282 | `#17100F` (8.23) | `#6B67D2` | 0.57 · 0.160 · 282 | `#FFFFFF` (4.67) |

**Files:**
- Modify: `src/index.css` — the module-colour comment (R2), a new drum-colour comment, the `@theme`
  block, and both theme blocks (`:root, [data-theme="solna-dark"]` and `[data-theme="solna-light"]`)
- Modify: `src/store/initialState.ts` — the `color` of all eleven tracks
- Modify: `src/store/migrate.ts` and `src/store/projectFormatMigrate.ts` — append
  `recolourDrumTracks` to both chains (Task 7 landed the transform unwired)
- Modify: `src/components/ui/DrumPadGrid.tsx` — the `color` of all eleven pads
- Test: `src/store/initialState.test.ts:162–165` (the colour list — the OTHER seven-voice literal in
  that file; Task 8 owns the instrument rosters at `:133` and `:158`) and the note beneath it that
  records "eight non-surface tokens, NINE tracks after slice 2" as an open problem, which this task
  answers and therefore deletes; `src/components/loop/SequencerView.test.tsx:81–85`;
  `bun run check:theme`

**Interfaces:**
- Consumes: the eleven tracks and eleven pads of Task 8; `DRUM_TYPES` from part 1;
  `recolourDrumTracks(tracks: SequencerTrack[]): SequencerTrack[]` from Task 7, which has shipped
  tested but unwired — **this task is where it is called**, because it writes the very class names
  the CSS below defines.
- Produces: CSS custom properties `--color-drum-<voice>` and `--color-drum-<voice>-content` for the
  eleven voices; the class convention **`bg-drum-<instrument>`** for a track's `color` and
  **`from-drum-<instrument> to-drum-<instrument>/60 text-drum-<instrument>-content`** for a pad's.
  Nothing else consumes these; `THEME_TOKENS` in `src/utils/themeColor.ts` is the visualiser's
  semantic palette and stays twelve entries — module colours are not in it either.

- [ ] **Step 1: Write the failing token test**

Add to `src/store/initialState.test.ts` (replacing the semantic-colour list at `:164`):

```ts
test('every track is coloured from the drum namespace, one token per voice', () => {
  expect(INITIAL_SEQUENCER_TRACKS.map((t) => t.color)).toEqual(
    DRUM_TYPES.map((voice) => `bg-drum-${voice}`),
  );
});
```

And to `src/components/ui/DrumPadGrid.test.tsx`:

```ts
test('every pad is coloured from the drum namespace, one token per voice', () => {
  for (const pad of DEFAULT_PADS) {
    expect(pad.color, `${pad.id} colour`).toBe(
      `from-drum-${pad.note} to-drum-${pad.note}/60 text-drum-${pad.note}-content`,
    );
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/store/initialState.test.ts src/components/ui/DrumPadGrid.test.tsx -t "drum namespace"`
Expected: FAIL — received `bg-error`, `from-primary to-primary/60 text-primary-content`, and so on.

- [ ] **Step 3: Restate the amber-band comment and add the drum-colour comment**

In `src/index.css`, in the module-colour comment (around `:137–141`), replace the amber sentence:

```
   Every adjacent pair is at least 28° apart. Two rules constrain the set:
   the 20-60° amber band belongs to --color-primary, with --module-pad as the
   ONE recorded exception (it sits at 40° in both themes, darkened off
   --color-warning in light) — no further colour, module or drum, may enter the
   band; and no module may reuse a semantic hex, which is what --module-filter
   and --color-secondary used to do (both #FB7185).
```

Then add, directly under the module `@theme` block:

```
/* Drum voice colours. Eleven sequencer tracks against eight semantic tokens is
   three collisions by arithmetic, so the drum voices get their own namespace on
   the same indirection pattern as the module colours above — and ALL eleven
   move, not the four new ones, because a half-semantic sequencer would make the
   families below unreadable.

   Four families, four anchors 90° apart on the OKLCH wheel, members never more
   than 14° apart:

     heads   kick 0° · snare 5° · rimshot 9° · clap 14°   (hue AND lightness)
     hats    hihat · openhat at 90°   — ONE hue: sharing it is what makes the
             hi-hat choke group visible in the grid
     toms    hitom · lowtom at 180°   — lightness only, hitom lighter, so high
             and low read off brightness rather than colour
     metals  ride 258° · crash 270° · bell 282°

   The same two rules as the modules: no drum colour reuses a semantic hex, and
   none enters the 20-60° amber band. The eleven need only be separable from
   EACH OTHER — no drum colour and no module colour ever share a surface — so
   they do not thread the module ladder's gaps. */
@theme {
  --color-drum-kick: var(--drum-kick);
  --color-drum-kick-content: var(--drum-kick-content);
  --color-drum-snare: var(--drum-snare);
  --color-drum-snare-content: var(--drum-snare-content);
  --color-drum-rimshot: var(--drum-rimshot);
  --color-drum-rimshot-content: var(--drum-rimshot-content);
  --color-drum-clap: var(--drum-clap);
  --color-drum-clap-content: var(--drum-clap-content);
  --color-drum-hihat: var(--drum-hihat);
  --color-drum-hihat-content: var(--drum-hihat-content);
  --color-drum-openhat: var(--drum-openhat);
  --color-drum-openhat-content: var(--drum-openhat-content);
  --color-drum-hitom: var(--drum-hitom);
  --color-drum-hitom-content: var(--drum-hitom-content);
  --color-drum-lowtom: var(--drum-lowtom);
  --color-drum-lowtom-content: var(--drum-lowtom-content);
  --color-drum-ride: var(--drum-ride);
  --color-drum-ride-content: var(--drum-ride-content);
  --color-drum-crash: var(--drum-crash);
  --color-drum-crash-content: var(--drum-crash-content);
  --color-drum-bell: var(--drum-bell);
  --color-drum-bell-content: var(--drum-bell-content);
}
```

- [ ] **Step 4: Add the dark-theme values**

In `:root, [data-theme="solna-dark"]`, after the module block and before the canvas gradient. Also
append the exception note to the existing `--module-pad` line there, so the dark entry documents
what its light sibling already does:

```css
  --module-pad: #F0B265;          /* amber 40° — the ONE recorded exception to
                                     the 20-60° band; see the comment above */

  /* L 0.66-0.86 in OKLCH; chroma is the sRGB ceiling at that L and hue, capped
     at 0.16. Content is the ember ink at 5.6:1 or better throughout. */
  --drum-kick: #DD628E;           /* L0.66 C0.160 h0   — heads, darkest: the lowest drum */
  --drum-kick-content: #17100F;
  --drum-snare: #F8789A;          /* L0.73 C0.160 h5 */
  --drum-snare-content: #17100F;
  --drum-rimshot: #FF9DAE;        /* L0.80 C0.118 h9 */
  --drum-rimshot-content: #17100F;
  --drum-clap: #FFBDC2;           /* L0.86 C0.076 h14  — heads, lightest */
  --drum-clap-content: #17100F;
  --drum-hihat: #E6B816;          /* L0.80 C0.160 h90  — hats share the hue */
  --drum-hihat-content: #17100F;
  --drum-openhat: #BA9300;        /* L0.68 C0.139 h90 */
  --drum-openhat-content: #17100F;
  --drum-hitom: #00E3C8;          /* L0.82 C0.149 h180 — toms: lightness only */
  --drum-hitom-content: #17100F;
  --drum-lowtom: #00AA95;         /* L0.66 C0.120 h180 */
  --drum-lowtom-content: #17100F;
  --drum-ride: #79AFFF;           /* L0.75 C0.129 h258 — metals, ±12° */
  --drum-ride-content: #17100F;
  --drum-crash: #8EA9FF;          /* L0.75 C0.128 h270 */
  --drum-crash-content: #17100F;
  --drum-bell: #A1A3FF;           /* L0.75 C0.132 h282 */
  --drum-bell-content: #17100F;
```

- [ ] **Step 5: Add the light-theme values**

In `[data-theme="solna-light"]`, after the module block:

```css
  /* L 0.42-0.66 — the dark set's lightness washes out on warm paper. Content is
     white where the fill is dark and the ink colour where it is light; the worst
     pair is hihat at 4.51:1. */
  --drum-kick: #8B0F49;           /* L0.42 C0.160 h0 */
  --drum-kick-content: #FFFFFF;
  --drum-snare: #A82E57;          /* L0.50 C0.160 h5 */
  --drum-snare-content: #FFFFFF;
  --drum-rimshot: #C54866;        /* L0.58 C0.160 h9 */
  --drum-rimshot-content: #FFFFFF;
  --drum-clap: #E26274;           /* L0.66 C0.160 h14 */
  --drum-clap-content: #2A1A20;
  --drum-hihat: #A48100;          /* L0.62 C0.127 h90 */
  --drum-hihat-content: #2A1A20;
  --drum-openhat: #7A6000;        /* L0.50 C0.103 h90 */
  --drum-openhat-content: #FFFFFF;
  --drum-hitom: #00A38F;          /* L0.64 C0.116 h180 */
  --drum-hitom-content: #2A1A20;
  --drum-lowtom: #006D5F;         /* L0.48 C0.088 h180 */
  --drum-lowtom-content: #FFFFFF;
  --drum-ride: #3475D3;           /* L0.57 C0.160 h258 */
  --drum-ride-content: #FFFFFF;
  --drum-crash: #546ED4;          /* L0.57 C0.160 h270 */
  --drum-crash-content: #FFFFFF;
  --drum-bell: #6B67D2;           /* L0.57 C0.160 h282 */
  --drum-bell-content: #FFFFFF;
```

- [ ] **Step 6: Recolour the eleven tracks and the eleven pads**

In `src/store/initialState.ts`, replace each track's `color` with `bg-drum-<instrument>`:
`bg-drum-kick`, `bg-drum-snare`, `bg-drum-rimshot`, `bg-drum-clap`, `bg-drum-hihat`,
`bg-drum-openhat`, `bg-drum-hitom`, `bg-drum-lowtom`, `bg-drum-ride`, `bg-drum-crash`,
`bg-drum-bell`.

In `src/components/ui/DrumPadGrid.tsx`, replace each pad's `color` with the three-class gradient
form, e.g. for the kick and the bell:

```ts
  { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-drum-kick to-drum-kick/60 text-drum-kick-content', shortcut: 'KeyZ', volume: 0.9, pitch: 0, decay: 0.3 },
  // …
  { id: 'bell', name: 'Bell', note: 'bell', color: 'from-drum-bell to-drum-bell/60 text-drum-bell-content', shortcut: 'KeyQ', volume: 0.7, pitch: 0, decay: 0.4 },
```

- [ ] **Step 7: Fix the two colour assertions that pin the old scheme**

`src/components/loop/SequencerView.test.tsx:81–85` asserts the rendered HTML contains `bg-error`,
`bg-warning`, `bg-success`, `bg-accent` and `bg-secondary`. Replace those five lines with the
eleven that are now true:

```ts
    for (const voice of DRUM_TYPES) {
      expect(html, `${voice} row colour`).toContain(`bg-drum-${voice}`);
    }
```

`src/store/initialState.test.ts:162–165`'s literal list of five semantic classes is replaced by
step 1's test; delete the old assertion rather than keeping both, and delete the note under it that
says eight tokens cannot cover nine tracks — this task is the answer to it, so leaving it would
read as an open question that has been closed.

- [ ] **Step 8: Re-measure all 22 contrast ratios and print the floor**

**The floor is 4.51:1 — it clears AA by 0.01, and a margin that thin will not survive an unmeasured
tweak.** Run this after ANY hue or lightness nudge, including one made during Task 12's step 11
theme pass, and read the number it prints:

```bash
bun -e '
const lin=(v)=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4};
const L=(h)=>0.2126*lin(parseInt(h.slice(1,3),16))+0.7152*lin(parseInt(h.slice(3,5),16))+0.0722*lin(parseInt(h.slice(5,7),16));
const cr=(a,b)=>{const[x,y]=[L(a),L(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05)};
const css=await Bun.file("src/index.css").text();
const val=(block,name)=>block.match(new RegExp("--"+name+":\\\\s*(#[0-9A-Fa-f]{6})"))[1];
const dark=css.slice(css.indexOf("[data-theme=\"solna-dark\"]"),css.indexOf("[data-theme=\"solna-light\"]"));
const light=css.slice(css.indexOf("[data-theme=\"solna-light\"]"));
const voices=["kick","snare","rimshot","clap","hihat","openhat","hitom","lowtom","ride","crash","bell"];
let floor=Infinity, worst="";
for(const [label,block] of [["dark",dark],["light",light]])
  for(const v of voices){
    const r=cr(val(block,"drum-"+v),val(block,"drum-"+v+"-content"));
    if(r<floor){floor=r;worst=label+" "+v}
    console.log(label.padEnd(6),v.padEnd(8),r.toFixed(2));
  }
console.log("FLOOR", floor.toFixed(2), "at", worst, floor>=4.5?"— clears AA":"— FAILS AA, retune");
if(floor<4.5) process.exit(1);'
```

Expected: 22 lines and `FLOOR 4.51 at light hihat — clears AA`. If a nudge drops it below 4.5, the
fix is the *content* colour or the fill's lightness, never the assertion.

- [ ] **Step 9: Wire `recolourDrumTracks` into both chains, in this commit**

Task 7 landed the transform and its unit tests but called it from neither chain, so that no commit
would ever write a class name with no CSS behind it. The classes exist as of step 3; the wiring goes
in now. **No version moves** — the slice ships together (decision 29), so persist v14 and
`PROJECT_FORMAT_VERSION` 6 are simply not final until this commit.

In `src/store/migrate.ts`, inside `migrateDrumVoices`, and identically in
`src/store/projectFormatMigrate.ts`'s `upgradeDrumVoicesV6` (two separate edits to two functions
that are never merged):

```ts
    const shaped = withDrumTracks(renameDrumTrack(tracks, 'tom', 'lowtom'));
    return { ...rekitted, sequencerTracks: recolourDrumTracks(shaped) };
```

…adding `recolourDrumTracks` to each file's existing import from `./initialState`.

Then the chain-level assertions, in `src/store/migrate.test.ts` beside the other
`migrateDrumVoices` tests:

```ts
  test('the seven factory colours move to the drum namespace; a chosen one does not', () => {
    const loop = v13Loop();
    loop.sequencerTracks[1] = { ...loop.sequencerTracks[1], color: 'bg-error' } as SequencerTrack; // user's snare
    const { loops } = migrateDrumVoices({ loops: [loop] }) as {
      loops: { sequencerTracks: SequencerTrack[] }[];
    };
    const colourOf = (i: string) =>
      loops[0].sequencerTracks.find((t) => t.instrument === i)!.color;
    expect(colourOf('kick')).toBe('bg-drum-kick');
    expect(colourOf('lowtom')).toBe('bg-drum-lowtom'); // was the `tom` row's bg-primary
    expect(colourOf('snare')).toBe('bg-error');        // the user's, untouched
  });
```

…and in `src/store/projectFormatMigrate.test.ts`, inside the existing v5 → v6 test:

```ts
    expect(lowtom[0].color).toBe('bg-drum-lowtom'); // bg-primary was the factory tom colour
    expect(loop.sequencerTracks.find((t) => t.instrument === 'kick')!.color).toBe('bg-drum-kick');
```

- [ ] **Step 10: Run the theme guard, the tests and the build**

Run: `bun run check:theme && bun test && bun run build`
Expected: PASS. The guard walks source for raw palette families and hex literals; `bg-drum-*` is a
token class, so it passes for the same reason `bg-module-chord` does. If the build reports an
unknown utility, the `@theme` block is missing an entry — Tailwind v4 generates
`bg-drum-<name>` only for a `--color-drum-<name>` declared there.

- [ ] **Step 11: Commit**

```bash
git add src/index.css src/store/initialState.ts src/store/migrate.ts src/store/projectFormatMigrate.ts src/store/migrate.test.ts src/store/projectFormatMigrate.test.ts src/components/ui/DrumPadGrid.tsx src/store/initialState.test.ts src/components/ui/DrumPadGrid.test.tsx src/components/loop/SequencerView.test.tsx
git commit -m "feat(theme): give the eleven drum voices their own colour namespace

Four families on four OKLCH anchors 90° apart: heads separate by hue and
lightness, hats share one hue so the choke group reads, toms share one hue and
separate by lightness alone, metals sit ±12°. All eleven move — a half-semantic
sequencer would make the families unreadable. Restates the 20-60° amber band as
--color-primary's with --module-pad as its one recorded exception. Also wires
recolourDrumTracks into both migration chains — it landed tested but unwired one
commit ago so that no commit would write a class with no CSS behind it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 10: `DrumKit.reference` for thirteen kits, and its test

`DrumGrid.provenance` applied to the audio domain. The kits are in exactly the state the grids were
in before provenance landed, and worse: **a kit's referent is *partially* reachable, and which part
is which is not derivable from the numbers.** Nothing in `drumKits.ts` says that the 909's kick
topology is ours and its cymbals are 6-bit PCM of real Paiste and Zildjian plates.

**`reachable` is per voice, and that is the whole point** — a per-kit score would average the
TR-909's analogue kick, snare, toms and clap together with hats, ride and crash that are samples and
**never will be** (`drum-kit-identities.md` §5.1, `…hats-and-cymbals.md` §1.3). Ruling R9 puts this
in slice 4 rather than slice 3 precisely so `reachable` is written once, after the four new voices
exist.

**`reference` is required, not optional.** An optional field makes omission the default and silence
indistinguishable from "nobody looked".

It stays inside the `src/data/` rules: a plain object literal on a literal — no import, no `new`,
no function, no impure global. Adding a kit remains an edit to that table and nothing else.

**Files:**
- Modify: `src/data/drumKits.ts` (the `DrumKit` interface and all thirteen entries)
- Modify: `src/data/drumKits.test.ts` (the two `reference` assertions + the allowlist)
- Modify: `src/store/vibes.test.ts:29` (the vacuous `soundKit` assertion)

**Interfaces:**
- Consumes: the thirteen authored kits and the eleven-field `DrumKit` from part 1; the key
  `'Club Standard'` from Task 7.
- Produces: `reference: { referent: string; source: string; reachable: string }` as a **required**
  member of `DrumKit`; the test-local allowlist `AUTHORED_KITS = ['Chrome Pulse', 'Club Standard']`.
  Nothing downstream reads `reference` at runtime — it is documentation the type system forces.

- [ ] **Step 1: Write the failing tests**

Add to `src/data/drumKits.test.ts`:

```ts
// Kits with no external referent. SHRINKS BY DEFAULT, GROWS ONLY DELIBERATELY:
// putting a name here is an edit a reviewer sees, which is the whole mechanism —
// it makes shipping an un-referenced kit an act rather than an omission.
//   Chrome Pulse — solna's own bright/hard/wet kit, tied to the Cyberpunk grid.
// Club Standard is deliberately NOT here. It was renamed off `909 Modern`
// because the NAME overclaimed; its reference still records the TR-909, with
// the per-voice split that is decision 7's own worked example. A rename is not
// an erasure, and this list is for kits with no referent at all.
const AUTHORED_KITS = ['Chrome Pulse'];

test('every kit records what it is modelled on, in all three fields', () => {
  for (const [name, kit] of Object.entries(DRUM_KITS)) {
    expect(kit.reference, `${name} has no reference`).toBeDefined();
    expect(kit.reference.referent.length, `${name} referent`).toBeGreaterThan(0);
    expect(kit.reference.source.length, `${name} source`).toBeGreaterThan(0);
    expect(kit.reference.reachable.length, `${name} reachable`).toBeGreaterThan(0);
  }
});

test("a kit claiming no referent says 'authored', and is on the allowlist", () => {
  const authored = Object.entries(DRUM_KITS)
    .filter(([, kit]) => kit.reference.referent === 'authored')
    .map(([name]) => name);
  expect(authored.sort()).toEqual([...AUTHORED_KITS].sort());
});

test('reachable names voices, because reachability is per voice and not per kit', () => {
  // The TR-909 is the proof: kick, snare, toms and clap are analogue and
  // genuinely reachable; hats, ride and crash are 6-bit PCM of real Paiste and
  // Zildjian cymbals and never will be. A per-kit score would average those
  // into a number that is true of no voice.
  for (const [name, kit] of Object.entries(DRUM_KITS)) {
    const namesAVoice = DRUM_TYPES.some((voice) => kit.reference.reachable.includes(voice));
    expect(namesAVoice, `${name} reachable names no voice`).toBe(true);
  }
});
```

And replace `src/store/vibes.test.ts:29`'s `expect(Boolean(vibe.soundKit))`:

```ts
    // Was `expect(Boolean(vibe.soundKit)).toBe(true)`, which passes on any
    // non-empty string — which is how three vibes shipped naming a kit that
    // resolved to nothing at all.
    expect(Object.keys(DRUM_KITS), `${vibe.id} names a kit that does not exist`)
      .toContain(vibe.soundKit);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/data/drumKits.test.ts src/store/vibes.test.ts`
Expected: FAIL — `kit.reference` is undefined for all thirteen; `vibes.test.ts` passes only if every
`soundKit` already resolves (it should, after slice 2 and Task 7 — if it fails, a vibe still names a
kit that is gone, and that is the bug this assertion exists to catch).

- [ ] **Step 3: Add the field to the interface**

In `src/data/drumKits.ts`, on the `DrumKit` interface:

```ts
  /**
   * What the kit is modelled on. Same discipline as DrumGrid.provenance:
   * 'authored' is an honest answer and an allowlisted one; never invent a
   * source to get off that list. `reachable` is the part that matters — it
   * records, PER VOICE, which parts of the referent this engine can approach
   * and which it cannot, so the next person retuning this kit knows what is a
   * gap and what is a wall. Required, not optional: an optional field makes
   * omission the default and silence indistinguishable from "nobody looked".
   */
  reference: { referent: string; source: string; reachable: string };
```

- [ ] **Step 4: Write the thirteen entries**

One `reference` per kit, at the end of each kit literal. `source` cites the research doc section
that holds the claim's own citations; `docs/research/2026-09-06-drum-kit-identities.md` is
abbreviated `kit-identities.md` here and written in full in the file.

```ts
// Retro Drive
  reference: {
    referent: 'LinnDrum / Oberheim DMX / Simmons SDS-V — early-80s pop and synthwave',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1 [1][2][3][4][34]',
    reachable:
      'hitom/lowtom yes — the Simmons toms are analogue SSM2044-filtered oscillators and a pitch ' +
      'envelope IS that topology; kick/snare/clap approximate only, the LinnDrum and DMX are 8-bit ' +
      'PCM; hihat/openhat/ride/crash/bell no, sampled at source; the gated snare needs an envelope ' +
      'on the reverb send, which the engine does not have.',
  },

// Club Standard — the worked example of why `reachable` is per voice.
// The NAME and the REFERENCE do different jobs: the name is what a user reads
// and must not claim a machine we cannot deliver, which is why this kit is no
// longer called `909 Modern`; `reference` is internal documentation whose whole
// purpose is recording PARTIAL reachability, so it keeps the referent.
  reference: {
    referent: 'Roland TR-909 — the house machine (Derrick May, Jeff Mills)',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1, §5.3 [5][6][7][4]',
    reachable:
      'kick/snare/rimshot/hitom/lowtom/clap YES — those voices are analogue on the machine and a ' +
      'glissando into a body with a click IS the 909 kick topology; hihat/openhat/ride/crash NO, ' +
      'and never will be: they are 6-bit PCM of real Paiste and Zildjian cymbals recorded by ' +
      'Atsushi Hoshiai, so no sample means no route, by construction rather than by difficulty. ' +
      'bell has no 909 referent at all and is ours. That split — half the kit reachable, half ' +
      'permanently not — is why the NAME dropped the machine claim while this field keeps it.',
  },

// Trap Beat
  reference: {
    referent: 'the TR-808 kick used as a tuned sustained sub, plus fast bright hats',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [8][9][10]',
    reachable:
      'kick yes, and closest in the library — a long low sine IS the sound; hihat/openhat yes as ' +
      'noise; snare/rimshot yes, thin and bright is a parameter setting; ride/crash/bell approximate; ' +
      'key-tracking the kick to the song is missing engine-side, not kit-side.',
  },

// 808 Vintage
  reference: {
    referent: 'Roland TR-808',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1 [8][11][12][13][4]',
    reachable:
      'The only machine on the §5.1 table that is analogue in EVERY voice, so this is the one kit ' +
      'where accuracy is a real target: kick/snare/rimshot/hitom/lowtom/clap yes, bridged-T topology. ' +
      'hihat/openhat/ride/crash/bell are six squares at 2-5 kHz through three highpasses — the metal ' +
      'bank of decision 30 is the mechanism; until its `metal` mix is tuned per voice this kit is the ' +
      'one holding the highest bar and the biggest gap.',
  },

// Chrome Pulse
  reference: {
    referent: 'authored',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1 — unsourced, engineering judgement',
    reachable:
      "solna's own kit: the hardest transient, brightest hihat/openhat and wettest crash/ride in the " +
      'library. Every voice is reachable by definition — there is nothing to fall short of, which is ' +
      'also why it cannot overclaim.',
  },

// Velocity Breaks
  reference: {
    referent: 'the Amen break — a 1969 acoustic kit (G.C. Coleman, The Winstons), sampled and sped up',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [14][15]',
    reachable:
      'kick/snare/rimshot/hitom/lowtom approximate — a recording of a real kit, so the transient ' +
      'detail is out of reach; ride/crash/bell no, bronze is not bandpassed noise; and the identity ' +
      'is groove and ghost notes, which live in drumGrids.ts rather than here.',
  },

// Sub Weight
  reference: {
    referent: 'dubstep at 140 BPM, halftime — transient-shaped kick and snare over a sub layer',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [16][17]',
    reachable:
      'kick/snare/clap yes — dubstep drums are themselves synthesised and layered, so there is no ' +
      'vintage box to fall short of; hitom/lowtom yes; hihat/openhat yes; ride/crash/bell approximate.',
  },

// Warehouse
  reference: {
    referent: 'Berlin / warehouse techno — saturated 909 kick into a mono low-passed reverb',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [18][19][20]',
    reachable:
      'kick yes now that kick.reverbSend exists — the defining trait is routing, not values; ' +
      'snare/clap yes, overdriven is a gain and decay setting; hihat/openhat approximate; ' +
      'ride/crash/bell approximate. KNOWN IMPERFECT FIT: the `ambient-sparse-drift` grid names this ' +
      'kit, and this kit has the shortest decays in the library under a grid that wants long tails ' +
      '(genre-drum-voice-selection.md §4). No ambient kit is added — no research pass found a sourced ' +
      'referent for one — and whether the grid moves to Acoustic Studio is a listening call.',
  },

// Tight Pocket
  reference: {
    referent: '"Funky Drummer" (Clyde Stubblefield, King Studios 1969) — blanketed Ludwig Vistalite',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [21][22]',
    reachable:
      'kick approximate — the deadening is physical, a blanket, not a filter; snare/rimshot ' +
      "approximate, the Acrolite's 6-10 kHz head sound needs a second noise band; hitom/lowtom yes; " +
      'hihat/openhat approximate, 14" Zildjian K; crash absent from the referent by design and ' +
      'ride/bell out of reach as bronze.',
  },

// Acoustic Studio
  reference: {
    referent: 'a close-miked acoustic rock kit',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [23]',
    reachable:
      'kick yes, 60-100 Hz body with a 2-4 kHz beater click; snare/rimshot yes, 150-200 Hz fatness ' +
      'plus a head band; hitom/lowtom yes, and genuinely long in a room; hihat/openhat approximate; ' +
      'ride/crash/bell are the ceiling — bandpassed noise is not bronze, and this is the kit where ' +
      'that is most audible because the referent is nothing but real cymbals.',
  },

// Warm Riddim
  reference: {
    referent: 'reggae one drop (Carlton Barrett) and its dub treatment (King Tubby)',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [24][25][26][27]',
    reachable:
      'rimshot YES and this is the best return in the library — a cross-stick is a short pitched ' +
      'wooden tock, which a triangle oscillator with a fast decay does well, and the one drop puts ' +
      'kick and cross-stick together on beat 3; kick/snare yes; hihat/openhat yes; hitom/lowtom yes; ' +
      "ride/crash/bell approximate. Dub's tape echo is an effect-rack question, not a kit one.",
  },

// Lo-Fi Vinyl
  reference: {
    referent: 'lo-fi hip hop through an E-mu SP-1200 — 12-bit at 26.04 kHz',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [28][29][30]',
    reachable:
      'hihat/openhat yes now that hat.topCut exists — the SP-1200 folds the top back and softens ' +
      'transients, and until slice 3 this kit had the BRIGHTEST hat in the set, pointed the wrong ' +
      'way; kick/snare/rimshot approximate — the sound is the converter, not the drum; hitom/lowtom ' +
      'yes; ride/crash/bell approximate. True bit reduction is an engine feature nobody has built.',
  },

// Dusty Break
  reference: {
    referent: 'boom bap — acoustic breaks chopped through a 12-bit SP-1200 / SP-12',
    source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1 [28][29]; drumGrids.ts provenance',
    reachable:
      'kick/snare/rimshot approximate — the referent is a sampled acoustic kit twice removed, once ' +
      'by the room and once by the converter; hitom/lowtom yes; hihat/openhat yes, dusty is a decay ' +
      'and a topCut; ride/crash/bell approximate. It is deliberately NOT 808 Vintage: boom bap ' +
      "instruments are breaks through a 12-bit sampler, the opposite of a bridged-T sine.",
  },
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/data/drumKits.test.ts src/store/vibes.test.ts src/data/dataLayerPurity.test.ts`
Expected: PASS. `dataLayerPurity` is the one that catches a `reference` written with a template
literal that calls something, or a helper factored out of two kits.

- [ ] **Step 6: Run the gate**

Run: `bun run lint && bun run eslint && bun run check:drums`
Expected: PASS, zero eslint errors. `check:drums` does not read `reference` — it is documentation
the type system forces, not a check input.

- [ ] **Step 7: Commit**

```bash
git add src/data/drumKits.ts src/data/drumKits.test.ts src/store/vibes.test.ts
git commit -m "feat(data): record what each drum kit is modelled on, per voice

reference is required, and reachable is per voice: the TR-909's kick, snare,
toms and clap are analogue and reachable while its hats, ride and crash are
6-bit PCM of real cymbals and never will be — a per-kit score would average
those into a number true of no voice. Chrome Pulse is the only allowlisted
'authored' kit: Club Standard keeps its TR-909 referent, because the rename
fixed the name, not the documentation. Also replaces vibes.test.ts's
Boolean(soundKit)
check, which passed on names that resolved to nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 11: The grid re-authoring that needed the new voices

Only the parts that were impossible before. **Every grid carries a `provenance`, and the rule that
keeps it honest here is:**

> **Ruling — "re-voice, don't re-transcribe": a sourced grid may only be re-voiced; only a grid
> whose `provenance` is the literal `'authored'` may gain or move a hit.**

It outranks decision 38 where the two collide: adding a hit no source contains would make a
`provenance` URL a lie, and that invariant is in `CLAUDE.md`. The consequence is named, not hidden —
`synthwave` and `techno` keep two-hit tom rows, and **Task 12 step 7 asks the ear about exactly
that**.

Moving a row from `snare` to `rimshot`, or from `hihat` to `bell`, does not change what the source
says was played — it changes which of our voices plays it, and the source said `rimshot` and `bell`
all along. Adding a hit to a sourced transcription would change the claim, so only grids whose
provenance is the literal `'authored'` gain one.

Measured, with `bun -e` over the library (`Object.keys(DRUM_GRIDS).length` = 30):

```bash
bun -e '
const {DRUM_GRIDS}=await import("./src/data/drumGrids.ts");
for(const [id,g] of Object.entries(DRUM_GRIDS)){const t=g.rows.tom;
if(t&&t.filter(Boolean).length===2)console.log(id,"|",g.provenance);}'
```

Output — **the five two-hit tom grids, exactly as the spec predicted**:

```
synthwave                | attackmagazine.com/technique/beat-dissected/synthwave-drums/
house                    | authored
cyberpunk                | authored
techno                   | attackmagazine.com/technique/beat-dissected/motor-city-detroit-techno/
synthwave-four-on-floor  | authored
```

With only two toms a fill needs the snare on its first step to read as descending; two toms alone at
the end of a bar read as "two hits", not "a fall" (`…kick-snare-clap-toms.md` §4.4). The kit
brackets the ladder — snare 175–235, hi tom 124–181, low tom 65–110, kick 45–70 Hz — so the
four-step descent is the shape a listener recognises. **Two of the five are exceptions and stay
exceptions:** `techno`'s tom row is a *timekeeping* device (filtered 16th rolls at the end of the
bar), not a fill, and its grid has no snare row at all — `house` and `techno` are clap-only by a
sourced slice-2 decision (`drumGrids.test.ts:157`), so in `house` the **clap** is the fill's first
step.

**Files:**
- Modify: `src/data/drumGrids.ts` (the `tom` → `lowtom` key on all 30 grids; twelve grids re-voiced or re-authored)
- Modify: `src/store/instantVibesDrumsFixture.ts` (hand-copied, by hand)
- Modify: `src/store/instantVibesDrums.test.ts:12–21` (`FIXTURE_ROWS`, the per-vibe row-name table)
- Modify: `src/data/drumGrids.ts:39–44` (the head comment naming the seven playable voices)
- Test: `bun test src/data/drumGrids.test.ts src/store/instantVibesDrums.test.ts`

**Interfaces:**
- Consumes: `DRUM_TYPES` (the eleven-member list) from part 1, **and `KNOWN_ROW_NAMES` in
  `src/data/drumGrids.test.ts` already derived from it — slice 3 owns that consolidation** (ruling
  R8's fourth copy, folded in there because it is cheapest while there are seven voices), so this
  task adds row names without editing a list; the eleven sequencer tracks of Task 8
  — `replaceDrumPattern` looks a row up **by the sequencer track's instrument name** and clears every
  track no row names, so a row named `lowtom` reaches a track named `lowtom` and nothing else.
- Produces: no new exports. Row keys are drawn from `DRUM_TYPES`, which `drumGrids.test.ts` now
  asserts directly.

- [ ] **Step 1: Rename the `tom` row key on every grid**

All 30 grids declare a `tom` row (many all-false). Rename the key to `lowtom` — the voice today's
`tom` already is (context fact 1: it is a low tom by measurement). Nothing else about those rows
changes.

```bash
# 30 occurrences, all at the start of a row entry inside DRUM_GRIDS
grep -c '^      tom:' src/data/drumGrids.ts   # expect 30
sed -i '' 's/^      tom:/      lowtom:/' src/data/drumGrids.ts
grep -c '^      lowtom:' src/data/drumGrids.ts # expect 30
```

If the indentation in the file is not six spaces, adjust the pattern rather than dropping the anchor
— an unanchored `s/tom:/lowtom:/` would also rewrite `hitom:` on a second pass.

- [ ] **Step 2: Run the tests to see exactly what is red**

Run: `bun test src/data/drumGrids.test.ts src/store/instantVibesDrums.test.ts`
Expected: the golden fixture fails on eight vibes (every entry still names a `tom` row);
`drumGrids.test.ts` passes. Leave both red until step 7.

- [ ] **Step 3: Re-voice the four cross-stick idioms and the two bell/ride grids**

Six grids, all re-voicing: the step arrays are moved between rows byte-for-byte, and each grid keeps
its `provenance` because the transcription is unchanged. Where a row is emptied it becomes an
all-false row rather than being deleted — an omitted row says "the question was not asked", a false
row says "the genre plays nothing there", and this genre plays nothing there *on that voice*.

| grid | row | before | after |
|---|---|---|---|
| `reggae` | `snare` | `........x.......` | `................` |
| | `rimshot` | *(new)* | `........x.......` |
| `reggae-rockers` | `snare` | `........x.......` | `................` |
| | `rimshot` | *(new)* | `........x.......` |
| `lofi-hip-hop` | `snare` | `....x.......x...` | `................` |
| | `rimshot` | *(new)* | `....x.......x...` |
| `waltz` | `snare` | `....x...x...` | `............` |
| | `rimshot` | *(new)* | `....x...x...` |
| | `hihat` | `x...x.x.x...` | `............` |
| | `ride` | *(new)* | `x...x.x.x...` |
| `afro-6-8` | `snare` | `.x..x..x..x.` | `............` |
| | `rimshot` | *(new)* | `.x..x..x..x.` |
| | `hihat` | `x.x.xx.x.x.x` | `............` |
| | `bell` | *(new)* | `x.x.xx.x.x.x` |
| `afro-six-eight-bell` | `snare` | `....x.....x.` | `............` |
| | `rimshot` | *(new)* | `....x.....x.` |
| | `hihat` | `x.x.x.x...x.` | `............` |
| | `bell` | *(new)* | `x.x.x.x...x.` |

Written out — `reggae` and `afro-6-8` as the two shapes, the other four follow the same pattern:

```ts
  reggae: {
    name: 'Reggae', meter: '4/4', kit: 'Warm Riddim',
    provenance: 'soundbrenner.com/blogs/articles/rockers-rhythm',
    // One drop: beat 1 dropped, kick and CROSS-STICK together on beat 3. The
    // backbeat was on `snare` because there was no rimshot; the source always
    // said rimshot, so this is a re-voicing and the provenance still holds.
    rows: {
      kick:    [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      rimshot: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },

  'afro-6-8': {
    name: 'Afro 6/8', meter: '6/8', kit: 'Acoustic Studio',
    provenance: 'Jerry Leake, "Perspectives on the Standard African Bell" (uvic.ca)',
    // The 7-stroke bembé bell — steps 0,2,4,5,7,9,11 — was written onto `hihat`
    // in slice 1 as the half of the fix that needed no new voice, and it was
    // recorded then that the timbre stayed wrong. It moves to `bell` unchanged,
    // and the cross-stick moves off `snare`. Only now can a bell and a hi-hat
    // sound at the same time, which is what the source arrangement does.
    rows: {
      kick:    [true, false, false, false, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false],
      rimshot: [false, true, false, false, true, false, false, true, false, false, true, false],
      hihat:   [false, false, false, false, false, false, false, false, false, false, false, false],
      bell:    [true, false, true, false, true, true, false, true, false, true, false, true],
      openhat: [false, false, false, false, false, false, false, false, true, false, false, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, true],
    },
  },
```

- [ ] **Step 4: Re-author the five two-hit tom grids**

| grid | provenance | row | before | after |
|---|---|---|---|---|
| `synthwave` | sourced | `lowtom` | `.............x.x` | `...............x` |
| | | `hitom` | *(new)* | `.............x..` |
| `techno` | sourced | `lowtom` | `..............xx` | `..............xx` (unchanged) |
| `house` | authored | `lowtom` | `.......x......x.` | `.......x......x.` (unchanged) |
| | | `hitom` | *(new)* | `.............x..` |
| `cyberpunk` | authored | `snare` | `....x.......x.x.` | `....x.......xx..` |
| | | `lowtom` | `..x........x....` | `..x........x...x` |
| | | `hitom` | *(new)* | `..............x.` |
| `synthwave-four-on-floor` | authored | `snare` | `....x.......x...` | `....x.......xx..` |
| | | `clap` | `....x.......x...` | `....x.......xx..` |
| | | `lowtom` | `..............xx` | `...............x` |
| | | `hitom` | *(new)* | `..............x.` |

The reading of each:

- **`synthwave` — re-voicing only.** Hits stay at 13 and 15. The descent is the snare already at 12,
  then hitom 13, then lowtom 15 over the kick that is already at 15 — snare → hi tom → low tom →
  kick, the four-step shape, with not one step moved in a sourced transcription.
- **`techno` — the exception, and it keeps its two hits on one drum.** Its 14/15 pair is a
  *timekeeping* device, a 16th roll into the next bar, not a fill; it has no snare row to start on
  (clap-only, sourced); and it is a sourced transcription, so nothing may be added. Both hits stay on
  `lowtom` and it gets no `hitom` row. The row is now audibly a low tom instead of an unnamed "tom",
  which is the whole change.
- **`house` — one added hit, and the clap is the first step.** `house` has no snare row by a sourced
  slice-2 decision; the clap carries the backbeat, so the descent is clap 12 → hitom 13 → lowtom 14,
  with the authored ornament at 7 kept on `lowtom`.
- **`cyberpunk` — one ghost snare moves, nothing is deleted.** The 14 ghost moves back to 13 so the
  fill starts on it: snare 13 → hitom 14 → lowtom 15. Both authored ornaments (2, 11) stay on
  `lowtom`.
- **`synthwave-four-on-floor` — one added hit, in two rows.** The snare gains 13 and **the clap gains
  13 with it**: `drumGrids.test.ts:186` pins this grid's clap as byte-identical to its snare (an LM-1
  clap over a gated snare), and that layering is right and stays right. Then hitom 14, lowtom 15.

`cyberpunk`'s snare row and `synthwave-four-on-floor`'s snare and clap rows in full:

```ts
    // cyberpunk
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, true, false, false],
      hitom:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      lowtom:  [false, false, true, false, false, false, false, false, false, false, false, true, false, false, false, true],

    // synthwave-four-on-floor
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, true, false, false],
      clap:    [false, false, false, false, true, false, false, false, false, false, false, false, true, true, false, false],
      hitom:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
```

- [ ] **Step 5: Run the grid tests**

Run: `bun test src/data/drumGrids.test.ts`
Expected: PASS — including `no clap row` (untouched), `house and techno are clap-only` (no snare row
added to either), `the two lo-fi claps are thinned` (clap untouched) and `the four correct
clap/snare layers are left alone` (synthwave unchanged; four-on-floor changed in both rows
together).

- [ ] **Step 6: Update the golden fixture by hand**

`src/store/instantVibesDrumsFixture.ts` imports nothing from `VIBES`, from `resolveVibe` or from the
libraries, and **that independence is what makes it a proof rather than a tautology.** Never make it
read the table; hand-copy.

Four of the eight vibes' default grids changed content; all eight need the row key rename.

| vibe | default grid | fixture change |
|---|---|---|
| `lofi-chill` | `lofi-half-time-brush` | `tom:` → `lowtom:` only |
| `synthwave-80s` | `synthwave-four-on-floor` | key rename; `snare` and `clap` gain step 13; `lowtom` keeps only 15; new `hitom` row with 14 |
| `cyber-edm` | `house` | key rename; new `hitom` row with 13 |
| `deep-ambient` | `ambient-sparse-drift` | `tom:` → `lowtom:` only |
| `boom-bap` | `boombap-swung-break` | `tom:` → `lowtom:` only |
| `zen-garden` | `zen-bamboo-pulse` | `tom:` → `lowtom:` only |
| `lofi-waltz` | `waltz-brush-three` | `tom:` → `lowtom:` only |
| `afro-six-eight` | `afro-six-eight-bell` | key rename; `snare` → all-false; new `rimshot` row `....x.....x.`; `hihat` → all-false; new `bell` row `x.x.x.x...x.` |

`afro-six-eight`'s entry in full, as the shape of the four-row change (12 steps, 6/8):

```ts
  'afro-six-eight': {
    kick:    [true, false, false, false, false, false, true, false, false, false, false, false],
    snare:   [false, false, false, false, false, false, false, false, false, false, false, false],
    rimshot: [false, false, false, false, true, false, false, false, false, false, true, false],
    hihat:   [false, false, false, false, false, false, false, false, false, false, false, false],
    bell:    [true, false, true, false, true, false, true, false, false, false, true, false],
    openhat: [false, false, false, false, false, false, false, false, true, false, false, false],
    lowtom:  [false, false, true, false, false, false, false, false, false, false, false, false],
    crash:   [true, false, false, false, false, false, false, false, false, false, false, false],
  },
```

Update the fixture's docblock line "All eight vibes pin seven rows" to say what is now true — seven,
eight or nine rows depending on the vibe, because a grid may name any of the eleven voices.

- [ ] **Step 7: Update `FIXTURE_ROWS` by hand, and the grid head comment**

`src/store/instantVibesDrums.test.ts:12–21` holds a per-vibe table of expected row NAMES, written
out per vibe rather than derived "so a row appearing or disappearing is a diff a reviewer sees" —
the same discipline Global Constraint 11 imposes on the fixture beside it, for the same reason.
Hand-edit it; never derive it.

Measured — resolve each vibe's default grid and compare its row keys before and after this task:

```bash
bun -e '
const {VIBES}=await import("./src/data/vibes.ts");
const {DRUM_GRIDS}=await import("./src/data/drumGrids.ts");
for(const v of VIBES) console.log(v.id.padEnd(16), Object.keys(DRUM_GRIDS[v.drumGridId]).length && Object.keys(DRUM_GRIDS[v.drumGridId].rows).join(","));'
```

**All eight vibes change, but only three gain a row** — the other five change one name:

| vibe | default grid | row-name change |
|---|---|---|
| `lofi-chill` | `lofi-half-time-brush` | `tom` → `lowtom` |
| `synthwave-80s` | `synthwave-four-on-floor` | `tom` → `lowtom`, **+ `hitom`** |
| `cyber-edm` | `house` | `tom` → `lowtom`, **+ `hitom`** |
| `deep-ambient` | `ambient-sparse-drift` | `tom` → `lowtom` |
| `boom-bap` | `boombap-swung-break` | `tom` → `lowtom` |
| `zen-garden` | `zen-bamboo-pulse` | `tom` → `lowtom` |
| `lofi-waltz` | `waltz-brush-three` | `tom` → `lowtom` |
| `afro-six-eight` | `afro-six-eight-bell` | `tom` → `lowtom`, **+ `rimshot`, + `bell`** |

`afro-six-eight` keeps `snare` and `hihat` in its list: those rows are emptied, not removed, and the
trailing comment `// cross-stick and bell` stops being a note about what the fixture could not
express and becomes a description of what it now holds. The table is compared **sorted**
(`:41`), so order does not matter; keep the canonical order anyway for reading.

```ts
const FIXTURE_ROWS: Record<string, string[]> = {
  'lofi-chill': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'lowtom', 'crash'],
  'synthwave-80s': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'hitom', 'lowtom', 'crash'],
  'cyber-edm': ['kick', 'hihat', 'openhat', 'clap', 'hitom', 'lowtom', 'crash'], // house: clap-only
  'deep-ambient': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'lowtom', 'crash'],
  'boom-bap': ['kick', 'snare', 'hihat', 'openhat', 'lowtom', 'crash'], // no clap in boom bap
  'zen-garden': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'lowtom', 'crash'],
  'lofi-waltz': ['kick', 'snare', 'hihat', 'openhat', 'lowtom', 'crash'], // jazz waltz: no clap
  // the cross-stick and the bell are voices now, not a comment: snare and hihat
  // stay listed and are all-false, because the idiom plays nothing on them
  'afro-six-eight': ['kick', 'snare', 'rimshot', 'hihat', 'bell', 'openhat', 'lowtom', 'crash'],
};
```

Then `src/data/drumGrids.ts:39–44`, whose head comment still names the seven voices. Replace the
roster sentence and keep decision 10's authoring guidance below it exactly as it is:

```
 * NOTE — every row here plays. `INITIAL_SEQUENCER_TRACKS` has eleven tracks
 * (kick, snare, rimshot, clap, hihat, openhat, hitom, lowtom, ride, crash,
 * bell) and every row below names one of them. The table used to carry a
 * `bass` row in 23 entries — 53 authored hits that could never sound, because
 * `bass` is not a drum voice at all: no `DRUM_KITS` field, no `triggerDrum`
 * case, no track. It was deleted rather than kept as authored intent, because
 * a row that cannot sound is not a rhythm, and `drumGrids.test.ts` now rejects
 * any row name a track cannot play.
```

- [ ] **Step 8: Run the vibe tests**

Run: `bun test src/store/instantVibesDrums.test.ts src/store/vibes.test.ts src/store/vibeVariation.test.ts`
Expected: PASS. If a dice-pool grid is what fails, read the diff before touching the fixture: the
fixture pins the DEFAULT grid of each vibe, so a dice-pool failure means a *variation* test asserts
a row name, and the fix is there, not here.

- [ ] **Step 9: Report the row changes and read them**

Run: `bun run report:drums-diff $(git merge-base main HEAD)`
Expected: exit 0, and a per-grid row diff a reviewer can read. Paste the tom/rimshot/bell/ride
section into the commit message body. The report asserts nothing — a changed row is a fact about
content, not a defect.

- [ ] **Step 10: Run the gate**

Run: `bun test && bun run lint && bun run eslint && bun run check:drums`
Expected: PASS, zero eslint errors.

- [ ] **Step 11: Commit**

```bash
git add src/data/drumGrids.ts src/store/instantVibesDrumsFixture.ts src/store/instantVibesDrums.test.ts
git commit -m "feat(data): re-author the grids that needed the four new voices

Cross-stick backbeats move off snare in reggae, reggae-rockers, lofi-hip-hop,
waltz, afro-6-8 and afro-six-eight-bell; the bembé bell moves off hihat onto
bell and the jazz-waltz ride onto ride; the five two-hit tom grids gain a hitom
so a fill descends from the snare instead of reading as two hits. A sourced grid
is re-voiced, never re-transcribed — only 'authored' grids gain a hit, which is
why techno keeps its 16th roll on one drum and synthwave moves nothing.

The golden fixture and instantVibesDrums.test.ts's FIXTURE_ROWS are hand-edited,
never derived: three vibes gain a row (synthwave-80s and cyber-edm a hitom,
afro-six-eight a rimshot and a bell) and the other five rename one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 12: The slice 4 listening checklist and the full gate

**`bun run verify` proves that nothing broke and that the parameters differ. It cannot tell us that
a bell sounds like a bell.** Two voices can differ in every parameter and be indistinguishable, and
two voices can share most parameters and be obviously different. This checklist is a **human gate of
equal weight to `bun run verify`**, and it is numbered steps someone executes, not a closing note.

Run it with `bun run dev` open at `http://localhost:3000`, headphones on, in one sitting. Write the
answer next to each question in the PR description; "yes" with no listening is the only wrong
answer.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md` (record the
  checklist's answers under decision 42 — or link the PR that carries them)
- Modify: `CLAUDE.md` (the drum-voice rules that outlived this slice; **no version numbers, no
  counts, no line numbers** — write the rule)

**Interfaces:**
- Consumes: everything from tasks 1–11 of both parts.
- Produces: nothing importable. The deliverable is the answered checklist and a green gate.

- [ ] **Step 1: Audition all four new voices in all thirteen kits**

Open the drum pads. For each kit in the kit menu, hit `KeyB` (rimshot), `KeyN` (ride), `KeyQ` (bell)
and both toms (`Period` = hi tom, `Comma` = low tom). Thirteen kits × five pads. Note any kit where
a new voice is inaudible, clipped, or indistinguishable from the voice above it in the family.

- [ ] **Step 2: The pair to spend real time on — `bell` against `hihat` and `openhat`**

Alternate `KeyQ` and `KeyC`, then `KeyQ` and `KeyV`, in every kit. **The bell's separation from a hat
is harmonic structure — two squares at 800/540 Hz through a bandpass at ~880 Hz against filtered
noise — and no parameter-spread assertion looks at harmonic structure.** `check:drums` can be green
while these two are the same sound. The question: without looking, can you tell which key you
pressed? If not in some kit, that kit's `bell` needs retuning, not the check.

- [ ] **Step 3: Play a descending fill on each kit**

Program `snare → hitom → lowtom → kick` on four consecutive steps in the sequencer and loop it, once
per kit. Two questions:
1. Does it read as a **fall**, or as four unrelated hits? The ladder is snare 175–235, hi tom
   124–181, low tom 65–110, kick 45–70 Hz.
2. Is `hitom` clearly *above* `lowtom` and clearly *below* the snare? The within-kit check enforces
   `hitom ≤ 0.85 × snare.bodyFreqEnd`; the ear is what says whether 0.85 was the right number.

- [ ] **Step 4: `Warehouse`'s two toms specifically — two drums, or one drum twice?**

**This is the one place in slice 4 where a green line most nearly means "we asked the check a
question it was shaped around."** The within-kit `hitom` ↔ `lowtom` floor is 0.75 octaves, and it was
set at 0.75 **because `Warehouse` measures 0.799** — the floor was chosen to accommodate the
tightest kit rather than the kit tuned to clear a floor fixed in advance. Every factor in the check
was calibrated that way and that is fine; this one sits six percent off its bound, so it is the one
the ear has to settle.

Load `Warehouse`, play the same descending fill as step 3, and answer one question: do the hi tom
and the low tom read as **two drums**, or as **one drum played twice**? `check:drums` cannot answer
it — 0.799 against a floor of 0.75 is green by construction.

> If the ear says one drum: **retune `Warehouse`'s toms, then RAISE the floor to whatever the
> retuned set supports.** Never leave the floor where it is — Global Constraint 8 forbids lowering a
> floor to go green, and leaving one that was fitted to the worst case is the same mistake with the
> sign flipped.

- [ ] **Step 5: Listen to the six re-voiced grids**

Load each from the sequencer's grid menu and let it loop:
`reggae`, `reggae-rockers`, `lofi-hip-hop`, `waltz`, `afro-6-8`, `afro-six-eight-bell`.
- Do the cross-stick backbeats read as a dry woody click rather than the loud crack they were?
- In `afro-6-8` and `afro-six-eight-bell`, is the bell a **bell**, and does it sit over the rest of
  the kit rather than inside it?
- In `waltz`, does the ride keep time without accenting like a crash?

- [ ] **Step 6: Listen to the five re-authored tom grids**

`synthwave`, `house`, `cyberpunk`, `techno`, `synthwave-four-on-floor`.
- In the four that got a fill, does the descent read from its first step (snare in three of them,
  clap in `house`)?
- In `techno`, does the 14/15 pair read as a **roll into the next bar** rather than as a fill that
  lost its start? If it reads as a broken fill, the exception was the wrong call and that is a
  finding worth writing down.

- [ ] **Step 7: The open listening question — the two sourced tom grids that kept two hits**

`synthwave` and `techno` were re-voiced and nothing else: their fills are still two hits, because
the source says two hits, and Task 11's ruling forbids adding one to a transcription. Loop each
against `house` and `cyberpunk`, which did get the four-step descent.

> **Question for the owner:** does the ear prefer the descent here too? **If yes, the fix is to
> author a NEW variant grid beside them** — `synthwave-tom-fall`, `techno-tom-fall`, `provenance:
> 'authored'` — and never to edit the sourced one. This is not an oversight in the re-authoring
> pass; do not "fix" it by editing `synthwave` or `techno` in place.

- [ ] **Step 8: Press all eight vibe chips, then roll the dice on each**

`Lo-Fi Chill`, `Synthwave 80s`, `Cyber EDM`, `Deep Ambient`, `Boom Bap`, `Zen Garden`,
`Lo-Fi Waltz`, `Afro 6/8`. **One vibe's kit changes name in this slice: `Cyber EDM` now names
`Club Standard` (was `909 Modern`).** It must sound exactly as it did — only the key moved. Then roll
the dice three or four times per vibe: every reroll must land on a grid that plays, with no silent
row and no track left sounding from the previous grid (`replaceDrumPattern` clears every track no row
names).

- [ ] **Step 9: The open listening question — `ambient-sparse-drift` on `Warehouse`**

Ruling R3: the grid does **not** move in this slice, and the misfit is recorded in `Warehouse`'s
`reference` note. Load `ambient-sparse-drift` on `Warehouse`, then load it again with the kit set to
`Acoustic Studio`, back to back.

> **Question for the owner:** `Warehouse` has the shortest decays in the library under a grid that
> wants long tails; `genre-drum-voice-selection.md` §4 recommends `Acoustic Studio` (long crash, long
> tom). Does `Acoustic Studio` sound better here? **If yes, it is a follow-up change of two string
> literals** — `ambient-sparse-drift.kit` and `deep-ambient`'s `soundKit`, which decision 5 has just
> repointed to `Warehouse` — plus this slice's `reference` note. It is not a change to make inside
> this slice.

- [ ] **Step 10: Reload the page and confirm the migration in a real browser**

With a session open and some steps programmed on the low tom row, reload. The row keeps its steps and
its name; four new rows sit below it, silent. Then save a project, reload, and reopen it from the
library. **A project written before this change must reopen sounding the way it sounded when it was
closed** — that is the contract both chains of Task 7 exist to keep, and this is the only place it is
checked against a real `localStorage` and a real IndexedDB.

- [ ] **Step 11: Look at the sequencer in both themes**

Toggle the theme. Eleven rows, eleven colours. Can you tell the two hats apart? The two toms
(brightness only, hi tom lighter)? The three metals? Do the four families read as families? If a pair
collapses in one theme only, it is that theme's lightness that is wrong, not the hue.

- [ ] **Step 12: Run the report and read it**

```bash
bun run report:drums-diff $(git merge-base main HEAD)
```

Expected: exit 0. It now covers **kit values as well as rows** (slice 3), so this is the artifact
that says what changed in thirteen kits × eleven voices. Read it; quote the per-kit summary in the
PR body. It asserts nothing on purpose — a changed kit parameter is a fact about content.

- [ ] **Step 13: Run the full gate**

```bash
bun run verify
bun run check:keys
bun run check:drums
```

Expected: all green, **eslint at zero errors** and no growth in the tolerated warning count.
`check:keys` prints the eleven pad codes and `no drum/synth overlap (none)`; `check:drums` prints the
aggregate spreads including the new voices and the new within-kit pair check.

- [ ] **Step 14: Update `CLAUDE.md` with the rules this slice established**

Rules, not numbers (`CLAUDE.md` records no version numbers, counts or line numbers). Add to the drum
section:

```markdown
**One drum voice, one name, in five places.** The canonical voice order is written once and
`INITIAL_SEQUENCER_TRACKS`, the `DrumKit` fields, the `triggerDrum` switch, `DEFAULT_PADS` and
`DRUM_TYPES` all follow it, so a reviewer comparing any two of those lists is comparing sorted
lists. A test asserts `DRUM_TYPES` and `keyof DrumKit` are the same set; that assertion, not the
shared constant, is what makes adding a voice to one and not the other impossible.

**A kit says what it is modelled on, per voice.** `DrumKit.reference` is required, and `reachable`
is per voice because reachability is: a machine can be analogue in its kick and PCM in its cymbals,
and a per-kit score would average those into a number true of no voice. `referent: 'authored'` is an
honest answer and an allowlisted one in the test — never invent a source to get off that list.

**A sourced grid is re-voiced, never re-transcribed.** Moving a row from `snare` to `rimshot` does
not change what the source says was played; adding a hit does. Only grids whose `provenance` is
`'authored'` may gain or move a hit.
```

- [ ] **Step 15: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md
git commit -m "docs: record the slice 4 listening pass and the rules it settled

The gate proves the parameters differ; it cannot hear a bell. Records the
answered checklist, and the three rules that outlived the slice: one voice one
name in five lists, reference is per voice, and a sourced grid is re-voiced
rather than re-transcribed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Self-Review

**1. Spec coverage.** Walking the spec's slice-4 and verification decisions against the twelve tasks
(tasks 1–6 are part 1 of this plan):

| spec decision | task |
|---|---|
| 1 eleven voices, canonical order | part 1 (`DRUM_TYPES`, `DrumKit`, `triggerDrum`); tasks 8, 9, 11 follow it |
| 2 `crash` kept, `ride` added alongside | part 1 (both are `DRUM_TYPES` members); task 11 gives `ride` its first row |
| 3 `bass` row deleted | landed in slice 2 — verified: no grid declares a `bass` row today |
| 4 `DRUM_ALIASES` reduced | part 1 |
| 5 thirteen kits; every vibe's `soundKit` resolves | part 1 (kits); **task 10** (the assertion) |
| 6 no ambient kit; the misfit is recorded | **task 10** (`Warehouse.reference`), **task 12 step 7** (the listening question) |
| 7 `DrumKit.reference` | **task 10** |
| 8 `909 Modern` renamed, `808 Vintage` kept | **task 7** (rename), **task 10** (`808 Vintage`'s higher bar in `reachable`) |
| 9 one choke group, hats only | slice 3; not extended here |
| 10 a grid may omit a voice | unchanged; task 11 uses all-false rows rather than omission and says why |
| 11 `--color-drum-*` in four families | **task 9** |
| 29–34 new voices and their params | part 1 |
| 35 eleven tracks + eleven colours | **tasks 8 and 9**; **task 7** migrates existing sessions onto them |
| 36 pads, two corrections, three key codes | **task 8** (`KeyB`, `KeyN`, `KeyQ` — measured) |
| 37 both chains, twice over, never merged | **task 7** — four transforms, not the three the table lists |
| 38 the grid re-authoring | **task 11** |
| 39 a green gate cannot judge sound | **task 12**, whose step 4 names the one check in the slice that was fitted to its worst case |
| 40 `check:drums` cannot pass vacuously | part 1 (spreads, within-kit check); the `DRUM_TYPES` copies, `KNOWN_ROW_NAMES` included, are slice 3's under R8 |
| 41 the `reference` test + the `soundKit` sibling | **task 10** |
| 42 the listening checklist | **task 12** |
| 43 `report:drums-diff` | slice 3; consumed in **tasks 11 and 12** |
| open Q2 amber band | **task 9**, per ruling R2 |
| open Q3 `ambient-sparse-drift` | **tasks 10 and 12**, per ruling R3 — recorded and listened to, never moved |
| open Q4 the new kit name | **task 7**, per ruling R4 |
| open Q5 three key codes | **task 8** — measured, named, not deferred |
| open Q6 the exact hues | **task 9** — all 22 values written |
| open Q8 the "18 test files" figure | not load-bearing; task 9 rests on the guard itself (`ALLOWLIST` empty, three shrink tests), which was verified |

**Gaps found and closed while reviewing:**
- The spec says "no vibe names `909 Modern`". **Measured, `cyber-edm` does** — slice 2 repointed it.
  Task 7 step 13 and task 12 step 6 both carry it.
- Nothing in either list owned the mechanical `tom` → `lowtom` **row key** rename in
  `src/data/drumGrids.ts`. Folded into task 11 step 1, where the row work already is.
- `KNOWN_ROW_NAMES` in `drumGrids.test.ts` is a fourth copy of the list ruling R8 consolidates;
  **slice 3 owns it**, folded in while there are seven voices. Task 11 consumes it already derived
  and says so in its Interfaces block.
- Nothing owned the golden fixture, which hand-copies eight `tom` rows. Task 11 step 6, by hand,
  because constraint 11 forbids making it read the table — and its sibling `FIXTURE_ROWS` table in
  `instantVibesDrums.test.ts:12–21` (Task 11 step 7), plus the seven-voice roster in
  `drumGrids.ts`'s head comment, which the same step rewrites.
- The two seven-voice literals in `initialState.test.ts` are named by line and split between owners:
  the instrument rosters at `:133` and `:158` belong to Task 8, the colour list at `:162–165` to
  Task 9, which also deletes the note recording "eight tokens, nine tracks" as an open problem.
- **Found while checking the docblocks:** `withDrumTracks` appends against `INITIAL_SEQUENCER_TRACKS`
  *as it is today*, so once Task 8 grows it, the v13 and v5 steps append eleven — and an old payload
  arrives at the v14/v6 step holding its programmed `tom` row **and** a blank `lowtom`. Without a
  branch for it the rename would decline and the user's tom pattern would go silent beside a blank
  row: decision 37's failure, arriving by a different door. `renameDrumTrack` therefore drops a
  BLANK target row and renames into it, refuses when the target has programmed steps, and both
  older docblocks are corrected where they claim the step appends two tracks.
- The colour transform ships one commit before its wiring on purpose: Task 7 has the pure function
  and its unit tests, **Task 9 calls it, in the same commit as the CSS that defines what it writes**,
  so no commit ever writes a class with nothing behind it. The alternative — landing the tracks
  before the migration — was rejected: it would expose the double-row bug live.
- Track colours **are** migrated, by a fourth transform decision 37's table omits: without it every
  existing session becomes the half-semantic, half-drum sequencer decision 35 forbids. Task 7,
  scoped like `withDrumTracks` so a user's own colour survives.

Two rulings the plan states under their own names, because they outrank the spec where they touch
it: **"re-voice, don't re-transcribe"** (Task 11 — a sourced grid may only be re-voiced; the two
grids it excludes are named, and Task 12 step 7 asks the ear about them rather than letting the
omission read as an oversight), and the **colour migration** above.

**2. Placeholder scan.** No "TBD", "implement later", "handle edge cases", "similar to Task N" or
"write tests for the above". Every code step carries the code; every count, key code, grid name, hex
and current row value came from a command shown inline. Two forward references are explicit rather
than vague: task 8's four semantic colours are stated as transient with the reason (the tokens do not
exist until task 9), and task 7's order test is flagged as inert until task 8 lands, with task 8 step
8 re-running it.

**3. Type consistency.**
- `renameDrumTrack(tracks: SequencerTrack[], from: string, to: string): SequencerTrack[]` and
  `renameSoundKit<T extends object>(loop: T, from: string, to: string): T` — same names and
  signatures in the interfaces block, the implementation, both migration steps and both test suites.
- `migrateDrumVoices` is one name throughout (persist chain); `upgradeDrumVoicesV6` is the
  `.solna` chain's, deliberately different, and the two are never called from one another.
- `DRUM_TYPES` is consumed, never redefined: tasks 8, 9, 10 and 11 all import it from
  `src/data/drumKits.ts` (part 1's export), and task 11 deletes the last local copy.
- Voice names are spelled `hitom` / `lowtom` / `rimshot` / `bell` everywhere — in `DRUM_TYPES`, the
  track `instrument`, the pad `note`, the CSS token `--color-drum-<voice>`, the class
  `bg-drum-<instrument>` and the grid row key. That single spelling is what lets task 9's test be
  `DRUM_TYPES.map((voice) => \`bg-drum-${voice}\`)` and task 8's be `DEFAULT_PADS.map(p => p.note)`
  — two mechanical assertions that catch a typo anywhere in the chain.
- `reference: { referent: string; source: string; reachable: string }` matches the spec's declaration
  character for character, and the allowlist constant is `AUTHORED_KITS` in the one place it exists,
  holding `Chrome Pulse` alone — `Club Standard` keeps the TR-909 referent that is decision 7's own
  worked example, because the rename fixed the name and not the documentation.
- `recolourDrumTracks(tracks: SequencerTrack[]): SequencerTrack[]` is one name across the interfaces
  block, the implementation, both chains and three test suites, and the token it writes,
  `bg-drum-<instrument>`, is the same string Task 9 asserts and Task 9's CSS defines.
- Track ids follow `track-<instrument>`, which is what `renameDrumTrack` writes and what task 8's
  test asserts; pad ids follow the voice name (`hightom` → `hitom`), which nothing persists.

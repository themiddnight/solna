# Drum-Grid Genre Accuracy — Part 2: the `ride` and `bell` voices

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Read `.claude/skills/dsp-audio/SKILL.md` before Task 1 and `.claude/rules/testing.md` before writing any engine test.

**Goal:** Give the library the two identity instruments its own 3/4 and 6/8 idioms need and the
schema does not have. `ride` and `bell` become real drum voices — a param interface each, a
`DEFAULT_DRUM_KIT` entry, an override in all twelve kits, a `triggerDrum` case, a pad, a sequencer
track and a migration step — and then the two rhythms Part 1 had to smuggle onto `hihat` move onto
the rows they were written for, so a bembé bell and a hi-hat can finally sound at the same time.

**Architecture:** A drum voice in this app is four things and no more: a params interface in
`src/data/drumKits.ts`, a default, twelve overrides, and a `case` in `engine.triggerDrum`'s switch
that builds it from the two existing private helpers (`drumTone`, `drumNoiseBurst`). Nothing else
in the chain is voice-aware — `mergeDrumKit` spreads per key, `replaceDrumPattern` matches a grid
row to a track by `instrument` string, and `check:drums` iterates a `DRUM_TYPES` array. So adding a
voice is nine small edits in known places, and the only hard part is the twelfth one: the
separation check demands that all twelve kits stay audibly apart on the new parameters, which makes
tuning — not typing — the bulk of this work.

**Tech Stack:** TypeScript, React 19, Zustand (`persist` + `subscribeWithSelector`), raw Web Audio
API, `tonal` for note/interval math, Tailwind v4 + daisyUI, Bun (test runner + scripts), Vite,
ESLint 10 flat config + typescript-eslint 8.

**Spec:** `docs/superpowers/specs/2026-09-06-drum-grid-genre-accuracy-design.md` — **this plan
implements Slice 2 (items 13, 14 and 15) and closes open questions 3, 4 and 6. Slice 1 is
`docs/superpowers/plans/2026-09-06-drum-grid-genre-accuracy-part1.md` and must land first.**

**Evidence base:** `docs/research/2026-09-06-drum-grid-genre-survey.md`. Part 3 supplies the two new
grids' step indices verbatim; Part 4 is why these two idioms need their own rows at all.

---

## Starting state this plan assumes

**Part 1 has landed on `refactor/data-layer-extraction`.** All of the following are true before
Task 1 begins. If any is not, stop — this plan's names and version numbers will not line up.

- `DrumGrid` carries `name`, `meter`, `kit`, `provenance: string` and `rows: Record<string, boolean[]>`.
  `provenance` is a source URL or the literal `'authored'`, and `drumGrids.test.ts` holds an
  allowlist of the `'authored'` ones.
- `DRUM_GRIDS` has **30** entries. `edm-offbeat-pump` is gone; the nine new 4/4 grids exist.
- **`afro-6-8`'s `hihat` row holds the bembé bell rhythm `0,2,4,5,7,9,11`** and **`waltz`'s `hihat`
  row holds the jazz-waltz ride figure `0,4,6,8`** — both parked there because no `bell` or `ride`
  row existed. Moving them is this plan's Task 5.
- **`applyDrumPattern` is now `replaceDrumPattern`, and it replaces** (spec item 10a). A track the
  pattern does not name has its window **cleared**, not skipped — `row ? adaptStepRow(row,
  stepsPerBar) : new Array(stepsPerBar).fill(false)`, written through `writeStepWindow` so the
  padding past `stepsPerBar` survives. **A drum grid determines the whole kit.** The stale-crash bug
  is fixed there, before this slice starts; nothing in this plan defers it, and nine tracks do not
  make it worse.
- `withDrumTracks(tracks: SequencerTrack[]): SequencerTrack[]` exists: pure, idempotent, appends a
  canonical track whose `instrument` is absent and **never rewrites one that is present**. It is
  already called from both migration chains.
- `INITIAL_SEQUENCER_TRACKS` has seven tracks: kick (`bg-error`), snare (`bg-warning`), hihat
  (`bg-success`), openhat (`bg-accent`), clap (`bg-secondary`), tom (`bg-primary`), crash
  (`bg-info`).
- `VibeRandomRule.drumGrids: string[]` has replaced `drumDecoration`, with exactly two invariants:
  the pool contains the vibe's own `drumGridId`, and every id resolves. **No meter constraint and
  no minimum size — do not add either.**
- persist `version` is **13**; `PROJECT_FORMAT_VERSION` is **5**.
- `DRUM_ALIASES` in `src/audio/engine.ts` still contains `ride: 'crash'`, and
  `src/audio/engine.test.ts` still has the two tests that pin it (`'closedhat, lowtom and ride
  resolve to their canonical voices'` and `'ride resolves to crash specifically, not clap'`).

---

## Global Constraints

### `src/data/` purity

> **A file in `src/data/` cannot do anything at load that a reader of the file cannot see.** It
> imports nothing at runtime — **not even another file in `src/data/`** — reads no impure global,
> declares no function and constructs no object, and holds no mutable module-scope binding. It may
> declare types and interfaces, and may `import type` from anywhere. Top-level `const` arrow
> helpers that are shorthand for writing a literal are allowed.
>
> Equivalently: **every file in `src/data/` is an independent leaf.**

Binding on both files this plan edits under `src/data/`. `RideParams` and `BellParams` are
interfaces and `DEFAULT_DRUM_KIT`'s new entries are object literals, so nothing here strains the
rule — but `bell.partialRatio` is stored as a **ratio, not a computed second frequency**, precisely
so no arithmetic appears in the table. `src/data/dataLayerPurity.test.ts` lints these files through
eslint's own API and is what keeps that true.

### The two-migration-chain rule

> **Never merge the chains.** `withDrumTracks` is shared by both, exactly as `defaultPadState()` is
> shared by `migratePadLayer` (persist) and `upgradePadLayerV4` (project body) — and
> `upgradePadLayerV4`'s own docblock states why it *"must not be refactored into one function with
> it: a project body is an external contract, the persist payload is private localStorage shape,
> and their version numbers move for different reasons."*

Task 4 adds **two** upgrade steps that call one shared transform. Two functions, two files, two
version numbers, two tests. Do not collapse them, however similar the four lines look.

### Zero eslint errors

**`bun run verify`** = `bun test && bun run lint && bun run eslint && bun run check:keys &&
bun run check:drums && bun run build`. `bun run eslint` must report **zero errors**; warnings are
tolerated until the phase that flips their rule. Run `verify` as the last step of every task,
before the commit. `bun run check:theme` is not in that chain; Task 3 and Task 4 run it explicitly
because they touch colour classes.

### Theme tokens only, never raw colours

Every colour this plan writes is a daisyUI semantic token (`bg-info`, `bg-neutral`, `from-accent
to-accent/60 text-accent-content`). No raw hex, no Tailwind palette class (`bg-indigo-500`), no
`text-white` / `bg-black`. `bun run check:theme` is the arbiter and flags all three families.

### Measure by evaluating, never by grepping literal lines

Any claim about how many kits, rows, hits or tracks there are is settled with `bun -e` against the
real table, not with `grep -c`. A grep counts source lines; the argument is about values. Every
count in this plan was produced that way and every verification step below re-produces it that way.

### Explicitly OUT of scope

- **Everything Part 1 owns.** Do not re-correct a grid, re-author one of the nine new 4/4 grids,
  re-touch `provenance` on an existing entry, or rewrite `withDrumTracks`. You extend its canonical
  list; you do not change its body.
- **Reclaiming the `clap` row.** Spec item 16 settles it: `clap` is a real voice with params, a
  case, a pad and a track. `ride` and `bell` are net-new; the schema goes from seven voices to
  nine and nothing is recycled.
- **Per-grid step resolution, per-cell velocity, swing.** Spec non-goals; each needs its own spec.
- **The three vibes naming a `soundKit` that `DRUM_KITS` does not define.** A real pre-existing
  bug, deliberately left alone — no source says which kit those three should have.
- **Re-authoring any tom row.** Spec open question 5 belongs to Part 1's listening pass.

### Branch

All work lands on **`refactor/data-layer-extraction`**, on top of Part 1. Never commit to `main`.

---

## Three corrections to the brief, found while reading the source

These are stated up front because each changes what a task must do, and discovering them mid-task
is worse than reading them here.

### 1. Neither migration chain has a top-level `sequencerTracks` to upgrade

The brief and spec item 12 both say `sequencerTracks` must be upgraded *"at top level and inside
every `loops[]` entry"*. **Measured, that is false for both chains, and the ordering is fine
anyway.**

- **Persist:** `partializeAppState` (`src/store/store.ts:154`) is an explicit allowlist — nine
  global fields plus `loops`. `sequencerTracks` is not among the nine. Its own comment says the
  flat copies *"are intentionally NOT persisted (they are the working copy of the active loop)"*.
  So a persisted payload has `loops[].sequencerTracks` and nothing else.
- **Project body:** `PROJECT_CONTENT_KEYS = ['bpm', 'meterId', 'masterVolume', 'effects', 'loops']`
  (`src/store/projectFormat.ts:42`). Same answer.

Both upgrade steps therefore map `loops` only, through the mappers that already exist
(`mapLoops` in `migrate.ts:228`, `mapBodyLoops` in `projectFormatMigrate.ts:24`). The live flat
`sequencerTracks` gets the two tracks from `INITIAL_SEQUENCER_TRACKS` on a fresh session and from
`loadLoop` on an existing one, so nothing is missed. **The two tests are still written separately**
— one per chain — which is what the brief was actually protecting.

### 2. `.claude/skills/music-theory/SKILL.md` must be in the docs sweep

It is not on the brief's list, and it is the file this change most falsifies:

- `:151` says `DEFAULT_PADS` lives in **`src/components/DrumPads.tsx`**. It lives in
  `src/components/ui/DrumPadGrid.tsx`. Stale already; do not leave it stale after adding two pads.
- `:152` says *"8 pads, one row"*; `:154-156` is an eight-column table of pads and codes.
- `:158` lists the seven synthesis types.
- `:172` says *"only `KeyB`, `KeyN` and `Digit0`–`Digit9` are free"* — Task 3 takes `KeyB` and
  `KeyN`, so this sentence becomes wrong the moment Task 3 lands. It is also the sentence that
  told this plan which codes to take, so leaving it is actively harmful to the next reader.

Task 6 covers it.

### 3. The named fence risk is real and here is the fence

The brief warns about *"a stale symbol left inside a code fence while the prose above it was
updated"*. `.claude/skills/dsp-audio/SKILL.md` has exactly that shape. Its prose at `:156-166`
names the seven types and the aliases; its **signal-graph fence at `:40-52`** contains the line:

```
                            \_ (snare/clap/crash only) send gain (kit's
```

After Task 1 the ride and bell also carry a `reverbSend`, so that parenthetical is wrong — and a
sweep that only edits the prose section will not see it. Task 6 Step 1 greps fences first.

---

## Ordering, and why it is this order

Six tasks, strictly sequential. Each dependency below is real.

1. **Task 1 (types, defaults, engine) is first** because every later task names `RideParams`,
   `BellParams` or `DrumKit['ride']`. `check:drums` cannot even be extended until `DRUM_TYPES` has
   a key to add, and a pad cannot trigger a voice `triggerDrum` does not have.
2. **Task 2 (twelve kits + `check:drums`) follows Task 1** and is its own task, not a step, because
   it is the bulk of the work: the spread check compares merged kits, so one voice already forces a
   pass over all twelve. Spec item 15 is the reason both voices ship in the same pass — splitting
   them would mean tuning twelve kits twice for one net result.
3. **Task 3 (pads) follows Task 2** because a pad that triggers an untuned voice cannot be
   auditioned, and auditioning is the point of a pad. It is also the smallest task and the one that
   proves `check:keys` before anything harder depends on the codes.
4. **Task 4 (tracks + migrations) follows Task 3** because the track colours are decided against
   the same token budget the pads' colours consume, and because a migration that appends a track
   for a voice the engine cannot play would be a silent no-op nobody could hear.
5. **Task 5 (grids) is second-to-last and depends on Task 4 specifically.** A `bell` row in
   `DRUM_GRIDS` is inert until a track with `instrument: 'bell'` exists — `replaceDrumPattern` maps
   over *tracks*, so a row no track claims is read by nothing. Authoring the grids first would mean
   committing two grids whose headline row provably does nothing.
6. **Task 6 (docs) is last** because it records the final counts, codes, colours and version
   numbers, and three of its edits are corrections to sentences Tasks 3 and 4 falsify.

---

## File Structure

### Modified

| file | task | change |
|---|---|---|
| `src/data/drumKits.ts` | 1, 2, 6 | `RideParams` + `BellParams`; `DrumKit` gains both; `DEFAULT_DRUM_KIT` gains both; 24 per-kit param objects; head comment |
| `src/audio/drumKits.ts` | 1 | `mergeDrumKit` gains two spread lines |
| `src/audio/engine.ts` | 1 | `drumTone` gains an optional `reverbSend`; two `triggerDrum` cases; `ride` leaves `DRUM_ALIASES` |
| `src/audio/engine.test.ts` | 1 | two new voice tests, one `drumTone` regression test; the two alias tests that pinned `ride → crash` are rewritten |
| `scripts/check-drum-kit-separation.ts` | 2 | `DRUM_TYPES` gains `ride` and `bell`; four new spread checks |
| `src/components/ui/DrumPadGrid.tsx` | 3 | two `DEFAULT_PADS` entries; the `sm:` column count |
| `src/store/initialState.ts` | 4 | two `SequencerTrack` entries |
| `src/store/migrate.ts` | 4 | `migrateRideBellTracks` (v13 → v14) |
| `src/store/store.ts` | 4 | `version: 13` → `14`; one more line at the bottom of the ordered chain |
| `src/store/projectFormat.ts` | 4 | `PROJECT_FORMAT_VERSION = 5` → `6` |
| `src/store/projectFormatMigrate.ts` | 4 | `upgradeRideBellTracksV6` (v5 → v6) |
| `src/store/migrate.test.ts`, `src/store/projectFormatMigrate.test.ts` | 4 | one chain test each |
| `src/data/drumGrids.ts` | 5, 6 | two new grids; two row moves; head comment |
| `src/data/drumGrids.test.ts` | 5 | source-citing tests for the two new grids and the two moves |
| `src/data/vibes.ts` | 5 | two pool additions |
| `CLAUDE.md`, `docs/design.md` | 6 | voice count; pad count |
| `.claude/skills/dsp-audio/SKILL.md` | 6 | prose **and** the signal-graph fence |
| `.claude/skills/instant-vibes/SKILL.md` | 6 | the two pool additions |
| `.claude/skills/music-theory/SKILL.md` | 6 | pad table, path, synthesis-type list, the "KeyB and KeyN are free" claim |

### Created

Nothing. Every symbol this plan adds joins a table, an interface or a switch that already exists.

---

## Task 1: `RideParams`, `BellParams`, and two `triggerDrum` cases

**The design question the spec left open (open question 6) is answered here, and it is answered
against the engine rather than in the abstract.** Spec item 13 states the constraint negatively:
*"A ride is a defined ping with sustain; a bell is a pitched metallic tone. Neither is the existing
crash's wash — if either is implemented as a filtered crash, `check:drums` is the thing that should
catch it, and if it does not, the voice is not worth adding."*

Read against the source, the crash is one `drumNoiseBurst`: `filterType: 'bandpass'`, `q: 0.8`,
`freq: 5500`, `decay: 0.9`. Low Q over a broad band with a long tail — a wash, by construction. So:

- **The ride is two components, and the second is the one a crash cannot have.** A *narrow*
  bandpass noise burst (Q 4–8.5, not 0.8) is the stick strike — narrow is what makes it read as
  defined rather than sprayed — under which a **tonal square partial sustains** four to ten times
  longer than the strike. That sustaining tone is the ride's "ping"; no filter setting on a noise
  burst produces one.
- **The bell has no noise at all.** Two square oscillators, the second at an **inharmonic ratio** of
  the first (2.5–3.2×). A harmonic series would sound like a synth note; a partial near 2.7× is
  what a struck bell actually has, and the beating between the two is what the ear hears as
  "metal". Zero noise is also the property that makes it unmistakable next to hihat and crash,
  which are noise and nothing else.

Both are built from the two private helpers that already exist. **No new synthesis helper is
added** — a third helper would be a third thing to keep in lockstep with `drumEnv` and
`wireDrumVoice` for no gain.

**One engine change is behaviour-preserving and must stay that way.** `drumTone` calls
`this.wireDrumVoice(env)` with no send, so a purely tonal voice cannot reach the reverb. It gains an
optional `reverbSend` passed straight through. Every existing caller (kick body, kick click, snare
body, tom) passes nothing, so `o.reverbSend` is `undefined`, `wireDrumVoice`'s default `0` applies,
and the function returns `null` exactly as today. Step 5 pins that with a regression test.

**`ride` stops being an alias for `crash`.** `DRUM_ALIASES` maps `ride: 'crash'` today, and two
tests pin it. Leaving the alias in place while adding a real `case 'ride'` would be unreachable
dead data — `DRUM_ALIASES[name] ?? name` resolves the alias *before* the switch, so `'ride'` would
still route to the crash. Delete the entry; rewrite both tests.

**Files:**
- Modify: `src/data/drumKits.ts` (the two interfaces, `DrumKit`, `DEFAULT_DRUM_KIT`);
  `src/audio/drumKits.ts` (`mergeDrumKit`); `src/audio/engine.ts:92-96` (`DRUM_ALIASES`),
  `:1595-1620` (`drumTone`), `:1749` (after `case 'crash'`); `src/audio/engine.test.ts`
  (`describe('drum voice details')`, `describe('drum aliases and unknown types')`)

**Interfaces:**
- Produces, from `@/data/drumKits`: `RideParams`, `BellParams`; `DrumKit.ride: RideParams`,
  `DrumKit.bell: BellParams`; `DEFAULT_DRUM_KIT.ride`, `DEFAULT_DRUM_KIT.bell`.
- Changed: `mergeDrumKit(partial?)` returns a nine-voice kit. `engine.triggerDrum('ride'|'bell')`
  sound. `DRUM_ALIASES` has two entries, not three.

- [ ] **Step 1: Write the failing tests**

Append to `src/audio/engine.test.ts`, inside `describe('drum voice details')`:

```ts
  test('the ride is a narrow strike plus a sustaining tonal ping, not a filtered crash', () => {
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    engine.triggerDrum('ride', 1.0);

    // Two voice envelopes (strike, ping) — the crash makes one.
    const filters = ctx._filters.slice(-1);
    expect(filters[0].type).toBe('bandpass');
    // The whole distinction from a crash, in one number: a wash is Q 0.8.
    expect(filters[0].Q.value).toBeGreaterThan(3);
    expect(filters[0].Q.value).toBeCloseTo(DEFAULT_DRUM_KIT.ride.strikeQ, 9);

    // The ping OUTLIVES the strike. Assert on the recorded ramp times rather
    // than a computed level: drumEnv schedules an exponential ramp, and the
    // point being made is about duration, not amplitude.
    const envs = ctx._gains.slice(before).filter((g: any) => g.gain.ramps.length > 0);
    const spans = envs.map((g: any) => g.gain.ramps.at(-1).t - g.gain.events[0].t);
    expect(Math.max(...spans)).toBeGreaterThan(Math.min(...spans) * 3);
  });

  test('the bell is two inharmonic square partials and no noise at all', () => {
    const { engine, ctx } = freshEngine();
    const beforeNoise = ctx._bufferSources.length;
    const beforeOsc = ctx._oscillators.length;
    engine.triggerDrum('bell', 1.0);

    // Zero noise is the property that tells a bell from a hihat and a crash,
    // both of which are noise and nothing else.
    expect(ctx._bufferSources.length).toBe(beforeNoise);

    const oscs = ctx._oscillators.slice(beforeOsc);
    expect(oscs.length).toBe(2);
    for (const o of oscs) expect(o.type).toBe('square');
    const [fundamental, partial] = oscs.map((o: any) => o.frequency.events[0].v);
    expect(partial / fundamental).toBeCloseTo(DEFAULT_DRUM_KIT.bell.partialRatio, 9);
    // Inharmonic by construction: a whole-number ratio would read as a synth
    // note, not as struck metal.
    expect(Math.abs(partial / fundamental - Math.round(partial / fundamental)))
      .toBeGreaterThan(0.1);
  });

  test('ride and bell both reach the reverb send, and kick still does not', () => {
    const { engine, ctx } = freshEngine();
    const sendOf = (type: string) => {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      return ctx._gains.slice(before).map((g: any) => g.gain.value);
    };
    expect(sendOf('ride')).toContain(DEFAULT_DRUM_KIT.ride.reverbSend);
    expect(sendOf('bell')).toContain(DEFAULT_DRUM_KIT.bell.reverbSend);
    // drumTone gained an optional reverbSend in this task. Every pre-existing
    // caller passes nothing, so wireDrumVoice's default 0 must still apply and
    // no send gain may be created.
    expect(sendOf('kick').length).toBe(1);
  });
```

Then rewrite the two alias tests in `describe('drum aliases and unknown types')`. The first loses
`ride`:

```ts
  test('closedhat and lowtom resolve to their canonical voices', () => {
    const { engine, ctx } = freshEngine();
    const counts: Record<string, number> = {};
    for (const type of ['hihat', 'closedhat', 'tom', 'lowtom']) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      counts[type] = ctx._gains.length - before;
    }
    expect(counts.closedhat).toBe(counts.hihat);
    expect(counts.lowtom).toBe(counts.tom);
  });
```

and `'ride resolves to crash specifically, not clap'` is **replaced**, not deleted — the property
worth keeping is that `ride` no longer routes to the crash:

```ts
  test('ride is its own voice now, not an alias for crash', () => {
    const { engine, ctx } = freshEngine();
    // DRUM_ALIASES resolves BEFORE the switch, so an alias left in place would
    // make `case 'ride'` unreachable dead code.
    expect(DRUM_ALIASES.ride).toBeUndefined();

    const before = ctx._gains.length;
    engine.triggerDrum('ride', 1.0);
    const ride = ctx._gains.slice(before);
    // A crash is one noise burst; a ride is a strike plus a tonal ping.
    expect(ride.length).toBeGreaterThan(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/audio/engine.test.ts -t "ride"`
Expected: FAIL — `DEFAULT_DRUM_KIT.ride` is `undefined`, and `triggerDrum('ride')` still routes
through the alias to the crash, so the new assertions do not hold.

- [ ] **Step 3: Add the two param interfaces and the defaults**

In `src/data/drumKits.ts`, after `CrashParams`:

```ts
/**
 * A ride cymbal: a DEFINED strike with a sustaining tonal ping under it.
 *
 * The distinction from CrashParams is not a filter setting. A crash is one
 * broadband noise burst at Q 0.8 — a wash. A ride is a NARROW burst (Q 4..8.5)
 * plus a square-wave partial that outlives it by 4x to 10x, and no filter value
 * on a noise burst produces that second component. If a kit's ride ever ends up
 * sounding like its crash, the ping is what went missing.
 */
export interface RideParams {
  /** Bandpass centre of the stick strike, in Hz. */
  strikeFilter: number;
  /** Bandpass Q. HIGH by design — the crash's is 0.8. */
  strikeQ: number;
  strikeDecay: number;
  strikeGain: number;
  /** The sustaining metallic partial under the strike, in Hz. */
  pingFreq: number;
  /** Always longer than strikeDecay; that ratio IS the ride. */
  pingDecay: number;
  pingGain: number;
  reverbSend: number;
}

/**
 * A bell: a pitched metallic tone, and the only drum voice with no noise
 * component at all. That is deliberate — zero noise is what tells it apart from
 * the hihat and the crash, which are noise and nothing else.
 */
export interface BellParams {
  /** The struck fundamental, in Hz. */
  freq: number;
  /**
   * The second partial, as a MULTIPLE of `freq` — 2.5..3.2, never a whole
   * number. A struck bell's overtone sits near 2.7x its fundamental, which no
   * harmonic series contains, and the beating between the two is what the ear
   * hears as metal rather than as a synth note.
   *
   * Stored as a ratio, not as a second frequency, for two reasons: retuning a
   * kit's bell then moves one number and the timbre follows, and src/data/
   * forbids arithmetic in the table.
   */
  partialRatio: number;
  decay: number;
  /** The partial's decay, shorter than `decay` on every kit. */
  partialDecay: number;
  gain: number;
  partialGain: number;
  reverbSend: number;
}
```

Add both to `DrumKit`:

```ts
export interface DrumKit {
  kick: KickParams;
  snare: SnareParams;
  hihat: HatParams;
  openhat: HatParams;
  clap: ClapParams;
  tom: TomParams;
  crash: CrashParams;
  ride: RideParams;
  bell: BellParams;
}
```

and to `DEFAULT_DRUM_KIT`, after `crash`:

```ts
  ride: { strikeFilter: 8000, strikeQ: 6, strikeDecay: 0.09, strikeGain: 0.32, pingFreq: 3200, pingDecay: 0.55, pingGain: 0.16, reverbSend: 0.2 },
  bell: { freq: 620, partialRatio: 2.76, decay: 0.9, partialDecay: 0.45, gain: 0.4, partialGain: 0.18, reverbSend: 0.25 },
```

- [ ] **Step 4: Extend `mergeDrumKit`**

`src/audio/drumKits.ts` — two more spread lines, in the same order as the interface:

```ts
    crash: { ...DEFAULT_DRUM_KIT.crash, ...partial?.crash },
    ride: { ...DEFAULT_DRUM_KIT.ride, ...partial?.ride },
    bell: { ...DEFAULT_DRUM_KIT.bell, ...partial?.bell },
```

- [ ] **Step 5: Give `drumTone` an optional reverb send**

`src/audio/engine.ts`. The option object gains one field and the wiring call gains one argument;
nothing else in the method changes.

```ts
  /** A pitched drum component (kick body, kick click, snare body, tom, bell, ride ping). */
  private drumTone(o: {
    type?: OscillatorType;
    freq: number;
    freqEnd?: number;
    pitchTime?: number;
    peak: number;
    decay: number;
    t: number;
    stopAt?: number;
    /**
     * Optional and defaulted by wireDrumVoice to 0, so every pre-existing
     * caller — which passes nothing — creates no send gain and behaves exactly
     * as before. It exists because the bell is purely tonal: without it, the
     * one voice with no noise component would also be the one voice that
     * cannot reach the reverb.
     */
    reverbSend?: number;
  }): void {
```

and, inside the body:

```ts
    const send = this.wireDrumVoice(env, o.reverbSend);
```

- [ ] **Step 6: Add the two `triggerDrum` cases and drop the alias**

`src/audio/engine.ts`, after `case 'crash'`:

```ts
      case 'ride': {
        const r = k.ride;
        // The strike: a NARROW bandpass burst. The crash uses q 0.8 (a wash);
        // this is 4..8.5, which is what reads as a defined stick hit rather
        // than a cymbal spray.
        this.drumNoiseBurst({
          filterType: 'bandpass', freq: r.strikeFilter, q: r.strikeQ,
          peak: v * r.strikeGain, decay: r.strikeDecay, t: now,
          stopPad: 0.02, reverbSend: r.reverbSend,
        });
        // The sustain: a tonal partial that outlives the strike. This is the
        // half no filter setting on a noise burst can produce, and it is why
        // a ride is a separate voice rather than a crash preset.
        this.drumTone({
          type: 'square', freq: r.pingFreq, peak: v * r.pingGain,
          decay: r.pingDecay, t: now, reverbSend: r.reverbSend,
        });
        break;
      }
      case 'bell': {
        const b = k.bell;
        // No noise at all — that is the whole difference from crash and hihat.
        this.drumTone({
          type: 'square', freq: b.freq, peak: v * b.gain, decay: b.decay,
          t: now, reverbSend: b.reverbSend,
        });
        // The inharmonic partial. stopAt holds it to the fundamental's window
        // so the two oscillators tear down together, the way the kick's click
        // is held to the kick's.
        this.drumTone({
          type: 'square', freq: b.freq * b.partialRatio, peak: v * b.partialGain,
          decay: b.partialDecay, t: now, stopAt: now + b.decay + 0.02,
          reverbSend: b.reverbSend,
        });
        break;
      }
```

Then `DRUM_ALIASES` loses one entry and its docblock loses a number:

```ts
/**
 * Names callers use that map onto one of the 9 authored drum types. Exported
 * so a test can prove every target is real.
 *
 * `ride` used to be here, mapped to `crash`. It is a real voice now, and the
 * alias had to go with it: DRUM_ALIASES resolves BEFORE the switch, so leaving
 * it would have made `case 'ride'` unreachable.
 */
export const DRUM_ALIASES: Record<string, string> = Object.assign(Object.create(null), {
  closedhat: 'hihat',
  lowtom: 'tom',
});
```

- [ ] **Step 7: Extend the two sweeps that enumerate voices in the test file**

`src/audio/engine.test.ts` has two loops over a literal list of drum types — `'every drum envelope
floors at the same 0.0001'` (`:1574`) and the one at `:1655`. Both gain `'ride'` and `'bell'`. Find
them by evaluating rather than by memory:

Run: `grep -n "'kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'" src/audio/engine.test.ts`

Every hit becomes `'kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash', 'ride', 'bell'`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS — including the two rewritten alias tests and the three new voice tests.

Then confirm the merge is complete, by evaluating rather than by reading:

Run: `bun -e "import {mergeDrumKit} from './src/audio/drumKits.ts'; console.log(Object.keys(mergeDrumKit(undefined)).join(','))"`
Expected: `kick,snare,hihat,openhat,clap,tom,crash,ride,bell`

Then the gate:

Run: `bun run verify`
Expected: **FAIL at `check:drums`** is acceptable *only* if the failure is check 1 reporting that
kits do not override `ride`/`bell` — but `DRUM_TYPES` does not include them yet, so it should PASS.
If anything else fails, stop.

- [ ] **Step 9: Commit**

```bash
git add src/data/drumKits.ts src/audio/drumKits.ts src/audio/engine.ts src/audio/engine.test.ts
git commit -m "feat(audio): add the ride and bell drum voices

A ride is a narrow bandpass strike (Q 4..8.5, not the crash's 0.8) under a
square partial that outlives it several times over; a bell is two square
partials at an inharmonic ratio and no noise at all. Neither is a filtered
crash, which is one broadband burst and a wash by construction.

drumTone gains an optional reverbSend so a purely tonal voice can reach the
reverb; every pre-existing caller passes nothing and creates no send gain, and
a test pins that. DRUM_ALIASES loses ride -> crash: aliases resolve before the
switch, so leaving it would make case 'ride' unreachable."
```

---

## Task 2: Twelve kits gain a ride and a bell

**This is the bulk of the work, and it is a task rather than a step for the reason spec item 15
gives:** `check:drums`'s second check compares *merged kits against each other*, so adding one
voice already forces a tuning pass over all twelve. Adding the second in the same pass is the same
pass, not a second one.

**The check has two halves, and they pull in opposite directions.** Check 1 demands every kit
override every type, so a kit cannot simply inherit the default ride. Check 2 demands the merged
values spread — `max >= factor * min` — so twelve overrides that all cluster near the default fail
even though each one technically overrides. What satisfies both is a *deliberate axis per kit*: the
values below run darkest (Lo-Fi Vinyl) to brightest (Chrome Pulse) on filter and pitch, and
shortest (Velocity Breaks, Tight Pocket) to longest (Acoustic Studio, Sub Weight) on decay, so the
spread is a consequence of the kits' existing characters rather than a number invented to pass.

**Say plainly what the check does and does not prove.** It proves the parameters differ far enough
that the voices cannot be the same sound. It does not prove that any of them sounds like a ride or
a bell. That is the listening checklist at the end of this plan, and it is not optional.

**Files:**
- Modify: `src/data/drumKits.ts` (24 param objects); `scripts/check-drum-kit-separation.ts`
  (`DRUM_TYPES`, four spread checks)

**Interfaces:**
- Changed: every entry of `DRUM_KITS` carries `ride` and `bell`. `DRUM_TYPES` has nine members.

- [ ] **Step 1: Extend `DRUM_TYPES` first, so the check fails for the right reason**

`scripts/check-drum-kit-separation.ts`:

```ts
const DRUM_TYPES: (keyof DrumKit)[] = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash', 'ride', 'bell'];
```

Run: `bun run check:drums`
Expected: FAIL — 24 lines of `kit "…" overrides ride  (NO override: ride equals DEFAULT_DRUM_KIT)`
and the same for `bell`, and `24 check(s) FAILED.` That failure list is the work list for Step 2.

- [ ] **Step 2: Author all twelve kits' ride and bell**

`src/data/drumKits.ts`. Each pair goes at the end of its kit's object, after `crash`, in the same
order as `DrumKit`. Every value is on the kit's own existing axis — the darkest kit gets the darkest
ride, the wettest kit the wettest bell.

```ts
  'Retro Drive': {
    // … kick through crash unchanged …
    ride: { strikeFilter: 8600, strikeQ: 6.5, strikeDecay: 0.08, strikeGain: 0.3, pingFreq: 3400, pingDecay: 0.5, pingGain: 0.15, reverbSend: 0.25 },
    bell: { freq: 700, partialRatio: 2.76, decay: 0.85, partialDecay: 0.4, gain: 0.38, partialGain: 0.17, reverbSend: 0.3 },
  },
  '909 Modern': {
    ride: { strikeFilter: 9200, strikeQ: 7, strikeDecay: 0.07, strikeGain: 0.3, pingFreq: 3800, pingDecay: 0.4, pingGain: 0.14, reverbSend: 0.2 },
    bell: { freq: 780, partialRatio: 2.9, decay: 0.7, partialDecay: 0.32, gain: 0.36, partialGain: 0.16, reverbSend: 0.22 },
  },
  'Trap Beat': {
    ride: { strikeFilter: 8800, strikeQ: 8, strikeDecay: 0.06, strikeGain: 0.28, pingFreq: 4200, pingDecay: 0.75, pingGain: 0.14, reverbSend: 0.18 },
    bell: { freq: 900, partialRatio: 3.05, decay: 1.1, partialDecay: 0.5, gain: 0.34, partialGain: 0.15, reverbSend: 0.18 },
  },
  '808 Vintage': {
    ride: { strikeFilter: 5400, strikeQ: 5, strikeDecay: 0.1, strikeGain: 0.3, pingFreq: 2600, pingDecay: 0.5, pingGain: 0.16, reverbSend: 0.2 },
    bell: { freq: 520, partialRatio: 2.6, decay: 0.9, partialDecay: 0.45, gain: 0.4, partialGain: 0.2, reverbSend: 0.2 },
  },
  'Chrome Pulse': {
    ride: { strikeFilter: 10500, strikeQ: 7.5, strikeDecay: 0.07, strikeGain: 0.28, pingFreq: 4600, pingDecay: 0.6, pingGain: 0.13, reverbSend: 0.4 },
    bell: { freq: 1040, partialRatio: 3.2, decay: 0.95, partialDecay: 0.42, gain: 0.32, partialGain: 0.15, reverbSend: 0.45 },
  },
  'Velocity Breaks': {
    ride: { strikeFilter: 9000, strikeQ: 7, strikeDecay: 0.05, strikeGain: 0.28, pingFreq: 3900, pingDecay: 0.3, pingGain: 0.12, reverbSend: 0.15 },
    bell: { freq: 820, partialRatio: 2.95, decay: 0.5, partialDecay: 0.22, gain: 0.34, partialGain: 0.15, reverbSend: 0.15 },
  },
  'Sub Weight': {
    ride: { strikeFilter: 7600, strikeQ: 5.5, strikeDecay: 0.11, strikeGain: 0.32, pingFreq: 3000, pingDecay: 0.8, pingGain: 0.18, reverbSend: 0.45 },
    bell: { freq: 560, partialRatio: 2.7, decay: 1.2, partialDecay: 0.55, gain: 0.42, partialGain: 0.2, reverbSend: 0.45 },
  },
  'Warehouse': {
    ride: { strikeFilter: 9600, strikeQ: 8.5, strikeDecay: 0.06, strikeGain: 0.28, pingFreq: 4400, pingDecay: 0.45, pingGain: 0.13, reverbSend: 0.25 },
    bell: { freq: 880, partialRatio: 3.1, decay: 0.75, partialDecay: 0.3, gain: 0.34, partialGain: 0.14, reverbSend: 0.25 },
  },
  'Tight Pocket': {
    ride: { strikeFilter: 6600, strikeQ: 6, strikeDecay: 0.06, strikeGain: 0.3, pingFreq: 2900, pingDecay: 0.28, pingGain: 0.14, reverbSend: 0.12 },
    bell: { freq: 640, partialRatio: 2.8, decay: 0.55, partialDecay: 0.24, gain: 0.38, partialGain: 0.16, reverbSend: 0.12 },
  },
  'Acoustic Studio': {
    ride: { strikeFilter: 7200, strikeQ: 4.5, strikeDecay: 0.13, strikeGain: 0.34, pingFreq: 3100, pingDecay: 1.4, pingGain: 0.2, reverbSend: 0.4 },
    bell: { freq: 600, partialRatio: 2.65, decay: 1.6, partialDecay: 0.7, gain: 0.42, partialGain: 0.22, reverbSend: 0.4 },
  },
  'Warm Riddim': {
    ride: { strikeFilter: 5000, strikeQ: 5, strikeDecay: 0.1, strikeGain: 0.28, pingFreq: 2400, pingDecay: 0.9, pingGain: 0.17, reverbSend: 0.35 },
    bell: { freq: 480, partialRatio: 2.55, decay: 1.3, partialDecay: 0.6, gain: 0.4, partialGain: 0.21, reverbSend: 0.35 },
  },
  'Lo-Fi Vinyl': {
    ride: { strikeFilter: 4000, strikeQ: 4, strikeDecay: 0.09, strikeGain: 0.24, pingFreq: 2100, pingDecay: 0.6, pingGain: 0.14, reverbSend: 0.28 },
    bell: { freq: 400, partialRatio: 2.5, decay: 1.0, partialDecay: 0.5, gain: 0.34, partialGain: 0.18, reverbSend: 0.28 },
  },
```

Two properties hold across the twelve, and both are load-bearing rather than decorative:

- **`pingDecay > strikeDecay` in every kit**, by between 4x (Tight Pocket, Velocity Breaks) and
  11x (Acoustic Studio). That ratio is the ride.
- **`partialRatio` is never a whole number**, running 2.5 to 3.2. A `3.0` would be a perfect
  twelfth and would read as a synth note.

- [ ] **Step 3: Add the four spread checks**

`scripts/check-drum-kit-separation.ts`, after the `crash.filter` line. Four, not two: one filter and
one decay per voice, because a set of rides that differ only in brightness and not in sustain would
pass a filter-only check while all sounding like the same cymbal at different EQ settings.

```ts
spread('crash.filter', (k) => k.crash.filter, 1.5);
// Ride: brightness AND sustain. A filter-only check would pass twelve rides
// that are one cymbal at twelve EQ settings.
spread('ride.strikeFilter', (k) => k.ride.strikeFilter, 1.8);
spread('ride.pingDecay', (k) => k.ride.pingDecay, 3);
// Bell: pitch AND ring. Same argument.
spread('bell.freq', (k) => k.bell.freq, 2);
spread('bell.decay', (k) => k.bell.decay, 2.5);
```

The margins, from the values in Step 2 — each is comfortably clear, so a later kit retune has room
to move without tripping the check:

| check | min | max | required | margin |
|---|---|---|---|---|
| `ride.strikeFilter` | 4000 (Lo-Fi Vinyl) | 10500 (Chrome Pulse) | 7200 | 1.46× the requirement |
| `ride.pingDecay` | 0.28 (Tight Pocket) | 1.4 (Acoustic Studio) | 0.84 | 1.67× |
| `bell.freq` | 400 (Lo-Fi Vinyl) | 1040 (Chrome Pulse) | 800 | 1.30× |
| `bell.decay` | 0.5 (Velocity Breaks) | 1.6 (Acoustic Studio) | 1.25 | 1.28× |

- [ ] **Step 4: Run the check to verify it passes**

Run: `bun run check:drums`
Expected: PASS — 108 override lines (12 kits × 9 types) and 12 spread lines, `All checks passed.`

Confirm the count by evaluating rather than by counting output lines:

Run: `bun -e "import {DRUM_KITS} from './src/data/drumKits.ts'; const k=Object.values(DRUM_KITS); console.log(k.length, k.every(x=>x.ride&&x.bell))"`
Expected: `12 true`

Run: `bun run verify`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/drumKits.ts scripts/check-drum-kit-separation.ts
git commit -m "feat(audio): tune a ride and a bell into all twelve drum kits

check:drums compares merged kits against each other, so one new voice already
forces a pass over all twelve; both ship in that one pass rather than tuning
twelve kits twice. Each pair sits on its kit's existing axis — Lo-Fi Vinyl
darkest, Chrome Pulse brightest, Acoustic Studio longest — so the spread is a
consequence of the kits' characters, not a number invented to pass.

DRUM_TYPES gains ride and bell, and four spread checks join it: one filter and
one decay per voice, because a filter-only check would pass twelve rides that
are one cymbal at twelve EQ settings.

The check proves the parameters differ. It does not prove either voice sounds
like the instrument it is named after; that is the listening pass."
```

---

## Task 3: Two drum pads, on `KeyB` and `KeyN`

**The spec left the codes unsearched (open question 3) and named `check:keys` as the arbiter. The
answer was already written down.** `.claude/skills/music-theory/SKILL.md:172` states that *"only
`KeyB`, `KeyN` and `Digit0`–`Digit9` are free of the chromatic table, the drum pads and the
scale-locked rows"*. `KeyB` and `KeyN` are also **physically adjacent to the existing drum row**
(`Z X C V ␣ B N M , . /` — the pads hold `Z X C V M , . /`, and `B N` are the two gaps in it), so
the ten pads become one contiguous run under the left hand instead of a row with two holes and two
digits bolted on. Digits would pass the check and be worse to play.

`check:keys` is still the arbiter — Step 3 runs it — but this is a verification, not a search.

**One layout consequence, decided here rather than discovered.** The grid is
`grid-cols-4 sm:grid-cols-8`. Eight pads filled that second row exactly; ten leave an orphan pair
hanging off the end of it. `sm:grid-cols-5` gives two even rows of five, which is also how the ten
codes read on a keyboard (`Z X C V B` / `N M , . /`). The mobile `grid-cols-4` stays: five columns
of pads on a phone is cramped, and two rows of four plus a pair is the lesser cost.

**Files:**
- Modify: `src/components/ui/DrumPadGrid.tsx` (`DEFAULT_PADS`, the grid class)

**Interfaces:**
- Changed: `DEFAULT_PADS` has ten entries. `check:keys`'s `drumCodes` set has ten members.

- [ ] **Step 1: Confirm the two codes are free, by evaluating**

Do not trust the skill file; it is a doc and this task falsifies part of it.

Run: `bun -e "import {KEYBOARD_NOTES} from './src/components/loop/SynthView.tsx'; import {DEFAULT_PADS} from './src/components/ui/DrumPadGrid.tsx'; const taken=new Set([...KEYBOARD_NOTES.map(k=>k.key),...DEFAULT_PADS.map(p=>p.shortcut)]); console.log('KeyB', taken.has('KeyB'), 'KeyN', taken.has('KeyN'))"`
Expected: `KeyB false KeyN false`

If either is `true`, stop: the skill file is out of date in the other direction and the codes must
be re-chosen before anything else in this task.

- [ ] **Step 2: Add the two pads**

`src/components/ui/DrumPadGrid.tsx`. The colour ramp rotates primary → secondary → accent and the
eighth pad (`crash`) is `secondary`, so the ninth is `accent` and the tenth `primary`; continuing
the rotation is what keeps neighbours distinguishable in both grid widths, which is what the head
comment says the ramp is for.

```ts
  { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'Slash', volume: 0.75, pitch: 0, decay: 0.8 },
  { id: 'ride', name: 'Ride Cymbal', note: 'ride', color: 'from-accent to-accent/60 text-accent-content', shortcut: 'KeyB', volume: 0.7, pitch: 0, decay: 0.55 },
  { id: 'bell', name: 'Bell', note: 'bell', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'KeyN', volume: 0.7, pitch: 0, decay: 0.9 },
];
```

and update the head comment's count and add the adjacency reason:

```
 * `DEFAULT_PADS` — the shortcut codes here are the source of truth for the
 * drum half of the global key map. Ten pads, and the ten codes are one
 * contiguous run on the bottom keyboard row (`Z X C V B` / `N M , . /`):
 * `KeyB` and `KeyN` were the two gaps in it, which is why the ride and the
 * bell took them rather than a digit that would also have passed check:keys.
```

Then the grid class:

```tsx
    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 sm:gap-2.5">
```

- [ ] **Step 3: Run the checks to verify they pass**

Run: `bun run check:keys`
Expected: PASS, with the drum-code line now reading
`KeyZ KeyX KeyC KeyV KeyM Comma Period Slash KeyB KeyN` — ten codes, unique, zero overlap, all
matching the `KeyboardEvent.code` regex.

Run: `bun test src/components/ui/DrumPadGrid.test.tsx src/components/DrumPads.test.tsx`
Expected: PASS. If either file pins the eight-pad count or the `sm:grid-cols-8` class, update the
expectation to ten and `sm:grid-cols-5` — those are the two values this task deliberately changes,
and nothing else in either file may move.

Run: `bun run check:theme`
Expected: PASS — the two new `color` strings are semantic tokens with no raw hex and no palette
class.

Run: `bun run verify`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/DrumPadGrid.tsx
git commit -m "feat(ui): give the ride and bell drum pads, on KeyB and KeyN

The two codes were the only free ones adjacent to the existing drum row: the
pads hold Z X C V M , . / and B N are the two gaps in it, so ten pads are now
one contiguous run under the left hand. Digits were also free and would also
have passed check:keys; they would have been worse to play.

The sm grid goes from eight columns to five, so ten pads are two even rows
instead of one row of eight with an orphan pair."
```

---

## Task 4: Two sequencer tracks, and the second migration round

**Spec item 11 named a trap and left it for this plan (open question 4): `THEME_TOKENS` has eight
non-surface entries — primary, secondary, accent, neutral, success, warning, error, info — and
after this task there are nine tracks.** Nine into eight does not go.

**The decision, with its reason: `ride` takes `bg-info`, deliberately shared with `crash`, and
`bell` takes `bg-neutral`.**

Three options were on the table and the other two are worse:

- *An opacity variant* (`bg-info/60`) reads as "the same thing, disabled" in a UI where every other
  track is a solid fill, and the sequencer already uses opacity to mean an inactive step. It would
  make a ride track look muted.
- *Changing how a track's colour is assigned* — deriving it from a hash, or adding a
  `--color-module-*` token — is a theming change, not a drum change. `docs/design.md:315` is
  explicit that there is deliberately no `module-drum` token because the sequencer is not a signal
  stage with an identity to defend; inventing one to seat a ninth track would reverse a settled
  decision for an unrelated reason.
- *Repeating a token* costs one thing only: two tracks look alike. **So the cost should land where
  looking alike is honest**, and crash-and-ride is the honest pair — they are the two cymbals, they
  are the two rows a drummer thinks of as one hand, and a user who confuses them has confused two
  members of the same family rather than a cymbal with a kick. Every other pairing (bell with kick,
  ride with snare) would be arbitrary.

`bg-neutral` was the last unused non-surface token and goes to `bell`, which is the voice least
like anything else on the grid.

**On the migration: neither chain has a top-level `sequencerTracks`** — see correction 1 above.
Both steps map `loops` and nothing else. The two tests stay separate.

**The appended tracks are silent** — `steps` all `false` — so no existing session and no existing
`.solna` file changes sound. That is the same discipline `upgradePadLayerV4` follows with
`padMuted: true`: *"a project written before the layer existed must reopen sounding the way it
sounded when it was closed."*

**Adding two tracks costs nothing at apply time, because Part 1 settled the semantics first.**
`replaceDrumPattern` clears the window of every track the grid does not name, so the seventeen
grids that name no `ride` and the thirty that name no `bell` silence those tracks rather than
leaving them ringing. Had the old skip-if-absent behaviour survived into this slice, every one of
those grids would have become a stale-voice bug the moment the tracks existed. It did not, and
this plan takes no position on it — spec item 10a is Part 1's.

**Files:**
- Modify: `src/store/initialState.ts` (two tracks); `src/store/migrate.ts`
  (`migrateRideBellTracks`); `src/store/store.ts` (`version`, one chain line);
  `src/store/projectFormat.ts` (`PROJECT_FORMAT_VERSION`); `src/store/projectFormatMigrate.ts`
  (`upgradeRideBellTracksV6`, one chain line); `src/store/migrate.test.ts`;
  `src/store/projectFormatMigrate.test.ts`

**Interfaces:**
- Consumes: `withDrumTracks` (`@/store/…`, wherever Part 1 placed it); `mapLoops`
  (`store/migrate.ts`); `mapBodyLoops` (`store/projectFormatMigrate.ts`); `SequencerTrack`
  (type, `@/types`).
- Produces: `migrateRideBellTracks<T extends object>(state: T): T`;
  `upgradeRideBellTracksV6(raw: Record<string, unknown>): Record<string, unknown>` (module-private).
- Changed: `INITIAL_SEQUENCER_TRACKS` has nine entries; persist `version` is 14;
  `PROJECT_FORMAT_VERSION` is 6.

- [ ] **Step 1: Confirm how Part 1 wired `withDrumTracks`'s canonical list, before writing anything**

Run: `grep -rn "withDrumTracks" src | grep -v test`

**Settled — there is only one list.** Part 1 ships `withDrumTracks` deriving its canonical set
from `INITIAL_SEQUENCER_TRACKS` itself; it holds no `CANONICAL_DRUM_TRACKS` const:

```ts
const missing = INITIAL_SEQUENCER_TRACKS.filter((t) => !present.has(t.instrument));
```

So **Step 2 alone extends it and there is nothing further to do here** — adding the `ride` and
`bell` entries to `INITIAL_SEQUENCER_TRACKS` is what teaches both migration chains about them.
The grep above is still a step, not a formality: it is how you confirm Part 1 landed the version
you are building on before you rely on this.

One property of Part 1's implementation you must not break when you extend the list: it appends
`{ ...t, steps: [...t.steps] }`, fresh object AND fresh steps array. Appending the module
constants themselves would make every loop in a payload share one bar, so toggling a `ride` step
in one loop would toggle it in the others and in `INITIAL_SEQUENCER_TRACKS`. Your new entries
need no special handling — just do not "simplify" that spread away.

- [ ] **Step 2: Write the failing tests**

Two tests, one per chain, in the two files that already own those chains. They are deliberately
near-identical in shape and deliberately not shared: a project body is an external contract and the
persist payload is private `localStorage` shape.

`src/store/migrate.test.ts`:

```ts
describe('v13 -> v14: ride and bell sequencer tracks', () => {
  test('every loop gains a silent ride and bell track', () => {
    const payload = {
      loops: [
        { id: 'a', sequencerTracks: INITIAL_SEQUENCER_TRACKS.slice(0, 7) },
        { id: 'b', sequencerTracks: INITIAL_SEQUENCER_TRACKS.slice(0, 7) },
      ],
    };
    const out = migrateRideBellTracks(payload) as typeof payload;
    for (const loop of out.loops) {
      const names = loop.sequencerTracks.map((t) => t.instrument);
      expect(names).toEqual(['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash', 'ride', 'bell']);
      // Silent, so no session changes sound. The rows are heard only when a
      // grid or a vibe is applied afterwards, which is a user action.
      for (const t of loop.sequencerTracks.slice(7)) {
        expect(t.steps.every((s) => s === false)).toBe(true);
      }
    }
  });

  test('a user-programmed track comes back as the SAME object, not an equal one', () => {
    const mine = { ...INITIAL_SEQUENCER_TRACKS[0], name: 'My Kick', color: 'bg-neutral', muted: true };
    const out = migrateRideBellTracks({ loops: [{ sequencerTracks: [mine] }] }) as any;
    // toBe, not toEqual: a withDrumTracks that rebuilt every track from
    // defaults would pass toEqual today and lose a rename tomorrow.
    expect(out.loops[0].sequencerTracks[0]).toBe(mine);
  });

  test('running it twice is running it once', () => {
    const payload = { loops: [{ sequencerTracks: INITIAL_SEQUENCER_TRACKS.slice(0, 7) }] };
    const once = migrateRideBellTracks(payload);
    expect(migrateRideBellTracks(once)).toEqual(once);
  });

  test('a loop with no sequencerTracks is left alone, not given a default set', () => {
    const payload = { loops: [{ id: 'a' }] };
    expect(migrateRideBellTracks(payload)).toEqual(payload);
  });
});
```

`src/store/projectFormatMigrate.test.ts`:

```ts
describe('project body v5 -> v6: ride and bell sequencer tracks', () => {
  test('migrateProjectBody appends both tracks to every loop in the content', () => {
    const body = {
      formatVersion: 5,
      content: { loops: [{ sequencerTracks: INITIAL_SEQUENCER_TRACKS.slice(0, 7) }] },
    };
    const out = migrateProjectBody(body as any, 5) as any;
    const names = out.content.loops[0].sequencerTracks.map((t: any) => t.instrument);
    expect(names.slice(-2)).toEqual(['ride', 'bell']);
  });

  test('a body already at v6 is unchanged, because the transform appends only', () => {
    const body = {
      formatVersion: 6,
      content: { loops: [{ sequencerTracks: INITIAL_SEQUENCER_TRACKS }] },
    };
    expect(migrateProjectBody(body as any, 6)).toEqual(body);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/store/migrate.test.ts src/store/projectFormatMigrate.test.ts`
Expected: FAIL — `migrateRideBellTracks is not a function`, and the project-body test gets
`['tom', 'crash']` because `PROJECT_FORMAT_VERSION` is still 5 and no v6 step exists.

- [ ] **Step 4: Add the two tracks**

`src/store/initialState.ts`, after the crash track. `steps` is 24 wide — the widest meter's
`MAX_STEPS_PER_BAR` — like every other track in the array.

```ts
  {
    id: 'track-ride',
    name: 'Ride Cymbal',
    instrument: 'ride',
    steps: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.7,
    muted: false,
    // Deliberately the same token as the crash. THEME_TOKENS has eight
    // non-surface entries and this is the ninth track, so exactly one pair must
    // look alike — and the two cymbals are the honest pair. An opacity variant
    // would read as "muted" in a grid that already uses opacity for that, and
    // a new module token would reverse docs/design.md's settled decision that
    // the sequencer has no identity colour to defend.
    color: 'bg-info',
  },
  {
    id: 'track-bell',
    name: 'Bell',
    instrument: 'bell',
    steps: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.7,
    muted: false,
    color: 'bg-neutral',
  },
```

- [ ] **Step 5: Add the persist step (v13 → v14)**

`src/store/migrate.ts`, next to `migratePadLayer`:

```ts
/**
 * v13 -> v14: the ride and bell sequencer tracks.
 *
 * Shares only withDrumTracks() with the project chain's upgradeRideBellTracksV6
 * and must not be refactored into one function with it: a project body is an
 * external contract, the persist payload is private localStorage shape, and
 * their version numbers move for different reasons. Same rule
 * upgradePadLayerV4's docblock records for defaultPadState().
 *
 * Loops only, and that is complete: partializeAppState is an allowlist of nine
 * global fields plus `loops`, and the flat top-level sequencerTracks is
 * deliberately not among them (it is the working copy of the active loop, which
 * loadLoop refills).
 *
 * The appended tracks are silent, so no stored session changes sound.
 */
export function migrateRideBellTracks<T extends object>(state: T): T {
  return mapLoops(state, (loop) => {
    if (!Array.isArray(loop.sequencerTracks)) return loop;
    return { ...loop, sequencerTracks: withDrumTracks(loop.sequencerTracks as SequencerTrack[]) };
  });
}
```

`src/store/store.ts` — `version: 13` becomes `version: 14`, the import list gains
`migrateRideBellTracks`, and the ordered chain gains **one more line at the bottom**, which is what
its own comment says a new version is:

```ts
        // v12 -> v13 (tom + crash tracks)
        if (version < 13) next = migrateDrumTracks(next) as PersistedState;
        // v13 -> v14 (ride + bell tracks)
        if (version < 14) next = migrateRideBellTracks(next) as PersistedState;
        return next;
```

(The `v12 -> v13` line is Part 1's; match its actual function name.)

- [ ] **Step 6: Add the project-body step (v5 → v6)**

`src/store/projectFormat.ts`:

```ts
export const PROJECT_FORMAT_VERSION = 6;
```

`src/store/projectFormatMigrate.ts`, next to `upgradePadLayerV4`:

```ts
/**
 * v5 -> v6: the ride and bell sequencer tracks.
 *
 * The mirror of the persist chain's migrateRideBellTracks, and separate from it
 * on purpose — see upgradePadLayerV4's docblock. They share withDrumTracks()
 * and nothing else.
 *
 * Content loops only: PROJECT_CONTENT_KEYS is bpm, meterId, masterVolume,
 * effects and loops, so a body has no top-level sequencerTracks to reach.
 */
function upgradeRideBellTracksV6(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (loop) => {
    if (!Array.isArray(loop.sequencerTracks)) return loop;
    return { ...loop, sequencerTracks: withDrumTracks(loop.sequencerTracks as SequencerTrack[]) };
  });
}

export function migrateProjectBody(
  raw: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  let next: Record<string, unknown> = { ...raw };
  if (fromVersion < 2) next = upgradeLeadNotesV2(next);
  if (fromVersion < 3) next = upgradeLeadTicksV3(next);
  if (fromVersion < 4) next = upgradePadLayerV4(next);
  if (fromVersion < 5) next = upgradeDrumTracksV5(next);
  if (fromVersion < 6) next = upgradeRideBellTracksV6(next);
  return next;
}
```

(`upgradeDrumTracksV5` is Part 1's; match its actual name.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/store/migrate.test.ts src/store/projectFormatMigrate.test.ts src/store/store.test.ts`
Expected: PASS. `store.test.ts:198` asserts `s.sequencerTracks` equals `INITIAL_SEQUENCER_TRACKS`
and follows the array, so it needs no edit; if any test there pins a track *count*, update it to
nine and nothing else.

Verify the two version numbers by evaluating, not by reading the diff:

Run: `bun -e "import {PROJECT_FORMAT_VERSION} from './src/store/projectFormat.ts'; import {INITIAL_SEQUENCER_TRACKS as T} from './src/store/initialState.ts'; console.log(PROJECT_FORMAT_VERSION, T.length, T.map(t=>t.instrument).join(','), new Set(T.map(t=>t.color)).size)"`
Expected: `6 9 kick,snare,hihat,openhat,clap,tom,crash,ride,bell 8` — **eight distinct colours for
nine tracks is the expected result**, not a bug; it is the shared cymbal token.

Run: `bun run check:theme`
Expected: PASS.

Run: `bun run verify`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/store/initialState.ts src/store/migrate.ts src/store/store.ts src/store/projectFormat.ts src/store/projectFormatMigrate.ts src/store/migrate.test.ts src/store/projectFormatMigrate.test.ts
git commit -m "feat(store): add the ride and bell sequencer tracks

Nine tracks against eight non-surface theme tokens, so exactly one pair must
share one. Ride takes crash's bg-info deliberately: they are the two cymbals,
which is the only pairing where looking alike is honest. An opacity variant
would read as muted in a grid that already uses opacity for that, and a new
module token would reverse the settled decision that the sequencer has no
identity colour.

Both migration chains gain a step that calls the same withDrumTracks and
nothing else — persist 13 -> 14, project body 5 -> 6 — and stay two functions
in two files for the reason upgradePadLayerV4 records. Both map loops only:
neither payload carries a top-level sequencerTracks (partializeAppState's
allowlist and PROJECT_CONTENT_KEYS both stop at loops).

The appended tracks are silent, so no stored session or .solna file changes
sound."
```

---

## Task 5: `bembe-standard-bell`, `jazz-waltz-ride`, and two rows going home

**This is the half of slice 1 item 1 that could not be shipped then.** Part 1 wrote the bembé bell
onto `afro-6-8`'s `hihat` and the jazz ride onto `waltz`'s, because the rhythm could be made correct
before the timbre could. Its own blockquote is the promise this task keeps: *"A bembé bell played by
a closed hi-hat is the right rhythm on the wrong instrument, and so is a jazz ride. Slice 2 gives
both a real row and moves them there."*

### The question the brief demands an explicit answer to: what does each `hihat` row become?

**A real hi-hat part, in both.** Under `replaceDrumPattern` an **absent row and an empty row do the
same thing** — both clear the track's window — so "leave it empty" and "leave it out" are not two
options, they are one, and what that one option produces is **silence**. The grid does not get to
abstain. It states a hi-hat part or it states no hi-hat.

That makes the choice a musical one, and the sources answer it. Spec item 14: *"Only after that can
either grid express what the survey says the real arrangement does — bell and hi-hat sounding at
the same time, on two rows."* Survey Part 4 says these two idioms are *"doubly blocked"*, the
second block being that *"in real drum-set arrangements the bell and the hihat play
simultaneously."* **A bembé bell over a silent hat is not the arrangement the source describes** —
it is the same half-fix slice 1 shipped, with the halves swapped. Moving the bell to `bell` and
leaving `hihat` blank would trade one wrong instrument for one missing one.

So **both get a genuine hi-hat part**, and each is the part the source describes as playing
underneath:

- **`afro-6-8`'s `hihat` returns to the straight eighth pulse `0,2,4,6,8,10`** — six hits, one per
  eighth of the 6/8 bar. That is what the row held before Part 1 borrowed it, so Part 1's edit
  becomes a loan repaid rather than an overwrite, and the bell now rides over the pulse the way the
  survey describes.
- **`waltz`'s `hihat` becomes the hi-hat foot on beats 2 and 3 — steps `4,8`.** At twelve steps in
  3/4 the beats are 0, 4 and 8, and the foot on 2 and 3 under a ride figure is the standard jazz
  waltz; it comes from the same studydrums source Part 1 already recorded as `waltz`'s provenance,
  so no new claim is being made.

**Check the silent-duplicate sweep after this, not before.** Part 1 emptied `SILENT_DUPLICATES` to
`[]` partly because `afro-6-8`'s `hihat` had been rewritten away from `afro-six-eight-bell`'s. This
task restores it, so the two grids share `hihat` again — but they now differ on `snare`
(`1,4,7,10` vs `4,10`) *and* `afro-6-8` has a `bell` row the other does not. Step 5 re-runs the
sweep rather than reasoning about it.

### Every grid is the whole kit, so both new grids need a complete, deliberate row set

There is no such thing as a two-row grid any more. `replaceDrumPattern` writes every one of the
nine tracks on every apply, so authoring three rows and omitting six is not "keeping quiet about
six" — it is **authoring six silences**. The only honest response is to decide each of the nine on
purpose and say why, including the silent ones.

The survey sources two rows of one grid and one row of the other. Everything else below is **my
arrangement**, marked as such, and each non-sourced row is either the library's own established
figure for that meter or a silence with a reason.

**`bembe-standard-bell` — 6/8, twelve steps, two dotted-quarter beats at 0 and 6**

| row | steps | where it comes from |
|---|---|---|
| `bell` | `0,2,4,5,7,9,11` | **Sourced** — the seven-stroke standard bell (Leake). This is the grid's identity. |
| `snare` | `1,4,7,10` | **Sourced** — the cross-stick, from the same table. |
| `kick` | `0,6` | **Arrangement.** The two dotted-quarter beats of 6/8, and byte-identical to `afro-6-8`'s kick, which has held that figure since before this branch. Reusing the library's own 6/8 pulse rather than inventing a third one. |
| `hihat` | `0,2,4,6,8,10` | **Arrangement.** The eighth pulse the bell rides over — this is the row the whole "bell and hi-hat sound simultaneously" argument above is about, and it is the same figure `afro-6-8` gets in Step 4. |
| `openhat` | *silent* | **Deliberate.** The bell already occupies the high metallic register on seven of twelve steps. An open hat smears it. |
| `clap` | *silent* | **Deliberate.** The cross-stick is this idiom's backbeat voice. A clap doubling it would reproduce exactly the `clap === snare` duplication the survey found in 16 of 22 grids and this whole work exists to stop repeating. |
| `tom` | *silent* | **Deliberate.** No source gives a tom part here, and inventing a fill is the "authoring past the source" failure. |
| `crash` | *silent* | **Deliberate, and load-bearing.** Under replace semantics this is the row that stops the previous grid's crash ringing on. |
| `ride` | *silent* | **Deliberate.** The bell is the sustaining-metal voice in this arrangement; a ride under it is two of them at once, which is mud. |

**`jazz-waltz-ride` — 3/4, twelve steps, beats at 0, 4 and 8**

| row | steps | where it comes from |
|---|---|---|
| `ride` | `0,4,6,8` | **Sourced** — beat 1, beat 2, the middle of beat 2, beat 3 (studydrums.com). The grid's identity. |
| `hihat` | `4,8` | **Arrangement**, from the same idiom: the hi-hat foot on beats 2 and 3. The same decision `waltz` gets in Step 4, for the same reason. |
| `kick` | `0` | **Arrangement.** A feathered downbeat, byte-identical to `waltz` and `waltz-brush-three`, both of which are kick `[0]` today. |
| `snare` | *silent* | **Deliberate.** This grid is the ride figure and the foot under it. Jazz-waltz snare comping is improvised bar to bar; pinning one figure would state as canonical something no source states. |
| `openhat`, `clap`, `tom`, `crash`, `bell` | *silent* | **Deliberate.** Nothing sources them, and under replace semantics a silent row is what keeps the previous grid's voice from ringing through. |

Three sounding rows is not thin for this idiom — ride, hat foot and feathered kick **is** the jazz
waltz part. It is thin only against a rock grid, which is a different genre.

### `provenance` widens from "URL" to "source", and gains a stated scope

Part 1 defines `provenance` as *"a source URL, or the literal `'authored'`"*. Two things need
saying, and the second is the one that matters now that every grid carries rows the source did not
give:

1. **A citation is a source.** The bembé source is a paper, not a page: *Jerry Leake, "Perspectives
   on the Standard African Bell" (uvic.ca)*. It answers the question the field exists to answer, so
   the contract becomes **"a source, or `'authored'`"**. The allowlist test is unaffected — a
   citation is not the string `'authored'`.
2. **`provenance` names the source of the grid's identity — the rhythm it is named for — and the
   entry's comment says which rows that covers.** This is a clarification, not a special case: it
   was already true of every sourced grid in the library, because Attack Magazine's techno
   dissection sources a kick and a hat, not a `bass` row. Saying it out loud is what stops a reader
   inferring that a citation blesses all nine rows. Both new entries' comments name their sourced
   rows explicitly and mark the rest as arrangement.

**Files:**
- Modify: `src/data/drumGrids.ts` (two new entries; `afro-6-8` and `waltz` rows; the `provenance`
  doc comment); `src/data/drumGrids.test.ts` (source-citing tests); `src/data/vibes.ts` (two pool
  additions)

**Interfaces:**
- Changed: `DRUM_GRIDS` has **32** entries (30 after Part 1, plus two).
  `afro-6-8.rows` gains `bell`; `waltz.rows` gains `ride`.
  `VIBES.find(v => v.id === 'afro-six-eight').random.drumGrids` gains `'bembe-standard-bell'`;
  `'lofi-waltz'`'s gains `'jazz-waltz-ride'`.

- [ ] **Step 1: Write the failing tests**

`src/data/drumGrids.test.ts`. Every name cites its source, which is spec item 19's rule: *"the name
is the only place the reason for an expected value survives."*

```ts
const hits = (row?: boolean[]) => (row ?? []).flatMap((on, i) => (on ? [i] : []));

describe('the two twelve-step grids slice 2 unblocked', () => {
  test("bembe-standard-bell plays the seven-stroke standard bell 0,2,4,5,7,9,11 (Jerry Leake, Perspectives on the Standard African Bell)", () => {
    const g = DRUM_GRIDS['bembe-standard-bell'];
    expect(g.meter).toBe('6/8');
    expect(hits(g.rows.bell)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(hits(g.rows.snare)).toEqual([1, 4, 7, 10]);
    // Arrangement, not source: the library's own 6/8 pulse, and the hat the
    // bell rides over. Named here so a reader knows which rows the citation
    // in `provenance` actually covers.
    expect(hits(g.rows.kick)).toEqual([0, 6]);
    expect(hits(g.rows.hihat)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  test("jazz-waltz-ride plays the ride figure 0,4,6,8 over the hi-hat foot (studydrums.com)", () => {
    const g = DRUM_GRIDS['jazz-waltz-ride'];
    expect(g.meter).toBe('3/4');
    expect(hits(g.rows.ride)).toEqual([0, 4, 6, 8]);
    // The foot on beats 2 and 3, and a feathered downbeat — arrangement.
    expect(hits(g.rows.hihat)).toEqual([4, 8]);
    expect(hits(g.rows.kick)).toEqual([0]);
  });

  test('every grid states all nine playable rows, because replaceDrumPattern writes all nine', () => {
    // An absent row and an empty row do the same thing now, so omitting a row
    // is authoring a silence. These two grids say so explicitly rather than by
    // omission — which is also what makes their deliberate silences reviewable.
    const PLAYABLE = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash', 'ride', 'bell'];
    for (const id of ['bembe-standard-bell', 'jazz-waltz-ride']) {
      expect(Object.keys(DRUM_GRIDS[id].rows).sort()).toEqual([...PLAYABLE].sort());
    }
  });

  test('the deliberate silences are silent, and are the ones the entry comments name', () => {
    expect(
      Object.entries(DRUM_GRIDS['bembe-standard-bell'].rows)
        .filter(([, row]) => hits(row).length === 0)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['clap', 'crash', 'openhat', 'ride', 'tom']);
    expect(
      Object.entries(DRUM_GRIDS['jazz-waltz-ride'].rows)
        .filter(([, row]) => hits(row).length === 0)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['bell', 'clap', 'crash', 'openhat', 'snare', 'tom']);
  });

  test('both grids are twelve steps wide, like every other 3/4 and 6/8 entry', () => {
    for (const id of ['bembe-standard-bell', 'jazz-waltz-ride']) {
      for (const row of Object.values(DRUM_GRIDS[id].rows)) {
        expect(row.length).toBe(12);
      }
    }
  });
});

describe('the two rows Part 1 parked on hihat move to their real rows', () => {
  test("afro-6-8's bell rhythm is on `bell`, and `hihat` carries the eighth pulse under it", () => {
    const g = DRUM_GRIDS['afro-6-8'];
    expect(hits(g.rows.bell)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    // Not empty. Under replaceDrumPattern an absent row and an empty row both
    // clear the track, so a blank hat here is a SILENT hat — and the survey
    // says the bell and the hi-hat sound simultaneously, which is the whole
    // reason `bell` exists.
    expect(hits(g.rows.hihat)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  test("waltz's ride figure is on `ride`, with the hi-hat foot on beats 2 and 3 (studydrums.com)", () => {
    const g = DRUM_GRIDS['waltz'];
    expect(hits(g.rows.ride)).toEqual([0, 4, 6, 8]);
    // Twelve steps in 3/4 puts the beats on 0, 4 and 8.
    expect(hits(g.rows.hihat)).toEqual([4, 8]);
  });

  test('no grid smuggles a bell or ride rhythm onto hihat any more', () => {
    const BELL = JSON.stringify([0, 2, 4, 5, 7, 9, 11]);
    const RIDE = JSON.stringify([0, 4, 6, 8]);
    for (const [id, g] of Object.entries(DRUM_GRIDS)) {
      const h = JSON.stringify(hits(g.rows.hihat));
      expect(h, `${id} still plays a bell or ride figure on hihat`).not.toBe(BELL);
      expect(h, `${id} still plays a bell or ride figure on hihat`).not.toBe(RIDE);
    }
  });
});

describe('the two new grids are reachable from a vibe', () => {
  test('afro-six-eight can roll the bembé bell and lofi-waltz the jazz ride', () => {
    const bySlug = (id: string) => VIBES.find((v) => v.id === id)!;
    expect(bySlug('afro-six-eight').random!.drumGrids).toContain('bembe-standard-bell');
    expect(bySlug('lofi-waltz').random!.drumGrids).toContain('jazz-waltz-ride');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/data/drumGrids.test.ts`
Expected: FAIL — `DRUM_GRIDS['bembe-standard-bell']` is `undefined`, and `afro-6-8.rows.bell` is
`undefined` while its `hihat` still holds the bell figure.

- [ ] **Step 3: Author the two grids**

`src/data/drumGrids.ts`, alongside the other twelve-step entries:

```ts
  /**
   * The standard African bell, in the seven-stroke bembé form, with the
   * cross-stick under it.
   *
   * PROVENANCE COVERS `bell` AND `snare`. Everything else is arrangement:
   * `kick` is the library's own 6/8 pulse (byte-identical to afro-6-8's) and
   * `hihat` is the eighth pulse the bell rides over — the survey's point about
   * this idiom is that the bell and the hi-hat sound at the SAME TIME, which is
   * what needed two rows.
   *
   * The five silences are decisions, not omissions — replaceDrumPattern writes
   * all nine rows, so an absent row and an empty row are the same thing:
   *   openhat  the bell already owns the high metallic register, 7 steps of 12
   *   clap     doubling the cross-stick is the clap===snare duplication the
   *            survey found in 16 of 22 grids; not repeating it here
   *   tom      no source; an invented fill is authoring past the source
   *   crash    silent ON PURPOSE — this is the row that stops the previous
   *            grid's crash ringing on
   *   ride     one sustaining metal voice, not two; the bell is it
   */
  'bembe-standard-bell': {
    name: 'Bembé Standard Bell',
    meter: '6/8',
    kit: 'Acoustic Studio',
    provenance: 'Jerry Leake, "Perspectives on the Standard African Bell" (uvic.ca)',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, false, false, false, false],
      snare:   [false, true, false, false, true, false, false, true, false, false, true, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false],
      ride:    [false, false, false, false, false, false, false, false, false, false, false, false],
      bell:    [true, false, true, false, true, true, false, true, false, true, false, true],
    },
  },

  /**
   * The jazz waltz: the ride figure — beat 1, beat 2, the middle of beat 2,
   * beat 3 — over the hi-hat foot on beats 2 and 3.
   *
   * PROVENANCE COVERS `ride`. `hihat` and `kick` are arrangement from the same
   * idiom: the foot on 2 and 3, and a feathered downbeat (kick [0], the figure
   * waltz and waltz-brush-three already hold).
   *
   * `snare` is silent DELIBERATELY, and it is the interesting one: jazz-waltz
   * comping is improvised bar to bar, so pinning one backbeat would state as
   * canonical something no source states. The other five silences are the
   * ordinary kind — nothing sources them, and a silent row is what keeps the
   * previous grid's voice from ringing through.
   *
   * Three sounding rows is not thin for this idiom. Ride, foot and feathered
   * kick IS the jazz waltz part; it is thin only against a rock grid.
   */
  'jazz-waltz-ride': {
    name: 'Jazz Waltz Ride',
    meter: '3/4',
    kit: 'Acoustic Studio',
    provenance: 'https://studydrums.com/hsid/jzwalz01.html',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false],
      hihat:   [false, false, false, false, true, false, false, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false],
      crash:   [false, false, false, false, false, false, false, false, false, false, false, false],
      ride:    [true, false, false, false, true, false, true, false, true, false, false, false],
      bell:    [false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
```

- [ ] **Step 4: Move the two smuggled rows home**

`afro-6-8` — `hihat` returns to the eighth pulse it held before Part 1 borrowed it, and the bell
figure lands on `bell`:

```ts
  'afro-6-8': {
    name: 'Afro 6/8',
    meter: '6/8',
    kit: 'Warm Riddim',
    provenance: 'Jerry Leake, "Perspectives on the Standard African Bell" (uvic.ca)',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, false, false, false, false],
      snare:   [false, true, false, false, true, false, false, true, false, false, true, false],
      // The eighth pulse this row held before slice 1 parked the bell on it.
      // Restored, not invented: the survey's point is that the bell and the
      // hi-hat sound AT THE SAME TIME, which needed two rows to say.
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, true, false, false, false],
      clap:    [false, false, false, false, true, false, false, false, false, false, true, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, true],
      bell:    [true, false, true, false, true, true, false, true, false, true, false, true],
      bass:    [true, false, false, false, false, false, true, false, false, false, true, false],
    },
  },
```

`waltz` — the ride figure lands on `ride`, and `hihat` becomes the foot on beats 2 and 3:

```ts
  waltz: {
    name: 'Waltz',
    meter: '3/4',
    kit: 'Acoustic Studio',
    provenance: 'https://studydrums.com/hsid/jzwalz01.html',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, true, false, false, false],
      // The hi-hat FOOT, on beats 2 and 3 (steps 4 and 8 at twelve steps in
      // 3/4) — the part that plays under the ride, from the same source.
      hihat:   [false, false, false, false, true, false, false, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, true, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, true],
      ride:    [true, false, false, false, true, false, true, false, true, false, false, false],
      bass:    [true, false, false, false, false, false, false, false, true, false, false, false],
    },
  },
```

(`afro-6-8`'s `snare` is Part 1's cross-stick correction `1,4,7,10`, reproduced here so the entry
reads whole — do not treat it as a change.)

Then widen the `provenance` doc comment on the `DrumGrid` interface:

```ts
  /**
   * Where this rhythm came from: a source — a URL, or a bibliographic citation
   * where the source is a paper rather than a page — or the literal
   * 'authored'.
   *
   * A citation counts because the field exists to answer "where did this come
   * from?", and "Jerry Leake, Perspectives on the Standard African Bell"
   * answers it. What does NOT count is a tangentially related link attached to
   * make an invented grid look sourced; that is the failure mode 'authored'
   * and its allowlist exist to prevent.
   *
   * SCOPE: it names the source of the rhythm the grid is NAMED for, not of all
   * nine of its rows. Every grid states the whole kit, and no source gives a
   * whole kit — Attack Magazine's techno dissection gives a kick and a hat.
   * Each entry's comment says which rows its citation covers and marks the
   * rest as arrangement.
   */
  provenance: string;
```

- [ ] **Step 5: Add the two pool members**

`src/data/vibes.ts`. Both are **same-meter** — 6/8 into the 6/8 vibe, 3/4 into the 3/4 vibe — so
neither exercises the cross-meter permission spec item 9 grants. That permission stays available and
unused here, which is what *"pools are authored same-meter by default"* means.

In `afro-six-eight`'s `random`:

```ts
      // A roll onto bembe-standard-bell swaps the WHOLE kit, as every grid
      // does now — the bell and cross-stick arrive and the vibe's openhat,
      // clap, tom and crash go quiet, which is what its five silences say.
      // Same meter, so no trim-or-loop is involved.
      drumGrids: [/* … Part 1's ids, verbatim … */, 'bembe-standard-bell'],
```

In `lofi-waltz`'s `random`:

```ts
      drumGrids: [/* … Part 1's ids, verbatim … */, 'jazz-waltz-ride'],
```

**Add, never reorder or remove.** Part 1 authored those arrays and the invariant that a pool
contains the vibe's own `drumGridId` is satisfied by ids already in them.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/data/drumGrids.test.ts src/store/vibeVariation.test.ts src/store/instantVibesDrums.test.ts`
Expected: PASS. Three things to look at specifically:

- **The silent-duplicate sweep must still see `SILENT_DUPLICATES === []`.** `afro-6-8` and
  `afro-six-eight-bell` share `hihat` again after Step 4, and differ on `snare` and on `afro-6-8`'s
  new `bell` row. If the sweep flags them, the fix is *not* to re-empty the hihat — report it, and
  re-read `afro-six-eight-bell`'s snare against Part 1's diff report.
- **`instantVibesDrumsFixture` must be byte-identical.** The two vibes' authored grids are
  `afro-six-eight-bell` and `waltz-brush-three`, neither of which this task touches; adding a pool
  member changes what the *dice* can reach, not what the vibe resolves to. A fixture failure here
  means a grid was edited that this task did not authorise.
- **The two pool invariants** — own id present, every id resolves — both hold, the second only
  because Step 3 ran first.

Verify the library size by evaluating:

Run: `bun -e "import {DRUM_GRIDS} from './src/data/drumGrids.ts'; const g=Object.values(DRUM_GRIDS); console.log(g.length, g.filter(x=>x.rows.bell).length, g.filter(x=>x.rows.ride).length)"`
Expected: `32 2 2`

Run: `bun run verify`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/data/drumGrids.ts src/data/drumGrids.test.ts src/data/vibes.ts
git commit -m "feat(data): author the bembé bell and jazz-waltz ride grids, and move two rows home

Slice 1 wrote the bembé bell onto afro-6-8's hihat and the jazz ride onto
waltz's, because the rhythm could be made correct before the timbre could.
Both now sit on the row they were written for.

Neither hihat row is left empty. Under replaceDrumPattern an absent row and an
empty row do the same thing, so a blank hat is a SILENT hat — and the survey's
point about both idioms is that the bell and the hi-hat sound at the same time.
A bembé bell over a silent hat is the same half-fix slice 1 shipped with the
halves swapped. afro-6-8's hihat returns to the eighth pulse it held before
slice 1 borrowed it; waltz's becomes the hi-hat foot on beats 2 and 3, from the
same studydrums source.

Both new grids state all nine playable rows, because a grid determines the whole
kit now and omitting a row is authoring a silence. Each entry's comment names
which rows the provenance covers and gives a reason for every silence — the
crash silences in particular are load-bearing, since they are what stop a
previous grid's cymbal ringing on. provenance's contract widens from 'a URL' to
'a source' (the bembé source is a paper) and gains a stated scope: it names the
source of the rhythm the grid is named for, not of all nine rows.

Both pool additions are same-meter; the cross-meter permission stays unused."
```

---

## Task 6: Docs sweep, fences first

**Named risk, from a previous branch: a stale symbol left inside a code fence while the prose above
it was updated.** Correction 3 above located the instance in advance —
`.claude/skills/dsp-audio/SKILL.md`'s signal-graph fence says the reverb send belongs to
*"snare/clap/crash only"*, which Task 1 falsified while the prose that a sweep naturally edits sits
a hundred lines below it. So the fences are checked **first**, not last.

**Files:**
- Modify: `.claude/skills/dsp-audio/SKILL.md`; `.claude/skills/music-theory/SKILL.md`;
  `.claude/skills/instant-vibes/SKILL.md`; `CLAUDE.md`; `docs/design.md`;
  `src/data/drumKits.ts` (head comment); `src/data/drumGrids.ts` (head comment)

- [ ] **Step 1: Check every fence in every target before editing any prose**

Run: `for f in .claude/skills/dsp-audio/SKILL.md .claude/skills/instant-vibes/SKILL.md .claude/skills/music-theory/SKILL.md docs/design.md CLAUDE.md; do echo "--- $f"; awk '/^```/{f=!f;next} f' $f | grep -n "crash\|ride\|bell\|hihat\|drum\|Key[BN]"; done`

Expected to surface at least the `dsp-audio` signal-graph line. Fix each hit, then move on.

The one known fix, in `.claude/skills/dsp-audio/SKILL.md`'s signal graph:

```
drums: osc/noise -> drumEnv -> drumBusFilter -> dryGain
                            \_ (snare/clap/crash/ride/bell only) send gain
                               (kit's reverbSend LEVEL) -> drumSendFilter -> reverbNode
```

- [ ] **Step 2: `.claude/skills/dsp-audio/SKILL.md` prose**

The "Drum kits" section:

```
`src/data/drumKits.ts`: `DrumKit` has 9 types — `kick, snare, hihat, openhat, clap, tom, crash,
ride, bell`. `mergeDrumKit` is in `src/audio/drumKits.ts`.
`DRUM_KITS` holds `Partial<DrumKit>` overrides merged onto `DEFAULT_DRUM_KIT` by `mergeDrumKit()`.
`triggerDrum(type, velocity, time?)` accepts two aliases: `closedhat`→hihat, `lowtom`→tom. There
used to be a third, `ride`→crash; the ride is a real voice now and the alias had to go with it,
because `DRUM_ALIASES` resolves BEFORE the switch and would have made `case 'ride'` unreachable.

**Ride and bell are not crash presets, and the difference is structural.** A crash is one
broadband noise burst at Q 0.8 — a wash. A ride is a NARROW burst (Q 4..8.5) under a square
partial that outlives it several times over; a bell is two square partials at an inharmonic ratio
(2.5..3.2×) and no noise at all. If either ever ends up sounding like the crash, the missing piece
is the tonal component, not the filter setting.

**Invariant, enforced by `bun run check:drums`** (`scripts/check-drum-kit-separation.ts`):
1. every kit must override **every** one of the 9 types (no type left equal to defaults);
2. listed params must spread far enough across kits (`max >= factor * min`), e.g. `kick.decay` 3×,
   `snare.noiseFilter` 2.8×, `hihat.filter` 2.5×, `ride.pingDecay` 3×, `bell.freq` 2×.

Each of ride and bell gets TWO spread checks, one for brightness/pitch and one for sustain: a
filter-only check would pass twelve rides that are one cymbal at twelve EQ settings.

Adding or editing a kit means running `bun run check:drums`. `bun run verify` includes it. **It
proves the parameters differ; it does not prove anything sounds right.**
```

- [ ] **Step 3: `.claude/skills/music-theory/SKILL.md`** — the file correction 2 explains

Four edits in the "Drum pad map" and "check:keys" sections:

```
`DEFAULT_PADS` in `src/components/ui/DrumPadGrid.tsx` is the source of truth for the drum half of
the key map — 10 pads, two rows of five at `sm`, no pages, no General MIDI:

| Pad | `kick` | `snare` | `hihat` | `openhat` | `clap` |
|---|---|---|---|---|---|
| code | `KeyZ` | `KeyX` | `KeyC` | `KeyV` | `KeyM` |

| Pad | `lowtom` | `hightom` | `crash` | `ride` | `bell` |
|---|---|---|---|---|---|
| code | `Comma` | `Period` | `Slash` | `KeyB` | `KeyN` |

`note` is a synthesis type (`kick`/`snare`/`hihat`/`openhat`/`clap`/`tom`/`crash`/`ride`/`bell`),
not a MIDI number; `lowtom` and `hightom` share `tom` and differ by `pitch` (0 vs 4). Pad volume
is component state.
```

and, in the "What breaks it" list:

```
- Extending `KEYBOARD_NOTES` downward/leftward into `Z X C V B N M , . /` → the whole bottom row
  belongs to the drums now. Only `Digit0`–`Digit9` are free of the chromatic table, the drum pads
  and the scale-locked rows (`KeyQ…BracketRight` / `KeyA…Quote`); `KeyB` and `KeyN` used to be
  free and went to the ride and bell pads.
```

The path fix at `:151` (`src/components/DrumPads.tsx` → `src/components/ui/DrumPadGrid.tsx`) was
already stale before this branch. Fix it anyway — it is the exact class of defect this step exists
to catch.

- [ ] **Step 4: `.claude/skills/instant-vibes/SKILL.md`**

Two edits, both content:

- The per-vibe pool listing gains `bembe-standard-bell` under `afro-six-eight` and
  `jazz-waltz-ride` under `lofi-waltz`, noted as **same-meter** additions.
- `:206`'s *"every vibe's seven drum rows"* — verify before touching. The fixture pins each vibe's
  **resolved** grid, and the eight vibes' authored grids (`afro-six-eight-bell`,
  `waltz-brush-three` and the rest) gained no row in this plan, so seven is still correct. **Leave
  it.** Changing a correct number to match a different number elsewhere in the doc is how a doc
  starts lying.

- [ ] **Step 5: `CLAUDE.md` and `docs/design.md`**

`CLAUDE.md:84` — the sentence about unplayable cells. After Part 1 `tom` and `crash` play; after
this plan the voice list is nine and only `bass` is left:

```
also why `bass` cells are authored intent that nothing plays — and permanently
so: `DRUM_KITS` defines nine drum voices (kick, snare, hihat, openhat, clap,
tom, crash, ride, bell) and bass is not one of them.
```

`docs/design.md:150` — the `DrumPads.tsx` entry: *"Velocity-sensitive drum pad grid with computer-key
shortcuts. Exports `DEFAULT_PADS`"* → **ten** pads, and the codes are one contiguous run on the
bottom keyboard row.

- [ ] **Step 6: The two `src/data/` head comments**

`src/data/drumKits.ts` — the head comment says 12 kits and cites `check:drums`. Add the voice count
and the one thing the check cannot do:

```
 * The drum-kit library: 12 kits, each a `Partial<DrumKit>` laid over
 * DEFAULT_DRUM_KIT by `mergeDrumKit` in audio/drumKits.ts. A kit is 9 voices:
 * kick, snare, hihat, openhat, clap, tom, crash, ride, bell.
 *
 * Kit NAMES are the persisted key (`loop.soundKit`), so renaming one is a
 * project-file change, not a cosmetic edit. `check:drums` asserts that the 12
 * stay audibly distinct — a kit that merely differs on paper is not a kit. It
 * asserts that the PARAMETERS differ; it cannot tell you a ride sounds like a
 * ride, which is what the listening pass is for.
```

`src/data/drumGrids.ts` — the `NOTE — rows that no sequencer track can play` block. Only `bass`
survives it, and the "every grid is the whole kit" rule deserves a line next to it:

```
 * NOTE — the one row no sequencer track can play. `INITIAL_SEQUENCER_TRACKS`
 * has nine tracks (kick, snare, hihat, openhat, clap, tom, crash, ride, bell),
 * so every row below is audible except `bass` — and that one stays unplayable
 * permanently: `bass` is not a drum voice, and `DRUM_KITS` has no params for
 * it.
 *
 * NOTE — every entry is the WHOLE kit. `replaceDrumPattern` writes all nine
 * playable rows on every apply, clearing the window of any track the grid does
 * not name, so an absent row and an empty row are the same thing: a silence.
 * An entry therefore has no way to abstain — leaving a row out IS authoring a
 * silence, and a silence is often the load-bearing part (a grid with no crash
 * is what stops the previous grid's crash ringing on). Author all nine, and
 * say in the entry's comment why each silent one is silent.
 *
 * NOTE — `provenance` names the source of the rhythm the grid is NAMED for,
 * not of all nine of its rows. Attack Magazine's techno dissection sources a
 * kick and a hat; the rest of that entry is arrangement, and always was. Each
 * entry's comment says which rows its citation covers.
```

- [ ] **Step 7: Verify no stale symbol survives**

Run: `grep -rn "7 types\|seven drum\|8 pads\|10 pads\|ride.*crash\|closedhat.*lowtom.*ride" CLAUDE.md docs/design.md .claude/skills/ src/data/drumKits.ts src/data/drumGrids.ts`

Read every hit. The only acceptable survivors are sentences that describe the *history*
(`"there used to be a third, ride→crash"`) — a present-tense claim of seven types or eight pads
anywhere is a miss.

Run: `bun run verify`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md docs/design.md .claude/skills/dsp-audio/SKILL.md .claude/skills/music-theory/SKILL.md .claude/skills/instant-vibes/SKILL.md src/data/drumKits.ts src/data/drumGrids.ts
git commit -m "docs: record the ride and bell voices across the skills and head comments

Fences were swept before prose, because the named failure mode from a previous
branch is a stale symbol surviving inside a fence while the paragraph above it
gets updated — and dsp-audio's signal graph had exactly that: a reverb send
labelled 'snare/clap/crash only'.

music-theory/SKILL.md joins the sweep although the brief did not list it: it
held the sentence saying KeyB and KeyN were free, which this branch falsifies,
plus a pad-table and a DEFAULT_PADS path that were already stale.

instant-vibes' 'seven drum rows' claim is left alone. It is still true — no
vibe's authored grid gained a row — and editing a correct number to match a
different number elsewhere is how a doc starts lying."
```

---

## Listening checklist

**A human gate, not a task, and not something `bun run verify` can stand in for.** Spec item 17 is
blunt about why: the suite can tell you *what* changed and that nothing changed by accident; it can
never tell you the result is right. `bun run check:drums` proves the twelve kits' ride and bell
**parameters spread far enough apart to be different sounds**. It does not prove that any of them
sounds like a ride, sounds like a bell, or sounds good. Nothing in this plan proves that. Ears do.

Work through it on a real page, with the audio context started by a click.

1. **All twelve kits, both new pads.** Set the kit in the Drum Sound row, then press `KeyB` and
   `KeyN`. For each kit, three questions: is the ride distinguishable from **that same kit's**
   crash (`Slash`)? Is it distinguishable from its hihat (`KeyC`)? Is the bell recognisably a
   pitched struck tone rather than a synth note? A ride that reads as a short crash means the
   tonal ping is too quiet or too short in that kit.
2. **The pad grid at both widths.** Ten pads, two rows of five above `sm` and two rows of four plus
   a pair below it. Confirm no two adjacent pads share a colour ramp and that the two new keycaps
   read correctly.
3. **The two new grids, from the sequencer's grid menu.** Load something dense first — `funky-drummer`
   or `techno-rolling` — then `bembe-standard-bell`. The whole kit should change: bell, cross-stick,
   6/8 kick and eighth-note hat arrive, and **openhat, clap, tom, crash and ride go quiet**. The
   silences are the half worth listening for; they are authored, and a leftover crash means one of
   them did not get written. Then `jazz-waltz-ride`, and check the same for its six.
4. **A grid's silences hold across a swap.** Load `bembe-standard-bell`, then `house`. The bell
   stops, because `house` names no bell and `replaceDrumPattern` clears every track a grid does not
   name. Then reload `bembe-standard-bell` and confirm the bell comes back intact — clearing goes
   through `writeStepWindow`, so only the active window moves and the padding past `stepsPerBar`
   is untouched.
5. **`waltz` and `afro-6-8`, the two grids whose rows moved.** Load each and listen for the pair
   sounding *together*: bell over the eighth pulse in `afro-6-8`, ride over the hi-hat foot in
   `waltz`. Hearing only one of the two means a row did not move, or moved and left the other
   empty — the exact failure Task 5 Step 4 is written to prevent.
6. **The two vibe chips whose pools grew.** Press `afro-six-eight` and `lofi-waltz` and confirm each
   still sounds like itself — the chip applies the vibe's own grid, which this plan did not touch,
   so any change here is a defect. Then roll the dice on each until the new pool member comes up,
   and confirm the bell or ride figure arrives on the row it belongs to.
7. **A reopened session and a reopened project.** Reload the page: the ride and bell tracks are
   present, empty, silent, and everything else sounds exactly as it did. Then open a `.solna` file
   saved before this branch: same answer. A project written before the layer existed must reopen
   sounding the way it sounded when it was closed.

---

## Self-review, run before the final commit

**Every Slice 2 requirement, and the task that implements it:**

| spec | requirement | task |
|---|---|---|
| 13 | `DrumKit` gains `ride: RideParams` and `bell: BellParams` | 1, Step 3 |
| 13 | `DEFAULT_DRUM_KIT` gains both | 1, Step 3 |
| 13 | All 12 kits gain both — 24 hand-tuned param objects | 2, Step 2 |
| 13 | Two `triggerDrum` cases; neither is the crash's wash | 1, Step 6 |
| 13 | Two `DEFAULT_PADS` entries that pass `check:keys` | 3, Steps 2–3 |
| 13 | Two more sequencer tracks, subject to the eight-token trap | 4, Steps 4 and its colour rationale |
| 13 | A second migration round on both chains, reusing `withDrumTracks` | 4, Steps 5–6 |
| 14 | `bembe-standard-bell` and `jazz-waltz-ride` authored | 5, Step 3 |
| 14 | `afro-6-8`'s bell and `waltz`'s ride move off `hihat` | 5, Step 4 |
| 15 | Both voices ship in one slice, one tuning pass | 2's whole rationale |
| 16 | `clap` is not reclaimed | Global Constraints, out of scope |
| 11 | Nine tracks against eight tokens | 4, decided: ride shares `bg-info` with crash |
| open q 3 | Two free shortcut codes | 3: `KeyB`, `KeyN`, verified by evaluation in Step 1 |
| open q 4 | Nine tracks, eight tokens | 4 |
| open q 6 | The exact `RideParams` / `BellParams` fields | 1, Step 3 |
| 24 | Explicit listening tasks | Listening checklist |

**Placeholder scan.** Three code blocks in this plan deliberately elide, and each names exactly
what it elides and where to read it: Task 2 Step 2's `// … kick through crash unchanged …`, Task 5
Step 5's `/* … Part 1's ids, verbatim … */`, and Task 4 Steps 5–6's references to Part 1's
`migrateDrumTracks` / `upgradeDrumTracksV5` by shape rather than by asserted name (Task 4 Step 1
resolves them by grep before either is written). **No step says "similar to Task N"**, and every
other block is complete code.

**Name agreement across tasks.** Each of these is defined once and used later exactly as defined:

- `RideParams`, `BellParams` — declared in Task 1 Step 3; the field names used by Task 1 Step 6's
  engine cases (`strikeFilter`, `strikeQ`, `strikeDecay`, `strikeGain`, `pingFreq`, `pingDecay`,
  `pingGain`, `reverbSend`; `freq`, `partialRatio`, `decay`, `partialDecay`, `gain`, `partialGain`,
  `reverbSend`), by Task 1 Step 1's tests, by all 24 objects in Task 2 Step 2, and by Task 2 Step
  3's four spread accessors are the same names and no others.
- `withDrumTracks` — Part 1's, called unchanged from both new upgrade functions in Task 4. Its
  canonical list is *extended*, never rewritten, and Task 4 Step 1 establishes where.
- `'ride'` / `'bell'` as instrument strings — the `note` on a pad (Task 3), the `instrument` on a
  track (Task 4), the row key in a grid (Task 5) and the `case` label (Task 1) are the same two
  lowercase strings, which is what makes `replaceDrumPattern`'s lookup connect them.
- Version numbers — persist `13 → 14` and `PROJECT_FORMAT_VERSION 5 → 6` appear in Task 4 only,
  and Task 4 Step 7 re-reads the second by evaluating rather than by trusting the diff.

**One brief-level defect reported rather than silently absorbed:** the migration "top level and
inside every `loops[]` entry" requirement is not implementable as written, because neither payload
carries a top-level `sequencerTracks` — measured against `partializeAppState` and
`PROJECT_CONTENT_KEYS`. Correction 1 states it; Task 4 implements the loops-only form and keeps the
two tests separate, which is what the requirement was actually protecting.

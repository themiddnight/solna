# Vibe Synth From Preset References — Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Instant Vibe's three synth voices stop being inline `Partial<SynthParams>` override objects and become `synthPresetId` / `chordPresetId` / `bassPresetId` references resolved through the real preset library — 16 of the 18 role slots filled from the existing 27 presets, 2 new presets (`factory-neon-poly-saw`, `factory-koto-pluck`) authored for the two genuine gaps, and arp data removed from `InstantVibe` entirely so no vibe switches the arpeggiator on behind the user's back.

**Architecture:** `src/audio/synthPresets.ts` gains a by-id accessor `presetById(id)` over `ALL_FACTORY_PRESETS` and two new preset entries. `src/types.ts` gains three `InstantVibe` fields (`synthPresetId`, `chordPresetId`, `bassPresetId`) replacing three `*PresetName` fields and three `*SynthParams` fields — and gains no arp field. `src/store/instantVibes.ts` replaces `buildSynthParams(presetName, overrides)` with `resolveVibeSynthParams(presetId)`, which merges `INITIAL_SYNTH_PARAMS` → the resolved preset's `params` → `preset: presetItem.name`. Because `INITIAL_SYNTH_PARAMS.arpActive` is already `false` (`src/store/initialState.ts:26`) and no preset sets an arp field, every voice of every vibe loads with the arp off with no explicit `arpActive: false` written anywhere. The three call sites stay exactly where they are inside `applyInstantVibeToStore`, so its ordered audio cut and selective restart are untouched. No engine call, no new apply path, no persist migration.

**Tech Stack:** Bun (test runner + scripts), Vite, React 18, Zustand (`subscribeWithSelector` + `persist`), raw Web Audio API, `tonal` for note/interval/chord math, Tailwind v4 + daisyUI v5 CSS-first.

**Spec:** `docs/superpowers/specs/2026-08-26-vibe-as-references-design.md` — Phase 2 of 4 ("Synth -> preset references"), plus its appended section "Phase 2 settled — the preset matrix, the arp removal, and the resolved `InstantVibe` shape", which is the authority for every preset id below and for the decision to remove arp from vibes. Phases 3-4 (drum patterns, effect chains) are out of scope.

## Global Constraints

- **Layering (eslint `no-restricted-imports`, `eslint.config.js`):** `src/audio/**` must not import `**/store/**` or `**/components/**`; `src/store/**` must not import `**/components/**`; `src/components/**` must not import `**/audio/engine` (exempt: `src/components/AudioVisualizer.tsx`, `src/components/TransportBar.tsx`, `**/*.test.ts`, `**/*.test.tsx`). **`src/store/` importing `src/audio/` IS allowed** and already used — `src/store/instantVibes.ts` imports `audioEngine` from `../audio/engine` and `progressionById`/`resolveProgression` from `../audio/data/chordProgressions`. This plan adds one more such import: `presetById` from `../audio/synthPresets`.
- **`applyInstantVibeToStore` must NOT be modified.** It performs `store.hardStopAll()` then a synchronous `audioEngine.stopSource('chord', 0.02)` / `audioEngine.stopSource('bass', 0.02)` cut **before the first vibe-state write**, then restarts only the players that were active. Two real bug fixes live in that ordering (`d8df714`, `c4a253a`). Resolution happens **at the `buildSynthParams` call sites** (`src/store/instantVibes.ts:75`, `:83`, `:87`) — the call sites keep their position in the function body; only the function they call and its arguments change. Do not move a call site, do not add a call site, do not introduce a second apply path.
- **`src/types.ts` stays a zero-import leaf.** It has no `import` statement today and must not gain one. This plan adds only `string` fields to `InstantVibe`, so no import is needed.
- **Tests are pure-logic `bun:test`** — no DOM, no testing-library, and none may be added. Components export testable helpers; test files import those rather than rendering React.
- **Gate:** `bun run verify` (= test + lint + check:keys + check:drums + build). `bun run eslint` is **not** part of `verify` and must be run **separately**, explicitly, whenever imports move — Task 4 moves one.
- **Preset ids and Instant Vibe ids are never renamed.** No existing preset id changes. The four id/label drift pairs are deliberate and protected: `cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden".
- **No genre tags on presets, ever.** `SynthPresetItem.category` is a timbre role from the closed union `'Bass' | 'Lead' | 'Pad' | 'Keys' | 'Pluck' | 'Brass' | 'FX' | 'User'`. Neither new preset gains a genre field, and no invariant in this plan is written over genre.
- **`bassPresetId` must resolve to `category === 'Bass'`** — a hard constraint, because bass is a physical register. Lead and comp slots may draw from Lead, Pad, Keys, Pluck, Brass or FX.
- **No arp data anywhere in this feature.** No entry in `FACTORY_PRESETS` or `FACTORY_BASS_PRESETS` may set `arpActive`, `arpMode`, `arpRate` or `arpOctaves` — today zero of the 27 do, and Task 1 pins that. `InstantVibe` gains no arp field either: arp is a performance setting the user drives from the UI (`src/audio/playback/arpPlayback.ts` reads `params.arpActive` off whichever voice `controlTarget` selects and arpeggiates notes the user physically holds), and a vibe must not switch it on behind their back. `INITIAL_SYNTH_PARAMS.arpActive` is already `false` (`src/store/initialState.ts:26`), so a vibe that sets no arp fields leaves the arp off — never write an explicit `arpActive: false` into the vibe table.
- **`synthwave-80s`, `cyber-dance` and `asian-zen` lose the arpeggio they turn on today.** That is intended and sanctioned. Two pieces of authored copy assert the old behaviour and must be corrected with it (Task 5, Steps 6 and 7); the `variation.keyPool` **data** those copy edits sit next to must not be touched — `variation` is out of scope for this phase.
- **The sound is allowed to change**, provided the preset data is research-backed (spec settled decision 2). This plan carries **no** equivalence proof and must not acquire one — a byte-for-byte-same-sound assertion would be a category error here, unlike Phase 1.
- The app has no users, so persisted shapes and the store's `persist` version (currently 3, `src/store/store.ts:274`) are not compatibility constraints. **No migration and no version bump.**

## The resolved 6 × 3 matrix

Copied from the spec's Phase 2 section. Task 5 writes exactly these ids and no others.

| vibe | `synthPresetId` (lead) | `chordPresetId` (comp) | `bassPresetId` |
| --- | --- | --- | --- |
| `lofi-chill` | `factory-dream-keys` | `factory-mellow-epiano` | `bass-deep-sine` |
| `synthwave-80s` | `factory-hyper-saw-lead` | `factory-neon-poly-saw` (new, Task 2) | `bass-saw-growl` |
| `cyber-dance` | `factory-pluck` | `factory-trance-pluck` | `bass-punchy-square` |
| `ambient-chill` | `factory-celestial-shimmer` | `factory-warm-polypad` | `bass-deep-sine` |
| `hiphop-groove` | `factory-mellow-epiano` | `factory-fm-tine-piano` | `bass-round-pluck` |
| `asian-zen` | `factory-glocken-bell` | `factory-koto-pluck` (new, Task 3) | `bass-warm-tri` |

No vibe carries arp. Today `synthwave-80s` (`updown`/`16n`/2), `cyber-dance`
(`up`/`16n`/2) and `asian-zen` (`up`/`8n`/2) set it on their **lead** voice
(`synthParams`); Task 5 drops all three, and Task 6 deletes the fields that held them.

## Existing invariant suites this plan breaks, and exactly how each is fixed

Read this before starting. Nothing here is left to the implementer's judgement.

1. **`src/store/instantVibes.test.ts`, test `'contains all 6 curated genre vibes with complete presets and feel settings'`** (lines ~36, ~45, ~47) asserts `Boolean(vibe.chordPresetName)`, `Boolean(vibe.bassPresetName)`, `Boolean(vibe.synthPresetName)`. **Fixed in Task 5, Step 1:** the three assertions become `Boolean(vibe.chordPresetId)` / `Boolean(vibe.bassPresetId)` / `Boolean(vibe.synthPresetId)`.
2. **`src/store/instantVibes.test.ts`, test `'applyInstantVibeToStore sets drum pattern, kit, chords, bass, feel, synth presets, and master effects'`** (lines ~64-68) asserts `state.chordSynthParams.preset === lofiVibe.chordPresetName` and the same for bass and synth. After rewiring, `lofi-chill`'s comp resolves to `factory-mellow-epiano` whose `name` is `'Mellow E-Piano'`, not the old label `'Dream Keys'` — so these fail. **Fixed in Task 5, Step 1:** each becomes `expect(state.chordSynthParams.preset).toBe(presetById(lofiVibe.chordPresetId)!.name)`, with `presetById` imported into the test file.
3. **`src/store/instantVibes.test.ts`, `describe('vibe preset name resolution')`** — all three tests are name-keyed (`factoryNames.has(vibe.synthPresetName)` etc.). **Fixed in Task 5, Step 1:** the whole describe block is replaced with the id-keyed version given verbatim there, including the `bassPresetId → category === 'Bass'` check.
4. **`src/store/instantVibes.test.ts`, test `'applies synthwave vibe with tight feel and active arpeggiator'`** (line ~83) asserts `state.synthParams.arpActive === true` and `state.synthParams.arpMode === 'updown'`. Arp removal makes both false. **Fixed in Task 5, Step 1:** the test is renamed to `'applies synthwave vibe with tight feel and no arpeggiator'`, the two arp assertions are replaced by `expect(state.synthParams.arpActive).toBe(false)`, and the tight-feel assertions are kept exactly as they are. This is the one existing test whose *intent* this plan reverses, so it is rewritten rather than merely renamed around.
5. **`src/store/vibeVariation.test.ts`, test `'genre identity is copied verbatim under every draw'`** (lines ~353-355) asserts `out.synthParams`/`out.chordSynthParams`/`out.bassSynthParams` equal the source vibe's. Once those fields leave `InstantVibe`, `bun run lint` (`tsc --noEmit`) errors on the property access. **Fixed in Task 6, Step 2:** the three lines become three id assertions, given verbatim there. `src/store/vibeVariation.ts` itself needs no change — it copies with `...vibe` (line 178), so the new fields ride along automatically.
6. **`src/store/instantVibesProgressions.test.ts`** touches only `chords`, `progressionId`, `scaleRoot`, `scaleType`, `chordOctave`. **Unaffected — do not modify it.**
7. **`src/audio/synthPresets.test.ts`** pins no preset count and no `FACTORY_PRESETS.length`; its only positional assertions are `FACTORY_PRESETS[0]` and `FACTORY_BASS_PRESETS[0]`. Tasks 2 and 3 append to the end of `FACTORY_PRESETS`, so **it stays green** — it is only extended, never repaired.
8. **`src/store/store.test.ts`'s v1-migration arp tests** operate on persisted `synthParams` in the store, not on `InstantVibe`. **Unaffected.**
9. **`src/components/SimpleSynthPanel.test.tsx`** sets `arpActive: true` on a literal `SynthParams`, not on a vibe. The arpeggiator UI itself is untouched by this plan — the user can still switch it on by hand. **Unaffected.**
10. **`scripts/themeTokenGuard.ts`** — this plan touches no UI markup and no colour. `ALLOWLIST` stays empty. The two copy strings edited in Task 5 (a tagline and a code comment) contain no colour token. **Unaffected.**

## File structure

```
src/audio/synthPresets.ts        # +presetById(id); +factory-neon-poly-saw; +factory-koto-pluck
src/audio/synthPresets.test.ts   # +presetById tests; +library invariants (unique ids, no arp); +2 new-preset tests
src/types.ts                     # InstantVibe: +3 *PresetId, -3 *PresetName, -3 *SynthParams
src/store/instantVibes.ts        # buildSynthParams -> resolveVibeSynthParams; 6 vibes lose 18 override blocks, gain 18 ids; 2 copy corrections
src/store/vibeSynthPresets.test.ts  # NEW — resolveVibeSynthParams unit tests
src/store/instantVibes.test.ts   # name-keyed preset assertions become id-keyed; the arp test inverts
src/store/vibeVariation.test.ts  # verbatim-copy assertions follow the field rename
```

---

### Task 1: Add `presetById` and pin the preset-library invariants

The library has `findPresetByName` but no by-id accessor, and nothing today asserts that
preset ids are unique or that presets keep arp out of their params. Both invariants
become load-bearing the moment vibes resolve by id: a duplicate id makes `presetById`
silently return the wrong sound, and an arp field inside a preset would drag a
performance setting into every role that preset is reused for.

**Files:**
- Modify: `src/audio/synthPresets.ts:738-745` (append after `getAllSynthPresets`, before `findPresetByName`)
- Test: `src/audio/synthPresets.test.ts`

**Interfaces:**
- Consumes: `ALL_FACTORY_PRESETS: SynthPresetItem[]` and `SynthPresetItem` (both already exported from `src/audio/synthPresets.ts`).
- Produces: `export function presetById(id: string): SynthPresetItem | undefined` — consumed by Tasks 2, 3, 4 and 5.

- [ ] **Step 1: Write the failing tests**

In `src/audio/synthPresets.test.ts`, change the import block at lines 3-10 to also pull in `ALL_FACTORY_PRESETS` and `presetById`:

```ts
import {
  ALL_FACTORY_PRESETS,
  FACTORY_PRESETS,
  SYNTH_CATEGORIES,
  getAllSynthPresets,
  findPresetByName,
  getCategoryMeta,
  getPresetsGroupedByCategory,
  presetById,
} from './synthPresets';
```

Then append at the end of the file:

```ts
describe('presetById', () => {
  test('resolves a factory synth preset id to its entry', () => {
    expect(presetById('factory-mellow-epiano')?.name).toBe('Mellow E-Piano');
  });

  test('resolves a factory bass preset id to its entry', () => {
    expect(presetById('bass-deep-sine')?.category).toBe('Bass');
  });

  test('returns undefined for an id no preset carries', () => {
    expect(presetById('not-a-real-preset')).toBe(undefined);
  });

  test('returns undefined for an empty id', () => {
    expect(presetById('')).toBe(undefined);
  });
});

describe('preset library invariants', () => {
  test('every preset id in ALL_FACTORY_PRESETS is unique', () => {
    const ids = ALL_FACTORY_PRESETS.map((p) => p.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  test('no preset bakes arpeggiator settings into its params', () => {
    // Arp is a performance setting the user drives from the UI, not a timbre:
    // a preset carrying it would arpeggiate in every role it was reused for.
    const ARP_FIELDS = ['arpActive', 'arpMode', 'arpRate', 'arpOctaves'] as const;
    const offenders: string[] = [];
    for (const preset of ALL_FACTORY_PRESETS) {
      for (const field of ARP_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(preset.params, field)) {
          offenders.push(`${preset.id}.${field}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/audio/synthPresets.test.ts`
Expected: FAIL — `presetById is not a function` (the four `presetById` tests error). The two invariant tests already pass, which is intended: they are regression pins for data that is currently correct, not descriptions of a defect.

- [ ] **Step 3: Implement `presetById`**

In `src/audio/synthPresets.ts`, insert immediately after the `getAllSynthPresets` function (which ends at line 740) and before `findPresetByName`:

```ts
/**
 * Library reference resolution: id -> preset. Ids are stable and persisted in
 * project files; names are display strings and may be edited. Anything that
 * needs to survive a rename (Instant Vibes, saved projects) resolves by id.
 */
export function presetById(id: string): SynthPresetItem | undefined {
  if (!id) return undefined;
  return ALL_FACTORY_PRESETS.find((p) => p.id === id);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/audio/synthPresets.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/audio/synthPresets.ts src/audio/synthPresets.test.ts
git commit -m "feat(presets): add presetById and pin unique-id and no-arp library invariants"
```

---

### Task 2: Author `factory-neon-poly-saw` for the synthwave comp gap

`synthwave-80s`'s comp slot has no adequate candidate among the 27. `factory-string-ensemble`
has the right saw and detune but `attack: 0.35`, longer than the 0.254 s eighth note it
must articulate at 118 BPM. `factory-vintage-brass` is the right family but its
`lfoTarget: 'volume'` tremolo at 5 Hz beats against the vibe's grid-tight `chordFeel: 0.12`.
`factory-hyper-saw-lead` is this vibe's own lead and its 3800 Hz cutoff would sit on top of
it. `factory-warm-polypad` is triangle at cutoff 1400 — wrong oscillator, far too dark.
The new preset is a Juno-style detuned saw whose brightness arrives per note from the
filter envelope rather than a permanently open cutoff, with a release longer than the note
gap so consecutive stabs glue into a bed.

**Files:**
- Modify: `src/audio/synthPresets.ts:731` (append one entry before the closing `];` of `FACTORY_PRESETS`)
- Test: `src/audio/synthPresets.test.ts`

**Interfaces:**
- Consumes: `presetById(id)` from Task 1.
- Produces: `presetById('factory-neon-poly-saw')` resolving to a `category: 'Pad'` entry — consumed by Task 5 as `synthwave-80s`'s `chordPresetId`.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/synthPresets.test.ts`:

```ts
describe('factory-neon-poly-saw', () => {
  // 118 BPM (synthwave-80s) -> one eighth note is 60/118/2 ≈ 0.254 s.
  const EIGHTH_AT_118 = 60 / 118 / 2;

  test('is a Pad-category detuned saw', () => {
    const p = presetById('factory-neon-poly-saw');
    expect(p).toBeDefined();
    expect(p!.category).toBe('Pad');
    expect(p!.params.oscType).toBe('sawtooth');
    expect(p!.params.detune).toBe(15);
  });

  test('reaches full level well inside one eighth note at 118 BPM', () => {
    const p = presetById('factory-neon-poly-saw')!;
    expect(p.params.attack! < EIGHTH_AT_118).toBe(true);
  });

  test('releases longer than the note gap so consecutive stabs glue into a bed', () => {
    const p = presetById('factory-neon-poly-saw')!;
    expect(p.params.release! >= EIGHTH_AT_118).toBe(true);
  });

  test('gets its brightness from the filter envelope, not a permanently open cutoff', () => {
    const p = presetById('factory-neon-poly-saw')!;
    expect(p.params.filterCutoff).toBe(2600);
    expect(p.params.filterEnvAmount).toBe(1200);
    // must stay under factory-hyper-saw-lead, which is this vibe's own lead
    expect(p.params.filterCutoff! < presetById('factory-hyper-saw-lead')!.params.filterCutoff!).toBe(true);
  });

  test('does not transpose, so the comp stays in its authored register', () => {
    expect(presetById('factory-neon-poly-saw')!.params.octave).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/synthPresets.test.ts -t "factory-neon-poly-saw"`
Expected: FAIL — the first test fails on `expect(p).toBeDefined()` (received `undefined`), and the other four throw on the non-null assertion.

- [ ] **Step 3: Add the preset entry**

In `src/audio/synthPresets.ts`, append inside `FACTORY_PRESETS`, after the `factory-noise-riser-fx` entry and before the array's closing `];` at line 731:

```ts
  {
    id: 'factory-neon-poly-saw',
    name: 'Neon Poly Saw',
    category: 'Pad',
    isFactory: true,
    description: 'Juno-style detuned saw polysynth for 80s chord beds and 8th-note stabs',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.3,
      noiseVolume: 0.02,
      detune: 15,
      filterType: 'lowpass',
      filterCutoff: 2600,
      filterResonance: 2.4,
      filterEnvAmount: 1200,
      attack: 0.02,
      decay: 0.5,
      sustain: 0.65,
      release: 0.5,
      filterAttack: 0.02,
      filterDecay: 0.45,
      filterSustain: 0.35,
      filterRelease: 0.5,
      lfoRate: 0.9,
      lfoDepth: 0.12,
      lfoTarget: 'cutoff',
      octave: 0,
    },
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/synthPresets.test.ts`
Expected: PASS, all tests — including Task 1's unique-id and no-arp invariants, which now also cover the new entry.

- [ ] **Step 5: Commit**

```bash
git add src/audio/synthPresets.ts src/audio/synthPresets.test.ts
git commit -m "feat(presets): add Neon Poly Saw for the synthwave comp role"
```

---

### Task 3: Author `factory-koto-pluck` for the zen comp gap

`asian-zen`'s comp slot needs a mid-register plucked string that rings for roughly a bar
(~3.1 s at 78 BPM). Both existing Pluck presets die far too fast — `factory-pluck` has
`decay: 0.15` / `sustain: 0.05`, `factory-trance-pluck` `decay: 0.18` / `sustain: 0.02`.
`factory-glocken-bell` has the decay length but is a bell at `octave: +1`, and it is
already this vibe's lead. `factory-dream-keys` is a held key with no attack transient. The
new preset models the pick contact with a near-instant attack plus a small noise burst,
the fast damping of a plucked string's upper partials with a large filter envelope
collapsing to a low filter sustain, and the residual ring with a long amp decay and real
sustain.

**Files:**
- Modify: `src/audio/synthPresets.ts` (append one entry before the closing `];` of `FACTORY_PRESETS`, i.e. after Task 2's `factory-neon-poly-saw`)
- Test: `src/audio/synthPresets.test.ts`

**Interfaces:**
- Consumes: `presetById(id)` from Task 1.
- Produces: `presetById('factory-koto-pluck')` resolving to a `category: 'Pluck'` entry — consumed by Task 5 as `asian-zen`'s `chordPresetId`.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/synthPresets.test.ts`:

```ts
describe('factory-koto-pluck', () => {
  test('is a Pluck-category triangle string body', () => {
    const p = presetById('factory-koto-pluck');
    expect(p).toBeDefined();
    expect(p!.category).toBe('Pluck');
    expect(p!.params.oscType).toBe('triangle');
  });

  test('has a pick transient: near-instant attack plus a noise burst', () => {
    const p = presetById('factory-koto-pluck')!;
    expect(p.params.attack! <= 0.005).toBe(true);
    expect(p.params.noiseVolume! > 0).toBe(true);
  });

  test('damps its upper partials fast while the amp envelope keeps running', () => {
    const p = presetById('factory-koto-pluck')!;
    expect(p.params.filterEnvAmount).toBe(2200);
    expect(p.params.filterSustain! <= 0.15).toBe(true);
    expect(p.params.filterDecay! < p.params.decay!).toBe(true);
  });

  test('keeps the residual ring both existing Pluck presets lack', () => {
    const p = presetById('factory-koto-pluck')!;
    expect(p.params.sustain! > presetById('factory-pluck')!.params.sustain!).toBe(true);
    expect(p.params.sustain! > presetById('factory-trance-pluck')!.params.sustain!).toBe(true);
    // a bar at 78 BPM is 4 * 60/78 ≈ 3.08 s; decay + release must cover most of it
    expect(p.params.decay! + p.params.release! >= 2.4).toBe(true);
  });

  test('stays in the bass register rather than an octave above it', () => {
    expect(presetById('factory-koto-pluck')!.params.octave).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/synthPresets.test.ts -t "factory-koto-pluck"`
Expected: FAIL — the first test fails on `expect(p).toBeDefined()` (received `undefined`), and the other four throw on the non-null assertion.

- [ ] **Step 3: Add the preset entry**

In `src/audio/synthPresets.ts`, append inside `FACTORY_PRESETS`, immediately after the `factory-neon-poly-saw` entry and before the array's closing `];`:

```ts
  {
    id: 'factory-koto-pluck',
    name: 'Koto Pluck',
    category: 'Pluck',
    isFactory: true,
    description: 'Plucked silk-string tone with a bright pick transient and a long ringing decay',
    params: {
      oscType: 'triangle',
      subOscVolume: 0.15,
      noiseVolume: 0.04,
      detune: 6,
      filterType: 'lowpass',
      filterCutoff: 3200,
      filterResonance: 2.0,
      filterEnvAmount: 2200,
      attack: 0.004,
      decay: 1.3,
      sustain: 0.35,
      release: 1.5,
      filterAttack: 0.004,
      filterDecay: 0.5,
      filterSustain: 0.12,
      filterRelease: 1.5,
      lfoRate: 0.8,
      lfoDepth: 0.05,
      lfoTarget: 'pitch',
      octave: 0,
    },
  },
```

(The shallow 0.8 Hz pitch LFO at depth 0.05 models *oshide* — the left-hand press that
bends a note after it is struck. It is an order of magnitude under `factory-vocal-lead`'s
0.12 vibrato, so it reads as string instability rather than as vibrato.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/synthPresets.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/audio/synthPresets.ts src/audio/synthPresets.test.ts
git commit -m "feat(presets): add Koto Pluck for the zen comp role"
```

---

### Task 4: Add the `resolveVibeSynthParams` resolver

This is the replacement for `buildSynthParams`'s dead `presetName` parameter. Today
`buildSynthParams(presetName, overrides)` spreads `preset: presetName` in last purely for
the display field while the literal `overrides` object beside it supplies the entire
sound — it never looks the preset up. The resolver takes an **id**, looks it up, and lets
the preset supply the sound; the `preset` display field is then stamped from the resolved
entry's own `name`, so `ChordView.tsx`'s preset selects (which bind to `params.preset`)
point at the preset that actually produced what is playing.

The resolver takes no arp argument and writes no arp field. `INITIAL_SYNTH_PARAMS` is the
base of the merge and already carries `arpActive: false`, and no preset sets an arp field
(Task 1 pins that), so every resolved voice loads with the arpeggiator off.

This task adds the resolver **without** touching any vibe's data or `src/types.ts`, so it
compiles and ships green on its own. Task 5 wires it in.

**Files:**
- Modify: `src/store/instantVibes.ts:1-13` (imports + add the resolver beside `buildSynthParams`, which stays for now)
- Test: `src/store/vibeSynthPresets.test.ts` (create)

**Interfaces:**
- Consumes: `presetById(id)` from Task 1; `INITIAL_SYNTH_PARAMS` from `./initialState`; `SynthParams` from `../types`.
- Produces: `export function resolveVibeSynthParams(presetId: string): SynthParams` in `src/store/instantVibes.ts` — consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/store/vibeSynthPresets.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolveVibeSynthParams } from './instantVibes';
import { INITIAL_SYNTH_PARAMS } from './initialState';
import { presetById } from '../audio/synthPresets';

describe('resolveVibeSynthParams', () => {
  test('takes its sound from the resolved preset, not from a literal override', () => {
    const params = resolveVibeSynthParams('factory-mellow-epiano');
    const preset = presetById('factory-mellow-epiano')!;
    for (const [key, value] of Object.entries(preset.params)) {
      expect(`${key}=${JSON.stringify(params[key as keyof typeof params])}`)
        .toBe(`${key}=${JSON.stringify(value)}`);
    }
  });

  test('stamps the resolved preset name into the display field', () => {
    expect(resolveVibeSynthParams('factory-mellow-epiano').preset).toBe('Mellow E-Piano');
    expect(resolveVibeSynthParams('bass-deep-sine').preset).toBe('Deep Sine Sub');
  });

  test('falls back to INITIAL_SYNTH_PARAMS for fields the preset omits', () => {
    // FACTORY_PRESETS entries set 20 fields and omit `preset` and the four arp
    // fields; the base supplies those.
    const params = resolveVibeSynthParams('factory-hyper-saw-lead');
    expect(params.arpOctaves).toBe(INITIAL_SYNTH_PARAMS.arpOctaves);
    expect(params.arpMode).toBe(INITIAL_SYNTH_PARAMS.arpMode);
    expect(params.arpRate).toBe(INITIAL_SYNTH_PARAMS.arpRate);
  });

  test('never turns the arpeggiator on — that is the user’s call, not the vibe’s', () => {
    for (const id of ['factory-dream-keys', 'factory-glocken-bell', 'factory-pluck', 'bass-warm-tri']) {
      expect(`${id}:${resolveVibeSynthParams(id).arpActive}`).toBe(`${id}:false`);
    }
  });

  test('throws on an id no preset carries, so an authoring typo is never silent', () => {
    expect(() => resolveVibeSynthParams('factory-does-not-exist')).toThrow(
      'InstantVibe references unknown synth preset id: factory-does-not-exist',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/vibeSynthPresets.test.ts`
Expected: FAIL — `SyntaxError: export 'resolveVibeSynthParams' not found in './instantVibes'` (or, in bun, every test failing with `resolveVibeSynthParams is not a function`).

- [ ] **Step 3: Add the resolver to `src/store/instantVibes.ts`**

Change the first two import lines (`src/store/instantVibes.ts:1-2`) from:

```ts
import { SynthParams, InstantVibe } from '../types';
import { audioEngine } from '../audio/engine';
```

to:

```ts
import { SynthParams, InstantVibe } from '../types';
import { audioEngine } from '../audio/engine';
import { presetById } from '../audio/synthPresets';
```

Then insert, immediately after the existing `buildSynthParams` function (which ends at line 13) and before the `VIBE_SWAP_RELEASE` constant:

```ts
/**
 * Resolve one of a vibe's three synth voices from a library preset id.
 *
 * Replaces buildSynthParams's dead `presetName` parameter: that stamped a
 * display string while a literal override object beside it supplied the whole
 * sound. Here the preset supplies the sound and the display field is stamped
 * from the resolved entry's own name, so the preset select in ChordView points
 * at what is actually playing.
 *
 * Merge order is load-bearing: INITIAL_SYNTH_PARAMS fills the fields presets
 * omit (`preset` and the four arp fields), then the preset overrides the 20
 * timbre fields. No arp field is ever written here — arp is a performance
 * setting the user drives from the UI, and INITIAL_SYNTH_PARAMS.arpActive is
 * already false, so a vibe never switches it on behind the user's back.
 */
export function resolveVibeSynthParams(presetId: string): SynthParams {
  const preset = presetById(presetId);
  if (!preset) {
    throw new Error(`InstantVibe references unknown synth preset id: ${presetId}`);
  }
  return {
    ...INITIAL_SYNTH_PARAMS,
    ...preset.params,
    preset: preset.name,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/vibeSynthPresets.test.ts`
Expected: PASS, all five tests.

- [ ] **Step 5: Run eslint, because an import moved**

Run: `bun run eslint`
Expected: clean. `src/store/` importing `src/audio/` is the allowed direction (layering rule 2 only forbids `**/components/**`), so the new `presetById` import raises nothing.

- [ ] **Step 6: Commit**

```bash
git add src/store/instantVibes.ts src/store/vibeSynthPresets.test.ts
git commit -m "feat(vibes): resolve a synth voice from a preset id"
```

---

### Task 5: Point all six vibes at their preset ids and stop arpeggiating

The matrix. Each vibe gains three ids. The three `buildSynthParams` call sites inside
`applyInstantVibeToStore` switch to `resolveVibeSynthParams` **in place** — same line,
same position in the function body, so the `hardStopAll()` /
`stopSource('chord', 0.02)` / `stopSource('bass', 0.02)` cut still happens before the
first vibe-state write and the selective restart still happens after the last one.

Because the lead call site stops passing `vibe.synthParams`, the arp settings that
`synthwave-80s`, `cyber-dance` and `asian-zen` carry there stop reaching the store —
those three vibes stop arpeggiating from this commit on. That is the intended behaviour
change, so this task also corrects the two pieces of authored copy that assert the old
behaviour. The old `*PresetName` and `*SynthParams` fields stay in the file for now,
unused; Task 6 deletes them, which keeps that deletion a pure subtraction a reviewer can
read at a glance.

**Files:**
- Modify: `src/types.ts` (add three fields to `InstantVibe`)
- Modify: `src/store/instantVibes.ts` (three call sites at `:75`, `:83`, `:87`; 18 ids across the six vibe literals; the tagline at `:351`; the comment at `:329-331`)
- Modify: `src/store/instantVibes.test.ts`

**Interfaces:**
- Consumes: `resolveVibeSynthParams(presetId)` from Task 4; `presetById(id)` from Task 1; `factory-neon-poly-saw` from Task 2; `factory-koto-pluck` from Task 3.
- Produces: `InstantVibe.synthPresetId`, `InstantVibe.chordPresetId`, `InstantVibe.bassPresetId` — all `string`, all required — consumed by Task 6.

- [ ] **Step 1: Write the failing test**

In `src/store/instantVibes.test.ts`, make four edits.

**(a)** Replace the preset import at lines 6-7 — currently:

```ts
import { FACTORY_PRESETS } from '../audio/synthPresets';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
```

with:

```ts
import { presetById } from '../audio/synthPresets';
```

(`FACTORY_PRESETS` and `FACTORY_BASS_PRESETS` become unused once the name-keyed describe is gone, and `bun run lint` would flag them.)

**(b)** In the test `'contains all 6 curated genre vibes with complete presets and feel settings'`, change these three lines:

```ts
      expect(Boolean(vibe.chordPresetName)).toBe(true);
      ...
      expect(Boolean(vibe.bassPresetName)).toBe(true);
      ...
      expect(Boolean(vibe.synthPresetName)).toBe(true);
```

to:

```ts
      expect(Boolean(vibe.chordPresetId)).toBe(true);
      ...
      expect(Boolean(vibe.bassPresetId)).toBe(true);
      ...
      expect(Boolean(vibe.synthPresetId)).toBe(true);
```

**(c)** In the test `'applyInstantVibeToStore sets drum pattern, kit, chords, bass, feel, synth presets, and master effects'`, change these three lines:

```ts
    expect(state.chordSynthParams.preset).toBe(lofiVibe.chordPresetName);
    ...
    expect(state.bassSynthParams.preset).toBe(lofiVibe.bassPresetName);
    expect(state.synthParams.preset).toBe(lofiVibe.synthPresetName);
```

to:

```ts
    expect(state.chordSynthParams.preset).toBe(presetById(lofiVibe.chordPresetId)!.name);
    ...
    expect(state.bassSynthParams.preset).toBe(presetById(lofiVibe.bassPresetId)!.name);
    expect(state.synthParams.preset).toBe(presetById(lofiVibe.synthPresetId)!.name);
```

**(d)** Replace the test `'applies synthwave vibe with tight feel and active arpeggiator'` in full — this is the one existing test whose intent reverses. Before:

```ts
  test('applies synthwave vibe with tight feel and active arpeggiator', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyInstantVibeToStore(synthwave);

    const state = useAppStore.getState();
    expect(state.bpm).toBe(118);
    expect(state.chordFeel < 0.2).toBe(true); // tight feel
    expect(state.bassFeel < 0.2).toBe(true); // tight feel
    expect(state.synthParams.arpActive).toBe(true);
    expect(state.synthParams.arpMode).toBe('updown');
  });
```

After:

```ts
  test('applies synthwave vibe with tight feel and no arpeggiator', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyInstantVibeToStore(synthwave);

    const state = useAppStore.getState();
    expect(state.bpm).toBe(118);
    expect(state.chordFeel < 0.2).toBe(true); // tight feel
    expect(state.bassFeel < 0.2).toBe(true); // tight feel
    // No vibe turns the arpeggiator on: it is a performance setting the user
    // drives from the UI, and INITIAL_SYNTH_PARAMS.arpActive is already false.
    expect(state.synthParams.arpActive).toBe(false);
  });
```

**(e)** Replace the entire `describe('vibe preset name resolution', ...)` block (it starts at line 95 with `describe('vibe preset name resolution', () => {` and ends with its closing `});`) with:

```ts
describe('vibe preset id resolution', () => {
  test('every vibe lead and comp preset id resolves in the factory library', () => {
    for (const vibe of INSTANT_VIBES) {
      expect(`${vibe.id}.synthPresetId=${presetById(vibe.synthPresetId)?.id}`)
        .toBe(`${vibe.id}.synthPresetId=${vibe.synthPresetId}`);
      expect(`${vibe.id}.chordPresetId=${presetById(vibe.chordPresetId)?.id}`)
        .toBe(`${vibe.id}.chordPresetId=${vibe.chordPresetId}`);
    }
  });

  test('every vibe bass preset id resolves to a Bass-category preset', () => {
    for (const vibe of INSTANT_VIBES) {
      expect(`${vibe.id}=${presetById(vibe.bassPresetId)?.category}`).toBe(`${vibe.id}=Bass`);
    }
  });

  test('no vibe carries arp data of any kind', () => {
    const ARP_FIELDS = ['synthArp', 'chordArp', 'bassArp', 'arpActive', 'arpMode', 'arpRate', 'arpOctaves'];
    for (const vibe of INSTANT_VIBES) {
      for (const field of ARP_FIELDS) {
        expect(`${vibe.id}.${field}=${Object.prototype.hasOwnProperty.call(vibe, field)}`)
          .toBe(`${vibe.id}.${field}=false`);
      }
    }
  });

  test('applying any vibe leaves all three voices with the arpeggiator off', () => {
    for (const vibe of INSTANT_VIBES) {
      applyInstantVibeToStore(vibe);
      const s = useAppStore.getState();
      expect(`${vibe.id}.synth=${s.synthParams.arpActive}`).toBe(`${vibe.id}.synth=false`);
      expect(`${vibe.id}.chord=${s.chordSynthParams.arpActive}`).toBe(`${vibe.id}.chord=false`);
      expect(`${vibe.id}.bass=${s.bassSynthParams.arpActive}`).toBe(`${vibe.id}.bass=false`);
    }
    useAppStore.getState().hardStopAll();
  });

  test('loading a vibe leaves every preset select pointing at the preset that produced the sound', () => {
    const synthwave = INSTANT_VIBES.find((v) => v.id === 'synthwave-80s')!;
    applyInstantVibeToStore(synthwave);
    const state = useAppStore.getState();
    expect(state.synthParams.preset).toBe(presetById(synthwave.synthPresetId)!.name);
    expect(state.chordSynthParams.preset).toBe(presetById(synthwave.chordPresetId)!.name);
    expect(state.bassSynthParams.preset).toBe(presetById(synthwave.bassPresetId)!.name);
    useAppStore.getState().hardStopAll();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/instantVibes.test.ts`
Expected: FAIL. `bun` reports `undefined` for `vibe.synthPresetId` / `vibe.chordPresetId` / `vibe.bassPresetId` throughout — e.g. `'every vibe bass preset id resolves to a Bass-category preset'` fails with `Expected: "lofi-chill=Bass"` / `Received: "lofi-chill=undefined"`. `'applies synthwave vibe with tight feel and no arpeggiator'` also fails, with `Expected: false` / `Received: true`, because the vibe still carries `synthParams.arpActive: true` and the lead call site still reads it.

- [ ] **Step 3: Add the three fields to `InstantVibe` in `src/types.ts`**

Inside `export interface InstantVibe`, add `chordPresetId` immediately after the existing `chordPresetName: string;` line, `bassPresetId` immediately after `bassPresetName: string;`, and `synthPresetId` immediately after `synthPresetName: string;`:

```ts
  chordPresetName: string;
  /** Library reference into ALL_FACTORY_PRESETS for the comp voice. */
  chordPresetId: string;
  chordSynthParams?: Partial<SynthParams>;
```

```ts
  bassPresetName: string;
  /** Library reference into ALL_FACTORY_PRESETS; must resolve to category 'Bass'. */
  bassPresetId: string;
  bassSynthParams?: Partial<SynthParams>;
```

```ts
  synthPresetName: string;
  /** Library reference into ALL_FACTORY_PRESETS for the lead voice. */
  synthPresetId: string;
  synthParams?: Partial<SynthParams>;
```

No arp field is added. `src/types.ts` stays a zero-import leaf.

- [ ] **Step 4: Rewire the three call sites in `applyInstantVibeToStore`**

In `src/store/instantVibes.ts`, change line 75 from:

```ts
  const finalChordSynthParams = buildSynthParams(vibe.chordPresetName, vibe.chordSynthParams);
```

to:

```ts
  const finalChordSynthParams = resolveVibeSynthParams(vibe.chordPresetId);
```

Change line 83 from:

```ts
  const finalBassSynthParams = buildSynthParams(vibe.bassPresetName, vibe.bassSynthParams);
```

to:

```ts
  const finalBassSynthParams = resolveVibeSynthParams(vibe.bassPresetId);
```

Change line 87 from:

```ts
  const finalSynthParams = buildSynthParams(vibe.synthPresetName, vibe.synthParams);
```

to:

```ts
  const finalSynthParams = resolveVibeSynthParams(vibe.synthPresetId);
```

Also update the section comment above that last call site, `// 5. Main Synth Sound Preset & Arpeggiator` (line 85), to:

```ts
  // 5. Main Synth Sound Preset
```

Nothing else in the function changes: `store.hardStopAll()`, both `audioEngine.stopSource(..., VIBE_SWAP_RELEASE)` calls, the six numbered write blocks and the two restart branches all keep their exact position.

- [ ] **Step 5: Add the ids to all six vibe literals**

Each id goes on the line immediately after the matching `*PresetName` line, so the pair reads together while both exist. Line numbers are the current ones in `src/store/instantVibes.ts`.

`lofi-chill` — after `chordPresetName: 'Dream Keys',` (line 135):

```ts
    chordPresetId: 'factory-mellow-epiano',
```

after `bassPresetName: 'Deep Sine Sub',` (line 159):

```ts
    bassPresetId: 'bass-deep-sine',
```

after `synthPresetName: 'Dream Keys',` (line 175):

```ts
    synthPresetId: 'factory-dream-keys',
```

`synthwave-80s` — after `chordPresetName: 'Neon Pluck',` (line 255):

```ts
    chordPresetId: 'factory-neon-poly-saw',
```

after `bassPresetName: 'Saw Growl',` (line 279):

```ts
    bassPresetId: 'bass-saw-growl',
```

after `synthPresetName: 'Neon Pluck',` (line 295):

```ts
    synthPresetId: 'factory-hyper-saw-lead',
```

`cyber-dance` — after `chordPresetName: 'Hyper Saw Lead',` (line 379):

```ts
    chordPresetId: 'factory-trance-pluck',
```

after `bassPresetName: 'Punchy Square',` (line 399):

```ts
    bassPresetId: 'bass-punchy-square',
```

after `synthPresetName: 'Cyber Drone',` (line 415):

```ts
    synthPresetId: 'factory-pluck',
```

`ambient-chill` — after `chordPresetName: 'Celestial Shimmer',` (line 495):

```ts
    chordPresetId: 'factory-warm-polypad',
```

after `bassPresetName: 'Deep Sine Sub',` (line 517):

```ts
    bassPresetId: 'bass-deep-sine',
```

after `synthPresetName: 'Celestial Shimmer',` (line 531):

```ts
    synthPresetId: 'factory-celestial-shimmer',
```

`hiphop-groove` — after `chordPresetName: 'Mellow E-Piano',` (line 609):

```ts
    chordPresetId: 'factory-fm-tine-piano',
```

after `bassPresetName: 'Round Pluck',` (line 632):

```ts
    bassPresetId: 'bass-round-pluck',
```

after `synthPresetName: 'Mellow E-Piano',` (line 648):

```ts
    synthPresetId: 'factory-mellow-epiano',
```

`asian-zen` — after `chordPresetName: 'Glocken Bell',` (line 730):

```ts
    chordPresetId: 'factory-koto-pluck',
```

after `bassPresetName: 'Warm Triangle',` (line 749):

```ts
    bassPresetId: 'bass-warm-tri',
```

after `synthPresetName: 'Glocken Bell',` (line 763):

```ts
    synthPresetId: 'factory-glocken-bell',
```

Note that `lofi-chill` and `ambient-chill` both take `bass-deep-sine`, and `factory-mellow-epiano` is `lofi-chill`'s comp and `hiphop-groove`'s lead. Both reuses are intended — the inventory requirement is one suitable preset per role slot, not one preset per slot.

- [ ] **Step 6: Correct `cyber-dance`'s tagline, which now claims an arp the vibe no longer plays**

`src/store/instantVibes.ts:351` currently reads:

```ts
    tagline: 'High-energy 128 BPM festival drop with punchy kicks & arps',
```

Change it to:

```ts
    tagline: 'High-energy 128 BPM festival drop with punchy kicks & stabs',
```

The 128 BPM claim stays true (`bpm: 128` on line 355). "Stabs" is accurate rather than
decorative: the vibe's `chordRhythmId` is `'offbeatStabs'` (line 376) and its comp now
resolves to `factory-trance-pluck`. Same register, one word swapped, one character
shorter. This is user-visible copy — do not paraphrase the rest of the line.

- [ ] **Step 7: Correct the `synthwave-80s` keyPool comment, whose rationale evaporated**

`src/store/instantVibes.ts:328-331` currently reads:

```ts
      // Starts at D so the Saw Growl sub-osc (0.6, one octave down) stays above
      // ~37 Hz; stops at A so the Neon Pluck stack at octave 4 keeps headroom
      // under the arp's two octaves.
      keyPool: ['D', 'E', 'F', 'F#', 'G', 'A'],
```

Two things in it are now false: there is no arp to keep headroom under, and "Neon Pluck"
names a preset this vibe no longer uses (its comp is `factory-neon-poly-saw`, "Neon Poly
Saw", and its lead is `factory-hyper-saw-lead`). Replace the three comment lines with:

```ts
      // Starts at D so the Saw Growl sub-osc (0.6, one octave down) stays above
      // ~37 Hz. The upper bound is a taste call, not an acoustic one: the pool
      // stops at A to keep every draw inside the darker half of the synthwave
      // key range. (It used to be justified by the lead arp's two octaves of
      // headroom; the arp is gone, and the bound was kept exactly as authored.)
      keyPool: ['D', 'E', 'F', 'F#', 'G', 'A'],
```

**The `keyPool` array itself must not change.** It is `variation` data, which this phase
does not touch; only the comment above it is corrected.

- [ ] **Step 8: Run the vibe suites to verify they pass**

Run: `bun test src/store/instantVibes.test.ts src/store/vibeSynthPresets.test.ts src/store/vibeVariation.test.ts`
Expected: PASS. In particular `'cuts everything before writing new vibe state, and restarts only the players that were active'` and both `'applyInstantVibeToStore audible cut'` tests pass unmodified — the cut ordering was not touched. `vibeVariation.test.ts` still passes at this point because the `*SynthParams` fields it reads have not been deleted yet; Task 6 handles that.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/store/instantVibes.ts src/store/instantVibes.test.ts
git commit -m "feat(vibes): resolve every vibe voice from a preset id and stop arpeggiating"
```

---

### Task 6: Delete the inline override objects and the dead `buildSynthParams`

Pure subtraction. Nothing reads `buildSynthParams`, `*PresetName` or `*SynthParams` after
Task 5 — the resolver supplies every voice, and the arp members those override objects
still carry are already inert. This task removes 18 override blocks (9-16 fields each),
three type field pairs and the old builder, and follows the rename through the one
remaining test that names the departing fields.

**Files:**
- Modify: `src/types.ts` (remove 6 fields from `InstantVibe`)
- Modify: `src/store/instantVibes.ts` (remove `buildSynthParams`; remove 18 `*PresetName` + `*SynthParams` pairs)
- Modify: `src/store/vibeVariation.test.ts:353-355`

**Interfaces:**
- Consumes: everything from Task 5 — nothing new.
- Produces: an `InstantVibe` whose only synth-voice data is `synthPresetId`, `chordPresetId` and `bassPresetId`.

- [ ] **Step 1: Confirm nothing outside the two files still reads the departing fields**

```bash
grep -rn "PresetName\|chordSynthParams:\|bassSynthParams:\|synthParams:\|buildSynthParams" src | grep -v "^src/store/instantVibes.ts" | grep -v "^src/types.ts"
```

Expected output: matches only in `src/store/vibeVariation.test.ts` (lines 353-355), plus store-slice and component matches for the **store's own** `synthParams`/`chordSynthParams`/`bassSynthParams` state (`src/store/engineSync.ts`, `src/store/synthSlice.ts`, `src/components/*`, `src/App.tsx`) — those are the live Zustand fields, are unrelated to `InstantVibe`, and must not be touched. If any other `InstantVibe`-shaped match appears, stop and report it rather than editing it.

- [ ] **Step 2: Follow the rename through `src/store/vibeVariation.test.ts`**

Inside `describe('resolveVibeVariation')` → test `'genre identity is copied verbatim under every draw'`, replace these three lines:

```ts
        expect(out.synthParams).toEqual(v.synthParams);
        expect(out.chordSynthParams).toEqual(v.chordSynthParams);
        expect(out.bassSynthParams).toEqual(v.bassSynthParams);
```

with:

```ts
        expect(out.synthPresetId).toBe(v.synthPresetId);
        expect(out.chordPresetId).toBe(v.chordPresetId);
        expect(out.bassPresetId).toBe(v.bassPresetId);
```

(`src/store/vibeVariation.ts:178` copies the vibe with `...vibe`, so the new fields ride along with no change to the resolver itself — this test is what proves it.)

- [ ] **Step 3: Run that suite to confirm the rename holds before the deletion**

Run: `bun test src/store/vibeVariation.test.ts`
Expected: PASS — the new assertions hold immediately, because Task 5 already added the id fields and `...vibe` already copies them. This is a rename following the data, not a red-green cycle; the red for this task comes from the type checker in Step 6 if the deletions are done wrong.

- [ ] **Step 4: Remove the six dead fields from `InstantVibe` in `src/types.ts`**

Delete these lines from `export interface InstantVibe`:

```ts
  chordPresetName: string;
```
```ts
  chordSynthParams?: Partial<SynthParams>;
```
```ts
  bassPresetName: string;
```
```ts
  bassSynthParams?: Partial<SynthParams>;
```
```ts
  synthPresetName: string;
```
```ts
  synthParams?: Partial<SynthParams>;
```

Leave `synthPresetId`, `chordPresetId` and `bassPresetId` in place. Also update the section comment above the lead group from `// Lead / Melody Synthesizer (with Arpeggiator setup)` to `// Lead / Melody Synthesizer (preset reference only — arp is the user's, not the vibe's)`.

Do **not** remove the `synthParams?: SynthParams;` field on `ProjectState` (`src/types.ts:114`) — that is the saved-project payload, an entirely different type.

- [ ] **Step 5: Remove `buildSynthParams` and the 18 override blocks from `src/store/instantVibes.ts`**

Delete the whole function at lines 7-13:

```ts
function buildSynthParams(presetName: string, overrides?: Partial<SynthParams>): SynthParams {
  return {
    ...INITIAL_SYNTH_PARAMS,
    ...overrides,
    preset: presetName,
  };
}
```

Then, in each of the six vibe literals, delete each `chordPresetName: '...'` / `bassPresetName: '...'` / `synthPresetName: '...'` line together with the entire `chordSynthParams: { ... },` / `bassSynthParams: { ... },` / `synthParams: { ... },` object literal that follows it. That is 18 removals in total — three per vibe, and it takes every remaining `arpActive` / `arpMode` / `arpRate` / `arpOctaves` literal out of the vibe table with them. Keep the `chordPresetId` / `bassPresetId` / `synthPresetId` lines Task 5 added.

Two surrounding comments name the arp and must go with it: `// Main Synth: Arpeggiator active` above `synthwave-80s`'s lead (line 294) becomes `// Main Synth: hyper saw lead`, and `// Main Synth: Cyber Pluck Arp` above `cyber-dance`'s lead (line 414) becomes `// Main Synth: cyber pluck lead`. `asian-zen`'s `// Main Synth: Pentatonic Bell Arp` (line 762) becomes `// Main Synth: pentatonic bell lead`. Every other comment describing a vibe's *role* rather than its arp stays as written.

`SynthParams` is still imported at line 1 and still used by `resolveVibeSynthParams`'s return type, so the import stays. `INITIAL_SYNTH_PARAMS` is still used by the resolver, so that import stays too.

- [ ] **Step 6: Run the full test suite**

Run: `bun test`
Expected: PASS, everything. `src/store/instantVibesProgressions.test.ts` is untouched and green (it reads only `chords` / `progressionId` / `scaleRoot` / `scaleType` / `chordOctave`). `src/store/store.test.ts`'s v1-migration arp tests are green (they operate on persisted store state, not on `InstantVibe`). `src/components/SimpleSynthPanel.test.tsx` is green (the arpeggiator UI is untouched — the user can still switch it on by hand).

- [ ] **Step 7: Run the gate**

Run: `bun run verify`
Expected: PASS — test + `tsc --noEmit` + `check:keys` + `check:drums` + build. `tsc` is what proves no reference to a deleted field survives anywhere.

- [ ] **Step 8: Run eslint separately**

Run: `bun run eslint`
Expected: clean. No import moved in this task, but the gate does not include eslint and this is the last task, so it is run explicitly here.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/store/instantVibes.ts src/store/vibeVariation.test.ts
git commit -m "refactor(vibes): drop the inline synth override objects now that presets supply every voice"
```

---

## Self-review notes

Recorded so a reviewer can see what was checked rather than re-deriving it.

- **Spec coverage.** Every Phase 2 clause maps to a task: the 6 × 3 matrix → Task 5 Step 5; the two new presets and their gap arguments → Tasks 2 and 3; `bass-drone-sub` rejected in favour of `bass-deep-sine` → Task 5 Step 5 assigns `bass-deep-sine` to `ambient-chill`, and no task authors a bass preset; the four accepted redesigns → Task 5 Step 5 (`factory-mellow-epiano`, `factory-trance-pluck`, `factory-warm-polypad`, `factory-glocken-bell`), with no fallback offered anywhere; arp removed from `InstantVibe` → Task 4 (a resolver that takes no arp argument), Task 5 Steps 1/4/6/7 (the behaviour change plus both copy corrections) and Task 6 Step 5 (the last arp literals leave the file); `buildSynthParams`'s dead `presetName` → replaced in Task 4, wired in Task 5, deleted in Task 6. Spec invariants 1-4 → Task 1 (unique ids, no arp in presets) and Task 5 Step 1 (`*PresetId` resolves, `bassPresetId` is `Bass`); invariant 5 (applying any vibe leaves all three voices with the arp off) → Task 5 Step 1's `'applying any vibe leaves all three voices with the arpeggiator off'` plus `'no vibe carries arp data of any kind'`; invariant 6 (cut-and-restart non-regression) → the existing tests, kept unmodified, confirmed green in Task 5 Step 8.
- **No equivalence proof.** Deliberately absent. Phase 2 changes the sound by design (spec settled decision 2), so no task captures a pre-refactor fixture or asserts byte-identical params — the opposite of Phase 1's Task 4.
- **Type consistency.** `presetById` (Task 1) is the same name in Tasks 2, 3, 4 and 5. `resolveVibeSynthParams(presetId: string): SynthParams` (Task 4) is one-argument at its definition and at all three call sites (Task 5 Step 4) — there is no second parameter anywhere in the plan. The three `InstantVibe` fields are `synthPresetId` / `chordPresetId` / `bassPresetId` in Task 5 Step 3, Task 5 Step 5, Task 6 Step 2 and Task 6 Step 4 alike. No `VibeArp` type, no `synthArp` field and no `arp?` parameter appears in any task; the only arp identifiers that remain are the four `SynthParams` field names (`arpActive`, `arpMode`, `arpRate`, `arpOctaves`), used in Task 1's and Task 5's negative assertions and in Task 4's fall-through assertion.
- **Behaviour changes a reviewer should expect to hear.** All 18 voices change timbre (spec's delta reasoning), and three vibes stop arpeggiating. Task 5 is the commit where both land; Task 6 changes no behaviour at all.
- **Placeholders.** None. Every preset literal, test body, edit, copy string and command is given in full; no step says "similar to Task N".

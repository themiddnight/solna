# DEV-423 Per-track sends into the master effects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Sound-tab Mixer row gains Rev / Dly / Dist knobs that set, per loop, how much of that track reaches the shared master reverb, delay and distortion, with an existing project sounding and exporting byte-identically.

**Architecture:** Bottom-up. Task 1 adds the send types and a stateless node-helper module (`src/audio/sourceSends.ts`). Task 2 rewires `MasterRack`: every source bus reaches the three send gates only through its own three send `GainNode`s, the Beat reverb runs `drumSendGate → send[sequencer].reverb → convolver` (connected after `reverbSendGate`), and `setSourceSends` is a separate engine method. Task 3 makes `trackSends` per-loop content (field, defaults, copy group, slice, validation). Task 4 bridges store → engine in `engineSync.ts`. Task 5 carries sends through the WAV mixdown. Task 6 adds the knobs with a local draft. Task 7 syncs rules, ADR-0037 and architecture docs and runs the gate.

**Tech Stack:** TypeScript, React, zustand, raw Web Audio API, Bun test runner (`bun:test`), `node-web-audio-api` for offline renders, ESLint flat config, Knip. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-22-dev-423-per-track-sends-design.md` — binding. Read §0 (verified facts and conditions C1/C2), §3 (shape, defaults, validation), §4 (audio graph), §5 (store → engine), §7 (UI) and §9 (tests) before any task. Where this plan corrects the spec it says so under "Spec corrections".

## Global Constraints

- Branch `feat/dev-423-per-track-sends` (checked out). Never push, never commit on `main`, never switch branches.
- One commit per task. Conventional message with `(DEV-423)`, body ending with a blank line and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **(C1)** "The convolver's two inputs stay connected in F10's order: `reverbSendGate` first, then the Beat reverb feed. Float addition is not associative. Folding the Beat feed into `reverbSendGate` would change the order of the sum and could change bytes, so it is rejected (§4.2)." The Beat reverb stays the convolver's **second input**; it is never merged into `reverbSendGate`.
- **(C2)** "No new call goes through a method in the golden's `METHODS` list. Sends get their own engine method, never `setSourceState` (F16)." Sends travel only through `setSourceSends`.
- **Golden is frozen.** "The golden test is the proof. It must pass with `renderMixdownGolden.wav.sha256` and `renderMixdownGolden.calls.json` unchanged." `src/audio/export/renderMixdownGolden.test.ts`, `.wav.sha256` and `.calls.json` are never edited. **Regenerating the golden is forbidden: never run anything with `GOLDEN_UPDATE=1`.** If the golden fails, the routing is wrong — fix the code, not the golden. After every task touching routing or the mixdown, `git status --short src/audio/export/renderMixdownGolden*` prints nothing.
- Types verbatim (spec §3.1): `SEND_EFFECTS = ['reverb', 'delay', 'distortion'] as const`; `SendEffect`; `TrackSendLevels = Record<SendEffect, number>` ("LINEAR gain, 0..1, applied after the track's fader and mute"); `interface TrackSends { synth; chord; bass; pad; fx; sequencer }` — keyed by **engine source id** (`SOURCE_BUSES` `source` column), never by mixer id `'drum'` or solo id `'drums'`/`'lead'`.
- Defaults (spec §3.3), written **only** in `createDefaultLoopContent()`: `synth`/`chord`/`bass`/`pad`/`fx` `{ reverb: 1, delay: 1, distortion: 1 }`; `sequencer: { reverb: 1, delay: 0, distortion: 0 }`. The one exception is the mixdown test fixture (`mixdownFixture.ts`).
- "There is no version gate and no bump of `PERSIST_VERSION` or `PROJECT_FORMAT_VERSION`." `sanitizePersistedState` does not change.
- A send node "is **seeded from `sourceSends`, or 0 when no level has been received.**" Never seed at 1 inside `src/audio/` for a store-driven track.
- Sends are post-fader, post-mute and **read no audibility**: `busAudible` stays the only audibility read (R160). No `setSourceSends` call on a solo or mute change.
- `LoopMixPatch`, `components/mixLayers.ts`, `src/audio/export/renderMidi.ts`, the Beat presets, `sanitizeBeat.ts`, `check:drums` and the voice cards' "Reverb" label do not change.
- Knobs (spec §7): `size="xs"`, `min 0`, `max 1`, `step 0.01`, `color={channel.accentClass}`, labels `Rev` / `Dly` / `Dist`, `ariaLabel` `` `${channel.label} reverb send` `` / `delay send` / `distortion send`, `id` `` `knob-send-${channel.idPrefix}-${effect}` ``, `format={formatPercent}`. The dragged value stays local; the store is written once on release.
- Gates: `bun run verify` is the completion gate (R004). `bun run eslint` prints **zero errors and zero warnings** — never ignore or call a warning pre-existing; fix it or add a line-level `// eslint-disable-next-line <rule> -- <reason>`; never relax a rule globally (R005, R264). Both Knip scans zero findings (R006) — except where a task states an expected interim finding.
- Size caps that bind here (`eslint.config.js`): `max-lines` 750 code lines per file; `max-lines-per-function` 100 (describe callbacks included); `complexity` warns at 20 (a warning fails). Measured before this plan: `startEngineSync` 97, `setupMasterChain` 90, `sanitizeLoops` 92, `masterRack.ts` ~640 code lines. Task 4 therefore moves code **out** of `startEngineSync`; Task 2 adds at most ~3 lines to `setupMasterChain`.
- Layering: `src/audio/` never imports `store/` or `components/`; components never import `audio/engine` (tests excepted, as today). `../../` imports banned: `@/…` across folders, `./` within one.
- R001: no counts, versions or line numbers in any doc you write. A rule change updates its `.claude/rules/*.md` file and its ADR in the same commit.
- Large files (`masterRack.ts`, `engineSync.ts`, `sanitize.ts`, `types.ts`, structure docs): Serena `find_symbol` / `grep -n` + line ranges, never a whole-file dump.

## Spec corrections (found while verifying the spec against the code)

1. **F22 is false: a seventh source reaches `getSourceBus`.** `src/audio/playback/presetPreview.ts` runs every audition on its own `'preview'` bus (`PREVIEW_SOURCE`), which reaches `getSourceBus` through `audioSession.ts`'s `getSourceTap(source)`. Today that bus feeds all three gates at unity. Under "seeded at 0 until told" it would lose its reverb, delay and distortion. Resolution (Task 2): `beginPreview()` tells the engine `setSourceSends('preview', { reverb: 1, delay: 1, distortion: 1 })` — auditions sound exactly as before. `'preview'` is not a track, has no store row, and is not covered by R301's "default literal" prohibition; R303's text names it.
2. **§6 "the three occurrences `:248`, `:264`, `:282`".** `src/types.ts` has **seven** `reverbSend` fields (kick, snare, clap, tom, ride, crash, bell) and only the kick's carries a docblock. Task 2 rewords the kick docblock and adds a one-line docblock to the other six.
3. **§9 "a type-level pin in `sourceBuses.test.ts`".** That file does not exist. Task 3 creates `src/store/sourceBuses.test.ts`.
4. **§5.2 adds lines to `startEngineSync`, which is at 97 of 100.** Task 4 adds two module-level helpers — `settleSourceBuses(s)` (bus state + sends, used by `applySliceState` and the transport-start block) and `subscribeTrackSends()` — so `startEngineSync` shrinks. Within `settleSourceBuses` each bus's sends are pushed right after its bus state (interleaved, not a second loop); both are `'settle'` at the same instant, so the effect is identical.
5. **§7 hook shape vs R265.** `onChange: (effect, value) => void` would force an inline arrow per knob in the new `TrackSendKnobs` component, which R265 forbids. `UseTrackSendsDraft` returns `onChangeFor: Record<SendEffect, (value: number) => void>` (memoized in the hook) instead; the pure machine keeps `onChange(effect, value)`. `TrackSendKnobs` takes `channel` (it needs `engineSource`, `idPrefix`, `label`, `accentClass`), not only `source`. The machine's `commit` writes only if a gesture is open, so a release with no move writes nothing.
6. **§4.2/§4.4 naming.** §4.4 declares the field `sourceSendNodes` (a `Map`), §4.2 calls `sourceSendNodes('sequencer')` as a function. The plan keeps the `Map` field and adds `private sendNodesFor(source): SourceSendNodes` (builds the bus on first use).
7. **§9 test placement.** Sanitizer tests go in a new `src/store/sanitizeTrackSends.test.ts` (`sanitize.test.ts` is already large); engineSync tests in a new `src/store/engineSync.trackSends.test.ts` (`engineSync.test.ts` is over 850 lines); the Beat routing render test in a new `src/audio/masterRack.beatSends.render.test.ts`. The preview spy in `useTrackSendsDraft.test.ts` spies `audioEngine.setSourceSends` (what `previewTrackSends` calls), the `useEffectsDraft.test.tsx` precedent.
8. **R303 wording.** "No source is excluded by name" cannot hold literally: R304 requires the Beat bus to have no bus→reverb edge, which `getSourceBus` decides by the Beat source name (the `applySourceLevel` precedent). Task 7 words R303 as "no per-source exclusion set; the one Beat-reverb exception is R304".

## File map

| File | Task | Change |
|---|---|---|
| `src/types.ts` | 1, 2, 3 | `SEND_EFFECTS`, `SendEffect`, `TrackSendLevels` (1); `reverbSend` docblocks (2); `TrackSends` (3) |
| `src/audio/sourceSends.ts` (+ `.test.ts`) | 1 | **new** — `SourceSendNodes`, `clampSendLevels`, `createSourceSendNodes`, `applySourceSendLevels` |
| `src/audio/masterRack.ts` | 2 | send nodes per bus, `SOURCES_WITHOUT_MASTER_SENDS` → `BEAT_BUS_SOURCE`, gate-first construction, Beat reverb in series, `setSourceSends`, `sendNodesFor`, `beatReverbFeed` |
| `src/audio/engine.ts` | 2 | `setSourceSends` pass-through |
| `src/audio/playback/presetPreview.ts` (+ `.test.ts`) | 2 | preview bus told unity sends |
| `src/audio/masterRack.sendGates.test.ts`, `masterRack.sourceBus.test.ts`, `drumSynth.test.ts` | 2 | routing tests rewritten; send-level tests; stale comment |
| `src/audio/masterRack.beatSends.render.test.ts` | 2 | **new** — Beat reverb/delay render checks |
| `src/store/types.ts`, `loop.ts`, `loopDefaults.ts`, `loopCopy.ts`, `store.ts`, `sanitize.ts` | 3 | per-loop `trackSends` |
| `src/store/trackSendsSlice.ts` (+ `.test.ts`), `sourceBuses.test.ts`, `sanitizeTrackSends.test.ts` | 3 | **new** |
| `src/store/engineSync.ts`, `engineSync.trackSends.test.ts` | 4 | bridge; **new** test |
| `src/audio/playback/plan/songSnapshot.ts`, `src/store/mixdownSnapshot.ts`, `src/audio/export/renderMixdown.ts`, `mixdownFixture.ts`, `renderMidi.test.ts`, `src/store/mixdownSnapshot.test.ts`, `src/audio/export/renderMixdown.sourceBus.test.ts` | 5 | mixdown sends |
| `src/utils/gainUnits.ts` (+ test), `src/components/loop/beat/beatControlSchema.ts`, `src/store/trackSendsPreview.ts`, `src/components/loop/useTrackSendsDraft.ts` (+ test), `src/components/loop/SoundMixer.tsx` (+ test) | 6 | UI |
| `.claude/rules/{loops-and-solo,persistence,synth-voices,beat,playback}.md`, `docs/decisions/0037-per-track-sends.md`, `docs/decisions/README.md`, `CLAUDE.md`, `.claude/skills/dsp-audio/SKILL.md`, `docs/architecture/feature-overview.md`, `docs/architecture/structure/{README,01-ui,02-store,03-audio}.md` | 7 | doc sync + gate |

---

### Task 1: Send types and the `sourceSends.ts` node helpers

**Files:**
- Modify: `src/types.ts` (beside `BeatMix`, after the `BeatMix` interface)
- Create: `src/audio/sourceSends.ts`, `src/audio/sourceSends.test.ts`

**Interfaces:**
- Consumes: `applySourceBusAutomation(param, targetGain, at, mode, currentTime?)`, `SourceBusApplyMode`, `SOURCE_BUS_TIME_CONSTANT_SEC` from `src/audio/automation/sourceBusAutomation.ts`.
- Produces (`src/types.ts`):

```ts
export const SEND_EFFECTS = ['reverb', 'delay', 'distortion'] as const;
export type SendEffect = (typeof SEND_EFFECTS)[number];
export type TrackSendLevels = Record<SendEffect, number>;
```
- Produces (`src/audio/sourceSends.ts`):

```ts
export type SourceSendNodes = Record<SendEffect, GainNode>;
export function clampSendLevels(sends: TrackSendLevels): TrackSendLevels;
export function createSourceSendNodes(ctx: BaseAudioContext, seed: TrackSendLevels | undefined): SourceSendNodes;
export function applySourceSendLevels(
  nodes: SourceSendNodes, sends: TrackSendLevels, at: number, mode: SourceBusApplyMode, now: number,
): void;
```

- [ ] **Step 1: Failing test.** Create `src/audio/sourceSends.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { masterChainCtx } from './engineTestHelpers';
import { SOURCE_BUS_TIME_CONSTANT_SEC } from './automation/sourceBusAutomation';
import { applySourceSendLevels, clampSendLevels, createSourceSendNodes } from './sourceSends';

/* eslint-disable @typescript-eslint/no-explicit-any -- the fake GainNode's
   param records its automation in fields the DOM type does not declare. */

function ctx(): BaseAudioContext {
  return masterChainCtx() as unknown as BaseAudioContext;
}

describe('clampSendLevels', () => {
  test('keeps 0..1, clamps outside it, and zeroes a non-finite level', () => {
    expect(clampSendLevels({ reverb: 0.25, delay: 1.7, distortion: -0.2 }))
      .toEqual({ reverb: 0.25, delay: 1, distortion: 0 });
    expect(clampSendLevels({ reverb: Number.NaN, delay: Infinity, distortion: 1 }))
      .toEqual({ reverb: 0, delay: 0, distortion: 1 });
  });
});

describe('createSourceSendNodes', () => {
  test('with no level received yet, every send is seeded silent', () => {
    const nodes = createSourceSendNodes(ctx(), undefined);
    expect([nodes.reverb.gain.value, nodes.delay.gain.value, nodes.distortion.gain.value])
      .toEqual([0, 0, 0]);
  });

  test('a known level seeds its own node, one distinct node per effect', () => {
    const nodes = createSourceSendNodes(ctx(), { reverb: 0.3, delay: 0.6, distortion: 0.9 });
    expect([nodes.reverb.gain.value, nodes.delay.gain.value, nodes.distortion.gain.value])
      .toEqual([0.3, 0.6, 0.9]);
    expect(new Set([nodes.reverb, nodes.delay, nodes.distortion]).size).toBe(3);
  });
});

describe('applySourceSendLevels', () => {
  test("'settle' writes each level at the instant, the way a bus settles at render start", () => {
    const nodes = createSourceSendNodes(ctx(), undefined);
    applySourceSendLevels(nodes, { reverb: 1, delay: 0, distortion: 0.5 }, 0, 'settle', 0);
    expect((nodes.reverb.gain as any).events.at(-1)).toEqual({ kind: 'set', v: 1, t: 0 });
    expect((nodes.delay.gain as any).events.at(-1)).toEqual({ kind: 'set', v: 0, t: 0 });
    expect((nodes.distortion.gain as any).events.at(-1)).toEqual({ kind: 'set', v: 0.5, t: 0 });
  });

  test("'transition' ramps each node with the source-bus time constant", () => {
    const nodes = createSourceSendNodes(ctx(), undefined);
    applySourceSendLevels(nodes, { reverb: 0.2, delay: 0.4, distortion: 0.6 }, 2, 'transition', 0);
    const tc = SOURCE_BUS_TIME_CONSTANT_SEC;
    expect((nodes.reverb.gain as any).targets.at(-1)).toEqual({ v: 0.2, t: 2, tc });
    expect((nodes.delay.gain as any).targets.at(-1)).toEqual({ v: 0.4, t: 2, tc });
    expect((nodes.distortion.gain as any).targets.at(-1)).toEqual({ v: 0.6, t: 2, tc });
  });
});
```

- [ ] **Step 2:** `bun test src/audio/sourceSends.test.ts` → FAIL (`Cannot find module './sourceSends'`).
- [ ] **Step 3: Types.** In `src/types.ts`, directly after the `BeatMix` interface, add:

```ts
/** The three shared master effects a track can send into, in knob order. */
export const SEND_EFFECTS = ['reverb', 'delay', 'distortion'] as const;
export type SendEffect = (typeof SEND_EFFECTS)[number];

/** One track's send levels: LINEAR gain, 0..1, applied after the track's fader and mute. */
export type TrackSendLevels = Record<SendEffect, number>;
```

- [ ] **Step 4: Module.** Create `src/audio/sourceSends.ts`:

```ts
/**
 * Per-source send nodes into the three shared master effects (DEV-423).
 *
 * Every source bus owns three `GainNode`s, one per effect, fed from the bus
 * OUTPUT — so fader, mute and solo (all written to the bus gain) apply to the
 * sends too. `MasterRack` owns the nodes and the graph; this module only
 * builds and automates them, which keeps the node code out of `masterRack.ts`.
 * It holds no state.
 */
import { SEND_EFFECTS, type SendEffect, type TrackSendLevels } from '../types';
import { applySourceBusAutomation, type SourceBusApplyMode } from './automation/sourceBusAutomation';

export type SourceSendNodes = Record<SendEffect, GainNode>;

function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

/** Clamp each level to 0..1; a non-finite level becomes 0. */
export function clampSendLevels(sends: TrackSendLevels): TrackSendLevels {
  return {
    reverb: clampLevel(sends.reverb),
    delay: clampLevel(sends.delay),
    distortion: clampLevel(sends.distortion),
  };
}

/**
 * Three GainNodes seeded at `seed`, or 0 for a source that has been told no
 * level yet. Silent until told, on the "every wet send is seeded at ZERO"
 * precedent in `setupMasterChain`: the store's defaults arrive through
 * `applyEngineSnapshot` live and `applyMasterState` offline, so the audio
 * layer never repeats them.
 */
export function createSourceSendNodes(
  ctx: BaseAudioContext,
  seed: TrackSendLevels | undefined,
): SourceSendNodes {
  const node = (effect: SendEffect): GainNode => {
    const gain = ctx.createGain();
    gain.gain.value = seed?.[effect] ?? 0;
    return gain;
  };
  return { reverb: node('reverb'), delay: node('delay'), distortion: node('distortion') };
}

/** Automate all three nodes to `sends` at `at`, with the bus's own time constant and modes. */
export function applySourceSendLevels(
  nodes: SourceSendNodes,
  sends: TrackSendLevels,
  at: number,
  mode: SourceBusApplyMode,
  now: number,
): void {
  for (const effect of SEND_EFFECTS) {
    applySourceBusAutomation(nodes[effect].gain, sends[effect], at, mode, now);
  }
}
```

- [ ] **Step 5:** `bun test src/audio/sourceSends.test.ts` → PASS. `bun run lint` → clean. `bun run eslint` → zero errors, zero warnings. `bun run check:dead-code` → clean. `bun run check:dead-code:production` → **one expected finding**: `src/audio/sourceSends.ts` is an unused file until Task 2 imports it from `masterRack.ts`. No other finding is acceptable.
- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/audio/sourceSends.ts src/audio/sourceSends.test.ts
git commit -m "feat(audio): send types and per-source send node helpers (DEV-423)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: MasterRack routing — every bus sends through its own nodes; Beat reverb in series; `setSourceSends`

**Files:**
- Modify: `src/audio/masterRack.ts` (the `SOURCES_WITHOUT_MASTER_SENDS` constant and its docblock; the `drumSendGate` field docblock; the `sourceBuses`/`sourceGains` field block; `dispose`; `createSendGates` comment; `setupMasterChain`; `updateReverbSend`; `getSourceBus`; after `setSourceState`)
- Modify: `src/audio/engine.ts` (next to `setSourceState`), `src/types.ts` (`reverbSend` docblocks), `src/audio/playback/presetPreview.ts`
- Modify tests: `src/audio/masterRack.sendGates.test.ts`, `src/audio/masterRack.sourceBus.test.ts`, `src/audio/playback/presetPreview.test.ts`, `src/audio/drumSynth.test.ts` (comment only)
- Create: `src/audio/masterRack.beatSends.render.test.ts`

**Interfaces:**
- Consumes (Task 1): `SourceSendNodes`, `clampSendLevels`, `createSourceSendNodes`, `applySourceSendLevels`; `TrackSendLevels`.
- Produces:

```ts
// MasterRack
setSourceSends(source: string, sends: TrackSendLevels, time?: number, mode: SourceBusApplyMode = 'transition'): void;
// private: sourceSendNodes: Map<string, SourceSendNodes>; sourceSends: Map<string, TrackSendLevels>;
// private: sendNodesFor(source: string): SourceSendNodes; beatReverbFeed(): GainNode | null
// AudioEngine
setSourceSends(source: string, sends: TrackSendLevels, time?: number, mode?: SourceBusApplyMode): void;
```
  `getSourceBus(source)` now throws `'send gates not initialized'` when a gate is missing.

- [ ] **Step 1: Failing routing tests.** In `src/audio/masterRack.sendGates.test.ts`:
  - Replace the test `'every source bus connects to the send gates, never straight to the effect nodes'` with:

```ts
  test('every bus reaches the gates only through its own send nodes, never straight to a gate or an effect node', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    const rack = (engine as any).masterRack;
    const direct = [
      rack.reverbSendGate, rack.delaySendGate, rack.distortionSendGate,
      rack.reverbNode, rack.delayNode, rack.distortionNode,
    ];

    for (const source of ['synth', 'chord', 'bass', 'pad', 'fx', 'sequencer']) {
      const bus = rack.getSourceBus(source);
      for (const node of direct) expect(bus._connectTargets).not.toContain(node);
      const sends = rack.sourceSendNodes.get(source);
      expect(sends.delay._connectTargets).toEqual([rack.delaySendGate]);
      expect(sends.distortion._connectTargets).toEqual([rack.distortionSendGate]);
    }
    for (const source of ['synth', 'chord', 'bass', 'pad', 'fx']) {
      const sends = rack.sourceSendNodes.get(source);
      expect(rack.getSourceBus(source)._connectTargets)
        .toEqual([rack.dryGain, sends.delay, sends.reverb, sends.distortion]);
      expect(sends.reverb._connectTargets).toEqual([rack.reverbSendGate]);
    }
  });
```
  - Replace the whole `describe('the Beat bus never feeds the generic master sends', …)` block (and its docblock) with:

```ts
/**
 * DEV-423: the Beat (`sequencer`) bus is an ordinary track for delay and
 * distortion — its own send nodes feed those two gates — but it has NO
 * bus→reverb edge. Drum reverb stays the per-voice path through
 * `drumSendGate`, in series with the Beat track's reverb send (R304).
 */
describe('the Beat bus sends to delay and distortion, never from the bus to reverb', () => {
  function assertBeatBusSends(rack: any) {
    const bus = rack.getSourceBus('sequencer');
    const sends = rack.sourceSendNodes.get('sequencer');
    expect(bus._connectTargets).toEqual([rack.dryGain, sends.delay, sends.distortion]);
    expect(bus._connectTargets).not.toContain(sends.reverb);
    expect(bus._connectTargets).not.toContain(rack.reverbSendGate);
    expect(sends.delay._connectTargets).toEqual([rack.delaySendGate]);
    expect(sends.distortion._connectTargets).toEqual([rack.distortionSendGate]);
  }

  /** Drop the bus setupMasterChain built, so the next lookup builds it with every gate present. */
  function rebuildBeatBus(rack: any) {
    rack.sourceBuses.delete('sequencer');
    rack.sourceTaps.delete('sequencer');
    rack.sourceSendNodes.delete('sequencer');
    rack.getSourceTap('sequencer');
  }

  test('as built by setupMasterChain', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    assertBeatBusSends((engine as any).masterRack);
  });

  test('live engine: a Beat bus created later is wired the same way', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    const rack = (engine as any).masterRack;
    rebuildBeatBus(rack);
    assertBeatBusSends(rack);
  });

  test('render engine: a Beat bus created later is wired the same way', () => {
    const engine = createRenderEngine(masterChainCtx() as unknown as BaseAudioContext);
    const rack = (engine as any).masterRack;
    rebuildBeatBus(rack);
    assertBeatBusSends(rack);
  });

  test('getSourceBus requires the send gates', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    const rack = (engine as any).masterRack;
    rack.sourceBuses.delete('chord');
    rack.delaySendGate = null;
    expect(() => rack.getSourceBus('chord')).toThrow('send gates not initialized');
  });
});
```
  - In the last `describe('the drum reverb send shares the reverb tail gate, not a permanent connection', …)`: rename it `'the Beat reverb feed shares the reverb tail gate, not a permanent connection'`; replace its first test with the two below; in the other three tests replace every `(engine as any).masterRack.drumSendGate` with `(engine as any).masterRack.sourceSendNodes.get('sequencer').reverb` (rename the local `drumGate` → `beatFeed`), and at the end of the final test add `expect((engine as any).masterRack.drumSendGate._connectTargets).toEqual([beatFeed]);` (the permanent edge survives the tail disconnect).

```ts
  test('the Beat reverb feed is drumSendGate → the Beat track reverb send → convolver', () => {
    const engine = makeEngine();
    bindFakeCtx(engine, masterChainCtx());
    const rack = (engine as any).masterRack;
    const beatFeed = rack.sourceSendNodes.get('sequencer').reverb;
    expect(rack.drumSendGate._connectTargets).toEqual([beatFeed]);
    expect(beatFeed._connectTargets).toEqual([rack.reverbNode]);
  });

  test('C1: the convolver is fed reverbSendGate first, then the Beat reverb feed', () => {
    const ctx: any = masterChainCtx();
    const log: { from: unknown; to: unknown }[] = [];
    const createGain = ctx.createGain;
    ctx.createGain = () => {
      const node = createGain();
      const connect = node.connect;
      node.connect = (to: unknown) => {
        log.push({ from: node, to });
        connect(to);
      };
      return node;
    };
    const engine = makeEngine();
    bindFakeCtx(engine, ctx);
    const rack = (engine as any).masterRack;
    const feeds = log.filter((entry) => entry.to === rack.reverbNode).map((entry) => entry.from);
    expect(feeds).toEqual([rack.reverbSendGate, rack.sourceSendNodes.get('sequencer').reverb]);
  });
```
  - Update the file's header docblock sentence "Covers the send gates that sit between every source bus (getSourceBus) and …" to "Covers each source bus's own send nodes (getSourceBus), the send gates they feed, and …".

- [ ] **Step 2: Failing send-level tests.** In `src/audio/masterRack.sourceBus.test.ts` add `import { MasterRack } from './masterRack';` and append:

```ts
function builtRack() {
  const engine = makeEngine();
  const ctx = masterChainCtx();
  bindFakeCtx(engine, ctx);
  return { engine, ctx, rack: (engine as any).masterRack };
}

/** Everything a param has been told, so "never touched" is one comparison. */
function automationOf(node: any): string {
  return JSON.stringify([node.gain.cancels, node.gain.events, node.gain.targets]);
}

describe('source send levels', () => {
  test('setSourceSends clamps, remembers and settles all three send nodes', () => {
    const { rack } = builtRack();
    rack.setSourceSends('chord', { reverb: 1.7, delay: -0.2, distortion: Number.NaN }, 10, 'settle');
    expect(rack.sourceSends.get('chord')).toEqual({ reverb: 1, delay: 0, distortion: 0 });
    const sends = rack.sourceSendNodes.get('chord');
    expect(sends.reverb.gain.events.at(-1)).toEqual({ kind: 'set', v: 1, t: 10 });
    expect(sends.delay.gain.events.at(-1)).toEqual({ kind: 'set', v: 0, t: 10 });
    expect(sends.distortion.gain.events.at(-1)).toEqual({ kind: 'set', v: 0, t: 10 });
  });

  test('a future send change transitions at the boundary, through the engine facade', () => {
    const { engine, ctx, rack } = builtRack();
    const boundary = ctx.currentTime + 0.075;
    engine.setSourceSends('bass', { reverb: 0.5, delay: 0.25, distortion: 0 }, boundary);
    const sends = rack.sourceSendNodes.get('bass');
    expect(sends.reverb.gain.targets.at(-1)).toEqual({ v: 0.5, t: boundary, tc: 0.01 });
    expect(sends.delay.gain.targets.at(-1)).toEqual({ v: 0.25, t: boundary, tc: 0.01 });
  });

  test('a send with no level received is seeded silent', () => {
    const { rack } = builtRack();
    rack.getSourceBus('pad');
    const sends = rack.sourceSendNodes.get('pad');
    expect([sends.reverb.gain.value, sends.delay.gain.value, sends.distortion.gain.value]).toEqual([0, 0, 0]);
  });

  test('levels received before init are kept and seed the lazily built nodes', () => {
    const rack: any = new MasterRack();
    rack.setSourceSends('pad', { reverb: 0.3, delay: 0.4, distortion: 0.5 });
    expect(rack.sourceSends.get('pad')).toEqual({ reverb: 0.3, delay: 0.4, distortion: 0.5 });
    rack.bind(masterChainCtx() as unknown as BaseAudioContext);
    rack.setupMasterChain();
    rack.getSourceBus('pad');
    const sends = rack.sourceSendNodes.get('pad');
    expect([sends.reverb.gain.value, sends.delay.gain.value, sends.distortion.gain.value]).toEqual([0.3, 0.4, 0.5]);
  });

  test('setSourceState never touches a send node; setSourceSends never touches the bus or drumSendGate', () => {
    const { rack } = builtRack();
    const bus = rack.getSourceBus('sequencer');
    const sends = rack.sourceSendNodes.get('sequencer');
    const sendNodes = [sends.reverb, sends.delay, sends.distortion];
    const sendsBefore = sendNodes.map(automationOf);
    rack.setSourceState('sequencer', { gain: 0.5, muted: false }, 10, 'settle');
    expect(sendNodes.map(automationOf)).toEqual(sendsBefore);

    const busBefore = [automationOf(bus), automationOf(rack.drumSendGate)];
    rack.setSourceSends('sequencer', { reverb: 0.5, delay: 0.5, distortion: 0.5 }, 10, 'settle');
    expect([automationOf(bus), automationOf(rack.drumSendGate)]).toEqual(busBefore);
  });

  test('dispose releases every send node and forgets every level', () => {
    const { ctx, rack } = builtRack();
    rack.setSourceSends('fx', { reverb: 1, delay: 1, distortion: 1 }, 10, 'settle');
    const sends = rack.sourceSendNodes.get('fx');
    rack.dispose(ctx.currentTime);
    expect(rack.sourceSendNodes.size).toBe(0);
    expect(rack.sourceSends.size).toBe(0);
    expect(sends.reverb._connectTargets).toEqual([]);
  });
});
```

- [ ] **Step 3: Failing preview test.** In `src/audio/playback/presetPreview.test.ts` append:

```ts
describe('the audition bus and the master sends', () => {
  test('an audition feeds all three master effects at unity, as before DEV-423 (preview is not a track)', () => {
    const fake = withFakeAudioEngine();
    const setSourceSends = spyOn(audioEngine, 'setSourceSends');
    try {
      const stop = previewSynthPatch(SYNTH);
      expect(setSourceSends).toHaveBeenCalledWith('preview', { reverb: 1, delay: 1, distortion: 1 });
      stop();
    } finally {
      setSourceSends.mockRestore();
      fake.restore();
    }
  });
});
```

- [ ] **Step 4: Failing render test.** Create `src/audio/masterRack.beatSends.render.test.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any -- node-web-audio-api's
   context is cast at the seam, and the dry bus is a private rack field. */
import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { createRenderEngine } from './engine';
import { BEAT_PRESETS } from '@/data/beatPresets';
import { FACTORY_EFFECTS } from './export/mixdownFixture';
import type { TrackSendLevels } from '@/types';

/**
 * One snare (voice reverbSend 0.5) through a real render engine with the DRY
 * path muted, so the output is the effect returns alone. `wet` picks which
 * return is audible; distortion is always off.
 */
async function effectPeak(beat: TrackSendLevels, wet: { reverbWet: number; delayWet: number }): Promise<number> {
  const ctx: any = new OfflineAudioContext(2, Math.round(44100 * 0.6), 44100);
  const engine = createRenderEngine(ctx);
  const voices = structuredClone(BEAT_PRESETS[0].patch.voices);
  voices.snare.reverbSend = 0.5;
  engine.setDrumKit(voices, 0);
  engine.setMasterVolume(1);
  engine.updateEffects({ ...FACTORY_EFFECTS, ...wet, distortionWet: 0 });
  engine.setSourceSends('sequencer', beat, 0, 'settle');
  (engine as any).masterRack.dryGain.gain.value = 0;
  engine.triggerDrum('snare', 1, 0);
  const buffer: any = await ctx.startRendering();
  const data: Float32Array = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  return peak;
}

const REVERB_ONLY = { reverbWet: 1, delayWet: 0 };
const DELAY_ONLY = { reverbWet: 0, delayWet: 1 };

describe('Beat through the per-track sends (render engine)', () => {
  test('the voice reverbSend multiplies the Beat reverb send: send 0 leaves the reverb silent', async () => {
    expect(await effectPeak({ reverb: 0, delay: 0, distortion: 0 }, REVERB_ONLY)).toBeLessThan(1e-7);
    expect(await effectPeak({ reverb: 1, delay: 0, distortion: 0 }, REVERB_ONLY)).toBeGreaterThan(0);
  });

  test('the Beat delay send puts the kit on the delay return; 0 leaves it silent', async () => {
    expect(await effectPeak({ reverb: 0, delay: 1, distortion: 0 }, DELAY_ONLY)).toBeGreaterThan(0);
    expect(await effectPeak({ reverb: 0, delay: 0, distortion: 0 }, DELAY_ONLY)).toBeLessThan(1e-7);
  });
});
```

- [ ] **Step 5:** `bun test src/audio/masterRack.sendGates.test.ts src/audio/masterRack.sourceBus.test.ts src/audio/playback/presetPreview.test.ts src/audio/masterRack.beatSends.render.test.ts` → FAIL (`sourceSendNodes` undefined, `setSourceSends` not a function).
- [ ] **Step 6: `masterRack.ts` — constant, fields, imports.**
  - Add `import { applySourceSendLevels, clampSendLevels, createSourceSendNodes, type SourceSendNodes } from './sourceSends';` and extend the `../types` import with `type TrackSendLevels`.
  - Replace `SOURCES_WITHOUT_MASTER_SENDS` and its docblock with:

```ts
/**
 * The Beat bus's engine name. It is an ordinary track for delay and
 * distortion, but it has NO bus→reverb send: drum reverb is the per-voice
 * `reverbSend` → `drumSendGate` path, in series with the Beat track's own
 * reverb send node (R304, DEV-423). `getSourceBus` skips only that one edge.
 */
const BEAT_BUS_SOURCE = 'sequencer';
```
  - In the `drumSendGate` field docblock, replace "Drum sends do not use getSourceBus('sequencer'): that bus feeds the dry path only (it is in SOURCES_WITHOUT_MASTER_SENDS), while these sends must reach reverb." with "Drum reverb does not come from the sequencer bus (that bus has no reverb edge, R304); it runs voice sends → `drumSendFilter` → this gate → the Beat track's reverb send node → convolver."
  - After `private sourceGains = new Map<string, number>();` add:

```ts
  /** Each source's three send nodes, built with its bus in getSourceBus; cleared with sourceBuses. */
  private sourceSendNodes = new Map<string, SourceSendNodes>();
  /** Last send levels per source — survives pre-init like sourceGains, and seeds lazily built nodes. */
  private sourceSends = new Map<string, TrackSendLevels>();
```
  - In `dispose`, after the `for (const node of this.sourceBuses.values()) this.release(node);` line add `for (const sends of this.sourceSendNodes.values()) this.release(sends.reverb, sends.delay, sends.distortion);`, and next to `this.sourceBuses.clear();` add `this.sourceSendNodes.clear();` and next to `this.sourceGains.clear();` add `this.sourceSends.clear();`.
  - In `createSendGates`, replace the comment "Send gates: every source bus except SOURCES_WITHOUT_MASTER_SENDS connects here (getSourceBus), never straight to the effect node." with "Send gates: every source bus's own send nodes connect here (getSourceBus), never the bus itself and never straight to the effect node."
- [ ] **Step 7: `setupMasterChain`.** Next to `this.sourceBuses.clear();` at the top add `this.sourceSendNodes.clear();`. Replace the block from `// Drum bus filter — routed through the sequencer source bus …` down to (and including) the `const { reverbSendGate, delaySendGate, distortionSendGate } = this.createSendGates();` line with:

```ts
    // The send gates exist BEFORE any source bus: getSourceBus wires each
    // bus's send nodes into them and throws without them (DEV-423).
    const { reverbSendGate, delaySendGate, distortionSendGate } = this.createSendGates();

    // Drum bus filter — routed through the sequencer source bus for volume and
    // mute control. That bus feeds the dry path and, through its own send
    // nodes, the delay and distortion gates; never the reverb gate (R304).
    const busBank = this.buildBeatFilterBank(this.getSourceTap(BEAT_BUS_SOURCE));
    this.drumBusFilter = busBank.input;
    this.drumBusFilterLanes = busBank.lanes;

    // Same settings, wired to the reverb only: drumSendGate, then the Beat
    // track's reverb send node in series — the per-voice reverbSend is a
    // multiplier of the track send (R305). A permanent edge.
    this.drumSendGate = this.ctx.createGain();
    this.drumSendGate.connect(this.sendNodesFor(BEAT_BUS_SOURCE).reverb);
    const sendBank = this.buildBeatFilterBank(this.drumSendGate);
    this.drumSendFilter = sendBank.input;
    this.drumSendFilterLanes = sendBank.lanes;
    // getSourceTap('sequencer') above has already created and seeded the dry
    // bus from sourceGains/sourceMuted. Copy that exact source level so a
    // pre-init snapshot starts both branches in the same state.
    this.drumSendGate.gain.value = this.getSourceBus(BEAT_BUS_SOURCE).gain.value;

    // Every wet send and EQ gain is seeded at ZERO. The audible defaults are
    // INITIAL_EFFECTS and arrive through applyEngineSnapshot() on the first
    // user click; seeding a second set here was a second source of truth that
    // already disagreed with initialState.ts (distortionWet 0.1 vs 0.0, eqLow
    // 2 vs 0, eqHigh 3 vs 0) and was silently overwritten anyway.
```
  (the `// Dry bus` lines above stay; `createSendGates` needs no node built after it). In the Reverb section replace

```ts
    this.drumSendGate.connect(this.reverbNode);
    this.drumSendReverbConnected = true;
```
  with

```ts
    // The SECOND convolver input, connected after reverbSendGate (C1): the
    // sum order is part of the byte-identical golden.
    this.sendNodesFor(BEAT_BUS_SOURCE).reverb.connect(this.reverbNode);
    this.drumSendReverbConnected = true;
```
  and reword the comment above it ("Gate BEFORE the convolver: …") to name "the Beat reverb send" instead of `drumSendGate` where it refers to the convolver edge.
- [ ] **Step 8: `updateReverbSend`.** Add, directly above `updateReverbSend`:

```ts
  /** The convolver's second feed: the Beat track's reverb send node (C1, R304). */
  private beatReverbFeed(): GainNode | null {
    return this.sourceSendNodes.get(BEAT_BUS_SOURCE)?.reverb ?? null;
  }
```
  In `updateReverbSend` replace the connect branch `if (this.drumSendGate && !this.drumSendReverbConnected) { this.drumSendGate.connect(this.reverbNode); … }` with

```ts
      const beatFeed = this.beatReverbFeed();
      if (beatFeed && !this.drumSendReverbConnected) {
        beatFeed.connect(this.reverbNode);
        this.drumSendReverbConnected = true;
      }
```
  and in the timer callback replace `if (this.drumSendGate && this.reverbNode) this.drumSendGate.disconnect(this.reverbNode);` with

```ts
      const beatFeed = this.beatReverbFeed();
      if (beatFeed && this.reverbNode) beatFeed.disconnect(this.reverbNode);
```
  In its docblock replace "and `drumSendGate` (the authored per-voice drum reverb send, which has no bypass of its own)" with "and the Beat track's reverb send node (fed by `drumSendGate`, the authored per-voice drum reverb send, which has no bypass of its own)"; keep the rest.
- [ ] **Step 9: `getSourceBus`, `sendNodesFor`, `setSourceSends`.** Replace the comment above `getSourceBus` and its body with:

```ts
  // Lazily create (and cache) the gain bus for a source: dry always, plus its
  // own three send nodes, taken after the fader and mute, into the delay,
  // reverb and distortion gates (R303). The Beat bus alone has no reverb edge
  // (R304): its reverb node is fed by drumSendGate in setupMasterChain. The
  // gates must exist first — a missing gate is a construction-order bug.
  getSourceBus(source: string): GainNode {
    if (!this.ctx || !this.dryGain) throw new Error('AudioContext not initialized');
    let bus = this.sourceBuses.get(source);
    if (!bus) {
      const { delaySendGate, reverbSendGate, distortionSendGate } = this;
      if (!delaySendGate || !reverbSendGate || !distortionSendGate) {
        throw new Error('send gates not initialized');
      }
      bus = this.ctx.createGain();
      const baseGain = this.sourceGains.get(source) ?? 1;
      bus.gain.value = this.sourceMuted.get(source) ? 0 : baseGain;
      bus.connect(this.dryGain);
      const sends = createSourceSendNodes(this.ctx, this.sourceSends.get(source));
      // Gate order as before DEV-423: delay, reverb, distortion.
      bus.connect(sends.delay);
      sends.delay.connect(delaySendGate);
      if (source !== BEAT_BUS_SOURCE) {
        bus.connect(sends.reverb);
        sends.reverb.connect(reverbSendGate);
      }
      bus.connect(sends.distortion);
      sends.distortion.connect(distortionSendGate);
      this.sourceSendNodes.set(source, sends);
      this.sourceBuses.set(source, bus);
    }
    return bus;
  }

  /** A source's three send nodes, building its bus (and them) on first use. */
  private sendNodesFor(source: string): SourceSendNodes {
    this.getSourceBus(source);
    return this.sourceSendNodes.get(source) as SourceSendNodes;
  }
```
  Directly after `setSourceState` add:

```ts
  /**
   * A track's three send levels (linear 0..1). Its own method, never folded
   * into setSourceState (C2): the golden call log pins setSourceState's calls.
   * Writes only the send nodes — the bus and drumSendGate stay owned by the
   * level/mute path (applySourceLevel).
   */
  setSourceSends(
    source: string,
    sends: TrackSendLevels,
    time?: number,
    mode: SourceBusApplyMode = 'transition',
  ): void {
    const levels = clampSendLevels(sends);
    this.sourceSends.set(source, levels);
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const at = Math.max(time ?? now, now);
    applySourceSendLevels(this.sendNodesFor(source), levels, at, mode, now);
  }
```
- [ ] **Step 10: Engine, preview, docblocks.**
  - `src/audio/engine.ts`: extend the `../types` import with `type TrackSendLevels`; after `setSourceState(...)` add:

```ts
  setSourceSends(
    source: string,
    sends: TrackSendLevels,
    time?: number,
    mode?: SourceBusApplyMode,
  ): void {
    this.session?.masterRack.setSourceSends(source, sends, time, mode);
  }
```
  - `src/audio/playback/presetPreview.ts`: add `import type { TrackSendLevels } from '@/types';` (merge with the existing `@/types` type import), and below `const PREVIEW_SOURCE = 'preview';` add:

```ts
/**
 * The audition bus's master sends: unity into all three effects, exactly what
 * every bus had before DEV-423. `'preview'` is not a track — no store row
 * drives it — so it is told its levels here; an untold send is silent.
 */
const PREVIEW_SENDS: TrackSendLevels = { reverb: 1, delay: 1, distortion: 1 };
```
  and make `beginPreview` call `audioEngine.setSourceSends(PREVIEW_SOURCE, PREVIEW_SENDS);` as its first statement.
  - `src/types.ts`: replace the kick docblock `/** Level into the drum reverb send, 0..1. The BODY only — the click stays dry. */` with `/** 0..1, a MULTIPLIER of the Beat track's reverb send — not a direct send to the master reverb (DEV-423). The BODY only — the click stays dry. */`, and add `/** 0..1, a multiplier of the Beat track's reverb send (DEV-423). */` directly above the `reverbSend: number;` field of `BeatSnareParams`, `BeatClapParams`, `BeatTomParams`, `BeatRideParams`, `BeatCrashParams` and `BeatBellParams`.
  - `src/audio/drumSynth.test.ts`: in `'the open hat has no voice-level delay tap …'` replace the comment "The Beat bus is kept off the master delay/distortion sends by name in getSourceBus; masterRack.sendGates.test.ts pins that." with "The Beat bus reaches the delay only through its own send node (DEV-423); masterRack.sendGates.test.ts pins that."
  - `grep -n "SOURCES_WITHOUT_MASTER_SENDS" -r src` → no hit.
- [ ] **Step 11:** `bun test src/audio` → PASS (this includes `renderMixdownGolden.test.ts`: **run the golden, expect PASS unchanged**). `git status --short src/audio/export/renderMixdownGolden*` → empty. If the golden fails, stop: re-check C1 (feed order), the gate connection order in `getSourceBus`, and that every send seeds and settles exactly as specified — never touch the golden files.
- [ ] **Step 12:** `bun run lint` → clean; `bun run eslint` → zero errors, zero warnings (check `setupMasterChain` stays under `max-lines-per-function`); `bun run check:dead-code && bun run check:dead-code:production` → clean.
- [ ] **Step 13: Commit**

```bash
git add src/audio/masterRack.ts src/audio/engine.ts src/types.ts src/audio/playback/presetPreview.ts \
  src/audio/masterRack.sendGates.test.ts src/audio/masterRack.sourceBus.test.ts \
  src/audio/playback/presetPreview.test.ts src/audio/drumSynth.test.ts src/audio/masterRack.beatSends.render.test.ts
git commit -m "feat(audio): route every bus through its own send nodes; Beat delay/distortion sends (DEV-423)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Per-loop `trackSends` — field, defaults, copy group, slice, validation

**Files:**
- Modify: `src/types.ts` (after `TrackSendLevels`), `src/store/types.ts` (`Loop`, `AppStore`, imports), `src/store/loop.ts` (`LOOP_FLAT_KEYS`), `src/store/loopDefaults.ts`, `src/store/loopCopy.ts` (`mix` group), `src/store/store.ts` (slice composition), `src/store/sanitize.ts` (`sanitizeLoops` + new functions)
- Create: `src/store/trackSendsSlice.ts`, `src/store/trackSendsSlice.test.ts`, `src/store/sourceBuses.test.ts`, `src/store/sanitizeTrackSends.test.ts`

**Interfaces:**
- Consumes: `clampSendLevels` (Task 1), `SEND_EFFECTS`, `TrackSendLevels`; `clampFinite`, `isPlainObject` (`sanitize.ts`); `SourceBusId` (`sourceBuses.ts`).
- Produces:

```ts
// src/types.ts
export interface TrackSends { synth: TrackSendLevels; chord: TrackSendLevels; bass: TrackSendLevels; pad: TrackSendLevels; fx: TrackSendLevels; sequencer: TrackSendLevels }
// src/store/trackSendsSlice.ts
export interface TrackSendsSlice {
  trackSends: TrackSends;
  setTrackSends: (source: SourceBusId, sends: TrackSendLevels) => void;
}
export function createTrackSendsSlice(set: StoreApi<AppStore>['setState'], defaults: LoopContent): TrackSendsSlice;
// src/store/sanitize.ts
export function sanitizeTrackSends(value: unknown, fallback: TrackSends): TrackSends;
```
  `Loop.trackSends: TrackSends`; `'trackSends'` is the last entry of `LOOP_FLAT_KEYS`; `AppStore extends … TrackSendsSlice`.

- [ ] **Step 1: Failing tests.**
  - `src/store/sourceBuses.test.ts`:

```ts
import { expect, test } from 'bun:test';
import type { TrackSends } from '@/types';
import type { SourceBusId } from './sourceBuses';

test('TrackSends is keyed by exactly the SOURCE_BUSES engine source ids (compile-time)', () => {
  // `bun run lint` (tsc) fails an assignment below if the two key sets drift.
  const noExtraKey: [Exclude<keyof TrackSends, SourceBusId>] extends [never] ? true : false = true;
  const noMissingKey: [Exclude<SourceBusId, keyof TrackSends>] extends [never] ? true : false = true;
  expect([noExtraKey, noMissingKey]).toEqual([true, true]);
});
```
  - `src/store/trackSendsSlice.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { createDefaultLoopContent } from './loopDefaults';

const initial = useAppStore.getState();

afterEach(() => {
  useAppStore.setState({
    trackSends: initial.trackSends,
    loops: initial.loops,
    activeLoopId: initial.activeLoopId,
  });
});

describe('trackSends defaults', () => {
  test('every track sends at unity except Beat, dry into delay and distortion; fresh per call', () => {
    const a = createDefaultLoopContent().trackSends;
    const b = createDefaultLoopContent().trackSends;
    const unity = { reverb: 1, delay: 1, distortion: 1 };
    expect(a).toEqual({
      synth: unity, chord: unity, bass: unity, pad: unity, fx: unity,
      sequencer: { reverb: 1, delay: 0, distortion: 0 },
    });
    expect(a).not.toBe(b);
    expect(a.synth).not.toBe(b.synth);
  });
});

describe('setTrackSends', () => {
  test('writes one clamped row and keeps the other five rows by reference', () => {
    const before = useAppStore.getState().trackSends;
    useAppStore.getState().setTrackSends('chord', { reverb: 0.4, delay: 1.5, distortion: -1 });
    const after = useAppStore.getState().trackSends;
    expect(after).not.toBe(before);
    expect(after.chord).toEqual({ reverb: 0.4, delay: 1, distortion: 0 });
    for (const source of ['synth', 'bass', 'pad', 'fx', 'sequencer'] as const) {
      expect(after[source]).toBe(before[source]);
    }
  });

  test('the loop mirror carries the write into the active loop', () => {
    useAppStore.getState().setTrackSends('pad', { reverb: 0.2, delay: 0.3, distortion: 0.4 });
    const s = useAppStore.getState();
    const active = s.loops.find((loop) => loop.id === s.activeLoopId);
    expect(active?.trackSends.pad).toEqual({ reverb: 0.2, delay: 0.3, distortion: 0.4 });
  });

  test('duplicating a loop deep-copies its sends', () => {
    useAppStore.getState().setTrackSends('fx', { reverb: 0.5, delay: 0.5, distortion: 0.5 });
    const sourceId = useAppStore.getState().activeLoopId;
    const copyId = useAppStore.getState().duplicateLoop(sourceId);
    const loops = useAppStore.getState().loops;
    const source = loops.find((loop) => loop.id === sourceId);
    const copy = loops.find((loop) => loop.id === copyId);
    expect(copy?.trackSends).toEqual(source?.trackSends);
    expect(copy?.trackSends).not.toBe(source?.trackSends);
    expect(copy?.trackSends.fx).not.toBe(source?.trackSends.fx);
  });
});
```
  - `src/store/sanitizeTrackSends.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createDefaultLoopContent } from './loopDefaults';
import { createDefaultLoop } from './loopSlice';
import { sanitizeLoops, sanitizeTrackSends } from './sanitize';

const defaults = () => createDefaultLoopContent().trackSends;
const SOURCES = ['synth', 'chord', 'bass', 'pad', 'fx', 'sequencer'] as const;

describe('sanitizeTrackSends', () => {
  test('a value that is not a plain object takes the whole default', () => {
    for (const bad of [undefined, null, 7, 'loud', []]) {
      expect(sanitizeTrackSends(bad, defaults())).toEqual(defaults());
    }
  });

  test('a bad row takes that row default; the other rows survive', () => {
    const synth = { reverb: 0.3, delay: 0.4, distortion: 0.5 };
    const out = sanitizeTrackSends({ ...defaults(), chord: 'loud', synth }, defaults());
    expect(out.chord).toEqual(defaults().chord);
    expect(out.synth).toEqual(synth);
  });

  test('a non-number or non-finite level takes that effect default; out of range clamps', () => {
    const out = sanitizeTrackSends({
      ...defaults(),
      bass: { reverb: Number.NaN, delay: '0.5', distortion: 0.25 },
      pad: { reverb: 1.7, delay: -0.2, distortion: 0 },
    }, defaults());
    expect(out.bass).toEqual({ reverb: 1, delay: 1, distortion: 0.25 });
    expect(out.pad).toEqual({ reverb: 1, delay: 0, distortion: 0 });
  });

  test('unknown sources and unknown effect keys are dropped', () => {
    const out = sanitizeTrackSends({
      ...defaults(),
      drum: { reverb: 0 },
      fx: { reverb: 0.5, delay: 0.5, distortion: 0.5, chorus: 1 },
    }, defaults());
    expect(Object.keys(out).sort()).toEqual([...SOURCES].sort());
    expect(out.fx).toEqual({ reverb: 0.5, delay: 0.5, distortion: 0.5 });
  });

  test('the result shares no reference with the input or the fallback', () => {
    const raw = defaults();
    const fallback = defaults();
    const out = sanitizeTrackSends(raw, fallback);
    expect(out).toEqual(raw);
    for (const container of [raw, fallback]) {
      expect(out).not.toBe(container);
      for (const source of SOURCES) expect(out[source]).not.toBe(container[source]);
    }
    const whole = sanitizeTrackSends(undefined, fallback);
    expect(whole).not.toBe(fallback);
    expect(whole.synth).not.toBe(fallback.synth);
  });
});

describe('sanitizeLoops reads trackSends', () => {
  test('a loop saved before DEV-423 reads back with the defaults: Beat dry into delay and distortion', () => {
    const legacy: Record<string, unknown> = { ...createDefaultLoop() };
    delete legacy.trackSends;
    const [out] = sanitizeLoops([legacy]) ?? [];
    expect(out?.trackSends).toEqual(defaults());
    expect(out?.trackSends.sequencer).toEqual({ reverb: 1, delay: 0, distortion: 0 });
  });

  test('a stored value survives the read', () => {
    const stored = { ...defaults(), bass: { reverb: 0.1, delay: 0.2, distortion: 0.3 } };
    const [out] = sanitizeLoops([{ ...createDefaultLoop(), trackSends: stored }]) ?? [];
    expect(out?.trackSends).toEqual(stored);
  });
});
```
- [ ] **Step 2:** `bun test src/store/sourceBuses.test.ts src/store/trackSendsSlice.test.ts src/store/sanitizeTrackSends.test.ts` → FAIL (`trackSends` missing, `sanitizeTrackSends` not exported, `setTrackSends` not a function).
- [ ] **Step 3: Type.** In `src/types.ts`, after `TrackSendLevels`, add:

```ts
/** Every track's sends, keyed by engine source id (the `SOURCE_BUSES` `source` column). */
export interface TrackSends {
  synth: TrackSendLevels;
  chord: TrackSendLevels;
  bass: TrackSendLevels;
  pad: TrackSendLevels;
  fx: TrackSendLevels;
  sequencer: TrackSendLevels;
}
```
- [ ] **Step 4: Loop field, key list, defaults, copy group.**
  - `src/store/types.ts`: add `TrackSends` to the `import type { … } from '../types';` block; in `interface Loop`, after `bassMuted: boolean;` add

```ts
  /** Per-track sends into the shared master reverb/delay/distortion, keyed by
   *  engine source id; LINEAR 0..1, taken after the fader and mute (DEV-423). */
  trackSends: TrackSends;
```
  add `import type { TrackSendsSlice } from './trackSendsSlice';` beside the `ExportSlice` import and `TrackSendsSlice,` to `AppStore`'s `extends` list after `BeatSlice,`.
  - `src/store/loop.ts`: append `'trackSends',` after `'fxMuted',` in `LOOP_FLAT_KEYS`.
  - `src/store/loopDefaults.ts`: after `bassMuted: false,` add

```ts
    // Per-track master sends, LINEAR 0..1 (DEV-423). The one place these
    // defaults are written: the sanitizer falls back to createDefaultLoop()
    // and the slice starts from `defaults`.
    trackSends: {
      synth: { reverb: 1, delay: 1, distortion: 1 },
      chord: { reverb: 1, delay: 1, distortion: 1 },
      bass: { reverb: 1, delay: 1, distortion: 1 },
      pad: { reverb: 1, delay: 1, distortion: 1 },
      fx: { reverb: 1, delay: 1, distortion: 1 },
      // Beat was dry into delay and distortion before DEV-423; reverb 1 keeps its
      // per-voice reverbSend path at exactly today's level.
      sequencer: { reverb: 1, delay: 0, distortion: 0 },
    },
```
  - `src/store/loopCopy.ts`: in the `mix` group's `keys`, append `'trackSends',` after `'beatMix',`.
- [ ] **Step 5: Slice.** Create `src/store/trackSendsSlice.ts`:

```ts
import type { StoreApi } from 'zustand';
import { clampSendLevels } from '@/audio/sourceSends';
import type { TrackSendLevels, TrackSends } from '@/types';
import type { LoopContent } from './loop';
import type { SourceBusId } from './sourceBuses';
import type { AppStore } from './types';

type Set = StoreApi<AppStore>['setState'];

export interface TrackSendsSlice {
  /** Per-loop: the loop mirror carries it into `loops[active]` (LOOP_FLAT_KEYS). */
  trackSends: TrackSends;
  /** Replace one track's three levels (clamped 0..1). Writes only that track's row. */
  setTrackSends: (source: SourceBusId, sends: TrackSendLevels) => void;
}

/**
 * The per-track master sends (DEV-423). A new outer object and a new row per
 * write, so the other five rows keep their references (R210) and each
 * engineSync subscription fires only for the row that moved. Written once per
 * knob gesture, on release (`useTrackSendsDraft`), never mid-drag (R016).
 */
export function createTrackSendsSlice(set: Set, defaults: LoopContent): TrackSendsSlice {
  return {
    trackSends: defaults.trackSends,
    setTrackSends: (source, sends) =>
      set((state) => ({ trackSends: { ...state.trackSends, [source]: clampSendLevels(sends) } })),
  };
}
```
  In `src/store/store.ts` add `import { createTrackSendsSlice } from './trackSendsSlice';` beside the other slice imports and `...createTrackSendsSlice(setWithLoopMirror, defaults),` directly after `...createBeatSlice(setWithLoopMirror),`.
- [ ] **Step 6: Validation.** In `src/store/sanitize.ts` extend the `import { PAD_INTERVALS, PAD_MODES, PAD_VOICINGS } from '../types';` line with `SEND_EFFECTS, type TrackSendLevels, type TrackSends`. Directly above the `sanitizeLoops` docblock add:

```ts
function sanitizeTrackSendLevels(value: unknown, fallback: TrackSendLevels): TrackSendLevels {
  const row: Record<string, unknown> = isPlainObject(value) ? value : {};
  const out = {} as TrackSendLevels;
  for (const effect of SEND_EFFECTS) out[effect] = clampFinite(row[effect], 0, 1, fallback[effect]);
  return out;
}

/**
 * A loop's per-track master sends, validated on every read (R302) — never
 * migrated, never version-gated. Not a plain object → the whole default; a
 * row that is not a plain object → that row's default; a non-number or
 * non-finite level → that effect's default; out of range → clamped. Unknown
 * sources and effect keys are dropped, and the result is always freshly
 * built: nothing from `value` or `fallback` is returned by reference.
 */
export function sanitizeTrackSends(value: unknown, fallback: TrackSends): TrackSends {
  const raw: Record<string, unknown> = isPlainObject(value) ? value : {};
  const out = {} as TrackSends;
  for (const source of Object.keys(fallback) as (keyof TrackSends)[]) {
    out[source] = sanitizeTrackSendLevels(raw[source], fallback[source]);
  }
  return out;
}
```
  In `sanitizeLoops`, after `fxMuted: asBoolean(r.fxMuted),` add `trackSends: sanitizeTrackSends(r.trackSends, fallback.trackSends),`.
- [ ] **Step 7:** `bun test src/store` → PASS (includes `loop.test.ts`'s compile pin and key-set tests, `loopCopy.test.ts`'s partition, `projectFormat.test.ts`'s pinned keys). `bun run lint` → clean (fix any test that builds a full `Loop`/`LoopContent` literal by spreading `createDefaultLoop()`/`createDefaultLoopContent()` — do not add a second defaults literal).
- [ ] **Step 8:** `bun test src/audio/export/renderMixdownGolden.test.ts` → **PASS unchanged** (the new field rides in each loop's `...loop` spread; nothing reads it yet). `bun run eslint` → zero/zero; `bun run check:dead-code && bun run check:dead-code:production` → clean.
- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/store/types.ts src/store/loop.ts src/store/loopDefaults.ts src/store/loopCopy.ts \
  src/store/store.ts src/store/sanitize.ts src/store/trackSendsSlice.ts src/store/trackSendsSlice.test.ts \
  src/store/sourceBuses.test.ts src/store/sanitizeTrackSends.test.ts
git commit -m "feat(store): per-loop trackSends with defaults, copy group and validation (DEV-423)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `engineSync` — sends reach the engine per bus

**Files:**
- Modify: `src/store/engineSync.ts` (`pushSourceState` neighbourhood, `applySliceState`, `startEngineSync` bus-subscription loop and transport-start block)
- Create: `src/store/engineSync.trackSends.test.ts`

**Interfaces:**
- Consumes: `audioEngine.setSourceSends(source, sends, time?, mode?)` (Task 2); `AppStore.trackSends`, `setTrackSends` (Task 3); `sourceTransitionTime()`, `withSourceTransitionTime(time, update)` (`sourceTransition.ts`); `SOURCE_BUSES`.
- Produces (module-private): `settleSourceBuses(s: AppStore): void`, `subscribeTrackSends(): Array<() => void>`.

- [ ] **Step 1: Failing test.** Create `src/store/engineSync.trackSends.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { useAppStore } from './store';
import { applyEngineSnapshot, startEngineSync, stopEngineSync } from './engineSync';
import { SOURCE_BUSES } from './sourceBuses';
import { withSourceTransitionTime } from './sourceTransition';

const initialSends = useAppStore.getState().trackSends;

beforeEach(() => {
  useAppStore.setState({
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    fxPlayer: 'stopped',
    soloTracks: [],
    trackSends: initialSends,
  });
});

afterEach(() => {
  stopEngineSync();
  useAppStore.setState({ soloTracks: [], chordMuted: false, trackSends: initialSends });
});

function spySends() {
  return spyOn(audioEngine, 'setSourceSends').mockImplementation(() => {});
}

describe('engineSync: per-track sends', () => {
  test('the bridge bootstraps every bus once, in SOURCE_BUSES order', () => {
    const setSourceSends = spySends();
    try {
      startEngineSync();
      expect(setSourceSends.mock.calls.map(([source]) => source)).toEqual(SOURCE_BUSES.map((b) => b.source));
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('a setTrackSends write reaches the engine for that source only, as a transition', () => {
    const setSourceSends = spySends();
    try {
      startEngineSync();
      setSourceSends.mockClear();
      useAppStore.getState().setTrackSends('chord', { reverb: 0.3, delay: 0.2, distortion: 0.1 });
      expect(setSourceSends.mock.calls).toEqual([
        ['chord', { reverb: 0.3, delay: 0.2, distortion: 0.1 }, undefined, 'transition'],
      ]);
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('a write inside withSourceTransitionTime lands on that song boundary', () => {
    const setSourceSends = spySends();
    try {
      startEngineSync();
      setSourceSends.mockClear();
      withSourceTransitionTime(12.5, () =>
        useAppStore.getState().setTrackSends('bass', { reverb: 0, delay: 1, distortion: 0 }));
      expect(setSourceSends.mock.calls).toEqual([
        ['bass', { reverb: 0, delay: 1, distortion: 0 }, 12.5, 'transition'],
      ]);
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('solo and mute changes make no setSourceSends call (sends read no audibility)', () => {
    const setSourceSends = spySends();
    try {
      startEngineSync();
      setSourceSends.mockClear();
      useAppStore.getState().toggleSoloTrack('drums');
      useAppStore.getState().toggleChordMuted();
      expect(setSourceSends).not.toHaveBeenCalled();
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('applyEngineSnapshot settles all six buses', () => {
    const setSourceSends = spySends();
    try {
      applyEngineSnapshot();
      const s = useAppStore.getState();
      expect(setSourceSends.mock.calls).toEqual(
        SOURCE_BUSES.map((bus) => [bus.source, s.trackSends[bus.source], undefined, 'settle']),
      );
    } finally {
      setSourceSends.mockRestore();
    }
  });

  test('a transport start from full stop settles every bus sends beside its bus state', () => {
    const init = spyOn(audioEngine, 'init').mockImplementation(() => {});
    const resetClock = spyOn(audioEngine, 'resetClock').mockImplementation(() => {});
    const setSourceSends = spySends();
    try {
      startEngineSync();
      setSourceSends.mockClear();
      useAppStore.getState().play('sequencer');
      expect(setSourceSends.mock.calls.map(([source, , , mode]) => [source, mode]))
        .toEqual(SOURCE_BUSES.map((bus) => [bus.source, 'settle']));
    } finally {
      setSourceSends.mockRestore();
      resetClock.mockRestore();
      init.mockRestore();
    }
  });
});
```
- [ ] **Step 2:** `bun test src/store/engineSync.trackSends.test.ts` → FAIL (no `setSourceSends` calls).
- [ ] **Step 3: Implement.** In `src/store/engineSync.ts`, directly after `pushSourceState`, add:

```ts
/**
 * Every bus's complete state AND its sends, settled at one instant — the
 * snapshot pass and a transport start from full stop both need exactly this.
 * Sends read no audibility (R160): the bus they tap is already zeroed by mute
 * and solo, so a muted or unsoloed track sends nothing.
 */
function settleSourceBuses(s: AppStore): void {
  for (const bus of SOURCE_BUSES) {
    pushSourceState(sourceState(s, bus), bus, 'settle');
    audioEngine.setSourceSends(bus.source, s.trackSends[bus.source], undefined, 'settle');
  }
}

/**
 * One subscription per bus on its own `trackSends` row. `setTrackSends`
 * replaces only the row it writes, so the default `Object.is` compare fires
 * for that bus alone. `sourceTransitionTime()` puts a song seam's new sends on
 * the boundary where that seam's fader and mute changes land.
 */
function subscribeTrackSends(): Array<() => void> {
  return SOURCE_BUSES.map((bus) =>
    useAppStore.subscribe(
      (s) => s.trackSends[bus.source],
      (sends) => audioEngine.setSourceSends(bus.source, sends, sourceTransitionTime(), 'transition'),
      { fireImmediately: true },
    ));
}
```
  In `applySliceState` replace

```ts
  for (const bus of SOURCE_BUSES) {
    pushSourceState(sourceState(s, bus), bus, 'settle');
  }
```
  with `settleSourceBuses(s);`. In `startEngineSync`, directly after the `for (const bus of SOURCE_BUSES) { subs.push(useAppStore.subscribe((s) => sourceState(s, bus), …)); }` loop add `subs.push(...subscribeTrackSends());`. In the transport-start block replace

```ts
          const s = useAppStore.getState();
          for (const bus of SOURCE_BUSES) {
            pushSourceState(sourceState(s, bus), bus, 'settle');
          }
```
  with `settleSourceBuses(useAppStore.getState());` (the `audioEngine.resetClock();` line after it stays).
- [ ] **Step 4:** `bun test src/store/engineSync.trackSends.test.ts src/store/engineSync.test.ts` → PASS (the existing restart test still sees six bus-state settles, then `resetClock`).
- [ ] **Step 5:** `bun run lint` → clean; `bun run eslint` → zero/zero (`startEngineSync` must now be below its previous 97 lines); `bun run check:dead-code && bun run check:dead-code:production` → clean.
- [ ] **Step 6: Commit**

```bash
git add src/store/engineSync.ts src/store/engineSync.trackSends.test.ts
git commit -m "feat(store): bridge per-track sends to the engine in engineSync (DEV-423)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sends in the WAV mixdown

**Files:**
- Modify: `src/audio/playback/plan/songSnapshot.ts` (`MixdownBusState`), `src/store/mixdownSnapshot.ts`, `src/audio/export/renderMixdown.ts` (`applyMasterState`, `applyLoopAudioState`), `src/audio/export/mixdownFixture.ts`, `src/audio/export/renderMidi.test.ts` (`busRows`)
- Test: `src/store/mixdownSnapshot.test.ts`, `src/audio/export/renderMixdown.sourceBus.test.ts`

**Interfaces:**
- Consumes: `AudioEngine.setSourceSends` (Task 2); `AppStore.trackSends`, `Loop.trackSends`, `createDefaultLoopContent` (Task 3).
- Produces: `MixdownBusState` = `{ source: string; gain: number; muted: boolean; sends: TrackSendLevels }`.

- [ ] **Step 1: Failing tests.**
  - `src/store/mixdownSnapshot.test.ts`: add imports `import { createDefaultLoopContent } from './loopDefaults';`, `import { mixdownLoop, mixdownSnapshot } from '@/audio/export/mixdownFixture';`, `import type { SourceBusId } from './sourceBuses';` and append inside `describe('buildMixdownSnapshot', …)`:

```ts
  test('carries each bus sends: song level from the flat slice, per loop from the loop', () => {
    const before = useAppStore.getState();
    const loopSends = { ...before.loops[0].trackSends, chord: { reverb: 0.25, delay: 0.5, distortion: 0 } };
    useAppStore.setState({
      trackSends: { ...before.trackSends, bass: { reverb: 0, delay: 0.75, distortion: 1 } },
      loops: [{ ...before.loops[0], trackSends: loopSends }],
    });
    try {
      const snapshot = buildMixdownSnapshot(useAppStore.getState());
      expect(snapshot.buses.find((bus) => bus.source === 'bass')?.sends)
        .toEqual({ reverb: 0, delay: 0.75, distortion: 1 });
      expect(snapshot.loops[0].buses.find((bus) => bus.source === 'chord')?.sends)
        .toEqual({ reverb: 0.25, delay: 0.5, distortion: 0 });
    } finally {
      useAppStore.setState({ trackSends: before.trackSends, loops: before.loops });
    }
  });

  test('the mixdown fixture spells exactly the store default sends', () => {
    const defaults = createDefaultLoopContent().trackSends;
    for (const bus of [...mixdownSnapshot().buses, ...mixdownLoop().buses]) {
      expect([bus.source, bus.sends]).toEqual([bus.source, defaults[bus.source as SourceBusId]]);
    }
  });
```
  - `src/audio/export/renderMixdown.sourceBus.test.ts`: change the first import to `import { describe, expect, spyOn, test } from 'bun:test';`, add `import { AudioEngine } from '../engine';` and append:

```ts
describe('renderMixdown: per-track sends', () => {
  test("each pass installs its own loop's sends at its start: settle at 0, transition after", async () => {
    const calls: Parameters<AudioEngine['setSourceSends']>[] = [];
    const spy = spyOn(AudioEngine.prototype, 'setSourceSends').mockImplementation(
      (...args: Parameters<AudioEngine['setSourceSends']>) => {
        calls.push(args);
      },
    );
    try {
      const base = mixdownSnapshot();
      const chordReverb = (id: string, reverb: number) => mixdownLoop({
        id,
        buses: base.buses.map((bus) => (bus.source === 'chord' ? { ...bus, sends: { ...bus.sends, reverb } } : bus)),
      });
      const result = await renderMixdown(mixdownSnapshot({
        loops: [chordReverb('loop-a', 0.25), chordReverb('loop-b', 0.75)],
      }));
      expect(result.ok).toBe(true);
      const songLevel = base.buses.find((bus) => bus.source === 'chord')!.sends;
      // One-bar loops at 120 BPM: loop-b's pass starts at 2 s.
      expect(calls.filter(([source]) => source === 'chord')).toEqual([
        ['chord', songLevel, 0, 'settle'],
        ['chord', { ...songLevel, reverb: 0.25 }, 0, 'settle'],
        ['chord', { ...songLevel, reverb: 0.75 }, 2, 'transition'],
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});
```
- [ ] **Step 2:** `bun test src/store/mixdownSnapshot.test.ts src/audio/export/renderMixdown.sourceBus.test.ts` → FAIL (`sends` undefined; no `setSourceSends` calls).
- [ ] **Step 3: Snapshot type and builder.**
  - `songSnapshot.ts`: add `import type { TrackSendLevels } from '@/types';` and in `MixdownBusState` after `muted: boolean;` add

```ts
  /** The bus's master sends, already linear 0..1 — applied beside gain/mute, never through it (C2). */
  sends: TrackSendLevels;
```
  - `mixdownSnapshot.ts`: in the per-loop `buses` map add `sends: loop.trackSends[bus.source],` after `muted: bus.selectMuted(loop),`; in the song-level `buses` map add `sends: s.trackSends[bus.source],` after `muted: bus.selectMuted(s),`.
- [ ] **Step 4: Renderer.** In `renderMixdown.ts`:
  - `applyMasterState`: inside the bus loop, after the `engine.setSourceState(…, 0, 'settle');` line add `engine.setSourceSends(bus.source, bus.sends, 0, 'settle');`.
  - `applyLoopAudioState`: inside the bus loop, after the `engine.setSourceState(…);` call add

```ts
    // Unconditional, like bus state: a per-loop send change lands on this
    // pass's first sample. Its own method, never setSourceState (C2).
    engine.setSourceSends(
      bus.source,
      bus.sends,
      state.time,
      state.time === 0 ? 'settle' : 'transition',
    );
```
- [ ] **Step 5: Fixture and MIDI test rows.**
  - `mixdownFixture.ts`: add `TrackSendLevels` to the `@/types` type import; below `BUSES` add

```ts
/**
 * The store's default sends for one bus, spelled out for the reason `BUSES`
 * is (this module may not import store/) — the one sanctioned copy of the
 * defaults outside `createDefaultLoopContent` (R301). `mixdownSnapshot.test.ts`
 * asserts the two are equal: Beat is dry into delay and distortion.
 */
function defaultSends(source: (typeof BUSES)[number]): TrackSendLevels {
  return source === 'sequencer'
    ? { reverb: 1, delay: 0, distortion: 0 }
    : { reverb: 1, delay: 1, distortion: 1 };
}
```
    and change both `BUSES.map((source) => ({ source, gain: 1, muted: false }))` to `BUSES.map((source) => ({ source, gain: 1, muted: false, sends: defaultSends(source) }))`.
  - `renderMidi.test.ts`: add `import type { MixdownBusState } from '../playback/plan/songSnapshot';` and replace `busRows`'s body and return type so rows come from the fixture (no second defaults literal):

```ts
function busRows(
  muted: Partial<Record<(typeof BUS_SOURCES)[number], boolean>> = {},
  gains: Partial<Record<(typeof BUS_SOURCES)[number], number>> = {},
): MixdownBusState[] {
  const rows = mixdownSnapshot().buses;
  return BUS_SOURCES.map((source) => {
    const row = rows.find((bus) => bus.source === source) as MixdownBusState;
    return { ...row, gain: gains[source] ?? 1, muted: muted[source] ?? false };
  });
}
```
- [ ] **Step 6:** `bun test src/store/mixdownSnapshot.test.ts src/audio/export` → PASS, **including `renderMixdownGolden.test.ts` unchanged** (its call log has no `setSourceSends`; its WAV hash must match). `git status --short src/audio/export/renderMixdownGolden*` → empty. `bun test src/store/exportKinds.test.ts src/store/exportSlice.test.ts` → PASS.
- [ ] **Step 7:** `bun run lint` → clean; `bun run eslint` → zero/zero; `bun run check:dead-code && bun run check:dead-code:production` → clean.
- [ ] **Step 8: Commit**

```bash
git add src/audio/playback/plan/songSnapshot.ts src/store/mixdownSnapshot.ts src/audio/export/renderMixdown.ts \
  src/audio/export/mixdownFixture.ts src/audio/export/renderMidi.test.ts src/store/mixdownSnapshot.test.ts \
  src/audio/export/renderMixdown.sourceBus.test.ts
git commit -m "feat(export): carry per-loop track sends through the WAV mixdown (DEV-423)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rev / Dly / Dist knobs in each Mixer row

**Files:**
- Modify: `src/utils/gainUnits.ts` (beside `formatDb`), `src/utils/gainUnits.test.ts`, `src/components/loop/beat/beatControlSchema.ts` (the private `formatPercent`), `src/components/loop/SoundMixer.tsx`, `src/components/loop/SoundMixer.test.tsx`
- Create: `src/store/trackSendsPreview.ts`, `src/components/loop/useTrackSendsDraft.ts`, `src/components/loop/useTrackSendsDraft.test.ts`

**Interfaces:**
- Consumes: `audioEngine.setSourceSends` (Task 2); `trackSends`, `setTrackSends` (Task 3); `useDraftGestureForceRender(machine)` (`src/components/useDraftGestureForceRender.ts`); `Knob` (`src/components/ui/Knob.tsx`); `MixerChannel` (`SoundMixer.tsx`, has `engineSource: SourceBusId`, `idPrefix`, `label`, `accentClass`).
- Produces:

```ts
// src/utils/gainUnits.ts
export function formatPercent(value: number): string;
// src/store/trackSendsPreview.ts
export function previewTrackSends(source: SourceBusId, sends: TrackSendLevels): void;
// src/components/loop/useTrackSendsDraft.ts
export interface UseTrackSendsDraft {
  sends: TrackSendLevels;                                   // draft while dragging, else committed
  onChangeFor: Record<SendEffect, (value: number) => void>; // draft + previewTrackSends, no store write
  onCommit: () => void;                                     // setTrackSends(source, draft), once
  onCancel: () => void;                                     // revert draft, preview committed
}
export function createTrackSendsDraftMachine(committed: TrackSendLevels, source: SourceBusId): {
  sync(next: TrackSendLevels): void;
  onChange(effect: SendEffect, value: number): void;
  commit(setTrackSends: (source: SourceBusId, sends: TrackSendLevels) => void): void;
  cancel(): void;
  cancelIfDragging(): void;
  getDraft(): TrackSendLevels;
};
export function useTrackSendsDraft(source: SourceBusId): UseTrackSendsDraft;
```

- [ ] **Step 1: Failing tests.**
  - `src/utils/gainUnits.test.ts`: add `formatPercent` to the `./gainUnits` import and append

```ts
describe('formatPercent', () => {
  test('reads a 0..1 level as a whole percent', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.254)).toBe('25%');
    expect(formatPercent(1)).toBe('100%');
  });
});
```
  - `src/components/loop/useTrackSendsDraft.test.ts`:

```ts
import { describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '@/audio/engine';
import type { SourceBusId } from '@/store/sourceBuses';
import type { TrackSendLevels } from '@/types';
import { createTrackSendsDraftMachine } from './useTrackSendsDraft';

const COMMITTED: TrackSendLevels = { reverb: 1, delay: 0.5, distortion: 0 };

function withPreviewSpy(body: (calls: unknown[][]) => void): void {
  const setSourceSends = spyOn(audioEngine, 'setSourceSends').mockImplementation(() => {});
  try {
    body(setSourceSends.mock.calls);
  } finally {
    setSourceSends.mockRestore();
  }
}

describe('createTrackSendsDraftMachine', () => {
  test('onChange drafts and previews that track, and writes nothing', () => {
    withPreviewSpy((calls) => {
      const writes: [SourceBusId, TrackSendLevels][] = [];
      const machine = createTrackSendsDraftMachine(COMMITTED, 'chord');
      machine.onChange('delay', 0.8);
      expect(machine.getDraft()).toEqual({ reverb: 1, delay: 0.8, distortion: 0 });
      expect(calls).toEqual([['chord', { reverb: 1, delay: 0.8, distortion: 0 }]]);
      expect(writes).toEqual([]);
    });
  });

  test('commit writes the draft once, on release', () => {
    withPreviewSpy(() => {
      const writes: [SourceBusId, TrackSendLevels][] = [];
      const write = (source: SourceBusId, sends: TrackSendLevels) => writes.push([source, sends]);
      const machine = createTrackSendsDraftMachine(COMMITTED, 'chord');
      machine.onChange('reverb', 0.25);
      machine.onChange('reverb', 0.3);
      machine.commit(write);
      machine.commit(write);
      expect(writes).toEqual([['chord', { reverb: 0.3, delay: 0.5, distortion: 0 }]]);
    });
  });

  test('a release with no move writes nothing', () => {
    withPreviewSpy(() => {
      const writes: unknown[] = [];
      const machine = createTrackSendsDraftMachine(COMMITTED, 'bass');
      machine.commit((source, sends) => writes.push([source, sends]));
      expect(writes).toEqual([]);
    });
  });

  test('cancel reverts the draft and previews the committed row back', () => {
    withPreviewSpy((calls) => {
      const machine = createTrackSendsDraftMachine(COMMITTED, 'pad');
      machine.onChange('distortion', 0.9);
      machine.cancel();
      expect(machine.getDraft()).toEqual(COMMITTED);
      expect(calls.at(-1)).toEqual(['pad', COMMITTED]);
    });
  });

  test('cancelIfDragging previews only when a gesture is open (unmount mid-drag)', () => {
    withPreviewSpy((calls) => {
      const machine = createTrackSendsDraftMachine(COMMITTED, 'fx');
      machine.cancelIfDragging();
      expect(calls).toEqual([]);
      machine.onChange('reverb', 0.1);
      machine.cancelIfDragging();
      expect(calls.at(-1)).toEqual(['fx', COMMITTED]);
    });
  });

  test('a committed change arriving mid-drag does not overwrite the draft', () => {
    withPreviewSpy(() => {
      const machine = createTrackSendsDraftMachine(COMMITTED, 'synth');
      machine.onChange('delay', 0.1);
      machine.sync({ reverb: 0, delay: 0, distortion: 0 });
      expect(machine.getDraft().delay).toBe(0.1);
    });
  });
});
```
  - `src/components/loop/SoundMixer.test.tsx`: append

```tsx
describe('per-track send knobs', () => {
  const html = renderToString(<SoundMixer />);
  const EFFECTS = [
    ['reverb', 'reverb send'],
    ['delay', 'delay send'],
    ['distortion', 'distortion send'],
  ] as const;
  const valueNow = (id: string) => openTagContaining(html, `id="${id}"`).match(/aria-valuenow="([^"]+)"/)?.[1];

  test('every row carries Rev, Dly and Dist: eighteen knobs, named for their row', () => {
    for (const c of MIXER_CHANNELS) {
      for (const [effect, name] of EFFECTS) {
        expect(openTagContaining(html, `id="knob-send-${c.idPrefix}-${effect}"`))
          .toContain(`aria-label="${c.label} ${name}"`);
      }
    }
    expect(html.match(/id="knob-send-/g)).toHaveLength(18);
  });

  test("each row shows its own committed sends: Beat is dry into delay and distortion", () => {
    expect(valueNow('knob-send-drum-reverb')).toBe('1');
    expect(valueNow('knob-send-drum-delay')).toBe('0');
    expect(valueNow('knob-send-drum-distortion')).toBe('0');
    expect(valueNow('knob-send-chord-delay')).toBe('1');
    expect(openTagContaining(html, 'id="knob-send-drum-delay"')).toContain('aria-valuetext="0%"');
  });
});
```
  (These assert the store **defaults**: a `renderToString` render reads the initial state, R257, and the Beat row differs from the others by default.)
- [ ] **Step 2:** `bun test src/utils/gainUnits.test.ts src/components/loop/useTrackSendsDraft.test.ts src/components/loop/SoundMixer.test.tsx` → FAIL (`formatPercent` not exported; module `./useTrackSendsDraft` missing; no `knob-send-` ids).
- [ ] **Step 3: `formatPercent` move.** In `src/utils/gainUnits.ts`, after `formatDb`, add

```ts
/** A 0..1 level (linear gain, a send, a balance) read as a whole percent. */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
```
  In `beatControlSchema.ts` delete the private `formatPercent` (and its docblock) and add `import { formatPercent } from '@/utils/gainUnits';`.
- [ ] **Step 4: Preview module.** Create `src/store/trackSendsPreview.ts`:

```ts
import { audioEngine } from '@/audio/engine';
import type { TrackSendLevels } from '@/types';
import type { SourceBusId } from './sourceBuses';

/**
 * TRANSIENT per-track send audio: what a Mixer send knob sounds like while it
 * is being dragged, before anything is committed (DEV-423).
 *
 * In `src/store/` for the reason every engine call is — a view may not import
 * `audio/engine` — and the ONLY non-test route `useTrackSendsDraft` has to the
 * engine. Same shape as `effectsPreview.ts`: a direct, synchronous push of
 * three cheap AudioParam ramps. The committed value reaches the engine through
 * engineSync's `trackSends` subscription once `setTrackSends` runs on release.
 */
export function previewTrackSends(source: SourceBusId, sends: TrackSendLevels): void {
  audioEngine.setSourceSends(source, sends);
}
```
- [ ] **Step 5: Hook.** Create `src/components/loop/useTrackSendsDraft.ts`:

```ts
import { useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/store/store';
import { previewTrackSends } from '@/store/trackSendsPreview';
import type { SourceBusId } from '@/store/sourceBuses';
import type { SendEffect, TrackSendLevels } from '@/types';
import { useDraftGestureForceRender } from '@/components/useDraftGestureForceRender';

export interface UseTrackSendsDraft {
  /** The draft while a gesture is open, the committed row otherwise. */
  sends: TrackSendLevels;
  /** Per effect: draft + preview straight to the engine — no store write. */
  onChangeFor: Record<SendEffect, (value: number) => void>;
  /** Ends the gesture by writing the draft through `setTrackSends`, once. */
  onCommit: () => void;
  /** Ends the gesture by discarding the draft and previewing the committed row. */
  onCancel: () => void;
}

interface DraftState {
  draft: TrackSendLevels;
  committed: TrackSendLevels;
  dragging: boolean;
}

/**
 * The pure state machine behind `useTrackSendsDraft`, isolated from React —
 * the `createEffectsDraftMachine` split, for the same reason: `renderToString`
 * cannot carry hook state across calls. The dragged value stays here (R016,
 * R272); the persisted row is written once, on release (R212).
 */
export function createTrackSendsDraftMachine(committed: TrackSendLevels, source: SourceBusId) {
  const state: DraftState = { draft: committed, committed, dragging: false };

  /** Called once per render with the latest committed row. */
  function sync(next: TrackSendLevels): void {
    state.committed = next;
    if (!state.dragging) state.draft = next;
  }

  function onChange(effect: SendEffect, value: number): void {
    state.dragging = true;
    state.draft = { ...state.draft, [effect]: value };
    previewTrackSends(source, state.draft);
  }

  /** Writes only if a gesture is open: a release with no move is not an edit. */
  function commit(setTrackSends: (source: SourceBusId, sends: TrackSendLevels) => void): void {
    if (!state.dragging) return;
    state.dragging = false;
    state.committed = state.draft;
    setTrackSends(source, state.draft);
  }

  function cancel(): void {
    state.dragging = false;
    state.draft = state.committed;
    // Pull the engine back off the abandoned draft.
    previewTrackSends(source, state.committed);
  }

  /** Unmount teardown: only a gesture still open has anything to undo. */
  function cancelIfDragging(): void {
    if (state.dragging) cancel();
  }

  return {
    sync,
    onChange,
    commit,
    cancel,
    cancelIfDragging,
    getDraft: (): TrackSendLevels => state.draft,
  };
}

/** One Mixer row's three send knobs: local draft, engine preview, one store write on release. */
export function useTrackSendsDraft(source: SourceBusId): UseTrackSendsDraft {
  // The stored row by reference, never a fresh object (R274/R275): a knob
  // release re-renders this row alone.
  const committed = useAppStore((s) => s.trackSends[source]);
  const setTrackSends = useAppStore((s) => s.setTrackSends);

  const machineRef = useRef<ReturnType<typeof createTrackSendsDraftMachine> | null>(null);
  if (!machineRef.current) {
    machineRef.current = createTrackSendsDraftMachine(committed, source);
  }
  const machine = machineRef.current;
  machine.sync(committed);

  const forceRender = useDraftGestureForceRender(machine);

  const onChangeFor = useMemo(() => {
    const handler = (effect: SendEffect) => (value: number) => {
      machine.onChange(effect, value);
      forceRender();
    };
    return { reverb: handler('reverb'), delay: handler('delay'), distortion: handler('distortion') };
  }, [machine, forceRender]);
  const onCommit = useCallback(() => {
    machine.commit(setTrackSends);
    forceRender();
  }, [machine, setTrackSends, forceRender]);
  const onCancel = useCallback(() => {
    machine.cancel();
    forceRender();
  }, [machine, forceRender]);

  return { sends: machine.getDraft(), onChangeFor, onCommit, onCancel };
}
```
- [ ] **Step 6: Component.** In `src/components/loop/SoundMixer.tsx`:
  - Imports: add `import { Knob } from '../ui/Knob';`, `import { useTrackSendsDraft } from './useTrackSendsDraft';`, `import { SEND_EFFECTS, type SendEffect } from '@/types';`, and change `import { formatDb } from '@/utils/gainUnits';` to `import { formatDb, formatPercent } from '@/utils/gainUnits';`.
  - Directly above the `MixerRow` docblock (R267: child above its parent) add:

```tsx
/** Each send knob's short label and the accessible name's tail. */
const SEND_KNOB_TEXT: Record<SendEffect, { label: string; aria: string }> = {
  reverb: { label: 'Rev', aria: 'reverb send' },
  delay: { label: 'Dly', aria: 'delay send' },
  distortion: { label: 'Dist', aria: 'distortion send' },
};

/**
 * One row's sends into the shared master reverb, delay and distortion
 * (DEV-423): post-fader, per loop. The master wet knobs on the Master tab
 * still set each effect's overall amount. All logic is in the hook; the value
 * being dragged never reaches the store until release.
 */
function TrackSendKnobs({ channel }: { channel: MixerChannel }) {
  const { sends, onChangeFor, onCommit, onCancel } = useTrackSendsDraft(channel.engineSource);
  return (
    <div className="flex gap-2">
      {SEND_EFFECTS.map((effect) => (
        <Knob
          key={effect}
          id={`knob-send-${channel.idPrefix}-${effect}`}
          value={sends[effect]}
          onChange={onChangeFor[effect]}
          onCommit={onCommit}
          onCancel={onCancel}
          min={0}
          max={1}
          step={0.01}
          size="xs"
          color={channel.accentClass}
          label={SEND_KNOB_TEXT[effect].label}
          ariaLabel={`${channel.label} ${SEND_KNOB_TEXT[effect].aria}`}
          format={formatPercent}
        />
      ))}
    </div>
  );
}
```
  - In `MixerRow`, inside `<div className="flex-1 min-w-0 flex flex-col gap-1">`, directly after the `<SourceMeter … />` element, add `<TrackSendKnobs channel={channel} />`. Nothing else in `MixerRow` changes (R273 scope).
- [ ] **Step 7:** `bun test src/utils/gainUnits.test.ts src/components/loop` → PASS (includes `beat/beatControlSchema.test.ts` unchanged and green). `bun run check:theme && bun run check:contrast` → PASS (theme roles only, no new tokens).
- [ ] **Step 8:** `bun run lint` → clean; `bun run eslint` → zero/zero; `bun run check:dead-code && bun run check:dead-code:production` → clean.
- [ ] **Step 9: Commit**

```bash
git add src/utils/gainUnits.ts src/utils/gainUnits.test.ts src/components/loop/beat/beatControlSchema.ts \
  src/store/trackSendsPreview.ts src/components/loop/useTrackSendsDraft.ts src/components/loop/useTrackSendsDraft.test.ts \
  src/components/loop/SoundMixer.tsx src/components/loop/SoundMixer.test.tsx
git commit -m "feat(mixer): Rev/Dly/Dist send knobs per track with a local draft (DEV-423)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Rules R301–R306, ADR-0037, doc sync and the completion gate

**Files:**
- Create: `docs/decisions/0037-per-track-sends.md`
- Modify: `docs/decisions/README.md`, `.claude/rules/loops-and-solo.md`, `.claude/rules/persistence.md`, `.claude/rules/synth-voices.md`, `.claude/rules/beat.md`, `.claude/rules/playback.md`, `CLAUDE.md`, `.claude/skills/dsp-audio/SKILL.md`, `docs/architecture/feature-overview.md`, `docs/architecture/structure/{README,01-ui,02-store,03-audio}.md`

**Interfaces:**
- Consumes: every symbol from Tasks 1–6 by name — `trackSends`, `TrackSends`, `TrackSendLevels`, `SEND_EFFECTS`, `sanitizeTrackSends`, `createTrackSendsSlice`/`setTrackSends`, `setSourceSends`, `sourceSends.ts` (`createSourceSendNodes`, `applySourceSendLevels`, `clampSendLevels`), `BEAT_BUS_SOURCE`, `trackSendsPreview.ts`, `useTrackSendsDraft`, `TrackSendKnobs`.
- Produces: rules R301–R306 (next free ids after R300) and ADR-0037. No code.

- [ ] **Step 1: ADR-0037.** Create `docs/decisions/0037-per-track-sends.md` in the template's sections (`# ADR-0037: Per-track sends into the shared master effects`, `**Status:** Accepted — 2026-09-22. DEV-423`, `## Context`, `## Decision`, `## Consequences`, `## Rules this implies`, `## Sources`). Content:
  - **Context:** the structure README's deferred "Per-track FX" item and finding A1 (the Beat bus was kept off the master sends by construction order, then by `SOURCES_WITHOUT_MASTER_SENDS`); every other bus fed all three gates at unity with no per-track control.
  - **Decision:** spec §12 items 1–13, one bullet each (send levels into the existing shared effects; `trackSends` keyed by engine source id, linear 0..1; per loop in `LOOP_FLAT_KEYS` and the `mix` copy group; defaults 1/1/1 except Beat delay/distortion 0; `sanitizeTrackSends`, no migration; bus → own send node → existing gate, `SOURCES_WITHOUT_MASTER_SENDS` removed; Beat reverb per-voice → `drumSendGate` → `send[sequencer].reverb` → convolver, connected after `reverbSendGate`; `reverbSend` redefined as a multiplier; `setSourceSends` separate from `setSourceState`, nodes seeded 0 until told, node code in `audio/sourceSends.ts`; engineSync per-bus subscription plus settle pushes; `MixdownBusState.sends` at t=0 and each pass; `useTrackSendsDraft` knobs; DEV-429 stems dry post-fader, sends ignored). Add: the audition bus `'preview'` is told unity sends by `presetPreview.ts` because it is not a track.
  - **Rejected alternatives:** keying by mixer id `'drum'`; `send[sequencer].reverb → reverbSendGate` (reorders the convolver sum, breaks C1); a bus→reverb send for Beat too (double reverb, changes every project); seeding send nodes at 1 inside `audio/` (a second copy of the store defaults); copying the fader's write-on-every-move (R016).
  - **Consequences:** existing projects open and export byte-identically (the golden `.wav.sha256` and `.calls.json` did not change); Beat can now feed delay and distortion; `getSourceBus` throws without the gates, so construction order is a checked precondition; `masterRack.ts` stays under `max-lines` because node code lives in `sourceSends.ts`.
  - **Rules this implies:** R301–R306, one line each with its rules file.
  - **Sources:** DEV-423; `docs/superpowers/specs/2026-09-22-dev-423-per-track-sends-design.md`; `docs/superpowers/plans/2026-09-22-dev-423-per-track-sends.md`.
  Add the index row to `docs/decisions/README.md` after the 0036 row:
  `| [0037](0037-per-track-sends.md) | Per-track sends into the shared master effects | Each track's own Rev/Dly/Dist send nodes, post-fader, per loop; Beat reverb stays per-voice × track send, second convolver input; defaults keep audio byte-identical. |`
- [ ] **Step 2: Rules.** Each bullet ends with its `<!-- R### -->` marker and a link to `../../docs/decisions/0037-per-track-sends.md`; each gets a `## Prohibited` entry in the same file.
  - `loops-and-solo.md` § Loop content — R301: "`trackSends` is per-loop content: in `LOOP_FLAT_KEYS` and the `mix` copy group, keyed by engine source id (`synth`, `chord`, `bass`, `pad`, `fx`, `sequencer`), levels linear 0..1. Its default is written only in `createDefaultLoopContent`: 1/1/1 on every track except `sequencer` delay 0 and distortion 0; `mixdownFixture.ts` is the one test copy and a test pins it equal." Prohibited: "A `trackSends` default literal outside `createDefaultLoopContent` (the mixdown fixture excepted) <!-- R301 -->".
  - `persistence.md` § Validation, not migration — R302: "`sanitizeTrackSends` (`sanitizeLoops`) validates `trackSends` on every loop read: not a plain object → default; bad row → that row's default; non-number or non-finite → that effect's default; out of range → clamped; unknown keys dropped; nothing returned by reference. No version gate." Prohibited: "A version gate or migration for `trackSends` <!-- R302 -->".
  - `synth-voices.md`: add `"src/audio/sourceSends.ts"` to `paths:`; add a section `## Master sends` before `## Deferred` with R303: "Each source bus reaches the three send gates only through its own three send nodes (`sourceSends.ts`), taken after the fader and mute. No bus connects straight to a gate, and there is no per-source exclusion set — the one exception is R304. `getSourceBus` requires the gates and throws without them. The audition bus `'preview'` is not a track and is told unity sends by `presetPreview.ts`." and R304: "Beat has no bus→reverb send. Its reverb is the per-voice path `drumSendFilter → drumSendGate → send[sequencer].reverb → convolver`; that feed is the convolver's second input, connected after `reverbSendGate`, and `drumSendGate` is written only by the bus level/mute path (`applySourceLevel`). Sends are set only through `setSourceSends`, never `setSourceState`." Prohibited: "A bus→gate edge, or a per-source send exclusion set <!-- R303 -->", "Feeding Beat reverb from the bus, or folding the Beat feed into `reverbSendGate` <!-- R304 -->".
  - `beat.md` § Three fields, complete patches — R305: "A voice's `reverbSend` multiplies the Beat track's reverb send; it is not a direct send to the master reverb. The effective drum reverb is `reverbSend × voice track gain × Beat bus level × Beat track reverb send`." Prohibited: "Treating `reverbSend` as a direct master-reverb send <!-- R305 -->".
  - `playback.md` § Clock and engine bridge — R306: "Sends reach the engine only through `engineSync`'s per-bus `trackSends` subscription (plus its settle pushes), the drag preview `store/trackSendsPreview.ts`, and `renderMixdown`'s per-pass `setSourceSends` beside `setSourceState`. Sends never read solo or audibility." Also add `trackSendsPreview` to R225's module set. Prohibited: "Sends routed through `setSourceState`; a component calling the send preview for anything but a drag <!-- R306 -->".
- [ ] **Step 3: CLAUDE.md, skill, architecture docs.**
  - `CLAUDE.md` rules table, `synth-voices.md` row → "`VoiceId`/owner, the frequency boundary, polyphony gain, voice lifetime, shared live/offline render, per-track master sends". No new invariant line.
  - `.claude/skills/dsp-audio/SKILL.md`: rewrite the bullet starting "Drums never reach master delay or distortion" to: the Beat bus feeds `dryGain` and, through its own send nodes, the delay and distortion gates; drum reverb is per-voice `reverbSend` → `drumSendFilter` → `drumSendGate` → the Beat track's reverb send node → convolver (second input, after `reverbSendGate`); `masterRack.sendGates.test.ts` pins both. Rewrite the "add a send gate and connect it inside `getSourceBus()`'s `SOURCES_WITHOUT_MASTER_SENDS` guard" step to: add the effect to `SEND_EFFECTS`, a gate in `createSendGates`, and one send node per bus in `getSourceBus` (`createSourceSendNodes` builds them), and extend `TrackSends` defaults in `createDefaultLoopContent`.
  - `docs/architecture/feature-overview.md` row 1: "sound mixer" → "sound mixer with per-track reverb/delay/distortion sends".
  - `docs/architecture/structure/03-audio.md`: §1.1 module table gains a `sourceSends.ts` row (per-source send nodes: build, clamp, automate; exports `SourceSendNodes`, `clampSendLevels`, `createSourceSendNodes`, `applySourceSendLevels`; imports `types`); §2.1 routing prose (`grep -n "SOURCES_WITHOUT_MASTER_SENDS\|drumSendGate" docs/architecture/structure/03-audio.md`) states bus → own send nodes → gates, Beat without a bus reverb edge, `drumSendGate → send[sequencer].reverb → convolver`; the §2.3 mermaid replaces `BUS --> RSG/DSGt/XSG` with `BUS --> SND["send nodes ×3"]` → the three gates, adds `SBUS --> SSND["Beat send nodes (dly, dist)"] --> DSGt` and `--> XSG`, changes `DSG --> CONV` to `DSG --> BRS["send[sequencer].reverb"] --> CONV`, and drops the `%% 'sequencer' is in SOURCES_WITHOUT_MASTER_SENDS` comment; the §6 finding that names `SOURCES_WITHOUT_MASTER_SENDS` gains "Superseded by DEV-423 (ADR-0037)".
  - `02-store.md`: slice table gains a **trackSends** `trackSendsSlice.ts` row (`trackSends` / `setTrackSends` / — / —); the direct-engine table's preview row adds `trackSendsPreview.ts` (`setSourceSends`); its "Three slice interfaces live in their slice files" sentence adds `TrackSendsSlice` (`trackSendsSlice.ts`) and says "Four".
  - `01-ui.md`: the Mixer inventory row → "Mixer: 6 channel strips (level, mute, meter, Rev/Dly/Dist sends) in 3 groups"; the `SoundMixer` store-access row adds `trackSends[source]` / `setTrackSends` via `useTrackSendsDraft`, and `trackSendsPreview` for the drag.
  - `README.md`: the A1 status cell → "**Superseded by DEV-423:** Beat now has delay and distortion sends; its reverb stays per-voice × track send ([ADR-0037](../../decisions/0037-per-track-sends.md))."; the **Per-track FX** deferred item → "~~Per-track FX~~ **Done** in DEV-423 ([ADR-0037](../../decisions/0037-per-track-sends.md)): every track, drums included, has reverb/delay/distortion sends; the per-voice `reverbSend` became a multiplier of the Beat track's reverb send."
  - Verify: `grep -rn "SOURCES_WITHOUT_MASTER_SENDS" src .claude CLAUDE.md docs/architecture docs/decisions` → hits only in history-describing text that says it was removed (ADR-0037, README A1/deferred, 03-audio §6). R001: no counts, versions or line numbers in any text written in this task.
- [ ] **Step 4: Completion gate.** `bun run verify` → green: all tests (golden **unchanged**: `git status --short src/audio/export/renderMixdownGolden*` empty), `lint`, `eslint` with zero errors and zero warnings, `check:keys`, `check:drums`, `check:contrast`, `check:levels`, both Knip scans at zero findings, and the build.
- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0037-per-track-sends.md docs/decisions/README.md .claude/rules/loops-and-solo.md \
  .claude/rules/persistence.md .claude/rules/synth-voices.md .claude/rules/beat.md .claude/rules/playback.md \
  CLAUDE.md .claude/skills/dsp-audio/SKILL.md docs/architecture/feature-overview.md \
  docs/architecture/structure/README.md docs/architecture/structure/01-ui.md \
  docs/architecture/structure/02-store.md docs/architecture/structure/03-audio.md
git commit -m "docs: ADR-0037 per-track sends, rules R301-R306 (DEV-423)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| §0 C1, C2, golden unchanged | Global Constraints; Task 2 Step 1 (C1 order test), Steps 11; Tasks 3, 5 golden steps; Task 7 Step 4 |
| §3.1 types, §3.2 loop field + `mix` group, §3.3 defaults, §3.4 validation | Tasks 1, 3 |
| §4.1 routing, §4.2 construction order + throw, §4.3 `sourceSends.ts`, §4.4 engine API + seeding | Tasks 1, 2 |
| §5.1 slice, §5.2 engineSync, §5.3 preview, §5.4 mixdown | Tasks 3, 4, 6, 5 |
| §6 `reverbSend` redefinition (docblocks, label unchanged) | Task 2 Step 10; Task 7 R305 |
| §7 UI (knobs, `formatPercent` move, hook, selectors) | Task 6 |
| §8 edge cases: mute/solo/fader-bottom (bus-driven, Task 4 no-audibility test); wet 0/bypass (Task 2 tail tests); voice `reverbSend` 0 / Beat reverb 0 / Beat delay (Task 2 render test); old body / garbled (Task 3); duplicate/copy/undo (Task 3 slice + partition tests; `DeletedLoop.loop` carries every Loop field); song seam (Task 4); context rebuild (Task 2 seed-0 + pre-init tests); drag cancel/unmount (Task 6); vibe (no vibe writes `trackSends`) | as listed |
| §9 tests | Tasks 1–6 (placement per Spec correction 7) |
| §10 rules, ADR, doc sync | Task 7 |
| §13 acceptance | Tasks 2–6; Task 7 gate |

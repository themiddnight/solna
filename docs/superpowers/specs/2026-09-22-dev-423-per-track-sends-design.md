# Per-track sends into the master effects — design

**Issue:** DEV-423 "Per-track FX".
**Branch:** `feat/dev-423-per-track-sends` (stacked on `feat/dev-428-midi-export` @ `3c5f8335`).
**Status:** Design approved by the user (2026-09-22); this document makes the approved decisions
concrete and checks them against the code. §12 lists the decisions one per line.

**User-visible change:** every track strip in the Sound tab's Mixer gains three small knobs,
**Rev / Dly / Dist**, which set how much of that track reaches the shared master reverb, delay
and distortion. The values belong to the loop, like the track's fader and mute. The master wet
knobs on the Master tab still set the overall amount of each effect. An existing project sounds
exactly as it did before.

---

## 0. Verified facts (checked against the code on this branch)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| F1 | There are exactly six source buses: `synth` (Lead), `chord`, `bass`, `pad`, `fx`, `sequencer` (Beat) | True | `store/sourceBuses.ts:44-75` `SOURCE_BUSES`; `SourceBusId` at :84 |
| F2 | Bus fader and mute are per-loop content, listed in `LOOP_FLAT_KEYS`, and mirrored flat↔loop | True | `store/loop.ts:20-78` (`padVolume`…`fxMuted`, `beatMix`); `store/loopSync.ts:36` iterates the keys; `store.ts:334-352` composes every slice over `setWithLoopMirror` |
| F3 | The three send gates are unity `GainNode`s between the buses and the effect nodes | True | `audio/masterRack.ts:434-465` `createSendGates` (all `gain.value = 1`) |
| F4 | Every non-Beat bus connects **directly** to all three gates, at unity | True | `masterRack.ts:932-947` `getSourceBus`: `bus.connect(delaySendGate / reverbSendGate / distortionSendGate)` unless the source is in `SOURCES_WITHOUT_MASTER_SENDS` |
| F5 | The Beat bus is excluded by name and feeds the dry path only | True | `masterRack.ts:92` `SOURCES_WITHOUT_MASTER_SENDS = new Set(['sequencer'])` |
| F6 | Beat reaches reverb only through voice → per-voice send (`reverbSend × track gain`) → `drumSendFilter` bank → `drumSendGate` → convolver | True | `audio/drumSynth.ts:393-402` `wireDrumVoice`; `masterRack.ts:571-574`, `:626` |
| F7 | `drumSendGate` follows the Beat bus level and mute: seeded from the bus at setup, then automated with it | True | `masterRack.ts:578` (seed); `:970-979` `applySourceLevel` writes `[bus, drumSendGate]` for `'sequencer'` |
| F8 | The Beat bus sits **after** the Beat bus filter: filter bank → `sequencer` tap → bus | True | `masterRack.ts:566` `buildBeatFilterBank(this.getSourceTap('sequencer'))`; the tap feeds the bus (`:953-963`) |
| F9 | Setup builds the Beat bus **before** the send gates exist | True | `masterRack.ts:566` (Beat bus) runs before `:586` (`createSendGates`). README A1 records the same order |
| F10 | The convolver input sums two feeds, connected in this order: `reverbSendGate`, then `drumSendGate`; `updateReverbSend` connects and disconnects both together | True | `masterRack.ts:620`, `:626`; `:799-827` |
| F11 | Bus state reaches the engine only through `engineSync.ts`, one subscription per `SOURCE_BUSES` row, `sourceTransitionTime()` for song seams; `applySliceState` and the transport-start block re-settle every bus | True | `store/engineSync.ts:148-166`, `:231-233`, `:295-303`, `:416-432`; `store/sourceTransition.ts` |
| F12 | The WAV renderer settles song-level bus state at t=0, then applies each loop's `buses` at every pass start (`'settle'` at 0, `'transition'` later) | True | `audio/export/renderMixdown.ts:94-106`, `:116-127`, `:130-138` |
| F13 | `MixdownBusState` is `{source, gain, muted}`; `buildMixdownSnapshot` builds both the song-level and per-loop rows from `SOURCE_BUSES` | True | `audio/playback/plan/songSnapshot.ts:37-41`; `store/mixdownSnapshot.ts:29-68` |
| F14 | Loop content is validated only by `sanitizeContent` → `sanitizeLoops`; `sanitizePersistedState` does not carry loop content | True | `store/projectFile.ts:60-63`; `store/sanitize.ts:617-741`; `store/store.ts:227-285` (session keys and libraries only) |
| F15 | The loop-copy groups must cover `LOOP_FLAT_KEYS` exactly, and the mixer fields are in the `mix` group | True | `store/loopCopy.ts:40-43` (docblock; `loopCopy.test.ts` asserts), `:145-160` |
| F16 | The golden is a SHA-256 of a 16-bit PCM WAV rendered in `node-web-audio-api`, plus a call log of six named engine methods | True | `renderMixdownGolden.test.ts:36-43` (`METHODS`, `setSourceState` included); `utils/encodeWav.ts:71` (`setInt16`) |
| F17 | The mixdown fixture spells bus rows as literals | True | `audio/export/mixdownFixture.ts:132`, `:144` |
| F18 | The Mixer row reads its fader and mute with narrow per-row selectors; the fader writes the slice on every move (a legacy of the old design; the new knobs do not copy it, §7) | True | `components/loop/SoundMixer.tsx:119-127`, `:201-208` |
| F19 | Effects-rack knobs keep drag state in a local draft, preview straight to the engine through a store module, and commit once | True | `components/song/useEffectsDraft.ts:45-104`; `store/effectsPreview.ts:28` |
| F20 | `masterRack.ts` is near the ESLint `max-lines` cap (750 lines of code; about 640 today) | True | `eslint.config.js:267`; the count skips blank lines and comments |
| F21 | The per-voice Beat send is labelled "Reverb" on seven voice controls; no tooltip. `formatPercent` is private to the schema | True | `components/loop/beat/beatControlSchema.ts:91-94`, `:177`, `:197`, `:207` … |
| F22 | Sources outside the six never reach `getSourceBus`: synth voices reach a bus through `getSourceTap(source)` with a synth source id; drums reach it through the Beat filter bank | True | `audio/runtime/audioSession.ts:46-47`; `masterRack.ts:566` |

**The byte-identical-default claim (decision 3) holds, with two conditions the implementation
must keep.**

- Every non-Beat bus goes through a new send `GainNode` at 1.0 before its gate. Multiplying by
  1.0 is exact in IEEE float, so each gate still receives the same samples.
- Beat's new delay and distortion sends run at 0.0. They add `+0` to their gate's sum, and
  adding `+0` is exact. A `−0` would become `+0`, but that cannot reach the file: the WAV is
  16-bit PCM (F16), and both zeros encode to the same bytes.
- Beat reverb: the `drumSendGate` output passes through a new send at 1.0 (§4.2), so the
  convolver input is still `reverbSendGate + drumSendGate × 1`.

The two conditions:

- **(C1)** The convolver's two inputs stay connected in F10's order: `reverbSendGate` first, then
  the Beat reverb feed. Float addition is not associative. Folding the Beat feed into
  `reverbSendGate` would change the order of the sum and could change bytes, so it is rejected
  (§4.2).
- **(C2)** No new call goes through a method in the golden's `METHODS` list. Sends get their own
  engine method, never `setSourceState` (F16).

The golden test is the proof. It must pass with `renderMixdownGolden.wav.sha256` and
`renderMixdownGolden.calls.json` unchanged.

---

## 1. Goal

Each of the six tracks gets its own send levels into the existing shared master reverb, delay
and distortion. The levels are stored per loop and flow through undo, loop duplication, loop
copy, `.solna` save/open, live song playback and WAV export. The Beat track becomes an ordinary
track for delay and distortion. For reverb, its per-voice `reverbSend` becomes a per-voice
multiplier of the track's reverb send.

## 2. Non-goals

- New effect types, and per-track insert effects (an effect instance per track).
- Splitting up `MasterRack` (README "Large files"). This change adds one small helper module
  (§4.1) only to stay under the line cap.
- Send knobs on the Arrange loop cards: `LoopMixPatch` and `components/mixLayers.ts` do not
  change.
- Dry stems (DEV-429). Stems will be taken dry, at the bus after its fader, with sends ignored.
  That is decided in DEV-429; nothing here depends on it.
- Pre-fader sends, or a send pan.
- MIDI export: sends are mix, and mix is outside MIDI's scope (ADR-0036).

---

## 3. Persisted shape, defaults, validation

### 3.1 Types (`src/types.ts`, beside `BeatMix`)

```ts
/** The three shared master effects a track can send into, in knob order. */
export const SEND_EFFECTS = ['reverb', 'delay', 'distortion'] as const;
export type SendEffect = (typeof SEND_EFFECTS)[number];

/** One track's send levels: LINEAR gain, 0..1, applied after the track's fader and mute. */
export type TrackSendLevels = Record<SendEffect, number>;

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

**Keyed by engine source id** (`'synth'`, `'sequencer'`), not by mixer id (`'drum'`) or solo id
(`'drums'`, `'lead'`). Every reader already holds a `SourceBusId`: `engineSync` and
`mixdownSnapshot` iterate `SOURCE_BUSES`, and the Mixer row has `channel.engineSource`. So
`trackSends[bus.source]` needs no translation table. `TrackSends` is spelled out instead of
`Record<SourceBusId, …>`, because `SourceBusId` is derived from `SOURCE_BUSES`. A type-level
pin in `sourceBuses.test.ts` asserts `keyof TrackSends` equals `SourceBusId` in both directions.
*Rejected:* keying by mixer id `'drum'`. That would need a second name map beside the three
`SOURCE_BUSES` already translates between.

Field names are plain `reverb`/`delay`/`distortion`. The unit (linear 0..1) is stated once on
`TrackSendLevels`, the way R197 treats unitless 0..1 fields such as `resonance`.

### 3.2 Loop field

`Loop` (`store/types.ts`) gains `trackSends: TrackSends`, and `'trackSends'` is appended to
`LOOP_FLAT_KEYS` after `'fxMuted'`. That one line brings it into:

- `LoopContent` (loop.test.ts's compile pin, R282);
- the flat↔loop mirror (`loopSync.ts`);
- `loadLoop`, `cloneLoop` (duplication), `deleteLoop`/`restoreLoop` (undo);
- `PROJECT_LOOP_KEYS` (`.solna` body) and `buildMixdownSnapshot`'s `...loop` spread.

It also joins the `mix` group in `LOOP_COPY_GROUPS` (`loopCopy.ts:145`), because the copy
partition test requires every key in exactly one group (F15) and sends are part of the mixer
strip.

### 3.3 Defaults (`store/loopDefaults.ts`, R283)

`createDefaultLoopContent()` writes a fresh object per call:

```ts
trackSends: {
  synth:     { reverb: 1, delay: 1, distortion: 1 },
  chord:     { reverb: 1, delay: 1, distortion: 1 },
  bass:      { reverb: 1, delay: 1, distortion: 1 },
  pad:       { reverb: 1, delay: 1, distortion: 1 },
  fx:        { reverb: 1, delay: 1, distortion: 1 },
  // Beat was dry into delay and distortion before DEV-423; reverb 1 keeps its
  // per-voice reverbSend path at exactly today's level.
  sequencer: { reverb: 1, delay: 0, distortion: 0 },
},
```

No other file writes these literals. The sanitizer takes them from `createDefaultLoop()`'s
`fallback`, and the slice takes them from `defaults`. The one exception is the mixdown test
fixture (§8).

### 3.4 Validation (`store/sanitize.ts`, R214 / R035 / R219)

`sanitizeLoops` gains `trackSends: sanitizeTrackSends(r.trackSends, fallback.trackSends)`, a new
exported function in `sanitize.ts`:

- The value is not a plain object (`isPlainObject`) → a structured clone of `fallback`.
- Per source (`synth` … `sequencer`): the row is not a plain object → that source's fallback row.
- Per effect: `clampFinite(v, 0, 1, fallbackRow[effect])`. A non-number or non-finite value
  takes the default; an out-of-range number is clamped (the existing `clampFinite` rule);
  an in-range value passes untouched.
- Unknown sources and unknown effect keys are dropped. The result is always a freshly built
  literal; nothing from the raw input is passed through by reference.

There is no version gate and no bump of `PERSIST_VERSION` or `PROJECT_FORMAT_VERSION`. A body
written before DEV-423 has no `trackSends`, so it reads back with the defaults, which is
byte-identical audio. `sanitizePersistedState` does not change, because loop content never
passes through it (F14). `sanitizeContent` picks the field up through `sanitizeLoops`, its only
caller (R217).

---

## 4. Audio graph

### 4.1 Target routing

```
                  (fader + mute)
 voice ─► tap ─► bus[src] ───────────────────────────────► dryGain ─► EQ ─► master
                   │
                   ├─► send[src].reverb     (gain = rev)  ─► reverbSendGate ─┐  (not for sequencer)
                   ├─► send[src].delay      (gain = dly)  ─► delaySendGate ──┼─► effect nodes
                   └─► send[src].distortion (gain = dist) ─► distortionSendGate ┘   (wet knobs, bypass
                                                                                    and idle disconnect
                                                                                    are unchanged)
 Beat, reverb only:
 drum voice ─► trackGain ─► drumBusFilter bank ─► tap ─► bus[sequencer]   (dry + delay/dist as above)
     └─► per-voice send (reverbSend × trackGain) ─► drumSendFilter bank ─► drumSendGate
             ─► send[sequencer].reverb (gain = Beat rev) ─╌╌(toggled by updateReverbSend)╌╌► convolver
```

- Every one of the six buses owns three send nodes, `send[src].{reverb,delay,distortion}`.
  Nothing connects a bus straight to a gate. `SOURCES_WITHOUT_MASTER_SENDS` is deleted.
- **Post-fader, post-mute:** a send's input is the bus output, so fader, mute and solo (all
  written to the bus gain, F7/F11) apply to the sends too.
- **Beat reverb (decision 4):** `bus[sequencer]` has **no** edge into `reverbSendGate`. Its
  `send.reverb` node sits in series after `drumSendGate`, so Beat's per-voice reverb signal is
  multiplied by the Beat track's reverb send. This multiplies `drumSendGate`'s level by the
  reverb send, as decided, but as a separate node rather than by changing the automation on
  `drumSendGate` itself. That keeps `drumSendGate` driven only by `setSourceState`
  (`applySourceLevel`, F7), so no second writer can change its timeline.
- `updateReverbSend`'s second feed moves from `drumSendGate → convolver` to
  `send[sequencer].reverb → convolver`. The feed is still connected second (condition C1).
  `drumSendGate → send[sequencer].reverb` is a permanent edge. The shared tail timer and the
  `drumSendReverbConnected` bookkeeping keep their logic; only the node they toggle changes.
- *Rejected:* `send[sequencer].reverb → reverbSendGate` (one convolver feed). It is simpler,
  but it reorders the convolver's input sum and breaks C1.
- *Rejected:* a bus→reverb send for Beat as well. Beat would get reverb twice, and every
  project's drum reverb would change.

### 4.2 Construction order

`setupMasterChain` calls `createSendGates()` **before** it builds the Beat filter bank. The Beat
bus (F9) is then created with its delay and distortion sends wired. `getSourceBus` wires the
sends unconditionally and throws if the gates are missing (`'send gates not initialized'`),
matching its existing throw when `dryGain` is missing. This makes the construction-order
dependency a checked precondition instead of the silent accident README A1 describes.

`getSourceBus` creates all three send nodes for every source, `sequencer` included. For
`sequencer` it connects only the delay and distortion nodes from the bus; its reverb node has no
input yet. `setupMasterChain` then connects:

- `drumSendGate → sourceSendNodes('sequencer').reverb`, right after it creates `drumSendGate`
  (today's `:571`);
- that reverb node → the convolver, where `:626` connects `drumSendGate` today. This is after
  `reverbSendGate` (`:620`), which satisfies C1.

### 4.3 New module `src/audio/sourceSends.ts`

This keeps the new graph code out of `masterRack.ts`: `max-lines` has about 110 lines of code
left (F20), and `setupMasterChain` is under the 100-line `max-lines-per-function` cap. It holds
no state.

```ts
import type { SendEffect, TrackSendLevels } from '../types';
import { SEND_EFFECTS } from '../types';
import { applySourceBusAutomation, type SourceBusApplyMode } from './automation/sourceBusAutomation';

export type SourceSendNodes = Record<SendEffect, GainNode>;

/** Clamp each level to 0..1; a non-finite level becomes 0. */
export function clampSendLevels(sends: TrackSendLevels): TrackSendLevels;

/** Three GainNodes seeded at `seed` (0 for any effect with no level yet). */
export function createSourceSendNodes(ctx: BaseAudioContext, seed: TrackSendLevels | undefined): SourceSendNodes;

/** Automate all three nodes to `sends` at `at`, using the bus's own time constant and modes. */
export function applySourceSendLevels(
  nodes: SourceSendNodes, sends: TrackSendLevels, at: number, mode: SourceBusApplyMode, now: number,
): void;
```

It uses `applySourceBusAutomation`, so a send ramps exactly like a fader: a 10 ms time
constant, `'settle'` at a render's t=0, and cancel-and-hold for a transition.

### 4.4 Engine API

`MasterRack`:

```ts
private sourceSendNodes = new Map<string, SourceSendNodes>(); // cleared with sourceBuses
private sourceSends = new Map<string, TrackSendLevels>();      // survives pre-init, like sourceGains

setSourceSends(
  source: string, sends: TrackSendLevels, time?: number, mode: SourceBusApplyMode = 'transition',
): void
```

1. Clamp and store in `sourceSends`. With no context yet, return (the `setSourceState`
   precedent, `masterRack.ts:981-995`).
2. `at = max(time ?? now, now)`. Get the source's nodes (`getSourceBus(source)` creates the bus
   and its sends if needed), then call `applySourceSendLevels`.

A send node is **seeded from `sourceSends`, or 0 when no level has been received.** A send is
silent until it is told a level, following the "every wet send is seeded at ZERO" precedent
(`masterRack.ts:580`). The store's defaults arrive through `applyEngineSnapshot` live and through
`applyMasterState` offline (§5), both before the first note. There is therefore one source of
default truth, `createDefaultLoopContent`. *Rejected:* seeding at 1 (0 for the Beat's delay and
distortion). That would repeat the store defaults inside `audio/`.

`AudioEngine` (`engine.ts`) gains a one-line pass-through, `setSourceSends(source, sends, time?,
mode?)`, next to `setSourceState`. The live engine and the render engine share it (ADR-0021,
R209).

---

## 5. Store → engine

### 5.1 Slice

New `src/store/trackSendsSlice.ts`, composed in `store.ts` over `setWithLoopMirror` with
`defaults`:

```ts
export interface TrackSendsSlice {
  trackSends: TrackSends;
  /** Replace one track's three levels (clamped 0..1). Writes only that track's row. */
  setTrackSends: (source: SourceBusId, sends: TrackSendLevels) => void;
}
```

It writes `{ trackSends: { ...state.trackSends, [source]: clamped } }`: a new outer object and a
new row, so the other five rows keep their references (R210). `AppStore` extends
`TrackSendsSlice`.

### 5.2 `engineSync.ts` (R224, R226)

- Subscriptions: one per `SOURCE_BUSES` row. The selector is `(s) => s.trackSends[bus.source]`,
  a stable reference, compared with the default `Object.is`. The listener is
  `audioEngine.setSourceSends(bus.source, sends, sourceTransitionTime(), 'transition')` with
  `fireImmediately: true`. `sourceTransitionTime()` puts a song-mode seam's new sends on the
  boundary where that seam's fader and mute changes land (F11).
- `applySliceState`: after the `pushSourceState` loop, one `setSourceSends(bus.source,
  s.trackSends[bus.source], undefined, 'settle')` per bus.
- Transport-start block (`:426-428`): the same settle push, next to `pushSourceState`, so a
  restart settles sends the way it settles bus state.
- **Solo and mute need nothing here.** Sends read no audibility. `busAudible` stays the only
  audibility read (R160), and it already zeroes the bus that feeds the sends. A muted or
  unsoloed track therefore sends nothing, and tails already inside the reverb or delay decay
  naturally (the `setSourceMuted` contract).

### 5.3 Drag preview

New `src/store/trackSendsPreview.ts`:
`previewTrackSends(source: SourceBusId, sends: TrackSendLevels): void`. It calls
`audioEngine.setSourceSends(source, sends)` with a docblock reason, the same shape as
`effectsPreview.ts`. It joins R225's list of direct-engine store modules, in the previews
category.

### 5.4 Mixdown (`mixdownSnapshot.ts`, `renderMixdown.ts`)

- `MixdownBusState` (`songSnapshot.ts:37`) gains `sends: TrackSendLevels`.
  `buildMixdownSnapshot` fills it from `s.trackSends[bus.source]` for the song-level rows and
  from `loop.trackSends[bus.source]` for each loop's rows. The values are already linear, so
  there is no conversion.
- `applyMasterState`: after each bus's `setSourceState(…, 0, 'settle')`, call
  `engine.setSourceSends(bus.source, bus.sends, 0, 'settle')`.
- `applyLoopAudioState`: after each bus's `setSourceState`, call
  `engine.setSourceSends(bus.source, bus.sends, state.time, state.time === 0 ? 'settle' :
  'transition')`. It is unconditional, exactly like bus state, so a per-loop send change lands
  at that pass's first sample.
- `renderMidi.ts` does not change (sends are not part of MIDI).

---

## 6. Beat's per-voice `reverbSend`

The field, its presets, `sanitizeBeat.ts`, `check:drums` and the voice cards do not change. Its
meaning is restated: the voice's reverb amount as a **multiplier of the Beat track's reverb
send**. The effective drum reverb is `reverbSend × voice track gain × Beat bus level (0 when
muted) × Beat track reverb send`, measured before the master `reverbWet`.

- The docblock on `reverbSend` in `src/types.ts` (the three occurrences, `:248`, `:264`, `:282`)
  is reworded to say this.
- The knob label stays **"Reverb"**. It has no tooltip (F21). "Reverb" still names what the knob
  does to that voice, and the ~48 px knob label has no room for "Reverb × track". No UI text
  changes.
- `reverbSend = 0` still builds no per-voice send node (`wireDrumVoice` returns `null`, F6).
  That voice is dry into reverb whatever the track send is. Delay and distortion are not
  per-voice: they take the whole Beat bus after its filter (F8).

---

## 7. UI — `src/components/loop/SoundMixer.tsx`

- A child component `TrackSendKnobs` is defined above `MixerRow` (R267) and rendered in each
  `MixerRow` under the fader and meter stack. It draws three `Knob`s (`ui/Knob.tsx`):
  - `size="xs"`, `min 0`, `max 1`, `step 0.01`;
  - `color={channel.accentClass}` (already a `KnobColor`, `mixLayers.ts:99-100`; theme roles
    only, so there are no new tokens and `check:theme` / `check:contrast` are not affected);
  - `label` `Rev` / `Dly` / `Dist`;
  - `ariaLabel` `` `${channel.label} reverb send` `` (and `delay send`, `distortion send`);
  - `id` `` `knob-send-${channel.idPrefix}-${effect}` ``;
  - `format={formatPercent}`.
- `formatPercent` moves from `beatControlSchema.ts` (private) to `src/utils/gainUnits.ts`,
  exported beside `formatDb`. It then has two readers (R276), and the schema imports it.
- **Logic lives in the colocated hook** `src/components/loop/useTrackSendsDraft.ts` (R265/R266):

  ```ts
  export interface UseTrackSendsDraft {
    sends: TrackSendLevels;                                  // draft while dragging, else committed
    onChange: (effect: SendEffect, value: number) => void;  // draft + previewTrackSends, no store write
    onCommit: () => void;                                   // setTrackSends(source, draft), once
    onCancel: () => void;                                   // revert draft, preview committed
  }
  export function createTrackSendsDraftMachine(committed: TrackSendLevels, source: SourceBusId); // pure, testable
  export function useTrackSendsDraft(source: SourceBusId): UseTrackSendsDraft;
  ```

  This copies the `createEffectsDraftMachine` / `useEffectsDraft` design, reusing
  `useDraftGestureForceRender`. The value being dragged stays local (R016, R272), and the
  persisted field is written once, on release (R212).
  *Rejected:* copying the fader's write-on-every-move. That puts a knob's mid-drag value in a
  slice, which R016 forbids, and the fader is legacy behaviour, not a pattern to copy.
- **Selectors:** `TrackSendKnobs` calls the hook once (R268). Inside it,
  `useAppStore((s) => s.trackSends[source])` returns the stored row by reference, never a fresh
  object (R274/R275), and `useAppStore((s) => s.setTrackSends)`. A knob move re-renders one row.
- The group layout (`MIXER_GROUP_PLACEMENT`) does not change. The knobs sit in a
  `flex gap-2` line under each row's fader and meter.
- `MixerRow` gains one line (`<TrackSendKnobs source={channel.engineSource} … />`), and all new
  logic lives in the hook. That is not a substantial edit of `MixerRow`, so its existing
  selectors and inline focus handler are left alone (R273 scope, R271). The new child follows
  R265 fully.

---

## 8. Edge cases

| Case | Behaviour |
|---|---|
| Muted track | Bus gain 0 → every send 0 from that instant (10 ms ramp); tails already in reverb/delay decay naturally |
| Solo elsewhere | `busAudible` false → bus 0 → sends 0. A soloed track's sends apply as set; the master effects hear only audible tracks |
| Fader at the bottom | `faderDbToGain` gives exactly 0, so sends pass nothing |
| Send 0, fader up | Track dry only for that effect; the other two sends are independent |
| Master wet 0 or bypassed | The gate disconnects as today (`DebouncedSendGate` / `updateReverbSend`); sends are unaffected and apply again when the effect returns |
| Beat, voice `reverbSend = 0` | No per-voice send node, so that voice has no reverb even with Beat reverb send at 1 |
| Beat reverb send 0 | No drum reverb from any voice; Beat delay/distortion still follow their own sends |
| Beat delay > 0 | The whole kit, after the filter and fader, feeds the delay (new capability) |
| `trackSends` missing (old body) | Defaults → audio byte-identical to before DEV-423 |
| `trackSends` garbled | Per §3.4: non-object → defaults; bad row → that row's defaults; `NaN`/string → that effect's default; `1.7` → 1, `-0.2` → 0; extra keys dropped |
| Loop duplicate / copy "Mix" / delete + Undo | Carried with the loop (LOOP_FLAT_KEYS, `mix` group, `DeletedLoop.loop`) |
| Song mode seam | The new loop's sends land at the seam (`sourceTransitionTime`), same as its faders |
| Context rebuilt (audio recovery) | New `MasterRack`: send nodes are seeded at 0 until `applyEngineSnapshot` pushes the store values, the same window bus gains have |
| Drag cancelled / row unmounts mid-drag | `onCancel` / `cancelIfDragging` previews the committed row back; no store write |
| Vibe applied | `trackSends` untouched (vibes write no mixer sends) |

---

## 9. Testing

- **`masterRack.sendGates.test.ts` (rewrite the routing blocks; the idle-disconnect tests stay).**
  - Each of the six buses connects to its own three send nodes. Only those nodes connect to the
    gates. No bus connects straight to a gate.
  - The `sequencer` bus has delay and distortion sends and no edge into `reverbSendGate`.
  - `drumSendGate → send[sequencer].reverb` is permanent. The second convolver feed is
    `send[sequencer].reverb`, connected after `reverbSendGate` (C1).
  - The shared reverb tail tests are rewritten against `send[sequencer].reverb`.
  - The Beat bus built by `setupMasterChain` has its delay and distortion sends. So does a Beat
    bus created later, in both the live and the render engine. `getSourceBus` before the gates
    exist throws.
- **Send levels** (`masterRack.sourceBus.test.ts`): `setSourceSends` clamps; before init, the
  levels are stored and later seed the lazily built nodes; with no stored level, a node seeds
  at 0; `'settle'` and `'transition'` use `applySourceBusAutomation`; `setSourceState` never
  touches a send node, and `setSourceSends` never touches the bus or `drumSendGate`.
- **Beat routing** (render engine, `node-web-audio-api`): a snare with `reverbSend > 0` and Beat
  reverb send 0 leaves the reverb path silent. Beat delay send 1 puts energy on the delay
  return, and 0 leaves it silent.
- **Sanitizer** (`sanitize.test.ts`): each §3.4 rule. A loop with no field gets the defaults
  (Beat delay and distortion 0). The result shares no reference with the input.
- **Store:** `loop.test.ts` compile pin (automatic); `loopCopy.test.ts` partition (after the
  `mix` edit); `trackSendsSlice` writes one row and keeps the other five rows' references;
  the mirror carries it into `loops[active]`; duplication deep-copies it.
- **`engineSync.test.ts`:** a `setTrackSends` write calls `audioEngine.setSourceSends` for that
  source only. `applyEngineSnapshot` settles all six. A solo or mute change makes no
  `setSourceSends` call. A write inside `withSourceTransitionTime(t, …)` passes `t`.
- **Mixdown:** `mixdownSnapshot.test.ts` puts `sends` on the song and per-loop rows and asserts
  the fixture's literal defaults equal `createDefaultLoopContent().trackSends`.
  `renderMixdown.sourceBus.test.ts` checks that two loops with different Chord reverb sends
  produce `setSourceSends('chord', …)` at each pass's start time, `'settle'` at 0 and
  `'transition'` after.
- **Golden:** `renderMixdownGolden.test.ts`, `.wav.sha256` and `.calls.json` are **unchanged**
  and pass. `mixdownFixture.ts` gains `sends` on its two bus literals (the defaults).
- **UI:** `SoundMixer.test.tsx` checks 18 send knobs with the ids and aria-labels from §7, and a
  row's knobs showing that row's committed values. `useTrackSendsDraft.test.ts` tests
  `createTrackSendsDraftMachine`: `onChange` previews and does not write, `onCommit` writes
  once, `onCancel` reverts and previews the committed row. The preview is spied through
  `trackSendsPreview`.
- `formatPercent` move: the existing `beatControlSchema.test.ts` stays green.

---

## 10. Rules, ADR and doc sync (same branch)

**ADR-0037** "Per-track sends into the shared master effects": context (README deferred item,
A1), the decisions in §12, the rejected alternatives in §3–§7, and the note that DEV-429 stems
take the dry post-fader bus. Add a row to the index in `docs/decisions/README.md`.

**Rules** (each with a `## Prohibited` entry in its file):

- **R301** (`loops-and-solo.md`, Loop content) — `trackSends` is per-loop content: it is in
  `LOOP_FLAT_KEYS` and the `mix` copy group, keyed by engine source id, with linear 0..1 levels.
  Its default is written only in `createDefaultLoopContent`: 1/1/1 on every track, except
  `sequencer` delay 0 and distortion 0.
  *Prohibited:* a `trackSends` default literal outside `createDefaultLoopContent`.
- **R302** (`persistence.md`, Validation) — `sanitizeTrackSends` validates the field on every
  loop read: non-object → default, bad row → that row's default, non-finite → default,
  out-of-range → clamped. No version gate.
  *Prohibited:* a version gate or migration for `trackSends`.
- **R303** (`synth-voices.md`, new section "Master sends") — Each source bus reaches the send
  gates only through its own three send nodes, taken after the fader and mute. No bus connects
  straight to a gate, and no source is excluded by name. `getSourceBus` requires the gates.
  *Prohibited:* a bus→gate edge; a per-source send exclusion set.
- **R304** (`synth-voices.md`, Master sends) — Beat has no bus→reverb send. Its reverb is the
  per-voice path `drumSendFilter → drumSendGate → send[sequencer].reverb → convolver`. That
  feed is connected after `reverbSendGate`, and `drumSendGate` is written only by the bus
  level/mute path.
  *Prohibited:* feeding Beat reverb from the bus; folding the Beat feed into `reverbSendGate`.
- **R305** (`beat.md`) — A voice's `reverbSend` multiplies the Beat track's reverb send. It is
  not a direct send to the master reverb.
- **R306** (`playback.md`, Clock and engine bridge) — Sends reach the engine only through
  `engineSync`'s per-bus `trackSends` subscription, the drag preview
  (`store/trackSendsPreview.ts`), and `renderMixdown`'s per-pass `setSourceSends` (applied
  beside `setSourceState`). Sends never read solo or audibility.
  *Prohibited:* sends routed through `setSourceState`; a component calling the preview for
  anything but a drag.

Also:

- `synth-voices.md` `paths:` gains `src/audio/sourceSends.ts`.
- `playback.md` R225's list gains `trackSendsPreview`.
- `CLAUDE.md` rules-table row for `synth-voices.md` gains "per-track master sends", because its
  coverage changes. No new cross-cutting invariant line.
- `.claude/skills/dsp-audio/SKILL.md` lines 127 and 246 are rewritten (no exclusion set; add a
  send node per effect).
- `docs/architecture/feature-overview.md` row 1: "sound mixer" → "sound mixer with per-track
  reverb/delay/distortion sends".
- `docs/architecture/structure/`:
  - `03-audio.md` §§ around :128-204 and :423: routing prose and the mermaid diagram (Beat
    edges to the delay and distortion gates; `send[sequencer].reverb`); add `sourceSends.ts`
    to the module table.
  - `02-store.md`: slice list gains `trackSendsSlice`; direct-engine list gains
    `trackSendsPreview`.
  - `01-ui.md`: Mixer row knobs.
  - `README.md` :88 A1 status becomes "Superseded by DEV-423: Beat now has delay and distortion
    sends; its reverb stays per-voice × track send", and the :121 **Per-track FX** deferred
    item is marked done, pointing to ADR-0037.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | The golden hash changes through a summation-order change | C1/C2 in §0; the golden runs unchanged; the convolver feed order has its own routing test |
| K2 | `masterRack.ts` goes over `max-lines` / `max-lines-per-function` | Node code lives in `sourceSends.ts`; `setupMasterChain` gains about 3 lines; `bun run eslint` is part of the gate |
| K3 | A send node is used before its level is pushed (seeded 0) and a wet tail is missing | Live: `applyEngineSnapshot` runs after init. Offline: `applyMasterState` runs before scheduling. Both are tested |
| K4 | Beat delay on by default would change every project | The default is 0, and the golden pins it |

---

## 12. Decisions

1. Per-track **send levels** into the existing shared master reverb, delay and distortion; no
   effect instance per track.
2. Six tracks = `SOURCE_BUSES`; stored as `trackSends: TrackSends`, keyed by engine source id,
   levels linear 0..1, fields `reverb`/`delay`/`distortion`.
3. **Per loop**, in `LOOP_FLAT_KEYS` and the `mix` copy group; flows through undo, duplicate,
   copy, save and export.
4. Defaults 1/1/1, except Beat delay 0 and distortion 0 → audio byte-identical; the golden is
   unchanged.
5. Validated in `sanitizeLoops` (`sanitizeTrackSends`); no migration, no version bump.
6. Routing: bus (after fader and mute) → send node → existing gate, for every track;
   `SOURCES_WITHOUT_MASTER_SENDS` removed; master wet knobs remain the global amount.
7. Beat reverb: no bus send. The per-voice path goes through `drumSendGate` and then the Beat
   track's reverb send node, in series; the feed is connected after `reverbSendGate`.
8. Per-voice `reverbSend` is unchanged in data and UI (label "Reverb") and redefined as a
   multiplier of the Beat track reverb send.
9. Engine: `setSourceSends(source, sends, time?, mode?)`, a separate method from
   `setSourceState`; send nodes are seeded at 0 until told; node code is in
   `audio/sourceSends.ts`.
10. `engineSync`: one subscription per bus, a settle push in `applySliceState` and at transport
    start; solo and mute need nothing extra.
11. Mixdown: `MixdownBusState.sends`; applied at t=0 and at every pass boundary, beside bus
    state.
12. UI: Rev/Dly/Dist `xs` knobs in each Mixer row, a local draft with engine preview, committed
    once on release (`useTrackSendsDraft`).
13. DEV-429 stems: dry, at the bus after its fader, sends ignored (decided there).

## 13. Acceptance criteria

- Each of the six Mixer rows shows Rev/Dly/Dist knobs. Turning one changes that track's share of
  the effect as you drag, and the value is saved to the current loop on release.
- A second loop with different sends plays them from its first sample, in song mode and in the
  WAV.
- A project saved before DEV-423 opens and exports byte-identically:
  `renderMixdownGolden.wav.sha256` and `.calls.json` are unchanged.
- Beat can be sent to the delay and distortion. Its reverb scales with the Beat reverb send
  times each voice's "Reverb".
- A muted or unsoloed track feeds none of the effects.
- `SOURCES_WITHOUT_MASTER_SENDS` no longer exists.
- `bun run verify` is green; `bun run eslint` shows zero errors and zero warnings; both Knip
  scans are at zero.

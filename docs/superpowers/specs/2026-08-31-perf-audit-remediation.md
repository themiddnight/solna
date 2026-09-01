# Performance Audit Remediation — Design

Branch: `perf/audit-2026-08-31`. Input: four completed, read-only audits
(`/tmp/solna-audit/{react-perf,audio-perf,js-perf,simplify}.md`) covering React rendering,
the Web Audio engine, JS/bundle cost, and structural duplication. This document synthesizes
their findings into root causes, calibrates disagreements between lanes, and states what a
remediation branch must fix, must not touch, and must prove before it is done. It contains no
implementation steps — that belongs in a follow-up plan.

## 1. Context / problem statement

The four lanes were scoped independently (components+store, Web Audio graph, bundle/algorithm
cost, structural duplication) but converged on the same three mechanisms from four different
angles. That convergence is the headline finding: this is not four lists of unrelated nits,
it is three root causes with corroborating evidence in every lane that looked at them.

| Root cause | react-perf | audio-perf | js-perf | simplify |
|---|---|---|---|---|
| RC-1 voice lifetime has no owner | — | C1 (primary), I4 | — (M10 notes the mono-kill allocation this feeds) | — |
| RC-2 one pointer event fans out | C1, C2, C3 | I2, I3, I6 | Critical #1, #6 (dismissed as non-issue) | M2 (`HARD_STOP_RELEASE` dup, adjacent) |
| RC-3 step state owned too high | C4, I1, I3, I4, I5 | I5 | — | — (H1/H2 are a different axis: file size, not render rate) |

None of the four audits found the counterpart lanes' primary findings independently reported
as separate bugs — they found the *same* code paths and described the *same* mechanism in
their own vocabulary. Concretely:

- react-perf C2/C3 and audio-perf I2/I6 and js-perf Critical #1 all cite
  `src/store/loopSync.ts:16-27` and/or `src/store/store.ts:391-395` as the place a single
  `set()` call fans out into a second `set()` plus a synchronous serialize+write. Three
  independent reads of the same nine lines.
- react-perf C4/I1/I3/I4 and audio-perf I5 both independently traced all four clock-driven
  `setState` calls (`ArrangeView.tsx:87-89`, `useSequencerPlayback.ts:141`,
  `useLeadPlayback.ts:94`, `useChordPlayback.ts:611`) and reached the identical conclusion:
  state that only two conditionally-rendered leaves need is hoisted to the top of the three
  largest views, plus one raw-monotonic outlier in `ArrangeView` that can never bail out.
- audio-perf C1 (stranded voices) has no react-perf or js-perf counterpart because it is a
  pure engine-lifetime defect — but js-perf's M10-adjacent note about
  `reshapeableVoices()`'s per-call allocation (`engine.ts:1052-1066`) and audio-perf's own I3
  both observe that every stranded voice *permanently* inflates the cost of RC-2, i.e. RC-1
  and RC-2 compound each other rather than being independent.

The practical implication: fixing RC-2 without RC-1 leaves a system whose per-frame cost grows
without bound over a session (each stranded voice adds ~15-20 permanent AudioParam ops per
pointer frame, audio-perf C1/I3). Fixing RC-1 without RC-2 leaves the existing per-frame cost
un-reduced. Fixing RC-3 is independent of the other two but shares its symptom (main-thread
work at a clock rate on hidden tabs) closely enough that a profiler run done for one will show
the other.

## 2. RC-1 — Voice lifetime has no owner

**Mechanism, end to end.** `triggerSynthNoteOn` (`src/audio/engine.ts:716`) registers a voice in
`activeVoices` and `sourceVoices` (`:722`) and starts its oscillators. Teardown happens in
exactly one function, `teardownVoiceNodes`, reached from exactly two call paths: the
`setTimeout` armed inside `releaseVoice` (`:852`) and `silenceVoiceNow`. Both paths are reached
only by `triggerSynthNoteOff` / `stopSource` / `releaseSoundingVoices` — i.e. only by an
explicit, successfully-delivered note-off. There is no `onended` fallback on the oscillators
and no maximum-lifetime timer anywhere in the engine (audio-perf C1).

Three UI paths can fail to deliver that note-off:

1. **Window blur while a key is held.** `useInputDeck.ts:288-292` binds `keydown`/`keyup` on
   `window` with no `blur`/`visibilitychange` handler. Cmd-Tab, a click into another window, or
   any OS shortcut that steals the keyup leaves the voice on. The same file's `handleKeyUp`
   also early-returns on `isTypingTarget(e)`, so releasing into a text input silently drops the
   note-off too.
2. **OS-interrupted touch.** `Keyboard.tsx` binds `onMouseUp`/`onMouseLeave`/`onTouchEnd` but no
   `onTouchCancel`. An incoming call or a gesture takeover on mobile never fires `touchend`.
3. **MIDI device unplug.** `midiInput.ts:101`'s `onstatechange` re-attaches handlers on
   reconnect but never flushes notes that were held when the device disappeared.

**Why fixing the three paths is necessary but insufficient.** Each is a distinct, disjoint
failure surface — a fourth will exist the next time a new note-on source is added (the audit
does not claim these three are exhaustive, only that they are the three found by tracing every
call site that can produce a note-on). Patching all three still leaves the engine with no
invariant: "every voice terminates" would remain true only by enumeration of every caller,
which is exactly the kind of invariant that erodes the next time someone adds a MIDI mode or a
touch gesture. The engine needs its own backstop — `onended` wired at voice creation plus a
`MAX_VOICE_LIFETIME` guard timer in `triggerSynthNoteOn` — so the leak is unreachable
regardless of what any current or future UI path does (audio-perf C1 proposed fix).

**Compounding effect.** A stranded voice has no `releaseScheduledAt`, so it stays permanently
eligible in `reshapeableVoices()` (`engine.ts:1049-1067`) and is re-targeted by every
`updateSynthParams` / `applySynthVelocityScale` call for the rest of the session — this is the
direct link into RC-2: each stranded voice adds ~15-20 AudioParam operations to every future
knob-drag frame, permanently (audio-perf C1, I3). It also lingers in
`arpStateRef.current.activeNotes` (`useInputDeck.ts`), so enabling the arpeggiator afterward
arpeggiates a phantom pitch. Partial, incomplete recovery exists today: re-pressing the exact
same key hits the same-note dedup (`engine.ts:607-610`) and releases the old voice — nothing
else recovers it, not Stop, not a tab switch, not a preset change.

**Related, same root cause:** audio-perf I4 (no voice cap / steal policy — the same "nothing
owns voice count" gap, one order up: unbounded polyphony rather than unbounded lifetime) and
I8 (AudioContext never suspended — same absence-of-an-owner shape at the context level).

## 3. RC-2 — A single pointer event fans out into six expensive operations

Traced for one `pointermove` on a knob (`Knob.tsx:304-318`, `handlePointerMove`, called
synchronously and unthrottled on every native `pointermove`, no rAF coalescing of its own —
Chrome itself coalesces pointermove to roughly one per frame, ~60 Hz, which is what bounds the
damage rather than anything in this codebase):

| # | Step | Site | Cost |
|---|---|---|---|
| 1 | `onChange` → `setSynthParams({...params, x: v})` → `set({synthParams})` | `synthSlice.ts:23` | new object identity |
| 2 | `useInputDeck.ts:83` subscribes to the whole `synthParams` object at App level | `useInputDeck.ts:83`, mounted in `App.tsx:71` | re-renders `App`, cascading into `SynthView`, `SequencerView`, `ArrangeView`, `BottomInputDock` + `ChromaticKeyboard` — three of five on hidden tabs (react-perf C1) |
| 3 | `loopSync` mirrors the changed field into `loops[]` with a **second**, independent `setState` | `loopSync.ts:16-27` | new `loops` array identity → `ArrangeView`, `TransportBar`, `LoopSelector` re-render; defeats the dnd-kit `SortableContext` memo for every `SortableLoopCard` (react-perf C2) |
| 4 | `persist` middleware intercepts **every** `setState`, unconditionally, regardless of whether the touched field is even in `partialize` | `node_modules/zustand/esm/middleware.mjs:358-368`, wired at `store.ts:391-395` | full `JSON.stringify(loops + presets + progressions + effects)` + synchronous `localStorage.setItem` — **twice**, once for step 1 and once for step 3's mirror `setState` (js-perf Critical #1) |
| 5 | `engineSync.ts` forwards the object to `updateSynthParams` over `reshapeableVoices()` | `engine.ts:1160-1215`, driven from `engineSync.ts:115-123` | ~15-20 AudioParam ops (`cancelAndHold` + `setTargetAtTime` per param) **per live voice** — each `cancelAndHold` takes the AudioParam timeline lock, contending with the render thread (audio-perf I3) |
| 6a | If the knob is Reverb Decay: `updateEffects` re-quantizes and swaps the convolver buffer | `engine.ts:1514-1517`, `getImpulseResponse` `:511-528` | 0.8-3.0 ms JS impulse rebuild (measured) discarding up to 3.8 MB of `Float32Array`, plus an unmeasurable-here but conceded-expensive `ConvolverNode.buffer =` re-partition that takes the graph lock (audio-perf I2) |
| 6b | `useSequencerPlayback`'s clock-subscribing effect has `synthParams` inside a `useCallback` dep chain | `useSequencerPlayback.ts:79-104`, `:144` | unsubscribe + resubscribe the 25 ms clock listener every frame — currently non-fatal only because `usePlayheadSync` independently keeps the listener count above zero (audio-perf I6, react-perf I2) |

All six steps run on the **same main thread** that also owns the 25 ms lookahead scheduler
(`engine.ts`'s clock, stall threshold 50 ms, `engine.ts:294`). Step 6a alone, during a 2-second
Decay sweep, produces 60-100 impulse rebuilds and re-partitions — audio-perf calls this "the
single most likely source of dropouts during ordinary use," and it is directly downstream of
step 5's `engineSync` fan-out having no coalescing.

The unifying property across steps 2, 3, and 6b is **identity, not content**: in every case a
derived value (the whole `synthParams` object, the whole `loops` array, a `useCallback`'s dep
list) changes reference on every frame even though only one field changed, and something
downstream compares by reference (`Object.is`, dnd-kit's `useMemo` on `items`, a `useEffect`
dep array). Step 4 is the one exception — it has no identity check at all; every `setState`
writes, unconditionally, whether or not the changed field is persisted.

## 4. RC-3 — Step state is owned too high

Four clock-driven `useState`s sit at the top of the app's three largest views plus one in the
lower `ArrangeView`, all fed by the same 8 Hz (at 120 BPM) 16th-note clock:

| Site | Consumed at | Bails out on repeat? |
|---|---|---|
| `useChordPlayback.ts:611` `setCurrentStep(step % stepsPerBar)` | `ChordView.tsx:243`, used only inside two `{mode === 'custom' && …}` branches (`:865`, `:1266`) | yes, but still 8×/sec because the modulus rarely repeats consecutively |
| `useLeadPlayback.ts:94` `setCurrentStep(step % melodyLength)` | `LeadPianoRoll.tsx:303`, one `translateX` | yes, same caveat |
| `useSequencerPlayback.ts:141` (via `:144`) | `SequencerView.tsx:346,355` → `StepHeader` + every `TrackRow` | yes, same caveat |
| `ArrangeView.tsx:87-89` `setCurrentStep(step)` — **raw monotonic step, no modulus** | `ArrangeView.tsx:193-213`, per-loop progress | **no** — this value never repeats, so this component can never bail out of a scheduled re-render |

Because `App.tsx:107-112` keeps all four tab views mounted (`block`/`hidden`) by design — audio
must not stop when switching tabs — every one of these renders fires whether or not its tab is
visible. During any playback, four views re-render 8×/sec; three of the four are on hidden tabs
for any given active tab. `ChordView` (146 JSX nodes, 1342 lines) and `SynthView` (174 JSX
nodes, 1208 lines) are the two largest views in the app, and both carry one of these subscribers
at their root rather than at the one or two leaf components that actually consume the value
(react-perf C4, I1, I3, I4; audio-perf I5, arriving at the same four call sites
independently).

`ChordView` compounds this with a defeated memo: `SortableChordCard` documents itself as
memoized against five stable callback props (`SortableChordCard.tsx:34-40`), but
`ChordView.tsx:1101` passes `items={chords.map((c) => c.id)}` — a fresh array literal — into
`SortableContext`, and dnd-kit's `contextValue` lists `items` in its dependency list
(`sortable.esm.js:324-335`). Context updates bypass `React.memo` entirely, so every chord card
re-renders 8×/sec regardless of the callback stability the code comment relies on.
`ArrangeView.tsx:94` already derives its own `loopIds` correctly with `useMemo`; `ChordView` is
the inconsistent one.

## 5. Severity calibration — the persist-write disagreement

The JS lane and the audio lane rated the same code path at opposite ends of the severity scale,
and this document keeps both numbers rather than resolving them silently:

| | Claim | Basis |
|---|---|---|
| js-perf | **Critical** — "every single store mutation ... synchronously serializes and writes the whole project" | Correctly identifies persist's unconditional per-`set()` write and the `loopSync` double-write as a mechanism with no ceiling |
| audio-perf | **4.4 KB / 0.036 ms per write**, explicitly *not* called critical (M11) | Measured directly: a Bun script importing the real `createDefaultLoop()` + `INITIAL_EFFECTS`, 4,365 bytes serialized in 0.036 ms for a single-loop project |

**Resolution:** both numbers are correct and describe different axes. The *mechanism* (no
dirty-check, no throttle, fires on every `set()` including ones with nothing to do with
persisted state) is exactly as unconditional as js-perf describes. The *present-day cost* of
that mechanism is exactly as small as audio-perf measured, because the default project is one
loop and 4.4 KB serializes fast even synchronously on the main thread. js-perf's own bundle
measurements corroborate the scaling direction: an 8-loop synthetic project serializes to
32,273 bytes, roughly linear in loop count. So:

- This is a **scaling hazard, not a present emergency** — at today's typical project size the
  write cost is noise next to a frame budget.
- It is **doubled** by `loopSync`'s independent second `setState` (RC-2 step 3), so the
  per-pointermove tax is two writes, not one, before any scaling is considered.
- It fires at **pointer rate** (step 4 of RC-2's table) — sustained knob drags with a large
  project are the scenario where the "critical" framing starts to be literally true rather than
  a mechanism concern.
- **It stays in scope for this branch**, calibrated as: fix the doubling (remove the second
  `setState`, or make the mirror idempotent-checked) as a RC-2 fix, and treat a
  throttle/coalescing wrapper around `storage.setItem` as a scaling-hazard fix gated on
  measuring a realistic large project first (audio-perf's own recommendation: "measure again,
  then decide").

Neither audit is wrong. The lesson for this branch is to keep citing both numbers when this
code path comes up rather than compressing them into a single severity label.

## 6. Non-goals / out of scope

Restated from the audits' own "considered and dismissed" sections so none of these gets
re-proposed mid-branch:

- **`@dnd-kit` eager chunk (55.19 KB / 18.19 KB gzip).** js-perf #4: unactionable without
  relaxing the mount-everything architecture, which is out of scope for a perf branch. Already
  isolated into its own long-term-cacheable chunk by `vite.config.ts`'s `manualChunks`.
- **`tonal` barrel import.** js-perf checked this explicitly (built chunk is 23.56 KB / 8.47 KB
  gzip; grepped for identifiers unique to unused subpackages, zero matches) — Rolldown is
  already tree-shaking it correctly. No action.
- **`PresetLibrary` trio (`ChordPresetLibrary` / `SynthPresetLibrary` / `ui/PresetLibrary.tsx`)
  dedup.** simplify's top suspect going in; reading all three showed the shared shell already
  exists (`docs/design.md` item 11) and both feature files carry `// PORT of the original ...`
  comments documenting the prior extraction. Already done.
- **The store-slice `toggle*Muted` factory (4 call sites).** simplify L2: clears the "3+ call
  sites" bar on count alone, but a generic factory needs its own generic key-of-`AppStore`
  typing, is not shorter at the call site, and replaces a directly grep-able, cmd-click-able
  action name with an indirection. Below the bar in practice; leave as-is.
- **The 2-site preset-library toast/export/import scaffolding.** simplify L1: only 2 call
  sites (`ChordPresetLibrary.tsx`, `SynthPresetLibrary.tsx`), below the 3-call-site threshold
  for extraction, and the two save-action signatures already differ enough that a generic
  helper would need its own parameterization. Worth revisiting only if a third preset-like
  library appears.
- **`bassPatterns.ts` / `rhythmPatterns.ts` / `drumKits.ts` / `genrePresets.ts` eager
  imports.** js-perf #3: these are read at slice-construction time or by an always-mounted tab
  (`SequencerView`); there is no unnecessary eager path to remove without changing the
  mount-everything architecture. Not the same defect as the Instant Vibes finding (js-perf #2),
  which *is* in scope because it is genuinely deferred data reachable only from a click handler.
- **Unbounded AudioParam event lists from un-cancelled `setTargetAtTime`.** audio-perf checked
  `updateEffects`, `setMasterVolume`, `setDrumFilter`: Blink/Gecko prune past events on
  always-rendering nodes, so the list does not grow without bound. Dismissed.
- **Selector-shape bugs across the 203 `useAppStore(...)` call sites.** react-perf
  machine-checked all of them: 201 simple field reads, 2 stable primitives/setters, zero object
  or array literal selectors. This class of bug does not exist in this codebase; do not go
  looking for it.
- **`getPresetsGroupedByCategory`'s O(categories × presets) scan.** js-perf #5 recorded this
  "explicitly to rule it out" — the preset list is tens of entries and the function runs on a
  drawer open, not on a frame. No task; listed here so it is not re-proposed.
- **`AmbientBackdrop`'s three full-viewport gradients per frame.** audio-perf M13 calls it "a
  considered trade-off, not a defect", and §7 below records that all three analyser-reading
  rAF components were independently reviewed and found well-built. No action.
- **The `animate-pulse` overlay on every active sequencer step.** react-perf M5 states it is
  "noted for completeness rather than as a recommended change". It is preserved byte-identically
  by the `StepRow` migration (plan Task 33's `activeOverlay: 'pulse'`), not removed.

## 7. Documented traps that must survive (verbatim from CLAUDE.md)

- **Instant Vibes ids intentionally drift from their labels**: `cyber-dance` → "Cyber EDM",
  `ambient-chill` → "Deep Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden".
  Ids are persisted in project files; renaming them breaks saved projects. The table lives in
  `src/store/instantVibes.ts` — the single copy since the `audio/` fork was deleted. Any RC-2
  fix touching `instantVibes.ts` (js-perf #2's lazy-import proposal) must not touch these ids.
- **Tap Tempo and stereo VU are unbuilt, not broken** — see `docs/design.md` §4 item 3. Do not
  "fix" their absence as part of this branch.
- **The three analyser-reading rAF components import the engine on purpose**:
  `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`. They are exempted from the
  `components/` → `audio/engine` import ban because routing per-frame analyser reads through
  the store would mean a store write on every animation frame and a re-render of every
  subscriber — exactly the class of problem this branch is fixing elsewhere. Do not "fix" this
  exemption; both audits independently reviewed these three files and found them well-built
  (paused-gating, ref-held sounding state, cached buffers, no per-frame allocation).

## 8. Constraints

- **Three enforced import layers** (eslint `no-restricted-imports`): `src/audio/` never imports
  `store/` or `components/`; `src/store/` never imports `components/`; `src/components/` must
  not import `audio/engine` except the three analyser consumers above and test files. Any RC-2
  fix that moves logic between layers (e.g. reading `useAppStore.getState()` inside an engine
  callback, or hoisting a subscription) must stay on the correct side of this boundary — several
  of the proposed fixes (I2/I6 in audio-perf) already follow the existing idiom of reading
  `getState()` live inside a clock callback rather than threading a fresh prop, which is
  layer-legal.
- **Theme-token rules unaffected by this branch's scope**: no `tailwind.config.*` may be added;
  `scripts/themeTokenGuard.ts`'s `ALLOWLIST` stays empty; components name roles, not colours.
  None of the three root causes require new markup or classes, so this should not come up, but
  any extraction (e.g. react-perf's proposed `PlayingStepRow` / `<SequencerGrid>` leaf
  components) must still pass `bun run check:theme` if it introduces new class strings.
- **Tests are pure-logic `bun:test`.** Components export their testable helpers rather than
  being rendered through a DOM/testing-library harness. Any refactor that moves state into a
  ref + `useSyncExternalStore` emitter (react-perf's proposed fix for RC-3 in `ChordView` /
  `SynthView`) needs a test surface that fits this style — expose the emitter's subscribe/read
  functions for a pure-logic test, not a rendered-DOM assertion.
- **`bun run verify` is the completion gate** (test + lint + `check:keys` + `check:drums` +
  build). It does not include `bun run eslint`; run that separately for any change that touches
  imports (several of the proposed fixes move code across files, e.g. simplify's H1/H2 panel
  extractions and js-perf #2's dynamic-import restructuring of `instantVibes.ts`).
- **Never call engine setters from a component** — go through `src/store/engineSync.ts`. RC-2's
  fan-out fixes (rAF-coalescing the `engineSync` subscriptions per audio-perf I3, decoupling the
  Decay knob's structural write per I2) belong entirely inside `engineSync.ts` and
  `src/audio/engine.ts`; they must not introduce a new component → engine call.

## 9. Corrections to CLAUDE.md this branch must make

Verified directly against the repository, not inferred from the audits:

| CLAUDE.md currently states | Verified fact | Evidence |
|---|---|---|
| "the app itself is Vite + React 18" | React is **19.2.8** | `package.json:27` — `"react": "^19.2.8"` |
| persist key is "version 5" | persist version is **7** | `src/store/store.ts:393` — `version: 7,` (already corrected once, from 5→6→7, by the SP3/SP4 loop-layer work per `docs/superpowers/specs/2026-08-30-sp4-loop-song-layers-design.md`'s own note that CLAUDE.md's "version 5" was already stale at "6" before this branch) |
| Testing section does not mention engine test fakes | `src/audio/testFakes.ts` exists and exports `makeEngine`, `freshEngine`, `fakeNode`, `fakeParam` (plus `fakeBufferSource`, `fakeCtx`), providing a full automation-timeline-recording fake for engine unit tests | `src/audio/testFakes.ts:9,10,19,104,128,143,178` |

The persist-version drift has apparently happened twice in a row (5→6 unnoticed, 6→7 also
unnoticed) — worth a standing note in CLAUDE.md's own text pointing at `store.ts:393` as the
single source of truth rather than restating the number, so a fourth bump doesn't repeat this.

## 10. Success criteria

All of the following are measurable and must hold before this branch is considered done, in
addition to the existing spec norms:

1. **No stranded voice.** Simulate each of the three loss paths (window `blur` while a key is
   held, a touch sequence that ends in `touchcancel` instead of `touchend`, a MIDI
   `statechange` to `disconnected` while a note is held) and confirm every voice reaches
   `teardownVoiceNodes` — either via the UI-level fix or, absent that, via the engine's own
   `MAX_VOICE_LIFETIME` backstop firing within its configured window. A voice with no matching
   note-off and no explicit stop event must not still be in `activeVoices` after the backstop
   window elapses.
2. **One persisted write per animation frame per knob drag, not two.** Instrument (or test with
   a spy) `storage.setItem` during a synthetic pointermove sequence on a synth-param knob: today
   this fires twice per frame (the direct `set()` plus `loopSync`'s mirror `set()`); after the
   fix it must fire at most once per animation frame, coalesced.
3. **No view re-renders per 16th note while its tab is hidden.** For each of `ChordView`,
   `SynthView`, `SequencerView`, `ArrangeView`, render-count instrumentation (or a
   `bun:test`-compatible pure-logic proxy on the extracted step-emitter) during a simulated
   playback session on a non-`ArrangeView`/non-owning tab must show zero re-renders attributable
   to the 16th-note clock; only the leaf component that consumes the step (the piano-roll
   playhead, the custom-mode `StepRow`) may update.
4. **`bun run verify` green** — test + lint + `check:keys` + `check:drums` + build, with no
   regressions, run as the final gate before any completion claim.
5. **Bundle main chunk shrinks by a stated, measured amount after the Instant Vibes lazy fix.**
   Before: `dist/assets/index-*.js` at 304.90 KB raw / 80.73 KB gzip (js-perf's baseline
   measurement, containing `synthPresets.ts` + `chordProgressions.ts` source in full). After:
   re-run `bun run build` and record the new main-chunk raw/gzip size in the same table format;
   the reduction must be attributable to the four data modules (`synthPresets`,
   `chordProgressions`, `vibeDrumPatterns`, `vibeEffectChains`) moving out of the eager import
   graph, not to an unrelated change.
6. **`renderToString` output of refactored components is byte-identical before and after.** For
   every component touched by an RC-3 or RC-2 fix that is a pure presentational refactor (the
   `H1`/`H2`-style panel extractions, the `chordIds`/`loopIdKey` identity stabilizations, the
   `keyboardProps`/`drumProps` memoization) — not for components whose behavior deliberately
   changes (e.g. `useLeadPlayback.ts:94`'s idle-state guard, which changes what the playhead
   renders before the bar line) — a snapshot of `renderToString` on a fixed prop/store state
   must match byte-for-byte pre- and post-refactor, proving the extraction changed nothing
   observable.

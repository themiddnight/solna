# Pure song-level event timeline — design

**Issue:** DEV-420 "refactor: Pure song-level event timeline".
**Branch:** `refactor/dev-420-song-event-timeline`.
**Status:** Approved design (2026-09-22). This document records it, the facts it was checked
against, and the places where the code forced a call the brief did not make (§0, §12).

**User-visible change:** none. The rendered WAV of any arrangement is byte-identical before and
after, proven by a golden recorded on the pre-refactor code (§9.1).

---

## 0. Verified facts (checked against the code on this branch)

| # | Claim in the brief | Verdict | Evidence |
|---|---|---|---|
| F1 | `renderMixdown.ts` mixes arrangement planning with `OfflineAudioContext` rendering | True | `scheduleArrangement` interleaves `buildLoopVoices`, `beatStepEvents`, `planChordStep`, `planPadArm`, `planMelodyStep` with `engine.trigger*` calls inside one step loop |
| F2 | Drums have no planner in `plan/` (audit A5, second half) | True | `src/audio/beatSteps.ts` `beatStepEvents(pattern, mix, stepIndex)`, positional scalars (not R235 shape), returns a module-level scratch array |
| F3 | A4: `plan/chordPlan.ts` imports `chordPlayback.ts`, which imports the engine singleton | True | `chordPlan.ts` imports `arpEventsForStep`, `buildChordEvents`, `eventsForCycleStep`, `BarInvariantEvent`, `StepEvent` from `../chordPlayback`; `chordPlayback.ts` line 1 imports `audioEngine` and `STEPS_PER_BAR` from `../engine` |
| F4 | `STEPS_PER_BAR` needs the engine | False | It is defined in `src/utils/musicTheory.ts` and only re-exported by `engine.ts`; the moved code imports it from `@/utils/musicTheory` |
| F5 | Every other planner import is engine-free | True | `padPlan.ts` → `padPlayback.ts` (musicCore, utils, types only); `melodyPlan.ts` → `leadMelody.ts` → `arpeggiator.ts`/`arpSchedule.ts`/`leadLiveRecord.ts` → `rng.ts`/utils; `chordPlan.ts` → `chordRhythms.ts`, `bassPatterns.ts`, `constants.ts`, `groupByStyle.ts`, utils, data. Only the `../chordPlayback` edge reaches the engine |
| F6 | Offline rendering is available in `bun test` | True, real PCM | `renderMixdown.test.ts` installs `OfflineAudioContext` from `node-web-audio-api` on `globalThis`; the "determinism" block already asserts two renders are byte-identical |
| F7 | Engine calls can be recorded in tests | True | `renderMixdown.test.ts` spies `AudioEngine.prototype.setDrumKit` / `triggerDrum` with `spyOn(...).mockImplementation` that logs and calls through |
| **F8** | **"Build the timeline after `createRenderEngine`, then perform it — the RNG draw order is unchanged"** | **False** | The shared `random()` seam (`src/audio/rng.ts`) is drawn from at PERFORM time too, not only at engine creation and in the arp: `drumSynth.ts` `noiseStartOffset()` (every noise-bearing drum hit), `masterRack.ts` `createNoiseNode()` (lazy noise buffer on the first hit that needs it), `subtractiveVoice.ts` `noiseBufferFor()` (first voice per noise colour with `utility.noiseEnabled`), `synthLfo.ts` `createSampleHoldBuffer()` (every voice with a `'sample-and-hold'` LFO). The planner draws (`arpeggiator.ts` `buildArpSequence` in `'random'` mode, reached from `planChordStep` and `planMelodyStep`) are interleaved with those, even **within one step**: drum hits are performed before `planChordStep` runs, and Lead is planned after Chord/Bass/Pad are performed. Collecting the whole timeline first moves every arp draw ahead of every engine draw and changes the WAV. §6 resolves this |
| F9 | The event fields listed in the brief suffice to reproduce every engine call | True, with one lookup | The performer needs, per note, frequency (from `noteName`), velocity, start, end, patch and bus. Patch and bus follow from `(loopIndex, track)`; the Lead bus is `'synth'`, not `'lead'` (`mixdownLeadTrack`). The remaining `triggerSynthNoteOn` arguments are constants (`scaleFactor` `1`, owner `'sequencer'`); the note-off release is `synthReleaseSeconds(patch)`, computed at perform time. No extra field is needed (§4.3) |

---

## 1. Goal

A pure function turns an arrangement snapshot into resolved, per-track events over time — Chord,
Bass, Pad, Lead, FX **and drums** — and the offline mixdown renders by performing exactly those
events. Live and offline stay provably equivalent: live controllers and the timeline call the same
per-lane planners, and the planners no longer reach the engine at all.

This closes audit A4 and the drum half of A5, and gives DEV-428 (MIDI) and DEV-429 (stems) a
single source of "what plays when".

## 2. Non-goals

- MIDI or stem export formats (DEV-428 / DEV-429 consume the timeline later).
- Changing live controllers beyond what sharing a planner requires. `useChordPlayback`,
  `useLeadPlayback` and the pad path keep their arming and emit logic; only import paths change.
  `useSequencerPlayback` swaps `beatStepEvents` for `planBeatStep`.
- The React hook inside `audio/` (`arpPlayback.ts`), the other half of A5. It stays open.
- Any audible change, including to arp `'random'` draw order (§6, §11 R3).
- Renaming `MixdownSnapshot` / `MixdownLoop` (§12 D2).

---

## 3. Module layout (file by file)

All new `plan/` files sit under the existing planner purity ESLint block (R227): no store, no
engine module, no `AudioContext`, no wall clock, no timer, no `Math.random`.

| File | Change |
|---|---|
| `src/audio/playback/plan/chordEvents.ts` | **New.** The pure half of `chordPlayback.ts`, moved verbatim: `BarInvariantEvent`, `StepEvent`, `buildChordEvents`, `phaseEventsForStep` (private), `eventsForCycleStep`, `chordPlanPosition`, `ARP_VELOCITY` (private), `arpEventsForStep`. `STEPS_PER_BAR` comes from `@/utils/musicTheory`. Adds two helpers the engine-touching emitters and the timeline share (§4.4): `stepNoteWindow` and `fullHoldVelocity` |
| `src/audio/playback/chordPlayback.ts` | Loses the moved symbols and imports them from `./plan/chordEvents`. `emitStepEvents` and `playFullHoldChord` call `stepNoteWindow` / `fullHoldVelocity` instead of inlining the arithmetic. No re-export shim: every importer switches to `plan/chordEvents` (Knip would flag a pass-through export) |
| `src/audio/playback/plan/chordPlan.ts` | Imports from `./chordEvents` instead of `../chordPlayback`. This is the A4 fix |
| `src/audio/playback/plan/beatPlan.ts` | **New.** `BeatPlanSnapshot`, `BeatStepEvent`, `planBeatStep` (§7) |
| `src/audio/beatSteps.ts` | **Deleted**; its body moves to `plan/beatPlan.ts` |
| `src/audio/playback/plan/songSnapshot.ts` | **New.** The snapshot types and the snapshot→lane adapters, moved out of `renderMixdown.ts` so `plan/` never imports `export/`: `MixdownBusState`, `MixdownBeatVoiceGain`, `MixdownLoop`, `MixdownSnapshot`, `chordSnapshotForLoop`, `padSnapshotForLoop`, `mixdownLeadTrack`, `mixdownFxTrack`, new `beatSnapshotForLoop`, new `songTrackVoice` |
| `src/audio/playback/plan/songTimeline.ts` | **New.** `ArrangementPass`, `ArrangementPlan`, `planArrangement`, `LoopVoices`, `buildLoopVoices` (moved from `renderMixdown.ts`), plus `SongTrack`, `TimelineEvent`, `SongWalkItem`, `SongTimeline`, `walkSongTimeline`, `buildSongTimeline`, `timelineEventTime` |
| `src/audio/export/renderMixdown.ts` | Keeps: `MIXDOWN_SAMPLE_RATE`, `yieldPreservingRandomStream`, `LoopAudioAutomation`, `planLoopAudioAutomation`, `applyMasterState`, `applyLoopAudioState`, the performer (`performTimelineEvent`), `scheduleArrangement` (now a perform loop), progress/cancel plumbing, `renderMixdown`, `MixdownFailureReason`, `MixdownRenderResult`, `MixdownRenderProgress`, `MixdownProgressReporter`. Loses every planner import except `walkSongTimeline`/`planArrangement` |
| `src/store/mixdownSlice.ts` | Imports `MixdownLoop`/`MixdownSnapshot` from `@/audio/playback/plan/songSnapshot`; `renderMixdown` and the failure/progress types still from `export/renderMixdown` |
| `src/store/playbackPlanSnapshots.ts` | Adds `beatPlanSnapshot(s: AppStore): BeatPlanSnapshot` (R234 twin of `beatSnapshotForLoop`) |
| `src/components/useSequencerPlayback.ts` | `fireBeatStepEvents(planBeatStep(beatPlanSnapshot(live), { stepInBar: stepInLoop }), time)`; `fireBeatStepEvents` passes `event.velocity` |
| `src/components/loop/chord/useChordPlayback.ts`, `useChordView.ts`, `src/audio/playback/padPlayback.ts`, `playbackEngine.ts`, `src/store/loadLoop.ts`, tests | Import-path updates only, for whichever moved symbols each uses |
| `src/audio/export/mixdownFixture.ts` | Type imports from `plan/songSnapshot` |
| `src/architecture/playbackPlannerImportGraph.test.ts` | **New** (§8) |

`planLoopAudioAutomation` stays in `renderMixdown.ts`: it positions AudioParam automation (bus
gains, Beat patch, drum faders), which is render state, not musical events. MIDI and stems do not
need it.

---

## 4. Types (exact fields)

### 4.1 `plan/songTimeline.ts`

```ts
/** One loop's dwell in the arrangement, as a range of absolute steps. (moved, unchanged) */
export interface ArrangementPass {
  loopIndex: number;
  startStep: number;
  passSteps: number;
  dwellSteps: number;
}

export interface ArrangementPlan {
  totalSteps: number;
  passes: ArrangementPass[];
}

export type SongTrack = 'chord' | 'bass' | 'pad' | 'lead' | 'fx';

export type TimelineEvent =
  | {
      kind: 'note';
      track: SongTrack;
      loopIndex: number;
      /** ROOTS-spelled (R064); never Hz (R176) — the performer converts. */
      noteName: string;
      velocity: number;
      /** Absolute seconds from the start of the song. */
      startSec: number;
      /** Absolute note-off time, already clipped (step notes: `stepNoteWindow`). */
      endSec: number;
    }
  | {
      kind: 'drum';
      loopIndex: number;
      voice: BeatVoiceId;
      velocity: number;
      timeSec: number;
    };

/** What `walkSongTimeline` yields, in emit order. */
export type SongWalkItem =
  | TimelineEvent
  | { kind: 'pass'; passIndex: number; pass: ArrangementPass }
  | { kind: 'stepEnd'; step: number };

export interface SongTimeline {
  totalSteps: number;
  passes: ArrangementPass[];
  /** Sorted by `timelineEventTime`; ties keep emit order (stable sort). */
  events: TimelineEvent[];
}

export function timelineEventTime(e: TimelineEvent): number; // note → startSec, drum → timeSec
export function planArrangement(snapshot: MixdownSnapshot): ArrangementPlan;          // moved
export function buildLoopVoices(loop: MixdownLoop, meterId: MeterId, bpm: number, stepsPerBar: number): LoopVoices; // moved
export function walkSongTimeline(snapshot: MixdownSnapshot, plan: ArrangementPlan): Generator<SongWalkItem, void, undefined>;
export function buildSongTimeline(snapshot: MixdownSnapshot): SongTimeline;
```

`buildLoopVoices` keeps its positional signature: it is not a `plan<Lane>*` function, so R235 does
not apply, and its test pins it as-is. `SongWalkItem` and the generator are exported because
`renderMixdown.ts` consumes them (R236).

Full-hold strikes are not a separate kind: a held chord, bass or pad is one `note` event per tone
with `endSec = startSec + holdSec`.

### 4.2 `plan/songSnapshot.ts`

Moved unchanged: `MixdownBusState`, `MixdownBeatVoiceGain`, `MixdownLoop`, `MixdownSnapshot`,
`chordSnapshotForLoop`, `padSnapshotForLoop`.

Changed: `mixdownLeadTrack` / `mixdownFxTrack` return `MelodyPlanSnapshot` (they drop `params` and
`source`); `MixdownMelodyTrack` is deleted. Patch and bus come from one table instead:

```ts
/** The patch and source bus a track's notes play on. The one place Lead's irregular
 *  names (`synthParams`, bus `'synth'`) are spelled for the offline path. */
export function songTrackVoice(loop: MixdownLoop, track: SongTrack): { params: ActiveSynth; source: string };
// chord → chordSynthParams/'chord', bass → bassSynthParams/'bass', pad → padSynthParams/'pad',
// lead → synthParams/'synth', fx → fxSynthParams/'fx'

export function beatSnapshotForLoop(loop: MixdownLoop): BeatPlanSnapshot; // { pattern: loop.beatPattern, mix: loop.beatMix }
```

`SongTrack` is declared in `songTimeline.ts` and imported as a type here (no runtime cycle).

### 4.3 Performer contract (why no field is missing)

For every `note` event the performer makes exactly the call the old code made:

```ts
const { params, source } = songTrackVoice(snapshot.loops[e.loopIndex], e.track);
const voiceId = engine.triggerSynthNoteOn(noteFrequency(e.noteName), params, e.velocity, e.startSec, source, 1, 'sequencer');
if (voiceId) engine.triggerSynthNoteOff(voiceId, synthReleaseSeconds(params), e.endSec);
```

and for every `drum` event `engine.triggerDrum(e.voice, e.velocity, e.timeSec)`.

Velocities by origin, all computed in the planner layer: step notes → `StepEvent.velocity`; chord
and pad full holds → `fullHoldVelocity(notes.length)` (`DEFAULT_VELOCITY * equalPowerVelocityScale(n)`,
today's `playFullHoldChord` value); bass full hold → `plan.bassFullHold.velocity`; Lead/FX →
`DEFAULT_VELOCITY`; drums → `BeatStepEvent.velocity` (`DEFAULT_VELOCITY`).

### 4.4 Shared helpers in `plan/chordEvents.ts`

```ts
/** Start and clipped note-off of one step event. The clamp and the 10 ms floor are
 *  today's emitStepEvents rule, now in one place for live and offline. */
export function stepNoteWindow(time: number, ev: StepEvent, chordEnd: number): { startSec: number; endSec: number };
// startSec = time + ev.timeOffset
// endSec   = Math.max(startSec + 0.01, Math.min(startSec + ev.hold, chordEnd))

export function fullHoldVelocity(noteCount: number): number; // DEFAULT_VELOCITY * equalPowerVelocityScale(noteCount)
```

The expressions are copied token for token so every double is bit-identical to today's
(`time + ev.timeOffset`, not `ev.timeOffset + time`). Lead/FX keep `start = time + note.startOffsetSec`,
`end = start + note.holdSec`; full holds keep `end = time + holdSec`.

---

## 5. `walkSongTimeline` / `buildSongTimeline` algorithm

`walkSongTimeline` is today's `scheduleArrangement` body with each `engine.*` call replaced by a
`yield` of the event it would have performed, and every planner call left exactly where it is
today. Generators are lazy, so a planner call runs only when the consumer asks for the next item —
which is what preserves the RNG draw order (§6).

```
stepDur = stepDurationSec(bpm); tickDur = stepDur / TICKS_PER_SIXTEENTH
for passIndex, pass in plan.passes:
  yield { kind: 'pass', passIndex, pass }            // BEFORE any planning of this pass
  loop = snapshot.loops[pass.loopIndex]
  voices = buildLoopVoices(loop, meterId, bpm, stepsPerBar)
  chordless = loop.chords.length === 0
  lead = mixdownLeadTrack(loop); fx = mixdownFxTrack(loop)
  padSnap = padSnapshotForLoop(loop, bpm, stepsPerBar); beatSnap = beatSnapshotForLoop(loop)
  for i in 0 ..< pass.dwellSteps:
    stepInPass = i % pass.passSteps; step = pass.startStep + i; time = step * stepDur
    stepInBar = stepInPass % stepsPerBar; barInPass = floor(stepInPass / stepsPerBar)
    1. for ev of planBeatStep(beatSnap, { stepInBar }): yield drum(loopIndex, ev.voice, ev.velocity, time)
    2. if !chordless:
         chordIndex, plan, stepsIntoChord, chordEnd, isLastBar   — today's arithmetic, unchanged
         a. if stepsIntoChord === 0 && plan.chordFullHold: for n of notes: yield note('chord', n, fullHoldVelocity(len), time, time + holdSec)
         b. if stepsIntoChord === 0 && plan.bassFullHold:  yield note('bass', noteName, velocity, time, time + holdSec)
         c. events = planChordStep(plan, { progressionStep: stepInPass, step, isLastBar, stepsPerBar,
                                           stepDurSec: stepDur, chordArp, bassArp, chordFeel, bassFeel })
            for ev of events.chord: yield note('chord', ev.noteName, ev.velocity, ...stepNoteWindow(time, ev, chordEnd))
            for ev of events.bass:  yield note('bass',  …same…)
         d. if stepsIntoChord === 0: arm = planPadArm(padSnap, { chordIndex })
            if arm: for n of arm.notes: yield note('pad', n, fullHoldVelocity(len), time, time + arm.holdSec)
    3. for n of planMelodyStep(lead, { stepInLoop: stepInPass, stepsPerBar, tickDurSec: tickDur }):
         start = time + n.startOffsetSec; yield note('lead', n.note, DEFAULT_VELOCITY, start, start + n.holdSec)
    4. same for fx
    yield { kind: 'stepEnd', step }
```

Chord/bass arp settings, feel and patches are read from `loop` exactly as today. The order
1 → 2a → 2b → 2c(chord, bass) → 2d → 3 → 4 is today's engine-call order and is part of the
contract (R288).

`buildSongTimeline(snapshot)`: `plan = planArrangement(snapshot)`; drain
`walkSongTimeline(snapshot, plan)` keeping only `note`/`drum` items; stable-sort by
`timelineEventTime` (`Array.prototype.sort` is stable, so equal times keep emit order); return
`{ totalSteps: plan.totalSteps, passes: plan.passes, events }`.

The timeline is pure in the R227 sense (no store, engine, context, clock or timer). Like
`planChordStep` today it reads the shared `random()` seam for arp `'random'` mode, so it is
deterministic given that seam's state; it does not seed itself (§12 D6).

---

## 6. Rendering: the perform loop and the RNG argument

```ts
const plan = planArrangement(snapshot);                   // pure, no draws — sizes the context
const ctx = new Offline(...);
await withSeededRandom(MIXDOWN_SEED, async () => {
  const engine = createRenderEngine(ctx);                 // draw site A: reverb impulse
  applyMasterState(engine, snapshot);                     // draw site B: impulse rebuild when decay ≠ 2.0
  return scheduleArrangement(engine, snapshot, walkSongTimeline(snapshot, plan), signal);
});
```

`scheduleArrangement(engine, snapshot, walk, signal)`:

```
automation = planLoopAudioAutomation(snapshot, plan)   // plan passed alongside, as today
for item of walk (manual next() so an await can sit between items):
  'pass'    → applyLoopAudioState(engine, automation[item.passIndex])
  'note'    → performTimelineEvent (§4.3)
  'drum'    → engine.triggerDrum(...)
  'stepEnd' → stepsSinceYield += 1; at SCHEDULE_YIELD_INTERVAL_STEPS: reset,
              await yieldPreservingRandomStream(); if signal?.aborted return { cancelled: true }
return { cancelled: false }
```

**Why the draw order is identical.** Draw sites A and B run before the walk starts, as today. Inside
the walk, every draw is either a planner draw (arp `'random'` inside `planChordStep` /
`planMelodyStep`) or an engine draw (drum noise offset, lazy noise buffers, S&H LFO buffers — F8).
A planner call executes when the generator is resumed; an engine call executes when the performer
handles the item just yielded. Because the generator yields each event the moment the old code
would have performed it, and the performer performs it before resuming the generator, the global
sequence of planner calls and engine calls is exactly today's sequence, call for call. The pass
marker is yielded before `buildLoopVoices`, so pass automation still precedes that pass's
planning. The yield/abort gap still sits after a whole step (after FX), and
`yieldPreservingRandomStream` still restores this render's generator before the walk is resumed.
The golden (§9.1) is the proof; the argument is why it is expected to pass.

**Why not build the whole timeline first** (the brief's wording): see F8. Every arp draw would move
ahead of every drum/voice draw, and any arrangement with an arp in `'random'` mode plus a
noise-bearing drum hit, a noise-enabled patch or an S&H LFO would render different samples. The
renderer therefore consumes the walk incrementally; `buildSongTimeline` is the same walk, drained.
The events performed and the events in a timeline are produced by the same code, so "mixdown renders
from the timeline" holds as a statement about code; it does not hold as a statement about one array
object (§12 D1).

---

## 7. Drum planner and live wiring (A5, drum half)

`plan/beatPlan.ts`:

```ts
export interface BeatPlanSnapshot { pattern: BeatPattern; mix: BeatMix }
export interface BeatStepEvent { voice: BeatVoiceId; velocity: number }
/** The voices that sound at context.stepInBar, in canonical BEAT_VOICE_IDS order. */
export function planBeatStep(snapshot: BeatPlanSnapshot, context: { stepInBar: number }): BeatStepEvent[];
```

- Body is `beatStepEvents`' loop, including its optional chaining on both `mix.voices[voice]` and
  `pattern.rows[voice]` (a TypeError here would take down the whole clock tick). Per-voice mute is
  honoured; solo is not (session-only, never in an export) — unchanged docblock reasoning moves
  with it.
- Returns a **fresh array**, not the module-level scratch (§12 D4). `velocity` is
  `DEFAULT_VELOCITY`, now decided in the planner rather than in each caller.
- Beat is emit-only, like melody: the live caller builds the snapshot per step from live store
  state (it already reads `beatPattern`/`beatMix` live inside the clock callback, deliberately not
  as render-scope selectors).
- Live: `useSequencerPlayback` calls
  `fireBeatStepEvents(planBeatStep(beatPlanSnapshot(live), { stepInBar: stepInLoop }), time)`;
  `fireBeatStepEvents` passes `event.velocity` to `triggerPad`. Same voices, same velocity, same time.
- Offline: step 1 of the walk.
- `beatPlanSnapshot` (store) and `beatSnapshotForLoop` (offline) are the R234 pair.

A5's other half, the React hook inside `audio/playback/arpPlayback.ts`, is untouched and stays
open in the audit table.

---

## 8. A4 fix and its guard

After §3, `plan/chordPlan.ts` imports `./chordEvents`, and nothing in `plan/` imports
`chordPlayback.ts`. The per-file ESLint block cannot see transitive edges (that is how A4 existed
under an armed block), so a new test guards the graph:

`src/architecture/playbackPlannerImportGraph.test.ts`

- Walks the runtime import graph from every non-test `.ts` file in `src/audio/playback/plan/`,
  using `new Bun.Transpiler({ loader: 'ts' }).scanImports(source)`, which drops type-only imports
  (they are erased at runtime and cannot instantiate a singleton). Resolves `@/` to `src/` and
  relative specifiers against the importing file; bare package specifiers are leaves.
- Asserts no reached file is `src/audio/engine.ts` or `src/audio/playback/playbackEngine.ts`, and
  prints the offending path chain on failure.
- **Positive control:** the same walker started from `src/audio/playback/chordPlayback.ts` does
  reach `src/audio/engine.ts`. Without it, a walker that silently resolved nothing would pass.

Chosen over extending the ESLint block because no configured rule is transitive, and over
extending `playbackPlannerPurity.test.ts` because that file asserts ESLint configuration
(severity and scope); a graph walk is a different mechanism with its own failure mode.

---

## 9. Testing plan

### 9.1 Golden — the first implementation commit

`src/audio/export/renderMixdownGolden.test.ts`, committed with its golden files **before any
production change**, recorded on the pre-refactor code, and never edited by a later commit of this
branch.

Fixture `goldenSnapshot()` (in the test file, built from `mixdownFixture.ts` helpers), three loops:

| Loop | Content | Repeat |
|---|---|---|
| A | Two one-bar chords; chord arp **active, mode `'random'`**; bass preset pattern with bass arp active `'random'`; pad chord mode; Lead melody with arp active `'random'`; Beat pattern with `kick` + `snare` + `hihat` (the last two draw a noise offset) on arp steps; chord patch with `utility.noiseEnabled: true`; Lead patch with an LFO in `'sample-and-hold'` waveform | 2 |
| B | Preset **full-hold** chord rhythm and full-hold bass pattern; pad drone mode; FX melody; a different Beat pattern with one voice muted in `beatMix` | 1 |
| C | Chordless; Lead melody only; drums | 1 |

Non-default master effects (reverb decay ≠ 2.0, delay on) so draw site B is exercised.

Tests:

- `golden: the fixture renders to the recorded WAV sha256` — `Bun.CryptoHasher('sha256')` over
  the `blob` bytes, compared to the constant in `renderMixdownGolden.wav.sha256`.
- `golden: the fixture makes the recorded engine-call sequence` — spies (call-through) on
  `AudioEngine.prototype` `triggerSynthNoteOn`, `triggerSynthNoteOff`, `triggerDrum`,
  `setSourceState`, `setDrumKit`, `setDrumTrackGain`; logs `[method, ...args]` with each patch
  object replaced by its label (`loop<i>.<field>`, resolved by reference against the snapshot) and
  each return value (voice id) appended; compares with `toEqual` to
  `renderMixdownGolden.calls.json`. Numbers are stored as JSON doubles, which round-trip exactly.
- Recording: `GOLDEN_UPDATE=1 bun test src/audio/export/renderMixdownGolden.test.ts` writes both
  files; without the variable the test only compares. The call log is platform-independent and
  localises a failure; the WAV hash catches anything the log cannot see (RNG, graph wiring).

### 9.2 Unit tests

`src/audio/playback/plan/songTimeline.test.ts`
- The `planArrangement` and `buildLoopVoices` tests, moved from `renderMixdown.test.ts`.
- `buildSongTimeline events are time-sorted and equal times keep emit order`
- `buildSongTimeline equals the drained walk, stably sorted`
- `the walk yields a pass marker before any event of that pass and a stepEnd after every step`
- `a full-hold chord is one note per tone spanning holdSec at fullHoldVelocity`
- `a full-hold bass is one note carrying the plan's velocity`
- `step notes end at min(start + hold, chordEnd), floored 10 ms past their start`
- `drum events are planBeatStep at each stepInBar; a muted voice never appears`
- `a chordless loop yields drums and melody only`
- `repeat 2 replays repeat 1 shifted by passSteps × stepDur` (no `'random'` arp in this fixture)
- `every noteName is ROOTS-spelled`
- `two builds under the same seed are deep-equal`

`src/audio/playback/plan/beatPlan.test.ts`
- `voices come back in BEAT_VOICE_IDS order`
- `a muted voice is skipped; solo is not a planner input`
- `a step past the stored row is silent, not an error`
- `a missing row or mix entry is silent, not a throw`
- `every event carries DEFAULT_VELOCITY`
- `two calls return distinct arrays`

`src/audio/playback/plan/chordEvents.test.ts`
- The tests covering the moved functions, moved from `chordPlayback.test.ts`.
- `stepNoteWindow clamps to chordEnd`, `stepNoteWindow floors the gate at 10 ms`
- `fullHoldVelocity matches playFullHoldChord's velocity for 1–6 notes`

`src/architecture/playbackPlannerImportGraph.test.ts` — §8.

Equivalence pairs (in `renderMixdown.test.ts` beside the pad/chord pairs):
- `live and offline build the same beat snapshot` — `beatSnapshotForLoop` deep-equals
  `beatPlanSnapshot`, and both plan the same events at every `stepInBar`.
- `renderMixdownMelodyPlan.test.ts`: the snapshot comparison becomes a direct `toEqual` (the
  `params`/`source` strip goes away).

`src/components/useSequencerPlayback.test.ts`: `fireBeatStepEvents passes each event's velocity`.

### 9.3 Must stay green unchanged in intent

`renderMixdown.test.ts` (determinism, every-source-own-patch, per-loop Beat, session engine not
involved, chord/bass/pad equivalence), `renderMixdown.sourceBus.test.ts`,
`renderMixdownCancellation.test.ts`, `renderMixdownRngIsolation.test.ts`,
`renderMixdownMelodyPlan.test.ts`, `playbackPlannerPurity.test.ts`, `chordPlan.test.ts`,
`padPlan.test.ts`, `melodyPlan.test.ts`, `mixdownSlice.test.ts`, `useSequencerPlayback.test.ts`,
`sequencerStartup.test.ts`, `schedulingFocusIndependence.test.ts`. Only import paths may change.

---

## 10. Doc sync (same branch)

- **ADR-0034** `docs/decisions/0034-pure-song-event-timeline.md` (next free number; index row in
  `docs/decisions/README.md`): the timeline, the incremental walk and why (F8), the A4 graph guard,
  the Beat planner; rejected alternatives: collect-then-perform, a dedicated arp RNG stream
  (audible change), a sequence field on events.
- **ADR-0027** gets an "Amended by ADR-0034" note for the rules below whose text changes.
- **`.claude/rules/playback.md`**, "Planned, then performed", new rules (next free ids):
  - **R287** — `buildSongTimeline`/`walkSongTimeline` in `plan/songTimeline.ts` is the one place an
    arrangement becomes timed events; `renderMixdown.ts` only applies pass automation and performs
    walk items, and calls no planner.
  - **R288** — The renderer consumes `walkSongTimeline` incrementally, performing each item before
    resuming the walk; never collect the timeline before performing it. The walk's per-step emit
    order (drums, chord hold, bass hold, chord, bass, pad, lead, FX) is part of the contract.
  - **R289** — No runtime import path from `src/audio/playback/plan/` reaches `audio/engine` or
    `playbackEngine`; `src/architecture/playbackPlannerImportGraph.test.ts` walks the graph.
  - **R290** — Drums are planned by `planBeatStep` (`plan/beatPlan.ts`) for both the live stepper
    and the timeline; no caller decides drum voices or velocity itself.
  - Amended: **R227** (planner list gains `chordEvents`, `beatPlan`, `songSnapshot`, `songTimeline`;
    the "banned only by convention" clause is replaced by a pointer to R289), **R229** (a planner
    never imports `chordPlayback.ts` at all — now gated by R289), **R230** (offline full-hold
    strikes and note-ons are performed from walk items), **R231** (the per-lane snapshot list gains
    Beat, stated without a count), **R234** (the offline builder is `plan/songSnapshot.ts`).
  - `## Prohibited` gains one line each for R287–R290.
- **`docs/architecture/structure/README.md`**: A4 → **Fixed** (pure chord helpers in
  `plan/chordEvents.ts`; graph test); A5 → **Partly fixed** (drums planned in `plan/beatPlan.ts`;
  the React hook in `arpPlayback.ts` remains, deferred). The "Deferred work" bullet drops A4 and
  keeps A5 with "(hook half)".
- **`docs/architecture/structure/03-audio.md`**: the `beatSteps.ts` row goes; `plan/` row lists the
  new planners; the drums row in the controller table names `planBeatStep`; §4 describes the walk
  and perform loop.
- **`docs/architecture/feature-overview.md`**: `audio/` row drops `beatSteps`; `audio/playback/`
  row lists `plan/{padPlan,chordPlan,melodyPlan,chordEvents,beatPlan,songSnapshot,songTimeline}`;
  the "same planners drive renderMixdown" sentence names the song timeline.
- **`.claude/skills/dsp-audio/SKILL.md`**: the `audio/beatSteps.ts` reference becomes
  `plan/beatPlan.ts`.
- **`CLAUDE.md`**: the `playback.md` row in the rules table adds "song timeline"; no new
  cross-cutting line (the rules are playback-scoped).
- R001 throughout: no counts, line numbers or versions added.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | A float expression reordered while lifting code (e.g. `ev.timeOffset + time`) changes a double and the WAV | Expressions copied token for token (§4.4); the call-log golden pinpoints the first differing argument |
| R2 | The WAV hash depends on `node-web-audio-api`'s float behaviour on this CPU/OS | The repo has no CI; the golden is recorded and checked on the same machine. The call log is platform-independent: if only the hash differs on another machine and the log matches, it is platform variance, and re-recording is allowed only in a commit that changes nothing else and says so |
| R3 | DEV-428/429 run `buildSongTimeline` outside a render. Its arp `'random'` notes then come from a different draw stream than the WAV's, so a MIDI of a random-arp track will not match the WAV note for note, even when seeded | Out of scope here (byte-identical is the proof). Recorded in ADR-0034 as the known limit; the fix (a dedicated arp stream seeded per render) is an audible change and belongs to DEV-428 |
| R4 | `planBeatStep` allocating per step on the live clock | About eight small arrays a second at 120 bpm; negligible next to the voices each step builds |
| R5 | Generator overhead in the render walk | One resume per event on a render that already builds several AudioNodes per event; not measurable against node construction |
| R6 | A moved test silently dropped | Moved tests keep their names; the review step diffs test names before/after |

---

## 12. Decisions made in spec

- **D1 — Incremental walk, not a pre-built array (contradicts the brief, F8).** The renderer
  consumes `walkSongTimeline` item by item; `buildSongTimeline` drains the same walk. This is the
  only way to keep the RNG interleaving, and so the WAV, unchanged. Both paths run one piece of code.
- **D2 — Keep the `Mixdown*` names.** The types move to `plan/songSnapshot.ts` unrenamed; renaming
  is churn in a behaviour-preserving refactor. DEV-428 may rename when a second consumer exists.
- **D3 — `mixdownLeadTrack`/`mixdownFxTrack` drop `params`/`source`;** `songTrackVoice` is the one
  offline table of patch field and bus per track.
- **D4 — `planBeatStep` returns a fresh array.** A timeline retains events, and module-level
  mutable scratch is shared state in a planner.
- **D5 — Drum velocity moves into the planner** (`BeatStepEvent.velocity`), so live and offline
  read one decision.
- **D6 — `buildSongTimeline` does not seed.** Seeding is the caller's choice, as it is for the
  renderer (`withSeededRandom`).
- **D7 — The import-graph guard is a new Bun test using `Bun.Transpiler.scanImports`, with a
  positive control,** not an ESLint rule (none is transitive) and not an extension of the
  config-asserting purity test.
- **D8 — Golden = WAV sha256 plus engine-call log,** both recorded before any production change.
  Real PCM is available (F6), so the hash is the proof; the log makes a failure diagnosable.
- **D9 — `planLoopAudioAutomation` stays in the renderer;** it is AudioParam state, not events.
- **D10 — No re-export shims** in `chordPlayback.ts` or `renderMixdown.ts`; importers move
  (Knip zero baseline, R006).

---

## 13. Acceptance criteria

1. The first implementation commit adds only `renderMixdownGolden.test.ts` and its two golden
   files, recorded on the pre-refactor code, and passes there.
2. At branch head the golden passes with both golden files byte-unchanged since that commit.
3. `plan/` contains `chordEvents.ts`, `beatPlan.ts`, `songSnapshot.ts`, `songTimeline.ts`;
   `src/audio/beatSteps.ts` no longer exists; `renderMixdown.ts` imports no planner other than
   `walkSongTimeline`/`planArrangement`, and neither `chordPlayback` nor `beatPlan`.
4. `playbackPlannerImportGraph.test.ts` passes, including its positive control.
5. `useSequencerPlayback` plans drums with `planBeatStep`.
6. Every test in §9.2 exists and passes; every file in §9.3 passes.
7. ADR-0034, the `playback.md` rules (R287–R290 and the amended ones), ADR-0027 note, audit table
   (A4 fixed, A5 partly fixed), `03-audio.md`, `feature-overview.md`, the dsp-audio skill and
   `CLAUDE.md` are updated in the branch.
8. `bun run verify` is green; `bun run eslint` prints zero errors and zero warnings; both Knip
   scans report zero findings.

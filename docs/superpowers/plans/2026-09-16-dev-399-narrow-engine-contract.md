# DEV-399: Narrow the Audio-Engine Contract to Resolved Playable Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Web Audio engine a domain-agnostic runtime: `triggerSynthNoteOn` takes a
**resolved frequency in Hz** instead of a note name, so no key, scale, chord, spelling or
notation decision survives anywhere below the controller boundary — with every audible output
byte-identical.

**Architecture:** The engine already holds exactly ONE music-domain decision:
`src/audio/synth/subtractiveVoice.ts` imports `noteFrequency` from `@/utils/musicTheory` and calls
it twice — once per voice at construction (line 1118) and once per glide target (line 1083). All
nine calling routes hand the engine a `noteName: string`, and the resolution happens at the bottom
of the stack. This plan **relocates that one call outward** to the controllers in
`src/audio/playback/` (plus the offline renderer), in two stages so the change stays reviewable:
Task 1 moves it up to the engine's own front door (`engine.ts`), which makes `src/audio/synth/**`
music-domain-free on its own; Task 2 moves it the rest of the way out to the callers and flips the
public signature. Nothing new is invented — `noteFrequency` is reused verbatim, and the arithmetic
it performs is untouched, which is what makes "byte-identical rendered audio" the acceptance test
rather than an aspiration.

The AC's "explicitly separates opaque note identity from resolved frequency/pitch data" is
answered **by subtraction, not by a new field**. `VoiceId` (`src/audio/synth/voiceId.ts`) is
already the opaque identity a note-on hands back and a note-off addresses; it is branded precisely
so a note name cannot be passed where an identity is wanted. After this plan the engine's *input*
side carries `frequency: number` and nothing else pitch-shaped: the note NAME — the one value that
was doing double duty as "which pitch" and, historically, as "which voice" (the
`` `${source}:${noteName}` `` key `voiceId.ts`'s docblock records as the defect it exists to
prevent) — is gone from the engine entirely. **A passthrough debug/display label was considered
and rejected**: nothing outside the engine's own tests reads `voice.noteName` today (verified by
source scan across `src/`), and a note name re-entering the engine "only for logging" is exactly
the raw material a future `${source}:${noteName}` lookup would be rebuilt from. The name stays
where it is genuinely read — the note-input bus (`emitNoteInput({ kind, note, … })`), which is a
CONTROLLER concern and stays in `src/audio/playback/synthPlayback.ts`. `useInputDeck.test.tsx`
asserting `noteOnSpy.mock.calls[0][0] === noteFrequency('C4')` alongside
`events === [{ kind: 'on', note: 'C4', … }]` in the same test is the plan's one-line demonstration
of that separation.

A second, incidental win worth stating because an AC names it: today a unison patch parses its note
name **once per unison voice** (`createGroup` loops `unisonVoices` and each
`createSubtractiveVoice` calls `noteFrequency(event.noteName)`), so a 7-voice unison note-on runs
the parser seven times. After Task 1 it runs once per note-on; after Task 2, once per note-on at
the controller. That is literally "engine hot paths do not repeatedly parse note names".

**Tech Stack:** TypeScript, Bun test runner, raw Web Audio API (no Tone.js), ESLint 10 flat config
(the dependency gate), `tonal` via Music Core only.

**Spec:** `work/dev399-engine-contract-survey.md` (the exploration pass that surveyed the current
engine contract) plus the Linear issue DEV-399 AC/DoD, reproduced in the AC mapping at the end of
this plan. The preceding seam is
`docs/superpowers/plans/2026-09-16-dev-397-playback-planners.md` (landed and merged to `main`); the
domain contract this plan completes is
`docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`, which Task 6
updates.

## Global Constraints

Every task's requirements implicitly include this section.

- **The four layers (CLAUDE.md).** `src/data/` imports nothing at runtime; `src/audio/` never
  imports `store/` or `components/` and may import `data/`; `src/store/` never imports
  `components/`; `src/components/` must not import `audio/engine` (five analyser-reading files and
  test files excepted — `eslint.config.js` is the list that binds). **This plan touches no file in
  `src/components/` or `src/store/` except two test files**, because the live-keyboard, MIDI,
  lead/FX and chord-hook routes already reach the engine through the bridges
  `src/audio/playback/synthPlayback.ts` and `src/audio/playback/playbackEngine.ts`, and those
  bridges keep their existing `note: string` parameters.
- **Tonal is confined to `src/musicCore/tonalAdapter.ts`** (DEV-394) and `src/audio/**` already
  imports it nowhere. Nothing in this plan may add one.
- **"A note-on returns the identity a note-off addresses, and every voice records the PLAYER that
  created it."** `triggerSynthNoteOn` hands back a `VoiceId` and `triggerSynthNoteOff` takes one.
  A source-and-note pair is NOT an identity. Every voice carries an `owner: VoiceOwner` —
  `live`, `arp`, `sequencer`, `preview` — **required with no default**:
  `releaseSoundingVoices(source, releaseTime, owner)` releases what one player holds and skips
  anything already releasing, `stopOwnedVoices(source, owner, …)` reaches that player's booked
  tails too, and `stopSource` keeps its whole-bus meaning for a project install, a loop load and a
  vibe swap. **Whole-bus reach requires calling a method whose name says so, and can never be
  reached by omitting an argument.** A mono bus is the one SHARED voice: several players can hold
  notes on it, `group.owner` records only which of them built it, and every decision about it is
  taken on the held-note stack. **None of this changes in this plan** — no signature above gains,
  loses or reorders a parameter, and `VoiceId`/`VoiceOwner` are not edited at all.
- **"Equal-power polyphony rides a gain of its own, never the envelope."**
  `applySynthVelocityScale(scale, source)` reaches `SynthVoiceManager.setPolyphonyScale`, which
  ramps a dedicated `polyGain` between the tremolo gain and the panner; the COUNT is the caller's
  (`useInputDeck` counts notes held on that bus); the manager skips any group already releasing.
  **Unchanged by this plan.**
- **"No timer guards a voice's lifetime."** `SynthVoiceManager` arms no wall-clock backstop per
  voice; live keyboard input carries its own in `useInputDeck.ts` (blur + `visibilitychange`), and
  the held chord preview deliberately has none. **This plan changes WHAT pitch data is passed in,
  never the lifecycle or backstop logic** — do not add a timer, and do not "fix" the chord-preview
  gap here.
- **"One synth implementation serves the speakers and the mixdown; the context is the only
  difference."** `createSubtractiveVoice` builds on whatever `BaseAudioContext` it is handed and
  the voice module never reads `ctx.currentTime`; **every scheduled time is an argument.** Every
  change in this plan must apply equally to `audioEngine` and to `createRenderEngine(ctx)` —
  `src/audio/export/renderMixdown.ts` is migrated in the same task as the live callers, never
  later, and "the render needs its own copy of this" is a defect report, not a second
  implementation.
- **Music Core owns pitch parsing** (`noteMidi`, `pitchClassOfNote`, `chromaOfNote`,
  `midiToSharpName`, `octaveOfNote`), and nothing outside `src/musicCore/` hand-rolls a note-name
  regex. This plan **reuses `noteFrequency` from `src/utils/musicTheory.ts` verbatim** — which
  itself calls `noteMidi` from `@/musicCore` — and **implements no new pitch parsing, no new
  conversion function, and no second copy of the 440 Hz / 12-TET arithmetic.**
- **No migration chains and no persisted-shape change.** This is a pure runtime/type refactor:
  `PERSIST_VERSION`, `PROJECT_FORMAT_VERSION`, `partializeAppState` and `PROJECT_CONTENT_KEYS` are
  not touched, and **the audio engine still writes no persisted application state** (layering rule
  1 already forbids it; Task 4 keeps proving it).
- **Rendered audio must not change.** `src/audio/engine.render.test.ts` is a byte-identical
  offline-render regression test. **No fixture pitch or frequency literal in it may be edited.**
  If one appears to need editing, the refactor has introduced a real pitch computation difference —
  stop and find it; do not update the fixture.
- **`bun run verify` is the completion gate.** `bun run eslint` currently reports **nothing at
  all** — no errors and no warnings — and both Knip scans have a zero-finding baseline. A new
  ESLint rule lands as `warn` and flips to `error` in the change that empties it (decision D5);
  the guard in Task 4 lands **directly at `error`** because its file set is clean from the moment
  Task 2 commits, so there is nothing to phase in.
- **`no-restricted-imports` REPLACES rather than merges** across flat-config objects. A narrower
  block must re-spread every broader restriction list that would otherwise stop applying to the
  files it matches. This has bitten this repo twice already.

---

### Task 1: The voice and the manager run on Hz; the engine converts at its own front door

**Files:**
- Modify: `src/audio/synth/subtractiveVoice.ts:10` (drop the import), `:93-101`
  (`SubtractiveVoiceEvent`), `:135-144` (`SubtractiveVoice`), `:206-220` (`glideTo` doc +
  signature), `:978-993` (`VoiceGlide`), `:1005-1017` (`createVoiceGlide` signature + seed),
  `:1078-1092` (`glideTo` body), `:1118`, `:1153`, `:1205-1207`
- Modify: `src/audio/synth/voiceManager.ts:98-109` (`ManagedVoice`), `:144-158`
  (`SynthVoiceNoteOn`), `:240-259` (`VoiceGroup`), `:261-266` (`MonoEntry`), `:453`, `:586`,
  `:592`, `:613-638`, `:648-651`, `:675`
- Modify: `src/audio/engine.ts:2` (import), `:187-211` (`triggerSynthNoteOn` body only — the public
  signature still takes `noteName: string` in this task)
- Test: `src/audio/synth/subtractiveVoice.glide.test.ts` (fixtures + a new regression test),
  `src/audio/synth/subtractiveVoice.test.ts`, `src/audio/synth/subtractiveVoice.noise.test.ts`,
  `src/audio/synth/subtractiveSignal.test.ts`, `src/audio/synth/voiceManager.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `SubtractiveVoiceEvent` — `{ source: string; owner: VoiceOwner; frequency: number; velocity: number; at: number; unisonIndex?: number; scaleFactor?: number }` (`noteName` removed)
  - `SubtractiveVoice.frequency: number` (readonly getter, replaces `noteName`)
  - `SubtractiveVoice.glideTo(frequency: number, at: number, seconds: number): void`
  - `ManagedVoice.frequency: number`, `ManagedVoice.glideTo(frequency: number, at: number, seconds: number): void`
  - `SynthVoiceNoteOn` — `{ source: string; owner: VoiceOwner; frequency: number; velocity: number; at: number; scaleFactor?: number; synth: ActiveSynth }`
  - `AudioEngine.triggerSynthNoteOn(noteName: string, …)` — **unchanged public signature in this task**; Task 2 flips it.

- [ ] **Step 1: Write the failing glide regression test**

The highest-risk mechanic in this refactor is glide: `glideTo`'s ramp endpoint moves from
`noteFrequency(noteName)` to the caller's own number, and a mistake there is inaudible in a type
check. The *curve* is already pinned in Hz by this file's first test
(`'ramps every pitched source to the new note exponentially, each keeping its own tuning'`, which
asserts `['cancel', 2.5]` at `events[0]`, a `'set'` at `C4 * ratio` and an `'exp'` to
`E4 * ratio` — all three already frequency assertions), so Step 9's mechanical conversion of that
test **is** the curve regression check and no duplicate of it is added here.

What is genuinely new is the property the old signature made unrepresentable: the endpoint is now
the caller's number **verbatim**, not a value re-derived by parsing a name. Pin that, and rename
the reporting test.

In `src/audio/synth/subtractiveVoice.glide.test.ts`, replace the existing
`'the voice reports the note it is now sounding, not the note that built it'` test with these two:

```typescript
  test('the voice reports the frequency it is now sounding, not the one that built it', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, glidePatch(), noteEvent({ at: 2 }));

    expect(voice.frequency).toBeCloseTo(C4, 9);
    voice.glideTo(E4, 3, 0.4);
    expect(voice.frequency).toBeCloseTo(E4, 9);
  });

  /**
   * DEV-399: the endpoint is the CALLER's resolved frequency, used verbatim.
   * 444.5 Hz is deliberately a pitch no note name names — under the old
   * note-name signature this bend was unrepresentable, and any re-derivation
   * of the target through a name (a round-trip to the nearest semitone, say)
   * would land on 440 and fail here.
   */
  test('a glide lands on exactly the frequency it was given, semitone grid or not', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, glidePatch(), noteEvent({ at: 2 }));

    voice.glideTo(444.5, 2.5, 0.4);

    const events = logged(ctx.oscillators[0].frequency).events;
    expect(events[0]).toEqual(['cancel', 2.5]);
    expect(events[1][0]).toBe('set');
    expect(events[1][1]).toBeCloseTo(C4, 6);
    expect(events[2][0]).toBe('exp');
    expect(events[2][1]).toBeCloseTo(444.5, 9);
    expect(events[2][2]).toBeCloseTo(2.9, 6);
    expect(voice.frequency).toBeCloseTo(444.5, 9);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test src/audio/synth/subtractiveVoice.glide.test.ts`
Expected: FAIL — `voice.frequency` is `undefined` (the voice exposes `noteName`), and
`voice.glideTo(E4, …)` passes a number where the current signature wants a string.

- [ ] **Step 3: Put `subtractiveVoice.ts` on Hz**

Delete line 10 entirely:

```typescript
import { noteFrequency } from '@/utils/musicTheory';
```

Replace `SubtractiveVoiceEvent` (currently lines 93-101):

```typescript
export interface SubtractiveVoiceEvent {
  source: string;
  owner: VoiceOwner;
  /**
   * The pitch this voice sounds, in Hz, ALREADY RESOLVED by whatever
   * scheduled it (DEV-399). Never a note name: a name is a notation decision
   * and the engine takes none — and a name in here is the raw material a
   * `${source}:${noteName}` voice lookup gets rebuilt from, which is the exact
   * defect `voiceId.ts` exists to prevent.
   */
  frequency: number;
  velocity: number;
  at: number;
  unisonIndex?: number;
  scaleFactor?: number;
}
```

In `interface SubtractiveVoice`, replace the `noteName` member (currently lines 139-144):

```typescript
  /**
   * The frequency this voice is sounding NOW in Hz, which is not always the
   * one that built it: `glideTo` rewrites it, so a Mono voice carried across a
   * legato phrase reports the pitch in the air rather than the one it was born
   * on.
   */
  readonly frequency: number;
```

In the same interface, replace `glideTo`'s doc opening and signature (currently lines 206-220) —
keep every other line of that docblock verbatim:

```typescript
  /**
   * Retunes every pitched source — both oscillator slots and the sub — to
   * `frequency` Hz, exponentially; `seconds` of 0 moves the pitch on the
   * instant. A key-tracked cutoff follows, unless ENV2 owns it.
   *
   * No envelope is touched: this is the legato half of Mono voice mode, where
   * an overlapping note bends the sounding voice instead of starting a new
   * one. A RETRIGGER is a new voice, never a glide.
   *
   * `at` may be in the FUTURE, and a glide booked while another is still in
   * flight anchors on the value the running ramp WILL hold at `at` — computed
   * from the ramp, never read off `param.value`, for the same reason
   * `release` computes its own anchors.
   */
  glideTo(frequency: number, at: number, seconds: number): void;
```

- [ ] **Step 4: Put the glide helper on Hz and delete its duplicated state**

Replace `interface VoiceGlide`'s first two members (currently lines 979-981):

```typescript
interface VoiceGlide {
  readonly frequency: number;
  glideTo(frequency: number, at: number, seconds: number): void;
```

Replace `createVoiceGlide`'s signature and seed (currently lines 1005-1017) — note the third
parameter is **deleted**, not retyped: with the name gone, "the note in the air" and
`tuning.baseFrequency` are the same number, and keeping a second copy of it is two fields that can
disagree:

```typescript
function createVoiceGlide(
  nodes: SubtractiveVoiceNodes,
  tuning: VoiceTuning,
  startAt: number,
): VoiceGlide {
  let ramp: PitchRamp = {
    from: tuning.baseFrequency,
    to: tuning.baseFrequency,
    startAt,
    endAt: startAt,
  };
```

Replace the returned object's first two members (currently lines 1078-1092):

```typescript
  return {
    get frequency(): number {
      // `tuning.baseFrequency` IS the note in the air — `glideTo` writes it on
      // every bend — so there is no second copy to keep in step.
      return tuning.baseFrequency;
    },
    glideTo(frequency: number, at: number, seconds: number): void {
      ramp = { from: frequencyAt(at), to: frequency, startAt: at, endAt: at + Math.max(0, seconds) };
      tuning.baseFrequency = ramp.to;
      retuneOscillator(0, at);
      retuneOscillator(1, at);
      retuneSub(at);
      // Only a key-tracked cutoff follows the NOTE; an untracked one is not
      // part of the glide at all and must not gain automation from it.
      if (tuning.filter.keyTrack > 0 && cutoffIsOurs()) follow(nodes.filter.frequency, cutoffValue, at);
    },
```

- [ ] **Step 5: Wire the three remaining sites in `createSubtractiveVoice`**

Line 1118 — the voice no longer resolves anything, it is handed the answer:

```typescript
  const baseFrequency = event.frequency;
```

Line 1153 — one fewer argument:

```typescript
  const glide = createVoiceGlide(nodes, tuning, at);
```

Lines 1205-1207, in the returned object:

```typescript
    get frequency(): number {
      return glide.frequency;
    },
```

- [ ] **Step 6: Put `voiceManager.ts` on Hz**

`ManagedVoice` (lines 98-109) — replace two members:

```typescript
  readonly frequency: number;
```
```typescript
  glideTo(frequency: number, at: number, seconds: number): void;
```

`SynthVoiceNoteOn` (line 147) — replace `noteName: string;` with:

```typescript
  /** The pitch to sound, in Hz, resolved by the caller — see `SubtractiveVoiceEvent.frequency`. */
  frequency: number;
```

`VoiceGroup` (line 248) — replace `noteName: string;` with `frequency: number;`.

`MonoEntry` (lines 261-266) — replace `noteName: string;` with `frequency: number;`, and update
the interface's docblock line so it still reads true:

```typescript
/** One held note on a Mono channel. The ID is what makes the stack owner-safe. */
interface MonoEntry {
  id: VoiceId;
  frequency: number;
  owner: VoiceOwner;
}
```

`MonoChannel`'s docblock (lines 268-273) mentions "a stack keyed by note name" as the rejected
alternative — leave that sentence alone; it is describing the defect, not the field.

- [ ] **Step 7: Wire the six call sites inside `voiceManager.ts`**

Line 453 (inside `stopOwner`'s mono branch) and line 675 (inside `monoRelease`) are the same
comparison; both become:

```typescript
      if (top.frequency !== channel.group.frequency) this.glideChannel(channel, top.frequency, at);
```

Line 586, in `monoNoteOn`:

```typescript
    const entry: MonoEntry = { id, frequency: input.frequency, owner: input.owner };
```

Line 592, in `monoNoteOn`:

```typescript
      this.glideChannel(channel, input.frequency, input.at);
```

Lines 613-621, in `createGroup`'s unison loop:

```typescript
      const event: SubtractiveVoiceEvent = {
        source: input.source,
        owner: input.owner,
        frequency: input.frequency,
        velocity: input.velocity,
        at: input.at,
        unisonIndex,
        scaleFactor,
      };
```

Line 633, in the `VoiceGroup` literal: `frequency: input.frequency,`.

Lines 648-651:

```typescript
  private glideChannel(channel: MonoChannel, frequency: number, at: number): void {
    for (const voice of channel.group.voices) voice.glideTo(frequency, at, channel.glideSeconds);
    channel.group.frequency = frequency;
  }
```

- [ ] **Step 8: Convert once, at the engine's front door**

This is the transitional half of the relocation: the public signature still takes a note name, so
no caller moves yet, but the parse now happens **once per note-on** instead of once per unison
voice, and `src/audio/synth/**` is music-domain-free from this commit on.

`src/audio/engine.ts` line 2:

```typescript
import { noteFrequency, STEPS_PER_BAR } from '../utils/musicTheory';
```

`src/audio/engine.ts` lines 202-210, inside `triggerSynthNoteOn` (signature unchanged):

```typescript
    return this.synthManager.noteOn({
      source,
      owner,
      // DEV-399, stage 1: resolved ONCE here rather than once per unison voice
      // inside the voice itself. Task 2 moves this out to the callers and this
      // import goes with it.
      frequency: noteFrequency(noteName),
      velocity,
      at: time ?? ctx.currentTime,
      scaleFactor,
      synth,
    });
```

- [ ] **Step 9: Update the engine-internal test fixtures**

These are mechanical: the event/note-on literals below are built by test helpers, so each file has
one or two places to change.

In `src/audio/synth/subtractiveVoice.glide.test.ts`, the `noteEvent` helper (line 30) becomes —
note `C4` is already declared in this file at line 41, so move the three `const C4/E4/C5`
declarations above `noteEvent`:

```typescript
function noteEvent(over: Partial<SubtractiveVoiceEvent> = {}): SubtractiveVoiceEvent {
  return { source: 'synth', owner: 'live', frequency: C4, velocity: 1, at: 2, ...over };
}
```

Every `voice.glideTo('E4', …)` / `glideTo('C5', …)` in that file becomes `voice.glideTo(E4, …)` /
`voice.glideTo(C5, …)`. **No assertion in this file changes**: every expectation in it is already
a frequency (`C4 * ratio`, `E4 * ratio`, `C4 * 2`, `C5 * 2`, `8000`), which is exactly why the
first test — `'ramps every pitched source to the new note exponentially, each keeping its own
tuning'` — becomes the glide-curve regression check for this refactor simply by having its
argument converted. If any expected number in this file needs adjusting, the ramp math moved and
the change is wrong.

In `src/audio/synth/subtractiveVoice.test.ts` (line 44) and
`src/audio/synth/subtractiveVoice.noise.test.ts` (line 31), the `noteEvent` helpers take the same
treatment — add `import { noteFrequency } from '@/utils/musicTheory';` and a
`const C4 = noteFrequency('C4');` above each helper:

```typescript
function noteEvent(over: Partial<SubtractiveVoiceEvent> = {}): SubtractiveVoiceEvent {
  return { source: 'synth', owner: 'live', frequency: C4, velocity: 1, at: 2, ...over };
}
```

`subtractiveVoice.test.ts:72` (`expect(voice.noteName).toBe('C4')`) becomes
`expect(voice.frequency).toBeCloseTo(noteFrequency('C4'), 9)`, and `:404`
(`noteEvent({ noteName: 'C5' })`) becomes `noteEvent({ frequency: noteFrequency('C5') })`.

In `src/audio/synth/subtractiveSignal.test.ts:1034-1064`, keep the name constant for readability
and resolve beside it:

```typescript
  const NOTE_HZ_NAME = 'C7';
  const NOTE_HZ = noteFrequency(NOTE_HZ_NAME);
```
```typescript
      { source: 'synth', owner: 'live', frequency: NOTE_HZ, velocity: 1, at: 0 },
```

In `src/audio/synth/voiceManager.test.ts`, the `event` helper (around line 159) becomes
`frequency: C4`, with `const C4 = noteFrequency('C4');` (and `E4`, `G4`) declared near the top of
the file; every `event({ noteName: 'E4' })` becomes `event({ frequency: E4 })`, and so on for each
of the ~20 occurrences. These tests are about ownership, stacking and stealing — **no assertion
about owners, ids, budgets or release times may change**, only the pitch literals.

- [ ] **Step 10: Run the engine suite and verify it passes**

Run: `bun test src/audio/synth/ src/audio/engine.test.ts src/audio/engine.render.test.ts src/audio/clock.test.ts src/audio/masterRack.test.ts`
Expected: PASS, including the two new glide tests. `engine.render.test.ts` must pass **with no
edit to it at all** — it still calls `triggerSynthNoteOn('C4', …)` and the public signature has not
moved yet.

- [ ] **Step 11: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: both clean. `bun run eslint` must report **nothing at all** — no errors and no warnings.

- [ ] **Step 12: Commit**

```bash
git add src/audio/synth/ src/audio/engine.ts
git commit -m "refactor(audio): the voice and manager run on resolved Hz, not note names"
```

---

### Task 2: Flip the public contract — `triggerSynthNoteOn` takes a frequency

**Why this task cannot be split further:** `triggerSynthNoteOn`'s pitch parameter is positional,
so its type cannot change for one caller at a time without a transitional `string | number` union
— a parameter that means two different things, which is precisely the shape CLAUDE.md's
"whole-bus reach requires calling a method whose name says so" scar warns against. The flip is
therefore one atomic compile unit, and `tsc --noEmit` is what proves it is complete: after the
signature changes, **every** unmigrated call site is a type error, so none can be silently missed.
The steps below walk it file by file.

**Files:**
- Modify: `src/audio/engine.ts:2` (revert the import), `:174-211` (signature + doc)
- Modify: `src/audio/playback/synthPlayback.ts:49-73`
- Modify: `src/audio/playback/playbackEngine.ts:20-37`
- Modify: `src/audio/playback/arpPlayback.ts:6`, `:190`
- Modify: `src/audio/playback/chordPlayback.ts:137`, `:282-290`, `:326-334`
- Modify: `src/audio/playback/presetPreview.ts:6`, `:167`, `:212`, `:244`
- Modify: `src/audio/export/renderMixdown.ts:43`, `:479-481`, `:555-558`
- Test: `src/audio/clock.test.ts`, `src/audio/masterRack.test.ts`,
  `src/audio/engine.render.test.ts`, `src/audio/synth/subtractiveSignal.test.ts`,
  `src/audio/playback/chordPlayback.test.ts`, `src/audio/playback/presetPreview.test.ts`,
  `src/store/midiInput.test.ts`, `src/components/useInputDeck.test.tsx`

**Interfaces:**
- Consumes: `SynthVoiceNoteOn.frequency` from Task 1.
- Produces:
  - `AudioEngine.triggerSynthNoteOn(frequency: number, synth: ActiveSynth, velocity?: number, time: number | undefined, source: string, scaleFactor: number, owner: VoiceOwner): VoiceId | null`
  - `synthPlaybackNoteOn(note: string, …)` and `playbackNoteOn(noteName: string, …)` keep their
    existing note-name signatures — **no file in `src/components/` or `src/store/` changes.**

- [ ] **Step 1: Write the failing boundary test**

Add to `src/components/useInputDeck.test.tsx`, replacing the assertion at line 329 inside
`'a melodic focus plays the engine and announces on the bus'`:

```typescript
    expect(initSpy).toHaveBeenCalled();
    expect(noteOnSpy).toHaveBeenCalled();
    // DEV-399: the ENGINE gets a resolved frequency; the note-input bus gets
    // the name. One line, two vocabularies — that is the whole separation.
    expect(noteOnSpy.mock.calls[0]?.[0]).toBeCloseTo(noteFrequency('C4'), 9);
    expect(events).toEqual([{ kind: 'on', note: 'C4', velocity: 1.0, time: undefined }]);
```

Add the import at the top of that file: `import { noteFrequency } from '@/utils/musicTheory';`

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test src/components/useInputDeck.test.tsx -t "a melodic focus plays the engine"`
Expected: FAIL — the spy's first argument is the string `'C4'`, not a number.

- [ ] **Step 3: Flip the engine signature**

`src/audio/engine.ts` line 2 — back to what it was before Task 1:

```typescript
import { STEPS_PER_BAR } from '../utils/musicTheory';
```

Replace the whole of `triggerSynthNoteOn` (lines 174-211), docblock included:

```typescript
  // SynthVoiceManager
  /**
   * Starts one logical voice at a RESOLVED FREQUENCY and hands back the
   * identity that addresses it.
   *
   * `frequency` is Hz, already resolved by the controller that scheduled this
   * note (DEV-399). The engine takes no key, scale, chord or notation
   * decision, and it never parses a note name: a name is domain vocabulary,
   * and the one place it would be read from here is a
   * `` `${source}:${noteName}` `` voice lookup — the defect `VoiceId` exists to
   * make unrepresentable.
   *
   * The return value is the whole point of this API: three players share every
   * melodic bus (the live keyboard, the arp, the melody-track sequencer), so a
   * source-and-pitch pair names as many voices as happen to be sounding and a
   * note-off resolved that way cuts whichever one it finds. A bridge keeps the
   * ID it was given and releases THAT instance.
   *
   * `null` before the AudioContext exists — the same no-op-before-init
   * contract every setter on this class follows.
   */
  triggerSynthNoteOn(
    frequency: number,
    synth: ActiveSynth,
    velocity = DEFAULT_VELOCITY,
    time: number | undefined,
    source: string,
    scaleFactor: number,
    owner: VoiceOwner,
  ): VoiceId | null {
    const ctx = this.ctx;
    if (!ctx || !this.synthManager) return null;
    // wakeIfIdle() re-arms the idle countdown itself on every reachable path,
    // so there is no second markActivity() here. Every caller reaches this
    // choke point, MIDI input included, which has no gesture path of its own.
    this.hooks.wakeIfIdle();
    return this.synthManager.noteOn({
      source,
      owner,
      frequency,
      velocity,
      at: time ?? ctx.currentTime,
      scaleFactor,
      synth,
    });
  }
```

- [ ] **Step 4: Migrate the two shared bridges**

These two files cover six of the nine routes: the live computer keyboard, the on-screen keyboard
and external MIDI (all through `synthPlaybackNoteOn`), and the lead track, the FX track and the
chord hook's sequenced notes (all through `playbackNoteOn`).

`src/audio/playback/synthPlayback.ts` — add the import and convert at the call:

```typescript
import { noteFrequency } from "@/utils/musicTheory";
```
```typescript
  const voiceId = audioEngine.triggerSynthNoteOn(
    // DEV-399: the boundary. Below this line the engine knows only Hz; `note`
    // survives for the note-input bus, which is what a recorder reads.
    noteFrequency(note),
    synth,
    velocity,
    time,
    target,
    scaleFactor,
    "live",
  );
```

`src/audio/playback/playbackEngine.ts` — add the import and convert at line 36:

```typescript
import { noteFrequency } from "@/utils/musicTheory";
```
```typescript
  return audioEngine.triggerSynthNoteOn(noteFrequency(noteName), synth, velocity, time, source, 1, "sequencer");
```

- [ ] **Step 5: Migrate the arpeggiator**

`src/audio/playback/arpPlayback.ts` line 6 — extend the existing import:

```typescript
import { noteFrequency, stepDurationSec } from '@/utils/musicTheory';
```

Line 190:

```typescript
        const voiceId = audioEngine.triggerSynthNoteOn(noteFrequency(note), synth, 0.9, at, target, 1, 'arp');
```

- [ ] **Step 6: Migrate the chord, bass and pad routes**

All three live in `src/audio/playback/chordPlayback.ts`, which already imports from
`@/utils/musicTheory` (the import block ending at line 12) — add `noteFrequency` to it.

Line 137, in `playChordEvents` (the chord lane and the bass lane both reach this):

```typescript
    const voiceId = engine.triggerSynthNoteOn(noteFrequency(ev.noteName), synth, ev.velocity, start, source, 1, "sequencer");
```

Lines 282-290, in `playFullHoldChord` (the chord lane's full hold AND the pad lane, which passes
its own `source`):

```typescript
    const voiceId = engine.triggerSynthNoteOn(
      noteFrequency(n),
      synth,
      DEFAULT_VELOCITY * equalPowerVelocityScale(notes.length),
      startTime,
      source,
      1,
      "sequencer",
    );
```

Lines 326-334, in `playChordLegato` (the held chord-card audition):

```typescript
    engine.triggerSynthNoteOn(
      noteFrequency(note),
      synth,
      DEFAULT_VELOCITY * equalPowerVelocityScale(notes.length),
      undefined,
      "chord",
      1,
      "preview",
    );
```

- [ ] **Step 7: Migrate the preview routes**

`src/audio/playback/presetPreview.ts` line 6 — extend the existing import:

```typescript
import { generateBlockChordNotes, noteFrequency } from '@/utils/musicTheory';
```

Line 167 (progression audition), line 212 (synth-patch audition) and line 244 (sequencer/melody-cell
audition):

```typescript
        const voiceId = audioEngine.triggerSynthNoteOn(noteFrequency(n), synth, 0.75, start, PREVIEW_SOURCE, 1, "preview");
```
```typescript
  const voiceId = audioEngine.triggerSynthNoteOn(noteFrequency('C4'), synth, 0.85, start, PREVIEW_SOURCE, 1, "preview");
```
```typescript
  const voiceId = audioEngine.triggerSynthNoteOn(noteFrequency(note), synth, velocity, start, PREVIEW_SOURCE, 1, "preview");
```

- [ ] **Step 8: Migrate the offline renderer**

`src/audio/export/renderMixdown.ts` line 43 — extend the existing import:

```typescript
import { noteFrequency, stepDurationSec } from '@/utils/musicTheory';
```

Lines 479-481 (the melody lane):

```typescript
    const voiceId = engine.triggerSynthNoteOn(
      noteFrequency(note.note), track.params, DEFAULT_VELOCITY, start, track.source, 1, 'sequencer',
    );
```

Lines 555-558 (the bass full hold):

```typescript
          const voiceId = engine.triggerSynthNoteOn(
            noteFrequency(plan.bassFullHold.noteName), loop.bassSynthParams, plan.bassFullHold.velocity,
            time, 'bass', 1, 'sequencer',
          );
```

- [ ] **Step 9: Run the type-check to enumerate the remaining test sites**

Run: `bun run lint`
Expected: FAIL, listing exactly the test call sites in Steps 10-11. Use its output as the
worklist — a site it does not name does not need touching.

- [ ] **Step 10: Update the direct-call test sites**

These pass a literal `'C4'` positionally and assert nothing about it. In each file add
`import { noteFrequency } from '@/utils/musicTheory';` and a `const C4_HZ = noteFrequency('C4');`
near the top, then replace the literal:

- `src/audio/clock.test.ts` — six calls (lines 565, 615, 625, 651, 678, 708, 804):
  `engine.triggerSynthNoteOn(C4_HZ, ACTIVE_SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live')`
- `src/audio/masterRack.test.ts` — six calls (lines 745, 763, 777, 789, 816, 924): same
  substitution, every other argument untouched.
- `src/audio/synth/subtractiveSignal.test.ts:79` and `:691` — this file already has
  `const NOTE = 'C3'` at line 38; add `const NOTE_FREQ = noteFrequency(NOTE);` beside it and pass
  `NOTE_FREQ`.
- `src/audio/engine.render.test.ts:54` —
  `const voiceId = engine.triggerSynthNoteOn(noteFrequency('C4'), synth, 1, 0, 'synth', 1, 'sequencer');`
  **This is the one line in that file that may change. Its expected-audio fixture must not.**

- [ ] **Step 11: Update the four spy-based test sites**

`src/audio/playback/chordPlayback.test.ts` — the fake ids encode the pitch, so they move to Hz
with it (lines 39-42 and 51-53):

```typescript
const voiceIdFor = (frequency: number) => `voice-${frequency}` as VoiceId;

/** The inverse of `voiceIdFor`, for a spy that logs by the frequency it played. */
const freqOfVoice = (voiceId: VoiceId) => Number(voiceId.replace('voice-', ''));
```
```typescript
function spyNoteOn() {
  return spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation((frequency: number) =>
    voiceIdFor(frequency),
  );
}
```

Every `voiceIdFor('C4')` in that file becomes `voiceIdFor(noteFrequency('C4'))`; the
`noteOfVoice` call inside the note-off spy at line 449 becomes `freqOfVoice`, and the `calls`
array's `note: string` field becomes `freq: number`. Rename the local variable in the assertions
to match — the test's subject (strum timing, off-never-before-on) does not change.

`src/audio/playback/presetPreview.test.ts` — three destructured assertions (lines ~388, ~403,
~418). The first element is now a number:

```typescript
      const [freq, synth, velocity, , source, scaleFactor, owner] = onSpy.mock.calls[0];
      expect([freq, synth, velocity, source, scaleFactor, owner]).toEqual(
        [noteFrequency('C4'), LOUD, 0.8, 'preview', 1, 'preview'],
      );
```

and the progression test's played-note comparison:

```typescript
      const expected = generateBlockChordNotes('min7', 'A', 4).map((n) => noteFrequency(n));
      const played = onSpy.mock.calls.map((call) => call[0]);
      expect(played).toEqual(expected);
```

`src/store/midiInput.test.ts` — `spyNotePair` (lines 141-150) encodes the pitch in the fake id:

```typescript
  const on = spyOn(audioEngine, 'triggerSynthNoteOn').mockImplementation(
    (frequency: number) => `voice-${frequency}` as VoiceId,
  );
```
```typescript
    /** The FREQUENCIES the releases addressed, recovered from the ids they were given. */
    releasedFrequencies: () => off.mock.calls.map((call) => Number(String(call[0]).replace('voice-', ''))),
```

Every assertion in that file comparing `releasedNotes()` to a list of names becomes
`releasedFrequencies()` compared to `['C4', …].map((n) => noteFrequency(n))`. Add
`import { noteFrequency } from '@/utils/musicTheory';`.

`src/audio/export/renderMixdown.test.ts:678` asserts only `expect(noteOn).not.toHaveBeenCalled()`
— **no change needed there.**

- [ ] **Step 12: Run the full suite**

Run: `bun test`
Expected: PASS. In particular `src/audio/engine.render.test.ts` must pass with its expected-audio
fixture untouched — if it does not, a pitch computation changed and the cause must be found before
proceeding. `src/components/useInputDeck.test.tsx`'s new assertion is the boundary proof.

- [ ] **Step 13: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: both clean; `bun run eslint` reports nothing at all.

- [ ] **Step 14: Commit**

```bash
git add src/audio src/store/midiInput.test.ts src/components/useInputDeck.test.tsx
git commit -m "refactor(audio): the engine takes a resolved frequency, never a note name"
```

---

### Task 3: The engine's note contract, pinned by its own API tests

The DoD asks for engine API tests covering note-on/off identity, focus changes, multiple owners
and glide. Those behaviours are currently asserted across five files at different levels
(`voiceManager.test.ts` against a fake voice, `clock.test.ts` against the idle timer, and so on),
and none of them asserts the *engine's public surface* end to end. This task adds one file that
does, against the real engine with the fake context — so a future edit to the note-on contract
has a single place that fails.

**Files:**
- Create: `src/audio/engineNoteContract.test.ts`

**Interfaces:**
- Consumes: `AudioEngine.triggerSynthNoteOn(frequency, …)` from Task 2; `freshEngine()`/`fakeCtx()`
  from `src/audio/testFakes.ts`; `VOICE_OWNERS` from `src/audio/voiceOwner.ts`.
- Produces: no source exports — a test file only.

- [ ] **Step 1: Write the contract tests**

Create `src/audio/engineNoteContract.test.ts`. The harness is this repo's existing one and must
not be replaced: `freshEngine()` from `./testFakes` returns `{ engine, ctx }` with a fake
`AudioContext` **already bound** (no `init()` call, no DOM, no testing-library — there is none in
this repo and none may be added), and `ACTIVE_SYNTH` from `./engineTestHelpers` is the complete
`ActiveSynth` every engine test uses.

```typescript
/**
 * The engine's note contract, at its public surface (DEV-399).
 *
 * Every assertion here is about the CONTRACT, not the DSP: a note-on takes a
 * resolved frequency and returns the identity a note-off addresses; an owner
 * scopes a release; a bus-wide stop is a different method with a different
 * reach. The audible result of any one note is `subtractiveVoice.test.ts`'s
 * subject, not this file's.
 */
import { describe, expect, test } from 'bun:test';
import { noteFrequency } from '../utils/musicTheory';
import { freshEngine } from './testFakes';
import { ACTIVE_SYNTH } from './engineTestHelpers';

const C4 = noteFrequency('C4');
const E4 = noteFrequency('E4');

/** ACTIVE_SYNTH in Mono, with a glide long enough to be a bend rather than a step. */
const MONO_SYNTH = {
  ...ACTIVE_SYNTH,
  patch: {
    ...ACTIVE_SYNTH.patch,
    common: { ...ACTIVE_SYNTH.patch.common, voiceMode: 'mono' as const, glideSeconds: 0.1 },
  },
};

describe('engine note contract: identity', () => {
  test('a note-on at a frequency returns an id, and two note-ons at the SAME frequency return different ids', () => {
    const { engine } = freshEngine();
    const first = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live');
    const second = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'sequencer');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(engine.liveVoiceCount()).toBe(2);
  });

  test('a note-off releases exactly the voice its id names, leaving the other sounding', () => {
    const { engine } = freshEngine();
    const live = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'sequencer');
    engine.triggerSynthNoteOff(live, 0.3, 0);
    expect(engine.liveVoiceCount()).toBe(1);
  });

  test('a note-on before the AudioContext exists returns null and sounds nothing', () => {
    const engine = freshEngine();
    expect(engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, undefined, 'synth', 1, 'live')).toBeNull();
  });
});

describe('engine note contract: owners', () => {
  test('releaseSoundingVoices reaches ONE owner on ONE bus and no other', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live');
    engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'bass', 1, 'arp');
    engine.releaseSoundingVoices('synth', 0.05, 'arp');
    // the live voice on 'synth' and the arp voice on 'bass' both survive.
    expect(engine.liveVoiceCount()).toBe(2);
  });

  test('stopSource is whole-bus: it reaches every owner on that bus', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live');
    engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'bass', 1, 'sequencer');
    engine.stopSource('synth', 0.05, 0);
    // Only the other BUS survives — that is the difference from the test above,
    // and it is what a project install, a loop load and a vibe swap rely on.
    expect(engine.liveVoiceCount()).toBe(1);
  });
});

describe('engine note contract: a focus change mid-hold', () => {
  test('a note started on one bus is released on the bus it was started on, whatever is focused now', () => {
    const { engine } = freshEngine();
    // The keyboard's bus follows focusTrack, so a hold can span a change: the
    // id, not the current focus, is what the release addresses.
    const held = engine.triggerSynthNoteOn(C4, ACTIVE_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    engine.triggerSynthNoteOn(E4, ACTIVE_SYNTH, 0.8, 0, 'bass', 1, 'live');
    engine.triggerSynthNoteOff(held, 0.3, 0);
    expect(engine.liveVoiceCount()).toBe(1);
    // ...and the surviving voice is the one on the bus focus moved TO.
    engine.stopSource('bass', 0.05, 0);
    expect(engine.liveVoiceCount()).toBe(0);
  });
});

describe('engine note contract: glide', () => {
  test('a second note on a mono bus bends the sounding voice rather than building a new one', () => {
    const { engine } = freshEngine();
    const first = engine.triggerSynthNoteOn(C4, MONO_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    const second = engine.triggerSynthNoteOn(E4, MONO_SYNTH, 0.8, 0, 'synth', 1, 'live')!;
    expect(second).not.toBe(first);
    // One SOUNDING voice, two held ids: the bus is shared and the stack is
    // what every decision about it is taken on.
    expect(engine.liveVoiceCount()).toBe(1);
    engine.triggerSynthNoteOff(second, 0.3, 0);
    expect(engine.liveVoiceCount()).toBe(1);
    engine.triggerSynthNoteOff(first, 0.3, 0);
    expect(engine.liveVoiceCount()).toBe(0);
  });
});
```

`engine.liveVoiceCount()` is the existing public accessor (`src/audio/engine.ts:413`, delegating to
`SynthVoiceManager.liveVoiceCount()`) — **do not add a new test-only accessor to `engine.ts`** for
any assertion here.

- [ ] **Step 2: Run the new file**

Run: `bun test src/audio/engineNoteContract.test.ts`
Expected: PASS. If a test fails, the assertion — not the engine — is what to fix: Task 2 changed
no behaviour, so a red test here means this file mis-describes the contract it is trying to pin.

- [ ] **Step 3: Confirm the offline render is byte-identical, explicitly**

Run: `bun test src/audio/engine.render.test.ts src/audio/export/renderMixdown.test.ts`
Expected: PASS.

Then confirm the DoD's own wording — "live and offline audio tests pass **without fixture pitch
changes**":

Run: `git diff main --stat -- src/audio/engine.render.test.ts`
Expected: exactly one changed line (the `triggerSynthNoteOn` call site from Task 2 Step 10). Any
change to an expected-sample or expected-frequency literal in that file means the refactor altered
a pitch computation — stop and find it.

- [ ] **Step 4: Commit**

```bash
git add src/audio/engineNoteContract.test.ts
git commit -m "test(audio): pin the engine's note-on/off identity, owner and glide contract"
```

---

### Task 4: The dependency guard, proven armed

**Files:**
- Modify: `eslint.config.js` — add an `ENGINE_MUSIC_DOMAIN_BAN` const beside the other ban consts
  (after `TONAL_SCOPED_PACKAGE_BAN`, around line 61) and one new config block **inserted after the
  DEV-397 planner block (ends at line 338) and before the `src/store/**` block** — the position
  matters, see Step 2
- Create: `src/architecture/engineDomainPurity.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks at the type level; the guard's file set must be
  music-domain-free, which Tasks 1-2 make true.
- Produces: no exports — a config block and its proof test.

- [ ] **Step 1: Write the failing guard-proof test**

Create `src/architecture/engineDomainPurity.test.ts`, following
`src/architecture/playbackPlannerPurity.test.ts`'s idiom exactly (ESLint's own `lintText` API,
severity asserted because `bun run verify` tolerates warnings):

```typescript
/**
 * The committed proof that DEV-399's engine dependency guard is armed.
 *
 * "The engine imports no Tonal adapter, scale catalog, chord catalog, spelling
 * or reharmonization module" is an argument that rests entirely on a config
 * file, and a config file is exactly what an ESLint upgrade loosens silently.
 * Same idiom as src/architecture/playbackPlannerPurity.test.ts and
 * src/data/dataLayerPurity.test.ts: severity is asserted too, because a block
 * that landed at 'warn' would enforce nothing.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

const ENGINE = 'src/audio/synth/__domainFixture__.ts';
/**
 * The engine facade itself. A real path, not a fixture name: the block names
 * `src/audio/engine.ts` explicitly rather than by glob, so a made-up sibling
 * filename would not be in its file set and this assertion would pass
 * vacuously. `lintText` lints the text it is given, never the file on disk.
 */
const ENGINE_ROOT = 'src/audio/engine.ts';
/** A file under src/audio/ that is NOT the engine, to prove the block is scoped. */
const CONTROLLER = 'src/audio/playback/chordPlayback.ts';

async function messagesFor(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null)
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const RESTRICTED = { ruleId: 'no-restricted-imports', severity: 2 };

const CASES: Array<[label: string, source: string]> = [
  ['the note-frequency conversion, aliased',
    "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency;\n"],
  ['the note-frequency conversion, relative',
    "import { noteFrequency } from '../../utils/musicTheory';\nexport const f = noteFrequency;\n"],
  ['Music Core, aliased',
    "import { noteMidi } from '@/musicCore';\nexport const m = noteMidi;\n"],
  ['Music Core, relative',
    "import { noteMidi } from '../musicCore';\nexport const m = noteMidi;\n"],
  ['the Tonal adapter by subpath',
    "import { octaveOfNote } from '@/musicCore/tonalAdapter';\nexport const o = octaveOfNote;\n"],
  ['the scale catalog',
    "import { SCALES } from '@/data/scales';\nexport const s = SCALES;\n"],
  ['the chord catalog',
    "import { CHORD_PROGRESSIONS } from '@/data/chordProgressions';\nexport const c = CHORD_PROGRESSIONS;\n"],
  ['note spelling',
    "import { spellNote } from '@/utils/noteSpelling';\nexport const s = spellNote;\n"],
  ['reharmonization',
    "import { snapProgressionToScale } from '@/utils/musicTheory';\nexport const s = snapProgressionToScale;\n"],
];

describe('engine music-domain guard (DEV-399)', () => {
  for (const [label, source] of CASES) {
    test(`${label} is an error inside the engine`, async () => {
      expect(await messagesFor(source, ENGINE)).toContainEqual(RESTRICTED);
    });
  }

  test('the ban reaches src/audio/engine.ts itself, not just the synth folder', async () => {
    const source = "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency;\n";
    expect(await messagesFor(source, ENGINE_ROOT)).toContainEqual(RESTRICTED);
  });

  test('the TIMING half of musicTheory is still allowed — the ban is about the domain, not the module', async () => {
    const source = "import { STEPS_PER_BAR } from '../utils/musicTheory';\nexport const s = STEPS_PER_BAR;\n";
    expect(await messagesFor(source, ENGINE_ROOT)).not.toContainEqual(RESTRICTED);
  });

  test('the block is SCOPED: a controller may still resolve a pitch', async () => {
    const source = "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency;\n";
    expect(await messagesFor(source, CONTROLLER)).not.toContainEqual(RESTRICTED);
  });

  test('the wider audio bans still apply inside the engine', async () => {
    // The narrower block REPLACES the broader rule rather than merging with it,
    // so every list it overrides has to be spread back in. These three prove it:
    // tonal (DEV-394), the store (layering rule 1 — which is also what keeps
    // "the audio engine never writes persisted application state" true), and
    // components.
    expect(await messagesFor("import { note } from 'tonal';\nexport const n = note;\n", ENGINE))
      .toContainEqual(RESTRICTED);
    expect(await messagesFor("import { useAppStore } from '@/store/store';\nexport const s = useAppStore;\n", ENGINE))
      .toContainEqual(RESTRICTED);
    expect(await messagesFor("import { Knob } from '@/components/ui/Knob';\nexport const k = Knob;\n", ENGINE))
      .toContainEqual(RESTRICTED);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test src/architecture/engineDomainPurity.test.ts`
Expected: FAIL — every music-domain case reports no error, because the block does not exist yet.
The three "wider audio bans" assertions and the two "scoped"/"timing" assertions should already
pass.

- [ ] **Step 3: Add the ban const**

In `eslint.config.js`, after `TONAL_SCOPED_PACKAGE_BAN` (ends line 61):

```javascript
// DEV-399: the ENGINE — src/audio/engine.ts, src/audio/synth/**, and the two
// other DSP runtimes beside them — receives already-resolved playable events
// and takes no key, scale, chord, spelling or notation decision. It therefore
// imports no music-domain module. The controllers in src/audio/playback/ and
// the theory modules beside them (arpeggiator.ts, bassPatterns.ts,
// chordProgressions.ts, leadMelody.ts) are deliberately NOT in this block's
// file set: resolving a pitch is their job, and this ban would be wrong there.
//
// `@/utils/musicTheory` is split rather than banned whole, because that module
// holds the TIMING helpers too (STEPS_PER_BAR, stepDurationSec) and an engine
// legitimately reads those. `allowImportNames` is an ALLOWLIST on purpose: a
// music-domain export added to musicTheory.ts later is banned here on the day
// it is written, with no edit to this file. The four names allowed are the
// timing half and nothing else.
//
// Both import forms are covered: the `@/`-aliased one a reader reaches for by
// habit and the `../`/`../../` relative one the engine files actually use
// today (`src/audio/engine.ts` imports `'../utils/musicTheory'`). A DEV-397
// re-review found a real gate that had closed only the aliased form.
const ENGINE_MUSIC_DOMAIN_BAN = [
  {
    group: [
      '**/musicCore',
      '**/musicCore/**',
      '**/utils/noteSpelling',
      '**/data/scales',
      '**/data/chordProgressions',
      '**/data/chordRhythms',
      '**/data/bassPatterns',
      '**/audio/arpeggiator',
      '**/audio/bassPatterns',
      '**/audio/chordProgressions',
      '**/audio/chordRhythms',
      '**/audio/leadMelody',
    ],
    message:
      'DEV-399: the engine receives resolved playable events — resolve pitch/scale/chord in a controller under src/audio/playback/ and pass a frequency in Hz.',
  },
  {
    group: ['**/utils/musicTheory'],
    allowImportNames: ['STEPS_PER_BAR', 'clampBpm', 'stepDurationSec', 'barDurationSec'],
    message:
      'DEV-399: the engine may read the TIMING half of musicTheory only — pitch, chord, scale and reharmonization helpers belong to the controllers (see noteFrequency at the playback boundary).',
  },
];
```

- [ ] **Step 4: Add the config block, in the right position**

Insert this block **after the DEV-397 planner block (which ends at line 338) and before the
`src/store/**` layering block**. Position is load-bearing in two directions: it must come *after*
the broad `src/audio/**` block so it wins for the files it matches, and *before* the
`'**/*.test.ts'` exemption block (line 576) whose `no-restricted-imports: 'off'` must keep winning
for test files — `subtractiveVoice.glide.test.ts` imports `noteFrequency` by design and must stay
legal.

```javascript
  {
    // DEV-399: the audio ENGINE is a domain-agnostic runtime. It takes a
    // resolved frequency in Hz, an opaque VoiceId and an owner; it parses no
    // note name and reads no scale, chord, spelling or reharmonization module.
    //
    // The file set is the runtime itself: the engine facade, the synth voice
    // runtime, and the two DSP units beside them. src/audio/clock.ts is
    // deliberately absent — it is a timing service whose whole job is bpm math
    // — and so is every controller under src/audio/playback/, whose job is to
    // do the resolving this block forbids here.
    //
    // Landed directly at 'error' per D5: Task 2 emptied the file set of every
    // music-domain import before this block existed, so there is nothing to
    // phase in a 'warn' for.
    //
    // The list below REPLACES the src/audio/** entry rather than merging with
    // it (flat config semantics — see the src/data/ block's own comments), so
    // the audio-wide bans are spread back in. Leaving them out would silently
    // un-ban `tonal`, the store and components in exactly the folder that must
    // be the most domain-free code in the app — and the store half of that is
    // also what keeps "the audio engine never writes persisted application
    // state" true.
    files: [
      'src/audio/engine.ts',
      'src/audio/synth/**/*.{ts,tsx}',
      'src/audio/drumSynth.ts',
      'src/audio/masterRack.ts',
    ],
    ignores: ['src/audio/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
            TAPER_CONVERSION_BAN,
            ...ENGINE_MUSIC_DOMAIN_BAN,
          ],
        },
      ],
    },
  },
```

- [ ] **Step 5: Run the proof test and the real lint**

Run: `bun test src/architecture/engineDomainPurity.test.ts && bun run eslint`
Expected: the test PASSES and `bun run eslint` reports **nothing at all** — no errors and no
warnings. A warning here means a real engine file still imports something the block bans; fix the
file, never the block.

- [ ] **Step 6: Adversarially verify with a real on-disk fixture**

`lintText` is not the same code path as linting the repo, and this exact discipline caught two real
gaps during DEV-397. Prove the gate fires on a file that actually exists on disk, in **both**
import forms, then delete it:

```bash
printf "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency;\n" > src/audio/synth/__adversarial__.ts
bunx eslint src/audio/synth/__adversarial__.ts; echo "exit=$?"
printf "import { noteMidi } from '../../musicCore';\nexport const m = noteMidi;\n" > src/audio/synth/__adversarial__.ts
bunx eslint src/audio/synth/__adversarial__.ts; echo "exit=$?"
rm src/audio/synth/__adversarial__.ts
```

Expected: **both** runs print a `no-restricted-imports` **error** (not a warning) and `exit=1`.
If either passes clean, the block's globs do not cover that form — fix the globs and repeat. Note
the second fixture also has two `../` levels, so it may additionally trip the repo-wide `../../`
ban; the `no-restricted-imports` error must be present regardless.

Run `git status --porcelain src/audio/synth/` afterwards and confirm the fixture is gone.

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js src/architecture/engineDomainPurity.test.ts
git commit -m "chore(eslint): ban music-domain imports in the audio engine"
```

---

### Task 5: Pin the conversion boundary itself

The ESLint guard proves the engine *cannot* resolve a pitch. It does not prove the resolution
happens in **one** identified place rather than being scattered back across the app one convenience
call at a time — which is the AC's actual wording ("frequency conversion happens once at the
approved boundary"). This task adds the allowlist that makes the boundary a reviewed decision.

**Files:**
- Create: `src/architecture/frequencyBoundary.test.ts`

**Interfaces:**
- Consumes: the migrated call sites from Task 2.
- Produces: no exports — a source-scan test.

- [ ] **Step 1: Write the failing allowlist test**

Create `src/architecture/frequencyBoundary.test.ts`:

```typescript
/**
 * Where a note name becomes a frequency (DEV-399).
 *
 * The ESLint block in eslint.config.js proves the ENGINE cannot resolve a
 * pitch. This proves the complementary half: the resolution happens at a
 * SHORT, REVIEWED list of controller boundaries rather than drifting back
 * across the app one convenience call at a time. A new entry here is a
 * decision a reviewer sees, which is the whole point — it is an allowlist, not
 * a count.
 *
 * Test files are excluded: a test may resolve a pitch to state its own
 * expectation, and several do.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every non-test module permitted to name `noteFrequency`. Each is a
 * controller that owns a scheduling decision and therefore owns resolving the
 * pitch for it — the live/MIDI bridge, the sequenced-note bridge, the arp, the
 * chord/bass/pad scheduler, the auditions, and the offline renderer, which
 * schedules the same material without the live controllers.
 */
const BOUNDARY = [
  'src/utils/musicTheory.ts', // where it is DEFINED
  'src/audio/playback/synthPlayback.ts',
  'src/audio/playback/playbackEngine.ts',
  'src/audio/playback/arpPlayback.ts',
  'src/audio/playback/chordPlayback.ts',
  'src/audio/playback/presetPreview.ts',
  'src/audio/export/renderMixdown.ts',
];

// Same walker idiom as src/store/beatLegacyBoundary.test.ts, which is the same
// kind of guard: a LITERAL allowlist over a source scan.
const SRC_ROOT = new URL('../', import.meta.url).pathname;
const REPO_ROOT = new URL('../../', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Non-test source paths under `src/`, repo-relative. */
function productionSources(): string[] {
  return sourceFiles(SRC_ROOT)
    .map((file) => relative(REPO_ROOT, file))
    .filter((path) => !path.includes('.test.'));
}

describe('the frequency-resolution boundary (DEV-399)', () => {
  test('only the approved controllers name noteFrequency', () => {
    const found = productionSources().filter((path) =>
      readFileSync(join(REPO_ROOT, path), 'utf8').includes('noteFrequency'),
    );
    expect(found.sort()).toEqual([...BOUNDARY].sort());
  });

  test('no file under src/audio/synth/ resolves a pitch at all', () => {
    const offenders = productionSources().filter(
      (path) =>
        path.startsWith('src/audio/synth/') &&
        readFileSync(join(REPO_ROOT, path), 'utf8').includes('noteFrequency'),
    );
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun test src/architecture/frequencyBoundary.test.ts`
Expected: PASS. If the first test fails with an extra path, either that file genuinely belongs on
the boundary (add it, with a one-line reason in the comment above `BOUNDARY`) or Task 2 left a
conversion somewhere it should not be. If it fails with a *missing* path, a Task 2 migration was
not applied — go back and apply it rather than shortening the list.

- [ ] **Step 3: Verify the test can fail (mutation check)**

An allowlist test that cannot go red is decoration. Prove it:

```bash
printf "import { noteFrequency } from '@/utils/musicTheory';\nexport const f = noteFrequency('C4');\n" > src/utils/__boundaryProbe__.ts
bun test src/architecture/frequencyBoundary.test.ts; echo "exit=$?"
rm src/utils/__boundaryProbe__.ts
```

Expected: the run FAILS (`exit=1`), naming `src/utils/__boundaryProbe__.ts` in the diff. Then
re-run `bun test src/architecture/frequencyBoundary.test.ts` after the `rm` and confirm it passes
again.

- [ ] **Step 4: Commit**

```bash
git add src/architecture/frequencyBoundary.test.ts
git commit -m "test(architecture): pin the one boundary where a note name becomes a frequency"
```

---

### Task 6: Record the narrowed contract, and run the completion gate

**Files:**
- Modify: `CLAUDE.md` — the fifth-axis paragraph (the sentence ending "…the sole input the audio
  engine may take once DEV-399 narrows its contract"), and a new paragraph after the existing
  "**A note-on returns the identity a note-off addresses…**" paragraph
- Modify: `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md` — the
  forward-looking references to DEV-399

**Interfaces:**
- Consumes: everything Tasks 1-5 landed.
- Produces: the documentation a future reader needs so that none of this has to be rediscovered.

- [ ] **Step 1: Update the fifth-axis sentence in CLAUDE.md**

Find the sentence in the Tonal-confinement paragraph that currently reads:

> …or a **playable event** (a fully resolved, timestamped instruction — pitch and timing already
> resolved, voice ownership already assigned — that is the sole input the audio engine may take
> once DEV-399 narrows its contract);

Replace `once DEV-399 narrows its contract` with `(DEV-399)`, so the clause reads
"…that is the sole input the audio engine takes (DEV-399);". The rest of the sentence, including
the path reference that follows it, stays verbatim.

- [ ] **Step 2: Add the engine-contract paragraph to CLAUDE.md**

Insert immediately **after** the paragraph beginning "**A note-on returns the identity a note-off
addresses, and every voice records the PLAYER that created it.**" and before the
"**Equal-power polyphony…**" paragraph:

```markdown
**The engine takes a frequency, not a note name, and that is where the music domain stops.**
`triggerSynthNoteOn(frequency, synth, velocity, time, source, scaleFactor, owner)` takes Hz
already resolved by its caller (DEV-399); `SynthVoiceNoteOn`, `ManagedVoice` and
`SubtractiveVoiceEvent` all carry `frequency: number` and no note name at all. The conversion is
`noteFrequency` — the same function, unmoved and unchanged — called by the CONTROLLER that
schedules the note, and `src/architecture/frequencyBoundary.test.ts` holds the allowlist of the
seven files permitted to name it, so adding an eighth is a decision a reviewer sees. Two things
follow that are easy to undo by accident. **The engine has no display vocabulary and must not
regain one**: a note name passed in "just for logging" is the raw material a
`` `${source}:${noteName}` `` voice lookup gets rebuilt from, which is the exact defect `VoiceId`
exists to make unrepresentable — the name belongs to the note-input bus
(`emitNoteInput({ kind, note, … })` in `synthPlayback.ts`), which is a controller. And **the
engine may still read the TIMING half of `utils/musicTheory.ts`** (`STEPS_PER_BAR`,
`stepDurationSec`) — `ENGINE_MUSIC_DOMAIN_BAN` in `eslint.config.js` is an `allowImportNames`
allowlist over that module rather than a ban on it, so a pitch, chord, scale or reharmonization
export added there later is banned in the engine on the day it is written, with no config edit.
The gate covers `src/audio/engine.ts`, `src/audio/synth/**`, `drumSynth.ts` and `masterRack.ts`,
and deliberately not `clock.ts` (a timing service) or `src/audio/playback/**` (the controllers
whose job is the resolving it forbids); `src/architecture/engineDomainPurity.test.ts` is the
committed proof that the block is armed, at `error`, in both the aliased and the relative import
form.
```

- [ ] **Step 3: Update the DEV-395 contract document**

`docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md` has exactly three
`DEV-399` references, all of them forward-looking. Verify with `grep -n 'DEV-399'` and update each:

- **Line 38**, inside the layer diagram — the annotation `Tonal/musicTheory directly — DEV-399`
  marks the engine row as still resolving pitch inline. It no longer does; make the annotation
  state the landed contract (`frequency in Hz — DEV-399`) rather than the pending one.
- **Line 51**, in the same diagram — `src/audio/ (engine/DSP) — receives playable events only,
  once DEV-399 lands`. Drop `once DEV-399 lands` and end the line `— receives playable events only
  (DEV-399)`.
- **Line 135**, the audio-engine bullet — rewrite the two sentences beginning "Once DEV-399 lands,
  takes only opaque voice identity…" and "Today, several files under `src/audio/` … still resolve
  pitch/chord logic inline". The first becomes a statement of what the engine takes now (an opaque
  `VoiceId`, an owner, and a resolved `frequency: number`; no Tonal, scale, chord, spelling or
  reharmonization import, gated by `ENGINE_MUSIC_DOMAIN_BAN` and proven by
  `src/architecture/engineDomainPurity.test.ts`). The second is **still true and must stay** —
  `arpeggiator.ts`, `bassPatterns.ts` and `playback/padPlayback.ts` do resolve pitch inline, and
  that is correct: they are controllers, not the engine. Reword it so it reads as the deliberate
  split this plan drew rather than as unfinished work, and add that
  `src/architecture/frequencyBoundary.test.ts` holds the allowlist of where the conversion may
  happen.

Do not restructure the document or touch its diagrams' shape.

- [ ] **Step 4: Run the completion gate**

Run: `bun run verify`
Expected: PASS end to end — all tests, `tsc --noEmit`, `eslint` (**nothing at all**: no errors and
no warnings), `check:keys`, `check:drums`, `check:contrast`, `check:levels`, both Knip scans
(zero findings), and the production build.

Two Knip notes specific to this branch: `subtractiveVoice.ts` no longer imports
`noteFrequency`, and `createVoiceGlide` lost a parameter — if either scan reports a newly unused
export, it is a real finding from this refactor and must be resolved here, not deferred.

- [ ] **Step 5: Confirm no audio fixture moved**

Run: `git diff main --stat -- src/audio/engine.render.test.ts src/audio/export/renderMixdown.test.ts`
Expected: at most the single `triggerSynthNoteOn` call-site line in `engine.render.test.ts`. No
expected-sample, expected-frequency or expected-byte literal in either file may appear in the
diff.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md
git commit -m "docs: record the narrowed audio-engine contract and its guards"
```

---

## Acceptance-criteria mapping

| AC / DoD | Where it lands |
|---|---|
| Note-on contract separates opaque note identity from resolved frequency/pitch data | Tasks 1-2 (`VoiceId` unchanged as the sole identity; `frequency: number` as the only pitch input; note name removed from the engine). Demonstrated in one test: `useInputDeck.test.tsx` Task 2 Step 1. Architecture section records the rejected "debug label" alternative. |
| Engine imports no Tonal adapter, scale catalog, chord catalog, spelling or reharmonization module | Task 1 Step 3 (the one import deleted), Task 4 (the block + proof test, at `error`, aliased and relative forms) |
| Voice ownership, polyphony, note-off identity, glide and scheduled-tail behaviour unchanged | Global Constraints (no signature above `triggerSynthNoteOn` moves); Task 1 Steps 1/9 (glide regression; ownership assertions untouched); Task 3 (all four pinned at the public surface) |
| Live keyboard, external MIDI, arp, chord, bass, pad, lead, FX and preview routes adapt through the same boundary | Task 2 Steps 4-8: keyboard/on-screen/MIDI via `synthPlayback.ts`; lead/FX/chord-hook via `playbackEngine.ts`; arp via `arpPlayback.ts`; chord/bass/pad via `chordPlayback.ts`; the three preview routes via `presetPreview.ts`. Task 5 pins the list. |
| Project install and whole-bus stop semantics distinct from owner-scoped release/stop | Task 3 (`stopSource` vs `releaseSoundingVoices` asserted against each other); no change to either method |
| Frequency conversion happens once at the approved boundary; engine hot paths do not repeatedly parse note names | Task 1 Step 8 (once per note-on instead of once per unison voice), Task 2 (out to the controllers), Task 5 (the allowlist) |
| DSP operations — oscillator tuning, cents, semitone ratios, modulation — remain in the audio layer | Untouched by construction: `sourceRatios`, `unisonSpread`, `keyTrackedCutoff`, `sumRouteAmounts`, `scheduleModEnvelope` and the whole `follow()` ramp path stay in `subtractiveVoice.ts`. Task 6 Step 2 records it. |
| Audio engine never writes persisted application state | Layering rule 1, re-spread into the new block and asserted in Task 4 Step 1's "wider audio bans" test |
| Engine API tests cover note-on/off identity, focus changes, multiple owners and glide | Task 3 |
| A dependency guard prevents music-domain imports into the engine | Task 4 |
| Live and offline audio tests pass without fixture pitch changes | Task 3 Step 3, Task 6 Step 5 |
| `bun run verify` passes | Task 6 Step 4 |

## Self-review notes

- **Not in scope, deliberately:** `noteFrequency`'s unused `octaveOffset = 0` parameter (no caller
  passes it, before or after this plan) and the held-chord-preview backstop gap CLAUDE.md records.
  Neither is a DEV-399 AC; opening either here would put behaviour changes in a refactor whose
  whole claim is that nothing audible moves.
- **`src/audio/clock.ts` is NOT in the guard's file set.** It imports `clampBpm` and
  `stepDurationSec`, which are timing, not music domain. Adding it would be defensible but would
  widen the block past what the AC asks for; the `allowImportNames` allowlist already covers those
  two names if a later issue wants to add it.
- **The relative-import form is tested, not assumed.** `src/audio/engine.ts` imports
  `'../utils/musicTheory'` today — the aliased-only gate that DEV-397's whole-branch review found
  would have missed the single file this AC is most about.

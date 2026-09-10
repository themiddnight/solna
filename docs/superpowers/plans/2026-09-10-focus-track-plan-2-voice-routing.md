# Focus Track — Plan 2: Voice Routing and Voice Safety

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the QWERTY keyboard, the on-screen keyboard and the arpeggiator play the track `focusTrack` names — deleting `KEYBOARD_AUDITION_TARGET` — and re-establish, explicitly, every voice-lifetime guarantee that constant used to provide by construction: a per-note captured release target, a per-bus held-note count, a source-scoped engine rescale, and an arp that releases every bus it has actually triggered on.

**Architecture:** One new pure module, `src/audio/playback/heldNotes.ts`, holds the single fact everything else reads: a `Map<note, SynthControlTarget>` written at note-on. `useInputDeck` captures the target at note-on and never recomputes it at note-off; equal-power polyphony counts only the notes held on that one bus; `audioEngine.applySynthVelocityScale` gains a **required** `source` so a keyboard press stops re-shaping chord/bass/pad voices; and `ArpStateRef` swaps its single `controlTarget` for a live `target` plus a `triggeredTargets: Set<SynthControlTarget>` written at trigger time, whose every member the cleanup releases. Focus `drum` routes the melodic keyboard to `null` — nothing plays, nothing is announced on the note-input bus, and the disjoint QWERTY drum-pad key set keeps working untouched.

**Tech Stack:** TypeScript, React 19, Zustand (`subscribeWithSelector`), raw Web Audio API, Bun test runner (`bun:test`), the fake-context engine harness in `src/audio/testFakes.ts`, Vite, ESLint 9 flat config.

**Spec:** `docs/superpowers/specs/2026-09-10-focus-track-design.md` — this plan covers **only** its "**2. Voice routing and voice safety**" entry in the `## Scope — this is five sequenced plans, not one` section, i.e. the `## Voice safety` section, the keyboard and arp rows of the per-surface table, and Open risks 1 and 4. The state model (Plan 1), Rec (Plan 3), MIDI (Plan 4) and preview length (Plan 0) are out of scope here.

**Depends on:** `docs/superpowers/plans/2026-09-10-focus-track-plan-1-state-model.md`. Plan 1 blocks this plan (spec, *Ordering constraints*). It supplies `focusTrack` / `setFocusTrack` on the store and `src/store/focusTrack.ts`; this plan consumes those names **verbatim** and adds nothing to that file.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`bun run verify` is the completion gate** — run it before claiming any task is done. It runs `bun test`, `bun run lint`, `bun run eslint`, `check:keys`, `check:drums`, `check:contrast`, `check:levels` and `build`.
- **`bun run eslint` must report nothing at all — zero errors AND zero warnings.** That is the state to keep it in. Any new `eslint-disable` line names its reason on the same line.
- **`src/components/` must not import `audio/engine`.** The allowlist is in `eslint.config.js`; this plan adds nothing to it. Every engine call a component needs goes through a `src/audio/playback/*` wrapper — that is why `releaseTriggeredTargets` (Task 3) takes its release call as a parameter instead of calling the engine itself.
- **`src/audio/` never imports `store/` or `components/`.** `heldNotes.ts` and `arpPlayback.ts` may import `@/utils/*` and `@/data/*` only.
- **`src/store/` must not import `components/`.** Not relaxed for type imports; only test files are exempt.
- **`src/data/` imports nothing at runtime** and declares no function. Nothing in this plan touches `src/data/`.
- **No DOM and no testing-library**, and none may be added. Prefer an exported pure helper over a render. `useInputDeck`'s existing exports (`notesToReleaseOnKeyboardModeChange`, `releaseAllHeldNotes`, `subscribeArpState`, `selectArpActive`, `selectSynthRelease`) exist for exactly this reason; every routing decision this plan adds is exported and tested the same way.
- **`useEffect` does not run under `renderToString`.** `useArpPlayback` and every effect in `useInputDeck` are therefore unreachable from a rendered test — which is why their bodies are extracted into pure functions rather than exercised through a `Probe` component.
- **`fakeParam.valueAt(t)` refuses timelines containing `setTargetAtTime`.** The equal-power path uses `setTargetAtTime`, so assert on the recorded `events` / `targets` / `cancels` arrays, never on a computed value.
- **The zustand + `renderToString` trap:** zustand serves `getServerSnapshot` from `api.getInitialState()`, captured at store creation, so `useAppStore.setState(...)` before a `renderToString` silently has no effect. Nothing in this plan asserts on rendered markup that must reflect a test-set `focusTrack`; `subscribeArpState` is called **directly** in its test (no component), which is what makes the focus subscription testable.
- **The note-input bus rules (`.claude/rules/note-input.md`) are unchanged and constrain this plan:** a source that swallows the sound still announces the press (the arp branch's `emitNoteInput`); previews never announce; **both** note edges are announced, because live capture reads the on/off gap. A note-on that plays nothing (focus `drum`) announces nothing either — see Task 4.
- **No migration chains, no `PERSIST_VERSION` bump, no `PROJECT_FORMAT_VERSION` change.** This plan adds no persisted state at all.
- **Feature work never lands as a commit on `main`.** Branch first: `feat/focus-track-voice-routing`.
- **Commit messages are conventional commits** and end with the trailer:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **A docblock or comment this change falsifies is rewritten in the same commit that falsifies it.** No doc-sync commit at the end — that is how a false sentence survives a review that had the code in front of it.

## The audible change to existing behaviour, on the record

**Task 2 makes the accompaniment sit slightly louder relative to a held keyboard chord than it does today, and no test fails because of it.**

`applySynthVelocityScale(scale)` calls `this.reshapeableVoices()` **with no source argument** although the parameter exists, and `reshapeableVoices(undefined)` walks every entry of `sourceVoices`. So a keyboard press today re-shapes the sounding **chord, bass and pad** voices as well as the synth's — it quietly ducks the accompaniment. Scoping it is correct (the accompaniment's level is the user's fader decision, not something a keyboard press may renegotiate), but it is a change a listener can hear.

It is recorded here, in Task 2's task body, **and in Task 2's commit message**, so that "the backing got louder after focus tracking shipped" has an answer and is not bisected as a regression. Spec: *Voice safety* point 3 and *Open risks* 4.

## What this plan does NOT do

**A focus change alone does not cut sounding voices.** `useArpPlayback`'s cleanup runs on unmount or on `active` flipping — a focus change runs neither — so voices from the previous target keep sounding until they release naturally. That is the spec's *Open risks 1* decision (**let them ring**): cutting them is a hard stop the user did not ask for, and they are finite. Do not add a release-on-focus-change here. If it reads as a bug in use, the fix is a release scoped to the target being left, not a global stop, and it is a separate change.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/audio/playback/heldNotes.ts` | The held-note → target map type and its three readers (`noteTargetFor`, `heldCountFor`, `heldNotesFor`). Pure; imports one type and nothing at runtime. |
| `src/audio/playback/heldNotes.test.ts` | Direct tests of all three readers, including the capture-not-recompute rule and the per-bus count. |

**Modified**

| Path | Change |
|---|---|
| `src/audio/engine.ts` | `applySynthVelocityScale(scale, source)` — `source` required, threaded into `reshapeableVoices(source)`; docblock rewritten. |
| `src/audio/engine.test.ts` | New test: a rescale on one source leaves another source's voices untouched. |
| `src/audio/playback/synthPlayback.ts` | `applySynthPlaybackVelocityScale(scale, target)`. |
| `src/audio/playback/arpPlayback.ts` | `ArpStateRef` reshaped (`heldTargets`, `target`, `triggeredTargets`); tick reads the live target and records it at trigger time; cleanup releases every recorded target through the new exported `releaseTriggeredTargets`; the "known limitation / unreachable today" docblock deleted and replaced. |
| `src/audio/playback/arpPlayback.test.ts` | New `releaseTriggeredTargets` block, including the negative case. |
| `src/components/useInputDeck.ts` | `KEYBOARD_AUDITION_TARGET` deleted; `synthTargetForFocus` added and exported; the ref carries the held map, the live target and the triggered set; `subscribeArpState` gains a `focusTrack` subscription; note-on captures, note-off releases on the capture; per-bus equal power; drum focus is a no-op note-on; four comments rewritten. |
| `src/components/useInputDeck.test.tsx` | `subscribeArpState` fixture reshaped; focus-follows assertions; `synthTargetForFocus` table test. |
| `src/components/loop/SoundView.test.tsx` | The `describe('keyboard audition channel is always the main synth', …)` block and its comment reframed — the subject (`resolveSynthControlChannel`) is unchanged, the framing is not. |

---

### Task 1: The held-note map — one fact, three readers

**Files:**
- Create: `src/audio/playback/heldNotes.ts`
- Create: `src/audio/playback/heldNotes.test.ts`

**Interfaces:**
- Consumes: `SynthControlTarget` from `@/utils/synthControl` (`import type`).
- Produces:
  ```ts
  export type HeldNoteTargets = Map<string, SynthControlTarget>;
  export function noteTargetFor(
    held: ReadonlyMap<string, SynthControlTarget>,
    note: string,
  ): SynthControlTarget | undefined;
  export function heldCountFor(
    held: ReadonlyMap<string, SynthControlTarget>,
    target: SynthControlTarget,
  ): number;
  export function heldNotesFor(
    held: ReadonlyMap<string, SynthControlTarget>,
    target: SynthControlTarget,
  ): string[];
  ```
  Nothing consumes them until Task 3. They land first because **both** `src/components/useInputDeck.ts` and `src/audio/playback/arpPlayback.ts` read them, and `src/audio/` may not import `src/components/` — so the shared fact has to live on the audio side of the layering rule.

- [ ] **Step 1: Branch**

Plan 1 blocks this plan. If `feat/focus-track-state-model` has already merged, branch off `main`; if it is still in review, branch off it and rebase onto `main` before opening the PR.

```bash
cd /Users/Pathompong/Sites/Personal/solna
git checkout main
git pull
git checkout -b feat/focus-track-voice-routing
```

Confirm Plan 1's contract is present before writing a line — this plan reads it verbatim:

```bash
grep -n "MIX_LAYER_IDS\|isMelodicFocus\|controlTargetForFocus" src/store/focusTrack.ts
grep -n "focusTrack" src/store/types.ts
```

Expected: `focusTrack.ts` exports all three; `types.ts` carries `focusTrack: MixLayerId` and `setFocusTrack`. If either is missing, stop — Plan 1 is not done.

- [ ] **Step 2: Write the failing test**

Create `src/audio/playback/heldNotes.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { heldCountFor, heldNotesFor, noteTargetFor } from './heldNotes';
import type { HeldNoteTargets } from './heldNotes';
import type { SynthControlTarget } from '@/utils/synthControl';

function held(...entries: [string, SynthControlTarget][]): HeldNoteTargets {
  return new Map<string, SynthControlTarget>(entries);
}

describe('noteTargetFor', () => {
  test('returns the bus the note was played on', () => {
    expect(noteTargetFor(held(['C4', 'synth'], ['G4', 'fx']), 'C4')).toBe('synth');
    expect(noteTargetFor(held(['C4', 'synth'], ['G4', 'fx']), 'G4')).toBe('fx');
  });

  test('returns undefined for a note that is not held', () => {
    expect(noteTargetFor(held(['C4', 'synth']), 'D4')).toBeUndefined();
  });

  test('a note captured on one bus keeps naming that bus after focus moves', () => {
    // The map IS the capture: nothing about a later focus change touches it,
    // which is the whole point — a release recomputed from the current focus
    // would land on a bus the voice was never on and the voice would drone.
    const map = held(['C4', 'synth']);
    // ...focus moves to FX; the next note-on would capture 'fx'...
    map.set('E4', 'fx');
    expect(noteTargetFor(map, 'C4')).toBe('synth');
    expect(noteTargetFor(map, 'E4')).toBe('fx');
  });
});

describe('heldCountFor', () => {
  test('counts one bus only, never the total', () => {
    // Two notes on Lead and two on FX are two buses running two voices each,
    // not one bus running four. A global count would apply a four-voice
    // attenuation to both and every note would quieten the moment a second
    // track was played.
    const map = held(['C4', 'synth'], ['E4', 'synth'], ['G4', 'fx'], ['B4', 'fx']);
    expect(heldCountFor(map, 'synth')).toBe(2);
    expect(heldCountFor(map, 'fx')).toBe(2);
  });

  test('a bus with nothing held counts zero', () => {
    expect(heldCountFor(held(['C4', 'synth']), 'bass')).toBe(0);
    expect(heldCountFor(held(), 'synth')).toBe(0);
  });
});

describe('heldNotesFor', () => {
  test('returns only that bus notes, in insertion order', () => {
    const map = held(['E4', 'synth'], ['G4', 'fx'], ['C4', 'synth']);
    expect(heldNotesFor(map, 'synth')).toEqual(['E4', 'C4']);
    expect(heldNotesFor(map, 'fx')).toEqual(['G4']);
  });

  test('returns an empty list for a bus with nothing held', () => {
    expect(heldNotesFor(held(['C4', 'synth']), 'pad')).toEqual([]);
    expect(heldNotesFor(held(), 'synth')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test src/audio/playback/heldNotes.test.ts`
Expected: FAIL — `error: Cannot find module './heldNotes'` (the module does not exist yet).

- [ ] **Step 4: Write the implementation**

Create `src/audio/playback/heldNotes.ts`:

```ts
import type { SynthControlTarget } from '@/utils/synthControl';

/**
 * Which synth bus each currently-held note is sounding on.
 *
 * ONE map, not two structures: it answers "where do I release this note"
 * (the per-note captured target) and "how many notes are held on this bus"
 * (the per-bus polyphony count) from the same fact, so the two can never
 * disagree with each other.
 *
 * The rule it exists to enforce: a target is CAPTURED at note-on and is never
 * recomputed at release time. Focus can change mid-hold, and a note-off that
 * recomputed the target would release a bus the voice was never on — the held
 * voice then drones until the same key is pressed again on the same track.
 * That is the same rule `chordKeyNotesRef` in components/useInputDeck.ts
 * already states for chord mode ("key-up releases those notes even if
 * key/scale/octave changed while the key was held"), on a different axis.
 *
 * It lives in `src/audio/` because both `components/useInputDeck.ts` and
 * `audio/playback/arpPlayback.ts` read it and `src/audio/` may not import
 * `src/components/` (layering rule 2).
 */
export type HeldNoteTargets = Map<string, SynthControlTarget>;

/**
 * The bus a note was PLAYED on, or `undefined` when it is not held. Never
 * derive this from the current focus — see HeldNoteTargets.
 */
export function noteTargetFor(
  held: ReadonlyMap<string, SynthControlTarget>,
  note: string,
): SynthControlTarget | undefined {
  return held.get(note);
}

/**
 * How many notes are held on ONE bus. Equal-power polyphony exists to keep a
 * chord's total level flat as keys are added to ONE instrument; counting
 * across buses turns it into a duck — two notes on Lead and two on FX are two
 * buses running two voices each, not one bus running four, and a global count
 * would quieten every note the moment a second track was played.
 */
export function heldCountFor(
  held: ReadonlyMap<string, SynthControlTarget>,
  target: SynthControlTarget,
): number {
  let count = 0;
  for (const heldTarget of held.values()) {
    if (heldTarget === target) count++;
  }
  return count;
}

/**
 * The notes held on ONE bus, in insertion order — the arp's sequence input.
 *
 * Allocates, so the arp calls it only AFTER its fires-on-this-step gate; the
 * cheap "is anything held here at all" question is `heldCountFor`, which
 * allocates nothing. `buildArpSequence` keys its cache on the contents, so a
 * fresh array per tick still hits the cache.
 */
export function heldNotesFor(
  held: ReadonlyMap<string, SynthControlTarget>,
  target: SynthControlTarget,
): string[] {
  const notes: string[] = [];
  for (const [note, heldTarget] of held) {
    if (heldTarget === target) notes.push(note);
  }
  return notes;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/audio/playback/heldNotes.test.ts`
Expected: PASS — 7 pass, 0 fail.

- [ ] **Step 6: Run the gate**

Run: `bun run verify`
Expected: all steps pass; `bun run eslint` prints nothing at all.

- [ ] **Step 7: Commit**

```bash
git add src/audio/playback/heldNotes.ts src/audio/playback/heldNotes.test.ts
git commit -m "$(cat <<'EOF'
feat(audio): record which bus each held note is sounding on

One Map<note, SynthControlTarget> and three readers. It is the fact both the
keyboard and the arp need once the synth target can change mid-hold: the
release target is captured at note-on (never recomputed), and equal-power
polyphony counts the notes held on ONE bus rather than the global total.

Lives in src/audio/ because src/audio/ may not import src/components/, and
both sides read it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `applySynthVelocityScale` is scoped to its source

**Files:**
- Modify: `src/audio/engine.ts:1564-1589` (the `applySynthVelocityScale` docblock and body)
- Modify: `src/audio/playback/synthPlayback.ts:18-20` (`applySynthPlaybackVelocityScale`)
- Modify: `src/components/useInputDeck.ts:190` and `src/components/useInputDeck.ts:229` (the two call sites; both still pass `KEYBOARD_AUDITION_TARGET` at the end of this task)
- Modify: `src/audio/engine.test.ts:1019-1070` (append one test inside `describe('live polyphony equal-power scaling', …)`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```ts
  // src/audio/engine.ts — `source` is REQUIRED, not optional
  applySynthVelocityScale(scale: number, source: string): void;
  // src/audio/playback/synthPlayback.ts
  export function applySynthPlaybackVelocityScale(scale: number, target: string): void;
  ```
  `source` is required rather than defaulted so a future call site cannot re-acquire the global reach by omission — which is exactly how the current bug exists (`reshapeableVoices()` with the argument left off).

**This task changes existing behaviour audibly.** Today a keyboard press re-shapes the sounding chord, bass and pad voices too, quietly ducking the accompaniment under a held keyboard chord. After this task it does not, so **the accompaniment sits slightly louder relative to a held keyboard chord**. That is correct — the accompaniment's level is the user's fader decision — but nobody asked for the difference and no existing assertion covers it. Say so in the commit message (Step 6), per the spec's *Open risks* 4.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('live polyphony equal-power scaling', …)` block in `src/audio/engine.test.ts` (after the last `test(…)`, before the closing `});`):

```ts
  test('rescales only the named source — a keyboard press leaves chord voices alone', () => {
    const { engine } = freshEngine();

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth');
    engine.triggerSynthNoteOn('A3', SYNTH, 0.8, undefined, 'chord');

    (engine as any).applySynthVelocityScale(0.5, 'synth');

    const voices = (engine as any).activeVoices;
    const lead = voices.get('synth:C4');
    const chord = voices.get('chord:A3');

    expect(lead.envelopeScale).toBe(0.5);
    expect(lead.gains[0].gain.targets).toHaveLength(1);

    // The chord voice is on a bus nobody pressed a key on: no re-scale at all.
    // Asserted on the RECORDED events, not on a computed value — fakeParam's
    // valueAt() refuses a timeline containing setTargetAtTime and this path
    // uses it.
    expect(chord.envelopeScale).toBe(1);
    expect(chord.gains[0].gain.targets).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/engine.test.ts -t "rescales only the named source"`
Expected: FAIL. `bun test` does not type-check, so the extra argument is simply ignored at runtime and the old body rescales every source: `expect(received).toBe(expected)` — `Expected: 1`, `Received: 0.5` at `expect(chord.envelopeScale).toBe(1)`.

- [ ] **Step 3: Scope the engine method**

In `src/audio/engine.ts`, replace the `applySynthVelocityScale` docblock and signature (the `for` body below it is unchanged):

```ts
  /**
   * Re-balances every still-sounding voice OF ONE SOURCE for equal-power
   * polyphony (held notes get quieter as more join). Voices with a planned
   * release — pattern hits — keep their envelopes; envelopeScale makes
   * repeated calls relative.
   *
   * `source` is REQUIRED. This used to call `reshapeableVoices()` with no
   * argument although the parameter existed, and `reshapeableVoices(undefined)`
   * walks EVERY entry of sourceVoices — so a keyboard press re-shaped the
   * sounding chord, bass and pad voices as well as the synth's, quietly
   * ducking the accompaniment under a held keyboard chord. A required
   * parameter is what stops a later call site re-acquiring that reach by
   * simply leaving the argument off, which is how the original slipped in.
   */
  applySynthVelocityScale(scale: number, source: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.reshapeableVoices(source)) {
```

- [ ] **Step 4: Thread it through the playback wrapper and both call sites**

In `src/audio/playback/synthPlayback.ts`:

```ts
export function applySynthPlaybackVelocityScale(scale: number, target: string): void {
  audioEngine.applySynthVelocityScale(scale, target);
}
```

In `src/components/useInputDeck.ts`, both call sites gain the target the surrounding code already uses. In `handleNoteOn`:

```ts
        if (isNewNote) {
          applySynthPlaybackVelocityScale(scale, KEYBOARD_AUDITION_TARGET);
        }
```

In `handleNoteOff`:

```ts
        applySynthPlaybackVelocityScale(
          equalPowerVelocityScale(held.size),
          KEYBOARD_AUDITION_TARGET,
        );
```

`KEYBOARD_AUDITION_TARGET` is still the pinned constant at the end of this task; Task 4 deletes it. Scoping the engine call and choosing the target are two separate decisions, and keeping them in two commits is what lets a bisect tell the audible level change apart from the routing change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/audio/engine.test.ts -t "live polyphony equal-power scaling"`
Expected: PASS — 4 pass, 0 fail (the three existing tests plus the new one).

Run: `bun run verify`
Expected: all steps pass; `bun run eslint` prints nothing at all.

- [ ] **Step 6: Commit**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts src/audio/playback/synthPlayback.ts src/components/useInputDeck.ts
git commit -m "$(cat <<'EOF'
fix(audio): scope applySynthVelocityScale to one source

applySynthVelocityScale(scale) called reshapeableVoices() with no argument
although the parameter existed, so reshapeableVoices(undefined) walked every
entry of sourceVoices: a keyboard press re-shaped the sounding chord, bass and
pad voices too. `source` is now required, threaded from
applySynthPlaybackVelocityScale and both useInputDeck call sites.

AUDIBLE CHANGE TO EXISTING BEHAVIOUR, recorded here so it is not bisected
later as a regression: holding keys on the keyboard used to quietly duck the
accompaniment through equal-power rebalancing. It no longer does, so the
accompaniment sits slightly louder relative to a held keyboard chord than it
did. That is the correct behaviour — the accompaniment's level is the user's
fader decision, not something a keyboard press may renegotiate — but no test
fails because of it. See the spec's Voice safety point 3 and Open risks 4.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The arp records every bus it triggers on

Behaviour is deliberately unchanged by this task: the keyboard is still pinned to `KEYBOARD_AUDITION_TARGET`, so every held note lands on `'synth'` and the triggered set never holds more than one member. What changes is that the machinery can now express more than one, and the map replaces the flat held set everywhere. Task 4 flips the target to focus.

**Files:**
- Modify: `src/audio/playback/arpPlayback.ts:15-17` (`ArpStateRef`), `:19-89` (the hook docblock, the clock callback and the whole cleanup)
- Modify: `src/audio/playback/arpPlayback.test.ts` (append one `describe`)
- Modify: `src/components/useInputDeck.ts:100-120` (`subscribeArpState`), `:153-166` (the ref and the mirror effect), `:171-241` (`handleNoteOn` / `handleNoteOff`), `:255-273` (the mode-change cleanup), `:275-280` (the arp release effect), `:385` (the blur backstop)
- Modify: `src/components/useInputDeck.test.tsx:105-118` (the `subscribeArpState` ref fixture)

**Interfaces:**
- Consumes: `HeldNoteTargets`, `noteTargetFor`, `heldCountFor`, `heldNotesFor` from `./heldNotes` (Task 1); `applySynthPlaybackVelocityScale(scale, target)` from Task 2.
- Produces:
  ```ts
  // src/audio/playback/arpPlayback.ts
  export interface ArpStateRef {
    current: {
      heldTargets: HeldNoteTargets;
      params: SynthParams;
      target: SynthControlTarget | null;
      triggeredTargets: Set<SynthControlTarget>;
      bpm: number;
    };
  }
  export function releaseTriggeredTargets(
    triggered: Set<SynthControlTarget>,
    releaseTime: number,
    release: (target: SynthControlTarget, releaseTime: number) => void,
  ): void;
  ```
  `releaseTriggeredTargets` takes its release call as a parameter because both callers need it and they sit on opposite sides of a layering rule: the arp cleanup passes `audioEngine.releaseSoundingVoices`, and `useInputDeck` — which may not import `audio/engine` — passes `releaseSynthPlaybackVoices`.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/playback/arpPlayback.test.ts`:

```ts
describe('releaseTriggeredTargets', () => {
  test('releases every bus the arp has triggered on, then forgets them', () => {
    // A hold that spans a focus change leaves sounding voices on MORE THAN
    // ONE bus — Lead's from the ticks before the change, FX's from the ticks
    // after — and a single captured target releases exactly one of them while
    // the other drones.
    const released: [string, number][] = [];
    const triggered = new Set<SynthControlTarget>(['synth', 'fx']);

    releaseTriggeredTargets(triggered, 0.25, (target, releaseTime) => {
      released.push([target, releaseTime]);
    });

    expect(released).toEqual([
      ['synth', 0.25],
      ['fx', 0.25],
    ]);
    expect(triggered.size).toBe(0);
  });

  test('a bus that was focused but never triggered on gets no release', () => {
    // The negative half. A cleanup that released every KNOWN target would pass
    // the test above while releasing buses it never touched — harmless to the
    // ear, but it makes the record a lie and hides a real stranded voice.
    const released: SynthControlTarget[] = [];
    const triggered = new Set<SynthControlTarget>(['synth']);

    releaseTriggeredTargets(triggered, 0.3, (target) => {
      released.push(target);
    });

    expect(released).toEqual(['synth']);
    expect(released).not.toContain('fx');
  });

  test('an empty record releases nothing', () => {
    const released: SynthControlTarget[] = [];
    releaseTriggeredTargets(new Set<SynthControlTarget>(), 0.3, (target) => {
      released.push(target);
    });
    expect(released).toEqual([]);
  });
});
```

Add to that file's imports:

```ts
import { computeArpTriggers, releaseTriggeredTargets } from './arpPlayback';
import type { ArpRate } from './arpPlayback';
import type { SynthControlTarget } from '@/utils/synthControl';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/arpPlayback.test.ts -t "releaseTriggeredTargets"`
Expected: FAIL — `TypeError: releaseTriggeredTargets is not a function` (the import resolves to `undefined`).

- [ ] **Step 3: Reshape `ArpStateRef` and add `releaseTriggeredTargets`**

In `src/audio/playback/arpPlayback.ts`, add to the imports:

```ts
import { heldCountFor, heldNotesFor, type HeldNoteTargets } from './heldNotes';
```

Replace the `ArpStateRef` interface:

```ts
export interface ArpStateRef {
  current: {
    /** Every held note and the bus it is sounding on — see ./heldNotes.ts. */
    heldTargets: HeldNoteTargets;
    params: SynthParams;
    /**
     * The bus the NEXT tick plays on: the focused melodic track, or `null`
     * when focus is on the drum track and there is nothing melodic to play.
     * Read fresh on every tick, never captured at effect setup.
     */
    target: SynthControlTarget | null;
    /**
     * Every bus this hook has actually TRIGGERED a voice on, written in the
     * clock callback at trigger time and emptied when they are released.
     */
    triggeredTargets: Set<SynthControlTarget>;
    bpm: number;
  };
}

/**
 * Releases every bus the arp has triggered on and then forgets them, so a
 * later hold starts from an empty record rather than releasing buses it never
 * touched.
 *
 * Takes the release call as a parameter because its two callers sit on
 * opposite sides of a layering rule: the cleanup below passes
 * `audioEngine.releaseSoundingVoices`, and `components/useInputDeck.ts` — which
 * may not import `audio/engine` — passes `releaseSynthPlaybackVoices`.
 */
export function releaseTriggeredTargets(
  triggered: Set<SynthControlTarget>,
  releaseTime: number,
  release: (target: SynthControlTarget, releaseTime: number) => void,
): void {
  for (const target of triggered) {
    release(target, releaseTime);
  }
  triggered.clear();
}
```

- [ ] **Step 4: Rewrite the hook — docblock, tick, and cleanup**

Still in `src/audio/playback/arpPlayback.ts`, replace the hook's docblock and body. **The "Known limitation … Unreachable today because the only caller (SoundView) pins controlTarget to a constant (KEYBOARD_AUDITION_TARGET)" paragraph is deleted outright, not softened** — Task 4 is the caller it names, and this is the commit that falsifies it.

```ts
/**
 * Arpeggiator clock subscriber, moved from SoundView 281-405 with the 4 rate
 * branches collapsed into computeArpTriggers. `stateRef` mirrors the deck's
 * live arp state: which notes are held and on which bus, the params, the bus
 * the next tick plays on, the buses already triggered on, and the bpm.
 *
 * `release` and the targets are read from `stateRef.current`, NOT taken as
 * parameters: having them in the effect's dependency array made every
 * Release-knob pointer move tear the subscription down and run the cleanup,
 * cutting every held arp note mid-drag.
 *
 * THE TARGET VARIES. It follows `focusTrack`, so one hold can put voices on
 * more than one bus — Lead's from the ticks before a focus change, FX's from
 * the ticks after. The ref therefore records every bus it has TRIGGERED on
 * (`triggeredTargets`, written in the callback below at trigger time) and the
 * cleanup releases all of them. A single captured target would release exactly
 * one and the rest would drone. Trigger time is the only moment that means "a
 * voice now exists on this bus": a bus that was merely focused, or focused one
 * tick after the last trigger, must not be released, and a bus that was
 * triggered on must be released even if focus left it a tick later.
 */
export function useArpPlayback(stateRef: ArpStateRef, active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const unsubscribe = audioEngine.subscribeClock((step, _beat, time) => {
      const { heldTargets, params, target, bpm } = stateRef.current;

      if (!params.arpActive) return;
      // Focus is on the drum track: the melodic keyboard has nothing to play,
      // so the arp has nothing to arpeggiate.
      if (target === null) return;
      // The cheap question first — heldCountFor allocates nothing, while
      // heldNotesFor builds an array, and this runs inside the lookahead
      // callback where steady-state garbage becomes a scheduling stall.
      if (heldCountFor(heldTargets, target) === 0) return;

      // Gate BEFORE the build: at rate 4n this skips four of every five
      // buildArpSequence calls, each of which is a tonal sort plus one
      // transpose per note per octave, inside the lookahead callback.
      const stepDur16 = stepDurationSec(bpm);
      const arpStep = arpStepFor(step, audioEngine.getMeter().stepsPerBar);
      if (!arpFiresOnStep(arpStep, params.arpRate)) return;

      const sequence = buildArpSequence(
        heldNotesFor(heldTargets, target),
        params.arpMode,
        params.arpOctaves,
      );
      if (sequence.length === 0) return;

      for (const t of computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDur16)) {
        const note = sequence[t.noteIndex];
        // Recorded at TRIGGER time — not at render time, not when focus
        // changes. This is the only moment that means "a voice now exists on
        // this bus", and the cleanup below releases exactly this set.
        stateRef.current.triggeredTargets.add(target);
        audioEngine.triggerSynthNoteOn(note, params, 0.9, time + t.timeOffsetSec, target);
        audioEngine.triggerSynthNoteOff(note, params.release, time + t.timeOffsetSec + t.holdSec, target);
      }
    });

    return () => {
      unsubscribe();
      // Read release/targets off the ref, NOT from props: having them in the
      // dependency array made every Release-knob pointer move tear the
      // subscription down and run this cleanup, cutting every held arp note
      // mid-drag.
      //
      // Release EVERY bus this hook has triggered on, not whichever one is
      // current at cleanup time. A focus change mid-hold leaves sounding
      // voices on more than one bus, and one captured target releases only
      // one of them — the same stranded-voice failure reached by a different
      // route. `triggeredTargets` is written at trigger time, so a bus that
      // was never actually played is never released.
      if (audioEngine.getAudioContext()) {
        // Reading the LATEST ref at cleanup time is the whole point;
        // copying it into the effect body would restore the stale-target bug.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
        const { triggeredTargets, params } = stateRef.current;
        releaseTriggeredTargets(triggeredTargets, params.release, (target, releaseTime) => {
          audioEngine.releaseSoundingVoices(target, releaseTime);
        });
      }
    };
  }, [active, stateRef]);
}
```

- [ ] **Step 5: Run the arp tests to verify they pass**

Run: `bun test src/audio/playback/arpPlayback.test.ts`
Expected: PASS — the existing `computeArpTriggers` block plus 3 new tests, 0 fail.

- [ ] **Step 6: Move `useInputDeck` onto the map (behaviour unchanged)**

In `src/components/useInputDeck.ts`, add to the imports:

```ts
import { useArpPlayback, releaseTriggeredTargets, type ArpStateRef } from '../audio/playback/arpPlayback';
import { heldCountFor, noteTargetFor } from '../audio/playback/heldNotes';
```

Replace the ref and delete the commit-time mirror effect (`useEffect(() => { arpStateRef.current.activeNotes = activeNotes; }, [activeNotes])` goes away entirely — the map is now written synchronously in `handleNoteOn`/`handleNoteOff`, in **both** branches, which is strictly earlier than a post-commit mirror ever was):

```ts
  // Keep the live arp state in a ref so the clock listener reads it without
  // re-subscribing or stopping voices on every keystroke or parameter tweak.
  // `heldTargets` is written synchronously by handleNoteOn/handleNoteOff — in
  // the arp branch too, which is why the old commit-time mirror of
  // `activeNotes` is gone: the arp builds its sequence from this map, so it
  // must never lag a keypress by a render.
  const arpStateRef = useRef<ArpStateRef['current']>({
    heldTargets: new Map(),
    params: useAppStore.getState().synthParams,
    target: KEYBOARD_AUDITION_TARGET,
    triggeredTargets: new Set(),
    bpm: useAppStore.getState().bpm,
  });
```

Replace `handleNoteOn`'s body:

```ts
  const handleNoteOn = useCallback(
    (note: string) => {
      // Params come from arpStateRef, kept fresh by an imperative store
      // subscription (subscribeArpState) rather than a render dependency, so
      // this reads the latest value without the callback identity changing
      // on every knob move — which used to tear down and re-register the
      // window keydown/keyup listeners ~60 times a second during a drag.
      const liveParams = arpStateRef.current.params;
      const target = KEYBOARD_AUDITION_TARGET;
      const held = arpStateRef.current.heldTargets;
      initSynthPlayback();
      if (!liveParams.arpActive) {
        // Equal-power polyphony: a new note lowers every voice held ON THIS
        // BUS so that instrument's total level stays flat as keys are added.
        // The map mirrors the held set synchronously so rapid presses see
        // each other.
        const isNewNote = !held.has(note);
        held.set(note, target);
        const scale = equalPowerVelocityScale(heldCountFor(held, target));
        if (isNewNote) {
          applySynthPlaybackVelocityScale(scale, target);
        }
        synthPlaybackNoteOn(note, liveParams, 1.0, undefined, target, scale);
      } else {
        // The arp swallows the key: it schedules the note itself, so nothing
        // reaches synthPlaybackNoteOn and the bus would never hear about a key
        // the user genuinely pressed. Announce it here instead, or arming the
        // recorder with the arp on would silently capture nothing.
        // The map is still written — the arp builds its sequence from the
        // notes held on the bus it is playing.
        held.set(note, target);
        emitNoteInput({ kind: 'on', note, velocity: 1.0 });
      }
      setActiveNotes((prev) => new Set(prev).add(note));
    },
    [],
  );
```

Replace `handleNoteOff`'s body:

```ts
  const handleNoteOff = useCallback(
    (note: string) => {
      // Same ref read as handleNoteOn — see the note there.
      const liveParams = arpStateRef.current.params;
      const held = arpStateRef.current.heldTargets;
      // The bus this note was PLAYED on, never the bus focus names right now:
      // recomputing would send the release to an engine the voice was never
      // on and the held voice would drone until the same key was pressed
      // again on the same track. See audio/playback/heldNotes.ts.
      const target = noteTargetFor(held, note);
      held.delete(note);
      if (target !== undefined && !liveParams.arpActive) {
        // Release first (marks the voice so re-scaling skips it), then let
        // the voices still held ON THAT BUS rise back toward full level.
        synthPlaybackNoteOff(note, liveParams.release, undefined, target);
        applySynthPlaybackVelocityScale(
          equalPowerVelocityScale(heldCountFor(held, target)),
          target,
        );
      } else if (target !== undefined) {
        // Arp branch — see handleNoteOn.
        emitNoteInput({ kind: 'off', note, velocity: 0 });
      }
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    },
    [],
  );
```

In the keyboard-mode-change cleanup, read the map's keys and clear it beside `chordKeyNotesRef`:

```ts
      const held = notesToReleaseOnKeyboardModeChange(
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
        arpStateRef.current.heldTargets.keys(),
      );
      held.forEach((note) => handleNoteOffRef.current(note));
      // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
      chordKeyNotesRef.current.clear();
      // Cleared with it: handleNoteOff deletes each note it releases, but a
      // note released by any other path would otherwise leave a stale entry
      // naming a bus that has nothing sounding on it.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
      arpStateRef.current.heldTargets.clear();
```

(`notesToReleaseOnKeyboardModeChange` copies into an array before anything is released, so deleting from the map while iterating is safe.)

Replace the arp release effect:

```ts
  // Silence lingering arp voices when all keys are released in arp mode.
  // Releases every bus the arp actually triggered on — a hold that spanned a
  // focus change left voices on more than one.
  useEffect(() => {
    if (arpActive && activeNotes.size === 0 && hasSynthPlaybackContext()) {
      releaseTriggeredTargets(
        arpStateRef.current.triggeredTargets,
        release,
        releaseSynthPlaybackVoices,
      );
    }
  }, [arpActive, activeNotes.size, release]);
```

And the blur/visibilitychange backstop:

```ts
      releaseAllHeldNotes(arpStateRef.current.heldTargets.keys(), handleNoteOffRef.current);
```

- [ ] **Step 7: Update the `subscribeArpState` fixture**

In `src/components/useInputDeck.test.tsx`, the `subscribeArpState` test builds a ref by hand. Replace its literal with the new shape and add the type import `import type { SynthControlTarget } from '@/utils/synthControl';`:

```ts
    const ref = {
      current: {
        heldTargets: new Map<string, SynthControlTarget>(),
        params: useAppStore.getState().synthParams,
        target: 'synth' as SynthControlTarget | null,
        triggeredTargets: new Set<SynthControlTarget>(),
        bpm: useAppStore.getState().bpm,
      },
    };
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test src/components/useInputDeck.test.tsx src/audio/playback/arpPlayback.test.ts src/audio/playback/heldNotes.test.ts`
Expected: PASS, 0 fail.

Run: `bun run verify`
Expected: all steps pass; `bun run eslint` prints nothing at all. `bun run lint` (`tsc --noEmit`) is what proves the ref literal, the hook and the test fixture all agree on the new `ArpStateRef` shape.

- [ ] **Step 9: Commit**

```bash
git add src/audio/playback/arpPlayback.ts src/audio/playback/arpPlayback.test.ts src/components/useInputDeck.ts src/components/useInputDeck.test.tsx
git commit -m "$(cat <<'EOF'
refactor(audio): the arp records every bus it triggers on

ArpStateRef stops carrying a single controlTarget scalar. It now carries the
held-note map, the bus the next tick plays on, and triggeredTargets — the set
of buses it has actually triggered a voice on, written in the clock callback
at trigger time. The cleanup releases every member and empties the set, and
useInputDeck's "all keys released in arp mode" effect does the same through
releaseTriggeredTargets.

Deletes the "Known limitation ... Unreachable today because the only caller
(SoundView) pins controlTarget to a constant (KEYBOARD_AUDITION_TARGET)"
paragraph rather than softening it: the next commit is that caller.

useInputDeck moves off the flat held set onto the map in the same commit
(the ref shape is shared), including the arp branch, which lets the
commit-time activeNotes mirror go. Behaviour is unchanged here — the keyboard
is still pinned to 'synth', so the triggered set never holds more than one
member yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The keyboard, the on-screen keyboard and the arp follow `focusTrack`

This is the commit that closes spec symptom (a) — *"selecting FX on Sound and playing the keyboard sounds Lead"* — which Plan 1 deliberately left in place.

**Files:**
- Modify: `src/components/useInputDeck.ts:28-35` (the `KEYBOARD_AUDITION_TARGET` comment and constant — both deleted, replaced by the routing docblock and `synthTargetForFocus`), `:100-120` (`subscribeArpState`), `:132-140` and `:155-160` and `:169-170` and `:275-277` (the four comments citing the constant), `:171-241` (`handleNoteOn`)
- Modify: `src/components/useInputDeck.test.tsx` (append `synthTargetForFocus` block; extend the `subscribeArpState` test)
- Modify: `src/components/loop/SoundView.test.tsx:224-280` (the `describe('keyboard audition channel is always the main synth', …)` block and the comment above it — **locate it by that `describe` title, not by line number: Plan 1 edits this file and shifts these lines**)

**Interfaces:**
- Consumes: `focusTrack: MixLayerId` on the store and `MixLayerId`, `isMelodicFocus`, `controlTargetForFocus` from `@/store/focusTrack` (Plan 1, verbatim); `noteTargetFor`, `heldCountFor` from `@/audio/playback/heldNotes` (Task 1); `applySynthPlaybackVelocityScale(scale, target)` (Task 2); `ArpStateRef` with `target` / `triggeredTargets` (Task 3).
- Produces:
  ```ts
  // src/components/useInputDeck.ts
  export function synthTargetForFocus(focus: MixLayerId): SynthControlTarget | null;
  // unchanged signature, new behaviour: also subscribes to focusTrack and
  // writes ref.current.target
  export function subscribeArpState(ref: ArpStateRef): () => void;
  ```
  `synthTargetForFocus` lives in `useInputDeck.ts` rather than in `src/store/focusTrack.ts` on purpose: it is the **input deck's** routing decision (`null` means "this surface plays nothing"), not a projection the store owes anyone, and keeping it here leaves Plan 1's file untouched so Plans 3 and 4 can land against it without a conflict.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/useInputDeck.test.tsx`:

```ts
describe('synthTargetForFocus', () => {
  test('every melodic focus plays its own bus', () => {
    expect(synthTargetForFocus('synth')).toBe('synth');
    expect(synthTargetForFocus('fx')).toBe('fx');
    expect(synthTargetForFocus('chord')).toBe('chord');
    expect(synthTargetForFocus('bass')).toBe('bass');
    expect(synthTargetForFocus('pad')).toBe('pad');
  });

  test('a drum focus has no melodic bus, and says so with null', () => {
    // Not a fallback to 'synth': that would make the drum focus play the Lead
    // patch off the melodic keyboard — the same invisible mis-routing this
    // change removes. The QWERTY drum PADS are a disjoint key set on their own
    // listener and are unaffected.
    expect(synthTargetForFocus('drum')).toBeNull();
  });

  test('is total over the focus roster', () => {
    for (const focus of MIX_LAYER_IDS) {
      const target = synthTargetForFocus(focus);
      expect(target === null || typeof target === 'string').toBe(true);
    }
  });
});
```

Extend the existing `subscribeArpState` test — inside its `try`, after the bpm assertions:

```ts
      // The keyboard follows focus: the ref's target is the focused melodic
      // track, and null when there is nothing melodic to play.
      useAppStore.getState().setFocusTrack('fx');
      expect(ref.current.target).toBe('fx');
      useAppStore.getState().setFocusTrack('drum');
      expect(ref.current.target).toBeNull();
      useAppStore.getState().setFocusTrack('synth');
      expect(ref.current.target).toBe('synth');
```

and add to that file's imports:

```ts
import { synthTargetForFocus } from './useInputDeck';
import { MIX_LAYER_IDS } from '@/store/focusTrack';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/useInputDeck.test.tsx -t "synthTargetForFocus"`
Expected: FAIL — `TypeError: synthTargetForFocus is not a function`.

Run: `bun test src/components/useInputDeck.test.tsx -t "subscribeArpState"`
Expected: FAIL — `expect(received).toBe(expected)`, `Expected: "fx"`, `Received: "synth"` (the ref's target is still the pinned constant; `subscribeArpState` does not watch `focusTrack` yet).

- [ ] **Step 3: Delete the constant, add the routing helper**

In `src/components/useInputDeck.ts`, **delete** the `KEYBOARD_AUDITION_TARGET` constant and the comment above it, and put this in its place:

```ts
// The keyboard, the on-screen keyboard and the arp all play the FOCUSED track
// (`focusTrack` in the ui slice). They used to be pinned to a module constant,
// KEYBOARD_AUDITION_TARGET, whose stated reason was that pinning kept every
// audio call site (note-on, note-off, arp playback, voice release) agreeing on
// one engine, so a target switch could never strand voices on an engine
// nothing points at any more. The target varies now, so each of those
// guarantees is made explicitly instead:
//
//  - note-off releases on the target CAPTURED at note-on
//    (arpStateRef.current.heldTargets, see audio/playback/heldNotes.ts), never
//    on a target recomputed at release time. A focus change mid-hold would
//    otherwise send the release to a bus the voice was never on, and the held
//    voice would drone until the same key was pressed again on the same
//    track. Same rule as chordKeyNotesRef below, on a different axis.
//  - the arp records every bus it has TRIGGERED on and releases all of them
//    (arpPlayback.ts), because one hold spanning a focus change leaves voices
//    on more than one bus.
//  - equal-power polyphony counts the notes held on ONE bus, and the engine
//    rescale is scoped to that source, so playing a second track never
//    quietens the first.
//
// A focus change alone does NOT cut sounding voices: they ring out naturally.
// That is a decision (spec, Open risks 1) — cutting them is a hard stop the
// user did not ask for, and they are finite.

/**
 * The synth bus a focus plays on, or `null` when there is nothing melodic to
 * play. Exported so this routing decision is testable as pure logic, without
 * rendering — `useEffect` never runs under renderToString, so the deck's
 * behaviour is only reachable through helpers like this one.
 *
 * `null` for `drum` rather than a fallback to `'synth'`: a fallback would make
 * the drum focus play the Lead patch off the melodic keyboard, silently and
 * with nothing on screen to explain it, which is the exact failure this change
 * exists to remove. The QWERTY drum-PAD shortcuts are unaffected — they are a
 * disjoint key set (`KeyZ`..`Slash`, DEFAULT_PADS) on their own listener, so a
 * drum focus silences the melodic keyboard and leaves the pads playing.
 */
export function synthTargetForFocus(focus: MixLayerId): SynthControlTarget | null {
  return isMelodicFocus(focus) ? controlTargetForFocus(focus) : null;
}
```

Add the imports:

```ts
import {
  controlTargetForFocus,
  isMelodicFocus,
  type MixLayerId,
} from '../store/focusTrack';
```

(`import type { SynthControlTarget } from '../utils/synthControl';` is already there and stays — it is now the helper's return type.)

- [ ] **Step 4: Subscribe the ref to focus**

In `subscribeArpState`, add a third subscription and return it with the others:

```ts
  const unsubFocus = useAppStore.subscribe(
    (s) => s.focusTrack,
    (focus) => {
      ref.current.target = synthTargetForFocus(focus);
    },
    { fireImmediately: true },
  );
  return () => {
    unsubParams();
    unsubBpm();
    unsubFocus();
  };
```

and update its docblock's first line to name what it now mirrors:

```ts
/**
 * Keeps `arpStateRef.current.params` / `.bpm` / `.target` fresh by IMPERATIVE
 * store subscription instead of by a render-driven effect. ...
```

Initialise the ref from the store rather than from a constant:

```ts
    target: synthTargetForFocus(useAppStore.getState().focusTrack),
```

- [ ] **Step 5: Route note-on through the captured target**

In `handleNoteOn`, replace `const target = KEYBOARD_AUDITION_TARGET;` with the live read and the drum branch, and add the re-press guard:

```ts
      const liveParams = arpStateRef.current.params;
      // The bus focus names RIGHT NOW. Read once, used for both the engine
      // call and the map entry, so the note is captured on exactly the bus it
      // was played on even if focus moves during this callback.
      const target = arpStateRef.current.target;
      if (target === null) {
        // Focus is on the drum track: the melodic keyboard has nothing to
        // play. Nothing sounds, nothing is announced on the note-input bus
        // (announcing would let the recorder capture a note that made no
        // sound), and the key is not added to activeNotes — a highlighted key
        // that plays nothing is the invisible state this change removes.
        // Its note-off then finds no map entry and is a no-op, so the two
        // edges stay symmetric. The QWERTY drum PADS are a separate listener
        // over a disjoint key set and keep working.
        return;
      }
      const held = arpStateRef.current.heldTargets;
      initSynthPlayback();
      if (!liveParams.arpActive) {
        const previous = noteTargetFor(held, note);
        if (previous !== undefined && previous !== target) {
          // The same note is already held on ANOTHER bus — QWERTY holds C4 on
          // Lead, focus moves to FX, the on-screen keyboard is pressed on C4.
          // The map holds one target per note, so without this release the old
          // bus's voice loses its only release path and drones forever.
          synthPlaybackNoteOff(note, liveParams.release, undefined, previous);
        }
        const isNewNote = previous === undefined;
        held.set(note, target);
        const scale = equalPowerVelocityScale(heldCountFor(held, target));
        if (isNewNote) {
          applySynthPlaybackVelocityScale(scale, target);
        }
        synthPlaybackNoteOn(note, liveParams, 1.0, undefined, target, scale);
      } else {
        held.set(note, target);
        emitNoteInput({ kind: 'on', note, velocity: 1.0 });
      }
      setActiveNotes((prev) => new Set(prev).add(note));
```

`handleNoteOff` is unchanged from Task 3 — it already releases on `noteTargetFor(held, note)`, which is the capture.

Delete the three remaining comments that cite the constant by name (above the `arpActive`/`release` selectors, above `arpStateRef`, above `handleNoteOn`) and the one above the arp release effect; the block comment added in Step 3 states the rule once, where a reader meets it first.

- [ ] **Step 6: Run the deck tests to verify they pass**

Run: `bun test src/components/useInputDeck.test.tsx`
Expected: PASS, 0 fail.

- [ ] **Step 7: Reframe the SoundView test block**

`src/components/loop/SoundView.test.tsx` has a `describe('keyboard audition channel is always the main synth', …)` whose comment asserts exactly what this task falsifies. Its subject — `resolveSynthControlChannel` — still behaves the same, so the framing is rewritten and the resolver assertion is kept rather than the block being deleted. Replace the comment and the `describe` header, keep `baseParams` / `channel` / `channels` as they are, and replace the single `test(…)` inside with three:

```tsx
// The interactive keyboard is no longer pinned to the main synth: it plays
// whichever track `focusTrack` names (spec 2026-09-10-focus-track-design.md,
// symptom (a); useInputDeck.ts, synthTargetForFocus).
//
// `resolveSynthControlChannel` itself is UNCHANGED — it still maps a target to
// that target's channel — so what this block pins is the pair: focus picks the
// target, and the target picks the channel. The drum focus is the case with no
// channel at all, and it must resolve to nothing rather than falling back to
// Lead: the resolver's trailing `?? channels.synth` would absorb a stray
// 'drum' silently, which is why the fallback is never reached with one.
describe('the keyboard auditions the focused track', () => {
  // The `const baseParams: SynthParams = { … }` literal, the `channel(name)`
  // factory and the `channels` object below the describe header are UNCHANGED
  // — do not retype them, do not touch them. Only the header, the comment
  // above it and the tests inside it change.

  test('the panel resolver still maps every target to its own channel', () => {
    expect(resolveSynthControlChannel('chord', channels)).toBe(channels.chord);
    expect(resolveSynthControlChannel('bass', channels)).toBe(channels.bass);
    expect(resolveSynthControlChannel('synth', channels)).toBe(channels.synth);
  });

  test('focus picks the target, and the target picks the channel', () => {
    const cases: ReadonlyArray<[MixLayerId, string]> = [
      ['synth', 'main-synth'],
      ['fx', 'fx-synth'],
      ['chord', 'chord-synth'],
      ['bass', 'bass-synth'],
      ['pad', 'pad-synth'],
    ];
    for (const [focus, preset] of cases) {
      const target = synthTargetForFocus(focus);
      if (target === null) throw new Error(`expected a melodic target for ${focus}`);
      expect(resolveSynthControlChannel(target, channels).params.preset).toBe(preset);
    }
  });

  test('a drum focus has no channel to audition', () => {
    expect(synthTargetForFocus('drum')).toBeNull();
  });
});
```

Add to that file's imports:

```tsx
import { synthTargetForFocus } from '../useInputDeck';
import type { MixLayerId } from '@/store/focusTrack';
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test src/components/loop/SoundView.test.tsx`
Expected: PASS, 0 fail.

Run: `bun run verify`
Expected: all steps pass; `bun run eslint` prints nothing at all.

Confirm the constant is gone everywhere, comments included:

```bash
grep -rn "KEYBOARD_AUDITION_TARGET" src/
```

Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/components/useInputDeck.ts src/components/useInputDeck.test.tsx src/components/loop/SoundView.test.tsx
git commit -m "$(cat <<'EOF'
feat(input): the keyboard and the arp play the focused track

Deletes KEYBOARD_AUDITION_TARGET and every comment citing it. The QWERTY
keyboard, the on-screen keyboard and the arp now route through
synthTargetForFocus(focusTrack), which is the store value Plan 1 introduced —
closing the symptom that selecting FX on Sound lit the chip, edited
fxSynthParams and still sounded Lead.

The pinning guarantee is replaced, not dropped: the release target is captured
at note-on and never recomputed, equal-power polyphony counts one bus, the arp
releases every bus it triggered on, and re-pressing a held note on a different
bus releases the first one so it cannot lose its release path.

Focus 'drum' is an explicit no-op note-on: no sound, no bus announcement, no
held entry and no key highlight. The QWERTY drum-pad shortcuts are a disjoint
key set on their own listener and are unaffected.

SoundView.test.tsx's "keyboard audition channel is always the main synth"
block is reframed rather than deleted — resolveSynthControlChannel still
behaves the same; what changed is which target the keyboard asks it for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The gate, and the by-hand checks no test can make

**Files:**
- No production files. This task runs the gate and the listening checks, and fixes whatever they surface in the task that owns it.

**Interfaces:**
- Consumes: everything Tasks 1-4 produced.
- Produces: nothing. This is the completion gate for the branch.

- [ ] **Step 1: Run the full gate**

Run: `bun run verify`
Expected: `bun test` all pass; `bun run lint` (`tsc --noEmit`) silent; `bun run eslint` prints **nothing at all** — no errors and no warnings; `check:keys`, `check:drums`, `check:contrast`, `check:levels` pass; `build` succeeds.

`check:keys` must be untouched by this branch: neither the drum-pad key set (`DEFAULT_PADS`, `KeyZ`..`Slash`) nor the melodic map changed. If it moved, something in Task 4 touched the pad grid and must be reverted.

- [ ] **Step 2: Confirm nothing re-acquired the global rescale**

```bash
grep -rn "applySynthVelocityScale\|applySynthPlaybackVelocityScale" src/
```

Expected: the engine definition, the `synthPlayback.ts` wrapper, the two `useInputDeck` call sites and the engine test. **Every one carries two arguments.** A one-argument call would be a compile error now, which is the point of the required parameter — this grep is the cheap confirmation, not the guard.

- [ ] **Step 3: The listening checks**

Start the dev server (`bun run dev`) and confirm each by ear. None of these is testable without a DOM or a real `AudioContext`; each one names a failure this plan exists to prevent.

1. **Focus follows to the ear.** Focus Lead, play a key — Lead patch. Focus FX on Sound, play the same key — FX patch. That is spec symptom (a), closed.
2. **A focus change mid-hold does not strand a voice.** Hold a key on Lead, click the FX chip while still holding, release the key. The Lead voice must release. (It releases because note-off reads the capture; if it drones, `handleNoteOff` is recomputing the target.)
3. **Two buses do not share one polyphony budget.** Hold two notes on Lead, focus FX, hold two more. The FX notes must be at the two-note equal-power level, and the Lead notes must not drop further.
4. **The arp releases both buses.** Turn the arp on, hold a chord on Lead, focus FX while it is running, hold a chord there, then release everything. Nothing may keep sounding on either bus.
5. **Focus `drum` plays nothing melodic and everything percussive.** Focus the drum track: the QWERTY melodic keys and the on-screen keyboard are silent; `KeyZ`..`Slash` still fire the pads.
6. **The accompaniment is slightly louder under a held keyboard chord than it was before this branch.** This is Task 2's recorded change, not a regression — confirm it is *slight* and that nothing else moved.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/focus-track-voice-routing
```

---

## Self-Review

**1. Spec coverage** — every requirement in the spec's Plan 2 scope (*Voice safety*, the keyboard and arp rows of the per-surface table, Open risks 1 and 4):

| Spec requirement | Task |
|---|---|
| `KEYBOARD_AUDITION_TARGET` deleted; keyboard, on-screen keyboard and arp follow focus | Task 4, Steps 3-5 |
| Note-off releases on the target captured at note-on (`Map<note, target>`, the `chordKeyNotesRef` precedent) | Task 1 (`noteTargetFor`), Task 3 Step 6 (`handleNoteOff`) |
| The map is cleared in the same cleanup that clears `chordKeyNotesRef` | Task 3, Step 6 |
| Blur / visibilitychange backstop inherits the capture through `handleNoteOffRef` | Task 3, Step 6 (backstop reads `heldTargets.keys()`) |
| Half one — the held-note COUNT becomes per target | Task 1 (`heldCountFor`), Task 3 Step 6 (both call sites) |
| Half two — the ENGINE call becomes source-scoped | Task 2 |
| `applySynthVelocityScale` gains `source`, threaded from `applySynthPlaybackVelocityScale` and both call sites | Task 2, Steps 3-4 |
| The existing-behaviour level change named in the task **and** in the commit message | Task 2 preamble + Step 6 commit body; also Task 5 Step 3 check 6 |
| `ArpStateRef` carries `triggeredTargets: Set<SynthControlTarget>`, written at trigger time in the clock callback | Task 3, Steps 3-4 |
| Cleanup releases every member and clears the set | Task 3 (`releaseTriggeredTargets`, both callers) |
| The "unreachable today" docblock and the `ArpStateRef` comment rewritten in the commit that falsifies them | Task 3, Step 4 + Step 9 commit body |
| The negative assertion — a focused-but-never-triggered bus gets no release | Task 3, Step 1, test 2 |
| Focus `drum`: melodic keyboard plays nothing, drum-pad shortcuts unaffected, behaviour stated and tested | Task 4, Steps 1 and 5; Task 5 Step 3 check 5 |
| `SoundView.test.tsx`'s "keyboard audition channel is always the main synth" block reframed, not deleted | Task 4, Step 7 |
| Open risk 1 — let previous-target voices ring; no release on focus change | *What this plan does NOT do*; restated in Task 4's block comment |
| Tests are pure exported helpers, no DOM, no testing-library | Tasks 1, 3, 4 — every new test imports a function; nothing renders |

**Out of this plan's scope, by the spec's own split, and deliberately absent:** the state model and every read-only surface (Plan 1), Rec / `recordingTrack` (Plan 3), MIDI channel routing and `drumGmNotes.ts` (Plan 4), preview length (Plan 0), and solo's clearing table (Plan 1).

**2. Placeholder scan** — no "TBD", no "similar to Task N", no "add error handling", no "write tests for the above". Every code step carries the code. The one cross-reference ("`handleNoteOff` is unchanged from Task 3") points at a body printed in full two tasks earlier and is a statement that nothing changes, not a substitute for content.

**3. Type consistency** — checked across tasks and against Plan 1's Produces block:
- `MIX_LAYER_IDS`, `MixLayerId`, `isMelodicFocus`, `controlTargetForFocus`, `focusTrack`, `setFocusTrack` are used exactly as Plan 1 declares them, from `@/store/focusTrack` and the store. Nothing is renamed and nothing is added to that file.
- `HeldNoteTargets = Map<string, SynthControlTarget>` is declared in Task 1 and is the type of `ArpStateRef['current'].heldTargets` in Task 3 and of `arpStateRef` in Tasks 3-4. Readers take `ReadonlyMap`, writers hold the `Map` — assignable in that direction only, which is the intent.
- `applySynthVelocityScale(scale: number, source: string)` (Task 2) and `applySynthPlaybackVelocityScale(scale: number, target: string)` (Task 2) agree at every call site in Tasks 2-4. `SynthControlTarget` is a string union, so passing one where `string` is expected is valid; the wrapper deliberately keeps `string` to match `releaseSynthPlaybackVoices` and `synthPlaybackNoteOn`'s existing parameter types.
- `releaseTriggeredTargets(triggered, releaseTime, release)` has one signature (Task 3) and two callers: the arp cleanup passes an arrow wrapping `audioEngine.releaseSoundingVoices`, and `useInputDeck` passes `releaseSynthPlaybackVoices` directly — whose `(target: string, releaseTime?: number) => void` accepts the `(target: SynthControlTarget, releaseTime: number) => void` the parameter names.
- `synthTargetForFocus(focus: MixLayerId): SynthControlTarget | null` (Task 4) matches `ArpStateRef['current'].target` (Task 3) exactly, including the `null`.
- `buildArpSequence(heldNotes: Iterable<string>, …)` accepts the `string[]` `heldNotesFor` returns, and keys its cache on the contents, so a fresh array per tick still hits.

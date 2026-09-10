# Per-Voice Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp every synth voice with the player that created it, so a release can be scoped to one player instead of silencing a whole source bus.

**Architecture:** A four-value owner roster (`live`, `arp`, `sequencer`, `preview`) lives in its own leaf module, `src/audio/voiceOwner.ts`. `SynthVoice` gains a required `owner`, written at the engine's single voice-construction site and supplied as a **required, un-defaulted** parameter of `triggerSynthNoteOn`. `releaseSoundingVoices` gains a required owner and filters on it; a new `stopOwnedVoices` is `stopSource` narrowed to one owner, both delegating to one private helper so the subtle "already fading toward a no-later teardown" skip guard exists in exactly one copy. The owner is chosen by the bridge modules in `src/audio/playback/`, never by a component.

**Tech Stack:** TypeScript, raw Web Audio API, Bun test runner, zustand (untouched here), eslint layering rules.

**Spec:** `docs/superpowers/specs/2026-09-10-voice-provenance-design.md` — read it before Task 1. Every design question this plan does not answer is answered there; nothing in it is up for redesign during execution.

## Global Constraints

- `bun run verify` is the completion gate. Run it before claiming any task is done.
- `bun run eslint` must report **zero errors AND zero warnings** — including `unused-directive` warnings. An `eslint-disable` comment that turns out not to be needed is itself a warning, so only add one where the rule genuinely fires.
- `src/audio/` may not import `src/store/` or `src/components/`. `src/components/` may not import `audio/engine`. `src/audio/voiceOwner.ts` imports nothing at all.
- **`owner` has no default value anywhere in the public engine API.** The reason, not just the rule: the defect this plan fixes exists *because* whole-bus reach was reachable by omitting an argument. `applySynthVelocityScale(scale, source)` already carries this exact scar — it once called `reshapeableVoices()` with no argument although the parameter existed, and quietly ducked chord, bass and pad under a held keyboard chord. A default value re-opens that door for the next call site with no type error to see. If a call site does not know its owner, that call site is wrong, not the signature.
- Commit once per task, conventional-commit subject. **Every** commit message ends with the line:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Do not record version numbers, file counts or line numbers in `CLAUDE.md`.
- All written content — code, comments, docs, commit messages — is in English.

## Test design rules (apply to every task)

These are not style preferences; a reviewer on this repo rejects tests that violate them.

- The audio harness is `src/audio/testFakes.ts`. Build an engine with `freshEngine()`, which returns `{ engine, ctx }` with a fake `AudioContext` whose every `createGain()` is recorded in `ctx._gains`.
- **`fakeParam.valueAt(t)` THROWS** (`'valueAt does not model setTargetAtTime'`) on any timeline containing a `setTargetAtTime` event, and `releaseVoice` uses `setTargetAtTime`. Assert on the recorded arrays — `events`, `targets`, `cancels` — and never on `valueAt` in a test that touches a release.
- **Do not index `ctx._gains` positionally in the new multi-voice tests.** Each voice creates three gains (main VCA, sub, tremolo) and the first voice of a source additionally creates its tap and its bus, so the second voice's main gain is not at a stable index. Reach the voices through the engine's own bookkeeping instead: `[...((engine as any).sourceVoices.get(source) as Set<any>)]` and pick by `.owner`. `engine.test.ts` already opens with an `eslint-disable @typescript-eslint/no-explicit-any` block for exactly this kind of private-field access.
- **Use two different note names for the two voices.** `activeVoices` is keyed `` `${source}:${noteName}` `` and the dedup at the top of `triggerSynthNoteOn` releases a same-note predecessor — two voices named `C4` on one bus would have one of them released before the assertion under test ever ran.
- **The load-bearing assertion is the NEGATIVE half:** the other owner's voice must have **no new automation events at all**. Snapshot `gains[0].gain.events.length`, `.targets.length` and `.cancels.length` before the call and assert all three are unchanged after. A test that only checks the targeted voice got its ramp passes with the filter deleted.
- **Verify by deletion** where this plan says to: delete the owner-filter line, run the named test, confirm RED, then revert. A filter test that still passes with the filter gone is not a test.
- `bun test` runs the whole suite in **one process**. Any test that mutates shared state (a module singleton, `audioEngine`, an instance field such as `maxVoiceLifetimeMs`) restores it in `afterEach` or a `finally` — never in a trailing statement, which is skipped when the assertion above it throws.
- **No DOM, no testing-library, ever.** `useEffect` does not run under `renderToString`, so hook bodies are tested by extracting the pure part (this is why `releaseTriggeredTargets` is an exported function).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/audio/voiceOwner.ts` | **Create.** The roster and its type. Imports nothing. | 1 |
| `src/audio/voiceOwner.test.ts` | **Create.** Pins the roster in both directions. | 1 |
| `src/audio/engine.ts` | `SynthVoice.owner`; `owner` on `triggerSynthNoteOn`, `releaseSoundingVoices`; new `stopOwnedVoices`; the shared private stop helper; two prose comments. | 2, 3, 4, 6 |
| `src/audio/engine.test.ts` | Every existing `triggerSynthNoteOn` / `releaseSoundingVoices` caller updated; the new owner-scoping tests. | 2, 3, 4 |
| `src/audio/playback/synthPlayback.ts` | Stamps `'live'` on note-on, `'arp'` in `releaseSynthPlaybackVoices`. | 2, 5 |
| `src/audio/playback/playbackEngine.ts` | Stamps `'sequencer'` on note-on; new `playbackStopOwnedVoices`. | 2, 5 |
| `src/audio/playback/arpPlayback.ts` | Stamps `'arp'`; `releaseTriggeredTargets` hands the owner to its callback; the KNOWN LIMITATION comment is deleted. | 2, 5 |
| `src/audio/playback/arpPlayback.test.ts` | The owner reaches the injected callback. | 5 |
| `src/audio/playback/chordPlayback.ts` | `'sequencer'` for scheduled hits and `playFullHoldChord`; `'preview'` for the preview helpers. | 2 |
| `src/audio/playback/chordPlayback.test.ts` | Spy assertions gain the argument; hand-written fakes gain the parameter. | 2 |
| `src/audio/playback/presetPreview.ts` | Stamps `'preview'` at its three trigger sites. | 2 |
| `src/components/loop/lead/useLeadPlayback.ts` | Its two stop paths move to `playbackStopOwnedVoices`. | 5 |
| `CLAUDE.md` | An `## Architecture` paragraph recording the rule. | 6 |
| `.claude/skills/dsp-audio/SKILL.md` | "Voices and per-source buses" — the now-incomplete `releaseSoundingVoices()` line. | 6 |

---

## Task 1: The owner roster

**Files:**
- Create: `src/audio/voiceOwner.ts`
- Test: `src/audio/voiceOwner.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const VOICE_OWNERS = ['live', 'arp', 'sequencer', 'preview'] as const;` and `export type VoiceOwner = (typeof VOICE_OWNERS)[number];` — i.e. `'live' | 'arp' | 'sequencer' | 'preview'`. Every later task imports `VoiceOwner` from `'./voiceOwner'` (or `'../voiceOwner'` from `audio/playback/`).

- [ ] **Step 1: Write the failing test**

Create `src/audio/voiceOwner.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { VOICE_OWNERS, type VoiceOwner } from './voiceOwner';

/**
 * The compile-time half. `Assert<T extends true>` is what makes it real: a
 * condition resolving to `false` fails the `extends true` constraint and is a
 * genuine build error, unlike a bare `X extends Y ? true : never` alias, which
 * quietly resolves to `never` with nothing consuming it. Same pattern as
 * `store/melodyTracks.ts`.
 *
 * `Equal` compares by MUTUAL assignability, so it pins the roster and the union
 * in BOTH directions: adding a member to the tuple widens `VoiceOwner` and
 * fails, and re-declaring `VoiceOwner` as anything other than the tuple's
 * members also fails.
 */
type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** The roster, written out by hand. Editing voiceOwner.ts must break this. */
type ExpectedOwner = 'live' | 'arp' | 'sequencer' | 'preview';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertUnionMatchesRoster = Assert<Equal<VoiceOwner, ExpectedOwner>>;

/**
 * The runtime half, made exhaustive by the type annotation: a member added to
 * `VoiceOwner` and not to this literal is a compile error, and a member in this
 * literal that is not in `VOICE_OWNERS` fails the comparison below.
 */
const OWNER_KEYS: Record<VoiceOwner, true> = {
  live: true,
  arp: true,
  sequencer: true,
  preview: true,
};

describe('VOICE_OWNERS', () => {
  // NOT a length check. `expect(VOICE_OWNERS.length).toBe(4)` is vacuous: it
  // passes for any four strings, so renaming 'sequencer' to 'seq' — which
  // would silently stop matching every call site's literal — leaves it green.
  // Comparing the whole tuple names the contents and the order.
  test('is exactly the four owners, in the documented order', () => {
    expect(VOICE_OWNERS).toEqual(['live', 'arp', 'sequencer', 'preview']);
  });

  test('the roster and the exhaustive VoiceOwner record hold the same members', () => {
    expect(Object.keys(OWNER_KEYS).sort()).toEqual([...VOICE_OWNERS].sort());
  });

  test('every member is a distinct non-empty string', () => {
    expect(new Set(VOICE_OWNERS).size).toBe(VOICE_OWNERS.length);
    for (const owner of VOICE_OWNERS) expect(owner.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/voiceOwner.test.ts`
Expected: FAIL — the module `./voiceOwner` does not resolve.

- [ ] **Step 3: Write the implementation**

Create `src/audio/voiceOwner.ts`:

```ts
/**
 * Who created a synth voice. Four values, each a kind of caller that exists
 * today; none is speculative.
 *
 * - `'live'`      — a person pressing something: computer keyboard, on-screen
 *                   keyboard, MIDI device.
 * - `'arp'`       — the arpeggiator's clock.
 * - `'sequencer'` — the transport playing back written material.
 * - `'preview'`   — an audition: a library item or a grid cell clicked to hear.
 *
 * A tuple AND a type, not one of them: a union declared alone cannot be
 * enumerated at runtime, and a roster declared alone cannot be checked at
 * compile time. `voiceOwner.test.ts` pins the two together in both directions.
 *
 * Its own leaf module rather than an export of `engine.ts` because every bridge
 * in `audio/playback/` needs the type and none of them should widen its
 * dependency on the engine to get it. It imports nothing.
 */
export const VOICE_OWNERS = ['live', 'arp', 'sequencer', 'preview'] as const;

export type VoiceOwner = (typeof VOICE_OWNERS)[number];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/voiceOwner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Prove the compile-time half is real**

Temporarily change `ExpectedOwner` in the test to `'live' | 'arp' | 'sequencer'`, then run `bun run lint`.
Expected: a type error on `_AssertUnionMatchesRoster`. Revert the change and re-run `bun run lint` — expected: clean.

- [ ] **Step 6: Gate**

Run: `bun run lint && bun run eslint`
Expected: no output from either. If `eslint` reports an unused-directive warning on the `no-unused-vars` disable, delete that comment — the gate is zero warnings, and the directive is only warranted if the rule actually fires on the unused type alias.

- [ ] **Step 7: Commit**

```bash
git add src/audio/voiceOwner.ts src/audio/voiceOwner.test.ts
git commit -m "$(cat <<'EOF'
feat(audio): add the voice-owner roster

Four owners — live, arp, sequencer, preview — as a const tuple plus its
derived union, in a leaf module that imports nothing so every bridge in
audio/playback/ can take the type without depending on the engine.

The test pins the roster both ways: an Assert<T extends true> comparison
against a hand-written union (a real build error, not a never-consumed
conditional alias) and an exhaustive Record<VoiceOwner, true> compared to
the tuple's contents. A length assertion would have passed for any four
strings.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `owner` on the voice, required at the trigger

Mechanical and wide. **No behaviour changes in this task** — every voice simply gains a label. The suite must be green at the end with no test's expectations changed in meaning.

**Files:**
- Modify: `src/audio/engine.ts` (the `SynthVoice` interface near the top; `triggerSynthNoteOn`'s signature; the `const voice: SynthVoice = {…}` construction site)
- Modify: `src/audio/playback/synthPlayback.ts`, `src/audio/playback/playbackEngine.ts`, `src/audio/playback/arpPlayback.ts`, `src/audio/playback/chordPlayback.ts`, `src/audio/playback/presetPreview.ts`
- Test: `src/audio/engine.test.ts`, `src/audio/playback/chordPlayback.test.ts` (and any other file `tsc` names)

**Interfaces:**
- Consumes: `VoiceOwner` from Task 1.
- Produces: `triggerSynthNoteOn(noteName: string, params: SynthParams, velocity = DEFAULT_VELOCITY, time: number | undefined, source = 'synth', scaleFactor = 1, owner: VoiceOwner): void` and `SynthVoice.owner: VoiceOwner`. Tasks 3 and 4 read `voice.owner`.

**The signature trap, read before touching the code.** Today the fourth parameter is `time?: number`. TypeScript rejects a required parameter after an *optional* (`?`) parameter — `TS1016: A required parameter cannot follow an optional parameter` — while a *defaulted* parameter after an optional one is fine, which is why `source = 'synth'` compiles today. So adding a required `owner` at the end **requires changing `time?: number` to `time: number | undefined`**. That is not a cosmetic edit: it makes `time` positionally mandatory. It costs nothing in practice because `owner` is already forcing every caller to pass all seven arguments, and callers that mean "now" keep passing a literal `undefined` exactly as several already do. Leave the `velocity`, `source` and `scaleFactor` defaults in place — they still resolve an explicitly-passed `undefined`.

- [ ] **Step 1: Add the field to `SynthVoice`**

In `src/audio/engine.ts`, add the import and the field. Put `owner` next to `source` and `noteName`, which are the other two identity fields:

```ts
import type { VoiceOwner } from './voiceOwner';
```

```ts
  source: string;
  // Which PLAYER created this voice. Written once, at the single construction
  // site below, which is the only moment that means "this player now owns a
  // voice here" — never recomputed, so a release cannot be misrouted by a
  // focus change or a transport start that happened after note-on.
  owner: VoiceOwner;
  noteName: string;
```

- [ ] **Step 2: Change the signature and write the field**

Replace `triggerSynthNoteOn`'s signature:

```ts
  triggerSynthNoteOn(
    noteName: string,
    params: SynthParams,
    velocity = DEFAULT_VELOCITY,
    time: number | undefined,
    source = 'synth',
    scaleFactor = 1,
    owner: VoiceOwner,
  ): void {
```

and add `owner` to the voice literal, beside `source`:

```ts
      envelopeScale: scaleFactor,
      source,
      owner,
      noteName,
```

- [ ] **Step 3: Document why there is no default, at the signature**

Immediately above the signature, add:

```ts
  /**
   * `owner` is REQUIRED and deliberately un-defaulted. Same rule, and the
   * same recorded reason, as `applySynthVelocityScale`'s required `source`:
   * that bug existed precisely because a call site could leave the argument off
   * and silently re-acquire reach over every voice. A default here would let
   * the next call site do it again, with no type error to see — and an
   * unlabelled voice is a voice no scoped release can ever exclude.
   */
```

- [ ] **Step 4: Update the production call sites, per the spec's owner table**

| file | site | owner |
|---|---|---|
| `playback/synthPlayback.ts` | `synthPlaybackNoteOn` | `'live'` |
| `playback/arpPlayback.ts` | the `triggerSynthNoteOn` inside `useArpPlayback`'s clock callback | `'arp'` |
| `playback/playbackEngine.ts` | `playbackNoteOn` | `'sequencer'` |
| `playback/chordPlayback.ts` | the scheduled-hit loop in the step-event scheduler | `'sequencer'` |
| `playback/chordPlayback.ts` | `playFullHoldChord` | `'sequencer'` |
| `playback/chordPlayback.ts` | `playChordLegato` (via `PreviewEngine`) | `'preview'` |
| `playback/presetPreview.ts` | all three trigger sites (the progression loop, the preset audition, `previewSequencerNote`) | `'preview'` |

Two of these need the `scaleFactor` slot filled in as well, because the owner now sits behind it. Example, `synthPlayback.ts`:

```ts
  audioEngine.triggerSynthNoteOn(
    note,
    params,
    velocity,
    time,
    target,
    scaleFactor,
    "live",
  );
```

and `playbackEngine.ts`, which never had a `scaleFactor` argument:

```ts
export function playbackNoteOn(
  noteName: string,
  params: SynthParams,
  velocity = 0.8,
  time?: number,
  source = "synth",
): void {
  // 'sequencer' — the transport playing back written material. The bridge
  // decides the owner; no component names one.
  audioEngine.triggerSynthNoteOn(noteName, params, velocity, time, source, 1, "sequencer");
}
```

Note the bridge functions keep their own `time?: number` — only the engine method's parameter became positionally mandatory, and the bridges pass `time` through explicitly.

`chordPlayback.ts`'s `PreviewEngine` is `Pick<typeof audioEngine, "triggerSynthNoteOn" | …>`, so its type picks up the new parameter with no edit. What DOES need editing is any hand-written object or `mockImplementation` in the tests that satisfies that type — see Step 6.

- [ ] **Step 5: Compile and let `tsc` enumerate the rest**

Run: `bun run lint`
Expected: a long list of `Expected 7 arguments, but got 5` errors, one per stale call site. Work through the list; do not guess at the set. Test callers get an owner that matches what the test is simulating — `'live'` for a keyboard-press scenario, `'sequencer'` for a scheduled-pattern scenario, `'preview'` for a preview-source scenario. When a test's scenario is genuinely owner-agnostic (most of `engine.test.ts`: envelope shapes, filter ramps, trims, LFO teardown), use `'live'` and leave it alone.

- [ ] **Step 6: Fix the spy and fake call sites, which `tsc` will NOT all catch**

`spyOn(audioEngine, 'triggerSynthNoteOn')` records arguments, so assertions on them must gain the seventh. In `src/audio/playback/chordPlayback.test.ts`, update every `toHaveBeenCalledWith(...)` on that spy and every positional read of `onSpy.mock.calls[i][n]`, and add the parameter to the `mockImplementation((note, params, velocity, time, source, scaleFactor, owner) => …)` that stands in for the engine. A `mockImplementation` with too few parameters compiles fine and silently drops the owner, which is why this step is separate from Step 5.

- [ ] **Step 7: Grep for the loophole — plain calls AND casts**

```bash
# Every plain call — the list must be empty of five-argument calls when done.
grep -rn "triggerSynthNoteOn" src/
# Every way the required parameter can still be dodged.
grep -rn "as any).triggerSynthNoteOn" src/
grep -rn -B2 "triggerSynthNoteOn" src/ | grep -n "@ts-expect-error\|@ts-ignore\|as unknown as"
```

A cast defeats the required parameter completely: `(engine as any).triggerSynthNoteOn('C4', SYNTH, 0.8, t, 'synth')` type-checks, runs, and produces a voice whose `owner` is `undefined` — which then matches no owner filter and is silently excluded from every scoped release. **This repo already contains exactly one such call** (in `engine.test.ts`, in the idle-suspend area, reaching the method through an `any`-cast engine). Find it, give it the owner argument too, and do not leave any `owner`-less cast behind. If a cast exists only to reach a private field, keep the cast but still pass all seven arguments.

- [ ] **Step 8: Add the guard test that an owner is actually stored**

In `src/audio/engine.test.ts`, inside a new `describe('voice provenance', …)`:

```ts
  test('the owner passed at note-on is stored on the voice', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, t0, 'synth', 1, 'sequencer');

    const voices = [...((engine as any).sourceVoices.get('synth') as Set<any>)];
    // Two voices, two owners: the field is per-voice, not per-source. A
    // per-source record would make both read the same and every scoped
    // release in Tasks 3 and 4 either a no-op or a whole-bus stop.
    expect(voices.map((v) => v.owner).sort()).toEqual(['arp', 'sequencer']);
    expect(voices.find((v) => v.noteName === 'C4').owner).toBe('arp');
    expect(voices.find((v) => v.noteName === 'E4').owner).toBe('sequencer');
  });
```

Two different note names, deliberately: `activeVoices` is keyed `` `${source}:${noteName}` `` and the same-note dedup would release the first voice before the second was built.

- [ ] **Step 9: Run the full gate**

Run: `bun run verify`
Expected: all green. Any *behaviour* difference in an existing test means an owner argument landed in the wrong positional slot — most likely `scaleFactor` got the string. Re-read the call, do not adjust the expectation.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(audio): stamp every synth voice with its owner

SynthVoice gains a required `owner`, written at the engine's single voice
construction site — the only moment that means "this player now owns a
voice here". triggerSynthNoteOn takes it as a required seventh parameter
with no default, for the reason applySynthVelocityScale's required
`source` already records: whole-bus reach must never be obtainable by
omitting an argument.

`time?: number` becomes `time: number | undefined` because TypeScript
rejects a required parameter behind an optional one. Every production
call site takes its owner from the spec's table, and every test caller,
including one that reached the method through an `any` cast, now passes
one — a cast is the one way a required parameter can still be dodged.

No behaviour change: voices are labelled, nothing reads the label yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Scope `releaseSoundingVoices` to an owner

**Files:**
- Modify: `src/audio/engine.ts` (`releaseSoundingVoices`)
- Modify: `src/audio/playback/arpPlayback.ts`, `src/audio/playback/synthPlayback.ts` — only enough to compile; Task 5 owns their semantics
- Test: `src/audio/engine.test.ts` (the existing `describe('releaseSoundingVoices')`)

**Interfaces:**
- Consumes: `VoiceOwner` (Task 1), `voice.owner` (Task 2).
- Produces: `releaseSoundingVoices(source: string, releaseTime: number, owner: VoiceOwner): void`. Note `releaseTime` **loses its `= 0.1` default** — with a required parameter behind it the default is unreachable, and a dead default reads as an option a caller has. Every existing caller already passes `releaseTime` explicitly.

**What must NOT change:** the two future-voice rules, verbatim. A future-scheduled voice that already owns a release keeps it (the arp key-release path must not cancel notes the clock has planned). A future voice with no release of its own is still hard-silenced, because a ramp cannot silence a voice that starts after the ramp ends and it would otherwise drone forever. The owner filter is a new line *in front of* those rules, not a rewrite of them.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('releaseSoundingVoices', …)` in `src/audio/engine.test.ts`:

```ts
  test('leaves a voice of another owner untouched', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Two players on ONE bus — the exact situation this whole change exists
    // for. The lead track's engine source is 'synth' and the arp plays
    // whichever bus focusTrack names, so an arp key-up used to cut the
    // melody track's sounding note short.
    // Different note names: the same-note dedup would release the first
    // voice before the second existed, and there would be nothing to assert.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.9, t0, 'synth', 1, 'sequencer');

    const voices = [...((engine as any).sourceVoices.get('synth') as Set<any>)];
    const arpVoice = voices.find((v) => v.owner === 'arp');
    const seqVoice = voices.find((v) => v.owner === 'sequencer');

    // The NEGATIVE half is the load-bearing one: a test that only checks the
    // arp voice got its ramp stays green with the owner filter deleted.
    const seqGain = seqVoice.gains[0].gain;
    const before = {
      events: seqGain.events.length,
      targets: seqGain.targets.length,
      cancels: seqGain.cancels.length,
    };

    engine.releaseSoundingVoices('synth', 0.1, 'arp');

    // Asserting on the recorded arrays, never valueAt(): release ramps use
    // setTargetAtTime and fakeParam.valueAt THROWS on such a timeline.
    expect(arpVoice.gains[0].gain.cancels).toContain(t0);
    expect(arpVoice.releaseScheduledAt).toBe(t0);

    expect(seqGain.events.length).toBe(before.events);
    expect(seqGain.targets.length).toBe(before.targets);
    expect(seqGain.cancels.length).toBe(before.cancels);
    expect(seqVoice.releaseScheduledAt).toBeUndefined();
  });

  test("another owner's future-scheduled voice is not hard-silenced", () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // A future voice with no release of its own is the case the owner-blind
    // path hard-silences via silenceVoiceNow — which also removes it from
    // sourceVoices, so the sequencer's next note would never sound.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'sequencer');

    engine.releaseSoundingVoices('synth', 0.1, 'arp');

    const voices = [...((engine as any).sourceVoices.get('synth') as Set<any>)];
    expect(voices.length).toBe(1);
    expect(voices[0].gains[0].gain.cancels).not.toContain(t0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/engine.test.ts -t "leaves a voice of another owner untouched"`
Expected: FAIL — a type error on the third argument, or (if `tsc` is not in the path of `bun test`) an assertion failure on `seqGain.cancels.length`, because today's method releases every sounding voice on the bus.

- [ ] **Step 3: Add the parameter and the filter**

In `src/audio/engine.ts`, replace the signature and add one line at the top of the loop. Extend the existing docblock rather than replacing it:

```ts
  /**
   * Releases only the voices of a source THAT THIS OWNER CREATED and that have
   * actually started. Unlike stopSource this leaves future-scheduled hits
   * alone, so releasing a held key in arp mode no longer cancels the envelopes
   * of notes the clock has already scheduled (which cancelled their attack and
   * made them inaudible). A future voice without a release of its own is still
   * released, otherwise it would drone forever.
   *
   * `owner` is REQUIRED and un-defaulted. Three players share the melodic
   * buses — live input, the arp, the melody-track sequencer — so an owner-blind
   * release on 'synth' or 'fx' cuts a melody track's sounding note short on an
   * arp key-up. Whole-bus reach lives in stopSource, whose name says so, and
   * must never be reachable by leaving an argument off.
   */
  releaseSoundingVoices(source: string, releaseTime: number, owner: VoiceOwner): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const voices = this.sourceVoices.get(source);
    if (!voices) return;
    for (const voice of Array.from(voices)) {
      if (voice.owner !== owner) continue;
      if (voice.startTime > now) {
        // ... existing body, unchanged ...
```

- [ ] **Step 4: Make the two callers compile (semantics land in Task 5)**

`arpPlayback.ts`'s cleanup callback and `synthPlayback.releaseSynthPlaybackVoices` both call the method. Pass `'arp'` in both — that is the value Task 5 keeps, so this is not throwaway. Leave the KNOWN LIMITATION comment in place for now; Task 5 deletes it as part of the change that makes it false.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS, including the four pre-existing `releaseSoundingVoices` tests. Those pass `'synth'`/`'chord'` with an owner from Task 2 and must not have had their meaning edited.

- [ ] **Step 6: Verify by deletion**

Delete the line `if (voice.owner !== owner) continue;` and run:

```bash
bun test src/audio/engine.test.ts -t "leaves a voice of another owner untouched"
```

Expected: **RED**, on `seqGain.cancels.length`. Restore the line and re-run — expected: PASS. If it stayed green, the test is asserting something the filter does not cause; fix the test, not the count.

- [ ] **Step 7: Full gate**

Run: `bun run verify`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(audio): scope releaseSoundingVoices to one owner

`owner` becomes a required third parameter and the loop skips voices of
every other owner, so an arp key-up no longer releases a melody track's
sounding note on the shared bus. `releaseTime` loses its default, which a
required parameter behind it had made unreachable.

The two future-voice rules are unchanged: a future voice that already
owns a release keeps it, and a future voice with no release of its own is
still hard-silenced so it cannot drone. The filter is one line in front
of them.

Verified by deletion — removing the filter line turns "leaves a voice of
another owner untouched" red on the negative assertion, which is the half
that carries the test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `stopOwnedVoices` and the shared private helper

**Files:**
- Modify: `src/audio/engine.ts` (`stopSource`, plus a new private method and a new public one)
- Test: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `VoiceOwner` (Task 1), `voice.owner` (Task 2).
- Produces: `stopOwnedVoices(source: string, owner: VoiceOwner, releaseTime = 0.1, time?: number): void`. Task 5's `playbackStopOwnedVoices` wraps exactly this. `stopSource(source: string, releaseTime = 0.1, time?: number): void` keeps its signature and its whole-bus meaning — `store/loadLoop.ts`, `store/vibes.ts` and `store/projectSlice.ts` genuinely mean "silence this bus, whatever is on it", and a project install that left a held note ringing would be worse than the bug being fixed.

**Why one private helper and not two loops.** The skip guard inside `stopSource` — a voice already fading toward a teardown no later than the one this stop would plan is left alone — is subtle, was arrived at from a real bug (a held preview stops its source on both press and release; clicking faster than the tail is long pinned every dead voice in `sourceVoices` until `stealOldestVoice` could only steal the notes being pressed right now, so the preview collapsed to its last note and stayed there), and a drift between two copies of it would be inaudible until it wasn't. One body, an optional owner, both public methods delegating and passing their owner explicitly.

- [ ] **Step 1: Write the failing test**

Add a new `describe('stopOwnedVoices', …)` to `src/audio/engine.test.ts`:

```ts
describe('stopOwnedVoices', () => {
  test("leaves another owner's sounding voice untouched", () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'sequencer');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.9, t0, 'synth', 1, 'live');

    const voices = [...((engine as any).sourceVoices.get('synth') as Set<any>)];
    const seqVoice = voices.find((v) => v.owner === 'sequencer');
    const liveVoice = voices.find((v) => v.owner === 'live');

    const liveGain = liveVoice.gains[0].gain;
    const before = {
      events: liveGain.events.length,
      targets: liveGain.targets.length,
      cancels: liveGain.cancels.length,
    };

    engine.stopOwnedVoices('synth', 'sequencer', 0.02);

    expect(seqVoice.gains[0].gain.cancels).toContain(t0);
    expect(seqVoice.releaseScheduledAt).toBe(t0);

    // The load-bearing half: stopping a melody grid must not cut the key the
    // player is holding down. No new automation of ANY kind on that voice.
    expect(liveGain.events.length).toBe(before.events);
    expect(liveGain.targets.length).toBe(before.targets);
    expect(liveGain.cancels.length).toBe(before.cancels);
    expect(liveVoice.releaseScheduledAt).toBeUndefined();
  });

  test("leaves another owner's future-scheduled voice in place", () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // This is the case a whole-bus stop DESTROYS: stopSource hard-silences a
    // future voice through silenceVoiceNow, which also drops it from
    // sourceVoices — so an arp note the clock has already queued would never
    // sound, and it is unrecoverable rather than merely early.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.9, t0, 'synth', 1, 'sequencer');

    const arpVoice = [...((engine as any).sourceVoices.get('synth') as Set<any>)]
      .find((v) => v.owner === 'arp');
    const arpGain = arpVoice.gains[0].gain;
    const beforeEvents = arpGain.events.length;

    engine.stopOwnedVoices('synth', 'sequencer', 0.02);

    const after = [...((engine as any).sourceVoices.get('synth') as Set<any>)];
    expect(after.map((v) => v.owner)).toEqual(['arp']);
    expect(arpGain.events.length).toBe(beforeEvents);
    expect(arpGain.cancels).not.toContain(t0);
  });

  test('an unknown source and a context-less engine are both no-ops', () => {
    const { engine } = freshEngine();
    expect(() => engine.stopOwnedVoices('nope', 'arp', 0.02)).not.toThrow();
    const bare = makeEngine();
    expect(() => bare.stopOwnedVoices('synth', 'arp', 0.02)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/engine.test.ts -t "stopOwnedVoices"`
Expected: FAIL — `engine.stopOwnedVoices is not a function`.

- [ ] **Step 3: Extract the private helper**

In `src/audio/engine.ts`, replace the whole `stopSource` method with the helper plus two thin public methods. The loop body is moved **verbatim**, with one added guard line and its comments carried across:

```ts
  /**
   * The shared body of stopSource and stopOwnedVoices: silence a source's
   * voices, including hits still scheduled ahead of the transport.
   *
   * `owner === undefined` means every voice on the bus. One body rather than
   * two, because the skip guard below is subtle, was arrived at from a real
   * bug, and a drift between two copies of it would be inaudible until it
   * wasn't.
   */
  private stopVoicesOf(
    source: string,
    releaseTime: number,
    time: number | undefined,
    owner: VoiceOwner | undefined,
  ): void {
    if (!this.ctx) return;
    const now = time ?? this.ctx.currentTime;
    const voices = this.sourceVoices.get(source);
    if (!voices) return;
    for (const voice of Array.from(voices)) {
      if (owner !== undefined && voice.owner !== owner) continue;
      if (voice.startTime > now) {
        this.silenceVoiceNow(voice, now);
        continue;
      }
      // A voice already fading toward a teardown no later than the one this
      // stop would plan is already stopping, so re-releasing it changes
      // nothing audible — but releaseVoice re-arms its teardown timer, and a
      // held preview stops its source on every press AND release. Clicking
      // faster than the tail is long therefore kept every dead voice in
      // sourceVoices indefinitely; past maxVoicesPerSource, stealOldestVoice
      // can only steal voices with no release planned — the notes of the
      // chord being pressed right now — so the preview collapsed to its last
      // note and stayed there. A SHORTER stop still falls through and cuts
      // the tail, which is what makes this a skip and not a blanket guard.
      if (
        voice.releaseScheduledAt !== undefined
        && voice.teardownAt !== undefined
        && voice.teardownAt <= this.plannedTeardownAt(releaseTime, now)
      ) continue;
      voice.releaseScheduledAt = now;
      voice.releaseTime = releaseTime;
      this.releaseVoice(voice, releaseTime, now);
    }
  }

  /**
   * Immediately silences EVERY voice of a source — sounding ones and hits still
   * scheduled in the future, whoever created them. Releasing a held preview
   * stops the whole pattern, not just the last scheduled hit.
   *
   * `time` anchors the release in the AudioContext's timeline so a soft stop
   * can be scheduled exactly on a bar line instead of relying on a timer.
   * releaseVoice already handles a `now` in the future.
   *
   * Whole-bus reach is DELIBERATELY the method with the whole-bus name.
   * loadLoop, vibes and projectSlice genuinely mean "silence this bus, whatever
   * is on it" — a project install that left a held note ringing would be worse
   * than the bug per-voice provenance closes. Anything narrower calls
   * stopOwnedVoices; it can never be reached by omitting an argument, which is
   * how the original defect came to exist.
   */
  stopSource(source: string, releaseTime = 0.1, time?: number): void {
    this.stopVoicesOf(source, releaseTime, time, undefined);
  }

  /**
   * stopSource narrowed to one owner: sounding voices AND future-scheduled hits
   * that THIS player created, and nothing else. What the melody-track sequencer
   * needs, so stopping a grid does not cut a held key or an arp note off the
   * shared bus.
   */
  stopOwnedVoices(
    source: string,
    owner: VoiceOwner,
    releaseTime = 0.1,
    time?: number,
  ): void {
    this.stopVoicesOf(source, releaseTime, time, owner);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS. The pre-existing `stopSource` tests (the future-hit kill, the fast-clicked-preview guard, the bar-line-anchored stop) must all still pass with no edits — that is the evidence the extraction was verbatim.

- [ ] **Step 5: Verify by deletion**

Delete the line `if (owner !== undefined && voice.owner !== owner) continue;` and run:

```bash
bun test src/audio/engine.test.ts -t "leaves another owner's future-scheduled voice in place"
```

Expected: **RED** — `after.map((v) => v.owner)` comes back empty, because the owner-blind path calls `silenceVoiceNow` on the arp's future voice and drops it from `sourceVoices`. Also confirm `-t "leaves another owner's sounding voice untouched"` goes red. Restore the line; re-run both — PASS.

- [ ] **Step 6: Full gate**

Run: `bun run verify`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(audio): add stopOwnedVoices, sharing stopSource's body

stopSource's per-voice body — including the skip guard that leaves a
voice already fading toward a no-later teardown alone, which a
fast-clicked preview depends on — moves into one private
stopVoicesOf(source, releaseTime, time, owner?). stopSource passes
undefined and keeps its whole-bus meaning for loadLoop, vibes and
projectSlice; stopOwnedVoices(source, owner, releaseTime, time?) is the
narrow one.

One body, not two: the guard is subtle, came out of a real bug, and two
copies would drift inaudibly. Verified by deletion on both new tests, of
which the future-scheduled case is the one a whole-bus stop destroys
outright rather than merely early.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire the two behaviour fixes

The two defects the spec opens with actually close here.

**Files:**
- Modify: `src/audio/playback/arpPlayback.ts` (`releaseTriggeredTargets`; the cleanup callback; delete the KNOWN LIMITATION comment)
- Modify: `src/audio/playback/synthPlayback.ts` (`releaseSynthPlaybackVoices`)
- Modify: `src/audio/playback/playbackEngine.ts` (new `playbackStopOwnedVoices`)
- Modify: `src/components/loop/lead/useLeadPlayback.ts` (its two stop call sites)
- Test: `src/audio/playback/arpPlayback.test.ts`

**Interfaces:**
- Consumes: `releaseSoundingVoices(source, releaseTime, owner)` (Task 3), `stopOwnedVoices(source, owner, releaseTime, time?)` (Task 4), `VoiceOwner` (Task 1).
- Produces:
  - `releaseTriggeredTargets(triggered: Set<SynthControlTarget>, releaseTime: number, release: (target: SynthControlTarget, releaseTime: number, owner: VoiceOwner) => void): void` — it passes `'arp'` as the third argument on every call.
  - `playbackStopOwnedVoices(source: string, releaseTime = 0.1, time?: number): void` in `playbackEngine.ts`, pinning `'sequencer'`.

**Why `releaseTriggeredTargets` hands the owner to its callback rather than taking one.** Every target in `triggeredTargets` is there *because the arp triggered a voice on it* — the owner is structurally always `'arp'`, so a parameter would be an option no caller may legitimately vary. Passing it to the injected callback is what keeps it testable: the callback is the seam, and the seam is where a wrong owner would be observable. `useInputDeck.ts` (in `src/components/`, which may not import `audio/engine`) keeps passing the two-parameter `releaseSynthPlaybackVoices` — a function of fewer parameters is assignable to a wider callback type, so **no component names an owner**, exactly as the spec requires.

- [ ] **Step 1: Write the failing test**

Add to `describe('releaseTriggeredTargets', …)` in `src/audio/playback/arpPlayback.test.ts`:

```ts
  test("every release call carries the 'arp' owner", () => {
    // Every member of `triggered` is there because the ARP triggered a voice
    // on it, so the owner is not an option a caller varies — it is a fact this
    // function knows and the injected callback needs. An owner-less call would
    // not fail to compile at the engine (releaseSynthPlaybackVoices pins its
    // own), so this seam is the only place a wrong value is observable.
    const owners: Array<VoiceOwner | undefined> = [];
    const triggered = new Set<SynthControlTarget>(['synth', 'fx']);

    releaseTriggeredTargets(triggered, 0.2, (_target, _releaseTime, owner) => {
      owners.push(owner);
    });

    expect(owners).toEqual(['arp', 'arp']);
  });
```

Add `import type { VoiceOwner } from '../voiceOwner';` at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/arpPlayback.test.ts -t "carries the 'arp' owner"`
Expected: FAIL — `owners` is `[undefined, undefined]` (and/or a type error on the third callback parameter).

- [ ] **Step 3: Thread the owner through `releaseTriggeredTargets`**

In `src/audio/playback/arpPlayback.ts`:

```ts
import type { VoiceOwner } from '../voiceOwner';
```

```ts
/**
 * Releases every bus the arp has triggered on and then forgets them, so a
 * later hold starts from an empty record rather than releasing buses it never
 * touched.
 *
 * Takes the release call as a parameter because its two callers sit on
 * opposite sides of a layering rule: the cleanup below passes
 * `audioEngine.releaseSoundingVoices`, and `components/useInputDeck.ts` — which
 * may not import `audio/engine` — passes `releaseSynthPlaybackVoices`.
 *
 * The owner is handed to the callback rather than taken as a parameter: every
 * target in `triggered` is there BECAUSE the arp triggered a voice on it, so
 * `'arp'` is a fact this function knows, not a choice a caller makes. A
 * two-parameter callback is still assignable, which is what lets a component
 * keep passing `releaseSynthPlaybackVoices` without ever naming an owner.
 */
export function releaseTriggeredTargets(
  triggered: Set<SynthControlTarget>,
  releaseTime: number,
  release: (target: SynthControlTarget, releaseTime: number, owner: VoiceOwner) => void,
): void {
  for (const target of triggered) {
    release(target, releaseTime, 'arp');
  }
  triggered.clear();
}
```

- [ ] **Step 4: Use it in the cleanup, and delete the KNOWN LIMITATION comment**

In `useArpPlayback`'s effect cleanup, the callback becomes a pass-through and the whole `// KNOWN LIMITATION, named rather than left to be rediscovered: …` block is **deleted, not reworded** — it stops being true:

```ts
        releaseTriggeredTargets(triggeredTargets, params.release, (target, releaseTime, owner) => {
          audioEngine.releaseSoundingVoices(target, releaseTime, owner);
        });
```

Do not replace it with a shortened version of the same warning. The one remaining limitation — the shared one-voice-slot dedup — is recorded in Task 6 at its cause, and duplicating it here is how the arp acquired a comment about an engine defect in the first place.

- [ ] **Step 5: Pin `'arp'` in `releaseSynthPlaybackVoices`**

In `src/audio/playback/synthPlayback.ts`:

```ts
/**
 * The arp's key-up release, and only that. Its one caller is `useInputDeck`'s
 * arp cleanup — the callback it hands to `releaseTriggeredTargets` — so the
 * owner is pinned here rather than taken as a parameter.
 *
 * This is NOT a general-purpose release and must not become one: a future
 * caller that means something else needs its own wrapper naming its own owner.
 * A parameter here would put owner selection back in `src/components/`, which
 * the whole mapping exists to prevent.
 */
export function releaseSynthPlaybackVoices(
  target: SynthControlTarget,
  releaseTime = 0.1,
): void {
  // audioEngine.releaseSoundingVoices deliberately stays typed `source:
  // string` — the engine knows nothing about the store's target vocabulary —
  // so the narrowing to SynthControlTarget happens here, at the one call site
  // a wrong bus name could otherwise slip through untyped.
  audioEngine.releaseSoundingVoices(target, releaseTime, 'arp');
}
```

- [ ] **Step 6: Add `playbackStopOwnedVoices`**

In `src/audio/playback/playbackEngine.ts`, directly below `playbackStopSource`:

```ts
/**
 * Silences one PLAYER's voices on a source — its sounding voices and the hits
 * it has scheduled ahead of the transport — and nothing else on that bus.
 *
 * The melody-track version of `playbackStopSource`. A melody grid shares its
 * bus with live input and the arp (the lead track's engine source is 'synth',
 * the FX track's is 'fx'), so a whole-bus stop cut the note the player was
 * holding down and every arp voice on that bus. `'sequencer'` is pinned here,
 * not passed in: `src/components/` may not import the engine and must not pick
 * an owner, and this module's callers are all the transport.
 */
export function playbackStopOwnedVoices(
  source: string,
  releaseTime = 0.1,
  time?: number,
): void {
  audioEngine.stopOwnedVoices(source, 'sequencer', releaseTime, time);
}
```

Leave `playbackStopSource` in place — the chord/bass/pad players and `ACCOMPANIMENT_SOURCES` still mean the whole bus.

- [ ] **Step 7: Move `useLeadPlayback`'s two stop paths**

In `src/components/loop/lead/useLeadPlayback.ts`, swap the import and both call sites — the hard stop and the bar-boundary stop:

```ts
          playbackStopOwnedVoices(track.engineSource, HARD_STOP_RELEASE);
```
```ts
        playbackStopOwnedVoices(track.engineSource, params.release, time);
```

Drop `playbackStopSource` from the import list **only if** no other site in the file still uses it; check with `grep -n "playbackStopSource" src/components/loop/lead/useLeadPlayback.ts` after the edit, since an unused import is an eslint error and the gate is zero warnings.

- [ ] **Step 8: Run the tests**

Run: `bun test src/audio/playback/arpPlayback.test.ts && bun test src/components/loop/lead`
Expected: PASS. If a `useLeadPlayback` test asserts `toHaveBeenCalledWith` on a `stopSource` spy, it now needs to spy on `stopOwnedVoices` and expect the `'sequencer'` argument — that is a real behaviour change and the expectation should be updated to state it, not loosened.

- [ ] **Step 9: Full gate**

Run: `bun run verify`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(audio): an arp key-up and a melody-grid stop stay in their lane

Two defects close here. The arp's cleanup now releases only 'arp' voices,
so a key-up stops cutting short a melody track's note sounding on the
same bus — the KNOWN LIMITATION comment that named this is deleted rather
than reworded, because it is no longer true. And useLeadPlayback's two
stop paths call the new playbackStopOwnedVoices, which pins 'sequencer',
so stopping a grid no longer cuts a held key or an arp note.

releaseTriggeredTargets hands 'arp' to its injected callback instead of
taking it as a parameter: every target in the set is there because the
arp triggered on it. A two-parameter callback stays assignable, so
useInputDeck keeps passing releaseSynthPlaybackVoices and no file in
src/components/ names an owner.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The prose

Two engine comments and two docs. Each records something a future reader would otherwise have to re-derive or would wrongly "fix".

**Files:**
- Modify: `src/audio/engine.ts` (the `activeVoices` field declaration; `applySynthVelocityScale`'s docblock)
- Modify: `CLAUDE.md` (the `## Architecture` section)
- Modify: `.claude/skills/dsp-audio/SKILL.md` ("Voices and per-source buses")

**Interfaces:**
- Consumes: everything from Tasks 1–5. Produces no code.

- [ ] **Step 1: Record the deferred one-voice-slot limitation at `activeVoices`**

At the cause, in `src/audio/engine.ts`, extending the existing comment on the `activeVoices` / `sourceVoices` field pair:

```ts
  // Active voices tracking. activeVoices keys `${source}:${noteName}` and only
  // keeps the LATEST voice per key; sourceVoices keeps every live or still-
  // scheduled voice per source so a whole layer can be silenced at once.
  //
  // DEFERRED, deliberately: keying by source and note means two OWNERS on one
  // bus share one voice slot. If the melody grid plays C4 on 'synth' while a
  // key holding C4 is down, the dedup at the top of triggerSynthNoteOn releases
  // the held note's voice. The note is CUT SHORT, not left droning — the dedup
  // releases the older voice correctly — which is why this is a musical wart
  // and not a stuck-voice bug. Giving each owner its own slot means revisiting
  // the same-note dedup, the bass mono-kill, voice stealing and
  // updateSynthParams, all of which the existing tests pin to today's one-slot
  // behaviour; that is a larger change than per-voice provenance justified.
  // Recorded HERE, at the cause, not at the arp, which is merely one place it
  // can be noticed.
  private activeVoices = new Map<string, SynthVoice>();
```

- [ ] **Step 2: Record why `applySynthVelocityScale` needs no owner filter**

Appended to its existing docblock, so a reader does not have to conclude it was forgotten:

```ts
   * No OWNER filter, and that is not an oversight. It already skips every voice
   * with a planned release, and sequenced voices always have one —
   * playbackNoteOff schedules the release at scheduling time — so equal-power
   * polyphony from a keyboard hold already cannot re-shape the sequencer's
   * notes. The `source` narrowing above is what this method needed; provenance
   * adds nothing on top of it.
```

- [ ] **Step 3: Update `.claude/skills/dsp-audio/SKILL.md`**

In "Voices and per-source buses", replace the `stopSource()` / `releaseSoundingVoices()` bullet — its "(used for arp key-release)" is now incomplete, since the interesting property is no longer only *which voices in time* but *whose voices* — and extend the `triggerSynthNoteOn` bullet:

```markdown
- `triggerSynthNoteOn(noteName, params, velocity, time, source='synth', scaleFactor=1, owner)`.
  Sources in use: `'synth'`, `'fx'`, `'chord'`, `'bass'`, `'pad'`, `'preview'`. `owner` is a
  `VoiceOwner` (`src/audio/voiceOwner.ts`: `live` / `arp` / `sequencer` / `preview`), is
  **required with no default**, and is stored on the voice. The bridges in `audio/playback/`
  choose it; nothing in `src/components/` names an owner.
- Three release methods, and picking the wrong one is audible. `stopSource(source, …)` kills
  EVERYTHING on the bus including future-scheduled hits and whoever created them — what a
  project install, a loop load or a vibe swap means. `stopOwnedVoices(source, owner, …)` is that
  narrowed to one player, which is what a melody-grid stop means, because live input and the arp
  share the melodic buses. `releaseSoundingVoices(source, releaseTime, owner)` releases only that
  owner's STARTED voices and leaves its future-scheduled hits alone — the arp key-release path.
  All three take the owner (or pointedly do not) as a required argument: whole-bus reach must
  never be reachable by leaving one off, which is how the pre-provenance defect existed.
- One voice slot per `${source}:${noteName}` is still shared BETWEEN owners — see the deferred
  note at `activeVoices` in `engine.ts`. Two players sounding the same note on one bus cut each
  other short; that is known, and not what provenance fixed.
```

- [ ] **Step 4: Add the `## Architecture` paragraph to `CLAUDE.md`**

Place it immediately after the paragraph beginning "**The keyboard, the on-screen keyboard and the arp all play whichever track `focusTrack` names…**", which is the routing rule it qualifies. No version numbers, no file counts, no line numbers:

```markdown
**Every voice records the PLAYER that created it, and a release names one.** `SynthVoice` carries
an `owner: VoiceOwner` from `src/audio/voiceOwner.ts` — `live`, `arp`, `sequencer`, `preview` —
written at the engine's single voice-construction site and **required with no default** at
`triggerSynthNoteOn`. Three players share each melodic bus (live input, the arp, the melody-track
sequencer), so an owner-blind release is a bug rather than a shortcut: an arp key-up used to cut
short a melody track's sounding note, and a melody-grid stop used to cut the key the player was
holding. `releaseSoundingVoices(source, releaseTime, owner)` and
`stopOwnedVoices(source, owner, …)` are the scoped calls; `stopSource` keeps its whole-bus meaning
for a project install, a loop load and a vibe swap, which genuinely mean "silence this bus,
whatever is on it". **Whole-bus reach therefore requires calling a method whose name says so, and
can never be reached by omitting an argument** — which is exactly how the defect came to exist,
and the same scar `applySynthVelocityScale`'s required `source` carries. The owner is chosen by
the bridges in `src/audio/playback/` and **no file in `src/components/` names one**, so the
layering rules do not move and a view cannot pick the wrong owner. What is NOT fixed: `activeVoices`
is still keyed `` `${source}:${noteName}` `` and keeps one voice per key, so two players sounding
the same note on one bus still cut each other short — recorded as a comment at `activeVoices`, at
the cause, and deliberately deferred because unpicking it means revisiting the same-note dedup,
the bass mono-kill, voice stealing and `updateSynthParams` together.
```

- [ ] **Step 5: Check the docs against the code you actually shipped**

```bash
grep -rn "releaseSoundingVoices\|stopOwnedVoices\|stopSource" .claude/skills/dsp-audio/SKILL.md CLAUDE.md
grep -n "owner" src/audio/engine.ts | head -20
```
Confirm every signature quoted in the two docs matches the source exactly — parameter names and order included. A doc that quotes a stale argument order is worse than one that quotes none.

- [ ] **Step 6: Full gate**

Run: `bun run verify`
Expected: all green. `check:theme`, `check:keys`, `check:drums`, `check:contrast` and `check:levels` are untouched by this change; if any of them fails, the failure is unrelated and must not be papered over here.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs(audio): record the provenance rules and the deferred voice slot

Four pieces of prose, each stopping a future reader from re-deriving or
"fixing" something decided here. The shared one-voice-slot limitation
goes at activeVoices — at its cause, not at the arp, which was merely
where it got noticed. applySynthVelocityScale says why it needs no owner
filter (it already skips voices with a planned release, and sequenced
voices always have one). CLAUDE.md's Architecture section gains the rule
and its "no default, ever" reasoning. The dsp-audio skill's release
bullet is rewritten: "releaseSoundingVoices leaves future hits alone
(used for arp key-release)" no longer describes the interesting half of
the choice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review record

Run after the plan was written, against the spec, with the findings fixed inline.

**1. Spec coverage.** Every spec section maps to a task: the owner roster → Task 1; `SynthVoice.owner` and `triggerSynthNoteOn` → Task 2; `releaseSoundingVoices` → Task 3; `stopOwnedVoices`, the shared private helper and `stopSource`'s unchanged whole-bus meaning → Task 4; the owner table and both behaviour fixes, including the deleted KNOWN LIMITATION → Task 5; "what this deliberately does not fix", the `applySynthVelocityScale` note and the docs → Task 6. The spec's five testing bullets are all placed: the two owner-scoping cases in Tasks 3 and 4, the future-scheduled survivor in Task 4, verify-by-deletion in Tasks 3 and 4, `releaseTriggeredTargets` in Task 5, the roster agreement in Task 1. The gate is in Global Constraints.

**2. Findings fixed inline.**
- **TS1016.** A required `owner` cannot follow `time?: number`. Task 2 now changes it to `time: number | undefined` and explains why that is safe. Without this the first task would not compile and the executor would be tempted to give `owner` a default — the one thing the spec forbids.
- **Dead defaults.** `releaseSoundingVoices`'s `releaseTime = 0.1` is unreachable once a required parameter follows it, so Task 3 drops it rather than leaving an option no caller has.
- **Positional `ctx._gains` indexing.** Each voice creates three gains and the first voice of a source also creates the tap and the bus, so the second voice's main gain sits at no stable index. Every new multi-voice test reaches voices through `sourceVoices` and picks by `.owner`.
- **Same-note dedup.** Two voices named `C4` on one bus would have the first released before the assertion ran. Every new two-voice test uses two note names and says why.
- **Spies and fakes are not covered by `tsc`.** A `mockImplementation` with too few parameters compiles and silently drops the owner, so Task 2 Step 6 handles them separately from the compile-error sweep, and Step 7 greps for `as any` casts — one of which already exists in `engine.test.ts`.
- **`releaseTriggeredTargets`'s shape.** Taking an `owner` parameter would either be an option no caller may vary or force `releaseSynthPlaybackVoices` to accept one, which the spec forbids. It hands `'arp'` to its callback instead; a two-parameter callback stays assignable, so no component names an owner. The reasoning is written into Task 5 rather than only its conclusion.

**3. Type consistency.** `VoiceOwner` and `VOICE_OWNERS` are spelled the same in Tasks 1–6. `triggerSynthNoteOn`'s owner is the 7th parameter everywhere it appears. `releaseSoundingVoices(source, releaseTime, owner)` has the owner third in Task 3, Task 5 and Task 6's docs. `stopOwnedVoices(source, owner, releaseTime, time?)` has the owner **second** — matching the spec, and deliberately different from `releaseSoundingVoices` because `releaseTime` there has a default that must stay ahead of the optional `time`; every use in Tasks 4, 5 and 6 follows that order. `playbackStopOwnedVoices(source, releaseTime, time?)` mirrors `playbackStopSource`'s arity so the `useLeadPlayback` call sites change by name only. `stopVoicesOf` is named identically in its definition and both delegations.

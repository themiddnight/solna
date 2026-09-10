# Focus Track — Plan 1: The State Model and the Surfaces That Only Read It

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace solna's two independent "what am I working on" values — `controlTarget` (synth slice) and `patternSegment` (ui slice) — with one persisted `focusTrack: MixLayerId` in the ui slice, plus two pure projections back into the old vocabularies, and rewire every surface that merely *reads* focus (Sound's panels and target row, Pattern's gate and segment row, the mixer rows, a new always-visible dock chip and the dock's panel auto-switch) and the solo-clearing table. **The keyboard still plays Lead regardless of focus at the end of this plan** — `KEYBOARD_AUDITION_TARGET` in `src/components/useInputDeck.ts` is a module constant that reads no store field, so it is untouched here and closed by Plan 2. That is what makes this plan shippable on its own.

**Architecture:** One store-side table file, `src/store/focusTrack.ts`, owns the focus roster and every translation out of it. `PatternSegment` and `SynthControlTarget` survive as *types* and as the *return types* of pure functions; neither is a store field any more. Every consuming surface reads `focusTrack` and calls a projection — no surface re-derives a mapping, and no surface holds a second navigation value. Persistence is a straight swap of one `partializeAppState` entry plus a **new** validation clause; there is no migration chain and no version bump.

**Tech Stack:** TypeScript, React 19, Zustand (`persist` + `subscribeWithSelector`), Bun test runner (`bun:test`, `renderToString` from `react-dom/server`), Vite, Tailwind v4 + daisyUI v5, ESLint 9 flat config.

**Spec:** `docs/superpowers/specs/2026-09-10-focus-track-design.md` — this plan covers **only** its "Plan 1" from the `## Scope — this is five sequenced plans, not one` section. Voice routing (Plan 2), Rec (Plan 3), MIDI (Plan 4) and preview length (Plan 0) are out of scope here.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`bun run verify` is the completion gate** — run it before claiming any task is done. It runs `bun test`, `bun run lint`, `bun run eslint`, `check:keys`, `check:drums`, `check:contrast`, `check:levels` and `build`.
- **`bun run eslint` must report nothing at all — zero errors AND zero warnings.** That is the state to keep it in. A new `eslint-disable` line must name its reason.
- **`src/components/` must not import `audio/engine`.** The allowlist is in `eslint.config.js`; this plan adds nothing to it.
- **`src/store/` must not import `components/`.** `no-restricted-imports` bans the whole group for `src/store/**/*.{ts,tsx}`, and it is not relaxed for type-only imports — only `**/*.test.ts` / `**/*.test.tsx` are exempt.
  - **Consequence this plan must satisfy, decided here:** `MIX_LAYER_IDS` / `MixLayerId` live in `src/components/mixLayers.ts` today, and `focusTrack.ts` must live in `src/store/` (the spec pins it there, beside `melodyTracks.ts` and `sourceBuses.ts`). A store file therefore **cannot** import the roster from `components/`. **The roster's canonical declaration moves to `src/store/focusTrack.ts`, and `src/components/mixLayers.ts` re-exports it** so every existing importer (`SoundMixer.tsx`, `fxBus.test.ts`) keeps compiling unchanged. This is the `melodyTracks.ts` / `sourceBuses.ts` precedent exactly: a store-side table with no runtime import, which `src/components/` may read under layering rule 4.
- **`src/data/` imports nothing at runtime** and declares no function. Nothing in this plan touches `src/data/`.
- **No DOM and no testing-library**, and none may be added. Prefer a pure exported helper over a render; where markup *is* the behaviour, use `renderToString` substring assertions written as single literal substrings.
- **The zustand + `renderToString` trap:** zustand serves `getServerSnapshot` from `api.getInitialState()`, captured at store creation, so `useAppStore.setState(...)` before a `renderToString` silently has no effect. **Any component whose markup must reflect a test-set `focusTrack` reads the store through `useLiveStore`** (`src/components/ui/useLiveStore.ts`).
- **No migration chains.** `PERSIST_VERSION` is not bumped and `PROJECT_FORMAT_VERSION` is not touched. Old `controlTarget` / `patternSegment` keys in a persisted payload are ignored — not read, not translated, not carried forward.
- **`focusTrack` is not project content.** `PROJECT_CONTENT_KEYS` stays `['bpm','meterId','masterVolume','effects','loops']`; `sanitizeContent` in `projectFile.ts` is untouched.
- **Storage lags the store by up to one idle window** — call `flushPersistedWrites()` before any assertion that reads `localStorage`.
- **Feature work never lands as a commit on `main`.** Branch first: `feat/focus-track-state-model` (`<type>/<name>`, kebab-case).
- **Commit messages are conventional commits** and end with the trailer:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **A docblock or a CLAUDE.md sentence this change falsifies is rewritten in the same commit that falsifies it.** No doc-sync commit at the end — that is how a false sentence survives a review that had the code in front of it.

## What this plan deliberately leaves broken

Spec symptom (a) — *"selecting FX on Sound and playing the keyboard sounds Lead"* — **is still present when this plan ships, on purpose.**

`KEYBOARD_AUDITION_TARGET` in `src/components/useInputDeck.ts` is a module constant of `'synth'` that reads no store field. Deleting `controlTarget` does not disturb it, and this plan does not touch it, `useInputDeck.ts`, `src/audio/playback/arpPlayback.ts`, `src/store/leadRecord.ts` or `src/store/midiInput.ts` at all. At the end of this plan the app has **one honest navigation state and a keyboard that still plays Lead** — visibly incomplete, never broken. The arp's `ArpStateRef.controlTarget` field and `useInputDeck.test.tsx`'s `controlTarget: 'synth' as const` fixture are that hook's own local vocabulary, not the store field, and stay exactly as they are.

Plan 2 closes it. Two comments in the code say so and are kept honest by Task 4 and Task 9.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/store/focusTrack.ts` | The focus roster (`MIX_LAYER_IDS` / `MixLayerId`), its membership guard, the melodic narrowing, and every projection out of a focus into another vocabulary. Imports nothing at runtime. |
| `src/store/focusTrack.test.ts` | Direct tests of all six exports, against literal expected maps. |
| `src/store/focusPanelSync.ts` | The one subscription that switches the input dock's panel when focus crosses the melodic/drum line, plus its pure `panelModeForFocus` helper. |
| `src/store/focusPanelSync.test.ts` | Tests for both. |

**Modified**

| Path | Change |
|---|---|
| `src/components/mixLayers.ts` | Roster declaration deleted; re-exported from `@/store/focusTrack`. |
| `src/store/types.ts` | `focusTrack` / `setFocusTrack` on `UiSlice`; `focusTrack` on `PersistedState`; `controlTarget` / `setControlTarget` off `SynthSlice`; `patternSegment` / `setPatternSegment` off `UiSlice`; `controlTarget` off `PersistedState`. |
| `src/store/uiSlice.ts` | `focusTrack: 'synth'` + `setFocusTrack`; `patternSegment` / `setPatternSegment` deleted; docblock rewritten. |
| `src/store/synthSlice.ts` | `controlTarget` / `setControlTarget` deleted; docblock rewritten. |
| `src/store/store.ts` | `partializeAppState` swaps `controlTarget` for `focusTrack`; `sanitizePersistedState` gains a new `focusTrack` clause. |
| `src/store/soloNav.ts` | `patternSegment` dropped from `SOLO_NAV_SOURCES`; docblock rewritten. |
| `src/store/trackAudibility.ts` | `soloTrackForControlTarget` → `soloTrackForFocus`. |
| `src/store/melodyTracks.ts` | The `s.controlTarget` sentence in the `Assert` docblock. |
| `src/store/projectFormat.ts` | The `controlTarget` sentence in `applyProjectContent`'s docblock. |
| `src/utils/synthControl.ts` | `SynthTargetNavigation.setControlTarget` → `setFocusTrack`; `focusSynthTarget` signature. |
| `src/types.ts` | Two docblocks that call the segment a second axis. |
| `src/components/loop/synth/useSynthChannel.ts` | Reads `focusTrack` through the projection. |
| `src/components/loop/SoundView.tsx` | Focus row moves out of the Synth card and gains a sixth chip; Synth section and Drum Sound card gate on focus. |
| `src/components/loop/PatternView.tsx` | Gate reads `segmentForFocus`; exports `segmentVisibilityClass`. |
| `src/components/ui/SegmentHeader.tsx` | Active-segment check reads focus. |
| `src/components/ui/SegmentedControl.tsx` | `PatternSegmentRow` reads focus and writes `setFocusTrack`. |
| `src/components/ui/SoloButton.tsx` | Docblock. |
| `src/components/ui/GroupFrame.tsx` | Docblock. |
| `src/components/loop/SoundMixer.tsx` | Row label becomes a focus button. |
| `src/components/loop/chord/AdjustSynthButton.tsx` | Writes `setFocusTrack`. |
| `src/components/ui/BottomInputDock.tsx` | Always-visible focus chip. |
| `src/App.tsx` | Mounts `useFocusPanelSync()`; one comment. |
| `CLAUDE.md` | The `PatternView.tsx` gate sentence and the whole solo-clearing paragraph. |

---

### Task 1: `src/store/focusTrack.ts` — the roster and the projections

**Files:**
- Create: `src/store/focusTrack.ts`
- Create: `src/store/focusTrack.test.ts`
- Modify: `src/components/mixLayers.ts:20-25` (the `MIX_LAYER_IDS` / `MixLayerId` declaration)

**Interfaces:**
- Consumes: `PatternSegment` from `@/types`; `SynthControlTarget` from `@/utils/synthControl`; `MelodyTrackId` from `./melodyTracks`. All three are `import type`.
- Produces:
  ```ts
  export const MIX_LAYER_IDS: readonly ['synth', 'fx', 'chord', 'bass', 'pad', 'drum'];
  export type MixLayerId = (typeof MIX_LAYER_IDS)[number];
  export type MelodicFocus = Exclude<MixLayerId, 'drum'>;
  export function isMixLayerId(value: unknown): value is MixLayerId;
  export function isMelodicFocus(focus: MixLayerId): focus is MelodicFocus;
  export function segmentForFocus(focus: MixLayerId): PatternSegment;
  export function focusForSegment(segment: PatternSegment): MixLayerId;
  export function controlTargetForFocus(focus: MelodicFocus): SynthControlTarget;
  export function melodyTrackForFocus(focus: MixLayerId): MelodyTrackId | null;
  ```
  `src/components/mixLayers.ts` continues to export `MIX_LAYER_IDS` and `MixLayerId` under the same names, now by re-export.

- [ ] **Step 1: Branch off `main`**

```bash
git checkout main
git pull
git checkout -b feat/focus-track-state-model
```

- [ ] **Step 2: Write the failing test**

Create `src/store/focusTrack.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  MIX_LAYER_IDS,
  controlTargetForFocus,
  focusForSegment,
  isMelodicFocus,
  isMixLayerId,
  melodyTrackForFocus,
  segmentForFocus,
  type MelodicFocus,
  type MixLayerId,
} from './focusTrack';
import { MELODY_TRACKS } from './melodyTracks';
import { PATTERN_SEGMENT_IDS } from '@/types';

describe('MIX_LAYER_IDS', () => {
  // Exhaustive, not a subset check: this roster is now the FOCUS roster as
  // well as the mixer's, so a layer added without a projection row below is a
  // chip that lights up and a surface that does nothing.
  test('is the six layers in canonical order', () => {
    expect([...MIX_LAYER_IDS]).toEqual(['synth', 'fx', 'chord', 'bass', 'pad', 'drum']);
  });
});

describe('isMixLayerId', () => {
  test('accepts every roster member', () => {
    for (const id of MIX_LAYER_IDS) expect(isMixLayerId(id)).toBe(true);
  });

  // The three shapes a persisted payload can actually carry. `'lead'` is the
  // one that looks plausible: it is the mixer's LABEL for 'synth' and the
  // melody track's id, and it is not a focus id.
  test('rejects a non-member, a non-string and a missing value', () => {
    expect(isMixLayerId('lead')).toBe(false);
    expect(isMixLayerId(7)).toBe(false);
    expect(isMixLayerId(undefined)).toBe(false);
    expect(isMixLayerId(null)).toBe(false);
  });
});

describe('segmentForFocus', () => {
  // Asserted against a literal expected map rather than by re-deriving: a
  // `for` loop that recomputes the mapping proves only that the function
  // equals itself (the DRUM_ALIASES `toEqual` discipline).
  test('maps every focus onto its Pattern segment', () => {
    const actual = Object.fromEntries(MIX_LAYER_IDS.map((id) => [id, segmentForFocus(id)]));
    expect(actual).toEqual({
      synth: 'lead',
      fx: 'fx',
      chord: 'accompaniment',
      bass: 'accompaniment',
      pad: 'accompaniment',
      drum: 'beat',
    });
  });

  test('every result is a real PATTERN_SEGMENT_IDS member', () => {
    for (const id of MIX_LAYER_IDS) {
      expect([...PATTERN_SEGMENT_IDS]).toContain(segmentForFocus(id));
    }
  });
});

describe('focusForSegment', () => {
  // Accompaniment sends `chord`, unconditionally and with no memory of which
  // of the three was last used — see the spec's rejected alternative.
  test('maps every segment onto the focus its button sets', () => {
    const actual = Object.fromEntries(
      PATTERN_SEGMENT_IDS.map((id) => [id, focusForSegment(id)]),
    );
    expect(actual).toEqual({
      lead: 'synth',
      fx: 'fx',
      accompaniment: 'chord',
      beat: 'drum',
    });
  });

  // Round-trip: pressing a segment button must light that same button up.
  test('every segment round-trips through segmentForFocus', () => {
    for (const segment of PATTERN_SEGMENT_IDS) {
      expect(segmentForFocus(focusForSegment(segment))).toBe(segment);
    }
  });
});

describe('isMelodicFocus', () => {
  test('is true for exactly MIX_LAYER_IDS minus drum', () => {
    expect(MIX_LAYER_IDS.filter(isMelodicFocus)).toEqual(['synth', 'fx', 'chord', 'bass', 'pad']);
    expect(isMelodicFocus('drum')).toBe(false);
  });
});

describe('controlTargetForFocus', () => {
  test('maps every melodic focus onto its synth channel', () => {
    const melodic = MIX_LAYER_IDS.filter(isMelodicFocus);
    const actual = Object.fromEntries(melodic.map((id) => [id, controlTargetForFocus(id)]));
    expect(actual).toEqual({
      synth: 'synth',
      fx: 'fx',
      chord: 'chord',
      bass: 'bass',
      pad: 'pad',
    });
  });

  /**
   * The `'drum'` case is a COMPILE-TIME assertion, not a runtime one. A total
   * function returning `'synth'` for `'drum'` is the trap the spec names: it
   * would make the drum focus edit the Lead patch through every knob on the
   * Sound page, consistently and invisibly, because
   * `resolveSynthControlChannel` ends in `?? channels.synth` and swallows it.
   *
   * `Assert<T extends true>` is what makes this real — the melodyTracks.ts
   * pattern. A bare `X extends Y ? true : never` alias resolves to `never`
   * with nothing consuming it and no error at all.
   */
  test('refuses a drum focus by type', () => {
    type Assert<T extends true> = T;
    type _DrumIsNotMelodic = Assert<'drum' extends MelodicFocus ? false : true>;
    type _MelodicIsEveryOtherLayer = Assert<
      Exclude<MixLayerId, 'drum'> extends MelodicFocus ? true : false
    >;
    // The types above are the assertion; this keeps the test body non-empty
    // and the two aliases referenced so no-unused-vars stays quiet.
    const witness: MelodicFocus[] = ['synth', 'fx', 'chord', 'bass', 'pad'];
    expect(witness).toHaveLength(MIX_LAYER_IDS.length - 1);
  });
});

describe('melodyTrackForFocus', () => {
  test('maps the two melody focuses onto track ids and the rest onto null', () => {
    const actual = Object.fromEntries(MIX_LAYER_IDS.map((id) => [id, melodyTrackForFocus(id)]));
    expect(actual).toEqual({
      synth: 'lead',
      fx: 'fx',
      chord: null,
      bass: null,
      pad: null,
      drum: null,
    });
  });

  // Cross-checked against MELODY_TRACKS so a renamed track fails HERE rather
  // than leaving a projection pointing at an id no table has.
  test('every non-null result names a real MELODY_TRACKS row', () => {
    const ids = MELODY_TRACKS.map((t) => t.id);
    for (const focus of MIX_LAYER_IDS) {
      const track = melodyTrackForFocus(focus);
      if (track !== null) expect(ids).toContain(track);
    }
  });
});
```

- [ ] **Step 3: Run the test and see it fail**

Run: `bun test src/store/focusTrack.test.ts`
Expected: FAIL — `error: Cannot find module './focusTrack'`.

- [ ] **Step 4: Write the implementation**

Create `src/store/focusTrack.ts`:

```ts
import type { PatternSegment } from '@/types';
import type { SynthControlTarget } from '@/utils/synthControl';
import type { MelodyTrackId } from './melodyTracks';

/**
 * DOM id prefix, mixer lookup key, and — since the focus-track change — the id
 * of the ONE thing the user is working on. These track the STORE fields
 * (`drumMuted`, `synthVolume`), not the labels, which is why the drum bus is
 * `drum` here and "Beat" on screen, and why `'synth'` means Lead.
 *
 * WHY THIS DECLARATION IS HERE AND NOT IN components/mixLayers.ts, where it
 * used to live: `focusTrack` is store state, so the ui slice, `partialize`,
 * `sanitizePersistedState` and the projections below all name this type — and
 * `src/store/` may not import `src/components/`, not even a type (the
 * `no-restricted-imports` ban is not relaxed for type imports; only test files
 * are exempt). So the roster moved down to the store and `mixLayers.ts`
 * re-exports it. That is the melodyTracks.ts / sourceBuses.ts shape exactly: a
 * store table with no runtime import, which `src/components/` may read.
 *
 * Do NOT rename `'synth'` to `'lead'`. It is a dozen persisted store fields
 * wearing a focus-track change as cover, and the spec puts it out of scope.
 */
export const MIX_LAYER_IDS = ['synth', 'fx', 'chord', 'bass', 'pad', 'drum'] as const;

export type MixLayerId = (typeof MIX_LAYER_IDS)[number];

/**
 * The five focuses that have a synth channel. `Exclude`, not a second literal
 * list, so a layer added to the roster is melodic by default and has to be
 * excluded deliberately.
 */
export type MelodicFocus = Exclude<MixLayerId, 'drum'>;

/**
 * Membership test for the roster, living beside the roster rather than in
 * sanitize.ts: `focusTrack` is persisted and `sanitizePersistedState` needs
 * this, but the roster and the question "is this one of them" are one fact and
 * are written once. sanitize.ts holds the guards for values the `.solna`
 * import path shares; `focusTrack` is a user preference and is not project
 * content, so it has no second reader to keep in step.
 */
export function isMixLayerId(value: unknown): value is MixLayerId {
  return typeof value === 'string' && (MIX_LAYER_IDS as readonly string[]).includes(value);
}

/** Narrows a focus to the five that have a synth channel. */
export function isMelodicFocus(focus: MixLayerId): focus is MelodicFocus {
  return focus !== 'drum';
}

/**
 * A `Record`, not a `switch`: adding a layer to MIX_LAYER_IDS without giving
 * it a segment is then a compile error rather than a Pattern tab that renders
 * four `hidden` divs and nothing else.
 */
const SEGMENT_FOR_FOCUS: Record<MixLayerId, PatternSegment> = {
  synth: 'lead',
  fx: 'fx',
  // Chord, bass and pad are one screen. Accompaniment stays a single segment
  // showing all three, with one of the three focused and marked as such.
  chord: 'accompaniment',
  bass: 'accompaniment',
  pad: 'accompaniment',
  drum: 'beat',
};

/** Which Pattern segment a focus shows. Total — every focus has a segment. */
export function segmentForFocus(focus: MixLayerId): PatternSegment {
  return SEGMENT_FOR_FOCUS[focus];
}

/**
 * The inverse Pattern's segment ROW needs: which focus a segment button sets.
 *
 * It is not a true inverse and cannot be — `accompaniment` covers three
 * focuses — so it is written as its own table rather than derived by searching
 * SEGMENT_FOR_FOCUS, which would return whichever of the three came first and
 * make the choice an artefact of key order.
 *
 * `accompaniment` sends `chord`, UNCONDITIONALLY. There is no memory of which
 * of the three was last used, and adding one is explicitly rejected (spec,
 * Open risks 3): it would only ever fire when focus leaves the accompaniment
 * group and returns through this button, and it would cost a second invisible
 * navigation state in a change whose whole purpose is deleting invisible
 * navigation state.
 */
const FOCUS_FOR_SEGMENT: Record<PatternSegment, MixLayerId> = {
  lead: 'synth',
  fx: 'fx',
  accompaniment: 'chord',
  beat: 'drum',
};

/** Which focus a Pattern segment button sets. */
export function focusForSegment(segment: PatternSegment): MixLayerId {
  return FOCUS_FOR_SEGMENT[segment];
}

/**
 * Which synth channel a focus edits. PARTIAL BY TYPE, not by fallback: its
 * parameter is `MelodicFocus`, so "what is the synth channel for the drum
 * focus" is a question the compiler refuses to let a caller ask.
 *
 * A total version returning `'synth'` for `'drum'` is the trap.
 * `resolveSynthControlChannel` (utils/synthControl.ts) ends in
 * `channels[target] ?? channels.synth`, so a `'drum'` that reached it would
 * not throw, would not warn and would not render wrong — it would silently
 * point every knob on the Sound page at the Lead patch. Do not remove that
 * `??` either: it still guards that function's other callers, and removing it
 * converts a swallowed mistake into a crash without making the mistake less
 * possible. Sanitizing `focusTrack` at the persistence boundary removes the
 * out-of-roster case; this signature removes the legal-but-wrong `'drum'` one.
 *
 * The body is the identity because `MelodicFocus` and `SynthControlTarget` are
 * the same five literals — asserted below, so a drift between the two unions
 * is a build error rather than a channel lookup that quietly falls back.
 */
export function controlTargetForFocus(focus: MelodicFocus): SynthControlTarget {
  return focus;
}

/**
 * `Assert<T extends true>` — the melodyTracks.ts pattern. Instantiating it with
 * a condition that resolves to `false` fails the `extends true` constraint and
 * is a real compile error, unlike a bare conditional alias which resolves to
 * `never` with nothing consuming it.
 */
type Assert<T extends true> = T;
/* eslint-disable @typescript-eslint/no-unused-vars -- these two aliases ARE the
   assertion; consuming them at runtime would defeat the point. */
type _AssertMelodicIsControlTarget = Assert<
  MelodicFocus extends SynthControlTarget ? true : false
>;
type _AssertControlTargetIsMelodic = Assert<
  SynthControlTarget extends MelodicFocus ? true : false
>;
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * The bridge into MELODY_TRACKS. `null` for the four focuses that are not a
 * melody track, so a caller has to handle "there is no track here" rather than
 * being handed Lead by default — Rec (plan 3) and the melody grids read this.
 */
const MELODY_TRACK_FOR_FOCUS: Record<MixLayerId, MelodyTrackId | null> = {
  synth: 'lead',
  fx: 'fx',
  chord: null,
  bass: null,
  pad: null,
  drum: null,
};

/** Which melody track a focus names, or `null` if it names none. */
export function melodyTrackForFocus(focus: MixLayerId): MelodyTrackId | null {
  return MELODY_TRACK_FOR_FOCUS[focus];
}
```

- [ ] **Step 5: Run the test and see it pass**

Run: `bun test src/store/focusTrack.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 6: Point `mixLayers.ts` at the moved roster**

In `src/components/mixLayers.ts`, replace the `MIX_LAYER_IDS` / `MixLayerId` declaration (the docblock plus the two lines at 20-25) with:

```ts
/**
 * The layer roster is declared in `@/store/focusTrack` and re-exported here.
 * It moved down because `focusTrack` is store state and `src/store/` may not
 * import `src/components/` — see the docblock there. Every existing importer
 * of `MIX_LAYER_IDS` / `MixLayerId` from this module keeps working unchanged;
 * the mixer is now one of two readers of the roster rather than its owner.
 */
export { MIX_LAYER_IDS } from '@/store/focusTrack';
export type { MixLayerId } from '@/store/focusTrack';
```

and add, at the top of the import block (the file's own `MixLayer` interface still names the type):

```ts
import type { MixLayerId } from '@/store/focusTrack';
```

- [ ] **Step 7: Run the affected suites and the type-check**

Run: `bun test src/store/fxBus.test.ts src/components/loop/SoundMixer.test.ts src/store/focusTrack.test.ts && bun run lint`
Expected: PASS, and `tsc --noEmit` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add src/store/focusTrack.ts src/store/focusTrack.test.ts src/components/mixLayers.ts
git commit -m "$(cat <<'EOF'
feat(focus): the focus roster and its projections

MIX_LAYER_IDS moves from components/mixLayers.ts to the new
store/focusTrack.ts, which also holds segmentForFocus, focusForSegment,
controlTargetForFocus (typed over MelodicFocus so a drum focus cannot be
asked for a synth channel) and melodyTrackForFocus. mixLayers.ts
re-exports the roster, so every existing importer is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `focusTrack` in the ui slice, and its persistence

**Files:**
- Modify: `src/store/uiSlice.ts:64-86` (the slice docblock and the initial-state block)
- Modify: `src/store/types.ts:370-380` (`UiSlice` fields), `src/store/types.ts:420-425` (`UiSlice` actions), `src/store/types.ts:614-622` (`PersistedState`)
- Modify: `src/store/store.ts:183-199` (`partializeAppState`), `src/store/store.ts:280-360` (`sanitizePersistedState`)
- Test: `src/store/store.test.ts` (the `allow-list keeps every persisted field` test at ~455, plus a new `focusTrack` describe block)

**Interfaces:**
- Consumes: `MixLayerId`, `isMixLayerId` from `./focusTrack` (Task 1).
- Produces:
  ```ts
  // on AppStore (UiSlice)
  focusTrack: MixLayerId;
  setFocusTrack: (focus: MixLayerId) => void;
  // on PersistedState
  focusTrack: MixLayerId;
  ```
  Creation-time value is `'synth'`. `controlTarget` and `patternSegment` still exist as live fields at the end of this task; `controlTarget` is no longer persisted.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/store.test.ts`:

```ts
describe('focusTrack', () => {
  test('starts on synth — Lead, the track a new loop is most likely opened for', async () => {
    const { useAppStore } = await getStore();
    expect(useAppStore.getState().focusTrack).toBe('synth');
  });

  test('the setter moves it and nothing else', async () => {
    const { useAppStore } = await getStore();
    useAppStore.getState().setFocusTrack('drum');
    expect(useAppStore.getState().focusTrack).toBe('drum');
    expect(useAppStore.getState().activeTab).toBe('sound');
    useAppStore.getState().setFocusTrack('synth');
  });
});

describe('focusTrack persistence', () => {
  /**
   * `controlTarget` was persisted with NO sanitize clause at all — nothing
   * validated it on read, and `resolveSynthControlChannel`'s trailing
   * `?? channels.synth` was standing in for the validation. That fallback
   * becomes a trap once the roster includes 'drum', so the clause below is
   * written from nothing; there is no old clause to rename.
   */
  test('sanitize maps a missing, non-string or out-of-roster focusTrack to synth', async () => {
    const { sanitizePersistedStateForTest } = await getStore();
    expect(sanitizePersistedStateForTest({}).focusTrack).toBe('synth');
    expect(sanitizePersistedStateForTest({ focusTrack: 7 }).focusTrack).toBe('synth');
    expect(sanitizePersistedStateForTest({ focusTrack: 'lead' }).focusTrack).toBe('synth');
    expect(sanitizePersistedStateForTest({ focusTrack: null }).focusTrack).toBe('synth');
  });

  test('sanitize leaves a valid focusTrack untouched, including drum', async () => {
    const { sanitizePersistedStateForTest } = await getStore();
    expect(sanitizePersistedStateForTest({ focusTrack: 'fx' }).focusTrack).toBe('fx');
    expect(sanitizePersistedStateForTest({ focusTrack: 'drum' }).focusTrack).toBe('drum');
  });

  /**
   * The old keys are simply ignored — not read, not translated, not carried
   * forward (CLAUDE.md: no migration chains). A user who had FX selected on
   * Sound reopens on Lead; that is one click.
   */
  test('an old payload carrying controlTarget/patternSegment yields neither, and focusTrack synth', async () => {
    const { sanitizePersistedStateForTest } = await getStore();
    const out = sanitizePersistedStateForTest({ controlTarget: 'bass', patternSegment: 'beat' });
    expect(out.focusTrack).toBe('synth');
  });
});
```

And in the existing `allow-list keeps every persisted field and no ui/playing/actions leak` test, replace `'controlTarget',` in `persistedKeys` with `'focusTrack',`, and add `'controlTarget',` to `excludedKeys` beside the existing `'patternSegment',` entry.

`sanitizePersistedStateForTest` does not exist yet — Step 3 exports it.

- [ ] **Step 2: Run the tests and see them fail**

Run: `bun test src/store/store.test.ts -t "focusTrack"`
Expected: FAIL — `expect(received).toBe(expected)` with `received: undefined` on the first assertion, and `TypeError: sanitizePersistedStateForTest is not a function` on the persistence block.

- [ ] **Step 3: Add the field, the action, the types and the persistence**

In `src/store/types.ts`, add to `UiSlice` immediately above `patternSegment`:

```ts
  /**
   * The ONE "what am I working on" value: which track Sound's panels edit and
   * which grid Pattern shows. Its id type is the mixer's roster, deliberately
   * — the app already had four vocabularies for "a track" and a fifth would
   * guarantee a fifth translation table. `'synth'` means Lead.
   *
   * Unlike the rest of this slice it IS persisted, top-level, exactly where
   * `controlTarget` was: it is a user preference that should survive a reload.
   * It is NOT project content — `PROJECT_CONTENT_KEYS` excludes it for the
   * same reason it excluded `controlTarget`.
   */
  focusTrack: MixLayerId;
```

and to `UiSlice`'s actions, immediately above `setPatternSegment`:

```ts
  setFocusTrack: (focus: MixLayerId) => void;
```

Add `import type { MixLayerId } from './focusTrack';` to that file's type imports. In `PersistedState`, replace the `controlTarget: SynthControlTarget;` line with `focusTrack: MixLayerId;`.

In `src/store/uiSlice.ts`, add `focusTrack: 'synth',` immediately above `patternSegment: 'lead',` and `setFocusTrack: (focusTrack) => set({ focusTrack }),` immediately above `setPatternSegment`.

In `src/store/store.ts`'s `partializeAppState`, replace `controlTarget: state.controlTarget,` with `focusTrack: state.focusTrack,`.

In `sanitizePersistedState`, immediately after the `sanitized.metronomeActive = asBoolean(...)` line, add:

```ts
  // A NEW clause, written from nothing: `controlTarget` — the key focusTrack
  // replaces — was persisted with no validation at all, so there is nothing
  // here to rename. What stood in for it was `resolveSynthControlChannel`'s
  // trailing `?? channels.synth`, a runtime fallback that quietly absorbed any
  // out-of-roster value. That fallback becomes a TRAP now the roster includes
  // 'drum': a drum focus leaking into the synth path is not an error, not a
  // warning and not a visible mis-render — it silently points every Sound-page
  // knob at the Lead patch. Sanitizing here removes the bad-value case
  // altogether; typing controlTargetForFocus over MelodicFocus removes the
  // legal-but-wrong 'drum' one. Both, or the `??` goes on swallowing it.
  sanitized.focusTrack = isMixLayerId(sanitized.focusTrack) ? sanitized.focusTrack : 'synth';
```

Add `import { isMixLayerId } from './focusTrack';` to `store.ts`. Export the function for the tests by changing its declaration line to keep the name but adding a test seam beneath it:

```ts
/**
 * Test seam. `sanitizePersistedState` is internal to the persist wiring; this
 * export is what lets store.test.ts assert a clause directly instead of
 * round-tripping a payload through localStorage and the merge.
 */
export function sanitizePersistedStateForTest(persisted: unknown): Partial<AppStore> {
  return sanitizePersistedState(persisted);
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `bun test src/store/store.test.ts`
Expected: PASS — including the amended allow-list test.

- [ ] **Step 5: Rewrite the ui slice's docblock, which this falsifies**

`createUiSlice`'s docblock currently ends "The Pattern segment is a sibling of it: also transient, but not in the URL, because a segment is a position inside a tab rather than a route." Replace that final sentence with:

```
 * `focusTrack` is the exception in this slice: it IS persisted, top-level,
 * in the place `controlTarget` used to occupy — which track you were working
 * on is a preference worth surviving a reload, and it is validated on read
 * (sanitizePersistedState) rather than carried through a migration chain. The
 * Pattern segment is no longer a field at all: it is `segmentForFocus(focus)`,
 * derived at each of the three surfaces that show it.
```

- [ ] **Step 6: Verify and commit**

Run: `bun run lint && bun test src/store/`
Expected: `tsc --noEmit` silent; store suite green.

```bash
git add src/store/uiSlice.ts src/store/types.ts src/store/store.ts src/store/store.test.ts
git commit -m "$(cat <<'EOF'
feat(focus): focusTrack in the ui slice, persisted in controlTarget's place

partializeAppState swaps the controlTarget entry for focusTrack, and
sanitizePersistedState gains a clause that maps a missing, non-string or
out-of-roster value to 'synth'. That clause is new, not an edit: controlTarget
was persisted with no validation at all. No PERSIST_VERSION bump — the old
keys are simply ignored.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Sound's synth panels follow focus

**Files:**
- Modify: `src/components/loop/synth/useSynthChannel.ts:27-49`
- Test: `src/components/loop/SimpleSynthPanel.test.tsx` (new describe block)

**Interfaces:**
- Consumes: `controlTargetForFocus`, `isMelodicFocus` from `@/store/focusTrack` (Task 1); `focusTrack` on the store (Task 2).
- Produces: `useSynthChannel(): SynthChannel` — signature unchanged (`{ params, onChangeParams }`). Its channel now follows `focusTrack`; on a `drum` focus it returns the Lead channel, and the section that calls it is not rendered in that state (Task 4).

- [ ] **Step 1: Write the failing test**

Append to `src/components/loop/SimpleSynthPanel.test.tsx`:

```ts
import { useAppStore } from '@/store/store';

describe('the synth panels follow focusTrack', () => {
  // A pure assertion on the hook's own resolution, driven through the store
  // rather than a render: useSynthChannel is a hook, but its whole body is a
  // lookup, and the store's getState() is the input.
  test('the FX focus resolves the FX patch, not the Lead one', () => {
    useAppStore.setState({ focusTrack: 'fx' });
    const s = useAppStore.getState();
    expect(resolveChannelForFocus(s)).toBe(s.fxSynthParams);
    useAppStore.setState({ focusTrack: 'bass' });
    expect(resolveChannelForFocus(useAppStore.getState())).toBe(
      useAppStore.getState().bassSynthParams,
    );
    useAppStore.setState({ focusTrack: 'synth' });
  });
});
```

with, at the top of that file:

```ts
import { controlTargetForFocus, isMelodicFocus } from '@/store/focusTrack';
import { resolveSynthControlChannel } from '@/utils/synthControl';
import type { AppStore } from '@/store/types';

// Mirrors useSynthChannel's lookup without the hook, so the resolution can be
// asserted without a render. If the two ever disagree the hook is wrong.
function resolveChannelForFocus(s: AppStore) {
  const target = isMelodicFocus(s.focusTrack) ? controlTargetForFocus(s.focusTrack) : 'synth';
  return resolveSynthControlChannel(target, {
    synth: { params: s.synthParams, setParams: s.setSynthParams },
    chord: { params: s.chordSynthParams, setParams: s.setChordSynthParams },
    bass: { params: s.bassSynthParams, setParams: s.setBassSynthParams },
    pad: { params: s.padSynthParams, setParams: s.setPadSynthParams },
    fx: { params: s.fxSynthParams, setParams: s.setFxSynthParams },
  }).params;
}
```

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/components/loop/SimpleSynthPanel.test.tsx -t "follow focusTrack"`
Expected: FAIL — `error: Property 'focusTrack' does not exist` at type-check, or at runtime `expected fxSynthParams, received synthParams` if the store field is present but the hook still reads `controlTarget`.

- [ ] **Step 3: Rewrite `useSynthChannel`**

Replace lines 27-49 of `src/components/loop/synth/useSynthChannel.ts` with:

```ts
export function useSynthChannel(): SynthChannel {
  const focusTrack = useAppStore((s) => s.focusTrack);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const padSynthParams = useAppStore((s) => s.padSynthParams);
  const fxSynthParams = useAppStore((s) => s.fxSynthParams);
  const setSynthParams = useAppStore((s) => s.setSynthParams);
  const setChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const setBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const setPadSynthParams = useAppStore((s) => s.setPadSynthParams);
  const setFxSynthParams = useAppStore((s) => s.setFxSynthParams);

  // `controlTargetForFocus` refuses a drum focus by TYPE, so the narrowing is
  // forced here rather than optional. Lead is the value in that branch, and it
  // is safe only because SoundView renders no synth surface at all when the
  // focus is `drum` — the whole Synth section is unmounted, so no panel that
  // calls this hook is on screen and nothing can write through it. That gate
  // is asserted in SoundView.test.tsx ("no Synth section on a drum focus"); if
  // it is ever removed, this branch becomes the invisible Lead-patch edit the
  // spec's trap describes.
  const target = isMelodicFocus(focusTrack) ? controlTargetForFocus(focusTrack) : 'synth';

  const channel = resolveSynthControlChannel(target, {
    synth: { params: synthParams, setParams: setSynthParams },
    chord: { params: chordSynthParams, setParams: setChordSynthParams },
    bass: { params: bassSynthParams, setParams: setBassSynthParams },
    pad: { params: padSynthParams, setParams: setPadSynthParams },
    fx: { params: fxSynthParams, setParams: setFxSynthParams },
  });

  return { params: channel.params, onChangeParams: channel.setParams };
}
```

and change the imports at the top of the file to:

```ts
import { useAppStore } from "@/store/store";
import { controlTargetForFocus, isMelodicFocus } from "@/store/focusTrack";
import { resolveSynthControlChannel } from "@/utils/synthControl";
import type { SynthParams } from "@/types";
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun test src/components/loop/SimpleSynthPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/synth/useSynthChannel.ts src/components/loop/SimpleSynthPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(sound): the synth panels follow focusTrack

useSynthChannel reads focusTrack and resolves through controlTargetForFocus,
whose MelodicFocus parameter forces the drum branch to be written out. The
Lead value in that branch is safe only because the Synth section is unmounted
on a drum focus; the comment says so and the next task asserts it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The Sound page's six-chip focus row, and the drum branch

**Files:**
- Modify: `src/store/trackAudibility.ts:66-73` (`soloTrackForControlTarget` → `soloTrackForFocus`)
- Modify: `src/store/trackAudibility.test.ts` (the `soloTrackForControlTarget` block)
- Modify: `src/components/loop/SoundView.tsx` — `MELODY_TARGETS` / `ACCOMPANIMENT_TARGETS` at 89-99, the top-level derivation at 205-245, `renderTargetChip` at 366-375, the target-row block at 478-558, the `<SectionCard title="Synth">` open/close at 412 and 815, `<DrumSoundCard />` at ~838, `<SynthPresetLibrary>` at ~850
- Modify: `src/components/ui/SoloButton.tsx:10-19` (docblock), `src/components/ui/GroupFrame.tsx:26` (comment)
- Test: `src/components/loop/SoundView.test.tsx`

**Interfaces:**
- Consumes: `MIX_LAYER_IDS`, `MixLayerId`, `isMelodicFocus`, `controlTargetForFocus` from `@/store/focusTrack`; `MIX_LAYERS` from `@/components/mixLayers`; `focusTrack` / `setFocusTrack` from the store.
- Produces:
  ```ts
  // src/store/trackAudibility.ts — replaces soloTrackForControlTarget
  export function soloTrackForFocus(focus: MixLayerId): SoloTrack;
  ```
  DOM ids the later tasks and tests rely on: `id="btn-focus-<MixLayerId>"` on each of the six chips (`btn-focus-synth`, `btn-focus-fx`, `btn-focus-chord`, `btn-focus-bass`, `btn-focus-pad`, `btn-focus-drum`); `id="btn-solo-target"` unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/components/loop/SoundView.test.tsx`, replace the `SoundView track solo` describe block's `afterEach` and its second test's `setState` with `focusTrack`, and add:

```ts
describe('the Sound focus row', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  test('renders one chip per mix layer, drum included', () => {
    const html = renderToString(<SoundView />);
    for (const id of MIX_LAYER_IDS) expect(html).toContain(`id="btn-focus-${id}"`);
  });

  // A single literal substring, so the active classes are proven to sit on the
  // SAME element as the id rather than somewhere else in the row.
  test('the focused chip carries the active class list', () => {
    useAppStore.setState({ focusTrack: 'bass' });
    const html = renderToString(<SoundView />);
    expect(html).toContain(
      'id="btn-focus-bass" class="btn btn-xs text-[11px] font-semibold rounded-sm [--btn-color:var(--color-module-bass)] [--btn-fg:var(--color-module-bass-content)]"',
    );
  });

  test('the solo button follows focus, and drum focus gives it the Drums track', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('aria-label="Solo Drums"');
    expect(html).not.toContain('aria-label="Solo Lead"');
  });
});

describe('the Sound page on a drum focus', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  /**
   * The Synth section must be ABSENT from the markup, not merely hidden. This
   * is the gate useSynthChannel's drum branch relies on: with the section
   * unmounted no panel calls that hook, so its Lead fallback can never edit
   * anything. Hiding it with `block`/`hidden` instead would leave the panels
   * mounted and pointed at the Lead patch.
   */
  test('shows Drum Sound and no Synth section', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('Drum Sound');
    expect(html).not.toContain('>Synth<');
    expect(html).not.toContain('id="btn-quick-save-preset"');
  });

  test('a melodic focus shows the Synth section and no Drum Sound', () => {
    useAppStore.setState({ focusTrack: 'pad' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('id="btn-quick-save-preset"');
    expect(html).not.toContain('Drum Sound');
  });

  // The focus row is outside the Synth section on purpose: inside it, a drum
  // focus would hide the only control that can get back to a melodic one.
  test('the focus row is still on screen with the Synth section gone', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<SoundView />);
    expect(html).toContain('id="btn-focus-synth"');
    expect(html).toContain('id="btn-focus-drum"');
  });
});
```

Add `import { MIX_LAYER_IDS } from '@/store/focusTrack';` to that test file.

- [ ] **Step 2: Run the tests and see them fail**

Run: `bun test src/components/loop/SoundView.test.tsx -t "focus"`
Expected: FAIL — `expect(html).toContain('id="btn-focus-synth"')` with the chips carrying no ids at all.

- [ ] **Step 3: Replace `soloTrackForControlTarget` with `soloTrackForFocus`**

In `src/store/trackAudibility.ts`, replace the function and its docblock at 66-73 with:

```ts
/**
 * The Sound view edits one track at a time and its solo button follows the
 * focus, so it needs the one place the two vocabularies meet: the focus
 * `'synth'` is the track called `lead`, and the focus `'drum'` is the track
 * called `drums`. Both irregulars are spelled out; the other four are the same
 * word in both rosters.
 */
export function soloTrackForFocus(focus: MixLayerId): SoloTrack {
  if (focus === 'synth') return 'lead';
  if (focus === 'drum') return 'drums';
  return focus;
}
```

Replace the file's first import line with `import type { MixLayerId } from './focusTrack';` and update the docblock at line 12 to name `soloTrackForFocus`. In `src/store/trackAudibility.test.ts`, rename the describe block and add the `drum → 'drums'` case:

```ts
describe('soloTrackForFocus', () => {
  test('maps every focus onto a real solo track', () => {
    const actual = Object.fromEntries(MIX_LAYER_IDS.map((id) => [id, soloTrackForFocus(id)]));
    expect(actual).toEqual({
      synth: 'lead',
      fx: 'fx',
      chord: 'chord',
      bass: 'bass',
      pad: 'pad',
      drum: 'drums',
    });
  });
});
```

- [ ] **Step 4: Rewrite the Sound page's focus row and gate the two sections**

In `src/components/loop/SoundView.tsx`:

**(a)** Replace the `MELODY_TARGETS` / `ACCOMPANIMENT_TARGETS` block (89-99) with:

```ts
// The two MELODY focuses render as bare chips, the three accompaniment ones go
// in the framed group, and Beat sits last on its own — the same pitched-first,
// rhythm-after order MIX_LAYERS uses. Derived from the roster rather than
// hand-listed so a seventh layer renders somewhere instead of silently
// nowhere, but the split is a SET, not `!== 'synth'`: FX is a melody track
// beside Lead, and putting it under a frame labelled "Accompaniment" would
// make the frame say something untrue. Module scope for the same reason
// DRUM_KIT_NAMES above is: the record is static, and this view re-renders per
// pointermove during a Knob drag.
const MELODY_FOCUSES: readonly MixLayerId[] = ['synth', 'fx'];
const BEAT_FOCUS: MixLayerId = 'drum';
const ACCOMPANIMENT_FOCUSES = MIX_LAYER_IDS.filter(
  (id) => !MELODY_FOCUSES.includes(id) && id !== BEAT_FOCUS,
);

// The Beat chip's styling comes from MIX_LAYERS' drum row, not from
// SYNTH_TARGET_STYLES, which has five entries and no sixth to add: a drum
// focus has no synth channel, so a row in that table would be a claim that it
// does. Both class strings are literals — Tailwind v4 scans source statically,
// so a class assembled at runtime would never be emitted.
const BEAT_CHIP = {
  label: MIX_LAYERS.find((l) => l.idPrefix === 'drum')!.label,
  activeBtn: 'btn-accent',
  softBtn: 'btn-soft btn-accent',
};
```

**(b)** In the top-level derivation (205-245), replace the `controlTarget` / `onChangeControlTarget` reads and the channel resolution with:

```ts
  // useLiveStore, not useAppStore: the chips and the solo button below derive
  // from this value, and only useLiveStore serves getState() on the server
  // snapshot renderToString uses — see useLiveStore.ts and testing.md.
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useAppStore((s) => s.setFocusTrack);
```

and, after the `channels` object:

```ts
  // Null when the focus is `drum`: `controlTargetForFocus` refuses that focus
  // by type, and the Synth section, its quick-save popover and the preset
  // library are all gated on this being non-null below. The Lead channel is
  // what the preset handlers close over so they stay total, and every control
  // that could invoke one of them lives inside the un-rendered section.
  const synthTarget = isMelodicFocus(focusTrack) ? controlTargetForFocus(focusTrack) : null;
  const channel = resolveSynthControlChannel(synthTarget ?? 'synth', channels);
  const params = channel.params;
  const onChangeParams = channel.setParams;

  const tintClass = synthTarget
    ? [SYNTH_TARGET_STYLES[synthTarget].ring, SYNTH_TARGET_STYLES[synthTarget].tint]
        .filter(Boolean)
        .join(" ")
    : "";
```

Replace every remaining `SYNTH_TARGET_STYLES[controlTarget]` and `source={controlTarget}` / `controlTarget === "chord"` reference inside the Synth section body with `synthTarget` — those sites only render when `synthTarget !== null`, so read it as `synthTarget!` is *not* needed: hoist one non-null local at the top of the gated JSX, `const target = synthTarget;`, and use `target` inside, which TypeScript narrows from the enclosing `synthTarget !== null &&`.

**(c)** Replace `renderTargetChip` (366-375) with:

```ts
  const renderFocusChip = (focus: MixLayerId) => {
    const style =
      focus === BEAT_FOCUS ? BEAT_CHIP : SYNTH_TARGET_STYLES[controlTargetForFocus(focus)];
    return (
      <button
        key={focus}
        id={`btn-focus-${focus}`}
        onClick={() => setFocusTrack(focus)}
        className={`btn btn-xs text-[11px] font-semibold rounded-sm ${
          focusTrack === focus ? style.activeBtn : style.softBtn
        }`}
      >
        {style.label}
      </button>
    );
  };
```

`controlTargetForFocus(focus)` is only reached on the non-`BEAT_FOCUS` branch, but its `MelodicFocus` parameter will not accept a `MixLayerId`. Narrow it structurally instead of casting:

```ts
  const renderFocusChip = (focus: MixLayerId) => {
    const style = isMelodicFocus(focus)
      ? SYNTH_TARGET_STYLES[controlTargetForFocus(focus)]
      : BEAT_CHIP;
    ...
  };
```

**(d)** Move the target-row `<div className="flex flex-wrap items-center gap-2.5 sm:gap-3">` block (478-558) **out of** the `<SectionCard title="Synth">` and place it directly above that card, as a sibling under the page root. Inside it:

- the group `<div>`'s border class becomes `` `… ${synthTarget ? SYNTH_TARGET_STYLES[synthTarget].border : 'border-accent'}` ``;
- `{MELODY_TARGETS.map(renderTargetChip)}` becomes `{MELODY_FOCUSES.map(renderFocusChip)}`;
- `{ACCOMPANIMENT_TARGETS.map(renderTargetChip)}` becomes `{ACCOMPANIMENT_FOCUSES.map(renderFocusChip)}`;
- add `{renderFocusChip(BEAT_FOCUS)}` immediately after the closing `</GroupFrame>`;
- `<SoloButton id="btn-solo-target" track={soloTrackForControlTarget(controlTarget)} size="sm" />` becomes `track={soloTrackForFocus(focusTrack)}`;
- wrap the oscilloscope `<div className="ml-auto hidden sm:flex …">` in `{synthTarget !== null && ( … )}` and read `synthTarget` inside it — a drum focus taps no melodic bus.

Rewrite the row's leading comment to:

```jsx
      {/* The focus row: the one "what am I working on" control, and the only
          place on this tab that can change it. It sits OUTSIDE the Synth
          section, not inside it as the old Target row did, because the Synth
          section is unmounted on a drum focus — inside, the row would take the
          only way back to a melodic focus down with it.

          Six chips, not five: `drum` is a focus like any other and Beat is
          where the drum kit is edited. Kept as its own row, visible in both
          Simple and Pro mode, because it is the control that switches which
          channel every knob below points at. */}
```

**(e)** Wrap the whole `<SectionCard icon={AudioWaveform} title="Synth" …> … </SectionCard>` (412-815) in `{synthTarget !== null && ( … )}`, wrap `<QuickSavePopover … />` and the `<Suspense>`-wrapped `<SynthPresetLibrary … target={synthTarget} …/>` in the same condition, and change `<DrumSoundCard />` to `{synthTarget === null && <DrumSoundCard />}`.

**(f)** The oscilloscope's comment at ~530 currently reads "the global input deck's keyboard always plays the 'synth' layer regardless of Target". Rewrite it to name the new state and the plan that closes it — do not delete it, it is the honest label for what this plan leaves broken:

```jsx
              The label is not decoration: the global input deck's keyboard
              still plays the 'synth' (Lead) layer regardless of focus —
              KEYBOARD_AUDITION_TARGET in useInputDeck.ts is a module constant
              and routing it through focus is plan 2 of the focus-track spec —
              so with the focus on Chord or Bass the trace stays flat while
              keys are pressed. Naming the tapped layer is what keeps that
              legible instead of reading as a broken scope.
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `bun test src/components/loop/SoundView.test.tsx src/store/trackAudibility.test.ts && bun run lint`
Expected: PASS; `tsc --noEmit` silent.

- [ ] **Step 6: Rewrite the two docblocks this falsifies**

`src/components/ui/SoloButton.tsx:10-19` says the Sound view's one button "follows `controlTarget`". Replace that clause with "follows `focusTrack`". `src/components/ui/GroupFrame.tsx:26` says "Presentation only. controlTarget's persisted values are unchanged." — replace with "Presentation only. The focus row's grouping changes nothing about `focusTrack`'s persisted values."

Also update the `SoloButton` comment inside SoundView's focus row: it says the set is "cleared by LEAVING the loop layer, by a Pattern-segment change, or by a change of active loop". Task 8 removes the segment clear; leave this comment for Task 8 to rewrite so the sentence and the code change together.

- [ ] **Step 7: Commit**

```bash
git add src/store/trackAudibility.ts src/store/trackAudibility.test.ts src/components/loop/SoundView.tsx src/components/loop/SoundView.test.tsx src/components/ui/SoloButton.tsx src/components/ui/GroupFrame.tsx
git commit -m "$(cat <<'EOF'
feat(sound): a six-chip focus row, and no Synth section on a drum focus

The row moves out of the Synth section so it survives the drum focus that
unmounts that section, and gains a Beat chip styled from MIX_LAYERS' drum row.
The Synth section, its popover and the preset library are gated on a melodic
focus; Drum Sound shows only on a drum focus. soloTrackForControlTarget
becomes soloTrackForFocus and gains the drum -> 'drums' row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Pattern's gate and its segment row follow focus

**Files:**
- Modify: `src/components/loop/PatternView.tsx:25-55`
- Modify: `src/components/ui/SegmentHeader.tsx:45`
- Modify: `src/components/ui/SegmentedControl.tsx:91-110`
- Test: `src/components/loop/PatternView.test.tsx`, `src/components/Header.test.tsx:122-145`

**Interfaces:**
- Consumes: `segmentForFocus`, `focusForSegment` from `@/store/focusTrack`; `focusTrack` / `setFocusTrack` from the store; `useLiveStore` from `@/components/ui/useLiveStore`.
- Produces:
  ```ts
  // src/components/loop/PatternView.tsx
  export function segmentVisibilityClass(focus: MixLayerId, segment: PatternSegment): 'block' | 'hidden';
  ```

- [ ] **Step 1: Write the failing tests**

Add to `src/components/loop/PatternView.test.tsx`:

```ts
import { segmentVisibilityClass } from './PatternView';
import { MIX_LAYER_IDS, segmentForFocus } from '@/store/focusTrack';
import { PATTERN_SEGMENT_IDS } from '@/types';
import { useAppStore } from '@/store/store';

describe('segmentVisibilityClass', () => {
  /**
   * Tested as a pure function rather than by counting `class="hidden"` in a
   * render: PatternView's tree pulls in ChordView, SequencerView and two
   * melody grids, and the property being asserted — exactly one segment
   * un-hidden, for EVERY focus — is a property of the projection, not of that
   * markup. The render test below still counts the gates for the default
   * focus, which is what proves the projection is actually wired in.
   */
  test('leaves exactly one segment showing, for every focus', () => {
    for (const focus of MIX_LAYER_IDS) {
      const shown = PATTERN_SEGMENT_IDS.filter(
        (segment) => segmentVisibilityClass(focus, segment) === 'block',
      );
      expect(shown).toEqual([segmentForFocus(focus)]);
    }
  });

  test('the three accompaniment focuses all show the accompaniment segment', () => {
    for (const focus of ['chord', 'bass', 'pad'] as const) {
      expect(segmentVisibilityClass(focus, 'accompaniment')).toBe('block');
      expect(segmentVisibilityClass(focus, 'beat')).toBe('hidden');
    }
  });
});

describe('the Pattern gate is wired to focusTrack', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  test('a drum focus shows the beat segment and hides the other three', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<PatternView />);
    expect(html.match(/class="hidden"/g)?.length).toBe(3);
    expect(html.match(/class="block"/g)?.length).toBe(1);
    // The Beat segment's own header row is the one that draws the segment
    // buttons, and it only draws when its segment is active.
    expect(html).toContain('id="segment-beat"');
  });
});
```

Add to `src/components/Header.test.tsx`, replacing the `PatternSegmentRow` docblock's "The active segment cannot be varied from a test" paragraph:

```ts
  test('the active button follows focusTrack, and accompaniment covers three focuses', () => {
    useAppStore.setState({ focusTrack: 'pad' });
    const padHtml = renderToString(<PatternSegmentRow />);
    expect(padHtml).toContain('id="segment-accompaniment" aria-current="page"');
    useAppStore.setState({ focusTrack: 'drum' });
    const drumHtml = renderToString(<PatternSegmentRow />);
    expect(drumHtml).toContain('id="segment-beat" aria-current="page"');
    useAppStore.setState({ focusTrack: 'synth' });
  });
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `bun test src/components/loop/PatternView.test.tsx src/components/Header.test.tsx`
Expected: FAIL — `error: Export named 'segmentVisibilityClass' not found in module`.

- [ ] **Step 3: Wire the three surfaces**

`src/components/loop/PatternView.tsx` — replace the component and add the helper:

```tsx
/**
 * Which of the four segment wrappers shows, for a given focus. Exported and
 * pure so the "exactly one segment showing" property can be asserted over
 * every focus without rendering four grids (see PatternView.test.tsx).
 */
export function segmentVisibilityClass(
  focus: MixLayerId,
  segment: PatternSegment,
): 'block' | 'hidden' {
  return segmentForFocus(focus) === segment ? 'block' : 'hidden';
}

export const PatternView = React.memo(function PatternView() {
  // useLiveStore, not useAppStore: this gate must reflect a focus a test set
  // before renderToString, and zustand's own hook serves creation-time state
  // as the server snapshot (see .claude/rules/testing.md).
  const focusTrack = useLiveStore((s) => s.focusTrack);
  return (
    <>
      <div className={segmentVisibilityClass(focusTrack, 'lead')}>
        {/* The lead segment has no card wrapper of its own — LeadMelodyGrid is
            one card — so it borrows the padding/width shell ChordView and
            SequencerView each apply to their own root. */}
        <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
          <SegmentHeader segment="lead" />
          <LeadMelodyGrid trackId="lead" />
        </div>
      </div>
      <div className={segmentVisibilityClass(focusTrack, 'fx')}>
        {/* Same shell as Lead above, deliberately: FX is the same surface with a
            different trackId, so a second layout here would be the two grids
            starting to diverge. */}
        <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3 sm:space-y-4">
          <SegmentHeader segment="fx" />
          <LeadMelodyGrid trackId="fx" />
        </div>
      </div>
      <div className={segmentVisibilityClass(focusTrack, 'accompaniment')}>
        <ChordView />
      </div>
      <div className={segmentVisibilityClass(focusTrack, 'beat')}>
        <SequencerView />
      </div>
    </>
  );
});
```

with imports `import { segmentForFocus, type MixLayerId } from '@/store/focusTrack';`, `import type { PatternSegment } from '@/types';`, `import { useLiveStore } from '../ui/useLiveStore';`, and the now-unused `useAppStore` import removed.

Add to the component's docblock, after the "All four segments stay mounted" paragraph:

```
 * Which one shows is DERIVED, not stored: `segmentForFocus(focusTrack)`. The
 * segment stopped being its own ui-slice field when focus merged the Pattern
 * segment and the Sound target into one value — so crossing from Sound to
 * Pattern lands on the segment that shows the track you were already editing,
 * with nothing to keep in step.
```

`src/components/ui/SegmentHeader.tsx:45` — replace with:

```tsx
  // useLiveStore for the same reason PatternView's gate uses it: this decides
  // which of the four mounted headers draws the segment row, and a test that
  // sets focusTrack must be able to see the result.
  const activeSegment = segmentForFocus(useLiveStore((s) => s.focusTrack));
```

with `import { segmentForFocus } from '@/store/focusTrack';` and `import { useLiveStore } from './useLiveStore';`, and the `useAppStore` import removed.

`src/components/ui/SegmentedControl.tsx` — replace `PatternSegmentRow`'s body:

```tsx
export function PatternSegmentRow() {
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useLiveStore((s) => s.setFocusTrack);
  const activeSegment = segmentForFocus(focusTrack);

  return (
    <SegmentedGroup>
      {PATTERN_SEGMENTS.map(({ id, label, icon }) => (
        <SegmentedButton
          key={id}
          id={`segment-${id}`}
          icon={icon}
          label={label}
          active={activeSegment === id}
          // `accompaniment` always sends `chord` — see focusForSegment for why
          // there is deliberately no memory of which of the three was last
          // used. Consequence, on the record: focus `pad`, go to Beat, press
          // Accompaniment and you land on `chord`, not `pad`. That is one
          // click, and all three grids are on screen either way.
          onSelect={() => setFocusTrack(focusForSegment(id))}
        />
      ))}
    </SegmentedGroup>
  );
}
```

with `import { focusForSegment, segmentForFocus } from '@/store/focusTrack';` and `import { useLiveStore } from './useLiveStore';`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `bun test src/components/loop/PatternView.test.tsx src/components/Header.test.tsx src/components/ui/SegmentHeader.test.tsx && bun run lint`
Expected: PASS; `tsc --noEmit` silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/PatternView.tsx src/components/loop/PatternView.test.tsx src/components/ui/SegmentHeader.tsx src/components/ui/SegmentedControl.tsx src/components/Header.test.tsx
git commit -m "$(cat <<'EOF'
feat(pattern): the segment gate and the segment row read focusTrack

PatternView exports segmentVisibilityClass so the "exactly one segment
showing" property is asserted over every focus without rendering four grids.
The row's accompaniment button is active for chord, bass and pad, and always
sets chord — no last-used memory, per the spec's rejected alternative.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: A mixer row sets focus

**Files:**
- Modify: `src/components/loop/SoundMixer.tsx:121-145` (`MixerRow`'s label)
- Test: `src/components/loop/SoundMixer.test.tsx`

**Interfaces:**
- Consumes: `setFocusTrack` and `focusTrack` from the store; `MixLayerId` via `MixerChannel.idPrefix`.
- Produces: `id="btn-mix-focus-<MixLayerId>"` on each row's label button. Fader and mute behaviour unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/components/loop/SoundMixer.test.tsx`:

```ts
import { useAppStore } from '@/store/store';
import { MIX_LAYER_IDS } from '@/store/focusTrack';

describe('a mixer row sets focus', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  test('every row carries a focus button', () => {
    const html = renderToString(<SoundMixer />);
    for (const id of MIX_LAYER_IDS) expect(html).toContain(`id="btn-mix-focus-${id}"`);
  });

  // aria-current is what tells a screen reader which row is the one being
  // edited, and it is the only visible difference between the six rows.
  test('the focused row is marked, and only that one', () => {
    useAppStore.setState({ focusTrack: 'chord' });
    const html = renderToString(<SoundMixer />);
    expect(html).toContain('id="btn-mix-focus-chord" aria-current="true"');
    expect(html.match(/aria-current="true"/g)?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/components/loop/SoundMixer.test.tsx -t "sets focus"`
Expected: FAIL — `expect(html).toContain('id="btn-mix-focus-synth"')`, received markup with a plain `<label>`.

- [ ] **Step 3: Make the row label a focus button**

In `MixerRow`, add two store reads beside the existing four:

```ts
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useLiveStore((s) => s.setFocusTrack);
```

(`useLiveStore` from `../ui/useLiveStore`, so a test's `setState` is visible under `renderToString` — the four existing reads stay on `useAppStore`, since nothing asserts a fader value from a test-set state.)

Replace the `<label>` at 138-140 with:

```tsx
      {/* The row's own name is the focus control: clicking it points every
          Sound-page knob at this layer. A button rather than a click handler
          on the row body, because the row body already contains a fader and a
          mute toggle and a click that lands on either must not also navigate.
          The `htmlFor` moves onto a sibling `<label className="sr-only">` so
          the fader keeps an accessible name. */}
      <div className="flex items-center gap-1.5">
        <button
          id={`btn-mix-focus-${channel.idPrefix}`}
          type="button"
          aria-current={focusTrack === channel.idPrefix ? 'true' : undefined}
          onClick={() => setFocusTrack(channel.idPrefix)}
          className={`${FIELD_LABEL} text-left hover:text-base-content ${
            focusTrack === channel.idPrefix ? 'text-base-content font-bold' : ''
          }`}
          title={`Work on ${channel.label}`}
        >
          {channel.label} <span className="tabular-nums">({formatDb(volume)})</span>
        </button>
        <label className="sr-only" htmlFor={layerVolumeSliderId(channel.idPrefix)}>
          {channel.label} level
        </label>
      </div>
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun test src/components/loop/SoundMixer.test.tsx && bun run lint`
Expected: PASS; `tsc --noEmit` silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/SoundMixer.tsx src/components/loop/SoundMixer.test.tsx
git commit -m "$(cat <<'EOF'
feat(mixer): clicking a row's name sets focus to that layer

A button, not a handler on the row body: the body already holds a fader and a
mute toggle, and a click landing on either must not also navigate. The fader
keeps its accessible name through an sr-only label.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The dock's focus chip, and its panel auto-switch

**Files:**
- Create: `src/store/focusPanelSync.ts`
- Create: `src/store/focusPanelSync.test.ts`
- Modify: `src/components/ui/BottomInputDock.tsx:15-21` (labels), `:64-124` (the always-visible header)
- Modify: `src/App.tsx` (mount the subscription, beside `useSoloNavClear()`)
- Test: `src/components/ui/BottomInputDock.test.tsx`

**Interfaces:**
- Consumes: `MixLayerId`, `MIX_LAYER_IDS` from `@/store/focusTrack`; `MIX_LAYERS` from `@/components/mixLayers`; `InputPanelMode` from `@/types`.
- Produces:
  ```ts
  // src/store/focusPanelSync.ts
  export function panelModeForFocus(focus: MixLayerId): InputPanelMode; // 'drum' -> 'drums', else 'keyboard'
  export function startFocusPanelSync(): () => void;
  export function useFocusPanelSync(): void;
  // src/components/ui/BottomInputDock.tsx
  export const FOCUS_CHIP_LABELS: Record<MixLayerId, string>;
  ```
  DOM ids: `id="btn-focus-chip"` (the chip), `id="btn-focus-chip-<MixLayerId>"` (the six menu items).

- [ ] **Step 1: Write the failing tests**

Create `src/store/focusPanelSync.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { MIX_LAYER_IDS } from './focusTrack';
import { panelModeForFocus, startFocusPanelSync } from './focusPanelSync';
import { useAppStore } from './store';

afterEach(() => {
  useAppStore.setState({ focusTrack: 'synth', inputPanelMode: 'keyboard' });
});

describe('panelModeForFocus', () => {
  test('drum gets the Drums panel and every other focus the Keyboard', () => {
    const actual = Object.fromEntries(MIX_LAYER_IDS.map((id) => [id, panelModeForFocus(id)]));
    expect(actual).toEqual({
      synth: 'keyboard',
      fx: 'keyboard',
      chord: 'keyboard',
      bass: 'keyboard',
      pad: 'keyboard',
      drum: 'keyboard',
    });
  });
});

describe('startFocusPanelSync', () => {
  test('a drum focus switches the dock to Drums, and a melodic focus back', () => {
    const stop = startFocusPanelSync();
    useAppStore.getState().setFocusTrack('drum');
    expect(useAppStore.getState().inputPanelMode).toBe('drums');
    useAppStore.getState().setFocusTrack('pad');
    expect(useAppStore.getState().inputPanelMode).toBe('keyboard');
    stop();
  });

  /**
   * The tabs stay clickable: the auto-switch fires on a FOCUS change, never on
   * a panel change, so a user who switches back to the Keyboard while focused
   * on drums stays there until focus itself moves (spec, Open risks 2).
   */
  test('does not fight a manual panel change', () => {
    const stop = startFocusPanelSync();
    useAppStore.getState().setFocusTrack('drum');
    useAppStore.getState().setInputPanelMode('keyboard');
    expect(useAppStore.getState().inputPanelMode).toBe('keyboard');
    stop();
  });

  test('writes nothing when the panel already matches', () => {
    const stop = startFocusPanelSync();
    let writes = 0;
    const unsub = useAppStore.subscribe((s) => s.inputPanelMode, () => { writes += 1; });
    useAppStore.getState().setFocusTrack('fx');
    useAppStore.getState().setFocusTrack('chord');
    expect(writes).toBe(0);
    unsub();
    stop();
  });
});
```

The first test's expected map is deliberately wrong (`drum: 'keyboard'`) — fix it to `drum: 'drums'` in Step 3 after watching it fail, so the assertion is proven to be reading the function rather than passing by construction.

Append to `src/components/ui/BottomInputDock.test.tsx`:

```ts
import { MIX_LAYER_IDS } from '@/store/focusTrack';
import { useAppStore } from '@/store/store';

describe('the dock focus chip', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  // The dock is the one surface visible from every tab and every Pattern
  // segment, so it is where "which track am I working on" has to be
  // answerable without navigating.
  test('renders the focused track label, open or closed', () => {
    useAppStore.setState({ focusTrack: 'drum', isInputPanelOpen: false });
    expect(renderToString(<BottomInputDock {...props} />)).toContain(
      'id="btn-focus-chip" aria-haspopup="menu"',
    );
    useAppStore.setState({ isInputPanelOpen: true });
    const open = renderToString(<BottomInputDock {...props} />);
    expect(open).toContain('id="btn-focus-chip"');
    expect(open).toContain('>Beat</span>');
  });

  test('the menu offers every focus', () => {
    const html = renderToString(<BottomInputDock {...props} />);
    for (const id of MIX_LAYER_IDS) expect(html).toContain(`id="btn-focus-chip-${id}"`);
  });
});
```

using that file's existing prop fixture for `props`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `bun test src/store/focusPanelSync.test.ts`
Expected: FAIL — `error: Cannot find module './focusPanelSync'`.

- [ ] **Step 3: Write the subscription**

Fix the expected map in the first test (`drum: 'drums'`), then create `src/store/focusPanelSync.ts`:

```ts
import React from 'react';
import { useAppStore } from './store';
import { type MixLayerId } from './focusTrack';
import type { InputPanelMode } from '../types';

/**
 * Which input-deck panel a focus wants. The melodic keyboard has nothing to
 * play on a drum focus, so leaving the user looking at it would be exactly the
 * invisible-state failure the focus track exists to remove.
 */
export function panelModeForFocus(focus: MixLayerId): InputPanelMode {
  return focus === 'drum' ? 'drums' : 'keyboard';
}

/**
 * One subscription on `focusTrack`, mirroring startSoloNavClear: the panel
 * follows focus wherever focus is written from, rather than each of the six
 * writers of `setFocusTrack` remembering to switch it. A per-writer switch is
 * one more thing every future writer has to know.
 *
 * It watches FOCUS and never the panel, which is what keeps the tabs
 * clickable: a manual panel change writes `inputPanelMode` and this listener
 * does not run. A user who wants the drum grid focused while auditioning
 * melodic notes switches the panel back and stays there until focus moves
 * again (spec, Open risks 2).
 *
 * The equality guard is here and not only in the action: zustand treats every
 * `set()` as a state change and re-runs partialize over the whole persisted
 * slice, and most focus changes leave the panel where it already was.
 */
export function startFocusPanelSync(): () => void {
  return useAppStore.subscribe(
    (state) => state.focusTrack,
    (focusTrack) => {
      const wanted = panelModeForFocus(focusTrack);
      if (useAppStore.getState().inputPanelMode !== wanted) {
        useAppStore.getState().setInputPanelMode(wanted);
      }
    },
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useFocusPanelSync(): void {
  React.useEffect(() => startFocusPanelSync(), []);
}
```

In `src/App.tsx`, call `useFocusPanelSync();` immediately after the existing `useSoloNavClear();`, with the import added.

- [ ] **Step 4: Run the store test and see it pass**

Run: `bun test src/store/focusPanelSync.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Add the dock chip**

In `src/components/ui/BottomInputDock.tsx`, add below `PANEL_LABELS`:

```ts
/**
 * The focused track's name, keyed by focus id. Read off MIX_LAYERS rather than
 * spelled again, so the chip and the mixer row for the same track can never
 * disagree — `'synth'` is "Lead" and `'drum'` is "Beat" in both.
 */
export const FOCUS_CHIP_LABELS: Record<MixLayerId, string> = Object.fromEntries(
  MIX_LAYERS.map((layer) => [layer.idPrefix, layer.label]),
) as Record<MixLayerId, string>;
```

with `import { MIX_LAYERS } from '../mixLayers';` and `import { MIX_LAYER_IDS, type MixLayerId } from '@/store/focusTrack';`.

Inside the component, beside the four existing `useLiveStore` reads:

```ts
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useLiveStore((s) => s.setFocusTrack);
```

Insert, immediately after the `btn-toggle-input-deck` button and before the collapsed-summary block, the always-visible chip:

```tsx
        {/* The focus chip. ALWAYS visible — open, collapsed, on every tab and
            every Pattern segment — because the dock is the one surface all of
            them share, and "which track will the keyboard play" has to be
            answerable without navigating. A daisyUI dropdown rather than a
            cycling button: six values is too many to step through, and a menu
            shows the whole roster at once. */}
        <div className="dropdown dropdown-top">
          <button
            id="btn-focus-chip"
            type="button"
            aria-haspopup="menu"
            aria-label={`Working on ${FOCUS_CHIP_LABELS[focusTrack]}`}
            className={`btn btn-xs gap-1 text-[11px] font-semibold ${TOOLBAR_BUTTON_IDLE}`}
            title="Which track you are working on"
          >
            <span className="text-base-content/50 uppercase tracking-wider text-[9px]">On</span>
            <span>{FOCUS_CHIP_LABELS[focusTrack]}</span>
          </button>
          <ul
            role="menu"
            className="dropdown-content menu menu-sm z-40 mb-1 w-36 rounded-box bg-base-100 border border-base-300 p-1 shadow-lg"
          >
            {MIX_LAYER_IDS.map((id) => (
              <li key={id} role="none">
                <button
                  id={`btn-focus-chip-${id}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={focusTrack === id}
                  onClick={() => setFocusTrack(id)}
                  className={focusTrack === id ? 'active font-bold' : ''}
                >
                  {FOCUS_CHIP_LABELS[id]}
                </button>
              </li>
            ))}
          </ul>
        </div>
```

- [ ] **Step 6: Run the dock test and see it pass**

Run: `bun test src/components/ui/BottomInputDock.test.tsx && bun run lint`
Expected: PASS; `tsc --noEmit` silent.

- [ ] **Step 7: Commit**

```bash
git add src/store/focusPanelSync.ts src/store/focusPanelSync.test.ts src/components/ui/BottomInputDock.tsx src/components/ui/BottomInputDock.test.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat(dock): an always-visible focus chip, and the panel follows focus

The chip shows and sets focusTrack from every tab and every Pattern segment —
the dock is the one surface all of them share. The panel auto-switch is one
subscription on focusTrack (never on the panel), so the Keyboard/Drums tabs
stay clickable and a manual choice is not fought.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Solo stops clearing on a segment change

**Files:**
- Modify: `src/store/soloNav.ts:7-62` (the docblock and `SOLO_NAV_SOURCES`)
- Modify: `src/store/soloNav.test.ts:51,63,77,106-118,140-160`
- Modify: `CLAUDE.md` (the solo-clearing paragraph, ~line 243-258)
- Modify: `src/components/loop/SoundView.tsx` (the `SoloButton` comment inside the focus row)

**Interfaces:**
- Consumes: `focusTrack` on the store.
- Produces:
  ```ts
  export const SOLO_NAV_KEYS: ('layer' | 'activeLoopId')[];
  export type SoloNavSignature = { layer: Layer; activeLoopId: string };
  ```

- [ ] **Step 1: Write the failing tests**

In `src/store/soloNav.test.ts`:

- change line 77 to `expect([...SOLO_NAV_KEYS]).toEqual(['layer', 'activeLoopId']);`
- rename the `derives layer from activeTab and reads patternSegment/activeLoopId live` test to `derives layer from activeTab and reads activeLoopId live`, dropping `patternSegment: 'beat'` from its `setState` and `patternSegment: 'beat'` from the expected signature
- replace `patternSegment: 'lead',` with `focusTrack: 'synth',` in the `beforeEach` and `afterEach` `setState` calls
- delete the two `changing the Pattern segment clears it` tests and put this in their place:

```ts
describe('solo survives a focus change', () => {
  /**
   * The clear on a segment change is GONE, and this is the test that keeps it
   * gone. With one `focusTrack`, "segment change" and "target change" are the
   * same event — soloNav's own docblock used to argue that the first must
   * clear and the second must not, which a merged value makes contradictory.
   * The target rule wins: solo is a monitoring gesture whose whole purpose is
   * comparing tracks, and clearing here would make a multi-track solo set
   * unbuildable anywhere.
   */
  test('a focus change with a non-empty set leaves it intact', () => {
    useAppStore.getState().setActiveTab('pattern');
    useAppStore.getState().toggleSoloTrack('bass');
    expect(useAppStore.getState().soloTracks).toEqual(['bass']);
    useAppStore.getState().setFocusTrack('drum');
    expect(useAppStore.getState().soloTracks).toEqual(['bass']);
    useAppStore.getState().setFocusTrack('synth');
    expect(useAppStore.getState().soloTracks).toEqual(['bass']);
  });

  test('a multi-track set is buildable across focuses', () => {
    useAppStore.getState().setFocusTrack('drum');
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().setFocusTrack('synth');
    useAppStore.getState().toggleSoloTrack('lead');
    expect(useAppStore.getState().soloTracks).toEqual(['lead', 'drums']);
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `bun test src/store/soloNav.test.ts`
Expected: FAIL — `expect([...SOLO_NAV_KEYS]).toEqual(['layer','activeLoopId'])` receiving `['layer','patternSegment','activeLoopId']`, and `a focus change with a non-empty set leaves it intact` receiving `[]` (the segment derived from focus still moves, but nothing watches it — the failure here is the key-list one; the survival test passes only once `patternSegment` is off the table AND the field is gone, so it may pass early. Keep it: it is the regression guard, not the driver).

- [ ] **Step 3: Drop the segment axis and rewrite the docblock**

In `src/store/soloNav.ts`, replace the docblock (7-57) and `SOLO_NAV_SOURCES` (58-62) with:

```ts
/**
 * The navigation axes that empty the track-solo set: a change of LAYER (Loop
 * ↔ Song, derived from the tab via `layerForTab`) and a change of active loop.
 * A project swap clears it too, in projectSlice's own atomic patch — loop ids
 * are not unique across projects, so `activeLoopId` cannot catch that one.
 *
 * The raw `activeTab` is not watched — `layer` replaces it, so moving between
 * Sound and Pattern does not clear the set.
 *
 * WHY THE PATTERN-SEGMENT AXIS WENT AWAY. This table used to watch
 * `patternSegment` as well, and this docblock used to argue two things at
 * once: that a segment change is a change of SUBJECT and must clear, and that
 * a Sound-view target change must NOT clear, because the Sound view has one
 * solo button following the target and clearing on a target change would make
 * a two-track set unbuildable on that surface. With `focusTrack` those are the
 * same event. Keeping the clear would make a multi-track set unbuildable
 * everywhere, which is the failure the second argument existed to prevent —
 * and the second argument is the stronger one, because solo is a monitoring
 * gesture whose entire purpose is comparing tracks. A focus change therefore
 * never clears the set. soloNav.test.ts asserts that directly, so restoring
 * the clear has to be a decision.
 *
 * ONE subscription over these fields, rather than a clear inside each writer.
 * activeLoopId alone has six writers today (loadLoop's two setState calls,
 * addLoop, duplicateLoop, deleteLoop, setActiveLoop) plus applyProjectContent's
 * open patch, and song advance reaches it through loadLoop; a per-writer clear
 * would have to be remembered by every one of those and by every writer added
 * later, and a missed one is silent — the solo just keeps silencing tracks.
 * Watching the field covers every writer that exists and every writer that will
 * exist. The only remaining way to forget is to add a NEW navigation axis, and
 * soloNav.test.ts asserts this list exhaustively so that has to be a decision.
 *
 * A song advance therefore clears the set mid-song. That is correct: it is
 * already empty (reaching the Song layer was a layer change), and a solo that
 * survived a loop boundary would be silencing tracks in a loop nobody soloed
 * anything in.
 *
 * The view header's `SOLO · … ×` chip (components/ui/SoloChip.tsx) is what
 * keeps a solo set on another track visible — it rides the shared HeaderCard
 * rather than one view, so it survives every hop the set itself survives.
 */
const SOLO_NAV_SOURCES = {
  layer: (state: AppStore) => layerForTab(state.activeTab),
  activeLoopId: (state: AppStore) => state.activeLoopId,
};
```

- [ ] **Step 4: Rewrite CLAUDE.md's solo paragraph, which this falsifies**

In `CLAUDE.md`, in the "Track solo is a monitoring gesture" paragraph, replace the sentence beginning "It is **cleared by a Pattern-segment change**, by leaving the Loop layer, or by changing the active loop" and the "Consequence, on the record" sentence that follows it with:

```
It is **cleared by leaving the Loop layer, by changing the active loop, or by
swapping the project** — a change of the LAYER (derived from `activeTab` via
`layerForTab`) or of `activeLoopId`, watched by the single subscription in
`store/soloNav.ts` rather than by a clear inside each writer, plus
`projectSlice`'s own atomic clear on an install. **A `focusTrack` change never
clears it.** That is forced rather than chosen: `focusTrack` merged the Pattern
segment and the Sound control target into one value, and soloNav's docblock
used to argue that a segment change must clear while a target change must not —
contradictory once they are the same event. The target rule wins, because solo
is a monitoring gesture whose entire purpose is comparing tracks and clearing on
every focus change would make a multi-track set unbuildable anywhere.
Consequence, on the record: a set spanning Drums and the melodic tracks is
buildable from any surface — solo Drums with focus on `drum`, then focus each
melodic track in turn and solo it, on Sound, on Pattern or from the mixer. What
still empties the set is leaving the Loop layer, changing the active loop, or
swapping the project. That
```

leaving the existing "clearing rule is the feature, not a rough edge" sentence that follows to continue from "That". Delete the trailing "and do not 'fix' the Sound/Pattern survival back into clearing on every tab change either" clause only if it now reads as a duplicate; otherwise leave it.

- [ ] **Step 5: Rewrite the SoundView solo comment**

In `src/components/loop/SoundView.tsx`, the `SoloButton` comment inside the focus row currently says the set is "cleared by LEAVING the loop layer, by a Pattern-segment change, or by a change of active loop — NOT by the Sound <-> Pattern tab change this button lives on, nor by a change of target". Replace those two clauses with:

```
              Session-only, and cleared by LEAVING the loop layer, by a change
              of active loop, or by a project swap — NOT by a focus change,
              which is what makes a set spanning two tracks buildable from this
              row at all. store/soloNav.ts owns that rule and says why.
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `bun test src/store/soloNav.test.ts src/components/loop/SoundView.test.tsx && bun run lint`
Expected: PASS; `tsc --noEmit` silent.

- [ ] **Step 7: Commit**

```bash
git add src/store/soloNav.ts src/store/soloNav.test.ts src/components/loop/SoundView.tsx CLAUDE.md
git commit -m "$(cat <<'EOF'
refactor(solo): a focus change never clears the solo set

SOLO_NAV_SOURCES drops patternSegment, leaving layer and activeLoopId. With one
focusTrack, "segment change" and "target change" are the same event, and
soloNav's docblock argued opposite rules for the two; the target rule wins,
because clearing would make a multi-track set unbuildable anywhere. The
docblock and CLAUDE.md's solo paragraph are rewritten in this commit, not a
later doc pass.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Delete `controlTarget` and `patternSegment`

**Files:**
- Modify: `src/store/synthSlice.ts:8-27`, `src/store/uiSlice.ts` (the two `patternSegment` lines), `src/store/types.ts` (`SynthSlice`, `UiSlice`)
- Modify: `src/utils/synthControl.ts:130-143`, `src/utils/synthControl.test.ts:72`
- Modify: `src/components/loop/chord/AdjustSynthButton.tsx:14-20`
- Modify: `src/types.ts:10-12` and `:19-32` (two docblocks)
- Modify: `src/store/melodyTracks.ts:93-100`, `src/store/projectFormat.ts:227`, `src/store/projectSlice.ts:91`, `src/App.tsx:102`, `CLAUDE.md:54`
- Modify: `src/store/store.test.ts` (`controlTarget` at 181, the `patternSegment` describe at 1539), `src/store/projectSlice.test.ts:57,71,425`, `src/store/projectDirty.test.ts:32,90`, `src/store/projectFingerprint.test.ts:43`, `src/store/projectFormat.test.ts:34,53,95-97`

**Interfaces:**
- Consumes: `MixLayerId`, `setFocusTrack`.
- Produces:
  ```ts
  // src/utils/synthControl.ts — SynthTargetNavigation loses setControlTarget
  export interface SynthTargetNavigation {
    setFocusTrack: (focus: MixLayerId) => void;
    setActiveTab: (tab: ViewMode) => void;
  }
  export function focusSynthTarget(focus: MixLayerId, nav: SynthTargetNavigation): void;
  ```
  After this task `AppStore` has neither `controlTarget` nor `patternSegment`, and neither `setControlTarget` nor `setPatternSegment`. `SynthControlTarget`, `PatternSegment`, `SYNTH_TARGET_STYLES`, `PATTERN_SEGMENTS` and `PATTERN_SEGMENT_IDS` all survive.

- [ ] **Step 1: Write the failing test**

Replace the `describe('patternSegment', …)` block in `src/store/store.test.ts` (1539-1553) with:

```ts
describe('the merged navigation state', () => {
  /**
   * `controlTarget` and `patternSegment` are gone from the store, not renamed
   * around. A field that still exists but nothing reads is the shape this
   * change exists to delete, and it would go on being written by every old
   * call site with nothing failing.
   */
  test('neither controlTarget nor patternSegment is a field any more', async () => {
    const { useAppStore } = await getStore();
    const s = useAppStore.getState() as Record<string, unknown>;
    expect('controlTarget' in s).toBe(false);
    expect('patternSegment' in s).toBe(false);
    expect('setControlTarget' in s).toBe(false);
    expect('setPatternSegment' in s).toBe(false);
  });
});
```

and change line 181's `expect(s.controlTarget).toBe('synth');` to `expect(s.focusTrack).toBe('synth');`.

- [ ] **Step 2: Run the test and see it fail**

Run: `bun test src/store/store.test.ts -t "merged navigation state"`
Expected: FAIL — `expect('controlTarget' in s).toBe(false)` receiving `true`.

- [ ] **Step 3: Delete the two fields and rewire the last writer**

`src/store/synthSlice.ts` — delete `controlTarget: 'synth',` and `setControlTarget: (controlTarget) => set({ controlTarget }),`, and change the docblock's last clause to:

```
 * Synth slice: the three param sets (main synth, chord mode, bass module).
 * Which of them the Sound page's knobs control is no longer a field here — it
 * is derived from the ui slice's `focusTrack` through
 * `controlTargetForFocus` (store/focusTrack.ts).
```

`src/store/uiSlice.ts` — delete `patternSegment: 'lead',` and `setPatternSegment: (patternSegment) => set({ patternSegment }),`.

`src/store/types.ts` — delete `controlTarget: SynthControlTarget;` and `setControlTarget` from `SynthSlice`, and `patternSegment: PatternSegment;` (with its comment) and `setPatternSegment` from `UiSlice`. In `UiSlice`'s `soloTracks` docblock, replace "for every writer of the LAYER (Loop ↔ Song), of patternSegment and of activeLoopId at once. A Sound ↔ Pattern tab change does NOT clear it — see soloNav.ts for why that survival matters — but a Pattern-segment change still does." with:

```
   * every writer of the LAYER (Loop ↔ Song) and of activeLoopId at once.
   * Neither a tab change within the Loop layer nor a `focusTrack` change
   * clears it — see soloNav.ts for why the focus survival is what makes a
   * multi-track set buildable at all.
```

Remove any now-unused `SynthControlTarget` / `PatternSegment` imports from `types.ts` that `tsc` flags.

`src/utils/synthControl.ts` — replace 130-143 with:

```ts
export interface SynthTargetNavigation {
  setFocusTrack: (focus: MixLayerId) => void;
  setActiveTab: (tab: ViewMode) => void;
}

export function focusSynthTarget(focus: MixLayerId, nav: SynthTargetNavigation): void {
  // Focus first: the Sound view is always mounted, so switching the tab last
  // means it never renders a frame pointed at the previous track.
  nav.setFocusTrack(focus);
  nav.setActiveTab('sound');
}
```

with `import type { MixLayerId } from '../store/focusTrack';` at the top. (`src/utils/` sits above `data/` and outside the store→components chain; importing a store type here is allowed and is what `MeterId` already does in the other direction.)

`src/utils/synthControl.test.ts:72` — change `setControlTarget: (target: SynthControlTarget) => calls.push(['target', target]),` to `setFocusTrack: (focus: MixLayerId) => calls.push(['target', focus]),`, with the import swapped.

`src/components/loop/chord/AdjustSynthButton.tsx` — replace the store read and the click handler:

```tsx
  const setFocusTrack = useAppStore((s) => s.setFocusTrack);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const label = SYNTH_TARGET_STYLES[target].label;
  return (
    <button
      type="button"
      onClick={() => focusSynthTarget(target, { setFocusTrack, setActiveTab })}
```

The `target: SynthControlTarget` prop stays: every call site passes a melodic target and `SynthControlTarget` is assignable to `MixLayerId`.

- [ ] **Step 4: Rewrite the six docblocks and comments this falsifies**

- `src/types.ts:10-12` (the `ViewMode` docblock): "Pattern's three segments are a SECOND axis (`patternSegment` in the ui slice), not three more view ids" → "Pattern's four segments are DERIVED from `focusTrack` (`segmentForFocus`, store/focusTrack.ts), not three more view ids".
- `src/types.ts:19-32` (the `PATTERN_SEGMENT_IDS` docblock): replace "A second axis alongside `ViewMode`, not three more view ids: the URL carries the tab, and a segment is a position inside one tab. Kept here rather than in store/types.ts because both the store and the components read it, exactly as `ViewMode` is." with:

  ```
   * DERIVED from `focusTrack`, not stored: `segmentForFocus` (store/focusTrack.ts)
   * maps the six focus ids onto these four. A segment is still a position
   * inside one tab rather than a route — the URL carries the tab and nothing
   * else — but it is no longer an axis of its own that could disagree with the
   * Sound view's target. Kept here rather than in store/types.ts because both
   * the store and the components read it, exactly as `ViewMode` is.
  ```

- `src/store/melodyTracks.ts:93-100`: the sentence "every actual control-target read goes through `s.controlTarget` on the zustand store directly, a different value entirely" is false. Replace with "every actual control-target read now goes through `controlTargetForFocus(focusTrack)` (store/focusTrack.ts), a different value entirely". Leave the rest of that paragraph — the point it makes about dead data is unchanged.
- `src/store/projectFormat.ts:227`: "`controlTarget` and `metronomeActive` are deliberately absent: they are user preferences, not project state." → "`focusTrack` and `metronomeActive` are deliberately absent: they are user preferences, not project state."
- `src/store/projectSlice.ts:91`: "this patch writes neither activeTab nor patternSegment" → "this patch writes neither activeTab nor focusTrack".
- `src/App.tsx:102`: "of layer/patternSegment/activeLoopId — see store/soloNav.ts." → "of layer/activeLoopId — see store/soloNav.ts."
- `CLAUDE.md:54`: "`PatternView.tsx` on `patternSegment`" → "`PatternView.tsx` on `segmentForFocus(focusTrack)`". In the same sentence's surrounding paragraph, no other edit is needed.

- [ ] **Step 5: Fix the remaining test fixtures**

- `src/store/projectSlice.test.ts:57` — `controlTarget: 'bass'` → `focusTrack: 'bass'`; line 71 → `expect(s.focusTrack).toBe('bass');`; line 425's comment "Same activeTab, same patternSegment, same activeLoopId" → "Same activeTab, same focusTrack, same activeLoopId".
- `src/store/projectDirty.test.ts:32` — `controlTarget: 'synth'` → `focusTrack: 'synth'`; line 90 — `store.setState({ controlTarget: 'bass', … })` → `store.setState({ focusTrack: 'bass', … })`.
- `src/store/projectFingerprint.test.ts:43` — `controlTarget: 'bass'` → `focusTrack: 'bass'`.
- `src/store/projectFormat.test.ts:34` — `controlTarget: 'bass'` → `focusTrack: 'bass'`; line 53's excluded-key list entry `'controlTarget'` → `'focusTrack'`; line 95's test name and line 97's assertion → `focusTrack`.

- [ ] **Step 6: Run the full suite and see it pass**

Run: `bun test && bun run lint && bun run eslint`
Expected: all green; `tsc --noEmit` silent; eslint prints nothing at all — no errors and no warnings.

- [ ] **Step 7: Run the completion gate**

Run: `bun run verify`
Expected: PASS — `bun test`, `bun run lint`, `bun run eslint`, `check:keys`, `check:drums`, `check:contrast`, `check:levels` and `build` all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(store): delete controlTarget and patternSegment

Both are now derived from focusTrack — controlTargetForFocus and
segmentForFocus — so neither is a field, and neither has a setter. Deleted
rather than left as write-only state: a field nothing reads goes on being
written by every old call site with nothing failing. focusSynthTarget's
navigation interface takes setFocusTrack, and the six docblocks this
falsifies (types.ts x2, melodyTracks, projectFormat, projectSlice, App,
CLAUDE.md) are rewritten here rather than in a later doc pass.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage — every Plan 1 requirement.**

| Spec requirement (Plan 1 scope) | Task |
|---|---|
| `focusTrack` replaces both values, id type `MixLayerId`, `'synth'` means Lead, no rename | 1, 2, 9 |
| Lives in the ui slice with `setFocusTrack` | 2 |
| Persisted top-level in `controlTarget`'s place; not project content | 2 |
| `segmentForFocus` total, `synth→lead`, `fx→fx`, chord/bass/pad→accompaniment, drum→beat | 1 |
| `controlTargetForFocus` partial by TYPE over `MelodicFocus`; `??` in `resolveSynthControlChannel` kept | 1, 3 |
| `MelodicFocus`, `isMelodicFocus`, `melodyTrackForFocus` exported from `focusTrack.ts` | 1 |
| Both projections independently tested, literal expected maps, `Assert<T extends true>` for the drum case | 1 |
| `focusTrack.ts` in `src/store/`, no runtime imports, readable by components | 1 (+ layering wrinkle resolved in Global Constraints) |
| Sound synth panels + Pro/Simple cards read `controlTargetForFocus(focus)` | 3 |
| Sound Target row → 6 chips writing `setFocusTrack`, `SYNTH_TARGET_STYLES` for five, `MIX_LAYERS` drum row for the sixth | 4 |
| Synth section hidden and Drum Sound shown on a drum focus | 4 |
| Mixer row click sets focus | 6 |
| Pattern gate reads the projection | 5 |
| Pattern segment row: `accompaniment` active for chord/bass/pad, always sends `chord`, no last-used memory | 1, 5 |
| Accompaniment stays one screen | 5 (no change made — the segment still renders `ChordView` whole) |
| Input dock focus chip, always visible, shows and sets | 7 |
| Input dock panel auto-switch, tabs stay clickable | 7 |
| Solo: drop `patternSegment` from `SOLO_NAV_SOURCES`; focus change never clears; docblock + both exhaustive tests + the new survival test | 8 |
| CLAUDE.md solo paragraph rewritten in the same commit | 8 |
| Persistence: new sanitize clause, no version bump, old keys ignored | 2 |
| Deletions: `controlTarget`/`setControlTarget`, `patternSegment`/`setPatternSegment`, `focusSynthTarget`/`SynthTargetNavigation` swap | 9 |
| Not deleted: `SynthControlTarget`, `PatternSegment`, `SYNTH_TARGET_STYLES`, `PATTERN_SEGMENTS`, `PATTERN_SEGMENT_IDS` | 9 |
| Docblock rewrites 3 (soloNav), 6 (`PATTERN_SEGMENT_IDS`), 7-partial (CLAUDE.md solo) | 8, 9 |
| `KEYBOARD_AUDITION_TARGET` untouched, stated as deliberate | Goal + "What this plan deliberately leaves broken" + Task 4 step 4(f) |

Docblock rewrites 1 (`useInputDeck`), 2 (`arpPlayback`), 4 (`melodyTracks` recording column), 5 (`SoundView.test.tsx`'s keyboard-audition block) and the FX-recorder half of 7 belong to Plans 2 and 3 and are correctly absent. **One gap found and closed inline:** the spec names only two projections, but Pattern's segment row needs the inverse to know what to write — `focusForSegment` was added to Task 1's Interfaces and implemented and tested there, with its own docblock stating why it is a separate table rather than a search of `SEGMENT_FOR_FOCUS`. **A second gap found and closed inline:** the spec's per-surface table keeps the target row inside the Synth section while also hiding that section on a drum focus, which would strand the user; Task 4 step 4(d) moves the row out and asserts it stays on screen.

**2. Placeholder scan.** No `TBD`, no "add validation", no "similar to Task N", no "write tests for the above". Every code step carries the actual code. The one place a step says "replace every remaining `SYNTH_TARGET_STYLES[controlTarget]` reference" (Task 4, step 4(b)) names the exact replacement identifier and the narrowing that makes it type-check, and the line numbers of every site are in the task's Files block.

**3. Type consistency.** `MixLayerId` is used identically in every task. `MelodicFocus` appears only in `controlTargetForFocus`'s signature and Task 1's compile-time assertion. `soloTrackForFocus` is named that in Task 4's Produces, in `trackAudibility.ts`, in its test and at the SoundView call site — never `soloTrackForControlTarget`, which Task 4 deletes outright. `segmentForFocus` / `focusForSegment` / `melodyTrackForFocus` / `isMelodicFocus` / `isMixLayerId` / `panelModeForFocus` are spelled the same in every task that names them. `setFocusTrack: (focus: MixLayerId) => void` is the same signature in `types.ts`, `uiSlice.ts`, `SynthTargetNavigation` and every call site. The DOM id families are disjoint and consistent: `btn-focus-<id>` (Sound row), `btn-mix-focus-<id>` (mixer), `btn-focus-chip` / `btn-focus-chip-<id>` (dock), `segment-<id>` (Pattern, unchanged).

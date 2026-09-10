# Focus Track — Plan 3: Rec Per Melody Track

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rec a per-melody-track arm: `src/store/leadRecord.ts` becomes a factory over `MELODY_TRACKS` (the `leadSlice` precedent — one factory instantiated twice), `leadRecording: boolean` becomes `recordingTrack: MelodyTrackId | null` so two tracks can never be armed at once, and the Rec button renders on whichever melody grid `melodyTrackForFocus(focusTrack)` names — on neither when focus is chord, bass, pad or drum.

**Architecture:** One scalar holds the armed track; every gate asks `recordingTrack === <its own id>`. The recorder stays a **parallel observer of the note-input bus** (`.claude/rules/note-input.md`), instantiated once per `MELODY_TRACKS` row, with every store field it touches read through the track row rather than a `lead`-prefixed literal. The shared 16th clock's anchor collector is **hoisted out of the per-track bridge into one subscription** — `startLeadLiveClock` is a module singleton whose second concurrent start is a no-op, so two bridges each thinking they own a collector is a real hazard, and the "clock runs iff a player holds a subscription" rule is satisfied by exactly one holder. `recordLeadNote` moves out of `createLeadSlice` and into `createMelodySlice`, producing `recordFxNote` for free.

**Tech Stack:** TypeScript, React 19, Zustand (`persist` + `subscribeWithSelector`), Bun test runner (`bun:test`, `renderToString` from `react-dom/server`), Vite, Tailwind v4 + daisyUI v5, ESLint 9 flat config.

**Spec:** `docs/superpowers/specs/2026-09-10-focus-track-design.md` — this plan covers **only** its "Plan 3" from the `## Scope — this is five sequenced plans, not one` section (the `## Rec` section). The state model (Plan 1), voice routing (Plan 2), MIDI (Plan 4) and preview length (Plan 0) are out of scope here.

**Depends on:** Plan 1 (`docs/superpowers/plans/2026-09-10-focus-track-plan-1-state-model.md`) **must be merged first** — this plan consumes `focusTrack` on the store and `melodyTrackForFocus` from `src/store/focusTrack.ts`. It is **independent of Plan 2 and Plan 4** and may land in any order against them.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`bun run verify` is the completion gate** — run it before claiming any task is done. It runs `bun test`, `bun run lint`, `bun run eslint`, `check:keys`, `check:drums`, `check:contrast`, `check:levels` and `build`.
- **`bun run eslint` must report nothing at all — zero errors AND zero warnings.** That is the state to keep it in. A new `eslint-disable` line must name its reason; an `eslint-disable` whose reason has stopped being true is deleted, not left standing (Task 2 deletes one).
- **`src/store/` must not import `components/`.** `no-restricted-imports` bans the whole group for `src/store/**/*.{ts,tsx}`, and it is not relaxed for type-only imports — only `**/*.test.ts` / `**/*.test.tsx` are exempt.
- **`src/components/` must not import `audio/engine`.** The allowlist is in `eslint.config.js`; this plan adds nothing to it.
- **`src/data/` imports nothing at runtime** and declares no function. Nothing in this plan touches `src/data/`.
- **No DOM and no testing-library**, and none may be added. Prefer a pure exported helper over a render; where markup *is* the behaviour, use `renderToString` substring assertions written as single literal substrings.
- **The zustand + `renderToString` trap:** zustand serves `getServerSnapshot` from `api.getInitialState()`, captured at store creation, so `useAppStore.setState(...)` before a `renderToString` silently has no effect. **Any component whose markup must reflect a test-set `focusTrack` or `recordingTrack` reads the store through `useLiveStore`** (`src/components/ui/useLiveStore.ts`, which serves `getState()` for both snapshots — see `src/components/ui/BottomInputDock.tsx`).
- **Time is injected, never mocked.** `leadRecord.ts` takes a `LeadRecordDeps` (`{ inputStep, startClock }`, defaulted to `REAL_CLOCK`); tests pass a fake instead of touching timers or an `AudioContext`.
- **No migration chains.** `PERSIST_VERSION` is not bumped and `PROJECT_FORMAT_VERSION` is not touched. See "Persistence: what was found" below — nothing in this plan reaches persisted state or project content.
- **The note-input rules (`.claude/rules/note-input.md`) constrain this plan and are unchanged by it:** the recorder is a parallel observer of `noteInputBus`, never wired into a keyboard per track; previews (`synthPlaybackPreview`) must not announce; both note edges must be announced, because live capture reads the on/off gap.
- **The shared 16th clock runs if and only if a player holds a subscription.** A permanent subscriber keeps the 25 ms timer alive for the life of the app. This plan must not add a second permanent holder.
- **Feature work never lands as a commit on `main`.** Branch first: `feat/focus-track-rec-per-track`.
- **Commit messages are conventional commits** and end with the trailer:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **A docblock or a CLAUDE.md sentence this change falsifies is rewritten in the same commit that falsifies it.** No doc-sync commit at the end — that is how a false sentence survives a review that had the code in front of it. Two sentences are falsified in two different commits and are therefore edited twice, with the exact text for each given in Task 1 and Task 5.

## Persistence: what was found

**The arm flag is neither persisted nor project content, so nothing here needs a sanitize clause or a version bump.** Verified before renaming:

- `partializeAppState` (`src/store/store.ts:184-201`) does not list `leadRecording`. Its allow-list is `bpm`, `meterId`, `masterVolume`, `metronomeActive`, `selectedVibeId`, `controlTarget` (→ `focusTrack` after Plan 1), `effects`, `customSynthPresets`, `customChordProgressions`, `loops`, `activeLoopId`, `currentProjectId`, `projectBaselineHash`.
- `src/store/leadSlice.test.ts` already pins that with an explicit test — *"arming is NOT persisted — a reload must never come back recording"* — asserting `'leadRecording' in partializeAppState(...)` is `false`. **That test is kept, retargeted at `recordingTrack`, in Task 1.**
- `LeadSlice`'s own docblock states the reason: *"an armed recorder surviving a reload would capture the first note of the next session into a project the user thought they had only opened."* It moves with the field.
- `grep -n 'leadRecording' src/store/store.ts src/store/loopSlice.ts src/store/projectFile.ts src/store/loops.ts` returns nothing: it is not a per-loop field, not in `LOOP_FLAT_KEYS`, and not in `PROJECT_CONTENT_KEYS`.

Consequence: `recordingTrack` lands in the **ui slice**, beside `focusTrack` and `soloTracks` — the slice whose every field is session-only — and `sanitizePersistedState`, `sanitizeContent`, `PERSIST_VERSION` and `PROJECT_FORMAT_VERSION` are all untouched by this plan.

## Interaction with Plan 2 — stated explicitly

An earlier draft of this design forced the keyboard back to Lead whenever Rec was armed, so that what you heard was what got written. **Per-track Rec removes the need for that rule entirely: the armed track IS the focused track**, because the Rec button only exists on the focused melody grid and `startRecordArmSync` (Task 5) disarms the moment focus leaves the armed track.

Therefore:

- **This plan must not introduce, and Plan 2 must not preserve, any coupling between `recordingTrack` and the audition target.** No "force focus to the armed track", no "override `controlTargetForFocus` while armed", no read of `recordingTrack` anywhere in `src/components/useInputDeck.ts`, `src/audio/playback/arpPlayback.ts` or `src/store/midiInput.ts`.
- **Checked, not assumed:** the approved spec's *Voice safety* section contains no such rule; Plan 1 contains none; and `docs/superpowers/plans/2026-09-10-focus-track-plan-2-voice-routing.md` as written mentions `recordingTrack` exactly once, in its out-of-scope list. There is nothing to delete today. **If a later revision of Plan 2 acquires one, it is a deletion, not a thing to preserve** — record the deletion in that commit and cite this section.
- The arm follows focus in **one direction only**: focus changes disarm, and arming never moves focus. Arming on navigation would put the app into record because the user clicked a mixer row.

## What this plan deliberately does not do

- It does not rename `src/store/leadRecord.ts`. The generic factory lives in the `lead`-named file exactly as `createMelodySlice` lives in `leadSlice.ts`, and `.claude/rules/note-input.md`'s `paths:` front-matter names `src/store/leadRecord.ts` — a rename would silently drop that rule's auto-loading.
- It does not add an `fxRecording` field, or any per-track `recording` column on `MELODY_TRACKS`. One scalar is the whole point (Task 1).
- It does not touch `KEYBOARD_AUDITION_TARGET`, the arp, or MIDI. After this plan the FX grid can be armed and captures correctly, while the keyboard still *sounds* Lead until Plan 2 lands. That is visibly incomplete, never broken — and it is exactly why the arm must not be coupled to the audition target: coupling it would make Plan 3 depend on Plan 2.

---

## File Structure

**Modified**

| Path | Change |
|---|---|
| `src/store/types.ts` | `leadRecording` / `setLeadRecording` off `LeadSlice`; `recordingTrack` / `setRecordingTrack` onto `UiSlice`; `recordFxNote` onto `FxSlice`; three docblocks. |
| `src/store/uiSlice.ts` | `recordingTrack: null` + `setRecordingTrack`. |
| `src/store/leadSlice.ts` | `recordLeadNote` moves from `createLeadSlice` into `createMelodySlice` and reads every field through `track`; `ACTIONS` gains a `record` column; the `get` parameter's `eslint-disable` is deleted because `get` is now used; two docblocks. |
| `src/store/leadRecord.ts` | The bridge becomes `startMelodyRecordBridge(track, deps)`; the clock collector is hoisted into `startLiveClockCollector`; `startMelodyRecordBridges` composes both plus `startRecordArmSync`; `leadClockActive` gains the `fxPlayer` term; `leadMarkerFollowsClock` takes a `trackId`. |
| `src/store/engineSync.ts` | `startLeadRecordBridge()` → `startMelodyRecordBridges()`. |
| `src/store/melodyTracks.ts` | The "There is no `recording` column: live capture is lead-only" paragraph. |
| `src/components/loop/lead/LeadMelodyGrid.tsx` | Rec reads/writes `recordingTrack` and renders only on the focused melody grid. |
| `src/components/loop/lead/useLeadMarker.ts` | Gate becomes `leadMarkerFollowsClock(s, trackId)`; docblock. |
| `src/components/loop/lead/useLeadStepPublisher.ts` | Same gate for both tracks; two docblocks. |
| `.claude/rules/note-input.md` | The `setLeadNoteLength` sentence, which now names one of two setters. |
| `CLAUDE.md` | The "FX has no live recorder" sentence in the FX-track paragraph (twice: Task 1 and Task 5). |

**Tests modified**

`src/store/uiSlice.test.ts`, `src/store/leadSlice.test.ts`, `src/store/fxSlice.test.ts`, `src/store/leadRecord.test.ts`, `src/components/loop/lead/useLeadStepPublisher.test.ts`, `src/components/loop/lead/LeadMelodyGrid.test.tsx`.

**Created:** nothing. Every new export lands in a file that already exists.

---

### Task 1: `recordingTrack` replaces `leadRecording`

One scalar, in the ui slice, with every reader retargeted. **No behaviour change** — Rec is still lead-only and still renders only on the lead grid — so this task is reviewable purely as "is the state in the right place and the right shape".

**Files:**
- Modify: `src/store/types.ts:224-228` (the `leadRecording` pair on `LeadSlice`), `src/store/types.ts:371-400` (`UiSlice`, after `soloTracks`)
- Modify: `src/store/uiSlice.ts:69-86` (initial state and setters)
- Modify: `src/store/leadSlice.ts:326-339` (`createLeadSlice`)
- Modify: `src/store/leadRecord.ts:60-66` (`leadMarkerFollowsClock`), `src/store/leadRecord.ts:141-149` (the note-off re-check)
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx:547-548`, `:771-790`
- Modify: `CLAUDE.md:223` (the "FX has no live recorder" sentence)
- Test: `src/store/uiSlice.test.ts`, `src/store/leadSlice.test.ts:26`, `:555-566`, `src/store/leadRecord.test.ts:36`, `:107`, `:202`, `:291-330`

**Interfaces:**
- Consumes: `MelodyTrackId` from `@/store/melodyTracks`; `focusTrack` exists on the store (Plan 1) but is not read yet.
- Produces:
  ```ts
  // on AppStore (UiSlice)
  recordingTrack: MelodyTrackId | null;   // creation-time value null
  setRecordingTrack: (track: MelodyTrackId | null) => void;
  ```
  `leadRecording` and `setLeadRecording` no longer exist anywhere. `leadMarkerFollowsClock`'s state parameter swaps `leadRecording: boolean` for `recordingTrack: MelodyTrackId | null`; its arity is unchanged in this task.

- [ ] **Step 1: Branch off `main`**

```bash
git checkout main
git pull
git checkout -b feat/focus-track-rec-per-track
```

- [ ] **Step 2: Write the failing tests**

Append to `src/store/uiSlice.test.ts`:

```ts
describe('recordingTrack — the armed melody track', () => {
  afterEach(() => {
    useAppStore.getState().setRecordingTrack(null);
  });

  test('starts disarmed', () => {
    expect(useAppStore.getState().recordingTrack).toBeNull();
  });

  /**
   * ONE value, not a boolean per track. A pair of booleans has nothing
   * stopping both being true, and one live-capture clock would then write two
   * grids from a single keypress — a state no UI can reach, so no test would
   * find it. The type makes it unrepresentable instead, and this test is what
   * pins the type's intent to a behaviour a reviewer can read.
   */
  test('arming a second track replaces the first — two can never be armed at once', () => {
    useAppStore.getState().setRecordingTrack('lead');
    useAppStore.getState().setRecordingTrack('fx');
    expect(useAppStore.getState().recordingTrack).toBe('fx');
  });

  test('is NOT persisted — a reload must never come back recording', () => {
    useAppStore.getState().setRecordingTrack('lead');
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('recordingTrack' in persisted).toBe(false);
    expect('leadRecording' in persisted).toBe(false);
  });
});
```

`afterEach`, `describe`, `expect`, `test`, `partializeAppState` and `useAppStore` are already imported at the top of that file.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/store/uiSlice.test.ts -t "recordingTrack"`
Expected: FAIL — `TypeError: useAppStore.getState().setRecordingTrack is not a function` on the second and third tests, and `expect(received).toBeNull()` with `Received: undefined` on the first.

- [ ] **Step 4: Add the field to the store types**

In `src/store/types.ts`, add the type import beside the other store-table type imports (`melodyTracks.ts` imports only `import type { SoloTrack }` from `./trackAudibility`, so this is a type-only edge and cannot create a runtime cycle):

```ts
import type { MelodyTrackId } from './melodyTracks';
```

Delete this from `interface LeadSlice`:

```ts
  /**
   * Rec arming. NOT persisted: an armed recorder surviving a reload would
   * capture the first note of the next session into a project the user
   * thought they had only opened.
   */
  leadRecording: boolean;
  setLeadRecording: (recording: boolean) => void;
```

Add this to `interface UiSlice`, immediately after the `soloTracks: SoloTrack[];` field:

```ts
  /**
   * The melody track Rec is armed on, or null when nothing is armed.
   *
   * ONE value, not a boolean per track. Two booleans would have nothing
   * stopping both being true, and one live-capture clock would then write two
   * grids from a single keypress — a state unreachable through the UI, so no
   * test would find it. `MelodyTrackId | null` makes it unrepresentable.
   *
   * It lives HERE rather than on LeadSlice/FxSlice because it spans both: a
   * per-track slice cannot own a value whose whole purpose is being unique
   * ACROSS tracks. That is also why MELODY_TRACKS gains no `recording`
   * column — see its docblock.
   *
   * Session-only and NEVER persisted, like everything else in this slice: it
   * is absent from partializeAppState and must stay absent, because an armed
   * recorder surviving a reload would capture the first note of the next
   * session into a project the user thought they had only opened.
   */
  recordingTrack: MelodyTrackId | null;
```

and this to the actions block, after `clearSoloTracks: () => void;`:

```ts
  setRecordingTrack: (track: MelodyTrackId | null) => void;
```

- [ ] **Step 5: Implement it in the ui slice**

In `src/store/uiSlice.ts`, add to the returned object after `soloTracks: [],`:

```ts
    recordingTrack: null,
```

and after the `clearSoloTracks` action:

```ts
    // A plain setter, not a toggle: the button knows which track it is on and
    // computes `armed ? null : trackId` itself, so the store never has to
    // guess which track a bare "toggle" meant.
    setRecordingTrack: (recordingTrack) => set({ recordingTrack }),
```

No import is needed here — `createUiSlice` returns `UiSlice`, so both the `null` and the setter's parameter are contextually typed.

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `bun test src/store/uiSlice.test.ts -t "recordingTrack"`
Expected: PASS (3 tests).

- [ ] **Step 7: Retarget every reader**

In `src/store/leadSlice.ts`, `createLeadSlice` loses the two fields and the record action's guard changes:

```ts
export function createLeadSlice(set: Set, get: Get): LeadSlice {
  const melody = createMelodySlice(melodyTrack('lead'), set, get);
  const paintLeadNote = melody.paintLeadNote as LeadSlice['paintLeadNote'];

  return {
    ...melody,

    // Returns whether it actually wrote, so a caller can tell a captured note
    // from one the grid refused.
    recordLeadNote: (note, column) => {
      const state = get();
      // The ARMED TRACK, not a boolean: one scalar in the ui slice holds it,
      // so each track asks whether the arm is pointed at it.
      if (state.recordingTrack !== 'lead') return false;
```

(the rest of `recordLeadNote` is unchanged in this task).

In `src/store/leadRecord.ts`, `leadMarkerFollowsClock`'s parameter and body:

```ts
export function leadMarkerFollowsClock(state: {
  sequencerPlayer: PlayerState;
  chordsPlayer: PlayerState;
  leadPlayer: PlayerState;
  recordingTrack: MelodyTrackId | null;
}): boolean {
  return (
    isPlayerActive(state.leadPlayer) ||
    (state.recordingTrack === 'lead' && leadClockActive(state))
  );
}
```

with `import type { MelodyTrackId } from './melodyTracks';` added to that file's imports, and its docblock's sentence *"recordLeadNote returns false while leadRecording is off"* rewritten to *"recordLeadNote returns false unless `recordingTrack` names this track"*.

In the same file, the note-off re-check:

```ts
      if (len > entry.stride && useAppStore.getState().recordingTrack === 'lead') {
```

with the comment above it rewritten from *"leadRecording is re-checked here"* to:

```ts
      // The ARM is re-read here, not assumed from note-on: a press that
      // started while armed can still be held after Rec is switched off — or
      // after the arm has moved to the other melody track — and its release
      // must not reach back and lengthen a note that was never meant to grow
      // past its initial write.
```

In `src/components/loop/lead/LeadMelodyGrid.tsx`, replace lines 547-548:

```ts
  const recordingTrack = useAppStore((s) => s.recordingTrack);
  const setRecordingTrack = useAppStore((s) => s.setRecordingTrack);
  const armed = recordingTrack === trackId;
```

and the Rec button's three bindings:

```tsx
                onClick={() => setRecordingTrack(armed ? null : trackId)}
                pressed={armed}
                title={
                  armed
                    ? 'Stop recording played notes into the grid'
                    : `Record played notes into bar ${selectedBar + 1}, from the selected step`
                }
```

The `{trackId === 'lead' && (` wrapper stays for now; Task 5 replaces it.

- [ ] **Step 8: Update the existing tests**

`src/store/leadSlice.test.ts`: in `resetLead` (line 26) `leadRecording: false,` → `recordingTrack: null,`; the `arm` helper (line 555) becomes `const arm = (): void => useAppStore.getState().setRecordingTrack('lead');`; the "arming is off by default and toggles" test becomes:

```ts
  test('arming is off by default and points at the track it was set to', () => {
    expect(useAppStore.getState().recordingTrack).toBeNull();
    arm();
    expect(useAppStore.getState().recordingTrack).toBe('lead');
  });
```

and the not-persisted test's assertion becomes `expect('recordingTrack' in persisted).toBe(false);`.

`src/store/leadRecord.test.ts`: `beforeEach`'s `leadRecording: true,` → `recordingTrack: 'lead',`; both `useAppStore.setState({ leadRecording: false })` (lines 107, 202) → `useAppStore.setState({ recordingTrack: null })`; the `markerState` fixture's `leadRecording: false,` → `recordingTrack: null,` and the three `{ …, leadRecording: true }` overrides → `{ …, recordingTrack: 'lead' }`.

- [ ] **Step 9: Rewrite the CLAUDE.md sentence this commit falsifies**

`CLAUDE.md` currently reads, in the FX-track paragraph:

> **FX has no live recorder** — `leadRecording` and `store/leadRecord.ts` stay lead-only —
> and it is not a constraint on the material: a user who wants a counter-melody writes one and the
> track behaves identically.

The field named in it no longer exists. Replace exactly that sentence with:

> **FX has no live recorder yet** — the armed track is one scalar (`recordingTrack` in the ui
> slice) and only Lead's grid can point it anywhere — and it is not a constraint on the material:
> a user who wants a counter-melody writes one and the track behaves identically.

Task 5 rewrites it again, once FX *is* armable; both edits ship in the commit that makes their predecessor false.

- [ ] **Step 10: Run the full gate**

Run: `bun run verify`
Expected: PASS. If `bun run lint` reports `Property 'leadRecording' does not exist on type 'AppStore'`, a reader was missed — `grep -rn "leadRecording\|setLeadRecording" src/ CLAUDE.md` must return nothing.

- [ ] **Step 11: Commit**

```bash
git add src/store/types.ts src/store/uiSlice.ts src/store/uiSlice.test.ts src/store/leadSlice.ts src/store/leadSlice.test.ts src/store/leadRecord.ts src/store/leadRecord.test.ts src/components/loop/lead/LeadMelodyGrid.tsx CLAUDE.md
git commit -m "$(cat <<'EOF'
refactor(rec): one armed track, not a lead-only boolean

leadRecording: boolean becomes recordingTrack: MelodyTrackId | null in the ui
slice. One value, so two tracks can never be armed at once — two booleans
would let one live-capture clock write two grids from a single keypress, and
nothing in the UI could reach that state for a test to find it.

Behaviour is unchanged: Rec is still lead-only and still renders only on the
lead grid. The field is session-only and stays absent from partializeAppState.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `recordLeadNote` moves into the melody-slice factory

The record action becomes the fourteenth action `createMelodySlice` builds, so `recordFxNote` exists with no second implementation. Every field it reads comes from the `track` row.

**Files:**
- Modify: `src/store/leadSlice.ts:75-93` (the `ACTIONS` type and both rows), `:126-137` (the `get` parameter comment), `:98-112` (the factory docblock), `:200-210` (the `slice` object, where the record action is added), `:326-400` (`createLeadSlice` collapses)
- Modify: `src/store/types.ts:228-241` (`LeadSlice.recordLeadNote`'s docblock), `:260-266` (the `FxSlice` docblock), `:300-305` (`FxSlice` gains `recordFxNote`)
- Test: `src/store/fxSlice.test.ts`

**Interfaces:**
- Consumes: `recordingTrack` on the store (Task 1); `MELODY_TRACKS` / `melodyTrack` from `./melodyTracks`.
- Produces:
  ```ts
  // on AppStore (FxSlice)
  recordFxNote: (note: string, column?: number) => boolean;
  ```
  `recordLeadNote`'s signature is unchanged. Both are produced by `createMelodySlice(track, set, get)` and both return `false` unless `recordingTrack === track.id`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/fxSlice.test.ts`:

```ts
describe('recordFxNote — the same factory, pointed at the fx row', () => {
  beforeEach(() => {
    useAppStore.setState({
      fxMelodySteps: empty(),
      leadMelodySteps: empty(),
      fxLoopLength: 1,
      fxStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
      fxMelodyView: 'chromatic',
      fxMelodyOctave: 3,
      fxCursor: 2,
      meterId: '4/4',
      recordingTrack: null,
      scaleRoot: 'C',
      scaleType: 'Major',
    });
  });

  const fxAt = (col: number): string[] => {
    const state = useAppStore.getState();
    const stepsPerBar = getMeter(state.meterId).stepsPerBar;
    return state.fxMelodySteps[leadStoredIndexAt(col, stepsPerBar, stride)].map((n) => n.note);
  };

  test('declines while the arm points at the other track, and writes when it points here', () => {
    useAppStore.setState({ recordingTrack: 'lead' });
    expect(useAppStore.getState().recordFxNote('C4')).toBe(false);
    expect(fxAt(2)).toEqual([]);

    useAppStore.setState({ recordingTrack: 'fx' });
    expect(useAppStore.getState().recordFxNote('C4')).toBe(true);
    expect(fxAt(2)).toEqual(['C4']);
  });

  test('writes the FX grid and never the lead grid', () => {
    useAppStore.setState({ recordingTrack: 'fx' });
    useAppStore.getState().recordFxNote('C4');
    expect(useAppStore.getState().leadMelodySteps.every((row) => row.length === 0)).toBe(true);
  });

  test('honours the FX view field, not the lead one', () => {
    useAppStore.setState({ recordingTrack: 'fx', fxMelodyView: 'scale-locked', leadMelodyView: 'chromatic' });
    expect(useAppStore.getState().recordFxNote('C#4')).toBe(false);
    expect(fxAt(2)).toEqual([]);
  });
});
```

Add `import { leadStoredIndexAt } from '@/audio/leadMelody';` to that file's imports (`getMeter`, `stride`, `empty` and `DEFAULT_LEAD_STEP_RESOLUTION` are already there).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/fxSlice.test.ts -t "recordFxNote"`
Expected: FAIL — `TypeError: useAppStore.getState().recordFxNote is not a function`.

- [ ] **Step 3: Declare the action on the two types**

In `src/store/types.ts`, add to `interface FxSlice` after `setFxNoteLength`:

```ts
  /** Write a PERFORMED note — see LeadSlice.recordLeadNote. Declines unless
   *  `recordingTrack === 'fx'`. */
  recordFxNote: (note: string, column?: number) => boolean;
```

and replace the `FxSlice` docblock's sentence *"There is no `fxRecording`/`recordFxNote` pair — live capture stays lead-only (see `LeadSlice`'s own note on `recordLeadNote`)."* with:

```
 * `recordFxNote` is the fourteenth action the factory builds, and there is no
 * `fxRecording` beside it: the armed track is one scalar in the ui slice
 * (`recordingTrack`), so both tracks' record actions ask the same value which
 * track it names.
```

In `LeadSlice.recordLeadNote`'s docblock, replace *"Declines if not armed"* with *"Declines unless `recordingTrack` names this track"*.

- [ ] **Step 4: Move the implementation into the factory**

In `src/store/leadSlice.ts`, add `record` to the `ACTIONS` value type and to both rows:

```ts
  setCursor: Extract<keyof AppStore, string>; copyBar: Extract<keyof AppStore, string>; pasteBar: Extract<keyof AppStore, string>;
  record: Extract<keyof AppStore, string>;
}> = {
  lead: {
    …
    setCursor: 'setLeadCursor', copyBar: 'copySelectedLeadBar', pasteBar: 'pasteIntoSelectedLeadBar',
    record: 'recordLeadNote',
  },
  fx: {
    …
    setCursor: 'setFxCursor', copyBar: 'copySelectedFxBar', pasteBar: 'pasteIntoSelectedFxBar',
    record: 'recordFxNote',
  },
};
```

Add the action to the `slice` object, immediately after `[actions.setNoteLength]`'s closing `,`:

```ts
    // Live capture's write path, per track. Returns whether it actually
    // WROTE, so a caller can tell a captured note from one the grid refused —
    // store/leadRecord.ts uses that answer to decide whether to hold the note
    // for its note-off to lengthen.
    [actions.record]: (note: string, column?: number): boolean => {
      const state = get();
      // The ARMED track, not "is recording". Both bridges observe the one
      // note-input bus and both call their own record action; this line is
      // what makes exactly one of them write.
      if (state.recordingTrack !== track.id) return false;

      // Both guards exist to keep one promise: a recorded note is visible on
      // the grid the moment it is recorded. Storing what the grid cannot draw
      // would leave notes that play back but cannot be seen or erased.
      if (
        state[track.view] === 'scale-locked' &&
        !isNoteInScale(note, state.scaleRoot, state.scaleType)
      ) {
        return false;
      }
      const octave = leadRecordOctave(
        note,
        state[track.octave],
        LEAD_WINDOW_OCTAVES,
        LEAD_OCTAVE_MIN,
        LEAD_OCTAVE_MAX,
      );
      if (octave === null) return false;

      const stepsPerBar = getMeter(state.meterId).stepsPerBar;
      const stride = strideFor(state[track.stepResolution]);
      // Clamped whichever head it came from: a meter or loop-length change can
      // narrow the window under a column that was legal when it was chosen.
      const target = clampLeadCursor(
        column ?? state[track.cursor],
        state[track.loopLength],
        stepsPerBar,
        stride,
      );
      if (octave !== state[track.octave]) set({ [track.octave]: octave });
      // 'draw', never 'toggle': playing a note that is already at this column
      // must be a no-op, not a delete. A performer repeating a note expects
      // nothing to happen, not the note to vanish.
      const before = state[track.steps];
      paintNote(leadStoredIndexAt(target, stepsPerBar, stride), note, 'draw');
      // And a no-op must REPORT as one. 'draw' declines a column already
      // covered by a note that started earlier, and the live recorder uses
      // this answer to register a held note against that row — told true, it
      // would hold a row that does not contain the pitch, and the note-off's
      // setNoteLength would silently find nothing to lengthen.
      return get()[track.steps] !== before;
    },
```

Collapse `createLeadSlice` to:

```ts
export function createLeadSlice(set: Set, get: Get): LeadSlice {
  return createMelodySlice(melodyTrack('lead'), set, get) as LeadSlice;
}
```

- [ ] **Step 5: Delete the `eslint-disable` that has stopped being true**

`get` is now read by the record action, so the factory's parameter comment and its disable line must go. Replace:

```ts
  set: Set,
  // Unused here: every action this factory builds writes through `set`'s
  // updater form alone. Kept in the signature (matching `Get`, the same pair
  // every other slice factory takes) rather than dropped, so a future melody
  // action that DOES need a synchronous read is a one-line addition, not a
  // signature change at both call sites.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  get: Get,
```

with:

```ts
  set: Set,
  // Read synchronously by the record action, which has to answer "did that
  // write land?" before returning — every other action here writes through
  // `set`'s updater form and never reads.
  get: Get,
```

and in the factory docblock replace *"`recordLeadNote` and `leadRecording` are NOT here: live capture is lead-only (one note-input dispatcher, store/leadRecord.ts's leadMarkerFollowsClock), so they stay in createLeadSlice below."* with:

```
 * `recordLeadNote` IS here, as `[actions.record]`, and its fx twin comes free:
 * live capture is per melody track now, and the arm it checks is one ui-slice
 * scalar (`recordingTrack`) rather than a field on either track.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/store/fxSlice.test.ts src/store/leadSlice.test.ts src/store/leadRecord.test.ts`
Expected: PASS. `recordLeadNote`'s existing suite in `leadSlice.test.ts` is the regression check that the move changed nothing for lead.

- [ ] **Step 7: Commit**

```bash
git add src/store/leadSlice.ts src/store/types.ts src/store/fxSlice.test.ts
git commit -m "$(cat <<'EOF'
refactor(rec): recordLeadNote joins the melody-slice factory

The record action moves out of createLeadSlice and into createMelodySlice,
reading view, octave, cursor, loopLength, stepResolution and steps through the
MELODY_TRACKS row. recordFxNote falls out of the second instantiation with no
second implementation, and createLeadSlice collapses to one line.

The factory's `get` parameter is now read, so its "unused here" comment and the
eslint-disable under it are deleted rather than left asserting something false.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `leadRecord.ts` becomes a factory over `MELODY_TRACKS`

Two independent bridges, **one** anchor collector, and every store field read through the track row.

**Files:**
- Modify: `src/store/leadRecord.ts:69-190` (the deps, the held-note type, and the whole bridge)
- Modify: `src/store/engineSync.ts:2`, `:420-427`
- Modify: `.claude/rules/note-input.md:52-58`
- Test: `src/store/leadRecord.test.ts`

**Interfaces:**
- Consumes: `recordLeadNote` / `recordFxNote` and `setLeadNoteLength` / `setFxNoteLength` on the store (Task 2); `MELODY_TRACKS`, `melodyTrack`, `MelodyTrack`, `MelodyTrackId` from `./melodyTracks`.
- Produces:
  ```ts
  export interface LeadRecordDeps { inputStep: () => number | null; startClock: () => () => void; }
  export function startLiveClockCollector(deps?: LeadRecordDeps): () => void;
  export function startMelodyRecordBridge(track: MelodyTrack, deps?: LeadRecordDeps): () => void;
  export function startMelodyRecordBridges(deps?: LeadRecordDeps): () => void;
  ```
  `startLeadRecordBridge` no longer exists. `startMelodyRecordBridges` is the only call site outside tests, from `useEngineSync`.

- [ ] **Step 1: Write the failing tests**

In `src/store/leadRecord.test.ts`, change the import line and the `beforeEach` starter:

```ts
import { startMelodyRecordBridges, leadClockActive, leadMarkerFollowsClock } from './leadRecord';
```

```ts
  stop = startMelodyRecordBridges(deps);
```

Then append this describe block:

```ts
describe('leadRecord — one factory, two bridges', () => {
  const fxAt = (col: number): string[] => {
    const state = useAppStore.getState();
    const stepsPerBar = getMeter(state.meterId).stepsPerBar;
    return state.fxMelodySteps[leadStoredIndexAt(col, stepsPerBar, TICKS_PER_SIXTEENTH)]
      .map((n) => n.note)
      .sort();
  };

  beforeEach(() => {
    useAppStore.setState({
      fxMelodySteps: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
      fxLoopLength: 1,
      fxMelodyView: 'chromatic',
      fxMelodyOctave: 3,
      fxCursor: 0,
      fxPlayer: 'stopped',
    });
  });

  test('the armed track is the one that gets written, and the other stays empty', () => {
    useAppStore.setState({ recordingTrack: 'fx' });

    down('C4');
    up('C4');

    expect(fxAt(0)).toEqual(['C4']);
    expect(at(0)).toEqual([]);
  });

  test('with nothing armed, one keypress writes neither grid', () => {
    useAppStore.setState({ recordingTrack: null });

    down('C4');
    up('C4');

    expect(at(0)).toEqual([]);
    expect(fxAt(0)).toEqual([]);
  });

  test('the fx bridge captures held length through its own setter', () => {
    useAppStore.setState({ recordingTrack: 'fx', leadPlayer: 'playing' });
    liveStep = 4;
    down('C4');
    liveStep = 8;
    up('C4');

    const state = useAppStore.getState();
    const stepsPerBar = getMeter(state.meterId).stepsPerBar;
    const row = state.fxMelodySteps[leadStoredIndexAt(4, stepsPerBar, TICKS_PER_SIXTEENTH)];
    expect(row.find((n) => n.note === 'C4')?.len).toBe(8);
  });

  /**
   * ONE collector for both tracks, not one per bridge. startLeadLiveClock is a
   * module singleton whose second concurrent start returns a disposer that
   * does nothing — so two bridges each believing they own a collector means
   * the first one to stop tears down the anchors the other is still reading,
   * with no error anywhere. Hoisting it out of the bridge is what makes that
   * unrepresentable, and it keeps exactly one holder of the shared clock.
   */
  test('starts exactly one anchor collector for both tracks', () => {
    expect(clockRuns).toBe(0);
    useAppStore.setState({ leadPlayer: 'playing' });
    expect(clockRuns).toBe(1);
    useAppStore.setState({ leadPlayer: 'stopped' });
    expect(clockRuns).toBe(0);
  });

  test('a note held on the FX track when the transport stops must not later extend anything', () => {
    useAppStore.setState({ recordingTrack: 'fx', leadPlayer: 'playing' });
    liveStep = 4;
    down('C4');

    useAppStore.setState({ leadPlayer: 'stopped' });

    liveStep = 40;
    up('C4');

    const state = useAppStore.getState();
    const stepsPerBar = getMeter(state.meterId).stepsPerBar;
    const row = state.fxMelodySteps[leadStoredIndexAt(4, stepsPerBar, TICKS_PER_SIXTEENTH)];
    expect(row.find((n) => n.note === 'C4')?.len).toBe(TICKS_PER_SIXTEENTH);
  });
});
```

`LEAD_TICKS_PER_BAR`, `TICKS_PER_SIXTEENTH`, `leadStoredIndexAt`, `getMeter`, `LeadNote`, `down`, `up`, `at`, `liveStep` and `clockRuns` are all already in that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/leadRecord.test.ts`
Expected: FAIL — `SyntaxError: Export named 'startMelodyRecordBridges' not found in module '…/src/store/leadRecord.ts'`, so the whole file errors rather than one test.

- [ ] **Step 3: Rewrite the bridge as a factory**

In `src/store/leadRecord.ts`, add to the imports:

```ts
import { MELODY_TRACKS, type MelodyTrack, type MelodyTrackId } from './melodyTracks';
```

Add this table above `interface HeldNote`:

```ts
/**
 * The two ACTION names this bridge calls. MELODY_TRACKS carries state field
 * names only (see its docblock), so — exactly like leadSlice's `ACTIONS` and
 * LeadMelodyGrid's `GRID_ACTIONS` — the setter names are a small typo-checked
 * literal table here rather than a `record${Id}Note` template the compiler
 * cannot check against the store.
 */
const RECORD_ACTIONS: Record<
  MelodyTrackId,
  {
    record: 'recordLeadNote' | 'recordFxNote';
    setNoteLength: 'setLeadNoteLength' | 'setFxNoteLength';
  }
> = {
  lead: { record: 'recordLeadNote', setNoteLength: 'setLeadNoteLength' },
  fx: { record: 'recordFxNote', setNoteLength: 'setFxNoteLength' },
};
```

Replace `startLeadRecordBridge` entirely with the three functions below:

```ts
/**
 * The ONE anchor collector, for both melody tracks.
 *
 * Hoisted out of the per-track bridge on purpose. `startLeadLiveClock` is a
 * module singleton: a second start while one is live is a no-op that returns a
 * disposer which does nothing (audio/playback/leadLiveClock.ts), so two
 * bridges each holding "their" collector means the first to stop unsubscribes
 * and resets the anchors the other is still quantising against — silently, and
 * only when the two predicates disagree.
 *
 * Started and stopped with the music, never at boot: subscribing the shared
 * clock starts its 25 ms timer, so a permanent subscriber would keep it alive
 * for the life of the app. One holder, gated on the transport.
 *
 * It is NOT gated on the arm as well. Arming mid-playback would then start the
 * collector from cold, and inputStep() answers null until two anchors have
 * arrived — so the first notes after arming would land silently on the cursor
 * while the music played. The collector follows the transport; only writing
 * follows the arm.
 */
export function startLiveClockCollector(deps: LeadRecordDeps = REAL_CLOCK): () => void {
  let stopClock: (() => void) | null = null;

  const syncClock = (active: boolean): void => {
    if (active === (stopClock !== null)) return;
    if (active) {
      stopClock = deps.startClock();
      return;
    }
    stopClock?.();
    stopClock = null;
  };

  const unsubscribe = useAppStore.subscribe(leadClockActive, syncClock, { fireImmediately: true });

  return () => {
    unsubscribe();
    syncClock(false);
  };
}

/**
 * The bridge from performed notes to ONE melody track's grid.
 *
 * ONE subscriber per track, not a call bolted onto each input source. The bus
 * already settled which events count as somebody playing (see noteInputBus),
 * so this module only has to answer what to do with them — and answering it
 * once is why the computer keyboard, the on-screen keyboard and MIDI all
 * behave the same without three copies of this rule.
 *
 * Instantiated per MELODY_TRACKS row, the leadSlice precedent: every store
 * field is read through `track` and every action through RECORD_ACTIONS, so
 * Lead and FX are one implementation with two rows. Both bridges see every
 * note; the record action's `recordingTrack === track.id` guard is what makes
 * exactly one of them write.
 *
 * The cursor never moves, in either mode. Stopped, it IS the write head, so
 * notes played together land together and a key repeat writes nothing new.
 * Playing, the clock is the write head and the cursor is simply left where
 * the user put it — which is what makes "stop returns the marker to where
 * you put it" free, with no save-and-restore step to get wrong.
 */
export function startMelodyRecordBridge(
  track: MelodyTrack,
  deps: LeadRecordDeps = REAL_CLOCK,
): () => void {
  const held = new Map<string, HeldNote>();
  const actions = RECORD_ACTIONS[track.id];

  // A note still down when the transport stops has no length to compute
  // against, and its release must not extend anything later. Per bridge,
  // because the held map is per bridge — the CLOCK is not started here.
  const unsubscribeTransport = useAppStore.subscribe(leadClockActive, (active) => {
    if (!active) held.clear();
  });

  const unsubscribeInput = subscribeNoteInput((event) => {
    if (event.kind === 'off') {
      const entry = held.get(event.note);
      if (!entry) return;
      held.delete(event.note);
      const offStep = deps.inputStep();
      if (offStep === null) return;
      const len = heldStepLength(entry.onStep, offStep, entry.stride);
      // The track's setNoteLength owns all three length invariants, including
      // the clamp against the loop end — so a note held across the seam is
      // truncated rather than wrapped, with no special case here.
      //
      // The ARM is re-read here, not assumed from note-on: a press that
      // started while armed can still be held after Rec is switched off, or
      // after the arm has moved to the other melody track, and its release
      // must not reach back and lengthen a note that was never meant to grow
      // past its initial write.
      //
      // > stride, not > 1: a one-cell note is already at that length, and
      // calling the setter for it would be a write with nothing to write.
      if (len > entry.stride && useAppStore.getState().recordingTrack === track.id) {
        useAppStore.getState()[actions.setNoteLength](entry.storedIndex, event.note, len);
      }
      return;
    }

    const state = useAppStore.getState();
    const clockStep = deps.inputStep();
    if (clockStep === null) {
      // No running clock: the cursor is the write head, and there is no step
      // count to give the note a length with, so it stays one step long.
      state[actions.record](event.note);
      return;
    }
    // A key repeat must not re-date a press that is still down.
    if (held.has(event.note)) return;

    const stepsPerBar = getMeter(state.meterId).stepsPerBar;
    const stride = strideFor(state[track.stepResolution]);
    const columns = state[track.loopLength] * columnsPerBar(stepsPerBar, stride);
    const rawColumn = clockStepToGridColumn(clockStep, columns, stride);
    // Clamped HERE, once, and the same value reused below: the record action
    // clamps again internally (defence in depth for its other caller, the
    // stopped-cursor path), but that must not be the only place it happens —
    // two independent clamps of the same raw column agree today only because
    // the wrap already puts rawColumn in range, which is luck, not a
    // guarantee.
    const column = clampLeadCursor(rawColumn, state[track.loopLength], stepsPerBar, stride);
    // The note goes in at one cell immediately, so it appears on the grid the
    // moment it is played; note-off extends it.
    if (!state[actions.record](event.note, column)) return;
    held.set(event.note, {
      onStep: clockStep,
      storedIndex: leadStoredIndexAt(column, stepsPerBar, stride),
      stride,
    });
  });

  return () => {
    unsubscribeInput();
    unsubscribeTransport();
    held.clear();
  };
}

/**
 * Everything the recorder needs, started once from useEngineSync: the single
 * anchor collector plus one bridge per melody track. Returns one teardown.
 */
export function startMelodyRecordBridges(deps: LeadRecordDeps = REAL_CLOCK): () => void {
  const stops = [
    startLiveClockCollector(deps),
    ...MELODY_TRACKS.map((track) => startMelodyRecordBridge(track, deps)),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
```

- [ ] **Step 4: Point `engineSync` at the new starter**

In `src/store/engineSync.ts`, line 2 becomes `import { startMelodyRecordBridges } from './leadRecord';`, and the effect becomes:

```ts
  // Started beside the engine bridge because it has the same shape: one
  // subscription set, for the whole life of the app, owned by nothing on
  // screen. One anchor collector and one bridge per melody track.
  useEffect(() => startMelodyRecordBridges(), []);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/store/leadRecord.test.ts src/store/engineSync.test.ts`
Expected: PASS, including the pre-existing "the anchor collector runs exactly while there is music to play along to" and "unsubscribing stops the anchor collector too" tests, which now prove the hoisted collector still starts and stops with the transport.

- [ ] **Step 6: Fix the note-input rule this commit falsifies**

`.claude/rules/note-input.md` currently reads:

> **A note-off is data now, not just a release.** Live capture (DEV-374) reads
> the gap between a note's on and its off, quantised in steps, and extends the
> written note through `setLeadNoteLength`.

Replace `setLeadNoteLength` in that sentence with:

> the armed track's length setter (`setLeadNoteLength` or `setFxNoteLength`)

- [ ] **Step 7: Commit**

```bash
git add src/store/leadRecord.ts src/store/leadRecord.test.ts src/store/engineSync.ts .claude/rules/note-input.md
git commit -m "$(cat <<'EOF'
refactor(rec): one record bridge per melody track

startLeadRecordBridge becomes startMelodyRecordBridge(track), instantiated over
MELODY_TRACKS the way leadSlice's factory is, with every store field read
through the track row and both actions through a local typo-checked table.

The anchor collector is hoisted out of the bridge into startLiveClockCollector:
startLeadLiveClock is a module singleton whose second concurrent start is a
no-op disposer, so two bridges each holding "their" collector would let the
first to stop reset the anchors the other still reads. One holder of the shared
clock, gated on the transport and never on the arm — gating it on the arm would
make the first notes after arming mid-playback land on the cursor while inputStep
waited for two anchors.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: the marker and step-publisher gates go per track

Arming FX with the publisher still gated on `fxPlayer` alone is the DEV-374 bug in mirror image: capture in time, marker frozen on the cursor, pointing at a column nothing is being written to. The gates therefore land **before** anything can arm FX.

**Files:**
- Modify: `src/store/leadRecord.ts:18-66` (both predicates and their docblocks)
- Modify: `src/components/loop/lead/useLeadMarker.ts:7-40`
- Modify: `src/components/loop/lead/useLeadStepPublisher.ts:35-73`
- Modify: `src/store/melodyTracks.ts:30-33` (the "no `recording` column" paragraph)
- Test: `src/store/leadRecord.test.ts:261-330`, `src/components/loop/lead/useLeadStepPublisher.test.ts:111-116`

**Interfaces:**
- Consumes: `recordingTrack` on the store (Task 1); `melodyTrack` from `./melodyTracks`.
- Produces:
  ```ts
  export function leadClockActive(state: {
    sequencerPlayer: PlayerState; chordsPlayer: PlayerState;
    leadPlayer: PlayerState; fxPlayer: PlayerState;
  }): boolean;
  export function leadMarkerFollowsClock(
    state: {
      sequencerPlayer: PlayerState; chordsPlayer: PlayerState;
      leadPlayer: PlayerState; fxPlayer: PlayerState;
      recordingTrack: MelodyTrackId | null;
    },
    trackId: MelodyTrackId,
  ): boolean;
  ```
  `leadClockActive` deliberately takes **no** track id: see its docblock below.

- [ ] **Step 1: Write the failing tests**

Replace the `describe('leadMarkerFollowsClock', …)` block in `src/store/leadRecord.test.ts` with:

```ts
describe('leadMarkerFollowsClock', () => {
  type MarkerState = Parameters<typeof leadMarkerFollowsClock>[0];
  const markerState = (over: Partial<MarkerState>): MarkerState => ({
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    fxPlayer: 'stopped',
    recordingTrack: null,
    ...over,
  });

  test('a track that is playing always follows the clock', () => {
    expect(leadMarkerFollowsClock(markerState({ leadPlayer: 'playing' }), 'lead')).toBe(true);
    expect(leadMarkerFollowsClock(markerState({ fxPlayer: 'playing' }), 'fx')).toBe(true);
  });

  // The gates are per track, and the arm is one value: the FX marker must not
  // follow the clock because LEAD is armed, and vice versa.
  test('the recording term only fires for the track the arm names', () => {
    const armedFx = markerState({ sequencerPlayer: 'playing', recordingTrack: 'fx' });
    expect(leadMarkerFollowsClock(armedFx, 'fx')).toBe(true);
    expect(leadMarkerFollowsClock(armedFx, 'lead')).toBe(false);

    const armedLead = markerState({ sequencerPlayer: 'playing', recordingTrack: 'lead' });
    expect(leadMarkerFollowsClock(armedLead, 'lead')).toBe(true);
    expect(leadMarkerFollowsClock(armedLead, 'fx')).toBe(false);
  });

  // ...and the line this predicate draws that leadClockActive does not: a
  // clock running with nothing armed and the track silent. Nothing is written
  // there, so a mark sweeping the grid would animate a write head that does
  // not exist.
  test('a clock with nothing armed does not move a stopped marker', () => {
    expect(leadMarkerFollowsClock(markerState({ sequencerPlayer: 'playing' }), 'lead')).toBe(false);
    expect(leadMarkerFollowsClock(markerState({ sequencerPlayer: 'playing' }), 'fx')).toBe(false);
    expect(leadClockActive(markerState({ sequencerPlayer: 'playing' }))).toBe(true);
  });

  test('armed against a silent transport follows nothing', () => {
    expect(leadMarkerFollowsClock(markerState({ recordingTrack: 'lead' }), 'lead')).toBe(false);
  });
});
```

Append to the `describe('leadClockActive', …)` block:

```ts
  // FX is music too. The question is whether there is something to play along
  // to, not whose track it is: recording lead over an FX riser has a clock.
  test('the fx player counts, exactly as the drums and the chords do', () => {
    expect(leadClockActive(clockState({ fxPlayer: 'playing' }))).toBe(true);
  });
```

and add `fxPlayer: 'stopped',` to that block's `clockState` defaults.

In `src/components/loop/lead/useLeadStepPublisher.test.ts`, replace the gate pin:

```ts
  test('both tracks are gated on leadMarkerFollowsClock for their OWN id, never the lead player', () => {
    expect(source).toContain('leadMarkerFollowsClock(s, trackId)');
    expect(source).not.toContain("s.fxPlayer !== 'stopped'");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/leadRecord.test.ts src/components/loop/lead/useLeadStepPublisher.test.ts`
Expected: FAIL — `expect(received).toBe(expected)` with `Received: true` on "the recording term only fires for the track the arm names" (the one-argument predicate ignores the id and answers for lead both times), and `Expected to contain: "leadMarkerFollowsClock(s, trackId)"` on the publisher pin.

- [ ] **Step 3: Widen and parameterise the predicates**

In `src/store/leadRecord.ts`:

```ts
/**
 * Is there music to play along to?
 *
 * The DEV-370 guard was `leadPlayer !== 'stopped'`, which meant that playing
 * only the drums and then pressing a key wrote to a static cursor while the
 * beat ran. The rule should fit in one sentence: if music is playing, record
 * in time; if not, record at the cursor.
 *
 * The metronome was once counted here, on the reasoning that it runs the same
 * clock and is what a player counts against when nothing else is going. It no
 * longer runs a clock at all — it is a click on music that is already playing
 * (see setMetronomeEnabled in audio/engine.ts) — so counting it would put this
 * predicate in disagreement with whether a clock exists to quantise against.
 * To record in time to a click alone, press play on a melody track: an empty
 * melody makes no sound, and the click, the marker and capture all follow from
 * the one transport that is running.
 *
 * FX counts for the same reason the drums do, and this predicate takes NO
 * track id: the question is whether music is playing, not whose track it is,
 * so a per-track answer would tell a lead recorder there is nothing to play
 * along to while an FX riser is plainly sounding. An id it did not read would
 * also be an unused parameter, which `bun run eslint` reports.
 */
export function leadClockActive(state: {
  sequencerPlayer: PlayerState;
  chordsPlayer: PlayerState;
  leadPlayer: PlayerState;
  fxPlayer: PlayerState;
}): boolean {
  return (
    isPlayerActive(state.sequencerPlayer) ||
    isPlayerActive(state.chordsPlayer) ||
    isPlayerActive(state.leadPlayer) ||
    isPlayerActive(state.fxPlayer)
  );
}

/**
 * Does THIS track's marker follow the clock right now?
 *
 * Wider than the track's own player, narrower than leadClockActive, and
 * neither by accident. DEV-377 merged the playhead and the write cursor into
 * one mark, so it should track the clock when either of those meanings is
 * live: this track is sounding, or capture is armed ON THIS TRACK against a
 * clock that is running.
 *
 * The third case — a clock running with nothing armed and this track silent —
 * is what separates this from leadClockActive. The record action returns false
 * unless `recordingTrack` names this track, so nothing is written there at
 * all, and a mark sweeping the grid would be animating a write head that does
 * not exist. Turning the metronome on is not a transport start, and it should
 * not look like one.
 *
 * The `trackId` is what keeps two mounted grids honest: with one arm value and
 * a per-track question, the FX marker cannot start sweeping because LEAD is
 * armed. The track's own player field is read through MELODY_TRACKS rather
 * than by literal name, so a row rename moves this with it.
 *
 * The recorder keeps leadClockActive: its question is "is there music to
 * play along to", which is about time, not about whether the user armed
 * anything. Two questions, two predicates, sharing the one that answers the
 * first.
 */
export function leadMarkerFollowsClock(
  state: {
    sequencerPlayer: PlayerState;
    chordsPlayer: PlayerState;
    leadPlayer: PlayerState;
    fxPlayer: PlayerState;
    recordingTrack: MelodyTrackId | null;
  },
  trackId: MelodyTrackId,
): boolean {
  return (
    isPlayerActive(state[melodyTrack(trackId).player]) ||
    (state.recordingTrack === trackId && leadClockActive(state))
  );
}
```

Add `melodyTrack` to the existing `./melodyTracks` import in that file.

- [ ] **Step 4: Move both consumers onto the per-track gate**

`src/components/loop/lead/useLeadMarker.ts`:

```ts
  const followsClock = useAppStore((s) => leadMarkerFollowsClock(s, trackId));
```

and in its docblock replace *"The live source for LEAD is leadMarkerFollowsClock … FX has no recorder, so its marker follows its own player state and nothing else."* with:

```
 * The live source is leadMarkerFollowsClock for BOTH tracks, not
 * `player !== 'stopped'`: this column is also where live capture writes, so it
 * has to track the clock while Rec is armed on this track and anything at all
 * is playing. With the narrower predicate, playing along to the drums with the
 * track stopped put every captured note in time while the marker sat on the
 * cursor, pointing at a column nothing was being written to. The predicate
 * takes the track id, so one arm value cannot make the other grid's marker
 * sweep.
```

`src/components/loop/lead/useLeadStepPublisher.ts`:

```ts
  // BOTH tracks follow the wider gate for their own id — a track's marker must
  // also track somebody else's clock while Rec is armed on it, because that
  // column is where live capture writes (store/leadRecord.ts says why that is
  // not simply the recorder's own gate).
  const followsClock = useAppStore((s) => leadMarkerFollowsClock(s, trackId));
```

and in its docblock replace both sentences that read *"FX has no recorder, so its marker follows its own player state and nothing else"* with:

```
 * Both tracks are gated the same way, on their own id: the arm is one value
 * (`recordingTrack`), so the term is per track rather than per file.
```

- [ ] **Step 5: Rewrite the `melodyTracks.ts` paragraph this commit falsifies**

Replace the last paragraph of `MELODY_TRACKS`' docblock — *"There is no `recording` column: live capture is lead-only (store/leadRecord.ts, and the one note-input dispatcher behind it), so the FX grid renders no Rec button and its step publisher's gate is just its own player state."* — with:

```
 * There is still no `recording` column, and now for a stronger reason than
 * "lead-only": the ARMED TRACK is one scalar in the ui slice
 * (`recordingTrack`), precisely so two tracks cannot be armed at once. A
 * per-track `recording` field would make that state representable, and one
 * live-capture clock would then write two grids from a single keypress. Both
 * tracks' gates ask `recordingTrack === id` instead — see store/leadRecord.ts.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/store/leadRecord.test.ts src/components/loop/lead/ src/store/melodyTracks.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full gate**

Run: `bun run verify`
Expected: PASS. `bun run lint` is what catches any remaining one-argument call of `leadMarkerFollowsClock` (`Expected 2 arguments, but got 1`).

- [ ] **Step 8: Commit**

```bash
git add src/store/leadRecord.ts src/store/leadRecord.test.ts src/store/melodyTracks.ts src/components/loop/lead/useLeadMarker.ts src/components/loop/lead/useLeadStepPublisher.ts src/components/loop/lead/useLeadStepPublisher.test.ts
git commit -m "$(cat <<'EOF'
feat(rec): the marker and step-publisher gates go per track

leadMarkerFollowsClock takes a trackId and compares recordingTrack === trackId,
reading the track's player field through MELODY_TRACKS; both the marker hook and
the step publisher now use it for lead and fx alike. Landing this before FX can
be armed avoids DEV-374 in mirror image — capture in time with the marker frozen
on the cursor.

leadClockActive gains the fxPlayer term and deliberately takes no track id: its
question is whether music is playing, not whose track it is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rec appears on the focused melody grid, and the arm follows focus

The user-visible deliverable: pressing Rec arms the focused melody track, the button is absent on a chord/bass/pad/drum focus, and navigating away disarms.

**Files:**
- Modify: `src/store/leadRecord.ts` (append `startRecordArmSync`; add it to `startMelodyRecordBridges`)
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx:547-549`, `:771-790`
- Modify: `CLAUDE.md:223` (the sentence Task 1 rewrote, now false again)
- Test: `src/store/leadRecord.test.ts`, `src/components/loop/lead/LeadMelodyGrid.test.tsx:91-115`

**Interfaces:**
- Consumes: `melodyTrackForFocus(focus: MixLayerId): MelodyTrackId | null` and `MixLayerId` from `@/store/focusTrack` (Plan 1); `focusTrack` / `setFocusTrack` and `recordingTrack` / `setRecordingTrack` on the store; `useLiveStore` from `@/components/ui/useLiveStore`.
- Produces:
  ```ts
  export function startRecordArmSync(): () => void;   // src/store/leadRecord.ts
  ```
  `startMelodyRecordBridges` now composes three things: the collector, the two bridges, and this. `LeadMelodyGrid`'s `trackId` prop stays **required with no default**.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/leadRecord.test.ts`:

```ts
describe('the arm follows focus', () => {
  /**
   * One subscription, not a clear inside setFocusTrack — the soloNav.ts
   * precedent, and for the same reason: setFocusTrack is not the only writer
   * (a project load or a hydration writes the field through setState), and a
   * missed writer is silent, because the recorder just keeps capturing into a
   * grid the user is no longer looking at.
   */
  test('a focus change away from the armed track disarms it', () => {
    useAppStore.setState({ focusTrack: 'synth', recordingTrack: 'lead' });

    useAppStore.getState().setFocusTrack('chord');

    expect(useAppStore.getState().recordingTrack).toBeNull();
  });

  test('crossing between the two melody tracks disarms rather than following', () => {
    useAppStore.setState({ focusTrack: 'synth', recordingTrack: 'lead' });

    useAppStore.getState().setFocusTrack('fx');

    // Never re-armed on the new track: Rec is a deliberate gesture and a focus
    // change is navigation. Arming on navigation would put the app into record
    // because the user clicked a mixer row.
    expect(useAppStore.getState().recordingTrack).toBeNull();
  });

  test('a focus change that lands back on the armed track leaves it armed', () => {
    useAppStore.setState({ focusTrack: 'drum', recordingTrack: 'lead' });

    useAppStore.getState().setFocusTrack('synth');

    expect(useAppStore.getState().recordingTrack).toBe('lead');
  });
});
```

Add `focusTrack: 'synth',` and `recordingTrack: 'lead',` to the file's top-level `beforeEach` state block so these start from a known focus, and reset with `useAppStore.getState().setFocusTrack('synth')` in the existing `afterEach`.

Replace the `test('has no recorder — no Rec button at all', …)` case in `src/components/loop/lead/LeadMelodyGrid.test.tsx` with a new describe block (the existing block's two renders happen at describe-body time, before any `setState`, so the focus-driven cases need their own renders):

```tsx
describe('LeadMelodyGrid — Rec follows focus', () => {
  // These read through useLiveStore, which serves getState() for BOTH
  // snapshots, so a setState before renderToString is actually visible — a
  // plain useAppStore selector would render creation-time state and this whole
  // block would silently assert against 'synth'.
  const render = (focus: MixLayerId, trackId: MelodyTrackId): string => {
    useAppStore.setState({ focusTrack: focus });
    return renderToString(<LeadMelodyGrid trackId={trackId} />);
  };

  test('the focused melody grid carries Rec and the other does not', () => {
    expect(render('synth', 'lead')).toContain('id="btn-lead-record"');
    expect(render('synth', 'fx')).not.toContain('id="btn-fx-record"');
    expect(render('fx', 'fx')).toContain('id="btn-fx-record"');
    expect(render('fx', 'lead')).not.toContain('id="btn-lead-record"');
  });

  test('no melody track is focused, so neither grid offers Rec', () => {
    expect(render('drum', 'lead')).not.toContain('id="btn-lead-record"');
    expect(render('drum', 'fx')).not.toContain('id="btn-fx-record"');
    expect(render('chord', 'lead')).not.toContain('id="btn-lead-record"');
  });

  test('the action lane keeps both of its children, so the actions stay pinned right', () => {
    expect(render('drum', 'lead')).toContain('justify-between');
  });
});
```

Add `import { useAppStore } from '@/store/store';`, `import type { MixLayerId } from '@/store/focusTrack';` and `import type { MelodyTrackId } from '@/store/melodyTracks';` to that test file, and reset focus with `useAppStore.setState({ focusTrack: 'synth' })` in an `afterEach`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/leadRecord.test.ts -t "the arm follows focus"`
Expected: FAIL — `expect(received).toBeNull()` with `Received: "lead"`; nothing is watching focus yet.

Run: `bun test src/components/loop/lead/LeadMelodyGrid.test.tsx -t "Rec follows focus"`
Expected: FAIL — `expect(received).toContain(expected)` on `render('fx', 'fx')`, because the `trackId === 'lead'` wrapper still decides.

- [ ] **Step 3: Add the arm-follows-focus subscription**

Append to `src/store/leadRecord.ts` and add `import { melodyTrackForFocus } from './focusTrack';`:

```ts
/**
 * The arm follows focus, DISARMING only.
 *
 * One subscription rather than a clear inside every writer of `focusTrack` —
 * the soloNav.ts precedent, and for the same reason: `setFocusTrack` is not
 * the only way focus moves (a project load and hydration both write it through
 * setState), a missed writer is silent, and what it costs is a recorder still
 * capturing into a grid the user has navigated away from.
 *
 * It never ARMS the newly focused track. Rec is a deliberate gesture and a
 * focus change is navigation; arming on navigation would put the app into
 * record because somebody clicked a mixer row.
 *
 * This is also the whole reason Rec needs no coupling back to the audition
 * target. An earlier draft forced the keyboard to Lead while armed so that
 * what you heard was what got written; with the arm scoped to focus, the armed
 * track IS the focused track and that rule has nothing left to fix. Do not
 * reintroduce one.
 */
export function startRecordArmSync(): () => void {
  return useAppStore.subscribe(
    (state) => state.focusTrack,
    (focus) => {
      const state = useAppStore.getState();
      if (state.recordingTrack === null) return;
      if (melodyTrackForFocus(focus) === state.recordingTrack) return;
      state.setRecordingTrack(null);
    },
  );
}
```

and include it in the composer:

```ts
export function startMelodyRecordBridges(deps: LeadRecordDeps = REAL_CLOCK): () => void {
  const stops = [
    startLiveClockCollector(deps),
    startRecordArmSync(),
    ...MELODY_TRACKS.map((track) => startMelodyRecordBridge(track, deps)),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
```

- [ ] **Step 4: Render Rec on the focused grid**

In `src/components/loop/lead/LeadMelodyGrid.tsx`, add the imports:

```ts
import { melodyTrackForFocus } from '@/store/focusTrack';
import { useLiveStore } from '@/components/ui/useLiveStore';
```

and replace the two Rec reads from Task 1 with:

```ts
  // useLiveStore, not useAppStore: this markup has to reflect a test-set focus
  // under renderToString, where zustand serves the creation-time state as the
  // server snapshot (see .claude/rules/testing.md and BottomInputDock.tsx).
  const armed = useLiveStore((s) => s.recordingTrack) === trackId;
  const setRecordingTrack = useLiveStore((s) => s.setRecordingTrack);
  const showRec = useLiveStore((s) => melodyTrackForFocus(s.focusTrack)) === trackId;
```

Replace the action lane's comment and the `trackId === 'lead' &&` wrapper:

```tsx
        {/* Action lane. Below the grid on purpose: it sits next to the bottom
            input dock, which is where the hands are when Rec matters, and the
            eye reads grid-then-act rather than doubling back.
            Rec holds the left alone because it is the only MODE here — it arms
            a state and stays armed — while copy/paste/clear are one-shot
            commands; splitting them by kind also buys Clear the most distance
            from the button beside it. Clear keeps its own group so the lane's
            wider gap sets it apart from Paste, and it must not wear red as
            well: an armed Rec already owns that.
            Rec renders on whichever melody grid focus names, and on NEITHER
            when focus is chord, bass, pad or drum — a Rec button that arms an
            invisible track is the invisible-state failure focusTrack exists to
            remove. The left group renders empty rather than not at all, so
            `justify-between` still has two children and the actions cluster
            stays pinned right. */}
        <ToolbarLane className="mt-3 justify-between">
          <ToolbarGroup>
            {showRec && (
              <ToolbarButton
                id={`btn-${trackId}-record`}
                icon={<Circle className="w-3 h-3" />}
                label="Rec"
                onClick={() => setRecordingTrack(armed ? null : trackId)}
                pressed={armed}
                title={
                  armed
                    ? 'Stop recording played notes into the grid'
                    : `Record played notes into bar ${selectedBar + 1}, from the selected step`
                }
              />
            )}
          </ToolbarGroup>
```

Finally, add to the component's own docblock (above `export function LeadMelodyGrid`):

```
 * `trackId` is REQUIRED and has no default, and must stay that way. A default
 * of `'lead'` would let a call site that forgot the prop render a second copy
 * of the lead grid — visually plausible, internally consistent in both
 * instances, and caught by no test. Rec makes that worse rather than better:
 * both copies would agree about which track is armed and both would be wrong
 * about which grid the user is looking at.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/store/leadRecord.test.ts src/components/loop/lead/LeadMelodyGrid.test.tsx`
Expected: PASS.

- [ ] **Step 6: Rewrite the CLAUDE.md sentence this commit falsifies**

Replace the sentence Task 1 left in place —

> **FX has no live recorder yet** — the armed track is one scalar (`recordingTrack` in the ui
> slice) and only Lead's grid can point it anywhere — and it is not a constraint on the material:
> a user who wants a counter-melody writes one and the track behaves identically.

— with:

> **Rec is armed per melody track, and the armed track is ONE value.**
> `recordingTrack: MelodyTrackId | null` lives in the ui slice, so two tracks can never be armed at
> once and one keypress can never write two grids; `store/leadRecord.ts` is a factory over
> `MELODY_TRACKS` and each bridge writes only while `recordingTrack` names its own row, with one
> shared anchor collector rather than one per bridge. The Rec button renders on whichever melody
> grid `melodyTrackForFocus(focusTrack)` names and on neither when focus is chord, bass, pad or
> drum, and a focus change away from the armed track disarms it — which is why nothing couples the
> arm back to the audition target: the armed track already IS the focused track.

- [ ] **Step 7: Run the full gate**

Run: `bun run verify`
Expected: PASS — `bun test`, `bun run lint`, `bun run eslint` (nothing at all, no errors and no warnings), `check:keys`, `check:drums`, `check:contrast`, `check:levels`, `build`.

- [ ] **Step 8: Commit**

```bash
git add src/store/leadRecord.ts src/store/leadRecord.test.ts src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/LeadMelodyGrid.test.tsx CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(rec): Rec arms the focused melody track

The Rec button renders on whichever melody grid melodyTrackForFocus names, and
on neither when focus is chord, bass, pad or drum — a button that arms an
invisible track is the invisible-state failure focusTrack exists to remove.
startRecordArmSync disarms when focus leaves the armed track, in one
subscription rather than a clear inside setFocusTrack, because a project load
writes focus through setState too.

Disarming only: arming on navigation would put the app into record because
somebody clicked a mixer row. Nothing couples the arm back to the audition
target, and nothing should — the armed track is the focused track.

CLAUDE.md's FX-has-no-live-recorder sentence dies in this commit, the one that
falsifies it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (run against the spec's `## Rec` section)

**1. Spec coverage.**

| Spec requirement (`## Rec`, and Scope item 3) | Task |
|---|---|
| `leadRecord.ts` becomes a factory over `MELODY_TRACKS` | 3 |
| `leadRecording: boolean` → `recordingTrack: MelodyTrackId \| null`, one value so two cannot be armed | 1 |
| `leadClockActive` / `leadMarkerFollowsClock` compare `recordingTrack === id` | 4 (`leadClockActive` takes no id — deviation recorded below) |
| Rec hidden when focus is not a melody track | 5 |
| Pressing Rec arms `melodyTrackForFocus(focus)` | 5 (the button only exists on that grid, so its `trackId` **is** `melodyTrackForFocus(focus)`) |
| A focus change away from the armed track disarms it | 5 |
| `melodyTracks.ts` docblock rewritten | 4 |
| CLAUDE.md FX-recorder sentence rewritten in the falsifying commit | 1 and 5 (two commits falsify two different claims in it) |
| note-input rules honoured: bus observer, both edges, no preview | Constraint section + Task 3 (the rule file's one stale setter name) |
| Testing plan: factory produces two independent bridges; one armed track only; gates on the matching id; focus change disarms; exercised by emitting on the bus | 3 (bridges, bus), 1 (one armed track), 4 (gates), 5 (disarm) |

**One recorded deviation.** The spec's sentence *"`leadClockActive` and `leadMarkerFollowsClock` take the track id and compare `recordingTrack === id`"* is implemented for `leadMarkerFollowsClock` only. `leadClockActive` reads no arm state today and answers a transport question — "is there music to play along to" — so a `trackId` parameter would be unused (an eslint error) and a per-track answer would be wrong (it would tell a lead recorder there is no clock while FX is playing). Instead it gains the `fxPlayer` term. Task 4's docblock states this in the file.

**2. Placeholder scan.** No "TBD", no "similar to Task N", no "add error handling", no "write tests for the above". Every code step carries the actual code; every test step carries the actual assertions and the exact command plus expected failure text. Every symbol used in a later task is defined in an earlier one or exists in the repo today.

**3. Type consistency.** `recordingTrack: MelodyTrackId | null` and `setRecordingTrack: (track: MelodyTrackId | null) => void` are spelled identically in Tasks 1, 3, 4 and 5. `melodyTrackForFocus(focus: MixLayerId): MelodyTrackId | null` matches Plan 1's Task 1 Produces block verbatim; `focusTrack: MixLayerId` / `setFocusTrack: (focus: MixLayerId) => void` match Plan 1's Task 2 Produces block. `recordFxNote: (note: string, column?: number) => boolean` matches `recordLeadNote`'s existing signature in `src/store/types.ts`. `startMelodyRecordBridge` (singular, takes a track) and `startMelodyRecordBridges` (plural, composes) are used consistently: only the plural appears in `engineSync.ts` and in the test `beforeEach`.

# Playback Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make crossing the Loop/Song boundary preserve playback exactly when what sounds afterwards is the loop now in focus — and make the `PlaybackScope` the ground truth that decision reads.

**Architecture:** `songMode.reconcile()` stops hard-stopping every player on a layer boundary. Instead it dispatches a new `focus-loop` scope action and executes a stop only when that transition lands on `none` with players playing. That only works if the scope always says what is sounding, so the phase first closes the three places where the cursor and the scope can drift apart (`loadLoop`, `vibes`, `addLoop`/`duplicateLoop`) and one where the scope can outlive its loop (`deleteLoop`).

**Tech Stack:** TypeScript, React 19, Zustand (`subscribeWithSelector` + `persist`), Bun test runner, Vite, Tailwind + daisyUI.

**Spec:** `docs/superpowers/specs/2026-09-08-loop-song-ia-and-playback-continuity-design.md` — §6 (Playback continuity), §7 (Naming), Out of scope, Implementation order item 3, Test obligations, and the closing section "What Phase 1 learned that Phase 3 must carry".

**Phase:** 3 of 4. Phase 1 (`2026-09-08-one-transport.md`) and Phase 2 (`2026-09-08-nav-restructure.md`) are merged on `main`. Phase 4 is track solo.

**This phase changes audible behaviour.** Phase 2 was a layout change and a wrong answer showed up as a misplaced button. Here a wrong answer is *silence where there should be music*, *music where the user expected silence*, or a note left hanging with no transport that can stop it. `bun run verify` cannot hear any of those, so the manual check at the end of this plan is part of the work, not a courtesy.

## Global Constraints

- `bun run verify` is the completion gate for every task. It runs test + lint + eslint + check:keys + check:drums + check:contrast + check:levels + build. Every task ends green under it and is committed.
- `bun run eslint` currently reports **nothing at all** — no errors and no warnings. That is the state to keep it in. A new `react-hooks/exhaustive-deps` or `complexity` warning is silenced with a line disable naming its reason, never by relaxing the rule.
- **Nothing in this phase is persisted.** Do not add keys to `partializeAppState` or `PROJECT_CONTENT_KEYS`, and do not move `PERSIST_VERSION` or `PROJECT_FORMAT_VERSION`. `playbackScope` is not in `partializeAppState` today (checked: `store.ts`'s partialize block names `activeLoopId`, not `playbackScope`) and must not enter it.
- Layer rules: `src/store/` never imports `src/components/`; `src/components/` must not import `audio/engine`; never call engine setters from a component — state goes in a slice and is wired in `src/store/engineSync.ts`.
- Import style: `@/` alias for cross-directory imports, relative for siblings. The `../../` form is an eslint error. Note that `src/store/*.ts` files already reach `src/types.ts` as `'../types'` (see `songMode.ts:3`, `transportSlice.ts:8`); match that, do not introduce a second style in the same folder.
- `interface` for object shapes (`consistent-type-definitions` is an error); `type` only for unions such as `PlaybackScope`.
- This repo's `bun:test` typings **do not export `it`**. Write `test(...)`, never `it(...)`. Existing files import `{ describe, expect, test }` from `'bun:test'`.
- There is no DOM and no testing-library, and none may be added. Store behaviour is tested against the real store; component behaviour is tested through exported pure helpers or `renderToString`.
- No meter/per-frame value may enter a slice, and high-frequency state stays local: all four views stay mounted, so any slice write re-renders every mounted view.
- Branch: `feat/playback-continuity`, cut from `main`. Feature work never lands as a commit made directly on `main`.
- The spec's invariant, quoted, because every task argues from it:
  > Playback survives a navigation if and only if what sounds afterwards is exactly the loop now in focus.
- §6's table, which the plan is measured against and which the manual check must reproduce by clicking:

  | From | To | Result |
  |---|---|---|
  | Loop layer playing loop L | Song layer | **continues**, shown as the solo loop of L |
  | Song layer solo-looping L | edit L | **continues** |
  | Song layer solo-looping L | edit M | **stops** |
  | Song layer playing the song | edit any loop | **stops** |

- Phase 1's invariant, which this phase must keep true: **while any player is `'playing'`, the scope is never `none`.** `none` means stopped, on both layers.

---

## Why this order

The six tasks are ordered by dependency, and the order is the argument:

1. **Rename first** (`'solo'` → `'loop'`) because it is a mechanical rename that touches every file the later tasks edit. Doing it last would mean re-editing all of them; doing it in Phase 4 would mean renaming *in a codebase where both meanings of "solo" are live*, which is exactly when a mechanical rename stops being mechanical.
2. **Close `loadLoop` / `vibes`**, and 3. **close `addLoop` / `duplicateLoop`**, before anything reads the scope as ground truth. Everything in §6 decides what survives a navigation *from the scope alone*. A player playing under a `none` scope, or a `loop{X}` scope while the Loop layer edits `Y`, makes that decision wrong — and Task 5 turns a wrong decision into an audible hard stop or a stuck note.
4. **`focus-loop`** is the decision, as a pure reducer row.
5. **`reconcile()`** is the execution of that decision, and the only place a layer crossing stops anything.
6. **`deleteLoop`** closes the last way the scope can name something that is not there.

Tasks 4 and 5 could in principle be one task; they are split because a reviewer can meaningfully reject the reducer table while accepting the reconcile wiring, and because Task 4's deliverable (a total pure function) is testable with no store at all.

---

### Task 1: rename the scope kind `'solo'` → `'loop'`, and stop showing the user the word

`PlaybackScope`'s `solo` kind means *one loop auditioned alone*. Phase 4 adds *track solo* — five per-track solo buttons that mean something completely different. Spec §7 recommends this rename and says it is cheap "now while both are being touched"; this plan rules that it happens here rather than in Phase 4, and the reason is the whole point: today only one meaning of "solo" exists in the codebase, so a grep is unambiguous and a rename is safe. After Phase 4 lands, a rename of `'solo'` would have to distinguish two live meanings by hand in every hit — the precise situation in which mechanical renames introduce bugs.

§7 also says that if the rename is *declined*, every remaining mention must be qualified as "solo loop" or "track solo" — "the bare word must not survive". Apply that rule to the remainder anyway: in the files this task touches, any bare "solo" left in prose or in an identifier becomes "solo loop" or is renamed.

**That includes the rendered copy, and the rendered copy matters most.** `SortableLoopCard.tsx` renders a `SOLO` badge on the auditioning card. It is the one place a *user* — not a reader of the code — sees the word, and Phase 4 is about to put solo buttons on every editing surface. A card badge still reading `SOLO` would then be the most confusing string in the app: same word, two features, one screen apart. §7's fallback rule does not exempt UI copy. The badge becomes **`AUDITION`**, which removes the ambiguous word rather than qualifying it, matches the prop that already drives it (`isAuditioning`) and the language `playbackScope.ts`'s own doc comment uses ("one loop is auditioned alone"), and can never be read as a track solo. `isAuditioning` **keeps its name**: it does not contain the ambiguous word, and after this change the prop, the badge and the doc comment all say the same thing. There are no users to re-teach — `CLAUDE.md` records that solna has none yet — so there is no continuity cost to spend here.

**The store action `soloLoop(id)` keeps its name.** Renaming an action with call sites in two components is more than §7 asks for, and `soloLoop` is not ambiguous the way a bare `solo` is — it names a loop in the identifier itself. Its doc comment must say plainly that it establishes the `loop` scope and is unrelated to the track solo Phase 4 adds, so the next reader does not have to guess.

Nothing outside the touched files reads the union's `kind`; a repo-wide grep for `solo` found hits only in `playbackScope.ts`, `transportSlice.ts`, `songMode.ts`, `types.ts`, `ArrangeView.tsx`, `TransportBar.tsx`, `SortableLoopCard.tsx`, their tests, and one unrelated `synthPresets.ts` description string.

**Files:**
- Modify: `src/store/playbackScope.ts` — the type union (lines 48-51), the reducer's `toggle-loop` case (99-109), `soloLoopId` (113-116), `loopPlayButton` (118-129), and the prose in the file header comment (1-47)
- Modify: `src/store/transportSlice.ts` — `transportDisplayState` (75-96) and `soloLoop`'s doc comment and body (169-186)
- Modify: `src/store/songMode.ts` — lines 103, 110, 134 and the surrounding comments
- Modify: `src/store/types.ts:60-61` — `soloLoop`'s doc comment
- Modify: `src/components/song/ArrangeView.tsx` — the import at line 19, `soloId` at 75-82, `soloLoopId` at 173, `soloId` at 240-241
- Modify: `src/components/TransportBar.tsx` — the comment at 54-57
- Modify: `src/components/song/SortableLoopCard.tsx` — the badge copy and the prose at lines 173, 195 and 271
- Test: `src/store/playbackScope.test.ts`, `src/store/transportSlice.test.ts`, `src/store/songMode.test.ts`, `src/components/TransportBar.test.tsx`, `src/components/song/SortableLoopCard.test.tsx`

**Interfaces:**
- Produces: `type PlaybackScope = { kind: 'none' } | { kind: 'song' } | { kind: 'loop'; loopId: string }` and `scopedLoopId(scope: PlaybackScope): string | null`. Every later task uses these names.
- Unchanged: `SCOPE_NONE`, `SCOPE_SONG`, `playbackScopeReducer`, `loopPlayButton`, the store action `soloLoop(loopId: string): void`, and `SortableLoopCard`'s `isAuditioning` prop.

- [ ] **Step 1: Change the tests first, so the rename is driven rather than checked afterwards**

In `src/store/playbackScope.test.ts`, rename the fixture at line 14 and every use of it:

```ts
const LOOP_A: PlaybackScope = { kind: 'loop', loopId: 'A' };
```

Update the import at lines 4-12 to bring in `scopedLoopId` instead of `soloLoopId`, then replace every `SOLO_A` with `LOOP_A`, every `{ kind: 'solo', loopId: 'A' }` in the `TABLE` (lines 23-41) with `{ kind: 'loop', loopId: 'A' }`, and the two `soloLoopId(...)` calls (line 56 and wherever else) with `scopedLoopId(...)`. Rename the test name at line 54 to read "play-all takes over from a solo loop — a loop id can never survive it", and the label expression at line 45 from `from.kind === 'solo' ? \`solo(${from.loopId})\`` to:

```ts
    const label = from.kind === 'loop' ? `loop(${from.loopId})` : from.kind;
```

Do the same substitution in `src/store/transportSlice.test.ts` (lines 210, 211, 217, 225-228, 235-237, 245-247, 250-251, 257-275, 307), `src/store/songMode.test.ts` (the `soloLoopId` import at line 7 and its use at line 407; the literal at 353-356 and 401), and `src/components/TransportBar.test.tsx` (line 69). Rename test *names* containing the bare word too: "a soloing scope makes the master button offer Play" becomes "a solo-loop scope makes the master button offer Play".

In `src/components/song/SortableLoopCard.test.tsx`, change the two assertions that pin the badge copy (the tests at roughly lines 320 and 327 — find them with `grep -n "SOLO" src/components/song/SortableLoopCard.test.tsx`) to expect `AUDITION`, and rename those tests: "the auditioning card shows Stop and the AUDITION badge, and is not disabled" and "a card that is not auditioning shows no AUDITION badge".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store src/components/TransportBar.test.tsx src/components/song/SortableLoopCard.test.tsx`
Expected: FAIL — TypeScript reports `Type '"loop"' is not assignable to type '"none" | "song" | "solo"'`, `scopedLoopId` is not exported, and the card test's substring assertion fails against the rendered `SOLO`.

- [ ] **Step 3: Rename in `playbackScope.ts`**

Replace the union at lines 48-51 with:

```ts
export type PlaybackScope =
  | { kind: 'none' }
  | { kind: 'song' }
  /** One loop auditioned alone — a SOLO LOOP. Phase 4's per-track solo is a
   *  different feature in a different slice and never appears here. */
  | { kind: 'loop'; loopId: string };
```

In the reducer's `toggle-loop` case (lines 99-109), change `scope.kind === 'solo'` to `scope.kind === 'loop'`, the returned literal `{ kind: 'solo', loopId: action.loopId }` to `{ kind: 'loop', loopId: action.loopId }`, and the comments so they read "solo loop" rather than "solo":

```ts
    case 'toggle-loop':
      if (scope.kind === 'loop') {
        // Same card again = stop. A different card is unreachable (disabled).
        return scope.loopId === action.loopId ? SCOPE_NONE : scope;
      }
      // Unreachable while the song owns the transport: cards stay disabled
      // for the arrangement's whole run, including across the internal
      // restarts song advance drives through loadLoop (see the reducer's
      // own doc comment above).
      if (scope.kind === 'song') return scope;
      return { kind: 'loop', loopId: action.loopId };
```

Replace `soloLoopId` (lines 113-116) with:

```ts
/**
 * The id of the loop the scope names, or null. The one accessor views should
 * need. Named for the SCOPE, not for "solo", because Phase 4 introduces a
 * per-track solo that has nothing to do with this value.
 */
export function scopedLoopId(scope: PlaybackScope): string | null {
  return scope.kind === 'loop' ? scope.loopId : null;
}
```

In `loopPlayButton` (118-129) change `scope.kind === 'solo'` to `scope.kind === 'loop'` and the doc comment's `soloLoopId()` reference to `scopedLoopId()`. In the file header comment (lines 1-47), rewrite the third bullet and every prose "solo":

```
 *   loop — one loop is auditioned alone (a SOLO LOOP). Song advance is
 *          suppressed; that card shows Stop and every other card button is
 *          disabled. Unrelated to the per-track solo Phase 4 adds, which
 *          lives in the ui slice and never touches this union.
```

- [ ] **Step 4: Fix the store consumers**

`src/store/transportSlice.ts` — in `transportDisplayState` (75-96) change the guard to `if (scope.kind !== 'loop') return aggregate;` and rewrite the doc comment's four uses of "solo" as "solo loop". In `soloLoop` (169-186) change `scope.kind === 'solo'` to `scope.kind === 'loop'` and replace the doc comment with:

```ts
    /**
     * A loop card's own play/stop button, and (since Phase 1) the master Play
     * on the Loop layer. It establishes the `loop` scope — the SOLO LOOP —
     * and drops the song cursor in the same set(), so the two can never be
     * observed disagreeing. Nothing to do with the per-track solo Phase 4
     * adds: this is one LOOP played alone, not one TRACK heard alone. The
     * name is kept only because two components call it.
     *
     * The caller (ArrangeView) is responsible for loadLoop-ing the target
     * FIRST, because loadLoop hard-stops and restarts whatever was playing.
     */
```

`src/store/types.ts:60-61` — replace the doc comment:

```ts
  /** A loop card's play/stop button and the Loop layer's master Play: play
   *  this loop alone (scope `loop`), or stop it. Not the track solo. */
  soloLoop: (loopId: string) => void;
```

`src/store/songMode.ts` — lines 103, 110 and 134: `s.playbackScope.kind !== 'solo'` → `!== 'loop'`, `cur.playbackScope.kind === 'solo'` → `=== 'loop'`, `s.playbackScope.kind === 'solo'` → `=== 'loop'`. In the comment at 135-139 change "kind==='solo'" to "kind==='loop'". Leave the comment at 93-95 alone — Task 5 replaces it wholesale.

- [ ] **Step 5: Fix the component consumers and the badge**

`src/components/song/ArrangeView.tsx` — line 19 `import { loopPlayButton, scopedLoopId } from '@/store/playbackScope';`; line 75 `const scopedId = scopedLoopId(playbackScope);`; lines 78-82 and 240-241 use `scopedId`; line 173 `scopedLoopId(s.playbackScope) === id`.

`src/components/TransportBar.tsx` — lines 54-57, rewrite the comment so the bare word is qualified:

```tsx
  // On the song layer a solo-looping card leaves the master button offering
  // Play (a one-click takeover). On the loop layer the button owns the solo
  // loop of the loop being edited. Hard stop stays live off the REAL player
  // states, so sounding audio always has a visible global kill.
```

`src/components/song/SortableLoopCard.tsx` — run `grep -n "SOLO\|solo" src/components/song/SortableLoopCard.tsx` and change every hit. The badge literal lives in the status-badge helper the comment at line 271 describes ("The card's one status badge: soloed, playing, cued, or nothing") — **read that helper before editing rather than assuming its shape**; it may render the word inside a daisyUI `badge` element or return it as a string. Replace the literal `SOLO` with `AUDITION`, and rewrite the prose at lines 173, 195 and 271 so "soloed"/"soloing" become "auditioning":

```tsx
/** The card's one status badge: auditioning, playing, cued, or nothing. The
 *  word is AUDITION, not SOLO: Phase 4 puts per-TRACK solo buttons on the
 *  editing surfaces, and one screen must not use the same word for playing
 *  one loop alone and for hearing one track alone. */
```

Do not change any class name while you are in there — `scripts/themeTokenGuard.ts` scans this file and the badge's classes are already token-clean.

- [ ] **Step 6: Sweep for survivors**

Run: `grep -rn "solo" src --include="*.ts" --include="*.tsx" | grep -vi "solo loop\|soloLoop\|synthPresets"`
Expected: no hits. Anything left is a bare "solo" this task was supposed to qualify or rename.

- [ ] **Step 7: Verify and commit**

```bash
bun run verify
git add src/store src/components
git commit -m "refactor(scope): rename the solo scope kind to loop and the card badge to AUDITION"
```

---

### Task 2: close the `loadLoop` / `vibes` unscoped-restart hole

Phase 1 found this and documented it instead of closing it, because closing it means deciding what a loop switch should leave sounding — which is §6's own question. Both `loadLoop.ts`'s non-boundary branch and `vibes.ts`'s `applyVibeToStore` capture which players were active, call `hardStopAll()` (which dispatches `stop-all` and resets the scope to `none`), and then restart with `play(module)`, which sets no scope. Two clicks from the Loop layer — press Play, then switch loops or click a vibe — leave every player `'playing'` under a `none` scope. Task 5 reads the scope alone to decide what survives a navigation, and reads `none` as "stopped": with this hole open, the very next tab change would either fail to stop audio it should stop or hard-stop audio it should keep, depending on the row. It must close first.

#### The constraint this task has to satisfy, and how it is resolved

Two of §6's rows pull in opposite directions, and `loadLoop` sits between them:

- Row 2 — **song layer solo-looping L → edit L → continues.**
- Row 3 — **song layer solo-looping L → edit M → stops.** This is not a derived abstraction; it is the user's own request, in their words: *"ถ้า play solo loop ในหน้า song แล้วเข้าไป edit loop นั้น, ให้คงเล่น loop นั้นไว้ แต่ถ้าเข้า edit คนละ loop ที่เล่น solo loop อยู่ ให้ stop"*. Stop is the requested behaviour for exactly this transition, and it must be reachable by clicking.

Meanwhile `loadLoop`'s `wasActive` restart exists for a third thing, which nobody wants to lose: **switching the working loop from the loop selector while the Loop layer plays is seamless** — the new loop comes up on the next bar line instead of the transport dropping out.

Both user actions call `loadLoop` today, so the two must be distinguishable at that call site. Three ways to do it were considered:

- **`focus-loop` does the stopping and `loadLoop` stays dumb.** Rejected. For the crossing to stop, `loadLoop(M)` would have to leave the stale `loop{L}` scope behind while M's audio is playing — the scope would knowingly lie about what is sounding, and the Arrange screen would render card *L* as Stop while *M* sounds. This whole phase is built on the scope being ground truth; a rule that requires it to be wrong for one screen is not a rule, it is the bug in a different place.
- **An option on `loadLoop`** (`loadLoop(id, { audition: 'follow' | 'stop' })`). Rejected as the default: it puts the decision at four call sites, two of which (the song-advance boundary path and the delete fallback) have no opinion to express. Keep it in mind as the escape hatch if the chosen rule ever proves too coarse.
- **The layer at the time of the call.** Chosen. It is one decision, computed once, inside the one function every loop switch already funnels through, and the layer is *exactly* what distinguishes the two user actions: "switch the loop I am editing" only exists on the Loop layer, and "pick a different loop to work on" from Arrange is the Song layer.

**The rule, therefore:**

| scope before | layer at the call | result |
|---|---|---|
| anything, nothing playing | either | no restart, `none` |
| `song` | either | restart, `song` — the arrangement still owns the transport |
| any | `loop` | restart, `loop{id}` — the seamless working-loop switch |
| `loop{id}` (same loop) | `song` | restart, unchanged — reloading the loop that is already auditioning |
| `loop{other}` | `song` | **no restart**, `none` — §6 row 3 |

The last row is the correction that matters: on the Song layer, picking a different loop while one is auditioning **stops the audition**, and it stops it at the moment of the pick. `loadLoop` already hard-stopped every player before loading; the implementation is simply to *not restart them*.

**Why stopping there is right and not merely spec-obedient.** The Arrange UI already forbids moving the audition to another card while one is soloing — `loopPlayButton` disables every other card's play button for the whole run. If the card *select* silently moved the audition to M, it would be a back door around the rule the disabled buttons enforce. And it makes row 3 reachable by clicking, which is the test the coordinator set: press card L's play, click card M, hear it stop, walk into the Loop layer and edit M in silence. The stop lands one click earlier than §6's table implies — the table is a From/To/Result table and its Result is what the user gets — and it lands on the act the user's own sentence names ("เข้า edit คนละ loop").

**The cost, stated plainly so it is a choice and not a surprise:** you cannot hop an audition from card to card on Arrange. Selecting a different loop stops the sound; hearing the new one is a second click on its play button. The header's loop dropdown is visible on the Song layer too, so it behaves the same way there. The alternative — letting the audition follow the selection — is precisely what the user asked not to happen.

**`vibes` gets the same answer through the same function, with no special case.** A vibe rewrites the *current* loop and never moves `activeLoopId`, so it always lands on the "same loop" row: it restarts and keeps its scope, whether that is `loop{active}` or `song`. Clicking a vibe mid-playback continues to play, which is today's behaviour and what the Instant Vibes bar is for. (If the scope and the cursor ever disagree when a vibe is clicked on the Song layer, the shared rule stops playback rather than restarting under a lie — a healing outcome, not a designed one.)

**The `play(module)` caller guard gets tightened, not kept.** Both restarts stop calling `play(module)` and write one `set()` instead, so `playbackScope.test.ts`'s `ALLOWED` list shrinks from three entries to one (`src/store/transportSlice.ts`, which defines `play`). That is strictly stronger: after this task, *no* production file outside the transport slice can start a player without a scope.

**Files:**
- Modify: `src/store/playbackScope.ts` — add `RestartDecision` and `restartAfterStop`, rewrite the header INVARIANT comment (lines 24-46)
- Modify: `src/store/transportSlice.ts` — add `WasActivePlayers`, `NO_PLAYERS_ACTIVE` and `restartPlayersPatch` next to `allPlayersPatch` (lines 61-73)
- Modify: `src/store/loadLoop.ts` — lines 100-117 and the doc-comment paragraph at 54-55
- Modify: `src/store/vibes.ts` — lines 102-107 and 190-196
- Test: `src/store/playbackScope.test.ts` (the `restartAfterStop` table and the tightened `ALLOWED`), `src/store/loadLoop.test.ts`, `src/store/vibes.test.ts`

**Interfaces:**
- Consumes: `PlaybackScope`, `SCOPE_NONE`, `SCOPE_SONG`, `scopedLoopId` from Task 1; `Layer` and `layerForTab` from `../types`.
- Produces:
  - `interface RestartDecision { restart: boolean; scope: PlaybackScope }` and `restartAfterStop(before: PlaybackScope, focusedLoopId: string, layer: Layer, wasPlaying: boolean): RestartDecision` in `src/store/playbackScope.ts`.
  - `interface WasActivePlayers { sequencer: boolean; chords: boolean; lead: boolean }`, `NO_PLAYERS_ACTIVE: WasActivePlayers`, and `restartPlayersPatch(wasActive: WasActivePlayers, scope: PlaybackScope): Partial<AppStore>` in `src/store/transportSlice.ts`.
  - Task 6 adds a sibling `stopAllPlayersPatch(state)` in the same file; do not write it here.

- [ ] **Step 1: Write the failing test for `restartAfterStop`**

Append to `src/store/playbackScope.test.ts`, after the `playbackScopeReducer` describe block:

```ts
describe('restartAfterStop — what an internal stop-and-restart brings back', () => {
  test('nothing was playing: nothing restarts and the scope stays stopped', () => {
    expect(restartAfterStop(LOOP_A, 'A', 'loop', false)).toEqual({
      restart: false,
      scope: SCOPE_NONE,
    });
    expect(restartAfterStop(SCOPE_SONG, 'A', 'song', false)).toEqual({
      restart: false,
      scope: SCOPE_NONE,
    });
  });

  test('a song scope survives on either layer: the arrangement owns the transport', () => {
    expect(restartAfterStop(SCOPE_SONG, 'B', 'song', true)).toEqual({
      restart: true,
      scope: SCOPE_SONG,
    });
    expect(restartAfterStop(SCOPE_SONG, 'B', 'loop', true)).toEqual({
      restart: true,
      scope: SCOPE_SONG,
    });
  });

  test('switching the working loop ON THE LOOP LAYER is seamless and re-points', () => {
    expect(restartAfterStop(LOOP_A, 'B', 'loop', true)).toEqual({
      restart: true,
      scope: { kind: 'loop', loopId: 'B' },
    });
  });

  test('reloading the loop that is already auditioning keeps it playing', () => {
    expect(restartAfterStop(LOOP_A, 'A', 'song', true)).toEqual({
      restart: true,
      scope: LOOP_A,
    });
  });

  // §6 row 3, in its pure form: picking a DIFFERENT loop on the song layer
  // while one is auditioning stops the audition. It does not follow the pick.
  test('picking a different loop ON THE SONG LAYER stops the audition', () => {
    expect(restartAfterStop(LOOP_A, 'B', 'song', true)).toEqual({
      restart: false,
      scope: SCOPE_NONE,
    });
  });

  // Unreachable while "playing implies a scope" holds, but the function is
  // total and heals rather than propagating the broken state.
  test('a none scope with players running is healed on the loop layer', () => {
    expect(restartAfterStop(SCOPE_NONE, 'B', 'loop', true)).toEqual({
      restart: true,
      scope: { kind: 'loop', loopId: 'B' },
    });
  });
});
```

Add `restartAfterStop` to the import from `./playbackScope`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/playbackScope.test.ts`
Expected: FAIL — `restartAfterStop` is not exported from `./playbackScope`.

- [ ] **Step 3: Write `restartAfterStop`**

Add `import type { Layer } from '../types';` at the top of `src/store/playbackScope.ts` (the file currently imports nothing; this is the first import and must be `import type`, since the module is otherwise dependency-free), then append after `scopedLoopId`:

```ts
/** Whether an internal stop-and-restart brings the players back, and under what scope. */
export interface RestartDecision {
  restart: boolean;
  scope: PlaybackScope;
}

/**
 * The decision an INTERNAL stop-and-restart has to make — the shape
 * loadLoop's non-boundary branch and applyVibeToStore both have: capture who
 * was active, hardStopAll (which resets the scope to `none`), rewrite the
 * content, and then decide. Before this existed the "decide" step was three
 * unconditional play(module) calls, which set no scope and left playback
 * running under `none`.
 *
 * The layer is a parameter because it is what distinguishes two user actions
 * that both land here:
 *
 *   LOOP layer — "switch the loop I am editing" while the transport runs.
 *     Seamless by design: the new loop comes up on the next bar line and the
 *     scope re-points to it, because what sounds afterwards IS the loop now
 *     in focus.
 *
 *   SONG layer — "pick a different loop to work on" from an Arrange card or
 *     the header dropdown, while one loop is auditioning. The audition does
 *     NOT follow the pick: it stops. That is §6 row 3 and it is the user's
 *     own request ("ถ้าเข้า edit คนละ loop ที่เล่น solo loop อยู่ ให้ stop").
 *     It is also the only answer consistent with the Arrange UI, which
 *     already disables every other card's play button for the whole run of
 *     an audition — letting a card SELECT move the audition would be a back
 *     door around that rule.
 *
 * A song scope survives either way: an arrangement is not one loop, its
 * cursor was already carried across by the caller, and dropping it would
 * strand a playing song under a scope that means stopped.
 *
 * The `none`-with-players-running row is unreachable while "playing implies
 * a scope" holds. It is answered honestly rather than propagated, because
 * handing songMode a scope that lies is exactly the failure this closes.
 */
export function restartAfterStop(
  before: PlaybackScope,
  focusedLoopId: string,
  layer: Layer,
  wasPlaying: boolean,
): RestartDecision {
  if (!wasPlaying) return { restart: false, scope: SCOPE_NONE };
  if (before.kind === 'song') return { restart: true, scope: SCOPE_SONG };
  if (layer === 'loop') {
    return before.kind === 'loop' && before.loopId === focusedLoopId
      ? { restart: true, scope: before }
      : { restart: true, scope: { kind: 'loop', loopId: focusedLoopId } };
  }
  if (before.kind === 'loop' && before.loopId === focusedLoopId) {
    return { restart: true, scope: before };
  }
  return { restart: false, scope: SCOPE_NONE };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/playbackScope.test.ts`
Expected: PASS for the new describe block. The `play(module) caller guard` block still passes — nothing has moved yet.

- [ ] **Step 5: Add the player patch helpers**

In `src/store/transportSlice.ts`, immediately after `allPlayersPatch` (ends line 73), add:

```ts
/** Which players an internal stop-and-restart has to bring back. */
export interface WasActivePlayers {
  sequencer: boolean;
  chords: boolean;
  lead: boolean;
}

/** None of them — the patch for a stop-and-restart that decides not to restart. */
export const NO_PLAYERS_ACTIVE: WasActivePlayers = Object.freeze({
  sequencer: false,
  chords: false,
  lead: false,
});

/**
 * The players a restart brings back, and the scope that goes with them, as
 * ONE patch. Callers apply it in a single set() so that no subscriber ever
 * observes players running under a scope that disagrees with them — the same
 * reason allPlayersPatch exists above.
 *
 * Writing 'playing' unconditionally is safe and is exactly what the three
 * play(module) calls this replaces did: every caller has just run
 * hardStopAll(), so every player is 'stopped' and play()'s own
 * `current === 'stopped' ? 'playing' : current` guard could only ever take
 * the first branch.
 */
export function restartPlayersPatch(
  wasActive: WasActivePlayers,
  scope: PlaybackScope,
): Partial<AppStore> {
  return {
    ...(wasActive.sequencer ? { sequencerPlayer: 'playing' as const } : {}),
    ...(wasActive.chords ? { chordsPlayer: 'playing' as const } : {}),
    ...(wasActive.lead ? { leadPlayer: 'playing' as const } : {}),
    playbackScope: scope,
  };
}
```

- [ ] **Step 6: Rewrite `loadLoop`'s restart**

In `src/store/loadLoop.ts`, replace lines 100-117 (from `const wasActive = {` to the last `store.play('lead');`) with:

```ts
  // Captured BEFORE hardStopAll, which resets the scope to `none`.
  const scopeBefore = store.playbackScope;
  const wasActive = {
    sequencer: store.sequencerPlayer !== 'stopped',
    chords: store.chordsPlayer !== 'stopped',
    lead: store.leadPlayer !== 'stopped',
  };
  const wasPlaying = wasActive.sequencer || wasActive.chords || wasActive.lead;
  // The layer decides which user action this is: switching the loop being
  // EDITED (loop layer, seamless) or picking a different loop to work on from
  // Arrange while one is auditioning (song layer, stops). See restartAfterStop.
  const decision = restartAfterStop(scopeBefore, id, layerForTab(store.activeTab), wasPlaying);
  store.hardStopAll();
  for (const source of ACCOMPANIMENT_SOURCES) {
    audioEngine.stopSource(source, LOAD_LOOP_RELEASE);
  }

  useAppStore.setState({ ...loopStatePatch(loop), activeLoopId: id, songLoopIndex });

  // Restart what the decision allows, WITH the scope it should leave behind.
  // The playback hooks arm on the next bar line for the active meter, so a
  // restart lands on beat 1 with no alignment code (the same guarantee the
  // Instant Vibe swap relies on). Declining to restart needs no extra work:
  // hardStopAll above already silenced everything, so the patch just carries
  // SCOPE_NONE and the transport is genuinely stopped.
  //
  // One set(), not three play(module) calls: play(module) sets no scope, so
  // the old form left players 'playing' under the `none` scope hardStopAll
  // had just written — the hole Phase 1 documented at PlaybackScope and this
  // closes. It stays a SEPARATE set() from the content patch above, though,
  // and deliberately: the content patch must reach engineSync's per-value
  // subscriptions BEFORE the transport's stopped->playing transition, which
  // is what re-anchors the clock. Folding the two together would leave that
  // ordering to subscriber registration order.
  useAppStore.setState(
    restartPlayersPatch(decision.restart ? wasActive : NO_PLAYERS_ACTIVE, decision.scope),
  );
```

Add to the imports at the top of the file:

```ts
import { layerForTab } from '../types';
import { restartAfterStop } from './playbackScope';
import { NO_PLAYERS_ACTIVE, restartPlayersPatch } from './transportSlice';
```

Then replace the doc-comment paragraph at lines 54-55 ("The song scope needs no preserving on that path either…") with:

```
 * Scope, on both paths. The seamless path never calls hardStopAll, so the
 * caller's scope simply survives it. The default path does call it, and
 * restartAfterStop then decides what comes back: on the LOOP layer the
 * switch is seamless and the scope re-points to the loop just loaded; on the
 * SONG layer picking a DIFFERENT loop while one is auditioning stops the
 * audition instead of moving it (spec §6 row 3); a song scope survives
 * either way; and a load with nothing playing leaves `none`.
```

- [ ] **Step 7: Rewrite the vibe restart**

In `src/store/vibes.ts`, add `const scopeBefore = store.playbackScope;` immediately above the `wasActive` object at line 102, with the comment `// Captured BEFORE hardStopAll below, which resets it to 'none'.` Then replace lines 190-196 (the comment and the three `store.play(...)` calls) with:

```ts
  // Restart what was running, in ONE set() that also puts the scope back.
  // Both playback hooks arm on `step % stepsPerBar === 0` for the ACTIVE
  // meter, which was just set above, so the restart lands on the next bar by
  // construction — no alignment code needed here.
  //
  // A vibe rewrites the CURRENT loop and never moves activeLoopId, so it
  // always lands on restartAfterStop's "same loop" row: it keeps playing,
  // under the scope it already had. The three play(module) calls this
  // replaces set no scope at all, which is why clicking a vibe mid-playback
  // used to leave every player 'playing' under `none`.
  const wasPlaying = wasActive.sequencer || wasActive.chords || wasActive.lead;
  useAppStore.setState((s) => {
    const decision = restartAfterStop(
      scopeBefore,
      s.activeLoopId,
      layerForTab(s.activeTab),
      wasPlaying,
    );
    return restartPlayersPatch(decision.restart ? wasActive : NO_PLAYERS_ACTIVE, decision.scope);
  });
```

Add `import { layerForTab } from '../types';`, `import { restartAfterStop } from './playbackScope';` and `import { NO_PLAYERS_ACTIVE, restartPlayersPatch } from './transportSlice';` to the file's imports if they are not already present (check the existing import block — `vibes.ts` already imports `useAppStore` from `./store`).

- [ ] **Step 8: Tighten the caller guard**

In `src/store/playbackScope.test.ts`, replace the `ALLOWED` set (lines 88-92) and its comment with:

```ts
  // Everything that may legitimately reference the per-module play(module):
  // the slice that defines it. Nothing else. Phase 3 closed the two holes
  // this list used to hold open — loadLoop.ts and vibes.ts now restart
  // through one set() that writes the scope with the players (see
  // restartPlayersPatch) — so a production file reaching for play(module)
  // again is re-opening a closed hole, not joining a documented exception.
  // Test files are exempt below by extension, not listed here, because they
  // legitimately drive play(module) as a fixture and never run in production.
  const ALLOWED = new Set(['src/store/transportSlice.ts']);
```

Update the offender message's wording in the same file so it stops promising that `loadLoop.ts`/`vibes.ts` are acceptable precedents:

```ts
          `${rel} calls play(module) but is not on the allowlist ` +
            `(${[...ALLOWED].join(', ')}). play(module) can start a stopped ` +
            `player without setting a playbackScope, which breaks the ` +
            `invariant songMode reads (see the INVARIANT comment above ` +
            `playbackScope.ts's PlaybackScope type). Route the new caller ` +
            `through playAll/soloLoop, or through restartAfterStop + ` +
            `restartPlayersPatch if it is an internal stop-and-restart like ` +
            `loadLoop's.`,
```

- [ ] **Step 9: Rewrite the INVARIANT comment**

In `src/store/playbackScope.ts`, replace the header comment's lines 24-46 (from "It does NOT yet hold across two call sites" to the end of that paragraph) with:

```
 * It holds across the two internal stop-and-restart paths as well, since
 * DEV Phase 3: loadLoop.ts's non-boundary branch and vibes.ts's
 * applyVibeToStore both hard-stop and restart, and both now go through
 * restartAfterStop + restartPlayersPatch, which decide whether the players
 * come back at all and write the scope with them in one set() instead of
 * leaving the `none` that hardStopAll wrote. songMode reads the scope alone
 * to decide what survives a navigation, so a restart that sets no scope
 * would make that decision act on a lie — silence where music should
 * continue, or a hard stop the user did not ask for.
 *
 * A source-scan guard in playbackScope.test.ts keeps that true: the only
 * file allowed to reference play(module) is transportSlice.ts, which defines
 * it. A new caller anywhere else fails the suite.
```

- [ ] **Step 10: Write the store-level tests**

Append to `src/store/loadLoop.test.ts` (check the file's existing setup helpers and reuse them — it already builds loops and drives `loadLoop`; if it has no store-reset `beforeEach`, copy the `useAppStore.setState({ loops: [...], activeLoopId: ... })` idiom used by `songMode.test.ts`). Note that these tests set `activeTab`, because the layer is now part of the decision:

```ts
describe('loadLoop leaves a scope that matches what is sounding', () => {
  const twoLoops = () => [
    createDefaultLoop(),
    { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' },
  ];

  test('switching the working loop on the LOOP layer keeps playing, under the new loop', () => {
    useAppStore.setState({
      loops: twoLoops(),
      activeLoopId: 'loop-default-1',
      activeTab: 'sound',
      songLoopIndex: null,
    });
    useAppStore.getState().soloLoop('loop-default-1');

    loadLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-b' });
  });

  test('picking a different loop on the SONG layer stops the audition (spec §6 row 3)', () => {
    useAppStore.setState({
      loops: twoLoops(),
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
      songLoopIndex: null,
    });
    useAppStore.getState().soloLoop('loop-default-1');
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');

    loadLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.playbackScope).toBe(SCOPE_NONE);
    expect(s.activeLoopId).toBe('loop-b');
  });

  test('reloading the loop that is auditioning keeps it playing (spec §6 row 2)', () => {
    useAppStore.setState({
      loops: twoLoops(),
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
      songLoopIndex: null,
    });
    useAppStore.getState().soloLoop('loop-default-1');

    loadLoop('loop-default-1');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-default-1' });
  });

  test('a song-scoped load keeps the arrangement in charge', () => {
    useAppStore.setState({
      loops: twoLoops(),
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
      songLoopIndex: 0,
    });
    useAppStore.getState().playAll();

    loadLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'song' });
    expect(s.songLoopIndex).toBe(1);
  });

  test('a load with nothing playing leaves the stopped scope alone', () => {
    useAppStore.setState({
      loops: twoLoops(),
      activeLoopId: 'loop-default-1',
      activeTab: 'sound',
      songLoopIndex: null,
    });
    useAppStore.getState().hardStopAll();

    loadLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.playbackScope).toBe(SCOPE_NONE);
  });
});
```

Import `createDefaultLoop` from `./loopSlice`, `useAppStore` from `./store`, `SCOPE_NONE` from `./playbackScope`, and `loadLoop` from `./loadLoop` if the file does not already have them. **Check what tab ids Phase 2 left behind** (`sound` / `pattern` / `arrange` / `master`) in `src/types.ts` before writing `activeTab` literals.

Append to `src/store/vibes.test.ts` (again, reuse the file's existing setup — it already applies vibes against the real store):

```ts
describe('applyVibeToStore leaves a scope that matches what is sounding', () => {
  test('a vibe clicked mid-playback keeps the loop scope it started under', () => {
    useAppStore.setState({
      loops: [createDefaultLoop()],
      activeLoopId: 'loop-default-1',
      activeTab: 'sound',
    });
    useAppStore.getState().soloLoop('loop-default-1');

    applyVibeToStore(resolveVibe(VIBES[0]));

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-default-1' });
  });

  test('a vibe clicked on the song layer during an audition also keeps playing', () => {
    useAppStore.setState({
      loops: [createDefaultLoop()],
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
    });
    useAppStore.getState().soloLoop('loop-default-1');

    applyVibeToStore(resolveVibe(VIBES[0]));

    const s = useAppStore.getState();
    // A vibe never moves activeLoopId, so it is always the "same loop" row —
    // the song-layer stop rule cannot be triggered by clicking a vibe.
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-default-1' });
  });

  test('a vibe clicked with the transport stopped starts nothing and claims no scope', () => {
    useAppStore.setState({
      loops: [createDefaultLoop()],
      activeLoopId: 'loop-default-1',
      activeTab: 'sound',
    });
    useAppStore.getState().hardStopAll();

    applyVibeToStore(resolveVibe(VIBES[0]));

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.playbackScope).toBe(SCOPE_NONE);
  });
});
```

`resolveVibe`/`VIBES` are the names `vibes.ts` and `data/vibes.ts` export — **check the existing test file's imports and match whatever fixture idiom it already uses** (it may build a `ResolvedVibe` directly instead of resolving one) rather than adding a second style.

- [ ] **Step 11: Run everything**

Run: `bun test src/store`
Expected: PASS. If `songMode.test.ts` now fails, read the failure carefully before changing it: a `loadLoop` inside a song-mode advance goes through the `atBoundary` path, which this task did not touch, so a failure there means the non-boundary branch is being reached somewhere it should not be.

- [ ] **Step 12: Verify and commit**

```bash
bun run verify
git add src/store
git commit -m "fix(scope): loadLoop and vibes restart with the scope that matches what sounds"
```

---

### Task 3: `addLoop` and `duplicateLoop` must move the scope with the cursor

Both actions move `activeLoopId` without touching the scope or the players. Today that is unreachable on the Loop layer *only* because crossing a layer boundary hard-stops everything — the Arrange `+` button lives on the Song layer, so by the time you are back on the Loop layer nothing is playing. Task 5 removes that stop. From then on, adding a loop while a loop is playing leaves a `loop{some other loop}` scope while the Loop layer edits a different loop, and in that state **the master Play renders enabled and does nothing**: `transportDisplayState` reports `'stopped'` for a loop scope that is not the active loop, so the button offers Play; pressing it calls `soloLoop(activeLoopId)`, whose reducer row for a `loop` scope with a different id returns the scope *unchanged*, and `soloLoop` early-returns on an unchanged reference. A dead Play button with audio running is the worst failure this phase can ship.

**Fix it at the source — inside the two actions that move the cursor — not inside `focus-loop`.** Two reasons. First, `focus-loop`'s rule is *stop what is not in focus*, so routing these through it would answer "the user added a loop" with a hard stop, when the honest answer is that nothing about the sound changed: `addLoop` copies the active loop and `duplicateLoop`'s auto-activated clone is a copy of the loop that was already active, so the flat slices (and therefore the audio) are bit-identical — which is precisely why neither action calls `loadLoop`. Second, `focus-loop` is dispatched from `songMode`, which only acts on the Loop layer; both of these actions are reachable from the Song layer, where re-pointing must *not* happen because the song scope belongs to the arrangement, not to one loop.

**Why this does not contradict Task 2's song-layer stop.** Task 2 stops the audition when you pick a *different, existing* loop on Arrange, because what is sounding is then not the loop in focus. `addLoop`/`duplicateLoop` change nothing audible at all — the new loop's content is a byte-for-byte copy of what is already playing — so the invariant is satisfied by continuing, and stopping would be a stop with no cause. The distinction is "did the sound stop matching the focus", not "did the cursor move".

**Files:**
- Modify: `src/store/playbackScope.ts` — add `rescopeToLoop` next to `restartAfterStop`
- Modify: `src/store/loopSlice.ts` — `addLoop` (81-92) and `duplicateLoop` (97-114)
- Test: `src/store/playbackScope.test.ts`, `src/store/loopSlice.test.ts`

**Interfaces:**
- Consumes: `PlaybackScope`, `SCOPE_NONE` from Task 1; `restartAfterStop` from Task 2 sits next to the new function and is *not* reused here (see the doc comment for why).
- Produces: `rescopeToLoop(scope: PlaybackScope, loopId: string): PlaybackScope`.

- [ ] **Step 1: Write the failing test for `rescopeToLoop`**

Append to `src/store/playbackScope.test.ts`:

```ts
describe('rescopeToLoop — the scope follows a cursor move that changes no sound', () => {
  test('a loop scope re-points at the new cursor', () => {
    expect(rescopeToLoop(LOOP_A, 'B')).toEqual({ kind: 'loop', loopId: 'B' });
  });

  test('the same id returns the identical object (songMode compares by ===)', () => {
    expect(rescopeToLoop(LOOP_A, 'A')).toBe(LOOP_A);
  });

  test('a song scope is untouched: the arrangement is not one loop', () => {
    expect(rescopeToLoop(SCOPE_SONG, 'B')).toBe(SCOPE_SONG);
  });

  test('a stopped transport stays stopped — this never claims a scope', () => {
    expect(rescopeToLoop(SCOPE_NONE, 'B')).toBe(SCOPE_NONE);
  });
});
```

Add `rescopeToLoop` to the import from `./playbackScope`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/playbackScope.test.ts`
Expected: FAIL — `rescopeToLoop` is not exported from `./playbackScope`.

- [ ] **Step 3: Write `rescopeToLoop`**

Append to `src/store/playbackScope.ts`, immediately after `restartAfterStop`:

```ts
/**
 * Move the scope with the EDIT CURSOR for a cursor move that changes no
 * sound. addLoop and duplicateLoop are the two: each makes the new loop a
 * copy of the loop that was already active, so the flat slices — and
 * therefore what is audible — are unchanged, which is exactly why neither
 * calls loadLoop. Leaving the scope on the old id would point it at a loop
 * that is no longer in focus, and the master Play would then render enabled
 * and do nothing (soloLoop early-returns on an unchanged scope reference).
 *
 * Distinct from restartAfterStop above, which answers a different question.
 * That one runs after an internal hard stop and has to decide whether
 * anything comes back at all — including the song-layer case where picking a
 * DIFFERENT loop stops the audition. Nothing stops here, because nothing
 * about the sound changed: a copy of what is already playing is still what
 * is already playing. `none` stays `none` (claiming a scope with nothing
 * playing breaks "none means stopped" as surely as playing under `none`
 * does), and `song` stays `song` (an arrangement is not one loop, and adding
 * a loop to it must not convert it into one).
 */
export function rescopeToLoop(scope: PlaybackScope, loopId: string): PlaybackScope {
  if (scope.kind !== 'loop' || scope.loopId === loopId) return scope;
  return { kind: 'loop', loopId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/playbackScope.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store test**

Append to `src/store/loopSlice.test.ts` (match the file's existing store setup; if it tests the slice through a harness rather than `useAppStore`, use `useAppStore` here anyway — these assertions are about the whole-store interaction between two slices):

```ts
describe('a cursor move carries the scope with it', () => {
  test('addLoop mid-playback re-points the scope at the new loop', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.getState().soloLoop('loop-default-1');

    const newId = useAppStore.getState().addLoop();

    const s = useAppStore.getState();
    expect(s.activeLoopId).toBe(newId);
    // The clone is content-identical, so the audio is unchanged and must not
    // stop; only the scope's id moves.
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: newId });
  });

  test('duplicateLoop of the ACTIVE loop re-points the scope at the clone', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.getState().soloLoop('loop-default-1');

    useAppStore.getState().duplicateLoop('loop-default-1');

    const s = useAppStore.getState();
    // duplicateLoop returns null when it auto-activates the clone, so read
    // the new active id from the store rather than from the return value.
    expect(s.activeLoopId).not.toBe('loop-default-1');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: s.activeLoopId });
  });

  test('duplicating a NON-active loop moves neither the cursor nor the scope', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.getState().soloLoop('loop-default-1');

    useAppStore.getState().duplicateLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.activeLoopId).toBe('loop-default-1');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-default-1' });
  });

  test('adding a loop while the song plays leaves the arrangement in charge', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.getState().playAll();

    useAppStore.getState().addLoop();

    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test src/store/loopSlice.test.ts`
Expected: FAIL — the scope still reads `{ kind: 'loop', loopId: 'loop-default-1' }` after `addLoop`.

- [ ] **Step 7: Carry the scope in both actions**

In `src/store/loopSlice.ts`, add `import { rescopeToLoop } from './playbackScope';` to the imports, then change the `set` in `addLoop` (line 90) to:

```ts
      // The scope moves with the cursor: the new loop is a copy of the active
      // one, so the audio is unchanged and must keep playing — but under an id
      // that names the loop now in focus. Left behind, the scope would point
      // at the old loop and the master Play would render enabled and do
      // nothing (soloLoop early-returns on an unchanged scope reference).
      // rescopeToLoop leaves `song` and `none` alone.
      set({
        loops: [...state.loops, loop],
        activeLoopId: loop.id,
        playbackScope: rescopeToLoop(state.playbackScope, loop.id),
      });
```

And the `set` in `duplicateLoop` (line 112) to:

```ts
      // Same rule as addLoop: only the auto-activated branch moves the cursor,
      // so only it moves the scope.
      set(
        cloneActive
          ? {
              loops,
              activeLoopId: clone.id,
              playbackScope: rescopeToLoop(state.playbackScope, clone.id),
            }
          : { loops },
      );
```

Note the comment on lines 81-83 above `addLoop` ("only the cursor moves") is now half true — extend it to `// is identical to what the flat slices already hold, so no loadLoop call is needed — the cursor and the scope move, nothing else.`

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test src/store`
Expected: PASS.

- [ ] **Step 9: Verify and commit**

```bash
bun run verify
git add src/store
git commit -m "fix(loops): addLoop and duplicateLoop carry the scope with the cursor"
```

---

### Task 4: the `focus-loop` action

With the scope now telling the truth, the navigation decision can be a pure function of it. `layer-change` is deleted: it said "any boundary crossing clears the scope", which is the unconditional stop this phase exists to remove. `focus-loop` says something narrower — *the Loop layer now shows this loop* — and answers with the only three outcomes the invariant allows.

Reference stability on the no-op rows is a contract, not a nicety: `songMode`'s `subscribeWithSelector` equality compares scopes with `===`, so a reducer that returned a fresh-but-equal object on every no-op would re-run `reconcile` on every stop and, after Task 5, re-run the boundary logic with it.

**Scope of this task's tests.** The reducer rows and their reference stability are asserted here, against the pure function. §6's four-case table talks about *what sounds*, and player state only exists once the store executes the decision — those four cases are asserted on player state in Task 5, through `startSongModeSync` and the real store. Do not weaken them into scope-only assertions here; the spec's Test obligations name player state explicitly.

**Which mechanism delivers which row**, so the reviewer can see the table is covered and not double-counted: rows 1 and 2 are `focus-loop` returning the scope unchanged (Task 5); row 4 is `focus-loop` landing on `SCOPE_NONE` with players playing, which `reconcile` turns into a hard stop (Task 5); row 3 is delivered one click earlier, by Task 2's `restartAfterStop` declining to restart when a different loop is picked on the Song layer. `focus-loop`'s mismatch row still has to exist and be tested: it is what catches any residual disagreement between the scope and the cursor, and it is the row that would fire if a future writer of `activeLoopId` forgets to carry the scope.

**Files:**
- Modify: `src/store/playbackScope.ts` — the action union (lines 53-61) and the reducer (86-111)
- Test: `src/store/playbackScope.test.ts` — the `TABLE` fixture (14-41) and the no-op block (59-64)

**Interfaces:**
- Consumes: `PlaybackScope`, `SCOPE_NONE`, `SCOPE_SONG` from Task 1.
- Produces: `PlaybackScopeAction` gains `{ type: 'focus-loop'; loopId: string }` and loses `{ type: 'layer-change' }`. `playbackScopeReducer` stays a total function over the new set. Task 5 dispatches `focus-loop` and nothing else new.

- [ ] **Step 1: Write the failing test**

In `src/store/playbackScope.test.ts`, delete the `LAYER` fixture (line 18) and its three `TABLE` rows (lines 28, 34, 40), and add:

```ts
const FOCUS_A: PlaybackScopeAction = { type: 'focus-loop', loopId: 'A' };
const FOCUS_B: PlaybackScopeAction = { type: 'focus-loop', loopId: 'B' };
```

Add these rows to `TABLE`, one per starting scope:

```ts
  [SCOPE_NONE, FOCUS_A, { kind: 'none' }],
  [SCOPE_NONE, FOCUS_B, { kind: 'none' }],

  [SCOPE_SONG, FOCUS_A, { kind: 'none' }],
  [SCOPE_SONG, FOCUS_B, { kind: 'none' }],

  [LOOP_A, FOCUS_A, { kind: 'loop', loopId: 'A' }],
  [LOOP_A, FOCUS_B, { kind: 'none' }],
```

Extend the `act` label expression at line 46 so a `focus-loop` action prints its id rather than collapsing every row to the same test name:

```ts
    const act =
      action.type === 'toggle-loop'
        ? `toggle-loop(${action.loopId})`
        : action.type === 'focus-loop'
        ? `focus-loop(${action.loopId})`
        : action.type;
```

Replace the `LAYER` line inside the no-op block (line 61) with the two `focus-loop` no-ops, and add a row-by-row explanation test:

```ts
  test('no-op transitions return the identical object (songMode compares by ===)', () => {
    expect(playbackScopeReducer(SCOPE_NONE, STOP_ALL)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(SCOPE_NONE, FOCUS_A)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(LOOP_A, FOCUS_A)).toBe(LOOP_A);
    expect(playbackScopeReducer(SCOPE_SONG, PLAY_ALL)).toBe(SCOPE_SONG);
    expect(playbackScopeReducer(LOOP_A, TOGGLE_B)).toBe(LOOP_A);
  });

  // §6's rule, restated as the reducer sees it. The player-state half of
  // each row is asserted in songMode.test.ts, where a stop actually happens.
  test('focus-loop keeps exactly what the focused loop is sounding', () => {
    // Nothing sounding: nothing to reconcile.
    expect(playbackScopeReducer(SCOPE_NONE, FOCUS_B)).toBe(SCOPE_NONE);
    // The loop in focus is the one sounding: it survives, same reference.
    expect(playbackScopeReducer(LOOP_A, FOCUS_A)).toBe(LOOP_A);
    // A different loop is sounding: it is not what the user is now looking at.
    expect(playbackScopeReducer(LOOP_A, FOCUS_B)).toBe(SCOPE_NONE);
    // The arrangement is sounding: an arrangement is never "the loop in focus".
    expect(playbackScopeReducer(SCOPE_SONG, FOCUS_A)).toBe(SCOPE_NONE);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/playbackScope.test.ts`
Expected: FAIL — TypeScript reports that `'focus-loop'` is not assignable to `PlaybackScopeAction`, and (once that is fixed) the switch is not exhaustive.

- [ ] **Step 3: Replace the action and the reducer case**

In `src/store/playbackScope.ts`, replace the `layer-change` member of the action union (lines 60-61) with:

```ts
  /**
   * The Loop layer now shows `loopId` — dispatched when the layer becomes
   * `loop`, and when activeLoopId changes while the layer is already `loop`.
   * It REPLACES 'layer-change', which cleared the scope on any boundary
   * crossing in either direction; entering the Song layer now stops nothing.
   */
  | { type: 'focus-loop'; loopId: string };
```

In the reducer, split the shared `stop-all` / `layer-change` case (lines 96-98) so `stop-all` stands alone, and add the new case:

```ts
    case 'stop-all':
      return scope.kind === 'none' ? scope : SCOPE_NONE;
    case 'focus-loop':
      // "Playback survives a navigation if and only if what sounds
      // afterwards is exactly the loop now in focus."
      //
      // Nothing sounding -> nothing to reconcile, and returning `scope`
      // rather than SCOPE_NONE keeps the reference songMode compares with ===.
      if (scope.kind === 'none') return scope;
      // The loop in focus IS what is sounding: it plays on, across the
      // boundary. This is the carry-over the phase exists to build.
      if (scope.kind === 'loop' && scope.loopId === action.loopId) return scope;
      // Anything else sounding — the arrangement, or a different loop — is
      // not what the user is now editing. SCOPE_NONE means stopped, and
      // songMode turns that into the actual hard stop.
      return SCOPE_NONE;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/playbackScope.test.ts`
Expected: PASS. The suite as a whole will still fail at this point if anything references `'layer-change'` — nothing does (checked: `songMode.ts` never dispatches the reducer directly, it calls `s.hardStopAll()`), but run `bun run lint` to be sure.

- [ ] **Step 5: Verify and commit**

```bash
bun run verify
git add src/store/playbackScope.ts src/store/playbackScope.test.ts
git commit -m "feat(scope): replace layer-change with focus-loop"
```

---

### Task 5: `songMode.reconcile()` executes the decision instead of always stopping

This is the phase's user-visible change. `reconcile()` currently hard-stops every player whenever the layer changes, in either direction — which is why auditioning a loop on Arrange and then opening it to edit means pressing play again, always. It now dispatches `focus-loop` when the Loop layer's focus changes, and hard-stops only when that transition lands on `none` with players playing.

**The existing comment must be replaced, not deleted.** §6's "What this reverses, knowingly" is explicit about why: the layer-change clear came from the fix recorded in `docs/superpowers/plans/2026-09-01-playback-scope-redesign.md`, where it was one of only two ways a stuck `auditionLoopId` could ever be cleared — a cleanup mechanism from before the scope union existed, not a UX decision. The reducer now makes a stuck scope unreachable by construction. Delete the comment and the next reader finds an unguarded carry-over and restores the stop as a fix.

**Two things fall out for free and must not be re-implemented.** `loopPlayButton(scope, id)` already derives the Arrange cards' disabled state from the scope alone, so a Loop→Song carry-over renders the carried loop's card as Stop with every other card disabled with no new code. And the existing `layer !== 'song' || scope.kind === 'loop'` branch (lines 134-142) already nulls `songLoopIndex` and drops the advance subscription — which is exactly right both for a solo loop carried into the Song layer and for the Loop layer after a stop, so the boundary block loses its own `setSongLoopIndex(null)` and `stopClock()` calls rather than keeping them.

**Files:**
- Modify: `src/store/songMode.ts` — the `startSongModeSync` doc comment (64-74), the boundary block inside `reconcile` (90-98), and the store subscription's selector and equality (146-163)
- Test: `src/store/songMode.test.ts` — the existing test at 281-298 changes meaning; the four rows of §6's table join it

**Interfaces:**
- Consumes: `playbackScopeReducer` and the `focus-loop` action from Task 4; `scopedLoopId` from Task 1.
- Produces: no new exports. `startSongModeSync(deps?: SongModeDeps): () => void` is unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/store/songMode.test.ts`, replace the test at lines 281-298 (`boundary loop→song while playing hard-stops the players and re-enters from the active loop`) with the four rows of §6's table. That rewrite is the point of the task: the old test asserted the behaviour being reversed.

```ts
  // §6's table, one test per row, asserted on PLAYER STATE — the spec's test
  // obligations require that rather than assertions on the scope alone.
  test('row 1 — loop layer playing loop L, cross to the song layer: continues', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'sound', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    // The Loop layer's master Play is soloLoop(activeLoopId) — see Phase 1.
    useAppStore.getState().soloLoop('loop-default-1');
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');

    useAppStore.getState().setActiveTab('arrange');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.chordsPlayer).toBe('playing');
    expect(s.leadPlayer).toBe('playing');
    // Carried as the solo loop of L: no song cursor, no advance subscription.
    expect(scopedLoopId(s.playbackScope)).toBe('loop-default-1');
    expect(s.songLoopIndex).toBe(null);
    expect(clock.count).toBe(0);
    stop();
  });

  test('row 2 — song layer solo-looping L, open L to edit: continues', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().soloLoop('loop-default-1');
    // Opening the loop that is already auditioning: the card select reloads
    // the same id, which restartAfterStop keeps playing (Task 2).
    loadLoop('loop-default-1');

    useAppStore.getState().setActiveTab('sound');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(scopedLoopId(s.playbackScope)).toBe('loop-default-1');
    stop();
  });

  test('row 3 — song layer solo-looping L, open a DIFFERENT loop to edit: stops', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().soloLoop('loop-default-1');

    // The clickable path: pick loop B on Arrange, then walk into the editor.
    // The audition stops at the pick (Task 2's song-layer rule) and the
    // crossing then has nothing left to stop.
    loadLoop('loop-b');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');

    useAppStore.getState().setActiveTab('sound');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.playbackScope).toEqual({ kind: 'none' });
    expect(s.activeLoopId).toBe('loop-b');
    stop();
  });

  test('row 4 — song layer playing the song, open any loop to edit: stops', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    expect(clock.count).toBe(1);

    useAppStore.getState().setActiveTab('sound');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.songLoopIndex).toBe(null);
    expect(s.playbackScope).toEqual({ kind: 'none' });
    expect(clock.count).toBe(0);
    stop();
  });

  // The safety net, and the only place focus-loop's mismatch row is exercised
  // directly. Every UI path that moves activeLoopId now carries the scope with
  // it (loadLoop, addLoop, duplicateLoop, deleteLoop), so this state is
  // constructed rather than clicked: it pins what happens if a future writer
  // forgets.
  test('a scope that disagrees with the cursor is stopped on arrival at the loop layer', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().soloLoop('loop-default-1');

    useAppStore.setState({ activeLoopId: 'loop-b' });
    useAppStore.getState().setActiveTab('sound');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.playbackScope).toEqual({ kind: 'none' });
    stop();
  });

  test('switching the edited loop ON THE LOOP LAYER keeps playing, under the new loop', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.setState({ activeTab: 'sound', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().soloLoop('loop-default-1');

    // The header's loop selector on the loop layer: loadLoop re-points the
    // scope (Task 2), so reconcile's focus-loop dispatch is a no-op and
    // nothing stops.
    loadLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(scopedLoopId(s.playbackScope)).toBe('loop-b');
    stop();
  });
```

Change the import at line 7 to `import { scopedLoopId } from './playbackScope';` if Task 1 has not already; `loadLoop` is already imported at line 4.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/songMode.test.ts`
Expected: FAIL on rows 1 and 2 and on the loop-layer switch — every player reads `'stopped'` because the boundary block still hard-stops unconditionally. Rows 3 and 4 and the safety-net case pass already; that is expected and correct, they are the rows whose outcome does not change.

- [ ] **Step 3: Rewrite the boundary block**

In `src/store/songMode.ts`, add a second remembered cursor next to `prevLayer` (line 77):

```ts
  let prevLayer: Layer | null = null;
  let prevLoopId: string | null = null;
```

Replace lines 88-99 (from `const s = useAppStore.getState();` through `prevLayer = layer;`) with:

```ts
    const s = useAppStore.getState();
    const layer = layerForTab(s.activeTab);
    // The Loop layer's focus changed: either we just arrived on it, or the
    // active loop moved while we were already there. Entering the SONG layer
    // is deliberately not a focus change — see the invariant below.
    const focusChanged =
      layer === 'loop' && (prevLayer !== layer || prevLoopId !== s.activeLoopId);

    // Update both cursors BEFORE any side effect. hardStopAll below notifies
    // subscribers synchronously and re-enters this function; a re-entrant
    // pass that still saw the old cursors would run the same transition a
    // second time.
    prevLayer = layer;
    prevLoopId = s.activeLoopId;

    if (focusChanged) {
      // INVARIANT: playback survives a navigation if and only if what sounds
      // afterwards is exactly the loop now in focus. The scope answers that
      // on its own, so the DECISION is the reducer's (focus-loop) and the
      // code here is only its execution.
      //
      // This REVERSES the rule that used to live here — "crossing a layer
      // boundary can never preserve a solo". That was never a UX decision:
      // per docs/superpowers/plans/2026-09-01-playback-scope-redesign.md the
      // layer-change clear was one of only two ways a stuck auditionLoopId
      // could ever be cleared, a cleanup mechanism from before this union
      // existed. The reducer now makes a stuck scope unreachable by
      // construction and every writer of activeLoopId carries the scope with
      // it (loadLoop, addLoop, duplicateLoop, deleteLoop), so the old
      // unconditional stop was redundant safety, not the safety itself.
      // Do not restore it as a fix: it deletes the Loop->Song carry-over
      // this whole phase exists to build.
      const next = playbackScopeReducer(s.playbackScope, {
        type: 'focus-loop',
        loopId: s.activeLoopId,
      });
      if (next !== s.playbackScope) {
        // SCOPE_NONE is the only non-identity result: what was sounding is
        // not the loop now in focus.
        const wasPlaying =
          aggregatePlayerState(s.sequencerPlayer, s.chordsPlayer, s.leadPlayer) === 'playing';
        if (wasPlaying) {
          // hardStopAll stops the players AND dispatches 'stop-all' — the
          // same SCOPE_NONE — in one set(), so the two are never observed
          // disagreeing.
          s.hardStopAll();
        } else {
          useAppStore.setState({ playbackScope: next });
        }
        // songLoopIndex and the advance subscription are NOT dropped here:
        // the `layer !== 'song'` branch at the bottom of this function
        // already does both, and this path always has layer === 'loop'.
      }
    }
```

Add `playbackScopeReducer` to the imports: `import { playbackScopeReducer } from './playbackScope';`.

- [ ] **Step 4: Add `activeLoopId` to the subscription**

Replace the selector and equality at lines 146-163 with:

```ts
  const unsubStore = useAppStore.subscribe(
    (state) => ({
      tab: state.activeTab,
      // Watched because a cursor move on the Loop layer is a focus change:
      // reconcile must dispatch focus-loop for it, not only for a tab change.
      loop: state.activeLoopId,
      seq: state.sequencerPlayer,
      chords: state.chordsPlayer,
      lead: state.leadPlayer,
      scope: state.playbackScope,
    }),
    reconcile,
    {
      equalityFn: (a, b) =>
        a.tab === b.tab &&
        a.loop === b.loop &&
        a.seq === b.seq &&
        a.chords === b.chords &&
        a.lead === b.lead &&
        a.scope === b.scope,
    }
  );
```

- [ ] **Step 5: Replace the function's doc comment**

Replace lines 64-74 of `src/store/songMode.ts` (the `startSongModeSync` doc comment) with:

```ts
/**
 * Store-level song-mode coordinator (not a component — mirrors engineSync's
 * shape). Play mode is keyed on the LAYER, not the tab: the song layer is
 * {arrange, master} (see `isSongLayer` in ../types), everything else is loop
 * mode.
 *
 * Crossing the boundary is NO LONGER an unconditional hard stop. Playback
 * survives a navigation if and only if what sounds afterwards is exactly the
 * loop now in focus — so entering the SONG layer never stops anything (a
 * solo loop is simply carried in and rendered as that card's Stop), and
 * arriving at the LOOP layer stops only when the focus-loop transition lands
 * on SCOPE_NONE with players playing. See the comment inside reconcile for
 * what that reverses and why the old stop must not be restored.
 *
 * Entering the song layer never auto-starts a song: song mode is entered only
 * when a player is already `playing`, and the cursor is established from the
 * active loop's index (`enterSongIndex`) rather than restarting from the top.
 */
```

**Check the tab ids before writing this comment** — Phase 2 renamed the views (`sound | pattern | arrange | master`), so confirm what `isSongLayer` actually names in `src/types.ts` rather than copying the pair above verbatim.

- [ ] **Step 6: Run the tests**

Run: `bun test src/store/songMode.test.ts`
Expected: PASS, including the pre-existing tests at lines 238-256 (`leaving the song layer hard-stops…`, which is row 4 by another name) and 300-318. If `re-entering song mode re-enters at the active loop` (258-279) fails, read it before touching it: it plays the song with `playAll()` and then crosses to the Loop layer, which is still a stop, so it should be unaffected.

- [ ] **Step 7: Run the whole suite**

Run: `bun test`
Expected: PASS. `ArrangeView` and `SortableLoopCard` tests are unaffected — `loopPlayButton` already derives the card states from the scope, which is the "free" behaviour §6 names.

- [ ] **Step 8: Verify and commit**

```bash
bun run verify
git add src/store/songMode.ts src/store/songMode.test.ts
git commit -m "feat(playback): carry playback across the loop/song boundary when the focus matches"
```

---

### Task 6: `deleteLoop` must not leave the scope pointing at a deleted id

A scope naming a loop that no longer exists is the one state the reducer cannot heal: `focus-loop` would compare the focused id against a ghost and stop, `loopPlayButton` would disable every card in favour of a card that is not rendered, and the master Play would offer Play while audio ran. Before Task 5 this was masked — deleting happens on Arrange, and leaving Arrange hard-stopped everything. Now nothing masks it.

**Deleting the loop that is playing stops playback.** That is the invariant applied literally: after the delete, the loop that was sounding is not in focus, because it is not anywhere. The stop is folded into `deleteLoop`'s own `set()` rather than left to `reconcile`, so no subscriber ever sees a scope naming a loop absent from `loops`.

**A song scope is untouched by a delete.** The arrangement is still an arrangement, one slot shorter, and `deleteLoop` already re-derives `songLoopIndex` for exactly that reason.

**Files:**
- Modify: `src/store/transportSlice.ts` — add `stopAllPlayersPatch` next to `restartPlayersPatch` (Task 2 added that one)
- Modify: `src/store/loopSlice.ts` — `deleteLoop` (118-140)
- Test: `src/store/loopSlice.test.ts`

**Interfaces:**
- Consumes: `scopedLoopId`, `SCOPE_NONE` from Task 1; `allPlayersPatch`'s file from Task 2.
- Produces: `stopAllPlayersPatch(state: AppStore): Partial<AppStore>` in `src/store/transportSlice.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/loopSlice.test.ts`:

```ts
describe('deleteLoop never leaves the scope naming a loop that is gone', () => {
  test('deleting the loop that is playing stops playback and clears the scope', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      songLoopIndex: null,
    });
    useAppStore.getState().soloLoop('loop-default-1');
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');

    const fallback = useAppStore.getState().deleteLoop('loop-default-1');

    const s = useAppStore.getState();
    expect(fallback).toBe('loop-b');
    expect(s.activeLoopId).toBe('loop-b');
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.playbackScope).toBe(SCOPE_NONE);
    expect(s.loops.some((l) => l.id === 'loop-default-1')).toBe(false);
  });

  test('deleting a loop that is not the scoped one leaves playback alone', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      songLoopIndex: null,
    });
    useAppStore.getState().soloLoop('loop-default-1');

    useAppStore.getState().deleteLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'loop', loopId: 'loop-default-1' });
  });

  test('deleting a loop while the song plays leaves the arrangement running', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      songLoopIndex: 0,
    });
    useAppStore.getState().playAll();

    useAppStore.getState().deleteLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.playbackScope).toEqual({ kind: 'song' });
    expect(s.songLoopIndex).toBe(0);
  });

  test('the last loop cannot be deleted, so no scope change happens', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.getState().soloLoop('loop-default-1');

    expect(useAppStore.getState().deleteLoop('loop-default-1')).toBe(null);
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');
  });
});
```

Import `SCOPE_NONE` from `./playbackScope` if the file does not already have it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/loopSlice.test.ts`
Expected: FAIL on the first case — the players stay `'playing'` and the scope still reads `{ kind: 'loop', loopId: 'loop-default-1' }` for a loop no longer in `loops`.

- [ ] **Step 3: Export the stop patch**

In `src/store/transportSlice.ts`, immediately after `restartPlayersPatch`, add:

```ts
/**
 * Every player stopped, as a pure patch. Exported so a store path that must
 * stop playback inside a set() it is ALREADY making — loopSlice's deleteLoop
 * — can fold it in rather than making a second set(). A second set() would
 * publish an intermediate state where the scope still names a loop that
 * `loops` no longer contains, which is the one scope value nothing
 * downstream can heal.
 */
export function stopAllPlayersPatch(state: AppStore): Partial<AppStore> {
  return allPlayersPatch(state, () => 'stopped');
}
```

- [ ] **Step 4: Fold the stop into `deleteLoop`**

In `src/store/loopSlice.ts`, add the imports:

```ts
import { rescopeToLoop, scopedLoopId, SCOPE_NONE } from './playbackScope';
import { stopAllPlayersPatch } from './transportSlice';
```

(`rescopeToLoop` is already imported from `./playbackScope` by Task 3 — merge, do not add a second import statement from the same module.)

Then, inside `deleteLoop`, after `const loops = state.loops.filter((r) => r.id !== id);` (line 124) and before the `cursor` helper, add:

```ts
      // Deleting the loop that is sounding stops playback: after this the
      // loop that was sounding is not the loop in focus, because it is not
      // anywhere. Folded into the same set() as the removal so no subscriber
      // ever sees a scope naming a loop that `loops` no longer contains — the
      // one scope value focus-loop cannot heal, since it would compare the
      // focused id against a ghost. A `song` scope is deliberately untouched:
      // an arrangement one slot shorter is still an arrangement, which is why
      // the cursor below is re-derived rather than dropped.
      const stopPatch =
        scopedLoopId(state.playbackScope) === id
          ? { playbackScope: SCOPE_NONE, ...stopAllPlayersPatch(state) }
          : {};
```

Add `...stopPatch` to both `set(...)` calls in the function (lines 134 and 138):

```ts
      if (!wasActive) {
        set({ loops, songLoopIndex: cursor(state.activeLoopId), ...stopPatch });
        return null;
      }
      const fallback = fallbackActiveLoopId(state.loops, id) ?? loops[0].id;
      set({ loops, activeLoopId: fallback, songLoopIndex: cursor(fallback), ...stopPatch });
      return fallback;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/store`
Expected: PASS. `ArrangeView`'s `handleDelete` (lines 203-208) calls `deleteLoop` and then `loadLoop(fallback)`; with the players already stopped, `restartAfterStop`'s `wasPlaying` is false and it writes `SCOPE_NONE` — the same frozen singleton already in place, so nothing flickers. No change to `ArrangeView` is needed; confirm that by reading `handleDelete` rather than assuming it.

- [ ] **Step 6: Verify and commit**

```bash
bun run verify
git add src/store
git commit -m "fix(loops): deleting the scoped loop stops playback and clears the scope"
```

---

## Manual check before opening the PR

`bun run verify` does not press buttons, and this phase is the one where that matters: every failure mode below is **audible** — silence where the music should have carried, a hard stop the user did not ask for, or a note left ringing with a transport that shows Play. None of them shows up in the type checker or in a rendered-markup assertion.

Run `bun run dev`, turn the volume up enough to hear a tail, and work through these in order. Where a row says "continues", listen for a *seamless* continuation — the loop keeps its position; it must not restart from the top or drop a bar.

**§6's four rows, as clicks. These are the spec's own table and the app must match it exactly:**

1. **Loop layer playing loop L → Song layer: continues.** On Loop › Pattern press the transport Play. Switch to Song › Arrange. Audio keeps playing without a gap. Loop L's card shows Stop and an `AUDITION` badge; every other card's play button is disabled. The master Play offers Play (the one-click takeover, unchanged from Phase 1).
2. **Song layer solo-looping L → edit L: continues.** From that state, click loop L's own card body (or pick L in the header's loop dropdown — the same loop, not a different one) and switch to Loop › Sound. Audio keeps playing. The master button shows Stop, not Play.
3. **Song layer solo-looping L → edit M: stops.** On Arrange, press loop L's card play, then click loop M's card body. **The audition stops at that click** — that is the designed moment, and it is what the user asked for: an audition does not follow a selection. Cross to Loop › Sound: still silent, M is the loop being edited, and the master Play starts M on one press.
4. **Song layer playing the song → edit any loop: stops.** On Arrange, press the master Play so the arrangement runs and advances at least one loop boundary. Switch to Loop › Pattern. Everything stops, the playhead clears, and the master button offers Play. Nothing is left ringing.

**The three destructive/interrupting cases:**

5. **Delete the playing loop.** On Arrange, press a card's play, then delete that same card while it sounds. Audio stops immediately, the fallback loop becomes active, and the master Play works on the first click afterwards (a dead Play button here means the scope kept the deleted id).
6. **Switch loops mid-playback, on the Loop layer.** On Loop › Sound press Play, then change the loop in the header's dropdown. The new loop plays from its beat 1 — this is the seamless switch and it must NOT stop, which is the difference between this and check 3. Cross to Song › Arrange: the NEW loop's card shows Stop, not the old one's.
7. **Click a vibe mid-playback.** With the transport running on the Loop layer, click any Instant Vibe chip. The new vibe plays, and the transport button still shows Stop. Repeat from Song › Arrange with a card auditioning: the vibe applies and playback continues (a vibe never moves the working loop, so it never triggers check 3's stop). If the master button flips to Play while audio runs, the vibe restart lost the scope.

**Two extras worth a minute, because they are how this phase breaks quietly:**

8. **Add a loop mid-playback.** On Loop › Sound press Play, cross to Arrange, press `+`, cross back to Loop. Audio continues and the master button shows Stop. Press it — playback must actually stop on that one click.
9. **Metronome alone.** With everything stopped, toggle the metronome. Nothing should sound and no playhead should move: the metronome is a click, not a transport (`CLAUDE.md`, "The shared 16th clock runs if and only if a player holds a subscription"). This phase touches who starts and stops players, so it is worth re-confirming the clock still ends with the last player.

# Selective Loop Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every loop two label fields — `name` (the user's, empty until they type one) and `tempName` (the app's, never empty) — so a card can say something about a loop before anybody has named it, and then add a `Copy into…` gesture that takes only the parts of another loop you point at.

**Architecture:** `Loop` gains `tempName: string`; one pure resolver `loopLabel(loop) = name || tempName` is the single site every rendered label goes through, `sanitizeLoops` guarantees `tempName` is non-empty on every loop that reaches the store, and `applyVibeToStore` stamps the active loop's `tempName` with the vibe's display name. On top of that, a pure `src/store/loopCopy.ts` states the twelve copyable groups as data, one loop-slice action `applyLoopCopy` writes `loops[]` and re-enters `loadLoop`, and a dumb `LoopCopyDialog` rendered once from `ArrangeView` drives the selection.

**Tech Stack:** TypeScript, React 19, Zustand (`persist` + `subscribeWithSelector`), raw Web Audio API, Bun test runner, Vite, Tailwind + daisyUI, dnd-kit.

**Spec:** `docs/superpowers/specs/2026-09-09-arrange-loop-copy-design.md`

## Global Constraints

- Four import layers, one direction: `src/data/` imports nothing at runtime → `src/audio/` may import `data/` but never `store/` or `components/` → `src/store/` may import `data/`/`audio/` but never `components/` → `src/components/` are dumb views.
- `src/components/` must not import `audio/engine` (only `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx` are exempt).
- Never call an engine setter from a component; state reaches the engine through `src/store/engineSync.ts`.
- No meter value and no playhead value may enter a zustand slice — a write per tick re-renders every mounted view.
- **No persist `version` bump and no migration step.** A persisted shape change is handled by validating the new key in `sanitizeLoops`/`sanitizePersistedState`, never by a version-gated branch. `PROJECT_FORMAT_VERSION` does not move either.
- `tempName` is loop-slot identity, not loop content: it stays **out of `LOOP_FLAT_KEYS`**, out of `LoopStatePatch`, and out of every copy group.
- Tests are `bun:test` with no DOM and no testing-library. Run one file with `bun test <file>`; rendered-markup tests use `renderToString` and assert substrings. See `.claude/rules/testing.md` — especially the `getServerSnapshot` trap: `useAppStore.setState(...)` before a `renderToString` has no effect.
- `bun run verify` is the completion gate. `bun run eslint` must stay at **zero errors and zero warnings**.
- Branch: `feat/arrange-loop-copy`. Feature work never lands as a commit made directly on `main`.
- Conventional-commit subjects (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, with an optional scope such as `feat(store):`).

## File Structure

| File | Responsibility |
| --- | --- |
| `src/store/types.ts` | *Modify* — `Loop` gains `tempName: string`; `LoopSlice` gains `setLoopTempName`. `LOOP_FLAT_KEYS` and `LoopStatePatch` are untouched. |
| `src/store/loop.ts` | *Modify* — adds `loopLabel`, `nextUntitledName`, `nextDuplicateLabel`; drops `nextLoopName`. |
| `src/store/loop.test.ts` | *Modify* — label resolution, the untitled counter with gaps, the duplicate rule in both fields, collision avoidance. |
| `src/store/loopSlice.ts` | *Modify* — `createDefaultLoop` ships `name: ''` / `tempName: 'untitled-1'`; `addLoop` and `duplicateLoop` get their new label rules; `setLoopTempName` action. |
| `src/store/loopSlice.test.ts` | *Modify* — default-loop labels, `addLoop` inherits no label, `duplicateLoop` increments the displayed field, `setLoopTempName`. Later: `applyLoopCopy`'s two branches. |
| `src/store/sanitize.ts` | *Modify* — `sanitizeLoops` fills a missing/blank `tempName` with `untitled-{index + 1}` and stops inventing a `Loop N` name. |
| `src/store/sanitize.test.ts` | *Modify* — the two fill cases and the `name: ''` case. |
| `src/store/store.ts` | *Modify (Task 9 only)* — composes `createLoopCopySlice` beside `createLoopSlice`. Nothing else: `loops` is already in `partialize` and `PROJECT_CONTENT_KEYS`, and `sanitizePersistedState` already routes through `sanitizeLoops`. |
| `src/store/store.test.ts` | *Modify* — the rehydrate fallback assertion that reads `Loop 1`. |
| `src/store/projectFormat.test.ts` | *Modify* — a `.solna` body with no `tempName` reads back `untitled-1` through `sanitizeContent`. |
| `src/store/loadLoop.ts` | *Modify* — both `setState` sites clear `selectedVibeId` to `null`. |
| `src/store/loadLoop.test.ts` | *Modify* — the clear, on the boundary path and the hard-stop path. |
| `src/store/vibes.ts` | *Modify* — `applyVibeToStore` stamps the active loop's `tempName` with `vibe.name`. |
| `src/store/vibes.test.ts` | *Modify* — the stamp lands on the active loop only, and lands even behind a user `name`. |
| `src/components/song/ArrangeView.tsx` | *Modify* — resolves `loopLabel(loop)` into the card's `label` prop. Later: holds `copyTargetId` and renders `LoopCopyDialog` once. |
| `src/components/song/ArrangeView.test.tsx` | *Modify* — the rendered label; later, the dialog's mount point. |
| `src/components/song/SortableLoopCard.tsx` | *Modify* — renders `label` for display, every `aria-label` and `LoopAuditionButton`; local `tempName` state renamed `draftName`; rename accepts `''` and opens empty with `label` as placeholder. Later: the `Copy into…` button. |
| `src/components/song/SortableLoopCard.test.tsx` | *Modify* — label rendering, the empty-save path, the placeholder-not-value trap. |
| `src/components/loop/LoopSelector.tsx` | *Modify* — the option text goes through `loopLabel`. |
| `src/components/loop/LoopSelector.test.tsx` | *Modify* — the rendered option text. |
| `src/components/TransportBar.tsx` | *Modify* — `songModeLabel`'s badge and `activeLoopName` both go through `loopLabel`. |
| `src/components/TransportBar.test.tsx` | *Modify* — `songModeLabel` for a named and an unnamed loop. |
| `src/store/loopCopy.ts` | *Create (Task 8)* — `LOOP_COPY_GROUPS`, `buildLoopCopyPatch`, `impliesKeyCopy`. The only place the grouping is written. |
| `src/store/loopCopy.test.ts` | *Create (Task 8)* — the coverage invariant against `LOOP_FLAT_KEYS`, patch contents, the deep-clone proof, the chords-implies-key rule. |
| `src/store/loopCopySlice.ts` | *Create (Task 9)* — `applyLoopCopy` and nothing else. Its own module because `loopSlice.ts` cannot import `loadLoop` without closing a boot-order cycle; Task 9 records the crash it produces. |
| `src/store/loopCopySlice.test.ts` | *Create (Task 9)* — the non-active branch touches no flat field; the active branch leaves the flat slices and `loops[]` in agreement; neither branch moves a label. |
| `src/components/song/LoopCopyDialog.tsx` | *Create (Task 10)* — the dumb dialog: source picker, quick chips, the twelve-cell matrix, the two conditional notices. |
| `src/components/song/LoopCopyDialog.test.tsx` | *Create (Task 10)* — Apply disabled while nothing is ticked, a chip ticks one column, the source list excludes the target. |

---

### Task 1: `tempName` on the Loop type, the label resolver, and the untitled counter

**Files:**
- `Modify:` `src/store/types.ts`, `src/store/loop.ts`, `src/store/loopSlice.ts`, `src/store/sanitize.ts`
- `Test:` `src/store/loop.test.ts`, `src/store/loopSlice.test.ts`, `src/store/store.test.ts`, `src/components/song/SortableLoopCard.test.tsx`, `src/components/song/ArrangeView.test.tsx`, `src/components/loop/LoopSelector.test.tsx`, `src/components/TransportBar.test.tsx`

**Interfaces:**
- `Consumes:` nothing from an earlier task. Existing: `createDefaultLoop(): Loop` from `src/store/loopSlice.ts`; `LOOP_FLAT_KEYS`, `cloneLoop`, `loopStatePatch` from `src/store/loop.ts`.
- `Produces:`
  - `interface Loop { id: string; name: string; tempName: string; repeatCount?: number; /* …unchanged per-loop fields… */ }` in `src/store/types.ts`
  - `export function loopLabel(loop: Pick<Loop, 'name' | 'tempName'>): string` in `src/store/loop.ts`
  - `export function nextUntitledName(loops: readonly Loop[]): string` in `src/store/loop.ts`
  - `createDefaultLoop()` now returns `name: ''`, `tempName: 'untitled-1'`
  - `LOOP_FLAT_KEYS` and `LoopStatePatch` are **unchanged** — `tempName` is not content.
  - `nextLoopName` still exists at the end of this task (its two call sites in `loopSlice.ts` survive until Task 5, which deletes it).

#### Cycle A — the field and the default loop's labels

- [ ] **Step 1.** In `src/store/loopSlice.test.ts`, replace the existing `starts with one default loop that is active` test with:

```ts
  test('starts with one default loop whose name is empty and whose tempName is untitled-1', () => {
    const s = makeSlice().state;
    expect(s.loops).toHaveLength(1);
    // The user's field starts EMPTY, so nothing in state can be mistaken for
    // a name the user chose; the app's field is what renders.
    expect(s.loops[0].name).toBe('');
    expect(s.loops[0].tempName).toBe('untitled-1');
    expect(s.activeLoopId).toBe(s.loops[0].id);
  });
```

- [ ] **Step 2.** Run `bun test src/store/loopSlice.test.ts` and watch it fail with `expect(received).toBe(expected)` — `Expected: ""`, `Received: "Loop 1"` on the `name` assertion.

- [ ] **Step 3.** In `src/store/types.ts`, add the field to `Loop`, replacing the current `name` line:

```ts
export interface Loop extends PadState {
  id: string;
  /** The USER's name. '' until they set one, '' again if they clear it; nothing but a rename writes it. */
  name: string;
  /**
   * The APP's label, never empty. Starts at `untitled-{n}` and is overwritten
   * with a vibe's display NAME (a snapshot, not a reference) whenever a vibe
   * is applied to this loop. Deliberately NOT in LOOP_FLAT_KEYS: it is
   * loop-slot identity, not loop content, so it never rides in a
   * LoopStatePatch and no copy group can name it.
   */
  tempName: string;
  repeatCount?: number; // default 1, number of times this loop plays before advancing in song mode
```

- [ ] **Step 4.** In `src/store/loopSlice.ts`, change `createDefaultLoop`'s identity block:

```ts
  return {
    id: DEFAULT_LOOP_ID,
    name: '',
    tempName: 'untitled-1',
    repeatCount: 1,
```

- [ ] **Step 5.** In `src/store/sanitize.ts`, keep the type honest without yet implementing the positional rule (that is Cycle D of Task 2). Add one line to the object literal in `sanitizeLoops`, directly after the `name:` line:

```ts
      tempName:
        typeof r.tempName === 'string' && r.tempName.length > 0 ? r.tempName : fallback.tempName,
```

- [ ] **Step 6.** Run `bun test src/store/loopSlice.test.ts` and confirm it passes.

- [ ] **Step 7.** Commit:

```bash
git add src/store/types.ts src/store/loopSlice.ts src/store/sanitize.ts src/store/loopSlice.test.ts
git commit -m "feat(store): add tempName to Loop and empty the default loop's name

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle B — `loopLabel`

- [ ] **Step 8.** In `src/store/loop.test.ts`, add `tempName: 'untitled-1',` to the `makeLoop` fixture immediately after its `name: 'Loop X',` line, add `loopLabel` to the import list from `./loop`, and append this describe block after the `newLoopId` block:

```ts
describe('loopLabel', () => {
  test('a user name wins over the app label', () => {
    expect(loopLabel({ name: 'Drop', tempName: 'Synthwave 80s' })).toBe('Drop');
  });

  // The case the old single-field model could not represent at all: an empty
  // name is a VALUE (the user cleared it), not a hole, and it falls through.
  test('a blank name falls through to tempName', () => {
    expect(loopLabel({ name: '', tempName: 'Synthwave 80s' })).toBe('Synthwave 80s');
    expect(loopLabel({ name: '', tempName: 'untitled-3' })).toBe('untitled-3');
  });
});
```

- [ ] **Step 9.** Run `bun test src/store/loop.test.ts` and watch it fail with `SyntaxError: Export named 'loopLabel' not found in module '.../src/store/loop.ts'`.

- [ ] **Step 10.** In `src/store/loop.ts`, add the resolver directly above `nextLoopName`:

```ts
/**
 * The label every rendered site shows: the user's name when they set one, the
 * app's otherwise. One `||`, no third tier and no `?? 'Loop'` fallback —
 * sanitizeLoops guarantees `tempName` is a non-empty string on every loop that
 * reaches the store, and a fallback here would be admitting that guarantee is
 * not real. It is one function rather than a `||` per site because several of
 * the card's reads are aria-labels, where a missed site is a screen reader
 * announcing "Delete " and nothing visible in review.
 */
export function loopLabel(loop: Pick<Loop, 'name' | 'tempName'>): string {
  return loop.name || loop.tempName;
}
```

- [ ] **Step 11.** Run `bun test src/store/loop.test.ts` and confirm the two new tests pass.

- [ ] **Step 12.** Commit:

```bash
git add src/store/loop.ts src/store/loop.test.ts
git commit -m "feat(store): add loopLabel, the one resolver every rendered loop label goes through

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle C — `nextUntitledName`

- [ ] **Step 13.** In `src/store/loop.test.ts`, add `nextUntitledName` to the import list from `./loop` and append after the `loopLabel` block:

```ts
describe('nextUntitledName', () => {
  test('is one above the highest untitled number, not a positional index', () => {
    expect(nextUntitledName([])).toBe('untitled-1');
    expect(nextUntitledName([makeLoop({ id: 'a', tempName: 'untitled-1' })])).toBe('untitled-2');
  });

  // The stored-not-positional trade, asserted rather than described: the label
  // never shifts when loops are dragged or deleted, at the cost of gaps. With
  // untitled-2 and untitled-7 present the next is untitled-8, NOT untitled-3.
  test('leaves gaps alone and counts from the highest', () => {
    expect(
      nextUntitledName([
        makeLoop({ id: 'a', tempName: 'untitled-2' }),
        makeLoop({ id: 'b', tempName: 'untitled-7' }),
      ])
    ).toBe('untitled-8');
  });

  test('a vibe-stamped or user-named loop consumes no number', () => {
    expect(
      nextUntitledName([
        makeLoop({ id: 'a', name: 'Drop', tempName: 'Synthwave 80s' }),
        makeLoop({ id: 'b', tempName: 'Lo-Fi Chill' }),
      ])
    ).toBe('untitled-1');
  });
});
```

- [ ] **Step 14.** Run `bun test src/store/loop.test.ts` and watch it fail with `SyntaxError: Export named 'nextUntitledName' not found in module '.../src/store/loop.ts'`.

- [ ] **Step 15.** In `src/store/loop.ts`, add the counter directly below `loopLabel`:

```ts
/**
 * The next `untitled-{n}`: one above the highest existing untitled number,
 * read off `tempName`. The number is assigned ONCE at creation and is then a
 * stored string like any other — never recomputed from a position, so dragging
 * or deleting a loop never renames the cards below it. The cost is gaps
 * (untitled-2 can sit directly above untitled-7), which read correctly as
 * "that one was made later". The lowercase hyphenated form is deliberate:
 * every label a person chooses is title-cased, so the shape is the signal that
 * the slot is empty.
 */
export function nextUntitledName(loops: readonly Loop[]): string {
  let max = 0;
  for (const loop of loops) {
    const m = /^untitled-(\d+)$/.exec(loop.tempName);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `untitled-${max + 1}`;
}
```

- [ ] **Step 16.** Run `bun test src/store/loop.test.ts` and confirm all three new tests pass.

- [ ] **Step 17.** Commit:

```bash
git add src/store/loop.ts src/store/loop.test.ts
git commit -m "feat(store): add nextUntitledName, the stored max-plus-one untitled counter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle D — green the suite where `Loop N` was asserted

The default loop's `name` is now `''`, so six existing assertions across five files
read a string nothing produces any more. Each is fixed to assert the truth
*this* task creates; the label-driven assertions arrive in Task 3.

- [ ] **Step 18.** Run `bun test` and record the failures. Expect exactly these: `src/store/loopSlice.test.ts` (`addLoop` and `duplicateLoop of the active loop`, both asserting `'Loop 2'`), `src/store/store.test.ts:1229` (`Loop 1`), `src/components/song/SortableLoopCard.test.tsx:144` (`Loop 1`), `src/components/song/ArrangeView.test.tsx:58` (`Loop 1`), `src/components/loop/LoopSelector.test.tsx:32` (`Loop 1`), `src/components/TransportBar.test.tsx:133` (`Song · Loop 1`).

- [ ] **Step 19.** In `src/store/loopSlice.test.ts`, replace the two failing `'Loop 2'` name assertions with the intermediate truth. `addLoop`/`duplicateLoop` still call `nextLoopName`, which now finds no `Loop N` name to count in a one-loop project and returns `Loop 1`; Task 5 replaces the rule outright. In `addLoop appends a deep copy of the active loop and auto-activates it`:

```ts
    // Both actions still run the old nextLoopName here; the label rules land
    // with nextUntitledName / nextDuplicateLabel and are asserted there.
    expect(added.name).toBe('Loop 1');
```

  In `duplicateLoop of the active loop inserts a deep clone after it and auto-activates it`:

```ts
    expect(h.state.loops[1].name).toBe('Loop 1');
```

  Leave the `'Loop 2'` assertion in `duplicateLoop of a non-active loop returns the clone id for the caller to load` alone: that test calls `addLoop()` first, so by the time it duplicates there IS a `Loop 1` in the list for `nextLoopName` to count from, and it still passes.

- [ ] **Step 20.** In `src/store/store.test.ts`, in the rehydrate test that seeds `loops: [null, 7, 'x']`, replace the name assertion:

```ts
    expect(s.loops[0].name).toBe('');
    expect(s.loops[0].tempName).toBe('untitled-1');
```

- [ ] **Step 21.** In `src/components/song/SortableLoopCard.test.tsx`, in `renders loop name, key/scale, and chord progression`, give the render a named loop so the test still asserts what it says it asserts. Change the render's `loop={defaultLoop}` to `loop={{ ...defaultLoop, name: 'Chorus' }}` and the assertion:

```ts
    // Name and index
    expect(html).toContain('Chorus');
    expect(html).toContain('#1');
```

- [ ] **Step 22.** In `src/components/song/ArrangeView.test.tsx`, in `renders the default single loop with its bar count and disabled delete`, drop the name assertion (the label assertion lands in Task 3) and keep the rest:

```ts
    const html = renderToString(<ArrangeView />);
    expect(html).toContain('id="btn-arrange-add"');
    expect(html).toContain('4 bars');
    expect(html).toContain('btn-loop-delete-loop-default-1');
    // A single loop cannot be deleted.
    expect(html).toContain('disabled');
```

- [ ] **Step 23.** In `src/components/loop/LoopSelector.test.tsx`, in `renders the default active loop as an option`, drop the name assertion (Task 3 re-adds it as a label assertion):

```ts
    const html = renderToString(<LoopSelector />);
    expect(html).toContain('id="select-loop"');
    expect(html).toContain('value="loop-default-1"');
```

- [ ] **Step 24.** In `src/components/TransportBar.test.tsx`, in the `songModeLabel` describe, give the fixture a name so the badge test keeps its subject:

```ts
describe('songModeLabel', () => {
  test('returns a song-mode badge only while a song position exists', () => {
    const loops: Loop[] = [{ ...createDefaultLoop(), name: 'Verse' }];
    expect(songModeLabel(null, loops)).toBe(null);
    expect(songModeLabel(0, loops)).toBe('Song · Verse');
  });
});
```

- [ ] **Step 25.** Run `bun test` and confirm the whole suite is green, then `bun run lint` and confirm `tsc --noEmit` reports nothing.

- [ ] **Step 26.** Commit:

```bash
git add src/store/loopSlice.test.ts src/store/store.test.ts src/components/song/SortableLoopCard.test.tsx src/components/song/ArrangeView.test.tsx src/components/loop/LoopSelector.test.tsx src/components/TransportBar.test.tsx
git commit -m "test: stop asserting the Loop N string that no longer exists in state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 2: Sanitize fills `tempName` and stops inventing names

**Files:**
- `Modify:` `src/store/sanitize.ts`
- `Test:` `src/store/sanitize.test.ts`, `src/store/projectFormat.test.ts`

**Interfaces:**
- `Consumes:` `Loop` with `tempName: string` (Task 1); `createDefaultLoop(): Loop` returning `name: ''`, `tempName: 'untitled-1'` (Task 1).
- `Produces:` `sanitizeLoops(value: unknown): Loop[] | undefined` (signature unchanged) with two new guarantees, which the display resolver's single `||` rests on:
  - every returned loop has a non-empty `tempName` — a missing or blank one becomes `untitled-{index + 1}`, counted over surviving rows;
  - a missing, blank or non-string `name` becomes `''`, never a `Loop N` string.
  - Reached from BOTH untrusted-input paths: `sanitizePersistedState` in `store.ts` on rehydrate, and `sanitizeContent` in `projectFile.ts` on `.solna` import. Neither `PERSIST_VERSION` nor `PROJECT_FORMAT_VERSION` moves.

#### Cycle A — a positional `tempName` fill

- [ ] **Step 1.** In `src/store/sanitize.test.ts`, add this describe block after the existing `sanitizeLoops keeps a valid soundKit / pattern id / scale untouched` test:

```ts
describe('sanitizeLoops fills the label fields instead of inventing a name', () => {
  // The fill is POSITIONAL and must count over surviving rows, so two loops
  // written before tempName existed can never come back with the same label.
  test('a loop with no tempName reads back as untitled-{index + 1}', () => {
    const bare = { ...createDefaultLoop() } as unknown as Record<string, unknown>;
    delete bare.tempName;
    const loops = sanitizeLoops([{ ...bare, id: 'a' }, { ...bare, id: 'b' }]) ?? [];
    expect(loops.map((l) => l.tempName)).toEqual(['untitled-1', 'untitled-2']);
  });

  test('a blank tempName is filled the same way', () => {
    const loops =
      sanitizeLoops([
        { ...createDefaultLoop(), id: 'a', tempName: '' },
        { ...createDefaultLoop(), id: 'b', tempName: '' },
      ]) ?? [];
    expect(loops.map((l) => l.tempName)).toEqual(['untitled-1', 'untitled-2']);
  });

  test('a stored tempName passes through untouched', () => {
    const [out] =
      sanitizeLoops([{ ...createDefaultLoop(), id: 'a', tempName: 'Synthwave 80s' }]) ?? [];
    expect(out.tempName).toBe('Synthwave 80s');
  });
});
```

- [ ] **Step 2.** Run `bun test src/store/sanitize.test.ts` and watch the first two tests fail with `expect(received).toEqual(expected)` — `Expected: ["untitled-1", "untitled-2"]`, `Received: ["untitled-1", "untitled-1"]`, because the Task-1 placeholder reads `createDefaultLoop()`'s constant.

- [ ] **Step 3.** In `src/store/sanitize.ts`, inside `sanitizeLoops`, split the raw row out of the merged row and use it for `tempName`:

```ts
    const fallback = createDefaultLoop();
    // `tempName` is read off the RAW row, not off `r`: its fallback is
    // POSITIONAL, and createDefaultLoop()'s constant `untitled-1` would
    // otherwise satisfy the guard for every row in the array and hand them all
    // the same label. Every other field's fallback is a constant, so every
    // other field reads `r`.
    const rawLoop = raw as Record<string, unknown>;
    const r = { ...fallback, ...rawLoop } as Record<string, unknown>;
```

  and replace the placeholder `tempName` line added in Task 1 with:

```ts
      tempName:
        typeof rawLoop.tempName === 'string' && rawLoop.tempName.length > 0
          ? rawLoop.tempName
          : `untitled-${loops.length + 1}`,
```

- [ ] **Step 4.** Run `bun test src/store/sanitize.test.ts` and confirm the three tests pass.

- [ ] **Step 5.** Commit:

```bash
git add src/store/sanitize.ts src/store/sanitize.test.ts
git commit -m "fix(store): fill a missing tempName positionally in sanitizeLoops

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle B — a blank `name` stays blank

- [ ] **Step 6.** In `src/store/sanitize.test.ts`, add to the same describe block:

```ts
  // The old fallback replaced a blank name with `Loop N`, which would undo the
  // user clearing the field on the very next reload. A blank name is now a
  // legal value, so it survives; a non-string one becomes '' rather than a
  // number nobody chose.
  test('a missing, blank or non-string name reads back as an empty string', () => {
    const bare = { ...createDefaultLoop() } as unknown as Record<string, unknown>;
    delete bare.name;
    const loops =
      sanitizeLoops([
        { ...bare, id: 'a' },
        { ...createDefaultLoop(), id: 'b', name: '' },
        { ...createDefaultLoop(), id: 'c', name: 42 },
      ]) ?? [];
    expect(loops.map((l) => l.name)).toEqual(['', '', '']);
  });

  test('a real name passes through untouched', () => {
    const [out] = sanitizeLoops([{ ...createDefaultLoop(), id: 'a', name: 'Drop' }]) ?? [];
    expect(out.name).toBe('Drop');
  });
```

- [ ] **Step 7.** Run `bun test src/store/sanitize.test.ts` and watch the first of the two fail with `expect(received).toEqual(expected)` — `Expected: ["", "", ""]`, `Received: ["Loop 1", "Loop 2", "Loop 3"]`.

- [ ] **Step 8.** In `src/store/sanitize.ts`, replace the `name` line in `sanitizeLoops`:

```ts
      name: typeof r.name === 'string' ? r.name : '',
```

- [ ] **Step 9.** Run `bun test src/store/sanitize.test.ts` and confirm both pass.

- [ ] **Step 10.** Commit:

```bash
git add src/store/sanitize.ts src/store/sanitize.test.ts
git commit -m "fix(store): let a blank loop name survive sanitize instead of inventing Loop N

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle C — the same treatment through a `.solna` body

- [ ] **Step 11.** In `src/store/projectFormat.test.ts`, in `legacyV1ProjectFile()`, drop the field the old build never wrote — add one line beside the existing `delete loop.leadGate;`:

```ts
  loop.leadMelodySteps = [['C4', 'E4'], [], ['G4']];
  delete loop.leadGate;
  // No build before this change wrote a tempName; the import path must fill
  // one, with no formatVersion move.
  delete loop.tempName;
```

  and add to the assertions in `parseProjectFile validates by range/shape, not by version, and keeps the rest`:

```ts
    expect(loop.name).toBe('Loop 1');
    // sanitizeContent -> sanitizeLoops fills the app's label for a body that
    // predates the field, so loopLabel's single `||` is safe on an import too.
    expect(loop.tempName).toBe('untitled-1');
```

- [ ] **Step 12.** Run `bun test src/store/projectFormat.test.ts` and confirm it passes (the fill is already implemented; this pins the `.solna` path against a later regression that touches only one of the two callers).

- [ ] **Step 13.** Run `bun test` and confirm the whole suite is green.

- [ ] **Step 14.** Commit:

```bash
git add src/store/projectFormat.test.ts
git commit -m "test: pin the tempName fill on the .solna import path

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 3: Render the resolved label everywhere

**Files:**
- `Modify:` `src/components/song/ArrangeView.tsx`, `src/components/song/SortableLoopCard.tsx`, `src/components/loop/LoopSelector.tsx`, `src/components/TransportBar.tsx`
- `Test:` `src/components/song/SortableLoopCard.test.tsx`, `src/components/song/ArrangeView.test.tsx`, `src/components/loop/LoopSelector.test.tsx`, `src/components/TransportBar.test.tsx`

**Interfaces:**
- `Consumes:` `loopLabel(loop: Pick<Loop, 'name' | 'tempName'>): string` from `src/store/loop.ts` (Task 1).
- `Produces:`
  - `SortableLoopCardProps` gains `label: string` — **required**, resolved by `ArrangeView` through `loopLabel`. The card never reads `loop.name` or `loop.tempName` for display; it reads `loop.name` only to compare against a rename draft.
  - `songModeLabel(songLoopIndex: number | null, loops: readonly Loop[]): string | null` — unchanged signature, now returns `Song · <resolved label>`.
  - `LoopSelector`'s `<option>` text is `loopLabel(loop)`.

#### Cycle A — the card takes a `label` prop

- [ ] **Step 1.** In `src/components/song/SortableLoopCard.test.tsx`, add `label` to `baseProps` (after `totalLoops: 2,`):

```ts
    label: 'untitled-1',
```

  and add `label="untitled-1"` to each of the six inline render sites that pass `loop={defaultLoop}`, `loop={customLoop}`, `loop={loopWithChords}` (put it directly after the `totalLoops={…}` line), except the `renders loop name, key/scale, and chord progression` test, which gets `label="Chorus"`. In `src/components/song/ArrangeView.test.tsx`, add `label="untitled-1"` after `totalLoops={1}` in its one inline `<SortableLoopCard>` render.

- [ ] **Step 2.** In `src/components/song/SortableLoopCard.test.tsx`, add this test at the end of the `SortableLoopCard` describe:

```ts
  test('renders the label prop, not the raw name, for an unnamed loop', () => {
    // The card is handed a resolved label; it must never fall back to
    // loop.name, which is '' on every loop nobody has renamed.
    const html = renderToString(
      <SortableLoopCard {...baseProps} loop={{ ...defaultLoop, name: '', tempName: 'Synthwave 80s' }} label="Synthwave 80s" />
    );
    expect(html).toContain('Synthwave 80s');
    // Every aria-label goes through the same string — a missed one is a screen
    // reader announcing "Delete " and nothing visible in review.
    expect(html).toContain('aria-label="Drag to reorder Synthwave 80s"');
    expect(html).toContain('aria-label="Rename Synthwave 80s"');
    expect(html).toContain('aria-label="Edit Synthwave 80s"');
    expect(html).toContain('aria-label="Move Synthwave 80s up"');
    expect(html).toContain('aria-label="Move Synthwave 80s down"');
    expect(html).toContain('aria-label="Duplicate Synthwave 80s"');
    expect(html).toContain('aria-label="Delete Synthwave 80s"');
    expect(html).toContain('aria-label="Repeat count for Synthwave 80s"');
    expect(html).toContain('aria-label="Play only Synthwave 80s"');
  });
```

- [ ] **Step 3.** Run `bun test src/components/song/SortableLoopCard.test.tsx` and watch the new test fail on `expect(html).toContain('aria-label="Drag to reorder Synthwave 80s"')` — the markup carries `aria-label="Drag to reorder "` because the card still reads `loop.name`.

- [ ] **Step 4.** In `src/components/song/SortableLoopCard.tsx`, add the prop to the interface (after `totalLoops: number;`):

```ts
  /**
   * The resolved display label — `loopLabel(loop)`, computed by ArrangeView.
   * The card never reads `name`/`tempName` for display: every one of the reads
   * below is an aria-label, and a single missed site is a screen reader
   * announcing "Delete " that no snapshot test notices.
   */
  label: string;
```

  add `label,` to the destructured parameter list beside `index`, and replace the display reads. The rename-draft comparisons in `handleSaveName`/`handleKeyDown`/the rename button keep reading `loop.name` — that is the user's field, not a label:

```ts
                aria-label={`Drag to reorder ${label}`}
```
```ts
                loopName={label}
```
```ts
                    <span className="truncate text-sm sm:text-base">{label}</span>
```
```ts
                    aria-label={`Rename ${label}`}
```
```ts
                aria-label={`Edit ${label}`}
```
```ts
                aria-label={`Move ${label} up`}
```
```ts
                aria-label={`Move ${label} down`}
```
```ts
                aria-label={`Duplicate ${label}`}
```
```ts
                aria-label={`Delete ${label}`}
```
```ts
                aria-label={`Repeat count for ${label}`}
```

- [ ] **Step 5.** In `src/components/song/ArrangeView.tsx`, extend the existing `loopBars` import and pass the prop. Change the import line:

```ts
import { loopBars, loopLabel } from '@/store/loop';
```

  and add one line to the `<SortableLoopCard>` props, directly after `totalLoops={loops.length}`:

```ts
                  label={loopLabel(loop)}
```

- [ ] **Step 6.** Run `bun test src/components/song/SortableLoopCard.test.tsx` and confirm it passes.

- [ ] **Step 7.** In `src/components/song/ArrangeView.test.tsx`, restore the label assertion in `renders the default single loop with its bar count and disabled delete`, directly after the `btn-arrange-add` assertion:

```ts
    // The default loop has no user name, so the card reads the app's label.
    expect(html).toContain('untitled-1');
```

- [ ] **Step 8.** Run `bun test src/components/song/ArrangeView.test.tsx` and confirm it passes.

- [ ] **Step 9.** Commit:

```bash
git add src/components/song/SortableLoopCard.tsx src/components/song/ArrangeView.tsx src/components/song/SortableLoopCard.test.tsx src/components/song/ArrangeView.test.tsx
git commit -m "feat(components): render a resolved loop label on the Arrange card

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle B — the card's local draft state stops colliding

- [ ] **Step 10.** In `src/components/song/SortableLoopCard.tsx`, rename the local rename-draft state so two different `tempName`s no longer live in one file — one a draft of `name`, one the stored field. Behaviour is unchanged in this step; only the identifier moves:

```ts
    const [isEditingName, setIsEditingName] = useState(false);
    // The in-progress rename input. NOT the stored `tempName` field: this one
    // is a draft of `name`, local to the card and gone on blur.
    const [draftName, setDraftName] = useState(loop.name);
```

  and rename every use — `handleSaveName`'s `const trimmed = draftName.trim();` and its `setDraftName(loop.name)`, `handleKeyDown`'s `setDraftName(loop.name)`, the input's `value={draftName}` and `onChange={(e) => setDraftName(e.target.value)}`, and the rename button's `setDraftName(loop.name)`.

- [ ] **Step 11.** Run `bun test src/components/song/SortableLoopCard.test.tsx` and confirm it still passes, then `bun run lint` and confirm no `tempName`-shadowing error remains.

- [ ] **Step 12.** Commit:

```bash
git add src/components/song/SortableLoopCard.tsx
git commit -m "refactor(components): rename the card's local rename draft to draftName

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle C — the loop selector

- [ ] **Step 13.** In `src/components/loop/LoopSelector.test.tsx`, restore a label assertion in `renders the default active loop as an option`:

```ts
    const html = renderToString(<LoopSelector />);
    expect(html).toContain('id="select-loop"');
    expect(html).toContain('value="loop-default-1"');
    // An unnamed loop must not render a blank option.
    expect(html).toContain('untitled-1');
```

- [ ] **Step 14.** Run `bun test src/components/loop/LoopSelector.test.tsx` and watch it fail on `expect(html).toContain('untitled-1')` — the option renders `loop.name`, which is `''`.

- [ ] **Step 15.** In `src/components/loop/LoopSelector.tsx`, add the import and route the option text through it:

```ts
import { loadLoop } from '@/store/loadLoop';
import { loopLabel } from '@/store/loop';
import { useAppStore } from '@/store/store';
```
```tsx
        <option key={loop.id} value={loop.id}>
          {loopLabel(loop)}
        </option>
```

- [ ] **Step 16.** Run `bun test src/components/loop/LoopSelector.test.tsx` and confirm it passes.

- [ ] **Step 17.** Commit:

```bash
git add src/components/loop/LoopSelector.tsx src/components/loop/LoopSelector.test.tsx
git commit -m "feat(components): resolve the loop selector's option text through loopLabel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle D — both of the transport bar's reads

- [ ] **Step 18.** In `src/components/TransportBar.test.tsx`, extend the `songModeLabel` describe with the unnamed case:

```ts
describe('songModeLabel', () => {
  test('returns a song-mode badge only while a song position exists', () => {
    const loops: Loop[] = [{ ...createDefaultLoop(), name: 'Verse' }];
    expect(songModeLabel(null, loops)).toBe(null);
    expect(songModeLabel(0, loops)).toBe('Song · Verse');
  });

  // Reading `name` directly rendered a bare "Song · " for every loop nobody
  // had renamed, which after the label change is every new loop.
  test('falls back to the app label rather than rendering a bare Song ·', () => {
    const loops: Loop[] = [createDefaultLoop()];
    expect(songModeLabel(0, loops)).toBe('Song · untitled-1');
  });
});
```

- [ ] **Step 19.** Run `bun test src/components/TransportBar.test.tsx` and watch the new test fail with `Expected: "Song · untitled-1"`, `Received: "Song · "`.

- [ ] **Step 20.** In `src/components/TransportBar.tsx`, add the import and route both reads through it:

```ts
import { loopLabel } from '@/store/loop';
```
```ts
  const loop = loops[songLoopIndex];
  return loop ? `Song · ${loopLabel(loop)}` : null;
```
```ts
  const activeLoop = loops.find((loop) => loop.id === activeLoopId);
  const activeLoopName = activeLoop ? loopLabel(activeLoop) : '';
```

- [ ] **Step 21.** Run `bun test src/components/TransportBar.test.tsx` and confirm it passes, then `bun test` for the whole suite.

- [ ] **Step 22.** Commit:

```bash
git add src/components/TransportBar.tsx src/components/TransportBar.test.tsx
git commit -m "feat(components): resolve both of the transport bar's loop labels through loopLabel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 4: Rename accepts an empty string

**Files:**
- `Modify:` `src/components/song/SortableLoopCard.tsx`
- `Test:` `src/components/song/SortableLoopCard.test.tsx`

**Interfaces:**
- `Consumes:` `SortableLoopCardProps.label: string` (Task 3); the local `draftName` state (Task 3); the existing `onRename: (id: string, name: string) => void` prop, wired in `ArrangeView` to the store's `setLoopName(id, name)`.
- `Produces:` no new exported name. Two behaviour changes inside `SortableLoopCard`:
  - `handleSaveName` calls `onRename(loop.id, trimmed)` whenever `trimmed !== loop.name`, including `trimmed === ''` — clearing the field writes `name: ''` and the card falls back to `tempName` through the `label` prop.
  - the rename input opens **empty**, with `label` as its `placeholder` and never as its `value`.

#### Cycle A — saving an empty field clears the name

- [ ] **Step 1.** In `src/components/song/SortableLoopCard.test.tsx`, export the handler's rule as a pure function test. First add this test at the end of the `SortableLoopCard` describe — it drives the exported helper rather than a DOM event, which this repo has no way to fire:

```ts
describe('renameFromDraft', () => {
  // The old guard was `if (trimmed && trimmed !== loop.name)`, so "clear the
  // name to go back to the temporary label" was silently treated as a cancel.
  test('an emptied field is a real value, not a cancel', () => {
    expect(renameFromDraft('', 'Drop')).toBe('');
    expect(renameFromDraft('   ', 'Drop')).toBe('');
  });

  test('an unchanged field writes nothing', () => {
    expect(renameFromDraft('Drop', 'Drop')).toBe(null);
    expect(renameFromDraft('  Drop  ', 'Drop')).toBe(null);
    // The blank-to-blank case is the one an untouched, placeholder-only input
    // produces on blur: nothing changed, so nothing is written.
    expect(renameFromDraft('', '')).toBe(null);
  });

  test('a changed field writes the trimmed value', () => {
    expect(renameFromDraft('  Chorus ', 'Drop')).toBe('Chorus');
  });
});
```

  and add `renameFromDraft` to the import from `./SortableLoopCard`:

```ts
import { getActiveChordIndex, renameFromDraft, SortableLoopCard } from './SortableLoopCard';
```

- [ ] **Step 2.** Run `bun test src/components/song/SortableLoopCard.test.tsx` and watch it fail with `SyntaxError: Export named 'renameFromDraft' not found in module '.../src/components/song/SortableLoopCard.tsx'`.

- [ ] **Step 3.** In `src/components/song/SortableLoopCard.tsx`, add the pure helper directly above `export interface SortableLoopCardProps`:

```ts
/**
 * What a rename save should write, or null for "write nothing".
 *
 * `''` is a REAL value here, not a cancel: it is the user clearing the name so
 * the card falls back to `tempName`. The old inline guard was
 * `if (trimmed && trimmed !== loop.name)`, which discarded exactly that
 * gesture. Pure and exported so the rule is testable without a DOM.
 */
export function renameFromDraft(draft: string, currentName: string): string | null {
  const trimmed = draft.trim();
  return trimmed === currentName ? null : trimmed;
}
```

  and rewrite `handleSaveName` to use it:

```ts
    const handleSaveName = () => {
      const next = renameFromDraft(draftName, loop.name);
      if (next !== null) onRename(loop.id, next);
      setDraftName('');
      setIsEditingName(false);
    };
```

- [ ] **Step 4.** Run `bun test src/components/song/SortableLoopCard.test.tsx` and confirm the three new tests pass.

- [ ] **Step 5.** Commit:

```bash
git add src/components/song/SortableLoopCard.tsx src/components/song/SortableLoopCard.test.tsx
git commit -m "fix(components): let a cleared rename input write an empty loop name

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle B — the input opens empty, with the label as placeholder

- [ ] **Step 6.** In `src/components/song/SortableLoopCard.test.tsx`, add this test after the `renders the label prop, not the raw name, for an unnamed loop` test. The rendered card starts with `isEditingName` false, so the assertion is on the *props the input is built with*; drive it by rendering the editing branch through the exported helper's sibling constant is not possible, so assert the non-editing markup carries no prefilled input and pin the placeholder text on the source:

```ts
  test('the rename input is built with the label as placeholder, never as value', () => {
    // No DOM here, so the click that opens the input cannot be fired. What can
    // be pinned is the source: prefilling is the trap — a user opens rename,
    // changes their mind and blurs, and the app's label is silently promoted
    // into a real `name` that then stops tracking vibe applications forever,
    // with nothing on screen changing to say so.
    const src = readFileSync(new URL('./SortableLoopCard.tsx', import.meta.url), 'utf8');
    expect(src).toContain('placeholder={label}');
    expect(src).toContain('value={draftName}');
    expect(src).not.toContain('setDraftName(loop.name)');
    expect(src).not.toContain('placeholder="Loop name..."');
  });
```

  and add the source-text import at the top of the file, matching the idiom in
  `src/components/loop/SequencerView.test.tsx`:

```ts
import { readFileSync } from 'node:fs';
```

- [ ] **Step 7.** Run `bun test src/components/song/SortableLoopCard.test.tsx` and watch it fail on `expect(source).toContain('placeholder={label}')` — the input still hard-codes `placeholder="Loop name..."` and the rename button still calls `setDraftName(loop.name)`.

- [ ] **Step 8.** In `src/components/song/SortableLoopCard.tsx`, change the input's placeholder:

```tsx
                    className="input input-xs input-bordered font-bold max-w-40 sm:max-w-56"
                    placeholder={label}
```

  change the rename button to open the field empty:

```tsx
                    onClick={() => {
                      // Opens EMPTY with the label as placeholder. Prefilling
                      // would let an untouched blur promote the app's label
                      // into a real name.
                      setDraftName('');
                      setIsEditingName(true);
                    }}
```

  change `handleKeyDown`'s Escape branch to match:

```ts
      } else if (e.key === 'Escape') {
        setDraftName('');
        setIsEditingName(false);
      }
```

  and change the state's initial value, so every path into the input agrees
  that the draft starts empty:

```ts
    const [draftName, setDraftName] = useState('');
```

- [ ] **Step 9.** Run `bun test src/components/song/SortableLoopCard.test.tsx` and confirm it passes, then `bun test` for the whole suite and `bun run eslint` for zero errors and zero warnings.

- [ ] **Step 10.** Commit:

```bash
git add src/components/song/SortableLoopCard.tsx src/components/song/SortableLoopCard.test.tsx
git commit -m "fix(components): open the rename input empty with the label as placeholder

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 5: `addLoop` and `duplicateLoop` label rules

**Files:**
- `Modify:` `src/store/loop.ts`, `src/store/loopSlice.ts`
- `Test:` `src/store/loop.test.ts`, `src/store/loopSlice.test.ts`

**Interfaces:**
- `Consumes:` `loopLabel(loop: Pick<Loop, 'name' | 'tempName'>): string` and `nextUntitledName(loops: readonly Loop[]): string` from `src/store/loop.ts` (Task 1); `cloneLoop(loop: Loop): Loop` and `newLoopId(): string`, both already in `src/store/loop.ts`.
- `Produces:`
  - `export function nextDuplicateLabel(loops: readonly Loop[], source: Loop): { name: string; tempName: string }` in `src/store/loop.ts`
  - `addLoop(): string` (unchanged signature) now writes `name: ''` and `tempName: nextUntitledName(state.loops)` — it inherits no label.
  - `duplicateLoop(id: string): string | null` (unchanged signature) now spreads `nextDuplicateLabel(state.loops, source)` over the clone.
  - `nextLoopName` is **deleted** from `src/store/loop.ts` in this task, along with its `describe` block in `src/store/loop.test.ts` and its import in `src/store/loopSlice.ts`: these two call sites were its last, and the `Loop N` string leaves the codebase with them.

#### Cycle A — `nextDuplicateLabel`

- [ ] **Step 1.** In `src/store/loop.test.ts`, add `nextDuplicateLabel` to the import list from `./loop` and append this describe block after the `nextUntitledName` block:

```ts
describe('nextDuplicateLabel', () => {
  // The whole rule: increment the label the card is DISPLAYING, in the field
  // it came from.
  test('a named loop increments its name and copies tempName unchanged', () => {
    const source = makeLoop({ id: 'a', name: 'Drop', tempName: 'Synthwave 80s' });
    expect(nextDuplicateLabel([source], source)).toEqual({
      name: 'Drop 2',
      tempName: 'Synthwave 80s',
    });
  });

  test('a named loop already carrying a number counts on from its stem', () => {
    const two = makeLoop({ id: 'a', name: 'Drop 2', tempName: 'untitled-1' });
    expect(nextDuplicateLabel([two], two).name).toBe('Drop 3');
  });

  // The second case is the point of the rule and must not be left to the
  // first case's coverage: copying tempName verbatim would put two cards
  // reading `Synthwave 80s` side by side, and promoting it into `name` would
  // stop the copy tracking vibe applications while its original kept doing so.
  test('an unnamed loop increments tempName and leaves name empty', () => {
    const source = makeLoop({ id: 'a', name: '', tempName: 'Synthwave 80s' });
    expect(nextDuplicateLabel([source], source)).toEqual({
      name: '',
      tempName: 'Synthwave 80s 2',
    });
  });

  test('an untitled loop counts on the hyphenated stem', () => {
    const loops = [
      makeLoop({ id: 'a', name: '', tempName: 'untitled-1' }),
      makeLoop({ id: 'b', name: '', tempName: 'untitled-2' }),
      makeLoop({ id: 'c', name: '', tempName: 'untitled-3' }),
    ];
    expect(nextDuplicateLabel(loops, loops[2])).toEqual({ name: '', tempName: 'untitled-4' });
  });

  // Lowest free rather than one-above-the-highest: the numbers belong to a
  // stem, not to the project, so a gap in `Drop 2, Drop 4` is a slot a copy
  // should fill.
  test('takes the lowest free integer for the stem', () => {
    const drop = makeLoop({ id: 'a', name: 'Drop', tempName: 'untitled-1' });
    const loops = [
      drop,
      makeLoop({ id: 'b', name: 'Drop 2', tempName: 'untitled-2' }),
      makeLoop({ id: 'c', name: 'Drop 4', tempName: 'untitled-3' }),
    ];
    expect(nextDuplicateLabel(loops, drop).name).toBe('Drop 3');
  });

  // The property, stated as a property: no two cards may read the same thing,
  // whatever arithmetic got there. Collision is checked against the DISPLAYED
  // label of every loop, since that is what the user is looking at.
  test('no two loops can resolve to the same loopLabel', () => {
    const source = makeLoop({ id: 'a', name: '', tempName: 'Synthwave 80s' });
    const loops = [
      source,
      makeLoop({ id: 'b', name: 'Synthwave 80s 2', tempName: 'untitled-2' }),
    ];
    const next = nextDuplicateLabel(loops, source);
    const clone = makeLoop({ id: 'c', ...next });
    const labels = [...loops, clone].map(loopLabel);
    expect(next.tempName).toBe('Synthwave 80s 3');
    expect(new Set(labels).size).toBe(labels.length);
  });
});
```

- [ ] **Step 2.** Run `bun test src/store/loop.test.ts` and watch it fail with `SyntaxError: Export named 'nextDuplicateLabel' not found in module '.../src/store/loop.ts'`.

- [ ] **Step 3.** In `src/store/loop.ts`, add the two helpers and the exported namer directly below `nextUntitledName`:

```ts
/**
 * A label's stem and the separator its number hangs off — `Drop 2` -> `Drop`
 * + ' ', `untitled-3` -> `untitled` + '-'. A trailing group of digits only
 * counts when a separator precedes it, so `Synthwave 80s` keeps its whole
 * string as the stem and duplicates to `Synthwave 80s 2`. The separator is
 * carried out so the re-numbered label keeps the shape it arrived in.
 */
function labelStem(label: string): { stem: string; sep: string } {
  const m = /^(.*\S)([ -])(\d+)$/.exec(label);
  return m ? { stem: m[1], sep: m[2] } : { stem: label, sep: ' ' };
}

/**
 * The lowest free integer >= 2 for a stem, checked against the labels already
 * on screen. "Lowest free" rather than "one above the highest" because the
 * numbers belong to a stem, not to the project: a gap in `Drop 2, Drop 4` is a
 * slot a copy should fill. Terminates because `taken` is finite.
 */
function nextFreeLabel(taken: ReadonlySet<string>, stem: string, sep: string): string {
  let n = 2;
  while (taken.has(`${stem}${sep}${n}`)) n += 1;
  return `${stem}${sep}${n}`;
}

/**
 * The clone's two label fields: increment the label the card is DISPLAYING, in
 * the field it came from. A named `Drop` yields `name: 'Drop 2'` with
 * `tempName` copied unchanged; an unnamed loop showing `Synthwave 80s` yields
 * `tempName: 'Synthwave 80s 2'` with `name` still ''. Copying the label
 * verbatim would put two identical cards side by side — the old `Loop 5`
 * problem wearing a nicer word — and promoting it into `name` would make the
 * copy stop tracking vibe applications while its original kept tracking them.
 */
export function nextDuplicateLabel(
  loops: readonly Loop[],
  source: Loop,
): { name: string; tempName: string } {
  const taken = new Set(loops.map(loopLabel));
  const { stem, sep } = labelStem(loopLabel(source));
  const next = nextFreeLabel(taken, stem, sep);
  return source.name ? { name: next, tempName: source.tempName } : { name: '', tempName: next };
}
```

> **Superseded by the round-4 review fix** in `src/store/loop.ts`: the shipped
> `nextDuplicateLabel` also renumbers `tempName` on the named branch — off its
> own stem and its own `taken` set, never copied verbatim from `source` — via
> a second `labelStem`/`nextFreeLabel` pass over `loops.map(l => l.tempName)`.
> `name` masks `tempName` today, but `setLoopName` has no uniqueness guard, so
> two clones that both later clear `name` back to `''` would otherwise surface
> the same `loopLabel` — the exact collision this function exists to prevent.
> The docblock above is likewise stale where it says "`tempName` copied
> unchanged"; see the fix's own comment in `src/store/loop.ts`.

- [ ] **Step 4.** Run `bun test src/store/loop.test.ts` and confirm all six new tests pass.

- [ ] **Step 5.** Commit:

```bash
git add src/store/loop.ts src/store/loop.test.ts
git commit -m "feat(store): add nextDuplicateLabel, which increments the displayed field

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle B — `addLoop` inherits no label

- [ ] **Step 6.** In `src/store/loopSlice.test.ts`, replace the name assertion in `addLoop appends a deep copy of the active loop and auto-activates it`:

```ts
    // Add is a FRESH slot, Duplicate is a derived one, and the labels say
    // which — even though Add clones the active loop's content. Sharing one
    // namer between the two would erase the distinction.
    expect(added.name).toBe('');
    expect(added.tempName).toBe('untitled-2');
```

  and add this test directly after it:

```ts
  test('addLoop never inherits the source loop label', () => {
    const h = makeSlice();
    h.state.setLoopName(h.state.loops[0].id, 'Drop');
    h.state.addLoop();
    const added = h.state.loops[1];
    // The regression the shared-namer shortcut would cause: the new slot must
    // not come out called `Drop` or `Drop 2`.
    expect(added.name).toBe('');
    expect(added.tempName).toBe('untitled-2');
  });
```

- [ ] **Step 7.** Run `bun test src/store/loopSlice.test.ts` and watch both fail with `Expected: ""`, `Received: "Loop 1"`.

- [ ] **Step 8.** In `src/store/loopSlice.ts`, change the import line and `addLoop`'s literal:

```ts
import { cloneLoop, fallbackActiveLoopId, newLoopId, nextDuplicateLabel, nextUntitledName } from './loop';
```
```ts
      const loop: Loop = {
        ...cloneLoop(source),
        id: newLoopId(),
        // Add is a fresh slot: no name, and a number of its own.
        name: '',
        tempName: nextUntitledName(state.loops),
      };
```

- [ ] **Step 9.** Run `bun test src/store/loopSlice.test.ts` and expect the two `addLoop` tests to pass while the two `duplicateLoop` tests still fail on `'Loop 1'` — the next cycle fixes those.

- [ ] **Step 10.** Commit:

```bash
git add src/store/loopSlice.ts src/store/loopSlice.test.ts
git commit -m "feat(store): give an added loop a fresh untitled label and no name

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle C — `duplicateLoop` increments the displayed field

- [ ] **Step 11.** In `src/store/loopSlice.test.ts`, replace the name assertion in `duplicateLoop of the active loop inserts a deep clone after it and auto-activates it`. The only loop present is `untitled-1`, so the lowest free integer on the `untitled` stem is 2:

```ts
    expect(h.state.loops[1].name).toBe('');
    expect(h.state.loops[1].tempName).toBe('untitled-2');
```

  replace the one in `duplicateLoop of a non-active loop returns the clone id for the caller to load` — that test calls `addLoop()` first, so `untitled-2` is already taken and the clone takes 3:

```ts
    expect(h.state.loops[1].name).toBe('');
    expect(h.state.loops[1].tempName).toBe('untitled-3');
```

  and add this test after them:

```ts
  test('duplicateLoop increments a user name and leaves tempName alone', () => {
    const h = makeSlice();
    const id = h.state.loops[0].id;
    h.state.setLoopName(id, 'Drop');
    h.state.duplicateLoop(id);
    const clone = h.state.loops[1];
    expect(clone.name).toBe('Drop 2');
    expect(clone.tempName).toBe('untitled-1');
  });
```

- [ ] **Step 12.** Run `bun test src/store/loopSlice.test.ts` and watch all three fail on the name assertion: `Expected: ""` against `Received: "Loop 1"` (active duplicate) and `Received: "Loop 2"` (non-active duplicate), and `Expected: "Drop 2"` against `Received: "Loop 1"`.

- [ ] **Step 13.** In `src/store/loopSlice.ts`, rewrite `duplicateLoop`'s clone literal:

```ts
      const source = state.loops[index];
      const clone: Loop = {
        ...cloneLoop(source),
        id: newLoopId(),
        // Derived, not fresh: the label increments the one on screen.
        ...nextDuplicateLabel(state.loops, source),
      };
```

  and change the line below it that still reads the original through the index:

```ts
      const cloneActive = id === state.activeLoopId;
      const loops = [
        ...state.loops.slice(0, index + 1),
        clone,
        ...state.loops.slice(index + 1),
      ];
```

- [ ] **Step 14.** Run `bun test src/store/loopSlice.test.ts` and confirm every test passes.

- [ ] **Step 15.** Commit:

```bash
git add src/store/loopSlice.ts src/store/loopSlice.test.ts
git commit -m "feat(store): label a duplicated loop from the field its label came from

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle D — `nextLoopName` leaves the codebase

- [ ] **Step 16.** Confirm it is unused by production code: run `grep -rn "nextLoopName" src/` and expect hits in exactly two files — its definition in `src/store/loop.ts`, and its import plus its `describe` block in `src/store/loop.test.ts`. `src/store/loopSlice.ts` must no longer appear, since Cycles B and C replaced both of its call sites.

- [ ] **Step 17.** Delete the `nextLoopName` function and its docblock from `src/store/loop.ts`, delete `nextLoopName,` from the import list in `src/store/loop.test.ts`, and delete the whole `describe('nextLoopName', …)` block from that file.

- [ ] **Step 18.** Run `bun test src/store/loop.test.ts src/store/loopSlice.test.ts`, then `bun test` for the whole suite, then `bun run lint` and `bun run eslint`. All green, zero warnings.

- [ ] **Step 19.** Commit:

```bash
git add src/store/loop.ts src/store/loop.test.ts
git commit -m "refactor(store): delete nextLoopName now that no loop is named Loop N

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 6: A vibe stamps the active loop's `tempName`

**Files:**
- `Modify:` `src/store/types.ts`, `src/store/loopSlice.ts`, `src/store/vibes.ts`
- `Test:` `src/store/loopSlice.test.ts`, `src/store/vibes.test.ts`

**Interfaces:**
- `Consumes:` `Loop.tempName: string` (Task 1); `loopLabel(loop: Pick<Loop, 'name' | 'tempName'>): string` (Task 1). Existing: `ResolvedVibe extends VibeSpec` from `src/store/vibes.ts`, whose `name: string` is the vibe's display name (`'Synthwave 80s'`), distinct from its `id` (`'synthwave-80s'`).
- `Produces:`
  - `LoopSlice` gains `setLoopTempName: (id: string, tempName: string) => void`, implemented in `createLoopSlice` in the shape of the existing `setLoopName`.
  - `applyVibeToStore(vibe: ResolvedVibe): void` (unchanged signature) additionally calls `store.setLoopTempName(store.activeLoopId, vibe.name)` in its context step, beside the existing `store.setSelectedVibeId(vibe.id)`.

**Why this needs its own action rather than a flat setter.** `tempName` is deliberately
absent from `LOOP_FLAT_KEYS`, so there is no flat field for `loopSync.ts`'s
flat→`loops[]` mirror to carry: `loopMirrorPartial` only builds a mirror when a
`LOOP_FLAT_KEYS` member changed, and the patch it builds is `loopStatePatch`,
which enumerates exactly those keys. A write to `tempName` therefore has to name
`loops[]` directly. Adding a flat mirror field instead would put a label into
the copyable content set and break the boundary `LoopStatePatch`
(`Omit<Loop, 'id' | 'name' | 'repeatCount'>`) already draws. The write is safe
inside the mirroring `set`: it touches no flat key, so `loopMirrorPartial`
returns `null` and the array is written untouched.

#### Cycle A — the action

- [ ] **Step 1.** In `src/store/loopSlice.test.ts`, add this test after the `duplicateLoop` tests:

```ts
  test('setLoopTempName writes loops[] directly for the named loop only', () => {
    const h = makeSlice();
    const firstId = h.state.loops[0].id;
    h.state.addLoop();
    h.state.setLoopTempName(firstId, 'Synthwave 80s');
    expect(h.state.loops[0].tempName).toBe('Synthwave 80s');
    expect(h.state.loops[1].tempName).toBe('untitled-2');
  });
```

- [ ] **Step 2.** Run `bun test src/store/loopSlice.test.ts` and watch it fail with `TypeError: h.state.setLoopTempName is not a function`.

- [ ] **Step 3.** In `src/store/types.ts`, add the action to `LoopSlice`, directly below `setLoopName`:

```ts
  setLoopName: (id: string, name: string) => void;
  /**
   * The app's label for a loop — written by the vibe path, never by a rename.
   * Its own action rather than a flat setter because `tempName` is not in
   * LOOP_FLAT_KEYS, so loopSync's flat->loops[] mirror has no field to carry
   * it from; adding one would put a label into the copyable content set.
   */
  setLoopTempName: (id: string, tempName: string) => void;
```

- [ ] **Step 4.** In `src/store/loopSlice.ts`, add the implementation directly below `setLoopName`:

```ts
    setLoopTempName: (id, tempName) =>
      set((state) => ({
        loops: state.loops.map((r) => (r.id === id ? { ...r, tempName } : r)),
      })),
```

- [ ] **Step 5.** Run `bun test src/store/loopSlice.test.ts` and confirm it passes.

- [ ] **Step 6.** Commit:

```bash
git add src/store/types.ts src/store/loopSlice.ts src/store/loopSlice.test.ts
git commit -m "feat(store): add setLoopTempName, a loops[] write for the app's loop label

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

#### Cycle B — the vibe writes it

- [ ] **Step 7.** In `src/store/vibes.test.ts`, add `loopLabel` to the imports and append this describe block at the end of the file:

```ts
import { loopLabel } from './loop';
```
```ts
describe('a vibe stamps the active loop with its display name', () => {
  beforeEach(() => {
    useAppStore.setState({ activeTab: 'sound', playbackScope: SCOPE_NONE });
  });

  test('writes the vibe NAME, not its id, into the active loop and no other', () => {
    const synthwave = RESOLVED_VIBES.find((v) => v.id === 'synthwave-80s')!;
    const a = { ...createDefaultLoop(), id: 'loop-a', name: '', tempName: 'untitled-1' };
    const b = { ...createDefaultLoop(), id: 'loop-b', name: '', tempName: 'untitled-2' };
    useAppStore.setState({ loops: [a, b], activeLoopId: 'loop-a' });

    applyVibeToStore(synthwave);

    const loops = useAppStore.getState().loops;
    // A copied NAME, not a stored vibeId: an id is a reference that claims
    // identity and goes on claiming it after the sound has moved on, while a
    // name claims only history, which cannot go stale.
    expect(loops.find((l) => l.id === 'loop-a')!.tempName).toBe('Synthwave 80s');
    expect(loops.find((l) => l.id === 'loop-b')!.tempName).toBe('untitled-2');
  });

  test('writes it even behind a user name, leaving the displayed label unchanged', () => {
    const lofi = RESOLVED_VIBES.find((v) => v.id === 'lofi-chill')!;
    const named = { ...createDefaultLoop(), id: 'loop-a', name: 'Drop', tempName: 'untitled-1' };
    useAppStore.setState({ loops: [named], activeLoopId: 'loop-a' });

    applyVibeToStore(lofi);

    const loop = useAppStore.getState().loops[0];
    // tempName always means "the last vibe applied here"; it simply stays
    // invisible behind the user's name. A conditional write would make
    // clearing that name reveal a stale untitled number instead of the vibe
    // the loop was actually built from — the one moment the field exists for.
    expect(loop.tempName).toBe('Lo-Fi Chill');
    expect(loop.name).toBe('Drop');
    expect(loopLabel(loop)).toBe('Drop');
  });
});
```

- [ ] **Step 8.** Run `bun test src/store/vibes.test.ts` and watch the first test fail with `Expected: "Synthwave 80s"`, `Received: "untitled-1"`.

- [ ] **Step 9.** In `src/store/vibes.ts`, add one call to `applyVibeToStore`'s context step, directly after `store.setSelectedVibeId(vibe.id)`:

```ts
  store.setSelectedVibeId(vibe.id);
  // A SNAPSHOT of the vibe's display name, on the loop being rewritten — not
  // the id, and not a pointer to the entry. Applying a vibe is a bulk setter,
  // not a declaration that the loop IS that genre: the user is free to keep
  // the chords, swap the kit and end up somewhere else, and a stored id would
  // go on claiming an identity the sound has left. Unconditional, so a loop
  // with a user `name` still tracks the last vibe applied behind it.
  store.setLoopTempName(store.activeLoopId, vibe.name);
```

- [ ] **Step 10.** Run `bun test src/store/vibes.test.ts` and confirm both new tests pass, then `bun test` for the whole suite.

- [ ] **Step 11.** Commit:

```bash
git add src/store/vibes.ts src/store/vibes.test.ts
git commit -m "feat(store): stamp the active loop's tempName with the applied vibe's name

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 7: `loadLoop` clears `selectedVibeId`

**Files:**
- `Modify:` `src/store/loadLoop.ts`
- `Test:` `src/store/loadLoop.test.ts`

**Interfaces:**
- `Consumes:` `Loop.tempName: string` (Task 1) — the per-loop answer to "what was this built from", which is what makes the global id redundant as a per-loop claim. Existing: `selectedVibeId: string | null` on `musicContextSlice`, persisted, driving `InstantVibesBar`'s highlight; `loopStatePatch(source: object): LoopStatePatch` from `src/store/loop.ts`.
- `Produces:` `loadLoop(id: string, opts?: { atBoundary?: number }): void` (unchanged signature) now writes `selectedVibeId: null` in **both** of its `useAppStore.setState` calls — the `atBoundary` seamless path and the default hard-stop path. `selectedVibeId` stays a single global in `musicContextSlice`; it is not moved per-loop.

> **Superseded by the round-1 review fix** in `src/store/loadLoop.ts`: the shipped code writes
> `selectedVibeId: null` on both paths only when `store.activeLoopId !== id` (a `leavingLoop`
> guard) — an unconditional clear, as first implemented below, blanked the Instant Vibes chip on
> a re-select or audition toggle of the loop already active, which is not a loop switch at all.

- [ ] **Step 1.** In `src/store/loadLoop.test.ts`, add `selectedVibeId: null,` to the `resetStore` helper's `setState` (after `playbackScope: SCOPE_NONE,`) so a sibling file's vibe apply cannot bleed a value in, and add this describe block at the end of the file:

```ts
describe('loadLoop and the vibe bar highlight', () => {
  // Under the two-label model the highlight means "the chip just pressed", not
  // "what this loop is" — the per-loop answer is tempName. Left alone it
  // survives a loop switch and contradicts the card: move from a loop built
  // out of Synthwave 80s to one built out of Lo-Fi Chill and the card reads
  // Lo-Fi Chill while the bar still lights Synthwave 80s.
  test('clears selectedVibeId on the default hard-stop path', () => {
    const loopB: Loop = { ...createDefaultLoop(), id: 'loop-b', name: 'B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      selectedVibeId: 'synthwave-80s',
    });

    loadLoop('loop-b');

    expect(useAppStore.getState().selectedVibeId).toBe(null);
  });

  test('clears selectedVibeId on the seamless boundary path too', () => {
    const loopB: Loop = { ...createDefaultLoop(), id: 'loop-b', name: 'B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      songLoopIndex: 0,
      playbackScope: { kind: 'song' },
      selectedVibeId: 'synthwave-80s',
    });

    loadLoop('loop-b', { atBoundary: 10 });

    expect(useAppStore.getState().selectedVibeId).toBe(null);
  });
});
```

- [ ] **Step 2.** Run `bun test src/store/loadLoop.test.ts` and watch both fail with `Expected: null`, `Received: "synthwave-80s"`.

- [ ] **Step 3.** In `src/store/loadLoop.ts`, add the key to the boundary path's write:

```ts
    useAppStore.setState({
      ...loopStatePatch(loop),
      activeLoopId: id,
      songLoopIndex,
      // Leaving the loop turns the light off: the bar highlights a chip only
      // while you are still on the loop you pressed it for. The per-loop
      // answer to "what is this" is the loop's own tempName. (Project Open
      // nulls it for the same reason, in projectFormat.ts.)
      selectedVibeId: null,
    });
```

  and to the default path's write:

```ts
  useAppStore.setState({
    ...loopStatePatch(loop),
    activeLoopId: id,
    songLoopIndex,
    // Same rule as the boundary path above: the highlight means "the chip just
    // pressed", so it goes out when you leave the loop.
    selectedVibeId: null,
  });
```

- [ ] **Step 4.** Run `bun test src/store/loadLoop.test.ts` and confirm both new tests pass and the rest of the file is unchanged.

- [ ] **Step 5.** Run `bun test` and confirm the whole suite is green — `src/store/vibes.test.ts` in particular, since `applyVibeToStore` sets `selectedVibeId` and never calls `loadLoop`, so its assertions on the id must still hold.

- [ ] **Step 6.** Run `bun run verify` and confirm the gate passes with zero eslint errors and zero warnings.

- [ ] **Step 7.** Commit:

```bash
git add src/store/loadLoop.ts src/store/loadLoop.test.ts
git commit -m "fix(store): clear selectedVibeId on both loadLoop paths

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

### Task 8: `src/store/loopCopy.ts` — the copy-group table, the patch builder, the Key implication

**Files:**
- Create: `src/store/loopCopy.ts`
- Test: `src/store/loopCopy.test.ts`

**Interfaces:**

- **Consumes:** `LOOP_FLAT_KEYS: readonly [...]` and `loopBars(chords: readonly { bars?: number }[]): number` from `src/store/loop.ts`; `Loop` and `LoopStatePatch = Omit<Loop, 'id' | 'name' | 'repeatCount'>` from `src/store/types.ts`; `createDefaultLoop(): Loop` from `src/store/loopSlice.ts` (test only); `LeadNote = { note: string; len: number }` from `src/audio/leadMelody.ts` (test only); `SequencerTrack = { id, name, instrument, color, volume, muted, steps: boolean[] }` from `src/types.ts` (test only).
- **Produces:**
  - `type LoopCopyTrack = 'lead' | 'chord' | 'bass' | 'pad' | 'drums' | 'loop'`
  - `type LoopCopyAspect = 'sound' | 'pattern' | 'whole'`
  - `type LoopCopyGroupId = 'lead-sound' | 'lead-pattern' | 'chord-sound' | 'chord-pattern' | 'bass-sound' | 'bass-pattern' | 'pad-sound' | 'pad-pattern' | 'drums-sound' | 'drums-pattern' | 'key' | 'mix'`
  - `interface LoopCopyGroup { id: LoopCopyGroupId; track: LoopCopyTrack; aspect: LoopCopyAspect; label: string; keys: readonly (keyof LoopStatePatch)[] }`
  - `const LOOP_COPY_GROUPS: readonly LoopCopyGroup[]`
  - `function buildLoopCopyPatch(source: Loop, selected: readonly LoopCopyGroupId[]): Partial<LoopStatePatch>`
  - `function impliesKeyCopy(source: Loop, target: Loop, selected: readonly LoopCopyGroupId[]): boolean`

This module is pure: no React, no audio, and **no import of `./store`** (see Task 9 for why that matters). It imports types only, plus nothing at runtime.

---

- [ ] **Step 1: Write the coverage invariant as the first failing test.**

  Create `src/store/loopCopy.test.ts`:

  ```ts
  import { describe, expect, test } from 'bun:test';
  import { LOOP_FLAT_KEYS } from './loop';
  import { LOOP_COPY_GROUPS } from './loopCopy';

  describe('LOOP_COPY_GROUPS partitions LOOP_FLAT_KEYS', () => {
    test('covers every flat key exactly once — no key uncovered, none in two groups', () => {
      const claimed = LOOP_COPY_GROUPS.flatMap((group) => [...group.keys]);
      // Duplicates first: a key counted twice would make the union a multiset
      // that the Set equality below silently accepts, and would mean two
      // checkboxes fighting over one field.
      expect(new Set(claimed).size).toBe(claimed.length);
      // Equality, not a subset check: a field added to Loop and to
      // LOOP_FLAT_KEYS but to no group would otherwise be saved, loaded,
      // mirrored and permanently uncopyable with nothing red.
      expect(new Set(claimed)).toEqual(new Set(LOOP_FLAT_KEYS));
    });

    test('every group id is unique', () => {
      const ids = LOOP_COPY_GROUPS.map((group) => group.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```bash
  bun test src/store/loopCopy.test.ts
  ```

  Expected failure: `error: Cannot find module './loopCopy' from '/Users/Pathompong/Sites/Personal/solna/src/store/loopCopy.test.ts'` — 0 pass, 1 error.

- [ ] **Step 3: Write `LOOP_COPY_GROUPS`.**

  Create `src/store/loopCopy.ts`:

  ```ts
  import type { Loop, LoopStatePatch } from './types';

  /** The five mixer tracks a group can name, plus `loop` for the two loop-wide groups. */
  export type LoopCopyTrack = 'lead' | 'chord' | 'bass' | 'pad' | 'drums' | 'loop';

  /**
   * The Sound/Pattern boundary the navigation already draws — changes the sound
   * but not the notes, versus changes the notes or the rhythm. `whole` is the
   * two loop-wide groups, which are neither half of that split.
   */
  export type LoopCopyAspect = 'sound' | 'pattern' | 'whole';

  export type LoopCopyGroupId =
    | 'lead-sound'
    | 'lead-pattern'
    | 'chord-sound'
    | 'chord-pattern'
    | 'bass-sound'
    | 'bass-pattern'
    | 'pad-sound'
    | 'pad-pattern'
    | 'drums-sound'
    | 'drums-pattern'
    | 'key'
    | 'mix';

  export interface LoopCopyGroup {
    id: LoopCopyGroupId;
    track: LoopCopyTrack;
    aspect: LoopCopyAspect;
    label: string;
    keys: readonly (keyof LoopStatePatch)[];
  }

  /**
   * A five-track x two-aspect matrix plus two loop-wide groups, and **the only
   * place the grouping is written** — the dialog lays its matrix out from
   * `track`/`aspect`, `buildLoopCopyPatch` reads `keys`, and loopCopy.test.ts
   * asserts the union of every `keys` equals LOOP_FLAT_KEYS exactly.
   *
   * Neither label field appears here and neither can: `name` and `tempName` are
   * loop-slot identity, so `LoopStatePatch` (Omit<Loop, 'id' | 'name' |
   * 'repeatCount'>) does not carry them and `keyof LoopStatePatch` cannot name
   * one. `repeatCount` is out for the same structural reason — it is
   * arrangement data, not loop content.
   *
   * padVolume/padMuted reach a Loop through PadState rather than through the
   * other eight mixer fields' path; they still belong to `mix`, because the
   * group is the mixer strip a user sees, not the interface a field is
   * declared in.
   */
  export const LOOP_COPY_GROUPS: readonly LoopCopyGroup[] = [
    { id: 'lead-sound', track: 'lead', aspect: 'sound', label: 'Lead sound', keys: ['synthParams'] },
    {
      id: 'lead-pattern',
      track: 'lead',
      aspect: 'pattern',
      label: 'Lead pattern',
      keys: [
        'leadMelodySteps',
        'leadLoopLength',
        'leadStepResolution',
        'leadMelodyView',
        'leadMelodyOctave',
        'leadGate',
      ],
    },
    { id: 'chord-sound', track: 'chord', aspect: 'sound', label: 'Chords sound', keys: ['chordSynthParams'] },
    {
      id: 'chord-pattern',
      track: 'chord',
      aspect: 'pattern',
      label: 'Chords pattern',
      keys: [
        'chords',
        'chordRhythmId',
        'chordRhythmMode',
        'customChordRhythm',
        'chordFeel',
        'chordOctave',
      ],
    },
    { id: 'bass-sound', track: 'bass', aspect: 'sound', label: 'Bass sound', keys: ['bassSynthParams'] },
    {
      id: 'bass-pattern',
      track: 'bass',
      aspect: 'pattern',
      label: 'Bass pattern',
      keys: ['bassPatternId', 'bassPatternMode', 'customBassPattern', 'bassFeel', 'bassOctave'],
    },
    { id: 'pad-sound', track: 'pad', aspect: 'sound', label: 'Pad sound', keys: ['padSynthParams'] },
    {
      id: 'pad-pattern',
      track: 'pad',
      aspect: 'pattern',
      label: 'Pad pattern',
      keys: ['padMode', 'padOctave', 'padVoicing', 'padDroneDegree', 'padDroneIntervals'],
    },
    {
      id: 'drums-sound',
      track: 'drums',
      aspect: 'sound',
      label: 'Drums sound',
      keys: ['soundKit', 'drumFilterCutoff', 'drumFilterResonance', 'drumFilterType'],
    },
    { id: 'drums-pattern', track: 'drums', aspect: 'pattern', label: 'Drums pattern', keys: ['sequencerTracks'] },
    { id: 'key', track: 'loop', aspect: 'whole', label: 'Key / Scale', keys: ['scaleRoot', 'scaleType'] },
    {
      id: 'mix',
      track: 'loop',
      aspect: 'whole',
      label: 'Mix',
      keys: [
        'synthVolume',
        'synthMuted',
        'chordVolume',
        'chordMuted',
        'bassVolume',
        'bassMuted',
        'padVolume',
        'padMuted',
        'masterSequencerVolume',
        'drumMuted',
      ],
    },
  ];
  ```

- [ ] **Step 4: Run it and watch it pass.**

  ```bash
  bun test src/store/loopCopy.test.ts
  ```

  Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit the table.**

  ```bash
  git add src/store/loopCopy.ts src/store/loopCopy.test.ts
  printf '%s\n' \
    'feat(store): add LOOP_COPY_GROUPS with an exhaustive coverage invariant' \
    '' \
    'Twelve groups — a five-track x two-aspect matrix plus Key and Mix — as the' \
    'single place the copy grouping is written. The first test asserts the union' \
    'of every group'\''s keys EQUALS the set of LOOP_FLAT_KEYS, so a field added to' \
    'Loop turns the suite red until someone decides which group owns it; a subset' \
    'check would pass forever while the field stayed uncopyable.' \
    '' \
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
    'Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM' \
    | git commit -F -
  ```

- [ ] **Step 6: Write the failing exact-keys test for `buildLoopCopyPatch`.**

  Append to `src/store/loopCopy.test.ts`, and extend the import line at the top to
  `import { buildLoopCopyPatch, LOOP_COPY_GROUPS } from './loopCopy';` plus
  `import { createDefaultLoop } from './loopSlice';` and
  `import type { Loop } from './types';`:

  ```ts
  const sourceLoop = (): Loop => ({
    ...createDefaultLoop(),
    id: 'loop-source',
    name: 'Chorus',
    scaleRoot: 'C',
    scaleType: 'Major',
    chordFeel: 0.9,
    chordOctave: 5,
    synthVolume: -3,
  });

  describe('buildLoopCopyPatch', () => {
    test('an empty selection builds an empty patch', () => {
      expect(Object.keys(buildLoopCopyPatch(sourceLoop(), []))).toEqual([]);
    });

    test('one group contributes exactly its own keys', () => {
      const patch = buildLoopCopyPatch(sourceLoop(), ['lead-sound']);
      expect(Object.keys(patch)).toEqual(['synthParams']);
    });

    test('several groups contribute exactly their union and nothing else', () => {
      const patch = buildLoopCopyPatch(sourceLoop(), ['chord-pattern', 'key']);
      expect(new Set(Object.keys(patch))).toEqual(
        new Set([
          'chords',
          'chordRhythmId',
          'chordRhythmMode',
          'customChordRhythm',
          'chordFeel',
          'chordOctave',
          'scaleRoot',
          'scaleType',
        ]),
      );
      expect(patch.chordFeel).toBe(0.9);
      expect(patch.chordOctave).toBe(5);
      expect(patch.scaleRoot).toBe('C');
      // Not selected: the mixer and the drum grid stay out of the patch, so a
      // merge over the target cannot move a field the user did not tick.
      expect('synthVolume' in patch).toBe(false);
      expect('sequencerTracks' in patch).toBe(false);
      expect('name' in patch).toBe(false);
    });

    test('an unknown-to-the-selection group id contributes nothing', () => {
      const all = LOOP_COPY_GROUPS.map((group) => group.id);
      const patch = buildLoopCopyPatch(sourceLoop(), all);
      expect(new Set(Object.keys(patch)).size).toBe(
        LOOP_COPY_GROUPS.reduce((n, group) => n + group.keys.length, 0),
      );
    });
  });
  ```

- [ ] **Step 7: Run it and watch it fail.**

  ```bash
  bun test src/store/loopCopy.test.ts
  ```

  Expected failure: `TypeError: buildLoopCopyPatch is not a function` on the first
  `buildLoopCopyPatch` test (4 fail).

- [ ] **Step 8: Write the minimal `buildLoopCopyPatch` — a shallow pick, no clone yet.**

  Append to `src/store/loopCopy.ts`:

  ```ts
  /**
   * Exactly the selected groups' keys, off `source`. Unselected keys are
   * absent, not undefined, so a caller can spread the patch straight over the
   * target loop.
   */
  export function buildLoopCopyPatch(
    source: Loop,
    selected: readonly LoopCopyGroupId[],
  ): Partial<LoopStatePatch> {
    const wanted = new Set<LoopCopyGroupId>(selected);
    const src = source as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const group of LOOP_COPY_GROUPS) {
      if (!wanted.has(group.id)) continue;
      for (const key of group.keys) patch[key] = src[key];
    }
    return patch as Partial<LoopStatePatch>;
  }
  ```

- [ ] **Step 9: Run it and watch it pass.**

  ```bash
  bun test src/store/loopCopy.test.ts
  ```

  Expected: 6 pass, 0 fail.

- [ ] **Step 10: Write the failing deep-clone proof.**

  Append to `src/store/loopCopy.test.ts`, inside the `describe('buildLoopCopyPatch', …)` block:

  ```ts
    test('values are deep-cloned, so a later edit to the source cannot reach the patch', () => {
      const source = sourceLoop();
      const patch = buildLoopCopyPatch(source, ['drums-pattern', 'lead-pattern']);
      const before = JSON.stringify(patch);

      // Mutate the SOURCE one level DOWN in each structure. A shallow pick
      // passes a `!==` check on the outer array and still shares every
      // element, which is the failure cloneLoop exists to prevent: a later
      // edit to one loop's grid silently rewriting the other's.
      source.sequencerTracks[0].steps[0] = !source.sequencerTracks[0].steps[0];
      source.sequencerTracks[0].muted = true;
      source.leadMelodySteps[0].push({ note: 'C4', len: 1 });

      expect(JSON.stringify(patch)).toBe(before);
      expect(patch.sequencerTracks?.[0].muted).toBe(false);
      expect(patch.sequencerTracks?.[0].steps[0]).toBe(!source.sequencerTracks[0].steps[0]);
      expect(patch.leadMelodySteps?.[0]).toEqual([]);
    });
  ```

- [ ] **Step 11: Run it and watch it fail.**

  ```bash
  bun test src/store/loopCopy.test.ts -t "deep-cloned"
  ```

  Expected failure: `expect(received).toBe(expected)` on `patch.sequencerTracks?.[0].muted` —
  received `true`, expected `false`; the patch shares the source's track objects.

- [ ] **Step 12: Clone the assembled patch.**

  In `src/store/loopCopy.ts`, replace the final line of `buildLoopCopyPatch`:

  ```ts
    // Deep-clone the whole assembled patch, the same way cloneLoop deep-clones
    // a duplicated loop and for the same reason: sequencerTracks,
    // leadMelodySteps, chords, customChordRhythm, customBassPattern and
    // padDroneIntervals are mutable substructure the target must own outright.
    return structuredClone(patch) as Partial<LoopStatePatch>;
  ```

- [ ] **Step 13: Run it and watch it pass.**

  ```bash
  bun test src/store/loopCopy.test.ts
  ```

  Expected: 7 pass, 0 fail.

- [ ] **Step 14: Commit the patch builder.**

  ```bash
  git add src/store/loopCopy.ts src/store/loopCopy.test.ts
  printf '%s\n' \
    'feat(store): build a deep-cloned selective loop-copy patch' \
    '' \
    'buildLoopCopyPatch returns exactly the selected groups'\'' keys and nothing' \
    'else, structuredClone'\''d. The clone test mutates the SOURCE one level down' \
    'after the build: a shallow pick passes a `!==` check on the outer array and' \
    'still shares every element.' \
    '' \
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
    'Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM' \
    | git commit -F -
  ```

- [ ] **Step 15: Write the failing `impliesKeyCopy` tests.**

  Extend the top import to `import { buildLoopCopyPatch, impliesKeyCopy, LOOP_COPY_GROUPS } from './loopCopy';`
  and append to `src/store/loopCopy.test.ts`:

  ```ts
  describe('impliesKeyCopy', () => {
    const inC: Loop = { ...createDefaultLoop(), id: 'a', scaleRoot: 'C', scaleType: 'Major' };
    const inAMinor: Loop = {
      ...createDefaultLoop(),
      id: 'b',
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
    };

    test('different keys with the chord pattern ticked implies the key copy', () => {
      expect(impliesKeyCopy(inC, inAMinor, ['chord-pattern'])).toBe(true);
    });

    test('a differing scale type alone is enough', () => {
      expect(impliesKeyCopy({ ...inC, scaleType: 'Dorian' }, inC, ['chord-pattern'])).toBe(true);
    });

    test('matching keys imply nothing, so the notice never fires on a no-op', () => {
      expect(impliesKeyCopy(inC, { ...inC, id: 'c' }, ['chord-pattern'])).toBe(false);
    });

    test('without the chord pattern nothing is implied, whatever the keys are', () => {
      expect(impliesKeyCopy(inC, inAMinor, ['lead-sound', 'mix', 'drums-pattern'])).toBe(false);
      expect(impliesKeyCopy(inC, inAMinor, [])).toBe(false);
    });
  });
  ```

- [ ] **Step 16: Run it and watch it fail.**

  ```bash
  bun test src/store/loopCopy.test.ts -t "impliesKeyCopy"
  ```

  Expected failure: `TypeError: impliesKeyCopy is not a function` — 4 fail.

- [ ] **Step 17: Write `impliesKeyCopy`.**

  Append to `src/store/loopCopy.ts`:

  ```ts
  /**
   * The Chords-implies-Key rule as a predicate, so the coupling is testable
   * without a DOM.
   *
   * `chords` is already-derived, ROOTS-spelled note content; scaleRoot/scaleType
   * is the metadata the key badge renders and every later generation resolves
   * against. Copying a progression into a loop in a different key and leaving
   * the key behind makes the badge lie. It is only ever a DEFAULT the dialog
   * ticks — copying a progression into a different key on purpose is a real
   * musical move, so the user may untick it. It says nothing when the keys
   * already match: a notice that fires every time is a notice nobody reads.
   */
  export function impliesKeyCopy(
    source: Loop,
    target: Loop,
    selected: readonly LoopCopyGroupId[],
  ): boolean {
    if (!selected.includes('chord-pattern')) return false;
    return source.scaleRoot !== target.scaleRoot || source.scaleType !== target.scaleType;
  }
  ```

- [ ] **Step 18: Run it and watch it pass.**

  ```bash
  bun test src/store/loopCopy.test.ts
  ```

  Expected: 11 pass, 0 fail.

- [ ] **Step 19: Commit the implication.**

  ```bash
  git add src/store/loopCopy.ts src/store/loopCopy.test.ts
  printf '%s\n' \
    'feat(store): add impliesKeyCopy, the Chords-implies-Key rule as a predicate' \
    '' \
    'True only when chord-pattern is selected AND the two loops'\'' keys actually' \
    'differ, so the dialog'\''s auto-tick and its notice both stay conditional.' \
    '' \
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
    'Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM' \
    | git commit -F -
  ```

---

### Task 9: `applyLoopCopy` — the store action, in its own slice module

**Files:**
- Create: `src/store/loopCopySlice.ts`
- Modify: `src/store/types.ts` (`LoopSlice` gains `applyLoopCopy`)
- Modify: `src/store/store.ts` (compose the new creator beside `createLoopSlice`)
- Test: `src/store/loopCopySlice.test.ts`

**Interfaces:**

- **Consumes:** `buildLoopCopyPatch(source: Loop, selected: readonly LoopCopyGroupId[]): Partial<LoopStatePatch>` and `type LoopCopyGroupId` from `src/store/loopCopy.ts` (Task 8); `loadLoop(id: string, opts?: { atBoundary?: number }): void` from `src/store/loadLoop.ts`; `AppStore`, `Loop`, `LoopSlice` from `src/store/types.ts`; `createDefaultLoop(): Loop` and `DEFAULT_LOOP_ID` from `src/store/loopSlice.ts` (test only); `loopStatePatch(source: object): LoopStatePatch` from `src/store/loop.ts` (test only); `useAppStore` from `src/store/store.ts`.
- **Produces:**
  - `function createLoopCopySlice(set: StoreApi<AppStore>['setState'], get: StoreApi<AppStore>['getState']): Pick<LoopSlice, 'applyLoopCopy'>`
  - on `LoopSlice`: `applyLoopCopy: (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => void`

**Why a new module instead of `loopSlice.ts` — this is not a style preference.**

The active branch must call `loadLoop`, and `loadLoop.ts` imports `./store`, which imports
`./loopSlice`. Adding `import { loadLoop } from './loadLoop'` to `loopSlice.ts` therefore closes
a cycle whose entry point decides whether the app boots. Verified in this repo, not reasoned
about: with that import added, `bun test src/store/loopSlice.test.ts` dies before the first test
with

```
ReferenceError: Cannot access 'DEFAULT_LOOP_ID' before initialization.
      at createDefaultLoop (src/store/loopSlice.ts:29:9)
      at createLoopSlice (src/store/loopSlice.ts:78:13)
      at <anonymous> (src/store/store.ts:387:12)
```

because any file that imports `loopSlice.ts` first (`loopSlice.test.ts`, `loadLoop.test.ts`,
`ArrangeView.test.tsx`, `SortableLoopCard.test.tsx` all do, for `createDefaultLoop`) re-enters
`store.ts` while `loopSlice.ts` is still evaluating its import list, and `store.ts` calls
`createLoopSlice()` at module scope. Every module-level `const` below the import block is in its
temporal dead zone at that moment — `DEFAULT_LOOP_ID` is only the first one it hits;
`DEFAULT_BUS_TRIM_DB` and `DEFAULT_LEAD_GATE` are imported *after* `./loadLoop` would sort and
would fail next. Reordering the import to dodge it makes correctness depend on import order,
which is exactly the kind of trap this repo refuses.

`loopCopySlice.ts` has no module-level `const` at all — only a hoisted `export function` — so
every entry order works. Verified for all three (`loopCopySlice.ts` first, `store.ts` first,
`loopSlice.ts` first). `LoopSlice` still declares `applyLoopCopy`, so the store's public surface
is exactly what the dialog expects; only the file the body lives in moved.

---

- [ ] **Step 1: Declare `applyLoopCopy` on `LoopSlice` and write the failing non-active-branch test.**

  In `src/store/types.ts`, add to the type-only import block at the top (after
  `import type { LeadNote } from '../audio/leadMelody';`):

  ```ts
  import type { LoopCopyGroupId } from './loopCopy';
  ```

  and add the action to `LoopSlice`, directly under `setLoopMix`:

  ```ts
    /**
     * Overwrite the selected copy groups of `targetId` with `sourceId`'s
     * values. Implemented in loopCopySlice.ts rather than loopSlice.ts — see
     * that file's docblock for the import cycle that forces the split.
     */
    applyLoopCopy: (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => void;
  ```

  Create `src/store/loopCopySlice.test.ts`:

  ```ts
  import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
  import { loopStatePatch } from './loop';
  import { createDefaultLoop } from './loopSlice';
  import { SCOPE_NONE } from './playbackScope';
  import { useAppStore } from './store';
  import type { Loop } from './types';

  // applyLoopCopy's active branch runs loadLoop, which mutates the shared
  // singleton store (loops, the flat per-loop slices, activeLoopId, the player
  // states). bun runs every test file in one process without isolation, so
  // restore the default baseline before AND after each test.
  const resetStore = () => {
    const loop = createDefaultLoop();
    useAppStore.setState({
      loops: [loop],
      activeLoopId: loop.id,
      ...loopStatePatch(loop),
      sequencerPlayer: 'stopped',
      chordsPlayer: 'stopped',
      leadPlayer: 'stopped',
      songLoopIndex: null,
      activeTab: 'sound',
      playbackScope: SCOPE_NONE,
    });
  };

  beforeEach(resetStore);
  afterEach(resetStore);

  /** Target 'loop-target' in A Natural Minor; source 'loop-source' in C Major. */
  function seedTwoLoops(activeId: string) {
    const target: Loop = { ...createDefaultLoop(), id: 'loop-target', name: 'Verse' };
    const source: Loop = {
      ...createDefaultLoop(),
      id: 'loop-source',
      name: 'Chorus',
      scaleRoot: 'C',
      scaleType: 'Major',
      chordFeel: 0.9,
      chordOctave: 5,
      bassOctave: 3,
      synthVolume: -3,
    };
    source.sequencerTracks[0].steps[1] = true;
    const active = activeId === target.id ? target : source;
    useAppStore.setState({ loops: [target, source], activeLoopId: activeId, ...loopStatePatch(active) });
    return { target, source };
  }

  describe('applyLoopCopy — target is NOT the active loop', () => {
    test('the patch lands in loops[] and no flat per-loop field moves', () => {
      seedTwoLoops('loop-source');
      const flatBefore = loopStatePatch(useAppStore.getState());

      useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['chord-pattern', 'key']);

      const after = useAppStore.getState();
      const patched = after.loops.find((loop) => loop.id === 'loop-target')!;
      expect(patched.chordFeel).toBe(0.9);
      expect(patched.chordOctave).toBe(5);
      expect(patched.scaleRoot).toBe('C');
      expect(patched.scaleType).toBe('Major');
      // Not selected, so untouched on the target.
      expect(patched.bassOctave).toBe(2);
      expect(patched.synthVolume).toBe(-6);
      // The whole point of this branch: editing a loop you are not on makes no
      // sound, so every flat field is byte-for-byte what it was.
      expect(loopStatePatch(after)).toEqual(flatBefore);
      expect(after.activeLoopId).toBe('loop-source');
    });

    test('neither label field moves in either direction', () => {
      seedTwoLoops('loop-source');
      useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['chord-pattern', 'mix']);
      const after = useAppStore.getState();
      expect(after.loops.find((loop) => loop.id === 'loop-target')!.name).toBe('Verse');
      expect(after.loops.find((loop) => loop.id === 'loop-source')!.name).toBe('Chorus');
    });

    test('an empty selection writes nothing at all', () => {
      seedTwoLoops('loop-source');
      const loopsBefore = useAppStore.getState().loops;
      useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', []);
      expect(useAppStore.getState().loops).toBe(loopsBefore);
    });

    test('copying a loop into itself is a no-op, not a restart', () => {
      seedTwoLoops('loop-source');
      const loopsBefore = useAppStore.getState().loops;
      useAppStore.getState().applyLoopCopy('loop-source', 'loop-source', ['mix']);
      expect(useAppStore.getState().loops).toBe(loopsBefore);
    });
  });
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```bash
  bun test src/store/loopCopySlice.test.ts
  ```

  Expected failure: `TypeError: useAppStore.getState().applyLoopCopy is not a function` on all
  four tests — the type is declared but nothing implements it (and `bun run lint` would also
  report `Property 'applyLoopCopy' is missing` on the store's slice composition).

- [ ] **Step 3: Write `createLoopCopySlice` and compose it into the store.**

  Create `src/store/loopCopySlice.ts`:

  ```ts
  import type { StoreApi } from 'zustand';
  import { loadLoop } from './loadLoop';
  import { buildLoopCopyPatch } from './loopCopy';
  import type { AppStore, LoopSlice } from './types';

  type Set = StoreApi<AppStore>['setState'];
  type Get = StoreApi<AppStore>['getState'];

  /**
   * applyLoopCopy lives here and not in loopSlice.ts because it must call
   * loadLoop, and loadLoop.ts imports ./store, which imports ./loopSlice.
   * Adding that import to loopSlice.ts closes a cycle whose entry order
   * decides whether the app boots: any file importing loopSlice.ts first
   * (loopSlice.test.ts, loadLoop.test.ts, the two Arrange test files) re-enters
   * store.ts mid-evaluation, store.ts calls createLoopSlice() at module scope,
   * and every module-level const below loopSlice.ts's import block is still in
   * its temporal dead zone — it dies on DEFAULT_LOOP_ID. This file declares no
   * module-level const, only a hoisted function, so no entry order can trip it.
   *
   * The two branches mirror setLoopMix's shape; this is not a new idiom, it is
   * the existing one applied to a bigger patch.
   */
  export function createLoopCopySlice(set: Set, get: Get): Pick<LoopSlice, 'applyLoopCopy'> {
    return {
      applyLoopCopy: (targetId, sourceId, selected) => {
        const state = get();
        if (targetId === sourceId || selected.length === 0) return;
        const source = state.loops.find((loop) => loop.id === sourceId);
        const target = state.loops.find((loop) => loop.id === targetId);
        if (!source || !target) return;

        const patch = buildLoopCopyPatch(source, selected);
        const loops = state.loops.map((loop) =>
          loop.id === targetId ? { ...loop, ...patch } : loop,
        );

        // Non-active target: loops[] only. No flat-slice write, no engine
        // contact, nothing audible — a loop you are not on is edited for later
        // use, exactly as setLoopMix treats it. loopMirrorPartial returns null
        // for a partial carrying `loops` alone with no per-loop flat key, so
        // the mirror never reaches in and overwrites the edited loop with the
        // ACTIVE loop's flat state.
        if (targetId !== state.activeLoopId) {
          set({ loops });
          return;
        }

        // Active target. The loops[] write MUST land before loadLoop: loadLoop
        // reads the loop out of the store and copies it into the flat slices,
        // so loading first would load the pre-copy content and then mirror it
        // back over the patch. Calling loadLoop with the already-active id is
        // intended — the id has not moved, the CONTENT behind it has, and
        // loadLoop's default path (capture -> hardStopAll -> cut the queued
        // accompaniment -> write the flat slices -> commitRestartAfterStop) is
        // exactly the protocol for that. Reimplementing any part of it here
        // would create a second place that has to stay correct.
        set({ loops });
        loadLoop(targetId);
      },
    };
  }
  ```

  In `src/store/store.ts`, add the import beside the existing loop-slice import:

  ```ts
  import { createLoopSlice } from './loopSlice';
  import { createLoopCopySlice } from './loopCopySlice';
  ```

  and compose it in the slice spread:

  ```ts
          ...createLoopSlice(setWithLoopMirror, get),
          ...createLoopCopySlice(setWithLoopMirror, get),
          ...createProjectSlice(setWithLoopMirror, get, projectStore),
  ```

- [ ] **Step 4: Run it and watch it pass.**

  ```bash
  bun test src/store/loopCopySlice.test.ts
  ```

  Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit the non-active branch.**

  ```bash
  git add src/store/loopCopySlice.ts src/store/loopCopySlice.test.ts src/store/types.ts src/store/store.ts
  printf '%s\n' \
    'feat(store): add applyLoopCopy, the non-active-target branch' \
    '' \
    'loops[] only, no flat-slice write, nothing audible — the same treatment' \
    'setLoopMix gives a loop you are not editing. Lives in loopCopySlice.ts and' \
    'not loopSlice.ts: the action needs loadLoop, and importing loadLoop into' \
    'loopSlice.ts closes a cycle that dies on DEFAULT_LOOP_ID'\''s temporal dead zone' \
    'whenever loopSlice.ts is the module-graph entry, which four test files make' \
    'it. See the file'\''s docblock.' \
    '' \
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
    'Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM' \
    | git commit -F -
  ```

- [ ] **Step 6: Write the failing active-branch test, including the write-order property.**

  Append to `src/store/loopCopySlice.test.ts`:

  ```ts
  describe('applyLoopCopy — target IS the active loop', () => {
    test('the flat slices and loops[] agree on every copied key afterwards', () => {
      seedTwoLoops('loop-target');
      expect(useAppStore.getState().scaleRoot).toBe('A');

      useAppStore
        .getState()
        .applyLoopCopy('loop-target', 'loop-source', ['chord-pattern', 'key', 'drums-pattern']);

      const after = useAppStore.getState();
      const patched = after.loops.find((loop) => loop.id === 'loop-target')!;
      // loops[] took the patch...
      expect(patched.scaleRoot).toBe('C');
      expect(patched.chordFeel).toBe(0.9);
      expect(patched.sequencerTracks[0].steps[1]).toBe(true);
      // ...and loadLoop mirrored it into the flat slices the engine reads.
      expect(after.scaleRoot).toBe('C');
      expect(after.chordFeel).toBe(0.9);
      expect(after.sequencerTracks[0].steps[1]).toBe(true);
      expect(loopStatePatch(after)).toEqual(loopStatePatch(patched));
      expect(after.activeLoopId).toBe('loop-target');
    });

    test('the copy survives the loadLoop round trip — the write order, asserted', () => {
      seedTwoLoops('loop-target');
      // Written the other way round (loadLoop first, loops[] second) this
      // reads back the PRE-copy value: loadLoop copies the stored loop into
      // the flat slices, so the patch would be loaded over and then mirrored
      // back. 0.5 is the default chordFeel; 0.9 is the source's.
      useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['chord-pattern']);
      expect(useAppStore.getState().chordFeel).toBe(0.9);
      expect(useAppStore.getState().loops.find((loop) => loop.id === 'loop-target')!.chordFeel).toBe(0.9);
    });

    test('the deep clone holds across the store write', () => {
      const { source } = seedTwoLoops('loop-target');
      useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['drums-pattern']);
      const stored = useAppStore.getState().loops.find((loop) => loop.id === 'loop-target')!;
      expect(stored.sequencerTracks).not.toBe(source.sequencerTracks);
      expect(stored.sequencerTracks[0]).not.toBe(source.sequencerTracks[0]);
    });

    test('neither label field moves on the active branch either', () => {
      seedTwoLoops('loop-target');
      useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['chord-pattern', 'mix']);
      const after = useAppStore.getState();
      expect(after.loops.find((loop) => loop.id === 'loop-target')!.name).toBe('Verse');
      expect(after.loops.find((loop) => loop.id === 'loop-source')!.name).toBe('Chorus');
    });
  });
  ```

- [ ] **Step 7: Run it and watch it fail.**

  ```bash
  bun test src/store/loopCopySlice.test.ts -t "target IS the active loop"
  ```

  Expected failure: the implementation from Step 3 already takes the active branch, so this
  passes — **if it does not**, the failure is `expect(received).toBe(expected)` on
  `after.scaleRoot`, received `"A"`, meaning `loadLoop` ran before the `set({ loops })`. Run it,
  read the result, and if all four pass go straight to Step 8; the four tests are here to pin the
  order property against a later refactor, and a test that passes on first run is the correct
  outcome for a property the previous step already had to satisfy.

- [ ] **Step 8: Verify the whole store suite is still green.**

  ```bash
  bun test src/store/
  ```

  Expected: every file passes, including `loopSlice.test.ts`, `loadLoop.test.ts` and
  `store.test.ts` — the three most likely to expose an import-cycle regression from Step 3.

- [ ] **Step 9: Commit the active branch.**

  ```bash
  git add src/store/loopCopySlice.test.ts
  printf '%s\n' \
    'test(store): pin applyLoopCopy'\''s active branch and its write order' \
    '' \
    'loops[] is written BEFORE loadLoop, because loadLoop reads the loop out of' \
    'the store to fill the flat slices — the other order loads the pre-copy' \
    'content and mirrors it back over the patch. Asserted as a value, not as a' \
    'comment.' \
    '' \
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
    'Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM' \
    | git commit -F -
  ```

---

### Task 10: `src/components/song/LoopCopyDialog.tsx` — the dialog

**Files:**
- Create: `src/components/song/LoopCopyDialog.tsx`
- Test: `src/components/song/LoopCopyDialog.test.tsx`

**Interfaces:**

- **Consumes:** `LOOP_COPY_GROUPS: readonly LoopCopyGroup[]`, `LoopCopyGroup { id, track, aspect, label, keys }`, `LoopCopyGroupId`, `LoopCopyTrack`, `impliesKeyCopy(source, target, selected): boolean` from `src/store/loopCopy.ts` (Task 8); `loopBars(chords: readonly { bars?: number }[]): number` from `src/store/loop.ts`; `getTonicSpelling(rootNote: string, scaleType: string): string` from `src/utils/noteSpelling.ts`; `Modal` with props `{ open, onClose, title, size?: 'sm'|'md'|'lg', headerDivider?, boxClassName?, children }` from `src/components/ui/Modal.tsx`; `Loop` from `src/store/types.ts`; `createDefaultLoop(): Loop` from `src/store/loopSlice.ts` (test only).
- **Produces:**
  - `type LoopCopyQuickChip = 'sounds' | 'patterns' | 'everything'`
  - `function quickChipSelection(chip: LoopCopyQuickChip): LoopCopyGroupId[]`
  - `function withImpliedKey(source: Loop, target: Loop, next: readonly LoopCopyGroupId[]): LoopCopyGroupId[]`
  - `function loopCopySourceOption(loop: Loop, label: string): string`
  - `function loopCopySummary(selected: readonly LoopCopyGroupId[]): string`
  - `function loopKeyNotice(source: Loop, target: Loop, selected: readonly LoopCopyGroupId[]): string | null`
  - `function loopBarsNotice(source: Loop, target: Loop, selected: readonly LoopCopyGroupId[]): string | null`
  - `interface LoopCopyDialogProps { open: boolean; targetId: string; loops: readonly Loop[]; labels: Readonly<Record<string, string>>; onApply: (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => void; onClose: () => void }`
  - `function LoopCopyDialog(props: LoopCopyDialogProps): JSX.Element | null`

**Two shaping decisions, on the record.**

*The dialog takes `loops` and `labels` as props rather than reading the store.* The spec allows
either, and props are what the repo's test conventions make testable: zustand wires
`getServerSnapshot` to the store's creation-time state, so a `useAppStore.setState` before a
`renderToString` is silently invisible unless the component serves `getState()` for both
snapshots the way `ui/BottomInputDock.tsx` does. `ArrangeView` already subscribes to `loops`,
already resolves `loopLabel` for the card's `label` prop, and already holds the open/closed
state, so handing both down costs nothing and makes every test a plain prop render.

*Every rule is a pure exported helper, and the component only wires them.* That is the repo's
stated preference ("if a behaviour can be extracted into a pure function, extract it and test the
function") and the only way to test a quick chip at all — there is no DOM and no testing-library
in this repo, so a click cannot be simulated.

---

- [ ] **Step 1: Write the failing pure-helper tests.**

  Create `src/components/song/LoopCopyDialog.test.tsx`:

  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { createDefaultLoop } from '@/store/loopSlice';
  import { LOOP_COPY_GROUPS } from '@/store/loopCopy';
  import type { Loop } from '@/store/types';
  import {
    loopBarsNotice,
    loopCopySourceOption,
    loopCopySummary,
    loopKeyNotice,
    quickChipSelection,
    withImpliedKey,
  } from './LoopCopyDialog';

  const inAMinor = (): Loop => ({ ...createDefaultLoop(), id: 'loop-target', name: 'Verse' });
  const inCMajor = (): Loop => ({
    ...createDefaultLoop(),
    id: 'loop-source',
    name: 'Chorus',
    scaleRoot: 'C',
    scaleType: 'Major',
  });

  describe('quickChipSelection', () => {
    test('All sounds ticks the five Sound cells and nothing else', () => {
      expect(new Set(quickChipSelection('sounds'))).toEqual(
        new Set(['lead-sound', 'chord-sound', 'bass-sound', 'pad-sound', 'drums-sound']),
      );
    });

    test('All patterns ticks the five Pattern cells and nothing else', () => {
      expect(new Set(quickChipSelection('patterns'))).toEqual(
        new Set(['lead-pattern', 'chord-pattern', 'bass-pattern', 'pad-pattern', 'drums-pattern']),
      );
    });

    test('Everything ticks all twelve groups', () => {
      expect(new Set(quickChipSelection('everything'))).toEqual(
        new Set(LOOP_COPY_GROUPS.map((group) => group.id)),
      );
    });

    test('the two loop-wide groups are in neither column chip', () => {
      expect(quickChipSelection('sounds')).not.toContain('key');
      expect(quickChipSelection('sounds')).not.toContain('mix');
      expect(quickChipSelection('patterns')).not.toContain('key');
      expect(quickChipSelection('patterns')).not.toContain('mix');
    });
  });

  describe('withImpliedKey', () => {
    test('adds key when the chord pattern crosses a key boundary', () => {
      expect(withImpliedKey(inCMajor(), inAMinor(), ['chord-pattern'])).toEqual([
        'chord-pattern',
        'key',
      ]);
    });

    test('adds nothing when the two loops are already in the same key', () => {
      const source = { ...inCMajor(), id: 'loop-source' };
      const target = { ...inCMajor(), id: 'loop-target' };
      expect(withImpliedKey(source, target, ['chord-pattern'])).toEqual(['chord-pattern']);
    });

    test('never adds key twice', () => {
      expect(withImpliedKey(inCMajor(), inAMinor(), ['chord-pattern', 'key'])).toEqual([
        'chord-pattern',
        'key',
      ]);
    });

    test('a quick chip runs through the same rule', () => {
      const next = withImpliedKey(inCMajor(), inAMinor(), quickChipSelection('patterns'));
      expect(next).toContain('key');
    });
  });

  describe('the two notices are conditional', () => {
    test('the key notice names both keys when they differ', () => {
      expect(loopKeyNotice(inCMajor(), inAMinor(), ['chord-pattern', 'key'])).toBe(
        'Key / Scale added: the source is in C Major, this loop is in A Natural Minor.',
      );
    });

    test('the key notice is silent when the keys match', () => {
      const source = { ...inCMajor(), id: 'loop-source' };
      const target = { ...inCMajor(), id: 'loop-target' };
      expect(loopKeyNotice(source, target, ['chord-pattern', 'key'])).toBeNull();
    });

    test('the bar notice states the concrete consequence', () => {
      const source = inCMajor();
      source.chords = [...source.chords, ...source.chords];
      expect(loopBarsNotice(source, inAMinor(), ['chord-pattern'])).toBe(
        'This loop becomes 8 bars, was 4.',
      );
    });

    test('the bar notice is silent when the lengths match', () => {
      expect(loopBarsNotice(inCMajor(), inAMinor(), ['chord-pattern'])).toBeNull();
    });

    test('the bar notice is silent when the chord pattern is not ticked', () => {
      const source = inCMajor();
      source.chords = [...source.chords, ...source.chords];
      expect(loopBarsNotice(source, inAMinor(), ['lead-sound', 'mix'])).toBeNull();
    });
  });

  describe('the source option and the details summary', () => {
    test('an option states the label, the key and the bar count', () => {
      expect(loopCopySourceOption(inCMajor(), 'Chorus')).toBe('Chorus — C Major · 4 bars');
    });

    test('the summary always states what is currently ticked', () => {
      expect(loopCopySummary(['lead-sound', 'chord-pattern', 'key'])).toBe(
        'Lead sound, Chords pattern, Key / Scale',
      );
    });

    test('the summary says so when nothing is ticked', () => {
      expect(loopCopySummary([])).toBe('nothing selected');
    });
  });
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```bash
  bun test src/components/song/LoopCopyDialog.test.tsx
  ```

  Expected failure: `error: Cannot find module './LoopCopyDialog' from '/Users/Pathompong/Sites/Personal/solna/src/components/song/LoopCopyDialog.test.tsx'`.

- [ ] **Step 3: Write the pure helpers.**

  Create `src/components/song/LoopCopyDialog.tsx` with the helpers only (the component follows in
  Step 6):

  ```tsx
  import { useState } from 'react';
  import { Info } from 'lucide-react';
  import { loopBars } from '@/store/loop';
  import { impliesKeyCopy, LOOP_COPY_GROUPS } from '@/store/loopCopy';
  import type { LoopCopyAspect, LoopCopyGroupId, LoopCopyTrack } from '@/store/loopCopy';
  import type { Loop } from '@/store/types';
  import { getTonicSpelling } from '@/utils/noteSpelling';
  import { Modal } from '../ui/Modal';

  export type LoopCopyQuickChip = 'sounds' | 'patterns' | 'everything';

  /**
   * A quick chip TICKS the matrix; it is not a separate mode. Quick and
   * detailed are one selection state with two ways in, so a chip can be
   * followed by a manual untick with no mode to leave. Derived from
   * LOOP_COPY_GROUPS by aspect, so a thirteenth group joins the right chip
   * without a second list being edited.
   */
  export function quickChipSelection(chip: LoopCopyQuickChip): LoopCopyGroupId[] {
    if (chip === 'everything') return LOOP_COPY_GROUPS.map((group) => group.id);
    const aspect: LoopCopyAspect = chip === 'sounds' ? 'sound' : 'pattern';
    return LOOP_COPY_GROUPS.filter((group) => group.aspect === aspect).map((group) => group.id);
  }

  /**
   * The Chords-implies-Key rule applied to a candidate selection. A DEFAULT the
   * user may then untick, never a lock — copying a progression into a different
   * key on purpose is a real musical move.
   */
  export function withImpliedKey(
    source: Loop,
    target: Loop,
    next: readonly LoopCopyGroupId[],
  ): LoopCopyGroupId[] {
    if (next.includes('key') || !impliesKeyCopy(source, target, next)) return [...next];
    return [...next, 'key'];
  }

  const keyName = (loop: Loop) =>
    `${getTonicSpelling(loop.scaleRoot, loop.scaleType)} ${loop.scaleType}`;

  const barCount = (bars: number) => `${bars} bar${bars === 1 ? '' : 's'}`;

  /**
   * A From option states the key and the bar count — the two facts that decide
   * whether the copy will surprise you, visible before the pick rather than
   * after. `label` is loopLabel(loop), resolved by the caller, so an unnamed
   * loop reads as `Synthwave 80s — C Major · 8 bars` rather than as a blank
   * followed by two facts about nothing.
   */
  export function loopCopySourceOption(loop: Loop, label: string): string {
    return `${label} — ${keyName(loop)} · ${barCount(loopBars(loop.chords))}`;
  }

  /**
   * The collapsed Details summary. It always states what is currently ticked,
   * so a quick chip is never a black box — the collapsed state still tells you
   * what Apply will do.
   */
  export function loopCopySummary(selected: readonly LoopCopyGroupId[]): string {
    const labels = LOOP_COPY_GROUPS.filter((group) => selected.includes(group.id)).map(
      (group) => group.label,
    );
    return labels.length === 0 ? 'nothing selected' : labels.join(', ');
  }

  /** Null unless the copy actually crosses a key boundary — see impliesKeyCopy. */
  export function loopKeyNotice(
    source: Loop,
    target: Loop,
    selected: readonly LoopCopyGroupId[],
  ): string | null {
    if (!impliesKeyCopy(source, target, selected)) return null;
    return `Key / Scale added: the source is in ${keyName(source)}, this loop is in ${keyName(target)}.`;
  }

  /**
   * loopBars(chords) IS the loop's length in the arrangement, so copying a
   * progression stretches or shrinks this loop inside the song. Null when the
   * lengths match: a notice that fires every time is a notice nobody reads.
   */
  export function loopBarsNotice(
    source: Loop,
    target: Loop,
    selected: readonly LoopCopyGroupId[],
  ): string | null {
    if (!selected.includes('chord-pattern')) return null;
    const next = loopBars(source.chords);
    const now = loopBars(target.chords);
    if (next === now) return null;
    return `This loop becomes ${barCount(next)}, was ${now}.`;
  }
  ```

  > **Superseded by 6ac0aab** (the branch's last commit): the shipped
  > `loopKeyNotice` additionally requires `selected.includes('key')` before
  > checking `impliesKeyCopy` — the version above still shows the notice
  > after the user manually unticks 'key'. See the fix's own comment in
  > `src/components/song/LoopCopyDialog.tsx`.

- [ ] **Step 4: Run it and watch it pass.**

  ```bash
  bun test src/components/song/LoopCopyDialog.test.tsx
  ```

  Expected: 15 pass, 0 fail.

- [ ] **Step 5: Commit the rules.**

  ```bash
  git add src/components/song/LoopCopyDialog.tsx src/components/song/LoopCopyDialog.test.tsx
  printf '%s\n' \
    'feat(song): add the loop-copy dialog'\''s rules as pure helpers' \
    '' \
    'Quick chips derive their columns from LOOP_COPY_GROUPS by aspect rather than' \
    'from a second hand-written list; both notices return null unless they' \
    'actually apply. Pure so they are testable without a DOM — this repo has' \
    'neither a DOM nor testing-library, so a chip click cannot be simulated.' \
    '' \
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
    'Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM' \
    | git commit -F -
  ```

- [ ] **Step 6: Write the failing rendered-markup tests.**

  Append to `src/components/song/LoopCopyDialog.test.tsx`, and extend its imports with
  `import { renderToString } from 'react-dom/server';` and `LoopCopyDialog` in the existing
  `./LoopCopyDialog` import:

  ```tsx
  const noop = () => {};

  function renderDialog() {
    const target = inAMinor();
    const source = inCMajor();
    return renderToString(
      <LoopCopyDialog
        open
        targetId="loop-target"
        loops={[target, source]}
        labels={{ 'loop-target': 'Verse', 'loop-source': 'Chorus' }}
        onApply={noop}
        onClose={noop}
      />,
    );
  }

  describe('LoopCopyDialog markup', () => {
    test('Apply is disabled while nothing is ticked', () => {
      expect(renderDialog()).toMatch(/id="btn-loop-copy-apply"[^>]*disabled=""/);
    });

    test('the title names the target through the resolved label', () => {
      expect(renderDialog()).toContain('Copy into &quot;Verse&quot;');
    });

    test('the From list excludes the target loop', () => {
      const html = renderDialog();
      // The first source is pre-selected, so React's SSR puts `selected=""`
      // on it — asserted as one literal so the value and the text are proven
      // to sit on the same element.
      expect(html).toContain(
        '<option value="loop-source" selected="">Chorus — C Major · 4 bars</option>',
      );
      expect(html).not.toContain('value="loop-target"');
    });

    test('all twelve group checkboxes are rendered, unchecked', () => {
      const html = renderDialog();
      for (const group of LOOP_COPY_GROUPS) {
        expect(html).toContain(`id="chk-loop-copy-${group.id}"`);
      }
      expect(html).not.toContain('checked=""');
    });

    test('the three quick chips are rendered', () => {
      const html = renderDialog();
      expect(html).toContain('id="btn-loop-copy-chip-sounds"');
      expect(html).toContain('id="btn-loop-copy-chip-patterns"');
      expect(html).toContain('id="btn-loop-copy-chip-everything"');
    });

    test('the summary line reports the empty selection, and neither notice renders', () => {
      const html = renderDialog();
      expect(html).toContain('Details — nothing selected');
      // Nothing is ticked at first render, so neither notice applies. Their
      // conditionality is asserted on loopKeyNotice/loopBarsNotice above:
      // there is no DOM here, so a tick cannot be simulated.
      expect(html).not.toContain('Key / Scale added');
      expect(html).not.toContain('This loop becomes');
    });

    test('names roles, never colours', () => {
      const html = renderDialog();
      expect(html).not.toContain('indigo-');
      expect(html).not.toContain('text-white');
      expect(html).not.toContain('rgba(');
      expect(html).not.toContain('bg-black');
      expect(html).not.toContain('dark:');
    });

    test('renders nothing when the project holds only the target loop', () => {
      const html = renderToString(
        <LoopCopyDialog
          open
          targetId="loop-target"
          loops={[inAMinor()]}
          labels={{ 'loop-target': 'Verse' }}
          onApply={noop}
          onClose={noop}
        />,
      );
      expect(html).toBe('');
    });
  });
  ```

- [ ] **Step 7: Run it and watch it fail.**

  ```bash
  bun test src/components/song/LoopCopyDialog.test.tsx
  ```

  Expected failure: `TypeError: Element type is invalid` / `LoopCopyDialog is not a function` — 8
  new tests fail; the 15 helper tests still pass.

- [ ] **Step 8: Write the component.**

  Append to `src/components/song/LoopCopyDialog.tsx`:

  ```tsx
  /** The matrix's row labels. The GROUPING still lives only in
   *  LOOP_COPY_GROUPS; this is the display name of a row, not a membership. */
  const TRACK_ROWS: readonly { track: LoopCopyTrack; label: string }[] = [
    { track: 'lead', label: 'Lead' },
    { track: 'chord', label: 'Chords' },
    { track: 'bass', label: 'Bass' },
    { track: 'pad', label: 'Pad' },
    { track: 'drums', label: 'Drums' },
  ];

  const QUICK_CHIPS: readonly { kind: LoopCopyQuickChip; label: string }[] = [
    { kind: 'sounds', label: 'All sounds' },
    { kind: 'patterns', label: 'All patterns' },
    { kind: 'everything', label: 'Everything' },
  ];

  const groupAt = (track: LoopCopyTrack, aspect: LoopCopyAspect) =>
    LOOP_COPY_GROUPS.find((group) => group.track === track && group.aspect === aspect);

  const LOOP_WIDE_GROUPS = LOOP_COPY_GROUPS.filter((group) => group.track === 'loop');

  export interface LoopCopyDialogProps {
    open: boolean;
    /** The loop being copied INTO. Pull, not push: the loop in view is the destination. */
    targetId: string;
    loops: readonly Loop[];
    /** loopLabel(loop) per loop id, resolved by ArrangeView — the dialog never
     *  reads loop.name or loop.tempName itself. */
    labels: Readonly<Record<string, string>>;
    onApply: (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => void;
    onClose: () => void;
  }

  /**
   * Pick a source loop, tick which parts to take, Apply overwrites those parts
   * of the target. A dumb view: it imports no engine, holds all of its
   * selection state locally (transient UI belongs nowhere near a slice, least
   * of all a persisted one) and takes its data and both callbacks as props.
   *
   * No confirmation on top and no toast: the dialog and its Apply button ARE
   * the confirmation, and the result is immediately visible on the target card
   * — bar badge, key badge, chord strip, mixer strip.
   */
  export function LoopCopyDialog({
    open,
    targetId,
    loops,
    labels,
    onApply,
    onClose,
  }: LoopCopyDialogProps) {
    const sources = loops.filter((loop) => loop.id !== targetId);
    const [sourceId, setSourceId] = useState(() => sources[0]?.id ?? '');
    const [selected, setSelected] = useState<LoopCopyGroupId[]>([]);

    const target = loops.find((loop) => loop.id === targetId);
    const source = sources.find((loop) => loop.id === sourceId) ?? sources[0];
    if (!target || !source) return null;

    const toggle = (id: LoopCopyGroupId) =>
      setSelected((prev) =>
        prev.includes(id)
          ? prev.filter((group) => group !== id)
          : withImpliedKey(source, target, [...prev, id]),
      );
    // Superseded by 6ac0aab and the round-2 review fix that followed it: the
    // shipped toggle() only re-derives withImpliedKey when `id ===
    // 'chord-pattern'` (the box that drives the rule) — the version above
    // reruns it for ANY newly-ticked group, so ticking something else after
    // the user explicitly unticks 'key' silently re-adds it. See the fix's
    // own comment in src/components/song/LoopCopyDialog.tsx.

    const keyNotice = loopKeyNotice(source, target, selected);
    const barsNotice = loopBarsNotice(source, target, selected);

    const checkbox = (id: LoopCopyGroupId, label: string) => (
      <input
        id={`chk-loop-copy-${id}`}
        type="checkbox"
        aria-label={label}
        checked={selected.includes(id)}
        onChange={() => toggle(id)}
        className="checkbox checkbox-xs checkbox-primary"
      />
    );

    return (
      <Modal
        open={open}
        onClose={onClose}
        title={`Copy into "${labels[targetId] ?? ''}"`}
        size="lg"
        boxClassName="space-y-4"
      >
        <label className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/50">
            From
          </span>
          <select
            id="select-loop-copy-source"
            aria-label="Copy from loop"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="select select-sm select-bordered flex-1 text-xs"
          >
            {sources.map((loop) => (
              <option key={loop.id} value={loop.id}>
                {loopCopySourceOption(loop, labels[loop.id] ?? '')}
              </option>
            ))}
          </select>
        </label>
        {/*
          Superseded by 6ac0aab: the shipped onChange also re-derives
          withImpliedKey against the NEW source loop
          (setSelected((prev) => withImpliedKey(nextSource, target, prev))),
          so a source change re-applies the chords-implies-key rule. The
          version above leaves an auto-ticked 'key' judged against the STALE
          source once the source select changes.
        */}

        <div className="flex flex-wrap gap-2">
          {QUICK_CHIPS.map(({ kind, label }) => (
            <button
              key={kind}
              id={`btn-loop-copy-chip-${kind}`}
              type="button"
              onClick={() => setSelected(withImpliedKey(source, target, quickChipSelection(kind)))}
              className="btn btn-xs btn-outline btn-primary"
            >
              {label}
            </button>
          ))}
        </div>

        <details className="rounded-box border border-base-300 bg-base-200/40">
          <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-base-content/70">
            Details — {loopCopySummary(selected)}
          </summary>
          <div className="space-y-3 p-3">
            <div className="grid grid-cols-[1fr_4rem_4rem] items-center gap-y-1 text-xs">
              <span />
              <span className="text-center text-[10px] font-bold uppercase tracking-wider text-base-content/50">
                Sound
              </span>
              <span className="text-center text-[10px] font-bold uppercase tracking-wider text-base-content/50">
                Pattern
              </span>
              {TRACK_ROWS.map(({ track, label }) => {
                const sound = groupAt(track, 'sound');
                const pattern = groupAt(track, 'pattern');
                return (
                  <React.Fragment key={track}>
                    <span className="font-semibold text-base-content">{label}</span>
                    <span className="text-center">{sound && checkbox(sound.id, sound.label)}</span>
                    <span className="text-center">
                      {pattern && checkbox(pattern.id, pattern.label)}
                    </span>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="space-y-1 border-t border-base-300 pt-3 text-xs">
              {LOOP_WIDE_GROUPS.map((group) => (
                <div key={group.id} className="flex items-center gap-2">
                  {checkbox(group.id, group.label)}
                  <span className="font-semibold text-base-content">{group.label}</span>
                </div>
              ))}
            </div>
          </div>
        </details>

        {keyNotice && (
          <p className="flex items-start gap-1.5 text-xs text-info">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {keyNotice}
          </p>
        )}
        {barsNotice && (
          <p className="flex items-start gap-1.5 text-xs text-info">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {barsNotice}
          </p>
        )}

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            id="btn-loop-copy-apply"
            type="button"
            disabled={selected.length === 0}
            onClick={() => {
              onApply(targetId, source.id, selected);
              onClose();
            }}
            className="btn btn-primary"
          >
            Apply
          </button>
        </div>
      </Modal>
    );
  }
  ```

  Add `React` to the file's first import so `React.Fragment` resolves:
  `import React, { useState } from 'react';`

- [ ] **Step 9: Run it and watch it pass.**

  ```bash
  bun test src/components/song/LoopCopyDialog.test.tsx
  ```

  Expected: 23 pass, 0 fail.

- [ ] **Step 10: Check the type and theme gates on the new file.**

  ```bash
  bun run lint && bun run eslint && bun run check:theme
  ```

  Expected: `tsc --noEmit` clean, eslint reports nothing at all (no errors AND no warnings), the
  theme-token suite passes.

  If `complexity` warns on `LoopCopyDialog`, extract the matrix grid into a local
  `<CopyMatrix …>` component in the same file rather than adding a line disable — the disable is
  for a rule with a legitimate exception, and "this form got long" is not one.

- [ ] **Step 11: Commit the dialog.**

  ```bash
  git add src/components/song/LoopCopyDialog.tsx src/components/song/LoopCopyDialog.test.tsx
  printf '%s\n' \
    'feat(song): add LoopCopyDialog' \
    '' \
    'A twelve-checkbox matrix on the shared ui/Modal at size="lg", laid out from' \
    'LOOP_COPY_GROUPS'\'' own track/aspect fields rather than from a second list.' \
    'Quick chips tick the matrix instead of being a mode, the collapsed Details' \
    'summary always states what is ticked, both notices render only when they' \
    'apply, and Apply is disabled while nothing is ticked.' \
    '' \
    'Data and callbacks come in as props: zustand serves renderToString the' \
    'store'\''s creation-time state, so a store-reading dialog would be untestable' \
    'without the BottomInputDock live-snapshot pattern, and ArrangeView already' \
    'holds everything it needs.' \
    '' \
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
    'Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM' \
    | git commit -F -
  ```

---

### Task 11: Wire `Copy into…` onto the card and mount one dialog in `ArrangeView`

**Files:**
- Modify: `src/components/song/SortableLoopCard.tsx`
- Modify: `src/components/song/ArrangeView.tsx`
- Test: `src/components/song/SortableLoopCard.test.tsx`, `src/components/song/ArrangeView.test.tsx`

**Interfaces:**

- **Consumes:** `LoopCopyDialog` and `LoopCopyDialogProps { open, targetId, loops, labels, onApply, onClose }` from `src/components/song/LoopCopyDialog.tsx` (Task 10); `applyLoopCopy: (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => void` off `useAppStore` (Task 9); `LoopCopyGroupId` from `src/store/loopCopy.ts` (Task 8); `loopLabel(loop: Pick<Loop, 'name' | 'tempName'>): string` from `src/store/loop.ts` (Task 1-7); `SortableLoopCardProps` including its existing `label: string` and `totalLoops: number` (Task 1-7).
- **Produces:** on `SortableLoopCardProps`: `onCopyInto: (id: string) => void`; in the rendered card, `id={`btn-loop-copy-into-${loop.id}`}`; in `ArrangeView`, local state `copyTargetId: string | null` and a single mounted `LoopCopyDialog`.

---

- [ ] **Step 1: Write the failing card-button test.**

  Append to `src/components/song/SortableLoopCard.test.tsx` (its existing imports already carry
  `renderToString`, `createDefaultLoop` and `SortableLoopCard`):

  ```tsx
  describe('the Copy into… button', () => {
    const noop = () => {};

    const renderCard = (totalLoops: number) =>
      renderToString(
        <SortableLoopCard
          loop={createDefaultLoop()}
          label="Verse"
          index={0}
          totalLoops={totalLoops}
          isPlaying={false}
          isActive
          onSelect={noop}
          onEdit={noop}
          onDuplicate={noop}
          onDelete={noop}
          onCopyInto={noop}
          onReorder={noop}
          onRename={noop}
          onSetRepeat={noop}
          onTogglePlayLoop={noop}
          onSetMix={noop}
        />,
      );

    test('renders beside Duplicate, labelled through the resolved loop label', () => {
      const html = renderCard(3);
      expect(html).toContain('id="btn-loop-copy-into-loop-default-1"');
      expect(html).toContain('aria-label="Copy parts into Verse"');
      // Duplicate stays exactly where it is: the two gestures must read as
      // different at a glance — one makes a new loop, the other changes this one.
      expect(html).toContain('id="btn-loop-duplicate-loop-default-1"');
    });

    test('is disabled when the project holds one loop — there is no source', () => {
      expect(renderCard(1)).toMatch(/id="btn-loop-copy-into-loop-default-1"[^>]*disabled=""/);
    });

    test('is enabled once a second loop exists', () => {
      expect(renderCard(2)).not.toMatch(/id="btn-loop-copy-into-loop-default-1"[^>]*disabled=""/);
    });

    test('the card itself never mounts a dialog', () => {
      expect(renderCard(3)).not.toContain('btn-loop-copy-apply');
    });
  });
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```bash
  bun test src/components/song/SortableLoopCard.test.tsx -t "Copy into"
  ```

  Expected failure: `expect(received).toContain(expected)` — the rendered card contains no
  `btn-loop-copy-into-loop-default-1`; three of the four fail (the dialog-absence one passes
  vacuously).

- [ ] **Step 3: Add the prop and the button to the card.**

  In `src/components/song/SortableLoopCard.tsx`, add `ClipboardPaste` to the `lucide-react`
  import (it sits between `Check` and `Copy` alphabetically):

  ```tsx
    Check,
    ClipboardPaste,
    Copy,
  ```

  Add the prop to `SortableLoopCardProps`, directly under `onDuplicate`:

  ```ts
    /** Opens the shared copy dialog with this loop as the TARGET. Pull, not
     *  push: a misclick damages exactly the loop you are looking at. */
    onCopyInto: (id: string) => void;
  ```

  Destructure it in the component signature, under `onDuplicate,`:

  ```tsx
      onCopyInto,
  ```

  And render the button in the action row, immediately after the Duplicate button and before
  Delete:

  ```tsx
                <button
                  id={`btn-loop-copy-into-${loop.id}`}
                  type="button"
                  aria-label={`Copy parts into ${label}`}
                  disabled={totalLoops <= 1}
                  onClick={() => onCopyInto(loop.id)}
                  className="btn btn-xs btn-square btn-ghost text-base-content/70 hover:text-base-content disabled:opacity-30"
                  title="Copy parts from another loop"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                </button>
  ```

- [ ] **Step 4: Run it and watch it pass.**

  ```bash
  bun test src/components/song/SortableLoopCard.test.tsx
  ```

  Expected: the whole file passes, including the four new tests.

- [ ] **Step 5: Commit the card button.**

  ```bash
  git add src/components/song/SortableLoopCard.tsx src/components/song/SortableLoopCard.test.tsx
  printf '%s\n' \
    'feat(song): add the Copy into… button to the Arrange card' \
    '' \
    'One new button beside Duplicate, following the row'\''s existing id convention' \
    'and disabled at totalLoops <= 1 the same way Delete is — with one loop there' \
    'is no source to copy from. The card gains exactly one prop for the gesture;' \
    'the dialog is mounted once by ArrangeView, never per card.' \
    '' \
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
    'Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM' \
    | git commit -F -
  ```

- [ ] **Step 6: Write the failing `ArrangeView` test.**

  Append to `src/components/song/ArrangeView.test.tsx`, inside the existing
  `describe('ArrangeView', …)` block:

  ```tsx
    test('every card offers Copy into…, and the dialog is mounted once, closed', () => {
      const html = renderToString(<ArrangeView />);
      expect(html).toContain('id="btn-loop-copy-into-loop-default-1"');
      // Every card is mounted simultaneously inside the SortableContext, so a
      // per-card dialog would mount a full twelve-checkbox form per loop and
      // re-render all of them on every tick of the arrange playhead. One
      // dialog, held by copyTargetId, and it is closed until a card asks.
      expect(html).not.toContain('btn-loop-copy-apply');
      expect(html).not.toContain('select-loop-copy-source');
    });
  ```

  Note on why this asserts against the single default loop rather than a seeded three-loop list:
  `ArrangeView` reads `loops` through a plain `useAppStore(selector)`, and zustand serves
  `renderToString` the store's **creation-time** state, so the `useAppStore.setState` in this
  file's `resetStore` is invisible to the render. Every existing assertion here is likewise about
  the one default loop; the multi-loop shape of the dialog is covered by `LoopCopyDialog`'s own
  prop-driven tests in Task 10.

- [ ] **Step 7: Run it and watch it fail.**

  ```bash
  bun test src/components/song/ArrangeView.test.tsx -t "Copy into"
  ```

  Expected failure: `expect(received).toContain(expected)` — the rendered view contains no
  `btn-loop-copy-into-loop-default-1`. (Before this step it also fails to type-check:
  `bun run lint` reports `Property 'onCopyInto' is missing in type … but required in type
  'SortableLoopCardProps'` at the `<SortableLoopCard …>` call site.)

- [ ] **Step 8: Hold `copyTargetId` in `ArrangeView` and render one dialog.**

  In `src/components/song/ArrangeView.tsx`, extend the store imports:

  ```tsx
  import { loopBars, loopLabel } from '@/store/loop';
  import type { LoopCopyGroupId } from '@/store/loopCopy';
  ```

  and the local component imports:

  ```tsx
  import { LoopCopyDialog } from './LoopCopyDialog';
  ```

  Add the action selector beside the other loop actions:

  ```tsx
    const applyLoopCopy = useAppStore((s) => s.applyLoopCopy);
  ```

  Add the state and the two callbacks beside `handleDelete`:

  ```tsx
    // The id of the loop being copied INTO, or null when the dialog is closed.
    // One dialog for the whole list: every card is mounted simultaneously
    // inside the SortableContext, so a per-card dialog would mount a full form
    // per loop and re-render all of them on every tick of the arrange playhead.
    const [copyTargetId, setCopyTargetId] = useState<string | null>(null);

    const handleCopyInto = useCallback((id: string) => setCopyTargetId(id), []);

    const handleApplyCopy = useCallback(
      (targetId: string, sourceId: string, selected: readonly LoopCopyGroupId[]) => {
        applyLoopCopy(targetId, sourceId, selected);
      },
      [applyLoopCopy],
    );

    // The card never reads loop.name/loop.tempName; ArrangeView resolves the
    // displayed label once and hands the same strings to the card and to the
    // dialog, so a card and its copy dialog can never disagree about a name.
    const labels = useMemo(
      () => Object.fromEntries(loops.map((loop) => [loop.id, loopLabel(loop)])),
      [loops],
    );
  ```

  If the label task already added a `loopLabel` resolution here for the card's `label` prop,
  reuse it — read the card's `label={…}` line first and build the map from the same call rather
  than adding a second resolution beside it. Likewise `loopLabel` may already be in the
  `@/store/loop` import.

  Pass the prop through in the `SortableLoopCard` call, under `onDuplicate={handleDuplicate}`:

  ```tsx
                    onCopyInto={handleCopyInto}
  ```

  And render the single dialog after the closing `</DndContext>`, still inside the outer `div`:

  ```tsx
        {copyTargetId !== null && (
          <LoopCopyDialog
            open
            targetId={copyTargetId}
            loops={loops}
            labels={labels}
            onApply={handleApplyCopy}
            onClose={() => setCopyTargetId(null)}
          />
        )}
  ```

  Mounting it conditionally is what gives the spec's "selection state resets each time it opens"
  for free — the component unmounts on close, so its `useState` starts over.

- [ ] **Step 9: Run it and watch it pass.**

  ```bash
  bun test src/components/song/ArrangeView.test.tsx
  ```

  Expected: the whole file passes, including the new test.

- [ ] **Step 10: Run the completion gate.**

  ```bash
  bun run verify
  ```

  Expected: `bun test` green across every file, `tsc --noEmit` clean, `eslint .` reporting
  **nothing at all** — no errors and no warnings — and `check:keys`, `check:drums`,
  `check:contrast`, `check:levels` and the production build all passing.

- [ ] **Step 11: Commit the wiring.**

  ```bash
  git add src/components/song/ArrangeView.tsx src/components/song/ArrangeView.test.tsx
  printf '%s\n' \
    'feat(song): mount one loop-copy dialog for the whole Arrange list' \
    '' \
    'ArrangeView holds copyTargetId and renders a single LoopCopyDialog rather' \
    'than one per card — every card is mounted simultaneously inside the' \
    'SortableContext, so a per-card dialog would mount a twelve-checkbox form per' \
    'loop and re-render all of them on every tick of the arrange playhead. The' \
    'conditional mount is also what resets the selection on each open.' \
    '' \
    'ArrangeView resolves loopLabel once for both the card'\''s label and the' \
    'dialog'\''s title and option list, so the two can never disagree about a name.' \
    '' \
    'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>' \
    'Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM' \
    | git commit -F -
  ```

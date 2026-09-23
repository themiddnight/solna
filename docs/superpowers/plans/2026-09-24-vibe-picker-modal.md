# Vibe picker modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible Instant Vibes strip with a **Vibes** Header tool that opens a centred modal where a vibe is auditioned on the current loop, kept on **Use**, and undone exactly on **Cancel**.

**Architecture:** Task 1 teaches both persisted writers a hold. Task 2 adds a session-only `noteInputSuspended` flag and gates QWERTY + MIDI at their entry. Task 3 adds the preview commands (`store/vibePreview.ts`) and the snapshot (`captureVibeTargets`). Task 4 adds the picker (`components/vibes/*`) as a `HEADER_TOOLS` row, beside the old strip. Task 5 removes the strip. Task 6 deletes `applyVibeToStore` and its restart. Tasks 7–8 are ADR-0045, rules R333–R338 and the doc sync; Task 9 is the gate and the browser check.

**Tech Stack:** TypeScript, React 19 (`useState`, `useEffect`, `useRef`), zustand (`subscribeWithSelector`), Tailwind v4 + daisyUI v5, native `<dialog>` via `ui/Modal`, raw Web Audio via `audioEngine`, Bun test runner (`renderToString`, no DOM), ESLint flat config, Knip. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-24-vibe-picker-modal-design.md` — binding. Read §0 (facts F1–F20) before any task, then the sections each task cites. Departures are under "Spec corrections".

## Global Constraints

- Branch `feat/vibe-picker-modal` (checked out). Never push, never commit on `main`, never switch branches. No Linear issue.
- One commit per task, conventional message, body ending with a blank line and exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every commit leaves `bun run lint`, `bun test` and `bun run eslint` green. `bun run eslint` prints **zero errors and zero warnings** — never ignore a warning or call it pre-existing; fix it or add a line-level `// eslint-disable-next-line <rule> -- <reason>`; never relax a rule globally (R005, R264).
- Spec §2 non-goals: no Undo, no "apply to a new loop", no change to what a vibe writes, to vibe data, dice pools or resolvers (R095–R119 unchanged in substance), to `Modal`, `BottomSheet`, R325/R326 or the feedback host.
- Layering (R019): `components/` never imports `audio/engine`; `vibePreview.ts` (store) may. Components reach `@/store/vibePreview` **only** through the cached dynamic `import()` in `useVibePicker.ts`; `import type` from it is fine.
- R016: `noteInputSuspended` is written only on open/close. R274: one value per `useAppStore` selector. R265/R266: component state in a colocated hook with a named, exported return type. R267: child components above the root. R270: explicit props.
- R210: persisted values are replaced, never mutated — the snapshot is captured by reference and relies on it.
- Theme tokens only; no colour literal. daisyUI classes in new markup limited to ones already used in `src/`: `btn`, `btn-sm`, `btn-ghost`, `btn-soft`, `btn-primary`, `btn-square`, `modal*` (via `Modal`). **Never `btn-block` in the picker** (`toolRows.test.tsx` asserts the bar markup has none). Anything else: check the daisyUI v5 docs first.
- Every new interactive control in the modal is ≥ 44px tall (`min-h-11`, plus `min-w-11` when square).
- New files import across folders with `@/…` (`../../` is banned).
- Size caps (`eslint.config.js`): `max-lines` 750 (blank/comment lines skipped), `max-lines-per-function` 100, `complexity` warns at 20.
- Tests have no DOM (`testing.md`): logic goes in pure functions or store commands; components are checked with `renderToString`; the R257 trap applies.
- R001: no counts, versions or line numbers in any rule, ADR, skill or CLAUDE.md text you write.
- Large files (`useInputDeck.ts`, `vibes.test.ts`, `store.test.ts`, `docs/architecture/structure/*.md`): `grep -n` + line ranges or Serena symbol lookup, never a whole-file dump.

## Spec corrections (found while turning the spec into code)

1. **`holdPersistedWrites()` flushes both writers, then holds** (spec §5.1 lists `flushBeforeHide()` and the hold as two steps). One call makes "opening flushes first" (R335) a property of the store function, testable in `store.test.ts` against its fake `localStorage`; `beginVibePreview` calls it once.
2. **`rerollPreview(base)` returns `{ spec, headline, detail }`**, not `{ spec, summary }`: `formatVariationSummary` lives in `vibeVariation.ts`, which must stay behind the lazy boundary (§5.4), so the command formats and the hook stores `reroll: { headline, detail }` where §5.3 says `summary`.
3. **`playPreview()` is stop + cut, then `soloLoop(activeLoopId)`.** `soloLoop` is a toggle (`toggle-loop` in `playbackScope.ts`), so calling it while the loop plays would stop it; stopping first makes Play idempotent and still never re-applies.
4. **The 🎲 shows only on a vibe with a `random` rule** — `resolveVibeVariation` throws without one. All eight have one today.
5. **Play is disabled until a preview**, like **Use**; before one there is nothing auditioned to play.
6. **The Header button hides its "Vibes" text below `lg`**, keeping `aria-label`/`title`, exactly as `ExportTrigger` does — the loop-layer Header at `md` has no room for another text button. The menu row always shows the label.
7. **MIDI held notes are not force-released at open.** Spec §7 names `releaseAllHeldNotes` (QWERTY); a MIDI note-off still passes while suspended, so a held MIDI key releases on key-up.
8. **Commit order differs from spec §12.** The picker lands beside the strip (Task 4), the strip goes next (Task 5), `applyVibeToStore` last (Task 6) — there is never a commit without a vibe entry point. Docs follow the code, so no rule `paths:` or text names a file that does not exist yet; each rule change still ships with its ADR in one commit (Task 7).
9. **R086 also names `applyVibeToStore`**, and `docs/architecture/structure/02-store.md` does too; both are updated with the rest (Tasks 7, 8).
10. **Content-only tests switch to a fixture**, `writeVibe` in `src/store/vibeWriteFixture.ts` (Knip's `*Fixture` pattern). The restart-after-stop test blocks are deleted with the restart; the audible-cut tests move to `vibePreview.test.ts` (Task 3).
11. **Picker ids are `btn-vibes…`**, never `btn-vibe-…`, so the shell test can prove the strip is gone.
12. **`ignoresNoteKey` and `subscribeNoteInputSuspended` are exported from `useInputDeck.ts`** as the no-DOM test seams for the two keydown gates and the held-note release.

## Review Focus

1. **Several loops, the second one active** — preview and Cancel must touch only the active loop's mirror; every other `loops[]` entry comes back equal. Test: Task 3, "Cancel … with two loops".
2. **Open twice in a row (React StrictMode's dev double effect, or a quick close/reopen)** — the hold is a flag, not a count; one release must free writes. Tests: Task 1 "two holds, one release"; Task 3 "open, cancel, open, cancel".
3. **Close before the lazy module resolves** (Esc on the very first open) — nothing may begin, so no hold and no suspension may be left behind. Code: the `live` guard in `useVibePicker`'s open effect (Task 4); manual check in Task 9.
4. **A second pick while the first preview is sounding** — the old progression's queued voices must be cut before the new content lands. Test: Task 3, "a new pick cuts the old voices before its content lands".
5. **The layout switches across `md` with the picker open** (R316 remounts the frame) — the unmount must cancel: state restored, transport stopped, input unsuspended, writes released. Code: the open effect's cleanup (Task 4); manual check in Task 9.

## File map

| File | Task | Change |
|---|---|---|
| `src/utils/coalescedStorage.ts` (+ `.test.ts`) | 1 | `hold()` / `release()` |
| `src/store/projectAutosave.ts` (+ `.test.ts`) | 1 | `hold()` / `release()` |
| `src/store/store.ts`, `src/store/store.test.ts` | 1, 2 | 1: `holdPersistedWrites` / `releasePersistedWrites`; 2: `NON_PERSISTED_KEYS` |
| `src/store/types.ts`, `src/store/uiSlice.ts` (+ `.test.ts`) | 2 | `noteInputSuspended`, `setNoteInputSuspended` |
| `src/store/midiInput.ts` (+ `.test.ts`) | 2 | note-on/CC gate |
| `src/components/useInputDeck.ts` (+ `.test.tsx`) | 2 | `ignoresNoteKey`, `subscribeNoteInputSuspended`, both keydown gates, release on the rising edge |
| `src/store/vibes.ts` | 3, 6 | 3: `resolveVibeVoices`, `withMirror` export, `captureVibeTargets`; 6: `applyVibeToStore` deleted |
| `src/store/vibePreview.ts` (+ `.test.ts`) | 3 | **new**: the six commands |
| `src/components/vibes/useVibePicker.ts` (+ `.test.ts`), `VibePickerModal.tsx` (+ `.test.tsx`), `VibesButton.tsx` | 4 | **new** |
| `src/components/header/headerTools.ts` (+ `.test.ts`), `toolRows.test.tsx`, `Header.test.tsx`, `shell/mobileShell.test.tsx`, `shell/shells.test.tsx` | 4, 5 | `vibes` row; strip assertions |
| `src/components/shell/ShellBody.tsx` | 5 | strip removed |
| `src/components/InstantVibesBar.tsx` (+ `.test.tsx`), `src/components/vibeActions.ts` | 5 | **deleted** |
| `src/store/vibeWriteFixture.ts`, `vibes.test.ts`, `vibes.atomic.test.ts`, `customStepSequencer.test.ts` | 6 | fixture; tests off `applyVibeToStore` |
| comment-only: `loadLoop.ts`, `playbackScope.ts`, `stopAndRestart.ts`, `vibeVariation.ts`, `musicContextSlice.ts`, `audio/drumGrids.ts`, `data/effectChains.ts`, `data/vibes.ts`, `index.css`, `song/LoopCopyDialog.tsx`, three test comments | 5, 6 | stale names |
| `docs/decisions/0045-vibe-picker-preview.md`, `README.md`, `0009-…md`, `.claude/rules/{components,persistence,note-input,playback,vibes-and-grids}.md`, `.claude/skills/instant-vibes/SKILL.md`, `CLAUDE.md` | 7 | ADR + rules |
| `docs/design.md`, `docs/architecture/feature-overview.md`, `docs/architecture/structure/{README,01-ui,02-store}.md` | 8 | doc sync |

---

### Task 1: Persistence hold

Spec §6, R335.

**Files:**
- Modify: `src/utils/coalescedStorage.ts`, `src/store/projectAutosave.ts`, `src/store/store.ts`
- Test: `src/utils/coalescedStorage.test.ts`, `src/store/projectAutosave.test.ts`, `src/store/store.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `CoalescedStorage.hold(): void`, `CoalescedStorage.release(): void`.
  - `ProjectAutosave.hold(): void`, `ProjectAutosave.release(): void`.
  - `@/store/store`: `export function holdPersistedWrites(): void` (flushes both writers, then holds both), `export function releasePersistedWrites(): void`. `persistStorage` stays private.
  - A hold is a **flag**, not a count: a second `hold()` changes nothing, one `release()` ends it. `release()` when not held is a no-op.

- [ ] **Step 1: Failing tests — `coalescedStorage.test.ts`.** Append inside the file (it already has `fixture()`, `recordingStorage`, `manualScheduler` with `run()`/`size()`):

```ts
describe('hold / release (R335)', () => {
  test('while held, setItem buffers and schedules nothing', () => {
    const { base, sched, storage } = fixture();
    storage.hold();
    storage.setItem('k', 'v');
    expect(sched.size()).toBe(0);
    expect(base.calls).toEqual([]);
    expect(storage.getItem('k')).toBe('v');
  });

  test('flush() is a no-op while held, so pagehide writes nothing', () => {
    const { base, storage } = fixture();
    storage.hold();
    storage.setItem('k', 'v');
    storage.flush();
    expect(base.calls).toEqual([]);
  });

  test('a flush scheduled before the hold never fires during it', () => {
    const { base, sched, storage } = fixture();
    storage.setItem('k', 'v');
    storage.hold();
    sched.run();
    expect(base.calls).toEqual([]);
  });

  test('release schedules exactly one flush, of the latest value', () => {
    const { base, sched, storage } = fixture();
    storage.hold();
    storage.setItem('k', 'v1');
    storage.setItem('k', 'v2');
    storage.release();
    expect(sched.size()).toBe(1);
    sched.run();
    expect(base.calls).toEqual(['set:k']);
    expect(base.data.get('k')).toBe('v2');
  });

  test('two holds, one release: the hold is a flag, not a count', () => {
    const { base, sched, storage } = fixture();
    storage.hold();
    storage.hold();
    storage.setItem('k', 'v');
    storage.release();
    sched.run();
    expect(base.calls).toEqual(['set:k']);
  });

  test('release with nothing buffered, or without a hold, schedules nothing', () => {
    const { sched, storage } = fixture();
    storage.release();
    storage.hold();
    storage.release();
    expect(sched.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Failing tests — `projectAutosave.test.ts`.** Append (uses the file's `manualScheduler()` → `{ scheduler, drain, pending }` and `fakeApi()` → `{ api, setState, saves }`):

```ts
describe('hold / release (R335)', () => {
  test('a content change while held marks a write but schedules none', () => {
    const { scheduler, pending } = manualScheduler();
    const { api, setState } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    autosave.hold();
    setState({ bpm: 130 });
    expect(autosave.isScheduled()).toBe(false);
    expect(pending()).toBe(0);
  });

  test('flush() is a no-op while held', () => {
    const { scheduler, drain } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    autosave.hold();
    setState({ bpm: 130 });
    autosave.flush();
    drain();
    expect(saves).toHaveLength(0);
  });

  test('holding cancels a write already scheduled, and release brings it back once', () => {
    const { scheduler, drain } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    setState({ bpm: 130 });
    autosave.hold();
    expect(autosave.isScheduled()).toBe(false);
    setState({ bpm: 131 });
    setState({ bpm: 132 });
    autosave.release();
    expect(autosave.isScheduled()).toBe(true);
    drain();
    expect(saves).toHaveLength(1);
  });

  test('release with no change schedules nothing; disarm drops a held change', () => {
    const { scheduler } = manualScheduler();
    const { api, setState } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    autosave.hold();
    autosave.release();
    expect(autosave.isScheduled()).toBe(false);
    autosave.hold();
    setState({ bpm: 140 });
    autosave.disarm();
    autosave.release();
    expect(autosave.isScheduled()).toBe(false);
  });
});
```

- [ ] **Step 3: Failing test — `store.test.ts`.** Add beside `'a persisted-key change still reaches storage after flushPersistedWrites()'` (same `getStore()` / `fakeLocalStorage` harness):

```ts
  test('holding flushes first, then nothing reaches storage until release (R335)', async () => {
    const { useAppStore, flushBeforeHide, flushPersistedWrites, holdPersistedWrites, releasePersistedWrites } =
      await getStore();
    const read = () =>
      JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}').state?.metronomeActive;
    const opened = !useAppStore.getState().metronomeActive;
    useAppStore.setState({ metronomeActive: opened }); // buffered, not yet written
    holdPersistedWrites();
    try {
      expect(read()).toBe(opened); // flushed by the hold itself
      useAppStore.setState({ metronomeActive: !opened });
      flushBeforeHide(); // what pagehide / hidden run
      expect(read()).toBe(opened);
    } finally {
      releasePersistedWrites();
    }
    flushPersistedWrites();
    expect(read()).toBe(!opened);
  });
```

Run: `bun test src/utils/coalescedStorage.test.ts src/store/projectAutosave.test.ts src/store/store.test.ts` → FAIL (`storage.hold is not a function`, `holdPersistedWrites` undefined).

- [ ] **Step 4: `coalescedStorage.ts`.** Add to the `CoalescedStorage` interface, after `discard`:

```ts
  /**
   * Stop writing (R335): `setItem` still buffers but schedules nothing, a
   * flush already scheduled is cancelled, and `flush()` writes nothing — so
   * pagehide/hidden leave the base storage as it was. A flag, not a count.
   */
  hold(): void;
  /** End a hold; schedules ONE flush if anything is buffered. A no-op when not held. */
  release(): void;
```

Amend `flush`'s doc to add "A no-op while held." In `createCoalescedStorage`: add `let held = false;` beside `handle`; first line of `flush` becomes `if (held) return;`; `setItem` becomes

```ts
    setItem: (name, value) => {
      pending.set(name, value);
      if (!held && handle === null) handle = scheduler.schedule(flush);
    },
```

and add to the returned object:

```ts
    hold: () => {
      held = true;
      cancelScheduled();
    },
    release: () => {
      if (!held) return;
      held = false;
      if (pending.size > 0 && handle === null) handle = scheduler.schedule(flush);
    },
```

`removeItem` and `discard` are unchanged (zustand removes only on `clearStorage`, which the preview never calls).

- [ ] **Step 5: `projectAutosave.ts`.** Add to `ProjectAutosave`:

```ts
  /** Stop writing (R335): a content change marks a write without scheduling it; `flush()` is a no-op. A flag, not a count. */
  hold(): void;
  /** End a hold; schedules ONE write if a change was marked while held. A no-op when not held. */
  release(): void;
```

Implementation — add `let held = false; let heldChange = false;` beside `armed`, then:

```ts
  const schedule = (): void => {
    if (!armed) return;
    if (held) {
      heldChange = true;
      return;
    }
    if (handle === null) handle = scheduler.schedule(write);
  };
```

and in the returned object: `disarm` also sets `heldChange = false`; `flush` starts `if (held || handle === null) return;`; add

```ts
    hold: () => {
      if (held) return;
      held = true;
      if (handle !== null) {
        heldChange = true;
        cancel();
      }
    },
    release: () => {
      if (!held) return;
      held = false;
      const changed = heldChange;
      heldChange = false;
      if (changed) schedule();
    },
```

Add one sentence to the file's docblock: "The vibe preview holds it (R335) — separate from the boot `arm`/`disarm`."

- [ ] **Step 6: `store.ts`.** After `flushBeforeHide` (it references `projectAutosave`, declared above it):

```ts
/**
 * Hold both persisted writers — the localStorage blob and the project
 * autosave — for the vibe preview (R335). Flushes both first, so disk holds
 * the pre-preview state; while held nothing is written, pagehide included,
 * so a tab closed mid-preview reloads as if Cancel had been pressed.
 */
export function holdPersistedWrites(): void {
  flushBeforeHide();
  persistStorage.hold();
  projectAutosave.hold();
}

/** End the hold: each writer schedules one write if anything changed meanwhile. */
export function releasePersistedWrites(): void {
  persistStorage.release();
  projectAutosave.release();
}
```

- [ ] **Step 7: Run.** `bun test src/utils/coalescedStorage.test.ts src/store/projectAutosave.test.ts src/store/store.test.ts` → PASS. Then `bun run lint && bun run eslint && bun test` → green, zero warnings. (Knip will flag the two new store exports until Task 3 imports them — that is expected; `check:dead-code` is not a per-task gate until Task 3.)

- [ ] **Step 8: Commit**

```bash
git add src/utils/coalescedStorage.ts src/utils/coalescedStorage.test.ts \
  src/store/projectAutosave.ts src/store/projectAutosave.test.ts src/store/store.ts src/store/store.test.ts
git commit -m "feat(store): hold and release persisted writes" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Note-input suspension

Spec §7, R336.

**Files:**
- Modify: `src/store/types.ts` (`UiSlice`), `src/store/uiSlice.ts`, `src/store/midiInput.ts` (`handleMessage`), `src/components/useInputDeck.ts`
- Test: `src/store/uiSlice.test.ts`, `src/store/store.test.ts` (`NON_PERSISTED_KEYS`), `src/store/midiInput.test.ts`, `src/components/useInputDeck.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `UiSlice.noteInputSuspended: boolean` (default `false`, session-only — **not** added to `partializeAppState`), `UiSlice.setNoteInputSuspended(suspended: boolean): void`.
  - `@/components/useInputDeck`: `export function ignoresNoteKey(e: KeyboardEvent): boolean`; `export function subscribeNoteInputSuspended(onSuspend: () => void): () => void` (fires on the rising edge only).

- [ ] **Step 1: Failing tests.**

`uiSlice.test.ts` (or wherever the real-store ui tests live — append a describe):

```ts
describe('noteInputSuspended (R336)', () => {
  afterEach(() => useAppStore.setState({ noteInputSuspended: false }));
  test('starts false and is set by its one setter', () => {
    expect(useAppStore.getState().noteInputSuspended).toBe(false);
    useAppStore.getState().setNoteInputSuspended(true);
    expect(useAppStore.getState().noteInputSuspended).toBe(true);
  });
});
```

(Import `useAppStore` from `./store` and `afterEach` from `bun:test` if the file lacks them.)

`store.test.ts`: add `'noteInputSuspended'` and `'setNoteInputSuspended'` to `NON_PERSISTED_KEYS`.

`midiInput.test.ts` — append after `'MIDI joins the note-input funnel'` (reuses `connect`, `noteOn`, `spyNotePair`, `subscribeNoteInput`, `resetNoteInputListeners`, `__flushCcFramesForTests`, `noteFrequency`):

```ts
describe('suspended note input drops MIDI note-on and CC (R336)', () => {
  afterEach(() => useAppStore.setState({ noteInputSuspended: false }));

  test('a note-on is dropped: no voice, no bus event', () => {
    const spy = spyNotePair();
    const events: NoteInputEvent[] = [];
    subscribeNoteInput((e) => events.push(e));
    const input = connect('dev-suspend-on');
    useAppStore.getState().setNoteInputSuspended(true);
    noteOn(input, 60);
    expect(spy.on).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    resetNoteInputListeners();
    spy.restore();
  });

  test('a note-off still passes, so a key held across the open releases', () => {
    const spy = spyNotePair();
    const input = connect('dev-suspend-off');
    noteOn(input, 60);
    useAppStore.getState().setNoteInputSuspended(true);
    input.onmidimessage?.({ data: [0x80, 60, 0], target: input });
    expect(spy.releasedFrequencies()).toEqual([noteFrequency('C4')]);
    spy.restore();
  });

  test('a CC is dropped: the mapped parameter does not move', () => {
    useAppStore.setState({ masterVolume: 0 });
    const input = connect('dev-suspend-cc');
    useAppStore.getState().setNoteInputSuspended(true);
    input.onmidimessage?.({ data: [0xb0, 7, 127], target: input }); // would be +12 dB
    __flushCcFramesForTests();
    expect(useAppStore.getState().masterVolume).toBe(0);
  });
});
```

If `releasedFrequencies()` compares against a differently computed value in the file's existing held-note tests, mirror that form.

`useInputDeck.test.tsx` — add `ignoresNoteKey`, `subscribeNoteInputSuspended` to the `./useInputDeck` import, and `readFileSync` from `node:fs` + `join` from `node:path` if absent:

```ts
describe('note input suspension (R336)', () => {
  afterEach(() => useAppStore.setState({ noteInputSuspended: false }));

  test('a suspended deck ignores every key before any DOM check', () => {
    useAppStore.getState().setNoteInputSuspended(true);
    // No DOM in bun: the flag must short-circuit before isTypingTarget reads HTMLInputElement.
    expect(ignoresNoteKey({} as KeyboardEvent)).toBe(true);
  });

  test('the rising edge fires the release once; repeats and the falling edge do not', () => {
    let fired = 0;
    const off = subscribeNoteInputSuspended(() => { fired++; });
    useAppStore.getState().setNoteInputSuspended(true);
    useAppStore.getState().setNoteInputSuspended(true);
    useAppStore.getState().setNoteInputSuspended(false);
    off();
    expect(fired).toBe(1);
  });

  test('both keydown listeners — notes and drum pads — go through the gate; keyup does not', () => {
    const src = readFileSync(join(import.meta.dir, 'useInputDeck.ts'), 'utf8');
    expect(src.match(/if \(ignoresNoteKey\(e\)\) return;/g)?.length).toBe(2);
  });
});
```

Run: `bun test src/store/uiSlice.test.ts src/store/store.test.ts src/store/midiInput.test.ts src/components/useInputDeck.test.tsx` → FAIL.

- [ ] **Step 2: Slice.** `types.ts` `UiSlice`, beside `midiLearnTargetId`:

```ts
  /**
   * Session-only (never in partializeAppState): true while the vibe picker
   * previews. Gates QWERTY notes, QWERTY drum pads and MIDI note-on/CC at
   * their entry (R336). Written only on open and close (R016).
   */
  noteInputSuspended: boolean;
  setNoteInputSuspended: (suspended: boolean) => void;
```

`uiSlice.ts`: `noteInputSuspended: false,` in the state block and `setNoteInputSuspended: (noteInputSuspended) => set({ noteInputSuspended }),` among the setters.

- [ ] **Step 3: MIDI gate.** In `handleMessage` (`midiInput.ts`), directly after `const data2 = data[2];` and before the MIDI Learn check:

```ts
        // R336: while the vibe picker previews, a note-on would play over the
        // audition and a CC would edit state Cancel is about to wipe. A
        // note-off still passes, so a key held across the open releases.
        if (s.noteInputSuspended && (command === 0xB0 || (command === 0x90 && data2 > 0))) return;
```

- [ ] **Step 4: QWERTY gates.** In `useInputDeck.ts`, after `releaseAllHeldNotes`:

```ts
/**
 * R336: a keydown the note and drum-pad listeners drop — every key while the
 * vibe picker previews, and a key typed into a text field. The flag is read
 * first. Keyup is not gated, so a note held across the open still releases.
 */
export function ignoresNoteKey(e: KeyboardEvent): boolean {
  return useAppStore.getState().noteInputSuspended || isTypingTarget(e);
}

/** Calls `onSuspend` each time note input becomes suspended — the rising edge only. */
export function subscribeNoteInputSuspended(onSuspend: () => void): () => void {
  return useAppStore.subscribe(
    (s) => s.noteInputSuspended,
    (suspended, was) => {
      if (suspended && !was) onSuspend();
    },
  );
}
```

Replace `if (isTypingTarget(e)) return;` with `if (ignoresNoteKey(e)) return;` in **`useQwertyNoteListeners`' `handleKeyDown`** and **`useDrumPads`' `handleKeyDown`** only (leave the keyup handler's guard as it is). In `useHeldNoteRelease`'s blur/visibility effect, subscribe the same `releaseHeld` so opening the picker releases what is held the way blur does (R202):

```ts
    const offSuspend = subscribeNoteInputSuspended(releaseHeld);
    window.addEventListener('blur', releaseHeld);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      offSuspend();
      window.removeEventListener('blur', releaseHeld);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
```

and add "and on the rising edge of `noteInputSuspended` (R336)" to that hook's docblock.

- [ ] **Step 5: Run.** The four test files → PASS; `bun run lint && bun run eslint && bun test` → green, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add src/store/types.ts src/store/uiSlice.ts src/store/uiSlice.test.ts src/store/store.test.ts \
  src/store/midiInput.ts src/store/midiInput.test.ts src/components/useInputDeck.ts src/components/useInputDeck.test.tsx
git commit -m "feat(input): suspend QWERTY and MIDI note input on a flag" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Preview commands and snapshot

Spec §5.1, §5.2, §10; R337, R338.

**Files:**
- Create: `src/store/vibePreview.ts`, `src/store/vibePreview.test.ts`
- Modify: `src/store/vibes.ts`

**Interfaces:**
- Consumes: `holdPersistedWrites`, `releasePersistedWrites` (Task 1); `setNoteInputSuspended` (Task 2).
- Produces:
  - `@/store/vibes`: `export function resolveVibeVoices(vibe: ResolvedVibe): VibeVoices` (the `VibeVoices` interface may stay unexported); `export function withMirror(state: AppStore, patch: Partial<AppStore>): Partial<AppStore>`; `export function captureVibeTargets(state: AppStore): Partial<AppStore>`. `applyVibeToStore` stays for now (the strip still calls it) but uses `resolveVibeVoices`.
  - `@/store/vibePreview`:
    - `beginVibePreview(): Partial<AppStore>` — hold (flushes first) → suspend input → stop + cut → return `captureVibeTargets(state)`.
    - `previewVibe(spec: VibeSpec): void` — resolve vibe + voices first → stop + cut → one `setState(withMirror(…vibeContentPatch…))` → `soloLoop(activeLoopId)`.
    - `rerollPreview(base: VibeSpec): { spec: VibeSpec; headline: string; detail: string }` — the feature's one `Math.random`.
    - `playPreview(): void` (stop + cut, then `soloLoop(activeLoopId)`), `stopPreview(): void` (stop + cut).
    - `commitVibePreview(): void` — stop + cut → release → unsuspend.
    - `cancelVibePreview(snapshot: Partial<AppStore>): void` — stop + cut → one `setState(withMirror(snapshot))` → release → unsuspend.
    - "stop + cut" = `hardStopAll()` then `audioEngine.stopSource(source, 0.02)` for each of `ACCOMPANIMENT_SOURCES`.

- [ ] **Step 1: Failing tests — `src/store/vibePreview.test.ts`.**

```ts
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { mulberry32 } from '../audio/rng';
import { VIBES } from '../data/vibes';
import { DEFAULT_METER_ID } from '../utils/timeSignature';
import { INITIAL_EFFECTS } from './initialState';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { SCOPE_NONE } from './playbackScope';
import { releasePersistedWrites, useAppStore } from './store';
import { DEFAULT_BPM, isAnyPlayerActive } from './transportSlice';
import type { AppStore } from './types';
import {
  beginVibePreview, cancelVibePreview, commitVibePreview, playPreview, previewVibe, rerollPreview, stopPreview,
} from './vibePreview';
import { captureVibeTargets, resolveVibe, resolveVibeVoices, vibeContentPatch, withMirror } from './vibes';
import { createDraw, resolveVibeVariation } from './vibeVariation';

const resetStore = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop], activeLoopId: loop.id, ...loopStatePatch(loop),
    sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped', fxPlayer: 'stopped',
    songLoopIndex: null, activeTab: 'sound', playbackScope: SCOPE_NONE, selectedVibeId: null,
    bpm: DEFAULT_BPM, meterId: DEFAULT_METER_ID, effects: { ...INITIAL_EFFECTS }, noteInputSuspended: false,
  });
};

const s = () => useAppStore.getState();
const stopped = () => !isAnyPlayerActive(s()) && s().playbackScope.kind === 'none';

beforeEach(resetStore);
afterEach(() => {
  s().hardStopAll();
  releasePersistedWrites(); // a failed test must not leave the hold on for the next file
  resetStore();
});

describe('vibe preview commands (R337)', () => {
  test('open stops the transport, suspends input and snapshots the targets', () => {
    s().playAll();
    const snap = beginVibePreview();
    expect(stopped()).toBe(true);
    expect(s().noteInputSuspended).toBe(true);
    expect(snap.chords).toBe(s().chords);
    cancelVibePreview(snap);
    expect(s().noteInputSuspended).toBe(false);
  });

  test('a preview plays the active loop under the loop scope, never the song', () => {
    const snap = beginVibePreview();
    previewVibe(VIBES[0]);
    expect(s().playbackScope).toEqual({ kind: 'loop', loopId: s().activeLoopId });
    expect(isAnyPlayerActive(s())).toBe(true);
    expect(s().selectedVibeId).toBe(VIBES[0].id);
    cancelVibePreview(snap);
    expect(stopped()).toBe(true);
  });

  test('Stop stops; Play after a reroll plays what is in the store without re-applying', () => {
    const snap = beginVibePreview();
    previewVibe(VIBES[1]);
    const { spec } = rerollPreview(VIBES[1]);
    expect(spec.id).toBe(VIBES[1].id);
    const { chords, bpm } = s();
    stopPreview();
    expect(stopped()).toBe(true);
    playPreview();
    playPreview(); // idempotent: soloLoop alone would toggle it off
    expect(s().chords).toBe(chords);
    expect(s().bpm).toBe(bpm);
    expect(s().playbackScope.kind).toBe('loop');
    cancelVibePreview(snap);
  });

  test('Cancel after every vibe and a reroll restores the pre-open state, with two loops', () => {
    const first = createDefaultLoop();
    const second = { ...createDefaultLoop(), name: 'Mine' };
    useAppStore.setState({ loops: [first, second], activeLoopId: second.id, ...loopStatePatch(second) });
    const before = s();
    const snap = beginVibePreview();
    for (const vibe of VIBES) previewVibe(vibe);
    rerollPreview(VIBES[0]);
    cancelVibePreview(snap);
    const after = s();
    for (const key of Object.keys(captureVibeTargets(before)) as (keyof AppStore)[]) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(after.activeLoopId).toBe(second.id);
    expect(stopped()).toBe(true);
    expect(after.noteInputSuspended).toBe(false);
  });

  test('Use keeps the last preview, stamps the loop and leaves the transport stopped', () => {
    beginVibePreview();
    previewVibe(VIBES[2]);
    const { chords } = s();
    commitVibePreview();
    expect(s().chords).toBe(chords);
    expect(s().selectedVibeId).toBe(VIBES[2].id);
    expect(s().loops.find((l) => l.id === s().activeLoopId)?.tempName).toBe(VIBES[2].name);
    expect(stopped()).toBe(true);
    expect(s().noteInputSuspended).toBe(false);
  });

  test('open, cancel, open, cancel (StrictMode) ends unsuspended and unchanged', () => {
    const before = s().chords;
    cancelVibePreview(beginVibePreview());
    const snap = beginVibePreview();
    previewVibe(VIBES[3]);
    cancelVibePreview(snap);
    expect(s().chords).toEqual(before);
    expect(s().noteInputSuspended).toBe(false);
  });
});

describe('a new pick cuts the old voices before its content lands', () => {
  test('silences chord, bass and pad at the hard-stop release', () => {
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
    stopSource.mockClear();
    previewVibe(VIBES[1]);
    const silenced = stopSource.mock.calls.map((c) => c[0]);
    expect(silenced).toEqual(expect.arrayContaining(['chord', 'bass', 'pad']));
    for (const call of stopSource.mock.calls) expect(call[1]).toBe(0.02);
    stopSource.mockRestore();
  });

  test('every cut sees the OLD progression', () => {
    previewVibe(VIBES[0]);
    const oldIds = s().chords.map((c) => c.id);
    const idsAtCut: string[][] = [];
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {
      idsAtCut.push(s().chords.map((c) => c.id));
    });
    previewVibe(VIBES[1]);
    expect(idsAtCut.length).toBeGreaterThan(0);
    for (const ids of idsAtCut) expect(ids).toEqual(oldIds);
    stopSource.mockRestore();
  });
});

describe('the snapshot covers every key a vibe writes (R338)', () => {
  test('for every vibe and a seeded sample of rerolls', () => {
    const draw = createDraw(mulberry32(0x5eed));
    for (const base of VIBES) {
      const current = s();
      const specs = [base, ...Array.from({ length: 4 }, () => resolveVibeVariation(
        base,
        { scaleRoot: current.scaleRoot, chordRhythmId: current.chordRhythmId, bassPatternId: current.bassPatternId },
        draw,
      ).spec)];
      for (const spec of specs) {
        const vibe = resolveVibe(spec);
        const written = Object.keys(withMirror(current, vibeContentPatch(current, vibe, resolveVibeVoices(vibe))));
        const captured = new Set(Object.keys(captureVibeTargets(current)));
        expect(written.filter((key) => !captured.has(key))).toEqual([]);
      }
    }
  });
});
```

If `mulberry32` is not exported from `src/audio/rng.ts` under that name, use whatever seeded generator `rng.test.ts` imports. Run: `bun test src/store/vibePreview.test.ts` → FAIL (`Cannot find module './vibePreview'`).

- [ ] **Step 2: `vibes.ts`.**
  - Extract the inline `voices` object of `applyVibeToStore` into

```ts
/**
 * Every voice a vibe installs, resolved before any state is touched: an
 * unknown preset id falls back to the target default, and `resolveVibe`
 * (which does throw) has already run — a swap that writes half a vibe is
 * the failure this ordering exists to prevent.
 */
export function resolveVibeVoices(vibe: ResolvedVibe): VibeVoices {
  return {
    chord: resolveVibeSynthParams(vibe.chordPresetId, 'chord'),
    bass: resolveVibeSynthParams(vibe.bassPresetId, 'bass'),
    synth: resolveVibeSynthParams(vibe.synthPresetId, 'synth'),
    fx: resolveVibeSynthParams(vibe.fxPresetId, 'fx'),
    pad: vibe.pad ? { ...vibe.pad, params: resolveVibeSynthParams(vibe.pad.presetId, 'pad') } : null,
  };
}
```

    and call it from `applyVibeToStore` (`const voices = resolveVibeVoices(vibe);`).
  - `function withMirror` → `export function withMirror` (doc unchanged).
  - Add after `withMirror`:

```ts
/**
 * Every key a vibe patch may write, plus `loops` (the temp name and the
 * mirror) and `selectedVibeId`. The invariant test in vibePreview.test.ts
 * fails on any key a vibe writes that is missing here (R338).
 */
const VIBE_TARGET_KEYS = [
  'bpm', 'meterId', 'scaleRoot', 'scaleType', 'leadMelodySteps', 'fxMelodySteps', 'chords',
  'reharmonizedIndicator', 'selectedVibeId', 'loops', 'beatParams', 'beatPattern',
  'customChordRhythm', 'customChordHoldSteps', 'customChordLoopLength',
  'customBassPattern', 'customBassHoldSteps', 'customBassLoopLength',
  'chordRhythmId', 'chordRhythmMode', 'chordFeel', 'chordOctave', 'chordSynthParams', 'chordArpSettings',
  'bassPatternId', 'bassPatternMode', 'bassFeel', 'bassOctave', 'bassSynthParams', 'bassArpSettings',
  'padSynthParams', 'padArpSettings', 'padMode', 'padOctave', 'padVoicing', 'padDroneDegree',
  'padDroneIntervals', 'padVolume', 'padMuted',
  'synthParams', 'synthArpSettings', 'fxSynthParams', 'fxArpSettings', 'effects',
] as const satisfies readonly (keyof AppStore)[];

/**
 * What Cancel restores (R338): the current value of every vibe target, BY
 * REFERENCE. Safe because persisted values are replaced, never mutated (R210).
 */
export function captureVibeTargets(state: AppStore): Partial<AppStore> {
  return Object.fromEntries(VIBE_TARGET_KEYS.map((key) => [key, state[key]])) as Partial<AppStore>;
}
```

    The list is the starting point read off the builders; `tsc` rejects a key `AppStore` lacks, and the R338 test prints any key a vibe writes that the list misses (e.g. something `changeKey` returns) — add exactly those, nothing speculative.

- [ ] **Step 3: `src/store/vibePreview.ts`.**

```ts
/**
 * The vibe picker's commands (R337). A vibe is auditioned on the current loop
 * and kept only on Use; Cancel writes the snapshot back in one set (R338).
 *
 * Loaded on demand by components/vibes/useVibePicker.ts: this module reaches
 * the engine and the four library resolvers, none of which the eager bundle
 * needs (R095).
 *
 * Every command starts with the same stop + cut: hardStopAll alone does not
 * silence voices already queued on the audio clock, so the accompaniment
 * sources are cut synchronously, BEFORE any write — the fix that used to live
 * in applyVibeToStore. The picker never restarts what was playing: opening and
 * closing both leave the transport stopped, and a preview plays the active
 * loop alone (soloLoop), never the song.
 */
import type { VibeSpec } from '../data/vibes';
import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import { holdPersistedWrites, releasePersistedWrites, useAppStore } from './store';
import type { AppStore } from './types';
import { captureVibeTargets, resolveVibe, resolveVibeVoices, vibeContentPatch, withMirror } from './vibes';
import { createDraw, formatVariationSummary, resolveVibeVariation } from './vibeVariation';

/** Same instant-but-clickless release the hard-stop button uses. */
const VIBE_SWAP_RELEASE = 0.02;

function stopAndCut(): void {
  useAppStore.getState().hardStopAll();
  for (const source of ACCOMPANIMENT_SOURCES) audioEngine.stopSource(source, VIBE_SWAP_RELEASE);
}

function playActiveLoop(): void {
  const { soloLoop, activeLoopId } = useAppStore.getState();
  soloLoop(activeLoopId);
}

function endPreview(): void {
  releasePersistedWrites();
  useAppStore.getState().setNoteInputSuspended(false);
}

/** Open: disk keeps the pre-preview state (R335), input goes quiet (R336), the transport stops. */
export function beginVibePreview(): Partial<AppStore> {
  holdPersistedWrites();
  useAppStore.getState().setNoteInputSuspended(true);
  stopAndCut();
  return captureVibeTargets(useAppStore.getState());
}

/** Audition `spec`: everything resolved before any state is touched, then one write, then play. */
export function previewVibe(spec: VibeSpec): void {
  const vibe = resolveVibe(spec);
  const voices = resolveVibeVoices(vibe);
  stopAndCut();
  useAppStore.setState((s) => withMirror(s, vibeContentPatch(s, vibe, voices)));
  playActiveLoop();
}

/**
 * Reroll `base` into a different piece in the same genre and audition it.
 * The ONLY Math.random call of the feature: everything below takes the draw.
 */
export function rerollPreview(base: VibeSpec): { spec: VibeSpec; headline: string; detail: string } {
  const { scaleRoot, chordRhythmId, bassPatternId } = useAppStore.getState();
  const { spec, summary } = resolveVibeVariation(
    base,
    { scaleRoot, chordRhythmId, bassPatternId },
    createDraw(Math.random),
  );
  previewVibe(spec);
  return { spec, ...formatVariationSummary(summary) };
}

/** Play what is in the store now — never re-applies, so a rerolled variant survives. Idempotent. */
export function playPreview(): void {
  stopAndCut();
  playActiveLoop();
}

export function stopPreview(): void {
  stopAndCut();
}

/** Use: keep what the store holds. */
export function commitVibePreview(): void {
  stopAndCut();
  endPreview();
}

/** Cancel (and Esc, ✕, the backdrop, unmount): the snapshot back in one write. */
export function cancelVibePreview(snapshot: Partial<AppStore>): void {
  stopAndCut();
  useAppStore.setState((s) => withMirror(s, snapshot));
  endPreview();
}
```

- [ ] **Step 4: Run.** `bun test src/store/vibePreview.test.ts src/store/vibes.test.ts src/store/vibes.atomic.test.ts` → PASS. Then `bun run lint && bun run eslint && bun test && bun run check:dead-code && bun run check:dead-code:production`. Knip: the `vibePreview.ts` exports are imported only by its test until Task 4 — if the default scan flags them, that is fixed by Task 4's importer; state it in the task report rather than un-exporting. Everything else zero.

- [ ] **Step 5: Commit**

```bash
git add src/store/vibes.ts src/store/vibePreview.ts src/store/vibePreview.test.ts
git commit -m "feat(vibes): preview commands and the Cancel snapshot" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Vibe picker modal behind a Vibes Header tool

Spec §3, §4, §5.3, §5.4; R333, R334. The strip stays in this commit.

**Files:**
- Create: `src/components/vibes/useVibePicker.ts`, `src/components/vibes/useVibePicker.test.ts`, `src/components/vibes/VibePickerModal.tsx`, `src/components/vibes/VibePickerModal.test.tsx`, `src/components/vibes/VibesButton.tsx`
- Modify: `src/components/header/headerTools.ts`, `src/components/header/headerTools.test.ts`, `src/components/header/toolRows.test.tsx`, `src/components/Header.test.tsx`, `src/components/shell/mobileShell.test.tsx`, `src/components/shell/shells.test.tsx`

**Interfaces:**
- Consumes: every `@/store/vibePreview` command (Task 3), via `typeof import('@/store/vibePreview')`; `isAnyPlayerActive` (`@/store/transportSlice`); `scheduleTimeout` (`@/components/ui/useTimedToast`); `Modal` (`@/components/ui/Modal`); `MenuRowButton`, `ToolVariantProps` (`@/components/ui/MenuRowButton`); `FeedbackRequest` (`@/store/feedback`); `formatKeyLabel` (`@/utils/noteSpelling`).
- Produces:
  - `useVibePicker.ts`: `PICK_PROMPT`; `interface VibePreviewed { base: VibeSpec; spec: VibeSpec; reroll?: { headline: string; detail: string } }`; `vibeSummaryLine(previewed: VibePreviewed | null): string`; `vibeLoadedFeedback(previewed: VibePreviewed): FeedbackRequest`; `interface UseVibePicker`; `useVibePicker(open: boolean, onClose: () => void): UseVibePicker`; `prefetchVibePreview(): void`; `interface UseVibesButton { open; show; hide }`; `useVibesButton(): UseVibesButton`.
  - `VibePickerModal({ open, onClose }: { open: boolean; onClose: () => void })`.
  - `VibesButton({ variant = 'bar' }: ToolVariantProps)` — id `btn-vibes` in both variants.
  - `HeaderToolId` gains `'vibes'`; `HEADER_TOOLS` gains `{ id: 'vibes', Component: VibesButton, layers: LOOP }` directly after `loop-selector`. `MOBILE_BAR_TOOL_IDS` unchanged.
  - DOM ids: cards `btn-vibes-card-<vibe id>`, `btn-vibes-reroll`, `btn-vibes-play`, `btn-vibes-cancel`, `btn-vibes-use`, summary `vibes-summary`.

- [ ] **Step 1: Failing tests.**

`src/components/vibes/useVibePicker.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { VIBES } from '@/data/vibes';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { PICK_PROMPT, vibeLoadedFeedback, vibeSummaryLine } from './useVibePicker';

const vibe = VIBES[0];
const key = formatKeyLabel(vibe.scaleRoot, vibe.scaleType);

describe('the picker footer and its Use toast', () => {
  test('before any preview the footer prompts', () => {
    expect(vibeSummaryLine(null)).toBe(PICK_PROMPT);
    expect(PICK_PROMPT).toBe('Pick a vibe to hear it on this loop.');
  });

  test('a preview reads name · key · BPM, from what is sounding', () => {
    const spec = { ...vibe, bpm: vibe.bpm + 7 };
    expect(vibeSummaryLine({ base: vibe, spec })).toBe(`${vibe.name} · ${key} · ${vibe.bpm + 7} BPM`);
  });

  test('Use confirms under the one vibe key; a dice variant adds its headline', () => {
    expect(vibeLoadedFeedback({ base: vibe, spec: vibe })).toEqual({
      key: 'vibe', message: `Loaded ${vibe.name} (${vibe.bpm} BPM · Key ${key})`, tone: 'success',
    });
    const rolled = vibeLoadedFeedback({ base: vibe, spec: vibe, reroll: { headline: 'H', detail: 'D' } });
    expect(rolled.detail).toBe('H');
  });
});
```

`src/components/vibes/VibePickerModal.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { VIBES } from '@/data/vibes';
import { VibePickerModal } from './VibePickerModal';
import { VibesButton } from './VibesButton';

// Rendered from the store's initial state; nothing here is seeded, so the R257
// trap (testing.md) does not apply. Effects do not run under renderToString,
// so nothing is previewed and the lazy module is never loaded.
describe('the vibe picker (R334)', () => {
  const html = renderToString(<VibePickerModal open={false} onClose={() => {}} />);

  test('one card per vibe, none pressed, no dice before a preview', () => {
    for (const vibe of VIBES) expect(html).toContain(`id="btn-vibes-card-${vibe.id}"`);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain('id="btn-vibes-reroll"');
  });

  test('Use and Play are disabled until something is previewed; Cancel never is', () => {
    expect(html).toMatch(/id="btn-vibes-use"[^>]*disabled=""/);
    expect(html).toMatch(/id="btn-vibes-play"[^>]*disabled=""/);
    expect(html).not.toMatch(/id="btn-vibes-cancel"[^>]*disabled=""/);
    expect(html).toContain('Pick a vibe to hear it on this loop.');
  });

  test('the grid scrolls between a pinned header and a pinned footer', () => {
    expect(html).toContain('flex flex-col overflow-hidden');
    expect(html).toContain('min-h-0 flex-1 overflow-y-auto');
    expect(html).toContain('shrink-0');
  });

  test('the Header button opens a dialog and brings the picker with it', () => {
    const bar = renderToString(<VibesButton />);
    expect(bar).toContain('id="btn-vibes"');
    expect(bar).toContain('aria-haspopup="dialog"');
    expect(bar).toContain('<dialog class="modal"');
  });
});
```

If `renderToString` orders attributes so `disabled=""` precedes `id=`, assert on the tag slice instead (`html.slice(html.indexOf('id="btn-vibes-use"') - 200, …)`) — keep the intent: the Use button is disabled.

`toolRows.test.tsx`: import `VibesButton` from `@/components/vibes/VibesButton` and add `['VibesButton', VibesButton, 'btn-vibes', 'Vibes'],` to `ROW_TOOLS`.

`headerTools.test.ts`: the full list becomes `'loop-copy', 'loop-selector', 'vibes', 'project-name', 'follow-playhead', 'export', 'scale', 'theme'`; the loop layer becomes `['loop-copy', 'loop-selector', 'vibes', 'scale', 'theme']` (title: "…the loop picker, the vibes, the key menu and the theme").

`Header.test.tsx`: the subject run becomes `['loop-copy', 'loop-selector', 'vibes', 'project-name', 'follow-playhead', 'export', 'scale']` (title: "…loop picker, vibes, project name…").

`mobileShell.test.tsx`: loop-layer menu becomes `['loop-copy', 'vibes', 'theme']` (title: "copy, vibes and theme in the menu").

`shells.test.tsx`: add `'id="btn-vibes"'` to the desktop marker list (the strip's `'id="btn-vibe-'` markers stay until Task 5).

Run: `bun test src/components/vibes src/components/header src/components/Header.test.tsx src/components/shell` → FAIL.

- [ ] **Step 2: `src/components/vibes/useVibePicker.ts`.**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VibeSpec } from '@/data/vibes';
import type { FeedbackRequest } from '@/store/feedback';
import { useAppStore } from '@/store/store';
import { isAnyPlayerActive } from '@/store/transportSlice';
import type { AppStore } from '@/store/types';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { scheduleTimeout } from '@/components/ui/useTimedToast';

type VibePreviewModule = typeof import('@/store/vibePreview');

let previewModule: Promise<VibePreviewModule> | null = null;

/**
 * The preview commands reach the engine and the four library resolvers, so
 * they load on demand (R095): prefetched on the button's hover/focus, awaited
 * once per open. The promise is cached — fetched and evaluated at most once.
 */
function loadVibePreview(): Promise<VibePreviewModule> {
  previewModule ??= import('@/store/vibePreview');
  return previewModule;
}

export function prefetchVibePreview(): void {
  void loadVibePreview();
}

/** 400 ms of spin, then the dice settles. */
const ROLLING_MS = 400;

export const PICK_PROMPT = 'Pick a vibe to hear it on this loop.';

export interface VibePreviewed {
  /** The card that was picked; the dice rerolls from it. */
  base: VibeSpec;
  /** What is sounding: `base`, or the dice's variant of it. */
  spec: VibeSpec;
  /** Present after a reroll: what the dice changed. Shown in the footer, never a toast (R329). */
  reroll?: { headline: string; detail: string };
}

export function vibeSummaryLine(previewed: VibePreviewed | null): string {
  if (!previewed) return PICK_PROMPT;
  const { name, scaleRoot, scaleType, bpm } = previewed.spec;
  return `${name} · ${formatKeyLabel(scaleRoot, scaleType)} · ${bpm} BPM`;
}

/** Use's confirmation, under the one `vibe` key (R330); held by an open sheet on mobile (R329). */
export function vibeLoadedFeedback({ spec, reroll }: VibePreviewed): FeedbackRequest {
  return {
    key: 'vibe',
    message: `Loaded ${spec.name} (${spec.bpm} BPM · Key ${formatKeyLabel(spec.scaleRoot, spec.scaleType)})`,
    ...(reroll && { detail: reroll.headline }),
    tone: 'success',
  };
}

interface PreviewSession {
  preview: VibePreviewModule;
  snapshot: Partial<AppStore>;
}

export interface UseVibePicker {
  /** The module is loaded and the session has begun; the cards are live. */
  ready: boolean;
  previewed: VibePreviewed | null;
  /** The transport aggregate, one boolean (R274). */
  playing: boolean;
  rolling: boolean;
  pick: (vibe: VibeSpec) => void;
  reroll: () => void;
  togglePlay: () => void;
  use: () => void;
  cancel: () => void;
}

/**
 * One picker session per open. Opening begins it (snapshot, hold, input
 * suspended, transport stopped); Use commits, and EVERY other way out —
 * Cancel, Esc, ✕, the backdrop, an unmount while open — restores the snapshot.
 */
export function useVibePicker(open: boolean, onClose: () => void): UseVibePicker {
  const sessionRef = useRef<PreviewSession | null>(null);
  const spinRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [previewed, setPreviewed] = useState<VibePreviewed | null>(null);
  const [rolling, setRolling] = useState(false);
  const playing = useAppStore((s) => isAnyPlayerActive(s));

  /** Ends the session if one is live: keep = Use, otherwise the snapshot goes back. */
  const end = useCallback((keep: boolean) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      if (keep) session.preview.commitVibePreview();
      else session.preview.cancelVibePreview(session.snapshot);
    }
    setReady(false);
    setPreviewed(null);
  }, []);

  const clearSpin = useCallback(() => {
    if (spinRef.current) clearTimeout(spinRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadVibePreview().then((preview) => {
      // Closed before the module arrived: nothing begins, so nothing is held.
      if (!live) return;
      sessionRef.current = { preview, snapshot: preview.beginVibePreview() };
      setReady(true);
    });
    return () => {
      live = false;
      end(false); // a no-op after Use or Cancel already ended it
    };
  }, [open, end]);

  useEffect(() => clearSpin, [clearSpin]);

  const pick = useCallback((vibe: VibeSpec) => {
    const session = sessionRef.current;
    if (!session) return;
    session.preview.previewVibe(vibe);
    setPreviewed({ base: vibe, spec: vibe });
  }, []);

  const reroll = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !previewed?.base.random) return;
    setRolling(true);
    try {
      const { spec, headline, detail } = session.preview.rerollPreview(previewed.base);
      setPreviewed({ base: previewed.base, spec, reroll: { headline, detail } });
    } finally {
      // The spin stops even if the reroll throws.
      scheduleTimeout(spinRef, () => setRolling(false), ROLLING_MS);
    }
  }, [previewed]);

  const togglePlay = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !previewed) return;
    if (playing) session.preview.stopPreview();
    else session.preview.playPreview();
  }, [playing, previewed]);

  const use = useCallback(() => {
    if (!sessionRef.current || !previewed) return;
    end(true);
    useAppStore.getState().showFeedback(vibeLoadedFeedback(previewed));
    onClose();
  }, [end, onClose, previewed]);

  const cancel = useCallback(() => {
    end(false);
    onClose();
  }, [end, onClose]);

  return { ready, previewed, playing, rolling, pick, reroll, togglePlay, use, cancel };
}

export interface UseVibesButton {
  open: boolean;
  show: () => void;
  hide: () => void;
}

/** The picker's open state lives with the button that owns the picker (spec §3). */
export function useVibesButton(): UseVibesButton {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, show, hide };
}
```

If `useVibePicker` exceeds `max-lines-per-function` or `complexity`, move `pick`/`reroll`/`togglePlay` bodies into file-local plain functions taking `(session, …)`; never raise a cap.

- [ ] **Step 3: `src/components/vibes/VibePickerModal.tsx`.**

```tsx
import { Dices, Play, Square } from 'lucide-react';
import { VIBES, type VibeSpec } from '@/data/vibes';
import { Modal } from '@/components/ui/Modal';
import { cx } from '@/components/ui/cx';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { useVibePicker, vibeSummaryLine, type VibePreviewed } from './useVibePicker';

interface VibeCardProps {
  vibe: VibeSpec;
  selected: boolean;
  disabled: boolean;
  rolling: boolean;
  onPick: (vibe: VibeSpec) => void;
  onReroll: () => void;
}

/** One vibe. The card being previewed is pressed and alone carries the dice. */
function VibeCard({ vibe, selected, disabled, rolling, onPick, onReroll }: VibeCardProps) {
  return (
    <div className="relative">
      <button id={`btn-vibes-card-${vibe.id}`} type="button" aria-pressed={selected} disabled={disabled}
        onClick={() => onPick(vibe)}
        className={cx('btn w-full h-auto min-h-11 flex-col items-start gap-0.5 py-2 text-left normal-case',
          selected ? 'btn-primary' : 'btn-soft')}>
        <span className="text-lg leading-none" aria-hidden="true">{vibe.emoji}</span>
        <span className="text-sm font-semibold">{vibe.name}</span>
        <span className="text-xs tabular-nums opacity-70">
          {vibe.bpm} BPM · {formatKeyLabel(vibe.scaleRoot, vibe.scaleType)}
        </span>
      </button>
      {selected && vibe.random && (
        <button id="btn-vibes-reroll" type="button" aria-label={`Reroll ${vibe.name}`} title={`Reroll ${vibe.name}`}
          onClick={onReroll} className="btn btn-sm btn-square btn-ghost absolute top-0 right-0 min-h-11 min-w-11">
          <Dices className={cx('w-4 h-4', rolling && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface VibeFooterProps {
  previewed: VibePreviewed | null;
  playing: boolean;
  onTogglePlay: () => void;
  onCancel: () => void;
  onUse: () => void;
}

/** Pinned below the grid: what is previewing, Play/Stop on the left, Cancel/Use on the right. */
function VibeFooter({ previewed, playing, onTogglePlay, onCancel, onUse }: VibeFooterProps) {
  return (
    <div className="shrink-0 border-t border-base-300 pt-3 flex flex-col gap-2">
      <div aria-live="polite">
        <p id="vibes-summary" className="text-sm font-semibold">{vibeSummaryLine(previewed)}</p>
        {previewed?.reroll && (
          <>
            <p className="text-xs">{previewed.reroll.headline}</p>
            <p className="text-xs text-base-content/70">{previewed.reroll.detail}</p>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button id="btn-vibes-play" type="button" className="btn btn-ghost min-h-11 gap-1"
          disabled={!previewed} onClick={onTogglePlay}>
          {playing ? <Square className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
          {playing ? 'Stop' : 'Play'}
        </button>
        <div className="ml-auto flex gap-2">
          <button id="btn-vibes-cancel" type="button" className="btn btn-ghost min-h-11" onClick={onCancel}>Cancel</button>
          <button id="btn-vibes-use" type="button" className="btn btn-primary min-h-11"
            disabled={!previewed} onClick={onUse}>Use</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The vibe picker (R334): a centred Modal on both frames. The box is a column —
 * Modal's own header, the card grid (the only thing that scrolls), the footer.
 * Every way out but Use routes through `cancel`, which restores the loop.
 */
export function VibePickerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = useVibePicker(open, onClose);
  return (
    <Modal open={open} onClose={p.cancel} title="Vibes" size="lg" boxClassName="flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {VIBES.map((vibe) => (
            <VibeCard key={vibe.id} vibe={vibe} selected={p.previewed?.base.id === vibe.id}
              disabled={!p.ready} rolling={p.rolling} onPick={p.pick} onReroll={p.reroll} />
          ))}
        </div>
      </div>
      <VibeFooter previewed={p.previewed} playing={p.playing}
        onTogglePlay={p.togglePlay} onCancel={p.cancel} onUse={p.use} />
    </Modal>
  );
}
```

- [ ] **Step 4: `src/components/vibes/VibesButton.tsx`.**

```tsx
import { Sparkles } from 'lucide-react';
import { MenuRowButton, type ToolVariantProps } from '@/components/ui/MenuRowButton';
import { VibePickerModal } from './VibePickerModal';
import { prefetchVibePreview, useVibesButton } from './useVibePicker';

const ICON = <Sparkles className="w-4 h-4" aria-hidden="true" />;

/**
 * The only way to the vibes (R333): a loop-layer `HEADER_TOOLS` row. `bar` in
 * the desktop Header, `row` in the phone's menu sheet — where the picker is a
 * dialog nested in the sheet's dialog (R320). Hover/focus warms the preview module.
 */
export function VibesButton({ variant = 'bar' }: ToolVariantProps) {
  const { open, show, hide } = useVibesButton();
  return (
    <>
      {variant === 'row' ? (
        <MenuRowButton id="btn-vibes" aria-haspopup="dialog" label="Vibes" icon={ICON}
          onClick={show} onMouseEnter={prefetchVibePreview} onFocus={prefetchVibePreview} />
      ) : (
        <button id="btn-vibes" type="button" className="btn btn-sm btn-ghost gap-1 px-2 text-xs font-bold"
          aria-haspopup="dialog" aria-label="Vibes" title="Vibes"
          onClick={show} onMouseEnter={prefetchVibePreview} onFocus={prefetchVibePreview}>
          {ICON}
          <span className="hidden lg:inline">Vibes</span>
        </button>
      )}
      <VibePickerModal open={open} onClose={hide} />
    </>
  );
}
```

- [ ] **Step 5: `headerTools.ts`.** Import `VibesButton` from `@/components/vibes/VibesButton`; add `'vibes'` to `HeaderToolId`; insert `{ id: 'vibes', Component: VibesButton, layers: LOOP },` after the `loop-selector` row.

- [ ] **Step 6: Run.** `bun test src/components` → PASS; `bun run lint && bun run eslint && bun test && bun run check:dead-code && bun run check:dead-code:production` → green, zero warnings, zero Knip findings (the `vibePreview.ts` exports now have their importer). If Knip flags `UseVibePicker`/`UseVibesButton`, follow the precedent of `UseExportDialog` (`export/useExportDialog.ts`); any other flagged export loses its `export`.

- [ ] **Step 7: Manual smoke.** `bun run dev`, open `http://localhost:3000` on the loop layer: the Header shows the Vibes button after the loop picker; it opens the picker; a card previews and plays; Cancel restores. (The full check is Task 9.)

- [ ] **Step 8: Commit**

```bash
git add src/components/vibes src/components/header/headerTools.ts src/components/header/headerTools.test.ts \
  src/components/header/toolRows.test.tsx src/components/Header.test.tsx \
  src/components/shell/mobileShell.test.tsx src/components/shell/shells.test.tsx
git commit -m "feat(vibes): vibe picker modal behind a Vibes header tool" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Remove the Instant Vibes strip

Spec §8 (deletions), F1, F7, F19; R333.

**Files:**
- Delete: `src/components/InstantVibesBar.tsx`, `src/components/InstantVibesBar.test.tsx`, `src/components/vibeActions.ts`
- Modify: `src/components/shell/ShellBody.tsx`, `src/components/shell/shells.test.tsx`
- Modify (comments only): `src/components/TransportBar.test.tsx`, `src/components/loop/ChordView.test.tsx`, `src/components/loop/SequencerView.test.tsx`, `src/components/song/LoopCopyDialog.tsx`, `src/data/vibes.ts`, `src/index.css`

**Interfaces:**
- Consumes: `btn-vibes` (Task 4).
- Produces: no vibe UI outside `components/vibes/*`. `applyVibeToStore` now has only test callers (removed in Task 6).

- [ ] **Step 1: Failing test — `shells.test.tsx`.**
  - Desktop marker list: remove `'id="btn-vibe-'` (keep `'id="btn-vibes"'` from Task 4). Mobile marker list: remove `'id="btn-vibe-'`.
  - The host-order test: replace the vibe-bar line and its comment with
    ```ts
    // Under the top bar: before the pages, the first thing ShellBody renders.
    expect(mobile.indexOf('id="feedback-host"')).toBeLessThan(mobile.indexOf('id="btn-solo-target"'));
    ```
  - Add to `describe('the shells')`:
    ```ts
    test('no frame renders a vibe strip; vibes open only from the Vibes tool (R333)', () => {
      for (const html of [desktop, mobile]) expect(html).not.toContain('id="btn-vibe-');
      expect(read('./ShellBody.tsx')).not.toContain('Vibes');
    });
    ```
  - In `Workspace keeps what survives a layout switch`, drop `'<InstantVibesBar'` from the frame list.

  Run: `bun test src/components/shell/shells.test.tsx` → FAIL (the strip still renders `btn-vibe-…`).

- [ ] **Step 2: `ShellBody.tsx`.** Delete the `InstantVibesBar` import, the strip's comment block and `{!isSongLayer(activeTab) && <InstantVibesBar />}`; then delete the now-unused `activeTab` selector, `isSongLayer` import and, if nothing else uses it, the `useAppStore` import. Update the component's docblock if it lists the strip.

- [ ] **Step 3: Delete** `src/components/InstantVibesBar.tsx`, `src/components/InstantVibesBar.test.tsx`, `src/components/vibeActions.ts` (`git rm`). Their behaviour is covered by `vibePreview.test.ts` (Task 3) and the vibes tests; `scheduleTimeout` keeps its caller in `useVibePicker.ts` (spec §8 — if Knip still flags it, un-export it).

- [ ] **Step 4: Stale names.** `git grep -n "InstantVibesBar\|vibeActions" -- src` and fix every hit:
  - `TransportBar.test.tsx`, `ChordView.test.tsx`, `SequencerView.test.tsx`: the comments citing `InstantVibesBar.test.tsx` as an example of the `renderToString` trap cite `ui/BottomInputDock.tsx`'s `useLiveStore` instead (`testing.md`, R257).
  - `song/LoopCopyDialog.tsx`: "(Header, InstantVibesBar, ...)" → "(Header, the vibe picker, ...)".
  - `data/vibes.ts`: "tokens in InstantVibesBar" → "tokens in `components/vibes/VibePickerModal.tsx`".
  - `index.css` (`no-scrollbar` comment): drop `InstantVibesBar` from the list of users.
  - Must print nothing afterwards except `store/vibes.ts` comments handled in Task 6.

- [ ] **Step 5: Run.** `bun test src/components` → PASS; `bun run lint && bun run eslint && bun test && bun run check:dead-code && bun run check:dead-code:production && bun run build` → green, zero warnings, zero findings.

- [ ] **Step 6: Commit**

```bash
git add -A src/components src/data/vibes.ts src/index.css
git commit -m "refactor(vibes): remove the Instant Vibes strip" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Drop `applyVibeToStore` and its restart

Spec §5.1 (last bullet), §8 (tests updated), F2, F6.

**Files:**
- Create: `src/store/vibeWriteFixture.ts`
- Modify: `src/store/vibes.ts`, `src/store/vibes.test.ts`, `src/store/vibes.atomic.test.ts`, `src/store/customStepSequencer.test.ts`
- Modify (comments only): `src/store/loadLoop.ts`, `src/store/playbackScope.ts`, `src/store/stopAndRestart.ts`, `src/store/vibeVariation.ts`, `src/store/musicContextSlice.ts`, `src/audio/drumGrids.ts`, `src/data/effectChains.ts`

**Interfaces:**
- Consumes: `previewVibe` (Task 3), `resolveVibeVoices`, `withMirror`, `vibeContentPatch` (Task 3).
- Produces: `src/store/vibeWriteFixture.ts`: `export function writeVibe(vibe: ResolvedVibe): void` — a vibe's content in one write, no transport. `applyVibeToStore` and `VIBE_SWAP_RELEASE` no longer exist in `vibes.ts`; `commitRestartAfterStop` keeps its `loadLoop.ts` caller (F6).

- [ ] **Step 1: The fixture.** `src/store/vibeWriteFixture.ts`:

```ts
import { useAppStore } from './store';
import { resolveVibeVoices, vibeContentPatch, withMirror, type ResolvedVibe } from './vibes';

/**
 * A vibe's content in ONE write, with the loops[] mirror — previewVibe
 * without the stop, the cut and the play. For tests that assert on what a
 * vibe writes; the transport side is vibePreview.test.ts's (R337).
 */
export function writeVibe(vibe: ResolvedVibe): void {
  useAppStore.setState((s) => withMirror(s, vibeContentPatch(s, vibe, resolveVibeVoices(vibe))));
}
```

- [ ] **Step 2: Move the tests off `applyVibeToStore`** (they still pass against it before Step 3; afterwards they must be the only proof).
  - `vibes.test.ts`: import `writeVibe` from `./vibeWriteFixture`; replace every `applyVibeToStore(` with `writeVibe(`; drop `applyVibeToStore` from the `./vibes` import. **Delete** the three describe blocks that test the restart, which no longer exists: `'applyVibeToStore transport handling'`, `'applyVibeToStore audible cut'` (ported to `vibePreview.test.ts` in Task 3), `'applyVibeToStore leaves a scope that matches what is sounding'`. Rename remaining titles that say `applyVibeToStore` to "a vibe write …" (e.g. `'a vibe write re-clamps the custom pattern lanes'`, `'a vibe write — the FX track'`). Drop imports the deletions orphan (`spyOn`, `audioEngine`, … — let `tsc`/eslint tell you).
  - `vibes.atomic.test.ts` — rewritten against `previewVibe` (spec §8): import `previewVibe` from `./vibePreview`; `applyVibeToStore(RESOLVED_VIBES[0])` → `previewVibe(VIBES[0])`; the waltz case → `previewVibe(VIBES.find((v) => v.id === 'lofi-waltz')!)` (keep the `meter` guard on the resolved one); describe title → `'previewVibe writes the vibe in one atomic patch'`; the header comment says "Pins that previewing a vibe is ONE content write". The stop and `soloLoop` in `previewVibe` touch no content key, so the notification counts stay 101 and 1. The `vibeContentPatch is pure` test builds its voices with `resolveVibeVoices(vibe)`. Keep `afterEach`'s `hardStopAll()`.
  - `customStepSequencer.test.ts`: `applyVibeToStore(resolveVibe(VIBES[0]))` → `writeVibe(resolveVibe(VIBES[0]))`; title → `'a vibe write returns both modes to preset'`.

  Run: `bun test src/store/vibes.test.ts src/store/vibes.atomic.test.ts src/store/customStepSequencer.test.ts` → PASS.

- [ ] **Step 3: `vibes.ts`.** Delete `applyVibeToStore` and `VIBE_SWAP_RELEASE`, and the imports only they used (`audioEngine`, `ACCOMPANIMENT_SOURCES`, `useAppStore`, `commitRestartAfterStop`, `captureActivePlayers`). Rewrite the file header's second paragraph: "That ordering is the same rule `previewVibe` (`store/vibePreview.ts`) follows: resolve the vibe and its voices before any state is touched, for the same reason — a throw part-way through a swap leaves the store holding half of one vibe and half of another." `git grep -n applyVibeToStore -- src` must now list only the comments below.

- [ ] **Step 4: Comments.** In each file, rewrite the sentence that cites `applyVibeToStore` or its restart so it states today's truth, keeping the surrounding rationale:
  - `loadLoop.ts` — the swap it "mirrors verbatim" is now its own; say `loadLoop` is `commitRestartAfterStop`'s one caller.
  - `stopAndRestart.ts` — the header names two callers; now `loadLoop` only (a vibe preview never restarts, R337).
  - `playbackScope.ts` (both spots) — drop `applyVibeToStore` from the list of hard-stop-and-restart callers.
  - `vibeVariation.ts` — the reroll is previewed through `previewVibe` by `rerollPreview` (`store/vibePreview.ts`), and "applyVibeToStore never writes it" → "no vibe write touches it".
  - `musicContextSlice.ts` — `selectedVibeId` "is written by a vibe preview (`previewVibe`)".
  - `audio/drumGrids.ts`, `data/effectChains.ts` — "applyVibeToStore writes …" → "a vibe write (`vibeContentPatch`) writes …".
  - Afterwards `git grep -n "applyVibeToStore" -- src` prints nothing.

- [ ] **Step 5: Run.** `bun run lint && bun run eslint && bun test && bun run check:dead-code && bun run check:dead-code:production` → green, zero warnings, zero findings (`captureActivePlayers` / `commitRestartAfterStop` still have `loadLoop.ts`; if Knip flags either, un-export it).

- [ ] **Step 6: Commit**

```bash
git add -A src/store src/audio/drumGrids.ts src/data/effectChains.ts
git commit -m "refactor(vibes): drop applyVibeToStore and its restart-after-stop" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: ADR-0045 and rules R333–R338

Spec §9, §11. No code.

**Files:**
- Create: `docs/decisions/0045-vibe-picker-preview.md`
- Modify: `docs/decisions/README.md`, `docs/decisions/0009-vibes-as-data-and-single-drum-grid-library.md`, `.claude/rules/components.md`, `.claude/rules/persistence.md`, `.claude/rules/note-input.md`, `.claude/rules/playback.md`, `.claude/rules/vibes-and-grids.md`, `.claude/skills/instant-vibes/SKILL.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: every name from Tasks 1–6.
- Produces: R333–R338 (next free after R332), ADR-0045.

Rule texts (verbatim; each rule file line ends `<!-- R3xx -->` and links ADR-0045):
- **R333** (`components.md`) — Vibes are reached only through the `vibes` `HEADER_TOOLS` row (`components/vibes/VibesButton.tsx`); no frame renders an always-visible vibe strip.
- **R334** (`components.md`) — The vibe picker is a centred `Modal` on both frames: the card grid scrolls between Modal's pinned header and a pinned footer; **Use** (and Play) stay disabled until a vibe has been previewed.
- **R335** (`persistence.md`) — Only the vibe preview holds persisted writes (`holdPersistedWrites`/`releasePersistedWrites`); the hold flushes first; nothing is written while held, `pagehide`/hidden included; release writes once.
- **R336** (`note-input.md`) — `noteInputSuspended` gates QWERTY notes, QWERTY drum pads and MIDI note-on/CC at their entry (note-off and keyup pass); its rising edge releases every held QWERTY note.
- **R337** (`playback.md`) — A vibe preview is stop → cut → one write → `soloLoop(activeLoopId)`; opening and closing the picker leave the transport stopped; vibes never restart after a stop.
- **R338** (`vibes-and-grids.md`) — Cancel restores `captureVibeTargets` in one write; every key a vibe patch writes is in the snapshot, pinned by the invariant test in `vibePreview.test.ts`.

Prohibited lines (one per rule, in each file's `## Prohibited`):
- `- An always-visible vibe strip, or a vibe entry point outside the \`vibes\` HEADER_TOOLS row <!-- R333 -->`
- `- A vibe picker that is a BottomSheet, a drawer or non-modal, or a Use enabled before a preview <!-- R334 -->`
- `- Holding persisted writes anywhere but the vibe preview, or a held writer that writes on flush/pagehide <!-- R335 -->`
- `- A note or drum-pad keydown, MIDI note-on or CC that ignores noteInputSuspended <!-- R336 -->`
- `- playAll() from the vibe picker, or restarting the transport after a vibe write <!-- R337 -->`
- `- A vibe patch key missing from captureVibeTargets, or a Cancel that restores in more than one write <!-- R338 -->`

- [ ] **Step 1: ADR-0045.** `docs/decisions/0045-vibe-picker-preview.md` in the template of `docs/decisions/README.md` (read it; mirror ADR-0044's headings): `# ADR-0045: Vibe picker with preview`, `**Status:** Accepted — 2026-09-24. Amends [ADR-0009](0009-vibes-as-data-and-single-drum-grid-library.md) (R086, R095).`
  - **Context:** the strip cost a row on both frames for an action used rarely, mostly at project start; a chip click overwrote the loop with no audition and no undo (spec §1, F2).
  - **Decision:** one bullet each — the strip is removed and vibes open from a `vibes` `HEADER_TOOLS` row (menu row on the phone, nested dialog); the picker is a centred `Modal` with a pinned header/footer and a scrolling grid (no footer prop added); preview commands in `store/vibePreview.ts` (the table of spec §5.1) with the loop-scope `soloLoop`, never `playAll`; the snapshot `captureVibeTargets` restored in one write, relying on R210; the persistence hold on both writers, flushed first, so a closed tab reloads the pre-preview state; the `noteInputSuspended` flag and its gates; `applyVibeToStore` and its restart deleted, `vibeActions.ts` folded into the commands; the preview module stays lazy (R095).
  - **Rejected alternatives:** spec §11, one bullet each.
  - **Consequences:** one more tap to reach vibes; opening stops playback and the user presses Play after closing; on the phone the Use toast waits until the menu sheet closes (R329); a MIDI key held across the open releases on its own note-off; the snapshot covers exactly what a vibe writes, so a new vibe-written key must join `captureVibeTargets` (the test fails first).
  - **Rules this implies:** R333–R338, texts above; R086 and R095 reworded.
  - **Sources:** `docs/superpowers/specs/2026-09-24-vibe-picker-modal-design.md`, `docs/superpowers/plans/2026-09-24-vibe-picker-modal.md`; ADR-0009, ADR-0022, ADR-0041, ADR-0044.

  Index row in `docs/decisions/README.md` after 0044:
  `| [0045](0045-vibe-picker-preview.md) | Vibe picker with preview | Vibes open from a Header tool into a centred Modal that auditions a vibe on the current loop (stop, cut, one write, soloLoop); Use keeps it, every other exit restores a one-write snapshot; persisted writes are held and note input suspended while it is open. |`

- [ ] **Step 2: ADR-0009.** Under its status line add: "**Amended by [ADR-0045](0045-vibe-picker-preview.md):** the strip is gone; vibes are written by `previewVibe` (R086) and the picker loads the preview module lazily (R095)." Leave its body as history.

- [ ] **Step 3: Rule files.**
  - `components.md`: R333, R334 as bullets in the section that holds `HEADER_TOOLS` / the layout shell; their Prohibited lines.
  - `persistence.md`: R335 beside the persist-write-path rules; Prohibited line.
  - `note-input.md`: R336; Prohibited line.
  - `playback.md`: add `"src/store/vibePreview.ts"` to `paths:`; R337; Prohibited line.
  - `vibes-and-grids.md`: `paths:` replace the `InstantVibesBar.tsx` and `vibeActions.ts` entries with `"src/components/vibes/**"` (`src/store/vibe*.ts` already covers `vibePreview.ts`). R086 → "…`resolveVibe` (`store/vibes.ts`) turns one into a `ResolvedVibe`; `previewVibe` (`store/vibePreview.ts`) writes it through `vibeContentPatch`." R095 → "The vibes table resolves nothing at module scope; the vibe picker (`components/vibes/*`) imports `VIBES` eagerly, makes no resolver call, and reaches `store/vibePreview.ts` only through a cached dynamic `import()`." Its Prohibited line → "A resolver call at module scope or in `components/vibes/*`, or a static import of `store/vibePreview` from a component". Add R338 and its Prohibited line. The intro sentence "Instant Vibes as data, …" stays.
  - Check: `git grep -n "R33[3-8]" -- .claude/rules docs/decisions` shows each id in exactly one rule file and in ADR-0045.

- [ ] **Step 4: `instant-vibes` skill** (`.claude/skills/instant-vibes/SKILL.md`):
  - `description:` "the genre chips in the top bar" → "the genre cards in the Vibes picker (a Header tool)"; "the dice that rerolls them" stays.
  - Intro: "A vibe is a card in the Vibes picker. Picking one previews it on the current loop; Use keeps it, Cancel restores the loop; the dice on the previewed card rerolls it into different music with the same identity."
  - "why the always-mounted top bar can import it eagerly" → "why the picker can import it eagerly".
  - `applyVibeToStore(resolved)` / `applyVibeToStore` writes all … → `previewVibe` (`store/vibePreview.ts`) writes it through `vibeContentPatch`.
  - The chip-styling bullet: "the card's look comes from theme tokens in `components/vibes/VibePickerModal.tsx`".
  - The eager-import paragraph: the picker imports `VIBES` eagerly; the preview module loads lazily; drop the `store/vibeChips.ts` history only if it no longer reads true.
  - `## Never touch applyVibeToStore` → `## Never reorder the preview commands`: `store/vibePreview.ts` runs `hardStopAll()`, then the synchronous `stopSource('chord'|'bass'|'pad', 0.02)` cut **before** the one content write, then `soloLoop(activeLoopId)`; the two overlapping-audio fixes (`d8df714`, `c4a253a`) live in that ordering; `vibePreview.test.ts` pins it; adding a vibe is pure data and touches none of it — and a vibe that writes a new store key must add it to `captureVibeTargets` (R338).
  - `git grep -n "InstantVibesBar\|vibeActions\|applyVibeToStore\|top bar\|chip" .claude/skills/instant-vibes` → nothing current-tense about the strip.

- [ ] **Step 5: `CLAUDE.md`.** Skills line: "`instant-vibes` (the vibe chips and the dice)" → "`instant-vibes` (the vibe picker and the dice)". Nothing else (no counts, R001).

- [ ] **Step 6: Run.** `bun run eslint && bun test` (docs-only; confirms nothing reads these files in a test that broke). `git grep -n "InstantVibesBar\|vibeActions\|applyVibeToStore" -- .claude CLAUDE.md docs/decisions` → only ADR history (ADR-0009 body, ADR-0045's own narrative).

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/0045-vibe-picker-preview.md docs/decisions/README.md \
  docs/decisions/0009-vibes-as-data-and-single-drum-grid-library.md .claude/rules/components.md \
  .claude/rules/persistence.md .claude/rules/note-input.md .claude/rules/playback.md \
  .claude/rules/vibes-and-grids.md .claude/skills/instant-vibes/SKILL.md CLAUDE.md
git commit -m "docs(decisions): ADR-0045 vibe picker preview, rules R333-R338" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sync the architecture notes

Spec §9 (last sentence). No code. Historical plans stay as written; no line numbers in new text.

**Files:**
- Modify: `docs/design.md`, `docs/architecture/feature-overview.md`, `docs/architecture/structure/README.md`, `docs/architecture/structure/01-ui.md`, `docs/architecture/structure/02-store.md`

- [ ] **Step 1: Find every hit.** `git grep -n "InstantVibesBar\|vibeActions\|applyVibeToStore\|Vibes bar\|vibe chip" -- docs/design.md docs/architecture`.
- [ ] **Step 2: Edit.**
  - `design.md` item 2: the strip → "**`components/vibes/`** — the Vibes Header tool and its picker modal: eight genre cards previewed on the current loop, kept on Use, undone on Cancel; the dice rerolls the previewed card." Item 13: drop `InstantVibesBar.tsx` from the list. The "Resolved: the forked Instant Vibes module" section is history — leave it.
  - `feature-overview.md`: row 6's location "Top bar" → "Header tool → picker modal"; the mermaid shell node drops `InstantVibesBar`; the `components/` row lists `vibes/*` if it enumerates feature folders.
  - `structure/README.md`: the mermaid `Shell` node drops `InstantVibesBar`; the S8 row stays as history but says the one write now lives in `vibeContentPatch`, applied by `previewVibe`.
  - `structure/01-ui.md`: both render-order lists drop `InstantVibesBar`; the mermaid `V[...]` node becomes the Vibes tool (`VibesButton → VibePickerModal`) under the Header tools; the interaction rows 22–25 point at `vibes/VibePickerModal.tsx`, `vibes/useVibePicker.ts`, `store/vibePreview.ts` (open, preview, reroll, Play/Stop, Use toast, Cancel; the prefetch is on hover/focus); the store-reads row for `InstantVibesBar` becomes one for `useVibePicker` (`isAnyPlayerActive` only; the preview module via lazy `import()`); the `vibeActions.ts` findings and the `useTimedToast` note are marked resolved by ADR-0045.
  - `structure/02-store.md`: the `vibes.ts applyVibeToStore` row becomes `vibePreview.ts` (commands, R337) + `vibes.ts` (`vibeContentPatch`, `captureVibeTargets`, R338); finding 3 stays as history, noting `applyVibeToStore` was removed by ADR-0045.
- [ ] **Step 3: Check.** Re-run the Step 1 grep → only historical/"resolved" mentions remain.
- [ ] **Step 4: Commit**

```bash
git add docs/design.md docs/architecture
git commit -m "docs: sync architecture notes for the vibe picker" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Completion gate and browser check

**Files:** none unless the gate or the check finds a defect (then fix in place, re-run, and commit as `fix(vibes): …` with the Co-Authored-By line).

- [ ] **Step 1: Gate.** `bun run verify` → green (all tests, lint, eslint, `check:keys`, `check:drums`, `check:contrast`, `check:levels`, both Knip scans, build). `bun run eslint` → **zero errors, zero warnings**. `bun run check:dead-code` and `bun run check:dead-code:production` → zero findings. Record each warning seen anywhere (build, tests, console) and its decision.
- [ ] **Step 2: Browser check** — a real browser (DevTools device mode for the phone), `bun run dev`, `http://localhost:3000`. Desktop (≥ 1024px) **and** 375 × 812:
  1. Open: desktop from the Header's Vibes button; phone from ☰ → Vibes (the picker opens above the menu sheet). The loop-layer transport stops on open.
  2. Layout: eight cards (2 columns on the phone, 4 on desktop); the grid scrolls while the "Vibes" header and the footer stay pinned; every footer button ≥ 44px.
  3. Preview: a card presses, the loop plays under the loop scope (the loop card's play state, not the song), the footer reads `name · key · BPM`; picking another card switches with no overlapping chords.
  4. Dice: only the previewed card shows 🎲; it spins, the sound changes, the footer shows the headline and detail; no toast appears.
  5. Play/Stop: Stop silences; Play replays the rerolled variant, not the authored vibe.
  6. Cancel restores: note the loop's chords, BPM, key, Beat kit and name first; preview two vibes and a reroll; Cancel (also try Esc, ✕ and the backdrop) → all back exactly; transport stopped.
  7. Use persists: preview, Use → the "Loaded …" toast (on the phone only once the menu sheet is dismissed); reload → the used vibe is still there.
  8. Mid-preview reload keeps the pre-preview state: open, preview a vibe, reload the tab without closing → the loop is as it was before opening.
  9. Input is silent while open: QWERTY note keys and drum-pad keys make no sound; a MIDI controller's notes and CC knobs do nothing (if hardware is available — else note "not checked"); a QWERTY note held while clicking Vibes stops sounding at open. After closing, QWERTY and MIDI play again.
  10. Esc on the phone closes only the picker, leaving the menu sheet open.
  11. Review Focus 3 and 5: press Esc immediately on the very first open (cold module) → no stuck state (keys play, reload keeps edits made after); with the picker open, resize across 768px → the picker disappears, the loop is restored, the transport stopped, keys play.
- [ ] **Step 3: Report.** Record the gate output summary, the warning decisions and the check results in the task report (no file). If Step 1 or 2 required a fix, commit it and re-run `bun run verify`.

---

## Spec coverage

| Spec | Task |
|---|---|
| §3 entry point, `HEADER_TOOLS` row, `VibesButton` variants, nested dialog, prefetch | 4 |
| §4 surface: `Modal` lg, pinned header/footer, grid, footer summary, Use disabled | 4 |
| §5.1 commands; `resolveVibeVoices`, `withMirror` export; `applyVibeToStore` deleted; comment rewrites | 3, 6 |
| §5.2 `captureVibeTargets` + invariant test | 3 |
| §5.3 `useVibePicker` state and actions, Use toast, unmount cancels | 4 |
| §5.4 lazy boundary; `vibeActions.ts` deleted | 4, 5 |
| §6 persistence hold | 1 (+ `beginVibePreview`, 3) |
| §7 note-input suspension | 2 |
| §8 files, deletions, `scheduleTimeout`, tests updated | 3–6 |
| §9 ADR-0045, R333–R338, R095 (+ R086), paths, ADR-0009, skill, CLAUDE.md | 7 |
| §9 design.md, architecture docs | 8 |
| §10 tests | 1–4, 6; manual: 9 |
| §10 gate | every task; 9 |

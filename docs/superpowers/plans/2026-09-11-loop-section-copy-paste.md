# Loop Section Copy/Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single "copy loop" button in the app shell and a per-module "paste" button, so a whole loop can be copied as a source and individual modules pasted into another loop.

**Architecture:** A one-slot, session-only source buffer (`{ sourceLoopId }`) lives in the ui slice. The source label is derived from the current loop instead of duplicated in the buffer, and a project install clears the reference. Two thin actions — `copyLoopSection()` and `pasteLoopSection(groups)` — write and consume it, with paste reusing the existing `applyLoopCopy`. Two small components (`LoopCopyButton`, `ModulePasteButton`) sit on top; the copy button is placed in the app shell next to `LoopSelector`, and a paste button is placed in the top-right of each module card.

**Tech Stack:** TypeScript, React, Zustand, bun:test, lucide-react icons, daisyUI classes.

**Spec:** `docs/superpowers/specs/2026-09-11-loop-section-copy-paste-design.md`

## Global Constraints

- Test runner is **bun:test** (`bun test <file>`). No DOM, no testing-library; rendered markup is `renderToString` + substring assertions.
- Session-only state must be **absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`** — never persisted.
- The zustand + `renderToString` trap: `useAppStore((s) => …)` serves creation-time state as the server snapshot. A component whose rendered output depends on state a test sets before render must use `useLiveStore` (see `src/components/loop/PatternView.tsx` and `.claude/rules/testing.md`).
- No new dependencies. Components may import `@/store/*`, never `@/audio/engine`.
- No toast — paste applies immediately; the paste button's `disabled` state is the feedback.
- Run `bun run verify` (test + lint + eslint + check:* + build) before claiming the whole feature done; run `bun test <file>` per task.
- Commit per task with `git add <specific files>` (never `git add -A`).

## File Structure

- `src/store/types.ts` — add the `LoopClipboard` interface and three `UiSlice` members.
- `src/store/uiSlice.ts` — add the buffer field + `setLoopClipboard` / `clearLoopClipboard`.
- `src/store/loopClipboard.ts` — NEW: `pasteGroupsFor`, `copyLoopSection`, `pasteLoopSection`.
- `src/components/loop/LoopCopyButton.tsx` — NEW: the header copy button.
- `src/components/loop/ModulePasteButton.tsx` — NEW: the per-module paste button.
- `src/components/Header.tsx` — wire the copy button next to `LoopSelector`.
- `src/components/loop/SoundView.tsx` — wire paste buttons into the Synth and Drum Sound sections.
- `src/components/loop/chord/ModulePanelCard.tsx` — add an `actions` slot to the header cluster.
- `src/components/loop/chord/ChordModulePanel.tsx`, `BassModulePanel.tsx`, `PadModulePanel.tsx` — pass module paste buttons.
- `src/components/loop/ChordView.tsx`, `PatternView.tsx`, `SequencerView.tsx` — wire paste buttons into segment headers.

---

### Task 1: Source buffer in the ui slice

**Files:**
- Modify: `src/store/types.ts` (add `LoopClipboard` interface + 3 `UiSlice` members)
- Modify: `src/store/uiSlice.ts` (field + setters)
- Test: `src/store/uiSlice.test.ts`

**Interfaces:**
- Produces: `LoopClipboard` type; `useAppStore.getState().loopClipboard: LoopClipboard | null`, `.setLoopClipboard(clipboard)`, `.clearLoopClipboard()`.

- [ ] **Step 1: Write the failing test**

In `src/store/uiSlice.test.ts`, append a describe after the existing `loop-copy session state` block:

```ts
describe('loop clipboard buffer', () => {
  afterEach(() => {
    useAppStore.getState().clearLoopClipboard();
  });

  test('starts empty', () => {
    expect(useAppStore.getState().loopClipboard).toBeNull();
  });

  test('setLoopClipboard stores the source reference', () => {
    useAppStore.getState().setLoopClipboard({ sourceLoopId: 'loop-source' });
    expect(useAppStore.getState().loopClipboard).toEqual({
      sourceLoopId: 'loop-source',
    });
  });

  test('clearLoopClipboard empties it', () => {
    useAppStore.getState().setLoopClipboard({ sourceLoopId: 'a' });
    useAppStore.getState().clearLoopClipboard();
    expect(useAppStore.getState().loopClipboard).toBeNull();
  });

  test('is NOT persisted — absent from partializeAppState and PROJECT_CONTENT_KEYS', () => {
    useAppStore.getState().setLoopClipboard({ sourceLoopId: 'a' });
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('loopClipboard' in persisted).toBe(false);
    expect([...PROJECT_CONTENT_KEYS]).not.toContain('loopClipboard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/uiSlice.test.ts`
Expected: FAIL — `useAppStore.getState().loopClipboard` / `.setLoopClipboard` / `.clearLoopClipboard` are undefined.

- [ ] **Step 3: Add the type**

In `src/store/types.ts`, immediately before `export interface UiSlice {` add:

```ts
/**
 * The one-slot copy-source buffer behind the loop editor's copy/paste buttons.
 * Copy is "copy all", so this is a reference to the source loop, not a
 * pre-selected group list — which groups move is decided per paste.
 * Session-only and never persisted.
 */
export interface LoopClipboard {
  sourceLoopId: string;
}
```

Inside `UiSlice`, after the `loopCopySourceId: string | null;` field, add:

```ts
  /**
   * The one-slot copy-source buffer for the loop editor's copy/paste buttons.
   * Session-only and NEVER persisted, like loopCopySelection above.
   * `sourceLoopId` may name a loop since deleted; paste clears the buffer when
   * it no longer resolves. Not cleared on a successful paste, so one copy can
   * be pasted into several loops in turn.
   */
  loopClipboard: LoopClipboard | null;
```

Inside `UiSlice`, after `setLoopCopySelection(...)` add:

```ts
  setLoopClipboard: (clipboard: LoopClipboard) => void;
  clearLoopClipboard: () => void;
```

- [ ] **Step 4: Add the slice members**

In `src/store/uiSlice.ts`, after `loopCopySourceId: null,` add:

```ts
    loopClipboard: null,
```

After the `setLoopCopySelection` arrow, add:

```ts
    setLoopClipboard: (loopClipboard) => set({ loopClipboard }),
    clearLoopClipboard: () => set({ loopClipboard: null }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/store/uiSlice.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/types.ts src/store/uiSlice.ts src/store/uiSlice.test.ts
git commit -m "feat(loop): add session-only copy-source buffer to the ui slice"
```

---

### Task 2: Copy/paste actions

**Files:**
- Create: `src/store/loopClipboard.ts`
- Test: `src/store/loopClipboard.test.ts`

**Interfaces:**
- Consumes: `useAppStore` state incl. `loops`, `activeLoopId`, `loopClipboard`, `setLoopClipboard`, `clearLoopClipboard`, `applyLoopCopy`; `loopLabel` from `./loop`.
- Produces: `pasteGroupsFor(groups: readonly LoopCopyGroupId[]): LoopCopyGroupId[]`; `copyLoopSection(): void`; `pasteLoopSection(groups): void`.

- [ ] **Step 1: Write the failing test**

Create `src/store/loopClipboard.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDefaultLoop } from './loopSlice';
import { loopStatePatch } from './loop';
import { pasteGroupsFor, copyLoopSection, pasteLoopSection } from './loopClipboard';
import { SCOPE_NONE } from './playbackScope';
import { useAppStore } from './store';

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
    loopClipboard: null,
    playbackScope: SCOPE_NONE,
    activeTab: 'sound',
  });
};

beforeEach(resetStore);
afterEach(resetStore);

describe('pasteGroupsFor', () => {
  test('a progression paste captures the key', () => {
    expect(pasteGroupsFor(['chord-progression'])).toEqual(['chord-progression', 'key']);
  });

  test('sound and rhythm pastes are unchanged', () => {
    expect(pasteGroupsFor(['chord-sound', 'chord-pattern'])).toEqual(['chord-sound', 'chord-pattern']);
    expect(pasteGroupsFor(['lead-sound'])).toEqual(['lead-sound']);
  });

  test('never adds key twice', () => {
    expect(pasteGroupsFor(['chord-progression', 'key'])).toEqual(['chord-progression', 'key']);
  });
});

describe('copyLoopSection / pasteLoopSection', () => {
  test('copy stores the active loop as the source', () => {
    const loop = { ...createDefaultLoop(), id: 'loop-a', name: 'Verse' };
    useAppStore.setState({ loops: [loop], activeLoopId: 'loop-a', ...loopStatePatch(loop) });

    copyLoopSection();

    expect(useAppStore.getState().loopClipboard).toEqual({
      sourceLoopId: 'loop-a',
    });
  });

  test('paste applies the resolved groups via applyLoopCopy, and does not clear the buffer', () => {
    const target = { ...createDefaultLoop(), id: 'loop-b' };
    const source = { ...createDefaultLoop(), id: 'loop-a', scaleRoot: 'C', scaleType: 'Major' };
    useAppStore.setState({
      loops: [target, source],
      activeLoopId: 'loop-b',
      ...loopStatePatch(target),
      loopClipboard: { sourceLoopId: 'loop-a' },
    });

    pasteLoopSection(['chord-progression']);

    const after = useAppStore.getState();
    expect(after.loops.find((l) => l.id === 'loop-b')!.scaleRoot).toBe('C');
    expect(after.loopClipboard).not.toBeNull();
  });

  test('paste onto the same loop is a no-op', () => {
    const loop = { ...createDefaultLoop(), id: 'loop-a' };
    useAppStore.setState({
      loops: [loop],
      activeLoopId: 'loop-a',
      ...loopStatePatch(loop),
      loopClipboard: { sourceLoopId: 'loop-a' },
    });

    pasteLoopSection(['mix']);
    expect(useAppStore.getState().loopClipboard).not.toBeNull();
  });

  test('paste clears the buffer when the source loop is gone', () => {
    const loop = { ...createDefaultLoop(), id: 'loop-b' };
    useAppStore.setState({
      loops: [loop],
      activeLoopId: 'loop-b',
      ...loopStatePatch(loop),
      loopClipboard: { sourceLoopId: 'loop-deleted' },
    });

    pasteLoopSection(['mix']);
    expect(useAppStore.getState().loopClipboard).toBeNull();
  });

  test('copy with no active loop is a no-op', () => {
    // activeLoopId is always a string; "no active loop" is a ghost id that
    // resolves to no loop in `loops`.
    useAppStore.setState({ loops: [], activeLoopId: 'ghost', loopClipboard: null });
    copyLoopSection();
    expect(useAppStore.getState().loopClipboard).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/loopClipboard.test.ts`
Expected: FAIL — module `./loopClipboard` does not exist.

- [ ] **Step 3: Write the actions**

Create `src/store/loopClipboard.ts`:

```ts
import { loopLabel } from './loop';
import type { LoopCopyGroupId } from './loopCopy';
import { useAppStore } from './store';

/**
 * The groups actually applied by a paste, plus the key implication. A chord
 * progression always carries `key`: the push model learns the target only at
 * paste time, and pasting absolute-root chords into a different key without
 * the key would leave the loop broken.
 */
export function pasteGroupsFor(groups: readonly LoopCopyGroupId[]): LoopCopyGroupId[] {
  return groups.includes('chord-progression') && !groups.includes('key')
    ? [...groups, 'key']
    : [...groups];
}

/** Remember the active loop as the copy source ("copy all"). No-op with no active loop. */
export function copyLoopSection(): void {
  const s = useAppStore.getState();
  const active = s.loops.find((loop) => loop.id === s.activeLoopId);
  if (!active) return;
  s.setLoopClipboard({ sourceLoopId: active.id });
}

/** Paste the buffered source's `groups` into the active loop. No-op on an empty
 *  buffer, a self-paste, or a source that no longer exists (the buffer is then
 *  cleared). */
export function pasteLoopSection(groups: readonly LoopCopyGroupId[]): void {
  const s = useAppStore.getState();
  const clip = s.loopClipboard;
  if (!clip || clip.sourceLoopId === s.activeLoopId) return;
  if (!s.loops.some((loop) => loop.id === clip.sourceLoopId)) {
    s.clearLoopClipboard();
    return;
  }
  s.applyLoopCopy(s.activeLoopId, clip.sourceLoopId, pasteGroupsFor(groups));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/store/loopClipboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/loopClipboard.ts src/store/loopClipboard.test.ts
git commit -m "feat(loop): add copy/paste actions over the copy-source buffer"
```

---

### Task 3: Copy and paste button components

**Files:**
- Create: `src/components/loop/LoopCopyButton.tsx`
- Create: `src/components/loop/ModulePasteButton.tsx`
- Test: `src/components/loop/LoopCopyButton.test.tsx`, `src/components/loop/ModulePasteButton.test.tsx`

**Interfaces:**
- Consumes: `copyLoopSection`, `pasteLoopSection` (Task 2); `LOOP_COPY_GROUPS`; `useLiveStore` from `../ui/useLiveStore`.
- Produces: `<LoopCopyButton />`; `<ModulePasteButton groups={[...]} />`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/loop/LoopCopyButton.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { LoopCopyButton } from './LoopCopyButton';

describe('LoopCopyButton', () => {
  test('renders a copy button', () => {
    const html = renderToString(<LoopCopyButton />);
    expect(html).toContain('id="btn-copy-loop"');
    expect(html).toContain('Copy');
  });
});
```

Create `src/components/loop/ModulePasteButton.test.tsx`:

```tsx
import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ModulePasteButton } from './ModulePasteButton';
import { useAppStore } from '@/store/store';

afterEach(() => {
  useAppStore.setState({ loopClipboard: null });
});

describe('ModulePasteButton', () => {
  test('renders disabled when there is no buffer', () => {
    const html = renderToString(<ModulePasteButton groups={['lead-sound']} />);
    expect(html).toContain('id="btn-paste-lead-sound"');
    expect(html).toContain('disabled');
  });

  test('renders enabled and named when a buffer is set', () => {
    useAppStore.setState({
      loopClipboard: { sourceLoopId: 'loop-a' },
      activeLoopId: 'loop-b',
    });
    const html = renderToString(<ModulePasteButton groups={['chord-progression']} />);
    expect(html).toContain('id="btn-paste-chord-progression"');
    expect(html).not.toContain('disabled');
    expect(html).toContain('Paste Chord progression from Verse');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/components/loop/LoopCopyButton.test.tsx src/components/loop/ModulePasteButton.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Write LoopCopyButton**

Create `src/components/loop/LoopCopyButton.tsx`:

```tsx
import { Copy } from 'lucide-react';
import { copyLoopSection } from '@/store/loopClipboard';

export function LoopCopyButton() {
  return (
    <button
      id="btn-copy-loop"
      type="button"
      onClick={() => copyLoopSection()}
      className="btn btn-sm btn-ghost gap-1.5 text-xs font-semibold"
      title="Copy this loop's sections"
    >
      <Copy className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Copy</span>
    </button>
  );
}
```

- [ ] **Step 4: Write ModulePasteButton**

Create `src/components/loop/ModulePasteButton.tsx`:

```tsx
import { ClipboardPaste } from 'lucide-react';
import { pasteLoopSection } from '@/store/loopClipboard';
import { LOOP_COPY_GROUPS } from '@/store/loopCopy';
import type { LoopCopyGroupId } from '@/store/loopCopy';
import { IconButton } from '../ui/IconButton';
import { useLiveStore } from '../ui/useLiveStore';

export function ModulePasteButton({ groups }: { groups: readonly LoopCopyGroupId[] }) {
  // useLiveStore, not useAppStore: the button's state depends on a buffer and
  // active loop a test sets before renderToString (see .claude/rules/testing.md).
  const clipboard = useLiveStore((s) => s.loopClipboard);
  const activeLoopId = useLiveStore((s) => s.activeLoopId);
  const disabled = !clipboard || clipboard.sourceLoopId === activeLoopId;

  const label = LOOP_COPY_GROUPS.filter((group) => groups.includes(group.id))
    .map((group) => group.label)
    .join(' + ');
  const tooltip = disabled ? 'Copy a loop first' : `Paste ${label} from ${loopLabel(source)}`;

  return (
    <IconButton
      id={`btn-paste-${groups.join('-')}`}
      label={tooltip}
      icon={<ClipboardPaste className="w-3.5 h-3.5" />}
      size="xs"
      disabled={disabled}
      onClick={() => pasteLoopSection(groups)}
    />
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/components/loop/LoopCopyButton.test.tsx src/components/loop/ModulePasteButton.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/loop/LoopCopyButton.tsx src/components/loop/ModulePasteButton.tsx \
  src/components/loop/LoopCopyButton.test.tsx src/components/loop/ModulePasteButton.test.tsx
git commit -m "feat(loop): add LoopCopyButton and ModulePasteButton"
```

---

### Task 4: Wire the copy button into the app shell

**Files:**
- Modify: `src/components/Header.tsx` (render `<LoopCopyButton />` beside `<LoopSelector />`)
- Test: `src/components/Header.test.tsx` (or an existing Header test file)

**Interfaces:**
- Consumes: `<LoopCopyButton />` (Task 3).

- [ ] **Step 1: Write the failing test (source-text pin)**

In the existing Header test file, add:

```ts
test('the loop layer renders the copy button beside the loop selector', () => {
  const src = readFileSync(new URL('./Header.tsx', import.meta.url), 'utf8');
  expect(src).toContain('import { LoopCopyButton }');
  expect(src).toContain('<LoopCopyButton />');
  expect(src).toContain('<LoopSelector />');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/Header.test.tsx`
Expected: FAIL — `LoopCopyButton` is not imported/rendered.

- [ ] **Step 3: Wire it in**

In `src/components/Header.tsx`, add the import:

```ts
import { LoopCopyButton } from './loop/LoopCopyButton';
```

Find the line `{layer === 'loop' && <LoopSelector />}` and replace it with:

```tsx
{layer === 'loop' && (
  <>
    <LoopCopyButton />
    <LoopSelector />
  </>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/Header.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat(loop): surface the copy button in the app shell header"
```

---

### Task 5: Wire paste buttons into the Sound view and module panels

**Files:**
- Modify: `src/components/loop/chord/ModulePanelCard.tsx` (add an `actions` slot)
- Modify: `src/components/loop/chord/ChordModulePanel.tsx`, `BassModulePanel.tsx`, `PadModulePanel.tsx`
- Modify: `src/components/loop/SoundView.tsx`
- Test: `src/components/loop/SoundView.test.tsx`, `src/components/loop/chord/modulePanels.test.tsx`

**Interfaces:**
- Consumes: `<ModulePasteButton groups={[...]} />` (Task 3).
- Produces: `ModulePanelCard` gains an optional `actions?: ReactNode` prop.

- [ ] **Step 1: Write the failing test**

In `src/components/loop/chord/modulePanels.test.tsx`, add:

```tsx
test('each module panel header carries its paste button', () => {
  for (const file of ['ChordModulePanel.tsx', 'BassModulePanel.tsx', 'PadModulePanel.tsx']) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    expect(src).toContain('<ModulePasteButton');
  }
});
```

In `src/components/loop/SoundView.test.tsx`, add:

```tsx
test('the Drum Sound and Synth sections carry paste buttons', () => {
  const src = readFileSync(new URL('./SoundView.tsx', import.meta.url), 'utf8');
  expect(src).toContain('<ModulePasteButton');
  expect(src).toContain('groups={[\'drums-sound\']}');
  expect(src).toContain("'fx-sound'");
  expect(src).toContain("'lead-sound'");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/components/loop/SoundView.test.tsx src/components/loop/chord/modulePanels.test.tsx`
Expected: FAIL — `ModulePasteButton` is not wired.

- [ ] **Step 3: Add the actions slot to ModulePanelCard**

In `src/components/loop/chord/ModulePanelCard.tsx`, extend the props interface:

```ts
export interface ModulePanelCardProps {
  target: ModuleTarget; // existing type, do not change
  title: string;
  description: ReactNode;
  /** Extra header controls (e.g. the paste button), rendered left of the solo/adjust cluster. */
  actions?: ReactNode;
  children: ReactNode;
}
```

Destructure it and render it in the header cluster (which currently holds `SoloButton` + `AdjustSynthButton`):

```tsx
export function ModulePanelCard({ target, title, description, actions, children }: ModulePanelCardProps) {
  ...
  <div className="flex items-center gap-1.5">
    {actions}
    <SoloButton track={target} />
    <AdjustSynthButton target={target} className={accent} />
  </div>
```

- [ ] **Step 4: Wire the three module panels**

In each of `ChordModulePanel.tsx`, `BassModulePanel.tsx`, `PadModulePanel.tsx`:
1. Import `ModulePasteButton` and pass `actions` to `ModulePanelCard`:

`ChordModulePanel.tsx` (`target="chord"`):

```tsx
import { ModulePasteButton } from '../ModulePasteButton';
...
  actions={<ModulePasteButton groups={['chord-sound', 'chord-pattern']} />}
```

`BassModulePanel.tsx` (`target="bass"`):

```tsx
  actions={<ModulePasteButton groups={['bass-sound', 'bass-pattern']} />}
```

`PadModulePanel.tsx` (`target="pad"`):

```tsx
  actions={<ModulePasteButton groups={['pad-sound', 'pad-pattern']} />}
```

- [ ] **Step 5: Wire the Sound view sections**

In `src/components/loop/SoundView.tsx`:
1. Import: `import { ModulePasteButton } from './ModulePasteButton';`
2. On the "Drum Sound" `SectionCard`, add `actions={<ModulePasteButton groups={['drums-sound']} />}` (or append to an existing `actions` if present).
3. On the "Synth" `SectionCard`, add to its `actions`. NOTE: the Synth band edits any
   melodic track's patch (`synthTarget` is `'synth'|'fx'|'chord'|'bass'|'pad'`), so map the
   focused target 5-way via a `Record<SynthControlTarget, LoopCopyGroupId>` —
   synth→lead-sound, fx→fx-sound, chord→chord-sound, bass→bass-sound, pad→pad-sound:

```tsx
<ModulePasteButton groups={[SYNTH_SOUND_GROUP[synthTarget]]} />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/components/loop/SoundView.test.tsx src/components/loop/chord/modulePanels.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/loop/chord/ModulePanelCard.tsx src/components/loop/chord/ChordModulePanel.tsx \
  src/components/loop/chord/BassModulePanel.tsx src/components/loop/chord/PadModulePanel.tsx \
  src/components/loop/SoundView.tsx src/components/loop/SoundView.test.tsx \
  src/components/loop/chord/modulePanels.test.tsx
git commit -m "feat(loop): wire paste buttons into sound and module panels"
```

---

### Task 6: Wire paste buttons into the Pattern view segment headers

**Files:**
- Modify: `src/components/loop/ChordView.tsx` (accompaniment `SegmentHeader` — chord progression)
- Modify: `src/components/loop/PatternView.tsx` (lead / fx `SegmentHeader`s)
- Modify: `src/components/loop/SequencerView.tsx` (beat `SegmentHeader`)
- Test: `src/components/loop/PatternView.test.tsx`, `src/components/loop/ChordView.test.tsx`, `src/components/loop/SequencerView.test.tsx`

**Interfaces:**
- Consumes: `<ModulePasteButton groups={[...]} />` (Task 3); `SegmentHeader` `actions` prop.

- [ ] **Step 1: Write the failing test**

In `src/components/loop/PatternView.test.tsx`, add:

```tsx
test('the lead and fx segment headers carry their pattern paste buttons', () => {
  const src = readFileSync(new URL('./PatternView.tsx', import.meta.url), 'utf8');
  expect(src).toContain('groups={[\'lead-pattern\']}');
  expect(src).toContain('groups={[\'fx-pattern\']}');
});
```

In `src/components/loop/ChordView.test.tsx`, add:

```tsx
test('the accompaniment header carries the chord-progression paste button', () => {
  const src = readFileSync(new URL('./ChordView.tsx', import.meta.url), 'utf8');
  expect(src).toContain('groups={[\'chord-progression\']}');
});
```

In `src/components/loop/SequencerView.test.tsx`, add:

```tsx
test('the beat header carries the drums-pattern paste button', () => {
  const src = readFileSync(new URL('./SequencerView.tsx', import.meta.url), 'utf8');
  expect(src).toContain('groups={[\'drums-pattern\']}');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/components/loop/PatternView.test.tsx src/components/loop/ChordView.test.tsx src/components/loop/SequencerView.test.tsx`
Expected: FAIL — `ModulePasteButton` is not wired.

- [ ] **Step 3: Wire each segment header**

In `src/components/loop/ChordView.tsx`, on the accompaniment `SegmentHeader`, add to its `actions` (next to the existing "Save chord progression" / "Progression Library" buttons):

```tsx
<ModulePasteButton groups={['chord-progression']} />
```

(import `ModulePasteButton` from `./ModulePasteButton`.)

In `src/components/loop/PatternView.tsx`, on the lead and fx `SegmentHeader`s, pass `actions`:

```tsx
<SegmentHeader segment="lead" actions={<ModulePasteButton groups={['lead-pattern']} />} />
<SegmentHeader segment="fx" actions={<ModulePasteButton groups={['fx-pattern']} />} />
```

(import `ModulePasteButton`.)

In `src/components/loop/SequencerView.tsx`, on the beat `SegmentHeader`, pass `actions`:

```tsx
<SegmentHeader segment="beat" actions={<ModulePasteButton groups={['drums-pattern']} />} />
```

(import `ModulePasteButton`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/components/loop/PatternView.test.tsx src/components/loop/ChordView.test.tsx src/components/loop/SequencerView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/ChordView.tsx src/components/loop/PatternView.tsx src/components/loop/SequencerView.tsx \
  src/components/loop/ChordView.test.tsx src/components/loop/PatternView.test.tsx src/components/loop/SequencerView.test.tsx
git commit -m "feat(loop): wire paste buttons into the pattern segment headers"
```

---

### Final gate

- [ ] Run `bun run verify` and confirm exit 0 (test + lint + eslint + check:* + build).

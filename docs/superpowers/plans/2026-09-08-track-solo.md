# Track Solo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-only, additive track-solo set over the five source buses, with the solo
controls placed where the editing happens, audibility computed in `engineSync.ts`, and a
`SOLO · <names> ×` chip in the transport bar.

**Architecture:** One new field in the (unpersisted) ui slice, `soloTracks: SoloTrack[]`, plus one
new pure module `src/store/trackAudibility.ts` that owns the union, the labels and the audibility
formula. `engineSync.ts`'s existing `SOURCE_BUSES` table gains a `solo` column, and both of its
consumers — the snapshot pass and the subscription block — switch from pushing the raw mute flag
to pushing the computed audibility, so the two cannot disagree. Navigation clears the set through
**one** store-side subscription (`src/store/soloNav.ts`) that watches `activeTab`,
`patternSegment` and `activeLoopId`, so no individual writer of those fields can forget it.

**Tech Stack:** TypeScript, React 19, Zustand (`subscribeWithSelector` + `persist`), raw Web Audio
API, Tailwind v4 + daisyUI v5 (CSS-first themes), Bun test runner (`bun:test`, `renderToString`
from `react-dom/server`, no DOM and no testing-library).

**Spec:** `docs/superpowers/specs/2026-09-08-loop-song-ia-and-playback-continuity-design.md`
(this plan implements **§4**; §7 was completed in Phase 3 and is only re-read here to fix the
forward-referencing doc comments it left behind).

## Global Constraints

- **PROHIBITION 1 — solo is never persisted.** Solo must NOT touch `LoopMixPatch`, must NOT
  appear in `partializeAppState` (`src/store/store.ts`) and must NOT appear in
  `PROJECT_CONTENT_KEYS` (`src/store/projectFormat.ts`). It lives in the ui slice, which is not
  persisted. A guard test must assert its absence from both. "A project that reopens with a solo
  latched is the exact failure this design exists to avoid."
- **PROHIBITION 2 — audibility is computed in `engineSync.ts`, never in a component.**
  `src/components/` may not import `audio/engine` (eslint enforces this). The formula is
  `audible(track) = soloTracks.length > 0 ? soloTracks.includes(track) : !muted(track)`, and for a
  drum voice that result AND `!voice.muted` — the two mute layers are deliberate and stay.
- `bun run verify` is the completion gate. It runs `bun test`, `bun run lint`, `bun run eslint`,
  `check:keys`, `check:drums`, `check:contrast`, `check:levels` and `build`.
- **`bun run eslint` must report NOTHING** — no errors and *no warnings*. That is the state the
  repo is in and the state to keep it in. A `react-hooks/exhaustive-deps` or `complexity` warning
  is a failure of this plan, not an acceptable outcome; if one appears, fix the code or add a line
  disable naming its reason.
- `bun:test` in this repo **does not export `it`**. Test files import `test` (and `describe`,
  `expect`, `spyOn`, `beforeEach`, `afterEach`) from `'bun:test'`.
- **No persist `version` and no `.solna` `formatVersion` move.** Nothing new is persisted, so
  neither number changes and no migration or version-gated branch may be added.
- **No `../../` imports.** Two or more `../` levels are banned by eslint globally; use the `@/`
  alias. A single `../` is fine.
- **No `React.FC`** (eslint error), and `consistent-type-definitions` is an error — declare object
  types with `interface`, not `type X = { … }`.
- **Theming:** components name roles, never colours. No raw hex, no Tailwind palette classes, no
  `dark:` variant, no `rgb()`. Every daisyUI class used in this plan (`btn`, `btn-square`,
  `btn-xs`, `btn-sm`, `btn-ghost`, `btn-primary`, `btn-circle`, `badge`, `badge-sm`,
  `badge-warning`) is daisyUI v5 and is already in use in this repo — do not substitute a class
  you have not confirmed against the v5 docs or an existing call site.
- Commit messages and every written artifact (code, comments, docs) are in **English**.
- Branch is `feat/track-solo`, already checked out. Each task ends with its own commit.

---

## File Structure

**Created**

- `src/store/trackAudibility.ts` — the solo vocabulary and the pure audibility formula.
  `SOLO_TRACKS`, `SoloTrack`, `SOLO_TRACK_LABELS`, `isTrackAudible`, `toggleSolo`,
  `soloTrackForControlTarget`, `soloChipLabel`. Imports only a type from `@/utils/synthControl`;
  no store, no engine, so it is testable with no `AudioContext` and no store singleton.
- `src/store/trackAudibility.test.ts`
- `src/store/soloNav.ts` — the single navigation-clear subscription (`SOLO_NAV_KEYS`,
  `soloNavSignature`, `soloNavUnchanged`, `startSoloNavClear`, `useSoloNavClear`).
- `src/store/soloNav.test.ts`
- `src/components/ui/SoloButton.tsx` — the one solo control, used at all six placements.
- `src/components/ui/SoloButton.test.tsx`

**Modified**

- `src/store/types.ts` — `UiSlice` gains `soloTracks`, `toggleSoloTrack`, `clearSoloTracks`.
- `src/store/uiSlice.ts` — their implementations.
- `src/store/uiSlice.test.ts` — store-level solo behaviour + the PROHIBITION 1 guard.
- `src/store/engineSync.ts` — `SOURCE_BUSES` gains `solo`; `applySliceState` and the subscription
  block both push audibility instead of the raw mute flag.
- `src/store/engineSync.test.ts` — solo→engine behaviour.
- `src/App.tsx` — mounts `useSoloNavClear()`.
- `src/components/loop/SoundView.tsx` — one solo button following `controlTarget`.
- `src/components/loop/PatternView.tsx` — Lead segment header action.
- `src/components/loop/SequencerView.tsx` — Beat segment header action.
- `src/components/loop/chord/ChordModulePanel.tsx`, `BassModulePanel.tsx`, `PadModulePanel.tsx` —
  one solo button per row.
- `src/components/TransportBar.tsx` + `.test.tsx` — the `SOLO · <names> ×` chip.
- `src/store/playbackScope.ts` — three doc comments that forward-reference "Phase 4" become
  present-tense statements naming the real module.
- `CLAUDE.md` — one paragraph recording the solo rules so a future contributor does not "fix" the
  clearing into stickiness.

**Deliberately NOT modified**

- `src/components/loop/SoundMixer.tsx` — the mixer has no solo column at all (§4). Task 6 adds a
  source-scan test that keeps it that way.
- `src/components/useSequencerPlayback.ts` — per-drum-voice mute stays exactly as it is. See the
  verification note in Task 4.

---

## Task 1: The solo vocabulary and the pure audibility formula

**Files:**
- Create: `src/store/trackAudibility.ts`
- Test: `src/store/trackAudibility.test.ts`

**Interfaces:**
- Consumes: `SynthControlTarget` (`'synth' | 'chord' | 'bass' | 'pad'`) from
  `@/utils/synthControl`.
- Produces:
  - `const SOLO_TRACKS: readonly ['lead', 'chord', 'bass', 'pad', 'drums']`
  - `type SoloTrack = 'lead' | 'chord' | 'bass' | 'pad' | 'drums'`
  - `const SOLO_TRACK_LABELS: Record<SoloTrack, string>`
  - `isTrackAudible(track: SoloTrack, soloTracks: readonly SoloTrack[], muted: boolean): boolean`
  - `toggleSolo(soloTracks: readonly SoloTrack[], track: SoloTrack): SoloTrack[]`
  - `soloTrackForControlTarget(target: SynthControlTarget): SoloTrack`
  - `soloChipLabel(soloTracks: readonly SoloTrack[]): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/store/trackAudibility.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  isTrackAudible,
  soloChipLabel,
  soloTrackForControlTarget,
  SOLO_TRACKS,
  SOLO_TRACK_LABELS,
  toggleSolo,
  type SoloTrack,
} from './trackAudibility';

/**
 * The two drum mute LAYERS, composed the way the running app composes them:
 * layer 1 is the drums BUS, which engineSync pushes through isTrackAudible;
 * layer 2 is the per-voice `muted` flag, which useSequencerPlayback applies as
 * a `continue` before it triggers the voice. This helper lives in the test and
 * not in production on purpose — nothing in the app needs the composed value,
 * because the bus gain already silences a soloed-away kit whatever the voice
 * flags say. It exists so the spec's "a drum voice needs both its track
 * audible and its own mute off" is asserted rather than assumed.
 */
function drumVoiceSounds(
  soloTracks: readonly SoloTrack[],
  drumsMuted: boolean,
  voiceMuted: boolean,
): boolean {
  return isTrackAudible('drums', soloTracks, drumsMuted) && !voiceMuted;
}

describe('SOLO_TRACKS', () => {
  test('is exactly the five targets, in canonical order', () => {
    expect([...SOLO_TRACKS]).toEqual(['lead', 'chord', 'bass', 'pad', 'drums']);
  });

  test('every track has a label', () => {
    expect(SOLO_TRACK_LABELS).toEqual({
      lead: 'Lead',
      chord: 'Chord',
      bass: 'Bass',
      pad: 'Pad',
      drums: 'Drums',
    });
  });
});

describe('isTrackAudible', () => {
  test('with no solo latched, audibility is just "not muted"', () => {
    expect(isTrackAudible('lead', [], false)).toBe(true);
    expect(isTrackAudible('lead', [], true)).toBe(false);
  });

  test('solo beats mute: a muted track sounds when it is soloed', () => {
    expect(isTrackAudible('drums', ['drums'], true)).toBe(true);
  });

  test('solo silences every track it does not name, muted or not', () => {
    expect(isTrackAudible('chord', ['drums'], false)).toBe(false);
    expect(isTrackAudible('bass', ['drums'], true)).toBe(false);
  });

  test('solo is additive, not a radio: drums + lead sound together', () => {
    const solo: SoloTrack[] = ['lead', 'drums'];
    expect(isTrackAudible('lead', solo, false)).toBe(true);
    expect(isTrackAudible('drums', solo, false)).toBe(true);
    expect(isTrackAudible('chord', solo, false)).toBe(false);
    expect(isTrackAudible('bass', solo, false)).toBe(false);
    expect(isTrackAudible('pad', solo, false)).toBe(false);
  });

  test('scope is the whole loop: one solo set covers all five targets', () => {
    const audible = SOLO_TRACKS.filter((t) => isTrackAudible(t, ['pad'], false));
    expect(audible).toEqual(['pad']);
  });
});

describe('a drum voice needs both layers', () => {
  test('the voice sounds only when the bus is audible AND its own mute is off', () => {
    expect(drumVoiceSounds([], false, false)).toBe(true);
    expect(drumVoiceSounds([], false, true)).toBe(false);
    expect(drumVoiceSounds([], true, false)).toBe(false);
    expect(drumVoiceSounds(['drums'], true, false)).toBe(true);
    expect(drumVoiceSounds(['drums'], true, true)).toBe(false);
    expect(drumVoiceSounds(['lead'], false, false)).toBe(false);
  });
});

describe('toggleSolo', () => {
  test('adds a track, and keeps the result in canonical order', () => {
    expect(toggleSolo(['drums'], 'lead')).toEqual(['lead', 'drums']);
  });

  test('removes a track that is already soloed', () => {
    expect(toggleSolo(['lead', 'drums'], 'lead')).toEqual(['drums']);
  });

  test('toggling the only soloed track empties the set', () => {
    expect(toggleSolo(['drums'], 'drums')).toEqual([]);
  });
});

describe('soloTrackForControlTarget', () => {
  test("the synth control target is the lead track", () => {
    expect(soloTrackForControlTarget('synth')).toBe('lead');
  });

  test('the other three targets map to themselves', () => {
    expect(soloTrackForControlTarget('chord')).toBe('chord');
    expect(soloTrackForControlTarget('bass')).toBe('bass');
    expect(soloTrackForControlTarget('pad')).toBe('pad');
  });
});

describe('soloChipLabel', () => {
  test('is null when nothing is soloed, so the chip renders nothing', () => {
    expect(soloChipLabel([])).toBeNull();
  });

  test('names one track', () => {
    expect(soloChipLabel(['drums'])).toBe('SOLO · Drums');
  });

  test('joins several with a plus, in canonical order', () => {
    expect(soloChipLabel(['lead', 'drums'])).toBe('SOLO · Lead + Drums');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/trackAudibility.test.ts`
Expected: FAIL — `Cannot find module './trackAudibility'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/trackAudibility.ts`:

```ts
import type { SynthControlTarget } from '@/utils/synthControl';

/**
 * The five track-solo targets, in the order the transport chip names them.
 *
 * These are USER vocabulary, not engine vocabulary. `engineSync.ts`'s
 * SOURCE_BUSES calls the same five buses `synth`/`chord`/`bass`/`pad`/
 * `sequencer`, and that table already exists to hold exactly this kind of
 * irregular mapping (see its own comment on why `sequencer` is spelled out
 * rather than derived). It gains a `solo` column so the mapping is written
 * once; nothing else translates between the two vocabularies except
 * `soloTrackForControlTarget` below.
 */
export const SOLO_TRACKS = ['lead', 'chord', 'bass', 'pad', 'drums'] as const;

export type SoloTrack = (typeof SOLO_TRACKS)[number];

/** Display names — the transport chip and every solo button's accessible name. */
export const SOLO_TRACK_LABELS: Record<SoloTrack, string> = {
  lead: 'Lead',
  chord: 'Chord',
  bass: 'Bass',
  pad: 'Pad',
  drums: 'Drums',
};

/**
 * Effective audibility for one track. THE formula, and the only place it is
 * written: `engineSync.ts` calls it for every source bus, on both the snapshot
 * pass and the subscription, and no component may compute it (src/components/
 * must not import audio/engine, and a second copy of this rule in a view is
 * how the two would drift).
 *
 * Solo beats mute, deliberately. Mute is arrangement intent, persisted per loop
 * in LoopMixPatch; solo is a monitoring gesture that is never persisted, so
 * while it is latched it is the more recent, more local statement of what the
 * user wants to hear.
 */
export function isTrackAudible(
  track: SoloTrack,
  soloTracks: readonly SoloTrack[],
  muted: boolean,
): boolean {
  return soloTracks.length > 0 ? soloTracks.includes(track) : !muted;
}

/**
 * Add or remove one track. A SET, never a radio: soloing Drums and then Lead
 * must sound both, because with the per-module play buttons gone (spec §5)
 * "write a lead over just the drums" is only expressible as two simultaneous
 * solos.
 *
 * The result is re-derived from SOLO_TRACKS rather than appended to, so the
 * stored array is always in canonical order whatever order the buttons were
 * pressed in — which is what makes the chip's label and every test's expected
 * value deterministic.
 */
export function toggleSolo(soloTracks: readonly SoloTrack[], track: SoloTrack): SoloTrack[] {
  const next = new Set<SoloTrack>(soloTracks);
  if (next.has(track)) next.delete(track);
  else next.add(track);
  return SOLO_TRACKS.filter((t) => next.has(t));
}

/**
 * The Sound view edits one layer at a time and its solo button follows that
 * choice, so it needs the one place the two vocabularies meet: the synth
 * control target `'synth'` is the track called `lead`.
 */
export function soloTrackForControlTarget(target: SynthControlTarget): SoloTrack {
  return target === 'synth' ? 'lead' : target;
}

/**
 * The transport bar's chip text, or null when nothing is soloed. Pure and
 * exported for the same reason `songModeLabel` in TransportBar.tsx is: the bar
 * is rendered through renderToString in tests, and a string is far easier to
 * assert than markup.
 */
export function soloChipLabel(soloTracks: readonly SoloTrack[]): string | null {
  if (soloTracks.length === 0) return null;
  return `SOLO · ${soloTracks.map((track) => SOLO_TRACK_LABELS[track]).join(' + ')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/store/trackAudibility.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add src/store/trackAudibility.ts src/store/trackAudibility.test.ts
git commit -m "feat(solo): the solo track vocabulary and the audibility formula"
```

---

## Task 2: Solo state in the ui slice, and the never-persisted guard

**Files:**
- Modify: `src/store/types.ts` (the `UiSlice` interface, around lines 314-351)
- Modify: `src/store/uiSlice.ts`
- Test: `src/store/uiSlice.test.ts`

**Interfaces:**
- Consumes: `SoloTrack`, `toggleSolo` from `./trackAudibility` (Task 1).
- Produces, on `UiSlice` (and therefore on `AppStore`):
  - `soloTracks: SoloTrack[]` — initial value `[]`
  - `toggleSoloTrack: (track: SoloTrack) => void`
  - `clearSoloTracks: () => void`

- [ ] **Step 1: Write the failing test**

Append to `src/store/uiSlice.test.ts` (keep the file's existing imports; add these to them):

```ts
import { partializeAppState } from './store';
import { buildProjectContent, PROJECT_CONTENT_KEYS } from './projectFormat';
import { useAppStore } from './store';

describe('track solo state', () => {
  beforeEach(() => {
    useAppStore.setState({ soloTracks: [] });
  });

  afterEach(() => {
    useAppStore.setState({ soloTracks: [] });
  });

  test('starts empty', () => {
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('toggling is additive and canonically ordered', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().toggleSoloTrack('lead');
    expect(useAppStore.getState().soloTracks).toEqual(['lead', 'drums']);
  });

  test('toggling the same track again removes it', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().toggleSoloTrack('drums');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('clearSoloTracks empties the set', () => {
    useAppStore.getState().toggleSoloTrack('pad');
    useAppStore.getState().clearSoloTracks();
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('clearing an already-empty set keeps the array reference stable', () => {
    const before = useAppStore.getState().soloTracks;
    useAppStore.getState().clearSoloTracks();
    expect(useAppStore.getState().soloTracks).toBe(before);
  });

  test('solo does not start playback: pressing it with the transport stopped is silent', () => {
    useAppStore.setState({
      sequencerPlayer: 'stopped',
      chordsPlayer: 'stopped',
      leadPlayer: 'stopped',
    });
    useAppStore.getState().toggleSoloTrack('drums');
    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.playbackScope.kind).toBe('none');
  });
});

describe('solo is never persisted (spec §4, prohibition 1)', () => {
  afterEach(() => {
    useAppStore.setState({ soloTracks: [] });
  });

  test('it appears in neither partializeAppState nor PROJECT_CONTENT_KEYS', () => {
    useAppStore.setState({ soloTracks: ['drums', 'lead'] });

    const persisted = partializeAppState(useAppStore.getState());
    expect(Object.keys(persisted)).not.toContain('soloTracks');

    expect([...PROJECT_CONTENT_KEYS]).not.toContain('soloTracks');

    const content = buildProjectContent(useAppStore.getState());
    expect(Object.keys(content).sort()).toEqual([...PROJECT_CONTENT_KEYS].sort());
  });

  test('it never reaches LoopMixPatch: no loop carries a solo key', () => {
    useAppStore.setState({ soloTracks: ['drums'] });
    for (const loop of useAppStore.getState().loops) {
      expect(Object.keys(loop)).not.toContain('soloTracks');
      expect(Object.keys(loop)).not.toContain('solo');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/uiSlice.test.ts`
Expected: FAIL — `soloTracks` does not exist on the store; `toggleSoloTrack is not a function`.

- [ ] **Step 3: Add the state to the `UiSlice` interface**

In `src/store/types.ts`, add to the existing type imports:

```ts
import type { SoloTrack } from './trackAudibility';
```

and add these members to `UiSlice`, immediately after `patternSegment`:

```ts
  /**
   * Track solo — the five source buses that are being monitored alone.
   *
   * Session-only and NEVER persisted: it is absent from partializeAppState and
   * from PROJECT_CONTENT_KEYS, and it must stay absent (a project that reopens
   * with a solo latched is the failure this design exists to avoid). Mute is
   * the opposite gesture and stays where it is — per loop, in LoopMixPatch.
   *
   * A SET, not a radio: soloing Drums and then Lead sounds both. Always held in
   * SOLO_TRACKS order, whatever order the buttons were pressed in.
   *
   * Cleared by navigation — see store/soloNav.ts, which owns that rule for
   * every writer of activeTab / patternSegment / activeLoopId at once. That
   * clearing is the point of the feature, not a rough edge: a control that can
   * silence a track must not be able to keep doing so once the user has stopped
   * looking at it. Do not "fix" it into stickiness.
   */
  soloTracks: SoloTrack[];
```

and these to the action list, after `setPatternSegment`:

```ts
  toggleSoloTrack: (track: SoloTrack) => void;
  clearSoloTracks: () => void;
```

- [ ] **Step 4: Implement them in the slice**

In `src/store/uiSlice.ts`, add to the imports:

```ts
import { toggleSolo } from './trackAudibility';
```

add the initial value after `patternSegment: 'lead',`:

```ts
    soloTracks: [],
```

and the two actions after `setPatternSegment`:

```ts
    toggleSoloTrack: (track) =>
      set((state) => ({ soloTracks: toggleSolo(state.soloTracks, track) })),
    // Guarded on emptiness so the array reference is stable: soloNav.ts calls
    // this on EVERY navigation, and handing every `soloTracks` subscriber a
    // fresh [] on each tab click would re-run engineSync's five audibility
    // listeners for a value that did not change.
    clearSoloTracks: () =>
      set((state) => (state.soloTracks.length === 0 ? {} : { soloTracks: [] })),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/store/uiSlice.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no output from either.

- [ ] **Step 7: Commit**

```bash
git add src/store/types.ts src/store/uiSlice.ts src/store/uiSlice.test.ts
git commit -m "feat(solo): session-only solo set in the ui slice, with a never-persisted guard"
```

---

## Task 3: Cleared by navigation — one subscription, not one clear per writer

**Files:**
- Create: `src/store/soloNav.ts`
- Test: `src/store/soloNav.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useAppStore` from `./store`; `clearSoloTracks` from Task 2.
- Produces:
  - `const SOLO_NAV_KEYS: readonly ['activeTab', 'patternSegment', 'activeLoopId']`
  - `interface SoloNavSignature { activeTab: ViewMode; patternSegment: PatternSegment; activeLoopId: string }`
  - `soloNavSignature(state: AppStore): SoloNavSignature`
  - `soloNavUnchanged(a: SoloNavSignature, b: SoloNavSignature): boolean`
  - `startSoloNavClear(): () => void` — starts the subscription, returns its unsubscribe
  - `useSoloNavClear(): void` — the React binding, mounted once in `App.tsx`

**Why one subscription and not a clear inside each writer.** §4 clears on four things: tab,
Pattern segment, layer and active loop. Layer is *derived* from tab (`layerForTab` in
`src/types.ts`), so it is not a fourth field — a layer change is always a tab change. That leaves
three fields, and `activeLoopId` alone has at least six writers today: `loadLoop`'s two
`setState` calls, `addLoop`, `duplicateLoop`, `deleteLoop`, `setActiveLoop`, and
`applyProjectContent`'s open patch. Song advance adds a seventh path (it calls `loadLoop`).
Per-writer clearing would need a line in every one of them and in every writer added later, and a
missed one is silent — the solo simply keeps silencing tracks. Watching the three FIELDS instead
covers every writer that exists and every writer that will exist, because a writer that does not
touch these fields is, by definition, not a navigation. The only thing a future contributor can
still forget is a *new navigation axis*, which is a much narrower surface and is pinned by the
`SOLO_NAV_KEYS` guard test below.

**What happens on a song advance.** The arrangement advances by calling `loadLoop(nextId)`, which
writes `activeLoopId`, so the subscription fires and the set is emptied mid-song. In practice it
is already empty: the arrangement only runs on the Song layer, and reaching the Song layer is a
tab change that cleared it on arrival. The clear is therefore idempotent there, and that is the
right outcome twice over — the spec states "crossing from Loop to Song is a tab change, so a solo
can never leak into song playback", and a solo that survived a loop boundary would be silencing
tracks in a loop the user never soloed anything in.

**The clear runs inside the navigating `set()`'s own notification pass**, synchronously, because
that is how zustand dispatches to subscribers. There is no frame in which the user hears the stale
solo. The one observable effect is that `loadLoop` — which writes the new loop's mute flags and
`activeLoopId` in one `set()` — can push audibility to the engine twice in the same tick: once
with the new mutes and the old solo, then again after the clear. `setSourceMuted` ramps with
`setTargetAtTime(…, 0.01)` rather than stepping the gain, so the second call simply re-targets an
in-flight ramp; it is not a click.

- [ ] **Step 1: Write the failing test**

Create `src/store/soloNav.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { SOLO_NAV_KEYS, soloNavUnchanged, startSoloNavClear } from './soloNav';

let stop: (() => void) | null = null;

beforeEach(() => {
  useAppStore.setState({ activeTab: 'sound', patternSegment: 'lead', soloTracks: [] });
  stop = startSoloNavClear();
});

afterEach(() => {
  stop?.();
  stop = null;
  useAppStore.setState({ activeTab: 'sound', patternSegment: 'lead', soloTracks: [] });
});

describe('SOLO_NAV_KEYS', () => {
  /**
   * Exhaustive on purpose. The subscription covers every WRITER of these three
   * fields by construction; the one thing a future contributor can still forget
   * is a new navigation AXIS. This test is where that decision has to be made
   * out loud instead of by omission.
   */
  test('is exactly the three navigation fields §4 names', () => {
    expect([...SOLO_NAV_KEYS]).toEqual(['activeTab', 'patternSegment', 'activeLoopId']);
  });
});

describe('solo is cleared by navigation', () => {
  test('changing tab clears it', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().setActiveTab('pattern');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('changing layer clears it — a layer change is a tab change', () => {
    useAppStore.getState().setActiveTab('pattern');
    useAppStore.getState().toggleSoloTrack('lead');
    useAppStore.getState().setActiveTab('arrange');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('changing the Pattern segment clears it', () => {
    useAppStore.getState().setActiveTab('pattern');
    useAppStore.getState().toggleSoloTrack('bass');
    useAppStore.getState().setPatternSegment('beat');
    expect(useAppStore.getState().soloTracks).toEqual([]);
  });

  test('changing the active loop clears it', () => {
    const before = useAppStore.getState().activeLoopId;
    useAppStore.getState().toggleSoloTrack('pad');
    useAppStore.getState().setActiveLoop('some-other-loop-id');
    expect(useAppStore.getState().soloTracks).toEqual([]);
    useAppStore.setState({ activeLoopId: before });
  });

  test('adding a loop clears it — the cursor moved', () => {
    const before = useAppStore.getState().activeLoopId;
    const beforeLoops = useAppStore.getState().loops;
    useAppStore.getState().toggleSoloTrack('chord');
    useAppStore.getState().addLoop();
    expect(useAppStore.getState().soloTracks).toEqual([]);
    useAppStore.setState({ loops: beforeLoops, activeLoopId: before });
  });

  /**
   * The mechanism-level assertion, and the reason there is no per-writer test
   * for loadLoop, deleteLoop or the song advance: the subscription watches the
   * FIELD, so any writer of it — including ones that do not exist yet — clears
   * the set.
   */
  test('a bare write of activeLoopId clears it, whoever the writer is', () => {
    const before = useAppStore.getState().activeLoopId;
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.setState({ activeLoopId: 'written-by-nobody-in-particular' });
    expect(useAppStore.getState().soloTracks).toEqual([]);
    useAppStore.setState({ activeLoopId: before });
  });

  test('a non-navigating set() leaves the solo alone', () => {
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().setBpm(useAppStore.getState().bpm + 1);
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
  });

  test('re-selecting the same tab is not a navigation and does not clear', () => {
    useAppStore.getState().setActiveTab('pattern');
    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().setActiveTab('pattern');
    expect(useAppStore.getState().soloTracks).toEqual(['drums']);
  });
});

describe('soloNavUnchanged', () => {
  test('compares all three fields', () => {
    const base = { activeTab: 'sound', patternSegment: 'lead', activeLoopId: 'a' } as const;
    expect(soloNavUnchanged(base, { ...base })).toBe(true);
    expect(soloNavUnchanged(base, { ...base, activeTab: 'pattern' })).toBe(false);
    expect(soloNavUnchanged(base, { ...base, patternSegment: 'beat' })).toBe(false);
    expect(soloNavUnchanged(base, { ...base, activeLoopId: 'b' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/soloNav.test.ts`
Expected: FAIL — `Cannot find module './soloNav'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/soloNav.ts`:

```ts
import React from 'react';
import type { PatternSegment, ViewMode } from '@/types';
import { useAppStore } from './store';
import type { AppStore } from './types';

/**
 * The navigation axes that empty the track-solo set (spec §4: "changing tab,
 * Pattern segment, layer, or active loop").
 *
 * Three fields, not four: the LAYER is derived from the tab (`layerForTab` in
 * src/types.ts), so a layer change is always a tab change and needs no entry of
 * its own.
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
 * already empty (reaching the Song layer was a tab change), and a solo that
 * survived a loop boundary would be silencing tracks in a loop nobody soloed
 * anything in.
 */
export const SOLO_NAV_KEYS = ['activeTab', 'patternSegment', 'activeLoopId'] as const;

export interface SoloNavSignature {
  activeTab: ViewMode;
  patternSegment: PatternSegment;
  activeLoopId: string;
}

export function soloNavSignature(state: AppStore): SoloNavSignature {
  return {
    activeTab: state.activeTab,
    patternSegment: state.patternSegment,
    activeLoopId: state.activeLoopId,
  };
}

/**
 * Field-by-field rather than `shallow`, for the same reason songMode's own
 * equalityFn is hand-written: the selector allocates a fresh object on every
 * set(), and subscribeWithSelector runs it on every set(), so this comparison
 * is on the hot path and stays three `===` checks.
 */
export function soloNavUnchanged(a: SoloNavSignature, b: SoloNavSignature): boolean {
  return (
    a.activeTab === b.activeTab &&
    a.patternSegment === b.patternSegment &&
    a.activeLoopId === b.activeLoopId
  );
}

/**
 * Starts the clear. Returns the unsubscribe, mirroring startSongModeSync.
 *
 * The listener runs synchronously inside the navigating set()'s own
 * notification pass, so there is no frame in which the stale solo is audible.
 * clearSoloTracks is reference-stable on an already-empty set, so a navigation
 * with no solo latched notifies nothing further.
 */
export function startSoloNavClear(): () => void {
  return useAppStore.subscribe(
    soloNavSignature,
    () => useAppStore.getState().clearSoloTracks(),
    { equalityFn: soloNavUnchanged },
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useSoloNavClear(): void {
  React.useEffect(() => startSoloNavClear(), []);
}
```

- [ ] **Step 4: Mount it in `App.tsx`**

Add to the imports, beside the existing `useSongModeSync` import:

```ts
import { useSoloNavClear } from './store/soloNav';
```

and call it immediately after `useSongModeSync();`:

```ts
  // Track solo is a session gesture, cleared by navigation. One subscription
  // owns that rule for every writer of activeTab/patternSegment/activeLoopId —
  // see store/soloNav.ts.
  useSoloNavClear();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/store/soloNav.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no output from either.

- [ ] **Step 7: Commit**

```bash
git add src/store/soloNav.ts src/store/soloNav.test.ts src/App.tsx
git commit -m "feat(solo): clear the solo set on navigation, from one subscription"
```

---

## Task 4: Audibility reaches the engine, from the one `SOURCE_BUSES` table

**Files:**
- Modify: `src/store/engineSync.ts` (the `SOURCE_BUSES` table ~line 123, `applySliceState`'s bus
  loop ~line 197, the subscription block's bus loop ~line 259)
- Test: `src/store/engineSync.test.ts`

**Interfaces:**
- Consumes: `isTrackAudible`, `SoloTrack` from `./trackAudibility` (Task 1); `soloTracks` on the
  store (Task 2).
- Produces: `SOURCE_BUSES` entries gain a `solo: SoloTrack` field; a module-private
  `busAudible(s: AppStore, bus: (typeof SOURCE_BUSES)[number]): boolean`. Nothing new is exported.

**Verify before writing this task — and record the answer in the commit message.** Per-drum-voice
mute is a *separate layer* and this task must not touch it. Confirm it by reading
`src/components/useSequencerPlayback.ts` line 61 (`if (track.muted) continue;`) and
`src/store/engineSync.ts`'s `pushDrumTrackGains`. The finding, which the plan asserts as true: the
per-voice `muted` flag is applied in the playback hook as a skip before the voice is triggered and
never reaches an engine gain, while `drumMuted` is the drums *bus* and reaches
`audioEngine.setSourceMuted('sequencer', …)`. Solo changes the bus and only the bus. Extending the
playback hook to consider solo is explicitly forbidden by PROHIBITION 2 (it is a component) and is
also unnecessary — the bus gain already silences a soloed-away kit whatever the voice flags say.

- [ ] **Step 1: Write the failing test**

Append to `src/store/engineSync.test.ts` (its existing `afterEach` already calls
`stopEngineSync()`):

```ts
describe('track solo reaches the engine as bus audibility', () => {
  afterEach(() => {
    useAppStore.setState({
      soloTracks: [],
      synthMuted: false,
      chordMuted: false,
      bassMuted: false,
      padMuted: false,
      drumMuted: false,
    });
  });

  test('soloing drums silences the four melodic buses and keeps the drum bus open', () => {
    useAppStore.setState({ soloTracks: [] });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();
    setSourceMuted.mockClear();

    useAppStore.getState().toggleSoloTrack('drums');

    expect(setSourceMuted).toHaveBeenCalledWith('synth', true);
    expect(setSourceMuted).toHaveBeenCalledWith('chord', true);
    expect(setSourceMuted).toHaveBeenCalledWith('bass', true);
    expect(setSourceMuted).toHaveBeenCalledWith('pad', true);
    expect(setSourceMuted).not.toHaveBeenCalledWith('sequencer', true);
  });

  test('solo beats mute: a muted bus opens when it is soloed', () => {
    useAppStore.setState({ soloTracks: [], drumMuted: true });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();
    setSourceMuted.mockClear();

    useAppStore.getState().toggleSoloTrack('drums');

    expect(setSourceMuted).toHaveBeenCalledWith('sequencer', false);
  });

  test('solo is additive: drums + lead leaves both buses open', () => {
    useAppStore.setState({ soloTracks: [] });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();

    useAppStore.getState().toggleSoloTrack('drums');
    useAppStore.getState().toggleSoloTrack('lead');
    setSourceMuted.mockClear();
    applyEngineSnapshot();

    expect(setSourceMuted).toHaveBeenCalledWith('sequencer', false);
    expect(setSourceMuted).toHaveBeenCalledWith('synth', false);
    expect(setSourceMuted).toHaveBeenCalledWith('chord', true);
    expect(setSourceMuted).toHaveBeenCalledWith('bass', true);
    expect(setSourceMuted).toHaveBeenCalledWith('pad', true);
  });

  test('clearing the solo hands the buses back to their mute flags', () => {
    useAppStore.setState({ soloTracks: [], chordMuted: true });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    startEngineSync();
    useAppStore.getState().toggleSoloTrack('drums');
    setSourceMuted.mockClear();

    useAppStore.getState().clearSoloTracks();

    expect(setSourceMuted).toHaveBeenCalledWith('chord', true);
    expect(setSourceMuted).toHaveBeenCalledWith('bass', false);
    expect(setSourceMuted).toHaveBeenCalledWith('sequencer', false);
  });

  test('the snapshot pass and the subscriptions agree, because both read the same table', () => {
    useAppStore.setState({ soloTracks: ['pad'], synthMuted: false });
    const setSourceMuted = spyOn(audioEngine, 'setSourceMuted').mockClear();
    applyEngineSnapshot();

    expect(setSourceMuted).toHaveBeenCalledWith('pad', false);
    expect(setSourceMuted).toHaveBeenCalledWith('synth', true);
  });

  test('solo leaves the per-voice drum mute layer untouched', () => {
    const before = useAppStore.getState().sequencerTracks.map((t) => t.muted);
    useAppStore.getState().toggleSoloTrack('drums');
    expect(useAppStore.getState().sequencerTracks.map((t) => t.muted)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/store/engineSync.test.ts`
Expected: FAIL — soloing drums still pushes the raw mute flags, so `setSourceMuted('synth', true)`
is never called.

- [ ] **Step 3: Add the `solo` column and the audibility helper**

In `src/store/engineSync.ts`, add to the imports:

```ts
import { isTrackAudible } from './trackAudibility';
import type { AppStore } from './types';
```

Replace the `SOURCE_BUSES` table with the same table plus a `solo` column, and extend its docblock:

```ts
/**
 * Every source bus the store owns, as `[volume field, mute field, engine
 * source, solo track]`. Both the snapshot pass and the subscription block below
 * are driven from this one table, on the `synthSources` precedent further down
 * — the two used to be ten hand-written lines each, and a bus added to one and
 * forgotten in the other is silent until the first apply.
 *
 * The field names are table data rather than a `${source}Volume` convention on
 * purpose: 'sequencer' is irregular (`masterSequencerVolume` / `drumMuted`),
 * and encoding that as a special case in the loop would cost more than
 * spelling all ten names out.
 *
 * `solo` is the same irregularity in the other direction: the ENGINE calls the
 * drum bus 'sequencer' and the lead bus 'synth', while the USER-facing solo
 * vocabulary (store/trackAudibility.ts) calls them 'drums' and 'lead'. The
 * translation is written once, here, because this table is already the place
 * that owns the per-bus name mapping.
 */
const SOURCE_BUSES = [
  { source: 'synth', volume: 'synthVolume', muted: 'synthMuted', solo: 'lead' },
  { source: 'chord', volume: 'chordVolume', muted: 'chordMuted', solo: 'chord' },
  { source: 'bass', volume: 'bassVolume', muted: 'bassMuted', solo: 'bass' },
  { source: 'pad', volume: 'padVolume', muted: 'padMuted', solo: 'pad' },
  { source: 'sequencer', volume: 'masterSequencerVolume', muted: 'drumMuted', solo: 'drums' },
] as const;

/**
 * THE audibility read, and the only one: solo beats mute, and the formula lives
 * in store/trackAudibility.ts because src/components/ may not import
 * audio/engine and so may not compute it (spec §4, second hard constraint).
 *
 * `bus.solo` is checked against SoloTrack by isTrackAudible's own signature, so
 * a typo in the table above is a compile error rather than a bus that silently
 * never solos.
 */
function busAudible(s: AppStore, bus: (typeof SOURCE_BUSES)[number]): boolean {
  return isTrackAudible(bus.solo, s.soloTracks, s[bus.muted]);
}
```

- [ ] **Step 4: Route both consumers through it**

In `applySliceState`, replace the bus loop body's mute line:

```ts
  for (const bus of SOURCE_BUSES) {
    audioEngine.setSourceGain(bus.source, faderDbToGain(s[bus.volume]));
    audioEngine.setSourceMuted(bus.source, !busAudible(s, bus));
  }
```

and in `startEngineSync`'s bus loop, replace the mute subscription:

```ts
  for (const bus of SOURCE_BUSES) {
    subs.push(useAppStore.subscribe((s) => s[bus.volume], (db) => audioEngine.setSourceGain(bus.source, faderDbToGain(db)), { fireImmediately: true }));
    // Audibility, not the raw mute flag — solo beats mute. The selector returns
    // a BOOLEAN, so the default === equality fires this listener only when the
    // bus actually flips: a solo toggle re-runs five selectors and calls the
    // engine only for the buses whose state really changed.
    subs.push(useAppStore.subscribe((s) => busAudible(s, bus), (audible) => audioEngine.setSourceMuted(bus.source, !audible), { fireImmediately: true }));
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/store/engineSync.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no output from either.

- [ ] **Step 7: Commit**

```bash
git add src/store/engineSync.ts src/store/engineSync.test.ts
git commit -m "feat(solo): compute bus audibility in engineSync, off the one SOURCE_BUSES table

Per-drum-voice mute is a separate layer and is untouched: sequencerTracks[].muted
is applied in useSequencerPlayback as a skip before the voice is triggered, while
drumMuted is the drums bus and is what solo overrides."
```

---

## Task 5: The shared solo button

**Files:**
- Create: `src/components/ui/SoloButton.tsx`
- Test: `src/components/ui/SoloButton.test.tsx`

**Interfaces:**
- Consumes: `SoloTrack`, `SOLO_TRACK_LABELS` from `@/store/trackAudibility`; `soloTracks` /
  `toggleSoloTrack` from the store; `IconButton` from `./IconButton`; `useLiveStore` from
  `./useLiveStore`.
- Produces:
  - `interface SoloButtonProps { track: SoloTrack; size?: 'xs' | 'sm'; className?: string }`
  - `function SoloButton(props: SoloButtonProps): JSX.Element` — the component all six placements
    in Tasks 6-7 render.

**Why one component and not five buttons.** Six placements (Sound, Lead, chord, bass, pad, Beat)
would otherwise each spell out the active/inactive class pair, the accessible name and the toggle
call, and five of the six would drift the first time the active look changes. It lives in
`src/components/ui/` because that is where this repo's shared primitives live and because feature
folders (`loop/`, `song/`) must not import each other.

**Why `useLiveStore` and not `useAppStore`.** Roughly a third of this suite renders through
`renderToString`, where zustand serves the *creation-time* state as the server snapshot — a test's
`useAppStore.setState({ soloTracks: ['drums'] })` before the render would have no effect and the
"active" assertion would silently test the inactive button. `useLiveStore` serves `getState()` for
both snapshots. See `.claude/rules/testing.md`.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/SoloButton.test.tsx`:

```tsx
import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import { SoloButton } from './SoloButton';

afterEach(() => {
  useAppStore.setState({ soloTracks: [] });
});

describe('SoloButton', () => {
  test('inactive: an outlined icon button naming the track it solos', () => {
    useAppStore.setState({ soloTracks: [] });
    const html = renderToString(<SoloButton track="drums" />);
    expect(html).toContain('aria-label="Solo Drums"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('btn btn-square btn-xs btn-ghost border border-base-300');
    expect(html).not.toContain('btn-primary');
  });

  test('active: primary, pressed, and the label says how to undo it', () => {
    useAppStore.setState({ soloTracks: ['drums'] });
    const html = renderToString(<SoloButton track="drums" />);
    expect(html).toContain('aria-label="Un-solo Drums"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('btn btn-square btn-xs btn-primary');
  });

  test('a solo on one track does not light another track button', () => {
    useAppStore.setState({ soloTracks: ['drums'] });
    const html = renderToString(<SoloButton track="bass" />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Solo Bass"');
  });

  test('the size prop reaches the daisyUI size class', () => {
    useAppStore.setState({ soloTracks: [] });
    const html = renderToString(<SoloButton track="lead" size="sm" />);
    expect(html).toContain('btn btn-square btn-sm btn-ghost');
  });

  test('each placement gets a stable id', () => {
    useAppStore.setState({ soloTracks: [] });
    expect(renderToString(<SoloButton track="pad" />)).toContain('id="btn-solo-pad"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/ui/SoloButton.test.tsx`
Expected: FAIL — `Cannot find module './SoloButton'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/ui/SoloButton.tsx`:

```tsx
import { Headphones } from 'lucide-react';
import { SOLO_TRACK_LABELS, type SoloTrack } from '@/store/trackAudibility';
import { IconButton } from './IconButton';
import { useLiveStore } from './useLiveStore';

export interface SoloButtonProps {
  track: SoloTrack;
  /** `xs` inside a module card header, `sm` on the Sound view's target row. */
  size?: 'xs' | 'sm';
  className?: string;
}

/**
 * The one track-solo control, rendered at all six placements (spec §4): Sound's
 * target row, Pattern › Lead's header, the chord/bass/pad rows, and Pattern ›
 * Beat's header. The mixer deliberately has none.
 *
 * It only WRITES the ui slice. Effective audibility is computed in
 * store/engineSync.ts and nowhere else — src/components/ may not import
 * audio/engine, and a second copy of the formula in a view is how the two would
 * drift.
 *
 * Reads through useLiveStore, not useAppStore: roughly a third of this suite
 * renders through renderToString, where zustand serves creation-time state as
 * the server snapshot and a test's setState would silently not apply (see
 * .claude/rules/testing.md).
 *
 * A headphones icon rather than a bare "S": IconButton requires an icon and
 * gives the button its accessible name, and "listen to this alone" is what the
 * control means. `btn-primary` when active rather than a new colour role — it
 * is the same active-toggle look the mode switcher and the metronome already
 * use, and IconButton's variant union is closed on purpose.
 */
export function SoloButton({ track, size = 'xs', className }: SoloButtonProps) {
  const soloTracks = useLiveStore((s) => s.soloTracks);
  const toggleSoloTrack = useLiveStore((s) => s.toggleSoloTrack);
  const active = soloTracks.includes(track);
  const label = SOLO_TRACK_LABELS[track];
  return (
    <IconButton
      id={`btn-solo-${track}`}
      label={active ? `Un-solo ${label}` : `Solo ${label}`}
      icon={<Headphones className="w-3.5 h-3.5" />}
      size={size}
      variant={active ? 'primary' : 'outline'}
      aria-pressed={active}
      className={className}
      onClick={() => toggleSoloTrack(track)}
    />
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/components/ui/SoloButton.test.tsx`
Expected: PASS.

If the class assertions fail on ordering, read `IconButton`'s `cx(...)` call and adjust the
expected substring to the order it actually emits — the point of the assertion is that base, size
and variant sit on the *same* element, not the order they happen to be concatenated in.

- [ ] **Step 5: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/SoloButton.tsx src/components/ui/SoloButton.test.tsx
git commit -m "feat(solo): one shared solo button for all six placements"
```

---

## Task 6: Solo on Sound, Pattern › Lead and Pattern › Beat

**Files:**
- Modify: `src/components/loop/SoundView.tsx` (the Target selector row, just after the
  "Control Destination Selector" container)
- Modify: `src/components/loop/PatternView.tsx` (line 35, `<SegmentHeader segment="lead" />`)
- Modify: `src/components/loop/SequencerView.tsx` (line 180, `<SegmentHeader segment="beat" … />`)
- Test: `src/components/loop/SoundView.test.tsx`, `src/components/loop/PatternView.test.tsx`,
  `src/components/loop/SequencerView.test.tsx`, `src/components/loop/SoundMixer.test.tsx`

**Interfaces:**
- Consumes: `SoloButton` (Task 5); `soloTrackForControlTarget` (Task 1); the existing
  `controlTarget` read already present in `SoundView.tsx` (line 76).
- Produces: no new exports. Rendered markup other tasks do not depend on.

**Placement rulings.** "Card header" for Lead and Beat means the segment's `SegmentHeader` card —
that is the header card each segment opens with and it already has an `actions` slot, so both
placements use the same mechanism. Sound gets ONE button, sitting beside the Target selector
rather than in the `ViewHeader` actions cluster, because "the button follows the active target" is
only legible when the button is next to the thing it follows. **Beat gets the track-level Drums
solo only — no per-voice solo**; auditioning one voice is already the preview Play button on every
`TrackRow`.

- [ ] **Step 1: Write the failing tests**

In `src/components/loop/SoundView.test.tsx`, add (the file already renders `SoundView`; reuse its
render or add this describe block):

```tsx
describe('SoundView track solo', () => {
  test('one solo button, following the active target (default: synth = Lead)', () => {
    const html = renderToString(<SoundView />);
    expect(html).toContain('aria-label="Solo Lead"');
    expect(html).not.toContain('aria-label="Solo Chord"');
    expect(html).not.toContain('aria-label="Solo Bass"');
    expect(html).not.toContain('aria-label="Solo Pad"');
    expect(html).not.toContain('aria-label="Solo Drums"');
  });
});
```

In `src/components/loop/PatternView.test.tsx`:

```tsx
describe('Pattern › Lead track solo', () => {
  test('the Lead segment header carries the Lead solo', () => {
    const html = renderToString(<PatternView />);
    expect(html).toContain('aria-label="Solo Lead"');
  });
});
```

In `src/components/loop/SequencerView.test.tsx`:

```tsx
describe('Pattern › Beat track solo', () => {
  test('the Beat header carries the track-level Drums solo', () => {
    expect(html).toContain('aria-label="Solo Drums"');
  });

  test('and no per-voice solo — one solo button in the whole segment', () => {
    expect(html.split('btn-solo-').length - 1).toBe(1);
  });
});
```

In `src/components/loop/SoundMixer.test.tsx`:

```tsx
describe('the mixer has no solo column', () => {
  test('SoundMixer renders no solo control (spec §4)', () => {
    const html = renderToString(<SoundMixer />);
    expect(html).not.toContain('btn-solo-');
    expect(html).not.toContain('Solo ');
  });

  test('and its source names no solo module', () => {
    const source = readFileSync('src/components/loop/SoundMixer.tsx', 'utf8');
    expect(source).not.toContain('SoloButton');
    expect(source).not.toContain('soloTracks');
  });
});
```

`SoundMixer.test.tsx` needs `import { readFileSync } from 'node:fs';` if it does not already have
it. If `SoundMixer` requires props to render, use the same props its existing tests pass; if it
has no render test at all, keep only the source-scan test and drop the `renderToString` one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/components/loop/SoundView.test.tsx src/components/loop/PatternView.test.tsx src/components/loop/SequencerView.test.tsx src/components/loop/SoundMixer.test.tsx`
Expected: FAIL on the three placement tests (no `aria-label="Solo …"` in the markup). The
`SoundMixer` tests should PASS immediately — they are guards, not new behaviour.

- [ ] **Step 3: Add the Sound view button**

In `src/components/loop/SoundView.tsx`, add to the imports:

```ts
import { soloTrackForControlTarget } from "@/store/trackAudibility";
import { SoloButton } from "../ui/SoloButton";
```

and inside the "Row 1: Control Destination / Target Selector" flex row, immediately after the
closing `</div>` of the "Control Destination Selector" container (the one whose className ends
with `${SYNTH_TARGET_STYLES[controlTarget].border}`) and before the oscilloscope's `ml-auto` div:

```tsx
          {/* ONE solo button, following the Target — Sound edits exactly one
              layer at a time, so five buttons here would be four controls for
              layers this view is not editing. It sits beside the Target chips
              rather than in the view header because "it follows the target" is
              only legible next to the target. Session-only: any tab, segment or
              loop change empties it (store/soloNav.ts). */}
          <SoloButton track={soloTrackForControlTarget(controlTarget)} size="sm" />
```

- [ ] **Step 4: Add the Lead and Beat header buttons**

In `src/components/loop/PatternView.tsx`, add the import:

```ts
import { SoloButton } from '../ui/SoloButton';
```

and replace line 35:

```tsx
          <SegmentHeader segment="lead" actions={<SoloButton track="lead" />} />
```

In `src/components/loop/SequencerView.tsx`, add the import:

```ts
import { SoloButton } from "../ui/SoloButton";
```

and replace the `SegmentHeader` call:

```tsx
      {/* The Beat segment's only solo is this track-level one: hearing the
          whole kit with nothing else under it. Auditioning a single voice is
          already the preview Play button every TrackRow carries, and a
          per-voice solo would be a second answer to a question that already
          has one. */}
      <SegmentHeader
        segment="beat"
        badge={sequencerMeterBadge(meter)}
        actions={<SoloButton track="drums" />}
      />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/components/loop/SoundView.test.tsx src/components/loop/PatternView.test.tsx src/components/loop/SequencerView.test.tsx src/components/loop/SoundMixer.test.tsx`
Expected: PASS.

- [ ] **Step 6: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no output from either.

- [ ] **Step 7: Commit**

```bash
git add src/components/loop/SoundView.tsx src/components/loop/SoundView.test.tsx src/components/loop/PatternView.tsx src/components/loop/PatternView.test.tsx src/components/loop/SequencerView.tsx src/components/loop/SequencerView.test.tsx src/components/loop/SoundMixer.test.tsx
git commit -m "feat(solo): solo on Sound, Pattern > Lead and Pattern > Beat"
```

---

## Task 7: Solo on the three Accompaniment rows

**Files:**
- Modify: `src/components/loop/chord/ChordModulePanel.tsx` (the header row, around line 74-85)
- Modify: `src/components/loop/chord/BassModulePanel.tsx` (the header row, around line 62-73)
- Modify: `src/components/loop/chord/PadModulePanel.tsx` (the header row, around line 100-108)
- Test: `src/components/loop/chord/modulePanels.test.tsx`

**Interfaces:**
- Consumes: `SoloButton` (Task 5). Nothing new is produced.

Each of the three cards opens with `<div className="mb-3 flex items-start justify-between gap-2">`
holding a title block and a right-hand control. Chord and Bass have a single right-hand control
(`AdjustSynthButton`); Pad already has a `<div className="flex items-center gap-2">` wrapper around
its mode toggles. So Chord and Bass gain a wrapper, and Pad gains one child.

- [ ] **Step 1: Write the failing test**

In `src/components/loop/chord/modulePanels.test.tsx`, add:

```tsx
describe('Accompaniment rows carry one solo each', () => {
  const noop = () => undefined;

  test('the chord row solos chord', () => {
    const html = renderToString(
      <ChordModulePanel onPatternPreviewDown={noop} onPatternPreviewUp={noop} isPlaying={false} />,
    );
    expect(html).toContain('aria-label="Solo Chord"');
    expect(html).not.toContain('aria-label="Solo Bass"');
    expect(html).not.toContain('aria-label="Solo Pad"');
  });

  test('the bass row solos bass', () => {
    const html = renderToString(
      <BassModulePanel onPatternPreviewDown={noop} onPatternPreviewUp={noop} isPlaying={false} />,
    );
    expect(html).toContain('aria-label="Solo Bass"');
    expect(html).not.toContain('aria-label="Solo Chord"');
  });

  test('the pad row solos pad', () => {
    const html = renderToString(<PadModulePanel />);
    expect(html).toContain('aria-label="Solo Pad"');
    expect(html).not.toContain('aria-label="Solo Chord"');
  });
});
```

Use whatever import list and prop values `modulePanels.test.tsx` already uses for these three
components; the `noop` handlers above match `ChordModulePanelProps` / `BassModulePanelProps`
(`(e: React.MouseEvent | React.TouchEvent) => void`, so a zero-arg `() => undefined` is assignable).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/loop/chord/modulePanels.test.tsx`
Expected: FAIL — none of the three render a solo control.

- [ ] **Step 3: Add the chord row's button**

In `ChordModulePanel.tsx`, add the import:

```ts
import { SoloButton } from "@/components/ui/SoloButton";
```

and replace the lone `AdjustSynthButton` in the header row with:

```tsx
          <div className="flex items-center gap-1.5">
            <SoloButton track="chord" />
            <AdjustSynthButton target="chord" className="text-module-chord" />
          </div>
```

- [ ] **Step 4: Add the bass row's button**

In `BassModulePanel.tsx`, add the import:

```ts
import { SoloButton } from "@/components/ui/SoloButton";
```

and replace the lone `AdjustSynthButton` in the header row with:

```tsx
          <div className="flex items-center gap-1.5">
            <SoloButton track="bass" />
            <AdjustSynthButton target="bass" className="text-module-bass" />
          </div>
```

- [ ] **Step 5: Add the pad row's button**

In `PadModulePanel.tsx`, add the import:

```ts
import { SoloButton } from "@/components/ui/SoloButton";
```

and add it as the FIRST child of the existing right-hand cluster, so all three rows read
solo-then-controls:

```tsx
        <div className="flex items-center gap-2">
          <SoloButton track="pad" />
          <div
            className={JOIN_LANE}
            role="group"
            aria-label="Pad mode"
          >
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/components/loop/chord/modulePanels.test.tsx`
Expected: PASS.

- [ ] **Step 7: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: no output from either.

- [ ] **Step 8: Commit**

```bash
git add src/components/loop/chord/ChordModulePanel.tsx src/components/loop/chord/BassModulePanel.tsx src/components/loop/chord/PadModulePanel.tsx src/components/loop/chord/modulePanels.test.tsx
git commit -m "feat(solo): one solo per Accompaniment row"
```

---

## Task 8: The transport chip, the stale Phase-4 comments, and the gate

**Files:**
- Modify: `src/components/TransportBar.tsx`
- Test: `src/components/TransportBar.test.tsx`
- Modify: `src/store/playbackScope.ts` (three doc comments: ~line 16, ~line 50, ~line 135)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `soloChipLabel` (Task 1); `soloTracks` / `clearSoloTracks` (Task 2).
- Produces: no new exports. `soloChipLabel` is already unit-tested in Task 1; this task asserts the
  markup.

**Why the chip is always visible.** The existing song badge is `hidden md:inline-flex`, and this
bar is under real width pressure below `sm`. The solo chip still renders at every width, because
it is the only global "something is being silenced, and here is how to stop" affordance; the names
truncate instead. It only exists while a solo is latched, which is rare and short-lived by design.

- [ ] **Step 1: Write the failing test**

Add to `src/components/TransportBar.test.tsx`:

```tsx
describe('the transport solo chip', () => {
  afterEach(() => {
    useAppStore.setState({ soloTracks: [] });
  });

  test('is absent when nothing is soloed', () => {
    useAppStore.setState({ soloTracks: [] });
    const html = renderToString(<TransportBar />);
    expect(html).not.toContain('badge-track-solo');
    expect(html).not.toContain('SOLO ·');
  });

  test('names every soloed track and offers a clear', () => {
    useAppStore.setState({ soloTracks: ['lead', 'drums'] });
    const html = renderToString(<TransportBar />);
    expect(html).toContain('id="badge-track-solo"');
    expect(html).toContain('SOLO · Lead + Drums');
    expect(html).toContain('aria-label="Clear solo"');
  });

  test('the chip is a warning badge — a state that is silencing something', () => {
    useAppStore.setState({ soloTracks: ['drums'] });
    const html = renderToString(<TransportBar />);
    expect(html).toContain('badge badge-sm badge-warning');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/TransportBar.test.tsx`
Expected: FAIL — no `badge-track-solo` in the markup.

- [ ] **Step 3: Render the chip**

In `src/components/TransportBar.tsx`, add to the imports:

```ts
import { X } from "lucide-react";
import { soloChipLabel } from "@/store/trackAudibility";
import { useLiveStore } from "./ui/useLiveStore";
```

(`X` joins the existing `lucide-react` import: `import { Volume2, Clock, Plus, Minus, X } from "lucide-react";`)

Add the two reads beside the other store reads, with the comment explaining the exception:

```ts
  // Live reads (useLiveStore, not useAppStore): under renderToString a plain
  // useAppStore selector serves creation-time state, so the chip's test could
  // never latch a solo. Same reason Header.tsx reads its dirty flag this way.
  const soloTracks = useLiveStore((s) => s.soloTracks);
  const clearSoloTracks = useLiveStore((s) => s.clearSoloTracks);
```

and the derived label beside `songLabel`:

```ts
  const soloLabel = soloChipLabel(soloTracks);
```

Then render the chip immediately after the `{songLabel && (…)}` block:

```tsx
        {/* Track solo is session-only and clears itself on any navigation, so
            this chip is short-lived by construction. It still renders at EVERY
            width, unlike the song badge above: it is the only global "something
            is being silenced, and here is how to stop" affordance, so the names
            truncate rather than the chip disappearing. */}
        {soloLabel && (
          <span
            id="badge-track-solo"
            className="badge badge-sm badge-warning font-bold gap-1 max-w-32 sm:max-w-none"
            title="Track solo — cleared when you change tab, segment or loop"
          >
            <span className="truncate">{soloLabel}</span>
            <IconButton
              label="Clear solo"
              icon={<X className="w-3 h-3" />}
              size="xs"
              variant="ghost"
              className="btn-circle"
              onClick={clearSoloTracks}
            />
          </span>
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/components/TransportBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Replace the three forward-referencing comments in `playbackScope.ts`**

These promised what this phase would do and are now stale. Replace each verbatim.

In the `PlaybackScope` docblock, replace:

```
 *   loop — one loop is auditioned alone (a SOLO LOOP). Song advance is
 *          suppressed; that card shows Stop and every other card button is
 *          disabled. Unrelated to the per-track solo Phase 4 adds, which
 *          lives in the ui slice and never touches this union.
```

with:

```
 *   loop — one loop is auditioned alone (a SOLO LOOP). Song advance is
 *          suppressed; that card shows Stop and every other card button is
 *          disabled. Unrelated to TRACK SOLO (`soloTracks` in the ui slice,
 *          formula in store/trackAudibility.ts), which is a set of source
 *          buses, is never persisted, and never touches this union.
```

On the union member, replace:

```
  /** One loop auditioned alone — a SOLO LOOP. Phase 4's per-track solo is a
   *  different feature in a different slice and never appears here. */
```

with:

```
  /** One loop auditioned alone — a SOLO LOOP. Track solo (`soloTracks` in the
   *  ui slice) is a different feature in a different slice and never appears
   *  here. */
```

In `scopedLoopId`'s docblock, replace:

```
 * The id of the loop the scope names, or null. The one accessor views should
 * need. Named for the SCOPE, not for "solo", because Phase 4 introduces a
 * per-track solo that has nothing to do with this value.
```

with:

```
 * The id of the loop the scope names, or null. The one accessor views should
 * need. Named for the SCOPE, not for "solo", because track solo (`soloTracks`
 * in the ui slice) has nothing to do with this value — a reader grepping
 * `solo` would otherwise get two unrelated features.
```

- [ ] **Step 6: Record the rules in `CLAUDE.md`**

Insert this paragraph in the Architecture section, immediately before the
"**`persist` serialises on every `set()`…**" paragraph:

```markdown
**Track solo is a monitoring gesture, and it is session-only on purpose.** `soloTracks` lives in
the ui slice, is absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`, and never touches
`LoopMixPatch` — mute is arrangement intent and stays per loop; solo exists only to hear something
while editing it. It is a **set, not a radio** (soloing Drums then Lead sounds both — with the
per-module play buttons gone, "write a lead over just the drums" is only expressible that way),
**solo beats mute**, and its scope is the whole loop. It is **cleared by navigation** — any change
of `activeTab`, `patternSegment` or `activeLoopId`, watched by the single subscription in
`store/soloNav.ts` rather than by a clear inside each of `activeLoopId`'s six-plus writers. That
clearing is the feature, not a rough edge: a control that can silence a track must not keep doing
so once the user has stopped looking at it, so do not "fix" it into stickiness. Effective
audibility is computed **only** in `engineSync.ts`, off the same `SOURCE_BUSES` table that drives
the snapshot and the subscriptions, using `isTrackAudible` from `store/trackAudibility.ts` —
`src/components/` may not import `audio/engine`, so a view may never compute it. Solo moves the
drums **bus** only; the per-voice drum mute in `sequencerTracks` is a second, independent layer
applied in `useSequencerPlayback`, and both must pass for a voice to sound.
```

- [ ] **Step 7: Run the gate**

Run: `bun run verify`
Expected: PASS — every test green, `tsc --noEmit` silent, `eslint .` reporting **nothing at all**,
`check:keys` / `check:drums` / `check:contrast` / `check:levels` green, and the build succeeding.

- [ ] **Step 8: Commit**

```bash
git add src/components/TransportBar.tsx src/components/TransportBar.test.tsx src/store/playbackScope.ts CLAUDE.md
git commit -m "feat(solo): transport solo chip, and retire the Phase 4 forward references"
```

---

## Self-Review

**1. Spec coverage (§4, §7's leftovers, "Out of scope", "Test obligations")**

| Spec requirement | Task |
| --- | --- |
| Five solo targets, one per track | 1 (`SOLO_TRACKS`), 4 (`SOURCE_BUSES.solo`) |
| No per-drum-voice solo; the Beat segment's only solo is track-level Drums | 6 (placement + the "one solo button in the whole segment" assertion) |
| Placed where the editing happens: Sound (one, follows the target) | 6 |
| Pattern › Lead card header | 6 |
| Pattern › Accompaniment: one per chord / bass / pad row | 7 |
| Pattern › Beat card header | 6 |
| The mixer has no solo column at all | 6 (`SoundMixer` render + source-scan guards) |
| Solo is a set, not a radio | 1 (`toggleSolo`, additive tests), 2 (store-level), 4 (engine-level) |
| Solo beats mute | 1, 4 |
| Scope is the whole loop; one solo set in the system | 1 (`isTrackAudible` covers all five from one array), 2 (one field) |
| Cleared by navigation: tab, segment, layer, active loop | 3 |
| Prohibition 1 — not in `LoopMixPatch` / `partializeAppState` / `PROJECT_CONTENT_KEYS` | Global Constraints + 2 (guard test) |
| Prohibition 2 — audibility computed in `engineSync.ts`, never in a component | Global Constraints + 4 |
| Out of scope: solo does not start playback | 2 (explicit test) |
| Out of scope: no persist `version` / `formatVersion` move | Global Constraints (nothing persisted, so nothing to move) |
| §7's stale "Phase 4" forward references in `playbackScope.ts` | 8 |
| Test obligation: partialize / `PROJECT_CONTENT_KEYS` guard | 2 |
| Test obligation: solo is additive | 1, 2, 4 |
| Test obligation: solo beats mute | 1, 4 |
| Test obligation: a drum voice needs both layers | 1 (`drumVoiceSounds`), 4 (per-voice layer untouched) |

No gaps found. The spec's other test obligations (`playbackScope.test.ts`'s reducer totality,
`songMode`'s four cases, "playing implies a scope", `viewMeta.test.ts`) belong to Phases 1-3 and
are already merged.

**2. Placeholder scan**

No "TBD", "implement later", "add error handling", "similar to Task N" or "write tests for the
above". Every code step carries the actual code. Two steps carry a conditional fallback rather
than a placeholder — Task 5 step 4 (what to do if `IconButton`'s class concatenation order differs
from the asserted substring) and Task 6 step 1 (`SoundMixer.test.tsx` may have no render test) —
and both state the exact alternative and the reason, rather than deferring a decision.

**3. Type consistency**

- `SoloTrack` is `'lead' | 'chord' | 'bass' | 'pad' | 'drums'` in Task 1 and is used with exactly
  those five members in Tasks 2, 4, 5, 6, 7.
- `isTrackAudible(track, soloTracks, muted)` — the argument order is identical in the Task 1
  definition, the Task 1 tests and Task 4's `busAudible`.
- `toggleSolo(soloTracks, track)` in Task 1 is called with that order in Task 2's
  `toggleSoloTrack`.
- Store action names are `toggleSoloTrack` / `clearSoloTracks` in Task 2's interface, Task 2's
  implementation, Task 3's subscription, Task 5's button and Task 8's chip — never `toggleSolo`,
  which is the pure helper.
- `soloChipLabel` returns `string | null`; Task 8 renders it behind a truthiness check, matching
  how `songModeLabel` is already used in the same file.
- `SoloButtonProps.size` is `'xs' | 'sm'`, a subset of `IconButtonSize` (`'xs' | 'sm' | 'md'`), so
  it passes through without a cast.
- `soloTrackForControlTarget` takes `SynthControlTarget` and returns `SoloTrack`; `SoundView`
  passes it `controlTarget`, which is typed `SynthControlTarget`.

# Automation Player Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Beat and Chords players a three-state transport with distinct soft (stop at the next bar line) and hard (cut now) stops, drivable from the header and the transport bar, and make Instant Vibe switches swap atomically instead of overlapping.

**Architecture:** Two transient `PlayerState` fields replace the transport slice's play booleans. Each playback hook owns every engine call for its own player, reaching the engine only through `audio/playback/playbackEngine.ts`. Stop timing decisions live in one pure module (`components/playerStop.ts`) shared by both hooks so they can be unit-tested without a DOM. One new `PlayerTransport` primitive renders every transport control in the app.

**Tech Stack:** Bun (test runner + scripts), Vite, React 18, Zustand (`subscribeWithSelector` + `persist`), raw Web Audio API, Tailwind v4 + daisyUI v5 (CSS-first, no `tailwind.config.*`), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-08-26-automation-player-transport-design.md`

## Global Constraints

- **Layering (enforced by eslint `no-restricted-imports`):** `src/audio/` must not import `store/` or `components/`. `src/store/` must not import `components/`. `src/components/` must not import `audio/engine` — only the `audio/playback/playbackEngine.ts` bridge.
- **Never call engine setters from a component.** Store-state → engine sync belongs in `src/store/engineSync.ts`. Event-driven playback calls go through `playbackEngine.ts`, which is how the playback hooks already reach the engine.
- **Theme tokens only.** `scripts/themeTokenGuard.ts` fails the build on raw hex, Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), `text-white`/`bg-black`, the `dark:` variant, `rgb()`/`rgba()` literals, and dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). Its `ALLOWLIST` is empty and must stay empty.
- **Tests are pure-logic `bun:test`.** There is no DOM or testing-library setup. Components export their testable helpers and the `.test.tsx` file imports those instead of rendering React.
- **`bun run verify`** (test + lint + check:keys + check:drums + build) is the completion gate. Run `bun run eslint` separately — `verify` does not include it, and this work adds imports.
- `STEPS_PER_BAR` is 16. `CLOCK_LOOKAHEAD` is `0.1` seconds. Hard-stop release is `0.02` seconds; soft-stop release is the player's own configured `release`.
- `sequencerPlayer` and `chordsPlayer` are **transient**. `partializeAppState` in `store.ts` is an explicit allowlist and must not gain them, so no store version bump and no migration.

---

### Task 1: Player state machine in the transport slice

Pure refactor. Replaces the two play booleans with two `PlayerState` fields and mechanically ports all six consumers. No behaviour changes yet: `hardStop` still only sets state, and nothing calls `softStop`.

**Files:**
- Modify: `src/store/types.ts:14-26` (the `TransportSlice` interface)
- Modify: `src/store/transportSlice.ts` (whole file)
- Modify: `src/store/engineSync.ts:87-97`
- Modify: `src/components/SequencerView.tsx:31`
- Modify: `src/components/useSequencerPlayback.ts:25`
- Modify: `src/components/chord/useChordPlayback.ts:50`
- Modify: `src/components/Header.tsx:89-90,158-165`
- Modify: `src/components/TransportBar.tsx:13-51`
- Modify: `src/store/engineSync.test.ts` (its `beforeEach` and transport test drive the removed API)
- Test: `src/store/transportSlice.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `PlayerState`, `PlayerModule`, the `sequencerPlayer` / `chordsPlayer` fields, the actions `play(module)`, `softStop(module)`, `hardStop(module)`, `playAll()`, `softStopAll()`, `hardStopAll()`, and the pure helpers `isPlayerActive(state)`, `aggregatePlayerState(a, b)`, `isHardStopEnabled(a, b)` exported from `src/store/transportSlice.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/store/transportSlice.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import {
  aggregatePlayerState,
  createTransportSlice,
  isHardStopEnabled,
  isPlayerActive,
} from './transportSlice';
import type { AppStore, PlayerState, TransportSlice } from './types';

// Minimal harness: createTransportSlice takes zustand's (set, get). We back
// both with a plain object so the slice can be exercised without a store.
function makeSlice(initial?: Partial<TransportSlice>) {
  let state = {} as AppStore;
  const set = ((partial: unknown) => {
    const patch = typeof partial === 'function' ? (partial as (s: AppStore) => object)(state) : partial;
    state = { ...state, ...(patch as object) } as AppStore;
  }) as StoreApi<AppStore>['setState'];
  const get = (() => state) as StoreApi<AppStore>['getState'];
  state = { ...createTransportSlice(set, get), ...initial } as AppStore;
  return {
    get state() {
      return state;
    },
  };
}

const ALL: PlayerState[] = ['stopped', 'playing', 'stopping'];

describe('transport player state machine', () => {
  test('both players start stopped', () => {
    const s = makeSlice().state;
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
  });

  test('play only starts a stopped player — it never cancels a pending stop', () => {
    for (const from of ALL) {
      const h = makeSlice({ chordsPlayer: from });
      h.state.play('chords');
      expect(h.state.chordsPlayer).toBe(from === 'stopped' ? 'playing' : from);
    }
  });

  test('softStop only applies to a playing player', () => {
    for (const from of ALL) {
      const h = makeSlice({ chordsPlayer: from });
      h.state.softStop('chords');
      expect(h.state.chordsPlayer).toBe(from === 'playing' ? 'stopping' : from);
    }
  });

  test('hardStop always lands on stopped', () => {
    for (const from of ALL) {
      const h = makeSlice({ chordsPlayer: from });
      h.state.hardStop('chords');
      expect(h.state.chordsPlayer).toBe('stopped');
    }
  });

  test('actions address one player and leave the other untouched', () => {
    const h = makeSlice({ sequencerPlayer: 'playing', chordsPlayer: 'playing' });
    h.state.softStop('sequencer');
    expect(h.state.sequencerPlayer).toBe('stopping');
    expect(h.state.chordsPlayer).toBe('playing');
  });

  test('master actions apply the per-player rule to both', () => {
    const h = makeSlice({ sequencerPlayer: 'stopped', chordsPlayer: 'stopping' });
    h.state.playAll();
    // sequencer was stopped -> playing; chords was stopping -> unchanged
    expect(h.state.sequencerPlayer).toBe('playing');
    expect(h.state.chordsPlayer).toBe('stopping');

    h.state.hardStopAll();
    expect(h.state.sequencerPlayer).toBe('stopped');
    expect(h.state.chordsPlayer).toBe('stopped');
  });

  test('softStopAll stops every playing player', () => {
    const h = makeSlice({ sequencerPlayer: 'playing', chordsPlayer: 'playing' });
    h.state.softStopAll();
    expect(h.state.sequencerPlayer).toBe('stopping');
    expect(h.state.chordsPlayer).toBe('stopping');
  });
});

describe('derived transport helpers', () => {
  test('a player counts as active unless it is fully stopped', () => {
    expect(isPlayerActive('stopped')).toBe(false);
    expect(isPlayerActive('playing')).toBe(true);
    expect(isPlayerActive('stopping')).toBe(true);
  });

  test('aggregate covers all nine pairs', () => {
    const expected: Record<string, PlayerState> = {
      'stopped|stopped': 'stopped',
      'stopped|playing': 'playing',
      'stopped|stopping': 'stopping',
      'playing|stopped': 'playing',
      'playing|playing': 'playing',
      'playing|stopping': 'playing',
      'stopping|stopped': 'stopping',
      'stopping|playing': 'playing',
      'stopping|stopping': 'stopping',
    };
    for (const a of ALL) {
      for (const b of ALL) {
        expect(aggregatePlayerState(a, b)).toBe(expected[`${a}|${b}`]);
      }
    }
  });

  test('hard stop is enabled whenever any player still has sound scheduled', () => {
    expect(isHardStopEnabled('stopped', 'stopped')).toBe(false);
    // Deliberately NOT derived from aggregate: one stopping + one stopped
    // still needs a working hard stop.
    expect(isHardStopEnabled('stopping', 'stopped')).toBe(true);
    expect(isHardStopEnabled('stopped', 'playing')).toBe(true);
    expect(isHardStopEnabled('stopping', 'stopping')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/transportSlice.test.ts
```

Expected: FAIL — `createTransportSlice` does not export `aggregatePlayerState` / `isHardStopEnabled` / `isPlayerActive`, and `sequencerPlayer` is undefined.

- [ ] **Step 3: Add the types**

In `src/store/types.ts`, add above `TransportSlice`:

```ts
/** A player is `stopping` between a soft stop and the bar line that ends it. */
export type PlayerState = 'stopped' | 'playing' | 'stopping';

export type PlayerModule = 'sequencer' | 'chords';
```

Then replace the `TransportSlice` body's play members:

```ts
export interface TransportSlice {
  bpm: number;
  masterVolume: number;
  metronomeActive: boolean;
  // Transient (not persisted): mirrors the live transport state.
  sequencerPlayer: PlayerState;
  chordsPlayer: PlayerState;
  setBpm: (bpm: number) => void;
  setMasterVolume: (volume: number) => void;
  toggleMetronome: () => void;
  play: (module: PlayerModule) => void;
  softStop: (module: PlayerModule) => void;
  hardStop: (module: PlayerModule) => void;
  playAll: () => void;
  softStopAll: () => void;
  hardStopAll: () => void;
}
```

`isSequencerPlaying`, `isChordsPlaying`, `toggleSequencerPlay`, `toggleChordsPlay` and `toggleMasterPlay` are removed.

- [ ] **Step 4: Rewrite the slice**

Replace `src/store/transportSlice.ts` with:

```ts
import type { StoreApi } from 'zustand';
import type { AppStore, PlayerModule, PlayerState, TransportSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

type PlayerField = 'sequencerPlayer' | 'chordsPlayer';

const FIELD: Record<PlayerModule, PlayerField> = {
  sequencer: 'sequencerPlayer',
  chords: 'chordsPlayer',
};

/** A player still owns scheduled sound unless it is fully stopped. */
export function isPlayerActive(state: PlayerState): boolean {
  return state !== 'stopped';
}

/** The single state the master transport shows for both players. */
export function aggregatePlayerState(a: PlayerState, b: PlayerState): PlayerState {
  if (a === 'playing' || b === 'playing') return 'playing';
  if (a === 'stopping' || b === 'stopping') return 'stopping';
  return 'stopped';
}

/**
 * Deliberately NOT derived from aggregatePlayerState: when one player is
 * `stopping` and the other is already `stopped`, the aggregate reads
 * `stopping` but there is still sound to cut, so hard stop must stay live.
 */
export function isHardStopEnabled(a: PlayerState, b: PlayerState): boolean {
  return isPlayerActive(a) || isPlayerActive(b);
}

/**
 * Transport slice. `sequencerPlayer` / `chordsPlayer` are transient (excluded
 * from `partializeAppState`); everything else persists.
 *
 * Engine side-effects (init/resetClock on the fully-stopped -> playing
 * transition) are handled by engineSync's transport subscription; the actual
 * silencing of scheduled voices is owned by each playback hook.
 */
export function createTransportSlice(set: Set, _get: Get): TransportSlice {
  const transition = (module: PlayerModule, next: (current: PlayerState) => PlayerState) =>
    set((state) => {
      const field = FIELD[module];
      const current = state[field];
      const target = next(current);
      return target === current ? {} : ({ [field]: target } as Partial<AppStore>);
    });

  const play = (module: PlayerModule) =>
    transition(module, (current) => (current === 'stopped' ? 'playing' : current));

  const softStop = (module: PlayerModule) =>
    transition(module, (current) => (current === 'playing' ? 'stopping' : current));

  const hardStop = (module: PlayerModule) => transition(module, () => 'stopped');

  return {
    bpm: 120,
    masterVolume: 0.85,
    metronomeActive: false,
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',

    setBpm: (bpm) => set({ bpm }),
    setMasterVolume: (masterVolume) => set({ masterVolume }),

    toggleMetronome: () => set((state) => ({ metronomeActive: !state.metronomeActive })),

    play,
    softStop,
    hardStop,

    playAll: () => {
      play('sequencer');
      play('chords');
    },
    softStopAll: () => {
      softStop('sequencer');
      softStop('chords');
    },
    hardStopAll: () => {
      hardStop('sequencer');
      hardStop('chords');
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test src/store/transportSlice.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 6: Port `engineSync.ts`**

Replace the transport subscription at `src/store/engineSync.ts:87-97`. Keep the existing comment block and extend it — the "fully stopped" definition is load-bearing.

```ts
  // Transport player states: init on EVERY transition — the old toggle actions
  // called audioEngine.init() unconditionally, and init()'s resume path is
  // load-bearing (the browser suspends the AudioContext when the tab is
  // backgrounded, so returning with chords playing and starting the sequencer
  // must resume audio). resetClock stays restricted to the fully-stopped ->
  // active transition, which keeps both players counting the SAME bars: a
  // player joining while the other runs must not restart the grid.
  //
  // "Fully stopped" means BOTH players are 'stopped'. A 'stopping' player is
  // still active — otherwise a soft stop followed by a restart would reset the
  // grid mid-flight. Encoded 1/2/3 so the subscription fires only on real
  // transitions.
  subs.push(
    useAppStore.subscribe(
      (s) =>
        (isPlayerActive(s.sequencerPlayer) ? 1 : 0) + (isPlayerActive(s.chordsPlayer) ? 2 : 0),
      (flags, prevFlags) => {
        audioEngine.init();
        if (flags !== 0 && prevFlags === 0) {
          audioEngine.resetClock();
        }
      },
    ),
  );
```

Add `import { isPlayerActive } from './transportSlice';` at the top of the file.

- [ ] **Step 7: Port the three read-only consumers**

`src/components/SequencerView.tsx:31`:

```ts
  const isPlaying = useAppStore((s) => s.sequencerPlayer !== 'stopped');
```

`src/components/useSequencerPlayback.ts:25`:

```ts
  const isPlaying = useAppStore((s) => s.sequencerPlayer !== 'stopped');
```

`src/components/chord/useChordPlayback.ts:50`:

```ts
  const isPlaying = useAppStore((s) => s.chordsPlayer !== 'stopped');
```

- [ ] **Step 8: Port `Header.tsx`**

Replace the two selectors at `src/components/Header.tsx:89-90`:

```ts
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
```

And the `isTabPlaying` expression at `Header.tsx:158-165`:

```ts
            const isTabPlaying =
              tab.playingKey === 'sequencer'
                ? sequencerPlayer !== 'stopped'
                : tab.playingKey === 'chords'
                  ? chordsPlayer !== 'stopped'
                  : false;
```

Task 7 replaces this whole block; this step only keeps the tree compiling.

- [ ] **Step 9: Port `TransportBar.tsx`**

At `src/components/TransportBar.tsx:13-51`, replace the selectors and handlers. Behaviour is preserved exactly (stop still means "stop both"); Task 8 rewrites this section properly.

```ts
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const play = useAppStore((s) => s.play);
  const hardStop = useAppStore((s) => s.hardStop);
  const playAll = useAppStore((s) => s.playAll);
  const hardStopAll = useAppStore((s) => s.hardStopAll);
```

```ts
  const isPlaying =
    activeTab === 'sequencer'
      ? sequencerPlayer !== 'stopped'
      : activeTab === 'chords'
        ? chordsPlayer !== 'stopped'
        : false;
  const isPlayingAll = sequencerPlayer !== 'stopped' || chordsPlayer !== 'stopped';
  const isPlayDisabled = !['sequencer', 'chords'].includes(activeTab);

  const onTogglePlay = () => {
    if (activeTab !== 'sequencer' && activeTab !== 'chords') return;
    if (isPlaying) hardStop(activeTab);
    else play(activeTab);
  };
  const onTogglePlayAll = () => {
    if (isPlayingAll) hardStopAll();
    else playAll();
  };
```

- [ ] **Step 10: Port `engineSync.test.ts` and pin the shared-bar-grid invariant**

`src/store/engineSync.test.ts` already drives the transport through the removed
API and will not compile. Update its `beforeEach`:

```ts
beforeEach(() => {
  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped' });
});
```

Rewrite its `'transport flags init on every transition, resetClock only on
stopped -> playing'` test to use the new actions (`play('sequencer')`,
`play('chords')`, `hardStopAll()`), keeping its existing `spyOn(audioEngine,
'init').mockImplementation(() => {})` suppression — real `init()` needs
`window.AudioContext`, which bun does not have.

Then add the invariant the spec calls out. Without this test, a future change
that treats `stopping` as inactive would silently restart the bar grid
mid-flight and nothing would catch it:

```ts
  test('a stopping player still counts as active, so the bar grid is never reset mid-flight', () => {
    const init = spyOn(audioEngine, 'init').mockImplementation(() => {}).mockClear();
    const resetClock = spyOn(audioEngine, 'resetClock').mockClear();
    startEngineSync();

    useAppStore.getState().play('chords');
    expect(resetClock).toHaveBeenCalledTimes(1); // stopped -> active

    resetClock.mockClear();
    useAppStore.getState().softStop('chords');
    useAppStore.getState().play('sequencer');
    // Chords was 'stopping', i.e. still active, so this is NOT a
    // fully-stopped -> active transition and the grid must survive.
    expect(resetClock).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalled();

    useAppStore.getState().hardStopAll();
    resetClock.mockClear();
    useAppStore.getState().play('chords');
    expect(resetClock).toHaveBeenCalledTimes(1); // genuinely fully stopped
  });
```

Run it:

```bash
bun test src/store/engineSync.test.ts
```

Expected: PASS.

- [ ] **Step 11: Run the full gate**

```bash
bun run verify && bun run eslint
```

Expected: PASS. If `store.test.ts` also references the removed booleans, update
those references to the new fields — do not reintroduce the booleans.

- [ ] **Step 12: Commit**

```bash
git add src/store/types.ts src/store/transportSlice.ts src/store/transportSlice.test.ts src/store/engineSync.ts src/store/engineSync.test.ts src/components/SequencerView.tsx src/components/useSequencerPlayback.ts src/components/chord/useChordPlayback.ts src/components/Header.tsx src/components/TransportBar.tsx
git commit -m "refactor(transport): replace play booleans with a three-state player machine"
```

---

### Task 2: Schedulable `stopSource` and its playback bridge

**Files:**
- Modify: `src/audio/engine.ts:551-565` (`stopSource`)
- Modify: `src/audio/playback/playbackEngine.ts`
- Test: `src/audio/engine.test.ts` (add a describe block)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `audioEngine.stopSource(source: string, releaseTime?: number, time?: number)` and `playbackStopSource(source: string, releaseTime?: number, time?: number): void` exported from `src/audio/playback/playbackEngine.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/engine.test.ts`. That file already has everything needed: `makeEngine()`, the `fakeCtx()` whose `currentTime` is `10`, the `SYNTH` params fixture, and an existing `describe('source stop (preview release)')` block whose test reads `(engine as any).sourceVoices`. Reuse them — do not build a second harness.

```ts
describe('scheduled source stop (soft stop on a bar line)', () => {
  test('a future time anchors the release there, not at currentTime', () => {
    const engine = makeEngine();
    (engine as any).ctx = fakeCtx();
    (engine as any).setupMasterChain();
    const t0 = (engine as any).ctx.currentTime; // 10

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord');

    // Schedule the stop a bar ahead, the way a soft stop does.
    const stopAt = t0 + 2;
    engine.stopSource('chord', 0.4, stopAt);

    const voices = Array.from(
      (engine as any).sourceVoices.get('chord') as Set<{
        releaseScheduledAt: number;
        gains: { gain: { cancels: number[] } }[];
      }>,
    );
    expect(voices).toHaveLength(1);
    expect(voices[0].releaseScheduledAt).toBe(stopAt);
    // releaseVoice cancels the envelope at the SAME anchor it ramps from.
    expect(voices[0].gains[0].gain.cancels).toContain(stopAt);
    expect(voices[0].gains[0].gain.cancels).not.toContain(t0);
  });

  test('omitting time keeps the existing immediate behaviour', () => {
    const engine = makeEngine();
    (engine as any).ctx = fakeCtx();
    (engine as any).setupMasterChain();
    const t0 = (engine as any).ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.stopSource('chord', 0.02);

    const voices = Array.from(
      (engine as any).sourceVoices.get('chord') as Set<{ releaseScheduledAt: number }>,
    );
    expect(voices[0].releaseScheduledAt).toBe(t0);
  });
});
```

Copy the two `(engine as any).ctx = fakeCtx()` / `setupMasterChain()` lines from whatever the neighbouring `describe('source stop (preview release)')` test already does, so both blocks bootstrap the engine identically.

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/audio/engine.test.ts -t "stopSource scheduling"
```

Expected: FAIL — `stopSource` ignores the third argument and anchors at `ctx.currentTime`.

- [ ] **Step 3: Add the optional time**

In `src/audio/engine.ts`, change `stopSource`:

```ts
  // Immediately silences every voice of a source — sounding ones and hits
  // still scheduled in the future. Releasing a held preview stops the whole
  // pattern, not just the last scheduled hit.
  //
  // `time` anchors the release in the AudioContext's timeline so a soft stop
  // can be scheduled exactly on a bar line instead of relying on a timer.
  // releaseVoice already handles a `now` in the future.
  stopSource(source: string, releaseTime = 0.1, time?: number): void {
    if (!this.ctx) return;
    const now = time ?? this.ctx.currentTime;
    const voices = this.sourceVoices.get(source);
    if (!voices) return;
    for (const voice of Array.from(voices)) {
      voice.releaseScheduledAt = now;
      this.releaseVoice(voice, releaseTime, now);
    }
  }
```

- [ ] **Step 4: Add the bridge export**

Append to `src/audio/playback/playbackEngine.ts`:

```ts
/**
 * Silences a whole playback source — sounding voices AND hits already
 * scheduled ahead of the transport. `time` anchors the release on the audio
 * clock so a soft stop lands exactly on a bar line.
 */
export function playbackStopSource(
  source: string,
  releaseTime = 0.1,
  time?: number,
): void {
  audioEngine.stopSource(source, releaseTime, time);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
bun test src/audio/engine.test.ts && bun run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts src/audio/playback/playbackEngine.ts
git commit -m "feat(audio): let stopSource schedule its release on the audio clock"
```

---

### Task 3: Stop-timing policy module

One pure module both playback hooks share, so the timing decisions are testable without a DOM.

**Files:**
- Create: `src/components/playerStop.ts`
- Test: `src/components/playerStop.test.ts`

**Interfaces:**
- Consumes: `PlayerState` from `src/store/types.ts` (Task 1).
- Produces: `shouldHardStopNow(prev, next, softStopPending): boolean` and `isSoftStopBoundary(state, step, stepsPerBar): boolean`, both exported from `src/components/playerStop.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/components/playerStop.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { isSoftStopBoundary, shouldHardStopNow } from './playerStop';
import type { PlayerState } from '../store/types';

const ALL: PlayerState[] = ['stopped', 'playing', 'stopping'];

describe('shouldHardStopNow', () => {
  test('fires on any active -> stopped transition', () => {
    expect(shouldHardStopNow('playing', 'stopped', false)).toBe(true);
    expect(shouldHardStopNow('stopping', 'stopped', false)).toBe(true);
  });

  test('does not fire when nothing was playing', () => {
    expect(shouldHardStopNow('stopped', 'stopped', false)).toBe(false);
  });

  test('does not fire on transitions that keep the player active', () => {
    expect(shouldHardStopNow('stopped', 'playing', false)).toBe(false);
    expect(shouldHardStopNow('playing', 'stopping', false)).toBe(false);
  });

  // The soft path also lands on 'stopped'. Without this guard the hard-stop
  // effect would fire a second, immediate stopSource and clip the tail that
  // the soft stop deliberately left ringing.
  test('a pending soft stop suppresses the hard stop', () => {
    expect(shouldHardStopNow('stopping', 'stopped', true)).toBe(false);
    expect(shouldHardStopNow('playing', 'stopped', true)).toBe(false);
  });
});

describe('isSoftStopBoundary', () => {
  test('only a stopping player stops, and only on a bar line', () => {
    expect(isSoftStopBoundary('stopping', 0, 16)).toBe(true);
    expect(isSoftStopBoundary('stopping', 32, 16)).toBe(true);
    expect(isSoftStopBoundary('stopping', 15, 16)).toBe(false);
    expect(isSoftStopBoundary('stopping', 1, 16)).toBe(false);
  });

  test('players that are not stopping never trigger a boundary stop', () => {
    for (const state of ALL.filter((s) => s !== 'stopping')) {
      expect(isSoftStopBoundary(state, 0, 16)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/components/playerStop.test.ts
```

Expected: FAIL — `Cannot find module './playerStop'`.

- [ ] **Step 3: Write the module**

Create `src/components/playerStop.ts`:

```ts
import type { PlayerState } from '../store/types';

/**
 * Stop-timing policy shared by the Beat and Chords playback hooks. Kept as
 * pure functions (not hook internals) so the transitions can be tested
 * without a DOM — the repo has no testing-library setup.
 */

/**
 * True when a player just became fully stopped and no soft stop is already
 * in flight. The soft path also ends on 'stopped', so `softStopPending`
 * exists to stop the hard-stop effect from clipping the tail the soft stop
 * deliberately left ringing.
 */
export function shouldHardStopNow(
  prev: PlayerState,
  next: PlayerState,
  softStopPending: boolean,
): boolean {
  return next === 'stopped' && prev !== 'stopped' && !softStopPending;
}

/**
 * True on the clock step where a soft-stopping player should actually stop:
 * the next bar line on the shared grid.
 */
export function isSoftStopBoundary(
  state: PlayerState,
  step: number,
  stepsPerBar: number,
): boolean {
  return state === 'stopping' && step % stepsPerBar === 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test src/components/playerStop.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/playerStop.ts src/components/playerStop.test.ts
git commit -m "feat(transport): add the shared soft/hard stop timing policy"
```

---

### Task 4: Wire soft and hard stop into the Chords player

**Files:**
- Modify: `src/components/chord/useChordPlayback.ts` (the state hook and the clock effect)

**Interfaces:**
- Consumes: `chordsPlayer` (Task 1), `playbackStopSource` (Task 2), `shouldHardStopNow` / `isSoftStopBoundary` (Task 3).
- Produces: no new exports. Behaviour: the Chords player silences sources `'chord'` and `'bass'`.

- [ ] **Step 1: Read the player state instead of a boolean**

In `useChordPlaybackState()`, replace the ported line from Task 1 with the raw state plus the derived flag, and add the release values the stop needs:

```ts
  const playerState = useAppStore((s) => s.chordsPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
```

Return `playerState` and `hardStop` alongside the existing values, and derive `const isPlaying = playerState !== 'stopped';` in `useChordPlayback` from the destructured `playerState`. `chordSynthParams` and `bassSynthParams` are already in the hook — their `.release` fields are the soft-stop release times.

- [ ] **Step 2: Add the refs and the hard-stop effect**

Add next to the existing `armedRef` / `chordIndexRef` / `nextBarStepRef` declarations:

```ts
  // The soft path also ends on 'stopped'. This ref tells the hard-stop effect
  // that a release is already scheduled on the audio clock, so it must not
  // fire a second, immediate stopSource and clip the tail.
  const softStopPendingRef = useRef(false);
  const prevPlayerStateRef = useRef<PlayerState>('stopped');
```

Then, after the existing effects:

```ts
  // Hard stop: cut both sources now. The Chords player drives the bass line,
  // so silencing 'chord' alone would leave the bass droning.
  useEffect(() => {
    const prev = prevPlayerStateRef.current;
    prevPlayerStateRef.current = playerState;
    if (!shouldHardStopNow(prev, playerState, softStopPendingRef.current)) {
      if (playerState === 'stopped') softStopPendingRef.current = false;
      return;
    }
    playbackStopSource('chord', HARD_STOP_RELEASE);
    playbackStopSource('bass', HARD_STOP_RELEASE);
  }, [playerState]);
```

Add at module scope, above the hook:

```ts
/** Short enough to read as an instant cut, long enough not to click. */
const HARD_STOP_RELEASE = 0.02;
```

Import `PlayerState` from `../../store/types`, `playbackStopSource` from `../../audio/playback/playbackEngine`, and `isSoftStopBoundary` / `shouldHardStopNow` from `../playerStop`.

- [ ] **Step 3: Handle the soft-stop boundary in the clock callback**

Inside the `subscribePlaybackClock` callback in the main effect, as the **first** thing the callback does — before the `armedRef` arming check:

```ts
      // Soft stop: schedule the release exactly on the bar line the clock is
      // handing us, then mark the player stopped. Using the clock's `time`
      // (not a timer) is what makes the cut land on the beat.
      if (isSoftStopBoundary(playerStateRef.current, step, STEPS_PER_BAR)) {
        playbackStopSource('chord', chordSynthParams.release, time);
        playbackStopSource('bass', bassSynthParams.release, time);
        softStopPendingRef.current = true;
        hardStop('chords');
        return;
      }
```

The effect's dependency array must not gain `playerState` — re-subscribing the clock on every state change is exactly the stall this file's existing comment warns about. Mirror the existing `playFnsRef` pattern instead:

```ts
  const playerStateRef = useRef(playerState);
  useEffect(() => {
    playerStateRef.current = playerState;
  });
```

The clock effect's guard stays `if (!isPlaying || chords.length === 0)`, where `isPlaying` is `playerState !== 'stopped'` — a `stopping` player must keep its subscription alive long enough to reach the bar line.

- [ ] **Step 4: Verify by hand in the running app**

```bash
bun run dev
```

Check, in order:
1. Play Chords, then hard stop mid-bar → sound cuts immediately, no drone.
2. Play Chords, then soft stop mid-bar → sound continues to the bar line, then decays naturally; the button shows `stopping` in between.
3. Play Chords with a 2-bar chord and soft stop during its first bar → it ends at that bar line (expected per spec).
4. Play both, soft stop Chords only → the Beat keeps its bar count, unbroken.

- [ ] **Step 5: Run the gate**

```bash
bun run verify && bun run eslint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/chord/useChordPlayback.ts
git commit -m "feat(chords): schedule soft stops on the bar line and cut hard stops now"
```

---

### Task 5: Wire soft stop into the Beat player

The Beat player never calls `stopSource` — drums are one-shots. It only stops scheduling.

**Files:**
- Modify: `src/components/useSequencerPlayback.ts`

**Interfaces:**
- Consumes: `sequencerPlayer` and `hardStop` (Task 1), `isSoftStopBoundary` (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Read the player state and the action**

Replace the ported line from Task 1:

```ts
  const playerState = useAppStore((s) => s.sequencerPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';
```

Add the same latest-value ref used by the chord hook, so the clock effect never resubscribes on a state change:

```ts
  const playerStateRef = useRef(playerState);
  useEffect(() => {
    playerStateRef.current = playerState;
  });
```

- [ ] **Step 2: Stop scheduling at the bar line**

As the first statement inside the `subscribePlaybackClock` callback:

```ts
      // Soft stop: the Beat player owns no sustained voices — drums are
      // fire-and-forget one-shots — so stopping means stopping the schedule.
      // At most one already-scheduled hit can still sound, no later than
      // CLOCK_LOOKAHEAD (0.1s) after the press. Accepted; see the spec.
      if (isSoftStopBoundary(playerStateRef.current, step, STEPS_PER_BAR)) {
        hardStop('sequencer');
        return;
      }
```

Import `isSoftStopBoundary` from `./playerStop`.

- [ ] **Step 3: Verify by hand**

```bash
bun run dev
```

1. Play Beat, hard stop → stops immediately (at most one stray hit within 100ms).
2. Play Beat, soft stop mid-bar → the loop finishes the bar, then stops; the button pulses `stopping` in between.

- [ ] **Step 4: Run the gate**

```bash
bun run verify && bun run eslint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/useSequencerPlayback.ts
git commit -m "feat(beat): stop the step schedule on the bar line for soft stops"
```

---

### Task 6: Atomic Instant Vibe swap

**Files:**
- Modify: `src/store/instantVibes.ts:58-110` (`applyInstantVibeToStore`)
- Test: `src/store/instantVibes.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `play` / `hardStopAll` / `sequencerPlayer` / `chordsPlayer` (Task 1).
- Produces: no signature change — `applyInstantVibeToStore(vibe)` keeps its shape.

- [ ] **Step 1: Write the failing test**

Append to `src/store/instantVibes.test.ts`. Reuse whatever store-access helper that file already uses; if it has none, follow the dynamic-import pattern from `store.test.ts`.

```ts
describe('applyInstantVibeToStore transport handling', () => {
  test('a vibe swap restarts only the players that were active', async () => {
    const { useAppStore } = await getStore();
    useAppStore.getState().play('chords');
    expect(useAppStore.getState().chordsPlayer).toBe('playing');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');

    applyInstantVibeToStore(INSTANT_VIBES[1]);

    // Chords was active, so it comes back; the Beat was not, so it stays put.
    expect(useAppStore.getState().chordsPlayer).toBe('playing');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');
  });

  test('a player that was stopping restarts rather than staying half-stopped', async () => {
    const { useAppStore } = await getStore();
    useAppStore.getState().play('chords');
    useAppStore.getState().softStop('chords');
    expect(useAppStore.getState().chordsPlayer).toBe('stopping');

    applyInstantVibeToStore(INSTANT_VIBES[0]);

    expect(useAppStore.getState().chordsPlayer).toBe('playing');
  });

  test('a swap while nothing plays leaves both players stopped', async () => {
    const { useAppStore } = await getStore();
    useAppStore.getState().hardStopAll();

    applyInstantVibeToStore(INSTANT_VIBES[0]);

    expect(useAppStore.getState().chordsPlayer).toBe('stopped');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/instantVibes.test.ts -t "transport handling"
```

Expected: FAIL — the second test leaves `chordsPlayer` as `'stopping'`; nothing restarts anything.

- [ ] **Step 3: Wrap the apply in a hard stop and a restart**

In `src/store/instantVibes.ts`, replace the opening of `applyInstantVibeToStore`:

```ts
export function applyInstantVibeToStore(vibe: InstantVibe) {
  const store = useAppStore.getState();

  // 0. Atomic swap: cut everything still scheduled BEFORE writing the new
  //    chords and patterns, otherwise the old progression's queued voices
  //    ring on top of the new one. A player that was mid-soft-stop counts as
  //    active and comes back — the user changed vibe, they did not cancel.
  const wasActive = {
    sequencer: store.sequencerPlayer !== 'stopped',
    chords: store.chordsPlayer !== 'stopped',
  };
  store.hardStopAll();
```

and append at the very end of the function, after the effects block:

```ts
  // Restart only what was running. Both playback hooks arm on
  // `step % STEPS_PER_BAR === 0`, so the restart lands on the next bar by
  // construction — no alignment code needed here.
  if (wasActive.sequencer) store.play('sequencer');
  if (wasActive.chords) store.play('chords');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test src/store/instantVibes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify by hand**

```bash
bun run dev
```

Play both players, then click through three different Vibes in a row. Each swap must replace the previous one cleanly — no two progressions audible at once, and the new one enters on a bar line.

- [ ] **Step 6: Commit**

```bash
git add src/store/instantVibes.ts src/store/instantVibes.test.ts
git commit -m "fix(vibes): cut scheduled voices before swapping so vibes never overlap"
```

---

### Task 7: The `PlayerTransport` primitive

Built and tested standalone; wired into the UI by Tasks 8 and 9.

**Files:**
- Create: `src/components/ui/PlayerTransport.tsx`
- Test: `src/components/ui/PlayerTransport.test.tsx`

**Interfaces:**
- Consumes: `PlayerState` (Task 1).
- Produces: `resolveTransportButtons(state: PlayerState): TransportButtons` and the default-exported-as-named `PlayerTransport` component, both from `src/components/ui/PlayerTransport.tsx`. `TransportButtons` is `{ main: { icon: 'play' | 'stop'; label: string; className: string; disabled: boolean }; hard: { disabled: boolean } }`.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/PlayerTransport.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { resolveTransportButtons } from './PlayerTransport';

describe('resolveTransportButtons', () => {
  test('stopped offers play and disables hard stop', () => {
    const b = resolveTransportButtons('stopped');
    expect(b.main.icon).toBe('play');
    expect(b.main.label).toBe('Play');
    expect(b.main.disabled).toBe(false);
    expect(b.hard.disabled).toBe(true);
  });

  test('playing offers soft stop and enables hard stop', () => {
    const b = resolveTransportButtons('playing');
    expect(b.main.icon).toBe('stop');
    expect(b.main.label).toBe('Soft Stop');
    expect(b.main.disabled).toBe(false);
    expect(b.hard.disabled).toBe(false);
  });

  test('stopping is a disabled pulsing indicator, but hard stop stays live', () => {
    const b = resolveTransportButtons('stopping');
    expect(b.main.label).toBe('Stopping');
    expect(b.main.disabled).toBe(true);
    expect(b.main.className).toContain('animate-pulse');
    expect(b.hard.disabled).toBe(false);
  });

  test('every class is a daisyUI role, never a palette colour', () => {
    // themeTokenGuard bans raw palettes; this keeps the guard honest here too.
    for (const state of ['stopped', 'playing', 'stopping'] as const) {
      const { className } = resolveTransportButtons(state).main;
      expect(className).not.toMatch(/(indigo|slate|purple|emerald|pink|cyan|rose)-/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/components/ui/PlayerTransport.test.tsx
```

Expected: FAIL — `Cannot find module './PlayerTransport'`.

- [ ] **Step 3: Write the component**

Create `src/components/ui/PlayerTransport.tsx`:

```tsx
import React from 'react';
import { Play, Square, X } from 'lucide-react';
import type { PlayerState } from '../../store/types';

export interface TransportButtons {
  main: {
    icon: 'play' | 'stop';
    label: string;
    className: string;
    disabled: boolean;
  };
  hard: { disabled: boolean };
}

/**
 * Pure state -> button appearance mapping, exported so the behaviour can be
 * tested without rendering React (the repo has no DOM test setup).
 *
 * `hard.disabled` is decided by the CALLER for aggregate transports — see
 * isHardStopEnabled in transportSlice.ts, which deliberately does not follow
 * the aggregate state. This default covers the single-player case.
 */
export function resolveTransportButtons(state: PlayerState): TransportButtons {
  switch (state) {
    case 'playing':
      return {
        main: { icon: 'stop', label: 'Soft Stop', className: 'btn-warning', disabled: false },
        hard: { disabled: false },
      };
    case 'stopping':
      return {
        main: { icon: 'stop', label: 'Stopping', className: 'btn-warning animate-pulse', disabled: true },
        hard: { disabled: false },
      };
    default:
      return {
        main: { icon: 'play', label: 'Play', className: 'btn-success', disabled: false },
        hard: { disabled: true },
      };
  }
}

export interface PlayerTransportProps {
  state: PlayerState;
  onPlay: () => void;
  onSoftStop: () => void;
  onHardStop?: () => void;
  /** Render the hard-stop button. Header transports omit it by design. */
  showHardStop?: boolean;
  /** Overrides the derived hard-stop disabled state (aggregate transports). */
  hardStopDisabled?: boolean;
  size?: 'xs' | 'sm';
  /** Hide the text label on narrow viewports; the icon always shows. */
  compact?: boolean;
  id?: string;
}

export const PlayerTransport: React.FC<PlayerTransportProps> = ({
  state,
  onPlay,
  onSoftStop,
  onHardStop,
  showHardStop = false,
  hardStopDisabled,
  size = 'sm',
  compact = false,
  id,
}) => {
  const buttons = resolveTransportButtons(state);
  const MainIcon = buttons.main.icon === 'play' ? Play : Square;
  const sizeClass = size === 'xs' ? 'btn-xs' : 'btn-sm';

  return (
    <div className="join">
      <button
        id={id}
        type="button"
        onClick={state === 'playing' ? onSoftStop : onPlay}
        disabled={buttons.main.disabled}
        title={buttons.main.label}
        className={`btn ${sizeClass} join-item gap-1.5 font-bold text-xs ${buttons.main.className}`}
      >
        <MainIcon className="w-3.5 h-3.5 fill-current shrink-0" />
        <span className={compact ? 'hidden lg:inline' : 'hidden sm:inline'}>
          {buttons.main.label}
        </span>
      </button>

      {showHardStop && (
        <button
          id={id ? `${id}-hard` : undefined}
          type="button"
          onClick={onHardStop}
          disabled={hardStopDisabled ?? buttons.hard.disabled}
          title="Hard Stop (cut now)"
          className={`btn ${sizeClass} join-item btn-error gap-1.5 font-bold text-xs`}
        >
          <X className="w-3.5 h-3.5 shrink-0" />
          <span className={compact ? 'hidden lg:inline' : 'hidden sm:inline'}>Hard Stop</span>
        </button>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun test src/components/ui/PlayerTransport.test.tsx && bun run check:theme
```

Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/PlayerTransport.tsx src/components/ui/PlayerTransport.test.tsx
git commit -m "feat(ui): add the PlayerTransport primitive"
```

---

### Task 8: Header — regroup the tabs and add per-player play buttons

**Files:**
- Modify: `src/components/Header.tsx:17-38` (`NAV_TABS` / `MASTER_TABS`), `:89-90` (selectors), `:143-205` (the two `<nav>` groups)
- Test: `src/components/Header.test.tsx` (add a describe block)

**Interfaces:**
- Consumes: `PlayerTransport` (Task 7), `play` / `softStop` / `sequencerPlayer` / `chordsPlayer` (Task 1).
- Produces: `AUTOMATION_TABS` and `SOLO_TABS` exported from `Header.tsx` for the test.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Header.test.tsx`:

```ts
import { AUTOMATION_TABS, SOLO_TABS } from './Header';

describe('header tab grouping', () => {
  test('only the two automation players carry a transport', () => {
    expect(AUTOMATION_TABS.map((t) => t.view)).toEqual(['sequencer', 'chords']);
    expect(AUTOMATION_TABS.every((t) => t.module !== undefined)).toBe(true);
  });

  test('synth and master fx stand alone, with no transport', () => {
    expect(SOLO_TABS.map((t) => t.view)).toEqual(['synth', 'effects']);
  });

  test('every tab view is still reachable', () => {
    const views = [...SOLO_TABS, ...AUTOMATION_TABS].map((t) => t.view).sort();
    expect(views).toEqual(['chords', 'effects', 'sequencer', 'synth']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/components/Header.test.tsx -t "header tab grouping"
```

Expected: FAIL — `AUTOMATION_TABS` is not exported.

- [ ] **Step 3: Replace the tab tables**

In `src/components/Header.tsx`, replace `NAV_TABS` and `MASTER_TABS` with:

```tsx
interface NavTab {
  view: ViewMode;
  label: string;
  icon: LucideIcon;
}

/** The two automation players. Each gets its own play / soft-stop button. */
export const AUTOMATION_TABS: Array<NavTab & { module: PlayerModule }> = [
  { view: 'sequencer', label: 'Step Matrix', icon: Grid, module: 'sequencer' },
  { view: 'chords', label: 'Chords', icon: Music, module: 'chords' },
];

/** Views with nothing to play: the instrument and the master rack. */
export const SOLO_TABS: NavTab[] = [
  { view: 'synth', label: 'Synth', icon: Sliders },
  { view: 'effects', label: 'Master FX', icon: Sliders },
];
```

Import `PlayerModule` from `../store/types` and `PlayerTransport` from `./ui/PlayerTransport`.

- [ ] **Step 4: Rebuild the nav**

Replace the whole `<nav>` block. Layout: `[Synth] | [Beat][play] [Chords][play] | [Master FX]`.

```tsx
      <nav className="flex items-center gap-2">
        {/* Synth stands alone, mirroring Master FX on the right. */}
        <div role="tablist" className="tabs tabs-box tabs-sm bg-base-200 border border-base-300 p-1 gap-1 shrink-0">
          <TabButton tab={SOLO_TABS[0]} activeTab={activeTab} onSelect={setActiveTab} />
        </div>

        {/* The automation players: tab and transport joined side by side.
            A <button> must never nest inside another <button>. */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar shrink-0">
          {AUTOMATION_TABS.map((tab) => {
            const state = tab.module === 'sequencer' ? sequencerPlayer : chordsPlayer;
            return (
              <div key={tab.view} role="tablist" className="join tabs tabs-box tabs-sm bg-base-200 border border-base-300 p-1 gap-0 shrink-0">
                <TabButton tab={tab} activeTab={activeTab} onSelect={setActiveTab} joined />
                <PlayerTransport
                  id={`btn-header-play-${tab.module}`}
                  state={state}
                  size="xs"
                  compact
                  onPlay={() => play(tab.module)}
                  onSoftStop={() => softStop(tab.module)}
                />
              </div>
            );
          })}
        </div>

        <div role="tablist" className="tabs tabs-box tabs-sm bg-base-200 border border-base-300 p-1 gap-1 shrink-0">
          <TabButton tab={SOLO_TABS[1]} activeTab={activeTab} onSelect={setActiveTab} />
        </div>
      </nav>
```

Add this small local component above `Header` (it replaces the repeated inline button markup and the removed ping-dot block — the play button now carries playing state):

```tsx
const TabButton: React.FC<{
  tab: { view: ViewMode; label: string; icon: LucideIcon };
  activeTab: ViewMode;
  onSelect: (view: ViewMode) => void;
  joined?: boolean;
}> = ({ tab, activeTab, onSelect, joined = false }) => (
  <button
    id={`tab-${tab.view}`}
    role="tab"
    type="button"
    onClick={() => onSelect(tab.view)}
    className={`tab gap-1.5 text-xs font-bold whitespace-nowrap ${joined ? 'join-item' : ''} ${
      activeTab === tab.view ? 'tab-active bg-primary text-primary-content' : ''
    }`}
  >
    <tab.icon className="w-4 h-4 shrink-0" />
    <span className="hidden md:inline">{tab.label}</span>
  </button>
);
```

Add the two actions to the `Header` selectors:

```ts
  const play = useAppStore((s) => s.play);
  const softStop = useAppStore((s) => s.softStop);
```

The `divider` union member and the `playingKey` field are gone; delete the now-unused divider branch and the ping-dot `<span>`.

- [ ] **Step 5: Run the tests and the theme guard**

```bash
bun test src/components/Header.test.tsx && bun run check:theme && bun run lint
```

Expected: PASS.

- [ ] **Step 6: Verify by hand**

```bash
bun run dev
```

1. The header reads `[Synth] | [Step Matrix][play] [Chords][play] | [Master FX]`.
2. From the Synth tab, press the Chords play button — chords start without switching tabs.
3. Press it again — it shows Stopping (pulsing, unclickable), then returns to Play at the bar line.
4. Narrow the window: labels collapse to icons and nothing overflows the header.

- [ ] **Step 7: Commit**

```bash
git add src/components/Header.tsx src/components/Header.test.tsx
git commit -m "feat(header): group the automation players and give each a transport"
```

---

### Task 9: TransportBar — aggregate transport with an always-live hard stop

**Files:**
- Modify: `src/components/TransportBar.tsx:13-51` (selectors and handlers), `:89-124` (the two play buttons)
- Test: `src/components/TransportBar.test.tsx` (add a describe block)

**Interfaces:**
- Consumes: `PlayerTransport` (Task 7), `aggregatePlayerState` / `isHardStopEnabled` (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `src/components/TransportBar.test.tsx`:

```ts
import { aggregatePlayerState, isHardStopEnabled } from '../store/transportSlice';
import { resolveTransportButtons } from './ui/PlayerTransport';

describe('transport bar aggregate behaviour', () => {
  test('one player stopping while the other is stopped still allows a hard stop', () => {
    const seq = 'stopping' as const;
    const chords = 'stopped' as const;
    const aggregate = aggregatePlayerState(seq, chords);

    expect(aggregate).toBe('stopping');
    // The main button is parked, but the cut must stay available.
    expect(resolveTransportButtons(aggregate).main.disabled).toBe(true);
    expect(isHardStopEnabled(seq, chords)).toBe(true);
  });

  test('a single playing player drives the whole bar into playing', () => {
    expect(aggregatePlayerState('stopped', 'playing')).toBe('playing');
    expect(isHardStopEnabled('stopped', 'playing')).toBe(true);
  });

  test('fully stopped disables the hard stop', () => {
    expect(aggregatePlayerState('stopped', 'stopped')).toBe('stopped');
    expect(isHardStopEnabled('stopped', 'stopped')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails or passes trivially**

```bash
bun test src/components/TransportBar.test.tsx
```

Expected: PASS if Tasks 1 and 7 are done — this test pins the contract the component must use. Proceed to Step 3 and make the component actually use it.

- [ ] **Step 3: Replace the selectors and handlers**

At `src/components/TransportBar.tsx:13-51`:

```ts
  const sequencerPlayer = useAppStore((s) => s.sequencerPlayer);
  const chordsPlayer = useAppStore((s) => s.chordsPlayer);
  const playAll = useAppStore((s) => s.playAll);
  const softStopAll = useAppStore((s) => s.softStopAll);
  const hardStopAll = useAppStore((s) => s.hardStopAll);
```

```ts
  const aggregate = aggregatePlayerState(sequencerPlayer, chordsPlayer);
  const hardStopDisabled = !isHardStopEnabled(sequencerPlayer, chordsPlayer);
  // The meter loop only needs to know whether anything is sounding.
  const isPlaying = aggregate !== 'stopped';
```

Delete `isPlayingAll`, `isPlayDisabled`, `onTogglePlay`, `onTogglePlayAll` and `currentTabLabel`, plus the now-unused `activeTab` selector if nothing else in the file reads it. Update the meter-polling effect at `:53-73` to depend on `[isPlaying]` alone.

Import `aggregatePlayerState` and `isHardStopEnabled` from `../store/transportSlice`, and `PlayerTransport` from `./ui/PlayerTransport`. Drop the now-unused `Play` and `Square` imports from `lucide-react` if nothing else in the file uses them.

- [ ] **Step 4: Replace both buttons with one transport**

Replace the "Play All Button" and "Tab Specific Play Button" blocks at `:90-124` with:

```tsx
        {/* Master transport: drives both automation players together. The
            hard stop stays live whenever anything is still scheduled, even
            when the aggregate reads `stopping`. */}
        <PlayerTransport
          id="btn-bottom-transport"
          state={aggregate}
          size="sm"
          showHardStop
          hardStopDisabled={hardStopDisabled}
          onPlay={playAll}
          onSoftStop={softStopAll}
          onHardStop={hardStopAll}
        />
```

- [ ] **Step 5: Run the gate**

```bash
bun run verify && bun run eslint
```

Expected: PASS.

- [ ] **Step 6: Verify by hand — the full spec matrix**

```bash
bun run dev
```

1. Fresh load: `[Play]` enabled, `[Hard Stop]` disabled.
2. Play → `[Soft Stop]` and `[Hard Stop]` both enabled; both players start on the same bar.
3. Soft Stop → `[Stopping]` pulsing and unclickable, `[Hard Stop]` still enabled; both stop at the bar line.
4. Play, then Hard Stop mid-bar → everything cuts at once, chord tail included.
5. From the header, soft-stop the Beat only while Chords is stopped → the bar's main button parks at `Stopping`, and `[Hard Stop]` is still clickable and cuts the Beat.
6. Play both, switch Instant Vibe → clean swap, no overlap, new progression enters on a bar line.

- [ ] **Step 7: Commit**

```bash
git add src/components/TransportBar.tsx src/components/TransportBar.test.tsx
git commit -m "feat(transport): replace the two play buttons with the aggregate transport"
```

---

## Done criteria

- `bun run verify` and `bun run eslint` both pass.
- Every row of the hand-verification matrix in Task 9 Step 6 behaves as described.
- `scripts/themeTokenGuard.ts`'s `ALLOWLIST` is still empty.
- `partializeAppState` still does not mention `sequencerPlayer` or `chordsPlayer`, and the store version is still 3.

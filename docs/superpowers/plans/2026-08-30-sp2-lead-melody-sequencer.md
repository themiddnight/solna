# SP2 — Lead Melody Step Sequencer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an absolute-note, multi-note-per-step piano-roll step sequencer for the lead (a new note source for the synth alongside the keyboard) whose loop length divides the chord-progression length, and make the lead a first-class transport player.

**Architecture:** The melody state (`leadMelodySteps`, `leadLoopLength`) lives in a new `leadSlice.ts` stored at a fixed `MAX_STEPS_PER_BAR` (24) width per bar — the same non-destructive meter-switch scheme as SP1's drum/chord/bass grids — and is *windowed* to the active `stepsPerBar` at playback/UI time. A pure audio-layer module `audio/leadMelody.ts` resolves a step's note set into note-on/off triggers: arp-off fires every note together (block, `LEAD_GATE` hold) and arp-on feeds the notes through the unchanged `buildArpSequence` + `computeArpTriggers`. A `useLeadPlayback` hook (mirroring `useChordPlayback`) drives those triggers into the synth voice (`source 'synth'`, `synthParams`) on the shared clock; a memoized `LeadPianoRoll` grid in `SynthView` edits the melody with a separate `translateX` playhead overlay so cells never re-render per clock tick.

**Tech Stack:** Bun, Vite, React 18, TypeScript, Zustand, raw Web Audio

**Spec:** docs/superpowers/specs/2026-08-30-sp2-lead-melody-sequencer-design.md

## Global Constraints

- **Layering (eslint `no-restricted-imports`):** `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/components/` never imports `audio/engine` except the read-only analyser consumers `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx` and test files. The lead hook reaches the engine only through `audio/playback/playbackEngine.ts`.
- **Store→engine bridge:** never call engine setters from a component — add state to a slice and wire it in `src/store/engineSync.ts`. `useLeadPlayback.ts` reaches the engine only through `audio/playback/playbackEngine.ts`.
- **Theming:** two daisyUI themes (`solna-dark`, `solna-light`) declared CSS-first in `src/index.css`; no `tailwind.config.*` may be added. Components name **roles**, never colours. `scripts/themeTokenGuard.ts` fails on raw hex, Tailwind palette classes, `text-white`/`bg-black`/etc., the `dark:` variant, `rgb()`/`rgba()` literals, and silently-dead utilities. `ALLOWLIST` is empty; fix code, not the allowlist. The lead voice is the existing `'synth'` identity, so lit cells wear `bg-primary text-primary-content` and the out-of-scale lane wears `bg-warning` (both daisyUI role tokens).
- **Testing:** tests are `bun:test`, pure-logic-first — components export their testable helpers, and component rendering uses `renderToString` from `react-dom/server` (no DOM/testing-library). `renderToString` observes the store's *initial* snapshot (see `TransportBar.test.tsx`), so component tests assert structure + defaults, and the real logic is pinned by pure-helper tests.
- **`bun run verify` is the completion gate:** `test + lint + check:keys + check:drums + build`. It does **not** run `bun run eslint` — run `bun run eslint` separately when imports change (every task here touches imports).
- **Storage access is guarded:** `localStorage` can throw; `store.ts` already falls back to an in-memory `StateStorage` and sanitizes persisted payloads in `sanitizePersistedState`.
- **Meter adaptation:** `leadMelodySteps` is stored at `MAX_STEPS_PER_BAR` (24) per bar (`leadLoopLength × 24` long), so `setMeter` does not touch it and a meter switch re-windows without dropping steps. `setLeadLoopLength` resizes by whole bars (trim/pad), preserving already-programmed bars.
- **The lead drives the synth voice:** notes target source `'synth'` and read `synthParams` (so `synthParams.octave` keeps its transpose meaning and `arpActive` gates *arpeggiation*, not whether the melody runs). `leadPlayer` and `leadMelodyView`/`leadMelodyOctave` are transient (excluded from `partializeAppState`).

**Design decisions resolved from the spec (executor notes):**
- **Field name:** the spec's persistence note says "`synthPlayer`" but its data-model and transport sections name the player field `leadPlayer` everywhere else. **Use `leadPlayer`** — the persistence mention is a typo for the (transient) player state, which is excluded regardless.
- **Note-source composition:** the lead and the keyboard both drive the single `'synth'` source/bus (`synthParams`) — they are *merged into one signal*. The lead's soft/hard stop therefore calls `playbackStopSource('synth', …)` exactly as the chord/bass players stop their own sources; a held keyboard note on that voice is released by the transport stop, consistent with "the synth voice stops with the transport".
- **Octave window:** fixed at **2 octaves** (`LEAD_WINDOW_OCTAVES = 2`), the spec's "exact height is a plan detail, default 2". `leadMelodyOctave` defaults to `3` (window shows octaves 3–4), the lowest octave, view-only.
- **Aggregate helpers:** `aggregatePlayerState` / `isHardStopEnabled` become **variadic** (`...states`), so the existing two-arg call sites (and their tests) keep working while `TransportBar`/`AmbientBackdrop` pass three. Priority: `playing` beats `stopping` beats `stopped`.
- **`leadStepAction`:** the lead's clock decision is identical to the sequencer's (arm on bar line, soft-stop on bar line, else play) and is re-declared locally in `useLeadPlayback.ts` rather than importing `sequencerStepAction` (lead is not the drum sequencer).

---

## File Structure

**New files:**
- `src/audio/leadMelody.ts` — pure melody→trigger resolution, `LEAD_GATE`, `stepInLoopFor`/`leadStepNotes` windowing, `loopLengthDivisors`/`clampLeadLoopLength`, `resizeLeadMelody`.
- `src/audio/leadMelody.test.ts` — pure tests for all of the above.
- `src/store/leadSlice.ts` — `LeadSlice` fields + setters (fixed-width storage, resize-on-loopLength, `toggleLeadNote`).
- `src/store/leadSlice.test.ts` — store defaults, toggle, resize, non-destructive meter, persistence round-trip.
- `src/components/lead/pianoRoll.ts` — pure pitch-row / out-of-scale / stored-index view model.
- `src/components/lead/pianoRoll.test.ts` — pure tests for the view model.
- `src/components/lead/useLeadPlayback.ts` — playback hook + exported `leadStepAction`.
- `src/components/lead/useLeadPlayback.test.ts` — pure tests for `leadStepAction`.
- `src/components/lead/LeadPianoRoll.tsx` — memoized grid + playhead overlay + controls.
- `src/components/lead/LeadPianoRoll.test.tsx` — `renderToString` smoke tests.

**Modified files:**
- `src/store/types.ts` — `LeadMelodyView`, `LeadSlice`, `AppStore`, `PersistedState` (+ `PlayerModule 'lead'`, `leadPlayer` in Task 3).
- `src/store/store.ts` — compose `createLeadSlice`, `partializeAppState`, `sanitizePersistedState`.
- `src/store/transportSlice.ts` — `'lead'` player, `leadPlayer`, variadic aggregates.
- `src/store/transportSlice.test.ts` — three-way tests.
- `src/store/engineSync.ts` — three-way transport subscription.
- `src/components/TransportBar.tsx` — three-way aggregate/hard-stop.
- `src/components/ui/AmbientBackdrop.tsx` — three-way aggregate.
- `src/components/SynthView.tsx` — mount `useLeadPlayback` + `<LeadPianoRoll />`.
- `src/components/SynthView.test.tsx` — one smoke test.

---

### Task 1: Pure audio-layer melody helpers

**Files:**
- Create: `src/audio/leadMelody.ts`
- Test: `src/audio/leadMelody.test.ts`

**Interfaces:**
- Consumes: `buildArpSequence` from `./arpeggiator`; `computeArpTriggers` from `./arpSchedule`; `MAX_STEPS_PER_BAR` from `../utils/meter`; `type ArpMode`, `type ArpRate` from `../types`.
- Produces:
  - `export const LEAD_GATE = 0.85;`
  - `export interface LeadTrigger { note: string; timeOffsetSec: number; holdSec: number }`
  - `export function leadStepNotes(steps: readonly string[][], stepInLoop: number, stepsPerBar: number): string[]`
  - `export function stepInLoopFor(step: number, melodyLength: number): number`
  - `export function loopLengthDivisors(totalBars: number): number[]`
  - `export function clampLeadLoopLength(current: number, totalBars: number): number`
  - `export function resizeLeadMelody(steps: readonly string[][], newLoopLength: number): string[][]`
  - `export function resolveLeadStepTriggers(notes: readonly string[], arpActive: boolean, arpStep: number, params: { arpMode: ArpMode; arpRate: ArpRate; arpOctaves: number }, stepDurSec: number): LeadTrigger[]`

- [ ] **Step 1: Write the failing test**

Create `src/audio/leadMelody.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  LEAD_GATE,
  clampLeadLoopLength,
  leadStepNotes,
  loopLengthDivisors,
  resizeLeadMelody,
  resolveLeadStepTriggers,
  stepInLoopFor,
} from './leadMelody';

describe('loopLengthDivisors', () => {
  test('lists every positive divisor ascending', () => {
    expect(loopLengthDivisors(4)).toEqual([1, 2, 4]);
    expect(loopLengthDivisors(6)).toEqual([1, 2, 3, 6]);
    expect(loopLengthDivisors(1)).toEqual([1]);
  });
});

describe('clampLeadLoopLength', () => {
  test('returns the current value when it already divides', () => {
    expect(clampLeadLoopLength(2, 4)).toBe(2);
    expect(clampLeadLoopLength(4, 4)).toBe(4);
  });
  test('clamps DOWN to the largest divisor <= current', () => {
    expect(clampLeadLoopLength(3, 4)).toBe(2);
    expect(clampLeadLoopLength(5, 6)).toBe(3);
    expect(clampLeadLoopLength(3, 2)).toBe(2);
  });
  test('a zero/invalid total falls back to 1', () => {
    expect(clampLeadLoopLength(4, 0)).toBe(1);
  });
});

describe('resizeLeadMelody', () => {
  const twoBars = Array.from({ length: 48 }, (_, i) => (i < 24 ? ['C4'] : ['E4']));
  test('pads empty bars when growing', () => {
    const out = resizeLeadMelody([['C4']], 2);
    expect(out).toHaveLength(48);
    expect(out[0]).toEqual(['C4']);
    expect(out[24]).toEqual([]);
    expect(out[47]).toEqual([]);
  });
  test('trims trailing bars when shrinking', () => {
    const out = resizeLeadMelody(twoBars, 1);
    expect(out).toHaveLength(24);
    expect(out[0]).toEqual(['C4']);
    expect(out[24]).toBeUndefined();
  });
});

describe('stepInLoopFor', () => {
  test('wraps the absolute step into the melody loop', () => {
    expect(stepInLoopFor(0, 32)).toBe(0);
    expect(stepInLoopFor(16, 32)).toBe(16);
    expect(stepInLoopFor(32, 32)).toBe(0);
    expect(stepInLoopFor(33, 32)).toBe(1);
  });
  test('a short 1-bar loop repeats as an ostinato', () => {
    expect(stepInLoopFor(48, 16)).toBe(0);
    expect(stepInLoopFor(50, 16)).toBe(2);
  });
});

describe('leadStepNotes — non-destructive per-bar windowing', () => {
  const melody: string[][] = [
    ['C4'], ...new Array<string[]>(23).fill([]), // bar 0, step 0 = C4
    ...new Array<string[]>(24).fill([]), // bar 1 empty
  ];
  test('windowed at 24 steps (12/8) the full bar is reachable', () => {
    expect(leadStepNotes(melody, 0, 24)).toEqual(['C4']);
  });
  test('windowed at 16 steps (4/4) step 0 still resolves', () => {
    expect(leadStepNotes(melody, 0, 16)).toEqual(['C4']);
    expect(leadStepNotes(melody, 15, 16)).toEqual([]);
  });
  test('step 16 in 4/4 maps into bar 1, not bar 0 step 16', () => {
    expect(leadStepNotes(melody, 16, 16)).toEqual([]);
  });
  test('a step past the stored melody resolves to a rest (empty array)', () => {
    expect(leadStepNotes(melody, 1000, 16)).toEqual([]);
  });
});

describe('resolveLeadStepTriggers', () => {
  const params = { arpMode: 'up' as const, arpRate: '16n' as const, arpOctaves: 1 };
  test('arp OFF fires every note together (block) at the step start', () => {
    const triggers = resolveLeadStepTriggers(['C4', 'E4', 'G4'], false, 0, params, 0.125);
    expect(triggers).toEqual([
      { note: 'C4', timeOffsetSec: 0, holdSec: LEAD_GATE * 0.125 },
      { note: 'E4', timeOffsetSec: 0, holdSec: LEAD_GATE * 0.125 },
      { note: 'G4', timeOffsetSec: 0, holdSec: LEAD_GATE * 0.125 },
    ]);
  });
  test('an empty note set yields no triggers', () => {
    expect(resolveLeadStepTriggers([], false, 0, params, 0.125)).toEqual([]);
  });
  test('arp ON reuses buildArpSequence + computeArpTriggers (16n fires one note)', () => {
    const triggers = resolveLeadStepTriggers(['C4', 'E4', 'G4'], true, 0, params, 0.125);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].note).toBe('C4'); // ascending arp, first note
    expect(triggers[0].timeOffsetSec).toBe(0);
  });
  test('arp ON expands octaves through the arpeggiator (unchanged)', () => {
    const triggers = resolveLeadStepTriggers(['C4'], true, 0, { ...params, arpOctaves: 2 }, 0.125);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].note).toBe('C4'); // step 0 → first of [C4, C5]
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/leadMelody.test.ts`
Expected: FAIL — `./leadMelody` does not resolve (module has no such export).

- [ ] **Step 3: Implement the module**

Create `src/audio/leadMelody.ts`:

```ts
import type { ArpMode, ArpRate } from '../types';
import { buildArpSequence } from './arpeggiator';
import { computeArpTriggers } from './arpSchedule';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

/**
 * Fixed note-gate fraction for block-mode lead notes (arp off). One step at
 * 120 BPM is 0.125 s, so a 0.85 gate holds 0.106 s — the same ratio the
 * arpeggiator's holdFactor uses. Per-note gate (DEV-369) replaces this.
 */
export const LEAD_GATE = 0.85;

export interface LeadTrigger {
  note: string;
  timeOffsetSec: number;
  holdSec: number;
}

/**
 * The melody is stored at a fixed MAX_STEPS_PER_BAR width per bar and windowed
 * to the ACTIVE stepsPerBar at playback/UI time (the same non-destructive
 * scheme as SP1's drum rows). `stepInLoop` is already reduced to the melody
 * loop (`step % melodyLength`); this maps it through the per-bar window.
 */
export function leadStepNotes(
  steps: readonly string[][],
  stepInLoop: number,
  stepsPerBar: number,
): string[] {
  const barIndex = Math.floor(stepInLoop / stepsPerBar);
  const stepInBar = stepInLoop - barIndex * stepsPerBar;
  const idx = barIndex * MAX_STEPS_PER_BAR + stepInBar;
  return steps[idx] ?? [];
}

/** The melody-loop position for an absolute clock step. */
export function stepInLoopFor(step: number, melodyLength: number): number {
  return step % melodyLength;
}

/** Positive divisors of totalBars, ascending (e.g. 4 → [1, 2, 4]). */
export function loopLengthDivisors(totalBars: number): number[] {
  const divisors: number[] = [];
  for (let n = 1; n <= totalBars; n++) {
    if (totalBars % n === 0) divisors.push(n);
  }
  return divisors;
}

/**
 * Clamp down to the largest divisor of totalBars that is <= current. Falls
 * back to 1 for a zero/invalid totalBars. Always returns a divisor, so a
 * stored loopLength never runs past the progression.
 */
export function clampLeadLoopLength(current: number, totalBars: number): number {
  const divisors = loopLengthDivisors(totalBars);
  let best = 1;
  for (const d of divisors) {
    if (d <= current) best = d;
  }
  return best;
}

/**
 * Resize the melody by whole bars: trim trailing bars, pad empty bars. Each
 * "bar" is MAX_STEPS_PER_BAR slots, so a loopLength change never drops steps
 * drawn in the bars that survive.
 */
export function resizeLeadMelody(
  steps: readonly string[][],
  newLoopLength: number,
): string[][] {
  const targetLen = newLoopLength * MAX_STEPS_PER_BAR;
  const out = steps.slice(0, targetLen);
  while (out.length < targetLen) out.push([]);
  return out;
}

/**
 * Resolve a step's note set into note-on/off triggers.
 *
 * arp OFF → every note fires together (block) at the step start, held
 * LEAD_GATE × stepDurSec.
 * arp ON  → the notes feed buildArpSequence + computeArpTriggers exactly as
 * the keyboard arp does (reused unchanged); `arpStep` must already be
 * bar-phased by arpStepFor(step, stepsPerBar).
 */
export function resolveLeadStepTriggers(
  notes: readonly string[],
  arpActive: boolean,
  arpStep: number,
  params: { arpMode: ArpMode; arpRate: ArpRate; arpOctaves: number },
  stepDurSec: number,
): LeadTrigger[] {
  if (notes.length === 0) return [];
  if (!arpActive) {
    return notes.map((note) => ({
      note,
      timeOffsetSec: 0,
      holdSec: LEAD_GATE * stepDurSec,
    }));
  }
  const sequence = buildArpSequence(notes, params.arpMode, params.arpOctaves);
  if (sequence.length === 0) return [];
  return computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDurSec).map(
    (t) => ({
      note: sequence[t.noteIndex],
      timeOffsetSec: t.timeOffsetSec,
      holdSec: t.holdSec,
    }),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/leadMelody.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/leadMelody.ts src/audio/leadMelody.test.ts
git commit -m "feat(audio): add lead melody trigger-resolution and loop-length helpers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: `leadSlice.ts` + types + persist wiring

**Files:**
- Create: `src/store/leadSlice.ts`
- Modify: `src/store/types.ts` (`LeadMelodyView`, `LeadSlice`, `AppStore`, `PersistedState`)
- Modify: `src/store/store.ts` (composition, `partializeAppState`, `sanitizePersistedState`)
- Test: `src/store/leadSlice.test.ts` (new)

**Interfaces:**
- Consumes: `resizeLeadMelody` from `../audio/leadMelody` (Task 1); `MAX_STEPS_PER_BAR` from `../utils/meter`.
- Produces:
  - `export type LeadMelodyView = 'scale-locked' | 'chromatic'` (in `types.ts`)
  - `interface LeadSlice` with `leadMelodySteps: string[][]`, `leadLoopLength: number`, `leadMelodyView: LeadMelodyView`, `leadMelodyOctave: number`, `setLeadMelodySteps: (steps: string[][]) => void`, `setLeadLoopLength: (bars: number) => void`, `setLeadMelodyView: (view: LeadMelodyView) => void`, `setLeadMelodyOctave: (octave: number) => void`, `toggleLeadNote: (stepIndex: number, note: string) => void`
  - On `PersistedState`: `leadMelodySteps: string[][]`, `leadLoopLength: number`.

- [ ] **Step 1: Write the failing test**

Create `src/store/leadSlice.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { useAppStore, partializeAppState } from './store';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

function resetLead(): void {
  useAppStore.setState({
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]),
    leadLoopLength: 1,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,
  });
}

describe('lead slice — defaults', () => {
  beforeEach(resetLead);
  test('starts with a silent 1-bar melody, scale-locked view, octave 3', () => {
    const s = useAppStore.getState();
    expect(s.leadLoopLength).toBe(1);
    expect(s.leadMelodyView).toBe('scale-locked');
    expect(s.leadMelodyOctave).toBe(3);
    expect(s.leadMelodySteps).toHaveLength(MAX_STEPS_PER_BAR);
    expect(s.leadMelodySteps.every((row) => row.length === 0)).toBe(true);
  });
});

describe('lead slice — toggleLeadNote', () => {
  beforeEach(resetLead);
  test('adds a note to an empty step and removes it on a second toggle', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual(['C4']);
    s.toggleLeadNote(0, 'E4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual(['C4', 'E4']);
    useAppStore.getState().toggleLeadNote(0, 'C4');
    expect(useAppStore.getState().leadMelodySteps[0]).toEqual(['E4']);
  });
});

describe('lead slice — setLeadLoopLength resizes by whole bars', () => {
  beforeEach(resetLead);
  test('growing pads empty bars; shrinking trims trailing bars', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.setLeadLoopLength(2); // grow → 48 slots, bar 0 keeps C4, bar 1 padded empty
    const grown = useAppStore.getState();
    expect(grown.leadLoopLength).toBe(2);
    expect(grown.leadMelodySteps).toHaveLength(48);
    expect(grown.leadMelodySteps[0]).toEqual(['C4']);
    expect(grown.leadMelodySteps[24]).toEqual([]);

    grown.toggleLeadNote(24, 'E4'); // bar 1 step 0
    useAppStore.getState().setLeadLoopLength(1); // shrink → 24 slots, bar 1 dropped
    const shrunk = useAppStore.getState();
    expect(shrunk.leadLoopLength).toBe(1);
    expect(shrunk.leadMelodySteps).toHaveLength(24);
    expect(shrunk.leadMelodySteps[0]).toEqual(['C4']);
  });

  test('a meter change never touches the stored melody (non-destructive)', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(18, 'G4'); // step 18 visible in 12/8 (24), hidden in 4/4
    s.setMeter('4/4');
    expect(useAppStore.getState().leadMelodySteps[18]).toEqual(['G4']);
    expect(useAppStore.getState().leadMelodySteps).toHaveLength(MAX_STEPS_PER_BAR);
    s.setMeter('12/8');
    expect(useAppStore.getState().leadMelodySteps[18]).toEqual(['G4']);
  });
});

describe('lead slice — persistence', () => {
  beforeEach(resetLead);
  test('leadMelodySteps and leadLoopLength are persisted', () => {
    const s = useAppStore.getState();
    s.toggleLeadNote(0, 'C4');
    s.setLeadLoopLength(2);
    const persisted = partializeAppState(useAppStore.getState());
    expect(persisted.leadMelodySteps).toEqual(useAppStore.getState().leadMelodySteps);
    expect(persisted.leadLoopLength).toBe(2);
  });

  test('leadMelodyView, leadMelodyOctave and leadPlayer are transient', () => {
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('leadMelodyView' in persisted).toBe(false);
    expect('leadMelodyOctave' in persisted).toBe(false);
    expect('leadPlayer' in persisted).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/leadSlice.test.ts`
Expected: FAIL — `leadMelodySteps`, `setLeadLoopLength`, `toggleLeadNote` do not exist on the store; `leadPlayer` in the transient test is also not yet declared.

- [ ] **Step 3: Implement the store changes**

**3a. `src/store/types.ts`** — add the type + slice. After the `BassSlice` interface add:

```ts
export type LeadMelodyView = 'scale-locked' | 'chromatic';

export interface LeadSlice {
  /** Absolute note names per step, stored at a fixed MAX_STEPS_PER_BAR per bar. */
  leadMelodySteps: string[][];
  /** Loop length in bars; must divide Σ ChordItem.bars. */
  leadLoopLength: number;
  /** Transient view mode; not persisted. */
  leadMelodyView: LeadMelodyView;
  /** Transient lowest octave of the visible window; not persisted. */
  leadMelodyOctave: number;
  setLeadMelodySteps: (steps: string[][]) => void;
  setLeadLoopLength: (bars: number) => void;
  setLeadMelodyView: (view: LeadMelodyView) => void;
  setLeadMelodyOctave: (octave: number) => void;
  toggleLeadNote: (stepIndex: number, note: string) => void;
}
```

Add `LeadSlice` to `AppStore`'s extends list (after `BassSlice,`):

```ts
export interface AppStore
  extends TransportSlice,
    MusicContextSlice,
    SynthSlice,
    ChordsSlice,
    BassSlice,
    LeadSlice,
    SequencerSlice,
    EffectsSlice,
    UiSlice,
    PresetsSlice {}
```

Add to `PersistedState` (after `bassVolume: number;`):

```ts
  leadMelodySteps: string[][];
  leadLoopLength: number;
```

**3b. `src/store/leadSlice.ts`** — create:

```ts
import type { StoreApi } from 'zustand';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { resizeLeadMelody } from '../audio/leadMelody';
import type { AppStore, LeadSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Lead melody slice. `leadMelodySteps` is stored at a fixed MAX_STEPS_PER_BAR
 * width per bar (length leadLoopLength × 24) — the same non-destructive scheme
 * as the chord/bass custom grids — and windowed to stepsPerBar at playback/UI
 * time. A loopLength change resizes by whole bars (trim/pad) via the pure
 * helper, so a meter switch never drops steps.
 */
export function createLeadSlice(set: Set): LeadSlice {
  return {
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]),
    leadLoopLength: 1,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,

    setLeadMelodySteps: (leadMelodySteps) => set({ leadMelodySteps }),
    setLeadLoopLength: (leadLoopLength) =>
      set((state) => ({
        leadLoopLength,
        leadMelodySteps: resizeLeadMelody(state.leadMelodySteps, leadLoopLength),
      })),
    setLeadMelodyView: (leadMelodyView) => set({ leadMelodyView }),
    setLeadMelodyOctave: (leadMelodyOctave) => set({ leadMelodyOctave }),
    toggleLeadNote: (stepIndex, note) =>
      set((state) => {
        const row = state.leadMelodySteps[stepIndex] ?? [];
        const has = row.includes(note);
        const nextRow = has ? row.filter((n) => n !== note) : [...row, note];
        return {
          leadMelodySteps: state.leadMelodySteps.map((r, i) =>
            i === stepIndex ? nextRow : r,
          ),
        };
      }),
  };
}
```

**3c. `src/store/store.ts`** — add the import (next to the other slice imports):

```ts
import { createLeadSlice } from './leadSlice';
```

Add `...createLeadSlice(set),` to the store composition (after `...createBassSlice(set),`).

In `partializeAppState`, after `bassVolume: state.bassVolume,` add:

```ts
    leadMelodySteps: state.leadMelodySteps,
    leadLoopLength: state.leadLoopLength,
```

In `sanitizePersistedState`, after the `chordRhythmMode`/`bassPatternMode` union loop add:

```ts
  if (
    !Array.isArray(sanitized.leadMelodySteps) ||
    !(sanitized.leadMelodySteps as unknown[]).every(
      (row) => Array.isArray(row) && (row as unknown[]).every((n) => typeof n === 'string'),
    )
  ) {
    delete sanitized.leadMelodySteps;
  }
  if (
    typeof sanitized.leadLoopLength !== 'number' ||
    !Number.isInteger(sanitized.leadLoopLength) ||
    sanitized.leadLoopLength < 1
  ) {
    delete sanitized.leadLoopLength;
  }
```

No persist `version` bump: the fields are additive and absent from older payloads, so the `merge` spread falls back to the freshly-built `currentState` defaults (the same mechanism the existing sanitizer relies on for absent keys).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/leadSlice.test.ts`
Expected: PASS (7 tests). Also run `bun test src/store/store.test.ts` to confirm the partialize/sanitize changes did not regress existing store behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/leadSlice.ts src/store/store.ts src/store/leadSlice.test.ts
git commit -m "feat(store): add lead melody slice with fixed-width storage and persist wiring

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Lead as a third transport player

**Files:**
- Modify: `src/store/types.ts` (`PlayerModule 'lead'`, `leadPlayer` on `TransportSlice`)
- Modify: `src/store/transportSlice.ts` (`FIELD`, `leadPlayer`, variadic `aggregatePlayerState`/`isHardStopEnabled`)
- Modify: `src/store/transportSlice.test.ts` (three-way tests)
- Modify: `src/store/engineSync.ts` (three-way transport subscription)
- Modify: `src/components/TransportBar.tsx` (pass `leadPlayer`)
- Modify: `src/components/ui/AmbientBackdrop.tsx` (pass `leadPlayer`)

**Interfaces:**
- Consumes: `PlayerState`/`PlayerModule` from `./types` (Task 2 added `LeadSlice`; this task extends `PlayerModule` and `TransportSlice`).
- Produces:
  - `type PlayerModule = 'sequencer' | 'chords' | 'lead'`
  - `leadPlayer: PlayerState` on `TransportSlice`
  - `aggregatePlayerState(...states: PlayerState[]): PlayerState` (playing wins, then stopping, else stopped)
  - `isHardStopEnabled(...states: PlayerState[]): boolean` (`states.some(isPlayerActive)`)

- [ ] **Step 1: Write the failing test**

Append to `src/store/transportSlice.test.ts`. Update the existing "both players start stopped" test to also assert `leadPlayer`, and add a new describe. The existing pair-exhaustive tests keep passing because the functions become variadic; add the three-way cases:

```ts
  test('both players start stopped', () => {
    const s = makeSlice().state;
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
  });
```

Append a new describe at the end of the file:

```ts
describe('three-way derived transport helpers', () => {
  test('aggregate covers all 27 triples: playing wins, then stopping', () => {
    const expected = (a: PlayerState, b: PlayerState, c: PlayerState): PlayerState => {
      if (a === 'playing' || b === 'playing' || c === 'playing') return 'playing';
      if (a === 'stopping' || b === 'stopping' || c === 'stopping') return 'stopping';
      return 'stopped';
    };
    for (const a of ALL) {
      for (const b of ALL) {
        for (const c of ALL) {
          expect(aggregatePlayerState(a, b, c)).toBe(expected(a, b, c));
        }
      }
    }
  });

  test('hard stop is enabled whenever any of three players is active', () => {
    expect(isHardStopEnabled('stopped', 'stopped', 'stopped')).toBe(false);
    expect(isHardStopEnabled('stopped', 'stopped', 'playing')).toBe(true);
    expect(isHardStopEnabled('stopped', 'stopping', 'stopped')).toBe(true);
    expect(isHardStopEnabled('stopped', 'stopped', 'stopping')).toBe(true);
  });

  test('master actions drive the lead too', () => {
    const h = makeSlice({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped' });
    h.state.playAll();
    expect(h.state.leadPlayer).toBe('playing');
    h.state.hardStopAll();
    expect(h.state.leadPlayer).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/transportSlice.test.ts`
Expected: FAIL — `s.leadPlayer` is `undefined`, and `playAll`/`hardStopAll` do not address a `'lead'` player.

- [ ] **Step 3: Implement**

**3a. `src/store/types.ts`** — change:

```ts
export type PlayerModule = 'sequencer' | 'chords';
```

to:

```ts
export type PlayerModule = 'sequencer' | 'chords' | 'lead';
```

Add to `TransportSlice` (after `chordsPlayer: PlayerState;`):

```ts
  leadPlayer: PlayerState;
```

**3b. `src/store/transportSlice.ts`** — change the field map and add the state, and make the helpers variadic:

```ts
type PlayerField = 'sequencerPlayer' | 'chordsPlayer' | 'leadPlayer';

const FIELD: Record<PlayerModule, PlayerField> = {
  sequencer: 'sequencerPlayer',
  chords: 'chordsPlayer',
  lead: 'leadPlayer',
};
```

Replace `aggregatePlayerState` and `isHardStopEnabled`:

```ts
/** The single state the master transport shows across all players. */
export function aggregatePlayerState(...states: PlayerState[]): PlayerState {
  if (states.includes('playing')) return 'playing';
  if (states.includes('stopping')) return 'stopping';
  return 'stopped';
}

/**
 * Deliberately NOT derived from aggregatePlayerState: when one player is
 * `stopping` and the others are already `stopped`, the aggregate reads
 * `stopping` but there is still sound to cut, so hard stop must stay live.
 */
export function isHardStopEnabled(...states: PlayerState[]): boolean {
  return states.some(isPlayerActive);
}
```

Add `leadPlayer: 'stopped',` to the returned slice object (after `chordsPlayer: 'stopped',`).

**3c. `src/store/engineSync.ts`** — change the transport player-state subscription selector:

```ts
  subs.push(
    useAppStore.subscribe(
      (s) =>
        (isPlayerActive(s.sequencerPlayer) ? 1 : 0) +
        (isPlayerActive(s.chordsPlayer) ? 2 : 0) +
        (isPlayerActive(s.leadPlayer) ? 4 : 0),
      (flags, prevFlags) => {
        audioEngine.init();
        if (flags !== 0 && prevFlags === 0) {
          audioEngine.resetClock();
        }
      },
    ),
  );
```

(The callback body is unchanged — `resetClock` still fires only on the fully-stopped → active transition.)

**3d. `src/components/TransportBar.tsx`** — add the selector and pass the third player:

```ts
  const leadPlayer = useAppStore((s) => s.leadPlayer);
```

```ts
  const aggregate = aggregatePlayerState(sequencerPlayer, chordsPlayer, leadPlayer);
  const hardStopDisabled = !isHardStopEnabled(sequencerPlayer, chordsPlayer, leadPlayer);
```

**3e. `src/components/ui/AmbientBackdrop.tsx`** — add the selector and pass the third player:

```ts
  const leadPlayer = useAppStore((s) => s.leadPlayer);
```

```ts
  const isPlaying = aggregatePlayerState(sequencerPlayer, chordsPlayer, leadPlayer) !== 'stopped';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/transportSlice.test.ts src/components/TransportBar.test.tsx src/store/engineSync.test.ts`
Expected: PASS. Then run `bun run lint` (the `PlayerModule`/`leadPlayer` type changes must type-check across `Header.tsx` and `play('lead')` call sites introduced later).

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/transportSlice.ts src/store/transportSlice.test.ts src/store/engineSync.ts src/components/TransportBar.tsx src/components/ui/AmbientBackdrop.tsx
git commit -m "feat(transport): add lead as a third transport player with three-way aggregate

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Piano-roll pitch-row view model

**Files:**
- Create: `src/components/lead/pianoRoll.ts`
- Test: `src/components/lead/pianoRoll.test.ts`

**Interfaces:**
- Consumes: `getScaleNotes`, `isNoteInScale`, `ROOTS` from `../../utils/musicTheory`; `MAX_STEPS_PER_BAR` from `../../utils/meter`; `type LeadMelodyView` from `../../store/types` (Task 2).
- Produces:
  - `export const LEAD_WINDOW_OCTAVES = 2;`
  - `export const LEAD_CELL_WIDTH = 20;`
  - `export function leadPitchRows(view: LeadMelodyView, root: string, scaleType: string, lowestOctave: number, octaveCount: number): string[]`
  - `export function hasOutOfScaleNote(notes: readonly string[], root: string, scaleType: string): boolean`
  - `export function leadStoredIndex(barIndex: number, stepInBar: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/components/lead/pianoRoll.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { hasOutOfScaleNote, leadPitchRows, leadStoredIndex } from './pianoRoll';

describe('leadPitchRows — scale-locked', () => {
  test('lists the scale notes across the window, highest first', () => {
    expect(leadPitchRows('scale-locked', 'C', 'Major', 3, 2)).toEqual([
      'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4',
      'B3', 'A3', 'G3', 'F3', 'E3', 'D3', 'C3',
    ]);
  });
  test('a pentatonic scale yields 5 rows per octave', () => {
    expect(leadPitchRows('scale-locked', 'C', 'Minor Pentatonic', 3, 2)).toHaveLength(10);
  });
});

describe('leadPitchRows — chromatic', () => {
  test('lists all 12 semitones per octave, highest first', () => {
    const rows = leadPitchRows('chromatic', 'C', 'Major', 3, 1);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toBe('B3');
    expect(rows[11]).toBe('C3');
  });
});

describe('hasOutOfScaleNote', () => {
  test('detects a note outside the active scale', () => {
    expect(hasOutOfScaleNote(['C4', 'C#4'], 'C', 'Major')).toBe(true);
    expect(hasOutOfScaleNote(['C4', 'E4'], 'C', 'Major')).toBe(false);
    expect(hasOutOfScaleNote([], 'C', 'Major')).toBe(false);
  });
});

describe('leadStoredIndex', () => {
  test('maps a (bar, step) column to the fixed-width stored slot', () => {
    expect(leadStoredIndex(0, 0)).toBe(0);
    expect(leadStoredIndex(0, 15)).toBe(15);
    expect(leadStoredIndex(1, 0)).toBe(24);
    expect(leadStoredIndex(2, 5)).toBe(53);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/lead/pianoRoll.test.ts`
Expected: FAIL — `./pianoRoll` does not resolve.

- [ ] **Step 3: Implement the view model**

Create `src/components/lead/pianoRoll.ts`:

```ts
import { getScaleNotes, isNoteInScale, ROOTS } from '../../utils/musicTheory';
import { MAX_STEPS_PER_BAR } from '../../utils/meter';
import type { LeadMelodyView } from '../../store/types';

/** Number of octaves the piano-roll window shows. Fixed at 2 (spec default). */
export const LEAD_WINDOW_OCTAVES = 2;

/** Fixed cell width in px — the playhead's translateX stride. */
export const LEAD_CELL_WIDTH = 20;

/**
 * The pitch rows of the piano-roll, from HIGHEST (index 0) to LOWEST. In
 * scale-locked view rows are the active scale's notes across the window; in
 * chromatic view all 12 semitones across the window. `lowestOctave` is the
 * lowest octave shown (leadMelodyOctave); the window spans octaveCount octaves.
 */
export function leadPitchRows(
  view: LeadMelodyView,
  root: string,
  scaleType: string,
  lowestOctave: number,
  octaveCount: number,
): string[] {
  const pitchClasses =
    view === 'chromatic' ? (ROOTS as readonly string[]) : getScaleNotes(root, scaleType);
  const rows: string[] = [];
  for (let oct = lowestOctave + octaveCount - 1; oct >= lowestOctave; oct--) {
    for (let i = pitchClasses.length - 1; i >= 0; i--) {
      rows.push(`${pitchClasses[i]}${oct}`);
    }
  }
  return rows;
}

/** True when a step holds at least one note outside the active scale. */
export function hasOutOfScaleNote(
  notes: readonly string[],
  root: string,
  scaleType: string,
): boolean {
  return notes.some((n) => !isNoteInScale(n, root, scaleType));
}

/**
 * The flat stored index for a (bar, stepInBar) column. The melody is stored at
 * MAX_STEPS_PER_BAR per bar, so this never depends on the active meter.
 */
export function leadStoredIndex(barIndex: number, stepInBar: number): number {
  return barIndex * MAX_STEPS_PER_BAR + stepInBar;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/lead/pianoRoll.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/lead/pianoRoll.ts src/components/lead/pianoRoll.test.ts
git commit -m "feat(lead): add piano-roll pitch-row and out-of-scale view model

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: `useLeadPlayback` hook

**Files:**
- Create: `src/components/lead/useLeadPlayback.ts`
- Test: `src/components/lead/useLeadPlayback.test.ts`

**Interfaces:**
- Consumes: `leadStepNotes`, `resolveLeadStepTriggers` from `../../audio/leadMelody` (Task 1); `initPlaybackEngine`, `playbackNoteOn`, `playbackNoteOff`, `playbackStopSource`, `subscribePlaybackClock` from `../../audio/playback/playbackEngine`; `DEFAULT_VELOCITY` from `../../audio/constants`; `stepDurationSec` from `../../utils/musicTheory`; `arpStepFor`, `getMeter` from `../../utils/meter`; `armOnBarLine`, `isSoftStopBoundary`, `shouldHardStopNow` from `../playerStop`; `PlayerState` from `../../store/types`; `useAppStore` from `../../store/store`.
- Produces:
  - `export interface LeadArming { armed: boolean }`
  - `export type LeadStepAction = 'idle' | 'soft-stop' | 'play'`
  - `export function leadStepAction(state: PlayerState, step: number, arming: LeadArming, stepsPerBar: number): LeadStepAction`
  - `export function useLeadPlayback(): { currentStep: number; isPlaying: boolean }`

- [ ] **Step 1: Write the failing test**

Create `src/components/lead/useLeadPlayback.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { leadStepAction, type LeadArming } from './useLeadPlayback';

describe('leadStepAction', () => {
  test('a stopped player is idle and never arms', () => {
    const arming: LeadArming = { armed: false };
    expect(leadStepAction('stopped', 0, arming, 16)).toBe('idle');
    expect(arming.armed).toBe(false);
  });

  test('arms on the first bar line, plays while armed', () => {
    const arming: LeadArming = { armed: false };
    expect(leadStepAction('playing', 5, arming, 16)).toBe('idle');
    expect(leadStepAction('playing', 16, arming, 16)).toBe('play');
    expect(leadStepAction('playing', 17, arming, 16)).toBe('play');
  });

  test('a soft stop only lands on a bar line', () => {
    const arming: LeadArming = { armed: true };
    expect(leadStepAction('stopping', 20, arming, 16)).toBe('idle');
    expect(leadStepAction('stopping', 32, arming, 16)).toBe('soft-stop');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/lead/useLeadPlayback.test.ts`
Expected: FAIL — `./useLeadPlayback` does not resolve.

- [ ] **Step 3: Implement the hook**

Create `src/components/lead/useLeadPlayback.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/store';
import { leadStepNotes, resolveLeadStepTriggers } from '../../audio/leadMelody';
import {
  initPlaybackEngine,
  playbackNoteOff,
  playbackNoteOn,
  playbackStopSource,
  subscribePlaybackClock,
} from '../../audio/playback/playbackEngine';
import { DEFAULT_VELOCITY } from '../../audio/constants';
import { stepDurationSec } from '../../utils/musicTheory';
import { arpStepFor, getMeter } from '../../utils/meter';
import { armOnBarLine, isSoftStopBoundary, shouldHardStopNow } from '../playerStop';
import type { PlayerState } from '../../store/types';

/** Short enough to read as an instant cut, long enough not to click. */
const HARD_STOP_RELEASE = 0.02;

export interface LeadArming {
  armed: boolean;
}

export type LeadStepAction = 'idle' | 'soft-stop' | 'play';

/**
 * The lead scheduler's step decision — identical in shape to the sequencer's:
 * arm on the first bar line, soft-stop on the next bar line, else play while
 * armed. `stepsPerBar` is the ACTIVE bar length.
 */
export function leadStepAction(
  state: PlayerState,
  step: number,
  arming: LeadArming,
  stepsPerBar: number,
): LeadStepAction {
  if (state === 'stopped') return 'idle';
  if (isSoftStopBoundary(state, step, stepsPerBar)) return 'soft-stop';
  if (!armOnBarLine(arming, step, stepsPerBar)) return 'idle';
  return 'play';
}

/**
 * Drives the melody grid's notes into the synth voice on the shared clock.
 * The arp is a synth feature, not a note mode: `synthParams.arpActive` gates
 * arpeggiation (on = arp, off = block), never whether the melody runs. Notes
 * and params are read LIVE from the store inside the clock callback, so a
 * knob tweak reaches the next hit without re-subscribing.
 */
export function useLeadPlayback(): { currentStep: number; isPlaying: boolean } {
  const playerState = useAppStore((s) => s.leadPlayer);
  const hardStop = useAppStore((s) => s.hardStop);
  const isPlaying = playerState !== 'stopped';

  const [currentStep, setCurrentStep] = useState<number>(0);
  const armingRef = useRef<LeadArming>({ armed: false });
  const softStopPendingRef = useRef(false);

  // Rewind on every transition to 'stopped' (React may never render it: the
  // Instant Vibe swap hard-stops and restarts inside one batched click).
  useEffect(
    () =>
      useAppStore.subscribe(
        (s) => s.leadPlayer,
        (next, prev) => {
          if (next === 'stopped') {
            armingRef.current.armed = false;
            setCurrentStep(0);
          }
          if (!shouldHardStopNow(prev, next, softStopPendingRef.current)) {
            if (next !== 'stopping') softStopPendingRef.current = false;
            return;
          }
          playbackStopSource('synth', HARD_STOP_RELEASE);
        },
      ),
    [],
  );

  useEffect(() => {
    if (!isPlaying) {
      armingRef.current.armed = false;
      setCurrentStep(0);
      return;
    }

    initPlaybackEngine();

    return subscribePlaybackClock((step, _beat, time) => {
      const s = useAppStore.getState();
      const playerState = s.leadPlayer;
      const stepsPerBar = getMeter(s.meterId).stepsPerBar;
      const melodyLength = s.leadLoopLength * stepsPerBar;
      setCurrentStep(step % melodyLength);
      const action = leadStepAction(playerState, step, armingRef.current, stepsPerBar);

      if (action === 'soft-stop') {
        playbackStopSource('synth', s.synthParams.release, time);
        softStopPendingRef.current = true;
        hardStop('lead');
        return;
      }
      if (action !== 'play') return;

      const stepInLoop = step % melodyLength;
      const notes = leadStepNotes(s.leadMelodySteps, stepInLoop, stepsPerBar);
      const stepDur = stepDurationSec(s.bpm);
      const arpStep = arpStepFor(step, stepsPerBar);
      const triggers = resolveLeadStepTriggers(
        notes,
        s.synthParams.arpActive,
        arpStep,
        s.synthParams,
        stepDur,
      );
      for (const t of triggers) {
        playbackNoteOn(t.note, s.synthParams, DEFAULT_VELOCITY, time + t.timeOffsetSec, 'synth');
        playbackNoteOff(t.note, s.synthParams.release, time + t.timeOffsetSec + t.holdSec, 'synth');
      }
    });
  }, [isPlaying, hardStop]);

  return { currentStep, isPlaying };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/lead/useLeadPlayback.test.ts`
Expected: PASS (3 tests). Then run `bun run lint` — `hardStop('lead')` now type-checks against `PlayerModule` (Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/components/lead/useLeadPlayback.ts src/components/lead/useLeadPlayback.test.ts
git commit -m "feat(lead): add useLeadPlayback clock hook with block/arp trigger resolution

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Piano-roll UI in `SynthView`

**Files:**
- Create: `src/components/lead/LeadPianoRoll.tsx`
- Modify: `src/components/SynthView.tsx` (mount `useLeadPlayback` + `<LeadPianoRoll />`)
- Test: `src/components/lead/LeadPianoRoll.test.tsx` (new)
- Modify: `src/components/SynthView.test.tsx` (one smoke test)

**Interfaces:**
- Consumes: `leadPitchRows`, `hasOutOfScaleNote`, `leadStoredIndex`, `LEAD_CELL_WIDTH`, `LEAD_WINDOW_OCTAVES` from `./pianoRoll` (Task 4); `loopLengthDivisors`, `clampLeadLoopLength` from `../../audio/leadMelody` (Task 1); `getMeter` from `../../utils/meter`; `useLeadPlayback` from `./useLeadPlayback` (Task 5); `LeadMelodyView` from `../../store/types`.
- Produces:
  - `export interface LeadPianoRollProps { currentStep: number; isPlaying: boolean }`
  - `export const LeadPianoRoll: React.FC<LeadPianoRollProps>` — controls (view toggle, octave stepper, loop-length divisor select), a memoized `LeadPianoGrid`, and a separate `translateX` playhead overlay.

- [ ] **Step 1: Write the failing test**

Create `src/components/lead/LeadPianoRoll.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { LeadPianoRoll } from './LeadPianoRoll';

describe('LeadPianoRoll', () => {
  test('renders one loop-length option per divisor of the progression', () => {
    // Default progression (INITIAL_CHORDS) totals 4 bars → divisors 1, 2, 4.
    const html = renderToString(<LeadPianoRoll currentStep={0} isPlaying={false} />);
    expect(html).toContain('id="select-lead-loop-length"');
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="4"');
  });

  test('the grid lays out loopLength × stepsPerBar columns', () => {
    // Defaults: 4/4 (16 steps) × 1-bar loop → 16 columns of 20px.
    const html = renderToString(<LeadPianoRoll currentStep={0} isPlaying={false} />);
    expect(html).toContain('repeat(16, 20px)');
  });

  test('the playhead overlay translates by step × cell width only while playing', () => {
    const playing = renderToString(<LeadPianoRoll currentStep={3} isPlaying />);
    expect(playing).toContain('translateX(60px)'); // 3 × 20
    const stopped = renderToString(<LeadPianoRoll currentStep={3} isPlaying={false} />);
    expect(stopped).not.toContain('translateX(60px)');
  });

  test('no raw palette or absolute black/white classes leak in', () => {
    const html = renderToString(<LeadPianoRoll currentStep={0} isPlaying={false} />);
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-black');
    expect(html).not.toContain('rgba(');
  });
});
```

Add to `src/components/SynthView.test.tsx` (append inside the first `describe`):

```tsx
  test('the lead melody piano-roll renders', () => {
    const html = renderToString(<SynthView />);
    expect(html).toContain('Lead Melody');
    expect(html).toContain('id="select-lead-loop-length"');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/lead/LeadPianoRoll.test.tsx src/components/SynthView.test.tsx`
Expected: FAIL — `./LeadPianoRoll` does not resolve; `SynthView` has no "Lead Melody" output.

- [ ] **Step 3: Implement the component**

Create `src/components/lead/LeadPianoRoll.tsx`:

```tsx
import React, { useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/store';
import { getMeter } from '../../utils/meter';
import { clampLeadLoopLength, loopLengthDivisors } from '../../audio/leadMelody';
import {
  LEAD_CELL_WIDTH,
  LEAD_WINDOW_OCTAVES,
  hasOutOfScaleNote,
  leadPitchRows,
  leadStoredIndex,
} from './pianoRoll';
import type { LeadMelodyView } from '../../store/types';

export interface LeadPianoRollProps {
  currentStep: number;
  isPlaying: boolean;
}

// Memoized grid: props are stable across clock ticks, so the cells never
// re-render when only the playhead moves.
const LeadPianoGrid = React.memo(function LeadPianoGrid({
  stepsPerBar,
  loopLength,
  melody,
  rows,
  root,
  scaleType,
  view,
  onToggle,
}: {
  stepsPerBar: number;
  loopLength: number;
  melody: readonly string[][];
  rows: readonly string[];
  root: string;
  scaleType: string;
  view: LeadMelodyView;
  onToggle: (stepIndex: number, note: string) => void;
}) {
  const columns = loopLength * stepsPerBar;
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${columns}, ${LEAD_CELL_WIDTH}px)` }}
    >
      {rows.map((note) => (
        <React.Fragment key={note}>
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / stepsPerBar);
            const stepInBar = col - barIndex * stepsPerBar;
            const idx = leadStoredIndex(barIndex, stepInBar);
            const active = melody[idx]?.includes(note) ?? false;
            return (
              <button
                key={`${note}-${col}`}
                type="button"
                aria-label={note}
                aria-pressed={active}
                onClick={() => onToggle(idx, note)}
                className={`h-5 border border-base-300 ${
                  active ? 'bg-primary text-primary-content' : 'bg-base-200 hover:bg-base-300'
                }`}
              />
            );
          })}
        </React.Fragment>
      ))}
      {view === 'scale-locked' && (
        <React.Fragment key="out-of-scale">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / stepsPerBar);
            const stepInBar = col - barIndex * stepsPerBar;
            const idx = leadStoredIndex(barIndex, stepInBar);
            const outOfScale = hasOutOfScaleNote(melody[idx] ?? [], root, scaleType);
            return (
              <div
                key={`oos-${col}`}
                className={`h-5 border border-base-300 ${
                  outOfScale ? 'bg-warning' : 'bg-base-200'
                }`}
              />
            );
          })}
        </React.Fragment>
      )}
    </div>
  );
});

export const LeadPianoRoll: React.FC<LeadPianoRollProps> = ({ currentStep, isPlaying }) => {
  const meterId = useAppStore((s) => s.meterId);
  const leadMelodySteps = useAppStore((s) => s.leadMelodySteps);
  const leadLoopLength = useAppStore((s) => s.leadLoopLength);
  const leadMelodyView = useAppStore((s) => s.leadMelodyView);
  const leadMelodyOctave = useAppStore((s) => s.leadMelodyOctave);
  const setLeadMelodyView = useAppStore((s) => s.setLeadMelodyView);
  const setLeadMelodyOctave = useAppStore((s) => s.setLeadMelodyOctave);
  const setLeadLoopLength = useAppStore((s) => s.setLeadLoopLength);
  const toggleLeadNote = useAppStore((s) => s.toggleLeadNote);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const chords = useAppStore((s) => s.chords);

  const stepsPerBar = getMeter(meterId).stepsPerBar;
  const totalBars = chords.reduce((sum, c) => sum + (c.bars || 1), 0);
  const divisors = loopLengthDivisors(totalBars);

  const rows = useMemo(
    () =>
      leadPitchRows(
        leadMelodyView,
        scaleRoot,
        scaleType,
        leadMelodyOctave,
        LEAD_WINDOW_OCTAVES,
      ),
    [leadMelodyView, scaleRoot, scaleType, leadMelodyOctave],
  );

  // Clamp loopLength down when the progression no longer divides it.
  useEffect(() => {
    const clamped = clampLeadLoopLength(leadLoopLength, totalBars);
    if (clamped !== leadLoopLength) setLeadLoopLength(clamped);
  }, [totalBars, leadLoopLength, setLeadLoopLength]);

  const onToggle = useCallback(
    (stepIndex: number, note: string) => toggleLeadNote(stepIndex, note),
    [toggleLeadNote],
  );

  return (
    <div className="card bg-panel border border-base-300 shadow-xl">
      <div className="card-body p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span className="text-xs font-bold text-base-content">Lead Melody</span>

          <div className="flex items-center gap-1.5">
            <div className="join">
              {(['scale-locked', 'chromatic'] as const).map((m) => (
                <button
                  key={m}
                  id={`btn-lead-view-${m}`}
                  type="button"
                  onClick={() => setLeadMelodyView(m)}
                  className={`btn btn-xs join-item text-[11px] font-semibold ${
                    leadMelodyView === m
                      ? 'btn-primary'
                      : 'btn-ghost border border-base-300 text-base-content/60'
                  }`}
                >
                  {m === 'scale-locked' ? 'Scale' : 'Chromatic'}
                </button>
              ))}
            </div>

            <button
              id="btn-lead-octave-down"
              type="button"
              onClick={() => setLeadMelodyOctave(Math.max(1, leadMelodyOctave - 1))}
              className="btn btn-xs btn-square btn-ghost border border-base-300"
              title="Octave window down"
            >
              -
            </button>
            <span className="text-xs font-mono">{leadMelodyOctave}</span>
            <button
              id="btn-lead-octave-up"
              type="button"
              onClick={() => setLeadMelodyOctave(Math.min(6, leadMelodyOctave + 1))}
              className="btn btn-xs btn-square btn-ghost border border-base-300"
              title="Octave window up"
            >
              +
            </button>

            <select
              id="select-lead-loop-length"
              value={leadLoopLength}
              onChange={(e) => setLeadLoopLength(Number(e.target.value))}
              className="select select-xs select-ghost"
              title="Melody loop length (bars)"
            >
              {divisors.map((d) => (
                <option key={d} value={d}>
                  {d} bar{d === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="relative overflow-x-auto">
          <LeadPianoGrid
            stepsPerBar={stepsPerBar}
            loopLength={leadLoopLength}
            melody={leadMelodySteps}
            rows={rows}
            root={scaleRoot}
            scaleType={scaleType}
            view={leadMelodyView}
            onToggle={onToggle}
          />
          {isPlaying && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary"
              style={{ transform: `translateX(${currentStep * LEAD_CELL_WIDTH}px)` }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
```

**In `src/components/SynthView.tsx`:**

Add the import (next to the other `./` imports):

```tsx
import { LeadPianoRoll } from "./lead/LeadPianoRoll";
import { useLeadPlayback } from "./lead/useLeadPlayback";
```

Add the hook call in the component body (next to the other hooks, e.g. after `const keyboardMode = useAppStore((s) => s.keyboardMode);`):

```tsx
  const { currentStep: leadCurrentStep, isPlaying: leadIsPlaying } = useLeadPlayback();
```

Render the panel after the keyboard card, before the Preset Library drawer (after the closing `</div>` of the Keyboard card, around the `{/* Preset Library Sidebar Drawer / Modal */}` comment):

```tsx
      {/* Lead Melody Piano-Roll Step Sequencer */}
      <LeadPianoRoll currentStep={leadCurrentStep} isPlaying={leadIsPlaying} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/lead/LeadPianoRoll.test.tsx src/components/SynthView.test.tsx`
Expected: PASS (the 4 new `LeadPianoRoll` tests + the 1 new `SynthView` test + all existing SynthView tests). Then run `bun run check:theme` (all classes are role tokens; `translateX`/`gridTemplateColumns` inline styles contain no hex/rgb) and `bun run eslint` (import layering — `LeadPianoRoll`/`useLeadPlayback` import only audio bridges/helpers and the store, never `audio/engine`).

- [ ] **Step 5: Commit**

```bash
git add src/components/lead/LeadPianoRoll.tsx src/components/lead/LeadPianoRoll.test.tsx src/components/SynthView.tsx src/components/SynthView.test.tsx
git commit -m "feat(lead): render the memoized piano-roll grid with a translateX playhead in SynthView

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Final verification gate

**Files:** none (no code).

- [ ] **Step 1: Run the full gate**

Run: `bun run verify`
Expected: PASS (test + lint + check:keys + check:drums + build). The theme-token guard runs under `bun test`.

- [ ] **Step 2: Run the import-layering lint**

Run: `bun run eslint`
Expected: PASS — confirm no task introduced a `no-restricted-imports` violation (audio never imports store/components; store never imports components; `useLeadPlayback`/`LeadPianoRoll`/`pianoRoll` import only allowed layers and never `audio/engine`).

- [ ] **Step 3: Commit any residuals**

```bash
git add -A
git commit -m "chore: SP2 verification clean

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

(If the working tree is already clean after Task 6, skip this commit.)

---

## Self-review checklist

- **Spec coverage:** melody→trigger resolution, arp-off block + arp-on reuse of `buildArpSequence`/`computeArpTriggers`, `LEAD_GATE` (Task 1); `leadMelodySteps`/`leadLoopLength` fixed `MAX_STEPS_PER_BAR` storage, `toggleLeadNote`, resize-on-loopLength, non-destructive meter switch (Tasks 1, 2); `'lead'` player + `leadPlayer` + three-way aggregate/hard-stop + engineSync + TransportBar + AmbientBackdrop (Task 3); scale-locked/chromatic rows + out-of-scale detection + octave window (Task 4); `useLeadPlayback` clock hook with reset-on-stop + soft-stop (Task 5); memoized grid + `translateX` playhead overlay + view/octave/loopLength controls (Task 6); persistence round-trip + transient fields, no version bump (Task 2).
- **Placeholder scan:** every step has concrete code/commands; no TBD/TODO/"similar to Task N"/"write tests for the above".
- **Type consistency:** `LeadMelodyView`, `leadPitchRows`, `hasOutOfScaleNote`, `leadStoredIndex`, `LEAD_CELL_WIDTH`, `LEAD_WINDOW_OCTAVES`, `leadStepNotes`, `stepInLoopFor`, `loopLengthDivisors`, `clampLeadLoopLength`, `resizeLeadMelody`, `resolveLeadStepTriggers`, `LeadTrigger`, `LEAD_GATE`, `leadStepAction`, `LeadArming`, `useLeadPlayback`, `LeadPianoRoll`, `LeadPianoRollProps`, and the store field/setter names (`leadMelodySteps`, `leadLoopLength`, `leadMelodyView`, `leadMelodyOctave`, `setLeadMelodySteps`, `setLeadLoopLength`, `setLeadMelodyView`, `setLeadMelodyOctave`, `toggleLeadNote`, `leadPlayer`) are each defined in exactly one task and referenced verbatim in the tasks that consume them.

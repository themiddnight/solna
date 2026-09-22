# PlaybackHost — move playback controllers out of the grids — design

**Issue:** DEV-422 "PlaybackHost — move playback controllers out of the grids".
**Branch:** `refactor/dev-422-playback-host`.
**Status:** Approved design, made concrete (2026-09-22). §11 lists the decisions one per line.

**User-visible change:** none. Every lane sounds, highlights and stops exactly as today; the
golden WAV and `bun run verify` are unchanged. What changes is *why* a lane sounds: because one
`PlaybackHost` is mounted, not because its grid is.

---

## 0. Verified facts (checked against the code on this branch, @d68258b3)

| # | Claim | Evidence |
|---|---|---|
| F1 | Lead/FX controllers are mounted by the grid, playback first, publisher second | `components/loop/lead/LeadMelodyGrid.tsx:251-252` |
| F2 | The Beat controller is mounted by the grid, "EXACTLY once" | `components/loop/sequencer/SequencerGrid.tsx:26-27, 50` |
| F3 | The chord controller is mounted by the chord view hook | `components/loop/chord/useChordView.ts:76` |
| F4 | Tree order of those mounts is lead, fx, chord, sequencer | `components/loop/PatternView.tsx:59, 68, 72, 75` |
| F5 | `useChordPlayback` returns `{ playChordWithRhythm, playBassWithPattern, playingIndex, setPlayingIndex, activeChordId, setActiveChordId, isPlaying }`; `setPlayingIndex` has no caller outside the file | `useChordPlayback.ts:708`; grep |
| F6 | Clock half: pure helpers `createChordArming`, `resetChordArming`, `rewindChordOnClockReset`, `activeStepsPerBar`, `armPad`, `startChordPlan`, `emitChordPlanStep`, `chordStepAction` (`:58-245`) and hooks `useChordScheduler`, `useChordReleases`, `useChordStopHandler`, `useChordClock` (`:439-665`) | `useChordPlayback.ts` |
| F7 | Audition half: `useChordPatternPreview` (`:300`), `useBassPatternPreview` (`:356`), consumed only by `usePatternPreviews` | `useChordView.ts:411, 442, 466` |
| F8 | The clock writes both `playingIndex` and `activeChordId` (`showChord`); `clearChordUi` nulls both, calls `resetStep('chords')` and `setPlayheadChord(null)` | `useChordPlayback.ts:686-696` |
| F9 | The view writes `activeChordId` on card hold/release | `useChordView.ts:348, 380, 389` |
| F10 | Highlight rule `playingIndex === idx \|\| activeChordId === chord.id` | `ProgressionCard.tsx:272, 283` |
| F11 | `isPlaying` reaches the modules from the chord hook | `components/loop/ChordView.tsx:179`; `useChordPlayback.ts:670` (`chordsPlayer !== 'stopped'`) |
| F12 | `useLeadStepPublisher` reads only the store (`leadMarkerFollowsClock`) and the clock, writes only `playbackStep` | `loop/lead/useLeadStepPublisher.ts:1-10, 67-93` |
| F13 | `useArpPlayback` imports `react` and calls `audioEngine` directly (subscribe, trigger, release) | `audio/playback/arpPlayback.ts:1-2, 160-219` |
| F14 | It is mounted once, app-wide, in the input deck | `components/useInputDeck.ts:4, 726`; `App.tsx:126` |
| F15 | `arpPlayback.ts` is the only `src/audio/` file importing `react` | grep |
| F16 | Components may not import `audio/engine` (R038) — so F13's body cannot move as-is | `eslint.config.js:627-636` |
| F17 | `src/audio/` has four `no-restricted-imports` blocks that each REPLACE the rule (`:314`, `:391`, `:444` via `@typescript-eslint/…`, `:492`); a new ban must be spread into all four | `eslint.config.js:23-30` |
| F18 | ESLint rules are tested with `new ESLint().lintText(source, { filePath })` | `src/architecture/dependencyLayers.test.ts` |
| F19 | No DOM test renderer in devDeps; `renderToString` runs hook bodies but no effects; the repo already counts hook calls in source instead | `package.json`; `loop/ChordView.test.tsx:73-85` |
| F20 | Source-reading tests pin today's paths | `playbackStep.wiring.test.ts:49, 99, 115, 178`; `schedulingFocusIndependence.test.ts:36-41`; `useLeadStepPublisher.test.ts:106`; `useSequencerPlayback.test.ts:77, 143, 162`; `useChordPlayback.test.ts:251, 267, 282`; `useLeadPlayback.test.ts:30, 40` |
| F21 | `Workspace` renders `<LoopPage />` at `:188` and `<SongPage />` (ArrangeView, a clock subscriber at `song/ArrangeView.tsx:147`) at `:191`; `usePlayheadSync()` at `:102` | `App.tsx` |
| F22 | Latest rule id R311, latest ADR 0038 | `.claude/rules/`, `docs/decisions/README.md:55` |

---

## 1. Goal

Make `src/components/` views dumb about audio: one `PlaybackHost` owns every transport-driven
controller, so no lane depends on a grid being mounted (closes structure smell U4/A3), and the
last React hook leaves `src/audio/` behind an ESLint ban (closes A5's hook half).

## 2. Non-goals

- No layout or visual change; no view is unmounted — the always-mounted rule (R014) stays.
- No planner, engine, clock or `playbackEngine` contract change; no new engine setter.
- No change to what a controller schedules or when (same listener order, §5.3).
- `useInputDeck` and `usePlayheadSync` stay where they are.

---

## 3. Target layout

```
src/components/playback/            (new folder: controllers used by no single view)
  PlaybackHost.tsx                  returns null; the one mount of every transport controller
  useLeadPlayback.ts(+ .test.ts)    moved from loop/lead/
  useLeadStepPublisher.ts(+ .test.ts) moved from loop/lead/
  useSequencerPlayback.ts(+ .test.ts) moved from components/ (sequencerStartup.test.ts too)
  useChordClockPlayback.ts(+ .test.ts) clock half of useChordPlayback.ts
  useArpPlayback.ts                 React half of audio/playback/arpPlayback.ts
  PlaybackHost.test.tsx             new
src/components/playingChord.ts(+ .test.ts)  new pub/sub, beside playbackStep.ts / playheadBeat.ts
src/components/loop/chord/useChordAudition.ts  audition half of useChordPlayback.ts
```

`playingChord.ts` goes to the `components/` root, not `playback/`: it is written by the host and
read by the chord view — two areas, so the shared location (R276), next to its two siblings.
`playerStop.ts`, `playbackStep.ts`, `sequencerGrid.ts` stay put (already shared).

### 3.1 `useLeadStepPublisher` moves (decision)

It is **playback, not view**: its inputs are the store and the clock, its output is the
`playbackStep` pub/sub (F12); nothing in it reads a grid ref, prop or layout. It subscribes the
shared clock, so leaving it in the grid would keep "a clock subscriber exists because a grid is
mounted" true and R040 could not be inverted. The *consumer* (`useLeadMarker*`) stays in the grid.

## 4. `PlaybackHost`

```tsx
export function PlaybackHost(): null {
  useLeadPlayback('lead');
  useLeadStepPublisher('lead');
  useLeadPlayback('fx');
  useLeadStepPublisher('fx');
  useChordClockPlayback();
  useSequencerPlayback();
  return null;
}
```

Rendered once in `Workspace` (`App.tsx`) as the element immediately before the `<LoopPage />`
wrapper (`:188`), with a one-line comment beside `usePlayheadSync()` (`:102`) pointing at it. It
is JSX, not a hook call in `Workspace`, so hook order stays local and the element position fixes
effect order (§5.3). Exported `memo`-wrapped like `LoopPage`/`SongPage`, so a `Workspace`
re-render does not re-run six controllers' selectors; `appChildMemo.test.tsx` gains it.

## 5. Data flow

### 5.1 Chord split

| Today (`useChordPlayback.ts`) | After |
|---|---|
| Pure helpers F6, `ChordArming` type | `playback/useChordClockPlayback.ts`, exported for its test as today |
| `useChordScheduler`/`Releases`/`StopHandler`/`Clock`, `clearChordUi`, `showChord` | `useChordClockPlayback()` (returns `void`), same bodies |
| `useChordPatternPreview`, `useBassPatternPreview` | `loop/chord/useChordAudition.ts` → `{ playChordWithRhythm, playBassWithPattern }` |
| `ChordPlaybackState` (11 selectors) | split: each hook selects only the fields it reads (R-components narrow selectors) |
| `playingIndex` state | `playingChord` pub/sub `index` |
| `activeChordId` state | clock half → `playingChord.chordId`; view half → `useState` in `useChordView` |
| `isPlaying` | `useChordView` selects `s.chordsPlayer !== 'stopped'` → `ChordView.tsx:179` |

`showChord(index, chord)` becomes `playingChord.set({ index, chordId: chord.id })`;
`clearChordUi` becomes `playingChord.set(null)` + the same `resetStep('chords')` and
`setPlayheadChord(null)`. `useChordReleases` keeps reading `chordSynthParams`/`bassSynthParams`.

### 5.2 `playingChord` pub/sub (R313)

Same shape as `playheadBeat.ts`: `createPlayingChordPublisher()` with `get/set/subscribe`, one
module instance `playingChord`, `usePlayingChord()` via `useSyncExternalStore` with
`getServerSnapshot = get`. Value `{ index: number; chordId: string } | null`. `set` is a no-op
(no notify) when index and chordId both equal the current value — so a new object with the same
content never re-renders. Never a slice (R016/R017).

**Highlight, preserving last-writer-wins exactly.** Today the clock overwrites the view's
`activeChordId` on every chord change and on stop (F8), and the view overwrites the clock's on
hold/release (F9). After the split `useChordView` subscribes `playingChord` and resets its local
`activeChordId` to `null` on every notify (an effect on `playingChord.subscribe`), and
`SortableProgression` computes
`isActive = (p !== null && (p.index === idx || p.chordId === chord.id)) || activeChordId === chord.id`
with `p = usePlayingChord()`. The release path (F9 `setActiveChordId(null)`) no longer clears the
clock's id; today that mattered only for the frame until the next chord, where `playingIndex`
still lit the same card — so the visible result is identical. `SortableProgression` now
re-renders on a chord change instead of the whole `ChordView` body re-rendering (fewer renders).

### 5.3 Clock listener order is preserved

Every controller subscribes inside an effect gated on its player's state, so on Play the
listeners register in the commit's effect order = tree order. Today: lead playback, lead
publisher, fx playback, fx publisher, chord, sequencer (F1, F4), then `ArrangeView` (F21). The
host's hook order and its position before `<LoopPage />` reproduce that sequence, so per-tick
callback order is unchanged.

### 5.4 Arp (R314)

`audio/playback/arpPlayback.ts` loses `react` and `useArpPlayback`, and gains
`startArpClock(stateRef: ArpStateRef): () => void` holding today's effect body verbatim: the
`audioEngine.subscribeClock` tick and a returned cleanup that unsubscribes and runs
`releaseTriggeredTargets` off the **latest** ref. `components/playback/useArpPlayback.ts` is
`useEffect(() => (active ? startArpClock(stateRef) : undefined), [active, stateRef])`.
The engine calls stay in `audio/` because components may not import `audio/engine` (F16) — moving
the body as-is would need a bridge per call. `useInputDeck.ts:4, 726` imports the hook from
`@/components/playback/useArpPlayback`; it stays mounted there, not in the host (held-key driven).
The `exhaustive-deps` disable at the old cleanup disappears with the hook (plain function now).

---

## 6. File-by-file changes

| File | Change |
|---|---|
| `components/playback/PlaybackHost.tsx` | new (§4) |
| `components/playback/useChordClockPlayback.ts` | new: F6 helpers + clock hooks from `useChordPlayback.ts` |
| `components/loop/chord/useChordAudition.ts` | new: F7 previews + their narrow selectors |
| `components/loop/chord/useChordPlayback.ts` | deleted |
| `components/playingChord.ts` | new (§5.2) |
| `components/loop/chord/useChordView.ts` | `useChordAudition()` replaces `useChordPlayback()` (`:76`); local `activeChordId` + reset-on-publish; `isPlaying` selector; `state.playback` → `state.audition` (`:136, 347-348, 411`) |
| `components/loop/chord/ProgressionCard.tsx` | `:272, 283` read `usePlayingChord()` + `state.activeChordId` |
| `components/loop/ChordView.tsx` | `:179` `state.isPlaying` |
| `components/loop/lead/LeadMelodyGrid.tsx` | drop imports `:10-11`, calls `:251-252`, rewrite comments `:190-203, 242-250` |
| `components/loop/sequencer/SequencerGrid.tsx` | drop import `:3`, call `:50`; docblock `:26-27, 37-39` points at the host |
| `components/loop/lead/useLeadPlayback.ts`, `useLeadStepPublisher.ts`, `components/useSequencerPlayback.ts` | `git mv` to `playback/`; docblocks updated (`useLeadStepPublisher.ts:63-65` "mounted beside … in LeadMelodyGrid") |
| `audio/playback/arpPlayback.ts` | §5.4; `components/playback/useArpPlayback.ts` new |
| `components/useInputDeck.ts` | import path `:4`; comment `:285` path |
| `App.tsx` | render `<PlaybackHost />` (§4) |
| `eslint.config.js` | `REACT_IMPORT_BAN` (`paths: react, react-dom`, pattern `react-dom/*`) spread into the four `src/audio/` blocks (F17) |
| Tests F20 + `ChordView.test.tsx:73-85`, `useChordView.test.ts:32` | paths/names follow the moves (§7) |
| Comments only: `playbackStep.ts:227`, `audio/playback/playbackEngine.ts:7`, `store/loadLoop.ts:193`, `data/chordRhythms.ts:5`, `plan/chordEvents.test.ts:131`, `arpPlayback.test.ts:121` | new names/paths |

## 7. Tests

- **Moved, unchanged assertions:** `useLeadPlayback.test.ts`, `useLeadStepPublisher.test.ts`,
  `useSequencerPlayback.test.ts`, `sequencerStartup.test.ts` follow their files;
  `useChordPlayback.test.ts` → `playback/useChordClockPlayback.test.ts` (import + three
  `readFileSync` paths). Path lists in F20 updated; `schedulingFocusIndependence.test.ts` lists
  `useChordClockPlayback.ts` in place of `useChordPlayback.ts`. The arp stays out of that list:
  it follows focus by design (`target`).
- **`playingChord.test.ts`:** set/get, notify once, same-content set is a no-op, unsubscribe,
  `usePlayingChord` under `renderToString` shows the published value.
- **`PlaybackHost.test.tsx` — what is feasible.** An effect-level proof ("the clock gains N
  subscribers with no grid mounted") is **not** feasible: `renderToString` runs no effects and
  there is no DOM renderer (F19). Two tests instead: (1) `renderToString(<PlaybackHost />)` is `''`
  and does not throw with the default store — the hook bodies really run with no grid in the tree;
  (2) a source composition test: `PlaybackHost.tsx` calls, in §5.3 order, `useLeadPlayback('lead')`,
  `useLeadStepPublisher('lead')`, the two `'fx'` calls, `useChordClockPlayback()`,
  `useSequencerPlayback()`; and across every non-test file under `src/` each controller name is
  called only there (so no grid re-mounts one — the double-mount guard). `ChordView.test.tsx`'s
  "exactly one chord scheduler" becomes this. *Rejected:* `mock.module` spies (Bun's module mock
  is process-wide and leaks into other files); adding `happy-dom` (a devDep for one test).
- **ESLint ban** in `dependencyLayers.test.ts` style (F18): `import { useEffect } from 'react'`
  is an error at `src/audio/playback/x.ts`, `src/audio/export/renderMidi.ts`,
  `src/audio/masterRack.ts` and `src/audio/playback/plan/x.ts` (one per block); allowed at
  `src/components/playback/x.ts`.
- **Unchanged:** `renderMixdownGolden` and its three files; `bun run verify` green.

## 8. Rules, ADR and doc sync (same change)

- **ADR-0039 "PlaybackHost"** (`docs/decisions/0039-playback-host.md`, template from the README):
  context U4/A3 + A5, decision §3-§5, rejected alternatives (keep controllers in grids; a
  slice for `playingChord`; moving the arp into the host; a `playbackEngine` bridge per arp call).
  Index row in `docs/decisions/README.md` after `:55`.
- **R040 inverted in place:** "Transport controllers are mounted once, in `PlaybackHost`: a lane
  sounds because the host is mounted, never because its grid is." — CLAUDE.md `:67-68`,
  ADR-0001 `:61`, `playback.md`.
- **R014/R015 kept, reason rewritten:** views stay mounted to keep UI state (scroll, drag, meter
  history, local state); audio is independent of mounting. CLAUDE.md `:60-63`; ADR-0001 Context (`:12`),
  Decision (`:26-29`) and the Consequence bullet `:45` marked "superseded by ADR-0039".
- **R039 path list** (`playback.md:28`, ADR-0002 `:125`): `components/playback/*`
  (`useChordClockPlayback`, `useLeadPlayback`, `useLeadStepPublisher`, `useSequencerPlayback`,
  `useArpPlayback`), `useInputDeck`, `usePlayheadSync`, the pub/subs. `playback.md` `paths:` gains
  `src/components/playback/**` and `src/components/playingChord.ts`.
- **New:** R312 — `PlaybackHost` is the only mount of the transport controllers; a view never calls
  one. R313 — the playing chord travels through `components/playingChord.ts`, never a slice.
  R314 — `src/audio/` imports neither `react` nor `react-dom` (ESLint). Each gets a `## Prohibited`
  line (R312, R313 in `playback.md`; R314 in `boundaries-and-gates.md`). `components.md` gets a
  pointer: a controller is not a view's colocated hook (→ R312).
- **Architecture docs:** `feature-overview.md:41, 45, 174`; `structure/01-ui.md:150-166, 351-352,
  421-425, 448, 475-483, 496, 536-537`; `structure/03-audio.md:81, 252-265, 287, 313, 488`;
  `structure/04-domain-and-dependencies.md:159-162, 360, 487-488`; `structure/README.md:37`, and
  rows `:110` (U4/A3) and `:114` (A5 hook half) marked **Fixed (DEV-422)**, `:124` trimmed.
  ADR-0027 `:39, 113` get the new controller file names.

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | Chord highlight lags or flickers via the pub/sub | `set` is synchronous at the same call site the `setState` was; content-equal no-op; §5.2 reset keeps last-writer-wins |
| K2 | Double mount mid-refactor (grid and host both call a controller → every event twice) | One commit removes the grid calls and adds the host; §7 composition test counts call sites |
| K3 | Listener order drift changes per-tick behaviour | §5.3 order fixed by hook order + host position; the composition test asserts the order |
| K4 | HMR / StrictMode double effects | Same as today: every controller's cleanup unsubscribes and hard-stops; the host is one more fast-refresh boundary, not a new lifecycle |
| K5 | Arp regression when the body moves to a function | Body moved verbatim; latest-ref cleanup preserved; `arpPlayback.test.ts` unchanged |
| K6 | A stale path in a source-reading test passes vacuously | Those tests `readFileSync` the path, so a stale path throws, not passes |

## 10. Acceptance criteria

- No file under `src/components/loop/` or `src/components/song/` calls a transport controller;
  `PlaybackHost` calls each exactly once (test).
- `src/audio/` contains no `react`/`react-dom` import and ESLint rejects one (test).
- Play/stop of each lane, soft stop on the bar line, chord card highlight, Rec-armed lead marker
  and the arp behave as before in a manual pass; golden files untouched.
- `grep -rn "useChordPlayback" src .claude CLAUDE.md docs/architecture` is empty.
- `bun run verify` green; `bun run eslint` zero errors and warnings; both Knip scans zero.

## 11. Decisions for review

1. `PlaybackHost` rendered as JSX before `<LoopPage />`, hook order lead, lead-publisher, fx, fx-publisher, chord, sequencer.
2. `useLeadStepPublisher` moves to `playback/` (store + clock in, pub/sub out).
3. Clock helpers + test land in `playback/useChordClockPlayback.ts`; auditions in `loop/chord/useChordAudition.ts`.
4. `playingChord.ts` at the `components/` root; view's `activeChordId` reset on every publish.
5. Arp body becomes `startArpClock` in `audio/`; only the `useEffect` wrapper moves.
6. `react`/`react-dom` ban spread into all four `src/audio/` import blocks.
7. Host tested by `renderToString` smoke + source composition; no `mock.module`, no DOM devDep.
8. ADR-0039; R040 inverted in place; R312–R314 new.

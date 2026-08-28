# React Performance Audit — Solna

**Date:** 2026-08-28
**Branch:** `worktree-perf-optimize`
**Plan:** `docs/superpowers/plans/2026-08-28-react-performance.md`

## 1. Why now

Solna keeps all four views mounted at once and drives three independent
per-frame / per-beat clocks: the audio clock (16th notes), the playhead beat
(store write once per beat) and `requestAnimationFrame` loops for the analyser
widgets. Every one of those ticks lands in React. The audit below traces where
that tick cost is spent and where it is spent on nothing.

Nothing here is a correctness bug. Every finding is either wasted CPU on a hot
path or wasted bytes in the first paint.

**Measured build baseline:** one JS chunk, `dist/assets/index-*.js` at
498.10 kB (145.09 kB gzip), plus 154.75 kB CSS.

## 2. Findings

### F1 — `engineSync` runs `JSON.stringify` on every store write

`src/store/engineSync.ts` has four subscriptions whose *selectors* encode an
object into a string so the subscription only fires on a real value change:

- `(s) => JSON.stringify(s.effects)` (one subscription)
- `(s) => JSON.stringify(s[field])` for `synthParams`, `chordSynthParams`,
  `bassSynthParams` (three subscriptions)
- `` (s) => `${s.drumFilterCutoff}|${s.drumFilterResonance}|${s.drumFilterType}` ``

Zustand runs *every* selector on *every* `setState`, not just when the watched
field changed. A knob drag commits ~60 store writes per second, so the four
string-encoding selectors run ~240 times a second over objects of 9
(`MasterEffects`) and 25 (`SynthParams`) keys — plus three string allocations
and a `split('|')` + two `parseFloat` in the drum-filter listener each time it
does fire.

`subscribeWithSelector` in zustand 5.0.15 accepts an `equalityFn`
(verified in `node_modules/zustand/middleware/subscribeWithSelector.d.ts`):

```ts
<U>(selector, listener, options?: { equalityFn?: (a: U, b: U) => boolean; fireImmediately?: boolean })
```

`zustand/shallow` resolves in this version and re-exports
`zustand/vanilla/shallow`'s `shallow<T>(a: T, b: T): boolean`.

Both watched types are **flat objects of primitives** (`MasterEffects` in
`src/store/initialState.ts:97`, `SynthParams` in `src/types.ts:35`), so shallow
equality is exactly equivalent to the current string comparison — but it is an
identity check first and only walks keys when the identity actually changed.

Secondary: the fix also deletes a 12-line comment block that documents a
fragile invariant ("key order does not vary" across every writer of
`effects` / `*SynthParams`). Removing an invariant nobody can enforce is part
of the value of this finding. The file gets shorter.

### F2 — `ChordView` recomputes ~60-100 `tonal` calls twice a second

`ChordView` subscribes to `playheadBeat` (`src/components/ChordView.tsx:164`),
so it re-renders on every beat — twice a second at 120 BPM, forever, while the
Chords tab is merely *mounted*.

Two `tonal`-heavy expressions sit inline in its JSX and therefore run on every
one of those renders:

- `src/components/ChordView.tsx:938` — `getBorrowedChords(scaleRoot, scaleType)`.
  `src/utils/musicTheory.ts:189` builds 4-6 candidates then filters each through
  `generateBlockChordNotes` (`Chord.getChord` + `Note.midi` per note) and
  `isNoteInScale` (`Note.get` x2 per note).
- `src/components/ChordView.tsx:876` —
  `Array.from({ length: SCALES[scaleType]?.intervals.length || 7 })
  .map((_, i) => getDiatonicChordForDegree(i, scaleRoot, scaleType, use7thsInQuickAdd))`,
  seven more chord constructions.

Both depend only on `scaleRoot` / `scaleType` (+ `use7thsInQuickAdd`), which
change on user action, never on a beat.

`deriveChordNotes` usage in the same file is fine and is left alone.

### F3 — The VU meter re-renders the whole `TransportBar` at ~60 Hz

`src/components/TransportBar.tsx:36-56` runs a `requestAnimationFrame` loop
that calls `setVuLevel(level)` whenever
`Math.abs(level - vuLevelRef.current) > 0.02`. Real audio jitters by more than
0.02 on nearly every frame, so in practice this commits close to 60 times a
second while anything is playing.

Each commit re-renders `TransportBar` in full: `PlayerTransport`, the BPM
number input, the meter `<select>` with its `METER_OPTIONS.map`, the metronome
button, `PlayheadReadout`, the master `Slider` — and the meter itself.

The meter is drawn as `Array.from({ length: 10 })` with
`const active = vuLevel * 10 > i` (`TransportBar.tsx:153`). It has **11
observable states**. Everything between them is a wasted commit.

### F4 — A 16th-note tick reconciles 112 sequencer step buttons

`useSequencerPlayback()` (`src/components/useSequencerPlayback.ts`) owns
`currentStep` as `useState` and is called from inside `SequencerView`
(`src/components/SequencerView.tsx:55`). Every 16th note — 8x/sec at 120 BPM —
`setCurrentStep` re-renders the entire view: 16 header cells
(`SequencerView.tsx:318`) and 7 track lanes x 16 step buttons
(`SequencerView.tsx:339` / `:389`), each building a `className` from nested
ternaries. This runs while the Sequencer tab is hidden too, because `App.tsx`
keeps all four views mounted and toggles `block`/`hidden` — no paint, but full
reconciliation.

**Honest scoping.** The column highlight is genuinely per-step data that every
row needs, so extracting a memoized `TrackRow` does **not** remove rows from
the tick path. What it removes is the *other* direction: today, dragging the
drum-filter cutoff knob, moving the master sequencer volume, or changing the
genre select re-renders `SequencerView` at up to 60 Hz and rebuilds all 112
buttons with it. With `React.memo` + stable callbacks + a memoized `cells`
array, those interactions skip every row entirely. `DrumPads` is already
`React.memo` (`src/components/DrumPads.tsx:29`) so it is already off the tick
path. Do not claim a per-tick win that this refactor does not deliver.

Supporting waste: `const cells = stepCells(meter)` (`SequencerView.tsx:38`)
allocates a fresh 16-element array of objects on every render although it
depends only on `meterId`.

Hazard: `toggleStep` (`:64`) and `toggleMute` (`:75`) close over `tracks` from
the render scope. Wrapping them in `useCallback([])` naively would capture a
stale `tracks` and silently drop edits. `src/store/sequencerSlice.ts:43`
exposes `setSequencerTracks: (sequencerTracks) => set({ sequencerTracks })` — a
plain-value setter — so the callbacks must read live state through
`useAppStore.getState()`.

### F5 — Every chord card re-renders on every beat

`SortableChordCard` (`src/components/chord/SortableChordCard.tsx:33`) is a
plain function component, and `ChordView` passes it five inline callbacks
(`ChordView.tsx:1011-1025`). On a beat tick only one card's `activeBeat`
changes, but all of them re-render.

Hazard: `removeChord` (`ChordView.tsx:531`) is `setChords(chords.filter(...))`
and `updateChord` (`:535`) is `setChords(chords.map(...))` — both close over
`chords` *and* `chordOctave`. `handleMoveChord` (`:242`) closes over `chords`.
`handleCardPreviewMouseDown` (`:439`) closes over `chordSynthParams`. A naive
`useCallback([])` on any of them captures a stale progression and corrupts
edits.

`src/store/chordsSlice.ts:24` exposes `setChords: (chords) => set({ chords })`
— a plain-value setter, no updater form — so the callbacks must read live state
via `useAppStore.getState()`.

Expected residual: `useSortable` from `@dnd-kit` subscribes to drag context, so
cards still re-render during an active drag. That is correct and expected.

### F6 — `SynthView` re-registers its window key listeners on every knob move

`src/components/SynthView.tsx:255` declares
`handleNoteOn = useCallback(..., [keyboardParams.arpActive, keyboardParams])`.
The whole `keyboardParams` object is in the dep list, so the callback identity
changes on **any** synth parameter edit. `handleNoteOn` and `handleNoteOff` are
both in the dep array of the `useEffect` at `:354-430` that registers `keydown`
and `keyup` on `window` — so a single knob drag tears down and re-registers two
global listeners ~60 times a second.

Inside those handlers, `getScaleLockedKeyboardNotesFlat(scaleRoot, scaleType,
keyboardOctave)` (`:379` and `:403`) and `getChromaticKeyboardNotes(keyboardOctave)`
(`:384` and `:408`) rebuild the whole note list from `tonal` on every keystroke.

And `getScaleLockedKeyboardNotes(...)` at `:1462` — the *rows* variant, a
different function from the flat one used in the handlers — is called fresh in
JSX on every render, while its sibling `chordKeyboardRows` (`:348`) is already
`useMemo`'d. That inconsistency is worth closing too.

The file already carries the right tool: `arpStateRef` (`:238`), a ref
refreshed by an unconditional `useEffect` (`:244-251`) holding
`{ activeNotes, params, controlTarget, bpm }`. Reading `params` from it is
equivalent to closing over `keyboardParams`, because the refresh effect runs
after every commit and DOM event handlers only fire after a commit.

This is the highest-risk finding in the audit. The file has load-bearing
comments about voice stranding, `KEYBOARD_AUDITION_TARGET`, and the
mode-change release effect at `:334`, whose cleanup deliberately calls
`handleNoteOffRef.current` (a ref refreshed in the same after-commit position,
so it too sees the previous commit's params — behaviour that must not change).

### F7 — `AudioVisualizer` reads frequency data the oscilloscope never uses

`src/components/AudioVisualizer.tsx:207-208` calls both
`analyser.getByteFrequencyData(freqData)` and
`analyser.getByteTimeDomainData(timeData)` on every frame, then loops
`bufferLength` times for `avgEnergy` (`:212-215`) and `timeData.length` times
for `maxDeviation` (`:217-221`).

`mode === 'oscilloscope'` (`:235`) passes only `timeData` to
`renderOscilloscope`. The frequency read and the `avgEnergy` loop are pure
waste there — and the oscilloscope is used as an inline scope in `SynthView`,
so multiple instances can be live simultaneously.

`isSounding = avgEnergy > 2.5 && maxDeviation > 3` (`:224`). The comment says
the pair exists to "filter out digital silence & DC bias". A constant DC offset
is a *steady* offset from 128 in the time domain, so `maxDeviation > 3` does
catch it on its own — but the two tests are not equivalent in every case: a
very slow sub-audio LFO sweep produces a large `maxDeviation` while
`avgEnergy` stays near zero, and today's test rejects it.

**Conclusion:** do not change `isSounding` globally. Keep the two-term test for
`bars` and `wave` (which already need `freqData` anyway), and use the
time-domain-only test in the `oscilloscope` branch, where nothing else consumes
frequency data. Behaviour for the spectrum modes is then bit-identical.

Everything else in this file is already carefully optimized — buffer reuse
keyed on `frequencyBinCount` / `fftSize`, a cached theme palette, a `paused`
gate, and an imperative indicator update through a ref that skips React
entirely. Do not touch any of it.

### F8 — One 498 kB chunk, and a dependency nobody imports

- No `manualChunks` in `vite.config.ts`, so `tonal`, `@dnd-kit` and
  `lucide-react` are inlined with app code and every app edit invalidates them
  in the browser cache.
- The three preset drawers — `SynthPresetLibrary` (441 lines),
  `ChordPresetLibrary` (525 lines) and the shared `ui/PresetLibrary` (520
  lines) they both wrap — are in the first-paint bundle although
  `PresetLibrary` early-returns `null` when closed.
- `motion` (framer-motion v13) sits in `dependencies` with **zero** imports
  anywhere in `src/` or `scripts/` (verified by grep).

Blocker for the lazy split: `ChordView.tsx:70` imports `isProgressionAvailable`
*and* the component from `./ChordPresetLibrary`, so a `React.lazy` on the
component alone would not split anything — the static import keeps the module
in the main chunk. `isProgressionAvailable` (`ChordPresetLibrary.tsx:62`) must
move to its own module first.

Fold-in: `filterEntries` in `SynthPresetLibrary.tsx:117` is a fresh function
identity every render, and it is in the dep array of the `filtered` `useMemo`
in `ui/PresetLibrary.tsx:110-119`, so that memo never hits.

## 3. Explicitly out of scope — do not change

- **The 131 atomic `useAppStore` selectors are correct.** Do not convert them to
  object selectors + `useShallow`. Atomic selectors are the cheapest possible
  subscription; batching them behind a shallow-compared object would make every
  component wake on more writes, not fewer. That is a regression.
- **`AmbientBackdrop`'s deliberate non-scaling by `devicePixelRatio`** is
  correct and documented in the file. Leave it.
- **All four views stay mounted in `App.tsx`.** Making them conditional would
  stop audio when switching tabs. That is the whole reason for the
  `block`/`hidden` toggle.
- **`usePlayheadSync` writing once per beat, not once per 16th step**, is
  already the right granularity. Do not increase its resolution.
- **`AudioVisualizer`'s buffer reuse, palette cache, `paused` gate and
  imperative indicator** stay exactly as they are (see F7).

## 4. Testing reality this audit must respect

- Runner is `bun test` (`bun:test`). There is no jest, no vitest, no
  testing-library, and no DOM.
- Components *can* be rendered to a string via `react-dom/server`'s
  `renderToString` — `SynthPresetLibrary.test.tsx` and
  `ChordPresetLibrary.test.tsx` already do — but there is **no way to observe or
  count re-renders**. No finding here may be validated by a render-count test.
- The convention is pure-logic tests over exported helpers. Only F3 creates
  genuinely new pure logic worth a full TDD cycle (`vuSegment` /
  `isSegmentActive`). F1 would have needed a local `shallowEqual` with its own
  test, but `zustand/shallow` resolves, so no new logic is introduced there.
- For the pure refactors (F2, F4, F5, F6, F7, F8) the gate is `bun run verify`
  staying green plus explicit reasoning that behaviour is unchanged. Inventing
  a test there would be theatre.

## 5. Gates

- `bun run verify` = `bun test && bun run lint && bun run check:keys && bun run check:drums && bun run build`.
- `bun run eslint` is **not** in `verify`. Any change that moves or adds an
  import must run it separately. The import-layering rules live there
  (`eslint.config.js`), including the `components/` -> `audio/engine` ban whose
  exemption is the final config block, a literal `files: [...]` array listing
  `src/components/AudioVisualizer.tsx`, `src/components/TransportBar.tsx`,
  `src/components/ui/AmbientBackdrop.tsx`, `**/*.test.ts`, `**/*.test.tsx` with
  `rules: { 'no-restricted-imports': 'off' }`.
- `scripts/themeTokenGuard.ts` runs inside `bun test`. Its `ALLOWLIST` is empty
  and must stay empty. Any new markup uses daisyUI semantic tokens only.
- There is no `tailwind.config.*` and none may be added.

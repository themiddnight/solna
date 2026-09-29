# Markov chord dice ("Roll") — design

Status: design approved in conversation; this written spec awaits review before the implementation plan.
Branch `feat/markov-chord-progression`.

## Goal and success criteria

A **Roll** button in the Chord progression view (`ChordView` → `ProgressionCard`) replaces the
active loop's progression with a newly generated one, in the loop's key and scale, from a
first-order Markov chain over root motion.

Done when:

- One click produces a musically plausible, loop-closing progression that differs from the current
  one, for every key in `SCALES`, with and without 7ths, with and without borrowed chords.
- The roll writes through the same path as a library apply, so playback, the custom lanes and the
  reharmonize badge behave exactly as they do for a library apply.
- A single-level Undo snackbar restores the exact pre-roll progression and custom lanes.
- `bun run verify` is green; `bun run eslint` reports zero errors and zero warnings; both Knip scans
  hold their zero-finding baseline.

## User-facing behavior

- **Roll** (`#btn-roll-progression`) generates a whole new progression and replaces the current one.
  Mode is whole-progression only — no next-chord suggestion, no chord lock (lock is a future
  extension).
- **Structure.** By default the roll keeps the current chord count and each chord's `bars`. An empty
  loop rolls 4 chords × 1 bar. The options popup overrides this: **Chords** = Keep | 2 | 3 | 4 | 6 |
  8; **Bars per chord** = 1 | 2 | 4, hidden while Chords is Keep.
- **Quality.** Diatonic chords take the degree's own quality, as triads or 7ths following the
  existing Quick Add "7ths" toggle (`use7thsInQuickAdd`). The **Borrowed** toggle (`allowBorrowed`)
  adds the scale's `getBorrowedChords()` list, each with the list's own quality (the 7ths toggle
  does not apply to it). The toggle is disabled, with a hint, when that list is empty.
- **Start chord** is automatic (no picker): see the function table under Algorithm.
- **Undo.** A snackbar `Rolled <roman>` with an Undo button (`btn-undo-roll-progression`). Single
  level, session only; a new roll replaces the pending undo.
- **Playback.** Rolling while playing swaps the chords live, the same as a library apply.
- **Length side effects.** When the chord count or bars change the loop length, the effects on the
  loop length, the lead melody and the pattern bar options are exactly those of a library apply —
  no special handling.
- The options (Chords, Bars per chord, Borrowed) are local state: they persist for the session
  because views stay mounted (R014), reset on a layout switch (R316) and on reload, and are never
  persisted.

## Architecture and files

| Path | Change |
|---|---|
| `src/components/loop/chord/markovProgression.ts` | **New.** Pure: no React, no store. `generateProgression`, `resolveBars`, the weight constants. |
| `src/components/loop/chord/markovProgression.test.ts` | **New.** Seeded exhaustive + statistical tests. |
| `src/components/loop/chord/useProgressionDice.ts` | **New.** Options state, `roll()`, the Undo offer. |
| `src/components/loop/chord/ProgressionCard.tsx` | `ProgressionActions` gains the Roll split button and its popup. |
| `src/components/loop/ChordView.tsx` | Calls `useProgressionDice(use7thsInQuickAdd, clearReharmonizeBadge)` and passes the result down. |
| `src/store/chordsSlice.ts`, `src/store/types.ts` | New action `restoreChordsSnapshot` and the `ChordsSnapshot` type. |
| `src/components/useLoopUndo.ts` (+ `.test.ts`) | **Moved** from `src/components/song/`; importers updated. |

Placement follows R276: the generator and the hook serve one feature, so they stay in
`loop/chord/`; lift `markovProgression.ts` to `src/utils/` only when a second area uses it.
`useLoopUndo` is now used by two areas (Arrange and the chord view), so it lifts to the
`src/components/` root, which `.claude/rules/components.md` names as the shared location for hooks.
Its install-dismiss behavior (`subscribeLoopUndoDismissOnInstall`) moves unchanged; importers to
update are `song/ArrangeView.tsx`, `song/ArrangeView.test.tsx` and `song/useLoopKeyChangeUndo.ts`.

### `markovProgression.ts`

```ts
interface ProgressionInput {
  scaleRoot: string; scaleType: string; use7ths: boolean; allowBorrowed: boolean;
  bars: number[];          // one entry per chord to generate; length = chord count
  current: ChordItem[];    // for the "differs from current" constraint
}
generateProgression(input: ProgressionInput, rng: () => number): { chords: ChordItem[]; roman: string }
resolveBars(chordCount: 'keep' | 2 | 3 | 4 | 6 | 8, barsPerChord: 1 | 2 | 4, current: ChordItem[]): number[]
```

- `rng` is injected; the call site passes `Math.random`. The `Math.random` ban in
  `eslint.config.js` covers `src/audio/` only, so a component may pass it.
- `resolveBars`: `keep` → `current.map(c => c.bars)`, or `[1, 1, 1, 1]` when `current` is empty;
  otherwise `Array(chordCount).fill(barsPerChord)`.
- Generated chords carry no `bassNote` (auto root) and placeholder ids; the hook re-ids them.

### `useProgressionDice.ts`

- Takes `use7ths` (ChordView's `use7thsInQuickAdd`, which is local state in `useProgressionEditor`)
  and `clearReharmonizeBadge`.
- Local state: `chordCount` (default `'keep'`), `barsPerChord` (default `1`), `allowBorrowed`
  (default `false`); `borrowedAvailable` derived from `getBorrowedChords(scaleRoot, scaleType)`.
- `roll()` reads live `useAppStore.getState()` (`chords`, `scaleRoot`, `scaleType`, `activeLoopId`
  and the six custom-lane fields), captures the snapshot, calls `generateProgression(…, Math.random)`,
  writes `setChords(chords.map((c, i) => ({ ...c, id: \`roll-chord-${Date.now()}-${i}\` })))`
  (the `handleApplyLibraryChords` re-id pattern), calls `clearReharmonizeBadge()`, then
  `offer(snapshot)` through `useLoopUndo`.

## Algorithm

**States.** Let `harmony = scaleEntry(harmonyKey(scaleType))` and `n = harmony.intervals.length`.
Every `SCALES` key resolves to a harmony scale of 5, 6 or 7 degrees (verified). Each degree `d` in
`0..n-1` is a state `{ root, quality, semi: harmony.intervals[d], borrowed: false, roman }`, built
with `getDiatonicChordForDegree(d, scaleRoot, scaleType, use7ths)` — which resolves the quality via
`resolveDegreeQuality` and the numeral via `degreeToRoman`. When `allowBorrowed`, each
`getBorrowedChords(scaleRoot, scaleType)` entry adds `{ root, quality, semi: (rootSemitone(root) −
rootSemitone(scaleRoot)) mod 12, borrowed: true, roman: label }`, dropped if a diatonic state already
has the same root and quality (the list already filters these; the dedupe is a guard).

**Transition weight**, for `a ≠ b` (self-transitions weigh 0):

```
w(a→b) = M[(b.semi − a.semi) mod 12] × Q[b.quality] × (b.borrowed ? 0.15 : 1) × (b.semi === 0 && !b.borrowed ? 1.3 : 1)
```

Rows are normalized when sampling.

- **M**, by ascending semitone interval: 0→0, 1→0.3, 2→0.7, 3→0.5, 4→0.4, 5→1.0, 6→0.1, 7→0.6,
  8→0.6, 9→0.8, 10→0.6, 11→0.3.
- **Q**, by quality family:
  - 1.0 — major and minor families: `maj`, `min`, `maj7`, `min7`, `7`, `minMaj7`.
  - 0.25 — diminished/half-diminished: the registry category `diminished-half-diminished` =
    `dim`, `m7b5`, `dim7`.
  - 0.15 — augmented: `aug`, `maj7#5`.
  - The augmented set is keyed on tokens, not on a category: the registry puts `aug` in category
    `altered`, but `altered` also holds `minMaj7`, the 7ths tonic of Harmonic Minor, Melodic Minor
    and several of their modes, so weighting by category would suppress the tonic. The mapping is
    a total function over every quality `resolveDegreeQuality` can emit (maj/min/dim/aug and
    maj7/7/min7/m7b5/dim7/minMaj7/maj7#5) and over the borrowed lists' qualities (`maj`, `min`,
    `m7b5`); a test pins that every such quality lands in exactly one bucket.

**Start chord.** Functions by root semitone from the tonic: T = 0 (0.5), S = 5 (0.2), D = 7 (0.15),
subtonic = 10 (0.15). A function is eligible when some state has that `semi` and a quality outside
the diminished and augmented sets above; the subtonic may be the borrowed ♭VII when borrowed is on.
Renormalize over eligible functions; within a function, pick among its eligible states in
proportion to `Q × borrowedFactor`. If no function is eligible, start on the tonic state.

**Hard constraints** on the whole sequence of length `n`:

1. No immediate repeat, including last→first, when `n ≥ 2`.
2. Closure: `M[(first.semi − last.semi) mod 12] ≥ 0.4` when `n ≥ 2`.
3. The tonic (diatonic degree 0) appears when `n ≥ 3`.
4. Borrowed chords ≤ `ceil(n/4)`, never adjacent, including the wrap.
5. The root+quality sequence differs from `current`.

**Sampling.** Draw the start, then walk the chain `n − 1` steps. Reject and redraw if any
constraint fails, up to 50 attempts. Fallback: the latest attempt that passes 1–4, else the last
attempt. Never throws, never returns an empty progression.

**Output.** `chords[i] = { id, root, quality, bars: input.bars[i] }`. `roman` = the states' `roman`
strings joined with "–" (diatonic via `degreeToRoman`, borrowed via the list's `label`).

The weights are starting values; their final values come from the listening review in
`CONTRIBUTING.md`.

## Undo

- `ChordsSnapshot = { loopId, chords, customChordRhythm, customChordHoldSteps,
  customChordLoopLength, customBassPattern, customBassHoldSteps, customBassLoopLength }` — the six
  custom-lane fields `chordsPatch` re-clamps, because a roll that changes chord boundaries rewrites
  them.
- `restoreChordsSnapshot(snapshot)` in `chordsSlice`: one `set()` that writes the seven fields back
  verbatim when `state.activeLoopId === snapshot.loopId`, and writes nothing otherwise. The active
  loop is read from the store's `activeLoopId` field (`AppStore`, `src/store/types.ts`).
- Offered through the moved `useLoopUndo(restore, 'btn-undo-roll-progression', messageOf)` with
  module-level `restore`/`messageOf` (its stability contract). Message: `Rolled <roman>`. The
  snackbar's action window is the feedback host's standard action duration (`feedbackDurationMs`).
- Single level and session only; a new roll replaces the pending undo (same key); a project install
  dismisses it (`projectInstallCount` subscription); a changed active loop makes it a no-op. Undo
  restores the snapshot regardless of edits made after the roll.

## UI

- A daisyUI `join` split button in `ProgressionActions`, beside Re-harmonize:
  - Main: `#btn-roll-progression`, lucide `Dices` icon, label "Roll" (`hidden sm:inline`, icon only
    below `sm`, like its neighbors), `aria-label="Roll progression"`.
  - Caret: `#btn-roll-progression-options`, `aria-haspopup="dialog"`, `aria-expanded`, opens a
    `ui/Popup` (overlay kind **popup**, R325) built on `usePopup`.
- Popup contents: **Chords** segmented control (Keep | 2 | 3 | 4 | 6 | 8); **Bars per chord**
  (1 | 2 | 4, hidden while Keep); **Borrowed** toggle (disabled with a hint when unavailable); a note
  "7ths follow Quick Add"; a **Roll** button that rolls with these options.
- Verify every daisyUI class against the v5 docs before writing it.

## Testing

- `markovProgression.test.ts`, seeded rng (a small deterministic PRNG in the test):
  - Every `SCALES` key × `use7ths` × `allowBorrowed` × lengths {1, 2, 3, 4, 6, 8} × several seeds:
    no throw; chord count and `bars` match the input; every chord is a valid state; constraints 1–4
    hold wherever satisfiable; the first chord is in the eligible start set; no borrowed chord when
    `allowBorrowed` is off.
  - Q mapping totality: every quality `resolveDegreeQuality` emits across `SCALES`, and every
    borrowed quality, maps to exactly one Q bucket.
  - Statistical, C Major, triads, borrowed off, 4 chords, 500 rolls from a fixed seed: at least 60
    distinct progressions; tonic-start share in [0.40, 0.75]; at least 95% differ from `current`.
    These thresholds are provisional and are confirmed empirically in the plan before they are
    pinned.
- `resolveBars` unit test (keep, keep on empty, each count × bars).
- `restoreChordsSnapshot`: exact restore of all seven fields; no-op when `activeLoopId` differs.
- Moved `useLoopUndo` tests run from the new location; `ArrangeView.test.tsx` imports updated.
- Component tests mind the `renderToString` trap (R257): state set before a render reaches only
  components that read the store the way `ui/BottomInputDock.tsx` does.
- Browser preview check: roll, the options popup, undo, and the mobile frame.
- Gate: `bun run verify`; `bun run eslint` 0 errors / 0 warnings; both Knip scans clean.

## Docs

- **ADR `docs/decisions/0058-markov-chord-dice.md`**: the root-motion model and rejection sampling.
  Rejected alternatives: per-tonality degree matrices (wrong for modes such as Lydian, Mixolydian
  and Harmonic Major, and each table needs its own borrowed row); learning from the chord library
  (sparse, biased to Major/minor, reproduces entries verbatim); unconstrained Markov (no loop
  closure or cadence). Add it to the index in `docs/decisions/README.md`.
- **Rules**, new lines in `.claude/rules/music-domain.md` (plus matching `## Prohibited` items),
  pointing at ADR-0058:
  - R361 — the progression generator is pure (no React, no store) and takes its randomness as an
    injected `rng`.
  - R362 — a roll writes through the library-apply path: `setChords` with fresh ids, then
    `clearReharmonizeBadge()`.
  - R363 — the roll's undo snapshot includes the six custom-lane fields beside `chords`, restored
    in one `set()` and only on the loop it was taken from.
- No `paths:` change: `music-domain.md` already covers `src/components/loop/chord/**`.
- No CLAUDE.md change: no new rules file.

## Out of scope

Second-order chains, genre-specific weights, a user-supplied seed, chord lock, a start-chord picker,
persisting the dice options.

## Verification notes

- All referenced symbols exist: `resolveDegreeQuality`, `getDiatonicChordForDegree`,
  `getBorrowedChords`, `degreeToRoman`, `rootSemitone` (`src/utils/musicTheory.ts`); `harmonyKey`,
  `scaleEntry` (`@/musicCore`); `chordsPatch`, `setChords` (`src/store/chordsSlice.ts`);
  `handleApplyLibraryChords`, `clearReharmonizeBadge`, `use7thsInQuickAdd`
  (`src/components/loop/chord/useChordView.ts`); `ProgressionActions`
  (`ProgressionCard.tsx`); `useLoopUndo`, `buildLoopUndoRequest` (`src/components/song/useLoopUndo.ts`);
  `ui/Popup`, `ui/usePopup`; `FeedbackRequest.action` (`src/store/feedback.ts`).
- **Mismatch — Q by category.** `aug` is in category `altered`, which also contains `minMaj7`
  (a tonic in Harmonic/Melodic Minor with 7ths) and `maj7#5`. The augmented bucket is therefore
  keyed on the tokens `aug` and `maj7#5`; only the diminished bucket maps cleanly by category. The
  category type is unexported and documented as read only by `shouldPreserveQualityOnSnap`, another
  reason not to branch on it here.
- `ChordView` lives at `src/components/loop/ChordView.tsx`, not under `loop/chord/`.
- `use7thsInQuickAdd` is local state inside `useProgressionEditor`, not store state — hence the hook
  parameter.
- The borrowed list is non-empty for every current `SCALES` key (1–6 entries), so the disabled
  Borrowed state is a guard no scale reaches today.
- Locrian, Locrian #2/Diminished (dim tonic) and Lydian Augmented/Whole Tone (aug tonic) have an
  ineligible T function; S/D/subtonic cover them. The "start on the tonic if nothing is eligible"
  fallback and the within-function split are gap-fills, not changes to approved decisions.
- `degreeToRoman` writes flats as ASCII `b` (`bVII`), while borrowed labels use `♭` (`♭VII`). The
  snackbar reuses both as-is, matching the in-scale palette and borrowed badges today; normalizing
  the glyph is a separate change.
- Next free ids: ADR 0058 (highest existing is 0057); rule ids R361–R363 (highest is R360).

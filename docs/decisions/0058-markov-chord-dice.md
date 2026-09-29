# ADR-0058: Markov chord dice

**Status:** Accepted — 2026-09-29. No issue.

## Context

The chord view could fill a progression from the library or one chord at a time from the Quick Add
palette, but it had no way to propose a whole new progression in the loop's key. A roll has to work
in every `SCALES` key: seven-degree modes, the five- and six-degree scales with a `parent`, the
harmony scales of ADR-0057, and the scales whose tonic is diminished (Locrian, Locrian #2,
Diminished) or augmented (Lydian Augmented, Whole Tone). It has to loop cleanly, because a
progression in Solna always repeats, and it has to be undoable, because it replaces the user's
chords and the custom chord and bass lanes that `chordsPatch` re-clamps against them.

## Decision

- **A Random split button** (the Beat grid's `Random` label and `Shuffle` icon, for consistency)
  in the progression card (`ProgressionActions` → `loop/chord/RollProgressionButton.tsx`), after
  Add Chord and before a divider and the Re-harmonize pair, replaces the active loop's progression. Its caret opens a
  `ui/Popup` with Chords (Keep | 2 | 3 | 4 | 6 | 8), Bars per chord (1 | 2 | 4, hidden while Keep)
  and a Borrowed toggle. The options are local state in `loop/chord/useProgressionDice.ts`,
  never persisted. The 7ths choice is Quick Add's own toggle.
- **The generator** is `loop/chord/markovProgression.ts`: pure, no React and no store, with its
  randomness injected as `rng` (the call site passes `Math.random`; tests pass a seeded
  `mulberry32`). It is a first-order Markov chain over **root motion**:
  - States are the degrees of the harmony scale (`scaleEntry(harmonyKey(scaleType))`, R358), each
    with the degree's own quality as a triad or a 7th, plus, when Borrowed is on, the scale's
    `getBorrowedChords()` list with that list's own quality.
  - `w(a→b) = M[(b.semi − a.semi) mod 12] × Q[b.quality] × (b borrowed ? 0.15 : 1) × (b is the
    diatonic tonic ? 1.3 : 1)`. `M` favours a fourth up, then a sixth, a second and a fifth; `Q`
    is 1 for the major and minor families, 0.25 for diminished and half-diminished, 0.15 for
    augmented. `Q` is keyed on quality **tokens**, not on the registry's reharmonization category:
    category `altered` holds `aug` and also `minMaj7`, the 7ths tonic of Harmonic and Melodic
    Minor. The token map is a `Record` over `ChordQuality`, so a new registry token does not
    compile until it is bucketed.
  - The start is drawn by function (T, S, D, subtonic) among states of stable quality; a scale with
    none of those starts on its tonic.
  - **Rejection sampling** against five hard constraints: no immediate repeat (wrap included); a
    closing last→first motion with `M ≥ 0.4`; the tonic present from three chords up; at most
    `ceil(n/4)` borrowed chords, never adjacent; and a result that differs from the current
    progression. After the attempt budget it falls back to the latest attempt that passed the
    first four, else the last attempt. It never throws and never returns an empty progression.
  - The attempt budget is 500, not the 50 first considered: measured over 2 000 rolls, 50
    left up to 6.5% of rolls in Lydian Augmented and Whole Tone with Borrowed on without a tonic or
    a closing motion; 500 left none.
- **A roll writes through the library-apply path**: `setChords` with fresh ids, then
  `clearReharmonizeBadge()`. Playback, the custom lanes, the loop length and the badge therefore
  behave exactly as they do for a library apply.
- **Undo** is a single-level snackbar through `useLoopUndo` (lifted from `song/` to the
  `src/components/` root now that two areas use it), key `btn-undo-roll-progression`, message
  `Randomized <roman>`. Its payload is a `ChordsSnapshot`: `chords` plus the six custom-lane fields,
  and the `loopId`, `scaleRoot`, `scaleType` and `meterId` it was taken under.
  `restoreChordsSnapshot` writes the seven fields back in one `set()` only while all four still
  match; otherwise it is a no-op. The key, scale and meter guard goes beyond the design, which
  guarded the loop only: without it an Undo after a key change would put old-key chords into the
  new key, and one after a meter change would put back holds clamped against another bar length.

Rejected:

- **Per-tonality degree matrices** (a Major table, a minor table). They are wrong for modes such as
  Lydian, Mixolydian and Harmonic Major, whose degrees move differently, and every table needs its
  own borrowed row. Root motion is the same fact in every scale.
- **Learning the chain from the chord library.** The library is sparse and biased to Major and
  minor, and a chain learned from it reproduces its entries verbatim.
- **An unconstrained Markov walk.** It neither closes the loop nor reliably reaches the tonic.

## Consequences

- The weights are starting values; the listening review in `CONTRIBUTING.md` tunes them. The
  constraints, not the weights, carry the guarantees, and the seeded tests pin the constraints.
- Rejection skews the start: the tonic leads about 62–66% of C Major four-chord rolls, not the
  ~41% its start weight (0.35 of 0.85) alone would give, because tonic-led attempts pass the tonic
  constraint more often; a rolled share near 50% needs a tonic weight near 0.2. A later tuning of
  the start weights has to measure the rolled share, not read the table.
- A roll's numerals come from `degreeToRoman` (ASCII `b`) and the borrowed labels (`♭`), so the
  snackbar mixes the two glyphs, as the in-scale palette and borrowed badges already do.
- Undo restores the snapshot regardless of edits made after the roll, as long as the loop, key,
  scale and meter are unchanged.
- Out of scope: second-order chains, genre weights, a user seed, chord lock, a start-chord picker
  and persisting the options.

## Rules this implies

- **R361** — The progression generator is pure (no React, no store) and takes its randomness as an
  injected `rng`.
- **R362** — A roll writes through the library-apply path: `setChords` with fresh ids, then
  `clearReharmonizeBadge()`.
- **R363** — A roll's Undo snapshot holds the six custom-lane fields beside `chords`; it is restored
  in one `set()` and only onto the loop, key, scale and meter it was taken under.

## Sources

Spec: [`docs/superpowers/specs/2026-09-29-markov-chord-dice-design.md`](../superpowers/specs/2026-09-29-markov-chord-dice-design.md)
(commit `ba23dca6`). Plan: `docs/superpowers/plans/2026-09-29-markov-chord-dice.md`.

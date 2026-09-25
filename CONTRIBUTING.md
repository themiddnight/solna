# Contributing to Solna

Thanks for helping. The easiest way in is **content**: a synth preset, a chord progression, a chord
rhythm, a bass pattern, a Beat preset, a drum grid. Each one is a single entry in a table under
`src/data/`, and the repo's own checks tell you whether the entry is valid before anyone reads it.

Code changes are welcome too. For anything bigger than a small fix, open an issue first so we can
agree on the approach before you write it.

## Licence of your contribution

Solna is licensed under the [Apache License 2.0](LICENSE). Under section 5 of that license, anything
you submit in a pull request is licensed under the same terms. There is no CLA to sign.

The **Solna** and **murva** names and the Solna logo and icons are trademarks and are not part of that
license. See [TRADEMARKS.md](TRADEMARKS.md). A contribution to this repository never needs them.

## Set up

```bash
bun install
bun run dev              # http://localhost:3000
bun run check:content    # the content-library checks, in a few seconds
bun run verify           # the full gate: what CI runs
```

## Pull requests

1. Fork the repo and create a branch named `<type>/<short-kebab-summary>`. The type is the
   conventional-commit type your change lands as: `feat`, `fix`, `refactor`, `docs` or `chore`.
   Example: `feat/lofi-rhodes-preset`. Maintainers add a Linear issue code after the type. You don't
   need one.
2. Write commit messages in the same conventional-commit form: `feat(presets): add Lo-Fi Rhodes`.
3. Run `bun run verify` and fix everything it reports. CI runs the same command on your pull request,
   so a green run locally is a green run in CI.
4. Open the pull request and fill in the template. For content, the template asks what the addition
   sounds like and what it is for. That answer is what the listening review below checks against.

`bun run eslint` must print **zero warnings**, not just zero errors. If a warning is a legitimate
exception, disable it on that line with a reason:
`// eslint-disable-next-line <rule> -- <why this site is fine>`.

## The `src/data/` rules

Every file in `src/data/` is plain data. ESLint enforces this, and `src/data/dataLayerPurity.test.ts`
keeps the enforcement honest:

- **No runtime imports**, not even from a sibling file in `src/data/`. `import type` is fine.
- **No impure globals**: no `Math`, `Date` or `crypto`. Every value is written out.
- **No `function` declarations, no `new`, no module-scope `let` or `var`.**
- A small `const` arrow helper that is shorthand for an object literal, like `step()` in
  `chordProgressions.ts`, is allowed only in the same file as the table it builds.

If you need a value computed, compute it yourself and write the number in. If a rule really cannot be
expressed as a literal, open an issue: the table may be the wrong home for it.

## Adding content

Some tests pin the **exact list of ids** in a table on purpose. When you add an entry, that test
fails until you add your id to its list. That is expected: the edit shows a reviewer that the addition
was intentional. Every other failure means the entry breaks a rule, and the test name says which.

Library ids are the contract other code uses to reach an entry. Once an entry is merged, never rename
its id. Renaming a display `name` is fine.

### Synth preset (`src/data/synthPresets.ts`)

- Append one `SYNTH_PRESETS` entry with a unique `factory-<name>` id and a unique name. The patch
  must be a **complete** subtractive patch: every field is stated, nothing is inherited from a
  default.
- Pick a `category` (not `User`) and at least one tag from `SYNTH_TAGS`. The voice, sub and noise tags
  must match what the patch actually does.
- The second oscillator is authored: state what it is for (detune partner, octave, fifth, overtone).
- **Levels are measured, not set by ear.** Start with `common.outputGainDb: 0`, run
  `bun run calibration:generate` (it needs `ffmpeg` and takes a few minutes), then set
  `outputGainDb` to the trim it measured for your preset, rounded to a whole dB. `bun run check:levels` fails until the
  preset has a calibrated entry in `src/data/trimTable.ts`. See `scripts/calibration/README.md`.
- Tests: `src/data/synthPresets.test.ts`, `src/utils/synthPresets.test.ts`, `check:levels`.

### Chord progression (`src/data/chordProgressions.ts`)

- Append one entry: unique `id` and `name`, a `roman` summary that matches the steps, a
  `description`, a `category`, and the `referenceScale` (a key of `SCALES`) the degrees were written
  against. `minScaleLength` is that scale's length.
- Steps are scale **degrees** (0-based), not note names. Leaving out `quality` means the scale's own
  **triad** for that degree, never the seventh. Genres built on extended harmony write their
  qualities out.
- Tests: `src/audio/chordProgressions.test.ts`, `src/data/libraryEntries.test.ts`.

### Chord rhythm (`src/data/chordRhythms.ts`)

- Append one `CHORD_RHYTHMS` entry with a unique `id` and `name`, a `style` (its dropdown group), a
  `description` and the `meter` it is written in. Build hits with the `block()` and `strum()` helpers
  at the top of the file.
- Every hit, and every hold, stays inside one bar of the pattern's own meter.
- Tests: `src/audio/chordRhythms.test.ts` (add your `[id, meter]` to its list),
  `src/data/libraryEntries.test.ts`.

### Bass pattern (`src/data/bassPatterns.ts`)

- Append one `BASS_PATTERNS` entry. A step names a **chord tone or an approach** (`root`, `fifth`,
  `approachChromaticBelow`, and so on), never a pitch. The chord it plays over supplies the pitch.
- Same entry fields and bar rules as a chord rhythm.
- Tests: `src/audio/bassPatterns.test.ts` (add your `[id, meter]` to its list),
  `src/data/libraryEntries.test.ts`.

### Beat preset, a drum kit (`src/data/beatPresets.ts`)

- Append one `BEAT_PRESETS` entry with a stable id. The patch is **complete**: every one of the
  eleven voices, with every numeric parameter stated, and an explicit kick click (`clickLevel: 0`
  when there is none).
- It must sound **different** from the other kits. `bun run check:drums` fails when a voice is
  copied from the default kit, or when the catalogue loses its spread. Retune the kit. Never relax the
  check's thresholds.
- Calibrate it the same way as a synth preset (`calibration:generate`, then `check:levels`).
- Tests: `src/data/beatPresets.test.ts` (add the id to its list), `check:drums`, `check:levels`.

### Drum grid (`src/data/drumGrids.ts`)

- Add one `DRUM_GRIDS` entry: a display `name`, the `meter`, the `beatPresetId` it was written on,
  its `provenance`, and `rows`.
- Every row is named after a real voice (`kick`, `snare`, `rimshot`, `clap`, `hihat`, `openhat`,
  `hitom`, `lowtom`, `ride`, `crash`, `bell`) and is exactly one bar long in its meter: 16 steps in
  4/4, 12 in 3/4 and 6/8. You may leave a row out, but a row of `false` says "this genre plays
  nothing here" more clearly.
- **Provenance is honest.** Give a source URL that actually documents the rhythm, or the literal
  `'authored'` and add the id to the authored allowlist in `drumGrids.test.ts`. Never cite a
  loosely related page to avoid that list.
- A hi-hat is never open and closed on the same step.
- Tests: `src/data/drumGrids.test.ts` (add the id to its list).

### Instant Vibe (`src/data/vibes.ts`)

A vibe is a card in the Vibes picker, built entirely from library ids: a progression, a chord rhythm,
a bass pattern, a drum grid, an effect chain, a Beat preset and synth presets. Vibe ids are saved
in users' projects, and a vibe carries golden-fixture tests. **Open an issue before you add one.**

- Every id it names must already exist in its library.
- Its dice pools (`random`) are written out explicitly and always include the vibe's own values.
- Tests: `src/store/vibes.test.ts`, `src/store/vibeVariation.test.ts`,
  `src/store/instantVibes*.test.ts`, `src/data/vibes.test.ts`.

`bun run report:library` lists library entries that no vibe uses. It is a report, not a check. An
unused entry is fine, since it still appears in its own browser or dropdown.

## Listening review

A test can prove an entry is well-formed. It cannot prove it sounds good. So every pull request that
adds or changes content gets a **listening review** before it merges:

- **Who:** the maintainer ([@themiddnight](https://github.com/themiddnight)).
- **Against what:** your description in the pull request template, meaning what the addition should
  sound like and what it is for. The maintainer loads it in the app, in the context the template
  describes: a preset on a track, a rhythm or pattern under a progression, a grid on the Beat
  preset it names.
- **Checked for:**
  - it is audible and sits at a sensible level against the factory content around it
  - it is in the right register for its role
  - it sounds like the genre or use it claims
  - it is distinct from what the library already has
- **When:** after CI is green, before merge. The reviewer may ask for changes. A clearly described
  sound is much easier to review than "a nice pad".

CI never judges taste. What is objectively checkable is a test. Everything else is this review.

## Code changes

The architecture is documented for both people and agents:

- [`CLAUDE.md`](CLAUDE.md): commands, the completion gate, the layer map and the invariants that
  apply everywhere
- `.claude/rules/*.md`: the detailed rules for each area of the code
- [`docs/decisions/`](docs/decisions/README.md): why each rule exists and which alternatives were
  rejected

The import layers (`data` → `audio` → `store` → `components`) are enforced by ESLint. If a lint
error blocks an import, the fix is almost always to move the code, not to change the rule.

# Scale library: 24 tonal-derived scales with descriptions — design

Sub-project 1 of 4 in the scale-select work. The others, each with its own spec:
(2) `ui/Popup` + `ui/Listbox` + a scale-type listbox that shows these descriptions;
(3) migrate the dock menus, `ProjectMenu` and `QuickSavePopover` onto `ui/Popup`;
(4) move `ThemePicker`'s body onto `ui/Listbox`.

## Goal

Grow the scale library from 11 to the 24 of murva's 32 scales that the existing harmony
derivation supports. Each scale gets a one-line description. Its intervals are derived from
`tonal` instead of hand-written. Nothing already persisted changes meaning.

## Decisions

- **Intervals are derived, not authored.** `src/data/scales.ts` drops `intervals`. The
  `tonal` field becomes the single source, resolved in `src/musicCore/`. This supersedes
  R061's "intervals is content" rationale. R061 and ADR-0006 are updated in the same change.
- **Descriptions, display names and order come from murva** (`murva-app/shared/src/music/musicUtils.ts`,
  `SUPPORTED_SCALES`). They are authored content, because `tonal` has no mood or genre data.
- **Existing keys are identities and stay.** New keys are readable ASCII, because the header's
  short label renders the key itself (`noteSpelling.ts`, `formatScaleLabel`).
- **8 scales are out of scope** (see the last section). The existing `parent` mechanism cannot
  harmonize them.

## Data shape — `src/data/scales.ts`

```ts
export type ScaleCategory = 'Diatonic' | 'Modes' | 'Pentatonic' | 'Blues' | 'World';

export interface ScaleDefinition {
  name: string;          // display name, murva's label
  description: string;   // murva's description, e.g. 'Minor but hopeful · jazz, funk, soul'
  category: ScaleCategory;
  tonal: string;         // tonal scale name; `Scale.get('C ' + tonal)` spells and measures it
  tonality: 'major' | 'minor';
  parent?: string;       // SCALES key of the 7-note scale whose harmony a sub-7-note scale borrows
}
```

The file still imports nothing at runtime (R020). Key order in `SCALES` is display order, and
keys are grouped contiguously by category.

## Derivation — `src/musicCore/`

- `tonalAdapter.ts` gains `scaleSemitonesForTonal(name): number[]`. It returns the semitone
  offsets of `Scale.get('C ' + name).intervals` and throws on an empty scale.
- `scale.ts` builds `SCALE_LIBRARY: Record<string, ResolvedScale>` once at module load, where
  `ResolvedScale = ScaleDefinition & { readonly intervals: readonly number[] }`.
  - `scaleEntry()` returns a `ResolvedScale`. `resolveScaleKey()` is unchanged, keeping the
    Major fallback.
  - An unresolvable `tonal` name throws at load, so a bad entry fails fast.
- Consumers that read `scaleEntry(x).intervals` do not change. `musicTheory.ts`'s direct
  `SCALES[parentKey].intervals` read (in `parentDegreesFor`) switches to `scaleEntry(parentKey)`.
- Importers that use `SCALES` only for keys and names do not change: `sanitize.ts`,
  `KeyChangeDialog.tsx`, `ScaleMenu.tsx` and `noteSpelling.ts`.

## The 24 scales

Keys in bold are new. `tonal` is the lower-case key unless stated.

| Category | Key → display name | tonal | parent | tonality |
|---|---|---|---|---|
| Diatonic | Major → Major | major | — | major |
| | Natural Minor → Minor (Natural) | aeolian | — | minor |
| | Harmonic Minor → Harmonic Minor | | — | minor |
| | **Melodic Minor** | | — | minor |
| | **Harmonic Major** | | — | major |
| Modes | Dorian → Dorian | | — | minor |
| | Phrygian | | — | minor |
| | Lydian | | — | major |
| | Mixolydian | | — | major |
| | **Locrian** | | — | minor |
| | **Dorian b2** → Dorian ♭2 | dorian b2 | — | minor |
| | **Lydian Dominant** | | — | major |
| | **Lydian Augmented** | | — | major |
| | **Mixolydian b6** → Mixolydian ♭6 | mixolydian b6 | — | major |
| | **Locrian #2** → Locrian ♯2 | locrian #2 | — | minor |
| | **Phrygian Dominant** | | — | major |
| Pentatonic | Major Pentatonic | | Major | major |
| | Minor Pentatonic | | Natural Minor | minor |
| | **Egyptian** | egyptian | Dorian | minor |
| Blues | **Major Blues** | major blues | Major | major |
| | Blues → Minor Blues | blues | Natural Minor | minor |
| World | Hirajoshi → Hirajoshi (Japanese) | | Natural Minor | minor |
| | **Pelog** → Pelog (Indonesian) | pelog | Phrygian | minor |
| | **Vietnamese** | vietnamese 1 | Natural Minor | minor |

Existing display names that change (keys unchanged): `'Major (Ionian)'` → Major,
`'Natural Minor (Aeolian)'` → Minor (Natural), `'Dorian (Funk / Modal)'` → Dorian,
`'Mixolydian (Blues / Rock)'` → Mixolydian, `'Lydian (Bright / Dreamy)'` → Lydian,
`'Phrygian (Flamenco / Dark)'` → Phrygian, `'Blues Scale'` → Minor Blues. The genre hints
those parentheses carried now live in `description`.

Parent choices were verified by a probe that ran `resolveDegreeQuality` over every degree:
- Egyptian→Dorian gives min/min/maj/min/maj. Natural Minor would put a dim chord on degree 2.
- Pelog→Phrygian keeps the ♭2.
- All nine new 7-note modes stack thirds into qualities already in
  `TRIAD_/SEVENTH_QUALITY_BY_INTERVALS`: maj7, 7, min7, m7b5, dim7, minMaj7 and maj7#5.

## UI (interim, until sub-project 2)

- `ScaleMenu` and `KeyChangeDialog` group their native `<select>` options into one
  `<optgroup>` per category. Descriptions are not shown yet.
- `KeyChangeDialog` sits inside a `Modal` and stays a native select after sub-project 2 too.

## Rules and docs

- `.claude/rules/music-domain.md` R061: `SCALES` states `tonal`, `tonality`, `category`,
  `description` and, for scales under seven degrees, a 7-note `parent`. It states neither
  intervals (derived in musicCore) nor chord qualities. Update the Prohibited list to match.
- `docs/decisions/0006-…`: record the move from authored to derived intervals and why (a
  golden pin keeps the legacy 11 stable), and link this spec.
- Fix the stale comments that cite `SCALES[x].intervals` in `chordProgressions.ts` (the
  `minScaleLength` doc) and in `vibes.ts`.

## Testing

- **Golden pin.** The 11 legacy scales' interval arrays, as authored today, move into
  `scales.test.ts` as expected values of the derived intervals. Stored projects must sound
  identical, and a `tonal` upgrade that shifts them must fail.
- **Library invariants**, for every entry:
  - `tonal` resolves.
  - Intervals start at 0, strictly increase, stay below 12 and number 5–7.
  - `parent` is present iff the scale has fewer than 7 degrees, and names a 7-note scale
    that has no parent.
  - `tonality` agrees with the derived third when the scale has one. A scale with no third
    (Egyptian) is `minor`.
  - Categories are contiguous and none is empty.
- **Harmony invariant.** Every scale × every degree × {triad, 7th} resolves through
  `resolveDegreeQuality` without throwing.
- **Sanitize.** New keys are accepted and an unknown key still falls back to Major.
- **Render.** The header scale select and the key-change select render one optgroup per
  category (`renderToString`, mind R257).
- Completion gate: `bun run verify`, and `bun run eslint` with zero errors and zero warnings.

## Unchanged

- The persist version. Keys are additive and validated on read (R035, R214).
- Vibes, progressions, `check:keys` and `check:drums`.
- Progressions with `minScaleLength: 7` become available in every new 7-note mode (e.g. I
  is dim in Locrian). This is the same mechanism Phrygian already uses.

## Out of scope — follow-up

These 8 scales are left out: Whole Tone, Diminished, Bebop (Dominant), Bebop Major,
Bebop Minor, Double Harmonic Major, Hungarian Minor and Flamenco. The probe found:
- **With a parent.** Each has notes outside every candidate parent, so a degree falls between
  two parent degrees whose qualities disagree, and `resolveDegreeQuality` throws (by design).
  Bebop Major→Harmonic Major resolves, but it maps A to an augmented chord.
- **Stacking thirds on the scale itself.** This yields tuples outside the quality tables:
  `3M 5d 7m`, `3m 5P 7d`, `3d 5d 7d`. tonal's `flamenco` (C Db Eb E F# G Bb) is not tertian
  at all.
- **8-note scales.** They shift degree-indexed progressions: vi in Bebop Major lands on G#.

A follow-up needs its own harmony design: passing-tone scales, symmetric scales and new
chord qualities.

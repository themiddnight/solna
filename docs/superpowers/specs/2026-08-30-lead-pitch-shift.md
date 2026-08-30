# Lead Melody Pitch-Shift on Key Change — Design Spec

Date: 2026-08-30
Status: Draft (awaiting review)

## Problem

The lead step sequencer stores notes as absolute note names (`leadMelodySteps:
string[][]`, e.g. `"C4"`, `"A3"`) in `src/store/leadSlice.ts`. When the global key
changes (`scaleRoot` / `scaleType` in `src/store/musicContextSlice.ts`), the drawn
notes do not move — a melody drawn in A Natural Minor stays on those exact pitches
after switching to C Natural Minor, so it is no longer "in key". We want the melody
to follow the key change by re-mapping each note to the same scale degree in the new
key/scale.

## Goals

1. On `scaleRoot` change: transpose **every** lead note (in-scale and out-of-scale
   alike) by the root-change interval `rootSemitone(toRoot) - rootSemitone(fromRoot)`.
   A uniform chromatic transpose that preserves all melodic intervals.
2. On `scaleType` change: re-map each in-scale note to the same degree of the new
   scale (degree N → degree N). Out-of-scale notes stay unchanged.
3. Preserve the melody's step structure, loop length, and per-step note sets — only
   each note's pitch changes.
4. No new dependency; pure logic plus a two-setter wiring.

## Non-goals

- No UI change — the piano roll already re-renders its rows from the active scale.
- No change to chord/bass/keyboard re-harmonization (they already have
  `transposeProgression` / `snapProgressionToScale` / the scale-locked keyboard).
- No persistence change.

## Behavior

- **Root change** (same scale type) ⇒ uniform transpose by the root interval. This
  coincides with the degree re-map on a pure root change, but applies uniformly to
  out-of-scale notes too.
- **Scale-type change** (same root) ⇒ degree re-map of in-scale notes; out-of-scale
  notes unchanged.
- **The two compose.** `instantVibes.ts` calls `setScaleRoot` then `setScaleType`,
  yielding in-scale notes fully re-mapped to the new key/scale and out-of-scale notes
  transposed by the root interval only. Degree-preserving re-map is associative under
  this split, so there is no double-apply.
- **No-op** (same key and scale) ⇒ identity.

## Edge cases

- Out-of-scale note (chromatic view, or a prior key change) ⇒ unchanged on a
  scale-type change; transposed on a root change.
- Degree overflow (a degree that exists in the source scale but not the target, e.g.
  degree 6/7 when switching a 7-note scale to a 5-note pentatonic) ⇒ unchanged.
- Notes below the tonic register: handled by the octave-block indexing (negative
  offsets wrap correctly).

## Architecture

### 1. Pure note helpers in `src/utils/musicTheory.ts`

Reuse `SCALES[scaleType].intervals` (semitone offsets per degree), `rootSemitone(root)`
(pitch class 0–11), and `tonal`'s `Note.midi` / `Note.fromMidiSharps` (sharp spelling).

```ts
/** Transpose a note by a raw semitone count (sharp-spelled). */
export function transposeNoteBySemitones(note: string, semitones: number): string {
  return Note.fromMidiSharps(Note.midi(note) + semitones);
}

/** Re-map an in-scale note to the same degree of a new key/scale. Returns the note
 *  unchanged when it is out of the source scale or its degree has no target. */
export function remapNoteByScaleDegree(
  note: string,
  fromRoot: string,
  fromScaleType: string,
  toRoot: string,
  toScaleType: string,
): string {
  const rootRef = rootSemitone(fromRoot);
  const midi = Note.midi(note);
  const block = Math.floor((midi - rootRef) / 12);
  const offset = ((midi - rootRef) % 12 + 12) % 12;
  const degree = SCALES[fromScaleType].intervals.indexOf(offset);
  if (degree === -1) return note;
  if (degree >= SCALES[toScaleType].intervals.length) return note;
  return Note.fromMidiSharps(
    rootSemitone(toRoot) + block * 12 + SCALES[toScaleType].intervals[degree],
  );
}
```

Worked example (A Natural Minor → C Natural Minor): `A3 C4 E4` ⇒ `C3 Eb3 G3`
(degrees 0,2,4 preserved; uniform −9 semitones).

### 2. Step-level transforms in `src/audio/leadMelody.ts`

Lead-specific mapping over the `string[][]` grid (mirrors `resizeLeadMelody`, already
imported by `leadSlice`):

```ts
export function transposeLeadMelodyByRoot(
  steps: readonly string[][], fromRoot: string, toRoot: string,
): string[][] {
  const delta = rootSemitone(toRoot) - rootSemitone(fromRoot);
  return steps.map((row) => row.map((n) => transposeNoteBySemitones(n, delta)));
}

export function remapLeadMelodyByScale(
  steps: readonly string[][], root: string, fromType: string, toType: string,
): string[][] {
  return steps.map((row) =>
    row.map((n) => remapNoteByScaleDegree(n, root, fromType, root, toType)),
  );
}
```

### 3. Wire into `src/store/musicContextSlice.ts`

```ts
setScaleRoot: (scaleRoot) =>
  set((state) => ({
    scaleRoot,
    leadMelodySteps: transposeLeadMelodyByRoot(
      state.leadMelodySteps, state.scaleRoot, scaleRoot,
    ),
  })),

setScaleType: (scaleType) =>
  set((state) => ({
    scaleType,
    leadMelodySteps: remapLeadMelodyByScale(
      state.leadMelodySteps, state.scaleRoot, state.scaleType, scaleType,
    ),
  })),
```

(`musicContextSlice` imports the two step-level helpers from `../audio/leadMelody` —
the same store→audio import `leadSlice` already uses for `resizeLeadMelody`.)

## Files

- Modify `src/utils/musicTheory.ts` — `transposeNoteBySemitones`, `remapNoteByScaleDegree`.
- Modify `src/utils/musicTheory.test.ts` — unit tests (worked example, root-only,
  scale-only, out-of-scale, overflow, no-op, below-tonic).
- Modify `src/audio/leadMelody.ts` — `transposeLeadMelodyByRoot`, `remapLeadMelodyByScale`.
- Modify `src/audio/leadMelody.test.ts` — grid-level tests.
- Modify `src/store/musicContextSlice.ts` — wire the two setters.
- Modify `src/store/musicContextSlice.test.ts` (or `leadSlice` test) — slice-level re-map.

## Testing

- Pure helper: A→C example; root-only transpose; scale-only degree re-map (minor→major
  degree 3 shifts a semitone); out-of-scale unchanged on scale change; pentatonic
  overflow unchanged; identity no-op; below-tonic octave.
- Slice: seed `leadMelodySteps` + a key, `setScaleRoot('C')` transposes every note,
  `setScaleType('Major')` re-maps degrees.
- `bun run verify` green; `bun run eslint` for import changes.

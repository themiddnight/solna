# Borrowed-Chords (Modal Interchange) Catalog — Verification

Date: 2026-08-23. Scope: `src/utils/musicTheory.ts` `getBorrowedChords` vs `getDiatonicChordForDegree`, all 10 scales in `SCALES`, triad + 7th modes. All duplicate lists verified by execution (`bun run scripts/verify-borrowed.mts`, kept in repo, uncommitted).

## 1. Catalog audit

Catalog definition: `src/utils/musicTheory.ts:154-182` — three branches keyed by scale type. Roots are pitch-class offsets from the tonic (sharp-spelled via `ROOTS`, line 4). Note: borrowed qualities are FIXED strings; the UI's triad/7ths toggle does not affect them (`src/components/ChordView.tsx:825-837`, render at 1319-1346; the toggle only feeds `getDiatonicChordForDegree`, line 1277).

### Major branch — `Major`, `Lydian`, `Mixolydian` (musicTheory.ts:156-164)

| Entry (root offset) | Quality | Source mode | Standard? | Duplicates |
|---|---|---|---|---|
| iv (+5) | min | parallel minor (Aeolian) | Yes — most common borrowed chord (Wikipedia "Borrowed chord": iv) | none (diatonic IV is maj) |
| ♭VI (+8) | maj | parallel minor | Yes | none (diatonic vi is min) |
| ♭VII (+10) | maj | parallel minor / Mixolydian | Yes | **Mixolydian triad mode only**: = diatonic VII (Bbmaj) — Mixolydian already has b7 |
| ♭III (+3) | maj | parallel minor | Yes | none |
| ♭II (+1) | maj | Phrygian (Neapolitan) | Acceptable — standard in modal-interchange practice; Wikipedia categorizes as "altered chord" | none |
| iiø7 (+2) | **min7** | intended: parallel-minor ii°7 (Dm7b5) | **Intent standard (Wikipedia lists iiø7), implementation buggy** | **Major & Mixolydian, 7th mode: = diatonic ii7 (Dmin7) — exact dup.** Triad mode: near-dup (same root as diatonic ii). Label "Half-Dim" contradicts quality `min7` (half-diminished = m7b5) |

### Minor branch — `Natural Minor`, `Harmonic Minor`, `Dorian`, `Phrygian` (musicTheory.ts:165-172)

Entries are the parallel-major roots (offsets +5/+7/+4/+8/+10), labeled as if they were scale degrees. "III/VI/VII" here are NOT the natural-minor degrees — they are the raised (natural) 3rd/6th/7th.

| Entry (root offset) | Quality | Source mode | Standard? | Duplicates (triad mode) |
|---|---|---|---|---|
| IV (Major IV) (+5) | maj | parallel major / Dorian | Yes (main borrowing into minor) | **Dorian**: = diatonic IV. Not dup in Nat./Harm. minor (diatonic iv is min) or Phrygian (iv min) |
| V (Major V) (+7) | maj | harmonic minor (dominant) | Yes for natural minor; **inherent to Harmonic Minor scale itself** | **Harmonic Minor**: = diatonic V (exact dup) |
| III (Major III) (+4) | maj | none — raised mediant, chromatic chord | **No — not a textbook modal interchange chord** (E major in C minor is a chromatic mediant / V-of-♭VI, not from any C mode) | none (diatonic III is ♭III = Eb) |
| VI (Major VI) (+8) | maj | none — this IS the natural-minor ♭VI | **Diatonic in natural/harmonic minor — not borrowed**; legitimate ♭VI borrowing in Dorian/Phrygian, but label "VI" wrong there (Dorian's 6th degree is natural) | **Natural Minor, Harmonic Minor, Phrygian**: = diatonic VI (Abmaj) — exact dup |
| VII (Major VII) (+10) | maj | none — this IS the natural-minor ♭VII | **Diatonic in natural minor & Dorian — not borrowed**; legitimate in Phrygian (diatonic VII is Bb *min*) | **Natural Minor, Harmonic Minor, Dorian**: = diatonic VII (Bbmaj) — exact dup |

### Default branch — `Minor Pentatonic`, `Major Pentatonic`, `Blues` (musicTheory.ts:173-181)

| Entry | Duplicates |
|---|---|
| ♭III (+3) maj | **Minor Pentatonic, Blues**: = diatonic III (exact dup). Major Pentatonic: non-diatonic ✓ |
| iv (+5) min | **Minor Pentatonic**: = diatonic iv (exact dup). Blues: diatonic iv is Fdim (not dup, but root-equal). Major Pentatonic ✓ |
| ♭VI (+8) maj | non-diatonic in all three ✓ (only non-diatonic option left for Minor Pentatonic) |
| ♭VII (+10) maj | **Minor Pentatonic, Blues**: = diatonic VII (exact dup). Major Pentatonic ✓ |

For Minor Pentatonic, 3 of 4 "borrowed" chords are plain diatonic chords; only ♭VI is chromatic.

## 2. Exact duplicate lists (executed, root C; identical for F# — transposition-invariant)

- **Major** — 7ths: Dmin7 (iiø7 entry) = diatonic ii7. Triads: none exact; Dmin7 near-dup of diatonic ii.
- **Mixolydian** — triads: Bbmaj (♭VII) = diatonic VII. 7ths: Dmin7 = diatonic ii7.
- **Natural Minor** — triads: Abmaj (VI), Bbmaj (VII) both = diatonic VI/VII. 7ths: none exact.
- **Harmonic Minor** — triads: Gmaj (V), Abmaj (VI). 7ths: none exact.
- **Dorian** — triads: Fmaj (IV), Bbmaj (VII). 7ths: none exact.
- **Phrygian** — triads: Abmaj (VI). 7ths: none exact.
- **Minor Pentatonic** — triads: Ebmaj (♭III), Fmin (iv), Bbmaj (♭VII).
- **Blues** — triads: Ebmaj (♭III), Bbmaj (♭VII).
- **Lydian, Major Pentatonic** — no duplicates.

7th-mode caveat: borrowed chords ignore the toggle, so in 7th mode the minor-branch borrowed triads sit beside diatonic 7ths on the same roots (e.g. Natural Minor: borrowed Abmaj vs diatonic Abmaj7, Bbmaj vs Bb7) — not string-identical, but pitch-subset duplicates.

Non-standard / buggy entries: (1) minor-branch "III (Major III)" — chromatic raised mediant, not modal interchange, in all four minor-ish scales; (2) "iiø7 (Half-Dim)" quality should be `m7b5` — with `min7` it is the diatonic ii7 in Major/Mixolydian; (3) "V (Major V)" is redundant for the Harmonic Minor scale itself; (4) "VI/VII (Major…)" labels claim borrowings that are simply natural-minor diatonic chords in Nat./Harm. Minor.

## 3. tonal.js capability (v6.4.3, `node_modules/tonal/package.json:3`)

tonal re-exports `@tonaljs/*` modules (`node_modules/tonal/dist/index.d.ts:1-30`). Relevant API, verified working via the script:

- `Scale.scaleChords(name)` — `node_modules/@tonaljs/scale/dist/index.d.ts:56` — chord TYPE names diatonic to a scale type (e.g. `major` → `["M","maj7","6","m7",...]`, `minor` → `["m","m7",...]`). Filters against tonal's own scale-type registry, not the app's `SCALES`.
- `Chord.detect(notes)` — `node_modules/@tonaljs/chord/dist/index.d.ts:1-2` — returns chord names for a note set.
- `Scale.detect(notes)` — `node_modules/@tonaljs/scale/dist/index.d.ts:42`.
- `Chord.get / Chord.getChord(type, tonic)` — `node_modules/@tonaljs/chord/dist/index.d.ts:40,48` (already used by the app at musicTheory.ts:275).
- **No direct "is this chord in this scale" predicate.** The idiomatic test is a pitch-class subset check: chord pcs ⊆ scale pcs (verified in script; e.g. in C major the borrowed Dmin7 passes — confirming the dup — while Fmin/Ab/Bb/Eb/Db fail). `Scale.scaleChords` is not a drop-in for app scales (custom pentatonic/blues definitions, app quality strings like `min7` vs tonal `m7`), so pc-subset is the more robust route and works identically for triads and 7ths.

## 4. Recommendation

Add one pure helper in `musicTheory.ts` (fits existing style — pure, semitone-based):

- `isChordDiatonic(root, quality, scaleRoot, scaleType): boolean` — compute chord pcs via the existing `generateBlockChordNotes` (musicTheory.ts:273-288) and compare against `getScaleNotes` pcs (musicTheory.ts:91-95); a chord is "borrowed" iff pcs ⊄ scale pcs.
- Filter inside `getBorrowedChords` itself (it already receives `root` + `scaleType`): return entries where `!isChordDiatonic(...)`. The call site (`ChordView.tsx:1319`) needs no change. No hardcoded exclusion lists; duplicates vanish automatically for every scale and both modes.
- Because the pc test compares against the scale (not the rendered diatonic chord list), the triad/7ths toggle needs no special handling: borrowed entries are fixed-quality, so the same filter is correct in both modes. (If the toggle later extends to borrowed chords, filter against the active mode's diatonic set instead.)
- Bug fixes to fold in while touching the catalog: `iiø7` quality `min7` → `m7b5` (then it is genuinely non-diatonic in major keys and matches its label; the app already uses `m7b5` elsewhere, e.g. musicTheory.ts:21); drop or relabel "III (Major III)" (non-standard); relabel "VI"/"VII" in the minor branch ("♭VI"/"♭VII" — they are ♭6/♭7 roots); for `Harmonic Minor`, "V (Major V)" is redundant (diatonic).

Theory sources: Wikipedia "Borrowed chord" (parallel-minor list: iv, iiø7, ♭VI, ♭III, ♭VII, i; Neapolitan categorized as altered chord; minor-key borrowing limited to Picardy third) — https://en.wikipedia.org/wiki/Borrowed_chord. Parallel-key diagrams (natural minor ♭III/iv/♭VI/♭VII are native to Aeolian, hence not borrowings; IV/V into minor from parallel major/harmonic minor) — https://guitarwiz.app/articles/parallel-major-minor-guitar/, https://www.audiosorcerer.com/post/borrowed-chords-modal-interchange.

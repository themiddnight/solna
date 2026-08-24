---
name: music-theory
description: Use when touching notes, scales, keys, chord generation, bass/rhythm patterns, the arpeggiator, the QWERTY keyboard map, or the drum-pad shortcuts in solva — or when `bun run check:keys` fails.
---

# Music Theory (solva)

Everything theory-related lives in **`src/utils/musicTheory.ts`** (pure, no store/engine imports).
`src/audio/` and `src/components/` both import from it; it imports neither.

## Rule: use `tonal`, never hand-rolled math

`tonal` is the only theory dependency (no Tone.js). Reach for it for **note/interval/chord math**:

| Need | Use | Don't |
|---|---|---|
| pitch class of a note name | `Note.get(n).chroma` (`rootSemitone()`) | letter → number lookup tables |
| MIDI number / frequency | `Note.midi()`, `Note.fromMidiSharps()` (`noteFrequency()`) | `Math.pow` on your own note index |
| chord tones from a quality | `Chord.getChord(type, root)` + `Interval.semitones()` (`generateBlockChordNotes()`) | hardcoded `[0,4,7]` arrays |
| transposing by octaves | `transpose(note, '<7N+1>P')` (`shiftNoteOctave()`, `buildArpSequence()`) | string surgery on the octave digit |

`tonal` takes **interval notation**, not `"N oct"` — octave N up is a perfect `(7N+1)`th (`8P`, `15P`, …).
Both `shiftNoteOctave` and `src/audio/arpeggiator.ts` depend on this; don't "simplify" it.

The one deliberately hand-authored table is `SCALES` — semitone intervals plus per-degree
`triadQualities` / `seventhQualities`, which `tonal` does not provide. Chord *spelling* still goes
through `tonal`.

## Scales and roots

`ROOTS` is 12 sharp-spelled pitch classes (`C … B`); every generated note name is sharp-spelled.

`SCALES` keys are the values persisted as `scaleType`, so **renaming a key breaks saved projects**:
`Major`, `Natural Minor`, `Harmonic Minor`, `Dorian`, `Mixolydian`, `Lydian`, `Phrygian`,
`Minor Pentatonic`, `Major Pentatonic`, `Blues`. Pentatonic/Blues have 5–6 degrees, so never assume 7 —
loop `SCALES[scaleType].intervals.length` (unknown key falls back to `Major`).

Helpers: `getScaleNotes(root, scaleType)`, `isNoteInScale(note, root, scaleType)` (accepts `'C#4'` or `'A'`).

## Where key/scale live

`src/store/musicContextSlice.ts` — `scaleRoot` (default `'A'`), `scaleType` (default `'Natural Minor'`),
`projectTitle`, plus `applyTemplate(name)` which sets bpm + root + scale + title in one atomic `set()`.
`Header.tsx` renders the pickers from `ROOTS` / `Object.keys(SCALES)`. The sequencer is **not**
scale-aware; only the chord tools, the bass engine and the scale-locked keyboard read these.

## Chord generation

- `getDiatonicChordForDegree(degreeIndex, root, scaleType, use7ths)` → `{ root, quality, degreeName }`;
  degree index wraps, roman numeral is lower-cased for min/dim.
- `getBorrowedChords(root, scaleType)` → curated modal-interchange list, then **filtered** so nothing
  fully diatonic or already reachable from the in-scale triad/7th palette survives. Tests in
  `src/utils/musicTheory.test.ts` enforce that filter — add candidates, don't loosen it.
- `reharmonizeProgressionToScale(chords, newRoot, newScaleType, octave)` snaps each chord to the nearest
  scale degree; only `maj9 / min9 / 7sus4 / sus4` keep their user-chosen quality.
- `deriveChordNotes(chord, octave)` wrapping `generateBlockChordNotes(quality, root, octave)` is the
  **single source of truth for `ChordItem.notes`**. Never build a `notes` array by hand: `chordsSlice`
  re-derives on `setChordOctave` inside the same `set()`, so octave and notes can't drift.
- `TONAL_CHORD_ALIASES` maps app quality tokens to `tonal` types (`min9→m9`, `min6→m6`, `minmaj7→mMaj7`).
  New quality tokens that `tonal` spells differently must be added there or they silently fall back to `maj`.
- Display only: `formatChordQuality` / `formatChordLabel` (`'maj'` → `''`, `'min7'` → `'m7'`). Stored
  `ChordItem.quality` tokens stay untouched.

`ChordView.tsx` composes these: a per-degree quick-add row (`Triads` / `7th Chords` toggle), a borrowed-chord
row, and an `autoReharmonize` effect that re-snaps the whole progression when `scaleRoot`/`scaleType` change.
`ChordItem.bassNote` is an optional slash-bass override consumed by the bass engine.

## Bass and rhythm patterns

`src/audio/bassPatterns.ts` — `BASS_PATTERNS` (12, styles `Walking` / `Grooves` / `Minimal`) are lists of
`BassStep { step 0–15, note token, holdSteps, velocity, octaveShift, staccato, alternate }`.
`resolveBassSteps(pattern, chords, chordIndex, octave, scaleRoot, scaleType, bpm, holdScale)` turns one bar
into `ResolvedBassEvent[]`:

- Chord-tone tokens (`third`/`fifth`/`seventh`) read `chord.notes[1|2|3]` and fall back down the chain
  `seventh → fifth → third → root`, so pentatonic triads never produce a missing note.
- `approach*` tokens target the **next** chord's root, not the current one (`isApproachToken`).
  `approachDiatonicUp` walks to the next scale degree above via `SCALES[scaleType].intervals`.
- `alternate: true` flips chromatic above/below on odd `chordIndex` — deterministic, not random.

`src/audio/rhythmPatterns.ts` — `RHYTHM_PATTERNS` (15, 9 styles) are one-bar 16-step chord-comp patterns of
`RhythmHit`s, either `block` (all notes at once) or `strum` (cascade, `direction` + `spreadMs`). `note` +
`octaveShift` isolate a single chord tone. `feelToHoldScale(feel)` maps the Feel knob to hold length;
`equalPowerVelocityScale(n)` keeps thick chords from clipping.

Store state: `chordsSlice` (`chords`, `chordRhythmId` default `'sustained'`, `chordFeel`, `chordOctave` 4,
mute/volume) and `bassSlice` (`bassPatternId` = `BASS_PATTERNS[0].id`, `bassFeel`, `bassOctave` 2, mute/volume).
Both are plain state — the engine gets them through `src/store/engineSync.ts`, never from a component.

## Keyboard map

`KEYBOARD_NOTES` lives in `src/components/ui/Keyboard.tsx` and is re-exported by `SynthView.tsx` (that
re-export is what `scripts/check-key-bindings.ts` imports). 18 chromatic keys, C3–F4:

| Row | Codes | Notes |
|---|---|---|
| white | `KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote` | C3 D3 E3 F3 G3 A3 B3 C4 D4 E4 F4 |
| black | `KeyW KeyE KeyT KeyY KeyU KeyO KeyP` | C#3 D#3 F#3 G#3 A#3 C#4 D#4 |

Two modes, held as **local `SynthView` state** (not persisted, not in the store), default `scale-locked`:

- `chromatic` — `getChromaticKeyboardNotes(octaveOffset)` shifts `KEYBOARD_NOTES` by whole octaves.
  Always starts from C; ignores key/scale.
- `scale-locked` — `getScaleLockedKeyboardNotes(root, scaleType, octaveOffset)` returns `{ homeRow, topRow }`.
  Top row `KeyQ…BracketRight` (12 keys) starts on the tonic at octave `3 + offset` and ascends by scale
  degree; home row `KeyA…Quote` (11 keys) starts `-(2 * scaleLength - 3)` steps below it. Steps wrap
  octaves at **C**, not at the tonic, so non-C roots keep ascending. Scales with <7 notes make the rows overlap.

`keyboardOctave` is a display offset clamped to **−2…+2** by `clampKeyboardOctave`, driven by `Minus` /
`Equal`; it is independent of the synth's pitch `params.octave`. All key handlers bail on `isTypingTarget(e)`
and `e.repeat`.

## Drum pad map

`DEFAULT_PADS` in `src/components/DrumPads.tsx` is the source of truth for the drum half of the key map —
8 pads, one row, no pages, no General MIDI:

| Pad | `kick` | `snare` | `hihat` | `openhat` | `clap` | `lowtom` | `hightom` | `crash` |
|---|---|---|---|---|---|---|---|---|
| code | `KeyZ` | `KeyX` | `KeyC` | `KeyV` | `KeyM` | `Comma` | `Period` | `Slash` |

`note` is a synthesis type (`kick`/`snare`/`hihat`/`openhat`/`clap`/`tom`/`crash`), not a MIDI number;
`lowtom` and `hightom` share `tom` and differ by `pitch` (0 vs 4). Pad volume is component state.

## The `check:keys` invariant

`scripts/check-key-bindings.ts` (`bun run check:keys`, part of `bun run verify`) imports `DEFAULT_PADS` and
`KEYBOARD_NOTES` directly and asserts four things:

1. drum codes unique 2. synth codes unique 3. **zero overlap** between the two sets
4. every code matches `^(Key[A-Z]|Digit[0-9]|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal)$`

What breaks it, and the fix:

- Extending `KEYBOARD_NOTES` downward/leftward into `Z X C V M , . /` → those belong to the drums. Pick free
  codes instead — only `KeyB`, `KeyN` and `Digit0`–`Digit9` are free of the chromatic table, the drum pads
  and the scale-locked rows (`KeyQ…BracketRight` / `KeyA…Quote`).
- Using a modifier/whitespace code (`Space`, `ShiftLeft`, `ArrowUp`) → fails check 4. The regex is the contract;
  extend the regex only if you genuinely need a new code family, and expect to justify it.
- Note `Minus` and `Equal` pass check 4 but are **already claimed** by keyboard-octave shift in `SynthView`,
  and the scale-locked rows claim `KeyQ…BracketRight` at runtime — the script only covers the chromatic
  table, so cross-check those by hand when adding shortcuts.

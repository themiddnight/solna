---
name: music-theory
description: Music theory system — Tonal.js scales, GM percussion, keyboard modes, scale sync, piano roll note mapping. Read before touching notes, keyboard, sequencer, or piano roll.
---

# Music Theory Skill

Read every time before touching: notes, keyboard modes, sequencer scale view, piano roll, scale sync, or chord generation.

**Full doc:** `app/frontend/docs/MUSIC_THEORY.md`

---

## Library

Use **Tonal.js** for all music theory calculations — DO NOT calculate intervals or chords manually.

```typescript
import { Scale, Note, Chord } from "tonal";

Scale.get("C major").notes // → ["C", "D", "E", "F", "G", "A", "B"]
```

---

## 19 Supported Scales

| Category | Scales |
|---|---|
| Diatonic | Major, Minor (Natural), Harmonic Minor, Melodic Minor |
| Modes | Dorian, Phrygian, Lydian, Mixolydian, Locrian |
| Pentatonic | Major Pentatonic, Minor Pentatonic, Egyptian |
| Blues | Major Blues, Minor Blues |
| World | Hirajoshi, Pelog, Vietnamese |
| Other | Bebop, Diminished |

Scale names must match Tonal.js strings — see `app/frontend/src/features/instruments/` for exact strings used.

---

## GM Percussion Mapping

Drum pads use the **General MIDI standard** (note C1–A4):
- 3 pages × 16 pads = 48 positions
- Not affected by scale — drum mode is always chromatic.
- Page navigation: Z (prev) / X (next) keys
- See exact mapping in `app/frontend/src/features/instruments/drum/`

---

## Keyboard Modes

### Basic Mode (Piano Layout)
- Full chromatic — all 12 notes playable.
- Row 1 (black keys): W E T Y U O P
- Row 2 (white keys): A S D F G H J K L ; '

### Melody Mode
- Only notes in the current scale → impossible to play wrong notes.
- Physical keys map directly to scale degrees.
- Octave shift: Z / X

### Chord Mode
- 1 key = 1 chord (auto-determined quality)
- Chord quality rules:

| Scale | I | ii | iii | IV | V | vi | vii° |
|---|---|---|---|---|---|---|---|
| Major | Maj | min | min | Maj | Maj | min | dim |
| Minor | min | dim | Maj | min | min | Maj | Maj |

- Non-standard scales (pentatonic, blues, world) → Use parent diatonic scale for chord generation.
- Chord modifiers (hold modifier + key): Dom7, Maj7, sus2, sus4, 6, add9, Power, Maj/Min toggle
- Chord voicing range: -2 to +2 octaves (C/V keys)
- Wide Range toggle (Digit0): R-5-10 spread — raises the 3rd/sus + 7th/6th one octave, root and 5th stay. Skipped for chords that already reach a 9th/11th/13th (they keep the close voicing) — available in Chord and Hybrid modes

### Chord Voice Mode
- Select chord degree first: Q–U keys = degrees I–VII
- Then finger notes individually: H = bass root, J/K/L/;/' = root/3rd/5th/7th/9th
- Natural stacking — each chord tone placed strictly above the previous, starting from chordVoicing base octave
- 7th type derived from scale interval (dominant7 for V chord in major, major7 otherwise)
- 9th derived from parent scale, not Tonal chord parser
- Bass (H) octave controlled by Z/X; chord tone stack octave controlled by C/V
- Available on both Keyboard and Guitar

### Hybrid Mode
- Left hand: chord keys (same layout as Chord Mode)
- Right hand: melody keys (same layout as Melody Mode)
- Wide Range toggle (Digit0) available — same open voicing behavior as Chord mode

---

## Scale Sync (Room-Wide)

**DEV-226 (unified scale model)** — see `.claude/skills/perform-room/SKILL.md` § Unified scale model for the full picture. Summary:

```
Owner UI → perform:room_scale_change(rootNote, scale)
  → Server stores in PerformRoomState.roomScale, broadcasts perform:room_scale_changed
    → Client: effectiveScale = resolveEffectiveScale(roomScale, personalScale, followScale)
    → Instruments/sequencer/pitch-effects subscribe to effectiveScale → update mappings
```

**Key state:**
- `roomScale` — Shared scale, located in Redis room state (BE) and `roomStore` (FE)
- `performScaleStore` — Personal scale of each user (FE)
- `followScale: boolean` — Server-authoritative follow flag on `BandMember`; default `true` for joining band members, `false` for the owner
- `effectiveScale` — Derived via `resolveEffectiveScale`; the value every instrument/sequencer/pitch-effect consumer reads
- `scaleSlotsStore` — 10 quick-switch presets (hotkeys 1-0), stored in localStorage; never overwritten by following

**Socket events:**
- Client → Server: `perform:room_scale_change`
- Server → Client: `perform:room_scale_changed`

---

## Piano Roll Scale View

```typescript
type ViewMode = "all-keys" | "scale-keys" | "only-notes";

getVisibleMidiNumbers(viewMode, rootNote, scale, notes);
```

| Mode | Display |
|---|---|
| `all-keys` | All MIDI notes (0–127) |
| `scale-keys` | Notes in scale + existing out-of-scale notes |
| `only-notes` | Only rows with existing notes (compact) |

**Out-of-scale detection:**
```typescript
isNoteInScale(midiNumber: 60, rootNote: "C", scale: "major")
// (60 % 12) exists in scale interval set relative to root
// → true
```

---

## Sequencer Scale View

| Mode | Rows Displayed |
|---|---|
| All Notes | All chromatic notes |
| Scale Notes | Only in-scale + out-of-scale notes with existing steps |
| Drum Mode | GM percussion (not affected by scale) |

Out-of-scale notes: Displayed with a ⚠️ indicator.

---

## Hum-to-Find Scale

- User hums or sings into the microphone.
- Real-time pitch detection → detects best matching key + scale.
- One-click apply to room scale.
- See `app/frontend/src/shared/utils/audio/pitchDetectionService.ts` (+ arrange `voiceToMidiUtils.ts`) for hum/pitch detection.

---

## Key Files

| File | Responsibility |
|---|---|
| `app/frontend/src/features/instruments/shared/` | Shared instrument utilities, scale helpers |
| `app/frontend/src/features/virtual-inputs/components/Keyboard/` + `Guitar/` | Keyboard + chord mode logic |
| `app/frontend/src/features/instruments/drum/` | GM percussion mapping |
| `app/frontend/src/features/sequencer/` | Step sequencer scale view |
| `app/frontend/src/features/rooms/arrange/` | Piano roll scale view |
| `app/frontend/docs/MUSIC_THEORY.md` | Full reference doc |

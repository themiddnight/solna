# Bass Module ใน Chord Page — Design Spec

วันที่: 2026-08-22
สถานะ: Approved (design) — รอ user review spec ก่อนทำ implementation plan

## Overview

เพิ่มโมดูล Bass ในหน้า Chord View ให้เล่น bass line ตาม chord progression เดียวกับ module คอร์ดเดิม ผู้ใช้สามารถ:

- เลือก bass sound preset (แยกจากคอร์ด), octave, และ bass pattern (walking/groove presets)
- กำหนดโน้ต bass ต่อคอร์ดได้ (เล่น inversion / slash chord)
- Mute layer chord และ bass แยกกัน เพื่อเลือกว่าจะได้ยินเสียงชั้นไหนใน progression เดียวกัน

**ข้อตกลงสำคัญจาก brainstorming:**
1. Walking bass เป็นแบบ **pattern-based** (deterministic, เลือกจาก dropdown) — ไม่ใช่ generative
2. **Per-chord bass override** — แต่ละคอร์ดเลือกโน้ต bass ได้ (Auto/3rd/5th/7th)
3. **Dedicated bass factory presets** — ไม่ reuse preset library ของคอร์ด
4. **ไม่สร้าง synth engine ใหม่** — ขยาย `AudioEngine` เดิมด้วย per-source bus (Approach A)

## 1. Data Model — `src/audio/bassPatterns.ts` (ไฟล์ใหม่)

```ts
export type BassNoteToken =
  | 'root' | 'third' | 'fifth' | 'seventh' | 'octave'
  | 'approachChromaticAbove' | 'approachChromaticBelow'
  | 'approachDiatonicUp' | 'approachFifthOfNext'
  | 'rest';

export interface BassStep {
  step: number;              // ตำแหน่ง 16th note ในบาร์ (0–15)
  note: BassNoteToken;
  holdSteps?: number;        // จำนวน 16th steps ที่ถือโน้ต (default 1)
  velocity?: number;         // accent 0–1
  octaveShift?: number;      // เลื่อน octave เฉพาะโน้ตนี้ (เช่น -1 กันปีน register สูง)
  staccato?: boolean;        // true = ตัด hold ลงเหลือ ~50%
}

export interface BassPattern {
  id: string;
  name: string;
  style: string;             // ใช้ group ใน dropdown เช่นเดียวกับ RHYTHM_STYLE_GROUPS
  description?: string;
  steps: BassStep[];
}
```

### Resolver (pure function)

```ts
resolveBassSteps(
  pattern: BassPattern,
  chords: ChordItem[],
  chordIndex: number,
  octave: number,
  scaleRoot: string,
  scaleType: string,
  bpm: number
): ResolvedBassEvent[]   // { noteName, timeOffsetSec, holdSec, velocity }
```

กฎการ resolve:
- `bassRoot` ของคอร์ด = `chord.bassNote ?? chord.root`
- Tokens `root/third/fifth/seventh/octave` แปลงจาก chord tones ที่หาได้ (ใช้ `chord.notes` และโครงสร้าง interval ของ quality)
- **Fallback:** token ที่คอร์ดไม่มี (เช่น 7th ใน triad) → ไล่ลง `seventh → fifth → third → root`
- Approach tokens (`approachChromaticAbove/Below`, `approachDiatonicUp`, `approachFifthOfNext`) ชี้หา `bassRoot` ของ**คอร์ดถัดไป**ใน progression (คอร์ดสุดท้าย wrap กลับคอร์ดแรก)
- `approachChromaticAbove/Below` = target ±1 semitone; `approachFifthOfNext` = target +7 semitones; `approachDiatonicUp` = scale step เหนือ target 1 ขั้นตาม `scaleRoot`/`scaleType` ที่ส่งเข้า (ใช้ `SCALES` ใน `musicTheory.ts`)
- Deterministic variations: pattern ที่ต้องการสลับ above/below ใช้ `chordIndex % 2` (bar คู่ = above, bar คี่ = below)
- Output noteName สร้างด้วย Tonal `Note.midi`/`Note.fromMidi` ใน format `'C4'` แบบเดียวกับ `generateBlockChordNotes` — **octave ฝังใน note name** (params.octave ของ preset คงเป็น 0 ตาม convention ของ `INITIAL_SYNTH_PARAMS`) + `octaveShift` บวกเข้า midi
- Timing: `timeOffsetSec = step * (sixteenthNoteMs(bpm) / 1000)`, `holdSec = holdSteps * stepDur` (staccato → คูณ 0.5)

### Factory patterns (อ้างอิงจาก research)

กลุ่ม **Walking** (quarter notes 4 ตัว/บาร์, ตามสูตร beat 1 = root, beat 4 = leading tone):
- `classic-walk`: root → chord tone (3rd/5th) → chord tone → chromatic approach (above/below สลับตาม `chordIndex % 2`)
- `swing-double-approach`: root → 5th → chromatic → chromatic (double chromatic approach เข้าหา root คอร์ดถัดไป)
- `root-fifth-walk`: root → 5th → root → 5th ของคอร์ดถัดไป (dominant approach)

กลุ่ม **Grooves**:
- `driving-eighths`: straight 8ths บน root (rock/punk drive)
- `funk-octaves`: root/octave สลับ syncopated + staccato (funk)
- `reggae-one-drop`: root–5th–octave, เปิด downbeat, staccato (reggae)
- `arp-1357`: arpeggio 1-3-5-7 ขึ้นลง (funk/latin)

กลุ่ม **Minimal**:
- `half-time-legato`: root ค้าง 2 beats, 5th ค้าง 2 beats (ballad/R&B)
- `whole-note-root`: root ค้างทั้งบาร์ (ambient/pad support)

> หมายเหตุ: ตอน implement ปรับตำแหน่ง step/velocity ได้ตามฟังจริง (research-tuned เหมือน drum kits)

## 2. Engine — ขยาย `src/audio/engine.ts`

ไม่สร้าง engine ใหม่ ขยายของเดิม:

1. **Per-source bus:** `sourceBuses: Map<string, GainNode>` — สร้าง lazily เมื่อ trigger ครั้งแรกของ source นั้น; voice gain เชื่อมเข้า bus แล้ว bus แยกไป dry/delay/reverb/distortion (แทนที่การ connect ตรงแบบปัจจุบัน)
2. **`setSourceMuted(source: string, muted: boolean)`** — gain ramp ~10ms (กัน click); mute ที่ bus = เงียบ instant ครอบทั้ง tail/effects; unmute กลางคอร์ดกลับมาดังทันที
3. **Bass mono/legato:** ใน `triggerSynthNoteOn` เมื่อ `source === 'bass'` ก่อน start voice ใหม่ ให้ปิด bass voice ที่กำลังดังทั้งหมด (`triggerSynthNoteOff` ทุก voice ที่ source เป็น 'bass') — ไม่ overlap แบบมือเบสจริง
4. `updateSynthParams` รับ source อยู่แล้ว — bass ใช้ `'bass'` ไม่ต้องแก้ signature
5. ไม่เพิ่มพารามิเตอร์ synth ใหม่ — bass ใช้ `SynthParams` เดิม

**Invariants:** mutes คงอยู่ข้าม `updateEffects`; `sourceBuses` ต้องเชื่อมหลัง master chain setup; drum path ไม่ผ่าน bus นี้

## 3. State & Data Flow

### types.ts
```ts
export interface ChordItem {
  // ...เดิม
  bassNote?: string | null;  // โน้ต bass override (null/absent = auto root)
}
```

### App.tsx (state ใหม่, session-local ตามแพทเทิร์น chord settings เดิม)
```ts
const [bassSynthParams, setBassSynthParams] = useState<SynthParams>(FACTORY_BASS_PRESETS[0].params);
const [bassPatternId, setBassPatternId] = useState<string>(BASS_PATTERNS[0].id);
const [bassOctave, setBassOctave] = useState<number>(2);
const [chordMuted, setChordMuted] = useState<boolean>(false);
const [bassMuted, setBassMuted] = useState<boolean>(false);
```
- ส่งลง `ChordView` เป็น props ตามแพทเทิร์น `chordSynthParams`/`rhythmId` เดิม
- Effect เรียก `audioEngine.setSourceMuted('chord'|'bass', muted)` เมื่อ state เปลี่ยน
- ProjectState **ไม่** persist chord/bass module settings (คงพฤติกรรมเดิม — persist settings เป็น follow-up แยก)

### Playback loop (ChordView)
- `subscribeClock` เดิม schedule chord ตามเดิม + เพิ่มการ schedule bass: `resolveBassSteps(bassPattern, chords, index, bassOctave, scaleRoot, scaleType, bpm)` → `triggerSynthNoteOn(note, bassSynthParams, vel, time, 'bass')` + off ตาม hold
- **Mute ทำงานที่ bus อย่างเดียว** — loop schedule ทั้งสอง layer เสมอ ไม่ต้องรู้จัก mute state
- กด chord pad มือ → เล่นทั้ง chord line และ bass line ของคอร์ดนั้น (bus mute คุมว่าดังหรือไม่)

## 4. Presets — `src/audio/bassPresets.ts` (ไฟล์ใหม่)

```ts
export const FACTORY_BASS_PRESETS: SynthPresetItem[] = [
  {
    id: 'bass-deep-sine', name: 'Deep Sine Sub',
    params: { oscType: 'sine', subOscVolume: 0.9, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 220, filterResonance: 1, filterEnvAmount: 0,
      attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.6,
      filterAttack: 0.01, filterDecay: 0.1, filterSustain: 1, filterRelease: 0.3,
      lfoRate: 4, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Deep Sine Sub' },
  },
  {
    id: 'bass-round-pluck', name: 'Round Pluck',
    params: { oscType: 'triangle', subOscVolume: 0.4, noiseVolume: 0, detune: 4,
      filterType: 'lowpass', filterCutoff: 400, filterResonance: 4, filterEnvAmount: 900,
      attack: 0.005, decay: 0.25, sustain: 0.4, release: 0.25,
      filterAttack: 0.005, filterDecay: 0.3, filterSustain: 0.1, filterRelease: 0.3,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Round Pluck' },
  },
  {
    id: 'bass-punchy-square', name: 'Punchy Square',
    params: { oscType: 'square', subOscVolume: 0.6, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 500, filterResonance: 2, filterEnvAmount: 300,
      attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.15,
      filterAttack: 0.005, filterDecay: 0.15, filterSustain: 0.2, filterRelease: 0.2,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Punchy Square' },
  },
  {
    id: 'bass-saw-growl', name: 'Saw Growl',
    params: { oscType: 'sawtooth', subOscVolume: 0.5, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 700, filterResonance: 6, filterEnvAmount: 500,
      attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3,
      filterAttack: 0.01, filterDecay: 0.25, filterSustain: 0.3, filterRelease: 0.3,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Saw Growl' },
  },
  {
    id: 'bass-warm-tri', name: 'Warm Triangle',
    params: { oscType: 'triangle', subOscVolume: 0.3, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 350, filterResonance: 1, filterEnvAmount: 0,
      attack: 0.03, decay: 0.3, sustain: 0.8, release: 0.5,
      filterAttack: 0.03, filterDecay: 0.3, filterSustain: 1, filterRelease: 0.4,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0, preset: 'Warm Triangle' },
  },
];
```
- ใช้ shape `SynthPresetItem` เดิม (id/name/params) — preset select ใน UI ใช้ได้ทันที
- ค่าเริ่มต้นตามข้างบน tune ปรับระหว่าง implement ได้ตามฟังจริง (research-tuned)

## 5. UI — `src/components/ChordView.tsx`

1. **Mute buttons** ใน header action controls (ข้าง Follow Main Synth):
   - `btn-mute-chord` / `btn-mute-bass` — ไอคอนลำโพง (lucide `Volume2`/`VolumeX`), active color แยก layer (chord=indigo, bass=emerald), label `Chord: ON/OFF` / `Bass: ON/OFF`
2. **Bass Module panel** ใหม่ ใต้ Active Chord Progression blocks — layout เดียวกับ header คอร์ด:
   - Bass preset select (`FACTORY_BASS_PRESETS`)
   - Bass octave select (1–4)
   - Bass pattern select (optgroup ตาม `style`: Walking/Grooves/Minimal)
3. **Per-chord bass override:** ในแต่ละ chord block เพิ่ม select เล็กๆ `Bass: Auto / 3rd / 5th / 7th` — ตัวเลือก derive จาก `chord.notes` (โน้ตที่คอร์ดมีจริง); เปลี่ยน root/quality แล้วคำนวณใหม่ผ่าน flow เดิม (`deriveChordNotes`); ค่าเก็บเป็น note name ใน `chord.bassNote`

## 6. Testing

- **Unit tests (bun:test)** สำหรับ resolver ล้วนๆ — ไฟล์ใหม่ `bassPatterns.test.ts`:
  - token → note name ถูกต้อง (root/5th/7th ของ Cmaj7, F7 ฯลฯ)
  - fallback: 7th ใน triad → 5th
  - approach tokens ชี้หา bassRoot ของคอร์ดถัดไป (รวม wrap จากคอร์ดสุดท้ายกลับคอร์ดแรก)
  - `bassNote` override มีผลต่อทั้ง root token และ approach target
  - timing/hold/staccato คำนวณถูก (16th grid)
- `npm run lint` (`tsc --noEmit`)
- Manual: dev server — เล่น progression แล้วสลับ mute chord/bass ทั้งระหว่างเล่น (ฟัง tails เงียบ instant), เปลี่ยน pattern/octave/preset ฟังผล, กด pad มือ

## 7. Files ที่แตะ

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/audio/bassPatterns.ts` | ใหม่: types, factory patterns, `resolveBassSteps` |
| `src/audio/bassPatterns.test.ts` | ใหม่: unit tests resolver |
| `src/audio/bassPresets.ts` | ใหม่: `FACTORY_BASS_PRESETS` |
| `src/audio/engine.ts` | sourceBuses, `setSourceMuted`, bass mono, routing ผ่าน bus |
| `src/types.ts` | `ChordItem.bassNote?` |
| `src/App.tsx` | 5 state ใหม่ + props + mute effect |
| `src/components/ChordView.tsx` | mute buttons, bass panel, per-chord override, scheduling |

## 8. Out of Scope (ระบุชัด ไม่ทำในรอบนี้)

- Generative/randomized walking bass (seed, rule engine)
- Persist chord/bass module settings ลง ProjectState
- Bass volume/velocity slider แยก (ใช้ mute + preset velocity ไปก่อน)
- แก้ไข bass pattern แบบทีละ step ใน UI (ใช้ preset อย่างเดียว)
- Per-layer EQ / แยก effects send ต่อ layer

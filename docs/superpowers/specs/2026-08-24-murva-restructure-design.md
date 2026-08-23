# murva Codebase Restructure — Design Spec

วันที่: 2026-08-24 | สถานะ: ออกแบบเสร็จ รอ review ก่อนทำ implementation plan

## 1. เป้าหมายและข้อจำกัด

- เป้าหมาย: ลดขนาดไฟล์ยักษ์ (ChordView 2,106 / SequencerView 2,004 / SynthView 1,703 บรรทัด), ตัดโค้ดซ้ำ, ขอบเขตโมดูลชัด บังคับทิศทาง dependency ได้จริง
- ข้อจำกัด: หน้าตา UI เหมือนเดิม; เสียงเหมือนเดิมที่ค่า default; แก้ bug / refactor ที่ดีขึ้นได้; จบงาน `bun test` + `tsc --noEmit` เขียวทั้งหมด
- ตัวชี้วัด: duplication % (jscpd) ก่อน/หลัง, จำนวนบรรทัดรวม, files-touched-per-feature (git log)
- แนวทาง: "รื้อกระดูก" — ย้ายข้อมูล / ลบ dead weight + รวมของซ้ำ + ย้าย playback logic ออกจาก view + บังคับ layering

## 2. สถาปัตยกรรมเป้าหมาย

```
components/  →  store/  →  audio/
    │              │
    ├──→ utils/ ←──┤      (pure, ทุกเลเยอร์ใช้ได้)
    └──→ routing/        (isolated, App ใช้คนเดียว)
```

กฎ (บังคับด้วย ESLint `import/no-restricted-imports`):

1. `audio/` ห้าม import `store/` หรือ `components/` (ตัดวงจร `synthPresets.ts:2`, `instantVibes.ts:2`)
2. store → engine ผ่าน `engineSync` ช่องทางเดียว (ลบ direct engine calls ใน transportSlice, instantVibes, DrumPads, SimpleSynthPanel)
3. components = dumb views: selectors + JSX + handlers ที่เรียก store action; ห้ามเรียก `audioEngine` / `subscribeClock` โดยตรง
4. components อ่านข้อมูลจาก `audio/data` ได้ (read-only)
5. เพิ่ม devDeps: eslint, typescript-eslint, eslint-plugin-import (ปัจจุบันมีแค่ `tsc --noEmit`)

## 3. โมดูลใหม่

| โมดูล | เนื้อหา / ที่มา |
|---|---|
| `audio/data/genrePresets.ts` | `GENRE_PRESETS` ทั้งก้อน (SequencerView 23–1560) |
| `audio/data/chordProgressions.ts` | `CHORD_PROGRESSION_TEMPLATES` + type (ChordView 111–421) — ตัดวงจร ChordView↔ChordPresetLibrary |
| `audio/playback/chordPlayback.ts` + `useChordPlayback` | `buildChordEvents`, `playChordWithRhythm`, `playBassWithPattern`, `scheduleBarInvariantEvents`, `playFullHoldChord`, `playChordLegato`, `startPatternLoop`, `previewChordForScale`, `previewBarSeconds` (ChordView 432–596, 645–773, 845–870) |
| `audio/playback/sequencerPlayback.ts` + `useSequencerPlayback` | `playStepSounds` (1602–1631) + clock subscription (1633–1650) |
| `audio/playback/arpPlayback.ts` + `useArpPlayback` | arp subscriber parameterized — ยุบ 4 branch (SynthView 281–405) เหลือ 1 |
| `audio/playback/drumPlayback.ts` | `triggerPad` รวม 3 เส้นทาง (DrumPads 22–27, playStepSounds, SynthView preview) |
| `store/instantVibes.ts` | ย้ายจาก `audio/instantVibes.ts`; เหลือ state setters (63–132) ไม่มี engine calls |
| `components/ui/PresetLibrary.tsx` + config chord/synth | รวม ChordPresetLibrary (642) + SynthPresetLibrary (511) เป็น generic |
| `components/ui/ChannelStrip.tsx` | chord/bass panel คู่ขนานใน ChordView (~200 บรรทัดซ้ำ) |
| `components/ui/QuickSavePopover.tsx` | popover ซ้ำ (ChordView 1264–1298, SynthView 837–884) |
| `components/ui/Keyboard.tsx` | ScaleLocked + Chromatic (SynthView 1509–1703) + mapping จาก utils/keyboard.ts อยู่บ้านเดียวกัน |
| `components/ui/Slider.tsx` | unify raw `<input range>` ใน TransportBar / DrumPads / ChordView |
| `components/chord/SortableChordCard.tsx` | ChordView 1891–2106 |

หมายเหตุ: แต่ละ view mount hook ของตัวเอง (`useChordPlayback` ฯลฯ) เพื่อคง per-view clock subscription เหมือนปัจจุบัน — เปลี่ยนแค่ที่อยู่ของโค้ด ไม่เปลี่ยน timing

## 4. ลบ dead weight + ทำ knob ให้ทำงาน

**ลบ** (ยืนยันแล้วว่าไม่มีใครอ่าน): `chorusRate/Depth/Wet`, `compressorRatio/Bypass`, `delayTime`, `distortionDrive`, `portamento`, `solo`, `velocities` (types.ts), `applySynthPreset` (synthSlice:21), `updateCustomPreset` (presetsSlice:39 + wrapper), `quarterNoteMs`, `isChordDiatonic` (musicTheory), `DEFAULT_PADS` + `groups` useMemo (DrumPads), unused lucide imports, dead comments (ChordView 1300–1302)

**ทำ knob ให้ทำงานจริง** (ตัดสินใจแล้ว — ไม่ลบ):
- `reverbDecay` → map เข้า convolver decay
- `compressorThreshold` → แทน hardcode −12 (engine.ts:203)
- default ต้องคงเสียงเดิมเป๊ะ; เสียงเปลี่ยนเฉพาะเมื่อผู้ใช้บิด
- ผู้ใช้เก่า: ค่า persist เดิมจะเริ่มมีผล — ยอมรับ; clamp ให้อยู่ในช่วงที่สมเหตุสมผลตอน rehydrate

## 5. Data flow

```
UI event → store action → persist → engineSync (subscribeWithSelector, per-slice selector, fireImmediately, unsubscribe teardown) → engine
                                      ↑
      useChordPlayback / useSequencerPlayback / useArpPlayback ← subscribeClock ← engine
```

- ขาลงช่องเดียวผ่าน engineSync — ไม่มี event bus
- ขาขึ้น: per-view tick subscription คงเดิม (step highlight ต้อง tick-accurate — bounded 10Hz ใช้ไม่ได้กับ step grid)
- Derived ไม่ store: current step / beat position คำนวณจาก clock ไม่ mirror ลง store
- Selector sweep: ทุก multi-field selector → atomic / `useShallow` (Zustand 5: selector ที่คืน reference ใหม่ crash ได้)

## 6. Edge cases

- engine ยังไม่ init (ก่อน user gesture แรก): playback modules ต้อง no-op ปลอดภัย
- localStorage เก่า: ขยาย `sanitizePersistedState` ให้ strip fields ที่ลบ + clamp ค่า knob ที่เพิ่งทำงาน; migration tests คงอยู่
- Tests pin exported surface (ChordView.test, synthPresets.test:116, store.test key set, Knob variants): ย้าย import ตาม / ลบ case ของสิ่งที่ลบ
- 4 views mount พร้อมกัน (App 101–113): คง lifecycle เดิม
- ลำดับงานแบบ Tidy First: extract playback → เทสต์เขียว → ค่อยแตะ UI; step เล็ก ไม่มี big-bang refactor

## 7. เทสต์และตัวเลข

- ทุก step: `bun test` + `tsc --noEmit` เขียว
- ย้าย: ChordView.test helpers → chordPlayback.test; ลบ: updateCustomPreset case; เพิ่ม: genrePresets/chordProgressions data sanity, arp branch เทียบ behavior เดิม, engineSync bootstrap
- วัดก่อน/หลัง: jscpd duplication %, LOC รวม, files-touched-per-feature — รายงานตอนจบงาน
- ESLint complexity warning (warn-only) หลังเพิ่ม ESLint

## 8. อยู่นอก scope (ตั้งใจ)

- FSD / feature-first rename, event bus, signals / Jotai, shadcn / Radix adoption, barrel files
- ยุบ drum pattern 3 รูปแบบ (GENRE_PRESETS / instantVibes.drumPattern / GENRE_TO_KIT) — ตัดสินใจทีหลังหลังเห็นตัวเลขจริง
- React Compiler — ประเมิน report-only หลัง restructure เสร็จ (optional)
- ย้าย DSP ไป Worker (scale-up path เท่านั้น)

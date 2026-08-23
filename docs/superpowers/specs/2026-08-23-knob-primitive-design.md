# Knob Primitive — Design Spec

วันที่: 2026-08-23
สถานะ: approved (pending user review)
อ้างอิง Figma: file `4Uzca4x1I9J2ts6kObDRYE` (meter), frame `64:126` "Knobs"

## 1. เป้าหมาย

สร้าง shared primitive component `Knob` ตัวแรกของโปรเจกต์ (murva) สำหรับใช้แทน/ร่วมกับ
`<input type="range">` เดิมใน synth UI — รองรับการปรับค่าแบบ knob หมุนตาม design จาก Figma
(5 ขนาด xs–xl, เข็ม + จุดกลางสี `#877dca`, วงแหวน border)

## 2. การตัดสินใจที่อนุมัติแล้ว

| หัวข้อ | การตัดสินใจ |
|---|---|
| Interaction | ลากได้ทั้งแกนตั้งและแนวนอน (แกนที่สะสมระยะมากกว่าชนะ แล้วยึดแกนนั้นจนจบ gesture) |
| API | Typed controlled API — `value`/`onChange(value)` ส่ง number ตรง |
| Scale | `scale: 'linear' \| 'log'` (log สำหรับ frequency/loudness) |
| Rendering | สร้าง inline SVG/CSS เอง ไม่เก็บ asset จาก Figma (SVG border ดาวน์โหลดมาอ้างอิงขีด notch ตอน implement เท่านั้น) |
| Scope | Knob + label + ค่าแสดงผล (format prop) ใน component เดียว |
| Input กลไก | Custom pointer events + keyboard/ARIA เขียนเอง (ไม่ใช้ library, ไม่มี hidden input) |

## 3. Component API

ไฟล์: `src/components/ui/Knob.tsx` (โฟลเดอร์ `ui/` = บ้านของ primitive)
ตรรกะ: `src/utils/knob.ts` (pure functions)

```ts
export type KnobScale = 'linear' | 'log';
export type KnobSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type KnobIndicator = 'progress' | 'none' | 'full';

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;            // default 0
  max?: number;            // default 1
  step?: number;           // default: ต่อเนื่องไม่ snap
  scale?: KnobScale;       // default 'linear'
  size?: KnobSize;         // default 'md'
  label?: string;
  format?: (v: number) => string;  // default: String(v)
  indicator?: KnobIndicator; // default 'progress' — วงแหวนแสดงความคืบหน้าตามเข็ม
  detent?: number;           // ค่าที่วาดขีด notch; undefined = ไม่มี (visual only ไม่ snap)
  disabled?: boolean;
  id?: string;
  className?: string;
}
```

- controlled เสมอ ไม่มี uncontrolled mode (YAGNI)
- `scale: 'log'` ต้องใช้กับ `min > 0`; ถ้า `min <= 0` → fallback เป็น linear
- `indicator`: `'none'` = วงบางสม่ำเสมอไม่มีส่วนที่เข้มตามเข็ม; `'full'` = วงหนา static เต็มวง;
  ใช้กับ balance/pan (ตรงกลาง = 0) เช่น `<Knob indicator="none" detent={0} min={-1} max={1}>`
- `detent`: ขีด notch ที่มุมของค่านั้น (valueToT + angleForT) — pan ได้ขีดที่ 12 น. โดยอัตโนมัติ
  (0 = กลาง range); volume dB วาง `detent={0}` แล้วขีดไปอยู่ที่มุมของ 0dB ตาม scale จริง;
  ค่านอก [min, max] → ไม่วาดขีด; visual only ไม่ snap ค่า
- ตัวอย่างการผูก store: `onChange={(v) => onChangeParams({ ...params, detune: v })}` (ไม่ต้อง parseFloat)

## 4. พฤติกรรม

### 4.1 Drag (pointer events)
- `pointerdown` → `setPointerCapture` (ลากต่อเนื่องแม้ออกนอกปุ่ม) → `pointerup` ปล่อย
- เลือกแกนจากระยะ |delta| สะสม เกิน 3px (กันสั่น) → ยึดแกนนั้นจนจบ gesture
- Sensitivity: ~200px = เต็ม range; กด Shift = ÷10 (fine control)
- clamp ใน [min, max]; snap ตาม `step` ใน space ของค่าจริง
- Pointer interaction ไม่ focus knob — จบ gesture (pointerup/cancel) จะ blur คืน focus
  ให้ keyboard (เช่น เล่น note); keyboard focus ผ่าน Tab ยังใช้งานได้พร้อม focus ring

### 4.2 การ map ค่า
- `t = (value − min) / (max − min)` ∈ [0,1]
- linear: `value = min + t·(max − min)`
- log: `value = min·(max/min)^t`; inverse: `t = ln(value/min) / ln(max/min)`
- มุมเข็ม: **270° sweep** — `angleForT(t) = −135 + t·270`
  (t=0 → 7:30 น., t=0.5 → ชี้ตรง 12 น. ตามภาพ design, t=1 → 4:30 น.)

### 4.3 Keyboard (role="slider" + ARIA)
- `↑/→` +1 step, `↓/←` −1 step (continuous = 1% ของ range)
- `PageUp/PageDown` ±10 steps (หรือ 10% ของ range)
- `Home` = min, `End` = max
- `aria-valuemin/valuemax/valuenow`, `aria-label` จาก `label`, focus ring ชัดเจน
- `disabled` → ถอดจาก tab order

### 4.4 ไม่ทำ (YAGNI)
- scroll wheel ปรับค่า (กัน hijack), double-click reset

## 5. Rendering

- `<svg viewBox="0 0 100 100">` ต่อ knob: วงแหวน border + **progress arc** + needle group + จุดกลาง
- **Invariant: เข็มกับปลาย progress arc ใช้ `angleForT` ตัวเดียวกัน** — คำนวณจากค่า `value` เดียว
  ปลาย arc ชี้ตรงกับเข็มและค่าที่แสดงเสมอ (มี test ครอบ) ความหนา stroke ของ arc เท่ากับ border
- Progress arc = ส่วนโค้งจากตำแหน่ง min (−135°) กวาดตามเข็มนาฬิกาถึงมุมปัจจุบัน สีเดียวกับเข็ม;
  แสดงตาม `indicator`: `'progress'` (default) / `'none'` (ไม่วาด) / `'full'` (วงหนาเต็มวง static)
- Detent notch: ขีดสั้นบนวงแหวนที่มุม `angleForT(valueToT(detent, ...))` — ข้ามเมื่อ detent นอก [min, max];
  เป็นขีดเดียวของ component (ไม่มี static notch ใน render ปกติ)
- Needle หมุนด้วย CSS `transform: rotate()` + `transform-origin` กลาง; สี `fill="currentColor"`
  default `text-[#877dca]` (จาก design) override ได้ผ่าน `className`
- ขนาดตาม Figma: xs 22 / sm 36 / md 48 (default) / lg 60 / xl 72 px; สัดส่วนเข็ม/จุดกลาง scale ตาม
- Label + ค่า: flex column กึ่งกลาง — label บน, knob กลาง, ค่าล่าง (`text-[10px]` mono, ค่า
  `text-indigo-300`) — layout แบบ ADSR; แต่ละชุด knob เรียงเป็น flex row ในแต่ละ panel
- ไม่ใช้ motion library — CSS transition พอ

## 6. Testing

- Unit test `bun test` บน pure functions ใน `src/utils/knob.ts` (pattern เดียวกับ `musicTheory.test.ts`):
  - clamp + snap ตาม step
  - linear map roundtrip (value → t → value)
  - log map roundtrip + fallback linear เมื่อ min ≤ 0
  - `angleForT`: 0 → −135°, 0.5 → 0°, 1 → +135° (เข็ม = ปลาย progress arc)
  - `detentAngle`: ค่าใน range → มุมถูกต้อง; ค่านอก [min, max] → null (ไม่วาดขีด)
- Component ไม่มี test infra (repo ไม่มี @testing-library) — `tsc --noEmit` + เช็คในเบราว์เซอร์

## 7. Migration

- Ship `Knob` primitive + migrate **ทุก synth panel เป็น Knob (layout แบบ ADSR)**:
  - `SynthView`: Oscillators (sub/detune/noise), Filter (cutoff `scale="log"`, resonance, env),
    Envelope ADSR (attack/decay/sustain/release ทั้ง AMP + FILTER), LFO (rate/depth)
  - `EffectsRackView`: reverb (wet/decay), delay (wet/feedback), distortion (wet),
    EQ (low/mid/high — `detent={0}` ชี้ตำแหน่ง 0dB ของ range ±15)

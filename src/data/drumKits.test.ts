import { describe, expect, test } from 'bun:test';
import { DEFAULT_DRUM_KIT, DRUM_KITS, DRUM_TYPES, type DrumType } from './drumKits';
import { mergeDrumKit } from '@/audio/drumKits';

describe('DRUM_KITS', () => {
  test('holds 13 kits', () => {
    expect(Object.keys(DRUM_KITS).length).toBe(13);
  });

  test('DRUM_TYPES is the same set as keyof DrumKit', () => {
    // DEFAULT_DRUM_KIT is annotated `: DrumKit`, so TypeScript already forbids
    // a missing or an extra key on it: Object.keys(DEFAULT_DRUM_KIT) IS
    // `keyof DrumKit` at runtime. This assertion — not the shared constant —
    // is what makes adding a voice to the interface and forgetting the list
    // impossible. Sorted copies, because DRUM_TYPES's order is trigger order
    // and carries no meaning here.
    const declared: string[] = [...DRUM_TYPES];
    expect(declared.sort()).toEqual(Object.keys(DEFAULT_DRUM_KIT).sort());
  });

  test('the default kit defines every drum type', () => {
    // mergeDrumKit spreads DEFAULT_DRUM_KIT under each partial, so a missing
    // type here is an `undefined` params object reaching the engine.
    for (const type of DRUM_TYPES) {
      expect(DEFAULT_DRUM_KIT[type], type).toBeDefined();
    }
  });

  test('no kit introduces a drum type the default does not have', () => {
    for (const [name, kit] of Object.entries(DRUM_KITS)) {
      // 'reference' is documentation, not a voice — it lives on the DRUM_KITS
      // entry type, not on DrumKit, and is asserted separately below.
      for (const type of Object.keys(kit).filter((key) => key !== 'reference')) {
        expect(DRUM_TYPES, `${name}.${type}`).toContain(type as DrumType);
      }
    }
  });

  // Kits with no external referent. SHRINKS BY DEFAULT, GROWS ONLY DELIBERATELY:
  // putting a name here is an edit a reviewer sees, which is the whole mechanism —
  // it makes shipping an un-referenced kit an act rather than an omission.
  //   Chrome Pulse — solna's own bright/hard/wet kit, tied to the Cyberpunk grid.
  // Club Standard is deliberately NOT here. It was renamed off `909 Modern`
  // because the NAME overclaimed; its reference still records the TR-909, with
  // the per-voice split that is decision 7's own worked example. A rename is not
  // an erasure, and this list is for kits with no referent at all.
  const AUTHORED_KITS = ['Chrome Pulse'];

  test('every kit records what it is modelled on, in all three fields', () => {
    for (const [name, kit] of Object.entries(DRUM_KITS)) {
      expect(kit.reference, `${name} has no reference`).toBeDefined();
      expect(kit.reference.referent.length, `${name} referent`).toBeGreaterThan(0);
      expect(kit.reference.source.length, `${name} source`).toBeGreaterThan(0);
      expect(kit.reference.reachable.length, `${name} reachable`).toBeGreaterThan(0);
    }
  });

  test("a kit claiming no referent says 'authored', and is on the allowlist", () => {
    const authored = Object.entries(DRUM_KITS)
      .filter(([, kit]) => kit.reference.referent === 'authored')
      .map(([name]) => name);
    expect(authored.sort()).toEqual([...AUTHORED_KITS].sort());
  });

  // `.some(...)` only proves a `reachable` string names at least one voice —
  // it cannot prove every voice got a verdict, which is what "per voice" as a
  // design principle actually promises. Renamed to say that, honestly, rather
  // than to claim more than it checks. The real per-kit counts (of 11 voices
  // named), computed by this same substring test, so the gap stays visible
  // instead of implied: Retro Drive 10, Club Standard 11, Trap Beat 8,
  // 808 Vintage 11, Chrome Pulse 4, Velocity Breaks 8, Sub Weight 10,
  // Warehouse 8, Tight Pocket 10, Acoustic Studio 10, Warm Riddim 10,
  // Lo-Fi Vinyl 10, Dusty Break 10. Chrome Pulse is the floor because it is
  // authored — every voice is reachable by definition, so its prose says
  // that once instead of naming all eleven.
  test('reachable names at least one voice explicitly (a floor, not full per-voice coverage)', () => {
    // The TR-909 is the proof of the PRINCIPLE this floor stands in for: kick,
    // snare, toms and clap are analogue and genuinely reachable; hats, ride
    // and crash are 6-bit PCM of real Paiste and Zildjian cymbals and never
    // will be. A per-kit score would average those into a number that is true
    // of no voice — that is what `reachable` being prose-per-voice prevents,
    // even though this assertion only checks that the prose engages with the
    // voice roster at all, not that it accounts for every voice.
    for (const [name, kit] of Object.entries(DRUM_KITS)) {
      const namesAVoice = DRUM_TYPES.some((voice) => kit.reference.reachable.includes(voice));
      expect(namesAVoice, `${name} reachable names no voice`).toBe(true);
    }
  });

  test('every kit puts its hi tom about an octave above its low tom, under the snare cap', () => {
    for (const [name, partial] of Object.entries(DRUM_KITS)) {
      const k = mergeDrumKit(partial);
      const ratio = k.hitom.freqEnd / k.lowtom.freqEnd;
      expect(ratio, `${name} hi/low tom ratio`).toBeGreaterThanOrEqual(1.68);
      expect(ratio, `${name} hi/low tom ratio`).toBeLessThanOrEqual(2.15);
      expect(k.hitom.freqEnd, `${name} hitom vs snare body`)
        .toBeLessThanOrEqual(0.85 * k.snare.bodyFreqEnd);
      // Same drummer, same room.
      expect(k.hitom.reverbSend, `${name} tom sends`).toBe(k.lowtom.reverbSend);
      expect(k.hitom.gain, `${name} tom gains`).toBeCloseTo(k.lowtom.gain, 2);
    }
  });

  test('every bell is a detuned fifth under a bandpass just above its top partial', () => {
    for (const [name, partial] of Object.entries(DRUM_KITS)) {
      const b = mergeDrumKit(partial).bell;
      const fifth = b.freq1 / b.freq2;
      // 1.481 exactly would be a just fifth; the point is that it is NOT, so the
      // two oscillators beat. A tidy 1.5 removes the beating and the bell dies,
      // so the upper bound stops short of 1.5 rather than admitting it — the
      // library's actual max (Warehouse, 1.482) clears it with margin.
      expect(fifth, `${name} bell interval`).toBeGreaterThanOrEqual(1.4);
      expect(fifth, `${name} bell interval`).toBeLessThanOrEqual(1.49);
      const placement = b.filter / b.freq1;
      expect(placement, `${name} bell bandpass`).toBeGreaterThanOrEqual(1.05);
      expect(placement, `${name} bell bandpass`).toBeLessThanOrEqual(1.25);
    }
  });
});

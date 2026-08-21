 
import { describe, it, expect } from 'vitest';
import {
  DRUM_BEAT_INSTRUMENTS,
  InstrumentCategory,
} from '@/engine/instruments/shared/constants';
import {
  groupSoundfontInstruments,
  groupSynthesizerInstruments,
  groupDrumMachines,
  groupAcousticDrumsets,
  getGroupedInstrumentsForCategory,
} from '../instrumentGrouping';

describe('instrumentGrouping utils', () => {
  describe('groupSoundfontInstruments', () => {
    it('should correctly group soundfont instruments by music categories', () => {
      const result = groupSoundfontInstruments();
      expect(result.length).toBeGreaterThan(0);

      // Verify that elements have standard GroupedOption fields
      const firstItem = result[0];
      expect(firstItem).toHaveProperty('value');
      expect(firstItem).toHaveProperty('label');
      expect(firstItem).toHaveProperty('group');
    });

    it('should classify piano soundfont correctly', () => {
      const result = groupSoundfontInstruments();
      const pianoOpt = result.find((item) => item.value === 'acoustic_grand_piano');
      expect(pianoOpt).toBeDefined();
      expect(pianoOpt?.group).toBe('Piano');
    });

    it('should classify guitar soundfont correctly', () => {
      const result = groupSoundfontInstruments();
      const guitarOpt = result.find((item) => item.value === 'electric_guitar_clean');
      expect(guitarOpt).toBeDefined();
      expect(guitarOpt?.group).toBe('Guitar');
    });
  });

  describe('groupSynthesizerInstruments', () => {
    it('should correctly group synthesizers', () => {
      const result = groupSynthesizerInstruments();
      expect(result.length).toBeGreaterThan(0);

      // Synthesizers must be Analog or FM group
      result.forEach((item) => {
        expect(['Analog', 'FM']).toContain(item.group);
      });
    });
  });

  describe('groupDrumMachines', () => {
    const result = groupDrumMachines(DRUM_BEAT_INSTRUMENTS);

    it('should list drum machines correctly, sub-grouped by sound character (DEV-294)', () => {
      expect(result.length).toBeGreaterThan(0);
      // No longer a single flat "Drum Machines" group — each item belongs
      // to Studio HD or one of the 5 DrumAbuse character groups.
      result.forEach((item) => {
        expect(item.group).not.toBe('Drum Machines');
        expect(item.group).not.toBe('Other');
      });
    });

    it("no longer uses a single flat 'Drum Machines' group", () => {
      const groups = new Set(result.map((o) => o.group));
      expect(groups.has('Drum Machines')).toBe(false);
      expect(groups.size).toBeGreaterThanOrEqual(6); // Studio HD + 5 character groups
    });

    it('puts the 5 hi-fi machines under Studio HD', () => {
      const studio = result
        .filter((o) => o.group === 'Studio HD')
        .map((o) => o.value);
      expect(studio).toEqual(
        expect.arrayContaining([
          'TR-808',
          'Casio-RZ1',
          'LM-2',
          'MFB-512',
          'Roland CR-8000',
        ]),
      );
    });
  });

  describe('groupAcousticDrumsets', () => {
    it('should list acoustic drumsets correctly', () => {
      const result = groupAcousticDrumsets();
      expect(result.length).toBeGreaterThan(0);
      result.forEach((item) => {
        expect(item.group).toBe('Acoustic Kits');
        expect(item.value).toBe('versilian_drumset');
        expect(item.label).toBe('Versilian Drumset');
      });
    });
  });

  describe('getGroupedInstrumentsForCategory', () => {
    it('should return melodic options when requested', () => {
      const result = getGroupedInstrumentsForCategory(
        InstrumentCategory.Melodic,
        DRUM_BEAT_INSTRUMENTS,
      );
      const hasPiano = result.some((item) => item.value === 'acoustic_grand_piano');
      expect(hasPiano).toBe(true);
    });

    it('should return drum beat options when requested', () => {
      const result = getGroupedInstrumentsForCategory(
        InstrumentCategory.DrumBeat,
        DRUM_BEAT_INSTRUMENTS,
      );
      const hasTR808 = result.some((item) => item.value === 'TR-808');
      expect(hasTR808).toBe(true);
    });

    it('should return acoustic drumset options when requested', () => {
      const result = getGroupedInstrumentsForCategory(
        InstrumentCategory.AcousticDrumset,
        DRUM_BEAT_INSTRUMENTS,
      );
      const hasAcousticKit = result.some((item) => item.value === 'versilian_drumset');
      expect(hasAcousticKit).toBe(true);
    });

    it('should return synthesizer options when requested', () => {
      const result = getGroupedInstrumentsForCategory(
        InstrumentCategory.Synthesizer,
        DRUM_BEAT_INSTRUMENTS,
      );
      const hasSynth = result.some((item) => item.value === 'analog_mono');
      expect(hasSynth).toBe(true);
    });

    it('should fall back to melodic options for invalid categories', () => {
      const result = getGroupedInstrumentsForCategory(
        'invalid_category',
        DRUM_BEAT_INSTRUMENTS,
      );
      const hasPiano = result.some((item) => item.value === 'acoustic_grand_piano');
      expect(hasPiano).toBe(true);
    });
  });
});

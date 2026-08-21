 
import { describe, it, expect } from 'vitest';
import { InstrumentCategory } from '@/engine/instruments/shared/constants';
import {
  getInstrumentCategoryById,
  getInstrumentLabelById,
  getDefaultInstrumentForCategory,
} from '../instrumentLookup';

describe('instrumentLookup utils', () => {
  describe('getInstrumentCategoryById', () => {
    it('should map soundfont instruments to melodic category', () => {
      expect(getInstrumentCategoryById('acoustic_grand_piano')).toBe(InstrumentCategory.Melodic);
      expect(getInstrumentCategoryById('electric_guitar_clean')).toBe(InstrumentCategory.Melodic);
      expect(getInstrumentCategoryById('fretless_bass')).toBe(InstrumentCategory.Melodic);
    });

    it('should map drum machines to drum_beat category', () => {
      expect(getInstrumentCategoryById('TR-808')).toBe(InstrumentCategory.DrumBeat);
      expect(getInstrumentCategoryById('MFB-512')).toBe(InstrumentCategory.DrumBeat);
      expect(getInstrumentCategoryById('drumabuse:roland-tr-909')).toBe(InstrumentCategory.DrumBeat);
    });

    it('should map acoustic drumsets to acoustic_drumset category', () => {
      expect(getInstrumentCategoryById('versilian_drumset')).toBe(InstrumentCategory.AcousticDrumset);
    });

    it('should map synthesizer instruments to synthesizer category', () => {
      expect(getInstrumentCategoryById('analog_mono')).toBe(InstrumentCategory.Synthesizer);
      expect(getInstrumentCategoryById('fm_poly')).toBe(InstrumentCategory.Synthesizer);
    });

    it('should default to melodic category for unknown instrument IDs', () => {
      expect(getInstrumentCategoryById('unknown_instrument_id')).toBe(InstrumentCategory.Melodic);
    });
  });

  describe('getInstrumentLabelById', () => {
    it('should return human-readable labels for soundfont instruments', () => {
      expect(getInstrumentLabelById('acoustic_grand_piano')).toBe('Acoustic Grand Piano');
      expect(getInstrumentLabelById('electric_guitar_clean')).toBe('Electric Guitar (Clean)');
    });

    it('should return human-readable labels for drum machines', () => {
      expect(getInstrumentLabelById('TR-808')).toBe('Roland TR-808');
      expect(getInstrumentLabelById('MFB-512')).toBe('Fricke MFB-512');
      expect(getInstrumentLabelById('drumabuse:roland-tr-909')).toBe('Roland TR-909');
    });

    it('should return human-readable labels for acoustic drumsets', () => {
      expect(getInstrumentLabelById('versilian_drumset')).toBe('Versilian Drumset');
    });

    it('should return human-readable labels for synthesizer instruments', () => {
      expect(getInstrumentLabelById('analog_mono')).toBe('Analog Mono Synth');
      expect(getInstrumentLabelById('fm_poly')).toBe('FM Poly Synth');
    });

    it('should fall back to Select Instrument for completely unknown IDs', () => {
      expect(getInstrumentLabelById('completely_unknown_id')).toBe('Select Instrument');
    });
  });

  describe('getDefaultInstrumentForCategory', () => {
    it('should return correct default for Melodic', () => {
      expect(getDefaultInstrumentForCategory(InstrumentCategory.Melodic)).toBe('acoustic_grand_piano');
    });

    it('should return correct default for DrumBeat', () => {
      expect(getDefaultInstrumentForCategory(InstrumentCategory.DrumBeat)).toBe('MFB-512');
    });

    it('should return correct default for AcousticDrumset', () => {
      expect(getDefaultInstrumentForCategory(InstrumentCategory.AcousticDrumset)).toBe('versilian_drumset');
    });

    it('should return correct default for Synthesizer', () => {
      expect(getDefaultInstrumentForCategory(InstrumentCategory.Synthesizer)).toBe('analog_mono');
    });
  });
});


import { deriveRoleFromInstrument, defaultStyleForInstrument } from '@jam-band/shared';

describe('deriveRoleFromInstrument', () => {
  it('maps bass instruments to bass, drums to beat, and guitar/piano to chord', () => {
    expect(deriveRoleFromInstrument('electric_bass_finger')).toBe('bass');
    expect(deriveRoleFromInstrument('TR-808')).toBe('beat');
    expect(deriveRoleFromInstrument('electric_guitar_clean')).toBe('chord');
    expect(deriveRoleFromInstrument('acoustic_grand_piano')).toBe('chord');
  });
});

describe('defaultStyleForInstrument', () => {
  it('defaults guitar chord instruments to strum', () => {
    expect(defaultStyleForInstrument('electric_guitar_clean')).toBe('strum');
    expect(defaultStyleForInstrument('acoustic_guitar_steel')).toBe('strum');
  });

  it('defaults other chord instruments to block', () => {
    expect(defaultStyleForInstrument('acoustic_grand_piano')).toBe('block');
    expect(defaultStyleForInstrument('string_ensemble_1')).toBe('block');
  });

  it('uses role defaults for non-chord instruments (bass guitar is bass, not strum)', () => {
    expect(defaultStyleForInstrument('electric_bass_finger')).toBe('root-fifth');
    expect(defaultStyleForInstrument('TR-808')).toBe('basic');
  });
});

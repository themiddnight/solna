/* eslint-disable @typescript-eslint/naming-convention -- fixture object keys mirror real
   settings-namespace Record<string, ...> keys (slot index `0`, instrument id `drum-machine`),
   which are inherently digit/hyphen-bearing and can never satisfy camelCase/PascalCase/UPPER_CASE. */
import { UserPreferencesService } from '../UserPreferencesService';
import { UserPreferencesRepository } from '../../../infrastructure/repositories/UserPreferencesRepository';
import { USER_PREFERENCES_SCHEMA_VERSION, ChordModifierType } from '@jam-band/shared';

jest.mock('../../../infrastructure/repositories/UserPreferencesRepository');

const MockRepo = UserPreferencesRepository as jest.MockedClass<typeof UserPreferencesRepository>;

const chords = {
  degreeOrder: [0, 5, 3, 4, 1, 2, 6],
  slotModifiers: { '0': [ChordModifierType.SUS2] },
};
const drumpad = {
  padOrder: Array.from({ length: 16 }, (_, i) => `pad-${i}`),
  padVolumes: { 'drum-machine': { C2: 0.8 } },
};

describe('UserPreferencesService.updateSettings', () => {
  beforeEach(() => {
    MockRepo.mockClear();
  });

  it('merges one namespace without disturbing the others', async () => {
    const findByUserId = jest.fn().mockResolvedValue({
      userId: 'u1',
      theme: 'murva-dark',
      settings: { version: USER_PREFERENCES_SCHEMA_VERSION, chords, drumpad },
    });
    const updateSettings = jest.fn().mockImplementation((_userId: string, settings: unknown) =>
      Promise.resolve({ userId: 'u1', theme: 'murva-dark', settings })
    );
    MockRepo.prototype.findByUserId = findByUserId;
    MockRepo.prototype.updateSettings = updateSettings;

    const service = new UserPreferencesService();
    const nextChords = { degreeOrder: [6, 5, 4, 3, 2, 1, 0], slotModifiers: {} };
    const result = await service.updateSettings('u1', { chords: nextChords });

    expect(result.settings.chords).toEqual(nextChords);
    expect(result.settings.drumpad).toEqual(drumpad);
  });

  it('rejects an invalid patch before touching the repository', async () => {
    const updateSettings = jest.fn();
    MockRepo.prototype.findByUserId = jest.fn().mockResolvedValue(null);
    MockRepo.prototype.updateSettings = updateSettings;

    const service = new UserPreferencesService();
    await expect(
      service.updateSettings('u1', { chords: { degreeOrder: [1, 2], slotModifiers: {} } } as never)
    ).rejects.toThrow('Invalid preferences payload');
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('normalizes a read failure instead of letting the raw error escape', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const readError = new Error('connection dropped');
    MockRepo.prototype.findByUserId = jest.fn().mockRejectedValue(readError);
    const updateSettings = jest.fn();
    MockRepo.prototype.updateSettings = updateSettings;

    const service = new UserPreferencesService();
    const nextChords = { degreeOrder: [6, 5, 4, 3, 2, 1, 0], slotModifiers: {} };

    await expect(service.updateSettings('u1', { chords: nextChords })).rejects.toThrow(
      'Failed to update preferences. Please try again later.'
    );
    expect(updateSettings).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('drops a corrupt stored namespace on read instead of failing', async () => {
    MockRepo.prototype.findByUserId = jest.fn().mockResolvedValue({
      userId: 'u1',
      theme: 'murva-dark',
      settings: { version: 1, chords, drumpad: { padOrder: ['pad-0'], padVolumes: {} } },
    });

    const service = new UserPreferencesService();
    const result = await service.getPreferences('u1');

    expect(result.settings.chords).toEqual(chords);
    expect(result.settings.drumpad).toBeUndefined();
  });
});

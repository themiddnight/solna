/* eslint-disable @typescript-eslint/naming-convention -- fixture keys mirror real settings
   namespace Record keys (slot index `0`, instrument id `drum-machine`, GM note `C2`), which
   are inherently digit/hyphen-bearing and can never satisfy camelCase/PascalCase. */

/**
 * Proves the settings write is atomic per namespace (DEV-333).
 *
 * A read-modify-write merge passes every sequential test and still loses data the moment
 * two requests overlap — which is exactly what a returning user's first authenticated boot
 * used to do, one PATCH per adopted namespace. These tests overlap the writes on purpose.
 */
import { USER_PREFERENCES_SCHEMA_VERSION, parsePreferencesLenient } from '@jam-band/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { UserPreferencesRepository } from '../infrastructure/repositories/UserPreferencesRepository';

const chords = { degreeOrder: [0, 5, 3, 4, 1, 2, 6], slotModifiers: {} };
const drumpad = {
  padOrder: Array.from({ length: 16 }, (_, index) => `pad-${index}`),
  padVolumes: { 'drum-machine': { C2: 0.8 } },
};
const scaleSlots = {
  slots: [{ id: 1, rootNote: 'C', scale: 'major', shortcut: '1' }],
};

const versioned = (namespaces: Prisma.InputJsonObject): Prisma.InputJsonObject => ({
  version: USER_PREFERENCES_SCHEMA_VERSION,
  ...namespaces,
});

describe('UserPreferencesRepository.updateSettings (atomic per-namespace merge)', () => {
  const repo = new UserPreferencesRepository();
  let userId = '';

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `prefs-test-${Date.now()}`,
        email: `prefs-test-${Date.now()}@test.com`,
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.userPreferences.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('creates the row when the user has no preferences yet', async () => {
    const written = await repo.updateSettings(userId, versioned({ chords }), versioned({ chords }));

    expect(parsePreferencesLenient(written.settings).chords).toEqual(chords);
    expect(written.theme).toBe('murva-dark');
  });

  it('leaves the namespaces it does not own exactly as stored', async () => {
    await repo.updateSettings(userId, versioned({ chords, drumpad }), versioned({ chords, drumpad }));

    const nextChords = { degreeOrder: [6, 5, 4, 3, 2, 1, 0], slotModifiers: {} };
    const written = await repo.updateSettings(
      userId,
      versioned({ chords: nextChords }),
      versioned({ chords: nextChords })
    );

    const stored = parsePreferencesLenient(written.settings);
    expect(stored.chords).toEqual(nextChords);
    expect(stored.drumpad).toEqual(drumpad);
  });

  it('keeps every namespace when three writes overlap in flight', async () => {
    // The adoption path used to send exactly this: one request per namespace, all issued
    // in the same tick, all reading the same empty document.
    await Promise.all([
      repo.updateSettings(userId, versioned({ chords }), versioned({ chords })),
      repo.updateSettings(userId, versioned({ drumpad }), versioned({ drumpad })),
      repo.updateSettings(userId, versioned({ scaleSlots }), versioned({ scaleSlots })),
    ]);

    const record = await repo.findByUserId(userId);
    const stored = parsePreferencesLenient(record?.settings ?? null);

    expect(stored.chords).toEqual(chords);
    expect(stored.drumpad).toEqual(drumpad);
    expect(stored.scaleSlots).toEqual(scaleSlots);
  });
});

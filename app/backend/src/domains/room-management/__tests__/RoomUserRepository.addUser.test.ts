/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Unit Tests: RoomUserRepository.addUser partial-failure guard (DEV-144)
 *
 * Root cause: addUser used Promise.all([set, sadd]) but both RedisStateService
 * methods catch their own errors and return false (never throw). This meant
 * addUser always returned true even when sadd hasFailed, leaving the user absent
 * from the roomMembers set — causing the cleanup scan to see the room as empty
 * and delete it, destroying the PerformRoomState mid-session.
 *
 * These tests verify that addUser correctly returns false when either Redis
 * operation fails, so the DEV-138 JOIN_ERROR guard fires and the user is
 * rejected at join time rather than having their room deleted later.
 */
import { RoomUserRepository } from '../infrastructure/repositories/RoomUserRepository';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import type { BandMember, Audience } from '../../../types';

describe('RoomUserRepository.addUser (DEV-144)', () => {
  let repository: RoomUserRepository;
  const ROOM_ID = 'room-add-user-test';

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new RoomUserRepository();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeBandMember(): BandMember {
    return {
      id: 'user-1',
      username: 'testuser',
      role: 'band_member',
      isReady: false,
      currentInstrument: 'acoustic_grand_piano',
      currentCategory: 'melodic',
      profilePictureUrl: null,
    };
  }

  function makeAudience(): Audience {
    return {
      id: 'user-2',
      username: 'audienceuser',
      role: 'audience',
      profilePictureUrl: null,
      joinedAt: new Date(),
    };
  }

  it('returns true when both set and sadd succeed', async () => {
    jest.spyOn(redisStateService, 'set').mockResolvedValue(true);
    jest.spyOn(redisStateService, 'sadd').mockResolvedValue(true);

    const result = await repository.addUser(ROOM_ID, makeBandMember());
    expect(result).toBe(true);
  });

  it('returns false when sadd fails — prevents false-positive room membership (DEV-144 regression)', async () => {
    // This is the DEV-144 scenario: set succeeds but sadd silently returns false
    // (e.g. transient Redis error). Before the fix, addUser returned true anyway,
    // leaving the user absent from the roomMembers set, causing cleanup to delete the room.
    jest.spyOn(redisStateService, 'set').mockResolvedValue(true);
    jest.spyOn(redisStateService, 'sadd').mockResolvedValue(false);

    const result = await repository.addUser(ROOM_ID, makeBandMember());
    expect(result).toBe(false);
  });

  it('returns false when set fails — user data not stored', async () => {
    jest.spyOn(redisStateService, 'set').mockResolvedValue(false);
    jest.spyOn(redisStateService, 'sadd').mockResolvedValue(true);

    const result = await repository.addUser(ROOM_ID, makeBandMember());
    expect(result).toBe(false);
  });

  it('returns false when both set and sadd fail', async () => {
    jest.spyOn(redisStateService, 'set').mockResolvedValue(false);
    jest.spyOn(redisStateService, 'sadd').mockResolvedValue(false);

    const result = await repository.addUser(ROOM_ID, makeBandMember());
    expect(result).toBe(false);
  });

  it('adds band_member / room_owner to roomMembers set', async () => {
    jest.spyOn(redisStateService, 'set').mockResolvedValue(true);
    const saddSpy = jest.spyOn(redisStateService, 'sadd').mockResolvedValue(true);

    await repository.addUser(ROOM_ID, makeBandMember());

    expect(saddSpy).toHaveBeenCalledWith(
      expect.stringContaining('members'),
      'user-1',
    );
    expect(saddSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('audiences'),
      expect.any(String),
    );
  });

  it('adds audience to roomAudiences set (not members)', async () => {
    jest.spyOn(redisStateService, 'set').mockResolvedValue(true);
    const saddSpy = jest.spyOn(redisStateService, 'sadd').mockResolvedValue(true);

    await repository.addUser(ROOM_ID, makeAudience());

    expect(saddSpy).toHaveBeenCalledWith(
      expect.stringContaining('audiences'),
      'user-2',
    );
    expect(saddSpy).not.toHaveBeenCalledWith(
      expect.stringContaining(':members'),
      expect.any(String),
    );
  });
});

import { RoomUserRepository } from '../infrastructure/repositories/RoomUserRepository';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { REDIS_KEYS } from '../../../shared/constants/RedisKeys';
import type { BandMember, Audience } from '../../../types';

describe('RoomUserRepository.changeUserRole (DEV-139)', () => {
  let repository: RoomUserRepository;
  const ROOM_ID = 'room-role-test';
  const USER_ID = 'user-role-test';

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new RoomUserRepository();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeBandMember(overrides?: Partial<BandMember>): BandMember {
    return {
      id: USER_ID,
      username: 'test-user',
      role: 'band_member',
      isReady: false,
      currentInstrument: 'acoustic_grand_piano',
      currentCategory: 'melodic',
      profilePictureUrl: null,
      ...overrides,
    };
  }

  function makeAudience(overrides?: Partial<Audience>): Audience {
    return {
      id: USER_ID,
      username: 'test-user',
      role: 'audience',
      profilePictureUrl: null,
      joinedAt: new Date(),
      ...overrides,
    };
  }

  // (a) band_member → audience: user data updated, srem on roomMembers, sadd on roomAudiences
  it('(a) band_member → audience: updates user data, removes from members set, adds to audiences set', async () => {
    const bandMember = makeBandMember();
    jest.spyOn(redisStateService, 'get').mockResolvedValue(bandMember as unknown as BandMember | Audience);
    jest.spyOn(redisStateService, 'set').mockResolvedValue(true);
    jest.spyOn(redisStateService, 'srem').mockResolvedValue(true);
    jest.spyOn(redisStateService, 'sadd').mockResolvedValue(true);

    const didChange = await repository.changeUserRole(ROOM_ID, USER_ID, 'audience');

    expect(didChange).toBe(true);

    // User data should be updated with new role
    expect(redisStateService.set).toHaveBeenCalledWith(
      REDIS_KEYS.roomMemberData(ROOM_ID, USER_ID),
      expect.objectContaining({ role: 'audience' }),
    );

    // Must remove from band members set
    expect(redisStateService.srem).toHaveBeenCalledWith(
      REDIS_KEYS.roomMembers(ROOM_ID),
      USER_ID,
    );

    // Must add to audiences set
    expect(redisStateService.sadd).toHaveBeenCalledWith(
      REDIS_KEYS.roomAudiences(ROOM_ID),
      USER_ID,
    );
  });

  // (b) audience → band_member: opposite set operations
  it('(b) audience → band_member: updates user data, removes from audiences set, adds to members set', async () => {
    const audience = makeAudience();
    jest.spyOn(redisStateService, 'get').mockResolvedValue(audience as unknown as BandMember | Audience);
    jest.spyOn(redisStateService, 'set').mockResolvedValue(true);
    jest.spyOn(redisStateService, 'srem').mockResolvedValue(true);
    jest.spyOn(redisStateService, 'sadd').mockResolvedValue(true);

    const didChange = await repository.changeUserRole(ROOM_ID, USER_ID, 'band_member');

    expect(didChange).toBe(true);

    expect(redisStateService.set).toHaveBeenCalledWith(
      REDIS_KEYS.roomMemberData(ROOM_ID, USER_ID),
      expect.objectContaining({ role: 'band_member' }),
    );

    // Must remove from audiences set
    expect(redisStateService.srem).toHaveBeenCalledWith(
      REDIS_KEYS.roomAudiences(ROOM_ID),
      USER_ID,
    );

    // Must add to band members set
    expect(redisStateService.sadd).toHaveBeenCalledWith(
      REDIS_KEYS.roomMembers(ROOM_ID),
      USER_ID,
    );
  });

  // (c) same role (no-op): no Redis set changes, returns true
  it('(c) same role (no-op): returns true without touching Redis sets', async () => {
    const bandMember = makeBandMember();
    jest.spyOn(redisStateService, 'get').mockResolvedValue(bandMember as unknown as BandMember | Audience);
    const setSpy = jest.spyOn(redisStateService, 'set').mockResolvedValue(true);
    const sremSpy = jest.spyOn(redisStateService, 'srem').mockResolvedValue(true);
    const saddSpy = jest.spyOn(redisStateService, 'sadd').mockResolvedValue(true);

    const didChange = await repository.changeUserRole(ROOM_ID, USER_ID, 'band_member');

    expect(didChange).toBe(true);
    // No writes should happen — it's a no-op
    expect(setSpy).not.toHaveBeenCalled();
    expect(sremSpy).not.toHaveBeenCalled();
    expect(saddSpy).not.toHaveBeenCalled();
  });

  // (d) getUserData returns null (user not in Redis): returns false
  it('(d) getUserData returns null: returns false without writing', async () => {
    jest.spyOn(redisStateService, 'get').mockResolvedValue(null);
    const setSpy = jest.spyOn(redisStateService, 'set').mockResolvedValue(true);

    const didChange = await repository.changeUserRole(ROOM_ID, USER_ID, 'audience');

    expect(didChange).toBe(false);
    expect(setSpy).not.toHaveBeenCalled();
  });

  // (e) Redis error during operations: returns false
  it('(e) Redis error during set: returns false', async () => {
    const bandMember = makeBandMember();
    jest.spyOn(redisStateService, 'get').mockResolvedValue(bandMember as unknown as BandMember | Audience);
    jest.spyOn(redisStateService, 'set').mockRejectedValue(new Error('Redis connection lost'));

    const didChange = await repository.changeUserRole(ROOM_ID, USER_ID, 'audience');

    expect(didChange).toBe(false);
  });

  it('(e) Redis error during srem: returns false', async () => {
    const bandMember = makeBandMember();
    jest.spyOn(redisStateService, 'get').mockResolvedValue(bandMember as unknown as BandMember | Audience);
    jest.spyOn(redisStateService, 'set').mockResolvedValue(true);
    jest.spyOn(redisStateService, 'srem').mockRejectedValue(new Error('Redis ECONNREFUSED'));

    const didChange = await repository.changeUserRole(ROOM_ID, USER_ID, 'audience');

    expect(didChange).toBe(false);
  });
});

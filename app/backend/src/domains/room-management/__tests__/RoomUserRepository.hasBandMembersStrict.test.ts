import { RoomUserRepository } from '../infrastructure/repositories/RoomUserRepository';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { REDIS_KEYS } from '../../../shared/constants/RedisKeys';

describe('RoomUserRepository.hasBandMembersStrict (DEV-137)', () => {
  let repository: RoomUserRepository;
  const ROOM_ID = 'room-strict-test';

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new RoomUserRepository();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns true when the room members set is non-empty', async () => {
    jest.spyOn(redisStateService, 'smembers').mockResolvedValue(['user-1', 'user-2']);

    const hasMembers = await repository.hasBandMembersStrict(ROOM_ID);

    expect(hasMembers).toBe(true);
    expect(redisStateService.smembers).toHaveBeenCalledWith(REDIS_KEYS.roomMembers(ROOM_ID), true);
  });

  it('returns false when the room members set is empty', async () => {
    jest.spyOn(redisStateService, 'smembers').mockResolvedValue([]);

    const hasMembers = await repository.hasBandMembersStrict(ROOM_ID);

    expect(hasMembers).toBe(false);
  });

  it('throws when Redis throws — does not swallow the error', async () => {
    jest.spyOn(redisStateService, 'smembers').mockRejectedValue(new Error('Redis ECONNREFUSED'));

    await expect(repository.hasBandMembersStrict(ROOM_ID))
      .rejects.toThrow('Redis ECONNREFUSED');
    expect(redisStateService.smembers).toHaveBeenCalledWith(REDIS_KEYS.roomMembers(ROOM_ID), true);
  });

  it('returns false when smembers returns null', async () => {
    // Simulate a runtime null from Redis (exercises the defensive ?? path under test)
    const nullFromRedis = (): string[] | null => null;
    jest.spyOn(redisStateService, 'smembers').mockResolvedValue(nullFromRedis() as string[]);

    const hasMembers = await repository.hasBandMembersStrict(ROOM_ID);

    expect(hasMembers).toBe(false);
  });
});

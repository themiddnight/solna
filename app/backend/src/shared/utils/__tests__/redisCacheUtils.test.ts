/**
 * Behavioral tests for the room-membership redis cache utilities — pins the
 * exact redis key format (`room:membership:<roomId>`), the 24h expiry applied
 * after every join, and the sIsMember reply coercion (redis returns 1/0).
 *
 * The redis client is faked at the infra boundary (jest.fn per command); the
 * functions under test are the real implementation.
 */

import {
  cacheUserJoin,
  cacheUserLeave,
  clearRoomMembership,
  getRoomMembers,
  isUserInRoomCache,
} from '../redisCacheUtils';

// Real client type consumed by the utilities — the fake below is a stand-in
// for the node-redis client at the test infra boundary.
type RedisClient = Parameters<typeof cacheUserJoin>[0];

const MEMBERSHIP_TTL_SECONDS = 24 * 60 * 60;

function createFakeRedis() {
  const commands = {
    sAdd: jest.fn(async (_key: string, _member: string) => 1),
    expire: jest.fn(async (_key: string, _seconds: number) => true),
    sRem: jest.fn(async (_key: string, _member: string) => 1),
    sIsMember: jest.fn(async (_key: string, _member: string) => 0),
    del: jest.fn(async (_key: string) => 1),
    sMembers: jest.fn(async (_key: string) => [] as string[]),
  };
  const redis = commands as unknown as RedisClient; // confined infra-boundary cast (TR-27 test carve-out)
  return { redis, commands };
}

describe('cacheUserJoin', () => {
  it('adds the user to the room membership set', async () => {
    const { redis, commands } = createFakeRedis();

    await cacheUserJoin(redis, 'room-1', 'user-1');

    expect(commands.sAdd).toHaveBeenCalledWith('room:membership:room-1', 'user-1');
  });

  it('refreshes the membership set expiry to 24h after joining', async () => {
    const { redis, commands } = createFakeRedis();

    await cacheUserJoin(redis, 'room-1', 'user-1');

    expect(commands.expire).toHaveBeenCalledWith(
      'room:membership:room-1',
      MEMBERSHIP_TTL_SECONDS
    );
  });
});

describe('cacheUserLeave', () => {
  it('removes the user from the room membership set', async () => {
    const { redis, commands } = createFakeRedis();

    await cacheUserLeave(redis, 'room-1', 'user-1');

    expect(commands.sRem).toHaveBeenCalledWith('room:membership:room-1', 'user-1');
  });
});

describe('isUserInRoomCache', () => {
  it('returns true when redis reports membership (reply 1)', async () => {
    const { redis, commands } = createFakeRedis();
    commands.sIsMember.mockResolvedValue(1);

    await expect(isUserInRoomCache(redis, 'room-1', 'user-1')).resolves.toBe(true);

    expect(commands.sIsMember).toHaveBeenCalledWith('room:membership:room-1', 'user-1');
  });

  it('returns false when redis reports no membership (reply 0)', async () => {
    const { redis, commands } = createFakeRedis();
    commands.sIsMember.mockResolvedValue(0);

    await expect(isUserInRoomCache(redis, 'room-1', 'user-1')).resolves.toBe(false);
  });
});

describe('clearRoomMembership', () => {
  it('deletes the room membership key', async () => {
    const { redis, commands } = createFakeRedis();

    await clearRoomMembership(redis, 'room-1');

    expect(commands.del).toHaveBeenCalledWith('room:membership:room-1');
  });
});

describe('getRoomMembers', () => {
  it('returns the full member list from the room membership set', async () => {
    const { redis, commands } = createFakeRedis();
    commands.sMembers.mockResolvedValue(['user-1', 'user-2']);

    await expect(getRoomMembers(redis, 'room-1')).resolves.toEqual(['user-1', 'user-2']);

    expect(commands.sMembers).toHaveBeenCalledWith('room:membership:room-1');
  });
});

describe('shared key format', () => {
  it('all functions address the same room:membership:<roomId> key', async () => {
    const { redis, commands } = createFakeRedis();

    await cacheUserJoin(redis, 'room-x', 'u1');
    await cacheUserLeave(redis, 'room-x', 'u1');
    await isUserInRoomCache(redis, 'room-x', 'u1');
    await clearRoomMembership(redis, 'room-x');

    const keys = [
      commands.sAdd.mock.calls[0]?.[0],
      commands.expire.mock.calls[0]?.[0],
      commands.sRem.mock.calls[0]?.[0],
      commands.sIsMember.mock.calls[0]?.[0],
      commands.del.mock.calls[0]?.[0],
    ];
    expect(keys).toEqual([
      'room:membership:room-x',
      'room:membership:room-x',
      'room:membership:room-x',
      'room:membership:room-x',
      'room:membership:room-x',
    ]);
  });

  it('scopes keys per room id', async () => {
    const { redis, commands } = createFakeRedis();

    await cacheUserJoin(redis, 'room-a', 'u1');
    await cacheUserJoin(redis, 'room-b', 'u1');

    expect(commands.sAdd.mock.calls.map((call) => call[0])).toEqual([
      'room:membership:room-a',
      'room:membership:room-b',
    ]);
  });
});

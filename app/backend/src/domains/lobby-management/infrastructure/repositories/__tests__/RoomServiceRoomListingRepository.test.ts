import { describe, it, expect, jest } from '@jest/globals';
import type { RoomLifecycleService } from '../../../../room-management/application/RoomLifecycleService';
import type { Room } from '../../../../../types';
import { RoomId, UserId } from '../../../../../shared/domain/models/ValueObjects';
import { RoomServiceRoomListingRepository } from '../RoomServiceRoomListingRepository';
import { SearchCriteria, SortBy, SortOrder } from '../../../domain/models/SearchCriteria';
import { RoomCapacityStatus, RoomActivityStatus } from '../../../domain/models/RoomListing';
import type { RoomListing } from '../../../domain/models/RoomListing';

// Confined cast: only getAllRooms/getRoom are exercised
const fakeLifecycle = (rooms: unknown[] = []) =>
  ({
    getAllRooms: jest.fn<() => Promise<unknown[]>>().mockResolvedValue(rooms),
    getRoom: jest.fn<() => Promise<Room | undefined>>()
  }) as unknown as RoomLifecycleService;

const CREATED = new Date('2026-08-01T00:00:00Z');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms: number): Date => new Date(Date.now() - ms);

// Room summaries in the shape RoomService.getAllRooms() returns. The B4 mapper
// maps: memberCount = userCount, maxMembers = 8, genres = [], description =
// undefined, ownerUsername = 'Unknown', lastActivity = createdAt, isActive =
// userCount > 0. userCount must stay <= 8 or RoomListing.validate() throws.
const SUMMARY_FIXTURES = [
  { id: 'room-a', name: 'Rock Arena', userCount: 7, isPrivate: true, owner: 'user-1', createdAt: ago(5 * MIN) },
  { id: 'room-b', name: 'Jazz Lounge', userCount: 3, isPrivate: false, owner: 'user-2', createdAt: ago(3 * HOUR) },
  { id: 'room-c', name: 'Metal Pit', userCount: 8, isPrivate: false, owner: 'user-3', createdAt: ago(10 * MIN) },
  { id: 'room-d', name: 'Acoustic Corner', userCount: 0, isPrivate: false, owner: 'user-1', createdAt: ago(2 * HOUR) },
  { id: 'room-e', name: 'Synth Lab', userCount: 5, isPrivate: false, owner: 'user-4', createdAt: ago(1 * HOUR) },
  { id: 'room-f', name: 'Empty Studio', userCount: 0, isPrivate: true, owner: 'user-5', createdAt: ago(6 * HOUR) },
];

describe('RoomServiceRoomListingRepository — B4 regression (no fabricated lobby data)', () => {
  it('maps an empty room summary to an inactive listing', async () => {
    const repo = new RoomServiceRoomListingRepository(fakeLifecycle([{
      id: 'room-1',
      name: 'Empty Room',
      userCount: 0,
      isPrivate: false,
      owner: 'user-1',
      createdAt: CREATED
    }]));

    const [listing] = await repo.findAll();

    expect(listing!.isActive).toBe(false);
    expect(listing!.lastActivity).toEqual(CREATED);
    expect(listing!.memberCount).toBe(0);
  });

  it('maps a populated room summary to an active listing', async () => {
    const repo = new RoomServiceRoomListingRepository(fakeLifecycle([{
      id: 'room-2',
      name: 'Live Room',
      userCount: 3,
      isPrivate: true,
      owner: 'user-1',
      createdAt: CREATED
    }]));

    const [listing] = await repo.findAll();

    expect(listing!.isActive).toBe(true);
    expect(listing!.memberCount).toBe(3);
    expect(listing!.isPrivate).toBe(true);
    expect(listing!.maxMembers).toBe(8); // app default when room settings are unavailable
  });

  it('maps a full Room using real member counts, owner username and createdAt', async () => {
    // Confined cast: minimal Room shape — only fields the mapper reads
    const room = {
      id: 'room-3',
      name: 'Studio',
      isPrivate: false,
      owner: 'user-1',
      createdAt: CREATED,
      bandMembers: new Map([
        ['user-1', { username: 'Bob' }],
        ['user-2', {}]
      ]),
      audiences: new Map()
    } as unknown as Room;

    const getRoom = jest.fn<() => Promise<Room | undefined>>();
    const lifecycle = {
      getAllRooms: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      getRoom
    } as unknown as RoomLifecycleService;
    getRoom.mockResolvedValue(room);
    const repo = new RoomServiceRoomListingRepository(lifecycle);

    const listing = await repo.findById(RoomId.fromString('room-3'));

    expect(listing).not.toBeNull();
    expect(listing!.memberCount).toBe(2);
    expect(listing!.ownerUsername).toBe('Bob');
    expect(listing!.lastActivity).toEqual(CREATED);
    expect(listing!.isActive).toBe(true);
  });
});

const summaryRepo = (): RoomServiceRoomListingRepository =>
  new RoomServiceRoomListingRepository(fakeLifecycle(SUMMARY_FIXTURES));

interface CriteriaOverrides {
  searchTerm?: string;
  genres?: string[];
  includePrivate?: boolean;
  includeFullRooms?: boolean;
  minMembers?: number;
  maxMembers?: number;
  capacityStatus?: RoomCapacityStatus[];
  activityStatus?: RoomActivityStatus[];
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  limit?: number;
  offset?: number;
}

// Criteria helper mirroring the defaults of SearchCriteria.default()
const criteria = (overrides: CriteriaOverrides = {}): SearchCriteria =>
  new SearchCriteria(
    overrides.searchTerm,
    overrides.genres ?? [],
    overrides.includePrivate ?? false,
    overrides.includeFullRooms ?? false,
    overrides.minMembers,
    overrides.maxMembers,
    overrides.capacityStatus,
    overrides.activityStatus,
    overrides.sortBy ?? SortBy.LastActivity,
    overrides.sortOrder ?? SortOrder.Desc,
    overrides.limit ?? 50,
    overrides.offset ?? 0
  );

const allRooms = (sortBy: SortBy, sortOrder: SortOrder): SearchCriteria =>
  criteria({ sortBy, sortOrder, includePrivate: true, includeFullRooms: true });

const ids = (listings: Array<{ id: RoomId }>): string[] => listings.map(room => room.id.toString());

describe('RoomServiceRoomListingRepository — findByCriteria', () => {
  // lastActivity = createdAt for every mapped listing (B4: no fabricated
  // recency), so default LastActivity-desc order is newest-created first.
  it('returns all rooms sorted by lastActivity desc with no filters', async () => {
    const repo = summaryRepo();
    const result = await repo.findByCriteria(criteria({ includePrivate: true, includeFullRooms: true }));

    expect(ids(result.items)).toEqual(['room-a', 'room-c', 'room-e', 'room-d', 'room-b', 'room-f']);
    expect(result.totalCount).toBe(6);
    expect(result.hasMore).toBe(false);
    expect(result.nextOffset).toBeUndefined();
  });

  it('drops private rooms unless includePrivate is set', async () => {
    const repo = summaryRepo();
    const result = await repo.findByCriteria(criteria({ includeFullRooms: true }));

    expect(ids(result.items)).toEqual(['room-c', 'room-e', 'room-d', 'room-b']); // public only
    expect(result.totalCount).toBe(4);
  });

  it('drops full rooms unless includeFullRooms is set', async () => {
    const repo = summaryRepo();
    const result = await repo.findByCriteria(criteria({ includePrivate: true }));

    expect(ids(result.items)).toEqual(['room-a', 'room-e', 'room-d', 'room-b', 'room-f']); // 8/8 room-c excluded
    expect(result.totalCount).toBe(5);
  });

  it('text search matches the room name only (genres/description are not in the summary format)', async () => {
    const repo = summaryRepo();
    const result = await repo.findByCriteria(criteria({ searchTerm: 'rock', includePrivate: true, includeFullRooms: true }));

    expect(ids(result.items)).toEqual(['room-a']); // "Rock Arena" by name — no genre match possible
    expect(result.totalCount).toBe(1);
  });

  it('text search is case-insensitive', async () => {
    const repo = summaryRepo();
    const result = await repo.findByCriteria(criteria({ searchTerm: 'METAL', includePrivate: true, includeFullRooms: true }));

    expect(ids(result.items)).toEqual(['room-c']);
  });

  it('genre filters never match — the mapper destroys genres', async () => {
    const repo = summaryRepo();
    const result = await repo.findByCriteria(criteria({ genres: ['rock'], includePrivate: true, includeFullRooms: true }));

    expect(result.items).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it('filters by member count', async () => {
    const repo = summaryRepo();

    const minFive = await repo.findByCriteria(criteria({ minMembers: 5, includePrivate: true, includeFullRooms: true }));
    expect(ids(minFive.items)).toEqual(['room-a', 'room-c', 'room-e']); // 7, 8, 5

    const maxTwo = await repo.findByCriteria(criteria({ maxMembers: 2, includePrivate: true, includeFullRooms: true }));
    expect(ids(maxTwo.items)).toEqual(['room-d', 'room-f']); // empty rooms only
  });

  it('filters by capacity status', async () => {
    const repo = summaryRepo();

    const fullAndNearly = await repo.findByCriteria(criteria({
      capacityStatus: [RoomCapacityStatus.Full, RoomCapacityStatus.NearlyFull],
      includePrivate: true,
      includeFullRooms: true
    }));
    // NearlyFull = memberCount >= floor(8 * 0.8) = 6: room-a (7), Full: room-c (8)
    expect(ids(fullAndNearly.items)).toEqual(['room-a', 'room-c']);

    const empty = await repo.findByCriteria(criteria({
      capacityStatus: [RoomCapacityStatus.Empty],
      includePrivate: true,
      includeFullRooms: true
    }));
    expect(ids(empty.items)).toEqual(['room-d', 'room-f']);
  });

  it('filters by activity status derived from createdAt (lastActivity = createdAt)', async () => {
    const repo = summaryRepo();

    const active = await repo.findByCriteria(criteria({
      activityStatus: [RoomActivityStatus.Active],
      includePrivate: true,
      includeFullRooms: true
    }));
    expect(ids(active.items)).toEqual(['room-a', 'room-c']); // created within 30 min

    const idle = await repo.findByCriteria(criteria({
      activityStatus: [RoomActivityStatus.Idle],
      includePrivate: true,
      includeFullRooms: true
    }));
    expect(ids(idle.items)).toEqual(['room-e', 'room-b']);

    const inactive = await repo.findByCriteria(criteria({
      activityStatus: [RoomActivityStatus.Inactive],
      includePrivate: true,
      includeFullRooms: true
    }));
    expect(ids(inactive.items)).toEqual(['room-d', 'room-f']); // 0 members → isActive false
  });

  it('sorts by every SortBy key in both directions', async () => {
    const repo = summaryRepo();

    const byNameAsc = await repo.findByCriteria(allRooms(SortBy.Name, SortOrder.Asc));
    expect(ids(byNameAsc.items)).toEqual(['room-d', 'room-f', 'room-b', 'room-c', 'room-a', 'room-e']);

    const byNameDesc = await repo.findByCriteria(allRooms(SortBy.Name, SortOrder.Desc));
    expect(ids(byNameDesc.items)).toEqual(['room-e', 'room-a', 'room-c', 'room-b', 'room-f', 'room-d']);

    const byMemberCountAsc = await repo.findByCriteria(allRooms(SortBy.MemberCount, SortOrder.Asc));
    expect(ids(byMemberCountAsc.items)).toEqual(['room-d', 'room-f', 'room-b', 'room-e', 'room-a', 'room-c']);

    const byCreatedAtAsc = await repo.findByCriteria(allRooms(SortBy.CreatedAt, SortOrder.Asc));
    expect(ids(byCreatedAtAsc.items)).toEqual(['room-f', 'room-b', 'room-d', 'room-e', 'room-c', 'room-a']);

    const byRelevance = await repo.findByCriteria(allRooms(SortBy.Relevance, SortOrder.Desc));
    expect(ids(byRelevance.items)).toEqual(['room-a', 'room-c', 'room-e', 'room-d', 'room-b', 'room-f']); // falls back to activity
  });

  it('defaults an unknown sortBy to last-activity ordering', async () => {
    const repo = summaryRepo();
    // Confined cast: an enum value outside SortBy exercises the default branch
    const bogus = 'bogus' as unknown as SortBy;

    const result = await repo.findByCriteria(allRooms(bogus, SortOrder.Desc));
    expect(ids(result.items)).toEqual(['room-a', 'room-c', 'room-e', 'room-d', 'room-b', 'room-f']);
  });

  it('paginates with totalCount for the whole filtered set and nextOffset only when more pages exist', async () => {
    const repo = summaryRepo();
    const paged = (limit: number, offset: number): SearchCriteria =>
      criteria({ limit, offset, sortBy: SortBy.Name, sortOrder: SortOrder.Asc, includePrivate: true, includeFullRooms: true });

    const first = await repo.findByCriteria(paged(2, 0));
    expect(ids(first.items)).toEqual(['room-d', 'room-f']);
    expect(first.totalCount).toBe(6);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(2);

    const last = await repo.findByCriteria(paged(4, 2));
    expect(ids(last.items)).toEqual(['room-b', 'room-c', 'room-a', 'room-e']);
    expect(last.totalCount).toBe(6);
    expect(last.hasMore).toBe(false);
    expect(last.nextOffset).toBeUndefined();
  });
});

describe('RoomServiceRoomListingRepository — derived lookups', () => {
  it('finds rooms by owner', async () => {
    const repo = summaryRepo();

    const owned = await repo.findByOwner(UserId.fromString('user-1'));
    expect(ids(owned)).toEqual(['room-a', 'room-d']);
  });

  it('findByGenre and findByGenres return nothing — genres are not in the summary format', async () => {
    const repo = summaryRepo();

    expect(await repo.findByGenre('rock')).toHaveLength(0);
    expect(await repo.findByGenres(['rock', 'jazz'])).toHaveLength(0);
  });

  it('findActive keeps Active and Idle rooms (lastActivity = createdAt)', async () => {
    const repo = summaryRepo();

    expect(ids(await repo.findActive())).toEqual(['room-a', 'room-b', 'room-c', 'room-e']);
  });

  it('findAvailable keeps only non-full, active rooms', async () => {
    const repo = summaryRepo();

    expect(ids(await repo.findAvailable())).toEqual(['room-a', 'room-b', 'room-e']); // room-c full, d/f inactive
  });

  it('findPopular sorts by member count desc then recency desc', async () => {
    const repo = summaryRepo();

    expect(ids(await repo.findPopular())).toEqual(['room-c', 'room-a', 'room-e', 'room-b']);
    expect(ids(await repo.findPopular(2))).toEqual(['room-c', 'room-a']);
  });

  it('searchByText matches the room name, and an empty term matches everything', async () => {
    const repo = summaryRepo();

    expect(ids(await repo.searchByText('synth'))).toEqual(['room-e']);
    expect(ids(await repo.searchByText(''))).toHaveLength(6);
  });
});

describe('RoomServiceRoomListingRepository — getStatistics', () => {
  it('aggregates counts, averages and activity distribution over the mapped rooms', async () => {
    const repo = summaryRepo();
    const stats = await repo.getStatistics();

    expect(stats.totalRooms).toBe(6);
    expect(stats.activeRooms).toBe(2); // room-a, room-c
    expect(stats.privateRooms).toBe(2); // room-a, room-f
    expect(stats.publicRooms).toBe(4);
    expect(stats.fullRooms).toBe(1); // room-c (8/8)
    expect(stats.availableRooms).toBe(3); // a, b, e
    expect(stats.averageMemberCount).toBeCloseTo(23 / 6);
    expect(stats.activityDistribution).toEqual({ active: 2, idle: 2, inactive: 2 });
    expect(stats.popularGenres).toEqual([]); // genres not in the summary format
  });
});

describe('RoomServiceRoomListingRepository — read-only write paths and no-op maintenance', () => {
  const READ_ONLY = 'RoomServiceRoomListingRepository is read-only. Use room management domain for updates.';

  it('rejects every write with the read-only message', async () => {
    const repo = summaryRepo();
    const listing = (await repo.findById(RoomId.fromString('room-a')))!;
    const roomId = RoomId.fromString('room-a');

    await expect(repo.save(listing)).rejects.toThrow(READ_ONLY);
    await expect(repo.saveMany([listing])).rejects.toThrow(READ_ONLY);
    await expect(repo.remove(roomId)).rejects.toThrow(READ_ONLY);
    await expect(repo.updateActivity(roomId, new Date())).rejects.toThrow(READ_ONLY);
    await expect(repo.updateMemberCount(roomId, 2)).rejects.toThrow(READ_ONLY);
  });

  it('refresh resolves without touching the lifecycle service and clearInactive reports 0', async () => {
    const lifecycle = fakeLifecycle(SUMMARY_FIXTURES);
    const repo = new RoomServiceRoomListingRepository(lifecycle);

    await expect(repo.refresh()).resolves.toBeUndefined();
    await expect(repo.clearInactive(new Date())).resolves.toBe(0);
    expect(lifecycle.getAllRooms).not.toHaveBeenCalled();
  });
});

describe('RoomServiceRoomListingRepository — findById full-Room mapper', () => {
  const fullRoom = (overrides: Record<string, unknown> = {}): Room =>
    ({
      id: 'room-full',
      name: 'Studio',
      isPrivate: false,
      owner: 'user-1',
      createdAt: CREATED,
      bandMembers: new Map([
        ['user-1', { username: 'Bob' }],
        ['user-2', {}]
      ]),
      audiences: new Map([['user-3', { username: 'Sue' }]]),
      ...overrides
    }) as unknown as Room;

  const find = (room: Room | undefined): Promise<RoomListing | null> => {
    const getRoom = jest.fn<() => Promise<Room | undefined>>();
    getRoom.mockResolvedValue(room);
    const lifecycle = {
      getAllRooms: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      getRoom
    } as unknown as RoomLifecycleService;
    return new RoomServiceRoomListingRepository(lifecycle).findById(RoomId.fromString('room-full'));
  };

  it('counts band members and audiences together and reads the owner username from bandMembers', async () => {
    const listing = await find(fullRoom());

    expect(listing).not.toBeNull();
    expect(listing!.memberCount).toBe(3); // 2 band members + 1 audience
    expect(listing!.ownerUsername).toBe('Bob');
    expect(listing!.isActive).toBe(true);
  });

  it('falls back to Unknown owner username when the owner is not in bandMembers', async () => {
    const listing = await find(fullRoom({ bandMembers: new Map([['user-9', { username: 'Zed' }]]) }));

    expect(listing!.ownerUsername).toBe('Unknown');
    expect(listing!.memberCount).toBe(2); // 1 band member + 1 audience still count
  });

  it('maps an empty room to an inactive listing with zero members', async () => {
    const listing = await find(fullRoom({ bandMembers: new Map(), audiences: new Map() }));

    expect(listing!.memberCount).toBe(0);
    expect(listing!.isActive).toBe(false);
    expect(listing!.maxMembers).toBe(8);
    expect(listing!.lastActivity).toEqual(CREATED); // no fabricated recency (B4)
  });

  it('returns null when the lifecycle service has no such room', async () => {
    const listing = await find(undefined);

    expect(listing).toBeNull();
  });
});

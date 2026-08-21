/**
 * Behavior-locking tests for CachedRoomListingRepository — the lobby discovery
 * decorator that caches RoomListingRepository reads.
 *
 * Pattern (task brief): a fake base repository holding real RoomListing fixtures
 * + the real RoomListingCache behind the real CachedRoomListingRepository.
 *
 * The fake mirrors the filter/sort/pagination semantics of
 * RoomServiceRoomListingRepository.applyFilters/applySorting/findByCriteria
 * (which are private and whose input mapper destroys genres/descriptions), so
 * the filter matrix documents the real criteria semantics end-to-end. All
 * caching and invalidation behavior asserted here is the decorator's real code.
 */
jest.mock('../../../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
  },
}));

import { describe, it, expect } from '@jest/globals';
import { CachedRoomListingRepository } from '../CachedRoomListingRepository';
import { RoomListing, RoomCapacityStatus, RoomActivityStatus } from '../../../domain/models/RoomListing';
import { SearchCriteria, SortBy, SortOrder } from '../../../domain/models/SearchCriteria';
import type { SearchResult } from '../../../domain/models/SearchCriteria';
import type { RoomListingRepository, RoomListingStatistics } from '../../../domain/repositories/RoomListingRepository';
import { RoomId, UserId } from '../../../../../shared/domain/models/ValueObjects';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const msAgo = (ms: number): Date => new Date(Date.now() - ms);

interface RoomFixture {
  id: string;
  name: string;
  members: number;
  max: number;
  isPrivate: boolean;
  genres: string[];
  description?: string;
  owner: string;
  ownerUsername: string;
  createdAgoMs: number;
  lastActivityAgoMs: number;
  isActive?: boolean;
}

// 10-room fixture: 5 Active (lastActivity within 30 min), 4 Idle, 1 Inactive;
// 2 private, 2 full, 2 nearly-full, 2 empty; 3 rooms tagged rock.
const FIXTURES: RoomFixture[] = [
  { id: 'room-1', name: 'Rock Arena', members: 7, max: 8, isPrivate: true, genres: ['rock', 'metal'], description: 'Live rock room', owner: 'user-1', ownerUsername: 'Alice', createdAgoMs: 3 * DAY, lastActivityAgoMs: 5 * MIN },
  { id: 'room-2', name: 'Jazz Lounge', members: 3, max: 8, isPrivate: false, genres: ['jazz'], owner: 'user-2', ownerUsername: 'Bob', createdAgoMs: 10 * DAY, lastActivityAgoMs: 2 * HOUR },
  { id: 'room-3', name: 'Metal Pit', members: 10, max: 10, isPrivate: false, genres: ['metal'], description: 'Heavy', owner: 'user-3', ownerUsername: 'Carol', createdAgoMs: DAY, lastActivityAgoMs: MIN },
  { id: 'room-4', name: 'Acoustic Corner', members: 0, max: 6, isPrivate: false, genres: ['acoustic', 'folk'], owner: 'user-1', ownerUsername: 'Alice', createdAgoMs: 5 * DAY, lastActivityAgoMs: 5 * DAY },
  { id: 'room-5', name: 'Synth Lab', members: 5, max: 8, isPrivate: false, genres: ['electronic'], description: 'Synths only', owner: 'user-4', ownerUsername: 'Dave', createdAgoMs: 2 * HOUR, lastActivityAgoMs: 10 * MIN },
  { id: 'room-6', name: 'Empty Studio', members: 0, max: 8, isPrivate: false, genres: ['rock'], owner: 'user-5', ownerUsername: 'Eve', createdAgoMs: 30 * DAY, lastActivityAgoMs: 30 * DAY, isActive: false },
  { id: 'room-7', name: 'Classical Hall', members: 8, max: 8, isPrivate: true, genres: ['classical'], description: 'Strings', owner: 'user-6', ownerUsername: 'Frank', createdAgoMs: 20 * DAY, lastActivityAgoMs: 3 * HOUR },
  { id: 'room-8', name: 'Hip Hop Cypher', members: 4, max: 12, isPrivate: false, genres: ['hip-hop', 'electronic'], description: 'Beat battles', owner: 'user-2', ownerUsername: 'Bob', createdAgoMs: 6 * HOUR, lastActivityAgoMs: 15 * MIN },
  { id: 'room-9', name: 'Reggae Roots', members: 2, max: 8, isPrivate: false, genres: ['reggae'], owner: 'user-7', ownerUsername: 'Grace', createdAgoMs: 7 * DAY, lastActivityAgoMs: 7 * DAY },
  { id: 'room-10', name: 'Punk Basement', members: 6, max: 8, isPrivate: false, genres: ['punk', 'rock'], description: 'Loud', owner: 'user-8', ownerUsername: 'Heidi', createdAgoMs: 4 * DAY, lastActivityAgoMs: 20 * MIN },
];

const buildRoom = (f: RoomFixture): RoomListing =>
  new RoomListing(
    RoomId.fromString(f.id),
    f.name,
    f.members,
    f.max,
    f.isPrivate,
    f.isPrivate, // private rooms require approval (mirrors the real mapper)
    f.genres,
    f.description,
    new UserId(f.owner),
    f.ownerUsername,
    msAgo(f.createdAgoMs),
    msAgo(f.lastActivityAgoMs),
    f.isActive ?? true
  );

/**
 * Fake base repository. Mirrors the filter/sort/pagination semantics of
 * RoomServiceRoomListingRepository (applyFilters/applySorting/findByCriteria)
 * so cache behavior is exercised against real criteria semantics. Read
 * counters let the invalidation matrix assert cache misses without mocking
 * the cache itself.
 */
class FakeRoomListingRepository implements RoomListingRepository {
  findAllCalls = 0;
  findByCriteriaCalls = 0;
  getStatisticsCalls = 0;
  saveManyCalls = 0;
  saved: RoomListing[] = [];
  removedIds: string[] = [];
  activityUpdates: Array<{ roomId: string; lastActivity: Date }> = [];
  memberCountUpdates: Array<{ roomId: string; memberCount: number }> = [];

  constructor(private readonly listings: RoomListing[]) {}

  async findAll(): Promise<RoomListing[]> {
    this.findAllCalls++;
    return [...this.listings];
  }

  async findByCriteria(criteria: SearchCriteria): Promise<SearchResult<RoomListing>> {
    this.findByCriteriaCalls++;

    const filtered = this.applyFilters(criteria);
    const sorted = this.applySorting(filtered, criteria);

    const totalCount = sorted.length;
    const result: SearchResult<RoomListing> = {
      items: sorted.slice(criteria.offset, criteria.offset + criteria.limit),
      totalCount,
      hasMore: criteria.offset + criteria.limit < totalCount
    };

    if (criteria.offset + criteria.limit < totalCount) {
      result.nextOffset = criteria.offset + criteria.limit;
    }

    return result;
  }

  async findById(roomId: RoomId): Promise<RoomListing | null> {
    return this.listings.find(room => room.id.equals(roomId)) ?? null;
  }

  async findByOwner(ownerId: UserId): Promise<RoomListing[]> {
    return this.listings.filter(room => room.owner.equals(ownerId));
  }

  async findByGenre(genre: string, limit?: number): Promise<RoomListing[]> {
    const genreRooms = this.listings.filter(room => room.hasGenre(genre));
    return limit !== undefined ? genreRooms.slice(0, limit) : genreRooms;
  }

  async findByGenres(genres: string[], limit?: number): Promise<RoomListing[]> {
    const genreRooms = this.listings.filter(room => room.hasAnyGenre(genres));
    return limit !== undefined ? genreRooms.slice(0, limit) : genreRooms;
  }

  async findActive(limit?: number): Promise<RoomListing[]> {
    const activeRooms = this.listings.filter(room =>
      room.getActivityStatus() === RoomActivityStatus.Active ||
      room.getActivityStatus() === RoomActivityStatus.Idle
    );
    return limit !== undefined ? activeRooms.slice(0, limit) : activeRooms;
  }

  async findAvailable(limit?: number): Promise<RoomListing[]> {
    const availableRooms = this.listings.filter(room =>
      !room.isFull() &&
      room.isActive &&
      (room.getActivityStatus() === RoomActivityStatus.Active ||
       room.getActivityStatus() === RoomActivityStatus.Idle)
    );
    return limit !== undefined ? availableRooms.slice(0, limit) : availableRooms;
  }

  async findPopular(limit?: number): Promise<RoomListing[]> {
    const popularRooms = this.listings
      .filter(room => room.memberCount > 0 && room.isActive)
      .sort((a, b) => {
        if (a.memberCount !== b.memberCount) {
          return b.memberCount - a.memberCount;
        }
        return b.lastActivity.getTime() - a.lastActivity.getTime();
      });
    return limit !== undefined ? popularRooms.slice(0, limit) : popularRooms;
  }

  async searchByText(searchTerm: string, limit?: number): Promise<RoomListing[]> {
    const matchingRooms = this.listings.filter(room => room.matchesSearchTerm(searchTerm));
    return limit !== undefined ? matchingRooms.slice(0, limit) : matchingRooms;
  }

  async getStatistics(): Promise<RoomListingStatistics> {
    this.getStatisticsCalls++;

    const totalRooms = this.listings.length;
    const activeRooms = this.listings.filter(room =>
      room.getActivityStatus() === RoomActivityStatus.Active
    ).length;
    const privateRooms = this.listings.filter(room => room.isPrivate).length;
    const publicRooms = totalRooms - privateRooms;
    const fullRooms = this.listings.filter(room => room.isFull()).length;
    const availableRooms = this.listings.filter(room => !room.isFull() && room.isActive).length;

    const totalMembers = this.listings.reduce((sum, room) => sum + room.memberCount, 0);
    const averageMemberCount = totalRooms > 0 ? totalMembers / totalRooms : 0;

    const genreMap = new Map<string, { roomCount: number; totalMembers: number }>();
    this.listings.forEach(room => {
      room.genres.forEach(genre => {
        const existing = genreMap.get(genre) ?? { roomCount: 0, totalMembers: 0 };
        genreMap.set(genre, {
          roomCount: existing.roomCount + 1,
          totalMembers: existing.totalMembers + room.memberCount
        });
      });
    });

    const popularGenres = Array.from(genreMap.entries())
      .map(([genre, stats]) => ({
        genre,
        roomCount: stats.roomCount,
        totalMembers: stats.totalMembers,
        averageMembers: stats.roomCount > 0 ? stats.totalMembers / stats.roomCount : 0
      }))
      .sort((a, b) => b.roomCount - a.roomCount);

    const activityDistribution = {
      active: this.listings.filter(room => room.getActivityStatus() === RoomActivityStatus.Active).length,
      idle: this.listings.filter(room => room.getActivityStatus() === RoomActivityStatus.Idle).length,
      inactive: this.listings.filter(room => room.getActivityStatus() === RoomActivityStatus.Inactive).length
    };

    return {
      totalRooms,
      activeRooms,
      privateRooms,
      publicRooms,
      fullRooms,
      availableRooms,
      averageMemberCount,
      popularGenres,
      activityDistribution
    };
  }

  async save(roomListing: RoomListing): Promise<void> {
    const index = this.listings.findIndex(room => room.id.equals(roomListing.id));
    if (index !== -1) {
      this.listings[index] = roomListing;
    } else {
      this.listings.push(roomListing);
    }
    this.saved.push(roomListing);
  }

  async saveMany(roomListings: RoomListing[]): Promise<void> {
    this.saveManyCalls++;
    for (const roomListing of roomListings) {
      await this.save(roomListing);
    }
  }

  async remove(roomId: RoomId): Promise<void> {
    this.removedIds.push(roomId.toString());
    const index = this.listings.findIndex(room => room.id.equals(roomId));
    if (index !== -1) {
      this.listings.splice(index, 1);
    }
  }

  // RoomListing is immutable, so activity/member-count writes only record the
  // call (the real base is a read-only adapter that throws for writes).
  async updateActivity(roomId: RoomId, lastActivity: Date): Promise<void> {
    this.activityUpdates.push({ roomId: roomId.toString(), lastActivity });
  }

  async updateMemberCount(roomId: RoomId, memberCount: number): Promise<void> {
    this.memberCountUpdates.push({ roomId: roomId.toString(), memberCount });
  }

  async refresh(): Promise<void> {
    // no-op — mirror of the real read-only adapter
  }

  async clearInactive(_olderThan: Date): Promise<number> {
    return 0;
  }

  // Mirror of RoomServiceRoomListingRepository.applyFilters — real domain
  // predicates (matchesSearchTerm, hasAnyGenre, isFull, getCapacityStatus,
  // getActivityStatus) against the same criteria fields.
  private applyFilters(criteria: SearchCriteria): RoomListing[] {
    return this.listings.filter(room => {
      if (criteria.isTextSearch() && !room.matchesSearchTerm(criteria.searchTerm!)) {
        return false;
      }

      if (criteria.genres.length > 0 && !room.hasAnyGenre(criteria.genres)) {
        return false;
      }

      if (!criteria.includePrivate && room.isPrivate) {
        return false;
      }

      if (!criteria.includeFullRooms && room.isFull()) {
        return false;
      }

      if (criteria.minMembers !== undefined && room.memberCount < criteria.minMembers) {
        return false;
      }

      if (criteria.maxMembers !== undefined && room.memberCount > criteria.maxMembers) {
        return false;
      }

      if (criteria.capacityStatus !== undefined && criteria.capacityStatus.length > 0 &&
          !criteria.capacityStatus.includes(room.getCapacityStatus())) {
        return false;
      }

      if (criteria.activityStatus !== undefined && criteria.activityStatus.length > 0 &&
          !criteria.activityStatus.includes(room.getActivityStatus())) {
        return false;
      }

      return true;
    });
  }

  // Mirror of RoomServiceRoomListingRepository.applySorting.
  private applySorting(rooms: RoomListing[], criteria: SearchCriteria): RoomListing[] {
    return [...rooms].sort((a, b) => {
      let comparison = 0;

      switch (criteria.sortBy) {
        case SortBy.Name:
          comparison = a.name.localeCompare(b.name);
          break;

        case SortBy.MemberCount:
          comparison = a.memberCount - b.memberCount;
          break;

        case SortBy.CreatedAt:
          comparison = a.createdAt.getTime() - b.createdAt.getTime();
          break;

        case SortBy.LastActivity:
          comparison = a.lastActivity.getTime() - b.lastActivity.getTime();
          break;

        case SortBy.Relevance:
          // No relevance scoring yet — falls back to activity (real behavior)
          comparison = a.lastActivity.getTime() - b.lastActivity.getTime();
          break;

        default:
          comparison = a.lastActivity.getTime() - b.lastActivity.getTime();
      }

      return criteria.sortOrder === SortOrder.Desc ? -comparison : comparison;
    });
  }
}

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

const criteria = (c: CriteriaOverrides = {}): SearchCriteria =>
  new SearchCriteria(
    c.searchTerm,
    c.genres ?? [],
    c.includePrivate ?? false,
    c.includeFullRooms ?? false,
    c.minMembers,
    c.maxMembers,
    c.capacityStatus,
    c.activityStatus,
    c.sortBy ?? SortBy.Name,
    c.sortOrder ?? SortOrder.Asc,
    c.limit ?? 50,
    c.offset ?? 0
  );

const ids = (items: RoomListing[]): string[] => items.map(room => room.id.toString());

describe('CachedRoomListingRepository', () => {
  let base: FakeRoomListingRepository;
  let repo: CachedRoomListingRepository;

  beforeEach(() => {
    base = new FakeRoomListingRepository(FIXTURES.map(buildRoom));
    repo = new CachedRoomListingRepository(base);
  });

  afterEach(() => {
    repo.shutdown();
  });

  describe('findByCriteria — filter matrix', () => {
    it('filters by text search term across name, genres and description', async () => {
      const result = await repo.findByCriteria(criteria({
        searchTerm: 'rock',
        includePrivate: true,
        includeFullRooms: true
      }));

      // Rock Arena (name + genre + description), Empty Studio + Punk Basement (genre)
      expect(ids(result.items)).toEqual(['room-6', 'room-10', 'room-1']);
      expect(result.totalCount).toBe(3);
    });

    it('text search is case-insensitive and matches owner username', async () => {
      const result = await repo.findByCriteria(criteria({
        searchTerm: 'ALICE',
        includePrivate: true,
        includeFullRooms: true
      }));

      expect(ids(result.items)).toEqual(['room-4', 'room-1']); // both owned by Alice
    });

    it('filters by genre', async () => {
      const result = await repo.findByCriteria(criteria({
        genres: ['metal'],
        includePrivate: true,
        includeFullRooms: true
      }));

      expect(ids(result.items)).toEqual(['room-3', 'room-1']); // Metal Pit, Rock Arena
    });

    it('drops private rooms unless includePrivate is set', async () => {
      const publicOnly = await repo.findByCriteria(criteria({ includeFullRooms: true }));

      expect(ids(publicOnly.items)).toEqual(['room-4', 'room-6', 'room-8', 'room-2', 'room-3', 'room-10', 'room-9', 'room-5']);
      expect(ids(publicOnly.items)).not.toContain('room-1'); // private
      expect(ids(publicOnly.items)).not.toContain('room-7'); // private

      const withPrivate = await repo.findByCriteria(criteria({ includePrivate: true, includeFullRooms: true }));
      expect(ids(withPrivate.items)).toHaveLength(10);
    });

    it('drops full rooms unless includeFullRooms is set', async () => {
      const notFull = await repo.findByCriteria(criteria({ includePrivate: true }));

      expect(ids(notFull.items)).toEqual(['room-4', 'room-6', 'room-8', 'room-2', 'room-10', 'room-9', 'room-1', 'room-5']);
      expect(ids(notFull.items)).not.toContain('room-3'); // 10/10
      expect(ids(notFull.items)).not.toContain('room-7'); // 8/8

      const withFull = await repo.findByCriteria(criteria({ includePrivate: true, includeFullRooms: true }));
      expect(ids(withFull.items)).toHaveLength(10);
    });

    it('filters by minimum member count', async () => {
      const result = await repo.findByCriteria(criteria({
        minMembers: 5,
        includePrivate: true,
        includeFullRooms: true
      }));

      // Members: 8 (room-7), 10 (room-3), 6 (room-10), 7 (room-1), 5 (room-5)
      expect(ids(result.items)).toEqual(['room-7', 'room-3', 'room-10', 'room-1', 'room-5']);
    });

    it('filters by maximum member count', async () => {
      const result = await repo.findByCriteria(criteria({
        maxMembers: 2,
        includePrivate: true,
        includeFullRooms: true
      }));

      // Members: 0 (room-4), 0 (room-6), 2 (room-9)
      expect(ids(result.items)).toEqual(['room-4', 'room-6', 'room-9']);
    });

    it('filters by capacity status', async () => {
      const nearlyFullAndFull = await repo.findByCriteria(criteria({
        capacityStatus: [RoomCapacityStatus.NearlyFull, RoomCapacityStatus.Full],
        includePrivate: true,
        includeFullRooms: true
      }));

      // Full: room-7 (8/8), room-3 (10/10); NearlyFull: room-10 (6/8), room-1 (7/8)
      expect(ids(nearlyFullAndFull.items)).toEqual(['room-7', 'room-3', 'room-10', 'room-1']);

      const empty = await repo.findByCriteria(criteria({
        capacityStatus: [RoomCapacityStatus.Empty],
        includePrivate: true,
        includeFullRooms: true
      }));
      expect(ids(empty.items)).toEqual(['room-4', 'room-6']);
    });

    it('filters by activity status', async () => {
      const active = await repo.findByCriteria(criteria({
        activityStatus: [RoomActivityStatus.Active],
        includePrivate: true,
        includeFullRooms: true
      }));

      // lastActivity within the last 30 minutes: room-8, room-3, room-10, room-1, room-5
      expect(ids(active.items)).toEqual(['room-8', 'room-3', 'room-10', 'room-1', 'room-5']);

      const idle = await repo.findByCriteria(criteria({
        activityStatus: [RoomActivityStatus.Idle],
        includePrivate: true,
        includeFullRooms: true
      }));
      expect(ids(idle.items)).toEqual(['room-4', 'room-7', 'room-2', 'room-9']);
    });

    it('admits inactive rooms only when explicitly requested', async () => {
      const inactive = await repo.findByCriteria(criteria({
        activityStatus: [RoomActivityStatus.Inactive],
        includePrivate: true,
        includeFullRooms: true
      }));

      expect(ids(inactive.items)).toEqual(['room-6']); // Empty Studio, isActive=false
    });
  });

  describe('sorting — all 5 SortBy keys, asc and desc', () => {
    const allRooms = (sortBy: SortBy, sortOrder: SortOrder): SearchCriteria =>
      criteria({ includePrivate: true, includeFullRooms: true, sortBy, sortOrder });

    it.each<[SortBy, string[], string[]]>([
      [SortBy.Name, ['room-4', 'room-7', 'room-6', 'room-8', 'room-2', 'room-3', 'room-10', 'room-9', 'room-1', 'room-5'],
        ['room-5', 'room-1', 'room-9', 'room-10', 'room-3', 'room-2', 'room-8', 'room-6', 'room-7', 'room-4']],
      [SortBy.MemberCount, ['room-4', 'room-6', 'room-9', 'room-2', 'room-8', 'room-5', 'room-10', 'room-1', 'room-7', 'room-3'],
        ['room-3', 'room-7', 'room-1', 'room-10', 'room-5', 'room-8', 'room-2', 'room-9', 'room-4', 'room-6']],
      [SortBy.CreatedAt, ['room-6', 'room-7', 'room-2', 'room-9', 'room-4', 'room-10', 'room-1', 'room-3', 'room-8', 'room-5'],
        ['room-5', 'room-8', 'room-3', 'room-1', 'room-10', 'room-4', 'room-9', 'room-2', 'room-7', 'room-6']],
      [SortBy.LastActivity, ['room-6', 'room-9', 'room-4', 'room-7', 'room-2', 'room-10', 'room-8', 'room-5', 'room-1', 'room-3'],
        ['room-3', 'room-1', 'room-5', 'room-8', 'room-10', 'room-2', 'room-7', 'room-4', 'room-9', 'room-6']],
    ])('sorts by %s both ascending and descending', async (sortBy, ascOrder, descOrder) => {
      const asc = await repo.findByCriteria(allRooms(sortBy, SortOrder.Asc));
      expect(ids(asc.items)).toEqual(ascOrder);

      const desc = await repo.findByCriteria(allRooms(sortBy, SortOrder.Desc));
      expect(ids(desc.items)).toEqual(descOrder);
    });

    it('SortBy.Relevance falls back to last-activity ordering (no relevance scoring yet)', async () => {
      const relevance = await repo.findByCriteria(allRooms(SortBy.Relevance, SortOrder.Desc));
      const byActivity = await repo.findByCriteria(allRooms(SortBy.LastActivity, SortOrder.Desc));

      expect(ids(relevance.items)).toEqual(ids(byActivity.items));
      expect(ids(relevance.items)).toEqual(['room-3', 'room-1', 'room-5', 'room-8', 'room-10', 'room-2', 'room-7', 'room-4', 'room-9', 'room-6']);
    });
  });

  describe('pagination', () => {
    const pageCriteria = (limit: number, offset: number): SearchCriteria =>
      criteria({ includePrivate: true, includeFullRooms: true, sortBy: SortBy.Name, sortOrder: SortOrder.Asc, limit, offset });

    it('slices by offset/limit and reports the full totalCount', async () => {
      const page = await repo.findByCriteria(pageCriteria(3, 0));

      expect(ids(page.items)).toEqual(['room-4', 'room-7', 'room-6']);
      expect(page.totalCount).toBe(10); // totalCount is the whole (filtered) set, not the page
      expect(page.hasMore).toBe(true);
      expect(page.nextOffset).toBe(3);
    });

    it('stops at the boundary: hasMore false and no nextOffset on the last page', async () => {
      const lastPage = await repo.findByCriteria(pageCriteria(3, 9));

      expect(ids(lastPage.items)).toEqual(['room-5']);
      expect(lastPage.totalCount).toBe(10);
      expect(lastPage.hasMore).toBe(false);
      expect(lastPage.nextOffset).toBeUndefined();

      const exactFit = await repo.findByCriteria(pageCriteria(10, 0));
      expect(exactFit.items).toHaveLength(10);
      expect(exactFit.hasMore).toBe(false);
      expect(exactFit.nextOffset).toBeUndefined();
    });

    it('exposes the next page exactly at the boundary', async () => {
      const page = await repo.findByCriteria(pageCriteria(3, 6));

      expect(ids(page.items)).toEqual(['room-10', 'room-9', 'room-1']);
      expect(page.hasMore).toBe(true);
      expect(page.nextOffset).toBe(9);
    });

    it('reports totalCount for the filtered set, not the whole list', async () => {
      const page = await repo.findByCriteria(criteria({
        genres: ['metal'],
        includePrivate: true,
        includeFullRooms: true,
        limit: 1,
        offset: 1
      }));

      expect(ids(page.items)).toEqual(['room-1']); // second of the 2 metal rooms
      expect(page.totalCount).toBe(2);
      expect(page.hasMore).toBe(false);
    });
  });

  describe('getStatistics', () => {
    it('aggregates genre stats, averages and activity distribution over the fixture set', async () => {
      const stats = await repo.getStatistics();

      expect(stats.totalRooms).toBe(10);
      expect(stats.activeRooms).toBe(5);
      expect(stats.privateRooms).toBe(2);
      expect(stats.publicRooms).toBe(8);
      expect(stats.fullRooms).toBe(2);
      expect(stats.availableRooms).toBe(7);
      expect(stats.averageMemberCount).toBe(4.5); // 45 members / 10 rooms
      expect(stats.activityDistribution).toEqual({ active: 5, idle: 4, inactive: 1 });

      // popularGenres sorted by roomCount desc, stable for ties
      expect(stats.popularGenres.map(g => g.genre)).toEqual(
        ['rock', 'metal', 'electronic', 'jazz', 'acoustic', 'folk', 'classical', 'hip-hop', 'reggae', 'punk']
      );

      const rock = stats.popularGenres[0]!; // room-1 (7) + room-6 (0) + room-10 (6)
      expect(rock.roomCount).toBe(3);
      expect(rock.totalMembers).toBe(13);
      expect(rock.averageMembers).toBeCloseTo(13 / 3);

      const metal = stats.popularGenres[1]!; // room-1 (7) + room-3 (10)
      expect(metal.roomCount).toBe(2);
      expect(metal.totalMembers).toBe(17);
      expect(metal.averageMembers).toBe(8.5);
    });
  });

  describe('caching behavior', () => {
    it('serves findAll from cache without touching the base repository', async () => {
      await repo.findAll();
      expect(base.findAllCalls).toBe(1);

      const cached = await repo.findAll();
      expect(cached).toHaveLength(10);
      expect(base.findAllCalls).toBe(1);
    });

    it('caches findByCriteria per criteria cache key', async () => {
      const c1 = criteria({ includePrivate: true, includeFullRooms: true });
      const c1Again = criteria({ includePrivate: true, includeFullRooms: true });
      await repo.findByCriteria(c1);
      await repo.findByCriteria(c1Again); // identical criteria → same cache key
      expect(base.findByCriteriaCalls).toBe(1);

      const c2 = criteria({ includePrivate: true, includeFullRooms: true, limit: 10, offset: 0 });
      await repo.findByCriteria(c2); // different limit → different cache key
      expect(base.findByCriteriaCalls).toBe(2);
    });

    it('caches getStatistics', async () => {
      await repo.getStatistics();
      expect(base.getStatisticsCalls).toBe(1);
      await repo.getStatistics();
      expect(base.getStatisticsCalls).toBe(1);
    });

    it('derived lookups (findById/findByGenre/searchByText) reuse the cached listings', async () => {
      const room = await repo.findById(RoomId.fromString('room-3'));
      expect(room?.name).toBe('Metal Pit');
      expect(base.findAllCalls).toBe(1);

      const metal = await repo.findByGenre('metal');
      expect(ids(metal)).toEqual(['room-1', 'room-3']);
      expect(base.findAllCalls).toBe(1);

      const byText = await repo.searchByText('synths');
      expect(ids(byText)).toEqual(['room-5']); // matches description "Synths only"
      expect(base.findAllCalls).toBe(1);
    });
  });

  describe('cache invalidation matrix', () => {
    const searchCriteria = (): SearchCriteria => criteria({ includePrivate: true, includeFullRooms: true });

    // Prime all three caches so every subsequent read is a cache hit until
    // the mutation under test invalidates it (miss = base call counter rises).
    const warmCaches = async (): Promise<void> => {
      await repo.findAll();
      await repo.findByCriteria(searchCriteria());
      await repo.getStatistics();
    };

    it('updateActivity invalidates listings and search results but NOT statistics', async () => {
      await warmCaches();

      const lastActivity = msAgo(30 * 1000);
      await repo.updateActivity(RoomId.fromString('room-1'), lastActivity);

      await repo.findAll();
      expect(base.findAllCalls).toBe(2); // listings cache invalidated
      await repo.findByCriteria(searchCriteria());
      expect(base.findByCriteriaCalls).toBe(2); // search results invalidated
      await repo.getStatistics();
      expect(base.getStatisticsCalls).toBe(1); // statistics survive updateActivity
      expect(base.activityUpdates).toEqual([{ roomId: 'room-1', lastActivity }]);
    });

    it('updateMemberCount invalidates listings, search results and statistics', async () => {
      await warmCaches();

      await repo.updateMemberCount(RoomId.fromString('room-1'), 6);

      await repo.findAll();
      expect(base.findAllCalls).toBe(2);
      await repo.findByCriteria(searchCriteria());
      expect(base.findByCriteriaCalls).toBe(2);
      await repo.getStatistics();
      expect(base.getStatisticsCalls).toBe(2);
      expect(base.memberCountUpdates).toEqual([{ roomId: 'room-1', memberCount: 6 }]);
    });

    it('save delegates, updates the cached listing in place and invalidates stats', async () => {
      await warmCaches();

      const renamed = new RoomListing(
        RoomId.fromString('room-3'),
        'Metal Pit MK2',
        9,
        10,
        false,
        false,
        ['metal'],
        'Heavy',
        new UserId('user-3'),
        'Carol',
        msAgo(DAY),
        msAgo(MIN),
        true
      );
      await repo.save(renamed);

      const listings = await repo.findAll();
      expect(base.findAllCalls).toBe(1); // listings cache kept warm — updated in place
      const updated = listings.find(room => room.id.equals(RoomId.fromString('room-3')));
      expect(updated?.name).toBe('Metal Pit MK2');

      await repo.findByCriteria(searchCriteria());
      expect(base.findByCriteriaCalls).toBe(2); // search results invalidated (updateRoom)
      await repo.getStatistics();
      expect(base.getStatisticsCalls).toBe(2); // statistics invalidated
      expect(base.saved).toHaveLength(1);
    });

    it('remove drops the room from the cached listings and invalidates stats', async () => {
      await warmCaches();

      await repo.remove(RoomId.fromString('room-3'));

      const listings = await repo.findAll();
      expect(base.findAllCalls).toBe(1); // listings cache kept warm — removed in place
      expect(ids(listings)).not.toContain('room-3');

      await repo.findByCriteria(searchCriteria());
      expect(base.findByCriteriaCalls).toBe(2); // search results invalidated (removeRoom)
      await repo.getStatistics();
      expect(base.getStatisticsCalls).toBe(2); // statistics invalidated
      expect(base.removedIds).toEqual(['room-3']);
    });

    it('saveMany invalidates all caches', async () => {
      await warmCaches();

      await repo.saveMany([buildRoom(FIXTURES[0]!), buildRoom(FIXTURES[1]!)]);

      await repo.findAll();
      expect(base.findAllCalls).toBe(2); // listings invalidated
      await repo.findByCriteria(searchCriteria());
      expect(base.findByCriteriaCalls).toBe(2); // search results invalidated
      await repo.getStatistics();
      expect(base.getStatisticsCalls).toBe(2); // statistics invalidated
      expect(base.saveManyCalls).toBe(1);
    });

    // Regression for 3ad446e4 ("fix: room-listing save/remove invalidate search
    // results even on a cold cache"): a save or remove must invalidate warm
    // search results and statistics even when the listings entry itself is
    // cold, so stale data can never survive a room mutation.
    it('save with a cold listings cache invalidates stale search results', async () => {
      // Prime search + stats but NOT listings, then save — search results
      // must not survive a save even when the listings entry is cold.
      const searchResult = await repo.findByCriteria(searchCriteria());
      expect(searchResult.items).toHaveLength(10);
      await repo.getStatistics();

      await repo.save(buildRoom(FIXTURES[0]!));

      await repo.findByCriteria(searchCriteria());
      expect(base.findByCriteriaCalls).toBe(2); // search re-reads the base repo
      await repo.getStatistics();
      expect(base.getStatisticsCalls).toBe(2); // stats always invalidated by save
    });

    // Regression for 3ad446e4 — the remove side of the cold-cache fix.
    it('remove with a cold listings cache invalidates stale search results', async () => {
      // Prime search + stats but NOT listings, then remove — a deleted room
      // must not keep appearing in warm search results even when the listings
      // entry is cold.
      const searchResult = await repo.findByCriteria(searchCriteria());
      expect(searchResult.items).toHaveLength(10);
      await repo.getStatistics();

      await repo.remove(RoomId.fromString('room-3'));

      await repo.findByCriteria(searchCriteria());
      expect(base.findByCriteriaCalls).toBe(2); // search re-reads the base repo
      await repo.getStatistics();
      expect(base.getStatisticsCalls).toBe(2); // stats always invalidated by remove
      expect(base.removedIds).toEqual(['room-3']);
    });
  });
});

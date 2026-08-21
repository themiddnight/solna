/**
 * Behavior-locking tests for RoomListingCache.
 *
 * Written before swapping the hand-rolled TTL/eviction internals to `lru-cache`,
 * so the same assertions guarantee behavior parity after the refactor.
 */
jest.mock('../../../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
  },
}));

import { RoomListingCache } from '../RoomListingCache';
import { RoomListing } from '../../../domain/models/RoomListing';
import { SearchCriteria } from '../../../domain/models/SearchCriteria';
import type { SearchResult } from '../../../domain/models/SearchCriteria';
import type { RoomListingStatistics } from '../../../domain/repositories/RoomListingRepository';
import { RoomId, UserId } from '../../../../../shared/domain/models/ValueObjects';

const createRoom = (id: string, name = `Room ${id}`): RoomListing =>
  new RoomListing(
    RoomId.fromString(id),
    name,
    1,
    10,
    false,
    false,
    ['rock'],
    undefined,
    new UserId('owner-1'),
    'owner',
    new Date(),
    new Date(),
    true
  );

const makeResult = (items: RoomListing[]): SearchResult<RoomListing> => ({
  items,
  totalCount: items.length,
  hasMore: false,
});

const makeStats = (): RoomListingStatistics => ({
  totalRooms: 1,
  activeRooms: 1,
  privateRooms: 0,
  publicRooms: 1,
  fullRooms: 0,
  availableRooms: 1,
  averageMemberCount: 1,
  popularGenres: [],
  activityDistribution: { active: 1, idle: 0, inactive: 0 },
});

describe('RoomListingCache', () => {
  let cache: RoomListingCache;

  beforeEach(() => {
    // The cache drives its TTL from Date.now(), which fake timers control.
    jest.useFakeTimers();
    cache = new RoomListingCache();
  });

  afterEach(() => {
    cache.shutdown();
    jest.useRealTimers();
  });

  describe('room listings store', () => {
    it('returns cached listings, then null after the 30s TTL', () => {
      cache.setRoomListings([createRoom('room-1')]);
      expect(cache.getRoomListings()).not.toBeNull();
      expect(cache.getRoomListings()).toHaveLength(1);

      jest.advanceTimersByTime(31 * 1000);
      expect(cache.getRoomListings()).toBeNull();
    });

    it('stores a copy of the array so external pushes do not mutate the cache', () => {
      const listings = [createRoom('room-1')];
      cache.setRoomListings(listings);
      listings.push(createRoom('room-2'));
      expect(cache.getRoomListings()).toHaveLength(1);
    });
  });

  describe('search results store', () => {
    it('returns cached results, then null after the 60s TTL', () => {
      const criteria = SearchCriteria.default();
      cache.setSearchResults(criteria, makeResult([createRoom('room-1')]));
      expect(cache.getSearchResults(criteria)).not.toBeNull();

      jest.advanceTimersByTime(61 * 1000);
      expect(cache.getSearchResults(criteria)).toBeNull();
    });

    it('keeps the cache bounded at/under 100 entries', () => {
      for (let i = 0; i <= 100; i++) {
        const criteria = SearchCriteria.default().withPagination(50, i);
        cache.setSearchResults(criteria, makeResult([createRoom(`room-${i}`)]));
      }
      expect(cache.getCacheStats().searchResults.totalCached).toBeLessThanOrEqual(100);
    });
  });

  describe('statistics store', () => {
    it('returns cached statistics, then null after the 120s TTL', () => {
      cache.setStatistics(makeStats());
      expect(cache.getStatistics()).not.toBeNull();

      jest.advanceTimersByTime(121 * 1000);
      expect(cache.getStatistics()).toBeNull();
    });
  });

  describe('cascading invalidation', () => {
    it('updateRoom replaces an existing room and invalidates search + stats', () => {
      cache.setRoomListings([createRoom('room-1', 'Old name')]);
      cache.setSearchResults(SearchCriteria.default(), makeResult([createRoom('room-1')]));
      cache.setStatistics(makeStats());

      cache.updateRoom(createRoom('room-1', 'New name'));

      const listings = cache.getRoomListings();
      expect(listings).toHaveLength(1);
      expect(listings![0]!.name).toBe('New name');
      expect(cache.getSearchResults(SearchCriteria.default())).toBeNull();
      expect(cache.getStatistics()).toBeNull();
    });

    it('updateRoom appends a room that is not yet cached', () => {
      cache.setRoomListings([createRoom('room-1')]);
      cache.updateRoom(createRoom('room-2'));
      expect(cache.getRoomListings()).toHaveLength(2);
    });

    it('removeRoom filters the room out and invalidates search + stats', () => {
      cache.setRoomListings([createRoom('room-1'), createRoom('room-2')]);
      cache.setSearchResults(SearchCriteria.default(), makeResult([createRoom('room-1')]));
      cache.setStatistics(makeStats());

      cache.removeRoom('room-1');

      const listings = cache.getRoomListings();
      expect(listings).toHaveLength(1);
      expect(listings![0]!.id.toString()).toBe('room-2');
      expect(cache.getSearchResults(SearchCriteria.default())).toBeNull();
      expect(cache.getStatistics()).toBeNull();
    });

    it('updateRoom on a cold listings cache still invalidates search + stats', () => {
      // No setRoomListings() — the listings entry is cold.
      cache.setSearchResults(SearchCriteria.default(), makeResult([createRoom('room-1')]));
      cache.setStatistics(makeStats());

      cache.updateRoom(createRoom('room-1', 'New name'));

      expect(cache.getSearchResults(SearchCriteria.default())).toBeNull();
      expect(cache.getStatistics()).toBeNull();
    });

    it('removeRoom on a cold listings cache still invalidates search + stats', () => {
      cache.setSearchResults(SearchCriteria.default(), makeResult([createRoom('room-1')]));
      cache.setStatistics(makeStats());

      cache.removeRoom('room-1');

      expect(cache.getSearchResults(SearchCriteria.default())).toBeNull();
      expect(cache.getStatistics()).toBeNull();
    });
  });

  describe('invalidateAll and stats', () => {
    it('clears every store', () => {
      cache.setRoomListings([createRoom('room-1')]);
      cache.setSearchResults(SearchCriteria.default(), makeResult([createRoom('room-1')]));
      cache.setStatistics(makeStats());

      cache.invalidateAll();

      expect(cache.getRoomListings()).toBeNull();
      expect(cache.getSearchResults(SearchCriteria.default())).toBeNull();
      expect(cache.getStatistics()).toBeNull();
    });

    it('getCacheStats reflects what is currently cached', () => {
      cache.setRoomListings([createRoom('room-1'), createRoom('room-2')]);
      cache.setSearchResults(SearchCriteria.default(), makeResult([createRoom('room-1')]));
      cache.setStatistics(makeStats());

      const stats = cache.getCacheStats();
      expect(stats.roomListings.cached).toBe(true);
      expect(stats.roomListings.count).toBe(2);
      expect(stats.searchResults.validCached).toBe(1);
      expect(stats.statistics.cached).toBe(true);
    });
  });
});

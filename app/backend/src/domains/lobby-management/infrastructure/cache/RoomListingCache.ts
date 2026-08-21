import { LRUCache } from 'lru-cache';
import type { RoomListing } from '../../domain/models/RoomListing';
import type { SearchCriteria, SearchResult } from '../../domain/models/SearchCriteria';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import type { RoomListingStatistics } from '../../domain/repositories/RoomListingRepository';

const ROOM_LISTINGS_KEY = 'all';
const STATISTICS_KEY = 'all';

// Drive lru-cache TTL from Date.now() (wall-clock) instead of the default
// performance.now(). Our TTLs are second-scale so wall-clock precision is ample,
// and it keeps expiry deterministic under test fake-timers.
const DATE_PERF = { now: () => Date.now() };

/**
 * RoomListingCache
 *
 * High-performance cache for room listings to ensure efficient room discovery
 * without affecting room performance. Backed by `lru-cache`, which provides
 * per-key TTL expiry and bounded (LRU-evicting) storage natively — the
 * previously hand-rolled timestamp checks, periodic cleanup interval, and
 * manual oldest-entry eviction are no longer needed.
 *
 * Requirements: 9.6
 */
export class RoomListingCache {
  private readonly ROOM_LISTING_TTL = 30 * 1000; // 30 seconds
  private readonly SEARCH_RESULTS_TTL = 60 * 1000; // 1 minute
  private readonly STATISTICS_TTL = 2 * 60 * 1000; // 2 minutes

  // Single-entry stores keyed by a constant; LRUCache gives us TTL for free.
  private readonly roomListingsCache: LRUCache<string, RoomListing[]>;
  private readonly searchResultsCache: LRUCache<string, SearchResult<RoomListing>>;
  private readonly statisticsCache: LRUCache<string, RoomListingStatistics>;

  constructor() {
    // ttlResolution: 0 forces a live clock read on every access instead of the
    // default 1ms cached value (which is refreshed via an internal timer).
    this.roomListingsCache = new LRUCache({ max: 1, ttl: this.ROOM_LISTING_TTL, ttlResolution: 0, perf: DATE_PERF });
    this.searchResultsCache = new LRUCache({ max: 100, ttl: this.SEARCH_RESULTS_TTL, ttlResolution: 0, perf: DATE_PERF });
    this.statisticsCache = new LRUCache({ max: 1, ttl: this.STATISTICS_TTL, ttlResolution: 0, perf: DATE_PERF });

    loggingService.logInfo('RoomListingCache initialized', {
      roomListingTTL: this.ROOM_LISTING_TTL,
      searchResultsTTL: this.SEARCH_RESULTS_TTL,
      statisticsTTL: this.STATISTICS_TTL
    });
  }

  /**
   * Get cached room listings
   */
  getRoomListings(): RoomListing[] | null {
    return this.roomListingsCache.get(ROOM_LISTINGS_KEY) ?? null;
  }

  /**
   * Cache room listings
   */
  setRoomListings(listings: RoomListing[]): void {
    this.roomListingsCache.set(ROOM_LISTINGS_KEY, [...listings]); // Copy to avoid mutations
  }

  /**
   * Get cached search results
   */
  getSearchResults(criteria: SearchCriteria): SearchResult<RoomListing> | null {
    return this.searchResultsCache.get(criteria.getCacheKey()) ?? null;
  }

  /**
   * Cache search results
   */
  setSearchResults(criteria: SearchCriteria, result: SearchResult<RoomListing>): void {
    this.searchResultsCache.set(criteria.getCacheKey(), {
      ...result,
      items: [...result.items] // Copy to avoid mutations
    });
    // LRUCache enforces the max-size bound (LRU eviction) automatically.
  }

  /**
   * Get cached statistics
   */
  getStatistics(): RoomListingStatistics | null {
    return this.statisticsCache.get(STATISTICS_KEY) ?? null;
  }

  /**
   * Cache statistics
   */
  setStatistics(statistics: RoomListingStatistics): void {
    this.statisticsCache.set(STATISTICS_KEY, { ...statistics }); // Copy
  }

  /**
   * Invalidate room listings cache
   */
  invalidateRoomListings(): void {
    this.roomListingsCache.delete(ROOM_LISTINGS_KEY);
    loggingService.logInfo('RoomListingCache: Room listings cache invalidated');
  }

  /**
   * Invalidate search results cache
   */
  invalidateSearchResults(): void {
    this.searchResultsCache.clear();
    loggingService.logInfo('RoomListingCache: Search results cache invalidated');
  }

  /**
   * Invalidate statistics cache
   */
  invalidateStatistics(): void {
    this.statisticsCache.delete(STATISTICS_KEY);
    loggingService.logInfo('RoomListingCache: Statistics cache invalidated');
  }

  /**
   * Invalidate all caches
   */
  invalidateAll(): void {
    this.invalidateRoomListings();
    this.invalidateSearchResults();
    this.invalidateStatistics();
    loggingService.logInfo('RoomListingCache: All caches invalidated');
  }

  /**
   * Update a specific room in the cache.
   * Mutates the cached array in place so the entry keeps its original TTL.
   */
  updateRoom(roomListing: RoomListing): void {
    const listings = this.roomListingsCache.get(ROOM_LISTINGS_KEY);

    if (listings !== undefined) {
      const index = listings.findIndex(room => room.id.equals(roomListing.id));

      if (index !== -1) {
        listings[index] = roomListing;
        loggingService.logInfo('RoomListingCache: Room updated in cache', {
          roomId: roomListing.id.toString()
        });
      } else {
        // Room not found, add it
        listings.push(roomListing);
        loggingService.logInfo('RoomListingCache: Room added to cache', {
          roomId: roomListing.id.toString()
        });
      }
    }

    // Room data changed — warm search results may list the old data even
    // when the listings entry itself is cold.
    this.invalidateSearchResults();
    this.invalidateStatistics();
  }

  /**
   * Remove a room from the cache.
   * Mutates the cached array in place so the entry keeps its original TTL.
   */
  removeRoom(roomId: string): void {
    const listings = this.roomListingsCache.get(ROOM_LISTINGS_KEY);

    let didRemove = false;
    if (listings !== undefined) {
      const initialLength = listings.length;
      for (let i = listings.length - 1; i >= 0; i--) {
        if (listings[i]!.id.toString() === roomId) {
          listings.splice(i, 1);
        }
      }
      didRemove = listings.length < initialLength;
    }

    if (didRemove) {
      loggingService.logInfo('RoomListingCache: Room removed from cache', {
        roomId
      });
    }

    // Room data changed — warm search results may still list the removed room
    // even when the listings entry is cold or already lacks it (e.g. a bulk
    // setRoomListings overwrote it). Invalidate unconditionally, like updateRoom.
    this.invalidateSearchResults();
    this.invalidateStatistics();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStatistics {
    const roomListings = this.roomListingsCache.get(ROOM_LISTINGS_KEY);
    const isRoomListingsValid = roomListings !== undefined;

    // Drop expired entries so size reflects only valid (non-stale) results.
    this.searchResultsCache.purgeStale();
    const searchResultsSize = this.searchResultsCache.size;

    return {
      roomListings: {
        cached: isRoomListingsValid,
        count: isRoomListingsValid ? roomListings.length : 0
      },
      searchResults: {
        totalCached: searchResultsSize,
        validCached: searchResultsSize
      },
      statistics: {
        cached: this.statisticsCache.has(STATISTICS_KEY)
      },
      memory: {
        roomListingsCacheSize: this.roomListingsCache.size,
        searchResultsCacheSize: searchResultsSize
      }
    };
  }

  /**
   * Shutdown the cache and cleanup resources
   */
  shutdown(): void {
    this.roomListingsCache.clear();
    this.searchResultsCache.clear();
    this.statisticsCache.clear();
    loggingService.logInfo('RoomListingCache shutdown complete');
  }
}

export interface CacheStatistics {
  roomListings: {
    cached: boolean;
    count: number;
  };
  searchResults: {
    totalCached: number;
    validCached: number;
  };
  statistics: {
    cached: boolean;
  };
  memory: {
    roomListingsCacheSize: number;
    searchResultsCacheSize: number;
  };
}

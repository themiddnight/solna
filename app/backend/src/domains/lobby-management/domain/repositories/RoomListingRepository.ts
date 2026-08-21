import type { RoomListing } from '../models/RoomListing';
import type { SearchCriteria, SearchResult } from '../models/SearchCriteria';
import type { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';

/**
 * RoomListingRepository Interface
 * 
 * Defines the contract for persisting and retrieving room listings
 * optimized for lobby operations.
 * 
 * Requirements: 1.3, 3.1
 */
export interface RoomListingRepository {
  /**
   * Finds all active room listings
   */
  findAll(): Promise<RoomListing[]>;

  /**
   * Finds room listings based on search criteria
   */
  findByCriteria(criteria: SearchCriteria): Promise<SearchResult<RoomListing>>;

  /**
   * Finds a specific room listing by ID
   */
  findById(roomId: RoomId): Promise<RoomListing | null>;

  /**
   * Finds room listings by owner
   */
  findByOwner(ownerId: UserId): Promise<RoomListing[]>;

  /**
   * Finds room listings by genre
   */
  findByGenre(genre: string, limit?: number): Promise<RoomListing[]>;

  /**
   * Finds room listings by multiple genres
   */
  findByGenres(genres: string[], limit?: number): Promise<RoomListing[]>;

  /**
   * Finds active room listings (recently active)
   */
  findActive(limit?: number): Promise<RoomListing[]>;

  /**
   * Finds available room listings (not full, active)
   */
  findAvailable(limit?: number): Promise<RoomListing[]>;

  /**
   * Finds popular room listings based on member count and activity
   */
  findPopular(limit?: number): Promise<RoomListing[]>;

  /**
   * Searches room listings by text
   */
  searchByText(searchTerm: string, limit?: number): Promise<RoomListing[]>;

  /**
   * Gets room count statistics
   */
  getStatistics(): Promise<RoomListingStatistics>;

  /**
   * Saves or updates a room listing
   */
  save(roomListing: RoomListing): Promise<void>;

  /**
   * Saves multiple room listings
   */
  saveMany(roomListings: RoomListing[]): Promise<void>;

  /**
   * Removes a room listing
   */
  remove(roomId: RoomId): Promise<void>;

  /**
   * Updates room activity timestamp
   */
  updateActivity(roomId: RoomId, lastActivity: Date): Promise<void>;

  /**
   * Updates room member count
   */
  updateMemberCount(roomId: RoomId, memberCount: number): Promise<void>;

  /**
   * Refreshes all room listings from the source of truth
   */
  refresh(): Promise<void>;

  /**
   * Clears inactive room listings
   */
  clearInactive(olderThan: Date): Promise<number>;
}

/**
 * Room listing statistics
 */
export interface RoomListingStatistics {
  totalRooms: number;
  activeRooms: number;
  privateRooms: number;
  publicRooms: number;
  fullRooms: number;
  availableRooms: number;
  averageMemberCount: number;
  popularGenres: GenreStatistic[];
  activityDistribution: {
    active: number;
    idle: number;
    inactive: number;
  };
}

export interface GenreStatistic {
  genre: string;
  roomCount: number;
  totalMembers: number;
  averageMembers: number;
}
import { RoomListing } from '../domain/models/RoomListing';
import { SearchCriteria, SearchResult } from '../domain/models/SearchCriteria';
import { RoomDiscoveryService } from '../domain/services/RoomDiscoveryService';
import { RoomListingRepository } from '../domain/repositories/RoomListingRepository';
import { EventBus } from '../../../shared/domain/events/EventBus';
import { 
  RoomSearchPerformed, 
  RoomDetailsViewed, 
  RoomJoinAttempted,
  RoomRecommendationsGenerated,
  PopularRoomsCalculated 
} from '../domain/events/LobbyEvents';
import { UserId } from '../../../shared/domain/models/ValueObjects';
import { Monitor } from '../../../shared/infrastructure/monitoring';

/**
 * LobbyApplicationService
 * 
 * Orchestrates lobby operations including room discovery, search, and recommendations.
 * Coordinates between domain services and infrastructure while publishing events.
 * 
 * Requirements: 1.5, 3.1, 9.1
 */
export class LobbyApplicationService {
  constructor(
    private readonly roomListingRepository: RoomListingRepository,
    private readonly roomDiscoveryService: RoomDiscoveryService,
    private readonly eventBus: EventBus
  ) {}

  /**
   * Searches for rooms based on criteria
   */
  @Monitor({ 
    context: 'lobby-management', 
    metricName: 'searchRooms',
    tags: { operation: 'search' }
  })
  async searchRooms(
    criteria: SearchCriteria,
    requestingUserId?: UserId
  ): Promise<SearchResult<RoomListing>> {
    const startTime = Date.now();

    try {
      // Get all room listings
      const allRooms = await this.roomListingRepository.findAll();
      
      // Apply search and filtering through domain service
      const result = await this.roomDiscoveryService.findRooms(
        criteria,
        allRooms,
        requestingUserId
      );

      const searchDuration = Date.now() - startTime;

      // Publish search event
      if (requestingUserId) {
        await this.eventBus.publish(new RoomSearchPerformed(
          requestingUserId.toString(),
          criteria,
          result.totalCount,
          searchDuration
        ));
      }

      return result;
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to search rooms: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Gets recommended rooms for a user
   */
  @Monitor({ 
    context: 'lobby-management', 
    metricName: 'getRecommendedRooms',
    tags: { operation: 'recommendation' }
  })
  async getRecommendedRooms(
    userId: UserId,
    preferredGenres: string[] = [],
    limit: number = 10
  ): Promise<RoomListing[]> {
    try {
      const allRooms = await this.roomListingRepository.findActive();
      
      const recommendations = this.roomDiscoveryService.getRecommendedRooms(
        allRooms,
        userId,
        preferredGenres,
        limit
      );

      // Publish recommendations event
      await this.eventBus.publish(new RoomRecommendationsGenerated(
        userId.toString(),
        recommendations.map(r => r.id.toString()),
        preferredGenres.length > 0 ? 'genre_based' : 'activity_based'
      ));

      return recommendations;
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to get recommendations: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Gets popular rooms
   */
  @Monitor({ 
    context: 'lobby-management', 
    metricName: 'getPopularRooms',
    tags: { operation: 'popular' }
  })
  async getPopularRooms(limit: number = 10): Promise<RoomListing[]> {
    try {
      const allRooms = await this.roomListingRepository.findActive();
      
      const popularRooms = this.roomDiscoveryService.getPopularRooms(allRooms, limit);

      // Publish popular rooms event
      await this.eventBus.publish(new PopularRoomsCalculated(
        popularRooms.map(r => r.id.toString()),
        'hybrid',
        '24h'
      ));

      return popularRooms;
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to get popular rooms: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Gets rooms by genre
   */
  async getRoomsByGenre(
    genre: string,
    userId?: UserId,
    limit: number = 20
  ): Promise<RoomListing[]> {
    try {
      const genreRooms = await this.roomListingRepository.findByGenre(genre, limit);
      
      return this.roomDiscoveryService.getRoomsByGenre(
        genreRooms,
        genre,
        userId,
        limit
      );
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to get rooms by genre: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Searches rooms by text
   */
  async searchRoomsByText(
    searchTerm: string,
    userId?: UserId,
    limit: number = 20
  ): Promise<RoomListing[]> {
    try {
      const searchResults = await this.roomListingRepository.searchByText(searchTerm, limit);
      
      return this.roomDiscoveryService.searchRoomsByText(
        searchResults,
        searchTerm,
        userId,
        limit
      );
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to search rooms by text: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Gets all available rooms (not full, active)
   */
  async getAvailableRooms(userId?: UserId, limit: number = 50): Promise<RoomListing[]> {
    try {
      const availableRooms = await this.roomListingRepository.findAvailable(limit);
      
      if (userId) {
        return availableRooms.filter(room => room.canJoin(userId));
      }
      
      return availableRooms;
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to get available rooms: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Records that a user viewed room details
   */
  async recordRoomDetailsView(
    userId: UserId,
    roomId: string,
    viewSource: 'search' | 'browse' | 'recommendation' = 'browse'
  ): Promise<void> {
    try {
      await this.eventBus.publish(new RoomDetailsViewed(
        userId.toString(),
        roomId,
        viewSource
      ));
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to record room details view: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Records that a user attempted to join a room
   */
  async recordRoomJoinAttempt(
    userId: UserId,
    roomId: string,
    joinMethod: 'direct' | 'approval_request' = 'direct'
  ): Promise<void> {
    try {
      await this.eventBus.publish(new RoomJoinAttempted(
        userId.toString(),
        roomId,
        joinMethod,
        true
      ));
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to record room join attempt: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Gets lobby statistics
   */
  async getLobbyStatistics(): Promise<LobbyStatistics> {
    try {
      const stats = await this.roomListingRepository.getStatistics();
      
      return {
        totalRooms: stats.totalRooms,
        activeRooms: stats.activeRooms,
        availableRooms: stats.availableRooms,
        averageMemberCount: stats.averageMemberCount,
        popularGenres: stats.popularGenres.slice(0, 10), // Top 10 genres
        activityDistribution: stats.activityDistribution
      };
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to get lobby statistics: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Refreshes room listings from the source of truth
   */
  async refreshRoomListings(): Promise<void> {
    try {
      await this.roomListingRepository.refresh();
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to refresh room listings: ${(error as Error).message}`,
        error as Error
      );
    }
  }

  /**
   * Cleans up inactive room listings
   */
  async cleanupInactiveRooms(olderThanHours: number = 24): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
      return await this.roomListingRepository.clearInactive(cutoffDate);
    } catch (error) {
      throw new LobbyApplicationError(
        `Failed to cleanup inactive rooms: ${(error as Error).message}`,
        error as Error
      );
    }
  }
}

/**
 * Lobby statistics interface
 */
export interface LobbyStatistics {
  totalRooms: number;
  activeRooms: number;
  availableRooms: number;
  averageMemberCount: number;
  popularGenres: Array<{
    genre: string;
    roomCount: number;
    totalMembers: number;
    averageMembers: number;
  }>;
  activityDistribution: {
    active: number;
    idle: number;
    inactive: number;
  };
}

/**
 * Lobby application service exceptions
 */
export class LobbyApplicationError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'LobbyApplicationError';
  }
}
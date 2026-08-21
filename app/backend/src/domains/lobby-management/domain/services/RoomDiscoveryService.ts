import type { RoomListing} from '../models/RoomListing';
import { RoomActivityStatus } from '../models/RoomListing';
import type { SearchCriteria, SearchResult } from '../models/SearchCriteria';
import { SortBy, SortOrder } from '../models/SearchCriteria';
import type { UserId } from '../../../../shared/domain/models/ValueObjects';

/**
 * RoomDiscoveryService Domain Service
 * 
 * Encapsulates business logic for room discovery, search, and filtering.
 * Provides intelligent room recommendations and search functionality.
 * 
 * Requirements: 3.1, 9.1
 */
export class RoomDiscoveryService {
  /**
   * Finds rooms based on search criteria
   */
  async findRooms(
    criteria: SearchCriteria,
    roomListings: RoomListing[],
    requestingUserId?: UserId
  ): Promise<SearchResult<RoomListing>> {
    let filteredRooms = this.applyFilters(roomListings, criteria, requestingUserId);
    
    // Apply sorting
    filteredRooms = this.applySorting(filteredRooms, criteria);
    
    // Apply pagination
    const totalCount = filteredRooms.length;
    const paginatedRooms = this.applyPagination(filteredRooms, criteria);
    
    const result: SearchResult<RoomListing> = {
      items: paginatedRooms,
      totalCount,
      hasMore: criteria.offset + criteria.limit < totalCount
    };
    
    if (criteria.offset + criteria.limit < totalCount) {
      result.nextOffset = criteria.offset + criteria.limit;
    }
    
    return result;
  }

  /**
   * Gets recommended rooms for a user based on their preferences and activity
   */
  getRecommendedRooms(
    roomListings: RoomListing[],
    userId: UserId,
    preferredGenres: string[] = [],
    limit: number = 10
  ): RoomListing[] {
    // Filter to isAvailable, active rooms
    let recommendations = roomListings.filter(room => 
      room.canJoin(userId) && 
      room.getActivityStatus() === RoomActivityStatus.Active
    );

    // Prioritize rooms with preferred genres
    if (preferredGenres.length > 0) {
      recommendations = recommendations.sort((a, b) => {
        const aGenreMatch = a.genres.filter(g => preferredGenres.includes(g)).length;
        const bGenreMatch = b.genres.filter(g => preferredGenres.includes(g)).length;
        
        if (aGenreMatch !== bGenreMatch) {
          return bGenreMatch - aGenreMatch; // More genre matches first
        }
        
        // Secondary sort by activity
        return b.lastActivity.getTime() - a.lastActivity.getTime();
      });
    } else {
      // Sort by activity if no genre preferences
      recommendations = recommendations.sort((a, b) => 
        b.lastActivity.getTime() - a.lastActivity.getTime()
      );
    }

    return recommendations.slice(0, limit);
  }

  /**
   * Gets popular rooms based on member count and activity
   */
  getPopularRooms(roomListings: RoomListing[], limit: number = 10): RoomListing[] {
    return roomListings
      .filter(room => 
        room.isActive && 
        room.memberCount > 0 &&
        room.getActivityStatus() !== RoomActivityStatus.Inactive
      )
      .sort((a, b) => {
        // Primary sort: member count
        if (a.memberCount !== b.memberCount) {
          return b.memberCount - a.memberCount;
        }
        
        // Secondary sort: recent activity
        return b.lastActivity.getTime() - a.lastActivity.getTime();
      })
      .slice(0, limit);
  }

  /**
   * Gets rooms by genre with intelligent sorting
   */
  getRoomsByGenre(
    roomListings: RoomListing[],
    genre: string,
    userId?: UserId,
    limit: number = 20
  ): RoomListing[] {
    return roomListings
      .filter(room => {
        if (!room.hasGenre(genre)) return false;
        if (!room.isActive) return false;
        if (userId && !room.canJoin(userId)) return false;
        return true;
      })
      .sort((a, b) => {
        // Prioritize rooms with available space
        const canAJoin = userId ? a.canJoin(userId) : !a.isFull();
        const canBJoin = userId ? b.canJoin(userId) : !b.isFull();
        
        if (canAJoin !== canBJoin) {
          return canAJoin ? -1 : 1;
        }
        
        // Then by member count (more active rooms first)
        if (a.memberCount !== b.memberCount) {
          return b.memberCount - a.memberCount;
        }
        
        // Finally by recent activity
        return b.lastActivity.getTime() - a.lastActivity.getTime();
      })
      .slice(0, limit);
  }

  /**
   * Searches rooms by text with relevance scoring
   */
  searchRoomsByText(
    roomListings: RoomListing[],
    searchTerm: string,
    userId?: UserId,
    limit: number = 20
  ): RoomListing[] {
    if (searchTerm.trim().length === 0) {
      return [];
    }

    const term = searchTerm.toLowerCase().trim();
    
    // Score rooms by relevance
    const scoredRooms = roomListings
      .filter(room => room.isActive && room.matchesSearchTerm(searchTerm))
      .map(room => ({
        room,
        score: this.calculateRelevanceScore(room, term)
      }))
      .filter(({ room }) => !userId || room.canJoin(userId))
      .sort((a, b) => {
        // Primary sort: relevance score
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        
        // Secondary sort: member count
        if (a.room.memberCount !== b.room.memberCount) {
          return b.room.memberCount - a.room.memberCount;
        }
        
        // Tertiary sort: recent activity
        return b.room.lastActivity.getTime() - a.room.lastActivity.getTime();
      })
      .slice(0, limit)
      .map(({ room }) => room);

    return scoredRooms;
  }

  private applyFilters(
    roomListings: RoomListing[],
    criteria: SearchCriteria,
    requestingUserId?: UserId
  ): RoomListing[] {
    return roomListings.filter(room => {
      // Text search filter
      if (criteria.isTextSearch() && !room.matchesSearchTerm(criteria.searchTerm!)) {
        return false;
      }

      // Genre filter
      if (criteria.genres.length > 0 && !room.hasAnyGenre(criteria.genres)) {
        return false;
      }

      // Privacy filter
      if (!criteria.includePrivate && room.isPrivate) {
        return false;
      }

      // Full rooms filter
      if (!criteria.includeFullRooms && room.isFull()) {
        return false;
      }

      // Member count filters
      if (criteria.minMembers !== undefined && room.memberCount < criteria.minMembers) {
        return false;
      }

      if (criteria.maxMembers !== undefined && room.memberCount > criteria.maxMembers) {
        return false;
      }

      // Capacity status filter
      if (criteria.capacityStatus && !criteria.capacityStatus.includes(room.getCapacityStatus())) {
        return false;
      }

      // Activity status filter
      if (criteria.activityStatus && !criteria.activityStatus.includes(room.getActivityStatus())) {
        return false;
      }

      // User-specific filters
      if (requestingUserId && !room.canJoin(requestingUserId)) {
        return false;
      }

      return true;
    });
  }

  private applySorting(roomListings: RoomListing[], criteria: SearchCriteria): RoomListing[] {
    return [...roomListings].sort((a, b) => {
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
          if (criteria.isTextSearch()) {
            const aScore = this.calculateRelevanceScore(a, criteria.searchTerm!.toLowerCase());
            const bScore = this.calculateRelevanceScore(b, criteria.searchTerm!.toLowerCase());
            comparison = aScore - bScore;
          } else {
            // Fallback to activity for non-text searches
            comparison = a.lastActivity.getTime() - b.lastActivity.getTime();
          }
          break;
        
        default:
          comparison = a.lastActivity.getTime() - b.lastActivity.getTime();
      }

      return criteria.sortOrder === SortOrder.Desc ? -comparison : comparison;
    });
  }

  private applyPagination(roomListings: RoomListing[], criteria: SearchCriteria): RoomListing[] {
    const start = criteria.offset;
    const end = start + criteria.limit;
    return roomListings.slice(start, end);
  }

  private calculateRelevanceScore(room: RoomListing, searchTerm: string): number {
    let score = 0;
    const term = searchTerm.toLowerCase();

    // Exact name match gets highest score
    if (room.name.toLowerCase() === term) {
      score += 100;
    } else if (room.name.toLowerCase().startsWith(term)) {
      score += 50;
    } else if (room.name.toLowerCase().includes(term)) {
      score += 25;
    }

    // Owner username match
    if (room.ownerUsername.toLowerCase() === term) {
      score += 30;
    } else if (room.ownerUsername.toLowerCase().includes(term)) {
      score += 15;
    }

    // Genre match
    room.genres.forEach(genre => {
      if (genre.toLowerCase() === term) {
        score += 20;
      } else if (genre.toLowerCase().includes(term)) {
        score += 10;
      }
    });

    // Description match
    if (room.description) {
      if (room.description.toLowerCase().includes(term)) {
        score += 5;
      }
    }

    // Boost score for active rooms with members
    if (room.getActivityStatus() === RoomActivityStatus.Active) {
      score += 10;
    }

    if (room.memberCount > 0) {
      score += Math.min(room.memberCount * 2, 10); // Cap at 10 points
    }

    return score;
  }
}

/**
 * Room Discovery Exceptions
 */
export class RoomDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomDiscoveryError';
  }
}

export class InvalidSearchCriteriaError extends RoomDiscoveryError {
  constructor(message: string) {
    super(`Invalid search criteria: ${message}`);
    this.name = 'InvalidSearchCriteriaError';
  }
}
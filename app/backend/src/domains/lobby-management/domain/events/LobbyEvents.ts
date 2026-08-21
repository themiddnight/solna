import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';
import type { SearchCriteria } from '../models/SearchCriteria';

/**
 * Lobby Management Domain Events
 * 
 * Events related to room discovery, search, and lobby interactions.
 * 
 * Requirements: 5.1, 9.4
 */

/**
 * Published when a user searches for rooms
 */
export class RoomSearchPerformed extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly searchCriteria: SearchCriteria,
    public readonly resultCount: number,
    public readonly searchDurationMs: number
  ) {
    super(userId);
  }
}

/**
 * Published when a user views room details from the lobby
 */
export class RoomDetailsViewed extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly viewSource: 'search' | 'browse' | 'recommendation'
  ) {
    super(roomId);
  }
}

/**
 * Published when a user attempts to join a room from the lobby
 */
export class RoomJoinAttempted extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly joinMethod: 'direct' | 'approval_request',
    public readonly fromLobby: boolean = true
  ) {
    super(roomId);
  }
}

/**
 * Published when room listings are refreshed
 */
export class RoomListingsRefreshed extends DomainEvent {
  constructor(
    public readonly totalRooms: number,
    public readonly activeRooms: number,
    public readonly refreshTrigger: 'scheduled' | 'manual' | 'room_change'
  ) {
    super('lobby');
  }
}

/**
 * Published when a room's lobby status changes (becomes visible/hidden in lobby)
 */
export class RoomLobbyStatusChanged extends DomainEvent {
  constructor(
    public readonly roomId: string,
    public readonly isVisibleInLobby: boolean,
    public readonly reason: 'privacy_change' | 'activity_change' | 'manual'
  ) {
    super(roomId);
  }
}

/**
 * Published when popular rooms are calculated
 */
export class PopularRoomsCalculated extends DomainEvent {
  constructor(
    public readonly roomIds: string[],
    public readonly calculationMethod: 'member_count' | 'activity' | 'hybrid',
    public readonly timeWindow: string
  ) {
    super('lobby');
  }
}

/**
 * Published when room recommendations are generated for a user
 */
export class RoomRecommendationsGenerated extends DomainEvent {
  constructor(
    public readonly userId: string,
    public readonly recommendedRoomIds: string[],
    public readonly recommendationStrategy: 'genre_based' | 'activity_based' | 'collaborative'
  ) {
    super(userId);
  }
}

/**
 * Published when lobby performance metrics are collected
 */
export class LobbyMetricsCollected extends DomainEvent {
  constructor(
    public readonly averageSearchTime: number,
    public readonly totalSearches: number,
    public readonly popularGenres: string[],
    public readonly peakConcurrentUsers: number,
    public readonly timeWindow: string
  ) {
    super('lobby');
  }
}
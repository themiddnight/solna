import type { Namespace, Socket } from 'socket.io';
import { handlePingMeasurement } from '../../../../shared/utils/socketUtils';
import { CORE_NAMESPACES, SOCKET_ERROR_CODES, createSocketErrorPayload, LOBBY_EVENTS, SHARED_EVENTS } from '@jam-band/shared';
import type { LobbyApplicationService } from '../../application/LobbyApplicationService';
import { SearchCriteria } from '../../domain/models/SearchCriteria';
import type { SearchQuery } from '../../domain/models/SearchCriteria';
import { UserId } from '../../../../shared/domain/models/ValueObjects';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { checkSocketRateLimitAsync } from '../../../../middleware/rateLimit';
import { decorateSocketErrorEmits } from '../../../../shared/infrastructure/socket/socketErrors';
import type { RoomListingStatistics } from '../../domain/repositories/RoomListingRepository';
import type { SocketAuthUser } from '@/config/socket';

/**
 * LobbyNamespaceHandlers
 * 
 * Handles WebSocket events for the lobby namespace, providing room discovery,
 * search, and browsing functionality.
 * 
 * Requirements: 9.2, 9.3, 9.4
 */
export class LobbyNamespaceHandlers {
  constructor(private readonly lobbyApplicationService: LobbyApplicationService) {}

  /**
   * Set up event handlers for the lobby namespace
   */
  setupLobbyNamespaceHandlers(namespace: Namespace): void {
    namespace.on('connection', (socket: Socket) => {
      decorateSocketErrorEmits(socket);
      loggingService.logInfo('Socket connected to lobby namespace', {
        socketId: socket.id,
        namespacePath: CORE_NAMESPACES.LOBBY
      });

      // Bind lobby event handlers
      this.bindLobbyEventHandlers(socket, namespace);

      socket.on('disconnect', (reason) => {
        loggingService.logInfo('Socket disconnected from lobby namespace', {
          socketId: socket.id,
          reason,
          namespacePath: CORE_NAMESPACES.LOBBY
        });
      });

      socket.on('error', (error) => {
        loggingService.logError(error as Error, {
          context: 'Lobby namespace socket error',
          socketId: socket.id,
          namespacePath: CORE_NAMESPACES.LOBBY
        });
      });
    });
  }

  /**
   * Broadcast room list updates to all connected lobby clients
   */
  broadcastRoomListUpdate(namespace: Namespace, updateType: 'created' | 'updated' | 'deleted', roomSummary: Record<string, unknown>): void {
    namespace.to('lobby_updates').emit(LOBBY_EVENTS.ROOM_LIST_UPDATED, {
      type: updateType,
      room: roomSummary,
      timestamp: Date.now()
    });
  }

  /**
   * Broadcast lobby statistics updates
   */
  broadcastLobbyStatistics(namespace: Namespace, statistics: RoomListingStatistics): void {
    namespace.to('lobby_updates').emit(LOBBY_EVENTS.LOBBY_STATISTICS_UPDATED, {
      statistics,
      timestamp: Date.now()
    });
  }

  /**
   * DEV-179: the acting user for lobby personalization (browse/search/recommend) and analytics
   * (view/join attempts) is taken from the verified socket token — set by `authenticateSocket` on
   * the lobby namespace and never overwritten there — not from the client `data.userId`, which a
   * client could set to any value to read another user's personalized results or forge their
   * analytics. Returns undefined only if the socket is somehow unauthenticated.
   */
  private getActingUserId(socket: Socket): string | undefined {
    return (socket.data as { user?: SocketAuthUser }).user?.id;
  }

  /**
   * Bind lobby-specific event handlers to the socket
   */
  private bindLobbyEventHandlers(socket: Socket, _namespace: Namespace): void {
    // Room browsing and search events
    socket.on(LOBBY_EVENTS.BROWSE_ROOMS, async (data: LobbySocketData) => {
      void this.handleBrowseRooms(socket, data);
    });

    socket.on(LOBBY_EVENTS.SEARCH_ROOMS, async (data: LobbySocketData) => {
      void this.handleSearchRooms(socket, data);
    });

    socket.on(LOBBY_EVENTS.GET_POPULAR_ROOMS, async (data: LobbySocketData) => {
      void this.handleGetPopularRooms(socket, data);
    });

    socket.on(LOBBY_EVENTS.GET_RECOMMENDED_ROOMS, async (data: LobbySocketData) => {
      void this.handleGetRecommendedRooms(socket, data);
    });

    socket.on(LOBBY_EVENTS.GET_ROOMS_BY_GENRE, async (data: LobbySocketData) => {
      void this.handleGetRoomsByGenre(socket, data);
    });

    socket.on(LOBBY_EVENTS.GET_AVAILABLE_ROOMS, async (data: LobbySocketData) => {
      void this.handleGetAvailableRooms(socket, data);
    });

    socket.on(LOBBY_EVENTS.GET_LOBBY_STATISTICS, async (data: LobbySocketData) => {
      void this.handleGetLobbyStatistics(socket, data);
    });

    socket.on(LOBBY_EVENTS.VIEW_ROOM_DETAILS, async (data: LobbySocketData) => {
      void this.handleViewRoomDetails(socket, data);
    });

    socket.on(LOBBY_EVENTS.ATTEMPT_ROOM_JOIN, async (data: LobbySocketData) => {
      void this.handleAttemptRoomJoin(socket, data);
    });

    // Ping measurement for latency monitoring
    socket.on(SHARED_EVENTS.PING_MEASUREMENT, (data) => handlePingMeasurement(socket, data));

    // Real-time room updates subscription
    socket.on(LOBBY_EVENTS.SUBSCRIBE_ROOM_UPDATES, () => {
      void this.handleSubscribeRoomUpdates(socket);
    });

    socket.on(LOBBY_EVENTS.UNSUBSCRIBE_ROOM_UPDATES, () => {
      void this.handleUnsubscribeRoomUpdates(socket);
    });
  }

  private async handleBrowseRooms(socket: Socket, data: LobbySocketData): Promise<void> {
    const rateLimitCheck = await checkSocketRateLimitAsync(socket, LOBBY_EVENTS.BROWSE_ROOMS);
    if (!rateLimitCheck.allowed) {
      socket.emit('error', createSocketErrorPayload(
        `Rate limit exceeded for ${LOBBY_EVENTS.BROWSE_ROOMS}. Try again in ${rateLimitCheck.retryAfter} seconds.`,
        { code: SOCKET_ERROR_CODES.RATE_LIMITED, retryAfter: rateLimitCheck.retryAfter },
      ));
      return;
    }

    try {
      const criteria = data.criteria !== undefined ? SearchCriteria.fromQuery(data.criteria) : SearchCriteria.default();
      const actingUserId = this.getActingUserId(socket);
      const userId = actingUserId !== undefined ? UserId.fromString(actingUserId) : undefined;

      const result = await this.lobbyApplicationService.searchRooms(criteria, userId);

      socket.emit(LOBBY_EVENTS.ROOMS_BROWSED, {
        success: true,
        rooms: result.items.map(room => room.toSummary()),
        totalCount: result.totalCount,
        hasMore: result.hasMore,
        nextOffset: result.nextOffset
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Browse rooms error',
        socketId: socket.id,
        data
      });

      socket.emit(LOBBY_EVENTS.ROOMS_BROWSED, {
        success: false,
        error: 'Failed to browse rooms'
      });
    }
  }

  private async handleSearchRooms(socket: Socket, data: LobbySocketData): Promise<void> {
    const rateLimitCheck = await checkSocketRateLimitAsync(socket, LOBBY_EVENTS.SEARCH_ROOMS);
    if (!rateLimitCheck.allowed) {
      socket.emit('error', createSocketErrorPayload(
        `Rate limit exceeded for ${LOBBY_EVENTS.SEARCH_ROOMS}. Try again in ${rateLimitCheck.retryAfter} seconds.`,
        { code: SOCKET_ERROR_CODES.RATE_LIMITED, retryAfter: rateLimitCheck.retryAfter },
      ));
      return;
    }

    try {
      const searchTerm = data.searchTerm ?? '';
      const actingUserId = this.getActingUserId(socket);
      const userId = actingUserId !== undefined ? UserId.fromString(actingUserId) : undefined;
      const limit = data.limit ?? 20;

      const rooms = await this.lobbyApplicationService.searchRoomsByText(
        searchTerm,
        userId,
        limit
      );

      socket.emit(LOBBY_EVENTS.ROOMS_SEARCHED, {
        success: true,
        rooms: rooms.map(room => room.toSummary()),
        searchTerm
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Search rooms error',
        socketId: socket.id,
        data
      });

      socket.emit(LOBBY_EVENTS.ROOMS_SEARCHED, {
        success: false,
        error: 'Failed to search rooms'
      });
    }
  }

  private async handleGetPopularRooms(socket: Socket, data: LobbySocketData): Promise<void> {
    const rateLimitCheck = await checkSocketRateLimitAsync(socket, LOBBY_EVENTS.GET_POPULAR_ROOMS);
    if (!rateLimitCheck.allowed) {
      socket.emit('error', createSocketErrorPayload(
        `Rate limit exceeded for ${LOBBY_EVENTS.GET_POPULAR_ROOMS}. Try again in ${rateLimitCheck.retryAfter} seconds.`,
        { code: SOCKET_ERROR_CODES.RATE_LIMITED, retryAfter: rateLimitCheck.retryAfter },
      ));
      return;
    }

    try {
      const limit = data.limit ?? 10;
      const popularRooms = await this.lobbyApplicationService.getPopularRooms(limit);

      socket.emit(LOBBY_EVENTS.POPULAR_ROOMS, {
        success: true,
        rooms: popularRooms.map(room => room.toSummary())
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Get popular rooms error',
        socketId: socket.id,
        data
      });

      socket.emit(LOBBY_EVENTS.POPULAR_ROOMS, {
        success: false,
        error: 'Failed to get popular rooms'
      });
    }
  }

  private async handleGetRecommendedRooms(socket: Socket, data: LobbySocketData): Promise<void> {
    const rateLimitCheck = await checkSocketRateLimitAsync(socket, LOBBY_EVENTS.GET_RECOMMENDED_ROOMS);
    if (!rateLimitCheck.allowed) {
      socket.emit('error', createSocketErrorPayload(
        `Rate limit exceeded for ${LOBBY_EVENTS.GET_RECOMMENDED_ROOMS}. Try again in ${rateLimitCheck.retryAfter} seconds.`,
        { code: SOCKET_ERROR_CODES.RATE_LIMITED, retryAfter: rateLimitCheck.retryAfter },
      ));
      return;
    }

    try {
      const userId = this.getActingUserId(socket);
      const preferredGenres = data.preferredGenres ?? [];
      const limit = data.limit ?? 10;

      if (userId === undefined) {
        socket.emit(LOBBY_EVENTS.RECOMMENDED_ROOMS, {
          success: false,
          error: 'User ID is required for recommendations'
        });
        return;
      }

      const userIdObj = UserId.fromString(userId);
      const recommendations = await this.lobbyApplicationService.getRecommendedRooms(
        userIdObj,
        preferredGenres,
        limit
      );

      socket.emit(LOBBY_EVENTS.RECOMMENDED_ROOMS, {
        success: true,
        rooms: recommendations.map(room => room.toSummary())
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Get recommended rooms error',
        socketId: socket.id,
        data
      });

      socket.emit(LOBBY_EVENTS.RECOMMENDED_ROOMS, {
        success: false,
        error: 'Failed to get recommended rooms'
      });
    }
  }

  private async handleGetRoomsByGenre(socket: Socket, data: LobbySocketData): Promise<void> {
    const rateLimitCheck = await checkSocketRateLimitAsync(socket, LOBBY_EVENTS.GET_ROOMS_BY_GENRE);
    if (!rateLimitCheck.allowed) {
      socket.emit('error', createSocketErrorPayload(
        `Rate limit exceeded for ${LOBBY_EVENTS.GET_ROOMS_BY_GENRE}. Try again in ${rateLimitCheck.retryAfter} seconds.`,
        { code: SOCKET_ERROR_CODES.RATE_LIMITED, retryAfter: rateLimitCheck.retryAfter },
      ));
      return;
    }

    try {
      const genre = data.genre;
      const userId = this.getActingUserId(socket);
      const limit = data.limit ?? 20;

      if (genre === undefined) {
        socket.emit(LOBBY_EVENTS.ROOMS_BY_GENRE, {
          success: false,
          error: 'Genre is required'
        });
        return;
      }

      const userIdObj = userId !== undefined ? UserId.fromString(userId) : undefined;
      const rooms = await this.lobbyApplicationService.getRoomsByGenre(
        genre,
        userIdObj,
        limit
      );

      socket.emit(LOBBY_EVENTS.ROOMS_BY_GENRE, {
        success: true,
        rooms: rooms.map(room => room.toSummary()),
        genre
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Get rooms by genre error',
        socketId: socket.id,
        data
      });

      socket.emit(LOBBY_EVENTS.ROOMS_BY_GENRE, {
        success: false,
        error: 'Failed to get rooms by genre'
      });
    }
  }

  private async handleGetAvailableRooms(socket: Socket, data: LobbySocketData): Promise<void> {
    const rateLimitCheck = await checkSocketRateLimitAsync(socket, LOBBY_EVENTS.GET_AVAILABLE_ROOMS);
    if (!rateLimitCheck.allowed) {
      socket.emit('error', createSocketErrorPayload(
        `Rate limit exceeded for ${LOBBY_EVENTS.GET_AVAILABLE_ROOMS}. Try again in ${rateLimitCheck.retryAfter} seconds.`,
        { code: SOCKET_ERROR_CODES.RATE_LIMITED, retryAfter: rateLimitCheck.retryAfter },
      ));
      return;
    }

    try {
      const userId = this.getActingUserId(socket);
      const limit = data.limit ?? 50;
      const userIdObj = userId !== undefined ? UserId.fromString(userId) : undefined;

      const availableRooms = await this.lobbyApplicationService.getAvailableRooms(
        userIdObj,
        limit
      );

      socket.emit(LOBBY_EVENTS.AVAILABLE_ROOMS, {
        success: true,
        rooms: availableRooms.map(room => room.toSummary())
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Get available rooms error',
        socketId: socket.id,
        data
      });

      socket.emit(LOBBY_EVENTS.AVAILABLE_ROOMS, {
        success: false,
        error: 'Failed to get available rooms'
      });
    }
  }

  private async handleGetLobbyStatistics(socket: Socket, _data: LobbySocketData): Promise<void> {
    const rateLimitCheck = await checkSocketRateLimitAsync(socket, LOBBY_EVENTS.GET_LOBBY_STATISTICS);
    if (!rateLimitCheck.allowed) {
      socket.emit('error', createSocketErrorPayload(
        `Rate limit exceeded for ${LOBBY_EVENTS.GET_LOBBY_STATISTICS}. Try again in ${rateLimitCheck.retryAfter} seconds.`,
        { code: SOCKET_ERROR_CODES.RATE_LIMITED, retryAfter: rateLimitCheck.retryAfter },
      ));
      return;
    }

    try {
      const statistics = await this.lobbyApplicationService.getLobbyStatistics();

      socket.emit(LOBBY_EVENTS.LOBBY_STATISTICS, {
        success: true,
        statistics
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Get lobby statistics error',
        socketId: socket.id,
        _data
      });

      socket.emit(LOBBY_EVENTS.LOBBY_STATISTICS, {
        success: false,
        error: 'Failed to get lobby statistics'
      });
    }
  }

  private async handleViewRoomDetails(socket: Socket, data: LobbySocketData): Promise<void> {
    try {
      const userId = this.getActingUserId(socket);
      const roomId = data.roomId;
      const viewSource = data.viewSource ?? 'browse';
      
      if (userId !== undefined && roomId !== undefined) {
        const userIdObj = UserId.fromString(userId);
        await this.lobbyApplicationService.recordRoomDetailsView(
          userIdObj,
          roomId,
          viewSource as 'search' | 'browse' | 'recommendation'
        );
      }

      socket.emit(LOBBY_EVENTS.ROOM_DETAILS_VIEWED, {
        success: true,
        roomId
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'View room details error',
        socketId: socket.id,
        data
      });

      socket.emit(LOBBY_EVENTS.ROOM_DETAILS_VIEWED, {
        success: false,
        error: 'Failed to record room details view'
      });
    }
  }

  private async handleAttemptRoomJoin(socket: Socket, data: LobbySocketData): Promise<void> {
    try {
      const userId = this.getActingUserId(socket);
      const roomId = data.roomId;
      const joinMethod = data.joinMethod ?? 'direct';
      
      if (userId !== undefined && roomId !== undefined) {
        const userIdObj = UserId.fromString(userId);
        await this.lobbyApplicationService.recordRoomJoinAttempt(
          userIdObj,
          roomId,
          joinMethod as 'direct' | 'approval_request'
        );
      }

      socket.emit(LOBBY_EVENTS.ROOM_JOIN_ATTEMPTED, {
        success: true,
        roomId,
        joinMethod
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Attempt room join error',
        socketId: socket.id,
        data
      });

      socket.emit(LOBBY_EVENTS.ROOM_JOIN_ATTEMPTED, {
        success: false,
        error: 'Failed to record room join attempt'
      });
    }
  }

  private async handleSubscribeRoomUpdates(socket: Socket): Promise<void> {
    try {
      void socket.join('lobby_updates');
      
      socket.emit(LOBBY_EVENTS.SUBSCRIBED_ROOM_UPDATES, {
        success: true,
        message: 'Subscribed to room updates'
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Subscribe room updates failure',
        socketId: socket.id
      });
      socket.emit(LOBBY_EVENTS.SUBSCRIBED_ROOM_UPDATES, {
        success: false,
        error: 'Failed to subscribe to room updates'
      });
    }
  }

  private async handleUnsubscribeRoomUpdates(socket: Socket): Promise<void> {
    try {
      void socket.leave('lobby_updates');
      
      socket.emit(LOBBY_EVENTS.UNSUBSCRIBED_ROOM_UPDATES, {
        success: true,
        message: 'Unsubscribed from room updates'
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Unsubscribe room updates failure',
        socketId: socket.id
      });
      socket.emit(LOBBY_EVENTS.UNSUBSCRIBED_ROOM_UPDATES, {
        success: false,
        error: 'Failed to unsubscribe from room updates'
      });
    }
  }
}

interface LobbySocketData {
  criteria?: SearchQuery;
  userId?: string;
  searchTerm?: string;
  limit?: number;
  genre?: string;
  preferredGenres?: string[];
  roomId?: string;
  viewSource?: string;
  joinMethod?: string;
}

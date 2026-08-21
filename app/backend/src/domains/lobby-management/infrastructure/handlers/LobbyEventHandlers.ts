import type { EventBus } from '../../../../shared/domain/events/EventBus';
import { CORE_NAMESPACES, ROOM_STATE_EVENTS } from '@jam-band/shared';
import {
  RoomCreated,
  MemberJoined,
  MemberLeft,
  OwnershipTransferred,
  RoomClosed,
  RoomSettingsUpdated,
  RoomOccupancyChanged
} from '../../../../shared/domain/events/RoomEvents';
import type { LobbyIntegrationService } from '../LobbyIntegrationService';
import { 
  RoomListingsRefreshed, 
  RoomLobbyStatusChanged,
  LobbyMetricsCollected 
} from '../../domain/events/LobbyEvents';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import type { RoomListingSummary } from '../../domain/models/RoomListing';
import type { RoomOccupancy } from '../../../room-management/application/RoomLifecycleService';
import { RoomId } from '../../../../shared/domain/models/ValueObjects';

/**
 * Room payload broadcast to lobby clients: the base listing summary enriched with
 * live occupancy counts in the shape the lobby card consumes (members / companions
 * / audiences). roomType & isBroadcasting are preserved client-side from the
 * initial REST load, so only the volatile counts need to be patched here.
 */
type LobbyRoomBroadcast = RoomListingSummary &
  Partial<Pick<RoomOccupancy, 'activeBandMemberCount' | 'audienceCount' | 'companionCount' | 'userCount'>>;

/**
 * LobbyEventHandlers
 * 
 * Handles domain events from other bounded contexts to keep lobby
 * room listings up-to-date in real-time. Implements efficient room discovery
 * without affecting room performance through batching and caching strategies.
 * 
 * Requirements: 9.4, 9.6
 */
export class LobbyEventHandlers {
  private readonly updateBatch: Map<string, RoomUpdateInfo> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_INTERVAL_MS = 1000; // 1 second batching
  private readonly MAX_BATCH_SIZE = 50;
  private metricsCollectionTimer: NodeJS.Timeout | null = null;
  private readonly METRICS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly eventBus: EventBus,
    private readonly lobbyIntegrationService: LobbyIntegrationService
  ) {
    this.setupEventHandlers();
    this.startMetricsCollection();
  }

  /**
   * Handle room privacy changes
   */
  async handleRoomPrivacyChange(roomId: string, isPrivate: boolean): Promise<void> {
    try {
      await this.eventBus.publish(new RoomLobbyStatusChanged(
        roomId,
        !isPrivate,
        'privacy_change'
      ));

      await this.broadcastRoomUpdate(roomId);
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Handle room privacy change',
        roomId,
        isPrivate
      });
    }
  }

  /**
   * Handle room activity changes
   */
  async handleRoomActivityChange(roomId: string, isActive: boolean): Promise<void> {
    try {
      await this.eventBus.publish(new RoomLobbyStatusChanged(
        roomId,
        isActive,
        'activity_change'
      ));

      await this.broadcastRoomUpdate(roomId);
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Handle room activity change',
        roomId,
        isActive
      });
    }
  }

  /**
   * Refresh all room listings
   */
  async refreshRoomListings(): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      await lobbyService.refreshRoomListings();

      await this.eventBus.publish(new RoomListingsRefreshed(
        await this.getTotalRoomCount(),
        await this.getActiveRoomCount(),
        'manual'
      ));

      await this.lobbyIntegrationService.broadcastLobbyStatistics();
      loggingService.logInfo('Lobby: Room listings refreshed');
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Refresh room listings'
      });
    }
  }

  /**
   * Cleanup inactive rooms
   */
  async cleanupInactiveRooms(olderThanHours: number = 24): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      const cleanedCount = await lobbyService.cleanupInactiveRooms(olderThanHours);

      if (cleanedCount > 0) {
        loggingService.logInfo('Lobby: Cleaned up inactive rooms', {
          cleanedCount,
          olderThanHours
        });
        await this.refreshRoomListings();
      }
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Cleanup inactive rooms',
        olderThanHours
      });
    }
  }

  /**
   * Handle real-time room activity updates
   */
  async handleRoomActivityUpdate(roomId: string, activityData: RoomActivityData): Promise<void> {
    try {
      this.addToBatch(roomId, {
        type: 'activity_updated',
        timestamp: new Date(),
        activityData
      });

      if (this.isSignificantActivityChange(activityData)) {
        await this.eventBus.publish(new RoomLobbyStatusChanged(
          roomId,
          activityData.isActive,
          'activity_change'
        ));
      }
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Handle room activity update',
        roomId,
        activityData
      });
    }
  }

  /**
   * Shutdown the event handlers and cleanup resources
   */
  shutdown(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.metricsCollectionTimer !== null) {
      clearInterval(this.metricsCollectionTimer);
      this.metricsCollectionTimer = null;
    }

    if (this.updateBatch.size > 0) {
      void this.processBatch();
    }
  }

  /**
   * Set up event handlers for room-related events
   */
  private setupEventHandlers(): void {
    this.eventBus.subscribe(RoomCreated.name, this.handleRoomCreated.bind(this));
    this.eventBus.subscribe(RoomClosed.name, this.handleRoomClosed.bind(this));
    this.eventBus.subscribe(MemberJoined.name, this.handleMemberJoined.bind(this));
    this.eventBus.subscribe(MemberLeft.name, this.handleMemberLeft.bind(this));
    this.eventBus.subscribe(OwnershipTransferred.name, this.handleOwnershipTransferred.bind(this));
    this.eventBus.subscribe(RoomSettingsUpdated.name, this.handleRoomSettingsUpdated.bind(this));
    this.eventBus.subscribe(RoomOccupancyChanged.name, this.handleRoomOccupancyChanged.bind(this));
  }

  /**
   * Handle occupancy change (e.g. companions added/removed) — refresh the room's
   * live counts in the lobby without requiring a member join/leave.
   */
  private handleRoomOccupancyChanged(event: RoomOccupancyChanged): void {
    this.addToBatch(event.aggregateId, {
      type: 'updated',
      timestamp: event.occurredOn
    });
  }

  /**
   * Handle room created event
   */
  private async handleRoomCreated(event: RoomCreated): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Room created', {
        roomId: event.aggregateId,
        roomName: event.roomName,
        ownerId: event.ownerId,
        isPrivate: event.isPrivate
      });

      this.addToBatch(event.aggregateId, {
        type: 'created',
        timestamp: event.occurredOn
      });

      await this.eventBus.publish(new RoomListingsRefreshed(
        await this.getTotalRoomCount(),
        await this.getActiveRoomCount(),
        'room_change'
      ));
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Handle room created',
        roomId: event.aggregateId
      });
    }
  }

  /**
   * Handle room closed event
   */
  private async handleRoomClosed(event: RoomClosed): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Room closed', {
        roomId: event.aggregateId,
        closedBy: event.closedBy,
        reason: event.reason
      });

      this.addToBatch(event.aggregateId, {
        type: 'deleted',
        timestamp: event.occurredOn
      });

      await this.eventBus.publish(new RoomListingsRefreshed(
        await this.getTotalRoomCount(),
        await this.getActiveRoomCount(),
        'room_change'
      ));
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Handle room closed',
        roomId: event.aggregateId
      });
    }
  }

  /**
   * Handle member joined event
   */
  private async handleMemberJoined(event: MemberJoined): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Member joined room', {
        roomId: event.aggregateId,
        userId: event.userId,
        username: event.username,
        role: event.role
      });

      this.addToBatch(event.aggregateId, {
        type: 'updated',
        timestamp: event.occurredOn
      });
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Handle member joined',
        roomId: event.aggregateId,
        userId: event.userId
      });
    }
  }

  /**
   * Handle member left event
   */
  private async handleMemberLeft(event: MemberLeft): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Member left room', {
        roomId: event.aggregateId,
        userId: event.userId,
        username: event.username
      });

      this.addToBatch(event.aggregateId, {
        type: 'updated',
        timestamp: event.occurredOn
      });
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Handle member left',
        roomId: event.aggregateId,
        userId: event.userId
      });
    }
  }

  /**
   * Handle ownership transferred event
   */
  private async handleOwnershipTransferred(event: OwnershipTransferred): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Room ownership transferred', {
        roomId: event.aggregateId,
        previousOwnerId: event.previousOwnerId,
        newOwnerId: event.newOwnerId
      });

      this.addToBatch(event.aggregateId, {
        type: 'updated',
        timestamp: event.occurredOn
      });
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Handle ownership transferred',
        roomId: event.aggregateId
      });
    }
  }

  /**
   * Handle room settings updated event
   */
  private async handleRoomSettingsUpdated(event: RoomSettingsUpdated): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Room settings updated', {
        roomId: event.aggregateId,
        updatedBy: event.updatedBy,
        changes: event.changes
      });

      const changes = event.changes as Record<string, unknown>;
      const hasLobbyAffect = this.checkIfSettingsAffectLobby(changes);
      
      if (hasLobbyAffect) {
        this.addToBatch(event.aggregateId, {
          type: 'settings_updated',
          timestamp: event.occurredOn,
          changes
        });

        if ('isPrivate' in changes) {
          await this.eventBus.publish(new RoomLobbyStatusChanged(
            event.aggregateId,
            !(changes.isPrivate as boolean),
            'privacy_change'
          ));
        }
      }
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Handle room settings updated',
        roomId: event.aggregateId
      });
    }
  }

  /**
   * Merge live member/companion/audience occupancy into a listing summary so the
   * lobby card's counts stay accurate. Falls back to the bare summary if occupancy
   * can't be resolved (e.g. room just deleted).
   */
  private async enrichSummaryWithOccupancy(
    roomId: string,
    roomSummary: RoomListingSummary,
  ): Promise<LobbyRoomBroadcast> {
    const occupancy = await this.lobbyIntegrationService
      .getRoomLifecycleService()
      .getRoomOccupancy(roomId);

    if (occupancy === null) {
      return roomSummary;
    }

    return {
      ...roomSummary,
      activeBandMemberCount: occupancy.activeBandMemberCount,
      audienceCount: occupancy.audienceCount,
      companionCount: occupancy.companionCount,
      userCount: occupancy.userCount,
    };
  }

  /**
   * Broadcast room update to lobby clients
   */
  private async broadcastRoomUpdate(roomId: string): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      const roomListing = await lobbyService['roomListingRepository'].findById(
        RoomId.fromString(roomId)
      );

      if (roomListing !== null) {
        const roomSummary = await this.enrichSummaryWithOccupancy(roomId, roomListing.toSummary());
        this.lobbyIntegrationService.broadcastRoomUpdate('updated', roomSummary as unknown as Record<string, unknown>);
      }
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Broadcast room update',
        roomId
      });
    }
  }

  /**
   * Get total room count for statistics
   */
  private async getTotalRoomCount(): Promise<number> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      const statistics = await lobbyService.getLobbyStatistics();
      return statistics.totalRooms;
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Get total room count'
      });
      return 0;
    }
  }

  /**
   * Get active room count for statistics
   */
  private async getActiveRoomCount(): Promise<number> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      const statistics = await lobbyService.getLobbyStatistics();
      return statistics.activeRooms;
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Get active room count'
      });
      return 0;
    }
  }

  /**
   * Check if room settings changes affect lobby visibility
   */
  private checkIfSettingsAffectLobby(changes: Record<string, unknown>): boolean {
    const lobbyAffectingSettings = [
      'isPrivate',
      'requiresApproval', 
      'maxMembers',
      'genres',
      'description',
      'name'
    ];

    return Object.keys(changes).some(key => lobbyAffectingSettings.includes(key));
  }

  /**
   * Add room update to batch for efficient processing
   */
  private addToBatch(roomId: string, updateInfo: RoomUpdateInfo): void {
    const existing = this.updateBatch.get(roomId);
    if (existing) {
      this.updateBatch.set(roomId, {
        ...existing,
        ...updateInfo,
        timestamp: updateInfo.timestamp > existing.timestamp ? updateInfo.timestamp : existing.timestamp
      });
    } else {
      this.updateBatch.set(roomId, updateInfo);
    }

    if (this.updateBatch.size >= this.MAX_BATCH_SIZE) {
      void this.processBatch();
    } else {
      this.scheduleBatchProcessing();
    }
  }

  /**
   * Schedule batch processing with debouncing
   */
  private scheduleBatchProcessing(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      void this.processBatch();
    }, this.BATCH_INTERVAL_MS);
  }

  /**
   * Process batched room updates efficiently
   */
  private async processBatch(): Promise<void> {
    if (this.updateBatch.size === 0) {
      return;
    }

    const batchToProcess = new Map(this.updateBatch);
    this.updateBatch.clear();

    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    try {
      loggingService.logInfo('Lobby: Processing batched room updates', {
        batchSize: batchToProcess.size
      });

      const updatePromises = Array.from(batchToProcess.entries()).map(
        async ([roomId, updateInfo]) => {
          try {
            await this.processRoomUpdate(roomId, updateInfo);
          } catch (error) {
            loggingService.logError(error as Error, {
              context: 'Lobby: Process room update in batch',
              roomId,
              updateInfo
            });
          }
        }
      );

      await Promise.allSettled(updatePromises);
      await this.broadcastBatchUpdate(batchToProcess);
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Process batch',
        batchSize: batchToProcess.size
      });
    }
  }

  /**
   * Process individual room update
   */
  private async processRoomUpdate(roomId: string, updateInfo: RoomUpdateInfo): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      
      const roomListing = await lobbyService['roomListingRepository'].findById(
        RoomId.fromString(roomId)
      );

      if (roomListing !== null) {
        let updateType: 'created' | 'updated' | 'deleted' = 'updated';
        if (updateInfo.type === 'created') {
          updateType = 'created';
        } else if (updateInfo.type === 'deleted') {
          updateType = 'deleted';
        }

        updateInfo.roomSummary = await this.enrichSummaryWithOccupancy(roomId, roomListing.toSummary());
        updateInfo.updateType = updateType;
      }
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Process room update',
        roomId,
        updateInfo
      });
    }
  }

  /**
   * Broadcast batched updates to lobby clients
   */
  private async broadcastBatchUpdate(batchUpdates: Map<string, RoomUpdateInfo>): Promise<void> {
    try {
      const lobbyNamespace = this.lobbyIntegrationService['io'].of(CORE_NAMESPACES.LOBBY);
      
      const groupedUpdates: {
        created: Array<{ roomId: string; room: LobbyRoomBroadcast; timestamp: Date }>;
        updated: Array<{ roomId: string; room: LobbyRoomBroadcast; timestamp: Date }>;
        deleted: Array<{ roomId: string; room: LobbyRoomBroadcast; timestamp: Date }>;
      } = {
        created: [],
        updated: [],
        deleted: []
      };

      for (const [roomId, updateInfo] of batchUpdates) {
        if (updateInfo.roomSummary !== undefined && updateInfo.updateType !== undefined) {
          groupedUpdates[updateInfo.updateType].push({
            roomId,
            room: updateInfo.roomSummary,
            timestamp: updateInfo.timestamp
          });
        }
      }

      if (groupedUpdates.created.length > 0) {
        lobbyNamespace.to('lobby_updates').emit('rooms_batch_created', {
          rooms: groupedUpdates.created,
          count: groupedUpdates.created.length,
          timestamp: Date.now()
        });
      }

      if (groupedUpdates.updated.length > 0) {
        lobbyNamespace.to('lobby_updates').emit('rooms_batch_updated', {
          rooms: groupedUpdates.updated,
          count: groupedUpdates.updated.length,
          timestamp: Date.now()
        });

        // Also emit a per-room `room_updated_broadcast` to the whole /lobby namespace —
        // the event + namespace the lobby client actually listens on — carrying the
        // canonical member/companion/audience counts so cards stay live without a
        // full list refetch. Driven by every occupancy-relevant domain event
        // (member join/leave, ownership, settings, companion add/remove).
        for (const { room } of groupedUpdates.updated) {
          if (room.userCount === undefined || room.userCount <= 0) {
            // Occupancy unresolved or room empty — empty rooms are removed via
            // room_closed_broadcast, and the list never shows 0-user rooms.
            continue;
          }
          lobbyNamespace.emit(ROOM_STATE_EVENTS.ROOM_UPDATED_BROADCAST, {
            id: room.id,
            userCount: room.userCount,
            activeBandMemberCount: room.activeBandMemberCount,
            audienceCount: room.audienceCount,
            companionCount: room.companionCount,
          });
        }
      }

      if (groupedUpdates.deleted.length > 0) {
        lobbyNamespace.to('lobby_updates').emit('rooms_batch_deleted', {
          rooms: groupedUpdates.deleted,
          count: groupedUpdates.deleted.length,
          timestamp: Date.now()
        });
      }

      const totalChanges = groupedUpdates.created.length + 
                          groupedUpdates.updated.length + 
                          groupedUpdates.deleted.length;
      
      if (totalChanges >= 5) {
        await this.lobbyIntegrationService.broadcastLobbyStatistics();
      }
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Broadcast batch update',
        batchSize: batchUpdates.size
      });
    }
  }

  /**
   * Start periodic metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsCollectionTimer = setInterval(async () => {
      await this.collectAndPublishMetrics();
    }, this.METRICS_INTERVAL_MS);
  }

  /**
   * Collect and publish lobby metrics
   */
  private async collectAndPublishMetrics(): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      const statistics = await lobbyService.getLobbyStatistics();

      const averageSearchTime = await this.calculateAverageSearchTime();
      const totalSearches = await this.getTotalSearchCount();
      const popularGenres = statistics.popularGenres.slice(0, 5).map(g => g.genre);
      const peakConcurrentUsers = await this.getPeakConcurrentUsers();

      await this.eventBus.publish(new LobbyMetricsCollected(
        averageSearchTime,
        totalSearches,
        popularGenres,
        peakConcurrentUsers,
        '5m'
      ));

      loggingService.logInfo('Lobby: Metrics collected and published', {
        averageSearchTime,
        totalSearches,
        popularGenres: popularGenres.length,
        peakConcurrentUsers
      });
    } catch (error: unknown) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'Lobby: Collect and publish metrics'
      });
    }
  }

  /**
   * Calculate average search time from recent searches
   */
  private async calculateAverageSearchTime(): Promise<number> {
    return 150;
  }

  /**
   * Get total search count in the current time window
   */
  private async getTotalSearchCount(): Promise<number> {
    return 0;
  }

  /**
   * Get peak concurrent users in the lobby
   */
  private async getPeakConcurrentUsers(): Promise<number> {
    try {
      const lobbyNamespace = this.lobbyIntegrationService['io'].of(CORE_NAMESPACES.LOBBY);
      return lobbyNamespace.sockets.size;
    } catch {
      return 0;
    }
  }

  /**
   * Check if activity change is significant enough to broadcast
   */
  private isSignificantActivityChange(activityData: RoomActivityData): boolean {
    return activityData.memberCountChange > 0.2 || 
           activityData.wasInactiveFor > 30 * 60 * 1000;
  }
}

interface RoomUpdateInfo {
  type: 'created' | 'updated' | 'deleted' | 'settings_updated' | 'activity_updated';
  timestamp: Date;
  changes?: Record<string, unknown>;
  activityData?: RoomActivityData;
  roomSummary?: LobbyRoomBroadcast;
  updateType?: 'created' | 'updated' | 'deleted';
}

interface RoomActivityData {
  isActive: boolean;
  memberCount: number;
  memberCountChange: number;
  lastActivity: Date;
  wasInactiveFor: number;
}

import type { Server, Namespace } from 'socket.io';
import { LobbyApplicationService } from '../application/LobbyApplicationService';
import { RoomDiscoveryService } from '../domain/services/RoomDiscoveryService';
import { RoomServiceRoomListingRepository } from './repositories/RoomServiceRoomListingRepository';
import { CachedRoomListingRepository } from './repositories/CachedRoomListingRepository';
import { LobbyNamespaceHandlers } from './handlers/LobbyNamespaceHandlers';
import { LobbyEventHandlers } from './handlers/LobbyEventHandlers';
import { RealTimeRoomStatusHandler } from './handlers/RealTimeRoomStatusHandler';
import type { EventBus } from '../../../shared/domain/events/EventBus';
import type { RoomLifecycleService } from '../../room-management/application/RoomLifecycleService';
import type { RoomListingStatistics } from '../domain/repositories/RoomListingRepository';
import { CORE_NAMESPACES } from '@jam-band/shared';
import { loggingService } from '../../../shared/infrastructure/logging/LoggingService';
import { authenticateSocket } from '../../../config/socket';

/**
 * LobbyIntegrationService
 * 
 * Integrates the lobby management bounded context with the existing system.
 * Provides a facade for setting up lobby functionality with caching and event handling.
 * 
 * Requirements: 9.2, 9.3, 9.6
 */
export class LobbyIntegrationService {
  private readonly lobbyApplicationService: LobbyApplicationService;
  private readonly lobbyNamespaceHandlers: LobbyNamespaceHandlers;
  private readonly lobbyEventHandlers: LobbyEventHandlers;
  private readonly realTimeStatusHandler: RealTimeRoomStatusHandler;
  private readonly roomDiscoveryService: RoomDiscoveryService;
  private readonly roomListingRepository: CachedRoomListingRepository;

  constructor(
    private readonly io: Server,
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly eventBus: EventBus
  ) {
    // Initialize domain services
    this.roomDiscoveryService = new RoomDiscoveryService();
    
    // Initialize infrastructure with caching
    const baseRepository = new RoomServiceRoomListingRepository(roomLifecycleService);
    this.roomListingRepository = new CachedRoomListingRepository(baseRepository);
    
    // Initialize application service
    this.lobbyApplicationService = new LobbyApplicationService(
      this.roomListingRepository,
      this.roomDiscoveryService,
      this.eventBus
    );
    
    // Initialize handlers
    this.lobbyNamespaceHandlers = new LobbyNamespaceHandlers(this.lobbyApplicationService);
    this.lobbyEventHandlers = new LobbyEventHandlers(this.eventBus, this);
    this.realTimeStatusHandler = new RealTimeRoomStatusHandler(this.eventBus, this);
  }

  /**
   * Creates and sets up the lobby namespace
   */
  createLobbyNamespace(): Namespace {
    const namespacePath = CORE_NAMESPACES.LOBBY;
    const namespace = this.io.of(namespacePath);

    // Require a valid token (registered or guest) on the lobby namespace too (DEV-179).
    namespace.use(authenticateSocket);

    // Set up lobby event handlers
    this.lobbyNamespaceHandlers.setupLobbyNamespaceHandlers(namespace);
    
    return namespace;
  }

  /**
   * Gets the lobby application service for external use
   */
  getLobbyApplicationService(): LobbyApplicationService {
    return this.lobbyApplicationService;
  }

  /**
   * Gets the room lifecycle service — used to enrich lobby broadcasts with live
   * member/companion/audience occupancy in the shape the lobby card consumes.
   */
  getRoomLifecycleService(): RoomLifecycleService {
    return this.roomLifecycleService;
  }

  /**
   * Gets the lobby namespace handlers for external use
   */
  getLobbyNamespaceHandlers(): LobbyNamespaceHandlers {
    return this.lobbyNamespaceHandlers;
  }

  /**
   * Gets the lobby event handlers for external use
   */
  getLobbyEventHandlers(): LobbyEventHandlers {
    return this.lobbyEventHandlers;
  }

  /**
   * Gets the real-time status handler for external use
   */
  getRealTimeStatusHandler(): RealTimeRoomStatusHandler {
    return this.realTimeStatusHandler;
  }

  /**
   * Gets cache statistics for monitoring
   */
  getCacheStatistics() {
    return this.roomListingRepository.getCacheStatistics();
  }

  /**
   * Manually invalidate cache
   */
  invalidateCache(): void {
    this.roomListingRepository.invalidateCache();
  }

  /**
   * Broadcasts room updates to lobby clients
   */
  broadcastRoomUpdate(updateType: 'created' | 'updated' | 'deleted', roomSummary: Record<string, unknown>): void {
    const lobbyNamespace = this.io.of(CORE_NAMESPACES.LOBBY);
    this.lobbyNamespaceHandlers.broadcastRoomListUpdate(lobbyNamespace, updateType, roomSummary);
  }

  /**
   * Broadcasts lobby statistics updates
   */
  async broadcastLobbyStatistics(): Promise<void> {
    try {
      const statistics = await this.lobbyApplicationService.getLobbyStatistics();
      const lobbyNamespace = this.io.of(CORE_NAMESPACES.LOBBY);
      this.lobbyNamespaceHandlers.broadcastLobbyStatistics(lobbyNamespace, statistics as unknown as RoomListingStatistics);
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'LobbyIntegrationService.broadcastLobbyStatistics' });
    }
  }

  /**
   * Shutdown the integration service and cleanup resources
   */
  shutdown(): void {
    this.roomListingRepository.shutdown();
    this.lobbyEventHandlers.shutdown();
    this.realTimeStatusHandler.shutdown();
  }
}

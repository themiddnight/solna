import type { Server, Namespace, Socket } from 'socket.io';
import { loggingService } from "../logging/LoggingService";
import { getCoreNamespaces, CORE_NAMESPACES } from '@jam-band/shared';
import type { NamespaceEventHandlers } from '../handlers/NamespaceEventHandlers';

export interface NamespaceInfo {
  namespace: Namespace;
  createdAt: Date;
  lastActivity: Date;
  connectionCount: number;
}

/* eslint-disable @typescript-eslint/member-ordering */
export class NamespaceManager {
  private readonly namespaces = new Map<string, NamespaceInfo>();
  private readonly cleanupInterval: NodeJS.Timeout;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly NAMESPACE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity
  private eventHandlers: NamespaceEventHandlers | null = null;

  constructor(private readonly io: Server) {
    // Start periodic cleanup of inactive namespaces
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveNamespaces();
    }, this.CLEANUP_INTERVAL_MS);

    loggingService.logInfo('NamespaceManager initialized', {
      cleanupInterval: this.CLEANUP_INTERVAL_MS,
      namespaceTimeout: this.NAMESPACE_TIMEOUT_MS
    });
  }

  /**
   * Set the event handlers for namespace-specific events
   */
  setEventHandlers(eventHandlers: NamespaceEventHandlers): void {
    this.eventHandlers = eventHandlers;
  }

  /**
   * Create a room namespace for full room functionality
   * Requirements: 4.1, 4.2
   */
  createRoomNamespace(roomId: string): Namespace {
    const namespacePath = `/room/${roomId}`;
    const existingInfo = this.namespaces.get(namespacePath);

    if (existingInfo) {
      // Update activity timestamp and return existing namespace
      existingInfo.lastActivity = new Date();
      loggingService.logInfo('Reusing existing room namespace', { roomId, namespacePath });
      return existingInfo.namespace;
    }

    // Create new namespace
    const namespace = this.io.of(namespacePath);
    const namespaceInfo: NamespaceInfo = {
      namespace,
      createdAt: new Date(),
      lastActivity: new Date(),
      connectionCount: 0
    };

    this.namespaces.set(namespacePath, namespaceInfo);

    // Set up namespace-specific event handlers
    this.setupNamespaceEventHandlers(namespace, namespacePath);

    // Set up room-specific event handlers
    if (this.eventHandlers) {
      this.eventHandlers.setupRoomNamespaceHandlers(namespace, roomId);
    }

    loggingService.logInfo('Created room namespace', { roomId, namespacePath });
    return namespace;
  }

  /**
   * Create an approval namespace for private room join approval
   * Requirements: 4.1, 4.2
   */
  createApprovalNamespace(roomId: string): Namespace {
    const namespacePath = `/approval/${roomId}`;
    const existingInfo = this.namespaces.get(namespacePath);

    if (existingInfo) {
      // Update activity timestamp and return existing namespace
      existingInfo.lastActivity = new Date();
      loggingService.logInfo('Reusing existing approval namespace', { roomId, namespacePath });
      return existingInfo.namespace;
    }

    // Create new namespace
    const namespace = this.io.of(namespacePath);
    const namespaceInfo: NamespaceInfo = {
      namespace,
      createdAt: new Date(),
      lastActivity: new Date(),
      connectionCount: 0
    };

    this.namespaces.set(namespacePath, namespaceInfo);

    // Set up namespace-specific event handlers
    this.setupNamespaceEventHandlers(namespace, namespacePath);

    // Set up approval-specific event handlers
    if (this.eventHandlers) {
      this.eventHandlers.setupApprovalNamespaceHandlers(namespace, roomId);
    }

    loggingService.logInfo('Created approval namespace', { roomId, namespacePath });
    return namespace;
  }

  /**
   * Create a lobby monitor namespace for latency monitoring
   * Requirements: 4.1, 4.2
   */
  createLobbyMonitorNamespace(): Namespace {
    const namespacePath = CORE_NAMESPACES.LOBBY_MONITOR;
    const existingInfo = this.namespaces.get(namespacePath);

    if (existingInfo) {
      // Update activity timestamp and return existing namespace
      existingInfo.lastActivity = new Date();
      loggingService.logInfo('Reusing existing lobby monitor namespace', { namespacePath });
      return existingInfo.namespace;
    }

    // Create new namespace
    const namespace = this.io.of(namespacePath);
    const namespaceInfo: NamespaceInfo = {
      namespace,
      createdAt: new Date(),
      lastActivity: new Date(),
      connectionCount: 0
    };

    this.namespaces.set(namespacePath, namespaceInfo);

    // Set up namespace-specific event handlers
    this.setupNamespaceEventHandlers(namespace, namespacePath);

    // Set up lobby monitor-specific event handlers
    if (this.eventHandlers) {
      this.eventHandlers.setupLobbyMonitorNamespaceHandlers(namespace);
    }

    loggingService.logInfo('Created lobby monitor namespace', { namespacePath });
    return namespace;
  }

  /**
   * Get an existing namespace by path
   */
  getNamespace(namespacePath: string): Namespace | undefined {
    const namespaceInfo = this.namespaces.get(namespacePath);
    if (namespaceInfo) {
      namespaceInfo.lastActivity = new Date();
      return namespaceInfo.namespace;
    }
    return undefined;
  }

  /**
   * Get room namespace by room ID
   */
  getRoomNamespace(roomId: string): Namespace | undefined {
    return this.getNamespace(`/room/${roomId}`);
  }

  /**
   * Get approval namespace by room ID
   */
  getApprovalNamespace(roomId: string): Namespace | undefined {
    return this.getNamespace(`/approval/${roomId}`);
  }

  /**
   * Get lobby monitor namespace
   */
  getLobbyMonitorNamespace(): Namespace | undefined {
    return this.getNamespace(CORE_NAMESPACES.LOBBY_MONITOR);
  }

  /**
   * Ensure room namespace exists, creating it if necessary
   * This is useful for on-demand namespace creation
   */
  ensureRoomNamespaceExists(roomId: string): Namespace {
    const existing = this.getRoomNamespace(roomId);
    if (existing) {
      return existing;
    }
    return this.createRoomNamespace(roomId);
  }

  /**
   * Ensure approval namespace exists, creating it if necessary
   * This is useful for on-demand namespace creation
   */
  ensureApprovalNamespaceExists(roomId: string): Namespace {
    const existing = this.getApprovalNamespace(roomId);
    if (existing) {
      return existing;
    }
    return this.createApprovalNamespace(roomId);
  }

  /**
   * Clean up a specific namespace
   * Requirements: 4.6
   */
  cleanupNamespace(namespacePath: string): boolean {
    const namespaceInfo = this.namespaces.get(namespacePath);
    if (!namespaceInfo) {
      return false;
    }

    const { namespace } = namespaceInfo;

    // Disconnect all sockets in the namespace
    namespace.disconnectSockets(true);

    // Remove all event listeners
    namespace.removeAllListeners();

    // Remove from our tracking
    this.namespaces.delete(namespacePath);

    loggingService.logInfo('Cleaned up namespace', {
      namespacePath,
      connectionCount: namespaceInfo.connectionCount,
      age: Date.now() - namespaceInfo.createdAt.getTime()
    });

    return true;
  }

  /**
   * Clean up room namespace by room ID
   * Requirements: 4.6
   */
  cleanupRoomNamespace(roomId: string): boolean {
    return this.cleanupNamespace(`/room/${roomId}`);
  }

  /**
   * Clean up approval namespace by room ID
   * Requirements: 4.6
   */
  cleanupApprovalNamespace(roomId: string): boolean {
    return this.cleanupNamespace(`/approval/${roomId}`);
  }

  /**
   * Set up common event handlers for all namespaces
   * Requirements: 4.2
   */
  private setupNamespaceEventHandlers(namespace: Namespace, namespacePath: string): void {
    namespace.on('connection', (socket: Socket) => {
      const namespaceInfo = this.namespaces.get(namespacePath);
      if (namespaceInfo) {
        namespaceInfo.connectionCount++;
        namespaceInfo.lastActivity = new Date();
      }

      loggingService.logInfo('Socket connected to namespace', {
        socketId: socket.id,
        namespacePath,
        connectionCount: namespaceInfo?.connectionCount ?? 0
      });

      socket.on('disconnect', (reason) => {
        const namespaceInfo = this.namespaces.get(namespacePath);
        if (namespaceInfo) {
          namespaceInfo.connectionCount = Math.max(0, namespaceInfo.connectionCount - 1);
          namespaceInfo.lastActivity = new Date();
        }

        loggingService.logInfo('Socket disconnected from namespace', {
          socketId: socket.id,
          namespacePath,
          reason,
          connectionCount: namespaceInfo?.connectionCount ?? 0
        });
      });

      // Update activity on any event
      socket.onAny(() => {
        const namespaceInfo = this.namespaces.get(namespacePath);
        if (namespaceInfo) {
          namespaceInfo.lastActivity = new Date();
        }
      });
    });
  }

  /**
   * Clean up inactive namespaces to prevent memory leaks
   * Requirements: 4.6
   */
  private cleanupInactiveNamespaces(): void {
    const now = Date.now();
    const namespacesToCleanup: string[] = [];

    for (const [namespacePath, namespaceInfo] of this.namespaces.entries()) {
      const timeSinceLastActivity = now - namespaceInfo.lastActivity.getTime();

      // Skip core namespaces from automatic cleanup
      if (getCoreNamespaces().includes(namespacePath)) {
        continue;
      }

      // Clean up if inactive for too long and has no connections
      if (timeSinceLastActivity > this.NAMESPACE_TIMEOUT_MS && namespaceInfo.connectionCount === 0) {
        namespacesToCleanup.push(namespacePath);
      }
    }

    if (namespacesToCleanup.length > 0) {
      loggingService.logInfo('Cleaning up inactive namespaces', {
        count: namespacesToCleanup.length,
        namespaces: namespacesToCleanup
      });

      namespacesToCleanup.forEach(namespacePath => {
        this.cleanupNamespace(namespacePath);
      });
    }
  }

  /**
   * Get statistics about all managed namespaces
   */
  getNamespaceStats(): {
    totalNamespaces: number;
    totalConnections: number;
    namespaceDetails: Array<{
      path: string;
      connectionCount: number;
      createdAt: Date;
      lastActivity: Date;
      age: number;
    }>;
  } {
    const namespaceDetails = Array.from(this.namespaces.entries()).map(([path, info]) => ({
      path,
      connectionCount: info.connectionCount,
      createdAt: info.createdAt,
      lastActivity: info.lastActivity,
      age: Date.now() - info.createdAt.getTime()
    }));

    return {
      totalNamespaces: this.namespaces.size,
      totalConnections: namespaceDetails.reduce((sum, ns) => sum + ns.connectionCount, 0),
      namespaceDetails
    };
  }

  /**
   * Check if a namespace exists
   */
  hasNamespace(namespacePath: string): boolean {
    return this.namespaces.has(namespacePath);
  }

  /**
   * Get all active namespace paths
   */
  getActiveNamespaces(): string[] {
    return Array.from(this.namespaces.keys());
  }

  /**
   * Shutdown the namespace manager and clean up all resources
   */
  shutdown(): void {
    // Clear cleanup interval
    clearInterval(this.cleanupInterval);

    // Clean up all namespaces
    const namespacePaths = Array.from(this.namespaces.keys());
    namespacePaths.forEach(path => {
      this.cleanupNamespace(path);
    });

    loggingService.logInfo('NamespaceManager shutdown complete', {
      cleanedUpNamespaces: namespacePaths.length
    });
  }
}
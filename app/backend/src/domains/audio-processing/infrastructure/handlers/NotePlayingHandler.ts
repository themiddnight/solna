import type { Socket, Namespace } from 'socket.io';
import type { Server } from 'socket.io';

import type { RoomLifecycleService } from '../../../room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '../../../room-management/application/RoomMembershipService';
import type { NamespaceManager } from "../../../../shared/infrastructure/namespace/NamespaceManager";
import type { RoomSessionManager } from '../../../room-management/infrastructure/services/RoomSessionManager';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { PERFORM_EVENTS, ROOM_STATE_EVENTS } from '@jam-band/shared';

import type {
  PlayNoteData,
} from '../../../../types';

interface QueuedMessage {
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface ExtendedSocketData extends Record<string, unknown> {
  currentInstrument?: string | undefined;
  currentCategory?: string | undefined;
}

export class NotePlayingHandler {
  private readonly messageQueue = new Map<string, QueuedMessage[]>();
  private readonly batchTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly senderSocket = new Map<string, Socket>(); // Track sender socket for TR-3
  private readonly BATCH_INTERVAL = 16; // ~60fps
  private readonly MAX_QUEUE_SIZE = 50;

  constructor(
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly roomMembershipService: RoomMembershipService,
    private readonly io: Server,
    private readonly namespaceManager: NamespaceManager,
    private readonly roomSessionManager: RoomSessionManager
  ) { }

  /**
   * Handle play note through namespace - Requirements: 7.1, 7.2
   */
  async handlePlayNoteNamespace(socket: Socket, data: PlayNoteData, _namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return;
    }

    // Guard: Only room_owner and band_member can play and broadcast notes (prevents audience or unverified sessions)
    if (session.role !== 'room_owner' && session.role !== 'band_member') {
      return;
    }

    const username = session.username || 'Guest';

    // Broadcast first — ephemeral, must not wait on Redis (Zero-I/O in-memory lookup)
    socket.broadcast.emit(PERFORM_EVENTS.NOTE_PLAYED, {
      userId: session.userId,
      username: username,
      notes: data.notes,
      velocity: data.velocity,
      instrument: data.instrument,
      category: data.category,
      eventType: data.eventType,
      isKeyHeld: data.isKeyHeld,
      sampleNotes: data.sampleNotes
    });

    // Socket-level instrument cache (DEV-123):
    // Skip Redis GET+SET when the user is still playing the same instrument.
    // updateUserInstrument() does Redis GET+SET every call — at 20 notes/sec this causes
    // 40 Redis ops/sec per user and triggers event loop lag warnings that disconnect clients.
    // Only write to Redis when the instrument actually changes (cold-start or real switch).
    const socketData = (socket.data ?? {}) as ExtendedSocketData;
    const cachedInstrument = socketData.currentInstrument;
    const cachedCategory = socketData.currentCategory;

    if (cachedInstrument !== data.instrument || cachedCategory !== data.category) {
      socketData.currentInstrument = data.instrument;
      socketData.currentCategory = data.category;

      this.roomMembershipService.updateUserInstrument(session.roomId, session.userId, data.instrument, data.category)
        .catch((err: unknown) => {
          // Reset cache so the next note retries Redis.
          // Without this, a Redis failure would permanently prevent future retries
          // because cachedInstrument === data.instrument would stay true.
          socketData.currentInstrument = undefined;
          socketData.currentCategory = undefined;
          loggingService.logError(err instanceof Error ? err : new Error(String(err)), {
            context: 'NotePlayingHandler.updateUserInstrument',
            userId: session.userId,
            instrument: data.instrument,
          });
        });
    }
  }

  /**
   * Handle stop all notes through namespace
   * Requirements: 7.1, 7.2
   */
  async handleStopAllNotesNamespace(socket: Socket, data: { instrument: string; category: string }, _namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    // OPTIMIZATION: Send immediately
    this.optimizedEmit(socket, session.roomId, PERFORM_EVENTS.STOP_ALL_NOTES, {
      userId: session.userId,
      username: '', // Client likely knows username
      instrument: data.instrument,
      category: data.category
    }, true);
  }

  /**
   * Clean up all in-memory state for a room when it is closed or destroyed.
   * Call this from the room lifecycle hook to prevent unbounded map growth.
   */
  cleanupRoom(roomId: string): void {
    const timeout = this.batchTimeouts.get(roomId);
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    this.batchTimeouts.delete(roomId);
    this.messageQueue.delete(roomId);
    this.senderSocket.delete(roomId);
  }

  // Batch message processing for better performance using namespace isolation
  private processBatch(roomId: string): void {
    const queue = this.messageQueue.get(roomId);
    if (!queue || queue.length === 0) return;

    // Get the room namespace for proper isolation
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (!roomNamespace) {
      loggingService.logWarn('Room namespace not found for batch processing', { roomId });
      return;
    }

    const messages = [...queue];
    this.messageQueue.set(roomId, []);

    // Group messages by event type and user.
    // DEV-179: this userId is the server-assigned identity baked into the payload by the
    // emitting handler (always session.userId — see handleStopAllNotesNamespace), never a
    // client-supplied field. PlayNoteData carries no userId, so nothing here is spoofable.
    const groupedMessages = messages.reduce((acc, msg) => {
      const userId = (msg.data.userId as string | undefined) || 'system';
      const key = `${msg.event}-${userId}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key]!.push(msg.data);
      return acc;
    }, {} as Record<string, Record<string, unknown>[]>);

    // Get sender socket for this room to exclude from broadcast.
    // May be null if the room was cleaned up between queue time and fire time.
    const senderSocket = this.senderSocket.get(roomId);
    if (!senderSocket) {
      this.batchTimeouts.delete(roomId);
      return;
    }

    // Process each group, sending only the latest message per group through namespace.
    // TR-3: exclude sender for mutation events (senderSocket is guaranteed non-null here).
    Object.entries(groupedMessages).forEach(([key, dataArray]) => {
      const latestData = dataArray[dataArray.length - 1];
      const [event] = key.split('-');
      if (event) {
        senderSocket.to(roomId).emit(event, latestData);
      }
    });

    this.batchTimeouts.delete(roomId);
    this.senderSocket.delete(roomId);
  }

  // Queue message for batched processing
  private queueMessage(roomId: string, event: string, data: Record<string, unknown>, socket?: Socket): void {
    if (!this.messageQueue.has(roomId)) {
      this.messageQueue.set(roomId, []);
    }

    // Store sender socket for TR-3 compliance
    if (socket && !this.senderSocket.has(roomId)) {
      this.senderSocket.set(roomId, socket);
    }

    const queue = this.messageQueue.get(roomId)!;
    queue.push({ event, data, timestamp: Date.now() });

    // Limit queue size to prevent memory leaks
    if (queue.length > this.MAX_QUEUE_SIZE) {
      this.messageQueue.set(roomId, queue.slice(-this.MAX_QUEUE_SIZE / 2));
    }

    // Schedule batch processing if not already scheduled
    if (!this.batchTimeouts.has(roomId)) {
      const timeout = setTimeout(() => this.processBatch(roomId), this.BATCH_INTERVAL);
      this.batchTimeouts.set(roomId, timeout);
    }
  }

  /**
   * Optimized emit function that categorizes events as either "critical" (immediate)
   * or "batched" (queued) based on timing sensitivity and broadcast requirements.
   *
   * CRITICAL EVENTS (immediate broadcast via socket.to()):
   * - 'note_played': User played a note — must reach others in real-time for tight sync
   * - 'user_joined': User entered the room — timing-critical for UI consistency
   * - 'user_left': User left the room — timing-critical for member list updates
   * - 'synth_params_changed': Synth parameter mutations — timing-critical for live parameter sync
   * - Any event with immediate=true flag (caller override)
   *
   * WHY critical events use socket.to(roomNamespace):
   * Implements TR-3 (Broadcasting semantics):
   * - socket.to() excludes the sender (they already have the state)
   * - Immediate delivery ensures tight latency for interactive feedback
   * - Mutation events must exclude sender to prevent double-applying changes
   *
   * BATCHED EVENTS (queued for ~60fps batching via namespace.emit()):
   * - All other events: UI updates, status changes, non-timing-sensitive mutations
   * - Events that are superseded quickly (e.g., knob/slider drag events)
   *
   * WHY batched events use namespace.emit():
   * Implements TR-1 (Ephemeral/Commit pattern):
   * - High-frequency events are grouped and sent once per batch interval
   * - Reduces network overhead and WebSocket message count
   * - namespace.emit() sends to all users including sender (for eventual consistency)
   * - Batched events don't need immediate delivery since they're replaced by newer ones
   *
   * When adding a new event:
   * 1. If it's timing-sensitive (audio, real-time interaction) → add to critical list above
   * 2. If it's high-freq or superseded quickly (UI feedback) → leave for batching
   * 3. When in doubt, start with critical; move to batched only if performance testing shows benefit
   */
  private optimizedEmit(socket: Socket, roomId: string, event: string, data: Record<string, unknown>, immediate: boolean = false): void {
    const roomNamespace = this.getOrCreateRoomNamespace(roomId);
    if (!roomNamespace) {
      loggingService.logWarn('Room namespace not found for room', { roomId });
      return;
    }

    if (immediate || event === PERFORM_EVENTS.NOTE_PLAYED || event === ROOM_STATE_EVENTS.USER_JOINED || event === ROOM_STATE_EVENTS.USER_LEFT || event === PERFORM_EVENTS.SYNTH_PARAMS_CHANGED) {
      // Critical events go out immediately, excluding the sender (TR-3). Room key is the
      // plain roomId that sockets join — `roomNamespace.name` targets an empty room.
      socket.to(roomId).emit(event, data);
    } else {
      // Other events are batched for better performance
      this.queueMessage(roomId, event, data, socket);
    }
  }

  /**
   * Helper method to get or create room namespace
   * This ensures the namespace exists before we try to use it
   */
  private getOrCreateRoomNamespace(roomId: string): Namespace | null {
    let roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (!roomNamespace) {
      // Create the room namespace if it doesn't exist
      try {
        roomNamespace = this.namespaceManager.createRoomNamespace(roomId);
      } catch (error) {
        loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'NotePlayingHandler.createRoomNamespace', roomId });
        return null;
      }
    }
    return roomNamespace;
  }
}

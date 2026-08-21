/* eslint-disable @typescript-eslint/member-ordering */
import type { Server, Namespace } from 'socket.io';
import type { RoomRepository } from '../repositories/RoomRepository';
import type { MetronomeAnchor } from '../../../../types';
import { getHighResolutionTime, METRONOME_CONSTANTS, METRONOME_EVENTS, quarterNoteMs } from '@jam-band/shared';
import { CompanionScheduler } from '@/domains/perform-room/application/CompanionScheduler';
import { performRoomStateService } from '@/domains/perform-room/application/PerformRoomStateService';
import { companionRuntimeRegistry } from '@/domains/perform-room/application/CompanionRuntimeRegistry';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';

/**
 * Room-specific metronome instance for namespace-isolated broadcasting
 * Requirements: 8.1, 8.2, 8.3
 */
export class RoomMetronome {
  private timeoutId: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Self-correcting timer state
  private expectedNextTickTime: number = 0;
  private tickCount: number = 0;
  private startTime: number = 0;

  // Wall-clock time of the most recent companion beat, so note times stay strictly
  // increasing when a tempo change re-anchors the grid mid-flight.
  private lastCompanionBeatTime: number = 0;

  // Wall-clock time this tick fired — in-memory only, never written to Redis
  // (a save per beat would be expensive). Used to locate the current beat on the
  // room grid; nothing client-facing derives its phase from it.
  private lastActualTickTime: number = 0;

  // Drift monitoring
  private maxDriftMs: number = 0;
  private totalDriftMs: number = 0;
  private driftSamples: number = 0;

  // Consecutive getRoom failure counter — metronome only stops after MAX_ROOM_MISS_TICKS
  // consecutive misses, preventing a transient Redis/cache hiccup from permanently halting playback.
  private consecutiveRoomMisses: number = 0;
  private static readonly MAX_ROOM_MISS_TICKS = 5;
  private lastKnownIntervalMs: number = quarterNoteMs(METRONOME_CONSTANTS.DEFAULT_BPM);

  constructor(
    private readonly roomId: string,
    private readonly namespace: Namespace,
    private readonly roomRepository: RoomRepository
  ) {}

  /**
   * Start the metronome for this specific room using self-correcting timer
   * This approach eliminates drift by calculating next tick time from the expected time
   * rather than the actual time, compensating for any delays in the event loop.
   * Requirements: 8.1, 8.2
   */
  start(): void {
    this.stop(); // Clear any existing timer

    // Initialize timing state first
    this.startTime = getHighResolutionTime();
    this.expectedNextTickTime = this.startTime;
    this.tickCount = 0;
    this.maxDriftMs = 0;
    this.totalDriftMs = 0;
    this.driftSamples = 0;
    this.consecutiveRoomMisses = 0;
    this.lastKnownIntervalMs = quarterNoteMs(METRONOME_CONSTANTS.DEFAULT_BPM);
    this.lastCompanionBeatTime = 0;
    this.isRunning = true;

    const tick = async () => {
      if (!this.isRunning) return;

      // Stamped before the store read: this is when the tick fired, and letting a
      // slow read push it later would hand that latency to whatever times itself
      // from this beat.
      this.lastActualTickTime = Date.now();

      const currentRoom = await this.roomRepository.getRoom(this.roomId);
      const currentState = currentRoom?.metronome;

      if (!currentState) {
        this.consecutiveRoomMisses++;
        loggingService.logInfo(
          `[MetronomeService] getRoom returned undefined for room ${this.roomId} ` +
          `(miss ${this.consecutiveRoomMisses}/${RoomMetronome.MAX_ROOM_MISS_TICKS})`
        );
        if (this.consecutiveRoomMisses >= RoomMetronome.MAX_ROOM_MISS_TICKS) {
          loggingService.logError(
            new Error(`Stopping metronome for room ${this.roomId} after ${this.consecutiveRoomMisses} consecutive getRoom failures`),
            { context: 'MetronomeService', roomId: this.roomId }
          );
          this.stop();
          return;
        }
        // Schedule next tick using last known BPM interval so beat clock stays aligned
        const fallbackIntervalMs = this.lastKnownIntervalMs;
        this.expectedNextTickTime += Math.max(fallbackIntervalMs, quarterNoteMs(METRONOME_CONSTANTS.MIN_BPM)) * 1_000_000;
        const nextTickDelayNs = this.expectedNextTickTime - getHighResolutionTime();
        this.timeoutId = setTimeout(tick, Math.max(0, nextTickDelayNs / 1_000_000));
        return;
      }

      this.consecutiveRoomMisses = 0;

      const now = getHighResolutionTime();
      const currentIntervalMs = quarterNoteMs(currentState.bpm);
      this.lastKnownIntervalMs = currentIntervalMs;
      
      // Calculate drift for monitoring
      const expectedTimeMs = (this.expectedNextTickTime - this.startTime) / 1_000_000;
      const actualTimeMs = (now - this.startTime) / 1_000_000;
      const driftMs = Math.abs(actualTimeMs - expectedTimeMs);
      
      // Update drift statistics
      this.maxDriftMs = Math.max(this.maxDriftMs, driftMs);
      this.totalDriftMs += driftMs;
      this.driftSamples++;

      // Trigger Companion Scheduler for Perform Room companions
      if (currentRoom.roomType === 'perform') {
        let companionSnapshot = companionRuntimeRegistry.get(this.roomId);

        if (!companionSnapshot) {
          const performState = await performRoomStateService.getState(this.roomId);
          if (performState) {
            companionSnapshot = companionRuntimeRegistry.upsertFromPerformState(this.roomId, performState, {
              bpm: currentState.bpm,
              ...(currentRoom.roomScale && { roomScale: currentRoom.roomScale }),
            });
          }
        }

        if (companionSnapshot?.companions.some((companion) => companion.isPlaying)) {
          const companionClock = {
            bpm: currentState.bpm,
            ...(currentRoom.roomScale && { roomScale: currentRoom.roomScale }),
          };
          const targetBeat = this.tickCount + 1;
          // Time the beat on the room's grid rather than on this tick's stamp, so
          // companion notes sit exactly where the metronome clicks do instead of
          // inheriting the tick's jitter. Rounding to the nearest grid beat keeps
          // the mapping stable for jitter up to half a beat; the guard below keeps
          // note times increasing even when a tempo change moves the grid.
          const gridBeat = Math.round(
            (this.lastActualTickTime - currentState.beatZeroAt) / currentIntervalMs
          ) + 1;
          const targetBeatServerTime = Math.max(
            currentState.beatZeroAt + gridBeat * currentIntervalMs,
            this.lastCompanionBeatTime + 1
          );
          this.lastCompanionBeatTime = targetBeatServerTime;
          CompanionScheduler.processTick(
            companionSnapshot,
            targetBeat,
            this.namespace,
            targetBeatServerTime,
            companionClock
          ).catch(err => {
            loggingService.logError(err as Error, {
              context: 'CompanionScheduler.processTick',
              roomId: this.roomId,
            });
          });
        }
      }

      this.tickCount++;
      
      // Calculate next expected tick time based on ideal timing, not actual
      // This is the key to self-correction - we always schedule from the expected time
      this.expectedNextTickTime += currentIntervalMs * 1_000_000; // Convert to nanoseconds
      
      // Calculate delay until next tick
      // If we're behind, this will be shorter; if we're ahead, this will be longer
      const nextTickDelayNs = this.expectedNextTickTime - getHighResolutionTime();
      const nextTickDelayMs = Math.max(0, nextTickDelayNs / 1_000_000);
      
      // Schedule next tick
      this.timeoutId = setTimeout(tick, nextTickDelayMs);
    };

    // Send initial tick immediately
    void tick();
  }

  /**
   * Stop the metronome for this room
   * Requirements: 8.3
   */
  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.isRunning = false;
  }

  /**
   * Check if metronome is currently running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get room ID for this metronome instance
   */
  getRoomId(): string {
    return this.roomId;
  }

  /**
   * Get drift statistics for monitoring
   */
  getDriftStats(): { maxDriftMs: number; avgDriftMs: number; tickCount: number } {
    return {
      maxDriftMs: this.maxDriftMs,
      avgDriftMs: this.driftSamples > 0 ? this.totalDriftMs / this.driftSamples : 0,
      tickCount: this.tickCount
    };
  }

  /**
   * Broadcast anchor to synchronize client metronomes
   * Used when room starts or BPM changes
   */
  broadcastAnchor(namespace: Namespace, anchor: MetronomeAnchor): void {
    namespace.emit(METRONOME_EVENTS.METRONOME_ANCHOR, anchor);
  }

  /**
   * Handle BPM change with a beat-quantized transition.
   *
   * The room's grid lives in `room.metronome.beatZeroAt`; the change takes
   * effect on the next beat of that grid, and that same instant becomes beat 0
   * of the new tempo. Anchoring on the stored grid rather than on the last
   * server tick keeps the transition free of tick jitter, and persisting the
   * result is what lets a joiner be answered with the grid the room is actually
   * playing (MetronomeHandler.handleRequestMetronomeStateNamespace).
   */
  async handleBpmChange(newBpm: number, namespace: Namespace): Promise<void> {
    const currentRoom = await this.roomRepository.getRoom(this.roomId);
    if (!currentRoom) return;

    const { bpm: oldBpm, beatZeroAt } = currentRoom.metronome;
    const now = Date.now();
    const oldBeatMs = quarterNoteMs(oldBpm);

    // Next beat boundary of the current grid. The +0.1 beat margin keeps the
    // transition far enough ahead that clients can still schedule it.
    const beatsElapsed = (now - beatZeroAt) / oldBeatMs;
    const effectiveAt = beatZeroAt + Math.ceil(beatsElapsed + 0.1) * oldBeatMs;

    const clampedBpm = Math.max(
      METRONOME_CONSTANTS.MIN_BPM,
      Math.min(METRONOME_CONSTANTS.MAX_BPM, newBpm)
    );

    // Re-anchor: the transition point IS beat 0 of the new tempo. Beat indices
    // therefore restart small on every change instead of growing with the age
    // of the room, and old and new grid meet exactly at `effectiveAt`.
    currentRoom.metronome.bpm = clampedBpm;
    currentRoom.metronome.beatZeroAt = effectiveAt;
    this.lastKnownIntervalMs = quarterNoteMs(clampedBpm);
    companionRuntimeRegistry.update(this.roomId, { bpm: clampedBpm });

    // Persist room state after BPM change
    await this.roomRepository.saveRoom(currentRoom);

    // Broadcast the new grid; `effectiveAt` tells clients when to stop the old one
    const anchor: MetronomeAnchor = {
      bpm: newBpm,
      beatZeroAt: effectiveAt,
      effectiveAt
    };

    this.broadcastAnchor(namespace, anchor);
  }

  /**
   * Clean up resources when room is destroyed
   * Requirements: 8.5
   */
  cleanup(): void {
    this.stop();
  }
}

/**
 * Namespace-aware metronome service that manages per-room metronome instances
 * Requirements: 8.1, 8.2, 8.3, 8.5
 */
export class MetronomeService {
   
  private readonly roomMetronomes = new Map<string, RoomMetronome>();

  constructor(private readonly io: Server, private readonly roomRepository: RoomRepository) {}

  /**
   * Initialize metronome for a room with its namespace
   * Requirements: 8.1, 8.2
   */
  initializeRoomMetronome(roomId: string, namespace: Namespace): void {
    // Clean up any existing metronome for this room
    this.cleanupRoom(roomId);

    // Create new room metronome instance
    const roomMetronome = new RoomMetronome(roomId, namespace, this.roomRepository);
    this.roomMetronomes.set(roomId, roomMetronome);

    // Start the metronome
    roomMetronome.start();
  }

  /**
   * Start metronome for a specific room
   * Requirements: 8.1, 8.2
   */
  startMetronome(roomId: string): void {
    const roomMetronome = this.roomMetronomes.get(roomId);
    if (roomMetronome) {
      roomMetronome.start();
    }
  }

  /**
   * Stop metronome for a specific room
   * Requirements: 8.3
   */
  stopMetronome(roomId: string): void {
    const roomMetronome = this.roomMetronomes.get(roomId);
    if (roomMetronome) {
      roomMetronome.stop();
    }
  }

  /**
   * Handle BPM change with beat-quantized sync.
   *
   * Rooms outlive the process that created them (Redis, 24h TTL) while metronome
   * instances do not, so a room that survived a restart has none — and without
   * the ensure below every BPM change in it was a silent no-op for everyone,
   * with no server ticks to drive its companions either.
   */
  async handleBpmChange(roomId: string, newBpm: number, namespace: Namespace): Promise<void> {
    await this.ensureRoomMetronome(roomId, namespace).handleBpmChange(newBpm, namespace);
  }

  /** Return this room's metronome, starting one if the process has none. */
  ensureRoomMetronome(roomId: string, namespace: Namespace): RoomMetronome {
    const existing = this.roomMetronomes.get(roomId);
    if (existing) return existing;

    this.initializeRoomMetronome(roomId, namespace);
    // initializeRoomMetronome always registers an instance for this roomId
    return this.roomMetronomes.get(roomId)!;
  }

  /**
   * Clean up metronome instance when room becomes empty
   * Requirements: 8.5
   */
  cleanupRoom(roomId: string): void {
    const roomMetronome = this.roomMetronomes.get(roomId);
    if (roomMetronome) {
      roomMetronome.cleanup();
      this.roomMetronomes.delete(roomId);
    }
    companionRuntimeRegistry.clear(roomId);
  }

  /**
   * Get active metronomes for monitoring
   */
  getActiveMetronomes(): string[] {
    return Array.from(this.roomMetronomes.keys()).filter(roomId => {
      const metronome = this.roomMetronomes.get(roomId);
      return metronome?.getIsRunning() || false;
    });
  }

  /**
   * Get room metronome instance for direct access
   */
  getRoomMetronome(roomId: string): RoomMetronome | undefined {
    return this.roomMetronomes.get(roomId);
  }

  /**
   * Get total number of managed metronome instances
   */
  getTotalMetronomes(): number {
    return this.roomMetronomes.size;
  }

  /**
   * Get drift statistics for all active metronomes
   * Useful for monitoring timing stability across multiple rooms
   */
  getAllDriftStats(): Map<string, { maxDriftMs: number; avgDriftMs: number; tickCount: number }> {
    const stats = new Map<string, { maxDriftMs: number; avgDriftMs: number; tickCount: number }>();
    for (const [roomId, metronome] of this.roomMetronomes.entries()) {
      if (metronome.getIsRunning()) {
        stats.set(roomId, metronome.getDriftStats());
      }
    }
    return stats;
  }

  /**
   * Get aggregated drift statistics across all rooms
   * Returns overall system timing health
   */
  getSystemDriftStats(): { 
    totalRooms: number; 
    maxDriftMs: number; 
    avgDriftMs: number;
    roomsWithHighDrift: number; // rooms with >5ms drift
  } {
    let maxDrift = 0;
    let totalDrift = 0;
    let totalSamples = 0;
    let highDriftRooms = 0;
    const HIGH_DRIFT_THRESHOLD_MS = 5;

    for (const metronome of this.roomMetronomes.values()) {
      if (metronome.getIsRunning()) {
        const stats = metronome.getDriftStats();
        maxDrift = Math.max(maxDrift, stats.maxDriftMs);
        totalDrift += stats.avgDriftMs * stats.tickCount;
        totalSamples += stats.tickCount;
        if (stats.maxDriftMs > HIGH_DRIFT_THRESHOLD_MS) {
          highDriftRooms++;
        }
      }
    }

    return {
      totalRooms: this.roomMetronomes.size,
      maxDriftMs: maxDrift,
      avgDriftMs: totalSamples > 0 ? totalDrift / totalSamples : 0,
      roomsWithHighDrift: highDriftRooms
    };
  }

  /**
   * Clean up all metronome instances (for service shutdown)
   * Requirements: 8.5
   */
  shutdown(): void {
  for (const [ _roomId, metronome] of this.roomMetronomes.entries()) {
      metronome.cleanup();
    }
    this.roomMetronomes.clear();
    companionRuntimeRegistry.clearAll();
  }
}

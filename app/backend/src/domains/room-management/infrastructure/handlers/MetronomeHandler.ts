import type { Socket, Namespace } from 'socket.io';
import type { RoomLifecycleService } from '../../application/RoomLifecycleService';
import type { MetronomeService } from '../services/MetronomeService';
import type { RoomSessionManager } from '../services/RoomSessionManager';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { METRONOME_EVENTS } from '@jam-band/shared';
import type { UpdateMetronomeData } from '@jam-band/shared';

/**
 * Handler for metronome functionality
 * Requirements: 4.1, 4.6
 */
export class MetronomeHandler {
  constructor(
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly metronomeService: MetronomeService,
    private readonly roomSessionManager: RoomSessionManager,
  ) { }

  /**
   * Handle metronome BPM update through namespace with anchor-based sync
   * Requirements: 4.1, 4.6
   */
  async handleUpdateMetronomeNamespace(socket: Socket, data: UpdateMetronomeData, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = await this.roomLifecycleService.getRoom(session.roomId);
    if (!room) return;

    const user = room.bandMembers.get(session.userId) || room.audiences.get(session.userId);
    if (!user) return;

    // Only room owner and band members can control metronome
    if (user.role !== 'room_owner' && user.role !== 'band_member') return;

    // Broadcast BPM change via anchor with effectiveAt for beat-quantized sync.
    // handleBpmChange() reads oldBpm from Redis, computes the correct beatZeroAt, and
    // saves the updated room — no separate updateMetronomeBPM() call needed (RC-2 fix:
    // the pre-save was corrupting oldBpm before handleBpmChange() could read it).
    try {
      await this.metronomeService.handleBpmChange(session.roomId, data.bpm, namespace);
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error(String(error)), {
        context: 'MetronomeHandler: handleBpmChange failed (namespace)',
        roomId: session.roomId,
      });
      // Do NOT rethrow — don't disconnect socket for a BPM change error
    }
  }

  /**
   * Handle request for current metronome state through namespace.
   *
   * Answers with the grid persisted in room state, so a joiner starts its
   * scheduler on exactly the grid the room is already playing. Deriving the
   * answer from the in-memory metronome instead would hand the joiner the
   * wall-clock time of a jittered server tick — and nothing at all after a
   * server restart, when no instance exists for a room that outlived it.
   * Requirements: 4.1, 4.6
   */
  async handleRequestMetronomeStateNamespace(socket: Socket, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    // Someone is in the room, so it needs a tick loop: rooms outlive the process
    // that created them, and only room creation starts one. Without this, a room
    // that survived a restart never ticks again and its companions stay silent.
    this.metronomeService.ensureRoomMetronome(session.roomId, namespace);

    const metronomeState = await this.roomLifecycleService.getMetronomeState(session.roomId);
    if (!metronomeState) return;

    socket.emit(METRONOME_EVENTS.METRONOME_ANCHOR, {
      bpm: metronomeState.bpm,
      beatZeroAt: metronomeState.beatZeroAt,
    });
  }
}

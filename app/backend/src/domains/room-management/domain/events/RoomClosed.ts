import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';
import type { RoomId } from '../../../../shared/domain/models/ValueObjects';

/**
 * RoomClosed Domain Event
 * 
 * Published when a room is closed (no members left).
 * 
 * Requirements: 5.1, 5.2
 */
export class RoomClosed extends DomainEvent {
  constructor(
    roomId: RoomId,
    public readonly reason: string = 'empty'
  ) {
    super(roomId.toString());
  }
}
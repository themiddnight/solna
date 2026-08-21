import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';
import type { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';

/**
 * RoomCreated Domain Event
 * 
 * Published when a new room is created.
 * 
 * Requirements: 5.1, 5.2
 */
export class RoomCreated extends DomainEvent {
  constructor(
    roomId: RoomId,
    public readonly ownerId: UserId,
    public readonly roomName: string,
    public readonly isPrivate: boolean,
    public readonly isHidden: boolean,
    public readonly roomType: string = 'PERFORM'
  ) {
    super(roomId.toString());
  }
}
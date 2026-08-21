import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';
import type { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';

/**
 * OwnershipTransferred Domain Event
 * 
 * Published when room ownership is transferred from one user to another.
 * 
 * Requirements: 5.1, 5.2
 */
export class OwnershipTransferred extends DomainEvent {
  constructor(
    roomId: RoomId,
    public readonly oldOwnerId: UserId,
    public readonly newOwnerId: UserId,
    public readonly reason: string = 'manual_transfer'
  ) {
    super(roomId.toString());
  }
}
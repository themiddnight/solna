/**
 * Behavioral tests for the room-management domain events — pins aggregateId
 * passthrough, per-event payload fields, constructor defaults, and the shared
 * DomainEvent metadata (occurredOn, eventId) against the real classes.
 */

import { DomainEvent } from '../DomainEvent';
import {
  MemberJoined,
  MemberLeft,
  OwnershipTransferred,
  RoomClosed,
  RoomCreated,
  RoomOccupancyChanged,
  RoomSettingsUpdated,
} from '../RoomEvents';

const EVENT_ID = /^event_[0-9a-f-]{36}$/;

describe('RoomCreated', () => {
  it('carries the room id as aggregateId plus owner, name, and defaults', () => {
    const event = new RoomCreated('room-1', 'user-9', 'Jam Room');
    expect(event.aggregateId).toBe('room-1');
    expect(event.ownerId).toBe('user-9');
    expect(event.roomName).toBe('Jam Room');
    expect(event.isPrivate).toBe(false);
    expect(event.roomType).toBe('PERFORM');
  });

  it('honors explicit isPrivate and roomType values', () => {
    const event = new RoomCreated('room-2', 'user-9', 'Secret', true, 'ARRANGE');
    expect(event.isPrivate).toBe(true);
    expect(event.roomType).toBe('ARRANGE');
  });
});

describe('MemberJoined', () => {
  it('carries the room id as aggregateId plus user, username, and role', () => {
    const event = new MemberJoined('room-1', 'user-5', 'alice', 'band_member');
    expect(event.aggregateId).toBe('room-1');
    expect(event.userId).toBe('user-5');
    expect(event.username).toBe('alice');
    expect(event.role).toBe('band_member');
  });
});

describe('MemberLeft', () => {
  it('carries the room id as aggregateId plus user and username', () => {
    const event = new MemberLeft('room-1', 'user-5', 'alice');
    expect(event.aggregateId).toBe('room-1');
    expect(event.userId).toBe('user-5');
    expect(event.username).toBe('alice');
  });
});

describe('OwnershipTransferred', () => {
  it('carries previous and new owner ids', () => {
    const event = new OwnershipTransferred('room-1', 'user-1', 'user-2');
    expect(event.aggregateId).toBe('room-1');
    expect(event.previousOwnerId).toBe('user-1');
    expect(event.newOwnerId).toBe('user-2');
  });
});

describe('RoomSettingsUpdated', () => {
  it('carries the updater and the full changes record', () => {
    const changes: Record<string, unknown> = { isPrivate: true, maxMembers: 8 };
    const event = new RoomSettingsUpdated('room-1', 'user-3', changes);
    expect(event.aggregateId).toBe('room-1');
    expect(event.updatedBy).toBe('user-3');
    expect(event.changes).toEqual({ isPrivate: true, maxMembers: 8 });
  });
});

describe('RoomClosed', () => {
  it('carries the closer and an optional reason', () => {
    const event = new RoomClosed('room-1', 'user-3', 'owner left');
    expect(event.aggregateId).toBe('room-1');
    expect(event.closedBy).toBe('user-3');
    expect(event.reason).toBe('owner left');
  });

  it('defaults reason to undefined when omitted', () => {
    const event = new RoomClosed('room-1', 'user-3');
    expect(event.reason).toBeUndefined();
  });
});

describe('RoomOccupancyChanged', () => {
  it('carries the room id and a companion_change reason', () => {
    const event = new RoomOccupancyChanged('room-1', 'companion_change');
    expect(event.aggregateId).toBe('room-1');
    expect(event.reason).toBe('companion_change');
  });
});

describe('shared DomainEvent metadata', () => {
  it('every room event is a DomainEvent with occurredOn and a generated eventId', () => {
    const events: DomainEvent[] = [
      new RoomCreated('room-1', 'user-9', 'Jam'),
      new MemberJoined('room-1', 'user-5', 'alice', 'band_member'),
      new MemberLeft('room-1', 'user-5', 'alice'),
      new OwnershipTransferred('room-1', 'user-1', 'user-2'),
      new RoomSettingsUpdated('room-1', 'user-3', {}),
      new RoomClosed('room-1', 'user-3'),
      new RoomOccupancyChanged('room-1', 'companion_change'),
    ];

    for (const event of events) {
      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.occurredOn).toBeInstanceOf(Date);
      expect(event.eventId).toMatch(EVENT_ID);
    }
  });

  it('gives each event instance a distinct eventId', () => {
    const first = new RoomCreated('room-1', 'user-9', 'Jam');
    const second = new RoomCreated('room-1', 'user-9', 'Jam');
    expect(first.eventId).not.toBe(second.eventId);
  });
});

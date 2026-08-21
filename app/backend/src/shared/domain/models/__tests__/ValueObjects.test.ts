/**
 * Behavioral tests for the shared domain ID value objects — pins validation,
 * equality, string coercion, and per-type generation prefixes against the real
 * implementation (no mocks).
 */

import {
  AudioBusId,
  ConnectionId,
  NamespaceId,
  RoomId,
  SessionId,
  UserId,
} from '../ValueObjects';

describe('BaseId behavior (via RoomId)', () => {
  it('rejects an empty value', () => {
    expect(() => new RoomId('')).toThrow('RoomId cannot be empty');
  });

  it('rejects a whitespace-only value', () => {
    expect(() => new RoomId('   ')).toThrow('RoomId cannot be empty');
  });

  it('reports the class name of the concrete subclass in the error', () => {
    expect(() => new UserId('')).toThrow('UserId cannot be empty');
  });

  it('equals only an instance of the same class with the same value', () => {
    const a = new RoomId('room-1');
    expect(a.equals(new RoomId('room-1'))).toBe(true);
    expect(a.equals(new RoomId('room-2'))).toBe(false);
    // Same value, different class — identity includes the class.
    expect(a.equals(new UserId('room-1'))).toBe(false);
  });

  it('coerces to the raw value via toString and valueOf', () => {
    const id = new RoomId('room-1');
    expect(id.toString()).toBe('room-1');
    expect(id.valueOf()).toBe('room-1');
  });
});

describe('RoomId', () => {
  it('generates a value with the room_ prefix', () => {
    const id = RoomId.generate();
    expect(id).toBeInstanceOf(RoomId);
    expect(id.toString()).toMatch(/^room_[0-9a-f-]{36}$/);
  });

  it('generates a fresh value on each call', () => {
    expect(RoomId.generate().toString()).not.toBe(RoomId.generate().toString());
  });

  it('round-trips through fromString', () => {
    const id = RoomId.fromString('room-abc');
    expect(id).toBeInstanceOf(RoomId);
    expect(id.toString()).toBe('room-abc');
    expect(id.equals(new RoomId('room-abc'))).toBe(true);
  });
});

describe('UserId', () => {
  it('generates a value with the user_ prefix', () => {
    const id = UserId.generate();
    expect(id).toBeInstanceOf(UserId);
    expect(id.toString()).toMatch(/^user_[0-9a-f-]{36}$/);
  });

  it('round-trips through fromString', () => {
    expect(UserId.fromString('user-xyz').toString()).toBe('user-xyz');
    expect(UserId.fromString('user-xyz').equals(new UserId('user-xyz'))).toBe(true);
  });
});

describe('AudioBusId', () => {
  it('generates a value with the audiobus_ prefix', () => {
    const id = AudioBusId.generate();
    expect(id).toBeInstanceOf(AudioBusId);
    expect(id.toString()).toMatch(/^audiobus_[0-9a-f-]{36}$/);
  });

  it('round-trips through fromString', () => {
    expect(AudioBusId.fromString('bus-1').toString()).toBe('bus-1');
    expect(AudioBusId.fromString('bus-1').equals(new AudioBusId('bus-1'))).toBe(true);
  });
});

describe('ConnectionId', () => {
  it('generates a value with the conn_ prefix', () => {
    const id = ConnectionId.generate();
    expect(id).toBeInstanceOf(ConnectionId);
    expect(id.toString()).toMatch(/^conn_[0-9a-f-]{36}$/);
  });

  it('round-trips through fromString', () => {
    expect(ConnectionId.fromString('conn-1').toString()).toBe('conn-1');
    expect(ConnectionId.fromString('conn-1').equals(new ConnectionId('conn-1'))).toBe(true);
  });
});

describe('SessionId', () => {
  it('generates a value with the session_ prefix', () => {
    const id = SessionId.generate();
    expect(id).toBeInstanceOf(SessionId);
    expect(id.toString()).toMatch(/^session_[0-9a-f-]{36}$/);
  });

  it('round-trips through fromString', () => {
    expect(SessionId.fromString('session-1').toString()).toBe('session-1');
    expect(SessionId.fromString('session-1').equals(new SessionId('session-1'))).toBe(true);
  });
});

describe('NamespaceId', () => {
  it('generates a value with the ns_ prefix', () => {
    const id = NamespaceId.generate();
    expect(id).toBeInstanceOf(NamespaceId);
    expect(id.toString()).toMatch(/^ns_[0-9a-f-]{36}$/);
  });

  it('round-trips through fromString', () => {
    expect(NamespaceId.fromString('ns-x').toString()).toBe('ns-x');
    expect(NamespaceId.fromString('ns-x').equals(new NamespaceId('ns-x'))).toBe(true);
  });

  it('derives a namespace from a room id', () => {
    const room = new RoomId('room-42');
    const ns = NamespaceId.fromRoomId(room);
    expect(ns).toBeInstanceOf(NamespaceId);
    expect(ns.toString()).toBe('ns_room-42');
  });
});

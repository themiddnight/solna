/**
 * Shared Domain Value Objects
 * 
 * Strongly-typed value objects used across multiple bounded contexts.
 * Provides type safety, validation, and equality methods for core domain concepts.
 * 
 * Requirements: 1.1, 1.3
 */
import { generateId } from '../../utils/id';

// Base ID value object for common functionality
abstract class BaseId {
  constructor(protected readonly value: string) {
    if (value.trim().length === 0) {
      throw new Error(`${this.constructor.name} cannot be empty`);
    }
  }

  equals(other: BaseId): boolean {
    return this.constructor === other.constructor && this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  valueOf(): string {
    return this.value;
  }
}

// Room ID value object
export class RoomId extends BaseId {
  constructor(value: string) {
    super(value);
  }

  static generate(): RoomId {
    return new RoomId(generateId('room'));
  }

  static fromString(value: string): RoomId {
    return new RoomId(value);
  }

  equals(other: RoomId): boolean {
    return super.equals(other);
  }
}

// User ID value object
export class UserId extends BaseId {
  constructor(value: string) {
    super(value);
  }

  static generate(): UserId {
    return new UserId(generateId('user'));
  }

  static fromString(value: string): UserId {
    return new UserId(value);
  }

  equals(other: UserId): boolean {
    return super.equals(other);
  }
}

// Audio Bus ID value object
export class AudioBusId extends BaseId {
  constructor(value: string) {
    super(value);
  }

  static generate(): AudioBusId {
    return new AudioBusId(generateId('audiobus'));
  }

  static fromString(value: string): AudioBusId {
    return new AudioBusId(value);
  }

  equals(other: AudioBusId): boolean {
    return super.equals(other);
  }
}

// Connection ID value object for real-time communication
export class ConnectionId extends BaseId {
  constructor(value: string) {
    super(value);
  }

  static generate(): ConnectionId {
    return new ConnectionId(generateId('conn'));
  }

  static fromString(value: string): ConnectionId {
    return new ConnectionId(value);
  }

  equals(other: ConnectionId): boolean {
    return super.equals(other);
  }
}

// Session ID value object for various session types
export class SessionId extends BaseId {
  constructor(value: string) {
    super(value);
  }

  static generate(): SessionId {
    return new SessionId(generateId('session'));
  }

  static fromString(value: string): SessionId {
    return new SessionId(value);
  }

  equals(other: SessionId): boolean {
    return super.equals(other);
  }
}

// Namespace ID value object for WebSocket namespaces
export class NamespaceId extends BaseId {
  constructor(value: string) {
    super(value);
  }

  static generate(): NamespaceId {
    return new NamespaceId(generateId('ns'));
  }

  static fromString(value: string): NamespaceId {
    return new NamespaceId(value);
  }

  static fromRoomId(roomId: RoomId): NamespaceId {
    return new NamespaceId(`ns_${roomId.toString()}`);
  }

  equals(other: NamespaceId): boolean {
    return super.equals(other);
  }
}

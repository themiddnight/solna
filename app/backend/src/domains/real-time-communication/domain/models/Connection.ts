/**
 * Connection domain models for real-time communication
 * Requirements: 10.2, 10.3
 */

export class ConnectionId {
  constructor(private readonly value: string) {
    if (value.trim().length === 0) {
      throw new Error('ConnectionId cannot be empty');
    }
  }

  static generate(): ConnectionId {
    return new ConnectionId(crypto.randomUUID());
  }

  equals(other: ConnectionId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

export enum UserRole {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  BAND_MEMBER = 'band_member',
  AUDIENCE = 'audience',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ROOM_OWNER = 'room_owner'
}

export enum ConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  FAILED = 'failed'
}

export class AudioConnection {
  constructor(
    public readonly id: ConnectionId,
    public readonly userId: string,
    public readonly role: UserRole,
    public state: ConnectionState = ConnectionState.CONNECTING,
    public lastHeartbeat: Date = new Date()
  ) {}

  updateState(newState: ConnectionState): void {
    this.state = newState;
    this.lastHeartbeat = new Date();
  }

  isHealthy(): boolean {
    const now = new Date();
    const timeSinceHeartbeat = now.getTime() - this.lastHeartbeat.getTime();
    const HEALTH_THRESHOLD = 60000; // 60 seconds
    
    // For newly created connections, consider them healthy for a grace period
    const GRACE_PERIOD = 5000; // 5 seconds
    const connectionAge = now.getTime() - this.lastHeartbeat.getTime();
    
    if (connectionAge < GRACE_PERIOD) {
      return true; // Grace period for new connections
    }
    
    return this.state === ConnectionState.CONNECTED && 
           timeSinceHeartbeat < HEALTH_THRESHOLD;
  }
}

export interface AudioBuffer {
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
  timestamp: number;
}
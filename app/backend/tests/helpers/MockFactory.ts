/**
 * MockFactory - Creates mock objects for testing
 */
import { jest } from '@jest/globals';

export interface MockUserOptions {
  [key: string]: unknown;
  id?: string;
  username?: string;
  role?: string;
  isReady?: boolean;
  joinedAt?: Date;
  isConnected?: boolean;
  permissions?: string[];
}

export interface MockRoomOptions {
  [key: string]: unknown;
  id?: string;
  name?: string;
  owner?: string;
  isPrivate?: boolean;
  users?: Map<string, unknown>;
  settings?: {
    maxUsers?: number;
    allowChat?: boolean;
    allowEffects?: boolean;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MockSocketOptions {
  [key: string]: unknown;
  id?: string;
  userId?: string;
  roomId?: string | null;
  connected?: boolean;
  auth?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

export interface MockEventDataOptions {
  [key: string]: unknown;
  type: string;
  timestamp?: Date;
  userId?: string;
  roomId?: string;
  data?: Record<string, unknown>;
}

export interface MockUser {
  id: string;
  username: string;
  role: string;
  isReady: boolean;
  joinedAt: Date;
  isConnected: boolean;
  permissions: string[];
}

export interface MockRoom {
  id: string;
  name: string;
  owner: string;
  isPrivate: boolean;
  users: Map<string, unknown>;
  settings: {
    maxUsers: number;
    allowChat: boolean;
    allowEffects: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface MockSocket {
  id: string;
  userId: string;
  roomId: string | null;
  connected: boolean;
  emit: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
  disconnect: jest.Mock;
  to: jest.Mock & { mockReturnThis(): MockSocket };
  in: jest.Mock & { mockReturnThis(): MockSocket };
  broadcast: {
    emit: jest.Mock;
    to: jest.Mock & { mockReturnThis(): MockSocket['broadcast'] };
    in: jest.Mock & { mockReturnThis(): MockSocket['broadcast'] };
  };
  handshake: {
    auth: Record<string, unknown>;
    query: Record<string, unknown>;
    headers: Record<string, unknown>;
  };
}

export interface MockSocketConnection {
  connect: jest.Mock;
  disconnect: jest.Mock;
  emit: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  connected: boolean;
}

export interface MockEventData {
  type: string;
  timestamp: Date;
  userId: string;
  roomId: string;
  data: Record<string, unknown>;
}

export interface MockWebRTCConnection {
  createOffer: jest.Mock;
  createAnswer: jest.Mock;
  setLocalDescription: jest.Mock;
  setRemoteDescription: jest.Mock;
  addIceCandidate: jest.Mock;
  getStats: jest.Mock;
  close: jest.Mock;
  connectionState: string;
  iceConnectionState: string;
}

export interface MockAudioContext {
  createGain: jest.Mock;
  createOscillator: jest.Mock;
  createAnalyser: jest.Mock;
  sampleRate: number;
  currentTime: number;
  state: string;
}

export interface MockRepository {
  create: jest.Mock;
  findById: jest.Mock;
  findAll: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  save: jest.Mock;
  exists: jest.Mock;
}

export class MockFactory {
  private userIdCounter = 0;
  private roomIdCounter = 0;
  private socketIdCounter = 0;

  createUser(overrides: Partial<MockUserOptions> = {}): MockUser {
    const id = overrides.id || `test-user-${++this.userIdCounter}`;
    return {
      id,
      username: overrides.username || `user-${id}`,
      role: overrides.role || 'audience',
      isReady: overrides.isReady ?? true,
      joinedAt: overrides.joinedAt || new Date(),
      isConnected: overrides.isConnected ?? true,
      permissions: overrides.permissions || ['view', 'chat'],
      ...overrides
    } as MockUser;
  }

  createRoom(overrides: Partial<MockRoomOptions> = {}): MockRoom {
    const id = overrides.id || `test-room-${++this.roomIdCounter}`;
    return {
      id,
      name: overrides.name || `Room ${id}`,
      owner: overrides.owner || 'test-owner',
      isPrivate: overrides.isPrivate ?? false,
      users: overrides.users || new Map<string, unknown>(),
      settings: overrides.settings || {
        maxUsers: 10,
        allowChat: true,
        allowEffects: true
      },
      createdAt: overrides.createdAt || new Date(),
      updatedAt: overrides.updatedAt || new Date(),
      ...overrides
    } as MockRoom;
  }

  createSocket(overrides: Partial<MockSocketOptions> = {}): MockSocket {
    const id = overrides.id || `socket-${++this.socketIdCounter}`;
    
    const mockSocket: MockSocket = {
      id,
      userId: overrides.userId || `user-${id}`,
      roomId: overrides.roomId ?? null,
      connected: overrides.connected ?? true,
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      to: jest.fn().mockReturnThis() as unknown as MockSocket['to'],
      in: jest.fn().mockReturnThis() as unknown as MockSocket['in'],
      broadcast: {
        emit: jest.fn(),
        to: jest.fn().mockReturnThis() as unknown as MockSocket['broadcast']['to'],
        in: jest.fn().mockReturnThis() as unknown as MockSocket['broadcast']['in'],
      },
      handshake: {
        auth: overrides.auth || {},
        query: overrides.query || {},
        headers: overrides.headers || {}
      },
    };

    return mockSocket;
  }

  createSocketConnection(): MockSocketConnection {
    return {
      connect: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      connected: true
    } as unknown as MockSocketConnection;
  }

  createMockService<T extends object>(methods: (keyof T)[]): jest.Mocked<T> {
    const mock = {} as jest.Mocked<T>;
    methods.forEach(method => {
      mock[method] = jest.fn() as unknown as jest.Mocked<T>[keyof T];
    });
    return mock;
  }

  createMockHandler<T extends object>(methods: (keyof T)[]): jest.Mocked<T> {
    const mock = {} as jest.Mocked<T>;
    methods.forEach(method => {
      mock[method] = jest.fn() as unknown as jest.Mocked<T>[keyof T];
    });
    return mock;
  }

  createMockRepository<T extends object>(): jest.Mocked<T> {
    return {
      create: jest.fn(),
      findById: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      save: jest.fn(),
      exists: jest.fn()
    } as unknown as jest.Mocked<T>;
  }

  createMockEventData(type: string, overrides: Partial<MockEventDataOptions> = {}): MockEventData {
    return {
      type,
      timestamp: new Date(),
      userId: `test-user-${Date.now()}`,
      roomId: `test-room-${Date.now()}`,
      data: {},
      ...overrides
    } as MockEventData;
  }

  createMockWebRTCConnection(): MockWebRTCConnection {
    return {
      createOffer: jest.fn(),
      createAnswer: jest.fn(),
      setLocalDescription: jest.fn(),
      setRemoteDescription: jest.fn(),
      addIceCandidate: jest.fn(),
      getStats: jest.fn(),
      close: jest.fn(),
      connectionState: 'connected',
      iceConnectionState: 'connected'
    } as unknown as MockWebRTCConnection;
  }

  createMockAudioContext(): MockAudioContext {
    return {
      createGain: jest.fn().mockReturnValue({
        connect: jest.fn(),
        disconnect: jest.fn(),
        gain: { value: 1 }
      }),
      createOscillator: jest.fn().mockReturnValue({
        connect: jest.fn(),
        disconnect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        frequency: { value: 440 }
      }),
      createAnalyser: jest.fn().mockReturnValue({
        connect: jest.fn(),
        disconnect: jest.fn(),
        getByteFrequencyData: jest.fn(),
        fftSize: 2048
      }),
      sampleRate: 44100,
      currentTime: 0,
      state: 'running'
    };
  }
}

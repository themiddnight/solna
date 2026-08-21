/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unused-vars */
/**
 * Test Fixtures - Sample data for testing
 */

import type { Room} from '@/types';
import { User, CreateRoomData, MetronomeState, RoomType } from '@/types';

export const testUsers = {
  owner: {
    id: 'owner-123',
    username: 'roomowner',
    role: 'room_owner' as const,
    isReady: true,
    isConnected: true,
    joinedAt: new Date('2024-01-01T00:00:00Z'),
    permissions: ['create_room', 'manage_room', 'view', 'chat', 'perform']
  },
  
  performer: {
    id: 'performer-456',
    username: 'performer1',
    role: 'performer' as const,
    isReady: true,
    isConnected: true,
    joinedAt: new Date('2024-01-01T01:00:00Z'),
    permissions: ['view', 'chat', 'perform'],
    currentInstrument: 'piano',
    currentCategory: 'keys'
  },
  
  audience: {
    id: 'audience-789',
    username: 'listener1',
    role: 'audience' as const,
    isReady: true,
    isConnected: true,
    joinedAt: new Date('2024-01-01T02:00:00Z'),
    permissions: ['view', 'chat']
  },
  
  admin: {
    id: 'admin-000',
    username: 'admin',
    role: 'admin' as const,
    isReady: true,
    isConnected: true,
    joinedAt: new Date('2024-01-01T00:30:00Z'),
    permissions: ['create_room', 'manage_room', 'view', 'chat', 'perform', 'moderate']
  }
};

export const mockRoom: Room = {
  id: 'room123',
  name: 'Test Room',
  roomType: RoomType.PERFORM,
  owner: 'user123',
  bandMembers: new Map(),
  audiences: new Map(),
  pendingMembers: new Map(),
  isPrivate: false,
  isHidden: false,
  isIsolated: false,
  createdAt: new Date(),
  metronome: {
    bpm: 120,
    beatZeroAt: Date.now(),
  },
};

export const testRooms = {
  public: {
    id: 'room-public-123',
    name: 'Public Test Room',
    roomType: RoomType.PERFORM,
    owner: testUsers.owner.id,
    bandMembers: new Map(),
  audiences: new Map(),
    pendingMembers: new Map(),
    isPrivate: false,
    isHidden: false,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    metronome: {
      bpm: 120,
      beatZeroAt: Date.now(),
    },
  },
  
  private: {
    id: 'room-private-456',
    name: 'Private Test Room',
    roomType: RoomType.PERFORM,
    owner: testUsers.owner.id,
    bandMembers: new Map(),
  audiences: new Map(),
    pendingMembers: new Map(),
    isPrivate: true,
    isHidden: false,
    createdAt: new Date('2024-01-01T01:00:00Z'),
    metronome: {
      bpm: 140,
      beatZeroAt: Date.now(),
    },
  }
};

export const testMessages = {
  chat: {
    id: 'msg-chat-001',
    userId: testUsers.performer.id,
    username: testUsers.performer.username,
    message: 'Hello everyone!',
    timestamp: new Date('2024-01-01T12:00:00Z'),
    type: 'chat' as const
  },
  
  system: {
    id: 'msg-system-001',
    userId: 'system',
    username: 'System',
    message: 'User joined the room',
    timestamp: new Date('2024-01-01T12:01:00Z'),
    type: 'system' as const
  }
};

export const testEffectChains = {
  virtualInstrument: {
    type: 'virtual_instrument' as const,
    effects: [
      {
        id: 'reverb-001',
        type: 'reverb',
        enabled: true,
        parameters: {
          roomSize: 0.5,
          wetness: 0.3,
          dryness: 0.7
        }
      },
      {
        id: 'delay-001',
        type: 'delay',
        enabled: false,
        parameters: {
          delayTime: 0.2,
          feedback: 0.4,
          wetness: 0.25
        }
      }
    ]
  },
  
  audioVoiceInput: {
    type: 'audio_voice_input' as const,
    effects: [
      {
        id: 'compressor-001',
        type: 'compressor',
        enabled: true,
        parameters: {
          threshold: -20,
          ratio: 4,
          attack: 0.003,
          release: 0.1
        }
      }
    ]
  }
};

export const testSocketEvents = {
  joinRoom: {
    roomId: testRooms.public.id,
    username: 'testuser',
    userId: 'test-user-001'
  },
  
  leaveRoom: {
    roomId: testRooms.public.id,
    userId: 'test-user-001'
  },
  
  sendMessage: {
    roomId: testRooms.public.id,
    message: 'Test message',
    userId: 'test-user-001'
  },
  
  changeInstrument: {
    roomId: testRooms.public.id,
    userId: 'test-user-001',
    instrument: 'guitar',
    category: 'strings'
  },
  
  metronomeUpdate: {
    roomId: testRooms.public.id,
    bpm: 140,
    isPlaying: true
  }
};

export const testPerformanceMetrics = {
  acceptable: {
    roomCreation: 100, // ms
    userJoin: 50, // ms
    messageDelivery: 20, // ms
    socketConnection: 200 // ms
  },
  
  warning: {
    roomCreation: 500, // ms
    userJoin: 200, // ms
    messageDelivery: 100, // ms
    socketConnection: 1000 // ms
  }
};

// Helper function to create test data with overrides
export function createTestUser(overrides: Partial<typeof testUsers.owner> = {}) {
  return {
    ...testUsers.audience, // Default to audience
    ...overrides,
    id: overrides.id || `test-user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  };
}

export function createTestRoom(overrides: Partial<typeof testRooms.public> = {}) {
  return {
    ...testRooms.public, // Default to public room
    ...overrides,
    id: overrides.id || `test-room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    bandMembers: new Map(),
  audiences: new Map(),
    pendingMembers: new Map()
  };
}

export function createTestMessage(overrides: Partial<typeof testMessages.chat> = {}) {
  return {
    ...testMessages.chat,
    ...overrides,
    id: overrides.id || `test-msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: overrides.timestamp || new Date()
  };
}

// Validation helpers
export function isValidUser(user: any): boolean {
  return (
    typeof user.id === 'string' &&
    typeof user.username === 'string' &&
    ['room_owner', 'performer', 'audience', 'admin'].includes(user.role) &&
    typeof user.isReady === 'boolean' &&
    Array.isArray(user.permissions)
  );
}

export function isValidRoom(room: any): boolean {
  return (
    typeof room.id === 'string' &&
    typeof room.name === 'string' &&
    typeof room.owner === 'string' &&
    typeof room.isPrivate === 'boolean' &&
    typeof room.isHidden === 'boolean' &&
    ['perform', 'arrange'].includes(room.roomType) &&
    room.createdAt instanceof Date
  );
}

export function isValidMessage(message: any): boolean {
  return (
    typeof message.id === 'string' &&
    typeof message.userId === 'string' &&
    typeof message.username === 'string' &&
    typeof message.message === 'string' &&
    message.timestamp instanceof Date &&
    ['chat', 'system'].includes(message.type)
  );
}
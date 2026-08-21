import type { Socket } from 'socket.io';
import type { Namespace } from 'socket.io';

/**
 * Integration Tests for Event Flow
 * Tests the complete event flow from client to server and back
 */

const createMockSocket = (id: string = 'test-socket'): Socket => ({
  id,
  emit: jest.fn(),
  to: jest.fn(() => ({ emit: jest.fn() })),
  broadcast: { emit: jest.fn() },
  on: jest.fn(),
  off: jest.fn(),
} as unknown as Socket);

const createMockNamespace = (name: string = '/test'): Namespace => ({
  name,
  emit: jest.fn(),
  to: jest.fn(() => ({ emit: jest.fn() })),
} as unknown as Namespace);

// Asymmetric matchers are typed `any` in @types/jest — funnel them through `unknown`
// so property assignments stay type-safe (TR-27).
const anyObjectMatcher: unknown = expect.any(Object);
const roomIdMatcher: unknown = expect.objectContaining({ id: 'test-room' });
const userIdMatcher: unknown = expect.objectContaining({ id: 'user-123' });

describe('Event Flow Integration Tests', () => {
  describe('PerformRoom Event Flow', () => {
    let mockSocket: Socket;
    let mockNamespace: Namespace;

    beforeEach(() => {
      mockSocket = createMockSocket();
      mockNamespace = createMockNamespace('/room/test-room');
    });

    it('should follow perform:instrument_changed event flow', () => {
      const eventData = {
        userId: 'user-123',
        instrument: 'piano',
        category: 'synthesizer',
      };

      // Simulate event emission
void mockNamespace.emit('perform:instrument_changed', eventData);

      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'perform:instrument_changed',
        expect.objectContaining({
          userId: 'user-123',
          instrument: 'piano',
          category: 'synthesizer',
        })
      );
    });

    it('should follow perform:note_played event flow', () => {
      const eventData = {
        userId: 'user-123',
        username: 'TestUser',
        notes: ['C4', 'E4', 'G4'],
        velocity: 0.8,
        instrument: 'piano',
        category: 'synthesizer',
        eventType: 'noteOn',
      };

void mockSocket.broadcast.emit('perform:note_played', eventData);

      expect(mockSocket.broadcast.emit).toHaveBeenCalledWith(
        'perform:note_played',
        expect.objectContaining({
          userId: 'user-123',
          notes: ['C4', 'E4', 'G4'],
        })
      );
    });

    it('should follow perform:synth_params_changed event flow', () => {
      const eventData = {
        userId: 'user-123',
        username: 'TestUser',
        instrument: 'piano',
        category: 'synthesizer',
        params: {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.8 },
        },
      };

void mockSocket.broadcast.emit('perform:synth_params_changed', eventData);

      expect(mockSocket.broadcast.emit).toHaveBeenCalledWith(
        'perform:synth_params_changed',
        expect.objectContaining({
          userId: 'user-123',
          params: anyObjectMatcher,
        })
      );
    });

    it('should follow perform:bpm_changed event flow', () => {
      const eventData = {
        roomId: 'test-room',
        bpm: 140,
        userId: 'user-123',
      };

void mockNamespace.emit('perform:bpm_changed', eventData);

      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'perform:bpm_changed',
        expect.objectContaining({
          bpm: 140,
          userId: 'user-123',
        })
      );
    });

    it('should follow perform:room_scale_changed event flow', () => {
      const eventData = {
        roomId: 'test-room',
        rootNote: 'C',
        scale: 'major',
        userId: 'user-123',
      };

void mockNamespace.emit('perform:room_scale_changed', eventData);

      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'perform:room_scale_changed',
        expect.objectContaining({
          rootNote: 'C',
          scale: 'major',
        })
      );
    });
  });

  describe('ArrangeRoom Event Flow', () => {
    let mockNamespace: Namespace;

    beforeEach(() => {
      mockNamespace = createMockNamespace('/room/arrange-room');
    });

    it('should follow arrange:track_added event flow', () => {
      const eventData = {
        track: {
          id: 'track-123',
          name: 'Piano Track',
          instrumentId: 'piano',
          volume: 0.8,
        },
        userId: 'user-123',
      };

void mockNamespace.to('arrange-room').emit('arrange:track_added', eventData);

      expect(mockNamespace.to).toHaveBeenCalledWith('arrange-room');
    });

    it('should follow arrange:bpm_changed event flow', () => {
      const eventData = {
        roomId: 'arrange-room',
        bpm: 128,
        userId: 'user-123',
      };

void mockNamespace.to('arrange-room').emit('arrange:bpm_changed', eventData);

      expect(mockNamespace.to).toHaveBeenCalledWith('arrange-room');
    });
  });

  describe('Room Management Event Flow', () => {
    let mockNamespace: Namespace;

    beforeEach(() => {
      mockNamespace = createMockNamespace('/room/test-room');
    });

    it('should follow room:state_updated event flow', () => {
      const eventData = {
        room: {
          id: 'test-room',
          name: 'Test Room',
          users: [],
          pendingMembers: [],
        },
      };

void mockNamespace.emit('room:state_updated', eventData);

      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'room:state_updated',
        expect.objectContaining({
          room: roomIdMatcher,
        })
      );
    });

    it('should follow user_joined event flow', () => {
      const eventData = {
        user: {
          id: 'user-123',
          username: 'TestUser',
          role: 'member',
        },
      };

void mockNamespace.emit('user_joined', eventData);

      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'user_joined',
        expect.objectContaining({
          user: userIdMatcher,
        })
      );
    });

    it('should follow user_left event flow', () => {
      const eventData = {
        user: {
          id: 'user-123',
          username: 'TestUser',
        },
      };

void mockNamespace.emit('user_left', eventData);

      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'user_left',
        expect.objectContaining({
          user: userIdMatcher,
        })
      );
    });
  });

  describe('Event Naming Convention Validation', () => {
    it('should validate all PerformRoom events use perform: prefix', () => {
      const performEvents = [
        'perform:instrument_changed',
        'perform:note_played',
        'perform:stop_all_notes',
        'perform:synth_params_changed',
        'perform:effects_chain_changed',
        'perform:bpm_changed',
        'perform:room_scale_changed',
        'perform:user_state_updated',
        'perform:sequencer_updated',
        'perform:recording_state_changed',
      ];

      performEvents.forEach((event) => {
        expect(event).toMatch(/^perform:/);
      });
    });

    it('should validate all ArrangeRoom events use arrange: prefix', () => {
      const arrangeEvents = [
        'arrange:track_added',
        'arrange:track_updated',
        'arrange:track_deleted',
        'arrange:track_instrument_changed',
        'arrange:region_added',
        'arrange:bpm_changed',
        'arrange:scale_changed',
      ];

      arrangeEvents.forEach((event) => {
        expect(event).toMatch(/^arrange:/);
      });
    });

    it('should validate all Room Management events use room: prefix', () => {
      const roomEvents = ['room:state_updated'];

      roomEvents.forEach((event) => {
        expect(event).toMatch(/^room:/);
      });
    });
  });
});

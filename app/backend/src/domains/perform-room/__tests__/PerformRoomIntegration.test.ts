import { PerformRoomStateService } from '../application/PerformRoomStateService';
import { PerformRoomHandler } from '../infrastructure/handlers/PerformRoomHandler';
import { METRONOME_CONSTANTS } from '@jam-band/shared';
import type { Socket } from 'socket.io';
import type { Namespace } from 'socket.io';
import type { RoomSessionManager } from '../../room-management/infrastructure/services/RoomSessionManager';
import type { RoomLifecycleService } from '../../room-management/application/RoomLifecycleService';
import type { UserPerformState, InstrumentCategory } from '../domain/models/PerformRoomState';

// Mock dependencies
const createMockSocket = (): Socket => ({
  id: 'test-socket-id',
  emit: jest.fn(),
  to: jest.fn(() => ({ emit: jest.fn() })),
  broadcast: { emit: jest.fn() },
} as unknown as Socket);

const createMockNamespace = (): Namespace => {
  const emit = jest.fn();
  return {
    emit,
    to: jest.fn().mockReturnValue({ emit }),
  } as unknown as Namespace;
};

describe('PerformRoom Integration Tests', () => {
  let stateService: PerformRoomStateService;
  let handler: PerformRoomHandler;
  let mockSocket: Socket;
  let mockNamespace: Namespace;
  const testRoomId = 'test-perform-room';
  const testUserId = 'test-user-123';

  beforeEach(() => {
    stateService = new PerformRoomStateService();
    const mockRoomSessionManager = {
      getRoomSession: jest.fn().mockReturnValue({ roomId: testRoomId, userId: testUserId }),
      removeSession: jest.fn(),
    } as unknown as RoomSessionManager;
    const mockRoomLifecycleService = {
      getRoom: jest.fn().mockResolvedValue({
        id: testRoomId,
        roomType: 'perform',
        bandMembers: new Map([[testUserId, { id: testUserId, username: 'TestUser', role: 'band_member' }]]),
        audiences: new Map(),
      }),
    } as unknown as RoomLifecycleService;
    handler = new PerformRoomHandler(
      stateService,
      mockRoomSessionManager,
      mockRoomLifecycleService
    );
    mockSocket = createMockSocket();
    mockNamespace = createMockNamespace();
  });

  afterEach(async () => {
    await stateService.deleteState(testRoomId);
    jest.clearAllMocks();
  });

  describe('State Initialization', () => {
    it('should initialize PerformRoom state with default values', async () => {
      const state = await stateService.initializeState(testRoomId);

      expect(state.roomId).toBe(testRoomId);
      expect(state.roomType).toBe('perform');
      expect(state.bpm).toBe(METRONOME_CONSTANTS.DEFAULT_BPM);
      expect(state.timeSignature).toEqual({ numerator: 4, denominator: 4 });
      expect(state.userStates).toBeInstanceOf(Map);
      expect(state.userStates.size).toBe(0);
      expect(state.recordingStates).toBeDefined();
      expect(state.broadcastStates).toEqual({});
      expect(state.voiceStates).toEqual({});
    });

    it('should store and retrieve state', async () => {
      await stateService.initializeState(testRoomId);
      const retrievedState = await stateService.getState(testRoomId);

      expect(retrievedState).toBeDefined();
      expect(retrievedState?.roomId).toBe(testRoomId);
    });
  });

  describe('User State Management', () => {
    beforeEach(async () => {
      await stateService.initializeState(testRoomId);
    });

    it('should add user state', async () => {
      const userState = {
        currentInstrument: 'piano',
        currentCategory: 'synthesizer' as const,
        synthParams: {},
        sequencerState: null,
      } as unknown as UserPerformState;

      await stateService.addUserState(testRoomId, testUserId, userState);
      const state = await stateService.getState(testRoomId);

      expect(state?.userStates.has(testUserId)).toBe(true);
      expect(state?.userStates.get(testUserId)?.currentInstrument).toBe('piano');
    });

    it('should update user state', async () => {
      const initialState = {
        currentInstrument: 'piano',
        currentCategory: 'synthesizer' as const,
        synthParams: {},
        sequencerState: null,
      } as unknown as UserPerformState;

      await stateService.addUserState(testRoomId, testUserId, initialState);
      await stateService.updateUserState(testRoomId, testUserId, {
        currentInstrument: 'guitar',
        currentCategory: 'sampler' as unknown as InstrumentCategory,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.userStates.get(testUserId)?.currentInstrument).toBe('guitar');
    });

    it('should remove user state', async () => {
      const userState = {
        currentInstrument: 'piano',
        currentCategory: 'synthesizer' as const,
        synthParams: {},
        sequencerState: { beats: [] },
      } as unknown as UserPerformState;

      await stateService.addUserState(testRoomId, testUserId, userState);
      expect((await stateService.getState(testRoomId))?.userStates.has(testUserId)).toBe(true);

      await stateService.removeUserState(testRoomId, testUserId);
      expect((await stateService.getState(testRoomId))?.userStates.has(testUserId)).toBe(false);
    });
  });

  describe('BPM and Scale Management', () => {
    beforeEach(async () => {
      await stateService.initializeState(testRoomId);
    });

    it('should update BPM', async () => {
      const updatedState = await stateService.updateState(testRoomId, { bpm: 140 });

      expect(updatedState.bpm).toBe(140);
    });

    it('should update scale', async () => {
      const updatedState = await stateService.updateState(testRoomId, {
        roomScale: { rootNote: 'C', scale: 'major' },
      });

      expect(updatedState.roomScale).toEqual({ rootNote: 'C', scale: 'major' });
    });
  });

  describe('Recording State Management', () => {
    beforeEach(async () => {
      await stateService.initializeState(testRoomId);
    });

    it('should update recording state', async () => {
      await stateService.updateRecordingState(testRoomId, {
        isAudioRecording: true,
        isSessionRecording: true,
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.isAudioRecording).toBe(true);
      expect(state?.recordingStates.isSessionRecording).toBe(true);
    });

    it('should update shadow capture states', async () => {
      await stateService.updateRecordingState(testRoomId, {
        shadowCaptureStates: {
          [testUserId]: true,
        },
      });

      const state = await stateService.getState(testRoomId);
      expect(state?.recordingStates.shadowCaptureStates[testUserId]).toBe(true);
    });
  });

  describe('Broadcast State Management', () => {
    beforeEach(async () => {
      await stateService.initializeState(testRoomId);
    });

    it('should update broadcast state', async () => {
      await stateService.updateMemberBroadcastState(testRoomId, testUserId, 'TestUser', true);

      const state = await stateService.getState(testRoomId);
      expect(state?.broadcastStates[testUserId]).toEqual({
        username: 'TestUser',
        isActive: true,
      });
    });

    it('should remove broadcast state', async () => {
      await stateService.updateMemberBroadcastState(testRoomId, testUserId, 'TestUser', true);
      await stateService.removeMemberBroadcastState(testRoomId, testUserId);

      const state = await stateService.getState(testRoomId);
      expect(state?.broadcastStates[testUserId]).toBeUndefined();
    });
  });

  describe('Voice State Management', () => {
    beforeEach(async () => {
      await stateService.initializeState(testRoomId);
    });

    it('should update voice state', async () => {
      await stateService.updateVoiceState(testRoomId, testUserId, true);

      const state = await stateService.getState(testRoomId);
      expect(state?.voiceStates[testUserId]).toEqual({ isMuted: true });
    });

    it('should remove voice state', async () => {
      await stateService.updateVoiceState(testRoomId, testUserId, true);
      await stateService.removeVoiceState(testRoomId, testUserId);

      const state = await stateService.getState(testRoomId);
      expect(state?.voiceStates[testUserId]).toBeUndefined();
    });
  });

  describe('Event Handler Integration', () => {
    beforeEach(async () => {
      await stateService.initializeState(testRoomId);
    });

    it('should handle BPM change event', async () => {
      await handler.handleBpmChange(
        mockSocket,
        mockNamespace,
        { roomId: testRoomId, bpm: 150 }
      );

      const state = await stateService.getState(testRoomId);
      expect(state?.bpm).toBe(150);
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'perform:bpm_changed',
        expect.objectContaining({ bpm: 150 })
      );
    });

    it('should persist scale change to state without re-emitting scale_changed (live follow uses ROOM_SCALE_CHANGED)', async () => {
      await handler.handleScaleChange(
        mockSocket,
        mockNamespace,
        { roomId: testRoomId, rootNote: 'D', scale: 'minor' }
      );

      const state = await stateService.getState(testRoomId);
      expect(state?.roomScale).toEqual({ rootNote: 'D', scale: 'minor' });
      expect(mockNamespace.emit).not.toHaveBeenCalledWith(
        'perform:scale_changed',
        expect.anything()
      );
    });
  });
});

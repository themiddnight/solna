
import { PerformRoomHandler } from '../infrastructure/handlers/PerformRoomHandler';
import { PERFORM_EVENTS, OCCUPANCY_EVENTS } from '@jam-band/shared';
import type { PerformRoomState, UserPerformState } from '../domain/models/PerformRoomState';
import type { PerformRoomStateService } from '../application/PerformRoomStateService';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { Socket, Namespace } from 'socket.io';
import type { Room } from '@/types';
import { RoomType } from '@/types';
import { createPartialMock } from '@/testing/mocks';

describe('PerformRoomHandler - Broadcast Payloads', () => {
  let handler: PerformRoomHandler;
  let mockStateService: jest.Mocked<PerformRoomStateService>;
  let mockSessionManager: jest.Mocked<RoomSessionManager>;
  let mockLifecycleService: jest.Mocked<RoomLifecycleService>;
  let mockMembershipService: jest.Mocked<RoomMembershipService>;
  let mockSocket: jest.Mocked<Socket>;
  let mockNamespace: jest.Mocked<Namespace>;
  
  const TEST_ROOM_ID = 'test-room-123';
  const TEST_USER_ID = 'user-456';
  const TEST_USERNAME = 'testuser';

  const makeBaseState = (): PerformRoomState => ({
    roomId: TEST_ROOM_ID,
    roomType: 'perform',
    userStates: new Map(),
    recordingStates: {
      isAudioRecording: false,
      isSessionRecording: false,
      shadowCaptureStates: {},
    },
    broadcastStates: {},
    voiceStates: {},
    occupancy: new Map(),
    companions: [],
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    companionChordLength: 2,
    companionProgressionFlavor: 'diatonic',
    companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
    lastUpdated: new Date(),
  });

  beforeEach(() => {
    mockStateService = createPartialMock<PerformRoomStateService>({
      getState: jest.fn(),
      saveState: jest.fn(),
      updateUserState: jest.fn(),
      updateShadowCaptureState: jest.fn(),
      initializeState: jest.fn(),
      updateTimeSignature: jest.fn(),
      removeUserState: jest.fn(),
      removeVoiceState: jest.fn(),
      removeMemberBroadcastState: jest.fn(),
    });

    mockSessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn(),
    });

    mockLifecycleService = createPartialMock<RoomLifecycleService>({
      getRoom: jest.fn(),
    });

    mockMembershipService = createPartialMock<RoomMembershipService>({
      updateUserSynthParams: jest.fn().mockResolvedValue(true),
      updateUserInstrumentParams: jest.fn().mockResolvedValue(true),
      updateUserEffectChains: jest.fn().mockResolvedValue(true),
      updateUserInstrument: jest.fn().mockResolvedValue(true),
      isRoomOwner: jest.fn(),
    });

    mockSocket = createPartialMock<Socket>({
      id: 'socket-123',
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
    });

    mockNamespace = createPartialMock<Namespace>({
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    });

    handler = new PerformRoomHandler(
      mockStateService,
      mockSessionManager,
      mockLifecycleService,
      mockMembershipService,
    );

    // Mock session validation
    mockSessionManager.getRoomSession.mockReturnValue({
      socketId: 'socket-123',
      namespacePath: `/room/${TEST_ROOM_ID}`,
      connectedAt: new Date(),
      lastActivity: new Date(),
      roomId: TEST_ROOM_ID,
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
    });

    const mockRoom: Room = {
      id: TEST_ROOM_ID,
      name: 'Test Room',
      roomType: RoomType.PERFORM,
      owner: TEST_USER_ID,
      bandMembers: new Map([[TEST_USER_ID, { id: TEST_USER_ID, username: TEST_USERNAME, role: 'band_member' as const, isReady: true }]]),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      isIsolated: false,
      createdAt: new Date(),
      metronome: { bpm: 120, beatZeroAt: Date.now() },
    };
    mockLifecycleService.getRoom.mockResolvedValue(mockRoom);
  });

  describe('handleSynthParamsUpdate', () => {
    it('should broadcast synth params with username, instrument, and category', async () => {
      const existingUserState: UserPerformState = {
        userId: TEST_USER_ID,
        username: TEST_USERNAME,
        currentInstrument: 'synth',
        currentCategory: 'synth',
        effectChains: {},
        isPlaying: false,
      };

      const mockState: PerformRoomState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform',
        userStates: new Map([[TEST_USER_ID, existingUserState]]),
        recordingStates: {
          isAudioRecording: false,
          isSessionRecording: false,
          shadowCaptureStates: {},
        },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic',
        companionChordProgression: { mode: 'random' as const, chords: [], barsPerChord: 1 as const, currentChordIndex: 0 },
        lastUpdated: new Date(),
      };

void mockStateService.getState.mockResolvedValue(mockState);
void mockStateService.updateUserState.mockResolvedValue(mockState);

      const testParams = { oscillator: 'sine', envelope: { attack: 0.1 } };
      
      await handler.handleSynthParamsUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      // Ephemeral: uses socket.to() to exclude sender
      expect(mockSocket.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'perform:synth_params_changed',
        expect.objectContaining({
          userId: TEST_USER_ID,
          username: TEST_USERNAME,
          params: testParams,
        })
      );
    });

    it('should include empty strings for instrument/category if user state not found', async () => {
      const mockState: PerformRoomState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform',
        userStates: new Map(), // No user state
        recordingStates: {
          isAudioRecording: false,
          isSessionRecording: false,
          shadowCaptureStates: {},
        },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic',
        companionChordProgression: { mode: 'random' as const, chords: [], barsPerChord: 1 as const, currentChordIndex: 0 },
        lastUpdated: new Date(),
      };

void mockStateService.getState.mockResolvedValue(mockState);
void mockStateService.updateUserState.mockResolvedValue(mockState);

      const testParams = { oscillator: 'sine' };
      
      await handler.handleSynthParamsUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      // Ephemeral: uses socket.to() to exclude sender
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'perform:synth_params_changed',
        expect.objectContaining({
          userId: TEST_USER_ID,
          username: TEST_USERNAME,
          params: testParams,
        })
      );
    });
  });

  describe('handleEffectsChainUpdate', () => {
    it('should broadcast effects chain with username and chains field', async () => {
void mockStateService.updateUserState.mockResolvedValue(makeBaseState());

      const testChains = {
        instrument: { type: 'instrument', effects: [{ type: 'reverb', params: {} }] },
        voice: { type: 'voice', effects: [] },
      };
      
      await handler.handleEffectsChainUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        chains: testChains,
      });

      // Ephemeral: uses socket.to() to exclude sender
      expect(mockSocket.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'perform:effects_chain_changed',
        expect.objectContaining({
          userId: TEST_USER_ID,
          username: TEST_USERNAME,
          chains: testChains,
        })
      );
    });

    it('should use chains field not effects field', async () => {
void mockStateService.updateUserState.mockResolvedValue(makeBaseState());

      const testChains = {
        instrument: { type: 'instrument', effects: [] },
      };
      
      await handler.handleEffectsChainUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        chains: testChains,
      });

      const broadcastCall = mockSocket.emit.mock.calls[0]!;
      const broadcastData = broadcastCall[1] as { chains: unknown };

      // Should have 'chains' field
      expect(broadcastData).toHaveProperty('chains');
      expect(broadcastData.chains).toEqual(testChains);

      // Should NOT have 'effects' field
      expect(broadcastData).not.toHaveProperty('effects');
    });
  });

  describe('Ephemeral vs Commit separation', () => {
    it('ephemeral synth params should NOT write to Redis', async () => {
      const testParams = { oscillator: 'sawtooth' };
      
      await handler.handleSynthParamsUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      // Ephemeral: no Redis writes
      expect(mockStateService.updateUserState).not.toHaveBeenCalled();
      expect(mockMembershipService.updateUserSynthParams).not.toHaveBeenCalled();
      // But should broadcast via socket.to
      expect(mockSocket.to).toHaveBeenCalledWith(TEST_ROOM_ID);
    });

    it('ephemeral effects chain should NOT write to Redis', async () => {
      const testChains = { instrument: { type: 'instrument', effects: [] } };
      
      await handler.handleEffectsChainUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        chains: testChains,
      });

      // Ephemeral: no Redis writes
      expect(mockStateService.updateUserState).not.toHaveBeenCalled();
      expect(mockMembershipService.updateUserEffectChains).not.toHaveBeenCalled();
      // But should broadcast via socket.to
      expect(mockSocket.to).toHaveBeenCalledWith(TEST_ROOM_ID);
    });

    it('ephemeral synth params should relay instrument/category from client data', async () => {
      const testParams = { oscillator: 'sine' };
      
      await handler.handleSynthParamsUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
        instrument: 'supersaw',
        category: 'synthesizer',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'perform:synth_params_changed',
        expect.objectContaining({
          instrument: 'supersaw',
          category: 'synthesizer',
          params: testParams,
        })
      );
    });

    it('ephemeral synth params should default instrument/category to empty string', async () => {
      const testParams = { oscillator: 'sine' };
      
      await handler.handleSynthParamsUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
        // No instrument or category provided
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'perform:synth_params_changed',
        expect.objectContaining({
          instrument: '',
          category: '',
        })
      );
    });
  });

  describe('handleSynthParamsCommit', () => {
    const existingUserState: UserPerformState = {
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      currentInstrument: 'supersaw',
      currentCategory: 'synth',
      effectChains: {},
      isPlaying: false,
    };

    const mockState: PerformRoomState = {
      roomId: TEST_ROOM_ID,
      roomType: 'perform',
      userStates: new Map([[TEST_USER_ID, existingUserState]]),
      recordingStates: {
        isAudioRecording: false,
        isSessionRecording: false,
        shadowCaptureStates: {},
      },
      broadcastStates: {},
      voiceStates: {},
      occupancy: new Map(),
      companions: [],
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      companionChordLength: 2,
      companionProgressionFlavor: 'diatonic',
      companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
      lastUpdated: new Date(),
    };

    it('should write synth params to Redis via stateService', async () => {
void mockStateService.updateUserState.mockResolvedValue(mockState);
void mockStateService.getState.mockResolvedValue(mockState);

      const testParams = { oscillator: 'sawtooth', envelope: { attack: 0.2 } };
      
      await handler.handleSynthParamsCommit(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      expect(mockStateService.updateUserState).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        { synthParams: testParams }
      );
    });

    it('should sync to main room state via membershipService', async () => {
void mockStateService.updateUserState.mockResolvedValue(mockState);
void mockStateService.getState.mockResolvedValue(mockState);

      const testParams = { oscillator: 'sawtooth' };
      
      await handler.handleSynthParamsCommit(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      expect(mockMembershipService.updateUserSynthParams).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        testParams
      );
    });

    it('should broadcast committed event via namespace.to (to all including sender)', async () => {
void mockStateService.updateUserState.mockResolvedValue(mockState);
void mockStateService.getState.mockResolvedValue(mockState);

      const testParams = { oscillator: 'sawtooth' };
      
      await handler.handleSynthParamsCommit(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      // Commit uses namespace.to (all users) not socket.to (exclude sender)
      expect(mockNamespace.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'perform:synth_params_committed',
        expect.objectContaining({
          userId: TEST_USER_ID,
          username: TEST_USERNAME,
          instrument: 'supersaw',
          category: 'synth',
          params: testParams,
        })
      );
    });
  });

  describe('handleInstrumentParamsUpdate (DEV-301 — non-synth instrument pre-gain)', () => {
    it('should broadcast instrument params with username, instrument, and category', async () => {
      const existingUserState: UserPerformState = {
        userId: TEST_USER_ID,
        username: TEST_USERNAME,
        currentInstrument: 'acoustic_grand_piano',
        currentCategory: 'sampler',
        effectChains: {},
        isPlaying: false,
      };

      const mockState: PerformRoomState = {
        roomId: TEST_ROOM_ID,
        roomType: 'perform',
        userStates: new Map([[TEST_USER_ID, existingUserState]]),
        recordingStates: {
          isAudioRecording: false,
          isSessionRecording: false,
          shadowCaptureStates: {},
        },
        broadcastStates: {},
        voiceStates: {},
        occupancy: new Map(),
        companions: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        companionChordLength: 2,
        companionProgressionFlavor: 'diatonic',
        companionChordProgression: { mode: 'random' as const, chords: [], barsPerChord: 1 as const, currentChordIndex: 0 },
        lastUpdated: new Date(),
      };

void mockStateService.getState.mockResolvedValue(mockState);
void mockStateService.updateUserState.mockResolvedValue(mockState);

      const testParams = { volume: -9 };

      await handler.handleInstrumentParamsUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      // Ephemeral: uses socket.to() to exclude sender
      expect(mockSocket.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'perform:instrument_params_changed',
        expect.objectContaining({
          userId: TEST_USER_ID,
          username: TEST_USERNAME,
          params: testParams,
        })
      );
    });

    it('ephemeral instrument params should NOT write to Redis', async () => {
      const testParams = { volume: -3 };

      await handler.handleInstrumentParamsUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      // Ephemeral: no Redis writes
      expect(mockStateService.updateUserState).not.toHaveBeenCalled();
      expect(mockMembershipService.updateUserInstrumentParams).not.toHaveBeenCalled();
      // But should broadcast via socket.to
      expect(mockSocket.to).toHaveBeenCalledWith(TEST_ROOM_ID);
    });

    it('ephemeral instrument params should relay instrument/category from client data', async () => {
      const testParams = { volume: -6 };

      await handler.handleInstrumentParamsUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
        instrument: 'drum_kit_808',
        category: 'drums',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'perform:instrument_params_changed',
        expect.objectContaining({
          instrument: 'drum_kit_808',
          category: 'drums',
          params: testParams,
        })
      );
    });

    it('ephemeral instrument params should default instrument/category to empty string', async () => {
      const testParams = { volume: -6 };

      await handler.handleInstrumentParamsUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
        // No instrument or category provided
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'perform:instrument_params_changed',
        expect.objectContaining({
          instrument: '',
          category: '',
        })
      );
    });
  });

  describe('handleInstrumentParamsCommit (DEV-301 — non-synth instrument pre-gain)', () => {
    const existingUserState: UserPerformState = {
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      currentInstrument: 'drum_kit_808',
      currentCategory: 'drums',
      effectChains: {},
      isPlaying: false,
    };

    const mockState: PerformRoomState = {
      roomId: TEST_ROOM_ID,
      roomType: 'perform',
      userStates: new Map([[TEST_USER_ID, existingUserState]]),
      recordingStates: {
        isAudioRecording: false,
        isSessionRecording: false,
        shadowCaptureStates: {},
      },
      broadcastStates: {},
      voiceStates: {},
      occupancy: new Map(),
      companions: [],
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      companionChordLength: 2,
      companionProgressionFlavor: 'diatonic',
      companionChordProgression: { mode: 'random', chords: [], barsPerChord: 1, currentChordIndex: 0 },
      lastUpdated: new Date(),
    };

    it('should write instrument params to Redis via stateService', async () => {
void mockStateService.updateUserState.mockResolvedValue(mockState);
void mockStateService.getState.mockResolvedValue(mockState);

      const testParams = { volume: -9 };

      await handler.handleInstrumentParamsCommit(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      expect(mockStateService.updateUserState).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        { instrumentParams: testParams }
      );
    });

    it('should sync to main room state via membershipService', async () => {
void mockStateService.updateUserState.mockResolvedValue(mockState);
void mockStateService.getState.mockResolvedValue(mockState);

      const testParams = { volume: -9 };

      await handler.handleInstrumentParamsCommit(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      expect(mockMembershipService.updateUserInstrumentParams).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        testParams
      );
    });

    it('should broadcast committed event via namespace.to (to all including sender)', async () => {
void mockStateService.updateUserState.mockResolvedValue(mockState);
void mockStateService.getState.mockResolvedValue(mockState);

      const testParams = { volume: -9 };

      await handler.handleInstrumentParamsCommit(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        params: testParams,
      });

      // Commit uses namespace.to (all users) not socket.to (exclude sender)
      expect(mockNamespace.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'perform:instrument_params_committed',
        expect.objectContaining({
          userId: TEST_USER_ID,
          username: TEST_USERNAME,
          instrument: 'drum_kit_808',
          category: 'drums',
          params: testParams,
        })
      );
    });
  });

  describe('handleEffectsChainCommit', () => {
    it('should write effects chain to Redis via stateService', async () => {
void mockStateService.updateUserState.mockResolvedValue(makeBaseState());

      const testChains = {
        instrument: { type: 'instrument', effects: [{ type: 'reverb', params: {} }] },
      };
      
      await handler.handleEffectsChainCommit(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        chains: testChains,
      });

      expect(mockStateService.updateUserState).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        { effectChains: testChains }
      );
    });

    it('should sync to main room state via membershipService', async () => {
void mockStateService.updateUserState.mockResolvedValue(makeBaseState());

      const testChains = {
        instrument: { type: 'instrument', effects: [] },
      };
      
      await handler.handleEffectsChainCommit(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        chains: testChains,
      });

      expect(mockMembershipService.updateUserEffectChains).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        testChains
      );
    });

    it('should broadcast committed event via namespace.to (to all including sender)', async () => {
void mockStateService.updateUserState.mockResolvedValue(makeBaseState());

      const testChains = {
        instrument: { type: 'instrument', effects: [{ type: 'delay', params: {} }] },
      };
      
      await handler.handleEffectsChainCommit(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        chains: testChains,
      });

      expect(mockNamespace.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        'perform:effects_chain_committed',
        expect.objectContaining({
          userId: TEST_USER_ID,
          username: TEST_USERNAME,
          chains: testChains,
        })
      );
    });
  });

  describe('handleTimeSignatureUpdate — denominator validation', () => {
    const setupOwnerAndState = () => {
      mockMembershipService.isRoomOwner.mockResolvedValue(true);
      mockStateService.updateTimeSignature.mockResolvedValue({
        ...makeBaseState(),
        timeSignature: { numerator: 6, denominator: 8 },
      });
    };

    it('accepts denominator=8 and broadcasts it', async () => {
      setupOwnerAndState();

      await handler.handleTimeSignatureUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        numerator: 6,
        denominator: 8,
      });

      expect(mockStateService.updateTimeSignature).toHaveBeenCalledWith(TEST_ROOM_ID, 6, 8);
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        expect.stringContaining('room_time_signature_updated'),
        expect.objectContaining({
          timeSignature: { numerator: 6, denominator: 8 },
        }),
      );
    });

    it('rejects denominator=16 with an error', async () => {
      setupOwnerAndState();

      await handler.handleTimeSignatureUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        numerator: 4,
        denominator: 16,
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.any(Object));
      expect(mockStateService.updateTimeSignature).not.toHaveBeenCalled();
    });

    it('accepts numerator=2 (expanded range)', async () => {
      setupOwnerAndState();
      mockStateService.updateTimeSignature.mockResolvedValue({
        ...makeBaseState(),
        timeSignature: { numerator: 2, denominator: 4 },
      });

      await handler.handleTimeSignatureUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        numerator: 2,
      });

      expect(mockStateService.updateTimeSignature).toHaveBeenCalledWith(TEST_ROOM_ID, 2, 4);
    });

    it('rejects numerator=13 (out of range)', async () => {
      setupOwnerAndState();

      await handler.handleTimeSignatureUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        numerator: 13,
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.any(Object));
      expect(mockStateService.updateTimeSignature).not.toHaveBeenCalled();
    });
  });

  describe('handleUserLeave', () => {
    // DEV-350 M4 Task 24: occupancy release replaces the old blanket
    // COMPANION_RELEASE_USER_LOCKS broadcast — OCCUPANCY_EVENTS.LEFT per held element now
    // covers it generically (mirrors ArrangeLockHandler.handleUserLeaveLocks).
    it('broadcasts LEFT for every element the leaving user held', async () => {
      const stateWithOccupancy = makeBaseState();
      stateWithOccupancy.occupancy.set('companion:volume', {
        kind: 'primitive',
        holders: [{ userId: TEST_USER_ID, username: TEST_USERNAME, joinedAt: 1 }],
      });
      mockStateService.getState.mockResolvedValue(stateWithOccupancy);
      mockStateService.removeUserState.mockResolvedValue(makeBaseState());
      mockStateService.removeVoiceState.mockResolvedValue(false);
      mockStateService.removeMemberBroadcastState.mockResolvedValue(null);

      await handler.handleUserLeave(TEST_ROOM_ID, TEST_USER_ID, mockNamespace);

      expect(mockNamespace.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockNamespace.emit).toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, {
        elementId: 'companion:volume',
        holders: [],
      });
    });

    it('broadcasts nothing occupancy-related when the leaving user held no elements', async () => {
      mockStateService.getState.mockResolvedValue(makeBaseState());
      mockStateService.removeUserState.mockResolvedValue(makeBaseState());
      mockStateService.removeVoiceState.mockResolvedValue(false);
      mockStateService.removeMemberBroadcastState.mockResolvedValue(null);

      await handler.handleUserLeave(TEST_ROOM_ID, TEST_USER_ID, mockNamespace);

      expect(mockNamespace.emit).not.toHaveBeenCalledWith(OCCUPANCY_EVENTS.LEFT, expect.anything());
    });

    // Review fix: occupancy release must not be able to strand the rest of leave cleanup
    // (FAILURE_PATTERNS: code gating a state reset). RoomOccupancyService.releaseAllForUser
    // can throw (Redis mutex lock-acquisition timeout, or a saveState Redis error); it must not
    // block removeUserState/removeVoiceState/removeMemberBroadcastState, and handleUserLeave
    // itself must not throw/reject.
    it('does not let an occupancy-release failure block user/voice/broadcast state cleanup', async () => {
      mockStateService.getState.mockRejectedValue(new Error('redis lock timeout'));
      mockStateService.removeUserState.mockResolvedValue(makeBaseState());
      mockStateService.removeVoiceState.mockResolvedValue(true);
      mockStateService.removeMemberBroadcastState.mockResolvedValue({ username: TEST_USERNAME, isActive: true });

      // Doesn't throw/reject even though the occupancy release rejects internally.
      await expect(handler.handleUserLeave(TEST_ROOM_ID, TEST_USER_ID, mockNamespace)).resolves.toBeUndefined();

      // The rest of leave cleanup still ran — the occupancy-release failure did not strand it.
      expect(mockStateService.removeUserState).toHaveBeenCalledWith(TEST_ROOM_ID, TEST_USER_ID);
      expect(mockStateService.removeVoiceState).toHaveBeenCalledWith(TEST_ROOM_ID, TEST_USER_ID);
      expect(mockStateService.removeMemberBroadcastState).toHaveBeenCalledWith(TEST_ROOM_ID, TEST_USER_ID);
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        expect.stringContaining('voice_state_changed'),
        expect.objectContaining({ userId: TEST_USER_ID, isMuted: true }),
      );
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        expect.stringContaining('member_broadcast_state_changed'),
        expect.objectContaining({ userId: TEST_USER_ID, isActive: false }),
      );
    });
  });

  // DEV-225: instrument selection must broadcast to the room so other members' HUDs update,
  // AND persist to main room state so late joiners see it. Covers the risk previously only in
  // e2e (realtime/instrument-selection.spec.ts "applies instrument and syncs status dynamically").
  describe('handleInstrumentChange', () => {
    it('persists and broadcasts perform:instrument_changed with the verified session identity', async () => {
      mockStateService.updateUserState.mockResolvedValue(makeBaseState());

      await handler.handleInstrumentChange(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        instrument: 'electric_bass_finger',
        category: 'sampler',
      });

      // Per-room state + main room state (so newly-joining users get the instrument on join).
      expect(mockStateService.updateUserState).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        expect.objectContaining({ currentInstrument: 'electric_bass_finger', currentCategory: 'sampler' }),
      );
      expect(mockMembershipService.updateUserInstrument).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        'electric_bass_finger',
        'sampler',
      );

      // Broadcast to the whole room — userId comes from the verified session, not the payload (TR-33).
      expect(mockNamespace.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        PERFORM_EVENTS.INSTRUMENT_CHANGED,
        expect.objectContaining({
          userId: TEST_USER_ID,
          instrument: 'electric_bass_finger',
          category: 'sampler',
        }),
      );
    });
  });

  // DEV-225: member-status fields carried on the perform user-state (practice mode, playing)
  // must broadcast to the room so other members' cards reflect them. Covers part of the risk
  // in e2e (realtime/room-member-status-sync.spec.ts). (Mic-mute/monitor-share ride the voice/
  // broadcast state paths, not this handler.)
  describe('handleUserStateUpdate', () => {
    it('broadcasts perform:user_state_updated with the verified userId + the changed fields', async () => {
      const state = makeBaseState();
      state.userStates.set(TEST_USER_ID, {
        userId: TEST_USER_ID,
        username: TEST_USERNAME,
        currentInstrument: 'piano',
        currentCategory: 'synth',
        effectChains: {},
        isInstrumentPracticing: false,
        isPlaying: false,
      });
      mockStateService.getState.mockResolvedValue(state);
      mockStateService.updateUserState.mockResolvedValue(state);

      await handler.handleUserStateUpdate(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        updates: { isInstrumentPracticing: true, isPlaying: true },
      });

      expect(mockStateService.updateUserState).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        { isInstrumentPracticing: true, isPlaying: true },
      );
      expect(mockNamespace.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        PERFORM_EVENTS.USER_STATE_UPDATED,
        expect.objectContaining({
          userId: TEST_USER_ID,
          updates: { isInstrumentPracticing: true, isPlaying: true },
        }),
      );
    });
  });

  // DEV-225 follow-up: shadow-capture (record-my-part) toggling must persist and broadcast to the
  // room so other members' cards show the recording indicator. Covers part of the member-status
  // risk in e2e (realtime/room-member-status-sync.spec.ts).
  describe('handleShadowCaptureStateChange', () => {
    it('persists and broadcasts perform:shadow_capture_state_changed with the verified userId', async () => {
      await handler.handleShadowCaptureStateChange(mockSocket, mockNamespace, {
        roomId: TEST_ROOM_ID,
        enabled: true,
      });

      expect(mockStateService.updateShadowCaptureState).toHaveBeenCalledWith(
        TEST_ROOM_ID,
        TEST_USER_ID,
        true,
      );
      expect(mockNamespace.to).toHaveBeenCalledWith(TEST_ROOM_ID);
      expect(mockNamespace.emit).toHaveBeenCalledWith(
        PERFORM_EVENTS.SHADOW_CAPTURE_STATE_CHANGED,
        expect.objectContaining({ userId: TEST_USER_ID, enabled: true }),
      );
    });
  });
});

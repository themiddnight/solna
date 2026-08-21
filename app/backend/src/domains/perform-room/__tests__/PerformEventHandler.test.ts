import { PerformEventHandler } from '../infrastructure/handlers/PerformEventHandler';
import { PERFORM_EVENTS, OCCUPANCY_EVENTS } from '@jam-band/shared';
import { checkSocketRateLimitAsync, checkSocketRateLimit } from '../../../middleware/rateLimit';
import type { PerformRoomHandler } from '../infrastructure/handlers/PerformRoomHandler';
import type { PerformBroadcastHandler } from '../../room-management/infrastructure/handlers/PerformBroadcastHandler';
import type { NotePlayingHandler } from '../../audio-processing/infrastructure/handlers/NotePlayingHandler';
import type { AudioRoutingHandler } from '../../audio-processing/infrastructure/handlers/AudioRoutingHandler';
import type { PerformCollaborationHandler } from '../../room-management/infrastructure/handlers/PerformCollaborationHandler';
import type { RoomMembershipHandler } from '../../room-management/infrastructure/handlers/RoomMembershipHandler';
import type { Socket, Namespace } from 'socket.io';

// Mock the rate limiter to bypass Redis/Map checks in tests
jest.mock('../../../middleware/rateLimit', () => ({
  checkSocketRateLimitAsync: jest.fn(),
  checkSocketRateLimit: jest.fn(),
}));

// Minimal typed mock for the socket – only the fields exercised by these tests
interface MockSocket {
  on: jest.Mock<ReturnType<Socket['on']>, Parameters<Socket['on']>>;
  emit: jest.Mock;
  id: string;
  handshake: { address: string; headers: Record<string, unknown> };
}

describe('PerformEventHandler - Event Routing & RoomId Injection', () => {
  const flushPromises = () => new Promise(resolve => setTimeout(resolve, 10));
  let performEventHandler: PerformEventHandler;
  let mockPerformRoomHandler: jest.Mocked<Pick<PerformRoomHandler,
    | 'handleInstrumentChange'
    | 'handleSynthParamsUpdate'
    | 'handleInstrumentParamsUpdate'
    | 'handleInstrumentParamsCommit'
    | 'handleEffectsChainUpdate'
    | 'handleUserStateUpdate'
    | 'handleRequestState'
    | 'handleCompanionBulkPresetUpdate'
    | 'handleCompanionPresetControlsUpdate'
    | 'handleOccupancyJoin'
    | 'handleOccupancyLeave'
    | 'handleOccupancyHeartbeat'
  >>;
  let mockSocket: MockSocket;
  let mockNamespace: Pick<Namespace, 'name'>;
  const TEST_ROOM_ID = 'test-room-123';

  beforeEach(() => {
    // Mock rate limiter return values (required because resetMocks: true is isConfigured)
    jest.mocked(checkSocketRateLimitAsync).mockResolvedValue({ allowed: true });
    jest.mocked(checkSocketRateLimit).mockReturnValue({ allowed: true });

    // Mock PerformRoomHandler
    mockPerformRoomHandler = {
      handleInstrumentChange: jest.fn(),
      handleSynthParamsUpdate: jest.fn(),
      handleInstrumentParamsUpdate: jest.fn(),
      handleInstrumentParamsCommit: jest.fn(),
      handleEffectsChainUpdate: jest.fn(),
      handleUserStateUpdate: jest.fn(),
      handleRequestState: jest.fn(),
      handleCompanionBulkPresetUpdate: jest.fn(),
      handleCompanionPresetControlsUpdate: jest.fn(),
      handleOccupancyJoin: jest.fn(),
      handleOccupancyLeave: jest.fn(),
      handleOccupancyHeartbeat: jest.fn(),
    };

    // Mock Socket
    mockSocket = {
      on: jest.fn<ReturnType<Socket['on']>, Parameters<Socket['on']>>(),
      emit: jest.fn(),
      id: 'socket-123',
      handshake: {
        address: '127.0.0.1',
        headers: {},
      },
    };

    // Mock Namespace
    mockNamespace = {
      name: `/room/${TEST_ROOM_ID}`,
    };

    // Create PerformEventHandler with mocked dependencies
    performEventHandler = new PerformEventHandler(
      mockPerformRoomHandler as unknown as PerformRoomHandler,
      {} as unknown as PerformBroadcastHandler,
      {} as unknown as NotePlayingHandler,
      {} as unknown as AudioRoutingHandler,
      {} as unknown as PerformCollaborationHandler,
      {} as unknown as RoomMembershipHandler,
    );
  });

  describe('RoomId Injection', () => {
    it('should inject roomId into CHANGE_INSTRUMENT event data', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      // Find the CHANGE_INSTRUMENT event listener
      const changeInstrumentCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === PERFORM_EVENTS.CHANGE_INSTRUMENT
      );
      expect(changeInstrumentCall).toBeDefined();

      const eventHandler = changeInstrumentCall![1] as (data: unknown) => void;
      const testData = { instrument: 'synth', category: 'synthesizer' };

      eventHandler(testData);
      await flushPromises();

      expect(mockPerformRoomHandler.handleInstrumentChange).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { ...testData, roomId: TEST_ROOM_ID }
      );
    });

    it('should inject roomId into UPDATE_SYNTH_PARAMS event data', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const synthParamsCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === PERFORM_EVENTS.UPDATE_SYNTH_PARAMS
      );
      expect(synthParamsCall).toBeDefined();

      const eventHandler = synthParamsCall![1] as (data: unknown) => void;
      const testData = { params: { oscillator: 'sine', envelope: { attack: 0.1 } } };

      eventHandler(testData);
      await flushPromises();

      expect(mockPerformRoomHandler.handleSynthParamsUpdate).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { ...testData, roomId: TEST_ROOM_ID }
      );
    });

    it('should inject roomId into UPDATE_INSTRUMENT_PARAMS event data (DEV-301)', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const instrumentParamsCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === PERFORM_EVENTS.UPDATE_INSTRUMENT_PARAMS
      );
      expect(instrumentParamsCall).toBeDefined();

      const eventHandler = instrumentParamsCall![1] as (data: unknown) => void;
      const testData = { params: { volume: -9 } };

      eventHandler(testData);
      await flushPromises();

      expect(mockPerformRoomHandler.handleInstrumentParamsUpdate).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { ...testData, roomId: TEST_ROOM_ID }
      );
    });

    it('should inject roomId into INSTRUMENT_PARAMS_COMMIT event data (DEV-301)', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const instrumentParamsCommitCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === PERFORM_EVENTS.INSTRUMENT_PARAMS_COMMIT
      );
      expect(instrumentParamsCommitCall).toBeDefined();

      const eventHandler = instrumentParamsCommitCall![1] as (data: unknown) => void;
      const testData = { params: { volume: -9 } };

      eventHandler(testData);
      await flushPromises();

      expect(mockPerformRoomHandler.handleInstrumentParamsCommit).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { ...testData, roomId: TEST_ROOM_ID }
      );
    });

    it('should inject roomId into UPDATE_EFFECTS_CHAIN event data', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const effectsChainCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === PERFORM_EVENTS.UPDATE_EFFECTS_CHAIN
      );
      expect(effectsChainCall).toBeDefined();

      const eventHandler = effectsChainCall![1] as (data: unknown) => void;
      const testData = { chains: { instrument: { type: 'instrument', effects: [] } } };

      eventHandler(testData);
      await flushPromises();

      expect(mockPerformRoomHandler.handleEffectsChainUpdate).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { ...testData, roomId: TEST_ROOM_ID }
      );
    });

    it('should inject roomId into user_state_update event data', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const userStateCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'perform:user_state_update'
      );
      expect(userStateCall).toBeDefined();

      const eventHandler = userStateCall![1] as (data: unknown) => void;
      const testData = { updates: { currentInstrument: 'piano' } };

      eventHandler(testData);
      await flushPromises();

      expect(mockPerformRoomHandler.handleUserStateUpdate).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { ...testData, roomId: TEST_ROOM_ID }
      );
    });

    it('should inject roomId into companion bulk preset update event data', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const companionBulkPresetCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === PERFORM_EVENTS.COMPANION_BULK_PRESET_UPDATE
      );
      expect(companionBulkPresetCall).toBeDefined();

      const eventHandler = companionBulkPresetCall![1] as (data: unknown) => void;
      const testData = { genrePreset: 'jazz', embellishmentIntensity: 2 };

      eventHandler(testData);
      await flushPromises();

      expect(mockPerformRoomHandler.handleCompanionBulkPresetUpdate).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { ...testData, roomId: TEST_ROOM_ID }
      );
    });

    it('should inject roomId into companion preset controls update event data', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const companionPresetControlsCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === PERFORM_EVENTS.COMPANION_PRESET_CONTROLS_UPDATE
      );
      expect(companionPresetControlsCall).toBeDefined();

      const eventHandler = companionPresetControlsCall![1] as (data: unknown) => void;
      const testData = { genrePreset: 'house', embellishmentIntensity: 3, overrideInstruments: true };

      eventHandler(testData);
      await flushPromises();

      expect(mockPerformRoomHandler.handleCompanionPresetControlsUpdate).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { ...testData, roomId: TEST_ROOM_ID }
      );
    });

    // Element occupancy (DEV-350 M4 Task 24) — replaces the old companion settings
    // lock/unlock roomId-injection tests above; same wiring shape, new event vocabulary.
    // occupancyJoinSchema/occupancyLeaveSchema require a UUID roomId (unlike the retired
    // performCompanionSettingsLockSchema), so these use a dedicated UUID room id.
    const OCCUPANCY_ROOM_ID = '123e4567-e89b-12d3-a456-426614174000';

    it('should validate and inject roomId into occupancy join event data', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, OCCUPANCY_ROOM_ID, mockNamespace as Namespace);

      const occupancyJoinCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === OCCUPANCY_EVENTS.JOIN
      );
      expect(occupancyJoinCall).toBeDefined();

      const eventHandler = occupancyJoinCall![1] as (data: unknown) => void;
      eventHandler({ elementId: 'companion:volume' });
      await flushPromises();

      expect(mockPerformRoomHandler.handleOccupancyJoin).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { elementId: 'companion:volume', roomId: OCCUPANCY_ROOM_ID }
      );
    });

    it('should validate and inject roomId into occupancy leave event data', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, OCCUPANCY_ROOM_ID, mockNamespace as Namespace);

      const occupancyLeaveCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === OCCUPANCY_EVENTS.LEAVE
      );
      expect(occupancyLeaveCall).toBeDefined();

      const eventHandler = occupancyLeaveCall![1] as (data: unknown) => void;
      eventHandler({ elementId: 'companion:volume' });
      await flushPromises();

      expect(mockPerformRoomHandler.handleOccupancyLeave).toHaveBeenCalledWith(
        mockSocket,
        mockNamespace,
        { elementId: 'companion:volume', roomId: OCCUPANCY_ROOM_ID }
      );
    });

    it('should reject an occupancy join payload with a non-UUID roomId', async () => {
      // TEST_ROOM_ID is deliberately non-UUID here, proving occupancyJoinSchema is enforced.
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const occupancyJoinCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === OCCUPANCY_EVENTS.JOIN
      );
      expect(occupancyJoinCall).toBeDefined();

      const eventHandler = occupancyJoinCall![1] as (data: unknown) => void;
      eventHandler({ elementId: 'companion:volume' });
      await flushPromises();

      expect(mockPerformRoomHandler.handleOccupancyJoin).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'INVALID_DATA_FORMAT' })
      );
    });
  });

  describe('Event Name Correctness', () => {
    it('should listen on correct event name for synth params (perform:update_synth_params)', () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const eventNames = mockSocket.on.mock.calls.map((call) => call[0]);

      // Should listen on 'perform:update_synth_params' (PERFORM_EVENTS.UPDATE_SYNTH_PARAMS)
      expect(eventNames).toContain(PERFORM_EVENTS.UPDATE_SYNTH_PARAMS);
      expect(PERFORM_EVENTS.UPDATE_SYNTH_PARAMS).toBe('perform:update_synth_params');

      // Should NOT listen on the old incorrect name
      expect(eventNames).not.toContain('perform:synth_params_update');
    });

    it('should listen on correct event names for instrument params (DEV-301)', () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const eventNames = mockSocket.on.mock.calls.map((call) => call[0]);

      expect(eventNames).toContain(PERFORM_EVENTS.UPDATE_INSTRUMENT_PARAMS);
      expect(PERFORM_EVENTS.UPDATE_INSTRUMENT_PARAMS).toBe('perform:update_instrument_params');
      expect(eventNames).toContain(PERFORM_EVENTS.INSTRUMENT_PARAMS_COMMIT);
      expect(PERFORM_EVENTS.INSTRUMENT_PARAMS_COMMIT).toBe('perform:instrument_params_commit');
    });

    it('should listen on correct event name for effects chain', () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const eventNames = mockSocket.on.mock.calls.map((call) => call[0]);

      expect(eventNames).toContain(PERFORM_EVENTS.UPDATE_EFFECTS_CHAIN);
      expect(PERFORM_EVENTS.UPDATE_EFFECTS_CHAIN).toBe('perform:update_effects_chain');
    });

    it('should listen on correct event name for instrument change', () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const eventNames = mockSocket.on.mock.calls.map((call) => call[0]);

      expect(eventNames).toContain(PERFORM_EVENTS.CHANGE_INSTRUMENT);
      expect(PERFORM_EVENTS.CHANGE_INSTRUMENT).toBe('perform:change_instrument');
    });
  });

  describe('Data Field Names', () => {
    it('should pass chains field (not effects) to handleEffectsChainUpdate', async () => {
      performEventHandler.handleConnection(mockSocket as unknown as Socket, TEST_ROOM_ID, mockNamespace as Namespace);

      const effectsChainCall = mockSocket.on.mock.calls.find(
        (call) => call[0] === PERFORM_EVENTS.UPDATE_EFFECTS_CHAIN
      );

      const eventHandler = effectsChainCall![1] as (data: unknown) => void;
      const testData = { chains: { instrument: { type: 'instrument', effects: [] } } };

      eventHandler(testData);
      await flushPromises();

      const callArgs = mockPerformRoomHandler.handleEffectsChainUpdate.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect(callArgs).toBeDefined();
      const passedData = callArgs[2];

      // Should have 'chains' field
      expect(passedData).toHaveProperty('chains');
      expect(passedData['chains']).toEqual(testData.chains);

      // Should NOT have 'effects' field (old incorrect name)
      expect(passedData).not.toHaveProperty('effects');
    });
  });
});

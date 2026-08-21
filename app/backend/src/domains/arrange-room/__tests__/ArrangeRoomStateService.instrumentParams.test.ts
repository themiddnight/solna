/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { RedisStateService, redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';

// Mock RedisStateService — mirrors ArrangeRoomStateService.test.ts's harness, but with a
// stateful get/set pair (instead of a fixed getter) so a real merge-and-persist round trip
// through Redis can be exercised across multiple updateInstrumentParams calls.
jest.mock('@/shared/infrastructure/caching/RedisStateService', () => ({
  RedisStateService: {
    getInstance: jest.fn(),
  },
  redisStateService: {
    executeWithLock: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  },
}));
jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logError: jest.fn(),
    logInfo: jest.fn(),
    logPerformanceMetric: jest.fn(),
  },
}));

describe('ArrangeRoomStateService.updateInstrumentParams', () => {
  let service: ArrangeRoomStateService;
  let mockRedisService: jest.Mocked<RedisStateService>;
  let storedState: Record<string, unknown> | null;

  const roomId = 'room-1';
  const trackId = 'track-1';

  const createMockState = () => ({
    roomId,
    roomType: 'arrange' as const,
    tracks: [],
    regions: [],
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    locks: [],
    selectedTrackId: null,
    selectedRegionIds: [],
    synthStates: {},
    effectChains: {},
    markers: [],
    voiceStates: {},
    broadcastStates: {},
    hasBeenSaved: false,
    lastUpdated: new Date().toISOString(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    storedState = createMockState();

    mockRedisService = {
      get: jest.fn().mockImplementation(async () => storedState),
      set: jest.fn().mockImplementation(async (_key: string, value: Record<string, unknown>) => {
        storedState = value;
        return true;
      }),
      delete: jest.fn().mockResolvedValue(true),
      exists: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<RedisStateService>;

    (RedisStateService.getInstance as jest.Mock).mockReturnValue(mockRedisService);

    // Mock redisStateService.executeWithLock to execute the operation directly (TR-2 mutex
    // is exercised structurally — the real lock isn't taken over Redis in this unit test).
    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<any>) => {
        return await operation();
      }
    );

    service = new ArrangeRoomStateService();
  });

  it('merges into existing state under the room mutex', async () => {
    await service.updateInstrumentParams(roomId, trackId, { volume: -6 });

    const state = await service.getState(roomId);
    expect(state?.instrumentParamsStates?.[trackId]).toEqual({ volume: -6 });
    // Confirms it actually persisted to Redis (not just mutated an in-memory object) —
    // set() must have been called with the mutated state.
    expect(mockRedisService.set).toHaveBeenCalledTimes(1);
  });

  it('merges partial updates onto existing per-track params without clobbering other keys', async () => {
    await service.updateInstrumentParams(roomId, trackId, { volume: -6 });
    await service.updateInstrumentParams(roomId, trackId, { pan: 0.5 });

    const state = await service.getState(roomId);
    expect(state?.instrumentParamsStates?.[trackId]).toEqual({ volume: -6, pan: 0.5 });
  });

  it('does not clobber other tracks instrumentParamsStates', async () => {
    await service.updateInstrumentParams(roomId, 'track-other', { volume: -3 });
    await service.updateInstrumentParams(roomId, trackId, { volume: -6 });

    const state = await service.getState(roomId);
    expect(state?.instrumentParamsStates?.['track-other']).toEqual({ volume: -3 });
    expect(state?.instrumentParamsStates?.[trackId]).toEqual({ volume: -6 });
  });
});

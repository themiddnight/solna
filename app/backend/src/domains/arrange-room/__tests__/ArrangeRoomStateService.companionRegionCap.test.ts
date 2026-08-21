/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
/**
 * DEV-279 P2 Task 2.9 — soft cap of `ARRANGE_CONSTANTS.MAX_COMPANION_REGIONS_PER_PROJECT`
 * (10) companion regions per project. 1 project = 1 active Arrange Room (BR-1), so a
 * room-wide count IS the project count.
 *
 * The cap is enforced inside `addRegionToState` (ArrangeRoomStateMutations), which throws
 * BEFORE `ArrangeRoomStateService.addRegion` ever calls `saveMutatedState` — mirrors the
 * existing hard room-wide track cap (`MAX_TRACKS_PER_ROOM` in `addTrackToState`). Mocking
 * harness mirrors `ArrangeRoomStateService.companionRegionConfig.test.ts` (Redis fully
 * mocked; `executeWithLock` bypassed to run the real mutation function directly).
 */
import { RedisStateService, redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import { ARRANGE_CONSTANTS, DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared';
import { toDecibels } from '../domain/models/ArrangeRoomState';
import type { CompanionRegion, MidiRegion, Region } from '../domain/models/ArrangeRoomState';

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

describe('ArrangeRoomStateService — companion region cap (DEV-279 P2 Task 2.9)', () => {
  const CAP = ARRANGE_CONSTANTS.MAX_COMPANION_REGIONS_PER_PROJECT;
  let service: ArrangeRoomStateService;
  let mockRedisService: jest.Mocked<RedisStateService>;

  function companionRegion(id: string): CompanionRegion {
    return {
      id,
      trackId: 'track-1',
      name: `Companion ${id}`,
      start: 0,
      length: 16,
      loopEnabled: false,
      loopIterations: 1,
      type: 'companion',
      config: {
        style: 'block',
        density: 'normal',
        volume: toDecibels(DEFAULT_COMPANION_VOLUME_DB),
        isMuted: false,
      },
    };
  }

  function midiRegion(id: string): MidiRegion {
    return {
      id,
      trackId: 'track-1',
      name: `Midi ${id}`,
      start: 0,
      length: 4,
      loopEnabled: false,
      loopIterations: 1,
      type: 'midi',
      notes: [],
      sustainEvents: [],
    };
  }

  function createMockState(regions: Region[]) {
    return {
      roomId: 'room-1',
      roomType: 'arrange' as const,
      tracks: [{ id: 'track-1', regionIds: regions.map((r) => r.id) }],
      regions,
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      locks: [],
      selectedTrackId: null,
      selectedRegionIds: [],
      synthStates: {},
      effectChains: {},
      markers: [],
      chordTrack: { id: 'ct-1', projectId: 'proj-1', blocks: [] },
      voiceStates: {},
      broadcastStates: {},
      hasBeenSaved: false,
      lastUpdated: new Date().toISOString(),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true),
      exists: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<RedisStateService>;

    (RedisStateService.getInstance as jest.Mock).mockReturnValue(mockRedisService);

    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<any>) => {
        return await operation();
      },
    );

    service = new ArrangeRoomStateService();
  });

  it('allows adding the 10th companion region (at the cap, not over it)', async () => {
    const existing = Array.from({ length: CAP - 1 }, (_, i) => companionRegion(`c${i}`));
    mockRedisService.get.mockResolvedValue(createMockState(existing));

    const tenth = companionRegion('c-tenth');
    const updated = await service.addRegion('room-1', tenth);

    expect(updated.regions.filter((r) => r.type === 'companion')).toHaveLength(CAP);
    expect(mockRedisService.set).toHaveBeenCalled();
  });

  it('rejects the 11th companion region and does not write to Redis', async () => {
    const existing = Array.from({ length: CAP }, (_, i) => companionRegion(`c${i}`));
    mockRedisService.get.mockResolvedValue(createMockState(existing));

    const eleventh = companionRegion('c-eleventh');

    await expect(service.addRegion('room-1', eleventh)).rejects.toThrow(
      /Maximum companion regions/,
    );
    expect(mockRedisService.set).not.toHaveBeenCalled();
  });

  it('does not count midi/audio regions toward the companion cap', async () => {
    const existing: Region[] = [
      ...Array.from({ length: CAP }, (_, i) => companionRegion(`c${i}`)),
      midiRegion('m1'),
    ];
    mockRedisService.get.mockResolvedValue(createMockState(existing));

    // Adding another MIDI region is unaffected by the companion cap.
    const updated = await service.addRegion('room-1', midiRegion('m2'));

    expect(updated.regions.filter((r) => r.type === 'midi')).toHaveLength(2);
    expect(mockRedisService.set).toHaveBeenCalled();
  });
});

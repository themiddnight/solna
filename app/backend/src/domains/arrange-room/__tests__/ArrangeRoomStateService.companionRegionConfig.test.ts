/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
/**
 * DEV-279 P2 Task 2.8 — `ArrangeRoomStateService.updateCompanionRegionConfig`
 * field-merges a companion config PATCH into the region's EXISTING config
 * under the per-room mutex (TR-2), rather than the flat-clobber
 * `updateRegionInState`/`updateRegion` path would produce (see
 * `updateCompanionRegionConfigInState`'s doc comment).
 *
 * Mirrors the mocking harness in `ArrangeRoomStateService.chordTrack.test.ts`
 * (Redis fully mocked; `executeWithLock` bypassed to run the operation
 * directly) — exercises the real `updateCompanionRegionConfigInState`
 * mutation function, not a stub.
 */
import { RedisStateService, redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import { toDecibels } from '../domain/models/ArrangeRoomState';
import type { CompanionRegion, MidiRegion } from '../domain/models/ArrangeRoomState';
import { DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared';

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

describe('ArrangeRoomStateService — updateCompanionRegionConfig (DEV-279 P2)', () => {
  let service: ArrangeRoomStateService;
  let mockRedisService: jest.Mocked<RedisStateService>;

  function companionRegion(overrides: Partial<CompanionRegion> = {}): CompanionRegion {
    return {
      id: 'companion-1',
      trackId: 'track-1',
      name: 'Companion',
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
        chordComplexity: 'seventh',
      },
      ...overrides,
    };
  }

  function createMockState(regions: (CompanionRegion | MidiRegion)[]) {
    return {
      roomId: 'room-1',
      roomType: 'arrange' as const,
      tracks: [],
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

  it('field-merges the patch — other config fields survive (proves field-merge, not flat-clobber)', async () => {
    const region = companionRegion();
    mockRedisService.get.mockResolvedValue(createMockState([region]));

    const updated = await service.updateCompanionRegionConfig('room-1', 'companion-1', { style: 'broken' });

    const updatedRegion = updated.regions.find((r) => r.id === 'companion-1') as CompanionRegion;
    expect(updatedRegion.config.style).toBe('broken');
    // Untouched fields survive — a flat `{ ...region, ...updates }` merge would
    // have replaced `config` wholesale with just `{ style: 'broken' }`.
    expect(updatedRegion.config.density).toBe('normal');
    expect(updatedRegion.config.volume).toBe(DEFAULT_COMPANION_VOLUME_DB);
    expect(updatedRegion.config.isMuted).toBe(false);
    expect(updatedRegion.config.chordComplexity).toBe('seventh');
    expect(mockRedisService.set).toHaveBeenCalled();
  });

  it('leaves other regions untouched', async () => {
    const target = companionRegion({ id: 'companion-a' });
    const other = companionRegion({ id: 'companion-b', config: { ...companionRegion().config, style: 'strum' } });
    mockRedisService.get.mockResolvedValue(createMockState([target, other]));

    const updated = await service.updateCompanionRegionConfig('room-1', 'companion-a', { volume: toDecibels(-8) });

    const updatedOther = updated.regions.find((r) => r.id === 'companion-b') as CompanionRegion;
    expect(updatedOther.config).toEqual(other.config);
  });

  it('is a no-op (no throw, unchanged state) when the region does not exist', async () => {
    mockRedisService.get.mockResolvedValue(createMockState([companionRegion()]));

    const updated = await service.updateCompanionRegionConfig('room-1', 'does-not-exist', { style: 'broken' });

    expect(updated.regions).toHaveLength(1);
    expect((updated.regions[0] as CompanionRegion).config.style).toBe('block');
  });

  it('is a no-op when the target region is not type "companion"', async () => {
    const midiRegion: MidiRegion = {
      id: 'midi-1',
      trackId: 'track-1',
      name: 'Midi',
      start: 0,
      length: 4,
      loopEnabled: false,
      loopIterations: 1,
      type: 'midi',
      notes: [],
      sustainEvents: [],
    };
    mockRedisService.get.mockResolvedValue(createMockState([midiRegion]));

    const updated = await service.updateCompanionRegionConfig('room-1', 'midi-1', { style: 'broken' } as never);

    expect(updated.regions[0]).toEqual(midiRegion);
  });
});

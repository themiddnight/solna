/**
 * DEV-279 Phase 3 Task 3.3a — `ArrangeRoomStateService.convertCompanionToMidi` /
 * `.revertMidiToCompanion` transform a region IN PLACE (same `id`, same track):
 * convert replaces a companion region with a MIDI region carrying the
 * pre-rendered `notes` + `companionMetadata`; revert replaces a converted MIDI
 * region with a companion region built from `companionMetadata.config`,
 * dropping notes.
 *
 * Mirrors the mocking harness in `ArrangeRoomStateService.companionRegionConfig.test.ts`
 * (Redis fully mocked; `executeWithLock` bypassed to run the operation directly) —
 * exercises the real mutation functions, not stubs.
 */
import { RedisStateService, redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import { toDecibels } from '../domain/models/ArrangeRoomState';
import type { CompanionRegion, MidiRegion, CompanionRegionMetadata } from '../domain/models/ArrangeRoomState';
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

describe('ArrangeRoomStateService — convertCompanionToMidi / revertMidiToCompanion (DEV-279 P3)', () => {
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

  function midiRegion(overrides: Partial<MidiRegion> = {}): MidiRegion {
    return {
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
      ...overrides,
    };
  }

  function metadata(overrides: Partial<CompanionRegionMetadata> = {}): CompanionRegionMetadata {
    return {
      config: companionRegion().config,
      chordTrackSnapshot: [],
      convertedAt: '2026-07-27T00:00:00.000Z',
      ...overrides,
    };
  }

  function createMockState(regions: (CompanionRegion | MidiRegion)[], tracks: { id: string; regionIds: string[]; instrumentId?: string }[] = []) {
    return {
      roomId: 'room-1',
      roomType: 'arrange' as const,
      tracks,
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
      async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<unknown>) => {
        return await operation();
      },
    );

    service = new ArrangeRoomStateService();
  });

  describe('convertCompanionToMidi', () => {
    it('replaces the companion region with a MIDI region carrying pre-rendered notes + companionMetadata, same id, same track', async () => {
      const region = companionRegion();
      const track = { id: 'track-1', regionIds: ['companion-1'] };
      mockRedisService.get.mockResolvedValue(createMockState([region], [track]));

      const notes = [{ id: 'n1', pitch: 60, velocity: 100, start: 0, duration: 1 }];
      const meta = metadata();

      const updated = await service.convertCompanionToMidi('room-1', 'companion-1', notes, meta);

      const updatedRegion = updated.regions.find((r) => r.id === 'companion-1') as MidiRegion;
      expect(updatedRegion.type).toBe('midi');
      expect(updatedRegion.notes).toEqual(notes);
      expect(updatedRegion.sustainEvents).toEqual([]);
      expect(updatedRegion.companionMetadata).toEqual(meta);
      expect(updatedRegion.trackId).toBe('track-1');
      // Base fields preserved
      expect(updatedRegion.name).toBe('Companion');
      expect(updatedRegion.start).toBe(0);
      expect(updatedRegion.length).toBe(16);
      // config dropped (not part of MidiRegion)
      expect((updatedRegion as unknown as CompanionRegion).config).toBeUndefined();
      // Region stays on its track, not removed/re-added
      const updatedTrack = updated.tracks.find((t) => t.id === 'track-1');
      expect(updatedTrack?.regionIds).toEqual(['companion-1']);
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('is a no-op (state unchanged) when the region does not exist', async () => {
      mockRedisService.get.mockResolvedValue(createMockState([companionRegion()]));

      const updated = await service.convertCompanionToMidi('room-1', 'does-not-exist', [], metadata());

      expect(updated.regions).toHaveLength(1);
      expect(updated.regions[0]?.type).toBe('companion');
    });

    it('is a no-op when the target region is not type "companion"', async () => {
      const region = midiRegion();
      mockRedisService.get.mockResolvedValue(createMockState([region]));

      const updated = await service.convertCompanionToMidi('room-1', 'midi-1', [], metadata());

      expect(updated.regions[0]).toEqual(region);
    });
  });

  describe('revertMidiToCompanion', () => {
    it('replaces a converted MIDI region with a companion region whose config equals companionMetadata.config, dropping notes', async () => {
      const meta = metadata({ config: { style: 'broken', density: 'dense', volume: toDecibels(-2), isMuted: true } });
      const region = midiRegion({
        id: 'midi-1',
        notes: [{ id: 'n1', pitch: 60, velocity: 100, start: 0, duration: 1 }],
        companionMetadata: meta,
      });
      const track = { id: 'track-1', regionIds: ['midi-1'] };
      mockRedisService.get.mockResolvedValue(createMockState([region], [track]));

      const updated = await service.revertMidiToCompanion('room-1', 'midi-1');

      const updatedRegion = updated.regions.find((r) => r.id === 'midi-1') as CompanionRegion;
      expect(updatedRegion.type).toBe('companion');
      expect(updatedRegion.config).toEqual(meta.config);
      expect((updatedRegion as unknown as MidiRegion).notes).toBeUndefined();
      expect((updatedRegion as unknown as MidiRegion).sustainEvents).toBeUndefined();
      expect((updatedRegion as unknown as MidiRegion).companionMetadata).toBeUndefined();
      expect(updatedRegion.trackId).toBe('track-1');
      const updatedTrack = updated.tracks.find((t) => t.id === 'track-1');
      expect(updatedTrack?.regionIds).toEqual(['midi-1']);
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('is a no-op (state unchanged) when the region does not exist', async () => {
      mockRedisService.get.mockResolvedValue(createMockState([midiRegion({ companionMetadata: metadata() })]));

      const updated = await service.revertMidiToCompanion('room-1', 'does-not-exist');

      expect(updated.regions).toHaveLength(1);
    });

    it('is a no-op when the target region is not type "midi"', async () => {
      const region = companionRegion();
      mockRedisService.get.mockResolvedValue(createMockState([region]));

      const updated = await service.revertMidiToCompanion('room-1', 'companion-1');

      expect(updated.regions[0]).toEqual(region);
    });

    it('reverts a plain MIDI region (no companionMetadata) to a companion with a role-default config derived from the track instrument', async () => {
      const region = midiRegion({
        id: 'midi-1',
        notes: [{ id: 'n1', pitch: 60, velocity: 100, start: 0, duration: 1 }],
      });
      // A bass instrument on the track → derived role 'bass' → role-default config.
      const track = { id: 'track-1', regionIds: ['midi-1'], instrumentId: 'electric-bass' };
      mockRedisService.get.mockResolvedValue(createMockState([region], [track]));

      const updated = await service.revertMidiToCompanion('room-1', 'midi-1');

      const updatedRegion = updated.regions.find((r) => r.id === 'midi-1') as CompanionRegion;
      expect(updatedRegion.type).toBe('companion');
      expect(updatedRegion.config).toEqual({
        style: 'root-fifth',
        density: 'normal',
        // DEV-304: server-derived default (createDefaultCompanionConfig) is
        // DEFAULT_COMPANION_VOLUME_DB for every role, not the pre-migration 70% literal —
        // a stale assertion here would silently pass type-check but fail at runtime.
        volume: DEFAULT_COMPANION_VOLUME_DB,
        isMuted: false,
      });
      expect((updatedRegion as unknown as MidiRegion).notes).toBeUndefined();
      expect((updatedRegion as unknown as MidiRegion).companionMetadata).toBeUndefined();
      expect(updatedRegion.trackId).toBe('track-1');
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('falls back to the chord role default when the track has no instrument', async () => {
      const region = midiRegion({ id: 'midi-1' });
      const track = { id: 'track-1', regionIds: ['midi-1'] };
      mockRedisService.get.mockResolvedValue(createMockState([region], [track]));

      const updated = await service.revertMidiToCompanion('room-1', 'midi-1');

      const updatedRegion = updated.regions.find((r) => r.id === 'midi-1') as CompanionRegion;
      expect(updatedRegion.type).toBe('companion');
      // deriveRoleFromInstrument('') → 'chord' → style 'block'.
      expect(updatedRegion.config.style).toBe('block');
    });

    it('throws (and leaves state unchanged) when reverting would push live companion regions past the soft cap (review fix round 1)', async () => {
      // 10 existing companion regions (the cap) + the midi region being reverted.
      // The midi region is NOT itself a companion region yet, so reverting it would
      // create the 11th — the cap check must reject this.
      const companions = Array.from({ length: 10 }, (_, index) => companionRegion({ id: `companion-${index}` }));
      const region = midiRegion({ id: 'midi-1', companionMetadata: metadata() });
      mockRedisService.get.mockResolvedValue(createMockState([...companions, region]));

      await expect(service.revertMidiToCompanion('room-1', 'midi-1')).rejects.toThrow(
        'Maximum companion regions (10) reached for room: room-1',
      );

      expect(mockRedisService.set).not.toHaveBeenCalled();
    });
  });
});

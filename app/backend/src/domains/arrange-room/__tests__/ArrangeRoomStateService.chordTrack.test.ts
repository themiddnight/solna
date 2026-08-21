/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
/**
 * DEV-279 Phase 1 Task 1.6 — `ArrangeRoomStateService.addChordBlock/updateChordBlock/
 * removeChordBlock` mutate `chordTrack.blocks` under the same per-room mutex
 * (`room-state-mutex:{roomId}`, TR-2) as every other RMW method on this service.
 *
 * Mirrors the mocking harness in `ArrangeRoomStateService.test.ts` (Redis fully mocked;
 * `executeWithLock` bypassed to run the operation directly) — this exercises the real
 * `addChordBlockToState` / `updateChordBlockInState` / `removeChordBlockFromState`
 * mutation functions from `ArrangeRoomStateMutations.ts`, not a stub.
 */
import { RedisStateService, redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { ArrangeRoomStateService } from '../application/ArrangeRoomStateService';
import type { ChordBlock } from '@jam-band/shared';

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

describe('ArrangeRoomStateService — chord block operations (DEV-279 P1)', () => {
  let service: ArrangeRoomStateService;
  let mockRedisService: jest.Mocked<RedisStateService>;

  const createMockState = (blocks: ChordBlock[] = []) => ({
    roomId: 'room-1',
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
    chordTrack: { id: 'ct-1', projectId: 'proj-1', blocks },
    voiceStates: {},
    broadcastStates: {},
    hasBeenSaved: false,
    lastUpdated: new Date().toISOString(),
  });

  const diatonicBlock = (overrides: Partial<ChordBlock> = {}): ChordBlock => ({
    id: 'block-1',
    start: 0,
    duration: 4,
    chord: { kind: 'diatonic', degree: 1 },
    color: '#3b82f6',
    ...overrides,
  });

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
      }
    );

    service = new ArrangeRoomStateService();
  });

  describe('addChordBlock', () => {
    it('appends the block to chordTrack.blocks and persists to Redis', async () => {
      mockRedisService.get.mockResolvedValue(createMockState());

      const block = diatonicBlock();
      const updated = await service.addChordBlock('room-1', block);

      expect(updated.chordTrack.blocks).toHaveLength(1);
      expect(updated.chordTrack.blocks[0]).toEqual(block);
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('preserves existing blocks when adding another', async () => {
      const existing = diatonicBlock({ id: 'block-existing' });
      mockRedisService.get.mockResolvedValue(createMockState([existing]));

      const newBlock = diatonicBlock({ id: 'block-new', start: 4 });
      const updated = await service.addChordBlock('room-1', newBlock);

      expect(updated.chordTrack.blocks.map((b) => b.id)).toEqual(['block-existing', 'block-new']);
    });
  });

  describe('updateChordBlock', () => {
    it('merges updates into the matching block only', async () => {
      const target = diatonicBlock({ id: 'block-a' });
      const other = diatonicBlock({ id: 'block-b', start: 8 });
      mockRedisService.get.mockResolvedValue(createMockState([target, other]));

      const updated = await service.updateChordBlock('room-1', 'block-a', {
        chord: { kind: 'borrowed', semitones: 3, quality: 'min' },
      });

      const updatedTarget = updated.chordTrack.blocks.find((b) => b.id === 'block-a');
      const untouchedOther = updated.chordTrack.blocks.find((b) => b.id === 'block-b');

      expect(updatedTarget?.chord).toEqual({ kind: 'borrowed', semitones: 3, quality: 'min' });
      expect(untouchedOther).toEqual(other);
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('updates start (used by drag commit)', async () => {
      mockRedisService.get.mockResolvedValue(createMockState([diatonicBlock()]));

      const updated = await service.updateChordBlock('room-1', 'block-1', { start: 12 });

      expect(updated.chordTrack.blocks[0]?.start).toBe(12);
    });
  });

  describe('removeChordBlock', () => {
    it('removes the matching block and leaves the rest untouched', async () => {
      const toRemove = diatonicBlock({ id: 'block-remove' });
      const toKeep = diatonicBlock({ id: 'block-keep', start: 4 });
      mockRedisService.get.mockResolvedValue(createMockState([toRemove, toKeep]));

      const updated = await service.removeChordBlock('room-1', 'block-remove');

      expect(updated.chordTrack.blocks).toHaveLength(1);
      expect(updated.chordTrack.blocks[0]?.id).toBe('block-keep');
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('is a no-op when the block id does not exist', async () => {
      const existing = diatonicBlock();
      mockRedisService.get.mockResolvedValue(createMockState([existing]));

      const updated = await service.removeChordBlock('room-1', 'does-not-exist');

      expect(updated.chordTrack.blocks).toEqual([existing]);
    });
  });

  describe('mutex usage (TR-2)', () => {
    it('addChordBlock uses the per-room state mutex', async () => {
      mockRedisService.get.mockResolvedValue(createMockState());
      await service.addChordBlock('room-1', diatonicBlock());

      expect(redisStateService.executeWithLock).toHaveBeenCalledWith(
        'room-state-mutex:room-1',
        expect.any(Number),
        expect.any(Number),
        expect.any(Function),
      );
    });

    it('updateChordBlock uses the per-room state mutex', async () => {
      mockRedisService.get.mockResolvedValue(createMockState([diatonicBlock()]));
      await service.updateChordBlock('room-1', 'block-1', { start: 4 });

      expect(redisStateService.executeWithLock).toHaveBeenCalledWith(
        'room-state-mutex:room-1',
        expect.any(Number),
        expect.any(Number),
        expect.any(Function),
      );
    });

    it('removeChordBlock uses the per-room state mutex', async () => {
      mockRedisService.get.mockResolvedValue(createMockState([diatonicBlock()]));
      await service.removeChordBlock('room-1', 'block-1');

      expect(redisStateService.executeWithLock).toHaveBeenCalledWith(
        'room-state-mutex:room-1',
        expect.any(Number),
        expect.any(Number),
        expect.any(Function),
      );
    });
  });

  // DEV-279 P1 Task 1.12 — undo/redo's FULL_STATE_UPDATE replaces chordTrack.blocks
  // the same way it replaces tracks/regions/markers, but must preserve the
  // chordTrack's own id/projectId (only `blocks` comes over the wire, mirroring
  // the addChordBlockToState/etc. mutation shape-in/shape-out contract above).
  describe('setFullState — includes chordTrack (DEV-279 P1)', () => {
    it('replaces chordTrack.blocks while preserving chordTrack id/projectId', async () => {
      const existing = diatonicBlock({ id: 'existing' });
      mockRedisService.get.mockResolvedValue(createMockState([existing]));

      const newBlocks = [diatonicBlock({ id: 'new-1' }), diatonicBlock({ id: 'new-2', start: 4 })];
      const updated = await service.setFullState('room-1', {
        tracks: [],
        regions: [],
        markers: [],
        chordTrack: newBlocks,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
      });

      expect(updated.chordTrack.blocks).toEqual(newBlocks);
      expect(updated.chordTrack.id).toBe('ct-1');
      expect(updated.chordTrack.projectId).toBe('proj-1');
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('sets chordTrack.blocks to empty when the payload has no blocks', async () => {
      mockRedisService.get.mockResolvedValue(createMockState([diatonicBlock()]));

      const updated = await service.setFullState('room-1', {
        tracks: [],
        regions: [],
        markers: [],
        chordTrack: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
      });

      expect(updated.chordTrack.blocks).toEqual([]);
    });

    it('uses the per-room state mutex', async () => {
      mockRedisService.get.mockResolvedValue(createMockState());
      await service.setFullState('room-1', {
        tracks: [],
        regions: [],
        markers: [],
        chordTrack: [],
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
      });

      expect(redisStateService.executeWithLock).toHaveBeenCalledWith(
        'room-state-mutex:room-1',
        expect.any(Number),
        expect.any(Number),
        expect.any(Function),
      );
    });
  });
});

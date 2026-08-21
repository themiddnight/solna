/**
 * DEV-225: RoomLifecycleService.getAllRooms must exclude hidden (BR-4) and isolated
 * (DEV-221 onboarding-tour) rooms from the lobby list — they are reachable only by
 * invite/direct URL, never advertised. Covers the risk previously only in e2e
 * (auth/lobby.spec.ts "hidden rooms do not appear" + room-lifecycle/tour-room-isolation).
 */
import { RoomLifecycleService } from '../application/RoomLifecycleService';
import { CacheService } from '@/shared/infrastructure/caching/CacheService';
import { createPartialMock } from '@/testing/mocks';
import { RoomType, type Room } from '../../../types';
import type { RoomRepository } from '../infrastructure/repositories/RoomRepository';
import type { RoomCleanupService } from '../domain/services/RoomCleanupService';
import type { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import type { RoomUserService } from '../domain/services/RoomUserService';
import type { RoomSettingsService } from '../infrastructure/services/RoomSettingsService';
import type { EffectChainService } from '../../audio-processing/infrastructure/services/EffectChainService';
import type { NamespaceGracePeriodManager } from '../../../shared/infrastructure/namespace/NamespaceGracePeriodManager';
import type { ArrangeRoomStateService } from '../../arrange-room/application/ArrangeRoomStateService';

// CacheService is a singleton read at field-init time; stub the list cache to always miss
// so getAllRooms takes the repository path.
jest.mock('@/shared/infrastructure/caching/CacheService', () => {
  const mockInstance = {
    getCachedRoomList: jest.fn(() => null),
    cacheRoomList: jest.fn(),
  };
  return { CacheService: { getInstance: jest.fn(() => mockInstance) } };
});

const makeRoom = (overrides: Partial<Room> = {}): Room => ({
  id: 'room-x',
  name: 'Room',
  owner: 'owner-1',
  roomType: RoomType.PERFORM,
  bandMembers: new Map(),
  audiences: new Map(),
  pendingMembers: new Map(),
  isPrivate: false,
  isHidden: false,
  isIsolated: false,
  // Recent so a room with no registered occupants still stays visible during the
  // creation grace period (otherwise getAllRooms drops 0-occupant rooms).
  createdAt: new Date(),
  metronome: { bpm: 120, beatZeroAt: Date.now() },
  ...overrides,
});

describe('RoomLifecycleService.getAllRooms — hidden/isolated exclusion (DEV-225)', () => {
  let service: RoomLifecycleService;
  let mockRoomRepository: jest.Mocked<RoomRepository>;

  beforeEach(() => {
    jest.clearAllMocks();

    // The jest config resets mock implementations between tests, so (re)wire the
    // singleton's list-cache to always miss → getAllRooms takes the repository path.
    (CacheService.getInstance as jest.Mock).mockReturnValue(
      createPartialMock<CacheService>({
        getCachedRoomList: jest.fn((_key: string): unknown[] | undefined => undefined),
      }),
    );

    mockRoomRepository = createPartialMock<RoomRepository>({
      getAllRooms: jest.fn(),
      cacheRoomList: jest.fn(),
    });

    service = new RoomLifecycleService(
      mockRoomRepository,
      createPartialMock<RoomCleanupService>({ hasUserIntentionallyLeft: jest.fn() }),
      createPartialMock<RoomSessionManager>({ isUserActiveInRoom: jest.fn() }),
      createPartialMock<NamespaceGracePeriodManager>({ isUserInGracePeriod: jest.fn() }),
      createPartialMock<ArrangeRoomStateService>({}),
      createPartialMock<EffectChainService>({}),
      createPartialMock<RoomUserService>({
        getBandMembers: jest.fn().mockResolvedValue([]),
        getAudiences: jest.fn().mockResolvedValue([]),
      }),
      createPartialMock<RoomSettingsService>({}),
    );
  });

  it('excludes hidden and isolated rooms but keeps a normal room', async () => {
    mockRoomRepository.getAllRooms.mockResolvedValue([
      makeRoom({ id: 'normal-1' }),
      makeRoom({ id: 'hidden-1', isHidden: true }),
      makeRoom({ id: 'isolated-1', isIsolated: true }),
    ]);

    const rooms = await service.getAllRooms(false);
    const ids = rooms.map((r) => (r as { id: string }).id);

    expect(ids).toContain('normal-1');
    expect(ids).not.toContain('hidden-1');
    expect(ids).not.toContain('isolated-1');
  });

  it('excludes a room that is BOTH hidden and isolated', async () => {
    mockRoomRepository.getAllRooms.mockResolvedValue([
      makeRoom({ id: 'normal-2' }),
      makeRoom({ id: 'tour-1', isHidden: true, isIsolated: true }),
    ]);

    const rooms = await service.getAllRooms(false);
    const ids = rooms.map((r) => (r as { id: string }).id);

    expect(ids).toEqual(['normal-2']);
  });
});

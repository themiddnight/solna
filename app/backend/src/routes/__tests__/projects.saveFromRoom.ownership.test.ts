import { describe, it, expect, beforeEach, afterEach, afterAll } from '@jest/globals';
import { prisma } from '../../config/prisma';
import { UserType as PrismaUserType } from '@prisma/client';
import { getRedisClient, closeRedisConnections } from '../../config/redis';
import { ArrangeRoomStateService } from '../../domains/arrange-room/application/ArrangeRoomStateService';
import { ProjectApplicationService } from '../../domains/arrange-room/application/ProjectApplicationService';
import { RoomRepository } from '../../domains/room-management/infrastructure/repositories/RoomRepository';
import type { Room } from '../../types';
import { RoomType } from '../../types';
import { REDIS_KEYS } from '../../shared/constants/RedisKeys';
import { getProjectLimit, UserType } from '@jam-band/shared';

jest.mock('../../domains/arrange-room/infrastructure/storage/ProjectStorageService', () => ({
  projectStorageService: {
    loadProjectFiles: jest.fn().mockResolvedValue({ projectJson: '{}', audioFiles: [] }),
    deleteProjectFiles: jest.fn().mockResolvedValue(undefined),
    saveProjectFiles: jest.fn().mockResolvedValue(undefined),
    replaceProjectFilesSafely: jest.fn().mockResolvedValue(undefined),
  },
}));
// Stub the heavy room→project serialization so the test exercises ownership logic only.
jest.mock('../../domains/arrange-room/domain/services/ProjectSaveService', () => ({
  ProjectSaveService: jest.fn().mockImplementation(() => ({
    saveProjectFromRoom: jest.fn().mockResolvedValue(undefined),
  })),
}));

const service = new ProjectApplicationService();
const roomRepo = new RoomRepository();
let arrangeRoomStateService: ArrangeRoomStateService;

async function makeUser(overrides: Partial<{ userType: PrismaUserType; emailVerified: boolean }> = {}) {
  return prisma.user.create({
    data: {
      email: `t-${Date.now()}-${Math.random()}@e.com`,
      username: `u-${Date.now()}-${Math.random()}`.slice(0, 30),
      passwordHash: 'x',
      userType: overrides.userType ?? PrismaUserType.REGISTERED,
      emailVerified: overrides.emailVerified ?? true,
    },
  });
}

function makeRoom(roomId: string, ownerId: string): Room {
  return {
    id: roomId,
    name: 'Test',
    owner: ownerId,
    roomType: RoomType.ARRANGE,
    bandMembers: new Map(),
    audiences: new Map(),
    pendingMembers: new Map(),
    isPrivate: false,
    isHidden: false,
    isIsolated: false,
    createdAt: new Date(),
    metronome: { bpm: 120, beatZeroAt: Date.now() },
  };
}

describe('saveFromRoom — new save attributes ownership to room owner', () => {
  let roomId: string;
  beforeEach(async () => {
    await getRedisClient();
    arrangeRoomStateService = new ArrangeRoomStateService();
    roomId = `room-own-${Date.now()}-${Math.random()}`.slice(0, 40);
    await arrangeRoomStateService.initializeState(roomId);
  });
  afterEach(async () => {
    const redis = await getRedisClient();
    await redis.del(`collab:${REDIS_KEYS.arrangeState(roomId)}`);
  });
  afterAll(async () => { await closeRedisConnections(); });

  it('assigns the new project to the room owner when a band member saves', async () => {
    const owner = await makeUser();
    const saver = await makeUser();
    await roomRepo.saveRoom(makeRoom(roomId, owner.id));

    const result = await service.saveFromRoom(saver.id, { roomId, name: 'Jam' });

    expect(result.projectOwnerId).toBe(owner.id);
    const created = await prisma.savedProject.findFirst({ where: { userId: owner.id } });
    expect(created).not.toBeNull();
    const contributor = await prisma.projectContributor.findFirst({ where: { userId: saver.id } });
    expect(contributor).not.toBeNull(); // saver tracked as contributor (BR-13)

    await prisma.projectContributor.deleteMany({ where: { userId: saver.id } });
    await prisma.savedProject.deleteMany({ where: { userId: { in: [owner.id, saver.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, saver.id] } } });
  });

  it('rejects with ROOM_OWNER_LIMIT_REACHED when non-owner saver triggers a new save while room owner is at quota', async () => {
    const owner = await makeUser();
    const saver = await makeUser();
    await roomRepo.saveRoom(makeRoom(roomId, owner.id));

    const ownerLimit = getProjectLimit(UserType.REGISTERED);
    const seedProjectIds: string[] = [];
    for (let i = 0; i < ownerLimit; i++) {
      const seeded = await prisma.savedProject.create({
        data: {
          userId: owner.id,
          roomType: 'arrange',
          visibility: 'PRIVATE',
          name: `Quota Seed ${i + 1}`,
        },
      });
      seedProjectIds.push(seeded.id);
    }

    await expect(service.saveFromRoom(saver.id, { roomId, name: 'Over Quota' }))
      .rejects.toThrow(/ROOM_OWNER_LIMIT_REACHED/);

    await prisma.savedProject.deleteMany({ where: { id: { in: seedProjectIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, saver.id] } } });
  });

  it('rejects with LIMIT_REACHED when room owner is both saver and at quota', async () => {
    const owner = await makeUser();
    await roomRepo.saveRoom(makeRoom(roomId, owner.id));

    const ownerLimit = getProjectLimit(UserType.REGISTERED);
    const seedProjectIds: string[] = [];
    for (let i = 0; i < ownerLimit; i++) {
      const seeded = await prisma.savedProject.create({
        data: {
          userId: owner.id,
          roomType: 'arrange',
          visibility: 'PRIVATE',
          name: `Quota Seed ${i + 1}`,
        },
      });
      seedProjectIds.push(seeded.id);
    }

    // Anchor to start so this does NOT also match the ROOM_OWNER_LIMIT_REACHED branch.
    await expect(service.saveFromRoom(owner.id, { roomId, name: 'Over Quota Self' }))
      .rejects.toThrow(/^LIMIT_REACHED:/);

    await prisma.savedProject.deleteMany({ where: { id: { in: seedProjectIds } } });
    await prisma.user.deleteMany({ where: { id: owner.id } });
  });
});

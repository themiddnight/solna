/**
 * PUT /projects/:id/active-room access gate (ProjectApplicationService.setActiveRoom).
 *
 * The route is registered-only (authenticateToken — BR-20: guests cannot open projects, so they
 * never legitimately claim a project's active room). The visibility gate tested here is defense
 * in depth below the middleware: even if a guest-shaped `guest:*` id ever reached the service, it
 * can never be an owner, contributor, or band member, so it would only pass on PUBLIC projects.
 */
const mockFindUnique = jest.fn<Promise<unknown>, [unknown]>();
jest.mock('@/config/prisma', () => ({ prisma: { savedProject: { findUnique: (a: unknown) => mockFindUnique(a) } } }));

const mockTrySetActiveRoom = jest.fn<Promise<{ conflictRoomId: string } | null>, [string, string]>();
const mockClearActiveRoom = jest.fn<Promise<void>, [string]>();
jest.mock('../../infrastructure/storage/ProjectRoomService', () => ({
  projectRoomService: {
    trySetActiveRoom: (p: string, r: string) => mockTrySetActiveRoom(p, r),
    clearActiveRoom: (p: string) => mockClearActiveRoom(p),
  },
}));

import { projectApplicationService } from '../ProjectApplicationService';

interface ProjectRow {
  userId: string;
  visibility: 'PUBLIC' | 'BAND' | 'PRIVATE';
  contributors: Array<{ userId: string }>;
  bands: Array<{ id: string; members: Array<{ userId: string }> }>;
}

const makeProject = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  userId: 'owner-1',
  visibility: 'PRIVATE',
  contributors: [],
  bands: [],
  ...overrides,
});

const GUEST_ID = 'guest:abc-123';

describe('setActiveRoom access gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrySetActiveRoom.mockResolvedValue(null);
    mockClearActiveRoom.mockResolvedValue(undefined);
  });

  it('allows a guest on a PUBLIC project (share-link happy path)', async () => {
    mockFindUnique.mockResolvedValue(makeProject({ visibility: 'PUBLIC' }));
    await expect(
      projectApplicationService.setActiveRoom(GUEST_ID, 'proj-1', 'room-1')
    ).resolves.toBeUndefined();
    expect(mockTrySetActiveRoom).toHaveBeenCalledWith('proj-1', 'room-1');
  });

  it('blocks a guest on a PRIVATE project', async () => {
    mockFindUnique.mockResolvedValue(makeProject({ visibility: 'PRIVATE' }));
    await expect(
      projectApplicationService.setActiveRoom(GUEST_ID, 'proj-1', 'room-1')
    ).rejects.toThrow(/^FORBIDDEN/);
    expect(mockTrySetActiveRoom).not.toHaveBeenCalled();
  });

  it('blocks a guest on a BAND project', async () => {
    mockFindUnique.mockResolvedValue(
      makeProject({ visibility: 'BAND', bands: [{ id: 'b1', members: [{ userId: 'member-1' }] }] })
    );
    await expect(
      projectApplicationService.setActiveRoom(GUEST_ID, 'proj-1', 'room-1')
    ).rejects.toThrow(/^FORBIDDEN/);
    expect(mockTrySetActiveRoom).not.toHaveBeenCalled();
  });

  it('blocks a registered non-member on a PRIVATE project', async () => {
    mockFindUnique.mockResolvedValue(makeProject({ visibility: 'PRIVATE' }));
    await expect(
      projectApplicationService.setActiveRoom('stranger', 'proj-1', 'room-1')
    ).rejects.toThrow(/^FORBIDDEN/);
    expect(mockTrySetActiveRoom).not.toHaveBeenCalled();
  });

  it('allows the owner on a PRIVATE project', async () => {
    mockFindUnique.mockResolvedValue(makeProject({ visibility: 'PRIVATE' }));
    await expect(
      projectApplicationService.setActiveRoom('owner-1', 'proj-1', 'room-1')
    ).resolves.toBeUndefined();
    expect(mockTrySetActiveRoom).toHaveBeenCalledWith('proj-1', 'room-1');
  });

  it('throws NOT_FOUND when the project does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(
      projectApplicationService.setActiveRoom(GUEST_ID, 'missing', 'room-1')
    ).rejects.toThrow(/^NOT_FOUND/);
  });
});

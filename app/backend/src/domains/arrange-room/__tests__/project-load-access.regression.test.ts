/**
 * DEV-256: POST /rooms/:roomId/projects/load access rules.
 *
 * Opening a public project you don't own creates a room bound to that project and
 * bootstrap-loads it. Since DEV-180 the actor comes from the JWT, so the flat
 * "requester must own the active project" gate 403'd every non-owner bootstrap load.
 *
 * The gate must distinguish:
 *  - bootstrap load (projectId === room's active project) → allowed with READ access
 *    (owner / PUBLIC / BAND + membership — BR-6 visibility), and the storage owner
 *    passed to the import service must be the project owner, not the requester;
 *  - importing a DIFFERENT project into an active session → BR-12 owner-only;
 *  - a room with no active project must still require read access to the target
 *    (no unauthenticated-shape IDOR on arbitrary projectIds).
 */
import type { Request, Response } from 'express';
import { ProjectVisibility } from '@prisma/client';
import { prisma } from '@/config/prisma';
import { BandService } from '@/domains/user-management/application/services/BandService';
import { projectRoomService } from '../infrastructure/storage/ProjectRoomService';
import { ProjectController } from '../infrastructure/controllers/ProjectController';
import type { ProjectImportService } from '../domain/services/ProjectImportService';
import type { ProjectRetrievalService } from '../domain/services/ProjectRetrievalService';

jest.mock('@/config/prisma', () => ({
  prisma: {
    savedProject: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/domains/user-management/application/services/BandService', () => ({
  BandService: {
    isMember: jest.fn(),
  },
}));

jest.mock('../infrastructure/storage/ProjectRoomService', () => ({
  projectRoomService: {
    getProjectByActiveRoom: jest.fn(),
  },
}));

jest.mock('../../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarning: jest.fn(),
  },
}));

const findUnique = prisma.savedProject.findUnique as jest.Mock;
const isMember = BandService.isMember as jest.Mock;
const getProjectByActiveRoom = projectRoomService.getProjectByActiveRoom as jest.Mock;

const ROOM_ID = 'room-1';
const OWNER_ID = 'owner-1';
const REQUESTER_ID = 'user-2';
const GUEST_ID = 'guest:abc-123';

interface ProjectRow {
  id: string;
  userId: string;
  visibility: ProjectVisibility;
  bands: Array<{ id: string }>;
}

const makeProject = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  id: 'proj-1',
  userId: OWNER_ID,
  visibility: ProjectVisibility.PUBLIC,
  bands: [],
  ...overrides,
});

/** Route findUnique by requested id so target-project and active-project lookups both work. */
const seedProjects = (...projects: ProjectRow[]) => {
  findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(projects.find((p) => p.id === where.id) ?? null)
  );
};

interface MockRes {
  capturedStatus: number | null;
  capturedBody: unknown;
}

const createMockRes = (): Response & MockRes => {
  const res: Partial<Response> & MockRes = {
    capturedStatus: null,
    capturedBody: null,
  };
  res.status = jest.fn((code: number) => {
    res.capturedStatus = code;
    return res as Response;
  }) as Response['status'];
  res.json = jest.fn((payload: unknown) => {
    res.capturedBody = payload;
    return res as Response;
  }) as Response['json'];
  return res as Response & MockRes;
};

const createReq = (projectId: string, requesterId: string): Request =>
  ({
    params: { roomId: ROOM_ID },
    body: { projectId },
    user: { id: requesterId, username: 'tester' },
  }) as unknown as Request;

describe('ProjectController.loadProjectFromStorage — access rules (DEV-256)', () => {
  let importProjectFromStorage: jest.Mock;
  let controller: ProjectController;

  beforeEach(() => {
    jest.clearAllMocks();
    importProjectFromStorage = jest.fn().mockResolvedValue({
      projectData: { metadata: { name: 'Test Project' } },
      savedAudioFiles: [],
    });
    const importService = {
      importProjectFromStorage,
    } as unknown as ProjectImportService;
    const retrievalService = {} as unknown as ProjectRetrievalService;
    controller = new ProjectController(importService, retrievalService);
    isMember.mockResolvedValue(false);
  });

  describe('bootstrap load (projectId === active project)', () => {
    it('allows a non-owner to load a PUBLIC project, using the owner as storage owner', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Test Project' });
      seedProjects(makeProject({ visibility: ProjectVisibility.PUBLIC }));

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-1', REQUESTER_ID), res);

      expect(res.capturedStatus).toBe(200);
      // Storage path + room projectOwnerId are keyed by the project owner, never the requester.
      expect(importProjectFromStorage).toHaveBeenCalledWith(ROOM_ID, 'proj-1', OWNER_ID, 'tester');
    });

    it('still blocks a non-owner from loading a PRIVATE project', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Test Project' });
      seedProjects(makeProject({ visibility: ProjectVisibility.PRIVATE }));

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-1', REQUESTER_ID), res);

      expect(res.capturedStatus).toBe(403);
      expect(importProjectFromStorage).not.toHaveBeenCalled();
    });

    it('allows the owner to load their own PRIVATE project', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Test Project' });
      seedProjects(makeProject({ visibility: ProjectVisibility.PRIVATE }));

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-1', OWNER_ID), res);

      expect(res.capturedStatus).toBe(200);
      expect(importProjectFromStorage).toHaveBeenCalledWith(ROOM_ID, 'proj-1', OWNER_ID, 'tester');
    });

    it('allows a band member to load a BAND-visible project', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Test Project' });
      seedProjects(
        makeProject({ visibility: ProjectVisibility.BAND, bands: [{ id: 'band-1' }] })
      );
      isMember.mockResolvedValue(true);

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-1', REQUESTER_ID), res);

      expect(res.capturedStatus).toBe(200);
      expect(isMember).toHaveBeenCalledWith('band-1', REQUESTER_ID);
    });

    it('blocks a non-member from loading a BAND-visible project', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Test Project' });
      seedProjects(
        makeProject({ visibility: ProjectVisibility.BAND, bands: [{ id: 'band-1' }] })
      );

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-1', REQUESTER_ID), res);

      expect(res.capturedStatus).toBe(403);
      expect(importProjectFromStorage).not.toHaveBeenCalled();
    });

    // BR-20: the route is registered-only (authenticateToken), so a guest never reaches this
    // controller in production. These cases pin the hasReadAccess gate as defense in depth below
    // the middleware: even a guest-shaped id would be confined to PUBLIC projects.
    it('allows a guest-shaped id to load a PUBLIC project, using the owner as storage owner', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Test Project' });
      seedProjects(makeProject({ visibility: ProjectVisibility.PUBLIC }));

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-1', GUEST_ID), res);

      expect(res.capturedStatus).toBe(200);
      expect(importProjectFromStorage).toHaveBeenCalledWith(ROOM_ID, 'proj-1', OWNER_ID, 'tester');
    });

    it('blocks a guest from loading a PRIVATE project', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Test Project' });
      seedProjects(makeProject({ visibility: ProjectVisibility.PRIVATE }));

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-1', GUEST_ID), res);

      expect(res.capturedStatus).toBe(403);
      expect(importProjectFromStorage).not.toHaveBeenCalled();
    });

    it('blocks a guest from loading a BAND-visible project', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Test Project' });
      seedProjects(
        makeProject({ visibility: ProjectVisibility.BAND, bands: [{ id: 'band-1' }] })
      );

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-1', GUEST_ID), res);

      expect(res.capturedStatus).toBe(403);
      expect(importProjectFromStorage).not.toHaveBeenCalled();
    });
  });

  describe('import into an active session (projectId !== active project) — BR-12', () => {
    it('blocks a non-owner of the active project even when the target is PUBLIC', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Active Project' });
      seedProjects(
        makeProject({ id: 'proj-1', visibility: ProjectVisibility.PRIVATE }),
        makeProject({ id: 'proj-2', visibility: ProjectVisibility.PUBLIC })
      );

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-2', REQUESTER_ID), res);

      expect(res.capturedStatus).toBe(403);
      expect((res.capturedBody as { message: string }).message).toBe(
        'Only the project owner can import projects.'
      );
      expect(importProjectFromStorage).not.toHaveBeenCalled();
    });

    it('allows the active-project owner to import another readable project', async () => {
      getProjectByActiveRoom.mockResolvedValue({ id: 'proj-1', name: 'Active Project' });
      seedProjects(
        makeProject({ id: 'proj-1', visibility: ProjectVisibility.PRIVATE }),
        makeProject({ id: 'proj-2', userId: 'other-user', visibility: ProjectVisibility.PUBLIC })
      );

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-2', OWNER_ID), res);

      expect(res.capturedStatus).toBe(200);
      expect(importProjectFromStorage).toHaveBeenCalledWith(ROOM_ID, 'proj-2', 'other-user', 'tester');
    });
  });

  describe('room with no active project', () => {
    it('still requires read access to the target project (no arbitrary-projectId IDOR)', async () => {
      getProjectByActiveRoom.mockResolvedValue(null);
      seedProjects(makeProject({ visibility: ProjectVisibility.PRIVATE }));

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('proj-1', REQUESTER_ID), res);

      expect(res.capturedStatus).toBe(403);
      expect(importProjectFromStorage).not.toHaveBeenCalled();
    });

    it('returns 404 when the target project does not exist', async () => {
      getProjectByActiveRoom.mockResolvedValue(null);
      seedProjects();

      const res = createMockRes();
      await controller.loadProjectFromStorage(createReq('missing-proj', REQUESTER_ID), res);

      expect(res.capturedStatus).toBe(404);
      expect(importProjectFromStorage).not.toHaveBeenCalled();
    });
  });
});

/**
 * DEV-310: ProjectController must special-case ProjectVersionMismatchError (Task 3/4) and
 * surface its message to the client with 409, bypassing clientErrorDetail's production
 * stripping — the message is client-safe and actionable by construction (see
 * ProjectVersionMismatchError.ts). Without this, a legacy project file would 500 with a
 * generic, unhelpful message in production.
 */
import type { Request, Response } from 'express';
import fs from 'fs';
import type * as NodeFsModule from 'fs';
import { ProjectController } from '../infrastructure/controllers/ProjectController';
import { ProjectVersionMismatchError } from '../domain/errors/ProjectVersionMismatchError';
import type { ProjectImportService } from '../domain/services/ProjectImportService';
import type { ProjectRetrievalService } from '../domain/services/ProjectRetrievalService';
import { projectRoomService } from '../infrastructure/storage/ProjectRoomService';
import { prisma } from '@/config/prisma';

jest.mock('@/config/environment', () => {
  const actual = jest.requireActual('@/config/environment') as { config: Record<string, unknown> };
  return {
    config: {
      ...actual.config,
      nodeEnv: 'production',
    },
  };
});

jest.mock('@/config/prisma', () => ({
  prisma: {
    savedProject: {
      findUnique: jest.fn(),
    },
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

jest.mock('fs', () => {
  const actual = jest.requireActual('fs') as typeof NodeFsModule;
  return {
    ...actual,
    promises: {
      ...actual.promises,
      unlink: jest.fn(),
    },
  };
});

const findUnique = prisma.savedProject.findUnique as jest.Mock;
const getProjectByActiveRoom = projectRoomService.getProjectByActiveRoom as jest.Mock;

const ROOM_ID = 'room-1';
const USER_ID = 'user-1';

interface MockRes {
  capturedStatus: number | null;
  capturedBody: unknown;
}

interface VersionMismatchResponseBody {
  success: boolean;
  message: string;
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

describe('ProjectController — version-mismatch surfacing (DEV-310)', () => {
  let importProject: jest.Mock;
  let importProjectFromStorage: jest.Mock;
  let controller: ProjectController;

  beforeEach(() => {
    jest.clearAllMocks();
    importProject = jest.fn();
    importProjectFromStorage = jest.fn();
    const importService = {
      importProject,
      importProjectFromStorage,
    } as unknown as ProjectImportService;
    const retrievalService = {} as unknown as ProjectRetrievalService;
    controller = new ProjectController(importService, retrievalService);
    getProjectByActiveRoom.mockResolvedValue(null);
    (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
  });

  it('uploadProject responds 409 with the version-mismatch message intact, even when clientErrorDetail would strip it', async () => {
    importProject.mockRejectedValue(new ProjectVersionMismatchError('1.0.0'));

    const req = {
      params: { roomId: ROOM_ID },
      file: { path: '/tmp/upload.json', destination: '/tmp' },
      user: { id: USER_ID, username: 'tester' },
    } as unknown as Request;
    const res = createMockRes();

    await controller.uploadProject(req, res);

    expect(res.capturedStatus).toBe(409);
    const body = res.capturedBody as VersionMismatchResponseBody;
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/newer version of the app/);
  });

  it('loadProjectFromStorage responds 409 with the version-mismatch message', async () => {
    findUnique.mockResolvedValue({
      id: 'proj-1',
      userId: USER_ID,
      visibility: 'PRIVATE',
      bands: [],
    });
    importProjectFromStorage.mockRejectedValue(new ProjectVersionMismatchError('1.0.0'));

    const req = {
      params: { roomId: ROOM_ID },
      body: { projectId: 'proj-1' },
      user: { id: USER_ID, username: 'tester' },
    } as unknown as Request;
    const res = createMockRes();

    await controller.loadProjectFromStorage(req, res);

    expect(res.capturedStatus).toBe(409);
    const body = res.capturedBody as VersionMismatchResponseBody;
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/newer version of the app/);
  });
});

/**
 * DEV-310 final-review Finding 2: POST /projects (createProject) accepts client-supplied
 * `projectData` — the one DEV-310 producer whose `version` field is genuinely untrusted input
 * (from the request body). Before this fix it wrote the file to storage and minted a DB row +
 * a project-count slot with zero version validation, so a stale client could create a project
 * that's permanently unopenable (every subsequent load 409s, per DEV-310's refuse-don't-convert
 * policy).
 *
 * DEV-295 update: the refuse-don't-convert policy now only refuses a version from a NEWER
 * build — a legacy/older/missing version is accepted (the backend carries no reset logic; see
 * `assertSupportedProjectVersion.ts`). This locks: (1) legacy ("1.0.0"), older-integer, and
 * missing versions are all accepted through to the prisma/storage writes; (2) a version from a
 * newer build is still rejected with the existing `BAD_REQUEST:` convention, BEFORE any prisma
 * write or storage write; (3) the current PROJECT_SCHEMA_VERSION is accepted and proceeds
 * normally.
 */
import { PROJECT_SCHEMA_VERSION } from '@jam-band/shared';
import { prisma } from '@/config/prisma';
import { RoomType } from '@/types';

jest.mock('@/config/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    savedProject: { count: jest.fn(), create: jest.fn(), delete: jest.fn() },
  },
}));

const esModuleFlag = '__esModule';
jest.mock('../infrastructure/storage/ProjectStorageService', () => ({
  [esModuleFlag]: true,
  projectStorageService: {
    saveProjectFiles: jest.fn().mockResolvedValue(undefined),
  },
}));

// Import AFTER the mocks so the module-level singleton binds to the mocked dependencies.
import { projectStorageService } from '../infrastructure/storage/ProjectStorageService';
import { projectApplicationService } from '../application/ProjectApplicationService';

const findUniqueUser = prisma.user.findUnique as jest.Mock;
const countProjects = prisma.savedProject.count as jest.Mock;
const createProject = prisma.savedProject.create as jest.Mock;
const saveProjectFiles = projectStorageService.saveProjectFiles as jest.Mock;

describe('ProjectApplicationService.createProject — version gate (DEV-310 Finding 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findUniqueUser.mockResolvedValue({ userType: 'REGISTERED' });
    countProjects.mockResolvedValue(0);
    createProject.mockResolvedValue({
      id: 'new-project-id', name: 'Test', forkedFromId: null, forkChain: null, allowFork: false,
    });
  });

  const baseCmd = {
    name: 'My Project',
    roomType: RoomType.ARRANGE,
    projectData: {} as Record<string, unknown>,
  };

  // DEV-295: the gate now refuses only projectData from a NEWER build. A pre-epic ("1.0.0"),
  // older-integer (v4), or missing version is accepted through to the DB/storage writes — the
  // backend carries no reset logic (FE-only); it just stops refusing to store it.
  it('accepts projectData with a stale/legacy ("1.0.0") version', async () => {
    const cmd = { ...baseCmd, projectData: { version: '1.0.0', tracks: [] } };

    await expect(projectApplicationService.createProject('user-1', cmd, [])).resolves.toEqual(
      expect.objectContaining({ id: 'new-project-id' }),
    );

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(saveProjectFiles).toHaveBeenCalledTimes(1);
  });

  it('accepts projectData stamped with an older integer version (v4)', async () => {
    const cmd = { ...baseCmd, projectData: { version: PROJECT_SCHEMA_VERSION - 1, tracks: [] } };

    await expect(projectApplicationService.createProject('user-1', cmd, [])).resolves.toEqual(
      expect.objectContaining({ id: 'new-project-id' }),
    );

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(saveProjectFiles).toHaveBeenCalledTimes(1);
  });

  it('accepts projectData missing a version field entirely (treated as legacy, not future)', async () => {
    const cmd = { ...baseCmd, projectData: { tracks: [] } };

    await expect(projectApplicationService.createProject('user-1', cmd, [])).resolves.toEqual(
      expect.objectContaining({ id: 'new-project-id' }),
    );
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it('rejects projectData stamped with a version from a NEWER build BEFORE any DB write', async () => {
    const cmd = { ...baseCmd, projectData: { version: PROJECT_SCHEMA_VERSION + 1, tracks: [] } };

    await expect(projectApplicationService.createProject('user-1', cmd, [])).rejects.toThrow(
      /^BAD_REQUEST:/,
    );

    expect(createProject).not.toHaveBeenCalled();
    expect(saveProjectFiles).not.toHaveBeenCalled();
  });

  it('accepts projectData stamped with the current PROJECT_SCHEMA_VERSION', async () => {
    const cmd = { ...baseCmd, projectData: { version: PROJECT_SCHEMA_VERSION, tracks: [] } };

    await expect(projectApplicationService.createProject('user-1', cmd, [])).resolves.toEqual(
      expect.objectContaining({ id: 'new-project-id' }),
    );

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(saveProjectFiles).toHaveBeenCalledTimes(1);
  });
});

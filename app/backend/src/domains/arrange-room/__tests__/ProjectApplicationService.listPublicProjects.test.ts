/**
 * DEV-225: listPublicProjects must return ONLY public projects — PRIVATE projects are
 * excluded at the DB query level (BR-6). Covers the risk previously only in e2e
 * (project/project-rules.spec.ts "PRIVATE project is visible only to the owner" /
 * "PUBLIC project is visible to all users"). The e2e verified via the real /public
 * endpoint; this locks the query's visibility constraint directly.
 */
import { ProjectVisibility } from '@prisma/client';
import { prisma } from '@/config/prisma';

jest.mock('@/config/prisma', () => ({
  prisma: {
    savedProject: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

// Import AFTER the mock so the module-level singleton binds to the mocked prisma.
import { projectApplicationService } from '../application/ProjectApplicationService';

const findMany = prisma.savedProject.findMany as jest.Mock;
const count = prisma.savedProject.count as jest.Mock;

describe('ProjectApplicationService.listPublicProjects — PUBLIC-only (BR-6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
  });

  it('queries only PUBLIC projects (no search), so PRIVATE ones are never listed', async () => {
    await projectApplicationService.listPublicProjects({});

    // With no search term the where clause is exactly { visibility: PUBLIC } — PRIVATE and
    // BAND projects are filtered out at the DB level for both the page and the total count.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visibility: ProjectVisibility.PUBLIC } }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visibility: ProjectVisibility.PUBLIC } }),
    );
  });

  it('keeps the PUBLIC constraint alongside a text-search filter', async () => {
    await projectApplicationService.listPublicProjects({ search: 'jazz' });

    // Searching still scopes to PUBLIC — the search OR is ANDed with the visibility gate.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          visibility: ProjectVisibility.PUBLIC,
          OR: [
            { name: { contains: 'jazz', mode: 'insensitive' } },
            { description: { contains: 'jazz', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });
});

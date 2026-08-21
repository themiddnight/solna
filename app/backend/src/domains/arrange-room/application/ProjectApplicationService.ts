import { prisma } from '../../../config/prisma';
import { getProjectLimit, isProjectLimitReached, UserType, type ProjectShareAccessResponse } from '@jam-band/shared';
import { assertSupportedProjectVersion } from '../domain/utils/assertSupportedProjectVersion';
import { RoomType } from '../../../types';
import { ProjectVisibility } from '@prisma/client';
import { z } from 'zod';
import type { Server as SocketIOServer } from 'socket.io';
import { projectRoomService } from '../infrastructure/storage/ProjectRoomService';
import { arrangeRoomStateService } from './ArrangeRoomStateService';
import { parsePaginationParams } from '../../../shared/utils/paginationUtils';
import { BandService } from '../../user-management/application/services/BandService';
import { projectStorageService } from '../infrastructure/storage/ProjectStorageService';
import { projectSaveLockService } from '../infrastructure/services/ProjectSaveLockService';
import { ProjectSaveService } from '../domain/services/ProjectSaveService';
import { ProjectExportService } from '../domain/services/ProjectExportService';
import { createSaveProgressCallback } from './SaveProgressEmitter';
import { audioRegionStorageService } from '../infrastructure/storage/AudioRegionStorageService';
import { RoomRepository } from '../../room-management/infrastructure/repositories/RoomRepository';
import { projectShareAccessService } from './ProjectShareAccessService';
import type { ShareAccessActor } from './ProjectShareAccessService';

export interface PaginationQuery {
  search?: string;
  page?: string | number;
  limit?: string | number;
}

/** Live active-room presence for a single project (decoupled from the project list payload). */
export interface ProjectActiveRoomPresence {
  projectId: string;
  activeRoomId: string | null;
  activeUserCount: number;
  activeRoomIsPrivate: boolean;
}

export const createProjectCmdSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  roomType: z.nativeEnum(RoomType),
  metadata: z.unknown().optional(),
  allowRemix: z.boolean().optional(),
  projectData: z.record(z.string(), z.unknown()),
});
export type CreateProjectCmd = z.infer<typeof createProjectCmdSchema>;

export const updateVisibilityCmdSchema = z.object({
  visibility: z.nativeEnum(ProjectVisibility),
  bandIds: z.array(z.string()).optional(),
  allowRemix: z.boolean().optional(),
});
export type UpdateVisibilityCmd = z.infer<typeof updateVisibilityCmdSchema>;

export const updateSettingsCmdSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  allowRemix: z.boolean().optional(),
});
export type UpdateSettingsCmd = z.infer<typeof updateSettingsCmdSchema>;

export const remixProjectCmdSchema = z.object({
  name: z.string().min(1),
  roomType: z.nativeEnum(RoomType).optional(),
  replaceProjectId: z.string().optional(),
});
export type RemixProjectCmd = z.infer<typeof remixProjectCmdSchema>;
export const saveFromRoomUpdateCmdSchema = z.object({
  roomId: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
});
export type SaveFromRoomUpdateCmd = z.infer<typeof saveFromRoomUpdateCmdSchema>;

export const saveFromRoomCmdSchema = z.object({
  roomId: z.string().min(1),
  projectId: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  allowRemix: z.boolean().optional(),
  visibility: z.nativeEnum(ProjectVisibility).optional(),
});
export type SaveFromRoomCmd = z.infer<typeof saveFromRoomCmdSchema>;

const projectSaveService = new ProjectSaveService(arrangeRoomStateService, audioRegionStorageService, projectStorageService);
const projectExportService = new ProjectExportService(arrangeRoomStateService, audioRegionStorageService);
const roomRepositoryForSave = new RoomRepository();

export class ProjectApplicationService {
  private io: SocketIOServer | undefined;

  /** Set the Socket.IO server instance for emitting real-time progress events. */
  setSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  async listProjects(userId: string, query: PaginationQuery) {
    const { search, page, limit, skip } = parsePaginationParams(query as Record<string, unknown>);
    const searchFilter = search !== '' ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { description: { contains: search, mode: 'insensitive' as const } },
      ],
    } : {};

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { userType: true } });
    const userType = user !== null ? (user.userType as UserType) : UserType.REGISTERED;
    const projectLimit = getProjectLimit(userType);

    const [ownedProjects, ownedTotal] = await Promise.all([
      prisma.savedProject.findMany({
        where: { userId, ...searchFilter },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, name: true, description: true, roomType: true, metadata: true,
          visibility: true, isLocked: true,
          bands: { select: { id: true, name: true } },
          createdAt: true, updatedAt: true, allowFork: true, forkedFromId: true, forkChain: true,
          forkedFrom: { select: { id: true, name: true, user: { select: { id: true, username: true, profilePictureUrl: true } } } },
          user: { select: { id: true, username: true, profilePictureUrl: true } },
          contributors: {
            include: { user: { select: { id: true, username: true, profilePictureUrl: true } } },
            orderBy: { lastContributedAt: 'desc' },
            take: 20,
          },
        },
      }),
      prisma.savedProject.count({ where: { userId, ...searchFilter } }),
    ]);

    const [contributedProjects, contributedTotal] = await Promise.all([
      prisma.savedProject.findMany({
        where: { contributors: { some: { userId } }, NOT: { userId }, ...searchFilter },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, name: true, description: true, roomType: true, metadata: true,
          visibility: true, isLocked: true,
          bands: { select: { id: true, name: true } },
          createdAt: true, updatedAt: true, allowFork: true, forkedFromId: true, forkChain: true,
          forkedFrom: { select: { id: true, name: true, user: { select: { id: true, username: true, profilePictureUrl: true } } } },
          user: { select: { id: true, username: true, profilePictureUrl: true } },
          contributors: {
            include: { user: { select: { id: true, username: true, profilePictureUrl: true } } },
            orderBy: { lastContributedAt: 'desc' },
            take: 20,
          },
        },
      }),
      prisma.savedProject.count({
        where: { contributors: { some: { userId } }, NOT: { userId }, ...searchFilter },
      }),
    ]);

    const enrichedOwnedProjects = await this.enrichProjectsWithRoomInfo(ownedProjects);
    const enrichedContributedProjects = await this.enrichProjectsWithRoomInfo(contributedProjects);

    return {
      owned: enrichedOwnedProjects.map((p) => this.mapProjectForList(p)),
      contributed: enrichedContributedProjects.map((p) => ({ ...this.mapProjectForList(p), ownerUsername: p.user.username })),
      pagination: {
        page, limit, ownedTotal, contributedTotal,
        ownedTotalPages: Math.ceil(ownedTotal / limit),
        contributedTotalPages: Math.ceil(contributedTotal / limit),
      },
      projectLimit: projectLimit === Infinity ? null : projectLimit,
    };
  }

  async listPublicProjects(query: PaginationQuery) {
    const { search, page, limit, skip } = parsePaginationParams(query as Record<string, unknown>);
    const searchFilter = search !== '' ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { description: { contains: search, mode: 'insensitive' as const } },
      ],
    } : {};

    const [publicProjects, total] = await Promise.all([
      prisma.savedProject.findMany({
        where: { visibility: ProjectVisibility.PUBLIC, ...searchFilter },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, name: true, description: true, roomType: true, metadata: true,
          visibility: true, isLocked: true, createdAt: true, updatedAt: true, allowFork: true, forkedFromId: true, forkChain: true,
          forkedFrom: { select: { id: true, name: true, user: { select: { id: true, username: true, profilePictureUrl: true } } } },
          user: { select: { id: true, username: true, profilePictureUrl: true } },
          contributors: {
            include: { user: { select: { id: true, username: true, profilePictureUrl: true } } },
            orderBy: { lastContributedAt: 'desc' },
            take: 5,
          },
        },
      }),
      prisma.savedProject.count({ where: { visibility: ProjectVisibility.PUBLIC, ...searchFilter } }),
    ]);

    const enrichedPublicProjects = await this.enrichProjectsWithRoomInfo(publicProjects);
    return {
      projects: enrichedPublicProjects.map((p) => this.mapProjectForList(p)),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Read access per visibility (BR-6): owner, PUBLIC, or BAND + membership in any linked band.
   * Delegates to ProjectShareAccessService.hasReadAccess (single canonical implementation).
   */
  async hasReadAccess(
    userId: string,
    project: { userId: string; visibility: ProjectVisibility; bands: Array<{ id: string }> }
  ): Promise<boolean> {
    return projectShareAccessService.hasReadAccess(userId, project);
  }

  /**
   * Resolve what a share-link visitor may do with a project (delegates to ProjectShareAccessService).
   */
  async resolveShareAccess(
    actor: ShareAccessActor,
    projectId: string
  ): Promise<ProjectShareAccessResponse> {
    return projectShareAccessService.resolveShareAccess(actor, projectId);
  }

  async getProject(userId: string, projectId: string) {
    const project = await prisma.savedProject.findUnique({
      where: { id: projectId },
      include: {
        user: { select: { id: true, username: true, profilePictureUrl: true } },
        bands: { select: { id: true, name: true } },
        contributors: {
          include: { user: { select: { id: true, username: true, profilePictureUrl: true } } },
          orderBy: { lastContributedAt: 'desc' },
        },
        forkedFrom: { select: { id: true, name: true, user: { select: { id: true, username: true, profilePictureUrl: true } } } },
      },
    });

    if (!project) throw new Error('NOT_FOUND');
    const isOwner = project.userId === userId;
    // Bands come from the initial query (include bands) instead of a redundant DB call
    const hasAccess = await this.hasReadAccess(userId, project);

    if (!hasAccess) throw new Error('FORBIDDEN');

    const { projectJson, audioFiles } = await projectStorageService.loadProjectFiles(project.userId, projectId);
    const projectData: unknown = JSON.parse(projectJson);
    const audioFilesBase64 = audioFiles.map((file) => ({
      fileName: file.fileName,
      data: file.buffer.toString('base64'),
    }));

    return {
      project: {
        id: project.id, name: project.name, roomType: project.roomType, metadata: project.metadata,
        visibility: project.visibility, bands: project.bands, allowRemix: project.allowFork,
        remixedFromId: project.forkedFromId,
        remixedFrom: project.forkedFrom !== null ? { id: project.forkedFrom.id, name: project.forkedFrom.name, ownerUsername: project.forkedFrom.user.username } : null,
        remixChain: project.forkChain,
        createdAt: project.createdAt, updatedAt: project.updatedAt, owner: project.user,
        contributors: project.contributors.map((c) => ({ id: c.user.id, username: c.user.username, profilePictureUrl: c.user.profilePictureUrl, lastContributedAt: c.lastContributedAt })),
        isLocked: project.isLocked,
      },
      projectData, audioFiles: audioFilesBase64, isOwner,
    };
  }

  async getLockStatus(projectId: string) {
    return projectSaveLockService.isLocked(projectId);
  }

  async createProject(userId: string, cmd: CreateProjectCmd, audioFilesBuffers: Array<{ fileName: string; buffer: Buffer }>) {
    const { name, description, roomType, metadata, allowRemix: hasAllowRemix, projectData } = cmd;

    if (Object.keys(projectData).length === 0) {
      throw new Error('BAD_REQUEST: projectData is required and must not be empty');
    }
    assertSupportedProjectVersion(projectData.version, 'projectData.version is missing or unsupported — refresh the page and try again');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { userType: true } });
    const userType = user !== null ? (user.userType as UserType) : UserType.REGISTERED;
    const projectCount = await prisma.savedProject.count({ where: { userId } });

    if (isProjectLimitReached(projectCount, userType)) {
      throw new Error('LIMIT_REACHED');
    }

    const project = await prisma.savedProject.create({
      data: {
        name, description: description !== undefined ? description : null, userId, roomType, metadata: metadata ?? {},
        visibility: ProjectVisibility.PRIVATE, allowFork: hasAllowRemix === true,
      },
    });

    try {
      await projectStorageService.saveProjectFiles(userId, project.id, { projectJson: JSON.stringify(projectData), audioFiles: audioFilesBuffers });
    } catch (saveError) {
      await prisma.savedProject.delete({ where: { id: project.id } });
      throw saveError;
    }

    return {
      ...project,
      allowRemix: project.allowFork,
      remixedFromId: project.forkedFromId,
      remixChain: project.forkChain
    };
  }

  async updateVisibility(userId: string, projectId: string, cmd: UpdateVisibilityCmd) {
    const { visibility, bandIds } = cmd;
    const targetBandIds: string[] = bandIds ?? [];
    if (visibility === ProjectVisibility.BAND && targetBandIds.length === 0) {
      throw new Error('BAD_REQUEST: At least one band is required when visibility is BAND');
    }

    const project = await prisma.savedProject.findUnique({ where: { id: projectId }, include: { bands: true } });
    if (!project || project.userId !== userId) {
      throw new Error('NOT_FOUND: Project not found or not owned by you');
    }

    if (visibility === ProjectVisibility.BAND || (visibility === ProjectVisibility.PUBLIC && targetBandIds.length > 0)) {
      const membershipChecks = await Promise.all(targetBandIds.map(id => BandService.isMember(id, userId)));
      if (membershipChecks.some(isMember => !isMember)) {
        throw new Error('FORBIDDEN: You are not a member of one or more specified bands');
      }
    }

    const updatedProject = await prisma.savedProject.update({
      where: { id: projectId },
      data: {
        visibility,
        bands: { set: (visibility === ProjectVisibility.BAND || visibility === ProjectVisibility.PUBLIC) ? targetBandIds.map(id => ({ id })) : [] },
        updatedAt: project.updatedAt,
      },
      include: { bands: true }
    });

    return { project: { id: updatedProject.id, visibility: updatedProject.visibility, bands: updatedProject.bands } };
  }

  async updateSettings(userId: string, projectId: string, cmd: UpdateSettingsCmd) {
    const { allowRemix: hasAllowRemix } = cmd;
    const project = await prisma.savedProject.findUnique({ where: { id: projectId } });
    if (!project || project.userId !== userId) {
      throw new Error('FORBIDDEN: Not authorized to update this project');
    }
    const updatedProject = await prisma.savedProject.update({
      where: { id: projectId },
      data: { allowFork: hasAllowRemix ?? project.allowFork, updatedAt: project.updatedAt },
    });
    return { project: { id: updatedProject.id, allowRemix: updatedProject.allowFork } };
  }

  async remixProject(userId: string, projectId: string, cmd: RemixProjectCmd) {
    const { replaceProjectId } = cmd;
    const original = await prisma.savedProject.findUnique({
      where: { id: projectId },
      include: { user: { select: { id: true, username: true } }, bands: { select: { id: true, name: true } } },
    });
    if (!original) throw new Error('NOT_FOUND: Project not found');
    if (original.userId === userId) throw new Error('BAD_REQUEST: Cannot remix your own project');
    if (!original.allowFork) throw new Error('FORBIDDEN: This project does not allow remixing');

    let hasAccess = false;
    if (original.visibility === ProjectVisibility.PUBLIC) hasAccess = true;
    else if (original.visibility === ProjectVisibility.BAND && original.bands.length > 0) {
      const membershipChecks = await Promise.all(original.bands.map(band => BandService.isMember(band.id, userId)));
      hasAccess = membershipChecks.some(isMember => isMember);
    }
    if (!hasAccess) throw new Error('FORBIDDEN: Access denied');

    // Read+check the original's project.json BEFORE any DB/limit writes (DEV-310 Finding 4).
    const { projectJson: originalProjectJson, audioFiles: originalAudioFiles } = await projectStorageService.loadProjectFiles(original.userId, projectId);
    const originalProjectData = JSON.parse(originalProjectJson) as { version?: unknown };
    assertSupportedProjectVersion(originalProjectData.version, "This project predates a required update and can't be remixed. Ask the owner to re-save it, then try again.");

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { userType: true } });
    const userType = user !== null ? (user.userType as UserType) : UserType.REGISTERED;
    const projectCount = await prisma.savedProject.count({ where: { userId } });

    if (isProjectLimitReached(projectCount, userType) && replaceProjectId === undefined) {
      const existingProjects = await prisma.savedProject.findMany({
        where: { userId },
        select: { id: true, name: true, roomType: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      });
      throw new Error(`LIMIT_REACHED: ${JSON.stringify(existingProjects)}`);
    }

    if (replaceProjectId !== undefined) {
      const projectToReplace = await prisma.savedProject.findFirst({
        where: { id: replaceProjectId, userId },
        select: { id: true },
      });
      if (!projectToReplace) throw new Error('BAD_REQUEST: Invalid project to replace');
      await projectStorageService.deleteProjectFiles(userId, replaceProjectId);
      await prisma.savedProject.delete({ where: { id: replaceProjectId } });
    }

    const originalRemixChain = Array.isArray(original.forkChain) ? original.forkChain : [];
    const parentChainElement = {
      id: original.id,
      name: original.name,
      userId: original.userId,
      username: original.user.username,
      remixedAt: new Date().toISOString(),
    };
    const newRemixChain = [...originalRemixChain, parentChainElement];

    const remixed = await prisma.savedProject.create({
      data: {
        userId, name: `${original.name} (Remix)`, description: original.description, roomType: original.roomType,
        metadata: original.metadata ?? {}, visibility: original.visibility,
        bands: { connect: original.bands.map((b) => ({ id: b.id })) },
        allowFork: false, forkedFromId: original.id,
        forkChain: newRemixChain,
      },
      include: { bands: true }
    });

    try {
      await projectStorageService.saveProjectFiles(userId, remixed.id, { projectJson: originalProjectJson, audioFiles: originalAudioFiles });
    } catch (fileError) {
      await prisma.savedProject.delete({ where: { id: remixed.id } });
      throw fileError;
    }

    return { project: { id: remixed.id, name: remixed.name, roomType: remixed.roomType, visibility: remixed.visibility, bands: remixed.bands, remixedFrom: { id: original.id, name: original.name, ownerUsername: original.user.username }, remixChain: remixed.forkChain } };
  }

  async deleteProject(userId: string, projectId: string) {
    const project = await prisma.savedProject.findFirst({ where: { id: projectId } });
    if (!project) throw new Error('NOT_FOUND: Project not found');
    if (project.userId !== userId) throw new Error('FORBIDDEN: You do not have permission to delete this project');
    await projectStorageService.deleteProjectFiles(userId, projectId);
    await prisma.savedProject.delete({ where: { id: projectId } });
    return { message: 'Project deleted successfully' };
  }

  async getActiveRoom(projectId: string) {
    const activeRoom = await projectRoomService.getActiveRoomWithRealCount(projectId);
    return { activeRoomId: activeRoom.activeRoomId, activeUserCount: activeRoom.activeUserCount };
  }

  async getActiveRoomInfo(projectId: string) {
    const roomInfo = await projectRoomService.getActiveRoomInfo(projectId);
    if (!roomInfo) throw new Error('NOT_FOUND: Active room not found');
    return roomInfo;
  }

  async setActiveRoom(userId: string, projectId: string, roomId: string | null) {
    const project = await prisma.savedProject.findUnique({
      where: { id: projectId },
      select: {
        userId: true, visibility: true,
        contributors: { select: { userId: true } },
        bands: { select: { id: true, members: { select: { userId: true } } } },
      },
    });

    if (!project) throw new Error('NOT_FOUND: Project not found');

    const isOwner = project.userId === userId;
    const isContributor = project.contributors.some((c) => c.userId === userId);
    const isBandMember = project.bands.some((b) => b.members.some((m) => m.userId === userId));
    const isPublic = project.visibility === ProjectVisibility.PUBLIC;

    if (!isOwner && !isContributor && !isBandMember && !isPublic) {
      throw new Error('FORBIDDEN: You do not have permission to open this project');
    }

    if (roomId) {
      const conflict = await projectRoomService.trySetActiveRoom(projectId, roomId);
      if (conflict) {
        const conflictInfo = await projectRoomService.getActiveRoomWithRealCount(projectId);
        throw new Error(`CONFLICT: Project already has an active room: ${conflict.conflictRoomId} (${conflictInfo.activeUserCount} users)`);
      }
    } else {
      await projectRoomService.clearActiveRoom(projectId);
    }
  }

  async saveFromRoomUpdate(userId: string, projectId: string, cmd: SaveFromRoomUpdateCmd) {
    const { roomId, name, description } = cmd;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { userType: true } });
    if (user === null) {
      throw new Error('FORBIDDEN: Account not found');
    }

    const project = await prisma.savedProject.findUnique({ where: { id: projectId }, include: { contributors: true } });
    if (!project) throw new Error('NOT_FOUND: Project not found');

    const isOwner = project.userId === userId;
    const isContributor = project.contributors.some((c) => c.userId === userId);
    if (!isOwner && !isContributor) {
      throw new Error('FORBIDDEN: You do not have permission to save this project');
    }

    const finalName = name !== undefined && name !== '' ? name : project.name;
    const finalDescription = description !== undefined ? description : (project.description ?? undefined);
    try {
      await projectSaveService.saveProjectFromRoom(roomId, projectId, project.userId, finalName, {
        replaceExisting: true,
        onProgress: createSaveProgressCallback(this.io, roomId),
      });

      await prisma.savedProject.update({
        where: { id: projectId },
        data: { name: finalName, description: finalDescription ?? project.description, updatedAt: new Date() },
      });

      return { projectId, message: 'Project saved successfully from room state' };
    } catch (error) {
      projectSaveLockService.releaseLock(projectId, userId);
      throw error;
    }
  }

  async exportCollab(userId: string, roomId: string, projectName: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { userType: true } });
    if (user === null) {
      throw new Error('FORBIDDEN: Account not found');
    }

    const project = await projectRoomService.getProjectByActiveRoom(roomId);
    if (project !== null) {
      const projectDetails = await prisma.savedProject.findUnique({ where: { id: project.id }, select: { userId: true } });
      if (!projectDetails || projectDetails.userId !== userId) {
        throw new Error('FORBIDDEN: Only the project owner can export this project.');
      }
    }

    return await projectExportService.exportProjectAsCollab(String(roomId), projectName);
  }

  async exportStems(userId: string, roomId: string, projectName: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { userType: true } });
    if (user === null) {
      throw new Error('FORBIDDEN: Account not found');
    }

    const project = await projectRoomService.getProjectByActiveRoom(roomId);
    if (project !== null) {
      const projectDetails = await prisma.savedProject.findUnique({ where: { id: project.id }, select: { userId: true } });
      if (!projectDetails || projectDetails.userId !== userId) {
        throw new Error('FORBIDDEN: Only the project owner can export this project.');
      }
    }

    return await projectExportService.exportProjectStems(String(roomId), projectName);
  }


  async saveFromRoom(userId: string, cmd: SaveFromRoomCmd) {
    const { roomId, projectId, name, description, allowRemix: hasAllowRemix, visibility } = cmd;

    if (roomId === '' || ((name === undefined || name === '') && projectId === undefined)) {
      throw new Error('BAD_REQUEST: Missing required fields: roomId, name (name required for new projects)');
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { userType: true } });
    if (user === null) {
      throw new Error('FORBIDDEN: Account not found');
    }

    const roomState = await arrangeRoomStateService.getState(roomId);
    if (roomState === null) throw new Error('NOT_FOUND: Room not found');

    let finalProjectId = projectId;
    let projectIdForLock: string | null = null;

    try {
      if (projectId !== undefined) {
        projectIdForLock = projectId;
        const project = await prisma.savedProject.findUnique({
          where: { id: projectId },
          include: { contributors: true, bands: { include: { members: { select: { userId: true } } } } },
        });

        if (!project) throw new Error('NOT_FOUND: Project not found');

        const isOwner = project.userId === userId;
        const isContributor = project.contributors.some((c) => c.userId === userId);

        if (project.isLocked && !isOwner) {
          throw new Error('FORBIDDEN: Project is locked by owner');
        }

        let hasWriteAccess = isOwner || isContributor;
        if (!hasWriteAccess) {
          if (project.visibility === ProjectVisibility.PUBLIC) hasWriteAccess = true;
          else if (project.visibility === ProjectVisibility.BAND) {
            const isBandMember = project.bands.some((b) => b.members.some((m) => m.userId === userId));
            if (isBandMember) hasWriteAccess = true;
          }
        }

        if (!hasWriteAccess) throw new Error('FORBIDDEN: You do not have permission to save this project');

        if (!isOwner && !isContributor) {
          try {
            await prisma.projectContributor.create({ data: { projectId, userId, lastContributedAt: new Date() } });
          } catch { /* ignore */ }
        } else if (isContributor) {
          await prisma.projectContributor.update({
            // eslint-disable-next-line @typescript-eslint/naming-convention -- Prisma-generated compound unique key name
            where: { projectId_userId: { projectId, userId } },
            data: { lastContributedAt: new Date() },
          });
        }

        const finalName = name !== undefined && name !== '' ? name : project.name;
        const finalDescription = description !== undefined ? description : (project.description ?? undefined);

        await projectSaveService.saveProjectFromRoom(roomId, projectId, project.userId, finalName, {
        replaceExisting: true,
        onProgress: createSaveProgressCallback(this.io, roomId),
      });

        await prisma.savedProject.update({
          where: { id: projectId },
          data: { name: finalName, description: finalDescription !== undefined ? finalDescription : project.description, updatedAt: new Date() },
        });

        await arrangeRoomStateService.markProjectAsSaved(roomId, projectId);

        return { success: true, message: 'Project saved successfully', projectId: finalProjectId!, isNewProject: false, projectOwnerId: project.userId };
      } else {
        const { ownerId: roomOwnerId, ownerType: ownerType2 } = await this.resolveRoomOwnerForSave(roomId);
        const isSaverRoomOwner = roomOwnerId === userId;

        const projectLimit = getProjectLimit(ownerType2);
        const projectCount = await prisma.savedProject.count({ where: { userId: roomOwnerId } });
        if (isProjectLimitReached(projectCount, ownerType2)) {
          throw new Error(isSaverRoomOwner ? `LIMIT_REACHED: ${projectLimit}` : `ROOM_OWNER_LIMIT_REACHED: ${projectLimit}`);
        }

        const newProject = await prisma.savedProject.create({
          data: {
            userId: roomOwnerId, name: name!, description: description !== undefined ? description : '', roomType: RoomType.ARRANGE,
            allowFork: hasAllowRemix ?? true, visibility: visibility ?? ProjectVisibility.PRIVATE,
          },
        });

        finalProjectId = newProject.id;
        projectIdForLock = finalProjectId;

        await projectSaveService.saveProjectFromRoom(roomId, finalProjectId, roomOwnerId, name, {
          onProgress: createSaveProgressCallback(this.io, roomId),
        });
        await arrangeRoomStateService.setProjectMetadata(roomId, finalProjectId, roomOwnerId, true);

        if (!isSaverRoomOwner) {
          try {
            await prisma.projectContributor.create({ data: { projectId: finalProjectId, userId, lastContributedAt: new Date() } });
          } catch { /* ignore duplicate */ }
        }

        return { success: true, message: 'Project created successfully', projectId: finalProjectId, isNewProject: true, projectOwnerId: roomOwnerId };
      }
    } catch (error) {
      if (projectIdForLock !== null) projectSaveLockService.releaseLock(projectIdForLock, userId);
      throw error;
    }
  }

  async toggleLock(userId: string, projectId: string, isLocked: boolean) {
    const project = await prisma.savedProject.findUnique({ where: { id: projectId } });
    if (!project) throw new Error('NOT_FOUND: Project not found');
    if (project.userId !== userId) throw new Error('FORBIDDEN: Only the project owner can change lock status');

    const updatedProject = await prisma.savedProject.update({
      where: { id: projectId },
      data: { isLocked, updatedAt: project.updatedAt },
    });

    return { success: true, project: { id: updatedProject.id, isLocked: updatedProject.isLocked } };
  }

  /**
   * Batch-resolve live active-room presence for a set of project IDs.
   *
   * This is the single source of truth for project presence. It powers both the
   * baked-in list fields (via {@link enrichProjectsWithRoomInfo}) and the
   * standalone `GET /projects/active-rooms` endpoint, which lets the frontend
   * refresh "N users editing" without refetching the full project list.
   * Duplicate IDs are collapsed; unknown/inactive projects return a zeroed entry.
   */
  async getProjectsActiveRoomPresence(projectIds: string[]): Promise<ProjectActiveRoomPresence[]> {
    const uniqueIds = Array.from(new Set(projectIds));
    if (uniqueIds.length === 0) return [];

    const projectRoomMap = await projectRoomService.getActiveRooms(uniqueIds);
    const activeRoomIds = Array.from(new Set(Array.from(projectRoomMap.values()).filter((id): id is string => id !== null)));
    const roomMap = await projectRoomService.getActiveRoomCounts(activeRoomIds);

    return uniqueIds.map((projectId) => {
      const roomId = projectRoomMap.get(projectId);
      if (roomId !== undefined && roomId !== null && roomMap.has(roomId)) {
        const info = roomMap.get(roomId)!;
        return { projectId, activeRoomId: roomId, activeUserCount: info.activeUserCount, activeRoomIsPrivate: info.isPrivate };
      }
      return { projectId, activeRoomId: null, activeUserCount: 0, activeRoomIsPrivate: false };
    });
  }

  /**
   * Resolves the room owner for a new ("New Save") Arrange project and validates
   * that the owner is eligible to own a project. Returns the owner's userId and userType.
   * Throws prefixed errors mapped to HTTP by the route layer.
   */
  /**
   * Shapes a raw `savedProject` row (as returned by the {@link listProjects}/{@link
   * listPublicProjects} selects) into the list-response project shape: `allowFork` → `allowRemix`,
   * `forkedFrom(Id)`/`forkChain` → `remixedFrom(Id)`/`remixChain`, `user` → `owner`, and
   * contributors mapped to their public fields. Shared by both list methods to avoid the two
   * copies drifting (they were previously duplicated verbatim).
   */
  private mapProjectForList(p: {
    allowFork: boolean; forkedFrom: { id: string; name: string; user: { id: string; username: string | null; profilePictureUrl: string | null } } | null;
    forkedFromId: string | null; forkChain: unknown; user: { id: string; username: string | null; profilePictureUrl: string | null };
    contributors: Array<{ user: { id: string; username: string | null; profilePictureUrl: string | null }; lastContributedAt: Date }>;
    // eslint-disable-next-line @typescript-eslint/member-ordering -- index signature in inline parameter type; ESLint incorrectly treats it as a class member
    [key: string]: unknown;
  }) {
    const { allowFork: hasAllowFork, forkedFrom, forkedFromId, forkChain, user, contributors, ...rest } = p;
    return {
      ...rest,
      allowRemix: hasAllowFork,
      remixedFromId: forkedFromId,
      remixedFrom: forkedFrom ? { id: forkedFrom.id, name: forkedFrom.name, user: forkedFrom.user } : null,
      remixChain: forkChain,
      owner: user,
      contributors: contributors.map((c) => ({
        id: c.user.id, username: c.user.username, profilePictureUrl: c.user.profilePictureUrl, lastContributedAt: c.lastContributedAt,
      })),
    };
  }

  private async resolveRoomOwnerForSave(roomId: string): Promise<{ ownerId: string; ownerType: UserType }> {
    const room = await roomRepositoryForSave.getRoom(roomId);
    if (!room) throw new Error('NOT_FOUND: Room not found');
    const ownerId = room.owner.toString();

    const ownerUser = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { userType: true },
    });

    // No DB user → guest/unauthenticated room owner cannot own a project.
    if (ownerUser === null) {
      throw new Error('ROOM_OWNER_IS_GUEST: Room owner must be a registered account to save this project');
    }
    const ownerType = ownerUser.userType as UserType;
    return { ownerId, ownerType };
  }

  private async enrichProjectsWithRoomInfo<T extends { id: string }>(projects: T[]): Promise<(T & { activeRoomId: string | null; activeUserCount: number; activeRoomIsPrivate: boolean })[]> {
    if (projects.length === 0) return [];

    const presence = await this.getProjectsActiveRoomPresence(projects.map((project) => project.id));
    const presenceMap = new Map(presence.map((entry) => [entry.projectId, entry]));

    return projects.map(project => {
      const info = presenceMap.get(project.id);
      return {
        ...project,
        activeRoomId: info?.activeRoomId ?? null,
        activeUserCount: info?.activeUserCount ?? 0,
        activeRoomIsPrivate: info?.activeRoomIsPrivate ?? false,
      };
    });
  }

}

export const projectApplicationService = new ProjectApplicationService();

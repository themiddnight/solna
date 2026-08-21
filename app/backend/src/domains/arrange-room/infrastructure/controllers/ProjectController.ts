import type { Request, Response } from 'express';
import fs from 'fs';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import type { Server as SocketIOServer } from 'socket.io';
import type { ProjectImportService } from '../../domain/services/ProjectImportService';
import type { ProjectRetrievalService } from '../../domain/services/ProjectRetrievalService';
import { projectRoomService } from '../storage/ProjectRoomService';
import { projectApplicationService } from '../../application/ProjectApplicationService';
import { prisma } from '../../../../config/prisma';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import { clientErrorDetail } from '../../../../shared/utils/errorUtils';
import { ProjectVersionMismatchError } from '../../domain/errors/ProjectVersionMismatchError';

interface LoadProjectFromStorageBody {
  projectId?: unknown;
}

export class ProjectController {
  constructor(
    private readonly projectImportService: ProjectImportService,
    private readonly projectRetrievalService: ProjectRetrievalService,
    private readonly io?: SocketIOServer
  ) {}

  /**
   * Upload and distribute a project file to all users in the room
   * BR-12: Owner-only after first save
   */
  uploadProject = async (req: Request, res: Response): Promise<void> => {
    const { roomId } = req.params;
    const file = req.file;

    // Identity comes from the authenticated JWT (route is behind authenticateToken), never from
    // the request body (DEV-180 — prevents IDOR / BR-12 owner-gate spoofing).
    const userId = req.user?.id;
    const username = req.user?.username ?? 'Unknown';

    if (!roomId || !file) {
      res.status(400).json({ success: false, message: 'Project file is required' });
      return;
    }

    if (!userId) {
      await fs.promises.unlink(file.path).catch(() => {});
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    try {
      // BR-12: Check project ownership for import (owner-only after first save)
      const project = await projectRoomService.getProjectByActiveRoom(roomId);
      if (project) {
        const projectDetails = await prisma.savedProject.findUnique({
          where: { id: project.id },
          select: { userId: true },
        });

        if (!projectDetails || projectDetails.userId !== userId) {
          res.status(403).json({
            success: false,
            message: 'Only the project owner can import projects.'
          });
          // Clean up uploaded file
          await fs.promises.unlink(file.path).catch(() => {});
          return;
        }
      }

      // Delegate complex file processing and state updates to the service
      const { projectData, savedAudioFiles } = await this.projectImportService.importProject(
        roomId,
        file.path,
        file.destination,
        userId,
        username
      );

      // 8. Broadcast project to all users in the room via WebSocket
      if (this.io) {
        // Emit to the room namespace (not /arrange namespace)
        const roomNamespace = this.io.of(`/room/${roomId}`);
        roomNamespace.to(roomId).emit(ARRANGE_EVENTS.PROJECT_LOADED, {
          projectData,
          uploadedBy: username,
          uploadedByUserId: userId,
          uploadedAt: new Date().toISOString(),
        });

        loggingService.logInfo('Project broadcasted to room', {
          roomId,
          projectName: projectData.metadata.name,
          uploadedBy: username,
          audioFilesCount: savedAudioFiles.length,
        });
      }

      // 9. Clean up uploaded file
      await fs.promises.unlink(file.path).catch(() => {});

      res.status(200).json({
        success: true,
        message: 'Project uploaded and distributed successfully',
        projectName: projectData.metadata.name,
        audioFilesCount: savedAudioFiles.length,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectController:uploadProject',
        roomId,
      });

      // Clean up uploaded file on error
      await fs.promises.unlink(file.path).catch(() => {});

      if (error instanceof ProjectVersionMismatchError) {
        // Client-safe, actionable message by construction — surfaced even in production,
        // unlike the generic clientErrorDetail()-gated `error` field below.
        res.status(409).json({ success: false, message: error.message });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to upload project',
        error: clientErrorDetail(error),
      });
    }
  };

  /**
   * Get current project for a room
   */
  getProject = async (req: Request, res: Response): Promise<void> => {
    const { roomId } = req.params;

    if (!roomId) {
      res.status(400).json({ success: false, message: 'Room ID is required' });
      return;
    }

    try {
      const result = await this.projectRetrievalService.getProject(roomId);
      
      if (result.project) {
        res.status(200).json({
          success: true,
          project: result.project,
          metadata: result.metadata,
        });
        return;
      }

      // Return 200 with null project instead of 404 to avoid console errors in frontend
      res.status(200).json({ 
        success: true, 
        project: null,
        message: 'No project found for this room' 
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectController:getProject',
        roomId,
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get project',
        error: clientErrorDetail(error),
      });
    }
  };
  /**
   * Load project directly from server storage (Zero-latency load)
   * BR-12: Owner-only after first save
   */
  loadProjectFromStorage = async (req: Request, res: Response): Promise<void> => {
    const { roomId } = req.params;
    const body = req.body as LoadProjectFromStorageBody;
    const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
    // Identity comes from the authenticated JWT (route is behind authenticateToken), never from
    // the request body (DEV-180 — prevents IDOR / BR-12 owner-gate spoofing). Guests never reach
    // this route (BR-20 — opening projects requires a verified registered account).
    const userId = req.user?.id;
    const username = req.user?.username ?? 'Unknown';

    if (!roomId || !projectId) {
      res.status(400).json({ success: false, message: 'Room ID and Project ID are required' });
      return;
    }

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    try {
      // Resolve the target project first: read access gates the load, and the storage
      // path + room projectOwnerId are keyed by the project owner, not the requester.
      const targetProject = await prisma.savedProject.findUnique({
        where: { id: projectId },
        select: { id: true, userId: true, visibility: true, bands: { select: { id: true } } },
      });

      if (!targetProject) {
        res.status(404).json({ success: false, message: 'Project not found' });
        return;
      }

      // Visibility read access (BR-6): owner / PUBLIC / BAND + membership. Applies to every
      // load, including rooms with no active project yet (DEV-256 — no arbitrary-id IDOR).
      const canRead = await projectApplicationService.hasReadAccess(userId, targetProject);
      if (!canRead) {
        res.status(403).json({
          success: false,
          message: 'You do not have access to this project.'
        });
        return;
      }

      // BR-12: importing a DIFFERENT project into an active saved session is owner-only.
      // Loading the room's own active project is the bootstrap load of the "open project"
      // flow and is covered by the read-access check above (DEV-256).
      const activeProject = await projectRoomService.getProjectByActiveRoom(roomId);
      if (activeProject && activeProject.id !== targetProject.id) {
        const activeProjectDetails = await prisma.savedProject.findUnique({
          where: { id: activeProject.id },
          select: { userId: true },
        });

        if (!activeProjectDetails || activeProjectDetails.userId !== userId) {
          res.status(403).json({
            success: false,
            message: 'Only the project owner can import projects.'
          });
          return;
        }
      }

      // Use the new server-side import method
      const { projectData, savedAudioFiles } = await this.projectImportService.importProjectFromStorage(
        roomId,
        projectId,
        targetProject.userId,
        username
      );

      // Broadcast update to room
      if (this.io) {
        const roomNamespace = this.io.of(`/room/${roomId}`);
        roomNamespace.to(roomId).emit(ARRANGE_EVENTS.PROJECT_LOADED, {
          projectData,
          uploadedBy: username,
          uploadedByUserId: userId,
          uploadedAt: new Date().toISOString(),
          isFromStorage: true,
        });

        loggingService.logInfo('Project loaded from storage and broadcasted', {
          roomId,
          projectId,
          username,
        });
      }

      res.status(200).json({
        success: true,
        message: 'Project loaded successfully from storage',
        projectName: projectData.metadata.name,
        audioFilesCount: savedAudioFiles.length,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ProjectController:loadProjectFromStorage',
        roomId,
        projectId,
      });

      if (error instanceof ProjectVersionMismatchError) {
        // Client-safe, actionable message by construction — surfaced even in production,
        // unlike the generic clientErrorDetail()-gated `error` field below.
        res.status(409).json({ success: false, message: error.message });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to load project from storage',
        error: clientErrorDetail(error),
      });
    }
  };
}

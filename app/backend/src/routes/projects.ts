import type { Response, Request } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AuthRequest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken, optionalAuthAllowGuest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { projectApplicationService, updateVisibilityCmdSchema, updateSettingsCmdSchema, saveFromRoomCmdSchema, remixProjectCmdSchema, saveFromRoomUpdateCmdSchema } from '../domains/arrange-room/application/ProjectApplicationService';
import type { CreateProjectCmd } from '../domains/arrange-room/application/ProjectApplicationService';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { sanitizeFilename } from '../shared/infrastructure/storage/sanitizeFilename';
import { AUDIO_UPLOAD_MIMES, ARCHIVE_UPLOAD_MIMES, isAllowedUploadMime } from '../shared/utils/audioUploadMime';
import { RoomType } from '../types';

const setActiveRoomBodySchema = z.object({ roomId: z.string().min(1) });
const toggleLockBodySchema = z.object({ isLocked: z.boolean() });

const createProjectFormSchema: z.ZodType<CreateProjectCmd> = z.object({
  name: z.string().min(1, 'name is required').transform(v => v.trim()),
  description: z.string().optional().transform(v => v?.trim()),
  roomType: z.nativeEnum(RoomType, { error: 'roomType must be "perform" or "arrange"' }),
  allowRemix: z.union([z.literal('true'), z.literal('false'), z.boolean()]).optional()
    .transform(v => v === 'true' || v === true),
  projectData: z.string().min(1, 'projectData is required').transform((val, ctx) => {
    try {
      return JSON.parse(val) as Record<string, unknown>;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid projectData JSON' });
      return z.NEVER;
    }
  }),
  metadata: z.string().optional().transform(val => {
    if (val == null) return {};
    try { return JSON.parse(val) as Record<string, unknown>; } catch { return {}; }
  }),
});

const router: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 10 }, // 200MB limit, max 10 files
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [...AUDIO_UPLOAD_MIMES, ...ARCHIVE_UPLOAD_MIMES];
    if (isAllowedUploadMime(file.mimetype, allowedMimes)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  },
});

router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await projectApplicationService.listProjects(userId, req.query);
    res.json(result);
  } catch (error: unknown) {
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.GET /' });
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.get('/public', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await projectApplicationService.listPublicProjects(req.query);
    res.json(result);
  } catch (error: unknown) {
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.GET /public' });
    res.status(500).json({ error: 'Failed to fetch public projects' });
  }
});

// Batch active-room presence — lets the frontend refresh "N users editing" on
// project cards without refetching the whole project list. Public (matches
// /:id/active-room-info) since community cards are guest-viewable. MUST stay
// above '/:id' so it isn't captured as a project id.
router.get('/active-rooms', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawIds = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = rawIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (ids.length === 0) {
      res.json({ presence: [] });
      return;
    }
    if (ids.length > 100) {
      res.status(400).json({ error: 'Too many project ids (max 100)' });
      return;
    }

    const presence = await projectApplicationService.getProjectsActiveRoomPresence(ids);
    res.json({ presence });
  } catch (error: unknown) {
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.GET /active-rooms' });
    res.status(500).json({ error: 'Failed to fetch active room presence' });
  }
});

router.get('/rooms/:roomId/export/collab', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const projectName = typeof req.query.projectName === 'string' && req.query.projectName !== '' ? req.query.projectName : 'Untitled Project';
    const zipBuffer = await projectApplicationService.exportCollab(userId, req.params.roomId as string, projectName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${projectName.replace(/[^a-z0-9_-]/gi, '_')}.collab"`);
    res.send(zipBuffer);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: 'Forbidden', message: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects - export collab' });
    res.status(500).json({ error: 'Failed to export project' });
  }
});

router.get('/rooms/:roomId/export/stems', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const projectName = typeof req.query.projectName === 'string' && req.query.projectName !== '' ? req.query.projectName : 'Untitled Project';
    const zipBuffer = await projectApplicationService.exportStems(userId, req.params.roomId as string, projectName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${projectName.replace(/[^a-z0-9_-]/gi, '_')}-stems.zip"`);
    res.send(zipBuffer);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: 'Forbidden', message: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects - export stems' });
    res.status(500).json({ error: 'Failed to export stems' });
  }
});

router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await projectApplicationService.getProject(userId, req.params.id as string);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.GET /:id' });
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

router.get('/:id/lock-status', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lockStatus = await projectApplicationService.getLockStatus(req.params.id as string);
    res.json(lockStatus);
  } catch (error: unknown) {
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects - lock status' });
    res.status(500).json({ error: 'Failed to check lock status' });
  }
});

router.post('/', authenticateToken, upload.array('audioFiles'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const cmdParse = createProjectFormSchema.safeParse(req.body);
    if (!cmdParse.success) {
      res.status(400).json({ error: cmdParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }

    const files = req.files as Express.Multer.File[] | undefined;
    const audioFilesBuffers = (files != null ? files.map(file => ({
      fileName: sanitizeFilename(file.originalname),
      buffer: file.buffer,
    })) : []) as { fileName: string; buffer: Buffer }[];

    const project = await projectApplicationService.createProject(userId, cmdParse.data, audioFilesBuffers);
    res.status(201).json({ project });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('LIMIT_REACHED')) {
      res.status(403).json({
        error: 'Project limit reached',
        message: 'You have reached the maximum number of projects. Please delete an existing project first.',
      });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.POST /' });
    res.status(500).json({ error: 'Failed to save project' });
  }
});

router.patch('/:id/visibility', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const bodyParse = updateVisibilityCmdSchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const result = await projectApplicationService.updateVisibility(userId, req.params.id as string, bodyParse.data);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: (error instanceof Error ? error.message.replace('NOT_FOUND: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects - visibility' });
    res.status(500).json({ error: 'Failed to update visibility' });
  }
});

router.patch('/:id/settings', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const bodyParse = updateSettingsCmdSchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const result = await projectApplicationService.updateSettings(userId, req.params.id as string, bodyParse.data);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects - settings' });
    res.status(500).json({ error: 'Failed to update project settings' });
  }
});

router.post('/save-from-room', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const bodyParse = saveFromRoomCmdSchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const result = await projectApplicationService.saveFromRoom(userId, bodyParse.data);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: (error instanceof Error ? error.message.replace('NOT_FOUND: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('ROOM_OWNER_LIMIT_REACHED')) {
      res.status(403).json({
        error: 'Room owner project limit reached',
        code: 'ROOM_OWNER_LIMIT_REACHED',
        message: 'The room owner has reached their project limit, so this room cannot be saved as a new project.',
      });
      return;
    }
    if (error instanceof Error && error.message.startsWith('ROOM_OWNER_IS_GUEST')) {
      res.status(403).json({
        error: 'Room owner is a guest',
        code: 'ROOM_OWNER_IS_GUEST',
        message: 'The room owner is a guest account. Ask them to register, or transfer room ownership to a registered member, then save.',
      });
      return;
    }
    if (error instanceof Error && error.message.startsWith('ROOM_OWNER_NOT_VERIFIED')) {
      res.status(403).json({
        error: 'Room owner not verified',
        code: 'ROOM_OWNER_NOT_VERIFIED',
        message: 'The room owner must verify their email, or transfer room ownership to a verified member, then save.',
      });
      return;
    }
    if (error instanceof Error && error.message.startsWith('LIMIT_REACHED')) {
      res.status(403).json({
        error: 'Project limit reached',
        message: 'You have reached the maximum number of projects for your account type.',
      });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.POST /save-from-room' });
    res.status(500).json({ error: 'Failed to save project from room state' });
  }
});

router.post('/:id/remix', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const bodyParse = remixProjectCmdSchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const result = await projectApplicationService.remixProject(userId, req.params.id as string, bodyParse.data);
    res.status(201).json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: (error instanceof Error ? error.message.replace('NOT_FOUND: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('LIMIT_REACHED')) {
      try {
        const existingProjects = JSON.parse(error.message.replace('LIMIT_REACHED: ', '')) as unknown;
        res.status(403).json({
          error: 'Project limit reached',
          code: 'PROJECT_LIMIT_REACHED',
          message: 'You have reached the project limit. Please select a project to replace.',
          projects: existingProjects,
        });
      } catch {
        res.status(403).json({ error: 'Project limit reached' });
      }
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.POST /:id/remix' });
    res.status(500).json({ error: 'Failed to remix project' });
  }
});

router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await projectApplicationService.deleteProject(userId, req.params.id as string);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: (error instanceof Error ? error.message.replace('NOT_FOUND: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.DELETE /:id' });
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

router.get('/:id/active-room', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await projectApplicationService.getActiveRoom(req.params.id as string);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: (error instanceof Error ? error.message.replace('NOT_FOUND: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects - active room' });
    res.status(500).json({ error: 'Failed to get active room' });
  }
});

router.get('/:id/active-room-info', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await projectApplicationService.getActiveRoomInfo(req.params.id as string);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: (error instanceof Error ? error.message.replace('NOT_FOUND: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects - active room info' });
    res.status(500).json({ error: 'Failed to get active room info' });
  }
});

router.get('/:id/share-access', optionalAuthAllowGuest, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = {
      userId: req.user?.id ?? null,
      userType: req.user?.userType ?? null,
      isEmailVerified: req.user?.emailVerified ?? false,
    };
    const result = await projectApplicationService.resolveShareAccess(actor, req.params.id as string);
    res.json(result);
  } catch (error: unknown) {
    loggingService.logError(
      error instanceof Error ? error : new Error(String(error)),
      { context: 'routes/projects - share access' }
    );
    res.status(500).json({ error: 'Failed to resolve share access' });
  }
});

// Registered-only (BR-20: guests cannot open projects, so they never legitimately claim a
// project's active room): authenticateToken rejects guest tokens (401) and, since the OTP hard
// gate, unverified registered accounts too; setActiveRoom additionally gates access per visibility.
router.put('/:id/active-room', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const bodyParse = setActiveRoomBodySchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'roomId is required' });
      return;
    }
    await projectApplicationService.setActiveRoom(userId, req.params.id as string, bodyParse.data.roomId);
    res.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: (error instanceof Error ? error.message.replace('NOT_FOUND: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('CONFLICT')) {
      // Parse conflict info "CONFLICT: Project already has an active room: <roomId> (<count> users)"
      const match = error.message.match(/active room: (.*) \((.*) users\)/);
      res.status(409).json({
        error: 'Project already has an active room',
        activeRoomId: match ? match[1] : (undefined as string | undefined),
        activeUserCount: match ? parseInt(match[2] as string, 10) : (undefined as number | undefined),
      });
      return;
    }
    if (error instanceof Error && error.message.startsWith('SERVICE_UNAVAILABLE')) {
      res.status(503).json({ error: (error instanceof Error ? error.message.replace('SERVICE_UNAVAILABLE: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects - set active room' });
    res.status(500).json({ error: 'Failed to set active room' });
  }
});

router.put('/:id/save-from-room', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const bodyParse = saveFromRoomUpdateCmdSchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const result = await projectApplicationService.saveFromRoomUpdate(userId, req.params.id as string, bodyParse.data);
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: (error instanceof Error ? error.message.replace('NOT_FOUND: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.PUT /:id/save-from-room' });
    res.status(500).json({ error: 'Failed to save project from room state' });
  }
});





router.patch('/:id/lock', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const bodyParse = toggleLockBodySchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'isLocked (boolean) is required' });
      return;
    }
    const result = await projectApplicationService.toggleLock(userId, req.params.id as string, bodyParse.data.isLocked);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: (error instanceof Error ? error.message.replace('BAD_REQUEST: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: (error instanceof Error ? error.message.replace('NOT_FOUND: ', '') : '') });
      return;
    }
    if (error instanceof Error && error.message.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: (error instanceof Error ? error.message.replace('FORBIDDEN: ', '') : '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/projects.PATCH /:id/lock' });
    res.status(500).json({ error: 'Failed to update lock status' });
  }
});

export default router;

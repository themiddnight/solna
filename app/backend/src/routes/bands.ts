import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { bandApplicationService } from '../domains/user-management/application/BandApplicationService';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';

const updateBandBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

const createBandBodySchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
});

const inviteByEmailBodySchema = z.object({
  email: z.string().email('valid email is required'),
});

const router: Router = Router();

router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await bandApplicationService.listUserBands(userId, req.query);
    res.json(result);
  } catch (error: unknown) {
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands.GET /' });
    res.status(500).json({ error: 'Failed to fetch bands' });
  }
});

router.get('/join/:token', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await bandApplicationService.getJoinPreview(req.params.token as string);
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: 'Invalid invite link' });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands.GET /join/:token' });
    res.status(500).json({ error: 'Failed to fetch band' });
  }
});

router.post('/join/:token', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await bandApplicationService.joinBand(req.params.token as string, userId);
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: 'Invalid invite link' });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands.POST /join/:token' });
    res.status(500).json({ error: 'Failed to join band' });
  }
});

router.get('/:id/projects', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await bandApplicationService.listBandProjects(req.params.id as string, userId, req.query);
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: msg.replace('FORBIDDEN: ', '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands.GET /:id/projects' });
    res.status(500).json({ error: 'Failed to fetch band projects' });
  }
});

router.patch('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const bodyParse = updateBandBodySchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const { name, description } = bodyParse.data;
    const result = await bandApplicationService.updateBand(req.params.id as string, userId, {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
    });
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: msg.replace('BAD_REQUEST: ', '') });
      return;
    }
    if (msg.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: msg.replace('FORBIDDEN: ', '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands.PUT /:id' });
    res.status(500).json({ error: 'Failed to update band' });
  }
});

router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await bandApplicationService.getBandDetails(req.params.id as string, userId);
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: msg.replace('FORBIDDEN: ', '') });
      return;
    }
    if (msg.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: msg.replace('NOT_FOUND: ', '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands.GET /:id' });
    res.status(500).json({ error: 'Failed to fetch band' });
  }
});

router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const bodyParse = createBandBodySchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const { name, description } = bodyParse.data;
    const result = await bandApplicationService.createBand(userId, {
      name,
      ...(description !== undefined && { description }),
    });
    res.status(201).json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: msg.replace('BAD_REQUEST: ', '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands.POST /' });
    res.status(500).json({ error: 'Failed to create band' });
  }
});

router.post('/:id/refresh-token', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await bandApplicationService.refreshInviteToken(req.params.id as string, userId);
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: msg.replace('FORBIDDEN: ', '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands - refresh token' });
    res.status(500).json({ error: 'Failed to refresh invite token' });
  }
});

router.delete('/:id/members/:memberId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await bandApplicationService.removeMember(req.params.id as string, req.params.memberId as string, userId);
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: msg.replace('FORBIDDEN: ', '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands - remove member' });
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

router.post('/:id/leave', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await bandApplicationService.leaveBand(req.params.id as string, userId);
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: msg.replace('FORBIDDEN: ', '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands - leave' });
    res.status(500).json({ error: 'Failed to leave band' });
  }
});

router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await bandApplicationService.deleteBand(req.params.id as string, userId);
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: msg.replace('FORBIDDEN: ', '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands - delete' });
    res.status(500).json({ error: 'Failed to delete band' });
  }
});

router.post('/:id/invite-by-email', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    const inviterName = req.user?.username || 'A band owner';
    
    const bodyParse = inviteByEmailBodySchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const result = await bandApplicationService.inviteByEmail(
      req.params.id as string,
      bodyParse.data.email,
      userId,
      inviterName
    );
    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('BAD_REQUEST')) {
      res.status(400).json({ error: msg.replace('BAD_REQUEST: ', '') });
      return;
    }
    if (msg.startsWith('FORBIDDEN')) {
      res.status(403).json({ error: msg.replace('FORBIDDEN: ', '') });
      return;
    }
    if (msg.startsWith('NOT_FOUND')) {
      res.status(404).json({ error: msg.replace('NOT_FOUND: ', '') });
      return;
    }
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/bands - send invitation' });
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

export default router;

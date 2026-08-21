import { Router, type Router as RouterType } from 'express';
import type { AuthRequest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { requireRegistered } from '../domains/auth/infrastructure/middleware/guestLimitations';
import { aiJobQueue } from '../domains/ai-generation/domain/services/AiJobQueueService';

const router: RouterType = Router();

// Cancel current job
router.post('/cancel', authenticateToken, requireRegistered, (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const isCanceled = aiJobQueue.cancelJob(req.user.id);
  if (isCanceled) {
    res.json({ message: 'Job canceled successfully' });
  } else {
    res.status(404).json({ error: 'No active job found to cancel' });
  }
});

// Check status with queue position
router.get('/status', authenticateToken, requireRegistered, (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const job = aiJobQueue.getJob(req.user.id);
  if (job) {
    res.json({
      status: job.status,
      provider: job.provider,
      createdAt: job.createdAt,
      queuePosition: aiJobQueue.getQueuePosition(job.id),
    });
  } else {
    res.json({ status: 'idle' });
  }
});

// Get queue statistics (for monitoring)
router.get('/stats', authenticateToken, (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const stats = aiJobQueue.getStats();
  res.json(stats);
});

export default router;

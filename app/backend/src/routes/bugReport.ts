import { Router } from 'express';
import { BugReportController } from '../shared/infrastructure/bug-report/BugReportController';
import rateLimit from 'express-rate-limit';

const router: Router = Router();
const controller = new BugReportController();

// Rate limit: 5 reports per hour per IP (anti-spam)
const bugReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many bug reports. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/bug-report
router.post('/', bugReportLimiter, (req, res) => controller.submit(req, res));

export default router;

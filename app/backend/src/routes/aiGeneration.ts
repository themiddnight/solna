import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { AI_GENERATION_CONSTANTS } from '@jam-band/shared';
import type { AuthRequest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { requireRegistered } from '../domains/auth/infrastructure/middleware/guestLimitations';
import { aiGenerationService } from '../domains/ai-generation/domain/services/AiGenerationService';
import { aiGenerationRateLimiter } from '../domains/ai-generation/infrastructure/middleware/rateLimit';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';

const generateBodySchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  context: z.record(z.string(), z.unknown()).optional(),
  maxTokens: z.number().int().positive().optional(),
  mode: z.enum(['generate', 'edit']).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        content: z.string(),
      })
    )
    .max(20)
    .optional(),
  indexedNotes: z
    .array(
      z.object({
        index: z.number().int(),
        pitch: z.number(),
        start: z.number(),
        duration: z.number(),
        velocity: z.number(),
      })
    )
    // Generous upper bound — a single edit-mode region's live notes.
    // Legitimate regions don't run into the thousands; this just stops a
    // malformed/huge client payload from ballooning the prompt.
    .max(512)
    .optional(),
  // Requested generate-mode range length in bars (DEV-46). Capped so an
  // over-long range fails fast with a clear error instead of a silent
  // provider timeout. Bars (not beats) because the bar→beat conversion is
  // time-signature-dependent and done on the FE.
  rangeBars: z.number().positive().optional(),
});

const router: RouterType = Router();

// Generate Notes
router.post('/generate', authenticateToken, requireRegistered, aiGenerationRateLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const bodyParse = generateBodySchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const { prompt, context, maxTokens, mode, history, indexedNotes, rangeBars } = bodyParse.data;

    // Boundary guard (TR-31): reject an over-long range up front with a clear
    // message rather than letting the provider run into a silent timeout.
    if (rangeBars !== undefined && rangeBars > AI_GENERATION_CONSTANTS.MAX_RANGE_BARS) {
      res.status(400).json({
        error: `Generation range too long. Maximum is ${AI_GENERATION_CONSTANTS.MAX_RANGE_BARS} bars.`,
      });
      return;
    }

    const result = await aiGenerationService.generate(req.user.id, {
      prompt,
      context: context ?? {},
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(history !== undefined ? { history } : {}),
      ...(indexedNotes !== undefined ? { indexedNotes } : {}),
      ...(rangeBars !== undefined ? { rangeBars } : {}),
    });

    res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'aiGenerationRoutes.generate' });
    
    // Map specific errors
    if (msg.includes('already have a generation')) {
      res.status(409).json({ error: msg });
      return;
    }
    
    if (msg === 'Job canceled') {
      res.status(400).json({ error: 'Job canceled' });
      return;
    }

    res.status(500).json({ error: msg !== '' ? msg : 'Failed to generate content' });
  }
});

export default router;

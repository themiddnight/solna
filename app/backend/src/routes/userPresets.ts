import { Router, type Router as RouterType } from 'express';
import { PresetType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthRequest } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { authenticateToken } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { requireRegistered } from '../domains/auth/infrastructure/middleware/guestLimitations';
import { prisma } from '../config/prisma';
import { aiSettingsService } from '../domains/user-management/domain/services/AiSettingsService';
import { loggingService } from '../shared/infrastructure/logging/LoggingService';
import { clientErrorDetail } from '../shared/utils/errorUtils';

const VALID_PRESET_TYPES = ['SYNTH', 'EFFECT', 'SEQUENCER', 'INSTRUMENT'] as const;

const jsonValueSchema: z.ZodType<Prisma.InputJsonValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]) as z.ZodType<Prisma.InputJsonValue>;

const savePresetBodySchema = z.object({
  presetType: z.nativeEnum(PresetType, { error: 'Invalid preset type' }),
  name: z.string().min(1, 'name is required'),
  data: jsonValueSchema,
});

const updatePresetBodySchema = z.object({
  name: z.string().min(1).optional(),
  data: jsonValueSchema.optional(),
});

const aiSettingsBodySchema = z.object({
  provider: z.string().optional(),
  enabled: z.boolean().optional(),
  apiKey: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const router: RouterType = Router();

// Get all user presets (optionally filtered by type)
router.get('/presets', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

     
    const { type } = req.query;
    const where: Record<string, unknown> = { userId: req.user.id };
    
    if (type != null && typeof type === 'string' && VALID_PRESET_TYPES.includes(type as typeof VALID_PRESET_TYPES[number])) {
      where.presetType = type;
    }

    const presets = await prisma.userPreset.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ presets });
  } catch {
    res.status(500).json({ error: 'Failed to fetch presets' });
  }
});

// Save a new preset
router.post('/presets', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const bodyParse = savePresetBodySchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const { presetType, name, data } = bodyParse.data;

    const preset = await prisma.userPreset.create({
      data: {
        userId: req.user.id,
        presetType,
        name,
        data,
      },
    });

    res.status(201).json({ preset });
  } catch {
    res.status(500).json({ error: 'Failed to save preset' });
  }
});

// Update a preset
router.put('/presets/:id', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Preset ID required' });
      return;
    }

    const bodyParse = updatePresetBodySchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const { name, data } = bodyParse.data;

    // Verify preset belongs to user
    const existing = await prisma.userPreset.findFirst({
      where: { id: id, userId: req.user.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Preset not found' });
      return;
    }

    const preset = await prisma.userPreset.update({
      where: { id: id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(data !== undefined ? { data } : {}),
      },
    });

    res.json({ preset });
  } catch {
    res.status(500).json({ error: 'Failed to update preset' });
  }
});

// Delete a preset
router.delete('/presets/:id', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Preset ID required' });
      return;
    }

    // Verify preset belongs to user
    const existing = await prisma.userPreset.findFirst({
      where: { id: id, userId: req.user.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Preset not found' });
      return;
    }

    await prisma.userPreset.delete({
      where: { id: id },
    });

    res.json({ message: 'Preset deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete preset' });
  }
});

// Mark that the onboarding tour has been offered to this user (idempotent — first call stamps
// onboardingTourPromptedAt = now(), later calls leave the original timestamp untouched). Acting
// identity comes from the verified token (req.user), never the request body (TR-33).
router.put('/onboarding-tour-prompted', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const existing = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { onboardingTourPromptedAt: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const user = existing.onboardingTourPromptedAt
      ? { id: req.user.id, onboardingTourPromptedAt: existing.onboardingTourPromptedAt }
      : await prisma.user.update({
          where: { id: req.user.id },
          data: { onboardingTourPromptedAt: new Date() },
          select: { id: true, onboardingTourPromptedAt: true },
        });
    res.json({ user });
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error(String(error)), { context: 'routes/userPresets.onboardingTourPrompted' });
    res.status(500).json({ error: 'Failed to update onboarding tour state' });
  }
});

// Get AI Settings
router.get('/ai-settings', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const settings = await aiSettingsService.getSettings(req.user.id);
    res.json({ settings });
  } catch (e) {
    loggingService.logError(e instanceof Error ? e : new Error(String(e)), { context: 'routes/userPresets.getAiSettings' });
    res.status(500).json({ error: 'Failed to get AI settings' });
  }
});

// Update AI Settings
router.put('/ai-settings', authenticateToken, requireRegistered, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const bodyParse = aiSettingsBodySchema.safeParse(req.body);
    if (!bodyParse.success) {
      res.status(400).json({ error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const { provider, enabled: isEnabled, apiKey, settings } = bodyParse.data;

    if (isEnabled === true && (provider === undefined || provider.length === 0)) {
      res.status(400).json({ error: 'Provider is required when enabled' });
      return;
    }

    const updated = await aiSettingsService.updateSettings(req.user.id, {
        provider: provider ?? '',
        enabled: isEnabled === true,
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(settings !== undefined ? { settings } : {}),
    });

    res.json({ settings: updated });
  } catch (e) {
    loggingService.logError(e instanceof Error ? e : new Error(String(e)), { context: 'routes/userPresets.updateAiSettings' });
    res.status(500).json({ error: clientErrorDetail(e) ?? 'Failed to update AI settings' });
  }
});

export default router;
